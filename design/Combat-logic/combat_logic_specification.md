# Fleet Combat Doctrine — Combat Logic Specification

**Sources analyzed**
- `data-template.json` → `combatResolution` (v1.0, "Spaceship Combat System - Data Design" — base resolution loop, hit formula, damage formula, critical table)
- `Combat-logic/advanced_combat_system.json` (v2.0, "Advanced Combat Resolution System" — extends v1 with range bands, signature/detection, speed-evasion, missiles/point-defense)
- `Combat-logic/battle_log_sable_vs_ember.md` (5-vs-7 skirmish, resolved shot-by-shot)
- `Combat-logic/battle_log_veritas_vs_cinder.md` (13-vs-17 fleet action, resolved phase-by-phase)
- `Data-Templates/weapon.interface`, `ship.interface`, `module.interface` (schema/generation notes)

This document reconciles the two combat-resolution layers into one authoritative spec covering how a round rolls out, how hit chance is computed, how damage is computed, and how to log combat so it reads with the same excitement as the two hand-written battle logs. Section 5 records the rulings on contradictions between the source files, and the gaps still open.

**Numbers.** Every figure a ruling or a special-effect rule introduces lives in `tools/combat_tables.py`. This document explains them; `tools/verify_combat.py` checks that the two, the v2 JSON and the weapon catalogue agree.

**Vocabulary.** A **round** is one exchange inside a battle; a whole engagement fits inside phase 9 of one 24-hour **turn** (`GamePlay/gameplay_specification.md` §3). Every field, stat and type that counts rounds says so — `shotsPerRound`, `cooldownRounds`, `rechargeRatePerRound`, `power.regenPerRound`, `hull.regenPerRound`, `updatedRoundStructure` — and `shields.rechargeDelayAfterHit` is in rounds too. A name that says turn means the 24-hour turn: `repairRatePerTurn` is a between-battle tender rate (`GamePlay/logistics_specification.md` §4). `turnRate` and the turn penalty (§2.4) are about heading, not the clock. `tools/verify_naming.py` keeps the list.

