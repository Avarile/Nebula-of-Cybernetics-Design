# Logistics — Specification

Getting there, and getting back with the cargo. Written 2026-09-13.

Owned by this document: how far a fleet moves in a turn, what it burns doing so, what it can
carry, how it rearms, and who can stop it on the way. The gate graph and `jumpDistanceLy`
are owned by `Systems_Planets/systems_planets_specification.md` §5.3; this document is what
spends them.

`Systems_Planets` §10 deferred travel cost explicitly — *"`jumpDistanceLy` is recorded so a
later movement model can use it, but no turn cost is defined here"*. This is that model.

## 1. Jump range

A fleet spends a range budget each turn, set by its **slowest** hull:

```
JUMP_RANGE_BASE      = 8.0    ly per turn at the reference speed
JUMP_SPEED_REFERENCE = 300    the topSpeed a hull needs to make base range

lyPerTurn = JUMP_RANGE_BASE x (slowestEffectiveTopSpeed / JUMP_SPEED_REFERENCE)
```

`slowestEffectiveTopSpeed` is the hull's `mobility.topSpeed` **after** skills and modules —
so `skl_nav_navigation` at +1 %/level is already inside it and is not applied a second time.
There is no separate navigation term in this formula, and `verify_gameplay.py` checks that
no document introduces one.

At tier 3, with no skills:

| hull | topSpeed | ly/turn | gates/turn at 4.2 ly |
|---|---:|---:|---:|
| motor torpedo boat | 694 | 18.5 | 4 |
| torpedo boat (fleet) | 560 | 14.9 | 3 |
| destroyer | 470 | 12.5 | 2 |
| heavy cruiser | 414 | 11.0 | 2 |
| battlecruiser | 403 | 10.7 | 2 |
| battleship | 336 | 9.0 | 2 |
| fleet oiler | 258 | 6.9 | 1 |
| landing ship tank | 213 | 5.7 | 1 |
| monitor | 202 | 5.4 | 1 |

A fleet moves at its slowest hull, so attaching one monitor to a destroyer squadron cuts its
strategic mobility by more than half. Composition is a movement decision before it is a
combat one.

### 1.1 Transit carries over

Range is spent on whole gate transits. When the remaining budget cannot cover the next gate,
the fleet does not stop — the transit **accumulates across turns**, and the fleet is *in
transit* until the accumulated range covers the distance.

A fleet in transit:

* cannot be detected, engaged, interdicted or scanned
* cannot mine, trade, transfer cargo or accept contracts
* still trains, still pays rent, still holds its leases

It emerges at the destination gate during phase 7 and is exposed to phase 8 immediately.
The transit is safe; **the arrival is the exposed moment**, which is what makes a held gate
worth holding (§5).

This rule exists so that a monitor at 5.4 ly/turn can still cross a 6 ly gate. Without it a
slow hull on a long gate would be permanently immobile, and the map spec authors gate
distances without knowing what will try to cross them.

## 2. Fuel

```
FUEL_MASS_DIVISOR      = 100    tons of fleet mass per fuel unit per ly
FUEL_PER_POWER_CORE    = 100    fuel units from one res_mfg_power_core
COMBAT_FUEL_BURN       = 0.05   of a hull's fuel capacity, per engagement fought

fuelPerLy(hull) = hull.mass.value / FUEL_MASS_DIVISOR
fuelRange(hull) = capacities.fuel / fuelPerLy(hull)
```

Fuel is drawn per hull, not per fleet, so a mixed fleet runs its heaviest hull dry first.
Burn is charged in phase 12, after movement and after combat.

Tier-3 fuel ranges, which fall straight out of capacities the ship catalogue already
authors:

