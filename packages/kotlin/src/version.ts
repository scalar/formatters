/**
 * The ktfmt release this package formats like.
 *
 * It is here because "byte-identical to ktfmt 0.65" is a claim about a named
 * version, and a consumer that re-checks its own bytes with the native jar has
 * to install the same one. Without this they hardcode the number beside their
 * pin of this package, and the two drift the first time either moves.
 *
 * It is the release ktrs ports, not something compiled in: the artifact is
 * ktrs, which reimplements ktfmt. `KTFMT_VERSION` in build/kotlin_fmt/build.sh
 * is the pin; this restates it, and version.test.ts fails if the two disagree.
 */
export const ktfmtVersion = '0.65'

/**
 * The ktrs release the artifact is compiled from - the implementation, where
 * `ktfmtVersion` names the reference it is held to. `KTRS_VERSION` in
 * build/kotlin_fmt/build.sh is the pin, checked the same way.
 */
export const ktrsVersion = '0.5.3'
