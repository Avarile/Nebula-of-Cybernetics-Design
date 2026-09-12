#!/usr/bin/env python3
"""Check the TypeScript interfaces in Reference/ against the live data.

Mirrors the style of tools/verify_*.py: every check prints OK or FAIL and the
script exits non-zero if any check fails. What it enforces:

  - every string-literal union declares exactly the values present in
    fleet_and_weapons.json (no missing member, no invented one)
  - every entity interface declares exactly the field set the data carries

Run from anywhere:  python3 Reference/verify_reference.py
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, 'Reference')
sys.path.insert(0, os.path.join(ROOT, 'tools'))

FLEET = json.load(open(os.path.join(ROOT, 'fleet_and_weapons.json')))
SHIPS = FLEET['ships'] + FLEET['namedShips']
WEAPONS, MODULES, RESOURCES = FLEET['weapons'], FLEET['modules'], FLEET['resources']

failures = []


def union(filename, name):
    src = open(os.path.join(REF, filename)).read()
    m = re.search(r'export type %s =\n?(.*?);\n' % re.escape(name), src, re.S)
    if not m:
        sys.exit(f'union {name} not found in Reference/{filename}')
    return set(re.findall(r"'([^']+)'", m.group(1)))


def fields(filename, iface):
    src = open(os.path.join(REF, filename)).read()
    m = re.search(r'(?:export )?interface %s\b[^{]*\{(.*?)\n\}' % re.escape(iface), src, re.S)
    if not m:
        sys.exit(f'interface {iface} not found in Reference/{filename}')
    return set(re.findall(r'^\s{2}(\w+)[?]?:', m.group(1), re.M))


def check(label, declared, actual, schema_only=()):
    """`schema_only` names values the schema permits but no current row uses."""
    missing = actual - declared
    extra = declared - actual - set(schema_only)
    ok = not missing and not extra
    if not ok:
        failures.append(label)
    detail = ''
    if missing:
        detail += f'  MISSING={sorted(missing)}'
    if extra:
        detail += f'  UNDECLARED-IN-DATA={sorted(extra)}'
    print(f'{"OK  " if ok else "FAIL"} {label:32} declared={len(declared):3} in-data={len(actual):3}{detail}')


# ---------------------------------------------------------------- unions
check('ShipClass', union('ships.ts', 'ShipClass'), {s['shipClass'] for s in SHIPS})
check('ArmorType', union('ships.ts', 'ArmorType'), {s['hull']['armorType'] for s in SHIPS})
check('ShieldType', union('ships.ts', 'ShieldType'), {s['shields']['shieldType'] for s in SHIPS})
check('ComponentName', union('ships.ts', 'ComponentName'),
      {k for s in SHIPS for k in s['componentHitpoints']})
check('Size', union('common.ts', 'Size'),
      {w['size'] for w in WEAPONS} | {h['size'] for s in SHIPS for h in s['hardpoints']['list']})
check('MountType', union('common.ts', 'MountType'),
      {h['mountType'] for s in SHIPS for h in s['hardpoints']['list']})
check('ModuleSlotType', union('common.ts', 'ModuleSlotType'), {m['slotType'] for m in MODULES})
check('DamageType', union('common.ts', 'DamageType'), {w['damage']['damageType'] for w in WEAPONS})
check('ResourceLane', union('common.ts', 'ResourceLane'), {r['lane'] for r in RESOURCES})
check('WeaponClass', union('weapons.ts', 'WeaponClass'), {w['weaponClass'] for w in WEAPONS})
check('WeaponSpecialEffect', union('weapons.ts', 'WeaponSpecialEffect'),
      {e for w in WEAPONS for e in w['specialEffects']})
check('ModuleType', union('modules.ts', 'ModuleType'), {m['moduleType'] for m in MODULES})
check('ModuleFunctionClass', union('modules.ts', 'ModuleFunctionClass'),
      {m['functionClass'] for m in MODULES})
check('ModifierType', union('modules.ts', 'ModifierType'),
      {e['modifierType'] for m in MODULES for e in m['effects']})
check('ModuleEffectStat', union('modules.ts', 'ModuleEffectStat'),
      {e['stat'] for m in MODULES for e in m['effects']},
      schema_only=['crew.pilotSkill'])
check('ResourceTier', union('resources.ts', 'ResourceTier'), {r['tier'] for r in RESOURCES})
for tier, name in [('raw', 'RawResourceId'), ('refined', 'RefinedResourceId'),
                   ('manufactured', 'ManufacturedResourceId')]:
    check(name, union('resources.ts', name),
          {r['resourceId'] for r in RESOURCES if r['tier'] == tier})

import generate_weapons as gw  # noqa: E402  (needs tools/ on sys.path first)
check('WeaponArchetype', union('weapons.ts', 'WeaponArchetype'), {a['name'] for a in gw.ARCHETYPES})
check('WeaponFamily', union('weapons.ts', 'WeaponFamily'), set(gw.FAMILIES))

# ---------------------------------------------------------------- field sets
check('Weapon fields', fields('weapons.ts', 'Weapon'), {k for w in WEAPONS for k in w})
check('ShipBase fields', fields('ships.ts', 'ShipBase'), {k for s in FLEET['ships'] for k in s})
check('Module fields', fields('modules.ts', 'ModuleBase') | {'functionClass', 'hullAffinity'},
      {k for m in MODULES for k in m})
check('Resource fields',
      fields('resources.ts', 'ResourceBase') | {'tier', 'refinesFrom', 'refinesInto', 'conversionYield'},
      {k for r in RESOURCES for k in r})
check('NamedShip fields', fields('ships.ts', 'ShipBase') | {'templateId'},
      {k for s in FLEET['namedShips'] for k in s})

print()
if failures:
    print(f'{len(failures)} check(s) FAILED: {", ".join(failures)}')
    sys.exit(1)
print('all checks pass')
