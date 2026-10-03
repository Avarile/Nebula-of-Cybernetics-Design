/**
 * gameplay.ts — the turn, orders and their payloads, the player, the fleet, what moving
 * and fighting cost, and what a fight leaves: engagements, wrecks, the turn log.
 *
 * Derived from: GamePlay/*.md, tools/gameplay_tables.py, fleet_and_weapons.json
 *               -> "progression", Data-Templates/{turn_order,player,fleet,wreck,
 *               engagement,turn_log}.interface. Every runtime type here is held field for
 *               field to its .interface by Reference/verify_reference.py.
 *
 * Two clocks, and they are not the same thing. A TURN is one resolution of the
 * whole universe: 24 real hours, fourteen ordered phases, everything advancing
 * exactly once. A ROUND is one exchange inside a battle; a whole engagement
 * resolves inside phase 9 of a single turn. Combat-logic/ calls rounds "turns" —
 * combat.ts keeps that file's vocabulary, this file uses the world's.
 */

import type { HardpointId, ModuleId, ModuleSlotId, ResourceId, ResourceLane, ShipId, WeaponId } from './common';
import type { ComponentName, ShipClass } from './ships';
import type { SkillId, SkillLevel } from './skills';
import type { AuthorityFactionId, HostileFactionId, NpcSquadronId, Standings } from './lore';
import type { StationDeployPayload, StationId, StationTypeId } from './stations';
import type { BeltId, PlanetId, SecurityTier, SystemId } from './systems';
import type { CombatantRef, CraftKind } from './combat';
import type { ContractArchetypeId, ContractParameters, GoodId, MarketLocation, MarketSide } from './economy';
import type { FacilityJob, FacilityKind } from './facilities';

/**
 * [+] What a hold, a warehouse or a wreck carries: resources, station kits (station spec
 * §3.1), and parts — weapons and modules (fitting spec §3). A kit or a part is one item and
 * takes its `buildCost` units in tons; a resource takes one ton a unit (logistics §3).
 */
export type CargoGoodId = ResourceId | StationTypeId | WeaponId | ModuleId;

// ---------------------------------------------------------------- the clock

/** Real hours in one world turn. */
export type TurnLengthHours = 24;

/** `TURN_LENGTH_HOURS x SP_PER_HOUR_REFERENCE` — derived, never authored. */
export type SpPerTurn = 43200;

// `SecurityTier`, `SystemId` and `PlanetId` are the map's (`systems.ts`), imported above.

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
  | 'train.queue' | 'mine.assign' | 'facility.job' | 'ship.refit' | 'fleet.move'
  | 'fleet.convoy' | 'fleet.posture' | 'fleet.target' | 'fleet.raid' | 'cargo.transfer'
  | 'market.order' | 'facility.lease' | 'station.deploy' | 'fleet.restock' | 'contract.accept'
  | 'contract.post' | 'insurance.set' | 'union.action';

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
export interface TurnOrder<T extends OrderType = OrderType> {
  orderId: string;
  turnNumber: number;
  playerId: PlayerId;
  orderType: T;
  phase: PhaseOrdinal;
  /** Monotonic, assigned at intake in receipt order. The primary tie-break. */
  submissionSequence: number;
  /** Repeats until cancelled or invalidated. An absent player keeps producing. */
  standing: boolean;
  /** [+] Typed per order type (`OrderPayloads`); `turn_order.interface` pins each shape. */
  payload: OrderPayloads[T];
  rejection: OrderRejection | null;
}

/**
 * [+] Every order type's payload. `Reference/verify_reference.py` holds its keys to
 * `tools/gameplay_tables.py` `ORDER_TYPES` and each shape to `turn_order.interface`.
 */
export interface OrderPayloads {
  'train.queue': TrainQueuePayload;
  'mine.assign': MineAssignPayload;
  'facility.job': FacilityJobPayload;
  'ship.refit': RefitOrderPayload;
  'fleet.move': FleetMovePayload;
  'fleet.convoy': ConvoyOrderPayload;
  'fleet.posture': FleetPosturePayload;
  'fleet.target': FleetTargetPayload;
  'fleet.raid': FleetRaidPayload;
  'cargo.transfer': CargoTransferPayload;
  'market.order': MarketOrderPayload;
  'facility.lease': FacilityLeasePayload;
  'station.deploy': StationDeployPayload;
  'fleet.restock': FleetRestockPayload;
  'contract.accept': ContractAcceptPayload;
  'contract.post': ContractPostPayload;
  'insurance.set': InsuranceSetPayload;
  'union.action': UnionActionPayload;
}

