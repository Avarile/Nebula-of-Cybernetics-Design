# Schema Coverage — Mechanics against Schemas and Checks

Does every mechanic the design describes have the data it needs, and is that data held?
Written 2026-10-03.

One row per numbered section of the ten GamePlay documents (`gameplay_specification.md` §4)
and of `Combat-logic/combat_logic_specification.md`. The row list is the specs' headings, not
an authored list: `tools/verify_coverage.py` fails when a section has no row, when a row names
a section that is gone or renamed, when a cited schema or verifier does not exist, when a
quoted check label appears in none of the verifiers cited beside it, and when a schema in
`Data-Templates/` is cited by no row. `python3 tools/verify_coverage.py --missing` prints a stub
row for every section that lacks one.

## How to read a row

| column | holds |
|---|---|
| § | the section number |
| section | its heading, verbatim |
| schemas | what the mechanic reads or writes: a `.interface` in `Data-Templates/`, a type in `Reference/`, an UPPER_CASE table constant in `tools/`, or a key of `fleet_and_weapons.json` |
| checks | the verifiers that hold it, with the labels of the checks that matter quoted |
| status | **held** — the data exists and a verifier holds the section's numbers and claims · **typed** — runtime state, schema-pinned; the behaviour is an implementation obligation no static check can make · **prose** — explanation, setting or index; no data · **partial** / **gap** — something is missing, named by a G-number below |

Runtime records — players, fleets, unions, leases, warehouses, stations, orders, contracts,
engagements, wrecks, turn logs — have no generated instance to check. Each `.interface` is held
field for field to its `Reference/` type by `verify_reference.py`, which is what "typed" rests
on (`gameplay_specification.md` §5 lists the pairs).

### `gameplay_specification.md`

| § | section | schemas | checks | status |
|---|---|---|---|---|
| 1 | What the brief asks for | `skills` `systems` `stationTypes` | `verify_gameplay.py`: "exactly one skill carries fleet_slot unlocks" | held |
| 2 | The core loop | — | — | prose |
| 3 | Vocabulary | `Player` `Fleet` `Lease` `Union` `HullFit` `Station` | `verify_naming.py`: "no Reference type, member or literal says turn unless allowlisted" | held |
| 4 | The ten documents | — | `verify_gameplay.py`: "DOCS is exactly the document table" | held |
| 5 | Authored rules vs. runtime state | `player.interface` `fleet.interface` `union.interface` `warehouse.interface` `engagement.interface` `wreck.interface` `turn_log.interface` | `verify_reference.py`: "every runtime .interface shape has a TS twin"; `verify_naming.py`: "no current* field in a runtime schema" | held |
| 6 | Cross-cutting invariants | — | `verify_gameplay.py` | held |
| 6.1 | No dead skill | `STAT_RULES` `PENDING_RULINGS` | `verify_gameplay.py`: "every stat in stat_vocabulary has a rule", "names its stat (or parks it on an open ruling)" | held |
| 6.2 | No free money | `PRICE_INDEX` `NPC_SPREAD` `marketPrices` | `verify_gameplay.py`: "no profitable NPC loop at any trade level"; `verify_market.py`: "NO FREE MONEY"; `verify_fitting.py`: "buying a hull and selling it stripped never pays" | held |
| 6.3 | Refining stays lossy | `facilityTypes` `stationTypes` `STATION_YIELD_MODIFIER` | `verify_gameplay.py`: "GamePlay adds no fourth multiplier to yield"; `verify_facilities.py`; `verify_stations.py` | held |
| 6.4 | Every hull is reachable, and difficulty is monotonic | `progression` `HULL_TREE` | `verify_gameplay.py`: "the battleship is the most expensive hull to reach"; `verify_progression.py`: "published hull-path SP recomputes from the live graph" | held |
| 6.5 | Every faucet has a drain | `FAUCETS` `DRAINS` `turn_log.interface` | `verify_gameplay.py`: "every faucet names a rate constant that exists"; `verify_market.py`: "lists exactly the" | partial G4 |
| 6.6 | The fleet cap has exactly one source | `skills` `fleet.interface` | `verify_gameplay.py`: "no document asserts a numeric fleet cap in its own voice", "no generator or table defines a fleet-cap constant" | held |
| 6.7 | Resolution is deterministic | `PHASES` `CONTENDED` `ResolutionRank` | `verify_gameplay.py`: "the phase list is dense and ordered 1-14", "every contended resource names a tie-break" | held |
| 7 | Rulings inherited from `Combat-logic/` | `RETREAT_THRESHOLD` `OPEN_RULINGS` | `verify_combat.py`: "R1-R9 are marked ruled"; `verify_npc.py`: "retreat threshold is 0.30" | held |
| 8 | What GamePlay adds to the pipeline | `progression` `marketPrices` `facilityTypes` `stationTypes` `npcSquadrons` `contractArchetypes` | `verify_gameplay.py`: "fleet json carries"; `verify_coverage.py` | held |
| 9 | Out of scope | `SiteType` `STATION_SITE_TYPES` | `verify_stations.py` | held |

