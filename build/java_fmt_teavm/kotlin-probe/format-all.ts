// node format-all.ts <wasm-dir> <corpus> <out> <style>   (needs Node 24.15+)
//
// The wasm half of conformance.sh. Deliberately the same shape as FormatAll.java:
// one module instance for the whole corpus, one file per output, and the error
// text written where the formatted source would go, so a difference in how a
// failure is reported shows up as a difference like any other.
import fs from 'node:fs'
import path from 'node:path'

import type { TeaVmRuntime } from '../teavm-runtime'

const [wasmDir, corpus, out, style] = process.argv.slice(2)

if (!wasmDir || !corpus || !out || !style) {
  console.error('usage: node format-all.ts <wasm-dir> <corpus> <out> <style>')
  process.exit(2)
}

// Only the style varies here; every other field defers to that style's preset.
const options = `${style}|-|-|-|-|-|-`

// Generated into the build's target/, so it has to be resolved at run time rather than imported.
const runtime: TeaVmRuntime = await import(path.resolve(wasmDir, 'classes.wasm-runtime.js'))
const raw = fs.readFileSync(path.resolve(wasmDir, 'classes.wasm'))
const teavm = await runtime.load(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), {})
const format = teavm.exports.format

if (!format) {
  console.error(`${wasmDir} exports no format(); it was built from the wrong pom.`)
  process.exit(2)
}

const files: string[] = []
const walk = (dir: string): void => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.kt')) files.push(full)
  }
}
walk(corpus)
files.sort()

let ok = 0
let failed = 0
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  const result = format(source, options)
  if (result.startsWith('O')) ok++
  else failed++
  const target = path.join(out, path.relative(corpus, file))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, result, 'utf8')
}
console.log(`${files.length} files, ${ok} formatted, ${failed} reported an error`)
