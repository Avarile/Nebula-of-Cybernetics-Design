/**
 * skills.ts — the 81-entry skill catalogue: 4 domains, 10 levels each.
 *
 * Derived from: Data-Templates/skill.interface, Skills/*, tools/skill_tables.py,
 *               tools/stat_vocabulary.py, Skills/Design (the hand-written spec),
 *               fleet_and_weapons.json -> "skills"
 *
 * Shape of the domain: a skill is a level from 1 to 10 plus four lists, any of
 * which may be empty — `effects` (a per-level modifier on a stat), `penalties`
 * (a flat malus while BELOW a level), `unlocks` (a hull, fleet slot, capability
 * or skill group) and `prerequisites` (another skill that must come first).
 *
 * One rule covers every effect in the catalogue:
 *
 *     total = modifierPerLevel x max(0, level - appliesFromLevel + 1)
 *
 * Navigation (`appliesFromLevel: 1`, +1%/level) reaches +10% at level 10. The
 * four Weaponry skills instead start at level 6 and pair that with a -50%
 * penalty below level 5, so level 5 is a clean baseline: debuff gone, bonus not
 * yet started. That is the Design spec's "below level 5 ... 50% debuff, after
 * level 5 each level +5%" expressed as data rather than prose.
 *
 * 52 of the 81 are the 26 ship categories x {Control, System Management}. A hull
 * is operable only when BOTH of its skills reach level 5 — see `OperableHulls`.
 *
 * Two systems are modelled on EVE Online:
 *
 *   TRAINING   SP(level) = rank x 250 x k ** (level - 1), k = 2 ** (10/9). EVE runs
 *              250 -> 256,000 over five levels; this catalogue has ten, so k is
 *              re-derived to land on the same endpoints rather than inventing a curve.
 *              See `SkillTraining`.
 *
 *   HULL TREE  the 26 hulls form a prerequisite DAG rooted at Spaceship Command. Each
 *              hull requires ONE predecessor at level 5, and the Control and System
 *              Management ladders never cross. See `HullPrerequisite`.
 */

import type { PercentPoints } from './common';
import type { ResourceTier } from './resources';
import type { ShipClass } from './ships';
import type { ModifierType, ModuleEffectStat } from './modules';
import type { WeaponClass } from './weapons';

export type { ModifierType } from './modules';

// ---------------------------------------------------------------- levels & rank

/**
 * A trained skill level. Every skill in the catalogue has `maxLevel: 10`, so the
 * ladder is uniform — there is no short skill and no long one.
 */
export type SkillLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** `maxLevel` as it appears on the entity. Always 10 across all 81 skills. */
export type SkillMaxLevel = 10;

/** A skill a player has not started is absent from their sheet, or level 0. */
export type TrainedLevel = 0 | SkillLevel;

/**
 * Training-difficulty multiplier, and the coefficient of the whole SP curve: every
 * figure in `SkillTraining` is `rank x` the rank-1 ladder. Derived from the hull's
 * mass band for the 52 ship skills (a battleship is rank 5 work, a motor torpedo
 * boat rank 1) and hand-set for the other 29.
 */
export type SkillRank = 1 | 2 | 3 | 4 | 5;

/**
 * The level at which both of a hull's skills unlock it. Fixed at 5 by the Design
 * spec: "reaching level 5 will enable a player to operate that kind of ship
 * (both control and system management is required)".
 */
export type OperateLevel = 5;

// ---------------------------------------------------------------- domains

export type SkillDomain =
  | 'ship_command'
  | 'station_management'
  | 'deep_space_mining'
  | 'interaction_trade';

export type ShipCommandCategory =
  /** The root of the hull tree. Exactly one skill: Spaceship Command. */
  | 'fundamentals'
  | 'ship_system_control'
  | 'navigation'
  | 'scanning'
  | 'engineering'
  | 'weaponry'
  | 'fleet_command';

export type StationManagementCategory = 'science' | 'facility_management';

export type DeepSpaceMiningCategory = 'mining_operations';

export type InteractionTradeCategory = 'commerce';

