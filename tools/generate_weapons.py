#!/usr/bin/env python3
"""Deterministic weapon-catalogue generator for Nebula-of-Cybernetics-Design.

Every stat is a pure function of (archetype, size, family, mark) -- no RNG.
Re-running regenerates a byte-identical catalogue.

    stat = size_anchor  x  archetype_signature  x  mark_ladder  x  family_bias

Usage:
    python3 tools/generate_weapons.py --dry-run   # report shape, write nothing
    python3 tools/generate_weapons.py             # regenerate everything
"""
import argparse, json, os, re, shutil, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FLEET = os.path.join(ROOT, 'fleet_and_weapons.json')
WEAPONS_DIR = os.path.join(ROOT, 'Weapons')
IFACE = os.path.join(ROOT, 'Data-Templates', 'weapon.interface')

SIZES = ['small', 'medium', 'large', 'capital']
SIZE_WORD = {'small': 'Light', 'medium': 'Medium', 'large': 'Heavy', 'capital': 'Siege'}

# ---------------------------------------------------------------- size anchors
# Absolute scale for a signature-1.0 archetype at that size.
ANCHOR = {
    'small':   {'dmg':  20.0, 'rng':  450, 'pwr':  6.0, 'ammo': 14},
    'medium':  {'dmg':  44.0, 'rng':  800, 'pwr': 13.0, 'ammo': 11},
    'large':   {'dmg':  95.0, 'rng': 1500, 'pwr': 26.0, 'ammo':  8},
    'capital': {'dmg': 190.0, 'rng': 2600, 'pwr': 48.0, 'ammo':  6},
}

# ------------------------------------------------------------------- mark ladder
# Strict power ladder: ~+13% damage per mark (1.63x over Mk.1->Mk.5), power cost
# rising sub-linearly so higher marks are better AND more efficient per point.
def mark_dmg(m):   return 1.13 ** (m - 1)
def mark_pwr(m):   return 1.075 ** (m - 1)
def mark_rng(m):   return 1.05 ** (m - 1)
def mark_trk(m):   return 1.06 ** (m - 1)
def mark_hit(m):   return 0.015 * (m - 1)
def mark_crit(m):  return 0.010 * (m - 1)
def mark_var(m):   return [0.180, 0.165, 0.150, 0.135, 0.110, 0.095][min(m, 6) - 1]

# ---------------------------------------------------------------------- families
# Manufacturer bias. Roughly trade-neutral: every gain is paid for somewhere.
# Vanguard is the neutral reference line every other family is measured against.
FAMILIES = {
    'Vanguard':  {'dmg': 1.00, 'rof': 1.00, 'cd':  0, 'trk': 1.00, 'hit':  0.00, 'rng': 1.00, 'pwr': 1.00, 'crit': 1.00, 'var': 1.00, 'ammo': 1.00},
    'Kestrel':   {'dmg': 0.72, 'rof': 1.50, 'cd':  0, 'trk': 1.05, 'hit':  0.00, 'rng': 0.92, 'pwr': 1.05, 'crit': 0.90, 'var': 1.00, 'ammo': 1.25},
    'Voss':      {'dmg': 1.05, 'rof': 0.70, 'cd': +1, 'trk': 0.90, 'hit':  0.00, 'rng': 1.45, 'pwr': 1.10, 'crit': 1.05, 'var': 1.00, 'ammo': 0.90},
    'Halcyon':   {'dmg': 0.85, 'rof': 1.00, 'cd':  0, 'trk': 1.30, 'hit': +0.07, 'rng': 1.00, 'pwr': 1.00, 'crit': 0.95, 'var': 0.90, 'ammo': 1.00},
    'Draconis':  {'dmg': 1.30, 'rof': 1.00, 'cd':  0, 'trk': 0.85, 'hit': -0.07, 'rng': 1.05, 'pwr': 1.20, 'crit': 1.10, 'var': 1.15, 'ammo': 0.85},
    'Obsidian':  {'dmg': 0.95, 'rof': 1.00, 'cd':  0, 'trk': 0.95, 'hit': -0.02, 'rng': 0.98, 'pwr': 0.98, 'crit': 1.60, 'var': 1.70, 'ammo': 1.00},
    'Meridian':  {'dmg': 0.93, 'rof': 1.00, 'cd':  0, 'trk': 1.15, 'hit': +0.02, 'rng': 1.00, 'pwr': 1.00, 'crit': 0.85, 'var': 0.45, 'ammo': 1.00},
    'Solari':    {'dmg': 0.90, 'rof': 1.00, 'cd':  0, 'trk': 1.00, 'hit':  0.00, 'rng': 1.00, 'pwr': 0.70, 'crit': 0.95, 'var': 1.00, 'ammo': 1.00},
    # Ceridan: see the sustain fallback in build() for infinite-ammo, no-cooldown weapons.
    'Ceridan':   {'dmg': 0.92, 'rof': 1.00, 'cd': -1, 'trk': 1.00, 'hit':  0.00, 'rng': 0.95, 'pwr': 1.05, 'crit': 0.95, 'var': 1.00, 'ammo': 1.60},
    'Ashwright': {'dmg': 0.97, 'rof': 1.00, 'cd':  0, 'trk': 1.00, 'hit':  0.00, 'rng': 1.02, 'pwr': 1.15, 'crit': 1.35, 'var': 1.00, 'ammo': 1.00},
}
# Ashwright's "stronger effect potency": unlocks its tier-2 effect one mark early.
EARLY_EFFECT_FAMILY = 'Ashwright'

