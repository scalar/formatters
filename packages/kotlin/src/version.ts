/**
 * The ktfmt release this package carries.
 *
 * It is here because "exact against ktfmt 0.64" is a claim about a named
 * version, and a consumer that re-checks its own bytes with the native jar has
 * to install the same one. Without this they hardcode the number beside their
 * pin of this package, and the two drift the first time either moves.
 *
 * `KTFMT_VERSION` in build/java_fmt_teavm/kotlin-probe/ktfmt.sh is what the
 * artifact is actually compiled from; this restates it, and version.test.ts
 * reads the script and fails if the two disagree.
 */
export const ktfmtVersion = '0.64'
