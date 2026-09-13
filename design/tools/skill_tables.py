#!/usr/bin/env python3
"""The skill catalogue, as a table.

Source of truth for design/Skills/. Derived from design/Skills/Design -- every level
count, gate and per-level figure in here traces back to a line in that spec, except
where marked PROPOSED (the spec names the skill but not its numbers).

Everything a skill does is one of four things:

  effects[]        a per-level modifier on a stat from tools/stat_vocabulary.py
  penalties[]      a flat malus that applies BELOW a level (the weaponry debuff)
  unlocks[]        a capability/hull/fleet-slot that opens at a level
  prerequisites[]  another skill that must reach a level first

The effect arithmetic, defined once and enforced by verify_skills.py:

    total = modifierPerLevel * max(0, level - appliesFromLevel + 1)

so Navigation (appliesFromLevel 1, +1%/level) reaches +10% at level 10, and a
Weaponry skill (appliesFromLevel 6, +5%/level) sits at 0 at level 5 and +25% at
level 10 -- which is "after level 5, each level will increase 5% of effectiveness"
with level 5 as the clean baseline, the debuff gone and no bonus yet.
"""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ship_tables import CATEGORIES, BY_KEY

MAX_LEVEL = 10

DOMAINS = ['ship_command', 'station_management', 'deep_space_mining', 'interaction_trade']

CATEGORY_ORDER = {
    'ship_command': ['ship_system_control', 'navigation', 'scanning', 'engineering',
                     'weaponry', 'fleet_command'],
    'station_management': ['science', 'facility_management'],
    'deep_space_mining': ['mining_operations'],
    'interaction_trade': ['commerce'],
}

SCOPES = ['ship', 'fleet', 'station', 'player']

UNLOCK_TYPES = ['ship_operation', 'fleet_slot', 'capability', 'skill_group']

# A weapon skill's appliesTo.weaponClass. The first five are the weaponClass values in
# the weapon catalogue; 'drone' is the sixth because the Design spec lists Drones beside
# the other three weapon skills, but drones are hangar-launched craft (droneCapacity /
# hangar slots) and so have no entry in Weapons/.
WEAPON_CLASSES = ['kinetic', 'energy', 'missile', 'mine', 'melee', 'drone']

# Keys an effect's appliesTo may carry. Closed vocabulary -- verify_skills.py rejects
# anything else, and checks the value resolves.
APPLIES_TO_KEYS = ['weaponClass', 'shipCategory', 'resourceTier']

# Prose names for the 26 hull categories, for skill names. ship_tables' `folder` field is
# a directory name ('Sloop - patrol escort') and reads badly in a skill name, so the
# display forms live here. Asserted complete against CATEGORIES at the bottom of the file.
HULL_DISPLAY = {
    'motor_torpedo_boat': 'Motor Torpedo Boat',
    'submarine_chaser': 'Submarine Chaser',
    'corvette': 'Corvette',
    'torpedo_boat_fleet': 'Fleet Torpedo Boat',
    'destroyer_escort': 'Destroyer Escort',
    'sloop_patrol_escort': 'Sloop / Patrol Escort',
    'destroyer': 'Destroyer',
    'landing_ship_tank': 'Landing Ship Tank',
    'submarine': 'Submarine',
    'minelayer_sweeper': 'Minelayer / Sweeper',
    'coastal_defence_ship': 'Coastal Defence Ship',
    'anti_aircraft_cruiser': 'Anti-Aircraft Cruiser',
    'monitor': 'Monitor',
    'light_cruiser': 'Light Cruiser',
    'attack_transport': 'Attack Transport',
    'light_carrier': 'Light Carrier',
    'panzerschiff': 'Panzerschiff',
    'merchant_raider': 'Merchant Raider',
    'seaplane_tender': 'Seaplane Tender',
    'repair_ship_tender': 'Repair Ship / Tender',
    'heavy_cruiser': 'Heavy Cruiser',
    'escort_carrier': 'Escort Carrier',
    'fleet_oiler': 'Fleet Oiler',
    'fleet_aircraft_carrier': 'Fleet Aircraft Carrier',
    'battlecruiser': 'Battlecruiser',
    'battleship': 'Battleship',
}

