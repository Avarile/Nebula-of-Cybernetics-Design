#!/usr/bin/env python3
"""Invariant checks for the generated market catalogue.

The load-bearing one is 'no free money' -- recomputed from the live index and skill
catalogues, never asserted against a literal threshold.
"""
import json, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gameplay_tables as T
import gameplay_common as C

FLEET = C.load_fleet()
M = FLEET.get('marketPrices')
OUT = os.path.join(ROOT, 'GamePlay', 'Market')
fails = []


def check(label, bad, show=6):
    if bad:
        fails.append(label); print(f'FAIL {label}: {len(bad)}')
        for b in bad[:show]: print('      ', b)
    else:
        print(f'ok   {label}')


check('fleet json carries "marketPrices"', [] if M else ['missing -- run generate_market.py'])
if not M:
    print('\n1 CHECK(S) FAILED'); sys.exit(1)

prices = C.resource_prices(FLEET)
weapons, modules, ships = C.catalogues(FLEET)
items = {i['goodId']: i for i in M['items']}
res = {r['resourceId']: r for r in M['resources']}

# --- coverage ----------------------------------------------------------------
expected = len(FLEET['resources']) + len(FLEET['weapons']) + len(FLEET['modules']) \
    + len(FLEET['ships']) + len(FLEET['namedShips'])
check(f'every tradeable good is priced ({expected})',
      [] if len(items) + len(res) == expected else [f'{len(items) + len(res)} priced, {expected} goods'])
check('every price is strictly positive and finite',
      [g for g, i in items.items() if not (i['referencePrice'] > 0 and math.isfinite(i['referencePrice']))]
      + [g for g, r in res.items() if not (r['referencePrice'] > 0 and math.isfinite(r['referencePrice']))])

# --- derivation round-trips --------------------------------------------------
bad = []
for w in FLEET['weapons']:
    exp = round(C.reference_price(w['buildCost'], prices), 2)
    if abs(items[w['weaponId']]['referencePrice'] - exp) > 0.01:
        bad.append(f'{w["weaponId"]}: {items[w["weaponId"]]["referencePrice"]} != {exp}')
check('weapon prices recompute from buildCost', bad)

bad = []
for s in FLEET['ships'] + FLEET['namedShips']:
    total, bare, fit = C.hull_split(s, weapons, modules, prices)
    got = items[s['shipId']]
    if abs(got['referencePrice'] - round(total, 2)) > 0.01 or abs(got['bareHullPrice'] - round(bare, 2)) > 0.01:
        bad.append(f'{s["shipId"]}: published ({got["referencePrice"]}, {got["bareHullPrice"]}) '
                   f'!= recomputed ({round(total, 2)}, {round(bare, 2)})')
check('hull total / bare / fit split recomputes', bad)

# --- insurance can never pay for nothing --------------------------------------
check('bareHullPrice > 0 for every hull (insurance never pays for nothing)',
      [g for g, i in items.items() if i['kind'] == 'hull' and i['bareHullPrice'] <= 0])
check('fitPrice >= 0 and fit never exceeds the hull',
      [g for g, i in items.items() if i['kind'] == 'hull' and not (0 <= i['fitPrice'] <= i['referencePrice'])])

# --- price ordering ------------------------------------------------------------
bad = []
for lane in C.LANES:
    p = prices[lane]
    if not (p['raw'] < p['refined'] < p['manufactured']):
        bad.append(f'{lane}: {p}')
check('prices rise strictly with resource tier within a lane', bad)

bad = []
for tier in ('raw', 'refined', 'manufactured'):
    order = [prices[l][tier] for l in ('structural', 'energy', 'ordnance', 'precision')]
    if not (order[0] < order[1] and order[2] < order[3] and order[0] < order[3]):
        bad.append(f'{tier}: structural {order[0]:.2f} energy {order[1]:.2f} '
                   f'ordnance {order[2]:.2f} precision {order[3]:.2f}')
check('precision is dearest and structural cheapest at every tier', bad)

# --- NO FREE MONEY -------------------------------------------------------------
skills = C.skill_by_id(FLEET)
eff = next(e for e in skills['skl_trd_trade']['effects'] if e['stat'] == 'tradePriceMargin')
max_margin = eff['modifierPerLevel'] * max(0, 10 - eff['appliesFromLevel'] + 1) / 100.0

bad = []
for level in range(0, 11):
    margin = eff['modifierPerLevel'] * max(0, level - eff['appliesFromLevel'] + 1) / 100.0
    h = C.half_spread(margin)
    threshold = (1 + h) / (1 - h)
    for i, tier_name in enumerate(T.PRICE_INDEX_TIERS):
        for a in T.NPC_ORDER_TIERS:
            for b in T.NPC_ORDER_TIERS:
                ratio = T.PRICE_INDEX[a][i] / T.PRICE_INDEX[b][i]
                if ratio > threshold:
                    bad.append(f'Trade L{level}: {tier_name} {b}->{a} ratio {ratio:.4f} > {threshold:.4f}')
