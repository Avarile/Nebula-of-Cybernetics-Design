# Resource Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the resource-tier bill-of-materials system into the existing deterministic generator pipeline, so every weapon, module, and ship in `fleet_and_weapons.json` carries a real, formula-derived `buildCost`.

**Architecture:** A new pure-logic module (`tools/resource_costs.py`) holds the 12-resource catalogue and the cost formulas as the single source of truth. A new generator/verifier pair (`generate_resources.py` / `verify_resources.py`) produces the `Resources/` catalogue. The three existing generators (`generate_weapons.py`, `generate_modules.py`, `generate_ships.py`) each import from `resource_costs.py` and attach a `buildCost` field as a post-processing step, matching how they already attach other computed fields. Ships sum the *already-computed* `buildCost` of their fitted weapons/modules rather than re-deriving it — the same pattern the existing power-budget check already uses for `powerCost`.

**Tech Stack:** Python 3 (stdlib only — `json`, `os`, `re`, `sys`, `argparse`, `collections`), no external dependencies, matching every existing script in `tools/`.

**Spec:** `Resources/resource_tiers_specification.md` — this plan implements it as written, with two implementation-level decisions not covered by the spec (both called out inline where they occur): the `ANCHOR` size-scale reuse is a value-level mirror rather than a live import (avoids a circular import), and ships compute their fitted-item cost by summing already-computed `buildCost` fields rather than recomputing weapon/module formulas.

## Global Constraints

- No RNG anywhere — every value is a pure function of a table entry, per the project's existing rule (README.md, top).
- Never hand-edit files under `Resources/`, `Weapons/`, `Modules/`, or `Ships/` — generators own them.
- Run order is fixed: `generate_resources.py` → `generate_weapons.py` → `generate_modules.py` → `generate_ships.py` (ships sum weapon/module `buildCost`, so those must exist first).
- Every generated JSON entry's field set must exactly match its `.interface` schema (`verify_*.py`'s "field set matches X.interface" check enforces this) — any new field on a catalogue entry requires the matching `.interface` schema line in the same task.
- Constants (`K_*`, yields) must exactly reproduce the worked-example numbers already approved in the spec (§3.1 `wpn_092`, §3.3 *Whisperfang* bare hull) — this is the regression check that catches a transcription mistake between spec and code.

---

### Task 1: `tools/resource_costs.py` — resource catalogue and cost formulas

**Files:**
- Create: `tools/resource_costs.py`

**Interfaces:**
- Produces: `RESOURCES` (list of 12 dicts, the resource.interface-shaped catalogue), `LANES` (`['structural','energy','ordnance','precision']`), `REFINE_YIELD` (dict lane→float), `FABRICATION_YIELD` (float), `weapon_build_cost(w: dict) -> dict`, `module_build_cost(m: dict) -> dict`, `ship_hull_build_cost(mass_value, hull_max_hp, power_max_power, bridge_max_hp, sensor_max_hp) -> dict`, `add_costs(*costs: dict) -> dict`, `expand_to_refined(mfg_cost: dict) -> dict`, `expand_to_raw(mfg_cost: dict) -> dict`.

- [ ] **Step 1: Write the module**

```python
#!/usr/bin/env python3
"""Resource-tier bill-of-materials: catalogue and cost formulas.

Implements Resources/resource_tiers_specification.md. This module has no
dependency on generate_weapons.py / generate_modules.py / generate_ships.py --
each of those imports FROM here, never the reverse, so there is no import
cycle. Every weapon/module/ship generator attaches a buildCost by calling
into this module as a post-processing step; ships then sum the buildCost
their fitted weapons/modules already carry rather than re-deriving it.
"""

LANES = ['structural', 'energy', 'ordnance', 'precision']
TIERS = ['raw', 'refined', 'manufactured']

# Raw -> refined yield varies by lane (the material itself); refined -> manufactured
# yield is uniform (factory efficiency doesn't depend on the input material). See
# spec section 1. Rare Isotopes' low yield is what makes the precision lane the
# deliberate "expensive" one -- it needs the most raw material per finished unit.
REFINE_YIELD = {'structural': 0.90, 'energy': 0.80, 'ordnance': 0.75, 'precision': 0.50}
FABRICATION_YIELD = 0.85

RAW = {
    'structural': ('res_raw_ferrite', 'Ferrite Ore',
                   'Bulk ferrous/silicate ore -- the base structural feedstock for hull plating and weapon housings.'),
    'energy':     ('res_raw_conductive', 'Conductive Crystal',
                   'Naturally-grown crystal lattice with high charge capacity -- the base feedstock for power systems.'),
    'ordnance':   ('res_raw_volatile', 'Volatile Compound',
                   'Reactive chemical feedstock for propellant and warhead fill -- unstable in raw form.'),
    'precision':  ('res_raw_isotopes', 'Rare Isotopes',
                   'Scarce isotopic ore, the feedstock for precision electronics -- refines poorly, which is the point.'),
}
REFINED = {
    'structural': ('res_refined_structural_alloy', 'Structural Alloy',
                   'Smelted and tempered ferrite, ready for fabrication into hull sections and weapon housings.'),
    'energy':     ('res_refined_energy_matrix', 'Energy Cell Matrix',
                   'Processed conductive crystal formed into a stable charge-storage lattice.'),
    'ordnance':   ('res_refined_warhead_compound', 'Warhead Compound',
                   'Stabilised volatile compound, safe to fabricate into ordnance and propellant charges.'),
    'precision':  ('res_refined_precision_circuitry', 'Precision Circuitry',
                   'Etched isotopic substrate used in guidance, targeting, and sensor electronics.'),
}
MANUFACTURED = {
    'structural': ('res_mfg_structural_component', 'Structural Component',
                   'Finished structural part -- hull sections, weapon mounts, module housings.'),
    'energy':     ('res_mfg_power_core', 'Power Core Unit',
                   'Finished power-delivery unit -- reactor cells, capacitor banks, drive cores.'),
    'ordnance':   ('res_mfg_ordnance_charge', 'Ordnance Charge',
                   'Finished warhead/propellant charge, ready to load.'),
    'precision':  ('res_mfg_guidance_assembly', 'Guidance Assembly',
                   'Finished precision electronics package -- targeting, guidance, sensor subassemblies.'),
}


def _resource_rows():
    rows = []
    for lane in LANES:
        rid, name, desc = RAW[lane]
        rows.append(dict(resourceId=rid, name=name, tier='raw', lane=lane,
                          refinesFrom=None, refinesInto=REFINED[lane][0],
                          conversionYield=None, unitMass=1.0, description=desc))
        rid, name, desc = REFINED[lane]
        rows.append(dict(resourceId=rid, name=name, tier='refined', lane=lane,
                          refinesFrom=RAW[lane][0], refinesInto=MANUFACTURED[lane][0],
                          conversionYield=REFINE_YIELD[lane], unitMass=1.0, description=desc))
        rid, name, desc = MANUFACTURED[lane]
        rows.append(dict(resourceId=rid, name=name, tier='manufactured', lane=lane,
                          refinesFrom=REFINED[lane][0], refinesInto=None,
                          conversionYield=FABRICATION_YIELD, unitMass=1.0, description=desc))
    return rows


RESOURCES = _resource_rows()


def _round_cost(d):
    return {lane: round(d[lane], 2) for lane in LANES}


def add_costs(*costs):
    return _round_cost({lane: sum(c[lane] for c in costs) for lane in LANES})


def expand_to_refined(mfg_cost):
    return _round_cost({lane: mfg_cost[lane] / FABRICATION_YIELD for lane in LANES})


def expand_to_raw(mfg_cost):
    refined = expand_to_refined(mfg_cost)
    return _round_cost({lane: refined[lane] / REFINE_YIELD[lane] for lane in LANES})


# --------------------------------------------------------------- weapon cost
# Mirrors generate_weapons.py's ANCHOR[size]['dmg'] as the structural-scale proxy
# (spec section 3.1). Kept as a value-level copy rather than `from generate_weapons
# import ANCHOR`: generate_weapons.py in turn imports weapon_build_cost from this
# module, and a live import in both directions would be circular. The anchor table
# is a stable, rarely-touched constant, so the duplication risk is low; if ANCHOR
# in generate_weapons.py ever changes, update STRUCT_SIZE_SCALE to match.
STRUCT_SIZE_SCALE = {'small': 20.0, 'medium': 44.0, 'large': 95.0, 'capital': 190.0}

