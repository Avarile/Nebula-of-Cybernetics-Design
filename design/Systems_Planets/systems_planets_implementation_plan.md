# Systems & Planets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate 60 star systems joined by a verified jump-gate graph, and the 180 planets inside them that extract, refine, manufacture and build ships.

**Architecture:** One authored table module (`tools/system_tables.py`) holds every literal — regions, constellations, the 60 systems, planet archetypes, gate rules — and derives systems, planets and the canonical edge list from them with no RNG. A generator writes that to a directory tree, `links.json`, `index.json` and two new keys in `fleet_and_weapons.json`. A verifier re-reads the output plus the live resource, skill and ship catalogues and enforces ~30 invariants. Same shape as the four catalogues already in the repo.

**Tech Stack:** Python 3 standard library only (no third-party imports anywhere in `tools/`). TypeScript for `Reference/` interfaces, checked by `Reference/verify_reference.py`.

**Spec:** `design/Systems_Planets/systems_planets_specification.md` — read it alongside this plan. The plan implements it; the numbers, tables and invariants live there and are not repeated here except where a task needs them inline.

## Global Constraints

- **Working directory is `design/`.** Every path in this plan is relative to it. `ROOT` in every tool resolves to `design/`, matching the existing tools.
- **No RNG, ever.** Every value is a pure function of a table entry. Re-running the generator must reproduce the tree byte-for-byte. No `random`, no `time`, no `uuid`, no dict-ordering dependence.
- **Python 3 stdlib only** in `tools/`. Match the existing house style: `import argparse, json, os, shutil, sys` on one line, 4-space indent, no type annotations, no f-string `=` debugging.
- **JSON output format:** `json.dump(obj, f, indent=2)` followed by `f.write('\n')`. Every generated file ends with exactly one newline.
- **`Systems_Planets/` is a PARTIALLY generated directory.** The generator clears only the six region directories, `links.json` and `index.json`. It must never `rmtree` the whole folder — `systems_planets_specification.md` and this plan live there and must survive. Follow the comment-and-clear pattern in `tools/generate_resources.py`.
- **Counts are fixed:** 6 regions, 16 constellations, 60 systems, 180 planets. A task that changes a count is wrong.
- **Id formats:** `sys_001`–`sys_060`, `pln_001`–`pln_180`, `bel_###`, `gate_<lowerSysId>_<higherSysId>`. Zero-padded to 3 digits.
- **Ladder multipliers** (spec §3): richness `{1: 1.00, 2: 1.60, 3: 2.50}`, development `{1: 1.00, 2: 1.55, 3: 2.40}`.
- **Rounding:** rates and yields `round(x, 2)`; `maxHullTonnage`, `warehouse.capacity`, `berths` are `int`; `jumpDistanceLy` is `round(x, 1)`.
- **`yieldModifier` is capped at 1.00 and scales with neither ladder.** This is the §6.1 invariant. Do not "improve" it.

## Testing model — read this before Task 1

**This repo has no pytest for `design/`.** Do not add one. The test harness is:

1. **Module-level `assert` statements** in the table module, run on import — the pattern `tools/stat_vocabulary.py` already uses. These are the unit tests for the tables.
2. **`tools/verify_systems.py`** — the integration test, in the style of the four existing `verify_*.py`: each check prints `ok` or `FAIL`, the script exits non-zero if any check fails.

So the TDD cycle for every task is:

```
write the failing assert/check  →  run it, watch it fail  →  write the code  →  run it, watch it pass  →  commit
```

"Run the test" always means running a Python file directly and reading its output. Expected failures are shown per-step.

---

### Task 1: Region, constellation and system tables

**Files:**
- Create: `tools/system_tables.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `REGIONS`, `CONSTELLATIONS`, `SYSTEM_ROWS`, `RICHNESS`, `DEVELOPMENT`, `SECURITY_BANDS`, `tiers_for(security_tier, security_rating) -> (richnessTier, developmentTier)`, `SYSTEMS` (list of 60 dicts, each with `systemId`, `name`, `region`, `constellation`, `securityTier`, `securityRating`, `star`, `coordinates`, `richnessTier`, `developmentTier`), and `SYSTEM_BY_NAME` (dict name -> system dict).

- [ ] **Step 1: Write the failing test**

Create `tools/system_tables.py` containing ONLY the assertions, so they fail on undefined names:

```python
#!/usr/bin/env python3
"""Authored tables for the systems-and-planets map. No RNG anywhere.

Implements Systems_Planets/systems_planets_specification.md. Nothing here
imports from the generators -- generate_systems.py and verify_systems.py import
FROM this module, never the reverse.
"""

# ---- assertions (the unit tests for this module; run on import) ----
from collections import Counter

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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `python3 -c "import sys; sys.path.insert(0, 'tools'); import system_tables"`
Expected: `NameError: name 'REGIONS' is not defined`

- [ ] **Step 3: Write the tables above the assertion block**

Insert this between the docstring and the assertion block:

```python
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
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `python3 -c "import sys; sys.path.insert(0, 'tools'); import system_tables as t; print(len(t.SYSTEMS), 'systems'); print(t.SYSTEMS[0])"`
Expected: `60 systems` then the Aurelia dict, with `richnessTier: 1, developmentTier: 3`.

- [ ] **Step 5: Commit**

```bash
git add tools/system_tables.py
git commit -m "feat(systems): region, constellation and system tables"
```

---

### Task 2: Planet archetypes and the 180 planets

**Files:**
- Modify: `tools/system_tables.py` (append before the assertion block)

**Interfaces:**
- Consumes: `SYSTEMS`, `RICHNESS`, `DEVELOPMENT` from Task 1.
- Produces: `ARCHETYPES` (dict archetype -> signature dict), `ARCHETYPE_NAMES` (list of 10), `PLACEMENT` (dict security tier -> allowed archetype list), `PLANET_OVERRIDES`, `PLANETS` (list of 180 dicts), `PLANET_BY_ID`.

- [ ] **Step 1: Write the failing test**

Append to the assertion block at the bottom of `tools/system_tables.py`:

```python
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `python3 -c "import sys; sys.path.insert(0, 'tools'); import system_tables"`
Expected: `NameError: name 'ARCHETYPE_NAMES' is not defined`

- [ ] **Step 3: Write the archetype table and planet derivation**

Insert above the assertion block. The numbers are spec §4 verbatim — do not adjust them:

```python
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
```

- [ ] **Step 4: Run it to make sure it passes**

Run:
```bash
python3 -c "
import sys; sys.path.insert(0, 'tools'); import system_tables as t
from collections import Counter
print(len(t.PLANETS), 'planets')
print(Counter(p['archetype'] for p in t.PLANETS))
forge = [p for p in t.PLANETS if p['archetype'] == 'forge_world']
print('max tonnage:', max(p['shipyard']['maxHullTonnage'] for p in t.PLANETS))
"
```
Expected: `180 planets`, a spread across all 10 archetypes with no zero counts, and `max tonnage: 81600`.

- [ ] **Step 5: Commit**

```bash
git add tools/system_tables.py
git commit -m "feat(systems): planet archetypes and the 180-planet derivation"
```

---

### Task 3: Asteroid belts and the gate graph

**Files:**
- Modify: `tools/system_tables.py` (append before the assertion block)

**Interfaces:**
- Consumes: `SYSTEMS`, `SYSTEM_BY_NAME`, `LANES`, `RICHNESS` from Tasks 1–2.
- Produces: `BELTS_BY_SYSTEM` (dict systemId -> list of belt dicts), `REGION_BRIDGES`, `EXTRA_GATES`, `GATES` (canonical sorted list of edge dicts), `CONNECTIONS_BY_SYSTEM` (dict systemId -> list of connection dicts).

- [ ] **Step 1: Write the failing test**

Append to the assertion block:

