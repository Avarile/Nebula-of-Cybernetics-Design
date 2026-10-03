#!/usr/bin/env python3
"""Authored constants for combat resolution.

Stands in the same relation to Combat-logic/combat_logic_specification.md as
gameplay_tables.py does to GamePlay/*.md: this file is the source of truth for every
number the five combat rulings and the special-effect rules introduce, the spec
explains them, and tools/verify_combat.py holds the two together.

Only the RULED terms live here. The range bands and signature coefficients are still
stated in Combat-logic/advanced_combat_system.json, which no tool reads yet; moving them
is not part of the rulings. The speed-evasion constants moved here when R6 recalibrated
them.

Clock words follow gameplay_specification.md 3: a field or stat that counts combat
ROUNDS says Round (shotsPerRound, cooldownRounds, rechargeRatePerRound, regenPerRound);
one that says Turn means the 24-hour turn (repairRatePerTurn, a between-battle rate).
verify_naming.py holds the allowlist of every name that may still say turn.
"""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gameplay_tables import RETREAT_THRESHOLD   # stated ONCE there; never restated here

# ----------------------------------------------------------------- R2: hit formula
# combat_logic_specification.md 2.1. v2 extends v1, so both v1 terms are carried.

GUNNERY_SKILL_DIVISOR = 200             # baseChance += ship.crew.gunnerySkill / 200
COMPONENT_TARGETING_PENALTY = -0.20     # baseChance -= 0.20 when a component is targeted

# ----------------------------------------------------------------- R5: sensorDebuff
# v1's undefined sensorDebuff IS the sensorArray critical, nothing more. A disabled or
# destroyed component multiplies the attacker's preLockChance by this factor. The
# bridge carries the same kind of accuracy critical, so it is ruled in the same place.

COMPONENT_ACCURACY_CRITICALS = {
    'sensorArray': 0.60,    # '-40% hit chance, reduced detection range'
    'bridge':      0.50,    # 'disables targeting computer, -50% accuracy'
}

# ----------------------------------------------------------------- R4: retreat
# RETREAT_THRESHOLD is imported above. A hull at or below it attempts to break off.

# ----------------------------------------------------------------- interception
# combat_logic_specification.md 2.5. One pooled sub-phase per defending ship per round.
#
#   interceptChance = clamp(pd.baseHitChance + pd.tracking * trackingFactor / 150
#                           + interceptChanceDelta - projectileEvasion, 0.05, 0.95)
#
# A HIGHER projectileEvasion makes a projectile HARDER to intercept. The v2 JSON had
# high_tracking at -0.10, which made tracking missiles easier to shoot down -- the
# opposite of its own comment. The sign is fixed here and the verifier pins it.

INTERCEPT_TRACKING_DIVISOR = 150
PROJECTILE_EVASION_BASE = 0.20

# Which effects put a weapon into the interception pool, and what each may engage.
# 'craft' = fighters and drones; how they launch, attack and are lost is R7 (spec 2.6).
POOL_EFFECTS = {
    'point_defense': ('missile', 'craft'),
    'anti_missile':  ('missile',),
    'anti_air':      ('craft',),
}

# ----------------------------------------------------------------- weapon roles
# The contexts a special effect can act in. verify_combat.py derives, for every weapon
# in the catalogue, which contexts it occupies, and fails unless each (effect, context)
# pair below is either ruled or explicitly declared inert with a reason.
#
#   hit         the damage step of a shot that landed (direct fire, a surviving
#               missile, a melee strike)
#   projectile  the shot as a target of the interception sub-phase
#   intercept   the weapon firing inside the interception pool
#   mine        a laid field: when it detonates and how long it lasts

CONTEXTS = ('hit', 'projectile', 'intercept', 'mine')

# Marker values for a context an effect occupies but does nothing new in.
AS_HIT = {'as': 'hit', 'why': 'a detonation applies damage through the hit rule'}


def inert(why):
    return {'inert': why}


# Assigning a pool weapon. A weapon carrying any POOL_EFFECTS key is put in the pool
# by default during targeting; its owner may instead assign it to direct fire for that
# round. It never does both in one round.
POOL_ASSIGNMENT = {
    'rule': 'defaults to the interception pool; may be assigned to direct fire in '
            'targeting instead, never both in one round',
}