| hull | mass t | tank | range ly |
|---|---:|---:|---:|
| **fleet oiler** | 23,650 | 71,760 | **303** |
| motor torpedo boat | 102 | 187 | 183 |
| sloop / patrol escort | 1,802 | 2,496 | 138 |
| destroyer | 3,255 | 3,432 | 105 |
| panzerschiff | 15,400 | 14,040 | 91 |
| heavy cruiser | 15,800 | 11,856 | 75 |
| battlecruiser | 44,750 | 24,960 | 56 |
| fleet aircraft carrier | 40,200 | 21,840 | 54 |
| **battleship** | 65,100 | 31,200 | **48** |
| coastal defence ship | 7,340 | 2,964 | 40 |
| **monitor** | 8,900 | 2,184 | **25** |

The doctrine this produces was already latent in the data and is worth stating plainly:
**small hulls are strategic, capital hulls are local.** A motor torpedo boat crosses
183 ly unsupported; a battleship manages 48, roughly eleven gates, which is not enough to
cross the map. Capital fleets that operate at range need a fleet oiler, and the fleet oiler
carries 303 ly of its own — the only hull in the game that can refuel a battle line and
still get home. `mod_refuelling_rig`'s `fuelTransferRate` is what moves it (§4).

The monitor at 25 ly is the extreme case and is correct: a monitor is a system-defence hull,
and the numbers say so without anyone writing a rule that says so.

### 2.1 Running dry

A fleet with insufficient fuel for its next transit **does not move** and logs the shortfall.
It is not destroyed, not damaged, and not teleported home. It sits where it is until fuel
reaches it — by its own cargo, by an oiler, or by a purchase if there is a market in the
system.

In `core` and `mid` systems there always is; in `rim` and `deadspace` there may not be
(`economy_specification.md` §4). Being stranded in deadspace is therefore a real and
recoverable failure, and it is the cost of the richness the map puts out there.

`fuelRange` appears in `stat_vocabulary.SHIP_STATS`, so modules may modify it. A module
effect on `fuelRange` is a **percentage multiplier on the derived ly figure** — fuel
efficiency, not a bigger tank — since no hull carries a `fuelRange` field for it to add to.

## 3. Cargo

Cargo capacity is `capacities.cargo`, in tons, and at `unitMass: 1.0` for every resource
(`Resources/resource_tiers_specification.md`) one ton is one unit.

**Six of the twenty-six categories can carry anything at all.** At tier 3:

| hull | cargo |
|---|---:|
| attack transport | 9,672 |
| fleet oiler | 8,112 |
| repair ship / tender | 6,552 |
| merchant raider | 5,304 |
| landing ship tank | 4,056 |
| seaplane tender | 2,808 |

Every warship — destroyer, cruiser, battlecruiser, battleship — carries **zero**. A war
fleet cannot haul its own ore, its own output, or its own loot. Hauling is a separate hull, a
separate skill line and, in practice, a separate player.

That single column is what makes the map's economic geometry bite. `Systems_Planets` §3 puts
the ore where security is worst and the factories where it is best, and this table says the
thing that moves between them is soft, slow and unarmed. The escort problem is not designed;
it is what the two catalogues already imply when you put them together.

Cargo transfers (`cargo.transfer`, phases 7 and 12) move units between a fleet hold and a
warehouse **at the same location**, and between hulls in the same fleet. There is no remote
transfer.

## 4. Refuelling and repair at sea

Two `specific` modules, already in the catalogue with `hullAffinity` restricting them to the
hulls that should have them:

* **`fuelTransferRate`** — a fleet oiler or tender transfers this many fuel units per turn
  to other hulls in the same fleet or in a fleet at the same location. This is the whole
  reason the fleet oiler exists, and its 303 ly range plus 71,760-unit tank makes it the
  strategic enabler for every capital operation beyond eleven gates.
* **`repairRatePerTurn`** — a repair ship / tender restores hull HP per turn to hulls at the
  same location, outside combat. Without one, a damaged fleet repairs only at a facility it
  or its union leases.

Both are drawn from the same fleet slots as anything else, so a five-hull fleet that brings
an oiler and a tender brings three fighting hulls.

## 5. Interdiction

A fleet whose posture is `interdict` (phase 8) at a system holds that system's gates. Any
fleet **arriving** through a gate that turn is detected and may be forced into an engagement
in phase 9, subject to the security rules in `conflict_specification.md` §2.

