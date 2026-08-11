// swift-tools-version: 6.0
import PackageDescription

// Wraps the SwiftFormat library in a WASI reactor module. swift-format itself
// is cloned next to this file by build.sh, at the tag pinned there, and
// referenced by path so the build never resolves a floating version.
//
// The CLI target is deliberately not built: it imports Dispatch, which the WASI
// SDK does not provide. See Sources/swift_fmt/main.swift.
let package = Package(
  name: "swift_fmt",
  products: [
    .executable(name: "swift_fmt", targets: ["swift_fmt"])
  ],
  dependencies: [
    .package(path: "swift-format")
  ],
  targets: [
    .executableTarget(
      name: "swift_fmt",
      dependencies: [
        .product(name: "SwiftFormat", package: "swift-format")
      ]
    )
  ]
)
