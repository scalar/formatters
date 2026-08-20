// Verifies that google-java-format running on wasm produces byte-identical
// output to the same version running on a JVM.
//
// Like the Ruby package's conformance test, this one asserts rather than
// reports: the package IS google-java-format, so any divergence is a real bug -
// a miscompile, or a build that picked up the wrong jar - not a stylistic gap.
//
// Skipped unless a JVM and the matching google-java-format are available. Two
// ways to satisfy that, in order: a `google-java-format` on PATH, or the jar a
// build script downloads into its toolchain directory, which is there on any
// machine that has built the artifact.
//
// The jar it looks for is the *stock* one from Maven Central, never the patched
// copy the TeaVM build compiles. Comparing the wasm against a jar carrying the
// same patches would only prove the patches are self-consistent.
//
// The version has to match GJF_VERSION exactly. A native tool one release ahead
// would fail this test for having changed its own formatting, which says
// nothing about whether the wasm build is faithful.

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { format, googleJavaFormatVersion } from '../src/index'
import { describe, expect, it } from 'bun:test'

const here = path.dirname(fileURLToPath(import.meta.url))

/** The version the artifact carries, which src/version.test.ts holds to the build script's pin. */
const GJF_VERSION = googleJavaFormatVersion

const JAVAC_EXPORTS = ['api', 'code', 'file', 'main', 'parser', 'tree', 'util'].map(
  (pkg) => `--add-exports=jdk.compiler/com.sun.tools.javac.${pkg}=ALL-UNNAMED`,
)

/** How to invoke a native google-java-format of the version we compiled. */
type NativeCommand = { file: string; args: string[] }

/** Resolves the command that runs a native google-java-format, if one exists. */
const nativeCommand = (): NativeCommand | undefined => {
  // google-java-format prints its version banner on stderr, so this reads both
  // streams and asks whether our version is named anywhere in them - rather
  // than trusting stdout, or an exit code the tool does not promise.
  const versionOf = (file: string, args: string[]): string => {
    const result = spawnSync(file, [...args, '--version'], { encoding: 'utf8' })
    return `${result.stdout ?? ''}${result.stderr ?? ''}`
  }

  if (versionOf('google-java-format', []).includes(GJF_VERSION)) {
    return { file: 'google-java-format', args: [] }
  }

  const build = path.join(here, '..', '..', '..', 'build')
  for (const pipeline of ['java_fmt_teavm', 'java_fmt']) {
    const jar = path.join(build, pipeline, 'toolchain', `google-java-format-${GJF_VERSION}-all-deps.jar`)
    if (!fs.existsSync(jar)) continue
    const args = [...JAVAC_EXPORTS, '-jar', jar]
    if (versionOf('java', args).includes(GJF_VERSION)) return { file: 'java', args }
  }

  return undefined
}

const native = nativeCommand()

/**
 * Formats every sample in one JVM, in place.
 *
 * One child per sample is the obvious shape and the wrong one: JVM startup
 * dwarfs the formatting, and a dozen of them run long enough for the test
 * runner to SIGTERM a child mid-format, which surfaces as an empty-stderr crash
 * rather than the timeout it is. `--replace` is what makes batching possible -
 * formatting several files to stdout concatenates them with no delimiter.
 */
