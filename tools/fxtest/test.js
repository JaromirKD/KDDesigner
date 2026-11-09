// Checks the firmware's effect engine (src/Fx.cpp) against the browser's (data/www/fx.js):
//   node tools/fxtest/test.js
// Builds Fx.cpp with the PC's own compiler in WSL (Ubuntu: g++), runs every effect template
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
];

const programs = [...fx.TEMPLATES.map((t) => t.code), ...EXTRA];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fxtest-'));
for (const f of ['src/Fx.cpp', 'src/Fx.h', 'tools/fxtest/fxtest.cpp', 'tools/fxtest/shim/Arduino.h', 'tools/fxtest/shim/BigRam.h'])
  fs.copyFileSync(path.join(ROOT, f), path.join(tmp, path.basename(f)));
fs.writeFileSync(path.join(tmp, 'programs.txt'), programs.map((p) => p.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')).join('\n') + '\n');
const wslPath = '/mnt/' + tmp[0].toLowerCase() + tmp.slice(2).replace(/\\/g, '/');
let out;
try {
  out = execFileSync('wsl', ['-d', 'Ubuntu-22.04', '--', 'bash', '-c',
    `cd '${wslPath}' && g++ -std=c++14 -O2 -Wall -Wno-unused-function -I. -o fxtest fxtest.cpp Fx.cpp && ./fxtest < programs.txt`],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 << 20 });
} catch (e) {
  console.error('FAILED: build or run (see above), or the fast path differs from the plain interpreter');
  process.exit(1);
}

const times = [0, 0.37, 1.5, 12.25, 333.333, 3600.1, 259200.7];
const n = 9;
const toD = (hex) => { const b = Buffer.from(hex, 'hex'); return b.readDoubleBE(0); };
let worst = 0, bad = 0, compared = 0, errors = 0;
for (const line of out.trim().split('\n')) {
  const w = line.split(' ');
  const k = +w[0];
  if (w[1] === 'E') {
    let jsErr = null;
    try { fx.compile(programs[k]); } catch (e) { jsErr = e.message; }
    if (!jsErr) { console.log(`program ${k}: firmware says "${w.slice(2).join(' ')}", fx.js compiles it`); bad++; }
    errors++;
    continue;
  }
  const f = +w[1], i = +w[2];
  const prog = fx.compile(programs[k]);
  const s = fx.slotsFor(prog);
  s[0] = times[f]; s[1] = i; s[2] = n; s[3] = i / n; s[4] = i * 0.13; s[5] = 1 - i * 0.11;
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
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
