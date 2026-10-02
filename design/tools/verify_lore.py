#!/usr/bin/env python3
"""Invariant checks for the lore layer -- GamePlay/lore_specification.md 7.

tools/lore_tables.py names who stands behind numbers other tables own. This verifier
holds those names to the live catalogue (fleet_and_weapons.json), to the weapon
family biases, to Reference/lore.ts and to the lore document itself, recomputing
from the data rather than trusting any figure written down.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import lore_tables as L
import gameplay_tables as T
import generate_weapons as GW

FLEET = json.load(open(os.path.join(ROOT, 'fleet_and_weapons.json')))
SYSTEMS = FLEET['systems']
SYS_BY_NAME = {s['name']: s for s in SYSTEMS}
REGIONS = sorted({s['region'] for s in SYSTEMS})
TIERS_IN = {r: {s['securityTier'] for s in SYSTEMS if s['region'] == r} for r in REGIONS}
SQUADRONS = {q['squadronId']: q for q in FLEET['npcSquadrons']}
FAMILIES_LIVE = set(FLEET['_meta']['weaponFamilies'])
DOC = os.path.join(ROOT, 'GamePlay', 'lore_specification.md')
TS = os.path.join(ROOT, 'Reference', 'lore.ts')
fails = []

# Which direction is "better" on each FAMILIES axis.
FAVOURABLE = {'dmg': +1, 'rof': +1, 'cd': -1, 'trk': +1, 'hit': +1, 'rng': +1,
              'pwr': -1, 'crit': +1, 'var': -1, 'ammo': +1}
NEUTRAL = GW.FAMILIES['Vanguard']


def check(label, bad, show=6):
    if bad:
        fails.append(label); print(f'FAIL {label}: {len(bad)}')
        for b in bad[:show]: print('      ', b)
    else:
        print(f'ok   {label}')


print('--- factions ---')
ids = [f[0] for f in L.FACTIONS]
check('faction ids are unique and fac_<slug>',
      [i for i in ids if ids.count(i) > 1 or not re.fullmatch(r'fac_[a-z][a-z_]*', i)])
check('every faction kind is known', [f[0] for f in L.FACTIONS if f[2] not in L.FACTION_KINDS])
check('every faction home region exists in the live map', [f[0] for f in L.FACTIONS if f[3] not in REGIONS])
used = {v for v in L.REGION_AUTHORITY.values() if v} | set(L.SQUADRON_FACTION.values())
check('every faction id is used (authority by a region, hostile by a squadron)',
      [i for i in ids if i not in used])
check('every faction id referenced exists',
      sorted(used - set(ids)))

print('\n--- regions and authorities ---')
check('POLICED_TIERS is derived from RESPONSE_FLEET',
      [] if set(L.POLICED_TIERS) == set(T.RESPONSE_FLEET) and L.POLICED_TIERS else [L.POLICED_TIERS])
check('REGION_AUTHORITY covers exactly the live regions',
      sorted(set(REGIONS) ^ set(L.REGION_AUTHORITY)))
check('a region has an authority exactly when it holds a policed system',
      [f'{r}: authority={L.REGION_AUTHORITY.get(r)} tiers={sorted(TIERS_IN[r])}' for r in REGIONS
       if (L.REGION_AUTHORITY.get(r) is not None) != bool(TIERS_IN[r] & set(L.POLICED_TIERS))])
check('every policing faction is an authority',
      [v for v in L.REGION_AUTHORITY.values() if v and L.FACTION_BY_ID.get(v, ('', '', ''))[2] != 'authority'])
gov = [v for v in L.REGION_AUTHORITY.values() if v]
check('each authority polices exactly one region (standings re-key is outcome-neutral)',
      sorted({v for v in gov if gov.count(v) > 1}
             | {f[0] for f in L.FACTIONS if f[2] == 'authority' and f[0] not in gov}))
check('each authority polices its own home region',
      [f'{r} -> {v}' for r, v in L.REGION_AUTHORITY.items() if v and L.FACTION_BY_ID[v][3] != r])

print('\n--- NPC squadrons ---')
check('SQUADRON_FACTION covers exactly the live npcSquadrons',
      sorted(set(SQUADRONS) ^ set(L.SQUADRON_FACTION)))
check('...and exactly gameplay_tables.NPC_SQUADRONS',
      sorted({q[0] for q in T.NPC_SQUADRONS} ^ set(L.SQUADRON_FACTION)))
check('every squadron flies for a hostile faction',
      [k for k, v in L.SQUADRON_FACTION.items() if L.FACTION_BY_ID.get(v, ('', '', ''))[2] != 'hostile'])
bad = []
for sq, fac in L.SQUADRON_FACTION.items():
    if sq in SQUADRONS:
        home = L.FACTION_BY_ID[fac][3]
        if SQUADRONS[sq]['securityTier'] not in TIERS_IN.get(home, set()):
            bad.append(f'{sq} spawns in {SQUADRONS[sq]["securityTier"]}, but {fac} is homed in {home}')
check("every hostile faction's home region has the tiers its squadrons spawn in", bad)

print('\n--- manufacturers ---')
check('FAMILY_HOUSES covers exactly the live weapon families',
      sorted(FAMILIES_LIVE ^ set(L.FAMILY_HOUSES)))
check('...and exactly generate_weapons.FAMILIES',
      sorted(set(GW.FAMILIES) ^ set(L.FAMILY_HOUSES)))
check('every house home is a live system',
      [f'{f}: {h["home"]}' for f, h in L.FAMILY_HOUSES.items() if h['home'] not in SYS_BY_NAME])
# A family that shares a word with a place on the map must be homed in the MOST SPECIFIC
# such place: a system named after it if one exists, else such a constellation, else
# such a region. (Region-level alone is too loose: every Kestrel Span system would pass.)
bad = []
for fam, h in L.FAMILY_HOUSES.items():
    word = re.compile(rf'\b{re.escape(fam)}\b')
    for level in ('name', 'constellation', 'region'):
        places = {s['name'] for s in SYSTEMS if word.search(s[level])}
        if places:
            if h['home'] not in places:
                bad.append(f'{fam} is homed in {h["home"]}, not in a {fam} {level}: {sorted(places)}')
            break
check('a family named after a place is homed there', bad)


def score(fam, axis):
    return FAVOURABLE[axis] * GW.FAMILIES[fam][axis]


bad = []
for fam, h in L.FAMILY_HOUSES.items():
    for axis in h['strength']:
        if axis == 'early_effect':
            if fam != GW.EARLY_EFFECT_FAMILY:
                bad.append(f'{fam}: early_effect belongs to {GW.EARLY_EFFECT_FAMILY}')
            continue
        if axis not in FAVOURABLE:
            bad.append(f'{fam}: unknown axis {axis}'); continue
        best = max(score(f, axis) for f in GW.FAMILIES)
        winners = [f for f in GW.FAMILIES if score(f, axis) == best]
        if winners != [fam]:
            bad.append(f'{fam}: {axis} -- best is {winners}')
check("every stated strength is the family's unique best across all families", bad)
check('the early-effect family names early_effect as a strength',
      [] if 'early_effect' in L.FAMILY_HOUSES.get(GW.EARLY_EFFECT_FAMILY, {}).get('strength', [])
      else [GW.EARLY_EFFECT_FAMILY])
bad = []
for fam, h in L.FAMILY_HOUSES.items():
    worse = {a for a in FAVOURABLE if FAVOURABLE[a] * (GW.FAMILIES[fam][a] - NEUTRAL[a]) < 0}
    if set(h['pays']) != worse or len(h['pays']) != len(set(h['pays'])):
        bad.append(f'{fam}: pays {sorted(h["pays"])}, data says {sorted(worse)}')
check('every pays list is exactly the axes worse than Vanguard', bad)
check('Vanguard is the neutral line: no strength, no price, every bias neutral',
      [] if not L.FAMILY_HOUSES['Vanguard']['strength'] and not L.FAMILY_HOUSES['Vanguard']['pays']
      and all(v == (0 if k in ('cd', 'hit') else 1.0) for k, v in NEUTRAL.items()) else ['Vanguard'])
check('every other family has both a strength and a price',
      [f for f, h in L.FAMILY_HOUSES.items() if f != 'Vanguard' and not (h['strength'] and h['pays'])])

print('\n--- Reference/lore.ts mirror ---')
ts = open(TS).read()


def ts_union(name):
    m = re.search(rf'export type {name} =\n?(.*?);\n', ts, re.S)
    return set(re.findall(r"'([^']+)'", m.group(1))) if m else set()


def ts_block(name):
    m = re.search(rf'export const {name}\b[^=]*= \{{\n(.*?)\n\}}', ts, re.S)
    return m.group(1) if m else ''


def entries(block):
    """{key: body} for one-line `key: value,` entries."""
    out = {}
    for k, v in re.findall(r"^\s+'?([\w ]+?)'?: (.*?),?$", block, re.M):
        out[k] = v
    return out


def strs(text):
    return re.findall(r"'([^']*)'", text)


check('AuthorityFactionId matches the table',
      sorted(ts_union('AuthorityFactionId') ^ {f[0] for f in L.FACTIONS if f[2] == 'authority'}))
check('HostileFactionId matches the table',
      sorted(ts_union('HostileFactionId') ^ {f[0] for f in L.FACTIONS if f[2] == 'hostile'}))
check('FactionKind matches the table', sorted(ts_union('FactionKind') ^ set(L.FACTION_KINDS)))
check('NpcSquadronId matches the live squadrons', sorted(ts_union('NpcSquadronId') ^ set(SQUADRONS)))
got = {k: tuple(strs(v)) for k, v in entries(ts_block('FACTIONS')).items()}
check('FACTIONS matches the table',
      sorted(set(got.items()) ^ {(f[0], (f[1], f[2], f[3])) for f in L.FACTIONS}))
got = {k: (strs(v)[0] if strs(v) else None) for k, v in entries(ts_block('REGION_AUTHORITY')).items()}
check('REGION_AUTHORITY matches the table', sorted(set(got.items()) ^ set(L.REGION_AUTHORITY.items()), key=str))
got = {k: strs(v)[0] for k, v in entries(ts_block('SQUADRON_FACTION')).items()}
check('SQUADRON_FACTION matches the table', sorted(set(got.items()) ^ set(L.SQUADRON_FACTION.items())))
bad = []
ts_fam = entries(ts_block('FAMILY_ORIGINS'))
for fam, h in L.FAMILY_HOUSES.items():
    body = ts_fam.get(fam)
    if body is None:
        bad.append(f'{fam}: missing'); continue
    field = lambda k: re.search(rf"{k}: ('[^']*'|null|\[[^\]]*\])", body)
    want = {'house': repr(h['house']).replace('"', "'"), 'homeSystem': f"'{h['home']}'",
            'homeSystemId': f"'{SYS_BY_NAME[h['home']]['systemId']}'" if h['home'] in SYS_BY_NAME else '?',
            'originFaction': f"'{L.FAMILY_ORIGIN_FACTION[fam]}'" if L.FAMILY_ORIGIN_FACTION[fam] else 'null'}
    for k, v in want.items():
        m = field(k)
        if not m or m.group(1) != v:
            bad.append(f'{fam}.{k}: ts {m.group(1) if m else None}, table {v}')
    for k, v in (('strength', h['strength']), ('pays', h['pays'])):
        m = field(k)
        if not m or strs(m.group(1)) != v:
            bad.append(f'{fam}.{k}: ts {m.group(1) if m else None}, table {v}')
bad += [f'{f}: not a family' for f in ts_fam if f not in L.FAMILY_HOUSES]
check('FAMILY_ORIGINS matches the table, incl. derived origin faction and system id', bad)
check('Reference/index.ts exports lore.ts',
      [] if "export * from './lore';" in open(os.path.join(ROOT, 'Reference', 'index.ts')).read() else ['missing'])

print('\n--- the document and the schema ---')
doc = open(DOC).read()
check('lore_specification.md names every faction id', [i for i in ids if f'`{i}`' not in doc])
check('lore_specification.md names every region and family',
      [x for x in REGIONS + sorted(L.FAMILY_HOUSES) if x not in doc])
sec = re.search(r'^## 5\. Regions\n(.*?)^## ', doc, re.S | re.M)
bad = []
rows = {}
for line in (sec.group(1) if sec else '').splitlines():
    cells = [c.strip() for c in line.strip().strip('|').split('|')]
    if len(cells) == 6 and cells[0] in REGIONS:
        rows[cells[0]] = cells
for r in REGIONS:
    if r not in rows:
        bad.append(f'{r}: no row'); continue
    auth = rows[r][1].strip('`')
    if (auth if auth != '—' else None) != L.REGION_AUTHORITY.get(r):
        bad.append(f'{r}: authority {auth}')
    for i, t in enumerate(('core', 'mid', 'rim', 'deadspace')):
        n = sum(1 for s in SYSTEMS if s['region'] == r and s['securityTier'] == t)
        if rows[r][2 + i] != str(n):
            bad.append(f'{r} {t}: doc {rows[r][2 + i]}, map {n}')
check('lore_specification.md 5 region table matches the live map and REGION_AUTHORITY', bad)
pi = open(os.path.join(ROOT, 'Data-Templates', 'player.interface')).read()
m = re.search(r'"standings": "([^"]*)"', pi)
check('player.interface keys standings by authority factionId',
      [] if m and 'factionId' in m.group(1) and 'regionName' not in m.group(1) else [m.group(1) if m else 'no standings field'])

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} CHECK(S) FAILED'))
sys.exit(1 if fails else 0)