### `turn_specification.md`

| § | section | schemas | checks | status |
|---|---|---|---|---|
| 1 | The clock | `SP_PER_TURN` `TURN_LENGTH_HOURS` `TurnLengthHours` | `verify_gameplay.py`: "SP_PER_TURN is derived from the skill catalogue reference rate"; `verify_progression.py` | held |
| 2 | The fourteen phases | `PHASES` `TurnPhase` `PhaseName` | `verify_gameplay.py`: "every phase is either driven by an order type or is a system phase", "no system phase accepts an order" | held |
| 2.1 | The snapshot rule | `warehouse.interface` `ChainStep` | `verify_reference.py` | typed |
| 3 | Orders | `turn_order.interface` `ORDER_TYPES` `OrderPayloads` | `verify_gameplay.py`: "turn spec 3 order table lists exactly ORDER_TYPES", "turn_order.interface order list mirrors ORDER_TYPES"; `verify_reference.py`: "every order payload shape = its OrderPayloads type" | held |
| 3.1 | Standing orders | `turn_order.interface` `TurnOrder` | `verify_reference.py` | typed |
| 3.2 | Validation, twice | `turn_order.interface` `OrderRejection` `turn_log.interface` | `verify_reference.py` | typed |
| 4 | Simultaneity | `CONTENDED` `ResolutionRank` | `verify_gameplay.py`: "every contended resource is a real order type" | held |
| 5 | Determinism | `turn_log.interface` `BattleLog` | `verify_reference.py` | typed |
| 6 | The turn log | `turn_log.interface` `engagement.interface` `TurnLog` `LedgerEntry` | `verify_reference.py`: "every runtime .interface shape has a TS twin" | typed |
| 7 | Invariants | `ORDER_TYPES` `PHASES` | `verify_gameplay.py`; `verify_reference.py` | held |

### `progression_specification.md`

| § | section | schemas | checks | status |
|---|---|---|---|---|
| 1 | The rate | `SP_PER_TURN` `progression` | `verify_progression.py`: "published spPerTurn matches the constant" | held |
| 2 | The queue | `player.interface` `TrainQueuePayload` `TrainingQueueEntry` | `verify_reference.py` | typed |
| 3 | What gates what | `skill.interface` `skills` `SCIENCE_GATE` | `verify_progression.py`: "Formation Drill carries exactly four fleet_slot unlocks"; `verify_skills.py`; `verify_facilities.py`: "every chain stage gate matches skl_sta_science unlocks" | held |
| 4 | Why the specialist wins | `CAREERS` `progression` | `verify_progression.py` | held |
| 5 | Turn 1 — the new player | `STARTING_HULLS` `STARTING_SCIENCE_LEVEL` `STARTING_FREE_LEASE_TURNS` `STARTING_CREDIT_LEASE_TURNS` | `verify_progression.py`: "starting hulls all cost the same to fly", "no starter grant exceeds a level-5 gate" | partial G7 |
| 5.1 | The first thirty turns | — | — | prose |
| 6 | The generated catalogue | `progression` `TrainingRow` `HullPath` | `verify_progression.py`: "every generated file matches its fleet json entry" | held |
| 7 | Invariants | `progression` | `verify_progression.py` | held |

### `industry_specification.md`

| § | section | schemas | checks | status |
|---|---|---|---|---|
| 1 | The brief's constraint | `facility.interface` `station.interface` | `verify_facilities.py`; `verify_stations.py` | held |
| 2 | Slots | `planet.interface` `system.interface` `facilityTypes` `FacilityType` `REFINERY_SLOT_SIZE` `WAREHOUSE_SLOT_SIZE` | `verify_facilities.py`: "slotCount x slotThroughput reproduces the archetype capacity", "slot rows sum to the published capacity on all" | held |
| 2.1 | What the two ladders do to a slot | `facilityTypes` | `verify_facilities.py`: "developmentTier changes throughput and leaves slotCount fixed", "yieldModifier scales with neither ladder" | held |
| 3 | Access | `SCIENCE_GATE` `FACILITY_SKILL` | `verify_facilities.py`: "every chain stage gate matches skl_sta_science unlocks" | held |
| 4 | The chain | `facility.interface` `FacilityJobPayload` `ChainStep` | `verify_facilities.py`: "each of the five station_management stats is multiplied by exactly one stage" | held |
| 4.1 | Construction, and why unions exist | `facilityTypes` `union.interface` | `verify_facilities.py`: "a forge world at dev 3 fielding all berths matches Systems_Planets 7" | held |
| 5 | Warehouses | `warehouse.interface` `WarehouseContents` `WAREHOUSE_SLOT_SIZE` | `verify_reference.py`: "every runtime .interface shape has a TS twin" | typed |
| 6 | What leasing may never touch | `facilityTypes` | `verify_facilities.py`: "refining stays lossy under leasing" | held |
| 7 | Rent | `LEASE_RATE` `WAREHOUSE_RENT_PER_UNIT` `facility.interface` | `verify_facilities.py`: "rent rises strictly with development tier", "extraction rent is less than the slot gross output value" | held |
| 8 | Belt mining — the unlandlorded path | `MineAssignPayload` `BeltMiningRate` `AsteroidBelt` | `verify_systems.py` | gap G1 |
| 9 | The generated catalogue | `facilityTypes` | `verify_facilities.py`: "every planet archetype has a facility row" | held |
| 10 | Invariants | `facilityTypes` | `verify_facilities.py` | held |

