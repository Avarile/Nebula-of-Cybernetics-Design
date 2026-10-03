# Stations — Specification

What a player may anchor in a planet's orbit, what it holds and what it costs. Written
2026-10-03.

Owned by this document: orbital stations — what one is, who owns it, the kit it is built
as, the slots it hosts, why it pays no upkeep, where it may be anchored and what can happen
to it, and the hook for deep-space stations. The slot model, rent formula and material chain are
`industry_specification.md`'s; this document reuses them and adds no second copy. The
numbers live in `tools/gameplay_tables.py`, the catalogue is written by
`tools/generate_stations.py`, and `tools/verify_stations.py` holds the two together.

## 1. What the brief asks for

> User at the beginning can only refine materials, build components and construct ship in a
> planet and planet based space station. Later deep space station can be built (later stage
> of the game, not designed yet).

Planet-based stations are starting-game scope; deep-space stations are not. Two rules
already in force bound the design:

* **Planets stay terrain** (`Systems_Planets` §10, `industry_specification.md` §1). No owner
  field, no capture, and factions own no planet (`lore_specification.md` §1).
* **Capacity is what players compete over** (industry §1). A planet's slots are few and
  leased; a station must not make them pointless.

Both hold because a station is **property, not territory**: a structure a player or union
owns, as they own a hull, sitting in an orbit the planet does not own either. It adds
capacity beside the planet's and changes nothing about the planet, its slots or the leases
on them.

## 2. What a station is

| | |
|---|---|
| built | as a **kit**, by a shipyard berth's `construct` job, then hauled and anchored (§3) |
| owned by | the player or union that anchors it; never a faction, never the planet |
| where | in a planet's orbit, in a `core`, `mid` or `rim` system (§6) |
| how many | `ORBITS_PER_PLANET` = **1** per planet, first come by rank |
| holds | its owner's own slots: refinery, manufactory, shipyard berth, warehouse — never extraction |
| costs | the kit, once. **No upkeep and no rent**, ever (§4) |
| lost by | only by its owner's `decommission`; never by force, never for want of credits (§4, §6) |

**One orbit per planet.** A station hosts slots outside the planet's pool, so the number of
orbits sets how much the map's industrial capacity can grow. At one per planet the map
can never hold more station capacity than planet capacity (§2.1); at two the foundry line
would pass it. Orbits are contended like slots: two kits naming one planet in one turn
resolve by rank (`turn_specification.md` §4), and the second is rejected with its kit
still in the hold.

**Its slots are leases.** Anchoring a station creates one lease per hosted slot, held by the
owner, with `siteType: orbital`, the planet's `planetId` and the station's `stationId`
(`Data-Templates/facility.interface`). Everything that reads a lease reads these the same
way: a `facility.job` runs a station refinery as it runs a planet one, a station
warehouse is a warehouse "at the same location" for `cargo.transfer` (logistics §3) and for
a refit's parts, and a station berth is a refit site with no rule added
(`fitting_specification.md` §4.1). The difference is the bill: an orbital lease pays no
rent, and the station pays nothing in its place (§4).

**No extraction.** The four lanes of a planet stay one slot each (industry §2). A station
that extracted would multiply the map's raw supply, which the 1 : 1 rich-mining-world to
forge-world ratio (`Systems_Planets` §7) and the belt-versus-slot calibration (industry §8)
are both set against, and it would turn a good planet from a shared contest into a prize
whoever holds the orbit takes. `planetaryProductionRate` stays a planetary stat.

### 2.1 Capacity

A station's slots are sized by the constants that subdivide a planet —
`REFINERY_SLOT_SIZE` 15.0, `MANUFACTORY_SLOT_SIZE` 10.0, `WAREHOUSE_SLOT_SIZE` 600.0 — and a
station berth by its own pair, `STATION_BERTH_RATE` **12.0** units/turn and
`STATION_BERTH_TONNAGE` **4,000 t**. Every one is scaled by the **developmentTier of the
planet orbited** (×1.00 / ×1.55 / ×2.40), as a planet slot is: a station runs on the same calm
the planet does, so the map's inversion — industry is best where security is best — holds
for stations too.