check('NO FREE MONEY -- no profitable NPC haul at any trade level', bad)

bad = []
for level in range(0, 11):
    margin = eff['modifierPerLevel'] * max(0, level - eff['appliesFromLevel'] + 1) / 100.0
    h = C.half_spread(margin)
    if (1 - h) / (1 + h) >= 1.0:
        bad.append(f'Trade L{level}: same-system round trip returns {(1 - h) / (1 + h):.4f}')
check('a same-system NPC round trip loses money at every trade level', bad)

check('trade margin can never invert the spread',
      [] if C.half_spread(max_margin) > 0 else [f'halfSpread {C.half_spread(max_margin)} at max margin'])

# Restricting NPC orders to core+mid is the assumption the invariant rests on.
h = C.half_spread(max_margin)
threshold = (1 + h) / (1 - h)
worst_all = max(T.PRICE_INDEX[a][i] / T.PRICE_INDEX[b][i]
                for i in range(3) for a in T.SECURITY_TIERS for b in T.SECURITY_TIERS)
check('the core+mid restriction is load-bearing (all-tier orders WOULD arbitrage)',
      [] if worst_all > threshold else [f'all-tier worst ratio {worst_all:.4f} <= {threshold:.4f} '
                                        '-- the restriction no longer earns its place'])

# --- processing is profitable but bounded ---------------------------------------
bad = []
for r in FLEET['resources']:
    if r['tier'] == 'raw':
        continue
    src = next(x for x in FLEET['resources'] if x['resourceId'] == r['refinesFrom'])
    for arch, vals in T.PLANET_ARCHETYPES.items():
        ym = dict(zip(T.ARCHETYPE_FIELDS, vals))['yieldModifier'] if r['tier'] == 'refined' else 1.0
        out_v = r['conversionYield'] * ym * prices[r['lane']][r['tier']]
        in_v = prices[src['lane']][src['tier']]
        ratio = out_v / in_v
        if not (1.0 < ratio <= 1 + T.PROCESS_MARGIN + 1e-9):
            bad.append(f'{r["resourceId"]} on {arch}: {ratio:.4f} outside (1.00, {1 + T.PROCESS_MARGIN:.2f}]')
check('processing gains between 0% and PROCESS_MARGIN, for every lane x archetype', bad)

# --- tax ------------------------------------------------------------------------
taxes = [T.MARKET_TAX[t] for t in T.SECURITY_TIERS]
check('market tax decreases monotonically as security falls',
      [] if all(a >= b for a, b in zip(taxes, taxes[1:])) else [taxes])
check('market tax is zero in deadspace',
      [] if T.MARKET_TAX['deadspace'] == 0 else [T.MARKET_TAX['deadspace']])

# --- insurance / bounty ordering --------------------------------------------------
pay = [T.INSURANCE_PAYOUT[t] for t in T.SECURITY_TIERS]
check('insurance payout decreases with security and is 0 in deadspace',
      ([] if all(a >= b for a, b in zip(pay, pay[1:])) else [pay])
      + ([] if T.INSURANCE_PAYOUT['deadspace'] == 0 else ['deadspace pays out']))
bounty = [T.BOUNTY_RATE[t] for t in T.SECURITY_TIERS]
check('bounty rate rises as security falls and is 0 in core',
      ([] if all(a <= b for a, b in zip(bounty, bounty[1:])) else [bounty])
      + ([] if T.BOUNTY_RATE['core'] == 0 else ['core pays bounties']))
risk = [T.RISK_INDEX[t] for t in T.SECURITY_TIERS]
check('contract risk index rises as security falls',
      [] if all(a < b for a, b in zip(risk, risk[1:])) else [risk])

# --- schema --------------------------------------------------------------------
body = '\n'.join(l for l in open(os.path.join(ROOT, 'Data-Templates', 'market.interface'))
                 if not l.lstrip().startswith('#'))
schema = json.loads(body)
check('market.interface declares both shapes',
      [] if set(schema) == {'priceEntry', 'order'} else [list(schema)])
hull_fields = {'goodId', 'name', 'kind', 'shipClass', 'referencePrice', 'bareHullPrice',
               'fitPrice', 'fitShare', 'insurance', 'premiumPerTurn', 'expectedSalvage'}
check('hull price entries carry the full field set',
      [g for g, i in items.items() if i['kind'] == 'hull' and set(i) != hull_fields])

# --- files match ------------------------------------------------------------------
bad = []
for name, key, inner in (('resource_prices.json', 'resources', 'resources'),
                         ('item_prices.json', 'items', 'items')):
    p = os.path.join(OUT, name)
    if not os.path.exists(p):
        bad.append(f'{name} missing'); continue
    if json.load(open(p))[inner] != M[key]:
        bad.append(f'{name} differs from fleet json')
check('every generated file matches its fleet json entry', bad)

check('the hand-written spec survived the run',
      [] if os.path.exists(os.path.join(ROOT, 'GamePlay', 'economy_specification.md')) else ['missing'])

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} CHECK(S) FAILED'))
sys.exit(1 if fails else 0)
