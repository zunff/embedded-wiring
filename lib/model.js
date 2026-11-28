/**
 * The project file is one netlist: parts with their pin tables, and nets that
 * join `part:pin` nodes. Everything the page draws and everything the agent
 * reads is derived from it; layout coordinates live here too but mean nothing
 * to the validator or the agent.
 *
 * Structural mistakes (unknown part, unknown pin, one pin on two nets) are
 * rejected before anything is written. Electrical problems (no common ground,
 * 5V on a 3.3V pin, two drivers on one net) are reported as diagnostics and
 * still saved: wiring is edited over time, and refusing to save a half-finished
 * net would make the file unusable.
 * @module @local/embedded-wiring/model
 */

import { partFromTemplate, templateOf } from './library.js'

export const SCHEMA_VERSION = 1

const ROLES = new Set(['power', 'ground', 'input', 'output', 'bidir', 'passive'])
const KINDS = new Set(['power', 'ground', 'signal', 'bus'])

const LIMITS = {
  parts: 120,
  nets: 400,
  pending: 20,
  text: 160,
  pins: 64,
  attrs: 12,
}

/** A structural refusal: the caller's ops cannot be applied at all. */
export class WiringError extends Error {
  constructor(message) {
    super(message)
    this.name = 'WiringError'
  }
}

function refuse(message) {
  throw new WiringError(message)
}

/** Trimmed, length-bounded display text. */
function text(value, fallback = '') {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (trimmed === '') return fallback
  return trimmed.slice(0, LIMITS.text)
}

/** Stable part id: lower-case words joined by `-`, never empty. */
function slug(value, fallback) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const cleaned = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return cleaned === '' ? fallback : cleaned
}

function uniqueId(doc, candidate, fallback) {
  const base = slug(candidate, fallback)
  const taken = new Set(doc.parts.map(part => part.id))
  if (!taken.has(base)) return base
  for (let index = 2; index < 1000; index += 1) {
    const next = `${base}-${index}`
    if (!taken.has(next)) return next
  }
  return `${base}-${Date.now()}`
}

function coordinate(value, fallback) {
  return Number.isFinite(value) ? Math.round(value) : fallback
}

/** Default layout slot: a four-column grid, filled in insertion order. */
function autoPosition(doc) {
  const index = doc.parts.length
  return [80 + (index % 4) * 280, 70 + Math.floor(index / 4) * 240]
}

function normalizePin(pin, index) {
  const name = text(pin?.name, `PIN${index + 1}`)
  const role = ROLES.has(pin?.role) ? pin.role : 'passive'
  const normalized = { name, role }
  if (pin?.side === 'left' || pin?.side === 'right') normalized.side = pin.side
  if (Number.isFinite(pin?.volt) && pin.volt > 0) normalized.volt = pin.volt
  if (Number.isFinite(pin?.maxVolt) && pin.maxVolt > 0) normalized.maxVolt = pin.maxVolt
  if (Array.isArray(pin?.accepts)) normalized.accepts = pin.accepts.filter(v => Number.isFinite(v)).slice(0, 4)
  if (Array.isArray(pin?.caps)) normalized.caps = pin.caps.filter(cap => typeof cap === 'string').slice(0, 8)
  if (typeof pin?.note === 'string' && pin.note.trim() !== '') normalized.note = text(pin.note)
  return normalized
}

/**
 * Pins belong to one edge of the card. A file written before edges existed, or
 * a hand-written part, gets its side from the template when the model is known;
 * otherwise modules hang their pins on the left and boards on the right.
 */
function inferSide(kind, pin, template) {
  if (pin.side === 'left' || pin.side === 'right') return pin.side
  const known = template?.pins.find(candidate => candidate.name === pin.name)
  if (known?.side === 'left' || known?.side === 'right') return known.side
  return kind === 'board' ? 'right' : 'left'
}