```python
# spec 5.2: belt count runs opposite to security
_want_belts = {'core': (0, 1), 'mid': (1, 2), 'rim': (2, 3), 'deadspace': (3, 4)}
for _s in SYSTEMS:
    _n = len(BELTS_BY_SYSTEM[_s['systemId']])
    _lo, _hi = _want_belts[_s['securityTier']]
    assert _lo <= _n <= _hi, f"{_s['name']}: {_n} belts outside {_s['securityTier']} range"

# spec 5.3: the edge set is canonical
assert len({(g['a'], g['b']) for g in GATES}) == len(GATES), 'duplicate gate'
for _g in GATES:
    assert _g['a'] < _g['b'], f"{_g['gateId']}: not in canonical (lower, higher) order"
    assert _g['a'] != _g['b'], f"{_g['gateId']}: self-loop"
    assert _g['gateId'] == 'gate_%s_%s' % (_g['a'], _g['b']), f"{_g['gateId']}: bad id"

# spec 5.3: symmetry -- both endpoints list the same gate
for _sid, _conns in CONNECTIONS_BY_SYSTEM.items():
    for _c in _conns:
        _back = [x for x in CONNECTIONS_BY_SYSTEM[_c['toSystemId']] if x['toSystemId'] == _sid]
        assert len(_back) == 1, f"{_sid} -> {_c['toSystemId']} has no single return edge"
        assert _back[0]['gateId'] == _c['gateId'], 'gateId disagrees between endpoints'
        assert _back[0]['jumpDistanceLy'] == _c['jumpDistanceLy'], 'distance disagrees'

# spec 6.3: every system reachable from sys_001 by BFS
_seen, _queue = {'sys_001'}, ['sys_001']
while _queue:
    _cur = _queue.pop()
    for _c in CONNECTIONS_BY_SYSTEM[_cur]:
        if _c['toSystemId'] not in _seen:
            _seen.add(_c['toSystemId']); _queue.append(_c['toSystemId'])
assert len(_seen) == 60, f'graph not connected: {60 - len(_seen)} systems unreachable'
assert all(CONNECTIONS_BY_SYSTEM[s['systemId']] for s in SYSTEMS), 'isolated system'
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `python3 -c "import sys; sys.path.insert(0, 'tools'); import system_tables"`
Expected: `NameError: name 'BELTS_BY_SYSTEM' is not defined`

- [ ] **Step 3: Write belts and the graph builder**

Insert above the assertion block:

```python
import math

BELT_BASE = {'structural': 18, 'energy': 14, 'ordnance': 12, 'precision': 9}
BELT_CYCLE = {'structural': 2, 'energy': 2, 'ordnance': 3, 'precision': 4}
BELT_FLOOR = {'core': 0, 'mid': 1, 'rim': 2, 'deadspace': 3}


def _build_belts():
    out, belt_no = {}, 0
    for ordinal, system in enumerate(SYSTEMS):
        count = BELT_FLOOR[system['securityTier']] + (ordinal % 2)
        belts = []
        for i in range(count):
            belt_no += 1
            lane = LANES[(ordinal * 3 + i) % len(LANES)]
            belts.append({
                'beltId': 'bel_%03d' % belt_no,
                'name': '%s Belt %s' % (system['name'], ROMAN[i]),
                'dominantLane': lane,
                'richnessTier': system['richnessTier'],
                'yieldPerCycle': round(BELT_BASE[lane] * RICHNESS[system['richnessTier']], 2),
                'cycleTurns': BELT_CYCLE[lane],
            })
        out[system['systemId']] = belts
    return out


BELTS_BY_SYSTEM = _build_belts()

# spec 5.3 rule 3: the named chokepoints that join the six regions.
# (gate name, system A, system B)
REGION_BRIDGES = [
    ('The Meridian Gate',      'Coriolan',   'Kestrel'),
    ('Cindral Approach',       'Astra Vale', 'Cindral'),
    ('Tannhau Narrows',        'Pinnacle',   'Tannhau'),
    ('Scoria Crossing',        'Scoria',     'Halcyon Rest'),
    ('Obsidian Threshold',     'Wanderfall', 'Obsidian'),
    ('Cold Harbour Approach',  'Ossuary',    'Cold Harbour'),
    ('The Long Dark',          'Nightfell',  'Pale Hollow'),
]

# spec 5.3 rule 4: shortcuts, so the map is not a pure tree.
EXTRA_GATES = [
    ('Solane', 'Highmark'),
    ('Tessera', 'Lumen'),
    ('Corvid', 'Talonspire'),
    ('Corvid', 'Sablewing'),
    ('Vantablack', 'Orrery'),
    ('Kiln', 'Redline'),
    ('Driftmoor', 'Longwake'),
    ('Mistral', 'Threnody'),
    ('Blackmarch', 'Nightfell'),
    ('Shrike', 'The Maw'),
    ('Ghostlight', 'Veil'),
]


def _distance(a, b):
    pa, pb = a['coordinates'], b['coordinates']
    return round(math.sqrt((pa['x'] - pb['x']) ** 2 +
                           (pa['y'] - pb['y']) ** 2 +
                           (pa['z'] - pb['z']) ** 2), 1)


def _build_gates():
    """Rules 1-4 of spec 5.3, then canonicalise: order, dedupe, drop self-loops."""
    raw = {}          # (lowerId, higherId) -> gate name or None

    def add(name_a, name_b, gate_name=None):
        a, b = SYSTEM_BY_NAME[name_a]['systemId'], SYSTEM_BY_NAME[name_b]['systemId']
        if a == b:
            return
        key = (a, b) if a < b else (b, a)
        if raw.get(key) is None:
            raw[key] = gate_name

    # rule 1: chain the systems inside each constellation
    by_constellation = {}
    for s in SYSTEMS:
        by_constellation.setdefault(s['constellation'], []).append(s['name'])
    for names in by_constellation.values():
        for i in range(len(names) - 1):
            add(names[i], names[i + 1])

    # rule 2: link constellation hubs (the first system of each) inside a region
    by_region = {}
    for _, constellation, _ in CONSTELLATIONS:
        region = _region_of(constellation)
        by_region.setdefault(region, []).append(by_constellation[constellation][0])
    for hubs in by_region.values():
        for i in range(len(hubs) - 1):
            add(hubs[i], hubs[i + 1])

    # rule 3: named region bridges
    for gate_name, a, b in REGION_BRIDGES:
        add(a, b, gate_name)

    # rule 4: authored shortcuts
    for a, b in EXTRA_GATES:
        add(a, b)

    gates = []
    for (a, b) in sorted(raw):
        sa, sb = SYSTEM_BY_ID[a], SYSTEM_BY_ID[b]
        gates.append({
            'gateId': 'gate_%s_%s' % (a, b),
            'gateName': raw[(a, b)] or '%s — %s' % (sa['name'], sb['name']),
            'a': a,
            'b': b,
            'jumpDistanceLy': _distance(sa, sb),
            'crossesConstellation': sa['constellation'] != sb['constellation'],
            'crossesRegion': sa['region'] != sb['region'],
        })
    return gates


GATES = _build_gates()


def _build_connections():
    out = {s['systemId']: [] for s in SYSTEMS}
    for g in GATES:
        for near, far in ((g['a'], g['b']), (g['b'], g['a'])):
            out[near].append({
                'toSystemId': far,
                'gateId': g['gateId'],
                'gateName': g['gateName'],
                'jumpDistanceLy': g['jumpDistanceLy'],
                'crossesConstellation': g['crossesConstellation'],
                'crossesRegion': g['crossesRegion'],
            })
    for conns in out.values():
        conns.sort(key=lambda c: c['toSystemId'])
    return out


CONNECTIONS_BY_SYSTEM = _build_connections()
```

Move `import math` to the top of the file with the other imports before committing.

- [ ] **Step 4: Run it to make sure it passes**

Run:
```bash
python3 -c "
import sys; sys.path.insert(0, 'tools'); import system_tables as t
print(len(t.GATES), 'gates')
print('region bridges:', sum(1 for g in t.GATES if g['crossesRegion']))
d = [len(v) for v in t.CONNECTIONS_BY_SYSTEM.values()]
print('degree min/max/avg: %d/%d/%.2f' % (min(d), max(d), sum(d)/len(d)))
print('belts:', sum(len(v) for v in t.BELTS_BY_SYSTEM.values()))
"
```
Expected exactly: `72 gates`, `region bridges: 8`, `degree min/max/avg: 1/4/2.40`, `belts: 121`.
All assertions silent. Eight edges cross a region, not the seven named bridges — `('Shrike', 'The Maw')` in `EXTRA_GATES` is an unnamed inter-region shortcut, which is
intentional: it gives the Pale Hollow a second way in.

- [ ] **Step 5: Commit**

```bash
git add tools/system_tables.py
git commit -m "feat(systems): asteroid belts and the canonical gate graph"
```

---

### Task 4: The two schema files

**Files:**
- Create: `Data-Templates/system.interface`
- Create: `Data-Templates/planet.interface`

**Interfaces:**
- Consumes: the field names produced in Tasks 1–3.
- Produces: the schemas `verify_systems.py` reads in Task 6. Format: `#`-commented header, then a JSON body that parses once comment lines are stripped — identical convention to `resource.interface`.

- [ ] **Step 1: Write the failing test**

There is no verifier yet, so the test is that both files parse as JSON with their comments stripped, and that the declared field set matches what the tables produce. Create `tools/check_interfaces_tmp.py`:

