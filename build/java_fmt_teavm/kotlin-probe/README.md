# Kotlin feasibility

Whether ktfmt can become a package the way google-java-format did. **It did** —
this directory now builds [`@scalar/kotlin-fmt`](../../../packages/kotlin), whose
output is byte-identical to ktfmt on a JVM over 589 real Kotlin files in three
styles. The reason it could not moved six times before that, so what follows is
measurements rather than opinions, kept runnable so they can be re-measured when
a version moves.

The name is historical: this was a feasibility probe and is now also the package
build (`./build.sh`). It sits under `java_fmt_teavm/` because it started on top
of the Java build; the only thing it still uses from there is
`../patches/ktfmt.patch`, so moving it is now just a rename.

```bash
./stubs.sh                    # stubs and the build-time TeaVM policies
./ktfmt.sh                    # ktfmt, patched, into the local Maven repo
./gate2.sh                    # gate 2: does the parser swap change ktfmt's output?
mvn -f pom-ktfmt.xml package  # ktfmt, to wasm
./conformance.sh              # gate 3: does compiling to wasm change it?

mvn -f pom.xml package        # the minimal parse, kept as the smaller probe
node teavm-bug/check.ts target-forkthree/wasm/classes.wasm   # does it validate?
node run.ts target-forkthree/wasm                            # does it run?
```

