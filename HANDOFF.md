# Handoff

Where the port stands, how to run it, and what comes next. `PORTING.md` holds the system map and the gap list.

## State

Phases 1-3 are done. Phases 4-6 are partly done: multiplayer is tested host + client, audio is in, the editor scene opens, and a local web build runs. Still to do is listed under Next.

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

## Done since phase 3

- **Engine 1bddafd74:**
  - pin sounds and the pocket come from `OnCollisionStart`
  - each lane's settee feed board shows its `Camera.View( Index )`, live
  - `SetTransform` takes the GameObject transform
- **Audio:** the `OnAudio` roll, the throw one-shot, pin clacks and thuds, the announcer (`tools/make-sounds.mjs` writes the sound list).
- **Multiplayer:** host + client on localhost (`tools/net-test.mjs --port 27152`; use a private port, 27052 is shared with other agents' runs).
  - Leavers: joins clear, the director passes on, a missing player's turn ends after a 10 s grace.
  - On a host, `Players.Input( s ).Connected` has been seen reading false for over 3 s while the client was connected. Reported to the engine side.
- **Editor:** `terryball.sbproj` + `Assets/scenes/terryball.scene`, written by `tools/editor-scene.mjs` from make-scene. `scene.extra.json` holds other features' entities: the Pin Singularity demo, key 3, not ours.
- **Web:** `node ../sbox-public/native/tools/web/export.mjs --game <copy> --out <dir OUTSIDE the project> --compile`. It was last exported from a private snapshot (`../tb-snap`, `../tb-web`) and runs in the browser at about 70 fps (`native/tools/web/run.mjs`). Never deploy without the user.

## Known issues

- `project.json` uses `"solver": "jacobi"` for the Singularity demo. With it, the pocket-strike line carries 9 pins, against 10/10 with the graph solver. An engine fix to the graph solver's scaling is in progress; when it lands, remove the solver key and re-run `node tools/throw.mjs 0.85 0.5 0.85 0.05` (expect 10).
- Editor Play gives pins one convex hull, and fog and exposure use the exporter's defaults.

## Paused (2026-10-31)

Work on Terryball is paused while the focus moves to the engine. Nothing has been added since commit a644534 / 5d14b00.
- **Last check:** `node tools/throw.mjs 0.85 0.5 0.85 0.05 --size 320x180` loads and plays: `ok:true`, 0 validation errors, 1236 frames, gpu 4.6 ms. The throw got 9 pins (the known jacobi result).
- **Uncommitted files in the working tree belong to the Singularity agent** and must not be committed with port work: `Code/Graviton.gs`, `Code/Singularity.gs`, `scene.extra.json`, `scene.json`, `tools/make-singularity.mjs`.
- **Waiting on the engine:**
  - the graph-solver scaling fix: then switch `solver` back to `"graph"`; the throw above should give 10.
  - the `Players.Input( k ).Connected` flicker fix: then the 10 s leave grace can come down.
- **Multiplayer tests:** use your own port (e.g. 27182). 27052, 27152 and 27172 are used by other agents.

### Design notes for the next step (researched, not yet written)

**Practice mode** (source: `GameDirector.cs` `PracticeAdvanceTurn` / `JoinQueueRpc` / `RackForDrill`, lines ~1100-1210 and 1708-1790).

`Lane.gs` additions:
- State: `[State] bool Practice; [State] int Drill` (0 Regular, 1 Strike, 2 Spare, 3 Split) and `[State] int LeaveCount` (pins standing when the turn starts).
- `Roster` grows to `Size( 16 )` to serve as the queue. In practice `Current` is always 0, so `Rolls` and `SplitBits` only use player 0.
- Messages:
  - `ToggleMode( slot )`: lobby only.
  - `NextDrill( slot )`: `MayDirect`.
  - `JoinQueue( slot )`: practice and Playing only. It sets the join bit and appends to the queue. If the lane was idle, it racks the drill and calls `BeginTurn`.
  - `Leave`: also allowed during practice when the slot isn't up; it dequeues.
- START in practice: `Playing` with an empty queue, idle (`Round = RoundOver`). Release a bowler still in the ball.
- `Decide`:
  - Strike, Spare and Split drills: `NextEndTurn` after one ball.
  - Regular drill: the frame 1-9 rule.
- `Proceed` end of turn in practice:
  - Drop the front of the queue, and cull anyone whose `JoinedBits` bit is gone.
  - Rack: the next bowler's drill if the queue isn't empty, else a full rack.
  - Drop off at `Seat( slot % 6 )`, set `PendingTurn`, then the `NextTurn()` helper. It ends `GameOver`, goes idle on an empty practice queue, or else calls `BeginTurn`.
- Before practice's `BeginTurn`, clear player 0's rolls and set `StartDown = Count( Swept )`.
- `RackLeave( bits )`: pins outside the leave get `Sweep()`, which also sets `Swept`. The pins in the leave get `RackTo( false, stagger, release )`.
- Leaves: pick one with `Lane.Random()`:
  - Spares: {10},{7},{2,4,5,8},{3,6,9,10},{1,2,4},{1,3,6},{5,6},{2,3,5}
  - Splits: {7,10},{4,6},{4,7,10},{5,7},{3,10},{2,7},{4,6,7,10},{6,7}
  - Check them with `Lane.IsSplit` in a quick test.
- `Leavers()`: practice must not `Halt` on an empty queue. Instead it passes the director to a present joined slot, or else to 0.
- Classifier: in the source, a drill's first ball counts as a fresh rack, so picking up the 10 pin is announced "1". Planned deliberate change: in practice, `Fresh( b = 0 )` is fresh only when `LeaveCount == 10`, with `before = LeaveCount`. A converted spare is then SPARE, and a converted split drill is NICE. Write this down in PORTING.md as a deviation.
- HUD and console in practice: the PRACTICE MODE banner, DRILL name, THROW QUEUE (front = UP, gold), or "No one in line".
- Labels to add in `tools/make-labels.mjs` (32 characters at most each): MODE, PLAY, PRACTICE, DRILL, REGULAR, STRIKE, SPARE, SPLIT, GET IN LINE, LEAVE LINE, IN LINE, THROW QUEUE, No one in line.

Lobby rows (`Bowler.Rows` = 7):
0. JOIN/LEAVE, or in a running practice lane GET IN LINE / LEAVE LINE / IN LINE (when up)
1. THROW
2. BALL CRANE
3. MODE (PLAY/PRACTICE, lobby only)
4. DRILL (practice only)
5. START/STOP
6. RESET

`tools/throw.mjs --walk3` presses S three times to reach START. With the new rows it needs five presses.

**Podium pages:**
- Geometry is already in `make-scene.mjs` `PODIUMS`. Concourse (z = `ConcourseZ`, range 160): BALL (28274,-150), HELP (28274,150), TELE (27824,0), SETTINGS (27824,390), MORE (27824,-390).
- Per-lane podiums: LANE / BALL / HELP at `PodiumX`, lane y -142.4 / 0 / +142.4 (range 128).
- Concourse signs are billboards in the source. Draw them in `Lane.Displays` for `Index == 0` only, before its distance cull, facing the camera horizontally.
- `Bowler`:
  - `NearStation()` returns kind*16 + lane.
  - Add `[State, Predicted] int Page` (BALL, HELP, TELE, SETTINGS, MORE). The walker is frozen while a page or the lobby is open.
  - Prompt texts: "E BALL DESIGNER" and so on.
- **BALL:**
  - State: `[State] int Pattern; float HueA = 0, HueB = 220` on `Bowler`, which replicates to everyone.
  - Rows: PATTERN (A/D cycles), PRIMARY / ACCENT hue (holding A/D moves 120°/s), CLOSE.
  - Preview: a ray-traced spinning sphere on the right half of the page.
  - Move `Ball.Design` into a shared static `BallLook.Design( dir, pattern, hueA, hueB )`. The patterns are in the source's `BallDesign.cs` `Sample`: HalfHalf band 0.035; Polkadot 9x5 cells with every other row offset, r 0.30; Cubes 8x4 with grout 0.06; Galaxy fbm, 4 octaves, base 8 cells periodic in u, `pow( n, 1.6 )`, plus stars. Use the `Random.Hash` value noise, not the source's sin hash.
  - In `Ball.OnUpdate`, before the local-only return, gather the design of `CarriedSlot`, else `CraneSlot`, else the lane's `BowlerSlot`, into `[Local]` fields.
- **HELP:** condensed lines from `HowToPlay.razor` (lane lobby, AIM steps and the sweet spot, FREE ride and T, BALL / TELE / SETTINGS).
- **TELE:** LANE 1-4. Set `Feet` = (`SetteeCentreX`, `LaneY[i]`, `SetteeFloor`), `prevFeet = Feet`, `Yaw = 180`.
- **SETTINGS:** `[Local]` theme (AUTO = amber #f1c40f, LANE #5aa0e6, BALL #b07de6, PIN #2f9450, CRIMSON #e05a5a, CYAN #5ac8dc) and sky brightness (0.2-1.5).
  - Sky brightness: multiply `px.Color` in `Ball.Glass` for `ComponentIndex == 0`, and multiply `behind` too. That pass runs before the HUD.
  - The theme tints the readout, the console, the menu outline and the MORE sign; `Lane.OnUpdate` gathers it from the local `Bowler`.
- **MORE:** the source's links are dropped (no URL API), so make it a controls list instead.
- The source also has G (bail out of the ball) and R (respawn on the settee). Neither is ported yet.

## Next

- **Practice mode and drills** (`docs/game.md` "Practice mode"):
  - Mode PLAY/PRACTICE and Drill rows in the lobby menu (`Bowler.MenuPanel`, `Bowler.Rows`).
  - The queue as the roster.
  - `RackLeave` from the source's `PracticeLeaves` lists: spares {10},{7},{2,4,5,8},{3,6,9,10},{1,2,4},{1,3,6},{5,6},{2,3,5}; splits {7,10},{4,6},{4,7,10},{5,7},{3,10},{2,7},{4,6,7,10},{6,7}.
- **Concourse podiums** (BALL, HELP, TELE, SETTINGS, MORE): signs like the lane podium signs, plus pages drawn by `Bowler`:
  - BALL: the ball designer. Patterns HalfHalf / Polkadot / Cubes / Galaxy, two hues, `[State]` per player; `Ball.Design` draws the shell.
  - HELP: how to play.
  - TELE: teleport to Lane n.
  - SETTINGS: sky brightness and theme.
- **Music:** a reduced skafinity in `OnAudio` (optional).
- **Tests:** a 16-player test, and two bowlers sharing a lane (turn rotation, drop-off between turns).
