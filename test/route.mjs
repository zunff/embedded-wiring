/**
 * Geometry test: the browser half is a loader bundle, not an ES module, so it is
 * loaded here with a stub loader and a stub `react`. What is checked is the pure
 * geometry — pin anchors, wire shape, the tidy layout and its pin splitting.
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
const { scene, wirePath, wireSegments, curvePath, spanningSegments, tidyParts, autoMirrors, oriented, sideOf } = captured.module.internals

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

// 3b. A net remembers the wires that were drawn: a rail feeding two loads is two
//     wires leaving the same pin, not a tree through whichever pin is nearest.
{
  const second = { ...buzzer, id: 'buzzer2', at: [646, 500] }
  const { anchors } = scene([board, buzzer, second])
  const hand = {
    nodes: ['mcu:3V3', 'buzzer:VCC', 'buzzer2:VCC'],
    wires: [['mcu:3V3', 'buzzer:VCC'], ['mcu:3V3', 'buzzer2:VCC']],
  }
  const d = wirePath(anchors, hand)
  assert.equal(d.match(/M /g).length, 2)
  assert.equal(d.match(/M 291 /g).length, 2, 'both wires leave the pin that was dragged from')
  const partially = { ...hand, wires: [['mcu:3V3', 'buzzer:VCC']] }
  const attached = wireSegments(anchors, partially)
  assert.equal(attached.length, 2, 'a pin nobody wired still hangs off the net')
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

const cardsApart = cards => {
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      const a = cards[i]
      const b = cards[j]
      const apart = a.x + a.w + 8 <= b.x || b.x + b.w + 8 <= a.x
        || a.y + a.h + 8 <= b.y || b.y + b.h + 8 <= a.y
      assert.ok(apart, `cards ${i} and ${j} do not overlap`)
    }
  }
}

// 5. "一键整理" keeps the board where it is, keeps a card on the side it was
//    drawn on, snaps it into a column and never lets cards overlap.
{
  const mcu = {
    id: 'mcu',
    kind: 'board',
    at: [500, 300],
    pins: [
      { name: '3V3', role: 'power', side: 'left' },
      { name: 'GPIO4', role: 'bidir', side: 'right' },
    ],
  }
  const left = { id: 'left', kind: 'module', at: [100, 300], pins: [{ name: 'VCC', role: 'power', side: 'left' }] }
  const right = { id: 'right', kind: 'module', at: [900, 300], pins: [{ name: 'SIG', role: 'bidir', side: 'left' }] }
  const nets = [{ nodes: ['mcu:3V3', 'left:VCC'] }, { nodes: ['mcu:GPIO4', 'right:SIG'] }]

  const { positions, sides } = tidyParts([mcu, left, right], nets)
  assert.deepEqual(positions.get('mcu'), [500, 300], 'the board never moves')
  assert.equal(sides.has('mcu'), false, 'a board keeps its physical pin layout')
  assert.equal(sides.has('left'), false, 'a one-pin part has no second edge to choose')
  const placed = [mcu, left, right].map(part => ({ ...part, at: positions.get(part.id) }))
  const { anchors, cards } = scene(placed)
  assert.ok(anchors.get('left:VCC').x < anchors.get('mcu:3V3').x, 'a part drawn on the left stays left')
  assert.ok(anchors.get('right:SIG').x > anchors.get('mcu:GPIO4').x, 'a part drawn on the right stays right')
  assert.equal(anchors.get('left:VCC').x, Math.round((500 - (210 + 96)) / 10) * 10, 'columns sit one gap apart')
  assert.equal(anchors.get('left:VCC').y, anchors.get('mcu:3V3').y, 'a card lines up with the pin it is wired to')
  assert.equal(anchors.get('right:SIG').y, anchors.get('mcu:GPIO4').y, 'the wire between them is straight')
  cardsApart(cards)
  const again = tidyParts([mcu, left, right], nets)
  assert.deepEqual([...again.positions], [...positions], 'same input, same layout')
  assert.deepEqual([...again.sides], [...sides], 'same input, same sides')
}

// 5b. A card is not left hanging where it was drawn: it drops to the row of the
//     pin it is wired to, so a motor sits beside the driver pin that feeds it.
{
  const mcu = {
    id: 'mcu',
    kind: 'board',
    at: [500, 300],
    pins: Array.from({ length: 10 }, (_, index) => ({ name: `P${index}`, role: 'bidir', side: 'right' })),
  }
  const motor = { id: 'motor', kind: 'module', at: [900, 100], pins: [{ name: 'A', role: 'passive', side: 'left' }] }
  const nets = [{ nodes: ['mcu:P8', 'motor:A'] }]
  const { positions } = tidyParts([mcu, motor], nets)
  const pinRowY = 300 + 30 + 8 + 8 * 20 + 10
  assert.equal(positions.get('motor')[1], pinRowY - 48, 'moved down to the pin it talks to')
  const placed = [mcu, motor].map(part => ({ ...part, at: positions.get(part.id) }))
  const { anchors } = scene(placed)
  assert.equal(anchors.get('motor:A').y, anchors.get('mcu:P8').y)
}

// 6. A module wired both ways has its pins split between its edges: the battery
//    side of a boost converter ends up on the left edge, its motor side on the
//    right, so no wire has to wrap around the card.
{
  const pin = (name, role, side) => ({ name, role, side })
  const boost = {
    id: 'boost',
    kind: 'module',
    at: [420, 300],
    pins: [
      pin('VIN+', 'power', 'right'),
      pin('VIN-', 'ground', 'right'),
      pin('OUT-', 'ground', 'right'),
      pin('OUT+', 'power', 'right'),
    ],
  }
  const battery = {
    id: 'battery',
    kind: 'module',
    at: [40, 300],
    pins: [pin('+', 'power', 'left'), pin('-', 'ground', 'left')],
  }
  const motor = {
    id: 'motor',
    kind: 'module',
    at: [820, 300],
    pins: [pin('M1', 'passive', 'left'), pin('M2', 'passive', 'left')],
  }
  const nets = [
    { kind: 'power', nodes: ['battery:+', 'boost:VIN+'] },
    { kind: 'ground', nodes: ['battery:-', 'boost:VIN-'] },
    { kind: 'power', nodes: ['boost:OUT+', 'motor:M1'] },
    { kind: 'ground', nodes: ['boost:OUT-', 'motor:M2'] },
  ]
  const { positions, sides } = tidyParts([boost, battery, motor], nets)
  assert.deepEqual(
    sides.get('boost'),
    { 'VIN+': 'left', 'VIN-': 'left', 'OUT-': 'right', 'OUT+': 'right' },
    'the input half goes left, the output half right',
  )
  const placed = [boost, battery, motor].map(part => ({
    ...part,
    at: positions.get(part.id),
    pins: part.pins.map(item => ({ ...item, side: sides.get(part.id)?.[item.name] ?? item.side })),
  }))
  const { anchors, cards } = scene(placed)
  assert.ok(anchors.get('battery:+').x < anchors.get('boost:VIN+').x, 'the battery stays left')
  assert.ok(anchors.get('motor:M1').x > anchors.get('boost:OUT+').x, 'the motor stays right')
  assert.equal(anchors.get('boost:VIN+').side, 'left', 'VIN is drawn on the left edge')
  assert.equal(anchors.get('boost:OUT+').side, 'right', 'OUT is drawn on the right edge')
  cardsApart(cards)
  const again = tidyParts([boost, battery, motor], nets)
  assert.deepEqual([...again.sides], [...sides], 'the split is stable')
}

// 6b. A ground pin is not dragged to the far side by the ground net: it joins
//     its twin on the same connector, so a charger keeps B+ and B− together.
{
  const pin = (name, role) => ({ name, role, side: 'left' })
  const charger = {
    id: 'charger',
    kind: 'module',
    at: [420, 300],
    pins: [
      pin('IN+', 'power'),
      pin('IN-', 'ground'),
      pin('B+', 'power'),
      pin('B-', 'ground'),
      pin('OUT+', 'power'),
      pin('OUT-', 'ground'),
    ],
  }
  const battery = { id: 'battery', kind: 'module', at: [40, 300], pins: [pin('+', 'power'), pin('-', 'ground')] }
  const boost = { id: 'boost', kind: 'module', at: [820, 300], pins: [pin('VIN+', 'power'), pin('VIN-', 'ground')] }
  const nets = [
    { kind: 'power', nodes: ['battery:+', 'charger:B+'] },
    { kind: 'power', nodes: ['charger:OUT+', 'boost:VIN+'] },
    { kind: 'ground', nodes: ['charger:B-', 'charger:OUT-', 'charger:IN-', 'battery:-', 'boost:VIN-'] },
  ]
  const { sides } = tidyParts([charger, battery, boost], nets)
  assert.equal(sides.get('charger')['B-'], 'left', 'B− stays with B+ against the battery')
  assert.equal(sides.get('charger')['OUT-'], 'right', 'OUT− stays with OUT+ towards the load')
  assert.equal(sides.get('charger')['IN+'], 'left', 'a lone input pin follows its neighbour')
}

// 7. A part the user arranged by hand is theirs: tidy moves the card but leaves
//    the edges alone. An explicit pin list from the agent is not a hand layout.
{
  const pin = name => ({ name, role: 'passive', side: 'left' })
  const hub = { id: 'hub', kind: 'module', at: [400, 300], pins: [pin('A'), pin('B')] }
  const wired = { id: 'wired', kind: 'module', at: [0, 0], pinsHand: true, pinsManual: true, pins: [pin('P'), pin('Q')] }
  const nets = [{ nodes: ['hub:A', 'wired:P'] }]
  const { sides } = tidyParts([hub, wired], nets)
  assert.equal(sides.has('wired'), false)
  const fromAgent = { id: 'agent', kind: 'module', at: [750, 300], pinsManual: true, pins: [pin('P'), pin('Q')] }
  const both = tidyParts([hub, fromAgent], [{ nodes: ['hub:B', 'agent:P'] }]).sides
  assert.ok(both.has('agent'), 'a part whose pins came from a model/photo can still split')
}

// 8. Without a board, the most connected part is the anchor and everything else
//    chains off it.
{
  const pin = { name: 'A', role: 'passive', side: 'left' }
  const make = (id, at) => ({ id, kind: 'module', at, pins: [pin, { ...pin, name: 'B' }] })
  const parts = [make('a', [0, 0]), make('b', [1500, 0]), make('c', [3000, 800])]
  const nets = [{ nodes: ['a:A', 'b:A'] }, { nodes: ['b:A', 'c:A'] }]
  const { positions } = tidyParts(parts, nets)
  assert.deepEqual(positions.get('b'), [1500, 0], 'the hub part stays put')
  const placed = parts.map(part => ({ ...part, at: positions.get(part.id) }))
  const span = Math.max(...placed.map(part => part.at[0])) - Math.min(...placed.map(part => part.at[0]))
  assert.ok(span < 1400, 'the layout gets compact')
}

console.log('route: ok')