function normalizePart(part, index) {
  const id = slug(part?.id, `part-${index + 1}`)
  const kind = part?.kind === 'board' ? 'board' : 'module'
  const model = text(part?.model, 'custom')
  const template = templateOf(model)
  const pins = []
  const seen = new Set()
  for (const [pinIndex, pin] of (Array.isArray(part?.pins) ? part.pins : []).entries()) {
    const normalized = normalizePin(pin, pinIndex)
    if (seen.has(normalized.name)) continue
    seen.add(normalized.name)
    normalized.side = inferSide(kind, normalized, template)
    pins.push(normalized)
    if (pins.length >= LIMITS.pins) break
  }
  if (pins.length === 0) return undefined
  // Known models have a physical order; a hand-written or hand-arranged part
  // keeps the order it was given, which is the order the user or the photo
  // listed.
  if (template !== undefined && part?.pinsManual !== true) {
    const order = new Map(template.pins.map((candidate, position) => [candidate.name, position]))
    pins.sort((left, right) => (order.get(left.name) ?? LIMITS.pins) - (order.get(right.name) ?? LIMITS.pins))
  }
  const at = Array.isArray(part?.at) && part.at.length === 2
    ? [coordinate(part.at[0], 80), coordinate(part.at[1], 70)]
    : autoPosition({ parts: new Array(index) })
  return {
    id,
    model,
    kind,
    label: text(part?.label, id),
    at,
    pins,
    ...part?.source === 'photo' || part?.source === 'custom' ? { source: part.source } : {},
    ...part?.verified === true ? { verified: true } : {},
    ...typeof part?.flip === 'boolean' ? { flip: part.flip } : {},
    ...part?.pinsManual === true ? { pinsManual: true } : {},
    ...part?.pinsHand === true ? { pinsHand: true } : {},
    ...typeof part?.icon === 'string' && part.icon.trim() !== ''
      ? { icon: text(part.icon) }
      : template?.icon !== undefined ? { icon: template.icon } : {},
    ...typeof part?.note === 'string' && part.note.trim() !== '' ? { note: text(part.note) } : {},
  }
}

function normalizeNet(net, index) {
  const nodes = []
  const seen = new Set()
  for (const node of Array.isArray(net?.nodes) ? net.nodes : []) {
    if (typeof node !== 'string') continue
    const trimmed = text(node)
    if (trimmed === '' || seen.has(trimmed)) continue
    seen.add(trimmed)
    nodes.push(trimmed)
  }
  if (nodes.length === 0) return undefined
  const normalized = {
    id: text(net?.id, `n${index + 1}`),
    name: text(net?.name, `NET${index + 1}`),
    kind: KINDS.has(net?.kind) ? net.kind : 'signal',
    nodes,
  }
  if (Number.isFinite(net?.volt) && net.volt > 0) normalized.volt = net.volt
  if (typeof net?.protocol === 'string' && net.protocol.trim() !== '') normalized.protocol = text(net.protocol, '')
  const attrs = {}
  for (const [key, value] of Object.entries(net?.attrs !== null && typeof net?.attrs === 'object' ? net.attrs : {})) {
    if (Object.keys(attrs).length >= LIMITS.attrs) break
    if (typeof key === 'string' && key.trim() !== '' && (typeof value === 'string' || typeof value === 'number')) {
      attrs[text(key, '')] = String(value).slice(0, LIMITS.text)
    }
  }
  if (Object.keys(attrs).length > 0) normalized.attrs = attrs
  if (typeof net?.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(net.color)) normalized.color = net.color
  return normalized
}

function normalizePending(entry, index) {
  const ops = Array.isArray(entry?.ops) ? entry.ops.filter(op => op !== null && typeof op === 'object') : []
  if (ops.length === 0) return undefined
  return {
    id: text(entry?.id, `pending-${index + 1}`),
    note: text(entry?.note, '未命名的改动建议'),
    createdAt: text(entry?.createdAt, ''),
    ops,
  }
}

/** A brand-new project file. */
export function emptyDocument(meta = {}) {
  return {
    version: SCHEMA_VERSION,
    rev: 0,
    meta: {
      title: text(meta.title, '我的接线'),
      board: text(meta.board, ''),
      updatedAt: new Date().toISOString(),
    },
    parts: [],
    nets: [],
    pending: [],
  }
}

