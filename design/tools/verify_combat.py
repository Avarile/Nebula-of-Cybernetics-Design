#!/usr/bin/env python3
"""Invariant checks for the combat rulings.

Combat-logic/ is hand-written and generates nothing, so this verifier does not check
output against a table. It checks that four hand-written things agree with each other
and with the live weapon catalogue: tools/combat_tables.py (the numbers), the v2 JSON,
the spec, and Reference/combat.ts.

The load-bearing check is coverage: every (effect, context) pair the 798 weapons
actually produce must be ruled or explicitly declared inert. A new archetype that
pairs an effect with a new role fails here instead of reaching an implementer
unruled.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import combat_tables as CT

FLEET = json.load(open(os.path.join(ROOT, 'fleet_and_weapons.json')))
WEAPONS = FLEET['weapons']
W_BY_ID = {w['weaponId']: w for w in WEAPONS}
SPEC_PATH = os.path.join(ROOT, 'Combat-logic', 'combat_logic_specification.md')
V2_PATH = os.path.join(ROOT, 'Combat-logic', 'advanced_combat_system.json')
TS_PATH = os.path.join(ROOT, 'Reference', 'combat.ts')
RULES = CT.SPECIAL_EFFECT_RULES
fails = []


def check(label, bad, show=6):
    if bad:
        fails.append(label); print(f'FAIL {label}: {len(bad)}')
        for b in bad[:show]: print('      ', b)
    else:
        print(f'ok   {label}')


def contexts_of(w):
    """The contexts a weapon occupies -- derived from data, never declared."""
    fx = set(w['specialEffects'])
    ctx = {'mine'} if w['weaponClass'] == 'mine' else {'hit'}
    if 'can_be_intercepted' in fx:
        ctx.add('projectile')
    if fx & set(CT.POOL_EFFECTS):
        ctx.add('intercept')
    return ctx


def kind(entry):
    return [k for k in ('rule', 'inert', 'as') if k in entry]


# --- the vocabulary ---------------------------------------------------------------
used = {e for w in WEAPONS for e in w['specialEffects']}
ts_weapons = open(os.path.join(ROOT, 'Reference', 'weapons.ts')).read()
m = re.search(r'export type WeaponSpecialEffect\s*=([^;]+);', ts_weapons)
declared = set(re.findall(r"'([a-z_]+)'", m.group(1))) if m else set()

check('every effect a weapon carries has a rule', sorted(used - set(RULES)))
check('every rule names an effect in weapons.ts WeaponSpecialEffect', sorted(set(RULES) - declared))
check('no declared effect is left without a rule', sorted(declared - set(RULES)))

# --- coverage: every (effect, context) pair that occurs ------------------------------
pairs = {}
for w in WEAPONS:
    for e in w['specialEffects']:
        for c in contexts_of(w):
            pairs.setdefault((e, c), w['name'])
check('every (effect, context) pair in the catalogue is ruled or declared inert',
      [f'{e} in {c} (e.g. {n})' for (e, c), n in sorted(pairs.items()) if c not in RULES.get(e, {})])

# --- the table is well formed --------------------------------------------------------
bad = []
for e, by_ctx in RULES.items():
    for c, entry in by_ctx.items():
        if c not in CT.CONTEXTS:
            bad.append(f'{e}: unknown context {c!r}')
        elif len(kind(entry)) != 1:
            bad.append(f'{e}.{c}: needs exactly one of rule / inert / as, has {kind(entry)}')
        elif 'as' in entry and entry['as'] not in by_ctx:
            bad.append(f'{e}.{c}: resolves "as {entry["as"]}", which {e} does not rule')
check('each rule entry is exactly one of rule / inert / as, and "as" resolves', bad)

# Parameter kind is read from its name: a multiplier, a fraction, or a count.
bad = []
for e, by_ctx in RULES.items():
    for c, entry in by_ctx.items():
        for k, v in entry.items():
            if not isinstance(v, (int, float)) or isinstance(v, bool):
                continue
            if k.endswith('Factor'):
                ok = 0 < v <= 2
            elif k.endswith(('Rounds', 'Targets', 'PerMount', 'VsCraft')):
                ok = isinstance(v, int) and v >= 1
            else:
                ok = -1 <= v <= 1
            if not ok:
                bad.append(f'{e}.{c}.{k} = {v}')
check('multipliers in (0, 2], fractions in [-1, 1], counts positive integers', bad)

# A HIGHER projectile evasion is HARDER to intercept. v2 once had high_tracking at -0.10.
check('no effect makes a projectile easier to intercept',
      [f'{e}: {r["projectile"]["projectileEvasionDelta"]}' for e, r in RULES.items()
       if r.get('projectile', {}).get('projectileEvasionDelta', 0) < 0])

check('the pool effects are exactly the effects whose intercept rule engages something',
      sorted(set(CT.POOL_EFFECTS) ^ {e for e, r in RULES.items() if 'engages' in r.get('intercept', {})}))
check('each pool effect engages what POOL_EFFECTS says',
      [e for e, t in CT.POOL_EFFECTS.items() if RULES[e]['intercept'].get('engages') != list(t)])

# --- the v2 JSON ------------------------------------------------------------------------
try:
    V2 = json.load(open(V2_PATH))
except ValueError as exc:
    check('advanced_combat_system.json parses', [str(exc)])
    print(f'\n{len(fails)} CHECK(S) FAILED'); sys.exit(1)

ext = V2['_meta']['extends']
m = re.match(r'(\S+)\s*->\s*(\w+)$', ext)
ok = m and os.path.exists(os.path.join(ROOT, m.group(1))) \
    and m.group(2) in json.load(open(os.path.join(ROOT, m.group(1))))
check('R1: _meta.extends names a file and key that exist', [] if ok else [ext])

formula = ' '.join(V2['masterHitChanceFormula']['pseudocode'])
check('R2: the v2 hit formula carries the gunnery term and the component penalty',
      [t for t in (f'gunnerySkill / {CT.GUNNERY_SKILL_DIVISOR}', f'-= {abs(CT.COMPONENT_TARGETING_PENALTY):.1f}')
       if t not in formula])
check('R5: the v2 hit formula applies every component accuracy critical',
      [f'{c} {f:.2f}' for c, f in CT.COMPONENT_ACCURACY_CRITICALS.items() if f'{c} {f:.2f}' not in formula])

over = V2.get('v1Overrides', {})
check('R4: v1Overrides states the retreat threshold by name and value',
      [] if 'RETREAT_THRESHOLD' in over.get('retreatThreshold', '')
      and f'{round(CT.RETREAT_THRESHOLD * 100)}%' in over['retreatThreshold'] else [over.get('retreatThreshold')])

steps = ' '.join(V2['missileResolutionPhase']['steps'])
want = [f"'high_tracking' on the missile +{RULES['high_tracking']['projectile']['projectileEvasionDelta']:.2f}",
        f"'multi_hit' (swarm pods) +{RULES['multi_hit']['projectile']['projectileEvasionDelta']:.2f}",
        f'projectileEvasion base = {CT.PROJECTILE_EVASION_BASE:.2f}']
check('the interception step states the table\'s projectile-evasion numbers', [t for t in want if t not in steps])
# Cover (spec 2.5; R7 craft and the GamePlay conflict 4.4 escort, unified): one rule, stated
# once in 2.5 for missiles and craft alike. 2.6, the v2 JSON and combat.ts may point at it
# but never restate a narrower version, and combat.ts carries one assignment field.
_spec = open(SPEC_PATH).read()
_spec25 = _spec.split('### 2.5', 1)[-1].split('### 2.6', 1)[0]
_spec26 = _spec.split('### 2.6', 1)[-1].split('\n---', 1)[0]
_ts = open(TS_PATH).read()
_v2craft = json.dumps(V2.get('strikeCraftSystem', {}))
_narrow = re.compile(r'(?i)craft only|only craft|engages only craft|met only by their target')
_cover_lines = lambda text: [l for l in re.split(r'(?<=[.;])\s+|\n', text) if re.search(r'(?i)\bcover', l)]   # sentences
check('cover is one rule: stated in spec 2.5 for missiles and craft, referenced (never narrowed) elsewhere',
      [w for w, ok in (
          ('spec 2.5 states it', '**Cover**' in _spec25 and "covering weapon's `range.optimal`" in _spec25
           and 'missiles and craft alike' in _spec25),
          ('spec 2.6 points at 2.5', '§2.5, **Cover**' in _spec26),
          ('spec 2.6 does not restate the reach', not any('range.optimal' in l for l in _cover_lines(_spec26))),
          ('no cover line is craft-only', not any(_narrow.search(l) for l in
                                                  _cover_lines(_spec25 + _spec26 + steps + _v2craft)
                                                  + _cover_lines(_ts))),
          ('v2 missile step states it', 'cover one friendly ship within its own range.optimal' in steps
           and 'missiles and craft alike' in steps),
          ('combat.ts: one assignment field', _ts.count('coverAssignments:') == 1
           and 'covering:' not in _ts and "source: 'pool' | 'cover' | 'escort';" in _ts))
       if not ok])

classes = {w['weaponClass'] for w in WEAPONS}
check('every weapon class has a hit profile', sorted(classes - set(V2['weaponHitProfiles'])))

# --- component criticals agree with the ship catalogue -----------------------------------
crit_text = FLEET['ships'][0]['componentHitpoints']
bad = []
for comp, factor in CT.COMPONENT_ACCURACY_CRITICALS.items():
    if comp not in crit_text:
        bad.append(f'{comp}: not a ship component'); continue
    pct = re.search(r'-(\d+)%', crit_text[comp]['criticalEffect'])
    if not pct or abs((1 - int(pct.group(1)) / 100) - factor) > 1e-9:
        bad.append(f'{comp}: {factor} vs "{crit_text[comp]["criticalEffect"]}"')
check('each component accuracy factor matches its criticalEffect text', bad)

# --- the spec ------------------------------------------------------------------------------
spec = open(SPEC_PATH).read()
sec34 = spec.split('### 3.4', 1)[1].split('### 3.5', 1)[0] if '### 3.4' in spec else ''
check('spec 3.4 names every ruled effect', sorted(e for e in RULES if f'`{e}`' not in sec34))
check('spec 3.7 states the ruled retreat threshold',
      [] if f'{round(CT.RETREAT_THRESHOLD * 100)}% hull' in spec.split('### 3.7', 1)[1] else ['missing'])

# --- Reference/combat.ts -------------------------------------------------------------------
ts = open(TS_PATH).read()
rulings = dict(re.findall(r"id: '(R\d+)',.*?status: '(open|ruled)'", ts, re.S))
check('R1-R9 are marked ruled in combat.ts OPEN_RULINGS',
      [f'{r}: {rulings.get(r)}' for r in ('R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9')
       if rulings.get(r) != 'ruled'])
sec52 = spec.split('### 5.2', 1)[1] if '### 5.2' in spec else ''
check('every open ruling in combat.ts is listed in spec 5.2',
      [r for r, s in rulings.items() if s == 'open' and f'**{r} ' not in sec52])

# --- Reference/constants.ts mirrors the table --------------------------------------------------
consts = open(os.path.join(ROOT, 'Reference', 'constants.ts')).read()
block = consts.split('export const SPECIAL_EFFECT_RULES', 1)[1].split('} as const satisfies SpecialEffectRules', 1)[0] \
    if 'export const SPECIAL_EFFECT_RULES' in consts else ''


def ts_num(text, key):
    m = re.search(rf'\b{key}:\s*(-?[\d.]+)', text)
    return float(m.group(1)) if m else None


bad = []
for e, by_ctx in RULES.items():
    em = re.search(rf'^\s+{e}: \{{(.*?)^\s+\}},', block, re.S | re.M)
    if not em:
        bad.append(f'{e}: missing'); continue
    for c, entry in by_ctx.items():
        cm = re.search(rf'^\s+{c}: \{{(.*?)\}},?$', em.group(1), re.M)
        if not cm:
            bad.append(f'{e}.{c}: missing'); continue
        for k, v in entry.items():
            if isinstance(v, (int, float)) and not isinstance(v, bool) and ts_num(cm.group(1), k) != v:
                bad.append(f'{e}.{c}.{k}: ts {ts_num(cm.group(1), k)} != table {v}')
check('constants.ts SPECIAL_EFFECT_RULES matches combat_tables.py', bad)

check('constants.ts MISSILE_EVASION and RETREAT_POLICY match the table',
      [k for k, want in (('highTrackingDelta', RULES['high_tracking']['projectile']['projectileEvasionDelta']),
                         ('multiHitDeltaPerMissile', RULES['multi_hit']['projectile']['projectileEvasionDelta']),
                         ('hullFractionThreshold', CT.RETREAT_THRESHOLD))
       if ts_num(consts, k) != want])

# --- R8: effective stats ---------------------------------------------------------------------
import gameplay_tables as GT
from stat_vocabulary import ALL_STATS

SHIP = FLEET['ships'][0]


def hull_field(stat):
    """Resolve a stat to a hull field path, or None. Dotted paths first, then by leaf name."""
    path = CT.HULL_FIELD_ALIASES.get(stat, stat)
    node = SHIP
    for part in path.split('.'):
        if not isinstance(node, dict) or part not in node:
            break
        node = node[part]
    else:
        return path
    leaf = path.split('.')[-1]
    hits = [f'{k}.{leaf}' for k, v in SHIP.items() if isinstance(v, dict) and leaf in v]
    return hits[0] if len(hits) == 1 else None


combat_stats = sorted(s for s, (doc, _, rule) in GT.STAT_RULES.items()
                      if 'Combat-logic' in doc or 'combat' in rule)
check('every STAT_KIND stat is in the stat vocabulary', sorted(set(CT.STAT_KIND) - set(ALL_STATS)))
check('every combat stat is a hull field, has a STAT_KIND, or is parked on an open ruling',
      [s for s in combat_stats if not hull_field(s) and s not in CT.STAT_KIND and s not in CT.PENDING_RULINGS])
check('no STAT_KIND stat is secretly a hull field', [s for s in CT.STAT_KIND if hull_field(s)])
check('caps apply only to additive stats',
      [s for s in CT.ADDITIVE_CAPS if CT.STAT_KIND.get(s, ('',))[0] != 'additive'])

# The module catalogue writes flat values in mixed units; each must match its stat's unit.
bad = []
for m in FLEET['modules']:
    for e in m['effects']:
        kind, unit = CT.STAT_KIND.get(e['stat'], (None, None))
        if kind != 'additive' or e['modifierType'] != 'flat':
            continue
        v = abs(e['modifier'])
        if (unit == 'points' and not 1 <= v <= 100) or (unit == 'fraction' and not v < 1):
            bad.append(f'{m["moduleId"]}: {e["stat"]} {e["modifier"]} is not in {unit}')
check('every flat module value on an additive stat is in that stat\'s unit', bad)

module_types = {m['moduleType'] for m in FLEET['modules']}
check('every ELECTRONIC_MODULE_TYPES entry is a real module type',
      sorted(set(CT.ELECTRONIC_MODULE_TYPES) - module_types))

# Mirror in Reference/constants.ts.
eff_block = consts.split('export const EFFECTIVE_STAT_RULES', 1)[1].split('} as const', 1)[0] \
    if 'export const EFFECTIVE_STAT_RULES' in consts else ''
bad = []
for s, (kind, unit) in CT.STAT_KIND.items():
    key = f"'{s}'" if '.' in s else s
    m = re.search(rf'^\s+{re.escape(key)}:\s*\{{(.*?)\}},', eff_block, re.M)
    want_unit = 'null' if unit is None else f"'{unit}'"
    if not m or f"kind: '{kind}'" not in m.group(1) or f'unit: {want_unit}' not in m.group(1) \
            or ts_num(m.group(1), 'cap') != CT.ADDITIVE_CAPS.get(s):
        bad.append(s)
check('constants.ts EFFECTIVE_STAT_RULES matches STAT_KIND and ADDITIVE_CAPS', bad)

hooks = consts.split('export const STAT_HOOK_CONSTANTS', 1)[1].split('} as const', 1)[0] \
    if 'export const STAT_HOOK_CONSTANTS' in consts else ''
check('constants.ts STAT_HOOK_CONSTANTS matches combat_tables.py',
      [k for k, v in (('pilotSkillInitiativeDivisor', CT.PILOT_SKILL_INITIATIVE_DIVISOR),
                      ('turnPenaltyMax', CT.TURN_PENALTY_MAX), ('turnRateReference', CT.TURN_RATE_REFERENCE),
                      ('engineeringSkillDivisor', CT.ENGINEERING_SKILL_DIVISOR),
                      ('lifeSupportCasualtyRate', CT.LIFE_SUPPORT_CASUALTY_RATE),
                      ('disruptionHullFraction', CT.DISRUPTION_HULL_FRACTION),
                      ('regroupBaseChance', CT.REGROUP_BASE_CHANCE)) if ts_num(hooks, k) != v]
      + sorted(set(CT.ELECTRONIC_MODULE_TYPES) ^ set(re.findall(r"'(\w+)'", hooks.split('electronicModuleTypes', 1)[-1]))))

# The spec 1.3 worked example, recomputed from the live catalogue and skill data.
ballistic = next(s for s in FLEET['skills'] if s['skillId'] == 'skl_wpn_ballistic')
acc_eff = next(e for e in ballistic['effects'] if e['stat'] == 'weaponAccuracy')
acc_pen = next(p for p in ballistic['penalties'] if p['stat'] == 'weaponAccuracy')


def accuracy_mult(level):
    pct = acc_eff['modifierPerLevel'] * max(0, level - acc_eff['appliesFromLevel'] + 1)
    pen = (1 + acc_pen['modifier'] / 100) if level < acc_pen['appliesBelowLevel'] else 1
    return (1 + pct / 100) * pen


def tracking_counter(w):
    return w['accuracy']['tracking'] * (RULES['high_tracking']['hit']['trackingFactor']
                                         if 'high_tracking' in w['specialEffects'] else 1)


def speed_bonus(speed, counter):
    """Spec 2.4 as recalibrated by R6."""
    return min(max((speed - counter * CT.TRACKING_SPEED_FACTOR) / CT.SPEED_EVASION_DIVISOR, 0),
               CT.SPEED_EVASION_CAP)


rail = next(w for w in WEAPONS if w['weaponId'] == 'wpn_141')
cruiser = next(s for s in FLEET['ships'] if s['shipId'] == 'ship_heavy_cruiser_t2')
target = next(s for s in FLEET['namedShips'] if s['name'] == 'Whisperfang')
evasion = min(target['mobility']['evasionRating']
              + speed_bonus(target['mobility']['topSpeed'], tracking_counter(rail)), 0.60)
worked = spec.split('**Worked example', 1)[1].split('**Strike craft (R7)', 1)[0] if '**Worked example' in spec else ''
bad = []
for level in (3, 5, 8):
    final = min(max(rail['accuracy']['baseHitChance'] * accuracy_mult(level)
                    + cruiser['crew']['gunnerySkill'] / CT.GUNNERY_SKILL_DIVISOR - evasion, 0.05), 0.95)
    if f'**{final:.2f}**' not in worked:
        bad.append(f'level {level}: hit chance {final:.2f} not in the table')
check('spec 1.3 worked example recomputes from the live catalogue', bad)

# --- R9: lock range --------------------------------------------------------------------------
NAMED = {s['name']: s for s in FLEET['namedShips']}


def signature(s):
    return s['mass']['value'] * 0.05 + s['power']['maxPower'] * 0.1 + s['shields']['maxHP'] * 0.02


def lock_range(attacker, target_signature):
    lo, hi = CT.DETECTION_SIGNATURE_FACTOR_BOUNDS
    factor = min(max((target_signature / CT.DETECTION_SIGNATURE_REFERENCE) ** CT.DETECTION_SIGNATURE_EXPONENT, lo), hi)
    return attacker['sensors']['detectionRange'] * factor


bad = []
for a, t, mult, dist, want in CT.LOCK_CLAIMS:
    if a not in NAMED or t not in NAMED:
        bad.append(f'{a} / {t}: not a named ship'); continue
    got = lock_range(NAMED[a], signature(NAMED[t]) * mult)
    if (got >= dist) != want:
        bad.append(f'{a} -> {t}: lock {got:.0f} at {dist} should be {"locked" if want else "unlocked"}')
    elif f'{got:,.0f}' not in spec.split('Detection (**ruled, R9**)', 1)[-1].split('### 2.4', 1)[0]:
        bad.append(f'{a} -> {t}: {got:,.0f} not in the spec 2.3 table')
check('R9: every lock claim in the logs and worked example holds, and the spec table matches', bad)

capital = next(s for s in FLEET['ships'] if s['shipId'] == 'ship_battleship_t1')
bad = []
for s in FLEET['ships'] + FLEET['namedShips']:
    ranges = [W_BY_ID[h['weaponEquipped']]['range']['optimal'] for h in s['hardpoints']['list']
              if h.get('weaponEquipped') in W_BY_ID and W_BY_ID[h['weaponEquipped']]['weaponClass'] != 'mine']
    if ranges and lock_range(s, signature(capital) * 1.10) < min(ranges):
        bad.append(f'{s.get("shipId")}: {lock_range(s, signature(capital) * 1.10):.0f} < {min(ranges)}')
check('R9: every armed hull locks a Battleship T1 at its shortest weapon optimal', bad)

check('constants.ts DETECTION_CONSTANTS matches combat_tables.py',
      [k for k, v in (('signatureReference', CT.DETECTION_SIGNATURE_REFERENCE),
                      ('signatureExponent', CT.DETECTION_SIGNATURE_EXPONENT),
                      ('signatureFactorMin', CT.DETECTION_SIGNATURE_FACTOR_BOUNDS[0]),
                      ('signatureFactorMax', CT.DETECTION_SIGNATURE_FACTOR_BOUNDS[1]))
       if ts_num(consts.split('DETECTION_CONSTANTS', 1)[-1].split('} as const', 1)[0], k) != v])

# --- R6: movement and the recalibrated speed-evasion ------------------------------------------
ALL_HULLS = FLEET['ships'] + FLEET['namedShips']
HULL_BY_NAME = {s['name']: s for s in ALL_HULLS}
sec14 = spec.split('### 1.4', 1)[1].split('\n---', 1)[0] if '### 1.4' in spec else ''
sec24 = spec.split('### 2.4', 1)[1].split('### 2.5', 1)[0] if '### 2.4' in spec else ''

# Speed vs tracking must differentiate: over every hull and every direct-fire weapon that
# reads the speed bonus (not beams, not pool weapons), few matchups may hit the cap.
direct = [w for w in WEAPONS if w['weaponClass'] in ('kinetic', 'energy', 'missile')
          and not set(w['specialEffects']) & set(CT.POOL_EFFECTS)
          and not any(b in w['name'] for b in ('Beam Laser', 'Particle Lance'))]
counters = [tracking_counter(w) for w in direct]
bonuses = [speed_bonus(h['mobility']['topSpeed'], c) for h in ALL_HULLS for c in counters]
saturated = sum(b >= CT.SPEED_EVASION_CAP for b in bonuses) / len(bonuses)
graded = sum(0 < b < CT.SPEED_EVASION_CAP for b in bonuses) / len(bonuses)
check(f'R6: speed-evasion differentiates ({saturated:.0%} saturated, {graded:.0%} graded)',
      [] if saturated <= CT.SPEED_EVASION_SATURATED_MAX and graded >= CT.SPEED_EVASION_GRADED_MIN
      else [f'saturated {saturated:.2f} > {CT.SPEED_EVASION_SATURATED_MAX} or graded {graded:.2f} '
            f'< {CT.SPEED_EVASION_GRADED_MIN}'])

# Every row of the spec 2.4 sample table recomputes, old and new, from the catalogue.
bad, rows = [], 0
for row in sec24.splitlines():
    cells = [c.strip() for c in row.strip().strip('|').split('|')]
    if len(cells) != 4 or not re.search(r'\(\d+\)$', cells[0]):
        continue
    rows += 1
    tname = re.sub(r'\s*\(\d+\)$', '', cells[0]).strip('*')
    wname = cells[1].split(' (')[0]
    hull, weapon = HULL_BY_NAME.get(tname), next((w for w in WEAPONS if w['name'] == wname), None)
    if not hull or not weapon:
        bad.append(f'{tname} / {wname}: not in the catalogue'); continue
    speed, counter = hull['mobility']['topSpeed'], tracking_counter(weapon)
    old = min(max((speed - counter) / 250, 0), 0.35)
    for got, cell in ((old, cells[2]), (speed_bonus(speed, counter), cells[3])):
        if abs(got - float(cell)) > 0.0005 + 1e-9:     # the table shows 3 decimals
            bad.append(f'{tname} vs {wname}: {cell} != {got:.4f}')
check('R6: the spec 2.4 sample table recomputes from the catalogue', bad if rows else ['no rows found'])

# The v2 worked example is catalogue-backed: every shot names a weapon the attacker
# actually carries, and its stated finalHitChance recomputes from the live catalogue
# (master formula steps 3-11, Weaponry at level 5, modules aside, lockQuality 1).
def range_multiplier(d, w):
    o, mx = w['range']['optimal'], w['range']['maximum']
    if d > mx:
        return 0.0
    if d <= o:
        return 1.10 if d <= 0.25 * o else 1.0
    if d <= 1.5 * o:
        return 1 - 0.35 * (d - o) / (0.5 * o)
    return 0.65 - 0.50 * (d - 1.5 * o) / (mx - 1.5 * o)


WX = V2['workedExample']
wx_att, wx_tgt = NAMED.get(WX.get('attacker')), NAMED.get(WX.get('target'))
bad = [] if wx_att and wx_tgt else ['attacker or target is not a named ship']
shots = {k: v for k, v in WX.items() if isinstance(v, dict) and 'weaponId' in v}
carried = {h.get('weaponEquipped') for h in (wx_att or {}).get('hardpoints', {}).get('list', [])}
for key, shot in sorted(shots.items()):
    w = W_BY_ID.get(shot['weaponId'])
    if not w or shot['weaponId'] not in carried:
        bad.append(f'{key}: {shot["weaponId"]} is not carried by {WX.get("attacker")}'); continue
    prof = V2['weaponHitProfiles'][w['weaponClass']]
    ev = min(wx_tgt['mobility']['evasionRating']
             + speed_bonus(wx_tgt['mobility']['topSpeed'], tracking_counter(w)), 0.60)
    ev *= 1 - prof.get('evasionIgnoredFraction', 0)
    base = (w['accuracy']['baseHitChance'] * prof['baseHitChanceModifier']
            + wx_att['crew']['gunnerySkill'] / CT.GUNNERY_SKILL_DIVISOR)
    final = min(max(base * range_multiplier(WX['distance'], w) - ev, 0.05), 0.95)
    if not shot['finalHitChance'].endswith(f'= {final:.2f}'):
        bad.append(f'{key}: states {shot["finalHitChance"].rsplit("=", 1)[-1].strip()}, live {final:.2f}')
check('the v2 worked example recomputes from the catalogue, every shot a weapon the attacker carries',
      bad if shots else ['no shots with a weaponId'])
check('R6: the v2 speedEvasionSystem formula carries the table constants',
      [] if f'trackingCounter * {CT.TRACKING_SPEED_FACTOR}) / {CT.SPEED_EVASION_DIVISOR}'
      in V2['speedEvasionSystem']['formula']['speedEvasionBonus'] else ['speedEvasionBonus'])

# Acceleration matters but never dominates: every hull reaches top speed from rest in time.
slow = [(round(h['mobility']['topSpeed'] / (h['mobility']['acceleration'] * CT.ROUND_TIME), 2), h['name'])
        for h in ALL_HULLS
        if h['mobility']['topSpeed'] / (h['mobility']['acceleration'] * CT.ROUND_TIME) > CT.MAX_ROUNDS_TO_TOP_SPEED]
check(f'R6: every hull reaches top speed from rest within {CT.MAX_ROUNDS_TO_TOP_SPEED} rounds', slow)

# The engine critical's factor is its catalogue text, like the accuracy criticals.
eng = re.search(r'-(\d+)% speed and turn rate', FLEET['ships'][0]['componentHitpoints']['engines']['criticalEffect'])
check('R6: ENGINE_CRITICAL_FACTOR matches the engines criticalEffect text',
      [] if eng and abs(1 - int(eng.group(1)) / 100 - CT.ENGINE_CRITICAL_FACTOR) < 1e-9 else ['engines'])
check("R6: RUNNING_SILENT_SPEED_FACTOR matches the v2 JSON's running-silent cost",
      [] if f'-{round((1 - CT.RUNNING_SILENT_SPEED_FACTOR) * 100)}% topSpeed' in
      next(m['effect'] for m in V2['signatureSystem']['activeStateModifiers'] if m['state'] == 'runningSilent')
      else ['runningSilent'])


def log_rosters(fname):
    """{side: [(name, speed)]} from a battle log's roster tables."""
    text = open(os.path.join(ROOT, 'Combat-logic', fname)).read()
    block = text.split('### Rosters', 1)[1].split('\n---', 1)[0]
    sides, side, col = {}, None, None
    for line in block.splitlines():
        if not line.startswith('|'):
            m = re.search(r'\*\*(?:TASK FORCE )?([A-Z]+)', line)
            side = m.group(1) if m else side
            continue
        cells = [c.strip() for c in line.strip('|').split('|')]
        if 'Speed' in cells:
            col = cells.index('Speed'); continue
        name = re.search(r'\*([^*]+)\*', line)
        if name and col is not None and cells[col].isdigit():
            sides.setdefault(side, []).append((name.group(1), int(cells[col])))
    return text, sides


