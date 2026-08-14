import { formatBatch } from './format-batch'
import type { PoolReply, PoolRequest } from './pool-protocol'

/**
 * One PHP instance in the pool, formatting the shard its parent sends it.
 *
 * A child process rather than a worker thread, and the difference is not
 * cosmetic: several PHP instances in one process barely go faster than one,
 * however many cores are free, while the same instances in separate processes
 * scale close to linearly. Measured on a four-core machine, 200 generated files
 * took 22.0s in one process and 7.0s across four - where four worker threads in
 * a single process managed 13.8s. Whatever the contended resource is inside the
 * engine, a process boundary is what gets past it.
 */

if (!process.send) {
  throw new Error('pool-child is a child process entry point and cannot be run on its own')
}

const send = process.send.bind(process)

const run = async (request: PoolRequest): Promise<PoolReply> => {
  try {
    const results = await formatBatch(request.sources, request.options)

    return {
      status: 'ok',
      results: results.map((result) =>
        typeof result === 'string'
          ? { status: 'ok', source: result }
          : { status: 'error', name: result.name, message: result.message },
      ),
    }
  } catch (error) {
    // A throw here is the batch failing as a whole - PHP itself falling over,
    // rather than one file being unformattable. The parent reformats the shard
    // instead of failing the batch, so this only has to be reported.
    return { status: 'failed', message: error instanceof Error ? error.message : String(error) }
  }
}

process.on('message', (request: PoolRequest) => {
  void (async () => {
    const reply = await run(request)

    // Disconnect once the reply is genuinely on the wire. That releases the only
    // handle keeping this process alive, so a child whose parent died exits by
    // itself rather than lingering with a booted PHP in it.
    send(reply, undefined, undefined, () => process.disconnect?.())
  })()
})

// The parent waits for this before sending a shard, because a message that
// arrives before the listener above is attached would be dropped.
send({ status: 'ready' } satisfies PoolReply)