/** Coerce whatever is on disk into a usable document, dropping what cannot be repaired. */
export function normalizeDocument(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const doc = {
    version: SCHEMA_VERSION,
    rev: Number.isFinite(source.rev) ? Math.max(0, Math.trunc(source.rev)) : 0,
    meta: {
      title: text(source.meta?.title, '我的接线'),
      board: text(source.meta?.board, ''),
      updatedAt: text(source.meta?.updatedAt, ''),
    },
    parts: [],
    nets: [],
    pending: [],
  }
  for (const [index, part] of (Array.isArray(source.parts) ? source.parts : []).entries()) {
    if (doc.parts.length >= LIMITS.parts) break
    const normalized = normalizePart(part, index)
    if (normalized !== undefined && !doc.parts.some(existing => existing.id === normalized.id)) doc.parts.push(normalized)
  }
  for (const [index, net] of (Array.isArray(source.nets) ? source.nets : []).entries()) {
    if (doc.nets.length >= LIMITS.nets) break
    const normalized = normalizeNet(net, index)
    if (normalized !== undefined && !doc.nets.some(existing => existing.id === normalized.id)) doc.nets.push(normalized)
  }
  for (const [index, entry] of (Array.isArray(source.pending) ? source.pending : []).entries()) {
    if (doc.pending.length >= LIMITS.pending) break
    const normalized = normalizePending(entry, index)
    if (normalized !== undefined) doc.pending.push(normalized)
  }
  return doc
}

/** Deep copy: ops mutate a clone so a refused operation cannot half-apply. */
export function cloneDocument(doc) {
  return JSON.parse(JSON.stringify(doc))
}

/** The canonical node spelling: `part:pin`. */
export function nodeOf(partId, pinName) {
  return `${partId}:${pinName}`
}

/** Split a node back into its part and pin, or undefined when malformed. */
export function parseNode(node) {
  if (typeof node !== 'string') return undefined
  const index = node.indexOf(':')
  if (index <= 0 || index === node.length - 1) return undefined
  return { partId: node.slice(0, index), pin: node.slice(index + 1) }
}

export function findPart(doc, partId) {
  return doc.parts.find(part => part.id === partId)
}

export function findPin(part, pinName) {
  return part?.pins.find(pin => pin.name === pinName)
}

/** Part and pin behind a node, or undefined when the node is unknown. */
export function resolveNode(doc, node) {
  const parsed = parseNode(node)
  if (parsed === undefined) return undefined
  const part = findPart(doc, parsed.partId)
  if (part === undefined) return undefined
  const pin = findPin(part, parsed.pin)
  if (pin === undefined) return undefined
  return { part, pin, node }
}

/** The net a node belongs to, if any. */
export function netOfNode(doc, node) {
  return doc.nets.find(net => net.nodes.includes(node))
}

/** Every net that references a part. */
export function netsOfPart(doc, partId) {
  const prefix = `${partId}:`
  return doc.nets.filter(net => net.nodes.some(node => node.startsWith(prefix)))
}

function requireNode(doc, node) {
  const resolved = resolveNode(doc, node)
  if (resolved === undefined) refuse(`未知引脚：${node}（先 add_part，并确认引脚名与部件卡片一致）`)
  return resolved
}

/** Default net name and kind from the endpoints, so a bare connect is still readable. */
function describeConnection(doc, nodes) {
  const resolved = nodes.map(node => requireNode(doc, node))
  const power = resolved.find(entry => entry.pin.role === 'power')
  const ground = resolved.find(entry => entry.pin.role === 'ground')
  if (ground !== undefined) return { kind: 'ground', name: 'GND' }
  if (power !== undefined) {
    return {
      kind: 'power',
      name: power.pin.name,
      ...Number.isFinite(power.pin.volt) ? { volt: power.pin.volt } : {},
    }
  }
  const names = resolved.map(entry => entry.pin.name)
  return { kind: 'signal', name: [...new Set(names)].join('-') }
}