```python
import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from system_tables import SYSTEMS, PLANETS, BELTS_BY_SYSTEM, CONNECTIONS_BY_SYSTEM

def schema(name):
    path = os.path.join(ROOT, 'Data-Templates', name)
    body = '\n'.join(l for l in open(path) if not l.lstrip().startswith('#'))
    return set(json.loads(body))

sysrec = dict(SYSTEMS[0])
sysrec['planets'] = []; sysrec['asteroidBelts'] = []; sysrec['connections'] = []
assert schema('system.interface') == set(sysrec), \
    'system.interface != %s' % sorted(set(sysrec) ^ schema('system.interface'))
planet = dict(PLANETS[0]); planet.pop('slug')
assert schema('planet.interface') == set(planet), \
    'planet.interface != %s' % sorted(set(planet) ^ schema('planet.interface'))
print('ok  both interfaces match the tables')
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `python3 tools/check_interfaces_tmp.py`
Expected: `FileNotFoundError: ... Data-Templates/system.interface`

- [ ] **Step 3: Write both schema files**

`Data-Templates/system.interface`:

```
# INTERFACE: System
# Source of truth : ../tools/system_tables.py -> SYSTEMS, GATES
# Live reference  : ../fleet_and_weapons.json -> "systems"
# Generated by    : ../tools/generate_systems.py -- deterministic, no RNG.
#                   Re-running reproduces the map byte-for-byte. Edit the tables
#                   in system_tables.py, never the generated files.
#                   ../tools/verify_systems.py checks the invariants below.
#
# Usage: one JSON file per system at Systems_Planets/<Region>/<System>/system.json,
# with that system's planets in a planets/ subdirectory. Systems_Planets/links.json
# lists every gate once in canonical form; Systems_Planets/index.json lists all 60
# systems and all 180 planets with their paths.
#
# HIERARCHY -- region (6) > constellation (16) > system (60) > planet (180).
#
# SECURITY -- four tiers. richnessTier rises as security FALLS and scales planetary
# extraction; developmentTier rises as security RISES and scales industry. The two
# ladders point opposite ways on purpose: the ore is where it is dangerous, the
# factories are where it is safe, so material has to move.
#
#   core       rating 0.80-1.00    11 systems    richness 1    development 3
#   mid        rating 0.50-0.70    19 systems    richness 1-2  development 2
#   rim        rating 0.20-0.40    18 systems    richness 2-3  development 1-2
#   deadspace  rating 0.00-0.10    12 systems    richness 3    development 1
#
# GATES -- connections[] is denormalised from one canonical edge list, so both
# endpoints of a gate carry the same gateId, gateName and jumpDistanceLy. gateId
# is always gate_<lowerSystemId>_<higherSystemId> regardless of approach direction.
#
# INVARIANTS (enforced by tools/verify_systems.py)
#   - 60 systems, ids and names unique; field set identical to the schema below
#   - securityRating inside its tier's band; richness/development consistent with it
#   - every connection symmetric, no self-loops, no duplicates, every toSystemId real
#   - BFS from sys_001 reaches all 60 -- the map has no unreachable region
#   - links.json and the union of all connections[] are the same edge set

{
  "systemId": "string, unique, format: sys_### (001-060)",
  "name": "string, unique",
  "region": "enum: Aurelian Reach | Kestrel Span | Cindral Verge | Tannhau Drift | Obsidian Marches | The Pale Hollow",
  "constellation": "string -- one of the 16, each belonging to exactly one region",
  "securityTier": "enum: core | mid | rim | deadspace",
  "securityRating": "number 0-1 -- finer ordering inside the tier's band",
  "star": { "spectralClass": "enum: O | B | A | F | G | K | M", "luminosity": "number, Sol = 1.0" },
  "coordinates": { "x": "number, light years", "y": "number, light years", "z": "number, light years" },
  "richnessTier": "integer 1-3 -- scales planetary extraction; rises as security falls",
  "developmentTier": "integer 1-3 -- scales industry; rises as security rises",
  "planets": "array of planetId, in orbit order",
  "asteroidBelts": "array of { beltId, name, dominantLane, richnessTier, yieldPerCycle, cycleTurns }",
  "connections": "array of { toSystemId, gateId, gateName, jumpDistanceLy, crossesConstellation, crossesRegion }"
}

# ---- EXAMPLE INSTANCE ----
#
# {
#   "systemId": "sys_001",
#   "name": "Aurelia",
#   "region": "Aurelian Reach",
#   "constellation": "Aurelian Core",
#   "securityTier": "core",
#   "securityRating": 1.0,
#   "star": { "spectralClass": "O", "luminosity": 8.0 },
#   "coordinates": { "x": 0.0, "y": -2.0, "z": -2.0 },
#   "richnessTier": 1,
#   "developmentTier": 3,
#   "planets": ["pln_001", "pln_002"],
#   "asteroidBelts": [],
#   "connections": [
#     { "toSystemId": "sys_002", "gateId": "gate_sys_001_sys_002",
#       "gateName": "Aurelia — Cantoris", "jumpDistanceLy": 4.4,
#       "crossesConstellation": false, "crossesRegion": false }
#   ]
# }
```

`Data-Templates/planet.interface`:

```
# INTERFACE: Planet
# Source of truth : ../tools/system_tables.py -> ARCHETYPES, PLANETS
# Live reference  : ../fleet_and_weapons.json -> "planets"
# Generated by    : ../tools/generate_systems.py -- deterministic, no RNG.
#
# Usage: one JSON file per planet at
# Systems_Planets/<Region>/<System>/planets/<planetId>_<slug>.json.
#
# WHY THESE FIELDS -- the station_management skills are pure percentage
# multipliers with no base of their own. A planet is the base they multiply:
#
#   extraction        x planetaryProductionRate   (Planetary Resource Production)
#   warehouse         x warehouseCapacity         (Planetary Production Management)
#   refinery          x refineryYield             (Material Refinement Management)
#   manufactory       x manufacturingRate         (Manufactory Management)
#   shipyard          x shipConstructionRate      (Ship Construction Management)
#
# VALUE MODEL -- archetype signature x richnessTier x developmentTier:
#
#   extraction        scales with richnessTier   (1.00 / 1.60 / 2.50)
#   refinery.throughputPerTurn, manufactory, shipyard, warehouse
#                     scale with developmentTier (1.00 / 1.55 / 2.40)
#   refinery.yieldModifier  scales with NEITHER -- it is fixed per archetype
#
# The last line is load-bearing. Effective refining yield is
# lane.conversionYield x yieldModifier x skillMultiplier, and resource.interface
# requires it to stay strictly below 1. The worst case is 0.90 x 1.00 x 1.10 =
# 0.99, a margin of 0.01. Putting yieldModifier on the development ladder would
# take a forge world to 2.40 and break the resource tier model outright.
#
# <<< generated from tools/generate_systems.py -- do not edit by hand
# >>> end generated
#
# INVARIANTS (enforced by tools/verify_systems.py)
#   - 180 planets, ids and names unique; field set identical to the schema below
#   - archetype legal for the containing system's securityTier (forge worlds never
#     in deadspace; irradiated and shattered worlds never in core or mid)
#   - yieldModifier <= 1.00 and equal to its archetype's, unscaled
#   - berths 0 implies maxHullTonnage 0 and constructionRatePerTurn 0
#   - both ladders monotonic within an archetype
#   - some planet can build every ship category, including the 65,100 t battleship

{
  "planetId": "string, unique, format: pln_### (001-180)",
  "name": "string, unique -- <System Name> <Roman numeral by orbit>",
  "systemId": "systemId of the containing system",
  "archetype": "enum: ferrous_barren | crystalline | gas_giant | volcanic | irradiated | ice | oceanic | shattered | hive_world | forge_world",
  "orbitIndex": "integer 1-4 -- position from the star",
  "richnessTier": "integer 1-3 -- inherited from the system",
  "developmentTier": "integer 1-3 -- inherited from the system",
  "extraction": "object, raw units per turn, one key per resource lane: { structural, energy, ordnance, precision }",
  "refinery": { "throughputPerTurn": "number, raw units consumed per turn", "yieldModifier": "number <= 1.00, multiplies the lane's conversionYield" },
  "manufactory": { "throughputPerTurn": "number, manufactured units per turn" },
  "shipyard": { "berths": "integer, hulls buildable at once", "maxHullTonnage": "integer, tons -- the heaviest hull this yard can lay down", "constructionRatePerTurn": "number, manufactured units absorbed per turn" },
  "warehouse": { "capacity": "integer, units (= tons, every resource is unitMass 1.0)" }
}

# ---- EXAMPLE INSTANCE ----
#
# {
#   "planetId": "pln_001",
#   "name": "Aurelia I",
#   "systemId": "sys_001",
#   "archetype": "forge_world",
#   "orbitIndex": 1,
#   "richnessTier": 1,
#   "developmentTier": 3,
#   "extraction": { "structural": 0.0, "energy": 0.0, "ordnance": 0.0, "precision": 0.0 },
#   "refinery": { "throughputPerTurn": 312.0, "yieldModifier": 1.0 },
#   "manufactory": { "throughputPerTurn": 264.0 },
#   "shipyard": { "berths": 4, "maxHullTonnage": 81600, "constructionRatePerTurn": 180.0 },
#   "warehouse": { "capacity": 28800 }
# }
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `python3 tools/check_interfaces_tmp.py`
Expected: `ok  both interfaces match the tables`

Then delete the temporary checker — Task 6 replaces it with a permanent check:

```bash
rm tools/check_interfaces_tmp.py
```

- [ ] **Step 5: Commit**

