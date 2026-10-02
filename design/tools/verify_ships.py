#!/usr/bin/env python3
"""Invariant checks for the generated tier hulls."""
import json, os, re, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from ship_tables import CATEGORIES, BY_KEY
from generate_ships import CAPACITY_KEYS, TIERS
import fitting

FLEET = json.load(open(os.path.join(ROOT, 'fleet_and_weapons.json')))
S = FLEET['ships']
NAMED = FLEET['namedShips']
W = {w['weaponId']: w for w in FLEET['weapons']}
M = {m['moduleId']: m for m in FLEET['modules']}
fails = []

def check(label, bad, show=4):
    if bad:
        fails.append(label); print(f'FAIL {label}: {len(bad)}')
        for b in bad[:show]: print('      ', b)
    else:
        print(f'ok   {label}')

check('78 hulls: every category at every tier',
      [f'{c["key"]} t{t}' for c in CATEGORIES for t in TIERS
       if not any(s['shipClass'] == c['key'] and s['tier'] == t for s in S)])
check('unique shipIds', [k for k, v in Counter(s['shipId'] for s in S).items() if v > 1])
check('unique names',   [k for k, v in Counter(s['name'] for s in S).items() if v > 1])

body = '\n'.join(l for l in open(os.path.join(ROOT, 'Data-Templates', 'ship.interface'))
                 if not l.lstrip().startswith('#'))
schema = set(json.loads(body))
check('field set matches ship.interface', [s['shipId'] for s in S if set(s) != schema])
check('capacities keys complete',
      [s['shipId'] for s in S if set(s['capacities']) != set(CAPACITY_KEYS)])

# mass inside the band published in ship.interface
bad = []
for s in S:
    lo, hi = BY_KEY[s['shipClass']]['mass']
    if not lo <= s['mass']['value'] <= hi:
        bad.append(f'{s["shipId"]}: {s["mass"]["value"]} outside {lo}-{hi}')
check('mass inside the published band', bad)

# tier ladder within a category
bad = []
for c in CATEGORIES:
    tiers = sorted([s for s in S if s['shipClass'] == c['key']], key=lambda s: s['tier'])
    for a, b in zip(tiers, tiers[1:]):
        for path, get in (('mass', lambda x: x['mass']['value']),
                          ('hull.maxHP', lambda x: x['hull']['maxHP']),
                          ('shields.maxHP', lambda x: x['shields']['maxHP']),
                          ('power.maxPower', lambda x: x['power']['maxPower']),
                          ('crew.gunnerySkill', lambda x: x['crew']['gunnerySkill']),
                          ('detectionRange', lambda x: x['sensors']['detectionRange']),
                          ('buildCost', lambda x: sum(x['buildCost'].values()))):
            if get(b) < get(a):
                bad.append(f'{c["key"]} t{a["tier"]}->t{b["tier"]} {path}: {get(a)} -> {get(b)}')
        if len(b['hardpoints']['list']) < len(a['hardpoints']['list']):
            bad.append(f'{c["key"]} t{a["tier"]}->t{b["tier"]}: lost a hardpoint')
        if len(b['moduleSlots']['list']) < len(a['moduleSlots']['list']):
            bad.append(f'{c["key"]} t{a["tier"]}->t{b["tier"]}: lost a slot')
check('tier ladder monotonic within a category', bad)

ALL = S + NAMED
check('weaponEquipped ids resolve',
      [f'{s["shipId"]}:{h["hardpointId"]} -> {h["weaponEquipped"]}' for s in ALL
       for h in s['hardpoints']['list'] if h['weaponEquipped'] and h['weaponEquipped'] not in W])
check('moduleEquipped ids resolve',
      [f'{s["shipId"]}:{m["slotId"]} -> {m["moduleEquipped"]}' for s in ALL
       for m in s['moduleSlots']['list'] if m['moduleEquipped'] and m['moduleEquipped'] not in M])
# The fitting rules have ONE implementation, tools/fitting.py, which also validates a
# player's refit (GamePlay/fitting_specification.md 2). These checks call it rather than
# restating it; each reports the rules it names. Named ships are story hulls logged before
# the budgets existed, so they answer to the size and slot rules only (fitting spec 6).
PROBLEMS = {s['shipId']: fitting.fit_problems(s, fitting.default_fit(s), W, M) for s in ALL}


def broken(rules, hulls):
    return [f'{s["shipId"]}: {d}' for s in hulls for r, d in PROBLEMS[s['shipId']] if r in rules]


check('hardpoint size == fitted weapon size', broken({'weapon_size', 'items', 'mounts'}, ALL))
check('mountType is the mount the fitted weapon makes',
      [f'{s["shipId"]}:{h["hardpointId"]}' for s in S for h in s['hardpoints']['list']
       if h['weaponEquipped'] and fitting.mount_for(W[h['weaponEquipped']]) != h['mountType']])
