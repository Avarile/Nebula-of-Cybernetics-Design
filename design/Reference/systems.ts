/**
 * systems.ts — the map layer: 60 star systems joined by jump gates, and the 180
 * planets inside them.
 *
 * Derived from: Data-Templates/system.interface, Data-Templates/planet.interface,
 *               Systems_Planets/*, tools/system_tables.py,
 *               fleet_and_weapons.json -> "systems", "planets"
 *
 * Two 1–3 ladders drive every number, and they point in opposite directions:
 * `richnessTier` rises as security FALLS and scales extraction, `developmentTier`
 * rises as security RISES and scales industry. Neither end of the map is
 * self-sufficient, which is what gives the gate graph a purpose.
 *
 * A planet is the BASE that a station-management skill multiplies — those skills
 * are pure percentages with no base of their own. See `skills.ts`.
 */

import type { ResourceLane } from './resources';

export type SecurityTier = 'core' | 'mid' | 'rim' | 'deadspace';

export type RegionName =
  | 'Aurelian Reach'
  | 'Kestrel Span'
  | 'Cindral Verge'
  | 'Tannhau Drift'
  | 'Obsidian Marches'
  | 'The Pale Hollow';

export type PlanetArchetype =
  | 'ferrous_barren'
  | 'crystalline'
  | 'gas_giant'
  | 'volcanic'
  | 'irradiated'
  | 'ice'
  | 'oceanic'
  | 'shattered'
  | 'hive_world'
  | 'forge_world';

export type SpectralClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M';

/** 1 = poorest/least developed, 3 = richest/most developed. */
export type MapTier = 1 | 2 | 3;

export type SystemId = `sys_${string}`;
export type PlanetId = `pln_${string}`;
export type BeltId = `bel_${string}`;
/** Always `gate_<lowerSystemId>_<higherSystemId>`, whichever end you approach from. */
export type GateId = `gate_${string}`;

export interface Coordinates {
  /** Light years. */
  x: number;
  y: number;
  z: number;
}

export interface Star {
  spectralClass: SpectralClass;
  /** Sol = 1.0. Flavour: no mechanic reads it. */
  luminosity: number;
}

/** The Deep Space Mining domain's target — a system-level feature, not a planet one. */
export interface AsteroidBelt {
  beltId: BeltId;
  name: string;
  dominantLane: ResourceLane;
  richnessTier: MapTier;
  /** Raw units of `dominantLane` per completed mining cycle. */
  yieldPerCycle: number;
  cycleTurns: number;
}

/**
 * One end of a gate. Both endpoints carry the same `gateId`, `gateName` and
 * `jumpDistanceLy` — the edge is stored once in `links.json` and denormalised
 * into each system, with a verifier check proving the copies agree.
 */
export interface SystemConnection {
  toSystemId: SystemId;
  gateId: GateId;
  gateName: string;
  /** Euclidean distance between the two systems' coordinates. */
  jumpDistanceLy: number;
  crossesConstellation: boolean;
  crossesRegion: boolean;
}

export interface System {
  systemId: SystemId;
  name: string;
  region: RegionName;
  constellation: string;
  securityTier: SecurityTier;
  /** Finer ordering inside the tier's band: core 0.80–1.00 … deadspace 0.00–0.10. */
  securityRating: number;
  star: Star;
  coordinates: Coordinates;
  /** Scales planetary extraction. Rises as security falls. */
  richnessTier: MapTier;
  /** Scales industry. Rises as security rises. */
  developmentTier: MapTier;
  planets: PlanetId[];
  asteroidBelts: AsteroidBelt[];
  connections: SystemConnection[];
}

/** Raw units per turn, one entry per resource lane. */
export type ExtractionRates = Record<ResourceLane, number>;

export interface PlanetRefinery {
  /** Raw units consumed per turn. Scales with `developmentTier`. */
  throughputPerTurn: number;
  /**
   * Multiplies the lane's `conversionYield`. Capped at 1.00 and scaled by
   * NEITHER ladder: effective yield is `lane × this × skill`, and the resource
   * model requires it to stay below 1. Worst case 0.90 × 1.00 × 1.10 = 0.99.
   */
  yieldModifier: number;
}

export interface PlanetShipyard {
  berths: number;
  /** Tons. 0 when `berths` is 0. Only a developed forge world clears 65,100 t. */
  maxHullTonnage: number;
  /** Manufactured units absorbed per turn. */
  constructionRatePerTurn: number;
}

export interface Planet {
  planetId: PlanetId;
  name: string;
  systemId: SystemId;
  archetype: PlanetArchetype;
  /** Position from the star, 1-based. */
  orbitIndex: number;
  richnessTier: MapTier;
  developmentTier: MapTier;
  extraction: ExtractionRates;
  refinery: PlanetRefinery;
  manufactory: { throughputPerTurn: number };
  shipyard: PlanetShipyard;
  /** Units — equal to tons, since every resource is `unitMass: 1.0`. */
  warehouse: { capacity: number };
}

// ---------------------------------------------------------------- on-disk shapes

/** One row of `Systems_Planets/links.json` — the canonical edge, stored once. */
export interface Gate {
  gateId: GateId;
  gateName: string;
  /** Always the lexicographically lower systemId. */
  a: SystemId;
  /** Always the higher. */
  b: SystemId;
  jumpDistanceLy: number;
  crossesConstellation: boolean;
  crossesRegion: boolean;
}

export interface LinksFile {
  count: number;
  gates: Gate[];
}

export interface SystemIndexEntry {
  systemId: SystemId;
  name: string;
  region: RegionName;
  constellation: string;
  securityTier: SecurityTier;
  securityRating: number;
  planets: number;
  belts: number;
  connections: number;
  dir: string;
  path: string;
}

export interface PlanetIndexEntry {
  planetId: PlanetId;
  name: string;
  systemId: SystemId;
  archetype: PlanetArchetype;
  richnessTier: MapTier;
  developmentTier: MapTier;
  maxHullTonnage: number;
  path: string;
}

export interface SystemIndex {
  systemCount: number;
  planetCount: number;
  systems: SystemIndexEntry[];
  planets: PlanetIndexEntry[];
}

/** `Systems_Planets/<Region>/<System>/system.json`. */
export type SystemPath = `Systems_Planets/${string}/${string}/system.json`;
/** `Systems_Planets/<Region>/<System>/planets/<planetId>_<slug>.json`. */
export type PlanetPath = `Systems_Planets/${string}/${string}/planets/${string}.json`;
