/**
 * constants.ts — the vocabularies and tuning tables the types above describe.
 *
 * Types alone cannot say that Draconis trades 7 points of hit chance for 30%
 * damage, or that the precision lane refines at 0.50. These tables carry those
 * numbers, each `satisfies` its interface so a typo is a compile error rather
 * than a silent balance change.
 *
 * Every value here was read out of the repo (tools/ship_tables.py,
 * tools/generate_weapons.py, tools/resource_costs.py, Combat-logic/*), not
 * invented. Requires TypeScript 4.9+ for `satisfies`.
 */

import type { ResourceLane, Size, ModuleSlotType, MountType, DamageType } from './common';
import type { ArmorType, ComponentName, ShieldType, ShipClass } from './ships';
import type { WeaponClass, WeaponFamily, WeaponFamilyBias, WeaponSizeAnchor, WeaponSpecialEffect } from './weapons';
import type { ModuleEffectStat, ModuleFunctionClass } from './modules';
import type {
  CriticalBand,
  EvasionConstants,
  HitChanceConstants,
  MissileArmingRule,
  MissileEvasionConstants,
  RangeBandSpec,
  SignatureDerivation,
  SignatureStateModifier,
  TurnPhaseSpec,
  WeaponHitProfiles,
  BlindFireRule,
  GranularityPolicy,
  RetreatPolicy,
  SignificanceRule,
} from './combat';
import type { ConversionYields, ResourceTier } from './resources';
import type { MassBand } from './common';

// ================================================================
// VOCABULARIES  (runtime tuples, for validation and iteration)
// ================================================================

export const SIZES = ['small', 'medium', 'large', 'capital'] as const satisfies readonly Size[];

export const DAMAGE_TYPES = ['kinetic', 'energy', 'explosive'] as const satisfies readonly DamageType[];

export const MOUNT_TYPES = ['fixed', 'turret', 'missile_bay'] as const satisfies readonly MountType[];

export const MODULE_SLOT_TYPES = [
  'engine', 'utility', 'defensive', 'sensor', 'cargo', 'command', 'hangar',
] as const satisfies readonly ModuleSlotType[];

export const MODULE_FUNCTION_CLASSES = [
  'major', 'support', 'specific',
] as const satisfies readonly ModuleFunctionClass[];

export const ARMOR_TYPES = ['light', 'medium', 'heavy', 'reactive'] as const satisfies readonly ArmorType[];

export const SHIELD_TYPES = ['kinetic', 'energy', 'hybrid', 'none'] as const satisfies readonly ShieldType[];

export const COMPONENT_NAMES = [
  'bridge', 'engines', 'weaponSystems', 'shieldGenerator', 'sensorArray', 'lifeSupport',
] as const satisfies readonly ComponentName[];

export const RESOURCE_LANES = [
  'structural', 'energy', 'ordnance', 'precision',
] as const satisfies readonly ResourceLane[];

export const RESOURCE_TIERS = ['raw', 'refined', 'manufactured'] as const satisfies readonly ResourceTier[];

export const WEAPON_CLASSES = [
  'kinetic', 'energy', 'missile', 'mine', 'melee',
] as const satisfies readonly WeaponClass[];

/** All 13 effects, every one of which appears in the generated catalogue. */
export const WEAPON_SPECIAL_EFFECTS = [
  'anti_air', 'anti_missile', 'area_denial',
  'armor_melt', 'armor_piercing', 'can_be_intercepted',
  'emp_disable', 'high_tracking', 'ignores_shields_partial',
  'multi_hit', 'point_defense', 'proximity_trigger',
  'shield_disrupt',
] as const satisfies readonly WeaponSpecialEffect[];

/** Vanguard first: it is the 1.00 reference line every other family is measured against. */
export const WEAPON_FAMILIES = [
  'Vanguard', 'Ashwright', 'Ceridan', 'Draconis', 'Halcyon', 'Kestrel', 'Meridian', 'Obsidian', 'Solari', 'Voss',
] as const satisfies readonly WeaponFamily[];

