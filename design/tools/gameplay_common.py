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


def slot_rent(kind, per, prices, yield_modifier=None, lane=None):
    """industry_specification.md 7: a slot's rent per turn, unrounded, from its per-slot
    throughput (capacity, for a warehouse) at richnessTier 1 and skill level 0.

        rentPerTurn = LEASE_RATE x (outputValue - inputValue)

    One formula for a planet slot and for the same slot on a station
    (station_specification.md 4): a station pays no rent, and what its slots WOULD pay as
    leases is the yardstick its payback period is measured against."""
    if kind == 'extraction':
        return T.LEASE_RATE['extraction'] * (per * prices[lane]['raw'])
    if kind == 'refinery':
        # one slot's worth of the cheapest lane, as the rent reference
        in_v = per * prices['structural']['raw']
        out_v = (per * 0.90 * yield_modifier) * prices['structural']['refined']
        return T.LEASE_RATE['refinery'] * max(0.0, out_v - in_v)
    avg_mfg = sum(prices[l]['manufactured'] for l in LANES) / len(LANES)
    if kind == 'manufactory':
        out_v = per * avg_mfg
        in_v = per / 0.85 * (sum(prices[l]['refined'] for l in LANES) / len(LANES))
        return T.LEASE_RATE['manufactory'] * max(0.0, out_v - in_v)
    if kind == 'shipyard':
        return T.LEASE_RATE['shipyard'] * per * avg_mfg
    if kind == 'warehouse':
        return T.WAREHOUSE_RENT_PER_UNIT * per
    raise ValueError(kind)


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


# ----------------------------------------------------------------- fitting
# fitting_specification.md 3-5. The rules are tools/fitting.py; this is what a fit is worth
# and what changing one costs, recomputed from the live catalogues.

def item_entry(item_id, weapons, modules):
    return weapons[item_id] if item_id in weapons else modules[item_id]


def item_units(item_id, weapons, modules):
    """A part's buildCost in manufactured units -- also the warehouse space it takes."""
    return sum(item_entry(item_id, weapons, modules)['buildCost'].values())


def fit_value(fit, weapons, modules, prices):
    """Reference value of the parts on a hull: what the wreck drops at SALVAGE_DROP each."""
    import fitting
    ws, ms = fitting.fitted_items(fit)
    return sum(reference_price(item_entry(i, weapons, modules)['buildCost'], prices) for i in ws + ms)


def hull_value(ship, fit, weapons, modules, prices):
    """A hull as fitted: its bare hull price plus the parts actually on it. For the default
    fit this is the catalogue referencePrice, because a hull's buildCost is that sum."""
    _, bare, _ = hull_split(ship, weapons, modules, prices)
    return bare + fit_value(fit, weapons, modules, prices)


def refit_labour(old, new, weapons, modules):
    """Berth labour for a refit, in manufactured units of construction."""
    import fitting
    installed, removed = fitting.items_moved(old, new)
    return T.REFIT_LABOUR_SHARE * sum(item_units(i, weapons, modules) for i in installed + removed)


def refit_fee(old, new, weapons, modules, prices):
    """An NPC yard's fee for a refit: NPC_YARD_FEE of the reference value moved."""
    import fitting
    installed, removed = fitting.items_moved(old, new)
    return T.NPC_YARD_FEE * sum(reference_price(item_entry(i, weapons, modules)['buildCost'], prices)
                                for i in installed + removed)


def yard_rates(fleet, archetype, dev):
    """(one berth, the whole yard) construction per turn on a planet of this archetype and
    development tier, untrained -- read from the generated facility rows."""
    row = next(r for r in fleet['facilityTypes']
               if r['archetype'] == archetype and r['developmentTier'] == dev)
    sy = row['slots']['shipyard']
    return sy['throughputPerTurn'], sy['throughputPerTurn'] * sy['slotCount']


def turns_for(labour, rate):
    """Turns a refit holds its hull, counting the turn it is ordered: it completes in phase 6
    of the turn its accumulated labour is covered."""
    import math
    return max(1, math.ceil(labour / rate - 1e-9))


REFIT_EXAMPLE_HULLS = ['ship_motor_torpedo_boat_t1', 'ship_destroyer_t3',
                       'ship_heavy_cruiser_t3', 'ship_battleship_t3']
REFIT_EXAMPLE_YARD = ('forge_world', 3)


