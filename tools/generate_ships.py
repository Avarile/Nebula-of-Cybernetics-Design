#!/usr/bin/env python3
"""Deterministic hull generator: 3 tier hulls for each of the 26 ship categories.

Everything is a pure function of (category signature, tier) plus the weapon and module
catalogues it fits from -- no RNG. Re-running reproduces the fleet byte-for-byte.

Usage:
    python3 tools/generate_ships.py --dry-run
    python3 tools/generate_ships.py
"""
import argparse, json, math, os, re, shutil, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from ship_tables import CATEGORIES, BY_KEY
from generate_weapons import split_name
from resource_costs import ship_hull_build_cost, add_costs

FLEET = os.path.join(ROOT, 'fleet_and_weapons.json')
SHIPS_DIR = os.path.join(ROOT, 'Ships')
IFACE = os.path.join(ROOT, 'Data-Templates', 'ship.interface')

TIERS = [1, 2, 3]
SIZE_RANK = {'small': 0, 'medium': 1, 'large': 2, 'capital': 3}

# A hardpoint's mount follows from what is bolted to it, so the two can never disagree.
MOUNT_FOR_CLASS = {'kinetic': 'turret', 'energy': 'turret', 'missile': 'missile_bay',
                   'mine': 'fixed', 'melee': 'fixed'}

ARMOR_HP = {'light': 0.85, 'medium': 1.00, 'heavy': 1.25, 'reactive': 1.15}
ARMOR_RATING = {'light': 0.70, 'medium': 1.00, 'heavy': 1.35, 'reactive': 1.15}
RESIST = {
    'kinetic': {'kinetic': 0.30, 'energy': 0.10, 'explosive': 0.05},
    'energy':  {'kinetic': 0.10, 'energy': 0.30, 'explosive': 0.08},
    'hybrid':  {'kinetic': 0.20, 'energy': 0.20, 'explosive': 0.12},
    'none':    {'kinetic': 0.00, 'energy': 0.00, 'explosive': 0.00},
}
COMPONENT_SHARE = {
    'bridge': (0.15, 'disables targeting computer, -50% accuracy'),
    'engines': (0.25, '-70% speed and turn rate'),
    'weaponSystems': (0.20, 'random hardpoint disabled'),
    'shieldGenerator': (0.18, 'shield recharge disabled'),
    'sensorArray': (0.12, '-40% hit chance, reduced detection range'),
    'lifeSupport': (0.10, 'crew casualties over time'),
}
CAPACITY_KEYS = ['cargo', 'ammo', 'fuel', 'troops', 'aircraft', 'drones', 'mines',
                 'medical', 'repairRate']

# Fallback fitting order when a category's own preferences have nothing in that size/slot.
MODULE_PREFS = {
    'engine':    ['Ion Drive', 'Cruise Drive', 'Sprint Drive', 'Manoeuvring Thrusters'],
    'utility':   ['Fusion Generator', 'Auxiliary Power Core', 'Machine Shop',
                  'Repair Drone Bay', 'Damage Control Party', 'Capacitor Bank', 'Fire Suppression'],
    'sensor':    ['Search Radar', 'Sonar Array', 'ECM Suite', 'Counter-ECM Array',
                  'Surface Radar', 'Optical Rangefinder', 'Decoy Launcher'],
    'defensive': ['Belt Armour', 'Armour Plating', 'Shield Capacitor', 'Shield Booster',
                  'Torpedo Bulge', 'PD Coordinator'],
    'command':   ['CIC Tower', 'Flag Bridge', 'Fire Control Director', 'Datalink Relay',
                  'Targeting Computer'],
    'hangar':    ['Aircraft Elevator', 'Drone Bay', 'Drone Controller'],
    'cargo':     ['Bulk Hold', 'Ammunition Magazine'],
}

TIER_HULL  = [1.00, 1.18, 1.40]
TIER_SHIELD = [1.00, 1.22, 1.48]
TIER_MASS_POS = [0.10, 0.45, 0.85]      # where in the published band the tier sits
TIER_DELAY = [3, 2, 2]


def archetype_of_weapon(w):
    return split_name(w['name'])[2]


def family_of_weapon(w):
    return split_name(w['name'])[0]