# The logged roster speeds are the named-ship catalogue's, wherever the ship is catalogued.
bad = []
for fname in sorted({c[0] for c in CT.RANGE_CLAIMS}):
    for side, ships in log_rosters(fname)[1].items():
        bad += [f'{fname}: {n} {sp} != {NAMED[n]["mobility"]["topSpeed"]}'
                for n, sp in ships if n in NAMED and NAMED[n]['mobility']['topSpeed'] != sp]
check('R6: every log roster speed matches the named-ship catalogue', bad)

# Spec 1.2: the granularity threshold sits between the two logs -- above every side of the
# shot-by-shot one, at or below every side of the batched one -- and constants.ts mirrors it.
shot_sides = [len(v) for v in log_rosters('battle_log_sable_vs_ember.md')[1].values()]
group_sides = [len(v) for v in log_rosters('battle_log_veritas_vs_cinder.md')[1].values()]
gp = consts.split('export const GRANULARITY_POLICY', 1)[-1].split('} as const', 1)[0]
check(f'spec 1.2: {CT.GRANULARITY_HULLS_PER_SIDE} hulls a side separates the logs '
      f'(shot by shot {shot_sides}, batched {group_sides}) and constants.ts mirrors it',
      ([] if shot_sides and group_sides and max(shot_sides) < CT.GRANULARITY_HULLS_PER_SIDE <= min(group_sides)
       else [f'{shot_sides} / {group_sides}'])
      + ([] if ts_num(gp, 'hullCountThresholdPerSide') == CT.GRANULARITY_HULLS_PER_SIDE else ['constants.ts'])
      + ([] if f'`GRANULARITY_HULLS_PER_SIDE` = {CT.GRANULARITY_HULLS_PER_SIDE}' in spec else ['spec 1.2']))


