#!/usr/bin/env python3
"""Resource-tier bill-of-materials: catalogue and cost formulas.

Implements Resources/resource_tiers_specification.md. This module has no
dependency on generate_weapons.py / generate_modules.py / generate_ships.py --
each of those imports FROM here, never the reverse, so there is no import
cycle. Every weapon/module/ship generator attaches a buildCost by calling
into this module as a post-processing step; ships then sum the buildCost
their fitted weapons/modules already carry rather than re-deriving it.
"""

LANES = ['structural', 'energy', 'ordnance', 'precision']
TIERS = ['raw', 'refined', 'manufactured']

# Raw -> refined yield varies by lane (the material itself); refined -> manufactured
# yield is uniform (factory efficiency doesn't depend on the input material). See
# spec section 1. Rare Isotopes' low yield is what makes the precision lane the
# deliberate "expensive" one -- it needs the most raw material per finished unit.
REFINE_YIELD = {'structural': 0.90, 'energy': 0.80, 'ordnance': 0.75, 'precision': 0.50}
FABRICATION_YIELD = 0.85

RAW = {
    'structural': ('res_raw_ferrite', 'Ferrite Ore',
                   'Bulk ferrous/silicate ore -- the base structural feedstock for hull plating and weapon housings.'),
    'energy':     ('res_raw_conductive', 'Conductive Crystal',
                   'Naturally-grown crystal lattice with high charge capacity -- the base feedstock for power systems.'),
    'ordnance':   ('res_raw_volatile', 'Volatile Compound',
                   'Reactive chemical feedstock for propellant and warhead fill -- unstable in raw form.'),
    'precision':  ('res_raw_isotopes', 'Rare Isotopes',
                   'Scarce isotopic ore, the feedstock for precision electronics -- refines poorly, which is the point.'),
}
REFINED = {
    'structural': ('res_refined_structural_alloy', 'Structural Alloy',
                   'Smelted and tempered ferrite, ready for fabrication into hull sections and weapon housings.'),
    'energy':     ('res_refined_energy_matrix', 'Energy Cell Matrix',
                   'Processed conductive crystal formed into a stable charge-storage lattice.'),
    'ordnance':   ('res_refined_warhead_compound', 'Warhead Compound',
                   'Stabilised volatile compound, safe to fabricate into ordnance and propellant charges.'),
    'precision':  ('res_refined_precision_circuitry', 'Precision Circuitry',
                   'Etched isotopic substrate used in guidance, targeting, and sensor electronics.'),
}
MANUFACTURED = {
    'structural': ('res_mfg_structural_component', 'Structural Component',
                   'Finished structural part -- hull sections, weapon mounts, module housings.'),
    'energy':     ('res_mfg_power_core', 'Power Core Unit',
                   'Finished power-delivery unit -- reactor cells, capacitor banks, drive cores.'),
    'ordnance':   ('res_mfg_ordnance_charge', 'Ordnance Charge',
                   'Finished warhead/propellant charge, ready to load.'),
    'precision':  ('res_mfg_guidance_assembly', 'Guidance Assembly',
                   'Finished precision electronics package -- targeting, guidance, sensor subassemblies.'),
}


def _resource_rows():
    rows = []
    for lane in LANES:
        rid, name, desc = RAW[lane]
        rows.append(dict(resourceId=rid, name=name, tier='raw', lane=lane,
                          refinesFrom=None, refinesInto=REFINED[lane][0],
                          conversionYield=None, unitMass=1.0, description=desc))
        rid, name, desc = REFINED[lane]
        rows.append(dict(resourceId=rid, name=name, tier='refined', lane=lane,
                          refinesFrom=RAW[lane][0], refinesInto=MANUFACTURED[lane][0],
                          conversionYield=REFINE_YIELD[lane], unitMass=1.0, description=desc))
        rid, name, desc = MANUFACTURED[lane]
        rows.append(dict(resourceId=rid, name=name, tier='manufactured', lane=lane,
                          refinesFrom=REFINED[lane][0], refinesInto=None,
                          conversionYield=FABRICATION_YIELD, unitMass=1.0, description=desc))
    return rows


RESOURCES = _resource_rows()


def _round_cost(d):
    return {lane: round(d[lane], 2) for lane in LANES}


