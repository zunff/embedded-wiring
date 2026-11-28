/**
 * Host-side smoke test: no DSH services, just the pure model and validator.
 * Run with `node test/smoke.mjs` from the package directory.
 *
 * @module @local/embedded-wiring/test/smoke
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { catalog, partFromTemplate } from '../lib/library.js'
import {
  applyOps,
  applyPending,
  discardPending,
  emptyDocument,
  normalizeDocument,
  propose,
} from '../lib/model.js'
import { createProjectStore } from '../lib/store.js'
import { validate } from '../lib/validate.js'
import { summaryText } from '../lib/format.js'

function board() {
  const doc = emptyDocument({ title: '测试' })
  doc.parts.push(partFromTemplate('esp32-devkitc', 'mcu', 'ESP32 DevKitC', [80, 90]))
  return doc
}

function withPart(doc, model, id) {
  return applyOps(doc, [{ type: 'add_part', part: { model, id } }])
}

function codes(diagnostics) {
  return diagnostics.map(item => `${item.severity}:${item.code}`)
}

// 1. A board alone is clean and produces a usable summary.
{
  const doc = board()
  assert.deepEqual(validate(doc), [])
  const text = summaryText({ project: { path: 'C:/x/hardware/wiring.json' }, doc, diagnostics: [] })
  assert.match(text, /ESP32 DevKitC/)
  assert.match(text, /未连接的引脚/)
}

// 1b. The board carries the physical two-column layout, left first.
{
  const doc = board()
  const left = doc.parts[0].pins.filter(pin => pin.side === 'left')
  const right = doc.parts[0].pins.filter(pin => pin.side === 'right')
  assert.equal(left.length, 19)
  assert.equal(right.length, 19)
  assert.deepEqual(left.slice(0, 2).map(pin => pin.name), ['3V3', 'EN'])
  assert.equal(left[left.length - 1].name, '5V')
  assert.equal(right[0].name, 'GND2')
  assert.equal(right[right.length - 1].name, 'GPIO6')
}

// 1c. A file written before edges existed gains them from the library, in the
//     library's physical order.
{
  const legacy = {
    version: 1,
    rev: 3,
    meta: { title: 'legacy' },
    parts: [{
      id: 'mcu',
      model: 'esp32-devkitc',
      kind: 'board',
      label: 'ESP32',
      at: [0, 0],
      pins: [
        { name: 'GPIO4', role: 'bidir' },
        { name: '3V3', role: 'power', volt: 3.3 },
        { name: '5V', role: 'power', volt: 5 },
      ],
    }],
    nets: [],
  }
  const doc = normalizeDocument(legacy)
  const pins = doc.parts[0].pins
  assert.deepEqual(pins.map(pin => [pin.name, pin.side]), [['3V3', 'left'], ['5V', 'left'], ['GPIO4', 'right']])
}

// 1d. A photo-recognized part stays flagged until it is verified.
{
  const doc = applyOps(board(), [{
    type: 'add_part',
    part: {
      id: 'sen',
      model: 'custom',
      label: '照片里的模块',
      source: 'photo',
      pins: [
        { name: 'VCC', role: 'power', volt: 3.3, maxVolt: 5 },
        { name: 'OUT', role: 'output' },
        { name: 'GND', role: 'ground' },
      ],
    },
  }])
  assert.ok(codes(validate(doc)).includes('warning:photo-unverified'))
  assert.equal(doc.parts[1].pins[0].side, 'left')
  assert.match(summaryText({ doc, diagnostics: validate(doc) }), /照片识别·待核对/)
  const verified = applyOps(doc, [{ type: 'update_part', id: 'sen', patch: { verified: true } }])
  assert.ok(!codes(validate(verified)).includes('warning:photo-unverified'))
  assert.match(summaryText({ doc: verified, diagnostics: validate(verified) }), /照片识别·已核对/)
}

// 1e. Every shipped board has unique pin names, both edges, and a clean
//     standalone validation (no accidental duplicate GND rows).
{
  const boards = [
    ['esp32-devkitc', 38, 19, 19],
    ['esp32-devkitc-30', 30, 15, 15],
    ['esp32-c3-devkitc-02', 30, 15, 15],
    ['esp32-c3-devkitm-1', 30, 15, 15],
    ['esp32-c3-supermini', 16, 8, 8],
    ['esp32-s3-devkitc-1', 44, 22, 22],
  ]
  for (const [model, total, leftCount, rightCount] of boards) {
    const doc = emptyDocument({ title: model })
    doc.parts.push(partFromTemplate(model, 'mcu', model, [0, 0]))
    const pins = doc.parts[0].pins
    assert.equal(pins.length, total, `${model} pin count`)
    assert.equal(pins.filter(pin => pin.side === 'left').length, leftCount, `${model} left`)
    assert.equal(pins.filter(pin => pin.side === 'right').length, rightCount, `${model} right`)
    const names = new Set(pins.map(pin => pin.name))
    assert.equal(names.size, total, `${model} unique pin names`)
    assert.deepEqual(validate(doc), [], `${model} standalone validation`)
  }
}

// 1f. C3 strapping pins and S3 flash-reserved pins are reported when used.
{
  let doc = emptyDocument({ title: 'c3' })
  doc.parts.push(partFromTemplate('esp32-c3-devkitc-02', 'mcu', 'C3', [0, 0]))
  doc.parts.push(partFromTemplate('dht22', 'dht', 'DHT22', [400, 0]))
  doc = applyOps(doc, [{ type: 'connect', nodes: ['mcu:3V3', 'dht:VCC'] }])
  doc = applyOps(doc, [{ type: 'connect', nodes: ['mcu:GND', 'dht:GND'] }])
  doc = applyOps(doc, [{ type: 'connect', nodes: ['mcu:GPIO9', 'dht:DATA'] }])
  const found = codes(validate(doc))
  assert.ok(found.includes('warning:strapping'), found.join(','))

  let s3 = emptyDocument({ title: 's3' })
  s3.parts.push(partFromTemplate('esp32-s3-devkitc-1', 'mcu', 'S3', [0, 0]))
  s3.parts.push(partFromTemplate('dht22', 'dht', 'DHT22', [400, 0]))
  s3 = applyOps(s3, [{ type: 'connect', nodes: ['mcu:3V3', 'dht:VCC'] }])
  s3 = applyOps(s3, [{ type: 'connect', nodes: ['mcu:GND', 'dht:GND'] }])
  s3 = applyOps(s3, [{ type: 'connect', nodes: ['mcu:GPIO35', 'dht:DATA'] }])
  const s3Codes = codes(validate(s3))
  assert.ok(s3Codes.includes('warning:reserved-pin'), s3Codes.join(','))

  const text = summaryText({ doc: s3, diagnostics: validate(s3) })
  assert.match(text, /板卡注意引脚/)
  assert.match(text, /GPIO35/)
  assert.match(text, /备注：3\.3V 逻辑/)
}

// 1g. Swapping the board model keeps wires whose pins survive and drops the rest.
{
  let doc = emptyDocument({ title: 'swap' })
  doc.parts.push(partFromTemplate('esp32-devkitc', 'mcu', '', [0, 0]))
  doc.parts.push(partFromTemplate('dht22', 'dht', 'DHT22', [400, 0]))
  doc = applyOps(doc, [{ type: 'connect', nodes: ['mcu:3V3', 'dht:VCC'] }])
  doc = applyOps(doc, [{ type: 'connect', nodes: ['mcu:GND', 'dht:GND'] }])
  doc = applyOps(doc, [{ type: 'connect', nodes: ['mcu:GPIO36', 'dht:DATA'] }])
  assert.equal(doc.nets.length, 3)
  const swapped = applyOps(doc, [{ type: 'update_part', id: 'mcu', patch: { model: 'esp32-c3-supermini' } }])
  assert.equal(swapped.parts[0].model, 'esp32-c3-supermini')
  assert.equal(swapped.parts[0].label, 'ESP32-C3 SuperMini', 'a template label follows the model')
  assert.equal(swapped.parts[0].pins.length, 16)
  assert.equal(swapped.nets.length, 2, 'the GPIO36 net must be dropped')
  assert.ok(swapped.nets.some(net => net.name === '3V3'))
  assert.ok(swapped.nets.some(net => net.name === 'GND'))
  assert.ok(!swapped.nets.some(net => net.nodes.includes('mcu:GPIO36')))
}

// 2. A correct DHT22 hookup validates clean.
{
  let doc = withPart(board(), 'dht22', 'dht')
  doc = applyOps(doc, [{ type: 'connect', nodes: ['mcu:3V3', 'dht:VCC'] }])
  doc = applyOps(doc, [{ type: 'connect', nodes: ['mcu:GND', 'dht:GND'] }])
  doc = applyOps(doc, [{ type: 'connect', nodes: ['mcu:GPIO4', 'dht:DATA'] }])
  assert.deepEqual(validate(doc), [])
  assert.equal(doc.nets[0].kind, 'power')
  assert.equal(doc.nets[0].name, '3V3')
  assert.equal(doc.nets[0].volt, 3.3)
  assert.equal(doc.nets[1].kind, 'ground')
  assert.equal(doc.nets[2].kind, 'signal')
  assert.match(summaryText({ doc, diagnostics: validate(doc) }), /mcu:GPIO4 → dht:DATA/)
}

// 3. A module connected without ground is an error, not a warning.
{
  let doc = withPart(board(), 'dht22', 'dht')
  doc = applyOps(doc, [{ type: 'connect', nodes: ['mcu:3V3', 'dht:VCC'] }])
  doc = applyOps(doc, [{ type: 'connect', nodes: ['mcu:GPIO4', 'dht:DATA'] }])
  const found = codes(validate(doc))
  assert.ok(found.includes('error:no-ground'), found.join(','))
}

// 3b. A board's GND pins are one copper pour: two modules grounded through
//     different GND header pins are still common ground, while two islands are
//     still an error.
{
  const mcu = {
    id: 'mcu',
    kind: 'board',
    label: '开发板',
    pins: [
      { name: 'GND', role: 'ground' },
      { name: 'GND2', role: 'ground' },
      { name: 'GPIO4', role: 'bidir' },
      { name: 'GPIO5', role: 'bidir' },
    ],
  }
  const module = id => ({
    id,
    kind: 'module',
    label: id,
    pins: [{ name: 'GND', role: 'ground' }, { name: 'SIG', role: 'bidir' }],
  })
  const both = applyOps(normalizeDocument({ parts: [mcu, module('a'), module('b')], nets: [] }), [
    { type: 'connect', nodes: ['mcu:GND', 'a:GND'] },
    { type: 'connect', nodes: ['mcu:GND2', 'b:GND'] },
    { type: 'connect', nodes: ['a:SIG', 'mcu:GPIO4'] },
    { type: 'connect', nodes: ['b:SIG', 'mcu:GPIO5'] },
  ])
  assert.deepEqual(codes(validate(both)).filter(code => code.includes('ground')), [], 'different GND pins are common ground')

  const island = applyOps(normalizeDocument({ parts: [mcu, module('a'), module('b'), module('c')], nets: [] }), [
    { type: 'connect', nodes: ['mcu:GND', 'a:GND'] },
    { type: 'connect', nodes: ['b:GND', 'c:GND'] },
    { type: 'connect', nodes: ['a:SIG', 'mcu:GPIO4'] },
    { type: 'connect', nodes: ['b:SIG', 'c:SIG'] },
  ])
  assert.ok(codes(validate(island)).includes('error:not-common-ground'), 'two islands are still reported')
}

// 4. 5V on a 3.3V-only module pin is an over-voltage error.
{
  let doc = withPart(board(), 'sdcard', 'sd')
  doc = applyOps(doc, [{ type: 'connect', nodes: ['mcu:5V', 'sd:VCC'] }])
  const found = codes(validate(doc))
  assert.ok(found.some(code => code.endsWith('over-voltage')), found.join(','))
}

// 5. Two outputs on one net is a multi-driver error.
{
  let doc = withPart(withPart(board(), 'hcsr04', 'sonar'), 'sdcard', 'sd')
  doc = applyOps(doc, [{ type: 'connect', nodes: ['sonar:ECHO', 'sd:MISO'] }])
  const found = codes(validate(doc))
  assert.ok(found.includes('error:multi-driver'), found.join(','))
}

// 6. Mixing 3V3 and 5V rails is refused by the validator.
{
  let doc = withPart(board(), 'dht22', 'dht')
  doc = applyOps(doc, [{ type: 'connect', nodes: ['mcu:3V3', 'mcu:5V', 'dht:VCC'], net: { name: 'MIX' } }])
  const found = codes(validate(doc))
  assert.ok(found.includes('error:rail-mix'), found.join(','))
}

// 7. Connecting to a wired pin joins its net instead of refusing, and two nets
//    merge into one — that is how a module joins GND.
{
  let doc = withPart(board(), 'dht22', 'dht')
  doc = applyOps(doc, [{ type: 'connect', nodes: ['mcu:GPIO4', 'dht:DATA'] }])
  const joined = applyOps(doc, [{ type: 'connect', nodes: ['mcu:GPIO4', 'dht:VCC'] }])
  assert.equal(joined.nets.length, 1)
  assert.deepEqual(joined.nets[0].nodes, ['mcu:GPIO4', 'dht:DATA', 'dht:VCC'])
  assert.throws(
    () => applyOps(joined, [{ type: 'connect', nodes: ['mcu:GPIO4', 'dht:DATA'] }]),
    /本来就连在/,
    'a no-op connect says so instead of inventing a second net',
  )

  let two = withPart(board(), 'dht22', 'dht')
  two = applyOps(two, [{ type: 'connect', nodes: ['mcu:GND', 'dht:GND'] }])
  two = applyOps(two, [{ type: 'connect', nodes: ['mcu:GND2', 'dht:VCC'] }])
  assert.equal(two.nets.length, 2)
  const merged = applyOps(two, [{ type: 'connect', nodes: ['dht:GND', 'dht:VCC'] }])
  assert.equal(merged.nets.length, 1, 'the two nets became one')
  assert.deepEqual(merged.nets[0].nodes, ['mcu:GND', 'dht:GND', 'dht:VCC', 'mcu:GND2'])
  assert.deepEqual(validate(merged).map(item => item.code).filter(code => code === 'pin-twice'), [])
  // The net that survives keeps its identity, so a merge never renames GND.
  assert.equal(merged.nets[0].name, 'GND')
  assert.equal(merged.nets[0].kind, 'ground')
}

// 8. Pending proposals dry-run, then apply or discard.
{
  let doc = withPart(board(), 'dht22', 'dht')
  doc = applyOps(doc, [{ type: 'connect', nodes: ['mcu:3V3', 'dht:VCC'] }])
  propose(doc, {
    note: '把 DHT22 的数据线接到 GPIO4',
    ops: [{ type: 'connect', nodes: ['mcu:GPIO4', 'dht:DATA'] }],
  })
  assert.throws(() => propose(doc, { note: '坏建议', ops: [{ type: 'connect', nodes: ['mcu:GPIO4', 'nope:X'] }] }), /未知引脚/)
  assert.equal(doc.pending.length, 1)
  assert.match(summaryText({ doc, diagnostics: [] }), /待确认的改动建议 1 条/)
  assertsPending(doc)
  const applied = applyPending(doc, doc.pending[0].id)
  assert.equal(applied.pending.length, 0)
  assert.ok(applied.nets.some(net => net.nodes.includes('dht:DATA')))

  const discarded = cloneForDiscard(doc)
  discardPending(discarded, '')
  assert.equal(discarded.pending.length, 0)
}

// 9. The file round-trips through the store with a bumped rev, and a stale
//    conflict is detectable by comparing revs.
{
  const dir = await mkdtemp(path.join(tmpdir(), 'ew-'))
  try {
    const store = createProjectStore(path.join(dir, 'hardware', 'wiring.json'))
    const created = await store.update(base => {
      base.parts.push(partFromTemplate('esp32-devkitc', 'mcu', 'ESP32 DevKitC', [80, 90]))
      return base
    })
    assert.equal(created.rev, 1)
    const second = await store.update(base => applyOps(base, [{ type: 'connect', nodes: ['mcu:3V3', 'mcu:GND'] }]))
    assert.equal(second.rev, 2)
    const raw = JSON.parse(await readFile(path.join(dir, 'hardware', 'wiring.json'), 'utf8'))
    assert.equal(raw.rev, 2)
    assert.equal(normalizeDocument(raw).nets.length, 1)
    const reread = await store.read()
    assert.equal(reread.exists, true)
    assert.equal(reread.doc.nets[0].nodes.length, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// 10. Flipping a part is layout only: the pins change edge, the wires stay.
{
  let doc = withPart(board(), 'dht22', 'dht')
  doc = applyOps(doc, [{ type: 'connect', nodes: ['mcu:GPIO4', 'dht:DATA'] }])
  const flipped = applyOps(doc, [{ type: 'flip', id: 'dht' }])
  assert.equal(flipped.parts.find(part => part.id === 'dht').flip, true)
  assert.deepEqual(flipped.nets, doc.nets)
  assert.equal(normalizeDocument(JSON.parse(JSON.stringify(flipped))).parts.find(part => part.id === 'dht').flip, true)
  // `flip: false` is a real value (pin orientation locked), `null` goes back to auto.
  const locked = applyOps(flipped, [{ type: 'flip', id: 'dht', flip: false }])
  assert.equal(locked.parts.find(part => part.id === 'dht').flip, false)
  assert.equal(normalizeDocument(JSON.parse(JSON.stringify(locked))).parts.find(part => part.id === 'dht').flip, false)
  const auto = applyOps(locked, [{ type: 'flip', id: 'dht', flip: null }])
  assert.equal(auto.parts.find(part => part.id === 'dht').flip, undefined)
  assert.throws(() => applyOps(doc, [{ type: 'flip', id: 'nope' }]), /未知部件/)
}

// 11. The library ships icons and the audio/motor parts a page needs, and an
//     icon survives the file round-trip.
{
  const library = catalog()
  const models = library.parts.map(part => part.model)
  for (const model of ['inmp441', 'max98357a', 'mx1508', 'n20', 'speaker']) {
    assert.ok(models.includes(model), `${model} is in the palette`)
  }
  assert.equal(library.parts.find(part => part.model === 'max98357a').icon, '📢')
  assert.ok(library.boards.every(board => typeof board.icon === 'string'), 'every board has an icon')
  assert.equal(partFromTemplate('inmp441', 'mic', '', [10, 20]).icon, '🎤')
  assert.equal(normalizeDocument({ parts: [partFromTemplate('n20', 'motor', '', [0, 0])] }).parts[0].icon, '⚙️')

  const custom = applyOps(emptyDocument(), [{
    type: 'add_part',
    part: { id: 'rig', icon: '🔧', pins: [{ name: 'A', role: 'passive' }, { name: 'B', role: 'passive' }] },
  }])
  assert.equal(custom.parts[0].icon, '🔧')
  assert.equal(normalizeDocument(JSON.parse(JSON.stringify(custom))).parts[0].icon, '🔧')
}

// 12. Pins can be placed by hand: which edge they sit on and the order they
//     appear in survive the file round-trip.
{
  const doc = withPart(board(), 'ssd1306', 'oled')
  const part = doc.parts[1]
  const pins = part.pins.map((pin, index) => ({ ...pin, side: index === 0 ? 'right' : 'left' }))
  const edited = applyOps(doc, [{ type: 'update_part', id: 'oled', patch: { pins, hand: true } }])
  const oled = edited.parts.find(candidate => candidate.id === 'oled')
  assert.equal(oled.pinsManual, true)
  assert.equal(oled.pinsHand, true, 'the page marks a hand layout')
  assert.equal(oled.pins[0].side, 'right')

  const reordered = [oled.pins[2], oled.pins[0], oled.pins[1], oled.pins[3]].map(pin => ({ ...pin }))
  const shuffled = applyOps(edited, [{ type: 'update_part', id: 'oled', patch: { pins: reordered, hand: true } }])
  const reloaded = normalizeDocument(JSON.parse(JSON.stringify(shuffled))).parts.find(candidate => candidate.id === 'oled')
  assert.deepEqual(reloaded.pins.map(pin => pin.name), ['SCL', 'VCC', 'GND', 'SDA'])
  assert.equal(reloaded.pinsManual, true)
  assert.equal(reloaded.pinsHand, true)

  // A pin list that came from a model or a photo is not a hand layout.
  const fromModel = applyOps(board(), [{ type: 'add_part', part: { model: 'ssd1306', id: 'oled2' } }])
  assert.equal(fromModel.parts[1].pinsManual, undefined)
  assert.equal(fromModel.parts[1].pinsHand, undefined)
}

// 13. Splitting a module's pins between its edges is layout only: the nets stay,
//     the order stays, and the part is still free to follow its template.
{
  let doc = withPart(board(), 'dht22', 'dht')
  doc = applyOps(doc, [{ type: 'connect', nodes: ['mcu:GPIO4', 'dht:DATA'] }])
  const before = doc.parts.find(part => part.id === 'dht')
  const pinsBefore = before.pins.map(pin => pin.name)
  const split = applyOps(doc, [{
    type: 'set_pin_sides',
    id: 'dht',
    sides: { VCC: 'left', GND: 'right', DATA: 'right' },
  }])
  const after = split.parts.find(part => part.id === 'dht')
  assert.deepEqual(after.pins.map(pin => pin.name), pinsBefore, 'the pin order does not change')
  assert.deepEqual(after.pins.map(pin => pin.side), ['left', 'right', 'right'])
  assert.equal(after.pinsManual, undefined, 'a split is not a hand-placed layout')
  assert.deepEqual(split.nets, doc.nets)
  const reloaded = normalizeDocument(JSON.parse(JSON.stringify(split))).parts.find(part => part.id === 'dht')
  assert.deepEqual(reloaded.pins.map(pin => pin.side), ['left', 'right', 'right'])
  assert.throws(() => applyOps(split, [{ type: 'set_pin_sides', id: 'dht', sides: { VCC: 'left' } }]), /没有变化/)
  assert.throws(() => applyOps(split, [{ type: 'set_pin_sides', id: 'nope', sides: { VCC: 'left' } }]), /未知部件/)
}

// 14. A drawn wire is remembered on the net, survives a merge, and is dropped
//     when a pin leaves the net or the file names a pin that is gone.
{
  let doc = withPart(board(), 'dht22', 'dht')
  doc = applyOps(doc, [{ type: 'connect', nodes: ['mcu:GPIO4', 'dht:DATA'] }])
  assert.deepEqual(doc.nets[0].wires, [['mcu:GPIO4', 'dht:DATA']])
  const joined = applyOps(doc, [{ type: 'connect', nodes: ['mcu:GPIO4', 'dht:VCC'] }])
  assert.deepEqual(joined.nets[0].wires, [['mcu:GPIO4', 'dht:DATA'], ['mcu:GPIO4', 'dht:VCC']])

  let two = withPart(board(), 'dht22', 'dht')
  two = applyOps(two, [{ type: 'connect', nodes: ['mcu:GND', 'dht:GND'] }])
  two = applyOps(two, [{ type: 'connect', nodes: ['mcu:GND2', 'dht:VCC'] }])
  two = applyOps(two, [{ type: 'connect', nodes: ['mcu:GND', 'mcu:GND2'], net: { name: 'GND' } }])
  assert.equal(two.nets.length, 1)
  assert.deepEqual(two.nets[0].wires, [
    ['mcu:GND', 'dht:GND'],
    ['mcu:GND2', 'dht:VCC'],
    ['mcu:GND', 'mcu:GND2'],
  ])

  const unlinked = applyOps(joined, [{ type: 'unlink', node: 'dht:DATA' }])
  assert.deepEqual(unlinked.nets[0].wires, [['mcu:GPIO4', 'dht:VCC']])

  const stale = normalizeDocument({
    parts: [
      { id: 'mcu', kind: 'board', pins: [{ name: 'GPIO4', role: 'bidir' }, { name: '3V3', role: 'power' }] },
      { id: 'dht', kind: 'module', pins: [{ name: 'DATA', role: 'bidir' }, { name: 'VCC', role: 'power' }] },
    ],
    nets: [{
      id: 'n1',
      name: 'GPIO4',
      kind: 'signal',
      nodes: ['mcu:GPIO4', 'dht:DATA'],
      wires: [['mcu:GPIO4', 'nope:X'], ['mcu:GPIO4', 'dht:DATA']],
    }],
  })
  assert.deepEqual(stale.nets[0].wires, [['mcu:GPIO4', 'dht:DATA']])
}

function assertsPending(doc) {
  assert.equal(doc.pending[0].note, '把 DHT22 的数据线接到 GPIO4')
  assert.equal(doc.pending[0].ops[0].type, 'connect')
}

function cloneForDiscard(doc) {
  const copy = normalizeDocument(JSON.parse(JSON.stringify(doc)))
  return copy
}

console.log('smoke ok')
