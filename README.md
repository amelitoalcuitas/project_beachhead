# Beachhead: Last Stand

An original Three.js browser game inspired by classic fixed-emplacement beach-defense shooters. Hold a Normandy beachhead against ten waves of German combined-arms assaults, then continue in endless survival.

## Run

```bash
npm install
npm run dev
```

Build a deployable static bundle with `npm run build`, then serve `dist/` with any static web server.

## Controls

- Mouse: aim; hold left mouse to fire
- Right mouse: magnify
- `1`, `2`, `3` or mouse wheel: Browning machine gun, 57mm AT gun, 40mm Bofors
- `R`: reload
- `Esc`: pause; use Resume or Enter to continue
- Arrow keys: alternative aiming; drag to aim if the browser cannot capture the pointer

The title screen requests pointer capture only after deployment. Audio and scenery are generated locally, so the game has no runtime asset or backend dependency.

The top compass scrolls with your heading. Red diamonds mark ground enemies, chevrons mark aircraft, and edge arrows point toward enemies behind you. Bright pulsing pins identify enemies able to engage. The lower-left radar rotates with your view: forward is always up, and enemy dots and the north marker rotate around your fixed player arrow. Health, ammunition, reload progress, mission score, and weapon selection are displayed around the edge of the battlefield.

## Weapons

- **M1919A4 Browning** — infantry specialist; 120-round belt, 480 reserve, 9 shots/sec, 3-second reload. Vehicle damage is heavily reduced. The model uses a perforated barrel jacket, receiver-mounted peep and front blade, fabric ammunition belt, and tripod mount. Firing cycles the inner barrel and bolt with bottom case ejection; reloading opens the feed cover, seats the belt, and cycles the charging handle.
- **M1 57mm AT Gun** — direct-hit armor specialist; one round, 17 reserve, 1.2-second reload. 8 m HE splash with 250 base explosion damage; strong against infantry near the impact. Its procedural M1 model has a plain muzzle, scalloped shield, split-trail carriage, and wheels, with ADS aligned over the top of the gun. Barrel recoil, vertical breech opening, case ejection, shell insertion, and breech closure follow the firing/reload cycle; the carriage and ADS view remain steady.
- **40 mm Bofors L/60** — automatic anti-aircraft cannon; four-round clip, 96 reserve, 1.2 shots/sec, 1.5-second reload, 650 m/s shells. Hold fire for automatic shots and reload with R. Bofors ADS aligns through its ring sight; the AT gun uses an elevated viewpoint with a slight downward angle over the gun.

Every gun can damage every enemy, but ammunition efficiency depends on the matchup. Direct body-hit damage:

| Enemy | Browning | 57mm AT | Bofors |
| --- | ---: | ---: | ---: |
| Rifleman / grenadier | 30 | 200 | 96 |
| Armored infantry | 24 | 260 | 96 |
| Jeep | 6 | 400 | 144 |
| Truck | 4.5 | 400 | 128 |
| Halftrack | 1.2 | 500 | 64 |
| Tank | 0.45 | 600 | 16 |
| Helicopter / aircraft | 9 | 180 | 480 |

The Bofors proximity fuse arms after 20 m of travel and bursts within 6 m of a living aircraft. This is an intentional aiming aid, not a historical ammunition simulation. Its 320 base explosion damage falls off over 10 m. Weapon splash uses `base explosion damage × 0.65 × (1 − distance / radius) × splash effectiveness`; vehicle death blasts use the same radial falloff without a weapon multiplier and only hurt infantry. Terrain and scenery block blast damage. Directly struck targets do not also receive splash, and proximity bursts deal splash only. Ground enemies never trigger the fuse. At a 6 m burst distance, aircraft take 124.8 damage: three bursts destroy a Stuka and four destroy a Drache.

Rifleman splash damage by distance (splash only, no direct hit):

| Distance | 57mm AT | Bofors |
| ---: | ---: | ---: |
| 0 m | 163 | 73 |
| 2 m | 122 | 58 |
| 4 m | 81 | 44 |
| 6 m | 41 | 29 |
| 8 m | 0 | 15 |
| 10 m | — | 0 |

Destroyed ground vehicles also blast nearby infantry (examples at 0 m): Kubelwagen 91, Opel Blitz 117, halftrack 143, Panzer IV 195. Ground impacts leave scorch marks that fade after 5 seconds.

Infantry headshots retain their existing critical bonus before target resistance: Browning headshots start at 100 damage; cannon headshots multiply direct damage by 2.5. Splash never headshots. Resupply replenishes all three guns each wave. Between waves, bunker integrity restores **+200** (capped at 1000).

## Enemies

German forces include Wehrmacht riflemen, Panzergrenadiers, grenadiers (Stielhandgranate), Kubelwagens, Opel Blitz trucks, Sd.Kfz. 251 halftracks, Panzer IV tanks, Fa 223 Drache helicopters, and Ju 87 Stuka dive bombers.

Enemies must be within their type's firing range and have an unobstructed view of the bunker: Wehrmacht riflemen 90 m, Panzergrenadiers 65 m, grenadier infantry 85 m, Kubelwagens 90 m, Opel Blitz trucks 75 m, Sd.Kfz. 251 halftracks 125 m, Panzer IV tanks 170 m, Fa 223 Drache helicopters 140 m, and Ju 87 Stukas 145 m. Air-target range includes altitude. Panzergrenadiers have 120 HP; German grenadiers throw arcing grenades that deal 75 direct bunker damage on impact with an 8 m blast radius (falloff to zero at the edge). Fa 223 Drache helicopters travel at 12 m/s, stop at 220 m to deploy one paratrooper, then advance to 105 m to attack. All ground units move 10% faster than their original baseline; air-unit speeds are unchanged. Heavy attacks have a preparation cue. Enemy and player projectiles have separate ownership and collision handling.

## Development and verification

`npm test` runs regression checks for compass bearings, north wraparound, firing distances, occlusion gating, swept projectile collision, all 27 weapon matchups, splash resistance, and proximity-fuse arming and impact ordering, and weapon animation/ADS regressions, including MG idle transforms, rapid fire, and partial reloads. The test command uses Node's TypeScript support and requires Node 22.18+ or Node 24+.

The presentation is split into the battlefield, first-person weapon view, enemy models, and HUD modules. The main loop owns combat state and sends snapshots to the HUD. Content definitions are shared by gameplay and tests.
