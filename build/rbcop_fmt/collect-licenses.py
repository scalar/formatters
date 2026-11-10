#!/usr/bin/env python3
"""Writes the license texts for everything linked into rbcop_fmt.wasm.

usage: collect-licenses.py <entry manifest dir> <rbcop checkout> <out dir>

Run by build.sh after the cargo build, so the set is regenerated from the
lockfile every time and cannot drift from what the artifact links. The output
directory is emptied first: a crate that left the dependency graph takes its
license with it.

Four sources, because no single one has everything:

1. Each crate's own license files, from cargo's registry checkout. They carry
   the copyright line MIT and BSD require, which a generic license text does
   not, so they are copied rather than summarised.
2. rbcop's checkout, for rbcop itself and for the RuboCop and RuboCop-plugin
   files it compiles in (config/default.yml and the plugin configs).
3. The Rust toolchain's sysroot, for the standard library.
4. upstream-licenses/ beside this script, for the texts none of the above
   carries: three crates published without a license file, rubocop-performance
   (whose config rbcop compiles in without shipping its license), the two gems
   rbcop's display-width table was generated from, and wasi-libc, which is
   statically linked from a wasi-sdk tarball that carries no license. upstream-licenses/README.md names where each came from.
"""

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
UPSTREAM = HERE / "upstream-licenses"
TARGET = "wasm32-wasip1"
LICENSE_FILE = re.compile(r"^(licen[cs]e|copying|unlicense|notice|copyright)", re.IGNORECASE)

# Crates published without a license file, and the upstream texts that stand in
# for one. Each is the license the crate's own manifest declares.
MISSING = {
    "line-index": ["line-index-LICENSE-MIT", "line-index-LICENSE-APACHE"],
    "ruby-rbs": ["rbs-BSDL", "rbs-COPYING"],
    "ruby-rbs-sys": ["rbs-BSDL", "rbs-COPYING"],
}

# The crate this directory builds, which is ours and carries no third-party code.
OURS = "rbcop_fmt"


def run(args, cwd):
    return subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True).stdout


def linked_crates(entry):
    """(name, version) of every crate in the wasm target's normal dependency graph."""
    tree = run(["cargo", "tree", "--locked", "--target", TARGET, "-e", "normal", "--prefix", "none"], entry)
    crates = set()
    for line in tree.splitlines():
        parts = line.split()
        if len(parts) >= 2:
            crates.add((parts[0], parts[1].lstrip("v")))
    return crates


def main():
    entry, rbcop, out = (Path(arg).resolve() for arg in sys.argv[1:4])

    if out.exists():
        shutil.rmtree(out)
    crates_out = out / "crates"
    crates_out.mkdir(parents=True)

    metadata = json.loads(run(["cargo", "metadata", "--locked", "--format-version", "1", "--filter-platform", TARGET], entry))
    linked = linked_crates(entry)
    rows = []

    for package in sorted(metadata["packages"], key=lambda p: (p["name"], p["version"])):
        key = (package["name"], package["version"])
        if key not in linked or package["name"] == OURS:
            continue

        root = Path(package["manifest_path"]).parent
        sources = [path for path in sorted(root.iterdir()) if path.is_file() and LICENSE_FILE.match(path.name)]
        if package.get("license_file"):
            sources.append(root / package["license_file"])
        sources += [UPSTREAM / name for name in MISSING.get(package["name"], [])]
        if not sources:
            sys.exit(f"collect-licenses: {package['name']} {package['version']} ships no license file and none is "
                     "provided in upstream-licenses/ - add one before publishing")

        destination = crates_out / f"{package['name']}-{package['version']}"
        destination.mkdir()
        for source in dict.fromkeys(sources):
            shutil.copyfile(source, destination / source.name)

        rows.append((package["name"], package["version"], package.get("license") or "?", [s.name for s in dict.fromkeys(sources)]))

    # What rbcop compiles in besides its own code: RuboCop's default.yml and
    # obsoletion.yml, and the configs of the plugins it runs natively.
    shutil.copyfile(rbcop / "LICENSE", out / "rbcop-LICENSE")
    shutil.copyfile(rbcop / "config" / "LICENSE", out / "rubocop-LICENSE")
    for plugin_license in sorted((rbcop / "config" / "plugins").glob("LICENSE-*")):
        shutil.copyfile(plugin_license, out / f"{plugin_license.name.removeprefix('LICENSE-')}-LICENSE")
    shutil.copyfile(UPSTREAM / "rubocop-performance-LICENSE.txt", out / "rubocop-performance-LICENSE")

    # Data rbcop generated from Ruby gems and compiled in: the display-width
    # table in src/helpers/alignment.rs comes from unicode-display_width 3.3.0,
    # which takes its emoji data from unicode-emoji.
    for name in ("unicode-display_width-MIT-LICENSE.txt", "unicode-emoji-MIT-LICENSE.txt"):
        shutil.copyfile(UPSTREAM / name, out / name)

    # The standard library, from the toolchain that compiled it.
    sysroot = Path(run(["rustc", "--print", "sysroot"], entry).strip())
    licenses = sysroot / "share" / "doc" / "rust" / "licenses"
    for name in ("MIT.txt", "Apache-2.0.txt", "LLVM-exception.txt"):
        shutil.copyfile(licenses / name, out / f"rust-std-{name}")

    # wasi-libc, statically linked from wasi-sdk.
    for name in ("LICENSE", "LICENSE-MIT", "LICENSE-APACHE", "LICENSE-APACHE-LLVM", "cloudlibc-LICENSE", "musl-fts-COPYING"):
        shutil.copyfile(UPSTREAM / f"wasi-sdk-25-{name}", out / f"wasi-libc-{name}")
    shutil.copyfile(UPSTREAM / "musl-COPYRIGHT", out / "wasi-libc-musl-COPYRIGHT")

    with open(out / "CRATES.md", "w") as table:
        table.write("# Crates linked into rbcop_fmt.wasm\n\n")
        table.write("Generated by `build/rbcop_fmt/collect-licenses.py` from the lockfile; do not edit.\n")
        table.write("Each crate's own license files are under `crates/<name>-<version>/`.\n\n")
        table.write("| Crate | Version | License | Files |\n|---|---|---|---|\n")
        for name, version, license_id, files in rows:
            table.write(f"| {name} | {version} | {license_id} | {', '.join(f'`{f}`' for f in files)} |\n")

    print(f"collect-licenses: {len(rows)} crates -> {out}")


if __name__ == "__main__":
    main()
