# Economy — Specification

What a thing is worth, and where the credits come from. Written 2026-09-13.

Owned by this document: the credit, the reference price of every tradeable good, NPC orders,
the player market, contracts, and unions. Reference prices are **derived from `buildCost`**,
which every weapon, module and hull already carries — nothing in this document authors a
price for an item.

## 1. The credit

One currency, universal, held by players and unions. It is not a resource: it has no
`unitMass`, occupies no cargo, and cannot be mined, refined or manufactured. It enters the
world only through the faucets in §7 and leaves only through the drains, and §7 is the
complete list of both.

## 2. Deriving prices

Four authored numbers, and everything else is arithmetic.

```
RAW_PRICE       structural 10.00   energy 14.00   ordnance 12.00   precision 40.00
PROCESS_MARGIN  0.15      the gross margin a processing stage earns
ITEM_MARGIN     1.10      assembly margin on a finished weapon, module or hull
```

Prices climb the refining chain by dividing out the yield loss the resource catalogue
already publishes, then adding the processing margin:

```
refined      = raw     / lane.conversionYield / 1.0  x (1 + PROCESS_MARGIN)
manufactured = refined / 0.85                        x (1 + PROCESS_MARGIN)
```

| lane | raw | yield | refined | yield | manufactured |
|---|---:|---:|---:|---:|---:|
| structural | 10.00 | 0.90 | 12.78 | 0.85 | **17.29** |
| energy | 14.00 | 0.80 | 20.12 | 0.85 | **27.23** |
| ordnance | 12.00 | 0.75 | 18.40 | 0.85 | **24.89** |
| precision | 40.00 | 0.50 | 92.00 | 0.85 | **124.47** |

Precision starts dearest *and* refines worst, so it compounds: a manufactured guidance
assembly is **7.2×** the price of a structural component. That is
`resource_tiers_specification.md`'s "precision refines poorly, deliberately" finally
expressed in credits.

Then, for any of the 1,043 tradeable goods:

```
referencePrice(item) = SUM over lanes ( item.buildCost[lane] x manufacturedPrice[lane] ) x ITEM_MARGIN
```

### 2.1 What that produces

| item | reference price |
|---|---:|
| Damage Control Party Mk.1 (cheapest module) | 12 |
| Kestrel Depth Charge Rack Mk.1 (cheapest weapon) | 209 |
| Search Radar Mk.3 (dearest module) | 1,050 |
| Motor Torpedo Boat Tier 1 | 1,247 |
| Draconis Cruise Missile Bay Mk.5 (dearest weapon) | 1,645 |
| Destroyer Tier 3 | 10,015 |
| Heavy Cruiser Tier 3 | 26,556 |
| Battlecruiser Tier 3 | 55,439 |
| **Battleship Tier 3** | **74,003** |

A battleship's 74,003 credits break down as **47.5 % structural, 44.8 % precision**, 6.7 %
energy and 1.0 % ordnance. Nearly half the cost of a capital ship is guidance electronics
whose raw feedstock only exists in `rim` and `deadspace`, which is the map's central claim
restated as a price tag.

A hull's `buildCost` **already includes its default fit** — ships sum the catalogues they
fit from. So a hull's reference price is its value as the catalogue fits it, never a sum to be
added to. A hull a player has refitted is worth its bare hull plus the parts actually on it
(`fitting_specification.md` §5.1); for the default fit the two are the same number. The split
matters for insurance and salvage (§6), and it is sharply tier-dependent:

| hull | total | bare hull | fit | fit share |
|---|---:|---:|---:|---:|
| Motor Torpedo Boat T1 | 1,247 | 197 | 1,050 | **84 %** |
| Destroyer T3 | 10,015 | 5,633 | 4,381 | 44 % |
| Heavy Cruiser T3 | 26,556 | 21,571 | 4,986 | 19 % |
| Battleship T3 | 74,003 | 66,379 | 7,623 | **10 %** |

A light hull is mostly its weapons; a capital hull is mostly itself.

## 3. Security and the price index

A good's local reference price is its global price times an index set by the system's
security tier:

| tier | raw | refined | manufactured |
|---|---:|---:|---:|
| `core` | **1.25** | 1.10 | 0.95 |
| `mid` | 1.10 | 1.05 | 1.05 |
| `rim` | 0.90 | 0.95 | 1.25 |
| `deadspace` | 0.80 | 0.90 | **1.45** |

