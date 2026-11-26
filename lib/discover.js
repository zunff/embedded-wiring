/**
 * One workspace can hold several boards: every directory that has a
 * `<file>` (by default `hardware/wiring.json`) is one project, and the file
 * travels with the repo it sits in. Discovery is a bounded walk that skips the
 * directories a project never lives in (node_modules, build output, VCS, ...).
 *
 * @module @local/embedded-wiring/discover
 */

import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

/** Directories no wiring file lives in, matched by name at any depth. */
const IGNORED = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target',
  '.next', '.nuxt', 'coverage', '.venv', 'venv', '__pycache__', '.dsh',
  '.pnpm-store', '.yarn', '.idea', '.vscode', 'vendor', 'Pods', 'bin', 'obj',
])

/** Upper bound on directories visited per scan, so a huge repo stays cheap. */
const MAX_DIRS = 4000
const MAX_DEPTH = 6

async function isFile(target) {
  try {
    return (await stat(target)).isFile()
  } catch {
    return false
  }
}

/**
 * Every project file under `root`.
 * @param root - Absolute workspace directory.
 * @param file - Project file path relative to each project directory.
 * @returns `{ rel, dir, file }`, root first, `rel` in posix form ('' for root).
 */
export async function discoverProjects(root, file) {
  const found = []
  let visited = 0

  async function visit(dir, rel, depth) {
    if (visited >= MAX_DIRS) return
    visited += 1
    const candidate = path.join(dir, file)
    if (await isFile(candidate)) found.push({ rel, dir, file: candidate })
    if (depth >= MAX_DEPTH) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      if (entry.name.startsWith('.') || IGNORED.has(entry.name)) continue
      await visit(path.join(dir, entry.name), rel === '' ? entry.name : `${rel}/${entry.name}`, depth + 1)
    }
  }

  await visit(path.resolve(root), '', 0)
  return found
}

/** The project directory a path belongs to, nearest first, inside `stopAt`. */
export async function nearestProject(start, stopAt, file) {
  let dir = path.resolve(start)
  const stop = path.resolve(stopAt)
  for (let depth = 0; depth < MAX_DEPTH + 2; depth += 1) {
    if (await isFile(path.join(dir, file))) return dir
    if (dir === stop) break
    const parent = path.dirname(dir)
    if (parent === dir || dir.length <= stop.length) break
    dir = parent
  }
  return path.resolve(start)
}