# ----------------------------------------------------------------- mines
# A field is laid against a chosen enemy ship within range.maximum. Without
# proximity_trigger it is command-detonated: it fires on that ship only, at the next
# round's direct-fire step, if the ship is still within range.optimal of the field.
# Without area_denial it is consumed by its first detonation. A field sits at a fixed
# position on the engagement line (R6, spec 1.4): the anchor's position when it is laid.
# A command field whose anchor is beyond range.optimal of it at that step is spent.

MINE_BASE = {
    'detonation': 'command: the anchor ship only, next round, if within range.optimal '
                  'of the field; otherwise the field is spent',
    'position': "the anchor's position on the engagement line when the field is laid",
    'hitRoll': False,              # mines never use the master hit formula
    'consumedOnDetonation': True,
    # Decided with R7. A command field needs its layer to fire it; a proximity field
    # fires itself. Nothing outlives the battle.
    'layerGone': 'when the layer is destroyed or disengages, its command fields are '
                 'spent; its proximity fields stay on the line until they detonate, '
                 'their area_denial rounds run out, or they are swept',
    'engagementEnd': 'every field still on the line expires when the engagement ends',
}

# ----------------------------------------------------------------- special effects
# Every effect in weapons.ts WeaponSpecialEffect, tabulated in the spec's 3.4. The
# two v1 rules (ignores_shields_partial, armor_piercing) keep their v1 values and gain
# only the clarifications v1 left open.

SPECIAL_EFFECT_RULES = {
    'ignores_shields_partial': {
        'hit': {'bypassFraction': 0.50,
                'rule': '50% of rawDamage skips shields and goes to the hull step, '
                        'where armour still applies'},
        'projectile': inert('a projectile property; resolves when the shot lands'),
    },
    'armor_piercing': {
        'hit': {'armorRatingFactor': 0.50,
                'rule': "the target's armorRating is halved for this hit, after armor_melt"},
        'projectile': inert('a projectile property; resolves when the shot lands'),
        'mine': AS_HIT,
    },
    'armor_melt': {
        'hit': {'armorLossPerHit': 0.05, 'armorFloor': 0.50, 'duration': 'engagement',
                'rule': "every hit that deals hull damage lowers the target's armorRating "
                        'by 5% of its base, to a floor of 50% of base, for the rest of the '
                        'engagement'},
        'projectile': inert('a projectile property; resolves when the shot lands'),
        'mine': AS_HIT,
    },
    'shield_disrupt': {
        'hit': {'resistanceFactor': 0.50,
                'rule': "the target's shields.damageTypeResistance is halved for this hit"},
    },
    'emp_disable': {
        'hit': {'durationRounds': 2, 'topSpeedFactor': 0.70, 'shieldRechargeSuppressed': True,
                'rule': 'on every hit: shield recharge suppressed and topSpeed x0.70 for 2 '
                        'rounds; a second EMP hit refreshes the duration, never stacks'},
    },
    'multi_hit': {
        'hit': {'followUpDamageFraction': 0.50, 'followUpRollsCritical': False,
                'excludes': 'can_be_intercepted',
                'rule': 'every hit is followed by a second damage application at 50%, '
                        'with no hit roll and no critical roll of its own. Not for '
                        'interceptable weapons: their volley size is already the multiple'},
        'projectile': {'projectileEvasionDelta': +0.05,
                       'rule': 'each missile of the volley is +0.05 harder to intercept'},
        'intercept': {'extraAttemptsPerMount': 1,
                      'rule': '+1 interception attempt per mount per round'},
        'mine': AS_HIT,
    },
    'high_tracking': {
        'hit': {'trackingFactor': 1.25,
                'rule': "the weapon's tracking counts x1.25 in the speed-evasion formula"},
        'intercept': {'trackingFactor': 1.25,
                      'rule': "the weapon's tracking counts x1.25 in interceptChance"},
        'projectile': {'projectileEvasionDelta': +0.10,
                       'rule': 'a tracking missile is +0.10 harder to intercept'},
    },
    'proximity_trigger': {
        'hit': {'nearMissBand': 0.10, 'nearMissDamageFraction': 0.50,
                'rule': 'a miss whose roll is within 0.10 above finalHitChance still '
                        'detonates for 50% damage, with no critical roll'},
        'intercept': {'interceptChanceDelta': +0.10,
                      'rule': 'a near miss kills light targets: +0.10 interceptChance'},
        'mine': {'triggerRadiusFraction': 0.10, 'friendlyFire': True,
                 'rule': 'the field detonates with no hit roll on the first ship of EITHER '
                         'side, in movement order, that ends phase 5 within 0.10 x '
                         "range.optimal of it or whose movement crosses the field's position"},
    },
    'area_denial': {
        'hit': {'splashFraction': 0.25, 'splashTargets': 2, 'splashDistanceBand': 0.10,
                'rule': '25% of rawDamage also strikes up to 2 other ships of the '
                        "target's side whose distance from the attacker is within +-10% "
                        "of the target's. Splash passes shields and armour normally and "
                        'never rolls a critical'},
        'projectile': inert('splash resolves when the missile lands'),
        'intercept': {'extraKillsPerSuccessVsCraft': 1,
                      'rule': 'a successful attempt against craft also downs one more '
                              'craft of the same wave'},
        'mine': {'persistRounds': 3,
                 'rule': 'the field is not consumed: it persists 3 rounds and detonates '
                         'at most once per ship per round'},
    },
    'point_defense': {
        'intercept': {'engages': list(POOL_EFFECTS['point_defense']), 'interceptChanceDelta': 0.0,
                      'rule': 'joins the pool; engages missiles and craft at base chance'},
        'hit': POOL_ASSIGNMENT,
    },
    'anti_missile': {
        'intercept': {'engages': list(POOL_EFFECTS['anti_missile']), 'interceptChanceDelta': +0.10,
                      'rule': 'joins the pool; +0.10 interceptChance against missiles'},
        'hit': POOL_ASSIGNMENT,
    },
    'anti_air': {
        'intercept': {'engages': list(POOL_EFFECTS['anti_air']), 'interceptChanceDelta': +0.10,
                      'rule': 'joins the pool; +0.10 interceptChance against craft'},
        'hit': POOL_ASSIGNMENT,
    },
    'can_be_intercepted': {
        'projectile': {'projectileEvasionBase': PROJECTILE_EVASION_BASE,
                       'rule': 'the shot enters the interception sub-phase before any hit '
                               'roll. The missile hit profile\'s "interceptable" is read '
                               'from this flag, not from weaponClass'},
        'hit': inert('marks the projectile only'),
    },
}

