---
---

Rewrite `packages/ruby`'s VM-recycle test to assert that linear memory stays
bounded, rather than formatting 1MB of input and hoping to fall over if
recycling stopped. Test-only: no published package changes.
