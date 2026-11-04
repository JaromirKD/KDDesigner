// Builds the "Feature demo" project (examples/feature-demo) that uses every feature of KD Designer.
// Usage: node tools/make-demo.js [out project.json]   (default examples/feature-demo/project.json)
// Add new features here too, then run it and `node tools/check-project.js examples/feature-demo/project.json`.
'use strict';
const fs = require('fs'), path = require('path');
const repo = path.join(__dirname, '..');
const out = process.argv[2] || path.join(repo, 'examples', 'feature-demo', 'project.json');
const FX = require(path.join(repo, 'data', 'www', 'fx.js'));

// ---------- fixtures ----------
const fixtures = [];
let fid = 0;
const fx = (name, universe, address, channels, extra = {}) => { const f = { id: ++fid, name, universe, address, channels, ...extra }; fixtures.push(f); return f.id; };
const FOH_L = fx('FOH left', 1, 1, ['dim'], { curve: 'square', icon: 'profile' });
const FOH_R = fx('FOH right', 1, 2, ['dim'], { curve: 'square', icon: 'profile' });
const HOUSE = fx('House light', 1, 3, ['dim'], { curve: 'preheat10', icon: 'dimmer' });
const WORK = fx('Work light', 1, 4, ['dim'], { curve: 'nondim', icon: 'relay' });
const walls = [];
for (let k = 0; k < 4; k++) walls.push(fx(`Wall wash ${k + 1}`, 1, 10 + k * 5, ['dim', 'r', 'g', 'b', 'w'], { icon: 'wash' }));
const movers = [];
for (let k = 0; k < 2; k++) movers.push(fx(`Mover ${k ? 'right' : 'left'}`, 1, 40 + k * 16, ['dim', 'r', 'g', 'b', 'pan:16', 'tilt:16', 'shutter=255', 'zoom', 'gobo'], { icon: 'spot' }));
const FOG = fx('Fog machine', 1, 80, ['fog', 'fan'], { icon: 'fog' });
const STROBE = fx('Strobe', 1, 85, ['dim', 'strobe'], { icon: 'strobe' });
const pars = [];
for (let k = 0; k < 8; k++) pars.push(fx(`Circle par ${k + 1}`, 1, 100 + k * 4, ['dim', 'r', 'g', 'b'], { icon: 'par' }));
const vitrine = [];
for (let k = 0; k < 4; k++) vitrine.push(fx(`Vitrine cell ${k + 1}`, 1, 140 + k * 3, ['r', 'g', 'b'], { icon: 'pixel', type: 'Museum / Vitrine LED strip', mode: '4 cells' }));
const pixels = [];
for (let k = 0; k < 32; k++) pixels.push(fx(`Pixel ${k + 1}`, 2, 1 + k * 3, ['r', 'g', 'b'], { icon: 'pixel' }));
const WINCH = fx('Winch', 3, 1, ['pos:16', 'speed'], { icon: 'motor' });
const SCREEN = fx('Projector shutter', 3, 10, ['shutter'], { icon: 'screen' });
// Plain channel names are fine in the firmware; the home value notation is UI-only, so strip it.
for (const f of fixtures) f.channels = f.channels.map((c) => c.replace(/=.*/, ''));

const groups = [
  { id: 1, name: 'FOH', fixtures: [FOH_L, FOH_R] },
  { id: 2, name: 'Walls', fixtures: walls },
  { id: 3, name: 'Movers', fixtures: movers },
  { id: 4, name: 'Circle', fixtures: pars },
  { id: 5, name: 'Pixel grid', fixtures: pixels },
  { id: 6, name: 'Vitrine', fixtures: vitrine },
  { id: 7, name: 'All colour', fixtures: [...walls, ...pars, ...pixels] },
];

// ---------- maps ----------
const stage = [
  [FOH_L, 0.3, 0.85], [FOH_R, 0.7, 0.85], [HOUSE, 0.5, 0.95], [WORK, 0.5, 0.06],
  [walls[0], 0.06, 0.25], [walls[1], 0.06, 0.6], [walls[2], 0.94, 0.25], [walls[3], 0.94, 0.6],
  [movers[0], 0.35, 0.35], [movers[1], 0.65, 0.35], [FOG, 0.2, 0.12], [STROBE, 0.8, 0.12],
  ...vitrine.map((f, k) => [f, 0.4 + k * 0.067, 0.6]),
];
const grid = pixels.map((f, k) => { const row = Math.floor(k / 8), col = row % 2 ? 7 - (k % 8) : k % 8; return [f, 0.1 + col * 0.114, 0.15 + row * 0.233]; });
const circle = pars.map((f, k) => { const a = (k / 8) * Math.PI * 2 - Math.PI / 2; return [f, 0.5 + 0.38 * Math.cos(a), 0.5 + 0.38 * Math.sin(a)]; });
const map = (id, name, aspect, items) => ({ id, name, aspect, background: '', snap: true, labels: true, items: items.map(([fixture, x, y]) => ({ fixture, x: +x.toFixed(4), y: +y.toFixed(4) })) });
const maps = [map(1, 'Stage plan', 1.5, stage), map(2, 'Pixel grid 8 x 4', 2, grid), map(3, 'Circle', 1, circle)];

