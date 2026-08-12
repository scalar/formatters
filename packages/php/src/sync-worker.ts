import { parentPort } from 'node:worker_threads'

import { format } from './format'
import {
  CONTROL_SLOTS,
  HEADER_BYTES,
  SLOT_DONE,
  SLOT_LENGTH,
  SLOT_STATUS,
  STATUS_ERROR,
  STATUS_OK,
  STATUS_TOO_LARGE,
  type SyncRequest,
} from './sync-protocol'

/** A finished format, ready to be copied into whatever buffer the caller offers. */
type Result = { status: number; payload: Uint8Array }

const encoder = new TextEncoder()

/**
 * The last result, kept for `resend`. A payload that did not fit is asked for
 * again against a bigger buffer, and reformatting to answer that would be both
 * wasteful and wrong - it would run a caller's input through PHP twice.
 */
let last: Result | undefined

/**
 * Formats, or captures the throw.
 *
 * The async API throws `SyntaxError` for a parse error and `Error` for anything
 * else, and callers switch on that, so the distinction has to survive the trip
 * back across the thread. It travels as JSON because an Error does not: structured
 * clone drops the subclass, and the payload is bytes in shared memory regardless.
 */
const run = async (request: Extract<SyncRequest, { kind: 'format' }>): Promise<Result> => {
  try {
    return { status: STATUS_OK, payload: encoder.encode(await format(request.source, request.options)) }
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error'
    const message = error instanceof Error ? error.message : String(error)
    return { status: STATUS_ERROR, payload: encoder.encode(JSON.stringify({ name, message })) }
  }
}

if (!parentPort) {
  throw new Error('sync-worker is a worker thread entry point and cannot be run on its own')
}

const port = parentPort

/**
 * A resend can only follow a format, so `last` is always there in practice.
 * Reporting it rather than asserting it keeps a protocol mistake as an error the
 * caller can read, instead of an unhandled rejection in a thread nobody is
 * watching.
 */
const nothingToResend = (): Result => ({
  status: STATUS_ERROR,
  payload: encoder.encode(JSON.stringify({ name: 'Error', message: 'no previous result to resend' })),
})

port.on('message', (request: SyncRequest) => {
  void (async () => {
    const result = request.kind === 'format' ? await run(request) : (last ?? nothingToResend())
    last = result

    const control = new Int32Array(request.sab, 0, CONTROL_SLOTS)
    const capacity = request.sab.byteLength - HEADER_BYTES

    // The length goes out even when the payload does not fit: it is what the
    // caller sizes the next buffer from, which turns growing into one retry
    // rather than a guess-and-double loop.
    Atomics.store(control, SLOT_LENGTH, result.payload.length)

    if (result.payload.length > capacity) {
      Atomics.store(control, SLOT_STATUS, STATUS_TOO_LARGE)
    } else {
      new Uint8Array(request.sab, HEADER_BYTES).set(result.payload)
      Atomics.store(control, SLOT_STATUS, result.status)
    }

    // Publish last. The caller is parked on this slot and reads everything else
    // once it wakes, so it has to be the final write.
    Atomics.store(control, SLOT_DONE, 1)
    Atomics.notify(control, SLOT_DONE)
  })()
})
