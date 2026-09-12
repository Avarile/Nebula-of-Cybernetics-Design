/**
 * combat.ts — turn structure, hit resolution, damage resolution, and logging.
 *
 * Derived from:
 *   data-template.json -> combatResolution                (v1.0 base layer)
 *   Combat-logic/advanced_combat_system.json              (v2.0, extends v1)
 *   Combat-logic/combat_logic_specification.md            (the reconciliation)
 *   Combat-logic/battle_log_sable_vs_ember.md             (5v7, shot-by-shot)
 *   Combat-logic/battle_log_veritas_vs_cinder.md          (13v17, phase-by-phase)
 *
 * v2 EXTENDS v1 rather than replacing it, so terms v2's pseudocode omits
 * (gunnery skill, the component-targeting penalty) still apply. Where the two
 * layers genuinely disagree, the conflict is modelled as an `OpenRuling` at the
 * bottom of this file rather than silently resolved.
 */

import type { ComponentName, Ship } from './ships';
import type { Distance, Fraction01, HardpointId, ModuleSlotId, ShipId, ShipTier, WeaponId } from './common';
import type { AmmoCapacity, Weapon, WeaponClass, WeaponRange, WeaponSpecialEffect } from './weapons';

// ================================================================
// 1. TURN STRUCTURE
// ================================================================

/**
 * The canonical 10-phase turn, in resolution order. v2's `updatedTurnStructure`
 * is a strict superset of v1's 9-step loop (it adds signature declaration,
 * detection/lock-on, and missile resolution), and both battle logs follow it.
 */
export type CombatPhase =
  /** Sort by (pilotSkill + sensorArray effectiveness + d20) descending. */
  | 'initiative'
  /** Each ship commits an operating state, fixing its signature for the whole turn. */
  | 'signatureDeclaration'
  /** Per attacker-target pair: effective detection range, then build/hold/reset lock. */
  | 'detection'
  /** Assign the power budget across weapons / shields / engines. */
  | 'powerAllocation'
  /** Resolve positioning; sets the `distance` everything downstream reads. */
  | 'movement'
  /** Pick target(s), weapon(s), and optionally a component, within range and ammo. */
  | 'targeting'
  /** Ammo deduction, arming check, and PD interception. Runs BEFORE any hit roll. */
  | 'missileResolution'
  /** Non-missile weapons and surviving missiles: hit chance, then damage. */
  | 'directFireResolution'
  /** On every confirmed hit, roll the component-critical table. */
  | 'criticalChecks'
  /** Shield recharge, signature bonuses expire, repair modules, destruction/retreat. */
  | 'endOfTurn';

export interface TurnPhaseSpec {
  phase: CombatPhase;
  /** 1-10. */
  order: number;
  description: string;
}

/**
 * Resolution granularity. Not stated as a rule in any source file, but it is the
 * load-bearing difference between the two battle logs and is worth making policy:
 * small actions resolve and log every individual shot; large actions batch
 * same-class-vs-same-class exchanges into one outcome per phase and break out
 * only events that clear the significance bar.
 */
export type ResolutionGranularity = 'perShot' | 'perGroupPerPhase';

export interface GranularityPolicy {
  /** The logs imply somewhere around 8-10 hulls per side. */
  hullCountThresholdPerSide: number;
  below: 'perShot';
  atOrAbove: 'perGroupPerPhase';
  /** Events at or above this tier are always broken out individually regardless. */
  alwaysNarrateAtOrAbove: SignificanceTier;
}

// ================================================================
// 2. RANGE BANDS
// ================================================================

/**
 * Range is the primary hit-chance driver. Bands are expressed as a percentage of
 * the weapon's own `range.optimal`, so every weapon carries its own band geometry.
 */
export type RangeBand = 'pointBlank' | 'close' | 'medium' | 'long' | 'extreme';

