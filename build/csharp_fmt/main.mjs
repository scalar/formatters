// Placeholder the SDK requires and the package would never ship.
//
// A browser-wasm project must name a WasmMainJSPath, and the SDK copies that
// file into the bundle. Nothing loads it here: a consumer of the package boots
// the module through the runtime's own dotnet.js and calls the JSExport
// directly, so this exists only to satisfy the build.
export {}
