#!/usr/bin/env python3
"""Authored constants for the GamePlay layer.

Stands in the same relation to GamePlay/*.md as resource_costs.py does to
Resources/resource_tiers_specification.md and skill_tables.py does to Skills/Design:
this file is the source of truth, the documents explain it, and the generators read
it. No RNG anywhere -- every GamePlay catalogue is a pure function of this table.

Nothing here restates a number another catalogue already owns. The SP rate is derived
from skill_tables.SP_PER_HOUR_REFERENCE; resource conversion yields are read from the
live resource catalogue at generation time; hull stats come from the ship catalogue.
"""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from skill_tables import SP_PER_HOUR_REFERENCE

# ----------------------------------------------------------------- the turn
# turn_specification.md 1-2

TURN_LENGTH_HOURS = 24
SP_PER_TURN = TURN_LENGTH_HOURS * SP_PER_HOUR_REFERENCE          # 43,200 -- derived, never typed

# The fourteen phases, in resolution order. "system" phases take no player order.
PHASES = [
    (1,  'intake',        'system',   'the order book is snapshotted'),
    (2,  'training',      'player',   'SP awarded, queues advanced, levels granted'),
    (3,  'extraction',    'player',   'planetary slots and belt mining produce'),
    (4,  'refining',      'player',   'raw -> refined'),
    (5,  'manufacturing', 'player',   'refined -> manufactured'),
    (6,  'construction',  'player',   'shipyard berths advance; finished hulls delivered'),
    (7,  'movement',      'player',   'fleets spend jump range; arrivals recorded'),
    (8,  'detection',     'player',   'sensor resolution, interdiction, engagement formation'),
    (9,  'combat',        'player',   'every engagement runs to conclusion'),
    (10, 'salvage',       'system',   'wrecks rolled, field holder loots'),
    (11, 'market',        'player',   'orders matched and cleared'),
    (12, 'upkeep',        'player',   'lease rent, insurance premiums, fuel and ammo drawn'),
    (13, 'settlement',    'player',   'contracts completed, standings adjusted, bounties paid'),
    (14, 'log',           'system',   'turn log written, turn N+1 opens'),
]

# Order type -> the phases it may resolve in. turn_specification.md 3.
ORDER_TYPES = {
    'train.queue':      [2],
    'mine.assign':      [3],
    'facility.job':     [3, 4, 5, 6],
    'fleet.move':       [7],
    'fleet.posture':    [8],
    'fleet.target':     [9],
    'cargo.transfer':   [7, 12],
    'market.order':     [11],
    'facility.lease':   [12],
    'contract.accept':  [13],
    'contract.post':    [13],
    'insurance.set':    [12],
    'union.action':     [13],
}

FLEET_POSTURES = ['engage', 'avoid', 'interdict', 'silent']

# Contended resources must each name a tie-break. turn_specification.md 4.
CONTENDED = {
    'facility.lease':   'rank = (phaseOrdinal, submissionSequence, playerId)',
    'market.order':     'price, then rank',
    'mine.assign':      'rank',
    'fleet.posture':    'rank, among interdictors on one gate',
}

# ----------------------------------------------------------------- security
# Systems_Planets/systems_planets_specification.md 3 -- the four tiers, in order.

SECURITY_TIERS = ['core', 'mid', 'rim', 'deadspace']

# ----------------------------------------------------------------- prices
# economy_specification.md 2-5.
#
# Only the four raw prices are authored. Refined and manufactured prices are
# computed at generation time by dividing out the conversionYield the resource
# catalogue publishes, so a change to a lane's yield repices the whole lane.

RAW_PRICE = {'structural': 10.00, 'energy': 14.00, 'ordnance': 12.00, 'precision': 40.00}
PROCESS_MARGIN = 0.15        # gross margin a processing stage earns
ITEM_MARGIN = 1.10           # assembly margin on a finished weapon, module or hull

