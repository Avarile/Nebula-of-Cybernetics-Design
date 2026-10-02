/**
 * combat.ts — round structure, hit resolution, damage resolution, and logging.
 *
 * Derived from:
 *   data-template.json -> combatResolution                (v1.0 base layer)
 *   Combat-logic/advanced_combat_system.json              (v2.0, extends v1)
 *   Combat-logic/combat_logic_specification.md            (the reconciliation)
 *   Combat-logic/battle_log_sable_vs_ember.md             (5v7, shot-by-shot)
 *   Combat-logic/battle_log_veritas_vs_cinder.md          (13v17, phase-by-phase)
 *
 * v2 EXTENDS v1 rather than replacing it, so terms v2's pseudocode omitted
 * (gunnery skill, the component-targeting penalty) still apply. Where the two
 * layers disagreed, the conflict is recorded as an `OpenRuling` at the bottom of
 * this file; ruled entries carry their ruling, open ones are still undecided.
 * The numbers every ruling introduces live in tools/combat_tables.py.
 *
 * Clock words follow GamePlay/gameplay_specification.md 3: a ROUND is one exchange in
 * a battle and every identifier here that counts them says round (`endOfRound`,
 * `RoundLog`, `roundsTracked`); a whole engagement fits in phase 9 of one 24-hour turn.
 * `turnRate`, `turnPenalty` and `turnedThisRound` are about heading, not the clock.
 *
 * The catalogue `Ship` is fixed data (maxima only). Every value a battle changes lives
 * in `CombatantState` below; between battles, in `FleetHull` (gameplay.ts).
 */

import type { ComponentName, Ship } from './ships';
import type { DamageType, Distance, Fraction01, HardpointId, LaneQuantity, ModuleSlotId, ShipId, ShipTier, WeaponId } from './common';
import type { AmmoCapacity, Weapon, WeaponClass, WeaponRange, WeaponSpecialEffect } from './weapons';
import type { SkillWeaponClass } from './skills';

// ================================================================
// 1. ROUND STRUCTURE
// ================================================================

/**
 * The canonical 10-phase round, in resolution order. v2's `updatedRoundStructure`
 * is a strict superset of v1's 9-step loop (it adds signature declaration,
 * detection/lock-on, and missile resolution), and both battle logs follow it.
 */
export type CombatPhase =
  /**
   * Sort by `effective(sensors.initiative) + effective(crew.pilotSkill) / 5 + d20`,
   * descending (R8, spec 1.1). v1's undefined "sensorArray effectiveness" term is gone.
   */
  | 'initiative'
  /** Each ship commits an operating state, fixing its signature for the whole round, and its movement intent. */
  | 'signatureDeclaration'
  /** Per attacker-target pair: effective detection range, then build/hold/reset lock. */
  | 'detection'
  /** Assign the power budget across weapons / shields / engines. */
  | 'powerAllocation'
  /**
   * Every ship moves along the engagement line in ascending initiative order (R6,
   * spec 1.4); sets position, speed and every pairwise `distance` downstream reads.
   */
  | 'movement'
  /** Pick target(s), weapon(s), and optionally a component, within range and ammo. */
  | 'targeting'
  /** Ammo deduction, arming check, and PD interception. Runs BEFORE any hit roll. */
  | 'missileResolution'
  /** Non-missile weapons and surviving missiles: hit chance, then damage. */
  | 'directFireResolution'
  /** On every confirmed hit, roll the component-critical table. */
  | 'criticalChecks'
  /** Shield recharge, signature bonuses expire, power and hull regen, crew casualties, destruction/retreat. */
  | 'endOfRound';

