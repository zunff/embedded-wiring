/**
 * The reason this is more than a drawing: given the netlist it can say what
 * would fail on the bench. Rules here are logic-level only — a common ground,
 * two drivers on one net, 5V on a 3.3V pin, a strapping pin pulled at boot,
 * I2C without pull-ups. They cannot see current, wire gauge, or EMI, and the
 * plugin must never imply they do.
 * @module @local/embedded-wiring/validate
 */

import { findPart, findPin, netOfNode, parseNode } from './model.js'

const SEVERITY_ORDER = { error: 0, warning: 1 }

/** One finding, addressed so the page can focus the offending part or net. */
function finding(severity, code, message, extra = {}) {
  return { severity, code, message, ...extra }
}

function partLabel(part) {
  return part?.label ?? part?.id ?? '未知部件'
}

/** Every referenced node resolves to a real part and pin, exactly once. */
function structural(doc) {
  const diagnostics = []
  const seenIds = new Set()
  for (const part of doc.parts) {
    if (seenIds.has(part.id)) {
      diagnostics.push(finding('error', 'duplicate-part', `部件 id 重复：${part.id}`, { partId: part.id }))
    }
    seenIds.add(part.id)
    const pins = new Set()
    for (const pin of part.pins) {
      if (pins.has(pin.name)) {
        diagnostics.push(finding('error', 'duplicate-pin', `${partLabel(part)} 的引脚名重复：${pin.name}`, { partId: part.id }))
      }
      pins.add(pin.name)
    }
    if (part.pins.length === 0) {
      diagnostics.push(finding('error', 'empty-part', `${partLabel(part)} 没有任何引脚`, { partId: part.id }))
    }
  }
  const netIds = new Set()
  const nodeOwner = new Map()
  for (const net of doc.nets) {
    if (netIds.has(net.id)) {
      diagnostics.push(finding('error', 'duplicate-net', `网络 id 重复：${net.id}`, { netId: net.id }))
    }
    netIds.add(net.id)
    if (net.nodes.length < 2) {
      diagnostics.push(finding('warning', 'short-net', `网络「${net.name}」只连了一个引脚，等于没接`, { netId: net.id }))
    }
    for (const node of net.nodes) {
      const parsed = parseNode(node)
      const part = parsed === undefined ? undefined : findPart(doc, parsed.partId)
      const pin = part === undefined ? undefined : findPin(part, parsed.pin)
      if (part === undefined || pin === undefined) {
        diagnostics.push(finding('error', 'unknown-node', `网络「${net.name}」引用了不存在的引脚：${node}`, { netId: net.id }))
        continue
      }
      const owner = nodeOwner.get(node)
      if (owner !== undefined && owner !== net.id) {
        diagnostics.push(finding('error', 'pin-twice', `引脚 ${node} 同时出现在「${doc.nets.find(n => n.id === owner)?.name ?? owner}」和「${net.name}」`, { netId: net.id }))
      }
      nodeOwner.set(node, net.id)
    }
  }
  return diagnostics
}

/** Rails: one voltage per power net, nothing above a pin's tolerance, nothing under-supplied. */
function voltages(doc) {
  const diagnostics = []
  for (const net of doc.nets) {
    const nodes = net.nodes.map(node => {
      const parsed = parseNode(node)
      const part = parsed === undefined ? undefined : findPart(doc, parsed.partId)
      const pin = part === undefined ? undefined : findPin(part, parsed.pin)
      return part === undefined || pin === undefined ? undefined : { node, part, pin }
    }).filter(Boolean)
    const rails = new Map()
    for (const entry of nodes) {
      if (entry.pin.role !== 'power' || !Number.isFinite(entry.pin.volt)) continue
      const list = rails.get(entry.pin.volt) ?? []
      list.push(entry)
      rails.set(entry.pin.volt, list)
    }
    if (rails.size > 1) {
      const detail = [...rails.entries()].map(([volt, list]) => `${volt}V(${list.map(e => e.node).join('、')})`).join(' 与 ')
      diagnostics.push(finding('error', 'rail-mix', `网络「${net.name}」把不同电压的电源轨并在一起：${detail}`, { netId: net.id }))
    }
    const railVolt = Number.isFinite(net.volt) ? net.volt : [...rails.keys()][0]
    if (!Number.isFinite(railVolt)) continue
    for (const entry of nodes) {
      const maxVolt = Number.isFinite(entry.pin.maxVolt)
        ? entry.pin.maxVolt
        : entry.part.kind === 'board' ? 3.3 : undefined
      if (Number.isFinite(maxVolt) && railVolt > maxVolt + 0.01) {
        diagnostics.push(finding('error', 'over-voltage',
          `${railVolt}V 加到了 ${entry.node}（${partLabel(entry.part)} 耐压 ${maxVolt}V）`,
          { netId: net.id, partId: entry.part.id, node: entry.node }))
      }
      const needs = entry.pin.role === 'power' ? entry.pin.volt : undefined
      if (Number.isFinite(needs) && railVolt < needs - 0.01) {
        diagnostics.push(finding('warning', 'under-voltage',
          `${partLabel(entry.part)} 需要 ${needs}V，但「${net.name}」只有 ${railVolt}V`,
          { netId: net.id, partId: entry.part.id, node: entry.node }))
      }
    }
  }
  return diagnostics
}