The gradient runs in opposite directions for the two ends of the chain, and it is the same
inversion `Systems_Planets` §3 builds the map on: **raw is dear where nobody digs, finished
goods are dear where nobody builds.** Haul ore inward, haul hulls and ammunition outward.
Neither direction is the "real" trade route; the loop is.

## 4. NPC orders — and why they stop at `mid`

NPC buy and sell orders exist **only in `core` and `mid` systems**. They are a liquidity
floor and ceiling, not a market: they never run out, never move, and always quote a spread
placed **symmetrically** around the local index price:

```
NPC_SPREAD = 0.20                       the full round-trip cost
halfSpread = (NPC_SPREAD / 2) x (1 - tradePriceMargin)

NPC sells to a player at   referencePrice x index x (1 + halfSpread)
NPC buys from a player at  referencePrice x index x (1 - halfSpread)
```

Symmetry is what makes the skill safe. `skl_trd_trade` narrows the player's half-spread but
can never move it past the index price, so a same-system round trip is a loss at every skill
level — 0.900 / 1.100 = 0.818 untrained, 0.920 / 1.080 = **0.852** for a maxed trader. There
is no level at which buying and instantly reselling pays.

The `core`/`mid` restriction is what makes the *cross-system* case safe, and it is what makes
`gameplay_specification.md` §6.2 — *no free money* — provable. A haul between two NPC markets
profits if and only if

```
sellerIndex / buyerIndex  >  (1 + halfSpread) / (1 - halfSpread)
```

The binding case is a maxed trader moving raw material from `mid` to `core`:

| NPC orders exist in | worst index ratio | threshold at Trade 10 | |
|---|---:|---:|---|
| `core` + `mid` only | **1.1364** (raw, mid → core) | 1.1739 | safe, headroom **0.0375** |
| everywhere | **1.5625** (raw, deadspace → core) | 1.1739 | **arbitrage** |

Extend NPC orders to `deadspace` and a player buys raw at 0.80 and sells at 1.25 risk-free,
forever, without moving anything a hostile could intercept. So the restriction earns its
place: it is the single assumption holding the no-free-money invariant.

The headroom of 0.0375 is this document's equivalent of the 0.01 margin
`Systems_Planets` §6.1 leaves on the refining invariant — thin, deliberate, and checked.
Raising `core`'s raw index from 1.25 to 1.30 would take the ratio to 1.1818 and break it.
`verify_market.py` recomputes the whole table from the live index and skill catalogues rather
than trusting the numbers on this page.

Beyond `mid` there is no floor. `rim` and `deadspace` trade at whatever players will pay,
which is exactly where the risk premium should live.

**What NPC orders list.** Every tradeable good except two kinds. Station kits are commissions
(`station_specification.md` §3.1). The 20 named ships are story hulls no player can hold —
their fits overdraw their own power budgets (`fitting_specification.md` §6) — so their
reference prices are a valuation only, and no NPC order sells or buys one.

## 5. The player market

Orders are per system, per good — a limit price, a quantity, a side. They match in phase 11
by price, then by the total order of `turn_specification.md` §4.

**Where a fill lands.** Every order names a location in its system (`market.interface`
`order.location`): a warehouse lease the poster holds there, or one of the poster's fleets
there, not in transit. A buy is delivered into it and a sell taken from it, so goods never
move remotely (`logistics_specification.md` §3). A fleet's holds take a fill hull by hull, in
fleet order, up to their free tons; what does not fit is not bought, and the shortfall is
logged. A hull bought joins the named fleet — or a new fleet in the system, when the location is
a warehouse — and counts against Formation Drill like any other.

```
MARKET_TAX   core 2.0 %   mid 1.5 %   rim 0.5 %   deadspace 0 %
```

Tax is charged to the seller, on the value of the fill, and it is the economy's broadest
drain. It is highest where trading is safest, so **safety is taxed and risk is not** — a
deadspace trade pays nothing to anyone and may not arrive.

`skl_trd_trade` carries `tradePriceMargin` at **+2 %/level**, reaching +20 % at level 10,
and it acts on the NPC half-spread as §4 defines: `halfSpread = 0.10 × (1 − margin)`, so a
maxed trader faces 8 % either side instead of 10 %. That is a 3.6-percentage-point
improvement on a round trip — small in isolation, decisive at volume, and never enough to
invert the spread. It does not touch player-to-player fills; there is no spread to narrow
when both sides are players.

