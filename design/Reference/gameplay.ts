/**
 * gameplay.ts — the turn, orders, the player, the fleet, and what moving and
 * fighting cost.
 *
 * Derived from: GamePlay/*.md, tools/gameplay_tables.py, fleet_and_weapons.json
 *               -> "progression", Data-Templates/{turn_order,player}.interface
 *
 * Two clocks, and they are not the same thing. A TURN is one resolution of the
 * whole universe: 24 real hours, fourteen ordered phases, everything advancing
 * exactly once. A ROUND is one exchange inside a battle; a whole engagement
 * resolves inside phase 9 of a single turn. Combat-logic/ calls rounds "turns" —
 * combat.ts keeps that file's vocabulary, this file uses the world's.
 */

import type { ResourceId, ShipId } from './common';
import type { ShipClass } from './ships';
import type { SkillId, SkillLevel } from './skills';

// ---------------------------------------------------------------- the clock

/** Real hours in one world turn. */
export type TurnLengthHours = 24;

/** `TURN_LENGTH_HOURS x SP_PER_HOUR_REFERENCE` — derived, never authored. */
export type SpPerTurn = 43200;

/** Security tiers, from `Systems_Planets/systems_planets_specification.md` §3. */
export type SecurityTier = 'core' | 'mid' | 'rim' | 'deadspace';

// ---------------------------------------------------------------- phases

export type PhaseOrdinal = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export type PhaseName =
  | 'intake' | 'training' | 'extraction' | 'refining' | 'manufacturing'
  | 'construction' | 'movement' | 'detection' | 'combat' | 'salvage'
  | 'market' | 'upkeep' | 'settlement' | 'log';

/**
 * `system` phases take no player order — intake (1), salvage (10) and log (14).
 * Every other phase is driven by at least one order type.
 */
export type PhaseKind = 'player' | 'system';

export interface TurnPhase {
  ordinal: PhaseOrdinal;
  name: PhaseName;
  kind: PhaseKind;
  description: string;
}

// ---------------------------------------------------------------- orders

export type OrderType =
  | 'train.queue' | 'mine.assign' | 'facility.job' | 'fleet.move' | 'fleet.posture'
  | 'fleet.target' | 'cargo.transfer' | 'market.order' | 'facility.lease'
  | 'contract.accept' | 'contract.post' | 'insurance.set' | 'union.action';

/**
 * `silent` costs −50% signature for −30% speed and cold weapons; it is the
 * counter-play that keeps a held gate from being absolute.
 */
export type FleetPosture = 'engage' | 'avoid' | 'interdict' | 'silent';

export interface OrderRejection {
  reason: string;
  phase: PhaseOrdinal;
}

/**
 * One instruction against one turn. Validated twice — at intake against the state
 * at submission, and again at execution against the state the phase finds. A
 * failed execution check drops the order whole and records `rejection`; silent
 * failure is not permitted.
 */
export interface TurnOrder {
  orderId: string;
  turnNumber: number;
  playerId: PlayerId;
  orderType: OrderType;
  phase: PhaseOrdinal;
  /** Monotonic, assigned at intake in receipt order. The primary tie-break. */
  submissionSequence: number;
  /** Repeats until cancelled or invalidated. An absent player keeps producing. */
  standing: boolean;
  payload: Record<string, unknown>;
  rejection: OrderRejection | null;
}

/**
 * The total order contention resolves by. Total, never partial — `playerId` is
 * unique, so no two orders ever tie and replay is deterministic.
 */
export interface ResolutionRank {
  phaseOrdinal: PhaseOrdinal;
  submissionSequence: number;
  playerId: PlayerId;
}

// ---------------------------------------------------------------- the player

export type PlayerId = string;
export type FleetId = string;
export type UnionId = string;
export type LeaseId = string;
/** One of the 60 generated systems. */
export type SystemId = string;
export type PlanetId = string;

export interface TrainedSkill {
  skillId: SkillId;
  level: 0 | SkillLevel;
  spInvested: number;
}

export interface TrainingQueueEntry {
  skillId: SkillId;
  targetLevel: SkillLevel;
}

export interface AggressorFlag {
  type: 'aggressor';
  securityTier: SecurityTier;
  expiresTurn: number;
}

/**
 * One account. Trained levels are stored as levels and never as a derived
 * multiplier, so a change to a skill's effects reaches every player without a
 * migration.
 *
 * The fleet cap is NOT a field. It is `1 + ` the count of `fleet_slot` unlocks
 * reached on `skl_flt_formation_drill`.
 */
export interface Player {
  playerId: PlayerId;
  name: string;
  /** A `core` system — nothing hostile can reach a new player there. */
  homeSystemId: SystemId;
  createdTurn: number;
  sp: { accrued: number; unspent: number };
  trainedSkills: TrainedSkill[];
  /** Ordered. An entry whose prerequisites are unmet is held in place, not dropped. */
  trainingQueue: TrainingQueueEntry[];
  credits: number;
  fleetIds: FleetId[];
  leaseIds: LeaseId[];
  unionId: UnionId | null;
  /** regionName -> standing. No effect in `rim` or `deadspace`. */
  standings: Record<string, number>;
  flags: AggressorFlag[];
}

