# Where every hunk of the fork went

Generated from `git diff upstream/master origin/master` with `upstream/master` at `bbc601c` and
`amritk/teavm` `master` at `152a9c3`: 78 files, +3,428/−27, 95 hunks. Of those, 48 went to a patch,
41 to the shims and 6 were dropped. No hunk is unassigned: the generator refuses to write
the table otherwise.

The **evidence** column is checked, not asserted. For each non-comment line a hunk adds, the
checker looks for the same line in the patched upstream tree or, for a shim, in the shim source
after the package rename (`org.teavm.classlib.java.` → `com.scalar.teavm.shims.java.`). A line
found in neither is listed. Every such line is a deliberate change: the dropped hunks, the
`Collectors.joining` fix rewritten as four lines, and the proxy check folded into the existing
`BRIDGE` condition. Comment lines (license headers included) are not compared: the patches trim the fork's
explanatory comments, as the upstream review asked, while the shims keep theirs.

"PR C*n*" is item *n* of section C of the migration brief: a small upstream PR, drafted in
`upstream/`, not opened.

To regenerate, with a fork clone that has `upstream` as a remote and `toolchain/teavm` from
`./apply.sh --apply-only`:

```bash
python3 -I tools/hunk_coverage.py <fork-clone> toolchain/teavm shims/src/main/java > /tmp/coverage.jsonl
```

```bash
python3 -I tools/hunks_md.py /tmp/coverage.jsonl HUNKS.md
```