## 6. Insurance and salvage, priced

Both mechanics belong to `conflict_specification.md`; their numbers are here because they
are prices.

```
INSURANCE_PREMIUM   0.004 x bareHullReferencePrice, per turn, charged in phase 12
INSURANCE_PAYOUT    core 0.80   mid 0.70   rim 0.50   deadspace 0.00   of bare hull
SALVAGE_DROP        0.50 per fitted item, independently rolled; 0.50 of cargo units
```

Insurance covers the **bare hull only** — `buildCost` minus the default fit — and pays at the
rate of the tier the hull died in, not the tier it was insured in. The bare hull price is the
hull's own, whatever is fitted to it, so a refit moves neither premium nor payout.

The §2.1 fit table makes this sharply asymmetric, and the asymmetry is real rather than
tuned: insurance replaces 90 % of a battleship's value and 16 % of a motor torpedo boat's,
because a torpedo boat *is* its torpedoes. Conversely a wreck's loot is the fit, so killing
small ships yields proportionally far more salvage (525 credits from a 1,247-credit torpedo
boat) than killing capitals (3,812 from a 74,003-credit battleship).

Premium is flat at 0.004/turn wherever the hull is, so cover breaks even against a `core`
death at 200 turns and a `rim` death at 125. In `deadspace` it pays nothing and is pure
drain — which is the correct price for a region where nothing else protects you either.

## 7. Faucets and drains

`gameplay_specification.md` §6.5 requires every faucet to have a drain. The complete list:

**Faucets — credits created**

| source | rate | bounded by |
|---|---|---|
| NPC buy orders | `reference × index × 0.80` | goods the player actually produced |
| Bounties | `0.05 / 0.10 / 0.18` of an NPC squadron's reference value in `mid` / `rim` / `deadspace` | NPC squadrons killed; none spawn in `core` |
| Contract rewards | §8 | contracts posted by NPCs |
| Haul rewards | `(tons × HAUL_FREIGHT_RATE + value × HAUL_RISK_RATE × (risk − 1)) × ly`, §8.1 | NPC haul contracts; in `core` the freight barely covers the hauler's running cost (§8.3) |
| Insurance payout | §6 | premiums paid in, minus the margin |

**Drains — credits destroyed**

| sink | rate | scales with |
|---|---|---|
| Facility rent | `industry_specification.md` §7 | capacity the playerbase holds — the largest and most continuous drain |
| Warehouse rent | `0.02` per unit of capacity per turn, `industry_specification.md` §7 | storage held |
| Market tax | 2.0 / 1.5 / 0.5 / 0 % | trade volume in safe space |
| Insurance premium | `0.004 × bare hull` per turn | hulls insured |
| NPC sell orders | `reference × index` | fuel, ammunition and starter goods bought rather than made |
| Consumable markup | `× 1.25` on fuel and ammunition | fleets operating away from their own industry |
| Forfeited haul collateral | cargo × the dearest NPC ask for it, §8.1 | NPC haul cargo lost to raiders or never delivered |
| NPC yard fee | `0.05 ×` the reference value of every part moved, `fitting_specification.md` §4.3 | refits done at an NPC yard rather than a berth the player leases |
| Station upkeep | `STATION_UPKEEP_RATE` (1.00) `×` the rent the station's slots would pay as leases, `station_specification.md` §4 | stations anchored — never less per unit than the cheapest lease, so moving capacity off-planet cannot shrink the rent drain |

The structural property: **every faucet is tied to an action, every drain is tied to a
holding.** Credits enter when someone produces or fights and leave continuously from
everyone who holds capacity or hulls. A player who stops playing stops earning but keeps
paying, so idle wealth erodes and the supply cannot ratchet upward from accumulated
inactivity.

`verify_market.py` asserts the list is closed against the code: the two tables name exactly the
`FAUCETS` and `DRAINS` of `tools/gameplay_tables.py`, row for row in both directions, and
`verify_gameplay.py` that each names a rate constant that exists. A faucet or drain cannot enter the game without entering this
table, and a row cannot outlive its entry. Each credit a turn creates or destroys names its row
in the turn log (`Data-Templates/turn_log.interface` `flow`), so a live turn's balance is a sum.

The `× 1.25` consumable markup is the one row whose rate is not yet a constant: it is named by
`FUEL_PER_POWER_CORE` and not applied by §8.3's running cost, which prices fuel at the plain NPC
ask (`GamePlay/schema_coverage.md` keeps it open).

