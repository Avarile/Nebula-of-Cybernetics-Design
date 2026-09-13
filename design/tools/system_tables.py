#!/usr/bin/env python3
"""Authored tables for the systems-and-planets map. No RNG anywhere.

Implements Systems_Planets/systems_planets_specification.md. Nothing here
imports from the generators -- generate_systems.py and verify_systems.py import
FROM this module, never the reverse.
"""

from collections import Counter

RICHNESS = {1: 1.00, 2: 1.60, 3: 2.50}
DEVELOPMENT = {1: 1.00, 2: 1.55, 3: 2.40}
SECURITY_TIERS = ['core', 'mid', 'rim', 'deadspace']
SECURITY_BANDS = {'core': (0.80, 1.00), 'mid': (0.50, 0.70),
                  'rim': (0.20, 0.40), 'deadspace': (0.00, 0.10)}

# name, centre coordinates in light years
REGIONS = [
    ('Aurelian Reach',   (  0.0,   0.0,   0.0)),
    ('Kestrel Span',     ( 62.0,  18.0,  -6.0)),
    ('Cindral Verge',    ( 34.0, -55.0,  12.0)),
    ('Tannhau Drift',    (-48.0, -40.0, -14.0)),
    ('Obsidian Marches', (-70.0,  36.0,  20.0)),
    ('The Pale Hollow',  ( 10.0,  92.0, -28.0)),
]

# region, name, offset from the region centre
CONSTELLATIONS = [
    ('Aurelian Reach',   'Aurelian Core',    (  0.0,   0.0,  0.0)),
    ('Aurelian Reach',   'Meridian Chain',   ( 14.0,  -9.0,  3.0)),
    ('Aurelian Reach',   'Lumen Belt',       (-11.0,   8.0, -4.0)),
    ('Kestrel Span',     'Kestrel Prime',    (  0.0,   0.0,  0.0)),
    ('Kestrel Span',     'Windrow Cluster',  ( 12.0,  10.0,  5.0)),
    ('Kestrel Span',     'Sablewing Verge',  ( -9.0,  13.0, -6.0)),
    ('Cindral Verge',    'Cindral Forge',    (  0.0,   0.0,  0.0)),
    ('Cindral Verge',    'Ashfall Basin',    ( 13.0,  -7.0, -5.0)),
    ('Cindral Verge',    'Scoria Deep',      (-10.0, -12.0,  7.0)),
    ('Tannhau Drift',    'Tannhau Crossing', (  0.0,   0.0,  0.0)),
    ('Tannhau Drift',    'Longwake Spur',    (-13.0,   6.0,  8.0)),
    ('Tannhau Drift',    'Threnody Chain',   (  9.0, -14.0, -7.0)),
    ('Obsidian Marches', 'Obsidian Gate',    (  0.0,   0.0,  0.0)),
    ('Obsidian Marches', 'Gravewatch Span',  (-15.0,  11.0, -9.0)),
    ('The Pale Hollow',  'Silent Quarter',   (  0.0,   0.0,  0.0)),
    ('The Pale Hollow',  'The Abyssal',      ( 16.0,  14.0, 11.0)),
]

