// Checks the firmware's effect engine (src/Fx.cpp) against the browser's (data/www/fx.js):
//   node tools/fxtest/test.js
// Builds Fx.cpp with the PC's own compiler (Windows: WSL's g++; Mac / Linux: g++), runs every effect template
// plus some awkward programs, and compares each fixture's r g b w dim. Fx.cpp itself also
// checks its fast path against a plain interpreter of the same bytecode (must match exactly).
// Differences against fx.js below 1e-9 are the maths libraries (glibc vs the browser).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const fx = require('../../data/www/fx.js');

const ROOT = path.join(__dirname, '..', '..');
const EXTRA = [
  // stress test effects (tools/stress/make-stress.js)
  'param speed = 0.2 [0, 2]\nr, g, b = hsv(t * speed + u * 2, 1, 1)',
  'param speed = 0.5 [0, 4]\npos = fract(t * speed)\nd = abs(fract(u - pos + 0.5) - 0.5)\nk = smoothstep(0.1, 0, d)\nr = k\ng = k * 0.5\nb = 1 - k',
  'param speed = 1 [0, 4]\nn1 = noise(u * 8 + t * speed)\nn2 = noise(u * 3 - t * speed * 0.7)\nk = smoothstep(0.2, 0.8, n1 * n2 * 2)\nh = fract(t * 0.05 + u + sin(t + u * 6) * 0.1)\nr, g, b = hsv(h, clamp(n2 + 0.3, 0, 1), k)\ndim = mix(0.4, 1, tri(t * 0.3 + u))',
  // awkward ones for the frame / fixture split
  'r, g, b = hsv(t * 0.1, 1, 1)',                                    // a whole-rig colour: per frame
  'a = t * 2\na = a + u\nr = a\ng = fract(a)',                         // set twice: stays per fixture
  'a = t\nb = a * 2\nc = b + i\nr = fract(c)\ng = fract(b)\ndim = dim * 0.5',
  'k = i > 3 ? sin(t) : cos(t * 2)\nr = k\nb = t > 1 ? 1 : u',
  'param c = #ff8000\nr, g, b = c\ndim = sq(t * 2) ? 1 : 0.2',
  'w = fract(t)\nr = 1\ng = 1\nb = 1',
  'x2 = mod(t * 3, 0)\nr = x2 + 1 / 0\ng = pow(-2, 0.5)\nb = log(-1) + sqrt(-4)',
  'r = rand(t * 1e9)\ng = rand(-t * 1e6 + u)\nb = noise(t * 1e7 + i)',
  'r = rand(1e15 + t)\ng = rand(-3e12)',
  'p1 = atan(y - 0.5, x - 0.5)\np2 = tan(t)\nr = fract(p1 + p2)\ng = exp(-t) * u',
  'v = sin(t) + cos(t) * 2\nr, g, b = hsv(v + u, 0.5, 1)\ndim = min(max(v, 0), 1)',
  'q = t * 0 + 5\nr = q / 10\ng = q && u\nb = !q || i == 2',
  'a = t\nr = a\na2 = a + 1\ng = fract(a2 * u)\nr = r * 0.5',
  'r, g, b = hsv(t, 1, 1) + 0',
  'dim = -t\nr = -(-u)\ng = !(!(t))',
  // colour lists, texts, pictures (with values as a timeline cue gives them)
  'param pal = #ff0000, #00ff00, #0000ff\nr, g, b = grad(pal, u * 1.4 - 0.2 + t * 0.01)',
  'param pal = #ff0000, #00ff00\nr, g, b = grad(pal, fract(t + u))\nr2, w, b2 = grad(pal, x)',
  { code: 'param pal = #ff0000, #00ff00\nr, g, b = grad(pal, tri(t + u))', values: { pal: '#123456, #abcdef ,#ffffff,#000000,#0f0f0f,#f0f0f0,#808080,#7f7f7f' } },
  { code: 'param pal = #ff0000, #00ff00\nr, g, b = grad(pal, u)', values: { pal: '#ffffff' } },
  { code: 'param pal = #ff0000, #00ff00\nr, g, b = grad(pal, u)', values: { pal: '#fff,#000' } },   // not valid: the default stays
  // colour lists with places (unordered, equal places = hard edge, some without a place)
  'param pal = #ff0000, #ff0000 0.9, #ffff00\nr, g, b = grad(pal, u * 1.2 - 0.1)',
  'param pal = #00ff00 0.7, #0000ff 0.2, #ff0000 .5, #ffffff\nr, g, b = grad(pal, fract(u + t * 0.1))',
  'param pal = #ff0000 0.5\nr, g, b = grad(pal, u)',
  { code: 'param pal = #ff0000, #00ff00\nr, g, b = grad(pal, u)', values: { pal: '#ff0000 0.4, #ffff00 0.4 ,#0000ff 1, #00ffff 0' } },
  { code: 'param pal = #ff0000, #00ff00\nr, g, b = grad(pal, u)', values: { pal: '#123456 1.0,#654321 0.25,#abcdef' } },
  { code: 'param pal = #ff0000, #00ff00\nr, g, b = grad(pal, u)', values: { pal: '#123456 1.5,#654321' } },   // place over 1: default
  { code: 'param pal = #ff0000, #00ff00\nr, g, b = grad(pal, u)', values: { pal: '#123456 1.,#654321' } },   // "1." is not a place
  { code: 'param pal = #ff0000, #00ff00\nr, g, b = grad(pal, u)', values: { pal: '#123456  0.3  , #654321 0' } },
  'param pal = #ff0000 1.5, #00ff00\nr = 1',   // rejected by both
  'param msg = "Hello, World! {~}"\nr = txt(msg, x * 30 + t * 7, y * 9 - 1)\ng = msg.w\nb = txt(msg, i * 6 + 2, 3)',
  { code: 'param msg = "x"\nr = txt(msg, u * msg.w + t, 6.5 - u * 8)\ng = msg.w', values: { msg: 'Grüße, ÄÖÜ: 0123456789 abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ' } },
  'param msg = ""\nr = txt(msg, u, 1)\ng = msg.w + 1',
  'param pic = image\nr, g, b = img(pic, x, y, t * 3)\ndim = pic.w + pic.h + pic.frames',
  { code: 'param pic = image\nr, g, b = img(pic, fract(x * 1.7 + t), fract(y), t * 3 - i)\nw = pic.frames / 10', values: { pic: 'img:3x2x2:' + Buffer.from(Array.from({ length: 36 }, (_, k) => (k * 37) & 255)).toString('base64') } },
  { code: 'param pic = image\nr, g, b = img(pic, u, 0.5, 1e12 + t)', values: { pic: 'img:2x1x3:' + Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]).toString('base64').replace(/=+$/, '') } },
  { code: 'param pic = image\nr, g, b = img(pic, u, u, 0)', values: { pic: 'img:2x2x1:AAAA' } },   // too short: no picture
  'param pal = #ff0000, #00ff00\nparam msg = "AB"\nparam pic = image\nk = txt(msg, t * 6 + u * 12, y * 7)\nr, g, b = grad(pal, k)\nr2, g2, b2 = img(pic, x, y, 0)\nw = r2 + k',
  // clocks ("t * speed"), automation (cue "auto"), a looping timeline (wrap) and a live edit at 1.5 s (glide + clock carry-over)
  'param speed = 0.5 [0, 4]\nparam spread = 1 [0, 4]\na = fract(t * speed + u * spread)\nb = speed * t\nr = a\ng = fract(b * 0.3)\nbb = t * speed * 2\nb = fract(bb)',
  { code: 'param speed = 0.5 [0, 4]\nparam spread = 1 [0, 4]\nr = fract(t * speed + u * spread)\ng = spread / 4\nb = noise(t * speed * 3 + i)', auto: { speed: [[0, 0.2, 0], [1000, 1, 0.5], [4000, 3, -1], [4000, 0.1, 0], [9000, 0.7, 0.3]] } },
  { code: 'param speed = 0.5 [0, 4]\nparam spread = 1 [0, 4]\nr = fract(t * speed + u * spread)\ng = spread / 4\nb = sin(t * spread)', auto: { speed: [[500, 2, 0], [3000, 0.5, 1]], spread: [[0, 0, 0], [2000, 4, -0.5]] }, wrap: 10 },
  { code: 'param speed = 0.5 [0, 4]\nparam c = #ff0000\nparam pal = #000000, #ffffff\nr = fract(t * speed) * c.r\ng, b2, b = grad(pal, u)', values: { speed: 0.5 }, edit: { speed: 2, c: '#00ff80', pal: '#ff0000,#0000ff' } },
  { code: 'param speed = 0.5 [0, 4]\nparam size = 1 [0, 4]\nr = fract(t * speed + u * size)\ng = size', auto: { speed: [[0, 1, 0], [6000, 3, 0]] }, wrap: 8, edit: { size: 3 } },
  // must be rejected by both
  'r = grad(u, 1)',
  'param m = "x"\nr = m',
  'param p = #ff0000, #00ff00\nr, g, b = grad(p u)',
  'param q = "abc\nr = 1',
  'param p = #ff0000, #00ff00, #000000, #000000, #000000, #000000, #000000, #000000, #000000\nr = 1',
];
// Clip options: [flip, mirror, repeat, kaleido] (bits 1 = x, 2 = y), checked against place().
const PLACES = [[1, 0, 1, 0], [2, 0, 1, 0], [3, 0, 1, 0], [0, 1, 1, 0], [0, 2, 1, 0], [0, 3, 1, 0], [0, 0, 2, 0], [0, 0, 3, 0], [0, 0, 8, 0],
  [0, 0, 1, 6], [0, 0, 1, 2], [0, 0, 1, 12], [1, 1, 2, 5], [3, 3, 4, 7]];
