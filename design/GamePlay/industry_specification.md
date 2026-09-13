# Industry — Specification

Where material comes from and what turns it into a hull. Written 2026-09-13.

Owned by this document: facility slots and the leases on them, warehouses, belt mining, and
the four-stage material chain. The planet archetypes and their capacities are **not** owned
here — `Systems_Planets/systems_planets_specification.md` §4 tables them, and everything
below is a subdivision of those figures that preserves their totals exactly.

## 1. The brief's constraint

> User at the beginning can only refine materials, build components and construct ship in a
> planet and planet based space station.

Three operations, on a planet, from the start. So planets must be usable by players — but
`Systems_Planets` §10 is equally explicit that *"every planet here is terrain"*, with no
owner field and no sovereignty.

Both hold at once through **leasing**. A planet exposes a finite number of indivisible
industrial **slots**. A player leases a slot, pays rent every turn, and receives that slot's
throughput multiplied by their own skills. The planet is never owned, never captured and
never damaged. What players compete over is *capacity*, and the competition is economic —
you outbid, out-skill or out-wait a rival, you do not shoot them off a rock.

This is also what keeps the map's security model intact. A rich `irradiated` world in
deadspace is dangerous to *work* — its output must be hauled out through the conflict layer
— but it cannot be taken from you by force, only starved of the shipping that makes it
worth holding.

## 2. Slots

A slot is the unit of lease. Slot counts come from the archetype's capacity divided by a
per-slot constant, rounded to preserve the planet's published total:

```
slotCount     = max(1, round(archetypeCapacity / SLOT_SIZE))
slotThroughput = archetypeCapacity / slotCount          # exact; totals are preserved
```

```
EXTRACTION   one slot per lane per planet          (4 per planet, one each)
REFINERY_SLOT_SIZE     15.0   raw units/turn
MANUFACTORY_SLOT_SIZE  10.0   manufactured units/turn
SHIPYARD                berths are already slots     (0, 1, 2 or 4)
WAREHOUSE_SLOT_SIZE   600.0   units
```

Derived from the §4 archetype table:

| archetype | extraction | refinery | per slot | manufactory | per slot | berths | per berth | warehouse | per slot |
|---|:-:|---:|---:|---:|---:|---:|---:|---:|---:|
| `ferrous_barren` | 4 | 4 | 15.00 | 1 | 11.00 | 0 | — | 4 | 600 |
| `crystalline` | 4 | 3 | 16.67 | 1 | 10.00 | 0 | — | 3 | 600 |
| `gas_giant` | 4 | 4 | 13.75 | 1 | 8.00 | 0 | — | 5 | 600 |
| `volcanic` | 4 | 4 | 16.25 | 1 | 14.00 | 0 | — | 3 | 667 |
| `irradiated` | 4 | 3 | 15.00 | 1 | 9.00 | 0 | — | 2 | 700 |
| `ice` | 4 | 3 | 16.67 | 1 | 9.00 | 0 | — | 4 | 550 |
| `oceanic` | 4 | 5 | 14.00 | 2 | 11.00 | 1 | 18.00 | 4 | 650 |
| `shattered` | 4 | 2 | 17.50 | 1 | 6.00 | 0 | — | 2 | 600 |
| `hive_world` | 4 | 6 | 15.83 | 8 | 9.38 | 2 | 21.00 | 15 | 600 |
| `forge_world` | 0 | 9 | 14.44 | 11 | 10.00 | 4 | 18.75 | 20 | 600 |

A `forge_world` has no extraction slots because the archetype extracts nothing — §4's
zeroes, carried through rather than special-cased.

**Extraction is one slot per lane.** A planet's four lanes lease independently, so a rival
can hold the precision lane on the same world where you hold the structural lane. This is
deliberate: it makes a good planet a shared contest rather than a winner-take-all prize,
and it is the finest granularity the archetype table supports without inventing numbers.

### 2.1 What the two ladders do to a slot

From `Systems_Planets` §3, unchanged:

* `richnessTier` scales **extraction slot output** — ×1.00 / ×1.60 / ×2.50
* `developmentTier` scales **refinery, manufactory, shipyard and warehouse per-slot
  throughput** — ×1.00 / ×1.55 / ×2.40

Development scales **slot size, never slot count**. A developed forge world does not have
more berths than an undeveloped one; each berth simply builds faster. So the number of
leases a planet can support is a property of its archetype alone, and the *value* of a lease
is a property of its development. Scarcity and quality are separate axes.

`yieldModifier` scales with neither ladder and is untouched by leasing — see §6.

## 3. Access

Leasing is gated by `skl_sta_science`, whose `unlocks` already carry the three levels:

