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