// ---------- scenes ----------
const L = (ids, ch, v) => ids.map((fixture) => ({ fixture, ch, v }));
const colour = (ids, r, g, b, dim = 255) => [...L(ids, 'dim', dim), ...L(ids, 'r', r), ...L(ids, 'g', g), ...L(ids, 'b', b)];
const scenes = [
  { id: 1, name: 'Work light', levels: [...L([WORK, HOUSE], 'dim', 255)] },
  { id: 2, name: 'Pre-show warm', levels: [...L([HOUSE], 'dim', 180), ...L([FOH_L, FOH_R], 'dim', 90), ...colour(walls, 255, 140, 40, 200), ...L(walls, 'w', 60)] },
  { id: 3, name: 'Show blue', levels: [...L([FOH_L, FOH_R], 'dim', 255), ...colour(walls, 0, 40, 255), ...colour(pars, 0, 80, 255, 180)] },
  { id: 4, name: 'Movers centre', levels: [...colour(movers, 255, 255, 255), ...L(movers, 'pan', 32768), ...L(movers, 'tilt', 32768), ...L(movers, 'shutter', 255), ...L(movers, 'zoom', 128)] },
  { id: 5, name: 'Pixels red', levels: [...L(pixels, 'r', 255)] },
  { id: 6, name: 'Emergency', levels: [...L([WORK, HOUSE, FOH_L, FOH_R], 'dim', 255)] },
  { id: 7, name: 'Winch up + raw channel', levels: [{ fixture: WINCH, ch: 'pos', v: 52000 }, { fixture: WINCH, ch: 'speed', v: 128 }, { universe: 3, ch: 20, v: 255 }] },
  { id: 8, name: 'Finale', levels: [...colour(walls, 255, 0, 160), ...colour(pars, 255, 200, 0), ...L([FOH_L, FOH_R], 'dim', 255), ...L([STROBE], 'dim', 255), ...L([STROBE], 'strobe', 200)] },
];

// ---------- effects: every base effect + one of our own ----------
const effects = FX.TEMPLATES.map((t, k) => ({ id: k + 1, name: t.name, code: t.code }));
const fxId = (name) => effects.find((e) => e.name === name).id;
effects.push({ id: effects.length + 1, name: 'Vitrine shimmer (own)', code:
`// Our own effect: a slow warm shimmer for the showcase
param speed = 0.3 [0, 2]       // shimmer waves per second
param color = #ffb070          // base colour
param depth = 0.4 [0, 1]       // how deep the shimmer dips
k = 1 - depth * (0.5 + 0.5 * sin((u * 2 + t * speed) * tau))
r, g, b = color
dim = k * (0.8 + 0.2 * noise(t * 3 + i))` });

// ---------- timelines ----------
const timelines = [
  { id: 1, name: 'Inloop', length: 30000, loop: true, priority: 0, group: 'A',
    tracks: [{ name: 'Base', fixtures: [], groups: [] }, { name: 'Walls', fixtures: [], groups: [2] }, { name: 'Pixels', fixtures: [], groups: [5] },
      { name: 'Circle', fixtures: [], groups: [4] }, { name: 'Vitrine', fixtures: [], groups: [6] }],
    cues: [
      { t: 0, fade: 3000, scene: 2, path: 'damped' },
      { t: 0, track: 1, fade: 2000, effect: fxId('Breathe'), params: { speed: 0.1, color: '#ff9040' }, dim: 100 },
      { t: 0, track: 2, fade: 2000, len: 15000, out: 2000, effect: fxId('XY plasma'), params: {}, dim: 80 },
      { t: 15000, track: 2, fade: 2000, len: 15000, out: 2000, effect: fxId('Wave across the map'), params: {}, dim: 80 },
      { t: 0, track: 3, fade: 1000, effect: fxId('Chase'), params: { speed: 0.5 }, dim: 100 },
      { t: 0, track: 4, fade: 2000, effect: effects.length, params: {}, dim: 100 },
    ] },
  { id: 2, name: 'Main show', length: 60000, loop: false, priority: 0, group: 'A',
    tracks: [{ name: 'Scenes', fixtures: [], groups: [] }, { name: 'Walls', fixtures: [], groups: [2] }, { name: 'Movers', fixtures: [], groups: [3] },
      { name: 'Pixels', fixtures: [], groups: [5] }, { name: 'Strobe', fixtures: [STROBE], groups: [] }],
    cues: [
      { t: 0, fade: 4000, scene: 3, path: 'damped' },
      { t: 40000, fade: 3000, scene: 8, path: 'overshoot' },
      { t: 0, track: 1, fade: 2000, len: 10000, out: 2000, dim: 100, color: '#ff3b30', path: 'linear' },
      { t: 10000, track: 1, fade: 3000, len: 10000, out: 3000, dim: 100, color: '#30d158', path: 'accelerated' },
      { t: 20000, track: 1, fade: 3000, len: 15000, out: 3000, dim: 80, color: '#0a84ff', path: 'braked' },
      { t: 35000, track: 1, fade: 1000, effect: fxId('Police'), params: {}, dim: 100 },
      { t: 5000, track: 2, fade: 3000, len: 25000, out: 3000, scene: 4, path: 'damped' },
      { t: 0, track: 3, fade: 2000, len: 20000, out: 2000, effect: fxId('XY ripple'), params: { speed: 0.8, color: '#00c7be' }, dim: 100 },
      { t: 20000, track: 3, fade: 2000, len: 20000, out: 2000, effect: fxId('XY radar'), params: {}, dim: 100 },
      { t: 40000, track: 3, fade: 500, effect: fxId('Rainbow'), params: {}, dim: 100 },
      { t: 50000, track: 4, fade: 0, len: 3000, out: 500, effect: fxId('Strobe'), params: {}, dim: 100 },
      { t: 2000, trigger: 'Show: start video' },
      { t: 30000, trigger: 'Show: halfway' },
    ] },
  { id: 3, name: 'Emergency', length: 0, loop: false, priority: 10, cues: [{ t: 0, fade: 0, scene: 6 }], tracks: [{ name: 'Scenes', fixtures: [], groups: [] }] },
  { id: 4, name: 'Exterior evening', length: 20000, loop: true, priority: 0, group: 'B',
    tracks: [{ name: 'Circle', fixtures: [], groups: [4] }],
    cues: [{ t: 0, fade: 5000, effect: fxId('XY gradient'), params: {}, dim: 70 }] },
  { id: 5, name: 'Winch move', length: 12000, loop: false, priority: 5,
    tracks: [{ name: 'Winch', fixtures: [WINCH], groups: [] }],
    cues: [{ t: 0, fade: 8000, scene: 7, path: 'damped' }] },
];

