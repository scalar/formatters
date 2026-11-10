# TeaVM: upstream, a patch series, and a shims jar

Both TeaVM builds here (`../java_fmt_teavm/build.sh` for `@scalar/java-fmt`,
`../java_fmt_teavm/kotlin-probe/build.sh` for `@scalar/kotlin-fmt`) compile with
the TeaVM this directory produces. It replaces the `amritk/teavm` fork:

| | What | Where it goes when it is done |
|---|---|---|
| `UPSTREAM_REF` | the `konsoletyper/teavm` commit everything applies to | bumped on each rebase |
| `patches/` | edits to classes and compiler code upstream already has, one change per patch, in `git format-patch` form | upstream, one PR at a time; see `upstream/` |
| `shims/` | `java.*` classes upstream does not define, supplied through TeaVM's substitution extension point | stays here until upstream grows real versions |
| `apply.sh` | fetches `UPSTREAM_REF`, runs `git am patches/*.patch`, publishes TeaVM to `~/.m2` as `TEAVM_VERSION`, then installs `shims/` | |
| `HUNKS.md` | where every hunk of the fork's diff went, so nothing was lost in the move; `tools/` regenerates and re-checks it | |
| `upstream/` | drafts of the PRs and issues to send upstream; nothing there has been opened | |

```bash
./apply.sh
```

It skips everything when the pin, the patches and the shims are unchanged since
the last build, so both formatter builds simply call it. The checkout lives in
`toolchain/teavm`, which is gitignored.

## Rebasing onto a newer upstream

```bash
./apply.sh --apply-only
```

```bash
cd toolchain/teavm
```

That leaves `toolchain/teavm` at `UPSTREAM_REF` with every patch applied as a
commit. To move to a new upstream commit `<new>`:

```bash
git fetch https://github.com/konsoletyper/teavm.git master
```

```bash
git rebase <new>
```

Resolve conflicts patch by patch. A patch that upstream has merged, or made
redundant, comes out empty: drop it with `git rebase --skip`. Then check that
nothing in `shims/` is now defined upstream, run the tests the patches carry,
and write the series back:

```bash
./gradlew :tests:test --tests 'org.teavm.vm.*' --tests 'org.teavm.classlib.java.lang.*' -Pteavm.tests.js=true -Pteavm.tests.wasm-gc=true -Pteavm.tests.c=true -Pteavm.tests.optimized=true
```

```bash
./gradlew checkstyleMain
```

```bash
rm ../../patches/*.patch && git format-patch --no-signature --zero-commit -o ../../patches <new>..HEAD
```

```bash
git rev-parse <new> > ../../UPSTREAM_REF
```

Then `./apply.sh` from this directory, rebuild both formatters and run their
conformance suites (`bun run java:conformance`, `bun run kotlin:conformance`):
those corpora, not the TeaVM test suite, are what show the formatting is
unchanged. Commit the rebuilt artifacts with the new pin.

## The shims

`shims/` is a plain Maven project. `ShimSubstitutionPolicy` is an
`@Autoregistered` `SimpleSubstitutionPolicy` that maps `java.x.Y` to
`com.scalar.teavm.shims.java.x.TY`, the same shape as upstream's
`ClasslibSubstitutionPolicy`, which maps it to `org.teavm.classlib.java.x.TY`.
The jar sits on the consuming build's classpath and TeaVM finds the policy
through `ServiceLoader`.

**Only classes upstream does not define.** TeaVM tries the rules of every policy
in registration order and takes the first whose target class exists
(`DefaultSubstituteClassNameMapping.originalToSubstitute`), and the order between
two policies is classpath order. For a class only one side defines the order
cannot matter. For a class both define, whichever jar comes first wins, and
nothing says so. `NoShadowingTest` therefore fails the shims build if any shim
names a class that upstream's classlib also has. When it fires after a rebase,
delete that shim and anything only it used.

`ShimCompileTest` compiles a program that calls `ManagementFactory` through
TeaVM, runs it under Node, and checks both the result and that the class still
reports its `java.lang.management` name.

