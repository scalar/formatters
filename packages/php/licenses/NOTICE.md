# Third-party notices

`php_fmt.phar.br` is PHP CS Fixer's official phar, brotli-compressed and
otherwise unmodified. A phar is an archive, so unlike the compiled artifacts in
this repo's other packages the sources inside it are still readable — but they
are redistributed here all the same, so their licenses are reproduced as those
licenses require.

Fetched by `build/php_fmt/build.sh`; the version is pinned there and recorded in
`VERSIONS.json`.

| Component | License | Text |
|---|---|---|
| PHP CS Fixer | MIT | `php-cs-fixer-LICENSE` |
| `sebastian/diff` | BSD-3-Clause | `sebastian-diff-LICENSE` |
| Symfony components | MIT | see below |
| ReactPHP components | MIT | see below |
| PSR interfaces | MIT | see below |
| `composer/pcre`, `composer/semver`, `composer/xdebug-handler` | MIT | see below |
| `clue/ndjson-react`, `ergebnis/agent-detector`, `evenement/evenement`, `fidry/cpu-core-counter` | MIT | see below |

The phar bundles 40 packages. Every one is MIT except `sebastian/diff`, which is
BSD-3-Clause; both are reproduced in full in this directory. The MIT text is
identical across all of them bar the copyright line, so it is not repeated 39
times — `php-cs-fixer-LICENSE` is that text, and the copyright holders are:

- **Symfony** (`console`, `event-dispatcher`, `event-dispatcher-contracts`,
  `deprecation-contracts`, `filesystem`, `finder`, `options-resolver`,
  `process`, `service-contracts`, `stopwatch`, `string`, and the
  `polyfill-ctype`, `polyfill-intl-grapheme`, `polyfill-intl-normalizer`,
  `polyfill-mbstring`, `polyfill-php73`, `polyfill-php80`, `polyfill-php81`,
  `polyfill-php84` packages) — Copyright (c) Fabien Potencier
- **ReactPHP** (`cache`, `child-process`, `dns`, `event-loop`, `promise`,
  `socket`, `stream`) — Copyright (c) 2012 Igor Wiedler, Chris Boden
- **PSR** (`container`, `event-dispatcher`, `log`) — Copyright (c) PHP Framework
  Interop Group
- **Composer** (`pcre`, `semver`, `xdebug-handler`) — Copyright (c) Nils
  Adermann, Jordi Boggiano
- `clue/ndjson-react` — Copyright (c) Christian Lück
- `ergebnis/agent-detector` — Copyright (c) Andreas Möller
- `evenement/evenement` — Copyright (c) 2011 Igor Wiedler
- `fidry/cpu-core-counter` — Copyright (c) Théo Fidry

## What is not covered here

**PHP itself.** The fixer runs on PHP compiled to WebAssembly, but that PHP is
not in this package. It arrives as an ordinary npm dependency,
`@php-wasm/node-8-4`, which carries its own license (PHP is under the PHP
License v3.01) and is installed rather than redistributed. This is the one place
this package differs from the others in the repo, which embed their runtime in
the artifact they ship and therefore have to reproduce its license.

**The phar's own dependency list.** The phar strips the `composer.json` files of
the packages it bundles, so the component list above was resolved from
`vendor/composer/installed.php` inside the archive and checked against
Packagist, not read out of the tree.