### `logistics_specification.md`

| § | section | schemas | checks | status |
|---|---|---|---|---|
| 1 | Jump range | `JUMP_RANGE_BASE` `JUMP_SPEED_REFERENCE` `JumpBudget` `RUNNING_SILENT_SPEED_FACTOR` | `verify_gameplay.py`: "every hull has a positive jump range", "cuts a silent fleet" | held |
| 1.1 | Transit carries over | `fleet.interface` `Fleet` | `verify_reference.py` | typed |
| 1.2 | Splitting and merging fleets | `fleet.interface` `FleetOrganizePayload` | `verify_reference.py`: "every order payload shape = its OrderPayloads type" | typed |
| 2 | Fuel | `FUEL_MASS_DIVISOR` `FUEL_PER_POWER_CORE` `COMBAT_FUEL_BURN` `FuelProfile` | `verify_gameplay.py`: "fuel burn per ly rises strictly with hull mass", "every hull with a fuel tank has a finite fuel range" | held |
| 2.1 | Running dry | `fleet.interface` `FleetRestockPayload` | `verify_reference.py` | typed |
| 3 | Cargo | `fleet.interface` `CargoGoodId` `CargoTransferPayload` | `verify_gameplay.py`: "no warship category carries cargo", "at least one hull category can haul" | held |
| 4 | Refuelling and repair at sea | `fleet.interface` `FleetHull` `FleetRestockPayload` | `verify_gameplay.py`: "names its stat (or parks it on an open ruling)" | partial G2 |
| 5 | Interdiction | `FleetPosturePayload` `engagement.interface` | `verify_gameplay.py`: "every contended resource names a tie-break" | typed |
| 6 | Rearming | `ROUNDS_PER_ORDNANCE_CHARGE` `AMMO_DRAWING_CLASSES` `CRAFT_PROFILES` `FleetRestockPayload` `fleet.interface` | `verify_gameplay.py`: "exactly the finite-ammo weapon classes draw on the magazine", "restock cost as CRAFT_PROFILES has it" | partial G3 |
| 7 | What the energy lane is for | `FUEL_RESOURCE` `FUEL_PER_POWER_CORE` | `verify_gameplay.py`: "the fuel and ammo resources exist" | held |
| 8 | Convoys | `fleet.interface` `ConvoyOrderPayload` | `verify_gameplay.py`: "the representative haul" | held |
| 8.1 | The link | `ConvoyOrderPayload` `CONTENDED` | `verify_gameplay.py`: "every contended resource names a tie-break" | held |
| 8.2 | Pace, fuel and range | `JumpBudget` `fleet.interface` | `verify_gameplay.py`: "where no response fleet comes" | held |
| 8.3 | Who is caught | `engagement.interface` `EngagementSide` | `verify_reference.py` | typed |
| 9 | Invariants | `STAT_RULES` | `verify_gameplay.py` | held |

### `economy_specification.md`

| § | section | schemas | checks | status |
|---|---|---|---|---|
| 1 | The credit | `player.interface` `union.interface` | `verify_reference.py` | typed |
| 2 | Deriving prices | `resource.interface` `RAW_PRICE` `PROCESS_MARGIN` `ITEM_MARGIN` `marketPrices` | `verify_market.py`: "weapon prices recompute from buildCost", "hull total / bare / fit split recomputes" | held |
| 2.1 | What that produces | `marketPrices` | `verify_market.py`: "bareHullPrice > 0 for every hull" | held |
| 3 | Security and the price index | `PRICE_INDEX` | `verify_market.py`: "prices rise strictly with resource tier within a lane" | held |
| 4 | NPC orders — and why they stop at `mid` | `NPC_SPREAD` `NPC_ORDER_TIERS` `NpcQuote` | `verify_market.py`: "the core+mid restriction is load-bearing", "a same-system NPC round trip loses money" | held |
| 5 | The player market | `market.interface` `MarketOrder` `MarketLocation` `MARKET_TAX` | `verify_market.py`: "market tax decreases monotonically as security falls"; `verify_reference.py` | held |
| 6 | Insurance and salvage, priced | `INSURANCE_PREMIUM` `INSURANCE_PAYOUT` `SALVAGE_DROP` `fleet.interface` | `verify_market.py`: "insurance payout decreases with security" | held |
| 7 | Faucets and drains | `FAUCETS` `DRAINS` `turn_log.interface` | `verify_market.py`: "lists exactly the"; `verify_gameplay.py`: "every drain names a rate constant that exists" | partial G4 G5 |
| 8 | Contracts | `contract.interface` `contractArchetypes` `ContractParameters` | `verify_npc.py`: "every constant a reward formula names exists"; `verify_reference.py` | partial G4 G6 |
| 8.1 | Haul | `HAUL_FREIGHT_RATE` `HAUL_RISK_RATE` `HaulContractParameters` | `verify_gameplay.py`: "haul collateral is at least every NPC bid and ask" | held |
| 8.2 | Escort | `ESCORT_SHARE` `ESCORT_BOND` `EscortContractParameters` | `verify_gameplay.py`: "the escort quote is zero exactly where PvP is blocked"; `verify_npc.py`: "ctr_escort is player-posted only" | held |
| 8.3 | What a haul earns | `HAUL_FREIGHT_RATE` `RISK_INDEX` `HaulEconomicsRow` | `verify_gameplay.py`: "economy 8.3 tables and escort costs recompute from the live catalogues" | held |
| 9 | Unions | `union.interface` `Union` `UnionActionPayload` | `verify_reference.py`: "every runtime .interface shape has a TS twin" | typed |
| 10 | The generated catalogue | `marketPrices` `contractArchetypes` | `verify_market.py`: "every generated file matches its fleet json entry" | held |
| 11 | Invariants | `marketPrices` | `verify_market.py` | held |

