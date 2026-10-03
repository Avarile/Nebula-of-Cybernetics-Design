# Nebula of Cybernetics — Design Gaps & Open Questions

Oct 3, 2026 · @Avarile

The design is complete except for 7 gaps (G1–G7) and 8 open balance questions (Q1–Q8). Each needs a decision from you before it becomes a task.

The gaps come from the schema-gap audit (commit `381d402`). That audit mapped all 160 spec sections to their data schemas and checks, recorded in `design/GamePlay/schema_coverage.md`. A **gap** is a mechanic the specs describe but that the design does not yet supply. A **question** is a balance concern that an earlier task raised.

**How to review:** for each item, pick a decision in the summary table (Approve the recommendation, Change it, or Defer), and comment on anything you want done differently. Approved items become tasks under Game Design Nebula-of-Cybernetics.

## Summary

Four gaps block a core loop or contradict another spec (G1–G3) or leave the money supply unbounded (G4). Recommended priorities are below.

| ID | Item | Area | Proposed priority | Folds in | Decision |
| --- | --- | --- | --- | --- | --- |
| G1 | Belt mining has no mining equipment | Industry, catalogue | Important | — |  |
| G2 | No dock repair or crew replacement | Logistics, industry | Important | — |  |
| G3 | Ammunition counted two ways | Combat, logistics | Important | Q8 |  |
| G4 | NPC contract and squadron rates undefined | Economy, conflict | Prioritise | Q4 |  |
| G5 | 1.25× fuel/ammo markup is not a constant | Economy | Prioritise | Q7 |  |
| G6 | Supply contract urgency has no scale | Economy | Normal | — |  |
| G7 | New player's starting credits not computed | Progression | Normal | — |  |
| Q1 | Mine fields nearly always catch two ships at the opening | Combat | Balance review | — |  |
| Q2 | Afterburner costs no power; "engines" power share unread | Combat | Balance review | — |  |
| Q3 | Point defence intercepts missiles at the 95% cap | Combat | Balance review | — |  |
| Q5 | Deadspace is \~311 ly from any NPC market | Map, economy | Balance review | — |  |
| Q6 | Stations can't be sold, given or captured | Stations | Balance review | — |  |

Q4, Q7 and Q8 are the same problems as G4, G5 and G3, so they are answered there.

## G1 — Belt mining has no mining equipment

**Recommendation: add a mining module line (Mk.1–3) and rule that a hull mines a belt only with one fitted.** Mining is one of the three careers the original brief names, and today it cannot be played.

**What exists**

- The `mine.assign` order, a belt mining rate, and asteroid belts on the map.
- Four Deep Space Mining skills, whose `miningYield` and `miningCycleSpeed` bonuses multiply belt output.
- Industry §8: belt output goes to "hulls carrying mining equipment".

**What is missing**

- No module or hull in the catalogue is mining equipment.
- The two "mining equipment" skill unlocks therefore gate nothing, and the skill bonuses multiply a base no hull can reach.

**Options**

1. **A mining module line (recommended).** For example, a strip-miner module at Mk.1–3 in a cargo or utility slot, with a `hullAffinity` on hulls that already carry cargo (attack transport, landing ship tank, fleet oiler). Fits the fitting rules as they stand; the skill unlocks become a run-time check beside the fit check.
2. **A dedicated mining hull category.** Closer to EVE, but adds a 27th category, a new branch in the hull skill tree and new prices, a much bigger change.

**Decision needed:** option 1 or 2, and which hulls may mine.

## G2 — No dock repair, and no way to replace lost crew

**Recommendation: repair and crew replacement happen at a shipyard berth, the same site as a refit, priced in manufactured units.** Damage now persists between battles, so without this rule a damaged ship stays damaged for good.

**What exists**

- Each hull now carries hull, component and crew damage between battles.
- A repair tender's `repairRatePerTurn` restores hull HP to ships in the same place.
- Hospital bays recover some casualties after a battle.

