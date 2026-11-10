# Upstream drafts

Every "fails" below was run, not assumed: each test was applied without its fix
to upstream `bbc601c` and run on JS, Wasm GC and C, optimized and not. Re-run it
on the current upstream before sending, and re-read the code each description
points at.

---

## 1. Issue: `ClassInitElimination` removes an interface's initializer after a call through the interface

**Title:** `ClassInitElimination` treats an interface call as initializing the interface

```java
interface WithInitializer {
    int[] STATE = { VMTest.initCount };

    void run();
}

@Test
public void interfaceCallDoesNotInitializeInterface() {
    initCount = 42;
    WithInitializer impl = initCount > 0 ? new FirstImpl() : new SecondImpl();
    impl.run();
    assertEquals(42, WithInitializer.STATE[0]);
}
```

(`FirstImpl` and `SecondImpl` implement `run()` without touching `initCount`;
two of them keep the call from being devirtualized.)

Passes on the JVM. On TeaVM the JS backend throws `NullPointerException` at
`STATE[0]`: the interface was never initialized.

`ClassInitElimination` adds `invoke.getMethod().getClassName()` to the
initialized set for every `InvokeInstruction`, so `impl.run()` marks
`WithInitializer` initialized and the `InitClassInstruction` before the read of
`STATE` is deleted. That holds for a static call, which is where
`ClassInitInsertion` puts the initializer, but an interface call initializes
nothing: constructing an implementing class does not initialize an interface
without default methods (JLS 12.4.1).

Possible fix, the same condition `ClassInitInsertion` uses:

```java
if (invoke.getInstance() == null) {
    step.initializedClasses.add(invoke.getMethod().getClassName());
}
```

Happy to send it as a PR with the test above in `VMTest`, or leave it to you.

Patch `0009` is this fix plus that test.

---

## 2. PR: `classlib: fix Collectors.joining dropping delimiter after empty element`

`Stream.of("", "b").collect(Collectors.joining(","))` returns `"b"`; the JDK
returns `",b"`.

`joining` decides whether to write the delimiter by checking whether the
`StringBuilder` is still empty, so an empty first element leaves it empty and the
next element is appended without a delimiter. The combiner has the same check.

The fix collects the elements and joins them with `String.join`. Test added to
`CollectorsTest`.

Fails on upstream `bbc601c`: `expected: <,b> but was: <b>`.

---

## 3. PR: `reflection: don't generate proxy workers for static interface methods`

`Proxy.newProxyInstance` fails for an interface that declares a field that is not
a compile-time constant, such as `Object CONSTANT = new Object();`.

`ProxyDependencySupport.generateWorkersForInterface` generates a worker for every
method the interface declares except bridges, static ones included. Such a field
gives the interface a `<clinit>`, and the generated proxy initializer looks each
worker's method up with `getDeclaredMethod`, which cannot return `<clinit>`.
Static methods are never dispatched through a proxy, so the fix skips them along
with bridges. Test added to `ProxyTest`, with an interface that has such a field
and a static method.

Fails on upstream `bbc601c`: `NoSuchMethodException` from `Class.getDeclaredMethod`, called by
the proxy class initializer (`Proxy.<clinit>`).

---

## 4. PR: `classlib: support \R in regex`

`Pattern.compile("\\R")` throws `PatternSyntaxException` from the lexer; on the JVM `\R` is the
linebreak matcher (`Pattern` javadoc, "Linebreak matcher"). The test fails on upstream `bbc601c` that way.

`\R` is expanded in `TLexer` into the alternation the `Pattern` javadoc defines
it as, `(?:\r\n|[\n\x0B\f\r\x85\u2028\u2029])`, as a non-capturing group so group
numbers are unchanged. Inside a character class it is left alone, and rejected as
on the JVM. Expanding it rather than adding a node is because it is the only
construct that can match two characters, and every set the engine builds assumes
a fixed width. Test added to `PatternTest`.

---

## 5. PR: `classlib: support \p{IsAlphabetic} in regex`

`Pattern.compile("\\p{IsAlphabetic}")` throws `PatternSyntaxException`: the binary property is not
in the class table. The test fails on upstream `bbc601c` that way.

Adds an `Alphabetic` entry to the class table in `TAbstractCharClass`, backed by
`Character.isAlphabetic`. The `Is` prefix is already stripped before the lookup.
Test added to `PatternTest`.

Separate issue to file at the same time: `\P{...}` negation does not work for any
class built as an anonymous `AbstractCharClass` that overrides `contains(int)`.
`\P{javaJavaIdentifierStart}` fails to match `"1"` on current upstream, and
`\P{IsAlphabetic}` would too. `\P{Alpha}`, built from a `CharClass`, is fine. The
test in this PR does not assert the negated form for that reason.

---

## 6. PR: `classlib: add StringBuilder.repeat(int, int)`

Java 21's `StringBuilder.repeat(int codePoint, int count)`: appends the code
point `count` times and throws `IllegalArgumentException` for a negative count.
Test added to `StringBuilderTest`, including a supplementary code point.

Not included: the `repeat(CharSequence, int)` overload. Add it if you prefer the
pair together.

---

## 7. PR: `classlib: add File.toPath`

`File.toPath()` returns `Paths.get(getPath())`, the JDK's own definition for the
default file system. Test added to `FileTest`.

---

## 8. PR: `classlib: add Spliterators.iterator and Spliterators.AbstractSpliterator`

`Spliterators.iterator(Spliterator)` and `Spliterators.AbstractSpliterator`.
`AbstractSpliterator.trySplit` returns `null`, which the contract allows; the JDK
splits into array batches, which TeaVM has no parallel streams to use. `SIZED`
implies `SUBSIZED`, as in the JDK. Tests added to `SpliteratorsTest`; none of them
asserts what `trySplit` returns, since that is implementation-specific.

---

## 9. PR: `classlib: key Charset.forName registry by uppercased name`

`Charset.forName` looks names up in `TCharset.Charsets.value` by
`charsetName.toUpperCase()`, while the registry is filled with
`value.put(charset.name(), charset)`. Every charset upstream registers today has
an uppercase canonical name, so the two agree and nothing fails yet. The first
charset with a lowercase canonical name (`windows-1251`, say) can never be found
by `forName`. One-line fix: key the registry by `name().toUpperCase()`.

There is no test that fails on upstream as it stands, because no registered
charset exercises it. If you would rather see it with a failing test, it can come
with the UTF-32 and windows-1251 charsets instead (patch `0010`), after asking in
an issue whether single-byte code pages belong in classlib at all.