| to lease | Science | also needs |
|---|:-:|---|
| extraction slot | 3 | `skl_sta_resource_production` ≥ 1 |
| warehouse slot | 3 | `skl_sta_production_management` ≥ 1 |
| refinery slot | 5 | `skl_sta_refinement` ≥ 1 |
| manufactory slot | 7 | `skl_sta_manufactory` ≥ 1 |
| shipyard berth | 7 | `skl_sta_ship_construction` ≥ 1 |

The Science levels are read from the skill catalogue's `unlocks[].level`, not restated as
constants. A player holds any number of leases; there is no cap beyond credits.

## 4. The chain

Four stages, each a `facility.job` order, each running in its own turn phase, each reading
the warehouse snapshot from the start of phase 3 (`turn_specification.md` §2.1).

```
 phase 3   EXTRACT      lane slot          -> raw          x richness x planetaryProductionRate
 phase 4   REFINE       refinery slot      -> refined      x conversionYield x yieldModifier x refineryYield
 phase 5   MANUFACTURE  manufactory slot   -> manufactured x 0.85 x manufacturingRate
 phase 6   CONSTRUCT    shipyard berth     -> hull progress  x shipConstructionRate
```

Each stage's output lands in a warehouse at the same planet. Moving it anywhere else is
`logistics_specification.md`'s problem, and the snapshot rule means the chain runs at one
stage per turn — three turns from ore to manufactured goods before construction even starts.

All five `station_management` skills now have a base to multiply, which was the open problem
`Systems_Planets` §1 named:

| skill | multiplies | at level 10 |
|---|---|---|
| Planetary Resource Production | extraction slot output | ×1.30 |
| Planetary Production Management | warehouse slot capacity | ×2.00 |
| Material Refinement Management | lane `conversionYield` | ×1.10 |
| Manufactory Management | manufactory slot throughput | ×1.30 |
| Ship Construction Management | berth construction rate | ×1.30 |

### 4.1 Construction, and why unions exist

A berth is leased individually, and a hull is built at one berth. On the best yard in the
game — a `forge_world` at developmentTier 3, with Ship Construction Management at 10:

```
one berth    18.75 x 2.40 x 1.30  =  58.5 units/turn
four berths                        = 234.0 units/turn
```

A Battleship Tier 3 costs **2,283.7** manufactured units. So:

```
one player, one berth        39 turns   -- five and a half weeks
a union holding all four     10 turns
```

The four-berth figure is exactly the 234 units/turn and "about 10 turns" that
`Systems_Planets` §7 calculates for a whole forge world, which is the check that this
subdivision preserves that spec's totals. The single-berth figure is new, and it is the
strongest structural argument for unions in the game: capital ships are a *group*
undertaking not because a rule says so, but because one player's berth takes five weeks.

## 5. Warehouses

Material sits in a warehouse or it does not exist. Warehouses are leased per slot, per
planet, and capacity is `slotCapacity × developmentTier × warehouseCapacity` — the
last being the only thing `skl_sta_production_management` does, and at level 10 it doubles.

**A full warehouse halts production; it never destroys material.** A facility whose output
has nowhere to go simply does not run that turn, and the turn log says so. There is no
spoilage, no forced sale, no overflow loss. Losing a day's output to an unwatched warehouse
is a sufficient penalty in a game where a day is a turn; losing the stock as well would
punish absence, which `turn_specification.md` §3.1 rules out.

Union warehouses are ordinary warehouse leases held by a union rather than a player
(`economy_specification.md` §8).

## 6. What leasing may never touch

`Systems_Planets` §6.1 leaves a margin of **0.01** on the refining invariant:

```
effectiveYield = lane.conversionYield x planet.yieldModifier x skillMultiplier
               =        0.90         x       1.00           x     1.10        = 0.99  < 1
```

Leasing introduces **no fourth term**. A lease scales *throughput* — how much material a
slot processes per turn — and never *yield*, the fraction that survives processing. This is
the single constraint that decides the whole slot model: had rent bought better conversion,
a developed forge world would have broken a cross-catalogue invariant that three other specs
depend on.

`tools/verify_facilities.py` recomputes the product including every GamePlay multiplier and
fails if any combination reaches 1.0.

## 7. Rent

Rent is charged in phase 12, per slot, per turn, and is derived rather than authored:

```
rentPerTurn = LEASE_RATE x (outputValue - inputValue)
```

evaluated at the planet's development tier, richnessTier 1, skill level 0, using the
reference prices of `economy_specification.md` §3. `LEASE_RATE = 0.30` for extraction,
refinery and manufactory slots; `0.10` for shipyard berths, whose "value added" is assembly
rather than conversion; and warehouses are charged a flat `0.02` credits per unit of
capacity per turn.