| station | hosts | at developmentTier 1 |
|---|---|---|
| Orbital Depot | 2 warehouse | 1,200 units |
| Orbital Refinery | 2 refinery, 1 warehouse | 30 raw/turn, 600 units |
| Orbital Foundry | 2 manufactory, 1 warehouse | 20 manufactured/turn, 600 units |
| Orbital Yard | 1 berth, 1 warehouse | 12 manufactured/turn up to 4,000 t, 600 units |

Every station that produces carries a warehouse, so its output has somewhere to land.

**Stations supplement, never supplant.** Fill every orbit the map allows — all 143 planets in
`core`, `mid` and `rim` — with the station holding the most of one kind, and the stations
still hold less of it than those planets do:

| kind | stations, every orbit filled | planets | share |
|---|---:|---:|---:|
| refinery | 6,970.5 | 16,182.5 | 43 % |
| manufactory | 4,647.0 | 6,946.1 | 67 % |
| shipyard | 2,788.2 | 3,523.6 | 79 % |
| warehouse | 278,820.0 | 943,670.0 | 30 % |

The shipyard row is the tightest and the reason a station berth builds at 12 a turn rather
than the 18 of the poorest planet berth: at 18 it would read 119 %. Only one kind can fill
an orbit, so the real build-out is well under every row.

**The capital keel stays planetary.** A station berth takes 4,000 / 6,200 / 9,600 t — exactly
an oceanic berth, the smallest planet yard. Up to a Light Cruiser T1 in `rim` at
development 2, up to a Light Cruiser T2 in `core`. A battleship is still a forge world's
alone (`Systems_Planets` §6.2), and the single-berth and union figures of industry §4.1
are untouched.

### 2.2 What the skills do on a station

The station-management skills are the brief's *"Planetary & Space Station"* skills, and they
apply to a station's slots exactly as to a planet's — no new skill, no new stat:

| slot | multiplied by | skill |
|---|---|---|
| refinery | `refineryYield` | Material Refinement Management |
| manufactory | `manufacturingRate` | Manufactory Management |
| shipyard berth | `shipConstructionRate` | Ship Construction Management |
| warehouse | `warehouseCapacity` | Planetary Production Management |

Planetary Resource Production has nothing to multiply on a station, because a station does
not extract.

**Refining stays lossy.** A station refinery carries its own `yieldModifier`,
`STATION_YIELD_MODIFIER` = **0.94**. It **replaces** the planet's term in the product, never
multiplies it, so the product keeps three terms (`gameplay_specification.md` §6.3):

```
effectiveYield = lane.conversionYield x STATION_YIELD_MODIFIER x refineryYield
               =         0.90        x         0.94           x     1.10      = 0.9306 < 1
```

0.94 sits inside the archetype range (0.92 – 1.00) and below every planet that has a berth:
a station refinery is a compact plant, and the planet's own slots stay the better refinery
wherever there are some to lease. Like the planet's, it scales with neither ladder.

## 3. Building one

### 3.1 The kit

A station is built as a kit, at a berth, like any item: a `construct` job (`facility.job`,
phase 6) with a station type as its input, from manufactured units in a warehouse on the
berth's planet, at the berth's rate × the builder's `shipConstructionRate`. The kit's
`buildCost` is a frame plus one share per hosted slot:

```
STATION_FRAME_COST            structural 150   energy 30   precision 10
STATION_SLOT_COST  refinery   structural  60   energy 20   precision  5
                   manufactory structural 60   energy 25   precision 15
                   shipyard   structural 250   energy 40   precision 30
                   warehouse  structural  40
kit buildCost = frame + SUM over hosted slots ( STATION_SLOT_COST[kind] )
```

