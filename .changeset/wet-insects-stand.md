---
---

Pin the development toolchain to Node 26.7.0

`.nvmrc`, the `setup-bun` action's default and the Kotlin probe build script all
move from 24.x to 26.7.0, so local work and every CI job but the Node smoke test
run on V8 14.6 rather than 13.6.

This is a toolchain pin only. No package's `engines` floor moves: Java and Kotlin
still declare 24.15.0, the rest still declare 18 or 22, and the Node smoke test
still runs the 24.15.0 end of the matrix alongside 26.7.0 — which is the check
that keeps those numbers honest. Nothing published changes.
