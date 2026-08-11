// Verifies that rustfmt running on wasm produces byte-identical output to the
// same version running natively.
//
// This one asserts rather than reports: the package IS rustfmt, so any
// divergence is a real bug rather than a known stylistic gap.
//
// Two things make "the same version" load-bearing here, and both are enforced
// below rather than assumed:
//
//   1. rustfmt's output changes between versions, so this only runs against the
//      exact build the artifact was compiled from - the commit pinned in
//      build/rust_fmt/build.sh, read from there rather than duplicated. A
//      `rustfmt` from some other toolchain is skipped, not compared; comparing
//      it would fail for the wrong reason. On a machine with rustup, the pinned
//      one is usually available as
//      `rustup which --toolchain <pin> rustfmt` - set RUSTFMT to its path.
//
//   2. The native CLI walks up from the current directory looking for a
//      `rustfmt.toml`, and the module has no filesystem to search. So the
//      native side runs from `/` with configuration passed explicitly.
//
// Both sides are compared on refusal as well as on success: agreeing about what
// is *not* formattable is part of being the same tool.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { format } from '../src/format'
import { describe, expect, it } from 'bun:test'

const here = path.dirname(fileURLToPath(import.meta.url))
const BUILD_SCRIPT = path.join(here, '..', '..', '..', 'build', 'rust_fmt', 'build.sh')

/** The commit build.sh pins, which is the only rustfmt this artifact matches. */
const pinnedCommit = (): string => {
  const script = fs.readFileSync(BUILD_SCRIPT, 'utf8')
  const match = script.match(/RUST_COMMIT:-([0-9a-f]{40})/)
  if (!match?.[1]) throw new Error(`could not read RUST_COMMIT from ${BUILD_SCRIPT}`)
  return match[1]
}

const RUSTFMT = process.env['RUSTFMT'] ?? 'rustfmt'

