# Gameplay — Master Specification

How a player spends a day. Written 2026-09-13.

This is the spine document for `GamePlay/`. It fixes the vocabulary, names the six
sub-specifications and states the rules that belong to no single one of them. Where a rule
is owned by a sub-spec, this document says so and stops; where a rule is cross-cutting, it
lives here.

`PlayerSpecific` — three lines, hand-written, the original brief — is the source. It
survives a regeneration run, and every design decision below traces back to a clause in it
or to a constraint the existing catalogues already impose.

## 1. What the brief asks for

> Each user commands a fleet of ships (5 max), travelling through the universe (this
> universe will be look like a network of systems like Eve Online), user can select skills
> from 4 domains of skill sets (yet, user does not have to be locked into each domain, they
> are free to learn from tiered skills from each domain).
>
> User at the beginning can only refine materials, build components and construct ship in a
> planet and planet based space station. Later deep space station can be built (later stage
> of the game, not designed yet).
>
> User can focus on mining, production, fighting, all some kind of all rounder (but less
> effective).

Four requirements, and each one is discharged by a mechanism rather than by a rule someone
has to remember:

| the brief says | discharged by | where |
|---|---|---|
| fleet of 5 max | `skl_flt_formation_drill` unlocks fleet slots 2–5; slot 1 needs no skill | `progression_specification.md` §5 |
| a network of systems | the 60-system gate graph | `Systems_Planets/systems_planets_specification.md` |
| free to mix 4 domains | no domain lock exists; the constraint is SP, not permission | `progression_specification.md` §2 |
| specialists beat all-rounders | one career maxes in 103–582 turns; all 81 skills take 2,493 | `progression_specification.md` §4 |
| industry on planets first | players lease facility slots; planets stay terrain | `industry_specification.md` §2 |
| deep-space stations later | out of scope, hook named | §9 below |

## 2. The core loop

```
        ┌─────────────────────────────────────────────────────┐
        │                                                     │
    TRAIN ──► FIELD ──► GO ──► TAKE ──► MAKE ──► SELL ────────┘
     SP       a hull    out    material  it up    or fly it

    TRAIN   43,200 SP/turn buys levels in 81 skills          progression
    FIELD   skills gate hulls; credits and material buy them industry + economy
    GO      jump range, fuel, cargo, who is waiting on gates logistics
    TAKE    extract on a leased planet slot, or mine a belt   industry
    MAKE    refine → manufacture → construct                  industry
    SELL    NPC orders in core/mid, players everywhere        economy
    or fight, which is where the material goes                conflict
```

Every arrow is a turn phase in the order `turn_specification.md` §2 fixes, so the loop is
not a metaphor — it is the shape of a single day's resolution.

The loop closes because **each stage consumes what the previous one produced and the map
puts the two ends apart**. `Systems_Planets` §3 is the engine: ore is richest where
security is worst, industry is best where security is best, so material must move, and
moving it is what the conflict layer preys on.

## 3. Vocabulary

Terms fixed here and used identically in all seven documents.

| term | meaning |
|---|---|
| **turn** | one resolution of the whole universe. 24 real hours. The only clock. |
| **round** | one exchange inside a battle. Many rounds fit in one turn. Formerly "turn" in `Combat-logic/`. |
| **phase** | one of the 14 ordered steps a turn resolves through. |
| **order** | an instruction a player submits for the coming turn. |
| **player** | one account. Owns skills, credits, a fleet, leases and standings. |
| **fleet** | 1–5 hulls under one player, moving and fighting as a unit. |
| **fleet operation** | several players' fleets acting as one force in a single engagement. |
| **lease** | a player's claim on one facility slot on one planet, paid per turn. |
| **slot** | an indivisible unit of planetary industrial capacity. |
| **reference price** | the credit value of a good, derived from its `buildCost`. |
| **union** | a player organisation. |

**Turn is the universal denominator.** Every rate already written in
`Systems_Planets/systems_planets_specification.md` §4 — extraction, refinery throughput,
construction — is per turn and needs no reinterpretation. Every cooldown in
`Combat-logic/` is per *round* and is renamed, not rescaled.

## 4. The seven documents