# constellation, system name, security tier, security rating.
# Order matters: rule 1 of the gate graph chains systems in this order, and
# the FIRST system of each constellation is its hub for rule 2 (spec 5.3).
SYSTEM_ROWS = [
    ('Aurelian Core',    'Aurelia',        'core', 1.00),
    ('Aurelian Core',    'Cantoris',       'core', 0.95),
    ('Aurelian Core',    'Verith Prime',   'core', 0.92),
    ('Aurelian Core',    'Solane',         'core', 0.88),
    ('Meridian Chain',   'Highmark',       'core', 0.85),
    ('Meridian Chain',   'Tessera',        'core', 0.82),
    ('Meridian Chain',   'Coriolan',       'core', 0.80),
    ('Lumen Belt',       'Meridian Gate',  'mid',  0.70),
    ('Lumen Belt',       'Lumen',          'mid',  0.65),
    ('Lumen Belt',       'Astra Vale',     'mid',  0.62),

    ('Kestrel Prime',    'Kestrel',        'core', 0.90),
    ('Kestrel Prime',    'Farhaven',       'core', 0.86),
    ('Kestrel Prime',    'Nyx Landing',    'core', 0.84),
    ('Kestrel Prime',    'Corvid',         'core', 0.81),
    ('Windrow Cluster',  'Emberlight',     'mid',  0.68),
    ('Windrow Cluster',  'Windrow',        'mid',  0.66),
    ('Windrow Cluster',  'Talonspire',     'mid',  0.60),
    ('Sablewing Verge',  'Greyreach',      'mid',  0.58),
    ('Sablewing Verge',  'Sablewing',      'mid',  0.55),
    ('Sablewing Verge',  'Pinnacle',       'mid',  0.52),

    ('Cindral Forge',    'Cindral',        'mid',  0.70),
    ('Cindral Forge',    'Ashfall',        'mid',  0.64),
    ('Cindral Forge',    'Ferrous Bay',    'mid',  0.61),
    ('Cindral Forge',    'Vantablack',     'mid',  0.57),
    ('Ashfall Basin',    'Orrery',         'mid',  0.54),
    ('Ashfall Basin',    'Kiln',           'mid',  0.51),
    ('Ashfall Basin',    'Smeltholm',      'mid',  0.50),
    ('Scoria Deep',      'Redline',        'rim',  0.38),
    ('Scoria Deep',      'Quarry Deep',    'rim',  0.32),
    ('Scoria Deep',      'Scoria',         'rim',  0.28),

    ('Tannhau Crossing', 'Tannhau',        'mid',  0.56),
    ('Tannhau Crossing', 'Driftmoor',      'mid',  0.53),
    ('Tannhau Crossing', 'Sable Cross',    'mid',  0.50),
    ('Tannhau Crossing', 'Halcyon Rest',   'rim',  0.40),
    ('Longwake Spur',    'Longwake',       'rim',  0.36),
    ('Longwake Spur',    'Sundered Arc',   'rim',  0.30),
    ('Longwake Spur',    'Mistral',        'rim',  0.26),
    ('Threnody Chain',   'Farrow',         'rim',  0.24),
    ('Threnody Chain',   'Threnody',       'rim',  0.22),
    ('Threnody Chain',   'Wanderfall',     'rim',  0.20),

    ('Obsidian Gate',    'Obsidian',       'rim',  0.40),
    ('Obsidian Gate',    'Blackmarch',     'rim',  0.34),
    ('Obsidian Gate',    'Ironwake',       'rim',  0.30),
    ('Obsidian Gate',    'Gravewatch',     'rim',  0.25),
    ('Obsidian Gate',    'Rust Hollow',    'rim',  0.21),
    ('Gravewatch Span',  'Nightfell',      'rim',       0.20),
    ('Gravewatch Span',  'Cairn',          'deadspace', 0.10),
    ('Gravewatch Span',  'Shrike',         'deadspace', 0.08),
    ('Gravewatch Span',  'Bleakspur',      'deadspace', 0.05),
    ('Gravewatch Span',  'Ossuary',        'deadspace', 0.02),

    ('Silent Quarter',   'Pale Hollow',    'rim',       0.22),
    ('Silent Quarter',   'Silentreach',    'rim',       0.20),
    ('Silent Quarter',   'The Maw',        'deadspace', 0.10),
    ('Silent Quarter',   'Ghostlight',     'deadspace', 0.08),
    ('Silent Quarter',   'Null Anchor',    'deadspace', 0.06),
    ('The Abyssal',      'Cold Harbour',   'deadspace', 0.05),
    ('The Abyssal',      'Veil',           'deadspace', 0.04),
    ('The Abyssal',      'Anathema',       'deadspace', 0.03),
    ('The Abyssal',      'Last Light',     'deadspace', 0.01),
    ('The Abyssal',      'Abyssal Rift',   'deadspace', 0.00),
]

# Spectral class and luminosity, rotated over the system ordinal. 5 is coprime
# with 7 so every class appears; the star is flavour, it drives no mechanic.
STARS = [('O', 8.0), ('B', 4.0), ('A', 2.2), ('F', 1.4),
         ('G', 1.0), ('K', 0.6), ('M', 0.3)]


def tiers_for(security_tier, security_rating):
    """(richnessTier, developmentTier) -- spec 3. The two ladders point opposite ways."""
    if security_tier == 'core':
        return 1, 3
    if security_tier == 'mid':
        return (1 if security_rating >= 0.60 else 2), 2
    if security_tier == 'rim':
        return (2, 2) if security_rating >= 0.30 else (3, 1)
    return 3, 1


