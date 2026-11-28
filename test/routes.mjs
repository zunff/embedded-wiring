/**
 * Route + tool integration test with stub DSH services: proves the actual
 * handlers the page and the agent talk to, without starting DSH.
 *
 * Run with `node test/routes.mjs` from the package directory.
 *
 * @module @local/embedded-wiring/test/routes
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import path from 'node:path'
import { apply } from '../index.js'

function fakeRequest(method, url, headers, body) {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(body)])
  request.method = method
  request.url = url
  request.headers = headers
  return request
}

function fakeResponse() {
  const response = {
    status: 0,
    headers: undefined,
    headersSent: false,
    body: '',
    writeHead(status, headers) {
      response.status = status
      response.headers = headers
      response.headersSent = true
    },
    end(chunk) {
      if (chunk !== undefined) response.body += chunk.toString()
    },
  }
  return response
}

const root = await mkdtemp(path.join(tmpdir(), 'ew-routes-'))
const workspace = { id: 'ws-1', title: 'demo', path: root, sessionIds: [] }
const routes = []
const tools = []
const disposers = []
/** The session directory the agent tool resolves from; moved to a subproject later. */
let agentCwd = root

const ctx = {
  get(name) {
    if (name === 'workspaceRegistry') {
      return {
        list: () => [workspace],
        get: id => (id === workspace.id ? workspace : undefined),
        resolveByPath: async value => (value === root ? workspace : undefined),
      }
    }
    if (name === 'workingDirectory') return { ensure: async () => agentCwd }
    if (name === 'webServer') {
      return { register: route => { routes.push(route); return () => {} } }
    }
    return undefined
  },
  effect(fn) {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    return () => {}
  },
  inject() {},
  tools: { register: definition => tools.push(definition) },
}

const signal = new AbortController().signal

async function call(routePath, method, payload, headers = {}) {
  const route = routes.find(candidate => candidate.path === routePath && typeof candidate.handler === 'function')
  if (route === undefined) throw new Error(`no handler route ${routePath}, have ${routes.map(r => `${r.path}:${r.handler ? 'handler' : 'resource'}`).join(', ')}`)
  const response = fakeResponse()
  const body = payload === undefined ? undefined : JSON.stringify(payload)
  await route.handler(
    fakeRequest(method, routePath, { 'content-type': 'application/json', ...headers }, body),
    response,
  )
  return { status: response.status, json: response.body === '' ? undefined : JSON.parse(response.body) }
}

async function readResource(routePath, url) {
  const route = routes.find(candidate => candidate.path === routePath && typeof candidate.resource === 'function')
  if (route === undefined) throw new Error(`no resource route ${routePath}`)
  const response = await route.resource(new Request(url))
  return { status: response.status, json: await response.json() }
}

