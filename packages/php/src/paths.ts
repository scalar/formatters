/**
 * Fixed locations inside the guest filesystem.
 *
 * They are constants rather than parameters because nothing about them is
 * per-call: the phar and the driver scripts are written once at boot, and the
 * input file is overwritten in place on every format. Keeping them here stops
 * the same literal path being spelled out in both TypeScript and PHP, where a
 * typo would surface as an empty `file_get_contents` rather than an error.
 */

/** Where the fixer runs. A directory, because Finder scans directories. */
export const SOURCE_DIR = '/work/src'

/** The one file in `SOURCE_DIR`. Named `.php` so the Finder's filter matches. */
export const INPUT_PATH = `${SOURCE_DIR}/input.php`

/** PHP CS Fixer itself, decompressed from the shipped artifact at boot. */
export const PHAR_PATH = '/work/php-cs-fixer.phar'

/** The driver script `format` executes on every call. */
export const FIXER_SCRIPT_PATH = '/work/fixer.php'

/** The driver script used to format several sources in one fixer invocation. */
export const BATCH_FIXER_SCRIPT_PATH = '/work/batch-fixer.php'

/**
 * The configuration file. The name matters: PHP CS Fixer resolves a config file
 * by path, and this is the name it documents.
 */
export const CONFIG_SCRIPT_PATH = '/work/.php-cs-fixer.php'

/** Per-call options, as JSON. Read by the config script, written by `format`. */
export const CONFIG_DATA_PATH = '/work/config.json'

/** Where the driver script leaves its outcome for `format` to read back. */
export const RESULT_PATH = '/work/result.json'

/** Sources and per-item outcomes for a batch format. */
export const BATCH_DATA_PATH = '/work/batch.json'