def reachable(round_time):
    out = []
    for fname, closing, r0, d0, r1, d1 in CT.RANGE_CLAIMS:
        text, sides = log_rosters(fname)
        rate = sum(min(sp for _, sp in sides[s]) for s in closing) * round_time
        out.append((fname, r0, d0, r1, d1, text, rate * (r1 - r0)))
    return out


bad = []
for fname, r0, d0, r1, d1, text, cover in reachable(CT.ROUND_TIME):
    if f'{d0:,}' not in text or f'{d1:,}' not in text:
        bad.append(f'{fname}: {d0:,} or {d1:,} is not in the log')
    elif abs(d1 - d0) > cover:
        bad.append(f'{fname} rounds {r0}->{r1}: {abs(d1 - d0)} > {cover}')
    elif f'| {cover:,} |' not in sec14:
        bad.append(f'{fname} rounds {r0}->{r1}: can-cover {cover:,} not in the spec 1.4 table')
check('R6: every logged range progression is reachable at formation speed x ROUND_TIME', bad)
check('R6: ROUND_TIME is the smallest whole value that reaches every logged progression',
      [] if any(abs(d1 - d0) > cover for _f, _r0, d0, _r1, d1, _t, cover in reachable(CT.ROUND_TIME - 1))
      else [f'{CT.ROUND_TIME - 1} would do'])