export interface RangeBandSpec {
  band: RangeBand;
  /** Lower bound as a multiple of `range.optimal`. */
  fromOptimalMultiple: number;
  /**
   * Upper bound as a multiple of `range.optimal`, or `'maximum'` for the long
   * band (which ends at `range.maximum`), or `null` for the unbounded extreme band.
   */
  toOptimalMultiple: number | 'maximum' | null;
  /** A constant for the flat bands; an interpolated pair for medium and long. */
  hitMultiplier: number | { from: number; to: number };
  note?: string;
}

/**
 * distance <= 0.25 * optimal            -> 1.10   (close-quarters bonus)
 * 0.25 * optimal < d <= optimal         -> 1.00
 * optimal < d <= 1.5 * optimal          -> 1.00 - 0.35 * ((d - optimal) / (0.5 * optimal))
 * 1.5 * optimal < d <= maximum          -> 0.65 - 0.50 * ((d - 1.5 * optimal) / (maximum - 1.5 * optimal))
 * d > maximum                           -> 0, weapon cannot fire
 */
export type RangeMultiplierFn = (distance: Distance, range: WeaponRange) => number;

export type RangeBandFn = (distance: Distance, range: WeaponRange) => RangeBand;

/**
 * Missiles fired at point-blank (< 10% of optimal) have a 50% chance to fail to
 * arm, treated as a clean miss — the warhead needs travel time. This is the price
 * of their long-range guidance advantage.
 */
export interface MissileArmingRule {
  /** 0.10 — fraction of `range.optimal` below which the check applies. */
  appliesBelowOptimalFraction: Fraction01;
  /** 0.50 — chance to fail to arm. */
  failureChance: Fraction01;
  outcomeOnFailure: 'cleanMiss';
}

// ================================================================
// 3. SIGNATURE, DETECTION, LOCK-ON
// ================================================================

/**
 * What a ship commits to for the whole turn during `signatureDeclaration`.
 * `runningSilent` is a real tactical choice, not a modifier: it halves signature
 * but costs 30% top speed AND forbids weapons fire that turn.
 */
export type OperatingState = 'normal' | 'afterburner' | 'runningSilent' | 'shieldsDown';

/**
 * Signature is DERIVED, never set as a stat — which is what lets it work on ships
 * that have no signature field:
 *
 *     baseSignature = mass.value * 0.05 + power.maxPower * 0.1 + shields.maxHP * 0.02
 *
 * Bigger, higher-power, heavily-shielded ships are inherently loud.
 */
export interface SignatureDerivation {
  massCoefficient: number;
  maxPowerCoefficient: number;
  shieldMaxHPCoefficient: number;
}

/** A per-turn state modifier, stacked multiplicatively on the base signature. */
export interface SignatureStateModifier {
  state:
    | 'weaponsFiredThisTurn'
    | 'shieldsActive'
    | 'afterburner'
    | 'runningSilent'
    | 'ecmModuleActive';
  /** e.g. +0.08 per volley fired, -0.50 for running silent. */
  signatureDelta: number;
  /** Whether the delta applies once or once per volley fired. */
  perVolley?: boolean;
  /** Side effects the state imposes, if any. */
  cost?: { topSpeedDelta?: number; weaponsFireForbidden?: boolean };
}

export interface SignatureResolution {
  base: number;
  applied: SignatureStateModifier[];
  final: number;
}

/**
 * Lock quality is not binary — it builds. A newly locked target starts at 0.5 and
 * gains +0.25 per turn of continuous tracking, capping at 1.0 after two full
 * turns. Breaking range/line-of-sight, or the target going silent, resets it to 0.
 */
export interface LockState {
  locked: boolean;
  /** 0 (no lock), 0.5 (fresh), up to 1.0 (fully built). Multiplies hit chance. */
  lockQuality: Fraction01;
  turnsTracked: number;
}

export interface DetectionResolution {
  /** From `sensorArray.currentHP` (not maxHP, if damaged) x sensor-bonus modules. */
  attackerSensorStrength: number;
  targetSignature: number;
  /** `attackerSensorStrength * (targetSignature / 100)`. */
  effectiveDetectionRange: Distance;
  distance: Distance;
  lock: LockState;
}

