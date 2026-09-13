# Nebula of Cybernetics — Fleet Data

Design data for a turn-based ship combat system: hulls, weapons and modules, the
resources they are built from and the skills a player trains to use them, plus the
schemas they conform to and the generators that produce them.

Everything under `Ships/`, `Weapons/`, `Modules/`, `Resources/`, `Skills/` and
`Systems_Planets/`, and the `ships` / `weapons` / `modules` / `namedShips` / `resources`
/ `skills` / `systems` / `planets` arrays in `fleet_and_weapons.json`, is **generated**.
No RNG is involved — every value is a pure function of a table entry, so re-running the
pipeline reproduces the whole tree byte-for-byte. Edit the tables in `tools/`, never the
output.

## Contents

| | count | |
|---|---|---|
| Ship categories | 26 | motor torpedo boat (30 t) → battleship (72,000 t) |
| Tier hulls | 78 | 3 tiers per category, fully fitted |
| Named ships | 20 | instances of a class, each with its own loadout |
| Weapons | 798 | 31 archetypes × 4 sizes × 10 manufacturers × Mk.1–5 |
| Modules | 135 | 45 archetypes × Mk.1–3, across 7 slot types |
| Resources | 12 | 4 lanes (structural/energy/ordnance/precision) × 3 tiers (raw/refined/manufactured) |
| Skills | 81 | 4 domains, 10 levels each; 52 of them are the 26 hulls × control/systems |
| Systems | 60 | 6 regions × 16 constellations; a verified jump-gate graph |
| Planets | 180 | 10 archetypes × richness 1–3 × development 1–3 |
| Tradeable goods | 1,043 | every weapon, module, hull and resource, priced from its `buildCost` |
| Planet archetypes | 10 | × 3 development tiers = 30 rows of leasable industrial capacity |
| Files on disk | 2,146 | 869 under `Ships/`, 799 under `Weapons/`, 136 under `Modules/`, 15 under `Resources/`, 83 under `Skills/`, 244 under `Systems_Planets/` |

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
  system.interface
  planet.interface

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

Systems_Planets/<Region>/<System>/
  system.json                star, security, belts, connections
  planets/pln_###_<slug>.json
  links.json                 every gate once, canonical
  index.json
  systems_planets_specification.md        hand-written, survives a run
  systems_planets_implementation_plan.md  hand-written, survives a run

GamePlay/                    the rules layer: how a player spends a day
  PlayerSpecific             the hand-written brief everything traces back to
  gameplay_specification.md  MASTER -- vocabulary, core loop, cross-cutting invariants
  turn_specification.md      the 24h turn: 14 phases, orders, determinism
  progression_specification.md
  industry_specification.md  leases, slots, warehouses, the material chain
  logistics_specification.md jump range, fuel, cargo, interdiction
  economy_specification.md   credits, prices, markets, contracts, unions
  conflict_specification.md  PvE, PvP, destruction, insurance, raiding
  Progression/ Market/ Facilities/ NPC/     the generated half

tools/                       generators, verifiers, and the tables that drive them

Reference/                   TypeScript interface for all of the above, plus Combat-logic
  common.ts resources.ts weapons.ts modules.ts ships.ts skills.ts systems.ts combat.ts
  gameplay.ts economy.ts facilities.ts
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
| `skills` | all 81 |
| `systems` | all 60, each carrying its `asteroidBelts` and gate `connections` |
| `planets` | all 180 |
| `progression` | the SP ladder in turns, 26 hull paths, 5 career costs |
| `marketPrices` | a reference price for all 1,043 tradeable goods |
| `facilityTypes` | 30 rows: leasable slots by archetype × development tier |
| `npcSquadrons` | 5 hostile formations, composed of real hull ids |
| `contractArchetypes` | 4 job types and their reward formulas |

## The catalogues

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