def add_costs(*costs):
    return _round_cost({lane: sum(c[lane] for c in costs) for lane in LANES})


def expand_to_refined(mfg_cost):
    return _round_cost({lane: mfg_cost[lane] / FABRICATION_YIELD for lane in LANES})


def expand_to_raw(mfg_cost):
    refined = expand_to_refined(mfg_cost)
    return _round_cost({lane: refined[lane] / REFINE_YIELD[lane] for lane in LANES})


# --------------------------------------------------------------- weapon cost
# Mirrors generate_weapons.py's ANCHOR[size]['dmg'] as the structural-scale proxy
# (spec section 3.1). Kept as a value-level copy rather than `from generate_weapons
# import ANCHOR`: generate_weapons.py in turn imports weapon_build_cost from this
# module, and a live import in both directions would be circular. The anchor table
# is a stable, rarely-touched constant, so the duplication risk is low; if ANCHOR
# in generate_weapons.py ever changes, update STRUCT_SIZE_SCALE to match.
STRUCT_SIZE_SCALE = {'small': 20.0, 'medium': 44.0, 'large': 95.0, 'capital': 190.0}

K_STRUCT, K_ENERGY, K_ORD, K_PREC, K_CRIT_PREC = 0.05, 0.15, 0.04, 0.05, 5.0

ORDNANCE_SHARE = {'missile': 0.70, 'mine': 0.75, 'kinetic': 0.35, 'melee': 0.10, 'energy': 0.05}


def weapon_build_cost(w):
    structural = STRUCT_SIZE_SCALE[w['size']] * K_STRUCT
    energy = w['powerCost'] * K_ENERGY
    ordnance = w['damage']['base'] * ORDNANCE_SHARE[w['weaponClass']] * K_ORD
    precision = w['accuracy']['tracking'] * K_PREC + w['criticalChance'] * K_CRIT_PREC
    return _round_cost(dict(structural=structural, energy=energy, ordnance=ordnance, precision=precision))


# --------------------------------------------------------------- module cost
K_MOD_STRUCT, K_MOD_ENERGY, K_MOD_PREC, K_MOD_ORD = 0.05, 0.15, 0.15, 0.02

# Effect stats that represent precision/electronics work vs. physical ordnance
# capacity, for modules (which have no damage field to derive ordnance from).
PRECISION_STATS = {'weaponAccuracy', 'detectionRange', 'criticalChanceBonus',
                    'sensorArray.effectiveness', 'initiative', 'crew.gunnerySkill',
                    'pointDefenseBonus', 'enemyHitChance', 'crew.pilotSkill'}
ORDNANCE_STATS = {'ammoCapacity', 'mineCapacity'}


def module_build_cost(m):
    structural = m['mass']['value'] * K_MOD_STRUCT
    energy = m['powerCost'] * K_MOD_ENERGY
    precision = sum(abs(e['modifier']) for e in m['effects']
                     if e['stat'] in PRECISION_STATS) * K_MOD_PREC
    ordnance = sum(abs(e['modifier']) for e in m['effects']
                    if e['stat'] in ORDNANCE_STATS) * K_MOD_ORD
    return _round_cost(dict(structural=structural, energy=energy, ordnance=ordnance, precision=precision))


# ----------------------------------------------------------- ship hull cost
# Bare-hull cost only -- a ship's total buildCost is this plus the buildCost its
# fitted weapons/modules already carry, summed by the caller (see
# generate_ships.py). Takes scalars rather than a ship dict so it can be called
# before a full ship dict exists (generate_ships.py builds componentHitpoints
# as a separate local before assembling the returned dict).
K_HULL_STRUCT, K_HULL_HP, K_HULL_ENERGY, K_HULL_PREC = 0.02, 0.03, 0.10, 0.05


def ship_hull_build_cost(mass_value, hull_max_hp, power_max_power, bridge_max_hp, sensor_max_hp):
    structural = mass_value * K_HULL_STRUCT + hull_max_hp * K_HULL_HP
    energy = power_max_power * K_HULL_ENERGY
    precision = (bridge_max_hp + sensor_max_hp) * K_HULL_PREC
    return _round_cost(dict(structural=structural, energy=energy, ordnance=0.0, precision=precision))
