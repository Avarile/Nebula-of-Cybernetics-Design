#!/usr/bin/env python3
"""Invariant checks for the generated skill catalogue."""
import json, os, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from skill_tables import (DOMAINS, CATEGORY_ORDER, SCOPES, UNLOCK_TYPES, WEAPON_CLASSES,
                          APPLIES_TO_KEYS, MAX_LEVEL, OPERATE_LEVEL)
from stat_vocabulary import ALL_STATS
from ship_tables import BY_KEY

FLEET = json.load(open(os.path.join(ROOT, 'fleet_and_weapons.json')))
S = FLEET['skills']
fails = []


def check(label, bad, show=6):
    if bad:
        fails.append(label); print(f'FAIL {label}: {len(bad)}')
        for b in bad[:show]: print('      ', b)
    else:
        print(f'ok   {label}')


check('80 skills across 4 domains', [] if len(S) == 80 else [f'{len(S)} skills'])
check('unique skillIds', [k for k, v in Counter(s['skillId'] for s in S).items() if v > 1])
check('unique names',    [k for k, v in Counter(s['name'] for s in S).items() if v > 1])

# ---------------------------------------------------------------- schema conformance
# The .interface body is a nested schema, so compare key sets level by level rather
# than the flat set-equality the resource verifier can get away with.
body = '\n'.join(l for l in open(os.path.join(ROOT, 'Data-Templates', 'skill.interface'))
                 if not l.lstrip().startswith('#'))
schema = json.loads(body)
top = set(schema)
sub = {k: set(schema[k][0]) for k in ('effects', 'penalties', 'unlocks', 'prerequisites')}

bad = [s['skillId'] for s in S if set(s) != top]
check('field set matches skill.interface', bad)

bad = []
for s in S:
    for key, want in sub.items():
        for i, item in enumerate(s[key]):
            if set(item) != want:
                bad.append(f'{s["skillId"]}.{key}[{i}]: {sorted(set(item) ^ want)}')
check('effect/penalty/unlock/prerequisite field sets match schema', bad)

# ------------------------------------------------------------- closed vocabularies
check('domain legal', [s['skillId'] for s in S if s['domain'] not in DOMAINS])
check('scope legal',  [s['skillId'] for s in S if s['scope'] not in SCOPES])
check('category belongs to its domain',
      [f'{s["skillId"]}: {s["category"]} not in {s["domain"]}'
       for s in S if s['category'] not in CATEGORY_ORDER.get(s['domain'], [])])
check('maxLevel is 10 and rank in 1..5',
      [f'{s["skillId"]}: maxLevel {s["maxLevel"]} rank {s["rank"]}'
       for s in S if s['maxLevel'] != MAX_LEVEL or not 1 <= s['rank'] <= 5])

stats = set(ALL_STATS)
check('every effect/penalty stat is in the stat vocabulary',
      [f'{s["skillId"]}: {e["stat"]}' for s in S for e in s['effects'] + s['penalties']
       if e['stat'] not in stats])
check('modifierType is percent or flat',
      [f'{s["skillId"]}: {e["modifierType"]}' for s in S for e in s['effects'] + s['penalties']
       if e['modifierType'] not in ('percent', 'flat')])

# ---------------------------------------------------------------------- level bounds
check('appliesFromLevel in 1..maxLevel',
      [f'{s["skillId"]}: {e["stat"]} from {e["appliesFromLevel"]}'
       for s in S for e in s['effects'] if not 1 <= e['appliesFromLevel'] <= s['maxLevel']])
check('appliesBelowLevel in 2..maxLevel',
      [f'{s["skillId"]}: {p["stat"]} below {p["appliesBelowLevel"]}'
       for s in S for p in s['penalties'] if not 2 <= p['appliesBelowLevel'] <= s['maxLevel']])

# A penalty with no matching effect is a stat a player can be debuffed on with no path
# out of the debuff -- the weaponry ladder is only fair because the effect exists.
bad = []
for s in S:
    from_by_stat = defaultdict(list)
    for e in s['effects']:
        from_by_stat[e['stat']].append(e['appliesFromLevel'])
    for p in s['penalties']:
        if p['stat'] not in from_by_stat:
            bad.append(f'{s["skillId"]}: penalty on {p["stat"]} with no effect on it')
        elif max(from_by_stat[p['stat']]) < p['appliesBelowLevel']:
            bad.append(f'{s["skillId"]}: {p["stat"]} effect starts before the penalty clears')
check('every penalised stat has an effect that starts at or after the threshold', bad)

# ---------------------------------------------------------------------- appliesTo
tiers = {r['tier'] for r in FLEET['resources']}
catalogue_classes = {w['weaponClass'] for w in FLEET['weapons']}
bad = []
for s in S:
    for e in s['effects'] + s['penalties']:
        for k, v in e['appliesTo'].items():
            if k not in APPLIES_TO_KEYS:
                bad.append(f'{s["skillId"]}: appliesTo key {k}'); continue
            ok = ((k == 'weaponClass' and v in WEAPON_CLASSES)
                  or (k == 'shipCategory' and v in BY_KEY)
                  or (k == 'resourceTier' and v in tiers))
            if not ok:
                bad.append(f'{s["skillId"]}: appliesTo.{k} = {v} does not resolve')
check('appliesTo keys and values resolve', bad)
check('weaponClass vocabulary covers the weapon catalogue, plus documented drone',
      [] if set(WEAPON_CLASSES) - catalogue_classes == {'drone'}
      else [f'WEAPON_CLASSES vs catalogue: {sorted(set(WEAPON_CLASSES) ^ catalogue_classes)}'])

