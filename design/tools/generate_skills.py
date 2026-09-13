#!/usr/bin/env python3
"""Deterministic skill-catalogue generator for Nebula-of-Cybernetics-Design.

Every value comes straight from tools/skill_tables.py -- no RNG. Re-running
reproduces the catalogue byte-for-byte.

Usage:
    python3 tools/generate_skills.py --dry-run   # report shape, write nothing
    python3 tools/generate_skills.py             # regenerate everything
"""
import argparse, json, os, shutil, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from skill_tables import SKILLS, DOMAINS, CATEGORY_ORDER, MAX_LEVEL, OPERATE_LEVEL

FLEET = os.path.join(ROOT, 'fleet_and_weapons.json')
SKILLS_DIR = os.path.join(ROOT, 'Skills')
IFACE = os.path.join(ROOT, 'Data-Templates', 'skill.interface')

MARK_BEGIN = '# <<< generated from tools/generate_skills.py -- do not edit by hand\n'
MARK_END = '# >>> end generated\n'


def write_interface_table():
    """Republish the domain/category breakdown into skill.interface, so the schema and
    the table cannot drift."""
    by_cat = Counter(s['category'] for s in SKILLS)
    lines = ['#\n', f'# CATALOGUE -- {len(SKILLS)} skills, {MAX_LEVEL} levels each.\n', '#\n']
    for domain in DOMAINS:
        total = sum(1 for s in SKILLS if s['domain'] == domain)
        lines.append(f'#   {domain.upper()}  ({total})\n')
        for cat in CATEGORY_ORDER[domain]:
            names = [s['name'] for s in SKILLS if s['category'] == cat]
            shown = ', '.join(names[:3]) + (', ...' if len(names) > 3 else '')
            lines.append(f'#     {cat:24} {by_cat[cat]:3}   {shown}\n')
    lines += ['#\n',
              '# STAT VOCABULARY -- an effect or penalty may only target a stat from\n',
              '# tools/stat_vocabulary.py ALL_STATS (SHIP_STATS, shared with modules, plus\n',
              '# SKILL_STATS, which have no hull field and so are skill-only).\n']
    text = open(IFACE).read()
    a, b = text.index(MARK_BEGIN), text.index(MARK_END)
    open(IFACE, 'w').write(text[:a] + MARK_BEGIN + ''.join(lines) + text[b:])


def report():
    print(f'skills        : {len(SKILLS)}')
    print('by domain     :', dict(Counter(s['domain'] for s in SKILLS)))
    print('by category   :', dict(Counter(s['category'] for s in SKILLS)))
    print('by scope      :', dict(Counter(s['scope'] for s in SKILLS)))
    print('by rank       :', dict(sorted(Counter(s['rank'] for s in SKILLS).items())))
    print('with effects  :', sum(1 for s in SKILLS if s['effects']))
    print('with penalties:', sum(1 for s in SKILLS if s['penalties']))
    print('with unlocks  :', sum(1 for s in SKILLS if s['unlocks']))
    print('with prereqs  :', sum(1 for s in SKILLS if s['prerequisites']))
    hulls = {u['target'] for s in SKILLS for u in s['unlocks'] if u['type'] == 'ship_operation'}
    print(f'hulls unlocked: {len(hulls)} categories at level {OPERATE_LEVEL} (control + systems)')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    report()
    if args.dry_run:
        return

    fleet = json.load(open(FLEET))
    fleet['skills'] = SKILLS
    fleet['_meta']['skillCount'] = len(SKILLS)
    fleet['_meta']['skillDomains'] = DOMAINS
    fleet['_meta']['skillMaxLevel'] = MAX_LEVEL
    with open(FLEET, 'w') as f:
        json.dump(fleet, f, indent=2); f.write('\n')

    # Skills/ also holds this feature's hand-written spec (Skills/Design), which the
    # whole catalogue is derived from -- it is not a purely-generated directory. Clear
    # only the generated domain subtrees and index.json, never the whole directory, so
    # a re-run can't silently delete the spec. Same exception Resources/ makes for its
    # two .md docs.
    for domain in DOMAINS:
        d = os.path.join(SKILLS_DIR, domain)
        if os.path.isdir(d):
            shutil.rmtree(d)
    old_index = os.path.join(SKILLS_DIR, 'index.json')
    if os.path.exists(old_index):
        os.remove(old_index)

    index = []
    for s in SKILLS:
        rel = os.path.join('Skills', s['domain'], s['category'], f"{s['skillId']}.json")
        path = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w') as f:
            json.dump(s, f, indent=2); f.write('\n')
        index.append({'skillId': s['skillId'], 'name': s['name'], 'domain': s['domain'],
                      'category': s['category'], 'rank': s['rank'], 'path': rel})

    by_domain = defaultdict(list)
    for s in SKILLS:
        by_domain[s['domain']].append(s['category'])
    with open(os.path.join(SKILLS_DIR, 'index.json'), 'w') as f:
        json.dump({
            'count': len(index),
            'maxLevel': MAX_LEVEL,
            'domains': [{'domain': d,
                         'count': len(by_domain[d]),
                         'categories': CATEGORY_ORDER[d]} for d in DOMAINS],
            'skills': index,
        }, f, indent=2)
        f.write('\n')

    write_interface_table()
    print(f'\nwrote {len(SKILLS)} skill files + Skills/index.json')


if __name__ == '__main__':
    main()