def refit_examples(fleet):
    """fitting_specification.md 4.3: strip each hull's default fit and fit it again -- every
    part moved twice -- at one forge-world berth (developmentTier 3) and at the NPC yard on
    the same planet. Labour then equals the fit's buildCost units exactly."""
    import fitting
    prices = resource_prices(fleet)
    weapons, modules, ships = catalogues(fleet)
    berth, yard = yard_rates(fleet, *REFIT_EXAMPLE_YARD)
    rows = []
    for sid in REFIT_EXAMPLE_HULLS:
        s = ships[sid]
        d, b = fitting.default_fit(s), fitting.bare_fit(s)
        labour = refit_labour(d, b, weapons, modules) + refit_labour(b, d, weapons, modules)
        fee = refit_fee(d, b, weapons, modules, prices) + refit_fee(b, d, weapons, modules, prices)
        rows.append({'shipId': sid, 'name': s['name'], 'fitUnits': sum(fitted_build_cost(s, weapons, modules).values()),
                     'labour': labour, 'berthTurns': turns_for(labour, berth),
                     'yardTurns': turns_for(labour, yard), 'fee': fee,
                     'fitValue': fit_value(d, weapons, modules, prices)})
    return {'berthRate': berth, 'yardRate': yard, 'rows': rows}


# ----------------------------------------------------------------- stations
# station_specification.md. Recomputed from the station rows and the live map.

STATION_CAPACITY_FIELD = {'refinery': 'throughputPerTurn', 'manufactory': 'throughputPerTurn',
                          'shipyard': 'throughputPerTurn', 'warehouse': 'capacity'}


def station_build_cost(hosted):
    """A kit's buildCost: the frame plus one STATION_SLOT_COST entry per hosted slot."""
    cost = dict(T.STATION_FRAME_COST)
    for kind, n in hosted.items():
        for l, v in T.STATION_SLOT_COST[kind].items():
            cost[l] = cost.get(l, 0.0) + n * v
    return {l: cost.get(l, 0.0) for l in LANES}


def station_capacity(row, kind):
    """What one station row holds of a kind: slotCount x per-slot throughput (or capacity)."""
    s = row['slots'].get(kind)
    return s['slotCount'] * s[STATION_CAPACITY_FIELD[kind]] if s else 0.0


def planet_capacity(planet, kind):
    return {'refinery': planet['refinery']['throughputPerTurn'],
            'manufactory': planet['manufactory']['throughputPerTurn'],
            'shipyard': planet['shipyard']['constructionRatePerTurn'],
            'warehouse': planet['warehouse']['capacity']}[kind]


def station_buildout(fleet, rows=None):
    """station_specification.md 2.1: every orbit of every planet a station may be anchored
    at, filled with the station holding the most of one kind, against what those planets
    hold of that kind themselves. Per kind: {'stations', 'planets', 'share'}."""
    rows = rows if rows is not None else fleet['stationTypes']
    tiers = {s['systemId']: s['securityTier'] for s in fleet['systems']}
    out = {}
    for kind in STATION_CAPACITY_FIELD:
        best = {}
        for r in rows:
            best[r['developmentTier']] = max(best.get(r['developmentTier'], 0.0), station_capacity(r, kind))
        st = pl = 0.0
        for p in fleet['planets']:
            if tiers[p['systemId']] not in T.STATION_TIERS:
                continue
            st += T.ORBITS_PER_PLANET * best[p['developmentTier']]
            pl += planet_capacity(p, kind)
        out[kind] = {'stations': st, 'planets': pl, 'share': st / pl if pl else float('inf')}
    return out


STATION_KIT_YARDS = [('forge_world', 3), ('oceanic', 1)]   # the best and the poorest berth


def station_kit_turns(fleet, rows=None):
    """Turns one untrained berth takes to build each kit, at the best and the poorest berth
    in the game. stationTypeId -> [turns at each STATION_KIT_YARDS entry]."""
    rows = rows if rows is not None else fleet['stationTypes']
    rates = [yard_rates(fleet, a, d)[0] for a, d in STATION_KIT_YARDS]
    return {r['stationTypeId']: [turns_for(r['kitUnits'], rate) for rate in rates]
            for r in rows if r['developmentTier'] == 1}, rates


def station_payback(fleet):
    """station_specification.md 4: what a kit buys back. A station pays nothing per turn, so
    the rent its slots would pay as leases at the orbited planet's developmentTier -- the
    industry 7 formula, recomputed here from the slot sizes, never read off the rows -- is
    what owning one saves each turn, and the kit's reference price over that saving is its
    payback period. (stationTypeId, developmentTier) -> {'kitPrice', 'rentPerTurn', 'turns'}."""
    prices = resource_prices(fleet)
    size = {'refinery': T.REFINERY_SLOT_SIZE, 'manufactory': T.MANUFACTORY_SLOT_SIZE,
            'shipyard': T.STATION_BERTH_RATE, 'warehouse': T.WAREHOUSE_SLOT_SIZE}
    out = {}
    for sid, _, hosted in T.STATION_TYPES:
        price = reference_price(station_build_cost(hosted), prices)
        for dev, mult in sorted(T.DEVELOPMENT_LADDER.items()):
            rent = sum(n * slot_rent(k, size[k] * mult, prices,
                                     T.STATION_YIELD_MODIFIER if k == 'refinery' else None)
                       for k, n in hosted.items())
            out[(sid, dev)] = {'kitPrice': price, 'rentPerTurn': rent, 'turns': price / rent}
    return out


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