// ---------- triggers ----------
const triggers = [];
let sep = 10000;
const section = (name, color, notes) => triggers.push({ id: ++sep, name, type: 'comment', color, actions: [], conditions: [], ...(notes ? { notes } : {}) });
let curColor = '';
const trig = (name, type, fields, actions, conditions = [], extra = {}) => triggers.push({ id: 0, name, type, ...fields, color: curColor, actions, conditions, ...extra });
const sec = (name, color, notes) => { curColor = color; section(name, color, notes); };

sec('== START & SAFETY', 'red', 'What happens at power-on and in an emergency. Put the building\'s normal state in Startup: it also runs after a watchdog restart.');
trig('Startup', 'startup', {}, ['mode System Idle', 'panel "Start show" reset', 'panel "Show progress" reset', 'panel "Show progress" value 0', 'fire trigger "Start inloop" after 5'], [], { notes: 'Runs at every start (power on, restart, after saving). Starts the inloop after 5 s.' });
trig('Emergency stop (in0)', 'input', { io: 'in0', edge: 'falling' }, ['mode System Emergency'], [], { notes: 'Machine Control input 0: the emergency-stop loop opens (24 V drops).' });
trig('Mode -> Emergency', 'mode', { group: 'System', mode: 'Emergency' },
  ['start timeline "Emergency"', 'send osc qlab /cue/*/stop', 'panel lbl_status text EMERGENCY STOP', 'panel lbl_status color #ff5c5c', 'io Beacon on', 'email tech@example.com "Emergency stop" The emergency stop was pressed']);
trig('Mode changed -> label', 'mode', {}, ['panel lbl_mode text {group}: {mode}']);
trig('Emergency released', 'input', { io: 'in0', edge: 'rising' }, ['stop timeline "Emergency" fade 3', 'io Beacon off', 'mode System Idle', 'fire trigger "Start inloop"'], ['mode System is Emergency']);