```bash
git add Data-Templates/system.interface Data-Templates/planet.interface
git commit -m "feat(systems): system and planet schemas"
```

---

### Task 5: The generator

**Files:**
- Create: `tools/generate_systems.py`
- Modify: `fleet_and_weapons.json` (adds `systems`, `planets`, and five `_meta` keys — written by the script, not by hand)
- Modify: `Data-Templates/planet.interface` (the generator fills its `<<< generated >>>` block)

**Interfaces:**
- Consumes: everything `system_tables.py` exports.
- Produces: `Systems_Planets/<Region>/<System>/system.json`, `.../planets/<planetId>_<slug>.json`, `Systems_Planets/links.json`, `Systems_Planets/index.json`, and the `systems` / `planets` keys in `fleet_and_weapons.json`.

- [ ] **Step 1: Write the failing test**

The generator's own `--dry-run` is the first test. There is nothing to assert against yet, so the failing test is simply that the script does not exist:

Run: `python3 tools/generate_systems.py --dry-run`
Expected: `can't open file ... generate_systems.py: [Errno 2] No such file or directory`

- [ ] **Step 2: Confirm the failure**

Recorded above — move straight to Step 3.

- [ ] **Step 3: Write the generator**

```python
#!/usr/bin/env python3
"""Deterministic systems-and-planets generator for Nebula-of-Cybernetics-Design.

Every value comes straight from tools/system_tables.py -- no RNG. Re-running
reproduces the map byte-for-byte.

Usage:
    python3 tools/generate_systems.py --dry-run   # report shape, write nothing
    python3 tools/generate_systems.py             # regenerate everything
"""
import argparse, json, os, shutil, sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from system_tables import (SYSTEMS, PLANETS, PLANETS_BY_SYSTEM, BELTS_BY_SYSTEM,
                           CONNECTIONS_BY_SYSTEM, GATES, REGIONS, SECURITY_TIERS,
                           ARCHETYPE_NAMES)

FLEET = os.path.join(ROOT, 'fleet_and_weapons.json')
MAP_DIR = os.path.join(ROOT, 'Systems_Planets')
IFACE = os.path.join(ROOT, 'Data-Templates', 'planet.interface')

MARK_BEGIN = '# <<< generated from tools/generate_systems.py -- do not edit by hand\n'
MARK_END = '# >>> end generated\n'

REGION_NAMES = [name for name, _ in REGIONS]


def dir_name(text):
    """Directory-safe: '/' cannot appear in a path component."""
    return text.replace('/', ' - ')


def system_record(system):
    """The full system as it is written to disk and to the fleet json."""
    out = dict(system)
    out['planets'] = list(PLANETS_BY_SYSTEM[system['systemId']])
    out['asteroidBelts'] = BELTS_BY_SYSTEM[system['systemId']]
    out['connections'] = CONNECTIONS_BY_SYSTEM[system['systemId']]
    return out


def planet_record(planet):
    out = dict(planet)
    out.pop('slug')
    return out


def write_interface_table():
    """Emit the archetype summary into planet.interface so docs cannot drift."""
    from system_tables import ARCHETYPES, PLACEMENT
    lines = ['#   archetype        struct energy  ordn   prec  refinery  yMod  mfg  berths  tonnage\n']
    for name in ARCHETYPE_NAMES:
        a = ARCHETYPES[name]
        lines.append('#   %-16s %5d %6d %5d %6d %9d %5.2f %4d %7d %8d\n' % (
            name, a['structural'], a['energy'], a['ordnance'], a['precision'],
            a['refinery'], a['yieldModifier'], a['manufactory'], a['berths'], a['tonnage']))
    lines.append('#\n#   placement by security tier:\n')
    for tier in SECURITY_TIERS:
        lines.append('#     %-10s %s\n' % (tier, ' '.join(sorted(PLACEMENT[tier]))))
    text = open(IFACE).read()
    a, b = text.index(MARK_BEGIN), text.index(MARK_END)
    open(IFACE, 'w').write(text[:a] + MARK_BEGIN + ''.join(lines) + text[b:])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    print('regions       :', len(REGIONS))
    print('systems       :', len(SYSTEMS))
    print('planets       :', len(PLANETS))
    print('gates         :', len(GATES))
    print('belts         :', sum(len(v) for v in BELTS_BY_SYSTEM.values()))
    print('by security   :', dict(Counter(s['securityTier'] for s in SYSTEMS)))
    print('by archetype  :', dict(Counter(p['archetype'] for p in PLANETS)))
    if args.dry_run:
        return

    systems = [system_record(s) for s in SYSTEMS]
    planets = [planet_record(p) for p in PLANETS]

    fleet = json.load(open(FLEET))
    fleet['systems'] = systems
    fleet['planets'] = planets
    fleet['_meta']['systemCount'] = len(systems)
    fleet['_meta']['planetCount'] = len(planets)
    fleet['_meta']['regions'] = REGION_NAMES
    fleet['_meta']['securityTiers'] = SECURITY_TIERS
    fleet['_meta']['planetArchetypes'] = ARCHETYPE_NAMES
    with open(FLEET, 'w') as f:
        json.dump(fleet, f, indent=2); f.write('\n')

    # Systems_Planets/ also holds this feature's hand-written spec and plan docs
    # -- it is not a purely-generated directory. Clear only the six region
    # subtrees and the two generated json files, never the whole directory, so a
    # re-run cannot silently delete those docs.
    for region in REGION_NAMES:
        d = os.path.join(MAP_DIR, dir_name(region))
        if os.path.isdir(d):
            shutil.rmtree(d)
    for stale in ('links.json', 'index.json'):
        p = os.path.join(MAP_DIR, stale)
        if os.path.exists(p):
            os.remove(p)

    by_id = {p['planetId']: p for p in PLANETS}
    index_systems, index_planets = [], []
    for system in systems:
        sdir = os.path.join(dir_name(system['region']), dir_name(system['name']))
        os.makedirs(os.path.join(MAP_DIR, sdir, 'planets'), exist_ok=True)
        rel = os.path.join('Systems_Planets', sdir, 'system.json')
        with open(os.path.join(ROOT, rel), 'w') as f:
            json.dump(system, f, indent=2); f.write('\n')
        index_systems.append({
            'systemId': system['systemId'], 'name': system['name'],
            'region': system['region'], 'constellation': system['constellation'],
            'securityTier': system['securityTier'], 'securityRating': system['securityRating'],
            'planets': len(system['planets']), 'belts': len(system['asteroidBelts']),
            'connections': len(system['connections']),
            'dir': os.path.join('Systems_Planets', sdir), 'path': rel,
        })
        for pid in system['planets']:
            planet = planet_record(by_id[pid])
            prel = os.path.join('Systems_Planets', sdir, 'planets',
                                '%s_%s.json' % (pid, by_id[pid]['slug']))
            with open(os.path.join(ROOT, prel), 'w') as f:
                json.dump(planet, f, indent=2); f.write('\n')
            index_planets.append({
                'planetId': pid, 'name': planet['name'], 'systemId': system['systemId'],
                'archetype': planet['archetype'],
                'richnessTier': planet['richnessTier'],
                'developmentTier': planet['developmentTier'],
                'maxHullTonnage': planet['shipyard']['maxHullTonnage'],
                'path': prel,
            })

    with open(os.path.join(MAP_DIR, 'links.json'), 'w') as f:
        json.dump({'count': len(GATES), 'gates': GATES}, f, indent=2); f.write('\n')
    with open(os.path.join(MAP_DIR, 'index.json'), 'w') as f:
        json.dump({'systemCount': len(index_systems), 'planetCount': len(index_planets),
                   'systems': index_systems, 'planets': index_planets}, f, indent=2)
        f.write('\n')
    write_interface_table()
    print('\nwrote %d systems + %d planets + links.json + index.json'
          % (len(systems), len(planets)))


if __name__ == '__main__':
    main()
```

- [ ] **Step 4: Run it to make sure it passes**

```bash
python3 tools/generate_systems.py --dry-run
python3 tools/generate_systems.py
ls Systems_Planets/
ls "Systems_Planets/Aurelian Reach/Aurelia/"
cat "Systems_Planets/Aurelian Reach/Aurelia/system.json"
```
Expected: 60 systems, 180 planets reported; the six region directories plus `links.json`, `index.json`, and both `.md` docs still present.

Then prove idempotency — the property the whole repo rests on:

```bash
md5 -q fleet_and_weapons.json > /tmp/a.md5
python3 tools/generate_systems.py > /dev/null
md5 -q fleet_and_weapons.json > /tmp/b.md5
diff /tmp/a.md5 /tmp/b.md5 && echo "IDEMPOTENT"
```
Expected: `IDEMPOTENT`

- [ ] **Step 5: Commit**

```bash
git add tools/generate_systems.py Data-Templates/planet.interface Systems_Planets/ fleet_and_weapons.json
git commit -m "feat(systems): generator for 60 systems and 180 planets"
```

---