Three properties follow, and all three are why rent is computed this way:

* **A better slot costs more**, automatically. A forge world berth and an oceanic berth are
  priced by what they produce, with no per-archetype rent table to maintain.
* **Rent is a fraction of the margin, not of the turnover.** A refinery slot's gross
  margin is `PROCESS_MARGIN = 0.15`; rent takes 30 % of that and the leaseholder keeps the
  rest, plus everything their skills add on top. Skills are what make a lease profitable.
* **Rent cannot exceed the slot's output**, so a lease is never a trap.

**Unpaid rent ends the lease** at the end of phase 12, with the slot returned to the pool
and any warehoused material left in place, still owned, still stored under whatever
warehouse lease holds it. A player who runs out of credits loses access, not property.

## 8. Belt mining — the unlandlorded path

Asteroid belts are a system-level feature (`Systems_Planets` §5.2) and are **not leased**.
Anyone may mine any belt.

```
perHullPerTurn = (yieldPerCycle / cycleTurns) x miningYield x miningCycleSpeed
fleetTotal     = sum over hulls carrying mining equipment            (up to 5)
```

Output goes straight into the hull's cargo hold — no warehouse, no lease, no rent, and the
material is already aboard a ship that can move it.

The four mining skills stack to **×2.184** on `miningYield` and **×1.560** on
`miningCycleSpeed` at level 10, so a richness-3 belt yielding 15.0 raw/turn/hull untrained
yields 51.1 trained. A five-hull fleet lands near **255 raw units/turn**, against **390/turn**
from a richness-3 `ferrous_barren` extraction slot at Planetary Resource Production 10.

About a third less — and that is closer than it looks, because the extraction slot pays
rent, sits on a planet someone else may already hold, needs Science 3 and a hauler to get
its output anywhere, while the mining fleet needs none of those and leaves the moment
something hostile arrives.

That is the intended shape: mining funds the new player's first leases and gives the
established player a mobile income that no landlord, market or rival can foreclose. It is
also the only extraction available in systems where the player holds nothing at all, which
is most of the map.

`skl_flt_mining_formation` multiplies the fleet total; the two `deep_space_mining`
equipment skills gate which mining modules may be fitted, in the same
`unlocks`-carried way hull operation works.

## 9. The generated catalogue

`tools/generate_facilities.py` writes `GamePlay/Facilities/`, computed from the archetype
table and the resource catalogue:

```
GamePlay/Facilities/
  industry_specification.md    this file; survives a run
  facility_types.json          10 archetypes x 3 devTiers x 5 facility types:
                               slot count, per-slot throughput, rent per turn
  chain.json                   the four stages: inputs, outputs, yields, gating skills
  index.json                   constants and totals
```

New key in `fleet_and_weapons.json`: `facilityTypes`.

Per-planet slot *instances* are runtime state and are not generated — a lease is created
by play. The rate table needs only `(archetype, developmentTier)`, which is why it was
generated and verified before the map existed.

The archetype table itself is **imported from `tools/system_tables.py`**, which owns it;
GamePlay keeps no second copy, so editing the map reprices every lease automatically.
`verify_facilities.py` now also checks that `slotCount × slotThroughput` reproduces the
published capacity of all **180 generated planets**, not just the 10 archetypes.

## 10. Invariants

`tools/verify_facilities.py`:

* **totals are preserved**: for every archetype, `slotCount × slotThroughput` equals the
  capacity published in `systems_planets_specification.md` §4, to within floating-point
  tolerance
* **the refining invariant survives leasing**: `conversionYield × yieldModifier ×
  refineryYield` recomputed across every lane × archetype × skill level stays strictly
  below 1.0, reading all three from the live catalogues
* every gating Science level matches the `unlocks[].level` on `skl_sta_science`
* every one of the five `station_management` skills multiplies exactly one named base, and
  no base is multiplied by two skills
* slot counts are ≥ 1 wherever the archetype capacity is > 0, and 0 where it is 0
* `developmentTier` scales per-slot throughput and leaves slot count unchanged
* rent is strictly positive, strictly less than the slot's gross output value, and rises
  monotonically with development tier
* a zero-berth archetype has zero shipyard slots, agreeing with §6.4 of the map spec
* every one of the 180 generated planets resolves to a facility row, and that row's slots
  sum to the capacity the planet publishes — berths and construction rate included
* at least one generated yard can take the heaviest hull in the game
* the single-berth and four-berth battleship figures in §4.1 recompute from the live ship
  catalogue's `buildCost`
