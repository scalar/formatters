// Verifies that ktfmt running on wasm produces byte-identical output to the
// same version running on a JVM.
//
// Like the Java package's conformance test, this one asserts rather than
// reports: the package IS ktfmt, so any divergence is a real bug - a miscompile,
// or a build that picked up the wrong jar - not a stylistic gap.
//
// Skipped unless a JVM and the matching ktfmt are available. Two ways to satisfy
// that, in order: a `ktfmt` on PATH, or the jars the build scripts download into
// build/java_fmt_teavm/kotlin-probe/work, which are there on any machine that
// has built the artifact.
//
// The jar it looks for is the *stock* one from Maven Central, never
// ktfmt-patched.jar, which the wasm build compiles. Comparing the wasm against a
// jar carrying the same patch would only prove the patch is self-consistent -
// gate2.sh is what proves the patch changes nothing, over a far larger corpus.
//
// This is a handful of samples, deliberately. The exhaustive comparison is
// conformance.sh: 589 files in three styles. This one exists so that a
// divergence fails `bun test` rather than waiting for someone to run a shell
// script.

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { format } from '../src/index'
import type { FormatOptions } from '../src/types'
import { describe, expect, it } from 'bun:test'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Kept in step with KTFMT_VERSION in the build scripts. */
const KTFMT_VERSION = '0.64'

/** How to invoke a native ktfmt of the version we compiled. */
type NativeCommand = { file: string; args: string[] }

/** Resolves the command that runs a native ktfmt, if one exists. */
const nativeCommand = (): NativeCommand | undefined => {
  const versionOf = (file: string, args: string[]): string => {
    const result = spawnSync(file, [...args, '--version'], { encoding: 'utf8' })
    return `${result.stdout ?? ''}${result.stderr ?? ''}`
  }

  if (versionOf('ktfmt', []).includes(KTFMT_VERSION)) return { file: 'ktfmt', args: [] }

  // ktfmt ships without its dependencies, so the jar alone will not run: the
  // Kotlin compiler, its runtime and google-java-format's layout engine all
  // have to be on the classpath beside it.
  const work = path.join(here, '..', '..', '..', 'build', 'java_fmt_teavm', 'kotlin-probe', 'work')
  const jars = [
    'ktfmt.jar',
    'kotlin-compiler-embeddable.jar',
    'kotlin-stdlib.jar',
    'kotlin-reflect.jar',
    'kotlin-script-runtime.jar',
    'kotlin-daemon-embeddable.jar',
    'coroutines.jar',
    'annotations.jar',
    'gjf.jar',
    'guava.jar',
  ].map((jar) => path.join(work, jar))

  if (!jars.every((jar) => fs.existsSync(jar))) return undefined
  const args = ['-cp', jars.join(path.delimiter), 'com.facebook.ktfmt.cli.Main']
  return versionOf('java', args).includes(KTFMT_VERSION) ? { file: 'java', args } : undefined
}

const native = nativeCommand()

/**
 * Formats every sample in one JVM, in place.
 *
 * One child per sample is the obvious shape and the wrong one: JVM startup
 * dwarfs the formatting, and ktfmt's is worse than most because it builds an
 * IntelliJ container first. ktfmt formats in place by default, which is what
 * makes batching possible.
 */
const nativeFormatAll = (sources: string[], extraArgs: string[] = []): string[] => {
  if (!native) throw new Error('no native ktfmt to compare against')

  const dir = fs.mkdtempSync(path.join(tmpdir(), 'ktfmt-conformance-'))
  try {
    const files = sources.map((source, index) => {
      const file = path.join(dir, `Sample${index}.kt`)
      fs.writeFileSync(file, source)
      return file
    })
    execFileSync(native.file, [...native.args, ...extraArgs, ...files], { encoding: 'utf8' })
    return files.map((file) => fs.readFileSync(file, 'utf8'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
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
  unicode: `fun greet(){val s="héllo wörld 🌍";println(s)}`,
}

const names = Object.keys(SAMPLES)
const sources = Object.values(SAMPLES)

describe('conformance with native ktfmt', () => {
  // One JVM for each style rather than one per sample, then a test per sample
  // so a divergence names the case that diverged.
  const styles: { style: NonNullable<FormatOptions['style']>; flag: string }[] = [
    { style: 'meta', flag: '--meta-style' },
    { style: 'google', flag: '--google-style' },
    { style: 'kotlinlang', flag: '--kotlinlang-style' },
  ]

  for (const { style, flag } of styles) {
    describe(`${style} style`, () => {
      const expected = native ? nativeFormatAll(sources, [flag]) : []

      names.forEach((name, index) => {
        it.skipIf(!native)(name, async () => {
          expect(await format(sources[index] as string, { style })).toBe(expected[index] as string)
        })
      })
    })
  }
})