## 8. Contracts

A contract is an offer to do work for credits, posted by an NPC or by a player, accepted in
phase 13. Four archetypes, each generated with parameters rather than authored individually:

| archetype | posted by | the job | reward |
|---|---|---|---|
| `haul` | NPC, player | move N units of a good from system A to B | `(cargoTons × HAUL_FREIGHT_RATE + cargoReferenceValue × HAUL_RISK_RATE × (routeRiskIndex − 1)) × routeDistanceLy` |
| `supply` | NPC, player | deliver N manufactured units to a facility | reference value × shortfall urgency |
| `bounty` | NPC, player | destroy N NPC hulls of a given tier in a given system | the squadron's reference value × the §7 bounty rate |
| `escort` | player | hold a convoy link to a named fleet from A to B | set by the poster; reference quote `escortedCargoValue × HAUL_RISK_RATE × (routeRiskIndex − 1) × ESCORT_SHARE × routeDistanceLy` |

Player-posted contracts are collateralised: the poster's credits are held at posting and
released on completion or on expiry. There is no unsecured promise, so a contract cannot be
used to create credits from nothing.

`escort` exists because of the cargo table in `logistics_specification.md` §3 — six hull
categories can carry anything and none of them can fight. A contract that pays combat players
to protect industrial ones is the mechanism that connects the two careers without forcing
either to train the other's skills.

**The route.** Both distance-priced archetypes are priced on the shortest route from A to B by
ly, fixed at posting. `routeRiskIndex` is `RISK_INDEX` (`core` 1.00, `mid` 1.15, `rim` 1.45,
`deadspace` 1.90) of the **least secure system on that route**, endpoints included. The haul
that matters most runs from deadspace ore to a core yard; priced on its destination, as the
first draft had it, it would earn no premium at all. The acceptor may fly any route; the
reward does not change.

### 8.1 Haul

```
HAUL_FREIGHT_RATE  0.012    credits per ton per ly        -- what it costs to run a hauler
HAUL_RISK_RATE     0.002    of cargo value, per ly, per point of risk above 1.00
```

A haul pays **freight** on the tonnage and a **risk premium** on the value. Freight is set so a
purpose-built hauler covers its running cost — fuel at the NPC ask and insurance premium, out
laden and back empty — with a thin margin. An attack transport costs 0.0093–0.0096 credits per
ton-ly to run and a landing ship 0.0078–0.0112, while an oiler, tender or merchant raider costs
0.015–0.038, so freight alone pays only the hulls built to haul. The premium is zero in `core`,
where nothing can attack a hauler, and it is the whole reason to haul anywhere else.

**Cargo.** An NPC haul issues the goods into the acceptor's hold at A on acceptance; a player
haul loads them from the poster's warehouse at A and delivers into the poster's warehouse at B.

**Collateral.** The acceptor posts

```
collateral = quantity × referencePrice × max over NPC tiers of (PRICE_INDEX × (1 + NPC_SPREAD / 2))
```

— the dearest NPC ask for that good anywhere: 1.375 × reference for raw, 1.21 for refined,
1.155 for manufactured goods and finished items. Keeping the cargo is then never a cheaper way
to buy it than an NPC sell order, and never a profitable way to sell it to an NPC buy order at
any trade skill. Without this, defaulting on an NPC haul of raw ore and selling it in `core` at
1.25 × 0.90 would turn a contract into risk-free arbitrage.

**Settlement**, in phase 13 of the turn the cargo reaches B: the acceptor receives
`reward × delivered / quantity` and the same fraction of their collateral. The rest of the
collateral is forfeited — to the poster of a player haul, and destroyed on an NPC haul, which
makes it a drain (§7). A haul that expires undelivered settles with nothing delivered. Cargo
lost in a fight is not delivered; half of it is in the wreck for whoever holds the field
(`conflict_specification.md` §5.1).

There is no escort variant of `haul`. A hauler who wants protection posts an `escort` for the
same route and pays it out of the haul's premium, which is what §8.2's reference quote is.

### 8.2 Escort

```
ESCORT_SHARE  0.50    of the haul's risk premium -- the reference quote
ESCORT_BOND   1.00    x reward, posted by the escort, forfeited on desertion
```