/**
 * An unlocked attacker may still fire "blind" at last-known position:
 * hit chance is multiplied by 0.25 and lockQuality is treated as a flat 0.5.
 */
export interface BlindFireRule {
  hitChanceMultiplier: Fraction01;
  lockQualityTreatedAs: Fraction01;
}

// ================================================================
// 4. SPEED-BASED EVASION
// ================================================================

/**
 * Evasion is a MATCHUP, not a lookup: the same target has different effective
 * evasion against different weapons, because the weapon's own `tracking` is
 * subtracted from the target's speed.
 *
 *     speedEvasionBonus = clamp((relativeSpeedFactor - weapon.tracking) / 250, 0, 0.35)
 *     effectiveEvasion  = clamp(evasionRating + speedEvasionBonus, 0, 0.60)
 *
 * This is why low-tracking capital guns compute down to the 0.05 accuracy floor
 * against a fast destroyer, and why EMP and engine criticals matter tactically:
 * strip the target's speed to strip its evasion.
 */
export interface EvasionResolution {
  /** Target's `mobility.evasionRating`. */
  baseEvasionRating: Fraction01;
  /** Target speed, reduced if it turned recently. */
  relativeSpeedFactor: number;
  /** The attacking weapon's `accuracy.tracking`. */
  trackingCounter: number;
  speedEvasionBonus: Fraction01;
  effectiveEvasion: Fraction01;
  /**
   * True for beam weapons (Beam Laser, Particle Lance): near-instant travel time
   * means they ignore `speedEvasionBonus` entirely, though they still take full
   * range falloff.
   */
  speedBonusIgnored: boolean;
}

export interface EvasionConstants {
  /** 250 — divisor converting the speed-vs-tracking gap into an evasion bonus. */
  speedTrackingDivisor: number;
  /** 0.35 — cap on the speed-derived component alone. */
  maxSpeedEvasionBonus: Fraction01;
  /** 0.60 — hard cap on total effective evasion. */
  maxEffectiveEvasion: Fraction01;
}

// ================================================================
// 5. PER-CLASS HIT PROFILES
// ================================================================

export interface WeaponHitProfile {
  /** Multiplier on `weapon.accuracy.baseHitChance`. 1.25 for missiles; 1.0 otherwise. */
  baseHitChanceModifier: number;
  /** Fraction of the target's effective evasion the class ignores. 0.5 for missiles. */
  evasionIgnoredFraction: Fraction01;
  /** True for beams — they skip the speed-derived evasion bonus. */
  ignoresSpeedEvasion: boolean;
  /** False for mines: they do not roll to hit, they trigger on proximity. */
  rollsToHit: boolean;
  /** True for missiles: they must survive point-defense before any hit roll. */
  interceptable: boolean;
  notes: string;
}

export type WeaponHitProfiles = Record<WeaponClass, WeaponHitProfile>;

/**
 * Mines are a standing trap rather than a targeted weapon: deployed to an area,
 * triggering on proximity for ANY ship — friend or foe — entering the zone.
 */
export interface MineDeployment {
  weaponId: WeaponId;
  ownerShipId: ShipId;
  /** Centre of the deployment zone. */
  position: unknown;
  proximityTriggerRadius: Distance;
  turnDeployed: number;
  /** Mines do not discriminate. */
  triggersOnFriendly: true;
}

// ================================================================
// 6. MISSILES AND POINT-DEFENSE
// ================================================================

/**
 * Step 1 of the missile sub-phase. Ammo is spent on launch, whether the volley
 * hits, misses, or is shot down entirely.
 */
export interface MissileVolley {
  attacker: ShipId;
  target: ShipId;
  weaponId: WeaponId;
  hardpointId: HardpointId;
  /** `min(fireRate.shotsPerTurn, ammo)`. */
  volleySize: number;
  ammoBefore: AmmoCapacity;
  ammoAfter: AmmoCapacity;
  /** Missiles lost to the point-blank arming check. */
  armingFailures: number;
}