const AXES = ['', 'x', 'y', 'xy'];

const cases = [...fx.TEMPLATES.map((t) => t.code), ...EXTRA].map((e) => (typeof e === 'string' ? { code: e, values: {} } : { values: {}, ...e }));
const programs = cases.map((c) => c.code);
const esc = (v) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, ' ');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fxtest-'));
for (const f of ['src/Fx.cpp', 'src/Fx.h', 'tools/fxtest/fxtest.cpp', 'tools/fxtest/shim/Arduino.h', 'tools/fxtest/shim/BigRam.h'])
  fs.copyFileSync(path.join(ROOT, f), path.join(tmp, path.basename(f)));
fs.writeFileSync(path.join(tmp, 'programs.txt'), cases.map((c) => [esc(c.code), ...Object.entries(c.values).map(([k, v]) => `${k}=${esc(String(v))}`),
  ...(c.wrap ? [`@wrap=${c.wrap}`] : []), ...Object.entries(c.auto || {}).map(([k, pts]) => `@auto=${k}:${pts.map((q) => q.join(',')).join(';')}`),
  ...Object.entries(c.edit || {}).map(([k, v]) => `@edit=${k}=${esc(String(v))}`)].join('\t')).join('\n') + '\n'
  + PLACES.map((m) => `#place ${m.join(' ')}`).join('\n') + '\n', 'utf8');