check('slot type matches and the module fits the slot size', broken({'slot_type', 'slot_size'}, ALL))
check('tier hull slots carry the category module capacity as their size',
      [f'{s["shipId"]}:{m["slotId"]} {m["size"]}' for s in S for m in s['moduleSlots']['list']
       if m['size'] != BY_KEY[s['shipClass']]['mod_cap']])
check('fitted weapon mark == hull tier',
      [f'{s["shipId"]}:{h["hardpointId"]}' for s in S for h in s['hardpoints']['list']
       if h['weaponEquipped']
       and int(re.search(r'Mk\.(\d+)$', W[h['weaponEquipped']]['name']).group(1)) != s['tier']])
check('fitted module mark == hull tier',
      [f'{s["shipId"]}:{m["slotId"]}' for s in S for m in s['moduleSlots']['list']
       if m['moduleEquipped'] and M[m['moduleEquipped']]['mark'] != s['tier']])
check('specific modules only where hullAffinity allows', broken({'affinity'}, S))
check('no two modules of one moduleType on a hull', broken({'one_per_type'}, S))

# the hull can actually run and man what is bolted to it
check('power covers passive draw + one full volley', broken({'power'}, S))
check('crew covers fitted modules', broken({'crew'}, S))

check('every hull has at least one weapon and one module',
      [s['shipId'] for s in S
       if not any(h['weaponEquipped'] for h in s['hardpoints']['list'])
       or not any(m['moduleEquipped'] for m in s['moduleSlots']['list'])])

# Nested shape, not just the top level: every block of every hull (and named ship) carries
# exactly the keys ship.interface declares for it. `description` and `note` are upstream
# documentation keys the generated hulls omit. This is what holds live values (current*)
# out of the catalogue from the schema side; verify_naming.py holds them out of the data.
SCHEMA_DOC_KEYS = {'description', 'note'}


def shape_diff(spec, data, path):
    if isinstance(spec, dict) and isinstance(data, dict):
        out = [f'{path}.{k} missing' for k in sorted(set(spec) - set(data) - SCHEMA_DOC_KEYS)]
        out += [f'{path}.{k} not in schema' for k in sorted(set(data) - set(spec))]
        return out + [d for k in sorted(set(spec) & set(data))
                      for d in shape_diff(spec[k], data[k], f'{path}.{k}')]
    if isinstance(spec, list) and isinstance(data, list) and spec:
        return [d for i, x in enumerate(data) for d in shape_diff(spec[0], x, f'{path}[{i}]')]
    return []


nested = json.loads(body)
check('every nested block matches ship.interface',
      [d for s in S + NAMED   # a named ship adds only templateId, checked below
       for d in shape_diff(nested, {k: v for k, v in s.items() if k != 'templateId'}, s['shipId'])])

# named ships
check('named ships keep their identity',
      [n['shipId'] for n in NAMED if not n.get('name') or 'templateId' not in n or 'tier' not in n])
check('named ship templateIds resolve',
      [n['shipId'] for n in NAMED if n['templateId'] not in {s['shipId'] for s in S}])
check('named ship class matches its template',
      [n['shipId'] for n in NAMED
       if next(s for s in S if s['shipId'] == n['templateId'])['shipClass'] != n['shipClass']])

# files on disk: a hull is a directory holding ship.json + its Weapons/ and Modules/
disk, bad_layout = {}, []
for c in CATEGORIES:
    for t in TIERS:
        d = os.path.join(ROOT, 'Ships', c['folder'], f'tier-{t}')
        if not os.path.isdir(d):
            bad_layout.append(f'{c["folder"]}/tier-{t}/ missing'); continue
        for sub in ('Weapons', 'Modules'):
            if not os.path.isdir(os.path.join(d, sub)):
                bad_layout.append(f'{c["folder"]}/tier-{t}/{sub}/ missing')
        p = os.path.join(d, 'ship.json')
        if os.path.exists(p):
            disk[(c['key'], t)] = json.load(open(p))
        else:
            bad_layout.append(f'{c["folder"]}/tier-{t}/ship.json missing')
check('every hull is a directory with Weapons/ and Modules/', bad_layout)
check('78 ship.json on disk', [f'{len(disk)} vs {len(S)}'] if len(disk) != len(S) else [])
check('ship.json content == json', [s_['shipId'] for s_ in S if disk.get((s_['shipClass'], s_['tier'])) != s_])
check('no stale tier-N.json left behind',
      [f'{c["folder"]}/tier-{t}.json' for c in CATEGORIES for t in TIERS
       if os.path.exists(os.path.join(ROOT, 'Ships', c['folder'], f'tier-{t}.json'))])

# fitting files: one per filled mount, payload identical to the catalogue entry
DIRNAME = {s_['shipId']: f'tier-{s_["tier"]}' for s_ in S}
DIRNAME.update({n['shipId']: n['name'] for n in NAMED})
check('every named ship has a directory with Weapons/ and Modules/',
      [n['shipId'] for n in NAMED
       if not all(os.path.isdir(os.path.join(ROOT, 'Ships', BY_KEY[n['shipClass']]['folder'],
                                             n['name'], sub))
                  for sub in ('Weapons', 'Modules'))
       or not os.path.exists(os.path.join(ROOT, 'Ships', BY_KEY[n['shipClass']]['folder'],
                                          n['name'], 'ship.json'))])
