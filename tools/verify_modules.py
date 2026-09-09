#!/usr/bin/env python3
"""Invariant checks for the generated module catalogue."""
import json, os, re, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from generate_modules import (ARCHETYPES, STATS, BENEFICIAL_NEGATIVE, SLOT_TYPES,
                              FUNCTION_CLASSES, SIZES, SHIP_CLASSES, LEGACY, MARKS)

FLEET = json.load(open(os.path.join(ROOT, 'fleet_and_weapons.json')))
M = FLEET['modules']
fails = []

def check(label, bad, show=4):
    if bad:
        fails.append(label); print(f'FAIL {label}: {len(bad)}')
        for b in bad[:show]: print('      ', b)
    else:
        print(f'ok   {label}')

check('unique moduleIds', [k for k, v in Counter(m['moduleId'] for m in M).items() if v > 1])
check('unique names',     [k for k, v in Counter(m['name'] for m in M).items() if v > 1])

body = '\n'.join(l for l in open(os.path.join(ROOT, 'Data-Templates', 'module.interface'))
                 if not l.lstrip().startswith('#'))
schema = set(json.loads(body))
check('field set matches module.interface', [m['moduleId'] for m in M if set(m) != schema])

check('slotType legal',      [m['moduleId'] for m in M if m['slotType'] not in SLOT_TYPES])
check('functionClass legal', [m['moduleId'] for m in M if m['functionClass'] not in FUNCTION_CLASSES])
check('size legal',          [m['moduleId'] for m in M if m['size'] not in SIZES])
check('mark legal',          [m['moduleId'] for m in M if m['mark'] not in MARKS])

check('effects use known stats',
      [f"{m['moduleId']}: {e['stat']}" for m in M for e in m['effects'] if e['stat'] not in STATS])
check('modifierType legal',
      [f"{m['moduleId']}: {e['modifierType']}" for m in M for e in m['effects']
       if e['modifierType'] not in ('flat', 'percent')])
check('every module has at least one effect', [m['moduleId'] for m in M if not m['effects']])

# hullAffinity: exactly the 'specific' modules carry one, and only real shipClass values
check("only 'specific' carries hullAffinity",
      [m['moduleId'] for m in M if bool(m['hullAffinity']) != (m['functionClass'] == 'specific')])
check('hullAffinity values are real shipClasses',
      [f"{m['moduleId']}: {h}" for m in M for h in m['hullAffinity'] if h not in SHIP_CLASSES])

# mark ladder: benefits non-decreasing, drawbacks non-increasing, effects a superset
def benefit(stat, mod):
    return -mod if stat in BENEFICIAL_NEGATIVE else mod

# Map each module back to its archetype exactly: generated names are "<Archetype> Mk.N",
# and the ten legacy modules kept custom names, so LEGACY supplies their archetype.
LEGACY_ARCH = {mid: arch for mid, (arch, _) in LEGACY.items()}
by_arch = defaultdict(dict)
unmapped = []
names = {a['name'] for a in ARCHETYPES}
for m in M:
    if m['moduleId'] in LEGACY_ARCH:
        arch = LEGACY_ARCH[m['moduleId']]
    else:
        mt = re.match(r'^(.*) Mk\.(\d+)$', m['name'])
        arch = mt.group(1) if mt else None
    if arch not in names:
        unmapped.append(m['moduleId']); continue
    by_arch[arch][m['mark']] = m
check('every module maps to a known archetype', unmapped)

bad_ladder, bad_super, bad_cost = [], [], []
for name, marks in by_arch.items():
    for lo, hi in zip(MARKS, MARKS[1:]):
        if lo not in marks or hi not in marks:
            continue
        a, b = marks[lo], marks[hi]
        ea = {e['stat']: benefit(e['stat'], e['modifier']) for e in a['effects']}
        eb = {e['stat']: benefit(e['stat'], e['modifier']) for e in b['effects']}
        if not set(ea) <= set(eb):
            bad_super.append(f'{name} Mk.{lo}->Mk.{hi}: lost {set(ea) - set(eb)}')
        for stat, va in ea.items():
            if stat in eb and eb[stat] < va - 1e-9:
                bad_ladder.append(f'{name} Mk.{lo}->Mk.{hi} {stat}: {va} -> {eb[stat]}')
        if b['powerCost'] < a['powerCost'] or b['crewRequired'] < a['crewRequired'] \
           or sum(b['buildCost'].values()) < sum(a['buildCost'].values()):
            bad_cost.append(f'{name} Mk.{lo}->Mk.{hi} cost went down')
check('mark ladder: benefits non-decreasing', bad_ladder)
check('mark ladder: effect set grows', bad_super)
check('mark ladder: power/crew non-decreasing', bad_cost)
check('every archetype built at all 3 marks',
      [n for n, mk in by_arch.items() if sorted(mk) != MARKS])

# legacy ids kept and still referenced correctly by the 20 ships
ids = {m['moduleId'] for m in M}
check('legacy module ids retained', sorted(set(LEGACY) - ids))
refs = [(s['shipId'], sl['slotId'], sl['moduleEquipped'])
        for s in FLEET['ships'] for sl in s['moduleSlots']['list'] if sl['moduleEquipped']]
check('ship moduleEquipped references resolve',
      [f'{a}:{b} -> {c}' for a, b, c in refs if c not in ids])
by_id = {m['moduleId']: m for m in M}
check('ship slot size/type match the fitted module',
      [f'{a}:{b}' for s in FLEET['ships'] for sl in s['moduleSlots']['list']
       if (a := s['shipId']) and (b := sl['slotId']) and sl['moduleEquipped']
       and (sl['size'] != by_id[sl['moduleEquipped']]['size']
            or sl['slotType'] != by_id[sl['moduleEquipped']]['slotType'])])

# files on disk
disk = {}
for dp, _, fns in os.walk(os.path.join(ROOT, 'Modules')):
    for fn in fns:
        if fn.endswith('.json') and fn != 'index.json':
            o = json.load(open(os.path.join(dp, fn)))
            disk[o['moduleId']] = (o, os.path.relpath(os.path.join(dp, fn), ROOT))
check('one file per module', [f'{len(disk)} files vs {len(M)} modules'] if len(disk) != len(M) else [])
check('file content == json', [m['moduleId'] for m in M if disk.get(m['moduleId'], ({},))[0] != m])
check('filed under slotType/functionClass',
      [mid for mid, (o, rel) in disk.items()
       if rel.split(os.sep)[1:3] != [o['slotType'], o['functionClass']]])

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} CHECK(S) FAILED'))
sys.exit(1 if fails else 0)
