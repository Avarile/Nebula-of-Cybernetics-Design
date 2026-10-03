# Lore — Specification

The world behind the mechanics. Written 2026-10-03.

Owned by this document: what the setting is, who the NPC factions are, which faction
polices which region, who flies each NPC squadron, and where each weapon manufacturer is
from. Not owned: any number. Every rate, price, spawn and bias stays where it is —
`tools/gameplay_tables.py`, `tools/system_tables.py`, `tools/generate_weapons.py` — and this
document names who stands behind it.

The ids the game consumes live in `tools/lore_tables.py`, mirrored in `Reference/lore.ts`.
`tools/verify_lore.py` checks both against the live catalogue and against this document.

## 1. Rules for this document

* **Lore explains, it never decides.** Where a story and a table disagree, the table wins
  and the story is rewritten. `verify_lore.py` fails when they drift — a manufacturer whose
  "strength" is no longer its best stat, a region policed by nobody that holds `mid` space.
* **A name is not a mechanic.** A faction's home region does not restrict where its
  squadrons spawn; spawning stays by security tier (`conflict_specification.md` §3).
* **Planets stay terrain.** Factions police space; none owns a planet, a lease or a gate
  (`Systems_Planets` §10, `gameplay_specification.md` §9).

## 2. The premise

### 2.1 The Nebula and the Helm

The game is set inside one dense emission nebula, sixty systems deep. Inside it, a drive can
push a hull across a system but nothing can cross between stars: the gas blinds long-range
sensors and scatters any jump. Travel between systems is possible **only through the
gates**, and the gates were here first.

Nobody knows who built them. What is known is how they behave. Every gate measures the
traffic and the nebular drift passing through it and corrects for both, constantly — a
**feedback machine** spanning the whole network. The first settlers called it the **Helm**,
after the older meaning of *cybernetics*: *kybernētēs*, the steersman. That is the name of
the place. It is the **Nebula of Cybernetics** because the only thing that makes it
navigable is a machine that steers.

### 2.2 Governance is what `securityRating` measures

The Helm's regulation is strongest at Aurelia, the gate humans came through, and weakens
with every gate outward. Settlers call its strength **governance**, and `securityRating` is
that quantity: 1.00 at Aurelia, 0.00 at Abyssal Rift.

Governance explains the map's central inversion (`Systems_Planets` §3) rather than merely
coexisting with it:

* **Where the Helm governs, the nebula is calm.** Orbits are stable, power is steady and
  the long-lived works that a capital keel needs can be built — which is why forge worlds
  appear only in `core` and `mid`. The same calm has long since stripped the easy ore out.
  Development is high, richness low.
* **Where it does not, the nebula churns.** Unregulated drift drives raw matter into the
  belts and leaves worlds cracked open and irradiated — which is why `irradiated` and
  `shattered` worlds, the precision lane, exist only in `rim` and `deadspace`. Richness is
  high, development low.
* **Deadspace is not merely far away.** Its gates still open, but the Helm there was
  broken (§3, the Severance). No regulation reaches it at all.

### 2.3 Why a space fleet looks like a navy

Gate-space fights like coastal water. The routes are fixed, the chokepoints are named, cargo
moves in convoys and the prize is the cargo. The first Admiralty went to the old naval
archives for doctrine, and the hull categories are what it found: corvettes and sloops to
escort, merchant raiders to prey on trade, monitors and the panzerschiff to hold a gate,
carriers and seaplane tenders to launch small craft.

The nebula makes the rest literal. The gas is thick enough to hide in, so a hull can run
**submerged** — the `silent` posture — and submarines, submarine chasers and depth-charge
racks are real tools rather than costume.

### 2.4 Credits and leases

A **credit** is a unit of the Helm's ledger. Every gate keeps it, which is why credits are
good in deadspace, where no government exists to back them. A **lease** is a claim
registered in the same ledger: the Helm, not any faction, allocates a planet's slots, and
rent is the fee for holding the claim. That is the in-world reason planets have no owner
field.