# Level at which a hull's two skills (control + system management) both being trained
# lets a player operate that hull. Straight from the Design spec's closing note.
OPERATE_LEVEL = 5


# --------------------------------------------------------------------- constructors
def E(stat, per_level, kind='percent', from_level=1, **applies_to):
    """One per-level effect. from_level=6 means levels 6..10 each contribute."""
    return {'stat': stat, 'modifierPerLevel': float(per_level), 'modifierType': kind,
            'appliesFromLevel': from_level, 'appliesTo': dict(applies_to)}


def P(stat, modifier, kind='percent', below_level=OPERATE_LEVEL, **applies_to):
    """A flat malus while the skill is below below_level. Not per-level."""
    return {'stat': stat, 'modifier': float(modifier), 'modifierType': kind,
            'appliesBelowLevel': below_level, 'appliesTo': dict(applies_to)}


def U(level, utype, target, description):
    return {'level': level, 'type': utype, 'target': target, 'description': description}


def R(skill_id, level):
    return {'skillId': skill_id, 'level': level}


def S(skill_id, name, domain, category, rank, scope, description,
      effects=(), penalties=(), unlocks=(), prerequisites=()):
    return {
        'skillId': skill_id,
        'name': name,
        'domain': domain,
        'category': category,
        'maxLevel': MAX_LEVEL,
        'rank': rank,
        'scope': scope,
        'effects': list(effects),
        'penalties': list(penalties),
        'unlocks': list(unlocks),
        'prerequisites': list(prerequisites),
        'description': description,
    }


def hull_rank(key):
    """Training difficulty from the hull's mass band -- a battleship is rank 5 work."""
    top = BY_KEY[key]['mass'][1]
    for limit, rank in ((2_000, 1), (10_000, 2), (25_000, 3), (50_000, 4)):
        if top < limit:
            return rank
    return 5


# ============================================================== SPACESHIP COMMAND
# Ship System Control -- 26 categories x {Control, System Management}.
#
# The spec fixes the gate: "reaching level 5 will enable a player to operate that kind
# of ship (both control and system management is required)". Levels 6-10 are PROPOSED:
# the spec says skills are needed to operate ships *normally*, so past the gate each
# level adds 1% to the two things that skill is about -- handling for Control, system
# upkeep for System Management -- on that hull category only. Delete the effects= lines
# below to make these pure gates with no ladder.
def ship_skills():
    out = []
    for c in CATEGORIES:
        key, disp = c['key'], HULL_DISPLAY[c['key']]
        rank = hull_rank(key)
        gate = U(OPERATE_LEVEL, 'ship_operation', key,
                 f'Operate a {disp}; requires the paired system-management skill at '
                 f'level {OPERATE_LEVEL} as well.')
        out.append(S(
            f'skl_ship_{key}_control', f'{disp} Control',
            'ship_command', 'ship_system_control', rank, 'ship',
            f'Conning a {disp}: helm, throttle and evasive handling. Level '
            f'{OPERATE_LEVEL} is half the requirement to take one out; past that, each '
            f'level sharpens how the hull handles.',
            effects=[E('evasionRating', 1.0, from_level=6, shipCategory=key),
                     E('initiative', 1.0, from_level=6, shipCategory=key)],
            unlocks=[gate]))
        out.append(S(
            f'skl_ship_{key}_systems', f'{disp} System Management',
            'ship_command', 'ship_system_control', rank, 'ship',
            f'Running a {disp}\'s internals: power routing, damage-control parties and '
            f'standing repairs. The other half of the level-{OPERATE_LEVEL} requirement '
            f'to operate the hull.',
            effects=[E('power.regenPerTurn', 1.0, from_level=6, shipCategory=key),
                     E('repairRatePerTurn', 1.0, from_level=6, shipCategory=key)],
            unlocks=[gate]))
    return out


NAVIGATION = [
    S('skl_nav_navigation', 'Navigation', 'ship_command', 'navigation', 2, 'ship',
      'Course plotting and throttle discipline. Each level adds 1% to ship speed.',
      effects=[E('topSpeed', 1.0)]),
]

