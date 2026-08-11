// Deliberately empty.
//
// SwiftPM needs an entry point to link an executable target, but this module is
// built with -mexec-model=reactor, so `main` is never called - the host
// instantiates the module, the runtime's `_initialize` runs, and `run` is
// called per format. See format.swift, which is where the code lives.
//
// Nothing may be added here. Top-level code in main.swift *is* main, so under
// the reactor model it never executes: file-scope `let`s in this file are never
// initialised, and reading one yields zeroed memory rather than its value. That
// failure is silent and confusing - integer constants read as 0 and strings
// read as empty - which is why format.swift is a separate file, where globals
// are initialised lazily on first access like any other Swift global.