/**
 * Interception attempts are POOLED across all incoming missiles at the defending
 * ship this turn — not allocated per launcher. This is what makes saturation
 * work: more warheads than pooled PD shots means leakage regardless of per-missile
 * intercept odds.
 *
 *   interceptChance = clamp(pd.baseHitChance + pd.tracking / 150 - missileEvasion, 0.05, 0.95)
 */
export interface InterceptionAttempt {
  pdWeaponId: WeaponId;
  targetMissileIndex: number;
  interceptChance: Fraction01;
  roll: number;
  intercepted: boolean;
}

export interface MissileEvasionConstants {
  /** 0.20. */
  base: Fraction01;
  /** -0.10 when the missile carries `high_tracking` — harder to intercept. */
  highTrackingDelta: number;
  /** +0.05 per missile for `multi_hit` swarm pods. */
  multiHitDeltaPerMissile: number;
}

export interface MissileResolution {
  volley: MissileVolley;
  /** Total pooled PD shots the defender had available this turn. */
  pdShotsAvailable: number;
  attempts: InterceptionAttempt[];
  intercepted: number;
  /** Missiles that reach the master hit-chance formula. */
  survived: number;
}

/**
 * The rock-paper-scissors this creates, and the single most decisive factor in
 * both battle logs: missiles beat evasive ships, PD beats missiles, saturation
 * beats PD. A ship with no PD hardpoint online is acutely vulnerable to any
 * missile- or fighter-armed opponent — treat it as a first-class tactical
 * readout, not just a stat.
 */
export interface PointDefenceReadout {
  shipId: ShipId;
  /** Weapons whose `specialEffects` include `point_defense` or `anti_missile`. */
  pdWeapons: WeaponId[];
  /** Sum of their `shotsPerTurn`, minus disabled hardpoints. */
  pooledShotsPerTurn: number;
  /** True when `pooledShotsPerTurn === 0`. */
  undefendedAgainstMissiles: boolean;
}

// ================================================================
// 7. HIT CHANCE
// ================================================================

export interface HitChanceInput {
  attacker: Ship;
  target: Ship;
  weapon: Weapon;
  distance: Distance;
  lock: LockState;
  /** Null when firing at general hull. */
  targetedComponent: ComponentName | null;
}

/**
 * Every intermediate term of the reconciled master formula, in resolution order.
 * Storing the terms (not just the result) is what makes a battle replayable and
 * lets the narrative log be regenerated without re-simulating.
 *
 *  0. distance > weapon.range.maximum      -> cannot fire, stop
 *  1. rangeMultiplier
 *  2. locked = distance <= effectiveDetectionRange
 *  3. lockQuality = locked ? current (0.5 -> 1.0) : 0.5
 *  4. effectiveEvasion
 *  5. missile? effectiveEvasion *= (1 - 0.5)
 *  6. baseChance = weapon.baseHitChance * profile.baseHitChanceModifier
 *                  + attacker.crew.gunnerySkill / 200        [carried forward from v1]
 *  7. component-targeted? baseChance -= 0.2                  [carried forward from v1]
 *  8. preLockChance = baseChance * rangeMultiplier * lockQuality
 *  9. not locked? preLockChance *= 0.25
 * 10. finalHitChance = clamp(preLockChance - effectiveEvasion, 0.05, 0.95)
 */
export interface HitChanceResolution {
  canFire: boolean;
  distance: Distance;
  rangeBand: RangeBand;
  rangeMultiplier: number;
  detection: DetectionResolution;
  evasion: EvasionResolution;
  profile: WeaponHitProfile;
  /** After the profile modifier and the gunnery-skill term. */
  baseChance: Fraction01;
  gunnerySkillBonus: Fraction01;
  componentTargetingPenalty: number;
  preLockChance: Fraction01;
  blindFireApplied: boolean;
  finalHitChance: Fraction01;
}

