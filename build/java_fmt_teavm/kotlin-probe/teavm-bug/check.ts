// node check.ts <path-to-classes.wasm>   (needs Node 24.15+ for the exception-handling opcodes)
//
// Only validation is interesting here, so this compiles the module rather than
// instantiating it. The program is not expected to *run*: the class library
// does not cover everything the IntelliJ platform reaches for. The claim is
// narrower and does not depend on running it — the bytes TeaVM emitted are not
// a well-typed WebAssembly module, and no engine will accept them.
import fs from 'node:fs'

const path = process.argv[2] ?? './target/wasm/classes.wasm'
const raw = fs.readFileSync(path)
const bytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)

/**
 * `WebAssembly.compile` takes a second options argument in V8, and TeaVM's output needs
 * `builtins: ['js-string']` to validate at all. The lib typings still declare the one-argument
 * form, so the call is narrowed here rather than dropping the option to satisfy them.
 */
type CompileWithBuiltins = (bytes: ArrayBuffer, options: { builtins: string[] }) => Promise<WebAssembly.Module>

const compile = WebAssembly.compile as unknown as CompileWithBuiltins

try {
  await compile(bytes, { builtins: ['js-string'] })
  console.log('RESULT: module validates — not reproduced')
} catch (e) {
  console.log('RESULT: module does not validate — reproduced')
  console.log(`  ${String(e).split('\n')[0]}`)
}
