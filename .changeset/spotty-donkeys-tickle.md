---
"@scalar/java-fmt": patch
---

Roughly halve the time `format` takes per file, with byte-identical output.

`StringWrapper`, the last of the four steps the google-java-format CLI runs,
decides whether to reflow by asking whether any line is longer than the column
limit — and it measures each line with its trailing line break attached, so a
line of exactly 100 columns comes back as 101. Java formatted at 100 columns is
full of lines that land exactly on it, so most files took the slow path with
nothing at all to reflow, paying a whole extra format pass and four more parses
to arrive back at the string they started with. It now returns early when the
reflow map comes back empty, which is what the rest of that step computes
anyway.

Measured on 200 Guava files: 133 KB/s to 215 KB/s under bun, 61.0 ms to 29.9 ms
per file on the 658-file conformance corpus under Node. Boot is unchanged, and
both conformance corpora still come back byte-identical to google-java-format on
a JVM — 658/658 in each style.
