#!/usr/bin/env python3
"""Writes packages/ruby/licenses/NOTICE.md.

usage: collect.py <rbcop entry dir> <rbcop checkout> <output file>

Run by build/rbcop_fmt/build.sh after the cargo build, because the crate half
of the list comes from that build's lockfile. Rerun it by hand after changing
components.json.

The file carries the notices the artifact's licenses require of a binary
distribution: each component's copyright line, and the text of the license it
is distributed under - each distinct text once, rather than once per component.
That is what the licenses ask for. Concretely:

- Where a component offers a choice (MIT OR Apache-2.0, Unlicense OR MIT),
  it is distributed under the one with the lightest notice requirement, so no
  Apache-2.0 text is needed at all.
- A component's own license text is compared with the standard form of its
  license, copyright and title lines aside. If it matches, only its copyright
  lines are listed under the one shared text. If it differs in any way (ICU's
  Unicode license carries extra notices; RBS's BSD-2 says "author" where the
  standard says "copyright holders"), its own text is printed instead - once
  for every component that shares it - so nothing is ever normalised away.
- Crates that only run at build time (procedural macros and what only they
  depend on) are not in the artifact and are left out, using cargo's own
  `no-proc-macro` view of the graph rather than a guess.
- Licenses that ask for no notice in a compiled distribution (BSL-1.0, CC0) are
  named, without text, so the omission is visible.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TARGET = "wasm32-wasip1"
OURS = "rbcop_fmt"

# Licenses with a standard text this file prints once. Anything else is
# reproduced verbatim per component.
CANONICAL = {
    "MIT": ("MIT License", HERE / "texts" / "canonical-MIT.txt"),
    "BSD-2-Clause": ("BSD 2-Clause License", HERE / "texts" / "canonical-BSD-2-Clause.txt"),
    "Unicode-3.0": ("Unicode License v3", HERE / "texts" / "canonical-Unicode-3.0.txt"),
}

# Distributed under a license that requires no notice for compiled code.
NO_NOTICE = {
    "BSL-1.0": "requires no notice for copies in machine-executable object code",
}

# Election among the licenses a crate offers, lightest notice first.
PREFERENCE = ["MIT", "BSD-2-Clause", "Unicode-3.0", "BSL-1.0"]

COPYRIGHT_LINE = re.compile(r"^\s*(copyright\b|\(c\)|©)", re.IGNORECASE)
TITLE_LINE = re.compile(r"^[\s#]*(the\s+)?(mit|bsd|unicode)[\w\s.\-()]*licen[cs]e[\w\s.\-()]*$", re.IGNORECASE)


def run(args, cwd):
    return subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True).stdout


def copyright_lines(text):
    """The copyright lines a text carries, without template placeholders."""
    return [
        line.strip()
        for line in text.splitlines()
        if COPYRIGHT_LINE.match(line)
        and not re.search(r"<(year|copyright holders?|owner|name)>", line, re.IGNORECASE)
        and "above copyright" not in line.lower()
        and line.strip().upper() not in {"COPYRIGHT AND PERMISSION NOTICE", "COPYRIGHT NOTICE"}
    ]


def normalise(text):
    """A text's body for comparison: no copyright or title lines, no markup, one space."""
    kept = []
    for line in text.splitlines():
        if COPYRIGHT_LINE.match(line) or TITLE_LINE.match(line):
            continue
        if line.strip().upper() in {"COPYRIGHT AND PERMISSION NOTICE", "UNICODE LICENSE V3"}:
            continue
        kept.append(line)
    body = " ".join(kept)
    body = body.replace("“", '"').replace("”", '"').replace("’", "'")
    body = re.sub(r"[#*`>_]", " ", body)
    return re.sub(r"\s+", " ", body).strip().lower()


def body_without_copyright(text):
    lines = [line for line in text.splitlines() if not (COPYRIGHT_LINE.match(line) and "above copyright" not in line.lower())]
    return "\n".join(lines).strip("\n")


