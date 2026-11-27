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
const { scene, planWire, pathOf, wirePath, crossesCard } = captured.module.internals

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

console.log('route: ok')
