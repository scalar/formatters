import type { AssetResponse } from './types'

/**
 * Hands one asset to the .NET runtime without going through `fetch`.
 *
 * The runtime's resource loader is documented in terms of a `Response`, and a
 * real `Response` is what this used to build. It turned out to be the single
 * most expensive thing in the Node boot, for two reasons that have nothing to do
 * with the bytes: constructing the first `Response` in a Node process is what
 * makes Node load its `fetch` implementation, which costs about 60ms on its own,
 * and reading 21MB of assets back out of response bodies costs another ~35ms of
 * stream machinery on top. Together that was around a fifth of the boot, spent
 * moving bytes we already had in hand from one buffer to another.
 *
 * So the assets are handed over as a plain object carrying only what the runtime
 * reads off the answer: whether it succeeded, enough to describe it if it did
 * not, and the bytes. A real `Response` still satisfies {@link AssetResponse} if
 * this ever needs to hand one back.
 *
 * The bytes are copied rather than passed as a view because they arrive as a
 * slice of the one decompressed archive, and the runtime rewraps what it gets
 * (`new Uint8Array(buffer)`) - handed the archive's buffer it would read the
 * whole archive instead of the one asset. Copying 21MB costs a few milliseconds
 * against the ~95ms the `Response` did. `new Uint8Array(bytes)` is the copy
 * rather than `bytes.slice()`, because under Node these are `Buffer`s and
 * `Buffer.prototype.slice` is the old alias for `subarray` - it would hand back
 * a view onto the archive and quietly undo the whole point.
 *
 * There is deliberately no `headers` here. The runtime reaches for
 * `WebAssembly.compileStreaming` only when a response is typed
 * `application/wasm`, and it guards that on `headers` existing at all, so
 * leaving it off keeps the buffered path - which was measured as no slower. A
 * response we build ourselves has every byte already, so there is no download
 * for a streaming compile to overlap with.
 */
export const assetResponse = (bytes: Uint8Array, name: string): AssetResponse => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  url: name,
  arrayBuffer: () => Promise.resolve(new Uint8Array(bytes).buffer),
})