# ----------------------------------------------------------------- R8: effective stats
# combat_logic_specification.md 1.3. Every skill and module effect reaches combat
# through ONE stacking rule:
#
#   effective(stat) = (base + sum(flat)) * (1 + sum(percent) / 100) * product(penalty)
#
# percent sources are modules, ship-scope skills and fleet-scope skills, summed
# together. A skill penalty is a GATE, not a modifier: each active one multiplies by
# (1 + modifier / 100) on its own, so no module or bonus can buy it back. Fleet-scope
# skills drop out while the fleet is disrupted (conflict_specification.md 4.3).
#
# A stat's KIND says what "base" means:
#   field       a hull field is the base (topSpeed, hull.armorRating, ...)
#   multiplier  no hull field; base 1, so effective() is a pure multiplier
#   additive    no hull field; base 0, flat values add in the stat's UNIT and percent
#               values add as percentage points -- the result is a fraction
#
# UNIT matters because the module catalogue is not uniform: enemyHitChance is written
# in percentage points (-11.5) while criticalChanceBonus is a fraction (0.029).
# verify_combat.py checks every module value against its stat's unit.

STAT_KIND = {
    # stat:                          (kind,         unit for flat values)
    'weaponAccuracy':                ('multiplier', None),
    'weaponDamage':                  ('multiplier', None),
    'weaponTracking':                ('multiplier', None),
    'pointDefenseBonus':             ('multiplier', None),
    'sensorArray.effectiveness':     ('multiplier', None),
    'electronicSystemsEffectiveness': ('multiplier', None),
    'squadronSpeed':                 ('multiplier', None),   # R7: fighters only (spec 2.6)
    'squadronAccuracy':              ('multiplier', None),
    'squadronEvasion':               ('multiplier', None),
    'enemyHitChance':                ('additive',   'points'),
    'criticalChanceBonus':           ('additive',   'fraction'),
    'criticalEventResistance':       ('additive',   'fraction'),
    'damageReduction':               ('additive',   'fraction'),
    'crewRecoveryRate':              ('additive',   'fraction'),
    'minesweepRate':                 ('additive',   'fraction'),
    'fleetRegroupRate':              ('additive',   'fraction'),
}

