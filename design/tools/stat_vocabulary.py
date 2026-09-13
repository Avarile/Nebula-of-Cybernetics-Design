#!/usr/bin/env python3
"""The one list of stats anything in this dataset is allowed to modify.

Lifted out of generate_modules.py so the module catalogue and the skill catalogue
cannot drift apart: a stat named in one is a stat the other recognises. Anything
outside these lists is a typo, not a new stat.

SHIP_STATS   stats a MODULE may modify -- each one has a field on the hull.
SKILL_STATS  stats only a SKILL reaches. These are player/fleet/station-level
             multipliers with no hull field to sit on: weapon-class effectiveness,
             squadron performance, mining and industry rates, trade margins.
ALL_STATS    the union; what a skill effect may target.
"""

# Ship stats a module may modify. Every entry resolves to a field on the hull.
SHIP_STATS = [
    'topSpeed', 'acceleration', 'turnRate', 'evasionRating', 'fuelRange',
    'hull.maxHP', 'hull.armorRating', 'hull.regenPerTurn',
    'shields.maxHP', 'rechargeRatePerTurn', 'shields.rechargeDelayAfterHit',
    'power.maxPower', 'power.regenPerTurn',
    'sensorArray.effectiveness', 'detectionRange', 'initiative', 'weaponAccuracy',
    'criticalChanceBonus', 'pointDefenseBonus', 'enemyHitChance',
    'crew.gunnerySkill', 'crew.engineeringSkill', 'crew.pilotSkill', 'crewRecoveryRate',
    'repairRatePerTurn', 'cargoCapacity', 'ammoCapacity', 'mineCapacity', 'minesweepRate',
    'troopCapacity', 'aircraftCapacity', 'droneCapacity', 'medicalCapacity',
    'fuelTransferRate',
]

# Stats only a skill reaches -- no hull field, so a module can never target them.
SKILL_STATS = [
    # weapon effectiveness, always qualified by appliesTo.weaponClass
    'weaponDamage', 'weaponTracking',
    # survivability the hull has no single field for
    'damageReduction', 'criticalEventResistance', 'electronicSystemsEffectiveness',
    # fleet-level
    'fleetRegroupRate', 'squadronSpeed', 'squadronAccuracy', 'squadronEvasion',
    # deep space mining
    'miningYield', 'miningCycleSpeed',
    # planetary / station industry
    'planetaryProductionRate', 'warehouseCapacity', 'refineryYield',
    'manufacturingRate', 'shipConstructionRate',
    # interaction & trade
    'tradePriceMargin', 'unionMemberCapacity',
]

ALL_STATS = SHIP_STATS + SKILL_STATS

# Stats where a NEGATIVE modifier is the benefit (suppressing enemy accuracy, cutting a delay).
BENEFICIAL_NEGATIVE = {'enemyHitChance', 'shields.rechargeDelayAfterHit'}

assert len(set(ALL_STATS)) == len(ALL_STATS), 'duplicate stat name'
assert not (set(SHIP_STATS) & set(SKILL_STATS)), 'stat in both lists'
assert BENEFICIAL_NEGATIVE <= set(ALL_STATS), 'BENEFICIAL_NEGATIVE names an unknown stat'