export interface RoundPhaseSpec {
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

/**
 * Effective stats (R8, spec 1.3). Every formula reads a ship's stats through one rule:
 *
 *   effective(stat) = (base + sum(flat)) * (1 + sum(percent) / 100) * product(1 + penalty / 100)
 *
 * Percent effects from modules, ship-scope and fleet-scope skills are summed; each
 * skill penalty multiplies on its own (a gate, not a modifier). Fleet-scope effects
 * drop out while the fleet is disrupted (conflict_specification.md 4.3).
 *   field       base is the hull field of the same name
 *   multiplier  no hull field; base 1
 *   additive    no hull field; base 0, flat values in `unit`, percent values as points
 */
export type StatKind = 'field' | 'multiplier' | 'additive';

export interface EffectiveStatRule {
  kind: Exclude<StatKind, 'field'>;
  /** How a FLAT module value is written: `points` (-11.5 = -0.115) or `fraction`. */
  unit: 'points' | 'fraction' | null;
  /** Upper bound on the resulting fraction, for additive stats that need one. */
  cap?: Fraction01;
}

/** Source of truth: STAT_KIND and ADDITIVE_CAPS in tools/combat_tables.py. */
export type EffectiveStatRules = Readonly<Record<string, EffectiveStatRule>>;

/** One stat's resolution, kept for the log so a number can be traced to its sources. */
export interface EffectiveStatResolution {
  stat: string;
  base: number;
  flat: number;
  /** Summed percent from modules + ship skills + fleet skills (0 for fleet while disrupted). */
  percent: number;
  /** Each active skill penalty's factor, e.g. [0.5] for Ballistic below level 5. */
  penaltyFactors: number[];
  value: number;
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
 * What a ship commits to for the whole round during `signatureDeclaration`.
 * `runningSilent` is a real tactical choice, not a modifier: it halves signature
 * but costs 30% top speed AND forbids weapons fire that round.
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

/** A per-round state modifier, stacked multiplicatively on the base signature. */
export interface SignatureStateModifier {
  state:
    | 'weaponsFiredThisRound'
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
  /** What the state buys in the movement phase (R6): afterburner x1.25 on both. */
  boost?: { topSpeedFactor: number; accelerationFactor: number };
}

export interface SignatureResolution {
  base: number;
  applied: SignatureStateModifier[];
  final: number;
}

/**
 * Lock quality is not binary — it builds. A newly locked target starts at 0.5 and
 * gains +0.25 per round of continuous tracking, capping at 1.0 after two full
 * rounds. Breaking range/line-of-sight, or the target going silent, resets it to 0.
 */
export interface LockState {
  locked: boolean;
  /** 0 (no lock), 0.5 (fresh), up to 1.0 (fully built). Multiplies hit chance. */
  lockQuality: Fraction01;
  roundsTracked: number;
}

/**
 * Ruled (R9):
 *   effectiveDetectionRange = effective(detectionRange) * sensorCondition
 *                             * effective(sensorArray.effectiveness) * signatureFactor
 *   signatureFactor = clamp((targetSignature / 16) ^ 0.5, 0.25, 4.0)
 * Calibrated on every lock claim in the repo (LOCK_CLAIMS in tools/combat_tables.py).
 */
export interface DetectionResolution {
  /** The attacker's effective(detectionRange) — sensors.detectionRange plus radar/CIC/datalink and Scanning. */
  detectionRange: Distance;
  /** componentCurrentHP.sensorArray / sensorArray.maxHP; 0 while disabled or destroyed. */
  sensorCondition: Fraction01;
  /** effective(sensorArray.effectiveness). */
  sensorEffectiveness: number;
  targetSignature: number;
  /** clamp((targetSignature / 16) ^ 0.5, 0.25, 4.0). */
  signatureFactor: number;
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
 *     speedEvasionBonus = clamp((relativeSpeedFactor - trackingCounter * 5) / 1000, 0, 0.35)
 *     effectiveEvasion  = clamp(evasionRating + speedEvasionBonus, 0, 0.60)
 *
 * Recalibrated by R6: the old `/ 250` with tracking at face value saturated 99% of
 * catalogue matchups. `targetSpeed` is the speed the target ended phase 5 with.
 *
 * This is why low-tracking capital guns compute down to the 0.05 accuracy floor
 * against a fast destroyer, and why EMP and engine criticals matter tactically:
 * strip the target's speed to strip its evasion.
 */
export interface EvasionResolution {
  /** Target's `mobility.evasionRating`. */
  baseEvasionRating: Fraction01;
  /** The target's speed after phase 5 (`CombatantState.speed`), times (1 - turnPenalty). */
  relativeSpeedFactor: number;
  /** `0.5 * (1 - min(turnRate, 150) / 150)` if the target turned this round, else 0 (R8). */
  turnPenalty: Fraction01;
  /** `weapon.tracking * trackingFactor * attacker.effective(weaponTracking)` (R8). */
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
  /** 1000 — divisor converting the speed-vs-tracking gap into an evasion bonus (R6; was 250). */
  speedTrackingDivisor: number;
  /** 5 — tracking counts this many speed units against the target's speed (R6). */
  trackingSpeedFactor: number;
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
  /** False for mines: they never use the master hit formula. */
  rollsToHit: boolean;
  /**
   * Whether shots must survive point-defense before any hit roll. Read per WEAPON
   * from `specialEffects.includes('can_be_intercepted')`, not from the class — the
   * Interceptor Missile is a missile that is never itself intercepted.
   */
  interceptable: boolean;
  notes: string;
}

/** Every class has a profile; melee resolves as direct fire with a 1.0 modifier. */
export type WeaponHitProfiles = Record<WeaponClass, WeaponHitProfile>;

/**
 * A mine field, laid against a chosen enemy ship (the anchor). Without
 * `proximity_trigger` it is command-detonated against the anchor only; with it, it
 * fires on ANY ship — friend or foe — inside its trigger radius. Without
 * `area_denial` it is consumed by its first detonation.
 */
export interface MineDeployment {
  weaponId: WeaponId;
  ownerShipId: ShipId;
  anchorShipId: ShipId;
  /**
   * Centre of the field on the engagement line: the anchor's `position` when the
   * field was laid. It never moves (R6, spec 3.4).
   */
  position: Distance;
  /** `0.10 * range.optimal` with `proximity_trigger`; null when command-detonated. */
  proximityTriggerRadius: Distance | null;
  triggersOnFriendly: boolean;
  roundDeployed: number;
  /** 3 with `area_denial`; null when consumed on first detonation. */
  roundsRemaining: number | null;
  /** Ships already hit this round — an area_denial field fires once per ship per round. */
  detonatedThisRound: ShipId[];
  /**
   * R7: the layer (`ownerShipId`) has been destroyed or has disengaged. A command
   * field is spent at that moment; a proximity field stays on the line until it
   * detonates, runs out its area_denial rounds, or is swept. Every field expires
   * when the engagement ends.
   */
  layerGone: boolean;
}

// ================================================================
// 5b. MOVEMENT (R6) — the engagement line
// ================================================================

/**
 * Declared in phase 2 with the operating state, resolved in phase 5 (spec 1.4).
 * Pursuit is `close` on a withdrawing ship. A ship that reaches its standoff keeps
 * its speed and holds station; only `hold` gives speed up.
 */
export type MovementIntent =
  /** Brake toward speed 0, drifting along the current heading meanwhile. */
  | { kind: 'hold' }
  /** Head toward `target`; stop at `standoff` (default 0). */
  | { kind: 'close'; target: ShipId; standoff?: Distance; speedLimit?: number }
  /** Head away from `target`; stop at `standoff` (default: keep going). */
  | { kind: 'open'; target: ShipId; standoff?: Distance; speedLimit?: number }
  /** Head for the own side's rear at full speed — the only way to disengage (spec 3.7). */
  | { kind: 'withdraw'; speedLimit?: number };

/** Direction along the engagement line; each side's rear is one end of it. */
export type Heading = 1 | -1;

/**
 * One ship's move in phase 5. Ships move one at a time in ascending initiative
 * order, each reading the positions already updated this phase.
 *
 *   maxSpeed  = effective(topSpeed) x state factors
 *   speedStep = effective(acceleration) x ROUND_TIME (x1.25 under afterburner)
 *   v0        = min(speed, maxSpeed); on a reversal v0 *= 1 - turnPenalty
 *   v1        = v0 moved toward the intent's speed by at most speedStep
 *   along     = min((v0 + v1) / 2 x ROUND_TIME, need)
 */
export interface MovementResolution {
  shipId: ShipId;
  intent: MovementIntent;
  maxSpeed: number;
  speedStep: number;
  speedBefore: number;
  speedAfter: number;
  headingBefore: Heading;
  headingAfter: Heading;
  /** The heading reversed while the ship was under way — feeds spec 2.4's turn penalty. */
  turnedThisRound: boolean;
  positionBefore: Distance;
  positionAfter: Distance;
  /** Proximity mine fields this move tripped, in the order it reached them. */
  minesTriggered: Pick<MineDeployment, 'ownerShipId' | 'weaponId' | 'position'>[];
}

export interface MovementConstants {
  /** 4 — time units per round: displacement = speed x 4, speed change <= acceleration x 4. */
  roundTime: number;
  /** 5 — no hull may take longer than this many rounds to reach top speed from rest. */
  maxRoundsToTopSpeed: number;
  /** maxSpeed multipliers; they multiply together. */
  runningSilentSpeedFactor: number;
  /** topSpeed AND acceleration under afterburner. */
  afterburnerFactor: number;
  /** speed and turnRate while the engines component is disabled or destroyed. */
  engineCriticalFactor: number;
  intents: readonly MovementIntent['kind'][];
}

/**
 * How an engagement opens (spec 1.4). The side with the longer first-lock range
 * chooses the distance, anywhere from the other side's first-lock range to its own.
 */
export interface EngagementOpening {
  firstLockRange: Record<string, Distance>;
  seesFirst: string | null;
  openingDistance: Distance;
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
  /** `min(fireRate.shotsPerRound, ammo)`. */
  volleySize: number;
  ammoBefore: AmmoCapacity;
  ammoAfter: AmmoCapacity;
  /** Missiles lost to the point-blank arming check. */
  armingFailures: number;
}

/**
 * Interception attempts are POOLED across all incoming projectiles at the defending
 * ship this round — not allocated per launcher. This is what makes saturation
 * work: more warheads than pooled PD shots means leakage regardless of per-missile
 * intercept odds.
 *
 *   interceptChance = clamp(pd.baseHitChance + pd.tracking * trackingFactor / 150
 *                           + interceptChanceDelta - projectileEvasion, 0.05, 0.95)
 */
export interface InterceptionAttempt {
  /** The pool weapon making the attempt; null for an escorting craft (spec 2.6). */
  pdWeaponId: WeaponId | null;
  /**
   * `pool` — the target's own pool; `cover` — a pool weapon on another ship assigned
   * to cover the target (spec 2.5: missiles and craft alike, while the two ships are
   * within that weapon's `range.optimal`); `escort` — a craft escorting the target,
   * attempting as an anti_air pool weapon (spec 2.6, craft only).
   */
  source: 'pool' | 'cover' | 'escort';
  /** The ship whose weapon or escort made the attempt. */
  fromShipId: ShipId;
  escortSquadronId?: string;
  /** What the attempt engaged. Craft are projectiles here, at `CraftProfile.interceptEvasion`. */
  targetKind: 'missile' | 'craft';
  targetIndex: number;
  /** 1.25 when the pool weapon carries `high_tracking`, else 1. */
  trackingFactor: number;
  /** +0.10 from `anti_missile` (vs missiles), `anti_air` (vs craft) or `proximity_trigger`. */
  interceptChanceDelta: number;
  interceptChance: Fraction01;
  roll: number;
  intercepted: boolean;
}

/** A HIGHER projectile evasion is HARDER to intercept. */
export interface MissileEvasionConstants {
  /** 0.20. */
  base: Fraction01;
  /**
   * +0.10 when the missile carries `high_tracking`. The v2 JSON once had -0.10,
   * which made tracking missiles easier to intercept; tools/verify_combat.py now
   * fails on any negative projectile-evasion delta.
   */
  highTrackingDelta: number;
  /** +0.05 on each missile of a `multi_hit` volley. */
  multiHitDeltaPerMissile: number;
}

export interface MissileResolution {
  volley: MissileVolley;
  /** Total pooled PD shots the defender had available this round, cover from other ships included (spec 2.5). */
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
  /** Weapons carrying `point_defense`, `anti_missile` or `anti_air`, assigned to the pool. */
  pdWeapons: WeaponId[];
  /** Sum of their `shotsPerRound`, minus disabled hardpoints. */
  pooledShotsPerRound: number;
  /** True when `pooledShotsPerRound === 0`. */
  undefendedAgainstMissiles: boolean;
}

// ================================================================
// 6b. STRIKE CRAFT (R7)
// ================================================================

/**
 * Fighters and drones (spec 2.6). Neither is a weapon: no hardpoint, no range band,
 * no lock of its own, and no direct-fire weapon can aim at one. The interception
 * pool and escorting craft engage them, only in a round they attack.
 */
export type CraftKind = 'fighter' | 'drone';

/** Source of truth: CRAFT_PROFILES in tools/combat_tables.py. */
export interface CraftProfile {
  /** A ship carries floor(effective(capacityStat)) craft of this kind. */
  capacityStat: 'aircraftCapacity' | 'droneCapacity';
  /** Distance per time unit, x effective(speedStat) when there is one; covers speed x ROUND_TIME a round. */
  speed: number;
  speedStat: 'squadronSpeed' | null;
  /** The craft's projectileEvasion in the spec 2.5 interceptChance, x effective(evasionStat). */
  interceptEvasion: number;
  evasionStat: 'squadronEvasion' | null;
  baseHitChance: Fraction01;
  /** Fighter: the carrier's squadronAccuracy. Drone: the controller's weaponAccuracy[drone], gated by the Drones skill. */
  accuracyStat: 'squadronAccuracy' | 'weaponAccuracy';
  /** Drone: the controller's weaponDamage[drone]. Fighters have none. */
  damageStat: 'weaponDamage' | null;
  /** The skill class scoping accuracyStat / damageStat; null for fighters, which have no Weaponry skill. */
  weaponClass: Extract<SkillWeaponClass, 'drone'> | null;
  /** The weaponHitProfiles entry the attack reads. */
  hitProfile: Extract<WeaponClass, 'missile' | 'kinetic'>;
  /** Against the target's speed in spec 2.4, and in an escort's interception attempt. */
  tracking: number;
  damage: { base: number; variance: number; damageType: DamageType };
  criticalChance: Fraction01;
  /** 1: one attack run, then the squadron returns. null: attacks every round it is on its target. */
  attacksPerSortie: number | null;
  /** Stowed at the start of an engagement: first launch in round 1 + this. */
  coldStartRounds: number;
  /** Recovered in round r: launches again from round r + this. */
  turnaroundRounds: number;
  /** Per craft, in manufactured-resource units by lane; restocked in phase 12. */
  restockCost: LaneQuantity;
}

export type CraftProfiles = Record<CraftKind, CraftProfile>;

/** Declared in phase 2 with the carrier's own intent; resolved in phase 5. */
export type CraftIntent =
  /** Fly to an enemy ship; attack if the squadron ends phase 5 on it. */
  | { kind: 'strike'; target: ShipId; targetedComponent?: ComponentName }
  /** Fly to a friendly ship and stay; each craft adds one anti_air attempt a round to its pool. */
  | { kind: 'escort'; ship: ShipId }
  /** Fly to the carrier; recovered if it ends phase 5 there. */
  | { kind: 'return' };

export interface StrikeCraftConstants {
  /** 6 — Veritas/Cinder: "2 squadrons (12 fighters)". */
  squadronSize: number;
  intents: readonly CraftIntent['kind'][];
  /** A full complement never costs more than this share of its hull's buildCost. */
  wingCostShareMax: Fraction01;
}

/**
 * One airborne squadron: up to SQUADRON_SIZE craft of one kind, formed at launch.
 * It lives on the engagement line until it is recovered or its last craft is lost.
 */
export interface Squadron {
  squadronId: string;
  kind: CraftKind;
  /** The ship that launched it, or the friendly deck it is bound for after its carrier left. */
  carrierShipId: ShipId;
  /** Craft still flying; 1..SQUADRON_SIZE. */
  craft: number;
  intent: CraftIntent;
  /** On the engagement line (spec 1.4); squadrons move after every ship has moved. */
  position: Distance;
  roundLaunched: number;
  /** A fighter takes `return` once this reaches attacksPerSortie. */
  attacksMade: number;
}

/**
 * One kind of craft aboard one ship. RUNTIME STATE THAT OUTLIVES THE BATTLE: losses
 * carry into the next engagement until the hangar is restocked in phase 12.
 */
export interface HangarState {
  kind: CraftKind;
  /** floor(effective(capacityStat)). */
  capacity: number;
  /** Aboard and ready to launch. */
  ready: number;
  /** Aboard but not yet launchable: stowed at the start of the engagement, or rearming. */
  readying: { readyFromRound: number; craft: number }[];
}

/** Phase 7: every craft attacking one ship this round is one wave. */
export interface CraftWaveInterception {
  target: ShipId;
  squadronIds: string[];
  craftIn: number;
  attempts: InterceptionAttempt[];
  /** Includes the extra craft area_denial downs on each success. */
  downed: number;
  survived: number;
}

/**
 * Phase 8: one surviving craft's attack.
 *   baseChance     = baseHitChance x hitProfile.baseHitChanceModifier x accuracyMultiplier
 *                    (- 0.20 when a component is targeted)
 *   finalHitChance = clamp(baseChance - evasion x (1 - evasionIgnoredFraction)
 *                          + target.effective(enemyHitChance), 0.05, 0.95)
 * No range band, no arming check, lock quality 1, no crew term.
 */
export interface CraftAttackResolution {
  squadronId: string;
  kind: CraftKind;
  target: ShipId;
  accuracyMultiplier: number;
  baseChance: Fraction01;
  evasion: EvasionResolution;
  targetEnemyHitChance: number;
  finalHitChance: Fraction01;
  roll: number;
  hit: boolean;
  damage: DamageResolution | null;
  critical: CriticalResolution | null;
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
 *                  + attacker.crew.gunnerySkill / 200        [R2, carried forward from v1]
 *  7. component-targeted? baseChance -= 0.2                  [R2, carried forward from v1]
 *  8. preLockChance = baseChance * rangeMultiplier * lockQuality
 *                     * componentAccuracyMultiplier           [R5, v1's sensorDebuff]
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
  /** After the profile modifier, the accuracy multiplier and the gunnery-skill term. */
  baseChance: Fraction01;
  /** attacker.effective(weaponAccuracy) for this weapon class — the Weaponry gate lives here (R8). */
  accuracyMultiplier: number;
  gunnerySkillBonus: Fraction01;
  componentTargetingPenalty: number;
  /**
   * Product over the attacker's disabled or destroyed components of
   * sensorArray 0.60 and bridge 0.50; 1 when both are intact.
   */
  componentAccuracyMultiplier: Fraction01;
  preLockChance: Fraction01;
  blindFireApplied: boolean;
  /** target.effective(enemyHitChance), a fraction <= 0, added after evasion (R8). */
  targetEnemyHitChance: number;
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
  /** sensorArray 0.60, bridge 0.50 — COMPONENT_ACCURACY_CRITICALS. */
  componentAccuracyCriticals: Partial<Record<ComponentName, Fraction01>>;
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
  /** Includes attacker.effective(weaponDamage) for the weapon's class (R8). */
  rawDamage: number;
  varianceRoll: number;
  damageMultiplier: number;
  /** target.effective(damageReduction), applied to post-armour hull damage only (R8). */
  damageReductionApplied: Fraction01;
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
 * Where a special effect acts. A weapon occupies the contexts its class and its
 * other effects give it:
 *   hit         the damage step of a shot that landed (incl. a mine detonation)
 *   projectile  the shot as a target of the interception sub-phase
 *   intercept   the weapon firing inside the interception pool
 *   mine        a laid field: when it detonates and how long it lasts
 */
export type SpecialEffectContext = 'hit' | 'projectile' | 'intercept' | 'mine';

/**
 * One effect in one context. Every (effect, context) pair the catalogue produces is
 * one of these three — tools/verify_combat.py fails on a pair that is none of them,
 * so an implementer never has to invent a rule silently.
 */
export type SpecialEffectContextRule =
  /** A ruled behaviour: its numeric parameters plus a one-line statement. */
  | ({ rule: string } & Record<string, number | boolean | string | readonly string[]>)
  /** The effect does nothing new in this context, and says why. */
  | { inert: string }
  /** The context resolves through another context's rule (a mine detonation -> hit). */
  | { as: Exclude<SpecialEffectContext, 'mine'>; why: string };

/** Source of truth: SPECIAL_EFFECT_RULES in tools/combat_tables.py. */
export type SpecialEffectRule = Partial<Record<SpecialEffectContext, SpecialEffectContextRule>>;

export type SpecialEffectRules = Record<WeaponSpecialEffect, SpecialEffectRule>;

// ================================================================
// 9. CRITICALS
// ================================================================

export type CriticalKind =
  /** 1-30: -10% to a random stat for 2 rounds. */
  | 'minorSystemDamage'
  /** 31-60: targeted component takes 25% of its maxHP as bonus damage. */
  | 'bonusComponentDamage'
  /** 61-85: targeted (or random) component disabled for 1 round. */
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
  /** Rolled against `weapon.criticalChance + attacker.effective(criticalChanceBonus)`. */
  triggered: boolean;
  d100: number | null;
  /** The band as rolled, before damage control. */
  rolledKind: CriticalKind | null;
  /**
   * min(0.75, criticalEventResistance + crew.engineeringSkill / 200). A success
   * downgrades one band; below minorSystemDamage the critical has no effect (R8).
   */
  resistChance: Fraction01 | null;
  downgraded: boolean;
  /** The band applied — null when a minor critical was resisted away. */
  kind: CriticalKind | null;
  /** The targeted component, or a randomly chosen one if none was targeted. */
  component: ComponentName | null;
  /** Both battle logs treat this as the "moment" roll — always a tier-1 narrative event. */
  catastrophic: boolean;
}

/**
 * A time-boxed effect on a combatant: a minor crit, an EMP suppression, a disable,
 * a melted armour plate. `emp_disable` produces two entries — recharge suppressed and
 * a 0.70 topSpeed debuff — both 2 rounds, refreshed rather than stacked.
 */
export interface StatusEffect {
  kind:
    | 'statDebuff'
    | 'componentDisabled'
    | 'componentDestroyed'
    | 'shieldRechargeSuppressed'
    /** `armor_melt`: cumulative, floored at 50% of base, lasts the engagement. */
    | 'armorMelted';
  source: { weaponId: WeaponId; attacker: ShipId };
  target: ComponentName | null;
  magnitude?: number;
  /** Null for permanent effects (a catastrophic critical lasts until dock repair). */
  roundsRemaining: number | null;
}

// ================================================================
// 10. END OF ROUND, DESTRUCTION, VICTORY
// ================================================================

export interface ShieldRechargeResolution {
  /** `shieldsCurrentHP < effective(shields.maxHP) && roundsSinceLastHit >= effective(shields.rechargeDelayAfterHit)`. */
  eligible: boolean;
  roundsSinceLastHit: number;
  /** `effective(rechargeRatePerRound)` (spec 3.2): shield boosters, Energy Shields, Defensive Formation. */
  amount: number;
  suppressed: boolean;
}

export type DestructionCause =
  /** `hullCurrentHP <= 0` — the explosion may splash nearby ships. */
  | 'hullDestroyed'
  /** `lifeSupport` destroyed AND `crewCurrent === 0`. */
  | 'crewLoss';

/**
 * Ruled (R4): a hull at or below 30% attempts to break off. v1 said below 15% AND
 * with no weapons operational; both battle logs withdraw in the 30-33% band with
 * guns still firing, and the logs won. The number is stated once, as
 * RETREAT_THRESHOLD in tools/gameplay_tables.py.
 */
export interface RetreatPolicy {
  /** 0.30. At or below it, the ship's intent is `withdraw` from the next round on. */
  hullFractionThreshold: Fraction01;
  /** v1's extra condition, dropped by R4. */
  requiresNoWeaponsOperational: false;
  source: 'gameplay_tables.RETREAT_THRESHOLD';
  /**
   * R6: a withdrawing ship disengages at the end of a round in which no enemy holds a
   * lock on it. At the round cap every ship still present disengages.
   */
  disengagesWhen: 'noEnemyLock';
}

export type VictoryCondition =
  | { kind: 'annihilation'; note: 'all enemy ships destroyed or retreated' }
  | { kind: 'objective'; description: string; rounds?: number };

// ================================================================
// 11. RUNTIME COMBATANT STATE
// ================================================================

/**
 * The mutable half of a ship during a battle. The `Ship` entity is the build
 * sheet; this is what changes round to round. Each `*Current` value starts at its
 * catalogue maximum, or at the `FleetHull` value (gameplay.ts) for a hull that enters
 * damaged. Kept separate so the catalogue stays
 * immutable and a battle can be replayed from a log against a pristine roster.
 */
export interface CombatantState {
  shipId: ShipId;
  /** The immutable build sheet this combatant was instantiated from. */
  ship: Ship;
  fleet: string;
  /** While true, fleet-scope skill effects are excluded from effectiveStats (conflict 4.3). */
  fleetDisrupted: boolean;
  tier: ShipTier;

