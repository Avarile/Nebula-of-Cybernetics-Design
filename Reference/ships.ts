/**
 * ships.ts — the 26 ship classes, their 78 tier hulls and 20 named ships.
 *
 * Derived from: Data-Templates/ship.interface, Ships/*, tools/ship_tables.py,
 *               tools/generate_ships.py, fleet_and_weapons.json -> "ships" / "namedShips"
 *
 * Shape of the domain:
 *
 *     hull = category signature  x  tier
 *
 * Each of the 26 categories carries a signature (mass band, armour and shield
 * type, how many mounts at which sizes, which slot types, mobility, capacities,
 * and what it reaches for when arming itself). Tier 1 sits low in the mass band,
 * tier 3 high; hull, shields, power and crew skill rise per tier, and tiers 2
 * and 3 add mounts and slots.
 *
 * Hulls arrive FITTED. Weapons and modules are chosen at `mark === tier` from a
 * per-category preference order, and a `specific` module is only fitted where its
 * `hullAffinity` permits.
 *
 * Two budgets are enforced rather than assumed:
 *   power.maxPower >= passive module draw + one full weapon volley
 *   crew.maxCrew   >= sum of fitted modules' crewRequired
 */

import type {
  BuildCost,
  Distance,
  Fraction01,
  HardpointId,
  HitPoints,
  Mass,
  MassBand,
  ModuleId,
  ModuleSlotId,
  ModuleSlotType,
  MountType,
  ShipId,
  ShipTier,
  Size,
  Tons,
  WeaponId,
} from './common';

// ---------------------------------------------------------------- vocabularies

/**
 * The 26 ship classes, ordered by mass band. This is one flat enum: it replaces
 * BOTH the broad `shipSchema` enum in data-template.json (scout | frigate |
 * cruiser | battleship | carrier | freighter) and the separate `shipSubClass`
 * field, which is dropped.
 *
 * Directory names under `Ships/` are prose versions of these, and two differ
 * because `/` cannot appear in a directory name: `Ships/Sloop - patrol escort`
 * and `Ships/Minelayer - sweeper`.
 */
export type ShipClass =
  | 'motor_torpedo_boat'
  | 'submarine_chaser'
  | 'corvette'
  | 'torpedo_boat_fleet'
  | 'destroyer_escort'
  | 'sloop_patrol_escort'
  | 'destroyer'
  | 'landing_ship_tank'
  | 'submarine'
  | 'minelayer_sweeper'
  | 'coastal_defence_ship'
  | 'anti_aircraft_cruiser'
  | 'monitor'
  | 'light_cruiser'
  | 'attack_transport'
  | 'light_carrier'
  | 'panzerschiff'
  | 'merchant_raider'
  | 'seaplane_tender'
  | 'repair_ship_tender'
  | 'heavy_cruiser'
  | 'escort_carrier'
  | 'fleet_oiler'
  | 'fleet_aircraft_carrier'
  | 'battlecruiser'
  | 'battleship';

/** `reactive` is schema- and generator-supported but unused by the tier hulls. */
export type ArmorType = 'light' | 'medium' | 'heavy' | 'reactive';

/** `none` is real: a motor torpedo boat and a submarine carry no shields at all. */
export type ShieldType = 'kinetic' | 'energy' | 'hybrid' | 'none';

// ---------------------------------------------------------------- stat blocks

export interface Hull extends HitPoints {
  /** Flat damage reduction, applied only after shields reach 0. */
  armorRating: number;
  armorType: ArmorType;
}

/** Per-damage-type reduction, 0-1. Keys match `WeaponDamage['damageType']`. */
export interface DamageTypeResistance {
  kinetic: Fraction01;
  energy: Fraction01;
  explosive: Fraction01;
}

export interface Shields extends HitPoints {
  rechargeRatePerTurn: number;
  /** Turns that must pass after a hit before recharge resumes. */
  rechargeDelayAfterHit: number;
  shieldType: ShieldType;
  damageTypeResistance: DamageTypeResistance;
}

export interface Hardpoint {
  hardpointId: HardpointId;
  /** A weapon may only be mounted here if `weapon.size === this.size`. */
  size: Size;
  mountType: MountType;
  /** Null on an empty mount. Every generated hull arrives fully fitted. */
  weaponEquipped: WeaponId | null;
}

export interface Hardpoints {
  description?: string;
  list: Hardpoint[];
}

export interface ModuleSlot {
  slotId: ModuleSlotId;
  slotType: ModuleSlotType;
  /** Must equal the module's size. */
  size: Size;
  moduleEquipped: ModuleId | null;
}

export interface ModuleSlots {
  description?: string;
  list: ModuleSlot[];
}

/**
 * A targetable subsystem. Component damage tracks in a PARALLEL pool — it does
 * not subtract from hull HP. Depleting the pool fires `criticalEffect` immediately.
 */
export interface Component<E extends string = string> extends HitPoints {
  criticalEffect: E;
}

/** The six subsystems, each with a fixed critical-effect string. */
export interface ComponentHitpoints {
  description?: string;
  bridge: Component<'disables targeting computer, -50% accuracy'>;
  engines: Component<'-70% speed and turn rate'>;
  weaponSystems: Component<'random hardpoint disabled'>;
  shieldGenerator: Component<'shield recharge disabled'>;
  sensorArray: Component<'-40% hit chance, reduced detection range'>;
  lifeSupport: Component<'crew casualties over time'>;
}

/** Keys of `ComponentHitpoints` — the legal values of a targeted component. */
export type ComponentName =
  | 'bridge'
  | 'engines'
  | 'weaponSystems'
  | 'shieldGenerator'
  | 'sensorArray'
  | 'lifeSupport';