### `conflict_specification.md`

| § | section | schemas | checks | status |
|---|---|---|---|---|
| 1 | What the map already decided | — | — | prose |
| 2 | PvP legality | `PVP_ALLOWED` `RESPONSE_FLEET` `RESPONSE_FLEET_ROUND` `AGGRESSOR_FLAG_TURNS` `MARKET_TAX` `INSURANCE_PAYOUT` | `verify_npc.py`: "core is the only tier where PvP is blocked", "every response fleet outvalues" | held |
| 3 | NPC threat | `npc_squadron.interface` `NPC_SQUADRONS` `BOUNTY_RATE` | `verify_npc.py`: "squadron value rises strictly as security falls", "every squadron carries the hostile faction" | partial G4 |
| 4 | How an engagement forms | `engagement.interface` `Engagement` `FleetPosture` | `verify_reference.py`: "every runtime .interface shape has a TS twin" | typed |
| 4.1 | Fleet operations | `engagement.interface` `EngagementSide` | `verify_reference.py` | typed |
| 4.2 | The round cap | `ROUND_CAP` | `verify_npc.py`: "the round cap exceeds the longest engagement" | held |
| 4.3 | Disruption and regrouping | `DISRUPTION_HULL_FRACTION` `REGROUP_BASE_CHANCE` | `verify_combat.py`: "constants.ts STAT_HOOK_CONSTANTS matches combat_tables.py" | held |
| 4.4 | Escorting | `FleetTargetPayload` `CraftWaveEvent` | `verify_combat.py`: "cover is one rule" | held |
| 5 | Destruction | `RETREAT_THRESHOLD` `fleet.interface` | `verify_npc.py`: "retreat threshold is 0.30" | held |
| 5.1 | Wrecks and salvage | `wreck.interface` `Wreck` `SALVAGE_DROP` `SALVAGE_CARGO` `WRECK_LIFETIME` | `verify_npc.py`: "salvage drops a fraction, never all, of the fit"; `verify_reference.py` | held |
| 5.2 | Insurance | `INSURANCE_PREMIUM` `INSURANCE_PAYOUT` `InsuranceSetPayload` | `verify_market.py`: "bareHullPrice > 0 for every hull" | held |
| 6 | Standings | `player.interface` `Standings` `REGION_AUTHORITY` `turn_log.interface` | `verify_lore.py`: "player.interface keys standings by authority factionId" | held |
| 7 | Facility raiding | `TROOPS_PER_WAREHOUSE_UNIT` `RAID_COOLDOWN` `RAID_TIERS` `FleetRaidPayload` `warehouse.interface` | `verify_npc.py`: "raid-capable hulls are exactly those with troopCapacity", "raiding is barred in core and mid" | held |
| 8 | The generated catalogue | `npcSquadrons` `contractArchetypes` | `verify_npc.py`: "squadrons.json matches the fleet json entry" | held |
| 9 | Invariants | `npcSquadrons` | `verify_npc.py`; `verify_gameplay.py` | held |

### `fitting_specification.md`