# -------------------------------------------------------------------- archetypes
# dmg/rng/pwr/ammo are multipliers on the size anchor. trk/hit/crit are absolute
# at Mk.1. rof = shots per turn, cd = cooldown turns, span = maximum/optimal range.
def A(name, cls, sizes, fams, dmg, rof, cd, trk, hit, rng, span, fall, pwr, crit,
      ammo=None, eff1=(), eff3=(), eff5=()):
    return dict(name=name, cls=cls, sizes=sizes, fams=fams, dmg=dmg, rof=rof, cd=cd,
                trk=trk, hit=hit, rng=rng, span=span, fall=fall, pwr=pwr, crit=crit,
                ammo=ammo, eff1=list(eff1), eff3=list(eff3), eff5=list(eff5))

ARCHETYPES = [
    # ---- kinetic ------------------------------------------------------------
    A('Autocannon',      'kinetic', ['small', 'medium'],      ['Kestrel', 'Vanguard'],
      dmg=0.85, rof=3, cd=0, trk=42, hit=0.82, rng=0.78, span=1.75, fall=0.06, pwr=0.95, crit=0.06,
      eff3=['armor_piercing']),
    A('AA Autocannon',   'kinetic', ['small', 'medium'],      ['Vanguard', 'Kestrel', 'Meridian'],
      dmg=0.52, rof=6, cd=0, trk=68, hit=0.88, rng=0.60, span=1.55, fall=0.11, pwr=0.85, crit=0.05,
      eff1=['anti_air', 'point_defense'], eff3=['anti_missile'], eff5=['high_tracking']),
    A('Chain Gun',       'kinetic', ['small'],                ['Kestrel', 'Obsidian', 'Vanguard'],
      dmg=0.45, rof=5, cd=0, trk=55, hit=0.86, rng=0.62, span=1.60, fall=0.10, pwr=0.80, crit=0.05,
      eff1=['high_tracking'], eff3=['multi_hit']),
    A('PD Autocannon',   'kinetic', ['small'],                ['Halcyon', 'Meridian', 'Vanguard'],
      dmg=0.40, rof=6, cd=0, trk=72, hit=0.90, rng=0.55, span=1.50, fall=0.13, pwr=0.78, crit=0.05,
      eff1=['point_defense', 'anti_missile'], eff3=['high_tracking']),
    A('Flak Cannon',     'kinetic', ['small', 'medium'],      ['Vanguard', 'Ceridan'],
      dmg=0.70, rof=3, cd=1, trk=58, hit=0.80, rng=0.70, span=1.65, fall=0.09, pwr=0.90, crit=0.07,
      eff1=['anti_air', 'proximity_trigger'], eff3=['area_denial']),
    A('Coilgun',         'kinetic', ['small', 'medium'],      ['Ceridan', 'Voss'],
      dmg=1.15, rof=2, cd=1, trk=28, hit=0.76, rng=1.15, span=1.85, fall=0.05, pwr=1.10, crit=0.09,
      eff1=['armor_piercing'], eff3=['shield_disrupt']),
    A('Gauss Cannon',    'kinetic', ['large', 'capital'],     ['Draconis', 'Solari'],
      dmg=1.45, rof=1, cd=1, trk=16, hit=0.70, rng=1.20, span=1.90, fall=0.04, pwr=1.20, crit=0.13,
      eff1=['armor_piercing'], eff3=['shield_disrupt']),
    A('Mass Driver',     'kinetic', ['medium', 'large'],      ['Draconis', 'Ashwright'],
      dmg=2.10, rof=1, cd=2, trk=9,  hit=0.62, rng=1.30, span=2.00, fall=0.03, pwr=1.35, crit=0.16,
      eff1=['armor_piercing'], eff3=['armor_melt']),
    A('Railgun',         'kinetic', ['medium', 'large'],      ['Voss', 'Solari', 'Halcyon'],
      dmg=1.30, rof=1, cd=1, trk=20, hit=0.74, rng=1.40, span=1.95, fall=0.04, pwr=1.10, crit=0.11,
      eff1=['armor_piercing'], eff3=['ignores_shields_partial']),
    # ---- energy -------------------------------------------------------------
    A('Pulse Laser',     'energy',  ['small', 'medium'],      ['Halcyon', 'Vanguard'],
      dmg=0.80, rof=3, cd=0, trk=48, hit=0.86, rng=0.85, span=1.80, fall=0.08, pwr=1.00, crit=0.05,
      eff3=['high_tracking']),
    A('PD Laser Turret', 'energy',  ['small'],                ['Halcyon', 'Meridian', 'Solari'],
      dmg=0.38, rof=6, cd=0, trk=78, hit=0.92, rng=0.58, span=1.50, fall=0.14, pwr=0.85, crit=0.04,
      eff1=['point_defense', 'anti_missile'], eff3=['high_tracking']),
    A('Beam Laser',      'energy',  ['medium', 'large'],      ['Voss', 'Halcyon'],
      dmg=1.25, rof=2, cd=1, trk=30, hit=0.84, rng=1.25, span=1.70, fall=0.07, pwr=1.30, crit=0.08,
      eff1=['armor_melt'], eff3=['shield_disrupt']),
    A('Disruptor Beam',  'energy',  ['small', 'medium'],      ['Ashwright', 'Obsidian'],
      dmg=0.90, rof=2, cd=1, trk=36, hit=0.82, rng=0.90, span=1.70, fall=0.08, pwr=1.15, crit=0.10,
      eff1=['shield_disrupt'], eff3=['emp_disable']),
    A('Ion Cannon',      'energy',  ['medium', 'large', 'capital'], ['Draconis', 'Ashwright', 'Solari'],
      dmg=1.20, rof=1, cd=1, trk=22, hit=0.76, rng=1.10, span=1.85, fall=0.06, pwr=1.25, crit=0.12,
      eff1=['emp_disable'], eff3=['shield_disrupt']),
    A('Plasma Cannon',   'energy',  ['large', 'capital'],     ['Draconis', 'Ashwright'],
      dmg=1.70, rof=1, cd=2, trk=14, hit=0.68, rng=0.95, span=1.60, fall=0.09, pwr=1.40, crit=0.15,
      eff1=['armor_melt'], eff3=['area_denial']),
    A('Proton Blaster',  'energy',  ['medium', 'large'],      ['Solari', 'Kestrel'],
      dmg=1.00, rof=2, cd=0, trk=34, hit=0.80, rng=0.88, span=1.75, fall=0.08, pwr=1.05, crit=0.08,
      eff3=['shield_disrupt']),
    A('Particle Lance',  'energy',  ['large', 'capital'],     ['Draconis', 'Voss'],
      dmg=2.60, rof=1, cd=3, trk=6,  hit=0.60, rng=1.45, span=1.50, fall=0.05, pwr=1.60, crit=0.22,
      eff1=['ignores_shields_partial', 'armor_piercing'], eff3=['armor_melt']),
    A('Arc Projector',   'energy',  ['small', 'medium'],      ['Obsidian', 'Meridian'],
      dmg=0.65, rof=3, cd=1, trk=44, hit=0.84, rng=0.50, span=1.40, fall=0.16, pwr=1.10, crit=0.09,
      eff1=['multi_hit'], eff3=['emp_disable']),
    # ---- missile ------------------------------------------------------------
    A('Seeker Missile',  'missile', ['small', 'medium'],      ['Halcyon', 'Ceridan'],
      dmg=1.10, rof=1, cd=1, trk=62, hit=0.78, rng=1.50, span=1.90, fall=0.03, pwr=1.05, crit=0.09, ammo=1.0,
      eff1=['can_be_intercepted', 'high_tracking'], eff3=['armor_piercing']),
    A('Missile Rack',    'missile', ['small', 'medium'],      ['Kestrel', 'Ceridan'],
      dmg=0.75, rof=3, cd=1, trk=40, hit=0.74, rng=1.30, span=1.85, fall=0.04, pwr=0.95, crit=0.07, ammo=1.4,
      eff1=['can_be_intercepted'], eff3=['multi_hit']),
    A('Swarm Missile Pod','missile',['small', 'medium'],      ['Kestrel', 'Obsidian'],
      dmg=0.55, rof=5, cd=2, trk=50, hit=0.70, rng=1.20, span=1.80, fall=0.05, pwr=1.00, crit=0.06, ammo=2.0,
      eff1=['multi_hit', 'can_be_intercepted'], eff3=['high_tracking']),
    A('Torpedo Launcher','missile', ['medium', 'large'],      ['Draconis', 'Vanguard', 'Meridian'],
      dmg=2.00, rof=1, cd=2, trk=15, hit=0.66, rng=1.35, span=1.85, fall=0.03, pwr=1.25, crit=0.14, ammo=0.7,
      eff1=['ignores_shields_partial', 'can_be_intercepted'], eff3=['armor_piercing']),
    A('Cruise Missile Bay','missile',['large', 'capital'],    ['Voss', 'Ashwright'],
      dmg=2.30, rof=1, cd=3, trk=12, hit=0.64, rng=2.10, span=2.10, fall=0.02, pwr=1.45, crit=0.18, ammo=0.6,
      eff1=['can_be_intercepted', 'area_denial'], eff3=['armor_melt']),
    A('Interceptor Missile','missile',['small', 'medium'],    ['Halcyon', 'Meridian'],
      dmg=0.48, rof=4, cd=1, trk=80, hit=0.86, rng=1.10, span=1.70, fall=0.06, pwr=0.90, crit=0.05, ammo=1.8,
      eff1=['anti_missile', 'anti_air'], eff3=['high_tracking'], eff5=['multi_hit']),
    # ---- mine ---------------------------------------------------------------
    A('Mine Layer',      'mine',    ['medium', 'large'],      ['Ceridan', 'Meridian'],
      dmg=1.40, rof=1, cd=2, trk=18, hit=0.76, rng=0.95, span=1.95, fall=0.04, pwr=1.05, crit=0.11, ammo=1.2,
      eff1=['area_denial', 'proximity_trigger'], eff3=['armor_piercing']),
    A('Proximity Mine Dispenser','mine',['small', 'medium'],  ['Obsidian', 'Ceridan'],
      dmg=0.95, rof=2, cd=1, trk=26, hit=0.80, rng=0.72, span=1.70, fall=0.07, pwr=0.90, crit=0.10, ammo=1.5,
      eff1=['proximity_trigger'], eff3=['area_denial']),
    A('Depth Charge Rack','mine',   ['small', 'medium'],      ['Vanguard', 'Kestrel'],
      dmg=1.25, rof=2, cd=2, trk=10, hit=0.72, rng=0.42, span=1.35, fall=0.18, pwr=0.85, crit=0.13, ammo=1.3,
      eff1=['area_denial', 'proximity_trigger'], eff3=['armor_melt']),
    A('Siege Mine Cluster','mine',  ['large', 'capital'],     ['Ashwright', 'Draconis'],
      dmg=1.85, rof=1, cd=3, trk=8,  hit=0.70, rng=0.85, span=1.90, fall=0.05, pwr=1.20, crit=0.17, ammo=0.9,
      eff1=['area_denial', 'multi_hit'], eff3=['proximity_trigger']),
    # ---- melee --------------------------------------------------------------
    A('Boarding Ram',    'melee',   ['medium', 'large'],      ['Draconis', 'Vanguard'],
      dmg=3.20, rof=1, cd=3, trk=4,  hit=0.55, rng=0.04, span=1.10, fall=0.60, pwr=0.60, crit=0.25,
      eff1=['armor_piercing'], eff3=['armor_melt']),
    A('Grapple Harpoon', 'melee',   ['small', 'medium'],      ['Kestrel', 'Meridian'],
      dmg=0.60, rof=1, cd=2, trk=30, hit=0.72, rng=0.12, span=1.20, fall=0.45, pwr=0.75, crit=0.08,
      eff1=['emp_disable'], eff3=['armor_piercing']),
    A('Siege Drill',     'melee',   ['large', 'capital'],     ['Ashwright', 'Draconis'],
      dmg=2.80, rof=2, cd=2, trk=5,  hit=0.58, rng=0.06, span=1.15, fall=0.55, pwr=1.10, crit=0.20,
      eff1=['armor_melt', 'armor_piercing'], eff3=['ignores_shields_partial']),
]
BY_NAME = {a['name']: a for a in ARCHETYPES}
MARKS = [1, 2, 3, 4, 5]


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def build(arch, size, family, mark):
    """Pure function: (archetype, size, family, mark) -> weapon stat block."""
    an, fb = ANCHOR[size], FAMILIES[family]

    dmg = an['dmg'] * arch['dmg'] * mark_dmg(mark) * fb['dmg']
    var = dmg * mark_var(mark) * fb['var']

    shots = max(1, round(arch['rof'] * fb['rof']))
    cooldown = max(0, arch['cd'] + fb['cd'])
    # A family bias that lands on an axis the archetype does not have would make that
    # family's whole line strictly worse than neutral Vanguard. Ceridan's sustain bias
    # (+ammo, -cooldown) is inert on a weapon with infinite ammo and no cooldown, so it
    # re-expresses as continuous fire instead.
    if family == 'Ceridan' and arch['ammo'] is None and arch['cd'] == 0:
        shots += 1
    # Mk.5 capability step: sustained-fire weapons shed a cooldown turn.
    if mark >= 5 and cooldown >= 2:
        cooldown -= 1

    hit = clamp(arch['hit'] + mark_hit(mark) + fb['hit'], 0.35, 0.95)
    trk = max(1, round(arch['trk'] * fb['trk'] * mark_trk(mark)))
    opt = round(an['rng'] * arch['rng'] * fb['rng'] * mark_rng(mark))
    mx = round(opt * arch['span'])
    # one decimal: whole-point rounding flattens the ~7.5%/mark step on cheap lines,
    # which would either gift a free upgrade or force a +1 bump that erases a
    # cost-focused family's whole identity (Solari).
    pwr = max(0.5, round(an['pwr'] * arch['pwr'] * fb['pwr'] * mark_pwr(mark), 1))
    crit = clamp(arch['crit'] * fb['crit'] + mark_crit(mark), 0.02, 0.45)

    if arch['ammo'] is None:
        ammo = 'infinite'
    else:
        ammo = max(1, round(an['ammo'] * arch['ammo'] * fb['ammo'] * (1 + 0.06 * (mark - 1))))

    # Effect unlocks are a visible capability step, not just bigger numbers.
    # Ashwright ("effect potency") reaches its tier-2 effect one mark early.
    t2 = 2 if family == EARLY_EFFECT_FAMILY else 3
    effects = list(arch['eff1'])
    if mark >= t2:
        effects += arch['eff3']
    if mark >= 5:
        effects += arch['eff5']

    return {
        'weaponId': None,
        'name': None,
        'weaponClass': arch['cls'],
        'size': size,
        'damage': {'base': round(dmg, 1), 'variance': round(var, 1), 'damageType': DAMAGE_TYPE[arch['cls']]},
        'range': {'optimal': opt, 'maximum': mx, 'falloffPenalty': arch['fall']},
        'accuracy': {'baseHitChance': round(hit, 2), 'tracking': trk},
        'fireRate': {'shotsPerTurn': shots, 'cooldownTurns': cooldown},
        'powerCost': pwr,
        'ammo': ammo,
        'criticalChance': round(crit, 2),
        'specialEffects': effects,
    }


