#!/usr/bin/env python3
"""Authored ids for the world behind the mechanics -- factions, who polices which
region, which faction each NPC squadron flies for, and where each weapon
manufacturer is from.

Stands in the same relation to GamePlay/lore_specification.md as gameplay_tables.py
does to the other GamePlay documents: this file is the source of truth, the document
explains it, and tools/verify_lore.py holds the two together against the live
catalogue. Reference/lore.ts mirrors it.

NOTHING HERE IS A NUMBER. No mechanic reads a value from this file that changes a
price, a rate, a hit chance or a spawn. It names who does what the other tables
already decide:

  * which tiers are policed is RESPONSE_FLEET's keys in gameplay_tables.py -- read,
    never restated (POLICED_TIERS below);
  * where a squadron spawns is its security tier in NPC_SQUADRONS -- a faction's
    home region is lore and does not restrict spawning;
  * a manufacturer's stat bias is FAMILIES in generate_weapons.py -- the strength
    and price named here are checked against it, so the story cannot drift from the
    numbers.
"""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gameplay_tables import RESPONSE_FLEET
from system_tables import SYSTEM_BY_NAME, REGIONS

# ----------------------------------------------------------------- factions
# lore_specification.md 4. id format: fac_<slug>.
#   authority  polices the core and mid systems of exactly one region; fields that
#              region's response fleet; posts its NPC orders and contracts; holds the
#              standings a player earns there.
#   hostile    owns one or more NPC squadron templates. Spawning stays by security
#              tier (conflict_specification.md 3); homeRegion is where the story puts
#              them, and verify_lore.py only requires that region to have systems of
#              every tier the faction's squadrons spawn in.

FACTION_KINDS = ['authority', 'hostile']

#   id, display name, kind, home region
FACTIONS = [
    ('fac_aurelian_admiralty',  'The Aurelian Admiralty',         'authority', 'Aurelian Reach'),
    ('fac_kestrel_charter',     'The Kestrel Charter Company',    'authority', 'Kestrel Span'),
    ('fac_cindral_syndics',     'The Foundry Syndics of Cindral', 'authority', 'Cindral Verge'),
    ('fac_tannhau_pilotage',    'The Tannhau Pilotage',           'authority', 'Tannhau Drift'),
    ('fac_free_corsairs',       'The Free Corsairs',              'hostile',   'Tannhau Drift'),
    ('fac_lettered_captains',   'The Lettered Captains',          'hostile',   'Cindral Verge'),
    ('fac_gravewatch_warbands', 'The Gravewatch Warbands',        'hostile',   'Obsidian Marches'),
    ('fac_revenant_line',       'The Revenant Line',              'hostile',   'The Pale Hollow'),
]
FACTION_BY_ID = {f[0]: f for f in FACTIONS}

# The tiers an authority's writ covers. Derived: a tier is policed exactly when a
# response fleet exists for it (gameplay_tables.RESPONSE_FLEET). Never typed here.
POLICED_TIERS = [t for t in ('core', 'mid', 'rim', 'deadspace') if t in RESPONSE_FLEET]

# ----------------------------------------------------------------- regions
# lore_specification.md 5. region -> the authority that polices its core and mid
# systems, or None. verify_lore.py recomputes from the live map that a region has an
# authority exactly when it holds a system in a POLICED_TIER.
#
# STANDINGS ARE KEYED BY THIS AUTHORITY'S FACTION ID, not by region name
# (player.interface, conflict_specification.md 6). Each authority governs exactly
# one region, so the re-key changes no outcome: the four regions whose standings had
# an effect keep one standing each under a stable id, and the two regions with no
# policed space lose a key that never did anything.
REGION_AUTHORITY = {
    'Aurelian Reach':   'fac_aurelian_admiralty',
    'Kestrel Span':     'fac_kestrel_charter',
    'Cindral Verge':    'fac_cindral_syndics',
    'Tannhau Drift':    'fac_tannhau_pilotage',
    'Obsidian Marches': None,
    'The Pale Hollow':  None,
}

# ----------------------------------------------------------------- NPC squadrons
# lore_specification.md 4.2. squadronId (gameplay_tables.NPC_SQUADRONS) -> hostile
# faction. The generated squadron files do not carry this yet; adding a factionId
# field to npc_squadron.interface is listed as a schema gap, not done here.
SQUADRON_FACTION = {
    'npc_mid_pirate_raiders':  'fac_free_corsairs',
    'npc_rim_pirate_wing':     'fac_free_corsairs',
    'npc_rim_raider_pack':     'fac_lettered_captains',
    'npc_dead_warband':        'fac_gravewatch_warbands',
    'npc_dead_capital_threat': 'fac_revenant_line',
}

