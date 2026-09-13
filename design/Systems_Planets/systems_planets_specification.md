# Systems & Planets — Specification

The map layer: a network of star systems joined by jump gates, and the planets inside them
that extract, refine, manufacture and build. Written 2026-09-13.

This document is the hand-written source the catalogue derives from, in the same relation
to `tools/system_tables.py` as `Resources/resource_tiers_specification.md` has to
`tools/resource_costs.py` and `Skills/Design` has to `tools/skill_tables.py`. It survives
a regeneration run; everything else under `Systems_Planets/` does not.

## 1. What this layer is for

`GamePlay/PlayerSpecific` fixes the shape: *"travelling through the universe (this universe
will look like a network of systems like Eve Online)"*. That is the whole brief for the
graph. The economic half comes from `Skills/Design`, whose **Planetary and Space Station
Management** domain names six skills covering production, warehousing, refinement,
manufactory and ship construction.

Those skills are already generated, and every one of them is a **pure percentage
multiplier with no base value of its own**:

| skill | stat | at level 10 |
|---|---|---|
| Planetary Resource Production | `planetaryProductionRate` | ×1.30 |
| Planetary Production Management | `warehouseCapacity` | ×2.00 |
| Material Refinement Management | `refineryYield` | ×1.10 |
| Manufactory Management | `manufacturingRate` | ×1.30 |
| Ship Construction Management | `shipConstructionRate` | ×1.30 |
| (Deep Space Mining) Mining Operations | `miningYield`, `miningCycleSpeed` | ×1.30 |

A multiplier with nothing to multiply is inert. **This catalogue supplies the bases.** That
is the single design constraint that fixes the planet field list — not an invented one.

## 2. Hierarchy

```
region  →  constellation  →  system  →  planet
   6            16             60        180
```

* **Region** — named territory, the unit players talk about ("the Marches"). Sets the
  security band its systems draw from.
* **Constellation** — 2–5 systems that are densely gated together. The unit of local
  travel; leaving one usually costs a chokepoint jump.
* **System** — the addressable node. Carries the star, the security rating, asteroid
  belts, and its gate list.
* **Planet** — the industrial site. Carries extraction, refinery, manufactory, shipyard
  and warehouse capacity.

### The six regions

| region | systems | constellations | security band |
|---|---|---|---|
| Aurelian Reach | 10 | Aurelian Core (4) · Meridian Chain (3) · Lumen Belt (3) | core → mid |
| Kestrel Span | 10 | Kestrel Prime (4) · Windrow Cluster (3) · Sablewing Verge (3) | core → mid |
| Cindral Verge | 10 | Cindral Forge (4) · Ashfall Basin (3) · Scoria Deep (3) | mid → rim |
| Tannhau Drift | 10 | Tannhau Crossing (4) · Longwake Spur (3) · Threnody Chain (3) | mid → rim |
| Obsidian Marches | 10 | Obsidian Gate (5) · Gravewatch Span (5) | rim → deadspace |
| The Pale Hollow | 10 | Silent Quarter (5) · The Abyssal (5) | rim → deadspace |

System names are authored in full in `tools/system_tables.py`; they are flavour, not
mechanics, and changing one renames a directory and nothing else.

## 3. Security, and the inversion that drives the economy

Four tiers, with a numeric `securityRating` for finer sorting:

| tier | rating | systems |
|---|---|---|
| `core` | 0.80 – 1.00 | 11 |
| `mid` | 0.50 – 0.70 | 19 |
| `rim` | 0.20 – 0.40 | 18 |
| `deadspace` | 0.00 – 0.10 | 12 |

Two independent 1–3 ladders hang off security, and **they point in opposite directions**:

```
richnessTier      rises as security FALLS    scales EXTRACTION
developmentTier   rises as security RISES    scales INDUSTRY
```

| security | richnessTier | developmentTier |
|---|---|---|
| `core` | 1 | 3 |
| `mid` | 1–2 | 2 |
| `rim` | 2–3 | 1–2 |
| `deadspace` | 3 | 1 |

| ladder | ×1 | ×2 | ×3 |
|---|---|---|---|
| richness | 1.00 | 1.60 | 2.50 |
| development | 1.00 | 1.55 | 2.40 |

This is the economic engine of the whole map. The ore is in the places that will get you
killed; the factories that can use it are in the places that are safe. Neither end is
self-sufficient, so material has to move — which is the point of having a graph at all.

Two archetypes reinforce it by placement rule rather than by numbers: **irradiated** and
**shattered** worlds, the only strong sources of the precision lane, appear *only* in
`rim` and `deadspace`. The precision lane already refines at 0.50 — the worst of the four,
deliberately, per `resource_tiers_specification.md` — so guidance electronics are both the
most raw-hungry lane and the one whose feedstock sits furthest from safety.