# 'field' stats whose hull field is not found by name alone.
HULL_FIELD_ALIASES = {
    'mineCapacity':    'capacities.mines',
    'medicalCapacity': 'capacities.medical',
    'repairRatePerTurn': 'capacities.repairRate',
    'aircraftCapacity': 'capacities.aircraft',     # R7: fighters carried (spec 2.6)
    'droneCapacity':    'capacities.drones',       # R7: drones carried
}

# Caps on the additive stats that would otherwise break a formula at the extreme.
ADDITIVE_CAPS = {
    'criticalEventResistance': 0.75,
    'damageReduction':         0.50,
    'crewRecoveryRate':        0.90,
}

# Stats whose consuming rule belongs to a ruling that is still open. The strengthened
# no-dead-skill check accepts these ONLY while the named ruling is open in combat.ts.
# Empty since R7 ruled the last five (aircraftCapacity, droneCapacity, squadron*).
PENDING_RULINGS = {}

# --- 1.1 initiative
#   initiativeScore = effective(sensors.initiative) + effective(crew.pilotSkill) / 5 + d20
PILOT_SKILL_INITIATIVE_DIVISOR = 5

# --- 2.3 electronics. electronicSystemsEffectiveness multiplies the MAGNITUDE of every
# effect carried by these module types (and the ecmModuleActive signature cut).
ELECTRONIC_MODULE_TYPES = ('radar', 'sonar', 'cic', 'datalink', 'ecm', 'decoy',
                           'ecCounterElectronics', 'targetingComputer', 'fireControl',
                           'pdCoordinator')

# --- 2.3 lock range (R9). Anchored on the hull's own detectionRange, which the old
# formula never read:
#
#   lockRange = effective(detectionRange)
#               * componentCurrentHP.sensorArray / sensorArray.maxHP   (live HP: CombatantState)
#               * effective(sensorArray.effectiveness)
#               * clamp((targetSignature / 16) ** 0.5, 0.25, 4.0)
#
# Calibrated on the only lock claims the repo makes: the v2 worked example
# (Leviathan Crown holds Whisperfang at 1,900) and Sable/Ember round 2 (Wraithbolt
# locks Stormbreaker at 2,600; Stormbreaker sees both lit cruisers but neither silent
# destroyer; Silverlance fires blind at Corvus). Those claims admit a reference between
# about 4 and 17; 16 is near the top, so signature keeps mattering for as many hulls as
# possible. verify_combat.py recomputes every claim (LOCK_CLAIMS).
DETECTION_SIGNATURE_REFERENCE = 16
DETECTION_SIGNATURE_EXPONENT = 0.5
DETECTION_SIGNATURE_FACTOR_BOUNDS = (0.25, 4.0)

# (attacker, target, target signature multiplier, distance, locked?) -- named ships.
# Multipliers are the 2.3 state table: shields active x1.10, one volley fired x1.08,
# running silent x0.50.
LOCK_CLAIMS = [
    ('Leviathan Crown', 'Whisperfang',  1.10,        1900, True),    # v2 worked example
    ('Wraithbolt',      'Stormbreaker', 1.10,        2600, True),    # Sable/Ember round 2
    ('Stormbreaker',    'Wraithbolt',   1.10 * 1.08, 2600, True),    #   the lit cruisers
    ('Stormbreaker',    'Silverlance',  1.10 * 1.08, 2600, True),
    ('Stormbreaker',    'Whisperfang',  0.50,        2600, False),   #   the silent destroyers
    ('Stormbreaker',    'Nightstrike',  0.50,        2600, False),
    ('Silverlance',     'Corvus',       1.10,        2600, False),   #   blind fire
]

