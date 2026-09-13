# Reference — TypeScript interface

A typed description of the data that already exists in this repo: the six
catalogues (`Resources`, `Ships`, `Weapons`, `Modules`, `Skills`, `Systems_Planets`)
and the combat logic that consumes them. Nothing here proposes a change to the data —
every literal union was extracted from `fleet_and_weapons.json` and the generator
tables in `tools/`, then cross-checked against the `.interface` schemas in
`Data-Templates/`.

## Files

| file | contents |
|---|---|
| `common.ts` | primitives and the vocabularies two or more catalogues share (`Size`, `MountType`, `ModuleSlotType`, `BuildCost`, id formats) |
| `resources.ts` | 4 lanes × 3 tiers, the refining chain, and the cost model that turns stats into a `buildCost` |
| `weapons.ts` | the 798 weapons, plus the four generator axes behind every stat block |
| `modules.ts` | the 135 modules, the 34-stat effect vocabulary, and the `functionClass` split |
| `ships.ts` | the 26 classes, 78 tier hulls and 20 named ships, plus the per-category signature table |
| `skills.ts` | the 81 skills across 4 domains, the 18 skill-only stats, the EVE-style SP model, and the gates for hulls, fleet slots and industry |
| `systems.ts` | the 60 systems and 180 planets, the security/richness/development ladders, the jump-gate graph, and the archetype table a planet's industry is built from |
| `combat.ts` | turn structure, hit and damage resolution, missiles/point-defense, criticals, both logging tiers, and the open rulings |
| `dataset.ts` | on-disk shapes: `fleet_and_weapons.json`, the six `index.json` files, a fitted hull directory |
| `constants.ts` | the tuning tables the types describe — family bias, mass bands, yields, cost coefficients, range bands, critical table, skill gates and the effect formula |
| `index.ts` | barrel re-export |
| `verify_reference.py` | checks the unions and field sets against the live data |

```ts
import type { FleetDataset, Ship, Weapon, CombatantState } from './Reference';
import { WEAPON_HIT_PROFILES, RANGE_BANDS, SHIP_MASS_BANDS } from './Reference/constants';

const fleet = JSON.parse(await readFile('fleet_and_weapons.json', 'utf8')) as FleetDataset;
```

Requires TypeScript 4.9+ (`constants.ts` uses `satisfies`). Checked with
`tsc --noEmit --strict`.

## What the types add over the `.interface` schemas

The `.interface` files are prose-annotated JSON. Moving to TypeScript let several
invariants that are currently comments — or verifier checks — become part of the
type:

- **`Resource` is discriminated on `tier`.** Narrowing to `RawResource` settles
  that `refinesFrom` and `conversionYield` are `null` and `refinesInto` is not;
  narrowing to `ManufacturedResource` settles the opposite end. The "unbroken
  chain per lane" rule stops being a runtime check for the nullability half.
- **`Module` is discriminated on `functionClass`.** `SpecificModule` types
  `hullAffinity` as `[ShipClass, ...ShipClass[]]` and `MajorModule`/`SupportModule`
  type it as `[]`, which is exactly the verifier rule "`specific` has a non-empty
  `hullAffinity`, the others empty".
- **`Ship` is discriminated on `templateId`.** A tier hull cannot carry one; a
  named ship must.
- **`Skill` is discriminated on `domain`, and `SkillUnlock` on `type`.** Narrowing a
  skill to `ship_command` settles which six categories are legal for it, which is
  the verifier's "category belongs to its domain" rule as a type. Narrowing an
  unlock settles what `target` means — a `ShipClass`, a fleet position `'2'`–`'5'`,
  a capability key or a skill group — and `ShipOperationUnlock.level` is the
  literal `5`, so the pair rule cannot be written down at the wrong level.
- **Skill ids are fully typed, including the derived ones.** The 52 hull skills are
  the template literals `skl_ship_${ShipClass}_control` / `_systems` and the other
  28 are a literal union, so `skl_ship_frigate_control` is a compile error rather
  than a lookup returning `undefined`.
- **The stat vocabulary is split, not duplicated.** `SkillEffectStat` is
  `ModuleEffectStat | SkillOnlyStat`. The 18 skill-only stats have no field on the
  hull, so `ModuleEffect` cannot target one — a module that tries to modify
  `miningYield` does not compile.
- **`HullPrerequisite` encodes which rung you are on.** It is a three-arm union:
  the root at level `1`, a Control skill at level `5`, or a System Management skill
  at level `5`. Narrowing on `skillId` settles the level, so a hull rung written at
  level 3 — or the root written at level 5 — is a compile error, not a verifier
  finding. The "ladders never cross" rule falls out of the arms being separate.
