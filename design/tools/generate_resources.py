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

    # Unlike Weapons/ or Modules/, Resources/ also holds this feature's hand-written
    # spec and plan docs (resource_tiers_specification.md, resource_tiers_implementation_plan.md)
    # -- it is not a purely-generated directory. Clear only the generated subtrees,
    # never the whole directory, so a re-run can't silently delete those docs.
    for tier in ('raw', 'refined', 'manufactured'):
        d = os.path.join(RESOURCES_DIR, tier)
        if os.path.isdir(d):
            shutil.rmtree(d)
    old_index = os.path.join(RESOURCES_DIR, 'index.json')
    if os.path.exists(old_index):
        os.remove(old_index)
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