export type HitChanceResolver = (input: HitChanceInput) => HitChanceResolution;

export interface HitChanceConstants {
  /** 0.05 / 0.95 — the floor and ceiling every hit chance is clamped to. */
  floor: Fraction01;
  ceiling: Fraction01;
  /** 200 — divisor on gunnery skill. */
  gunnerySkillDivisor: number;
  /** -0.2 — flat penalty for targeting a specific component. */
  componentTargetingPenalty: number;
}

// ================================================================
// 8. DAMAGE
// ================================================================

/**
 * Shields absorb first, reduced by the target's per-type resistance; armour
 * applies only once shields are at 0. Overkill within a SINGLE hit spills through
 * to hull in that same hit, minus armour — shields do not block spillover.
 *
 *   rawDamage    = weapon.damage.base + random(-variance, +variance)
 *   shieldDamage = rawDamage * (1 - shields.damageTypeResistance[damageType])
 *   hullDamage   = max(1, rawDamage - hull.armorRating)
 */
export interface DamageResolution {
  rawDamage: number;
  varianceRoll: number;
  /** Portion routed straight to hull by `ignores_shields_partial`. */
  bypassedShields: number;
  damageToShields: number;
  shieldsBefore: number;
  shieldsAfter: number;
  /** Damage left over after shields were depleted inside this one hit. */
  overkillCarryover: number;
  /** Halved when the weapon carries `armor_piercing`. */
  armorRatingApplied: number;
  damageToHull: number;
  hullBefore: number;
  hullAfter: number;
  /** Non-null only when a component was targeted; tracked in a parallel pool. */
  componentDamage: { component: ComponentName; amount: number } | null;
}

/**
 * Whether a special effect has a numeric rule yet. Only two of the thirteen do.
 * The rest are used narratively in both battle logs but have no mechanical
 * backing in the schema — modelling that explicitly keeps an implementer from
 * inventing one silently.
 */
export type SpecialEffectRule =
  | {
      effect: WeaponSpecialEffect;
      status: 'specified';
      /** Where the rule lives. */
      source: 'combatResolution.damageFormula.specialEffectOverrides';
      behaviour: string;
    }
  | {
      effect: WeaponSpecialEffect;
      status: 'unspecified';
      /** How the battle logs already treat it — not yet a rule. */
      narrativeUsage: string;
      /** A concrete proposal, pending the ruling in `OPEN_RULINGS`. */
      proposedBehaviour?: string;
    };

export type SpecialEffectRules = Record<WeaponSpecialEffect, SpecialEffectRule>;

// ================================================================
// 9. CRITICALS
// ================================================================

export type CriticalKind =
  /** 1-30: -10% to a random stat for 2 turns. */
  | 'minorSystemDamage'
  /** 31-60: targeted component takes 25% of its maxHP as bonus damage. */
  | 'bonusComponentDamage'
  /** 61-85: targeted (or random) component disabled for 1 turn. */
  | 'componentDisabled'
  /** 86-100: component destroyed, permanent until dock repair. */
  | 'catastrophic';

export interface CriticalBand {
  /** Inclusive d100 bounds. */
  min: number;
  max: number;
  kind: CriticalKind;
  description: string;
}

export interface CriticalResolution {
  /** Rolled against `weapon.criticalChance` on any confirmed hit. */
  triggered: boolean;
  d100: number | null;
  kind: CriticalKind | null;
  /** The targeted component, or a randomly chosen one if none was targeted. */
  component: ComponentName | null;
  /** Both battle logs treat this as the "moment" roll — always a tier-1 narrative event. */
  catastrophic: boolean;
}

/** A time-boxed effect on a combatant: a minor crit, an EMP suppression, a disable. */
export interface StatusEffect {
  kind: 'statDebuff' | 'componentDisabled' | 'componentDestroyed' | 'shieldRechargeSuppressed';
  source: { weaponId: WeaponId; attacker: ShipId };
  target: ComponentName | null;
  magnitude?: number;
  /** Null for permanent effects (a catastrophic critical lasts until dock repair). */
  turnsRemaining: number | null;
}