Two of its systems are modelled on EVE Online: **skill points** with a rank multiplier,
and a **hull tree** where a lower hull's skill gates the one above it.

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
| `ship_command` | fundamentals · ship_system_control · navigation · scanning · engineering · weaponry · fleet_command | 69 |
| `station_management` | science · facility_management | 6 |
| `deep_space_mining` | mining_operations | 4 |
| `interaction_trade` | commerce | 2 |

Effects reuse the module stat vocabulary wherever a ship field already exists —
`topSpeed`, `repairRatePerTurn`, `detectionRange`, `evasionRating`. The 18 stats a skill
needs and no module has (`weaponDamage`, `miningYield`, `refineryYield`, `squadronSpeed`,
`tradePriceMargin` …) live alongside them in `tools/stat_vocabulary.py`, which both
generators now import so the two catalogues cannot drift apart.

#### Training — skill points

```
SP(level) = rank × 250 × k^(level − 1)        k = 2^(10/9) ≈ 2.16012
```

EVE runs 250 SP at level I to 256,000 at level V — a ×5.657 step over five levels. This
catalogue has ten, so `k` is re-derived to land on the *same two endpoints* rather than
inventing a curve: `k⁹ = 1024`, so level 10 is exactly `250 × 1024 = 256,000`. Same
start, same finish, twice the rungs. Every skill publishes a `training` block with the
figures already multiplied by `rank`, so a consumer never re-derives them:

```json
"training": { "spPerLevel": [...10], "spCumulative": [...10], "spTotal": 2382257 }
```

Training *time* stays out of the catalogue — it is `sp / rate`, and the rate belongs to
whatever character system consumes this. Against EVE's ~1,800 SP/hour reference the
shipped numbers land where EVE lands: a first hull ~11 hours out, a Battleship reached
along the spine ~8.7 days, that same spine maxed to level 10 ~419 days.

#### The hull tree

The 26 hulls form a prerequisite DAG rooted at **Spaceship Command**
(`skl_fund_spaceship_command` — deliberately outside the `skl_ship_*` namespace the 52
hull skills own). Each hull names exactly one predecessor and cannot be trained until
that predecessor reaches level 5. Three entry hulls sit on the root instead.

```
Spaceship Command ─┬─ Motor Torpedo Boat ── Fleet Torpedo Boat
                   ├─ Submarine Chaser ──── Submarine
                   └─ Corvette ─┬─ Landing Ship Tank ─┬─ Attack Transport ── Fleet Oiler
                                │                     ├─ Seaplane Tender
                                │                     └─ Repair Ship / Tender
                                ├─ Sloop / Patrol Escort ── Minelayer / Sweeper
                                └─ Destroyer Escort ─┬─ Anti-Aircraft Cruiser
                                                     ├─ Coastal Defence ── Monitor ── Panzerschiff
                                                     └─ Destroyer ─┬─ Merchant Raider
                                                                   └─ Light Cruiser ─┬─ Light Carrier ── Escort Carrier ── Fleet Aircraft Carrier
                                                                                     └─ Heavy Cruiser ── Battlecruiser ── Battleship
```

The auxiliary line is deliberately short — a tanker pilot never touches the combat
spine, the same way EVE's Industrial line branches away early. **The two ladders never
cross**: Control requires the predecessor's Control, System Management requires the
predecessor's System Management, both at level 5. That reuses the operate gate, so
"can fly it" and "can train up from it" are one threshold rather than four.

Three more gating rules are carried as data rather than prose:

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

### Systems & Planets — `archetype × richnessTier × developmentTier`

The map: 60 systems in 6 regions, joined by a gate graph, holding 180 planets.
`Systems_Planets/systems_planets_specification.md` is the hand-written spec.

Two 1–3 ladders drive every number, and **they point in opposite directions**:

```
richnessTier      rises as security FALLS    scales EXTRACTION
developmentTier   rises as security RISES    scales INDUSTRY
```

