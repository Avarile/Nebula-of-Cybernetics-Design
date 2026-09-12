/**
 * common.ts — primitives and cross-cutting vocabularies.
 *
 * Everything here is shared by two or more catalogues, which is the only reason
 * it lives in one file rather than with its own domain. `ModuleSlotType` and
 * `MountType` sit here because both the hull (which declares a slot/mount) and
 * the fitted item (which claims one) need them; keeping them central is what
 * lets ships.ts, weapons.ts and modules.ts stay acyclic.
 *
 * Derived from:
 *   Data-Templates/{ship,weapon,module,resource}.interface
 *   data-template.json  (the upstream schema design)
 *   fleet_and_weapons.json  (every literal union below was extracted from the
 *                            live data, not just from the schema prose)
 */

// ---------------------------------------------------------------- numeric kinds

/** A normalised fraction in [0, 1] — never a percentage. */
export type Fraction01 = number;

/**
 * Percentage points, as used by `ModuleEffect.modifier` when
 * `modifierType === 'percent'`: `12` means +12%, applied as `stat *= 1.12`.
 */
export type PercentPoints = number;

/** Tons. Ship and module masses are both expressed this way. */
export type Tons = number;

/** Abstract distance unit used by range, detection and movement alike. */
export type Distance = number;

/** Inclusive `[min, max]` mass band for a ship class, in tons. */
export type MassBand = readonly [min: Tons, max: Tons];

// ---------------------------------------------------------------- sizing

/**
 * The single size ladder shared by weapons, hardpoints, modules and module
 * slots. A weapon may only be mounted on a hardpoint of the SAME size, and a
 * module only in a slot of the same size — this is an equality rule, not a
 * "fits in anything larger" rule.
 */
export type Size = 'small' | 'medium' | 'large' | 'capital';

/** Ship tier: 1 basic, 2 advanced, 3 premium. Three tiers per ship class. */
export type ShipTier = 1 | 2 | 3;

/**
 * Weapon mark. 1–5 is the designed ladder (~+13% damage per mark, power cost
 * rising more slowly, a second special effect at Mk.3, tighter variance and one
 * less cooldown turn at Mk.5). Mk.6 exists on five legacy weapons only.
 */
export type WeaponMark = 1 | 2 | 3 | 4 | 5 | 6;

/** Module mark, deliberately 1:1 with `ShipTier` — Mk.N is built for a tier-N hull. */
export type ModuleMark = 1 | 2 | 3;

// ---------------------------------------------------------------- damage types

/**
 * Damage type of a weapon, and the key of the target's
 * `shields.damageTypeResistance`. Note this is a narrower axis than
 * `WeaponClass`: mine and melee weapons all deal one of these three.
 */
export type DamageType = 'kinetic' | 'energy' | 'explosive';

// ---------------------------------------------------------------- mounts & slots

/** Hardpoint geometry. Purely descriptive today — no rule keys off it yet. */
export type MountType = 'fixed' | 'turret' | 'missile_bay';

/**
 * Module slot type. `command` and `hangar` are extensions beyond
 * data-template.json, added for CIC/flag facilities and drone/aviation gear.
 */
export type ModuleSlotType =
  | 'engine'
  | 'utility'
  | 'defensive'
  | 'sensor'
  | 'cargo'
  | 'command'
  | 'hangar';

// ---------------------------------------------------------------- value objects

/** Mass is always carried as a value + unit pair, never a bare number. */
export interface Mass {
  value: Tons;
  /** Always `"tons"` across the whole dataset. */
  unit: 'tons';
}

/**
 * A hit-point pool. On a newly built ship every `current*` equals its `max*`
 * counterpart; the verifier enforces that for generated hulls.
 */
export interface HitPoints {
  maxHP: number;
  currentHP: number;
}

// ---------------------------------------------------------------- resources

/**
 * The four material lanes carried through all three resource tiers. These are
 * also exactly the keys of `BuildCost` — a build cost is a quantity of the four
 * MANUFACTURED-tier resources, one per lane.
 */
export type ResourceLane = 'structural' | 'energy' | 'ordnance' | 'precision';

/**
 * Cost to manufacture one unit of a weapon, module or ship, in manufactured-tier
 * resource units:
 *   structural -> Structural Component  (res_mfg_structural_component)
 *   energy     -> Power Core Unit       (res_mfg_power_core)
 *   ordnance   -> Ordnance Charge       (res_mfg_ordnance_charge)
 *   precision  -> Guidance Assembly     (res_mfg_guidance_assembly)
 *
 * A ship's `buildCost` is its bare-hull cost PLUS the `buildCost` of every
 * fitted weapon and module, summed — not a re-derivation from hull stats.
 * Values are rounded to 2 decimal places at generation time.
 */
export interface BuildCost {
  structural: number;
  energy: number;
  ordnance: number;
  precision: number;
}

/** Any per-lane quantity: a build cost, a stockpile, a production run. */
export type LaneQuantity = Record<ResourceLane, number>;

// ---------------------------------------------------------------- identifiers
//
// Ids are plain strings in the JSON; the template-literal types below document
// the format the generators guarantee without getting in the way of
// `JSON.parse(...) as FleetDataset`.

/** `wpn_001` … `wpn_798` — always zero-padded to three digits. */
export type WeaponId = `wpn_${string}`;

/**
 * `mod_<archetype>_mk<n>` for 125 of the 135 modules. Ten legacy ids predate
 * that convention (`mod_ion_drive_std`, `mod_shield_booster_1`, …), so the type
 * stays open rather than asserting a suffix the data does not have.
 */
export type ModuleId = `mod_${string}`;

/** `ship_<shipClass>_t<tier>` for class templates, `ship_<shipClass>_<slug>` for named ships. */
export type ShipId = `ship_${string}`;

/** `res_raw_*`, `res_refined_*`, `res_mfg_*` — the manufactured tier abbreviates to `mfg`. */
export type ResourceId = `res_${string}`;

/** `hp_1`, `hp_2`, … — unique within a hull. */
export type HardpointId = `hp_${number}`;

/** `ms_1`, `ms_2`, … — unique within a hull. */
export type ModuleSlotId = `ms_${number}`;

/**
 * A repo-relative path to a catalogue file, e.g.
 * `Weapons/missile/medium/wpn_776_draconis_torpedo_launcher_mk_2.json`.
 */
export type CataloguePath = string;
