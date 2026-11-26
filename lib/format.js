/**
 * What the agent reads. A wiring file can be long; the model only needs the
 * parts, the nets, and what is wrong with them. The page has its own rendering,
 * so this text is deliberately dense and stable rather than pretty.
 * @module @local/embedded-wiring/format
 */

import { countDiagnostics, validate } from './validate.js'

function partsLine(part) {
  const kind = part.kind === 'board' ? 'board' : 'module'
  const pins = part.pins.map(pin => pin.name).join(' ')
  const flags = [
    part.source === 'photo' ? (part.verified === true ? '照片识别·已核对' : '照片识别·待核对') : '',
  ].filter(Boolean)
  return `  ${part.id}（${part.label}）${kind} ${part.model}${flags.length > 0 ? ` [${flags.join(' ')}]` : ''} · ${part.pins.length} 脚：${pins}`
}

function netLabel(net) {
  const bits = [net.kind]
  if (Number.isFinite(net.volt)) bits.push(`${net.volt}V`)
  if (net.protocol !== undefined) bits.push(net.protocol)
  for (const [key, value] of Object.entries(net.attrs ?? {})) bits.push(`${key}=${value}`)
  return `[${bits.join(' ')}]`
}

function netsLine(net) {
  return `  ${net.id} ${net.name} ${netLabel(net)} ${net.nodes.join(' → ')}`
}

/** One diagnostic as a single line, with the address folded into the code. */
export function diagnosticLine(item) {
  const where = item.node ?? item.netId ?? item.partId
  return `  [${item.severity}] ${item.code}${where === undefined ? '' : ` @ ${where}`}: ${item.message}`
}

/** The text handed to the model by every `hardware_map` action. */
export function summaryText({ project, doc, diagnostics }) {
  const counts = countDiagnostics(diagnostics)
  const lines = []
  lines.push(`接线项目「${doc.meta.title}」${doc.meta.board === '' ? '' : ` · 板卡 ${doc.meta.board}`} · rev ${doc.rev}`)
  if (project !== undefined) lines.push(`文件：${project.path}`)
  if (doc.parts.length === 0) {
    lines.push('还没有任何部件。用 hardware_map add_part 添加板卡/模块（ESP32: model=esp32-devkitc）。')
  } else {
    lines.push(`部件 ${doc.parts.length} 个：`)
    for (const part of doc.parts) lines.push(partsLine(part))
  }
  if (doc.nets.length === 0) {
    lines.push('还没有任何连线。用 hardware_map connect 连接两个引脚，节点写法是 "部件id:引脚名"。')
  } else {
    lines.push(`网络 ${doc.nets.length} 条：`)
    for (const net of doc.nets) lines.push(netsLine(net))
  }
  const connected = new Set(doc.nets.flatMap(net => net.nodes))
  const unconnected = doc.parts.flatMap(part => part.pins
    .map(pin => `${part.id}:${pin.name}`)
    .filter(node => !connected.has(node)))
  if (unconnected.length > 0) {
    const shown = unconnected.slice(0, 16)
    lines.push(`未连接的引脚（${unconnected.length} 个）：${shown.join(' ')}${unconnected.length > shown.length ? ' …' : ''}`)
  }
  if (doc.pending.length > 0) {
    lines.push(`待确认的改动建议 ${doc.pending.length} 条（由用户在接线页应用或忽略）：`)
    for (const pending of doc.pending) {
      lines.push(`  ${pending.id} ${pending.note} — ${pending.ops.map(op => op.type).join(', ')}`)
    }
  }
  lines.push(`校验：${counts.errors} 个错误，${counts.warnings} 个警告`)
  for (const item of diagnostics) lines.push(diagnosticLine(item))
  if (diagnostics.length === 0 && doc.parts.length > 0) lines.push('  （没有发现问题）')
  return lines.join('\n')
}

/** Counts only, for a project picker or a badge. */
export function diagnose(doc) {
  try {
    return validate(doc)
  } catch {
    return []
  }
}
