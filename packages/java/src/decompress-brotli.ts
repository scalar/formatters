/**
 * Brotli decompression for the browser build.
 *
 * The artifact is stored brotli-compressed because that is what keeps the
 * install small (see `compile-artifact.ts`), and the browser build reads the
 * very same file rather than a second copy in a friendlier format. Shipping a
 * gzip twin would cost 44% more over the wire for this package and would double
 * what every Node install carries for a file it never opens.
 *
 * Two ways to expand it, in preference order:
 *
 * 1. `DecompressionStream('brotli')`, which is native and free. It is specified
 *    and shipping - Safari from 18.4, Firefox from 147 - but Chrome does not
 *    have it yet (checked against Chrome 141), so it cannot be the only path.
 * 2. `brotli-dec-wasm`, a 208KB wasm decoder, imported dynamically so it is
 *    fetched only by engines that need it and never enters a Node process.
 *
 * A caller who serves the artifact with `Content-Encoding: br`, or points at a
 * raw `.wasm`, skips this file entirely - see `init` in `fetch-artifact.ts`.
 */

/**
 * The format string, widened to whatever this TypeScript's lib types accept.
 *
 * `DecompressionStream` is typed against the formats implementations had when
 * those types were written, so `brotli` is not in the union yet even where the
 * engine supports it. The feature test below is what actually decides.
 */
const BROTLI = 'brotli' as ConstructorParameters<typeof DecompressionStream>[0]

/**
 * Whether this engine decodes brotli natively.
 *
 * The constructor is the feature test: it throws `TypeError` on a format it
 * does not know, and there is no other way to ask. Evaluated once, because the
 * answer cannot change within a page.
 */
const hasNativeBrotli = ((): boolean => {
  try {
    new DecompressionStream(BROTLI)
    return true
  } catch {
    return false
  }
})()

/** Expands a brotli-compressed artifact, natively where the engine allows it. */
export const decompressBrotli = async (compressed: Uint8Array): Promise<Uint8Array> => {
  if (hasNativeBrotli) {
    const stream = new Response(compressed).body?.pipeThrough(new DecompressionStream(BROTLI))
    if (!stream) throw new Error('the artifact response carried no body to decompress')
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }

  // Dynamic, so bundlers split it into a chunk that only a Chrome-shaped engine
  // ever fetches, and so a Node resolver never walks into a browser-only wasm.
  const { decompress } = await (await import('brotli-dec-wasm')).default
  return decompress(compressed)
}
