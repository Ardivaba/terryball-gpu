// Builds Terryball's alley offline, at the source's dimensions (LaneBuilder / FloorBuilder / SpawnAreaBuilder):
//   scene.json              the runtime scene (sgpu-player; internal space: metres, +Y up)
//   models/*.obj            the alley's surfaces, one mesh per material, with world-scaled UVs; the pin lathe
// Everything below is in s&box space (inches, X down-lane, Y left, Z up), lane-local with the floor top at z = 0 and
// the foul line as the x datum; toInt() converts to the scene's space.
//   node tools/make-scene.mjs [lanes]          (lanes: how many of the four lanes to build, default 1)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANE_COUNT = Math.max(1, Math.min(4, +(process.argv[2] || 4)));
const INCH = 0.0254;
const r6 = (x) => +x.toFixed(6);
const toInt = (p) => [-p[1], p[2], -p[0]].map((x) => r6(x * INCH));
const dirInt = (p) => [-p[1], p[2], -p[0]].map(r6);
const quatInt = (q) => [-q[1], q[2], -q[0], q[3]].map(r6);          // s&box quaternion -> internal
const pitchQuat = (deg) => { const h = (deg * Math.PI / 180) / 2; return [0, Math.sin(h), 0, Math.cos(h)]; };   // about +Y (s&box pitch, + = nose down)

// ---------------------------------------------------------------- the source's numbers (LaneBuilder, scene overrides)
export const R = 100;                        // ball radius (units); the ball is 8.5 in
const U = 2 * R / 8.5;                        // units per real inch on the lane
const H = 10 * U;                             // platform top
const LANE_HALF = 41.5 * U / 2, GUTTER_W = 9.25 * U, BARRIER_W = 6 * U, BUFFER_W = 3 * U;
const GUTTER_D = 5 * U, BARRIER_TOP = H + 3 * U;
const GUTTER_OUT = LANE_HALF + GUTTER_W, BARRIER_OUT = GUTTER_OUT + BARRIER_W, PLATFORM_HALF = BARRIER_OUT + BUFFER_W;
const RAMP_X0 = 150, RAMP_DEG = 8, RAMP_RUN = H / Math.tan(RAMP_DEG * Math.PI / 180);
const APPROACH_X = RAMP_X0 + RAMP_RUN, FOUL_X = APPROACH_X + 180 * U, HEAD_X = FOUL_X + 720 * U;
const ROW = 12 * U * Math.cos(Math.PI / 6), BACK_ROW_X = HEAD_X + 3 * ROW;
const DECK_END_X = BACK_ROW_X + 6 * U, PIT_END_X = DECK_END_X + 36 * U;
const PIT_BOTTOM = -276.47, BACKBOARD_X = PIT_END_X + 343.75, SETTEE_Z = H + 18 * U;
const THROW_X = HEAD_X - 60 * U;
const RUNUP = [APPROACH_X + (FOUL_X - APPROACH_X) * 0.25, 0, H];
export const LANE_Y = [-4500, -1500, 1500, 4500];
const PIN_H = 15 * U;
// the 10 spots: row r = 0..3 down-lane, i = 0..r across (pin 2 on -y)
const SPOTS = [];
for (let r = 0; r < 4; r++) for (let i = 0; i <= r; i++) SPOTS.push([HEAD_X + r * ROW, (i - r / 2) * 12 * U, H]);

