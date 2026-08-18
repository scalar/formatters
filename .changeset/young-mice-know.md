---
---

ci: drop `--with-deps` from the browser smoke test's Chromium install

`playwright install --with-deps` runs `apt-get update && apt-get install` as root before it
downloads anything, and that apt call was the whole cost of the job: 30 seconds at best, four
minutes typically, and once twenty minutes against an unreachable Ubuntu mirror until the job
timeout cancelled it. The `ubuntu-24.04` image already ships the browsers whose shared libraries
Playwright's chromium links against, so the apt call had nothing to install. The browser test
itself takes twenty seconds.