- **Component critical effects are literal strings.** `componentHitpoints.bridge`
  is typed to the one string it ever holds, so a typo in a hand-built fixture is
  a compile error.
- **Catalogue vs. fitted entries are separate types.** `FittedWeapon` /
  `FittedModule` are the catalogue entry plus the mount it occupies plus a
  `catalogue` path back — the shape the files under `Ships/<hull>/Weapons/` and
  `.../Modules/` actually have.
- **Combat intermediates are modelled, not just results.** `HitChanceResolution`
  carries every term of the reconciled formula in resolution order, which is what
  makes the Tier 1 log replayable and the Tier 2 narrative regenerable.
- **`CombatantState` separates the build sheet from the battle.** `Ship` is
  immutable; current HP, ammo, cooldowns, locks and status effects live in the
  runtime state, so a battle can be replayed against a pristine roster.

## Things the analysis turned up

Recorded here rather than fixed, since `Reference/` describes the data and does
not generate it.

1. **`moduleType` is 37 values, not 33.** `Data-Templates/module.interface` still
   says `"enum: 33 values"`. `ModuleType` declares the 37 the data actually
   carries.
2. **Ten module ids predate the id convention.** The schema documents
   `mod_<archetype>_mk<n>`; `mod_ion_drive_std`, `mod_ion_drive_hp`,
   `mod_power_core_std`, `mod_repair_drone_std`, `mod_ecm_std`, `mod_ecounter_std`,
   `mod_shield_booster_1`, `mod_shield_booster_2`, `mod_armor_plate_std` and
   `mod_cargo_expander` do not match it. `ModuleId` stays open rather than
   asserting a suffix the data lacks.
3. **`crew.pilotSkill` is in the module stat vocabulary but unused.** No archetype
   targets it. It is declared in `ModuleEffectStat` because the schema permits it,
   and `verify_reference.py` whitelists it as schema-only.
4. **`reactive` armour appears only on named ships.** All four reactive-armour
   hulls are battleships (`Leviathan Crown`, `World Ender`, `Emperor's Bastion`,
   `Cataclysm Prime`); no tier hull uses it.
5. **`range.falloffPenalty` is superseded but retained.** It belongs to v1's hit
   formula; v2's range-band table replaced it for hit resolution. The field is
   still on every weapon, so it is still on the type, flagged in its doc comment.
6. **Five combat rulings are still open.** `extends` naming a file that does not
   exist, whether gunnery skill and the component-targeting penalty survive into
   v2, eleven of thirteen `specialEffects` having no numeric rule, the 15%-vs-30%
   retreat threshold, and the undefined `sensorDebuff` term. They are modelled as
   `OPEN_RULINGS` in `combat.ts` rather than silently resolved — an implementer
   gets the conflict and the recommendation, not a guess presented as a rule.
7. **`drone` is a weapon-skill class with no weapon catalogue behind it.**
   `Skills/Design` lists Drones beside Ballistic, Energy and Missiles, but drones
   are hangar-launched craft (`droneCapacity`, hangar slots) and there is no
   `weaponClass: 'drone'` in `Weapons/`. `SkillWeaponClass` is therefore
   `WeaponClass | 'drone'`, and `tools/verify_skills.py` asserts the difference
   from the catalogue is exactly that one value.
8. **`mine` and `melee` have no weapon skill.** Four Weaponry skills cover
   kinetic, energy, missile and drone; the mine and melee classes in the weapon
   catalogue are trained by nothing. Declared in `SkillWeaponClass` because the
   type is built from `WeaponClass`, and whitelisted as schema-only in the
   verifier.

## Verification

```sh
python3 Reference/verify_reference.py     # 59 checks
```

Every string-literal union must declare exactly the values present in the data —
no missing member, no invented one — and every entity interface must declare
exactly the field set the data carries. The script exits non-zero on failure, in
the style of `tools/verify_*.py`.

Re-run it after any generator change: if a new archetype, effect, ship class or
skill lands in the data, it fails until the union here is updated.

Two unions cannot be read from the source by the script's regex and are checked
structurally instead: the 52 hull skill ids (template literals over `ShipClass`)
and `SkillWeaponClass` (`WeaponClass | 'drone'`).

Type-checked with:

```sh
tsc --noEmit --strict Reference/*.ts
```

All 81 live skills, `Skills/index.json` and `_meta` were additionally checked to be
assignable to `Skill[]`, `SkillIndex` and `FleetMeta` as literals — the whole
catalogue, not a sample — along with eight `@ts-expect-error` negative cases covering
the id namespace, the level ladder and both `HullPrerequisite` arms.