| station | kit units | reference price | turns, forge world dev 3 berth | turns, oceanic dev 1 berth |
|---|---:|---:|---:|---:|
| Orbital Depot | 270.0 | 6,641 | 6 | 15 |
| Orbital Refinery | 400.0 | 10,730 | 9 | 23 |
| Orbital Foundry | 430.0 | 13,768 | 10 | 24 |
| Orbital Yard | 550.0 | 15,940 | 13 | 31 |

Turns are on one untrained berth — 45 a turn on the best, 18 on the poorest. A yard kit costs
about one and a half Destroyer Tier 3s (10,015 each) and takes a forge-world berth two weeks. Every station therefore starts at a planet that already has a yard: stations spread
outward from the yards, which is the shape the map already has.

**A kit is one item.** It weighs its `kitUnits` in tons, in a warehouse or a hold (one ton is
one unit, logistics §3), and it is carried whole — an Attack Transport T1 takes any of them.
It has a reference price by the economy §2 formula, which is what a haul or escort contract
and a raid value it at. It is **not on the NPC order books**: NPC orders are a liquidity floor
for what players make routinely, and a station is a commission; kits trade between players
only, so no NPC loop can open on them (§6.2 of the master spec). In a wreck a kit is rolled
whole at `SALVAGE_DROP`, like a fitted part, not split like ore.

### 3.2 Anchoring — the `station.deploy` order

`station.deploy` resolves in **phase 12**, where `facility.lease` claims slots: an orbit is
claimed when a slot is. Not standing.

| field | meaning |
|---|---|
| `action` | `deploy` or `decommission` |
| `stationTypeId`, `planetId`, `ownerId` | deploy: the kit, the orbit, and the player or their union |
| `kitSource` | deploy: `{ fleetId, hullId }` — a hold — or `{ leaseId }` — a warehouse on that planet |
| `stationId` | decommission: the station |

A deploy is validated at intake and again in phase 12 (`turn_specification.md` §3.2), and
dropped with a logged reason unless:

1. the submitting player is the owner or a member of the owning union, and holds what leasing
   a shipyard berth needs (`STATION_DEPLOY_FACILITY`): **Science 7** — read from
   `skl_sta_science`'s `manufactured_operations` unlock — and Ship Construction Management ≥ 1;
2. the planet's system is in `STATION_TIERS` (§6);
3. the planet's orbit is free once earlier-ranked deployments this phase have resolved;
4. the kit is in the named source: a hull of a fleet in the planet's system and not in
   transit, or a warehouse lease on that planet held by the player or the union.

On success the kit is consumed, the station and its orbital leases exist from that phase, and
its slots run from phase 3 of the next turn — the same first day a newly leased slot gets.
Nothing is charged then or later.

Running a station's slot needs what leasing that kind of slot needs (industry §3): a refinery
needs Science 5 and Material Refinement Management ≥ 1 of whoever submits the job. On a union
station that is the member submitting it, under their own skills, as on a union lease.

## 4. No upkeep

**A station costs its kit and nothing else.** No upkeep is charged, its orbital leases pay no
rent, and nothing a station holds appears among the drains (`economy_specification.md` §7). An
orbital lease's `rentPaidThroughTurn` (`Data-Templates/facility.interface`) is set to the turn
the station was anchored and never advances; nothing reads it, since only rent unpaid in phase
12 ends a lease, and an orbital lease owes none. It ends only when its station is decommissioned.

So a station never goes offline and is never scrapped for want of credits. A player or union
whose credits run out keeps every station and every slot on it running; only planet leases are
lost to unpaid rent (industry §7).

**What that does to the lease market.** A station is now the cheaper way to hold capacity over
any horizon longer than its payback period: once the kit is paid for, its slots produce with no
running cost, where the same capacity leased on the planet pays rent every turn. Rent, the
largest drain in the game, can shrink by exactly the capacity players move into orbit. The
payback period is the kit's reference price divided by the rent its slots would pay as leases at
the orbited planet's development tier (the industry §7 formula, `gameplay_common.station_payback`):

