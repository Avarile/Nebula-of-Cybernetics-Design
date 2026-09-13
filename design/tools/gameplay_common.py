#!/usr/bin/env python3
"""Shared derivations for the GamePlay generators and verifiers.

Everything here is computed from the live catalogues in fleet_and_weapons.json plus
the authored constants in gameplay_tables.py. Nothing is stored; call it twice and
get the same answer, which is what lets the verifiers recompute rather than trust.
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gameplay_tables as T

FLEET = os.path.join(ROOT, 'fleet_and_weapons.json')
LANES = ['structural', 'energy', 'ordnance', 'precision']


def load_fleet():
    return json.load(open(FLEET))


def resource_prices(fleet):
    """raw/refined/manufactured credit price per unit, per lane.

    Only RAW_PRICE is authored. The other two tiers divide out the conversionYield
    the resource catalogue publishes, so changing a lane's yield reprices the lane.
    """
    out = {}
    for lane in LANES:
        ref = next(r for r in fleet['resources'] if r['lane'] == lane and r['tier'] == 'refined')
        mfg = next(r for r in fleet['resources'] if r['lane'] == lane and r['tier'] == 'manufactured')
        raw = T.RAW_PRICE[lane]
        refined = raw / ref['conversionYield'] * (1 + T.PROCESS_MARGIN)
        manufactured = refined / mfg['conversionYield'] * (1 + T.PROCESS_MARGIN)
        out[lane] = {'raw': raw, 'refined': refined, 'manufactured': manufactured}
    return out


def reference_price(build_cost, prices):
    """Credit value of a buildCost, in manufactured-resource units."""
    return sum(build_cost.get(l, 0.0) * prices[l]['manufactured'] for l in LANES) * T.ITEM_MARGIN


def catalogues(fleet):
    return ({w['weaponId']: w for w in fleet['weapons']},
            {m['moduleId']: m for m in fleet['modules']},
            {s['shipId']: s for s in fleet['ships'] + fleet['namedShips']})


def fitted_build_cost(ship, weapons, modules):
    """The portion of a hull's buildCost contributed by the weapons and modules on it."""
    fit = {l: 0.0 for l in LANES}
    for hp in ship['hardpoints']['list']:
        wid = hp.get('weaponEquipped')
        if wid:
            for l, v in weapons[wid]['buildCost'].items():
                fit[l] += v
    for ms in ship['moduleSlots']['list']:
        mid = ms.get('moduleEquipped')
        if mid:
            for l, v in modules[mid]['buildCost'].items():
                fit[l] += v
    return fit


def hull_split(ship, weapons, modules, prices):
    """(total, bareHull, fit) reference prices. buildCost already INCLUDES the fit."""
    fit = fitted_build_cost(ship, weapons, modules)
    bare = {l: ship['buildCost'].get(l, 0.0) - fit[l] for l in LANES}
    return reference_price(ship['buildCost'], prices), reference_price(bare, prices), reference_price(fit, prices)


def half_spread(trade_margin):
    """NPC half-spread at a given tradePriceMargin (0.00 - 0.20). economy 4."""
    return (T.NPC_SPREAD / 2.0) * (1.0 - trade_margin)


def skill_by_id(fleet):
    return {s['skillId']: s for s in fleet['skills']}


def skill_total_at_10(fleet, stat):
    """Combined multiplier on a stat with every skill that touches it at level 10."""
    mult = 1.0
    for s in fleet['skills']:
        for e in s['effects']:
            if e['stat'] == stat and e['modifierType'] == 'percent':
                mult *= 1.0 + e['modifierPerLevel'] * max(0, 10 - e['appliesFromLevel'] + 1) / 100.0
    return mult


def science_gate_levels(fleet):
    """unlock target -> level, read off skl_sta_science rather than restated."""
    sci = skill_by_id(fleet)['skl_sta_science']
    return {u['target']: u['level'] for u in sci['unlocks']}


def prereq_closure(skills, requirements):
    """{skillId: level} covering `requirements` plus every transitive prerequisite."""
    seen = {}

    def walk(sid, lvl):
        if seen.get(sid, 0) >= lvl:
            return
        seen[sid] = max(seen.get(sid, 0), lvl)
        for p in skills[sid]['prerequisites']:
            walk(p['skillId'], p['level'])

    for sid, lvl in requirements:
        walk(sid, lvl)
    return seen


def closure_sp(skills, seen):
    return sum(skills[k]['training']['spCumulative'][v - 1] for k, v in seen.items())


def hull_gate_skills(fleet, category):
    """The skills carrying a ship_operation unlock for a category, and the level."""
    out = []
    for s in fleet['skills']:
        for u in s['unlocks']:
            if u.get('type') == 'ship_operation' and u.get('target') == category:
                out.append((s['skillId'], u['level']))
    return out


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(obj, f, indent=2)
        f.write('\n')


def clear_generated(directory, keep):
    """Clear only generated children, never the whole directory -- the hand-written
    specs under GamePlay/ must survive a run, exactly as Resources/ and Skills/ do."""
    if not os.path.isdir(directory):
        return
    import shutil
    for name in os.listdir(directory):
        if name in keep:
            continue
        p = os.path.join(directory, name)
        shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