export type SkillCategory =
  | ShipCommandCategory
  | StationManagementCategory
  | DeepSpaceMiningCategory
  | InteractionTradeCategory;

/** What a skill's effects apply to. Narrower than the domain: a mining skill is `ship`-scoped. */
export type SkillScope = 'ship' | 'fleet' | 'station' | 'player';

// ---------------------------------------------------------------- identifiers
//
// Unlike weapon and module ids, skill ids are fully derivable: the 52 hull
// skills are `skl_ship_<shipClass>_{control,systems}` and the other 29 are a
// fixed list. Both are typed exactly, so a typo in a hand-built fixture is a
// compile error rather than a lookup that silently returns undefined.

/** `skl_ship_<shipClass>_control` — one per ship category, 26 in all. */
export type ShipControlSkillId = `skl_ship_${ShipClass}_control`;

/** `skl_ship_<shipClass>_systems` — one per ship category, 26 in all. */
export type ShipSystemsSkillId = `skl_ship_${ShipClass}_systems`;

export type ShipSystemControlSkillId = ShipControlSkillId | ShipSystemsSkillId;

/**
 * The root of the hull tree, and the only `fundamentals` skill. Deliberately NOT in
 * the `skl_ship_*` namespace: that prefix belongs to the 52 hull skills, and a
 * consumer matching on it should get 52, not 53.
 */
export type RootSkillId = 'skl_fund_spaceship_command';

/** The 17 non-hull skills of the Spaceship Command domain. */
export type ShipCommandSkillId =
  | RootSkillId
  | ShipSystemControlSkillId
  | 'skl_nav_navigation'
  | 'skl_scan_scanning'
  | 'skl_eng_maintenance'
  | 'skl_eng_energy_shields'
  | 'skl_eng_damage_control'
  | 'skl_eng_electronics'
  | 'skl_wpn_ballistic'
  | 'skl_wpn_energy'
  | 'skl_wpn_missiles'
  | 'skl_wpn_drones'
  | 'skl_flt_formation_drill'
  | 'skl_flt_attacking_formation'
  | 'skl_flt_defensive_formation'
  | 'skl_flt_mining_formation'
  | 'skl_flt_regroup_and_hold'
  | 'skl_flt_fighter_squadron_control';

export type StationManagementSkillId =
  | 'skl_sta_science'
  | 'skl_sta_resource_production'
  | 'skl_sta_production_management'
  | 'skl_sta_refinement'
  | 'skl_sta_manufactory'
  | 'skl_sta_ship_construction';

export type DeepSpaceMiningSkillId =
  | 'skl_mine_equipment_operation'
  | 'skl_mine_advanced_equipment'
  | 'skl_mine_effectiveness'
  | 'skl_mine_advanced_effectiveness';

export type InteractionTradeSkillId = 'skl_trd_trade' | 'skl_trd_union_management';

export type SkillId =
  | ShipCommandSkillId
  | StationManagementSkillId
  | DeepSpaceMiningSkillId
  | InteractionTradeSkillId;

// ---------------------------------------------------------------- stat vocabulary

/**
 * Stats only a skill reaches — 18 of them. Each is a player, fleet or station
 * level multiplier with no field on the hull to sit on, which is exactly why no
 * module can target one: `ModuleEffect.stat` is `ModuleEffectStat`, and these
 * are disjoint from it.
 *
 * Lives in tools/stat_vocabulary.py alongside the module list, so the two
 * catalogues share one vocabulary and cannot drift apart.
 */
export type SkillOnlyStat =
  // weapon effectiveness — always qualified by `appliesTo.weaponClass`
  | 'weaponDamage'
  | 'weaponTracking'
  // survivability the hull has no single field for
  | 'damageReduction'
  | 'criticalEventResistance'
  | 'electronicSystemsEffectiveness'
  // fleet-level
  | 'fleetRegroupRate'
  | 'squadronSpeed'
  | 'squadronAccuracy'
  | 'squadronEvasion'
  // deep space mining
  | 'miningYield'
  | 'miningCycleSpeed'
  // planetary / station industry
  | 'planetaryProductionRate'
  | 'warehouseCapacity'
  | 'refineryYield'
  | 'manufacturingRate'
  | 'shipConstructionRate'
  // interaction & trade
  | 'tradePriceMargin'
  | 'unionMemberCapacity';

