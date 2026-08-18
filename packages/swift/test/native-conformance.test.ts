// Verifies that swift-format running on wasm produces byte-identical output to
// the same version running natively.
//
// This one asserts rather than reports: the package IS swift-format, so any
// divergence is a real bug rather than a known stylistic gap.
//
// Skipped unless a native `swift-format` is on PATH, so a toolchain-free
// checkout still passes.
//
// Every sample is formatted with an explicit `--configuration` on the native
// side, because the CLI otherwise walks up from the current directory looking
// for a `.swift-format` file and would format against whatever it finds. The
// module has no filesystem to search, so without pinning both sides the test
// compares two different configurations and fails for the wrong reason.

import { execFileSync } from 'node:child_process'

import { format } from '../src/index'
import { describe, expect, it } from 'bun:test'

const nativeVersion = (): string | undefined => {
  try {
    return execFileSync('swift-format', ['--version'], { encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
}

const version = nativeVersion()

const native = (source: string): string =>
  execFileSync('swift-format', ['format', '--configuration', '{}', '-'], {
    input: source,
    encoding: 'utf8',
  })

const SAMPLES: Record<string, string> = {
  'struct and methods': `import Foundation
struct Point{var x:Int
var y:Int
func distance(to other:Point)->Double{
let dx=Double(x-other.x)
    let dy = Double( y - other.y )
return (dx*dx+dy*dy).squareRoot()}}`,
  'enum and switch': `enum Direction{case north,south,east,west}
func describe(_ d:Direction)->String{switch d{
case .north:return "north"
case .south: return "south"
case .east:return "east"
case .west:return "west"}}`,
  'generics and where clauses': `func merge<T:Comparable,U>(_ a:[T],_ b:[T],transform:(T)->U)->[U] where U:Hashable{
return (a+b).sorted().map(transform)}`,
  'closures and trailing closures': `let points=[1,2,3].map{n in n*2}.filter{$0>2}.reduce(0){acc,n in acc+n}
DispatchQueue.main.async{print("done")}`,
  'async and await': `func load(from url:URL)async throws->Data{
let (data,response)=try await URLSession.shared.data(from:url)
guard let http=response as? HTTPURLResponse,http.statusCode==200 else{throw URLError(.badServerResponse)}
return data}`,
  'protocols and extensions': `protocol Drawable{func draw()}
extension Drawable where Self:Equatable{func drawTwice(){draw();draw()}}`,
  'property wrappers and attributes': `@propertyWrapper struct Clamped{
private var value:Int
var wrappedValue:Int{get{value}set{value=min(max(newValue,0),100)}}
init(wrappedValue:Int){self.value=wrappedValue}}`,
  'comments and doc comments': `// a leading comment
/// A doc comment.
/// - Parameter x: the value
func f(x:Int)->Int{/* inline */ return x}`,
  'string literals and interpolation': `let name="world"
let greeting="hello \\(name)"
let multiline="""
    indented
    lines
    """`,
  'long argument lists': `func configure(withFirstParameter first:String,secondParameter second:Int,thirdParameter third:Bool,fourthParameter fourth:Double)->String{return "\\(first)\\(second)\\(third)\\(fourth)"}`,
  'result builders': `@resultBuilder struct Builder{static func buildBlock(_ parts:String...)->String{parts.joined()}}`,
  'nested types and generics': `struct Container<Element>{
struct Index:Comparable{let offset:Int
static func<(lhs:Index,rhs:Index)->Bool{lhs.offset<rhs.offset}}
private var storage:[Element]=[]}`,
}

describe('native-conformance', () => {
  it.skipIf(!version)(`matches native swift-format (${version ?? 'not installed'}) byte for byte`, async () => {
    for (const [name, source] of Object.entries(SAMPLES)) {
      const wasm = await format(source)
      expect(`${name}: ${wasm}`).toBe(`${name}: ${native(source)}`)
    }
  })

  it.skipIf(!version)('matches native swift-format under a non-default configuration', async () => {
    const source = SAMPLES['struct and methods'] as string
    const configuration = { lineLength: 60, indentation: { spaces: 4 } }
    const wasm = await format(source, configuration)
    const nativeOut = execFileSync('swift-format', ['format', '--configuration', JSON.stringify(configuration), '-'], {
      input: source,
      encoding: 'utf8',
    })
    expect(wasm).toBe(nativeOut)
  })
})
