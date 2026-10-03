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
        'economy_specification.md', 'conflict_specification.md', 'lore_specification.md',
        'fitting_specification.md', 'station_specification.md']


def check(label, bad, show=6):
    if bad:
        fails.append(label); print(f'FAIL {label}: {len(bad)}')
        for b in bad[:show]: print('      ', b)
    else:
        print(f'ok   {label}')


def section_text(doc, sec):
    """The body of the heading numbered `sec` in `doc`, up to the next heading at its level or above."""
    text = open(os.path.join(ROOT, doc)).read()
    m = re.search(rf'^(#+) {re.escape(sec)}\.? ', text, re.M)
    if not m:
        return None
    rest = text[m.end():]
    n = re.search(rf'^#{{1,{len(m.group(1))}}} ', rest, re.M)
    return rest[:n.start()] if n else rest


print('--- documents ---')
check('every document named in gameplay_specification.md 4 exists',
      [d for d in DOCS if not os.path.exists(os.path.join(GP, d))])
spec4 = section_text('GamePlay/gameplay_specification.md', '4') or ''
named = set(re.findall(r'^\| `([\w]+\.md)` \|', spec4, re.M))
check('DOCS is exactly the document table of gameplay_specification.md 4',
      sorted(named ^ set(DOCS)) if named else ['section 4 table not found'])
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


# Existence was never enough: a rule could cite a section that never mentions the stat.
# Now the cited section must name it -- unless the stat is parked on a combat ruling that
# is still open, which combat.ts must say in so many words.
import combat_tables as CT
combat_ts = open(os.path.join(ROOT, 'Reference', 'combat.ts')).read()
open_rulings = {r for r, s in re.findall(r"id: '(R\d+)',.*?status: '(open|ruled)'", combat_ts, re.S) if s == 'open'}
bad = []
for stat, (doc, sec, _) in sorted(T.STAT_RULES.items()):
    body = section_text(doc, sec)
    if body is None:
        bad.append(f'{stat}: {doc} has no section {sec}')
    elif stat in CT.PENDING_RULINGS:
        if CT.PENDING_RULINGS[stat] not in open_rulings:
            bad.append(f'{stat}: parked on {CT.PENDING_RULINGS[stat]}, which is no longer open -- write its rule')
    elif not re.search(rf'(?<![\w.]){re.escape(stat)}(?![\w])', body):
        bad.append(f'{stat}: {os.path.basename(doc)} {sec} never names it')
check('every rule\'s cited section names its stat (or parks it on an open ruling)', bad)
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
# A station refinery's yieldModifier stands in for the planet's (station_specification.md 2.2),
# so it competes for the worst case on the same three-term product -- never a fourth term.
for st in FLEET.get('stationTypes', []):
    sy = st['slots'].get('refinery')
    if not sy:
        continue
    for r in FLEET['resources']:
        if r['tier'] == 'refined' and r['conversionYield'] * sy['yieldModifier'] * mult > worst:
            worst, where = r['conversionYield'] * sy['yieldModifier'] * mult, f'{r["lane"]} x {st["stationTypeId"]}'
check(f'conversionYield x yieldModifier x refineryYield < 1, planets and stations (worst {worst:.4f} on {where}, margin {1 - worst:.4f})',
      [] if worst < 1.0 else [f'{where} reaches {worst:.4f}'])