def elect(expression):
    """The license this package distributes a crate under, from its SPDX expression."""
    offered = set(re.split(r"\s+(?:OR|AND)\s+|/|[()]", expression or ""))
    offered = {part.strip() for part in offered if part.strip()}
    if " AND " in (expression or ""):
        # unicode-ident: (MIT OR Apache-2.0) AND Unicode-3.0 - both halves apply.
        return "MIT AND Unicode-3.0"
    for license_id in PREFERENCE:
        if license_id in offered:
            return license_id
    return expression


def crate_text(root, license_id, fallback):
    """The license file in a crate's package that matches the elected license."""
    files = [p for p in sorted(root.iterdir()) if p.is_file() and re.match(r"(?i)^(licen[cs]e|copying|unlicense|copyright)", p.name)]
    if license_id == "MIT":
        named = [p for p in files if "mit" in p.name.lower()]
        if named:
            return named[0]
        for p in files:
            if "permission is hereby granted" in p.read_text(errors="replace").lower():
                return p
    elif files:
        named = [p for p in files if "apache" not in p.name.lower()]
        if named:
            return named[0]
    return fallback


def crates(entry, manifest):
    """The crates linked into rbcop_fmt.wasm, as components, less those components.json names."""
    named = {item["name"] for item in manifest["components"]}
    tree = run(["cargo", "tree", "--locked", "--target", TARGET, "-e", "normal,no-proc-macro", "--prefix", "none"], entry)
    linked = {(p[0], p[1].lstrip("v")) for p in (line.split() for line in tree.splitlines()) if len(p) >= 2}
    metadata = json.loads(run(["cargo", "metadata", "--locked", "--format-version", "1", "--filter-platform", TARGET], entry))

    found = []
    for package in sorted(metadata["packages"], key=lambda p: (p["name"], p["version"])):
        if (package["name"], package["version"]) not in linked or package["name"] in {OURS, *named}:
            continue
        expression = package.get("license") or ""
        license_id = elect(expression)
        root = Path(package["manifest_path"]).parent
        fallback = manifest["crate_texts"].get(package["name"])
        fallback = HERE / fallback if fallback else None

        if license_id == "MIT AND Unicode-3.0":
            # Both parts are required; the crate ships one file per license.
            for part in ("MIT", "Unicode-3.0"):
                path = crate_text(root, part, None) if part == "MIT" else next(
                    (p for p in root.iterdir() if "unicode" in p.name.lower()), None
                )
                found.append(component("rbcop_fmt.wasm", package, part, expression, path))
            continue
        if license_id in NO_NOTICE:
            found.append({**component("rbcop_fmt.wasm", package, license_id, expression, None), "no_notice": NO_NOTICE[license_id]})
            continue
        path = crate_text(root, license_id, fallback)
        if path is None:
            sys.exit(f"collect: {package['name']} {package['version']} has no {license_id} text; add one to components.json crate_texts")
        found.append(component("rbcop_fmt.wasm", package, license_id, expression, path, package.get("authors")))
    return found


def component(artifact, package, license_id, expression, path, authors=None):
    return {
        "artifact": artifact,
        "name": package["name"],
        "version": package["version"],
        "license": license_id,
        "offered": expression if expression != license_id else None,
        "path": path,
        "authors": authors,
    }


def resolve(text, rbcop):
    if text.startswith("rbcop:"):
        return rbcop / text.removeprefix("rbcop:")
    if text.startswith("canonical:"):
        return None
    return HERE / text


