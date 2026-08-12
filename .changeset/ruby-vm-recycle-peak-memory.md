---
'@scalar/ruby-fmt': patch
---

Recycle the wasm VM at 400MB of linear memory rather than 1.1GB. A recycle
cannot hand back the outgoing VM's memory synchronously, so the process holds
the old buffer and its replacement at once; at the old ceiling that pair peaked
at ~1.5GB resident, which is a lot to ask of a CI runner formatting a codebase.
The lower ceiling holds the peak near 1GB and costs about one extra ~250ms boot
per 130KB of input.