export const SHIP_CLASSES = [
  'motor_torpedo_boat',
  'submarine_chaser',
  'corvette',
  'torpedo_boat_fleet',
  'destroyer_escort',
  'sloop_patrol_escort',
  'destroyer',
  'landing_ship_tank',
  'submarine',
  'minelayer_sweeper',
  'coastal_defence_ship',
  'anti_aircraft_cruiser',
  'monitor',
  'light_cruiser',
  'attack_transport',
  'light_carrier',
  'panzerschiff',
  'merchant_raider',
  'seaplane_tender',
  'repair_ship_tender',
  'heavy_cruiser',
  'escort_carrier',
  'fleet_oiler',
  'fleet_aircraft_carrier',
  'battlecruiser',
  'battleship',
] as const satisfies readonly ShipClass[];

/** The closed 34-stat vocabulary a module effect may target. */
export const MODULE_EFFECT_STATS = [
  'topSpeed', 'acceleration', 'turnRate',
  'evasionRating', 'fuelRange', 'hull.maxHP',
  'hull.armorRating', 'hull.regenPerTurn', 'shields.maxHP',
  'rechargeRatePerTurn', 'shields.rechargeDelayAfterHit', 'power.maxPower',
  'power.regenPerTurn', 'sensorArray.effectiveness', 'detectionRange',
  'initiative', 'weaponAccuracy', 'criticalChanceBonus',
  'pointDefenseBonus', 'enemyHitChance', 'crew.gunnerySkill',
  'crew.engineeringSkill', 'crew.pilotSkill', 'crewRecoveryRate',
  'repairRatePerTurn', 'cargoCapacity', 'ammoCapacity',
  'mineCapacity', 'minesweepRate', 'troopCapacity',
  'aircraftCapacity', 'droneCapacity', 'medicalCapacity',
  'fuelTransferRate',
] as const satisfies readonly ModuleEffectStat[];

/** Exactly two stats where a NEGATIVE modifier is the benefit. */
export const INVERTED_BENEFIT_STATS = [
  'enemyHitChance', 'shields.rechargeDelayAfterHit',
] as const satisfies readonly ModuleEffectStat[];

// ================================================================
// WEAPONS — size anchors, family bias, mark ladder
// ================================================================

/** Absolute scale for a signature-1.0 archetype at each size. */
export const WEAPON_SIZE_ANCHORS = {
  small: { dmg: 20.0, rng: 450, pwr: 6.0, ammo: 14 },
  medium: { dmg: 44.0, rng: 800, pwr: 13.0, ammo: 11 },
  large: { dmg: 95.0, rng: 1500, pwr: 26.0, ammo: 8 },
  capital: { dmg: 190.0, rng: 2600, pwr: 48.0, ammo: 6 },
} as const satisfies Record<Size, WeaponSizeAnchor>;

/**
 * Manufacturer bias, applied on top of the archetype signature. Multipliers,
 * except `hit` (added to base hit chance) and `cd` (added to cooldown turns).
 *
 * Roughly trade-neutral: every gain is paid for somewhere. Two special cases the
 * numbers alone do not show:
 *   Ceridan's sustain bias (+ammo, -cooldown) is inert on an infinite-ammo,
 *     no-cooldown weapon; there it re-expresses as +1 shot per turn, so a Ceridan
 *     line is never just a worse Vanguard.
 *   Ashwright's effect potency unlocks its second specialEffect at Mk.2, not Mk.3.
 */