| # | File | Line | Size | Destination | Upstream | Evidence |
|---|---|---|---|---|---|---|
| 1 | `classlib/…/java/awt/TEventQueue.java` | 1 | +30 −0 | shim | — | 11/11 code lines in shims; 16 comment lines not compared |
| 2 | `classlib/…/java/beans/TPropertyChangeSupport.java` | 1 | +33 −0 | shim | — | 12/12 code lines in shims; 16 comment lines not compared |
| 3 | `classlib/…/java/io/TFile.java` | 24 | +2 −0 | patch 0006 | PR C6 | 2/2 code lines in patches |
| 4 | `classlib/…/java/io/TFile.java` | 117 | +4 −0 | patch 0006 | PR C6 | 3/3 code lines in patches |
| 5 | `classlib/…/java/io/TIOError.java` | 1 | +27 −0 | shim | — | 9/9 code lines in shims; 15 comment lines not compared |
| 6 | `classlib/…/java/lang/TCharacter.java` | 21 | +46 −0 | patch 0012 | later, one PR per class | 33/33 code lines in patches; 6 comment lines not compared |
| 7 | `classlib/…/java/lang/TClass.java` | 253 | +1 −1 | patch 0013 | later, one PR per class | 1/1 code lines in patches |
| 8 | `classlib/…/java/lang/TClass.java` | 414 | +5 −1 | patch 0013 | later, one PR per class | 1/1 code lines in patches; 4 comment lines not compared |
| 9 | `classlib/…/java/lang/TClass.java` | 717 | +10 −0 | patch 0013 | later, one PR per class | 3/3 code lines in patches; 6 comment lines not compared |
| 10 | `classlib/…/java/lang/TClassLoader.java` | 61 | +18 −0 | patch 0013 | later, one PR per class | 9/9 code lines in patches; 6 comment lines not compared |
| 11 | `classlib/…/java/lang/TStringBuilder.java` | 216 | +10 −0 | patch 0005 | PR C5 | 9/9 code lines in patches |
| 12 | `classlib/…/java/lang/TSystem.java` | 187 | +12 −0 | patch 0011 | later: ask per-backend values | 4/4 code lines in patches; 8 comment lines not compared |
| 13 | `classlib/…/java/lang/TThread.java` | 23 | +18 −0 | patch 0014 | later: getState must report real states | 11/11 code lines in patches; 5 comment lines not compared |
| 14 | `classlib/…/java/lang/TThread.java` | 276 | +4 −0 | patch 0014 | later: getState must report real states | 2/2 code lines in patches; 1 comment lines not compared |
| 15 | `classlib/…/java/lang/invoke/TMethodHandle.java` | 15 | +54 −0 | patch 0015 | issue: polymorphic signatures need compiler support | 37/37 code lines in patches; 5 comment lines not compared |
| 16 | `classlib/…/java/lang/invoke/TMethodHandles.java` | 15 | +61 −1 | patch 0015 | issue: polymorphic signatures need compiler support | 42/42 code lines in patches; 6 comment lines not compared |
| 17 | `classlib/…/java/lang/invoke/TMethodType.java` | 18 | +15 −0 | patch 0015 | issue: polymorphic signatures need compiler support | 11/11 code lines in patches |
| 18 | `classlib/…/java/lang/management/TGarbageCollectorMXBean.java` | 1 | +24 −0 | shim | — | 6/6 code lines in shims; 15 comment lines not compared |
| 19 | `classlib/…/java/lang/management/TManagementFactory.java` | 1 | +49 −0 | shim | — | 22/22 code lines in shims; 19 comment lines not compared |
| 20 | `classlib/…/java/lang/management/TMemoryMXBean.java` | 1 | +20 −0 | shim | — | 4/4 code lines in shims; 15 comment lines not compared |
| 21 | `classlib/…/java/lang/management/TMemoryPoolMXBean.java` | 1 | +32 −0 | shim | — | 10/10 code lines in shims; 15 comment lines not compared |
| 22 | `classlib/…/java/lang/management/TMemoryType.java` | 1 | +21 −0 | shim | — | 5/5 code lines in shims; 15 comment lines not compared |
| 23 | `classlib/…/java/lang/management/TMemoryUsage.java` | 1 | +34 −0 | shim | — | 15/15 code lines in shims; 15 comment lines not compared |
| 24 | `classlib/…/java/lang/management/TRuntimeMXBean.java` | 1 | +97 −0 | shim | — | 57/57 code lines in shims; 21 comment lines not compared |
| 25 | `classlib/…/java/lang/management/TThreadInfo.java` | 1 | +54 −0 | shim | — | 30/30 code lines in shims; 15 comment lines not compared |
| 26 | `classlib/…/java/lang/management/TThreadMXBean.java` | 1 | +26 −0 | shim | — | 7/7 code lines in shims; 15 comment lines not compared |
| 27 | `classlib/…/java/net/TURLClassLoader.java` | 1 | +65 −0 | shim | — | 35/35 code lines in shims; 20 comment lines not compared |
| 28 | `classlib/…/java/nio/charset/TCharset.java` | 144 | +6 −2 | patch 0008 + 0010 | PR C8 / later: ask about code pages in an issue | 3/3 code lines in patches; 3 comment lines not compared |
| 29 | `classlib/…/java/nio/charset/TStandardCharsets.java` | 17 | +2 −0 | patch 0010 | later: ask about code pages in an issue | 2/2 code lines in patches |
| 30 | `classlib/…/java/nio/charset/TStandardCharsets.java` | 32 | +23 −0 | patch 0010 | later: ask about code pages in an issue | 19/19 code lines in patches; 3 comment lines not compared |
| 31 | `classlib/…/java/nio/charset/impl/TSingleByteCharset.java` | 1 | +60 −0 | patch 0010 | later: ask about code pages in an issue | 33/33 code lines in patches; 20 comment lines not compared |
| 32 | `classlib/…/java/nio/charset/impl/TSingleByteDecoder.java` | 1 | +51 −0 | patch 0010 | later: ask about code pages in an issue | 27/27 code lines in patches; 18 comment lines not compared |
| 33 | `classlib/…/java/nio/charset/impl/TSingleByteEncoder.java` | 1 | +74 −0 | patch 0010 | later: ask about code pages in an issue | 54/54 code lines in patches; 15 comment lines not compared |
| 34 | `classlib/…/java/nio/charset/impl/TUTF32Charset.java` | 1 | +44 −0 | patch 0010 | later: ask about code pages in an issue | 23/23 code lines in patches; 15 comment lines not compared |
| 35 | `classlib/…/java/nio/charset/impl/TUTF32Decoder.java` | 1 | +73 −0 | patch 0010 | later: ask about code pages in an issue | 51/51 code lines in patches; 17 comment lines not compared |
| 36 | `classlib/…/java/nio/charset/impl/TUTF32Encoder.java` | 1 | +81 −0 | patch 0010 | later: ask about code pages in an issue | 62/62 code lines in patches; 15 comment lines not compared |
| 37 | `classlib/…/java/nio/file/spi/TFileSystemProvider.java` | 23 | +1 −0 | patch 0019 | later, one PR per class | 1/1 code lines in patches |
| 38 | `classlib/…/java/nio/file/spi/TFileSystemProvider.java` | 43 | +9 −0 | patch 0019 | later, one PR per class | 4/4 code lines in patches; 4 comment lines not compared |
| 39 | `classlib/…/java/text/TBreakIterator.java` | 1 | +113 −0 | shim | — | 67/67 code lines in shims; 21 comment lines not compared |
| 40 | `classlib/…/java/text/TNormalizer.java` | 1 | +42 −0 | shim | — | 17/17 code lines in shims; 21 comment lines not compared |
| 41 | `classlib/…/java/util/TLocale.java` | 144 | +25 −0 | patch 0016 | later, one PR per class | 20/20 code lines in patches; 4 comment lines not compared |
| 42 | `classlib/…/java/util/TResourceBundle.java` | 62 | +39 −0 | patch 0017 | later, one PR per class | 26/26 code lines in patches; 5 comment lines not compared |
| 43 | `classlib/…/java/util/TResourceBundle.java` | 110 | +6 −0 | patch 0017 | later, one PR per class | 4/4 code lines in patches; 1 comment lines not compared |
| 44 | `classlib/…/java/util/TSpliterators.java` | 17 | +1 −0 | patch 0007 | PR C7 | 1/1 code lines in patches |
| 45 | `classlib/…/java/util/TSpliterators.java` | 335 | +58 −0 | patch 0007 | PR C7 | 45/45 code lines in patches; 5 comment lines not compared |
| 46 | `classlib/…/java/util/concurrent/TAbstractExecutorService.java` | 1 | +81 −0 | shim | — | 57/57 code lines in shims; 16 comment lines not compared |
| 47 | `classlib/…/java/util/concurrent/TCompletableFuture.java` | 1 | +156 −0 | shim | — | 114/114 code lines in shims; 19 comment lines not compared |
| 48 | `classlib/…/java/util/concurrent/TConcurrentHashMap.java` | 636 | +71 −0 | patch 0018 | later, one PR per class | 53/53 code lines in patches; 5 comment lines not compared |
| 49 | `classlib/…/java/util/concurrent/TConcurrentLinkedQueue.java` | 1 | +59 −0 | shim | — | 34/34 code lines in shims; 16 comment lines not compared |
| 50 | `classlib/…/java/util/concurrent/TDelayQueue.java` | 1 | +27 −0 | shim | — | 8/8 code lines in shims; 17 comment lines not compared |
| 51 | `classlib/…/java/util/concurrent/TDelayed.java` | 1 | +22 −0 | shim | — | 5/5 code lines in shims; 15 comment lines not compared |
| 52 | `classlib/…/java/util/concurrent/TExecutorService.java` | 1 | +52 −0 | shim | — | 24/24 code lines in shims; 15 comment lines not compared |
| 53 | `classlib/…/java/util/concurrent/TExecutors.java` | 1 | +118 −0 | shim | — | 80/80 code lines in shims; 16 comment lines not compared |
| 54 | `classlib/…/java/util/concurrent/TFuture.java` | 1 | +31 −0 | shim | — | 10/10 code lines in shims; 15 comment lines not compared |
| 55 | `classlib/…/java/util/concurrent/TFutureTask.java` | 1 | +110 −0 | shim | — | 77/77 code lines in shims; 20 comment lines not compared |
| 56 | `classlib/…/java/util/concurrent/TLinkedBlockingQueue.java` | 1 | +111 −0 | shim | — | 73/73 code lines in shims; 21 comment lines not compared |
| 57 | `classlib/…/java/util/concurrent/TRejectedExecutionException.java` | 1 | +35 −0 | shim | — | 15/15 code lines in shims; 15 comment lines not compared |
| 58 | `classlib/…/java/util/concurrent/TRunnableFuture.java` | 1 | +23 −0 | shim | — | 6/6 code lines in shims; 15 comment lines not compared |
| 59 | `classlib/…/java/util/concurrent/TRunnableScheduledFuture.java` | 1 | +23 −0 | shim | — | 6/6 code lines in shims; 15 comment lines not compared |
| 60 | `classlib/…/java/util/concurrent/TScheduledExecutorService.java` | 1 | +31 −0 | shim | — | 11/11 code lines in shims; 15 comment lines not compared |
| 61 | `classlib/…/java/util/concurrent/TScheduledFuture.java` | 1 | +22 −0 | shim | — | 5/5 code lines in shims; 15 comment lines not compared |
| 62 | `classlib/…/java/util/concurrent/TSynchronousQueue.java` | 1 | +111 −0 | shim | — | 73/73 code lines in shims; 21 comment lines not compared |
| 63 | `classlib/…/java/util/concurrent/TThreadFactory.java` | 1 | +20 −0 | shim | — | 4/4 code lines in shims; 15 comment lines not compared |
| 64 | `classlib/…/java/util/concurrent/TThreadPoolExecutor.java` | 1 | +92 −0 | shim | — | 59/59 code lines in shims; 16 comment lines not compared |
| 65 | `classlib/…/java/util/concurrent/atomic/TAtomicReferenceArray.java` | 1 | +100 −0 | shim | — | 68/68 code lines in shims; 15 comment lines not compared |
| 66 | `classlib/…/java/util/concurrent/locks/TCondition.java` | 1 | +34 −0 | shim | — | 11/11 code lines in shims; 15 comment lines not compared |
| 67 | `classlib/…/java/util/concurrent/locks/TLock.java` | 1 | +32 −0 | shim | — | 10/10 code lines in shims; 15 comment lines not compared |
| 68 | `classlib/…/java/util/concurrent/locks/TLockSupport.java` | 1 | +59 −0 | shim | — | 30/30 code lines in shims; 19 comment lines not compared |
| 69 | `classlib/…/java/util/concurrent/locks/TReadWriteLock.java` | 1 | +22 −0 | shim | — | 5/5 code lines in shims; 15 comment lines not compared |
| 70 | `classlib/…/java/util/concurrent/locks/TReentrantLock.java` | 1 | +91 −0 | shim | — | 55/55 code lines in shims; 20 comment lines not compared |
| 71 | `classlib/…/java/util/concurrent/locks/TReentrantReadWriteLock.java` | 1 | +64 −0 | shim | — | 36/36 code lines in shims; 16 comment lines not compared |
| 72 | `classlib/…/java/util/concurrent/locks/TSingleThreadedCondition.java` | 1 | +58 −0 | shim | — | 30/30 code lines in shims; 20 comment lines not compared |
| 73 | `classlib/…/java/util/regex/TAbstractCharClass.java` | 607 | +15 −0 | patch 0004 | PR C4 | 13/13 code lines in patches |
| 74 | `classlib/…/java/util/regex/TAbstractCharClass.java` | 736 | +4 −0 | patch 0004 | PR C4 | 1/1 code lines in patches; 3 comment lines not compared |
| 75 | `classlib/…/java/util/regex/TLexer.java` | 216 | +4 −0 | patch 0003 | PR C3 | 1/1 code lines in patches; 2 comment lines not compared |
| 76 | `classlib/…/java/util/regex/TLexer.java` | 227 | +1 −0 | patch 0003 | PR C3 | 1/1 code lines in patches |
| 77 | `classlib/…/java/util/regex/TLexer.java` | 241 | +48 −0 | patch 0003 | PR C3 | 35/35 code lines in patches; 11 comment lines not compared |
| 78 | `classlib/…/java/util/stream/TCollectors.java` | 78 | +36 −10 | patch 0001 (rewritten) | PR C1 | 6/25 code lines in patches; 6 comment lines not compared; not carried: `BiConsumer<Joiner, CharSequence> accumulator = Joiner::add;`, `BinaryOperator<Joiner> combiner = Joiner::merge;` … |
| 79 | `core/…/backend/wasm/generate/classes/WasmGCClassGenerator.java` | 1429 | +1 −1 | dropped | not planned | not carried; for example `staticInitialValue(initBuilder, initValue, type);` |
| 80 | `core/…/backend/wasm/generate/classes/WasmGCClassGenerator.java` | 1439 | +1 −1 | dropped | not planned | not carried; for example `private void staticInitialValue(WasmInstructionBuilder builder, Object value, WasmType type) {` |
| 81 | `core/…/backend/wasm/generate/classes/WasmGCClassGenerator.java` | 1457 | +4 −1 | dropped | not planned | not carried; 3 comment lines not compared; for example `defaultValueOfType(builder, type);` |
| 82 | `core/…/backend/wasm/model/instruction/WasmTypeInference.java` | 32 | +5 −0 | dropped (comment only) | not planned | not carried; 5 comment lines not compared |
| 83 | `core/…/backend/wasm/model/instruction/WasmTypeInference.java` | 90 | +2 −0 | patch 0020 | not planned: rejected in #1224 as defensive | 2/2 code lines in patches |
| 84 | `core/…/backend/wasm/transformation/CoroutineTransformation.java` | 80 | +18 −0 | dropped | not planned | not carried; 4 comment lines not compared; for example `try {`, `transformImpl(function);` … |
| 85 | `core/…/backend/wasm/transformation/CoroutineTransformation.java` | 119 | +0 −8 | dropped | not planned | not carried |
| 86 | `core/…/model/optimization/ClassInitElimination.java` | 60 | +12 −1 | patch 0009 | issue first, with reproducer | 3/3 code lines in patches; 9 comment lines not compared |
| 87 | `core/…/reflection/ProxyDependencySupport.java` | 143 | +8 −0 | patch 0002 | PR C2 | 2/3 code lines in patches; 5 comment lines not compared; not carried: `if (method.hasModifier(ElementModifier.STATIC)) {` |
| 88 | `tests/…/java/io/FileTest.java` | 1896 | +6 −0 | patch 0006 | PR C6 | 5/5 code lines in patches |
| 89 | `tests/…/java/lang/StringBuilderTest.java` | 286 | +14 −0 | patch 0005 | PR C5 | 11/11 code lines in patches; 2 comment lines not compared |
| 90 | `tests/…/java/lang/SystemTest.java` | 196 | +10 −0 | patch 0011 | later: ask per-backend values | 7/7 code lines in patches; 2 comment lines not compared |
| 91 | `tests/…/java/util/SpliteratorsTest.java` | 19 | +2 −0 | patch 0007 | PR C7 | 2/2 code lines in patches |
| 92 | `tests/…/java/util/SpliteratorsTest.java` | 118 | +53 −0 | patch 0007 | PR C7 | 40/40 code lines in patches; 4 comment lines not compared |
| 93 | `tests/…/java/util/regex/PatternTest.java` | 33 | +1 −0 | patch 0003 + 0004 | PR C3 / PR C4 | 1/1 code lines in patches |
| 94 | `tests/…/java/util/regex/PatternTest.java` | 1389 | +36 −0 | patch 0003 + 0004 | PR C3 / PR C4 | 26/26 code lines in patches; 6 comment lines not compared |
| 95 | `tests/…/java/util/stream/CollectorsTest.java` | 47 | +12 −0 | patch 0001 | PR C1 | 9/9 code lines in patches; 2 comment lines not compared |

