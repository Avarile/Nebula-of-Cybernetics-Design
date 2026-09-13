#!/usr/bin/env python3
"""Invariant checks for the generated systems-and-planets map."""
import json, os, sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from system_tables import (ARCHETYPES, ARCHETYPE_NAMES, PLACEMENT, SECURITY_BANDS,
                           SECURITY_TIERS, LANES, tiers_for)

FLEET = json.load(open(os.path.join(ROOT, 'fleet_and_weapons.json')))
S, P = FLEET['systems'], FLEET['planets']
MAP_DIR = os.path.join(ROOT, 'Systems_Planets')
LINKS = json.load(open(os.path.join(MAP_DIR, 'links.json')))
fails = []


def check(label, bad, show=6):
    if bad:
        fails.append(label); print('FAIL %s: %d' % (label, len(bad)))
        for b in bad[:show]: print('      ', b)
    else:
        print('ok   %s' % label)


def schema(name):
    body = '\n'.join(l for l in open(os.path.join(ROOT, 'Data-Templates', name))
                     if not l.lstrip().startswith('#'))
    return set(json.loads(body))


# ---- counts, ids, schemas
check('60 systems', [] if len(S) == 60 else ['%d systems' % len(S)])
check('180 planets', [] if len(P) == 180 else ['%d planets' % len(P)])
check('unique systemIds', [k for k, v in Counter(s['systemId'] for s in S).items() if v > 1])
check('unique system names', [k for k, v in Counter(s['name'] for s in S).items() if v > 1])
check('unique planetIds', [k for k, v in Counter(p['planetId'] for p in P).items() if v > 1])
check('unique planet names', [k for k, v in Counter(p['name'] for p in P).items() if v > 1])
check('systemIds densely numbered',
      [] if {s['systemId'] for s in S} == {'sys_%03d' % i for i in range(1, 61)} else ['gap or stray id'])
check('planetIds densely numbered',
      [] if {p['planetId'] for p in P} == {'pln_%03d' % i for i in range(1, 181)} else ['gap or stray id'])

sys_schema = schema('system.interface')
check('field set matches system.interface', [s['systemId'] for s in S if set(s) != sys_schema])
pl_schema = schema('planet.interface')
check('field set matches planet.interface', [p['planetId'] for p in P if set(p) != pl_schema])

# ---- enums and bands
check('securityTier legal', [s['systemId'] for s in S if s['securityTier'] not in SECURITY_TIERS])
check('archetype legal', [p['planetId'] for p in P if p['archetype'] not in ARCHETYPE_NAMES])
check('securityRating inside its band',
      ['%s: %s not in %s' % (s['name'], s['securityRating'], SECURITY_BANDS[s['securityTier']])
       for s in S if not SECURITY_BANDS[s['securityTier']][0] <= s['securityRating']
       <= SECURITY_BANDS[s['securityTier']][1]])
check('security distribution 11/19/18/12',
      [] if Counter(s['securityTier'] for s in S) ==
      {'core': 11, 'mid': 19, 'rim': 18, 'deadspace': 12} else ['distribution changed'])

# belt lanes must be lanes the live resource catalogue actually has
live_lanes = {r['lane'] for r in FLEET['resources']}
check('belt dominantLane is a live resource lane',
      ['%s: %s' % (b['beltId'], b['dominantLane']) for s in S for b in s['asteroidBelts']
       if b['dominantLane'] not in live_lanes])

# ---- the security inversion (spec 3)
check('richness/development consistent with security',
      ['%s: (%d, %d) != %s' % (s['name'], s['richnessTier'], s['developmentTier'],
                               tiers_for(s['securityTier'], s['securityRating']))
       for s in S if (s['richnessTier'], s['developmentTier'])
       != tiers_for(s['securityTier'], s['securityRating'])])
check('no system is both richest and most developed',
      [s['name'] for s in S if (s['richnessTier'], s['developmentTier']) == (3, 3)])

# ---- planet placement and shape
by_sys = {s['systemId']: s for s in S}
check('planet systemId resolves', [p['planetId'] for p in P if p['systemId'] not in by_sys])
check('planet listed by its system',
      [p['planetId'] for p in P if p['planetId'] not in by_sys[p['systemId']]['planets']])
check('system planets[] all exist',
      ['%s -> %s' % (s['systemId'], pid) for s in S for pid in s['planets']
       if pid not in {p['planetId'] for p in P}])
check('archetype legal for its security tier',
      ['%s: %s in %s' % (p['name'], p['archetype'], by_sys[p['systemId']]['securityTier'])
       for p in P if p['archetype'] not in PLACEMENT[by_sys[p['systemId']]['securityTier']]])
check('yieldModifier <= 1.00 and unscaled',
      ['%s: %s' % (p['name'], p['refinery']['yieldModifier']) for p in P
       if p['refinery']['yieldModifier'] > 1.0
       or p['refinery']['yieldModifier'] != ARCHETYPES[p['archetype']]['yieldModifier']])