| § | section | schemas | checks | status |
|---|---|---|---|---|
| 1 | What changed | `fleet.interface` `HullFit` | `verify_fitting.py`: "every weapon is a legal fit on some tier hull" | held |
| 2 | The rules | `ship.interface` `weapon.interface` `module.interface` `HullFit` `MOUNT_FOR_CLASS` | `verify_fitting.py`: "tabulates exactly the rules tools/fitting.py applies", "default fit passes fit_is_valid" | held |
| 2.1 | What the rules leave out | — | `verify_fitting.py` | held |
| 3 | Parts are goods | `marketPrices` `warehouse.interface` `CargoGoodId` | `verify_fitting.py`: "every module is a legal fit on some tier hull" | held |
| 4 | The refit | `fleet.interface` `RefitJob` `RefitOrderPayload` | `verify_fitting.py` | held |
| 4.1 | Where | `RefitSite` `NPC_YARD_FEE` | `verify_fitting.py`: "every region with policed space has an NPC yard" | held |
| 4.2 | The order | `turn_order.interface` `RefitOrderPayload` | `verify_reference.py`: "every order payload shape = its OrderPayloads type" | held |
| 4.3 | How long, and what it costs | `REFIT_LABOUR_SHARE` `NPC_YARD_FEE` | `verify_fitting.py`: "refit table recomputes from the live catalogues" | held |
| 4.4 | While docked | `fleet.interface` `FleetOrganizePayload` `warehouse.interface` | `verify_reference.py` | typed |
| 5 | Value, insurance and salvage | `marketPrices` | `verify_fitting.py` | held |
| 5.1 | A hull is worth its hull plus its parts | `marketPrices` | `verify_fitting.py`: "a hull is worth its bare hull plus its parts" | held |
| 5.2 | No free money | `PRICE_INDEX` `NPC_SPREAD` | `verify_fitting.py`: "buying a hull and selling it stripped never pays" | held |
| 5.3 | Insurance covers the hull, salvage is the fit aboard | `wreck.interface` `FleetHull` | `verify_fitting.py`: "FleetHull carries its own fit and refit" | held |
| 6 | What the catalogue had to change | `ships` `modules` | `verify_fitting.py`: "no dead entry"; `verify_ships.py`: "tier hull slots carry the category module capacity as their size" | held |
| 7 | Invariants | `FITTING_CONSTANTS` | `verify_fitting.py` | held |

### `station_specification.md`

| § | section | schemas | checks | status |
|---|---|---|---|---|
| 1 | What the brief asks for | `station.interface` | `verify_stations.py` | held |
| 2 | What a station is | `station.interface` `Station` `ORBITS_PER_PLANET` | `verify_stations.py`: "a lease can name the station hosting it" | held |
| 2.1 | Capacity | `stationTypes` `STATION_BERTH_RATE` `STATION_BERTH_TONNAGE` | `verify_stations.py`: "stations supplement, never supplant", "the capital keel stays planetary" | held |
| 2.2 | What the skills do on a station | `STATION_YIELD_MODIFIER` | `verify_stations.py`: "every hosted kind is multiplied by a station-scope skill" | held |
| 3 | Building one | `STATION_FRAME_COST` `STATION_SLOT_COST` | `verify_stations.py` | held |
| 3.1 | The kit | `stationTypes` `CargoGoodId` | `verify_stations.py`: "a kit is its frame plus its slots" | held |
| 3.2 | Anchoring — the `station.deploy` order | `StationDeployPayload` `STATION_DEPLOY_FACILITY` `STATION_TIERS` | `verify_stations.py`: "read live, as 3.2 states", "station.deploy resolves in the phase facility.lease does" | held |
| 4 | Upkeep | `STATION_UPKEEP_RATE` `STATION_GRACE_TURNS` `station.interface` | `verify_stations.py`: "a station never undercuts the lease market" | held |
| 5 | Ownership | `station.interface` `player.interface` `union.interface` | `verify_reference.py` | typed |
| 6 | Where, and what can happen to it | `STATION_TIERS` `warehouse.interface` | `verify_stations.py`: "no station brings a yard to a tier where the map places no planet yard" | held |
| 7 | Deep-space stations — the hook | `STATION_SITE_TYPES` `SiteType` `StationSiteType` | `verify_stations.py` | held |
| 8 | The generated catalogue | `stationTypes` `StationTypeRow` | `verify_stations.py`: "station_types.json matches the fleet json" | held |
| 9 | Invariants | `stationTypes` | `verify_stations.py` | held |

### `lore_specification.md`

| § | section | schemas | checks | status |
|---|---|---|---|---|
| 1 | Rules for this document | — | `verify_lore.py` | held |
| 2 | The premise | — | — | prose |
| 2.1 | The Nebula and the Helm | — | — | prose |
| 2.2 | Governance is what `securityRating` measures | `systems` | `verify_systems.py`: "securityRating inside its band" | held |
| 2.3 | Why a space fleet looks like a navy | — | — | prose |
| 2.4 | Credits and leases | — | — | prose |
| 3 | History, briefly | — | — | prose |
| 4 | Factions | `FACTIONS` `Faction` | `verify_lore.py`: "every faction id is used" | held |
| 4.1 | The authorities and the Accord | `REGION_AUTHORITY` `RESPONSE_FLEET` | `verify_lore.py`: "each authority polices exactly one region" | held |
| 4.2 | The hostile factions | `SQUADRON_FACTION` `npc_squadron.interface` | `verify_lore.py`: "every squadron flies for a hostile faction"; `verify_npc.py`: "every squadron carries the hostile faction" | held |
| 5 | Regions | `REGION_AUTHORITY` | `verify_lore.py`: "a region has an authority exactly when it holds a policed system" | held |
| 5.1 | Standings follow the authority, not the region | `Standings` `player.interface` | `verify_lore.py`: "player.interface keys standings by authority factionId" | held |
| 6 | Manufacturers | `FAMILY_HOUSES` `FAMILY_ORIGINS` | `verify_lore.py`: "every stated strength is the family" | held |
| 7 | What the game consumes | `SQUADRON_FACTION` `REGION_AUTHORITY` | `verify_lore.py`: "SQUADRON_FACTION matches the table" | held |
| 8 | Out of scope | — | — | prose |

