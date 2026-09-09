# Fleet Combat Doctrine — Combat Logic Specification

**Sources analyzed**
- `data-template.json` → `combatResolution` (v1.0, "Spaceship Combat System - Data Design" — base resolution loop, hit formula, damage formula, critical table)
- `Combat-logic/advanced_combat_system.json` (v2.0, "Advanced Combat Resolution System" — extends v1 with range bands, signature/detection, speed-evasion, missiles/point-defense)
- `Combat-logic/battle_log_sable_vs_ember.md` (5-vs-7 skirmish, resolved shot-by-shot)
- `Combat-logic/battle_log_veritas_vs_cinder.md` (13-vs-17 fleet action, resolved phase-by-phase)
- `Data-Templates/weapon.interface`, `ship.interface`, `module.interface` (schema/generation notes)

This document reconciles the two combat-resolution layers into one authoritative spec covering how a turn rolls out, how hit chance is computed, how damage is computed, and how to log combat so it reads with the same excitement as the two hand-written battle logs. Section 5 lists contradictions between the source files that need a ruling before implementation.

---

## 1. Combat Rollout

### 1.1 The canonical turn structure

v2's `updatedTurnStructure` supersedes v1's 9-step `turnStructure` — it's a strict superset (adds signature declaration, detection/lock-on, and missile resolution as new sub-phases), and both battle logs follow it. Canonical order:

1. **Initiative** — sort all ships by `(pilotSkill + sensorArray effectiveness + random d20)` descending.
2. **Signature declaration** — each ship commits this turn's operating state (normal / afterburner / running-silent / shields up-down), fixing its signature via the signature system for the whole turn.
3. **Detection phase** — for every attacker–target pair, compute `effectiveDetectionRange` and update `lockQuality` (build, hold, or reset).
4. **Power allocation** — assign the ship's power budget across weapons / shields / engines.
5. **Movement** — resolve positioning; sets the `distance` used by everything downstream.
6. **Targeting** — each ship picks target(s), weapon(s), and optionally a specific component, constrained by `range.maximum` and remaining ammo.
7. **Missile resolution sub-phase** — ammo deduction, arming check, and point-defense interception for every missile weapon fired this turn (§2.5). Runs *before* any hit roll.
8. **Direct-fire resolution** — for non-missile weapons and missiles that survived interception: run the hit-chance formula (§2), then the damage formula (§3).
9. **Critical checks** — on every confirmed hit, roll on the component-critical table (§3.6).
10. **End of turn** — shields recharge outside their delay window, this turn's signature bonuses expire, repair modules apply, destruction/retreat conditions are checked.
11. Repeat from step 1 until a victory condition is met.

### 1.2 Resolution granularity scales with fleet size

Neither source file states this as a rule, but it's the load-bearing difference between the two battle logs, and it's worth making explicit as policy:

- `sable_vs_ember` (5 vs 7 ships) resolves **every weapon-fire event individually** — you can trace a specific torpedo volley's ammo count, a specific PD intercept, a specific hit roll.
- `veritas_vs_cinder` (13 vs 17 ships) resolves **per task-group per phase**, narrating only named-ship highlights (first kill, flagship shield collapse, a bridge critical) and summarizing the rest ("both sides trade fire, minor damage").

**Recommendation:** pick a hull-count threshold (the logs imply somewhere around 8–10 ships per side) below which the engine resolves and logs every individual shot, and above which it batches same-class-vs-same-class exchanges into one resolved outcome per phase, only breaking out individual events that clear the significance bar in §4.2. This keeps large fleet actions computationally sane without losing the moments that matter.

---

## 2. Hit Rate Calculation

### 2.1 Reconciled master formula

v2's `masterHitChanceFormula` doesn't mention two terms v1 defines — `gunnerySkill` and the −0.2 component-targeting penalty — but v2 explicitly *extends* v1 rather than replacing it, so both should still apply. Reconciled, in resolution order:

```
0. If distance > weapon.range.maximum: weapon cannot fire. Stop.
1. rangeMultiplier   = distanceSystem.rangeMultiplierFormula(distance, weapon)      [§2.2]
2. locked            = distance <= effectiveDetectionRange(attacker, target)         [§2.3]
3. lockQuality       = locked ? currentLockQuality (0.5 -> 1.0 over 2 turns) : 0.5
4. effectiveEvasion  = speedEvasionSystem.formula(target, weapon)                    [§2.4]
5. if weapon.weaponClass == missile:
       effectiveEvasion *= (1 - 0.5)        // guided course correction ignores half the dodge
6. baseChance        = weapon.accuracy.baseHitChance
                        * weaponHitProfiles[weapon.weaponClass].baseHitChanceModifier
                        + (attacker.crew.gunnerySkill / 200)                          // carried forward from v1
7. if targeting a specific component: baseChance -= 0.2                              // v1 componentTargetingRules
8. preLockChance     = baseChance * rangeMultiplier * lockQuality
9. if not locked: preLockChance *= 0.25                                              // blind-fire penalty
10. finalHitChance   = clamp(preLockChance - effectiveEvasion, 0.05, 0.95)
```

For missile weapons, this whole formula only runs on missiles that survive the point-defense interception sub-phase (§2.5) — a shot-down missile never reaches step 0.

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

Per-turn state modifiers stack on top:

| State | Effect |
|---|---|
| Fired a weapon volley this turn | +8% signature per volley (heat/EM bloom) |
| Shields active | +10% signature (emitters are detectable) |
| Afterburner / high acceleration | +40% signature (engine flare) |
| Running silent | −50% signature, but −30% top speed and **no weapons fire this turn** |
| ECM module active | −15% signature |

Detection: `effectiveDetectionRange = attackerSensorStrength * (targetSignature / 100)`, where `attackerSensorStrength` derives from the attacker's `sensorArray` component HP (times any sensor-bonus modules). If `distance <= effectiveDetectionRange`, the target is **locked**; otherwise the attacker may still fire "blind" at a steep accuracy penalty.

Lock quality is not binary — it builds: a newly-locked target starts at `lockQuality = 0.5` and gains `+0.25` per turn of continuous tracking, capping at `1.0` after 2 full turns. Breaking line-of-sight/range, or the target going silent, resets it to 0. Sable/Ember Turn 2 shows this directly: *Silverlance* fires at *Corvus* with a fresh, unbuilt lock and misses at long range — the log attributes the miss to lock quality, not just range.

### 2.4 Speed-based evasion

Replaces a flat evasion lookup with a dynamic value driven by the *matchup* between the target's speed and the specific incoming weapon's tracking stat — the same target has different effective evasion against different weapons:

```
relativeSpeedFactor = targetSpeed * (1 - turnRate_penalty_if_recently_turned)
speedEvasionBonus   = clamp((relativeSpeedFactor - weapon.accuracy.tracking) / 250, 0, 0.35)
effectiveEvasion    = clamp(target.mobility.evasionRating + speedEvasionBonus, 0, 0.60)
```