# The opening distance lies between the two sides' first-lock ranges (spec 1.4).
scanning = next(s for s in FLEET['skills'] if s['skillId'] == 'skl_scan_scanning')
scan_pct = {e['stat']: e['modifierPerLevel'] for e in scanning['effects']}


def first_lock(seers, targets, target_mult, level):
    sensor = (1 + scan_pct['detectionRange'] * level / 100) * (1 + scan_pct['sensorArray.effectiveness'] * level / 100)
    return max(lock_range(NAMED[a], signature(NAMED[t]) * target_mult) * sensor
               for a in seers for t in targets)


bad = []
for fname, opening, states in CT.OPENING_CLAIMS:
    text, sides = log_rosters(fname)
    a, b = states
    named = {s: [n for n, _ in sides[s] if n in NAMED] for s in (a, b)}
    ra = first_lock(named[a], named[b], states[b][0], states[a][1])
    rb = first_lock(named[b], named[a], states[a][0], states[b][1])
    if f'{opening:,}m' not in text:
        bad.append(f'{fname}: {opening:,}m is not in the log')
    elif not min(ra, rb) <= opening <= max(ra, rb):
        bad.append(f'{fname}: {opening} outside [{min(ra, rb):.0f}, {max(ra, rb):.0f}]')
    elif f'{max(ra, rb):,.0f} | {min(ra, rb):,.0f} | {opening:,}' not in sec14:
        bad.append(f'{fname}: {max(ra, rb):,.0f} / {min(ra, rb):,.0f} not in the spec 1.4 table')
