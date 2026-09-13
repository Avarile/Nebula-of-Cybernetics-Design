#!/usr/bin/env python3
"""Invariant checks for the generated progression catalogue."""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gameplay_tables as T
import gameplay_common as C
from skill_tables import SP_PER_HOUR_REFERENCE

FLEET = C.load_fleet()
P = FLEET.get('progression')
OUT = os.path.join(ROOT, 'GamePlay', 'Progression')
fails = []


def check(label, bad, show=6):
    if bad:
        fails.append(label); print(f'FAIL {label}: {len(bad)}')
        for b in bad[:show]: print('      ', b)
    else:
        print(f'ok   {label}')


check('fleet json carries "progression"', [] if P else ['missing -- run generate_progression.py'])
if not P:
    print('\n1 CHECK(S) FAILED'); sys.exit(1)

skills = C.skill_by_id(FLEET)
spt = T.SP_PER_TURN

# --- the rate is derived, never typed ---------------------------------------
check('SP_PER_TURN == TURN_LENGTH_HOURS x SP_PER_HOUR_REFERENCE',
      [] if spt == T.TURN_LENGTH_HOURS * SP_PER_HOUR_REFERENCE
      else [f'{spt} != {T.TURN_LENGTH_HOURS} x {SP_PER_HOUR_REFERENCE}'])
check('published spPerTurn matches the constant',
      [] if P['constants']['spPerTurn'] == spt else [P['constants']['spPerTurn']])

# --- the ladder -------------------------------------------------------------
bad = []
for s in FLEET['skills']:
    tr = s['training']
    run = 0
    for i, step in enumerate(tr['spPerLevel']):
        run += step
        if run != tr['spCumulative'][i]:
            bad.append(f'{s["skillId"]} L{i+1}: cumulative {tr["spCumulative"][i]} != running {run}')
    if tr['spTotal'] != tr['spCumulative'][-1]:
        bad.append(f'{s["skillId"]}: spTotal != last cumulative')
check('spCumulative is the running sum of spPerLevel, spTotal its last element', bad)

check('ladder strictly increasing in level',
      [s['skillId'] for s in FLEET['skills']
       if any(b <= a for a, b in zip(s['training']['spPerLevel'], s['training']['spPerLevel'][1:]))])

by_rank = {}
for s in FLEET['skills']:
    by_rank.setdefault(s['rank'], set()).add(s['training']['spTotal'])
check('one spTotal per rank (the ladder is rank x a shared curve)',
      [f'rank {r}: {len(v)} distinct totals' for r, v in by_rank.items() if len(v) != 1])
check('ladder strictly increasing in rank',
      [] if [min(by_rank[r]) for r in sorted(by_rank)] == sorted(min(by_rank[r]) for r in by_rank)
      and len(set(min(by_rank[r]) for r in by_rank)) == len(by_rank) else ['rank totals not strictly ordered'])

# --- prerequisite closure ---------------------------------------------------
# A cycle is a repeat on the CURRENT path, not a repeat anywhere: the graph is a
# DAG with diamonds (skl_sta_science is a prerequisite of several skills that also
# share prerequisites), and a global visited set would flag every diamond as a cycle.
bad = []


def find_cycle(sid, path, done):
    if sid in path:
        return ' -> '.join(path[path.index(sid):] + [sid])
    if sid in done:
        return None
    path.append(sid)
    for pr in skills[sid]['prerequisites']:
        hit = find_cycle(pr['skillId'], path, done)
        if hit:
            return hit
    path.pop()
    done.add(sid)
    return None


done = set()
for s in FLEET['skills']:
    hit = find_cycle(s['skillId'], [], done)
    if hit:
        bad.append(hit)
check('prerequisite graph is acyclic from every skill', bad)

check('every prerequisite resolves',
      [f'{s["skillId"]} -> {p["skillId"]}' for s in FLEET['skills']
       for p in s['prerequisites'] if p['skillId'] not in skills])