check('berths 0 implies an empty yard',
      [p['name'] for p in P if p['shipyard']['berths'] == 0
       and (p['shipyard']['maxHullTonnage'] or p['shipyard']['constructionRatePerTurn'])])

# ---- ladders monotonic
bad = []
for arch in ARCHETYPE_NAMES:
    same = [p for p in P if p['archetype'] == arch]
    for lane in LANES:
        seen = {}
        for p in same:
            seen.setdefault(p['richnessTier'], set()).add(p['extraction'][lane])
        for a in seen:
            for b in seen:
                if a < b and max(seen[a]) > min(seen[b]):
                    bad.append('%s/%s: richness %d out-extracts %d' % (arch, lane, a, b))
    seen = {}
    for p in same:
        seen.setdefault(p['developmentTier'], set()).add(p['manufactory']['throughputPerTurn'])
    for a in seen:
        for b in seen:
            if a < b and max(seen[a]) > min(seen[b]):
                bad.append('%s: development %d out-manufactures %d' % (arch, a, b))
check('richness and development ladders monotonic', bad)

# ---- the gate graph (spec 6.3)
conn = {s['systemId']: s['connections'] for s in S}
check('every toSystemId resolves',
      ['%s -> %s' % (sid, c['toSystemId']) for sid, cs in conn.items() for c in cs
       if c['toSystemId'] not in by_sys])
check('no self-loops', ['%s' % sid for sid, cs in conn.items()
                        if any(c['toSystemId'] == sid for c in cs)])
check('no duplicate connections',
      ['%s' % sid for sid, cs in conn.items()
       if len({c['toSystemId'] for c in cs}) != len(cs)])
check('every system has at least one gate', [sid for sid, cs in conn.items() if not cs])

bad = []
for sid, cs in conn.items():
    for c in cs:
        back = [x for x in conn.get(c['toSystemId'], []) if x['toSystemId'] == sid]
        if len(back) != 1:
            bad.append('%s -> %s: %d return edges' % (sid, c['toSystemId'], len(back)))
        elif back[0]['gateId'] != c['gateId']:
            bad.append('%s <-> %s: gateId disagrees' % (sid, c['toSystemId']))
        elif back[0]['jumpDistanceLy'] != c['jumpDistanceLy']:
            bad.append('%s <-> %s: jumpDistanceLy disagrees' % (sid, c['toSystemId']))
check('connections symmetric, same gateId and distance from both ends', bad)

check('gateId in canonical gate_<lower>_<higher> form',
      [g['gateId'] for g in LINKS['gates']
       if g['a'] >= g['b'] or g['gateId'] != 'gate_%s_%s' % (g['a'], g['b'])])

edges_from_systems = {tuple(sorted([sid, c['toSystemId']])) for sid, cs in conn.items() for c in cs}
edges_from_links = {tuple(sorted([g['a'], g['b']])) for g in LINKS['gates']}
check('links.json matches the union of all connections[]',
      [] if edges_from_systems == edges_from_links
      else ['%d edge(s) differ' % len(edges_from_systems ^ edges_from_links)])

seen, queue = {'sys_001'}, ['sys_001']
while queue:
    cur = queue.pop()
    for c in conn[cur]:
        if c['toSystemId'] not in seen:
            seen.add(c['toSystemId']); queue.append(c['toSystemId'])
check('BFS from sys_001 reaches all 60 systems',
      [] if len(seen) == 60 else ['%d unreachable: %s' % (60 - len(seen),
                                  sorted({s['systemId'] for s in S} - seen)[:5])])

# ---- files on disk
disk_sys, disk_pl = {}, {}
for dp, _, fns in os.walk(MAP_DIR):
    for fn in fns:
        if not fn.endswith('.json') or fn in ('index.json', 'links.json'):
            continue
        o = json.load(open(os.path.join(dp, fn)))
        (disk_sys if fn == 'system.json' else disk_pl)[
            o.get('systemId') if fn == 'system.json' else o['planetId']] = o
check('one file per system', [] if len(disk_sys) == 60 else ['%d system files' % len(disk_sys)])
check('one file per planet', [] if len(disk_pl) == 180 else ['%d planet files' % len(disk_pl)])
check('system file content == fleet json', [s['systemId'] for s in S if disk_sys.get(s['systemId']) != s])
check('planet file content == fleet json', [p['planetId'] for p in P if disk_pl.get(p['planetId']) != p])

check('hand-written spec survived the run',
      [] if os.path.exists(os.path.join(MAP_DIR, 'systems_planets_specification.md'))
      else ['systems_planets_specification.md was deleted by a generator run'])
check('hand-written plan survived the run',
      [] if os.path.exists(os.path.join(MAP_DIR, 'systems_planets_implementation_plan.md'))
      else ['systems_planets_implementation_plan.md was deleted by a generator run'])

print('\n' + ('ALL CHECKS PASSED' if not fails else '%d CHECK(S) FAILED' % len(fails)))
sys.exit(1 if fails else 0)