check('R6: each logged opening distance lies between the two first-lock ranges', bad)

intent_rows = set(re.findall(r'^\| `(\w+)` \|', sec14, re.M))
check('R6: the spec 1.4 intent table and the v2 movementSystem list exactly the movement intents',
      sorted(set(CT.MOVEMENT_INTENTS) ^ intent_rows)
      + [i for i in CT.MOVEMENT_INTENTS if i not in V2['movementSystem']['intents']])
check('R6: the v2 movementSystem states ROUND_TIME',
      [] if f'ROUND_TIME = {CT.ROUND_TIME}' in V2['movementSystem']['units'] else ['units'])

mv = consts.split('export const MOVEMENT_CONSTANTS', 1)[-1].split('} as const', 1)[0]
ev = consts.split('export const EVASION_CONSTANTS', 1)[-1].split('} as const', 1)[0]
ab = re.search(r"state: 'afterburner'.*?\}", consts, re.S)
sil = re.search(r"state: 'runningSilent'.*?topSpeedDelta:\s*(-?[\d.]+)", consts, re.S)
check('constants.ts MOVEMENT_CONSTANTS, EVASION_CONSTANTS and the state boosts match combat_tables.py',
      [k for k, got, want in (
          ('roundTime', ts_num(mv, 'roundTime'), CT.ROUND_TIME),
          ('maxRoundsToTopSpeed', ts_num(mv, 'maxRoundsToTopSpeed'), CT.MAX_ROUNDS_TO_TOP_SPEED),
          ('runningSilentSpeedFactor', ts_num(mv, 'runningSilentSpeedFactor'), CT.RUNNING_SILENT_SPEED_FACTOR),
          ('afterburnerFactor', ts_num(mv, 'afterburnerFactor'), CT.AFTERBURNER_FACTOR),
          ('engineCriticalFactor', ts_num(mv, 'engineCriticalFactor'), CT.ENGINE_CRITICAL_FACTOR),
          ('speedTrackingDivisor', ts_num(ev, 'speedTrackingDivisor'), CT.SPEED_EVASION_DIVISOR),
          ('trackingSpeedFactor', ts_num(ev, 'trackingSpeedFactor'), CT.TRACKING_SPEED_FACTOR),
          ('maxSpeedEvasionBonus', ts_num(ev, 'maxSpeedEvasionBonus'), CT.SPEED_EVASION_CAP),
          ('afterburner topSpeedFactor', ab and ts_num(ab.group(0), 'topSpeedFactor'), CT.AFTERBURNER_FACTOR),
          ('afterburner accelerationFactor', ab and ts_num(ab.group(0), 'accelerationFactor'), CT.AFTERBURNER_FACTOR),
          ('runningSilent topSpeedDelta', sil and round(float(sil.group(1)) + 1, 9), CT.RUNNING_SILENT_SPEED_FACTOR))
       if got != want]
      + sorted(set(CT.MOVEMENT_INTENTS) ^ set(re.findall(r"'(\w+)'", mv.split('intents', 1)[-1]))))