**Posted by the escorted party only.** The hauler (or its union) posts the contract, names its
fleet, A and B, and may reserve it for one player or union. An NPC-posted escort would put a
stranger inside a hauler's convoy and tell them its route; the hauler chooses who rides with it.

**What the escort does.** It accepts, names one of its fleets, and links that fleet to the
hauler's as a follower (`logistics_specification.md` §8.1 — the accepted contract is the
consent the link needs). From then on it travels at the convoy's pace and fights in the
convoy's engagements (`conflict_specification.md` §4.4).

**Reward.** The poster sets it, and it is held at posting like every player contract. The board
quotes a reference figure: half the risk premium a `haul` of the same cargo and route would
pay. It is zero on an all-`core` route, where an escort protects against nothing. The split
says the escort takes half the risk off the hauler and is paid half the price of it.

**Liability.** The escort's liability for a lost hauler is the fee it does not earn, in
proportion to what was lost. It is never liable for the cargo itself, which an escort could not
cover anyway: a hold of structural ore on an Attack Transport T3 is worth 96,720 credits, a
Destroyer T3 10,015.

| outcome | escort receives | poster receives | bond |
|---|---|---|---|
| convoy reaches B, link intact | `reward × arrivedCargoValue / departedCargoValue` | the rest of the reward | returned |
| escorted fleet destroyed outright | nothing | the reward | returned — losing a fight is not desertion |
| escort fleet destroyed outright | nothing | the reward | returned |
| escort cancels the link before B | nothing | the reward and the bond | forfeited to the poster |
| contract expires before B | nothing | the reward | returned |

Cargo values are taken at reference price, so no index can be played, and settlement is in
phase 13. Because both sides' credits are held in advance, an escort contract moves credits
between players and creates none: it is not a faucet, and §7 does not list it.

### 8.3 What a haul earns

The representative haul: a full hold of the cheapest raw good (structural, 9,672 units worth
96,720) on the hull with the largest hold (Attack Transport T3, 7.47 ly/turn), as an NPC
`haul`, laden out and empty back. Per ly of route:

| route tier | reward | running cost | margin | escort quote | hauler keeps | exposure | break-even loss per 100 ly |
|---|---:|---:|---:|---:|---:|---:|---:|
| `core` | 116.1 | 90.4 | 25.7 | 0.0 | 25.7 | 138,852 | 1.8 % |
| `mid` | 145.1 | 90.4 | 54.7 | 14.5 | 40.2 | 140,332 | 2.9 % |
| `rim` | 203.1 | 90.4 | 112.7 | 43.5 | 69.2 | 143,290 | 4.8 % |
| `deadspace` | 290.2 | 90.4 | 199.8 | 87.0 | 112.7 | 150,687 | 7.5 % |

*Exposure* is what a total loss costs the hauler: the collateral, plus the fit, plus the part of
the bare hull insurance does not pay in that tier. *Break-even loss* is the chance per 100 ly of
losing everything that would leave the haul, escort paid, at zero.

Three things follow:

* **Hauling pays at every tier**, thinly in `core`. Freight there is a living, not a fortune:
  25.7 per ly is about 96 credits a turn over the round trip.
* **The risk is priced faster than the safety net thins.** A `deadspace` haul stays worth
  doing at four times `core`'s loss rate, though insurance pays nothing there. Whether the
  route really is four times as dangerous is the game.
* **The escort quote pays for an escort.** A Destroyer T3 kept at the transport's pace costs
  24.6 per ly, out and back. The `rim` quote covers one and the `deadspace` quote three. An
  Anti-Aircraft Cruiser T3, at 54.9, needs a `deadspace` route or a dearer cargo.

**Hauling your own ore.** The same hold on the same hull carries raw ore from each system with
no NPC market to the nearest one, and sells it to the NPC bid, untrained. Both legs' power
cores ride in the hold, since there is nowhere to buy fuel where the ore is. Medians over the
live map:

| from | route ly | turns laden | precision ore, net per trip | structural ore, net per trip |
|---|---:|---:|---:|---:|
| `rim` | 56.7 | 7.6 | 29,159 | 3,446 |
| `deadspace` | 311.1 | 41.7 | 39,190 | −11,294 |

Precision ore pays its way home from anywhere it exists. Structural ore pays from `rim` and
loses money from `deadspace`, where the route is too long for its price. That is the map's
claim (`Systems_Planets` §3) restated as a haul: deadspace is for the precision lane.