// Windows: WSL's g++ (no native compiler); Mac / Linux: the system's own g++ (clang++ on a Mac).
const build = 'g++ -std=c++14 -O2 -Wall -Wno-unused-function -I. -o fxtest fxtest.cpp Fx.cpp && ./fxtest < programs.txt';
const wslPath = '/mnt/' + tmp[0].toLowerCase() + tmp.slice(2).replace(/\\/g, '/');
let out;
try {
  out = process.platform === 'win32'
    ? execFileSync('wsl', ['-d', 'Ubuntu-22.04', '--', 'bash', '-c', `cd '${wslPath}' && ${build}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 << 20 })
    : execFileSync('bash', ['-c', build], { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 << 20 });
} catch (e) {
  console.error('FAILED: build or run (see above), or the fast path differs from the plain interpreter');
  process.exit(1);
}

const times = [0, 0.37, 1.5, 12.25, 333.333, 3600.1, 259200.7];
const n = 9;
const toD = (hex) => { const b = Buffer.from(hex, 'hex'); return b.readDoubleBE(0); };
let worst = 0, bad = 0, compared = 0, errors = 0, placeBad = 0;
const jsRejected = new Set();
for (const line of out.trim().split('\n')) {
  const w = line.split(' ');
  if (w[0] === 'P') {   // clip options: i and n exactly, x / y within rounding
    const m = PLACES[+w[1]], i = +w[2];
    const js = fx.place({ flip: AXES[m[0]], mirror: AXES[m[1]], repeat: m[2], kaleido: m[3] }, i, n, i * 0.13, 1 - i * 0.11);
    const cx = toD(w[5]), cy = toD(w[6]);
    if (js.i !== +w[3] || js.n !== +w[4] || Math.abs(js.x - cx) > 1e-12 || Math.abs(js.y - cy) > 1e-12) {
      console.log(`place ${m.join(',')} fixture ${i}: firmware ${w[3]} ${w[4]} ${cx} ${cy}, fx.js ${js.i} ${js.n} ${js.x} ${js.y}`);
      placeBad++;
    }
    continue;
  }
  const k = +w[0];
  const prog = fx.compile(programs[k]);
  if (w[1] === 'E') {
    if (!prog.error) { console.log(`program ${k}: firmware says "${w.slice(2).join(' ')}", fx.js compiles it`); bad++; }
    errors++;
    continue;
  }
  if (prog.error) {
    if (!jsRejected.has(k)) { console.log(`program ${k}: fx.js says "${prog.error.msg}", the firmware compiles it`); bad++; jsRejected.add(k); }
    continue;
  }
  const f = +w[1], i = +w[2];
  const cs = cases[k];
  let R = fx.runner(prog, cs.values, cs.auto, cs.wrap || 0);
  if (cs.edit) { const nu = fx.runner(prog, { ...cs.values, ...cs.edit }, cs.auto, cs.wrap || 0); fx.carry(R, 1.5, nu, 1.5); R = nu; }
  const s = fx.frame(R, times[f]);
  s[1] = i; s[2] = n; s[3] = i / n; s[4] = i * 0.13; s[5] = 1 - i * 0.11;
  fx.run(prog, s);
  for (let j = 0; j < 5; j++) {
    const c = toD(w[3 + j]), js = s[8 + j];
    const d = Math.abs(c - js) / Math.max(1, Math.abs(js));
    compared++;
    if (!(d <= 1e-9) && !(Number.isNaN(c) && Number.isNaN(js))) {
      if (bad < 20) console.log(`program ${k} frame ${f} fixture ${i} slot ${8 + j}: firmware ${c}, fx.js ${js}`);
      bad++;
    } else if (d > worst) worst = d;
  }
}
console.log(`${programs.length} programs (${errors} rejected by both), ${compared} values compared, ${bad} differ, worst rounding difference ${worst.toExponential(1)}`);
console.log(`${PLACES.length} clip option cases, ${placeBad} differ`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(bad || placeBad ? 1 : 0);