export interface Mobility {
  /** Units/sec. Also the input to speed-based evasion in combat. */
  topSpeed: number;
  /** Units/sec^2. */
  acceleration: number;
  /** Degrees/sec. */
  turnRate: number;
  /** Base chance to avoid being hit, 0-1. Scales inversely with mass. */
  evasionRating: Fraction01;
}

export interface Crew {
  maxCrew: number;
  currentCrew: number;
  /** 0-100. Feeds initiative and evasion. */
  pilotSkill: number;
  /** 0-100. Adds `gunnerySkill / 200` to base hit chance. */
  gunnerySkill: number;
  /** 0-100. Affects repair speed and power management. */
  engineeringSkill: number;
}

export interface Power {
  /** Covers passive module draw plus one full weapon volley — enforced, not assumed. */
  maxPower: number;
  currentPower: number;
  regenPerTurn: number;
  note?: string;
}

/**
 * Added beyond data-template.json: module effects target these two stats, so
 * without them a Search Radar or Datalink Relay would modify nothing.
 */
export interface Sensors {
  detectionRange: Distance;
  /** Added to the initiative roll. */
  initiative: number;
}

/**
 * What the hull can hold. Added beyond data-template.json because module effects
 * target 34 ship stats and roughly half had no hull field to apply to.
 *
 * Most values read 0 — a battleship carries no troops — which is exactly what
 * makes a `specific` module specific.
 */
export interface Capacities {
  cargo: Tons;
  /** Rounds. */
  ammo: number;
  fuel: Tons;
  /** Embarked personnel. */
  troops: number;
  /** Airframes. */
  aircraft: number;
  drones: number;
  mines: number;
  /** Casualty berths. */
  medical: number;
  /** Hull points repaired per turn to a docked ship. */
  repairRate: number;
}

// ---------------------------------------------------------------- the entity

/** Fields common to a class template and a named instance of one. */
export interface ShipBase {
  shipId: ShipId;
  name: string;
  tier: ShipTier;
  shipClass: ShipClass;
  mass: Mass;
  hull: Hull;
  shields: Shields;
  hardpoints: Hardpoints;
  moduleSlots: ModuleSlots;
  componentHitpoints: ComponentHitpoints;
  mobility: Mobility;
  crew: Crew;
  power: Power;
  /** Bare-hull cost PLUS the buildCost of every fitted weapon and module. */
  buildCost: BuildCost;
  sensors: Sensors;
  capacities: Capacities;
}

/**
 * A tier hull — one of the 78 class templates.
 * `shipId` is `ship_<shipClass>_t<tier>`.
 */
export interface ShipTemplate extends ShipBase {
  templateId?: never;
}

/**
 * A named ship — an instance of a class with its own loadout. One of 20.
 * `shipId` is `ship_<shipClass>_<slug>`; it sits beside the tier hulls of its own
 * class in `Ships/<Category>/<Named ship>/`.
 */
export interface NamedShip extends ShipBase {
  /** The tier hull this ship is an instance of, e.g. `ship_destroyer_t1`. */
  templateId: ShipId;
}

export type Ship = ShipTemplate | NamedShip;

/** Narrowing helper matching the `kind` tag used by Ships/index.json. */
export function isNamedShip(ship: Ship): ship is NamedShip {
  return typeof (ship as NamedShip).templateId === 'string';
}

// ---------------------------------------------------------------- category table
//
// The per-category signature the generator consumes. Not serialised on any ship;
// modelled here because it is the actual design surface for ship balance
// (tools/ship_tables.py).

export interface ShipCategorySignature {
  key: ShipClass;
  /** Prose directory name under `Ships/`. */
  folder: string;
  mass: MassBand;
  armor: ArmorType;
  shield: ShieldType;
  /** Tier-1 baselines; tiers 2 and 3 scale up from here. */
  speed: number;
  accel: number;
  turn: number;
  evade: Fraction01;
  /** Crew multiplier applied to a mass-derived base. */
  crew_f: number;
  det: Distance;
  init: number;
  /** Hardpoint sizes at tier 1, and the extra mounts tiers 2 and 3 add. */
  hp: readonly Size[];
  hp2: readonly Size[];
  hp3: readonly Size[];
  /** Module slot types at tier 1, and the extra slots tiers 2 and 3 add. */
  slots: readonly ModuleSlotType[];
  slots2: readonly ModuleSlotType[];
  slots3: readonly ModuleSlotType[];
  /** Doctrine: weapon archetypes this category reaches for, in preference order. */
  wpn: readonly import('./weapons').WeaponArchetype[];
  /** Manufacturers this category buys from, in preference order. */
  fam: readonly import('./weapons').WeaponFamily[];
  /** Largest module size the hull can accept. */
  mod_cap: Size;
  /** Non-zero capacity seeds; everything unlisted stays 0. */
  cap: Partial<Capacities>;
  /** `shields.maxHP` as a fraction of `hull.maxHP`. 0 means no shields at all. */
  shield_ratio: Fraction01;
}

/** Fitting budgets the generated data satisfies, checked by tools/verify_ships.py. */
export interface HullBudgets {
  /** `sum(weapon.powerCost * weapon.fireRate.shotsPerTurn)` over fitted weapons. */
  fullVolleyPowerDraw: number;
  /** `sum(module.powerCost)` over fitted modules. */
  passiveModuleDraw: number;
  /** `sum(module.crewRequired)` over fitted modules. */
  crewRequired: number;
}
