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
 *   skills.ts     80 skills across 4 domains, 10 levels each
 *   combat.ts     turn structure, hit and damage resolution, logging, open rulings
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
export * from './combat';
export * from './dataset';
