# Drafts for konsoletyper/teavm

Nothing here has been opened. Each section is one PR or issue, built from one
patch in `../patches`, in the order to send them, except the last section,
which is for later. The rules they follow are in
`UPSTREAMING_PLAN.md` on the fork's `claude/funny-cray-am4u3y` branch: one fix
per PR, a short `area: summary` commit with no body, tests in the existing test
class, no explanatory comments, no defensive code, and a description that a
person has checked line by line against the code before it goes out.

Keep one open at a time until two or three have merged. A patch whose PR
merges comes out of the series as an empty commit at the next rebase
(`../README.md`).

To open one, make a branch off the `UPSTREAM_REF` commit, `git am` the single
patch, run the test class it touches on all three backends, and push:

```bash
git am ../patches/0001-*.patch
```

```bash
./gradlew :tests:test --tests org.teavm.classlib.java.util.stream.CollectorsTest -Pteavm.tests.js=true -Pteavm.tests.wasm-gc=true -Pteavm.tests.c=true -Pteavm.tests.optimized=true
```

```bash
./gradlew checkstyleMain
```

| # | Kind | Patch | Title |
|---|---|---|---|
| 1 | issue | 0009 | `ClassInitElimination` removes an interface's initializer after a call through the interface |
| 2 | PR | 0001 | classlib: fix Collectors.joining dropping delimiter after empty element |
| 3 | PR | 0002 | reflection: don't generate proxy workers for static interface methods |
| 4 | PR | 0003 | classlib: support \R in regex |
| 5 | PR | 0004 | classlib: support \p{IsAlphabetic} in regex |
| 6 | PR | 0005 | classlib: add StringBuilder.repeat(int, int) |
| 7 | PR | 0006 | classlib: add File.toPath |
| 8 | PR | 0007 | classlib: add Spliterators.iterator and Spliterators.AbstractSpliterator |

The issue goes first because issues are cheap and it is the only change that
turns wrong output into right output; the PRs follow from easiest to review.

Patch `0008`, the `Charset.forName` registry key, is not on the list: nothing
upstream registers today exercises it, so it waits to go in one PR with the
UTF-32 and windows-1251 charsets of patch `0010`. `DRAFTS.md` says why.

See `DRAFTS.md` for the text of each.