### Task 6: Verifier — structural and graph checks

**Files:**
- Create: `tools/verify_systems.py`

**Interfaces:**
- Consumes: `fleet_and_weapons.json` (`systems`, `planets`), `Systems_Planets/**`, `Data-Templates/*.interface`, and `system_tables.py` for the legal-value tables.
- Produces: an exit code. Task 7 appends to this same file.

- [ ] **Step 1: Write the failing test**

Write the file with the structural and graph checks. Follow the exact `check(label, bad)` idiom of `tools/verify_resources.py`:

```python
#!/usr/bin/env python3
"""Invariant checks for the generated systems-and-planets map."""
import json, os, sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from system_tables import (ARCHETYPES, ARCHETYPE_NAMES, PLACEMENT, SECURITY_BANDS,
                           SECURITY_TIERS, LANES, tiers_for)

FLEET = json.load(open(os.path.join(ROOT, 'fleet_and_weapons.json')))
S, P = FLEET['systems'], FLEET['planets']
MAP_DIR = os.path.join(ROOT, 'Systems_Planets')
LINKS = json.load(open(os.path.join(MAP_DIR, 'links.json')))
fails = []


def check(label, bad, show=6):
    if bad:
        fails.append(label); print('FAIL %s: %d' % (label, len(bad)))
        for b in bad[:show]: print('      ', b)
    else:
        print('ok   %s' % label)


def schema(name):
    body = '\n'.join(l for l in open(os.path.join(ROOT, 'Data-Templates', name))
                     if not l.lstrip().startswith('#'))
    return set(json.loads(body))


# ---- counts, ids, schemas
check('60 systems', [] if len(S) == 60 else ['%d systems' % len(S)])
check('180 planets', [] if len(P) == 180 else ['%d planets' % len(P)])
check('unique systemIds', [k for k, v in Counter(s['systemId'] for s in S).items() if v > 1])
check('unique system names', [k for k, v in Counter(s['name'] for s in S).items() if v > 1])
check('unique planetIds', [k for k, v in Counter(p['planetId'] for p in P).items() if v > 1])
check('unique planet names', [k for k, v in Counter(p['name'] for p in P).items() if v > 1])
check('systemIds densely numbered',
      [] if {s['systemId'] for s in S} == {'sys_%03d' % i for i in range(1, 61)} else ['gap or stray id'])
check('planetIds densely numbered',
      [] if {p['planetId'] for p in P} == {'pln_%03d' % i for i in range(1, 181)} else ['gap or stray id'])

sys_schema = schema('system.interface')
check('field set matches system.interface', [s['systemId'] for s in S if set(s) != sys_schema])
pl_schema = schema('planet.interface')
check('field set matches planet.interface', [p['planetId'] for p in P if set(p) != pl_schema])

# ---- enums and bands
check('securityTier legal', [s['systemId'] for s in S if s['securityTier'] not in SECURITY_TIERS])
check('archetype legal', [p['planetId'] for p in P if p['archetype'] not in ARCHETYPE_NAMES])
check('securityRating inside its band',
      ['%s: %s not in %s' % (s['name'], s['securityRating'], SECURITY_BANDS[s['securityTier']])
       for s in S if not SECURITY_BANDS[s['securityTier']][0] <= s['securityRating']
       <= SECURITY_BANDS[s['securityTier']][1]])
check('security distribution 11/19/18/12',
      [] if Counter(s['securityTier'] for s in S) ==
      {'core': 11, 'mid': 19, 'rim': 18, 'deadspace': 12} else ['distribution changed'])

# belt lanes must be lanes the live resource catalogue actually has
live_lanes = {r['lane'] for r in FLEET['resources']}
check('belt dominantLane is a live resource lane',
      ['%s: %s' % (b['beltId'], b['dominantLane']) for s in S for b in s['asteroidBelts']
       if b['dominantLane'] not in live_lanes])

# ---- the security inversion (spec 3)
check('richness/development consistent with security',
      ['%s: (%d, %d) != %s' % (s['name'], s['richnessTier'], s['developmentTier'],
                               tiers_for(s['securityTier'], s['securityRating']))
       for s in S if (s['richnessTier'], s['developmentTier'])
       != tiers_for(s['securityTier'], s['securityRating'])])
check('no system is both richest and most developed',
      [s['name'] for s in S if (s['richnessTier'], s['developmentTier']) == (3, 3)])

# ---- planet placement and shape
by_sys = {s['systemId']: s for s in S}
check('planet systemId resolves', [p['planetId'] for p in P if p['systemId'] not in by_sys])
check('planet listed by its system',
      [p['planetId'] for p in P if p['planetId'] not in by_sys[p['systemId']]['planets']])
check('system planets[] all exist',
      ['%s -> %s' % (s['systemId'], pid) for s in S for pid in s['planets']
       if pid not in {p['planetId'] for p in P}])
check('archetype legal for its security tier',
      ['%s: %s in %s' % (p['name'], p['archetype'], by_sys[p['systemId']]['securityTier'])
       for p in P if p['archetype'] not in PLACEMENT[by_sys[p['systemId']]['securityTier']]])
check('yieldModifier <= 1.00 and unscaled',
      ['%s: %s' % (p['name'], p['refinery']['yieldModifier']) for p in P
       if p['refinery']['yieldModifier'] > 1.0
       or p['refinery']['yieldModifier'] != ARCHETYPES[p['archetype']]['yieldModifier']])
check('berths 0 implies an empty yard',
      [p['name'] for p in P if p['shipyard']['berths'] == 0
       and (p['shipyard']['maxHullTonnage'] or p['shipyard']['constructionRatePerTurn'])])

# ---- ladders monotonic
bad = []
for arch in ARCHETYPE_NAMES:
    same = [p for p in P if p['archetype'] == arch]
    for lane in LANES:
        seen = {}
        for p in same:
            seen.setdefault(p['richnessTier'], set()).add(p['extraction'][lane])
        for a in seen:
            for b in seen:
                if a < b and max(seen[a]) > min(seen[b]):
                    bad.append('%s/%s: richness %d out-extracts %d' % (arch, lane, a, b))
    seen = {}
    for p in same:
        seen.setdefault(p['developmentTier'], set()).add(p['manufactory']['throughputPerTurn'])
    for a in seen:
        for b in seen:
            if a < b and max(seen[a]) > min(seen[b]):
                bad.append('%s: development %d out-manufactures %d' % (arch, a, b))
check('richness and development ladders monotonic', bad)

# ---- the gate graph (spec 6.3)
conn = {s['systemId']: s['connections'] for s in S}
check('every toSystemId resolves',
      ['%s -> %s' % (sid, c['toSystemId']) for sid, cs in conn.items() for c in cs
       if c['toSystemId'] not in by_sys])
check('no self-loops', ['%s' % sid for sid, cs in conn.items()
                        if any(c['toSystemId'] == sid for c in cs)])
check('no duplicate connections',
      ['%s' % sid for sid, cs in conn.items()
       if len({c['toSystemId'] for c in cs}) != len(cs)])
check('every system has at least one gate', [sid for sid, cs in conn.items() if not cs])

bad = []
for sid, cs in conn.items():
    for c in cs:
        back = [x for x in conn.get(c['toSystemId'], []) if x['toSystemId'] == sid]
        if len(back) != 1:
            bad.append('%s -> %s: %d return edges' % (sid, c['toSystemId'], len(back)))
        elif back[0]['gateId'] != c['gateId']:
            bad.append('%s <-> %s: gateId disagrees' % (sid, c['toSystemId']))
        elif back[0]['jumpDistanceLy'] != c['jumpDistanceLy']:
            bad.append('%s <-> %s: jumpDistanceLy disagrees' % (sid, c['toSystemId']))
check('connections symmetric, same gateId and distance from both ends', bad)

check('gateId in canonical gate_<lower>_<higher> form',
      [g['gateId'] for g in LINKS['gates']
       if g['a'] >= g['b'] or g['gateId'] != 'gate_%s_%s' % (g['a'], g['b'])])

edges_from_systems = {tuple(sorted([sid, c['toSystemId']])) for sid, cs in conn.items() for c in cs}
edges_from_links = {tuple(sorted([g['a'], g['b']])) for g in LINKS['gates']}
check('links.json matches the union of all connections[]',
      [] if edges_from_systems == edges_from_links
      else ['%d edge(s) differ' % len(edges_from_systems ^ edges_from_links)])

seen, queue = {'sys_001'}, ['sys_001']
while queue:
    cur = queue.pop()
    for c in conn[cur]:
        if c['toSystemId'] not in seen:
            seen.add(c['toSystemId']); queue.append(c['toSystemId'])
check('BFS from sys_001 reaches all 60 systems',
      [] if len(seen) == 60 else ['%d unreachable: %s' % (60 - len(seen),
                                  sorted({s['systemId'] for s in S} - seen)[:5])])

# ---- files on disk
disk_sys, disk_pl = {}, {}
for dp, _, fns in os.walk(MAP_DIR):
    for fn in fns:
        if not fn.endswith('.json') or fn in ('index.json', 'links.json'):
            continue
        o = json.load(open(os.path.join(dp, fn)))
        (disk_sys if fn == 'system.json' else disk_pl)[
            o.get('systemId') if fn == 'system.json' else o['planetId']] = o
check('one file per system', [] if len(disk_sys) == 60 else ['%d system files' % len(disk_sys)])
check('one file per planet', [] if len(disk_pl) == 180 else ['%d planet files' % len(disk_pl)])
check('system file content == fleet json', [s['systemId'] for s in S if disk_sys.get(s['systemId']) != s])
check('planet file content == fleet json', [p['planetId'] for p in P if disk_pl.get(p['planetId']) != p])

check('hand-written spec survived the run',
      [] if os.path.exists(os.path.join(MAP_DIR, 'systems_planets_specification.md'))
      else ['systems_planets_specification.md was deleted by a generator run'])
check('hand-written plan survived the run',
      [] if os.path.exists(os.path.join(MAP_DIR, 'systems_planets_implementation_plan.md'))
      else ['systems_planets_implementation_plan.md was deleted by a generator run'])

print('\n' + ('ALL CHECKS PASSED' if not fails else '%d CHECK(S) FAILED' % len(fails)))
sys.exit(1 if fails else 0)
```

