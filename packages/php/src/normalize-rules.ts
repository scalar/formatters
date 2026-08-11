import type { Rules } from './types'

/**
 * Turns the `rules` option into the associative array `Config::setRules()`
 * wants.
 *
 * An object is already that shape and passes through. A string is read the way
 * `--rules` reads it: a comma-separated list of names, each enabled, with a
 * leading `-` disabling instead. That syntax is the reason this is not just
 * `JSON.parse` - `'@PSR12'` is a perfectly good rules argument on the command
 * line and not valid JSON, and `setRules('@PSR12')` is a PHP TypeError.
 */
export const normalizeRules = (rules: Rules): Record<string, boolean | Record<string, unknown>> => {
  if (typeof rules !== 'string') return rules

  const entries = rules
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)

  if (entries.length === 0) {
    throw new TypeError('rules must name at least one rule or rule set, received an empty string')
  }

  return Object.fromEntries(entries.map((name) => (name.startsWith('-') ? [name.slice(1), false] : [name, true])))
}