/** `train.queue` (phase 2, standing). The whole queue, replacing the last one. */
export interface TrainQueuePayload {
  entries: TrainingQueueEntry[];
}

/** `mine.assign` (phase 3, standing). `beltId: null` stops mining. */
export interface MineAssignPayload {
  fleetId: FleetId;
  beltId: BeltId | null;
}

/** `facility.job` (phases 3-6, standing). The lease's job; the lease's kind fixes the phase. */
export interface FacilityJobPayload {
  leaseId: LeaseId;
  operation: FacilityJob['operation'];
  input: string | null;
  quantity: number;
}

/** `fleet.move` (phase 7, standing until arrival). */
export interface FleetMovePayload {
  fleetId: FleetId;
  route: SystemId[];
}

/** `fleet.posture` (phase 8, standing). */
export interface FleetPosturePayload {
  fleetId: FleetId;
  posture: FleetPosture;
}

/**
 * [+] `fleet.raid` (phase 9, not standing): take the contents of another player's warehouse
 * lease in this `rim` or `deadspace` system, once any engagement there is won (conflict §7).
 */
export interface FleetRaidPayload {
  fleetId: FleetId;
  warehouseLeaseId: LeaseId;
}

/** One end of a `cargo.transfer`: a hull's hold, or a warehouse lease at the same location. */
export type CargoPlace = { fleetId: FleetId; hullId: HullInstanceId } | { leaseId: LeaseId };

/** `cargo.transfer` (phases 7 and 12, not standing). No remote transfer (logistics §3). */
export interface CargoTransferPayload {
  from: CargoPlace;
  to: CargoPlace;
  goodId: CargoGoodId;
  quantity: number;
}

/** What `fleet.restock` tops up: magazines, fuel tanks, hangars. */
export type RestockItem = 'ammo' | 'fuel' | 'craft';

/**
 * Where it comes from: a warehouse lease at the same location, the fleet's own holds, or the
 * system's NPC sell orders (`core` and `mid` only).
 */
export type RestockSource = { leaseId: LeaseId } | 'holds' | 'npc';

/**
 * [+] `fleet.restock` (phase 12, standing). Refills every hull of the fleet: ammunition at
 * `ROUNDS_PER_ORDNANCE_CHARGE` a charge, fuel at `FUEL_PER_POWER_CORE` a core (logistics §2,
 * §6), craft at `CRAFT_PROFILES[kind].restockCost` manufactured units each (combat §2.6).
 */
export interface FleetRestockPayload {
  fleetId: FleetId;
  items: RestockItem[];
  source: RestockSource;
}

/** `market.order` (phase 11). Post a standing order, or cancel one. */
export type MarketOrderPayload =
  | {
      action: 'post';
      systemId: SystemId;
      goodId: GoodId;
      side: MarketSide;
      quantity: number;
      limitPrice: number;
      expiresTurn: number | null;
      location: MarketLocation;
    }
  | { action: 'cancel'; orderId: string };

/** `facility.lease` (phase 12). Claim a free planet slot, or release a lease. */
export type FacilityLeasePayload =
  | {
      action: 'claim';
      holderId: PlayerId | UnionId;
      planetId: PlanetId;
      facilityType: FacilityKind;
      lane: ResourceLane | null;
    }
  | { action: 'release'; leaseId: LeaseId };

/** `contract.accept` (phase 13). A haul names the fleet whose holds take the cargo; an escort, the escorting fleet. */
export interface ContractAcceptPayload {
  instanceId: string;
  fleetId: FleetId | null;
}

/** `contract.post` (phase 13). The reward is held from the poster at posting. */
export interface ContractPostPayload {
  contractId: ContractArchetypeId;
  posterId: PlayerId | UnionId;
  parameters: ContractParameters;
  reward: number;
  expiresTurn: number;
}

/** `insurance.set` (phase 12, standing). Cover is on or off per hull; there is one level. */
export interface InsuranceSetPayload {
  fleetId: FleetId;
  hullId: HullInstanceId;
  insured: boolean;
}

export type UnionActionKind =
  | 'found' | 'invite' | 'join' | 'leave' | 'expel' | 'deposit' | 'withdraw' | 'grant' | 'revoke';

/**
 * [+] `union.action` (phase 13). `found` needs `name`; `invite`, `expel`, `grant` and `revoke`
 * a `playerId`; `deposit` and `withdraw` `credits`; `grant` and `revoke` a union warehouse
 * `leaseId`. Only the founder may invite, expel, grant, revoke or withdraw credits
 * (`economy_specification.md` §9).
 */
