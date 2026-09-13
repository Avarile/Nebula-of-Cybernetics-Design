# Nebula of Cybernetics — Fleet Data

Design data for a turn-based ship combat system: hulls, weapons and modules, the
resources they are built from and the skills a player trains to use them, plus the
schemas they conform to and the generators that produce them.

Everything under `Ships/`, `Weapons/`, `Modules/`, `Resources/` and `Skills/`, and the
`ships` / `weapons` / `modules` / `namedShips` / `resources` / `skills` arrays in
`fleet_and_weapons.json`, is **generated**. No RNG is
involved — every value is a pure function of a table entry, so re-running the pipeline
reproduces the whole tree byte-for-byte. Edit the tables in `tools/`, never the output.

## Contents

| | count | |
|---|---|---|
| Ship categories | 26 | motor torpedo boat (30 t) → battleship (72,000 t) |
| Tier hulls | 78 | 3 tiers per category, fully fitted |
| Named ships | 20 | instances of a class, each with its own loadout |
| Weapons | 798 | 31 archetypes × 4 sizes × 10 manufacturers × Mk.1–5 |
| Modules | 135 | 45 archetypes × Mk.1–3, across 7 slot types |
| Resources | 12 | 4 lanes (structural/energy/ordnance/precision) × 3 tiers (raw/refined/manufactured) |
| Skills | 80 | 4 domains, 10 levels each; 52 of them are the 26 hulls × control/systems |
| Files on disk | 1,901 | 869 under `Ships/`, 799 under `Weapons/`, 136 under `Modules/`, 15 under `Resources/`, 82 under `Skills/` |

## Layout

```
data-template.json           original schema design; the upstream reference
fleet_and_weapons.json       the whole dataset in one file (see "Keys" below)

Data-Templates/              the schema each generated file conforms to
  ship.interface
  weapon.interface
  module.interface
  resource.interface
  skill.interface

Ships/<Category>/            one folder per ship category, prose-named
  tier-1/  tier-2/  tier-3/  a hull is a DIRECTORY, not a file
    ship.json                  the hull
    Weapons/                   one file per filled hardpoint
    Modules/                   one file per filled slot
  <Named ship>/              e.g. Ships/Destroyer/Whisperfang/ — same layout
  index.json                 all 98 hulls, tagged kind: template | named

Weapons/<class>/<size>/      wpn_###_<name>.json    (kinetic/energy/missile/mine/melee)
  index.json

Modules/<slotType>/<functionClass>/   mod_<archetype>_mk<n>.json
  index.json

Resources/<tier>/            res_<tier>_<slug>.json   (raw/refined/manufactured)
  index.json

Skills/<domain>/<category>/  skl_<group>_<slug>.json
  Design                     the hand-written spec the catalogue is derived from
  index.json

tools/                       generators, verifiers, and the tables that drive them

Reference/                   TypeScript interface for all of the above, plus Combat-logic
  common.ts resources.ts weapons.ts modules.ts ships.ts skills.ts combat.ts
  dataset.ts constants.ts
```

`.interface` files are `#`-commented headers followed by a JSON body — strip the comment
lines and the remainder parses as JSON.

### Keys in `fleet_and_weapons.json`

| key | contents |
|---|---|
| `_meta` | counts, category list, family list |
| `ships` | the 78 tier hulls (class templates) |
| `namedShips` | the 20 named ships; each carries `templateId` naming its class hull |
| `weapons` | all 798 |
| `modules` | all 135 |
| `resources` | all 12 |
| `skills` | all 80 |

## The five catalogues

### Weapons — `archetype × mark × family`

```
stat = size anchor  ×  archetype signature  ×  mark ladder  ×  family bias
```

* **archetype** (31) sets the role: a PD autocannon is fast, weak and high-tracking; a
  particle lance is slow, huge and can barely track. It also fixes the `specialEffects`.
* **size** (small/medium/large/capital) sets the absolute band. A weapon may only be
  mounted on a hardpoint of the **same** size.
* **mark 1–5** is a strict power ladder: ~+13% damage per mark with cost rising more
  slowly, plus capability steps — a second effect at Mk.3 (Mk.2 for Ashwright), tighter
  variance and one less cooldown turn at Mk.5. Five legacy weapons carry a Mk.6.
