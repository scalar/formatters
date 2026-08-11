// Types for `@php-wasm/node-8-4`, which ships none.
//
// Its manifest sets `"types": "index.d.ts"` but the tarball contains no such
// file, so TypeScript falls back to an implicit `any` and `noImplicitAny` fails
// the build. This is an upstream packaging bug, not a decision to work around:
// the sibling `@php-wasm/universal` ships full declarations, which is why only
// this one module needs covering.
//
// Only the two exports this package actually calls are declared, and both are
// typed against `@php-wasm/universal`'s own types rather than restated, so a
// signature change upstream surfaces here as a type error instead of being
// papered over. Delete this file once the package ships its declarations.

declare module '@php-wasm/node-8-4' {
  import type { PHPLoaderModule } from '@php-wasm/universal'

  /**
   * Whether the host engine supports the JavaScript Promise Integration
   * proposal. Selects which build of the runtime to load.
   */
  export const jspi: () => Promise<boolean>

  /** The Emscripten module for PHP 8.4, in the requested suspension mode. */
  export const getPHPLoaderModule: (mode: 'jspi' | 'asyncify') => Promise<PHPLoaderModule>
}