  hullCurrentHP: number;
  shieldsCurrentHP: number;
  componentCurrentHP: Record<ComponentName, number>;
  crewCurrent: number;
  powerCurrent: number;

  /** Remaining rounds per mount; `'infinite'` mounts never decrement. */
  ammoRemaining: Record<HardpointId, AmmoCapacity>;
  /** Rounds left before a mount may fire again; set from `fireRate.cooldownRounds` after a volley. */
  cooldownRemaining: Record<HardpointId, number>;
  /** Mounts knocked out by a `weaponSystems` critical. */
  disabledHardpoints: HardpointId[];
  disabledSlots: ModuleSlotId[];

  operatingState: OperatingState;
  /** R6: this round's declared movement intent; forced to `withdraw` at or below the retreat threshold. */
  intent: MovementIntent;
  /** R6: position on the engagement line, in weapon-range units. */
  position: Distance;
  /** R6: current speed, after this round's movement phase. Spec 2.4 reads it as targetSpeed. */
  speed: number;
  heading: Heading;
  /** R6: the heading reversed while under way in this round's movement phase. */
  turnedThisRound: boolean;
  signature: SignatureResolution;
  volleysFiredThisRound: number;
  roundsSinceLastHit: number;

  /** Lock this ship holds on each opponent — keyed by the opponent's id. */
  locks: Record<ShipId, LockState>;

