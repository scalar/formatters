import type { FormatOptions } from './types'

/**
 * The messages a pool parent and its children exchange.
 *
 * Everything here has to survive `child_process` IPC, which is structured clone
 * for the shapes it supports and nothing more. That is why a formatted result
 * travels as a tagged object rather than a string-or-`Error` union: an `Error`
 * arrives as a plain `Error` with its subclass stripped, and the whole point of
 * the batch API is that a caller can tell an unparseable file (`SyntaxError`)
 * from a rejected rule (`Error`).
 */

/** A shard, on its way to the child that will format it. */
export type PoolRequest = {
  sources: readonly string[]
  /** Never carries `concurrency` - the child formats what it is given, in one instance. */
  options: FormatOptions
}

/** One file's outcome, in the shard's own order. */
export type PoolItem = { status: 'ok'; source: string } | { status: 'error'; name: string; message: string }

export type PoolReply =
  /** Sent once at startup, because a message sent before the child is listening is lost. */
  | { status: 'ready' }
  | { status: 'ok'; results: PoolItem[] }
  /** The shard failed as a whole; the parent formats it itself rather than failing the batch. */
  | { status: 'failed'; message: string }
