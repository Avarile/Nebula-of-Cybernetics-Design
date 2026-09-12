/**
 * dataset.ts — the on-disk shapes: the one-file dataset, the index files, and
 * the fitted-ship directory.
 *
 * Derived from: fleet_and_weapons.json, Ships/index.json, Weapons/index.json,
 *               Modules/index.json, Resources/index.json, README.md
 *
 * Everything under Ships/, Weapons/, Modules/ and Resources/ is GENERATED, with
 * no RNG: every value is a pure function of a table in tools/, so re-running the
 * pipeline reproduces the whole tree byte-for-byte. These types describe the
 * output, not a hand-maintained source.
 */

import type { CataloguePath, ModuleSlotType, ShipId, ShipTier, Size } from './common';
import type { ShipBase, ShipClass, ShipTemplate, NamedShip } from './ships';
import type { Weapon, WeaponClass, WeaponFamily, WeaponIndexEntry, FittedWeapon } from './weapons';
import type { Module, ModuleFunctionClass, ModuleIndexEntry, FittedModule } from './modules';
import type { Resource, ResourceIndexEntry, ResourceLane } from './resources';

// ---------------------------------------------------------------- fleet_and_weapons.json

export interface FleetMeta {
  title: string;
  version: string;
  shipCategories: ShipClass[];
  shipCount: number;
  weaponCount: number;
  weaponSizeBreakdown: Record<Size, number>;
  weaponArchetypes: number;
  weaponFamilies: WeaponFamily[];
  moduleCount: number;
  moduleArchetypes: number;
  moduleSlotTypes: ModuleSlotType[];
  namedShipCount: number;
  resourceCount: number;
  resourceLanes: ResourceLane[];
}

/**
 * The whole dataset in one file. Load order matters when regenerating: weapons
 * and modules before ships, because a ship's `buildCost` sums the `buildCost`
 * those catalogues carry.
 */
export interface FleetDataset {
  _meta: FleetMeta;
  modules: Module[];
  weapons: Weapon[];
  /** The 78 tier hulls (class templates). */
  ships: ShipTemplate[];
  /** The 20 named ships; each carries `templateId` naming its class hull. */
  namedShips: NamedShip[];
  resources: Resource[];
}

// ---------------------------------------------------------------- Ships/index.json

interface ShipIndexEntryBase {
  shipId: ShipId;
  name: string;
  shipClass: ShipClass;
  tier: ShipTier;
  /** `mass.value`, flattened. */
  mass: number;
  /** `hull.maxHP`, flattened. */
  hullHP: number;
  /** Mount count, not fitted count. */
  hardpoints: number;
  moduleSlots: number;
  /** `Ships/<Category folder>/<tier-N | Named ship>`. */
  dir: string;
  /** `<dir>/ship.json`. */
  path: CataloguePath;
  weaponsFitted: number;
  modulesFitted: number;
}

export interface ShipTemplateIndexEntry extends ShipIndexEntryBase {
  kind: 'template';
}

export interface NamedShipIndexEntry extends ShipIndexEntryBase {
  kind: 'named';
  templateId: ShipId;
}

/** Discriminated on `kind`; 98 rows = 78 templates + 20 named ships. */
export type ShipIndexEntry = ShipTemplateIndexEntry | NamedShipIndexEntry;

export interface ShipIndex {
  count: number;
  ships: ShipIndexEntry[];
}

// ---------------------------------------------------------------- fitted hull directory

/**
 * A hull as it exists on disk: `ship.json` plus one file per filled mount and
 * slot. A fitting file is the full catalogue entry with the mount it occupies
 * added and a `catalogue` pointer back to the canonical copy — stripping the
 * added fields must leave a byte-identical catalogue entry.
 *
 *   Ships/Destroyer/tier-2/
 *     ship.json
 *     Weapons/hp_1_wpn_776_draconis_torpedo_launcher_mk_2.json
 *     Weapons/hp_2_wpn_776_draconis_torpedo_launcher_mk_2.json   <- keyed by mount,
 *     Modules/ms_1_mod_ion_drive_hp.json                            so a repeat fit
 *     ...                                                           gets two files
 */
export interface FittedShip {
  /** Contents of `ship.json`. */
  ship: ShipBase;
  /** Directory this hull lives in, relative to the repo root. */
  dir: string;
  /** One per filled hardpoint, keyed by `hardpointId` in the filename. */
  weapons: FittedWeapon[];
  /** One per filled module slot, keyed by `slotId` in the filename. */
  modules: FittedModule[];
}

// ---------------------------------------------------------------- path shapes

/** `Weapons/<weaponClass>/<size>/<weaponId>_<slug>.json`. */
export type WeaponPath = `Weapons/${WeaponClass}/${Size}/${string}.json`;

/** `Modules/<slotType>/<functionClass>/<moduleId>.json`. */
export type ModulePath = `Modules/${ModuleSlotType}/${ModuleFunctionClass}/${string}.json`;

/** `Resources/<raw|refined|manufactured>/<resourceId>.json`. */
export type ResourcePath = `Resources/${'raw' | 'refined' | 'manufactured'}/${string}.json`;

/**
 * `Ships/<Category folder>/<tier-1|tier-2|tier-3|Named ship>/ship.json`.
 * Category folders are prose, not enum values — two differ because `/` cannot
 * appear in a directory name (`Sloop - patrol escort`, `Minelayer - sweeper`).
 */
export type ShipPath = `Ships/${string}/${string}/ship.json`;

// ---------------------------------------------------------------- re-exports

export type { WeaponIndexEntry, ModuleIndexEntry, ResourceIndexEntry };
export type { WeaponIndex } from './weapons';
export type { ModuleIndex } from './modules';
export type { ResourceIndex } from './resources';

/** Every index file in the repo, keyed by the catalogue it indexes. */
export interface CatalogueIndexes {
  ships: ShipIndex;
  weapons: import('./weapons').WeaponIndex;
  modules: import('./modules').ModuleIndex;
  resources: import('./resources').ResourceIndex;
}