# --- 2.4 turn penalty, applied to a ship that changed heading this round:
#   turnPenalty = 0.5 * (1 - min(effective(turnRate), 150) / 150)
TURN_PENALTY_MAX = 0.5
TURN_RATE_REFERENCE = 150

# ----------------------------------------------------------------- R6: movement
# combat_logic_specification.md 1.4. Every ship and every mine field has a POSITION on
# one engagement line, in the same distance units as weapon ranges and detectionRange.
# distance(a, b) = |position(a) - position(b)|. Speed is distance per time unit, and
# acceleration is speed per time unit; one combat round lasts ROUND_TIME time units:
#
#   maxSpeed     = effective(topSpeed) * product(MOVEMENT_STATE_FACTORS that apply)
#   speedStep    = effective(acceleration) * ROUND_TIME   (x AFTERBURNER_FACTOR too)
#   v0           = min(speed, maxSpeed); if the ship reverses: v0 *= 1 - turnPenalty
#   v1           = v0 moved toward the intent's speed by at most speedStep
#   displacement = min((v0 + v1) / 2 * ROUND_TIME, distance the intent still needs)
#
# ROUND_TIME is calibrated on Sable/Ember rounds 1-2: SABLE holds, and EMBER's line,
# whose slowest hull is Obsidian March at 201, closes the logged 3,400 -> 2,600 in one
# round. 4 is the smallest whole value that reaches 800 (201 x 4 = 804);
# verify_combat.py recomputes every logged range progression (RANGE_CLAIMS).
ROUND_TIME = 4

# A ship never takes more than this many rounds to reach top speed from rest. The
# slowest is Leviathan Crown (140 / (8 x 4) = 4.4 rounds); the bound keeps acceleration
# meaningful without letting it eat a fifth of the ROUND_CAP.
MAX_ROUNDS_TO_TOP_SPEED = 5

# Declared in phase 2 with the operating state; resolved in phase 5.
#   hold      brake toward speed 0, drifting along the current heading meanwhile
#   close     head toward a target; stop at a standoff distance (default 0)
#   open      head away from a target; stop at a standoff distance (default: never)
#   withdraw  head for the own side's rear at full speed; the only way to disengage
# Every moving intent takes an optional speedLimit (formation keeping is a speedLimit
# equal to the slowest hull's maxSpeed). A ship that reaches its standoff keeps its
# speed and spends the rest of the round station-keeping, so it keeps its speed-evasion.
MOVEMENT_INTENTS = ('hold', 'close', 'open', 'withdraw')

# Multipliers on maxSpeed. Each applies while its state lasts; they multiply together.
#   runningSilent        the 2.3 state table's '-30% top speed'
#   empDisable           SPECIAL_EFFECT_RULES['emp_disable'] topSpeedFactor (2 rounds)
#   enginesCritical      the engines criticalEffect '-70% speed and turn rate', while the
#                        component is disabled or destroyed; it also cuts turnRate x0.30
#   afterburner          +25% top speed AND acceleration, bought with +40% signature
RUNNING_SILENT_SPEED_FACTOR = 0.70
ENGINE_CRITICAL_FACTOR = 0.30
AFTERBURNER_FACTOR = 1.25

# --- 2.4 speed-based evasion (R6 recalibration). The old divisor (250, tracking taken
# at face value) gave 99% of hull-vs-weapon matchups the full 0.35 bonus. Tracking now
# counts x5 in speed units, and every 100 speed of excess is +0.10 evasion:
#
#   speedEvasionBonus = clamp((relativeSpeedFactor - trackingCounter * 5) / 1000, 0, 0.35)
#
# Over every catalogue hull's topSpeed against every direct-fire weapon's tracking, about
# 17% of matchups get nothing, 73% are graded and 10% saturate. verify_combat.py
# recomputes those shares against the two bounds below.
TRACKING_SPEED_FACTOR = 5
SPEED_EVASION_DIVISOR = 1000
SPEED_EVASION_CAP = 0.35
SPEED_EVASION_SATURATED_MAX = 0.15     # at most this share of matchups hits the cap
SPEED_EVASION_GRADED_MIN = 0.50        # at least this share falls strictly between