A **station** is the one thing in orbit a player can own outright, the way they own a hull.
The anchorage it holds is a claim in the same ledger, and an anchored structure keeps its
orbit only where the Helm keeps the nebula calm — which is why no orbital station holds in
deadspace (`station_specification.md` §6). Owning a station is not owning the planet below
it, and no faction builds one.

## 3. History, briefly

| era | what happened | what it left in the game |
|---|---|---|
| **Landfall** | the settler convoy enters through Aurelia; the gate does not open back | Aurelia is `sys_001`, governance 1.00 |
| **The Charting** | the Tannhau pilots map the network outward, gate by gate | the Pilotage; named bridges such as Tannhau Narrows |
| **The Gate War** | the Obsidian Directorate of the Marches tries to *steer the Helm* — to seize the governing gates and set the regulation itself | privateers holding Directorate letters of marque; a battle line that never stood down |
| **The Severance** | the attempt fails. The Helm goes silent beyond the Marches and in the Hollow; the Directorate collapses | deadspace; Obsidian Marches and The Pale Hollow have no government |
| **The Accord of the Gates** | the four surviving powers sign one treaty: the interlock, the response fleets, a shared aggressor register | the `core`/`mid` rules of `conflict_specification.md` §2 |

The game opens in the Accord's long peace — safe at its heart, lawless past its edge.

## 4. Factions

Eight factions, two kinds. Ids are `fac_<slug>`.

| id | name | kind | home region | squadrons |
|---|---|---|---|---|
| `fac_aurelian_admiralty` | The Aurelian Admiralty | authority | Aurelian Reach | — |
| `fac_kestrel_charter` | The Kestrel Charter Company | authority | Kestrel Span | — |
| `fac_cindral_syndics` | The Foundry Syndics of Cindral | authority | Cindral Verge | — |
| `fac_tannhau_pilotage` | The Tannhau Pilotage | authority | Tannhau Drift | — |
| `fac_free_corsairs` | The Free Corsairs | hostile | Tannhau Drift | `npc_mid_pirate_raiders`, `npc_rim_pirate_wing` |
| `fac_lettered_captains` | The Lettered Captains | hostile | Cindral Verge | `npc_rim_raider_pack` |
| `fac_gravewatch_warbands` | The Gravewatch Warbands | hostile | Obsidian Marches | `npc_dead_warband` |
| `fac_revenant_line` | The Revenant Line | hostile | The Pale Hollow | `npc_dead_capital_threat` |

### 4.1 The authorities and the Accord

An **authority** polices the `core` and `mid` systems of exactly one region. Inside its
region it fields the response fleet, posts NPC buy and sell orders, posts NPC contracts and
holds the standing a player earns there. Its writ stops at `mid`: a policed region's `rim`
systems are claimed on paper and get no response fleet, exactly as `conflict_specification.md`
§2 says.

The **Accord** is a treaty, not a faction, and it is why the four authorities behave
identically:

* **The interlock** (`core`). Every Accord-registered hull's fire control is slaved to the
  gate it last passed. In `core` the Helm is strong enough that the interlock refuses
  weapons release against another registered hull outright — which is why an aggression
  order in `core` is *rejected at validation* rather than punished.
* **The register** (`mid`). In `mid` the interlock can no longer stop a shot, only record
  it. The aggressor is entered in the shared register — the 10-turn flag — which every
  authority honours: their response fleets engage a flagged hull anywhere in `core` or
  `mid`, and their NPC orders refuse to trade with it.
* **The standard response formation.** The Accord fixes one response formation per tier,
  so the `core` and `mid` response fleets (`gameplay_tables.RESPONSE_FLEET`) are the same
  in every region, flown by whichever authority holds it. A `mid` fleet arrives late
  because it has to come through a gate; in `core` it is already on station.
* **The bounty fund.** All four authorities pay into one fund, which pays more the deeper
  a kill is made, because the deep threats are what reach the convoys. Underwriters take the
  opposite view and stop paying cover where governance ends.

The four authorities:

* **The Aurelian Admiralty** — the oldest power, seated at Aurelia, keeper of the Accord's
  text and of its register. Naval to the bone; it wrote the doctrine every hull category
  descends from.
