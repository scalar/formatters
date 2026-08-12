# TeaVM WasmGC: emitted module is not well-typed

Three lines of Java against the IntelliJ platform container produce a
WebAssembly module that no engine will load. `System::getProperty` — a method
this program does not touch, and which compiles correctly in a smaller program
built by the same compiler — fails validation at a branch join.

Fixed — see below. Three bugs in the WasmGC backend's recorded type stack, all
of them a place that took a type from a value rather than from a declaration.

```bash
./run.sh 0.14.1-kt          # the version this was found on
./run.sh 0.16.0-ktmaster    # master @ 0853784 — same failure
./run.sh 0.16.0-forkthree   # master + the three fixes — validates
```

```
[INFO] Output file successfully built
[INFO] Classes compiled: 1677
RESULT: module does not validate — reproduced
  CompileError: WebAssembly.compile(): Compiling function #216:"java.lang.System::getProperty"
  failed: type error in branch[0] (expected (ref null 799), got (ref null 714)) @+267249
```

The whole program is `src/repro/Repro.java`:

```java
Disposable disposable = () -> { };
return new CoreApplicationEnvironment(disposable).getClass().getName();
```

It is not meant to run — the class library does not cover everything the
IntelliJ platform reaches for. The claim is narrower and does not need it to
run: the bytes TeaVM emitted are not a well-typed module. `check.ts` therefore
calls `WebAssembly.compile`, not `instantiate`.

## What the type indices are

`decode-types.py` resolves them against the module's name section:

```
$ ./decode-types.py target-0.16.0-ktmaster/wasm/classes.wasm 820 710
  820: java.util.Properties
  710: java.util.Hashtable
```

Same pair on 0.14.1 (`799`/`714`). This is the most informative thing found so
far, because of the direction: **`Properties extends Hashtable`, so the expected
type is the subclass of the one that arrived.**

That rules out the obvious reading. A wrong least-upper-bound errs *wide* — it
would expect `Hashtable` and be handed `Properties`, which validates anyway. This
is the reverse: something declared the branch type from a narrower source than
the value actually flowing along it. Either the block should be declared at the
merged type, or a `ref.cast` is missing.

The site fits. `TSystem.getProperty(String)` is `initPropertiesIfNeeded();
return properties.getProperty(key);` over `private static Properties properties`,
assigned lazily inside `if (properties == null)`. At `ADVANCED` both the lazy
init and `Properties.getProperty` inline, so a branch and a field of subclass
type end up in one method.

## What was ruled out

- **Not the program.** `getProperty` is untouched by it.
- **Not the class library additions.** `../../toolchain/classlib-probe`, built by
  this same compiler, reports ALL PASS, and `@scalar/java-fmt` — 3,313 classes,
  more than this — builds and formats a 658-file corpus byte-identically on it.
- **Not the unreached-interface path.** That code path (see below) does not fire
  here: `run.sh` counts the reports and gets zero.
- **Not one bad method.** The function it fails on moves with the configuration:
  at `strict=false` it is `kotlin.coroutines.jvm.internal.BaseContinuation…`,
  with `(ref null 648)` against `(ref null 4)`.

- **Not a wrong least-upper-bound**, which is how it first read. The direction
  above rules it out, and the eventual causes were all narrower than that: three
  places recording a type from a value where wasm takes it from a declaration.

## Fixed

Three branches on `amritk/teavm`, applied together, produce a module that
`WebAssembly.compile` accepts:

```bash
./run.sh 0.16.0-forkthree
=== teavm 0.16.0-forkthree ===
[INFO] Output file successfully built
[INFO] Classes compiled: 1677
missing-member errors: 0
unreached-interface reports: 0
module: 2871430 bytes
RESULT: module validates — not reproduced
```

| branch | what it fixes |
|---|---|
| `claude/wasm-gc-conditional-types-edvuml` | `local.tee` records the *value's* type where wasm leaves the **local's declared** type |
| `claude/wasm-gc-coroutine-depth` | stale `depthBeforeLastInstructionOut`; per-function coroutine state not reset when a transform fails |
| `claude/wasm-gc-flattened-conditional-type` | a flattened conditional records the last arm's types where the wrapper block leaves the type it **declares** |

All three are needed. The first two alone (`0.16.0-forkboth`) clear the compiler
crash but still emit an ill-typed module.

### The fix is visible in nine bytes

`0.16.0-forkthree` and `0.16.0-forkboth` are both 2,871,430 bytes and differ in
nine of them. Only three carry meaning, all in the function that was failing:

```
@712383  func #1270 +889   block 350  ->  block 632      (block signature)
@712757  func #1270 +1263  ref.null 37 -> ref.null 5     (String -> Object)
```

`ref.null` of the recorded type is the placeholder the resume path pushes to
restore the stack shape, and it was typed `String` where an `Object` arrives —
the error verbatim. The remaining six bytes are `i32.const` class-id range
bounds inside three synthetic `@isSupertypes` helpers, each shifted by 2; those
are numbering churn, not types.

## How it was found

`amritk/teavm@claude/wasm-gc-conditional-types-edvuml` fixes the first instance
and the diagnosis is exact: `WasmTypeInference.visit(WasmTeeLocal)` recorded the
*value's* type, when `local.tee` leaves the **local's declared type** on the
stack. The coroutine transformation reads that stack to build the block
signature the resume path branches to, so a subclass type recorded for a
superclass value produces a label typed at the subclass — which is precisely the
direction seen here.