# --- 3.7 disengagement. A withdrawing ship disengages at the end of a round in which no
# enemy holds a lock on it (2.3 effectiveDetectionRange < distance for every enemy).
# There is no constant: lock range and relative speed decide it, as conflict 4 item 4
# says. At ROUND_CAP every ship still present disengages.

# --- battle-log plausibility. Each claim is a logged range at two rounds; it is
# reachable when the change fits inside the rounds between at the closing sides'
# formation speed (the slowest roster hull of each side that is moving that way).
#   (log file, side(s) closing, round from, distance from, round to, distance to)
RANGE_CLAIMS = [
    ('battle_log_sable_vs_ember.md',   ('EMBER',),           1, 3400, 2, 2600),  # SABLE holds silent
    ('battle_log_sable_vs_ember.md',   ('EMBER',),           2, 2600, 4, 1100),
    ('battle_log_veritas_vs_cinder.md', ('VERITAS', 'CINDER'), 1, 5200, 3, 3600),  # intercept vectors
    ('battle_log_veritas_vs_cinder.md', ('VERITAS', 'CINDER'), 3, 3600, 5, 3000),
]

# The opening distance (1.4): the side that can lock the other from further out chooses
# it, anywhere between the other side's first-lock range and its own.
#   (log file, opening distance, {side: (signature multiplier as a target, Scanning level)})
# Sable/Ember: SABLE runs silent (x0.50); EMBER's shields are up (x1.10). Veritas/Cinder:
# neither runs silent; both battlecruiser lines cap at 5,000, and one level of Scanning
# on VERITAS (+3% detectionRange, +2% sensorArray.effectiveness) reaches the logged 5,200.
OPENING_CLAIMS = [
    ('battle_log_sable_vs_ember.md',    3400, {'SABLE': (0.50, 0), 'EMBER': (1.10, 0)}),
    ('battle_log_veritas_vs_cinder.md', 5200, {'VERITAS': (1.10, 1), 'CINDER': (1.10, 0)}),
]

# --- 3.6 criticals
#   triggerChance = weapon.criticalChance + attacker.effective(criticalChanceBonus)
#   resistChance  = defender.effective(criticalEventResistance)
#                   + effective(crew.engineeringSkill) / 200        -> downgrade one band
ENGINEERING_SKILL_DIVISOR = 200
#   lifeSupport disabled or destroyed: lose 5% of maxCrew per round,
#   x (1 - effective(crewRecoveryRate)); medicalCapacity returns casualties after.
LIFE_SUPPORT_CASUALTY_RATE = 0.05

# --- conflict 4.3 disruption (owned by GamePlay, numbers here with the other hooks)
#   disrupted when, in one round, the fleet loses a hull or takes hull damage
#   >= 25% of its summed hull.maxHP; regroup chance per end of round =
#   0.25 + effective(fleetRegroupRate)
DISRUPTION_HULL_FRACTION = 0.25
REGROUP_BASE_CHANCE = 0.25

# --- 1.2 resolution granularity. Below this many hulls a side, every shot resolves and logs
#   on its own; at or above it, same-class exchanges batch per phase. The logs bracket it:
#   Sable/Ember (5 v 7) is shot by shot, Veritas/Cinder (13 v 17) per task group.
#   Reference/constants.ts GRANULARITY_POLICY mirrors it.
GRANULARITY_HULLS_PER_SIDE = 9