# Local price = global reference x this. Raw is dear where nobody digs, finished
# goods are dear where nobody builds -- the inversion the map is built on.
PRICE_INDEX = {
    #             raw   refined   manufactured
    'core':      (1.25, 1.10, 0.95),
    'mid':       (1.10, 1.05, 1.05),
    'rim':       (0.90, 0.95, 1.25),
    'deadspace': (0.80, 0.90, 1.45),
}
PRICE_INDEX_TIERS = ['raw', 'refined', 'manufactured']

NPC_SPREAD = 0.20                          # full round-trip cost, placed symmetrically
NPC_ORDER_TIERS = ['core', 'mid']          # load-bearing: see economy_specification.md 4
MARKET_TAX = {'core': 0.020, 'mid': 0.015, 'rim': 0.005, 'deadspace': 0.000}

# ----------------------------------------------------------------- facilities
# industry_specification.md 2, 7.

EXTRACTION_SLOTS_PER_LANE = 1
REFINERY_SLOT_SIZE = 15.0        # raw units/turn
MANUFACTORY_SLOT_SIZE = 10.0     # manufactured units/turn
WAREHOUSE_SLOT_SIZE = 600.0      # units
# shipyard berths are already slots -- no subdivision

LEASE_RATE = {'extraction': 0.30, 'refinery': 0.30, 'manufactory': 0.30, 'shipyard': 0.10}
WAREHOUSE_RENT_PER_UNIT = 0.02   # credits per unit of capacity per turn

FACILITY_TYPES = ['extraction', 'refinery', 'manufactory', 'shipyard', 'warehouse']

# Science gates, by facility type. The LEVEL is not stored -- it is read from
# skl_sta_science's unlocks at generation time. This maps type -> unlock target.
SCIENCE_GATE = {
    'extraction':  'raw_operations',
    'warehouse':   'raw_operations',
    'refinery':    'refined_operations',
    'manufactory': 'manufactured_operations',
    'shipyard':    'manufactured_operations',
}
FACILITY_SKILL = {
    'extraction':  'skl_sta_resource_production',
    'warehouse':   'skl_sta_production_management',
    'refinery':    'skl_sta_refinement',
    'manufactory': 'skl_sta_manufactory',
    'shipyard':    'skl_sta_ship_construction',
}

# The two ladders and the archetype table are OWNED BY THE MAP. tools/system_tables.py
# authors them and tools/generate_systems.py writes the 60 systems and 180 planets from
# them; GamePlay imports rather than keeping a second copy, because two copies of the
# same table are two copies that drift. verify_facilities.py checks the subdivision
# against whatever system_tables.py currently says, so editing the map repices every
# lease automatically.
#
# ARCHETYPES is keyed by field name there; ARCHETYPE_FIELDS below preserves the column
# order this file's consumers expect, and PLANET_ARCHETYPES re-projects it to tuples.
from system_tables import ARCHETYPES as _MAP_ARCHETYPES, PLACEMENT as _MAP_PLACEMENT
from system_tables import RICHNESS as RICHNESS_LADDER, DEVELOPMENT as DEVELOPMENT_LADDER

ARCHETYPE_FIELDS = ['structural', 'energy', 'ordnance', 'precision', 'refinery',
                    'yieldModifier', 'manufactory', 'berths', 'maxHullTonnage',
                    'constructionRate', 'warehouse']

# system_tables.py abbreviates two columns; this is the only place the names differ.
_FIELD_ALIAS = {'maxHullTonnage': 'tonnage', 'constructionRate': 'constr'}

PLANET_ARCHETYPES = {
    name: tuple(row[_FIELD_ALIAS.get(f, f)] for f in ARCHETYPE_FIELDS)
    for name, row in _MAP_ARCHETYPES.items()
}

# PLACEMENT is securityTier -> [archetype]; GamePlay wants the inverse.
ARCHETYPE_PLACEMENT = {
    name: [tier for tier in SECURITY_TIERS if name in _MAP_PLACEMENT[tier]]
    for name in _MAP_ARCHETYPES
}

