// Verifies that the package produces byte-identical output to the real ktfmt.
//
// This is the whole of the evidence for the package. It is ktrs - ktfmt
// reimplemented in Rust and compiled to wasm - and a reimplementation is exact
// only for as long as something keeps checking it against the tool it
// reimplements. So this asserts rather than reports: any divergence is a bug.
//
// The native side is ktfmt's own release jar, run as its command line over a
// directory of files, and nothing of ours. Each source is written as a `.kts`,
// because the package parses as a script - the way ktfmt parses stdin - and a
// `.kt` file would hold ktfmt to a stricter grammar than the package. A source
// ktfmt rejects has to be rejected here too, with the same diagnostic.
//
// Skipped unless a native ktfmt of the *pinned* version is available - the one
// ktrs ports, which src/version.test.ts holds to build/kotlin_fmt/build.sh.
// Three ways to provide it, in order: a `ktfmt` on PATH reporting that version,
// a jar named by KTFMT_JAR, or the jar build/kotlin_fmt/ktfmt.sh downloads.
// CI runs that script, so this runs there rather than quietly skipping.
//
// Set KOTLIN_FMT_CONFORMANCE_CORPUS to a directory of .kt and .kts files to run
// the same comparison over all of them as well, in every style. That is how the
// corpus comparison in the README was made, and how to repeat it.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { format, ktfmtVersion } from '../src/index'
import type { FormatOptions } from '../src/types'
import { describe, expect, it } from 'bun:test'

const here = path.dirname(fileURLToPath(import.meta.url))

/** How to invoke the native ktfmt. */
type NativeCommand = { file: string; args: string[] }

/** What ktfmt did with one source: formatted it, or rejected it with a diagnostic. */
type Outcome = { output: string } | { error: string }

/** Resolves the command that runs a native ktfmt of the pinned version, if one exists. */
const nativeCommand = (): NativeCommand | undefined => {
  const reports = (command: NativeCommand): boolean => {
    const result = spawnSync(command.file, [...command.args, '--version'], { encoding: 'utf8' })
    // Exactly the version, so 0.65 does not accept a 0.650.
    return new RegExp(`^ktfmt version ${ktfmtVersion.replaceAll('.', '\\.')}$`, 'm').test(result.stdout ?? '')
  }

  const candidates: NativeCommand[] = [{ file: 'ktfmt', args: [] }]
  const jars = [
    process.env['KTFMT_JAR'],
    path.join(here, '..', '..', '..', 'build', 'kotlin_fmt', 'work', `ktfmt-${ktfmtVersion}-with-dependencies.jar`),
  ]
  for (const jar of jars) {
    if (jar && fs.existsSync(jar)) candidates.push({ file: 'java', args: ['-jar', jar] })
  }

  return candidates.find(reports)
}

const native = nativeCommand()

/** The ktfmt flags equivalent to a set of options, for the options its CLI has flags for. */
const flagsFor = (options: FormatOptions): string[] => [
  `--${options.style ?? 'meta'}-style`,
  ...(options.removeUnusedImports === false ? ['--do-not-remove-unused-imports'] : []),
]

/**
 * Formats every source in one JVM, in place.
 *
 * One child per source is the obvious shape and the wrong one: JVM startup
 * dwarfs the formatting. ktfmt formats in place by default, which is what makes
 * batching possible, and reports a file it rejects on stderr as
 * `<path>:<diagnostic>`, leaving the file alone.
 */
