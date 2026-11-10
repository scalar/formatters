---
"@scalar/php-fmt": patch
---

The bundled PHP CS Fixer moves from 3.95.27 to 3.95.30, and the PHP it runs on (`@php-wasm/node-8-4` and `@php-wasm/universal`) from 3.1.55 to 3.1.64. The phar is still the official release, unmodified. `test/native-conformance.test.ts` runs the shipped artifact on a native PHP and asserts byte-identical output on every sample.
