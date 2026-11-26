/**
 * Embedded wiring — the Host half.
 *
 * One JSON netlist per project file (`hardware/wiring.json` by default), a
 * validator that knows ESP32 pin restrictions, a loopback JSON API for the
 * page, and the `hardware_map` tool so the agent can read and change the same
 * document the user drags. The tool and the page call the same mutation path:
 * one implementation, two callers, one set of diagnostics.
 *
 * @module @local/embedded-wiring
 */

import path from 'node:path'
import { createProjectStore } from './lib/store.js'
import { catalog, partFromTemplate } from './lib/library.js'
import {
  WiringError,
  applyOps,
  applyPending,
  cloneDocument,
  discardPending,
  emptyDocument,
  propose,
} from './lib/model.js'
import { countDiagnostics, validate } from './lib/validate.js'
import { summaryText } from './lib/format.js'

/** `tools` is required; `webServer`, `workspaceRegistry`, and `workingDirectory` are looked up lazily. */
export const inject = ['tools']

const DEFAULT_FILE = 'hardware/wiring.json'
const MAX_BODY_BYTES = 256 * 1024
const MAX_PROJECTS = 30

/** A relative, in-project file path; an absolute or escaping config is refused. */
function safeFile(value) {
  if (typeof value !== 'string' || value.trim() === '') return DEFAULT_FILE
  const trimmed = value.trim().replace(/\\/g, '/')
  if (path.isAbsolute(trimmed) || trimmed.split('/').includes('..')) return DEFAULT_FILE
  return trimmed
}

/** Conflicting write: the caller quoted an older `rev`. */
class ConflictError extends Error {
  constructor(doc) {
    super(`文件已被改动（当前 rev ${doc.rev}），请重新读取后再改`)
    this.name = 'ConflictError'
    this.doc = doc
    this.status = 409
  }
}