# ----------------------------------------------------------------- logistics
# logistics_specification.md 1-7.

JUMP_RANGE_BASE = 8.0            # ly/turn at the reference speed
JUMP_SPEED_REFERENCE = 300       # topSpeed needed to make base range
FUEL_MASS_DIVISOR = 100.0        # tons of fleet mass per fuel unit per ly
FUEL_PER_POWER_CORE = 100        # fuel units from one res_mfg_power_core
COMBAT_FUEL_BURN = 0.05          # of a hull's fuel capacity, per engagement
ROUNDS_PER_ORDNANCE_CHARGE = 100 # rounds per res_mfg_ordnance_charge

FUEL_RESOURCE = 'res_mfg_power_core'
AMMO_RESOURCE = 'res_mfg_ordnance_charge'

# Weapon classes that draw on capacities.ammo. The catalogue already encodes this
# as a finite `ammo` count -- these are the classes where that count is finite.
AMMO_DRAWING_CLASSES = ['missile', 'mine']

# ----------------------------------------------------------------- conflict
# conflict_specification.md 2-7.

PVP_ALLOWED = {'core': False, 'mid': True, 'rim': True, 'deadspace': True}
RESPONSE_FLEET_ROUND = {'core': 1, 'mid': 6}            # round it enters; absent = never
AGGRESSOR_FLAG_TURNS = 10

# Must beat the richest fleet a single player can field -- FLEET_SLOTS copies of the
# dearest hull in the catalogue. verify_npc.py recomputes that bar and fails if a
# response fleet falls under it, which is how these counts were arrived at.
RESPONSE_FLEET = {
    'core': [('ship_battleship_t3', 8), ('ship_battlecruiser_t3', 4)],
    'mid':  [('ship_battleship_t3', 4), ('ship_battlecruiser_t3', 4)],
}

BOUNTY_RATE = {'core': 0.00, 'mid': 0.05, 'rim': 0.10, 'deadspace': 0.18}

INSURANCE_PREMIUM = 0.004                               # of bare hull price, per turn
INSURANCE_PAYOUT = {'core': 0.80, 'mid': 0.70, 'rim': 0.50, 'deadspace': 0.00}

SALVAGE_DROP = 0.50          # per fitted weapon/module, independently rolled
SALVAGE_CARGO = 0.50         # of cargo units aboard
WRECK_LIFETIME = 2           # turns

RETREAT_THRESHOLD = 0.30     # combat_logic_specification.md 5.4, ruled here. Stated ONCE.
ROUND_CAP = 25               # rounds before an engagement breaks off

TROOPS_PER_WAREHOUSE_UNIT = 0.5
RAID_COOLDOWN = 4            # turns per warehouse
RAID_TIERS = ['rim', 'deadspace']

# NPC squadrons, composed from real shipIds. verify_npc.py resolves every one.
NPC_SQUADRONS = [
    ('npc_mid_pirate_raiders',  'mid',       'Pirate Raiders',
     [('ship_corvette_t1', 3), ('ship_submarine_chaser_t1', 1)]),
    ('npc_rim_raider_pack',     'rim',       'Raider Pack',
     [('ship_merchant_raider_t2', 2), ('ship_destroyer_t2', 2)]),
    ('npc_rim_pirate_wing',     'rim',       'Pirate Wing',
     [('ship_destroyer_t2', 3), ('ship_light_cruiser_t2', 2)]),
    ('npc_dead_warband',        'deadspace', 'Deadspace Warband',
     [('ship_heavy_cruiser_t3', 4), ('ship_battlecruiser_t3', 1)]),
    ('npc_dead_capital_threat', 'deadspace', 'Capital Threat',
     [('ship_battleship_t3', 1), ('ship_heavy_cruiser_t3', 4)]),
]

