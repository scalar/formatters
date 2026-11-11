---
"@scalar/ruby-fmt": patch
---

The RuboCop pass now indents a `case/in` guard continued over lines the way RuboCop 1.92.2 does: 2 from the `in` line, rather than aligned with the guard's condition. rbcop is built from a fork carrying the fix until it lands upstream.
