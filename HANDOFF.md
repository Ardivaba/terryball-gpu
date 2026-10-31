# Handoff

Where the port stands, how to run it, and what comes next. `PORTING.md` holds the system map and the gap list.

## State

Phases 1 and 2 are done.

**Phase 2: one playable lane, single player.** Everything below is GPU# in `Code/`:
- `Lane.gs`: the director. Rounds, watch and settle, judging, booking, scoring, `ClassifyCall`, racking.
- `LaneHud.gs`: the screen HUD.
- `Ball.gs`: drive, the aim meter and launch, the hook in `OnPhysicsStep`, crane Return flights, the camera, the glass shell and the coloured shadow (one screen pass), the aim arrow.
- `Pin.gs`: phases, sweep, rack glide, and placement through the body-to-GameObject offset.
- `Rider.gs`: Terry in the ball.
- `LaneSurface.gs`: boards, lines and arrows.
- `Panel.gs`: the HUD kit, with SDF text and display-space blending.

**Generated files:**
- `Code/Alley.gs` (landmarks): `tools/make-scene.mjs` writes it, along with `scene.json` and `models/*.obj`.
- `Code/Labels.gs`: `tools/make-labels.mjs`.
- `Code/FontData.gs` and `textures/font.png`: `tools/font-raster.ps1` + `tools/make-font.mjs`.

## Commands

```bash
node tools/make-scene.mjs 1          # lanes to build (1..4)
node tools/make-labels.mjs
# a scripted aimed throw (carets: line aim power spin), several separated by ","; prints rolls/down/track
node tools/throw.mjs 0.85 0.5 0.85 0.05 --size 320x180
node tools/throw.mjs 0.85 0.5 0.85 0.05 --size 1280x720 --shots out/take 30   # frames for a video
../sbox-public/game/bin/win64/sgpu-player.exe . --tools ../sbox-public/native/.toolchain   # play
```

To compile only: `../sbox-public/game/bin/gsharp/gsc.exe Code --out out/gs --shown-prefix Code/ --project .`

## Engine facts learned

1. A field holds at most 64 scalars, so rolls are packed 4 bits each.
2. Another entity's array field is not readable; read it through a method (`Ball.SetOf( i )`).
3. `PhysicsStep.Velocity` cannot be assigned. Write to this body through its `PhysicsStep.Body( i )` handle.
4. For a compound or hull body, `Rigidbody.SetTransform` places the centre of mass and the principal frame. `Pin.Place` carries the offset.
5. The scene's box `size` is in internal axis order: s&box (x, y, z) extents are written as (y, z, x).
6. Two collision-filter commands for one body in the same tick race. Issue one per tick.
7. Physics is not bit-deterministic between runs, so a scripted throw can give 10 or 9 pins.
8. Git Bash rewrites a lone `/` argument into a path. `throw.mjs` separates throws with `,`.

## Next (phase 3 onward)

- 4 lanes.
- The concourse, ramps and podiums.
- 16 Bowler avatars (a walking Terry on an analytic floor height).
- The LANE podium's keyboard lobby: JOIN, START, STOP, RESET, throw mode, crane, mode.
- Crane Pickup and Dropoff.
- World displays as traced quads: the pin readout over the backstop, the callout over the lane, the settee console.
- The HUD follows the player's lane.
- Then: multiplayer tests (`--host` / `--join`), audio, practice drills, polish, the web export.
