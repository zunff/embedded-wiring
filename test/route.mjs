/**
 * Routing test: the browser half is a loader bundle, not an ES module, so it is
 * loaded here with a stub loader and a stub `react`. What is checked is the pure
 * geometry — where wires leave a pin and whether they run through a card.
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
const { scene, planWire, pathOf, wirePath, crossesCard, autoMirrors, oriented, columns, isSplit, tidyParts } = captured.module.internals

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

function segments(points) {
  const out = []
  for (let index = 0; index + 1 < points.length; index += 1) out.push([points[index], points[index + 1]])
  return out
}

// 1. A wire from a left pin to a pin on the far side of its own card detours
//    around the card instead of running under it (it used to disappear).
{
  const { anchors, cards } = scene([board, buzzer])
  const from = anchors.get('mcu:3V3')
  const to = anchors.get('buzzer:VCC')
  assert.equal(from.side, 'left')
  const plan = planWire(from, to, cards)
  assert.equal(plan.kind, 'ortho', '3V3 -> VCC must not cut across the board')
  const points = plan.points
  assert.deepEqual(points[0], from)
  assert.deepEqual(points[points.length - 1], to)
  for (const [a, b] of segments(points)) {
    for (const card of cards) assert.equal(crossesCard(a, b, card), false, `segment ${JSON.stringify([a, b])} crosses ${JSON.stringify(card)}`)
  }
  // Leaves the pin sideways, then goes up or down past the card.
  assert.equal(points[1].y, from.y)
  assert.ok(points[1].x < from.x)
  assert.ok(points.slice(1, -1).some(point => point.y < board.at[1] || point.y > board.at[1] + 60))
  const d = pathOf(plan)
  assert.match(d, /^M /)
  assert.match(d, / Q /, 'detours get rounded corners')
  assert.ok(d.endsWith(`L ${to.x} ${to.y}`))
}

// 2. When nothing is in the way the wire stays a plain curve: no need to walk
//    around the outside of both cards.
{
  const { anchors, cards } = scene([board, buzzer])
  const from = anchors.get('mcu:GPIO9')
  const to = anchors.get('buzzer:VCC')
  const plan = planWire(from, to, cards)
  assert.equal(plan.kind, 'curve')
  assert.match(pathOf(plan), / C /)
}

// 3. Nets sharing a channel are staggered, so two of them do not overlap.
{
  const { anchors, cards } = scene([board, buzzer])
  const from = anchors.get('mcu:3V3')
  const to = anchors.get('buzzer:VCC')
  const first = planWire(from, to, cards, 0)
  const second = planWire(from, to, cards, 1)
  const laneOf = plan => plan.points[2].y
  assert.notEqual(laneOf(first), laneOf(second))
}

// 4. `scene` exposes one anchor per pin and one rectangle per card.
{
  const { anchors, cards } = scene([board, buzzer])
  assert.equal(anchors.size, 6)
  assert.equal(cards.length, 2)
  assert.equal(cards[0].w, 210)
  assert.equal(anchors.get('buzzer:VCC').x, 646)
  assert.equal(anchors.get('buzzer:VCC').y, 433)
}

// 5. A whole net becomes one path string, whatever its length.
{
  const { anchors, cards } = scene([board, buzzer])
  const two = wirePath(anchors, { nodes: ['mcu:3V3', 'buzzer:VCC'] }, cards, 0)
  assert.match(two, /^M /)
  const three = wirePath(anchors, { nodes: ['mcu:3V3', 'buzzer:VCC', 'buzzer:I/O'] }, cards, 0)
  assert.equal(three.match(/M /g).length, 2)
  assert.equal(wirePath(anchors, { nodes: ['mcu:3V3'] }, cards), '')
  assert.equal(wirePath(anchors, { nodes: ['mcu:3V3', 'nope:pin'] }, cards), '')
}

// 6. Mirroring the part puts its pins on the near edge, so the same wire turns
//    into a short curve instead of a loop around the card.
{
  const mirrored = scene([board, { ...buzzer, at: [-27, 389], flip: true }])
  const pin = mirrored.anchors.get('buzzer:VCC')
  assert.equal(pin.side, 'right')
  assert.equal(pin.x, -27 + 210)
  const plan = planWire(mirrored.anchors.get('mcu:3V3'), pin, mirrored.cards)
  assert.equal(plan.kind, 'curve')

  const facing = scene([board, { ...buzzer, at: [-27, 389] }])
  const wrapped = planWire(facing.anchors.get('mcu:3V3'), facing.anchors.get('buzzer:VCC'), facing.cards)
  assert.equal(wrapped.kind, 'ortho')
}

// 7. Orientation is guessed from the wiring: a module turns its pins towards
//    the parts it talks to, and an explicit flip wins over the guess.
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

  const guessed = autoMirrors([board, left], nets)
  assert.equal(oriented(left, guessed).flip, true)
  assert.equal(oriented({ ...left, flip: false }, guessed).flip, false, 'explicit wins')
  assert.equal(oriented({ ...left, flip: true }, new Map()).flip, true)

  // The guess is what makes the wrap disappear: same document, one flip.
  const unflipped = scene([board, oriented({ ...left, flip: false }, guessed)])
  const flipped = scene([board, oriented(left, guessed)])
  assert.equal(planWire(unflipped.anchors.get('mcu:3V3'), unflipped.anchors.get('buzzer:VCC'), unflipped.cards).kind, 'ortho')
  assert.equal(planWire(flipped.anchors.get('mcu:3V3'), flipped.anchors.get('buzzer:VCC'), flipped.cards).kind, 'curve')
}

// 8. A wide module is drawn in two columns: supply on the left, the rest on
//    the right, so the card is shorter and wires can leave on either side.
{
  const pins = ['VCC', 'GND', 'IN1', 'IN2', 'IN3', 'IN4', 'OUTA1', 'OUTA2', 'OUTB1', 'OUTB2']
    .map((name, index) => ({ name, role: index < 2 ? (index === 0 ? 'power' : 'ground') : 'bidir', side: 'left' }))
  const driver = { id: 'drv', kind: 'module', model: 'mx1508', at: [0, 0], pins }
  assert.equal(isSplit(driver), true)
  const sides = columns(driver)
  assert.equal(sides.get('VCC'), 'left')
  assert.equal(sides.get('GND'), 'left')
  assert.equal(sides.get('IN1'), 'right')
  assert.equal(sides.get('OUTB2'), 'right')
  const { cards } = scene([driver])
  const oneColumn = 30 + 8 + 10 * 20 + 10
  assert.ok(cards[0].h < oneColumn, 'split card is shorter than a ten-row strip')

  // A small module keeps one column; a hand-written part that mixes sides is
  // left alone even when it is wide.
  assert.equal(isSplit({ ...driver, pins: pins.slice(0, 3) }), false)
  const mixed = { ...driver, pins: pins.map((pin, index) => ({ ...pin, side: index % 2 === 0 ? 'left' : 'right' })) }
  assert.equal(isSplit(mixed), false)
  assert.equal(columns(mixed).get('IN1'), 'left')
  assert.equal(columns(mixed).get('GND'), 'right')

  // No supply pins: fall back to splitting the list in half.
  const passive = { ...driver, pins: pins.map(pin => ({ ...pin, role: 'passive' })) }
  assert.equal(columns(passive).get('IN3'), 'left')
  assert.equal(columns(passive).get('IN4'), 'right')
}

// 9. "一键整理" pulls wired parts together, keeps cards apart, and is
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
  const again = tidyParts(parts, nets)
  assert.deepEqual([...again], [...positions], 'same input, same layout')
}

console.log('route: ok')