// ---------------------------------------------------------------- OBJ builder (internal space), one per material
const objs = {};
const obj = (name) => (objs[name] ??= { V: [], VT: [], VN: [], F: [] });
const quatRot = (q, v) => {   // rotate v by quaternion q (x, y, z, w)
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
};
// a box (s&box centre, full size, optional rotation) with planar world UVs: each face maps its two in-plane axes
// (the longer one to u) at `tile` units per texture repeat
function box(name, c, size, tile, rot = [0, 0, 0, 1], faces = 'xXyYzZ') {
  const o = obj(name);
  const hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let a = 0; a < 3; a++) for (const s of [-1, 1]) {
    if (!faces.includes('xyz'[a] [s > 0 ? 'toUpperCase' : 'toLowerCase']())) continue;
    const b = (a + 1) % 3, d = (a + 2) % 3;
    const h = [hx, hy, hz];
    const corner = (u, v) => { const p = [0, 0, 0]; p[a] = s * h[a]; p[b] = u * h[b]; p[d] = v * h[d]; return p; };
    let quad = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    if (s < 0) quad = quad.reverse();
    const n = quatRot(rot, axes[a].map((x) => x * s));
    const base = o.V.length;
    const bLong = size[b] >= size[d];
    for (const p of quad) {
      const w = quatRot(rot, p).map((x, i) => x + c[i]);
      o.V.push(toInt(w));
      const pu = bLong ? p[b] + c[b] : p[d] + c[d], pv = bLong ? p[d] + c[d] : p[b] + c[b];
      o.VT.push([r6(pu / tile), r6(1 - pv / tile)]);
      o.VN.push(dirInt(n));
    }
    o.F.push([base + 1, base + 2, base + 3, base + 4]);
  }
}
function writeObj(name, o) {
  const lines = [`# Terryball (tools/make-scene.mjs): ${name}`];
  for (const v of o.V) lines.push(`v ${v.join(' ')}`);
  for (const t of o.VT) lines.push(`vt ${t.join(' ')}`);
  for (const n of o.VN) lines.push(`vn ${n.join(' ')}`);
  for (const f of o.F) lines.push('f ' + f.map((i) => `${i}/${i}/${i}`).join(' '));
  fs.writeFileSync(path.join(root, 'models', `${name}.obj`), lines.join('\n') + '\n');
}

// ---------------------------------------------------------------- static colliders
const colliders = [];
const solid = (c, size, opts = {}) => colliders.push({ c, size, rot: opts.rot || [0, 0, 0, 1], friction: opts.friction ?? 0.6, restitution: opts.restitution ?? 0.42 });