SCANNING = [
    # Effect figures PROPOSED; the spec gives the three capabilities but no numbers.
    S('skl_scan_scanning', 'Scanning', 'ship_command', 'scanning', 3, 'ship',
      'Survey and targeting sensors. Opens up scanning the universe, scouting enemy '
      'contacts, and holding a lock on an enemy ship.',
      effects=[E('detectionRange', 3.0),
               E('sensorArray.effectiveness', 2.0)],
      unlocks=[U(1, 'capability', 'system_scan', 'Scan the current system for contacts and sites.'),
               U(3, 'capability', 'enemy_scout', 'Resolve an enemy contact into a hull and loadout.'),
               U(5, 'capability', 'target_lock', 'Hold a weapons lock on an enemy ship.')]),
]

ENGINEERING = [
    S('skl_eng_maintenance', 'Maintenance', 'ship_command', 'engineering', 2, 'ship',
      'Standing repair work under way. The higher the skill, the better the repair rate.',
      effects=[E('repairRatePerTurn', 3.0)]),
    S('skl_eng_energy_shields', 'Energy Shields', 'ship_command', 'engineering', 3, 'ship',
      'Shield generator tuning. The higher the skill, the faster the recharge rate.',
      effects=[E('rechargeRatePerTurn', 3.0)]),
    S('skl_eng_damage_control', 'Damage Control', 'ship_command', 'engineering', 4, 'ship',
      'Handling critical damage: hull breach, reactor fire, reactor failure, bridge '
      'failure, computer system failure. Higher levels improve the chance of containing '
      'each of them.',
      effects=[E('criticalEventResistance', 4.0)]),
    S('skl_eng_electronics', 'Electronics', 'ship_command', 'engineering', 3, 'ship',
      'Fire-control computers, ECM sets and sensor processing -- the effectiveness of a '
      'ship\'s electronic systems.',
      effects=[E('electronicSystemsEffectiveness', 3.0)]),
]

# Weaponry -- the one place the spec specifies a penalty rather than a bonus:
# "below level 5, the weapon will suffer 50% of damage and accuracy debuff, after
# level 5, each level will increase 5% of effectiveness."
_WEAPONRY = [
    ('skl_wpn_ballistic', 'Ballistic Weapon', 'kinetic',
     'Autocannons, railguns and gauss -- anything that throws mass.'),
    ('skl_wpn_energy', 'Energy Weapon', 'energy',
     'Lasers, plasma and particle weapons.'),
    ('skl_wpn_missiles', 'Missiles', 'missile',
     'Missile racks, torpedo tubes and seeker ordnance.'),
    ('skl_wpn_drones', 'Drones', 'drone',
     'Combat drones flown from a hangar bay rather than fired from a mount.'),
]

WEAPONRY = [
    S(sid, name, 'ship_command', 'weaponry', 3, 'ship',
      f'{blurb} Below level {OPERATE_LEVEL} the weapon suffers a 50% damage and accuracy '
      f'debuff; level {OPERATE_LEVEL} clears it, and each level after that adds 5% '
      f'effectiveness.',
      effects=[E('weaponDamage', 5.0, from_level=OPERATE_LEVEL + 1, weaponClass=wclass),
               E('weaponAccuracy', 5.0, from_level=OPERATE_LEVEL + 1, weaponClass=wclass)],
      penalties=[P('weaponDamage', -50.0, weaponClass=wclass),
                 P('weaponAccuracy', -50.0, weaponClass=wclass)])
    for sid, name, wclass, blurb in _WEAPONRY
]

_DRILL = 'skl_flt_formation_drill'

