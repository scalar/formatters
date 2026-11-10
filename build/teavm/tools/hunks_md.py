"""Write HUNKS.md: every hunk of the fork diff, where it went, and the line-coverage evidence."""
import json, sys
cov_path, out_path = sys.argv[1:3]
hunks = [json.loads(l) for l in open(cov_path)]

P = {  # patch number -> (short name, upstream plan)
    '0001': ('Collectors.joining', 'PR C1'),
    '0002': ('proxy static-method skip', 'PR C2'),
    '0003': ('regex `\\R`', 'PR C3'),
    '0004': ('regex `\\p{IsAlphabetic}`', 'PR C4'),
    '0005': ('StringBuilder.repeat', 'PR C5'),
    '0006': ('File.toPath', 'PR C6'),
    '0007': ('Spliterators', 'PR C7'),
    '0008': ('Charset.forName key', 'PR C8'),
    '0009': ('ClassInitElimination', 'issue first, with reproducer'),
    '0010': ('UTF-32, windows-1251', 'later: ask about code pages in an issue'),
    '0011': ('system properties', 'later: ask per-backend values'),
    '0012': ('Character.UnicodeBlock', 'later, one PR per class'),
    '0013': ('Class / ClassLoader', 'later, one PR per class'),
    '0014': ('Thread.State', 'later: getState must report real states'),
    '0015': ('java.lang.invoke stubs', 'issue: polymorphic signatures need compiler support'),
    '0016': ('Locale.forLanguageTag', 'later, one PR per class'),
    '0017': ('ResourceBundle.Control', 'later, one PR per class'),
    '0018': ('ConcurrentHashMap.KeySetView', 'later, one PR per class'),
    '0019': ('FileSystemProvider.newFileChannel', 'later, one PR per class'),
    '0020': ('br_on_null depth reset', 'not planned: rejected in #1224 as defensive'),
}
C = 'classlib/src/main/java/org/teavm/classlib/java/'
T = 'tests/src/test/java/org/teavm/classlib/java/'
by_file = {
    C + 'util/stream/TCollectors.java': 'patch 0001 (rewritten)',
    T + 'util/stream/CollectorsTest.java': 'patch 0001',
    'core/src/main/java/org/teavm/reflection/ProxyDependencySupport.java': 'patch 0002',
    C + 'util/regex/TLexer.java': 'patch 0003',
    C + 'util/regex/TAbstractCharClass.java': 'patch 0004',
    T + 'util/regex/PatternTest.java': 'patch 0003 + 0004',
    C + 'lang/TStringBuilder.java': 'patch 0005', T + 'lang/StringBuilderTest.java': 'patch 0005',
    C + 'io/TFile.java': 'patch 0006', T + 'io/FileTest.java': 'patch 0006',
    C + 'util/TSpliterators.java': 'patch 0007', T + 'util/SpliteratorsTest.java': 'patch 0007',
    C + 'nio/charset/TCharset.java': 'patch 0008 + 0010',
    'core/src/main/java/org/teavm/model/optimization/ClassInitElimination.java': 'patch 0009',
    C + 'nio/charset/TStandardCharsets.java': 'patch 0010',
    C + 'lang/TSystem.java': 'patch 0011', T + 'lang/SystemTest.java': 'patch 0011',
    C + 'lang/TCharacter.java': 'patch 0012',
    C + 'lang/TClass.java': 'patch 0013', C + 'lang/TClassLoader.java': 'patch 0013',
    C + 'lang/TThread.java': 'patch 0014',
    C + 'lang/invoke/TMethodHandle.java': 'patch 0015', C + 'lang/invoke/TMethodHandles.java': 'patch 0015',
    C + 'lang/invoke/TMethodType.java': 'patch 0015',
    C + 'util/TLocale.java': 'patch 0016',
    C + 'util/TResourceBundle.java': 'patch 0017',
    C + 'util/concurrent/TConcurrentHashMap.java': 'patch 0018',
    C + 'nio/file/spi/TFileSystemProvider.java': 'patch 0019',
    'core/src/main/java/org/teavm/backend/wasm/transformation/CoroutineTransformation.java': 'dropped',
    'core/src/main/java/org/teavm/backend/wasm/generate/classes/WasmGCClassGenerator.java': 'dropped',
}
notes = {
    'dropped': 'rejected upstream as defensive (#1224 review); keep only if a failing program shows up',
}
rows = []
for i, h in enumerate(hunks, 1):
    f = h['file']
    dest = by_file.get(f)
    if f.endswith('WasmTypeInference.java'):
        dest = 'dropped (comment only)' if h['code_in_patches'] == 0 and h['code_missing'] == 0 else 'patch 0020'
    elif f.startswith(C + 'nio/charset/impl/'):
        dest = 'patch 0010'
    elif dest is None and f.startswith(C) and h['removed'] == 0:
        dest = 'shim'
    if dest is None:
        sys.exit('unassigned hunk: %s:%d' % (f, h['line']))
    nums = [w for w in dest.replace('+', ' ').split() if w.isdigit()]
    upstream = ' / '.join(P[n][1] for n in nums) if nums else ('—' if dest == 'shim' else 'not planned')
    code = h['added'] - h['comment_lines']
    evidence = ('not carried' if dest.startswith('dropped') else '%d/%d code lines in %s' % (h['code_in_patches'] + h['code_in_shims'],
            h['code_in_patches'] + h['code_in_shims'] + h['code_missing'],
            'shims' if dest == 'shim' else 'patches'))
    if h['comment_lines']:
        evidence += '; %d comment lines not compared' % h['comment_lines']
    if h['code_missing']:
        evidence += ('; for example ' if dest.startswith('dropped') else '; not carried: ') + '`' + '`, `'.join(m.replace('|', '\\|') for m in h['missing'][:2]) + '`' + \
            (' …' if h['code_missing'] > 2 else '')
    short = f.replace(C, 'classlib/…/java/').replace(T, 'tests/…/java/').replace('core/src/main/java/org/teavm/', 'core/…/')
    rows.append('| %d | `%s` | %d | +%d −%d | %s | %s | %s |' % (
        i, short, h['line'], h['added'], h['removed'], dest, upstream, evidence))

