#!/usr/bin/env python3
"""Naming checks: fixed data vs live state, and the turn / round clock.

gameplay_specification.md 3 fixes two clocks: a TURN is 24 real hours, a ROUND is one
exchange inside a battle. The catalogues are fixed data; anything play changes is
runtime state (CombatantState in Reference/combat.ts, FleetHull in Reference/gameplay.ts).
This verifier holds both lines across every name a consumer reads:

  1. no current* key anywhere in generated catalogue data (live values are runtime
     state), and no current* member in the Reference types of catalogue entities
  2. no name containing the word turn/turns -- in the catalogue data, the .interface
     schemas or the Reference types -- unless TURN_ALLOWLIST below names it, in that
     place, with the reason it may say turn
  3. every allowlist entry is still used, so the list cannot rot into a blanket pass
  4. a stat that says Round is ruled in the combat spec, and one that says Turn is not:
     the name's clock matches the clock of the rule that consumes it (STAT_RULES)

A name is split into words at camelCase humps, digits, dots and underscores, so
`turnaroundRounds` and `return` are not hits and `TURN_LENGTH_HOURS` is.

Run from anywhere:  python3 tools/verify_naming.py
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gameplay_tables as GT  # noqa: E402
from stat_vocabulary import ALL_STATS  # noqa: E402

fails = []


def check(label, bad, show=6):
    if bad:
        fails.append(label)
        print(f'FAIL {label}: {len(bad)}')
        for b in bad[:show]:
            print('      ', b)
    else:
        print(f'ok   {label}')


def words(name):
    """`rechargeRatePerRound` -> ['recharge', 'rate', 'per', 'round']."""
    parts = re.split(r'[^A-Za-z]+', name)
    out = []
    for p in parts:
        out += re.findall(r'[A-Z]+(?![a-z])|[A-Z]?[a-z]+', p)
    return [w.lower() for w in out]


def says_turn(name):
    return any(w in ('turn', 'turns') for w in words(name))


def is_live(name):
    w = words(name)
    return bool(w) and w[0] == 'current'


# --------------------------------------------------------------------- the allowlist
# (name, places, reason). A place is a path prefix relative to design/: a generated
# directory, a schema file, a Reference file, or one top-level array of the fleet json
# ('fleet_and_weapons.json#ships'). A name is allowed only in the places listed for it.
FLEET = 'fleet_and_weapons.json#'
GAMEPLAY_DATA = tuple(FLEET + k for k in ('_meta', 'progression', 'marketPrices', 'facilityTypes', 'stationTypes',
                                          'npcSquadrons', 'contractArchetypes', 'systems',
                                          'planets')) + ('GamePlay/', 'Systems_Planets/')
GAMEPLAY_SCHEMA = ('Data-Templates/contract.interface', 'Data-Templates/facility.interface',
                   'Data-Templates/market.interface', 'Data-Templates/npc_squadron.interface',
                   'Data-Templates/player.interface', 'Data-Templates/turn_order.interface',
                   'Data-Templates/planet.interface', 'Data-Templates/system.interface',
                   'Data-Templates/station.interface')
GAMEPLAY_TS = ('Reference/gameplay.ts', 'Reference/economy.ts', 'Reference/facilities.ts', 'Reference/stations.ts',
               'Reference/systems.ts', 'Reference/dataset.ts')
HEADING = 'heading change (turning), not the clock -- data-template.json mobility.turnRate'
TURN_ALLOWLIST = [
    # ---- the 24-hour turn: the clock GamePlay runs on
    ('turn', GAMEPLAY_DATA + GAMEPLAY_TS, 'a turn number'),
    ('turns', GAMEPLAY_DATA + GAMEPLAY_TS, 'a duration in 24-h turns (training ladder)'),
    ('turnsCumulative', GAMEPLAY_DATA + GAMEPLAY_TS, 'cumulative training time in 24-h turns'),
    ('turnsTotal', GAMEPLAY_DATA + GAMEPLAY_TS, 'total training time in 24-h turns'),
    ('turnsToMaxEverything', GAMEPLAY_DATA + GAMEPLAY_TS, 'all 81 skills, in 24-h turns'),
    ('turnLengthHours', GAMEPLAY_DATA + GAMEPLAY_TS, 'the length of a turn: 24'),
    ('spPerTurn', GAMEPLAY_DATA + GAMEPLAY_TS, 'skill points accrued per 24-h turn'),
    ('throughputPerTurn', GAMEPLAY_DATA + GAMEPLAY_TS + GAMEPLAY_SCHEMA,
     'facility slot output per 24-h turn'),
    ('constructionRatePerTurn', GAMEPLAY_DATA + GAMEPLAY_TS + GAMEPLAY_SCHEMA,
     'shipyard construction per 24-h turn'),
    ('rentPerTurn', GAMEPLAY_DATA + GAMEPLAY_TS + GAMEPLAY_SCHEMA, 'lease rent per 24-h turn'),
    ('premiumPerTurn', GAMEPLAY_DATA + GAMEPLAY_TS + GAMEPLAY_SCHEMA,
     'insurance premium per 24-h turn'),
    ('cycleTurns', GAMEPLAY_DATA + GAMEPLAY_TS + GAMEPLAY_SCHEMA,
     'a mining or production cycle, in 24-h turns'),
    ('aggressorFlagTurns', GAMEPLAY_DATA + GAMEPLAY_TS, 'aggressor flag duration in 24-h turns'),
    ('cooldownTurns', ('GamePlay/NPC/',), 'raid cooldown per warehouse, in 24-h turns'),
    ('freeLeaseTurns', GAMEPLAY_DATA + GAMEPLAY_TS + GAMEPLAY_SCHEMA,
     'starter lease, in 24-h turns'),
    ('lyPerTurn', GAMEPLAY_TS, 'jump range per 24-h turn'),
    ('perHullPerTurn', GAMEPLAY_TS, 'a per-hull rate per 24-h turn'),
    ('createdTurn', GAMEPLAY_SCHEMA + GAMEPLAY_TS, 'the turn a record was created'),
    ('startedTurn', GAMEPLAY_SCHEMA + GAMEPLAY_TS, 'the turn a lease or job started'),
    ('postedTurn', GAMEPLAY_SCHEMA + GAMEPLAY_TS, 'the turn a contract was posted'),
    ('expiresTurn', GAMEPLAY_SCHEMA + GAMEPLAY_TS, 'the turn a contract or order expires'),
    ('rentPaidThroughTurn', GAMEPLAY_SCHEMA + GAMEPLAY_TS, 'the last turn a lease is paid for'),
    ('freeUntilTurn', GAMEPLAY_SCHEMA + GAMEPLAY_TS, 'the last rent-free turn of a lease'),
    ('upkeepPerTurn', GAMEPLAY_DATA + GAMEPLAY_TS + GAMEPLAY_SCHEMA, 'station upkeep per 24-h turn'),
    ('upkeepPaidThroughTurn', GAMEPLAY_SCHEMA + GAMEPLAY_TS, 'the last turn a station is paid for'),
    ('offlineSinceTurn', GAMEPLAY_SCHEMA + GAMEPLAY_TS, 'the turn an unpaid station went offline'),
    ('upkeepGraceTurns', GAMEPLAY_DATA + ('Reference/constants.ts',),
     'offline 24-h turns before an unpaid station is scrapped'),
    ('diedTurn', GAMEPLAY_SCHEMA + GAMEPLAY_TS, 'the turn a hull was lost'),
    ('turnNumber', GAMEPLAY_SCHEMA + GAMEPLAY_TS, 'the turn an order is for'),
    ('TurnPhase', GAMEPLAY_TS, 'one of the 14 phases of the 24-h turn'),
    ('TurnOrder', GAMEPLAY_TS, 'an order submitted for the coming 24-h turn'),
    ('TurnLengthHours', GAMEPLAY_TS, 'the length of a turn, as a type: 24'),
    ('SpPerTurn', GAMEPLAY_TS, 'skill points per 24-h turn, as a type'),
    ('repairRatePerTurn', (FLEET + 'modules', FLEET + 'skills', 'Modules/', 'Ships/', 'Skills/',
                           'Reference/modules.ts', 'Reference/constants.ts'),
     'tender repair outside combat, per 24-h turn (logistics_specification.md 4)'),
    # ---- not the clock at all
    ('turnRate', (FLEET + 'ships', FLEET + 'namedShips', FLEET + 'modules', FLEET + 'skills',
                  'Ships/', 'Modules/', 'Skills/',
                  'Data-Templates/ship.interface', 'Reference/ships.ts', 'Reference/modules.ts',
                  'Reference/constants.ts', 'Reference/combat.ts'), HEADING),
    ('turn', ('Reference/ships.ts',), 'ShipCategorySignature.turn: the tier-1 turnRate seed; ' + HEADING),
    ('turnPenalty', ('Reference/combat.ts',), 'speed lost in a heading reversal (spec 2.4); ' + HEADING),
    ('turnPenaltyMax', ('Reference/constants.ts',), 'cap of the heading-reversal penalty; ' + HEADING),
    ('turnRateReference', ('Reference/constants.ts',), 'turnRate that zeroes the penalty; ' + HEADING),
]
ALLOWED = {}
for _name, _places, _why in TURN_ALLOWLIST:
    ALLOWED.setdefault(_name, []).extend(_places)
used = set()


def turn_hits(names):
    """names: iterable of (name, place). Returns the disallowed ones; records allowlist use.
    A dotted name (a stat path, a schema key like `slots.<key>.rentPerTurn`) is judged
    segment by segment, so each segment that says turn needs its own entry."""
    bad = []
    for name, place in sorted(set(names)):
        for seg in name.split('.'):
            if not says_turn(seg):
                continue
            if any(place.startswith(p) for p in ALLOWED.get(seg, ())):
                used.add(seg)
            else:
                bad.append(f'{place}: {name}')
    return bad


# --------------------------------------------------------------------- catalogue data
GENERATED_DIRS = ['Ships', 'Weapons', 'Modules', 'Resources/raw', 'Resources/refined',
                  'Resources/manufactured', 'Skills/ship_command', 'Skills/station_management',
                  'Skills/deep_space_mining', 'Skills/interaction_trade', 'GamePlay/Progression',
                  'GamePlay/Market', 'GamePlay/Facilities', 'GamePlay/Stations', 'GamePlay/NPC']
GENERATED_FILES = ['fleet_and_weapons.json', 'Ships/index.json', 'Weapons/index.json',
                   'Modules/index.json', 'Resources/index.json', 'Skills/index.json',
                   'Systems_Planets/index.json', 'Systems_Planets/links.json']


def keys(node):
    """Every key, plus every stat name an effect or penalty targets (`"stat": "..."`):
    a stat is a field name a consumer reads, carried as a value."""
    if isinstance(node, dict):
        for k, v in node.items():
            yield k
            if k == 'stat' and isinstance(v, str):
                yield v
            yield from keys(v)
    elif isinstance(node, list):
        for v in node:
            yield from keys(v)


def generated_json():
    paths = list(GENERATED_FILES)
    from system_tables import REGIONS
    dirs = GENERATED_DIRS + [f'Systems_Planets/{r[0] if isinstance(r, (tuple, list)) else r}'
                             for r in REGIONS]
    for d in dirs:
        for base, _, files in os.walk(os.path.join(ROOT, d)):
            paths += [os.path.relpath(os.path.join(base, f), ROOT) for f in files if f.endswith('.json')]
    return sorted(set(paths))


DATA_FILES = generated_json()
DATA_KEYS = set()
for rel in DATA_FILES:
    doc = json.load(open(os.path.join(ROOT, rel)))
    if rel == 'fleet_and_weapons.json':
        DATA_KEYS |= {(k, FLEET + top) for top, v in doc.items() for k in keys(v)}
    else:
        DATA_KEYS |= {(k, rel) for k in keys(doc)}
# The v2 combat JSON is hand-written, not generated, but its keys are the round
# structure's names; none of them may say turn.
V2 = 'Combat-logic/advanced_combat_system.json'
V2_KEYS = {(k, V2) for k in keys(json.load(open(os.path.join(ROOT, V2))))}
if len(DATA_FILES) < 2000:   # precondition, not a check: an empty scan would pass everything
    sys.exit(f'only {len(DATA_FILES)} generated json files found -- run the pipeline first')

check('no current* key in generated catalogue data (live values are runtime state)',
      sorted(f'{rel}: {k}' for k, rel in DATA_KEYS if is_live(k)))
check('no catalogue key or stat name says turn unless allowlisted',
      turn_hits(DATA_KEYS))
check('no key in the v2 combat JSON says turn', turn_hits(V2_KEYS))

# --------------------------------------------------------------------- .interface schemas
IFACE_KEYS = set()
for f in sorted(os.listdir(os.path.join(ROOT, 'Data-Templates'))):
    if not f.endswith('.interface'):
        continue
    body = '\n'.join(l for l in open(os.path.join(ROOT, 'Data-Templates', f))
                     if not l.lstrip().startswith('#'))
    for k in keys(json.loads(body)):
        IFACE_KEYS.add((k, f'Data-Templates/{f}'))
check('no .interface key says turn unless allowlisted', turn_hits(IFACE_KEYS))

# --------------------------------------------------------------------- Reference types
def ts_names(path):
    src = open(path).read()
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    src = re.sub(r'//[^\n]*', '', src)
    out = set(re.findall(r'\b(?:interface|type|const|enum|function|class)\s+(\w+)', src))
    out |= set(re.findall(r'^\s*(?:readonly\s+)?[\'"]?([A-Za-z_][\w.]*)[\'"]?\??\s*:', src, re.M))
    out |= set(re.findall(r"\|\s*'([A-Za-z_][\w.]*)'", src))
    out |= set(re.findall(r"'([A-Za-z_][\w.]*)'\s*\|", src))
    return out


TS_KEYS = set()
CATALOGUE_TS = ('common.ts', 'ships.ts', 'weapons.ts', 'modules.ts', 'resources.ts',
                'skills.ts', 'systems.ts')
live_ts = []
for f in sorted(os.listdir(os.path.join(ROOT, 'Reference'))):
    if f.endswith('.ts'):
        names = ts_names(os.path.join(ROOT, 'Reference', f))
        TS_KEYS |= {(n, f'Reference/{f}') for n in names}
        if f in CATALOGUE_TS:
            live_ts += [f'Reference/{f}: {n}' for n in sorted(names) if is_live(n)]
check('no current* member in the Reference types of catalogue entities', live_ts)
check('no Reference type, member or literal says turn unless allowlisted', turn_hits(TS_KEYS))

check('every allowlist entry is still used somewhere it is allowed',
      sorted({n for n, _, _ in TURN_ALLOWLIST} - used))

# --------------------------------------------------------------------- stat clocks
# A stat's name and the rule that consumes it must agree on the clock: a per-round stat
# is consumed inside a battle (the combat spec), a per-turn stat outside one.
COMBAT_DOC = 'Combat-logic/combat_logic_specification.md'
bad = []
for stat in ALL_STATS:
    doc = GT.STAT_RULES.get(stat, ('?',))[0]
    w = words(stat)
    if ('round' in w or 'rounds' in w) and doc != COMBAT_DOC:
        bad.append(f'{stat} says round but is ruled in {doc}')
    if ('turn' in w or 'turns' in w) and stat not in {'turnRate'} and doc == COMBAT_DOC:
        bad.append(f'{stat} says turn but is ruled in the combat spec')
check("every stat's clock word matches the document that rules it", bad)

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} CHECK(S) FAILED'))
sys.exit(1 if fails else 0)
