# Progression — Specification

Time is the only currency. Written 2026-09-13.

Owned by this document: the SP rate, how the training queue works, what gates what, the
arithmetic that makes a specialist beat an all-rounder, and what a player has on turn 1.

The SP ladder itself is **not** owned here. It is already authored in
`tools/skill_tables.py` and published on every skill as `training.spPerLevel`,
`training.spCumulative` and `training.spTotal`. This document supplies the one number that
ladder was missing — the rate — and the rules around it. Every figure quoted below is
recomputed by `tools/verify_progression.py` from the live catalogue rather than read from
this page.

## 1. The rate

```
SP_PER_TURN = 43,200          # 24 h x 1,800 SP/h  (SP_PER_HOUR_REFERENCE)
```

Flat, universal, and paid whether the player logs in or not. There is no bonus rate, no
rested state, no accelerator. `skill_tables.py` already derives its whole ladder against
1,800 SP/hour — "at the EVE-reference 1,800 SP/hour this puts a first hull about 11 hours
out and a battleship-by-way-of-the-spine about 9 days out" — so the rate is inherited, not
invented, and `verify_progression.py` asserts
`SP_PER_TURN == TURN_LENGTH_HOURS * SP_PER_HOUR_REFERENCE` rather than hardcoding 43,200.

**Why a flat rate.** In a persistent shared world, any rate that rewards attendance
compounds: the player who logs in more trains faster, fields better hulls, wins more, and
the gap never closes. A flat rate makes *account age* the only progression axis and leaves
*choice* as the only lever a player actually pulls. It also makes the specialisation
arithmetic in §4 provable, because every player's budget at turn T is identical.

## 2. The queue

One skill trains at a time. SP accrue to the head of the queue; when a level completes, the
remainder carries to the next entry with nothing lost.

A queue entry is `(skillId, targetLevel)`. The queue is a `train.queue` order (phase 2) and
is a standing order — it keeps advancing through absence, which is the point.

Three rules:

* **Trainable means prerequisites met.** An entry whose prerequisites are unmet is held, not
  dropped, and begins the moment they are satisfied — so queueing a hull line ahead of the
  skill that unlocks it works exactly as a player would expect.
* **No unqueue penalty.** Reordering costs nothing. Partial progress into a level is kept
  against that skill indefinitely.
* **No domain lock.** The brief is explicit — *"user does not have to be locked into each
  domain, they are free to learn from tiered skills from each domain"* — and the
  implementation of that freedom is that no rule exists. A player may put a mining skill,
  a battleship skill and a trade skill in one queue. What they cannot do is afford all of
  them, which is §4.

## 3. What gates what

Three gating mechanisms, all carried as data on the skills themselves, none as prose an
implementer has to honour.

**Hull operation** — `unlocks[].type == "ship_operation"`. A category is operable when
*every* skill claiming it has reached the stated level. All 26 categories have exactly two
claimants, Control and System Management, both at level 5. `verify_skills.py` already
enforces the "exactly two" property.

**Fleet size** — `unlocks[].type == "fleet_slot"` on `skl_flt_formation_drill`, at levels
5 / 7 / 8 / 10 for ships 2–5. The first hull needs no drill. This is the **only** source of
the five-ship cap; per `gameplay_specification.md` §6.6 no other document may state it.

**Industry access** — `skl_sta_science` appears in `prerequisites` on every station and
mining skill: level 3 opens raw operations, 5 refining, 7 fabrication. A player cannot lease
a refinery slot before Science 5 or a manufactory slot before Science 7
(`industry_specification.md` §3).

The hull tree adds a fourth, structural gate: every hull names one predecessor, so reaching
a battleship means climbing the combat spine — corvette → destroyer escort → destroyer →
light cruiser → heavy cruiser → battlecruiser → battleship — rather than training 26
unrelated hulls. The auxiliary line is deliberately short, so a tanker pilot never touches
the spine.

## 4. Why the specialist wins

The ladder is `SP(level) = rank × 250 × 2^(10(L-1)/9)`, which puts almost all of a skill's
cost in its last three levels. For a rank-1 skill:

| to reach | SP | share of the skill's total |
|---|---:|---:|
| level 5 | 9,920 | **2.1 %** |
| level 8 | 101,940 | 21.4 % |
| level 10 | 476,452 | 100 % |

That single distribution is the whole design. **Competence is nearly free; mastery is
nearly everything.** The consequences fall out as arithmetic:

| career | skills | SP | turns |
|---|---:|---:|---:|
| Combat, competent — heavy cruiser, weaponry and engineering at 5 | 22 | 525,991 | **12** |
| Trade — both commerce skills at 10, a hauler, Navigation 10 | 12 | 4,427,189 | **103** |
| Mining — four mining skills at 10, Science 7, mining formation, a hauler | 14 | 8,494,019 | **197** |
| Industry — Science and all five facility skills at 10 | 6 | 11,434,836 | **265** |
| Combat, mastered — battleship line, all weaponry, engineering and fleet command at 10 | 31 | 25,152,678 | **582** |
| **Everything — all 81 skills at level 10** | **81** | **107,678,057** | **2,493** |