// ---------------------------------------------------------------- one lane (lane-local + y offset)
function lane(ly) {
  const B = (name, x0, x1, y0, y1, z0, z1, tile, opts) => {
    const c = [(x0 + x1) / 2, ly + (y0 + y1) / 2, (z0 + z1) / 2], s = [x1 - x0, y1 - y0, z1 - z0];
    if (name) box(name, c, s, tile);
    if (!opts || opts.solid !== false) solid(c, s, opts);
  };
  // the ramp up from the floor to the approach: a 6 in slab pitched 8 degrees, its top from (150, 0) to the approach
  {
    const t = 6 * U, rad = RAMP_DEG * Math.PI / 180;
    const len = Math.hypot(RAMP_RUN, H);
    const mid = [RAMP_X0 + RAMP_RUN / 2, ly, H / 2];
    const c = [mid[0] + Math.sin(rad) * t / 2, mid[1], mid[2] - Math.cos(rad) * t / 2];
    const q = pitchQuat(-RAMP_DEG);
    box('approach', c, [len + 4, PLATFORM_HALF * 2, t], 720, q);
    solid(c, [len + 4, PLATFORM_HALF * 2, t], { rot: q });
  }
  B('lanebed', APPROACH_X, DECK_END_X, -LANE_HALF, LANE_HALF, 0, H, 900);
  for (const s of [-1, 1]) {
    const y = (a, b) => (s < 0 ? [-b, -a] : [a, b]);
    B('approach', APPROACH_X, FOUL_X, ...y(LANE_HALF, PLATFORM_HALF), 0, H, 720);
    B('gutter', FOUL_X, DECK_END_X, ...y(LANE_HALF, GUTTER_OUT), 0, H - GUTTER_D, 560);
    B('metal', FOUL_X, PIT_END_X, ...y(GUTTER_OUT, BARRIER_OUT), 0, BARRIER_TOP, 560);
    B('approach', FOUL_X, PIT_END_X, ...y(BARRIER_OUT, PLATFORM_HALF), 0, H, 720);
  }
  // the pit: dead and slick so the ball settles
  B('pit', DECK_END_X, PIT_END_X, -GUTTER_OUT, GUTTER_OUT, PIT_BOTTOM, 0.25 * U, 560, { friction: 0.2, restitution: 0.02 });
  // the backboard, whose top is the settee floor
  B('metal', PIT_END_X, BACKBOARD_X, -PLATFORM_HALF, PLATFORM_HALF, PIT_BOTTOM, SETTEE_Z, 560, { friction: 0.2, restitution: 0.02 });
  // settee carpet
  const sx = PIT_END_X + 343.75 / 2;
  B('carpet', PIT_END_X, BACKBOARD_X, -284.8, 284.8, SETTEE_Z, SETTEE_Z + 4, 200, { solid: false });
  const fz = SETTEE_Z + 4;   // the carpet top: the settee floor
  // two benches along the settee's sides (frame, cushion, back), facing the lane's middle
  for (const s of [-1, 1]) {
    const y = s * 271.6;
    B('metal', sx - 123.75, sx + 123.75, y - 11, y + 11, fz, fz + 15, 30, { solid: false });
    B(paint([0.55, 0.13, 0.16]), sx - 123.75, sx + 123.75, y - 11, y + 11, fz + 15, fz + 18, 30, { solid: false });
    B('metal', sx - 123.75, sx + 123.75, s * 281.6 - 1, s * 281.6 + 1, fz + 18, fz + 36, 30, { solid: false });
  }
  // the LANE / BALL / HELP podiums at the back of the settee
  [[-142.4, [0.05, 0.06, 0.08]], [0, [0.55, 0.13, 0.16]], [142.4, [0.18, 0.19, 0.22]]].forEach(([y, top]) => {
    B('metal', 25011.23 - 9, 25011.23 + 9, y - 22, y + 22, fz, fz + 40, 30, { solid: false });
    B(paint(top), 25011.23 - 10, 25011.23 + 10, y - 23, y + 23, fz + 40, fz + 42, 30, { solid: false });
  });
  // the two overhead screens' bezels and posts (the score console and the feed board), at the deck's lane edge
  for (const y of [-136.8, 136.8]) {
    B(paint([0.05, 0.06, 0.08]), 24727.23 - 1.25, 24727.23 + 1.25, y - 122, y + 122, 782.82 - 69.5, 782.82 + 69.5, 30, { solid: false });
    for (const py of [y - 117, y + 117]) B(paint([0.22, 0.23, 0.26]), 24725.98 - 1.5, 24725.98 + 1.5, py - 1.5, py + 1.5, SETTEE_Z, 713.32, 30, { solid: false });
  }
  // the backstop readout's bezel, high over the pit
  B(paint([0.05, 0.06, 0.08]), 24732.48 - 10, 24732.48 + 10, -887.4, 887.4, 2570.59 - 1195.77, 2570.59 + 1195.77, 30, { solid: false });
}
// untextured painted materials, one per colour
const paints = new Map();
function paint(c) { const k = 'paint_' + c.map((x) => Math.round(x * 100)).join('_'); paints.set(k, c); return k; }
for (let i = 0; i < LANE_COUNT; i++) lane(LANE_Y[i]);
// the concourse behind all settees (SpawnAreaBuilder): a carpeted floor, one ramp up to each settee, five podiums
const CONC_X0 = BACKBOARD_X + 2200, CONC_X1 = CONC_X0 + 2400, CONC_HALF = 4500 + 917.65 + 567.15;
box('concourse', [(CONC_X0 + CONC_X1) / 2, 0, 4], [CONC_X1 - CONC_X0, CONC_HALF * 2, 8], 160);
solid([(CONC_X0 + CONC_X1) / 2, 0, 4], [CONC_X1 - CONC_X0, CONC_HALF * 2, 8]);
const RAMP_DEG2 = Math.atan2(SETTEE_Z, CONC_X0 - BACKBOARD_X) * 180 / Math.PI;
for (let i = 0; i < LANE_COUNT; i++) {
  const len = Math.hypot(CONC_X0 - BACKBOARD_X, SETTEE_Z), rad = RAMP_DEG2 * Math.PI / 180, t = 60;
  const c = [(CONC_X0 + BACKBOARD_X) / 2 + Math.sin(rad) * t / 2, LANE_Y[i], SETTEE_Z / 2 - Math.cos(rad) * t / 2];
  box('ramp', c, [len + 2, 683.52, t], 200, pitchQuat(RAMP_DEG2));
  solid(c, [len + 2, 683.52, t], { rot: pitchQuat(RAMP_DEG2) });
}
export const PODIUMS = [['BALL', 28274.23, -150, [0.45, 0.32, 0.6]], ['HELP', 28274.23, 150, [0.3, 0.52, 0.4]], ['TELE', 27824.23, 0, [0.28, 0.55, 0.62]],
  ['SETTINGS', 27824.23, 390, [0.55, 0.45, 0.15]], ['MORE', 27824.23, -390, [0.55, 0.45, 0.15]]];