| security | systems | richness | development |
|---|---|---|---|
| `core` | 11 | 1 | 3 |
| `mid` | 19 | 1–2 | 2 |
| `rim` | 18 | 2–3 | 1–2 |
| `deadspace` | 12 | 3 | 1 |

The ore is where it will get you killed; the factories are where it is safe. Neither
end is self-sufficient, so material has to move — which is the point of having a graph.
`irradiated` and `shattered` worlds, the only strong precision-lane sources, exist only
in `rim` and `deadspace`; `forge_world`, the only capital yard, only in `core` and `mid`.

A planet exists because the **station-management skills are pure percentage multipliers
with no base of their own**. This catalogue supplies the bases:

| planet field | multiplied by |
|---|---|
| `extraction` | `planetaryProductionRate` |
| `warehouse.capacity` | `warehouseCapacity` |
| `refinery` | `refineryYield` |
| `manufactory` | `manufacturingRate` |
| `shipyard` | `shipConstructionRate` |
| system `asteroidBelts` | `miningYield`, `miningCycleSpeed` |

Two invariants are enforced against other catalogues rather than assumed:

* **Refining can never become lossless.** Effective yield is
  `lane.conversionYield × planet.refinery.yieldModifier × skillMultiplier`, and
  `resource.interface` requires it below 1. Worst case `0.90 × 1.00 × 1.10 = 0.99` — a
  margin of 0.01, which is why `yieldModifier` caps at 1.00 and scales with neither
  ladder. The verifier reads all three numbers live, so raising the skill, a lane yield
  or a modifier fails the build.
* **Every region has at least one shipyard.** Only `oceanic`, `hive_world` and
  `forge_world` carry berths, and none of the three may exist in deadspace, so
  **deadspace cannot build a hull at all**: you extract there and carry the material
  home. It is tight rather than comfortable — The Pale Hollow, eight of whose ten
  systems are deadspace, has exactly one yard, sitting in one of its two `rim` systems.
  Two sibling checks stay active alongside it — the single heaviest hull has a yard, and
  every category has one (the latter only ever failing in lockstep with the former, kept
  for its diagnostics and for counting named ships). A third version, asserting yard
  counts fall as hulls get heavier, was a genuine tautology — nested threshold sets can
  never disagree — and was deleted; see `systems_planets_specification.md` §6.2. Tonnage
  still clears the bar that matters: a forge world at development 3 reaches 81,600 t
  against the 65,100 t Battleship Tier 3, while a hive world tops out at 38,400 t, so a
  capital keel needs a developed core-or-mid forge world specifically.

The graph is proved navigable, not assumed: symmetric, loop-free, duplicate-free, and
fully connected — every system reachable from `sys_001` by graph traversal.

### GamePlay — the rules layer

The six catalogues above describe *things*. `GamePlay/` describes **what a player does with
a day**, and it is where the numbers the other catalogues carry finally get consumed.

```
turn  = 24 real hours, 14 ordered phases, one clock for the whole universe
round = one exchange inside a battle; a whole engagement fits in phase 9 of one turn
```

Everything already written "per turn" — 120 raw units from a `ferrous_barren`, 75
construction from a forge world — is a literal daily rate. Nothing was rescaled.

**Progression.** 43,200 SP/turn, flat, online or not (24 h × the catalogue's own
`SP_PER_HOUR_REFERENCE`). The ladder puts 98 % of a skill's cost in its last three levels,
which is the whole specialisation design expressed as arithmetic:

| | turns |
|---|---:|
| fly an entry hull | 0.5 |
| fly a battleship (both gates + the full spine) | 8.7 |
| a competent combat pilot | 12 |
| master one career | 103 – 582 |
| **all 81 skills** | **2,493 — 6.8 years** |

**Industry.** Planets stay terrain — no owner field, no conquest. Players lease indivisible
**slots**, subdivided from the archetype capacities so that `slotCount × slotThroughput`
reproduces the map spec's totals exactly. Development scales slot *size*, never slot *count*.
The sharpest consequence: a Battleship Tier 3 takes **39 turns on one forge-world berth and
10 on all four**, which is the strongest structural argument for unions in the game.