export interface UnionActionPayload {
  action: UnionActionKind;
  unionId: UnionId | null;
  name: string | null;
  playerId: PlayerId | null;
  credits: number | null;
  leaseId: LeaseId | null;
}

/**
 * `fleet.convoy` (phase 7, before movement). `followerFleetId` is the submitting player's
 * one fleet; `leaderFleetId` another player's, or `null` to unlink. The link forms only when
 * both fleets share a system, neither is in transit, the leader is not itself a follower, and
 * the leader's owner is a union-mate or the counterparty of an accepted `ctr_escort` naming
 * both fleets. A player has one fleet, so a link is always between two players.
 */
export interface ConvoyOrderPayload {
  followerFleetId: FleetId;
  leaderFleetId: FleetId | null;
}

/**
 * `ship.refit` (phase 6, not standing). Changes one hull's fit at a yard
 * (`GamePlay/fitting_specification.md` §4). Validated at intake and again in phase 6:
 * the hull is the player's, either with the fleet and the fleet in the site's system and not
 * in transit, or already docked on the site's planet; the hull fits the site's `maxHullTonnage`, the target fit passes `tools/fitting.py`
 * `fit_is_valid`, the parts are in `partsLeaseId` (or, at an NPC yard, the credits cover
 * the asks and the fee), and the hull's cargo and ammunition fit the new capacities.
 * `fit: null` cancels the refit in progress. From the phase it passes, the hull is
 * DOCKED (`Fleet.docked`) and the fleet is free to sail without it.
 */
export interface RefitOrderPayload {
  fleetId: FleetId;
  hullId: HullInstanceId;
  site: RefitSite;
  /** A warehouse lease on the site's planet. Required at a berth; optional at an NPC yard. */
  partsLeaseId: LeaseId | null;
  fit: HullFit | null;
}

/**
 * `fleet.target` (phase 9), per hull of the ordering player's fleet. `withdraw` sets
 * the hull's intent to withdraw from round 1 — how a convoy runs its haulers while its
 * warships fight. `cover` assigns a pool weapon to a friendly hull (cover,
 * combat spec §2.5).
 */
export interface FleetTargetPayload {
  fleetId: FleetId;
  hulls: {
    hullIndex: number;
    targets?: ShipId[];
    withdraw?: true;
    cover?: { hardpointId: HardpointId; coveredHullId: HullInstanceId }[];
  }[];
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
 * reached on `skl_flt_formation_drill`, and it bounds every hull the player owns:
 * `fleet.hulls` plus `fleet.docked`.
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
  /** [+] The player's ONE fleet, kept for the account's life even when it holds no hull. */
  fleetId: FleetId;
  leaseIds: LeaseId[];
  /** [+] Stations the player owns; a union's are on the union. */
  stationIds: StationId[];
  unionId: UnionId | null;
  /** Authority factionId -> standing (`lore.ts`). No effect in `rim` or `deadspace`. */
  standings: Standings;
  flags: AggressorFlag[];
}

// ---------------------------------------------------------------- the fleet

/** [+] One hull a player holds. `shipId` names its catalogue entry; this names the hull. */
export type HullInstanceId = string;

/**
 * [+] What is bolted to one hull: every hardpoint and slot of its catalogue entry, `null`
 * where empty. A catalogue hull's `weaponEquipped`/`moduleEquipped` are its DEFAULT fit,
 * the one it is built and sold with; a held hull carries its own. Legal exactly when
 * `tools/fitting.py` `fit_is_valid` passes (`GamePlay/fitting_specification.md` §2).
 * A hardpoint's mount follows the weapon (`MOUNT_FOR_WEAPON_CLASS`), so it is not stored.
 */
export interface HullFit {
  weapons: Record<HardpointId, WeaponId | null>;
  modules: Record<ModuleSlotId, ModuleId | null>;
}

/**
 * [+] Where a refit happens. A berth the player or union leases (any `siteType`, so an
 * orbital station's berth is a refit site with no new rule), or an NPC yard: a planet with
 * berths in a `core` or `mid` system.
 */
export type RefitSite = { leaseId: LeaseId } | { npcYardPlanetId: PlanetId };

/**
 * [+] A refit in progress, only ever on a hull in `Fleet.docked`: the hull is out of play at
 * the yard while its fleet sails on, and `targetFit` replaces its fit in phase 6 of the turn
 * `progress` reaches `labour`. Labour is
 * `REFIT_LABOUR_SHARE x` the buildCost units of every item installed or removed.
 */