FLEET_COMMAND = [
    S(_DRILL, 'Formation Drill', 'ship_command', 'fleet_command', 4, 'fleet',
      'Working more than one hull as a unit. Each gate adds a ship to the fleet; the '
      'first ship needs no drill at all.',
      unlocks=[U(5, 'fleet_slot', '2', 'Second ship in the fleet.'),
               U(7, 'fleet_slot', '3', 'Third ship in the fleet.'),
               U(8, 'fleet_slot', '4', 'Fourth ship in the fleet.'),
               U(10, 'fleet_slot', '5', 'Fifth ship in the fleet -- the maximum.')]),
    S('skl_flt_attacking_formation', 'Attacking Formation',
      'ship_command', 'fleet_command', 4, 'fleet',
      'Offensive station-keeping. Each level adds 1% to accuracy, damage, navigation and '
      'weapon tracking across every ship in the fleet.',
      effects=[E('weaponAccuracy', 1.0), E('weaponDamage', 1.0),
               E('topSpeed', 1.0), E('weaponTracking', 1.0)],
      prerequisites=[R(_DRILL, 5)]),
    S('skl_flt_defensive_formation', 'Defensive Formation',
      'ship_command', 'fleet_command', 4, 'fleet',
      'Defensive station-keeping. Each level adds 1% to maintenance, energy shields, '
      'damage control, damage reduction and evasion across every ship in the fleet.',
      effects=[E('repairRatePerTurn', 1.0), E('rechargeRatePerTurn', 1.0),
               E('criticalEventResistance', 1.0), E('damageReduction', 1.0),
               E('evasionRating', 1.0)],
      prerequisites=[R(_DRILL, 5)]),
    S('skl_flt_mining_formation', 'Mining Operation Formation',
      'ship_command', 'fleet_command', 3, 'fleet',
      'Running a fleet as a mining detail. Each level adds 2% to the mining output of '
      'every ship in the fleet.',
      effects=[E('miningYield', 2.0)],
      prerequisites=[R(_DRILL, 5)]),
    S('skl_flt_regroup_and_hold', 'Regroup and Hold',
      'ship_command', 'fleet_command', 4, 'fleet',
      'Re-forming after disruption. Heavy damage scatters a fleet, and a scattered fleet '
      'loses every fleet bonus until it re-forms; each level brings the survivors back '
      'into formation faster.',
      effects=[E('fleetRegroupRate', 5.0)],       # per-level figure PROPOSED
      prerequisites=[R(_DRILL, 5)]),
    S('skl_flt_fighter_squadron_control', 'Fighter Squadron Control',
      'ship_command', 'fleet_command', 4, 'fleet',
      'Directing fighter and bomber squadrons. Each level adds 1% to squadron speed, '
      'accuracy and evasion.',
      effects=[E('squadronSpeed', 1.0), E('squadronAccuracy', 1.0),
               E('squadronEvasion', 1.0)],
      prerequisites=[R(_DRILL, 5)]),
]

# ================================================== PLANETARY & STATION MANAGEMENT
# The spec names six skills and one rule: "Science: Restrict all Mining, Production and
# Refining Operation, with this skill reached certain level, other operations will be
# unlocked for learning." Science is therefore a prerequisite on everything in this
# domain and in Deep Space Mining. The three gate levels (3/5/7) are PROPOSED, as are
# every per-level figure below.
_SCIENCE = 'skl_sta_science'

SCIENCE = [
    S(_SCIENCE, 'Science', 'station_management', 'science', 5, 'player',
      'Theory before practice. Nothing in mining, production or refining can be trained '
      'until Science reaches the level that opens it -- raw operations first, then '
      'refining, then fabrication.',
      unlocks=[U(3, 'skill_group', 'raw_operations',
                 'Mining and raw-resource production skills become trainable.'),
               U(5, 'skill_group', 'refined_operations',
                 'Material refinement skills become trainable.'),
               U(7, 'skill_group', 'manufactured_operations',
                 'Manufactory and ship-construction skills become trainable.')]),
]

FACILITY_MANAGEMENT = [
    S('skl_sta_resource_production', 'Planetary Resource Production',
      'station_management', 'facility_management', 3, 'station',
      'Running extraction on a planet. Each level adds 3% to planetary production rate.',
      effects=[E('planetaryProductionRate', 3.0, resourceTier='raw')],
      prerequisites=[R(_SCIENCE, 3)]),
    S('skl_sta_production_management', 'Planetary Production Management',
      'station_management', 'facility_management', 3, 'station',
      'Warehousing and throughput. Each level adds 10% to how much resource a site can '
      'hold.',
      effects=[E('warehouseCapacity', 10.0)],
      prerequisites=[R(_SCIENCE, 3)]),
    # +1%/level is deliberately small: refineryYield multiplies a conversionYield that
    # must stay below 1. Structural is the highest at 0.90, and 0.90 x 1.10 = 0.99.
    # verify_skills.py enforces this against the live resource catalogue.
    S('skl_sta_refinement', 'Material Refinement Management',
      'station_management', 'facility_management', 4, 'station',
      'Planetary and station refineries. Each level recovers 1% more material from the '
      'raw feedstock, against a lane yield that can never reach 1.',
      effects=[E('refineryYield', 1.0, resourceTier='refined')],
      prerequisites=[R(_SCIENCE, 5)]),
    S('skl_sta_manufactory', 'Manufactory Management',
      'station_management', 'facility_management', 4, 'station',
      'Fabricating finished components from refined material. Each level adds 3% to '
      'manufacturing rate.',
      effects=[E('manufacturingRate', 3.0, resourceTier='manufactured')],
      prerequisites=[R(_SCIENCE, 7)]),
    S('skl_sta_ship_construction', 'Ship Construction Management',
      'station_management', 'facility_management', 5, 'station',
      'Laying down hulls in a yard. Each level adds 3% to construction rate.',
      effects=[E('shipConstructionRate', 3.0)],
      prerequisites=[R(_SCIENCE, 7), R('skl_sta_manufactory', 5)]),
]