DAMAGE_TYPE = {'kinetic': 'kinetic', 'energy': 'energy', 'missile': 'explosive',
               'mine': 'explosive', 'melee': 'kinetic'}


SIZE_WORDS = set(SIZE_WORD.values())


def split_name(name):
    """'Ashwright Siege Drill Mk.2' -> ('Ashwright', None, 'Siege Drill', 2)
       'Halcyon Heavy Ion Cannon Mk.3' -> ('Halcyon', 'Heavy', 'Ion Cannon', 3)

    Resolved against the archetype table, not by stripping words: 'Siege Drill' and
    'Siege Mine Cluster' start with a size word that is part of the archetype name.
    """
    m = re.match(r'^(\S+) (.*) Mk\.(\d+)$', name)
    if not m:
        sys.exit(f'unparseable weapon name: {name}')
    fam, rest, mk = m.group(1), m.group(2), int(m.group(3))
    if rest in BY_NAME:
        return fam, None, rest, mk
    first, _, tail = rest.partition(' ')
    if first in SIZE_WORDS and tail in BY_NAME:
        return fam, first, tail, mk
    return fam, None, rest, mk


def name_key(name):
    fam, _, arch, mk = split_name(name)
    return fam, arch, mk



MARK_BEGIN = '# <<< generated from tools/generate_weapons.py -- do not edit by hand\n'
MARK_END = '# >>> end generated\n'