* **The Kestrel Charter Company** — a trading company that governs because it was chartered
  to. Its region builds more hulls than any other, and its politics are the convoy's: keep
  the lanes open, keep the raiders off them.
* **The Foundry Syndics of Cindral** — a council of foundry masters. Cindral Verge is where
  ore becomes metal; the Syndics answer to output, and their `mid` space borders the first
  `rim` ore fields.
* **The Tannhau Pilotage** — the guild that charted the gates and still licenses pilots
  through the Crossing. The smallest writ of the four, three `mid` systems at a junction of
  bridges, and the most exposed.

### 4.2 The hostile factions

Each NPC squadron template in `gameplay_tables.NPC_SQUADRONS` flies for one hostile faction.
The compositions are untouched; the factions explain them.

* **The Free Corsairs** — a loose brotherhood of pirates operating out of the Threnody Chain.
  Light and quick in `mid`, where they must strike and be gone before the response fleet
  arrives (*Pirate Raiders*: corvettes and a submarine chaser), and heavier in the `rim`,
  where nobody comes (*Pirate Wing*: destroyers and light cruisers). They hunt haulers, which
  is the behaviour `mid` exists to encourage.
* **The Lettered Captains** — commerce raiders holding letters of marque issued by the
  Obsidian Directorate during the Gate War. The Directorate never signed the Accord because
  it no longer existed, so the letters were never revoked, and the Captains still call their
  prizes lawful. They anchor in Scoria Deep and fly the merchant raider — a warship dressed
  as a freighter (*Raider Pack*).
* **The Gravewatch Warbands** — the Directorate's heirs: warlords who hold the deadspace of
  Gravewatch Span with cruisers and a battlecruiser (*Deadspace Warband*). Human, organised
  and paid in ore.
* **The Revenant Line** — the Directorate's battle line, which went into the Hollow at the
  Severance and never received the ceasefire. Its hulls run on the last orders their
  automation kept. A battleship and its heavy cruisers still sortie as a line (*Capital
  Threat*). Nobody negotiates with it.

Bounty, salvage, reference value and spawn tier are the squadron's, unchanged
(`conflict_specification.md` §3). A faction has no standing with the player: hostile is a
kind, not a score.

## 5. Regions

| region | authority | core | mid | rim | deadspace |
|---|---|---:|---:|---:|---:|
| Aurelian Reach | `fac_aurelian_admiralty` | 7 | 3 | 0 | 0 |
| Kestrel Span | `fac_kestrel_charter` | 4 | 6 | 0 | 0 |
| Cindral Verge | `fac_cindral_syndics` | 0 | 7 | 3 | 0 |
| Tannhau Drift | `fac_tannhau_pilotage` | 0 | 3 | 7 | 0 |
| Obsidian Marches | — | 0 | 0 | 6 | 4 |
| The Pale Hollow | — | 0 | 0 | 2 | 8 |

A region has an authority exactly when it holds `core` or `mid` space. `verify_lore.py`
recomputes this table's counts and that rule from the live map.

* **Aurelian Reach** — *the Old Reach.* Landfall, the Admiralty's seat and most of the
  capital yards in the Nebula. Mined out long ago — every system is richness 1, and it holds
  no irradiated or shattered world — so it lives on imported ore. Home of the Vanguard and
  Meridian lines. Bridges: The Meridian Gate to Kestrel, Cindral Approach to Cindral.
* **Kestrel Span** — *the Yards.* More shipyards than any other region and the densest
  convoy traffic. The Charter Company's whole politics is escort, which is what the Kestrel
  line's rate of fire is for. Home of Kestrel and Solari. Bridges: The Meridian Gate,
  Tannhau Narrows.
* **Cindral Verge** — *the Forge Belt.* All `mid` and `rim`, one forge world at Cindral and
  ferrous and volcanic worlds throughout. The first irradiated worlds sit in Scoria Deep, its `rim`, where
  the Lettered Captains anchor. Home of Draconis and Ashwright. Bridges: Cindral Approach,
  Scoria Crossing.