* **family** (10 manufacturers) is a trade-neutral bias. Vanguard is the neutral
  reference line; Kestrel trades damage for rate of fire, Voss for range, Halcyon for
  accuracy, Draconis the reverse, Solari for power efficiency, and so on.

Same archetype, same mark, three manufacturers:

```
Halcyon Railgun Mk.3        dmg 134.0  rof 1/1  trk 29  hit 0.84  rng 2315  pw 33.1
Solari Heavy Railgun Mk.3   dmg 141.9  rof 1/1  trk 22  hit 0.77  rng 2315  pw 23.1
Voss Heavy Railgun Mk.3     dmg 165.6  rof 1/2  trk 20  hit 0.77  rng 3357  pw 36.4
```

By class: kinetic 232, energy 255, missile 157, mine 94, melee 60.

### Modules — `archetype × mark`, classified by role

```
value = archetype base  ×  mark ladder        (Mk.1–3, matching ship tiers 1–3)
```

`functionClass` says what role the module plays:

* **major** (51) — a core system the ship is built around: propulsion, power generation,
  command, primary sensors.
* **support** (48) — force multipliers: repair, ECM, shield boosters, armour.
* **specific** (36) — mission equipment only certain hulls carry, gated by
  `hullAffinity`: minesweep gear, mine rails, seaplane catapult, cargo derrick,
  landing craft davits, refuelling rig, hospital bay.

Benefits scale ×1.20 per mark while **drawbacks shrink** ×0.90, so a higher mark is never
a worse trade — Belt Armour's speed penalty goes −5% → −4.1% from Mk.1 to Mk.3. Mk.3 adds
a second effect where the archetype has one.

Slot types: `engine · utility · defensive · sensor · cargo · command · hangar`
(the last two added for CIC/flag facilities and drone/aviation gear).

### Ships — `category signature × tier`

Each of the 26 categories has a signature in `tools/ship_tables.py`: mass band, armour and
shield type, how many mounts at which sizes, which slot types, mobility, capacities, and
what it reaches for when arming itself. Tier 1 sits low in the mass band, tier 3 high;
hull, shields, power and crew skill rise per tier, and tiers 2 and 3 add mounts and slots.

Hulls arrive **fitted**. Weapons and modules are chosen at `mark == tier` from a
per-category preference order, and a `specific` module is only fitted where its
`hullAffinity` permits — which is why the minelayer carries mine rails and sweep gear,
the transport a cargo derrick, and the battleship neither.

```
Battleship Tier 3     65,100 t  heavy   15,855 hp  speed 336  crew 847
  3× capital Gauss Cannon Mk.3, 2× large, AA at medium and small
  Ion Drive · CIC Tower · Belt Armour · Search Radar

Motor Torpedo Boat T1     38 t  light       37 hp  speed 620  crew 7
  2× small Seeker Missile Mk.1 · Manoeuvring Thrusters (no shields at all)
```

Two hull budgets are enforced rather than assumed: `power.maxPower` covers passive module
draw plus one full weapon volley, and `maxCrew` covers the fitted modules' `crewRequired`.

### Resources — `lane × tier`

Resources are organized by 4 **lanes** (structural, energy, ordnance, precision) and 3 **tiers** (raw, refined, manufactured). Raw→refined yield is lane-specific — 0.90/0.80/0.75/0.50 for structural/energy/ordnance/precision respectively — while refined→manufactured yield is uniform at 0.85 across all lanes. The low precision-lane yield is deliberate: rare isotopes refine poorly, making precision electronics the most raw-material-intensive lane per finished unit. `unitMass` is currently a uniform 1.0 ton/unit placeholder across all 12 resources (see `Resources/resource_tiers_specification.md` §7 for calibration notes).

Every weapon, module, and ship carries a `buildCost` field — the cost to manufacture it, expressed in manufactured-resource units, derived from the item's own stats (mass, power, damage, size, etc.) via cost-scaling formulas. See `Resources/resource_tiers_specification.md` for the full derivation.

### Skills — `domain × category`, gates and ladders

Skills are what lets a player do anything: fly a hull, fire a weapon class, run a
refinery, hold a fleet together. `Skills/Design` is the hand-written spec; the catalogue
is derived from it and every number traces back to a line there, or is marked `PROPOSED`
in `tools/skill_tables.py` where the spec names a skill without giving its figures.

