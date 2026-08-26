/**
 * The boot snapshot: an image of a booted VM's linear memory, so that a process
 * can start from "syntax_tree and RuboCop are loaded" instead of getting there.
 *
 * Booting the Ruby VM the ordinary way is dominated by one thing - `require`.
 * Measured on this artifact, instantiating CRuby costs about half a second and
 * then `require "syntax_tree"` costs another second, but `require "rubocop"`
 * costs eight to ten more: 1266 Ruby files that CRuby has to read, parse,
 * compile and run, on a virtual machine that is itself running on WebAssembly.
 * None of that work depends on the input, on the options, or on anything else
 * about the process it happens in - so it is work that can be done once, at
 * build time, and shipped.
 *
 * That is what this is. `build/ruby_fmt/write-snapshot.ts` boots a VM, takes
 * every 64KB page of linear memory that the boot changed, and writes them here
 * compressed. Booting then means instantiating the module, growing its memory
 * and copying those pages back in - about a fifth of a second in total, against
 * the ten to twelve seconds the requires cost.
 *
 * This is the same technique as Wizer, which is how ruby.wasm pre-initializes
 * at build time. It is done here rather than in the artifact because the
 * artifact is CRuby as ruby.wasm builds it, and we would rather keep it that
 * way: the snapshot is an accelerator layered over the real thing, and if it is
 * missing, stale or refuses to apply, `boot-vm.ts` runs the requires instead
 * and everything still works.
 *
 * ## Why a memory image is enough
 *
 * A wasm instance's mutable state is its linear memory, its mutable globals and
 * its tables. This artifact declares three mutable globals - a stack pointer
 * and two asyncify flags - and every one of them is back at its initial value
 * between calls, which is exactly when the snapshot is taken. Its single
 * element segment is static, and nothing in CRuby grows the table at runtime.
 * So the memory is the state.
 *
 * The guest filesystem is the one piece that does *not* live in the memory: it
 * is a JavaScript `Map` this side owns. The snapshot therefore carries the
 * contents of `/work` as they stood when it was taken, because RuboCop's setup
 * writes gemspecs in there and Ruby is entitled to read them again later.
 */

/** Identifies the file and its layout, so a stale or foreign file is refused rather than applied. */
export const SNAPSHOT_MAGIC = 'SCALAR-RUBY-FMT-SNAPSHOT/1'

/** wasm's page size, and therefore the granularity a snapshot records changes at. */
export const WASM_PAGE_BYTES = 65536

/**
 * One file in the guest filesystem as the snapshot carries it.
 *
 * Only regular files under `/work` are recorded. Directories are implied by the
 * paths, which is enough because the guest's `/work` starts empty and every
 * directory in it was created by the boot this snapshot replaces.
 */
export type SnapshotFile = {
  /** Path relative to `/work`, with `/` separators - e.g. `.gem/specifications/rubocop-1.81.6.gemspec`. */
  path: string
  /** The file's bytes, base64 encoded so the header stays plain JSON. */
  data: string
}

/**
 * Fingerprints the expanded wasm, so a snapshot can refuse an artifact it was
 * not taken against.
 *
 * This matters more than it looks. A memory image is full of pointers into the
 * artifact's data section, so restoring one over a *different* build of CRuby
 * would not produce an error - it would produce a VM quietly reading the wrong
 * bytes. The runtime check in `boot-vm.ts` catches the gross cases; this
 * catches the rest.
 *
 * Sampled rather than complete: FNV-1a over the length and the first and last
 * megabyte, which costs a couple of milliseconds where hashing all 39MB would
 * cost forty. Two different builds of this artifact agreeing on all three is
 * not a case worth designing for - rebuilding CRuby changes its code section,
 * which is at the front.
 */
export const fingerprintArtifact = (wasm: Uint8Array): string => {
  const SAMPLE = 1024 * 1024
  const hash = fnv1a([
    wasm.subarray(0, SAMPLE),
    wasm.subarray(Math.max(0, wasm.byteLength - SAMPLE)),
    new Uint8Array(new Uint32Array([wasm.byteLength]).buffer),
  ])

  return `${wasm.byteLength.toString(16)}-${hash}`
}

