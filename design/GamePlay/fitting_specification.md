# Fitting — Specification

What a player may bolt to a hull, where, and what it costs. Written 2026-10-03.

Owned by this document: the fitting rules, weapons and modules as goods, the refit order,
where and how long a refit takes, and what fitting does to prices, insurance and salvage.
The rules themselves have one implementation, `tools/fitting.py`; this document states them
and `tools/verify_fitting.py` holds the two together.

## 1. What changed

`gameplay_specification.md` §9 used to say hulls arrive fitted and refitting is a catalogue
matter. It is now a player one. Two consequences follow, and the rest of this document is
their detail:

* **A catalogue fit is a default fit.** The weapons and modules a tier hull carries in
  `Ships/` are what it is built and sold with. A hull a player holds carries its **own** fit,
  in its fleet entry (`FleetHull.fit` in `Reference/gameplay.ts`), and that fit can differ
  from the catalogue's.
* **Weapons and modules are goods with a use.** Every one already had a reference price
  (`economy_specification.md` §2). Before this, 730 of the 798 weapons and 22 of the 45
  module lines sat in no default fit — priced, and good for nothing. Now each of them is a
  legal fit on at least one hull (§6), and the verifier keeps it that way.

## 2. The rules

A fit is legal when it breaks none of these. They read the hull's fixed layout and the
items' catalogue entries, nothing else — no skill, no planet, no player — so a fit cannot
become illegal because a skill was trained or a module's effect applied.

| rule | requires |
|---|---|
| `mounts` | the fit names every hardpoint and slot of the hull, and nothing else; an empty mount is `null` |
| `items` | every fitted id is a weapon on a hardpoint or a module in a slot, and exists in the catalogue |
| `weapon_size` | a weapon goes only on a hardpoint of the **same** size |
| `slot_type` | a module goes only in a slot of its own `slotType` |
| `slot_size` | a module goes only in a slot of its own size **or larger** |
| `affinity` | a `specific` module goes only on a hull whose `shipClass` is in its `hullAffinity` |
| `one_per_type` | no two modules of one `moduleType` on a hull |
| `power` | `power.maxPower` ≥ passive module draw + one full weapon volley |
| `crew` | `crew.maxCrew` ≥ the fitted modules' `crewRequired` |

```
volley  = SUM over fitted weapons ( powerCost x fireRate.shotsPerRound )
passive = SUM over fitted modules ( powerCost )
crew    = SUM over fitted modules ( crewRequired )
```

The bare hull — every mount empty — is always legal, so a refit can always strip a hull.

**Weapons match size exactly; modules fit at or below the slot.** Every weapon archetype is
built at all four sizes, so a same-size rule costs a hardpoint nothing. A module line is
built at one size only — a Flag Bridge is capital, a Targeting Computer small — so a
same-size rule would tie a slot to one size of module for good. A slot's `size` is
therefore its category's module capacity (`mod_cap` in `tools/ship_tables.py`): every slot
on a battleship takes up to capital, every slot on a destroyer up to medium.

**The mount follows the weapon.** `mountType` is not a rule. A hardpoint is a size; the
mount is what the weapon fitted to it makes of it (`MOUNT_FOR_CLASS`: kinetic and energy
make a turret, missile a missile bay, mine and melee a fixed mount). Putting a launcher where
a gun was turns the turret into a missile bay. Were the catalogue's mounts binding, no
template hull could ever take a large or capital missile, mine or melee weapon — 110 goods
with nowhere to go. No combat rule reads `mountType`.

**One of each type.** Module effects sum without diminishing returns (combat §1.3), and a
few hulls have two slots of one type — the sloop and the repair tender two utility slots,
the transports and the oiler two cargo slots. Without `one_per_type` a transport would stack
two of one cargo module. The rule is by `moduleType`, so one power plant, one radar and one
armour belt per hull: a Fusion Generator and a Capacitor Bank are both `powerCore`.

