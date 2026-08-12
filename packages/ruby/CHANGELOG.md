# @scalar/ruby-fmt

## 0.2.1

### Patch Changes

- 883f3d0: Recycle the wasm VM at 400MB of linear memory rather than 1.1GB. A recycle
  cannot hand back the outgoing VM's memory synchronously, so the process holds
  the old buffer and its replacement at once; at the old ceiling that pair peaked
  at ~1.5GB resident, which is a lot to ask of a CI runner formatting a codebase.
  The lower ceiling holds the peak near 1GB and costs about one extra ~250ms boot
  per 130KB of input.

## 0.2.0

### Minor Changes

- 22817a7: Stop returning Ruby that does not parse.

  `then` is mandatory in a `case`/`in` clause whose pattern ends in an endless
  range, and syntax*tree 6.3.0 only keeps it when the \_whole* pattern is one. So
  `in 300.. | 400.. then` came back as `in 300.. | 400..`, and
  `in { status: 400.. } then` as `in status: 400..` — a syntax error, out of
  source that parsed on the way in, with nothing raised. The first sign was a
  generated SDK that no longer compiled.

  `format()` now keeps the `then`, deciding on the rendered pattern rather than on
  its node types, so a literal like `in { m: "ends.." }` is not mistaken for a
  range. The patch is applied to the gem at boot rather than baked into the
  artifact, which stays stock syntax_tree 6.3.0, and it goes away when the fix
  lands upstream. Formatting the rubocop, rubocop-ast and syntax_tree gems both
  ways — 1,033 files — it changes the output of none of them, and
  `test/native-conformance.test.ts` now pins the divergence in both directions.

  `format()` also parses everything it returns and raises rather than handing back
  source Ruby cannot read, so the next bug of this shape cannot corrupt a file
  quietly. It costs about 2.7ms on a 28ms format.
