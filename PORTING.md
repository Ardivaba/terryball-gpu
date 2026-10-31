# Porting Terryball to S&GPU

Terryball is an s&box game: about 15k lines of C# game code, Razor UI, and a vendored music library. This port runs it as GPU# components on the S&GPU Vulkan runtime. There is no CPU game code. Gameplay, physics hooks, rendering, UI and audio are GPU threads.

The source's `docs/` are the spec. This file maps each source system to its S&GPU form and lists every gap.

## Units and space

The port keeps the source's units: s&box inches, X down-lane, Z up.
- The ball's radius is 100 units, so the lane is built at `u = 200 / 8.5 = 23.53` units per real inch. A 60 ft lane is 16 941 units.
- Terry and the settee are person scale (1 unit per inch).
- The S&GPU scene file is in metres with +Y up. `tools/make-scene.mjs` converts, the same way the Cube does.
- GPU# code sees s&box space.

**Gravity.** The source gives the pins a real 1 g at lane scale: 386 in/s² × u = 9085 u/s². The ball keeps s&box's default 800 u/s².
- S&GPU's world gravity is set to 9085 u/s² (230.8 m/s²).
- The ball's body carries `gravity_scale` 800 / 9085.

## System map

| Source (s&box C#) | S&GPU port | Status |
|---|---|---|
| `LaneBuilder`, `FloorBuilder`, `SpawnAreaBuilder`: boxes built at runtime | `tools/make-scene.mjs` writes the same boxes offline. Each material's boxes are merged into one OBJ with world-scaled UVs (the source's `Tiled` repeat). Static box bodies give collision. The pin lathe uses the source's silhouette table and monotone cubic, 48 segments. | port |
| Generated surface textures (`gen_textures.py`, CC0) | The source's own `*_color.png` are copied. S&GPU materials take one colour texture (512² layers). There are no normal or roughness maps, so a constant roughness per material stands in for them. | port, reduced |
| Pin physics: 13 convex hull slabs, mass 1.23, friction 0.15, elasticity 0.5, 1 g | A compound of convex hulls (`"shape": "compound"`, hull children of at most 32 points) with the same mass, friction, restitution and gravity | port |
| Lane collision tags (one rack per ball) | Each lane gets a physics category and mask, so a ball only meets its own pins | port |
| `BallController`: drive, brake, pit damping, oil and hook at the contact point | `Ball.gs`. Drive and brake are forces in `OnPhysicsStep` (`PhysicsStep.AddForce`). The hook's Coulomb force at the contact point becomes a force plus the matching change in angular velocity (`r × F / I`), because the step API has no `AddForceAt` for the body itself. | port |
| `EnhancedCcd` on the ball | S&GPU's CCD covers static geometry only. Ball against pins relies on the speculative margin and swept bounds. The game runs 8 physics substeps. | port, watch tunnelling |
| Glass ball shell (`glass.shader`, translucent) and the coloured ball shadow (`BallShadowTintPP` + the 4-ball shader) | A screen pass after lighting does both. It ray-traces the ball sphere, so it is see-through to Terry and the lane: refraction offset, Fresnel and specular, and the design's equirectangular pattern. It also casts the analytic coloured sun shadow on whatever pixel lies under the ball. This is the source's own shadow method (it never used the shadow map for the ball) and needs no capture camera. | port, different technique |
| `OccupantSilhouetteCapture` (Terry's silhouette in the coloured shadow) | Terry is a real mesh, so he casts a real sun shadow. The render-to-texture silhouette pass is dropped. | dropped, covered |
| Terry inside the ball (Citizen, scale 1.5, walk→run by speed, then the `Roll` special move) | The Cube's `citizen.glb` (GPU-skinned clips: idle, walk/run eight-way, jump, fall) is placed at the ball centre every frame. The citizen export has no `Roll` clip, so above `RollAtMph` Terry tumbles with the ball in a tucked fall pose. | port, gap: no Roll clip |
| `ThrowAimer` + `ThrowAimHud` (LINE / AIM / POWER / SPIN) | `Ball.gs` state plus a screen-pass meter. The aim arrow is drawn analytically in the same pass (a projected ribbon on the approach), not as a procedural mesh. | port |
| `BallCamera` (free, aim, watch, hand-off) | `Camera.Set` from the bowler's ball in `OnUpdate` | port |
| Crane (fly over, sink, scoop, fly to the run-up, roll; return; drop-off) | A kinematic leg sequencer in the lane's director, same constants. The ball body is parked or teleported with `SetTransform` and zero velocity, because S&GPU cannot switch a body's type at run time. | done |
| `GameDirector`: phases, rounds, watch and settle, `BookBall`, frame rules, `ScoreThrough`, marks, splits, `ClassifyCall`, practice drills and leaves | `Lane.gs`: one director instance per lane, a fixed-size state machine. Rolls are stored as `int` arrays: 16 players × 21 balls, with split bits. | port |
| `Pin` phases (Up / Down fade / Racking glide, staggered release) | `Pin.gs`. Sweep fades out (a pixel dissolve), then the body is parked. Racking glides with `SetTransform` every tick under a "no collision" filter, then releases together with the batch. | port |
| Networking: host, lane director owner, bowler owns ball and pins; `[Rpc.Owner]` `BookBall`/`EndTurn`; `TurnSerial` | S&GPU is host-authoritative. Every machine runs the same GPU gameplay, the host's physics and `[State]` replicate, and the bowler's input drives the ball through `Players.Input( slot )`. Ownership transfer is unnecessary: the "director owner" becomes the host, and lane claiming is replicated state (`DirectorSlot`). Client requests go through `[Rpc( To = Rpc.Host )]`. | done, tested host + client on localhost (`tools/net-test.mjs`); leavers handled with a 3 s grace |
| 16 players, `AlleyServer` spawning avatars | 16 player slots (`"players": 16`), each with a pre-placed avatar entity (Terry plus a `Bowler` component) parked until its slot connects | done |
| `TerryAvatar` walking (`PlayerController`), stations, E to use | `Bowler.gs`: a kinematic capsule walker like the Cube's prisoner (raycast floor, settee and concourse ramps), third-person camera, nearest-station prompt | done |
| Screen HUD (Razor): `ScoreBoard`, `PinStatusOverlay`, `BowlerHud`, `HudHints` | `[Draw( After = Stage.Lighting )]` screen passes. Text uses an SDF font atlas (`textures/font.png`, Poppins Bold, OFL, generated by `tools/make-font.mjs`). Panels are rounded rectangles with the source's colours. | port |
| World panels (`WorldPanel`): `PinReadout`, `AnnouncerCallout`, `LaneConsole`, station signs | Traced quads (`OnRenderPixel`) drawing the same layouts with the same font | done (screen-pass panels, depth tested) |
| `MonitorFeed` / `LaneMonitorCamera` (render-to-texture second camera) | No second camera exists in GPU#. The feed screen becomes a traced "replay" board: the ball and pins drawn top-down from the lane's state. | done: each lane's `Camera.View( Index )` feed camera, live on the settee board (`"view:k"` texture) |
| `AimFeedBanner` (spectator aim meter) | Drawn from the bowler's replicated aim fields | port (phase 4) |
| `LaneControls` modal (JOIN, START, STOP, RESET, picks) with a mouse cursor | GPU-drawn modal driven by keys (arrows or number keys plus Enter). No free cursor: S&GPU has `Input.Mouse`, but a pointer-locked game gets no cursor UI. | done, keyboard UI (E at the LANE podium; Q quick game) |
| `BallDesigner` + `BallPreviewPanel` (its own SceneWorld) + `balldesign.json` | Same patterns (HalfHalf, Polkadot, Cubes, Galaxy) computed per pixel in the glass pass. There is no file system, so designs are `[State]` per player and last for the session. | port (phase 6), gap: no persistence |
| `WorldPrefs` / `WorldTheme` cookies (theme colour, sky brightness, voice range) | Per-machine `[Local]` fields, lost on exit | port (phase 6), gap: no persistence |
| `HowToPlay`, `TeleportPanel`, `WorldSettings`, `MorePanel` | GPU-drawn pages (phase 6). `MorePanel`'s outbound links are dropped (below). | later |
| `BallAudio`: throw one-shot + synthesised roll | `Sound.Play2D( "sounds/ball/throw0.wav" )` for the one-shot (positional through raw `sgSound` if needed). The roll is `OnAudio` synthesis on the ball, the same filtered noise with a per-revolution pulse, panned with `Audio.At`. | done |
| `PinImpactAudio` (clack and thud banks, gating, coalescing) and `NetPinImpact` | Contacts are not exposed to GPU#, so impacts are inferred in `Pin.gs` from velocity changes (Δv over a tick) against the ball, a pin or structure. They are gated and coalesced in the director, then played with `sgSound`. Every machine runs it on replicated physics, so no broadcast is needed. | done: `OnCollisionStart` contacts (impact speed; ball, pin or structure) |
| `AlleyReverb` (a DSP reverb on the pins mixer) | S&GPU has no mixer or DSP chain. A short synthesised tail in `OnAudio`, or reverb pre-baked into the pin samples. | gap |
| Announcer (25 calls × 2 takes, `fx/` wavs) | Sound assets (`sgpu.events.sounds`), played with `Sound.Play2D` by index from the director's call id | done |
| skafinity procedural music (7k lines of CPU C#, `SoundStream`) | Not portable as-is: it is a CPU sequencer. Optional later phase: a reduced GPU# `OnAudio` port (pattern tables plus synth voices). | gap, optional |
| Proximity voice (`TerryVoice`, `VoicePanel`, `VoicePrefs`) | S&GPU has no voice transport | dropped |
| Chat (engine overlay) | No chat in S&GPU | dropped |
| `DiscordButton`, `GamesButton`, `SkafinityButton` (copy URL to the clipboard) | No URL or clipboard API, and platform-specific | dropped |
| Steam names (`DisplayName`) | Players are "P1".."P16" (the player's `--name` is not exposed to GPU#) | gap |
| `SkyBrightnessApplier` | Scales the sun and sky colour through a screen-pass exposure, or `Scene.SetLight` | port (phase 6) |
| s&box editor scene (`main.scene`) | `make-scene.mjs` can also write an `.sbproj` + `.scene` later, so the S&GPU editor opens it | done: `terryball.sbproj` + `Assets/scenes/terryball.scene` (`tools/editor-scene.mjs`); pins get one convex hull in editor Play |

## Engine gaps found (none block the port so far)

1. **No `Roll` animation clip** in the exported citizen. Workaround: a tucked fall pose plus rotating Terry with the ball. A real fix needs the citizen exported with `roll` (an asset task, not an engine change).
2. ~~No render-to-texture camera~~: solved by the engine's `Camera.View` (engine 1bddafd74).
3. ~~No contact events in GPU#~~: solved by `OnCollisionStart` (engine 1bddafd74).
4. **No audio mixer or DSP** (reverb, music bus). Workaround: synthesised tails, or reverb baked into the samples.
5. **No persistence** (ball designs, settings).
6. **No player names or Steam identity** in GPU#.
7. **Body type cannot change at run time** (kinematic while racking or held by the crane). Workaround: teleport each tick with `SetTransform`, zero velocity and a collision filter.

## Phases

1. Inventory: this file.
2. Playable core, single player:
   - one lane at the source's dimensions
   - the ball with Terry
   - Aim and Free throws
   - real pin physics, pin judging and respotting
   - frame scoring for one player
   - the camera, and the scoreboard and pin HUD
3. The full alley:
   - 4 lanes, the floor, settees, the concourse and ramps, podiums
   - the walking Terry
   - lane displays and HUD
   - the crane
4. Multiplayer: 16 slots, lane claiming, rosters and turns; host plus client, tested headless on localhost.
5. Audio: ball, pins, announcer; then music (a GPU skafinity subset, if feasible).
6. Polish:
   - ball designer, settings, help
   - the look
   - the web build (local only)

## Assets carried over

- `LICENSE`: GamahCode, unchanged.
- The `textures/*.png` surface maps: the source's generated CC0 textures.
- `sounds/`: the source's CC0 pin, ball and announcer clips, with their provenance file.
- `models/citizen.glb`: the s&box citizen as S&GPU's Cube example exports it.
- `textures/font.png`: Poppins Bold (SIL OFL 1.1), rendered by `tools/make-font.mjs`.