// ================================================================
// 10. END OF TURN, DESTRUCTION, VICTORY
// ================================================================

export interface ShieldRechargeResolution {
  /** `currentHP < maxHP && turnsSinceLastHit >= rechargeDelayAfterHit`. */
  eligible: boolean;
  turnsSinceLastHit: number;
  /** `rechargeRatePerTurn`, modified by any equipped shield-booster module. */
  amount: number;
  suppressed: boolean;
}

export type DestructionCause =
  /** `hull.currentHP <= 0` — the explosion may splash nearby ships. */
  | 'hullDestroyed'
  /** `lifeSupport` destroyed AND `crew.currentCrew === 0`. */
  | 'crewLoss';

/**
 * The schema says retreat at 15% hull; both battle logs behave like ~30%
 * (Stormbreaker pulls out at 340/1072, World Ender at ~30%). See `OPEN_RULINGS`.
 */
export interface RetreatPolicy {
  hullFractionThreshold: Fraction01;
  requiresNoWeaponsOperational: boolean;
  /** Which source the threshold came from. */
  source: 'schema' | 'observedInLogs';
}

export type VictoryCondition =
  | { kind: 'annihilation'; note: 'all enemy ships destroyed or retreated' }
  | { kind: 'objective'; description: string; turns?: number };

// ================================================================
// 11. RUNTIME COMBATANT STATE
// ================================================================

/**
 * The mutable half of a ship during a battle. The `Ship` entity is the build
 * sheet; this is what changes turn to turn. Kept separate so the catalogue stays
 * immutable and a battle can be replayed from a log against a pristine roster.
 */
export interface CombatantState {
  shipId: ShipId;
  /** The immutable build sheet this combatant was instantiated from. */
  ship: Ship;
  fleet: string;
  tier: ShipTier;

  hullCurrentHP: number;
  shieldsCurrentHP: number;
  componentCurrentHP: Record<ComponentName, number>;
  crewCurrent: number;
  powerCurrent: number;

  /** Remaining rounds per mount; `'infinite'` mounts never decrement. */
  ammoRemaining: Record<HardpointId, AmmoCapacity>;
  /** Turns left before a mount may fire again. */
  cooldownRemaining: Record<HardpointId, number>;
  /** Mounts knocked out by a `weaponSystems` critical. */
  disabledHardpoints: HardpointId[];
  disabledSlots: ModuleSlotId[];

  operatingState: OperatingState;
  signature: SignatureResolution;
  volleysFiredThisTurn: number;
  turnsSinceLastHit: number;

  /** Lock this ship holds on each opponent — keyed by the opponent's id. */
  locks: Record<ShipId, LockState>;
  statusEffects: StatusEffect[];

  /** Aggregated module effects applied to the hull's stats for this battle. */
  effectiveStats: EffectiveStats;

  destroyed: boolean;
  retreated: boolean;
}

/**
 * Ship stats after every fitted module's effects have been applied. Keys are the
 * module effect stat vocabulary — this is the object a `ModuleEffect` writes into,
 * and the reason stats like `weaponAccuracy` and `enemyHitChance` exist at all:
 * modules target them even though no hull field carries them.
 */
export type EffectiveStats = Record<import('./modules').ModuleEffectStat, number>;

// ================================================================
// 12. TIER 1 LOG — STRUCTURED EVENTS (GROUND TRUTH)
// ================================================================

export type FireOutcome = 'hit' | 'miss' | 'intercepted' | 'failedToArm' | 'outOfRange';

/**
 * One resolved weapon-fire event. Every RNG draw is stored, not just its outcome
 * — that is what makes a battle deterministically replayable and lets the
 * narrative log be regenerated in a different tone without re-simulating.
 */
export interface FireEvent {
  turn: number;
  phase: Extract<CombatPhase, 'directFireResolution' | 'missileResolution'>;
  attacker: ShipId;
  target: ShipId;
  weaponUsed: WeaponId;
  weaponClass: WeaponClass;
  volleySize: number;
  ammoRemaining: AmmoCapacity;
  targetedComponent: ComponentName | null;