export const WEAPON_FAMILY_BIAS = {
  Vanguard: { dmg: 1.00, rof: 1.00, cd: 0, trk: 1.00, hit: +0.00, rng: 1.00, pwr: 1.00, crit: 1.00, var: 1.00, ammo: 1.00 },
  Ashwright: { dmg: 0.97, rof: 1.00, cd: 0, trk: 1.00, hit: +0.00, rng: 1.02, pwr: 1.15, crit: 1.35, var: 1.00, ammo: 1.00 },
  Ceridan: { dmg: 0.92, rof: 1.00, cd: -1, trk: 1.00, hit: +0.00, rng: 0.95, pwr: 1.05, crit: 0.95, var: 1.00, ammo: 1.60 },
  Draconis: { dmg: 1.30, rof: 1.00, cd: 0, trk: 0.85, hit: -0.07, rng: 1.05, pwr: 1.20, crit: 1.10, var: 1.15, ammo: 0.85 },
  Halcyon: { dmg: 0.85, rof: 1.00, cd: 0, trk: 1.30, hit: +0.07, rng: 1.00, pwr: 1.00, crit: 0.95, var: 0.90, ammo: 1.00 },
  Kestrel: { dmg: 0.72, rof: 1.50, cd: 0, trk: 1.05, hit: +0.00, rng: 0.92, pwr: 1.05, crit: 0.90, var: 1.00, ammo: 1.25 },
  Meridian: { dmg: 0.93, rof: 1.00, cd: 0, trk: 1.15, hit: +0.02, rng: 1.00, pwr: 1.00, crit: 0.85, var: 0.45, ammo: 1.00 },
  Obsidian: { dmg: 0.95, rof: 1.00, cd: 0, trk: 0.95, hit: -0.02, rng: 0.98, pwr: 0.98, crit: 1.60, var: 1.70, ammo: 1.00 },
  Solari: { dmg: 0.90, rof: 1.00, cd: 0, trk: 1.00, hit: +0.00, rng: 1.00, pwr: 0.70, crit: 0.95, var: 1.00, ammo: 1.00 },
  Voss: { dmg: 1.05, rof: 0.70, cd: 1, trk: 0.90, hit: +0.00, rng: 1.45, pwr: 1.10, crit: 1.05, var: 1.00, ammo: 0.90 },
} as const satisfies Record<WeaponFamily, WeaponFamilyBias>;

/** The family whose bias unlocks the tier-2 effect one mark early. */
export const EARLY_EFFECT_FAMILY = 'Ashwright' as const satisfies WeaponFamily;

/**
 * Mark ladder growth, as base^(mark - 1). Damage compounding faster than power is
 * the rule that makes a higher mark both stronger AND more efficient — the
 * verifier fails the build if whole-point rounding ever makes a mark step free.
 */
export const WEAPON_MARK_GROWTH = {
  damage: 1.13,
  power: 1.075,
  range: 1.05,
  tracking: 1.06,
  /** Added, not multiplied: 0.015 * (mark - 1). */
  hitBonusPerMark: 0.015,
  /** Added: 0.010 * (mark - 1). */
  critBonusPerMark: 0.010,
} as const;

/** Variance as a fraction of damage, indexed Mk.1..Mk.6 — it tightens with mark. */
export const WEAPON_MARK_VARIANCE = [0.18, 0.165, 0.15, 0.135, 0.11, 0.095] as const;

// ================================================================
// SHIPS — mass bands, directory names, class signature summary
// ================================================================

/** Inclusive mass band, in tons. A hull's mass.value must fall inside its band. */
export const SHIP_MASS_BANDS = {
  motor_torpedo_boat: [30, 115],
  submarine_chaser: [95, 450],
  corvette: [925, 1100],
  torpedo_boat_fleet: [600, 1700],
  destroyer_escort: [1100, 1900],
  sloop_patrol_escort: [1250, 1900],
  destroyer: [1300, 3600],
  landing_ship_tank: [3800, 4100],
  submarine: [500, 5200],
  minelayer_sweeper: [600, 7000],
  coastal_defence_ship: [3600, 8000],
  anti_aircraft_cruiser: [5400, 8000],
  monitor: [7200, 9200],
  light_cruiser: [5000, 14000],
  attack_transport: [8000, 14000],
  light_carrier: [11000, 15000],
  panzerschiff: [12000, 16000],
  merchant_raider: [7000, 17000],
  seaplane_tender: [8000, 17000],
  repair_ship_tender: [8000, 17000],
  heavy_cruiser: [9000, 17000],
  escort_carrier: [7800, 24000],
  fleet_oiler: [16000, 25000],
  fleet_aircraft_carrier: [13000, 45000],
  battlecruiser: [32000, 47000],
  battleship: [26000, 72000],
} as const satisfies Record<ShipClass, MassBand>;