# --- R7: strike craft ---------------------------------------------------------------------------
import math

M_BY_ID = {m['moduleId']: m for m in FLEET['modules']}
SHIP_BY_ID = {s['shipId']: s for s in FLEET['ships']}
FIGHTER, DRONE = CT.CRAFT_PROFILES['fighter'], CT.CRAFT_PROFILES['drone']
sec26 = spec.split('### 2.6', 1)[1].split('\n---', 1)[0] if '### 2.6' in spec else ''


def effective(ship, stat, base):
    """Spec 1.3 from the fitted modules alone (skills at level 0)."""
    effects = [e for sl in ship['moduleSlots']['list'] if sl.get('moduleEquipped') in M_BY_ID
               for e in M_BY_ID[sl['moduleEquipped']]['effects'] if e['stat'] == stat]
    flat = sum(e['modifier'] for e in effects if e['modifierType'] == 'flat')
    pct = sum(e['modifier'] for e in effects if e['modifierType'] == 'percent')
    return (base + flat) * (1 + pct / 100)


def craft_carried(ship, profile):
    field = CT.HULL_FIELD_ALIASES[profile['capacityStat']].split('.')
    return math.floor(effective(ship, profile['capacityStat'], ship[field[0]][field[1]]) + 1e-9)


def clamp(x, lo, hi):
    return min(max(x, lo), hi)


def craft_pool(ship):
    """(attempts, chance per attempt vs a fighter, craft downed per success) per craft-engaging mount."""
    out = []
    for h in ship['hardpoints']['list']:
        w = W_BY_ID.get(h.get('weaponEquipped'))
        fx = set(w['specialEffects']) if w else set()
        engages = [e for e in fx if 'craft' in CT.POOL_EFFECTS.get(e, ())]
        if not engages:
            continue
        delta = max(RULES[e]['intercept']['interceptChanceDelta'] for e in engages) \
            + sum(RULES[e]['intercept'].get('interceptChanceDelta', 0) for e in fx
                  if e not in CT.POOL_EFFECTS and 'intercept' in RULES.get(e, {}))
        tf = RULES['high_tracking']['intercept']['trackingFactor'] if 'high_tracking' in fx else 1
        raw = w['accuracy']['baseHitChance'] + w['accuracy']['tracking'] * tf / CT.INTERCEPT_TRACKING_DIVISOR + delta
        shots = w['fireRate']['shotsPerRound'] + sum(RULES[e]['intercept'].get('extraAttemptsPerMount', 0)
                                                    for e in fx if 'intercept' in RULES.get(e, {}))
        kills = 1 + sum(RULES[e]['intercept'].get('extraKillsPerSuccessVsCraft', 0)
                        for e in fx if 'intercept' in RULES.get(e, {}))
        out.append((shots * effective(ship, 'pointDefenseBonus', 1),
                    clamp(raw - FIGHTER['interceptEvasion'], 0.05, 0.95), kills, raw))
    return out


def fighter_hit_chance(target):
    profile = V2['weaponHitProfiles'][FIGHTER['hitProfile']]
    speed = effective(target, 'topSpeed', target['mobility']['topSpeed'])
    ev = clamp(effective(target, 'evasionRating', target['mobility']['evasionRating'])
               + speed_bonus(speed, FIGHTER['tracking']), 0, 0.60)
    base = FIGHTER['baseHitChance'] * profile['baseHitChanceModifier']
    return clamp(base - ev * (1 - profile['evasionIgnoredFraction'])
                 + effective(target, 'enemyHitChance', 0) / 100, 0.05, 0.95)


def fighter_damage(target):
    """Mean shield damage of one fighter hit."""
    return FIGHTER['damage']['base'] * (1 - target['shields']['damageTypeResistance'][FIGHTER['damage']['damageType']])


# The skills: Fighter Squadron Control is exactly the fighter's three stats; the Drones
# skill gates exactly the drone's two, on a class no catalogue weapon has.
fsc = next(s for s in FLEET['skills'] if s['skillId'] == 'skl_flt_fighter_squadron_control')
drones = next(s for s in FLEET['skills'] if s['skillId'] == 'skl_wpn_drones')
drone_stats = {str(DRONE['accuracyStat']), str(DRONE['damageStat'])}
fighter_stats = [FIGHTER['speedStat'], FIGHTER['accuracyStat'], FIGHTER['evasionStat']]
check('R7: Fighter Squadron Control raises exactly the fighter profile\'s squadron stats, which are multipliers',
      sorted({e['stat'] for e in fsc['effects']} ^ set(map(str, fighter_stats)))
      + [str(s) for s in fighter_stats if CT.STAT_KIND.get(s, ('',))[0] != 'multiplier'])