* **Tannhau Drift** — *the Crossing.* Three policed systems at a junction of three bridges,
  and seven `rim` systems behind them with shattered and irradiated worlds and no forge
  world. The Free Corsairs operate out of the Threnody Chain. Home of Voss and Halcyon.
  Bridges: Tannhau Narrows, Scoria Crossing, Obsidian Threshold.
* **Obsidian Marches** — *the Fallen Directorate.* No government since the Severance; its
  `rim` foundries still work, and Gravewatch Span beyond them is deadspace held by the
  warbands. Home of the Obsidian free foundries. Bridges: Obsidian Threshold, Cold Harbour
  Approach, The Long Dark.
* **The Pale Hollow** — *where the Helm went silent.* Eight deadspace systems, the richest
  precision ground in the Nebula, and a single shipyard at Silentreach. The Revenant Line
  sorties from The Abyssal. Home of the Ceridan line, built for crews who cannot resupply.

### 5.1 Standings follow the authority, not the region

**Decision: standings are keyed by authority faction id**, not by region name.
`Data-Templates/player.interface` and `Reference/lore.ts` (`Standings`) carry it;
`conflict_specification.md` §6 states the rule.

Why: standing is an opinion, and only an authority holds one. Keyed by region, two of the
six keys (Obsidian Marches, The Pale Hollow) could move and never do anything. Keyed by
faction, every key that exists has an effect, and the key survives a region rename.

Why it changes no outcome: each authority polices exactly one region, so the four standings
that had an effect are the same four numbers under new names. `verify_lore.py` holds that
one-to-one map; giving an authority a second region would share one standing across two
regions, which is a mechanics change and must be made as one.

## 6. Manufacturers

Ten weapon families, one house each. **Strength** is the stat on which the family is the
unique best of all ten; **pays** is every stat on which it is worse than neutral Vanguard.
Both are checked against `generate_weapons.FAMILIES`, so the story cannot drift from the
numbers. A house's origin faction is the authority of its home region — derived, not stored.

| family | house | home | origin faction | strength | pays |
|---|---|---|---|---|---|
| Vanguard | Cantoris Arsenal (Vanguard Pattern) | Cantoris | `fac_aurelian_admiralty` | — (the neutral reference) | — |
| Meridian | Meridian Instrument Works | Meridian Gate | `fac_aurelian_admiralty` | lowest damage variance | damage, crit |
| Kestrel | Kestrel Arms of the Charter | Kestrel | `fac_kestrel_charter` | rate of fire | damage, range, power, crit |
| Solari | Solari Lightworks | Farhaven | `fac_kestrel_charter` | power efficiency | damage, crit |
| Draconis | Draconis Heavy Foundry | Cindral | `fac_cindral_syndics` | damage | tracking, accuracy, power, variance, ammo |
| Ashwright | Ashwright & Daughters | Ashfall | `fac_cindral_syndics` | second effect a mark early | damage, power |
| Voss | Voss Fortress Ordnance | Tannhau | `fac_tannhau_pilotage` | range | rate of fire, cooldown, tracking, power, ammo |
| Halcyon | Halcyon Optical | Halcyon Rest | `fac_tannhau_pilotage` | accuracy, tracking | damage, crit |
| Obsidian | The Obsidian Free Foundries | Obsidian | — | critical chance | damage, tracking, accuracy, range, variance |
| Ceridan | Ceridan Long-Patrol Yards | Silentreach | — | ammunition, cooldown | damage, range, power, crit |

* **Vanguard** — the Admiralty pattern. Every gun the Accord fleets were first issued, built
  at the Cantoris arsenal to one drawing; every other house is measured against it, which is
  why its bias is all 1.00.
* **Meridian** — instrument makers before they were gunmakers. Damage variance at 0.45 of
  Vanguard's and +15 % tracking: a Meridian gun hits for the same number every time, and
  pays for it with 0.93 damage and 0.85 crit. The gun a careful captain buys.
* **Kestrel** — the Charter Company's escort guns: 1.50× rate of fire and 1.25× ammunition at
  0.72× damage per shot. Built to put a wall of shells between a convoy and a corvette.
* **Solari** — energy-lane specialists from the Span's crystalline worlds. 0.70× power cost
  for 0.90× damage: the line for a hull whose reactor is already spoken for.
