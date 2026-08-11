# Security Policy

## Reporting a vulnerability

Report privately through GitHub's advisory form:

**<https://github.com/scalar/formatters/security/advisories/new>**

Please do not open a public issue, and please do not post it on Discord. We aim to acknowledge
a report within a few working days, and to keep you updated while it is being worked on.
If you would like credit in the advisory, say so and we will name you.

## Supported versions

Every package is on the `0.x` line. Fixes ship in a new release from `main` rather than being
backported, so the latest published version of a package is the supported one.

## What is worth reporting

These packages exist to run a real formatter over source code you may not trust, and each one
carries a compiled artifact — a wasm module, or a phar — that nobody is going to read. Things
we want to hear about:

- Input to `format()` that escapes its sandbox: touching the filesystem, the network, the
  environment, or the host process, from a module that is supposed to be able to do none of it.
- Input that hangs, or that grows memory until the process dies, in a way an ordinary large
  file does not. The known and documented limits — the Ruby VM's recycle threshold, Java and
  Kotlin needing Node 24 — are not this.
- A published artifact that does not match what its build pipeline in `build/` produces from
  the pinned sources, or a build pipeline that fetches something it does not verify.
- A dependency or vendored component shipping a known vulnerability inside one of the artifacts.

## What is not a vulnerability

- Output that differs from the reference tool. That is a correctness bug, and it matters — open
  a normal issue with the reference tool's output alongside it.
- A formatter rejecting input it cannot parse, or crashing the way the real tool crashes on it.
  Matching the reference includes matching its failures.
- Resource use that a native run of the same tool on the same input would also show. wasm makes
  everything a bit heavier; that is a known cost, not a denial of service.
