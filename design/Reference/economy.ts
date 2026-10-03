/**
 * economy.ts — reference prices, NPC and player orders, contracts, unions.
 *
 * Derived from: GamePlay/economy_specification.md, tools/gameplay_tables.py,
 *               fleet_and_weapons.json -> "marketPrices" / "contractArchetypes",
 *               Data-Templates/{market,contract}.interface
 *
 * Prices are DERIVED. Only four raw anchors are authored; every other figure
 * divides out the `conversionYield` the resource catalogue publishes and multiplies
 * the `buildCost` the item catalogues already carry. A price therefore cannot drift
 * from the thing it prices.
 */

import type { ResourceId, ResourceLane, ShipId } from './common';
import type { ResourceTier } from './resources';
import type { ShipClass } from './ships';
import type { FleetId, LeaseId, PlayerId, UnionId } from './gameplay';
import type { NpcSquadronId, Standings } from './lore';
import type { StationId } from './stations';
import type { SecurityTier, SystemId } from './systems';

// ---------------------------------------------------------------- goods

/** Every priced thing: 12 resources + 798 weapons + 135 modules + 98 hulls = 1,043. */
export type GoodId = ResourceId | `wpn_${string}` | `mod_${string}` | ShipId;

export type GoodKind = 'resource' | 'weapon' | 'module' | 'hull';

/** `raw | refined | manufactured` — the axis `PRICE_INDEX` is keyed on. */
export type PriceTier = ResourceTier;

// ---------------------------------------------------------------- prices

export interface ResourcePriceEntry {
  resourceId: ResourceId;
  name: string;
  lane: ResourceLane;
  tier: ResourceTier;
  referencePrice: number;
  /** `referencePrice x PRICE_INDEX[tier][securityTier]`. */
  bySecurityTier: Record<SecurityTier, number>;
}

interface ItemPriceBase {
  goodId: GoodId;
  name: string;
  kind: Exclude<GoodKind, 'resource'>;
  referencePrice: number;
}

export interface WeaponPriceEntry extends ItemPriceBase {
  kind: 'weapon';
}

export interface ModulePriceEntry extends ItemPriceBase {
  kind: 'module';
}

/**
 * A hull's `buildCost` already includes its fitted weapons and modules, so
 * `referencePrice` IS the fitted value and is never a sum to be added to.
 *
 * `bareHullPrice = referencePrice - fitPrice` is what insurance pays on, and the
 * split is sharply tier-dependent: 84% fit on a motor torpedo boat, 10% on a
 * battleship. Insurance protects capital investment; salvage takes the fit.
 */
export interface HullPriceEntry extends ItemPriceBase {
  kind: 'hull';
  shipClass: ShipClass;
  bareHullPrice: number;
  fitPrice: number;
  fitShare: number;
  insurance: Record<SecurityTier, number>;
  premiumPerTurn: number;
  expectedSalvage: number;
}

/** Discriminated on `kind`. */
export type ItemPriceEntry = WeaponPriceEntry | ModulePriceEntry | HullPriceEntry;

export interface LanePrices {
  raw: number;
  refined: number;
  manufactured: number;
}

export interface PriceConstants {
  rawPrice: Record<ResourceLane, number>;
  processMargin: number;
  itemMargin: number;
  priceIndex: Record<SecurityTier, Record<PriceTier, number>>;
  npcSpread: number;
  /** Load-bearing: NPC orders past `mid` would create risk-free arbitrage. */
  npcOrderTiers: SecurityTier[];
  marketTax: Record<SecurityTier, number>;
  bountyRate: Record<SecurityTier, number>;
  riskIndex: Record<SecurityTier, number>;
  insurancePremium: number;
  insurancePayout: Record<SecurityTier, number>;
  salvageDrop: number;
  salvageCargo: number;
  wreckLifetime: number;
  lanePrices: Record<ResourceLane, LanePrices>;
}

export interface MarketPrices {
  resources: ResourcePriceEntry[];
  items: ItemPriceEntry[];
  constants: PriceConstants;
}

// ---------------------------------------------------------------- the spread

