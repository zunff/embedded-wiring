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
import { partFromTemplate } from '../lib/library.js'
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
  assert.equal(left.length, 15)
  assert.equal(right.length, 15)
  assert.deepEqual(left.slice(0, 2).map(pin => pin.name), ['3V3', 'EN'])
  assert.equal(left[left.length - 1].name, 'GND')
  assert.equal(right[0].name, '5V')
  assert.equal(right[right.length - 1].name, 'GPIO23')
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
  assert.deepEqual(pins.map(pin => [pin.name, pin.side]), [['3V3', 'left'], ['5V', 'right'], ['GPIO4', 'right']])
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

// 7. One pin on two nets is a structural refusal.
{
  let doc = withPart(board(), 'dht22', 'dht')
  doc = applyOps(doc, [{ type: 'connect', nodes: ['mcu:GPIO4', 'dht:DATA'] }])
  assert.throws(
    () => applyOps(doc, [{ type: 'connect', nodes: ['mcu:GPIO4', 'dht:VCC'] }]),
    /已经连在/,
  )
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

function assertsPending(doc) {
  assert.equal(doc.pending[0].note, '把 DHT22 的数据线接到 GPIO4')
  assert.equal(doc.pending[0].ops[0].type, 'connect')
}

function cloneForDiscard(doc) {
  const copy = normalizeDocument(JSON.parse(JSON.stringify(doc)))
  return copy
}

console.log('smoke ok')