K_STRUCT, K_ENERGY, K_ORD, K_PREC, K_CRIT_PREC = 0.05, 0.15, 0.04, 0.05, 5.0

ORDNANCE_SHARE = {'missile': 0.70, 'mine': 0.75, 'kinetic': 0.35, 'melee': 0.10, 'energy': 0.05}


def weapon_build_cost(w):
    structural = STRUCT_SIZE_SCALE[w['size']] * K_STRUCT
    energy = w['powerCost'] * K_ENERGY
    ordnance = w['damage']['base'] * ORDNANCE_SHARE[w['weaponClass']] * K_ORD
    precision = w['accuracy']['tracking'] * K_PREC + w['criticalChance'] * K_CRIT_PREC
    return _round_cost(dict(structural=structural, energy=energy, ordnance=ordnance, precision=precision))


# --------------------------------------------------------------- module cost
K_MOD_STRUCT, K_MOD_ENERGY, K_MOD_PREC, K_MOD_ORD = 0.05, 0.15, 0.15, 0.02

# Effect stats that represent precision/electronics work vs. physical ordnance
# capacity, for modules (which have no damage field to derive ordnance from).
PRECISION_STATS = {'weaponAccuracy', 'detectionRange', 'criticalChanceBonus',
                    'sensorArray.effectiveness', 'initiative', 'crew.gunnerySkill',
                    'pointDefenseBonus', 'enemyHitChance', 'crew.pilotSkill'}
ORDNANCE_STATS = {'ammoCapacity', 'mineCapacity'}


def module_build_cost(m):
    structural = m['mass']['value'] * K_MOD_STRUCT
    energy = m['powerCost'] * K_MOD_ENERGY
    precision = sum(abs(e['modifier']) for e in m['effects']
                     if e['stat'] in PRECISION_STATS) * K_MOD_PREC
    ordnance = sum(abs(e['modifier']) for e in m['effects']
                    if e['stat'] in ORDNANCE_STATS) * K_MOD_ORD
    return _round_cost(dict(structural=structural, energy=energy, ordnance=ordnance, precision=precision))


# ----------------------------------------------------------- ship hull cost
# Bare-hull cost only -- a ship's total buildCost is this plus the buildCost its
# fitted weapons/modules already carry, summed by the caller (see
# generate_ships.py). Takes scalars rather than a ship dict so it can be called
# before a full ship dict exists (generate_ships.py builds componentHitpoints
# as a separate local before assembling the returned dict).
K_HULL_STRUCT, K_HULL_HP, K_HULL_ENERGY, K_HULL_PREC = 0.02, 0.03, 0.10, 0.05


def ship_hull_build_cost(mass_value, hull_max_hp, power_max_power, bridge_max_hp, sensor_max_hp):
    structural = mass_value * K_HULL_STRUCT + hull_max_hp * K_HULL_HP
    energy = power_max_power * K_HULL_ENERGY
    precision = (bridge_max_hp + sensor_max_hp) * K_HULL_PREC
    return _round_cost(dict(structural=structural, energy=energy, ordnance=0.0, precision=precision))
```

- [ ] **Step 2: Sanity-check against the spec's own worked examples**

Run:
```bash
python3 -c "
import sys; sys.path.insert(0, 'tools')
from resource_costs import weapon_build_cost, ship_hull_build_cost