/**
 * `halfSpread = (NPC_SPREAD / 2) x (1 - tradePriceMargin)`, placed symmetrically
 * around the local index price. Symmetry is what makes `skl_trd_trade` safe:
 * narrowing the half-spread can never move it past the index, so a same-system
 * round trip loses at every skill level.
 */
export interface NpcQuote {
  goodId: GoodId;
  systemId: SystemId;
  securityTier: 'core' | 'mid';
  indexPrice: number;
  halfSpread: number;
  /** `indexPrice x (1 + halfSpread)`. */
  sellsAt: number;
  /** `indexPrice x (1 - halfSpread)`. */
  buysAt: number;
}

/**
 * One row of the no-free-money proof: a haul profits iff
 * `sellerIndex / buyerIndex > (1 + halfSpread) / (1 - halfSpread)`.
 */
export interface ArbitrageRow {
  scope: 'npc_order_tiers' | 'all_tiers';
  traderSkill: 'untrained' | 'trade_10';
  tradePriceMargin: number;
  halfSpread: number;
  threshold: number;
  worstIndexRatio: number;
  worstCase: string;
  safe: boolean;
  headroom: number;
}

// ---------------------------------------------------------------- orders

export type MarketSide = 'buy' | 'sell';

/**
 * [+] Where a fill is delivered to (a buy) or taken from (a sell): a warehouse lease the
 * poster holds in the order's system, or the poster's fleet there, not in transit, whose
 * holds load or unload it (`economy_specification.md` §5). A hull is never in a hold or a
 * warehouse: a hull is bought into, and sold from, the fleet only — an empty fleet may be named
 * in any system, and is then there.
 */
export type MarketLocation = { leaseId: LeaseId } | { fleetId: FleetId };

/** Per system. There is no global market. */
export interface MarketOrder {
  orderId: string;
  playerId: PlayerId | UnionId;
  systemId: SystemId;
  goodId: GoodId;
  side: MarketSide;
  quantity: number;
  limitPrice: number;
  postedTurn: number;
  expiresTurn: number | null;
  /** [+] Where the goods are delivered or taken from. */
  location: MarketLocation;
}

// ---------------------------------------------------------------- contracts

export type ContractArchetypeId = 'ctr_haul' | 'ctr_supply' | 'ctr_bounty' | 'ctr_escort';

/** Who may post an archetype. `ctr_escort` is player-only: the escorted party hires its escort. */
export type ContractPoster = 'npc' | 'player';

export interface ContractArchetype {
  contractId: ContractArchetypeId;
  name: string;
  job: string;
  /** Upper-case names are constants in `tools/gameplay_tables.py` (`HAUL_FREIGHT_RATE` ...). */
  rewardFormula: string;
  posters: ContractPoster[];
  riskIndex: Record<SecurityTier, number>;
}

export type ContractStatus = 'open' | 'accepted' | 'completed' | 'expired' | 'failed';

/**
 * Player-posted contracts are collateralised — the poster's credits are held at
 * posting — so a contract cannot create credits from nothing.
 */
export interface Contract {
  instanceId: string;
  contractId: ContractArchetypeId;
  postedBy: PlayerId | UnionId | 'npc';
  postedTurn: number;
  expiresTurn: number;
  acceptedBy: PlayerId | UnionId | null;
  /** [+] Typed per archetype. */
  parameters: ContractParameters;
  reward: number;
  /** Equals `reward` for player-posted, 0 for NPC-posted. */
  collateral: number;
  /**
   * Held from the ACCEPTOR. A haul: the cargo at the dearest NPC ask for it anywhere, so
   * keeping it never beats delivering it. An escort: `ESCORT_BOND x reward`, forfeited
   * to the poster only on desertion. 0 for the other archetypes.
   */
  acceptorCollateral: number;
  status: ContractStatus;
}

/**
 * `ctr_haul`. Reward = `(cargoTons x HAUL_FREIGHT_RATE + cargoReferenceValue x
 * HAUL_RISK_RATE x (routeRiskIndex - 1)) x routeDistanceLy`, priced at posting on the
 * shortest route; settlement pays `reward x delivered / quantity`.
 */
export interface HaulContractParameters {
  goodId: GoodId;
  quantity: number;
  fromSystemId: SystemId;
  toSystemId: SystemId;
  route: SystemId[];
  routeDistanceLy: number;
  /** `RISK_INDEX` of the least secure system on `route`, endpoints included. */
  routeRiskIndex: number;
  delivered: number;
}

