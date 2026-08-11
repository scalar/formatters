// Types for the runtime TeaVM generates next to `classes.wasm`.
//
// It is generated into `target/`, so nothing here can import it by a static specifier - the
// scripts reach it through `await import(<resolved path>)`, which types as `any`. These
// declarations are what stops that `any` spreading into the callers, and they are hand-written
// against what the runtime actually exposes rather than derived from it: TeaVM emits no
// declarations of its own.

/** Exports vary by pom - `pom.xml` exports `parse`, `pom-ktfmt.xml` exports `format`. */
export type TeaVmExports = {
  /** Returns a status character followed by the formatted source, or by the failure text. */
  format?: (source: string, spec: string) => string
  parse?: (source: string) => string
}

export type TeaVmModule = {
  exports: TeaVmExports
}

/**
 * Frames resolve to Java method names only when both the `.teadbg` line tables and the
 * deobfuscator module are passed; see the comment in `kotlin-probe/run.ts`.
 */
export type TeaVmLoadOptions = {
  stackDeobfuscator?: {
    enabled: boolean
    externalInfoPath: string
    path: string
  }
}

export type TeaVmRuntime = {
  load: (bytes: ArrayBuffer, options: TeaVmLoadOptions) => Promise<TeaVmModule>
}