/**
 * Prose directory names under `Ships/`. Two differ from their enum values because
 * `/` cannot appear in a directory name.
 */
export const SHIP_CLASS_FOLDERS = {
  motor_torpedo_boat: "Motor torpedo boat",
  submarine_chaser: "Submarine chaser",
  corvette: "Corvette",
  torpedo_boat_fleet: "Torpedo boat (fleet)",
  destroyer_escort: "Destroyer escort",
  sloop_patrol_escort: "Sloop - patrol escort",
  destroyer: "Destroyer",
  landing_ship_tank: "Landing ship, tank",
  submarine: "Submarine",
  minelayer_sweeper: "Minelayer - sweeper",
  coastal_defence_ship: "Coastal defence ship",
  anti_aircraft_cruiser: "Anti-aircraft cruiser",
  monitor: "Monitor",
  light_cruiser: "Light cruiser",
  attack_transport: "Attack transport",
  light_carrier: "Light carrier",
  panzerschiff: "Panzerschiff",
  merchant_raider: "Merchant raider",
  seaplane_tender: "Seaplane tender",
  repair_ship_tender: "Repair ship & tender",
  heavy_cruiser: "Heavy cruiser",
  escort_carrier: "Escort carrier",
  fleet_oiler: "Fleet oiler",
  fleet_aircraft_carrier: "Fleet aircraft carrier",
  battlecruiser: "Battlecruiser",
  battleship: "Battleship",
} as const satisfies Record<ShipClass, string>;