/**
 * Fingerprints the Ruby a boot runs, so a snapshot can refuse to stand in for a
 * boot sequence that has since changed.
 *
 * The image *is* the result of running that Ruby, and nothing about the image
 * says which Ruby. Edit `rubocop.ts` or `stree-patch.ts` without rebuilding the
 * snapshot and the restored VM would quietly keep the old behaviour while the
 * fallback path used the new - two boots that no longer agree, which is the one
 * thing this must never be able to do. Checked in `boot-vm.ts`, which is where
 * the steps live.
 */
export const fingerprintBootSteps = (steps: readonly string[]): string =>
  fnv1a(steps.map((step) => new TextEncoder().encode(step)))

/** FNV-1a over a sequence of byte ranges, as a hex string. */
const fnv1a = (chunks: readonly Uint8Array[]): string => {
  let hash = 0x811c9dc5

  for (const chunk of chunks) {
    for (const byte of chunk) {
      hash ^= byte
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
  }

  return hash.toString(16)
}

/** What `boot-vm.ts` needs in order to reconstruct the booted VM. */
export type BootSnapshot = {
  /** {@link fingerprintArtifact} of the wasm this was taken against. */
  artifact: string
  /** {@link fingerprintBootSteps} of the Ruby that produced it. */
  bootSteps: string
  /** Total size of the booted VM's linear memory, in wasm pages. */
  totalPages: number
  /** Indices of the pages the boot changed, ascending. */
  pageIndices: number[]
  /** Those pages' contents, concatenated in the same order. */
  pages: Uint8Array
  /** The guest's `/work` directory as the boot left it. */
  files: SnapshotFile[]
}

/** The JSON header that precedes the page payload in the file. */
type SnapshotHeader = {
  magic: string
  artifact: string
  bootSteps: string
  totalPages: number
  pageIndices: number[]
  files: SnapshotFile[]
}

/**
 * Reads a snapshot file, or returns `undefined` when it is not one we can use.
 *
 * Everything about this is deliberately forgiving. A snapshot is an optimisation
 * and never a requirement, so a truncated file, a header from a future format
 * or - the case that actually happens - a snapshot left over from a previous
 * artifact should all end in a slower boot rather than an error. The artifact's
 * byte length is the staleness check: rebuilding the wasm changes it, and a
 * snapshot taken against different bytes would restore a memory image that does
 * not match the code about to run it.
 */
export const decodeSnapshot = (bytes: Uint8Array, artifact: string): BootSnapshot | undefined => {
  if (bytes.byteLength < 4) return undefined

  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true)
  if (headerLength <= 0 || headerLength + 4 > bytes.byteLength) return undefined

  let header: SnapshotHeader
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength))) as SnapshotHeader
  } catch {
    return undefined
  }

  if (header.magic !== SNAPSHOT_MAGIC) return undefined
  if (header.artifact !== artifact) return undefined

  const pages = bytes.subarray(4 + headerLength)
  if (pages.byteLength !== header.pageIndices.length * WASM_PAGE_BYTES) return undefined

  return {
    artifact: header.artifact,
    bootSteps: header.bootSteps,
    totalPages: header.totalPages,
    pageIndices: header.pageIndices,
    pages,
    files: header.files,
  }
}

/**
 * Writes a snapshot file: a little-endian u32 header length, the JSON header,
 * then the raw pages.
 *
 * Kept beside the reader so the two cannot drift, even though only the build
 * script calls it. The result is meant to be brotli-compressed before it is
 * written to disk - the pages are mostly Ruby's object heap and compress about
 * five to one.
 */
export const encodeSnapshot = (snapshot: BootSnapshot): Uint8Array => {
  const header: SnapshotHeader = {
    magic: SNAPSHOT_MAGIC,
    artifact: snapshot.artifact,
    bootSteps: snapshot.bootSteps,
    totalPages: snapshot.totalPages,
    pageIndices: snapshot.pageIndices,
    files: snapshot.files,
  }

  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const out = new Uint8Array(4 + headerBytes.byteLength + snapshot.pages.byteLength)
  new DataView(out.buffer).setUint32(0, headerBytes.byteLength, true)
  out.set(headerBytes, 4)
  out.set(snapshot.pages, 4 + headerBytes.byteLength)

  return out
}