for (const [, x, y, top] of PODIUMS) {
  box(paint([0.16, 0.17, 0.22]), [x, y, 28], [18, 44, 40], 30);
  box(paint(top), [x, y, 49], [20, 46, 2], 30);
}
// the floor under everything (FloorBuilder: 102400 square, top at z = 0); only its top is drawn
box('floor', [12000, 0, -128], [102400, 102400, 256], 200, [0, 0, 0, 1], 'Z');
solid([12000, 0, -128], [102400, 102400, 256]);

// ---------------------------------------------------------------- the pin: the USBC silhouette (t, diameter fraction)
const PROFILE = [[0, 0.426], [0.05, 0.594], [0.15, 0.82], [0.225, 0.946], [0.3, 1], [0.392, 0.957], [0.575, 0.518], [0.625, 0.413],
  [0.667, 0.374], [0.725, 0.392], [0.783, 0.439], [0.9, 0.535], [0.955, 0.38], [1, 0.165]];
const PIN_R = 5 * U / 2;   // belly radius (PinWidthInches 5)
// Fritsch-Carlson monotone cubic through the profile
const pinRadius = (() => {
  const xs = PROFILE.map((p) => p[0]), ys = PROFILE.map((p) => p[1]), n = xs.length;
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (t) => {
    let i = 0; while (i < n - 2 && t > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], s = (t - xs[i]) / h;
    const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
    return (h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1]) * PIN_R;
  };
})();
{
  // render lathe: rings at t = i/72, every profile t and the stripe edges; 48 segments; flat caps. uv = (angle, t).
  const ts = new Set();
  for (let i = 0; i <= 72; i++) ts.add(+(i / 72).toFixed(5));
  for (const p of PROFILE) ts.add(p[0]);
  for (const t of [0.69, 0.73, 0.78, 0.82]) ts.add(t);
  const T = [...ts].sort((a, b) => a - b), SEG = 48;
  const o = obj('pin');
  const ring = [];
  for (const t of T) {
    const r = pinRadius(t), e = 0.002, dr = (pinRadius(Math.min(1, t + e)) - pinRadius(Math.max(0, t - e))) / (Math.min(1, t + e) - Math.max(0, t - e)) / PIN_H;
    const row = [];
    for (let k = 0; k <= SEG; k++) {
      const a = (k / SEG) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      o.V.push(toInt([r * ca, r * sa, t * PIN_H]));
      const n = [ca, sa, -dr], l = Math.hypot(...n);
      o.VN.push(dirInt(n.map((x) => x / l)));
      o.VT.push([r6(k / SEG), r6(1 - t)]);
      row.push(o.V.length);
    }
    ring.push(row);
  }
  for (let j = 0; j < T.length - 1; j++) for (let k = 0; k < SEG; k++)
    o.F.push([ring[j][k], ring[j][k + 1], ring[j + 1][k + 1], ring[j + 1][k]]);
  for (const [t, nz, row] of [[0, -1, ring[0]], [1, 1, ring[ring.length - 1]]]) {
    o.V.push(toInt([0, 0, t * PIN_H])); o.VN.push(dirInt([0, 0, nz])); o.VT.push([0.5, r6(1 - t)]);
    const cIdx = o.V.length;
    const capN = [];
    for (let k = 0; k <= SEG; k++) { o.V.push(o.V[row[k] - 1]); o.VN.push(dirInt([0, 0, nz])); o.VT.push(o.VT[row[k] - 1]); capN.push(o.V.length); }
    for (let k = 0; k < SEG; k++) o.F.push(nz < 0 ? [cIdx, capN[k + 1], capN[k]] : [cIdx, capN[k], capN[k + 1]]);
  }
}
// the pin's collision: one convex hull per silhouette slab, 16 points per ring (body space: metres, +Y up, base at 0)
const pinHulls = [];
for (let j = 0; j < PROFILE.length - 1; j++) {
  const pts = [];
  for (const [t, d] of [PROFILE[j], PROFILE[j + 1]]) for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, r = d * PIN_R;
    pts.push(toInt([r * Math.cos(a), r * Math.sin(a), t * PIN_H]));
  }
  pinHulls.push({ shape: 'hull', points: pts });
}

