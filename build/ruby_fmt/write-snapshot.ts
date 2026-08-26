// Produces packages/ruby/ruby_fmt.snapshot.br: an image of a booted Ruby VM.
//
// Run after build.sh, or on its own whenever the boot sequence in
// `packages/ruby/src` changes. The snapshot is keyed to a fingerprint of the
// artifact, so a rebuilt artifact with a stale snapshot beside it is simply
// ignored at runtime rather than mis-restored - but it also means a rebuilt
// artifact wants a rebuilt snapshot, or every consumer pays the slow boot.
//
//   bun build/ruby_fmt/write-snapshot.ts
//
// What it does is the same trick Wizer plays at the wasm level, done here in
// JavaScript so that the artifact stays exactly the CRuby ruby.wasm builds. Boot
// a VM the long way, note every 64KB page of linear memory the boot changed,
// and write those pages out. See packages/ruby/src/snapshot.ts for why a memory
// image is enough to reconstruct the VM.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

import { Directory, File } from '@bjorn3/browser_wasi_shim'
import { RubyVM } from '@ruby/wasm-wasi'

import { BOOT_FINGERPRINT, BOOT_SCRIPTS, createWasi } from '../../packages/ruby/src/boot-vm'
import { DEFAULT_CONFIG_FILE_NAME, buildRuboCopConfig } from '../../packages/ruby/src/rubocop'
import {
  type BootSnapshot,
  type SnapshotFile,
  WASM_PAGE_BYTES,
  encodeSnapshot,
  fingerprintArtifact,
} from '../../packages/ruby/src/snapshot'

/**
 * The source the snapshot is warmed with.
 *
 * Not a benchmark and not a test - it exists only to make both tools do the
 * things they do lazily on first use, so that the first caller does not. A
 * spread of constructs rather than a long file, because what matters is how
 * many code paths it touches, not how much text goes through them.
 */
const WARMUP_SOURCE = `# frozen_string_literal: true

module Warmup
  CONSTANT = { one: 1, two: 2 }.freeze

  class Example < Base
    attr_reader :name

    def initialize(name, values = [])
      @name = name
      @values = values
      super()
    end

    def call(other)
      result = @values.map { |value| value * 2 }
                      .select { |value| value > 3 }
      case other
      when String then result << other
      when Array  then result.concat(other)
      else
        result
      end
    rescue StandardError => error
      warn(error.message)
      []
    ensure
      @values = nil
    end

    def report
      <<~TEXT
        name: #{@name}
        size: #{@values&.size}
      TEXT
    end
  end
end
`

const packageDir = path.join(import.meta.dir, '..', '..', 'packages', 'ruby')
const artifactPath = path.join(packageDir, 'ruby_fmt.wasm.br')
const snapshotPath = path.join(packageDir, 'ruby_fmt.snapshot.br')

const wasmBytes = zlib.brotliDecompressSync(fs.readFileSync(artifactPath))
const wasmModule = await WebAssembly.compile(wasmBytes)

/**
 * The memory a bare instance starts with: data segments applied, nothing run.
 *
 * This is the baseline the snapshot is a diff against, and it has to be this
 * one rather than the memory a *booted* VM starts from. CRuby seeds hashes and
 * object ids from entropy during startup, so two boots of the same artifact do
 * not produce the same bytes - a diff against one of them would silently depend
 * on pages the other process never wrote. Data segments, by contrast, are
 * static, so this baseline is the same in every process that will ever restore
 * the image.
 */
const bareMemory = (): Uint8Array => {
  const wasi = createWasi(new Map())
  const vm = new RubyVM()
  const imports = { wasi_snapshot_preview1: wasi.wasiImport }
  vm.addToImports(imports)
  const instance = new WebAssembly.Instance(wasmModule, imports)
  return new Uint8Array((instance.exports['memory'] as WebAssembly.Memory).buffer)
}

const baseline = Uint8Array.from(bareMemory())
console.log(`baseline ${(baseline.byteLength / 1e6).toFixed(0)}MB`)

const workFiles = new Map<string, Directory | File>()
const wasi = createWasi(workFiles)
const started = performance.now()
const { vm } = await RubyVM.instantiateModule({ module: wasmModule, wasip1: wasi })

for (const script of BOOT_SCRIPTS) vm.eval(script)

// Parse the default RuboCop config into the image as well. Merging a config
// over RuboCop's default.yml costs about a second on this VM, and the caller who
// says nothing - which is nearly all of them - would otherwise pay it on their
// very first format. `format.ts` reserves this filename precisely so the cache
// entry the guest builds here is the one it looks up later.
const defaultConfig = buildRuboCopConfig()
workFiles.set(DEFAULT_CONFIG_FILE_NAME, new File(new TextEncoder().encode(defaultConfig)))
vm.eval(`ScalarRubyFmt.config_for("/work/${DEFAULT_CONFIG_FILE_NAME}")`)

// One real format, discarded, so that everything RuboCop and syntax_tree build
// lazily on first use is already built. It is the same work the first caller
// would do, moved to build time.
workFiles.set('input.rb', new File(new TextEncoder().encode(WARMUP_SOURCE)))
vm.eval(
  `out = SyntaxTree.format(File.read("/work/input.rb"), 80)
   ScalarRubyFmt.correct(out, "/work/input.rb", "/work/${DEFAULT_CONFIG_FILE_NAME}")`,
)
workFiles.delete('input.rb')

vm.eval('GC.start')
console.log(`booted in ${((performance.now() - started) / 1000).toFixed(1)}s`)

const memory = wasi.inst.exports.memory
const booted = new Uint8Array(memory.buffer)
const totalPages = booted.byteLength / WASM_PAGE_BYTES

const pageIndices: number[] = []
for (let page = 0; page < totalPages; page++) {
  const start = page * WASM_PAGE_BYTES
  const end = start + WASM_PAGE_BYTES
  for (let index = start; index < end; index++) {
    if (booted[index] !== (index < baseline.byteLength ? baseline[index] : 0)) {
      pageIndices.push(page)
      break
    }
  }
}

const pages = new Uint8Array(pageIndices.length * WASM_PAGE_BYTES)
pageIndices.forEach((page, index) => {
  pages.set(booted.subarray(page * WASM_PAGE_BYTES, (page + 1) * WASM_PAGE_BYTES), index * WASM_PAGE_BYTES)
})

/** Flattens the guest's `/work` tree into the paths and bytes the snapshot carries. */
const collect = (directory: Map<string, Directory | File>, prefix: string): SnapshotFile[] =>
  [...directory].flatMap(([name, entry]) =>
    entry instanceof Directory
      ? collect(entry.contents as Map<string, Directory | File>, `${prefix}${name}/`)
      : [{ path: `${prefix}${name}`, data: Buffer.from(entry.data).toString('base64') }],
  )

const snapshot: BootSnapshot = {
  artifact: fingerprintArtifact(wasmBytes),
  bootSteps: BOOT_FINGERPRINT,
  totalPages,
  pageIndices,
  pages,
  files: collect(workFiles, ''),
}

console.log(
  `${pageIndices.length} of ${totalPages} pages changed (${((pageIndices.length * WASM_PAGE_BYTES) / 1e6).toFixed(0)}MB), ` +
    `${snapshot.files.length} guest files`,
)

const encoded = encodeSnapshot(snapshot)
const compressed = zlib.brotliCompressSync(encoded, {
  params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: encoded.byteLength,
  },
})

fs.writeFileSync(snapshotPath, compressed)
console.log(`wrote ${(compressed.byteLength / 1e6).toFixed(2)}MB -> packages/ruby/ruby_fmt.snapshot.br`)
