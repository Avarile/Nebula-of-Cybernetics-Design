/**
 * facilities.ts — leasable industrial capacity and the leases on it.
 *
 * Derived from: GamePlay/industry_specification.md, tools/gameplay_tables.py,
 *               fleet_and_weapons.json -> "facilityTypes",
 *               Data-Templates/facility.interface
 *
 * Planets are terrain. `Systems_Planets/systems_planets_specification.md` §10 gives
 * them no owner field, and nothing here adds one. Players lease indivisible SLOTS
 * and pay rent per turn; what they compete over is capacity, and the competition is
 * economic rather than military.
 *
 * The authored half (`FacilityType`) is generated — 10 archetypes x 3 development
 * tiers. The runtime half (`Lease`) is created by play and never generated.
 */

import type { ResourceLane } from './common';
import type { SkillId } from './skills';
import type { StationId } from './stations';
import type { CargoGoodId, LeaseId, PhaseOrdinal, PlayerId, UnionId } from './gameplay';
import type { PlanetArchetype, PlanetId, SecurityTier } from './systems';

// ---------------------------------------------------------------- vocabulary

// `PlanetArchetype` is the map's (`systems.ts`), imported above: GamePlay keeps no second copy.

export type FacilityKind =
  | 'extraction' | 'refinery' | 'manufactory' | 'shipyard' | 'warehouse';

/** Rises as security falls. Scales extraction, and nothing else. */
export type RichnessTier = 1 | 2 | 3;

/** Rises as security rises. Scales per-slot throughput, never slot count. */
export type DevelopmentTier = 1 | 2 | 3;

export type LadderScale = 'richnessTier' | 'developmentTier';

/**
 * `planet` and `orbital`. An `orbital` lease is a slot hosted by an orbital station
 * (`stations.ts`); it pays no rent, and the station no upkeep — the kit is the whole price. Deep-space stations are deferred
 * by the brief and will add `deep_space` without any other schema change.
 */
export type SiteType = 'planet' | 'orbital';

// ---------------------------------------------------------------- slots

interface SlotBase {
  facilityType: FacilityKind;
  /** How many independent leases this archetype supports. */
  slotCount: number;
  scalesWith: LadderScale;
  unit: string;
  rentPerTurn: number;
}

export interface ExtractionSlot extends SlotBase {
  facilityType: 'extraction';
  lane: ResourceLane;
  /** Raw units/turn at `richnessTier` 1. One slot per lane per planet. */
  throughputPerTurn: number;
  scalesWith: 'richnessTier';
}

export interface RefinerySlot extends SlotBase {
  facilityType: 'refinery';
  /** Raw units/turn consumed, at this development tier. */
  throughputPerTurn: number;
  /**
   * Fixed per archetype and scaled by NEITHER ladder. Holding it off both is what
   * keeps `conversionYield x yieldModifier x refineryYield < 1` provable — the
   * margin is 0.01 on the structural lane. A lease scales throughput, never yield.
   */
  yieldModifier: number;
  scalesWith: 'developmentTier';
}

export interface ManufactorySlot extends SlotBase {
  facilityType: 'manufactory';
  throughputPerTurn: number;
  scalesWith: 'developmentTier';
}

export interface ShipyardSlot extends SlotBase {
  facilityType: 'shipyard';
  /** Manufactured units/turn. `slotCount` is the archetype's berth count. */
  throughputPerTurn: number;
  maxHullTonnage: number;
  scalesWith: 'developmentTier';
}

export interface WarehouseSlot extends SlotBase {
  facilityType: 'warehouse';
  /** Units, which are tons — every resource is `unitMass: 1.0`. */
  capacity: number;
  scalesWith: 'developmentTier';
}

export type FacilitySlot =
  | ExtractionSlot | RefinerySlot | ManufactorySlot | ShipyardSlot | WarehouseSlot;

/** `extraction.<lane>` for extraction slots, the facility kind otherwise. */
export type SlotKey = `extraction.${ResourceLane}` | Exclude<FacilityKind, 'extraction'>;

/**
 * One generated row. `slotCount x slotThroughput` reproduces the capacity published
 * in `systems_planets_specification.md` §4 exactly — the subdivision preserves the
 * map spec's totals rather than reinterpreting them.
 */