Shims build against the *patched* classlib, not stock upstream:
`TThreadInfo` uses `Thread.State`, which comes from a patch. A shim may reference
upstream's own `org.teavm.classlib` classes directly; it must import them, since
it no longer shares their package.

**What is in it** is the fork's fork-only class library: the single-threaded
`java.util.concurrent` executors, futures, queues and locks, `AtomicReferenceArray`,
`java.lang.management`, `PropertyChangeSupport`, `EventQueue`, `IOError`,
`URLClassLoader`, `BreakIterator` and `Normalizer`. Most of them throw or answer
for exactly one thread. That is right for these formatters and wrong for TeaVM
in general, which is why they stay out of upstream unless the maintainer asks for
real implementations.

The UTF-32 and windows-1251 charsets are *not* shims, even though their classes
are new. `Charset.forName` resolves through a registry inside `TCharset`, so a
charset has to be registered in a class upstream owns; they ride in a patch with
that registration.

## Can `ResourceTransformer` move patches into the shims?

Upstream added a `ResourceTransformer` SPI in `a807252`
(`extension/spi/.../transformation/ResourceTransformer.java`). It **can**
rewrite class-library bytecode from an external jar:

- `TeaVMTool` wraps its whole `ResourceProvider` in `SPITransformingResourceProvider`,
  which is what `.class` files are read through, the classlib's included;
- transformers are found by `ServiceLoader` on the build's class loader. Under
  the Maven plugin that is a `URLClassLoader` over the project classpath, with
  the plugin's own loader as parent, so a transformer in a dependency jar is
  found and can use the ASM that `teavm-core` already depends on;
- the Gradle plugin, the dev server and TeaVM's JUnit runner go through the same
  wrapping.

It cannot *add* a resource: `getResources` only transforms what the underlying
provider already has, so new classes still need substitution.

Not used, for three reasons. A transformer that splices methods into
`TStringBuilder` or `TThread` is an ASM patch with no line numbers, conflict
detection or review diff, so it is harder to rebase than the `.patch` it
replaces, and it fails at a consumer's build rather than at `git am`. Every patch
that would move is also a candidate upstream PR, which has to exist as a source
diff anyway. And the shims project would then depend on the exact bytecode shape
of upstream's classlib, which changes far more often than its source API.

It would be worth revisiting for a change that must never go upstream and touches
one method of a class upstream owns. Nothing in the series is like that today.

## Async

Upstream `3d8ed09` made async opt-in: if a program reaches any `@Async` method
(`Thread.sleep`, `Thread.yield`, `Object.wait`, ...) without the `asyncEnabled`
compiler option, TeaVM reports a compile error. The fork used to sidestep this by
making those three methods non-async, and dropped that in favour of upstream's
implementations.

Neither formatter sets `asyncEnabled`, on purpose. With it off TeaVM skips the
coroutine transformation altogether, and that transformation is what made the
Kotlin module trap on load (`../java_fmt_teavm/kotlin-probe/README.md`, "the wasm
start function can call a coroutine"). Turning it on would bring that back.

- **google-java-format reaches no `@Async` method.** It builds as it is.
- **ktfmt reached two**: `Thread.sleep` and `Thread.switchContext`, through three
  call sites in kotlinx-coroutines and IntelliJ that formatting never executes.
  `../java_fmt_teavm/kotlin-probe/plugin/kprobe/SingleThreadedCalls.java`, a
  `ClassHolderTransformer` named in `pom-ktfmt.xml`, deletes exactly those
  three calls, so the fix stays in that build instead of changing `Thread` for
  every TeaVM program.

Keep it that way. If a dependency bump makes a new `@Async` method reachable,
TeaVM writes no module and reports "is async, but async support is disabled"
with the call stack. The Java build stops there. The Kotlin build runs Maven
with `-q` and `stopOnErrors=false`, so it fails one step later, when `wasm-opt`
finds no `classes.wasm`. Rerun `mvn -f pom-ktfmt.xml package` without `-q` to
see the stack, and look at the call site before adding it to the transformer.