counts = {}
for r in rows:
    d = r.split(' | ')[4]
    k = 'shim' if d == 'shim' else ('dropped' if d.startswith('dropped') else 'patch')
    counts[k] = counts.get(k, 0) + 1

out = ['# Where every hunk of the fork went', '',
       'Generated from `git diff upstream/master origin/master` with `upstream/master` at `bbc601c` and',
       '`amritk/teavm` `master` at `152a9c3`: 78 files, +3,428/−27, %d hunks. Of those, %d went to a patch,' % (
           len(rows), counts.get('patch', 0)),
       '%d to the shims and %d were dropped. No hunk is unassigned: the generator refuses to write' % (
           counts.get('shim', 0), counts.get('dropped', 0)),
       'the table otherwise.', '',
       'The **evidence** column is checked, not asserted. For each non-comment line a hunk adds, the',
       'checker looks for the same line in the patched upstream tree or, for a shim, in the shim source',
       'after the package rename (`org.teavm.classlib.java.` → `com.scalar.teavm.shims.java.`). A line',
       'found in neither is listed. Every such line is a deliberate change: the dropped hunks, the',
       '`Collectors.joining` fix rewritten as four lines, and the proxy check folded into the existing',
       '`BRIDGE` condition. Comment lines (license headers included) are not compared: the patches trim the fork\'s',
       'explanatory comments, as the upstream review asked, while the shims keep theirs.', '',
       '"PR C*n*" is item *n* of section C of the migration brief: a small upstream PR, drafted in',
       '`upstream/`, not opened.', '',
       'To regenerate, with a fork clone that has `upstream` as a remote and `toolchain/teavm` from',
       '`./apply.sh --apply-only`:', '',
       '```bash',
       'python3 -I tools/hunk_coverage.py <fork-clone> toolchain/teavm shims/src/main/java > /tmp/coverage.jsonl',
       '```', '',
       '```bash',
       'python3 -I tools/hunks_md.py /tmp/coverage.jsonl HUNKS.md',
       '```', '',
       '| # | File | Line | Size | Destination | Upstream | Evidence |',
       '|---|---|---|---|---|---|---|'] + rows + ['', '## Patches', '',
       '| Patch | Change | Upstream |', '|---|---|---|'] + [
       '| %s | %s | %s |' % (n, name, plan) for n, (name, plan) in P.items()] + ['', '## Dropped', '',
       '- `CoroutineTransformation`: the `try`/`finally` reset of per-function state. Only reachable after an',
       '  internal compiler error, and rejected as defensive in the #1224 review.',
       '- `WasmGCClassGenerator.staticInitialValue`: emitting the global\'s own default rather than a',
       '  string-typed null. The fork\'s own commit called it defensive rather than a reproducible failure.',
       '- The `WasmTypeInference` javadoc on `getDepthBeforeLastInstructionOut`. The code half of that hunk',
       '  is patch 0020, which the same review rejected; it is last in the series so it drops cleanly.',
       '']
open(out_path, 'w').write('\n'.join(out))
print(len(rows), counts)