export interface FacilityType {
  archetype: PlanetArchetype;
  developmentTier: DevelopmentTier;
  securityTiers: SecurityTier[];
  slots: Partial<Record<SlotKey, FacilitySlot>>;
}

// ---------------------------------------------------------------- the chain

export type ChainStage = 'extract' | 'refine' | 'manufacture' | 'construct' | 'store';

/**
 * Each stage reads the warehouse as it stood at the start of phase 3, so the chain
 * runs one stage per turn — three turns from ore to manufactured goods before
 * construction starts. Without that latency warehouses would be decorative.
 */
export interface ChainStep {
  stage: ChainStage;
  phase: PhaseOrdinal | null;
  facilityType: FacilityKind;
  input: 'raw' | 'refined' | 'manufactured' | null;
  output: 'raw' | 'refined' | 'manufactured' | 'hull' | null;
  skill: SkillId;
  /** Read from `skl_sta_science`'s unlocks, never restated as a constant. */
  scienceLevel: 3 | 5 | 7;
  /** The one `station_management` stat this stage multiplies. */
  stat: string;
}

// ---------------------------------------------------------------- leases

export interface FacilityJob {
  operation: 'extract' | 'refine' | 'manufacture' | 'construct';
  /** For `construct`: the hull, weapon, module or station kit to build. A berth with a refit in
   *  progress advances the refit and pauses this job (fitting_specification.md 4.1). */
  input: string | null;
  quantity: number;
}

/**
 * One player's claim on one slot on one planet. Runtime state — created by play,
 * never generated. Unpaid rent ends the lease at the end of phase 12, returning the
 * slot to the pool and leaving warehoused material in place, still owned.
 */
export interface Lease {
  leaseId: LeaseId;
  /** Unions hold ordinary leases; four berths on one forge world is a union. */
  playerId: PlayerId | UnionId;
  siteType: SiteType;
  /** For an `orbital` lease, the planet its station orbits. */
  planetId: PlanetId;
  /** [+] The station hosting an `orbital` lease; null for a planet slot. */
  stationId: StationId | null;
  facilityType: FacilityKind;
  /** Extraction leases only. */
  lane: ResourceLane | null;
  slotIndex: number;
  startedTurn: number;
  /**
   * Unpaid rent ends a planet lease at the end of phase 12. An `orbital` lease owes none:
   * set to the turn its station was anchored and never advanced (`station_specification.md` §4).
   */
  rentPaidThroughTurn: number;
  /** The new-player grant — 20 turns. */
  freeUntilTurn: number | null;
  /**
   * A standing order; it keeps running while inputs and rent hold out. [+] Named `job`, not
   * `currentJob`: `current*` is kept for `CombatantState`'s in-battle mirrors of catalogue maxima.
   */
  job: FacilityJob | null;
}

/**
 * [+] Contents of a warehouse lease, planet or orbital. A full warehouse HALTS production;
 * it never destroys material. Losing a day's output to an unwatched warehouse is penalty
 * enough when a day is a turn. Units are tons: a resource one a unit, a part or kit its
 * `buildCost` units (`fitting_specification.md` §3).
 */
export interface WarehouseContents {
  leaseId: LeaseId;
  /** `slot capacity x warehouseCapacity` of the leaseholder. */
  capacity: number;
  stored: Partial<Record<CargoGoodId, number>>;
  /**
   * Parts held for a refit in progress (fitting §4.2): counted in `stored`, not removable by
   * the owner. A raid takes them like the rest, and the refit is then held (fitting §4.4).
   */
  reserved: Partial<Record<CargoGoodId, number>>;
  /** The last turn it was raided; `RAID_COOLDOWN` turns bar the next (conflict §7). Null if never. */
  lastRaidedTurn: number | null;
}

// ---------------------------------------------------------------- belts

/**
 * Belts are a system-level feature and are NOT leased — anyone may mine any belt.
 * Output goes straight into a hull's cargo hold: no warehouse, no rent, and already
 * aboard something that can move it.
 */
export interface BeltMiningRate {
  beltId: string;
  dominantLane: ResourceLane;
  richnessTier: RichnessTier;
  yieldPerCycle: number;
  cycleTurns: number;
  /** `(yieldPerCycle / cycleTurns) x miningYield x miningCycleSpeed`, per hull. */
  perHullPerTurn: number;
}
