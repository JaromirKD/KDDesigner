// Writes the two test shows for a day with a Pharos LPC 1 next to the controller:
//   tools/lpc/compare/project.json      the KD side of PHAROS-COMPARISON-PLAN.md (section 3): one
//                                       universe, the same small show you build by hand on the LPC
//   tools/lpc/device-test/project.json  the LPC as a show device: every "pharos" command as a
//                                       trigger to fire, variables that follow it, and triggers the
//                                       LPC can set off (UDP, OSC, Art-Net / sACN in)
//   node tools/lpc/make-lpc-shows.js [--pc 172.16.1.238] [--lpc 172.16.1.50] [--lpcport 5000]
// --pc = the PC that captures Art-Net and gets the UDP answers, --lpc = the LPC's address,
// --lpcport = the port the LPC's own UDP / OSC triggers listen on.
// Don't edit the json by hand: change this script and run it again, then
//   node tools/check-project.js tools/lpc/compare/project.json   (and device-test)
// Open one in the mock:  node tools/mock-server.js 8081 tools/lpc/compare
// Put one on the board:  node tools/stress/stress.js <ip> load tools/lpc/compare/project.json
// (that replaces the project on the stick: save the board's own with GET /api/project first).
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : args[i + 1]; };
const PC = opt('pc', '172.16.1.238');
const LPC = opt('lpc', '172.16.1.50');
const LPC_PORT = +opt('lpcport', 5000);

const settings = (fps) => ({
  dateOrder: 'dmy', tzOffsetMin: 60, udpPort: 4000, sacnPriority: 100,
  monitor: { interval: 10, timeout: 1000, failures: 2 },
  time: { ntp: 'pool.ntp.org', ntpEnabled: true, dst: 'eu' },
  outputs: { dmx: true, artnet: true, sacn: false, dmxFps: fps, artnetFps: fps, sacnFps: fps,
             artnetChangesOnly: false, sacnChangesOnly: false },
});

// Trigger list helpers: ids in list order, separators from 10001 (as the editor numbers them).
function triggerList() {
  const list = [];
  let id = 0, sep = 10000, color = 'blue';
  return {
    list,
    sec(name, col, notes) { color = col; list.push({ id: ++sep, name, type: 'comment', color, actions: [], conditions: [], ...(notes ? { notes } : {}) }); },
    trig(name, type, fields, actions, notes) { list.push({ id: ++id, name, type, ...fields, color, actions, conditions: [], ...(notes ? { notes } : {}) }); },
  };
}

