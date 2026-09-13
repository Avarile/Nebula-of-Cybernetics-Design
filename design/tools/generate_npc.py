#!/usr/bin/env python3
"""Deterministic NPC catalogue -- squadrons, response fleets, contract archetypes.

Every squadron is composed from real shipIds in the live ship catalogue, and its
value and bounty are computed from those hulls' buildCost. Nothing is authored but
the composition itself.

Usage:
    python3 tools/generate_npc.py --dry-run
    python3 tools/generate_npc.py
"""
import argparse, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gameplay_tables as T
import gameplay_common as C

OUT = os.path.join(ROOT, 'GamePlay', 'NPC')
KEEP = set()


def compose(ships, prices, comp):
    hulls, value = [], 0.0
    for sid, n in comp:
        s = ships[sid]
        p = C.reference_price(s['buildCost'], prices)
        hulls.append({'shipId': sid, 'name': s['name'], 'shipClass': s['shipClass'],
                      'count': n, 'unitReferencePrice': round(p, 2)})
        value += p * n
    return hulls, value


def build(fleet):
    prices = C.resource_prices(fleet)
    weapons, modules, ships = C.catalogues(fleet)

    squadrons = []
    for sq_id, tier, name, comp in T.NPC_SQUADRONS:
        hulls, value = compose(ships, prices, comp)
        squadrons.append({
            'squadronId': sq_id, 'name': name, 'securityTier': tier,
            'hullCount': sum(n for _, n in comp),
            'hulls': hulls,
            'referenceValue': round(value, 2),
            'bountyRate': T.BOUNTY_RATE[tier],
            'bounty': round(value * T.BOUNTY_RATE[tier], 2),
            'expectedSalvage': round(sum(
                C.hull_split(ships[sid], weapons, modules, prices)[2] * n * T.SALVAGE_DROP
                for sid, n in comp), 2),
        })
    squadrons.sort(key=lambda s: s['referenceValue'])

    response = []
    for tier, comp in T.RESPONSE_FLEET.items():
        hulls, value = compose(ships, prices, comp)
        response.append({
            'securityTier': tier, 'entersAtRound': T.RESPONSE_FLEET_ROUND[tier],
            'hullCount': sum(n for _, n in comp), 'hulls': hulls,
            'referenceValue': round(value, 2),
        })

    # The most expensive fleet a single player can field -- FLEET_SLOTS copies of the
    # dearest hull, since nothing stops a fleet being five of the same thing. This is
    # the bar a response fleet must clear. The cap comes from Formation Drill's
    # fleet_slot unlocks, never from a literal 5 anywhere in GamePlay.
    slots = 1 + sum(1 for u in C.skill_by_id(fleet)['skl_flt_formation_drill']['unlocks']
                    if u['type'] == 'fleet_slot')
    dearest = max(C.reference_price(s['buildCost'], prices) for s in fleet['ships'])
    richest_player_fleet = dearest * slots

    contracts = [{'contractId': c[0], 'name': c[1], 'job': c[2], 'rewardFormula': c[3],
                  'riskIndex': T.RISK_INDEX} for c in T.CONTRACT_ARCHETYPES]

    index = {
        'squadronCount': len(squadrons), 'responseFleetCount': len(response),
        'contractArchetypeCount': len(contracts),
        'fleetSlots': slots,
        'richestPlayerFleetReferenceValue': round(richest_player_fleet, 2),
        'bountyRate': T.BOUNTY_RATE, 'riskIndex': T.RISK_INDEX,
        'pvpAllowed': T.PVP_ALLOWED, 'aggressorFlagTurns': T.AGGRESSOR_FLAG_TURNS,
        'retreatThreshold': T.RETREAT_THRESHOLD, 'roundCap': T.ROUND_CAP,
        'salvageDrop': T.SALVAGE_DROP, 'salvageCargo': T.SALVAGE_CARGO,
        'wreckLifetime': T.WRECK_LIFETIME,
        'insurancePremium': T.INSURANCE_PREMIUM, 'insurancePayout': T.INSURANCE_PAYOUT,
        'raid': {'troopsPerWarehouseUnit': T.TROOPS_PER_WAREHOUSE_UNIT,
                 'cooldownTurns': T.RAID_COOLDOWN, 'allowedTiers': T.RAID_TIERS,
                 'capableHulls': sorted({s['shipClass'] for s in fleet['ships']
                                         if s['capacities']['troops'] > 0})},
    }
    return squadrons, response, contracts, index


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    fleet = C.load_fleet()
    squadrons, response, contracts, index = build(fleet)

    print(f"squadrons       : {len(squadrons)}")
    for s in squadrons:
        print(f"   {s['securityTier']:<10}{s['name']:<20}{s['hullCount']:>2} hulls  "
              f"value {s['referenceValue']:>10,.0f}  bounty {s['bounty']:>9,.0f}  "
              f"salvage {s['expectedSalvage']:>8,.0f}")
    print(f"response fleets :")
    for r in response:
        print(f"   {r['securityTier']:<10}{r['hullCount']:>2} hulls  value {r['referenceValue']:>10,.0f}  "
              f"enters round {r['entersAtRound']}")
    print(f"fleet slots     : {index['fleetSlots']} (from Formation Drill unlocks)")
    print(f"richest {index['fleetSlots']}-hull player fleet: {index['richestPlayerFleetReferenceValue']:,.0f} cr")
    mid = next(r for r in response if r['securityTier'] == 'mid')
    print(f"   mid response fleet {mid['referenceValue']:,.0f} vs that: "
          f"{'OK' if mid['referenceValue'] > index['richestPlayerFleetReferenceValue'] else 'TOO WEAK'}")
    print(f"raid-capable hulls: {index['raid']['capableHulls']}")
    if args.dry_run:
        return

    C.clear_generated(OUT, KEEP)
    C.write_json(os.path.join(OUT, 'squadrons.json'), {'count': len(squadrons), 'squadrons': squadrons})
    C.write_json(os.path.join(OUT, 'response_fleets.json'), {'count': len(response), 'responseFleets': response})
    C.write_json(os.path.join(OUT, 'contracts.json'), {'count': len(contracts), 'contractArchetypes': contracts})
    C.write_json(os.path.join(OUT, 'index.json'), index)

    fleet['npcSquadrons'] = squadrons
    fleet['contractArchetypes'] = contracts
    C.write_json(C.FLEET, fleet)
    print(f"\nwrote GamePlay/NPC/ (4 files) + fleet json key 'npcSquadrons'")


if __name__ == '__main__':
    main()
