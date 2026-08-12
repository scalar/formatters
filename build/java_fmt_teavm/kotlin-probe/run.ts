// node run.ts <dir-containing-classes.wasm> [kotlin-source]   (needs Node 24.15+)
//
// Gate 1b: does the module *run*? teavm-bug/check.ts only compiles it, which
// is a claim about the bytes being well-formed. This instantiates it and calls
// parse, which is the first claim about the program being correct.
//
// Instantiating is itself part of the test: TeaVM makes the module initializer
// the wasm start function, so a module can validate and still trap before any
// export is reachable.
import fs from 'node:fs'
import path from 'node:path'

import type { TeaVmLoadOptions, TeaVmModule, TeaVmRuntime } from '../teavm-runtime'

const dir = process.argv[2] ?? './target/wasm'
const wasmPath = path.resolve(dir, 'classes.wasm')

// Generated into the build's target/, so it has to be resolved at run time rather than imported.
const runtime: TeaVmRuntime = await import(path.resolve(dir, 'classes.wasm-runtime.js'))

const raw = fs.readFileSync(wasmPath)
const bytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)

// Frames resolve to Java method names only with both of these: the .teadbg
// carries the line tables and the deobfuscator is a wasm module that reads them.
// With neither, a trap reports bare function indices, which
// teavm-bug/decode-types.py -f can still name. With the .teadbg but no
// deobfuscator the runtime still "works" and every frame comes back as
// Throwable$FakeClass.fakeMethod, which is worse than no stack because it looks
// like one. Both come from the build; see the poms.
const teadbg = `${wasmPath}.teadbg`
const deobfuscator = path.resolve(dir, 'classes.wasm-deobfuscator.wasm')
const options: TeaVmLoadOptions =
  fs.existsSync(teadbg) && fs.existsSync(deobfuscator)
    ? { stackDeobfuscator: { enabled: true, externalInfoPath: teadbg, path: deobfuscator } }
    : {}

let teavm: TeaVmModule
try {
  teavm = await runtime.load(bytes, options)
} catch (e) {
  console.log('RESULT: module does not load')
  console.log(e instanceof Error ? e.stack : String(e))
  process.exit(1)
}

const source = process.argv[3] ?? 'fun  main( ) {\nprintln( "hi" )\n}\n'
const style = process.env['STYLE'] ?? 'meta'

// pom.xml exports parse(source) and pom-ktfmt.xml exports format(source, spec),
// and the interesting failures happen in whichever one this module has.
const { format, parse } = teavm.exports
try {
  const result = format ? format(source, `${style}|-|-|-|-|-|-`) : parse?.(source)
  console.log(`RESULT: ${format ? 'format' : 'parse'} returned`)
  console.log(result)
} catch (e) {
  console.log(`RESULT: module loads, ${format ? 'format' : 'parse'} throws`)
  console.log(e instanceof Error ? e.stack : String(e))
  process.exit(1)
}