const nativeFormatAll = (sources: string[], options: FormatOptions): Outcome[] => {
  if (!native) throw new Error('no native ktfmt to compare against')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ktfmt-conformance-'))
  try {
    const files = sources.map((source, index) => {
      const file = path.join(dir, `${index}.kts`)
      fs.writeFileSync(file, source)
      return file
    })

    // An argument file rather than argv, so a corpus of thousands of paths
    // cannot exceed the command-line limit.
    const argfile = path.join(dir, 'args.txt')
    fs.writeFileSync(argfile, [...flagsFor(options), '--quiet', ...files].join('\n'))
    const result = spawnSync(native.file, [...native.args, `@${argfile}`], { encoding: 'utf8' })

    const errors = new Map<string, string>()
    for (const line of (result.stderr ?? '').split('\n')) {
      const file = files.find((candidate) => line.startsWith(`${candidate}:`))
      if (file) errors.set(file, line.slice(file.length + 1))
    }
    // Anything else on a failed run is ktfmt itself failing, not a source it
    // rejected, and comparing against it would be meaningless.
    if (result.status !== 0 && errors.size === 0) {
      throw new Error(`native ktfmt failed: ${result.stderr ?? result.error}`)
    }

    return files.map((file) => {
      const error = errors.get(file)
      return error === undefined ? { output: fs.readFileSync(file, 'utf8') } : { error }
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** What the package does with one source, in the same shape. */
const packageFormat = async (source: string, options: FormatOptions): Promise<Outcome> => {
  try {
    return { output: await format(source, options) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

const SAMPLES = {
  'long argument lists': `package com.example
import kotlin.math.max
class Client(private val baseUrl:String,private val timeout:Int){
fun listUsers(page:Int,perPage:Int,filter:String,includeDeleted:Boolean,order:Comparator<User>):List<User> {
return request("/users",mapOf("page" to page,"per_page" to perPage,"filter" to filter,"deleted" to includeDeleted),order)
}
}`,
  'generics and lambdas': `class Registry<T:Comparable<T>>{
private val byKey=HashMap<String,MutableList<T>>()
fun register(key:String,value:T){byKey.getOrPut(key){mutableListOf()}.add(value)}
fun best(key:String):T?  =byKey.getOrDefault(key,mutableListOf()).maxOrNull()
}`,
  'annotations and kdoc': `/**
 * A thing.
 *   @param name the name
 */
@Deprecated("old") @Suppress("UNCHECKED_CAST","UNUSED")
class Thing(val name:String):Runnable{
override fun run(){}
}`,
  'when and multiline strings': `object Codes{
fun describe(status:Int):String = when(status){
200,201->"ok"
404->"missing"
else->"""
    unexpected
    status"""
}
}`,
  'chained calls past the margin': `object Pipeline{
fun run(names:List<String>):String =
names.filter{it.isNotEmpty()}.map{it.trim()}.map{it.lowercase()}.sorted().distinct().joinToString(", ")
}`,
  'trailing commas and nested lambdas': `fun build(){
App{
SelectableCard{
Button{Text("Hello")}
}
}
val xs=listOf(1,2,3,)
}`,
  'comments in awkward places': `class Sparse{
val a=1 // trailing
/* leading */ val b=2
fun f(/* first */ x:Int,y:Int /* second */){
// body
}
}`,
  'unused and sorted imports': `import b.Second
import a.First
import c.Unused
fun f()=First(Second())`,
  'top-level statements': `val greeting="hi"
println( greeting )`,
  'crlf line endings': 'class A{\r\nfun f(){}\r\n}\r\n',
  unicode: `fun greet(){val s="héllo wörld 🌍";println(s)}`,
  'a syntax error': 'fun f( {',
}

const names = Object.keys(SAMPLES)
const sources = Object.values(SAMPLES)

/** The corpus named by KOTLIN_FMT_CONFORMANCE_CORPUS, if any: every .kt and .kts file under it. */
const corpusFiles = (): string[] => {
  const root = process.env['KOTLIN_FMT_CONFORMANCE_CORPUS']
  if (!root) return []
  return (fs.readdirSync(root, { recursive: true, encoding: 'utf8' }) as string[])
    .filter((file) => /\.kts?$/.test(file))
    .map((file) => path.join(root, file))
    .sort()
}

const corpus = corpusFiles()

const CASES: { label: string; options: FormatOptions }[] = [
  { label: 'meta style', options: { style: 'meta' } },
  { label: 'google style', options: { style: 'google' } },
  { label: 'kotlinlang style', options: { style: 'kotlinlang' } },
  { label: 'keeping unused imports', options: { removeUnusedImports: false } },
]

describe('conformance with native ktfmt', () => {
  for (const { label, options } of CASES) {
    describe(label, () => {
      // One JVM for each case rather than one per sample, then a test per
      // sample so a divergence names the case that diverged.
      const expected = native ? nativeFormatAll(sources, options) : []

      names.forEach((name, index) => {
        it.skipIf(!native)(name, async () => {
          expect(await packageFormat(sources[index] as string, options)).toEqual(expected[index] as Outcome)
        })
      })

      it.skipIf(!native || corpus.length === 0)(
        `matches over KOTLIN_FMT_CONFORMANCE_CORPUS (${corpus.length} files)`,
        async () => {
          const inputs = corpus.map((file) => fs.readFileSync(file, 'utf8'))
          const outcomes = nativeFormatAll(inputs, options)

          const diverged: string[] = []
          for (const [index, input] of inputs.entries()) {
            const actual = await packageFormat(input, options)
            if (!Bun.deepEquals(actual, outcomes[index])) diverged.push(corpus[index] as string)
          }

          const rejected = outcomes.filter((outcome) => 'error' in outcome).length
          console.log(
            `${label}: ${inputs.length - diverged.length}/${inputs.length} identical, ${rejected} rejected by both`,
          )
          expect(diverged).toEqual([])
        },
        // A JVM over thousands of files, then the same through the package.
        600_000,
      )
    })
  }
})
