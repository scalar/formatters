// Does nothing, so that the harness can price doing nothing.
//
// The cold-start rows time a whole `node` process, and part of that time is
// Node starting up and stripping the types off a TypeScript entry point -
// which has nothing to do with any formatter. Spawning this the same way
// gives the reader the constant to subtract.

export {}
