#!/usr/bin/env python3
"""Invariant checks for the generated facility catalogue.

The load-bearing one is that leasing never breaks the refining invariant
Systems_Planets 6.1 leaves a 0.01 margin on -- recomputed from the live resource and
skill catalogues against every archetype, not restated as a constant.
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gameplay_tables as T
import gameplay_common as C

FLEET = C.load_fleet()
F = FLEET.get('facilityTypes')
OUT = os.path.join(ROOT, 'GamePlay', 'Facilities')
fails = []


def check(label, bad, show=6):
    if bad:
        fails.append(label); print(f'FAIL {label}: {len(bad)}')
        for b in bad[:show]: print('      ', b)
    else:
        print(f'ok   {label}')


check('fleet json carries "facilityTypes"', [] if F else ['missing -- run generate_facilities.py'])
if not F:
    print('\n1 CHECK(S) FAILED'); sys.exit(1)

prices = C.resource_prices(FLEET)
rows = {(r['archetype'], r['developmentTier']): r for r in F}

check('one row per archetype x development tier',
      [] if len(F) == len(T.PLANET_ARCHETYPES) * len(T.DEVELOPMENT_LADDER)
      else [f'{len(F)} rows, expected {len(T.PLANET_ARCHETYPES) * len(T.DEVELOPMENT_LADDER)}'])

# --- THE SUBDIVISION PRESERVES THE MAP SPEC'S TOTALS ---------------------------
bad = []
for arch, vals in T.PLANET_ARCHETYPES.items():
    a = dict(zip(T.ARCHETYPE_FIELDS, vals))
    for dev, mult in T.DEVELOPMENT_LADDER.items():
        slots = rows[(arch, dev)]['slots']
        for key, capacity, field in (('refinery', a['refinery'], 'throughputPerTurn'),
                                     ('manufactory', a['manufactory'], 'throughputPerTurn'),
                                     ('warehouse', a['warehouse'], 'capacity')):
            if capacity <= 0:
                if key in slots:
                    bad.append(f'{arch} dev{dev}: {key} slot exists for zero capacity')
                continue
            s = slots[key]
            total = s['slotCount'] * s[field]
            # Throughput is published to 4 decimals, so the sum of slotCount slots
            # can legitimately differ from the capacity by slotCount half-units.
            tol = s['slotCount'] * 5e-5 + 1e-9
            if abs(total - capacity * mult) > tol:
                bad.append(f'{arch} dev{dev} {key}: {s["slotCount"]} x {s[field]} = {total} '
                           f'!= {capacity} x {mult} = {capacity * mult}')
        for lane in C.LANES:
            k = f'extraction.{lane}'
            if a[lane] > 0:
                if k not in slots or slots[k]['throughputPerTurn'] != a[lane]:
                    bad.append(f'{arch} dev{dev}: extraction.{lane} != {a[lane]}')
            elif k in slots:
                bad.append(f'{arch} dev{dev}: extraction.{lane} exists for zero extraction')
check('slotCount x slotThroughput reproduces the archetype capacity', bad)

# --- development scales throughput, never slot count ---------------------------
bad = []
for arch in T.PLANET_ARCHETYPES:
    base = rows[(arch, 1)]['slots']
    for dev in (2, 3):
        cur = rows[(arch, dev)]['slots']
        if set(base) != set(cur):
            bad.append(f'{arch} dev{dev}: slot keys changed'); continue
        for k in base:
            if base[k]['slotCount'] != cur[k]['slotCount']:
                bad.append(f'{arch} dev{dev} {k}: slotCount {base[k]["slotCount"]} -> {cur[k]["slotCount"]}')
check('developmentTier changes throughput and leaves slotCount fixed', bad)

check('slotCount >= 1 wherever a slot exists',
      [f'{r["archetype"]} dev{r["developmentTier"]} {k}'
       for r in F for k, s in r['slots'].items() if s['slotCount'] < 1])

# --- zero-berth archetypes -----------------------------------------------------
bad = []
for arch, vals in T.PLANET_ARCHETYPES.items():
    a = dict(zip(T.ARCHETYPE_FIELDS, vals))
    for dev in T.DEVELOPMENT_LADDER:
        has = 'shipyard' in rows[(arch, dev)]['slots']
        if (a['berths'] > 0) != has:
            bad.append(f'{arch} dev{dev}: berths {a["berths"]} but shipyard slot {has}')
        if a['berths'] == 0 and a['maxHullTonnage'] != 0:
            bad.append(f'{arch}: zero berths with maxHullTonnage {a["maxHullTonnage"]}')
check('a zero-berth archetype has no shipyard slot and no tonnage', bad)

# --- THE REFINING INVARIANT SURVIVES LEASING -----------------------------------
skill_mult = C.skill_total_at_10(FLEET, 'refineryYield')
bad, worst = [], 0.0
for r in FLEET['resources']:
    if r['tier'] != 'refined':
        continue
    for arch, vals in T.PLANET_ARCHETYPES.items():
        ym = dict(zip(T.ARCHETYPE_FIELDS, vals))['yieldModifier']
        eff = r['conversionYield'] * ym * skill_mult
        worst = max(worst, eff)
        if eff >= 1.0:
            bad.append(f'{r["lane"]} x {arch}: {r["conversionYield"]} x {ym} x {skill_mult:.4f} = {eff:.4f}')
check(f'refining stays lossy under leasing (worst {worst:.4f}, margin {1 - worst:.4f})', bad)

check('yieldModifier never exceeds 1.00',
      [a for a, v in T.PLANET_ARCHETYPES.items()
       if dict(zip(T.ARCHETYPE_FIELDS, v))['yieldModifier'] > 1.0])
check('yieldModifier scales with neither ladder',
      [f'{r["archetype"]} dev{r["developmentTier"]}' for r in F
       if 'refinery' in r['slots'] and r['slots']['refinery']['yieldModifier']
       != dict(zip(T.ARCHETYPE_FIELDS, T.PLANET_ARCHETYPES[r['archetype']]))['yieldModifier']])

# --- rent -----------------------------------------------------------------------
check('rent is strictly positive everywhere',
      [f'{r["archetype"]} dev{r["developmentTier"]} {k}: {s["rentPerTurn"]}'
       for r in F for k, s in r['slots'].items() if s['rentPerTurn'] <= 0])

bad = []
for arch in T.PLANET_ARCHETYPES:
    for k in rows[(arch, 1)]['slots']:
        if k.startswith('extraction.'):
            continue          # extraction scales with richness, not development
        seq = [rows[(arch, d)]['slots'][k]['rentPerTurn'] for d in sorted(T.DEVELOPMENT_LADDER)]
        if any(a >= b for a, b in zip(seq, seq[1:])):
            bad.append(f'{arch} {k}: {seq}')
check('rent rises strictly with development tier', bad)

bad = []
for r in F:
    for lane in C.LANES:
        k = f'extraction.{lane}'
        if k in r['slots']:
            s = r['slots'][k]
            gross = s['throughputPerTurn'] * prices[lane]['raw']
            if not (0 < s['rentPerTurn'] < gross):
                bad.append(f'{r["archetype"]} {k}: rent {s["rentPerTurn"]} vs gross {gross:.2f}')
check('extraction rent is less than the slot gross output value', bad)

# --- gating ----------------------------------------------------------------------
gates = C.science_gate_levels(FLEET)
chain = json.load(open(os.path.join(OUT, 'chain.json')))['stages'] if os.path.exists(
    os.path.join(OUT, 'chain.json')) else []
check('every chain stage gate matches skl_sta_science unlocks',
      [f'{c["stage"]}: {c["scienceLevel"]} != {gates[T.SCIENCE_GATE[c["facilityType"]]]}'
       for c in chain if c['scienceLevel'] != gates[T.SCIENCE_GATE[c['facilityType']]]])
check('every facility type names a skill that exists',
      [s for s in T.FACILITY_SKILL.values() if s not in C.skill_by_id(FLEET)])

stats = [c['stat'] for c in chain]
check('each of the five station_management stats is multiplied by exactly one stage',
      [s for s in set(stats) if stats.count(s) != 1]
      + [] if len(stats) == len(set(stats)) else ['duplicate stat'])

# --- placement --------------------------------------------------------------------
check('archetype placement agrees with the security tiers',
      [f'{r["archetype"]}: {r["securityTiers"]}' for r in F
       if r['securityTiers'] != T.ARCHETYPE_PLACEMENT[r['archetype']]])
check('no forge world in rim or deadspace, no irradiated or shattered world in core',
      [a for a in ('forge_world',) if set(T.ARCHETYPE_PLACEMENT[a]) & {'rim', 'deadspace'}]
      + [a for a in ('irradiated', 'shattered') if set(T.ARCHETYPE_PLACEMENT[a]) & {'core', 'mid'}])

# --- construction figures quoted in the spec ---------------------------------------
ship_mult = C.skill_total_at_10(FLEET, 'shipConstructionRate')
fw = rows[('forge_world', 3)]['slots']['shipyard']
bs = next(s for s in FLEET['ships'] if s['shipId'] == 'ship_battleship_t3')
cost = sum(bs['buildCost'].values())
per = fw['throughputPerTurn'] * ship_mult
check('a forge world at dev 3 fielding all berths matches Systems_Planets 7 (234/turn)',
      [] if abs(per * fw['slotCount'] - 234.0) < 0.5 else [f'{per * fw["slotCount"]:.1f}/turn'])
check('the heaviest hull fits the best yard',
      [] if fw['maxHullTonnage'] >= bs['mass']['value']
      else [f'yard {fw["maxHullTonnage"]} < battleship {bs["mass"]["value"]}'])
print(f'     (Battleship T3: {cost / per:.0f} turns on one berth, '
      f'{cost / (per * fw["slotCount"]):.0f} on all {fw["slotCount"]})')

# --- against the live planet catalogue --------------------------------------------
# tools/generate_systems.py has landed, so the archetype x devTier table can now be
# checked against real planets rather than only against the archetype table it came
# from. A lease is still runtime state; this confirms the rate table covers the map.
planets = FLEET.get('planets') or []
if planets:
    check('every planet archetype has a facility row',
          sorted({p['archetype'] for p in planets if (p['archetype'], 1) not in rows}))
    check('every planet developmentTier has a facility row',
          sorted({p['developmentTier'] for p in planets
                  if (p['archetype'], p['developmentTier']) not in rows}))
    bad = []
    for p in planets:
        r = rows[(p['archetype'], p['developmentTier'])]['slots']
        for key, published in (('refinery', p['refinery']['throughputPerTurn']),
                               ('manufactory', p['manufactory']['throughputPerTurn']),
                               ('warehouse', p['warehouse']['capacity'])):
            if key not in r:
                if published:
                    bad.append(f'{p["planetId"]}: {key} {published} but no slot row')
                continue
            field = 'capacity' if key == 'warehouse' else 'throughputPerTurn'
            total = r[key]['slotCount'] * r[key][field]
            if abs(total - published) > r[key]['slotCount'] * 5e-5 + 1e-6:
                bad.append(f'{p["planetId"]} {p["archetype"]} dev{p["developmentTier"]} {key}: '
                           f'slots sum {total} != planet {published}')
    check(f'slot rows sum to the published capacity on all {len(planets)} planets', bad)
    bad = []
    for p in planets:
        r = rows[(p['archetype'], p['developmentTier'])]['slots']
        y = r.get('shipyard')
        if bool(y) != bool(p['shipyard']['berths']):
            bad.append(f'{p["planetId"]}: berths {p["shipyard"]["berths"]} vs slot {bool(y)}')
        elif y and abs(y['slotCount'] * y['throughputPerTurn'] - p['shipyard']['constructionRatePerTurn']) > 1e-4:
            bad.append(f'{p["planetId"]}: berth rate sum != planet constructionRatePerTurn')
    check('berth counts and construction rates agree with every planet', bad)
    check('every planet can be leased somewhere it is allowed to exist',
          [p['planetId'] for p in planets
           if p['archetype'] not in T.ARCHETYPE_PLACEMENT])
    yards = [p for p in planets if p['shipyard']['berths']]
    heaviest = max(s['mass']['value'] for s in FLEET['ships'])
    check(f'some yard takes the heaviest hull ({heaviest:,.0f} t)',
          [] if any(p['shipyard']['maxHullTonnage'] >= heaviest for p in yards)
          else [f'best yard {max(p["shipyard"]["maxHullTonnage"] for p in yards):,.0f} t'])
else:
    print('--   planet cross-checks skipped (no "planets" key yet)')

check('the hand-written spec survived the run',
      [] if os.path.exists(os.path.join(ROOT, 'GamePlay', 'industry_specification.md')) else ['missing'])

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} CHECK(S) FAILED'))
sys.exit(1 if fails else 0)