function nextNetId(doc) {
  const taken = new Set(doc.nets.map(net => net.id))
  for (let index = 1; index < LIMITS.nets + 1; index += 1) {
    if (!taken.has(`n${index}`)) return `n${index}`
  }
  return `n${Date.now()}`
}

function addPart(doc, op) {
  if (doc.parts.length >= LIMITS.parts) refuse(`部件数量已达上限 ${LIMITS.parts}`)
  const input = op.part !== null && typeof op.part === 'object' ? op.part : {}
  const explicitPins = Array.isArray(input.pins) && input.pins.length > 0
  const kind = input.kind === 'board' ? 'board' : 'module'
  const model = text(input.model, 'custom')
  const source = input.source === 'photo' ? 'photo' : input.source === 'custom' ? 'custom' : undefined
  let built
  if (explicitPins) {
    const template = templateOf(model)
    const id = uniqueId(doc, input.id ?? input.model, `part-${doc.parts.length + 1}`)
    const pins = input.pins.map((pin, index) => {
      const normalized = normalizePin(pin, index)
      normalized.side = inferSide(kind, normalized, template)
      return normalized
    })
    if (pins.length === 0) refuse('add_part 需要一个非空的 pins 列表')
    built = {
      id,
      model,
      kind,
      label: text(input.label, id),
      at: Array.isArray(input.at) && input.at.length === 2
        ? [coordinate(input.at[0], 80), coordinate(input.at[1], 70)]
        : autoPosition(doc),
      pins,
      ...source !== undefined ? { source } : {},
      ...input.verified === true ? { verified: true } : {},
      ...typeof input.icon === 'string' && input.icon.trim() !== '' ? { icon: text(input.icon) } : {},
      ...typeof input.note === 'string' && input.note.trim() !== '' ? { note: text(input.note) } : {},
      pinsManual: true,
    }
  } else {
    const id = uniqueId(doc, input.id ?? input.model, `part-${doc.parts.length + 1}`)
    const at = Array.isArray(input.at) && input.at.length === 2 ? input.at : undefined
    built = partFromTemplate(input.model, id, input.label, at ?? autoPosition(doc))
    if (built.at === undefined) built.at = autoPosition(doc)
    if (typeof input.note === 'string' && input.note.trim() !== '') built.note = text(input.note)
    if (source !== undefined) built.source = source
    if (input.verified === true) built.verified = true
  }
  doc.parts.push(built)
}

