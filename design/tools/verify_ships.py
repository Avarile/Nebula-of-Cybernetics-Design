#!/usr/bin/env python3
"""Invariant checks for the generated tier hulls."""
import json, os, re, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from ship_tables import CATEGORIES, BY_KEY
from generate_ships import MOUNT_FOR_CLASS, CAPACITY_KEYS, TIERS

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
check('hardpoint size == fitted weapon size',
      [f'{s["shipId"]}:{h["hardpointId"]}' for s in ALL for h in s['hardpoints']['list']
       if h['weaponEquipped'] and W[h['weaponEquipped']]['size'] != h['size']])
check('mountType matches the weapon class',
      [f'{s["shipId"]}:{h["hardpointId"]}' for s in S for h in s['hardpoints']['list']
       if h['weaponEquipped']
       and MOUNT_FOR_CLASS[W[h['weaponEquipped']]['weaponClass']] != h['mountType']])
check('slot size/type == fitted module',
      [f'{s["shipId"]}:{m["slotId"]}' for s in ALL for m in s['moduleSlots']['list']
       if m['moduleEquipped'] and (M[m['moduleEquipped']]['size'] != m['size']
                                   or M[m['moduleEquipped']]['slotType'] != m['slotType'])])
check('fitted weapon mark == hull tier',
      [f'{s["shipId"]}:{h["hardpointId"]}' for s in S for h in s['hardpoints']['list']
       if h['weaponEquipped']
       and int(re.search(r'Mk\.(\d+)$', W[h['weaponEquipped']]['name']).group(1)) != s['tier']])
check('fitted module mark == hull tier',
      [f'{s["shipId"]}:{m["slotId"]}' for s in S for m in s['moduleSlots']['list']
       if m['moduleEquipped'] and M[m['moduleEquipped']]['mark'] != s['tier']])
check('specific modules only where hullAffinity allows',
      [f'{s["shipId"]}: {m["moduleEquipped"]}' for s in S for m in s['moduleSlots']['list']
       if m['moduleEquipped'] and M[m['moduleEquipped']]['hullAffinity']
       and s['shipClass'] not in M[m['moduleEquipped']]['hullAffinity']])
check('no module fitted twice on one hull',
      [s['shipId'] for s in S
       if len({m['moduleEquipped'] for m in s['moduleSlots']['list'] if m['moduleEquipped']})
       != len([m for m in s['moduleSlots']['list'] if m['moduleEquipped']])])

# the hull can actually run and man what is bolted to it
bad_p, bad_c = [], []
for s in S:
    volley = sum(W[h['weaponEquipped']]['powerCost'] * W[h['weaponEquipped']]['fireRate']['shotsPerTurn']
                 for h in s['hardpoints']['list'] if h['weaponEquipped'])
    passive = sum(M[m['moduleEquipped']]['powerCost']
                  for m in s['moduleSlots']['list'] if m['moduleEquipped'])
    if s['power']['maxPower'] < volley + passive:
        bad_p.append(f'{s["shipId"]}: {s["power"]["maxPower"]} < {volley + passive:.1f}')
    need = sum(M[m['moduleEquipped']]['crewRequired']
               for m in s['moduleSlots']['list'] if m['moduleEquipped'])
    if s['crew']['maxCrew'] < need:
        bad_c.append(f'{s["shipId"]}: crew {s["crew"]["maxCrew"]} < {need} required')
check('power covers passive draw + one full volley', bad_p)
check('crew covers fitted modules', bad_c)

check('every hull has at least one weapon and one module',
      [s['shipId'] for s in S
       if not any(h['weaponEquipped'] for h in s['hardpoints']['list'])
       or not any(m['moduleEquipped'] for m in s['moduleSlots']['list'])])
check('currentX == maxX on a fresh hull',
      [s['shipId'] for s in S
       if s['hull']['currentHP'] != s['hull']['maxHP']
       or s['shields']['currentHP'] != s['shields']['maxHP']
       or s['power']['currentPower'] != s['power']['maxPower']
       or s['crew']['currentCrew'] != s['crew']['maxCrew']])

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
