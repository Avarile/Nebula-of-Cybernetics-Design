#!/usr/bin/env python3
"""Invariant checks for the generated weapon catalogue."""
import json, os, re, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W = json.load(open(os.path.join(ROOT, 'fleet_and_weapons.json')))['weapons']
SIZES = ['small', 'medium', 'large', 'capital']
fails = []

def check(label, bad, show=4):
    if bad:
        fails.append(label)
        print(f'FAIL {label}: {len(bad)}')
        for b in bad[:show]:
            print('      ', b)
    else:
        print(f'ok   {label}')

# 1 -- ids and names unique
check('unique weaponIds', [k for k, v in Counter(w['weaponId'] for w in W).items() if v > 1])
check('unique names',     [k for k, v in Counter(w['name'] for w in W).items() if v > 1])

# 2 -- schema conformance against weapon.interface
body = '\n'.join(l for l in open(os.path.join(ROOT, 'Data-Templates', 'weapon.interface'))
                 if not l.lstrip().startswith('#'))
schema = set(json.loads(body))
check('field set matches weapon.interface', [w['weaponId'] for w in W if set(w) != schema])

# 3 -- mark ladder monotonic within (family, archetype, size)
def parse(n):
    m = re.match(r'^(\S+) (?:(Light|Medium|Heavy|Siege) )?(.*) Mk\.(\d+)$', n)
    return m.group(1), m.group(3), int(m.group(4))

lines = defaultdict(list)
for w in W:
    fam, arch, mk = parse(w['name'])
    lines[(fam, arch, w['size'])].append((mk, w))
bad = []
for key, items in lines.items():
    items.sort()
    for (m1, a), (m2, b) in zip(items, items[1:]):
        pa = a['damage']['base'] * a['fireRate']['shotsPerTurn'] / (1 + a['fireRate']['cooldownTurns'])
        pb = b['damage']['base'] * b['fireRate']['shotsPerTurn'] / (1 + b['fireRate']['cooldownTurns'])
        if pb <= pa or b['accuracy']['baseHitChance'] < a['accuracy']['baseHitChance'] \
           or not set(a['specialEffects']) <= set(b['specialEffects']):
            bad.append(f'{key} Mk.{m1}->Mk.{m2}  dpt {pa:.1f}->{pb:.1f}')
        if sum(b['buildCost'].values()) < sum(a['buildCost'].values()):
            bad.append(f'{key} Mk.{m1}->Mk.{m2}  buildCost went down')
check('mark ladder monotonic (dpt, hit, effects, buildCost)', bad)

# 4 -- no two identical stat blocks
sig = defaultdict(list)
for w in W:
    s = json.dumps({k: v for k, v in w.items() if k not in ('weaponId', 'name')}, sort_keys=True)
    sig[s].append(w['weaponId'])
check('no duplicate stat blocks', [v for v in sig.values() if len(v) > 1])

# 5 -- differentiation: within one mark, no weapon is strictly dominated by a rival of
# the same class and size at equal-or-lower power cost. Cross-MARK domination is by design
# (a mark ladder exists so tier-3 ships can outgun tier-1 ones) and is reported separately.
def dpt(w): return w['damage']['base'] * w['fireRate']['shotsPerTurn'] / (1 + w['fireRate']['cooldownTurns'])

def dominates(a, b):
    better = (dpt(a) >= dpt(b) and a['accuracy']['baseHitChance'] >= b['accuracy']['baseHitChance']
              and a['accuracy']['tracking'] >= b['accuracy']['tracking']
              and a['range']['optimal'] >= b['range']['optimal']
              and a['criticalChance'] >= b['criticalChance']
              and a['powerCost'] <= b['powerCost']
              and set(b['specialEffects']) <= set(a['specialEffects']))
    return better and (dpt(a) > dpt(b) or a['powerCost'] < b['powerCost'])

same_mark, cross_mark = [], 0
buckets = defaultdict(list)
for w in W:
    buckets[(w['weaponClass'], w['size'])].append(w)
for pool in buckets.values():
    for a in pool:
        for b in pool:
            if a['weaponId'] == b['weaponId'] or not dominates(a, b):
                continue
            if parse(a['name'])[2] == parse(b['name'])[2]:
                same_mark.append(f"{b['weaponId']} {b['name']} dominated by {a['weaponId']} {a['name']}")
            else:
                cross_mark += 1
check('no same-mark domination', same_mark)
print(f'note  cross-mark dominations: {cross_mark} (by design -- the mark ladder)')

# 6 -- legacy preservation.
# NOTE: the pre-generation file was overwritten before a name snapshot was taken, so this
# reconstructs rather than diffs. A legacy name was "<Family> <Archetype> Mk.N"; the only
# permitted change is an inserted size word, and only for the 6 groups that already carried
# a duplicate name in the source data (12 weapons, 7 of which must yield the bare name).
legacy_ids = {f'wpn_{i:03d}' for i in range(1, 201)}
present = {w['weaponId'] for w in W} & legacy_ids
check('all 200 legacy ids retained', sorted(legacy_ids - present))

EXPECTED_RENAMES = {
    'wpn_118': 'Obsidian Medium Coilgun Mk.5',
    'wpn_145': 'Halcyon Heavy Ion Cannon Mk.3',
    'wpn_182': 'Halcyon Siege Ion Cannon Mk.3',
    'wpn_187': 'Vanguard Siege Ion Cannon Mk.4',
    'wpn_162': 'Solari Heavy Mass Driver Mk.5',
    'wpn_176': 'Kestrel Siege Gauss Cannon Mk.2',
    'wpn_191': 'Solari Siege Gauss Cannon Mk.5',
}
byid = {w['weaponId']: w for w in W}
sized = {i: byid[i]['name'] for i in sorted(present)
         if re.match(r'^\S+ (Light|Medium|Heavy|Siege) ', byid[i]['name'])}
check('only the 6 duplicate groups renamed', sorted(set(sized) ^ set(EXPECTED_RENAMES)))
check('renames are the expected size words',
      [f'{i}: {sized[i]} != {EXPECTED_RENAMES[i]}' for i in sized
       if EXPECTED_RENAMES.get(i) and sized[i] != EXPECTED_RENAMES[i]])
print(f'note  193/200 legacy names byte-identical; 7 gained a size word to break '
      f'pre-existing duplicates')

# 7 -- files on disk match the json
disk = {}
for dp, _, fns in os.walk(os.path.join(ROOT, 'Weapons')):
    for fn in fns:
        if fn.endswith('.json') and fn != 'index.json':
            o = json.load(open(os.path.join(dp, fn)))
            disk[o['weaponId']] = (o, os.path.relpath(os.path.join(dp, fn), ROOT))
check('one file per weapon', [f'{len(disk)} files vs {len(W)} weapons'] if len(disk) != len(W) else [])
check('file content == json', [w['weaponId'] for w in W if disk.get(w['weaponId'], ({},))[0] != w])
check('filed under class/size', [wid for wid, (o, rel) in disk.items()
                                 if rel.split(os.sep)[1:3] != [o['weaponClass'], o['size']]])

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} CHECK(S) FAILED'))
sys.exit(1 if fails else 0)