def _region_of(constellation):
    for region, name, _ in CONSTELLATIONS:
        if name == constellation:
            return region
    raise KeyError(constellation)


def _centre(region):
    for name, xyz in REGIONS:
        if name == region:
            return xyz
    raise KeyError(region)


def _constellation_offset(constellation):
    for _, name, xyz in CONSTELLATIONS:
        if name == constellation:
            return xyz
    raise KeyError(constellation)


def _build_systems():
    rows, ordinal_in_constellation = [], {}
    for ordinal, (constellation, name, tier, rating) in enumerate(SYSTEM_ROWS):
        i = ordinal_in_constellation.get(constellation, 0)
        ordinal_in_constellation[constellation] = i + 1
        region = _region_of(constellation)
        cx, cy, cz = _centre(region)
        ox, oy, oz = _constellation_offset(constellation)
        # per-system offset: deterministic, spreads systems inside a constellation
        sx, sy, sz = i * 3.5, ((i * i) % 5) - 2.0, (i % 3) * 2.5 - 2.0
        richness, development = tiers_for(tier, rating)
        spectral, luminosity = STARS[(ordinal * 5) % len(STARS)]
        rows.append({
            'systemId': 'sys_%03d' % (ordinal + 1),
            'name': name,
            'region': region,
            'constellation': constellation,
            'securityTier': tier,
            'securityRating': rating,
            'star': {'spectralClass': spectral, 'luminosity': luminosity},
            'coordinates': {'x': round(cx + ox + sx, 2),
                            'y': round(cy + oy + sy, 2),
                            'z': round(cz + oz + sz, 2)},
            'richnessTier': richness,
            'developmentTier': development,
        })
    return rows


SYSTEMS = _build_systems()
SYSTEM_BY_NAME = {s['name']: s for s in SYSTEMS}
SYSTEM_BY_ID = {s['systemId']: s for s in SYSTEMS}


# ---- assertions (the unit tests for this module; run on import) ----

assert len(REGIONS) == 6, 'spec 2: six regions'
assert len(CONSTELLATIONS) == 16, 'spec 2: sixteen constellations'
assert len(SYSTEMS) == 60, 'spec 2: sixty systems'
assert len({s['systemId'] for s in SYSTEMS}) == 60, 'systemIds unique'
assert len({s['name'] for s in SYSTEMS}) == 60, 'system names unique'

_sec = Counter(s['securityTier'] for s in SYSTEMS)
assert _sec == {'core': 11, 'mid': 19, 'rim': 18, 'deadspace': 12}, \
    f'spec 3: security distribution, got {dict(_sec)}'

for _s in SYSTEMS:
    _lo, _hi = SECURITY_BANDS[_s['securityTier']]
    assert _lo <= _s['securityRating'] <= _hi, \
        f"{_s['name']}: rating {_s['securityRating']} outside {_s['securityTier']} band"

# spec 3: the inversion -- richness rises as security falls, development the reverse
for _s in SYSTEMS:
    _r, _d = _s['richnessTier'], _s['developmentTier']
    assert (_r, _d) != (3, 3), f"{_s['name']}: cannot be both richest and most developed"
    if _s['securityTier'] == 'core':
        assert (_r, _d) == (1, 3), f"{_s['name']}: core must be richness 1, development 3"
    if _s['securityTier'] == 'deadspace':
        assert (_r, _d) == (3, 1), f"{_s['name']}: deadspace must be richness 3, development 1"

LANES = ['structural', 'energy', 'ordnance', 'precision']