Conversely **forge worlds**, which extract nothing at all and hold the only yards that can
lay down a capital hull, appear only in `core` and `mid`.

## 4. Planets — `archetype × richnessTier × developmentTier`

Ten archetypes. Extraction figures are **raw units per turn at richnessTier 1**; industry
figures are **at developmentTier 1**.

| archetype | struct | energy | ordn | prec | refinery | yieldMod | manufactory | berths | tonnage | constr | warehouse |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `ferrous_barren` | 120 | 8 | 14 | 4 | 60 | 0.96 | 11 | 0 | 0 | 0 | 2400 |
| `crystalline` | 12 | 105 | 8 | 22 | 50 | 0.96 | 10 | 0 | 0 | 0 | 1800 |
| `gas_giant` | 4 | 38 | 125 | 8 | 55 | 0.94 | 8 | 0 | 0 | 0 | 3000 |
| `volcanic` | 68 | 18 | 92 | 9 | 65 | 0.95 | 14 | 0 | 0 | 0 | 2000 |
| `irradiated` | 18 | 28 | 22 | 95 | 45 | 0.92 | 9 | 0 | 0 | 0 | 1400 |
| `ice` | 9 | 58 | 28 | 42 | 50 | 0.95 | 9 | 0 | 0 | 0 | 2200 |
| `oceanic` | 42 | 32 | 52 | 18 | 70 | 0.97 | 22 | 1 | 4000 | 18 | 2600 |
| `shattered` | 82 | 12 | 18 | 58 | 35 | 0.93 | 6 | 0 | 0 | 0 | 1200 |
| `hive_world` | 8 | 12 | 8 | 16 | 95 | 0.99 | 75 | 2 | 16000 | 42 | 9000 |
| `forge_world` | 0 | 0 | 0 | 0 | 130 | 1.00 | 110 | 4 | 34000 | 75 | 12000 |

Units: extraction and `refinery.throughputPerTurn` in raw units/turn; `manufactory.throughputPerTurn`
and `shipyard.constructionRatePerTurn` in manufactured units/turn; `maxHullTonnage` in tons;
`warehouse.capacity` in units (= tons, since every resource is `unitMass: 1.0`).

**What scales with what:**

* `richnessTier` scales the four extraction rates, and nothing else.
* `developmentTier` scales refinery throughput, manufactory throughput, shipyard tonnage,
  construction rate and warehouse capacity.
* `yieldModifier` scales with **neither**. It is fixed per archetype. See §6.1 — holding
  it off both ladders is what keeps the refining invariant provable by inspection.

**Placement by security tier:**

| archetype | core | mid | rim | deadspace |
|---|:-:|:-:|:-:|:-:|
| `ferrous_barren` `crystalline` `gas_giant` `volcanic` `ice` | ✓ | ✓ | ✓ | ✓ |
| `oceanic` `hive_world` | ✓ | ✓ | ✓ | — |
| `forge_world` | ✓ | ✓ | — | — |
| `irradiated` `shattered` | — | — | ✓ | ✓ |

**Planets per system** cycles 2 / 3 / 4 over the 60 systems in ordinal order, giving
exactly 20 systems of each and 180 planets total.

**Archetype selection** is a fixed rotation, not a random draw: for the allowed list `A`
of a system's security tier,

```
archetype = A[(systemOrdinal * 5 + planetOrdinal * 11) mod len(A)]
```

The allowed lists have length 8 (core/mid), 9 (rim) and 7 (deadspace); `5` and `11` are
coprime with all three, so the rotation spreads archetypes evenly instead of clumping — a
multiplier sharing a factor with a list length would collapse that term to a constant and
give every system in a tier the same planets. A `PLANET_OVERRIDES` table in `system_tables.py` pins specific
planets where the map wants a landmark — the named forge worlds of the Aurelian Core, for
instance — and the override is applied after the rotation.

**Naming.** `<System Name> <Roman numeral>` by orbital position: Aurelia I, Aurelia II,
Aurelia III. Ids are `pln_001` … `pln_180`, assigned in system-then-orbit order.

## 5. Systems

```jsonc
{
  "systemId": "sys_001",
  "name": "Aurelia",
  "region": "Aurelian Reach",
  "constellation": "Aurelian Core",
  "securityTier": "core",
  "securityRating": 1.0,
  "star": { "spectralClass": "G", "luminosity": 1.0 },
  "coordinates": { "x": 0.0, "y": 0.0, "z": 0.0 },
  "planets": ["pln_001", "pln_002", "pln_003"],
  "asteroidBelts": [ /* see 5.2 */ ],
  "connections": [ /* see 5.3 */ ]
}
```

