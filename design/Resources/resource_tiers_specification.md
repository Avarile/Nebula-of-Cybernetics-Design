# Resource Tiers — Bill of Materials Specification

**Status:** design spec only. Nothing under `Resources/`, `tools/`, or the existing catalogues has been generated or modified — this document describes what a future `generate_resources.py` and the `buildCost` additions to `generate_weapons.py` / `generate_modules.py` / `generate_ships.py` would produce.

**Scope, as agreed:**
- Purpose: a **bill-of-materials** system — what a weapon/module/ship costs to build — not a trade/economy simulation. A market layer can consume this catalogue later without redesigning it.
- Per-item cost is **derived from stats each item already has** (damage, power, mass, tracking, mark, size). No second hand-authored cost table to keep in sync with the archetype/family tables that already exist in `generate_weapons.py` and `generate_modules.py`.
- Three tiers, as named: **raw → refined → manufactured**.

---

## 1. Taxonomy — four lanes × three tiers

The stat model already has four implicit physical inputs — mass/structure, power draw, ordnance/explosive yield, and precision electronics (tracking, accuracy, criticality, sensors). Rather than inventing an unrelated resource list, each lane is one of those four inputs carried through all three tiers:

| Lane | Raw | Refined | Manufactured |
|---|---|---|---|
| Structural | Ferrite Ore | Structural Alloy | Structural Component |
| Energy | Conductive Crystal | Energy Cell Matrix | Power Core Unit |
| Ordnance | Volatile Compound | Warhead Compound | Ordnance Charge |
| Precision | Rare Isotopes | Precision Circuitry | Guidance Assembly |

Twelve resources total — small enough to hand-author once and never touch again; every downstream number is computed.

Each tier→tier step has a **conversion yield** (units of output per unit of input, always < 1 — refining and fabrication both lose material, which is what makes "manufactured" the expensive end rather than a rename of "raw"):

| Lane | Raw → Refined yield | Refined → Manufactured yield | Rationale |
|---|---|---|---|
| Structural | 0.90 | 0.85 | Ferrite is abundant and refines cleanly. |
| Energy | 0.80 | 0.85 | Crystal lattices lose some yield to defects during processing. |
| Ordnance | 0.75 | 0.85 | Volatile compounds degrade / off-gas during refinement. |
| Precision | 0.50 | 0.85 | Isotopes are scarce and refine poorly — this is the deliberate "expensive lane." |

Fabrication yield (refined → manufactured) is uniform at 0.85 across lanes — factory efficiency doesn't depend on the input material — while refinement yield (raw → refined) varies by lane, reflecting the material itself. This is the only place variability lives; it keeps the taxonomy's texture in one small table instead of duplicating tuning knobs at every tier.

---

## 2. The resource catalogue

### 2.1 `resource.interface` (new, mirrors `weapon.interface` / `module.interface`)

```
resourceId:       "string, unique, format: res_<tier>_<lane>"
name:             "string"
tier:             "enum: raw | refined | manufactured"
lane:             "enum: structural | energy | ordnance | precision"
refinesFrom:      "resourceId or null — the tier-below input this is made from (null for raw)"
refinesInto:      "resourceId or null — the tier-above output this feeds (null for manufactured)"
conversionYield:  "number 0-1 or null — units of THIS tier produced per unit of refinesFrom consumed (null for raw)"
unitMass:         "number, tons — ties into the existing ship.capacities.cargo field"
description:      "string"
```

### 2.2 Full catalogue (illustrative — one JSON example per tier, remaining eight follow the same shape)