export interface RefitJob {
  site: RefitSite;
  targetFit: HullFit;
  partsLeaseId: LeaseId | null;
  /** Manufactured units of construction the refit needs. */
  labour: number;
  /** Accrued at the site's rate each phase 6. */
  progress: number;
  startedTurn: number;
}

/**
 * One hull a player holds: what it carries from one battle to the next. A battle starts its
 * `CombatantState` from these values and writes them back at the end of phase 9.
 */
export interface FleetHull {
  /** [+] Unique per hull, so insurance, a refit and a wreck can name one hull. */
  hullId: HullInstanceId;
  shipId: ShipId;
  /** As the last battle left it; a tender's `repairRatePerTurn` restores it (logistics §4). */
  hullHP: number;
  /** Full again at the start of every engagement: a turn is thousands of rounds of recharge (logistics §4). */
  shieldHP: number;
  /** [+] Per component. A catastrophic critical leaves 0: destroyed until dock repair (combat §3.6). */
  componentHP: Record<ComponentName, number>;
  /** [+] Crew aboard. Casualties the fleet's `medicalCapacity` does not return are lost (combat §3.6). */
  crew: number;
  /** Drawn down by missile and mine weapons only. */
  ammo: number;
  fuel: number;
  cargo: Partial<Record<CargoGoodId, number>>;
  /** The whole insurance policy: cover on or off. Premium and payout derive from the bare hull. */
  insured: boolean;
  /** [+] The hull's own fit. Starts as its catalogue default fit. The wreck drops this one. */
  fit: HullFit;
  /** [+] Non-null only while the hull is docked for a refit (`Fleet.docked`). */
  refit: RefitJob | null;
  /**
   * [+] Craft aboard, per kind (combat §2.6): inventory like the magazine, never above
   * `floor(effective(capacityStat))`. Losses carry over until `fleet.restock`. Every craft
   * aboard starts an engagement stowed, so no readying queue outlives a battle.
   */
  craftAboard: Partial<Record<CraftKind, number>>;
}

/**
 * [+] A hull apart from the fleet, docked at a yard: under refit, or built and awaiting
 * pickup (`logistics_specification.md` §1.2). Out of play — it cannot move, fight, trade,
 * transfer cargo, restock or mine, and cannot be detected, engaged or raided. It rejoins the
 * fleet automatically at the end of phase 6 of any turn the fleet is in its system and not in
 * transit, once no refit is in progress on it.
 */
export interface DockedHull {
  hull: FleetHull;
  /** The yard's planet — a berth lease's or an NPC yard's; its system is the planet's. */
  planetId: PlanetId;
}

/**
 * A player's ONE fleet (`Player.fleetId`). It never splits or merges; a fleet with no hull
 * is wherever its next hull is — in phase 6 it takes the system of its first docked hull free
 * to rejoin (lowest `hullId`), which joins it.
 */
export interface Fleet {
  fleetId: FleetId;
  playerId: PlayerId;
  /**
   * The hulls with the fleet. With `docked`, every hull the player owns; the two together
   * are bounded by Formation Drill's unlocks, never by a constant.
   */
  hulls: FleetHull[];
  /** [+] The player's hulls docked at yards, apart from the fleet. */
  docked: DockedHull[];
  systemId: SystemId;
  posture: FleetPosture;
  /** Non-null while a gate transit is still accumulating range across turns. */
  inTransit: { toSystemId: SystemId; lyRemaining: number } | null;
  route: SystemId[];
  /**
   * [+] Non-null while this fleet follows a convoy leader (`logistics_specification.md`
   * §8). A follower takes the leader's route, pace and posture, and is caught and fights
   * with it. `escortContractId` names the `ctr_escort` that is the link's consent, if any.
   */
  convoy: { leaderFleetId: FleetId; escortContractId: string | null } | null;
}

// ---------------------------------------------------------------- logistics

/**
 * `lyPerTurn = JUMP_RANGE_BASE x (slowestEffectiveTopSpeed / JUMP_SPEED_REFERENCE)`.
 *
 * `slowestEffectiveTopSpeed` already includes Navigation and engine modules, so no
 * formula applies a navigation multiplier a second time.
 */