### 5.1 Coordinates

Every system has a position in light years, built additively from tables: a region centre,
plus a constellation offset, plus a per-system offset. No RNG. Coordinates exist so that
`jumpDistance` is a real distance rather than a made-up number, and so a map view has
something to draw.

### 5.2 Asteroid belts

Belts are the **Deep Space Mining** domain's target — the thing `miningYield` and
`miningCycleSpeed` multiply — and they are a system-level feature, not a planet one.

```jsonc
{ "beltId": "bel_004", "name": "Aurelia Belt I", "dominantLane": "structural",
  "richnessTier": 2, "yieldPerCycle": 28.8, "cycleTurns": 3 }
```

Belt count runs opposite to security, like everything else here: `core` 0–1, `mid` 1–2,
`rim` 2–3, `deadspace` 3–4. `yieldPerCycle` is an archetype base scaled by the same
richness ladder as planetary extraction.

### 5.3 Connections and the gate graph

A connection as stored on a system:

```jsonc
{ "toSystemId": "sys_002", "gateId": "gate_sys_001_sys_002", "gateName": "Aurelia — Cantoris",
  "jumpDistanceLy": 4.2, "crossesConstellation": false, "crossesRegion": false }
```

The edge set is built by three rules plus one authored list, then canonicalised:

1. **Constellation chain.** Inside each constellation, systems link `i ↔ i+1`. This alone
   makes every constellation internally connected.
2. **Region spine.** The first system of each constellation links to the first system of
   the next constellation in the same region. This alone makes every region connected.
3. **Region bridges.** An authored list of ~7 named chokepoint gates joins the six regions
   into a connected whole — these are the strategic gates, and they are named, not
   numbered ("The Meridian Gate", "Cold Harbour Approach").
4. **`EXTRA_GATES`.** A short authored list of shortcut edges for texture, so the map is
   not a pure tree.

Rules 1–3 together guarantee connectivity by construction; §6.3 proves it by BFS anyway,
because a guarantee that is not checked is a comment.

Edges are canonicalised before writing: ordered by `(min(id), max(id))`, deduplicated, and
self-loops dropped. `gateId` is always `gate_<lowerId>_<higherId>` regardless of which
side you approach from, so the two systems' `connections[]` entries name the same gate.

`jumpDistanceLy` is the Euclidean distance between the two systems' coordinates, rounded
to 1 decimal — identical from both ends by construction.

## 6. Invariants

These are the checks `tools/verify_systems.py` enforces. The first three are the ones that
matter; they are cross-catalogue, which means they break from the outside, which means
prose would not hold them.

### 6.1 Refining can never become lossless

The refined-tier yield a player actually gets is a product of three numbers owned by three
different catalogues:

```
effectiveYield = lane.conversionYield  ×  planet.refinery.yieldModifier  ×  skillMultiplier
```

`resource.interface` requires `conversionYield` to stay strictly below 1, and the whole
tier model depends on it: refining that loses nothing makes "manufactured" a rename of
"raw". The worst case is the structural lane, the highest at 0.90:

```
0.90  ×  1.00  ×  1.10   =  0.99   < 1   ✓
 │        │        └── Material Refinement Management at level 10 (+1%/level)
 │        └── the maximum yieldModifier in the archetype table (forge_world)
 └── the highest lane conversionYield in the resource catalogue
```

The margin is 0.01. That is why `yieldModifier` is capped at 1.00 and why it scales with
neither ladder — put it on the development ladder and a forge world would reach 2.40,
blowing the invariant immediately.

The verifier does not hardcode `0.90` or `1.10`. It reads the lane yields from
`fleet_and_weapons.json -> resources` and the per-level figure from `-> skills`, recomputes
the product against the live archetype table, and fails if any combination reaches 1.0.
Raising the skill, the lane yield, or a `yieldModifier` breaks the build rather than
quietly producing a lane that refines without loss.

### 6.2 Every hull has somewhere to be built

`maxHullTonnage` is meaningless unless it is checked against hulls that actually exist.
The verifier reads every ship in `fleet_and_weapons.json` and asserts:

* for each of the 26 categories, at least one planet has `maxHullTonnage ≥` that
  category's heaviest tier-3 hull;
* the single heaviest hull in the game — Battleship Tier 3 at **65,100 t** — has at least
  one yard that can take it.

A forge world at developmentTier 3 reaches `34,000 × 2.40 = 81,600 t`, which clears it.
Nothing else does: a hive world tops out at 38,400 t and an oceanic yard at 9,600 t. That
capital hulls come only from developed core-space forge worlds is a deliberate consequence,
and this check is what keeps it true after someone edits the table.

### 6.3 The graph is navigable

