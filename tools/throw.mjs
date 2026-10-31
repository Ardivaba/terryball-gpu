// Headless test throws: scripts the aim meter (LINE, AIM, POWER, SPIN carets, 0 = screen left) with held A/D keys
// and Space, runs sgpu-player, and prints the lane's result from --dump-components.
//   node tools/throw.mjs line aim power spin [--frames N] [--shots DIR FROM] [--size WxH] [--then "F:K:D;..."]
// Several throws in one run: separate caret quadruples with "," (e.g. 0.5 0.45 0.8 0.3 , 0.5 0.5 0.7 0.5); each
// starts once the previous ball is back (--gap frames apart, default 600).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sbox = path.join(root, '..', 'sbox-public');
const flags = new Set(process.argv.slice(2).filter((a) => a === '--walk3' || a === '--noquick'));
const args = process.argv.slice(2).filter((a) => !flags.has(a));
const opt = (name, n = 1) => { const i = args.indexOf(name); if (i < 0) return null; const v = args.slice(i + 1, i + 1 + n); args.splice(i, n + 1); return n === 1 ? v[0] : v; };
const frames = +(opt('--frames') || 0);
const shots = opt('--shots', 2);
const size = (opt('--size') || '960x540').split('x');
const gap = +(opt('--gap') || 600);
const extra = opt('--then');
const audio = opt('--audio');   // a WAV of the mixed game audio (sgpu-player --audio-capture)
const start = +(opt('--start') || (flags.has('--walk3') ? 1500 : 480));   // Q (a quick game) is pressed at frame 5; the crane then fetches the bowler
const throws = args.join(' ').split(',').map((t) => t.trim().split(/\s+/).map(Number)).filter((t) => t.length === 4);

const DEFAULT = [0.5, 0.5, 0, 0.5], RATE = 0.9 / 60;
const noQuick = flags.has('--noquick');
// --walk3: slot 0 runs from the concourse up lane 3's ramp to its LANE podium, opens the lobby, JOIN, then START
// (the crane then fetches him; start the throws at 1500 or later)
const WALK3 = '5:16:1;10:68:1;290:68:0;300:87:1;880:87:0;881:16:0;890:65:1;915:65:0;930:69:1;932:69:0;950:32:1;952:32:0;' +
  '970:83:1;972:83:0;990:83:1;992:83:0;1010:83:1;1012:83:0;1030:32:1;1032:32:0';
const walk3 = flags.has('--walk3');
const ev = walk3 ? [WALK3] : noQuick ? [] : ['5:81:1', '7:81:0'];
let f = start;
for (const carets of throws) {
  for (let s = 0; s < 4; s++) {
    const delta = carets[s] - DEFAULT[s];
    const n = Math.round(Math.abs(delta) / RATE);
    if (n > 0) { const key = delta > 0 ? 68 : 65; ev.push(`${f}:${key}:1`, `${f + n}:${key}:0`); f += n + 2; }
    ev.push(`${f}:32:1`, `${f + 2}:32:0`);
    f += 10;
  }
  f += gap;
}
if (extra) ev.push(extra);
const total = frames || f;
const dump = path.join(root, 'out', 'throw-dump.json');
const cmd = [root, '--headless', '--frames', String(total), '--width', size[0], '--height', size[1], '--input', ev.join(';'),
  '--dump-components', dump, '--tools', path.join(sbox, 'native', '.toolchain')];
if (audio) cmd.push('--audio-capture', audio);
if (shots) { fs.rmSync(shots[0], { recursive: true, force: true }); fs.mkdirSync(shots[0], { recursive: true }); cmd.push('--screenshots', shots[0], shots[1]); }
const log = execFileSync(path.join(sbox, 'game', 'bin', 'win64', 'sgpu-player.exe'), cmd, { encoding: 'utf8', maxBuffer: 1 << 26 });
fs.writeFileSync(path.join(root, 'out', 'throw.log'), log);
const comps = JSON.parse(fs.readFileSync(dump, 'utf8'));
const lane = comps.find((c) => c.type === 'Lane' && c.Playing) || comps.find((c) => c.type === 'Lane');
const ball = comps.find((c) => c.type === 'Ball' && c.Lane === lane.entity);
const rolls = [];
for (let s = 0; s < 21; s++) { const v = (lane.Rolls[Math.floor(s / 8)] >> (4 * (s % 8)) & 15) - 1; rolls.push(v); }
const down = []; for (let n = 1; n <= 10; n++) if (lane.DownBits >> n & 1) down.push(n);
console.log(JSON.stringify({ lane: lane.Index, frames: total, round: lane.Round, frame: lane.Frame + 1, ball: lane.BallNo, call: lane.Call, rolls: rolls.join(' '), down: down.join(','), mph: +ball.ThrowMph.toFixed(2), track: ball.Track.map((y) => Math.round(y)).join(' '), lowZ: Math.round(ball.TrackZ) }));
