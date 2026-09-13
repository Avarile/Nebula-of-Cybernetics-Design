# The Turn — Specification

One clock for the whole universe. Written 2026-09-13.

Owned by this document: how long a turn is, the fourteen phases it resolves through, how
orders are submitted and validated, how simultaneous claims are broken, and what makes a
turn replayable. Everything else in `GamePlay/` assumes the phase order fixed in §2.

## 1. The clock

```
TURN_LENGTH_HOURS = 24
SP_PER_TURN       = 43200        # 24 h x SP_PER_HOUR_REFERENCE (1800), tools/skill_tables.py
```

One turn, one day, one resolution. There is no second clock: industry, movement, combat,
markets and training all advance exactly once per turn. A player who is present for the
whole day and a player who submits once and logs off get the same number of turns.

This is why the existing catalogues need no reinterpretation. Every "per turn" figure in
`Systems_Planets/systems_planets_specification.md` §4 — 120 raw units/turn from a
`ferrous_barren`, 75 construction/turn from a forge world — is a literal daily rate. The
battleship that spec calculates at "about 10 turns" is ten days.

**Rounds are not turns.** A battle resolves entirely inside phase 9, running as many rounds
as it needs. `Combat-logic/` calls those rounds "turns"; `gameplay_specification.md` §3
renames them. Nothing in the combat rules is rescaled — a weapon with a 2-turn cooldown in
the weapon catalogue has a 2-*round* cooldown, and it recovers inside a single day.

## 2. The fourteen phases

Resolution order is fixed and total. Every player's orders pass through the same phase at
the same time; there is no interleaving by player.

| # | phase | what resolves |
|---:|---|---|
| 1 | **Intake closes** | the order book is snapshotted; nothing submitted after this point affects turn N |
| 2 | **Training** | SP awarded, queues advanced, levels granted |
| 3 | **Extraction** | planetary slots and belt mining produce |
| 4 | **Refining** | raw → refined |
| 5 | **Manufacturing** | refined → manufactured |
| 6 | **Construction** | shipyard berths advance; finished hulls delivered |
| 7 | **Movement** | fleets spend jump range; arrivals recorded |
| 8 | **Detection** | sensor resolution, interdiction, engagement formation |
| 9 | **Combat** | every engagement runs to conclusion |
| 10 | **Salvage** | wrecks rolled, field holder loots |
| 11 | **Market** | orders matched and cleared |
| 12 | **Upkeep** | lease rent, insurance premiums, fuel and ammo drawn |
| 13 | **Settlement** | contracts completed, standings adjusted, bounties paid |
| 14 | **Log** | turn log written, turn N+1 opens |

Four orderings are load-bearing and were chosen, not inherited:

**Training first (2 before everything).** A level that completes this turn is in effect for
every phase after it. A player who finishes Ship Construction Management on turn N gets the
better rate on turn N, not N+1. The alternative — training last — makes every level a day
late for no design benefit.

**Industry before movement (3–6 before 7).** A hull finished in phase 6 can be crewed and
moved in phase 7 the same turn. Material produced this turn can be loaded and hauled the
same turn. The chain does not stall a day on delivery.

**Movement before combat (7 before 9).** A fleet that jumps into a system fights there the
same turn. Without this, every engagement is announced a day in advance and no attack ever
lands.

**Market after combat (11 after 9).** Goods destroyed in phase 9 cannot be sold in phase 11.
A player cannot dodge a loss by selling a cargo that has already burned.

### 2.1 The snapshot rule

Phases 3, 4, 5 and 6 are a chain, and each reads the warehouse **as it stood at the start of
phase 3**, not as the previous phase left it.

So ore extracted on turn N is refinable on turn N+1, and a raw-to-hull run costs at minimum:

```
turn N     extract        raw       -> warehouse
turn N+1   refine         refined   -> warehouse
turn N+2   manufacture    mfg       -> warehouse
turn N+3.. construct      hull progresses at the yard's rate per turn
```

Three turns of latency before the first rivet, then construction time on top. This is
deliberate. Without it the whole material chain collapses into a single day, warehouses
become decorative, and `skl_sta_production_management` — which buys nothing but warehouse
capacity — has no reason to exist.

## 3. Orders

An order is one instruction, submitted against turn N, conforming to
`Data-Templates/turn_order.interface`. Each names the phase it resolves in, so intake can
bucket without interpreting.

| order | phase | names |
|---|---:|---|
| `train.queue` | 2 | an ordered list of `(skillId, targetLevel)` |
| `mine.assign` | 3 | a fleet and a belt |
| `facility.job` | 3–6 | a lease, an operation, an input good and a quantity |
| `fleet.move` | 7 | a route: an ordered list of system ids |
| `fleet.posture` | 8 | `engage` · `avoid` · `interdict` · `silent` |
| `fleet.target` | 9 | a priority list for target selection |
| `cargo.transfer` | 7, 12 | between a fleet hold and a warehouse at the same location |
| `market.order` | 11 | buy or sell, good, quantity, limit price, system |
| `facility.lease` | 12 | claim or release a slot |
| `contract.accept` · `contract.post` | 13 | a contract |
| `insurance.set` | 12 | a hull and a cover level |
| `union.*` | 13 | membership and shared-asset actions |

