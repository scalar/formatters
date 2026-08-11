// The Swift half of @scalar/swift-fmt: swift-format's own formatting entry
// point, exposed to JavaScript as a WASI reactor export.
//
// Why a wrapper at all, when the reference tool is a CLI we could have compiled
// whole: `swift-format`'s executable target imports Dispatch, and the WASI SDK
// ships no libdispatch, so the CLI cannot be built for wasm at all. The
// SwiftFormat library it is built on compiles cleanly, which is what this uses.
//
// That is a smaller divergence than it sounds. `swift-format format <file>`
// resolves a configuration and then calls exactly the SwiftFormatter method
// below - see FormatFrontend.processFile - with no additional pipeline steps.
// The one behaviour deliberately left out is walking the filesystem for a
// `.swift-format` file, because there is no filesystem here to walk: the host
// passes the resolved configuration in instead.
//
// A reactor rather than a command module: the module is instantiated once and
// `run` is called per format, which measured 2.5x faster than rebuilding the
// 51MB memory image every call, with byte-identical output over 442 files and
// linear memory that plateaus instead of growing.
//
// This lives here rather than in main.swift on purpose - see the note there.
// Under the reactor model main.swift's top-level code never runs, so anything
// declared at file scope in *that* file is never initialised.

import Foundation
import SwiftFormat

/// Paths in the preopened `/work` directory, which the host writes before each
/// call and reads after. They are fixed because a reactor export takes no
/// arguments, and passing pointers into linear memory would buy nothing here -
/// the shim's in-memory filesystem never touches disk either way.
private let inputPath = "/work/input.swift"
private let outputPath = "/work/output.swift"
private let configPath = "/work/config.json"

/// Status codes `run` returns. The host maps these to error messages, so the
/// distinctions exist to make a failure diagnosable rather than to be exhaustive.
private let statusOK: Int32 = 0
private let statusUnreadableInput: Int32 = 1
private let statusInvalidConfiguration: Int32 = 2
private let statusFormatFailed: Int32 = 3
private let statusUnwritableOutput: Int32 = 4

/// Writes a message where the host can read it, on the shim's captured stderr.
///
/// The trailing newline matters: the host reads stderr through a line-buffered
/// stream, so a message without one is held in the buffer and never arrives.
private func emit(_ message: String) {
  FileHandle.standardError.write(Data("\(message)\n".utf8))
}

/// Formats `/work/input.swift` into `/work/output.swift`.
///
/// Exported to JavaScript. Every failure returns a status rather than trapping,
/// because a trap would poison the shared instance for every later call.
@_cdecl("run")
public func run() -> Int32 {
  guard let sourceData = FileManager.default.contents(atPath: inputPath),
    let source = String(data: sourceData, encoding: .utf8)
  else {
    emit("unable to read the source that was handed to the module")
    return statusUnreadableInput
  }

  var configuration = Configuration()
  if let configData = FileManager.default.contents(atPath: configPath), !configData.isEmpty {
    do {
      configuration = try JSONDecoder().decode(Configuration.self, from: configData)
    } catch {
      emit("invalid configuration: \(error)")
      return statusInvalidConfiguration
    }
  }

  // Parser diagnostics are collected rather than printed as they arrive: on a
  // syntax error swift-format throws after emitting them, and the host wants
  // the diagnostics as the error message rather than as stray output.
  var diagnostics: [String] = []
  var formatted = ""

  do {
    let formatter = SwiftFormatter(configuration: configuration, findingConsumer: nil)
    try formatter.format(
      source: source,
      assumingFileURL: URL(fileURLWithPath: "<stdin>"),
      selection: .infinite,
      to: &formatted
    ) { diagnostic, location in
      diagnostics.append("\(location.line):\(location.column): \(diagnostic.message)")
    }
  } catch {
    emit(diagnostics.isEmpty ? "\(error)" : diagnostics.joined(separator: "\n"))
    return statusFormatFailed
  }

  guard FileManager.default.createFile(atPath: outputPath, contents: Data(formatted.utf8)) else {
    emit("unable to write the formatted result")
    return statusUnwritableOutput
  }

  return statusOK
}
