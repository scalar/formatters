# Third-party notices

`rust_fmt.wasm` is a compiled artifact that **embeds** the software below. The
sources are no longer visible in this tree — they are inside the binary — so
their licenses are reproduced here, as those licenses require.

Built by `build/rust_fmt/build.sh`; the versions are pinned there.

| Component | Version | License | Text |
|---|---|---|---|
| rustfmt | 1.9.0-nightly, from the pinned rust commit | MIT OR Apache-2.0 | `rust-LICENSE-MIT`, `rust-LICENSE-APACHE` |
| `rustc_parse`, `rustc_expand`, `rustc_ast`, `rustc_span`, `rustc_errors`, `rustc_session`, `rustc_data_structures` and the rest of the compiler crates they pull in | same commit | MIT OR Apache-2.0 | same text |
| Rust standard library | 1.99.0-nightly | MIT OR Apache-2.0 | same text |
| ~85 crates.io dependencies of the above | pinned by the rust checkout's `Cargo.lock` | MIT OR Apache-2.0, or MIT, or Unlicense OR MIT | same text |
| `option-ext` | 0.2.0 | MPL-2.0 | `option-ext-LICENSE-MPL-2.0` |

Every dependency is permissive. All but one ask only for attribution.

## The one that asks for more

**`option-ext` is MPL-2.0**, which is a weak, file-level copyleft rather than an
attribution-only license. It reaches the artifact through
`rustfmt → dirs → dirs-sys → option-ext`, which is rustfmt's config-file
discovery path.

MPL-2.0 requires that recipients of a binary can obtain the source of the
MPL-covered files. It is used here **unmodified**, so that obligation is
satisfied by pointing upstream:
[`xdg-rs/option-ext`](https://github.com/xdg-rs/dirs/tree/master/option-ext).
Nothing in this repository patches it, and the MPL's copyleft is confined to its
own files — it does not reach rustfmt, this package, or code that depends on
either.

## Known gaps

These are linked into the artifact and their license texts are **not**
reproduced here. All are permissive and attribution-only; the texts are short
and upstream.

| Component | License | Upstream |
|---|---|---|
| `foldhash` 0.2.0 (via `hashbrown`) | Zlib | [orlp/foldhash](https://github.com/orlp/foldhash) |
| `ryu` 1.0.20 (via `serde_json`) | Apache-2.0 OR BSL-1.0 | [dtolnay/ryu](https://github.com/dtolnay/ryu) |
| `unicode-ident` 1.0.24 (via `syn`) | (MIT OR Apache-2.0) AND Unicode-3.0 | [dtolnay/unicode-ident](https://github.com/dtolnay/unicode-ident) |
| wasi-libc | Apache-2.0-with-LLVM-exception OR MIT | [WebAssembly/wasi-libc](https://github.com/WebAssembly/wasi-libc) |

wasi-libc is statically linked by the `wasm32-wasip1` target rather than
unpacked by this build, which is the same gap the Swift package documents.

The pinned nightly toolchain and the `rustc-dev` component are **build-time**
dependencies — they compile the artifact. Only the standard library and the
compiler crates listed above end up inside it.