check('R7: the Drones skill gates and raises exactly the drone attack stats, on a class no weapon carries',
      sorted({p['stat'] for p in drones['penalties'] if p.get('appliesTo', {}).get('weaponClass') == DRONE['weaponClass']}
             ^ drone_stats)
      + sorted({e['stat'] for e in drones['effects'] if e.get('appliesTo', {}).get('weaponClass') == DRONE['weaponClass']}
               ^ drone_stats)
      + [w['weaponId'] for w in WEAPONS if w['weaponClass'] == DRONE['weaponClass']][:3])

# Every hangar module feeds a craft kind's capacity, and every kind is fed by one.
hangar_stats = {e['stat'] for m in FLEET['modules'] if m['slotType'] == 'hangar' for e in m['effects']
                if e['stat'].endswith('Capacity')}
check('R7: the hangar modules\' capacity stats are exactly the craft profiles\' capacity stats, each a hull field',
      sorted(hangar_stats ^ {p['capacityStat'] for p in CT.CRAFT_PROFILES.values()})
      + [p['capacityStat'] for p in CT.CRAFT_PROFILES.values() if not hull_field(p['capacityStat'])])

# Interception against craft is graded: 1.10 must leave squadronEvasion something to move.
craft_weapons = [w for w in WEAPONS if any('craft' in CT.POOL_EFFECTS.get(e, ()) for e in w['specialEffects'])]
chances = [p for w in craft_weapons for _, p, _, _ in craft_pool({'hardpoints': {'list': [{'weaponEquipped': w['weaponId']}]},
                                                                   'moduleSlots': {'list': []}})]
floored = sum(p <= 0.05 for p in chances)
capped = sum(p >= 0.95 for p in chances) / len(chances)
check(f'R7: interception against a fighter is graded ({floored} at the floor, {capped:.0%} capped, '
      f'median {sorted(chances)[len(chances) // 2]:.2f})',
      [] if floored == 0 and capped <= CT.CRAFT_INTERCEPT_CAPPED_MAX else [f'floor {floored}, capped {capped:.2f}'])

# A full complement is never a large share of its hull.
bad = []
lanes = set(FLEET['ships'][0]['buildCost'])        # buildCost is by resource lane
for kind, profile in CT.CRAFT_PROFILES.items():
    if set(profile['restockCost']) != lanes or min(profile['restockCost'].values()) < 0:
        bad.append(f'{kind}: restockCost lanes {sorted(profile["restockCost"])}')
    for s in ALL_HULLS:
        n = craft_carried(s, profile)
        share = n * sum(profile['restockCost'].values()) / sum(s['buildCost'].values())
        if share > CT.CRAFT_WING_COST_SHARE_MAX:
            bad.append(f'{s.get("shipId", s["name"])}: {n} {kind}s cost {share:.0%} of the hull')
check(f'R7: restock costs are by resource lane, and no full complement costs over '
      f'{CT.CRAFT_WING_COST_SHARE_MAX:.0%} of its hull', bad)

# The logged carriers: their template's hangar gives the logged squadron count.
log_text = open(os.path.join(ROOT, 'Combat-logic', CT.STRIKE_LOG)).read()
bad, complement = [], {}
for name, sid in CT.STRIKE_CARRIERS.items():
    m = re.search(rf'\| \*{re.escape(name)}\* \| ([A-Za-z ]+?) \|.*\((\d+) squadrons\)', log_text)
    hull = SHIP_BY_ID.get(sid)
    if not m or not hull:
        bad.append(f'{name}: no roster row or no hull {sid}'); continue
    carried = craft_carried(hull, FIGHTER)
    complement[name] = (int(m.group(2)), carried)
    if m.group(1).lower().replace(' ', '_') != hull['shipClass']:
        bad.append(f'{name}: logged as {m.group(1)}, stands for {hull["shipClass"]}')
    elif carried // CT.SQUADRON_SIZE != int(m.group(2)):
        bad.append(f'{name}: {carried} fighters is {carried // CT.SQUADRON_SIZE} squadrons, logged {m.group(2)}')
    elif not re.search(rf'\*{re.escape(name)}\* \|[^|]+\|[^|]*\b{carried} \| {carried // CT.SQUADRON_SIZE}, '
                       rf'{carried % CT.SQUADRON_SIZE} in reserve', sec26):
        bad.append(f'{name}: {carried} fighters / {carried // CT.SQUADRON_SIZE} squadrons not in the spec 2.6 table')
check('R7: each logged carrier\'s squadron count is its template\'s hangar over SQUADRON_SIZE', bad)


def log_round(r):
    return log_text.split(f'**Round {r}:**', 1)[-1].split('**Round', 1)[0] if f'**Round {r}:**' in log_text else ''


# Bookkeeping: the log's craft counts add up, fresh squadrons fly once, rebuilt craft exist.
bad, fresh, history = [], {}, {}
for c in CT.STRIKE_CLAIMS:
    tag = f'round {c["round"]} {c["carrier"]} -> {c["target"]}'
    para = log_round(c['round'])
    words = [c['carrier'], c['target']] + [str(n) for n in (c['launched'], c['downed'], c['attacked'], c['hits'])
                                           if n is not None]
    missing = [w for w in words if not re.search(rf'(?<![\w.]){re.escape(w)}(?![\w])', para)]
    if missing:
        bad.append(f'{tag}: {missing} not in the log\'s round {c["round"]}')
    if c['launched'] != c['fresh'] * CT.SQUADRON_SIZE + c['rebuiltCraft']:
        bad.append(f'{tag}: {c["launched"]} != {c["fresh"]} x {CT.SQUADRON_SIZE} + {c["rebuiltCraft"]}')
    if c['downed'] + c['attacked'] != c['launched'] or (c['hits'] or 0) > c['attacked']:
        bad.append(f'{tag}: downed + attacked != launched, or hits > attacked')
    earlier = history.get(c['carrier'], [])
    squadrons, carried = complement.get(c['carrier'], (0, 0))
    if c['rebuiltCraft'] > sum(a for _, a in earlier) + carried - squadrons * CT.SQUADRON_SIZE:
        bad.append(f'{tag}: {c["rebuiltCraft"]} rebuilt craft, more than came home plus the reserve')
    fresh[c['carrier']] = fresh.get(c['carrier'], 0) + c['fresh']
    history.setdefault(c['carrier'], []).append((c['round'], c['attacked']))
bad += [f'{n}: {fresh.get(n, 0)} fresh squadrons flown, {sq} carried' for n, (sq, _) in complement.items()
        if fresh.get(n, 0) != sq]
check('R7: the logged strikes add up (launched = fresh x 6 + rebuilt = downed + attacked; each squadron flies once)', bad)

# Timing: the cadence reproduces the log's launch rounds, and a fighter reaches the line.
first = min(c['round'] for c in CT.STRIKE_CLAIMS)
bad = [] if first == 1 + FIGHTER['coldStartRounds'] and 'First strike-craft launch' in log_round(first) \
    else [f'first strike in round {first}, cadence says {1 + FIGHTER["coldStartRounds"]}']
