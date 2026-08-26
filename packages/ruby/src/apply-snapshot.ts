import { Directory, File } from '@bjorn3/browser_wasi_shim'

import { type BootSnapshot, WASM_PAGE_BYTES } from './snapshot'

/**
 * Restores a boot snapshot into a freshly instantiated VM.
 *
 * Two halves, because a booted VM has two kinds of state. The linear memory is
 * grown to the size it had when the snapshot was taken and the changed pages
 * are copied back into it. The guest's `/work` directory is a JavaScript map on
 * this side, so its contents are rebuilt from the snapshot too - RuboCop's
 * setup writes a gemspec per packaged gem in there, and a memory image that
 * remembers reading them has to be handed a filesystem that still has them.
 *
 * The instance must not have had `_initialize` or `rubyInit` run on it. Those
 * are precisely the work the snapshot replaces, and running them first would
 * leave CRuby's state half from this process and half from the image.
 */
export const applySnapshot = (
  memory: WebAssembly.Memory,
  workFiles: Map<string, Directory | File>,
  snapshot: BootSnapshot,
): void => {
  const currentPages = memory.buffer.byteLength / WASM_PAGE_BYTES
  if (currentPages < snapshot.totalPages) memory.grow(snapshot.totalPages - currentPages)

  const target = new Uint8Array(memory.buffer)
  snapshot.pageIndices.forEach((page, index) => {
    target.set(snapshot.pages.subarray(index * WASM_PAGE_BYTES, (index + 1) * WASM_PAGE_BYTES), page * WASM_PAGE_BYTES)
  })

  for (const entry of snapshot.files) {
    const segments = entry.path.split('/')
    const name = segments.pop()
    if (!name) continue

    // Walk the path, creating the directories the boot created. The map starts
    // empty on every boot, so nothing here can collide with a caller's file.
    let directory: Map<string, Directory | File> = workFiles
    for (const segment of segments) {
      const existing = directory.get(segment)
      const next = existing instanceof Directory ? existing : new Directory(new Map())
      if (!(existing instanceof Directory)) directory.set(segment, next)
      directory = next.contents as Map<string, Directory | File>
    }

    directory.set(name, new File(decodeBase64(entry.data)))
  }
}

/**
 * Expands a base64 string into bytes using only what both environments have.
 *
 * `atob` rather than `Buffer`, because this file is on the browser build's side
 * of the split and may not touch `node:` built-ins - and rather than a hand
 * rolled decoder, because the platform already has one.
 */
const decodeBase64 = (value: string): Uint8Array => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}
