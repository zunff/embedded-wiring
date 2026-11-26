/**
 * One JSON file per project, written atomically and serialized through a queue.
 * The page and the agent both go through this store, so a drag and a tool call
 * can never interleave into a half-written file: the file on disk is the only
 * state, and `rev` is the version both sides quote back.
 * @module @local/embedded-wiring/store
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { emptyDocument, normalizeDocument } from './model.js'

export function createProjectStore(filePath) {
  let queue = Promise.resolve()

  /** Read + normalize; a missing file is an empty project, a corrupt one reports why. */
  async function read() {
    let raw
    try {
      raw = await readFile(filePath, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return { exists: false, doc: undefined }
      return { exists: false, doc: undefined, error: `无法读取 ${filePath}：${error?.message ?? error}` }
    }
    try {
      return { exists: true, doc: normalizeDocument(JSON.parse(raw)) }
    } catch (error) {
      return { exists: true, doc: undefined, error: `接线文件不是合法 JSON：${error?.message ?? error}` }
    }
  }

  /**
   * Apply one mutation against the file's current content and commit it with a
   * bumped `rev`. `mutate` receives a normalized document and returns the next
   * one; throwing aborts the write and keeps the file untouched.
   */
  function update(mutate) {
    const task = queue.then(async () => {
      const current = await read()
      if (current.error !== undefined) throw new Error(current.error)
      const base = current.doc ?? emptyDocument()
      const next = await mutate(base)
      next.rev = base.rev + 1
      next.meta.updatedAt = new Date().toISOString()
      await mkdir(path.dirname(filePath), { recursive: true })
      const temporary = `${filePath}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
      await rename(temporary, filePath)
      return next
    })
    // A rejected mutation must not poison the queue for the next caller.
    queue = task.then(() => undefined, () => undefined)
    return task
  }

  return { read, update, filePath }
}