**The budgets are the printed ones.** `power.maxPower` and `crew.maxCrew` are read as the
hull prints them. A Fusion Generator's +25 % `power.maxPower` is power in combat
(`Combat-logic/combat_logic_specification.md` §1.1 phase 4), not room for more weapons;
reading it here would let a fit pay for itself. How a round's power is spent is combat's to
rule; this budget only says the hull can run what it carries.

### 2.1 What the rules leave out

* **Marks.** Any mark on any tier. The catalogue fits Mk.N to a tier-N hull; a player may
  put a Mk.5 gun on a tier-1 hull if the power budget covers it. Each mark draws more power,
  so the budget is the limit.
* **Mass.** A part's `mass` changes nothing. A hull's `mass.value` is its mass as fitted,
  and fuel per ly, jump range and the yard's tonnage limit all read that one figure.
* **Skills.** None. Fitting is a yard's work and needs no skill of the owner; using what is
  fitted is gated where it always was — the hull's Control and System Management, the
  Weaponry skills' −50 % below level 5. Industry §8 says the two mining equipment skills
  gate mining modules (`standard_mining_equipment`, `advanced_mining_equipment`); the
  catalogue has no mining module yet, and when one exists it adds a capability check on the
  player beside these rules, not inside them.

## 3. Parts are goods

Every weapon and module is one of the 1,043 tradeable goods, at the reference price
`economy_specification.md` §2 derives from its `buildCost`. Fitting adds three things:

* **Built at a berth.** A shipyard berth's `construct` job (`facility.job`, phase 6) builds
  any weapon or module as well as a hull, from manufactured units in the warehouse on the
  same planet, at the berth's construction rate. A part costs its `buildCost` in
  manufactured units: 3.45–54.01 for a weapon, 0.55–22.47 for a module. A hull is still
  built with its default fit; there is no bare-hull job, because stripping a new hull gives
  back the parts as goods and wastes nothing.
* **Stored in a warehouse.** A part takes warehouse capacity equal to its `buildCost` units
  — the space of what it was made from. A Belt Armour Mk.1 takes 20.0.
* **Traded like any good.** NPC orders in `core` and `mid` buy and sell every part, at the
  manufactured column of the price index, as they do every finished item.

## 4. The refit

### 4.1 Where

A refit needs a yard, and the hull must be **at** it: in the yard's system, not in transit,
in phase 6. Two kinds of yard:

| | a berth the player leases | an NPC yard |
|---|---|---|
| where | a `shipyard` lease of the player or their union, any `siteType` | any planet with berths in a `core` or `mid` system |
| who | the leaseholder; Science 7 and Ship Construction ≥ 1 to hold the lease (industry §3) | anyone not flagged as an aggressor — NPC yards refuse a flagged player, as NPC orders do |
| rate | the berth's construction per turn × `shipConstructionRate` | the planet's whole construction per turn, every berth, untrained |
| fee | none — the berth's rent is the price | `NPC_YARD_FEE` = **0.05** of the reference price of every item moved |
| parts | from a warehouse the player or union leases on that planet; removed parts go back to it | bought at the system's NPC ask; removed parts sold at its NPC bid — or a named warehouse on the planet, as at a berth |
| capacity | one hull at a time; the berth's `construct` job pauses until the refit is done | no limit |
| tonnage | the hull's `mass.value` ≤ the site's `maxHullTonnage` | the same |

Every region with policed space has an NPC yard. Obsidian Marches and The Pale Hollow have
none, so a refit there needs a player's berth, and nothing can be refitted in `deadspace`,
which has no yard of either kind (`Systems_Planets` §6.2). The heaviest hull can be
refitted only where it can be built: a forge world at development 3.

**The hooks.** A refit reads a *shipyard lease*, never a planet type, so an orbital
station's berth — a lease with `siteType: orbital` — is a refit site the day stations
exist, with no rule added. A refit in the field, by a repair tender, is deliberately not in
this design: a fit is a commitment made in port, which is what makes scouting a fleet worth
doing and a wreck's drop worth fighting over. If one is added, it is a third column in the
table above.