// ---------------------------------------------------------------- the fleet

export interface FleetHull {
  shipId: ShipId;
  hullHP: number;
  shieldHP: number;
  /** Drawn down by missile and mine weapons only. */
  ammo: number;
  fuel: number;
  cargo: Partial<Record<ResourceId, number>>;
  insured: boolean;
}

export interface Fleet {
  fleetId: FleetId;
  playerId: PlayerId;
  /** Length bounded by Formation Drill's unlocks, never by a constant. */
  hulls: FleetHull[];
  systemId: SystemId;
  posture: FleetPosture;
  /** Non-null while a gate transit is still accumulating range across turns. */
  inTransit: { toSystemId: SystemId; lyRemaining: number } | null;
  route: SystemId[];
}

// ---------------------------------------------------------------- logistics

/**
 * `lyPerTurn = JUMP_RANGE_BASE x (slowestEffectiveTopSpeed / JUMP_SPEED_REFERENCE)`.
 *
 * `slowestEffectiveTopSpeed` already includes Navigation and engine modules, so no
 * formula applies a navigation multiplier a second time.
 */
export interface JumpBudget {
  slowestEffectiveTopSpeed: number;
  lyPerTurn: number;
}

/**
 * `fuelPerLy = mass / FUEL_MASS_DIVISOR`, `fuelRange = capacities.fuel / fuelPerLy`.
 * A module effect on `fuelRange` multiplies the derived ly figure — efficiency,
 * not a bigger tank, since no hull carries a `fuelRange` field.
 */
export interface FuelProfile {
  shipId: ShipId;
  massTons: number;
  fuelCapacity: number;
  fuelPerLy: number;
  fuelRangeLy: number;
}

// ---------------------------------------------------------------- progression

export interface TrainingLevelRow {
  level: SkillLevel;
  sp: number;
  spCumulative: number;
  turns: number;
  turnsCumulative: number;
}

export interface TrainingRow {
  skillId: SkillId;
  name: string;
  domain: string;
  category: string;
  rank: 1 | 2 | 3 | 4 | 5;
  levels: TrainingLevelRow[];
  spTotal: number;
  turnsTotal: number;
}

/**
 * What it costs to field a hull category: both `ship_operation` claimants at level
 * 5, plus every transitive prerequisite. Computed from the live graph, never stored
 * by hand.
 */
export interface HullPath {
  shipClass: ShipClass;
  gateSkills: { skillId: SkillId; level: SkillLevel }[];
  closure: { skillId: SkillId; level: SkillLevel }[];
  closureSkillCount: number;
  sp: number;
  turns: number;
  heaviestHullTons: number;
}

export interface CareerRow {
  careerId: string;
  name: string;
  skillCount: number;
  sp: number;
  turns: number;
}

export interface StartingPackage {
  hulls: ShipId[];
  scienceLevel: SkillLevel;
  freeLeaseType: string;
  freeLeaseTurns: number;
  gateSkillsGranted: string;
}

export interface ProgressionConstants {
  turnLengthHours: TurnLengthHours;
  spPerTurn: SpPerTurn;
  skillCount: number;
  maxLevel: 10;
  spToMaxEverything: number;
  turnsToMaxEverything: number;
  yearsToMaxEverything: number;
  startingPackage: StartingPackage;
}

export interface Progression {
  training: TrainingRow[];
  hullPaths: HullPath[];
  careers: CareerRow[];
  constants: ProgressionConstants;
}

// ---------------------------------------------------------------- conflict

export interface NpcSquadronHull {
  shipId: ShipId;
  name: string;
  shipClass: ShipClass;
  count: number;
  unitReferencePrice: number;
}

/**
 * A composition, not a stat block — every entry names a real hull, fitted exactly
 * as a player's would be. Nothing spawns in `core`.
 */
export interface NpcSquadron {
  squadronId: string;
  name: string;
  securityTier: Exclude<SecurityTier, 'core'>;
  hullCount: number;
  hulls: NpcSquadronHull[];
  referenceValue: number;
  bountyRate: number;
  bounty: number;
  /** The fit only, at `SALVAGE_DROP`. */
  expectedSalvage: number;
}

/**
 * The NPC military answer to aggression. Must outvalue the richest fleet one
 * player can field — fleet-slot copies of the dearest hull in the catalogue.
 */
export interface ResponseFleet {
  securityTier: 'core' | 'mid';
  entersAtRound: number;
  hullCount: number;
  hulls: NpcSquadronHull[];
  referenceValue: number;
}

export interface Wreck {
  wreckId: string;
  shipId: ShipId;
  systemId: SystemId;
  diedTurn: number;
  expiresTurn: number;
  /** Survived the per-item `SALVAGE_DROP` roll. */
  contents: { weaponIds: string[]; moduleIds: string[]; cargo: Partial<Record<ResourceId, number>> };
}
