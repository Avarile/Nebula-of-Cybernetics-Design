#!/usr/bin/env python3
"""Hold GamePlay/schema_coverage.md to the specs, the schemas and the verifiers.

The coverage matrix maps every mechanic -- every numbered section of the ten GamePlay
documents (gameplay_specification.md 4) and of the combat spec -- to the schemas it reads
or writes and the checks that hold it. The row list is not authored: it is the specs'
headings, and this verifier fails when they drift apart. What it enforces:

  1. every numbered section (## N. / ### N.M) has exactly one row, under its document,
     with the heading's own title; no row names a section that no longer exists
  2. every schema a row cites resolves: a Data-Templates/*.interface file, a type or
     const declared in Reference/*.ts, an UPPER_CASE constant of a tools/*.py table, or a
     top-level key of fleet_and_weapons.json
  3. every verifier a row cites exists, and every "quoted" check label it cites appears
     in one of those verifiers' sources -- the matrix cannot claim a check nobody wrote
  4. every status is one of held / typed / prose / partial / gap; a held row cites a
     verifier, a typed row a schema; a partial or gap row cites a gap (G<n>) the Gaps
     section defines, and every defined gap is cited
  5. every Data-Templates/*.interface is cited by some row -- no schema serves nothing

Run from anywhere:  python3 tools/verify_coverage.py
  --missing  print a stub row for every section the matrix lacks, ready to fill in
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MATRIX = os.path.join(ROOT, 'GamePlay', 'schema_coverage.md')
COMBAT = 'Combat-logic/combat_logic_specification.md'
STATUSES = ('held', 'typed', 'prose', 'partial', 'gap')
fails = []


def check(label, bad, show=8):
    if bad:
        fails.append(label); print(f'FAIL {label}: {len(bad)}')
        for b in bad[:show]: print('      ', b)
    else:
        print(f'ok   {label}')


# --------------------------------------------------------------------- the specs' sections
master = open(os.path.join(ROOT, 'GamePlay', 'gameplay_specification.md')).read()
sec4 = master.split('## 4. ', 1)[-1].split('\n## ', 1)[0]
DOCS = ['GamePlay/' + d for d in re.findall(r'^\| `([\w]+\.md)` \|', sec4, re.M)] + [COMBAT]
HEADING = re.compile(r'^#{2,3} (\d+(?:\.\d+)?)\.? (.+?)\s*$', re.M)
sections = {}          # (doc basename, sec) -> title
for d in DOCS:
    for sec, title in HEADING.findall(open(os.path.join(ROOT, d)).read()):
        sections[(os.path.basename(d), sec)] = title

# --------------------------------------------------------------------- the matrix
text = open(MATRIX).read() if os.path.exists(MATRIX) else ''
rows, dup = {}, []
for block in re.split(r'^### ', text, flags=re.M)[1:]:
    m = re.match(r'`([\w]+\.md)`', block)
    if not m:
        continue
    doc = m.group(1)
    for cells in re.findall(r'^\| ([\d.]+) \|(.*)\|\s*$', block, re.M):
        sec, rest = cells
        parts = [c.strip() for c in rest.split(' | ')]
        if len(parts) != 4:
            dup.append(f'{doc} {sec}: {len(parts) + 1} cells, want 5'); continue
        if (doc, sec) in rows:
            dup.append(f'{doc} {sec}: two rows')
        rows[(doc, sec)] = dict(zip(('title', 'schemas', 'checks', 'status'), parts))

if '--missing' in sys.argv:
    for (doc, sec), title in sorted(sections.items()):
        if (doc, sec) not in rows:
            print(f'{doc}: | {sec} | {title} | — | — | gap G? |')
    sys.exit(0)

check('the matrix exists and parses (5 cells a row, one row a section)',
      ([] if rows else ['no rows -- GamePlay/schema_coverage.md missing or empty']) + dup)
check(f'every numbered section of the {len(DOCS)} documents has a row ({len(sections)} sections)',
      [f'{d} {s} "{t}" -- run verify_coverage.py --missing' for (d, s), t in sorted(sections.items())
       if (d, s) not in rows])
check('no row names a section that no longer exists',
      [f'{d} {s}' for d, s in sorted(rows) if (d, s) not in sections])
check('every row carries its section\'s own title',
      [f'{d} {s}: "{r["title"]}" != "{sections[(d, s)]}"' for (d, s), r in sorted(rows.items())
       if (d, s) in sections and r['title'] != sections[(d, s)]])

# --------------------------------------------------------------------- schemas resolve
TS = ''.join(open(os.path.join(ROOT, 'Reference', f)).read()
             for f in os.listdir(os.path.join(ROOT, 'Reference')) if f.endswith('.ts'))
TOOLS = ''.join(open(os.path.join(ROOT, 'tools', f)).read()
                for f in os.listdir(os.path.join(ROOT, 'tools')) if f.endswith('.py'))
FLEET_KEYS = set(json.load(open(os.path.join(ROOT, 'fleet_and_weapons.json'))))
IFACES = {f for f in os.listdir(os.path.join(ROOT, 'Data-Templates')) if f.endswith('.interface')}


def resolves(tok):
    if tok.endswith('.interface'):
        return tok in IFACES
    if re.fullmatch(r'[A-Z][A-Z0-9_]+', tok):     # a table constant, or its Reference mirror
        return (re.search(rf'^{tok}\s*=', TOOLS, re.M) is not None
                or re.search(rf'\bconst\s+{tok}\b', TS) is not None)
    if re.fullmatch(r'[A-Z]\w*', tok):
        return re.search(rf'\b(?:interface|type|const)\s+{tok}\b', TS) is not None
    return tok in FLEET_KEYS


cited = set()
bad = []
for (d, s), r in sorted(rows.items()):
    for tok in re.findall(r'`([^`]+)`', r['schemas']):
        cited.add(tok)
        if not resolves(tok):
            bad.append(f'{d} {s}: `{tok}`')
check('every cited schema resolves (an .interface, a Reference type, a table constant, a fleet key)', bad)

# --------------------------------------------------------------------- checks exist
VERIFIERS = {f: os.path.join(ROOT, 'tools', f) for f in os.listdir(os.path.join(ROOT, 'tools'))
             if f.startswith('verify_') and f.endswith('.py')}
VERIFIERS['verify_reference.py'] = os.path.join(ROOT, 'Reference', 'verify_reference.py')
SRC = {f: open(p).read() for f, p in VERIFIERS.items()}
bad = []
for (d, s), r in sorted(rows.items()):
    files = re.findall(r'`([^`]+)`', r['checks'])
    for f in files:
        if f not in VERIFIERS:
            bad.append(f'{d} {s}: `{f}` is not a verifier')
    for frag in re.findall(r'"([^"]+)"', r['checks']):
        if not any(frag in SRC.get(f, '') for f in files):
            bad.append(f'{d} {s}: "{frag}" appears in none of {files}')
check('every cited verifier exists and every quoted check label is in one of them', bad)

# --------------------------------------------------------------------- statuses and gaps
gaps_text = text.split('\n## Gaps', 1)[-1].split('\n## ', 1)[0] if '\n## Gaps' in text else ''
defined = set(re.findall(r'^\*\*(G\d+)\.', gaps_text, re.M))
used, bad = set(), []
for (d, s), r in sorted(rows.items()):
    status = r['status'].split()[0] if r['status'] else ''
    if status not in STATUSES:
        bad.append(f'{d} {s}: status "{r["status"]}"'); continue
    g = set(re.findall(r'\bG\d+\b', r['status']))
    used |= g
    if status in ('partial', 'gap') and not g:
        bad.append(f'{d} {s}: {status} without a gap id')
    if status == 'held' and not re.search(r'`verify_\w+\.py`', r['checks']):
        bad.append(f'{d} {s}: held, but cites no verifier')
    if status == 'typed' and not re.search(r'`[^`]+`', r['schemas']):
        bad.append(f'{d} {s}: typed, but cites no schema')
check('every status is legal; held rows cite a verifier, typed rows a schema, partial and gap rows a gap', bad)
check('every gap a row cites is defined in the Gaps section, and every defined gap is cited',
      [f'{g}: cited, not defined' for g in sorted(used - defined)]
      + [f'{g}: defined, never cited' for g in sorted(defined - used)])

check('every Data-Templates/*.interface is cited by some row',
      sorted(IFACES - cited))

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} CHECK(S) FAILED'))
sys.exit(1 if fails else 0)
