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
import type { PlayerId, SecurityTier, SystemId, UnionId } from './gameplay';

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
}

// ---------------------------------------------------------------- contracts

export type ContractArchetypeId = 'ctr_haul' | 'ctr_supply' | 'ctr_bounty' | 'ctr_escort';

export interface ContractArchetype {
  contractId: ContractArchetypeId;
  name: string;
  job: string;
  rewardFormula: string;
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
  parameters: Record<string, unknown>;
  reward: number;
  /** Equals `reward` for player-posted, 0 for NPC-posted. */
  collateral: number;
  status: ContractStatus;
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
  founderId: PlayerId;
  memberIds: PlayerId[];
  credits: number;
  leaseIds: string[];
  /** The mean of members' standings; unions accrue none of their own. */
  standings: Record<string, number>;
}

// ---------------------------------------------------------------- faucets/drains

/** `gameplay_specification.md` §6.5 — every faucet is paired with a drain. */
export interface CreditFlow {
  name: string;
  /** The constant in `tools/gameplay_tables.py` that sets the rate. */
  rateConstant: string;
  boundedBy: string;
}