/**
 * Everything a skill effect may target: the 34 module stats plus the 18
 * skill-only ones. `ALL_STATS` in tools/stat_vocabulary.py, and the closed
 * vocabulary tools/verify_skills.py checks every effect and penalty against.
 */
export type SkillEffectStat = ModuleEffectStat | SkillOnlyStat;

// ---------------------------------------------------------------- training
//
// EVE's skill-point model, re-derived for a ten-level ladder.

/**
 * Skill points, already multiplied by `rank` — a consumer never re-derives them.
 *
 *     spPerLevel[L - 1] = round(rank * 250 * (2 ** (10/9)) ** (L - 1))
 *
 * The exponent base is chosen so a rank-1 skill starts at 250 SP and ends at 256,000:
 * EVE's own level-I and level-V figures, spread over ten rungs instead of five.
 *
 * Training TIME is deliberately absent — it is `sp / rate`, and the rate belongs to
 * the character system, not the catalogue. `SP_PER_HOUR_REFERENCE` in constants.ts
 * carries EVE's ~1,800 SP/hour for sizing.
 */
export interface SkillTraining {
  /** SP to buy each level. Strictly increasing; 10 entries. */
  spPerLevel: number[];
  /** Running sum: SP spent to have REACHED each level. 10 entries. */
  spCumulative: number[];
  /** `spCumulative[9]` — what the skill costs at level 10. */
  spTotal: number;
}

// ---------------------------------------------------------------- qualifiers

/**
 * A weapon skill's target class. The five catalogue classes plus `drone`:
 * the Design spec lists Drones beside the other three weapon skills, but drones
 * are hangar-launched craft (`droneCapacity`, hangar slots) and so have no entry
 * in `Weapons/`. tools/verify_skills.py asserts the difference is exactly that
 * one documented value, so a typo in the other five still fails.
 */
export type SkillWeaponClass = WeaponClass | 'drone';

/**
 * Optional narrowing on an effect or penalty. Absent keys mean "applies
 * everywhere in scope": Navigation's `topSpeed` effect carries no qualifier and
 * so applies to any hull, while a hull skill's effects carry `shipCategory` and
 * apply to that category alone.
 *
 * Serialised as `{}` when empty, never omitted.
 */
export interface SkillAppliesTo {
  weaponClass?: SkillWeaponClass;
  shipCategory?: ShipClass;
  resourceTier?: ResourceTier;
}

// ---------------------------------------------------------------- effects

/**
 * A per-level modifier. `appliesFromLevel` is the first level that contributes,
 * so the total at level L is
 *
 *     modifierPerLevel * max(0, L - appliesFromLevel + 1)
 *
 * and a skill can start its ladder late (the Weaponry skills start at 6) without
 * a separate "bonus begins at" field.
 */
export interface SkillEffect {
  stat: SkillEffectStat;
  /** Flat units or percentage points per qualifying level, per `modifierType`. */
  modifierPerLevel: number | PercentPoints;
  modifierType: ModifierType;
  /** First level that contributes. 1 for a ladder that starts immediately. */
  appliesFromLevel: SkillLevel;
  appliesTo: SkillAppliesTo;
}

/**
 * A flat malus while the skill sits below `appliesBelowLevel`. NOT per-level:
 * it is either on or off, and it vanishes the moment the threshold is reached.
 *
 * Only the four Weaponry skills carry penalties. tools/verify_skills.py enforces
 * that every penalised stat also has an effect on the same skill starting at or
 * after the threshold — a player can never be stuck in a debuff the skill
 * offers no way out of.
 */
export interface SkillPenalty {
  stat: SkillEffectStat;
  /** Flat units or percentage points — negative for a malus. */
  modifier: number | PercentPoints;
  modifierType: ModifierType;
  /** The malus applies at levels 1..(appliesBelowLevel - 1). */
  appliesBelowLevel: SkillLevel;
  appliesTo: SkillAppliesTo;
}

