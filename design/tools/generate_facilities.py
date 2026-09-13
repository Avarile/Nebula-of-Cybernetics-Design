#!/usr/bin/env python3
"""Deterministic facility catalogue -- leasable slots by archetype x development tier.

Subdivides the planet capacities in systems_planets_specification.md 4 into
indivisible leasable slots, preserving each archetype's published total exactly, and
prices the rent from the reference prices the market catalogue derives.

Per-planet slot INSTANCES are runtime state and are not generated here. This table
keys only off (archetype, developmentTier), both of which the map spec already
authors, so nothing waits on tools/generate_systems.py.

Usage:
    python3 tools/generate_facilities.py --dry-run
    python3 tools/generate_facilities.py
"""
import argparse, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gameplay_tables as T
import gameplay_common as C

OUT = os.path.join(ROOT, 'GamePlay', 'Facilities')
KEEP = set()
LANES = C.LANES


def slot_count(total, size):
    return max(1, round(total / size)) if total > 0 else 0


def build(fleet):
    prices = C.resource_prices(fleet)
    gates = C.science_gate_levels(fleet)
    avg_mfg = sum(prices[l]['manufactured'] for l in LANES) / len(LANES)

    rows = []
    for arch, vals in T.PLANET_ARCHETYPES.items():
        a = dict(zip(T.ARCHETYPE_FIELDS, vals))
        for dev, dev_mult in sorted(T.DEVELOPMENT_LADDER.items()):
            slots = {}

            # extraction -- one slot per lane, scaled by richness (not development)
            for lane in LANES:
                if a[lane] <= 0:
                    continue
                out_value = a[lane] * prices[lane]['raw']
                slots[f'extraction.{lane}'] = {
                    'facilityType': 'extraction', 'lane': lane,
                    'slotCount': T.EXTRACTION_SLOTS_PER_LANE,
                    'throughputPerTurn': round(float(a[lane]), 4),
                    'unit': 'raw units/turn at richnessTier 1',
                    'scalesWith': 'richnessTier',
                    'rentPerTurn': round(T.LEASE_RATE['extraction'] * out_value, 2),
                }

            # refinery -- development scales per-slot throughput, never slot count
            n = slot_count(a['refinery'], T.REFINERY_SLOT_SIZE)
            if n:
                per = a['refinery'] / n * dev_mult
                # one slot's worth of the cheapest lane, as the rent reference
                in_v = per * prices['structural']['raw']
                out_v = (per * 0.90 * a['yieldModifier']) * prices['structural']['refined']
                slots['refinery'] = {
                    'facilityType': 'refinery', 'slotCount': n,
                    'throughputPerTurn': round(per, 4), 'unit': 'raw units/turn',
                    'yieldModifier': a['yieldModifier'], 'scalesWith': 'developmentTier',
                    'rentPerTurn': round(T.LEASE_RATE['refinery'] * max(0.0, out_v - in_v), 2),
                }

            n = slot_count(a['manufactory'], T.MANUFACTORY_SLOT_SIZE)
            if n:
                per = a['manufactory'] / n * dev_mult
                out_v = per * avg_mfg
                in_v = per / 0.85 * (sum(prices[l]['refined'] for l in LANES) / len(LANES))
                slots['manufactory'] = {
                    'facilityType': 'manufactory', 'slotCount': n,
                    'throughputPerTurn': round(per, 4), 'unit': 'manufactured units/turn',
                    'scalesWith': 'developmentTier',
                    'rentPerTurn': round(T.LEASE_RATE['manufactory'] * max(0.0, out_v - in_v), 2),
                }

            if a['berths']:
                per = a['constructionRate'] / a['berths'] * dev_mult
                slots['shipyard'] = {
                    'facilityType': 'shipyard', 'slotCount': a['berths'],
                    'throughputPerTurn': round(per, 4), 'unit': 'manufactured units/turn',
                    'maxHullTonnage': round(a['maxHullTonnage'] * dev_mult, 1),
                    'scalesWith': 'developmentTier',
                    'rentPerTurn': round(T.LEASE_RATE['shipyard'] * per * avg_mfg, 2),
                }

            n = slot_count(a['warehouse'], T.WAREHOUSE_SLOT_SIZE)
            if n:
                per = a['warehouse'] / n * dev_mult
                slots['warehouse'] = {
                    'facilityType': 'warehouse', 'slotCount': n,
                    'capacity': round(per, 4), 'unit': 'units',
                    'scalesWith': 'developmentTier',
                    'rentPerTurn': round(T.WAREHOUSE_RENT_PER_UNIT * per, 2),
                }

            rows.append({
                'archetype': arch, 'developmentTier': dev,
                'securityTiers': T.ARCHETYPE_PLACEMENT[arch],
                'slots': slots,
            })

    chain = [
        {'stage': 'extract', 'phase': 3, 'facilityType': 'extraction',
         'input': None, 'output': 'raw', 'skill': T.FACILITY_SKILL['extraction'],
         'scienceLevel': gates[T.SCIENCE_GATE['extraction']], 'stat': 'planetaryProductionRate'},
        {'stage': 'refine', 'phase': 4, 'facilityType': 'refinery',
         'input': 'raw', 'output': 'refined', 'skill': T.FACILITY_SKILL['refinery'],
         'scienceLevel': gates[T.SCIENCE_GATE['refinery']], 'stat': 'refineryYield'},
        {'stage': 'manufacture', 'phase': 5, 'facilityType': 'manufactory',
         'input': 'refined', 'output': 'manufactured', 'skill': T.FACILITY_SKILL['manufactory'],
         'scienceLevel': gates[T.SCIENCE_GATE['manufactory']], 'stat': 'manufacturingRate'},
        {'stage': 'construct', 'phase': 6, 'facilityType': 'shipyard',
         'input': 'manufactured', 'output': 'hull', 'skill': T.FACILITY_SKILL['shipyard'],
         'scienceLevel': gates[T.SCIENCE_GATE['shipyard']], 'stat': 'shipConstructionRate'},
        {'stage': 'store', 'phase': None, 'facilityType': 'warehouse',
         'input': None, 'output': None, 'skill': T.FACILITY_SKILL['warehouse'],
         'scienceLevel': gates[T.SCIENCE_GATE['warehouse']], 'stat': 'warehouseCapacity'},
    ]
    return rows, chain


