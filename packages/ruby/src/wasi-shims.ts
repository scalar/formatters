import { Directory, File, PreopenDirectory } from '@bjorn3/browser_wasi_shim'

/**
 * Stands in for the socket extension, which CRuby does not build for
 * wasm32-unknown-wasip1 because the platform has no Berkeley sockets.
 *
 * Nothing in a formatting call opens a connection, but RuboCop reaches this on
 * the way up regardless: `rubocop.rb` requires `rubocop/remote_config`
 * unconditionally, and 1.74 eagerly requires all 698 cop files, one of which
 * (`Style/IpAddresses`) requires resolv.
 *
 * These are the entry points net/http, resolv and openssl touch while loading.
 * With them in place those three load as *themselves* rather than as stubs,
 * which matters for more than tidiness: `Style/IpAddresses` matches against
 * `Resolv::IPv4::Regex`, and hand-copying that regex here would be a quiet
 * reimplementation of the thing this package promises not to reimplement.
 *
 * Every method raises rather than returning a plausible nil. A formatter that
 * cannot reach the network should say so, not behave as though a request
 * silently returned nothing.
 */
const SOCKET_RB = `# frozen_string_literal: true

class SocketError < StandardError
end

class BasicSocket < IO
  def initialize(*)
    raise NotImplementedError, "sockets are unavailable under WASI"
  end
end

class IPSocket < BasicSocket
  def self.getaddress(*)
    raise NotImplementedError, "sockets are unavailable under WASI"
  end
end

class TCPSocket < IPSocket
end

class TCPServer < TCPSocket
end

class UDPSocket < IPSocket
end

class UNIXSocket < BasicSocket
end

class Socket < BasicSocket
  module Constants
  end

  def self.getaddrinfo(*)
    raise NotImplementedError, "sockets are unavailable under WASI"
  end

  def self.gethostname
    raise NotImplementedError, "sockets are unavailable under WASI"
  end
end
`

/**
 * Stands in for the io/wait extension, which this build also lacks.
 *
 * resolv requires it, so it sits between RuboCop and a load error just as
 * socket does. The methods wait for a file descriptor to become ready, and the
 * only descriptors that ever needed waiting on here were sockets - so like the
 * socket shim, this exists to let the requires resolve and raises if anything
 * actually calls through.
 */
const IO_WAIT_RB = `# frozen_string_literal: true

class IO
  def wait(*)
    raise NotImplementedError, "IO#wait is unavailable under WASI"
  end

  def wait_readable(*)
    raise NotImplementedError, "IO#wait_readable is unavailable under WASI"
  end

  def wait_writable(*)
    raise NotImplementedError, "IO#wait_writable is unavailable under WASI"
  end

  def wait_priority(*)
    raise NotImplementedError, "IO#wait_priority is unavailable under WASI"
  end

  def ready?
    raise NotImplementedError, "IO#ready? is unavailable under WASI"
  end
end
`

/** Where the shims are mounted in the guest, and what the artifact's `$LOAD_PATH` ends with. */
export const SHIM_MOUNT_PATH = '/wasi-shims'

/**
 * The shims, keyed by their path under {@link SHIM_MOUNT_PATH}.
 *
 * Flat, and exported, because two things need this list and only one of them
 * can use a preopened directory. `createShimDirectory` below mounts them in a
 * running guest; `build/ruby_fmt/preinit.ts` writes them to a real directory so
 * that wizer can map it at the same path while it snapshots the VM - the
 * requires that reach these files happen inside that snapshot, so a shim
 * missing there is a build that fails rather than a runtime that copes.
 */
export const SHIM_FILES: ReadonlyMap<string, string> = new Map([
  ['socket.rb', SOCKET_RB],
  ['io/wait.rb', IO_WAIT_RB],
])

/**
 * Builds the preopened directory holding the shims above.
 *
 * A real directory of real Ruby files, rather than the tempting trick of
 * pushing invented paths onto `$LOADED_FEATURES` to make `require` believe the
 * work is done. That trick does not work: Ruby's loaded-features index only
 * honours an entry whose directory is itself on `$LOAD_PATH`, so the require
 * still raises and the failure looks like a Ruby bug rather than a missing
 * hack.
 *
 * `boot-vm.ts` *appends* this to `$LOAD_PATH` rather than prepending it, which
 * is the whole safety story: the real stdlib is searched first, so these files
 * are reachable only for the two features this build genuinely does not have.
 * Nothing here can shadow something real.
 */
export const createShimDirectory = (): PreopenDirectory => {
  const encoder = new TextEncoder()
  const root = new Map<string, Directory | File>()

  // One level of nesting, because one level is all {@link SHIM_FILES} has - the
  // only shim in a subdirectory is io/wait.rb, mirroring where the stdlib keeps
  // the extension it stands in for.
  for (const [shimPath, source] of SHIM_FILES) {
    const file = new File(encoder.encode(source))
    const separator = shimPath.lastIndexOf('/')

    if (separator === -1) {
      root.set(shimPath, file)
      continue
    }

    const parentName = shimPath.slice(0, separator)
    const parent = root.get(parentName)
    const directory = parent instanceof Directory ? parent : new Directory(new Map())

    directory.contents.set(shimPath.slice(separator + 1), file)
    root.set(parentName, directory)
  }

  return new PreopenDirectory(SHIM_MOUNT_PATH, root)
}