CONTRACT_ARCHETYPES = [
    ('ctr_haul',   'Haul',   'move N units of a good from system A to B',
     'cargoReferenceValue * jumpDistanceLy * destinationRiskIndex'),
    ('ctr_supply', 'Supply', 'deliver N manufactured units to a facility',
     'referenceValue * shortfallUrgency'),
    ('ctr_bounty', 'Bounty', 'destroy N NPC hulls of a tier in a system',
     'squadronReferenceValue * bountyRate'),
    ('ctr_escort', 'Escort', 'accompany a fleet across a route without it being destroyed',
     'routeDistanceLy * escortedCargoValue'),
]
# Risk index used by ctr_haul; rises as security falls.
RISK_INDEX = {'core': 1.00, 'mid': 1.15, 'rim': 1.45, 'deadspace': 1.90}

# ----------------------------------------------------------------- new player
# progression_specification.md 5.

STARTING_HULLS = ['ship_motor_torpedo_boat_t1', 'ship_submarine_chaser_t1', 'ship_corvette_t1']
STARTING_SCIENCE_LEVEL = 3
STARTING_FREE_LEASE_TURNS = 20
STARTING_FREE_LEASE_TYPE = 'refinery'
STARTING_CREDIT_LEASE_TURNS = 20          # seed credits cover this many turns of rent + fuel

# ----------------------------------------------------------------- stat rules
# gameplay_specification.md 6.1 -- NO DEAD SKILL.
#
# Every stat in stat_vocabulary.ALL_STATS must be consumed by a named rule. This is
# the map, and verify_gameplay.py checks it BOTH ways: a stat with no rule fails, and
# a rule naming a stat that does not exist fails. It is what stops the skill
# catalogue from buffing things nothing reads.
#
# Combat-owned stats point at Combat-logic/, not at GamePlay/. GamePlay does not own
# combat; it decides which fleets enter phase 9 and what phase 10 does with the wreck.
#   stat -> (document, section, rule)

_COMBAT = 'Combat-logic/combat_logic_specification.md'
_LOG = 'GamePlay/logistics_specification.md'
_IND = 'GamePlay/industry_specification.md'
_ECO = 'GamePlay/economy_specification.md'
_CON = 'GamePlay/conflict_specification.md'