function updatePart(doc, op) {
  const part = findPart(doc, text(op.id, ''))
  if (part === undefined) refuse(`未知部件：${op.id}`)
  const patch = op.patch !== null && typeof op.patch === 'object' ? op.patch : {}
  if (typeof patch.label === 'string' && patch.label.trim() !== '') part.label = text(patch.label)
  if (typeof patch.icon === 'string' && patch.icon.trim() !== '') part.icon = text(patch.icon)
  if (patch.icon === null) delete part.icon
  if (typeof patch.note === 'string') {
    if (patch.note.trim() === '') delete part.note
    else part.note = text(patch.note)
  }
  if (Array.isArray(patch.at) && patch.at.length === 2) {
    part.at = [coordinate(patch.at[0], part.at[0]), coordinate(patch.at[1], part.at[1])]
  }
  // Swapping the board model keeps every net whose pin still exists on the new
  // board and drops the rest, so a 30-pin board can become a SuperMini without
  // losing 3V3/GND/signal wires that survive the change.
  if (typeof patch.model === 'string' && patch.model.trim() !== '' && patch.model !== part.model) {
    const template = templateOf(patch.model)
    if (template === undefined) refuse(`未知的硬件型号：${patch.model}`)
    const previous = templateOf(part.model)
    const nextPins = template.pins.map(pin => ({
      ...pin,
      side: pin.side ?? (template.kind === 'board' ? 'right' : 'left'),
    }))
    part.pins = nextPins
    part.model = patch.model
    part.kind = template.kind
    if (template.note !== undefined) part.note = template.note
    // A title the user chose is theirs; one that still matches the old
    // template's name follows the new template, so no card says "C3-DevKitC"
    // while its pins are a SuperMini.
    if (previous !== undefined && part.label === previous.label && typeof template.label === 'string') {
      part.label = template.label
    }
    const names = new Set(nextPins.map(pin => pin.name))
    doc.nets = doc.nets.filter(net => !net.nodes.some(node => {
      const parsed = parseNode(node)
      return parsed !== undefined && parsed.partId === part.id && !names.has(parsed.pin)
    }))
  }
  if (Array.isArray(patch.pins) && patch.pins.length > 0) {
    const template = templateOf(part.model)
    const names = new Set()
    const pins = []
    for (const [index, pin] of patch.pins.entries()) {
      const normalized = normalizePin(pin, index)
      if (names.has(normalized.name)) refuse(`引脚名重复：${normalized.name}`)
      normalized.side = inferSide(part.kind, normalized, template)
      names.add(normalized.name)
      pins.push(normalized)
    }
    // Pins that disappear take their nets with them; keeping a dangling node
    // would make the file invalid on the next read.
    for (const net of netsOfPart(doc, part.id)) {
      if (net.nodes.some(node => parseNode(node)?.partId === part.id && !names.has(parseNode(node).pin))) {
        doc.nets = doc.nets.filter(candidate => candidate.id !== net.id)
      }
    }
    part.pins = pins
    // Someone just placed these pins by hand; keep their order on later reads…
    part.pinsManual = true
    // …and, when the page did it, their edges too: a hand-split part is the
    // user's layout and "一键整理" leaves it alone. An explicit pin list from
    // `add_part` or a photo is not a hand layout, so it stays free to re-split.
    if (patch.hand === true) part.pinsHand = true
  }
  if (typeof patch.source === 'string' && (patch.source === 'photo' || patch.source === 'custom')) part.source = patch.source
  if (patch.source === null) delete part.source
  if (patch.verified === true) part.verified = true
  if (patch.verified === false) delete part.verified
  if (typeof patch.kind === 'string' && (patch.kind === 'board' || patch.kind === 'module')) part.kind = patch.kind
}

function removePart(doc, op) {
  const id = text(op.id, '')
  if (findPart(doc, id) === undefined) refuse(`未知部件：${id}`)
  doc.parts = doc.parts.filter(part => part.id !== id)
  doc.nets = doc.nets.filter(net => !net.nodes.some(node => parseNode(node)?.partId === id))
  for (const pending of doc.pending) {
    pending.ops = pending.ops.filter(candidate => !JSON.stringify(candidate).includes(`"${id}`))
  }
  doc.pending = doc.pending.filter(pending => pending.ops.length > 0)
}