try {
  apply(ctx, { file: 'hardware/wiring.json' })

  // Every verb the page uses exists, and writes are handler routes.
  assert.ok(routes.some(route => route.path === '/embedded-wiring/ops' && typeof route.handler === 'function'))
  assert.ok(routes.some(route => route.path === '/embedded-wiring/state' && typeof route.resource === 'function'))

  // The page's first read: no file yet.
  const empty = await readResource('/embedded-wiring/state', `http://x/embedded-wiring/state?workspace=${workspace.id}`)
  assert.equal(empty.status, 200)
  assert.equal(empty.json.exists, false)
  assert.equal(empty.json.project.title, 'demo')

  // Create the starter project through the page's init route.
  const created = await call('/embedded-wiring/init', 'POST', { workspace: workspace.id })
  assert.equal(created.status, 200)
  assert.equal(created.json.doc.parts.length, 1)
  assert.equal(created.json.doc.parts[0].kind, 'board')
  assert.equal(created.json.rev, 1)

  // The page's save path: proposal, then apply with the quoted rev.
  const stateAfterInit = await readResource('/embedded-wiring/state', `http://x/embedded-wiring/state?workspace=${workspace.id}`)
  const baseRev = stateAfterInit.json.doc.rev
  const proposed = await call('/embedded-wiring/ops', 'POST', {
    workspace: workspace.id,
    baseRev,
    ops: [{
      type: 'propose',
      note: '把 DHT22 接到 GPIO4',
      ops: [
        { type: 'add_part', part: { id: 'dht', model: 'dht22' } },
        { type: 'connect', nodes: ['mcu:3V3', 'dht:VCC'] },
        { type: 'connect', nodes: ['mcu:GND', 'dht:GND'] },
        { type: 'connect', nodes: ['mcu:GPIO4', 'dht:DATA'] },
      ],
    }],
  })
  assert.equal(proposed.status, 200, JSON.stringify(proposed.json))
  assert.equal(proposed.json.doc.pending.length, 1)
  assert.equal(proposed.json.doc.parts.length, 1, 'a proposal must not change the netlist')

  const applied = await call('/embedded-wiring/ops', 'POST', {
    workspace: workspace.id,
    baseRev: proposed.json.rev,
    ops: [{ type: 'apply_pending' }],
  })
  assert.equal(applied.status, 200)
  assert.equal(applied.json.doc.pending.length, 0)
  assert.equal(applied.json.doc.parts.length, 2)
  assert.equal(applied.json.doc.nets.length, 3)
  assert.equal(applied.json.counts.errors, 0)

  // A photo-recognized part arrives unverified and the page can confirm it.
  const photo = await call('/embedded-wiring/ops', 'POST', {
    workspace: workspace.id,
    baseRev: applied.json.rev,
    ops: [{
      type: 'add_part',
      part: {
        id: 'photo1',
        model: 'custom',
        label: '照片里的模块',
        source: 'photo',
        pins: [
          { name: 'VCC', role: 'power', volt: 3.3, maxVolt: 5 },
          { name: 'DATA', role: 'bidir' },
          { name: 'GND', role: 'ground' },
        ],
      },
    }],
  })
  assert.equal(photo.status, 200)
  assert.ok(photo.json.diagnostics.some(item => item.code === 'photo-unverified'))
  const confirmed = await call('/embedded-wiring/ops', 'POST', {
    workspace: workspace.id,
    baseRev: photo.json.rev,
    ops: [{ type: 'update_part', id: 'photo1', patch: { verified: true } }],
  })
  assert.equal(confirmed.status, 200)
  assert.ok(!confirmed.json.diagnostics.some(item => item.code === 'photo-unverified'))

  // Splitting pins between the two edges is layout only, and rides the same route.
  const split = await call('/embedded-wiring/ops', 'POST', {
    workspace: workspace.id,
    baseRev: confirmed.json.rev,
    ops: [{ type: 'set_pin_sides', id: 'photo1', sides: { VCC: 'left', GND: 'right' } }],
  })
  assert.equal(split.status, 200, JSON.stringify(split.json))
  const photoPart = split.json.doc.parts.find(part => part.id === 'photo1')
  assert.equal(photoPart.pins.find(pin => pin.name === 'GND').side, 'right')
  assert.equal(split.json.doc.nets.length, confirmed.json.doc.nets.length, 'a split keeps the wiring')

  // A stale write is refused with the current document, never applied.
  const stale = await call('/embedded-wiring/ops', 'POST', {
    workspace: workspace.id,
    baseRev,
    ops: [{ type: 'set_meta', patch: { title: 'should not land' } }],
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.json.conflict, true)
  assert.equal(stale.json.doc.rev, split.json.rev)

  // Write guards.
  assert.equal((await call('/embedded-wiring/ops', 'GET')).status, 405)
  assert.equal((await call('/embedded-wiring/ops', 'POST', { workspace: workspace.id }, { 'sec-fetch-site': 'cross-site' })).status, 403)

  // The agent tool reads the same document and writes through the same path.
  const tool = tools.find(candidate => candidate.name === 'hardware_map')
  assert.ok(tool !== undefined, 'hardware_map must be registered')
  const read = await tool.execute({ action: 'read' }, { agent: {}, signal })
  assert.match(read.text, /ESP32-DevKitC V4/)
  assert.match(read.text, /dht:DATA/)
  const moved = await tool.execute({ action: 'move', id: 'dht', at: [420, 120] }, { agent: {}, signal })
  assert.match(moved.text, /已写入/)
  const unknown = await tool.execute({ action: 'connect', nodes: ['mcu:GPIO5', 'dht:NOPE'] }, { agent: {}, signal })
    .then(() => undefined, error => error)
  assert.match(String(unknown && unknown.message), /未知引脚/)

  const final = await readResource('/embedded-wiring/state', `http://x/embedded-wiring/state?workspace=${workspace.id}`)
  const dht = final.json.doc.parts.find(part => part.id === 'dht')
  assert.deepEqual(dht.at, [420, 120])
  assert.equal(final.json.doc.meta.title, '我的接线')

  // ---- Multi-project workspace --------------------------------------------
  // One workspace holds several wiring files, each in its own directory.
  const sensor = await call('/embedded-wiring/init', 'POST', {
    workspace: workspace.id,
    project: 'firmware/sensor',
    board: 'esp32-c3-supermini',
  })
  assert.equal(sensor.status, 200, JSON.stringify(sensor.json))
  assert.equal(sensor.json.project.id, 'firmware/sensor')
  assert.equal(sensor.json.doc.parts.length, 1)
  assert.equal(sensor.json.doc.parts[0].model, 'esp32-c3-supermini')

  const projects = await readResource('/embedded-wiring/projects', 'http://x/embedded-wiring/projects')
  assert.equal(projects.status, 200)
  const entry = projects.json.workspaces.find(item => item.id === workspace.id)
  assert.ok(entry !== undefined)
  assert.deepEqual(entry.projects.map(item => item.id), ['.', 'firmware/sensor'])
  assert.equal(entry.boards, 2)
  assert.equal(projects.json.totals.projects, 2)
  assert.equal(projects.json.totals.boards, 2)

  const sensorState = await readResource(
    '/embedded-wiring/state',
    `http://x/embedded-wiring/state?workspace=${workspace.id}&project=firmware%2Fsensor`,
  )
  assert.equal(sensorState.json.project.id, 'firmware/sensor')
  assert.equal(sensorState.json.boards, 1)
  assert.equal(sensorState.json.doc.meta.title, '我的接线')

  const listed = await tool.execute({ action: 'list' }, { agent: {}, signal })
  assert.match(listed.text, /接线项目 2 个/)
  assert.match(listed.text, /合计 2 块板/)
  assert.match(listed.text, /firmware\/sensor — 1 板/)

  // A session working inside firmware/sensor edits that project by default and
  // leaves the root project alone.
  agentCwd = path.join(root, 'firmware', 'sensor')
  const rootBefore = await readResource(
    '/embedded-wiring/state',
    `http://x/embedded-wiring/state?workspace=${workspace.id}&project=.`,
  )
  const nearby = await tool.execute({ action: 'read' }, { agent: {}, signal })
  assert.match(nearby.text, /firmware[\\/]sensor[\\/]hardware[\\/]wiring\.json/)
  const sensorAdd = await tool.execute({ action: 'add_part', part: { model: 'dht22', id: 'dht' } }, { agent: {}, signal })
  assert.match(sensorAdd.text, /已写入/)
  const sensorAfter = await readResource(
    '/embedded-wiring/state',
    `http://x/embedded-wiring/state?workspace=${workspace.id}&project=firmware%2Fsensor`,
  )
  assert.equal(sensorAfter.json.doc.parts.length, 2)
  const rootAfter = await readResource(
    '/embedded-wiring/state',
    `http://x/embedded-wiring/state?workspace=${workspace.id}&project=.`,
  )
  assert.equal(rootAfter.json.doc.parts.length, rootBefore.json.doc.parts.length, 'the root project must be untouched')

  console.log('routes ok')
} finally {
  for (const dispose of disposers) dispose()
  await rm(root, { recursive: true, force: true })
}
