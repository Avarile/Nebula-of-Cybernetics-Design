/**
 * lore.ts — factions, who polices which region, which faction each NPC squadron
 * flies for, and where each weapon manufacturer is from.
 *
 * Derived from: tools/lore_tables.py (source of truth),
 *               GamePlay/lore_specification.md (the explanation).
 * Checked by:   tools/verify_lore.py — every value below is compared with the
 *               table, and the table with the live catalogue.
 *
 * Nothing here is a number and no mechanic reads a value from it that changes an
 * outcome. Which tiers are policed is `RESPONSE_FLEET`'s keys; where a squadron
 * spawns is its security tier; a manufacturer's bias is `FAMILY_BIAS`. This file
 * names who does those things.
 *
 * One one-line entry per key: verify_lore.py reads this file with a line regex.
 */

import type { RegionName } from './systems';
import type { WeaponFamily, WeaponFamilyBias } from './weapons';

// ---------------------------------------------------------------- factions

/** Polices the `core` and `mid` systems of exactly one region. */
export type AuthorityFactionId =
  | 'fac_aurelian_admiralty'
  | 'fac_kestrel_charter'
  | 'fac_cindral_syndics'
  | 'fac_tannhau_pilotage';

/** Owns one or more NPC squadron templates. */
export type HostileFactionId =
  | 'fac_free_corsairs'
  | 'fac_lettered_captains'
  | 'fac_gravewatch_warbands'
  | 'fac_revenant_line';

export type FactionId = AuthorityFactionId | HostileFactionId;

export type FactionKind = 'authority' | 'hostile';

export interface Faction {
  name: string;
  kind: FactionKind;
  /**
   * For an authority, the one region it polices. For a hostile faction, where the
   * story puts it — spawning stays by security tier and is not restricted to it.
   */
  homeRegion: RegionName;
}

export const FACTIONS = {
  fac_aurelian_admiralty: { name: 'The Aurelian Admiralty', kind: 'authority', homeRegion: 'Aurelian Reach' },
  fac_kestrel_charter: { name: 'The Kestrel Charter Company', kind: 'authority', homeRegion: 'Kestrel Span' },
  fac_cindral_syndics: { name: 'The Foundry Syndics of Cindral', kind: 'authority', homeRegion: 'Cindral Verge' },
  fac_tannhau_pilotage: { name: 'The Tannhau Pilotage', kind: 'authority', homeRegion: 'Tannhau Drift' },
  fac_free_corsairs: { name: 'The Free Corsairs', kind: 'hostile', homeRegion: 'Tannhau Drift' },
  fac_lettered_captains: { name: 'The Lettered Captains', kind: 'hostile', homeRegion: 'Cindral Verge' },
  fac_gravewatch_warbands: { name: 'The Gravewatch Warbands', kind: 'hostile', homeRegion: 'Obsidian Marches' },
  fac_revenant_line: { name: 'The Revenant Line', kind: 'hostile', homeRegion: 'The Pale Hollow' },
} as const satisfies Record<FactionId, Faction>;

// ---------------------------------------------------------------- regions

/**
 * The authority that polices a region's `core` and `mid` systems, or `null` where
 * the region has none. A region has an authority exactly when it holds a policed
 * system; `rim` and `deadspace` systems inside a policed region are claimed on
 * paper only and get no response fleet.
 */
export const REGION_AUTHORITY: Readonly<Record<RegionName, AuthorityFactionId | null>> = {
  'Aurelian Reach': 'fac_aurelian_admiralty',
  'Kestrel Span': 'fac_kestrel_charter',
  'Cindral Verge': 'fac_cindral_syndics',
  'Tannhau Drift': 'fac_tannhau_pilotage',
  'Obsidian Marches': null,
  'The Pale Hollow': null,
};

/**
 * A player's (and a union's) standings: one number per authority, keyed by its
 * faction id — not by region name. Each authority polices exactly one region, so
 * this is the old region-keyed rule under a stable id; the two unpoliced regions
 * have no key because their standing never had an effect.
 * `conflict_specification.md` §6, `Data-Templates/player.interface`.
 */
export type Standings = Partial<Record<AuthorityFactionId, number>>;

// ---------------------------------------------------------------- NPC squadrons