**Economy.** Only four raw prices are authored; the other 1,043 goods are derived by dividing
out the `conversionYield` the resource catalogue publishes and multiplying the `buildCost`
the item catalogues carry. A Battleship Tier 3 prices at **74,003 credits**, 47.5 % structural
and 44.8 % precision — the map's bottleneck, in money.

**Conflict.** `core` blocks PvP outright; `deadspace` has no rules and pays no insurance.
Ship loss is real: the wreck drops the *fit*, insurance covers the *bare hull*, and the two
run in opposite directions because a torpedo boat is 84 % fittings and a battleship 10 %.

### Authored rules vs. runtime state

The distinction that keeps the layer tractable, and the reason none of it had to wait on
the map generator:

* **Authored and generated** — the SP ladder in turns, reference prices, facility slot
  counts and rent, NPC squadrons and contract archetypes. Pure functions of a table.
* **Runtime, schema-pinned only** — players, fleets, leases, warehouse contents, market
  orders, contracts in flight, wrecks. Created by play; typed in `Reference/gameplay.ts`
  and `Data-Templates/`, never generated.

Facility rules key off planet *archetype and development tier*, both of which the map spec
already tables — never off a planet instance. The archetype table is **imported from**
`tools/system_tables.py` rather than copied, and now that the map is generated,
`verify_facilities.py` also checks that the slot subdivision reproduces the published
capacity of all **180 real planets**.

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

Order matters: weapons and modules before ships, since ships sum the `buildCost` those catalogues carry. `generate_resources.py` is independent and only needs to run before `verify_resources.py`. `generate_skills.py` is independent of all of them, but `verify_skills.py` reads the weapon and resource catalogues to check its cross-references, so run it last. `generate_systems.py` is likewise self-contained on generation — it only reads its own tables — but `verify_systems.py` reads `resources`, `skills`, `ships` and `namedShips` back out of the fleet json for its cross-catalogue invariants, so those four must already be generated first.

```sh
python3 tools/generate_resources.py   # 12 resources → Resources/, fleet json (cost constants)
python3 tools/generate_weapons.py     # 798 weapons  → Weapons/, fleet json
python3 tools/generate_modules.py     # 135 modules  → Modules/, fleet json, ship slot sync
python3 tools/generate_ships.py       # 98 hulls     → Ships/, fleet json
python3 tools/generate_skills.py      # 81 skills    → Skills/, fleet json
python3 tools/generate_systems.py     # 60 systems + 180 planets → Systems_Planets/, fleet json
python3 tools/generate_progression.py # training in turns, hull paths, careers
python3 tools/generate_market.py      # 1,043 reference prices
python3 tools/generate_facilities.py  # 30 archetype x devTier slot rows
python3 tools/generate_npc.py         # squadrons, response fleets, contracts
```

The four GamePlay generators read the five catalogues and must run after them. They are
independent of one another and may run in any order among themselves.

Each accepts `--dry-run` to print the shape it would produce without writing. Stale output
is cleared on each run: removed weapons, modules, tiers and named ships leave no orphan
files or directories behind.

## Verification

```sh
python3 tools/verify_resources.py     # 16 checks
python3 tools/verify_weapons.py       # 12 checks
python3 tools/verify_modules.py       # 23 checks
python3 tools/verify_ships.py         # 38 checks
python3 tools/verify_skills.py        # 46 checks
python3 tools/verify_systems.py       # 48 checks
python3 tools/verify_progression.py   # 22 checks
python3 tools/verify_market.py        # 23 checks
python3 tools/verify_facilities.py    # 26 checks
python3 tools/verify_npc.py           # 25 checks
python3 tools/verify_gameplay.py      # 44 checks -- the cross-cutting invariants; runs last
python3 Reference/verify_reference.py # 59 checks -- TypeScript interface vs. the data
```

