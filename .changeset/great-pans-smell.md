---
'@scalar/ruby-fmt': minor
---

Add an opt-in RuboCop pass: `format(source, { rubocop: true })` runs
`rubocop --autocorrect --only Layout` over syntax_tree's output, so the result
is clean under a consumer's own `rubocop` run rather than merely canonical.

syntax_tree alone leaves Layout offenses in about 30% of real files — mostly
multiline operation and method-call indentation, where the two tools genuinely
disagree — and this clears them by letting RuboCop go second.

Off by default, so output is byte-identical to before unless the option is
passed.

The artifact now carries RuboCop 1.74.0 and its dependencies alongside
syntax_tree 6.3.0, which takes it from 3.8 MB to 5.1 MB — the one cost every
consumer pays whether or not they use the option. The rest is opt-in: RuboCop is
required into the VM on the first call that asks for it, which takes about four
seconds, and each format after that costs two to three times what syntax_tree
alone does.
