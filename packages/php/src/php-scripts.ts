import { CONFIG_DATA_PATH, CONFIG_SCRIPT_PATH, INPUT_PATH, PHAR_PATH, RESULT_PATH, SOURCE_DIR } from './paths'

/**
 * The two PHP scripts that drive the fixer. Both are written once at boot and
 * never regenerated, which is the whole reason they are safe: the only values
 * interpolated into them are this package's own path constants, so no
 * caller-controlled string is ever compiled as PHP source.
 *
 * Everything a caller supplies - rules, indent, line ending - travels as JSON
 * through `CONFIG_DATA_PATH` and is read with `json_decode`. That matters more
 * than it looks. Rules are arbitrary nested structures, and a rule name built
 * into PHP source could close the literal it sits in; as data it is inert
 * whatever it contains.
 */

/**
 * The configuration file, in the form PHP CS Fixer expects: a script returning
 * a `Config`. Using the tool's own configuration object rather than passing
 * flags is what makes `indent` and `lineEnding` behave exactly as they would in
 * a project's `.php-cs-fixer.php`, because it is the same class doing the work.
 */
export const CONFIG_SCRIPT = `<?php

$options = json_decode(file_get_contents('${CONFIG_DATA_PATH}'), true);

return (new PhpCsFixer\\Config('php-fmt'))
    ->setRules($options['rules'])
    ->setIndent($options['indent'])
    ->setLineEnding($options['lineEnding'])
    ->setRiskyAllowed($options['riskyAllowed'])
    ->setUsingCache(false)
    ->setFinder(PhpCsFixer\\Finder::create()->in('${SOURCE_DIR}')->name('*.php'));
`

/**
 * The driver. It runs PHP CS Fixer's own `Application` against the `fix`
 * command - the same entry point the `php-cs-fixer` executable reaches - rather
 * than assembling a `Runner` by hand. Two reasons: the pipeline around the
 * fixers (config resolution, linting, the differ) is part of what the tool is,
 * and `Runner`'s constructor signature changes between minor versions while the
 * command's does not.
 *
 * It is invoked in-process instead of by executing the phar, because the CLI
 * SAPI is one-shot - a second `cli()` call on the same instance silently does
 * nothing (see `boot-php.ts`).
 */
export const FIXER_SCRIPT = `<?php

$source = file_get_contents('${INPUT_PATH}');

// PHP CS Fixer skips a file it cannot parse and still exits zero, which would
// hand the caller their own input back and call it formatted. Reject it up
// front using the same check the tool's TokenizerLinter makes.
try {
    token_get_all($source, TOKEN_PARSE);
} catch (ParseError $e) {
    file_put_contents('${RESULT_PATH}', json_encode([
        'status' => 'parse-error',
        'message' => $e->getMessage(),
        'line' => $e->getLine(),
    ]));

    return;
}

require 'phar://${PHAR_PATH}/vendor/autoload.php';

$application = new PhpCsFixer\\Console\\Application();
$application->setAutoExit(false);

$input = new Symfony\\Component\\Console\\Input\\ArrayInput([
    'command' => 'fix',
    '--config' => '${CONFIG_SCRIPT_PATH}',
    '--show-progress' => 'none',
    '--format' => 'json',
]);
$input->setInteractive(false);

// Buffered rather than written out: the fixer's report and any rendered
// exception are the diagnostics we hand back on failure, and there is no
// stdout worth the name in this SAPI anyway.
$output = new Symfony\\Component\\Console\\Output\\BufferedOutput();
$exit = $application->run($input, $output);

file_put_contents('${RESULT_PATH}', json_encode([
    'status' => 0 === $exit ? 'ok' : 'failed',
    'exit' => $exit,
    'output' => $output->fetch(),
]));
`