def main():
    entry, rbcop, out = (Path(arg).resolve() for arg in sys.argv[1:4])
    manifest = json.loads((HERE / "components.json").read_text())

    components = []
    for item in manifest["components"]:
        components.append({**item, "path": resolve(item["text"], rbcop)})
    components += crates(entry, manifest)

    canonical = {normalise(path.read_text()): lid for lid, (_, path) in CANONICAL.items()}
    # One group per distinct license text: the standard texts first, then every
    # other text that occurs, each printed once for all the components it covers.
    groups = {}
    no_notice = []

    for c in components:
        if c.get("no_notice"):
            no_notice.append(c)
            continue
        text = c["path"].read_text(errors="replace") if c["path"] else CANONICAL[c["license"]][1].read_text()
        lines = c.get("copyright") or copyright_lines(text)
        if not lines and c.get("authors"):
            lines = [f"no copyright line in its license text; authors per its Cargo manifest: {', '.join(c['authors'])}"]
        c["lines"] = lines
        body = normalise(text)
        standard = canonical.get(body) if not c.get("verbatim") else None
        key = ("0", standard) if standard else ("1", c["license"], body)
        group = groups.setdefault(key, {"standard": standard, "license": c["license"], "text": text, "members": []})
        group["members"].append(c)

    def label(c):
        offered = f"; offered as {c['offered']}" if c.get("offered") else ""
        return f"**{c['name']}** {c['version']} ({c['artifact']}{offered})"

    out_lines = [
        "# Third-party notices",
        "",
        "`@scalar/ruby-fmt` ships one compiled artifact, `rbcop_fmt.wasm` (the RuboCop",
        "Layout pass). This file carries the notices the licenses of what is compiled",
        "into it require: each component's copyright notice, and the text of the",
        "license it is distributed under. Each distinct license text appears once,",
        "followed by every component it covers.",
        "",
        "Where a component offers a choice of licenses, it is distributed here under the",
        "one named first in its entry, and the offer is shown. Crates that only run at",
        "build time are not in the artifact and are not listed.",
        "",
        "Generated by `build/licenses/collect.py`; do not edit by hand.",
        "",
    ]

    ordered = sorted(groups.items(), key=lambda item: (item[0][0], item[1]["license"], -len(item[1]["members"])))
    seen_titles = {}
    for _, group in ordered:
        members = sorted(group["members"], key=lambda c: (c["artifact"], c["name"].lower()))
        if group["standard"]:
            title = CANONICAL[group["standard"]][0]
            text = CANONICAL[group["standard"]][1].read_text()
        else:
            base = f"{group['license']}, as used by {members[0]['name']}"
            seen_titles[base] = seen_titles.get(base, 0) + 1
            title = base if seen_titles[base] == 1 else f"{base} ({seen_titles[base]})"
            text = group["text"]
        # A text every member carries byte for byte is printed untouched, with its
        # copyright notices where its authors put them: some run over several
        # lines or sit inside prose, and lifting them out would mangle them.
        whole = not group["standard"] and len({c["path"].read_text(errors="replace") for c in members}) == 1
        if whole:
            applies = "Applies to this component; its copyright notices are in the text:" if len(members) == 1 else f"Applies to these {len(members)} components, which carry this text word for word, copyright notices included:"
        else:
            applies = "Applies to this component:" if len(members) == 1 else f"Applies to these {len(members)} components, each under its own copyright notice:"
        out_lines += [f"## {title}", "", applies, ""]
        for c in members:
            note = f" {c['note']}" if c.get("note") else ""
            if whole:
                out_lines.append(f"- {label(c)}.{note}")
                continue
            notice = "; ".join(c["lines"]) if c["lines"] else "no copyright line in its license text"
            out_lines.append(f"- {label(c)}: {notice.rstrip('.')}.{note}")
        body = text.strip("\n") if whole else body_without_copyright(text)
        out_lines += ["", "```text", body, "```", ""]

    out_lines += ["## No notice required", ""]
    for c in no_notice + [{**n, "version": ""} for n in manifest["no_notice"]]:
        why = c.get("why") or c.get("no_notice")
        out_lines.append(f"- **{c['name']}** {c.get('version', '')} ({c['artifact']}): {c['license']}, which {why}.".replace("  ", " "))
    out_lines.append("")

    out.write_text("\n".join(out_lines))
    print(f"collect: {len(components)} components -> {out} ({len(out_lines)} lines, {len(groups)} distinct license texts)")


if __name__ == "__main__":
    main()