  distance: Distance;
  rangeBand: RangeBand;
  locked: boolean;
  lockQuality: Fraction01;

  /** Present only for missile weapons. */
  interception: { attempts: number; intercepted: number; survived: number } | null;

  hitChanceCalculated: Fraction01;
  /** The raw roll. Hit when `rollResult <= hitChanceCalculated`. */
  rollResult: number;
  outcome: FireOutcome;

  rawDamage: number;
  damageToShields: number;
  damageToHull: number;
  shieldsBefore: number;
  shieldsAfter: number;
  hullBefore: number;
  hullAfter: number;

  criticalRolled: boolean;
  critical: CriticalResolution | null;
}

/** Non-fire events the narrator needs: kills, retreats, lock changes, state declarations. */
export interface StateEvent {
  turn: number;
  phase: CombatPhase;
  subject: ShipId;
  kind:
    | 'destroyed'
    | 'retreated'
    | 'shieldsCollapsed'
    | 'componentDisabled'
    | 'componentDestroyed'
    | 'lockAcquired'
    | 'lockLost'
    | 'stateDeclared'
    | 'shieldsRecharged';
  detail: string;
  cause?: DestructionCause;
}

export type CombatEvent = FireEvent | StateEvent;

export interface TurnLog {
  turn: number;
  /** Initiative order resolved this turn. */
  initiativeOrder: ShipId[];
  events: CombatEvent[];
}

export interface BattleLog {
  battleId: string;
  /** Every entry needed to replay: roster, seed, granularity. */
  rosters: Record<string, ShipId[]>;
  rngSeed: number;
  granularity: ResolutionGranularity;
  turns: TurnLog[];
  result: BattleResult;
}

export interface BattleResult {
  victor: string | null;
  victoryCondition: VictoryCondition;
  losses: Record<string, ShipId[]>;
  survivors: Record<string, ShipId[]>;
  turnsElapsed: number;
}

// ================================================================
// 13. TIER 2 LOG — NARRATIVE BROADCAST
// ================================================================

/**
 * The narrative log is a DETERMINISTIC RENDERING of the Tier 1 log, not a
 * separately authored artifact. The house style below is codified from the two
 * hand-written battle logs rather than re-invented per battle.
 */

/**
 * 1 headline  — always narrated in full: any ship destroyed, any catastrophic
 *               critical, a retreat/withdrawal order, first contact / first blood.
 * 2 notable   — narrated within the current focus phase: shields collapsing to 0,
 *               a 61-85 component critical, saturation overwhelming PD, a named
 *               flagship taking a significant hit.
 * 3 routine   — summarized, not per-shot ("both sides trade fire, minor damage").
 * 4 omitted   — not narrated at all, though still present in Tier 1.
 */
export type SignificanceTier = 1 | 2 | 3 | 4;

export interface SignificanceRule {
  tier: SignificanceTier;
  label: 'headline' | 'notable' | 'routine' | 'omitted';
  narration: string;
  triggers: readonly string[];
}

export type ChatterTrigger =
  | 'firstContact'
  | 'firstLockAdvantage'
  | 'pressOrder'
  | 'focusFireOrder'
  | 'withdrawOrder'
  | 'flagshipEndangered';

/**
 * Flavour is never free text: each line is tied to the mechanical event that
 * triggered it, so the narrative stays grounded in what the Tier 1 log says.
 */
export interface RadioChatter {
  trigger: ChatterTrigger;
  /** e.g. `Ironclad Vestige, CIC`. */
  speaker: string;
  line: string;
  /** The Tier 1 event that licensed this line. */
  sourceEvent: CombatEvent;
}

/** A roster table row, printed up front so state changes have a reference. */
export interface RosterRow {
  shipName: string;
  shipClass: string;
  hull: number;
  shield: number;
  speed: number;
  evasion: Fraction01;
  flagship: boolean;
}