### `combat_logic_specification.md`

| § | section | schemas | checks | status |
|---|---|---|---|---|
| 1 | Combat Rollout | `ROUND_PHASES` `CombatPhase` | `verify_combat.py` | held |
| 1.1 | The canonical round structure | `ROUND_PHASES` `CombatantState` | `verify_combat.py`: "constants.ts STAT_HOOK_CONSTANTS matches combat_tables.py" | held |
| 1.2 | Resolution granularity scales with fleet size | `GRANULARITY_HULLS_PER_SIDE` `GRANULARITY_POLICY` | `verify_combat.py`: "hulls a side separates the logs" | held |
| 1.3 | Effective stats — how skills and modules reach combat | `STAT_KIND` `ADDITIVE_CAPS` `EFFECTIVE_STAT_RULES` | `verify_combat.py`: "spec 1.3 worked example recomputes from the live catalogue", "every flat module value on an additive stat is in that stat" | held |
| 1.4 | Movement — the engagement line | `ROUND_TIME` `MOVEMENT_INTENTS` `MovementResolution` | `verify_combat.py`: "every logged range progression is reachable", "each logged opening distance lies between the two first-lock ranges" | held |
| 2 | Hit Rate Calculation | `weapon.interface` `ship.interface` `HitChanceResolution` | `verify_combat.py` | held |
| 2.1 | Reconciled master formula | `GUNNERY_SKILL_DIVISOR` `COMPONENT_ACCURACY_CRITICALS` | `verify_combat.py`: "the v2 hit formula carries the gunnery term", "the v2 worked example recomputes from the catalogue" | held |
| 2.2 | Range bands | `RANGE_BANDS` `RangeBand` | `verify_combat.py`: "the v2 worked example recomputes from the catalogue" | held |
| 2.3 | Detection, signature, and lock-on | `DETECTION_SIGNATURE_REFERENCE` `LOCK_CLAIMS` `DETECTION_CONSTANTS` | `verify_combat.py`: "every lock claim in the logs and worked example holds" | held |
| 2.4 | Speed-based evasion | `TRACKING_SPEED_FACTOR` `SPEED_EVASION_DIVISOR` `EVASION_CONSTANTS` | `verify_combat.py`: "speed-evasion differentiates", "the spec 2.4 sample table recomputes from the catalogue" | held |
| 2.5 | Missiles and point-defense | `POOL_EFFECTS` `PROJECTILE_EVASION_BASE` `InterceptionAttempt` `FireEvent` | `verify_combat.py`: "no effect makes a projectile easier to intercept", "the interception step states the table" | held |
| 2.6 | Strike craft | `CRAFT_PROFILES` `SQUADRON_SIZE` `fleet.interface` `CraftWaveEvent` `CraftAttackEvent` | `verify_combat.py`: "every logged strike recomputes from the catalogue"; `verify_reference.py`: "every runtime .interface shape has a TS twin" | held |
| 3 | Damage Calculation | `DamageResolution` | `verify_combat.py` | held |
| 3.1 | Raw damage | `DamageResolution` | `verify_gameplay.py`: "names its stat (or parks it on an open ruling)" | held |
| 3.2 | Shields | `ShieldRechargeResolution` `fleet.interface` | `verify_gameplay.py`: "names its stat (or parks it on an open ruling)" | held |
| 3.3 | Armor and hull | `DamageResolution` | `verify_combat.py`: "caps apply only to additive stats" | held |
| 3.4 | Special effects | `SPECIAL_EFFECT_RULES` `MINE_BASE` `MineDeployment` | `verify_combat.py`: "every (effect, context) pair in the catalogue is ruled or declared inert", "spec 3.4 names every ruled effect" | held |
| 3.5 | Component targeting | `COMPONENT_TARGETING_PENALTY` `ComponentName` | `verify_combat.py`: "the v2 hit formula carries the gunnery term and the component penalty" | held |
| 3.6 | Critical rolls | `CRITICAL_TABLE` `ENGINEERING_SKILL_DIVISOR` `LIFE_SUPPORT_CASUALTY_RATE` `fleet.interface` | `verify_combat.py`: "each component accuracy factor matches its criticalEffect text" | held |
| 3.7 | Destruction and retreat | `RETREAT_THRESHOLD` `RETREAT_POLICY` `ROUND_CAP` | `verify_combat.py`: "spec 3.7 states the ruled retreat threshold" | held |
| 4 | Logging: Making Combat Exciting | `engagement.interface` `BattleLog` | `verify_reference.py` | typed |
| 4.1 | Tier 1 — Structured event log (ground truth) | `engagement.interface` `FireEvent` `StateEvent` `CraftWaveEvent` `CraftAttackEvent` `CombatantRef` | `verify_reference.py`: "every runtime .interface shape has a TS twin" | typed |
| 4.2 | Tier 2 — Narrative broadcast log (the exciting one) | `NarrativeLog` `SIGNIFICANCE_RULES` `CHATTER_TRIGGERS` | — | typed |
| 5 | Rulings and Open Gaps | `OPEN_RULINGS` | `verify_combat.py`: "R1-R9 are marked ruled in combat.ts OPEN_RULINGS" | held |
| 5.1 | Ruled | `OPEN_RULINGS` `PENDING_RULINGS` | `verify_combat.py`: "every open ruling in combat.ts is listed in spec 5.2" | held |
| 5.2 | Open | `PENDING_RULINGS` | `verify_gameplay.py`: "names its stat (or parks it on an open ruling)" | held |