### 4.2 The order

`ship.refit` resolves in **phase 6**, beside construction, so a refit finished today can
sail in today's phase 7 — the same reason industry runs before movement
(`turn_specification.md` §2).

| field | meaning |
|---|---|
| `fleetId`, `hullId` | the hull |
| `site` | `{ leaseId }` for a berth, or `{ npcYardPlanetId }` |
| `partsLeaseId` | a warehouse lease on the site's planet; required at a berth, optional at an NPC yard |
| `fit` | the complete target fit (`HullFit`), or `null` to cancel the refit in progress |

It is not a standing order: one order starts one refit, which then runs to completion.

**Validated twice** (`turn_specification.md` §3.2). At intake, against the state at
submission, and again in phase 6 against the state the phase finds — warehouse stock as it
stood at the start of phase 3 (§2.1 there). The order is dropped with a logged reason
unless all of these hold:

1. the hull is the player's, in the named fleet, the fleet is in the site's system and not
   in transit, and the hull has no refit in progress (unless the order cancels it);
2. the site is a shipyard lease the player or their union holds, with no other refit on it,
   or an NPC yard the player is not flagged at;
3. the hull's `mass.value` is within the site's `maxHullTonnage`;
4. the target fit passes §2 — `tools/fitting.py` `fit_is_valid`, the same call the verifier
   makes on every default fit;
5. the target fit differs from the hull's fit;
6. the parts are there: everything installed and not removed by the same refit is in the
   parts warehouse, or, at an NPC yard, the player's credits cover the asks and the fee;
7. the hull's cargo and ammunition still fit its capacities under the new fit (`cargoCapacity`
   and `ammoCapacity` through combat §1.3's stacking rule) — unload first with
   `cargo.transfer`. Craft over a new hangar capacity are scrapped instead (combat §2.6):
   craft are not goods and have nowhere to be unloaded to.

When it passes in phase 6 the hull is **docked**: the parts it needs are reserved in the
warehouse, and the refit starts.

### 4.3 How long, and what it costs

```
labour = REFIT_LABOUR_SHARE x SUM over items moved ( item buildCost units )      REFIT_LABOUR_SHARE = 0.50
fee    = NPC_YARD_FEE       x SUM over items moved ( item referencePrice )        NPC_YARD_FEE       = 0.05
```

An item is **moved** once when it is installed and once when it is removed, so a swap moves
two. Labour is in the berth's own unit — manufactured units of construction — so a refit
competes with building for the same throughput, and Ship Construction Management speeds
both. Installing a part is half the work of building it.

Labour accrues at the site's rate each phase 6, and the refit **completes in phase 6 of the
turn its labour is covered**, counting the turn it starts. Most refits finish the day they
are ordered: one torpedo launcher swapped for another on a Destroyer Tier 3 is about 11
units, against 18 a turn on the poorest berth in the game.

The worst case is stripping the whole default fit and fitting it again — every part moved
twice, so labour equals the fit's `buildCost` units. On a forge world at development 3: one
berth builds 45 a turn untrained, the NPC yard on the same planet 180.

| hull | fit units | turns, one berth | turns, NPC yard | fit value | NPC yard fee |
|---|---:|---:|---:|---:|---:|
| Motor Torpedo Boat Tier 1 | 12.9 | 1 | 1 | 1,050 | 105 |
| Destroyer Tier 3 | 74.0 | 2 | 1 | 4,381 | 438 |
| Heavy Cruiser Tier 3 | 97.2 | 3 | 1 | 4,986 | 499 |
| Battleship Tier 3 | 182.9 | 5 | 2 | 7,623 | 762 |

Two trades fall out. **A berth is slow and free; an NPC yard is fast and charges.** A
battleship's full refit holds its fleet five days on one untrained berth (four with Ship
Construction Management at 10, at 58.5 a turn) and two at the yard, which charges about
10 % of the fit for moving it twice. **The poorer the yard, the longer the wait**: the same
destroyer refit takes 5 turns on an oceanic berth at development 1 (18 a turn).