export function apply(ctx, config) {
  const file = safeFile(config?.file)
  const configuredRoot = typeof config?.root === 'string' && config.root.trim() !== '' ? path.resolve(config.root.trim()) : ''

  /** Stores are shared per resolved file so the write queue is truly serialized. */
  const stores = new Map()

  function fileOf(root) {
    return path.resolve(root, file)
  }

  function storeOf(root) {
    const target = fileOf(root)
    let store = stores.get(target)
    if (store === undefined) {
      store = createProjectStore(target)
      stores.set(target, store)
    }
    return store
  }

  /** Workspace record for a directory, when the registry knows it. */
  async function describe(root) {
    const registry = ctx.get('workspaceRegistry')
    let workspace
    if (registry !== undefined) {
      try {
        workspace = await registry.resolveByPath(root)
      } catch {
        // An unreadable directory is still a usable project root for the file.
      }
    }
    return {
      id: workspace?.id ?? root,
      title: workspace?.title ?? (path.basename(root) || root),
      root,
      path: fileOf(root),
    }
  }

  /** Project resolved from a workspace id, an absolute directory, or nothing (most recent). */
  async function resolveProject(reference) {
    const registry = ctx.get('workspaceRegistry')
    if (typeof reference === 'string' && reference !== '') {
      if (path.isAbsolute(reference)) return describe(reference)
      if (registry !== undefined) {
        const workspace = registry.get(reference)
        if (workspace !== undefined) return describe(workspace.path)
      }
      const list = registry?.list() ?? []
      const byPath = list.find(workspace => workspace.path === reference)
      if (byPath !== undefined) return describe(byPath.path)
      throw new WiringError(`找不到项目「${reference}」。先 GET /embedded-wiring/projects 看可用的工作区。`)
    }
    if (registry !== undefined) {
      const [first] = registry.list()
      if (first !== undefined) return describe(first.path)
    }
    if (configuredRoot !== '') return describe(configuredRoot)
    throw new WiringError('本 profile 没有工作区注册表，也没有配置 config.root：无法确定接线文件放在哪个项目里。')
  }

  /** The agent's session directory, so a tool call lands in the project it is working on. */
  async function agentRoot(exec) {
    const workingDirectory = ctx.get('workingDirectory')
    if (exec?.agent !== undefined && workingDirectory !== undefined) {
      try {
        const cwd = await workingDirectory.ensure(exec.agent, exec.signal)
        if (typeof cwd === 'string' && cwd !== '') return cwd
      } catch {
        // Fall through to the configured root.
      }
    }
    if (configuredRoot !== '') return configuredRoot
    return process.cwd()
  }

  /** Tool: args.project wins, else the session directory. */
  async function projectForTool(args, exec) {
    const reference = typeof args?.project === 'string' ? args.project.trim() : ''
    if (reference !== '') {
      if (path.isAbsolute(reference)) return describe(reference)
      const registry = ctx.get('workspaceRegistry')
      const workspace = registry?.get(reference)
      if (workspace !== undefined) return describe(workspace.path)
      throw new WiringError(`找不到项目「${reference}」`)
    }
    return describe(await agentRoot(exec))
  }

  /** One mutation path shared by the page's POST and the agent's tool. */
  function mutate(base, ops) {
    const first = Array.isArray(ops) ? ops[0] : undefined
    if (Array.isArray(ops) && ops.length === 1 && first?.type === 'propose') {
      const next = cloneDocument(base)
      propose(next, { note: first.note, ops: first.ops })
      return next
    }
    if (Array.isArray(ops) && ops.length === 1 && first?.type === 'apply_pending') {
      return applyPending(base, first.id)
    }
    if (Array.isArray(ops) && ops.length === 1 && first?.type === 'discard_pending') {
      const next = cloneDocument(base)
      discardPending(next, first.id)
      return next
    }
    return applyOps(base, ops)
  }

  function report(project, doc, note) {
    const diagnostics = validate(doc)
    const counts = countDiagnostics(diagnostics)
    const text = note === undefined
      ? summaryText({ project, doc, diagnostics })
      : `${note}\n${summaryText({ project, doc, diagnostics })}`
    return { project, doc, diagnostics, counts, text }
  }

  /** Create the starter project: the board alone, so the user has something to drag from. */
  function starterDocument() {
    const doc = emptyDocument({ title: '我的接线', board: 'ESP32 DevKitC' })
    doc.parts.push(partFromTemplate('esp32-devkitc', 'mcu', 'ESP32 DevKitC', [80, 90]))
    return doc
  }

  // ---- Web routes ---------------------------------------------------------

  let routeMounted = false
  const mountRoutes = webServer => {
    if (routeMounted || webServer === undefined) return
    routeMounted = true
    ctx.effect(() => {
      const json = (value, status = 200) => new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
      const failure = (error) => {
        if (error instanceof ConflictError) {
          return json({ error: error.message, conflict: true, rev: error.doc.rev, doc: error.doc }, 409)
        }
        if (error instanceof WiringError) return json({ error: error.message }, 400)
        const status = Number.isInteger(error?.status) ? error.status : 500
        return json({ error: String(error?.message ?? error) }, status)
      }
      // A `resource` route only answers GET/HEAD — the server itself returns
      // 405 for anything else before matching — so the write verbs are raw
      // handler routes that own the whole exchange.
      const send = (response, status, value) => {
        if (response.headersSent) return
        const payload = JSON.stringify(value)
        response.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(payload),
        })
        response.end(payload)
      }
      const sendFailure = (response, error) => {
        if (error instanceof ConflictError) {
          send(response, 409, { error: error.message, conflict: true, rev: error.doc.rev, doc: error.doc })
          return
        }
        if (error instanceof WiringError) {
          send(response, 400, { error: error.message })
          return
        }
        send(response, Number.isInteger(error?.status) ? error.status : 500, { error: String(error?.message ?? error) })
      }
      /** Read a bounded JSON body; resolves to `{ value }` or `{ status, message }`. */
      const readJsonBody = request => new Promise(resolve => {
        const chunks = []
        let size = 0
        let overflow = false
        request.on('data', chunk => {
          size += chunk.length
          if (size > MAX_BODY_BYTES) overflow = true
          else chunks.push(chunk)
        })
        request.on('end', () => {
          if (overflow) {
            resolve({ status: 413, message: '请求体过大' })
            return
          }
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            resolve({ value })
          } catch {
            resolve({ status: 400, message: 'JSON 无法解析' })
          }
        })
        request.on('error', error => resolve({ status: 400, message: String(error?.message ?? error) }))
      })
      /** A write must be a same-origin JSON POST. */
      const guardWrite = (request, response) => {
        if (request.method !== 'POST') {
          send(response, 405, { error: '只接受 POST' })
          return false
        }
        const site = request.headers['sec-fetch-site']
        if (typeof site === 'string' && site !== 'same-origin') {
          send(response, 403, { error: '拒绝跨站写入' })
          return false
        }
        const type = String(request.headers['content-type'] ?? '').toLowerCase()
        if (!type.startsWith('application/json')) {
          send(response, 415, { error: '需要 application/json' })
          return false
        }
        return true
      }
      const workspaceOf = (request) => {
        const url = new URL(request.url)
        return url.searchParams.get('workspace') ?? undefined
      }

      const routes = [
        webServer.register({
          kind: 'exact',
          path: '/embedded-wiring/projects',
          resource: async () => {
            try {
              const registry = ctx.get('workspaceRegistry')
              const workspaces = registry === undefined ? [] : registry.list().slice(0, MAX_PROJECTS)
              const projects = []
              for (const workspace of workspaces) {
                const project = await describe(workspace.path)
                const stored = await storeOf(workspace.path).read()
                const diagnostics = stored.doc === undefined ? [] : validate(stored.doc)
                const counts = countDiagnostics(diagnostics)
                projects.push({
                  id: project.id,
                  title: project.title,
                  root: project.root,
                  path: project.path,
                  exists: stored.exists && stored.doc !== undefined,
                  rev: stored.doc?.rev ?? 0,
                  parts: stored.doc?.parts.length ?? 0,
                  nets: stored.doc?.nets.length ?? 0,
                  errors: counts.errors,
                  warnings: counts.warnings,
                  error: stored.error,
                })
              }
              return json({ projects })
            } catch (error) {
              return failure(error)
            }
          },
        }),

        webServer.register({
          kind: 'exact',
          path: '/embedded-wiring/state',
          resource: async (request) => {
            try {
              const project = await resolveProject(workspaceOf(request))
              const stored = await storeOf(project.root).read()
              if (stored.error !== undefined) return json({ project, exists: stored.exists, error: stored.error })
              if (stored.doc === undefined) return json({ project, exists: false })
              const result = report(project, stored.doc)
              return json({ project, exists: true, doc: result.doc, diagnostics: result.diagnostics, counts: result.counts })
            } catch (error) {
              return failure(error)
            }
          },
        }),

        webServer.register({
          kind: 'exact',
          path: '/embedded-wiring/ops',
          handler: async (request, response) => {
            try {
              if (!guardWrite(request, response)) return
              const parsed = await readJsonBody(request)
              if (parsed.status !== undefined) {
                send(response, parsed.status, { error: parsed.message })
                return
              }
              const payload = parsed.value
              const project = await resolveProject(payload?.workspace)
              const baseRev = Number.isFinite(payload?.baseRev) ? payload.baseRev : undefined
              const ops = Array.isArray(payload?.ops) ? payload.ops : []
              if (ops.length === 0) {
                send(response, 400, { error: 'ops 不能为空' })
                return
              }
              const doc = await storeOf(project.root).update((base) => {
                if (baseRev !== undefined && base.rev !== baseRev) throw new ConflictError(base)
                return mutate(base, ops)
              })
              const result = report(project, doc)
              send(response, 200, {
                project,
                rev: doc.rev,
                doc: result.doc,
                diagnostics: result.diagnostics,
                counts: result.counts,
              })
            } catch (error) {
              sendFailure(response, error)
            }
          },
        }),

        webServer.register({
          kind: 'exact',
          path: '/embedded-wiring/init',
          handler: async (request, response) => {
            try {
              if (!guardWrite(request, response)) return
              const parsed = await readJsonBody(request)
              if (parsed.status !== undefined) {
                send(response, parsed.status, { error: parsed.message })
                return
              }
              const project = await resolveProject(parsed.value?.workspace)
              const stored = await storeOf(project.root).read()
              if (stored.error !== undefined) {
                send(response, 400, { error: stored.error })
                return
              }
              if (stored.doc !== undefined) {
                const result = report(project, stored.doc)
                send(response, 200, {
                  project,
                  rev: stored.doc.rev,
                  doc: result.doc,
                  diagnostics: result.diagnostics,
                  counts: result.counts,
                })
                return
              }
              const doc = await storeOf(project.root).update(base => (base.parts.length > 0 || base.nets.length > 0
                ? base
                : Object.assign(starterDocument(), { rev: base.rev })))
              const result = report(project, doc)
              send(response, 200, {
                project,
                rev: doc.rev,
                doc: result.doc,
                diagnostics: result.diagnostics,
                counts: result.counts,
              })
            } catch (error) {
              sendFailure(response, error)
            }
          },
        }),

        webServer.register({
          kind: 'exact',
          path: '/embedded-wiring/library',
          resource: () => json(catalog()),
        }),
      ]
      return () => {
        routeMounted = false
        for (const dispose of routes) {
          if (typeof dispose === 'function') dispose()
        }
      }
    })
  }

  mountRoutes(ctx.get('webServer'))
  if (!routeMounted && typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], () => mountRoutes(ctx.get('webServer')))
  }

  // ---- Agent tool ---------------------------------------------------------

  const MUTATING = new Set([
    'add_part', 'update_part', 'remove_part', 'connect', 'disconnect', 'unlink',
    'set_net', 'move', 'set_meta', 'propose', 'apply_pending', 'discard_pending',
  ])

  /** Turn one tool call into the op batch the page would post. */
  function opsOf(args) {
    switch (args.action) {
      case 'add_part':
        if (args.part === undefined) throw new WiringError('add_part 需要 part 对象（至少 model，或自定义 pins）')
        return [{ type: 'add_part', part: args.at === undefined ? args.part : { ...args.part, at: args.at } }]
      case 'update_part':
        return [{ type: 'update_part', id: args.id, patch: args.patch }]
      case 'remove_part':
        return [{ type: 'remove_part', id: args.id }]
      case 'connect':
        return [{ type: 'connect', nodes: args.nodes, net: args.net }]
      case 'disconnect':
        return [{ type: 'disconnect', netId: args.netId }]
      case 'unlink':
        return [{ type: 'unlink', node: args.nodes?.[0] }]
      case 'set_net':
        return [{ type: 'set_net', netId: args.netId, patch: args.patch }]
      case 'move':
        return [{ type: 'move', id: args.id, at: args.at }]
      case 'set_meta':
        return [{ type: 'set_meta', patch: args.patch }]
      case 'propose':
        return [{ type: 'propose', note: args.note, ops: args.ops }]
      case 'apply_pending':
        return [{ type: 'apply_pending', id: args.id }]
      case 'discard_pending':
        return [{ type: 'discard_pending', id: args.id }]
      default:
        throw new WiringError(`未知 action：${args.action}`)
    }
  }

  ctx.tools.register({
    name: 'hardware_map',
    description: [
      'Read or change the embedded hardware wiring netlist of the current project (hardware/wiring.json).',
      'Use action "read" before discussing pins, power, or code generation: it returns parts, nets, unconnected pins, and diagnostics.',
      'Nodes are "partId:pinName", for example "mcu:GPIO4" or "dht:DATA".',
      'The ESP32 board model is "esp32-devkitc"; module models come from the library (dht22, bme280, ssd1306, sg90, relay, ...).',
      'When the user sends a photo of a module: identify it, then call add_part with an explicit "pins" array (name, role, volt, maxVolt, side) and part.source "photo"; keep it unverified until the user confirms the pin order on the wiring page, and say what you assumed.',
      'Changes that the user should see and confirm first go through action "propose" with the same ops; the user applies them on the wiring page, or you call "apply_pending" when they say so.',
      'Electrical problems do not block a write: they come back as diagnostics with severity error/warning.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'read', 'check', 'add_part', 'update_part', 'remove_part', 'connect',
            'disconnect', 'unlink', 'set_net', 'move', 'set_meta',
            'propose', 'apply_pending', 'discard_pending',
          ],
          description: 'read/check do not modify the file; every other action writes.',
        },
        project: {
          type: 'string',
          description: 'Workspace id or absolute directory. Defaults to the session working directory.',
        },
        nodes: {
          type: 'array',
          items: { type: 'string' },
          description: 'connect: two or more "partId:pin" nodes. unlink: the single node to detach.',
        },
        net: {
          type: 'object',
          additionalProperties: true,
          description: 'connect: optional { name, kind, volt, protocol, attrs } to override the inferred net.',
        },
        netId: {
          type: 'string',
          description: 'disconnect/set_net: net id such as "n3".',
        },
        part: {
          type: 'object',
          additionalProperties: true,
          description: 'add_part: { id?, model?, label?, pins?, source?, verified?, note? }. pins is [{ name, role, side?, volt?, maxVolt?, note? }] for a custom or photo-recognized part; side is "left" or "right" and defaults to left for modules, right for boards. source "photo" marks pins the user should confirm.',
        },
        id: {
          type: 'string',
          description: 'update_part/remove_part/move: part id. apply_pending/discard_pending: pending id (omit for all).',
        },
        patch: {
          type: 'object',
          additionalProperties: true,
          description: 'update_part: { label?, note?, at?, pins?, source?, verified? } — set verified true once the user confirms photo-recognized pins. set_net: { name?, kind?, volt?, protocol?, attrs?, color?, nodes? }. set_meta: { title?, board?, note? }.',
        },
        at: {
          type: 'array',
          items: { type: 'number' },
          description: 'Placement hint [x, y] in the diagram; optional, layout is the page\'s business.',
        },
        note: { type: 'string', description: 'propose: why this change is suggested.' },
        ops: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
          description: 'propose: the op batch to suggest, same shape as connect/add_part/etc.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const action = args?.action
      if (typeof action !== 'string') throw new WiringError('需要 action')
      const project = await projectForTool(args, exec)
      const store = storeOf(project.root)
      const stored = await store.read()
      if (stored.error !== undefined) throw new WiringError(stored.error)

      if (action === 'read' || action === 'check') {
        if (stored.doc === undefined) {
          return { text: `${summaryText({ project, doc: emptyDocument(), diagnostics: [] })}\n（项目还没有接线文件，首次写入时会创建）` }
        }
        const result = report(project, stored.doc)
        return { text: result.text }
      }
      if (!MUTATING.has(action)) throw new WiringError(`未知 action：${action}`)
      if (args.ops !== undefined && action !== 'propose' && !Array.isArray(args.ops)) {
        throw new WiringError('ops 必须是操作数组')
      }
      const ops = opsOf(args)
      const doc = await store.update(base => mutate(base, ops))
      const done = action === 'propose'
        ? `已记录 ${1} 条待确认建议（用户在接线页确认后生效）`
        : action === 'apply_pending' ? '已应用待确认的改动'
          : action === 'discard_pending' ? '已忽略待确认的改动'
            : `已写入（${ops.map(op => op.type).join(', ')}）`
      return { text: report(project, doc, done).text }
    },
  })
}