## Gaps

What a mechanic needs and the design does not yet supply. Each is cited by the rows it
touches; `verify_coverage.py` fails on a gap no row cites, or a row citing one not listed here.

**G1. Belt mining has no mining equipment.** `mine.assign`, `BeltMiningRate` and the four
mining skills exist, and industry §8 says output goes to "hulls carrying mining equipment" —
but no module or hull in the catalogue carries any, and the two mining-equipment capability
unlocks gate nothing (fitting §2.1 says so too). Needs a mining module line in
`tools/generate_modules.py` with a `hullAffinity`, and the rule that a hull mines only with one
fitted. Until then `miningYield` and `miningCycleSpeed` multiply a base nothing can reach.

**G2. Repair at a dock, and replacing crew.** `FleetHull` now carries hull, component and crew
damage between battles, but only a tender's `repairRatePerTurn` restores anything, and only hull
HP. Logistics §4's "repairs only at a facility it or its union leases" has no slot kind, rate
or cost; a catastrophic critical's "destroyed until dock repair" has no dock rule; crew lost
past `medicalCapacity` has no way back. Needs: which lease repairs (a berth is the natural
site, like a refit), at what rate in manufactured units, and a crew replacement cost.

**G3. Ammunition has two models.** Combat counts rounds per mount from `weapon.ammo`
(`CombatantState.ammoRemaining`, `MissileVolley`); logistics §6 and `FleetHull.ammo` count one
hull magazine, `capacities.ammo`. Which one a battle draws, and how the magazine reloads a mount
between rounds and between battles, is not ruled. Recommended: a mount starts each engagement
with `min(weapon.ammo, what the magazine still holds)` and every round fired is drawn from the
magazine; a combat-and-logistics ruling, so it stays open here.

**G4. NPC volumes have no rate.** How many NPC contracts are posted, and how many squadrons
spawn, per system per turn, is unset. Both are faucets (bounties, contract and haul rewards),
so the faucet side of gameplay §6.5 is bounded in kind but not in volume, and no steady-state
ratio can be computed. Needs `NPC_CONTRACT_RATE` and `NPC_SPAWN_RATE`-style tables keyed by
security tier.

**G5. The consumable markup is not a constant.** Economy §7's `× 1.25` on fuel and ammunition
is prose; its `DRAINS` entry names `FUEL_PER_POWER_CORE` as its rate, and economy §8.3 prices a
hauler's fuel at the plain NPC ask without it. Making it a constant and applying it moves every
§8.3 figure, so it is an economy decision, not a schema fix.

**G6. `ctr_supply` has no scale.** Its reward is `referenceValue × shortfallUrgency`, and
`shortfallUrgency` is neither a constant nor derived. `SupplyContractParameters` now carries it
as the poster's number; an NPC-posted supply contract has nothing to set it from.

**G7. The new player's seed credits are not a number.** Progression §5 grants "enough for ~20
turns of one refinery lease plus fuel" and `STARTING_CREDIT_LEASE_TURNS` = 20 exists, but no
generator turns it into credits — which planet's lease, at which development tier, and how much
fuel are not stated — and `progression.constants.startingPackage` publishes no credit figure.

## Follow-ups resolved by this audit

Items routed here by the earlier tasks, and what became of each.

