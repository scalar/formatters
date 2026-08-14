---
---

Run the test suite one package at a time, each in its own process. A root `bun test` held all seven language runtimes in one process, where the Ruby VM's linear-memory growth ran ~100x slower and vm-recycle's wall-clock budget fired. No published package changes.
