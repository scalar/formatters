// Verifies that CSharpier running on wasm produces byte-identical output to the
// same version running on .NET.
//
// Like the Ruby and Java conformance tests, this one asserts rather than
// reports: the package IS CSharpier, so any divergence is a real bug - a
// miscompile, a trimmed code path, or a build that picked up the wrong package
// version - not a stylistic gap.
//
// Skipped unless a native `csharpier` of the matching version is on PATH.
// `dotnet tool install -g csharpier --version <CSHARPIER_VERSION>` puts one
// there. The version has to match exactly: a native tool one release ahead
// would fail this test for having changed its own formatting, which says
// nothing about whether the wasm build is faithful.

import { spawnSync } from 'node:child_process'
import path from 'node:path'

import { format } from '../src/index'
import { describe, expect, it } from 'bun:test'

/** Kept in step with CSHARPIER_VERSION in build/csharp_fmt/build.sh. */
const CSHARPIER_VERSION = '1.3.0'

/**
 * Whether a native csharpier of exactly our version is available and runnable.
 *
 * The exit status matters as much as the version string. A `csharpier` shim
 * installed by `dotnet tool install` but with no .NET runtime to host it fails
 * with a message that quotes its own install path - which contains the version
 * number, so matching on output alone reports a working tool that is not there.
 */
const hasNative = (): boolean => {
  const result = spawnSync('csharpier', ['--version'], { encoding: 'utf8' })
  if (result.status !== 0) return false
  return (result.stdout ?? '').includes(CSHARPIER_VERSION)
}

const native = hasNative()

/**
 * Formats one sample with the native CLI.
 *
 * Input goes in over stdin so nothing is written to disk, but `--stdin-path`
 * still has to be an absolute path: the CLI derives the directory it searches
 * for `.csharpierrc` and `.editorconfig` from it, and throws on a bare
 * filename. Pointing it at the OS temp directory - where this repo keeps no
 * config - is what makes the comparison a defaults-to-defaults one.
 */
const formatNatively = (source: string): string => {
  const result = spawnSync(
    'csharpier',
    ['format', '--write-stdout', '--stdin-path', path.join('/tmp', 'conformance.cs')],
    { input: source, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )

  if (result.status !== 0) {
    throw new Error(`native csharpier exited ${result.status}: ${result.stderr}`)
  }
  return result.stdout
}

/**
 * Samples chosen to exercise the decisions the printer actually makes - line
 * breaking, using order, trivia placement, modern syntax - rather than to look
 * like a tour of the language. The underscore-sorting one guards the ICU build
 * specifically; see build/csharp_fmt/NOTES.md.
 */
const samples: Record<string, string> = {
  'class with members': 'class A{int x=1;string s="hi";void F(int a,int b){G(a+b);}}',
  'using order': 'using System.Text;using A;using System;using B.C;using static X;class D{}',
  'underscore sorting': 'using N.MWord;using N.ZWord;using N._Word;class C{}',
  'long argument list':
    'class A{void F(){SomeVeryLongMethodName(argumentNumberOne,argumentNumberTwo,argumentNumberThree,argumentNumberFour);}}',
  'nested generics': 'using System.Collections.Generic;class A{Dictionary<string,List<int>> m;}',
  'records and patterns':
    'record Point(int X,int Y);class A{string F(object o)=>o switch{Point(0,0)=>"origin",Point p=>p.ToString(),_=>"?"};}',
  'linq query':
    'using System.Linq;class A{void F(int[] xs){var q=from x in xs where x>2 orderby x descending select x*2;}}',
  comments: '// leading\nclass A{ /* inner */ void F(){} // trailing\n}',
  'attributes and modifiers':
    '[System.Obsolete("x")]public   static   partial class A{public static async System.Threading.Tasks.Task F(){await G();}}',
  'raw and interpolated strings': 'class A{string a=$"{X} and {Y}";string b="""\n  raw\n  """;}',
  'switch and loops':
    'class A{void F(int n){switch(n){case 1:G();break;default:H();break;}for(var i=0;i<n;i++){G();}while(n>0){n--;}}}',
  'lambdas and locals': 'using System;class A{void F(){Func<int,int> f=x=>x*2;int Local(int y)=>y+1;var t=(a:1,b:2);}}',
  'unicode literals': 'class A{string s="héllo wörld 🌍";}',
  'preprocessor directives': '#define X\nclass A{\n#if X\nvoid F(){}\n#endif\n}',
  'nullable and generics': 'using System;class A<T> where T:class,new(){T? Value{get;set;}public A(){Value=new T();}}',
}

describe.skipIf(!native)(`matches native csharpier ${CSHARPIER_VERSION}`, () => {
  for (const [name, source] of Object.entries(samples)) {
    it(`formats ${name} identically`, async () => {
      expect(await format(source)).toBe(formatNatively(source))
    })
  }

  it('agrees on already-formatted output', async () => {
    // Formatting a formatted file is where a divergence hides best: both sides
    // should be at a fixed point, so any difference is the printer disagreeing
    // with itself rather than with the input.
    const source = samples['class with members'] as string
    const once = await format(source)
    expect(await format(once)).toBe(formatNatively(once))
  })
})

if (!native) {
  describe('native conformance', () => {
    it.skip(`needs csharpier ${CSHARPIER_VERSION} on PATH`, () => {})
  })
}