STAT_RULES = {
    # --- mobility -----------------------------------------------------------
    'topSpeed':                (_LOG, '1', 'jump range budget; also combat speed-evasion'),
    'acceleration':            (_COMBAT, '2.4', 'speed-based evasion'),
    'turnRate':                (_COMBAT, '2.4', 'turn penalty in the evasion formula'),
    'evasionRating':           (_COMBAT, '2.4', 'base evasion before the speed bonus'),
    'fuelRange':               (_LOG, '2', 'percentage multiplier on the derived ly range'),
    # --- durability ----------------------------------------------------------
    'hull.maxHP':              (_COMBAT, '3.3', 'hull damage pool'),
    'hull.armorRating':        (_COMBAT, '3.3', 'damage reduction before hull'),
    'hull.regenPerTurn':       (_COMBAT, '3.3', 'per-round hull regeneration'),
    'shields.maxHP':           (_COMBAT, '3.2', 'shield damage pool'),
    'rechargeRatePerTurn':     (_COMBAT, '3.2', 'shield recharge per round'),
    'shields.rechargeDelayAfterHit': (_COMBAT, '3.2', 'rounds before recharge resumes'),
    # --- power ---------------------------------------------------------------
    'power.maxPower':          (_COMBAT, '1.1', 'power allocation phase; also signature derivation'),
    'power.regenPerTurn':      (_COMBAT, '1.1', 'power restored per round'),
    # --- sensors -------------------------------------------------------------
    'sensorArray.effectiveness': (_COMBAT, '2.3', 'attacker sensor strength for lock-on'),
    'detectionRange':          (_LOG, '5', 'interdiction detection; also combat lock-on'),
    'initiative':              (_COMBAT, '1.1', 'round order'),
    # --- gunnery -------------------------------------------------------------
    'weaponAccuracy':          (_COMBAT, '2.1', 'hit chance'),
    'criticalChanceBonus':     (_COMBAT, '3.6', 'critical roll'),
    'pointDefenseBonus':       (_COMBAT, '2.5', 'missile interception attempts'),
    'enemyHitChance':          (_COMBAT, '2.1', 'suppresses incoming accuracy'),
    'crew.gunnerySkill':       (_COMBAT, '2.1', 'gunnery term in the hit formula'),
    'crew.engineeringSkill':   (_COMBAT, '3.6', 'critical-damage handling'),
    'crew.pilotSkill':         (_COMBAT, '1.1', 'initiative term'),
    'crewRecoveryRate':        (_COMBAT, '3.6', 'crew casualties over time'),
    'repairRatePerTurn':       (_LOG, '4', 'repair at sea; also in-combat repair modules'),
    # --- capacities ----------------------------------------------------------
    'cargoCapacity':           (_LOG, '3', 'what a fleet can haul'),
    'ammoCapacity':            (_LOG, '6', 'magazine drawn by missile and mine weapons'),
    'mineCapacity':            (_COMBAT, '3.4', 'mines deployable per engagement'),
    'minesweepRate':           (_COMBAT, '3.4', 'mines cleared per round'),
    'troopCapacity':           (_CON, '7', 'facility raiding'),
    'aircraftCapacity':        (_COMBAT, '2.5', 'squadrons launchable'),
    'droneCapacity':           (_COMBAT, '2.5', 'drones launchable'),
    'medicalCapacity':         (_COMBAT, '3.6', 'crew recovery after casualties'),
    'fuelTransferRate':        (_LOG, '4', 'oiler refuelling other hulls'),
    # --- skill-only: combat ---------------------------------------------------
    'weaponDamage':            (_COMBAT, '3.1', 'raw damage, per weapon class'),
    'weaponTracking':          (_COMBAT, '2.4', 'tracking against speed-evasion'),
    'damageReduction':         (_COMBAT, '3.3', 'flat reduction before hull'),
    'criticalEventResistance': (_COMBAT, '3.6', 'resisting critical effects'),
    'electronicSystemsEffectiveness': (_COMBAT, '2.3', 'ECM and sensor systems'),
    'fleetRegroupRate':        (_CON, '4', 'reforming a disrupted fleet after a rout'),
    'squadronSpeed':           (_COMBAT, '2.5', 'fighter squadron performance'),
    'squadronAccuracy':        (_COMBAT, '2.5', 'fighter squadron performance'),
    'squadronEvasion':         (_COMBAT, '2.5', 'fighter squadron performance'),
    # --- skill-only: industry and trade ---------------------------------------
    'miningYield':             (_IND, '8', 'belt mining output per hull per turn'),
    'miningCycleSpeed':        (_IND, '8', 'belt mining cycle time'),
    'planetaryProductionRate': (_IND, '4', 'extraction slot output'),
    'warehouseCapacity':       (_IND, '5', 'warehouse slot capacity'),
    'refineryYield':           (_IND, '4', "multiplies the lane's conversionYield; capped by 6"),
    'manufacturingRate':       (_IND, '4', 'manufactory slot throughput'),
    'shipConstructionRate':    (_IND, '4.1', 'berth construction rate'),
    'tradePriceMargin':        (_ECO, '5', 'narrows the player half of the NPC spread'),
    'unionMemberCapacity':     (_ECO, '9', 'union size'),
}

# ----------------------------------------------------------------- faucets/drains
# gameplay_specification.md 6.5 -- every faucet has a drain.
# Each entry names the constant in THIS file that sets its rate, so a faucet cannot
# be added without a rate and verify_gameplay.py can resolve every one.