- [ ] **Step 2: Run it to make sure it fails**

First prove the checks bite. Temporarily break one planet in the fleet json:

```bash
python3 -c "
import json
p = 'fleet_and_weapons.json'
d = json.load(open(p))
d['planets'][0]['refinery']['yieldModifier'] = 1.4
json.dump(d, open(p, 'w'), indent=2); open(p, 'a').write('\n')
"
python3 tools/verify_systems.py
```
Expected: `FAIL yieldModifier <= 1.00 and unscaled: 1`, `FAIL planet file content == fleet json: 1`, and a non-zero exit.

- [ ] **Step 3: Restore the data**

```bash
python3 tools/generate_systems.py
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `python3 tools/verify_systems.py`
Expected: every line `ok`, ending `ALL CHECKS PASSED`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add tools/verify_systems.py
git commit -m "feat(systems): verifier for structure, placement and the gate graph"
```

---

### Task 7: Verifier — the two cross-catalogue invariants

**Files:**
- Modify: `tools/verify_systems.py` (insert before the final `print`/`sys.exit` block)

**Interfaces:**
- Consumes: `FLEET['resources']`, `FLEET['skills']`, `FLEET['ships']`, `FLEET['namedShips']` — all already loaded at the top of the file.
- Produces: nothing new; extends the same exit code.

These are the checks that matter most. They break from the *outside* — someone edits the skill catalogue or the resource yields and this map silently becomes invalid. Neither may hardcode a number that lives in another catalogue.

- [ ] **Step 1: Write the failing test**

Insert before the final `print('\n' + ...)` line:

```python
# ---- spec 6.1: refining can never become lossless.
# effectiveYield = lane.conversionYield x planet.yieldModifier x skillMultiplier.
# Every one of the three is read LIVE -- nothing here is hardcoded, so raising
# the skill, a lane yield or a yieldModifier fails the build instead of quietly
# producing a lane that refines without loss.
refine_skill = [s for s in FLEET['skills'] if s['skillId'] == 'skl_sta_refinement']
check('Material Refinement Management still exists',
      [] if refine_skill else ['skl_sta_refinement missing -- 6.1 cannot be checked'])

if refine_skill:
    eff = [e for e in refine_skill[0]['effects'] if e['stat'] == 'refineryYield']
    check('the refinement skill still targets refineryYield',
          [] if eff else ['no refineryYield effect on skl_sta_refinement'])
    if eff:
        per_level = eff[0]['modifierPerLevel']
        max_level = refine_skill[0]['maxLevel']
        applies_from = eff[0].get('appliesFromLevel', 1)
        steps = max(0, max_level - applies_from + 1)
        skill_mult = 1 + (per_level * steps) / 100.0
        lane_yield = {r['lane']: r['conversionYield'] for r in FLEET['resources']
                      if r['tier'] == 'refined'}
        bad = []
        for p in P:
            ymod = p['refinery']['yieldModifier']
            for lane, ly in lane_yield.items():
                effective = ly * ymod * skill_mult
                if effective >= 1.0:
                    bad.append('%s %s: %.2f x %.2f x %.2f = %.4f >= 1'
                               % (p['name'], lane, ly, ymod, skill_mult, effective))
        check('refining stays lossy: lane x planet x skill < 1 for every combination', bad)
        print('     (worst case %.4f, margin %.4f)'
              % (max(lane_yield.values()) * max(p['refinery']['yieldModifier'] for p in P)
                 * skill_mult,
                 1 - max(lane_yield.values()) * max(p['refinery']['yieldModifier'] for p in P)
                 * skill_mult))

# ---- spec 6.2: every hull has somewhere to be built.
# maxHullTonnage means nothing unless it is checked against hulls that exist.
yards = [p for p in P if p['shipyard']['berths'] > 0]
best_yard = max((p['shipyard']['maxHullTonnage'] for p in yards), default=0)
heaviest = max(s['mass']['value'] for s in FLEET['ships'] + FLEET['namedShips'])
check('some yard can build the heaviest hull in the game',
      [] if best_yard >= heaviest
      else ['heaviest hull %.0f t, best yard %.0f t' % (heaviest, best_yard)])

bad = []
for cls in {s['shipClass'] for s in FLEET['ships']}:
    need = max(s['mass']['value'] for s in FLEET['ships'] if s['shipClass'] == cls)
    if best_yard < need:
        bad.append('%s needs %.0f t, best yard %.0f t' % (cls, need, best_yard))
check('every ship category is buildable somewhere', bad)

# capital hulls should come only from developed core/mid forge worlds -- a
# consequence of the tables, so assert it rather than trusting it
capital_yards = [p for p in yards if p['shipyard']['maxHullTonnage'] >= heaviest]
check('capital yards exist and are all forge worlds',
      [] if capital_yards and all(p['archetype'] == 'forge_world' for p in capital_yards)
      else ['%d capital yards, archetypes %s'
            % (len(capital_yards), sorted({p['archetype'] for p in capital_yards}))])
check('capital yards sit in core or mid security',
      [p['name'] for p in capital_yards
       if by_sys[p['systemId']]['securityTier'] not in ('core', 'mid')])

# ---- spec 6.2 supporting: the precision lane is the bottleneck it is meant to be
fab = {r['lane']: r['conversionYield'] for r in FLEET['resources'] if r['tier'] == 'manufactured'}
ref = {r['lane']: r['conversionYield'] for r in FLEET['resources'] if r['tier'] == 'refined'}
raw_per_unit = {lane: 1.0 / fab[lane] / ref[lane] for lane in ref}
check('precision is the most raw-hungry lane',
      [] if raw_per_unit['precision'] == max(raw_per_unit.values())
      else ['precision %.2f is not the max %s' % (raw_per_unit['precision'], raw_per_unit)])
```

- [ ] **Step 2: Run it to make sure it fails**

Prove the §6.1 check is live, not decorative, by raising the skill in the fleet json:

```bash
python3 -c "
import json
p = 'fleet_and_weapons.json'
d = json.load(open(p))
for s in d['skills']:
    if s['skillId'] == 'skl_sta_refinement':
        s['effects'][0]['modifierPerLevel'] = 2.0
json.dump(d, open(p, 'w'), indent=2); open(p, 'a').write('\n')
"
python3 tools/verify_systems.py
```
Expected: `FAIL refining stays lossy...` listing the structural-lane combinations that reach or exceed 1.0 (0.90 × 1.00 × 1.20 = 1.08), and a non-zero exit. **This is the whole point of the check** — a change made in a different catalogue breaks this build.

- [ ] **Step 3: Restore the skill catalogue**

Restore from the byte-exact backup you took before the corruption — do NOT run
`generate_skills.py`. That generator belongs to a different work stream, and running it
would add a second read-modify-write cycle on a 1.1 MB file a concurrent session is
actively writing. The backup restores the same bytes with none of that risk.

```bash
cp /tmp/fleet_backup_task7.json fleet_and_weapons.json
git diff --stat fleet_and_weapons.json    # must report NO changes
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `python3 tools/verify_systems.py`
Expected: `ALL CHECKS PASSED`, and the margin line reading `(worst case 0.9900, margin 0.0100)`.

- [ ] **Step 5: Commit**

```bash
git add tools/verify_systems.py
git commit -m "feat(systems): cross-catalogue checks for refining yield and shipyard tonnage"
```

---

### Task 8: TypeScript reference types

**Files:**
- Create: `Reference/systems.ts`
- Modify: `Reference/dataset.ts` (imports, `FleetMeta`, `FleetDataset`, path shapes, re-exports, `CatalogueIndexes`)
- Modify: `Reference/index.ts` (re-export the new module)
- Modify: `Reference/verify_reference.py` (add the union and field-set checks)

**Interfaces:**
- Consumes: the JSON shapes from Tasks 5–7.
- Produces: `System`, `Planet`, `PlanetArchetype`, `SecurityTier`, `RegionName`, `AsteroidBelt`, `SystemConnection`, `Gate`, `SystemIndexEntry`, `PlanetIndexEntry`, `SystemIndex`, `LinksFile`.

- [ ] **Step 1: Write the failing test**

Add to `Reference/verify_reference.py`, before its final summary block. Use the existing `union()` and `fields()` helpers already defined at the top of that file:

```python
# ---- systems & planets
SYSTEMS_DATA, PLANETS_DATA = FLEET['systems'], FLEET['planets']