| document | owns |
|---|---|
| `gameplay_specification.md` | this one: vocabulary, loop, cross-cutting invariants, scope |
| `turn_specification.md` | the 14 phases, order intake, determinism, tie-breaking |
| `progression_specification.md` | SP rate, the training queue, specialisation, the new player |
| `industry_specification.md` | leases, slots, warehouses, mining, the material chain |
| `logistics_specification.md` | jump range, fuel, ammo, cargo, refuelling, interdiction |
| `economy_specification.md` | credits, reference prices, NPC orders, markets, contracts, unions |
| `conflict_specification.md` | PvE, PvP legality, engagement, destruction, insurance, salvage |

Each is hand-written and survives regeneration. Four generated catalogues sit beside them —
`Progression/`, `Market/`, `Facilities/`, `NPC/` — and §8 lists them.

## 5. Authored rules vs. runtime state

The distinction that keeps this layer tractable, and the reason none of it had to wait on
the map generator:

**Authored** — a pure function of a table, generated, verified, byte-reproducible:

* the SP ladder (already in `skills[].training`)
* reference prices for all 1,043 tradeable goods
* facility slot counts and lease rates, keyed by `archetype × developmentTier`
* NPC squadron templates and contract archetypes

**Runtime** — created by play, never generated, but schema-pinned:

* players, their trained levels, credits, standings
* fleets and the hulls in them
* leases, warehouse contents, market orders, contracts in flight
* wrecks, engagements, turn logs

Facility rules key off planet *archetype and development tier*, both of which
`systems_planets_specification.md` §4 tables in full. They never key off a planet instance.
A lease is runtime state that names a planet id; the rate table it is priced from is
authored. That kept the whole GamePlay pipeline generating and verifying before
`tools/generate_systems.py` existed — and now that it does, `verify_facilities.py` also
checks the subdivision against all 180 real planets, with the rate table unchanged.

## 6. Cross-cutting invariants

Seven properties no single sub-spec owns. `tools/verify_gameplay.py` enforces all of them
against the live catalogues, in the manner `verify_skills.py` already checks the refining
invariant — by reading the data, not by restating a constant.

### 6.1 No dead skill

Every stat in `tools/stat_vocabulary.py` — all 34 `SHIP_STATS` and all 20 `SKILL_STATS` —
is consumed by a named, id'd rule in one of the seven documents. The verifier builds the
map and fails on either side being empty: a stat no rule reads, or a rule citing a stat that
does not exist.

This is what makes the skill catalogue honest. `troopCapacity` earned its rule
(`conflict_specification.md` §7, facility raiding) because the invariant would not pass
without one, not because someone thought of a use for landing ships.

### 6.2 No free money

No sequence of NPC buy and sell orders returns more credits than it consumed, unless the
player moved the goods between systems, processed them through a facility, or took a risk.
Checked across every good × every security tier. See `economy_specification.md` §6.

### 6.3 Refining stays lossy

`Systems_Planets` §6.1 leaves a margin of 0.01 on the structural lane:

```
0.90 × 1.00 × 1.10 = 0.99 < 1
```

GamePlay introduces no fourth multiplier on that product. Facility leases scale
*throughput*, never *yield*. The verifier recomputes the product including anything
GamePlay adds and fails if it reaches 1.0.

### 6.4 Every hull is reachable, and difficulty is monotonic

For each of the 26 categories, the training cost of fielding it — both gate skills at level
5 plus the full prerequisite closure — is computed and asserted to rise with the category's
heaviest tier-3 tonnage. The live figures:

| category | closure | SP | turns |
|---|---:|---:|---:|
| motor torpedo boat · submarine chaser · corvette | 3 | 20,090 | 0.5 |
| torpedo boat (fleet) · destroyer escort · sloop | 5 | 39,930 | 0.9 |
| landing ship tank · submarine | 5 | 59,768 | 1.4 |
| destroyer · minelayer · coastal defence · AA cruiser | 7 | 79,608 | 1.8 |
| monitor · attack transport · seaplane tender · repair tender | 7–9 | 119,286 | 2.8 |
| light cruiser · merchant raider | 9 | 139,126 | 3.2 |
| panzerschiff | 11 | 178,804 | 4.1 |
| fleet oiler · light carrier · heavy cruiser | 9–11 | ~198,643 | 4.6 |
| escort carrier | 13 | 258,162 | 6.0 |
| battlecruiser | 13 | 278,000 | 6.4 |
| fleet aircraft carrier | 15 | 337,518 | 7.8 |
| **battleship** | **15** | **377,196** | **8.7** |

