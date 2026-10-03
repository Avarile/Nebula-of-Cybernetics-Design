/**
 * stations.ts — orbital stations: the generated type rows and the runtime station.
 *
 * Derived from: GamePlay/station_specification.md, tools/gameplay_tables.py
 *               (STATION_*), fleet_and_weapons.json -> "stationTypes",
 *               Data-Templates/station.interface
 *
 * A station is PROPERTY, NOT TERRITORY: a structure a player or union owns, anchored in
 * one planet's orbit. The planet keeps no owner field and its slots are untouched. A
 * station hosts its owner's own slots — refinery, manufactory, shipyard, warehouse, never
 * extraction — as `orbital` leases (`facilities.ts` `Lease.stationId`), and pays upkeep
 * for them in place of rent. It is built as a kit at a berth, hauled, and anchored by a
 * `station.deploy` order; it can be raided in `rim` like any warehouse, and never destroyed.
 */

import type { ResourceLane } from './common';
import type { DevelopmentTier, FacilityKind, FacilitySlot } from './facilities';
import type { FleetId, HullInstanceId, LeaseId, PlayerId, UnionId } from './gameplay';
import type { PlanetId, SecurityTier } from './systems';

// ---------------------------------------------------------------- vocabulary

/** The four authored station types (`gameplay_tables.STATION_TYPES`). */
export type StationTypeId =
  | 'stn_orbital_depot' | 'stn_orbital_refinery' | 'stn_orbital_foundry' | 'stn_orbital_yard';

export type StationId = string;

/** A station hosts every slot kind a planet does, except extraction. */
export type StationSlotKind = Exclude<FacilityKind, 'extraction'>;

/**
 * `orbital` today. `deep_space` is reserved for the deferred deep-space stations and joins
 * this union without any other schema change; such a station carries a `systemId` and a
 * null `planetId`.
 */
export type StationSiteType = 'orbital';

/** Where a kit may be anchored (`STATION_TIERS`) — never `deadspace`. */
export type StationTier = Exclude<SecurityTier, 'deadspace'>;

// ---------------------------------------------------------------- the generated row

/**
 * One generated row per station type x development tier of the planet orbited. Slots
 * reuse the facility slot shapes: sized by the planet slot constants (a berth by
 * `STATION_BERTH_RATE` / `STATION_BERTH_TONNAGE`) x the development multiplier.
 * `rentPerTurn` on each slot is what it would pay as a lease there; it is not charged.
 */
export interface StationTypeRow {
  stationTypeId: StationTypeId;
  name: string;
  developmentTier: DevelopmentTier;
  securityTiers: StationTier[];
  slots: Partial<Record<StationSlotKind, FacilitySlot>>;
  /** `STATION_UPKEEP_RATE x SUM(slotCount x rentPerTurn)`, charged in phase 12. A drain. */
  upkeepPerTurn: number;
  /** Frame plus one `STATION_SLOT_COST` share per hosted slot, in manufactured units. */
  buildCost: Record<ResourceLane, number>;
  /** `buildCost` summed: the kit's tons in a hold and units in a warehouse. */
  kitUnits: number;
  /** Economy §2's formula. Kits trade player-to-player only — not on NPC order books. */
  referencePrice: number;
}

// ---------------------------------------------------------------- runtime

export type StationStatus = 'online' | 'offline';

/**
 * One anchored station. Runtime state — created by `station.deploy`, never generated.
 * Offline while upkeep is unpaid; scrapped after `STATION_GRACE_TURNS` offline turns, its
 * remaining warehouse contents with it.
 */
export interface Station {
  stationId: StationId;
  stationTypeId: StationTypeId;
  ownerId: PlayerId | UnionId;
  siteType: StationSiteType;
  planetId: PlanetId;
  startedTurn: number;
  status: StationStatus;
  offlineSinceTurn: number | null;
  upkeepPaidThroughTurn: number;
  /** One `orbital` lease per hosted slot. */
  leaseIds: LeaseId[];
}

/** Where a kit is taken from: a hull's hold in the planet's system, or a warehouse on that planet. */
export type StationKitSource = { fleetId: FleetId; hullId: HullInstanceId } | { leaseId: LeaseId };

/**
 * `station.deploy` (phase 12, not standing). A deploy needs the submitter to be the owner
 * or in the owning union and to hold the shipyard-lease gate (Science 7, Ship Construction
 * Management >= 1); the planet in a `STATION_TIERS` system with its orbit free after
 * earlier-ranked deployments; and the kit in `kitSource`. A decommission needs an empty
 * station warehouse and no hull docked, and refunds nothing.
 */
export type StationDeployPayload =
  | {
      action: 'deploy';
      stationTypeId: StationTypeId;
      planetId: PlanetId;
      ownerId: PlayerId | UnionId;
      kitSource: StationKitSource;
    }
  | { action: 'decommission'; stationId: StationId };