# ----------------------------------------------------------------- R7: strike craft
# combat_logic_specification.md 2.6. Two kinds of craft, each with its own profile.
# Craft are not weapons: no hardpoint, no range band, no lock of their own, and no
# direct-fire weapon can shoot at them. Only the interception pool engages them, and
# only in a round they attack (or by escorting craft).
#
# A ship carries floor(effective(capacityStat)) craft of a kind. Capacity is
# capacities.aircraft / capacities.drones plus the hangar modules' flat values
# (Aircraft Elevator, Seaplane Catapult, ASW Aircraft Bay / Drone Bay, Drone Controller).
#
# Launch and recovery happen in phase 5. Craft aboard at the start of an engagement are
# stowed and first launch in round 1 + coldStartRounds. A recovered craft can launch
# again turnaroundRounds after the round it was recovered. Readying runs for any number
# of craft at once and launch has no deck limit: capacity is the only limit, which is
# what lets a carrier mass a saturation strike. A ship running silent neither launches
# nor recovers.
#
# On the engagement line a squadron moves after every ship has moved, at
#   speed x speedStat multiplier x ROUND_TIME
# per round, with no acceleration and no turn penalty, and stops at its destination.
#
# Attack, at phase 8, by every craft that ended phase 5 on its target and survived
# phase 7's interception:
#   baseChance  = baseHitChance x weaponHitProfiles[hitProfile].baseHitChanceModifier
#                 x accuracy multiplier (fighter: effective(squadronAccuracy) of the
#                 carrier; drone: effective(weaponAccuracy)[drone] of the controller,
#                 which carries the Drones skill's x0.50 gate below level 5)
#                 - 0.20 if a component is targeted
#   evasion     = speedEvasionSystem(target, tracking) x (1 - evasionIgnoredFraction)
#   finalHit    = clamp(baseChance - evasion + target.effective(enemyHitChance), 0.05, 0.95)
#   rawDamage   = (damage.base +- variance) x (drone: effective(weaponDamage)[drone])
# no range multiplier, lockQuality 1, no blind-fire penalty, no arming check; shields,
# armour and the critical roll (criticalChance, no criticalChanceBonus) as for any hit.
#
# Interception: craft are projectiles in the 2.5 formula with
#   projectileEvasion = interceptEvasion x (fighter: effective(squadronEvasion))
# 0.20 never mattered against craft: every craft-engaging pool weapon's raw chance is
# 1.33-2.14 before evasion, because tracking / 150 alone is 0.4-0.9. 1.10 puts the
# catalogue's median pool weapon near 0.50 a shot against a fighter, which is what
# Veritas/Cinder needs (Leviathan Crown's two PD lasers, 12 attempts, down 6 of 20).
SQUADRON_SIZE = 6     # Veritas/Cinder: "2 squadrons (12 fighters)", "3 squadrons (18 fighters)"

CRAFT_KINDS = ('fighter', 'drone')

CRAFT_PROFILES = {
    'fighter': {
        'capacityStat': 'aircraftCapacity',
        'speed': 1000,                 # x effective(squadronSpeed); 4,000 a round
        'speedStat': 'squadronSpeed',
        'interceptEvasion': 1.10,      # x effective(squadronEvasion)
        'evasionStat': 'squadronEvasion',
        'baseHitChance': 0.65,         # x effective(squadronAccuracy)
        'accuracyStat': 'squadronAccuracy',
        'damageStat': None,
        'weaponClass': None,           # no Weaponry skill: Fighter Squadron Control instead
        'hitProfile': 'missile',       # the log: "missile profile: +25% base, 50% evasion ignored"
        'tracking': 90,
        'damage': {'base': 115, 'variance': 15, 'damageType': 'explosive'},
        'criticalChance': 0.05,
        'attacksPerSortie': 1,         # one attack run, then it must return and rearm
        'coldStartRounds': 4,          # first launch in round 5
        'turnaroundRounds': 2,         # recovered in round r, launches again in round r + 2
        # Restocked in phase 12, per craft, in manufactured-resource units (by lane),
        # from a warehouse at the same location or by purchase -- like a magazine.
        'restockCost': {'structural': 0.5, 'energy': 0.25, 'ordnance': 0.3, 'precision': 0.55},
    },
    'drone': {
        'capacityStat': 'droneCapacity',
        'speed': 600,                  # no skill reaches it; 2,400 a round
        'speedStat': None,
        'interceptEvasion': 1.00,
        'evasionStat': None,
        'baseHitChance': 0.70,         # x effective(weaponAccuracy)[drone] -- the Drones gate
        'accuracyStat': 'weaponAccuracy',
        'damageStat': 'weaponDamage',  # x effective(weaponDamage)[drone] -- the Drones gate
        'weaponClass': 'drone',
        'hitProfile': 'kinetic',       # gun-armed: direct fire, no evasion discount
        'tracking': 70,
        'damage': {'base': 30, 'variance': 4, 'damageType': 'kinetic'},
        'criticalChance': 0.02,
        'attacksPerSortie': None,      # attacks every round it is on its target
        'coldStartRounds': 1,          # first launch in round 2
        'turnaroundRounds': 1,
        'restockCost': {'structural': 0.3, 'energy': 0.3, 'ordnance': 0.0, 'precision': 0.4},
    },
}

