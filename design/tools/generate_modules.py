#!/usr/bin/env python3
"""Deterministic module-catalogue generator for Nebula-of-Cybernetics-Design.

Every value is a pure function of (archetype, mark) -- no RNG. Re-running reproduces
the catalogue byte-for-byte.

    value = archetype base  x  mark ladder      (marks 1-3, matching ship tiers 1-3)

Usage:
    python3 tools/generate_modules.py --dry-run
    python3 tools/generate_modules.py
"""
import argparse, json, os, re, shutil, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FLEET = os.path.join(ROOT, 'fleet_and_weapons.json')
MODULES_DIR = os.path.join(ROOT, 'Modules')
IFACE = os.path.join(ROOT, 'Data-Templates', 'module.interface')
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from resource_costs import module_build_cost

MARKS = [1, 2, 3]
SLOT_TYPES = ['engine', 'utility', 'defensive', 'sensor', 'cargo', 'command', 'hangar']
FUNCTION_CLASSES = ['major', 'support', 'specific']
SIZES = ['small', 'medium', 'large', 'capital']

SHIP_CLASSES = [
    'motor_torpedo_boat', 'submarine_chaser', 'corvette', 'torpedo_boat_fleet',
    'destroyer_escort', 'sloop_patrol_escort', 'destroyer', 'landing_ship_tank',
    'submarine', 'minelayer_sweeper', 'coastal_defence_ship', 'anti_aircraft_cruiser',
    'monitor', 'light_cruiser', 'attack_transport', 'light_carrier', 'panzerschiff',
    'merchant_raider', 'seaplane_tender', 'repair_ship_tender', 'heavy_cruiser',
    'escort_carrier', 'fleet_oiler', 'fleet_aircraft_carrier', 'battlecruiser', 'battleship',
]

# Ship stats a module may modify. Anything outside this list is a typo, not a new stat.
# Lives in tools/stat_vocabulary.py so the skill catalogue shares the same vocabulary;
# re-exported here because verify_modules.py imports it from this module.
from stat_vocabulary import SHIP_STATS as STATS, BENEFICIAL_NEGATIVE

# ------------------------------------------------------------------- mark ladder
def mark_effect(m): return 1.20 ** (m - 1)   # benefits grow
def mark_drawback(m): return 0.90 ** (m - 1) # drawbacks shrink
def mark_power(m):  return 1.12 ** (m - 1)
def mark_crew(m):   return 1.10 ** (m - 1)
def mark_mass(m):   return 1.06 ** (m - 1)


def M(name, mtype, fclass, slot, size, mass, pwr, crew, effects, eff3=(), hull=()):
    return dict(name=name, mtype=mtype, fclass=fclass, slot=slot, size=size, mass=mass,
                pwr=pwr, crew=crew, effects=list(effects), eff3=list(eff3), hull=list(hull))


E = lambda stat, mod, kind: (stat, mod, kind)