```json
{
  "resourceId": "res_raw_ferrite",
  "name": "Ferrite Ore",
  "tier": "raw",
  "lane": "structural",
  "refinesFrom": null,
  "refinesInto": "res_refined_structural_alloy",
  "conversionYield": null,
  "unitMass": 1.0,
  "description": "Bulk ferrous/silicate ore — the base structural feedstock for hull plating and weapon housings."
}
```
```json
{
  "resourceId": "res_refined_structural_alloy",
  "name": "Structural Alloy",
  "tier": "refined",
  "lane": "structural",
  "refinesFrom": "res_raw_ferrite",
  "refinesInto": "res_mfg_structural_component",
  "conversionYield": 0.90,
  "unitMass": 1.0,
  "description": "Smelted and tempered ferrite, ready for fabrication into hull sections and weapon housings."
}
```
```json
{
  "resourceId": "res_mfg_structural_component",
  "name": "Structural Component",
  "tier": "manufactured",
  "lane": "structural",
  "refinesFrom": "res_refined_structural_alloy",
  "refinesInto": null,
  "conversionYield": 0.85,
  "unitMass": 1.0,
  "description": "Finished structural part — hull sections, weapon mounts, module housings. Directly consumed by buildCost.structural."
}
```

The remaining nine entries (`res_raw_conductive` → `res_refined_energy_matrix` → `res_mfg_power_core`; `res_raw_volatile` → `res_refined_warhead_compound` → `res_mfg_ordnance_charge`; `res_raw_isotopes` → `res_refined_precision_circuitry` → `res_mfg_guidance_assembly`) follow the identical shape with the names, yields, and descriptions from §1.

`unitMass` is set to 1.0 ton/unit uniformly here as a placeholder; a balance pass may want the precision lane's unit mass lower (isotopes are valuable in small quantities) — see §7.

---

## 3. Cost derivation

`buildCost` is computed once per catalogue entry (weapon, module, or ship hull), expressed in **manufactured-tier units**. Constants (`K_*`) below are illustrative defaults, not a balanced economy — see §7.

### 3.1 Weapons

```
structural = ANCHOR[weapon.size].dmg * K_struct
energy     = weapon.powerCost * K_energy
ordnance   = weapon.damage.base * ORDNANCE_SHARE[weapon.weaponClass] * K_ord
precision  = weapon.accuracy.tracking * K_prec + weapon.criticalChance * K_critPrec
```

`ANCHOR[size].dmg` reuses the size-anchor table **already defined** in `generate_weapons.py` (`small: 20.0, medium: 44.0, large: 95.0, capital: 190.0`) as the structural-scale proxy, rather than inventing a second per-size constant — a weapon's physical bulk already tracks its size anchor.

`ORDNANCE_SHARE` reflects how much of a weapon's damage output is "consumed" as physical ordnance versus generated electronically:

| weaponClass | ordnanceShare | Why |
|---|---|---|
| missile | 0.70 | Mostly warhead. |
| mine | 0.75 | Almost entirely warhead. |
| kinetic | 0.35 | Slug + propellant charge, moderate. |
| melee | 0.10 | Mostly structural (the ram/drill itself), minimal ordnance. |
| energy | 0.05 | Capacitor-discharge, negligible consumable ordnance. |

Mark and family differences need no separate handling: they already move `damage.base`, `powerCost`, `tracking`, and `criticalChance` in the existing generator, so `buildCost` inherits mark/family variation automatically — a Mk.5 costs more than a Mk.1 of the same archetype because it *is* stronger, not because of a second cost ladder.

**Worked example — `wpn_092`, Vanguard Mass Driver Mk.3** (medium, kinetic; `damage.base 118.0`, `powerCost 20.3`, `tracking 10`, `criticalChance 0.18`), with `K_struct=0.05, K_energy=0.15, K_ord=0.04, K_prec=0.05, K_critPrec=5`:

```
structural = 44.0 * 0.05                        = 2.20
energy     = 20.3 * 0.15                         ≈ 3.05  (3.045)
ordnance   = 118.0 * 0.35 * 0.04                 ≈ 1.65  (1.652)
precision  = 10 * 0.05 + 0.18 * 5                = 1.40

buildCost: { structural: 2.20, energy: 3.05, ordnance: 1.65, precision: 1.40 }
```

Walking that back down the chain (§1 yields) to see the full raw-material footprint of one weapon:

