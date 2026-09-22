---
"@scalar/php-fmt": patch
---

The bundled PHP CS Fixer moves from 3.95.18 to 3.95.27, and the PHP it runs on (`@php-wasm/node-8-4` and `@php-wasm/universal`) from 3.1.47 to 3.1.55. The phar is still the official release, unmodified. `test/native-conformance.test.ts` runs the shipped artifact on a native PHP and asserts byte-identical output on every sample.
