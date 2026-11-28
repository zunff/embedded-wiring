/**
 * Geometry test: the browser half is a loader bundle, not an ES module, so it is
 * loaded here with a stub loader and a stub `react`. What is checked is the pure
 * geometry — pin anchors, wire shape and the tidy layout.
 *
 * Run with `node test/route.mjs` from the package directory.
 *
 * @module @local/embedded-wiring/test/route
 */

import assert from 'node:assert/strict'

const captured = {}
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      captured.module = spec.factory(require)
    },
  },
}

function require(id) {
  if (id === 'react') {
    return {
      Fragment: 'fragment',
      createElement: () => null,
      useCallback: callback => callback,
      useEffect() {},
      useMemo: factory => factory(),
      useRef: () => ({ current: null }),
      useState: () => [undefined, () => {}],
    }
  }
  throw new Error(`unexpected require(${id})`)
}

await import('../client.js')
assert.ok(captured.module !== undefined, 'the bundle registered itself')
const { scene, wirePath, curvePath, spanningSegments, tidyParts, autoMirrors, oriented, sideOf } = captured.module.internals

const board = {
  id: 'mcu',
  kind: 'board',
  at: [291, 307],
  pins: [
    { name: 'GND', role: 'ground', side: 'left' },
    { name: '3V3', role: 'power', side: 'left' },
    { name: 'GPIO9', role: 'bidir', side: 'right' },
  ],
}

const buzzer = {
  id: 'buzzer',
  kind: 'module',
  at: [646, 385],
  pins: [
    { name: 'VCC', role: 'power', side: 'left' },
    { name: 'GND', role: 'ground', side: 'left' },
    { name: 'I/O', role: 'input', side: 'left' },
  ],
}

// 1. Anchors follow the pin's own side, and `flip` mirrors the whole symbol.
{
  const { anchors } = scene([board, buzzer])
  assert.equal(anchors.get('mcu:3V3').side, 'left')
  assert.equal(anchors.get('mcu:3V3').x, 291)
  assert.equal(anchors.get('buzzer:VCC').x, 646)
  const flipped = scene([board, { ...buzzer, flip: true }]).anchors
  assert.equal(flipped.get('buzzer:VCC').side, 'right')
  assert.equal(flipped.get('buzzer:VCC').x, 646 + 210)
  // A pin moved to the other edge by hand lands there too.
  const manual = scene([{ ...buzzer, pins: buzzer.pins.map(pin => ({ ...pin, side: 'right' })) }]).anchors
  assert.equal(manual.get('buzzer:GND').x, 646 + 210)
  assert.equal(sideOf({ ...buzzer, flip: true }, buzzer.pins[0]), 'right')
}

// 2. A wire leaves its pin sideways: both control points are pushed out of the
//    card the pin sits on.
{
  const { anchors } = scene([board, buzzer])
  const from = anchors.get('mcu:3V3')
  const to = anchors.get('buzzer:VCC')
  const d = curvePath(from, to)
  const numbers = d.replace('M ', '').replace('C ', '').split(/[ ,]+/).map(Number)
  const [c1x, c1y, c2x, c2y] = numbers.slice(2)
  assert.ok(c1x < from.x, 'left pin leaves to the left')
  assert.equal(c1y, from.y)
  assert.ok(c2x < to.x, 'target left pin is entered from the left')
  assert.equal(c2y, to.y)
  assert.match(d, /^M 291 /)
}

// 3. A net with several pins is a tree of segments, not a star.
{
  const points = [
    { x: 0, y: 0, side: 'left' },
    { x: 100, y: 0, side: 'left' },
    { x: 200, y: 0, side: 'left' },
  ]
  assert.equal(spanningSegments(points).length, 2)
  const { anchors } = scene([board, buzzer, { ...board, id: 'mcu2' }])
  const d = wirePath(anchors, { nodes: ['mcu:3V3', 'buzzer:VCC', 'buzzer:GND'] })
  assert.equal(d.match(/M /g).length, 2)
  assert.equal(wirePath(anchors, { nodes: ['mcu:3V3'] }), '')
  assert.equal(wirePath(anchors, { nodes: ['mcu:3V3', 'nope:x'] }), '')
}

// 4. Orientation is guessed from the wiring, never overriding a hand layout.
{
  const left = { ...buzzer, at: [-27, 389] }
  const nets = [
    { nodes: ['mcu:3V3', 'buzzer:VCC'] },
    { nodes: ['mcu:GND', 'buzzer:GND'] },
  ]
  assert.equal(autoMirrors([board, left], nets).get('buzzer'), true)
  assert.equal(autoMirrors([board, { ...buzzer, at: [646, 385] }], nets).get('buzzer'), false)
  assert.equal(autoMirrors([board, left], []).has('buzzer'), false, 'an unwired module keeps its template orientation')
  assert.equal(autoMirrors([board, left], nets).has('mcu'), false, 'boards keep their official layout')
  assert.equal(
    autoMirrors([board, { ...left, pinsManual: true }], nets).has('buzzer'),
    false,
    'a hand-placed pin layout is not flipped',
  )
  const guessed = autoMirrors([board, left], nets)
  assert.equal(oriented(left, guessed).flip, true)
  assert.equal(oriented({ ...left, flip: false }, guessed).flip, false, 'explicit wins')
}

// 5. "一键整理" pulls wired parts together, keeps cards apart, and is
//    deterministic.
{
  const pin = { name: 'A', role: 'passive', side: 'left' }
  const make = (id, at) => ({ id, kind: 'module', at, pins: [pin, { ...pin, name: 'B' }] })
  const parts = [make('a', [0, 0]), make('b', [1500, 0]), make('c', [3000, 800])]
  const nets = [{ nodes: ['a:A', 'b:A'] }, { nodes: ['b:A', 'c:A'] }]

  const positions = tidyParts(parts, nets)
  assert.equal(positions.size, 3)
  const placed = parts.map(part => ({ ...part, at: positions.get(part.id) }))
  const { cards } = scene(placed)
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      const a = cards[i]
      const b = cards[j]
      const apart = a.x + a.w + 8 <= b.x || b.x + b.w + 8 <= a.x
        || a.y + a.h + 8 <= b.y || b.y + b.h + 8 <= a.y
      assert.ok(apart, `cards ${i} and ${j} do not overlap`)
    }
  }
  const span = Math.max(...placed.map(part => part.at[0])) - Math.min(...placed.map(part => part.at[0]))
  assert.ok(span < 1400, 'the layout gets compact')
  assert.deepEqual([...tidyParts(parts, nets)], [...positions], 'same input, same layout')
}

console.log('route: ok')