export interface NarrativeSection {
  /** One header per turn in small actions; one per multi-turn phase in large ones. */
  heading: string;
  /** For large actions the phase name is doctrine commentary, not just a label. */
  phaseName?: string;
  turns: number[];
  paragraphs: string[];
  chatter: RadioChatter[];
  /** Running tally stated inline whenever a kill happens: `EMBER: 7 -> 6 hulls`. */
  hullTallies: Record<string, number>;
}

export interface NarrativeLog {
  /** `Engagement Log: The [Place] [Skirmish|Line|Action]`. */
  title: string;
  combatants: string[];
  location: string;
  /** Present for large actions only. */
  classification?: string;
  rosters: Record<string, RosterRow[]>;
  sections: NarrativeSection[];
  /** Losses/remaining table. */
  result: BattleResult;
  /** Ties the mechanical outcome back to WHICH system or doctrine decided it. */
  summary: string;
}

export type NarrativeRenderer = (log: BattleLog, policy: GranularityPolicy) => NarrativeLog;

// ================================================================
// 14. OPEN RULINGS
// ================================================================

/**
 * Cross-referencing the three source files surfaced five inconsistencies that
 * need an explicit decision before implementation, rather than being silently
 * resolved differently by whoever builds it.
 */
export interface OpenRuling {
  id: string;
  topic: string;
  sources: string[];
  conflict: string;
  recommendation: string;
  status: 'open' | 'ruled';
}

export const OPEN_RULINGS: readonly OpenRuling[] = [
  {
    id: 'R1',
    topic: '`extends` points at a file that does not exist',
    sources: ['Combat-logic/advanced_combat_system.json'],
    conflict:
      '_meta.extends names "combatResolution from spaceship_combat_system.json"; no such file exists. The actual base is data-template.json -> combatResolution.',
    recommendation: 'Rename the reference at the source.',
    status: 'open',
  },
  {
    id: 'R2',
    topic: 'Gunnery skill and the component-targeting penalty',
    sources: ['data-template.json -> combatResolution.hitChanceFormula', 'advanced_combat_system.json -> masterHitChanceFormula'],
    conflict:
      "v1 includes attacker.gunnerySkill/200 and a -0.2 component-targeting penalty; v2's pseudocode omits both.",
    recommendation:
      'Both still apply — v2 extends rather than replaces v1. HitChanceResolution models them explicitly at steps 6 and 7.',
    status: 'open',
  },
  {
    id: 'R3',
    topic: 'Most specialEffects have no numeric rule',
    sources: ['Data-Templates/weapon.interface', 'data-template.json -> specialEffectOverrides'],
    conflict:
      'Only ignores_shields_partial and armor_piercing are specified. emp_disable, multi_hit, shield_disrupt, area_denial, anti_air, high_tracking, proximity_trigger, armor_melt, anti_missile, point_defense and can_be_intercepted are used narratively but unbacked.',
    recommendation:
      'Define numeric behaviour per effect; the battle logs already assume mechanics (2-turn shield-recharge suppression from EMP, double-hit autocannons) the schema does not provide.',
    status: 'open',
  },
  {
    id: 'R4',
    topic: 'Retreat threshold',
    sources: ['data-template.json -> destructionConditions', 'both battle logs'],
    conflict: 'Schema says hull < 15%; both logs trigger withdrawal in the 30-33% band.',
    recommendation:
      'Move the canonical threshold to ~30% and update data-template.json, rather than leaving the sources disagreeing.',
    status: 'open',
  },
  {
    id: 'R5',
    topic: 'sensorDebuff is undefined',
    sources: ['data-template.json -> combatResolution.hitChanceFormula'],
    conflict: "v1's formula includes a sensorDebuff term with no formula given anywhere.",
    recommendation:
      "Fold it into the existing sensorArray critical effect ('-40% hit chance') rather than inventing a second debuff — but make it an explicit decision.",
    status: 'open',
  },
];