## 9. Unions

A union is a player organisation, the only shared-ownership structure in the game.

`skl_trd_union_management` carries `unionMemberCapacity` at **+5 members/level** — 50 at
level 10 — and requires `skl_trd_trade` at 5. So union size is a trained capability of the
founder, and there is no other cap.

A union holds:

* **Leases.** A union lease is an ordinary facility lease held by the union, paid from union
  credits. This is the mechanism behind `industry_specification.md` §4.1: four berths on one
  forge world build a battleship in 10 turns instead of 39, and four berths is a union.
* **Warehouses.** Shared storage, with per-member withdrawal rights.
* **Stations.** A union may own an orbital station, paid from union credits; members run its
  slots under their own skills (`station_specification.md` §5).
* **Credits.** A single balance, funding rent and contracts.
* **Fleet operations.** Several members' fleets acting as one force in a single engagement
  (`conflict_specification.md` §4). This is how a 13-versus-17 action of the kind
  `Combat-logic/battle_log_veritas_vs_cinder.md` narrates happens at all, given that no
  player commands more than five hulls.

**Who runs it.** The founder administers: invites, expels, grants and revokes withdrawal
rights on union warehouses, and withdraws union credits. Any member deposits, and runs the
union's slots under their own skills. All of it is `union.action` (phase 13); the record is
`Data-Templates/union.interface`, whose `withdrawRights` names, per warehouse, the members who
may empty it.

Unions have no territory, no sovereignty and no standings of their own beyond the average of
their members'. They are an economic and military pooling device, which is all the brief's
*"Union (league of many player) Management"* asks for.

## 10. The generated catalogue

`tools/generate_market.py` writes `GamePlay/Market/`:

```
GamePlay/Market/
  economy_specification.md   this file; survives a run
  resource_prices.json       12 resources x 4 security tiers
  item_prices.json           1,031 weapons, modules and hulls; reference, bare-hull and fit split
  price_constants.json       RAW_PRICE, margins, indices, spreads, taxes, bounty and insurance rates
  index.json                 totals and the arbitrage proof table of §4
```

`tools/generate_npc.py` writes `GamePlay/NPC/` — squadron templates composed from real hull
ids, and the four contract archetypes with their reward formulas.

New keys in `fleet_and_weapons.json`: `marketPrices`, `contractArchetypes`. New `_meta`
field: `tradeableGoodCount` (1,043).

## 11. Invariants

`tools/verify_market.py`:

* **no free money** — for every good and every ordered pair of NPC-order tiers, and at
  every level of `skl_trd_trade`, `sellerIndex/buyerIndex ≤ (1 + halfSpread)/(1 − halfSpread)`;
  recomputed from the live index and skill catalogues, not asserted against 1.1739
* every one of the 1,043 goods has a reference price, strictly positive and finite
* prices rise strictly with resource tier within a lane, and `precision > ordnance > energy >
  structural` at every tier
* for every hull, `bareHullPrice = referencePrice − fittedPrice` is **strictly positive** —
  otherwise insurance would pay for a hull that costs nothing, which is checked across all 98
* processing is profitable but bounded: refining one unit returns between 1.00 and
  `1 + PROCESS_MARGIN` times its input value after `yieldModifier`, for every lane and every
  archetype
* the §7 tables list exactly `FAUCETS` and `DRAINS`, row for row, in both directions
* a same-system NPC round trip loses money at **every** level of `skl_trd_trade` —
  `(1 − halfSpread)/(1 + halfSpread) < 1` for margin 0.00 through 0.20
* market tax is monotonically decreasing as security falls, and zero in `deadspace`

`tools/verify_gameplay.py` and `tools/verify_npc.py`, contracts:

* every constant a reward formula names exists in `tools/gameplay_tables.py`, and `escort` is
  player-posted only
* haul collateral is at least every NPC bid and ask for the good, at every trade level —
  defaulting never beats delivering
* the escort quote is zero exactly where PvP is blocked
* the §8.3 tables recompute from the live hull, price and map catalogues; the representative
  haul's margin is positive at every tier (and so, the quote being a share of the premium,
  after paying an escort); its
  break-even loss rises strictly as security falls; own-account precision ore pays from every
  tier without NPC orders; and in `rim` and `deadspace` the escort quote covers a Destroyer
  T3's running cost at the hauler's pace
* freight covers the round-trip running cost of every tier of the largest-hold hull category
