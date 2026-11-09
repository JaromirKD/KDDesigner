// Writes a stress-test show: every universe full of RGB fixtures running effects, Art-Net
// unicast to a PC (and sACN on universes 901+), plus triggers that the PC tool
// (tools/stress/stress.js) hammers with UDP / OSC and that send bursts back.
//   node tools/stress/make-stress.js <out.json> [--pc 172.16.1.238] [--universes 8] [--fps 40]
//        [--sacn] [--dummies 90] [--intervals 0] [--heavy]
// Not for a real venue: it floods the network.
'use strict';
const fs = require('fs');

const args = process.argv.slice(2);
const out = args[0];
if (!out) { console.error('usage: make-stress.js <out.json> [options]'); process.exit(1); }
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : args[i + 1]; };
const flag = (name) => args.includes('--' + name);
const PC = opt('pc', '172.16.1.238');
const UNIS = +opt('universes', 8);
const FPS = +opt('fps', 40);
const DUMMIES = +opt('dummies', 90);       // UDP triggers that never match: every packet is checked against them
const INTERVALS = +opt('intervals', 0);    // interval triggers at 20 ms each (50 fires/s each)
const PER_UNI = 170;                        // RGB fixtures per universe (510 channels)

const p = {
  name: 'Stress test',
  settings: {
    tzOffsetMin: 60, udpPort: 4000, sacnPriority: 100,
    monitor: { interval: 60, timeout: 1000, failures: 2 },
    time: { ntp: 'pool.ntp.org', ntpEnabled: true, dst: 'eu' },
    outputs: { dmx: true, artnet: true, sacn: flag('sacn'), dmxFps: 40, artnetFps: FPS, sacnFps: FPS,
               artnetChangesOnly: false, sacnChangesOnly: false },
  },
  network: { dhcp: true },
  universes: [], fixtures: [], groups: [], scenes: [], timelines: [], effects: [],
  devices: [{ name: 'pc', ip: PC, port: 9001 }],
  tcp: [{ name: 'pctcp', ip: PC, port: 9100, eol: '\\n' }],
  triggers: [], variables: [],
};

let fid = 1;
for (let u = 1; u <= UNIS; u++) {
  p.universes.push({ id: u, name: 'U' + u, dmxPort: u === 1 ? 1 : 0, artnet: u - 1, artnetDest: PC, sacn: 900 + u,
                     useDmx: u === 1, useArtnet: true, useSacn: true });
  const ids = [];
  for (let k = 0; k < PER_UNI; k++) {
    p.fixtures.push({ id: fid, name: `U${u} px ${k + 1}`, channels: ['r', 'g', 'b'], universe: u, address: 1 + k * 3 });
    ids.push(fid++);
  }
  p.groups.push({ id: u, name: 'Uni ' + u, fixtures: ids });
}

p.effects = [
  { id: 1, name: 'Rainbow', code: 'param speed = 0.2 [0, 2]\nr, g, b = hsv(t * speed + u * 2, 1, 1)' },
  { id: 2, name: 'Chase', code: 'param speed = 0.5 [0, 4]\npos = fract(t * speed)\nd = abs(fract(u - pos + 0.5) - 0.5)\nk = smoothstep(0.1, 0, d)\nr = k\ng = k * 0.5\nb = 1 - k' },
  // Heavier: noise + several functions per fixture, to load the effect VM.
  { id: 3, name: 'Heavy', code: 'param speed = 1 [0, 4]\nn1 = noise(u * 8 + t * speed)\nn2 = noise(u * 3 - t * speed * 0.7)\nk = smoothstep(0.2, 0.8, n1 * n2 * 2)\nh = fract(t * 0.05 + u + sin(t + u * 6) * 0.1)\nr, g, b = hsv(h, clamp(n2 + 0.3, 0, 1), k)\ndim = mix(0.4, 1, tri(t * 0.3 + u))' },
];
const fxFor = (u) => (flag('heavy') ? 3 : [1, 2, 3][(u - 1) % 3]);

// One timeline, one track per universe, each with an effect over that universe's group.
p.timelines.push({
  id: 1, name: 'Stress FX', length: 60000, loop: true, priority: 0, group: 'A',
  tracks: p.groups.map((g) => ({ name: g.name, fixtures: [], groups: [g.id] })),
  cues: p.groups.map((g, i) => ({ t: 0, track: i, fade: 0, effect: fxFor(g.id), params: { speed: 0.3 + i * 0.1 }, dim: 100 })),
});
// A second timeline crossfading two full scenes on top (priority 1, half master): composes 2 playbacks.
const allLevels = (v) => p.fixtures.flatMap((f) => ['r', 'g', 'b'].map((ch) => ({ fixture: f.id, ch, v })));
p.scenes.push({ id: 1, name: 'All half', levels: allLevels(128) });
p.scenes.push({ id: 2, name: 'All low', levels: allLevels(20) });
p.timelines.push({
  id: 2, name: 'Stress scenes', length: 4000, loop: true, priority: 1, group: 'B',
  tracks: [{ name: 'All', fixtures: [], groups: [] }],
  cues: [{ t: 0, fade: 2000, scene: 1 }, { t: 2000, fade: 2000, scene: 2 }],
});

let tid = 1;
const trig = (o) => p.triggers.push(Object.assign({ id: tid++, color: 'blue', conditions: [] }, o));
p.variables.push(...['hits', 'osc', 'ticks', 'echo'].map((name) => ({ name, type: 'number', initial: 0 })));

trig({ name: 'Startup', type: 'startup', actions: ['start timeline "Stress FX"', 'start timeline "Stress scenes"', 'master timeline "Stress scenes" 50'] });
// Echo: answers each "E <n>" to the sender (latency + round-trip rate).
trig({ name: 'Echo', type: 'udp', match: 'E*', actions: ['reply E {1}'] });
// Counting: 10 triggers so the rate isn't capped by the 100 fires/s feedback guard of one trigger.
for (let k = 0; k < 10; k++) trig({ name: 'Count A' + k, type: 'udp', match: `A${k}*`, actions: ['var hits ++'] });
// Many triggers that never match: what a big show's trigger list costs per packet.
for (let k = 0; k < DUMMIES; k++) trig({ name: 'Dummy ' + k, type: 'udp', match: `ZZZ${k}`, actions: ['log never'] });
trig({ name: 'OSC count', type: 'osc', address: '/stress/*', port: 8000, actions: ['var osc ++'] });
// Bursts out (fired from the PC tool by name).
trig({ name: 'Burst UDP', type: 'manual', actions: ['repeat 500 times send udp pc 9001 B {i}'] });
trig({ name: 'Burst OSC', type: 'manual', actions: ['repeat 500 times send osc pc 9002 /burst {i}'] });
trig({ name: 'Burst TCP', type: 'manual', actions: ['repeat 100 times send tcp pctcp T {i}'] });
trig({ name: 'Burst HTTP', type: 'manual', actions: ['repeat 30 times http get http://' + PC + ':9200/h{i}'] });
// Paced stream out: one packet every 10 ms through a scheduled repeat.
trig({ name: 'Stream UDP', type: 'manual', actions: ['repeat 1000 times every 0.01 send udp pc 9001 S {i}'] });
for (let k = 0; k < INTERVALS; k++) trig({ name: 'Tick ' + k, type: 'interval', seconds: 0.02, actions: ['var ticks ++'] });

fs.writeFileSync(out, JSON.stringify(p));
console.log(`${out}: ${UNIS} universes, ${p.fixtures.length} fixtures, ${p.triggers.length} triggers, ${FPS} fps, ` +
            `sACN ${flag('sacn') ? 'on' : 'off'}, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
