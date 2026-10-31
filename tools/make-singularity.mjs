// The Pin Singularity (Code/Singularity.gs, Code/Graviton.gs): a demo effect on key 3. This writes its assets:
//   models/sg_pin.obj     a low-poly pin for the rain, origin at its capsule's centre (instanced from the GPU pool)
//   models/sg_warp.obj    the alley's ground surfaces re-tessellated (lane beds, approaches, gutters, pits, carpet,
//                         barriers, the floor), drawn instead of the originals while space bends round the hole
//   scene.extra.json      the Singularity, its Graviton workers, the two meshes and the heat materials (merged with
//                         whatever else is in the file; make-scene.mjs merges it into scene.json)
// Run it after tools/make-scene.mjs changes the alley, then make-scene again:
//   node tools/make-singularity.mjs [--workers 256] && node tools/make-scene.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i < 0 ? def : +process.argv[i + 1]; };
const WORKERS = arg('--workers', 256);   // Graviton instances; each owns PER_WORKER rain pins (Graviton.Pins)
const PER_WORKER = 32;
const FIRST_ID = 100000;
const INCH = 0.0254;
const r6 = (x) => +x.toFixed(6);
const toInt = (p) => [-p[1], p[2], -p[0]].map((x) => r6(x * INCH));
const dirInt = (p) => [-p[1], p[2], -p[0]].map(r6);
const fromInt = (q) => [-q[2] / INCH, -q[0] / INCH, q[1] / INCH];   // internal metres -> s&box inches

// ---------------------------------------------------------------- the rain pin: the game pin's silhouette, 10 sides
const U = 200 / 8.5, PIN_H = 15 * U, PIN_R = 5 * U / 2;
const PROFILE = [[0, 0.426], [0.05, 0.594], [0.15, 0.82], [0.225, 0.946], [0.3, 1], [0.392, 0.957], [0.575, 0.518], [0.625, 0.413],
  [0.667, 0.374], [0.725, 0.392], [0.783, 0.439], [0.9, 0.535], [0.955, 0.38], [1, 0.165]];
function writeObj(name, V, VT, VN, F) {
  const lines = [`# Terryball (tools/make-singularity.mjs): ${name}`];
  for (const v of V) lines.push(`v ${v.join(' ')}`);
  for (const t of VT) lines.push(`vt ${t.join(' ')}`);
  for (const n of VN) lines.push(`vn ${n.join(' ')}`);
  for (const f of F) lines.push('f ' + f.map((i) => `${i}/${i}/${i}`).join(' '));
  fs.writeFileSync(path.join(root, 'models', `${name}.obj`), lines.join('\n') + '\n');
  console.log(`models/${name}.obj: ${V.length} vertices, ${F.length} faces`);
}
{
  const SEG = 10, V = [], VT = [], VN = [], F = [], rows = [];
  for (const [t, d] of PROFILE) {
    const row = [];
    const i = PROFILE.findIndex((p) => p[0] === t);
    const a = PROFILE[Math.max(0, i - 1)], b = PROFILE[Math.min(PROFILE.length - 1, i + 1)];
    const dr = (b[1] - a[1]) * PIN_R / ((b[0] - a[0]) * PIN_H);
    for (let k = 0; k <= SEG; k++) {
      const ang = (k / SEG) * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang), r = d * PIN_R;
      V.push(toInt([r * ca, r * sa, (t - 0.5) * PIN_H]));
      const n = [ca, sa, -dr], l = Math.hypot(...n);
      VN.push(dirInt(n.map((x) => x / l)));
      VT.push([r6(k / SEG), r6(1 - t)]);
      row.push(V.length);
    }
    rows.push(row);
  }
  for (let j = 0; j < rows.length - 1; j++) for (let k = 0; k < SEG; k++) F.push([rows[j][k], rows[j][k + 1], rows[j + 1][k + 1], rows[j + 1][k]]);
  for (const [t, nz, row] of [[0, -1, rows[0]], [1, 1, rows[rows.length - 1]]]) {
    V.push(toInt([0, 0, (t - 0.5) * PIN_H])); VN.push(dirInt([0, 0, nz])); VT.push([0.5, r6(1 - t)]);
    const c = V.length, cap = [];
    for (let k = 0; k <= SEG; k++) { V.push(V[row[k] - 1]); VN.push(dirInt([0, 0, nz])); VT.push(VT[row[k] - 1]); cap.push(V.length); }
    for (let k = 0; k < SEG; k++) F.push(nz < 0 ? [c, cap[k + 1], cap[k]] : [c, cap[k], cap[k + 1]]);
  }
  writeObj('sg_pin', V, VT, VN, F);
}

