"""For every hunk of `git diff upstream/master origin/master`, check where its non-comment added lines ended up.

usage: python3 -I hunk_coverage.py <fork-clone> <patched-tree> <shims-src-root>
Prints one JSON object per hunk: file, new-side start line, line counts, and how many added lines are found in
the patched tree, in the shims (after the package rename), or nowhere.
"""
import json, os, re, subprocess, sys

fork, patched, shims = sys.argv[1:4]
diff = subprocess.run(['git', 'diff', 'upstream/master', 'origin/master'], cwd=fork,
                      capture_output=True, text=True, check=True).stdout
COMMENT = re.compile(r'^\s*(//|/\*\*|/\*|\*/|\*(\s|$))')
CLASSLIB = 'classlib/src/main/java/org/teavm/classlib/'

def norm(line):
    return line.strip().replace('org.teavm.classlib.java.', 'X.java.').replace('com.scalar.teavm.shims.java.', 'X.java.')

cache = {}
def lines_of(path):
    if path not in cache:
        cache[path] = set(norm(l) for l in open(path, encoding='utf-8')) if os.path.isfile(path) else set()
    return cache[path]

hunks, cur, path = [], None, None
for line in diff.splitlines():
    if line.startswith('diff --git'):
        path = line.split(' b/', 1)[1]
    elif line.startswith('@@'):
        m = re.match(r'@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@', line)
        cur = {'file': path, 'line': int(m.group(1)), 'added': [], 'removed': 0}
        hunks.append(cur)
    elif cur and line.startswith('+') and not line.startswith('+++'):
        cur['added'].append(line[1:])
    elif cur and line.startswith('-') and not line.startswith('---'):
        cur['removed'] += 1

for h in hunks:
    f = h['file']
    shim = None
    if f.startswith(CLASSLIB):
        shim = os.path.join(shims, 'com/scalar/teavm/shims', f[len(CLASSLIB):])
    in_patch = in_shim = missing = comments = blank = 0
    missing_lines = []
    for a in h['added']:
        if not a.strip():
            blank += 1
        elif COMMENT.match(a):
            comments += 1
        elif norm(a) in lines_of(os.path.join(patched, f)):
            in_patch += 1
        elif shim and norm(a) in lines_of(shim):
            in_shim += 1
        else:
            missing += 1
            missing_lines.append(a.strip())
    print(json.dumps({'file': f, 'line': h['line'], 'added': len(h['added']), 'removed': h['removed'],
                      'code_in_patches': in_patch, 'code_in_shims': in_shim, 'comment_lines': comments,
                      'code_missing': missing, 'missing': missing_lines[:6]}))