# -------------------------------------------------------------------- prerequisites
by_id = {s['skillId']: s for s in S}
bad = []
for s in S:
    for p in s['prerequisites']:
        if p['skillId'] not in by_id:
            bad.append(f'{s["skillId"]} -> {p["skillId"]} (missing)')
        elif p['skillId'] == s['skillId']:
            bad.append(f'{s["skillId"]} requires itself')
        elif not 1 <= p['level'] <= by_id[p['skillId']]['maxLevel']:
            bad.append(f'{s["skillId"]} -> {p["skillId"]} level {p["level"]}')
check('prerequisites resolve to another skill at a legal level', bad)

# depth-first cycle hunt over the prerequisite graph
WHITE, GREY, BLACK = 0, 1, 2
colour = defaultdict(int)
bad = []


def walk(sid, trail):
    if colour[sid] == GREY:
        bad.append(' -> '.join(trail + [sid])); return
    if colour[sid] == BLACK:
        return
    colour[sid] = GREY
    for p in by_id[sid]['prerequisites']:
        if p['skillId'] in by_id:
            walk(p['skillId'], trail + [sid])
    colour[sid] = BLACK


for s in S:
    walk(s['skillId'], [])
check('prerequisite graph is acyclic', bad)

# -------------------------------------------------------------------------- unlocks
check('unlock type legal',
      [f'{s["skillId"]}: {u["type"]}' for s in S for u in s['unlocks']
       if u['type'] not in UNLOCK_TYPES])
check('unlock level in 1..maxLevel',
      [f'{s["skillId"]}: {u["target"]} at {u["level"]}' for s in S for u in s['unlocks']
       if not 1 <= u['level'] <= s['maxLevel']])
bad = [s['skillId'] for s in S
       if [u['level'] for u in s['unlocks']] != sorted({u['level'] for u in s['unlocks']})]
check('unlock levels strictly increasing within a skill', bad)

# The operate-a-hull rule: every category claimed by exactly two skills, at one level.
claims = defaultdict(list)
for s in S:
    for u in s['unlocks']:
        if u['type'] == 'ship_operation':
            claims[u['target']].append((s['skillId'], u['level']))
bad = [f'{cat}: {len(c)} claimant(s) {[x[0] for x in c]}' for cat, c in claims.items() if len(c) != 2]
check('exactly 2 ship_operation claimants per category', bad)
check('all 26 ship categories unlockable',
      sorted(set(BY_KEY) - set(claims)) or [])
check(f'both claimants gate at level {OPERATE_LEVEL}',
      [f'{cat}: {sorted({x[1] for x in c})}' for cat, c in claims.items()
       if {x[1] for x in c} != {OPERATE_LEVEL}])
check('one control + one systems skill per category',
      [cat for cat, c in claims.items()
       if sorted(x[0].rsplit('_', 1)[1] for x in c) != ['control', 'systems']])

slots = [u['target'] for s in S for u in s['unlocks'] if u['type'] == 'fleet_slot']
check('fleet slots 2-5, each claimed once',
      [] if sorted(slots) == ['2', '3', '4', '5'] else [f'fleet slots: {sorted(slots)}'])

# --------------------------------------------------- cross-catalogue: refinery yield
# refineryYield multiplies a lane's conversionYield, which resource.interface requires to
# stay strictly below 1. A skill that can push it to 1.0 would break that invariant from
# the outside, which no amount of checking inside verify_resources.py would catch.
boost = 0.0
for s in S:
    for e in s['effects']:
        if e['stat'] == 'refineryYield' and e['modifierType'] == 'percent':
            boost += e['modifierPerLevel'] * (s['maxLevel'] - e['appliesFromLevel'] + 1)
bad = [f'{r["resourceId"]}: {r["conversionYield"]} x {1 + boost / 100:.2f} = '
       f'{r["conversionYield"] * (1 + boost / 100):.4f}'
       for r in FLEET['resources']
       if r['conversionYield'] is not None and r['conversionYield'] * (1 + boost / 100) >= 1.0]
check(f'max refineryYield boost (+{boost:.0f}%) keeps every lane yield below 1', bad)

# ---------------------------------------------------------------------- files on disk
disk = {}
for dp, _, fns in os.walk(os.path.join(ROOT, 'Skills')):
    for fn in fns:
        if fn.endswith('.json') and fn != 'index.json':
            o = json.load(open(os.path.join(dp, fn)))
            disk[o['skillId']] = (o, os.path.relpath(os.path.join(dp, fn), ROOT))
check('one file per skill', [f'{len(disk)} files vs {len(S)} skills'] if len(disk) != len(S) else [])
check('file content == json', [s['skillId'] for s in S if disk.get(s['skillId'], ({},))[0] != s])
check('filed under domain/category',
      [sid for sid, (o, rel) in disk.items()
       if rel.split(os.sep)[1:3] != [o['domain'], o['category']]])

index = json.load(open(os.path.join(ROOT, 'Skills', 'index.json')))
check('index.json lists every skill with a resolving path',
      [e['skillId'] for e in index['skills']
       if e['skillId'] not in by_id or not os.path.exists(os.path.join(ROOT, e['path']))]
      or ([f"index count {index['count']} vs {len(S)}"] if index['count'] != len(S) else []))

# The hand-written spec Skills/Design is the source these are derived from; a generator
# run must never treat Skills/ as a purely-generated directory and delete it.
check('hand-written Skills/Design survived generation',
      [] if os.path.exists(os.path.join(ROOT, 'Skills', 'Design')) else ['Skills/Design is missing'])

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} CHECK(S) FAILED'))
sys.exit(1 if fails else 0)