sec('== CLOCK & CALENDAR', 'green', 'Opening hours. The Schedule page shows the next 7 days of these.');
trig('Morning start', 'time', { at: '09:30:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
  ['mode Museum "Starting up"', 'pc all wake', 'projector all on', '# wait for the projector before switching its input', 'wait until device "PJ left" is online timeout 120', 'projector all input 31', 'fire trigger "Start inloop"'],
  ['calendar Closed inactive'], { whileRunning: 'ignore', notes: 'Weekdays 09:30, not on closed days (Schedule > Calendar).' });
trig('Weekend start', 'time', { at: '10:30:00', days: ['sat', 'sun'] }, ['fire trigger "Morning start"'], ['calendar Closed inactive', 'date between 03-01 10-31']);
trig('Closing', 'time', { at: '17:30:00' }, ['release all fade 10', 'projector all off', 'mode Museum Closed', 'sleep 30', 'pc all shutdown']);
trig('Sunset: exterior on', 'time', { at: 'sunset', offset: -15 }, ['start timeline "Exterior evening"'], ['calendar Closed inactive']);
trig('Sunrise: exterior off', 'time', { at: 'sunrise', offset: 30 }, ['stop timeline "Exterior evening" fade 10']);
trig('Summer season (log)', 'time', { at: '09:00:00' }, ['log Summer season: open longer today'], ['calendar Summer active', 'day is sat,sun']);
trig('Poll media server', 'interval', { seconds: 60 }, ['http get http://192.168.1.95/api/status'], ['time between sunrise sunset']);

sec('== SHOW TASK LISTS', 'purple', 'Manual triggers = task lists that other triggers (buttons, UDP, clock) fire by name.');
trig('Start inloop', 'manual', {}, ['mode System Idle', 'start timeline "Inloop"', 'panel lbl_status text Inloop', 'panel lbl_status color #d8dbe2', 'panel "Start show" reset'], ['mode System not Emergency']);
trig('Start main show', 'manual', {},
  ['mode System Show', 'start timeline "Main show"', 'send osc mediaserver /play', 'send udp screens "PLAY\\r"', 'panel "Start show" flash on', 'panel "Start show" text RUNNING', 'panel "Show progress" value 100', 'panel lbl_status text Show is running', 'panel lbl_status color #3ecf8e'],
  ['mode System not Emergency', 'timeline "Main show" stopped'], { whileRunning: 'ignore' });
trig('Show: start video', 'manual', {}, ['send tcp watchout run', 'brightsign lobby send play1', 'brightsign lobby event video_show', 'brightsign lobby var mode show', 'log Video started from timeline {timeline}'], [],
  { notes: 'Fired by a ◆ trigger cue at 2 s on timeline "Main show". The brightsign event/var lines go through the KD plugin (kdlink) in the presentation.' });
trig('Lobby: back to loop', 'manual', {}, ['brightsign lobby play Video loop.mp4', 'brightsign lobby stop Audio'], [], { notes: 'Plays a file directly in a BrightSign zone (KD plugin).' });
trig('Show: halfway', 'manual', {}, ['netio rack output 2 pulse 5', 'pharos lpc timeline 1 start fade 3', 'digidot c4 scene 1 fade 2'], [], { notes: 'Trigger cue at 30 s: shows the show-device commands.' });
trig('Main show finished', 'timeline_end', { timeline: 2 }, ['var show_count += 1', 'log Show {show_count} finished', 'fire trigger "Start inloop"']);
trig('Stop all', 'manual', {}, ['mode System Idle', 'release all fade 3', 'send osc qlab /cue/*/stop', 'send udp screens "STOP\\r"', 'panel "Start show" reset', 'panel lbl_status text Stopped', 'panel lbl_status color #ff9f43']);
trig('Flash walls once', 'manual', {}, ['set 1.10-29 255', 'sleep 0.2', 'clear override 1.10-29'], [], { notes: 'Used by "Flash walls 6x": {count} is the round.' });
trig('Flash walls 6x', 'manual', {}, ['repeat "Flash walls once" 6 times every 0.5', 'log Walls flashed 6 times']);
trig('Relay chase', 'manual', {}, ['repeat 4 times every 0.5 kissbox io 1.{i} on', 'sleep 1', 'kissbox io 1 all 0 0 0 0 0 0 0 0']);
trig('Step through scenes', 'manual', {}, ['log Step {count}', 'scene {=1+count%3} fade 1'], [], { notes: 'Fired with repeat by the Teststand button: {count} = 1, 2, 3…' });
trig('Winch up', 'manual', {}, ['start timeline "Winch move"'], ['io in2 is on'], { notes: 'Only when the safety contact (in2) is closed.' });

sec('== TOUCH PANEL', 'cyan', 'Every kind of panel event: click, hold, double click, change (slider, dial, colour, XY, toggle).');
trig('CLICK Start show', 'panel', { control: 'Start show', event: 'click' }, ['fire trigger "Start main show"'], ['mode System is Idle'], { cooldown: 30, notes: 'Visitor button: 30 s cooldown so pressing it again does nothing.' });
trig('CLICK Inloop', 'panel', { control: 'Inloop', event: 'click' }, ['fire trigger "Start inloop"']);
trig('CLICK Stop', 'panel', { control: 'Stop', event: 'click' }, ['fire trigger "Stop all"']);
trig('HOLD All off (3 s)', 'panel', { control: 'All off', event: 'hold', hold: 3 }, ['release all fade 0', 'io all off', 'netio rack output all off', 'log All off by long press']);
trig('DOUBLE Blackout', 'panel', { control: 'Blackout', event: 'double', within: 0.5 }, ['if var blackout = on then blackout off else blackout on', 'var blackout toggle']);
trig('House level slider', 'panel', { control: 'House level', event: 'change' }, ['set 1.3 {=round(value*2.55)}']);
trig('Grand master dial', 'panel', { control: 'Grand master', event: 'change' }, ['grandmaster {value}']);
trig('Wall colour wheel', 'panel', { control: 'Wall colour', event: 'change' }, ['set 1.11 {r}', 'set 1.12 {g}', 'set 1.13 {b}']);
trig('Mover XY pad', 'panel', { control: 'Mover position', event: 'change' }, ['set 1.45 {=round(x*2.55)}', 'set 1.47 {=round(y*2.55)}']);
trig('Fog toggle', 'panel', { control: 'Fog', event: 'change' }, ['if var fog_on = on then io Fog on else io Fog off']);
trig('CLICK Projectors on', 'panel', { control: 'Projectors on', event: 'click' }, ['projector all on']);
trig('CLICK Projectors off', 'panel', { control: 'Projectors off', event: 'click' }, ['projector all off']);
trig('CLICK Teststand', 'panel', { control: 'Teststand', event: 'click' }, ['mode System Maintenance', 'repeat trigger "Step through scenes" every 2 times 6']);
trig('Code A', 'panel', { control: 'A', event: 'click' }, [], [], { notes: 'Step 1 of the secret service code (no actions needed).' });
trig('Code B', 'panel', { control: 'B', event: 'click' }, []);
trig('Code C', 'panel', { control: 'C', event: 'click' }, []);
trig('Service code A-C-B', 'sequence', { steps: ['Code A', 'Code C', 'Code B'], within: 5 }, ['mode System Maintenance', 'start timeline "Inloop"', 'panel lbl_mode text Service mode', 'panel "Show progress" unlock'], [], { notes: 'Press A, C, B within 5 s on the Technician page.' });

sec('== EXTERNAL CONTROL', 'orange', 'UDP, OSC, TCP, HTTP, Art-Net/sACN in, DMX change.');
trig('UDP SHOW <name>', 'udp', { match: 'SHOW*' }, ['log UDP asked for show {1} from {sender_ip}', 'if var visitors >= 0 then fire trigger "Start main show"']);
trig('UDP PING', 'udp', { match: 'PING' }, ['reply PONG {visitors}\\r']);
trig('UDP from QLab only (port 7001)', 'udp', { match: 'GO', port: 7001, fromIp: '192.168.1.51' }, ['fire trigger "Start main show"']);
trig('OSC /kd/cue/*', 'osc', { address: '/kd/cue/*', port: 8000 }, ['log QLab says {address} {1}']);
trig('Visitor counted (UDP)', 'udp', { match: 'VISITOR' }, ['var visitors + 1', 'if var visitors >= 50 then panel lbl_status text FULL ({visitors})']);
trig('Watchout answers', 'tcp', { device: 'watchout', match: 'ACK*' }, ['log Watchout says {1}']);
trig('Media server status', 'http', { url: 'http://192.168.1.95' }, ['if var media_status != {status} then var media_status = {status}']);
trig('Desk ch1 >= 50 %: start show', 'dmx_in', { protocol: 'artnet', universe: 0, channels: '1', when: 'above', level: 128 }, ['fire trigger "Start main show"'], [], { notes: 'Mock console: dmxin artnet 0 1 255' });
trig('Desk ch2 = grand master', 'dmx_in', { protocol: 'sacn', universe: 1, channels: '2', when: 'change' }, ['grandmaster {=round(value/2.55)}']);
trig('Winch -> motor controller', 'dmx_change', { universe: 3, channels: '1-2', tables: { motor: ['P', 'S'], range: [65535, 100] } }, ['send udp motors W{motor}{=ceil(value*range/255)}\\r']);

sec('== DEVICES & MONITORING', 'blue', 'Device online/offline, projector alarms, PLC, KNX and Machine Control readings.');
trig('Device offline -> email', 'device', { device: '', state: 'offline' }, ['log {kind} {device} is {state}', 'email tech@example.com "{device} offline" {kind} {device} stopped answering'], ['mode System not Maintenance']);
trig('PJ left back online', 'device', { device: 'PJ left', state: 'online' }, ['log PJ left is back']);
trig('Projector error', 'projector', { projector: '', alarm: 'any', level: 'warning' }, ['email tech@example.com "{projector}: {alarm} {state}" Lamp at {lamp} h']);
trig('Lamp hours 4000', 'projector', { projector: 'PJ left', alarm: 'lamp_hours', hours: 4000 }, ['email tech@example.com "{projector} lamp" Lamp passed {hours} h (now {lamp} h)'], [], { notes: 'Mock console: projector "PJ left" send LAMP=4100' });
trig('Door opened (PLC)', 'variable', { variable: 'door', value: 'on' }, ['if mode Museum is Open then log Door opened during opening hours else email tech@example.com "Door" Door opened outside opening hours']);
trig('KNX hall light changed', 'variable', { variable: 'hall_light' }, ['log Hall light is now {value} (was {old})']);
trig('Daylight above 5 V (ai0)', 'input', { io: 'ai0', edge: 'rising', level: 5 }, ['stop timeline "Exterior evening" fade 10']);
trig('Visitor sensor (in1)', 'input', { io: 'in1', edge: 'rising' }, ['var visitors ++'], [], { cooldown: 1 });
trig('Reset button held (in3)', 'input', { io: 'in3', edge: 'hold', hold: 5 }, ['var visitors = 0', 'log Visitor counter reset']);
trig('Museum starting up', 'mode', { group: 'Museum', mode: 'Starting up' }, ['knx gw write "Hall light" on', 'netio rack output 1 on', 'fire trigger "Museum open" after 120']);
trig('Museum open', 'manual', {}, ['mode Museum Open'], ['mode Museum is "Starting up"']);
trig('Museum closed', 'mode', { group: 'Museum', mode: 'Closed' }, ['knx gw write "Hall light" off', 'netio rack output 1 off']);

sec('== EXAMPLES', 'grey', 'Disabled triggers and comment lines.');
trig('Disabled example', 'manual', {}, ['# a line starting with # is a comment and is skipped', 'log This trigger is switched off'], [], { enabled: false });
trig('Every 10 s heartbeat (disabled)', 'interval', { seconds: 10 }, ['send udp mediaserver alive'], [], { enabled: false });

let n = 0;
for (const t of triggers) if (t.type !== 'comment') t.id = ++n;

// ---------- panel ----------
// Two panels: the operator's (pages 1-3, /panel) and a front desk one (page 4, /panel?p=2) whose
// controls share names with the operator's, so they share their live state.
const panel = { theme: {}, panels: [
  { id: 1, name: 'Operator', title: 'KD Feature demo', start: 1 },
  { id: 2, name: 'Front desk', title: 'Front desk', start: 4 },
], pages: [
  { id: 1, name: 'Show', columns: 4, controls: [
    { type: 'label', name: 'lbl_status', text: 'Status: -', span: 3, col: 1, row: 1 },
    { type: 'clock', col: 4, row: 1 },
    { type: 'button', name: 'Start show', text: 'START SHOW', color: '#2e7d32', span: 2, col: 1, row: 2 },
    { type: 'button', name: 'Inloop', text: 'Inloop', color: '#3a4a6b', col: 3, row: 2 },
    { type: 'button', name: 'Stop', text: 'STOP', color: '#b71c1c', confirm: 'Stop everything?', col: 4, row: 2 },
    // A group: a frame around the controls placed inside it (house light and fog); dragging it moves them along.
    { type: 'group', name: 'grp_room', text: 'Room', span: 3, rows: 1, col: 1, row: 3 },
    { type: 'slider', name: 'House level', text: 'House light', min: 0, max: 100, step: 1, unit: ' %', var: 'house_level', span: 2, col: 1, row: 3 },
    { type: 'toggle', name: 'Fog', text: 'Fog', var: 'fog_on', col: 3, row: 3 },
    { type: 'button', name: 'Technician', text: 'Technician…', color: '#424242', goto: 2, col: 4, row: 3 },
    { type: 'color', name: 'Wall colour', text: 'Wall colour', links: { r: 'wall_r', g: 'wall_g', b: 'wall_b' }, var: 'wall_colour', span: 2, col: 1, row: 4, rows: 3 },
    { type: 'xy', name: 'Mover position', text: 'Pan / tilt', min: 0, max: 100, ymin: 0, ymax: 100, links: { x: 'pan', y: 'tilt' }, span: 2, col: 3, row: 4, rows: 3 },
    // Display only: a progress bar the triggers move; service mode unlocks it, Startup's reset locks it again.
    { type: 'slider', name: 'Show progress', text: 'Show progress', readonly: true, min: 0, max: 100, step: 1, unit: ' %', span: 4, col: 1, row: 7 },
    // Follows timeline 2 by itself; no unit = it shows the time (0:12 / 1:00).
    { type: 'slider', name: 'Show time', text: 'Main show', follow: 2, min: 0, max: 100, span: 4, col: 1, row: 8 },
    // Labels showing a variable ("Visitors: 12") and the time left of timeline 2 ("Time left -0:48").
    { type: 'label', name: 'lbl_visitors', text: 'Visitors:', var: 'visitors', span: 2, col: 1, row: 9 },
    { type: 'label', name: 'lbl_time', text: 'Time left', follow: 2, timeShow: 'left', span: 2, col: 3, row: 9 },
  ] },
  { id: 2, name: 'Technician', columns: 4, pin: '1234', controls: [
    { type: 'label', name: 'lbl_mode', text: 'Mode: -', span: 4 },
    { type: 'button', name: 'Projectors on', text: 'Projectors on', color: '#3a4a6b' },
    { type: 'button', name: 'Projectors off', text: 'Projectors off', color: '#3a4a6b' },
    { type: 'button', name: 'Teststand', text: 'Test scenes', color: '#f9a825' },
    { type: 'dial', name: 'Grand master', text: 'Grand master', min: 0, max: 100, step: 1, unit: ' %', value: 100, rows: 2 },
    { type: 'button', name: 'All off', text: 'All off (hold 3 s)', color: '#b71c1c' },
    { type: 'button', name: 'Blackout', text: 'Blackout (double-click)', color: '#000000' },
    { type: 'slider', name: 'Fader', text: 'Vertical slider', vertical: true, min: 0, max: 1, step: 0.01, rows: 3 },
    { type: 'spacer' },
    { type: 'button', name: 'A', text: 'A', color: '#424242' },
    { type: 'button', name: 'B', text: 'B', color: '#424242' },
    { type: 'button', name: 'C', text: 'C', color: '#424242' },
    { type: 'button', name: 'Groups page', text: 'Groups…', color: '#424242', goto: 3 },
    { type: 'button', name: 'Back', text: '← Back', color: '#424242', goto: 1, span: 4 },
  ] },
  // Groups in groups: "Stage" holds the "Haze" group and the curtain buttons.
  { id: 3, name: 'Groups', columns: 4, controls: [
    { type: 'group', name: 'grp_stage', text: 'Stage', col: 1, row: 1, span: 4, rows: 2 },
    { type: 'group', name: 'grp_haze', text: 'Haze', col: 1, row: 1, span: 2, rows: 2, color: '#6a5acd' },
    { type: 'toggle', name: 'Haze', text: 'Haze', col: 1, row: 1, span: 2 },
    { type: 'slider', name: 'Haze level', text: 'Haze level', min: 0, max: 100, unit: ' %', col: 1, row: 2, span: 2 },
    { type: 'button', name: 'Curtain open', text: 'Curtain open', color: '#3a4a6b', col: 3, row: 1 },
    { type: 'button', name: 'Curtain close', text: 'Curtain close', color: '#3a4a6b', col: 4, row: 1 },
    { type: 'button', name: 'Groups back', text: '← Back', color: '#424242', goto: 2, col: 1, row: 3, span: 4 },
  ] },
  // The front desk panel: the same "lbl_status" / "Start show" / "Stop" as the operator's.
  { id: 4, name: 'Desk', panel: 2, columns: 2, controls: [
    { type: 'label', name: 'lbl_status', text: 'Status: -', span: 2 },
    { type: 'button', name: 'Start show', text: 'START SHOW', color: '#2e7d32' },
    { type: 'button', name: 'Stop', text: 'STOP', color: '#b71c1c', confirm: 'Stop everything?' },
  ] },
] };
for (const pg of panel.pages) pg.panel = pg.panel || 1;

// ---------- assemble ----------
const project = {
  name: 'KD Feature demo',
  settings: { tzOffsetMin: 60, udpPort: 4000, sacnPriority: 100,
    monitor: { interval: 60, timeout: 1000, failures: 2 }, time: { ntp: 'pool.ntp.org', ntpEnabled: true, dst: 'eu' }, location: { lat: 52.16, lon: 4.49 }, outputs:{ dmx: true, artnet: true, sacn: true, dmxFps: 40, artnetFps: 30, sacnFps: 40, artnetChangesOnly: true, sacnChangesOnly: false } },
  network: { dhcp: true, ip: '192.168.1.50', mask: '255.255.255.0', gateway: '192.168.1.1' },
  modes: [
    { name: 'System', states: ['Idle', 'Show', 'Maintenance', 'Emergency'] },
    { name: 'Museum', states: ['Closed', 'Starting up', 'Open'] },
  ],
  universes: [
    { id: 1, name: 'Stage', dmxPort: 1, artnet: 0, sacn: 1, useDmx: true, useArtnet: false, useSacn: true },
    { id: 2, name: 'Pixels', dmxPort: 2, artnet: 1, artnetDest: '192.168.1.60', sacn: 2, useDmx: false, useArtnet: true, useSacn: false },
    { id: 3, name: 'Motors', dmxPort: 2, artnet: 2, sacn: 3, useDmx: true, useArtnet: true, useSacn: false },
  ],
  fixtures, groups, scenes, timelines,
  devices: [
    { name: 'mediaserver', ip: '192.168.1.52', port: 7000, notes: 'OSC media server' },
    { name: 'qlab', ip: '192.168.1.51', port: 53000, notes: 'QLab OSC' },
    { name: 'motors', ip: '192.168.1.70', port: 5000, notes: 'Winch / motor controller (UDP)' },
    { name: 'screen1', ip: '192.168.1.61', port: 5000, notes: 'Video player left' },
    { name: 'screen2', ip: '192.168.1.62', port: 5000, notes: 'Video player right' },
    { name: 'Wi-Fi bridge', ip: '192.168.1.77', port: 7000, notes: 'Flaky on purpose (mock: answers ~60 %)' },
  ],
  deviceGroups: [{ name: 'screens', devices: ['screen1', 'screen2'] }],
  pcs: [
    { id: 1, name: 'Media PC', ip: '192.168.1.41', mac: '00:1B:21:3A:4F:10', port: 7, startup: 'startup', shutdown: 'shutdown', reboot: 'reboot' },
    { id: 2, name: 'Kiosk PC', ip: '192.168.1.199', mac: '00:1B:21:3A:4F:11', port: 7, startup: 'startup', shutdown: 'shutdown', reboot: 'reboot' },
  ],
  email: { server: '192.168.1.5', port: 25, user: '', password: '', from: 'show@example.com' },
  projectors: [
    { id: 1, name: 'PJ left', ip: '192.168.1.101', port: 4352, password: '' },
    { id: 2, name: 'PJ right', ip: '192.168.1.102', port: 4352, password: 'panasonic' },
    { id: 3, name: 'PJ foyer', ip: '192.168.1.199', port: 4352, password: '' },
  ],
  panel, triggers,
  variables: [
    { name: 'visitors', type: 'number', initial: 0, persist: true },
    { name: 'show_count', type: 'number', initial: 0, persist: true },
    { name: 'door', type: 'bool', initial: false, modbus: { device: 'plc', table: 'discrete', address: 0 } },
    { name: 'work_lights', type: 'bool', initial: false, modbus: { device: 'plc', table: 'coil', address: 3 } },
    { name: 'media_status', type: 'text', initial: 'unknown' },
    { name: 'blackout', type: 'bool', initial: false },
    { name: 'fog_on', type: 'bool', initial: false },
    { name: 'house_level', type: 'number', initial: 0 },
    { name: 'wall_colour', type: 'text', initial: '#000000' },
    { name: 'wall_r', type: 'number', initial: 0 },
    { name: 'wall_g', type: 'number', initial: 0 },
    { name: 'wall_b', type: 'number', initial: 0 },
    { name: 'pan', type: 'number', initial: 50 },
    { name: 'tilt', type: 'number', initial: 50 },
    { name: 'hall_light', type: 'bool', initial: false },
    { name: 'daylight', type: 'number', initial: 0 },
    { name: 'pharos_tl1', type: 'text', initial: '' },
  ],
  calendar: [
    { name: 'Closed', from: '12-25', to: '12-26' },
    { name: 'Closed', from: '01-01', to: '01-01' },
    { name: 'Summer', from: '07-01', to: '08-31' },
  ],
  tcp: [{ name: 'watchout', ip: '192.168.1.90', port: 3039, eol: '\\r\\n' }],
  modbus: [{ name: 'plc', ip: '192.168.1.80', port: 502, unit: 1, pollMs: 500 }],
  maps, effects,
  fixtureTypes: [
`fixture Museum / Vitrine LED strip
icon pixel
curve linear
note Our own 4-cell showcase strip (example of a project fixture type)
mode 4 cells: 4 x (r, g, b)
mode Simple: dim, r, g, b`],
  drivers: [
    { id: 1, type: 'kissbox', name: 'io', ip: '192.168.1.121', port: 9813, listenPort: 9813, frame: 'IO3', cards: ['DO4PR', 'DI8DC', 'AO8DA'],
      names: { '1.1': 'Fog power', '1.2': 'Hazer', '1.3': 'Doors', '1.4': 'Spare', '2.1': 'Door contact', '3.1': 'Fan speed' }, vars: { '2.1': 'door' } },
    { id: 2, type: 'knx', name: 'gw', ip: '192.168.1.123', port: 3671, addresses: [
      { ga: '1/1/1', dpt: '1', name: 'Hall light', var: 'hall_light' }, { ga: '1/2/1', dpt: '5.001', name: 'Hall dimmer' },
      { ga: '2/1/1', dpt: '3', name: 'Blinds' }, { ga: '3/1/1', dpt: '9', name: 'Hall temperature' }, { ga: '4/1/1', dpt: '232', name: 'RGB strip' }], vars: {} },
    { id: 3, type: 'brightsign', name: 'lobby', ip: '192.168.1.125', port: 80, user: 'admin', password: '', udpPort: 5000, plugin: true, pluginPort: 5010, vars: {},
      commands: [{ name: 'Play intro', text: 'play1' }, { name: 'Loop', text: 'loop' }] },
    { id: 4, type: 'digidot', name: 'c4', ip: '192.168.1.126', port: 80, user: 'admin', password: 'admin', vars: {} },
    { id: 5, type: 'netio', name: 'rack', ip: '192.168.1.127', port: 80, user: 'netio', password: 'netio', model: '4PZ', outputs: 4, live: true, vars: {} },
    { id: 6, type: 'pharos', name: 'lpc', ip: '192.168.1.128', port: 80, live: true, vars: { tl1: 'pharos_tl1' } },
  ],
  machineControl: {
    in0: { name: 'Emergency stop' }, in1: { name: 'Visitor sensor' }, in2: { name: 'Winch safety' }, in3: { name: 'Reset button' },
    out0: { name: 'Door release' }, out1: { name: 'Beacon' }, io4: { name: 'Fog', mode: 'out', var: 'fog_on' },
    ai0: { name: 'Daylight sensor', var: 'daylight' }, ai1: { name: 'Room temperature', mode: 'NTC' }, ao0: { name: 'Fan 0-10V' },
  },
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(project, null, 2));
console.log(`wrote ${out}: ${fixtures.length} fixtures, ${effects.length} effects, ${triggers.length} triggers`);