/** Armour, shield type, largest module size accepted, and shields-as-a-fraction-of-hull. */
export const SHIP_CLASS_DEFENCE = {
  motor_torpedo_boat: { armor: 'light', shield: 'none', moduleSizeCap: 'small', shieldRatio: 0.0 },
  submarine_chaser: { armor: 'light', shield: 'kinetic', moduleSizeCap: 'small', shieldRatio: 0.35 },
  corvette: { armor: 'light', shield: 'kinetic', moduleSizeCap: 'medium', shieldRatio: 0.45 },
  torpedo_boat_fleet: { armor: 'light', shield: 'kinetic', moduleSizeCap: 'medium', shieldRatio: 0.42 },
  destroyer_escort: { armor: 'medium', shield: 'kinetic', moduleSizeCap: 'medium', shieldRatio: 0.5 },
  sloop_patrol_escort: { armor: 'medium', shield: 'kinetic', moduleSizeCap: 'medium', shieldRatio: 0.48 },
  destroyer: { armor: 'medium', shield: 'kinetic', moduleSizeCap: 'medium', shieldRatio: 0.52 },
  landing_ship_tank: { armor: 'light', shield: 'kinetic', moduleSizeCap: 'large', shieldRatio: 0.3 },
  submarine: { armor: 'light', shield: 'none', moduleSizeCap: 'medium', shieldRatio: 0.0 },
  minelayer_sweeper: { armor: 'light', shield: 'kinetic', moduleSizeCap: 'medium', shieldRatio: 0.4 },
  coastal_defence_ship: { armor: 'heavy', shield: 'hybrid', moduleSizeCap: 'large', shieldRatio: 0.62 },
  anti_aircraft_cruiser: { armor: 'medium', shield: 'energy', moduleSizeCap: 'large', shieldRatio: 0.6 },
  monitor: { armor: 'heavy', shield: 'hybrid', moduleSizeCap: 'large', shieldRatio: 0.65 },
  light_cruiser: { armor: 'medium', shield: 'hybrid', moduleSizeCap: 'large', shieldRatio: 0.6 },
  attack_transport: { armor: 'light', shield: 'kinetic', moduleSizeCap: 'large', shieldRatio: 0.35 },
  light_carrier: { armor: 'medium', shield: 'energy', moduleSizeCap: 'capital', shieldRatio: 0.55 },
  panzerschiff: { armor: 'heavy', shield: 'hybrid', moduleSizeCap: 'large', shieldRatio: 0.66 },
  merchant_raider: { armor: 'light', shield: 'kinetic', moduleSizeCap: 'large', shieldRatio: 0.44 },
  seaplane_tender: { armor: 'light', shield: 'kinetic', moduleSizeCap: 'large', shieldRatio: 0.4 },
  repair_ship_tender: { armor: 'light', shield: 'kinetic', moduleSizeCap: 'large', shieldRatio: 0.36 },
  heavy_cruiser: { armor: 'heavy', shield: 'hybrid', moduleSizeCap: 'large', shieldRatio: 0.64 },
  escort_carrier: { armor: 'light', shield: 'energy', moduleSizeCap: 'capital', shieldRatio: 0.46 },
  fleet_oiler: { armor: 'light', shield: 'kinetic', moduleSizeCap: 'large', shieldRatio: 0.32 },
  fleet_aircraft_carrier: { armor: 'medium', shield: 'energy', moduleSizeCap: 'capital', shieldRatio: 0.58 },
  battlecruiser: { armor: 'heavy', shield: 'hybrid', moduleSizeCap: 'capital', shieldRatio: 0.68 },
  battleship: { armor: 'heavy', shield: 'hybrid', moduleSizeCap: 'capital', shieldRatio: 0.72 },
} as const satisfies Record<
  ShipClass,
  { armor: ArmorType; shield: ShieldType; moduleSizeCap: Size; shieldRatio: number }
>;

// ================================================================
// RESOURCES — yields and cost coefficients
// ================================================================

/**
 * Raw -> refined yield is lane-specific (the material determines the loss);
 * refined -> manufactured is uniform (factory efficiency does not depend on the
 * input material). Precision's 0.50 is deliberate: rare isotopes refine poorly,
 * which makes precision electronics the most raw-material-intensive lane.
 */
export const CONVERSION_YIELDS = {
  refine: {
    structural: 0.9,
    energy: 0.8,
    ordnance: 0.75,
    precision: 0.5,
  },
  fabrication: 0.85,
} as const satisfies ConversionYields;

/** Structural scale per weapon size — a value-level copy of the generator's damage anchor. */
export const WEAPON_COST_STRUCT_SIZE_SCALE = {
  small: 20.0,
  medium: 44.0,
  large: 95.0,
  capital: 190.0,
} as const satisfies Record<Size, number>;

/** How much of a class's damage reads as expended ordnance rather than power. */
export const WEAPON_ORDNANCE_SHARE = {
  missile: 0.7,
  mine: 0.75,
  kinetic: 0.35,
  melee: 0.1,
  energy: 0.05,
} as const satisfies Record<WeaponClass, number>;

export const WEAPON_COST_COEFFICIENTS = {
  kStructural: 0.05,
  kEnergy: 0.15,
  kOrdnance: 0.04,
  kPrecision: 0.05,
  kCriticalPrecision: 5.0,
} as const;

export const MODULE_COST_COEFFICIENTS = {
  kStructural: 0.05,
  kEnergy: 0.15,
  kPrecision: 0.15,
  kOrdnance: 0.02,
} as const;

/** Module effect stats that read as precision/electronics work for costing. */
export const MODULE_COST_PRECISION_STATS = [
  'crew.gunnerySkill',
  'crew.pilotSkill',
  'criticalChanceBonus',
  'detectionRange',
  'enemyHitChance',
  'initiative',
  'pointDefenseBonus',
  'sensorArray.effectiveness',
  'weaponAccuracy',
] as const satisfies readonly ModuleEffectStat[];

