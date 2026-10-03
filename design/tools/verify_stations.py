#!/usr/bin/env python3
"""Invariant checks for orbital stations -- GamePlay/station_specification.md.

Stations add capacity beside the planets', so every check that matters is held against
another catalogue: the resource and skill catalogues for lossy refining, the facility rows
for rent and yard tonnage, the live map for the build-out and for where yards may exist.
Nothing here is read off the page; the spec's tables are recomputed and compared.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gameplay_tables as T
import gameplay_common as C

FLEET = C.load_fleet()
S = FLEET.get('stationTypes')
SPEC = 'GamePlay/station_specification.md'
OUT = os.path.join(ROOT, 'GamePlay', 'Stations')
fails = []


def check(label, bad, show=6):
    if bad:
        fails.append(label); print(f'FAIL {label}: {len(bad)}')
        for b in bad[:show]: print('      ', b)
    else:
        print(f'ok   {label}')


def section_text(doc, sec):
    text = open(os.path.join(ROOT, doc)).read()
    m = re.search(rf'^(#+) {re.escape(sec)}\.? ', text, re.M)
    if not m:
        return ''
    rest = text[m.end():]
    n = re.search(rf'^#{{1,{len(m.group(1))}}} ', rest, re.M)
    return rest[:n.start()] if n else rest


def nums(cells):
    return [float(x.replace(',', '').replace('%', '').strip()) for x in cells]


check('fleet json carries "stationTypes"', [] if S else ['missing -- run generate_stations.py'])
if not S:
    print('\n1 CHECK(S) FAILED'); sys.exit(1)

rows = {(r['stationTypeId'], r['developmentTier']): r for r in S}
types = {sid: (name, hosted) for sid, name, hosted in T.STATION_TYPES}
prices = C.resource_prices(FLEET)

print('--- the catalogue ---')
check('one row per station type x development tier',
      sorted(set(rows) ^ {(sid, d) for sid in types for d in T.DEVELOPMENT_LADDER}))
disk = json.load(open(os.path.join(OUT, 'station_types.json'))) if os.path.exists(
    os.path.join(OUT, 'station_types.json')) else {}
check('GamePlay/Stations/station_types.json matches the fleet json',
      [] if disk.get('stationTypes') == S else ['differs or missing -- re-run generate_stations.py'])
iface = open(os.path.join(ROOT, 'Data-Templates', 'station.interface')).read()
body = json.loads('\n'.join(l for l in iface.splitlines() if not l.lstrip().startswith('#')))
check('station.interface stationType declares exactly the generated row fields',
      sorted({k for k in body['stationType'] if '.' not in k} ^ {k for r in S for k in r}))

# --- slots: the planet slot model, less extraction -----------------------------------
SIZE = {'refinery': T.REFINERY_SLOT_SIZE, 'manufactory': T.MANUFACTORY_SLOT_SIZE,
        'shipyard': T.STATION_BERTH_RATE, 'warehouse': T.WAREHOUSE_SLOT_SIZE}
bad = []
for (sid, dev), r in rows.items():
    mult = T.DEVELOPMENT_LADDER[dev]
    if set(r['slots']) != set(types[sid][1]):
        bad.append(f'{sid} dev{dev}: hosts {sorted(r["slots"])}, table says {sorted(types[sid][1])}')
        continue
    for kind, s in r['slots'].items():
        per = s[C.STATION_CAPACITY_FIELD[kind]]
        if s['slotCount'] != types[sid][1][kind] or abs(per - SIZE[kind] * mult) > 5e-5:
            bad.append(f'{sid} dev{dev} {kind}: {s["slotCount"]} x {per} != '
                       f'{types[sid][1][kind]} x {SIZE[kind]} x {mult}')
        if kind == 'shipyard' and abs(s['maxHullTonnage'] - T.STATION_BERTH_TONNAGE * mult) > 0.05:
            bad.append(f'{sid} dev{dev}: tonnage {s["maxHullTonnage"]}')
check('station slots are the planet slot sizes (a berth, the station pair) x the development multiplier', bad)
check('no station hosts extraction -- planetaryProductionRate stays a planetary stat',
      sorted({f'{r["stationTypeId"]}: {k}' for r in S for k, s in r['slots'].items()
              if k == 'extraction' or s['facilityType'] == 'extraction'}))
skills = C.skill_by_id(FLEET)
check('every hosted kind is multiplied by a station-scope skill in the live catalogue',
      sorted({k for r in S for k in r['slots']
              if skills.get(T.FACILITY_SKILL.get(k), {}).get('scope') != 'station'}))
check('every producing station carries a warehouse for its output',
      sorted({r['stationTypeId'] for r in S
              if set(r['slots']) - {'warehouse'} and 'warehouse' not in r['slots']}))

print('\n--- refining stays lossy (gameplay 6.3) ---')
mult10 = C.skill_total_at_10(FLEET, 'refineryYield')
ym = {r['slots']['refinery']['yieldModifier'] for r in S if 'refinery' in r['slots']}
worst = max(res['conversionYield'] for res in FLEET['resources'] if res['tier'] == 'refined') * max(ym or {0}) * mult10
check(f'conversionYield x station yieldModifier x refineryYield < 1 (worst {worst:.4f})',
      [] if worst < 1.0 else [f'{worst:.4f}'])
check('the station yieldModifier is STATION_YIELD_MODIFIER at every tier, and at most 1.00',
      [] if ym == {T.STATION_YIELD_MODIFIER} and T.STATION_YIELD_MODIFIER <= 1.0 else [sorted(ym)])

print('\n--- where, and how big (station 2.1, 6) ---')
arch = {a: dict(zip(T.ARCHETYPE_FIELDS, v)) for a, v in T.PLANET_ARCHETYPES.items()}
yard_tiers = {t for a, tiers in T.ARCHETYPE_PLACEMENT.items() if arch[a]['berths'] > 0 for t in tiers}
check('no station brings a yard to a tier where the map places no planet yard (deadspace builds no hull)',
      sorted({f'{r["stationTypeId"]}: {t}' for r in S if 'shipyard' in r['slots']
              for t in r['securityTiers'] if t not in yard_tiers}))
check('every row is anchored in exactly STATION_TIERS',
      sorted({r['stationTypeId'] for r in S if r['securityTiers'] != T.STATION_TIERS}))
fac = {(r['archetype'], r['developmentTier']): r for r in FLEET['facilityTypes']}
heaviest = max(s['mass']['value'] for s in FLEET['ships'])
bad = []
for (sid, dev), r in rows.items():
    y = r['slots'].get('shipyard')
    if not y:
        continue
    smallest = min(f['slots']['shipyard']['maxHullTonnage'] for (a, d), f in fac.items()
                   if d == dev and 'shipyard' in f['slots'])
    if y['maxHullTonnage'] > smallest or y['maxHullTonnage'] >= heaviest:
        bad.append(f'{sid} dev{dev}: {y["maxHullTonnage"]} t vs smallest planet yard {smallest} t, heaviest hull {heaviest} t')
check('the capital keel stays planetary: a station berth never out-tons the smallest planet yard at its tier', bad)

out = C.station_buildout(FLEET)
check('stations supplement, never supplant: every orbit filled holds less of each kind than the planets',
      [f'{k}: {b["stations"]:,.1f} >= {b["planets"]:,.1f}' for k, b in out.items() if b['share'] >= 1.0])
sec = section_text(SPEC, '2.1')
bad = []
for k, b in out.items():
    m = re.search(rf'^\| {k} \|(.*)\|$', sec, re.M)
    if not m:
        bad.append(f'no row for {k}'); continue
    cells = nums(m.group(1).split('|'))
    want = [(b['stations'], 1), (b['planets'], 1), (100 * b['share'], 0)]
    if len(cells) != 3 or any(abs(c - w) > 0.5 * 10 ** -d + 1e-9 for c, (w, d) in zip(cells, want)):
        bad.append(f'{k}: spec {cells} != live {[round(w, d) for w, d in want]}')
n_planets = sum(1 for p in FLEET['planets']
                if {s['systemId']: s['securityTier'] for s in FLEET['systems']}[p['systemId']] in T.STATION_TIERS)
if f'all {n_planets} planets' not in sec:
    bad.append(f'planet count {n_planets} not stated')
check('station 2.1 build-out table recomputes from the live map', bad)

print('\n--- upkeep (station 4) ---')
bad = []
for (sid, dev), r in rows.items():
    want = T.STATION_UPKEEP_RATE * sum(s['slotCount'] * s['rentPerTurn'] for s in r['slots'].values())
    if abs(r['upkeepPerTurn'] - want) > 0.006 or r['upkeepPerTurn'] <= 0:
        bad.append(f'{sid} dev{dev}: upkeep {r["upkeepPerTurn"]} != {want:.2f}')
    for kind, s in r['slots'].items():
        per = s[C.STATION_CAPACITY_FIELD[kind]]
        live = C.slot_rent(kind, per, prices, s.get('yieldModifier'))
        if abs(s['rentPerTurn'] - live) > 0.006 or s['rentPerTurn'] <= 0:
            bad.append(f'{sid} dev{dev} {kind}: rent {s["rentPerTurn"]} != {live:.2f}')
check('upkeep is STATION_UPKEEP_RATE x the slot rents, each the industry 7 formula, all positive', bad)
bad = []
for (sid, dev), r in rows.items():
    for kind, s in r['slots'].items():
        field = C.STATION_CAPACITY_FIELD[kind]
        # Both rents are published to the cent; give each side its half-cent of rounding.
        leases = [(f['slots'][kind]['rentPerTurn'] - 0.005) / f['slots'][kind][field]
                  for (a, d), f in fac.items() if d == dev and kind in f['slots']]
        mine = T.STATION_UPKEEP_RATE * (s['rentPerTurn'] + 0.005) / s[field]
        if leases and mine < min(leases) - 1e-9:
            bad.append(f'{sid} dev{dev} {kind}: {mine:.5f}/unit < cheapest lease {min(leases):.5f}/unit')
check('a station never undercuts the lease market: upkeep per unit >= the cheapest lease at that tier', bad)
check('station upkeep is a listed drain naming STATION_UPKEEP_RATE',
      [] if ('station_upkeep', 'STATION_UPKEEP_RATE') in [(n, c) for n, c, _ in T.DRAINS] else ['missing'])
sec = section_text(SPEC, '4')
bad = []
for sid, (name, _) in types.items():
    m = re.search(rf'^\| {re.escape(name)} \|(.*)\|$', sec, re.M)
    want = [rows[(sid, d)]['upkeepPerTurn'] for d in sorted(T.DEVELOPMENT_LADDER)]
    cells = nums(m.group(1).split('|')) if m else None
    if cells is None or len(cells) != len(want) or any(abs(c - w) > 0.005 for c, w in zip(cells, want)):
        bad.append(f'{name}: spec {cells} != live {want}')
check('station 4 upkeep table recomputes', bad)

print('\n--- the kit (station 3) ---')
bad = []
for (sid, dev), r in rows.items():
    cost = C.station_build_cost(types[sid][1])
    if any(abs(r['buildCost'][l] - cost[l]) > 1e-4 for l in C.LANES) \
            or abs(r['kitUnits'] - sum(cost.values())) > 1e-4 \
            or abs(r['referencePrice'] - C.reference_price(cost, prices)) > 0.006:
        bad.append(f'{sid} dev{dev}')
    if r['buildCost'] != rows[(sid, 1)]['buildCost']:
        bad.append(f'{sid} dev{dev}: kit cost varies with the orbit')
check('a kit is its frame plus its slots, priced by the economy 2 formula, the same at every tier', bad)
turns, rates = C.station_kit_turns(FLEET)
sec = section_text(SPEC, '3.1')
bad = []
for sid, (name, _) in types.items():
    m = re.search(rf'^\| {re.escape(name)} \|(.*)\|$', sec, re.M)
    r = rows[(sid, 1)]
    want = [(r['kitUnits'], 1), (r['referencePrice'], 0)] + [(t, 0) for t in turns[sid]]
    cells = nums(m.group(1).split('|')) if m else None
    if cells is None or len(cells) != len(want) or any(abs(c - w) > 0.5 * 10 ** -d + 1e-9 for c, (w, d) in zip(cells, want)):
        bad.append(f'{name}: spec {cells} != live {[round(w, d) for w, d in want]}')
for rate in rates:
    if f'{rate:g} a turn' not in sec and f'{rate:g} on' not in sec:
        bad.append(f'berth rate {rate:g} not stated')
check('station 3.1 kit table recomputes from the live catalogues', bad)

print('\n--- the order and the gate (station 3.2) ---')
gate = C.science_gate_levels(FLEET)[T.SCIENCE_GATE[T.STATION_DEPLOY_FACILITY]]
check(f'the deploy gate is the {T.STATION_DEPLOY_FACILITY}-lease gate, Science {gate} read live, as 3.2 states',
      [] if T.STATION_DEPLOY_FACILITY in T.FACILITY_SKILL and f'**Science {gate}**' in section_text(SPEC, '3.2')
      else [f'Science {gate} not stated'])
check('station.deploy resolves in the phase facility.lease does, and names a tie-break',
      [] if T.ORDER_TYPES.get('station.deploy') == T.ORDER_TYPES['facility.lease'] and T.CONTENDED.get('station.deploy')
      else [T.ORDER_TYPES.get('station.deploy')])

print('\n--- mirrors ---')
consts = open(os.path.join(ROOT, 'Reference', 'constants.ts')).read()


def ts_block(name):
    mm = re.search(rf'export const {name} = \{{(.*?)\n\}} as const', consts, re.S)
    return mm.group(1) if mm else ''


sc = ts_block('STATION_CONSTANTS')


def ts_num(block, key):
    mm = re.search(rf'\b{key}:\s*(-?[\d.]+)', block)
    return float(mm.group(1)) if mm else None


def ts_list(block, key):
    mm = re.search(rf'\b{key}:\s*\[(.*?)\]', block)
    return re.findall(r"'(\w+)'", mm.group(1)) if mm else None


def ts_nested(name):
    return {k: {kk: float(vv) for kk, vv in re.findall(r'(\w+):\s*([\d.]+)', v)}
            for k, v in re.findall(r'(\w+):\s*\{(.*?)\}', ts_block(name))}


bad = [k for k, v in (('orbitsPerPlanet', T.ORBITS_PER_PLANET), ('stationYieldModifier', T.STATION_YIELD_MODIFIER),
                      ('stationBerthRate', T.STATION_BERTH_RATE), ('stationBerthTonnage', T.STATION_BERTH_TONNAGE),
                      ('upkeepRate', T.STATION_UPKEEP_RATE), ('upkeepGraceTurns', T.STATION_GRACE_TURNS))
       if ts_num(sc, k) != v]
bad += [k for k, v in (('securityTiers', T.STATION_TIERS), ('siteTypes', T.STATION_SITE_TYPES)) if ts_list(sc, k) != v]
if f"deployFacility: '{T.STATION_DEPLOY_FACILITY}'" not in sc:
    bad.append('deployFacility')
frame = {k: float(v) for k, v in re.findall(r'(\w+):\s*([\d.]+)', ts_block('STATION_FRAME_COST'))}
if frame != T.STATION_FRAME_COST:
    bad.append('STATION_FRAME_COST')
if ts_nested('STATION_SLOT_COST') != T.STATION_SLOT_COST:
    bad.append('STATION_SLOT_COST')
if ts_nested('STATION_TYPE_SLOTS') != {sid: {k: float(n) for k, n in h.items()} for sid, _, h in T.STATION_TYPES}:
    bad.append('STATION_TYPE_SLOTS')
check('constants.ts station constants match gameplay_tables.py', bad)
sts = open(os.path.join(ROOT, 'Reference', 'stations.ts')).read()
m = re.search(r'export type StationTypeId =(.*?);', sts, re.S)
check('Reference/stations.ts StationTypeId lists exactly the station types',
      sorted(set(re.findall(r"'(\w+)'", m.group(1) if m else '')) ^ set(types)))
m = re.search(r'export interface StationTypeRow \{(.*?)\n\}', sts, re.S)
check('Reference/stations.ts StationTypeRow declares exactly the generated row fields',
      sorted(set(re.findall(r'^\s{2}(\w+)\??:', m.group(1) if m else '', re.M)) ^ {k for r in S for k in r}))
fts = open(os.path.join(ROOT, 'Reference', 'facilities.ts')).read()
lease = re.search(r'export interface Lease \{(.*?)\n\}', fts, re.S)
check('a lease can name the station hosting it (facilities.ts and facility.interface)',
      [w for w, ok in (('facilities.ts', lease and re.search(r'^\s+stationId:', lease.group(1), re.M)),
                       ('facility.interface', '"stationId"' in open(os.path.join(ROOT, 'Data-Templates', 'facility.interface')).read()))
       if not ok])

check('the hand-written spec survived the run',
      [] if os.path.exists(os.path.join(ROOT, SPEC)) else ['missing'])

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} CHECK(S) FAILED'))
sys.exit(1 if fails else 0)