# spec section 3.1: Vanguard Mass Driver Mk.3 (wpn_092)
w = {'size': 'medium', 'weaponClass': 'kinetic',
     'damage': {'base': 118.0}, 'powerCost': 20.3,
     'accuracy': {'tracking': 10}, 'criticalChance': 0.18}
c = weapon_build_cost(w)
print(c)
# NOTE: the spec's worked example hand-rounds 20.3*0.15=3.045 up to 3.05; actual
# Python round(3.045, 2) gives 3.04 because 3.045 has no exact binary float
# representation and the nearest representable value is a hair under 3.045. Use
# the real computed value here -- the spec's number is an illustrative
# approximation (see its own "~3.05 (3.045)" phrasing), not a contract.
assert c == {'structural': 2.2, 'energy': 3.04, 'ordnance': 1.65, 'precision': 1.4}, c

# spec section 3.3: Whisperfang bare hull
h = ship_hull_build_cost(831, 345, 78, 50, 39)
print(h)
assert h == {'structural': 26.97, 'energy': 7.8, 'ordnance': 0.0, 'precision': 4.45}, h
print('OK')
"
```
Expected: prints both dicts, then `OK`, no AssertionError.

- [ ] **Step 3: Commit**

```bash
git add tools/resource_costs.py
git commit -m "feat(resources): add resource catalogue and buildCost formulas"
```

---

### Task 2: Resources catalogue — schema, generator, verifier

**Files:**
- Create: `Data-Templates/resource.interface`
- Create: `tools/generate_resources.py`
- Create: `tools/verify_resources.py`

**Interfaces:**
- Consumes: `RESOURCES`, `LANES`, `REFINE_YIELD`, `FABRICATION_YIELD`, `RAW`, `REFINED`, `MANUFACTURED` from `tools/resource_costs.py` (Task 1).
- Produces: `Resources/{raw,refined,manufactured}/*.json`, `Resources/index.json`, `fleet_and_weapons.json['resources']`. Later tasks (3-5) rely on `fleet['resources']` existing and on the `.interface` field-set-match pattern this task establishes.

- [ ] **Step 1: Write `Data-Templates/resource.interface`**

```
# INTERFACE: Resource
# Source of truth : ../tools/resource_costs.py -> RESOURCES
# Live reference  : ../fleet_and_weapons.json -> "resources"
# Generated by    : ../tools/generate_resources.py -- deterministic, no RNG.
#                   Re-running reproduces the catalogue byte-for-byte. Edit the
#                   tables in resource_costs.py, never the generated files.
#                   ../tools/verify_resources.py checks the invariants below.
#
# Usage: one JSON file per resource under Resources/<tier>/; Resources/index.json
# lists all 12 with their path. A weapon/module/ship's buildCost (see
# weapon.interface, module.interface, ship.interface) is a quantity of the four
# MANUFACTURED resources -- structural, energy, ordnance, precision.
#
# TIERS -- raw is mined/harvested feedstock; refined is processed material ready
# for fabrication; manufactured is the finished part a buildCost is priced in.
# Each tier -> tier step has a conversionYield (< 1, always): refining and
# fabrication both lose material, which is what makes "manufactured" the
# expensive end of the chain rather than a rename of "raw".
#
# LANES -- four material lanes carried through all three tiers, chosen to match
# the physical inputs the weapon/module/ship stat model already has (mass,
# power, damage/ordnance, tracking/precision):
#
# <<< generated from tools/generate_resources.py -- do not edit by hand
# >>> end generated
#
# INVARIANTS (enforced by tools/verify_resources.py)
#   - resourceIds and names unique; field set identical to the schema below
#   - conversionYield is strictly between 0 and 1 for every raw/refined/manufactured step
#   - every refinesFrom/refinesInto cross-reference resolves to a real resourceId
#   - each of the 4 lanes forms an unbroken raw -> refined -> manufactured chain

{
  "resourceId": "string, unique, format: res_<tier>_<slug>",
  "name": "string",
  "tier": "enum: raw | refined | manufactured",
  "lane": "enum: structural | energy | ordnance | precision",
  "refinesFrom": "resourceId or null -- the tier-below input this is made from (null for raw)",
  "refinesInto": "resourceId or null -- the tier-above output this feeds (null for manufactured)",
  "conversionYield": "number 0-1 or null -- units of THIS tier produced per unit of refinesFrom consumed (null for raw)",
  "unitMass": "number, tons -- ties into the existing ship.capacities.cargo field",
  "description": "string"
}

# ---- EXAMPLE INSTANCE ----
#
# {
#   "resourceId": "res_refined_structural_alloy",
#   "name": "Structural Alloy",
#   "tier": "refined",
#   "lane": "structural",
#   "refinesFrom": "res_raw_ferrite",
#   "refinesInto": "res_mfg_structural_component",
#   "conversionYield": 0.90,
#   "unitMass": 1.0,
#   "description": "Smelted and tempered ferrite, ready for fabrication into hull sections and weapon housings."
# }
```

- [ ] **Step 2: Write `tools/generate_resources.py`**

```python
#!/usr/bin/env python3
"""Deterministic resource-catalogue generator for Nebula-of-Cybernetics-Design.

Every value comes straight from tools/resource_costs.py -- no RNG. Re-running
reproduces the catalogue byte-for-byte.

Usage:
    python3 tools/generate_resources.py --dry-run   # report shape, write nothing
    python3 tools/generate_resources.py             # regenerate everything
"""
import argparse, json, os, shutil, sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from resource_costs import RESOURCES, LANES, RAW, REFINED, MANUFACTURED, REFINE_YIELD, FABRICATION_YIELD

FLEET = os.path.join(ROOT, 'fleet_and_weapons.json')
RESOURCES_DIR = os.path.join(ROOT, 'Resources')
IFACE = os.path.join(ROOT, 'Data-Templates', 'resource.interface')

MARK_BEGIN = '# <<< generated from tools/generate_resources.py -- do not edit by hand\n'
MARK_END = '# >>> end generated\n'


def write_interface_table():
    lines = []
    for lane in LANES:
        lines.append(f'#   {lane.upper()}\n')
        lines.append(f'#     raw          {RAW[lane][1]:24} ({RAW[lane][0]})\n')
        lines.append(f'#     refined      {REFINED[lane][1]:24} ({REFINED[lane][0]})  '
                     f'yield {REFINE_YIELD[lane]:.2f}\n')
        lines.append(f'#     manufactured {MANUFACTURED[lane][1]:24} ({MANUFACTURED[lane][0]})  '
                     f'yield {FABRICATION_YIELD:.2f}\n')
    text = open(IFACE).read()
    a, b = text.index(MARK_BEGIN), text.index(MARK_END)
    open(IFACE, 'w').write(text[:a] + MARK_BEGIN + ''.join(lines) + text[b:])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    print(f'resources     : {len(RESOURCES)}')
    print('by tier       :', dict(Counter(r['tier'] for r in RESOURCES)))
    print('by lane       :', dict(Counter(r['lane'] for r in RESOURCES)))
    if args.dry_run:
        return

    fleet = json.load(open(FLEET))
    fleet['resources'] = RESOURCES
    fleet['_meta']['resourceCount'] = len(RESOURCES)
    fleet['_meta']['resourceLanes'] = LANES
    with open(FLEET, 'w') as f:
        json.dump(fleet, f, indent=2); f.write('\n')

    if os.path.isdir(RESOURCES_DIR):
        shutil.rmtree(RESOURCES_DIR)
    index = []
    for r in RESOURCES:
        d = os.path.join(RESOURCES_DIR, r['tier'])
        os.makedirs(d, exist_ok=True)
        rel = os.path.join('Resources', r['tier'], f"{r['resourceId']}.json")
        with open(os.path.join(ROOT, rel), 'w') as f:
            json.dump(r, f, indent=2); f.write('\n')
        index.append({'resourceId': r['resourceId'], 'name': r['name'], 'tier': r['tier'],
                      'lane': r['lane'], 'path': rel})
    with open(os.path.join(RESOURCES_DIR, 'index.json'), 'w') as f:
        json.dump({'count': len(index), 'resources': index}, f, indent=2); f.write('\n')
    write_interface_table()
    print(f'\nwrote {len(RESOURCES)} resource files + Resources/index.json')


if __name__ == '__main__':
    main()
```

- [ ] **Step 3: Run it and inspect output**

Run: `python3 tools/generate_resources.py --dry-run`
Expected: `resources     : 12`, `by tier       : {'raw': 4, 'refined': 4, 'manufactured': 4}`, `by lane       : {'structural': 4, 'energy': 4, 'ordnance': 4, 'precision': 4}`.

Run: `python3 tools/generate_resources.py`
Expected: `wrote 12 resource files + Resources/index.json`.

Run: `cat Resources/refined/res_refined_precision_circuitry.json`
Expected: valid JSON with `"conversionYield": 0.5`, `"refinesFrom": "res_raw_isotopes"`, `"refinesInto": "res_mfg_guidance_assembly"`.

- [ ] **Step 4: Write `tools/verify_resources.py`**

```python
#!/usr/bin/env python3
"""Invariant checks for the generated resource catalogue."""
import json, os, sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from resource_costs import LANES, TIERS

FLEET = json.load(open(os.path.join(ROOT, 'fleet_and_weapons.json')))
R = FLEET['resources']
fails = []


def check(label, bad, show=6):
    if bad:
        fails.append(label); print(f'FAIL {label}: {len(bad)}')
        for b in bad[:show]: print('      ', b)
    else:
        print(f'ok   {label}')


check('12 resources: 4 lanes x 3 tiers', [] if len(R) == 12 else [f'{len(R)} resources'])
check('unique resourceIds', [k for k, v in Counter(r['resourceId'] for r in R).items() if v > 1])
check('unique names',       [k for k, v in Counter(r['name'] for r in R).items() if v > 1])

body = '\n'.join(l for l in open(os.path.join(ROOT, 'Data-Templates', 'resource.interface'))
                 if not l.lstrip().startswith('#'))
schema = set(json.loads(body))
check('field set matches resource.interface', [r['resourceId'] for r in R if set(r) != schema])

check('tier legal', [r['resourceId'] for r in R if r['tier'] not in TIERS])
check('lane legal', [r['resourceId'] for r in R if r['lane'] not in LANES])

# yields: null for raw, strictly between 0 and 1 for refined/manufactured
bad = []
for r in R:
    y = r['conversionYield']
    if r['tier'] == 'raw':
        if y is not None:
            bad.append(f'{r["resourceId"]}: raw tier has a yield')
    elif not (y is not None and 0 < y < 1):
        bad.append(f'{r["resourceId"]}: yield {y} not in (0, 1)')
check('conversionYield null for raw, in (0,1) otherwise', bad)

# cross-references resolve and each lane forms an unbroken 3-tier chain
by_id = {r['resourceId']: r for r in R}
bad = []
for r in R:
    for ref in ('refinesFrom', 'refinesInto'):
        if r[ref] is not None and r[ref] not in by_id:
            bad.append(f'{r["resourceId"]}.{ref} -> {r[ref]} (missing)')
check('refinesFrom/refinesInto resolve', bad)

bad = []
for lane in LANES:
    chain = [r for r in R if r['lane'] == lane]
    by_tier = {r['tier']: r for r in chain}
    if set(by_tier) != set(TIERS):
        bad.append(f'{lane}: tiers present {sorted(by_tier)}'); continue
    if by_tier['raw']['refinesInto'] != by_tier['refined']['resourceId']:
        bad.append(f'{lane}: raw.refinesInto != refined.resourceId')
    if by_tier['refined']['refinesFrom'] != by_tier['raw']['resourceId']:
        bad.append(f'{lane}: refined.refinesFrom != raw.resourceId')
    if by_tier['refined']['refinesInto'] != by_tier['manufactured']['resourceId']:
        bad.append(f'{lane}: refined.refinesInto != manufactured.resourceId')
    if by_tier['manufactured']['refinesFrom'] != by_tier['refined']['resourceId']:
        bad.append(f'{lane}: manufactured.refinesFrom != refined.resourceId')
check('each lane is an unbroken raw->refined->manufactured chain', bad)

# files on disk
disk = {}
for dp, _, fns in os.walk(os.path.join(ROOT, 'Resources')):
    for fn in fns:
        if fn.endswith('.json') and fn != 'index.json':
            o = json.load(open(os.path.join(dp, fn)))
            disk[o['resourceId']] = (o, os.path.relpath(os.path.join(dp, fn), ROOT))
check('one file per resource', [f'{len(disk)} files vs {len(R)} resources'] if len(disk) != len(R) else [])
check('file content == json', [r['resourceId'] for r in R if disk.get(r['resourceId'], ({},))[0] != r])
check('filed under tier', [rid for rid, (o, rel) in disk.items() if rel.split(os.sep)[1] != o['tier']])

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} CHECK(S) FAILED'))
sys.exit(1 if fails else 0)
```

- [ ] **Step 5: Run the verifier**

Run: `python3 tools/verify_resources.py`
Expected: `ALL CHECKS PASSED` (this run only checks the resource catalogue itself — the cross-catalogue `buildCost` checks come in Task 6, after weapons/modules/ships have the field).

- [ ] **Step 6: Commit**

```bash
git add Data-Templates/resource.interface tools/generate_resources.py tools/verify_resources.py \
        Resources/ fleet_and_weapons.json
git commit -m "feat(resources): generate the raw/refined/manufactured resource catalogue"
```

---

### Task 3: Weapons — `buildCost` integration

**Files:**
- Modify: `Data-Templates/weapon.interface` (schema body)
- Modify: `tools/generate_weapons.py:16-19` (imports), `:401-404` (post-process step)
- Modify: `tools/verify_weapons.py:30-48` (mark-ladder check block)

**Interfaces:**
- Consumes: `weapon_build_cost` from `tools/resource_costs.py` (Task 1).
- Produces: every weapon dict gains `buildCost: {structural, energy, ordnance, precision}`. Task 5 (ships) reads this field via `by_id[weaponId]['buildCost']`.

- [ ] **Step 1: Add the schema field**

In `Data-Templates/weapon.interface`, the schema JSON body ends with `"specialEffects": [...]`. Add a new field after it:

```
  "specialEffects": [
    "array of strings, e.g. 'ignores_shields', 'emp_disable', 'armor_piercing'"
  ],
  "buildCost": {
    "structural": "number, manufactured-tier Structural Component units",
    "energy": "number, manufactured-tier Power Core Unit units",
    "ordnance": "number, manufactured-tier Ordnance Charge units",
    "precision": "number, manufactured-tier Guidance Assembly units"
  }
```
(Also add a trailing comma after the closing `]` of `specialEffects` since it's no longer the last field.)

- [ ] **Step 2: Import the cost function**

In `tools/generate_weapons.py`, after line 19 (`IFACE = os.path.join(...)`), add:

```python
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from resource_costs import weapon_build_cost
```

- [ ] **Step 3: Attach buildCost after the powerCost ladder-fix loop**

The existing loop (lines 392-401) enforces the powerCost ladder is strictly increasing per mark — `buildCost.energy` is derived from `powerCost`, so it must be computed *after* that fix, not before. Immediately after that loop (before the blank lines and the `print(f'archetypes ...')` block that currently starts at line 404), add:

```python
    for w in weapons:
        w['buildCost'] = weapon_build_cost(w)
```

- [ ] **Step 4: Regenerate and inspect**

Run: `python3 tools/generate_weapons.py`
Expected: `wrote 798 weapon files + Weapons/index.json` (unchanged count).

Run:
```bash
python3 -c "
import json
w = next(w for w in json.load(open('fleet_and_weapons.json'))['weapons'] if w['weaponId'] == 'wpn_092')
print(w['name'], w['buildCost'])
"
```
Expected: `Vanguard Mass Driver Mk.3 {'structural': 2.2, 'energy': 3.04, 'ordnance': 1.65, 'precision': 1.4}` — matches Task 1's verified sanity check (the spec's own worked example hand-rounds 3.045 to 3.05; the real `round()` gives 3.04 — see the note in Task 1 Step 2).

- [ ] **Step 5: Extend the mark-ladder check with buildCost monotonicity**

In `tools/verify_weapons.py`, the mark-ladder loop (lines 39-48) currently checks damage-per-turn, hit chance, and effects. Add a buildCost check inside the same loop, right after the existing `if` (line 45-47):

```python
lines = defaultdict(list)
for w in W:
    fam, arch, mk = parse(w['name'])
    lines[(fam, arch, w['size'])].append((mk, w))
bad = []
for key, items in lines.items():
    items.sort()
    for (m1, a), (m2, b) in zip(items, items[1:]):
        pa = a['damage']['base'] * a['fireRate']['shotsPerTurn'] / (1 + a['fireRate']['cooldownTurns'])
        pb = b['damage']['base'] * b['fireRate']['shotsPerTurn'] / (1 + b['fireRate']['cooldownTurns'])
        if pb <= pa or b['accuracy']['baseHitChance'] < a['accuracy']['baseHitChance'] \
           or not set(a['specialEffects']) <= set(b['specialEffects']):
            bad.append(f'{key} Mk.{m1}->Mk.{m2}  dpt {pa:.1f}->{pb:.1f}')
        if sum(b['buildCost'].values()) < sum(a['buildCost'].values()):
            bad.append(f'{key} Mk.{m1}->Mk.{m2}  buildCost went down')
check('mark ladder monotonic (dpt, hit, effects)', bad)
```

- [ ] **Step 6: Verify**

Run: `python3 tools/verify_weapons.py`
Expected: `ALL CHECKS PASSED`. If "field set matches weapon.interface" fails, the schema edit in Step 1 doesn't match the emitted field set exactly — compare key-for-key.

- [ ] **Step 7: Commit**

```bash
git add Data-Templates/weapon.interface tools/generate_weapons.py tools/verify_weapons.py \
        Weapons/ fleet_and_weapons.json
git commit -m "feat(weapons): attach buildCost, derived from existing weapon stats"
```

---

### Task 4: Modules — `buildCost` integration

**Files:**
- Modify: `Data-Templates/module.interface` (schema body)
- Modify: `tools/generate_modules.py:16-19` (imports), `:292-294` (post-process step)
- Modify: `tools/verify_modules.py:69-88` (mark-ladder check block)

**Interfaces:**
- Consumes: `module_build_cost` from `tools/resource_costs.py` (Task 1).
- Produces: every module dict gains `buildCost`. Task 5 reads it via `by_id[moduleId]['buildCost']`.

- [ ] **Step 1: Add the schema field**

In `Data-Templates/module.interface`, the schema body ends with `"hullAffinity": [...]`. Add, with a trailing comma on the previous line:

```
  "hullAffinity": ["array of shipClass strings this module is restricted to; empty = any hull"],
  "buildCost": {
    "structural": "number, manufactured-tier Structural Component units",
    "energy": "number, manufactured-tier Power Core Unit units",
    "ordnance": "number, manufactured-tier Ordnance Charge units",
    "precision": "number, manufactured-tier Guidance Assembly units"
  }
```

(Check the exact current wording of the `hullAffinity` line before editing — copy it verbatim and only append the comma and the new field.)

- [ ] **Step 2: Import the cost function**

In `tools/generate_modules.py`, after line 19 (`IFACE = os.path.join(...)`), add:

```python
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from resource_costs import module_build_cost
```

- [ ] **Step 3: Attach buildCost after the module-build loop**

In `main()`, right after the loop that builds `modules` (ends at line 292 with `modules.append(m)`), before the `print(f'archetypes ...')` block at line 294, add:

```python
    for m in modules:
        m['buildCost'] = module_build_cost(m)
```

- [ ] **Step 4: Regenerate and inspect**

Run: `python3 tools/generate_modules.py`
Expected: `wrote 135 module files + Modules/index.json` (unchanged count).

Run:
```bash
python3 -c "
import json
m = next(m for m in json.load(open('fleet_and_weapons.json'))['modules'] if m['moduleId'] == 'mod_ammunition_magazine_mk1')
print(m['name'], m['buildCost'])
"
```
Expected: prints a `buildCost` dict with a non-zero `ordnance` value (Ammunition Magazine grants `ammoCapacity`, which is in `ORDNANCE_STATS`) — confirms the module formula's ordnance branch actually fires, not just the structural/energy branches every module hits.

- [ ] **Step 5: Extend the mark-ladder check with buildCost monotonicity**

In `tools/verify_modules.py`, the mark-ladder loop (lines 69-86) already checks `b['powerCost'] < a['powerCost'] or b['crewRequired'] < a['crewRequired']`. Extend that same condition:

```python
        if b['powerCost'] < a['powerCost'] or b['crewRequired'] < a['crewRequired'] \
           or sum(b['buildCost'].values()) < sum(a['buildCost'].values()):
            bad_cost.append(f'{name} Mk.{lo}->Mk.{hi} cost went down')
```

- [ ] **Step 6: Verify**

Run: `python3 tools/verify_modules.py`
Expected: `ALL CHECKS PASSED`.

- [ ] **Step 7: Commit**

```bash
git add Data-Templates/module.interface tools/generate_modules.py tools/verify_modules.py \
        Modules/ fleet_and_weapons.json
git commit -m "feat(modules): attach buildCost, derived from existing module stats"
```

---

### Task 5: Ships — hull + fitted `buildCost` integration

**Files:**
- Modify: `Data-Templates/ship.interface` (schema body)
- Modify: `tools/generate_ships.py:14-20` (imports), `:130-224` (`build_hull`), `:279-306` (named-ship construction), `:333-334` (hoisted lookups)
- Modify: `tools/verify_ships.py:46-63` (tier-ladder check block)

**Interfaces:**
- Consumes: `ship_hull_build_cost`, `add_costs` from `tools/resource_costs.py` (Task 1); `buildCost` on every weapon/module (Tasks 3-4).
- Produces: every ship (template and named) gains `buildCost` = hull cost + Σ(fitted weapon `buildCost`) + Σ(fitted module `buildCost`).

- [ ] **Step 1: Add the schema field**

In `Data-Templates/ship.interface`, add a `buildCost` block as a sibling of `power` (matching where it's computed). Locate the `"power": {...}` entry in the schema body and add immediately after its closing brace, with a comma:

```
  "power": { ... },   // (leave the existing power block exactly as-is, just add a comma after its closing brace if not already followed by one)
  "buildCost": {
    "structural": "number, manufactured-tier Structural Component units -- hull + every fitted weapon/module",
    "energy": "number, manufactured-tier Power Core Unit units",
    "ordnance": "number, manufactured-tier Ordnance Charge units",
    "precision": "number, manufactured-tier Guidance Assembly units"
  },
```

Read the actual current `power` block text in the file before editing (it may span multiple lines) and preserve it verbatim, only inserting the new field after it.

- [ ] **Step 2: Import cost functions**

In `tools/generate_ships.py`, after line 17 (`from generate_weapons import split_name`), add:

```python
from resource_costs import ship_hull_build_cost, add_costs
```

- [ ] **Step 3: Compute buildCost inside `build_hull`**

`build_hull` currently builds `componentHitpoints` inline inside the returned dict literal (lines 208-211) via a dict comprehension over `COMPONENT_SHARE`. Pull that into a named local *before* the `return` statement so `bridge`/`sensorArray` HP are addressable, then compute the hull cost and the fitted-item total using the `hardpoints`, `fitted_modules`, and `by_id` (weapon lookup) locals that already exist earlier in the function:

Immediately before the `return {` statement (currently starting at line 197), insert:

```python
    component_hp = {name: max(1, round(hull_hp * share)) for name, (share, eff) in COMPONENT_SHARE.items()}
    hull_cost = ship_hull_build_cost(mass, hull_hp, power, component_hp['bridge'], component_hp['sensorArray'])
    total_cost = add_costs(hull_cost,
                            *[by_id[h['weaponEquipped']]['buildCost'] for h in hardpoints if h['weaponEquipped']],
                            *[m['buildCost'] for m in fitted_modules])
```

Then change the `componentHitpoints` entry inside the returned dict (lines 208-211) from:

```python
        'componentHitpoints': {
            name: {'maxHP': max(1, round(hull_hp * share)),
                   'currentHP': max(1, round(hull_hp * share)), 'criticalEffect': eff}
            for name, (share, eff) in COMPONENT_SHARE.items()},
```

to:

```python
        'componentHitpoints': {
            name: {'maxHP': component_hp[name], 'currentHP': component_hp[name], 'criticalEffect': eff}
            for name, (share, eff) in COMPONENT_SHARE.items()},
```

And add `'buildCost': total_cost,` as a new entry in the returned dict, right after the existing `'power': {...}` entry and before `'sensors': {...}`.

- [ ] **Step 4: Hoist the weapon/module id lookups**

In `main()`, `weapons_by_id`/`modules_by_id` are currently built at lines 333-334, *after* the `named` ships loop (lines 288-306) that will need them. Move these two lines to immediately after line 280 (`weapons, modules = fleet['weapons'], fleet['modules']`):

```python
    fleet = json.load(open(FLEET))
    weapons, modules = fleet['weapons'], fleet['modules']
    weapons_by_id = {w['weaponId']: w for w in weapons}
    modules_by_id = {m['moduleId']: m for m in modules}
```

Delete the now-duplicate definitions that were at (old) lines 333-334 — the later code (`write_ship_kit` calls) already references `weapons_by_id`/`modules_by_id` by name and needs no other change.

- [ ] **Step 5: Compute buildCost for named ships**

In the `named` ships loop, right before the existing `order = [...]` line, add:

```python
        chp = base['componentHitpoints']
        hull_cost = ship_hull_build_cost(base['mass']['value'], base['hull']['maxHP'],
                                          base['power']['maxPower'],
                                          chp['bridge']['maxHP'], chp['sensorArray']['maxHP'])
        base['buildCost'] = add_costs(
            hull_cost,
            *[weapons_by_id[h['weaponEquipped']]['buildCost']
              for h in base['hardpoints']['list'] if h['weaponEquipped']],
            *[modules_by_id[m['moduleEquipped']]['buildCost']
              for m in base['moduleSlots']['list'] if m['moduleEquipped']])
```

Then add `'buildCost'` to the `order` list, in the same position as the template hull (after `'power'`, before `'sensors'`):

```python
        order = ['shipId', 'name', 'tier', 'shipClass', 'templateId', 'mass', 'hull', 'shields',
                 'hardpoints', 'moduleSlots', 'componentHitpoints', 'mobility', 'crew',
                 'power', 'buildCost', 'sensors', 'capacities']
```

- [ ] **Step 6: Regenerate and inspect**

Run: `python3 tools/generate_ships.py`
Expected: `wrote 78 tier hull dirs + 20 named ship dirs (...) + Ships/index.json` (unchanged counts).

Run:
```bash
python3 -c "
import json
fleet = json.load(open('fleet_and_weapons.json'))
s = next(s for s in fleet['namedShips'] if s['name'] == 'Whisperfang')
print(s['buildCost'])
"
```
Expected: a `buildCost` dict whose `structural` figure is noticeably larger than the bare-hull-only worked example (26.97) — it now includes Whisperfang's fitted weapons and modules on top of the hull.

- [ ] **Step 7: Extend the tier-ladder check with buildCost monotonicity**

In `tools/verify_ships.py`, the tier-ladder loop (lines 46-63) iterates a tuple of `(path, get)` pairs. Add `buildCost` total as one more entry to that tuple list:

```python
        for path, get in (('mass', lambda x: x['mass']['value']),
                          ('hull.maxHP', lambda x: x['hull']['maxHP']),
                          ('shields.maxHP', lambda x: x['shields']['maxHP']),
                          ('power.maxPower', lambda x: x['power']['maxPower']),
                          ('crew.gunnerySkill', lambda x: x['crew']['gunnerySkill']),
                          ('detectionRange', lambda x: x['sensors']['detectionRange']),
                          ('buildCost', lambda x: sum(x['buildCost'].values()))):
```

(No other change needed in that loop — the existing `if get(b) < get(a):` check now also covers `buildCost`.)

- [ ] **Step 8: Verify**

Run: `python3 tools/verify_ships.py`
Expected: `ALL CHECKS PASSED`.

- [ ] **Step 9: Commit**

```bash
git add Data-Templates/ship.interface tools/generate_ships.py tools/verify_ships.py \
        Ships/ fleet_and_weapons.json
git commit -m "feat(ships): attach buildCost as hull cost plus every fitted weapon/module"
```

---

### Task 6: Cross-catalogue consistency check

**Files:**
- Modify: `tools/verify_resources.py` (append a new check section)

**Interfaces:**
- Consumes: `buildCost` on weapons/modules/ships (Tasks 3-5); `expand_to_raw`, `LANES` from `tools/resource_costs.py`.

- [ ] **Step 1: Add cross-catalogue checks**

First, change the existing top-of-file import line in `tools/verify_resources.py` from:
```python
from resource_costs import LANES, TIERS
```
to:
```python
from resource_costs import LANES, TIERS, expand_to_raw
```

Then insert this block immediately *before* the file's final two lines (`print('\n' + (...))` and `sys.exit(...)`):

```python
check('every weapon has a buildCost with all 4 lanes',
      [w['weaponId'] for w in FLEET['weapons'] if set(w.get('buildCost', {})) != set(LANES)])
check('every module has a buildCost with all 4 lanes',
      [m['moduleId'] for m in FLEET['modules'] if set(m.get('buildCost', {})) != set(LANES)])
check('every ship (template + named) has a buildCost with all 4 lanes',
      [s['shipId'] for s in FLEET['ships'] + FLEET['namedShips']
       if set(s.get('buildCost', {})) != set(LANES)])

# chain round-trip: expanding a sample weapon's buildCost to raw units and back
# down through the same yields should reproduce numbers consistent with the
# yields stored in the resource catalogue itself (not just the constants) --
# catches the catalogue and the formula module drifting apart.
sample = FLEET['weapons'][0]
raw_equiv = expand_to_raw(sample['buildCost'])
by_lane_yield = {r['lane']: r['conversionYield'] for r in R if r['tier'] == 'refined'}
bad = []
for lane in LANES:
    if sample['buildCost'][lane] == 0:
        continue
    reconstructed = round(raw_equiv[lane] * by_lane_yield[lane] * 0.85, 2)
    if abs(reconstructed - sample['buildCost'][lane]) > 0.02:
        bad.append(f'{lane}: {sample["buildCost"][lane]} -> raw {raw_equiv[lane]} -> back {reconstructed}')
check('sample buildCost round-trips through the stored catalogue yields', bad)
```

- [ ] **Step 2: Verify**

Run: `python3 tools/verify_resources.py`
Expected: `ALL CHECKS PASSED` — this is the first run where the cross-catalogue checks actually exercise real data (Task 2's run of this script predates `buildCost` existing anywhere).

- [ ] **Step 3: Commit**

```bash
git add tools/verify_resources.py
git commit -m "test(resources): verify buildCost exists everywhere and the yield chain round-trips"
```

---

### Task 7: README documentation

**Files:**
- Modify: `README.md`

**Interfaces:**
- None — documentation only, reflects the state Tasks 1-6 already produced.

- [ ] **Step 1: Update the Contents table**

Add a `Resources` row to the counts table near the top (after the `Modules` row):

```
| Resources | 12 | 4 lanes (structural/energy/ordnance/precision) × 3 tiers (raw/refined/manufactured) |
```

Update the "Files on disk" row's total and breakdown to include the 12 new files under `Resources/`.

- [ ] **Step 2: Update the Layout tree**

In the `## Layout` code block, add `Resources/<tier>/` alongside `Weapons/<class>/<size>/` and `Modules/<slotType>/<functionClass>/`, and add `resource.interface` to the `Data-Templates/` listing.

- [ ] **Step 3: Add a "Resources" subsection**

Add a new subsection under `## The three catalogues` (retitle that heading `## The four catalogues`), following the style of the existing Weapons/Modules subsections — summarize the 4-lane × 3-tier taxonomy, the yield-based tier-to-tier cost, and that `buildCost` on every weapon/module/ship is a formula over stats those catalogues already have (point the reader at `Resources/resource_tiers_specification.md` for the full derivation rather than duplicating it).

- [ ] **Step 4: Update Regenerating, Verification, and "Where to make changes"**

- `## Regenerating`: add `python3 tools/generate_resources.py` as the *first* line of the ordered command block (before weapons), with a one-line note that resources must run first since weapon/module/ship cost formulas depend on its constants.
- `## Verification`: add `python3 tools/verify_resources.py` to the command block.
- `## Where to make changes` table: add a row — `resource lanes, yields, buildCost formulas | tools/resource_costs.py`.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document the resource-tier catalogue and buildCost pipeline"
```

---

### Task 8: Full pipeline regeneration and verification sweep

**Files:** none (integration check only)

- [ ] **Step 1: Regenerate everything from scratch, in the documented order**

```bash
python3 tools/generate_resources.py
python3 tools/generate_weapons.py
python3 tools/generate_modules.py
python3 tools/generate_ships.py
```
Expected: each prints its normal summary with unchanged counts (12 resources, 798 weapons, 135 modules, 78 tier hulls + 20 named ships) — re-running the full pipeline after Tasks 1-7 must still be idempotent, per the project's core "no RNG, byte-identical on re-run" guarantee.

- [ ] **Step 2: Run every verifier**

```bash
python3 tools/verify_resources.py
python3 tools/verify_weapons.py
python3 tools/verify_modules.py
python3 tools/verify_ships.py
```
Expected: `ALL CHECKS PASSED` on all four.

- [ ] **Step 3: Confirm the working tree is clean after a second regeneration**

```bash
git status --short
```
Expected: no output (re-running the generators a second time in a row produced byte-identical files, so nothing is staged/modified beyond what Task 8's own commit will add — if anything shows as modified here, the pipeline is not actually deterministic and that's a bug to fix before closing this plan out).

- [ ] **Step 4: Commit (only if Step 1 produced any diff beyond what Tasks 1-7 already committed)**

```bash
git add -A
git status --short   # review before committing anything unexpected
git commit -m "chore(resources): full regeneration sweep after resource-tier wiring"
```