fs.mkdirSync(path.join(root, 'models'), { recursive: true });
for (const [name, o] of Object.entries(objs)) writeObj(name, o);

// ---------------------------------------------------------------- entities
const entities = [];
let nextId = 1;
const ent = (e) => { e.id = nextId++; entities.push(e); return e; };
const at = (p) => toInt(p);
// physics categories: 1 = the world; lane i's ball and pins are category 2 << i and meet only the world and each other
const laneCat = (i) => 2 << i;

// the alley's surfaces (one entity per material mesh); the lane beds draw their boards, lines and arrows (LaneSurface)
for (const name of Object.keys(objs).filter((n) => n !== 'pin')) {
  const e = ent({ name: `Alley ${name}`, position: [0, 0, 0], rotation: [0, 0, 0, 1], mesh: name, material: name, castShadows: name !== 'floor' });
  if (name === 'lanebed') e.components = [{ type: 'LaneSurface', enabled: true }];
}
colliders.forEach((s, i) => ent({ name: `Collider ${i}`, position: at(s.c), rotation: quatInt(s.rot),
  body: { type: 'static', shape: 'box', size: [s.size[1], s.size[2], s.size[0]].map((x) => r6(x * INCH)),   // s&box (x, y, z) extents -> internal (y, z, x)
    friction: s.friction, restitution: s.restitution } }));

