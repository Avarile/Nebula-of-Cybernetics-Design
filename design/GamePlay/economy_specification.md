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

A hull's `buildCost` **already includes its fitted weapons and modules** — ships sum the
catalogues they fit from. So a reference price is the fitted value, never a sum to be added
to. The split matters for insurance and salvage (§6), and it is sharply tier-dependent:

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

## 5. The player market

Orders are per system, per good — a limit price, a quantity, a side. They match in phase 11
by price, then by the total order of `turn_specification.md` §4.

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

Insurance covers the **bare hull only** — `buildCost` minus the fitted weapons and modules —
and pays at the rate of the tier the hull died in, not the tier it was insured in.

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
| Insurance payouts | §6 | premiums paid in, minus the margin |

**Drains — credits destroyed**

| sink | rate | scales with |
|---|---|---|
| Facility rent | `industry_specification.md` §7 | capacity the playerbase holds — the largest and most continuous drain |
| Market tax | 2.0 / 1.5 / 0.5 / 0 % | trade volume in safe space |
| Insurance premiums | `0.004 × bare hull` per turn | hulls insured |
| NPC sell orders | `reference × index` | fuel, ammunition and starter goods bought rather than made |
| NPC markup on consumables | `× 1.25` on fuel and ammunition | fleets operating away from their own industry |

The structural property: **every faucet is tied to an action, every drain is tied to a
holding.** Credits enter when someone produces or fights and leave continuously from
everyone who holds capacity or hulls. A player who stops playing stops earning but keeps
paying, so idle wealth erodes and the supply cannot ratchet upward from accumulated
inactivity.

`verify_market.py` asserts the list is closed — every faucet named in any of the seven
documents appears in this table, and so does every drain.

## 8. Contracts

A contract is an offer to do work for credits, posted by an NPC or by a player, accepted in
phase 13. Four archetypes, each generated with parameters rather than authored individually:

| archetype | the job | reward derived from |
|---|---|---|
| `haul` | move N units of a good from system A to B | cargo reference value × distance in ly × the destination's risk index |
| `supply` | deliver N manufactured units to a facility | reference value × shortfall urgency |
| `bounty` | destroy N NPC hulls of a given tier in a given system | the squadron's reference value × the §7 bounty rate |
| `escort` | accompany a named fleet across a route without it being destroyed | route distance × the escorted cargo's value |

Player-posted contracts are collateralised: the poster's credits are held at posting and
released on completion or on expiry. There is no unsecured promise, so a contract cannot be
used to create credits from nothing.

`escort` exists because of the cargo table in `logistics_specification.md` §3 — six hull
categories can carry anything and none of them can fight. A contract that pays combat players
to protect industrial ones is the mechanism that connects the two careers without forcing
either to train the other's skills.

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
* **Credits.** A single balance, funding rent and contracts.
* **Fleet operations.** Several members' fleets acting as one force in a single engagement
  (`conflict_specification.md` §4). This is how a 13-versus-17 action of the kind
  `Combat-logic/battle_log_veritas_vs_cinder.md` narrates happens at all, given that no
  player commands more than five hulls.

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
* every faucet and drain named anywhere in `GamePlay/` appears in the §7 table
* a same-system NPC round trip loses money at **every** level of `skl_trd_trade` —
  `(1 − halfSpread)/(1 + halfSpread) < 1` for margin 0.00 through 0.20
* market tax is monotonically decreasing as security falls, and zero in `deadspace`