/**
 * `ctr_escort`, posted by the escorted party. The escort links `escortFleetId` to
 * `escortedFleetId` as a follower (`logistics_specification.md` §8) and is paid
 * `reward x arrivedCargoValue / departedCargoValue` if the link holds to B.
 */
export interface EscortContractParameters {
  escortedFleetId: FleetId;
  escortFleetId: FleetId | null;
  fromSystemId: SystemId;
  toSystemId: SystemId;
  routeDistanceLy: number;
  routeRiskIndex: number;
  reservedFor: PlayerId | UnionId | null;
  departedCargoValue: number;
  arrivedCargoValue: number | null;
  /** The escort cancelled the link before B: its bond goes to the poster. */
  deserted: boolean;
}

/**
 * [+] `ctr_supply`: deliver `quantity` of a manufactured good into a named warehouse lease.
 * Reward `referenceValue x shortfallUrgency`; `shortfallUrgency` is set by the poster and has
 * no authored scale yet (`schema_coverage.md`, open).
 */
export interface SupplyContractParameters {
  goodId: GoodId;
  quantity: number;
  toLeaseId: LeaseId;
  shortfallUrgency: number;
  delivered: number;
}

/**
 * [+] `ctr_bounty`: destroy `hullsRequired` NPC hulls of `securityTier` in one system.
 * Reward `squadronReferenceValue x BOUNTY_RATE`.
 */
export interface BountyContractParameters {
  systemId: SystemId;
  securityTier: Exclude<SecurityTier, 'core'>;
  squadronId: NpcSquadronId | null;
  hullsRequired: number;
  hullsDestroyed: number;
}

/** [+] A contract's parameters, one shape per archetype. */
export type ContractParameters =
  | HaulContractParameters | EscortContractParameters
  | SupplyContractParameters | BountyContractParameters;

/** One row of `economy_specification.md` §8.3, per ly of route; recomputed by verify_gameplay.py. */
export interface HaulEconomicsRow {
  tier: SecurityTier;
  rewardPerLy: number;
  /** Fuel at the NPC ask plus insurance premium, out laden and back empty. */
  costPerLy: number;
  marginPerLy: number;
  /** `ESCORT_SHARE` of the risk premium. Zero where PvP is blocked. */
  escortPerLy: number;
  keepsPerLy: number;
  /** Collateral + fit + the bare hull insurance does not pay in this tier. */
  exposure: number;
  /** The chance per 100 ly of a total loss that leaves the haul at zero. */
  breakEvenLossPer100Ly: number;
}

// ---------------------------------------------------------------- unions

/**
 * The only shared-ownership structure in the game. Size is `unionMemberCapacity`
 * from `skl_trd_union_management` — +5 members/level, 50 at level 10.
 *
 * A union has no territory and no sovereignty. It is an economic and military
 * pooling device: four berths on one forge world build a battleship in 10 turns
 * instead of 39, and several members' fleets make one force in one engagement.
 */
export interface Union {
  unionId: UnionId;
  name: string;
  /** Administers the union: invites, expels, grants warehouse rights, withdraws credits. */
  founderId: PlayerId;
  /** At most the founder's `unionMemberCapacity`. */
  memberIds: PlayerId[];
  credits: number;
  leaseIds: LeaseId[];
  /** [+] Stations the union owns (`station_specification.md` §5). */
  stationIds: StationId[];
  /**
   * [+] Per-member withdrawal rights on union warehouses (`economy_specification.md` §9):
   * warehouse leaseId -> the members who may take from it. A warehouse not listed is open
   * to every member.
   */
  withdrawRights: Record<LeaseId, PlayerId[]>;
  /** Derived, never accrued: the mean of members' standings. */
  standings: Standings;
}

// ---------------------------------------------------------------- faucets/drains

/** `gameplay_specification.md` §6.5 — every faucet is paired with a drain. */
export interface CreditFlow {
  name: string;
  /** The constant in `tools/gameplay_tables.py` that sets the rate. */
  rateConstant: string;
  boundedBy: string;
}