## Patches

| Patch | Change | Upstream |
|---|---|---|
| 0001 | Collectors.joining | PR C1 |
| 0002 | proxy static-method skip | PR C2 |
| 0003 | regex `\R` | PR C3 |
| 0004 | regex `\p{IsAlphabetic}` | PR C4 |
| 0005 | StringBuilder.repeat | PR C5 |
| 0006 | File.toPath | PR C6 |
| 0007 | Spliterators | PR C7 |
| 0008 | Charset.forName key | PR C8 |
| 0009 | ClassInitElimination | issue first, with reproducer |
| 0010 | UTF-32, windows-1251 | later: ask about code pages in an issue |
| 0011 | system properties | later: ask per-backend values |
| 0012 | Character.UnicodeBlock | later, one PR per class |
| 0013 | Class / ClassLoader | later, one PR per class |
| 0014 | Thread.State | later: getState must report real states |
| 0015 | java.lang.invoke stubs | issue: polymorphic signatures need compiler support |
| 0016 | Locale.forLanguageTag | later, one PR per class |
| 0017 | ResourceBundle.Control | later, one PR per class |
| 0018 | ConcurrentHashMap.KeySetView | later, one PR per class |
| 0019 | FileSystemProvider.newFileChannel | later, one PR per class |
| 0020 | br_on_null depth reset | not planned: rejected in #1224 as defensive |

## Dropped

- `CoroutineTransformation`: the `try`/`finally` reset of per-function state. Only reachable after an
  internal compiler error, and rejected as defensive in the #1224 review.
- `WasmGCClassGenerator.staticInitialValue`: emitting the global's own default rather than a
  string-typed null. The fork's own commit called it defensive rather than a reproducible failure.
- The `WasmTypeInference` javadoc on `getDepthBeforeLastInstructionOut`. The code half of that hunk
  is patch 0020, which the same review rejected; it is last in the series so it drops cleanly.