function write(folder, p) {
  const file = path.join(__dirname, folder, 'project.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(p, null, 1));
  console.log(`${path.relative(process.cwd(), file)}: ${p.fixtures.length} fixtures, ${p.timelines.length} timelines, ` +
              `${p.triggers.filter((t) => t.type !== 'comment').length} triggers, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}

const EFFECTS = [
  // One colour cycle every 2 s (speed 0.5), one rainbow over the 170 pixels.
  { id: 1, name: 'Rainbow', code: 'param speed = 0.5 [0, 2]\nr, g, b = hsv(t * speed + u, 1, 1)' },
  { id: 2, name: 'Chase', code: 'param speed = 0.5 [0, 4]\npos = fract(t * speed)\nd = abs(fract(u - pos + 0.5) - 0.5)\nk = smoothstep(0.1, 0, d)\nr = k\ng = k\nb = k' },
  { id: 3, name: 'Sparkle', code: 'param speed = 1 [0, 4]\nsp = noise(u * 40 + t * speed * 3)\nk = smoothstep(0.6, 0.9, sp)\nr = k\ng = k * 0.8\nb = k * 0.5' },
];

// ---------- 1. comparison show (PHAROS-COMPARISON-PLAN.md section 3) ----------
function compareShow() {
  const fixtures = [];
  for (let k = 0; k < 170; k++) fixtures.push({ id: k + 1, name: 'Pixel ' + (k + 1), channels: ['r', 'g', 'b'], universe: 1, address: 1 + k * 3 });
  const all = (v) => fixtures.flatMap((f) => ['r', 'g', 'b'].map((ch) => ({ fixture: f.id, ch, v })));
  const groups = [{ id: 1, name: 'All pixels', fixtures: fixtures.map((f) => f.id) }];
  const fxTimeline = (id, name, effect, priority, group) => ({
    id, name, length: 60000, loop: true, priority, ...(group ? { group } : {}),
    tracks: [{ name: 'Pixels', fixtures: [], groups: [1] }],
    cues: [{ t: 0, track: 0, fade: 0, effect, params: {}, dim: 100 }],
  });
  // S5: an hour, every minute channel 1 (pixel 1 red) gets the minute number (1 at the start, 60 in the
  // last minute), without a fade: the capture shows when each cue really came.
  const hour = { id: 4, name: 'Hour (S5)', length: 3600000, loop: false, end: 'release', endFade: 0, priority: 5,
    tracks: [{ name: 'Channel 1', fixtures: [1], groups: [] }], cues: [] };
  for (let m = 0; m < 60; m++) hour.cues.push({ t: m * 60000, track: 0, fade: 0, dim: 100, color: '#' + (m + 1).toString(16).padStart(2, '0') + '0000' });

  const T = triggerList();
  T.sec('== SHOW', 'green', 'Section 3 of PHAROS-COMPARISON-PLAN.md. Build the same on the LPC. Everything listens on UDP port 4000.');
  T.trig('Startup: rainbow (S8)', 'startup', {}, ['start timeline "Rainbow (S4)"']);
  T.trig('UDP GO: snap to Full (S6)', 'udp', { match: 'GO' }, ['scene Full']);
  T.trig('UDP OFF: snap to Off (S6)', 'udp', { match: 'OFF' }, ['scene Off']);
  T.trig('UDP FADEUP: Off to Full in 10 s (S3)', 'udp', { match: 'FADEUP' }, ['scene Full fade 10']);
  T.trig('UDP FADEDOWN: Full to Off in 10 s', 'udp', { match: 'FADEDOWN' }, ['scene Off fade 10']);
  T.trig('UDP PING: answer PONG (S7)', 'udp', { match: 'PING*' }, ['reply PONG {1}'], 'For the round trip (T5): "PING 17" comes back as "PONG 17".');
  T.trig('Contact in0: snap to Full (S9)', 'input', { io: 'in0', edge: 'rising' }, ['scene Full'], 'Machine Control input 0. Only if the LPC has a contact wired too.');
  T.sec('== SWITCHING BETWEEN TESTS', 'orange');
  T.trig('UDP STOP: everything released', 'udp', { match: 'STOP' }, ['release all']);
  T.trig('UDP FX1: rainbow only (T2, T8)', 'udp', { match: 'FX1' }, ['release all', 'start timeline "Rainbow (S4)"']);
  T.trig('UDP FX2: + chase on top (T8)', 'udp', { match: 'FX2' }, ['start timeline "Rainbow (S4)"', 'start timeline "Chase on top"', 'master timeline "Chase on top" 50']);
  T.trig('UDP FX3: + sparkle on top (T8)', 'udp', { match: 'FX3' }, ['fire trigger "UDP FX2: + chase on top (T8)"', 'start timeline "Sparkle on top"', 'master timeline "Sparkle on top" 50']);
  T.trig('UDP HOUR: start the 1 hour timeline (S5)', 'udp', { match: 'HOUR' }, ['release all', 'start timeline "Hour (S5)"', 'send udp pc 9001 HOUR started']);
  T.trig('Clock: UDP to the PC at 12:00:00 (T7)', 'time', { at: '12:00:00' }, ['send udp pc 9001 NOON'], 'Change the time to a few minutes from now; the capture shows how far off the real time it came.');
  T.sec('== FOR tools/stress/stress.js', 'grey', 'The same names as the stress show, so "echo" and "udpin" of stress.js run on this show too. Ten counters: one trigger fires at most 100 times a second.');
  T.trig('Echo', 'udp', { match: 'E*' }, ['reply E {1}']);
  for (let k = 0; k < 10; k++) T.trig('Count A' + k, 'udp', { match: `A${k}*` }, ['var hits ++']);

  return {
    name: 'LPC comparison', settings: settings(40), network: { dhcp: true },
    universes: [{ id: 1, name: 'Test', dmxPort: 1, artnet: 0, artnetDest: PC, sacn: 1, useDmx: true, useArtnet: true, useSacn: false }],
    fixtures, groups,
    scenes: [{ id: 1, name: 'Off', levels: all(0) }, { id: 2, name: 'Full', levels: all(255) }],
    effects: EFFECTS,
    timelines: [fxTimeline(1, 'Rainbow (S4)', 1, 0, 'A'), fxTimeline(2, 'Chase on top', 2, 1), fxTimeline(3, 'Sparkle on top', 3, 2), hour],
    devices: [{ name: 'pc', ip: PC, port: 9001 }],
    variables: [{ name: 'hits', type: 'number', initial: 0 }],
    triggers: T.list,
  };
}

// ---------- 2. the LPC as a show device ----------
function deviceShow() {
  const fixtures = [];
  for (let k = 0; k < 8; k++) fixtures.push({ id: k + 1, name: 'Par ' + (k + 1), channels: ['r', 'g', 'b'], universe: 1, address: 1 + k * 3 });
  const all = (r, g, b) => fixtures.flatMap((f) => [{ fixture: f.id, ch: 'r', v: r }, { fixture: f.id, ch: 'g', v: g }, { fixture: f.id, ch: 'b', v: b }]);
  const T = triggerList();
  const cmd = (name, ...actions) => T.trig(name, 'manual', {}, actions);

  T.sec('== KD -> LPC: every command once', 'purple', 'Fire them one by one (▶ on the row) and look at the LPC: its web page, Designer 2\'s network view or its lights. Timelines 1-2, scenes 1-2, group 1 and trigger 1 must exist in the LPC\'s project.');
  cmd('Timeline 1 start', 'pharos lpc timeline 1 start');
  cmd('Timeline 1 start, fade 3', 'pharos lpc timeline 1 start fade 3');
  cmd('Timeline 1 pause', 'pharos lpc timeline 1 pause');
  cmd('Timeline 1 resume', 'pharos lpc timeline 1 resume');
  cmd('Timeline 1 rate 0.5', 'pharos lpc timeline 1 rate 0.5');
  cmd('Timeline 1 rate 1', 'pharos lpc timeline 1 rate 1');
  cmd('Timeline 1 position 50 %', 'pharos lpc timeline 1 position 50');
  cmd('Timeline 1 toggle', 'pharos lpc timeline 1 toggle');
  cmd('Timeline 1 release, fade 2', 'pharos lpc timeline 1 release fade 2');
  cmd('Timeline 2 start', 'pharos lpc timeline 2 start');
  cmd('Scene 1 start', 'pharos lpc scene 1 start');
  cmd('Scene 1 toggle', 'pharos lpc scene 1 toggle');
  cmd('Scene 1 release, fade 2', 'pharos lpc scene 1 release fade 2');
  cmd('Scene 2 start, fade 3', 'pharos lpc scene 2 start fade 3');
  cmd('Group 1 master 50 %, fade 2', 'pharos lpc group 1 master 50 fade 2');
  cmd('Group 1 master 100 %', 'pharos lpc group 1 master 100');
  cmd('LPC trigger 1', 'pharos lpc trigger 1');
  cmd('Text slot "Title"', 'pharos lpc text Title Hello from KD');
  cmd('Override group 1 intensity 30 %', 'pharos lpc override group 1 intensity 30');
  cmd('Override fixture 1 orange, fade 2', 'pharos lpc override fixture 1 color #ff8800 fade 2');
  cmd('Clear overrides', 'pharos lpc clear overrides');
  cmd('Art-Net output off', 'pharos lpc output art-net off');
  cmd('Art-Net output on', 'pharos lpc output art-net on');
  cmd('Beacon on', 'pharos lpc beacon on');
  cmd('Beacon off', 'pharos lpc beacon off');
  cmd('API: get system', 'pharos lpc api get system');
  cmd('API: start timeline 1 with raw JSON', 'pharos lpc api post timeline {"action":"start","num":1}');
  cmd('Release all, fade 2', 'pharos lpc release all fade 2');
  cmd('Four commands at once', 'pharos lpc timeline 1 start', 'pharos lpc timeline 2 start', 'pharos lpc group 1 master 80', 'pharos lpc scene 1 start');
  cmd('Ten commands a second for 5 s', 'repeat 50 times every 0.1 pharos lpc group 1 master {=i*2}');
  cmd('UDP to the LPC', `send udp lpcnet ${LPC_PORT} KD GO`);
  cmd('OSC to the LPC', `send osc lpcnet ${LPC_PORT} /kd/go 1`);

  T.sec('== LPC -> KD: what the KD sees', 'cyan', 'The pars turn green / blue / red, so it shows without the log too. Start and release things on the LPC itself (its web page or Designer 2).');
  T.trig('LPC timeline 1 changed', 'variable', { variable: 'lpc_tl1' }, ['log LPC timeline 1 is now {value} (was {old})', 'if var lpc_tl1 = running then scene Green fade 1 else scene Blue fade 1']);
  T.trig('LPC timeline 2 changed', 'variable', { variable: 'lpc_tl2' }, ['log LPC timeline 2 is now {value} (was {old})']);
  T.trig('LPC scene 1 changed', 'variable', { variable: 'lpc_sc1' }, ['log LPC scene 1 is now {value} (was {old})']);
  T.trig('LPC group 1 level changed', 'variable', { variable: 'lpc_grp1' }, ['log LPC group 1 is now {value} %']);
  T.trig('LPC offline', 'device', { device: 'lpc', state: 'offline' }, ['log LPC is offline', 'scene Red']);
  T.trig('LPC back online', 'device', { device: 'lpc', state: 'online' }, ['log LPC is back online', 'scene Blue fade 2']);

  T.sec('== LPC -> KD: triggers the LPC sets off', 'orange', 'On the LPC: a trigger with a UDP or OSC action to the KD\'s address, and Art-Net / sACN output to the KD.');
  T.trig('UDP "LPC <text>" (port 4000)', 'udp', { match: 'LPC*' }, ['log UDP from the LPC ({sender_ip}): {1}', 'var from_lpc ++', 'reply KD got {1}']);
  T.trig('OSC /lpc/* (port 8000)', 'osc', { address: '/lpc/*', port: 8000 }, ['log OSC from the LPC: {address} {1}', 'var from_lpc ++']);
  T.trig('Art-Net universe 0, channel 1 above 50 %', 'dmx_in', { protocol: 'artnet', universe: 0, channels: '1', when: 'above', level: 128 }, ['log Art-Net in: channel 1 above 50 %', 'scene Green']);
  T.trig('Art-Net universe 0, channel 2 = grand master', 'dmx_in', { protocol: 'artnet', universe: 0, channels: '2', when: 'change' }, ['grandmaster {=round(value/2.55)}']);
  T.trig('sACN universe 1, channel 1 above 50 %', 'dmx_in', { protocol: 'sacn', universe: 1, channels: '1', when: 'above', level: 128 }, ['log sACN in: channel 1 above 50 %', 'scene Blue']);

  T.sec('== KD lights', 'green');
  T.trig('Startup', 'startup', {}, ['scene Blue', 'grandmaster 100']);
  cmd('Rainbow on the pars', 'start timeline Rainbow');
  cmd('Release all', 'release all fade 1');

  return {
    name: 'LPC device test', settings: settings(40), network: { dhcp: true },
    // Art-Net universe 10 out, so what the LPC sends in on universe 0 can't be mixed up with it.
    universes: [{ id: 1, name: 'Pars', dmxPort: 1, artnet: 10, artnetDest: PC, sacn: 10, useDmx: true, useArtnet: true, useSacn: false }],
    fixtures, groups: [{ id: 1, name: 'All pars', fixtures: fixtures.map((f) => f.id) }],
    scenes: [{ id: 1, name: 'Off', levels: all(0, 0, 0) }, { id: 2, name: 'Red', levels: all(255, 0, 0) },
             { id: 3, name: 'Green', levels: all(0, 255, 0) }, { id: 4, name: 'Blue', levels: all(0, 0, 255) }],
    effects: [EFFECTS[0]],
    timelines: [{ id: 1, name: 'Rainbow', length: 60000, loop: true, priority: 0, tracks: [{ name: 'Pars', fixtures: [], groups: [1] }],
                  cues: [{ t: 0, track: 0, fade: 1000, effect: 1, params: {}, dim: 100 }] }],
    devices: [{ name: 'pc', ip: PC, port: 9001 }, { name: 'lpcnet', ip: LPC, port: LPC_PORT }],
    variables: ['lpc_tl1', 'lpc_tl2', 'lpc_sc1'].map((name) => ({ name, type: 'text', initial: '' }))
      .concat([{ name: 'lpc_grp1', type: 'number', initial: 0 }, { name: 'from_lpc', type: 'number', initial: 0 }]),
    drivers: [{ id: 1, type: 'pharos', name: 'lpc', ip: LPC, port: 80, user: '', password: '', live: true,
                vars: { tl1: 'lpc_tl1', tl2: 'lpc_tl2', sc1: 'lpc_sc1', grp1: 'lpc_grp1' } }],
    triggers: T.list,
  };
}

write('compare', compareShow());
write('device-test', deviceShow());
