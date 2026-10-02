#!/usr/bin/env python3
"""Authored constants for combat resolution.

Stands in the same relation to Combat-logic/combat_logic_specification.md as
gameplay_tables.py does to GamePlay/*.md: this file is the source of truth for every
number the five combat rulings and the special-effect rules introduce, the spec
explains them, and tools/verify_combat.py holds the two together.

Only the RULED terms live here. The range bands, signature coefficients and evasion
constants are still stated in Combat-logic/advanced_combat_system.json, which no tool
reads yet; moving them is not part of the rulings.

"turn" inside a field name (shotsPerTurn, cooldownTurns, rechargeRatePerTurn) means a
combat ROUND -- gameplay_specification.md 3. Renaming those fields is schema work, not
a ruling, so it is not done here.
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
# 'craft' = fighters and drones; their own resolution is open ruling R7.
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
# Without area_denial it is consumed by its first detonation. Where a ship IS relative
# to a field depends on the movement model, which is open ruling R6.

MINE_BASE = {
    'detonation': 'command: the anchor ship only, next round, if within range.optimal',
    'hitRoll': False,              # mines never use the master hit formula
    'consumedOnDetonation': True,
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
                         'side that comes within 0.10 x range.optimal of it'},
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

# ----------------------------------------------------------------- hit profiles
# advanced_combat_system.json weaponHitProfiles covered four classes. Melee had none,
# which left 60 catalogue weapons with no way to resolve. Ruled: melee resolves as
# direct fire. Its range of a few dozen units already forces the attacker alongside
# the target; closing that distance is the movement model's job (R6).

MELEE_HIT_PROFILE = {'baseHitChanceModifier': 1.0, 'evasionIgnoredFraction': 0.0,
                     'ignoresSpeedEvasion': False, 'rollsToHit': True}