for (let li = 0; li < LANE_COUNT; li++) {
  const ly = LANE_Y[li];
  const director = ent({ name: `Lane ${li + 1}`, position: at([0, ly, 0]), rotation: [0, 0, 0, 1] });
  const ball = ent({ name: `Lane ${li + 1} Ball`, position: at([RUNUP[0], ly + RUNUP[1], H + R]), rotation: [0, 0, 0, 1],
    body: { type: 'dynamic', shape: 'sphere', radius: r6(R * INCH), mass: 5.3, friction: 0.05, restitution: 0.3, gravity_scale: r6(800 / (386.09 * U)),
      category: laneCat(li), mask: 1 | laneCat(li) } });
  const pins = SPOTS.map((s, n) => ent({ name: `Lane ${li + 1} Pin ${n + 1}`, position: at([s[0], ly + s[1], s[2]]), rotation: [0, 0, 0, 1],
    mesh: 'pin', material: 'pin',
    body: { type: 'dynamic', shape: 'compound', children: pinHulls, mass: 1.23, friction: 0.15, restitution: 0.5, category: laneCat(li), mask: 1 | laneCat(li) } }));
  const rider = ent({ name: `Lane ${li + 1} Rider`, position: at([RUNUP[0], ly, H + R]), rotation: [0, 0, 0, 1], scale: [1.5, 1.5, 1.5],
    mesh: 'citizen', castShadows: true, animation: { clip: 'citizen/idle', speed: 1, loop: true, time: 0 } });
  director.components = [{ type: 'Lane', Index: li, Ball: ball.id, enabled: true }];
  ball.components = [{ type: 'Ball', Lane: director.id, Radius: R, enabled: true }];
  pins.forEach((p, n) => { p.components = [{ type: 'Pin', Number: n + 1, Lane: director.id, Home: [SPOTS[n][0], ly + SPOTS[n][1], SPOTS[n][2]], enabled: true }]; });
  rider.components = [{ type: 'Rider', Ball: ball.id, Lane: director.id, enabled: true }];
}

// sixteen bowlers, one per player slot (Code/Bowler.gs), spawned round the concourse spawn point facing the lanes;
// a slot nobody holds is parked out of sight
for (let slot = 0; slot < 16; slot++) {
  const a = slot * 2.4, r = 40 + 14 * slot;
  ent({ name: `Bowler ${slot + 1}`, position: at([28274.23 - 200 + Math.cos(a) * r, Math.sin(a) * r, 8]), rotation: [0, 0, 0, 1],
    mesh: 'citizen', castShadows: true, animation: { clip: 'citizen/idle', speed: 1, loop: true, time: 0 },
    components: [{ type: 'Bowler', Slot: slot, enabled: true }] });
}

const scene = {
  schema: 1,
  camera: { position: at([RUNUP[0] - 700, LANE_Y[0], H + R + 160]), target: at([HEAD_X, LANE_Y[0], H]), fov: 70, near: 0.25, far: 0 },
  environment: {
    sky_top: [0.09, 0.23, 0.55], sky_horizon: [0.42, 0.58, 0.74], sky_ground: [0.33, 0.46, 0.52],
    sun: { direction: dirInt([0.005, 0.706, -0.708]), color: [0.944, 0.978, 1.0], intensity: 3.2, size: 0.6, shadows: true },
    ambient: [0.253 * 1.4, 0.32 * 1.4, 0.353 * 1.4],
    fog: { color: [0.45, 0.6, 0.74], density: 0.00035, start: 300, heightFalloff: 0 },
    shadows: { distance: 260, bias: 0.08, normalBias: 0.06, softness: 1, strength: 1 },
    exposure: 1,
  },
  materials: [
    { name: 'lanebed', color: [1, 1, 1, 1], texture: 'textures/lanewood_color.png', roughness: 0.2 },
    { name: 'approach', color: [1, 1, 1, 1], texture: 'textures/approachwood_color.png', roughness: 0.55 },
    { name: 'gutter', color: [1, 1, 1, 1], texture: 'textures/gutter_color.png', roughness: 0.33, metallic: 0.15 },
    { name: 'metal', color: [1, 1, 1, 1], texture: 'textures/metal_color.png', roughness: 0.38, metallic: 0.75 },
    { name: 'pit', color: [1, 1, 1, 1], texture: 'textures/pit_color.png', roughness: 0.85 },
    { name: 'carpet', color: [1, 1, 1, 1], texture: 'textures/floordark_color.png', roughness: 0.9 },
    { name: 'floor', color: [1, 1, 1, 1], texture: 'textures/floor_color.png', roughness: 0.55 },
    { name: 'pin', color: [0.95, 0.95, 0.95, 1], roughness: 0.3 },
    { name: 'concourse', color: [0.14 * 1.4, 0.15 * 1.4, 0.2 * 1.4, 1], texture: 'textures/carpet_color.png', roughness: 0.9 },
    { name: 'ramp', color: [0.2 * 2.5, 0.22 * 2.5, 0.28 * 2.5, 1], texture: 'textures/floordark_color.png', roughness: 0.8 },
    ...[...paints].map(([name, c]) => ({ name, color: [...c, 1], roughness: 0.55 })),
  ],
  meshes: [
    ...Object.keys(objs).map((name) => ({ name, obj: `models/${name}.obj` })),
    { name: 'citizen', gltf: 'models/citizen.glb' },
  ],
  entities,
};
const line = (x) => JSON.stringify(x);
const block = (o) => Object.entries(o).map(([k, v]) => `  ${line(k)}: ${Array.isArray(v) ? `[\n${v.map((e) => '    ' + line(e)).join(',\n')}\n  ]` : line(v)}`);
fs.writeFileSync(path.join(root, 'scene.json'), `{\n${block(scene).join(',\n')}\n}\n`);

