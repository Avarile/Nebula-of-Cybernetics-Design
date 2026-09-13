#!/usr/bin/env python3
"""Check the TypeScript interfaces in Reference/ against the live data.

Mirrors the style of tools/verify_*.py: every check prints OK or FAIL and the
script exits non-zero if any check fails. What it enforces:

  - every string-literal union declares exactly the values present in
    fleet_and_weapons.json (no missing member, no invented one)
  - every entity interface declares exactly the field set the data carries
  - the skill catalogue's domains, categories, scopes, unlock types, capability and
    skill-group keys, and the skill-only half of the stat vocabulary

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
SKILLS = FLEET['skills']
SKILL_INDEX = json.load(open(os.path.join(ROOT, 'Skills', 'index.json')))

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

# ---------------------------------------------------------------- skills
# 52 of the 80 skill ids are template-literal types (`skl_ship_${ShipClass}_control`),
# which union() cannot read -- they are checked structurally below instead.

check('SkillDomain', union('skills.ts', 'SkillDomain'), {s['domain'] for s in SKILLS})
check('SkillScope', union('skills.ts', 'SkillScope'), {s['scope'] for s in SKILLS})
for domain, name in [('ship_command', 'ShipCommandCategory'),
                     ('station_management', 'StationManagementCategory'),
                     ('deep_space_mining', 'DeepSpaceMiningCategory'),
                     ('interaction_trade', 'InteractionTradeCategory')]:
    check(name, union('skills.ts', name),
          {s['category'] for s in SKILLS if s['domain'] == domain})

UNLOCKS = [u for s in SKILLS for u in s['unlocks']]
check('SkillUnlockType', union('skills.ts', 'SkillUnlockType'), {u['type'] for u in UNLOCKS})
for utype, name in [('fleet_slot', 'FleetSlotTarget'), ('capability', 'SkillCapability'),
                    ('skill_group', 'SkillGroup')]:
    check(name, union('skills.ts', name), {u['target'] for u in UNLOCKS if u['type'] == utype})

# SkillEffectStat = ModuleEffectStat | SkillOnlyStat, so the skill-only half must be
# exactly the stats the skill data uses that no module stat covers.
MODULE_STATS = union('modules.ts', 'ModuleEffectStat')
SKILL_USED = {e['stat'] for s in SKILLS for e in s['effects'] + s['penalties']}
check('SkillOnlyStat', union('skills.ts', 'SkillOnlyStat'), SKILL_USED - MODULE_STATS)

# SkillWeaponClass = WeaponClass | 'drone'; 'drone' is hangar-launched and has no
# entry in Weapons/, so it is declared here rather than in WeaponClass.
check('SkillWeaponClass', union('weapons.ts', 'WeaponClass') | {'drone'},
      {e['appliesTo']['weaponClass'] for s in SKILLS
       for e in s['effects'] + s['penalties'] if 'weaponClass' in e['appliesTo']},
      schema_only=['kinetic', 'energy', 'missile', 'mine', 'melee'])

# The 28 non-hull ids are literal unions; the 52 hull ids are template literals.
declared_ids = set()
for name in ('RootSkillId', 'ShipCommandSkillId', 'StationManagementSkillId',
             'DeepSpaceMiningSkillId', 'InteractionTradeSkillId'):
    declared_ids |= union('skills.ts', name)
hull_ids = {s['skillId'] for s in SKILLS if s['category'] == 'ship_system_control'}
check('SkillId (29 non-hull literals)', declared_ids,
      {s['skillId'] for s in SKILLS} - hull_ids)

ship_classes = {s['shipClass'] for s in SHIPS}
expected_hull_ids = {f'skl_ship_{c}_{suffix}' for c in ship_classes
                     for suffix in ('control', 'systems')}
check('SkillId (52 hull template literals)', expected_hull_ids, hull_ids)

# ---------------------------------------------------------------- hull tree
# HULL_TREE and ROOT_SKILL_ID are declared in constants.ts, not as a union, so they are
# checked against the live prerequisites rather than through union().
import skill_tables as st  # noqa: E402

const_src = open(os.path.join(REF, 'constants.ts')).read()
m = re.search(r'export const HULL_TREE = \{(.*?)\n\} as const', const_src, re.S)
if not m:
    sys.exit('HULL_TREE not found in Reference/constants.ts')
declared_tree = {}
for key, val in re.findall(r"^\s{2}(\w+):\s*(null|'\w+'),", m.group(1), re.M):
    declared_tree[key] = None if val == 'null' else val.strip("'")
check('HULL_TREE covers every ship category', set(declared_tree), ship_classes)
check('HULL_TREE matches tools/skill_tables.py',
      set(declared_tree) | set(st.HULL_TREE),
      {k for k in set(declared_tree) | set(st.HULL_TREE)
       if declared_tree.get(k, '?') == st.HULL_TREE.get(k, '??')})

m = re.search(r"export const ROOT_SKILL_ID = '([\w]+)'", const_src)
declared_root = {m.group(1)} if m else set()
check('ROOT_SKILL_ID matches the catalogue', declared_root,
      {s['skillId'] for s in SKILLS if s['category'] == 'fundamentals'})
check('RootSkillId union matches', union('skills.ts', 'RootSkillId'),
      {s['skillId'] for s in SKILLS if s['category'] == 'fundamentals'})

m = re.search(r'export const ENTRY_HULLS = \[(.*?)\n\] as const', const_src, re.S)
declared_entry = set(re.findall(r"'([\w]+)'", m.group(1))) if m else set()
check('ENTRY_HULLS matches the tree', declared_entry,
      {k for k, v in st.HULL_TREE.items() if v is None})

# The published SP ladder in constants.ts must equal the one the catalogue carries.
def ts_numbers(name):
    mm = re.search(r'export const %s = \[(.*?)\n\] as const' % name, const_src, re.S)
    return [int(x.replace('_', '')) for x in re.findall(r'[\d_]+', mm.group(1))] if mm else []

rank1 = next(s for s in SKILLS if s['rank'] == 1)
check('SP_PER_LEVEL_RANK1 matches the catalogue',
      set(ts_numbers('SP_PER_LEVEL_RANK1')), set(rank1['training']['spPerLevel']))
check('SP_CUMULATIVE_RANK1 matches the catalogue',
      set(ts_numbers('SP_CUMULATIVE_RANK1')), set(rank1['training']['spCumulative']))

# ---------------------------------------------------------------- skill field sets
check('Skill fields', fields('skills.ts', 'SkillBase') | {'domain', 'category'},
      {k for s in SKILLS for k in s})
check('SkillTraining fields', fields('skills.ts', 'SkillTraining'),
      {k for s in SKILLS for k in s['training']})
check('SkillEffect fields', fields('skills.ts', 'SkillEffect'),
      {k for s in SKILLS for e in s['effects'] for k in e})
check('SkillPenalty fields', fields('skills.ts', 'SkillPenalty'),
      {k for s in SKILLS for p in s['penalties'] for k in p})
check('SkillUnlock fields', fields('skills.ts', 'SkillUnlockBase') | {'type', 'target'},
      {k for u in UNLOCKS for k in u})
check('SkillPrerequisite fields', fields('skills.ts', 'SkillPrerequisite'),
      {k for s in SKILLS for r in s['prerequisites'] for k in r})
check('SkillAppliesTo fields', fields('skills.ts', 'SkillAppliesTo'),
      {k for s in SKILLS for e in s['effects'] + s['penalties'] for k in e['appliesTo']})

check('SkillIndexEntry fields', fields('skills.ts', 'SkillIndexEntry'),
      {k for e in SKILL_INDEX['skills'] for k in e})
check('SkillDomainSummary fields', fields('skills.ts', 'SkillDomainSummary'),
      {k for d in SKILL_INDEX['domains'] for k in d})
check('SkillIndex fields', fields('skills.ts', 'SkillIndex'), set(SKILL_INDEX))

# _meta grew three skill keys; check the whole thing, not just those.
check('FleetMeta fields', fields('dataset.ts', 'FleetMeta'), set(FLEET['_meta']))

check('FleetDataset fields', fields('dataset.ts', 'FleetDataset'), set(FLEET))

# ---------------------------------------------------------------- systems & planets
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

print()
if failures:
    print(f'{len(failures)} check(s) FAILED: {", ".join(failures)}')
    sys.exit(1)
print('all checks pass')