`./build.sh` does all of the above and writes the package artifact; the steps are
listed separately because each is a measurement worth being able to run on its
own. It clones [`amritk/teavm`](https://github.com/amritk/teavm) at a pinned
commit and builds it — no patching, because the fork's master *is* the patched
TeaVM, one commit per change. `../patches/README.md` maps them, and says which
are upstreamable and which are deliberate divergences.

Two flags are worth knowing when something goes wrong: `-Dteavm.minifying=false`
puts a name section in the module, without which a trap reports bare function
indices, and `-Dteavm.debugInformationGenerated=true` writes the `.teadbg` that
`run.ts` feeds to the deobfuscator so frames come back as Java method names.
Neither is on by default and diagnosing without them is slow.

## Where the blocker moved

**First read — wrong.** ktfmt cannot compile because the IntelliJ platform
resolves extension points reflectively from an XML descriptor. True of ktfmt as
shipped; not true of parsing.

**Second read — right, and Gate 2 proved it.** The extension machinery belongs to
`KotlinCoreEnvironment`, the compiler's CLI environment. `patches/ktfmt.patch`
swaps `Parser` onto the bare container the PSI actually needs, and `gate2.sh`
shows that changes no output: 589 files from kotlin-stdlib, kotlinx-coroutines
and ktfmt itself, three styles, **1767/1767 byte-identical**, diagnostics
included, with 542 of the files actually reformatted so the comparison means
something.

**Third read — fixed.** The class-library gap is closable, the size is fine, and
TeaVM's WasmGC backend emitted a module no engine would load. Three backend
bugs, now fixed on a fork.

**Fourth read — fixed.** The module validated but trapped at load, before any
export was reachable. One `Thread.yield()` in kotlinx-coroutines was making a
third of the program a coroutine. See Gate 1b.

**Fifth read — cleared.** The module loads, runs, and parses. Nine more gaps
closed on the way, one of them a fifth TeaVM bug.

**Sixth read — cleared, and it was a miscompile.** ktfmt itself compiled with no
missing members at all, then failed on its first import list because an
optimisation pass deleted a class initializer it should have kept. See Gate 3.

**Where it now sits.** Gate 3 is green: 1767/1767 byte-identical, and the package
is published from here by `./build.sh`.

## Gate 1 — the numbers

The frontier converged, and it never grew:

| Round | Distinct missing members |
|---|---|
| ktfmt as shipped | 94 |
| minimal parse, before any work | 40 |
| after the concurrency and stub round | 18 |
| after `MethodHandles`, `Thread.State`, `Locale.forLanguageTag` | 16 |
| after the polymorphic-signature descriptors | 2 |
| after stubbing `PathManager` | 0 |
| after the four interfaces the vtable builder needs | **0, module emitted** |

And it is small — this was the other way the idea could have died:

| | Classes | Methods | Raw | Brotli |
|---|---|---|---|---|
| Kotlin minimal parse | 3,553 | 20,513 | 3.33 MB | **0.79 MB** |
| before the Gate 1b fix | 2,846 | 20,513 | 3.66 MB | 0.87 MB |
| `@scalar/java-fmt`, for scale | 3,313 | 24,503 | 3.32 MB | 0.84 MB |

A third of that module was the coroutine transformation, which is why the Gate 1b
fix took 37% off it.

Fewer classes than the Java formatter, and 45× under the 10 MB brotli threshold
this gate was supposed to kill it at. The 130 MB figure from JetBrains'
native-image `kotlinc` does not apply: that builds the whole compiler, this
builds a parser.

## Gate 1 — cleared

`WebAssembly.compile` used to reject the module. It no longer does:

```bash
mvn -f pom.xml package -Dteavm.version=0.16.0-forkthree \
    -DbuildDirectory=$PWD/target-forkthree
node teavm-bug/check.ts target-forkthree/wasm/classes.wasm
RESULT: module validates — not reproduced
```

That was three bugs in TeaVM's WasmGC backend, all the same shape — a place
recording a type from a value where wasm takes it from a declaration, surfacing
only through the coroutine transformation, which is the one consumer that turns
a recorded stack into a block signature. `teavm-bug/` is the reproducer that
found them and the evidence for each.

**They are master-only.** 0.14.1 has no `processOptimizedConditional`, and its
`WasmTypeInference.visit(WasmTeeLocal)` pushes no type at all, so the fixes do
not port back. That forced a master-based TeaVM here while `@scalar/java-fmt`
was still on 0.14.1 — two toolchains for a while. Java has since moved to the
same fork and re-cleared `../conformance.sh` at 658/658, so there is one. They
are commits on the fork rather than patch files; see `../patches/README.md`.

## Gate 1b — cleared

Loading the module used to throw before `parse()` was ever called:

```
RuntimeError: dereferencing a null pointer
  at wasm-function[47] <- wasm-function[183] <- wasm-function[14760]
```

Rebuilt with `minifying=false` and `debugInformationGenerated=true`, those
indices are:

```
at org.teavm.runtime.Fiber::isResuming
at org.teavm.jso.impl.wasmgc.WasmGCJSRuntime::stringToJs
at teavm@initializer
```

`teavm@initializer` is the wasm *start* function — it runs at instantiation, and
part of what it does is convert the `@JSExport` names to JS strings. It was
calling a `stringToJs` that TeaVM had coroutine-transformed, and the prologue the
transformation emits is `Fiber.current()` then `isResuming()` on the result.
`Fiber.current` is null until a fiber starts, so the start function trapped on
its own first call.

So the question was why `stringToJs`, of all methods, was a coroutine. TeaVM's
`AsyncMethodFinder` marks every `@Async` method async and then propagates to
callers transitively. Dumping the propagation gave a 139-hop chain and one root:

```
asyncMethods=7060
root 7055 java.lang.Thread.switchContext
root    3 java.lang.Object.monitorEnterWait
root    2 java.lang.Thread.sleep
```

7,055 of 20,513 methods, from a single `Thread.yield()` inside
`kotlinx.coroutines.scheduling.WorkQueue.addLast` — code this program never runs.
The chain gets from there to `stringToJs` through
`String.charAt` → `StringIndexOutOfBoundsException.<init>` →
`Throwable.fillInStackTrace` → `Class.getName` → `StringBuilder.append(Object)` →
every `toString()` in the program. Exception construction and virtual `toString`
are edges the points-to analysis has to keep, and they make the call graph dense
enough that *any* reachable `@Async` method reaches most of it.

That last point is the one worth keeping. Making `yield` a no-op moved the whole
7,055 to `Thread.sleep` — same count, next root. Cutting roots one at a time does
nothing; the fix has to leave no reachable `@Async` method at all.

`../patches/teavm-kotlin-runtime.patch` does that, and the reasoning is the same
one the concurrency stand-ins already use — with one thread, `yield` has nothing
to yield to, `sleep` has nothing to wait for, and `Object.wait` can never be
notified, so it throws. The async set goes to 3, all of them the uncontended
monitor path, which `AsyncMethodFinder` already declines to propagate:

```
asyncMethods=3
root 3 java.lang.Object.monitorEnterWait
```

Nothing is coroutine-transformed, the start function stops trapping, and the
module gets 37% smaller.

### There is a TeaVM bug underneath this, still unfixed

Cutting the roots is right for this program, but it is a workaround for
something real: **the wasm start function can call a coroutine-transformed
function, whose prologue dereferences a fiber that does not exist yet.** Any
TeaVM WasmGC program that legitimately needs threads and exports anything via
`@JSExport` will trap at load the same way. The same hazard applies to the
exports themselves — a `@JSExport` method that lands in the async closure is
called from JS with no fiber either.

This is a fourth backend bug on top of the three in `../patches/README.md`, and
unlike those it has no fix here, only an avoidance. It has not been reported
upstream.

## Also found: a crash that should be a diagnostic

`WasmGCVirtualTableBuilder.addImplementorToInterface` dereferences the table for
every interface a reachable class declares, and a class can declare one the
analysis never reached. The result was
`NullPointerException: Cannot read field "commonImplementorFilled" because "itf" is null`
with no indication of which interface. The Kotlin class-library commit on the
fork turned that into a named report.

**Already fixed upstream** — TeaVM master has a null check there now, so this
hunk should be dropped rather than sent. The four interfaces this program needed
(`RunnableScheduledFuture`, `ScheduledExecutorService`,
`javax.management.NotificationListener`, `javax.swing.Icon`) are supplied
properly anyway, which is the better answer either way: master's fix skips the
interface silently, and a table with a missing implementor is exactly the kind of
thing that shows up later as a module that will not validate.

## Gate 3 — cleared: ktfmt in wasm matches ktfmt on a JVM

```bash
./stubs.sh && ./ktfmt.sh
mvn -f pom-ktfmt.xml package
./conformance.sh
```

```
corpus: 589 Kotlin files

meta:       589/589 byte-identical
google:     589/589 byte-identical
kotlinlang: 589/589 byte-identical
```

**1767/1767.** Same corpus and the same three styles as `gate2.sh`, which asked
the other half of the question - whether the parser swap changes ktfmt's output
on a JVM - and also answered no. Both sides encode the result the same way, `O`
and the formatted source or `E` and the exception, so a difference in how a
failure is reported would count as a difference. Every file formatted; none
errored on either side.

That is the measurement an **exact** row in the root README would rest on, and
this is the first version of this probe where the number exists at all.

| | Classes | Raw | Brotli |
|---|---|---|---|
| ktfmt | 4,039 | 3.82 MB | **0.91 MB** |
| the minimal parse, for scale | 3,554 | 3.33 MB | 0.79 MB |
| `@scalar/java-fmt` | 3,313 | 3.32 MB | 0.84 MB |

### A sixth TeaVM bug, and it was a miscompile

Getting here needed one more fix, and it is the most serious of the six because
nothing about it is a missing feature - it is an optimisation that deletes
something it should not.

`ClassInitElimination` walks the dominator tree deleting `InitClassInstruction`s
that a dominating one already covers, and treats **any** invocation as
initializing the class it names:

```java
if (insn instanceof InvokeInstruction) {
    InvokeInstruction invoke = (InvokeInstruction) insn;
    step.initializedClasses.add(invoke.getMethod().getClassName());
}
```

Only a static call does that. `ClassInitializerInsertionTransformer` puts the
initializer call at the top of static methods and constructors, not instance
methods, and an interface call initializes the receiver's class rather than the
interface. `ClassInitInsertion`, which puts these instructions in, guards on
`getInstance() == null`; the elimination pass did not.

What it cost: `SharedImplUtil.getChildrenOfType` iterates the tree through
`ASTNode` instance calls and then returns `ASTNode.EMPTY_ARRAY` when the count is
zero. The instance calls marked `ASTNode` initialized, the initializer before the
field read was deleted, and the constant was read as null - so a `@NotNull`
method returned null and ktfmt failed on its first import list.

It is worth being precise about how visible this was. The symptom was
`@NotNull method SharedImplUtil.getChildrenOfType must not return null`, five
frames from anything to do with class initialization, and reading
`ASTNode.EMPTY_ARRAY` from an exported method made the *next* call succeed -
which is what turned it from a guess into a diagnosis:

```
format first:  @NotNull method ... getChildrenOfType must not return null
probe first:   "fun main() {\n  println(\"hi\")\n}\n"
```

A minimal reproducer does not reproduce it: the small case gets an eagerly
initialized class and never needs the instruction that was deleted. It needs a
class whose initializer TeaVM classifies as dynamic, an instance call on that
class, and a read of its static field afterwards, all in one method after
inlining. That is why the fix is checked against the corpus rather than a unit
test - and why it is the one of the six that most deserves upstream attention.

## Gate 1c — cleared: it parses

`node run.ts target-forkthree/wasm` now returns
`org.jetbrains.kotlin.psi.KtFile:31`. Getting there was nine failures, each one
step further into `CoreApplicationEnvironment` and then into the PSI, and every
one of them a different kind of thing:

| Failed at | Was | Fixed by |
|---|---|---|
| `SystemInfoRt.<clinit>` | `toLowerCase` on an undefined `os.version` | `os.version`, `os.arch` defined |
| `ReflectionUtil.<clinit>` | `Class.forName("sun.misc.Unsafe")`, `theUnsafe` read reflectively | `stubs/sun/misc/Unsafe.java` + policy |
| `Proxy.newProxyInstance` | listener interfaces not registered proxyable | `proxyable()` in the policy |
| `Proxy.<clinit>` | `NoSuchMethodException` on the interface's `<clinit>` | a TeaVM fix — see below |
| `ConcurrentLongObjectHashMap.<clinit>` | `objectFieldOffset` on its own fields | the container replaced |
| `KotlinElementTypeProvider` | impl looked up by name, `INSTANCE` read reflectively | policy |
| `KtStubElementType.<init>` | PSI classes' `(ASTNode)` constructors not reflectable | policy |
| `MessageBusImpl.syncPublisher` | topic listener interfaces not proxyable | policy |
| `CharsetToolkit.<clinit>` | `forName` on UTF-32BE, UTF-32LE, windows-1251 | three charsets implemented |
| `LanguageSubstitutors` | DI container found no constructor | policy |
| `Registry` | `misc/registry.properties` not in the module | a resources policy |

Four of those are the same underlying thing: **TeaVM resolves reflection
statically**, so `Class.forName`, `getDeclaredField`, `getConstructor` and
`Proxy` all need telling at build time. That is what `plugin/` is — a build-time
extension, never compiled to wasm. Each rule is scoped by the mechanism that
needs it rather than by a list of what is reached today:

- `KeyedExtensionCollector` subclasses, because those are what the DI container
  constructs;
- interfaces extending `EventListener` **or** named `*Listener`, because
  `EventDispatcher` goes by the first and `MessageBus`'s listener is a `Topic`
  type parameter that no build-time rule can see, and IntelliJ names them all
  the second way;
- `KtElement` subclasses, because that is the bound both element-type
  declarations use.

Scoping matters more than it sounds: a reflectable member is a dependency root,
so the first attempt at the DI rule — the whole `com.intellij` package — made
every class in it reachable, dragged in the XML stream readers and
kotlinx-serialization, and failed to compile at all.

### A fifth TeaVM bug, and this one is fixed

`ProxyDependencySupport.generateWorkersForInterface` walks `itf.getMethods()`
skipping only bridges, so an interface that declares a constant — and therefore
has a `<clinit>` — gets a proxy worker generated for it. The generated proxy's
initializer then calls `getDeclaredMethod("<clinit>", ...)`, which can only
throw: `<clinit>` is not a declared method. Any interface with a constant field
is unproxyable, which in IntelliJ is most listener interfaces, since they carry a
`Topic`. Skipping static methods fixes it, and matches what `Proxy` dispatches
anyway. `upstream/proxy-and-reflection` on the fork.

Finding it needed two more changes, kept in the same patch: `getDeclaredMethod`
and `getDeclaredField` threw unnamed exceptions, which out of a generated
initializer say nothing at all. They name the member now, and that is what turned
each of the reflection failures above from a bare stack trace into a one-line
diagnosis.

### The Unsafe containers were on the parse path

`stubs/…/containers/Unsafe.java` throws on every operation, deliberately, and
said the open question was whether the parse path reaches the containers built on
it. It does — `CoreProgressManager` makes a `ConcurrentLongObjectHashMap`, which
takes `objectFieldOffset` of four of its own fields in its static initializer and
does its updates by CAS on those offsets.

That has no managed-heap equivalent, so the container is replaced rather than the
member added: a `HashMap` behind the same five-method interface, on the same
reasoning as the `java.util.concurrent` stand-ins. It was the only one the parse
path needed, which is the answer to how wide this went — narrower than it looked.

### Two things that are not reflection

**Three charsets.** `CharsetToolkit`'s initializer asks `Charset.forName` for
UTF-32BE, UTF-32LE and windows-1251, and TeaVM had none of them.
`upstream/charsets` on the fork implements them properly rather than
registering empty objects, since a charset that exists but decodes wrongly is the
worse failure. It also fixes the lookup: `forName` uppercases the name it is
given but the registry was keyed by canonical name, which agreed by accident
until `windows-1251` — the first charset whose canonical name is not uppercase.

**One resource.** `Registry` reads `misc/registry.properties` off the classpath
and throws `MissingResourceException` for a key it cannot find, with no default,
and `PsiManager` asks for `psi.sleep.in.validity.check` on first PSI access.
Resources are not on a classpath at run time, so a `ResourcesPolicy` names it and
TeaVM embeds it. Worth recording why it is a resource policy and not the
`META-INF/services/java.util.ResourceBundle` route the Java build uses for
javac's messages: `Registry` reads the file as a stream rather than as a bundle,
and TeaVM's `.properties`-to-bundle path rebuilds the bundle one entry at a time
through the metaprogramming API, which for 1,882 keys does not finish.

## What is left, in order

1. **Decide whether it is worth carrying.** A patched ktfmt and a patched TeaVM
   for a second language. A judgement call rather than a measurement, and Gate
   3's number is now in hand to make it with. Of the six TeaVM fixes, three are
   ordinary upstreamable bugs, one is a miscompile anyone using WasmGC could hit,
   and only the single-threaded stand-ins are deliberate divergences that would
   have to be carried indefinitely.

### One loose end

Four `UnsupportedOperationException: LockSupport.park would block the only
thread` are printed to stderr while the module starts. Four for the whole
589-file run, not four per file, and the output is byte-identical either way — so
it is start-up noise from a stand-in rather than a failure. A published package
would want it silenced; the probe leaves it visible.

## What the patches contain

- `../patches/ktfmt.patch` — the parser swap. Proven neutral by `gate2.sh`.
- **The TeaVM changes** are commits on the fork rather than files here — ten
  upstreamable ones with a branch each, three deliberate divergences on `master`
  only. `../patches/README.md` maps them.

`MethodHandle.invoke` and `invokeExact` are worth calling out. They are
polymorphic-signature methods: the caller writes whatever descriptor it likes.
The descriptors this program emits are spelled out one by one in
`TMethodHandle`, which worked here but is whack-a-mole — two of them differ only
in return type, which Java cannot express, and that is what forced the
`PathManager` stub. A general fix means teaching the compiler to treat those two
names specially.