Nothing in this table is authored. It falls out of `HULL_TREE` and the rank ladder in
`tools/skill_tables.py`, and the verifier recomputes it rather than reading it here.

### 6.5 Every faucet has a drain

The credit supply is bounded. Each per-turn source of credits is paired with a named sink,
and `economy_specification.md` §7 tabulates both sides with the steady-state ratio.

### 6.6 The fleet cap has exactly one source

Five ships is not a constant. It is the count of `unlocks[].type == "fleet_slot"` entries
in `skl_flt_formation_drill`, plus the free first hull. No document, schema, generator or
interface may state `5` as a fleet limit. The verifier greps for it.

### 6.7 Resolution is deterministic

The same submitted orders and the same turn seed produce a byte-identical turn log. Phase
order is fixed, every tie-break is total, and the only randomness is drawn from a seed
derived from the turn number. This is the same property the five existing generators hold,
extended from data production to world simulation.

## 7. Rulings inherited from `Combat-logic/`

`combat_logic_specification.md` §5 lists five gaps awaiting a decision. Three of them change
how often ships die, which makes them gameplay questions rather than combat ones. Ruled
here:

| gap | ruling |
|---|---|
| §5.4 retreat threshold, 15% vs ~30% | **30% hull.** The logs are right and the schema moves. `conflict_specification.md` §5 depends on it. |
| §5.2 gunnery skill and the −0.2 component penalty | **Both apply.** v2 extends v1; the terms are carried forward. |
| §5.5 undefined `sensorDebuff` | **Folded into the existing `sensorArray` critical.** No second debuff is invented. |
| §5.1 `extends` names a file that does not exist | Source fix, no gameplay consequence. The base is `data-template.json`'s `combatResolution`. |
| §5.3 undefined `specialEffects` | Combat's to define. GamePlay reads outcomes, not effects. |

The word **turn** in all three `Combat-logic/` files means **round** in this vocabulary.

## 8. What GamePlay adds to the pipeline

Schemas in `Data-Templates/` — six new `.interface` files, `[+]`-annotated like the rest:

```
player.interface          account: skills, SP, credits, standings, union
facility.interface        a leasable slot and the lease on it
market.interface          a reference price and an order
contract.interface        NPC and player contracts
npc_squadron.interface    a hostile formation template
turn_order.interface      one submitted instruction
```

Generators and verifiers in `tools/`:

```sh
python3 tools/generate_progression.py   # per-skill training table -> GamePlay/Progression/
python3 tools/generate_market.py        # 1,043 reference prices  -> GamePlay/Market/
python3 tools/generate_facilities.py    # archetype x devTier      -> GamePlay/Facilities/
python3 tools/generate_npc.py           # squadrons and contracts  -> GamePlay/NPC/
```

```sh
python3 tools/verify_progression.py
python3 tools/verify_market.py
python3 tools/verify_facilities.py
python3 tools/verify_npc.py
python3 tools/verify_gameplay.py        # the seven §6 invariants; runs last
```

New keys in `fleet_and_weapons.json`: `progression`, `marketPrices`, `facilityTypes`,
`npcSquadrons`, `contractArchetypes`, plus `_meta` additions `spPerTurn`,
`turnLengthHours`, `tradeableGoodCount`.

TypeScript in `Reference/`: `gameplay.ts` (turn, orders, player, fleet), `economy.ts`
(prices, orders, contracts), `facilities.ts` (slots and leases).

## 9. Out of scope

Deliberately deferred, each with the reason:

* **Deep-space stations.** The brief defers them explicitly. The hook is
  `facility.interface`'s `siteType`, which admits `planet` and `orbital` today and gains
  `deep_space` without a schema change.
* **Sovereignty and territory capture.** Planets stay terrain, per
  `Systems_Planets` §10. Conflict over industry is conflict over *leases and cargo*, not
  over ground.
* **Ship fitting by the player.** Hulls arrive fitted from the catalogue. Refitting is a
  catalogue-side feature, not a gameplay one.
* **Research and blueprints.** `skl_sta_science` gates *training*, not *recipes*. Adding
  discoverable blueprints would make `buildCost` player-variable, which every price in
  `economy_specification.md` is derived from.
* **The `api/` implementation.** That directory is an unrelated NestJS application today.
  These documents and their schemas are what an implementation would be built against.