  /** R7: craft aboard, per kind this ship can carry. Persists between engagements. */
  hangars: Partial<Record<CraftKind, HangarState>>;
  /** R7: squadrons this ship launched (or will recover) that are in the air. */
  squadronsAirborne: Squadron[];
  /**
   * Pool weapons assigned this round to cover another friendly ship (spec 2.5), keyed
   * by hardpoint. Against missiles and craft alike; lapses for the round while the
   * covered ship is beyond the weapon's `range.optimal`.
   */
  coverAssignments: Record<HardpointId, ShipId>;
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
  round: number;
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
  round: number;
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

export interface RoundLog {
  round: number;
  /** Initiative order resolved this round. */
  initiativeOrder: ShipId[];
  events: CombatEvent[];
}

export interface BattleLog {
  battleId: string;
  /** Every entry needed to replay: roster, seed, granularity. */
  rosters: Record<string, ShipId[]>;
  rngSeed: number;
  granularity: ResolutionGranularity;
  rounds: RoundLog[];
  result: BattleResult;
}

export interface BattleResult {
  victor: string | null;
  victoryCondition: VictoryCondition;
  losses: Record<string, ShipId[]>;
  survivors: Record<string, ShipId[]>;
  roundsElapsed: number;
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
  /** One header per round in small actions; one per multi-round phase in large ones. */
  heading: string;
  /** For large actions the phase name is doctrine commentary, not just a label. */
  phaseName?: string;
  rounds: number[];
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
 * Every inconsistency or gap that needs an explicit decision before implementation,
 * rather than being silently resolved differently by whoever builds it. R1-R5 came
 * from cross-referencing the three source files; R6-R9 surfaced while ruling them.
 * Ruled entries are recorded in combat_logic_specification.md 5.1, open ones in 5.2.
 * tools/verify_combat.py asserts R1-R5 stay ruled and every open one is listed;
 * tools/verify_gameplay.py lets a stat stay unformulated only while its ruling is open.
 */
export interface OpenRuling {
  id: string;
  topic: string;
  sources: string[];
  conflict: string;
  recommendation: string;
  status: 'open' | 'ruled';
  /** Present once ruled: what was decided and where it landed. */
  ruling?: string;
}

export const OPEN_RULINGS: readonly OpenRuling[] = [
  {
    id: 'R1',
    topic: '`extends` points at a file that does not exist',
    sources: ['Combat-logic/advanced_combat_system.json'],
    conflict:
      '_meta.extends named "combatResolution from spaceship_combat_system.json"; no such file exists. The actual base is data-template.json -> combatResolution.',
    recommendation: 'Rename the reference at the source.',
    status: 'ruled',
    ruling: '_meta.extends now reads "data-template.json -> combatResolution"; the verifier resolves it.',
  },
  {
    id: 'R2',
    topic: 'Gunnery skill and the component-targeting penalty',
    sources: ['data-template.json -> combatResolution.hitChanceFormula', 'advanced_combat_system.json -> masterHitChanceFormula'],
    conflict:
      "v1 includes attacker.gunnerySkill/200 and a -0.2 component-targeting penalty; v2's pseudocode omitted both.",
    recommendation:
      'Both still apply — v2 extends rather than replaces v1. HitChanceResolution models them explicitly at steps 6 and 7.',
    status: 'ruled',
    ruling: 'Both apply. Written into the v2 JSON as masterHitChanceFormula steps 8a and 8b; spec 2.1 steps 6-7.',
  },
  {
    id: 'R3',
    topic: 'Most specialEffects had no numeric rule',
    sources: ['Data-Templates/weapon.interface', 'data-template.json -> specialEffectOverrides'],
    conflict:
      'Only ignores_shields_partial and armor_piercing were specified. emp_disable, multi_hit, shield_disrupt, area_denial, anti_air, high_tracking, proximity_trigger, armor_melt, anti_missile, point_defense and can_be_intercepted were used narratively but unbacked.',
    recommendation:
      'Define numeric behaviour per effect; the battle logs already assume mechanics (2-round shield-recharge suppression from EMP) the schema did not provide.',
    status: 'ruled',
    ruling:
      'All 13 effects ruled per context in tools/combat_tables.py SPECIAL_EFFECT_RULES; spec 3.4. The high_tracking interception sign was inverted and is corrected.',
  },
  {
    id: 'R4',
    topic: 'Retreat threshold',
    sources: ['data-template.json -> destructionConditions', 'both battle logs'],
    conflict: 'Schema said hull < 15%; both logs trigger withdrawal in the 30-33% band.',
    recommendation: 'Move the canonical threshold to ~30% rather than leaving the sources disagreeing.',
    status: 'ruled',
    ruling:
      "30% hull, no weapons condition. Stated once as RETREAT_THRESHOLD in tools/gameplay_tables.py; data-template.json stays the untouched upstream reference and the override is recorded in the v2 JSON's v1Overrides.",
  },
  {
    id: 'R5',
    topic: 'sensorDebuff is undefined',
    sources: ['data-template.json -> combatResolution.hitChanceFormula'],
    conflict: "v1's formula includes a sensorDebuff term with no formula given anywhere.",
    recommendation:
      "Fold it into the existing sensorArray critical effect ('-40% hit chance') rather than inventing a second debuff.",
    status: 'ruled',
    ruling:
      'It is the sensorArray critical: preLockChance x0.60 while the sensor array is disabled or destroyed (bridge x0.50 the same way). Spec 2.1 step 8.',
  },
  {
    id: 'R6',
    topic: 'Movement model',
    sources: ['combat_logic_specification.md 1.1 phase 5', 'advanced_combat_system.json -> updatedRoundStructure'],
    conflict:
      'Phase 5 says "resolve positioning" and nothing more. No rule turns topSpeed, acceleration and turnRate into a change in distance per round, yet range bands, melee and mine fields all read that distance.',
    recommendation: 'Define how distance changes per round from mobility stats and declared intent (close / hold / open).',
    status: 'ruled',
    ruling:
      'One engagement line: every ship and mine field has a position; intents hold / close / open / withdraw; ROUND_TIME 4 (speed x 4 per round, acceleration x 4 per round), calibrated on Sable/Ember; reversal is the turn. The side that locks first chooses the opening distance. Withdrawal succeeds when no enemy holds a lock. Speed-evasion recalibrated to (speed - tracking x 5) / 1000. Spec 1.4, 2.4, 3.4, 3.7; verify_combat.py recomputes every logged range progression.',
  },
  {
    id: 'R7',
    topic: 'Strike craft resolution',
    sources: ['battle_log_veritas_vs_cinder.md', 'tools/gameplay_tables.py STAT_RULES'],
    conflict:
      'Fighters and drones decide the Veritas/Cinder action, and aircraftCapacity, droneCapacity and the squadron* stats point at spec 2.5, but no rule says how a squadron launches, attacks, takes losses or rearms.',
    recommendation: 'Define squadron launch, attack, loss and rearm rules; craft already enter the interception pool.',
    status: 'ruled',
    ruling:
      'Craft are not weapons: fighter and drone profiles (CRAFT_PROFILES), squadrons of 6. Fighters are stowed 4 rounds and turned round in 2, move 1,000 x squadronSpeed on the engagement line after the ships, are intercepted at 1.10 x squadronEvasion (with cover from neighbouring pool weapons and escorts) and attack once on the missile profile at 0.65 x squadronAccuracy for 115 explosive. Drones read the Drones skill and its x0.50 gate through weaponAccuracy / weaponDamage [drone]. Losses carry over; craft are restocked from manufactured resources in phase 12. Command mine fields die with their layer, proximity fields outlive it, no field outlives the battle. Spec 2.6; verify_combat.py recomputes the Veritas/Cinder strikes.',
  },
  {
    id: 'R8',
    topic: 'Skill and module stats absent from the formulas',
    sources: ['tools/gameplay_tables.py STAT_RULES', 'tools/verify_gameplay.py'],
    conflict:
      'weaponAccuracy, weaponDamage, weaponTracking, enemyHitChance, criticalChanceBonus, pointDefenseBonus, damageReduction, criticalEventResistance and electronicSystemsEffectiveness were routed to sections of the combat spec, but no formula there contained them, including the Weaponry skills\' -50% penalty below level 5. The verifier checked only that the document existed.',
    recommendation:
      'Name the term each stat modifies in the hit, damage and critical formulas, and make verify_gameplay.py check that the cited section actually names the stat.',
    status: 'ruled',
    ruling:
      'One stacking rule (spec 1.3): (base + flat) x (1 + summed percent) x each penalty on its own. Every combat stat is named in the formula it modifies; acceleration and the strike-craft stats were parked on R6/R7, both since ruled. verify_gameplay.py now fails when a cited section does not name its stat.',
  },
  {
    id: 'R9',
    topic: 'Detection formula is on the wrong scale',
    sources: ['combat_logic_specification.md 2.3', 'advanced_combat_system.json -> signatureSystem.detectionAndLockOn'],
    conflict:
      'effectiveDetectionRange = sensorArray HP x effectiveness x signature/100 gives a Motor Torpedo Boat ~0.2 units of lock range and a Battleship ~70,000, against weapon ranges of 300-4,500. Every hull carries a sensors.detectionRange (260-1,495) the formula never reads.',
    recommendation:
      'Anchor lock range on effective(detectionRange), scaled by sensor condition and a bounded signature factor, and re-check the v2 worked example against it.',
    status: 'ruled',
    ruling:
      'Anchored on effective(detectionRange) x sensor condition x effective(sensorArray.effectiveness) x clamp(sqrt(signature / 16), 0.25, 4.0). Calibrated on the v2 worked example and Sable/Ember round 2; verify_combat.py recomputes every claim.',
  },
];