Every skill has 10 levels and works through four lists, any of which may be empty:
`effects[]` (a per-level modifier on a stat), `penalties[]` (a flat malus below a level),
`unlocks[]` (a hull, fleet slot, capability or skill group), `prerequisites[]` (another
skill that must reach a level first). One rule covers every effect in the catalogue:

```
total = modifierPerLevel × max(0, level − appliesFromLevel + 1)
```

That is the whole arithmetic. Navigation (`appliesFromLevel 1`, +1%/level) reaches +10% at
level 10. The four Weaponry skills instead start at level 6 and pair that with a −50%
penalty below level 5, so level 5 is a clean baseline — debuff gone, bonus not yet
started, which is the spec's "below level 5 … 50% debuff, after level 5 each level +5%".

| domain | categories | n |
|---|---|---|
| `ship_command` | ship_system_control · navigation · scanning · engineering · weaponry · fleet_command | 68 |
| `station_management` | science · facility_management | 6 |
| `deep_space_mining` | mining_operations | 4 |
| `interaction_trade` | commerce | 2 |

Effects reuse the module stat vocabulary wherever a ship field already exists —
`topSpeed`, `repairRatePerTurn`, `detectionRange`, `evasionRating`. The 18 stats a skill
needs and no module has (`weaponDamage`, `miningYield`, `refineryYield`, `squadronSpeed`,
`tradePriceMargin` …) live alongside them in `tools/stat_vocabulary.py`, which both
generators now import so the two catalogues cannot drift apart.

Three gating rules are carried as data rather than prose:

* **Operating a hull.** A category is operable when *every* skill carrying an
  `unlocks[].type == "ship_operation"` for it has reached the stated level. Each of the 26
  categories has exactly two — Control and System Management, both at level 5 — so the
  spec's "both control and system management is required" is a property the verifier
  checks rather than a convention a reader has to honour.
* **Science gates industry.** `skl_sta_science` appears in `prerequisites` on every
  station and mining skill: level 3 opens raw operations, 5 refining, 7 fabrication.
* **Formation Drill gates fleet size.** Four `fleet_slot` unlocks at levels 5/7/8/10 for
  ships 2–5. The first ship needs no skill.

One cross-catalogue constraint is worth calling out, because it is the kind of thing that
only breaks from the outside: `refineryYield` multiplies a resource lane's
`conversionYield`, which `resource.interface` requires to stay strictly below 1. Material
Refinement Management is +1%/level for exactly that reason — structural is the highest
lane at 0.90, and 0.90 × 1.10 = 0.99. `verify_skills.py` recomputes this against the live
resource catalogue, so raising the per-level figure fails the build instead of quietly
producing a lane that refines without loss.

### Fitting files

A file in a ship's `Weapons/` or `Modules/` folder is the **full catalogue entry** with the
mount it occupies added at the front and a pointer back to the canonical copy:

```json
{ "hardpointId": "hp_1",
  "mountType": "missile_bay",
  "catalogue": "Weapons/missile/medium/wpn_776_draconis_torpedo_launcher_mk_2.json",
  "weaponId": "wpn_776", "name": "Draconis Torpedo Launcher Mk.2", "…": "…" }
```

Files are keyed by mount, so a ship carrying the same launcher on two hardpoints gets two
files (`hp_1_…`, `hp_2_…`). A verifier check confirms each payload is byte-identical to
the catalogue entry once the added fields are stripped.

## Schemas and the `[+]` convention

`data-template.json` is the original design and is left untouched. The `.interface` files
are the working schemas, and anything they add beyond it is marked `[+]` with the reason.
The substantive deviations:

| where | change |
|---|---|
| ship | `shipClass` collapsed to one flat enum of the 26 categories; `shipSubClass` dropped |
| ship | `tier`, `sensors`, `capacities` added; `moduleSlots.list[]` gained `size`, and its `slotType` gained `command` and `hangar` |
| weapon | none — the schema is `weaponSchema` verbatim |
| module | single `effect` → `effects[]`; plus `functionClass`, `slotType`, `size`, `mark`, `mass`, `crewRequired`, `hullAffinity` |
| skill | no upstream counterpart — `data-template.json` has no skill schema, so `skill.interface` is new in full |