| station | kit price | rent dev 1 | dev 2 | dev 3 | payback dev 1 | dev 2 | dev 3 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Orbital Depot | 6,641 | 24.00 | 37.20 | 57.60 | 277 | 179 | 115 |
| Orbital Refinery | 10,730 | 19.29 | 29.90 | 46.30 | 556 | 359 | 232 |
| Orbital Foundry | 13,768 | 49.93 | 77.40 | 119.84 | 276 | 178 | 115 |
| Orbital Yard | 15,940 | 70.16 | 108.75 | 168.39 | 227 | 147 | 95 |

Rent and kit price in credits, payback in turns. The fastest is an Orbital Yard over a
development-3 planet, **95 turns** — about three months of play; a refinery over a development-1
world takes a year and a half. Four things bound the effect, and none is a new cost:

* **One orbit per planet** (`ORBITS_PER_PLANET` = 1). Even every orbit filled holds less of each
  kind than the planets do (§2.1), so the planets' leases stay the larger half of the market.
* **The kit.** 6,641 – 15,940 credits up front, and capacity bought for good: a station cannot be
  sold or moved (§5), so the payback is only reached by an owner who keeps using it.
* **Build time.** 6 – 31 turns on one berth (§3.1), and only at a planet that already has a yard.
* **Security tiers.** `core`, `mid` and `rim` only (§6); a station in `rim` keeps a raidable
  warehouse, and development — which shortens the payback — is highest in `core`, where orbits
  are fewest and most contested.

What the kit also buys, as before, is capacity that is **uncontested** — no one can lease it
first — and **where the planet has none of that kind**: a berth over a mining world, a foundry
beside the ore.

**Decommissioning.** `decommission` removes the station in phase 12: the orbit is free and its
leases end. It is accepted only when the station's warehouse is **empty** and no refit is in
progress on its berth (`fitting_specification.md` §4.4); otherwise it is rejected with a logged
reason, so the owner moves the contents out with `cargo.transfer` first. A construct job in
progress is lost; a hull already built there stays docked on the planet until its fleet collects
it (`logistics_specification.md` §1.2). Nothing is refunded: a station is anchored for good, and its kit is a sink of the material
that built it. No rule destroys a station or its warehouse's contents — material is never
destroyed by a station going away (industry §5). Moving a station means building another.

## 5. Ownership

* **Player or union.** The owner is whoever the deploy names: the player, or the player's
  union (`economy_specification.md` §9). A station owes nothing per turn, so union credits pay
  nothing for it after the kit. Union members run its slots under their own skills, as on a
  union lease.
* **No transfer.** A station cannot be sold, given or captured in this design. A transferable
  station is a tradeable claim on one of 143 orbits, and a market in orbits is a market in
  map capacity that nothing else in the game has; it is left for a later pass.
* **No faction builds one.** The authorities police and post orders (`lore_specification.md`
  §4); they own no planet, lease or station. NPC yards are planet yards.

## 6. Where, and what can happen to it

| tier | may anchor | raid on its warehouse | destroyed | insurance |
|---|---|---|---|---|
| `core` | yes | no — aggression is rejected | no | none needed |
| `mid` | yes | no — raiding is barred | no | none needed |
| `rim` | yes | **yes**, conflict §7 | no | none needed |
| `deadspace` | **no** | — | — | — |

**Not in deadspace**, for three reasons. Mechanically, deadspace builds no hull and refits
none (`Systems_Planets` §6.2, fitting §4.1), and an Orbital Yard would end both; keeping every
station type out, not only the yard, keeps deadspace the place material is taken from and
carried home, which the hauling loop (economy §8.3) is priced on. And deadspace is where the
deferred deep-space stations will have to answer the question of anchoring without a governed
orbit (§7); orbital stations should not answer it first. In the setting, an anchored
structure holds its orbit only where the Helm keeps the nebula calm (lore §2.2), and in
deadspace nothing does.

`verify_stations.py` derives the rule rather than stating it: no station with a berth may be
anchored in a tier where the map places no planet with berths.