# spec 4. Extraction is raw units/turn at richnessTier 1; industry is at
# developmentTier 1. yieldModifier scales with NEITHER ladder -- see spec 6.1.
ARCHETYPES = {
    'ferrous_barren': dict(structural=120, energy=8,   ordnance=14,  precision=4,
                           refinery=60,  yieldModifier=0.96, manufactory=11,
                           berths=0, tonnage=0,     constr=0,  warehouse=2400),
    'crystalline':    dict(structural=12,  energy=105, ordnance=8,   precision=22,
                           refinery=50,  yieldModifier=0.96, manufactory=10,
                           berths=0, tonnage=0,     constr=0,  warehouse=1800),
    'gas_giant':      dict(structural=4,   energy=38,  ordnance=125, precision=8,
                           refinery=55,  yieldModifier=0.94, manufactory=8,
                           berths=0, tonnage=0,     constr=0,  warehouse=3000),
    'volcanic':       dict(structural=68,  energy=18,  ordnance=92,  precision=9,
                           refinery=65,  yieldModifier=0.95, manufactory=14,
                           berths=0, tonnage=0,     constr=0,  warehouse=2000),
    'irradiated':     dict(structural=18,  energy=28,  ordnance=22,  precision=95,
                           refinery=45,  yieldModifier=0.92, manufactory=9,
                           berths=0, tonnage=0,     constr=0,  warehouse=1400),
    'ice':            dict(structural=9,   energy=58,  ordnance=28,  precision=42,
                           refinery=50,  yieldModifier=0.95, manufactory=9,
                           berths=0, tonnage=0,     constr=0,  warehouse=2200),
    'oceanic':        dict(structural=42,  energy=32,  ordnance=52,  precision=18,
                           refinery=70,  yieldModifier=0.97, manufactory=22,
                           berths=1, tonnage=4000,  constr=18, warehouse=2600),
    'shattered':      dict(structural=82,  energy=12,  ordnance=18,  precision=58,
                           refinery=35,  yieldModifier=0.93, manufactory=6,
                           berths=0, tonnage=0,     constr=0,  warehouse=1200),
    'hive_world':     dict(structural=8,   energy=12,  ordnance=8,   precision=16,
                           refinery=95,  yieldModifier=0.99, manufactory=75,
                           berths=2, tonnage=16000, constr=42, warehouse=9000),
    'forge_world':    dict(structural=0,   energy=0,   ordnance=0,   precision=0,
                           refinery=130, yieldModifier=1.00, manufactory=110,
                           berths=4, tonnage=34000, constr=75, warehouse=12000),
}
ARCHETYPE_NAMES = list(ARCHETYPES)

_COMMON = ['ferrous_barren', 'crystalline', 'gas_giant', 'volcanic', 'ice']
# spec 4: irradiated and shattered -- the precision lane -- exist ONLY in rim and
# deadspace. forge worlds, the only capital yards, exist ONLY in core and mid.
PLACEMENT = {
    'core':      _COMMON + ['oceanic', 'hive_world', 'forge_world'],
    'mid':       _COMMON + ['oceanic', 'hive_world', 'forge_world'],
    'rim':       _COMMON + ['oceanic', 'hive_world', 'irradiated', 'shattered'],
    'deadspace': _COMMON + ['irradiated', 'shattered'],
}

# Landmarks: (system name, orbit index 0-based) -> archetype. Applied AFTER the
# rotation. Guarantees the core keeps forge worlds regardless of table edits.
PLANET_OVERRIDES = {
    ('Aurelia', 0): 'forge_world',
    ('Cantoris', 1): 'forge_world',
    ('Kestrel', 0): 'forge_world',
    ('Cindral', 1): 'forge_world',
    ('Abyssal Rift', 0): 'shattered',
    ('The Maw', 1): 'irradiated',
}

ROMAN = ['I', 'II', 'III', 'IV']


def _planet_count(ordinal):
    """2, 3, 4 cycling over the system ordinal -> exactly 20 of each, 180 total."""
    return 2 + (ordinal % 3)


def _pick_archetype(security_tier, system_ordinal, orbit):
    """spec 4. 5 and 11 are coprime with all three allowed-list lengths (8, 9, 7),
    so neither term ever collapses to a constant."""
    allowed = PLACEMENT[security_tier]
    return allowed[(system_ordinal * 5 + orbit * 11) % len(allowed)]


def _slug(text):
    out = []
    for ch in text.lower():
        out.append(ch if ch.isalnum() else '_')
    slug = ''.join(out)
    while '__' in slug:
        slug = slug.replace('__', '_')
    return slug.strip('_')