// ---------------------------------------------------------------- the warp: the ground surfaces, finely tessellated
// Each part keeps its OBJ's world-scaled UVs; u carries the part (u + 4096 * part) so one mesh draws them all.
const PARTS = ['lanebed', 'approach', 'gutter', 'pit', 'carpet', 'metal', 'floor'];
const MAX_EDGE = 160 * INCH;   // metres
function readObj(name) {
  const V = [], VT = [], VN = [], F = [];
  for (const line of fs.readFileSync(path.join(root, 'models', `${name}.obj`), 'utf8').split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v') V.push(p.slice(1, 4).map(Number));
    else if (p[0] === 'vt') VT.push(p.slice(1, 3).map(Number));
    else if (p[0] === 'vn') VN.push(p.slice(1, 4).map(Number));
    else if (p[0] === 'f') F.push(p.slice(1).map((s) => s.split('/').map((x) => +x - 1)));
  }
  return { V, VT, VN, F };
}
{
  const V = [], VT = [], VN = [], F = [];
  const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
  const bil = (c, u, v) => lerp(lerp(c[0], c[1], u), lerp(c[3], c[2], u), v);
  // a quad (corners in order) cut into a grid: us/vs are the cut fractions along its two edges
  function grid(P, T, n, part, us, vs) {
    const base = V.length, W = us.length;
    for (const v of vs) for (const u of us) {
      V.push(bil(P, u, v).map(r6));
      const t = bil(T, u, v);
      VT.push([r6(t[0] + 4096 * part), r6(t[1])]);
      VN.push(n);
    }
    for (let j = 0; j < vs.length - 1; j++) for (let i = 0; i < W - 1; i++) {
      const a = base + j * W + i + 1;
      F.push([a, a + 1, a + 1 + W, a + W]);
    }
  }
  const even = (len) => { const n = Math.max(1, Math.ceil(len / MAX_EDGE)); return Array.from({ length: n + 1 }, (_, i) => i / n); };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  PARTS.forEach((name, part) => {
    const o = readObj(name);
    for (const f of o.F) {
      if (f.length !== 4) throw new Error(`${name}: only quads`);
      const P = f.map((x) => o.V[x[0]]), T = f.map((x) => o.VT[x[1]]), n = o.VN[f[0][2]];
      if (name === 'floor') {
        // dense round the lanes, then each cell 1.3x the last out to the floor's edge
        const lo = fromInt(P[0]), hi = fromInt(P[2]);
        const cuts = (a, b, c0, c1) => {
          const xs = [];
          for (let x = c0; x <= c1 + 1e-6; x += 160) xs.push(x);
          for (let s = 160 * 1.3, x = c0 - s; x > Math.min(a, b); s *= 1.3, x -= s) xs.unshift(x);
          for (let s = 160 * 1.3, x = c1 + s; x < Math.max(a, b); s *= 1.3, x += s) xs.push(x);
          return [Math.min(a, b), ...xs.filter((x) => x > Math.min(a, b) && x < Math.max(a, b)), Math.max(a, b)];
        };
        const xs = cuts(lo[0], hi[0], -4000, 31000), ys = cuts(lo[1], hi[1], -7200, 7200);
        // map s&box (x, y) back onto the quad's own (u, v) fractions
        const sx = fromInt(P[0]), ex = fromInt(P[1]), ey = fromInt(P[3]);
        const ax = ex[0] - sx[0], ay = ex[1] - sx[1], bx = ey[0] - sx[0], by = ey[1] - sx[1];
        const us = Math.abs(ax) > Math.abs(ay) ? xs.map((x) => (x - sx[0]) / ax) : ys.map((y) => (y - sx[1]) / ay);
        const vs = Math.abs(bx) > Math.abs(by) ? xs.map((x) => (x - sx[0]) / bx) : ys.map((y) => (y - sx[1]) / by);
        grid(P, T, n, part, us.sort((a, b) => a - b), vs.sort((a, b) => a - b));
      } else grid(P, T, n, part, even(dist(P[0], P[1])), even(dist(P[1], P[2])));
    }
  });
  writeObj('sg_warp', V, VT, VN, F);
}