const nativeFormatAll = (sources: string[], extraArgs: string[] = []): string[] => {
  if (!native) throw new Error('no native google-java-format to compare against')

  const dir = fs.mkdtempSync(path.join(tmpdir(), 'gjf-conformance-'))
  try {
    const files = sources.map((source, index) => {
      const file = path.join(dir, `Sample${index}.java`)
      fs.writeFileSync(file, source)
      return file
    })
    execFileSync(native.file, [...native.args, ...extraArgs, '--replace', ...files], {
      encoding: 'utf8',
    })
    return files.map((file) => fs.readFileSync(file, 'utf8'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const SAMPLES = {
  'long argument lists': `package com.example;
import java.util.*;
class Client {
  private final String baseUrl; private final int timeout;
  Client(String baseUrl,int timeout){this.baseUrl=baseUrl;this.timeout=timeout;}
  List<User> listUsers(int page,int perPage,String filter,boolean includeDeleted,Comparator<User> order){
    return request("/users",Map.of("page",page,"per_page",perPage,"filter",filter,"deleted",includeDeleted),order);
  }
}`,
  'generics and lambdas': `class Registry<T extends Comparable<T>> {
  private final Map<String,List<T>> byKey=new HashMap<>();
  void register(String key,T value){byKey.computeIfAbsent(key,k->new ArrayList<>()).add(value);}
  Optional<T> best(String key){return byKey.getOrDefault(key,List.of()).stream().max(Comparator.naturalOrder());}
}`,
  'annotations and javadoc': `/**
 * A thing.
 *   @param name the name
 */
@Deprecated @SuppressWarnings({"unchecked","rawtypes"})
public final class Thing implements Runnable {
  @Override public void run(){}
}`,
  'switch and text blocks': `class Codes {
  static String describe(int status){
    return switch(status){
      case 200,201 -> "ok";
      case 404 -> "missing";
      default -> """
          unexpected
          status""";
    };
  }
}`,
  'chained calls past the margin': `class Pipeline {
  static String run(List<String> names){
    return names.stream().filter(n->!n.isEmpty()).map(String::trim).map(String::toLowerCase).sorted().distinct().collect(Collectors.joining(", "));
  }
}`,
  'a string literal reflowed past the margin': `class Reflow {
  void run(){
    x(B.builder().n(B.builder().n(B.builder().m("Example Business Solutions for a much longer trailing phrase").build()).build()).build());
  }
}`,
  'comments in awkward places': `class Sparse {
  int a; // trailing
  /* leading */ int b;
  void f(/* first */ int x, int y /* second */){
    // body
  }
}`,
}

/**
 * The over-long literal `SAMPLES` reflows, wrapped in `depth` builder layers.
 *
 * Every layer pushes the literal further right, which is what makes the aosp
 * quirk below read as a layout bug rather than an idempotence one: sweeping the
 * depth reports a narrow band of "wrong" depths with agreement on either side,
 * rather than a constant offset.
 */
const nestedReflow = (depth: number): string => {
  let call = 'B.builder().m("Example Business Solutions for a much longer trailing phrase").build()'
  for (let i = 0; i < depth; i++) call = `B.builder().n(${call}).build()`
  return `class Nested {\n  void run(){\n    x(${call});\n  }\n}\n`
}

describe('native-conformance', () => {
  const samples = Object.entries(SAMPLES)
  const sources = samples.map(([, source]) => source)

  it.skipIf(!native)('matches native google-java-format byte for byte', async () => {
    const expected = nativeFormatAll(sources)

    for (const [index, [name, source]] of samples.entries()) {
      expect(await format(source), `diverged on: ${name}`).toBe(expected[index] ?? '')
    }
  })

  it.skipIf(!native)('matches native google-java-format in aosp style', async () => {
    const expected = nativeFormatAll(sources, ['--aosp'])

    for (const [index, [name, source]] of samples.entries()) {
      expect(await format(source, { style: 'aosp' }), `diverged on: ${name}`).toBe(expected[index] ?? '')
    }
  })

  // google-java-format 1.36.1 is not idempotent in aosp style on a reflowed
  // string literal: `StringWrapper` writes the `+` continuation at a hardcoded
  // four columns, and the next run re-indents it to the eight aosp actually
  // uses. So the tool's first output is not a fixed point of the tool.
  //
  // That is upstream's behaviour, not a gap in this build, and the two are easy
  // to confuse - formatting here and then verifying with the jar compares pass
  // one against pass two and reports a divergence that is really the jar
  // disagreeing with itself. This walks both through the same three passes and
  // asserts they agree at each one, then pins the quirk itself so a future
  // upstream fix shows up here as a failing expectation rather than a surprise.
  it.skipIf(!native)('tracks native google-java-format through its aosp reflow passes', async () => {
    const source = SAMPLES['a string literal reflowed past the margin']
    const passes: string[] = []
    let wasm = source
    let jvm = source

    for (const pass of [1, 2, 3]) {
      wasm = await format(wasm, { style: 'aosp' })
      jvm = nativeFormatAll([jvm], ['--aosp'])[0] ?? ''
      expect(wasm, `diverged on aosp pass ${pass}`).toBe(jvm)
      passes.push(wasm)
    }

    expect(passes[0], 'upstream became idempotent; drop the workaround note in the README').not.toBe(passes[1])
    expect(passes[1], 'upstream stopped settling after two passes').toBe(passes[2])
  })

  // The same quirk as reported from downstream, where it arrives as a nesting
  // sweep rather than one file: format here, re-run the jar over that output,
  // and the diff is empty at most depths and four to six lines at a couple of
  // them. A band like that reads like this build capping a continuation indent
  // the jar does not cap, so it is worth having the refutation in CI rather
  // than in a reply.
  //
  // There is no band. Pass one agrees with the jar at every depth; the band is
  // the *jar* disagreeing with itself, and it is narrow because the eight-column
  // continuation only survives while it still fits - deeper in, the second pass
  // overflows the margin, `StringWrapper` wraps it again, and four comes back.
  it.skipIf(!native)('matches native google-java-format in aosp at every nesting depth', async () => {
    const depths = [0, 1, 2, 3, 4]
    const probes = depths.map(nestedReflow)
    const firstPass = nativeFormatAll(probes, ['--aosp'])

    for (const [index, depth] of depths.entries()) {
      expect(await format(probes[index] ?? '', { style: 'aosp' }), `diverged from the jar at depth ${depth}`).toBe(
        firstPass[index] ?? '',
      )
    }

    // And the band itself, so that upstream fixing this shows up here rather
    // than as a second round of the same report.
    const secondPass = nativeFormatAll(firstPass, ['--aosp'])
    const unstable = depths.filter((_, index) => firstPass[index] !== secondPass[index])

    expect(unstable, 'the jar re-indents a different set of depths than it used to').toEqual([1, 2])
  })

  it.skipIf(!native)('is idempotent in google style where the tool is', async () => {
    const source = SAMPLES['a string literal reflowed past the margin']
    const once = await format(source)

    expect(await format(once)).toBe(once)
    expect(nativeFormatAll([once])[0] ?? '').toBe(once)
  })
})