// the landmarks GPU# needs (Code/Alley.gs), so the code and the geometry cannot drift apart
const f = (x) => `${r6(x)}f`;
fs.writeFileSync(path.join(root, 'Code', 'Alley.gs'), `// Generated by tools/make-scene.mjs: the alley's landmarks, lane-local (add the lane's y), s&box units.
public static class Alley
{
	public const float R = ${f(R)};                   // ball radius
	public const float U = ${f(U)};                 // units per real inch on the lane
	public const float H = ${f(H)};                // platform top
	public const float LaneHalf = ${f(LANE_HALF)};
	public const float GutterOut = ${f(GUTTER_OUT)};
	public const float PlatformHalf = ${f(PLATFORM_HALF)};
	public const int Lanes = ${LANE_COUNT};
	public const float ApproachX = ${f(APPROACH_X)};
	public const float FoulX = ${f(FOUL_X)};
	public const float ThrowX = ${f(THROW_X)};
	public const float HeadX = ${f(HEAD_X)};
	public const float DeckCenterX = ${f((HEAD_X + DECK_END_X) / 2 - 3 * U)};
	public const float DeckEndX = ${f(DECK_END_X)};
	public const float PitEndX = ${f(PIT_END_X)};
	public const float BackboardX = ${f(BACKBOARD_X)};
	public const float SetteeZ = ${f(SETTEE_Z)};
	public const float RunUpX = ${f(RUNUP[0])};
	public const float PinHeight = ${f(PIN_H)};
	public const float RowDepth = ${f(ROW)};
	public const float ConcourseX0 = ${f(CONC_X0)};
	public const float ConcourseX1 = ${f(CONC_X1)};
	public const float ConcourseHalf = ${f(CONC_HALF)};
	public const float ConcourseZ = 8f;
	public const float RampHalf = 341.76f;
	public const float SetteeHalf = 284.8f;
	public const float SetteeFloor = ${f(SETTEE_Z + 4)};
	public const float SetteeCentreX = ${f(PIT_END_X + 343.75 / 2)};
	public const float PodiumX = 25011.23f;               // the LANE / BALL / HELP podiums (lane-local y -142.4, 0, 142.4)
	public const float RampX0 = ${f(RAMP_X0)};
	public const float BarrierTop = ${f(BARRIER_TOP)};
	public const float GutterFloor = ${f(H - GUTTER_D)};
	public const float BarrierOut = ${f(BARRIER_OUT)};
	public static readonly float[] LaneY = { ${LANE_Y.map(f).join(', ')} };
}
`);
console.log(`terryball: ${LANE_COUNT} lane(s), ${entities.length} entities, ${colliders.length} colliders, meshes ${Object.keys(objs).join(' ')}`);
