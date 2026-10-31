# Handoff

Where the port stands, how to run it, and what comes next. `PORTING.md` holds the system map and the gap list.

## State

Phases 1 and 2 are done; phase 3 (the full alley) is mostly in.

**Phase 2: one playable lane, single player.** Everything below is GPU# in `Code/`:
- `Lane.gs`: the director. Rounds, watch and settle, judging, booking, scoring, `ClassifyCall`, racking.
- `LaneHud.gs`: the screen HUD.
- `Ball.gs`: drive, the aim meter and launch, the hook in `OnPhysicsStep`, crane Return flights, the camera, the glass shell and the coloured shadow (one screen pass), the aim arrow.
- `Pin.gs`: phases, sweep, rack glide, and placement through the body-to-GameObject offset.
- `Rider.gs`: Terry in the ball.
- `LaneSurface.gs`: boards, lines and arrows.
- `Panel.gs`: the HUD kit, with SDF text and display-space blending.

**Phase 3** adds:
- 4 lanes, settees and the concourse with ramps and podiums.
- `Bowler.gs`: 16 walking Terrys on the analytic floor `Walk.FloorAt`, a third-person camera, the LANE-podium lobby menu (E; W/S, Space) and Q for a quick game.
- The crane leg sequencer in `Ball.gs` (Pickup / Return / Drop-off, with crane-off teleports).
- `LaneDisplays.gs`: the backstop readout, the call over the lane, the settee console, the top-down feed board and podium signs. They are drawn first in the lane's one screen pass, with the HUD over them.

Screen pass order: Ball (glass, `RenderOrder( -10 )`), then Lane (displays + HUD), then Bowler (menu, `RenderOrder( 10 )`).

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
4. Since engine 1bddafd74, `Rigidbody.SetTransform` / `SetKinematicTarget` take the GameObject's transform for every body shape (`Pin.Place` passes it straight through).
5. The scene's box `size` is in internal axis order: s&box (x, y, z) extents are written as (y, z, x).
6. Several commands for one body in one tick resolve deterministically: the last one wins.
7. Physics is not bit-deterministic between runs, so a scripted throw can give 10 or 9 pins.
8. Git Bash rewrites a lone `/` argument into a path. `throw.mjs` separates throws with `,`.
9. Pin sounds and the pocket come from `OnCollisionStart` (`Pin`, `Ball.Hits`). Each lane's settee feed board samples its own `Camera.View( Index )` as a `"view:k"` texture (`project.json` `sgpu.views`); the HUD, displays and menu skip themselves while `Render.InView`.
10. The web export (`native/tools/web/export.mjs --game .`) must write OUTSIDE the project folder, or it copies its own output into itself until the disk is full.

## Next (phase 3 onward)

- Concourse podium signs and pages (BALL designer, HELP, TELE, SETTINGS).
- Practice mode and drills.
- Multiplayer tests (`--host` / `--join`, several bowlers on one lane, leavers).
- Polish, and the web export.

A scripted walk to lane 3's podium, JOIN and START: `node tools/throw.mjs 0.85 0.5 0.85 0.05 --walk3`.