ARCHETYPES = [
    # ---- engine slot / major ------------------------------------------------
    M('Ion Drive', 'engine', 'major', 'engine', 'medium', 45, 5.0, 6,
      [E('topSpeed', 10, 'percent')], [E('acceleration', 8, 'percent')]),
    M('Cruise Drive', 'engine', 'major', 'engine', 'medium', 60, 4.0, 8,
      [E('topSpeed', 6, 'percent'), E('fuelRange', 20, 'percent')], [E('power.regenPerTurn', 2, 'flat')]),
    M('Sprint Drive', 'engine', 'major', 'engine', 'medium', 38, 9.0, 5,
      [E('acceleration', 18, 'percent')], [E('topSpeed', 5, 'percent')]),
    M('Manoeuvring Thrusters', 'engine', 'major', 'engine', 'small', 12, 3.0, 2,
      [E('turnRate', 15, 'percent'), E('evasionRating', 0.02, 'flat')]),
    # ---- utility slot / major (power generation) ----------------------------
    M('Fusion Generator', 'powerCore', 'major', 'utility', 'large', 120, 0.0, 12,
      [E('power.maxPower', 25, 'percent'), E('power.regenPerTurn', 4, 'flat')]),
    M('Auxiliary Power Core', 'powerCore', 'major', 'utility', 'medium', 55, 0.0, 6,
      [E('power.maxPower', 20, 'percent')], [E('power.regenPerTurn', 2, 'flat')]),
    M('Capacitor Bank', 'powerCore', 'major', 'utility', 'small', 20, 0.0, 2,
      [E('power.regenPerTurn', 3, 'flat')], [E('rechargeRatePerTurn', 8, 'percent')]),
    # ---- utility slot / support --------------------------------------------
    M('Repair Drone Bay', 'repairDrone', 'support', 'utility', 'medium', 35, 6.0, 4,
      [E('hull.regenPerTurn', 4, 'flat')], [E('repairRatePerTurn', 15, 'percent')]),
    M('Damage Control Party', 'damageControl', 'support', 'utility', 'small', 8, 1.0, 14,
      [E('repairRatePerTurn', 20, 'percent'), E('crew.engineeringSkill', 5, 'flat')]),
    M('Fire Suppression', 'fireSuppression', 'support', 'utility', 'small', 14, 2.0, 3,
      [E('crewRecoveryRate', 15, 'percent')], [E('hull.regenPerTurn', 2, 'flat')]),
    M('Machine Shop', 'machineShop', 'support', 'utility', 'large', 90, 5.0, 20,
      [E('repairRatePerTurn', 30, 'percent'), E('crew.engineeringSkill', 8, 'flat')]),
    M('Smoke Generator', 'smokeGenerator', 'specific', 'utility', 'small', 10, 2.0, 2,
      [E('enemyHitChance', -6, 'flat')], [E('evasionRating', 0.02, 'flat')],
      ['destroyer', 'destroyer_escort', 'corvette', 'torpedo_boat_fleet',
       'motor_torpedo_boat', 'sloop_patrol_escort']),
    M('Minesweep Gear', 'minesweep', 'specific', 'utility', 'medium', 45, 5.0, 12,
      [E('minesweepRate', 30, 'percent'), E('detectionRange', 10, 'percent')], (),
      ['minelayer_sweeper', 'sloop_patrol_escort', 'corvette']),
    M('Repair Shop', 'repairShop', 'specific', 'utility', 'large', 140, 6.0, 28,
      [E('repairRatePerTurn', 35, 'percent'), E('crew.engineeringSkill', 10, 'flat')], (),
      ['repair_ship_tender', 'seaplane_tender', 'fleet_oiler']),
    M('Hospital Bay', 'hospitalBay', 'specific', 'utility', 'medium', 55, 3.0, 16,
      [E('medicalCapacity', 30, 'flat')], [E('crewRecoveryRate', 20, 'percent')],
      ['attack_transport', 'repair_ship_tender', 'fleet_aircraft_carrier']),
    # ---- command slot -------------------------------------------------------
    M('CIC Tower', 'cic', 'major', 'command', 'large', 85, 10.0, 18,
      [E('weaponAccuracy', 6, 'percent'), E('initiative', 5, 'flat'), E('detectionRange', 10, 'percent')]),
    M('Flag Bridge', 'flagBridge', 'major', 'command', 'capital', 140, 8.0, 30,
      [E('initiative', 8, 'flat'), E('crew.gunnerySkill', 6, 'flat')], [E('weaponAccuracy', 4, 'percent')]),
    M('Fire Control Director', 'fireControl', 'major', 'command', 'medium', 30, 7.0, 8,
      [E('weaponAccuracy', 8, 'percent'), E('crew.gunnerySkill', 5, 'flat')]),
    M('Targeting Computer', 'targetingComputer', 'major', 'command', 'small', 10, 6.0, 2,
      [E('weaponAccuracy', 5, 'percent')], [E('criticalChanceBonus', 0.02, 'flat')]),
    M('Datalink Relay', 'datalink', 'support', 'command', 'medium', 25, 5.0, 4,
      [E('initiative', 4, 'flat'), E('detectionRange', 15, 'percent')]),
    # ---- sensor slot / major ------------------------------------------------
    M('Search Radar', 'radar', 'major', 'sensor', 'medium', 28, 8.0, 5,
      [E('detectionRange', 30, 'percent')], [E('initiative', 3, 'flat')]),
    M('Surface Radar', 'radar', 'major', 'sensor', 'small', 14, 5.0, 3,
      [E('detectionRange', 18, 'percent'), E('weaponAccuracy', 3, 'percent')]),
    M('Sonar Array', 'sonar', 'major', 'sensor', 'medium', 32, 7.0, 6,
      [E('detectionRange', 20, 'percent'), E('sensorArray.effectiveness', 12, 'percent')]),
    M('Optical Rangefinder', 'rangefinder', 'major', 'sensor', 'small', 9, 1.0, 4,
      [E('weaponAccuracy', 4, 'percent'), E('crew.gunnerySkill', 4, 'flat')]),
    # ---- sensor slot / support ----------------------------------------------
    M('ECM Suite', 'ecm', 'support', 'sensor', 'medium', 22, 10.0, 5,
      [E('enemyHitChance', -8, 'flat')], [E('evasionRating', 0.02, 'flat')]),
    M('Counter-ECM Array', 'ecCounterElectronics', 'support', 'sensor', 'medium', 20, 7.0, 4,
      [E('sensorArray.effectiveness', 12, 'percent')], [E('weaponAccuracy', 3, 'percent')]),
    M('Decoy Launcher', 'decoy', 'support', 'sensor', 'small', 13, 3.0, 2,
      [E('evasionRating', 0.04, 'flat')], [E('enemyHitChance', -4, 'flat')]),
    # ---- defensive slot -----------------------------------------------------
    M('Shield Booster', 'shieldBooster', 'support', 'defensive', 'medium', 26, 8.0, 3,
      [E('rechargeRatePerTurn', 25, 'percent')], [E('shields.rechargeDelayAfterHit', -1, 'flat')]),
    M('Shield Capacitor', 'shieldBooster', 'support', 'defensive', 'medium', 34, 12.0, 3,
      [E('shields.maxHP', 15, 'percent')], [E('rechargeRatePerTurn', 10, 'percent')]),
    M('Armour Plating', 'armorPlating', 'support', 'defensive', 'medium', 150, 0.0, 0,
      [E('hull.armorRating', 20, 'percent')], [E('hull.maxHP', 5, 'percent')]),
    M('Belt Armour', 'armorPlating', 'support', 'defensive', 'large', 400, 0.0, 0,
      [E('hull.armorRating', 35, 'percent'), E('hull.maxHP', 10, 'percent'), E('topSpeed', -5, 'percent')]),
    M('Torpedo Bulge', 'torpedoBulge', 'support', 'defensive', 'large', 260, 0.0, 0,
      [E('hull.maxHP', 12, 'percent'), E('topSpeed', -4, 'percent')], [E('hull.armorRating', 8, 'percent')]),
    M('PD Coordinator', 'pdCoordinator', 'support', 'defensive', 'small', 12, 6.0, 3,
      [E('pointDefenseBonus', 15, 'percent')], [E('enemyHitChance', -3, 'flat')]),
    # ---- hangar slot --------------------------------------------------------
    M('Drone Controller', 'droneController', 'major', 'hangar', 'medium', 40, 9.0, 8,
      [E('droneCapacity', 4, 'flat'), E('initiative', 2, 'flat')]),
    M('Drone Bay', 'droneBay', 'major', 'hangar', 'large', 95, 6.0, 12,
      [E('droneCapacity', 8, 'flat')], [E('repairRatePerTurn', 10, 'percent')]),
    M('Seaplane Catapult', 'catapult', 'specific', 'hangar', 'large', 110, 7.0, 14,
      [E('aircraftCapacity', 2, 'flat'), E('detectionRange', 25, 'percent')], (),
      ['seaplane_tender', 'light_cruiser', 'heavy_cruiser', 'battlecruiser', 'battleship']),
    M('Aircraft Elevator', 'aircraftElevator', 'specific', 'hangar', 'capital', 220, 10.0, 25,
      [E('aircraftCapacity', 6, 'flat')], (),
      ['fleet_aircraft_carrier', 'light_carrier', 'escort_carrier']),
    M('ASW Aircraft Bay', 'aswBay', 'specific', 'hangar', 'large', 130, 8.0, 16,
      [E('aircraftCapacity', 3, 'flat'), E('detectionRange', 20, 'percent')], (),
      ['escort_carrier', 'destroyer_escort', 'sloop_patrol_escort', 'seaplane_tender']),
    # ---- cargo slot ---------------------------------------------------------
    M('Bulk Hold', 'cargoExpander', 'support', 'cargo', 'large', 40, 0.0, 4,
      [E('cargoCapacity', 30, 'percent')]),
    M('Ammunition Magazine', 'magazine', 'support', 'cargo', 'medium', 85, 2.0, 8,
      [E('ammoCapacity', 40, 'percent'), E('hull.maxHP', -3, 'percent')]),
    M('Cargo Derrick', 'cargoDerrick', 'specific', 'cargo', 'large', 70, 3.0, 10,
      [E('cargoCapacity', 25, 'percent')], (),
      ['attack_transport', 'fleet_oiler', 'repair_ship_tender', 'landing_ship_tank']),
    M('Mine Rails', 'mineRails', 'specific', 'cargo', 'medium', 65, 1.0, 8,
      [E('mineCapacity', 40, 'percent')], (),
      ['minelayer_sweeper', 'destroyer', 'submarine', 'torpedo_boat_fleet']),
    M('Refuelling Rig', 'refuelRig', 'specific', 'cargo', 'large', 95, 4.0, 14,
      [E('fuelTransferRate', 40, 'percent')], (),
      ['fleet_oiler', 'repair_ship_tender', 'seaplane_tender']),
    M('Landing Craft Davits', 'davits', 'specific', 'cargo', 'large', 105, 2.0, 18,
      [E('troopCapacity', 35, 'percent')], (),
      ['attack_transport', 'landing_ship_tank']),
    M('Troop Berthing', 'troopBerthing', 'specific', 'cargo', 'medium', 60, 2.0, 6,
      [E('troopCapacity', 45, 'percent'), E('topSpeed', -2, 'percent')], (),
      ['attack_transport', 'landing_ship_tank', 'merchant_raider']),
]
BY_NAME = {a['name']: a for a in ARCHETYPES}

