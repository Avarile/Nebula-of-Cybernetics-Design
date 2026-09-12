/**
 * modules.ts — the 135-entry module catalogue (45 archetypes x Mk.1-3).
 *
 * Derived from: Data-Templates/module.interface, Modules/*, tools/generate_modules.py,
 *               fleet_and_weapons.json -> "modules"
 *
 * Shape of the domain:
 *
 *     value = archetype base  x  mark ladder        (Mk.1-3, matching ship tiers 1-3)
 *
 * Benefits scale x1.20 per mark while DRAWBACKS SHRINK x0.90, so a higher mark is
 * never a worse trade — Belt Armour's speed penalty goes -5% -> -4.1% from Mk.1 to
 * Mk.3. Mk.3 adds a second effect where the archetype has one. Power and crew rise
 * more slowly than benefits.
 *
 * `functionClass` is the load-bearing classification:
 *   major (51)     a core system the ship is built around — propulsion, power
 *                  generation, command, primary sensors. Any hull may fit one.
 *   support (48)   force multipliers — repair, ECM, shield boosters, armour.
 *                  Any hull may fit one.
 *   specific (36)  mission equipment only certain hulls carry, gated by
 *                  `hullAffinity`: minesweep gear, mine rails, seaplane catapult,
 *                  cargo derrick, landing craft davits, refuelling rig, hospital bay.
 */

import type {
  BuildCost,
  CataloguePath,
  Mass,
  ModuleId,
  ModuleMark,
  ModuleSlotId,
  ModuleSlotType,
  PercentPoints,
  Size,
} from './common';
import type { ShipClass } from './ships';

export type { ModuleSlotType } from './common';

// ---------------------------------------------------------------- vocabularies

export type ModuleFunctionClass = 'major' | 'support' | 'specific';

/**
 * `moduleType` as it appears in the data — 37 distinct values across the 45
 * archetypes (a few archetypes share a type, e.g. all three drives are `engine`).
 *
 * Note: module.interface still describes this field as "enum: 33 values"; the
 * generated data has 37. The list below is the data, which is authoritative.
 */
export type ModuleType =
  | 'aircraftElevator'
  | 'armorPlating'
  | 'aswBay'
  | 'cargoDerrick'
  | 'cargoExpander'
  | 'catapult'
  | 'cic'
  | 'damageControl'
  | 'datalink'
  | 'davits'
  | 'decoy'
  | 'droneBay'
  | 'droneController'
  | 'ecCounterElectronics'
  | 'ecm'
  | 'engine'
  | 'fireControl'
  | 'fireSuppression'
  | 'flagBridge'
  | 'hospitalBay'
  | 'machineShop'
  | 'magazine'
  | 'mineRails'
  | 'minesweep'
  | 'pdCoordinator'
  | 'powerCore'
  | 'radar'
  | 'rangefinder'
  | 'refuelRig'
  | 'repairDrone'
  | 'repairShop'
  | 'shieldBooster'
  | 'smokeGenerator'
  | 'sonar'
  | 'targetingComputer'
  | 'torpedoBulge'
  | 'troopBerthing';

/** The 45 module lines, each built at Mk.1 / Mk.2 / Mk.3. Not serialised on the entity. */
export type ModuleArchetype =
  // engine
  | 'Ion Drive' | 'Cruise Drive' | 'Sprint Drive' | 'Manoeuvring Thrusters'
  // utility
  | 'Fusion Generator' | 'Auxiliary Power Core' | 'Capacitor Bank'
  | 'Repair Drone Bay' | 'Damage Control Party' | 'Fire Suppression' | 'Machine Shop'
  | 'Smoke Generator' | 'Minesweep Gear' | 'Repair Shop' | 'Hospital Bay'
  // command
  | 'CIC Tower' | 'Flag Bridge' | 'Fire Control Director' | 'Targeting Computer'
  | 'Datalink Relay'
  // sensor
  | 'Search Radar' | 'Surface Radar' | 'Sonar Array' | 'Optical Rangefinder'
  | 'ECM Suite' | 'Counter-ECM Array' | 'Decoy Launcher'
  // defensive
  | 'Shield Booster' | 'Shield Capacitor' | 'Armour Plating' | 'Belt Armour'
  | 'Torpedo Bulge' | 'PD Coordinator'
  // hangar
  | 'Drone Controller' | 'Drone Bay' | 'Seaplane Catapult' | 'Aircraft Elevator'
  | 'ASW Aircraft Bay'
  // cargo
  | 'Bulk Hold' | 'Ammunition Magazine' | 'Cargo Derrick' | 'Mine Rails'
  | 'Refuelling Rig' | 'Landing Craft Davits' | 'Troop Berthing';

/**
 * The closed stat vocabulary a module effect may target — 34 stats. A module
 * effect naming anything outside this list is a verifier failure, not a
 * runtime surprise.
 *
 * Dotted names are paths into the ship object (`hull.maxHP`, `crew.gunnerySkill`).
 * Undotted names are either flat ship fields (`topSpeed`, `detectionRange`) or
 * derived combat stats with no hull field of their own (`weaponAccuracy`,
 * `enemyHitChance`, `pointDefenseBonus`, `criticalChanceBonus`, `repairRatePerTurn`,
 * `crewRecoveryRate`, `minesweepRate`, `fuelTransferRate`, `sensorArray.effectiveness`).
 *
 * NEGATIVE IS THE BENEFIT for exactly two stats: `enemyHitChance` and
 * `shields.rechargeDelayAfterHit`. A negative modifier on any other stat is a
 * drawback, and drawbacks shrink as the mark rises.
 *
 * `crew.pilotSkill` is in the vocabulary but no current archetype uses it.
 */