**Raided, never taken.** A station warehouse is a warehouse lease, so conflict §7 applies to it
unchanged: in `rim`, a fleet with `TROOPS_PER_WAREHOUSE_UNIT` × the slot's capacity in troops
— 300 for a 600-unit slot — takes the contents, up to its cargo, once per `RAID_COOLDOWN`
turns per warehouse. The station, its slots, its berth and any hull docked at it are not
touched; a raid takes the contents, never the lease, and never the station.

**Never destroyed.** No rule damages a station. The combat rules resolve hulls, and a station
has no hull; a structure that one engagement could erase would make a 15,940-credit, two-week
kit a bad bet in exactly the `rim` systems where it is most useful. Because nothing can destroy
it, nothing insures it. A kit in a hold is cargo and, like all cargo, uninsured; a hull docked
at a station berth is out of play, as at any yard (`fitting_specification.md` §4.4).

**What it changes on the map.** Every region with `rim` space can now hold yards it did not
have: Obsidian Marches and The Pale Hollow, which have no NPC yard, gain refit sites wherever a
player anchors a yard. Deadspace still has none. The ore-to-yard haul gets shorter for light
hulls only; capital construction stays where §2.1 put it.

## 7. Deep-space stations — the hook

Deferred by the brief and not designed here. The hook, so the later design does not need a
schema migration:

* `siteType` — on a lease and on a station — admits `orbital` today. `STATION_SITE_TYPES` and
  `facility.interface` reserve `deep_space`, which joins the enum and nothing else.
* A deep-space station would anchor to a system or a belt rather than a planet, so its record
  would carry a `systemId` with a null `planetId`; every rule here reads `planetId` only to
  find the orbit, the development tier and the security tier.
* `STATION_TIERS` is a list, not a rule written into the order, so a deep-space type that may
  anchor in `deadspace` is a row with its own tiers.

What a deep-space station would cost, hold and risk — destruction included — is that design's
to decide.

## 8. The generated catalogue

`tools/generate_stations.py` writes `GamePlay/Stations/`, computed from `tools/gameplay_tables.py`
and the resource and skill catalogues:

```
GamePlay/Stations/
  station_types.json    4 station types x 3 development tiers: slots and their lease-rent equivalent, kit cost and price
  index.json            the station constants
```

New key in `fleet_and_weapons.json`: `stationTypes`. Schema: `Data-Templates/station.interface`
(the generated `stationType` row and the runtime `station`). TypeScript: `Reference/stations.ts`,
with the constants mirrored in `Reference/constants.ts`.

Stations themselves — which planet, which owner — are runtime state and are never generated.

## 9. Invariants

`tools/verify_stations.py`:

* one row per station type × development tier, matching the files on disk and the
  `station.interface` field set
* every slot is sized by the planet slot constants (or the station berth pair) × the
  development multiplier, and no station hosts extraction
* every hosted kind is multiplied by a station-scope skill in the live catalogue
* **refining stays lossy**: `conversionYield × STATION_YIELD_MODIFIER × refineryYield` < 1 for
  every lane, read live; the modifier is ≤ 1.00 and the same at every development tier
* **no yard where the map has none**: no station with a berth may anchor in a tier where no
  planet archetype with berths is placed — deadspace still builds no hull
* **the capital keel stays planetary**: a station berth's tonnage never exceeds the smallest
  planet yard's at the same development tier, and never reaches the heaviest hull
* **stations supplement, never supplant**: §2.1's build-out, recomputed over the live map, is
  below the planets' own capacity for every kind, and the table matches
* **no upkeep**: each slot's published rent is the industry §7 formula at its size, and no
  drain names a station; §4's payback table — kit price over the rent its slots would pay —
  recomputes from the live catalogues, its shortest period stated
* every producing station has a warehouse
* a kit's `buildCost` is its frame plus its slots, its price the economy §2 formula, and
  §3.1's and §4's tables recompute from the live catalogues
* the deploy gate's Science level is read from the skill catalogue and stated in §3.2
* `station.deploy` resolves in the phase `facility.lease` does
* `Reference/constants.ts` mirrors the station constants, and `Reference/stations.ts` the
  station type ids and the row's fields
