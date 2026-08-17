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

import { format } from '../src/index'
import { describe, expect, it } from 'bun:test'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Kept in step with GJF_VERSION in the build scripts. */
const GJF_VERSION = '1.36.1'

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
  'comments in awkward places': `class Sparse {
  int a; // trailing
  /* leading */ int b;
  void f(/* first */ int x, int y /* second */){
    // body
  }
}`,
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
})