# --- hull paths -------------------------------------------------------------
paths = {h['shipClass']: h for h in P['hullPaths']}
check('every ship category has a hull path',
      [c for c in FLEET['_meta']['shipCategories'] if c not in paths])
check('every ship_operation unlock names a real category',
      [u['target'] for s in FLEET['skills'] for u in s['unlocks']
       if u.get('type') == 'ship_operation' and u['target'] not in FLEET['_meta']['shipCategories']])
check('exactly two ship_operation claimants per category',
      [f'{c}: {len(paths[c]["gateSkills"])}' for c in paths if len(paths[c]['gateSkills']) != 2])

bad = []
for c, h in paths.items():
    recomputed = C.closure_sp(skills, C.prereq_closure(skills, C.hull_gate_skills(FLEET, c)))
    if recomputed != h['sp']:
        bad.append(f'{c}: published {h["sp"]} != recomputed {recomputed}')
check('published hull-path SP recomputes from the live graph', bad)

# Difficulty monotonic with tonnage, tolerating one adjacent swap per
# gameplay_specification.md 6.4 (hull tree shape and mass band are not identical axes).
by_sp = sorted(paths.values(), key=lambda h: h['sp'])
inversions = sum(1 for a, b in zip(by_sp, by_sp[1:]) if a['heaviestHullTons'] > b['heaviestHullTons'])
check('hull difficulty rises with tonnage (adjacent inversions bounded)',
      [] if inversions <= len(by_sp) // 3 else [f'{inversions} inversions over {len(by_sp)} categories'])

# --- the fleet cap has exactly one source ------------------------------------
slot_carriers = [s['skillId'] for s in FLEET['skills']
                 if any(u['type'] == 'fleet_slot' for u in s['unlocks'])]
check('exactly one skill carries fleet_slot unlocks',
      [] if slot_carriers == ['skl_flt_formation_drill'] else slot_carriers)
check('Formation Drill carries exactly four fleet_slot unlocks',
      [] if len([u for u in skills['skl_flt_formation_drill']['unlocks']
                 if u['type'] == 'fleet_slot']) == 4 else ['wrong count'])

# --- the starting package ----------------------------------------------------
bad = []
for hull in T.STARTING_HULLS:
    ship = next((s for s in FLEET['ships'] if s['shipId'] == hull), None)
    if not ship:
        bad.append(f'{hull} not in the ship catalogue'); continue
    if ship['shipClass'] not in paths:
        bad.append(f'{hull} class has no hull path')
check('every starting hull exists and is operable', bad)

check('starting hulls all cost the same to fly (the choice locks nothing)',
      [] if len({paths[next(s for s in FLEET['ships'] if s['shipId'] == h)['shipClass']]['sp']
                 for h in T.STARTING_HULLS}) == 1 else ['starting hulls differ in training cost'])

sci_gates = C.science_gate_levels(FLEET)
check('starting Science level opens raw operations',
      [] if T.STARTING_SCIENCE_LEVEL >= sci_gates['raw_operations']
      else [f'science {T.STARTING_SCIENCE_LEVEL} < gate {sci_gates["raw_operations"]}'])
check('no starter grant exceeds a level-5 gate',
      [] if T.STARTING_SCIENCE_LEVEL <= 5 else [T.STARTING_SCIENCE_LEVEL])

# --- files on disk match the fleet json --------------------------------------
bad = []
for name, key, inner in (('training_index.json', 'training', 'skills'),
                         ('hull_paths.json', 'hullPaths', 'hullPaths'),
                         ('careers.json', 'careers', 'careers')):
    p = os.path.join(OUT, name)
    if not os.path.exists(p):
        bad.append(f'{name} missing'); continue
    if json.load(open(p))[inner] != P[key]:
        bad.append(f'{name} differs from fleet json "{key}"')
check('every generated file matches its fleet json entry', bad)

check('the hand-written specs survived the run',
      [f for f in ('gameplay_specification.md', 'progression_specification.md', 'PlayerSpecific')
       if not os.path.exists(os.path.join(ROOT, 'GamePlay', f))])

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} CHECK(S) FAILED'))
sys.exit(1 if fails else 0)