for c in CT.STRIKE_CLAIMS:
    if c['rebuiltCraft']:
        back = min(r for r, _ in history[c['carrier']] if r < c['round']) + 1      # recovered the round after
        if c['round'] < back + FIGHTER['turnaroundRounds']:
            bad.append(f'round {c["round"]}: rebuilt craft recovered in round {back} are not ready until '
                       f'{back + FIGHTER["turnaroundRounds"]}')
line = next((d1 for f, _s, _r0, _d0, r1, d1 in CT.RANGE_CLAIMS if f == CT.STRIKE_LOG and r1 == first), None)
if line is None or FIGHTER['speed'] * CT.ROUND_TIME < line:
    bad.append(f'a fighter covers {FIGHTER["speed"] * CT.ROUND_TIME} a round, the lines are {line} apart in round {first}')
check('R7: first launch, rearm and reach match the log (cold start, turnaround, speed x ROUND_TIME)', bad)

# Interception, hits and shield damage, recomputed from the catalogue for every strike.
table_rows = {r.split('|')[2]: r for r in sec26.splitlines() if r.startswith('| ') and '→' in r}
bad = []
for c in CT.STRIKE_CLAIMS:
    tag = f'round {c["round"]} -> {c["target"]}'
    target = NAMED.get(c['target'])
    cover = [NAMED.get(n) for n in c['cover']]
    if not target or None in cover:
        bad.append(f'{tag}: target or cover is not a named ship'); continue
    pool = [mount for s in [target] + cover for mount in craft_pool(s)]
    downed = min(sum(n * p * k for n, p, k, _ in pool), c['launched'])
    p = fighter_hit_chance(target)
    row = next((r for k, r in table_rows.items() if c['target'] in k and c['carrier'] in k), '')
    if c['coverComplete'] and abs(downed - c['downed']) > CT.STRIKE_DOWNED_TOLERANCE:
        bad.append(f'{tag}: {downed:.1f} downed expected, {c["downed"]} logged')
    if not c['coverComplete'] and downed > c['downed'] + CT.STRIKE_DOWNED_TOLERANCE:
        bad.append(f'{tag}: catalogued cover alone downs {downed:.1f}, more than the logged {c["downed"]}')
    if f'{downed:.1f}' not in row or f'({p:.2f})' not in row:
        bad.append(f'{tag}: {downed:.1f} downed / chance {p:.2f} not in the spec 2.6 row')
    if c['hits'] is not None:
        n, k = c['attacked'], c['hits']
        cdf = lambda x: sum(math.comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(x + 1))
        tail = (1 - CT.STRIKE_HIT_CONFIDENCE) / 2
        if cdf(k) < tail or 1 - cdf(k - 1) < tail:
            bad.append(f'{tag}: {k} hits of {n} is outside the central {CT.STRIKE_HIT_CONFIDENCE:.0%} at {p:.2f}')
    dmg, shield = fighter_damage(target), target['shields']['maxHP']
    if c['shields'] == 'hold' and c['hits'] * dmg >= shield:
        bad.append(f'{tag}: {c["hits"]} hits deal {c["hits"] * dmg:.0f}, the logged shields {shield} would fall')
    elif c['shields'] == 'collapse' and c['hits'] * dmg < shield:
        bad.append(f'{tag}: {c["hits"]} hits deal {c["hits"] * dmg:.0f}, short of the logged collapse of {shield}')
    elif isinstance(c['shields'], tuple):
        before, after = c['shields']
        want = c['attacked'] * p * dmg
        if before != shield or abs(want - (before - after)) > CT.STRIKE_DAMAGE_TOLERANCE * (before - after):
            bad.append(f'{tag}: {want:.0f} expected against {before - after} logged ({before} -> {after})')
        elif f'{want:,.0f} expected' not in row:
            bad.append(f'{tag}: {want:,.0f} not in the spec 2.6 row')
    if isinstance(c['shields'], str) and f'{c["hits"] * dmg:.0f}' not in row:
        bad.append(f'{tag}: {c["hits"] * dmg:.0f} not in the spec 2.6 row')
check('R7: every logged strike recomputes from the catalogue (downed, hits, shields)', bad)

# Mirrors: constants.ts and the v2 JSON.
cp = consts.split('export const CRAFT_PROFILES', 1)[-1].split('} as const', 1)[0]
bad = []
for kind, profile in CT.CRAFT_PROFILES.items():
    block_ = cp.split(f'{kind}: {{', 1)[-1].split('\n  },', 1)[0]
    flat = {**{k: v for k, v in profile.items() if not isinstance(v, dict)},
            **{f'damage.{k}': v for k, v in profile['damage'].items()},
            **{f'restockCost.{k}': v for k, v in profile['restockCost'].items()}}
    for k, v in flat.items():
        leaf = k.split('.')[-1]
        text = block_.split(k.split('.')[0] + ':', 1)[-1] if '.' in k else block_
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            ok = ts_num(text, leaf) == v
        else:
            ok = re.search(rf'\b{leaf}:\s*{"null" if v is None else repr(v)}', text) is not None
        if not ok:
            bad.append(f'{kind}.{k}')
sc = consts.split('export const STRIKE_CRAFT_CONSTANTS', 1)[-1].split('} as const', 1)[0]
bad += [k for k, v in (('squadronSize', CT.SQUADRON_SIZE), ('wingCostShareMax', CT.CRAFT_WING_COST_SHARE_MAX))
        if ts_num(sc, k) != v]
bad += sorted(set(CT.CRAFT_INTENTS) ^ set(re.findall(r"'(\w+)'", sc.split('intents', 1)[-1])))
check('constants.ts CRAFT_PROFILES and STRIKE_CRAFT_CONSTANTS match combat_tables.py', bad)

sc_v2 = V2.get('strikeCraftSystem', {})
check('R7: the v2 strikeCraftSystem states the squadron size, cadence and craft evasion',
      [t for t, where in ((f'SQUADRON_SIZE = {CT.SQUADRON_SIZE}', 'hangar'),
                          (f'round 1 + {FIGHTER["coldStartRounds"]}', 'cadence'),
                          (f'round r + {FIGHTER["turnaroundRounds"]}', 'cadence'),
                          (f'{FIGHTER["interceptEvasion"]:.2f} x effective({FIGHTER["evasionStat"]})', 'interception'))
       if t not in sc_v2.get(where, '')])
intent_rows = set(re.findall(r'^\| `(\w+)` \|', sec26, re.M))
check('R7: the spec 2.6 intent table lists exactly the craft intents', sorted(set(CT.CRAFT_INTENTS) ^ intent_rows))

# --- the hand-written files survive ----------------------------------------------------------
check('the hand-written combat files are present',
      [p for p in ('combat_logic_specification.md', 'advanced_combat_system.json',
                   'battle_log_sable_vs_ember.md', 'battle_log_veritas_vs_cinder.md')
       if not os.path.exists(os.path.join(ROOT, 'Combat-logic', p))])

print('\n' + ('ALL CHECKS PASSED' if not fails else f'{len(fails)} CHECK(S) FAILED'))
sys.exit(1 if fails else 0)