check('SecurityTier union matches the data',
      union('systems.ts', 'SecurityTier'),
      {s['securityTier'] for s in SYSTEMS_DATA})
check('RegionName union matches the data',
      union('systems.ts', 'RegionName'),
      {s['region'] for s in SYSTEMS_DATA})
check('PlanetArchetype union matches the data',
      union('systems.ts', 'PlanetArchetype'),
      {p['archetype'] for p in PLANETS_DATA})
check('SpectralClass union matches the data',
      union('systems.ts', 'SpectralClass'),
      {s['star']['spectralClass'] for s in SYSTEMS_DATA})
check('System interface declares the right fields',
      fields('systems.ts', 'System'), set(SYSTEMS_DATA[0]))
check('Planet interface declares the right fields',
      fields('systems.ts', 'Planet'), set(PLANETS_DATA[0]))
check('AsteroidBelt interface declares the right fields',
      fields('systems.ts', 'AsteroidBelt'),
      set(next(b for s in SYSTEMS_DATA for b in s['asteroidBelts'])))
check('SystemConnection interface declares the right fields',
      fields('systems.ts', 'SystemConnection'), set(SYSTEMS_DATA[0]['connections'][0]))
```

`check()` is already defined in `verify_reference.py:49` as
`check(label, declared, actual, schema_only=())` — `declared` is what the TypeScript says,
`actual` is what the data has. The calls above are in that order; do not reorder them.

- [ ] **Step 2: Run it to make sure it fails**

Run: `python3 Reference/verify_reference.py`
Expected: `union SecurityTier not found in Reference/systems.ts` (the script `sys.exit`s on a missing file).

- [ ] **Step 3: Write `Reference/systems.ts`**

```typescript
/**
 * systems.ts — the map layer: 60 star systems joined by jump gates, and the 180
 * planets inside them.
 *
 * Derived from: Data-Templates/system.interface, Data-Templates/planet.interface,
 *               Systems_Planets/*, tools/system_tables.py,
 *               fleet_and_weapons.json -> "systems", "planets"
 *
 * Two 1–3 ladders drive every number, and they point in opposite directions:
 * `richnessTier` rises as security FALLS and scales extraction, `developmentTier`
 * rises as security RISES and scales industry. Neither end of the map is
 * self-sufficient, which is what gives the gate graph a purpose.
 *
 * A planet is the BASE that a station-management skill multiplies — those skills
 * are pure percentages with no base of their own. See `skills.ts`.
 */

import type { ResourceLane } from './resources';

export type SecurityTier = 'core' | 'mid' | 'rim' | 'deadspace';

export type RegionName =
  | 'Aurelian Reach'
  | 'Kestrel Span'
  | 'Cindral Verge'
  | 'Tannhau Drift'
  | 'Obsidian Marches'
  | 'The Pale Hollow';

export type PlanetArchetype =
  | 'ferrous_barren'
  | 'crystalline'
  | 'gas_giant'
  | 'volcanic'
  | 'irradiated'
  | 'ice'
  | 'oceanic'
  | 'shattered'
  | 'hive_world'
  | 'forge_world';

export type SpectralClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M';

/** 1 = poorest/least developed, 3 = richest/most developed. */
export type MapTier = 1 | 2 | 3;

export type SystemId = `sys_${string}`;
export type PlanetId = `pln_${string}`;
export type BeltId = `bel_${string}`;
/** Always `gate_<lowerSystemId>_<higherSystemId>`, whichever end you approach from. */
export type GateId = `gate_${string}`;

export interface Coordinates {
  /** Light years. */
  x: number;
  y: number;
  z: number;
}

export interface Star {
  spectralClass: SpectralClass;
  /** Sol = 1.0. Flavour: no mechanic reads it. */
  luminosity: number;
}

/** The Deep Space Mining domain's target — a system-level feature, not a planet one. */
export interface AsteroidBelt {
  beltId: BeltId;
  name: string;
  dominantLane: ResourceLane;
  richnessTier: MapTier;
  /** Raw units of `dominantLane` per completed mining cycle. */
  yieldPerCycle: number;
  cycleTurns: number;
}

/**
 * One end of a gate. Both endpoints carry the same `gateId`, `gateName` and
 * `jumpDistanceLy` — the edge is stored once in `links.json` and denormalised
 * into each system, with a verifier check proving the copies agree.
 */
export interface SystemConnection {
  toSystemId: SystemId;
  gateId: GateId;
  gateName: string;
  /** Euclidean distance between the two systems' coordinates. */
  jumpDistanceLy: number;
  crossesConstellation: boolean;
  crossesRegion: boolean;
}

export interface System {
  systemId: SystemId;
  name: string;
  region: RegionName;
  constellation: string;
  securityTier: SecurityTier;
  /** Finer ordering inside the tier's band: core 0.80–1.00 … deadspace 0.00–0.10. */
  securityRating: number;
  star: Star;
  coordinates: Coordinates;
  /** Scales planetary extraction. Rises as security falls. */
  richnessTier: MapTier;
  /** Scales industry. Rises as security rises. */
  developmentTier: MapTier;
  planets: PlanetId[];
  asteroidBelts: AsteroidBelt[];
  connections: SystemConnection[];
}

/** Raw units per turn, one entry per resource lane. */
export type ExtractionRates = Record<ResourceLane, number>;

export interface PlanetRefinery {
  /** Raw units consumed per turn. Scales with `developmentTier`. */
  throughputPerTurn: number;
  /**
   * Multiplies the lane's `conversionYield`. Capped at 1.00 and scaled by
   * NEITHER ladder: effective yield is `lane × this × skill`, and the resource
   * model requires it to stay below 1. Worst case 0.90 × 1.00 × 1.10 = 0.99.
   */
  yieldModifier: number;
}

export interface PlanetShipyard {
  berths: number;
  /** Tons. 0 when `berths` is 0. Only a developed forge world clears 65,100 t. */
  maxHullTonnage: number;
  /** Manufactured units absorbed per turn. */
  constructionRatePerTurn: number;
}

export interface Planet {
  planetId: PlanetId;
  name: string;
  systemId: SystemId;
  archetype: PlanetArchetype;
  /** Position from the star, 1-based. */
  orbitIndex: number;
  richnessTier: MapTier;
  developmentTier: MapTier;
  extraction: ExtractionRates;
  refinery: PlanetRefinery;
  manufactory: { throughputPerTurn: number };
  shipyard: PlanetShipyard;
  /** Units — equal to tons, since every resource is `unitMass: 1.0`. */
  warehouse: { capacity: number };
}

// ---------------------------------------------------------------- on-disk shapes

/** One row of `Systems_Planets/links.json` — the canonical edge, stored once. */
export interface Gate {
  gateId: GateId;
  gateName: string;
  /** Always the lexicographically lower systemId. */
  a: SystemId;
  /** Always the higher. */
  b: SystemId;
  jumpDistanceLy: number;
  crossesConstellation: boolean;
  crossesRegion: boolean;
}

export interface LinksFile {
  count: number;
  gates: Gate[];
}

export interface SystemIndexEntry {
  systemId: SystemId;
  name: string;
  region: RegionName;
  constellation: string;
  securityTier: SecurityTier;
  securityRating: number;
  planets: number;
  belts: number;
  connections: number;
  dir: string;
  path: string;
}

export interface PlanetIndexEntry {
  planetId: PlanetId;
  name: string;
  systemId: SystemId;
  archetype: PlanetArchetype;
  richnessTier: MapTier;
  developmentTier: MapTier;
  maxHullTonnage: number;
  path: string;
}

export interface SystemIndex {
  systemCount: number;
  planetCount: number;
  systems: SystemIndexEntry[];
  planets: PlanetIndexEntry[];
}

/** `Systems_Planets/<Region>/<System>/system.json`. */
export type SystemPath = `Systems_Planets/${string}/${string}/system.json`;
/** `Systems_Planets/<Region>/<System>/planets/<planetId>_<slug>.json`. */
export type PlanetPath = `Systems_Planets/${string}/${string}/planets/${string}.json`;
```

- [ ] **Step 4: Wire it into `dataset.ts` and `index.ts`**

In `Reference/dataset.ts`:

1. Add the import beside the others:
```typescript
import type { System, Planet, RegionName, SecurityTier, PlanetArchetype,
              SystemIndex, SystemIndexEntry, PlanetIndexEntry } from './systems';
