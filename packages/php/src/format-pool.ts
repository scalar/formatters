import { fork } from 'node:child_process'

import { formatBatch } from './format-batch'
import { poolConcurrency } from './pool-concurrency'
import type { PoolItem, PoolReply, PoolRequest } from './pool-protocol'
import { type Shard, shardSources } from './shard-sources'
import { siblingEntry } from './sibling-entry'
import type { BatchOptions, FormatOptions, FormatResult } from './types'

/** Rebuilds the error a child caught, subclass included. */
const revive = (item: PoolItem): FormatResult => {
  if (item.status === 'ok') return item.source

  return item.name === 'SyntaxError' ? new SyntaxError(item.message) : new Error(item.message)
}

/** A child process working on one shard. */
type Delegated = {
  /**
   * Resolves once the shard is on its way to the child, or once we have given up
   * on that child. Waiting for this before the calling process starts formatting
   * anything itself is what makes the pool a pool: a child is handed its work
   * over IPC, and IPC needs an event loop that is turning. Start our own shard
   * first and the children sit idle until we finish, which is a slower way to
   * format the same batch sequentially.
   */
  dispatched: Promise<void>
  /** The shard's results, or `undefined` if this child could not produce them. */
  result: Promise<PoolItem[] | undefined>
  /**
   * Stops the child, whether or not it has answered. Used when the batch is
   * abandoned - PHP falling over while formatting this process's own shard is the
   * realistic way that happens - so a caller who saw a throw is not left with
   * several PHP instances still grinding through work nobody will read.
   */
  abort: () => void
}

/**
 * Runs one shard in a child process. Never rejects: a child that cannot do the
 * work resolves to `undefined`, which is what lets the caller quietly fall back
 * to formatting the shard itself.
 */
const delegate = (shard: Shard, options: FormatOptions): Delegated => {
  let markDispatched = (): void => {}
  const dispatched = new Promise<void>((resolve) => {
    markDispatched = resolve
  })

  // Replaced by the real thing below once there is a child to stop. Until then
  // there is nothing running, so aborting is a no-op rather than an error.
  let abort = (): void => {}

  const result = new Promise<PoolItem[] | undefined>((resolve) => {
    const give = (value: PoolItem[] | undefined): void => {
      // Always release the caller from the handshake, even when this child never
      // got as far as taking work, or it would wait here for a reply that is
      // never coming.
      markDispatched()
      resolve(value)
    }

    let child: ReturnType<typeof fork>

    try {
      child = fork(siblingEntry('pool-child'), {
        // Every stream discarded: results come back over IPC, PHP's SAPI writes
        // to stdout, and a piped stream nobody drains would deadlock the child
        // the moment it filled. What we need on failure is in the reply.
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      })
    } catch {
      // Some sandboxes refuse to spawn at all. That is a reason to be slow, not
      // a reason to fail.
      give(undefined)
      return
    }

    const settle = (value: PoolItem[] | undefined): void => {
      child.removeAllListeners()
      if (child.connected) child.disconnect()
      child.kill()
      give(value)
    }

    abort = () => settle(undefined)

    child.on('message', (reply: PoolReply) => {
      if (reply.status === 'ready') {
        child.send({ sources: shard.sources, options } satisfies PoolRequest)
        markDispatched()
        return
      }

      settle(reply.status === 'ok' ? reply.results : undefined)
    })

    child.on('error', () => settle(undefined))

    // A child that exits without replying - an out-of-memory kill is the
    // realistic way that happens - would otherwise leave this pending and the
    // whole batch hanging on it.
    child.on('exit', () => settle(undefined))
  })

  return { dispatched, result, abort: () => abort() }
}

/**
 * Formats a batch across several PHP instances and reassembles it in order.
 *
 * Batching a group into one fixer invocation was the first win here - it pays for
 * the phar's autoload once instead of once per file - but it left the batch
 * running on a single instance, and PHP CS Fixer is sequential. This is the
 * second win: the files are independent, so the batch can be split.
 *
 * The calling process formats one shard itself, on the instance it has already
 * booted, and forks a child for each of the others. So `concurrency: 4` means
 * three new processes rather than four, and a batch small enough to want a
 * single instance costs exactly what it did before this existed.
 */
export const formatPool = async (sources: readonly string[], options: BatchOptions = {}): Promise<FormatResult[]> => {
  if (sources.length === 0) return []

  const { concurrency, ...fixerOptions } = options
  const [own, ...delegated] = shardSources(sources, poolConcurrency(sources.length, concurrency))

  if (!own) return []

  // A single shard is the whole batch: no processes, no IPC, nothing to
  // reassemble. This is the path a small batch and `concurrency: 1` both take.
  if (delegated.length === 0) return formatBatch(sources, fixerOptions)

  const children = delegated.map((shard) => delegate(shard, fixerOptions))

  try {
    await Promise.all(children.map((child) => child.dispatched))

    const placed = new Map<number, FormatResult>()

    const place = (shard: Shard, formatted: readonly FormatResult[]): void => {
      shard.indices.forEach((target, position) => {
        const result = formatted[position]
        if (result !== undefined) placed.set(target, result)
      })
    }

    // Now that every child is busy, this process can spend the same time on a
    // shard of its own rather than watching.
    place(own, await formatBatch(own.sources, fixerOptions))

    const outcomes = await Promise.all(children.map((child) => child.result))

    for (const [index, shard] of delegated.entries()) {
      const outcome = outcomes[index]

      // A child that could not be forked, died, or reported a failed shard costs
      // the parallelism for that shard and nothing else. Formatting it here is
      // slower than the caller hoped for but returns the same bytes, which beats
      // failing a batch because a process could not start.
      place(shard, outcome ? outcome.map(revive) : await formatBatch(shard.sources, fixerOptions))
    }

    return sources.map((_, index) => {
      const result = placed.get(index)

      // Unreachable: every index belongs to exactly one shard, and every shard is
      // either formatted or reformatted above. Reported rather than asserted so a
      // future change to the sharding fails loudly instead of returning a hole.
      if (result === undefined) throw new Error(`the pool lost the result for source ${index}`)

      return result
    })
  } finally {
    // Whatever happened, no child outlives the call. On the happy path they have
    // already answered and stopped, so this only bites when the batch was
    // abandoned - and then it is the difference between a caller who caught a
    // throw and a caller who caught a throw and still has three PHP instances
    // running.
    for (const child of children) child.abort()
  }
}