// ---------------------------------------------------------------- unlocks

export type SkillUnlockType = 'ship_operation' | 'fleet_slot' | 'capability' | 'skill_group';

/** Fleet positions 2-5. Position 1 needs no skill. Strings in the data, not numbers. */
export type FleetSlotTarget = '2' | '3' | '4' | '5';

export type SkillCapability =
  | 'system_scan'
  | 'enemy_scout'
  | 'target_lock'
  | 'standard_mining_equipment'
  | 'advanced_mining_equipment';

/** Science's three gates. Each opens a set of skills for training, not a ship action. */
export type SkillGroup = 'raw_operations' | 'refined_operations' | 'manufactured_operations';

interface SkillUnlockBase {
  level: SkillLevel;
  description: string;
}

/**
 * Half of a hull's operability requirement. Both the Control and the System
 * Management skill for a category carry one of these at level 5, and the hull is
 * operable only when both are trained — which is why `level` is the literal 5
 * rather than any `SkillLevel`.
 */
export interface ShipOperationUnlock extends SkillUnlockBase {
  type: 'ship_operation';
  target: ShipClass;
  level: OperateLevel;
}

/** Formation Drill's four gates: levels 5, 7, 8, 10 for ships 2, 3, 4, 5. */
export interface FleetSlotUnlock extends SkillUnlockBase {
  type: 'fleet_slot';
  target: FleetSlotTarget;
}

export interface CapabilityUnlock extends SkillUnlockBase {
  type: 'capability';
  target: SkillCapability;
}

export interface SkillGroupUnlock extends SkillUnlockBase {
  type: 'skill_group';
  target: SkillGroup;
}

/**
 * Discriminated on `type`, so narrowing an unlock also settles what `target`
 * means — a ship category, a fleet position, a capability key or a skill group.
 */
export type SkillUnlock =
  | ShipOperationUnlock
  | FleetSlotUnlock
  | CapabilityUnlock
  | SkillGroupUnlock;

// ---------------------------------------------------------------- prerequisites

/**
 * Another skill that must reach `level` before this one can be trained.
 * tools/verify_skills.py checks the graph is acyclic and that no skill requires
 * itself.
 */
export interface SkillPrerequisite {
  skillId: SkillId;
  level: SkillLevel;
}

/**
 * A hull skill's single prerequisite — the rung below it on the tree.
 *
 * Every one of the 52 hull skills carries exactly one, and the two ladders never
 * cross: a Control skill requires the predecessor's Control at level 5, a System
 * Management skill requires the predecessor's System Management at 5. The three
 * entry hulls (motor torpedo boat, submarine chaser, corvette) have no predecessor
 * and require the root at level 1 instead.
 *
 * Discriminated by which arm you get: narrowing on `skillId` settles whether you are
 * looking at the root or at another hull of the same ladder.
 */
export type HullPrerequisite =
  | { skillId: RootSkillId; level: 1 }
  | { skillId: ShipControlSkillId; level: OperateLevel }
  | { skillId: ShipSystemsSkillId; level: OperateLevel };

/**
 * The hull tree as data: every ship category mapped to the one below it, or `null`
 * for an entry hull. `HULL_TREE` in constants.ts is this shape.
 */
export type HullTree = Record<ShipClass, ShipClass | null>;

// ---------------------------------------------------------------- the entity

interface SkillBase {
  skillId: SkillId;
  name: string;
  maxLevel: SkillMaxLevel;
  rank: SkillRank;
  /** SP costs, rank-multiplied. Present on every skill. */
  training: SkillTraining;
  scope: SkillScope;
  effects: SkillEffect[];
  /** Empty for 76 of the 80 skills; only Weaponry carries a below-level malus. */
  penalties: SkillPenalty[];
  unlocks: SkillUnlock[];
  prerequisites: SkillPrerequisite[];
  description: string;
}

export interface ShipCommandSkill extends SkillBase {
  domain: 'ship_command';
  category: ShipCommandCategory;
}

export interface StationManagementSkill extends SkillBase {
  domain: 'station_management';
  category: StationManagementCategory;
}