**What is missing**

- Logistics §4 says a fleet "repairs at a facility it leases", but no slot type, rate or cost is defined.
- A catastrophic critical leaves a component "destroyed until dock repair", and no dock repair rule exists.
- Crew lost beyond hospital capacity can never be replaced.

**Options**

1. **Repair at a berth (recommended).** A leased berth, an NPC yard, or a station yard repairs hull and components at a rate in manufactured units per turn, like a refit. Crew are replaced at the same site for credits per crew member.
2. **A new repair slot kind.** More flexible, but adds a sixth facility type to planets and stations.
3. **Tenders only.** Simplest, but makes the repair tender mandatory and leaves destroyed components unfixable.

**Decision needed:** where repair happens, the repair rate, and the crew replacement cost.

## G3 — Ammunition is counted two different ways (and Q8)

**Recommendation: each mount starts a battle with the smaller of its own `ammo` and what the hull's magazine still holds, and every round fired is drawn from the magazine.** Today the combat and logistics specs contradict each other.

**The conflict**

- **Combat** counts rounds per weapon mount, from each weapon's `ammo` value.
- **Logistics** §6 counts one shared magazine per hull, `capacities.ammo`.
- Neither says which one a battle draws from, or how a mount reloads between rounds and between battles.

**Options**

1. **Both, magazine feeds mounts (recommended).** Keeps the per-weapon ammo the catalogue already carries, and gives the hull magazine and restocking a purpose.
2. **Per mount only.** Drop `capacities.ammo`; restocking refills each mount. Simpler, but magazine modules lose their meaning.
3. **Magazine only.** Drop per-weapon `ammo`; volleys draw straight from the hull. Changes the weapon catalogue.

Only missiles and mines use ammunition (251 weapons); kinetic and energy weapons are unlimited.

**Decision needed:** which model.

## G4 — NPC contract and squadron rates are undefined (and Q4)

**Recommendation: add per-security-tier rates for NPC contracts posted and NPC squadrons spawned per system per turn, as constants in `gameplay_tables.py`.** Without them, three money sources have no volume limit.

**Why it matters**

- Bounties, NPC contract rewards and haul rewards all create credits. Each is defined in kind, but nothing says how many happen.
- So the "every faucet has a drain" balance (gameplay §6.5) cannot be computed as a ratio, only as a list.
- Squadron spawn rate also decides how dangerous rim and deadspace really are, which the hauling risk premiums assume but never state.

**Options**

1. **Fixed rates per security tier (recommended).** For example `NPC_CONTRACT_RATE` and `NPC_SPAWN_RATE` keyed by core / mid / rim / deadspace. Easy to verify and balance.
2. **Demand-driven rates.** Contracts appear where a market's stock runs low; squadrons where player traffic is high. More alive, but needs a simulation to tune.

**Decision needed:** fixed or demand-driven, and a starting value per tier.

## G5 — The 1.25× markup on fuel and ammo is not a real number (and Q7)

**Recommendation: make it a named constant (e.g. `CONSUMABLE_MARKUP = 1.25`), apply it everywhere fuel and ammunition are bought from NPCs, and accept that the hauling profit figures move.** Today the specs say one thing and the numbers do another.

**The inconsistency**

- Economy §7 says players pay 1.25× for fuel and ammunition, but only in prose.
- The drain table names the wrong constant (`FUEL_PER_POWER_CORE`) as this drain's rate.
- Economy §8.3's hauling profit table prices fuel at the plain NPC ask, without the markup.

**Impact of fixing it:** fuel is a main running cost of a haul, so every hauling margin in economy §8.3 drops. Core hauling is already a thin living (about 96 credits per turn for an attack transport), so it may go negative unless the freight rate rises.

**Options**

1. **Keep 1.25× and retune the haul freight rate (recommended).**
2. **Drop the markup.** Fuel and ammo cost the plain NPC price; one fewer money sink.
3. **Keep it only on ammunition.** Protects hauling, keeps a combat-side sink.