# What a squadron is told to do; declared in phase 2 with the carrier's own intent.
#   strike  fly to an enemy ship and attack it on arrival (a fighter makes one attack
#           run, then returns; a drone stays and attacks every round)
#   escort  fly to a friendly ship and stay with it; each craft adds one attempt a round
#           to that ship's pool against enemy craft, as an anti_air pool weapon would
#   return  fly to the carrier; recovered on arrival
CRAFT_INTENTS = ('strike', 'escort', 'return')

# A full complement never costs more than this share of its hull's buildCost.
CRAFT_WING_COST_SHARE_MAX = 0.25

# Against a fighter at squadronEvasion 1.0, no craft-engaging pool weapon may sit at the
# 0.05 floor, and at most this share may sit at the 0.95 cap -- so squadronEvasion moves
# almost every matchup.
CRAFT_INTERCEPT_CAPPED_MAX = 0.10

# --- battle-log calibration (Veritas/Cinder). The two carriers are not catalogued named
# ships, so each stands for the escort-carrier template whose hangar matches its logged
# squadron count: floor(floor(effective(aircraftCapacity)) / SQUADRON_SIZE).
STRIKE_CARRIERS = {
    'Solmirage':   'ship_escort_carrier_t1',     # 20 + Elevator Mk.1 6   = 26 -> 4 squadrons
    'Cinderwatch': 'ship_escort_carrier_t2',     # 26 + Elevator Mk.2 7.2 = 33 -> 5 squadrons
}

# Each logged strike. `cover` names the catalogued ships whose pool weapons covered the
# target; coverComplete is False where uncatalogued screens (Amberfall, Greywake,
# Thornvale) also fired, so the catalogued cover is only a lower bound. `shields` is
# 'hold', 'collapse', or (before, after) for a logged drop.
STRIKE_LOG = 'battle_log_veritas_vs_cinder.md'
STRIKE_CLAIMS = [
    dict(round=5, carrier='Solmirage', fresh=2, rebuiltCraft=0, launched=12,
         target='Meridian Aegis', cover=("Vanguard's Wake",), coverComplete=False,
         downed=5, attacked=7, hits=4, shields='hold'),
    dict(round=5, carrier='Cinderwatch', fresh=3, rebuiltCraft=0, launched=18,
         target='Stormbreaker', cover=('Obsidian March', 'Auric Drift'), coverComplete=True,
         downed=9, attacked=9, hits=6, shields='collapse'),
    dict(round=7, carrier='Solmirage', fresh=2, rebuiltCraft=0, launched=12,
         target="Vanguard's Wake", cover=(), coverComplete=True,
         downed=4, attacked=8, hits=8, shields='collapse'),
    dict(round=8, carrier='Cinderwatch', fresh=2, rebuiltCraft=8, launched=20,
         target='Leviathan Crown', cover=(), coverComplete=True,
         downed=6, attacked=14, hits=None, shields=(1362, 400)),
]
STRIKE_DOWNED_TOLERANCE = 1.0    # expected craft downed within this of the logged count
STRIKE_HIT_CONFIDENCE = 0.95     # logged hits lie inside this central binomial interval
STRIKE_DAMAGE_TOLERANCE = 0.10   # expected shield loss within this share of the logged one

# ----------------------------------------------------------------- hit profiles
# advanced_combat_system.json weaponHitProfiles covered four classes. Melee had none,
# which left 60 catalogue weapons with no way to resolve. Ruled: melee resolves as
# direct fire. Its range of a few dozen units already forces the attacker alongside
# the target; it gets there with a 'close' intent and a standoff inside that range (R6).

MELEE_HIT_PROFILE = {'baseHitChanceModifier': 1.0, 'evasionIgnoredFraction': 0.0,
                     'ignoresSpeedEvasion': False, 'rollsToHit': True}
