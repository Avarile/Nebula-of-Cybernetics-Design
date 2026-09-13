/**
 * Reference/ — the TypeScript interface for the Nebula of Cybernetics fleet data.
 *
 * A description of data that already exists, not a proposal: every literal union
 * here was extracted from fleet_and_weapons.json and the generator tables in
 * tools/, and cross-checked against the `.interface` schemas in Data-Templates/.
 *
 *   common.ts     primitives and cross-cutting vocabularies
 *   resources.ts  4 lanes x 3 tiers, the refining chain, and the cost model
 *   weapons.ts    798 weapons: archetype x size x mark x family
 *   modules.ts    135 modules: archetype x mark, classed major/support/specific
 *   ships.ts      26 classes, 78 tier hulls, 20 named ships
 *   skills.ts     81 skills across 4 domains, 10 levels each
 *   systems.ts    60 systems, 180 planets, and the jump-gate graph
 *   combat.ts     round structure, hit and damage resolution, logging, open rulings
 *   gameplay.ts   the 24h turn, orders, the player, the fleet, progression, conflict
 *   economy.ts    reference prices, NPC and player orders, contracts, unions
 *   facilities.ts leasable industrial slots and the leases on them
 *   dataset.ts    on-disk shapes: the one-file dataset, indexes, fitted hulls
 *   constants.ts  the tuning tables behind all of the above
 *
 * Typical use:
 *
 *   import type { FleetDataset, Ship, Weapon } from './Reference';
 *   import { WEAPON_HIT_PROFILES, RANGE_BANDS } from './Reference/constants';
 *
 *   const fleet = JSON.parse(await readFile('fleet_and_weapons.json', 'utf8')) as FleetDataset;
 */

export * from './common';
export * from './resources';
export * from './weapons';
export * from './modules';
export * from './ships';
export * from './skills';
export * from './systems';
export * from './combat';
export * from './gameplay';
export * from './economy';
export * from './facilities';
export * from './dataset';

/**
 * Disambiguation. `systems.ts` is the canonical definer of the map vocabulary:
 * `gameplay.ts` redeclares `SystemId`/`PlanetId` as bare `string` and
 * `SecurityTier` identically, and `facilities.ts` redeclares `PlanetArchetype`
 * identically. Two `export *` sources declaring the same name is ambiguous
 * (TS2308), so name the winner explicitly. Safe in every case: the two
 * `SecurityTier`/`PlanetArchetype` declarations are the same type, and the
 * branded `sys_`/`pln_` ids are strict subtypes of the bare `string` aliases,
 * so every consumer expecting the looser type still type-checks.
 */
export type { SystemId, PlanetId, SecurityTier, PlanetArchetype } from './systems';