/** Module effect stats that read as physical ordnance capacity for costing. */
export const MODULE_COST_ORDNANCE_STATS = [
  'ammoCapacity',
  'mineCapacity',
] as const satisfies readonly ModuleEffectStat[];

/** Bare-hull cost only; fitted weapons and modules are summed on top. */
export const SHIP_HULL_COST_COEFFICIENTS = {
  kStructural: 0.02,
  kHullHP: 0.03,
  kEnergy: 0.1,
  kPrecision: 0.05,
} as const;

// ================================================================
// COMBAT — turn order, range bands, signature, evasion, criticals
// ================================================================

export const TURN_PHASES = [
  { phase: 'initiative', order: 1, description: 'Sort by (pilotSkill + sensorArray effectiveness + d20) descending.' },
  { phase: 'signatureDeclaration', order: 2, description: 'Each ship commits an operating state, fixing its signature for the turn.' },
  { phase: 'detection', order: 3, description: 'Per attacker-target pair: effective detection range, then build/hold/reset lock.' },
  { phase: 'powerAllocation', order: 4, description: 'Assign the power budget across weapons / shields / engines.' },
  { phase: 'movement', order: 5, description: 'Resolve positioning; sets the distance everything downstream reads.' },
  { phase: 'targeting', order: 6, description: 'Pick targets, weapons, and optionally a component, within range.maximum and ammo.' },
  { phase: 'missileResolution', order: 7, description: 'Ammo deduction, arming check, PD interception. Runs before any hit roll.' },
  { phase: 'directFireResolution', order: 8, description: 'Non-missile weapons and surviving missiles: hit chance, then damage.' },
  { phase: 'criticalChecks', order: 9, description: 'On every confirmed hit, roll the component-critical table.' },
  { phase: 'endOfTurn', order: 10, description: 'Shield recharge, signature bonuses expire, repair modules, destruction/retreat.' },
] as const satisfies readonly TurnPhaseSpec[];

/** Bands are a percentage of the weapon's OWN range.optimal, so each weapon carries its own geometry. */
export const RANGE_BANDS = [
  { band: 'pointBlank', fromOptimalMultiple: 0, toOptimalMultiple: 0.25, hitMultiplier: 1.10,
    note: 'Close-quarters bonus, but missiles risk not arming in time.' },
  { band: 'close', fromOptimalMultiple: 0.25, toOptimalMultiple: 1.0, hitMultiplier: 1.00 },
  { band: 'medium', fromOptimalMultiple: 1.0, toOptimalMultiple: 1.5, hitMultiplier: { from: 1.00, to: 0.65 } },
  { band: 'long', fromOptimalMultiple: 1.5, toOptimalMultiple: 'maximum', hitMultiplier: { from: 0.65, to: 0.15 } },
  { band: 'extreme', fromOptimalMultiple: 1.5, toOptimalMultiple: null, hitMultiplier: 0,
    note: 'Beyond range.maximum: cannot fire. Close the distance or disengage.' },
] as const satisfies readonly RangeBandSpec[];

export const MISSILE_ARMING_RULE = {
  appliesBelowOptimalFraction: 0.10,
  failureChance: 0.50,
  outcomeOnFailure: 'cleanMiss',
} as const satisfies MissileArmingRule;

/** baseSignature = mass.value * 0.05 + power.maxPower * 0.1 + shields.maxHP * 0.02 */
export const SIGNATURE_DERIVATION = {
  massCoefficient: 0.05,
  maxPowerCoefficient: 0.1,
  shieldMaxHPCoefficient: 0.02,
} as const satisfies SignatureDerivation;