function connect(doc, op) {
  const nodes = Array.isArray(op.nodes) ? op.nodes.map(node => text(node, '')).filter(node => node !== '') : []
  if (nodes.length < 2) refuse('connect 至少需要两个引脚节点，例如 ["mcu:GPIO4","dht:DATA"]')
  for (const node of nodes) requireNode(doc, node)
  // A pin belongs to exactly one net, so connecting to a wired pin is not a new
  // net: it joins the net that pin is already on, and two wired pins join (merge)
  // their nets. This is how a new module joins GND, which is the gesture the page
  // draws when you drag from a free pin onto a used one.
  const hosts = []
  for (const node of nodes) {
    const net = netOfNode(doc, node)
    if (net !== undefined && !hosts.includes(net)) hosts.push(net)
  }
  const netInput = op.net !== null && typeof op.net === 'object' ? op.net : {}
  if (hosts.length === 0) {
    if (doc.nets.length >= LIMITS.nets) refuse(`网络数量已达上限 ${LIMITS.nets}`)
    const defaults = describeConnection(doc, nodes)
    const net = {
      id: nextNetId(doc),
      name: text(netInput.name, defaults.name),
      kind: KINDS.has(netInput.kind) ? netInput.kind : defaults.kind,
      nodes,
      ...Number.isFinite(netInput.volt) ? { volt: netInput.volt } : defaults.volt !== undefined ? { volt: defaults.volt } : {},
      ...typeof netInput.protocol === 'string' && netInput.protocol.trim() !== '' ? { protocol: text(netInput.protocol, '') } : {},
      ...netInput.attrs !== null && typeof netInput.attrs === 'object' ? { attrs: { ...netInput.attrs } } : {},
      ...typeof netInput.color === 'string' ? { color: netInput.color } : {},
    }
    doc.nets.push(normalizeNet(net, doc.nets.length))
    return
  }
  const target = hosts[0]
  const added = []
  for (const node of nodes) {
    if (target.nodes.includes(node)) continue
    target.nodes.push(node)
    added.push(node)
  }
  const merged = hosts.slice(1)
  for (const net of merged) {
    for (const node of net.nodes) {
      if (target.nodes.includes(node)) continue
      target.nodes.push(node)
    }
  }
  if (merged.length > 0) {
    const gone = new Set(merged.map(net => net.id))
    doc.nets = doc.nets.filter(net => !gone.has(net.id))
  }
  if (added.length === 0 && merged.length === 0) refuse(`这些引脚本来就连在「${target.name}」上`)
  if (typeof netInput.name === 'string' && netInput.name.trim() !== '') target.name = text(netInput.name)
  if (typeof netInput.kind === 'string' && KINDS.has(netInput.kind)) target.kind = netInput.kind
  if (typeof netInput.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(netInput.color)) target.color = netInput.color
}

function disconnect(doc, op) {
  const id = text(op.netId ?? op.id, '')
  const net = doc.nets.find(candidate => candidate.id === id)
  if (net === undefined) refuse(`未知网络：${id}`)
  doc.nets = doc.nets.filter(candidate => candidate.id !== net.id)
}

function unlink(doc, op) {
  const node = text(op.node, '')
  const net = netOfNode(doc, node)
  if (net === undefined) refuse(`引脚 ${node} 不在任何网络上`)
  if (net.nodes.length <= 2) doc.nets = doc.nets.filter(candidate => candidate.id !== net.id)
  else net.nodes = net.nodes.filter(candidate => candidate !== node)
}

function setNet(doc, op) {
  const net = doc.nets.find(candidate => candidate.id === text(op.netId ?? op.id, ''))
  if (net === undefined) refuse(`未知网络：${op.netId ?? op.id}`)
  const patch = op.patch !== null && typeof op.patch === 'object' ? op.patch : {}
  if (typeof patch.name === 'string' && patch.name.trim() !== '') net.name = text(patch.name)
  if (typeof patch.kind === 'string' && KINDS.has(patch.kind)) net.kind = patch.kind
  if (Number.isFinite(patch.volt) && patch.volt > 0) net.volt = patch.volt
  else if (patch.volt === null) delete net.volt
  if (typeof patch.protocol === 'string') {
    if (patch.protocol.trim() === '') delete net.protocol
    else net.protocol = text(patch.protocol)
  }
  if (patch.attrs !== null && typeof patch.attrs === 'object') net.attrs = { ...patch.attrs }
  if (patch.attrs === null) delete net.attrs
  if (typeof patch.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(patch.color)) net.color = patch.color
  if (Array.isArray(patch.nodes)) {
    const nodes = patch.nodes.map(node => text(node, '')).filter(node => node !== '')
    for (const node of nodes) requireNode(doc, node)
    net.nodes = nodes
  }
}

function movePart(doc, op) {
  const part = findPart(doc, text(op.id, ''))
  if (part === undefined) refuse(`未知部件：${op.id}`)
  const at = Array.isArray(op.at) ? op.at : []
  if (at.length !== 2 || !Number.isFinite(at[0]) || !Number.isFinite(at[1])) refuse('move 需要 at: [x, y]')
  part.at = [coordinate(at[0], part.at[0]), coordinate(at[1], part.at[1])]
}

/**
 * Mirror the symbol: the pins move to the other edge, the wiring does not move.
 * `flip: null` clears the override, so the page goes back to guessing the
 * orientation from where the part's neighbours are.
 */