All exit non-zero on failure. Between them they enforce: unique ids and names; field sets
matching the `.interface` schemas; monotonic mark and tier ladders; no duplicate stat
blocks; no weapon strictly dominated by a same-mark rival at equal-or-lower cost; module
effects restricted to a fixed stat vocabulary; `specific` modules only where
`hullAffinity` allows; every cross-reference resolving; hardpoint and slot sizes matching
what is fitted; power and crew budgets covering the fit; skill effects restricted to the
shared stat vocabulary, with an acyclic prerequisite graph, exactly two `ship_operation`
claimants per hull category and no penalty on a stat the same skill cannot buff back;
every published SP figure matching the closed-form curve, the hull tree acyclic with no
predecessor outranking its successor and every hull reaching the root; the gate graph
symmetric, loop-free, duplicate-free and fully reachable from `sys_001`, richness and
development moving opposite security as §3 requires, every region holding at least one
shipyard, and refining still lossy once a planet's `yieldModifier` is folded in; and
every file on disk matching its entry in the JSON.

The GamePlay verifiers add seven cross-cutting invariants, all recomputed from the live
catalogues rather than asserted against a literal:

* **no dead skill** — every one of the 52 stats in `stat_vocabulary.py` is consumed by a
  named rule in a named document, checked in both directions
* **no free money** — no NPC buy/sell loop profits at any level of `skl_trd_trade`, for any
  good and any pair of NPC-order tiers
* **refining stays lossy** — leasing adds no fourth multiplier; the structural lane's 0.01
  margin survives
* **every hull is reachable** and training cost rises with tonnage
* **every faucet has a drain**, each naming the constant that sets its rate
* **the fleet cap has exactly one source** — Formation Drill's `fleet_slot` unlocks; no
  generator, schema or document may state the number
* **resolution is deterministic** — dense phase list, every contended resource carrying a
  total tie-break

Three of these caught real problems while being written: the `mid` response fleet lost to
five battleships, phases 8 and 13 were mis-classified as taking no player order, and the
first draft of the trade skill let a maxed trader buy below and sell above the same index.

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
| the hull progression tree | `HULL_TREE` in `tools/skill_tables.py` |
| regions, systems, gates, planet archetypes | `tools/system_tables.py` |
| turn length, SP rate, phases, prices, leases, PvP, NPC squadrons | `tools/gameplay_tables.py` |
| shared GamePlay derivations (prices, closures, hull splits) | `tools/gameplay_common.py` |
| the SP curve and rank multiplier | `SP_BASE` / `SP_K` in `tools/skill_tables.py` |
| the stat vocabulary modules and skills share | `tools/stat_vocabulary.py` |

Then re-run the pipeline. The archetype and family tables inside `weapon.interface` and
`module.interface` are emitted by the generators, so documentation and data cannot drift.

Never hand-edit files under `Ships/`, `Weapons/`, `Modules/`, `Resources/` or `Skills/` —
the next run overwrites them. Three directories are partial exceptions, and their
generators clear only their own subtrees rather than the whole directory: `Resources/`
regenerates `raw/`, `refined/`, `manufactured/` and `index.json`, leaving its two
hand-written `.md` docs alone; `Skills/` regenerates the four domain directories and
`index.json`, leaving the hand-written `Skills/Design` spec alone; and `Systems_Planets/`
regenerates only its six region directories, `links.json` and `index.json`, leaving its
two hand-written `.md` docs — the spec and its implementation plan — alone, and
`verify_systems.py` asserts both are still there after a run, the same way
`verify_skills.py` does for `Skills/Design`.

## Notes

* Counts in this README are as of the current generated state; `tools/*.py --dry-run`
  reprints them.
* `tools/__pycache__/` is a Python build artefact and can be deleted at any time.
* Two ship-category folders differ from their enum values because `/` cannot appear in a
  directory name: `Ships/Sloop - patrol escort` and `Ships/Minelayer - sweeper`.