export const SIGNATURE_STATE_MODIFIERS = [
  { state: 'weaponsFiredThisTurn', signatureDelta: 0.08, perVolley: true },
  { state: 'shieldsActive', signatureDelta: 0.10 },
  { state: 'afterburner', signatureDelta: 0.40 },
  { state: 'runningSilent', signatureDelta: -0.50,
    cost: { topSpeedDelta: -0.30, weaponsFireForbidden: true } },
  { state: 'ecmModuleActive', signatureDelta: -0.15 },
] as const satisfies readonly SignatureStateModifier[];

export const LOCK_ON = {
  /** A fresh lock starts here. */
  initialQuality: 0.5,
  /** Gained per turn of continuous tracking. */
  buildPerTurn: 0.25,
  /** Reached after 2 full turns. */
  maxQuality: 1.0,
  /** Breaking range/LoS, or the target running silent, drops it to this. */
  resetQuality: 0,
} as const;

export const BLIND_FIRE = {
  hitChanceMultiplier: 0.25,
  lockQualityTreatedAs: 0.5,
} as const satisfies BlindFireRule;

export const EVASION_CONSTANTS = {
  speedTrackingDivisor: 250,
  maxSpeedEvasionBonus: 0.35,
  maxEffectiveEvasion: 0.60,
} as const satisfies EvasionConstants;

/**
 * Per-class hit profiles. Missiles are the only class with a base-chance bonus
 * and evasion discount, and the only class that must survive interception first;
 * mines never roll to hit at all.
 */
export const WEAPON_HIT_PROFILES = {
  kinetic: {
    baseHitChanceModifier: 1.0, evasionIgnoredFraction: 0, ignoresSpeedEvasion: false,
    rollsToHit: true, interceptable: false,
    notes: 'Straight-line ballistics; the full range/signature/evasion formula applies unadjusted.',
  },
  energy: {
    baseHitChanceModifier: 1.0, evasionIgnoredFraction: 0, ignoresSpeedEvasion: false,
    rollsToHit: true, interceptable: false,
    notes: 'Same hit resolution as kinetic; differentiates on damage-vs-shield-resistance. Beam archetypes (Beam Laser, Particle Lance) set ignoresSpeedEvasion per-weapon: near-instant travel time, but full range falloff.',
  },
  missile: {
    baseHitChanceModifier: 1.25, evasionIgnoredFraction: 0.5, ignoresSpeedEvasion: false,
    rollsToHit: true, interceptable: true,
    notes: 'Core advantage: +25% base hit chance and half the target evasion. Paid for with finite ammo and a mandatory PD interception sub-phase before the hit roll.',
  },
  mine: {
    baseHitChanceModifier: 1.0, evasionIgnoredFraction: 0, ignoresSpeedEvasion: false,
    rollsToHit: false, interceptable: false,
    notes: 'Does not roll to hit. Deployed to an area and triggered on proximity by ANY ship, friend or foe.',
  },
  melee: {
    baseHitChanceModifier: 1.0, evasionIgnoredFraction: 0, ignoresSpeedEvasion: false,
    rollsToHit: true, interceptable: false,
    notes: 'Boarding and hull-breach weapons. Resolved like kinetic, at the very short ranges their archetype signature allows.',
  },
} as const satisfies WeaponHitProfiles;

/** interceptChance = clamp(pd.baseHitChance + pd.tracking / 150 - missileEvasion, 0.05, 0.95) */
export const INTERCEPT_CONSTANTS = {
  trackingDivisor: 150,
  floor: 0.05,
  ceiling: 0.95,
} as const;

export const MISSILE_EVASION = {
  base: 0.20,
  highTrackingDelta: -0.10,
  multiHitDeltaPerMissile: 0.05,
} as const satisfies MissileEvasionConstants;

/** Weapons that contribute pooled interception attempts. */
export const POINT_DEFENCE_EFFECTS = [
  'point_defense', 'anti_missile',
] as const satisfies readonly WeaponSpecialEffect[];

export const HIT_CHANCE_CONSTANTS = {
  floor: 0.05,
  ceiling: 0.95,
  gunnerySkillDivisor: 200,
  componentTargetingPenalty: -0.2,
} as const satisfies HitChanceConstants;