export type ModuleEffectStat =
  // mobility
  | 'topSpeed'
  | 'acceleration'
  | 'turnRate'
  | 'evasionRating'
  | 'fuelRange'
  // survivability
  | 'hull.maxHP'
  | 'hull.armorRating'
  | 'hull.regenPerTurn'
  | 'shields.maxHP'
  | 'rechargeRatePerTurn'
  | 'shields.rechargeDelayAfterHit'
  // power
  | 'power.maxPower'
  | 'power.regenPerTurn'
  // detection
  | 'sensorArray.effectiveness'
  | 'detectionRange'
  | 'initiative'
  // gunnery
  | 'weaponAccuracy'
  | 'criticalChanceBonus'
  | 'pointDefenseBonus'
  | 'enemyHitChance'
  // crew
  | 'crew.gunnerySkill'
  | 'crew.engineeringSkill'
  | 'crew.pilotSkill'
  | 'crewRecoveryRate'
  | 'repairRatePerTurn'
  // capacities
  | 'cargoCapacity'
  | 'ammoCapacity'
  | 'mineCapacity'
  | 'minesweepRate'
  | 'troopCapacity'
  | 'aircraftCapacity'
  | 'droneCapacity'
  | 'medicalCapacity'
  | 'fuelTransferRate';

/**
 * `flat`    -> stat += modifier
 * `percent` -> stat *= (1 + modifier / 100)   (modifier 10 means +10%)
 */
export type ModifierType = 'flat' | 'percent';

export interface ModuleEffect {
  stat: ModuleEffectStat;
  /** Flat units or percentage points, per `modifierType`. */
  modifier: number | PercentPoints;
  modifierType: ModifierType;
}

// ---------------------------------------------------------------- the entity

interface ModuleBase {
  moduleId: ModuleId;
  name: string;
  moduleType: ModuleType;
  /** Carried on the module so a fit can be checked against the hull's slot. */
  slotType: ModuleSlotType;
  /** Must equal the slot's size. */
  size: Size;
  /** Mk.N is built for a tier-N hull. */
  mark: ModuleMark;
  /** Counts against the hull's mass budget. */
  mass: Mass;
  /** Replaces data-template.json's single `effect`: a CIC tower changes three stats at once. */
  effects: ModuleEffect[];
  /** Passive draw per turn — unlike a weapon, this is paid whether or not anything fires. */
  powerCost: number;
  /** Drawn from the hull's complement; `sum(crewRequired) <= crew.maxCrew` is enforced. */
  crewRequired: number;
  buildCost: BuildCost;
}

/** A core system. Any hull may fit one, so `hullAffinity` is empty. */
export interface MajorModule extends ModuleBase {
  functionClass: 'major';
  hullAffinity: [];
}

/** A force multiplier. Any hull may fit one, so `hullAffinity` is empty. */
export interface SupportModule extends ModuleBase {
  functionClass: 'support';
  hullAffinity: [];
}

/**
 * Mission equipment. `hullAffinity` is non-empty by construction — the tuple type
 * encodes the verifier rule "functionClass 'specific' has a non-empty hullAffinity".
 */
export interface SpecificModule extends ModuleBase {
  functionClass: 'specific';
  hullAffinity: [ShipClass, ...ShipClass[]];
}

/** Discriminated on `functionClass`, which also settles `hullAffinity`'s cardinality. */
export type Module = MajorModule | SupportModule | SpecificModule;

/**
 * A module as it appears inside a hull's `Modules/` directory: the full catalogue
 * entry with the slot it occupies prepended and a pointer back to the canonical
 * copy. Stripping `slotId` and `catalogue` must leave a byte-identical catalogue entry.
 */
export type FittedModule = Module & {
  slotId: ModuleSlotId;
  catalogue: CataloguePath;
};

// ---------------------------------------------------------------- generator model

/** One of the 45 archetype rows the generator expands into three marks. */
export interface ModuleArchetypeSignature {
  name: ModuleArchetype;
  slotType: ModuleSlotType;
  functionClass: ModuleFunctionClass;
  moduleType: ModuleType;
  size: Size;
  /** Mk.1 values; power and crew rise more slowly than benefits. */
  powerCost: number;
  crewRequired: number;
  mass: number;
  /** Effects present from Mk.1. */
  effects: readonly ModuleEffect[];
  /** The extra effect Mk.3 adds, if the archetype has one. */
  mk3Effect?: ModuleEffect;
  /** Non-empty only for `specific`. */
  hullAffinity: readonly ShipClass[];
}

/** The mark ladder, as multipliers on a Mk.1 value. */
export interface ModuleMarkLadder {
  /** x1.20 per mark. */
  benefit: number;
  /** x0.90 per mark — a drawback shrinks, so a higher mark is never a worse trade. */
  drawback: number;
  power: number;
  crew: number;
  mass: number;
}

// ---------------------------------------------------------------- index file

/** One row of Modules/index.json — a summary, not the full entry. */
export interface ModuleIndexEntry {
  moduleId: ModuleId;
  name: string;
  moduleType: ModuleType;
  functionClass: ModuleFunctionClass;
  slotType: ModuleSlotType;
  size: Size;
  mark: ModuleMark;
  powerCost: number;
  crewRequired: number;
  /** `Modules/<slotType>/<functionClass>/<moduleId>.json`. */
  path: CataloguePath;
}

export interface ModuleIndex {
  count: number;
  modules: ModuleIndexEntry[];
}
