// Verifies that PHP CS Fixer running on PHP/wasm produces byte-identical output
// to the same phar running on a native PHP.
//
// This one asserts rather than reports: the package IS PHP CS Fixer, so any
// divergence is a real bug - a behavioural difference between the wasm PHP
// build and a native one - not a known stylistic gap.
//
// The native side runs the *shipped artifact*, decompressed to a temp file,
// rather than a php-cs-fixer found on PATH. That is the whole point: a PATH copy
// would be some other version, and a version difference would show up here as a
// formatting divergence that has nothing to do with wasm. Same bytes, same
// rules, one variable - the PHP underneath.
//
// Skipped unless a native `php` is installed.
//
// All the samples go through a single native invocation, not one per sample.
// Booting PHP and loading the fixer's several hundred classes costs far more
// than formatting does, and doing it per sample makes this test slow enough to
// risk its timeout under load.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { format } from '../src/format'
import { readPhar } from '../src/read-phar'
import { describe, expect, it } from 'bun:test'

const nativeAvailable = (): boolean => {
  try {
    execFileSync('php', ['-r', 'exit(extension_loaded("Phar") ? 0 : 1);'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const SAMPLES: Record<string, string> = {
  'class with promoted properties': `<?php
namespace  App\\Service;
use   Psr\\Log\\LoggerInterface;
use App\\Repository\\UserRepository;
class   UserService implements \\Countable {
const   DEFAULT_LIMIT=25;
private array $cache=[];
public function __construct(private readonly UserRepository $users, protected ?LoggerInterface $log=null){}
public function count():int{ return count($this->cache); }
public function find(int $id, array $with=[]): ?object { return $this->users->find($id,$with); }
}`,
  'strict types and closures': `<?php declare(strict_types=1);
function collect(int ...$values): array {
  $doubled = array_map(fn($v) => $v*2, $values);
  foreach($values as $key=>$value){ if($value>10){continue;} $doubled[]=$value; }
  try { throw new \\RuntimeException("boom"); } catch (\\RuntimeException|\\LogicException $e) { }
  return $doubled;
}`,
  'enum and match': `<?php
enum Suit: string {
case Hearts='H';
case Spades='S';
public function color(): string { return match($this) { Suit::Hearts => 'Red', Suit::Spades => 'Black', }; }
}
interface  Shape { public function area(): float; }
trait Describable { public function describe(){ return static::class; } }`,
  heredoc: `<?php
function query(string $table): string {
  $sql = <<<SQL
    SELECT * FROM {$table}
    WHERE active = 1
    SQL;
  $plain = <<<'TXT'
    literal $notinterpolated
    TXT;
  return $sql . $plain;
}`,
  'control flow and arrays': `<?php
$config = ['retries'=>3,'backoff'=>1.5,'hosts'=>['a','b'],];
switch($config['retries']){
case 0: echo "none"; break;
case 1:
case 2: echo "few"; break;
default: echo "many";
}
$result = $config['retries'] <=> 2;
while($i ?? 0 < 3){ $i = ($i ?? 0) + 1; }
do { $j = 1; } while(false);`,
}

/**
 * Runs the shipped phar on native PHP over every sample at once, returning each
 * sample's formatted text.
 *
 * The samples land in their own directory and a `.php-cs-fixer.php` alongside
 * them mirrors the config the package builds, so both sides are configured by
 * the same class with the same values rather than by CLI flags on one side and
 * a `Config` on the other.
 */
const nativeAll = (samples: [string, string][]): string[] => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'php-fmt-conformance-'))

  try {
    const pharPath = path.join(dir, 'php-cs-fixer.phar')
    const sourceDir = path.join(dir, 'src')
    fs.writeFileSync(pharPath, readPhar())
    fs.mkdirSync(sourceDir)

    const files = samples.map(([, source], index) => {
      const file = path.join(sourceDir, `sample${index}.php`)
      fs.writeFileSync(file, source)
      return file
    })

    fs.writeFileSync(
      path.join(dir, '.php-cs-fixer.php'),
      `<?php
return (new PhpCsFixer\\Config('php-fmt'))
    ->setRules(['@PSR12' => true])
    ->setIndent('    ')
    ->setLineEnding("\\n")
    ->setRiskyAllowed(false)
    ->setUsingCache(false)
    ->setFinder(PhpCsFixer\\Finder::create()->in(${JSON.stringify(sourceDir)})->name('*.php'));
`,
    )

    execFileSync(
      'php',
      [pharPath, 'fix', `--config=${path.join(dir, '.php-cs-fixer.php')}`, '--no-interaction', '-q'],
      { cwd: dir, stdio: 'pipe' },
    )

    return files.map((file) => fs.readFileSync(file, 'utf8'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

describe('native-conformance', () => {
  it.skipIf(!nativeAvailable())('matches native php-cs-fixer byte for byte', async () => {
    const samples = Object.entries(SAMPLES)
    const native = nativeAll(samples)

    // Pair each sample with its native result up front. The empty-string
    // fallback can only be hit if the native run produced fewer results than we
    // sent, which no real formatting run matches - so it fails loudly here
    // rather than being silently skipped.
    const expectations = samples.map(([name, source], index) => ({
      name,
      source,
      expected: native[index] ?? '',
    }))

    for (const { name, source, expected } of expectations) {
      expect(await format(source), `diverged on: ${name}`).toBe(expected)
    }
  })
})
