#!/usr/bin/env python3
"""Invariant checks for the generated resource catalogue."""
import json, os, sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from resource_costs import LANES, TIERS, expand_to_raw

FLEET = json.load(open(os.path.join(ROOT, 'fleet_and_weapons.json')))
R = FLEET['resources']
fails = []


def check(label, bad, show=6):
    if bad:
        fails.append(label); print(f'FAIL {label}: {len(bad)}')
        for b in bad[:show]: print('      ', b)
    else:
        print(f'ok   {label}')


check('12 resources: 4 lanes x 3 tiers', [] if len(R) == 12 else [f'{len(R)} resources'])
check('unique resourceIds', [k for k, v in Counter(r['resourceId'] for r in R).items() if v > 1])
check('unique names',       [k for k, v in Counter(r['name'] for r in R).items() if v > 1])

body = '\n'.join(l for l in open(os.path.join(ROOT, 'Data-Templates', 'resource.interface'))
                 if not l.lstrip().startswith('#'))
schema = set(json.loads(body))
check('field set matches resource.interface', [r['resourceId'] for r in R if set(r) != schema])

check('tier legal', [r['resourceId'] for r in R if r['tier'] not in TIERS])
check('lane legal', [r['resourceId'] for r in R if r['lane'] not in LANES])

# yields: null for raw, strictly between 0 and 1 for refined/manufactured
bad = []
for r in R:
    y = r['conversionYield']
    if r['tier'] == 'raw':
        if y is not None:
            bad.append(f'{r["resourceId"]}: raw tier has a yield')
    elif not (y is not None and 0 < y < 1):
        bad.append(f'{r["resourceId"]}: yield {y} not in (0, 1)')
check('conversionYield null for raw, in (0,1) otherwise', bad)

# cross-references resolve and each lane forms an unbroken 3-tier chain
by_id = {r['resourceId']: r for r in R}
bad = []
for r in R:
    for ref in ('refinesFrom', 'refinesInto'):
        if r[ref] is not None and r[ref] not in by_id:
            bad.append(f'{r["resourceId"]}.{ref} -> {r[ref]} (missing)')
check('refinesFrom/refinesInto resolve', bad)

bad = []
for lane in LANES:
    chain = [r for r in R if r['lane'] == lane]
    by_tier = {r['tier']: r for r in chain}
    if set(by_tier) != set(TIERS):
        bad.append(f'{lane}: tiers present {sorted(by_tier)}'); continue
    if by_tier['raw']['refinesInto'] != by_tier['refined']['resourceId']:
        bad.append(f'{lane}: raw.refinesInto != refined.resourceId')
    if by_tier['refined']['refinesFrom'] != by_tier['raw']['resourceId']:
        bad.append(f'{lane}: refined.refinesFrom != raw.resourceId')
    if by_tier['refined']['refinesInto'] != by_tier['manufactured']['resourceId']:
        bad.append(f'{lane}: refined.refinesInto != manufactured.resourceId')
    if by_tier['manufactured']['refinesFrom'] != by_tier['refined']['resourceId']:
        bad.append(f'{lane}: manufactured.refinesFrom != refined.resourceId')
check('each lane is an unbroken raw->refined->manufactured chain', bad)

# files on disk
disk = {}
for dp, _, fns in os.walk(os.path.join(ROOT, 'Resources')):
    for fn in fns:
        if fn.endswith('.json') and fn != 'index.json':
            o = json.load(open(os.path.join(dp, fn)))
            disk[o['resourceId']] = (o, os.path.relpath(os.path.join(dp, fn), ROOT))
check('one file per resource', [f'{len(disk)} files vs {len(R)} resources'] if len(disk) != len(R) else [])
check('file content == json', [r['resourceId'] for r in R if disk.get(r['resourceId'], ({},))[0] != r])
check('filed under tier', [rid for rid, (o, rel) in disk.items() if rel.split(os.sep)[1] != o['tier']])

check('every weapon has a buildCost with all 4 lanes',
      [w['weaponId'] for w in FLEET['weapons'] if set(w.get('buildCost', {})) != set(LANES)])
check('every module has a buildCost with all 4 lanes',
      [m['moduleId'] for m in FLEET['modules'] if set(m.get('buildCost', {})) != set(LANES)])
check('every ship (template + named) has a buildCost with all 4 lanes',
      [s['shipId'] for s in FLEET['ships'] + FLEET['namedShips']
       if set(s.get('buildCost', {})) != set(LANES)])

# chain round-trip: expanding every weapon's buildCost to raw units and back
# down through the same yields should reproduce numbers consistent with the
# yields stored in the resource catalogue itself (not just the constants) --
# catches the catalogue and the formula module drifting apart.
by_lane_yield = {r['lane']: r['conversionYield'] for r in R if r['tier'] == 'refined'}
by_lane_fab = {r['lane']: r['conversionYield'] for r in R if r['tier'] == 'manufactured'}
bad = []
for w in FLEET['weapons']:
    raw_equiv = expand_to_raw(w['buildCost'])
    for lane in LANES:
        if w['buildCost'][lane] == 0:
            continue
        reconstructed = round(raw_equiv[lane] * by_lane_yield[lane] * by_lane_fab[lane], 2)
        if abs(reconstructed - w['buildCost'][lane]) > 0.02:
            bad.append(f'{w["weaponId"]} {lane}: {w["buildCost"][lane]} -> raw {raw_equiv[lane]} -> back {reconstructed}')
check('buildCost round-trips through the stored catalogue yields', bad)

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} CHECK(S) FAILED'))
sys.exit(1 if fails else 0)
