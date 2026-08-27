---
'@scalar/ruby-fmt': minor
---

The wasm artifact now ships a Ruby VM that has already booted, with syntax_tree and RuboCop loaded into it. `build/ruby_fmt/build.sh` runs [wizer](https://github.com/bytecodealliance/wizer) over the module and serializes the initialized linear memory back into it, so a consumer instantiates a VM that is up rather than one that has to require 698 cop files first. The first `format` call in a fresh process drops from 11.1 s to 2.1 s, and a VM recycle from 6.3 s to 0.5 s — the recycle being the one that compounds, since formatting's linear-memory leak forces it repeatedly in any process that formats a whole tree. Output is byte-identical: the same gems, on the same CRuby, doing the same work in a different order.

The trade is install size. The artifact goes from 5.2 MB to 12.2 MB compressed (37 MB to 67 MB expanded), because a Ruby heap with RuboCop in it is now part of the module. That is the whole cost, and it is paid once at install rather than repeatedly at runtime.

**Breaking, mildly:** `init({ rubocop: false })` no longer does anything. It existed to decline the ~9 s `init` spent requiring RuboCop, and RuboCop now arrives already required, so there is nothing left to decline. The option is still accepted and still type-checks. `format(source, { rubocop: false })` and `formatSync(source, { rubocop: false })` are unaffected — they skip the Layout pass, which is the part that was ever worth skipping per call.