# The ten modules already in fleet_and_weapons.json keep their ids AND names; their stats
# are regenerated from the archetype cell they map onto. The 20 ships reference these ids.
LEGACY = {
    'mod_ion_drive_std':    ('Ion Drive', 1),
    'mod_ion_drive_hp':     ('Ion Drive', 2),
    'mod_shield_booster_1': ('Shield Booster', 1),
    'mod_shield_booster_2': ('Shield Booster', 2),
    'mod_ecm_std':          ('ECM Suite', 1),
    'mod_ecounter_std':     ('Counter-ECM Array', 1),
    'mod_repair_drone_std': ('Repair Drone Bay', 1),
    'mod_armor_plate_std':  ('Armour Plating', 1),
    'mod_cargo_expander':   ('Bulk Hold', 1),
    'mod_power_core_std':   ('Auxiliary Power Core', 1),
}


def scale_effect(stat, mod, mark):
    """Benefits grow with mark; drawbacks shrink. A negative modifier on a stat where
    negative IS the benefit (enemyHitChance) counts as a benefit."""
    beneficial = mod >= 0 or stat in BENEFICIAL_NEGATIVE
    factor = mark_effect(mark) if beneficial else mark_drawback(mark)
    return mod * factor


def round_mod(stat, v):
    return round(v, 3) if abs(v) < 1 else round(v, 1)