export interface DeepSpaceMiningSkill extends SkillBase {
  domain: 'deep_space_mining';
  category: DeepSpaceMiningCategory;
}

export interface InteractionTradeSkill extends SkillBase {
  domain: 'interaction_trade';
  category: InteractionTradeCategory;
}

/**
 * Discriminated on `domain`, so narrowing a skill also settles which categories
 * are legal for it. That is the verifier's "category belongs to its domain"
 * check expressed as a type.
 */
export type Skill =
  | ShipCommandSkill
  | StationManagementSkill
  | DeepSpaceMiningSkill
  | InteractionTradeSkill;

// ---------------------------------------------------------------- player state
//
// The catalogue is immutable; a player's progress through it is not. These
// types keep the two apart the way combat.ts keeps `CombatantState` apart from
// `Ship`.

/** A player's trained levels. Absent means untrained, equivalent to level 0. */
export type SkillSheet = Partial<Record<SkillId, SkillLevel>>;

/**
 * The hulls a sheet can actually fly. A category qualifies only when BOTH of its
 * skills are at `OperateLevel` — the pair rule, resolved.
 */
export type OperableHulls = (sheet: SkillSheet) => ShipClass[];

/** Fleet size a sheet permits: 1 with no Formation Drill, up to 5 at level 10. */
export type FleetCapacity = (sheet: SkillSheet) => 1 | 2 | 3 | 4 | 5;

/**
 * Whether a skill can be STARTED: every entry in its `prerequisites` is satisfied by
 * the sheet. Distinct from whether a hull can be flown, which needs both of its
 * skills at `OperateLevel`.
 */
export type CanTrain = (skillId: SkillId, sheet: SkillSheet, catalogue: readonly Skill[]) => boolean;

/**
 * One rung of a training plan: a skill and the level to take it to, in an order that
 * satisfies every prerequisite along the way.
 */
export interface TrainingStep {
  skillId: SkillId;
  /** The level this step ends at. */
  toLevel: SkillLevel;
  /** SP this step costs, from the skill's own `spCumulative`. */
  sp: number;
}

/**
 * The full path from a sheet to a goal — typically "fly this hull", which expands to
 * the whole chain from the root down both ladders. Walking `HullTree` is what makes
 * the plan finite: every hull reaches the root in at most seven steps.
 */
export interface TrainingPlan {
  steps: TrainingStep[];
  /** Sum of every step's `sp`. */
  totalSp: number;
}

export type PlanForHull = (
  hull: ShipClass,
  sheet: SkillSheet,
  catalogue: readonly Skill[],
) => TrainingPlan;

/**
 * One resolved modifier, after the level arithmetic. `total` already folds in
 * both the effect ladder and any penalty still in force, so a consumer adds
 * these up per stat rather than re-deriving them.
 */
export interface ResolvedSkillModifier {
  stat: SkillEffectStat;
  total: number | PercentPoints;
  modifierType: ModifierType;
  appliesTo: SkillAppliesTo;
  /** Which skill produced it, for tracing a stat back to its source. */
  source: SkillId;
}

/**
 * Applying a sheet: every effect and still-active penalty across every trained
 * skill, resolved to totals. The signature takes the catalogue because a sheet
 * holds levels only, not the rules behind them.
 */
export type ResolveSkillModifiers = (
  sheet: SkillSheet,
  catalogue: readonly Skill[],
) => ResolvedSkillModifier[];

// ---------------------------------------------------------------- index file

/** One row of Skills/index.json. */
export interface SkillIndexEntry {
  skillId: SkillId;
  name: string;
  domain: SkillDomain;
  category: SkillCategory;
  rank: SkillRank;
  /** `Skills/<domain>/<category>/<skillId>.json`. */
  path: string;
}

/** The `domains` summary Skills/index.json carries above the rows. */
export interface SkillDomainSummary {
  domain: SkillDomain;
  count: number;
  categories: SkillCategory[];
}

export interface SkillIndex {
  count: number;
  maxLevel: SkillMaxLevel;
  domains: SkillDomainSummary[];
  skills: SkillIndexEntry[];
}
