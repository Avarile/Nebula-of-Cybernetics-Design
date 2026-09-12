#!/usr/bin/env python3
"""Per-category role signatures for the 26 ship classes.

Everything the ship generator needs that is NOT derivable: the mass band (published in
Data-Templates/ship.interface), what the hull is armoured and shielded like, how many
mounts and slots it carries, how it moves, what it can hold, and what it reaches for
when arming itself.
"""

def C(key, folder, mass, armor, shield, speed, accel, turn, evade, crew_f, det, init,
      hp, hp2, hp3, slots, slots2, slots3, wpn, fam, mod_cap, cap=None, shield_ratio=0.55):
    return dict(key=key, folder=folder, mass=mass, armor=armor, shield=shield, speed=speed,
                accel=accel, turn=turn, evade=evade, crew_f=crew_f, det=det, init=init,
                hp=hp, hp2=hp2, hp3=hp3, slots=slots, slots2=slots2, slots3=slots3,
                wpn=wpn, fam=fam, mod_cap=mod_cap, cap=cap or {}, shield_ratio=shield_ratio)

CATEGORIES = [
    C('motor_torpedo_boat', 'Motor torpedo boat', (30, 115), 'light', 'none',
      620, 90, 130, 0.42, 1.0, 260, 12,
      ['small', 'small'], ['small'], ['small'],
      ['engine'], ['utility'], ['sensor'],
      ['Seeker Missile', 'AA Autocannon', 'Chain Gun', 'Autocannon'], ['Kestrel', 'Meridian'],
      'small', {'ammo': 40, 'fuel': 120}, shield_ratio=0.0),

    C('submarine_chaser', 'Submarine chaser', (95, 450), 'light', 'kinetic',
      480, 70, 105, 0.36, 1.1, 420, 11,
      ['small', 'small'], ['small'], ['small'],
      ['engine', 'sensor'], ['utility'], ['defensive'],
      ['Depth Charge Rack', 'AA Autocannon', 'PD Autocannon', 'Autocannon'], ['Vanguard', 'Meridian'],
      'small', {'ammo': 90, 'fuel': 260}, shield_ratio=0.35),

    C('corvette', 'Corvette', (925, 1100), 'light', 'kinetic',
      430, 58, 88, 0.30, 1.2, 480, 10,
      ['small', 'small', 'medium'], ['small'], ['medium'],
      ['engine', 'sensor'], ['utility'], ['defensive'],
      ['Autocannon', 'AA Autocannon', 'Depth Charge Rack', 'Missile Rack'], ['Vanguard', 'Kestrel'],
      'medium', {'ammo': 220, 'fuel': 900}, shield_ratio=0.45),

    C('torpedo_boat_fleet', 'Torpedo boat (fleet)', (600, 1700), 'light', 'kinetic',
      500, 66, 100, 0.34, 1.1, 440, 12,
      ['small', 'medium'], ['small'], ['medium'],
      ['engine', 'sensor'], ['utility'], ['defensive'],
      ['Torpedo Launcher', 'Seeker Missile', 'AA Autocannon', 'Autocannon'], ['Draconis', 'Kestrel'],
      'medium', {'ammo': 180, 'fuel': 700}, shield_ratio=0.42),

    C('destroyer_escort', 'Destroyer escort', (1100, 1900), 'medium', 'kinetic',
      400, 52, 80, 0.27, 1.3, 620, 11,
      ['small', 'small', 'medium'], ['small'], ['medium'],
      ['engine', 'sensor'], ['utility'], ['defensive'],
      ['Depth Charge Rack', 'AA Autocannon', 'Autocannon', 'Interceptor Missile'], ['Meridian', 'Vanguard'],
      'medium', {'ammo': 300, 'fuel': 1400}, shield_ratio=0.50),

    C('sloop_patrol_escort', 'Sloop - patrol escort', (1250, 1900), 'medium', 'kinetic',
      380, 48, 76, 0.26, 1.3, 640, 10,
      ['small', 'medium'], ['small'], ['small'],
      ['engine', 'sensor'], ['utility'], ['utility'],
      ['AA Autocannon', 'Depth Charge Rack', 'Autocannon', 'Missile Rack'], ['Vanguard', 'Ceridan'],
      'medium', {'ammo': 280, 'fuel': 1600}, shield_ratio=0.48),

    C('destroyer', 'Destroyer', (1300, 3600), 'medium', 'kinetic',
      420, 55, 82, 0.28, 1.4, 700, 13,
      ['medium', 'small', 'medium'], ['small'], ['medium'],
      ['engine', 'sensor'], ['defensive'], ['command'],
      ['Torpedo Launcher', 'Railgun', 'AA Autocannon', 'Autocannon'], ['Draconis', 'Vanguard'],
      'medium', {'ammo': 420, 'fuel': 2200, 'mines': 30}, shield_ratio=0.52),

    C('landing_ship_tank', 'Landing ship, tank', (3800, 4100), 'light', 'kinetic',
      190, 22, 34, 0.10, 1.6, 380, 6,
      ['small', 'small'], ['small'], ['medium'],
      ['engine', 'cargo'], ['utility'], ['cargo'],
      ['AA Autocannon', 'Flak Cannon', 'Autocannon'], ['Vanguard', 'Kestrel'],
      'large', {'cargo': 2600, 'troops': 400, 'fuel': 3000, 'ammo': 200}, shield_ratio=0.30),

    C('submarine', 'Submarine', (500, 5200), 'light', 'none',
      240, 26, 44, 0.38, 1.2, 520, 14,
      ['medium', 'medium'], ['small'], ['medium'],
      ['engine', 'sensor'], ['utility'], ['cargo'],
      ['Torpedo Launcher', 'Seeker Missile', 'Proximity Mine Dispenser'], ['Meridian', 'Draconis'],
      'medium', {'ammo': 240, 'fuel': 2600, 'mines': 40}, shield_ratio=0.0),

    C('minelayer_sweeper', 'Minelayer - sweeper', (600, 7000), 'light', 'kinetic',
      320, 36, 58, 0.20, 1.4, 560, 9,
      ['small', 'medium'], ['small'], ['medium'],
      ['engine', 'utility'], ['cargo'], ['sensor'],
      ['Mine Layer', 'AA Autocannon', 'Autocannon', 'Depth Charge Rack'], ['Ceridan', 'Meridian'],
      'medium', {'mines': 220, 'ammo': 200, 'fuel': 1800}, shield_ratio=0.40),

    C('coastal_defence_ship', 'Coastal defence ship', (3600, 8000), 'heavy', 'hybrid',
      260, 24, 40, 0.11, 1.7, 600, 9,
      ['large', 'medium', 'small'], ['medium'], ['large'],
      ['engine', 'defensive'], ['command'], ['sensor'],
      ['Gauss Cannon', 'Railgun', 'Flak Cannon', 'AA Autocannon'], ['Draconis', 'Solari'],
      'large', {'ammo': 900, 'fuel': 1900}, shield_ratio=0.62),

    C('anti_aircraft_cruiser', 'Anti-aircraft cruiser', (5400, 8000), 'medium', 'energy',
      380, 44, 66, 0.22, 1.8, 900, 15,
      ['small', 'small', 'medium', 'medium'], ['small'], ['medium'],
      ['engine', 'sensor'], ['defensive'], ['command'],
      ['AA Autocannon', 'Interceptor Missile', 'Flak Cannon', 'PD Autocannon'], ['Halcyon', 'Meridian'],
      'large', {'ammo': 1400, 'fuel': 3200}, shield_ratio=0.60),

    C('monitor', 'Monitor', (7200, 9200), 'heavy', 'hybrid',
      180, 16, 26, 0.07, 1.6, 560, 8,
      ['large', 'large', 'small'], ['medium'], ['large'],
      ['engine', 'defensive'], ['command'], ['sensor'],
      ['Mass Driver', 'Gauss Cannon', 'Flak Cannon', 'AA Autocannon'], ['Draconis', 'Ashwright'],
      'large', {'ammo': 1100, 'fuel': 1400}, shield_ratio=0.65),

    C('light_cruiser', 'Light cruiser', (5000, 14000), 'medium', 'hybrid',
      400, 42, 62, 0.20, 1.9, 950, 14,
      ['medium', 'medium', 'small', 'large'], ['medium'], ['large'],
      ['engine', 'sensor'], ['defensive'], ['command'],
      ['Railgun', 'Ion Cannon', 'AA Autocannon', 'Torpedo Launcher'], ['Voss', 'Solari'],
      'large', {'ammo': 1600, 'fuel': 4200}, shield_ratio=0.60),

    C('attack_transport', 'Attack transport', (8000, 14000), 'light', 'kinetic',
      250, 22, 34, 0.10, 2.4, 520, 7,
      ['small', 'small'], ['medium'], ['small'],
      ['engine', 'cargo'], ['utility'], ['cargo'],
      ['AA Autocannon', 'Flak Cannon', 'PD Autocannon'], ['Vanguard', 'Meridian'],
      'large', {'cargo': 6200, 'troops': 1400, 'fuel': 4600, 'medical': 120, 'ammo': 400},
      shield_ratio=0.35),

    C('light_carrier', 'Light carrier', (11000, 15000), 'medium', 'energy',
      370, 32, 46, 0.14, 2.2, 1300, 13,
      ['small', 'small', 'medium'], ['small'], ['medium'],
      ['engine', 'hangar'], ['sensor'], ['command'],
      ['AA Autocannon', 'Interceptor Missile', 'PD Autocannon'], ['Halcyon', 'Vanguard'],
      'capital', {'aircraft': 26, 'ammo': 1500, 'fuel': 6200}, shield_ratio=0.55),

    C('panzerschiff', 'Panzerschiff', (12000, 16000), 'heavy', 'hybrid',
      330, 30, 42, 0.13, 1.9, 880, 12,
      ['large', 'large', 'medium', 'small'], ['medium'], ['large'],
      ['engine', 'defensive'], ['command'], ['sensor'],
      ['Gauss Cannon', 'Railgun', 'Torpedo Launcher', 'AA Autocannon'], ['Draconis', 'Solari'],
      'large', {'ammo': 2000, 'fuel': 9000}, shield_ratio=0.66),

    C('merchant_raider', 'Merchant raider', (7000, 17000), 'light', 'kinetic',
      300, 26, 40, 0.16, 1.8, 780, 11,
      ['medium', 'medium', 'small'], ['medium'], ['small'],
      ['engine', 'sensor'], ['cargo'], ['utility'],
      ['Railgun', 'Torpedo Launcher', 'AA Autocannon', 'Autocannon'], ['Obsidian', 'Voss'],
      'large', {'cargo': 3400, 'ammo': 900, 'fuel': 8800, 'mines': 60}, shield_ratio=0.44),

    C('seaplane_tender', 'Seaplane tender', (8000, 17000), 'light', 'kinetic',
      280, 24, 36, 0.12, 2.1, 1100, 10,
      ['small', 'small', 'medium'], ['small'], ['medium'],
      ['engine', 'hangar'], ['utility'], ['sensor'],
      ['AA Autocannon', 'Flak Cannon', 'PD Autocannon'], ['Vanguard', 'Halcyon'],
      'large', {'aircraft': 12, 'cargo': 1800, 'fuel': 6400, 'repairRate': 30}, shield_ratio=0.40),

    C('repair_ship_tender', 'Repair ship & tender', (8000, 17000), 'light', 'kinetic',
      240, 20, 32, 0.09, 2.6, 640, 8,
      ['small', 'small'], ['small'], ['medium'],
      ['engine', 'utility'], ['cargo'], ['utility'],
      ['AA Autocannon', 'PD Autocannon', 'Flak Cannon'], ['Vanguard', 'Ceridan'],
      'large', {'cargo': 4200, 'repairRate': 120, 'medical': 200, 'fuel': 7200, 'ammo': 300},
      shield_ratio=0.36),

    C('heavy_cruiser', 'Heavy cruiser', (9000, 17000), 'heavy', 'hybrid',
      370, 36, 52, 0.17, 2.0, 1000, 14,
      ['large', 'medium', 'medium', 'small'], ['medium'], ['large'],
      ['engine', 'sensor'], ['defensive'], ['command'],
      ['Railgun', 'Gauss Cannon', 'Ion Cannon', 'AA Autocannon'], ['Solari', 'Voss'],
      'large', {'ammo': 2200, 'fuel': 7600}, shield_ratio=0.64),

    C('escort_carrier', 'Escort carrier', (7800, 24000), 'light', 'energy',
      280, 24, 36, 0.12, 2.3, 1200, 12,
      ['small', 'small'], ['small'], ['medium'],
      ['engine', 'hangar'], ['sensor'], ['utility'],
      ['AA Autocannon', 'Interceptor Missile', 'PD Autocannon'], ['Halcyon', 'Meridian'],
      'capital', {'aircraft': 20, 'ammo': 1100, 'fuel': 7400}, shield_ratio=0.46),

    C('fleet_oiler', 'Fleet oiler', (16000, 25000), 'light', 'kinetic',
      230, 18, 28, 0.08, 2.2, 560, 6,
      ['small', 'small'], ['small'], ['medium'],
      ['engine', 'cargo'], ['cargo'], ['utility'],
      ['AA Autocannon', 'PD Autocannon', 'Flak Cannon'], ['Vanguard', 'Solari'],
      'large', {'cargo': 5200, 'fuel': 46000, 'ammo': 260}, shield_ratio=0.32),

    C('fleet_aircraft_carrier', 'Fleet aircraft carrier', (13000, 45000), 'medium', 'energy',
      350, 28, 40, 0.11, 2.6, 1600, 16,
      ['small', 'small', 'medium', 'medium'], ['small'], ['medium'],
      ['engine', 'hangar'], ['command'], ['sensor'],
      ['AA Autocannon', 'Interceptor Missile', 'Flak Cannon', 'PD Autocannon'], ['Halcyon', 'Vanguard'],
      'capital', {'aircraft': 72, 'ammo': 3600, 'fuel': 14000, 'medical': 160}, shield_ratio=0.58),

    C('battlecruiser', 'Battlecruiser', (32000, 47000), 'heavy', 'hybrid',
      360, 26, 36, 0.10, 2.3, 1250, 15,
      ['capital', 'large', 'medium', 'small'], ['large'], ['capital'],
      ['engine', 'command'], ['defensive'], ['sensor'],
      ['Gauss Cannon', 'Particle Lance', 'Railgun', 'AA Autocannon'], ['Draconis', 'Voss'],
      'capital', {'ammo': 4200, 'fuel': 16000}, shield_ratio=0.68),

    C('battleship', 'Battleship', (26000, 72000), 'heavy', 'hybrid',
      300, 20, 28, 0.07, 2.8, 1150, 14,
      ['capital', 'capital', 'large', 'medium', 'small'], ['large'], ['capital'],
      ['engine', 'command'], ['defensive'], ['sensor'],
      ['Gauss Cannon', 'Particle Lance', 'Plasma Cannon', 'AA Autocannon'], ['Draconis', 'Ashwright'],
      'capital', {'ammo': 6400, 'fuel': 20000, 'medical': 90}, shield_ratio=0.72),
]

BY_KEY = {c['key']: c for c in CATEGORIES}
assert len(CATEGORIES) == 26, len(CATEGORIES)
