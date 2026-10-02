#!/usr/bin/env python3
"""The fitting rules -- one implementation, three callers.

GamePlay/fitting_specification.md 2 states the rules; this module is the only code that
applies them. tools/generate_ships.py checks every default fit it builds against it,
tools/verify_ships.py and tools/verify_fitting.py check the catalogue against it, and a
`ship.refit` order is validated by it at intake and again in phase 6. A catalogue fit
and a player's fit are therefore judged by the same code, and cannot drift apart.

A FIT is the runtime shape `FleetHull.fit` carries (Reference/gameplay.ts `HullFit`):

    {'weapons': {hardpointId: weaponId | None}, 'modules': {slotId: moduleId | None}}

The rules read the hull's fixed layout (hardpoint sizes, slot types and sizes, the two
budgets) and the items' catalogue entries -- nothing else. No skill, no planet, no
player: whether a fit is legal is a property of the hull and the parts alone, so a fit
never becomes illegal because a skill changed or a module's effect was applied.
"""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ship_tables import SIZE_RANK, MOUNT_FOR_CLASS

# (rule id, what it requires). fitting_specification.md 2 tabulates exactly these ids;
# verify_fitting.py holds the two to each other.
RULES = [
    ('mounts',      'the fit names every hardpoint and slot of the hull, and nothing else'),
    ('items',       'every fitted id is a weapon on a hardpoint or a module in a slot, and exists'),
    ('weapon_size', 'a weapon goes only on a hardpoint of the same size'),
    ('slot_type',   'a module goes only in a slot of its own slotType'),
    ('slot_size',   'a module goes only in a slot of its own size or larger'),
    ('affinity',    "a specific module goes only on a hull whose shipClass is in its hullAffinity"),
    ('one_per_type', 'no two modules of one moduleType on a hull'),
    ('power',       'power.maxPower covers passive module draw plus one full weapon volley'),
    ('crew',        "crew.maxCrew covers the fitted modules' crewRequired"),
]
RULE_IDS = [r for r, _ in RULES]


def default_fit(ship):
    """The fit a catalogue hull arrives with -- its `weaponEquipped` / `moduleEquipped`."""
    return {'weapons': {h['hardpointId']: h['weaponEquipped'] for h in ship['hardpoints']['list']},
            'modules': {s['slotId']: s['moduleEquipped'] for s in ship['moduleSlots']['list']}}


def bare_fit(ship):
    """Every mount empty: the bare hull, which is always a legal fit."""
    return {'weapons': {h['hardpointId']: None for h in ship['hardpoints']['list']},
            'modules': {s['slotId']: None for s in ship['moduleSlots']['list']}}


def mount_for(weapon):
    """The mount a weapon makes of the hardpoint it is fitted to."""
    return MOUNT_FOR_CLASS[weapon['weaponClass']]


def fitted_items(fit):
    """(weaponIds, moduleIds) actually fitted, mounts in hull order, empties dropped."""
    return ([w for w in fit['weapons'].values() if w], [m for m in fit['modules'].values() if m])


def volley_power(fit, weapons):
    return sum(weapons[w]['powerCost'] * weapons[w]['fireRate']['shotsPerRound']
               for w in fit['weapons'].values() if w in weapons)


def passive_power(fit, modules):
    return sum(modules[m]['powerCost'] for m in fit['modules'].values() if m in modules)


def crew_need(fit, modules):
    return sum(modules[m]['crewRequired'] for m in fit['modules'].values() if m in modules)


def fit_problems(ship, fit, weapons, modules):
    """Every rule `fit` breaks on `ship`, as (ruleId, detail) pairs. Empty means legal.

    `weapons` and `modules` are the catalogues keyed by id. The budgets are the hull's
    printed `power.maxPower` and `crew.maxCrew`; module effects on those stats act in
    combat, never on what may be fitted.
    """
    out = []
    hps = {h['hardpointId']: h for h in ship['hardpoints']['list']}
    sls = {s['slotId']: s for s in ship['moduleSlots']['list']}
    for side, have, want in (('hardpoint', set(fit.get('weapons', {})), set(hps)),
                             ('slot', set(fit.get('modules', {})), set(sls))):
        out += [('mounts', f'{side} {k} is not on the hull') for k in sorted(have - want)]
        out += [('mounts', f'{side} {k} missing from the fit') for k in sorted(want - have)]

    seen_types = {}
    for hp_id, wid in sorted(fit.get('weapons', {}).items()):
        if wid is None or hp_id not in hps:
            continue
        w = weapons.get(wid)
        if w is None:
            out.append(('items', f'{hp_id}: {wid} is not a weapon'))
            continue
        if w['size'] != hps[hp_id]['size']:
            out.append(('weapon_size', f'{hp_id} is {hps[hp_id]["size"]}, {wid} is {w["size"]}'))
    for ms_id, mid in sorted(fit.get('modules', {}).items()):
        if mid is None or ms_id not in sls:
            continue
        m = modules.get(mid)
        if m is None:
            out.append(('items', f'{ms_id}: {mid} is not a module'))
            continue
        slot = sls[ms_id]
        if m['slotType'] != slot['slotType']:
            out.append(('slot_type', f'{ms_id} is {slot["slotType"]}, {mid} needs {m["slotType"]}'))
        if SIZE_RANK[m['size']] > SIZE_RANK[slot['size']]:
            out.append(('slot_size', f'{ms_id} takes up to {slot["size"]}, {mid} is {m["size"]}'))
        if m['hullAffinity'] and ship['shipClass'] not in m['hullAffinity']:
            out.append(('affinity', f'{mid} is not for a {ship["shipClass"]}'))
        if m['moduleType'] in seen_types:
            out.append(('one_per_type', f'{mid} and {seen_types[m["moduleType"]]} are both {m["moduleType"]}'))
        seen_types.setdefault(m['moduleType'], mid)

    need = volley_power(fit, weapons) + passive_power(fit, modules)
    if ship['power']['maxPower'] < need:
        out.append(('power', f'maxPower {ship["power"]["maxPower"]} < {need:.1f} needed'))
    crew = crew_need(fit, modules)
    if ship['crew']['maxCrew'] < crew:
        out.append(('crew', f'maxCrew {ship["crew"]["maxCrew"]} < {crew} required'))
    return out


def fit_is_valid(ship, fit, weapons, modules):
    return not fit_problems(ship, fit, weapons, modules)


def items_moved(old, new):
    """(installed, removed) item ids for a refit from fit `old` to fit `new` of one hull.
    A mount whose item does not change moves nothing; a swap moves two items."""
    installed, removed = [], []
    for side in ('weapons', 'modules'):
        for mount in sorted(set(old[side]) | set(new[side])):
            a, b = old[side].get(mount), new[side].get(mount)
            if a == b:
                continue
            if a:
                removed.append(a)
            if b:
                installed.append(b)
    return installed, removed


def fits_somewhere(item, kind, ships, weapons, modules):
    """The template hulls on which `item` alone is a legal fit -- one mount filled, every
    other empty. Used to prove no weapon or module is a dead good."""
    out = []
    for s in ships:
        mounts = s['hardpoints']['list'] if kind == 'weapons' else s['moduleSlots']['list']
        key = 'hardpointId' if kind == 'weapons' else 'slotId'
        for mt in mounts:
            fit = bare_fit(s)
            fit[kind][mt[key]] = item
            if fit_is_valid(s, fit, weapons, modules):
                out.append(s['shipId'])
                break
    return out