def mark_of_weapon(w):
    return split_name(w['name'])[3]


def archetype_of_module(m, legacy_arch):
    if m['moduleId'] in legacy_arch:
        return legacy_arch[m['moduleId']]
    mt = re.match(r'^(.*) Mk\.(\d+)$', m['name'])
    return mt.group(1) if mt else m['name']


def pick_weapon(cat, size, tier, weapons):
    prefs = cat['wpn']
    cands = [w for w in weapons if w['size'] == size and mark_of_weapon(w) == tier]
    if not cands:
        sys.exit(f'no {size} weapon at Mk.{tier} for {cat["key"]}')

    def key(w):
        arch, fam = archetype_of_weapon(w), family_of_weapon(w)
        p = prefs.index(arch) if arch in prefs else len(prefs)
        f = cat['fam'].index(fam) if fam in cat['fam'] else len(cat['fam'])
        return (p, f, w['weaponId'])
    return min(cands, key=key)


def pick_module(cat, slot, tier, modules, used, legacy_arch):
    cap = SIZE_RANK[cat['mod_cap']]
    prefs = MODULE_PREFS[slot]
    cands = []
    for m in modules:
        if m['slotType'] != slot or m['mark'] != tier:
            continue
        if SIZE_RANK[m['size']] > cap:
            continue
        if m['hullAffinity'] and cat['key'] not in m['hullAffinity']:
            continue
        arch = archetype_of_module(m, legacy_arch)
        if arch in used:
            continue
        cands.append((arch, m))
    if not cands:
        return None

    def key(t):
        arch, m = t
        # mission gear the hull is actually meant to carry outranks generic fittings
        affinity = 0 if m['hullAffinity'] else 1
        p = prefs.index(arch) if arch in prefs else len(prefs)
        return (affinity, p, m['moduleId'])
    return min(cands, key=key)


