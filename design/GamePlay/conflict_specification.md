# Conflict — Specification

Who may shoot whom, and what it costs. Written 2026-09-13.

Owned by this document: PvP legality, NPC threat, how an engagement forms, what happens when
a hull dies, and facility raiding. How a battle *resolves* is owned entirely by
`Combat-logic/combat_logic_specification.md` and is not restated here — this document decides
which fleets enter phase 9 and what phase 10 does with the wreckage.

## 1. What the map already decided

`Systems_Planets` §3 puts the richest extraction in the least secure systems and the best
industry in the most secure. `logistics_specification.md` §3 observes that the six hull
categories able to carry cargo are exactly the ones unable to fight. Put together, the
conflict layer has its subject handed to it: **the game's most valuable cargo is always in
transit, always soft, and always coming out of somewhere dangerous.**

Nothing below invents a reason to fight. It supplies the rules for a fight the map and the
cargo table already guarantee.

## 2. PvP legality

| tier | unprovoked PvP | response fleet | flagging | insurance pays | market tax |
|---|---|---|---|---:|---:|
| `core` | **blocked** | immediate, overwhelming | — | 0.80 | 2.0 % |
| `mid` | allowed | arrives after 6 rounds | aggressor flagged 10 turns | 0.70 | 1.5 % |
| `rim` | free | none | — | 0.50 | 0.5 % |
| `deadspace` | free | none | — | **0.00** | 0 % |

**`core` is genuinely safe.** An aggression order in a `core` system is rejected at
validation (`turn_specification.md` §3.2) rather than attempted and punished. A new player's
home system cannot be raided, and that guarantee is what makes the starting package in
`progression_specification.md` §5 meaningful.

**`mid` is the interesting tier.** Aggression is permitted, but a **response fleet** — four
Battleship Tier 3 and four Battlecruiser Tier 3, about **518,000 credits** of hulls — enters
the engagement at round 6.

That figure is not chosen for feel. The richest fleet a single player can field is five
copies of the dearest hull in the catalogue: 5 × Battleship Tier 3 = **370,000 credits**. The
response fleet has to beat that with room to spare, and `verify_npc.py` recomputes the bar
from the live catalogue and fails the build if a response fleet falls under it.

So an attack in `mid` is viable only if it concludes in under six rounds, which means
ambushing something soft, not fighting something equal. That is precisely the behaviour the
tier should encourage: piracy against haulers, not fleet actions. `core`'s fleet is larger
still — twelve hulls, about 814,000 credits — and enters at round 1, which is why §2 calls
`core` blocked rather than merely expensive.

An aggressor in `mid` is **flagged for 10 turns**: response fleets engage them on sight
anywhere in `core` or `mid`, and NPC orders refuse to trade with them. Flagging is the cost
of using safe space as a hunting ground.

**`rim` and `deadspace` have no rules at all.** This is where the precision lane lives
(`Systems_Planets` §3 places `irradiated` and `shattered` worlds only there), where insurance
stops paying, and where the market tax is zero because there is no one to collect it.

## 3. NPC threat

Squadrons spawn per system, scaled by security tier, composed from real hulls in the ship
catalogue. Nothing hostile spawns in `core`.

| tier | template | hulls | reference value | rate | bounty | salvage | total |
|---|---|---:|---:|---:|---:|---:|---:|
| `mid` | pirate raiders — 3× Corvette T1, 1× Submarine Chaser T1 | 4 | 12,097 | 0.05 | 605 | 3,380 | 3,985 |
| `rim` | raider pack — 2× Merchant Raider T2, 2× Destroyer T2 | 4 | 43,321 | 0.10 | 4,332 | 5,723 | 10,055 |
| `rim` | pirate wing — 3× Destroyer T2, 2× Light Cruiser T2 | 5 | 49,730 | 0.10 | 4,973 | 8,111 | 13,084 |
| `deadspace` | warband — 4× Heavy Cruiser T3, 1× Battlecruiser T3 | 5 | 161,664 | 0.18 | 29,099 | 13,159 | 42,258 |
| `deadspace` | capital threat — 1× Battleship T3, 4× Heavy Cruiser T3 | 5 | 180,227 | 0.18 | 32,441 | 13,783 | 46,224 |