### 3.1 Standing orders

**An absent player does not stop.** Every order that can sensibly repeat does, until
cancelled or invalidated:

* the training queue keeps advancing and rolls to the next entry on completion
* facilities keep running their last job while inputs and rent hold out
* a fleet on a multi-system route keeps travelling until it arrives
* a fleet's posture persists
* market orders stand until filled, expired or cancelled

Silence is a valid strategy, not a penalty. In a game where a turn is a day, requiring daily
attendance to avoid losing ground would make absence a punishment rather than a choice.

### 3.2 Validation, twice

Orders are validated at **intake** against the state at submission, and again at
**execution** against the state the phase actually finds. The second check is the real one:
a lease can be taken, a market order filled, a cargo destroyed between submission and
resolution.

An order that fails the second check is **dropped with a logged reason** and never
partially applied. `turn_order.interface` carries a `rejection` field for exactly this, and
the turn log (§6) reports every rejection to its owner. Silent failure is the one outcome
the design does not permit — in a 24-hour turn, a player who cannot see why an order did
nothing has lost a day with no way to learn from it.

Partial fills are not failures: an order to refine 500 units with only 300 in the warehouse
refines 300 and logs the shortfall.

## 4. Simultaneity

Two players lease the last refinery slot on the same planet in the same turn. Both orders
are valid at intake. One wins.

Contention is resolved by a **total order over orders**, applied inside each phase:

```
rank = (phaseOrdinal, submissionSequence, playerId)
```

`submissionSequence` is a monotonically increasing integer assigned by the server at intake,
in receipt order. `playerId` breaks the remaining tie and is unique, so the ordering is
total — never partial, never dependent on iteration order over a hash map.

First come, first served, with a deterministic tail. Submitting early is a genuine
advantage for contested resources, which is the one place where being present has value,
and it is bounded: it decides *who gets the slot*, never *how much anyone produces*.

The contended claims are: facility leases, market order matching, belt mining assignments
where a belt has limited concurrent capacity, and interdiction when several fleets try to
hold the same gate.

## 5. Determinism

The same submitted orders and the same turn number produce a byte-identical turn log. This
is the property the five existing generators already hold for data production, extended to
world simulation, and it is what makes a turn auditable and a bug reproducible.

Three rules carry it:

1. **Phase order is fixed** — §2, no exceptions, no dynamic reordering.
2. **Every tie-break is total** — §4, and any new contention point must supply one.
3. **Randomness is derived, never ambient.** There is no call to a global RNG anywhere in
   resolution. Every random draw takes its seed from the turn:

```
seed(context) = H(turnNumber, contextId)
```

where `contextId` identifies the draw site — an engagement id, a wreck id, a critical-hit
roll within a named round. `H` is a fixed hash, specified once in the implementation and
never varied. Replaying turn N regenerates every seed identically, so a combat log can be
re-derived from the order book alone.

Combat is the one phase with meaningful randomness (hit rolls, criticals, point-defense
interception, wreck drops). All of it draws from §5's seeds, which is what lets
`Combat-logic/`'s structured event log be a *derivation* rather than a recording.

## 6. The turn log

Two tiers, mirroring the arrangement `combat_logic_specification.md` §4 already sets up for
battles, extended to the whole turn.

**Tier 1 — the ledger.** Every state change, machine-readable, sufficient to reconstruct the
turn: SP awarded, each facility job's input and output, each movement, each engagement's
full event log, each market fill, each credit debit and credit, each rejected order with its
reason. This is ground truth and it is what the determinism property in §5 is asserted
against.

**Tier 2 — the player's day.** A per-player narrative digest drawn from tier 1: what
finished training, what the facilities made, where the fleet is, what it met, what it cost.
A player reads this and knows what their day was without reading a ledger.

Battles inside phase 9 keep their own two-tier treatment unchanged; the turn log embeds the
engagement id and the digest quotes the narrative highlights.

## 7. Invariants

`tools/verify_gameplay.py` checks the turn rules that can be checked statically:

* every order type in `turn_order.interface` names a phase that exists in §2
* every phase in §2 is named by at least one order type or is a pure system phase
  (8, 10, 13, 14 are the system phases)
* `SP_PER_TURN == TURN_LENGTH_HOURS * SP_PER_HOUR_REFERENCE`, read from
  `tools/skill_tables.py` rather than restated
* no contended resource named in §4 lacks a tie-break rule
* the phase list is dense and ordered 1–14 with no gaps

The runtime properties — determinism under replay, no ambient RNG, no silent order failure —
are implementation test obligations, not static checks, and are named here so they are
written down before anyone builds the resolver.