/** The squadron templates in `tools/gameplay_tables.py` `NPC_SQUADRONS`. */
export type NpcSquadronId =
  | 'npc_mid_pirate_raiders'
  | 'npc_rim_pirate_wing'
  | 'npc_rim_raider_pack'
  | 'npc_dead_warband'
  | 'npc_dead_capital_threat';

export const SQUADRON_FACTION: Readonly<Record<NpcSquadronId, HostileFactionId>> = {
  npc_mid_pirate_raiders: 'fac_free_corsairs',
  npc_rim_pirate_wing: 'fac_free_corsairs',
  npc_rim_raider_pack: 'fac_lettered_captains',
  npc_dead_warband: 'fac_gravewatch_warbands',
  npc_dead_capital_threat: 'fac_revenant_line',
};

// ---------------------------------------------------------------- manufacturers

/** A `WeaponFamilyBias` key, or Ashwright's early second effect. */
export type FamilyAxis = keyof WeaponFamilyBias | 'early_effect';

export interface FamilyOrigin {
  /** The maker's full name, for display. */
  house: string;
  /** The system its works stand in. */
  homeSystem: string;
  homeSystemId: string;
  /** The authority of the home system's region; `null` where nobody polices it. */
  originFaction: AuthorityFactionId | null;
  /** Axes on which this family is the unique best of all ten. */
  strength: readonly FamilyAxis[];
  /** Every axis on which it is worse than Vanguard — exactly that set. */
  pays: readonly (keyof WeaponFamilyBias)[];
}

export const FAMILY_ORIGINS: Readonly<Record<WeaponFamily, FamilyOrigin>> = {
  Vanguard: { house: 'Cantoris Arsenal (Vanguard Pattern)', homeSystem: 'Cantoris', homeSystemId: 'sys_002', originFaction: 'fac_aurelian_admiralty', strength: [], pays: [] },
  Meridian: { house: 'Meridian Instrument Works', homeSystem: 'Meridian Gate', homeSystemId: 'sys_008', originFaction: 'fac_aurelian_admiralty', strength: ['var'], pays: ['dmg', 'crit'] },
  Kestrel: { house: 'Kestrel Arms of the Charter', homeSystem: 'Kestrel', homeSystemId: 'sys_011', originFaction: 'fac_kestrel_charter', strength: ['rof'], pays: ['dmg', 'rng', 'pwr', 'crit'] },
  Solari: { house: 'Solari Lightworks', homeSystem: 'Farhaven', homeSystemId: 'sys_012', originFaction: 'fac_kestrel_charter', strength: ['pwr'], pays: ['dmg', 'crit'] },
  Draconis: { house: 'Draconis Heavy Foundry', homeSystem: 'Cindral', homeSystemId: 'sys_021', originFaction: 'fac_cindral_syndics', strength: ['dmg'], pays: ['trk', 'hit', 'pwr', 'var', 'ammo'] },
  Ashwright: { house: 'Ashwright & Daughters', homeSystem: 'Ashfall', homeSystemId: 'sys_022', originFaction: 'fac_cindral_syndics', strength: ['early_effect'], pays: ['dmg', 'pwr'] },
  Voss: { house: 'Voss Fortress Ordnance', homeSystem: 'Tannhau', homeSystemId: 'sys_031', originFaction: 'fac_tannhau_pilotage', strength: ['rng'], pays: ['rof', 'cd', 'trk', 'pwr', 'ammo'] },
  Halcyon: { house: 'Halcyon Optical', homeSystem: 'Halcyon Rest', homeSystemId: 'sys_034', originFaction: 'fac_tannhau_pilotage', strength: ['hit', 'trk'], pays: ['dmg', 'crit'] },
  Obsidian: { house: 'The Obsidian Free Foundries', homeSystem: 'Obsidian', homeSystemId: 'sys_041', originFaction: null, strength: ['crit'], pays: ['dmg', 'trk', 'hit', 'rng', 'var'] },
  Ceridan: { house: 'Ceridan Long-Patrol Yards', homeSystem: 'Silentreach', homeSystemId: 'sys_052', originFaction: null, strength: ['ammo', 'cd'], pays: ['dmg', 'rng', 'pwr', 'crit'] },
};
