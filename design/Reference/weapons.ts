/**
 * weapons.ts — the 798-entry weapon catalogue.
 *
 * Derived from: Data-Templates/weapon.interface, Weapons/*, tools/generate_weapons.py,
 *               fleet_and_weapons.json -> "weapons"
 *
 * Shape of the domain — every stat is a pure product of four axes:
 *
 *     stat = size anchor  x  archetype signature  x  mark ladder  x  family bias
 *
 *   archetype (31)  the tactical role: sets the SHAPE of the stat block and fixes
 *                   `specialEffects`. A PD autocannon is fast, weak, high-tracking;
 *                   a particle lance is slow, huge and can barely track.
 *   size (4)        the absolute band, and which hardpoints can take it.
 *   mark (1-5)      a strict power ladder — higher marks are stronger AND more
 *                   power-efficient, so cross-mark domination is intended.
 *   family (10)     manufacturer bias, trade-neutral. Vanguard is the 1.00 reference.
 *
 * None of those four axes is serialised on the entity: a weapon carries only its
 * resulting numbers, plus a name (`"Voss Heavy Railgun Mk.3"`) from which the axes
 * can be read back. `WeaponIdentity` below models them for generator/tooling code.
 */

import type {
  BuildCost,
  CataloguePath,
  DamageType,
  Distance,
  Fraction01,
  HardpointId,
  MountType,
  Size,
  WeaponId,
  WeaponMark,
} from './common';

// ---------------------------------------------------------------- vocabularies

/**
 * Tactical class. Drives hit-resolution profile (see combat.ts `WeaponHitProfile`)
 * and ordnance cost share, and partitions the Weapons/ directory tree.
 * Counts: kinetic 232, energy 255, missile 157, mine 94, melee 60.
 */
export type WeaponClass = 'kinetic' | 'energy' | 'missile' | 'mine' | 'melee';

/**
 * The full special-effect vocabulary — 13 values, all of which appear in the data.
 * A weapon carries 0-4 of them; the set is fixed by its archetype, with the second
 * one unlocking at Mk.3 (Mk.2 for Ashwright) and a third at Mk.5.
 *
 * Only two have a numeric rule today (`ignores_shields_partial`, `armor_piercing`).
 * The other eleven are used narratively in the battle logs but unspecified in the
 * schema — see combat.ts `SpecialEffectRule` and `OPEN_RULINGS`.
 */
export type WeaponSpecialEffect =
  | 'anti_air'
  | 'anti_missile'
  | 'area_denial'
  | 'armor_melt'
  | 'armor_piercing'
  | 'can_be_intercepted'
  | 'emp_disable'
  | 'high_tracking'
  | 'ignores_shields_partial'
  | 'multi_hit'
  | 'point_defense'
  | 'proximity_trigger'
  | 'shield_disrupt';

/** The 10 manufacturers. Not serialised — recoverable from `Weapon['name']`. */
export type WeaponFamily =
  | 'Vanguard'
  | 'Ashwright'
  | 'Ceridan'
  | 'Draconis'
  | 'Halcyon'
  | 'Kestrel'
  | 'Meridian'
  | 'Obsidian'
  | 'Solari'
  | 'Voss';

/** The 31 archetypes. Not serialised — recoverable from `Weapon['name']`. */
export type WeaponArchetype =
  // kinetic (9)
  | 'Autocannon'
  | 'AA Autocannon'
  | 'Chain Gun'
  | 'PD Autocannon'
  | 'Flak Cannon'
  | 'Coilgun'
  | 'Gauss Cannon'
  | 'Mass Driver'
  | 'Railgun'
  // energy (9)
  | 'Pulse Laser'
  | 'PD Laser Turret'
  | 'Beam Laser'
  | 'Disruptor Beam'
  | 'Ion Cannon'
  | 'Plasma Cannon'
  | 'Proton Blaster'
  | 'Particle Lance'
  | 'Arc Projector'
  // missile (6)
  | 'Seeker Missile'
  | 'Missile Rack'
  | 'Swarm Missile Pod'
  | 'Torpedo Launcher'
  | 'Cruise Missile Bay'
  | 'Interceptor Missile'
  // mine (4)
  | 'Mine Layer'
  | 'Proximity Mine Dispenser'
  | 'Depth Charge Rack'
  | 'Siege Mine Cluster'
  // melee (3)
  | 'Boarding Ram'
  | 'Grapple Harpoon'
  | 'Siege Drill';

// ---------------------------------------------------------------- stat blocks

export interface WeaponDamage {
  base: number;
  /** +/- spread rolled per shot: `rawDamage = base + random(-variance, +variance)`. */
  variance: number;
  /** Matched against the target's `shields.damageTypeResistance`. */
  damageType: DamageType;
}

export interface WeaponRange {
  /** Full hit multiplier out to here; the band table is expressed as a % of this. */
  optimal: Distance;
  /** Beyond this the weapon cannot fire at all — hit chance is 0, not merely low. */
  maximum: Distance;
  /**
   * Per-unit accuracy loss past `optimal`, from the v1 formula. The v2 range-band
   * table (combat.ts `RangeBandSpec`) supersedes it for hit resolution; the field
   * is retained because it is part of the published schema.
   */
  falloffPenalty: Fraction01;
}

export interface WeaponAccuracy {
  baseHitChance: Fraction01;
  /**
   * Ability to hit fast/small targets. Subtracted from the target's speed in the
   * speed-evasion formula, so a low-tracking capital gun loses most of its
   * accuracy against a fast escort. Also feeds point-defense intercept chance.
   */
  tracking: number;
}

