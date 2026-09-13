#!/usr/bin/env python3
"""Deterministic progression catalogue.

Computes, never authors. Every figure is the live skill catalogue's own training
ladder divided by SP_PER_TURN, or a prerequisite closure walked over the live
prerequisite graph. Re-running reproduces the catalogue byte-for-byte.

Usage:
    python3 tools/generate_progression.py --dry-run
    python3 tools/generate_progression.py
"""
import argparse, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gameplay_tables as T
import gameplay_common as C

OUT = os.path.join(ROOT, 'GamePlay', 'Progression')
KEEP = set()          # Progression/ holds no hand-written docs; the specs live one level up


def expand(fleet, reqs):
    """Resolve @category / @domain selectors into explicit (skillId, level) pairs."""
    out = []
    for r in reqs:
        if r[0] == '@category':
            out += [(s['skillId'], r[2]) for s in fleet['skills'] if s['category'] == r[1]]
        elif r[0] == '@domain':
            out += [(s['skillId'], r[2]) for s in fleet['skills'] if s['domain'] == r[1]]
        else:
            out.append((r[0], r[1]))
    return out


def build(fleet):
    skills = C.skill_by_id(fleet)
    spt = T.SP_PER_TURN

    training = []
    for s in fleet['skills']:
        tr = s['training']
        training.append({
            'skillId': s['skillId'], 'name': s['name'], 'domain': s['domain'],
            'category': s['category'], 'rank': s['rank'],
            'levels': [{
                'level': i + 1,
                'sp': tr['spPerLevel'][i],
                'spCumulative': tr['spCumulative'][i],
                'turns': round(tr['spPerLevel'][i] / spt, 4),
                'turnsCumulative': round(tr['spCumulative'][i] / spt, 4),
            } for i in range(len(tr['spPerLevel']))],
            'spTotal': tr['spTotal'],
            'turnsTotal': round(tr['spTotal'] / spt, 2),
        })

    hull_paths = []
    for cat in fleet['_meta']['shipCategories']:
        gates = C.hull_gate_skills(fleet, cat)
        seen = C.prereq_closure(skills, gates)
        sp = C.closure_sp(skills, seen)
        heaviest = max((s['mass']['value'] for s in fleet['ships'] if s['shipClass'] == cat), default=0.0)
        hull_paths.append({
            'shipClass': cat,
            'gateSkills': [{'skillId': i, 'level': l} for i, l in sorted(gates)],
            'closure': [{'skillId': k, 'level': v} for k, v in sorted(seen.items())],
            'closureSkillCount': len(seen),
            'sp': sp,
            'turns': round(sp / spt, 2),
            'heaviestHullTons': heaviest,
        })
    hull_paths.sort(key=lambda h: h['sp'])

    careers = []
    for cid, name, reqs in T.CAREERS:
        seen = C.prereq_closure(skills, expand(fleet, reqs))
        sp = C.closure_sp(skills, seen)
        careers.append({'careerId': cid, 'name': name, 'skillCount': len(seen),
                        'sp': sp, 'turns': round(sp / spt, 1)})
    careers.sort(key=lambda c: c['sp'])

    everything = sum(s['training']['spTotal'] for s in fleet['skills'])
    index = {
        'turnLengthHours': T.TURN_LENGTH_HOURS,
        'spPerTurn': spt,
        'skillCount': len(fleet['skills']),
        'maxLevel': fleet['_meta']['skillMaxLevel'],
        'spToMaxEverything': everything,
        'turnsToMaxEverything': round(everything / spt),
        'yearsToMaxEverything': round(everything / spt / 365, 1),
        'startingPackage': {
            'hulls': T.STARTING_HULLS,
            'scienceLevel': T.STARTING_SCIENCE_LEVEL,
            'freeLeaseType': T.STARTING_FREE_LEASE_TYPE,
            'freeLeaseTurns': T.STARTING_FREE_LEASE_TURNS,
            'gateSkillsGranted': 'both ship_operation claimants of the chosen hull, at level 5',
        },
    }
    return training, hull_paths, careers, index


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    fleet = C.load_fleet()
    training, hull_paths, careers, index = build(fleet)

    print(f"skills          : {len(training)}")
    print(f"SP per turn     : {index['spPerTurn']:,}")
    print(f"hull paths      : {len(hull_paths)}  "
          f"({hull_paths[0]['turns']} .. {hull_paths[-1]['turns']} turns)")
    print(f"careers         : {len(careers)}  "
          f"({careers[0]['turns']} .. {careers[-1]['turns']} turns)")
    print(f"everything      : {index['spToMaxEverything']:,} SP = "
          f"{index['turnsToMaxEverything']:,} turns = {index['yearsToMaxEverything']} years")
    if args.dry_run:
        return

    C.clear_generated(OUT, KEEP)
    C.write_json(os.path.join(OUT, 'training_index.json'),
                 {'count': len(training), 'spPerTurn': index['spPerTurn'], 'skills': training})
    C.write_json(os.path.join(OUT, 'hull_paths.json'),
                 {'count': len(hull_paths), 'operateLevel': 5, 'hullPaths': hull_paths})
    C.write_json(os.path.join(OUT, 'careers.json'), {'count': len(careers), 'careers': careers})
    C.write_json(os.path.join(OUT, 'index.json'), index)

    fleet['progression'] = {'training': training, 'hullPaths': hull_paths,
                            'careers': careers, 'constants': index}
    fleet['_meta']['spPerTurn'] = index['spPerTurn']
    fleet['_meta']['turnLengthHours'] = index['turnLengthHours']
    C.write_json(C.FLEET, fleet)
    print(f"\nwrote GamePlay/Progression/ (4 files) + fleet json key 'progression'")


if __name__ == '__main__':
    main()