export interface JumpBudget {
  /** For a convoy, the slowest hull of every member fleet. */
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
  squadronId: NpcSquadronId;
  name: string;
  /** [+] The hostile faction that flies it (`lore_tables.SQUADRON_FACTION`). */
  factionId: HostileFactionId;
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
 * No fixed owner: it is the authority of the region an engagement is in, recorded on
 * the engagement (`EngagementSide.responseFleet.authorityId`).
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
  /** The hull that died; `contents` were rolled on ITS fit, not the catalogue's. Null for an NPC hull. */
  hullId: HullInstanceId | null;
  shipId: ShipId;
  /** [+] Who lost it: salvage is theirs when their side holds the field (conflict §5.1). Null for NPC. */
  ownerId: PlayerId | null;
  /** [+] The engagement it died in. */
  engagementId: string;
  systemId: SystemId;
  diedTurn: number;
  expiresTurn: number;
  /** [+] The dead hull's convoy when it died, its owner's own fleet aside; none may ever loot it (conflict §5.1). */
  lootBarredFleetIds: FleetId[];
  /**
   * Survived the per-item `SALVAGE_DROP` roll: each fitted part, and each kit or part in the
   * hold, whole; `SALVAGE_CARGO` of each resource. Craft aboard are never salvage.
   */
  contents: { weaponIds: WeaponId[]; moduleIds: ModuleId[]; cargo: Partial<Record<CargoGoodId, number>> };
}

// ---------------------------------------------------------------- engagements

/** Which phase-8 rule formed it (`conflict_specification.md` §4). */
export type EngagementCause = 'interdiction' | 'mutualPresence' | 'npcSquadron';

/**
 * [+] One side. Every convoy member and every union-mate's fleet caught together fight on one
 * side: a fleet operation needs no order (conflict §4.1).
 */
export interface EngagementSide {
  sideId: string;
  fleetIds: FleetId[];
  playerIds: PlayerId[];
  /** NPC squadron instances on this side. */
  npcSquadrons: { instanceId: string; squadronId: NpcSquadronId; factionId: HostileFactionId }[];
  /** The response fleet, when one joins: the authority of the system's region (conflict §2). */
  responseFleet: { authorityId: AuthorityFactionId; securityTier: 'core' | 'mid'; entersAtRound: number } | null;
}

/** [+] Who a battle's `CombatantRef` is: the catalogue hull, and the held hull for a player's. */
export interface EngagementCombatant {
  ref: CombatantRef;
  sideId: string;
  shipId: ShipId;
  hullId: HullInstanceId | null;
  fleetId: FleetId | null;
}

/**
 * [+] One engagement, formed in phase 8 and fought in phase 9. The battle itself is the
 * `BattleLog` (`combat.ts`) named by `battleId`; this record says who fought, why, and what
 * it left: the aggressors flagged and the wrecks. Runtime state, never generated.
 */
export interface Engagement {
  engagementId: string;
  turnNumber: number;
  systemId: SystemId;
  securityTier: SecurityTier;
  cause: EngagementCause;
  sides: EngagementSide[];
  combatants: EngagementCombatant[];
  /**
   * Owners whose `engage` or `interdict` posture formed it against a player fleet that held
   * neither: flagged for `AGGRESSOR_FLAG_TURNS` in `mid`, and the region's authority's
   * standing with them falls (conflict §4, §6).
   */
  aggressorIds: PlayerId[];
  battleId: string;
  wreckIds: string[];
}

// ---------------------------------------------------------------- the turn log

/** What a ledger entry records (`turn_specification.md` §6). */
export type LedgerKind =
  | 'sp' | 'job' | 'construction' | 'refit' | 'move' | 'engagement' | 'salvage' | 'raid'
  | 'fill' | 'upkeep' | 'restock' | 'contract' | 'standing' | 'bounty' | 'insurance' | 'union';

/**
 * [+] One state change, Tier 1. Every credit that moves names the faucet or drain it is
 * (`gameplay_tables.FAUCETS` / `DRAINS`), or null when it moves between players.
 */
export interface LedgerEntry {
  phase: PhaseOrdinal;
  kind: LedgerKind;
  ownerId: PlayerId | UnionId | null;
  /** The record that changed: a fleet, hull, lease, order, contract or authority id. */
  subjectId: string;
  /** Credits in (positive) or out (negative) for `ownerId`; 0 when none move. */
  credits: number;
  flow: string | null;
  detail: Record<string, unknown>;
}

/**
 * [+] The whole turn, Tier 1: enough to reconstruct it, and what determinism is asserted
 * against (`turn_specification.md` §5-6). Standings keep no ledger of their own: a change is
 * an entry here of kind `standing`, its subject the authority faction id.
 */
export interface TurnLog {
  turnNumber: number;
  entries: LedgerEntry[];
  engagementIds: string[];
  /** Every order dropped at execution, with its reason (turn §3.2). */
  rejections: { orderId: string; playerId: PlayerId; phase: PhaseOrdinal; reason: string }[];
}