// ---------------------------------------------------------------- scene.extra.json
const scene = JSON.parse(fs.readFileSync(path.join(root, 'scene.json'), 'utf8'));
const idOf = (name) => { const e = scene.entities.find((x) => x.name === `Alley ${name}`); if (!e) throw new Error(`no Alley ${name}`); return e.id; };
const extraPath = path.join(root, 'scene.extra.json');
const extra = fs.existsSync(extraPath) ? JSON.parse(fs.readFileSync(extraPath, 'utf8')) : {};
const mine = (e) => e.id >= FIRST_ID && e.id < FIRST_ID + 1000;
extra.entities = (extra.entities || []).filter((e) => !mine(e));
extra.meshes = (extra.meshes || []).filter((m) => !m.name.startsWith('sg_'));
extra.materials = (extra.materials || []).filter((m) => !m.name.startsWith('sg_'));

extra.meshes.push({ name: 'sg_pin', obj: 'models/sg_pin.obj' }, { name: 'sg_warp', obj: 'models/sg_warp.obj' });
// the rain pins' heat: lacquer white, then glowing red, orange, yellow, white hot (emissive, linear)
const HEAT = [[0, 0, 0], [0.6, 0.05, 0.01], [2, 0.25, 0.03], [5, 1.1, 0.12], [9, 3.2, 0.5], [14, 7, 2], [20, 14, 7], [30, 26, 20]];
HEAT.forEach((e, k) => extra.materials.push({ name: `sg_heat${k}`, color: [0.95, 0.95, 0.95, 1], roughness: 0.3, emissive: e }));
extra.materials.push({ name: 'sg_warp', color: [1, 1, 1, 1], roughness: 0.5 });

const hide = Object.fromEntries(PARTS.map((p) => [`Hide${p[0].toUpperCase()}${p.slice(1)}`, idOf(p)]));
extra.entities.push({ id: FIRST_ID, name: 'Pin Singularity', position: [0, 0, 0], rotation: [0, 0, 0, 1], mesh: 'sg_warp', material: 'sg_warp',
  castShadows: true, components: [{ type: 'Singularity', enabled: true, ...hide }] });
for (let k = 0; k < WORKERS; k++) {
  // parked far under the floor: a static speck that meets nothing (it only gives the worker an OnPhysicsStep)
  const at = toInt([-20000 - 400 * (k % 16), 400 * Math.floor(k / 16) - 3200, -60000]);
  const e = { id: FIRST_ID + 1 + k, name: `Graviton ${k}`, position: at, rotation: [0, 0, 0, 1],
    body: { type: 'static', shape: 'sphere', radius: 0.05, category: 64, mask: 64 },
    components: [{ type: 'Graviton', Index: k, enabled: true }] };
  // the first eight carry the heat materials, so the GPU can look up their indices
  if (k < HEAT.length) Object.assign(e, { mesh: 'sg_pin', material: `sg_heat${k}`, castShadows: false });
  extra.entities.push(e);
}
fs.writeFileSync(extraPath, JSON.stringify(extra, null, 1) + '\n');
console.log(`scene.extra.json: Pin Singularity + ${WORKERS} Gravitons (${WORKERS * PER_WORKER} rain pins); hides ${JSON.stringify(hide)}`);