function flipPart(doc, op) {
  const part = findPart(doc, text(op.id, ''))
  if (part === undefined) refuse(`未知部件：${op.id}`)
  if (op.flip === null) delete part.flip
  else part.flip = op.flip !== false
}

/**
 * Move pins between the two edges without touching the wiring, the reason being
 * that a module's header can be drawn either way: a boost converter's input can
 * sit on the left edge and its output on the right, which is how the thing is
 * actually built. Only the edge changes, so the pin order on each edge and every
 * net stay exactly as they are.
 */
function setPinSides(doc, op) {
  const part = findPart(doc, text(op.id, ''))
  if (part === undefined) refuse(`未知部件：${op.id}`)
  const sides = op.sides !== null && typeof op.sides === 'object' ? op.sides : {}
  let touched = 0
  for (const pin of part.pins) {
    const side = sides[pin.name]
    if (side !== 'left' && side !== 'right') continue
    if (pin.side === side) continue
    pin.side = side
    touched += 1
  }
  if (touched === 0) refuse(`部件 ${part.id} 的引脚没有变化`)
}

function setMeta(doc, op) {
  const patch = op.patch !== null && typeof op.patch === 'object' ? op.patch : {}
  if (typeof patch.title === 'string' && patch.title.trim() !== '') doc.meta.title = text(patch.title)
  if (typeof patch.note === 'string') doc.meta.note = text(patch.note)
  if (typeof patch.board === 'string') doc.meta.board = text(patch.board)
}

const MUTATIONS = {
  add_part: addPart,
  update_part: updatePart,
  remove_part: removePart,
  connect,
  disconnect,
  unlink,
  set_net: setNet,
  move: movePart,
  flip: flipPart,
  set_pin_sides: setPinSides,
  set_meta: setMeta,
}

/** Apply one op batch to a clone; throws WiringError on the first structural problem. */
export function applyOps(doc, ops) {
  if (!Array.isArray(ops) || ops.length === 0) refuse('没有任何操作')
  // One tidy pass moves every card and re-splits its pins, so the ceiling is
  // per part rather than per user gesture.
  if (ops.length > 200) refuse('一次最多应用 200 个操作')
  const next = cloneDocument(doc)
  for (const op of ops) {
    const mutation = MUTATIONS[op?.type]
    if (mutation === undefined) refuse(`未知操作：${op?.type}（支持 ${Object.keys(MUTATIONS).join(' / ')}）`)
    mutation(next, op)
  }
  return next
}

/** Queue an agent's proposal; ops are dry-run first so a proposal cannot be born broken. */
export function propose(doc, { note, ops }) {
  if (doc.pending.length >= LIMITS.pending) refuse(`待确认的建议已达上限 ${LIMITS.pending}`)
  applyOps(doc, ops)
  for (const pending of doc.pending) {
    if (JSON.stringify(pending.ops) === JSON.stringify(ops)) refuse('这个建议已经在待确认列表里了')
  }
  doc.pending.push({
    id: `pending-${Date.now().toString(36)}`,
    note: text(note, '未命名的改动建议'),
    createdAt: new Date().toISOString(),
    ops,
  })
}

/** Apply (and remove) one pending suggestion, all of them, or none when `id` is absent. */
export function applyPending(doc, id) {
  const targets = id === undefined || id === ''
    ? [...doc.pending]
    : doc.pending.filter(pending => pending.id === text(id, ''))
  if (targets.length === 0) refuse('没有待确认的建议')
  let next = doc
  for (const pending of targets) next = applyOps(next, pending.ops)
  const removed = new Set(targets.map(pending => pending.id))
  next.pending = next.pending.filter(pending => !removed.has(pending.id))
  return next
}

/** Drop one pending suggestion, or every suggestion when `id` is absent. */
export function discardPending(doc, id) {
  const before = doc.pending.length
  doc.pending = id === undefined || id === '' ? [] : doc.pending.filter(pending => pending.id !== text(id, ''))
  if (doc.pending.length === before) refuse('没有待确认的建议')
}
