import { Worker } from 'node:worker_threads'

import { siblingEntry } from './sibling-entry'
import {
  CONTROL_SLOTS,
  HEADER_BYTES,
  SLOT_DONE,
  SLOT_LENGTH,
  SLOT_STATUS,
  STATUS_ERROR,
  STATUS_TOO_LARGE,
  type SyncRequest,
} from './sync-protocol'
import type { BatchOptions, FormatOptions, FormatResult } from './types'

/** Enough for most formatted files; the worker asks for more when it is not. */
const INITIAL_PAYLOAD_BYTES = 1024 * 1024

let worker: Worker | undefined

/** The buffer the worker writes into, grown in place of being reallocated per call. */
let sab = new SharedArrayBuffer(HEADER_BYTES + INITIAL_PAYLOAD_BYTES)

const bootWorker = (): Worker => {
  if (worker) return worker

  const booted = new Worker(siblingEntry('sync-worker'))

  // A formatter that stops a script from exiting is a bug, and this thread only
  // ever runs while the caller is blocked on it, so there is nothing to keep the
  // event loop open for.
  booted.unref()

  worker = booted
  return booted
}

/** Rebuilds the error the worker caught, subclass included. */
const revive = (payload: string): Error => {
  const { name, message } = JSON.parse(payload) as { name: string; message: string }
  return name === 'SyntaxError' ? new SyntaxError(message) : new Error(message)
}

/**
 * Formats PHP source synchronously, with the same fixer, the same rules and the
 * same output as `format`.
 *
 * This exists for callers that cannot await - a template renderer, a
 * `postWrite` hook that has to return a string, a codegen pipeline whose seams
 * are all synchronous. Reach for `format` wherever you can: this one runs PHP
 * on a worker thread and blocks the calling thread until it answers, which is
 * the point but also the cost. Nothing else on that thread runs for the ~300ms
 * a format takes, and the first call adds the ~500ms of booting PHP.
 *
 * The worker is its own PHP instance. Using both `format` and `formatSync` in
 * one process therefore boots two, and they do not share the ~24MB each one
 * costs - so pick one per process where it matters.
 */
export function formatSync(source: string, options?: FormatOptions): string
export function formatSync(sources: readonly string[], options?: BatchOptions): FormatResult[]
export function formatSync(source: string | readonly string[], options: BatchOptions = {}): string | FormatResult[] {
  const active = bootWorker()

  const exchange = (request: SyncRequest): Int32Array => {
    const control = new Int32Array(request.sab, 0, CONTROL_SLOTS)
    Atomics.store(control, SLOT_DONE, 0)
    active.postMessage(request)

    // The wait is the whole mechanism. The worker's reply cannot arrive as a
    // message, because nothing is turning this thread's event loop to receive
    // it; it arrives as a write to shared memory and a notify on this slot.
    Atomics.wait(control, SLOT_DONE, 0)
    return control
  }

  let control = exchange(
    typeof source === 'string'
      ? { kind: 'format', sab, source, options }
      : { kind: 'batch', sab, sources: source, options },
  )

  if (Atomics.load(control, SLOT_STATUS) === STATUS_TOO_LARGE) {
    sab = new SharedArrayBuffer(HEADER_BYTES + Atomics.load(control, SLOT_LENGTH))
    control = exchange({ kind: 'resend', sab })
  }

  const payload = new Uint8Array(sab, HEADER_BYTES, Atomics.load(control, SLOT_LENGTH))
  const text = new TextDecoder().decode(payload)

  if (Atomics.load(control, SLOT_STATUS) === STATUS_ERROR) throw revive(text)

  if (typeof source !== 'string') {
    const results = JSON.parse(text) as Array<
      { status: 'ok'; source: string } | { status: 'error'; name: string; message: string }
    >
    return results.map((result) => (result.status === 'ok' ? result.source : revive(JSON.stringify(result))))
  }

  return text
}
