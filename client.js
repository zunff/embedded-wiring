/**
 * Embedded wiring — the browser half.
 *
 * A full-page canvas in the `main` slot: parts are cards, nets are curves, and
 * every gesture becomes one op batch posted to the Host. The page never keeps
 * its own copy of the document: it reads the file's `rev`, posts ops against
 * that base, and adopts whatever comes back. An agent writing the same file
 * through `hardware_map` therefore shows up here on the next poll, and a stale
 * write is reported instead of silently overwriting the other writer.
 *
 * Layout is this file's business alone: the agent never needs coordinates.
 *
 * @module @local/embedded-wiring/client
 */

window.__ModuleLoader__.load({
  id: '@local/embedded-wiring',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const ENDPOINT = '/embedded-wiring'
    const POLL_MS = 2500
    const PART_W = 210
    const HEAD = 30
    const PAD_TOP = 8
    const ROW = 20
    const PAD_BOTTOM = 10
    const NET_COLORS = { power: '#e8590c', ground: '#868e96', signal: '#1c7ed6', bus: '#9c36b5' }
    const ICONS = ['🧠', '🎤', '📢', '🔊', '⚙️', '🛞', '🖥️', '🌡️', '🧭', '☀️', '📡', '💡', '🔘', '🎛️', '🔋', '⚡', '🔌', '🌈', '💾', '🔔', '🕹️', '🧩']
    const STYLE_ATTR = 'data-ew-style'
    const STORAGE_WS = 'ew.workspace'
    const STORAGE_PROJECT = 'ew.project'

    const CSS = `
.ew-root{position:relative;display:flex;flex-direction:column;flex:1 1 auto;height:100%;min-height:0;overflow:hidden;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary,#17181c);background:var(--dsw-alias-bg-layer-1,#fff);font-variant-numeric:tabular-nums}
.ew-root *{box-sizing:border-box}
.ew-root button,.ew-root input,.ew-root select{font-family:inherit;font-size:inherit;color:inherit}
.ew-bar{display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(20,22,30,.1));background:var(--dsw-alias-bg-layer-2,#f5f6f7);flex:0 0 auto;flex-wrap:wrap}
.ew-grow{flex:1 1 auto}
.ew-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(20,22,30,.16));background:var(--dsw-alias-bg-layer-1,#fff);border-radius:6px;padding:3px 9px;font-size:11.5px;cursor:pointer;white-space:nowrap}
.ew-btn:hover{background:var(--dsw-alias-bg-layer-2,#f5f6f7)}
.ew-btn[aria-pressed=true]{border-color:var(--dsw-alias-brand-primary,#4c8dff);color:var(--dsw-alias-brand-primary,#4c8dff)}
.ew-btn:disabled{opacity:.5;cursor:default}
.ew-btn-danger{color:var(--dsw-alias-state-error-primary,#e03131);border-color:var(--dsw-alias-state-error-primary,#e03131)}
.ew-select{border:1px solid var(--dsw-alias-border-l2,rgba(20,22,30,.16));background:var(--dsw-alias-bg-layer-1,#fff);border-radius:6px;padding:3px 6px;font-size:11.5px;max-width:240px}
.ew-badge{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8b909a)}
.ew-status{font-size:11px;color:var(--dsw-alias-label-secondary,#5c6068);max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ew-alert{padding:6px 12px;font-size:11.5px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(20,22,30,.1));background:rgba(212,155,0,.08);color:var(--dsw-alias-state-warn-primary,#a87900);flex:0 0 auto}
.ew-alert-error{background:rgba(224,49,49,.07);color:var(--dsw-alias-state-error-primary,#c92a2a)}
.ew-viewport{position:relative;flex:1 1 auto;min-height:0;overflow:hidden;cursor:grab;background-image:radial-gradient(circle,var(--dsw-alias-border-l2,rgba(20,22,30,.16)) 1px,transparent 1px);background-size:24px 24px}
.ew-viewport[data-panning=true]{cursor:grabbing}
.ew-world{position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none}
.ew-wires{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
.ew-wire-hits{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
.ew-wire{fill:none;stroke-linecap:round}
.ew-wire-halo{fill:none;stroke:var(--dsw-alias-bg-layer-1,#fff);stroke-width:5;stroke-linecap:round}
.ew-wire-hit{pointer-events:stroke;cursor:pointer;fill:none;stroke:transparent;stroke-width:14;stroke-linecap:round}
.ew-part{position:absolute;pointer-events:auto;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(20,22,30,.18));border-radius:8px;box-shadow:0 1px 2px rgba(10,12,20,.06);user-select:none}
.ew-part[data-selected=true]{border-color:var(--dsw-alias-brand-primary,#4c8dff);box-shadow:0 0 0 2px rgba(76,141,255,.18)}
.ew-part[data-dragging=true]{box-shadow:0 8px 24px rgba(10,12,20,.18)}
.ew-part-head{height:30px;display:flex;align-items:center;justify-content:space-between;gap:6px;padding:0 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(20,22,30,.1));cursor:grab;border-radius:8px 8px 0 0;background:var(--dsw-alias-bg-layer-2,#f5f6f7)}
.ew-part-label{font-weight:600;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ew-part-icon{flex:0 0 auto;font-size:12px;line-height:1}
.ew-part-id{font-size:10px;color:var(--dsw-alias-label-tertiary,#8b909a);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;flex:0 0 auto;cursor:copy}
.ew-part-id:hover{color:var(--dsw-alias-brand-primary,#4c8dff)}
.ew-copyable{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;min-width:0}
.ew-pin{position:absolute;width:50%;height:20px;display:flex;align-items:center;gap:4px;padding:0 10px;font-size:11px;color:var(--dsw-alias-label-secondary,#5c6068);white-space:nowrap}
.ew-pin[data-side=left]{left:0;justify-content:flex-start}
.ew-pin[data-side=right]{right:0;justify-content:flex-end}
.ew-pin[data-wide=true]{width:100%}
.ew-pin-name{overflow:hidden;text-overflow:ellipsis;flex:0 1 auto;min-width:0}
.ew-used{color:var(--dsw-alias-label-primary,#17181c);font-weight:500}
.ew-pin[data-role=power] .ew-pin-name{color:var(--dsw-alias-state-error-primary,#e03131)}
.ew-pin[data-role=ground] .ew-pin-name{color:var(--dsw-alias-label-tertiary,#8b909a)}
.ew-pin-note{font-size:9.5px;color:var(--dsw-alias-label-tertiary,#a0a5ad);overflow:hidden;text-overflow:ellipsis;flex:0 1 auto;min-width:0;margin-left:auto;text-align:right}
.ew-flag{font-size:9px;line-height:1;border-radius:4px;padding:2px 4px;flex:0 0 auto;background:rgba(212,155,0,.14);color:#a87900}
.ew-flag[data-ok=true]{background:rgba(47,158,68,.14);color:#2f9e44}
.ew-pin-dot{position:absolute;width:9px;height:9px;border-radius:50%;background:var(--dsw-alias-bg-layer-1,#fff);border:1.5px solid var(--dsw-alias-label-tertiary,#8b909a);cursor:crosshair;z-index:2;transition:transform .1s}
.ew-pin-dot:hover{transform:scale(1.4);border-color:var(--dsw-alias-brand-primary,#4c8dff);background:var(--dsw-alias-brand-primary,#4c8dff)}
.ew-pin[data-side=left] .ew-pin-dot{left:-5px}
.ew-pin[data-side=right] .ew-pin-dot{right:-5px}
.ew-pin[data-used][data-side=left] .ew-pin-dot{left:-6px;width:11px;height:11px}
.ew-pin[data-used][data-side=right] .ew-pin-dot{right:-6px;width:11px;height:11px}
.ew-panel{position:absolute;top:10px;right:10px;width:258px;max-height:calc(100% - 20px);overflow:auto;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(20,22,30,.16));border-radius:10px;box-shadow:0 8px 24px rgba(10,12,20,.14);padding:10px;z-index:6}
.ew-panel-title{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:600;font-size:11.5px;margin-bottom:8px}
.ew-row{display:flex;align-items:center;gap:6px;margin-bottom:6px}
.ew-row label{flex:0 0 42px;color:var(--dsw-alias-label-tertiary,#8b909a);font-size:10.5px}
.ew-input{flex:1 1 auto;min-width:0;border:1px solid var(--dsw-alias-border-l2,rgba(20,22,30,.16));background:var(--dsw-alias-bg-layer-1,#fff);border-radius:5px;padding:2px 6px;font-size:11px}
.ew-node{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:10.5px;padding:2px 0;border-bottom:1px dashed var(--dsw-alias-border-l1,rgba(20,22,30,.1))}
.ew-pinrow{display:flex;align-items:center;gap:4px;font-size:10.5px;padding:2px 0;border-bottom:1px dashed var(--dsw-alias-border-l1,rgba(20,22,30,.1))}
.ew-pinrow code{font-size:10.5px;min-width:46px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.ew-pinrow .ew-badge{flex:1 1 auto;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ew-pin-btn{padding:0 4px;font-size:9.5px;line-height:15px;min-width:16px}
.ew-pin-actions{display:flex;gap:4px;margin:4px 0 2px;flex-wrap:wrap}
.ew-node code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10.5px}
.ew-x{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#8b909a);cursor:pointer;font-size:11px;padding:0 2px;line-height:1}
.ew-x:hover{color:var(--dsw-alias-state-error-primary,#e03131)}
.ew-pending{position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;max-width:min(620px,calc(100% - 300px));background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-brand-primary,#4c8dff);border-radius:999px;padding:5px 10px;box-shadow:0 6px 18px rgba(10,12,20,.14);font-size:11px;z-index:7}
.ew-pending-note{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ew-diagnostics{flex:0 0 auto;max-height:172px;overflow:auto;border-top:1px solid var(--dsw-alias-border-l1,rgba(20,22,30,.1));background:var(--dsw-alias-bg-layer-2,#f5f6f7)}
.ew-diag{display:flex;align-items:flex-start;gap:7px;padding:4px 12px;font-size:11px}
.ew-diag:hover{background:var(--dsw-alias-bg-layer-1,#fff)}
.ew-diag-dot{width:6px;height:6px;border-radius:50%;margin-top:6px;flex:0 0 auto}
.ew-diag[data-severity=error] .ew-diag-dot{background:var(--dsw-alias-state-error-primary,#e03131)}
.ew-diag[data-severity=warning] .ew-diag-dot{background:var(--dsw-alias-state-warn-primary,#d49b00)}
.ew-diag-code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10px;color:var(--dsw-alias-label-tertiary,#8b909a);flex:0 0 auto;min-width:92px}
.ew-diag-text{flex:1 1 auto}
.ew-diag-go{appearance:none;border:0;background:transparent;color:var(--dsw-alias-brand-primary,#4c8dff);cursor:pointer;font-size:10.5px;white-space:nowrap}
.ew-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px}
.ew-card{max-width:430px;border:1px solid var(--dsw-alias-border-l2,rgba(20,22,30,.16));border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);padding:18px 20px;box-shadow:0 8px 24px rgba(10,12,20,.1)}
.ew-card h3{margin:0 0 6px;font-size:14px}
.ew-card p{margin:0 0 10px;color:var(--dsw-alias-label-secondary,#5c6068);font-size:11.5px}
.ew-hint{position:absolute;left:12px;bottom:10px;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8b909a);background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.92));border:1px solid var(--dsw-alias-border-l1,rgba(20,22,30,.1));border-radius:6px;padding:3px 8px;z-index:4;pointer-events:none;max-width:calc(100% - 24px)}
.ew-palette{position:absolute;inset:0;background:rgba(10,12,20,.28);display:flex;align-items:flex-start;justify-content:center;padding:48px 16px;z-index:10}
.ew-palette-box{width:min(640px,100%);max-height:100%;overflow:auto;background:var(--dsw-alias-bg-layer-1,#fff);border-radius:12px;box-shadow:0 18px 48px rgba(10,12,20,.3);padding:14px 16px}
.ew-palette-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px}
.ew-palette-item{text-align:left;border:1px solid var(--dsw-alias-border-l1,rgba(20,22,30,.12));background:var(--dsw-alias-bg-layer-2,#f7f8f9);border-radius:8px;padding:7px 9px;cursor:pointer;font-size:11.5px}
.ew-palette-item:hover{border-color:var(--dsw-alias-brand-primary,#4c8dff);background:var(--dsw-alias-bg-layer-1,#fff)}
.ew-palette-item small{display:block;color:var(--dsw-alias-label-tertiary,#8b909a);font-size:10px}
`

    // ---- HTTP ---------------------------------------------------------------

    async function call(path, init) {
      const response = await fetch(ENDPOINT + path, {
        cache: 'no-store',
        ...init,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        const error = new Error(typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`)
        error.status = response.status
        error.payload = payload
        throw error
      }
      return payload
    }

    function post(path, value) {
      return call(path, { method: 'POST', body: JSON.stringify(value ?? {}) })
    }

    async function copyText(value) {
      try {
        if (navigator.clipboard !== undefined) {
          await navigator.clipboard.writeText(value)
          return true
        }
      } catch (error) {
        // Clipboard access can be refused; fall back to the old textarea trick.
      }
      try {
        const area = document.createElement('textarea')
        area.value = value
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.left = '-1000px'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        area.remove()
        return ok
      } catch (error) {
        return false
      }
    }

    // ---- Geometry -----------------------------------------------------------

    /** Pin edge as the data says, before mirroring or the automatic split. */
    function templateSide(part, pin) {
      if (pin.side === 'left' || pin.side === 'right') return pin.side
      return part.kind === 'board' ? 'right' : 'left'
    }

    const opposite = side => (side === 'left' ? 'right' : 'left')

    /**
     * Which edge a pin sits on. The side lives on the pin itself, so the pin can
     * be moved between columns by hand; `flip` mirrors the whole symbol and
     * `part.flip` is only ever set by the user or the automatic guess.
     */
    function sideOf(part, pin) {
      const side = templateSide(part, pin)
      return part.flip === true ? opposite(side) : side
    }

    /**
     * A module turns its pins towards the parts it is wired to: when they sit
     * past the middle of its own card, the symbol is mirrored. This is what
     * keeps a module dropped on the left of the board from routing every wire
     * around its card. Boards keep their official layout (J1 left, J3 right),
     * and an explicit `flip` on the part wins over this guess.
     */
    function autoMirrors(parts, nets) {
      const byId = new Map(parts.map(part => [part.id, part]))
      const neighbours = new Map()
      for (const net of nets) {
        const owners = net.nodes.map(node => node.split(':')[0])
        for (const owner of owners) {
          for (const other of owners) {
            if (other === owner) continue
            const part = byId.get(other)
            if (part === undefined) continue
            const list = neighbours.get(owner) ?? []
            list.push(part.at[0] + PART_W / 2)
            neighbours.set(owner, list)
          }
        }
      }
      const mirrors = new Map()
      for (const part of parts) {
        if (part.kind === 'board') continue
        if (part.pins.length === 0) continue
        // Pins placed by hand: the layout is the user's, not a guess.
        if (part.pinsManual === true) continue
        if (new Set(part.pins.map(pin => templateSide(part, pin))).size > 1) continue
        const list = neighbours.get(part.id)
        if (list === undefined) continue
        const target = list.reduce((sum, value) => sum + value, 0) / list.length
        const pinsLeft = templateSide(part, part.pins[0]) === 'left'
        const middle = part.at[0] + PART_W / 2
        mirrors.set(part.id, pinsLeft ? target > middle : target < middle)
      }
      return mirrors
    }

    /** A part as drawn: the mirror decision folded into its `flip` field. */
    function oriented(part, mirrors) {
      const flip = part.flip === undefined ? mirrors.get(part.id) === true : part.flip === true
      return { ...part, flip }
    }

    function sideCounts(part) {
      let left = 0
      let right = 0
      for (const pin of part.pins) {
        if (sideOf(part, pin) === 'right') right += 1
        else left += 1
      }
      return { left, right }
    }

    /** Row index inside its own edge, so the two columns number independently. */
    function rowOf(part, pin) {
      const side = sideOf(part, pin)
      let row = 0
      for (const candidate of part.pins) {
        if (candidate === pin) return row
        if (sideOf(part, candidate) === side) row += 1
      }
      return 0
    }

    function rowCount(part) {
      const counts = sideCounts(part)
      return Math.max(counts.left, counts.right)
    }

    function partHeight(part) {
      return HEAD + PAD_TOP + rowCount(part) * ROW + PAD_BOTTOM
    }

    function pinX(part, pin) {
      return sideOf(part, pin) === 'right' ? part.at[0] + PART_W : part.at[0]
    }

    function pinY(part, row) {
      return part.at[1] + HEAD + PAD_TOP + row * ROW + ROW / 2
    }

    /** Pin anchors plus the card rectangles a wire has to stay out of. */
    function scene(parts) {
      const anchors = new Map()
      const cards = []
      for (const part of parts) {
        cards.push({ x: part.at[0], y: part.at[1], w: PART_W, h: partHeight(part) })
        for (const pin of part.pins) {
          anchors.set(`${part.id}:${pin.name}`, {
            x: pinX(part, pin),
            y: pinY(part, rowOf(part, pin)),
            side: sideOf(part, pin),
          })
        }
      }
      return { anchors, cards }
    }

    // ---- Routing ------------------------------------------------------------
    // Wires are drawn the way the circuit simulators do it: Fritzing bends a
    // Bézier between two pins, Wokwi runs free horizontal/vertical segments, and
    // neither tries to dodge the parts — the user moves things instead. So a
    // wire leaves its pin sideways, curves to the other pin, and is drawn *above*
    // the cards with a thin halo, which means a wire crossing a card stays
    // readable instead of taking a long detour around it.

    const HANDLE = 0.4
    const HANDLE_MIN = 24
    const HANDLE_MAX = 160

    const outward = side => (side === 'right' ? 1 : -1)
    const num = value => Math.round(value * 10) / 10

    function curvePath(from, to) {
      const span = Math.hypot(to.x - from.x, to.y - from.y)
      const handle = Math.min(HANDLE_MAX, Math.max(HANDLE_MIN, span * HANDLE))
      const c1x = from.x + outward(from.side) * handle
      const c2x = to.x + outward(to.side) * handle
      return `M ${num(from.x)} ${num(from.y)} C ${num(c1x)} ${num(from.y)}, ${num(c2x)} ${num(to.y)}, ${num(to.x)} ${num(to.y)}`
    }

    /**
     * A net with many pins is drawn as a tree, not a star: Prim's algorithm on
     * Manhattan distance picks the shortest set of segments that still joins
     * every pin. Two pins give one segment, eleven give ten short ones.
     */
    function spanningSegments(points) {
      if (points.length < 2) return []
      const picked = [0]
      const left = points.map((point, index) => index).slice(1)
      const segments = []
      while (left.length > 0) {
        let best
        for (let index = 0; index < left.length; index += 1) {
          const a = points[left[index]]
          for (const chosen of picked) {
            const b = points[chosen]
            const cost = Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
            if (best === undefined || cost < best.cost) {
              best = { cost, from: chosen, to: left[index], at: index }
            }
          }
        }
        picked.push(best.to)
        left.splice(best.at, 1)
        segments.push([points[best.from], points[best.to]])
      }
      return segments
    }

    function wirePath(anchors, net) {
      const points = net.nodes.map(node => anchors.get(node)).filter(Boolean)
      if (points.length < 2) return ''
      return spanningSegments(points)
        .map(segment => curvePath(segment[0], segment[1]))
        .join(' ')
    }

    // ---- Auto layout --------------------------------------------------------
    // "一键整理" builds a schematic around the board: the board never moves (its
    // pins and their edges are physical), every other part is placed on the side
    // of the pin it is wired to and lined up with that pin, and a short pass then
    // pushes overlapping cards apart. Pure geometry, so the tests cover it.

    const TIDY = { gap: 90, margin: 56, rounds: 90, grid: 10 }

    const ownerOf = node => node.slice(0, node.lastIndexOf(':'))

    /** Where a parent's pins and a child's pins sit, relative to their cards. */
    function contactOf(anchors, nets, parent, child) {
      let px = 0
      let py = 0
      let cx = 0
      let cy = 0
      let count = 0
      let side = 'right'
      for (const net of nets) {
        const nodes = net.nodes
        const mine = nodes.filter(node => ownerOf(node) === parent.id)
        if (mine.length === 0) continue
        if (!nodes.some(node => ownerOf(node) === child.id)) continue
        for (const node of nodes) {
          const anchor = anchors.get(node)
          if (anchor === undefined) continue
          if (ownerOf(node) === parent.id) {
            px += anchor.x - parent.at[0]
            py += anchor.y - parent.at[1]
            side = anchor.side
          } else if (ownerOf(node) === child.id) {
            cx += anchor.x - child.at[0]
            cy += anchor.y - child.at[1]
          }
        }
        count += 1
      }
      if (count === 0) return undefined
      return { px: px / count, py: py / count, cx: cx / count, cy: cy / count, side }
    }

    function tidyParts(parts, nets) {
      if (parts.length === 0) return new Map()
      const byId = new Map(parts.map(part => [part.id, part]))
      const anchors = scene(parts).anchors
      // How much a net says about "these two belong together": a ground net
      // touches everything, so it is a weak hint; a signal net is a strong one.
      const importance = net => (net.kind === 'ground' ? 0.2 : net.kind === 'power' ? 0.6 : 1)
      const edges = new Map()
      for (const net of nets) {
        const owners = [...new Set(net.nodes.map(ownerOf))].filter(id => byId.has(id))
        const weight = importance(net)
        for (let a = 0; a < owners.length; a += 1) {
          for (let b = a + 1; b < owners.length; b += 1) {
            for (const [from, to] of [[owners[a], owners[b]], [owners[b], owners[a]]]) {
              const row = edges.get(from) ?? new Map()
              row.set(to, (row.get(to) ?? 0) + weight)
              edges.set(from, row)
            }
          }
        }
      }
      const degree = id => [...(edges.get(id) ?? new Map()).values()].reduce((sum, value) => sum + value, 0)
      // The board is the anchor; without one, the most connected part is.
      const boards = parts.filter(part => part.kind === 'board')
      const pool = boards.length > 0 ? boards : parts
      const hub = pool.reduce((best, part) => (degree(part.id) > degree(best.id) ? part : best))

      // A spanning tree grown from the anchor by the strongest link, so a module
      // hangs off the part it actually talks to rather than off the ground net.
      const placed = new Map([[hub.id, { x: hub.at[0], y: hub.at[1] }]])
      const flips = new Map()
      const pending = new Set(parts.map(part => part.id).filter(id => id !== hub.id))
      while (pending.size > 0) {
        let best
        for (const id of pending) {
          for (const [other, weight] of (edges.get(id) ?? new Map()).entries()) {
            if (!placed.has(other)) continue
            if (best === undefined || weight > best.weight) best = { id, parent: other, weight }
          }
        }
        if (best === undefined) break
        const parent = byId.get(best.parent)
        const child = byId.get(best.id)
        const contact = contactOf(anchors, nets, parent, child)
        const at = placed.get(parent.id)
        if (contact === undefined) {
          placed.set(child.id, { x: child.at[0], y: child.at[1] })
          pending.delete(child.id)
          continue
        }
        // A column further out on the side the shared pin faces, lined up pin to pin.
        placed.set(child.id, {
          x: contact.side === 'left' ? at.x - TIDY.gap - PART_W : at.x + PART_W + TIDY.gap,
          y: at.y + contact.py - contact.cy,
        })
        // A part hanging to the left of its parent should show its pins on its
        // own right edge, i.e. facing the parent. A hand-arranged pin layout is
        // left exactly as the user made it.
        const uniform = new Set(child.pins.map(pin => templateSide(child, pin))).size === 1
        if (child.kind !== 'board' && child.pinsManual !== true && uniform && child.pins.length > 0) {
          const showing = templateSide(child, child.pins[0])
          const wanted = contact.side === 'left' ? 'right' : 'left'
          flips.set(child.id, showing !== wanted)
        }
        pending.delete(child.id)
      }
      for (const part of parts) {
        if (!placed.has(part.id)) placed.set(part.id, { x: part.at[0], y: part.at[1] })
      }

      // Cards must not overlap; the hub never moves, so it pushes the others.
      const boxes = parts.map(part => ({
        id: part.id,
        x: placed.get(part.id).x,
        y: placed.get(part.id).y,
        w: PART_W,
        h: partHeight(part),
      }))
      for (let round = 0; round < TIDY.rounds; round += 1) {
        let moved = false
        for (let a = 0; a < boxes.length; a += 1) {
          for (let b = a + 1; b < boxes.length; b += 1) {
            const from = boxes[a]
            const to = boxes[b]
            const dx = (to.x + to.w / 2) - (from.x + from.w / 2)
            const dy = (to.y + to.h / 2) - (from.y + from.h / 2)
            const across = (from.w + to.w) / 2 + TIDY.margin - Math.abs(dx)
            const down = (from.h + to.h) / 2 + TIDY.margin - Math.abs(dy)
            if (across <= 0 || down <= 0) continue
            moved = true
            const fixedFrom = from.id === hub.id
            const fixedTo = to.id === hub.id
            const shareFrom = fixedFrom ? 0 : fixedTo ? 1 : 0.5
            const shareTo = fixedTo ? 0 : fixedFrom ? 1 : 0.5
            if (across < down) {
              const dir = dx >= 0 ? 1 : -1
              from.x -= (across / 2) * 2 * shareFrom * dir
              to.x += (across / 2) * 2 * shareTo * dir
            } else {
              const dir = dy >= 0 ? 1 : -1
              from.y -= (down / 2) * 2 * shareFrom * dir
              to.y += (down / 2) * 2 * shareTo * dir
            }
          }
        }
        if (!moved) break
      }
      const positions = new Map()
      for (const box of boxes) {
        if (box.id === hub.id) {
          positions.set(box.id, [hub.at[0], hub.at[1]])
          continue
        }
        positions.set(box.id, [
          Math.round(box.x / TIDY.grid) * TIDY.grid,
          Math.round(box.y / TIDY.grid) * TIDY.grid,
        ])
      }
      return { positions, flips }
    }

    function contentBounds(doc) {
      if (doc.parts.length === 0) return undefined
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const part of doc.parts) {
        minX = Math.min(minX, part.at[0])
        minY = Math.min(minY, part.at[1])
        maxX = Math.max(maxX, part.at[0] + PART_W)
        maxY = Math.max(maxY, part.at[1] + partHeight(part))
      }
      return { minX, minY, width: maxX - minX, height: maxY - minY }
    }

    // ---- Small pieces -------------------------------------------------------

    function WiringIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 16
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 5.5, y: 5.5, width: 5, height: 5, rx: 1, fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', {
          d: 'M2 3.5h3M11 3.5h3M2 12.5h3M11 12.5h3M2 8h3.5M10.5 8H14',
          stroke: 'currentColor',
          strokeWidth: 1.1,
          strokeLinecap: 'round',
        }),
        h('circle', { cx: 8, cy: 8, r: 1.1, fill: 'currentColor' }))
    }

    function Button(props) {
      return h('button', {
        type: 'button',
        className: props.className === undefined ? 'ew-btn' : `ew-btn ${props.className}`,
        onClick: props.onClick,
        disabled: props.disabled,
        'aria-pressed': props.pressed,
        title: props.title,
      }, props.children)
    }

    function NetInspector({ net, onPatch, onDisconnect, onUnlink, onClose }) {
      const attrs = net.attrs ?? {}
      const blurCommit = (field) => (event) => {
        const value = event.target.value
        if (field === 'name') {
          if (value.trim() !== '' && value !== net.name) onPatch({ name: value })
          return
        }
        if (field === 'protocol') {
          if (value !== (net.protocol ?? '')) onPatch({ protocol: value })
          return
        }
        if (field === 'pullup') {
          const next = { ...attrs }
          if (value.trim() === '') delete next.pullup
          else next.pullup = value.trim()
          onPatch({ attrs: next })
        }
      }
      const rows = [
        h('div', { className: 'ew-row', key: 'name' },
          h('label', {}, '名称'),
          h('input', {
            className: 'ew-input',
            defaultValue: net.name,
            onBlur: blurCommit('name'),
            onKeyDown: event => { if (event.key === 'Enter') event.target.blur() },
          })),
        h('div', { className: 'ew-row', key: 'kind' },
          h('label', {}, '类型'),
          h('select', {
            className: 'ew-select',
            value: net.kind,
            onChange: event => onPatch({ kind: event.target.value }),
          },
          h('option', { value: 'power' }, '电源'),
          h('option', { value: 'ground' }, '地'),
          h('option', { value: 'signal' }, '信号'),
          h('option', { value: 'bus' }, '总线'))),
        h('div', { className: 'ew-row', key: 'protocol' },
          h('label', {}, '协议'),
          h('input', {
            className: 'ew-input',
            placeholder: 'i2c / spi / uart',
            defaultValue: net.protocol ?? '',
            onBlur: blurCommit('protocol'),
            onKeyDown: event => { if (event.key === 'Enter') event.target.blur() },
          })),
        h('div', { className: 'ew-row', key: 'pullup' },
          h('label', {}, '上拉'),
          h('input', {
            className: 'ew-input',
            placeholder: '4.7k',
            defaultValue: attrs.pullup ?? '',
            onBlur: blurCommit('pullup'),
            onKeyDown: event => { if (event.key === 'Enter') event.target.blur() },
          })),
      ]
      return h('div', { className: 'ew-panel' },
        h('div', { className: 'ew-panel-title' },
          h('span', {}, `网络 ${net.id}`),
          h('button', { type: 'button', className: 'ew-x', onClick: onClose, title: '关闭' }, '✕')),
        rows,
        h('div', { style: { margin: '8px 0 4px', fontSize: '10.5px', color: 'var(--dsw-alias-label-tertiary,#8b909a)' } }, `节点 ${net.nodes.length}`),
        net.nodes.map(node => h('div', { className: 'ew-node', key: node },
          h('code', {}, node),
          h('button', { type: 'button', className: 'ew-x', title: '断开这个引脚', onClick: () => onUnlink(node) }, '✕'))),
        h('div', { style: { marginTop: '10px' } },
          h(Button, { className: 'ew-btn-danger', onClick: onDisconnect }, '删除网络')))
    }

    function PartInspector({ part, flipped, onRemove, onVerify, onFlip, onAuto, onIcon, onPinSide, onPinMove, onPinLayout, onCopy, onClose }) {
      const mode = part.flip === undefined ? (flipped ? '自动 · 朝右' : '自动 · 朝左') : (flipped ? '已翻转' : '不翻转')
      return h('div', { className: 'ew-panel' },
        h('div', { className: 'ew-panel-title' },
          h('span', {}, part.label),
          h('button', { type: 'button', className: 'ew-x', onClick: onClose, title: '关闭' }, '✕')),
        h('div', { className: 'ew-node' },
          h('span', { className: 'ew-copyable' }, part.label),
          h(Button, { onClick: () => onCopy(part.label), title: '复制名称' }, '复制')),
        h('div', { className: 'ew-node' },
          h('code', {}, part.id),
          h('span', { className: 'ew-badge' }, part.kind === 'board' ? '板卡' : '模块'),
          h(Button, { onClick: () => onCopy(part.id), title: '复制 id' }, '复制')),
        h('div', { className: 'ew-node' }, h('span', {}, '型号'), h('code', {}, part.model)),
        h('div', { className: 'ew-node' },
          h('span', {}, '图标'),
          h('select', {
            className: 'ew-select',
            value: part.icon ?? '',
            onChange: event => onIcon(event.target.value),
          },
          h('option', { value: '' }, '无'),
          ICONS.map(icon => h('option', { key: icon, value: icon }, icon)))),
        h('div', { className: 'ew-node' },
          h('span', {}, '引脚朝向'),
          h('span', { className: 'ew-badge' }, mode)),
        h('div', { style: { display: 'flex', gap: '6px', margin: '4px 0 8px' } },
          h(Button, { onClick: onFlip }, '⇋ 翻转'),
          part.flip === undefined ? null : h(Button, { onClick: onAuto }, '↺ 自动')),
        part.source === undefined ? null : h('div', { className: 'ew-node' },
          h('span', {}, '来源'),
          h('span', { className: 'ew-badge' }, part.source === 'photo'
            ? (part.verified === true ? '照片识别 · 已核对' : '照片识别 · 待核对')
            : '手工添加')),
        part.note === undefined ? null : h('div', {
          style: { fontSize: '10.5px', color: 'var(--dsw-alias-label-secondary,#5c6068)', margin: '6px 0' },
        }, part.note),
        h('div', { style: { margin: '8px 0 2px', fontSize: '10.5px', color: 'var(--dsw-alias-label-tertiary,#8b909a)' } }, `引脚 ${part.pins.length}`),
        h('div', { className: 'ew-pin-actions' },
          h(Button, { onClick: () => onPinLayout(part, 'left'), title: '全部放左边一列' }, '全左'),
          h(Button, { onClick: () => onPinLayout(part, 'split'), title: '一半放左、一半放右' }, '对半分'),
          h(Button, { onClick: () => onPinLayout(part, 'right'), title: '全部放右边一列' }, '全右'),
          h(Button, { onClick: () => onPinLayout(part, 'swap'), title: '左右列对调' }, '⇋ 换边')),
        h('div', { className: 'ew-badge', style: { margin: '6px 0 2px', whiteSpace: 'normal' } }, '每个引脚单独调：点「左/右」换边，↑↓ 调顺序'),
        part.pins.map((pin, index) => h('div', { className: 'ew-pinrow', key: pin.name },
          h('code', {}, pin.name),
          h('span', { className: 'ew-badge' }, `${pin.role}${Number.isFinite(pin.volt) ? ` ${pin.volt}V` : ''}`),
          h('button', {
            type: 'button',
            className: 'ew-btn ew-pin-btn',
            title: '换到另一边',
            onClick: () => onPinSide(part, pin),
          }, sideOf(part, pin) === 'right' ? '右' : '左'),
          h('button', {
            type: 'button',
            className: 'ew-btn ew-pin-btn',
            title: '上移一行',
            disabled: index === 0,
            onClick: () => onPinMove(part, pin, -1),
          }, '↑'),
          h('button', {
            type: 'button',
            className: 'ew-btn ew-pin-btn',
            title: '下移一行',
            disabled: index === part.pins.length - 1,
            onClick: () => onPinMove(part, pin, 1),
          }, '↓'))),
        part.source === 'photo' && part.verified !== true
          ? h('div', { style: { marginTop: '10px' } },
            h(Button, { onClick: onVerify }, '标记引脚已核对'))
          : null,
        h('div', { style: { marginTop: '10px' } },
          h(Button, { className: 'ew-btn-danger', onClick: onRemove }, '删除部件')))
    }

    function Palette({ library, onPick, onClose }) {
      const group = (title, items) => h('div', { key: title, style: { marginBottom: '12px' } },
        h('div', { style: { fontSize: '10.5px', color: 'var(--dsw-alias-label-tertiary,#8b909a)', marginBottom: '5px' } }, title),
        h('div', { className: 'ew-palette-grid' },
          items.map(item => h('button', {
            key: item.model,
            type: 'button',
            className: 'ew-palette-item',
            onClick: () => onPick(item.model),
          },
          item.icon === undefined ? item.label : `${item.icon} ${item.label}`,
          h('small', {}, `${item.model} · ${item.pins} 脚`)))))
      return h('div', {
        className: 'ew-palette',
        onPointerDown: event => { if (event.target === event.currentTarget) onClose() },
      },
      h('div', { className: 'ew-palette-box' },
        h('div', { className: 'ew-panel-title' },
          h('span', {}, '添加硬件'),
          h('button', { type: 'button', className: 'ew-x', onClick: onClose, title: '关闭' }, '✕')),
        group('板卡', library.boards ?? []),
        group('模块', library.parts ?? [])))
    }

    /** Ask for a directory and a board, then create the netlist there. */
    function NewProject({ boards, defaultPath, onCreate, onCancel }) {
      const [path, setPath] = useState(defaultPath === undefined || defaultPath === '.' ? 'firmware' : defaultPath)
      const [board, setBoard] = useState(boards?.[0]?.model ?? 'esp32-devkitc')
      const trimmed = path.trim().replace(/^[/\\]+|[/\\]+$/g, '')
      return h('div', {
        className: 'ew-palette',
        onPointerDown: event => { if (event.target === event.currentTarget) onCancel() },
      },
      h('div', { className: 'ew-palette-box', style: { width: 'min(440px, 100%)' } },
        h('div', { className: 'ew-panel-title' },
          h('span', {}, '新建接线项目'),
          h('button', { type: 'button', className: 'ew-x', onClick: onCancel }, '✕')),
        h('div', { className: 'ew-row' },
          h('label', {}, '目录'),
          h('input', {
            className: 'ew-input',
            value: path,
            placeholder: 'firmware/sensor',
            onChange: event => setPath(event.target.value),
            onKeyDown: event => { if (event.key === 'Enter') onCreate(trimmed || '.', board) },
          })),
        h('div', { className: 'ew-row' },
          h('label', {}, '板卡'),
          h('select', {
            className: 'ew-select',
            value: board,
            onChange: event => setBoard(event.target.value),
          },
          (boards ?? []).map(item => h('option', { key: item.model, value: item.model }, item.label)))),
        h('div', {
          style: { fontSize: '10.5px', color: 'var(--dsw-alias-label-tertiary,#8b909a)', margin: '6px 0' },
        }, `文件：${trimmed === '' ? '' : `${trimmed}/`}hardware/wiring.json`),
        h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } },
          h(Button, { onClick: onCancel }, '取消'),
          h(Button, { onClick: () => onCreate(trimmed || '.', board) }, '创建'))))
    }

    // ---- Page ---------------------------------------------------------------

    function WiringPage() {
      const [workspaces, setWorkspaces] = useState([])
      const [workspaceId, setWorkspaceId] = useState(() => {
        try {
          return window.localStorage.getItem(STORAGE_WS) ?? ''
        } catch {
          return ''
        }
      })
      const [projectId, setProjectId] = useState(() => {
        try {
          return window.localStorage.getItem(STORAGE_PROJECT) ?? '.'
        } catch {
          return '.'
        }
      })
      const [state, setState] = useState({ exists: false, doc: undefined, diagnostics: [], counts: { errors: 0, warnings: 0 } })
      const [library, setLibrary] = useState({ boards: [], parts: [] })
      const [view, setView] = useState({ x: 40, y: 40, z: 1 })
      const [selected, setSelected] = useState(undefined)
      const [hoverNet, setHoverNet] = useState(undefined)
      const [drag, setDrag] = useState(undefined)
      const [drawing, setDrawing] = useState(undefined)
      const [palette, setPalette] = useState(false)
      const [showDiagnostics, setShowDiagnostics] = useState(true)
      const [busy, setBusy] = useState(false)
      const [message, setMessage] = useState('')
      const [error, setError] = useState('')
      const [conflict, setConflict] = useState(false)
      const [newProject, setNewProject] = useState(false)
      const [starterBoard, setStarterBoard] = useState('esp32-devkitc')

      const viewportRef = useRef(null)
      const stateRef = useRef(state)
      const viewRef = useRef(view)
      const dragRef = useRef(drag)
      const drawingRef = useRef(drawing)
      const workspaceRef = useRef(workspaceId)
      const projectRef = useRef(projectId)
      const interactingRef = useRef(false)
      stateRef.current = state
      viewRef.current = view
      dragRef.current = drag
      drawingRef.current = drawing
      workspaceRef.current = workspaceId
      projectRef.current = projectId
      interactingRef.current = busy || drag !== undefined || drawing !== undefined

      useEffect(() => {
        try {
          window.localStorage.setItem(STORAGE_WS, workspaceId)
          window.localStorage.setItem(STORAGE_PROJECT, projectId)
        } catch {
          // Private browsing: the selection just does not persist.
        }
      }, [workspaceId, projectId])

      useEffect(() => {
        if (message === '') return undefined
        const timer = setTimeout(() => setMessage(''), 4000)
        return () => clearTimeout(timer)
      }, [message])

      const adopt = useCallback(payload => {
        if (payload?.doc === undefined) {
          setState({
            exists: payload?.exists === true,
            doc: undefined,
            diagnostics: [],
            counts: { errors: 0, warnings: 0 },
            project: payload?.project,
          })
          return
        }
        setState({
          exists: true,
          doc: payload.doc,
          diagnostics: Array.isArray(payload.diagnostics) ? payload.diagnostics : [],
          counts: payload.counts ?? { errors: 0, warnings: 0 },
          project: payload.project,
        })
      }, [])

      const load = useCallback(async (workspace, project, options) => {
        if (workspace === '') return
        const silent = options?.silent === true
        try {
          const payload = await call(`/state?workspace=${encodeURIComponent(workspace)}&project=${encodeURIComponent(project ?? '.')}`)
          adopt(payload)
          if (!silent) setError('')
        } catch (failure) {
          if (!silent) setError(failure.message)
        }
      }, [adopt])

      const refreshProjects = useCallback(async () => {
        try {
          const payload = await call('/projects')
          const list = Array.isArray(payload.workspaces) ? payload.workspaces : []
          setWorkspaces(list)
          const current = workspaceRef.current
          const chosen = list.find(item => item.id === current)
            ?? list.find(item => (item.projects?.length ?? 0) > 0)
            ?? list[0]
          if (chosen === undefined) {
            setWorkspaceId('')
            return
          }
          if (chosen.id !== current) setWorkspaceId(chosen.id)
          // The saved project may be gone (deleted, or a stale value from a
          // previous version of this page): fall back to the first project.
          const known = (chosen.projects ?? []).some(item => item.id === projectRef.current)
          if (!known) setProjectId(chosen.projects?.[0]?.id ?? '.')
        } catch (failure) {
          setError(failure.message)
        }
      }, [])

      useEffect(() => {
        void refreshProjects()
        call('/library')
          .then(payload => setLibrary({ boards: payload.boards ?? [], parts: payload.parts ?? [] }))
          .catch(() => {})
      }, [refreshProjects])

      useEffect(() => {
        if (workspaceId === '') return undefined
        void load(workspaceId, projectId)
        return undefined
      }, [workspaceId, projectId, load])

      useEffect(() => {
        if (workspaceId === '') return undefined
        const timer = setInterval(() => {
          if (interactingRef.current) return
          void load(workspaceId, projectId, { silent: true })
        }, POLL_MS)
        return () => clearInterval(timer)
      }, [workspaceId, projectId, load])

      const save = useCallback(async (ops, label) => {
        const doc = stateRef.current.doc
        if (doc === undefined) return
        setBusy(true)
        setError('')
        try {
          const payload = await post('/ops', {
            workspace: workspaceRef.current,
            project: projectRef.current,
            baseRev: doc.rev,
            ops,
          })
          adopt(payload)
          setMessage(label ?? '已保存')
          setConflict(false)
        } catch (failure) {
          if (failure.status === 409) setConflict(true)
          else setError(failure.message)
        } finally {
          setBusy(false)
        }
      }, [adopt])

      const toWorld = useCallback((clientX, clientY) => {
        const node = viewportRef.current
        const rect = node === null ? { left: 0, top: 0 } : node.getBoundingClientRect()
        const current = viewRef.current
        return { x: (clientX - rect.left - current.x) / current.z, y: (clientY - rect.top - current.y) / current.z }
      }, [])

      // Wheel zooms around the cursor; the grid stays put in world space.
      useEffect(() => {
        const node = viewportRef.current
        if (node === null) return undefined
        const onWheel = event => {
          event.preventDefault()
          const rect = node.getBoundingClientRect()
          const px = event.clientX - rect.left
          const py = event.clientY - rect.top
          setView(current => {
            const z = Math.min(2.5, Math.max(0.3, current.z * Math.exp(-event.deltaY * 0.0016)))
            const k = z / current.z
            return { x: px - (px - current.x) * k, y: py - (py - current.y) * k, z }
          })
        }
        node.addEventListener('wheel', onWheel, { passive: false })
        return () => node.removeEventListener('wheel', onWheel)
      }, [])

      const dragging = drag !== undefined
      useEffect(() => {
        if (!dragging) return undefined
        const move = event => {
          const current = dragRef.current
          if (current === undefined) return
          if (current.kind === 'pan') {
            setView(v => ({
              x: current.originX + (event.clientX - current.startX),
              y: current.originY + (event.clientY - current.startY),
              z: v.z,
            }))
            return
          }
          const point = toWorld(event.clientX, event.clientY)
          setDrag(value => {
            if (value === undefined || value.kind !== 'part') return value
            return {
              ...value,
              at: [Math.round(point.x - value.grabX), Math.round(point.y - value.grabY)],
              moved: value.moved || Math.abs(point.x - value.startX) > 3 || Math.abs(point.y - value.startY) > 3,
            }
          })
        }
        const up = () => {
          const current = dragRef.current
          setDrag(undefined)
          if (current?.kind !== 'part') return
          if (!current.moved) {
            setSelected({ type: 'part', id: current.id })
            return
          }
          const doc = stateRef.current.doc
          const part = doc === undefined ? undefined : doc.parts.find(candidate => candidate.id === current.id)
          if (part !== undefined && (part.at[0] !== current.at[0] || part.at[1] !== current.at[1])) {
            void save([{ type: 'move', id: current.id, at: current.at }], '已移动部件')
          }
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', up)
        return () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          window.removeEventListener('pointercancel', up)
        }
      }, [dragging, save, toWorld])

      const connecting = drawing !== undefined
      useEffect(() => {
        if (!connecting) return undefined
        const move = event => {
          const point = toWorld(event.clientX, event.clientY)
          setDrawing(value => (value === undefined ? value : { ...value, x: point.x, y: point.y }))
        }
        const up = event => {
          const element = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(event.clientX, event.clientY) : null
          const target = element?.closest?.('[data-node]')?.getAttribute('data-node')
          const from = drawingRef.current?.from
          setDrawing(undefined)
          if (from === undefined || typeof target !== 'string' || target === from) return
          const doc = stateRef.current.doc
          const occupied = doc === undefined ? undefined : doc.nets.find(net => net.nodes.includes(from))
          if (occupied !== undefined) {
            setMessage(`引脚 ${from} 已经连在「${occupied.name}」上`)
            return
          }
          void save([{ type: 'connect', nodes: [from, target] }], '已连接')
        }
        const cancel = () => setDrawing(undefined)
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', cancel)
        return () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          window.removeEventListener('pointercancel', cancel)
        }
      }, [connecting, save, toWorld])

      useEffect(() => {
        const onKey = event => {
          const tag = event.target?.tagName
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
          if (event.key === 'Escape') {
            setDrawing(undefined)
            setSelected(undefined)
            setPalette(false)
            return
          }
          // Only Delete removes a wire: Backspace is a habit key, and a selected
          // net disappearing because someone hit it is a nasty surprise.
          if (event.key !== 'Delete') return
          const current = stateRef.current.doc
          if (selected?.type !== 'net' || current === undefined) return
          if (!current.nets.some(net => net.id === selected.id)) return
          event.preventDefault()
          void save([{ type: 'disconnect', netId: selected.id }], '已删除网络')
          setSelected(undefined)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [selected, save])

      const doc = state.doc
      // Modules turn their pins towards what they are wired to (see autoMirrors).
      const mirrors = autoMirrors(doc?.parts ?? [], doc?.nets ?? [])
      const renderedParts = doc === undefined
        ? []
        : doc.parts
          .map(part => oriented(part, mirrors))
          .map(part => (drag?.kind === 'part' && drag.id === part.id ? { ...part, at: drag.at } : part))
      // Wires follow the part being dragged because anchors come from the
      // rendered positions, not the saved ones.
      const { anchors } = scene(renderedParts)
      // A pin that a net already reaches is drawn filled with that net's colour.
      const usedBy = new Map()
      for (const net of doc?.nets ?? []) {
        for (const node of net.nodes) if (!usedBy.has(node)) usedBy.set(node, net)
      }

      const startPartDrag = (event, part) => {
        if (event.button !== 0) return
        event.stopPropagation()
        const point = toWorld(event.clientX, event.clientY)
        setSelected({ type: 'part', id: part.id })
        setDrag({
          kind: 'part',
          id: part.id,
          grabX: point.x - part.at[0],
          grabY: point.y - part.at[1],
          startX: point.x,
          startY: point.y,
          at: [part.at[0], part.at[1]],
          moved: false,
        })
      }

      const startPan = event => {
        if (event.button !== 0) return
        if (event.target !== event.currentTarget) return
        setSelected(undefined)
        setDrag({
          kind: 'pan',
          startX: event.clientX,
          startY: event.clientY,
          originX: viewRef.current.x,
          originY: viewRef.current.y,
        })
      }

      const startWire = (event, node) => {
        if (event.button !== 0) return
        event.stopPropagation()
        event.preventDefault()
        const point = toWorld(event.clientX, event.clientY)
        setDrawing({ from: node, x: point.x, y: point.y })
      }

      const patchNet = (netId, patch) => { void save([{ type: 'set_net', netId, patch }], '已更新网络') }
      const unlinkNode = node => { void save([{ type: 'unlink', node }], '已断开引脚') }
      const disconnectNet = netId => {
        void save([{ type: 'disconnect', netId }], '已删除网络')
        setSelected(undefined)
      }
      const removePart = id => {
        void save([{ type: 'remove_part', id }], '已删除部件')
        setSelected(undefined)
      }
      const verifyPart = id => { void save([{ type: 'update_part', id, patch: { verified: true } }], '已标记引脚已核对') }
      const copy = value => {
        void copyText(value).then(ok => setMessage(ok ? `已复制：${value}` : '复制失败：浏览器不让访问剪贴板'))
      }
      const setIcon = (id, icon) => {
        void save([{ type: 'update_part', id, patch: { icon: icon === '' ? null : icon } }], '已更新图标')
      }
      const patchPins = (part, mutate) => {
        const pins = part.pins.map(pin => ({ ...pin }))
        mutate(pins)
        void save([{ type: 'update_part', id: part.id, patch: { pins } }], '已调整引脚')
      }
      const rotatePin = (part, pin) => patchPins(part, pins => {
        const target = pins.find(candidate => candidate.name === pin.name)
        if (target === undefined) return
        // The button flips what is on screen, so undo the mirror first.
        const shown = sideOf(part, target) === 'left' ? 'right' : 'left'
        target.side = part.flip === true ? (shown === 'left' ? 'right' : 'left') : shown
      })
      const shiftPin = (part, pin, delta) => patchPins(part, pins => {
        const from = pins.findIndex(candidate => candidate.name === pin.name)
        const to = from + delta
        if (from < 0 || to < 0 || to >= pins.length) return
        const [moved] = pins.splice(from, 1)
        pins.splice(to, 0, moved)
      })
      // Quick layouts for the whole card. The stored side is what the card shows,
      // so a flipped part needs the opposite value written down.
      const pinLayout = (part, mode) => {
        const flipped = part.flip === true
        const store = side => (flipped ? (side === 'left' ? 'right' : 'left') : side)
        patchPins(part, pins => {
          const half = Math.ceil(pins.length / 2)
          pins.forEach((pin, index) => {
            if (mode === 'swap') {
              pin.side = store(sideOf(part, pin) === 'left' ? 'right' : 'left')
              return
            }
            if (mode === 'left') pin.side = store('left')
            else if (mode === 'right') pin.side = store('right')
            else pin.side = store(index < half ? 'left' : 'right')
          })
        })
      }
      const setFlip = (id, flip) => {
        void save([{ type: 'flip', id, flip }], flip === null ? '已恢复自动朝向' : flip ? '已左右翻转' : '已固定朝向')
      }
      // Clicking always flips what is on screen, whether that came from `flip`
      // or from the automatic guess.
      const flipPart = part => {
        const shown = part.flip === undefined ? mirrors.get(part.id) === true : part.flip === true
        setFlip(part.id, !shown)
      }
      const addPart = model => {
        setPalette(false)
        void save([{ type: 'add_part', part: { model } }], '已添加部件')
      }
      const applyPending = () => { void save([{ type: 'apply_pending' }], '已应用建议') }
      const discardPending = () => { void save([{ type: 'discard_pending' }], '已忽略建议') }
      const createProject = async (path, board) => {
        setBusy(true)
        setError('')
        try {
          const payload = await post('/init', {
            workspace: workspaceRef.current,
            project: path,
            board,
          })
          adopt(payload)
          const created = payload.project?.id ?? path
          setProjectId(created)
          setNewProject(false)
          setMessage(`已创建项目 ${created}`)
          void refreshProjects()
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }

      const fitToBounds = bounds => {
        if (bounds === undefined) {
          setView({ x: 40, y: 40, z: 1 })
          return
        }
        const node = viewportRef.current
        const width = node === null ? 800 : node.clientWidth
        const height = node === null ? 600 : node.clientHeight
        const z = Math.min(1.4, Math.max(0.3, Math.min((width - 80) / bounds.width, (height - 80) / bounds.height)))
        setView({
          x: width / 2 - (bounds.minX + bounds.width / 2) * z,
          y: height / 2 - (bounds.minY + bounds.height / 2) * z,
          z,
        })
      }

      const fit = () => {
        fitToBounds(doc === undefined || doc.parts.length === 0 ? undefined : contentBounds(doc))
      }

      const tidyUp = () => {
        if (doc === undefined || doc.parts.length === 0) return
        const { positions, flips } = tidyParts(doc.parts, doc.nets)
        const ops = []
        const moved = []
        for (const part of doc.parts) {
          const at = positions.get(part.id)
          if (at === undefined) continue
          const shown = part.flip === undefined ? mirrors.get(part.id) === true : part.flip === true
          const flip = flips.get(part.id)
          const wantsFlip = flip !== undefined && flip !== shown
          moved.push({ ...part, at, flip: flip === undefined ? part.flip : flip })
          if (Math.round(part.at[0]) !== at[0] || Math.round(part.at[1]) !== at[1]) {
            ops.push({ type: 'move', id: part.id, at })
          }
          if (wantsFlip) ops.push({ type: 'flip', id: part.id, flip })
        }
        if (ops.length === 0) {
          setMessage('已经很整齐了')
          return
        }
        void save(ops, `已整理 ${ops.length} 处（位置与朝向）`)
        fitToBounds(contentBounds({ parts: moved }))
      }

      const focus = (kind, id) => {
        if (doc === undefined) return
        setSelected({ type: kind, id })
        let center
        if (kind === 'part') {
          const part = doc.parts.find(candidate => candidate.id === id)
          if (part === undefined) return
          center = { x: part.at[0] + PART_W / 2, y: part.at[1] + partHeight(part) / 2 }
        } else {
          const net = doc.nets.find(candidate => candidate.id === id)
          if (net === undefined) return
          const points = net.nodes.map(node => anchors.get(node)).filter(Boolean)
          if (points.length === 0) return
          center = {
            x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
            y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
          }
        }
        const node = viewportRef.current
        const width = node === null ? 800 : node.clientWidth
        const height = node === null ? 600 : node.clientHeight
        setView(current => ({ x: width / 2 - center.x * current.z, y: height / 2 - center.y * current.z, z: current.z }))
      }

      const selectedNet = selected?.type === 'net' && doc !== undefined
        ? doc.nets.find(net => net.id === selected.id)
        : undefined
      const selectedPart = selected?.type === 'part' && doc !== undefined
        ? doc.parts.find(part => part.id === selected.id)
        : undefined
      const pending = doc?.pending ?? []

      const wireEls = []
      const hitEls = []
      if (doc !== undefined) {
        const activeNet = selected?.type === 'net' ? selected.id : undefined
        for (const net of doc.nets) {
          const d = wirePath(anchors, net)
          if (d === '') continue
          const color = net.color ?? NET_COLORS[net.kind] ?? NET_COLORS.signal
          const active = activeNet === net.id
          const hovered = hoverNet === net.id
          const dim = activeNet !== undefined && !active
          // The halo keeps a wire readable where it crosses a card.
          wireEls.push(h('path', {
            key: `${net.id}-halo`,
            className: 'ew-wire-halo',
            d,
            strokeOpacity: dim ? 0.1 : 0.9,
          }))
          wireEls.push(h('path', {
            key: net.id,
            className: 'ew-wire',
            d,
            stroke: color,
            strokeWidth: active || hovered ? 3.2 : 2,
            strokeOpacity: dim ? 0.12 : 0.9,
            'data-selected': active || undefined,
          }))
          // A 2px line is impossible to hit; the invisible twin below the cards is not.
          hitEls.push(h('path', {
            key: `hit-${net.id}`,
            className: 'ew-wire-hit',
            d,
            onPointerDown: event => {
              event.stopPropagation()
              setSelected({ type: 'net', id: net.id })
            },
            onPointerEnter: () => setHoverNet(net.id),
            onPointerLeave: () => setHoverNet(current => (current === net.id ? undefined : current)),
          }))
        }
        for (const item of pending) {
          for (const [index, op] of item.ops.entries()) {
            if (op.type !== 'connect' || !Array.isArray(op.nodes) || op.nodes.length < 2) continue
            const points = op.nodes.map(node => anchors.get(node)).filter(Boolean)
            if (points.length < 2) continue
            const [head, ...rest] = points
            wireEls.push(h('path', {
              key: `${item.id}-${index}`,
              className: 'ew-wire',
              d: rest.map(point => curvePath(head, point)).join(' '),
              stroke: 'var(--dsw-alias-brand-primary,#4c8dff)',
              strokeWidth: 2,
              strokeDasharray: '6 4',
              strokeOpacity: 0.7,
            }))
          }
        }
      }

      const ghostFrom = drawing === undefined ? undefined : anchors.get(drawing.from)
      const ghost = ghostFrom === undefined || drawing === undefined ? null : h('path', {
        className: 'ew-wire',
        d: `M ${ghostFrom.x} ${ghostFrom.y} L ${drawing.x} ${drawing.y}`,
        stroke: 'var(--dsw-alias-brand-primary,#4c8dff)',
        strokeWidth: 2,
        strokeDasharray: '5 4',
      })

      const partEls = renderedParts.map(part => {
        const counts = sideCounts(part)
        const rows = part.pins.map(pin => {
          const side = sideOf(part, pin)
          const wide = side === 'left' ? counts.right === 0 : counts.left === 0
          const node = `${part.id}:${pin.name}`
          const net = usedBy.get(node)
          const color = net === undefined ? undefined : net.color ?? NET_COLORS[net.kind] ?? NET_COLORS.signal
          const title = [pin.note, net === undefined ? undefined : `已接 ${net.name ?? net.id}`]
            .filter(value => value !== undefined && value !== '')
            .join(' · ')
          return h('div', {
            key: pin.name,
            className: 'ew-pin',
            'data-node': node,
            'data-side': side,
            'data-wide': wide,
            'data-role': pin.role,
            'data-used': net === undefined ? undefined : '',
            style: { top: `${PAD_TOP + rowOf(part, pin) * ROW}px` },
            title,
          },
          h('span', { className: net === undefined ? 'ew-pin-name' : 'ew-pin-name ew-used' }, pin.name),
          wide && pin.note !== undefined ? h('span', { className: 'ew-pin-note' }, pin.note) : null,
          h('span', {
            className: 'ew-pin-dot',
            style: color === undefined ? undefined : {
              background: color,
              borderColor: color,
              boxShadow: '0 0 0 2px var(--dsw-alias-bg-layer-1,#fff)',
            },
            onPointerDown: event => startWire(event, node),
          }))
        })
        const photo = part.source === 'photo'
        return h('div', {
          key: part.id,
          className: 'ew-part',
          'data-selected': selected?.type === 'part' && selected.id === part.id,
          'data-dragging': drag?.kind === 'part' && drag.id === part.id,
          style: { left: `${part.at[0]}px`, top: `${part.at[1]}px`, width: `${PART_W}px` },
        },
        h('div', { className: 'ew-part-head', onPointerDown: event => startPartDrag(event, part) },
          part.icon === undefined ? null : h('span', { className: 'ew-part-icon', 'aria-hidden': true }, part.icon),
          h('span', { className: 'ew-part-label', title: part.label }, part.label),
          photo
            ? h('span', {
              className: 'ew-flag',
              'data-ok': part.verified === true,
              title: part.verified === true ? '照片识别的引脚已核对' : '引脚来自照片识别，尚未核对',
            }, part.verified === true ? '照片✓' : '照片?')
            : null,
          h('span', {
            className: 'ew-part-id',
            title: '点击复制这个 id',
            onPointerDown: event => event.stopPropagation(),
            onClick: event => {
              event.stopPropagation()
              copy(part.id)
            },
          }, part.id)),
        h('div', { style: { position: 'relative', height: `${partHeight(part) - HEAD}px` } }, rows))
      })

      const world = h('div', {
        className: 'ew-world',
        style: { transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` },
      },
      // Hit areas start below the cards (so a card still wins a click), the
      // visible wires sit above them (so a wire crossing a card stays readable).
      h('svg', { className: 'ew-wire-hits', width: 6000, height: 4000, 'aria-hidden': true }, hitEls),
      partEls,
      h('svg', { className: 'ew-wires', width: 6000, height: 4000, 'aria-hidden': true }, ghost, wireEls))

      const emptyEl = h('div', { className: 'ew-empty' },
        h('div', { className: 'ew-card' },
          h('h3', {}, state.exists ? '接线文件读不出来' : '这个项目还没有接线图'),
          h('p', {}, state.exists
            ? `文件存在但不是合法 JSON：${state.project?.path ?? ''}。修正或删除后点「重新读取」。`
            : `接线图是一份 JSON 网表，会写在 ${state.project?.path ?? '<项目目录>/hardware/wiring.json'}，跟着这个仓库走。选一块板卡开始，之后就可以从引脚拖线。`),
          h('div', { className: 'ew-row' },
            h('label', {}, '板卡'),
            h('select', {
              className: 'ew-select',
              value: starterBoard,
              onChange: event => setStarterBoard(event.target.value),
            },
            library.boards.length === 0
              ? h('option', { value: 'esp32-devkitc' }, 'ESP32 DevKitC')
              : library.boards.map(board => h('option', { key: board.model, value: board.model }, board.label)))),
          h(Button, {
            onClick: () => createProject(projectId, starterBoard),
            disabled: busy || workspaceId === '',
          }, '创建项目')))

      const pendingEl = pending.length === 0 ? null : h('div', { className: 'ew-pending' },
        h('span', { style: { fontWeight: 600, flex: '0 0 auto' } }, `Agent 建议 ${pending.length} 项`),
        h('span', {
          className: 'ew-pending-note',
          title: pending.map(item => item.note).join('；'),
        }, pending.map(item => item.note).join('；')),
        h(Button, { onClick: applyPending }, '应用'),
        h(Button, { onClick: discardPending }, '忽略'))

      const inspectorEl = selectedNet !== undefined
        ? h(NetInspector, {
          key: selectedNet.id,
          net: selectedNet,
          onPatch: patch => patchNet(selectedNet.id, patch),
          onDisconnect: () => disconnectNet(selectedNet.id),
          onUnlink: unlinkNode,
          onClose: () => setSelected(undefined),
        })
        : selectedPart !== undefined
          ? h(PartInspector, {
            key: selectedPart.id,
            part: selectedPart,
            flipped: (selectedPart.flip === undefined ? mirrors.get(selectedPart.id) === true : selectedPart.flip === true),
            onRemove: () => removePart(selectedPart.id),
            onVerify: () => verifyPart(selectedPart.id),
            onFlip: () => flipPart(selectedPart),
            onAuto: () => setFlip(selectedPart.id, null),
            onIcon: icon => setIcon(selectedPart.id, icon),
            onPinSide: (part, pin) => rotatePin(part, pin),
            onPinMove: (part, pin, delta) => shiftPin(part, pin, delta),
            onPinLayout: (part, mode) => pinLayout(part, mode),
            onCopy: copy,
            onClose: () => setSelected(undefined),
          })
          : null

      const diagnosticsEl = !showDiagnostics || doc === undefined || state.diagnostics.length === 0
        ? null
        : h('div', { className: 'ew-diagnostics' },
          state.diagnostics.map((item, index) => h('div', {
            key: `${item.code}-${index}`,
            className: 'ew-diag',
            'data-severity': item.severity,
          },
          h('span', { className: 'ew-diag-dot' }),
          h('span', { className: 'ew-diag-code' }, item.code),
          h('span', { className: 'ew-diag-text' }, item.message),
          item.netId !== undefined || item.partId !== undefined
            ? h('button', {
              type: 'button',
              className: 'ew-diag-go',
              onClick: () => focus(item.netId !== undefined ? 'net' : 'part', item.netId ?? item.partId),
            }, '定位')
            : null)))

      const workspace = workspaces.find(item => item.id === workspaceId)
      const projects = workspace?.projects ?? []

      const bar = h('div', { className: 'ew-bar' },
        h('select', {
          className: 'ew-select',
          value: workspaceId,
          onChange: event => {
            const next = workspaces.find(item => item.id === event.target.value)
            setWorkspaceId(event.target.value)
            if (next !== undefined) setProjectId(next.projects?.[0]?.id ?? '.')
          },
          title: '工作区',
        },
        workspaces.length === 0 ? h('option', { value: '' }, '没有可用的工作区') : null,
        workspaces.map(item => h('option', { key: item.id, value: item.id }, `${item.title}（${item.projects?.length ?? 0} 项目）`))),
        h('select', {
          className: 'ew-select',
          value: projectId,
          onChange: event => setProjectId(event.target.value),
          title: '项目：一个项目就是一份 hardware/wiring.json',
        },
        projects.length === 0
          ? h('option', { value: projectId }, projectId === '.' ? '（还没有项目）' : projectId)
          : projects.map(project => h('option', { key: project.id, value: project.id },
            `${project.id === '.' ? '根目录' : project.id} · ${project.boards}板/${project.nets}网${project.errors > 0 ? ` · ${project.errors}E` : ''}`))),
        h(Button, { onClick: () => setNewProject(true), disabled: workspaceId === '' }, '＋ 新项目'),
        h(Button, { onClick: () => setPalette(true), disabled: doc === undefined }, '＋ 添加硬件'),
        h(Button, {
          onClick: tidyUp,
          disabled: doc === undefined || doc.parts.length < 2,
          title: '按连线自动排布部件：只改位置，不改接线',
        }, '一键整理'),
        h(Button, { onClick: fit, disabled: doc === undefined }, '适配视图'),
        h(Button, {
          onClick: () => setShowDiagnostics(value => !value),
          pressed: showDiagnostics,
        }, `诊断 ${state.counts.errors}E/${state.counts.warnings}W`),
        h(Button, { onClick: () => { void load(workspaceId, projectId); void refreshProjects() } }, '重新读取'),
        h('span', { className: 'ew-grow' }),
        message === '' ? null : h('span', { className: 'ew-status' }, message),
        h('span', { className: 'ew-badge', title: '这个工作区里识别到的项目与板卡数' }, `${projects.length} 项目 · ${workspace?.boards ?? 0} 板`),
        busy ? h('span', { className: 'ew-badge' }, '保存中…') : null,
        doc === undefined ? null : h('span', { className: 'ew-badge', title: `文件 ${state.project?.path ?? ''}` }, `rev ${doc.rev}`))

      const errorEl = error === '' ? null : h('div', { className: 'ew-alert ew-alert-error' },
        h('span', { className: 'ew-grow' }, error),
        h('button', { type: 'button', className: 'ew-x', onClick: () => setError('') }, '✕'))

      const conflictEl = conflict ? h('div', { className: 'ew-alert' },
        h('span', { className: 'ew-grow' }, '这个文件刚被别处改过（可能是 Agent）。为避免覆盖，请先重新读取。'),
        h(Button, { onClick: () => { setConflict(false); void load(workspaceId, projectId) } }, '重新读取'),
        h('button', { type: 'button', className: 'ew-x', onClick: () => setConflict(false) }, '✕')) : null

      const viewport = h('div', {
        className: 'ew-viewport',
        ref: viewportRef,
        'data-panning': drag?.kind === 'pan',
        onPointerDown: startPan,
      },
      doc === undefined ? emptyEl : world,
      pendingEl,
      inspectorEl,
      h('div', { className: 'ew-hint' }, '拖标题移动 · 引脚圆点拖线 · 点部件调引脚左右 · 实心圆点=已接线 · 滚轮缩放 · Delete 删线'))

      return h('div', { className: 'ew-root' },
        bar,
        errorEl,
        conflictEl,
        viewport,
        diagnosticsEl,
        palette ? h(Palette, { library, onPick: addPart, onClose: () => setPalette(false) }) : null,
        newProject
          ? h(NewProject, {
            boards: library.boards,
            defaultPath: projectId,
            onCancel: () => setNewProject(false),
            onCreate: createProject,
          })
          : null)
    }

    // ---- Registration -------------------------------------------------------

    function ensureStyle() {
      if (typeof document === 'undefined' || document.head === undefined) return () => {}
      if (document.querySelector(`style[${STYLE_ATTR}]`) !== null) return () => {}
      const style = document.createElement('style')
      style.setAttribute(STYLE_ATTR, '')
      style.textContent = CSS
      document.head.appendChild(style)
      return () => style.remove()
    }

    return {
      inject: ['slots'],
      // Geometry is exported for `test/route.mjs`; the Host only calls `apply`.
      internals: { scene, wirePath, curvePath, spanningSegments, tidyParts, autoMirrors, oriented, sideOf },
      apply(ctx) {
        if (typeof ctx.effect === 'function') ctx.effect(() => ensureStyle())
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'hardware-wiring' }, WiringPage))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'hardware-wiring',
          order: 30,
          label: () => '接线',
        }, WiringIcon))
      },
    }
  },
})
