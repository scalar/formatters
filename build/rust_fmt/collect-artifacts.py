#!/usr/bin/env python3
"""Collect the build outputs rustfmt needs injected, from a cargo target dir.

  deps <profile-dir> <flat-dir>
      Print the directory holding a profile's compiled crates, flat, the way
      cargo's `deps/` used to. Cargo's newer build-dir layout gives each unit
      its own `build/<package>/<hash>/out/` instead, which no single
      `-L dependency=` can point at, so when there is no `deps/` the crates
      are hard-linked into <flat-dir> and that is printed instead. Either way
      the modes below, and the -L paths the build passes, see one directory.

The other two modes are consumed by the RUSTC_WRAPPER in inject-externs.sh:

  externs <wasm-deps-dir>
      Print `--extern name=path` for the nine rustc_private crates rustfmt
      loads plus thin_vec. Each crate gets its .rmeta as well as its .rlib
      when there is one: cargo now builds rlibs without their metadata
      embedded, leaving a stub that rustc refuses on its own. Exits non-zero
      naming anything missing, so a broken compiler-crate build fails here
      rather than as a confusing E0463 later.

  procmacros <host-deps-dir> <out-dir>
      Copy every host proc-macro .so into a directory of their own.
      They must be on a -L path for the wasm build to resolve rustc_macros and
      derive_where, but pointing -L at the whole host deps dir shadows the wasm
      builds of tracing/ignore/annotate_snippets and breaks the build.

Cargo leaves several hashed copies of a crate behind across check and build
runs, so `externs` takes the newest per crate name. `procmacros` keeps them
all, because there a second copy can be a second version rather than a stale
one.
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
    "rustc_feature",
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


def deps(profile_dir, flat_dir):
    legacy = os.path.join(profile_dir, "deps")
    if os.path.isdir(legacy):
        print(legacy)
        return
    shutil.rmtree(flat_dir, ignore_errors=True)
    os.makedirs(flat_dir)
    units = os.path.join(profile_dir, "build")
    for package in sorted(os.listdir(units)):
        for unit in sorted(os.listdir(os.path.join(units, package))):
            out = os.path.join(units, package, unit, "out")
            if not os.path.isdir(out):
                continue
            for entry in os.listdir(out):
                if re.match(r"^lib.+-[0-9a-f]{16}\.(rlib|rmeta|so)$", entry):
                    os.link(os.path.join(out, entry), os.path.join(flat_dir, entry))
    print(flat_dir)


def externs(deps_dir):
    found = newest_per_crate(deps_dir, r"^lib(.+)-[0-9a-f]{16}\.rlib$")
    found = {k: v for k, v in found.items() if k in SYSROOT_CRATES}
    missing = [c for c in SYSROOT_CRATES if c not in found]
    if missing:
        sys.exit(f"missing wasm rlibs in {deps_dir}: {', '.join(missing)}")
    flags = []
    for name, (path, _) in sorted(found.items()):
        flags.append(f"--extern {name}={path}")
        rmeta = path[: -len(".rlib")] + ".rmeta"
        if os.path.exists(rmeta):
            flags.append(f"--extern {name}={rmeta}")
    print(" ".join(flags))


def procmacros(deps_dir, out_dir):
    # Every copy, not the newest per name: the graph can hold two versions of
    # one proc macro (thiserror-impl 1 and 2, say) under the same crate name,
    # and rustc picks between them by the hash each dependent recorded. Keeping
    # only one fails with E0463 naming whichever was dropped.
    found = [e for e in os.listdir(deps_dir) if re.match(r"^lib.+-[0-9a-f]{16}\.so$", e)]
    shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(out_dir)
    for entry in found:
        shutil.copy2(os.path.join(deps_dir, entry), out_dir)
    print(f"collected {len(found)} proc macros", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "deps":
        deps(sys.argv[2], sys.argv[3])
    elif len(sys.argv) >= 3 and sys.argv[1] == "externs":
        externs(sys.argv[2])
    elif len(sys.argv) >= 4 and sys.argv[1] == "procmacros":
        procmacros(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