def build_hull(cat, tier, weapons, modules, legacy_arch):
    lo, hi = cat['mass']
    mass = round(lo + TIER_MASS_POS[tier - 1] * (hi - lo), 1)
    t = tier - 1

    hull_hp = round(3.1 * mass ** 0.72 * ARMOR_HP[cat['armor']] * TIER_HULL[t])
    armor_rating = round(2.27 * mass ** 0.28 * ARMOR_RATING[cat['armor']] * (1 + 0.15 * t))

    if cat['shield'] == 'none':
        shields = {'maxHP': 0, 'currentHP': 0, 'rechargeRatePerTurn': 0,
                   'rechargeDelayAfterHit': 0, 'shieldType': 'none',
                   'damageTypeResistance': dict(RESIST['none'])}
    else:
        smax = round(hull_hp * cat['shield_ratio'] * TIER_SHIELD[t])
        res = {k: round(v + 0.02 * t, 2) for k, v in RESIST[cat['shield']].items()}
        shields = {'maxHP': smax, 'currentHP': smax,
                   'rechargeRatePerTurn': max(1, round(smax * 0.08 * (1 + 0.1 * t))),
                   'rechargeDelayAfterHit': TIER_DELAY[t], 'shieldType': cat['shield'],
                   'damageTypeResistance': res}

    # ---- hardpoints: sizes come from the signature, the mount follows the weapon fitted
    sizes = list(cat['hp'])
    if tier >= 2:
        sizes += cat['hp2']
    if tier >= 3:
        sizes += cat['hp3']
    sizes.sort(key=lambda s: -SIZE_RANK[s])
    hardpoints = []
    for i, size in enumerate(sizes, 1):
        w = pick_weapon(cat, size, tier, weapons)
        hardpoints.append({'hardpointId': f'hp_{i}', 'size': size,
                           'mountType': MOUNT_FOR_CLASS[w['weaponClass']],
                           'weaponEquipped': w['weaponId']})

    # ---- module slots
    slot_types = list(cat['slots'])
    if tier >= 2:
        slot_types += cat['slots2']
    if tier >= 3:
        slot_types += cat['slots3']
    slots, used, fitted_modules = [], set(), []
    for i, st in enumerate(slot_types, 1):
        picked = pick_module(cat, st, tier, modules, used, legacy_arch)
        if picked is None:
            slots.append({'slotId': f'ms_{i}', 'slotType': st, 'size': cat['mod_cap'],
                          'moduleEquipped': None})
            continue
        arch, m = picked
        used.add(arch)
        fitted_modules.append(m)
        slots.append({'slotId': f'ms_{i}', 'slotType': st, 'size': m['size'],
                      'moduleEquipped': m['moduleId']})

    # ---- crew must actually man what is fitted
    crew_needed = sum(m['crewRequired'] for m in fitted_modules)
    crew = round(0.587 * mass ** 0.55 * cat['crew_f'] * (1 + 0.08 * t))
    crew = max(crew, math.ceil(crew_needed * 1.5) + 4)

    # ---- power must cover passive module draw plus one full volley
    by_id = {w['weaponId']: w for w in weapons}
    volley = sum(by_id[h['weaponEquipped']]['powerCost'] *
                 by_id[h['weaponEquipped']]['fireRate']['shotsPerTurn']
                 for h in hardpoints if h['weaponEquipped'])
    passive = sum(m['powerCost'] for m in fitted_modules)
    power = round(6.0 * mass ** 0.45 * (1 + 0.12 * t))
    power = max(power, math.ceil((volley + passive) * 1.25))

    component_hp = {name: max(1, round(hull_hp * share)) for name, (share, eff) in COMPONENT_SHARE.items()}
    hull_cost = ship_hull_build_cost(mass, hull_hp, power, component_hp['bridge'], component_hp['sensorArray'])
    total_cost = add_costs(hull_cost,
                            *[by_id[h['weaponEquipped']]['buildCost'] for h in hardpoints if h['weaponEquipped']],
                            *[m['buildCost'] for m in fitted_modules])

    return {
        'shipId': f'ship_{cat["key"]}_t{tier}',
        'name': f'{cat["key"].replace("_", " ").title()} Tier {tier}',
        'tier': tier,
        'shipClass': cat['key'],
        'mass': {'value': mass, 'unit': 'tons'},
        'hull': {'maxHP': hull_hp, 'currentHP': hull_hp, 'armorRating': armor_rating,
                 'armorType': cat['armor']},
        'shields': shields,
        'hardpoints': {'list': hardpoints},
        'moduleSlots': {'list': slots},
        'componentHitpoints': {
            name: {'maxHP': component_hp[name], 'currentHP': component_hp[name], 'criticalEffect': eff}
            for name, (share, eff) in COMPONENT_SHARE.items()},
        'mobility': {'topSpeed': round(cat['speed'] * (1 + 0.06 * t)),
                     'acceleration': round(cat['accel'] * (1 + 0.07 * t)),
                     'turnRate': round(cat['turn'] * (1 + 0.05 * t)),
                     'evasionRating': round(cat['evade'] * (1 + 0.05 * t), 2)},
        'crew': {'maxCrew': crew, 'currentCrew': crew,
                 'pilotSkill': 45 + 15 * t, 'gunnerySkill': 44 + 16 * t,
                 'engineeringSkill': 42 + 16 * t},
        'power': {'maxPower': power, 'currentPower': power,
                  'regenPerTurn': max(1, round(power * 0.15))},
        'buildCost': total_cost,
        'sensors': {'detectionRange': round(cat['det'] * (1 + 0.15 * t)),
                    'initiative': cat['init'] + tier},
        'capacities': {k: round(cat['cap'].get(k, 0) * (1 + 0.28 * t)) for k in CAPACITY_KEYS},
    }



def slugify(name):
    return re.sub(r'_+', '_', re.sub(r'[^a-z0-9]+', '_', name.lower())).strip('_')


def weapon_catalogue_path(w):
    return os.path.join('Weapons', w['weaponClass'], w['size'],
                        f"{w['weaponId']}_{slugify(w['name'])}.json")


def module_catalogue_path(m):
    return os.path.join('Modules', m['slotType'], m['functionClass'], f"{m['moduleId']}.json")