def refining_margin(fleet):
    """The Systems_Planets 6.1 invariant, recomputed including every GamePlay term."""
    worst, where = 0.0, None
    skill_mult = C.skill_total_at_10(fleet, 'refineryYield')
    for r in fleet['resources']:
        if r['tier'] != 'refined':
            continue
        for arch, vals in T.PLANET_ARCHETYPES.items():
            ym = dict(zip(T.ARCHETYPE_FIELDS, vals))['yieldModifier']
            eff = r['conversionYield'] * ym * skill_mult
            if eff > worst:
                worst, where = eff, f"{r['lane']} x {arch}"
    return worst, where, skill_mult


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    fleet = C.load_fleet()
    rows, chain = build(fleet)
    worst, where, skill_mult = refining_margin(fleet)

    print(f"facility rows   : {len(rows)}  ({len(T.PLANET_ARCHETYPES)} archetypes x "
          f"{len(T.DEVELOPMENT_LADDER)} development tiers)")
    print(f"refining invariant: worst effectiveYield {worst:.4f} ({where}), "
          f"refineryYield x{skill_mult:.2f} -> {'OK' if worst < 1.0 else 'BROKEN'} "
          f"(margin {1.0 - worst:.4f})")
    fw = next(r for r in rows if r['archetype'] == 'forge_world' and r['developmentTier'] == 3)
    y = fw['slots']['shipyard']
    ship_mult = C.skill_total_at_10(fleet, 'shipConstructionRate')
    bs = next(s for s in fleet['ships'] if s['shipId'] == 'ship_battleship_t3')
    cost = sum(bs['buildCost'].values())
    per = y['throughputPerTurn'] * ship_mult
    print(f"forge world dev-3 : {y['slotCount']} berths x {y['throughputPerTurn']:.2f}/turn; "
          f"at ShipConstruction 10 -> {per:.1f}/berth, {per * y['slotCount']:.1f} total")
    print(f"   Battleship T3 ({cost:,.1f} units): {cost / per:.0f} turns on one berth, "
          f"{cost / (per * y['slotCount']):.0f} turns on all {y['slotCount']}")
    if args.dry_run:
        return

    C.clear_generated(OUT, KEEP)
    C.write_json(os.path.join(OUT, 'facility_types.json'), {'count': len(rows), 'facilityTypes': rows})
    C.write_json(os.path.join(OUT, 'chain.json'), {'count': len(chain), 'stages': chain})
    C.write_json(os.path.join(OUT, 'index.json'), {
        'archetypes': len(T.PLANET_ARCHETYPES), 'developmentTiers': len(T.DEVELOPMENT_LADDER),
        'slotSizes': {'refinery': T.REFINERY_SLOT_SIZE, 'manufactory': T.MANUFACTORY_SLOT_SIZE,
                      'warehouse': T.WAREHOUSE_SLOT_SIZE,
                      'extractionSlotsPerLane': T.EXTRACTION_SLOTS_PER_LANE},
        'leaseRate': T.LEASE_RATE, 'warehouseRentPerUnit': T.WAREHOUSE_RENT_PER_UNIT,
        'richnessLadder': T.RICHNESS_LADDER, 'developmentLadder': T.DEVELOPMENT_LADDER,
        'refiningInvariant': {'worstEffectiveYield': round(worst, 6), 'worstCase': where,
                              'refineryYieldMultiplier': round(skill_mult, 4),
                              'margin': round(1.0 - worst, 6)},
    })

    fleet['facilityTypes'] = rows
    C.write_json(C.FLEET, fleet)
    print(f"\nwrote GamePlay/Facilities/ (3 files) + fleet json key 'facilityTypes'")


if __name__ == '__main__':
    main()
