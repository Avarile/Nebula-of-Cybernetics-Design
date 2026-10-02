#!/usr/bin/env python3
"""Invariant checks for player fitting -- GamePlay/fitting_specification.md.

The fitting rules have one implementation, tools/fitting.py. Every check here that judges
a fit calls it, so the catalogue's default fits and a player's refit answer to the same
code. Everything else is recomputed from the live catalogues, never read off the page.
"""
import math, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gameplay_tables as T
import gameplay_common as C
import fitting
from ship_tables import MOUNT_FOR_CLASS

FLEET = C.load_fleet()
SPEC = 'GamePlay/fitting_specification.md'
W, M, SHIPS = C.catalogues(FLEET)
TEMPLATES = FLEET['ships']
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


print('--- the rules (fitting 2) ---')
spec_rules = re.findall(r'^\| `(\w+)` \|', section_text(SPEC, '2'), re.M)
check('fitting spec 2 tabulates exactly the rules tools/fitting.py applies, in order',
      [] if spec_rules == fitting.RULE_IDS else [f'spec {spec_rules}', f'code {fitting.RULE_IDS}'])
check('every tier hull\'s default fit passes fit_is_valid',
      [f'{s["shipId"]}: {r} {d}' for s in TEMPLATES
       for r, d in fitting.fit_problems(s, fitting.default_fit(s), W, M)])

# Named ships are story hulls (fitting 6): no rule hands one to a player or sets one against
# a player. Every hull that IS handed out must be a tier hull whose default fit is legal.
handed = [(f'STARTING_HULLS', sid) for sid in T.STARTING_HULLS]
handed += [(sq[0], sid) for sq in T.NPC_SQUADRONS for sid, _ in sq[3]]
handed += [(f'RESPONSE_FLEET.{t}', sid) for t, hs in T.RESPONSE_FLEET.items() for sid, _ in hs]
template_ids = {s['shipId'] for s in TEMPLATES}
check('every hull a player is given or meets is a tier hull with a legal default fit',
      [f'{where}: {sid}' for where, sid in handed
       if sid not in template_ids or not fitting.fit_is_valid(SHIPS[sid], fitting.default_fit(SHIPS[sid]), W, M)])

print('\n--- no dead goods, no dead affinity (fitting 2, 6) ---')
by_class = {}
for s in TEMPLATES:
    by_class.setdefault(s['shipClass'], []).append(s)
specific = [m for m in M.values() if m['functionClass'] == 'specific']
check('every specific module fits at least one hull its hullAffinity names',
      [m['moduleId'] for m in specific
       if not fitting.fits_somewhere(m['moduleId'], 'modules',
                                     [s for c in m['hullAffinity'] for s in by_class.get(c, [])], W, M)])
check('every category in a hullAffinity can take the module at some tier (no dead entry)',
      [f'{m["moduleId"]}: {c}' for m in specific for c in m['hullAffinity']
       if not fitting.fits_somewhere(m['moduleId'], 'modules', by_class.get(c, []), W, M)])
check('every weapon is a legal fit on some tier hull',
      [w for w in sorted(W) if not fitting.fits_somewhere(w, 'weapons', TEMPLATES, W, M)])
check('every module is a legal fit on some tier hull',
      [m for m in sorted(M) if not fitting.fits_somewhere(m, 'modules', TEMPLATES, W, M)])

print('\n--- the refit (fitting 4) ---')
facility = {(r['archetype'], r['developmentTier']): r for r in FLEET['facilityTypes']}
systems = {s['systemId']: s for s in FLEET['systems']}
yards = [p for p in FLEET['planets'] if p['shipyard']['berths'] > 0
         and systems[p['systemId']]['securityTier'] in T.NPC_ORDER_TIERS]
policed = {s['region'] for s in FLEET['systems'] if s['securityTier'] in T.NPC_ORDER_TIERS}
check('every region with policed space has an NPC yard',
      sorted(policed - {systems[p['systemId']]['region'] for p in yards}))
heaviest = max(TEMPLATES, key=lambda s: s['mass']['value'])
check(f'some NPC yard takes the heaviest hull ({heaviest["shipId"]}, {heaviest["mass"]["value"]:,.0f} t)',
      [] if any(p['shipyard']['maxHullTonnage'] >= heaviest['mass']['value'] for p in yards)
      else ['none'])
check("an NPC yard's rate is its planet's whole construction rate, as the facility rows publish it",
      [p['planetId'] for p in yards
       if abs(C.yard_rates(FLEET, p['archetype'], p['developmentTier'])[1]
              - p['shipyard']['constructionRatePerTurn']) > 1e-6])

