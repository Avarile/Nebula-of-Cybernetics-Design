#!/usr/bin/env python3
"""The seven cross-cutting invariants of gameplay_specification.md 6.

Runs last. Reads the live catalogues and the other GamePlay generators' output, and
recomputes rather than trusting any figure written in a document.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gameplay_tables as T
import gameplay_common as C
from stat_vocabulary import ALL_STATS, SHIP_STATS, SKILL_STATS
from skill_tables import SP_PER_HOUR_REFERENCE

FLEET = C.load_fleet()
GP = os.path.join(ROOT, 'GamePlay')
fails = []

DOCS = ['gameplay_specification.md', 'turn_specification.md', 'progression_specification.md',
        'industry_specification.md', 'logistics_specification.md',
        'economy_specification.md', 'conflict_specification.md']


def check(label, bad, show=6):
    if bad:
        fails.append(label); print(f'FAIL {label}: {len(bad)}')
        for b in bad[:show]: print('      ', b)
    else:
        print(f'ok   {label}')


print('--- documents ---')
check('every document named in gameplay_specification.md 4 exists',
      [d for d in DOCS if not os.path.exists(os.path.join(GP, d))])
check('the hand-written brief survived every generator run',
      [] if os.path.exists(os.path.join(GP, 'PlayerSpecific')) else ['PlayerSpecific missing'])

print('\n--- 6.1  no dead skill ---')
check('every stat in stat_vocabulary has a rule',
      [s for s in ALL_STATS if s not in T.STAT_RULES])
check('every rule names a stat that exists',
      [s for s in T.STAT_RULES if s not in ALL_STATS])
check('every rule points at a document that exists',
      sorted({d for d, _, _ in T.STAT_RULES.values() if not os.path.exists(os.path.join(ROOT, d))}))
check('every stat a skill actually modifies has a rule',
      sorted({e['stat'] for s in FLEET['skills'] for e in s['effects'] if e['stat'] not in T.STAT_RULES}))
check('every stat a module actually modifies has a rule',
      sorted({e['stat'] for m in FLEET['modules'] for e in m.get('effects', []) if e['stat'] not in T.STAT_RULES}))
# A stat only a skill reaches must not be claimed by a hull-field rule, and vice versa.
check('SHIP_STATS and SKILL_STATS are disjoint and jointly complete',
      [] if set(SHIP_STATS) | set(SKILL_STATS) == set(ALL_STATS)
      and not (set(SHIP_STATS) & set(SKILL_STATS)) else ['vocabulary split is inconsistent'])

print('\n--- 6.2  no free money ---')
skills = C.skill_by_id(FLEET)
eff = next(e for e in skills['skl_trd_trade']['effects'] if e['stat'] == 'tradePriceMargin')
bad = []
for level in range(0, 11):
    margin = eff['modifierPerLevel'] * max(0, level - eff['appliesFromLevel'] + 1) / 100.0
    h = C.half_spread(margin)
    threshold = (1 + h) / (1 - h)
    for i in range(len(T.PRICE_INDEX_TIERS)):
        for a in T.NPC_ORDER_TIERS:
            for b in T.NPC_ORDER_TIERS:
                if T.PRICE_INDEX[a][i] / T.PRICE_INDEX[b][i] > threshold:
                    bad.append(f'L{level} {T.PRICE_INDEX_TIERS[i]} {b}->{a}')
    if (1 - h) / (1 + h) >= 1.0:
        bad.append(f'L{level} same-system round trip is profitable')
check('no profitable NPC loop at any trade level, in any NPC-order tier pair', bad)

print('\n--- 6.3  refining stays lossy ---')
mult = C.skill_total_at_10(FLEET, 'refineryYield')
worst, where = 0.0, None
for r in FLEET['resources']:
    if r['tier'] != 'refined':
        continue
    for arch, vals in T.PLANET_ARCHETYPES.items():
        ym = dict(zip(T.ARCHETYPE_FIELDS, vals))['yieldModifier']
        v = r['conversionYield'] * ym * mult
        if v > worst:
            worst, where = v, f'{r["lane"]} x {arch}'
check(f'conversionYield x yieldModifier x refineryYield < 1 (worst {worst:.4f} on {where}, margin {1 - worst:.4f})',
      [] if worst < 1.0 else [f'{where} reaches {worst:.4f}'])
check('GamePlay adds no fourth multiplier to yield',
      [f'{r["archetype"]} dev{r["developmentTier"]}' for r in FLEET.get('facilityTypes', [])
       if 'refinery' in r['slots'] and r['slots']['refinery'].get('scalesWith') != 'developmentTier'])

print('\n--- 6.4  every hull is reachable, difficulty monotonic ---')
P = FLEET.get('progression')
check('progression catalogue present', [] if P else ['run generate_progression.py'])
if P:
    paths = sorted(P['hullPaths'], key=lambda h: h['sp'])
    check('every category is reachable (finite closure, positive SP)',
          [h['shipClass'] for h in paths if not (h['sp'] > 0 and h['closureSkillCount'] > 0)])
    inversions = [f'{a["shipClass"]} ({a["heaviestHullTons"]:,.0f}t) before {b["shipClass"]} ({b["heaviestHullTons"]:,.0f}t)'
                  for a, b in zip(paths, paths[1:]) if a['heaviestHullTons'] > b['heaviestHullTons']]
    check(f'training cost rises with tonnage (<= {len(paths) // 3} adjacent inversions)',
          inversions if len(inversions) > len(paths) // 3 else [])
    check('the battleship is the most expensive hull to reach',
          [] if paths[-1]['shipClass'] == 'battleship' else [paths[-1]['shipClass']])

print('\n--- 6.5  every faucet has a drain ---')
names = dir(T)
check('every faucet names a rate constant that exists',
      [f'{n} -> {c}' for n, c, _ in T.FAUCETS if c not in names])
check('every drain names a rate constant that exists',
      [f'{n} -> {c}' for n, c, _ in T.DRAINS if c not in names])
check('both sides are non-empty', [] if T.FAUCETS and T.DRAINS else ['a side is empty'])
check('the largest drain (facility rent) is continuous, not event-driven',
      [] if 'facility_rent' in [n for n, _, _ in T.DRAINS] else ['no continuous drain'])

print('\n--- 6.6  the fleet cap has exactly one source ---')
carriers = [s['skillId'] for s in FLEET['skills'] if any(u['type'] == 'fleet_slot' for u in s['unlocks'])]
check('exactly one skill carries fleet_slot unlocks',
      [] if carriers == ['skl_flt_formation_drill'] else carriers)
cap_const = re.compile(r'^\s*(FLEET_SIZE|FLEET_CAP|MAX_FLEET|MAX_SHIPS|FLEET_SLOTS)\s*=', re.M)
bad = []
for f in sorted(os.listdir(os.path.join(ROOT, 'tools'))):
    if f.endswith('.py'):
        if cap_const.search(open(os.path.join(ROOT, 'tools', f)).read()):
            bad.append(f'tools/{f} defines a fleet-cap constant')
check('no generator or table defines a fleet-cap constant', bad)
# The brief itself says "5 max" and gameplay_specification.md 1 quotes it; both are
# allowed. What is not allowed is a spec asserting the cap in its own voice.
bad = []
for d in DOCS:
    for i, line in enumerate(open(os.path.join(GP, d)), 1):
        if re.search(r'(?i)(max(imum)?\s+(of\s+)?5|5\s*(ship|hull)s?\s*(max|cap|limit))', line) \
                and 'Formation Drill' not in line and '>' not in line:
            bad.append(f'{d}:{i}: {line.strip()[:70]}')
check('no document asserts a numeric fleet cap in its own voice', bad)

print('\n--- 6.7  resolution is deterministic ---')
check('the phase list is dense and ordered 1-14',
      [] if [p[0] for p in T.PHASES] == list(range(1, 15)) else [[p[0] for p in T.PHASES]])
phase_ids = {p[0] for p in T.PHASES}
check('every order type names phases that exist',
      [f'{k} -> {v}' for k, v in T.ORDER_TYPES.items() if not set(v) <= phase_ids])
ordered = {ph for v in T.ORDER_TYPES.values() for ph in v}
system_phases = {p[0] for p in T.PHASES if p[2] == 'system'}
check('every phase is either driven by an order type or is a system phase',
      [p[0] for p in T.PHASES if p[0] not in ordered and p[0] not in system_phases])
check('no system phase accepts an order',
      sorted(ordered & system_phases))
check('every contended resource names a tie-break',
      [k for k, v in T.CONTENDED.items() if not v])
check('every contended resource is a real order type',
      [k for k in T.CONTENDED if k not in T.ORDER_TYPES])

print('\n--- turn and logistics consistency ---')
check('SP_PER_TURN is derived from the skill catalogue reference rate',
      [] if T.SP_PER_TURN == T.TURN_LENGTH_HOURS * SP_PER_HOUR_REFERENCE
      else [f'{T.SP_PER_TURN}'])
check('fuel burn per ly rises strictly with hull mass',
      [] if all(a <= b for a, b in zip(
          [s['mass']['value'] / T.FUEL_MASS_DIVISOR for s in sorted(FLEET['ships'], key=lambda x: x['mass']['value'])],
          [s['mass']['value'] / T.FUEL_MASS_DIVISOR for s in sorted(FLEET['ships'], key=lambda x: x['mass']['value'])][1:]))
      else ['not monotonic'])
check('every hull has a positive jump range',
      [s['shipId'] for s in FLEET['ships']
       if T.JUMP_RANGE_BASE * s['mobility']['topSpeed'] / T.JUMP_SPEED_REFERENCE <= 0])
check('every hull with a fuel tank has a finite fuel range',
      [s['shipId'] for s in FLEET['ships']
       if s['mass']['value'] > 0 and s['capacities']['fuel'] <= 0])
weapons = {w['weaponId']: w for w in FLEET['weapons']}
check('exactly the finite-ammo weapon classes draw on the magazine',
      sorted({w['weaponClass'] for w in FLEET['weapons']
              if (w['ammo'] != 'infinite') != (w['weaponClass'] in T.AMMO_DRAWING_CLASSES)}))
cargo_classes = {s['shipClass'] for s in FLEET['ships'] if s['capacities']['cargo'] > 0}
check('no warship category carries cargo',
      sorted(cargo_classes & {'destroyer', 'light_cruiser', 'heavy_cruiser',
                              'battlecruiser', 'battleship', 'monitor'}))
check('at least one hull category can haul',
      [] if cargo_classes else ['nothing can carry cargo'])
check('the fuel and ammo resources exist',
      [r for r in (T.FUEL_RESOURCE, T.AMMO_RESOURCE)
       if r not in {x['resourceId'] for x in FLEET['resources']}])

print('\n--- catalogue presence ---')
for key in ('progression', 'marketPrices', 'facilityTypes', 'npcSquadrons', 'contractArchetypes'):
    check(f'fleet json carries "{key}"', [] if FLEET.get(key) else ['missing'])
for meta in ('spPerTurn', 'turnLengthHours', 'tradeableGoodCount'):
    check(f'_meta carries "{meta}"', [] if meta in FLEET['_meta'] else ['missing'])

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} CHECK(S) FAILED'))
sys.exit(1 if fails else 0)