`sensors` and `capacities` exist because module effects target 34 ship stats and roughly
half of them had no hull field to apply to. Most capacities read 0 — a battleship carries
no troops — which is exactly what makes a `specific` module specific.

## Regenerating

Order matters: weapons and modules before ships, since ships sum the `buildCost` those catalogues carry. `generate_resources.py` is independent and only needs to run before `verify_resources.py`. `generate_skills.py` is independent of all of them, but `verify_skills.py` reads the weapon and resource catalogues to check its cross-references, so run it last.

```sh
python3 tools/generate_resources.py   # 12 resources → Resources/, fleet json (cost constants)
python3 tools/generate_weapons.py     # 798 weapons  → Weapons/, fleet json
python3 tools/generate_modules.py     # 135 modules  → Modules/, fleet json, ship slot sync
python3 tools/generate_ships.py       # 98 hulls     → Ships/, fleet json
python3 tools/generate_skills.py      # 80 skills    → Skills/, fleet json
```

Each accepts `--dry-run` to print the shape it would produce without writing. Stale output
is cleared on each run: removed weapons, modules, tiers and named ships leave no orphan
files or directories behind.

## Verification

```sh
python3 tools/verify_resources.py     # 16 checks
python3 tools/verify_weapons.py       # 12 checks
python3 tools/verify_modules.py       # 23 checks
python3 tools/verify_ships.py         # 38 checks
python3 tools/verify_skills.py        # 32 checks
python3 Reference/verify_reference.py # 52 checks -- TypeScript interface vs. the data
```

All exit non-zero on failure. Between them they enforce: unique ids and names; field sets
matching the `.interface` schemas; monotonic mark and tier ladders; no duplicate stat
blocks; no weapon strictly dominated by a same-mark rival at equal-or-lower cost; module
effects restricted to a fixed stat vocabulary; `specific` modules only where
`hullAffinity` allows; every cross-reference resolving; hardpoint and slot sizes matching
what is fitted; power and crew budgets covering the fit; skill effects restricted to the
shared stat vocabulary, with an acyclic prerequisite graph, exactly two `ship_operation`
claimants per hull category and no penalty on a stat the same skill cannot buff back; and
every file on disk matching its entry in the JSON.

Two of these were written after the checks caught real bugs — whole-point rounding was
making higher weapon marks free upgrades, and Ceridan's sustain bias was inert on
infinite-ammo, no-cooldown weapons, making every Ceridan autocannon a strictly worse
Vanguard.

## Where to make changes

| to change | edit |
|---|---|
| resource lanes, yields, buildCost formulas | `tools/resource_costs.py` |
| weapon archetypes, family biases, mark ladder | `tools/generate_weapons.py` |
| module archetypes, effects, stat vocabulary | `tools/generate_modules.py` |
| ship categories: mass, armour, mounts, slots, capacities, doctrine | `tools/ship_tables.py` |
| how hulls are derived and fitted | `tools/generate_ships.py` |
| skills: levels, effects, unlocks, prerequisites | `tools/skill_tables.py` |
| the stat vocabulary modules and skills share | `tools/stat_vocabulary.py` |

Then re-run the pipeline. The archetype and family tables inside `weapon.interface` and
`module.interface` are emitted by the generators, so documentation and data cannot drift.

Never hand-edit files under `Ships/`, `Weapons/`, `Modules/`, `Resources/` or `Skills/` —
the next run overwrites them. Two directories are partial exceptions, and their generators
clear only their own subtrees rather than the whole directory: `Resources/` regenerates
`raw/`, `refined/`, `manufactured/` and `index.json`, leaving its two hand-written `.md`
docs alone, and `Skills/` regenerates the four domain directories and `index.json`,
leaving the hand-written `Skills/Design` spec alone. Both verifiers assert those
hand-written files are still there after a run.

## Notes

* Counts in this README are as of the current generated state; `tools/*.py --dry-run`
  reprints them.
* `tools/__pycache__/` is a Python build artefact and can be deleted at any time.
* Two ship-category folders differ from their enum values because `/` cannot appear in a
  directory name: `Ships/Sloop - patrol escort` and `Ships/Minelayer - sweeper`.
