---
'@scalar/ruby-fmt': patch
---

Pre-warm RuboCop's parsed default configuration into the wasm snapshot

`RuboCop::ConfigLoader.default_configuration` parses and validates RuboCop's own
~600-cop `default.yml`, and every `.rubocop.yml` is merged onto the result. It
costs about a second, and it depends on nothing a caller can vary — two VMs
handed completely different configs compute the identical object. It was being
paid on the first RuboCop format of every VM, and again after every recycle.

`ScalarRubyFmt.warm` now does it at build time, inside the VM wizer snapshots,
so every VM restored from the artifact starts with the answer already in hand.
Measured on the artifact this replaces, the first RuboCop format of a fresh VM
drops from ~640ms to ~206ms, and a recycled VM comes back warm rather than
reparsing. Output is unchanged: the warm only fills caches RuboCop already keeps.

This is a change to how the artifact is built. It takes effect once
`bun run ruby:build` is rerun and the rebuilt `ruby_fmt.wasm.br` is committed;
until then the shipped artifact behaves exactly as before. `preinit.ts` now
asserts the warm survived the snapshot, so a build that loses it fails instead
of quietly shipping a slower artifact.
