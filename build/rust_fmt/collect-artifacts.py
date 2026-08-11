#!/usr/bin/env python3
"""Collect the build outputs rustfmt needs injected, from a cargo target dir.

Two modes, both consumed by the RUSTC_WRAPPER in inject-externs.sh:

  externs <wasm-deps-dir>
      Print `--extern name=path` for the eight rustc_private crates rustfmt
      loads plus thin_vec. Exits non-zero naming anything missing, so a broken
      compiler-crate build fails here rather than as a confusing E0463 later.

  procmacros <host-deps-dir> <out-dir>
      Copy the host proc-macro .so files into a directory of their own.
      They must be on a -L path for the wasm build to resolve rustc_macros and
      derive_where, but pointing -L at the whole host deps dir shadows the wasm
      builds of tracing/ignore/annotate_snippets and breaks the build.

Cargo leaves several hashed copies of a crate behind across check and build
runs, so both modes take the newest per crate name.
"""

import os
import re
import shutil
import sys

# The crates rustfmt names in `extern crate`, minus rustc_driver, which we patch
# out for wasm - it exists only to pull in object code that rustc-dev ships
# separately, and our rlibs already carry it.
SYSROOT_CRATES = [
    "rustc_ast",
    "rustc_ast_pretty",
    "rustc_data_structures",
    "rustc_errors",
    "rustc_expand",
    "rustc_parse",
    "rustc_session",
    "rustc_span",
    "thin_vec",
]


def newest_per_crate(directory, pattern):
    """Map crate name -> newest matching artifact path."""
    best = {}
    for entry in os.listdir(directory):
        match = re.match(pattern, entry)
        if not match:
            continue
        name = match.group(1)
        path = os.path.join(directory, entry)
        stamp = os.path.getmtime(path)
        if name not in best or stamp > best[name][1]:
            best[name] = (path, stamp)
    return best


def externs(deps_dir):
    found = newest_per_crate(deps_dir, r"^lib(.+)-[0-9a-f]{16}\.rlib$")
    found = {k: v for k, v in found.items() if k in SYSROOT_CRATES}
    missing = [c for c in SYSROOT_CRATES if c not in found]
    if missing:
        sys.exit(f"missing wasm rlibs in {deps_dir}: {', '.join(missing)}")
    print(" ".join(f"--extern {n}={p}" for n, (p, _) in sorted(found.items())))


def procmacros(deps_dir, out_dir):
    found = newest_per_crate(deps_dir, r"^lib(.+)-[0-9a-f]{16}\.so$")
    shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(out_dir)
    for path, _ in found.values():
        shutil.copy2(path, out_dir)
    print(f"collected {len(found)} proc macros", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "externs":
        externs(sys.argv[2])
    elif len(sys.argv) >= 4 and sys.argv[1] == "procmacros":
        procmacros(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