def _build_planets():
    rows, planet_no = [], 0
    for ordinal, system in enumerate(SYSTEMS):
        for orbit in range(_planet_count(ordinal)):
            planet_no += 1
            archetype = PLANET_OVERRIDES.get(
                (system['name'], orbit),
                _pick_archetype(system['securityTier'], ordinal, orbit))
            a = ARCHETYPES[archetype]
            rich, dev = RICHNESS[system['richnessTier']], DEVELOPMENT[system['developmentTier']]
            name = '%s %s' % (system['name'], ROMAN[orbit])
            rows.append({
                'planetId': 'pln_%03d' % planet_no,
                'name': name,
                'systemId': system['systemId'],
                'archetype': archetype,
                'orbitIndex': orbit + 1,
                'richnessTier': system['richnessTier'],
                'developmentTier': system['developmentTier'],
                'extraction': {lane: round(a[lane] * rich, 2) for lane in LANES},
                'refinery': {
                    'throughputPerTurn': round(a['refinery'] * dev, 2),
                    'yieldModifier': a['yieldModifier'],
                },
                'manufactory': {'throughputPerTurn': round(a['manufactory'] * dev, 2)},
                'shipyard': {
                    'berths': a['berths'],
                    'maxHullTonnage': int(a['tonnage'] * dev),
                    'constructionRatePerTurn': round(a['constr'] * dev, 2),
                },
                'warehouse': {'capacity': int(a['warehouse'] * dev)},
                'slug': _slug(name),
            })
    return rows


PLANETS = _build_planets()
PLANET_BY_ID = {p['planetId']: p for p in PLANETS}
PLANETS_BY_SYSTEM = {}
for _p in PLANETS:
    PLANETS_BY_SYSTEM.setdefault(_p['systemId'], []).append(_p['planetId'])

assert len(ARCHETYPE_NAMES) == 10, 'spec 4: ten archetypes'
assert len(PLANETS) == 180, f'spec 4: 180 planets, got {len(PLANETS)}'
assert len({p['planetId'] for p in PLANETS}) == 180, 'planetIds unique'
assert len({p['name'] for p in PLANETS}) == 180, 'planet names unique'

_per_system = Counter(p['systemId'] for p in PLANETS)
assert set(_per_system.values()) == {2, 3, 4}, 'spec 4: 2-4 planets per system'
assert Counter(_per_system.values()) == {2: 20, 3: 20, 4: 20}, \
    f'spec 4: 20 systems of each size, got {dict(Counter(_per_system.values()))}'

# spec 4: placement -- no forge world in deadspace, no irradiated world in core
for _p in PLANETS:
    _sys = SYSTEM_BY_ID[_p['systemId']]
    assert _p['archetype'] in PLACEMENT[_sys['securityTier']], \
        f"{_p['name']}: {_p['archetype']} illegal in {_sys['securityTier']}"

# spec 6.1: yieldModifier never exceeds 1.00 and never scales with a ladder
for _p in PLANETS:
    assert _p['refinery']['yieldModifier'] <= 1.00, \
        f"{_p['name']}: yieldModifier {_p['refinery']['yieldModifier']} > 1.00"
    assert _p['refinery']['yieldModifier'] == ARCHETYPES[_p['archetype']]['yieldModifier'], \
        f"{_p['name']}: yieldModifier was scaled by a ladder"

# spec 6.4: a planet with no berths has no yard at all
for _p in PLANETS:
    if _p['shipyard']['berths'] == 0:
        assert _p['shipyard']['maxHullTonnage'] == 0 and \
               _p['shipyard']['constructionRatePerTurn'] == 0, \
            f"{_p['name']}: berths 0 but yard is non-empty"

# spec 6.4: both ladders monotonic within an archetype
for _arch in ARCHETYPE_NAMES:
    _same = [p for p in PLANETS if p['archetype'] == _arch]
    for _lane in ('structural', 'energy', 'ordnance', 'precision'):
        _by_rich = {}
        for _p in _same:
            _by_rich.setdefault(_p['richnessTier'], set()).add(_p['extraction'][_lane])
        for _a in _by_rich:
            for _b in _by_rich:
                if _a < _b:
                    assert max(_by_rich[_a]) <= min(_by_rich[_b]), \
                        f'{_arch}/{_lane}: richness {_a} out-extracts {_b}'
    _by_dev = {}
    for _p in _same:
        _by_dev.setdefault(_p['developmentTier'], set()).add(_p['manufactory']['throughputPerTurn'])
    for _a in _by_dev:
        for _b in _by_dev:
            if _a < _b:
                assert max(_by_dev[_a]) <= min(_by_dev[_b]), \
                    f'{_arch}: development {_a} out-manufactures {_b}'