Three properties:

* **Arrival, not transit.** §1.1 makes fleets in transit unreachable, so an interdictor
  catches fleets as they emerge, never mid-jump.
* **Detection decides.** Whether an interdictor sees an arrival is the combat spec's
  signature and detection model, unchanged — a fleet arriving with posture `silent` runs at
  −50 % signature and may pass unseen, at the cost of −30 % speed and cold weapons.
* **Chokepoints are real.** `Systems_Planets` §5.3 authors about seven named region-bridge
  gates as the only links between regions. Interdiction is what finally makes "The Meridian
  Gate" and "Cold Harbour Approach" strategic objects rather than flavour names: a union
  holding one of them holds a region's trade.

An interdictor pays for the privilege — it is stationary, visible, burning no fuel but
earning nothing, and an interdiction that catches nothing is a wasted turn.

## 6. Rearming

`capacities.ammo` is the hull's magazine. It is drawn down by **missile and mine weapons
only** — the 251 weapons that carry a finite `ammo` count. Kinetic and energy weapons are
`ammo: "infinite"` in the catalogue and consume nothing but power, which is what the combat
rules already model.

```
ROUNDS_PER_ORDNANCE_CHARGE = 100    rounds restocked per res_mfg_ordnance_charge
```

Restocking happens in phase 12, from a warehouse at the same location or by purchase. A hull
whose magazine cannot cover a launcher's volley does not fire that weapon.

Magazines are deep relative to a battle. A tier-3 destroyer escort carries 468 rounds against
10 rounds per volley — 47 volleys, where an engagement caps at 25 rounds. So ammunition is a
**campaign** constraint, not a battle one: a missile fleet can fight one long action or
several short ones before it must go home or meet a hauler.

**This is a doctrine asymmetry, not an oversight.** Missile and mine fleets have a logistics
tail; gun and beam fleets do not. Whether that is worth the missile's guided accuracy against
fast targets is the choice the two weapon lines exist to offer, and it is also what stops the
ordnance lane from being dead weight — the lane is only 1.1 % of a battleship's build cost,
and ammunition is what it is actually for.

> **Observation for the ship catalogue.** The three `seaplane_tender` hulls carry
> `capacities.ammo: 0` alongside kinetic mounts firing 18–30 rounds per volley. Harmless
> under this rule, since kinetic draws nothing. It would become a live contradiction if
> ammunition were ever extended to guns, so it is recorded here rather than silently fixed.

## 7. What the energy lane is for

Between §2 and the combat burn, the energy lane has a recurring sink it did not have before:

```
travel    fuelPerLy x lyTravelled                per hull, per turn
combat    COMBAT_FUEL_BURN x capacities.fuel     per hull, per engagement
```

A battleship burns 651 fuel per ly and 1,560 per engagement — about 2.4 ly worth of fuel to
fight once. Both are paid in `res_mfg_power_core` at 100 fuel per unit, which is the only
per-turn consumer of manufactured energy goods in the game. Without it the energy lane would
be a one-off construction input and nothing else.

## 8. Invariants

`tools/verify_gameplay.py`, logistics section:

* every tier-3 hull's `fuelRange` is positive and finite; no hull has a tank of 0 with
  non-zero mass
* the slowest hull in the game still reaches `lyPerTurn > 0`, so §1.1's carry-over rule is
  the only thing needed for universal mobility
* `fuelPerLy` is strictly increasing in hull mass
* exactly the hulls with `capacities.cargo > 0` are the ones permitted to accept
  `cargo.transfer`, and no warship category has non-zero cargo
* every weapon drawing on a magazine has a finite `ammo` value in the weapon catalogue, and
  every weapon with `ammo: "infinite"` draws nothing
* `fuelRange`, `cargoCapacity`, `ammoCapacity` and `fuelTransferRate` are each consumed by a
  rule in this document — the `gameplay_specification.md` §6.1 "no dead skill" check
* no formula in this document applies a navigation multiplier outside
  `slowestEffectiveTopSpeed`