export interface WeaponFireRate {
  /** Shots resolved per turn; also the number of intercept attempts a PD weapon contributes. */
  shotsPerTurn: number;
  /** Turns of silence after a volley. 0 means the weapon fires every turn. */
  cooldownTurns: number;
}

/**
 * Magazine depth. `'infinite'` for energy weapons and most kinetics (547 of 798);
 * a finite count for missiles, mines and ammunition-fed guns (251 of 798).
 * Finite ammo decrements on launch, hit or miss, and cannot be refilled outside dock.
 */
export type AmmoCapacity = number | 'infinite';

// ---------------------------------------------------------------- the entity

export interface Weapon {
  weaponId: WeaponId;
  /** `<Family> <SizeWord> <Archetype> Mk.<n>`, e.g. "Voss Heavy Railgun Mk.3". Unique. */
  name: string;
  weaponClass: WeaponClass;
  /** Must equal the size of the hardpoint it is mounted on. */
  size: Size;
  damage: WeaponDamage;
  range: WeaponRange;
  accuracy: WeaponAccuracy;
  fireRate: WeaponFireRate;
  /** Drawn from the ship's power pool per shot — a full volley costs this x shotsPerTurn. */
  powerCost: number;
  ammo: AmmoCapacity;
  /** Chance a confirmed hit rolls on the component-critical table. */
  criticalChance: Fraction01;
  specialEffects: WeaponSpecialEffect[];
  buildCost: BuildCost;
}

/**
 * A weapon as it appears inside a hull's `Weapons/` directory: the full catalogue
 * entry, with the mount it occupies prepended and a pointer back to the canonical
 * copy. Stripping the three added fields must leave a byte-identical catalogue
 * entry — tools/verify_ships.py enforces that.
 *
 * Files are keyed by mount, so the same launcher on two hardpoints produces two
 * files (`hp_1_...`, `hp_2_...`).
 */
export interface FittedWeapon extends Weapon {
  hardpointId: HardpointId;
  mountType: MountType;
  catalogue: CataloguePath;
}

// ---------------------------------------------------------------- generator model
//
// The four axes behind every stat block. Nothing below is serialised on a weapon;
// these types exist for tooling that reproduces or reasons about the catalogue.

/** The four axes that uniquely determine a weapon. Recoverable from its name. */
export interface WeaponIdentity {
  archetype: WeaponArchetype;
  size: Size;
  family: WeaponFamily;
  mark: WeaponMark;
}

/** Absolute scale for a signature-1.0 archetype at a given size. */
export interface WeaponSizeAnchor {
  dmg: number;
  rng: Distance;
  pwr: number;
  ammo: number;
}

/**
 * Manufacturer bias, applied on top of the archetype signature. Multipliers
 * except `hit` (added to base hit chance) and `cd` (added to cooldown turns).
 * 1.00 / +0 means the family leaves that stat at the Vanguard reference value.
 */
export interface WeaponFamilyBias {
  dmg: number;
  rof: number;
  cd: number;
  trk: number;
  hit: number;
  rng: number;
  pwr: number;
  crit: number;
  var: number;
  ammo: number;
}

/**
 * The archetype signature. `dmg`/`rng`/`pwr`/`ammo` are multipliers on the size
 * anchor; `trk`/`hit`/`crit` are absolute values at Mk.1.
 */
export interface WeaponArchetypeSignature {
  name: WeaponArchetype;
  cls: WeaponClass;
  /** The hardpoint sizes this archetype is built in. */
  sizes: readonly Size[];
  /** Which manufacturers build this line. */
  fams: readonly WeaponFamily[];
  dmg: number;
  rof: number;
  cd: number;
  trk: number;
  hit: Fraction01;
  rng: number;
  /** `range.maximum / range.optimal`. */
  span: number;
  fall: Fraction01;
  pwr: number;
  crit: Fraction01;
  /** Multiplier on the anchor's ammo, or null for an infinite-ammo archetype. */
  ammo: number | null;
  /** Effects present from Mk.1. */
  eff1: readonly WeaponSpecialEffect[];
  /** Unlocked at Mk.3 — or Mk.2 for Ashwright, whose bias is effect potency. */
  eff3: readonly WeaponSpecialEffect[];
  /** Unlocked at Mk.5. */
  eff5: readonly WeaponSpecialEffect[];
}

/**
 * The mark ladder, as growth factors applied to a Mk.1 value.
 * `damage` compounding faster than `power` is what makes a higher mark both
 * stronger and more efficient, which is the rule the verifier enforces.
 */
export interface MarkLadder {
  /** ~1.13^(mark-1). */
  damage: number;
  /** ~1.075^(mark-1) — deliberately below `damage`. */
  power: number;
  range: number;
  tracking: number;
  /** Added to base hit chance: 0.015 * (mark-1). */
  hitBonus: Fraction01;
  /** Added to critical chance: 0.010 * (mark-1). */
  critBonus: Fraction01;
  /** Variance as a fraction of damage — shrinks with mark. */
  varianceFactor: Fraction01;
}

// ---------------------------------------------------------------- index file

/** One row of Weapons/index.json — a summary, not the full entry. */
export interface WeaponIndexEntry {
  weaponId: WeaponId;
  name: string;
  weaponClass: WeaponClass;
  size: Size;
  /** `damage.base`, flattened. */
  damage: number;
  shotsPerTurn: number;
  cooldownTurns: number;
  powerCost: number;
  /** `Weapons/<weaponClass>/<size>/<weaponId>_<name_slug>.json`. */
  path: CataloguePath;
}

export interface WeaponIndex {
  count: number;
  weapons: WeaponIndexEntry[];
}