Bounty dominates in `deadspace` and salvage dominates everywhere else — a consequence of
§5.1, where salvage is the *fit* and light hulls are mostly fittings.

**The margin is deliberately thin.** A player fleet capable of taking a deadspace warband is
five Heavy Cruiser T3 — about **133,000 credits** of hulls — against a **42,258** combined
reward. Insurance pays nothing in `deadspace`, so losing one heavy cruiser costs 26,556 and
leaves +15,702 on the operation; losing two puts it **10,854 in the red**.

Deadspace pays, but only those who win cleanly.

## 4. How an engagement forms

In phase 8, for every system, fleets present are grouped into engagements:

1. **Interdiction.** A fleet with posture `interdict` detects arrivals through the gates it
   holds (`logistics_specification.md` §5) and may force them into an engagement.
2. **Mutual presence.** Two fleets in the same system, at least one with posture `engage`,
   and legality permitting, form an engagement.
3. **NPC squadrons** engage any fleet not running `silent` that passes their detection check.
4. **`avoid`** attempts disengagement. Success is the combat spec's signature, detection and
   relative-speed model, unchanged — a fast, quiet fleet escapes a slow, loud one.

Detection is the gate on all four. A fleet running `silent` — −50 % signature, −30 % speed,
weapons cold for the turn — may pass an interdictor entirely, which is the counter-play that
keeps chokepoints from being absolute.

### 4.1 Fleet operations

No player commands more than five hulls
(`progression_specification.md` §3). A **fleet operation** is several union members'
fleets declaring themselves one force in one engagement, and it is the only way a battle
exceeds five hulls per side.

This is what makes `Combat-logic/battle_log_veritas_vs_cinder.md` — thirteen hulls against
seventeen — a reachable game state rather than a fiction: three or four union members each
bringing four or five hulls. The combat spec's §1.2 granularity rule then applies on its own
terms, switching from shot-by-shot to task-group resolution somewhere around eight to ten
hulls a side.

### 4.2 The round cap

An engagement resolves to conclusion inside phase 9, capped at **25 rounds**. At the cap both
sides disengage with whatever damage they have taken. The cap exists so one battle cannot
hang a turn, and it is set well above the 14-round skirmish and the phased fleet action the
two battle logs record.

## 5. Destruction

**Retreat threshold: 30 % hull.** This is the ruling `gameplay_specification.md` §7 takes on
`combat_logic_specification.md` §5.4 — the schema said 15 %, both battle logs behave like
30 %, and the logs win. A hull at or below 30 % attempts to break off; whether it succeeds is
the combat spec's disengagement check.

A hull that does not break off and reaches zero is **destroyed and removed**. There is no
wreck-to-repair path, no capture, no crippled state. The hull is gone, the fleet slot is
free, and the player's Formation Drill level still permits the same number of ships — they
simply have one fewer.

### 5.1 Wrecks and salvage

```
SALVAGE_DROP     0.50 per fitted weapon and module, independently rolled
SALVAGE_CARGO    0.50 of cargo units aboard
WRECK_LIFETIME   2 turns
```

Wrecks persist for two turns in the system where the hull died and are looted in phase 10 by
whoever holds the field — the side still present with a surviving hull. If both sides
withdrew, the wreck stands until it expires or someone returns for it.

Salvage is the fit, never the hull, and `economy_specification.md` §2.1 shows how sharply
that varies: a Motor Torpedo Boat is 84 % fittings and drops around 525 credits from a
1,247-credit hull, while a Battleship is 10 % fittings and drops 3,812 from 74,003.

**Killing small ships is proportionally the better business.** That falls out of the
catalogue's own build costs rather than from a rule, and it is a useful counterweight: it
gives a small fast fleet a reason to hunt other small fast fleets instead of everyone
massing toward capitals.

### 5.2 Insurance

Numbers in `economy_specification.md` §6. The mechanics:

* Cover is bought per hull, continuous, charged in phase 12, at **0.004 × bare hull
  reference price per turn**.
* It pays the **bare hull** only — `buildCost` minus fitted weapons and modules — at the rate
  of the tier the hull **died in**, not the tier it was insured in.