FAUCETS = [
    ('npc_buy_orders',   'NPC_SPREAD',        'goods a player actually produced'),
    ('bounties',         'BOUNTY_RATE',       'NPC squadrons killed; none spawn in core'),
    ('contract_rewards', 'RISK_INDEX',        'contracts posted by NPCs'),
    ('insurance_payout', 'INSURANCE_PAYOUT',  'premiums paid in, minus the margin'),
]
DRAINS = [
    ('facility_rent',      'LEASE_RATE',          'capacity the playerbase holds'),
    ('warehouse_rent',     'WAREHOUSE_RENT_PER_UNIT', 'storage held'),
    ('market_tax',         'MARKET_TAX',          'trade volume in safe space'),
    ('insurance_premium',  'INSURANCE_PREMIUM',   'hulls insured'),
    ('npc_sell_orders',    'NPC_SPREAD',          'fuel, ammunition and starter goods bought'),
    ('consumable_markup',  'FUEL_PER_POWER_CORE', 'fleets operating away from their own industry'),
]

# ----------------------------------------------------------------- careers
# progression_specification.md 4. Presentational bundles: what a player who commits
# to one path actually has to train. Costs are computed, never stored.
#   name -> (requirement list, note)   requirement = (skillId, level) or
#           ('@category', category, level) / ('@domain', domain, level) selectors.

CAREERS = [
    ('combat_competent', 'Combat, competent', [
        ('skl_ship_heavy_cruiser_control', 5), ('skl_ship_heavy_cruiser_systems', 5),
        ('@category', 'weaponry', 5), ('@category', 'engineering', 5),
        ('skl_nav_navigation', 5), ('skl_scan_scanning', 5), ('skl_flt_formation_drill', 5),
    ]),
    ('trade', 'Trade', [
        ('@domain', 'interaction_trade', 10),
        ('skl_ship_merchant_raider_control', 5), ('skl_ship_merchant_raider_systems', 5),
        ('skl_nav_navigation', 10),
    ]),
    ('mining', 'Mining', [
        ('@domain', 'deep_space_mining', 10),
        ('skl_sta_science', 7), ('skl_flt_mining_formation', 10),
        ('skl_ship_attack_transport_control', 5), ('skl_ship_attack_transport_systems', 5),
    ]),
    ('industry', 'Industry', [
        ('@domain', 'station_management', 10),
    ]),
    ('combat_mastered', 'Combat, mastered', [
        ('skl_ship_battleship_control', 5), ('skl_ship_battleship_systems', 5),
        ('@category', 'weaponry', 10), ('@category', 'engineering', 10),
        ('@category', 'fleet_command', 10),
        ('skl_nav_navigation', 10), ('skl_scan_scanning', 10),
    ]),
]

# ----------------------------------------------------------------- sanity
assert len(PHASES) == 14 and [p[0] for p in PHASES] == list(range(1, 15)), 'phase list must be dense 1-14'
assert set(PRICE_INDEX) == set(SECURITY_TIERS), 'price index must cover every security tier'
assert set(MARKET_TAX) == set(SECURITY_TIERS), 'market tax must cover every security tier'
assert set(INSURANCE_PAYOUT) == set(SECURITY_TIERS), 'insurance payout must cover every security tier'
assert set(BOUNTY_RATE) == set(SECURITY_TIERS), 'bounty rate must cover every security tier'
assert set(RAW_PRICE) == {'structural', 'energy', 'ordnance', 'precision'}, 'raw price must cover four lanes'
assert set(FACILITY_TYPES) == set(SCIENCE_GATE) == set(FACILITY_SKILL), 'facility tables disagree'
assert all(set(v) <= set(SECURITY_TIERS) for v in ARCHETYPE_PLACEMENT.values()), 'unknown security tier in placement'
assert set(ARCHETYPE_PLACEMENT) == set(PLANET_ARCHETYPES), 'placement and archetype tables disagree'
assert all(len(v) == len(ARCHETYPE_FIELDS) for v in PLANET_ARCHETYPES.values()), 'archetype row width'
assert all(ph in [p[0] for p in PHASES] for v in ORDER_TYPES.values() for ph in v), 'order names a phase that does not exist'