| Lane | Manufactured | ÷0.85 → Refined | ÷ refine yield → Raw |
|---|---|---|---|
| Structural | 2.20 | 2.59 | 2.59 / 0.90 = **2.88** Ferrite Ore |
| Energy | 3.05 | 3.59 | 3.59 / 0.80 = **4.49** Conductive Crystal |
| Ordnance | 1.65 | 1.94 | 1.94 / 0.75 = **2.59** Volatile Compound |
| Precision | 1.40 | 1.65 | 1.65 / 0.50 = **3.29** Rare Isotopes |

Note the precision lane needs more raw input per finished unit than any other lane despite having the smallest manufactured quantity — the low refinement yield (rare isotopes are scarce) makes precision electronics the material bottleneck, which is the intended texture from §1.

### 3.2 Modules

```
structural = module.mass.value * K_modStruct
energy     = module.powerCost * K_modEnergy
precision  = (module.moduleType in {sensor-related, ecm, command}) ? effectMagnitude * K_modPrec : baseline
ordnance   ≈ 0   (ammunition-magazine modules are the one exception — scale with ammoCapacity effect instead)
```

Modules don't have a `damage` field, so the ordnance lane is near-zero for the general case; only cargo-class modules that grant `ammoCapacity` (e.g. Ammunition Magazine) pick up a small ordnance cost proportional to that capacity bonus.

### 3.3 Ships (bare hull only — fitted weapons/modules are summed separately)

```
structural = mass.value * K_hullStruct + hull.maxHP * K_hullHP
energy     = power.maxPower * K_hullEnergy
precision  = (componentHitpoints.bridge.maxHP + componentHitpoints.sensorArray.maxHP) * K_hullPrec
ordnance   ≈ 0   (bare hull carries no ordnance; a ship's total ordnance cost comes entirely from its fitted weapons)
```

A ship's **total** build cost is additive and bottom-up, matching how ships already fit from the weapon/module catalogues in `generate_ships.py`:

```
shipTotalCost = hullCost + Σ(buildCost of every fitted weapon) + Σ(buildCost of every fitted module)
```

**Worked example — bare hull, *Whisperfang*** (`mass.value 831`, `hull.maxHP 345`, `power.maxPower 78`, `bridge.maxHP 50`, `sensorArray.maxHP 39`), with `K_hullStruct=0.02, K_hullHP=0.03, K_hullEnergy=0.10, K_hullPrec=0.05`:

```
structural = 831*0.02 + 345*0.03   = 16.62 + 10.35  = 26.97
energy     = 78*0.10                                = 7.80
precision  = (50+39)*0.05                           = 4.45
ordnance                                             = 0.00

bareHullCost: { structural: 26.97, energy: 7.80, ordnance: 0.00, precision: 4.45 }
```

The ship's fully-fitted total would add the `buildCost` of every weapon in its `hardpoints.list` and every module in its `moduleSlots.list` on top of this — not computed here since it only requires summing entries this document already shows how to derive.

---

## 4. Schema integration

- Weapon, module, and ship schemas each gain one new field:
  ```
  "buildCost": { "structural": "number", "energy": "number", "ordnance": "number", "precision": "number" }
  ```
  in manufactured-tier units, matching where each schema's other derived fields already live (sibling to `damage`/`powerCost` on a weapon, sibling to `effects`/`powerCost` on a module, sibling to `hull`/`power` on a ship).
- `unitMass` on each resource entry ties into the **existing** `ship.capacities.cargo` field (tons) — a hauler's cargo tonnage now has something concrete to carry, with no schema change needed on the ship side.
- No change to `weapon.interface` / `module.interface` / `ship.interface`'s existing fields — `buildCost` is additive, so nothing currently reading those files breaks.

---

## 5. File layout

Follows the existing `Ships/` / `Weapons/` / `Modules/` convention:

```
Resources/
  raw/            res_raw_ferrite.json, res_raw_conductive.json, res_raw_volatile.json, res_raw_isotopes.json
  refined/        res_refined_structural_alloy.json, ...
  manufactured/   res_mfg_structural_component.json, ...
  index.json      all 12 entries, tagged by tier/lane

Data-Templates/
  resource.interface     (new — mirrors weapon.interface's header+schema+example format)

tools/
  generate_resources.py  (new — emits the 12 static catalogue entries; no RNG, same as the rest of the pipeline)
  verify_resources.py    (new — see §6)
```