def build(arch, mark):
    effects = [(s, m, k) for (s, m, k) in arch['effects']]
    if mark >= 3:
        effects += arch['eff3']
    return {
        'moduleId': None,
        'name': None,
        'moduleType': arch['mtype'],
        'functionClass': arch['fclass'],
        'slotType': arch['slot'],
        'size': arch['size'],
        'mark': mark,
        'mass': {'value': round(arch['mass'] * mark_mass(mark), 1), 'unit': 'tons'},
        'effects': [{'stat': s, 'modifier': round_mod(s, scale_effect(s, m, mark)), 'modifierType': k}
                    for (s, m, k) in effects],
        'powerCost': round(arch['pwr'] * mark_power(mark), 1),
        'crewRequired': round(arch['crew'] * mark_crew(mark)),
        'hullAffinity': list(arch['hull']),
    }


def slug(s):
    return re.sub(r'_+', '_', re.sub(r'[^a-z0-9]+', '_', s.lower())).strip('_')


MARK_BEGIN = '# <<< generated from tools/generate_modules.py -- do not edit by hand\n'
MARK_END = '# >>> end generated\n'


def write_interface_tables(modules):
    lines = ['# ARCHETYPES -- 45 module lines, each built at Mk.1 / Mk.2 / Mk.3.\n',
             '#   Mk.N is meant for a tier-N hull: benefits scale x1.20 per mark, drawbacks\n',
             '#   shrink x0.90, power and crew rise more slowly, and Mk.3 adds a second effect\n',
             '#   where the archetype has one.\n',
             '#\n',
             f'#   {"archetype":22} {"slot":10} {"class":9} {"size":7} {"pwr":>5} {"crew":>4} '
             f'{"mass":>6}  effects at Mk.1\n']
    for a in ARCHETYPES:
        eff = ', '.join(f'{s} {m:+g}{"%" if k == "percent" else ""}' for s, m, k in a['effects'])
        lines.append(f'#   {a["name"]:22} {a["slot"]:10} {a["fclass"]:9} {a["size"]:7} '
                     f'{a["pwr"]:5.1f} {a["crew"]:4d} {a["mass"]:6.0f}  {eff}\n')
        if a['eff3']:
            e3 = ', '.join(f'{s} {m:+g}{"%" if k == "percent" else ""}' for s, m, k in a['eff3'])
            lines.append(f'#   {"":22} {"":10} {"":9} {"":7} {"":5} {"":4} {"":6}  + Mk.3: {e3}\n')
        if a['hull']:
            lines.append(f'#   {"":22} {"":10} {"":9} {"":7} {"":5} {"":4} {"":6}  '
                         f'hulls: {", ".join(a["hull"])}\n')
    lines += ['#\n', '# STAT VOCABULARY -- a module effect may only target these ship stats.\n', '#\n']
    for i in range(0, len(STATS), 3):
        lines.append('#   ' + ''.join(f'{s:30}' for s in STATS[i:i + 3]).rstrip() + '\n')
    lines += ['#\n',
              '#   Negative is the benefit for: ' + ', '.join(sorted(BENEFICIAL_NEGATIVE)) + '.\n',
              '#   A negative modifier on any other stat is a drawback (Belt Armour costs speed)\n',
              '#   and shrinks as the mark rises.\n']
    text = open(IFACE).read()
    a, b = text.index(MARK_BEGIN), text.index(MARK_END)
    open(IFACE, 'w').write(text[:a] + MARK_BEGIN + ''.join(lines) + text[b:])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    fleet = json.load(open(FLEET))
    for mid, (arch, mk) in LEGACY.items():
        if arch not in BY_NAME:
            sys.exit(f'legacy module {mid} maps to unknown archetype {arch}')
    legacy_names = {m['moduleId']: m['name'] for m in fleet['modules']}
    cell_id = {v: k for k, v in LEGACY.items()}

    modules = []
    for a in ARCHETYPES:
        for mk in MARKS:
            m = build(a, mk)
            mid = cell_id.get((a['name'], mk))
            if mid:
                m['moduleId'] = mid
                m['name'] = legacy_names.get(mid, f'{a["name"]} Mk.{mk}')
            else:
                m['moduleId'] = f'mod_{slug(a["name"])}_mk{mk}'
                m['name'] = f'{a["name"]} Mk.{mk}'
            modules.append(m)

    for m in modules:
        m['buildCost'] = module_build_cost(m)

    print(f'archetypes    : {len(ARCHETYPES)}')
    print(f'modules       : {len(modules)}')
    print(f'legacy ids    : {sum(1 for m in modules if m["moduleId"] in LEGACY)}/{len(LEGACY)}')
    print('by slotType   :', dict(Counter(m['slotType'] for m in modules)))
    print('by class      :', dict(Counter(m['functionClass'] for m in modules)))
    print('by size       :', dict(Counter(m['size'] for m in modules)))
    if args.dry_run:
        return

    # Slots carry a size now (ship.interface [+]). A filled slot takes the size of the
    # module fitted to it; the schema and the ship data cannot drift apart.
    by_id = {m['moduleId']: m for m in modules}
    unresolved = []
    for ship in fleet['ships'] + fleet.get('namedShips', []):
        for slot in ship['moduleSlots']['list']:
            mid = slot.get('moduleEquipped')
            if mid and mid in by_id:
                fitted = by_id[mid]
                slot['size'] = fitted['size']
                slot['slotType'] = fitted['slotType']
            elif mid:
                unresolved.append(f"{ship['shipId']}:{slot['slotId']} -> {mid}")
            else:
                slot.setdefault('size', 'medium')
            slot['moduleEquipped'] = mid
            # keep key order stable: slotId, slotType, size, moduleEquipped
            for k in ('slotId', 'slotType', 'size', 'moduleEquipped'):
                slot[k] = slot.pop(k)
    if unresolved:
        sys.exit('ship references a module that no longer exists: ' + ', '.join(unresolved))

    fleet['modules'] = modules
    fleet['_meta']['moduleCount'] = len(modules)
    fleet['_meta']['moduleArchetypes'] = len(ARCHETYPES)
    fleet['_meta']['moduleSlotTypes'] = SLOT_TYPES
    with open(FLEET, 'w') as f:
        json.dump(fleet, f, indent=2); f.write('\n')

    if os.path.isdir(MODULES_DIR):
        shutil.rmtree(MODULES_DIR)
    index = []
    for m in modules:
        d = os.path.join(MODULES_DIR, m['slotType'], m['functionClass'])
        os.makedirs(d, exist_ok=True)
        rel = os.path.join('Modules', m['slotType'], m['functionClass'], f"{m['moduleId']}.json")
        with open(os.path.join(ROOT, rel), 'w') as f:
            json.dump(m, f, indent=2); f.write('\n')
        index.append({'moduleId': m['moduleId'], 'name': m['name'], 'moduleType': m['moduleType'],
                      'functionClass': m['functionClass'], 'slotType': m['slotType'],
                      'size': m['size'], 'mark': m['mark'], 'powerCost': m['powerCost'],
                      'crewRequired': m['crewRequired'], 'path': rel})
    with open(os.path.join(MODULES_DIR, 'index.json'), 'w') as f:
        json.dump({'count': len(index), 'modules': index}, f, indent=2); f.write('\n')
    write_interface_tables(modules)
    print(f'\nwrote {len(modules)} module files + Modules/index.json')


if __name__ == '__main__':
    main()
