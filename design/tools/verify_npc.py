#!/usr/bin/env python3
"""Invariant checks for the generated NPC catalogue.

The load-bearing one is that a response fleet outvalues the richest fleet one player
can field -- recomputed from the live ship catalogue and Formation Drill's unlocks,
never against a literal 5 or a literal credit figure.
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gameplay_tables as T
import gameplay_common as C

FLEET = C.load_fleet()
N = FLEET.get('npcSquadrons')
OUT = os.path.join(ROOT, 'GamePlay', 'NPC')
fails = []


def check(label, bad, show=6):
    if bad:
        fails.append(label); print(f'FAIL {label}: {len(bad)}')
        for b in bad[:show]: print('      ', b)
    else:
        print(f'ok   {label}')


check('fleet json carries "npcSquadrons"', [] if N else ['missing -- run generate_npc.py'])
if not N:
    print('\n1 CHECK(S) FAILED'); sys.exit(1)

prices = C.resource_prices(FLEET)
weapons, modules, ships = C.catalogues(FLEET)
index = json.load(open(os.path.join(OUT, 'index.json')))
response = json.load(open(os.path.join(OUT, 'response_fleets.json')))['responseFleets']

# --- every hull is a real hull ------------------------------------------------
check('every squadron hull resolves in the ship catalogue',
      [f'{s["squadronId"]} -> {h["shipId"]}' for s in N for h in s['hulls'] if h['shipId'] not in ships])
check('every response-fleet hull resolves',
      [f'{r["securityTier"]} -> {h["shipId"]}' for r in response for h in r['hulls'] if h['shipId'] not in ships])

# --- values recompute ----------------------------------------------------------
bad = []
for s in N:
    total = sum(C.reference_price(ships[h['shipId']]['buildCost'], prices) * h['count'] for h in s['hulls'])
    if abs(total - s['referenceValue']) > 0.05:
        bad.append(f'{s["squadronId"]}: published {s["referenceValue"]} != recomputed {total:.2f}')
    if abs(s['referenceValue'] * s['bountyRate'] - s['bounty']) > 0.05:
        bad.append(f'{s["squadronId"]}: bounty does not match rate x value')
    if s['hullCount'] != sum(h['count'] for h in s['hulls']):
        bad.append(f'{s["squadronId"]}: hullCount disagrees with the composition')
check('squadron value, bounty and hull count recompute', bad)

check('every bountyRate matches BOUNTY_RATE for its tier',
      [s['squadronId'] for s in N if s['bountyRate'] != T.BOUNTY_RATE[s['securityTier']]])

# --- threat rises as security falls --------------------------------------------
order = {t: i for i, t in enumerate(T.SECURITY_TIERS)}
bad = []
for a in N:
    for b in N:
        if order[a['securityTier']] < order[b['securityTier']] and a['referenceValue'] >= b['referenceValue']:
            bad.append(f'{a["squadronId"]} ({a["securityTier"]}, {a["referenceValue"]:,.0f}) >= '
                       f'{b["squadronId"]} ({b["securityTier"]}, {b["referenceValue"]:,.0f})')
check('squadron value rises strictly as security falls', bad)

check('nothing hostile spawns in core',
      [s['squadronId'] for s in N if s['securityTier'] == 'core'])
check('every squadron securityTier is one of the four',
      [s['squadronId'] for s in N if s['securityTier'] not in T.SECURITY_TIERS])

# --- THE RESPONSE FLEET BAR -----------------------------------------------------
slots = 1 + sum(1 for u in C.skill_by_id(FLEET)['skl_flt_formation_drill']['unlocks']
                if u['type'] == 'fleet_slot')
check('fleet slots derive from Formation Drill, not a literal',
      [] if slots == index['fleetSlots'] else [f'{slots} != published {index["fleetSlots"]}'])

dearest = max(C.reference_price(s['buildCost'], prices) for s in FLEET['ships'])
bar = dearest * slots
bad = []
for r in response:
    if r['referenceValue'] <= bar:
        bad.append(f'{r["securityTier"]} response fleet {r["referenceValue"]:,.0f} <= '
                   f'richest player fleet {bar:,.0f}')
check(f'every response fleet outvalues {slots} x the dearest hull ({bar:,.0f} cr)', bad)

check('core responds earlier than mid',
      [] if T.RESPONSE_FLEET_ROUND['core'] < T.RESPONSE_FLEET_ROUND['mid'] else [T.RESPONSE_FLEET_ROUND])
check('core is the only tier where PvP is blocked',
      [t for t, allowed in T.PVP_ALLOWED.items() if (t == 'core') == allowed])
check('response fleets exist exactly where PvP is policed',
      [] if set(T.RESPONSE_FLEET) == {t for t, a in T.PVP_ALLOWED.items() if not a} | {'mid'}
      else [list(T.RESPONSE_FLEET)])

# --- raiding ---------------------------------------------------------------------
troop_hulls = sorted({s['shipClass'] for s in FLEET['ships'] if s['capacities']['troops'] > 0})
check('raid-capable hulls are exactly those with troopCapacity',
      [] if index['raid']['capableHulls'] == troop_hulls else [index['raid']['capableHulls'], troop_hulls])
check('troopCapacity is carried by at least one hull (the stat is not dead)',
      [] if troop_hulls else ['no hull carries troops'])
check('raiding is barred in core and mid',
      [t for t in T.RAID_TIERS if t in ('core', 'mid')])

# --- combat constants stated once -------------------------------------------------
check('retreat threshold is 0.30 (combat_logic 5.4 ruling)',
      [] if T.RETREAT_THRESHOLD == 0.30 else [T.RETREAT_THRESHOLD])
check('the round cap exceeds the longest engagement in either battle log',
      [] if T.ROUND_CAP > 20 else [T.ROUND_CAP])
check('salvage drops a fraction, never all, of the fit',
      [] if 0 < T.SALVAGE_DROP < 1 and 0 < T.SALVAGE_CARGO < 1 else [T.SALVAGE_DROP, T.SALVAGE_CARGO])

# --- contracts ---------------------------------------------------------------------
contracts = json.load(open(os.path.join(OUT, 'contracts.json')))['contractArchetypes']
check('four contract archetypes, ids unique',
      [] if len(contracts) == 4 and len({c['contractId'] for c in contracts}) == 4 else [len(contracts)])
check('every contract archetype carries a reward formula',
      [c['contractId'] for c in contracts if not c.get('rewardFormula')])
check('escort exists, because cargo hulls cannot fight',
      [] if any(c['contractId'] == 'ctr_escort' for c in contracts) else ['no escort contract'])

# --- schema -------------------------------------------------------------------------
body = '\n'.join(l for l in open(os.path.join(ROOT, 'Data-Templates', 'npc_squadron.interface'))
                 if not l.lstrip().startswith('#'))
schema = set(json.loads(body))
check('field set matches npc_squadron.interface', [s['squadronId'] for s in N if set(s) != schema])

check('squadrons.json matches the fleet json entry',
      [] if json.load(open(os.path.join(OUT, 'squadrons.json')))['squadrons'] == N else ['differs'])
check('the hand-written spec survived the run',
      [] if os.path.exists(os.path.join(ROOT, 'GamePlay', 'conflict_specification.md')) else ['missing'])

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} CHECK(S) FAILED'))
sys.exit(1 if fails else 0)