def write_ship_kit(hull, folder, dirname, weapons_by_id, modules_by_id):
    """A hull is a directory: the hull itself, plus one file per filled mount carrying the
    full catalogue entry with the mount it occupies bolted on the front."""
    base = os.path.join(SHIPS_DIR, folder, dirname)
    os.makedirs(os.path.join(base, 'Weapons'), exist_ok=True)
    os.makedirs(os.path.join(base, 'Modules'), exist_ok=True)

    with open(os.path.join(base, 'ship.json'), 'w') as f:
        json.dump(hull, f, indent=2); f.write('\n')

    n_w = n_m = 0
    for h in hull['hardpoints']['list']:
        if not h['weaponEquipped']:
            continue
        w = weapons_by_id[h['weaponEquipped']]
        fitting = {'hardpointId': h['hardpointId'], 'mountType': h['mountType'],
                   'catalogue': weapon_catalogue_path(w), **w}
        fn = f"{h['hardpointId']}_{w['weaponId']}_{slugify(w['name'])}.json"
        with open(os.path.join(base, 'Weapons', fn), 'w') as f:
            json.dump(fitting, f, indent=2); f.write('\n')
        n_w += 1

    for sl in hull['moduleSlots']['list']:
        if not sl['moduleEquipped']:
            continue
        m = modules_by_id[sl['moduleEquipped']]
        fitting = {'slotId': sl['slotId'], 'catalogue': module_catalogue_path(m), **m}
        with open(os.path.join(base, 'Modules', f"{sl['slotId']}_{m['moduleId']}.json"), 'w') as f:
            json.dump(fitting, f, indent=2); f.write('\n')
        n_m += 1
    return n_w, n_m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    fleet = json.load(open(FLEET))
    weapons, modules = fleet['weapons'], fleet['modules']
    weapons_by_id = {w['weaponId']: w for w in weapons}
    modules_by_id = {m['moduleId']: m for m in modules}
    sys.path.insert(0, os.path.join(ROOT, 'tools'))
    from generate_modules import LEGACY as MOD_LEGACY
    legacy_arch = {mid: arch for mid, (arch, _) in MOD_LEGACY.items()}

    hulls = [build_hull(c, t, weapons, modules, legacy_arch) for c in CATEGORIES for t in TIERS]

    # ---- the 20 pre-existing ships become named instances of the class they belong to
    named = []
    for s in fleet.get('namedShips', fleet['ships']):
        if s['shipId'].startswith('ship_') and s.get('tier') and 'templateId' in s:
            base = dict(s)                       # already migrated on an earlier run
        else:
            base = dict(s)
        cls = base['shipClass']
        same = [h for h in hulls if h['shipClass'] == cls]
        if not same:
            sys.exit(f'named ship {base["shipId"]} has no template for class {cls}')
        tmpl = min(same, key=lambda h: abs(h['mass']['value'] - base['mass']['value']))
        base['tier'] = tmpl['tier']
        base['templateId'] = tmpl['shipId']
        base.setdefault('sensors', dict(tmpl['sensors']))
        base.setdefault('capacities', dict(tmpl['capacities']))
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
        order = ['shipId', 'name', 'tier', 'shipClass', 'templateId', 'mass', 'hull', 'shields',
                 'hardpoints', 'moduleSlots', 'componentHitpoints', 'mobility', 'crew',
                 'power', 'buildCost', 'sensors', 'capacities']
        named.append({k: base[k] for k in order if k in base})

    print(f'categories   : {len(CATEGORIES)}')
    print(f'tier hulls   : {len(hulls)}')
    print(f'named ships  : {len(named)}')
    print('mass range   : '
          f'{min(h["mass"]["value"] for h in hulls):.0f} - {max(h["mass"]["value"] for h in hulls):.0f} t')
    print('hull HP range: '
          f'{min(h["hull"]["maxHP"] for h in hulls)} - {max(h["hull"]["maxHP"] for h in hulls)}')
    print('hardpoints   :', dict(sorted(Counter(len(h['hardpoints']['list']) for h in hulls).items())))
    print('slots        :', dict(sorted(Counter(len(h['moduleSlots']['list']) for h in hulls).items())))
    unfilled = sum(1 for h in hulls for s in h['moduleSlots']['list'] if not s['moduleEquipped'])
    print(f'empty slots  : {unfilled}')
    if args.dry_run:
        return

    fleet['ships'] = hulls
    fleet['namedShips'] = named
    fleet['_meta']['title'] = (f'Generated Fleet Data - {len(hulls)} tier hulls, '
                               f'{len(named)} named ships, {len(weapons)} weapons, '
                               f'{len(modules)} modules')
    fleet['_meta']['shipCount'] = len(hulls)
    fleet['_meta']['namedShipCount'] = len(named)
    fleet['_meta']['shipCategories'] = [c['key'] for c in CATEGORIES]
    with open(FLEET, 'w') as f:
        json.dump(fleet, f, indent=2); f.write('\n')

    index, tot_w, tot_m = [], 0, 0
    for h in hulls:
        folder = BY_KEY[h['shipClass']]['folder']
        d = os.path.join(SHIPS_DIR, folder)
        os.makedirs(d, exist_ok=True)
        # clear whatever the previous layout left behind for this tier
        stale_file = os.path.join(d, f'tier-{h["tier"]}.json')
        if os.path.exists(stale_file):
            os.remove(stale_file)
        stale_dir = os.path.join(d, f'tier-{h["tier"]}')
        if os.path.isdir(stale_dir):
            shutil.rmtree(stale_dir)

        n_w, n_m = write_ship_kit(h, folder, f'tier-{h["tier"]}', weapons_by_id, modules_by_id)
        tot_w += n_w; tot_m += n_m
        rel = os.path.join('Ships', folder, f'tier-{h["tier"]}')
        index.append({'shipId': h['shipId'], 'name': h['name'], 'shipClass': h['shipClass'],
                      'tier': h['tier'], 'mass': h['mass']['value'], 'hullHP': h['hull']['maxHP'],
                      'hardpoints': len(h['hardpoints']['list']),
                      'moduleSlots': len(h['moduleSlots']['list']),
                      'dir': rel, 'path': os.path.join(rel, 'ship.json'),
                      'weaponsFitted': n_w, 'modulesFitted': n_m, 'kind': 'template'})

    # ---- named ships sit beside the tier hulls of the class they belong to
    for n in named:
        folder = BY_KEY[n['shipClass']]['folder']
        d = os.path.join(SHIPS_DIR, folder, n['name'])
        if os.path.isdir(d):
            shutil.rmtree(d)
        n_w, n_m = write_ship_kit(n, folder, n['name'], weapons_by_id, modules_by_id)
        tot_w += n_w; tot_m += n_m
        rel = os.path.join('Ships', folder, n['name'])
        index.append({'shipId': n['shipId'], 'name': n['name'], 'shipClass': n['shipClass'],
                      'tier': n['tier'], 'mass': n['mass']['value'], 'hullHP': n['hull']['maxHP'],
                      'hardpoints': len(n['hardpoints']['list']),
                      'moduleSlots': len(n['moduleSlots']['list']),
                      'dir': rel, 'path': os.path.join(rel, 'ship.json'),
                      'weaponsFitted': n_w, 'modulesFitted': n_m,
                      'kind': 'named', 'templateId': n['templateId']})

    # ---- clear ship directories that no longer correspond to anything we generate
    keep = defaultdict(set)
    for c in CATEGORIES:
        keep[c['folder']] |= {f'tier-{t}' for t in TIERS}
    for n in named:
        keep[BY_KEY[n['shipClass']]['folder']].add(n['name'])
    removed = []
    for c in CATEGORIES:
        d = os.path.join(SHIPS_DIR, c['folder'])
        for entry in sorted(os.listdir(d)):
            p_ = os.path.join(d, entry)
            if os.path.isdir(p_) and entry not in keep[c['folder']] \
               and os.path.exists(os.path.join(p_, 'ship.json')):
                shutil.rmtree(p_); removed.append(f'{c["folder"]}/{entry}')
    if removed:
        print('removed stale ship dirs:', ', '.join(removed))
    with open(os.path.join(SHIPS_DIR, 'index.json'), 'w') as f:
        json.dump({'count': len(index), 'ships': index}, f, indent=2); f.write('\n')
    print(f'\nwrote {len(hulls)} tier hull dirs + {len(named)} named ship dirs '
          f'({tot_w} weapon fittings, {tot_m} module fittings) + Ships/index.json')


if __name__ == '__main__':
    main()
