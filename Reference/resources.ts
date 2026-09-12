/**
 * resources.ts — the 12-entry resource catalogue and the bill-of-materials chain.
 *
 * Derived from: Data-Templates/resource.interface, Resources/*, tools/resource_costs.py,
 *               Resources/resource_tiers_specification.md
 *
 * Shape of the domain: 4 lanes x 3 tiers = 12 resources. Each lane is an
 * unbroken raw -> refined -> manufactured chain, and every step loses material
 * (`conversionYield < 1`). That loss is the whole point: it is what makes
 * "manufactured" the expensive end of the chain rather than a rename of "raw".
 */

import type { Fraction01, ResourceId, ResourceLane, Tons, LaneQuantity, BuildCost } from './common';

export type { ResourceLane } from './common';

// ---------------------------------------------------------------- tiers

export type ResourceTier = 'raw' | 'refined' | 'manufactured';

// ---------------------------------------------------------------- concrete ids
//
// All 12 ids are fixed by tools/resource_costs.py, so they are typed exactly.

export type RawResourceId =
  | 'res_raw_ferrite'
  | 'res_raw_conductive'
  | 'res_raw_volatile'
  | 'res_raw_isotopes';

export type RefinedResourceId =
  | 'res_refined_structural_alloy'
  | 'res_refined_energy_matrix'
  | 'res_refined_warhead_compound'
  | 'res_refined_precision_circuitry';

export type ManufacturedResourceId =
  | 'res_mfg_structural_component'
  | 'res_mfg_power_core'
  | 'res_mfg_ordnance_charge'
  | 'res_mfg_guidance_assembly';

export type KnownResourceId = RawResourceId | RefinedResourceId | ManufacturedResourceId;

// ---------------------------------------------------------------- the entity

interface ResourceBase {
  resourceId: ResourceId;
  name: string;
  lane: ResourceLane;
  /**
   * Tons per unit. Ties into `Ship['capacities'].cargo`, which is also in tons.
   * Currently a uniform 1.0 placeholder across all 12 resources — see
   * Resources/resource_tiers_specification.md section 7 for calibration notes.
   */
  unitMass: Tons;
  description: string;
}

/** Mined or harvested feedstock. Bottom of a lane: nothing refines into it. */
export interface RawResource extends ResourceBase {
  tier: 'raw';
  refinesFrom: null;
  refinesInto: RefinedResourceId;
  /** Null because there is no input step to take a yield on. */
  conversionYield: null;
}

/** Processed material, ready for fabrication. */
export interface RefinedResource extends ResourceBase {
  tier: 'refined';
  refinesFrom: RawResourceId;
  refinesInto: ManufacturedResourceId;
  /**
   * Lane-specific: 0.90 structural, 0.80 energy, 0.75 ordnance, 0.50 precision.
   * The low precision yield is deliberate — rare isotopes refine poorly, which
   * makes precision electronics the most raw-material-intensive lane per
   * finished unit.
   */
  conversionYield: Fraction01;
}

/** The finished part a `BuildCost` is priced in. Top of a lane. */
export interface ManufacturedResource extends ResourceBase {
  tier: 'manufactured';
  refinesFrom: RefinedResourceId;
  refinesInto: null;
  /** Uniform 0.85 across all lanes — factory efficiency does not depend on the input material. */
  conversionYield: Fraction01;
}

/**
 * Discriminated on `tier`, so narrowing a resource also settles which of
 * `refinesFrom` / `refinesInto` / `conversionYield` can be null.
 */
export type Resource = RawResource | RefinedResource | ManufacturedResource;

/** One lane's complete raw -> refined -> manufactured chain. */
export interface ResourceChain {
  lane: ResourceLane;
  raw: RawResource;
  refined: RefinedResource;
  manufactured: ManufacturedResource;
}

// ---------------------------------------------------------------- yields

export interface ConversionYields {
  /** raw -> refined, per lane. Varies: the material itself determines the loss. */
  refine: Record<ResourceLane, Fraction01>;
  /** refined -> manufactured. One number for every lane. */
  fabrication: Fraction01;
}

/**
 * Expanding a cost DOWN the chain: how much refined / raw material a
 * manufactured-unit cost actually consumes.
 *
 *   refined[lane] = manufactured[lane] / fabrication
 *   raw[lane]     = refined[lane]      / refine[lane]
 *
 * Both are inflations, never reductions, because every yield is < 1.
 */
export interface BillOfMaterials {
  manufactured: BuildCost;
  refined: LaneQuantity;
  raw: LaneQuantity;
}

export type ExpandToRefined = (manufactured: BuildCost, yields: ConversionYields) => LaneQuantity;
export type ExpandToRaw = (manufactured: BuildCost, yields: ConversionYields) => LaneQuantity;

// ---------------------------------------------------------------- cost model
//
// The coefficients that turn an item's own stats into a buildCost. Mirrors
// tools/resource_costs.py; see Resources/resource_tiers_specification.md section 3.

/**
 * Weapon cost:
 *   structural = STRUCT_SIZE_SCALE[size] * kStructural
 *   energy     = powerCost               * kEnergy
 *   ordnance   = damage.base * ordnanceShare[weaponClass] * kOrdnance
 *   precision  = accuracy.tracking * kPrecision + criticalChance * kCriticalPrecision
 */
export interface WeaponCostModel {
  /** Structural scale per size — a copy of the generator's damage anchor table. */
  structSizeScale: Record<import('./common').Size, number>;
  kStructural: number;
  kEnergy: number;
  kOrdnance: number;
  kPrecision: number;
  kCriticalPrecision: number;
  /** How much of a class's damage reads as expended ordnance rather than power. */
  ordnanceShare: Record<import('./weapons').WeaponClass, number>;
}

/**
 * Module cost:
 *   structural = mass.value * k
 *   energy     = powerCost  * k
 *   precision  = sum(|modifier|) over effects whose stat is a precision stat, * k
 *   ordnance   = sum(|modifier|) over effects whose stat is an ordnance stat, * k
 *
 * A module has no damage field, so its ordnance cost comes from the magazine-like
 * capacity stats instead.
 */
export interface ModuleCostModel {
  kStructural: number;
  kEnergy: number;
  kPrecision: number;
  kOrdnance: number;
  precisionStats: readonly import('./modules').ModuleEffectStat[];
  ordnanceStats: readonly import('./modules').ModuleEffectStat[];
}

/**
 * Bare-hull cost only. A ship's published `buildCost` is this plus the
 * `buildCost` of everything fitted to it.
 *
 *   structural = mass.value * kStructural + hull.maxHP * kHullHP
 *   energy     = power.maxPower * kEnergy
 *   ordnance   = 0  (an empty hull carries no ordnance)
 *   precision  = (bridge.maxHP + sensorArray.maxHP) * kPrecision
 */
export interface ShipHullCostModel {
  kStructural: number;
  kHullHP: number;
  kEnergy: number;
  kPrecision: number;
}

export interface CostModel {
  weapon: WeaponCostModel;
  module: ModuleCostModel;
  shipHull: ShipHullCostModel;
  yields: ConversionYields;
}

// ---------------------------------------------------------------- index file

/** One row of Resources/index.json. */
export interface ResourceIndexEntry {
  resourceId: ResourceId;
  name: string;
  tier: ResourceTier;
  lane: ResourceLane;
  /** `Resources/<tier>/<resourceId>.json`; the manufactured directory is `manufactured`. */
  path: string;
}

export interface ResourceIndex {
  count: number;
  resources: ResourceIndexEntry[];
}