ex = C.refit_examples(FLEET)
sec = section_text(SPEC, '4.3')
bad = []
for r in ex['rows']:
    m = re.search(rf'^\| {re.escape(r["name"])} \|(.*)\|$', sec, re.M)
    if not m:
        bad.append(f'no row for {r["name"]}'); continue
    cells = [float(x.replace(',', '').strip()) for x in m.group(1).split('|')]
    want = [(r['fitUnits'], 1), (r['berthTurns'], 0), (r['yardTurns'], 0), (r['fitValue'], 0), (r['fee'], 0)]
    if len(cells) != len(want) or any(abs(c - w) > 0.5 * 10 ** -d + 1e-9 for c, (w, d) in zip(cells, want)):
        bad.append(f'{r["name"]}: spec {cells} != live {[round(w, d) for w, d in want]}')
for rate in (ex['berthRate'], ex['yardRate']):
    if f'{rate:g}' not in sec:
        bad.append(f'rate {rate:g} not stated')
check('fitting 4.3 refit table recomputes from the live catalogues', bad)

print('\n--- the economy (fitting 5) ---')
items = {i['goodId']: i for i in FLEET['marketPrices']['items']}
bad = []
for s in TEMPLATES + FLEET['namedShips']:
    ws, ms = fitting.fitted_items(fitting.default_fit(s))
    parts = sum(items[i]['referencePrice'] for i in ws + ms)
    tol = 0.005 * (len(ws) + len(ms) + 2)
    if abs(items[s['shipId']]['bareHullPrice'] + parts - items[s['shipId']]['referencePrice']) > tol:
        bad.append(f'{s["shipId"]}: bare {items[s["shipId"]]["bareHullPrice"]} + parts {parts:.2f} '
                   f'!= {items[s["shipId"]]["referencePrice"]}')
check('a hull is worth its bare hull plus its parts, at published prices, for all 98', bad)

# 6.2 extended to fitting: buy a hull at the NPC ask, strip it for nothing (the cheapest
# refit there is), sell the bare hull and every part at the NPC bid. It must lose, for every
# hull, every pair of NPC tiers and every trade level. Finished goods all sit on the
# manufactured column of the price index (economy 8.1), so the parts cannot be sold on a
# kinder index than the hull was bought on.
skills = C.skill_by_id(FLEET)
eff = next(e for e in skills['skl_trd_trade']['effects'] if e['stat'] == 'tradePriceMargin')
col = T.PRICE_INDEX_TIERS.index('manufactured')
bad = []
for level in range(0, 11):
    h = C.half_spread(eff['modifierPerLevel'] * max(0, level - eff['appliesFromLevel'] + 1) / 100.0)
    for s in TEMPLATES:
        ws, ms = fitting.fitted_items(fitting.default_fit(s))
        sold_for = items[s['shipId']]['bareHullPrice'] + sum(items[i]['referencePrice'] for i in ws + ms)
        for a in T.NPC_ORDER_TIERS:
            for b in T.NPC_ORDER_TIERS:
                cost = items[s['shipId']]['referencePrice'] * T.PRICE_INDEX[a][col] * (1 + h)
                back = sold_for * T.PRICE_INDEX[b][col] * (1 - h)
                if back >= cost:
                    bad.append(f'L{level} {s["shipId"]} {a}->{b}: {back:.2f} >= {cost:.2f}')
check('NO FREE MONEY -- buying a hull and selling it stripped never pays, at any trade level', bad)
check('the NPC yard fee is a listed drain', [] if any(c == 'NPC_YARD_FEE' for _, c, _ in T.DRAINS) else ['missing'])

print('\n--- mirrors ---')
consts = open(os.path.join(ROOT, 'Reference', 'constants.ts')).read()


def ts_block(name):
    """The body of `export const <name> = { ... } as const`, or '' if it is not there."""
    mm = re.search(rf'export const {name} = \{{(.*?)\}} as const', consts, re.S)
    return mm.group(1) if mm else ''


fc, mc = ts_block('FITTING_CONSTANTS'), ts_block('MOUNT_FOR_WEAPON_CLASS')


def ts_num(block, key):
    mm = re.search(rf'\b{key}:\s*(-?[\d.]+)', block)
    return float(mm.group(1)) if mm else None


check('constants.ts FITTING_CONSTANTS matches gameplay_tables.py',
      [k for k, v in (('refitLabourShare', T.REFIT_LABOUR_SHARE), ('npcYardFee', T.NPC_YARD_FEE))
       if ts_num(fc, k) != v])
check('constants.ts MOUNT_FOR_WEAPON_CLASS matches ship_tables.MOUNT_FOR_CLASS',
      [] if dict(re.findall(r"(\w+):\s*'(\w+)'", mc)) == MOUNT_FOR_CLASS else [mc.strip()[:120]])
gts = open(os.path.join(ROOT, 'Reference', 'gameplay.ts')).read()
fh = re.search(r'export interface FleetHull \{(.*?)\n\}', gts, re.S)
check('Reference/gameplay.ts FleetHull carries its own fit and refit',
      [f for f in ('hullId', 'fit', 'refit') if not fh or not re.search(rf'^\s+{f}:', fh.group(1), re.M)])

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} CHECK(S) FAILED'))
sys.exit(1 if fails else 0)