# ================================================================ DEEP SPACE MINING
# The spec names four skills in an obvious basic/advanced pairing and gives no numbers;
# the ladder and the prerequisites between them are PROPOSED.
MINING = [
    S('skl_mine_equipment_operation', 'Mining Equipment Operation',
      'deep_space_mining', 'mining_operations', 2, 'ship',
      'Operating standard mining gear. Each level cuts cycle time by 2%.',
      effects=[E('miningCycleSpeed', 2.0)],
      unlocks=[U(1, 'capability', 'standard_mining_equipment',
                 'Fit and run standard mining equipment.')],
      prerequisites=[R(_SCIENCE, 3)]),
    S('skl_mine_advanced_equipment', 'Advanced Mining Equipment Operation',
      'deep_space_mining', 'mining_operations', 4, 'ship',
      'Operating advanced mining gear. Each level cuts cycle time by a further 3%.',
      effects=[E('miningCycleSpeed', 3.0)],
      unlocks=[U(1, 'capability', 'advanced_mining_equipment',
                 'Fit and run advanced mining equipment.')],
      prerequisites=[R('skl_mine_equipment_operation', 5), R(_SCIENCE, 5)]),
    S('skl_mine_effectiveness', 'Mining Effectiveness',
      'deep_space_mining', 'mining_operations', 3, 'ship',
      'Getting more out of each cycle. Each level adds 3% to mining yield.',
      effects=[E('miningYield', 3.0)],
      prerequisites=[R('skl_mine_equipment_operation', 3)]),
    S('skl_mine_advanced_effectiveness', 'Advanced Mining Effectiveness',
      'deep_space_mining', 'mining_operations', 5, 'ship',
      'Yield optimisation on advanced gear. Each level adds a further 4% to mining yield.',
      effects=[E('miningYield', 4.0)],
      prerequisites=[R('skl_mine_effectiveness', 5), R('skl_mine_advanced_equipment', 5)]),
]

# ============================================================== INTERACTION & TRADE
# Two skills named, no numbers. Everything here is PROPOSED.
COMMERCE = [
    S('skl_trd_trade', 'Trade', 'interaction_trade', 'commerce', 2, 'player',
      'Buying and selling. Each level improves the margin a player trades at by 2%.',
      effects=[E('tradePriceMargin', 2.0)]),
    S('skl_trd_union_management', 'Union Management',
      'interaction_trade', 'commerce', 5, 'player',
      'Running a union -- a league of many players. Each level raises the member cap by 5.',
      effects=[E('unionMemberCapacity', 5.0, kind='flat')],
      prerequisites=[R('skl_trd_trade', 5)]),
]

SKILLS = (ship_skills() + NAVIGATION + SCANNING + ENGINEERING + WEAPONRY + FLEET_COMMAND
          + SCIENCE + FACILITY_MANAGEMENT + MINING + COMMERCE)

BY_ID = {s['skillId']: s for s in SKILLS}

assert set(HULL_DISPLAY) == {c['key'] for c in CATEGORIES}, 'HULL_DISPLAY out of sync with CATEGORIES'
assert len(BY_ID) == len(SKILLS), 'duplicate skillId'
assert len(SKILLS) == 80, len(SKILLS)
