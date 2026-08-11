#!/bin/sh
# RUSTC_WRAPPER for building rustfmt against wasm-compiled rustc_private crates.
#
# rustfmt loads eight compiler crates with `extern crate`, expecting them in the
# sysroot. rustup ships those only for host targets, so we build them ourselves
# and inject them as `--extern`. Cargo has no flag for that, and RUSTFLAGS does
# not work: cargo probes rustc with `--print=file-names` to learn target details,
# and `--extern` makes the probe fail with
#
#   error: output of --print=file-names missing when learning about
#          target-specific information from rustc
#
# So the flags go in here instead, applied only where they belong.
#
# Skipped for `--print` probes (see above) and for host compilation - build
# scripts and proc macros must not see wasm rlibs on their search path.
#
# Flags come in via $RUSTFMT_WASM_FLAGS. See SPIKE.md beside this file.
rustc="$1"; shift

for a in "$@"; do
  [ "$a" = "--print" ] && exec "$rustc" "$@"
  case "$a" in --print=*) exec "$rustc" "$@" ;; esac
done

case " $* " in
  *" wasm32-wasip1 "*) exec "$rustc" "$@" $RUSTFMT_WASM_FLAGS ;;
  *)                   exec "$rustc" "$@" ;;
esac