check('named ship.json content == json',
      [n['shipId'] for n in NAMED
       if json.load(open(os.path.join(ROOT, 'Ships', BY_KEY[n['shipClass']]['folder'],
                                      n['name'], 'ship.json'))) != n])

bad_count, bad_payload, bad_path, bad_ctx = [], [], [], []
for s_ in ALL:
    d = os.path.join(ROOT, 'Ships', BY_KEY[s_['shipClass']]['folder'], DIRNAME[s_['shipId']])
    wf = sorted(f for f in os.listdir(os.path.join(d, 'Weapons')) if f.endswith('.json'))
    mf = sorted(f for f in os.listdir(os.path.join(d, 'Modules')) if f.endswith('.json'))
    filled_w = [h for h in s_['hardpoints']['list'] if h['weaponEquipped']]
    filled_m = [m for m in s_['moduleSlots']['list'] if m['moduleEquipped']]
    if len(wf) != len(filled_w) or len(mf) != len(filled_m):
        bad_count.append(f'{s_["shipId"]}: {len(wf)}/{len(filled_w)} weapons, {len(mf)}/{len(filled_m)} modules')
    for h in filled_w:
        hit = [f for f in wf if f.startswith(h['hardpointId'] + '_')]
        if len(hit) != 1:
            bad_count.append(f'{s_["shipId"]}:{h["hardpointId"]} -> {len(hit)} files'); continue
        o = json.load(open(os.path.join(d, 'Weapons', hit[0])))
        if o.get('hardpointId') != h['hardpointId'] or o.get('mountType') != h['mountType']:
            bad_ctx.append(f'{s_["shipId"]}:{h["hardpointId"]} context mismatch')
        if not os.path.exists(os.path.join(ROOT, o.get('catalogue', ''))):
            bad_path.append(f'{s_["shipId"]}:{h["hardpointId"]} -> {o.get("catalogue")}')
        payload = {k: v for k, v in o.items() if k not in ('hardpointId', 'mountType', 'catalogue')}
        if payload != W[h['weaponEquipped']]:
            bad_payload.append(f'{s_["shipId"]}:{h["hardpointId"]} != catalogue entry')
    for m in filled_m:
        hit = [f for f in mf if f.startswith(m['slotId'] + '_')]
        if len(hit) != 1:
            bad_count.append(f'{s_["shipId"]}:{m["slotId"]} -> {len(hit)} files'); continue
        o = json.load(open(os.path.join(d, 'Modules', hit[0])))
        if o.get('slotId') != m['slotId'] or o.get('slotType') != m['slotType']:
            bad_ctx.append(f'{s_["shipId"]}:{m["slotId"]} context mismatch')
        if not os.path.exists(os.path.join(ROOT, o.get('catalogue', ''))):
            bad_path.append(f'{s_["shipId"]}:{m["slotId"]} -> {o.get("catalogue")}')
        payload = {k: v for k, v in o.items() if k not in ('slotId', 'catalogue')}
        if payload != M[m['moduleEquipped']]:
            bad_payload.append(f'{s_["shipId"]}:{m["slotId"]} != catalogue entry')
check('one fitting file per filled mount', bad_count)
check('fitting context matches the hull', bad_ctx)
check('fitting payload identical to the catalogue entry', bad_payload)
check('every catalogue path resolves', bad_path)

idx = json.load(open(os.path.join(ROOT, 'Ships', 'index.json')))
check('index paths resolve',
      [e['shipId'] for e in idx['ships'] if not os.path.exists(os.path.join(ROOT, e['path']))])
by_sid = {x['shipId']: x for x in ALL}
check('index covers every hull and named ship',
      sorted({x['shipId'] for x in ALL} ^ {e['shipId'] for e in idx['ships']}))
check('index kinds correct',
      [e['shipId'] for e in idx['ships']
       if e['kind'] != ('template' if e['shipId'] in {x['shipId'] for x in S} else 'named')])
check('index fitting counts match the hulls',
      [e['shipId'] for e in idx['ships'] if e['shipId'] in by_sid
       for s_ in [by_sid[e['shipId']]]
       if e['weaponsFitted'] != len([h for h in s_['hardpoints']['list'] if h['weaponEquipped']])
       or e['modulesFitted'] != len([m for m in s_['moduleSlots']['list'] if m['moduleEquipped']])])
check('no ship directory without a ship in the data',
      [os.path.join(c['folder'], e) for c in CATEGORIES
       for e in sorted(os.listdir(os.path.join(ROOT, 'Ships', c['folder'])))
       if os.path.isdir(os.path.join(ROOT, 'Ships', c['folder'], e))
       and e not in ({f'tier-{t}' for t in TIERS} |
                     {n['name'] for n in NAMED if n['shipClass'] == c['key']})])

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} CHECK(S) FAILED'))
sys.exit(1 if fails else 0)