* every `connections[]` entry has a matching entry on the far system (symmetry)
* no self-loops, no duplicate edges
* `jumpDistanceLy` agrees from both ends
* `gateId` matches `gate_<lowerId>_<higherId>` canonical form
* every `toSystemId` resolves to a real system
* **BFS from `sys_001` reaches all 60 systems** — no region reachable only through a gate
  nobody wrote
* every system has at least one connection
* `links.json` and the union of all `connections[]` are the same edge set

### 6.4 Structural checks

* 60 systems, 180 planets, ids unique and densely numbered; names unique
* field sets match `system.interface` and `planet.interface` exactly
* every `region`, `constellation`, `securityTier`, `archetype`, `dominantLane` is a legal
  enum value; `dominantLane` is one of the four resource lanes in the live catalogue
* `securityRating` falls inside its tier's band
* `richnessTier` and `developmentTier` are consistent with `securityTier` per §3
* archetype placement obeys the §4 table — no forge world in deadspace, no irradiated
  world in core
* every planet's `systemId` resolves, and appears in that system's `planets[]`
* both ladders are monotonic: a higher `richnessTier` never extracts less at the same
  archetype; a higher `developmentTier` never manufactures less
* a planet with `berths: 0` has `maxHullTonnage: 0` and `constructionRatePerTurn: 0`
* every file on disk matches its entry in `fleet_and_weapons.json`
* the hand-written `systems_planets_specification.md` is still present after a run

## 7. Calibration

The numbers in §4 are anchored to the build costs the ship catalogue already carries,
not chosen for feel.

**Battleship Tier 3** costs `1850.21` structural + `165.31` energy + `26.02` ordnance +
`242.15` precision = **2,284 manufactured units**.

* A forge world at developmentTier 3 with Ship Construction Management at 10 lays it down
  at `75 × 2.40 × 1.30 = 234` units/turn — about **10 turns** for a battleship, under 1
  turn for a motor torpedo boat (54 units).
* Feeding that yard: `110 × 2.40 × 1.30 = 343` manufactured units/turn from the forge
  world's own manufactory.
* Feeding *that*: one manufactured structural unit needs `1 / 0.85 / 0.90 = 1.31` raw
  ferrite. A richness-3 `ferrous_barren` with Planetary Resource Production at 10 yields
  `120 × 2.50 × 1.30 = 390` raw/turn. **Roughly one rich mining world sustains one forge
  world** — a 1:1 ratio that gives the logistics layer a legible target.
* Precision is the deliberate bottleneck: one manufactured guidance assembly needs
  `1 / 0.85 / 0.50 = 2.35` raw isotopes, so a battleship's 242 precision units cost 570
  raw. A richness-3 `irradiated` world yields 309/turn — **two rim-or-deadspace worlds per
  battleship every two turns**, against one safe mining world for the structural lane.

The scarce lane is the one you have to go somewhere dangerous to get. That is §3 restated
in units per turn.

## 8. Layout on disk

```
Systems_Planets/
  systems_planets_specification.md      hand-written; survives a run
  <Region>/<System>/system.json
  <Region>/<System>/planets/pln_###_<slug>.json
  links.json                            every gate once, canonical
  index.json                            all 60 systems and 180 planets
```

Like `Resources/` and `Skills/`, this is a **partially** generated directory. The generator
clears only the six region directories, `links.json` and `index.json` — never the whole
folder — so this document cannot be destroyed by a regeneration. The verifier asserts it is
still there afterwards.

New keys in `fleet_and_weapons.json`: `systems` (60) and `planets` (180), plus `_meta`
additions `systemCount`, `planetCount`, `regions[]`, `securityTiers[]`, `planetArchetypes[]`.

## 9. Build order

`generate_systems.py` is independent of the weapon/module/ship chain and can run at any
point. `verify_systems.py` reads the resource, skill and ship catalogues for §6.1 and
§6.2, so it runs last.

```sh
python3 tools/generate_systems.py     # 60 systems + 180 planets -> Systems_Planets/, fleet json
python3 tools/verify_systems.py       # ~30 checks, last in the sequence
```

## 10. Out of scope

Deliberately not in this pass, to keep it one spec:

* **Space stations.** The Skills domain is "Planetary *and Space Station* Management" and
  stations will want the same five capacity fields. They are a sibling catalogue with a
  different placement model (player-built, not map-authored), not a planet variant.
* **Ownership, factions, sovereignty.** No `owner` field. Every planet here is terrain.
* **Markets and prices.** `tradePriceMargin` exists in the skill vocabulary and has no
  base to multiply yet; that is a market catalogue, not a map one.
* **Travel time and fuel.** `jumpDistanceLy` is recorded so a later movement model can use
  it, but no turn cost is defined here.