/** One driver per signal net: two outputs fighting is the classic way to kill a pin. */
function drivers(doc) {
  const diagnostics = []
  for (const net of doc.nets) {
    const outputs = []
    for (const node of net.nodes) {
      const parsed = parseNode(node)
      const part = parsed === undefined ? undefined : findPart(doc, parsed.partId)
      const pin = part === undefined ? undefined : findPin(part, parsed.pin)
      if (pin?.role === 'output') outputs.push({ node, part })
    }
    if (outputs.length > 1) {
      diagnostics.push(finding('error', 'multi-driver',
        `网络「${net.name}」上有 ${outputs.length} 个输出同时驱动：${outputs.map(e => e.node).join('、')}`,
        { netId: net.id }))
    }
  }
  return diagnostics
}

/** Every referenced part shares one ground net; an ungrounded module is a floating mystery. */
function grounds(doc) {
  const diagnostics = []
  const perPart = []
  for (const part of doc.parts) {
    const groundPins = part.pins.filter(pin => pin.role === 'ground')
    if (groundPins.length === 0) continue
    const connected = doc.nets.some(net => net.nodes.some(node => parseNode(node)?.partId === part.id))
    if (!connected) continue
    const nets = new Map()
    for (const pin of groundPins) {
      const net = netOfNode(doc, `${part.id}:${pin.name}`)
      if (net !== undefined) nets.set(net.id, net)
    }
    if (nets.size === 0) {
      diagnostics.push(finding('error', 'no-ground',
        `${partLabel(part)} 接了信号但没有接地`, { partId: part.id }))
      continue
    }
    if (nets.size > 1) {
      diagnostics.push(finding('error', 'split-ground',
        `${partLabel(part)} 的地被分到 ${nets.size} 个不同网络`, { partId: part.id }))
      continue
    }
    const [net] = [...nets.values()]
    perPart.push({ part, net })
  }
  const byNet = new Map()
  for (const entry of perPart) {
    const list = byNet.get(entry.net.id) ?? []
    list.push(entry.part)
    byNet.set(entry.net.id, list)
  }
  if (byNet.size > 1) {
    const groups = [...byNet.values()].map(parts => parts.map(partLabel).join('、')).join(' ｜ ')
    diagnostics.push(finding('error', 'not-common-ground', `未共地：${groups} 各自接到了不同的地网络`, {}))
  }
  return diagnostics
}

/** Datasheet-level cautions from the board pin table. */
function boardCaps(doc) {
  const diagnostics = []
  const used = new Map()
  for (const net of doc.nets) {
    for (const node of net.nodes) {
      const parsed = parseNode(node)
      const part = parsed === undefined ? undefined : findPart(doc, parsed.partId)
      const pin = part === undefined ? undefined : findPin(part, parsed.pin)
      if (pin === undefined || part.kind !== 'board') continue
      used.set(node, { pin, net })
    }
  }
  for (const [node, { pin, net }] of used) {
    const caps = new Set(pin.caps ?? [])
    if (caps.has('strapping')) {
      diagnostics.push(finding('warning', 'strapping',
        `${node} 是启动配置脚，上电电平会影响启动模式（网络「${net.name}」）`, { netId: net.id, node }))
    }
    if (caps.has('uart0')) {
      diagnostics.push(finding('warning', 'uart0',
        `${node} 被 UART0 占用，接外设后串口日志/烧录会打架`, { netId: net.id, node }))
    }
    if (caps.has('input-only') && net.kind === 'power') {
      diagnostics.push(finding('warning', 'input-only-rail',
        `${node} 只能输入，却被接成了电源网络「${net.name}」`, { netId: net.id, node }))
    }
    if (caps.has('reserved')) {
      diagnostics.push(finding('warning', 'reserved-pin',
        `${node} 在带 octal flash/PSRAM 的模组上被内部占用，接之前先确认型号`, { netId: net.id, node }))
    }
  }
  return diagnostics
}

/** I2C needs pull-ups; without them the bus is a coin flip. */
function buses(doc) {
  const diagnostics = []
  for (const net of doc.nets) {
    if (net.protocol !== 'i2c') continue
    if (net.attrs !== undefined && net.attrs.pullup !== undefined) continue
    diagnostics.push(finding('warning', 'i2c-pullup',
      `I2C 网络「${net.name}」没有标注上拉电阻（可在在线材属性填 pullup）`, { netId: net.id }))
  }
  return diagnostics
}

/** A photo-recognized part stays flagged until the user confirms its pins. */
function recognition(doc) {
  const diagnostics = []
  for (const part of doc.parts) {
    if (part.source === 'photo' && part.verified !== true) {
      diagnostics.push(finding('warning', 'photo-unverified',
        `「${part.label}」的引脚来自照片识别，尚未核对（在部件详情里点「标记引脚已核对」）`,
        { partId: part.id }))
    }
  }
  return diagnostics
}

/** All findings, errors first, for one document. */
export function validate(doc) {
  const diagnostics = [
    ...structural(doc),
    ...voltages(doc),
    ...drivers(doc),
    ...grounds(doc),
    ...boardCaps(doc),
    ...buses(doc),
    ...recognition(doc),
  ]
  diagnostics.sort((left, right) => {
    const bySeverity = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    if (bySeverity !== 0) return bySeverity
    return left.code.localeCompare(right.code)
  })
  return diagnostics
}

/** Counts for a toolbar badge. */
export function countDiagnostics(diagnostics) {
  let errors = 0
  let warnings = 0
  for (const item of diagnostics) {
    if (item.severity === 'error') errors += 1
    else warnings += 1
  }
  return { errors, warnings }
}
