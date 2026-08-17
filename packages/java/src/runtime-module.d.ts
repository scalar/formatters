// Types for this package's own `./runtime` subpath, which is a generated
// JavaScript file with no declarations of its own.
//
// `@scalar/java-fmt/runtime` resolves to `java_fmt.runtime.mjs` - TeaVM's generated
// runtime, shipped verbatim. It is imported by that specifier rather than by a
// URL so a bundler can follow it and include the file; the cost of a literal
// specifier is that TypeScript then wants to know its shape, which is what this
// declares. The shape is restated from `Runtime` in `types.ts` rather than
// duplicated, so the two cannot drift.

declare module '@scalar/java-fmt/runtime' {
  import type { Runtime } from './types'

  export const load: Runtime['load']
}