def write_interface_tables(weapons):
    """Rewrite the archetype/family tables inside Data-Templates/weapon.interface so the
    documented model and the generated data cannot drift apart."""
    per_arch = Counter(name_key(w['name'])[1] for w in weapons)
    lines = ['# ARCHETYPES -- the role signature. "sizes" are the hardpoint sizes it is built in.\n',
             '#\n',
             f'#   {"archetype":24} {"class":8} {"sizes":26} {"n":>4}  families\n']
    for a in ARCHETYPES:
        lines.append(f'#   {a["name"]:24} {a["cls"]:8} {"/".join(a["sizes"]):26} '
                     f'{per_arch[a["name"]]:>4}  {", ".join(a["fams"])}\n')
    lines += ['#\n',
              '# FAMILIES -- manufacturer bias, applied on top of the archetype signature.\n',
              '#   x1.00 / +0.00 means that family leaves the stat at the reference value.\n',
              '#\n',
              f'#   {"family":10} {"dmg":>5} {"rof":>5} {"cd":>4} {"trk":>5} {"hit":>6} '
              f'{"rng":>5} {"pwr":>5} {"crit":>5} {"var":>5} {"ammo":>5}   n\n']
    per_fam = Counter(name_key(w['name'])[0] for w in weapons)
    for fam in sorted(FAMILIES, key=lambda f: (f != 'Vanguard', f)):
        b = FAMILIES[fam]
        lines.append(f'#   {fam:10} {b["dmg"]:5.2f} {b["rof"]:5.2f} {b["cd"]:+4d} {b["trk"]:5.2f} '
                     f'{b["hit"]:+6.2f} {b["rng"]:5.2f} {b["pwr"]:5.2f} {b["crit"]:5.2f} '
                     f'{b["var"]:5.2f} {b["ammo"]:5.2f}  {per_fam[fam]:>3}\n')
    lines += ['#\n',
              '#   Ceridan sustain (+ammo, -cooldown) is inert on an infinite-ammo, no-cooldown\n',
              '#   weapon; there it re-expresses as +1 shot per turn, so a Ceridan line is never\n',
              '#   just a worse Vanguard. Ashwright "effect potency" unlocks its second\n',
              '#   specialEffect at Mk.2 instead of Mk.3.\n']

    text = open(IFACE).read()
    a, b = text.index(MARK_BEGIN), text.index(MARK_END)
    open(IFACE, 'w').write(text[:a] + MARK_BEGIN + ''.join(lines) + text[b:])


