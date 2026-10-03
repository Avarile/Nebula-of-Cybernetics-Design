#!/usr/bin/env python3
"""Deterministic station catalogue -- orbital station types by development tier.

An orbital station (GamePlay/station_specification.md) hosts its owner's own slots: the
planet slot kinds less extraction, sized by the same slot constants a planet is
subdivided by (gameplay_tables.py), scaled by the developmentTier of the planet it
orbits. A station pays no upkeep; each slot publishes the rent it WOULD pay as a lease
there, by the one rent formula the facility catalogue uses (gameplay_common.slot_rent),
which is what the kit's payback period is measured against (station 4).

Stations themselves -- who owns which, where -- are runtime state and are not generated.
This table keys only off (stationType, developmentTier).

Usage:
    python3 tools/generate_stations.py --dry-run
    python3 tools/generate_stations.py
"""
import argparse, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gameplay_tables as T
import gameplay_common as C

OUT = os.path.join(ROOT, 'GamePlay', 'Stations')
KEEP = set()


def build(fleet):
    prices = C.resource_prices(fleet)
    rows = []
    for sid, name, hosted in T.STATION_TYPES:
        cost = C.station_build_cost(hosted)
        for dev, mult in sorted(T.DEVELOPMENT_LADDER.items()):
            slots = {}
            for kind in T.FACILITY_TYPES:            # fixed order, so output is byte-stable
                n = hosted.get(kind, 0)
                if not n:
                    continue
                if kind == 'refinery':
                    per = T.REFINERY_SLOT_SIZE * mult
                    slots[kind] = {'facilityType': kind, 'slotCount': n,
                                   'throughputPerTurn': round(per, 4), 'unit': 'raw units/turn',
                                   'yieldModifier': T.STATION_YIELD_MODIFIER,
                                   'scalesWith': 'developmentTier',
                                   'rentPerTurn': round(C.slot_rent(kind, per, prices, T.STATION_YIELD_MODIFIER), 2)}
                elif kind == 'manufactory':
                    per = T.MANUFACTORY_SLOT_SIZE * mult
                    slots[kind] = {'facilityType': kind, 'slotCount': n,
                                   'throughputPerTurn': round(per, 4), 'unit': 'manufactured units/turn',
                                   'scalesWith': 'developmentTier',
                                   'rentPerTurn': round(C.slot_rent(kind, per, prices), 2)}
                elif kind == 'shipyard':
                    per = T.STATION_BERTH_RATE * mult
                    slots[kind] = {'facilityType': kind, 'slotCount': n,
                                   'throughputPerTurn': round(per, 4), 'unit': 'manufactured units/turn',
                                   'maxHullTonnage': round(T.STATION_BERTH_TONNAGE * mult, 1),
                                   'scalesWith': 'developmentTier',
                                   'rentPerTurn': round(C.slot_rent(kind, per, prices), 2)}
                elif kind == 'warehouse':
                    per = T.WAREHOUSE_SLOT_SIZE * mult
                    slots[kind] = {'facilityType': kind, 'slotCount': n,
                                   'capacity': round(per, 4), 'unit': 'units',
                                   'scalesWith': 'developmentTier',
                                   'rentPerTurn': round(C.slot_rent(kind, per, prices), 2)}
            rows.append({
                'stationTypeId': sid, 'name': name, 'developmentTier': dev,
                'securityTiers': list(T.STATION_TIERS),
                'slots': slots,
                'buildCost': {l: round(v, 4) for l, v in cost.items()},
                'kitUnits': round(sum(cost.values()), 4),
                'referencePrice': round(C.reference_price(cost, prices), 2),
            })
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    fleet = C.load_fleet()
    rows = build(fleet)
    print(f"station rows    : {len(rows)}  ({len(T.STATION_TYPES)} types x "
          f"{len(T.DEVELOPMENT_LADDER)} development tiers)")
    payback = C.station_payback(fleet)
    for r in rows:
        if r['developmentTier'] == 1:
            print(f"  {r['name']:17} kit {r['kitUnits']:6.1f} units  {r['referencePrice']:>9,.2f} cr  "
                  f"payback {[round(payback[(r['stationTypeId'], d)]['turns']) for d in sorted(T.DEVELOPMENT_LADDER)]} turns")
    for kind, b in C.station_buildout(fleet, rows).items():
        print(f"  full build-out, {kind:11}: {b['stations']:>11,.1f} vs planets {b['planets']:>11,.1f}"
              f"  ({100 * b['share']:.0f} %)")
    if args.dry_run:
        return

    C.clear_generated(OUT, KEEP)
    C.write_json(os.path.join(OUT, 'station_types.json'), {'count': len(rows), 'stationTypes': rows})
    C.write_json(os.path.join(OUT, 'index.json'), {
        'stationTypes': len(T.STATION_TYPES), 'developmentTiers': len(T.DEVELOPMENT_LADDER),
        'orbitsPerPlanet': T.ORBITS_PER_PLANET, 'securityTiers': T.STATION_TIERS,
        'siteTypes': T.STATION_SITE_TYPES,
        'stationYieldModifier': T.STATION_YIELD_MODIFIER,
        'stationBerthRate': T.STATION_BERTH_RATE, 'stationBerthTonnage': T.STATION_BERTH_TONNAGE,
        'deployFacility': T.STATION_DEPLOY_FACILITY,
        'frameCost': T.STATION_FRAME_COST, 'slotCost': T.STATION_SLOT_COST,
        'developmentLadder': T.DEVELOPMENT_LADDER,
    })

    fleet['stationTypes'] = rows
    C.write_json(C.FLEET, fleet)
    print(f"\nwrote GamePlay/Stations/ (2 files) + fleet json key 'stationTypes'")


if __name__ == '__main__':
    main()