Design intent, confirmed by both battle logs: high-tracking weapons (PD lasers, pulse lasers) counter fast targets well; low-tracking weapons (railguns, mass drivers, capital ion cannons) lose most of their effective accuracy against fast ships. This is *why* SABLE's destroyers consistently dodge EMBER's slower-tracking capital guns (the JSON's own worked example has a capital Ion Cannon vs. a fast destroyer at long range compute down to the 0.05 accuracy floor), and why EMP/engine-critical hits matter tactically — they strip speed to strip evasion. Beam weapons (Beam Laser, Particle Lance) are the one exception: near-instant travel time means they ignore `speedEvasionBonus` entirely, though they still take full range falloff.

### 2.5 Missiles and point-defense

Missiles get **+25%** to base hit chance and only apply **50%** of the target's effective evasion — their core advantage over direct-fire weapons. The cost is ammo depletion and a mandatory interception sub-phase that runs *before* the hit roll:

1. Volley size = `min(shotsPerTurn, ammo)`; ammo decrements immediately, hit or not.
2. Arming check (§2.2) if launched point-blank.
3. Every defending PD/anti-missile weapon gets its `shotsPerTurn` interception attempts, **pooled across all incoming missiles at that ship this turn** — not per-launcher.
4. Each attempt: `interceptChance = clamp(pdWeapon.baseHitChance + pdWeapon.tracking/150 - missileEvasion, 0.05, 0.95)`; `missileEvasion` base 0.20 (−0.10 for `high_tracking` missiles, +0.05 per missile for `multi_hit` swarm pods).
5. Intercepted missiles are destroyed — no damage, no hit roll.
6. Survivors roll the master hit-chance formula with the missile profile.
7. Multiple hits from the same volley roll damage independently — each warhead is separate.

This is a deliberate rock-paper-scissors: missiles beat evasive ships, PD beats missiles, and **saturation** (more warheads than the defender's pooled PD shots can cover) beats PD. Both logs demonstrate the failure mode directly: *Halberd's Edge*'s 6-missile Swarm Pod overwhelms *Whisperfang*'s 3 PD shots (3 leak through) in Sable/Ember; at fleet scale, *Cinderwatch*'s 20-fighter saturation strike on an unescorted *Leviathan Crown* drops its shields from 1362 to ~400 in a single exchange because only its small-slot PD responds. **A ship with no PD hardpoint online is acutely vulnerable to any missile- or fighter-armed opponent** — this is the deciding factor in both logs and should be treated as a first-class tactical readout, not just a stat.

---

## 3. Damage Calculation

### 3.1 Raw damage

```
rawDamage = weapon.damage.base + random(-variance, +variance)
```

Per `weapon.interface`'s generation model, `base` isn't hand-set per weapon — it's `size anchor x archetype signature x mark ladder x family bias`: each mark (1–5) is roughly **+13% damage over the previous** (~1.63x total, Mk.1 to Mk.5), with power cost rising more slowly, so higher marks are strictly stronger *and* more efficient. Family bias (Draconis +30% damage / −7% hit; Kestrel −28% damage but 1.5x fire rate; etc.) is a zero-sum trade layered on top, measured against Vanguard as the 1.00 reference line.

### 3.2 Shields

```
shieldDamage = rawDamage * (1 - shields.damageTypeResistance[weapon.damage.damageType])
```

Resistance is per damage type (`kinetic` / `energy` / `explosive`) and comes from the target's own shield type — damage-type matchups matter independently of raw weapon power.

### 3.3 Armor and hull

Applies only once shields are at 0:

```
hullDamage = max(1, rawDamage - hull.armorRating)
```

Any damage exceeding `shields.currentHP` within a *single hit* carries over to hull in that same hit, minus armor — shields don't "block" an overkill hit from spilling through.

### 3.4 Special effects (defined vs. undefined)

Only two of the special-effects vocabulary's ~13 entries have a numeric definition in `combatResolution.damageFormula.specialEffectOverrides`:

| Effect | Defined behavior |
|---|---|
| `ignores_shields_partial` | 50% of `rawDamage` bypasses shields straight to hull |
| `armor_piercing` | `armorRating` is halved when computing `vsArmor` |

The rest — `emp_disable`, `multi_hit`, `high_tracking`, `shield_disrupt`, `area_denial`, `anti_air`, `can_be_intercepted`, `proximity_trigger` — appear in the weapon vocabulary and are *used narratively* in both battle logs (EMP suppresses shield recharge for 2 turns; `multi_hit` autocannons land two hits per volley) but have no numeric rule in the schema yet. See §5 — the logs already assume mechanics the JSON doesn't formally specify.

### 3.5 Component targeting

Targeting a specific component (bridge / engines / weaponSystems / shieldGenerator / sensorArray / lifeSupport) instead of general hull costs −0.2 accuracy (§2.1 step 7) and tracks damage in a **parallel HP pool** — it does not subtract from the hull HP pool. Depleting a component's HP triggers its `criticalEffect` immediately (e.g., engines → −70% speed/turn rate; sensorArray → −40% hit chance + reduced detection).

### 3.6 Critical rolls

Any confirmed hit rolls against `weapon.criticalChance`; if it triggers, roll d100 against the component-critical table:

| Roll | Result |
|---|---|
| 1–30 | Minor system damage — −10% to a random stat, 2 turns |
| 31–60 | Targeted component takes 25% of its max HP as bonus damage |
| 61–85 | Targeted component (or random, if none chosen) disabled for 1 turn |
| 86–100 | **Catastrophic** — component destroyed, permanent until dock repair |

Both logs treat 86–100 as the "moment" roll — every named-ship kill in both engagements is narrated as a catastrophic critical (weapons-bay detonation, bridge destruction), never plain attrition. That's a strong, reusable signal for §4: **catastrophic crits are always tier-1 narrative events, unconditionally.**

### 3.7 Destruction and retreat

```
hull.currentHP <= 0                                     -> destroyed (may splash nearby ships)
lifeSupport component destroyed AND currentCrew == 0     -> destroyed (crew loss)
hull.currentHP < 15% of maxHP AND no weapons operational  -> AI may attempt retreat
```

**Contradiction to resolve:** the schema's retreat threshold is 15% hull, but both battle logs trigger retreat/withdrawal in the 30–33% band (*Stormbreaker* pulls out at 340/1072 ≈ 32%; *World Ender* withdraws at ~30%; SABLE's fleet withdrawal is called with its flagship's shields at 0 but hull still well above 15%). The written logs read better with a higher threshold — a ship limping at 10% hull rarely gets a dramatic withdrawal scene, it just dies next turn. Recommend moving the canonical retreat threshold to **~30%** and updating `data-template.json` to match observed/intended behavior, rather than leaving the two sources disagreeing.

---

## 4. Logging: Making Combat Exciting

The schema already provides two logging layers that don't currently talk to each other: `exampleCombatTurnLog` (flat, structured, one event object per shot — what the *engine* needs) and the two hand-written `battle_log_*.md` files (narrative, dramatic, readable — what a *player* wants). The fix isn't to pick one; it's to make the narrative log a **deterministic rendering** of the structured log, not a separately-authored artifact.

### 4.1 Tier 1 — Structured event log (ground truth)

Every phase in §1.1 emits typed events into an append-only per-battle log. Extending `exampleCombatTurnLog`'s schema with the fields v2 actually needs to reconstruct a narrative later (range band, lock state, interception detail, critical roll) — nothing here is cosmetic, it's what Tier 2 reads:

```json
{
  "turn": 4,
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
- H3 turn/phase headers. Small actions (§1.2) get one header per turn; large actions get one per multi-turn phase with a name ("Long-Range Opening," "General Engagement," "Attrition & Breaking Point") — the phase name itself is doctrine commentary, not just a label.
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

## 5. Open Gaps Requiring a Ruling

Cross-referencing all three source files surfaced five inconsistencies that should get an explicit decision before implementation, rather than being silently resolved differently by whoever builds it:

1. **`extends` points at a file that doesn't exist.** `advanced_combat_system.json._meta.extends` says `"combatResolution from spaceship_combat_system.json"` — no such file exists; the actual base is `data-template.json`'s `combatResolution` block. Rename the reference at the source.
2. **Gunnery skill and the component-targeting penalty are dropped from v2's formula.** v1's `hitChanceFormula` includes `attacker.gunnerySkill/200` and a −0.2 component-targeting penalty; v2's `masterHitChanceFormula` pseudocode omits both. §2.1 assumes they still apply (v2 extends rather than replaces v1) — confirm that's the intent, since it's currently implicit.
3. **Most `specialEffects` are unspecified.** Only `ignores_shields_partial` and `armor_piercing` have numeric rules (§3.4); `emp_disable`, `multi_hit`, `shield_disrupt`, `area_denial`, `anti_air`, and weapon-level `high_tracking` all need defined numeric behavior — the battle logs already narrate effects (2-turn shield-recharge suppression from EMP, double-hit autocannons) the schema doesn't yet back up mechanically.
4. **Retreat threshold disagreement.** Schema says 15% hull; both logs behave like it's ~30% (§3.7). Recommend moving the schema to match the logs.
5. **`sensorDebuff` in v1's formula is undefined.** v1's `hitChanceFormula` string includes a `sensorDebuff` term with no formula given anywhere. Best fit: fold it into the existing `sensorArray` critical effect ("−40% hit chance") rather than inventing a second, separate debuff — but this should be an explicit decision, not a silent assumption.