def has_size_word(name):
    return split_name(name)[1] is not None


def parse_legacy_name(name):
    """(family, archetype, mark) -- size word stripped, so re-running the generator
    over its own output reproduces the same grid (idempotent)."""
    return name_key(name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    fleet = json.load(open(FLEET))
    legacy = fleet['weapons']

    # --- cell set: curated cross-product, unioned with every legacy cell so that
    #     all 200 existing weaponIds keep a home (and their names).
    cells = []
    seen = set()
    for a in ARCHETYPES:
        for size in a['sizes']:
            for fam in a['fams']:
                for mk in MARKS:
                    key = (a['name'], size, fam, mk)
                    if key not in seen:
                        seen.add(key); cells.append(key)

    legacy_cell = {}          # weaponId -> cell
    extra = 0
    for w in legacy:
        fam, arch, mk = parse_legacy_name(w['name'])
        key = (arch, w['size'], fam, mk)
        legacy_cell[w['weaponId']] = key
        if key not in seen:
            seen.add(key); cells.append(key); extra += 1
        if arch not in BY_NAME:
            sys.exit(f'legacy archetype missing from tables: {arch}')

    # --- naming: bare "<Family> <Archetype> Mk.N" is unique only per (fam,arch,mk).
    #     When that group spans several sizes, the size the legacy weapon occupied
    #     keeps the bare name; the others take a size word.
    # Whichever size held the bare (un-prefixed) name keeps it; otherwise first seen.
    legacy_bare = {}
    for w in legacy:
        if not has_size_word(w['name']):
            legacy_bare[parse_legacy_name(w['name'])] = w['size']
    for w in legacy:
        legacy_bare.setdefault(parse_legacy_name(w['name']), w['size'])

    groups = defaultdict(list)
    for (arch, size, fam, mk) in cells:
        groups[(fam, arch, mk)].append(size)

    def name_for(arch, size, fam, mk):
        sizes = groups[(fam, arch, mk)]
        if len(sizes) == 1:
            return f'{fam} {arch} Mk.{mk}'
        bare = legacy_bare.get((fam, arch, mk)) or sorted(sizes, key=SIZES.index)[0]
        if size == bare:
            return f'{fam} {arch} Mk.{mk}'
        return f'{fam} {SIZE_WORD[size]} {arch} Mk.{mk}'

    # --- id assignment: legacy ids pinned to their cells, new cells numbered after.
    cell_id = {v: k for k, v in legacy_cell.items()}
    ordered = sorted(cells, key=lambda c: (BY_NAME[c[0]]['cls'], c[0], SIZES.index(c[1]), c[2], c[3]))
    next_id = max(int(w['weaponId'].split('_')[1]) for w in legacy) + 1
    weapons = []
    for cell in ordered:
        arch, size, fam, mk = cell
        wid = cell_id.get(cell)
        if wid is None:
            wid = f'wpn_{next_id:03d}'; next_id += 1
        w = build(BY_NAME[arch], size, fam, mk)
        w['weaponId'] = wid
        w['name'] = name_for(arch, size, fam, mk)
        weapons.append(w)
    weapons.sort(key=lambda w: int(w['weaponId'].split('_')[1]))

    # Power-cost ladder: rounding to whole points can flatten the ~7.5%/mark step at
    # small sizes, which would make a higher mark a free upgrade and leave the lower
    # mark dead content. Force cost to rise strictly along every line.
    lines = defaultdict(list)
    for w in weapons:
        fam, arch, mk = name_key(w['name'])
        lines[(arch, w['size'], fam)].append((mk, w))
    for key, items in lines.items():
        items.sort(key=lambda t: t[0])
        for i in range(1, len(items)):
            prev, cur = items[i - 1][1], items[i][1]
            if cur['powerCost'] <= prev['powerCost']:
                cur['powerCost'] = round(prev['powerCost'] + 0.1, 1)


    print(f'archetypes      : {len(ARCHETYPES)}  ({len(set(a["cls"] for a in ARCHETYPES))} classes)')
    print(f'curated cells   : {len(cells) - extra}')
    print(f'legacy-only     : {extra}')
    print(f'total weapons   : {len(weapons)}')
    print(f'ids preserved   : {sum(1 for w in weapons if w["weaponId"] in legacy_cell)}/{len(legacy)}')
    print('by class        :', dict(Counter(w['weaponClass'] for w in weapons)))
    print('by size         :', dict(Counter(w['size'] for w in weapons)))
    print('by family       :', dict(Counter(w['name'].split()[0] for w in weapons)))

    if args.dry_run:
        return

    # ---------------------------------------------------------------- write out
    fleet['weapons'] = weapons
    fleet['_meta']['title'] = f"Generated Fleet Data - {len(fleet['ships'])} Ships & {len(weapons)} Weapons"
    fleet['_meta']['weaponCount'] = len(weapons)
    fleet['_meta']['weaponSizeBreakdown'] = {s: sum(1 for w in weapons if w['size'] == s) for s in SIZES}
    fleet['_meta']['weaponArchetypes'] = len(ARCHETYPES)
    fleet['_meta']['weaponFamilies'] = sorted(FAMILIES)
    with open(FLEET, 'w') as f:
        json.dump(fleet, f, indent=2); f.write('\n')

    if os.path.isdir(WEAPONS_DIR):
        shutil.rmtree(WEAPONS_DIR)
    index = []
    for w in weapons:
        slug = re.sub(r'_+', '_', re.sub(r'[^a-z0-9]+', '_', w['name'].lower())).strip('_')
        d = os.path.join(WEAPONS_DIR, w['weaponClass'], w['size'])
        os.makedirs(d, exist_ok=True)
        rel = os.path.join('Weapons', w['weaponClass'], w['size'], f"{w['weaponId']}_{slug}.json")
        with open(os.path.join(ROOT, rel), 'w') as f:
            json.dump(w, f, indent=2); f.write('\n')
        index.append({'weaponId': w['weaponId'], 'name': w['name'], 'weaponClass': w['weaponClass'],
                      'size': w['size'], 'damage': w['damage']['base'], 'shotsPerTurn': w['fireRate']['shotsPerTurn'],
                      'cooldownTurns': w['fireRate']['cooldownTurns'], 'powerCost': w['powerCost'], 'path': rel})
    with open(os.path.join(WEAPONS_DIR, 'index.json'), 'w') as f:
        json.dump({'count': len(index), 'weapons': index}, f, indent=2); f.write('\n')
    write_interface_tables(weapons)
    print(f'\nwrote {len(weapons)} weapon files + Weapons/index.json')


if __name__ == '__main__':
    main()