/** `rustfmt 1.9.0-nightly (eff8269f79 2026-07-18)` -> `eff8269f79`, or undefined. */
const nativeCommit = (): { version: string; commit: string } | undefined => {
  try {
    const version = execFileSync(RUSTFMT, ['--version'], { encoding: 'utf8' }).trim()
    const commit = version.match(/\(([0-9a-f]{9,40})\s/)?.[1]
    return commit ? { version, commit } : undefined
  } catch {
    return undefined
  }
}

const native = nativeCommit()
const matchesPin = native !== undefined && pinnedCommit().startsWith(native.commit)

const reason = native
  ? matchesPin
    ? native.version
    : `${native.version} is not the pinned build - set RUSTFMT to the pinned toolchain's rustfmt`
  : 'rustfmt is not installed'

/** Runs native rustfmt, returning its output or `undefined` if it refused. */
const runNative = (source: string, config: Record<string, string>): string | undefined => {
  const args = ['--emit', 'stdout']
  const pairs = Object.entries(config)
  if (pairs.length > 0) args.push('--config', pairs.map(([key, value]) => `${key}=${value}`).join(','))
  try {
    // cwd `/` so no rustfmt.toml anywhere above this repo can be picked up.
    return execFileSync(RUSTFMT, args, { input: source, encoding: 'utf8', cwd: '/', stdio: ['pipe', 'pipe', 'ignore'] })
  } catch {
    return undefined
  }
}

/** Runs the wasm build, returning its output or `undefined` if it refused. */
const runWasm = async (source: string, config: Record<string, string>): Promise<string | undefined> => {
  try {
    return await format(source, { config })
  } catch {
    return undefined
  }
}

const SAMPLES: Record<string, string> = {
  'functions and control flow': `pub fn add(a: i32,b:i32)->i32{a+b}
fn fibonacci(n:u32)->u32{if n<2{n}else{fibonacci(n-1)+fibonacci(n-2)}}`,
  'structs and impls': `struct  Point{ x:f64,y:  f64 }
impl Point{fn new()->Self{Point{x:0.0,y:0.0}}
fn distance(&self,other:&Point)->f64{let dx=self.x-other.x;let dy=self.y-other.y;(dx*dx+dy*dy).sqrt()}}`,
  'enums and match': `enum Direction{North,South,East,West}
fn describe(d:Direction)->&'static str{match d{
Direction::North=>"north",Direction::South=>"south",
Direction::East=>"east",Direction::West=>"west"}}`,
  'generics and where clauses': `fn merge<T:Ord+Clone,U>(a:&[T],b:&[T],f:impl Fn(&T)->U)->Vec<U> where U:Clone{
let mut v=a.to_vec();v.extend_from_slice(b);v.sort();v.iter().map(f).collect()}`,
  'traits and lifetimes': `trait Draw{fn draw(&self)->String;}
impl<'a,T:Draw> Draw for &'a T{fn draw(&self)->String{(**self).draw()}}`,
  'closures and iterator chains': `fn main(){let total:i32=(1..=10).filter(|n|n%2==0).map(|n|n*n).sum();
let names:Vec<String>=vec!["a","b"].into_iter().enumerate().map(|(i,s)|format!("{}{}",i,s)).collect();}`,
  macros: `macro_rules! square{($x:expr)=>{$x*$x};}
fn main(){println!("{}",square!(4));let v=vec![1,2,3];}`,
  'async and error handling': `async fn load(url:&str)->Result<String,Box<dyn std::error::Error>>{
let body=fetch(url).await?;if body.is_empty(){return Err("empty".into());}Ok(body)}`,
  'comments and doc comments': `// a leading comment
/// A doc comment.
/// More of it.
pub fn f(x:i32)->i32{/* inline */ x}`,
  'strings and unicode': `fn main(){let s="héllo wörld 🌍";let raw=r#"a "quoted" thing"#;
let multi="line one
line two";}`,
  'long argument lists': `fn configure(first_parameter:String,second_parameter:i64,third_parameter:bool,fourth_parameter:f64)->String{
format!("{}{}{}{}",first_parameter,second_parameter,third_parameter,fourth_parameter)}`,
  'modules, use and attributes': `#![allow(dead_code)]
use std::collections::{HashMap,BTreeSet};
mod inner{pub(crate) const X:usize=1;
#[derive(Debug,Clone,PartialEq)]pub struct S{pub a:u8}}`,
  'nested generics': `use std::collections::HashMap;
fn index(items:Vec<(String,Vec<Option<HashMap<String,Vec<u8>>>>)>)->HashMap<String,usize>{
items.into_iter().map(|(k,v)|(k,v.len())).collect()}`,
  'not rust at all': 'fn ( {{{ unclosed',
}

/** Every sample under one configuration, compared on success and on refusal alike. */
const compareAll = async (config: Record<string, string>): Promise<void> => {
  for (const [name, source] of Object.entries(SAMPLES)) {
    const [nativeOut, wasmOut] = [runNative(source, config), await runWasm(source, config)]
    const describe = (out: string | undefined) => (out === undefined ? '<refused>' : out)
    expect(`${name}: ${describe(wasmOut)}`).toBe(`${name}: ${describe(nativeOut)}`)
  }
}

describe('native-conformance', () => {
  it.skipIf(!matchesPin)(`matches native rustfmt byte for byte (${reason})`, async () => {
    await compareAll({})
  })

  it.skipIf(!matchesPin)('matches native rustfmt under a non-default configuration', async () => {
    await compareAll({ max_width: '60', tab_spaces: '2' })
  })

  // The style edition selects the whole set of formatting rules, so it is the
  // option most able to expose a divergence between the two builds.
  it.skipIf(!matchesPin)('matches native rustfmt under style_edition 2024', async () => {
    await compareAll({ style_edition: '2024', edition: '2021' })
  })

  it.skipIf(!matchesPin)('matches native rustfmt on hard tabs and a narrow width', async () => {
    await compareAll({ hard_tabs: 'true', max_width: '50' })
  })
})