Built as `0.16.0-forkfix` with the class-library patches on top,
`System::getProperty` compiles and the failure **moves**:

```
#1267:"kotlin.collections.CollectionsKt___CollectionsKt::joinToString$default"
type error in branch[1] (expected (ref null 37), got (ref null 5))
      37: java.lang.String
       5: java.lang.Object
```

Same direction — expected is the subclass of what arrived — so at least one more
producer feeds a too-narrow type into the same block-signature machinery.

With the second branch (`claude/wasm-gc-coroutine-depth`) merged in as
`0.16.0-forkboth`, the build reaches **`Output file successfully built`** — the
`CoroutineTransformation` `IndexOutOfBoundsException` is gone. The same type
error survives, now at `#1270`, `@+712751`, which is `+1257` into a body
spanning `[711494, 713295)`. The byte there is `0c 01`, a `br 1`, matching
`branch[1]`, and it is preceded by `41 14 21 10` — `i32.const 20`,
`local.set 16`. Thirty-six bytes earlier the identical shape appears with
`i32.const 19`, and that one validates. A state number written to a fixed local
and then branched out of is the coroutine transformation saving a suspension
point, so this is the same machinery again, one state along.

That pair — a save that validates and the next one along that does not — is what
located the third bug. `processOptimizedConditional` dissolves a conditional
containing a suspension point into a wrapper block, walking one arm and then the
other, and left the recorded stack holding whatever the arm walked last pushed.
After a wasm block the stack holds what the block is *declared* to produce, so
the two differ whenever the arms push different subclasses of the result type.
A save before the conditional validates; the next one after it does not.

## Also on master

Master (`0853784`) does the same thing, with the same method and the same shape
of error, so it was never something a version bump would fix:

```
Compiling function #217:"java.lang.System::getProperty" failed:
type error in branch[0] (expected (ref null 820), got (ref null 710))
```

Master adds a second, separate failure of its own — one method fails to generate
at all:

```
Failed generating method body due to internal exception:
java.lang.IndexOutOfBoundsException: Index 0 out of bounds for length 0
  at CoroutineTransformation$ListSplitter.createSaveInstructions(CoroutineTransformation.java:413)
```

`CoroutineTransformation` exists in 0.14.1 but has no `processOptimizedConditional`,
and its `WasmTypeInference.visit(WasmTeeLocal)` pushes no type at all, so none of
the three fixes port back — they are master-only. That one is new. It is
reported and the build continues, which is why a module still comes out.

## What is *not* established

**Whether stock TeaVM does this.** It cannot be tested directly. Run
`./run.sh 0.14.1` and the build ends "Output file built with errors" with 18
missing members — mostly `java.util.concurrent` and `java.lang.management` —
and writes no module at all. Master alone is no better: 25 missing members. So
every build that gets far enough to show the bug carries
`../../patches/teavm-kotlin.patch`, which supplies exactly those classes.

That patch is class-library only apart from one diagnostic, and none of it is
near the backend's type computation — but "not near" is an argument, not a
measurement, and it should be read as one. What it does have going for it is
that the two class libraries differ (0.14.1's plus the patch, master's plus the
patch) and the failure is the same in both.

Watch for this when re-measuring: **a build that ends "built with errors" leaves
the previous `classes.wasm` in place.** Reusing a target directory across
versions makes a failed build look like a successful one from the run before it.
That is why `run.sh` gives every version its own directory, and it is how an
earlier reading of these results went wrong — a "reproduces on pristine 0.14.1"
result that was really a stale module from the patched build being re-read.

## Two of our patches are already fixed on master

Both should be dropped from anything sent upstream. They are still needed
against 0.14.1, which is what `packages/java` builds on.

- **`WasmGCVirtualTableBuilder.addImplementorToInterface`** dereferenced the
  table for every interface a reachable class declares, and a class can declare
  one the analysis never reached — `NullPointerException: Cannot read field
  "commonImplementorFilled" because "itf" is null`, with no indication of which
  interface. Master null-checks it.
- **`WasmGCResourcesIntrinsic`** left `teavm@resourcesBaseAddress` with an empty
  constant expression when no resource bytes were collected. Master seeds it in
  the early-return path of `writeModule`. Applying our hunk on top gives the
  global *two* initializers and an equally unloadable module —
  `expected 1 elements on the stack for constant expression, found 2` — which is
  worth knowing, because for one build that looked like a new master-only bug
  rather than a patch applied twice.

## Files

| | |
|---|---|
| `src/repro/Repro.java` | the program |
| `pom.xml` | `WEBASSEMBLY_GC`, `strict=true`, `stopOnErrors=false`, `minifying=false` |
| `run.sh` | builds against each named TeaVM version, one target directory each |
| `check.ts` | `WebAssembly.compile`, needs Node 24.15+ |

`run.sh` also builds `../stubs` into a jar and lists it first in the classpath.
Those are classpath replacements for classes that are not `java.*` and so cannot
come from the class library: IntelliJ's `Unsafe` and `ByteBufferUtil` (both
reach the JVM through `MethodHandle`), `PathManager` (looks for an IDE
installation on disk and throws out of a static initializer when it cannot find
one), and `javax.swing` / `javax.management` interfaces.