check('GamePlay adds no fourth multiplier to yield',
      [f'{r["archetype"]} dev{r["developmentTier"]}' for r in FLEET.get('facilityTypes', [])
       if 'refinery' in r['slots'] and r['slots']['refinery'].get('scalesWith') != 'developmentTier']
      + [f'{r["stationTypeId"]} dev{r["developmentTier"]}' for r in FLEET.get('stationTypes', [])
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
        if re.search(r'(?i)(max(imum)?\s+(of\s+)?5|5\s*(ship|hull)s?\s*(max|cap|limit)'
                     r'|(more than|up to|at most|no more than)\s+(5|five)\s*(ship|hull)?s?\b(?!\s*(turns?|ly|units))'
                     r'|\b(5|five)-(ship|hull)\s+(cap|limit|max))', line) \
                and 'Formation Drill' not in line and '>' not in line:
            bad.append(f'{d}:{i}: {line.strip()[:70]}')
check('no document asserts a numeric fleet cap in its own voice', bad)

# One fleet per player (owner ruling, logistics 1.2): the player record names ONE fleet, the
# fleet record carries the docked hulls the Formation Drill bound also covers, and no order,
# schema, type or document brings back fleet splitting or several fleets per player.
bad = []
pbody = json.loads('\n'.join(l for l in open(os.path.join(ROOT, 'Data-Templates', 'player.interface'))
                             if not l.lstrip().startswith('#')))
if 'fleetId' not in pbody or 'fleetIds' in pbody:
    bad.append(f'player.interface fleet field(s): {sorted(k for k in pbody if k.startswith("fleet"))}')
player_ts = open(os.path.join(ROOT, 'Reference', 'gameplay.ts')).read()
m = re.search(r'export interface Player \{(.*?)\n\}', player_ts, re.S)
if not (m and re.search(r'^\s+fleetId: FleetId;', m.group(1), re.M)):
    bad.append('Reference/gameplay.ts Player does not carry one fleetId: FleetId')
fbody = json.loads('\n'.join(l for l in open(os.path.join(ROOT, 'Data-Templates', 'fleet.interface'))
                             if not l.lstrip().startswith('#')))
if 'docked' not in fbody.get('fleet', {}):
    bad.append('fleet.interface fleet carries no docked hulls')
fhead = open(os.path.join(ROOT, 'Data-Templates', 'fleet.interface')).read()
if not re.search(r'len\(hulls\) \+ len\(docked\) <= 1 \+ Formation Drill', fhead):
    bad.append('fleet.interface: the Formation Drill invariant does not bound hulls + docked')
bad += [f'ORDER_TYPES: {k}' for k in T.ORDER_TYPES if re.search(r'organi[sz]e|split|merge', k)]
several = re.compile(r'(?i)fleet\.organi[sz]e|FleetOrganize|(may|can) hold several fleets|several of (a|the) player.s fleets'
                     r'|across all (of )?(a|the|one) player.s fleets|one of the (player|poster).s fleets')
for folder, ext in (('GamePlay', '.md'), ('Data-Templates', '.interface'), ('Reference', '.ts')):
    for f in sorted(os.listdir(os.path.join(ROOT, folder))):
        if f.endswith(ext) and f != 'schema_coverage.md':     # the audit's history may name the old rule
            for i, line in enumerate(open(os.path.join(ROOT, folder, f)), 1):
                if several.search(line):
                    bad.append(f'{folder}/{f}:{i}: {line.strip()[:70]}')
check('a player has exactly one fleet: Player names one fleetId, docked hulls sit on it, nothing splits fleets', bad)

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

print('\n--- one order list, four places (turn 3) ---')
spec3 = section_text('GamePlay/turn_specification.md', '3') or ''
spec_orders = {}
for cell, phases in re.findall(r'^\| ((?:`[\w.]+`(?: · )?)+) \| ([\d–, ]+) \|', spec3, re.M):
    nums = set()
    for part in phases.split(','):
        a, _, b = part.strip().partition('–')
        nums |= set(range(int(a), int(b or a) + 1))
    for name in re.findall(r'`([\w.]+)`', cell):
        spec_orders[name] = sorted(nums)
iface = open(os.path.join(ROOT, 'Data-Templates', 'turn_order.interface')).read()
mirror = iface.split('# <<< mirrors', 1)[-1].split('# >>> end mirror', 1)[0]
iface_orders = {n: sorted(int(x) for x in re.findall(r'\d+', ph))
                for n, ph in re.findall(r'^#\s+([\w]+\.[\w]+)\s+phases? ([\d, ]+)$', mirror, re.M)}
gts = open(os.path.join(ROOT, 'Reference', 'gameplay.ts')).read()
m = re.search(r'export type OrderType =(.*?);', gts, re.S)
ts_orders = set(re.findall(r"'([\w.]+)'", m.group(1))) if m else set()
table = {k: sorted(v) for k, v in T.ORDER_TYPES.items()}
check('turn spec 3 order table lists exactly ORDER_TYPES, with the same phases',
      [f'{k}: spec {spec_orders.get(k)} != table {table.get(k)}' for k in set(spec_orders) | set(table)
       if spec_orders.get(k) != table.get(k)])
check('turn_order.interface order list mirrors ORDER_TYPES',
      [f'{k}: interface {iface_orders.get(k)} != table {table.get(k)}' for k in set(iface_orders) | set(table)
       if iface_orders.get(k) != table.get(k)])
check('Reference/gameplay.ts OrderType lists exactly ORDER_TYPES',
      sorted(ts_orders ^ set(table)))

print('\n--- hauling and escort (economy 8, logistics 8) ---')
prices = C.resource_prices(FLEET)
weapons, modules, ships = C.catalogues(FLEET)
H = C.representative_haul(FLEET)
rows = {r['tier']: r for r in H['rows']}
tiers = T.SECURITY_TIERS
check(f'the representative haul ({H["shipId"]}, a hold of {H["lane"]}) clears its running cost at every tier',
      [f'{t}: margin {rows[t]["marginPerLy"]:.1f}/ly' for t in tiers if rows[t]['marginPerLy'] <= 0])
be = [rows[t]['breakEvenLossPer100Ly'] for t in tiers]
check('break-even loss rate rises strictly as security falls -- risk is priced faster than insurance thins',
      [] if all(a < b for a, b in zip(be, be[1:])) else [[round(x, 4) for x in be]])
check('the escort quote is zero exactly where PvP is blocked',
      [t for t in tiers if (rows[t]['escortPerLy'] == 0) == T.PVP_ALLOWED[t]])
hauler = C.representative_hauler(FLEET)
check(f'freight covers the round-trip running cost of every {hauler["shipClass"]} tier',
      [f'{s["shipId"]}: {2 * C.leg_cost_per_ly(FLEET, s, prices, weapons, modules) / s["capacities"]["cargo"]:.5f} '
       f'>= {T.HAUL_FREIGHT_RATE}' for s in FLEET['ships'] if s['shipClass'] == hauler['shipClass']
       and 2 * C.leg_cost_per_ly(FLEET, s, prices, weapons, modules) / s['capacities']['cargo'] >= T.HAUL_FREIGHT_RATE])
pace = C.ly_per_turn(hauler)
escort_cost = {sid: 2 * C.leg_cost_per_ly(FLEET, ships[sid], prices, weapons, modules, pace)
               for sid in ('ship_destroyer_t3', 'ship_anti_aircraft_cruiser_t3')}
unpoliced = [t for t in tiers if t not in T.RESPONSE_FLEET]
check(f'where no response fleet comes ({", ".join(unpoliced)}), the escort quote covers a Destroyer T3 at the hauler\'s pace',
      [f'{t}: quote {rows[t]["escortPerLy"]:.1f} <= cost {escort_cost["ship_destroyer_t3"]:.1f}'
       for t in unpoliced if rows[t]['escortPerLy'] <= escort_cost['ship_destroyer_t3']])
own = {lane: {r['tier']: r for r in C.own_account_hauls(FLEET, lane)} for lane in ('precision', 'structural')}
check('own-account precision ore pays its way to an NPC market from every tier without one',
      [f'{t}: {r["netPerTrip"]:,.0f}' for t, r in own['precision'].items() if r['netPerTrip'] <= 0]
      + [t for t in tiers if t not in T.NPC_ORDER_TIERS and t not in own['precision']])
# 6.2 extended: keeping an NPC haul's cargo never beats delivering it.
bad = []
for i, ptier in enumerate(T.PRICE_INDEX_TIERS):
    for level in range(0, 11):
        margin = eff['modifierPerLevel'] * max(0, level - eff['appliesFromLevel'] + 1) / 100.0
        h = C.half_spread(margin)
        for t in T.NPC_ORDER_TIERS:
            for quote, name in ((T.PRICE_INDEX[t][i] * (1 - h), 'bid'), (T.PRICE_INDEX[t][i] * (1 + h), 'ask')):
                if quote > C.collateral_factor(ptier) + 1e-12:
                    bad.append(f'{ptier} L{level} {t} {name} {quote:.4f} > collateral {C.collateral_factor(ptier):.4f}')
check('haul collateral is at least every NPC bid and ask for the good, at every trade level', bad)


def nums(row):
    return [float(x.replace(',', '').replace('−', '-').replace('%', '').strip()) for x in row]


sec83 = section_text('GamePlay/economy_specification.md', '8.3') or ''
bad = []
seen = set()
for tier, rest in re.findall(r'^\| `(\w+)` \|(.*)\|$', sec83, re.M):
    cells = nums(rest.split('|'))
    if len(cells) == 7:
        r = rows[tier]; seen.add(('haul', tier))
        want = [(r['rewardPerLy'], 1), (r['costPerLy'], 1), (r['marginPerLy'], 1), (r['escortPerLy'], 1),
                (r['keepsPerLy'], 1), (r['exposure'], 0), (100 * r['breakEvenLossPer100Ly'], 1)]
    elif len(cells) == 4:
        p, s_ = own['precision'][tier], own['structural'][tier]; seen.add(('own', tier))
        want = [(p['routeLy'], 1), (p['turnsLaden'], 1), (p['netPerTrip'], 0), (s_['netPerTrip'], 0)]
    else:
        bad.append(f'{tier}: unexpected row width {len(cells)}'); continue
    # A published figure must be the live one to its stated precision (half a unit, either way).
    if any(abs(c - w) > 0.5 * 10 ** -d + 1e-9 for c, (w, d) in zip(cells, want)):
        bad.append(f'{tier}: spec {cells} != live {[round(w, d) for w, d in want]}')
missing = {('haul', t) for t in tiers} | {('own', t) for t in own['precision']}
bad += [f'no row for {k}' for k in sorted(missing - seen)]
for sid, label in (('ship_destroyer_t3', 'Destroyer T3'), ('ship_anti_aircraft_cruiser_t3', 'Anti-Aircraft Cruiser T3')):
    if f'{escort_cost[sid]:.1f}' not in sec83:
        bad.append(f'{label} running cost {escort_cost[sid]:.1f} not stated')
check('economy 8.3 tables and escort costs recompute from the live catalogues', bad)

consts = open(os.path.join(ROOT, 'Reference', 'constants.ts')).read()
hc = consts.split('export const HAULING_CONSTANTS', 1)[-1].split('} as const', 1)[0]


def ts_val(key):
    mm = re.search(rf'\b{key}:\s*(-?[\d.]+)', hc)
    return float(mm.group(1)) if mm else None


check('constants.ts HAULING_CONSTANTS matches gameplay_tables.py',
      [k for k, v in (('haulFreightRate', T.HAUL_FREIGHT_RATE), ('haulRiskRate', T.HAUL_RISK_RATE),
                      ('escortShare', T.ESCORT_SHARE), ('escortBond', T.ESCORT_BOND)) if ts_val(k) != v]
      + [f'riskIndex.{t}' for t in tiers if ts_val(t) != T.RISK_INDEX[t]])

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
# Logistics reads two combat numbers; the prose must state the tables' values, not its own.
log1 = section_text('GamePlay/logistics_specification.md', '1') or ''
check('logistics 1 cuts a silent fleet\'s range by combat_tables.RUNNING_SILENT_SPEED_FACTOR',
      [] if f'`RUNNING_SILENT_SPEED_FACTOR` ({CT.RUNNING_SILENT_SPEED_FACTOR:.2f})' in log1
      else [f'logistics 1 does not state RUNNING_SILENT_SPEED_FACTOR ({CT.RUNNING_SILENT_SPEED_FACTOR:.2f})'])
log6 = section_text('GamePlay/logistics_specification.md', '6') or ''
want = {k: sum(p['restockCost'].values()) for k, p in CT.CRAFT_PROFILES.items()}
check('logistics 6 states each craft\'s restock cost as CRAFT_PROFILES has it',
      [f'{k}: {v:.1f} not stated' for k, v in want.items() if f'{v:.1f} a {k}' not in log6])

print('\n--- catalogue presence ---')
for key in ('progression', 'marketPrices', 'facilityTypes', 'stationTypes', 'npcSquadrons', 'contractArchetypes'):
    check(f'fleet json carries "{key}"', [] if FLEET.get(key) else ['missing'])
for meta in ('spPerTurn', 'turnLengthHours', 'tradeableGoodCount'):
    check(f'_meta carries "{meta}"', [] if meta in FLEET['_meta'] else ['missing'])

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} CHECK(S) FAILED'))
sys.exit(1 if fails else 0)
