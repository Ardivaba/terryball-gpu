// A localhost multiplayer check: a headless host, and a headless client (player slot 1) that starts a quick game
// on its nearest lane (Q) and throws once through the aim meter. Both dump their components at the end; this prints
// each side's view of the lane the client played.
//   node tools/net-test.mjs [--port 27052] [--seconds 26] [--shots DIR]   (client screenshots, every frame)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sbox = path.join(root, '..', 'sbox-public');
const exe = path.join(sbox, 'game', 'bin', 'win64', 'sgpu-player.exe');
const tools = path.join(sbox, 'native', '.toolchain');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1]; };
const port = arg('--port', '27052'), seconds = +arg('--seconds', '26'), shots = arg('--shots', null);
const out = path.join(root, 'out');
fs.mkdirSync(out, { recursive: true });

// the client's script (its own frames, 60 per second): Q, then once the crane has it, LINE AIM POWER SPIN
const RATE = 0.9 / 60, carets = [0.85, 0.5, 0.85, 0.05], DEFAULT = [0.5, 0.5, 0, 0.5];
const ev = ['90:81:1', '92:81:0'];
let f = 640;
for (let s = 0; s < 4; s++) {
  const delta = carets[s] - DEFAULT[s], n = Math.round(Math.abs(delta) / RATE);
  if (n > 0) { const key = delta > 0 ? 68 : 65; ev.push(`${f}:${key}:1`, `${f + n}:${key}:0`); f += n + 2; }
  ev.push(`${f}:32:1`, `${f + 2}:32:0`);
  f += 12;
}
const frames = seconds * 60;
const run = (name, extra) => new Promise((resolve) => {
  const log = fs.openSync(path.join(out, `net-${name}.log`), 'w');
  const p = spawn(exe, [root, '--headless', '--frames', String(frames), '--width', '640', '--height', '360', '--tools', tools,
    '--dump-components', path.join(out, `net-${name}.json`), ...extra], { stdio: ['ignore', log, log] });
  p.on('exit', (code) => resolve(code));
});
const host = run('host', ['--host', port]);
await new Promise((r) => setTimeout(r, 2500));
const clientArgs = ['--join', `127.0.0.1:${port}`, '--input', ev.join(';'), '--name', 'client'];
if (shots) { fs.rmSync(shots, { recursive: true, force: true }); fs.mkdirSync(shots, { recursive: true }); clientArgs.push('--screenshots', shots, '0'); }
const client = run('client', clientArgs);
const codes = await Promise.all([host, client]);
for (const side of ['host', 'client']) {
  const comps = JSON.parse(fs.readFileSync(path.join(out, `net-${side}.json`), 'utf8'));
  const lanes = comps.filter((c) => c.type === 'Lane');
  const lane = lanes.find((c) => c.Playing) || lanes[0];
  const rolls = [];
  for (let s = 0; s < 3; s++) rolls.push((lane.Rolls[0] >> (4 * s) & 15) - 1);
  const b1 = comps.find((c) => c.type === 'Bowler' && c.Slot === 1);
  console.log(side, JSON.stringify({ exit: codes[side === 'host' ? 0 : 1], lane: lane.Index, playing: lane.Playing, roster: lane.Roster.slice(0, lane.RosterCount),
    joined: lane.JoinedBits, round: lane.Round, frame: lane.Frame + 1, rolls, call: lane.Call, bowler1: { alive: b1.Alive, joined: b1.Joined, carried: b1.Carried } }));
}