# ----------------------------------------------------------------- manufacturers
# lore_specification.md 6. One house per weapon family (generate_weapons.FAMILIES).
#
#   house     the maker's full name, for display
#   home      the system its works stand in (a live system name)
#   strength  the bias axes the house is known for. Each must be the family's
#             UNIQUE best value on that axis across all ten families.
#             'early_effect' means generate_weapons.EARLY_EFFECT_FAMILY.
#   pays      every axis on which the family is worse than neutral Vanguard --
#             exactly that set, so the lore names every price it pays.
#
# Axis names are the keys of generate_weapons.FAMILIES. "Better" is higher for
# dmg rof trk hit rng crit ammo, lower for cd pwr var (FAVOURABLE in verify_lore.py).
#
# The origin faction is NOT stored: it is the authority of the home system's region,
# derived below, so moving a house moves its allegiance with it.

FAMILY_HOUSES = {
    'Vanguard':  dict(house='Cantoris Arsenal (Vanguard Pattern)', home='Cantoris',
                      strength=[], pays=[]),
    'Meridian':  dict(house='Meridian Instrument Works',  home='Meridian Gate',
                      strength=['var'], pays=['dmg', 'crit']),
    'Kestrel':   dict(house='Kestrel Arms of the Charter', home='Kestrel',
                      strength=['rof'], pays=['dmg', 'rng', 'pwr', 'crit']),
    'Solari':    dict(house='Solari Lightworks',           home='Farhaven',
                      strength=['pwr'], pays=['dmg', 'crit']),
    'Draconis':  dict(house='Draconis Heavy Foundry',      home='Cindral',
                      strength=['dmg'], pays=['trk', 'hit', 'pwr', 'var', 'ammo']),
    'Ashwright': dict(house='Ashwright & Daughters',       home='Ashfall',
                      strength=['early_effect'], pays=['dmg', 'pwr']),
    'Voss':      dict(house='Voss Fortress Ordnance',      home='Tannhau',
                      strength=['rng'], pays=['rof', 'cd', 'trk', 'pwr', 'ammo']),
    'Halcyon':   dict(house='Halcyon Optical',             home='Halcyon Rest',
                      strength=['hit', 'trk'], pays=['dmg', 'crit']),
    'Obsidian':  dict(house='The Obsidian Free Foundries', home='Obsidian',
                      strength=['crit'], pays=['dmg', 'trk', 'hit', 'rng', 'var']),
    'Ceridan':   dict(house='Ceridan Long-Patrol Yards',   home='Silentreach',
                      strength=['ammo', 'cd'], pays=['dmg', 'rng', 'pwr', 'crit']),
}


def home_region(family):
    return SYSTEM_BY_NAME[FAMILY_HOUSES[family]['home']]['region']


def origin_faction(family):
    """The authority of the house's home region, or None in a region nobody polices."""
    return REGION_AUTHORITY[home_region(family)]


FAMILY_ORIGIN_FACTION = {f: origin_faction(f) for f in FAMILY_HOUSES}

# ----------------------------------------------------------------- sanity
_REGION_NAMES = [r for r, _ in REGIONS]
assert len(FACTION_BY_ID) == len(FACTIONS), 'duplicate faction id'
assert all(f[0].startswith('fac_') for f in FACTIONS), 'faction id must be fac_<slug>'
assert all(f[2] in FACTION_KINDS for f in FACTIONS), 'unknown faction kind'
assert all(f[3] in _REGION_NAMES for f in FACTIONS), 'faction home region not on the map'
assert set(REGION_AUTHORITY) == set(_REGION_NAMES), 'REGION_AUTHORITY must cover every region'
assert all(v is None or FACTION_BY_ID[v][2] == 'authority' for v in REGION_AUTHORITY.values()), \
    'a region is policed by a non-authority'
assert all(FACTION_BY_ID[v][2] == 'hostile' for v in SQUADRON_FACTION.values()), \
    'a squadron flies for a non-hostile faction'
assert all(h['home'] in SYSTEM_BY_NAME for h in FAMILY_HOUSES.values()), 'house home is not a system'