`fleet_and_weapons.json` gains a `resources` key (12 entries) in `_meta`'s pattern alongside `ships`/`weapons`/`modules`.

**Generator ordering** (future work, not part of this spec's scope): the cost formulas read their constants from a pure-logic Python module (`tools/resource_costs.py`), not from the generated `Resources/` catalogue, so `generate_resources.py` has no ordering dependency on the other three — it only needs to run before `verify_resources.py`. The real constraint is narrower: `generate_weapons.py` and `generate_modules.py` must run before `generate_ships.py`, since ships sum the `buildCost` those two catalogues have already written.

---

## 6. Verification (future `verify_resources.py`, mirroring the existing verifier style)

- Both yields (`raw→refined`, `refined→manufactured`) are strictly `< 1.0` and `> 0` for all 12 entries.
- `buildCost` is monotonic non-decreasing with mark ladder for a fixed archetype/family/size (a Mk.4 never costs less than the Mk.3 it's strictly stronger than).
- Chain consistency: walking a `buildCost` manufactured quantity back down through `refinesFrom`/`conversionYield` to raw reproduces the same number whichever lane it's computed through (no drift between the stored catalogue yields and the formula in §3).
- Every `refinesFrom`/`refinesInto` cross-reference resolves to a real `resourceId`, and each lane's three tiers form an unbroken chain (raw → refined → manufactured, no gaps).

---

## 7. Open decisions / calibration notes

1. **All `K_*` constants in §3 are placeholders**, picked to produce plausible-looking numbers for the worked examples, not a balanced economy. A real balance pass (e.g. checking that a capital-ship's total cost sits at a sensible multiple of a destroyer's, matching the ~20x mass ratio) should happen before these ship as real data.
2. **Whether `buildCost` also stores the expanded raw/refined equivalents**, or stays manufactured-only and leaves callers to walk the chain (as §3.1's worked-example table does by hand) — storing all three tiers is more convenient for consumers but duplicates data that's a pure function of the manufactured figure and the yield constants; leaning toward manufactured-only to match the project's "don't store what's a pure function of a table entry" ethos, but flagging it as a call worth confirming.
3. **`ORDNANCE_SHARE` is per-`weaponClass`**, not per-archetype or per-`specialEffect`. A Flak Cannon (kinetic) and a Railgun (kinetic) currently get the same 0.35 share despite very different ammunition profiles. Fine for a first pass; may want per-archetype refinement later without needing a second hand-authored table (e.g. derive share from whether `ammo` is finite vs `"infinite"` instead of from class alone).
4. **Module cost formula (§3.2) is the least fleshed out** of the three — `effectMagnitude` isn't a concretely defined quantity yet (module effects are heterogeneous: `topSpeed +7.2%` vs `cargoCapacity +30%` aren't directly comparable). Needs its own short pass once weapon/ship cost is validated, likely normalizing each module's `effects[]` entries against the stat's typical range before feeding `K_modPrec`.
5. **The precision-bottleneck design texture (§1, §3.1) doesn't survive to ship scale.** At weapon scale precision is correctly the material bottleneck, as intended — `wpn_092` expands to `{structural 2.88, energy 4.47, ordnance 2.59, precision 3.30}` raw, precision largest. At ship scale it inverts — a Battleship Tier 3 expands to roughly `{structural 2418, energy 243, ordnance 41, precision 570}` raw, structural outweighing precision more than 4:1, because hull mass swamps everything at that scale. Relatedly, cost scales strongly sublinearly against mass: a ~1,691× mass difference between the smallest and largest hulls produces only a ~124× cost difference. Neither is a bug — the monotonicity ladders are all correct — but both are exactly the "is a capital ship a sensible multiple of a destroyer?" texture question a balance pass should look at.
