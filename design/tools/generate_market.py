#!/usr/bin/env python3
"""Deterministic market catalogue -- a reference price for every tradeable good.

Only the four RAW_PRICE anchors are authored. Everything else divides out the
conversionYield the resource catalogue publishes and multiplies the buildCost the
weapon/module/ship catalogues already carry, so a price cannot drift from the item.

Usage:
    python3 tools/generate_market.py --dry-run
    python3 tools/generate_market.py
"""
import argparse, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gameplay_tables as T
import gameplay_common as C

OUT = os.path.join(ROOT, 'GamePlay', 'Market')
KEEP = set()


def arbitrage_table(fleet):
    """economy_specification.md 4 -- recomputed, never asserted against a literal.

    A haul between two NPC markets profits iff
        sellerIndex / buyerIndex  >  (1 + halfSpread) / (1 - halfSpread)
    """
    skills = C.skill_by_id(fleet)
    eff = next(e for e in skills['skl_trd_trade']['effects'] if e['stat'] == 'tradePriceMargin')
    max_margin = eff['modifierPerLevel'] * max(0, 10 - eff['appliesFromLevel'] + 1) / 100.0

    rows = []
    for label, tiers in (('npc_order_tiers', T.NPC_ORDER_TIERS), ('all_tiers', T.SECURITY_TIERS)):
        for margin_label, margin in (('untrained', 0.0), ('trade_10', max_margin)):
            h = C.half_spread(margin)
            threshold = (1 + h) / (1 - h)
            worst, where = 0.0, None
            for i, tier_name in enumerate(T.PRICE_INDEX_TIERS):
                for a in tiers:
                    for b in tiers:
                        ratio = T.PRICE_INDEX[a][i] / T.PRICE_INDEX[b][i]
                        if ratio > worst:
                            worst, where = ratio, f'{tier_name}, {b} -> {a}'
            rows.append({
                'scope': label, 'traderSkill': margin_label, 'tradePriceMargin': round(margin, 4),
                'halfSpread': round(h, 4), 'threshold': round(threshold, 4),
                'worstIndexRatio': round(worst, 4), 'worstCase': where,
                'safe': worst < threshold, 'headroom': round(threshold - worst, 4),
            })
    return {'maxTradePriceMargin': max_margin, 'rows': rows}


def build(fleet):
    prices = C.resource_prices(fleet)
    weapons, modules, ships = C.catalogues(fleet)

    resource_prices = []
    for r in fleet['resources']:
        base = prices[r['lane']][r['tier']]
        idx = T.PRICE_INDEX_TIERS.index(r['tier'])
        resource_prices.append({
            'resourceId': r['resourceId'], 'name': r['name'], 'lane': r['lane'], 'tier': r['tier'],
            'referencePrice': round(base, 4),
            'bySecurityTier': {t: round(base * T.PRICE_INDEX[t][idx], 4) for t in T.SECURITY_TIERS},
        })

    items = []
    for w in fleet['weapons']:
        items.append({'goodId': w['weaponId'], 'name': w['name'], 'kind': 'weapon',
                      'referencePrice': round(C.reference_price(w['buildCost'], prices), 2)})
    for m in fleet['modules']:
        items.append({'goodId': m['moduleId'], 'name': m['name'], 'kind': 'module',
                      'referencePrice': round(C.reference_price(m['buildCost'], prices), 2)})
    for s in fleet['ships'] + fleet['namedShips']:
        total, bare, fit = C.hull_split(s, weapons, modules, prices)
        items.append({'goodId': s['shipId'], 'name': s['name'], 'kind': 'hull',
                      'shipClass': s['shipClass'],
                      'referencePrice': round(total, 2),
                      'bareHullPrice': round(bare, 2),
                      'fitPrice': round(fit, 2),
                      'fitShare': round(fit / total, 4) if total else 0.0,
                      'insurance': {t: round(bare * T.INSURANCE_PAYOUT[t], 2) for t in T.SECURITY_TIERS},
                      'premiumPerTurn': round(bare * T.INSURANCE_PREMIUM, 4),
                      'expectedSalvage': round(fit * T.SALVAGE_DROP, 2)})

    constants = {
        'rawPrice': T.RAW_PRICE, 'processMargin': T.PROCESS_MARGIN, 'itemMargin': T.ITEM_MARGIN,
        'priceIndex': {t: dict(zip(T.PRICE_INDEX_TIERS, T.PRICE_INDEX[t])) for t in T.SECURITY_TIERS},
        'npcSpread': T.NPC_SPREAD, 'npcOrderTiers': T.NPC_ORDER_TIERS, 'marketTax': T.MARKET_TAX,
        'bountyRate': T.BOUNTY_RATE, 'riskIndex': T.RISK_INDEX,
        'insurancePremium': T.INSURANCE_PREMIUM, 'insurancePayout': T.INSURANCE_PAYOUT,
        'salvageDrop': T.SALVAGE_DROP, 'salvageCargo': T.SALVAGE_CARGO,
        'wreckLifetime': T.WRECK_LIFETIME,
        'lanePrices': {l: {k: round(v, 4) for k, v in prices[l].items()} for l in prices},
    }

    contracts = [{'contractId': c[0], 'name': c[1], 'job': c[2], 'rewardFormula': c[3]}
                 for c in T.CONTRACT_ARCHETYPES]

    return resource_prices, items, constants, contracts, arbitrage_table(fleet)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    fleet = C.load_fleet()
    rp, items, constants, contracts, arb = build(fleet)

    print(f"resources priced: {len(rp)}")
    print(f"items priced    : {len(items)}  (tradeable goods {len(rp) + len(items)})")
    for lane, v in constants['lanePrices'].items():
        print(f"   {lane:<11} raw {v['raw']:>6.2f}  refined {v['refined']:>7.2f}  mfg {v['manufactured']:>7.2f}")
    bs = next(i for i in items if i['goodId'] == 'ship_battleship_t3')
    print(f"   Battleship T3 {bs['referencePrice']:,.0f} cr  (bare {bs['bareHullPrice']:,.0f}, fit {bs['fitPrice']:,.0f})")
    print("arbitrage check :")
    for r in arb['rows']:
        print(f"   {r['scope']:<16}{r['traderSkill']:<11} ratio {r['worstIndexRatio']:.4f} vs "
              f"threshold {r['threshold']:.4f}  {'SAFE' if r['safe'] else 'ARBITRAGE'}")
    if args.dry_run:
        return

    C.clear_generated(OUT, KEEP)
    C.write_json(os.path.join(OUT, 'resource_prices.json'), {'count': len(rp), 'resources': rp})
    C.write_json(os.path.join(OUT, 'item_prices.json'), {'count': len(items), 'items': items})
    C.write_json(os.path.join(OUT, 'price_constants.json'), constants)
    C.write_json(os.path.join(OUT, 'index.json'),
                 {'tradeableGoodCount': len(rp) + len(items),
                  'resourceCount': len(rp), 'itemCount': len(items),
                  'arbitrage': arb, 'contractArchetypes': contracts})

    fleet['marketPrices'] = {'resources': rp, 'items': items, 'constants': constants}
    fleet['contractArchetypes'] = contracts
    fleet['_meta']['tradeableGoodCount'] = len(rp) + len(items)
    C.write_json(C.FLEET, fleet)
    print(f"\nwrote GamePlay/Market/ (4 files) + fleet json keys 'marketPrices', 'contractArchetypes'")


if __name__ == '__main__':
    main()