`verify_fitting.py` recomputes this table from the live hull, price and facility
catalogues.

### 4.4 While docked

* **The fleet is held.** A `fleet.move` for a fleet with a docked hull is rejected, and a
  convoy holding one holds as a whole, as it does for a hull short of fuel
  (`logistics_specification.md` §8.2).
* **The hull fights as it is.** The fit changes only on completion. A docked hull in `mid`
  or `rim` can be attacked like any other and fights with the fit it has; the yard does not
  protect it.
* **Completion** installs the parts and returns the removed ones to the parts warehouse, or
  sells them at the NPC bid. At an NPC yard the asks, the bids and the fee settle here. A
  completion that cannot settle — a full warehouse, credits short — is **held**, not
  dropped, and logged; it completes in the first phase 6 that it can, as a full warehouse
  halts production rather than destroying it (industry §5).
* **Cancelling** (`fit: null`) undocks the hull in the next phase 6. Its fit is unchanged,
  the reserved parts are released, the labour spent is lost, and nothing is charged.
* **Destruction** ends the refit. Reserved parts never left the warehouse, so they are not
  in the wreck.

At a berth, contention exists only between members of one union naming the same union berth
in one turn; they resolve by rank (`turn_specification.md` §4), and the berth takes the
first.

## 5. Value, insurance and salvage

### 5.1 A hull is worth its hull plus its parts

```
hullValue(hull, fit) = bareHullPrice(hull) + SUM over fit ( referencePrice(item) )
```

A tier hull's `buildCost` is its bare cost plus its default fit's (`generate_ships.py`), and
a reference price is linear in `buildCost`, so a default-fitted hull's value **is** its
catalogue `referencePrice`. The verifier checks the published prices add up for all 98
hulls.

**Pricing.** An NPC sell order offers a hull only as the catalogue good, with its default
fit, at its `referencePrice`. An NPC buy order takes any hull, fitted any way, at
`hullValue` — so a hull sold stripped fetches its `bareHullPrice`, and its parts are sold
separately. There is no bare hull for sale: a player who wants one strips a new hull, and
the parts come back as goods.

### 5.2 No free money

Every part, every hull and every fit sits on the same manufactured column of the price
index and the same NPC spread. So the loops fitting opens are the loops `economy_specification.md`
§4 already closes:

* **Buy fitted, strip, sell in pieces.** The pieces sum to the hull. The best a player can
  do is the spread: `(1 − h) / (1 + h)` times an index ratio of at most 1.1053 (bought in
  `core` at 0.95, sold in `mid` at 1.05), under the 1.1739 threshold §4 proves at Trade 10. Stripping at an NPC
  yard adds a fee; at a berth, labour. Either way it loses.
* **Buy parts, fit them, sell the hull.** The same sum the other way, and the same spread.
* **Refit at an NPC yard.** The yard buys and sells parts at the NPC quotes of its own
  system, so it is an NPC order with a fee on top.

`verify_fitting.py` runs the first loop for every tier hull, every pair of NPC-order tiers
and every level of `skl_trd_trade`, on the published prices.

### 5.3 Insurance covers the hull, salvage is the fit aboard

Both rules in `conflict_specification.md` §5 were written as "the bare hull" and "the
fit", and both survive a fit that varies by player unchanged:

* **Insurance** is priced on `bareHullPrice` — a property of the hull alone, the same for
  every fit on it. A refit changes neither the premium nor the payout. What a fit costs is
  never insured, which is what `economy_specification.md` §6 already says.
* **Salvage** rolls `SALVAGE_DROP` = 0.50 once for every item in the fit **the hull carried
  when it died** — `FleetHull.fit`, not the catalogue's. The `expectedSalvage` the market
  publishes per hull is the default fit's; NPC squadrons fly default fits, so the conflict
  §3 squadron table is exact for them.