```
2. Add to `FleetMeta`:
```typescript
  systemCount: number;
  planetCount: number;
  regions: RegionName[];
  securityTiers: SecurityTier[];
  planetArchetypes: PlanetArchetype[];
```
3. Add to `FleetDataset`:
```typescript
  /** 60 star systems; `connections[]` is denormalised from one canonical edge list. */
  systems: System[];
  /** 180 planets — the bases the station-management skills multiply. */
  planets: Planet[];
```
4. Add to the re-export line and to `CatalogueIndexes`:
```typescript
export type { SystemIndexEntry, PlanetIndexEntry };
export type { SystemIndex, LinksFile } from './systems';
```
```typescript
  systemsAndPlanets: import('./systems').SystemIndex;
```
5. Add the path shapes beside the others:
```typescript
export type { SystemPath, PlanetPath } from './systems';
```

In `Reference/index.ts`:

- add `systems.ts    60 systems, 180 planets, and the jump-gate graph` to the module list
  in the header comment, after the `skills.ts` line;
- add `export * from './systems';` after `export * from './skills';`, before `'./combat'`.

Re-exporting `SystemPath` from both `dataset.ts` and `index.ts` is safe and matches what
the file already does with `WeaponIndexEntry`: both paths resolve to the same declaration
in `systems.ts`, so `export *` sees one symbol, not an ambiguous pair.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
python3 Reference/verify_reference.py
npx tsc --noEmit --strict Reference/index.ts
```
Expected: all reference checks `ok`, and `tsc` clean. If `tsc` is unavailable, run `npx -y typescript@5 tsc --noEmit --strict Reference/index.ts`.

- [ ] **Step 6: Commit**

```bash
git add Reference/systems.ts Reference/dataset.ts Reference/index.ts Reference/verify_reference.py
git commit -m "feat(systems): TypeScript reference types for systems and planets"
```

---

### Task 9: README

**Files:**
- Modify: `README.md` (intro, contents table, layout block, fleet-json key table, a new catalogue section, regenerate and verification blocks, "where to make changes", notes)
- Modify: `Reference/README.md` (add `systems.ts` to its module list)

**Interfaces:**
- Consumes: the verified counts from Tasks 5–8.
- Produces: documentation. Every number in it must come from a command actually run, not from this plan.

- [ ] **Step 1: Collect the real numbers**

Never copy counts from this plan into the README — re-read them from the data:

```bash
python3 tools/generate_systems.py --dry-run
find Systems_Planets -type f | wc -l
python3 -c "
import json; d = json.load(open('fleet_and_weapons.json'))
print('systems', len(d['systems']), 'planets', len(d['planets']))
print('gates', json.load(open('Systems_Planets/links.json'))['count'])
print('belts', sum(len(s['asteroidBelts']) for s in d['systems']))
"
python3 tools/verify_systems.py | tail -1
python3 tools/verify_systems.py | grep -c '^ok'
```

- [ ] **Step 2: Update the six README locations**

1. **Intro paragraph** — add `Systems_Planets/` to the generated list and `systems` / `planets` to the arrays named.
2. **Contents table** — add two rows and update `Files on disk`:
```markdown
| Systems | 60 | 6 regions × 16 constellations; a verified jump-gate graph |
| Planets | 180 | 10 archetypes × richness 1–3 × development 1–3 |
```
3. **Layout block** — add:
```
Systems_Planets/<Region>/<System>/
  system.json                star, security, belts, connections
  planets/pln_###_<slug>.json
  links.json                 every gate once, canonical
  index.json
  systems_planets_specification.md        hand-written, survives a run
  systems_planets_implementation_plan.md  hand-written, survives a run
```
and add `system.interface` / `planet.interface` to the `Data-Templates/` list and `systems.ts` to the `Reference/` list.
4. **Keys table** — add `systems` and `planets` rows.
5. **New section**, after the Skills section. Retitle "The five catalogues" to "The six catalogues" and write:

````markdown
### Systems & Planets — `archetype × richnessTier × developmentTier`

The map: 60 systems in 6 regions, joined by a gate graph, holding 180 planets.
`Systems_Planets/systems_planets_specification.md` is the hand-written spec.

Two 1–3 ladders drive every number, and **they point in opposite directions**:

```
richnessTier      rises as security FALLS    scales EXTRACTION
developmentTier   rises as security RISES    scales INDUSTRY
```

| security | systems | richness | development |
|---|---|---|---|
| `core` | 11 | 1 | 3 |
| `mid` | 19 | 1–2 | 2 |
| `rim` | 18 | 2–3 | 1–2 |
| `deadspace` | 12 | 3 | 1 |

The ore is where it will get you killed; the factories are where it is safe. Neither
end is self-sufficient, so material has to move — which is the point of having a graph.
`irradiated` and `shattered` worlds, the only strong precision-lane sources, exist only
in `rim` and `deadspace`; `forge_world`, the only capital yard, only in `core` and `mid`.

A planet exists because the **station-management skills are pure percentage multipliers
with no base of their own**. This catalogue supplies the bases:

| planet field | multiplied by |
|---|---|
| `extraction` | `planetaryProductionRate` |
| `warehouse.capacity` | `warehouseCapacity` |
| `refinery` | `refineryYield` |
| `manufactory` | `manufacturingRate` |
| `shipyard` | `shipConstructionRate` |
| system `asteroidBelts` | `miningYield`, `miningCycleSpeed` |

Two invariants are enforced against other catalogues rather than assumed:

* **Refining can never become lossless.** Effective yield is
  `lane.conversionYield × planet.yieldModifier × skillMultiplier`, and
  `resource.interface` requires it below 1. Worst case `0.90 × 1.00 × 1.10 = 0.99` — a
  margin of 0.01, which is why `yieldModifier` caps at 1.00 and scales with neither
  ladder. The verifier reads all three numbers live, so raising the skill, a lane yield
  or a modifier fails the build.
* **Every hull has somewhere to be built.** `maxHullTonnage` is checked against real
  ship masses: a forge world at development 3 reaches 81,600 t, clearing the 65,100 t
  Battleship Tier 3. A hive world tops out at 38,400 t, so capital hulls come only from
  developed core-space forge worlds — a consequence of the tables, asserted rather than
  trusted.

The graph is proved navigable, not assumed: symmetric, loop-free, duplicate-free, and
fully connected — every system reachable from `sys_001`.
````

6. **Regenerate / Verification / Where to make changes** — add:
```sh
python3 tools/generate_systems.py    # 60 systems + 180 planets → Systems_Planets/, fleet json
```
```sh
python3 tools/verify_systems.py      # N checks   <- use the real count from Step 1
```
| to change | edit |
|---|---|
| regions, systems, gates, planet archetypes | `tools/system_tables.py` |

Also extend the "Never hand-edit" paragraph: `Systems_Planets/` is a third partial
exception, regenerating only the six region directories, `links.json` and `index.json`,
and leaving its two hand-written `.md` docs alone.

- [ ] **Step 3: Verify the README's claims are true**

Every assertion in the new section must hold. Check the three numeric ones:

```bash
python3 -c "
import json; d = json.load(open('fleet_and_weapons.json'))
from collections import Counter
print('security:', dict(Counter(s['securityTier'] for s in d['systems'])))
forge = [p for p in d['planets'] if p['archetype'] == 'forge_world']
hive  = [p for p in d['planets'] if p['archetype'] == 'hive_world']
print('best forge yard:', max(p['shipyard']['maxHullTonnage'] for p in forge))
print('best hive yard :', max(p['shipyard']['maxHullTonnage'] for p in hive))
print('heaviest hull  :', max(s['mass']['value'] for s in d['ships'] + d['namedShips']))
"
```
Expected: `{'core': 11, 'mid': 19, 'rim': 18, 'deadspace': 12}`, `81600`, `38400`, `65100.0` — matching the README text exactly. Fix the README if any differs.

- [ ] **Step 4: Run the full suite**

```bash
python3 tools/verify_resources.py && python3 tools/verify_weapons.py && \
python3 tools/verify_modules.py && python3 tools/verify_ships.py && \
python3 tools/verify_skills.py && python3 tools/verify_systems.py && \
python3 Reference/verify_reference.py && echo "FULL SUITE GREEN"
```
Expected: `FULL SUITE GREEN`. The new catalogue must not have broken any existing check.

- [ ] **Step 5: Commit**

```bash
git add README.md Reference/README.md
git commit -m "docs: document the systems-and-planets catalogue"
```

---

## Done when

- `python3 tools/generate_systems.py` twice in a row leaves `fleet_and_weapons.json` byte-identical
- `python3 tools/verify_systems.py` exits 0 with every check `ok`
- the full seven-verifier suite is green
- `npx tsc --noEmit --strict Reference/index.ts` is clean
- both hand-written `.md` files in `Systems_Planets/` survive a generator run