* `deadspace` pays **nothing**. A player who takes a battleship into deadspace has accepted
  its full loss, and the premiums they paid getting there are gone too.

Cover replaces about 90 % of a battleship's value and 16 % of a torpedo boat's, for the same
reason salvage runs the other way: a light hull *is* its weapons. Insurance protects capital
investment; it does not protect a fit.

## 6. Standings

One number per player per region, moved by actions the region's NPC authority observes:

| action | effect |
|---|---|
| destroying an NPC squadron | standing up, scaled by the squadron's reference value |
| completing an NPC contract | standing up |
| unprovoked aggression in `mid` | standing down, plus a 10-turn flag |
| aggression in `core` | not possible — rejected at validation |

Standing moves NPC order prices within that region and how quickly response fleets arrive.
It has no effect in `rim` or `deadspace`, where no authority exists to hold an opinion.

Union standing is the mean of its members'. Unions do not accrue standing of their own,
consistent with `economy_specification.md` §9 — they are a pooling device, not a polity.

## 7. Facility raiding

The rule that gives `troopCapacity` a job. Two hull categories carry troops, and both also
carry cargo — the amphibious line:

| hull | troops | cargo |
|---|---:|---:|
| Landing Ship Tank T1 / T2 / T3 | 400 / 512 / 624 | 2,600 / 3,328 / 4,056 |
| Attack Transport T1 / T2 / T3 | 1,400 / 1,792 / 2,184 | 6,200 / 7,936 / 9,672 |

A fleet carrying troops, in a `rim` or `deadspace` system, may raid a warehouse another
player leases there:

```
TROOPS_PER_WAREHOUSE_UNIT = 0.5      troops needed per unit of slot capacity
RAID_HAUL                 limited by the raiding fleet's cargo capacity
RAID_COOLDOWN             4 turns per warehouse
```

A 600-unit warehouse slot needs 300 troops, so an Attack Transport T3 can crack seven slots
in one operation and carry 9,672 units away. If a defending fleet is present, the raid
happens only if the raider wins the engagement in phase 9 first.

**A raid takes the contents, never the lease.** Planets remain terrain, per
`Systems_Planets` §10 and `industry_specification.md` §1; there is no capture, no ownership
transfer, and no damage to the facility. The victim loses stock and keeps their operation.

Raiding is barred in `core` and `mid` — those tiers have a response fleet, and a raid is
aggression. So the only warehouses at risk are the ones out where the good ore is, which
closes the loop the map opened: deadspace pays best, and deadspace is where you can be robbed.

## 8. The generated catalogue

`tools/generate_npc.py` writes `GamePlay/NPC/`:

```
GamePlay/NPC/
  conflict_specification.md   this file; survives a run
  squadrons.json              templates per security tier, composed of real shipIds
  response_fleets.json        the core and mid response formations
  contracts.json              the four archetypes from economy_specification.md §8
  index.json                  bounty rates, flag durations, salvage and raid constants
```

New keys in `fleet_and_weapons.json`: `npcSquadrons`, `contractArchetypes`.

## 9. Invariants

`tools/verify_npc.py` and the conflict section of `tools/verify_gameplay.py`:

* every hull id in every squadron template resolves in the live ship catalogue
* squadron reference value rises strictly as security falls, across all templates
* no squadron spawns in `core`
* every response fleet's reference value **exceeds the richest fleet one player can
  field** — `fleetSlots` copies of the dearest hull, where `fleetSlots` is counted from
  `skl_flt_formation_drill`'s unlocks rather than assumed to be 5
* `deadspace` insurance payout is exactly 0.00, and payout rates rise strictly with security
* for every hull, bare hull price is strictly positive, so insurance never pays for nothing
  (shared with `verify_market.py`)
* the retreat threshold is stated once, here, at 0.30, and no other document or schema
  restates it
* the round cap exceeds the longest engagement in either battle log
* `troopCapacity` is consumed by §7 and by nothing else, and exactly the two categories with
  non-zero `capacities.troops` are permitted to raid
* every security tier appears in the §2 legality table, and the tiers are exactly the four in
  `Systems_Planets` §3