Read the first row against the last. Twelve turns buys a player a genuinely useful combat
pilot. Two and a half thousand turns — **6.8 years** — buys everything. An all-rounder is
not forbidden and is not even bad: at turn 50 they can fly a cruiser, run a refinery and
haul their own ore. They are simply, permanently, four levels behind the specialist in each
of those things, and levels 6–10 are where 98 % of the power is.

This is the brief's *"all rounder (but less effective)"* expressed as a budget rather than
as a penalty. Nothing debuffs the generalist. The ladder just prices depth.

## 5. Turn 1 — the new player

A player who starts with nothing and a 43,200 SP/turn trickle spends their first day unable
to act at all, which is the wrong first day. The starting package removes exactly that
problem and nothing else:

| given | value | why |
|---|---|---|
| **Home system** | one `core` system, player's choice from a short list | security tier `core` means no PvP can reach them — `conflict_specification.md` §2 |
| **One fitted hull** | a tier-1 entry hull — motor torpedo boat, submarine chaser or corvette | already fitted by the ship catalogue; nothing to buy |
| **Its two gate skills at 5** | 20,090 SP of value, incl. `skl_fund_spaceship_command` | the hull is flyable on turn 1, not turn 2 |
| **Seed credits** | enough for ~20 turns of one refinery lease plus fuel | covers the ramp, not a second hull |
| **One refinery slot**, rent-free 20 turns | a `core` planet in the home system | the brief's *"at the beginning can only refine materials"* |
| **`skl_sta_science` at 3** | opens raw operations | otherwise industry is unreachable for 0.7 turns of training a new player has no reason to know about |

Everything else is earned. The package is deliberately *narrow*: it makes the first turn
playable and the second turn a choice. The three entry hulls all cost 20,090 SP to fly, so
the choice of starter hull costs nothing and locks nothing.

### 5.1 The first thirty turns

Not a tutorial — an illustration that the ramp closes:

```
turn  1   fly the starter hull; queue Science 5; run the free refinery slot
turn  3   Science 5 -- refining unlocked properly, lease a second slot
turn  6   Mining Equipment Operation 5; belt mining pays for the leases
turn 12   a competent combat pilot (the 12-turn row above) OR Science 7 and a manufactory
turn 20   free lease expires; the operation supports itself or it does not
turn 30   Formation Drill 5 -- a second hull. The fleet begins.
```

Thirty turns is a month. That is the intended distance between "new" and "established", and
it is set by the ladder rather than chosen.

## 6. The generated catalogue

`tools/generate_progression.py` writes `GamePlay/Progression/`, and it computes rather than
authors — every figure is derived from the live skill catalogue plus `SP_PER_TURN`:

```
GamePlay/Progression/
  progression_specification.md   this file; survives a run
  training_index.json            81 skills x 10 levels: SP, cumulative SP, turns, cumulative turns
  hull_paths.json                26 categories: gate skills, full prerequisite closure, SP, turns
  careers.json                   the §4 bundles, recomputed
  index.json                     constants and totals
```

`hull_paths.json` is the interesting one. For each category it resolves the transitive
prerequisite closure of both gate skills at level 5 and publishes the total, which is what
makes `gameplay_specification.md` §6.4's monotonicity claim checkable instead of decorative.

New key in `fleet_and_weapons.json`: `progression`. New `_meta` fields: `spPerTurn`,
`turnLengthHours`.

## 7. Invariants

`tools/verify_progression.py`:

* `SP_PER_TURN == TURN_LENGTH_HOURS × SP_PER_HOUR_REFERENCE`, both read from
  `tools/skill_tables.py` — changing the reference rate moves this document's every figure
  or fails the build
* every published `spCumulative` is the running sum of its own `spPerLevel`, and
  `spTotal` is its last element
* the ladder is strictly increasing in level and strictly increasing in rank
* every skill's prerequisite closure is acyclic and terminates at a skill with none
  (`verify_skills.py` already holds acyclicity; this re-checks it through the closure walk
  that `hull_paths.json` depends on)
* **hull difficulty is monotonic**: ordering the 26 categories by closure SP never
  contradicts ordering them by heaviest tier-3 tonnage by more than one adjacent swap
* every `ship_operation` unlock names a category present in `_meta.shipCategories`
* the fleet-slot unlocks on `skl_flt_formation_drill` number exactly four, and no other
  skill in the catalogue carries a `fleet_slot` unlock
* the starting package in §5 is affordable: its SP value equals the published closure cost
  of the chosen entry hull, and no starter grant exceeds a level-5 gate
