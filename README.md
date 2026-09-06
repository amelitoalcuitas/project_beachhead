# Beachhead: Last Stand

An original Three.js browser game inspired by classic fixed-emplacement beach-defense shooters. Defend the bunker through ten authored combined-arms waves, then continue in endless survival.

## Run

```bash
npm install
npm run dev
```

Build a deployable static bundle with `npm run build`, then serve `dist/` with any static web server.

## Controls

- Mouse: aim; hold left mouse to fire
- Right mouse: magnify
- `1`, `2`, `3` or mouse wheel: machine gun, heavy cannon, rocket launcher
- `R`: reload
- `Esc`: pause; use Resume or Enter to continue
- Arrow keys: alternative aiming; drag to aim if the browser cannot capture the pointer

The title screen requests pointer capture only after deployment. Audio and scenery are generated locally, so the game has no runtime asset or backend dependency.

The top compass scrolls with your heading. Red diamonds mark ground enemies, chevrons mark aircraft, and edge arrows point toward enemies behind you. Bright pulsing pins identify enemies able to engage. The lower-left radar rotates with your view: forward is always up, and enemy dots and the north marker rotate around your fixed player arrow. Health, ammunition, reload progress, mission score, and weapon selection are displayed around the edge of the battlefield.

Enemies must be within their type's firing range and have an unobstructed view of the bunker: infantry 65 m, jeeps 90 m, trucks 75 m, APCs 125 m, tanks 170 m, helicopters 140 m, and aircraft 145 m. Air-target range includes altitude. Heavy attacks have a preparation cue. Enemy and player projectiles have separate ownership and collision handling.

## Development and verification

`npm test` runs regression checks for compass bearings, north wraparound, firing distances, occlusion gating, and swept projectile collision. The test command uses Node's TypeScript support and requires Node 22.18+ or Node 24+.

The presentation is split into the battlefield, first-person weapon view, enemy models, and HUD modules. The main loop owns combat state and sends snapshots to the HUD. Content definitions are shared by gameplay and tests.