| item | resolution |
|---|---|
| `npc_squadron.interface`, `generate_npc.py`, `squadrons.json` lack `factionId`; `NpcSquadron.squadronId` untyped | `factionId` generated from `lore_tables.SQUADRON_FACTION`; `NpcSquadron` typed with `NpcSquadronId` and `HostileFactionId`; `verify_npc.py` and `verify_reference.py` check both |
| response fleets have no owner | by design: the authority of the engagement's region; recorded on `engagement.interface` `side.responseFleet.authorityId` |
| conflict §2 prose said rim insurance stops paying and tax is zero | already corrected by the stations task: rim pays 0.50 and taxes 0.5 % |
| turn spec phase 13 does not name whose standing moves | phase 13 now says: the authority of the region the act happened in (turn §2, `PHASES`) |
| v2 JSON worked example not catalogue-backed | rewritten on *Leviathan Crown*'s own weapons and the catalogue *Whisperfang*; `verify_combat.py` recomputes every shot. Its old conclusion (capital gun at the 0.05 floor) does not survive: 0.31, 0.73 and 0.95 |
| runtime hangar inventory between engagements | `FleetHull.craftAboard`, per kind; the in-battle readying queue is not stored, because every craft aboard starts an engagement stowed |
| airborne squadrons, cover assignments, `MineDeployment.layerGone` | battle state only: every field expires and every airborne craft is recovered or lost when the battle ends (R7), so none needs a record; they stay on `CombatantState` |
| Tier-1 log has no craft event | `CraftWaveEvent` and `CraftAttackEvent` in `combat.ts`, in `engagement.interface`, each storing its rolls |
| craft restock order in phase 12 | `fleet.restock` (phase 12, standing): ammunition, fuel and craft from a warehouse, the fleet's holds or NPC sell orders |
| logistics §6 should name craft restock | done, with `CRAFT_PROFILES` costs checked by `verify_gameplay.py` |
| conflict §5.1: craft aboard are not salvage | stated; parts in a hold are also rolled whole |
| no `fleet.interface`; `FleetHull` lacks craft | `fleet.interface` with four shapes, held to `Fleet`, `FleetHull`, `HullFit`, `RefitJob` |
| `verify_market.py` faucet/drain closure claimed but absent | implemented (both directions, row for row); the claim in economy §7 and §11 now says exactly what is checked |
| `Reference/index.ts` SystemId/PlanetId dedupe | done: `gameplay.ts`, `economy.ts`, `facilities.ts` and `stations.ts` import the map vocabulary from `systems.ts`; the disambiguation block is gone |
| parts as hold cargo untyped | `CargoGoodId` admits weapons and modules; a part weighs its `buildCost` units (logistics §3) |
| `Lease.currentJob` uses a `current*` name | renamed `job`; `verify_naming.py` now fails on any `current*` field in a runtime schema |
| where a market buy is delivered | every order names a location: a warehouse lease or a fleet in the system (economy §5, `MarketLocation`) |
| no fleet split or merge; a refit holds the whole fleet | `fleet.organize` (phase 7, before convoys and movement); a player may hold several fleets, and Formation Drill bounds the hulls across them |
| silent posture: does −30 % speed cut strategic range? | yes: `RUNNING_SILENT_SPEED_FACTOR` (0.70) on `lyPerTurn` while posture is silent (logistics §1), checked |
| `turn_order.interface` order list not verified | already verified by `verify_gameplay.py`; now every payload shape is too |
| named ships priced as goods but unobtainable | a valuation only: no NPC order lists them (economy §4, fitting §6) |
| mine fields owned by a disengaged ship | ruled by R7: no field outlives the battle |
| constants.ts and combat.ts initiative docs stale | already corrected (R8 wording in both) |
| README check counts stale | already corrected; recounted for this task |
| raiding had no order | `fleet.raid` (phase 9), contended by rank, `RAID_COOLDOWN` on `warehouse.interface` `lastRaidedTurn` |
| `GRANULARITY_POLICY` lived only in `constants.ts` | `GRANULARITY_HULLS_PER_SIDE` in `tools/combat_tables.py`, recomputed against both logs' rosters |
| combatants named by catalogue `ShipId` (two Corvette T1s collide) | `CombatantRef` in every combatant field of `combat.ts`; the engagement maps each ref to its ship, hull and fleet |

## Known open design questions

Raised by the earlier tasks as notes or balance questions; not schema work, and not decided
here. Listed so they are not lost.

**Q1. Mine splash at the opening.** Every ship of a side starts on one point (combat §1.4), so
an `area_denial` field nearly always catches two hulls early. A starting spread may be wanted.

**Q2. Afterburner has no power cost, and nothing reads the "engines" share of power
allocation** (combat §1.1 phase 4, §1.4). Either the allocation phase drops engines, or the
afterburner draws power.

**Q3. Interception saturates against missiles.** Every pool weapon's raw intercept chance is
above 1.3, so the 0.20 projectile evasion never matters and missiles are intercepted at the
0.95 cap (combat §2.5). Craft were recalibrated to 1.10 for this reason; missiles were not.

**Q4. NPC contract posting and squadron spawn rates** (G4) — the volume of three faucets.

**Q5. Deadspace is far from any market.** The median deadspace system is 311 ly from an NPC
market (about 42 turns laden for an Attack Transport), so structural ore from deadspace loses
money (economy §8.3). Map geometry or the precision-only intent may want a look.

**Q6. Station transfer and orbit markets.** A station cannot be sold, given or captured
(station §5); a market in orbits is a market in map capacity and was left for a later pass.

**Q7. The consumable markup** (G5) — whether fuel and ammunition carry `× 1.25`, and where.

**Q8. The ammunition model** (G3) — per mount, per magazine, or both.