**Decision needed:** whether the markup stays, and on what.

## G6 — Supply contracts have no urgency scale

**Recommendation: derive urgency from how far a facility's input stock has fallen below what one turn of its slots consumes, capped at a fixed maximum.** That lets NPCs post supply contracts with a reward that follows real need.

**The problem**

- A supply contract pays `referenceValue × shortfallUrgency`.
- `shortfallUrgency` is neither a constant nor derived from anything.
- A player posting one can type any number; an NPC-posted supply contract has nothing to set it from.

**Options**

1. **Derived from stock shortfall (recommended),** e.g. 1.0 when stock covers one turn, rising to a cap such as 1.5 when empty.
2. **A fixed number per security tier,** like the haul risk index. Simpler, but blind to actual need.
3. **Remove NPC supply contracts;** players set their own urgency freely.

**Decision needed:** how urgency is set, and its cap.

## G7 — A new player's starting credits are never calculated

**Recommendation: have the progression generator compute the seed credits from a stated reference — the rent of one refinery slot on a development-3 core planet for 20 turns, plus fuel for a stated number of jumps in a starting hull — and publish the figure in the starting package.** The rule exists in words but produces no number.

**What exists**

- Progression §5: a new player gets "enough for about 20 turns of one refinery lease plus fuel".
- `STARTING_CREDIT_LEASE_TURNS = 20` exists but nothing reads it.
- A new player also starts with a free 20-turn refinery lease, Science level 3, and a choice of three entry hulls (motor torpedo boat, submarine chaser, corvette).

**What is missing:** which planet's lease, which development tier, and how much fuel. The starting package publishes no credit figure.

**Options**

1. **Derived figure, as above (recommended).** Moves automatically if rents or fuel prices change.
2. **A flat number,** e.g. a round credit amount set by hand. Simple, but drifts out of step with prices.

**Decision needed:** the reference planet tier and the fuel allowance (number of jumps).

## Open balance questions

**These five are tuning questions, not missing rules; the game works without answering them, but each skews play.** Suggested: one "balance review" task covering all five.

| ID | Question | Evidence | Options |
| --- | --- | --- | --- |
| Q1 | Mine fields nearly always catch two ships at the opening | Every ship on a side starts at the same point on the combat line (combat §1.4), so `area_denial` splash hits two hulls almost every time early on | Give each side a starting spread; or accept it as a mine strength |
| Q2 | Afterburner costs no power, and nothing reads the "engines" share of power allocation | Combat §1.1 phase 4 lists engines; afterburner gives ×1.25 speed for only +40% signature | Make afterburner draw power from the engines share; or drop engines from power allocation |
| Q3 | Point defence intercepts missiles at the 95% cap almost every time | Every point-defence weapon's raw intercept chance is above 1.3, so the 0.20 missile evasion never matters (combat §2.5). Fighters were recalibrated to 1.10 for this reason; missiles were not | Recalibrate missile evasion as was done for fighters; or keep it, so missiles beat point defence only by saturation |
| Q5 | Deadspace is far from any market | The median deadspace system is 311 ly from an NPC market, about 42 turns laden for an attack transport, so hauling structural ore out of deadspace loses money (economy §8.3) | Add region bridges or deadspace trade posts; or accept that deadspace exports only high-value precision ore |
| Q6 | Stations can't be sold, given or captured | Station §5; an orbit market would be a market in map capacity | Allow transfer between players or within a union; or keep stations permanent |

## Next steps

Once you have set a decision on each row of the summary, approved and changed items become tasks under Game Design Nebula-of-Cybernetics, assigned to Agentic Mind (Designer), with your choices written into each task. Deferred items stay recorded in `design/GamePlay/schema_coverage.md`.

- [ ] Review G1–G7 and set a decision for each
- [ ] Review Q1, Q2, Q3, Q5, Q6 and set a decision for each
- [ ] Create tracker tasks from the approved and changed items
