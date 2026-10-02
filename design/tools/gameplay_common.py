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


# ----------------------------------------------------------------- hauling
# economy_specification.md 8.1-8.3. Everything below is recomputed from the live hull,
# price and map catalogues; verify_gameplay.py checks the spec's tables against it.

def _graph(fleet):
    return {s['systemId']: s for s in fleet['systems']}


def shortest_ly(fleet, sources):
    """Multi-source Dijkstra over jumpDistanceLy. -> {systemId: (ly, nearestSourceId)}."""
    import heapq
    systems = _graph(fleet)
    best = {s: (0.0, s) for s in sources}
    heap = [(0.0, s, s) for s in sorted(sources)]
    heapq.heapify(heap)
    while heap:
        d, sid, src = heapq.heappop(heap)
        if d > best[sid][0]:
            continue
        for c in systems[sid]['connections']:
            nd = d + c['jumpDistanceLy']
            if nd < best.get(c['toSystemId'], (float('inf'),))[0]:
                best[c['toSystemId']] = (nd, src)
                heapq.heappush(heap, (nd, c['toSystemId'], src))
    return best


def fuel_price(fleet, prices):
    """Credits per fuel unit, at the cheapest NPC ask, untrained -- what a hauler pays."""
    res = next(r for r in fleet['resources'] if r['resourceId'] == T.FUEL_RESOURCE)
    col = T.PRICE_INDEX_TIERS.index(res['tier'])
    ask = prices[res['lane']][res['tier']] * min(T.PRICE_INDEX[t][col] for t in T.NPC_ORDER_TIERS) \
        * (1 + T.NPC_SPREAD / 2.0)
    return ask / T.FUEL_PER_POWER_CORE


def ly_per_turn(ship):
    return T.JUMP_RANGE_BASE * ship['mobility']['topSpeed'] / T.JUMP_SPEED_REFERENCE


def leg_cost_per_ly(fleet, ship, prices, weapons, modules, pace=None):
    """One leg's running cost per ly: fuel, plus insurance premium for the turns it takes.
    `pace` is the convoy's ly/turn when the hull moves slower than it could alone."""
    _, bare, _ = hull_split(ship, weapons, modules, prices)
    fuel = ship['mass']['value'] / T.FUEL_MASS_DIVISOR * fuel_price(fleet, prices)
    premium = bare * T.INSURANCE_PREMIUM / (pace or ly_per_turn(ship))
    return fuel + premium


def haul_reward_per_ly(tons, value, risk):
    """ctr_haul: (tons x HAUL_FREIGHT_RATE + value x HAUL_RISK_RATE x (risk - 1)) per ly."""
    return tons * T.HAUL_FREIGHT_RATE + value * T.HAUL_RISK_RATE * (risk - 1.0)


def escort_quote_per_ly(value, risk):
    """ctr_escort reference quote: ESCORT_SHARE of the haul's risk premium, per ly."""
    return value * T.HAUL_RISK_RATE * (risk - 1.0) * T.ESCORT_SHARE


def collateral_factor(price_tier):
    """Haul collateral per credit of cargo reference value: the dearest NPC ask for that
    price tier anywhere. Defaulting on a haul is then never a cheaper way to buy the goods
    than an NPC sell order, and never a profitable way to sell them to an NPC bid."""
    col = T.PRICE_INDEX_TIERS.index(price_tier)
    return max(T.PRICE_INDEX[t][col] for t in T.NPC_ORDER_TIERS) * (1 + T.NPC_SPREAD / 2.0)


def representative_hauler(fleet):
    """The template hull with the largest hold."""
    return max(fleet['ships'], key=lambda s: (s['capacities']['cargo'], s['shipId']))


def representative_haul(fleet):
    """A full hold of the cheapest raw good on the representative hauler, laden out and
    empty back, as an NPC ctr_haul. One row per security tier of the route."""
    prices = resource_prices(fleet)
    weapons, modules, _ = catalogues(fleet)
    ship = representative_hauler(fleet)
    _, bare, fit = hull_split(ship, weapons, modules, prices)
    lane = min(T.RAW_PRICE, key=lambda l: (T.RAW_PRICE[l], l))
    tons = ship['capacities']['cargo']
    value = tons * prices[lane]['raw']
    cost = 2 * leg_cost_per_ly(fleet, ship, prices, weapons, modules)
    rows = []
    for tier in T.SECURITY_TIERS:
        risk = T.RISK_INDEX[tier]
        reward = haul_reward_per_ly(tons, value, risk)
        escort = escort_quote_per_ly(value, risk)
        keeps = reward - cost - escort
        exposure = value * collateral_factor('raw') + fit + bare * (1 - T.INSURANCE_PAYOUT[tier])
        rows.append({'tier': tier, 'rewardPerLy': reward, 'costPerLy': cost,
                     'marginPerLy': reward - cost, 'escortPerLy': escort, 'keepsPerLy': keeps,
                     'exposure': exposure, 'breakEvenLossPer100Ly': 100 * keeps / exposure})
    return {'shipId': ship['shipId'], 'lane': lane, 'tons': tons, 'value': value, 'rows': rows}


def own_account_hauls(fleet, lane):
    """A hold of raw `lane` ore carried from each system with no NPC market to the nearest
    one by ly and sold to its NPC bid, untrained; round-trip running cost deducted. There is
    no fuel to buy where the ore is, so both legs' power cores ride in the hold and displace
    ore. One row per tier without NPC orders: median route ly and median net per trip."""
    import statistics
    prices = resource_prices(fleet)
    weapons, modules, _ = catalogues(fleet)
    ship = representative_hauler(fleet)
    systems = _graph(fleet)
    core_mass = next(r for r in fleet['resources'] if r['resourceId'] == T.FUEL_RESOURCE)['unitMass']
    ore_mass = next(r for r in fleet['resources'] if r['lane'] == lane and r['tier'] == 'raw')['unitMass']
    cost = 2 * leg_cost_per_ly(fleet, ship, prices, weapons, modules)
    raw = T.PRICE_INDEX_TIERS.index('raw')
    near = shortest_ly(fleet, [s for s, v in systems.items() if v['securityTier'] in T.NPC_ORDER_TIERS])
    rows = []
    for tier in T.SECURITY_TIERS:
        if tier in T.NPC_ORDER_TIERS:
            continue
        lys, nets = [], []
        for sid, s in systems.items():
            if s['securityTier'] != tier:
                continue
            ly, dest = near[sid]
            sell = T.PRICE_INDEX[systems[dest]['securityTier']][raw] * (1 - half_spread(0.0))
            fuel_tons = 2 * ly * ship['mass']['value'] / T.FUEL_MASS_DIVISOR / T.FUEL_PER_POWER_CORE * core_mass
            units = (ship['capacities']['cargo'] - fuel_tons) / ore_mass
            nets.append(units * prices[lane]['raw'] * (sell - T.PRICE_INDEX[tier][raw]) - ly * cost)
            lys.append(ly)
        ly = statistics.median(lys)
        rows.append({'tier': tier, 'routeLy': ly, 'turnsLaden': ly / ly_per_turn(ship),
                     'netPerTrip': statistics.median(nets)})
    return rows


def contract_archetypes():
    """The published archetype list. generate_market.py and generate_npc.py both write the
    fleet json's "contractArchetypes" key; one shape here means run order cannot change it."""
    return [{'contractId': c[0], 'name': c[1], 'job': c[2], 'rewardFormula': c[3],
             'posters': c[4], 'riskIndex': T.RISK_INDEX} for c in T.CONTRACT_ARCHETYPES]


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