So the asymmetry conflict §5 describes becomes a choice. A player can strip a light hull
before a `deadspace` run and lose less, or load a capital with parts its catalogue fit never
carried and lose more; insurance pays the same bare hull either way.

## 6. What the catalogue had to change

Fitting rules that a player can break the catalogue must keep, and making them the rules
surfaced four things.

**Slot sizes.** A filled slot used to take the size of whatever the default fit put in it,
so a battleship's command slot read `large` because a CIC Tower is large, and the capital
Flag Bridge could be fitted to no hull at all. Tier-hull slots now carry their category's
module capacity. No default fit changed — the generator always picked modules at or under
that capacity — and no price moved.

**Dead affinity.** A `hullAffinity` entry naming a category with no slot the module fits is
a promise nothing can keep. Eleven were dropped, and the verifier now fails on any:

| module | dropped | why |
|---|---|---|
| Seaplane Catapult | light cruiser, heavy cruiser, battlecruiser, battleship | no hangar slot |
| ASW Aircraft Bay | destroyer escort, sloop | no hangar slot |
| Smoke Generator | destroyer | no utility slot |
| Hospital Bay | fleet aircraft carrier | no utility slot |
| Mine Rails | destroyer, fleet torpedo boat | no cargo slot |
| Refuelling Rig | seaplane tender | no cargo slot |

None of those hulls carried the module, so no fit and no price changed. The Seaplane
Catapult now fits only the seaplane tender, whose default fit takes the ASW Aircraft Bay:
the catapult is a refit choice there. If cruisers are meant to fly floatplanes, the fix is a
hangar slot in their signature, which would change their default fits and prices.

**Drones are refit-only, and that is intended.** No tier hull carries `capacities.drones`
or fits a Drone Bay or Drone Controller, so no NPC squadron or response fleet ever launches a
drone. A player gets drones by putting one of the two in a hangar slot — on a carrier,
replacing its Aircraft Elevator; the carrier keeps its hull's base fighters and trades the
elevator's for drones (combat §2.6). That makes drones the one weapon an NPC never fields,
and a player choice that costs fighters.

**Named ships are story hulls.** The 20 named ships carry the fits the battle logs were
written with, before the power budget and mounts were rules: all 20 overdraw `power.maxPower`
— Emperor's Bastion needs 780 against 345 — and their `maxPower` feeds the signature the
logs' lock ranges are calibrated on (combat §2.3), so it cannot simply be raised. No rule
hands a named ship to a player or sets one against a player: starting hulls, NPC squadrons
and response fleets are all tier hulls, and the verifier holds them to legal fits. Named
ships answer to the size and slot rules only.

## 7. Invariants

`tools/verify_fitting.py`:

* §2's rule table lists exactly the rules `tools/fitting.py` applies, in order
* every tier hull's default fit passes `fit_is_valid` — the call a `ship.refit` is judged by
* every hull a player starts with, meets in an NPC squadron or faces in a response fleet is a
  tier hull with a legal default fit
* every `specific` module fits a hull its `hullAffinity` names, and every category its
  `hullAffinity` names can take it at some tier — no dead entry
* every weapon and every module is a legal fit, alone, on some tier hull — no dead good
* every region with policed space has an NPC yard, some NPC yard takes the heaviest hull, and
  an NPC yard's rate is its planet's published construction rate
* §4.3's table recomputes from the live catalogues
* a hull's published price is its bare hull plus its parts, for all 98
* **no free money** — buying any tier hull at an NPC ask and selling it stripped at an NPC
  bid loses, for every pair of NPC-order tiers and every trade level
* the NPC yard fee is a listed drain (`economy_specification.md` §7)
* `Reference/constants.ts` mirrors `REFIT_LABOUR_SHARE`, `NPC_YARD_FEE` and `MOUNT_FOR_CLASS`,
  and `FleetHull` carries `hullId`, `fit` and `refit`

`tools/verify_ships.py` and `tools/verify_modules.py` judge the catalogue's fits through the
same `tools/fitting.py`; neither restates a rule.