/** Only two of the thirteen special effects have a numeric rule today. */
export const SPECIFIED_SPECIAL_EFFECTS = {
  ignores_shields_partial: '50% of rawDamage bypasses shields straight to hull.',
  armor_piercing: 'hull.armorRating is halved when computing hull damage.',
} as const satisfies Partial<Record<WeaponSpecialEffect, string>>;

export const CRITICAL_TABLE = [
  { min: 1, max: 30, kind: 'minorSystemDamage', description: 'Minor system damage: -10% to a random stat for 2 turns.' },
  { min: 31, max: 60, kind: 'bonusComponentDamage', description: 'Targeted component takes 25% of its maxHP as bonus damage.' },
  { min: 61, max: 85, kind: 'componentDisabled', description: 'Targeted component (or a random one, if none chosen) disabled for 1 turn.' },
  { min: 86, max: 100, kind: 'catastrophic', description: 'Catastrophic: component destroyed, permanent until dock repair.' },
] as const satisfies readonly CriticalBand[];

/**
 * The schema says 15%; both battle logs withdraw in the 30-33% band, and read
 * better for it — a ship limping at 10% hull rarely gets a dramatic withdrawal
 * scene, it just dies next turn. See OPEN_RULINGS R4.
 */
export const RETREAT_POLICY_SCHEMA = {
  hullFractionThreshold: 0.15,
  requiresNoWeaponsOperational: true,
  source: 'schema',
} as const satisfies RetreatPolicy;

export const RETREAT_POLICY_RECOMMENDED = {
  hullFractionThreshold: 0.30,
  requiresNoWeaponsOperational: true,
  source: 'observedInLogs',
} as const satisfies RetreatPolicy;

// ================================================================
// LOGGING — granularity and event significance
// ================================================================

export const GRANULARITY_POLICY = {
  hullCountThresholdPerSide: 9,
  below: 'perShot',
  atOrAbove: 'perGroupPerPhase',
  alwaysNarrateAtOrAbove: 1,
} as const satisfies GranularityPolicy;

export const SIGNIFICANCE_RULES = [
  {
    tier: 1, label: 'headline', narration: 'Always, in full.',
    triggers: [
      'any ship destroyed',
      'any catastrophic (86-100) critical',
      "a commander's retreat or withdrawal order",
      'first contact / first blood / first kill of the battle',
    ],
  },
  {
    tier: 2, label: 'notable', narration: 'In full, within the current focus phase.',
    triggers: [
      'shields collapsing to 0',
      'a component disabled or destroyed critical (61-85)',
      'a swarm/saturation attack overwhelming point-defense',
      'a named flagship taking a significant hit',
    ],
  },
  {
    tier: 3, label: 'routine', narration: 'Summarized, not per-shot.',
    triggers: ['ordinary hits and misses that cross no shield or hull threshold'],
  },
  {
    tier: 4, label: 'omitted', narration: 'Not narrated; still recorded in the Tier 1 log.',
    triggers: [
      'full-miss exchanges with no state change',
      'routine PD intercepts outside a saturation moment',
    ],
  },
] as const satisfies readonly SignificanceRule[];

/** Radio chatter fires only at these points — both source logs use 1-3 per battle. */
export const CHATTER_TRIGGERS = [
  'firstContact', 'firstLockAdvantage', 'pressOrder',
  'focusFireOrder', 'withdrawOrder', 'flagshipEndangered',
] as const;

// ================================================================
// DATASET COUNTS  (as of the current generated state)
// ================================================================

export const CATALOGUE_COUNTS = {
  shipClasses: 26,
  tierHulls: 78,
  namedShips: 20,
  weapons: 798,
  weaponArchetypes: 31,
  weaponFamilies: 10,
  modules: 135,
  moduleArchetypes: 45,
  resources: 12,
} as const;