**Catalogue vs. live state.** A hull in the catalogue carries only its fixed maxima (`hull.maxHP`, `shields.maxHP`, `power.maxPower`, `crew.maxCrew`, each component's `maxHP`). The values a battle changes live in `CombatantState` (`Reference/combat.ts`): `hullCurrentHP`, `shieldsCurrentHP`, `componentCurrentHP`, `crewCurrent`, `powerCurrent`. Between battles a hull's damage is carried by its fleet entry (`FleetHull` in `Reference/gameplay.ts`).

---

## 1. Combat Rollout

### 1.1 The canonical round structure

v2's `updatedRoundStructure` supersedes v1's 9-step `turnStructure` — it's a strict superset (adds signature declaration, detection/lock-on, and missile resolution as new sub-phases), and both battle logs follow it. Canonical order:

1. **Initiative** — sort all ships by `initiativeScore = effective(sensors.initiative) + effective(crew.pilotSkill) / 5 + d20`, descending (R8). v1 named "sensorArray effectiveness" here without defining it; sensor modules now reach initiative through the `initiative` stat they already carry.
2. **Signature declaration** — each ship commits this round's operating state (normal / afterburner / running-silent / shields up-down), fixing its signature via the signature system for the whole round, and its movement intent (§1.4). Carriers declare launches and every squadron's intent (§2.6).
3. **Detection phase** — for every attacker–target pair, compute `effectiveDetectionRange` and update `lockQuality` (build, hold, or reset).
4. **Power allocation** — assign the ship's power budget across weapons / shields / engines. The budget is capped at `effective(power.maxPower)`, and `effective(power.regenPerRound)` is restored at the end of every round.
5. **Movement** — every ship moves along the engagement line, one at a time in ascending initiative order (§1.4, R6). This sets the position, speed and pairwise `distance` everything downstream reads, and trips proximity mine fields (§3.4). Then craft launch, every airborne squadron moves, and craft that reach their carrier are recovered (§2.6).
6. **Targeting** — each ship picks target(s), weapon(s), and optionally a specific component, constrained by `range.maximum` and remaining ammo. A pool weapon may instead cover a friendly ship (§2.5).
7. **Missile resolution sub-phase** — ammo deduction, arming check, and point-defense interception for every missile weapon fired this round (§2.5), and interception of every strike-craft wave (§2.6). Runs *before* any hit roll.
8. **Direct-fire resolution** — for non-missile weapons, missiles that survived interception and craft attacking their target: run the hit-chance formula (§2, §2.6 for craft), then the damage formula (§3).
9. **Critical checks** — on every confirmed hit, roll on the component-critical table (§3.6).
10. **End of round** — shields recharge outside their delay window (§3.2), this round's signature bonuses expire, power regenerates, hull regenerates by `effective(hull.regenPerRound)` (§3.3), crew casualties apply (§3.6), destruction/retreat conditions are checked, withdrawing ships that no enemy locks disengage (§3.7), and fleet disruption is tested (`GamePlay/conflict_specification.md` §4.3).
11. Repeat from step 1 until a victory condition is met.

### 1.2 Resolution granularity scales with fleet size

Neither source file states this as a rule, but it's the load-bearing difference between the two battle logs, and it's worth making explicit as policy:

- `sable_vs_ember` (5 vs 7 ships) resolves **every weapon-fire event individually** — you can trace a specific torpedo volley's ammo count, a specific PD intercept, a specific hit roll.
- `veritas_vs_cinder` (13 vs 17 ships) resolves **per task-group per phase**, narrating only named-ship highlights (first kill, flagship shield collapse, a bridge critical) and summarizing the rest ("both sides trade fire, minor damage").

**Recommendation:** pick a hull-count threshold (the logs imply somewhere around 8–10 ships per side) below which the engine resolves and logs every individual shot, and above which it batches same-class-vs-same-class exchanges into one resolved outcome per phase, only breaking out individual events that clear the significance bar in §4.2. This keeps large fleet actions computationally sane without losing the moments that matter.

### 1.3 Effective stats — how skills and modules reach combat

**Ruled (R8).** Every formula in this document reads a ship's stats through `effective()`, and every skill and module effect reaches combat through one stacking rule:

```
effective(stat) = (base + Σ flat) × (1 + Σ percent / 100) × Π (1 + penalty / 100)
```

* **Sources.** Percent effects from fitted modules, ship-scope skills and fleet-scope skills are **summed**, not chained. Two +5% bonuses make +10%.
* **Penalties are gates.** Each active skill penalty multiplies on its own. The Weaponry skills' −50% below level 5 is ×0.50 whatever modules are fitted — a fire-control computer cannot buy back an untrained pilot.
* **Scoping.** An effect with `appliesTo.weaponClass` applies only to weapons of that class. One with `appliesTo.shipCategory` applies only to hulls of that category. Mines and melee have no Weaponry skill, so they take neither the penalty nor the per-level bonus — only module and fleet effects. The Drones skill's `drone` class is no catalogue weapon: it scopes drone attacks (§2.6).
* **Fleet scope.** A fleet-scope skill — Attacking Formation, Defensive Formation, Fighter Squadron Control — applies to every hull in the owning player's fleet, and **drops out while that fleet is disrupted** (`GamePlay/conflict_specification.md` §4.3).

A stat's **kind** says what `base` is. All of them are tabulated as `STAT_KIND` in `tools/combat_tables.py`.

| kind | base | stats |
|---|---|---|
| field | the hull field of the same name | `topSpeed`, `turnRate`, `evasionRating`, `hull.maxHP`, `hull.armorRating`, `hull.regenPerRound`, `shields.maxHP`, `rechargeRatePerRound`, `shields.rechargeDelayAfterHit`, `power.maxPower`, `power.regenPerRound`, `initiative`, `crew.*Skill`, `mineCapacity` (`capacities.mines`), `medicalCapacity` (`capacities.medical`), `aircraftCapacity` (`capacities.aircraft`), `droneCapacity` (`capacities.drones`) |
| multiplier | 1 | `weaponAccuracy`, `weaponDamage`, `weaponTracking`, `pointDefenseBonus`, `sensorArray.effectiveness`, `electronicSystemsEffectiveness`, `squadronSpeed`, `squadronAccuracy`, `squadronEvasion` |
| additive | 0; flat values add in the stat's unit, percent values add as points; the result is a fraction | `enemyHitChance` (flat unit: percentage points), `criticalChanceBonus`, `criticalEventResistance` (cap 0.75), `damageReduction` (cap 0.50), `crewRecoveryRate` (cap 0.90), `minesweepRate`, `fleetRegroupRate` |

The unit column exists because the module catalogue is not uniform: an ECM suite writes `enemyHitChance −11.5` in points, while a targeting computer writes `criticalChanceBonus 0.029` as a fraction. `verify_combat.py` checks every module value against its stat's unit.

**Worked example — what Ballistic Weapon training buys.** A Heavy Cruiser Tier 2 (crew `gunnerySkill` 60, no accuracy modules, no fleet skills) fires a Halcyon Railgun Mk.3 (`wpn_141`: base hit 0.84, damage 134, tracking 29) at *Whisperfang*. The destroyer is at optimal range, under way at its full 309, with a full lock. Its effective evasion is 0.23 + (309 − 29 × 5) / 1,000 = 0.23 + 0.164 = 0.394 (§2.4). Against *Leviathan Crown* the same gun would face 0.04 and no speed bonus at all, because tracking 29 covers 145 speed and the battleship makes 140.

| Ballistic level | multiplier | baseChance (0.84 × m + 60/200) | finalHitChance | damage per hit | expected per shot |
|---:|---:|---:|---:|---:|---:|
| 3 | 0.50 (gate) | 0.72 | **0.33** | 67.0 | 21.8 |
| 5 | 1.00 | 1.14 | **0.75** | 134.0 | 100.0 |
| 8 | 1.15 | 1.27 | **0.87** | 154.1 | 134.4 |

The gate is the point of the skill design. Below level 5 the same gun on the same hull does about a sixth of the damage of a level-8 pilot. A ship can be fielded at level 5 in the hull tree's numbers (`GamePlay/progression_specification.md`), but it is only *fought* well once its weapon class is trained too.

**Strike craft (R7).** `aircraftCapacity` and `droneCapacity` are field stats, the hangar a ship carries. The three `squadron*` stats are multipliers that only fighters read. All five are ruled in §2.6. No stat is parked on an open ruling any more: `acceleration` waited for R6 (§1.4), these five for R7.

### 1.4 Movement — the engagement line

**Ruled (R6).** Phase 5 moves every ship along one line. The numbers are in `tools/combat_tables.py`.

**The line.** Every ship and every mine field has a `position` on a single axis, in the same units as weapon ranges and `detectionRange`. The distance between two of them is `|position(a) − position(b)|`. A line is the least geometry that gives every rule in this document something to read. Pairwise distances stay consistent with each other, a mine field has a point to sit on, and each side has a rear to withdraw toward. Flanking, cover and line of sight are not modelled. The logs narrate them as colour: Sable/Ember's asteroid cover, and Veritas/Cinder's destroyers "cutting behind *Auric Drift*".

**Units.** Speed is distance per time unit. Acceleration is speed per time unit. A round lasts **`ROUND_TIME` = 4** time units. A ship holding speed 201 covers 804 a round, and a ship with acceleration 40 gains or sheds up to 160 speed a round. The value is calibrated on Sable/Ember rounds 1–2. SABLE holds, and EMBER's line, whose slowest hull is *Obsidian March* at 201, closes the logged 3,400 → 2,600 in one round. 4 is the smallest whole value that covers 800.

**Opening the engagement.**

* **Distance.** A side's *first-lock range* is the longest lock (§2.3) any of its ships has on any enemy ship, using the round-1 operating states. The side with the longer first-lock range sees first, and it chooses the opening distance anywhere from the other side's first-lock range up to its own. It can let the enemy come closer, but not past the point where the enemy would see it too. Equal ranges open at that range.
* **Positions.** One side starts at position 0 with its rear toward −; the other starts at the opening distance with its rear toward +. All of a side's ships start on its point.
* **Speed.** Each ship starts at the speed its round-1 intent asks for: 0 for `hold`, otherwise its `maxSpeed` or `speedLimit`, heading where that intent points. Fleets meet under way, and the starting heading is not a turn.

| log | sees first | its first lock | the other side's | logged opening |
|---|---|---:|---:|---:|
| Sable/Ember | SABLE: silent ×0.50; EMBER's shields up ×1.10 | 4,000 | 2,517 | 3,400 ✓ |
| Veritas/Cinder | VERITAS, with Scanning at level 1 | 5,253 | 5,000 | 5,200 ✓ |

Both battlecruiser lines in Veritas/Cinder lock the opposing capitals at the 4.0 cap, 5,000 each. One level of Scanning on VERITAS (+3% `detectionRange`, +2% `sensorArray.effectiveness`) is enough to see first and open at the logged 5,200: "near-simultaneous".

**Intent.** Each ship declares one intent in phase 2, together with its operating state.

| intent | takes | does |
|---|---|---|
| `hold` | — | brakes toward speed 0, drifting along its heading meanwhile |
| `close` | target, standoff (default 0) | heads toward the target and stops at the standoff |
| `open` | target, standoff (default none) | heads away from the target and stops at the standoff; with none, keeps going |
| `withdraw` | — | heads for its own side's rear at full speed; the only way to disengage (§3.7) |

Every moving intent takes an optional `speedLimit`. Formation keeping is a `speedLimit` equal to the slowest hull's `maxSpeed`, which is how EMBER's destroyers stay with its heavy cruisers in the log. Pursuit is `close` on a ship that is withdrawing. A ship that reaches its standoff **keeps its speed** and spends the rest of the round holding station, so it keeps its speed-evasion (§2.4). Only `hold` gives speed up.

**Resolving a ship's move.** Ships move one at a time in **ascending initiative order**. The highest initiative moves last and sees where everyone else ended up. For each ship:

```
maxSpeed  = effective(topSpeed) × the state factors below
speedStep = effective(acceleration) × ROUND_TIME            (× 1.25 under afterburner)
v0        = min(speed, maxSpeed)                            // a new cut bites at once
heading'  = where the intent points: toward the target, away from it, or the own rear
if heading' ≠ heading and v0 > 0:                           // a reversal
    turnedThisRound = true
    v0 ×= (1 − turnPenalty)                                 // §2.4's turnPenalty, from effective(turnRate)
vWanted   = hold ? 0 : min(maxSpeed, speedLimit)
v1        = v0 moved toward vWanted by at most speedStep
along     = min((v0 + v1) / 2 × ROUND_TIME, need)           // need: distance left to the standoff
position += heading' × along
speed     = v1
```

`need` is `distance − standoff` for `close` and `standoff − distance` for `open`, never below 0. It has no limit for `withdraw`, for `open` without a standoff, or for `hold`, which drifts while it brakes. A ship whose intent needs no movement keeps its heading, so standing still is never a turn. `close` never carries a ship past its target.

| state | `maxSpeed` | also |
|---|---|---|
| running silent | ×0.70 | the §2.3 state table's −30% top speed |
| afterburner | ×1.25 | `speedStep` ×1.25; paid for with +40% signature |
| `emp_disable` hit | ×0.70 for 2 rounds | §3.4 |
| `engines` disabled or destroyed | ×0.30 | `turnRate` ×0.30 as well: the critical's "−70% speed and turn rate" |

The factors multiply together. A silent ship hit by EMP makes 0.49 of its top speed.

**What the three stats do.**

* `effective(topSpeed)` is the ceiling, and through §2.4 the evasion.
* `effective(acceleration)` is how fast speed changes. From rest, the slowest hull in the catalogue, *Leviathan Crown* (140 / (8 × 4)), takes 4.4 rounds to reach top speed, and a Submarine Chaser takes 1.7. No hull takes more than `MAX_ROUNDS_TO_TOP_SPEED` (5).
* `effective(turnRate)` is how much speed a reversal keeps: (1 − turnPenalty). A Motor Torpedo Boat keeps 93%, a Destroyer 77%, a Battleship 59%, *Leviathan Crown* 55%.

**The logs are reachable.** Each logged range change fits inside the rounds between it at the closing sides' formation speed. `verify_combat.py` recomputes every row from the log rosters and the named-ship catalogue (`RANGE_CLAIMS`).

| log | rounds | logged change | closing | can cover |
|---|---|---:|---|---:|
| Sable/Ember | 1 → 2 | 3,400 → 2,600 (800) | EMBER at 201; SABLE holds | 804 |
| Sable/Ember | 2 → 4 | 2,600 → 1,100 (1,500) | EMBER at 201 | 1,608 |
| Veritas/Cinder | 1 → 3 | 5,200 → 3,600 (1,600) | both lines, 140 + 138 | 2,224 |
| Veritas/Cinder | 3 → 5 | 3,600 → 3,000 (600) | both lines, 140 + 138 | 2,224 |

**Melee.** A boarder declares `close` with a standoff inside its weapon's `range.optimal`. A target with the higher initiative moves after the boarder and opens the gap again before anyone fires. To board a ship that is running, a boarder needs more initiative or a target that has stopped.

---

## 2. Hit Rate Calculation

### 2.1 Reconciled master formula

v2's `masterHitChanceFormula` originally omitted two terms v1 defines — `gunnerySkill` and the −0.2 component-targeting penalty. **Ruled (R2): both apply**, because v2 *extends* v1 rather than replacing it; the v2 JSON now states them as steps 8a and 8b. v1's undefined `sensorDebuff` is **ruled (R5)** to be the `sensorArray` critical and nothing more; it enters at step 8 below as a multiplier, alongside the `bridge` critical that works the same way. Reconciled, in resolution order:

```
0. If distance > weapon.range.maximum: weapon cannot fire. Stop.
1. rangeMultiplier   = distanceSystem.rangeMultiplierFormula(distance, weapon)      [§2.2]
2. locked            = distance <= effectiveDetectionRange(attacker, target)         [§2.3]
3. lockQuality       = locked ? currentLockQuality (0.5 -> 1.0 over 2 rounds) : 0.5
4. effectiveEvasion  = speedEvasionSystem.formula(target, weapon)                    [§2.4]
5. if weapon.weaponClass == missile:
       effectiveEvasion *= (1 - 0.5)        // guided course correction ignores half the dodge
6. baseChance        = weapon.accuracy.baseHitChance
                        * weaponHitProfiles[weapon.weaponClass].baseHitChanceModifier
                        * attacker.effective(weaponAccuracy)[weapon.weaponClass]      // R8
                        + (attacker.effective(crew.gunnerySkill) / 200)               // R2, carried forward from v1
7. if targeting a specific component: baseChance -= 0.2                              // R2, v1 componentTargetingRules
8. preLockChance     = baseChance * rangeMultiplier * lockQuality
                        * componentAccuracyMultiplier                                 // R5, see below
9. if not locked: preLockChance *= 0.25                                              // blind-fire penalty
10. finalHitChance   = clamp(preLockChance - effectiveEvasion
                             + target.effective(enemyHitChance), 0.05, 0.95)         // R8
```

**Where skills enter (R8).** `weaponAccuracy` is a class-scoped multiplier (§1.3). For kinetic, energy and missile weapons it carries the Weaponry skill: ×0.50 below level 5, ×1.00 at level 5, +5% per level from 6, plus fire-control and sensor modules and Attacking Formation. `crew.gunnerySkill` is the hull's crew figure plus fire-control modules. `enemyHitChance` belongs to the **target**: ECM, decoys and smoke make it negative, so it subtracts from the attacker's chance after evasion. It is additive in percentage points, so ECM's −11.5 is −0.115.

`componentAccuracyMultiplier` is the product, over the attacker's components that are currently disabled or destroyed, of `COMPONENT_ACCURACY_CRITICALS` — `sensorArray` 0.60 (its "−40% hit chance") and `bridge` 0.50 (its "−50% accuracy"); 1.0 when both are intact. The sensor critical's other half, "reduced detection range", needs no rule of its own: `attackerSensorStrength` already derives from `sensorArray` current HP (§2.3).

Weapons carrying `can_be_intercepted` run this formula only for projectiles that survive the interception sub-phase (§2.5) — a shot-down missile never reaches step 0. Melee weapons resolve here as direct fire with a 1.0 modifier, like kinetic; v2 gave them no hit profile at all.

### 2.2 Range bands

Range is the primary hit-chance lever. Each weapon carries `range.optimal` / `range.maximum` from its own schema; the band table converts actual distance into a multiplier:

| Band | Range (% of optimal) | Hit multiplier |
|---|---|---|
| Point-blank | 0–25% | **1.10** (but see missile arming rule below) |
| Close | 25–100% | 1.00 |
| Medium | 100–150% | linear 1.00 → 0.65 |
| Long | 150%–maximum | linear 0.65 → 0.15 |
| Extreme | beyond maximum | 0 — cannot fire |

```
distance <= 0.25*optimal              -> 1.10
optimal < distance <= 1.5*optimal     -> 1.00 - 0.35*((distance-optimal)/(0.5*optimal))
1.5*optimal < distance <= maximum     -> 0.65 - 0.50*((distance-1.5*optimal)/(maximum-1.5*optimal))
distance > maximum                    -> 0, weapon cannot fire
```

Missiles fired at point-blank (<10% of optimal) have a **50% chance to fail to arm** — treated as a clean miss — because the warhead needs travel time to arm. This is the tradeoff for missiles' long-range guidance advantage.

### 2.3 Detection, signature, and lock-on

Every ship emits a `signature` derived from its own stats — it isn't a stat set directly:

```
baseSignature = mass.value * 0.05 + power.maxPower * 0.1 + shields.maxHP * 0.02
```

Per-round state modifiers stack on top:

| State | Effect |
|---|---|
| Fired a weapon volley this round | +8% signature per volley (heat/EM bloom) |
| Shields active | +10% signature (emitters are detectable) |
| Afterburner / high acceleration | +40% signature (engine flare); top speed and acceleration ×1.25 (§1.4) |
| Running silent | −50% signature, but −30% top speed and **no weapons fire this round** |
| ECM module active | −15% signature |

Detection (**ruled, R9**):

```
effectiveDetectionRange = effective(detectionRange)                                  // the hull's sensors.detectionRange
                          * componentCurrentHP.sensorArray / sensorArray.maxHP      // sensor condition
                          * effective(sensorArray.effectiveness)                     // R8
                          * clamp((targetSignature / 16) ^ 0.5, 0.25, 4.0)           // signature factor
```

If `distance <= effectiveDetectionRange`, the target is **locked**; otherwise the attacker may still fire "blind" at a steep accuracy penalty. `detectionRange` carries radar, CIC, datalink and the Scanning skill. `sensorArray.effectiveness` carries Scanning and the sonar and counter-electronics modules. A disabled or destroyed sensor array gives a condition of 0, so that ship fires blind until it is repaired. This is the "reduced detection range" half of the sensor critical, and it stacks with R5's ×0.60 accuracy half.

The formula this replaces, `sensorArray.currentHP × effectiveness × targetSignature / 100`, was on the wrong scale. It gave a Motor Torpedo Boat about 0.2 units of lock range and a Battleship about 70,000, and never read the `detectionRange` every hull carries. The exponent and reference are calibrated on the only lock claims the repo makes. Those claims admit a reference between about 4 and 17; 16 sits near the top so that signature keeps mattering for as many hulls as possible. `verify_combat.py` recomputes every row (`LOCK_CLAIMS`). Signature multipliers come from the state table above: shields ×1.10, one volley ×1.08, silent ×0.50.

| claim | source | lock range | distance | result |
|---|---|---:|---:|---|
| *Leviathan Crown* holds *Whisperfang* | v2 worked example | ≈ 2,204 | 1,900 | locked ✓ |
| *Wraithbolt* locks *Stormbreaker* | Sable/Ember round 2 | ≈ 3,725 | 2,600 | locked ✓ |
| *Stormbreaker* sees the lit *Wraithbolt* | Sable/Ember round 2 | ≈ 3,048 | 2,600 | locked ✓ |
| *Stormbreaker* sees the lit *Silverlance* | Sable/Ember round 2 | ≈ 2,698 | 2,600 | locked ✓ |
| *Stormbreaker* misses silent *Whisperfang* | Sable/Ember round 2 | ≈ 1,292 | 2,600 | unseen ✓ |
| *Stormbreaker* misses silent *Nightstrike* | Sable/Ember round 2 | ≈ 1,204 | 2,600 | unseen ✓ |
| *Silverlance* fires blind at *Corvus* | Sable/Ember round 2 | ≈ 1,733 | 2,600 | blind ✓ |

**What the shape means.** The square root and the 4.0 cap make signature matter most where it should. Against anything cruiser-sized or larger — 48 of the 78 template hulls — the cap applies and lock range is four times detection range. Big ships are loud, and running silent barely hides them. Against small hulls, signature decides everything: a silent destroyer drops below a heavy cruiser's lock at 2,600, and torpedo boats are nearly invisible to each other.

Every armed hull can lock a Battleship T1 at least as far out as its shortest-ranged weapon's optimal; the verifier checks this. Five named capitals — *Stormbreaker*, *Doomcrest*, *Meridian Aegis*, *Leviathan Crown* and *World Ender* — carry mounts with 5,000–7,900 optimal, past even a capped lock. At those ranges they fire blind, or wait for the target to close. **Locks are never shared** (decided 2026-10-03): each ship fires on its own lock or not at all, so reach beyond a ship's own lock is always blind fire.

**Electronics (R8).** `electronicSystemsEffectiveness` (the Electronics skill) is a multiplier on the **magnitude** of every effect carried by an electronic module: radar, sonar, CIC, datalink, ECM, decoy, counter-electronics, targeting computer, fire control and PD coordinator (`ELECTRONIC_MODULE_TYPES`). It also scales the ECM state's −15% signature. At level 10 an ECM suite's −11.5 points of `enemyHitChance` becomes −14.95. It never touches a non-electronic module, a skill or a hull field.


Lock quality is not binary — it builds: a newly-locked target starts at `lockQuality = 0.5` and gains `+0.25` per round of continuous tracking, capping at `1.0` after 2 full rounds. Breaking line-of-sight/range, or the target going silent, resets it to 0. Sable/Ember Round 2 shows this directly: *Silverlance* fires at *Corvus* with a fresh, unbuilt lock and misses at long range — the log attributes the miss to lock quality, not just range.

### 2.4 Speed-based evasion

Replaces a flat evasion lookup with a dynamic value driven by the *matchup* between the target's speed and the specific incoming weapon's tracking stat — the same target has different effective evasion against different weapons:

```
relativeSpeedFactor = targetSpeed * (1 - turnPenalty)
turnPenalty         = turnedThisRound ? 0.5 * (1 - min(effective(turnRate), 150) / 150) : 0
trackingCounter     = weapon.accuracy.tracking * trackingFactor
                        * attacker.effective(weaponTracking)                          // R8
speedEvasionBonus   = clamp((relativeSpeedFactor - trackingCounter * 5) / 1000, 0, 0.35)    // R6
effectiveEvasion    = clamp(target.effective(evasionRating) + speedEvasionBonus, 0, 0.60)
```

`targetSpeed` is the speed the target ended phase 5 with (§1.4). It never exceeds `effective(topSpeed)` after the state factors, and it changes by at most `effective(acceleration) × ROUND_TIME` a round (×1.25 under afterburner). A ship on `hold` brakes toward 0 and gives its speed-evasion up; a ship holding station at a standoff keeps it. `turnedThisRound` is true when the target reversed heading in phase 5 while under way (§1.4). Starting the engagement, holding station and getting under way from rest are not turns. The turn penalty, undefined in v2, is **ruled (R8)**: a nimble corvette (`turnRate` ~140) keeps almost all its speed through a turn, while a battleship (~20) gives up nearly half. While its engines are disabled or destroyed, a ship's `turnRate` counts ×0.30 here too. `trackingFactor` is 1.25 for `high_tracking` weapons (§3.4). `weaponTracking` carries Attacking Formation. `evasionRating` carries the hull Control skills, Defensive Formation, and the engine, ECM and decoy modules.

Design intent, confirmed by both battle logs: high-tracking weapons (PD lasers, pulse lasers) counter fast targets well; low-tracking weapons (railguns, mass drivers, capital ion cannons) lose most of their effective accuracy against fast ships. This is *why* SABLE's destroyers consistently dodge EMBER's slower-tracking capital guns (the JSON's own worked example has a capital Ion Cannon vs. a fast destroyer at long range compute down to the 0.05 accuracy floor), and why EMP/engine-critical hits matter tactically — they strip speed to strip evasion. Beam weapons (Beam Laser, Particle Lance) are the one exception: near-instant travel time means they ignore `speedEvasionBonus` entirely, though they still take full range falloff.

**Recalibrated (R6).** The old form, `(speed − tracking) / 250`, saturated. Catalogue speeds run 129–694 and tracking 3–131, so any target faster than a weapon's tracking + 88 got the full 0.35. That was 99% of all hull-against-weapon matchups, a 140-speed battleship against a railgun included. Tracking now counts ×5 in speed units (`TRACKING_SPEED_FACTOR`), and every 100 speed beyond what the gun covers is worth +0.10 (`SPEED_EVASION_DIVISOR` 1,000). Over every catalogue hull's top speed against every direct-fire weapon's tracking, beams and pool weapons aside, about 17% of matchups now get nothing, 73% are graded and 10% reach the cap. `verify_combat.py` recomputes those shares and fails if more than 15% saturate or fewer than half are graded.

| target (speed) | weapon (tracking) | old bonus | new bonus |
|---|---|---:|---:|
| *Leviathan Crown* (140) | Halcyon Railgun Mk.3 (29) | 0.35 | 0 |
| *Whisperfang* (309) | Halcyon Railgun Mk.3 (29) | 0.35 | 0.164 |
| *Whisperfang* (309) | Draconis PD Laser Turret Mk.5 (84, `high_tracking` → 105) | 0.35 | 0 |
| *Corvus* (377) | Vanguard Siege Ion Cannon Mk.4 (26) | 0.35 | 0.247 |
| *Corvus* (377) | Solari Pulse Laser Mk.3 (54, `high_tracking` → 67.5) | 0.35 | 0.040 |
| Motor Torpedo Boat Tier 1 (620) | Solari Pulse Laser Mk.3 | 0.35 | 0.282 |
| Motor Torpedo Boat Tier 1 (620) | Vanguard Siege Ion Cannon Mk.4 | 0.35 | 0.35 |

The design intent survives with real gradation. Capital guns still lose fast escorts, and the v2 worked example still computes to the 0.05 floor: a destroyer at 350 against tracking 12 gets 0.29, for 0.53 evasion against a 0.41 pre-lock chance. Pulse lasers and PD now actually catch destroyers, and a battleship no longer dodges anything by speed.

### 2.5 Missiles and point-defense

Missiles get **+25%** to base hit chance and only apply **50%** of the target's effective evasion — their core advantage over direct-fire weapons. The cost is ammo depletion and a mandatory interception sub-phase that runs *before* the hit roll:

1. Volley size = `min(shotsPerRound, ammo)`; ammo decrements immediately, hit or not.
2. Arming check (§2.2) if launched point-blank.
3. Only weapons carrying `can_be_intercepted` enter the sub-phase. Every defending **pool weapon** — one carrying `point_defense`, `anti_missile` or `anti_air` and left in the pool during targeting — contributes its `shotsPerRound` interception attempts, **pooled across all incoming projectiles at that ship this round** — not per-launcher. A pool weapon may cover another ship instead (**Cover**, below). The pool is `round(Σ shotsPerRound × effective(pointDefenseBonus))`, rounded half up once for the whole pool, so a PD coordinator's +15% is never lost to rounding on a single mount (R8). A finite-ammo pool weapon (the Interceptor Missile) spends 1 ammo per attempt.
4. Each attempt: `interceptChance = clamp(pd.baseHitChance + pd.tracking × trackingFactor / 150 + interceptChanceDelta − projectileEvasion, 0.05, 0.95)`. `trackingFactor` and `interceptChanceDelta` come from the pool weapon's own effects (§3.4). `projectileEvasion` is 0.20 base, **+0.10** for `high_tracking` missiles and **+0.05** on each missile of a `multi_hit` volley. Higher is harder to intercept.
5. Intercepted missiles are destroyed — no damage, no hit roll.
6. Survivors roll the master hit-chance formula with the missile profile.
7. Multiple hits from the same volley roll damage independently — each warhead is separate.

The v2 JSON used to give `high_tracking` **−0.10**, which made tracking missiles *easier* to intercept while its own note called them "harder". The sign is corrected, and `verify_combat.py` fails if any projectile-evasion delta goes negative.

**What a pool weapon engages.** `point_defense` engages missiles and strike craft at base chance; `anti_missile` engages missiles only, at +0.10; `anti_air` engages craft only, at +0.10. A weapon carrying two of them takes the union of targets and the better delta against each. A pool weapon fires *either* in the pool *or* as direct fire in a given round — it defaults to the pool, and its owner may reassign it in targeting. Strike craft enter the same pool in the round they attack; how a squadron launches, attacks and is lost is §2.6.

**Cover** (R7 and the escort ruling, unified 2026-10-03). In targeting, a pool weapon may be assigned to **cover** one friendly ship instead of defending its own. Its attempts then join the covered ship's pool, against **missiles and craft alike** — each by what the weapon engages (above) — provided the two ships are within the covering weapon's `range.optimal` of each other on the engagement line when the sub-phase runs (after phase 5 movement, §1.4). Out of reach, its attempts are lost for the round. The covered ship's pool is `round(Σ shotsPerRound × effective(pointDefenseBonus))` over every contributing weapon, each with its own ship's bonus, still rounded once, and it is split between missiles and craft as the ship's own pool is (§2.6, missiles first by default). Each attempt resolves with the covering weapon's own stats and spends its own ammo. No new number is involved.

Cover meets missiles as well as craft for two reasons. On the engagement line nothing but distance separates a covering mount from the ship it covers, and within its `range.optimal` it engages a warhead's terminal run as well as the target's own mounts do: the model has no time step inside the interception sub-phase in which a missile is "faster" than a squadron. And the game needs it: a cargo hull carries two to four small AA autocannons and no warship's PD can reach it otherwise, so an escort that could stop fighters but not torpedoes could not protect a convoy from the cheapest raider there is (`GamePlay/conflict_specification.md` §4.4). It is also what the Veritas/Cinder log presumes when it calls *Leviathan Crown* "unescorted": only its own small-slot PD responded. Escorting **craft** (§2.6) remain craft-only.

This is a deliberate rock-paper-scissors: missiles beat evasive ships, PD beats missiles, and **saturation** (more warheads than the defender's pooled PD shots can cover) beats PD. Both logs demonstrate the failure mode directly: *Halberd's Edge*'s 6-missile Swarm Pod overwhelms *Whisperfang*'s 3 PD shots (3 leak through) in Sable/Ember; at fleet scale, *Cinderwatch*'s 20-fighter saturation strike on an unescorted *Leviathan Crown* drops its shields from 1362 to ~400 in a single exchange because only its small-slot PD responds. **A ship with no PD hardpoint online is acutely vulnerable to any missile- or fighter-armed opponent** — this is the deciding factor in both logs and should be treated as a first-class tactical readout, not just a stat.

### 2.6 Strike craft

**Ruled (R7).** The numbers are in `tools/combat_tables.py` (`CRAFT_PROFILES`, `SQUADRON_SIZE`, `CRAFT_INTENTS`).

**Two kinds of craft.** Fighters and drones are both craft. Neither is a weapon: a craft has no hardpoint, no range band and no lock of its own, and no direct-fire weapon can aim at one. Only the interception pool (§2.5) and escorting craft engage them, and only in a round they attack.

| | fighter | drone |
|---|---|---|
| carried in | `aircraftCapacity` (`capacities.aircraft`) | `droneCapacity` (`capacities.drones`) |
| hangar modules, Mk.1 | Aircraft Elevator +6, ASW Aircraft Bay +3, Seaplane Catapult +2 | Drone Bay +8, Drone Controller +4 |
| speed | 1,000 × `effective(squadronSpeed)` | 600 |
| hit profile | missile: ×1.25 base, half the evasion ignored | kinetic |
| base hit chance | 0.65 × `effective(squadronAccuracy)` | 0.70 × `effective(weaponAccuracy)[drone]` |
| tracking | 90 | 70 |
| damage | 115 ± 15 explosive | 30 ± 4 kinetic, × `effective(weaponDamage)[drone]` |
| critical chance | 0.05 | 0.02 |
| evasion against interception | 1.10 × `effective(squadronEvasion)` | 1.00 |
| attacks | one run per sortie, then returns | every round it is on its target |
| first launch | round 5 (stowed 4 rounds) | round 2 (stowed 1 round) |
| turnaround after recovery | 2 rounds | 1 round |
| skill | Fighter Squadron Control (fleet scope) | Drones (Weaponry) |
| restock, per craft | 1.6 manufactured units | 1.0 manufactured units |

**Fighters and drones split the skills.** Fighter Squadron Control is the only source of `squadronSpeed`, `squadronAccuracy` and `squadronEvasion`, and only fighters read them: +1% per level to speed, attack chance and evasion against interception. Like every fleet-scope skill it drops out while the fleet is disrupted (§1.3). Fighters have no Weaponry skill and no gate. Their pilots are the skill, so no crew term enters their attack either.

The Drones skill (`skl_wpn_drones`, class `drone`) is a Weaponry skill like the other three. Drones have no catalogue weapon, so it scopes the drone attack instead: `weaponAccuracy` and `weaponDamage` with `appliesTo.weaponClass` `drone`. Below level 5 it gates both at ×0.50, whatever modules are fitted (§1.3), and from level 6 it adds +5% a level. It reaches nothing else; drone speed and evasion have no skill. An unscoped `weaponAccuracy` effect, such as Attacking Formation or a CIC Tower, applies to drones as to any class, because drones fight from their controlling ship's fire control. It does not reach fighters.

**The hangar.** A ship carries at most `floor(effective(aircraftCapacity))` fighters and `floor(effective(droneCapacity))` drones. The hull field is the base and hangar modules add their flat values, the field kind in §1.3. An Escort Carrier Tier 1 carries 20 + 6 = 26 fighters. Drones are refit-only: no template hull carries `capacities.drones` or fits a drone module, so a ship gets drones by fitting a Drone Bay or Drone Controller in a hangar slot.

**Squadrons.** Craft fly in squadrons of up to `SQUADRON_SIZE` = 6, formed at launch from ready craft of one kind. A squadron may be short, like the log's "rebuilt" ones. A complement is reported as full squadrons plus a reserve: 26 fighters are 4 squadrons with 2 in reserve. The size comes from the log, "2 squadrons (12 fighters)" and "3 squadrons (18 fighters)".

**Launch cadence.**

* Craft aboard when the engagement starts are stowed. Fighters first launch in round 1 + 4 = 5, drones in round 2.
* A craft recovered in round r launches again from round r + 2 (fighters) or r + 1 (drones). Rearming covers any number of craft at once.
* Launch and recovery happen in phase 5. There is no deck limit: every ready craft may launch in the same round. Capacity is the only limit, and that is what lets a carrier mass a saturation strike.
* A ship running silent neither launches nor recovers. Flight operations are emissions.
* A strike launches only at a ship its carrier holds a lock on in phase 3 (§2.3). Locks are never shared. Without the lock, the craft stay aboard and stay ready.

**On the engagement line.** A squadron has a position and one intent, declared in phase 2 with its carrier's own.

| intent | does |
|---|---|
| `strike` | flies to an enemy ship and attacks if it ends phase 5 there. A fighter attacks once, then takes `return`; a drone stays on the target and attacks every round |
| `escort` | flies to a friendly ship and stays with it; each craft adds one attempt a round to that ship's pool against enemy craft |
| `return` | flies to its carrier; recovered if it ends phase 5 there |

Squadrons move after every ship has moved, in their carriers' initiative order, so a strike finds its target wherever the target went. A squadron covers `speed × ROUND_TIME` a round, 4,000 for a fighter and 2,400 for a drone, and stops at its destination. It has no acceleration, no turn penalty and no signature, and it never trips a mine field.

**Interception.** In phase 7, the craft attacking one ship this round are one **wave**. Before any hit roll, the wave faces three sources of attempts:

* **The target's own pool.** Its pool weapons that engage craft (`point_defense`, `anti_air`, §2.5) draw on the same pooled attempts as against missiles. The defender splits them between missiles and craft, missiles first by default.
* **Cover.** Pool weapons other ships have assigned to cover the target and that are within reach of it, sharing the same pooled attempts with any missiles at that ship (§2.5, **Cover**).
* **Escorts.** Each craft escorting the target makes one attempt as an `anti_air` pool weapon, with its profile's base hit chance (times its accuracy multiplier) and tracking.

Each attempt is §2.5's `interceptChance` with the craft as the projectile:

```
projectileEvasion = interceptEvasion × carrier.effective(squadronEvasion)    // fighters
                  = interceptEvasion                                          // drones
```

`area_denial` downs one more craft of the same wave on each success. An intercepted craft is destroyed.

**Why 1.10 and not missiles' 0.20.** Every pool weapon that engages craft has a raw chance of 1.33–2.14 before evasion, because `tracking × trackingFactor / 150` alone is 0.39–1.09. At 0.20, every attempt would sit at the 0.95 cap and `squadronEvasion` would change nothing. At 1.10 the median such weapon hits a fighter about half the time; none of them is at the 0.05 floor, and only the Interceptor Missile Mk.4–5 reach the cap. Ten levels of Fighter Squadron Control (×1.10) cost every PD mount 0.11 a shot. The verifier recomputes this over the whole catalogue. Missiles keep 0.20: the formula's saturation against them is §2.5's to rule, not this section's.

**The attack.** In phase 8, each craft that ended phase 5 on its target and survived interception rolls once:

```
baseChance     = baseHitChance × weaponHitProfiles[hitProfile].baseHitChanceModifier
                 × accuracy            // fighter: carrier.effective(squadronAccuracy)
                                       // drone:   controller.effective(weaponAccuracy)[drone]
                 − 0.20 if a component is targeted
evasion        = speedEvasionSystem(target, tracking) × (1 − evasionIgnoredFraction)     [§2.4]
finalHitChance = clamp(baseChance − evasion + target.effective(enemyHitChance), 0.05, 0.95)
rawDamage      = (damage.base ± variance)  × controller.effective(weaponDamage)[drone]   // drones only
```

A craft attacks from point-blank by definition, so there is no range multiplier and no arming check. Lock quality is 1 and blind fire does not apply. Shields, armour and the critical roll then run as for any hit (§3.2, §3.3, §3.6), at the profile's critical chance; the carrier's `criticalChanceBonus` does not apply. Tracking 90 covers 450 speed, so fighters take speed-evasion away from every hull except the fastest. Fighters, like missiles, beat evasion.

**Drone control.** A drone attacks only a target its controlling ship holds a lock on that round; without the lock it holds position over the target. When the controller is destroyed or disengages, its airborne drones are lost.

**Losses and recovery.**

* Interception is the only way a craft dies in flight. The log's "finished off by return fire" is colour.
* A fighter whose carrier is destroyed or disengages may recover aboard any friendly ship with free `aircraftCapacity`. One still airborne without a deck when the battle ends is lost.
* When the battle ends, every airborne craft whose carrier is still present is recovered.
* Craft aboard a ship that is destroyed are lost with it. They are not salvage.

**Across engagements.** The craft aboard a ship are inventory, like its magazine (`GamePlay/logistics_specification.md` §6). Losses carry over: a carrier starts its next engagement with what came home. Replacement craft are not goods and have no market price. They are restocked in phase 12 from manufactured resources, out of a warehouse at the same location or by purchase, at a fixed cost per craft:

| | structural | energy | ordnance | precision | total |
|---|---:|---:|---:|---:|---:|
| fighter | 0.50 | 0.25 | 0.30 | 0.55 | 1.60 |
| drone | 0.30 | 0.30 | 0.00 | 0.40 | 1.00 |

A full complement never costs more than a quarter of its hull (`CRAFT_WING_COST_SHARE_MAX`). The dearest is the Fleet Aircraft Carrier Tier 1, whose 78 fighters cost 22% of its `buildCost`. A refit that drops capacity below the craft aboard scraps the excess.

**Calibration: Veritas/Cinder.** *Solmirage* and *Cinderwatch* are not catalogued named ships. Each stands for the escort-carrier template whose hangar gives its logged squadron count (`STRIKE_CARRIERS`).

| carrier | stands for | fighters | squadrons | logged |
|---|---|---:|---:|---:|
| *Solmirage* | Escort Carrier Tier 1 | 20 + 6 = 26 | 4, 2 in reserve | 4 ✓ |
| *Cinderwatch* | Escort Carrier Tier 2 | 26 + 7.2 → 33 | 5, 3 in reserve | 5 ✓ |

The timeline fits the cadence. The first launch is round 5 = 1 + 4, "still two rounds out" while phase 1 ends. *Cinderwatch*'s round-5 survivors come home in round 6, the round both carriers hold, and are ready in round 8 = 6 + 2. That is when it launches "2 rebuilt" squadrons: 20 − 2 × 6 = 8 fighters, out of 9 survivors and 3 in reserve. Every fresh squadron flies exactly once: *Solmirage* 2 + 2 = 4, *Cinderwatch* 3 + 2 = 5. At 4,000 a round a fighter covers the 3,000 between the lines at round 5, so launch and attack fall in the same round.

| round | strike | launched | downed: logged (expected) | attacked | hits: logged (chance) | shields |
|---|---|---:|---|---:|---|---|
| 5 | *Solmirage* → *Meridian Aegis* | 12 | 5 (≥ 3.4 from *Vanguard's Wake*; uncatalogued screens fire too) | 7 | 4 (0.68) | 4 × 113.8 = 455 < 898: hold ✓ |
| 5 | *Cinderwatch* → *Stormbreaker* | 18 | 9 (8.6: own PD, *Obsidian March*, *Auric Drift*'s flak) | 9 | 6 (0.67) | 6 × 103.5 = 621 ≥ 610: collapse ✓ |
| 7 | *Solmirage* → *Vanguard's Wake* | 12 | 4 (3.4) | 8 | 8 (0.66) | 8 × 100.0 = 800 ≥ 664: collapse ✓ |
| 8 | *Cinderwatch* → *Leviathan Crown* | 20 | 6 (6.2: two small PD lasers, 12 attempts) | 14 | — (0.71) | 1,009 expected against 962 logged (1,362 → ~400) ✓ |

Each target's chance is the formula above at skill level 0: the missile profile's 0.8125 base, less half its evasion, less its ECM suite's 0.08. Eight hits from eight is the lucky end of the table, 0.66⁸ ≈ 3.7%, but still inside the central 95% of outcomes. `verify_combat.py` recomputes every number in both tables from the catalogue (`STRIKE_CLAIMS`).

---

## 3. Damage Calculation

### 3.1 Raw damage

```
rawDamage = (weapon.damage.base + random(-variance, +variance))
              * attacker.effective(weaponDamage)[weapon.weaponClass]                  // R8
```

`weaponDamage` is the same class-scoped multiplier as `weaponAccuracy` (§2.1): the Weaponry skill's ×0.50 gate below level 5 and +5% per level from 6, plus Attacking Formation. No module carries it. Splash, near-miss and follow-up fractions (§3.4) are fractions of this figure.

Per `weapon.interface`'s generation model, `base` isn't hand-set per weapon — it's `size anchor x archetype signature x mark ladder x family bias`: each mark (1–5) is roughly **+13% damage over the previous** (~1.63x total, Mk.1 to Mk.5), with power cost rising more slowly, so higher marks are strictly stronger *and* more efficient. Family bias (Draconis +30% damage / −7% hit; Kestrel −28% damage but 1.5x fire rate; etc.) is a zero-sum trade layered on top, measured against Vanguard as the 1.00 reference line.

### 3.2 Shields

```
shieldDamage = rawDamage * (1 - shields.damageTypeResistance[weapon.damage.damageType])
```

Resistance is per damage type (`kinetic` / `energy` / `explosive`) and comes from the target's own shield type — damage-type matchups matter independently of raw weapon power.

The pool is `effective(shields.maxHP)`. At the end of a round, a ship whose last hit was at least `effective(shields.rechargeDelayAfterHit)` rounds ago recharges `effective(rechargeRatePerRound)`, up to that pool, unless EMP suppresses it (§3.4). Energy Shields and Defensive Formation raise the rate; shield boosters raise the pool and shorten the delay (R8).

### 3.3 Armor and hull

Applies only once shields are at 0:

```
hullDamage = max(1, (rawDamage - effective(hull.armorRating))
                     * (1 - target.effective(damageReduction)))                      // R8
```

The hull pool is `effective(hull.maxHP)`. `damageReduction` — Defensive Formation, capped at 0.50 — cuts what armour lets through; it never reduces shield damage. At the end of every round the hull regains `effective(hull.regenPerRound)` (repair drones, fire suppression), never above the pool (R8).

Any damage exceeding `shieldsCurrentHP` within a *single hit* carries over to hull in that same hit, minus armor — shields don't "block" an overkill hit from spilling through.

### 3.4 Special effects

v1 gave numbers to two of the thirteen effects the weapon catalogue uses. **Ruled (R3): all thirteen now have one.** The two v1 rules keep their values and gain only the clarifications v1 left open. The battle logs drove the rest wherever they already narrated a mechanic — EMP suppressing shield recharge for 2 rounds, a hit that lands twice.

An effect can act in four **contexts**, and a weapon occupies the ones its class and other effects give it:

| context | when |
|---|---|
| **hit** | the damage step of a shot that landed — direct fire, a surviving missile, a melee strike, a mine detonation |
| **projectile** | the shot as a target in the interception sub-phase (§2.5) |
| **intercept** | the weapon firing inside the interception pool |
| **mine** | a laid field: when it detonates and how long it lasts |

`verify_combat.py` derives each weapon's contexts from the catalogue and fails unless every (effect, context) pair that occurs is either ruled below or explicitly declared inert with a reason in `tools/combat_tables.py`.

**Damage modifiers**

| effect | rule (hit context) |
|---|---|
| `ignores_shields_partial` | 50% of `rawDamage` skips shields and goes to the hull step. **Armour still applies to it** — which is what makes the Particle Lance's pairing with `armor_piercing` meaningful. |
| `armor_piercing` | The target's `armorRating` is halved for this hit, applied after `armor_melt`. |
| `armor_melt` | Every hit that deals hull damage lowers the target's `armorRating` by **5% of its base**, down to a floor of **50% of base**, for the rest of the engagement. Piercing is one hit; melt is cumulative. |
| `shield_disrupt` | The target's `shields.damageTypeResistance` is **halved** for this hit — the shield-side mirror of `armor_piercing`. Sable/Ember's cruise missiles "ignore 50% of shield resistance" is this rule. |
| `emp_disable` | On **every** hit: shield recharge suppressed and `topSpeed` ×0.70 for **2 rounds**. A second EMP hit refreshes the duration and never stacks. The speed cut feeds §2.4 — EMP strips speed to strip evasion. |
| `multi_hit` | Every hit is followed by a second damage application at **50%**, with no hit roll and no critical roll of its own. **Not** for interceptable weapons: their volley size is already the multiple. |
| `area_denial` | **25%** of `rawDamage` also strikes up to **2** other ships of the target's side whose distance from the attacker is within **±10%** of the target's. Splash passes shields and armour normally and never rolls a critical. On the engagement line (§1.4) a ship X qualifies when `|d(attacker, X) − d(attacker, target)| ≤ 0.10 × d(attacker, target)`. |
| `proximity_trigger` | A miss whose roll lands within **0.10** above `finalHitChance` still detonates for **50%** damage, with no critical roll. |

**Accuracy and interception**

| effect | hit | projectile | intercept |
|---|---|---|---|
| `high_tracking` | tracking ×**1.25** in §2.4 | +**0.10** projectile evasion | tracking ×**1.25** in interceptChance |
| `multi_hit` | (above) | +**0.05** projectile evasion per missile | +**1** attempt per mount per round |
| `proximity_trigger` | (above) | — | +**0.10** interceptChance |
| `area_denial` | (above) | inert — splash resolves on landing | a successful attempt against craft downs **1** more craft of the same wave |
| `point_defense` | pool assignment (§2.5) | — | joins the pool; missiles and craft at +0.00 |
| `anti_missile` | pool assignment | — | joins the pool; missiles at +**0.10** |
| `anti_air` | pool assignment | — | joins the pool; craft at +**0.10** |
| `can_be_intercepted` | inert — marks the projectile | enters the sub-phase at 0.20 base evasion | — |

The missile hit profile's `interceptable` is read from `can_be_intercepted`, not from `weaponClass`. That is why the Interceptor Missile — a missile without the flag — is never itself shot down.

**Mines**

Mines never use the master hit formula. A field is laid against a chosen enemy ship within `range.maximum`.

| | rule |
|---|---|
| position (R6) | A field is laid in the direct-fire step at its anchor's `position` on the engagement line (§1.4), and it never moves. |
| base | **Command-detonated**: fires on its anchor ship only, at the next round's direct-fire step, if the anchor is still within `range.optimal` **of the field**. Otherwise the anchor has outrun it and the field is spent. Consumed by its first detonation. |
| `proximity_trigger` | Detonates with no hit roll on the first ship of **either side**, in movement order, that **ends phase 5** within **0.10 × `range.optimal`** of the field or whose phase-5 movement **crosses** the field's position. The damage applies at that round's direct-fire step. A field is first checked in the round after it is laid. Friendly fire is real. |
| `area_denial` | The field is not consumed: it persists **3 rounds** and detonates at most once per ship per round. |
| damage effects | `armor_piercing`, `armor_melt` and `multi_hit` on a mine apply through the hit rules above when it detonates. |
| capacity (R8) | A ship may have at most `effective(mineCapacity)` of its own fields active at once — `capacities.mines`, raised by mine rails. Each field still spends the mine weapon's own ammo. |
| sweeping (R8) | At the end of each round, every hull with `effective(minesweepRate) > 0` rolls that chance once against each enemy field it currently detects; a success removes the field. Minesweep gear's +30% is a 0.30 chance. |
| layer gone (R7) | A command field needs its layer to fire it. When the layer is destroyed or disengages, its command fields are spent. A proximity field fires itself, so it stays on the line until it detonates, its `area_denial` rounds run out, or it is swept. |
| engagement end | Every field still on the line expires when the engagement ends. Nothing is carried into the next one. |

**What the geometry does (R6).** A command field's reach is its whole `range.optimal`, 174–2,821 across the catalogue. A slow anchor cannot outrun it; a fast one that keeps moving can. A proximity field's radius is 17–282, smaller than almost any ship's movement in a round. The anchor escapes it simply by moving, but the field stays on the line. It catches any ship that holds or keeps station on that spot, and anyone who drives across it, friend or foe. Mines are how a fleet denies the ground a pursuer has to cross.

### 3.5 Component targeting

Targeting a specific component (bridge / engines / weaponSystems / shieldGenerator / sensorArray / lifeSupport) instead of general hull costs −0.2 accuracy (§2.1 step 7) and tracks damage in a **parallel HP pool** — it does not subtract from the hull HP pool. Depleting a component's HP triggers its `criticalEffect` immediately (e.g., engines → −70% speed/turn rate; sensorArray → −40% hit chance + reduced detection).

### 3.6 Critical rolls

Any confirmed hit rolls against `weapon.criticalChance + attacker.effective(criticalChanceBonus)` (targeting computers, R8); if it triggers, roll d100 against the component-critical table:

| Roll | Result |
|---|---|
| 1–30 | Minor system damage — −10% to a random stat, 2 rounds |
| 31–60 | Targeted component takes 25% of its max HP as bonus damage |
| 61–85 | Targeted component (or random, if none chosen) disabled for 1 round |
| 86–100 | **Catastrophic** — component destroyed, permanent until dock repair |

Both logs treat 86–100 as the "moment" roll — every named-ship kill in both engagements is narrated as a catastrophic critical (weapons-bay detonation, bridge destruction), never plain attrition. That's a strong, reusable signal for §4: **catastrophic crits are always tier-1 narrative events, unconditionally.**

**Damage control (R8).** Once a critical's band is rolled, the defender rolls to **resist** it:

```
resistChance = min(0.75, target.effective(criticalEventResistance)
                         + target.effective(crew.engineeringSkill) / 200)
```

A success downgrades the critical one band: catastrophic → disabled → bonus damage → minor → no effect. Damage Control (+4%/level) and Defensive Formation feed `criticalEventResistance`. Damage-control, machine-shop and repair-shop modules raise `crew.engineeringSkill`, which enters with the same /200 weight as gunnery in §2.1. A downgraded catastrophic is still logged as an attempted catastrophic (§4.2) — the near-miss is the story.

**Crew casualties (R8).** The `lifeSupport` critical's "crew casualties over time": while life support is disabled or destroyed, the ship loses `0.05 × crew.maxCrew × (1 − effective(crewRecoveryRate))` crew at the end of every round. Fire suppression and hospital bays raise `crewRecoveryRate`, capped at 0.90. Casualties are what drive §3.7's crew-loss destruction. After the engagement, up to the fleet's summed `effective(medicalCapacity)` (`capacities.medical`, hospital bays) of those casualties return to duty; the rest are lost.

### 3.7 Destruction and retreat

```
hullCurrentHP <= 0                                      -> destroyed (may splash nearby ships)
lifeSupport component destroyed AND crewCurrent == 0     -> destroyed (crew loss)
hullCurrentHP <= RETREAT_THRESHOLD × hull.maxHP         -> attempts to break off (R4: 30%):
                                                           intent is withdraw from the next round on
withdrawing AND no enemy holds a lock on it at end of round -> disengaged (R6)
```

**Ruled (R4): 30% hull.** v1 said retreat below 15% hull *and* with no weapons operational. Both battle logs trigger withdrawal in the 30–33% band instead: *Stormbreaker* pulls out at 340/1072 ≈ 32%, *World Ender* withdraws at about 30%, and SABLE calls its withdrawal while its flagship's hull is still well above 15%. The logs read better with the higher threshold — a ship limping at 10% hull rarely gets a dramatic withdrawal scene, it just dies the next round.

The logs win, and the "no weapons operational" condition goes with the old number: none of the logged withdrawals waited for it. The threshold is stated once, as `RETREAT_THRESHOLD` in `tools/gameplay_tables.py`, which `GamePlay/conflict_specification.md` §5 also reads. `data-template.json` is the untouched upstream reference, so the override is recorded in the v2 JSON's `v1Overrides` block instead of being edited into v1.

**Disengagement (R6).** Breaking off is the `withdraw` intent (§1.4).

* **Who withdraws.** Any ship may declare `withdraw`. A ship at or below 30% hull must, from the next round to the end of the engagement. A withdrawing ship keeps firing, a fighting withdrawal, unless it runs silent.
* **Success.** At the end of each round, a withdrawing ship that **no enemy holds a lock on** leaves the battle. It must be beyond every enemy's `effectiveDetectionRange` on it (§2.3). It is `retreated`, not destroyed, and it is not a loss.
* **Why lock, not weapon reach.** Blind fire can still reach a ship until it is clear. Cruise missiles reach 11,000–20,000, so making escape wait on weapon reach would make it impossible. Lock is what the logs narrate breaking ("using terrain to break EMBER's sensor lock"), and it is the model `GamePlay/conflict_specification.md` §4 names: signature, detection and relative speed.
* **The trade.** Running silent while withdrawing halves the signature enemies lock on, but it costs 30% speed. Afterburner adds 25% speed and 40% signature. A pursuer keeps its lock by declaring `close` on the runner. A runner shakes a pursuit only by being faster or quieter, or by facing enemies whose sensors are damaged. For example, *Whisperfang* (309) withdrawing from *Stormbreaker* (209) with shields up is locked out to 1,917. Once at full speed it opens 400 a round on a pursuing *Stormbreaker*.
* **`avoid` posture.** A fleet with posture `avoid` declares `withdraw` for every hull from round 1. If it sees first (§1.4), it opens at its own first-lock range, as far out as it can. A fast, quiet fleet that the enemy never locks is gone at the end of round 1.
* **The round cap.** At `ROUND_CAP` (25), every ship still present disengages, withdrawing or not (`GamePlay/conflict_specification.md` §4.2). A withdrawal that has not finished by then ends with the battle.

---

## 4. Logging: Making Combat Exciting

The schema already provides two logging layers that don't currently talk to each other: `exampleCombatTurnLog` (flat, structured, one event object per shot — what the *engine* needs) and the two hand-written `battle_log_*.md` files (narrative, dramatic, readable — what a *player* wants). The fix isn't to pick one; it's to make the narrative log a **deterministic rendering** of the structured log, not a separately-authored artifact.

### 4.1 Tier 1 — Structured event log (ground truth)

Every phase in §1.1 emits typed events into an append-only per-battle log. Extending `exampleCombatTurnLog`'s schema (the upstream name; `Reference/combat.ts` types one round of it as `RoundLog`, keyed by `round`) with the fields v2 actually needs to reconstruct a narrative later (range band, lock state, interception detail, critical roll) — nothing here is cosmetic, it's what Tier 2 reads:

```json
{
  "round": 4,
  "phase": "directFireResolution",
  "attacker": "ship_wraithbolt",
  "target": "ship_stormbreaker",
  "weaponUsed": "wpn_torpedo_launcher_mk3",
  "weaponClass": "missile",
  "volleySize": 3,
  "ammoRemaining": 6,
  "targetedComponent": null,
  "distance": 2600,
  "rangeBand": "long",
  "locked": true,
  "lockQuality": 1.0,
  "interception": { "attempts": 4, "intercepted": 2, "survived": 1 },
  "hitChanceCalculated": 0.42,
  "rollResult": 0.31,
  "outcome": "hit",
  "rawDamage": 58,
  "damageToShields": 41,
  "damageToHull": 24,
  "shieldsBefore": 610, "shieldsAfter": 501,
  "hullBefore": 1072, "hullAfter": 1048,
  "criticalRolled": false
}
```

Every RNG draw (`rollResult`, intercept rolls, critical d100) is stored, not just its outcome — that's what makes a battle deterministically replayable and lets the narrative log be regenerated in a different tone later without re-simulating combat.

### 4.2 Tier 2 — Narrative broadcast log (the exciting one)

Generated from Tier 1 by a narrator pass. The two hand-written logs already establish a consistent house style — codify it instead of re-inventing it per battle:

**Structure**
- H1 title in the "Engagement Log: *The [Place] [Skirmish/Line/Action]*" pattern, with combatants, location, and (for large actions) a `Classification` line.
- Roster tables up front — ship, class, hull, shield, speed, evasion — so the reader has a reference to check state changes against.
- H3 round/phase headers. Small actions (§1.2) get one header per round; large actions get one per multi-round phase with a name ("Long-Range Opening," "General Engagement," "Attrition & Breaking Point") — the phase name itself is doctrine commentary, not just a label.
- A closing **Result** section: a losses/remaining table, followed by a **Summary** paragraph that explicitly ties the mechanical outcome back to *why* — which system or doctrine decided it. Both source logs end on one of these, and it's the single most "written" part of either document.

**Sentence-level conventions**
- Ship names always italicized (*Whisperfang*), fleet/task-force names bolded (**SABLE**).
- Bold marks a state-change worth remembering: **Stormbreaker shields 610 → 501**, **Corvus is destroyed**, a named critical result.
- Blockquoted radio chatter for flavor at specific trigger points only (below) — attributed (`> *Ironclad Vestige, CIC:*`), short, in-character, never explaining mechanics.
- Running hull-count tallies stated inline whenever a kill happens (`EMBER: 7 -> 6 hulls remaining`) — makes attrition legible without a separate scoreboard.
- Numbers stay concrete: cite the actual shields/hull before→after, not "took heavy damage."

**Event-significance tiering** decides what earns a full sentence vs. what gets folded into a summary clause — this is the actual authoring rule behind why the two logs read so differently at different scales:

| Tier | Narration | Trigger examples |
|---|---|---|
| 1 — headline | Always, in full | Any ship destroyed; any catastrophic (86–100) critical; a commander's retreat/withdrawal order; first contact / first blood / first kill of the battle |
| 2 — notable | In full, within the current focus phase | Shields collapsing to 0; a component disabled/destroyed critical (61–85); a swarm/saturation attack overwhelming PD; a named flagship taking a significant hit |
| 3 — routine | Summarized, not per-shot | Ordinary hits/misses that don't cross a shield/hull threshold — aggregate as "both sides trade fire, minor damage" |
| 4 — omitted | Not narrated (still in Tier 1) | Full-miss exchanges with no state change; routine PD intercepts that aren't part of a saturation moment |

Below the fleet-size threshold from §1.2, tier 3 mostly doesn't exist — small actions have room to narrate the "routine" hits too, which is exactly what Sable/Ember does. Above the threshold, tier 3 becomes the load-bearing category and most of the battle's actual dice rolls get compressed into one clause per phase, which is what Veritas/Cinder does.

**Radio-chatter trigger points** (sparingly — both source logs use 1–3 each):
- First contact / first-lock advantage
- A commander's order to press, withdraw, or focus fire
- The moment a flagship or named ship is critically endangered

Flavor-quote generation should not be free text — tie it to the mechanical event that triggered it (a running-silent first-lock event always generates a "they don't see us yet, hold silent"-class line; a retreat trigger always generates a withdrawal order) so the narrative stays grounded in what the Tier 1 log actually says, rather than drifting into disconnected flavor.

---

## 5. Rulings and Open Gaps

### 5.1 Ruled

Cross-referencing the three source files surfaced five inconsistencies. `GamePlay/gameplay_specification.md` §7 ruled on R2, R4 and R5, and named R1 a source fix; R3 was left to combat. All five are now applied at the source. R6–R9 surfaced while ruling them, and are ruled too.

| | gap | ruling | where it landed |
|---|---|---|---|
| R1 | `_meta.extends` named `spaceship_combat_system.json`, which does not exist | Points at `data-template.json -> combatResolution` | v2 JSON `_meta.extends`; the verifier resolves it |
| R2 | v2's formula dropped v1's `gunnerySkill/200` and the −0.2 component penalty | Both apply; v2 extends v1 | §2.1 steps 6–7; v2 JSON steps 8a–8b |
| R3 | 11 of 13 `specialEffects` had no numeric rule | Every effect is ruled in every context it occurs in | §3.4; `tools/combat_tables.py` |
| R4 | Retreat at 15% (v1) vs ~30% (both logs) | 30% hull; the logs win | §3.7; `RETREAT_THRESHOLD` |
| R5 | v1's `sensorDebuff` was never defined | It is the `sensorArray` critical, applied as a multiplier | §2.1 step 8; v2 JSON step 9 |
| R8 | Skill and module stats were routed here but appeared in no formula, including the Weaponry −50% gate | One stacking rule; every combat stat named in the formula it modifies; R6/R7-owned stats listed as pending (R6's since ruled) | §1.3; §1.1, §2.1, §2.3–2.5, §3.1–3.4, §3.6; `STAT_KIND` |
| R6 | Phase 5 said only "resolve positioning"; nothing turned `topSpeed`, `acceleration` and `turnRate` into distance, and §2.4's `/250` saturated | One engagement line with positions; four intents; `ROUND_TIME` 4 calibrated on Sable/Ember; mines sit on the line; withdrawal succeeds when no enemy locks; speed-evasion recalibrated to tracking ×5 over 1,000 | §1.1, §1.4, §2.4, §3.4, §3.7; `RANGE_CLAIMS`, `OPENING_CLAIMS`; v2 JSON `movementSystem`, `speedEvasionSystem` |
| R9 | The detection formula gave lock ranges from 0.2 to 70,000 and never read `sensors.detectionRange` | Anchored on `effective(detectionRange)` × sensor condition × `sensorArray.effectiveness` × `clamp(√(sig/16), 0.25, 4)`, calibrated on every lock claim in the repo | §2.3; `LOCK_CLAIMS`; v2 JSON `detectionAndLockOn` |
| R7 | Fighters and drones decided Veritas/Cinder, and `aircraftCapacity`, `droneCapacity` and the `squadron*` stats pointed at §2.5, but nothing said how a squadron launches, attacks, is lost or rearms | Craft are not weapons: two profiles, fighter and drone; squadrons of 6; fighters stowed 4 rounds and turned round in 2; they move on the engagement line after the ships; interception at 1.10 craft evasion, with cover from neighbouring pool weapons; attack on the missile (fighter) or kinetic (drone) profile; losses carry over and craft are restocked from manufactured resources. Fighter Squadron Control drives fighters; the Drones Weaponry skill and its ×0.50 gate drive drones. Command mine fields die with their layer; proximity fields outlive it, and no field outlives the battle | §1.1, §1.3, §2.5, §2.6, §3.4; `CRAFT_PROFILES`, `STRIKE_CLAIMS`; v2 JSON `strikeCraftSystem` |

Two smaller fixes came out of applying them. The interception sign for `high_tracking` was inverted (§2.5). Melee — 60 catalogue weapons — had no hit profile in the v2 JSON (§2.1); `Reference/constants.ts` already resolved it like kinetic, and the JSON now agrees.

**The battle logs.** They were written before the weapon catalogue and stay as illustrations; they are not regenerated from these rules. The mechanics they narrate agree with the rulings — EMP's 2-round recharge suppression, retreat around 30%, saturation beating pooled PD. Two loadout details do not match the catalogue. Sable/Ember gives its cruise missiles a shield-resistance bypass, which the catalogue gives to `shield_disrupt` weapons, not to the Cruise Missile Bay. It also credits a disabled hardpoint to an Ion Cannon's EMP; under §3.4 that has to come from the critical roll the same hit makes.

### 5.2 Open

None. R7 (strike craft) was the last open ruling; it is ruled in §2.6. `tools/combat_tables.py` `PENDING_RULINGS` is empty, so every combat stat in `STAT_RULES` must now be named in the section it cites.
