import type { FormatOptions } from './types'

/**
 * The shared-memory layout `formatSync` and its worker agree on.
 *
 * PHP on wasm cannot be called synchronously, and no amount of care on our side
 * changes that: the `asyncify` build unwinds and rewinds the stack through
 * JavaScript, the `jspi` build wraps its entry point in `WebAssembly.Suspending`,
 * and the only export either one offers is `_wasm_sapi_handle_request`. Both
 * hand back a promise whatever the script does.
 *
 * So a synchronous API cannot come from the runtime - it has to come from the
 * thread. PHP runs in a worker, and the calling thread blocks on the answer with
 * `Atomics.wait`, which needs a `SharedArrayBuffer` to wait on. That is the only
 * reason the result travels through shared memory instead of a message: a
 * message would arrive on an event loop the caller is deliberately not turning.
 */

/** Four Int32 slots of header, then the payload. 16 bytes keeps the payload aligned. */
export const HEADER_BYTES = 16

export const CONTROL_SLOTS = 4

/** 0 while the worker is still working, 1 once the result is readable. */
export const SLOT_DONE = 0

/** The payload's length in bytes. Set even when the payload did not fit. */
export const SLOT_LENGTH = 1

/** One of the statuses below. */
export const SLOT_STATUS = 2

export const STATUS_OK = 0

/** The payload is a JSON `{ name, message }` describing a thrown error. */
export const STATUS_ERROR = 1

/** The payload did not fit; retry against a buffer of at least `SLOT_LENGTH` bytes. */
export const STATUS_TOO_LARGE = 2

/**
 * What the caller sends the worker. `resend` asks for the previous result again
 * rather than for a new format, which is what makes growing the buffer cost a
 * copy instead of running a caller's input through PHP a second time.
 */
export type SyncRequest =
  | { kind: 'format'; sab: SharedArrayBuffer; source: string; options: FormatOptions }
  | { kind: 'batch'; sab: SharedArrayBuffer; sources: readonly string[]; options: FormatOptions }
  | { kind: 'resend'; sab: SharedArrayBuffer }