* **Draconis** — the Syndics' heavy foundry. 1.30× damage, and everything else is the bill:
  −0.07 hit chance, 0.85× tracking, 1.20× power, 1.15× variance, 0.85× ammunition.
* **Ashwright** — a family foundry in Ashfall that fields what others are still testing: its
  second special effect arrives at Mk.2 instead of Mk.3, with a 1.35× crit edge, paid in
  1.15× power and 0.97× damage.
* **Voss** — fortress gunnery from the Narrows, built to hold a gate. 1.45× range and a little
  more damage, at 0.70× rate of fire, one extra cooldown round, worse tracking and power.
* **Halcyon** — optics makers who moved out to Halcyon Rest, in the Drift's `rim`, to sit on
  the precision isotopes their sights need. +0.07 hit chance and 1.30× tracking at 0.85×
  damage.
* **Obsidian** — the Marches' free foundries, building from salvage with no standards body
  over them. 1.60× crit and 1.70× variance: a gamble that pays in spikes, and loses a little
  everywhere else.
* **Ceridan** — built in the Hollow's single yard for crews who cannot resupply: 1.60×
  ammunition and one cooldown round fewer. On a gun with neither ammunition nor cooldown the
  sustain re-expresses as one extra shot (`generate_weapons.py`), so no Ceridan line is a
  strictly worse Vanguard.

A family whose name is also a place on the map — Kestrel, Meridian, Halcyon, Obsidian — is
homed in that place. `verify_lore.py` enforces it against the live system, constellation and
region names.

## 7. What the game consumes

`tools/lore_tables.py`, mirrored one-to-one in `Reference/lore.ts`:

| table | contents | consumer |
|---|---|---|
| `FACTIONS` | id, name, kind, home region | UI, contracts, battle log narration |
| `REGION_AUTHORITY` | region → authority id or none | standings keys, response-fleet and NPC-order owner |
| `SQUADRON_FACTION` | squadron id → hostile faction id | `factionId` on every generated squadron (`npc_squadron.interface`), spawn naming, bounty notices, narration |
| `FAMILY_HOUSES` | family → house, home system, strength, pays | weapon display, market flavour |
| `POLICED_TIERS` | derived from `RESPONSE_FLEET`'s keys, never typed | the authority-exists rule |

`tools/verify_lore.py` checks:

* every faction id is well-formed, unique, of a known kind, homed in a live region, and
  **used** — an authority by `REGION_AUTHORITY`, a hostile faction by `SQUADRON_FACTION`;
* `REGION_AUTHORITY` covers exactly the live regions; a region has an authority **exactly
  when** it holds a system in a policed tier; each authority polices exactly one region, its
  home;
* `SQUADRON_FACTION` covers exactly the live `npcSquadrons`; each hostile faction's home
  region has systems of every tier its squadrons spawn in;
* `FAMILY_HOUSES` covers exactly the live weapon families; every home is a live system; a
  family named after a place is homed there; every strength is the family's unique best,
  every pays list is exactly its unfavourable set, Vanguard is neutral, and `early_effect`
  belongs to `EARLY_EFFECT_FAMILY` alone;
* `Reference/lore.ts` matches the table entry for entry, including the derived origin faction
  and system id;
* this document's §5 table matches the live security mix, and it names every faction id;
* `player.interface` keys standings by faction id.

`tools/verify_npc.py` checks that every generated squadron carries the `factionId`
`SQUADRON_FACTION` gives it, and that it is a hostile faction. A response fleet carries no
owner: it is the authority of the region an engagement is in, recorded on the engagement
(`Data-Templates/engagement.interface`).

## 8. Out of scope

* **Faction-specific response fleets or prices.** The Accord makes them uniform, which is
  exactly what `gameplay_tables.py` already says. Differentiating them would be a mechanics
  change.
* **Standing with hostile factions.** None. Hostile is a kind, not a relationship.
* **Deep-space stations and sovereignty.** Unchanged from `gameplay_specification.md` §9;
  orbital stations are property, not sovereignty (`station_specification.md` §5).
