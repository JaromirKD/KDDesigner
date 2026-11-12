// Builds the museum example shows in examples/: typical A/V set-ups to start a real show from.
// Usage: node tools/make-examples.js [name ...]   (default: all of them)
// Don't edit their project.json by hand: change this script, rerun it, then
// `node tools/check-project.js examples/<name>/project.json` on each.
'use strict';
const fs = require('fs'), path = require('path');
const repo = path.join(__dirname, '..');
const FX = require(path.join(repo, 'data', 'www', 'fx.js'));

// ---------- a small builder shared by all shows ----------
function Show() {
  const s = { fixtures: [], groups: [], scenes: [], timelines: [], effects: [], maps: [], triggers: [] };
  let sep = 10000, color = '';
  s.fx = (name, universe, address, channels, extra = {}) => { const id = s.fixtures.length + 1; s.fixtures.push({ id, name, universe, address, channels, ...extra }); return id; };
  // n fixtures in a row, each `size` channels apart; names get 1, 2, 3...
  s.row = (name, n, universe, address, channels, extra = {}) => Array.from({ length: n }, (_, k) => s.fx(`${name} ${k + 1}`, universe, address + k * channels.length, channels, extra));
  s.group = (name, fixtures) => { const id = s.groups.length + 1; s.groups.push({ id, name, fixtures }); return id; };
  s.scene = (name, levels) => { const id = s.scenes.length + 1; s.scenes.push({ id, name, levels }); return id; };
  // A base effect by name, or one of our own with code.
  s.effect = (name, code) => {
    const have = s.effects.find((e) => e.name === name);
    if (have) return have.id;
    const t = code ? { code } : FX.TEMPLATES.find((x) => x.name === name);
    if (!t) throw new Error('no base effect ' + name);
    const id = s.effects.length + 1; s.effects.push({ id, name, code: t.code }); return id;
  };
  s.timeline = (tl) => { const id = s.timelines.length + 1; s.timelines.push({ id, loop: false, priority: 0, ...tl }); return id; };
  s.map = (name, aspect, items) => s.maps.push({ id: s.maps.length + 1, name, aspect, background: '', snap: true, labels: true,
    items: items.map(([fixture, x, y]) => ({ fixture, x: +x.toFixed(4), y: +y.toFixed(4) })) });
  const section = (name, notes) => s.triggers.push({ id: ++sep, name, type: 'comment', color, actions: [], conditions: [], ...(notes ? { notes } : {}) });
  s.sec = (name, c, notes) => { color = c; section(name, notes); };
  s.sub = (name, notes) => { section(name, notes); s.triggers[s.triggers.length - 1].level = 2; };
  s.trig = (name, type, fields, actions, conditions = [], extra = {}) => s.triggers.push({ id: 0, name, type, ...fields, color, actions, conditions, ...extra });
  s.build = (p) => {
    let n = 0;
    for (const t of s.triggers) if (t.type !== 'comment') t.id = ++n;
    const panel = p.panel || { theme: {}, panels: [], pages: [] };
    for (const pg of panel.pages) pg.panel = pg.panel || 1;
    return {
      name: p.name,
      settings: { dateOrder: 'dmy', tzOffsetMin: 60, udpPort: 4000, sacnPriority: 100, monitor: { interval: 60, timeout: 1000, failures: 2 },
        time: { ntp: 'pool.ntp.org', ntpEnabled: true, dst: 'eu' }, location: { lat: 52.37, lon: 4.9 },
        outputs: { dmx: true, artnet: true, sacn: true, dmxFps: 40, artnetFps: 30, sacnFps: 40, artnetChangesOnly: true, sacnChangesOnly: false } },
      network: { dhcp: false, ip: p.ip || '192.168.1.50', mask: '255.255.255.0', gateway: p.gateway || '192.168.1.1' },
      modes: p.modes || [],
      universes: p.universes || [{ id: 1, name: 'DMX 1', dmxPort: 1, artnet: 0, sacn: 1, useDmx: true, useArtnet: false, useSacn: false }],
      fixtures: s.fixtures, groups: s.groups, scenes: s.scenes, timelines: s.timelines,
      devices: p.devices || [], deviceGroups: p.deviceGroups || [], pcs: p.pcs || [],
      email: { server: '192.168.1.5', port: 25, user: '', password: '', from: 'av@museum.example' },
      projectors: p.projectors || [], panel, triggers: s.triggers, variables: p.variables || [], calendar: p.calendar || [],
      tcp: p.tcp || [], modbus: p.modbus || [], maps: s.maps, effects: s.effects,
      triggerColorNames: p.triggerColorNames || {}, fixtureTypes: [], drivers: p.drivers || [],
      ...(p.machineControl ? { machineControl: p.machineControl } : {}),
    };
  };
  return s;
}
// Scene levels: L(fixtures, channel, value); colour() = dim + r g b.
const L = (ids, ch, v) => ids.map((fixture) => ({ fixture, ch, v }));
const colour = (ids, r, g, b, dim = 255) => [...L(ids, 'dim', dim), ...L(ids, 'r', r), ...L(ids, 'g', g), ...L(ids, 'b', b)];
const rgb = (ids, r, g, b) => [...L(ids, 'r', r), ...L(ids, 'g', g), ...L(ids, 'b', b)];
const pct = (v) => Math.round(v * 2.55);
const line = (ids, x0, x1, y) => ids.map((f, k) => [f, x0 + (ids.length > 1 ? (k * (x1 - x0)) / (ids.length - 1) : 0), y]);
const pj = (id, name, ip, password = '') => ({ id, name, ip, port: 4352, password });
const pc = (id, name, ip, mac) => ({ id, name, ip, mac, port: 9, startup: 'startup', shutdown: 'shutdown', reboot: 'reboot' });
// Closed days most Dutch museums share; the shows add their own.
const HOLIDAYS = [{ name: 'Closed', from: '01-01', to: '01-01' }, { name: 'Closed', from: '12-25', to: '12-25' }];
const TECH = 'tech@museum.example';

const shows = {};

// =====================================================================================
// 1. Gallery: a permanent exhibition with opening hours, cleaning and night light
// =====================================================================================
shows['museum-gallery'] = () => {
  const s = Show();
  const spotsA = s.row('Spot room A', 6, 1, 1, ['dim'], { icon: 'profile' });
  const spotsB = s.row('Spot room B', 6, 1, 7, ['dim'], { icon: 'profile' });
  const vitr = s.row('Vitrine', 4, 1, 20, ['dim', 'cct'], { icon: 'dimmer', type: 'Generic / Tunable white', mode: 'dim, cct' });
  const coves = s.row('Cove', 4, 1, 40, ['dim', 'r', 'g', 'b', 'w'], { icon: 'wash' });
  const work = [s.fx('Work light room A', 1, 60, ['dim'], { curve: 'nondim', icon: 'relay' }), s.fx('Work light room B', 1, 61, ['dim'], { curve: 'nondim', icon: 'relay' })];
  const night = s.fx('Night light corridor', 1, 62, ['dim'], { icon: 'dimmer' });
  s.group('Room A spots', spotsA); s.group('Room B spots', spotsB); s.group('Vitrines', vitr); const gCoves = s.group('Coves', coves); s.group('Work lights', work);
  s.map('Floor plan', 2, [...line(spotsA, 0.06, 0.44, 0.2), ...line(spotsB, 0.56, 0.94, 0.2), ...line(vitr, 0.15, 0.85, 0.55),
    ...line(coves, 0.08, 0.92, 0.85), [work[0], 0.25, 0.4], [work[1], 0.75, 0.4], [night, 0.5, 0.95]]);
  const exhib = s.scene('Exhibition', [...L([...spotsA, ...spotsB], 'dim', pct(80)), ...L(vitr, 'dim', pct(70)), ...L(vitr, 'cct', 90),
    ...colour(coves, 255, 190, 120, pct(40)), ...L(coves, 'w', 200)]);
  s.scene('Cleaning', [...L(work, 'dim', 255), ...L([...spotsA, ...spotsB], 'dim', 255), ...L(vitr, 'dim', pct(30))]);
  s.scene('Night (security)', [...L([night], 'dim', pct(30)), ...L(vitr, 'dim', pct(5))]);
  s.scene('Evening event', [...L([...spotsA, ...spotsB], 'dim', pct(60)), ...L(vitr, 'dim', pct(80)), ...L(vitr, 'cct', 40),
    ...colour(coves, 255, 120, 40, pct(70))]);
  s.timeline({ name: 'Opening hours', length: 600000, loop: true, group: 'A',
    tracks: [{ name: 'Base', fixtures: [], groups: [] }, { name: 'Coves', fixtures: [], groups: [gCoves] }],
    cues: [{ t: 0, fade: 20000, scene: exhib, path: 'damped' },
      { t: 0, track: 1, fade: 20000, effect: s.effect('XY gradient'), params: { speed: 0.01, c1: '#ffb070', c2: '#ffe0b0' }, dim: 40 }] });

  s.sec('== START', 'red', 'The Museum mode group holds what each state does (Modes page). The clock and the buttons only change the mode.');
  s.trig('Startup', 'startup', {}, ['if mode Museum is Open then start timeline "Opening hours"', 'if mode Museum is Closed then scene "Night (security)" fade 5',
    'panel lbl_state text Museum: {mode.Museum}'], [], { notes: 'After a power cut the Museum mode keeps its state; this puts the light back to match.' });
  s.trig('Mode -> panel label', 'mode', { group: 'Museum' }, ['panel lbl_state text Museum: {mode}', 'log Museum is now {mode}']);

  s.sec('== OPENING HOURS', 'green', 'Tuesday to Sunday 10:00-17:00, Thursday until 21:00. Closed on Mondays and on the calendar\'s Closed days.');
  s.trig('Cleaning 08:30', 'time', { at: '08:30:00', days: ['tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, ['mode Museum Cleaning'], ['calendar Closed inactive']);
  s.trig('Opening 09:45', 'time', { at: '09:45:00', days: ['tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, ['mode Museum Opening'], ['calendar Closed inactive'],
    { notes: '15 minutes before the doors open: power, PCs and projectors come up, then the light fades in.' });
  s.trig('Closing 17:00', 'time', { at: '17:00:00' }, ['mode Museum Closed'], ['mode Museum not Closed', 'mode Museum not Event', 'day is tue,wed,fri,sat,sun']);
  s.trig('Late opening Thursday 21:00', 'time', { at: '21:00:00', days: ['thu'] }, ['mode Museum Closed'], ['mode Museum not Closed', 'mode Museum not Event']);
  s.trig('Safety net 23:30', 'time', { at: '23:30:00' }, ['mode Museum Closed'], ['mode Museum not Closed'], { notes: 'Whatever happened during the day: closed at night.' });
  s.trig('Weekly reboot (Monday 07:00)', 'time', { at: '07:00:00', days: ['mon'] }, ['pc all wake', 'sleep 180', 'pc all reboot', 'sleep 300', 'pc all shutdown'],
    [], { notes: 'Monday the museum is closed: a weekly restart keeps the media PCs fresh.' });

  s.sec('== STAFF PANEL', 'cyan', 'A tablet at the front desk: /panel. Close needs a 3 s hold so it isn\'t pressed by accident.');
  s.trig('CLICK Open now', 'panel', { control: 'Open now', event: 'click' }, ['mode Museum Opening'], ['mode Museum not Open']);
  s.trig('HOLD Close now', 'panel', { control: 'Close now', event: 'hold', hold: 3 }, ['mode Museum Closed']);
  s.trig('CLICK Cleaning', 'panel', { control: 'Cleaning', event: 'click' }, ['if mode Museum is Cleaning then mode Museum back else mode Museum Cleaning']);
  s.trig('CLICK Evening event', 'panel', { control: 'Evening event', event: 'click' }, ['mode Museum Event']);
  s.trig('Light level slider', 'panel', { control: 'Light level', event: 'change' }, ['master timeline "Opening hours" {value} fade 2']);

  s.sec('== MONITORING', 'blue', 'Emails to the technician when something drops out during opening hours.');
  s.trig('Device offline', 'device', { device: '', state: 'offline' }, ['email ' + TECH + ' "{device} offline" {kind} {device} stopped answering ({mode.Museum})'], ['mode Museum is Open']);
  s.trig('Projector warning', 'projector', { projector: '', alarm: 'any', level: 'warning' }, ['email ' + TECH + ' "{projector}: {alarm}" {alarm} is {state}, lamp {lamp} h']);
  s.trig('Lamp hours 18000', 'projector', { projector: '', alarm: 'lamp_hours', hours: 18000 }, ['email ' + TECH + ' "{projector} light source" {hours} h reached, plan a replacement']);

  return s.build({ name: 'Museum gallery - opening hours',
    modes: [{ name: 'Museum', states: ['Closed', 'Cleaning', 'Opening', 'Open', 'Event'], stateInfo: {
      Closed: { color: '#616161', icon: '🌙', enter: ['release all fade 30', 'scene "Night (security)" fade 30', 'projector all off', 'brightsign "Screen A" send stop',
        'sleep 60', 'pc all shutdown', '# projectors need a few minutes to cool down before the power goes', 'sleep 240', 'netio rack output 2 off'] },
      Cleaning: { color: '#f9a825', icon: '🧹', enter: ['scene Cleaning fade 3'], leave: ['release scene Cleaning fade 5'] },
      Opening: { color: '#d29922', icon: '⏳', enter: ['netio rack output 2 on', 'release all fade 10', 'sleep 20', 'pc all wake', 'projector all on',
        'wait until device "PJ room A" is online timeout 180', 'projector all input 31', 'mode Museum Open'] },
      Open: { color: '#3fb950', icon: '🟢', enter: ['start timeline "Opening hours"', 'brightsign "Screen A" send loop', 'var days_open ++'] },
      Event: { color: '#8957e5', icon: '🥂', enter: ['scene "Evening event" fade 20'], leave: ['release scene "Evening event" fade 10'] },
    } }],
    devices: [], pcs: [pc(1, 'Media PC room A', '192.168.1.41', '00:1B:21:3A:4F:10'), pc(2, 'Kiosk PC room B', '192.168.1.42', '00:1B:21:3A:4F:11')],
    projectors: [pj(1, 'PJ room A', '192.168.1.101'), pj(2, 'PJ room B', '192.168.1.102')],
    variables: [{ name: 'days_open', type: 'number', initial: 0, persist: true }, { name: 'light_level', type: 'number', initial: 100 }],
    calendar: [...HOLIDAYS],
    drivers: [{ id: 1, type: 'brightsign', name: 'Screen A', ip: '192.168.1.111', port: 80, user: 'admin', password: '', udpPort: 5000, plugin: false, vars: {},
      commands: [{ name: 'Loop', text: 'loop' }, { name: 'Stop', text: 'stop' }] },
      { id: 2, type: 'netio', name: 'rack', ip: '192.168.1.120', port: 80, user: 'netio', password: 'netio', model: '4PZ', outputs: 4, live: true, vars: {} }],
    triggerColorNames: { red: 'Start', green: 'Opening hours', cyan: 'Staff panel', blue: 'Monitoring' },
    panel: { theme: {}, panels: [{ id: 1, name: 'Front desk', title: 'Gallery', start: 1 }], pages: [
      { id: 1, name: 'Gallery', columns: 2, controls: [
        { type: 'label', name: 'lbl_state', text: 'Museum:', span: 2 },
        { type: 'clock', span: 2 },
        { type: 'button', name: 'Open now', text: 'Open now', color: '#2e7d32' },
        { type: 'button', name: 'Close now', text: 'Close (hold 3 s)', color: '#b71c1c' },
        { type: 'button', name: 'Cleaning', text: 'Cleaning light', color: '#f9a825' },
        { type: 'button', name: 'Evening event', text: 'Evening event', color: '#6a4c93' },
        { type: 'slider', name: 'Light level', text: 'Light level', min: 0, max: 100, step: 5, unit: ' %', value: 100, var: 'light_level', span: 2 },
        { type: 'label', name: 'lbl_days', text: 'Days open:', var: 'days_open', span: 2 },
      ] }] },
  });
};

// =====================================================================================
// 2. Immersive room: a 6-minute projection show with light, inloop in between
// =====================================================================================
shows['immersive-room'] = () => {
  const s = Show();
  const house = s.row('House light', 4, 1, 1, ['dim'], { curve: 'square', icon: 'dimmer' });
  const walls = s.row('Wall wash', 8, 1, 10, ['dim', 'r', 'g', 'b', 'w'], { icon: 'wash' });
  const entrance = s.fx('Entrance spot', 1, 60, ['dim'], { icon: 'profile' });
  const work = s.fx('Work light', 1, 61, ['dim'], { curve: 'nondim', icon: 'relay' });
  const ceiling = s.row('Ceiling', 24, 2, 1, ['r', 'g', 'b'], { icon: 'pixel' });
  const gHouse = s.group('House', house), gWalls = s.group('Walls', walls), gCeil = s.group('Ceiling', ceiling);
  // Walls round the room, the ceiling strip as a ring above it.
  const ring = (ids, r) => ids.map((f, k) => { const a = (k / ids.length) * Math.PI * 2 - Math.PI / 2; return [f, 0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]; });
  s.map('Room', 1, [...ring(walls, 0.45), ...ring(ceiling, 0.3), ...ring(house, 0.15), [entrance, 0.5, 0.97], [work, 0.5, 0.5]]);
  const loading = s.scene('Room loading', [...L(house, 'dim', pct(70)), ...L([entrance], 'dim', 255)]);
  const dark = s.scene('Show blackout', [...L([entrance], 'dim', pct(10))]);
  const end = s.scene('Show end - house up', [...L(house, 'dim', pct(80)), ...L([entrance], 'dim', 255)]);
  s.scene('Work light', [...L([work, ...house], 'dim', 255)]);
  const ocean = s.effect('Underwater', `// Slow light under water: waves of colour with a little noise
param speed = 0.15 [0, 1]      // waves per second
param color = #1aa0ff          // colour of the light
param low = 0.25 [0, 1]        // level between the waves
k = 0.5 + 0.5 * sin((x * 2 + y + t * speed) * tau)
r, g, b = color
dim = low + (1 - low) * k * (0.7 + 0.3 * noise(t * 0.8 + i))`);
  const S = (x) => x * 1000;
  const show = s.timeline({ name: 'Show', length: S(360), group: 'A',
    tracks: [{ name: 'Room', fixtures: [], groups: [] }, { name: 'Walls', fixtures: [], groups: [gWalls] }, { name: 'Ceiling', fixtures: [], groups: [gCeil] },
      { name: 'House', fixtures: [], groups: [gHouse] }],
    cues: [
      { t: 0, fade: 5000, scene: dark, path: 'damped' },
      { t: S(5), trigger: 'Show: start media' },
      // Chapter 1: the sea
      { t: S(5), track: 1, fade: 8000, len: S(85), out: 5000, effect: ocean, params: {}, dim: 100 },
      { t: S(5), track: 2, fade: 8000, len: S(85), out: 5000, effect: s.effect('XY ripple'), params: { speed: 0.2, color: '#0050a0', back: '#000814' }, dim: 70 },
      // Chapter 2: the forest
      { t: S(90), track: 1, fade: 6000, len: S(90), out: 4000, effect: s.effect('Two-colour fade'), params: { speed: 0.05, a: '#20a040', b2: '#80c020' }, dim: 80 },
      { t: S(90), track: 2, fade: 6000, len: S(90), out: 4000, effect: s.effect('Twinkle'), params: { speed: 0.2, color: '#d0ff60', base: '#001000' }, dim: 100 },
      // Chapter 3: the storm
      { t: S(180), track: 1, fade: 3000, len: S(90), out: 3000, effect: s.effect('Lightning'), params: { rate: 0.4, base: 0.05 }, dim: 100 },
      { t: S(180), track: 2, fade: 3000, len: S(90), out: 3000, effect: s.effect('XY plasma'), params: { speed: 0.6, sat: 0.3 }, dim: 40 },
      // Chapter 4: sunrise
      { t: S(270), track: 1, fade: 20000, len: S(40), out: 10000, dim: 100, color: '#ff5a1f', path: 'braked' },
      { t: S(300), track: 1, fade: 20000, len: S(45), out: 5000, dim: 100, color: '#ffd7a0', path: 'braked' },
      { t: S(270), track: 2, fade: 30000, len: S(75), out: 5000, effect: s.effect('XY gradient'), params: { angle: 90, c1: '#ff8030', c2: '#2040a0' }, dim: 80 },
      { t: S(345), track: 3, fade: 10000, scene: end, path: 'damped' },
    ] });
  s.timeline({ name: 'Inloop', length: 60000, loop: true, group: 'A',
    tracks: [{ name: 'Room', fixtures: [], groups: [] }, { name: 'Walls', fixtures: [], groups: [gWalls] }, { name: 'Ceiling', fixtures: [], groups: [gCeil] }],
    cues: [{ t: 0, fade: 5000, scene: loading, path: 'damped' },
      { t: 0, track: 1, fade: 5000, effect: s.effect('Breathe'), params: { speed: 0.05, color: '#3060ff', low: 0.3 }, dim: 60 },
      { t: 0, track: 2, fade: 5000, effect: s.effect('Twinkle'), params: { speed: 0.1, color: '#a0c0ff' }, dim: 50 }] });

  s.sec('== START & SAFETY', 'red', 'Fire alarm and door contact come in on the Kiss-Box (slot 1), the start button\'s LED goes out on slot 2.');
  s.trig('Startup', 'startup', {}, ['mode Room Idle', 'fire trigger "Start inloop" after 5']);
  s.trig('Fire alarm', 'variable', { variable: 'fire_alarm', value: 'on' },
    ['mode Room Emergency', 'send osc mediaserver /stop', 'send osc qlab /panic', 'email ' + TECH + ' "Fire alarm" Immersive room stopped by the fire alarm'],
    [], { notes: 'Contact from the fire alarm panel on Kiss-Box input 1.3. The Emergency state puts all light on.' });
  s.trig('Fire alarm over', 'variable', { variable: 'fire_alarm', value: 'off' }, ['mode Room Idle', 'fire trigger "Start inloop"'], ['mode Room is Emergency']);

  s.sec('== SHOW CYCLE', 'purple', 'Visitors press the start button, or the show starts by itself every 15 minutes during opening hours.');
  s.trig('Start inloop', 'manual', {}, ['start timeline "Inloop"', 'send osc mediaserver /cue/inloop/start', 'kissbox io 2.1 on', 'panel "Start show" reset', 'panel lbl_status text Waiting for visitors'],
    ['mode Room not Emergency']);
  s.trig('Start show', 'manual', {}, ['mode Room Show', 'kissbox io 2.1 off', 'start timeline Show', 'var shows_today ++', 'var shows_total ++',
    'panel "Start show" text RUNNING', 'panel lbl_status text Show is running'], ['mode Room is Idle', 'timeline Show stopped'], { whileRunning: 'ignore' });
  s.trig('Show: start media', 'manual', {}, ['send osc mediaserver /cue/show/start', 'send osc qlab /cue/show/go'], [],
    { notes: 'Fired by the ◆ cue at 5 s on the Show timeline, after the room has gone dark.' });
  s.trig('Show finished', 'timeline', { timeline: show, on: 'end' }, ['mode Room Idle', 'fire trigger "Start inloop"', 'log Show {shows_today} of today finished']);
  s.trig('Stop show', 'manual', {}, ['stop timeline Show fade 3', 'send osc mediaserver /stop', 'send osc qlab /cue/show/stop', 'mode Room Idle', 'fire trigger "Start inloop" after 3']);
  s.trig('Start button (Kiss-Box 1.2)', 'variable', { variable: 'start_button', value: 'on' }, ['fire trigger "Start show"'], [],
    { cooldown: 10, onlyIn: { group: 'Room', states: ['Idle'] }, notes: 'The big button at the entrance. Ignored while a show runs.' });
  s.trig('Auto start every 15 min', 'interval', { seconds: 900 }, ['fire trigger "Start show"'], ['time between 10:00 16:45', 'mode Room is Idle', 'calendar Closed inactive']);
  s.trig('Door opened during show', 'variable', { variable: 'door', value: 'on' }, ['log Door opened during the show', 'set 1.60 255', 'sleep 10', 'clear override 1.60'],
    [], { onlyIn: { group: 'Room', states: ['Show'] }, notes: 'Lights the entrance spot for 10 s so latecomers find their way.' });

  s.sec('== OPERATOR PANEL', 'cyan', 'Front page for the guards, Technician page behind PIN 1234.');
  s.trig('CLICK Start show', 'panel', { control: 'Start show', event: 'click' }, ['fire trigger "Start show"']);
  s.trig('CLICK Stop', 'panel', { control: 'Stop', event: 'click' }, ['fire trigger "Stop show"']);
  s.trig('House light slider', 'panel', { control: 'House', event: 'change' }, ['set 1.1-4 {=round(value*2.55)}']);
  s.trig('CLICK House back to show', 'panel', { control: 'House auto', event: 'click' }, ['clear override 1.1-4', 'panel House value 0']);
  s.trig('CLICK Chapter 2', 'panel', { control: 'Chapter 2', event: 'click' }, ['start timeline Show at 90']);
  s.trig('CLICK Chapter 3', 'panel', { control: 'Chapter 3', event: 'click' }, ['start timeline Show at 180']);
  s.trig('CLICK Chapter 4', 'panel', { control: 'Chapter 4', event: 'click' }, ['start timeline Show at 270']);
  s.trig('CLICK Work light', 'panel', { control: 'Work light', event: 'click' }, ['if mode Room is Maintenance then mode Room Idle else mode Room Maintenance']);

  s.sec('== DAY', 'green', 'Power the room up before opening and down after closing.');
  s.trig('Room on 09:30', 'time', { at: '09:30:00' }, ['pc "Media server" wake', 'projector blend on', 'sleep 120', 'fire trigger "Start inloop"'], ['calendar Closed inactive']);
  s.trig('Room off 17:30', 'time', { at: '17:30:00' }, ['release all fade 10', 'projector blend off', 'sleep 30', 'pc "Media server" shutdown'], ['mode Room is Idle']);
  s.trig('New day: reset counter', 'time', { at: '00:00:00' }, ['log Shows yesterday: {shows_today}', 'var shows_today = 0']);
  s.trig('Media server offline', 'device', { device: 'Media server', state: 'offline' }, ['email ' + TECH + ' "Media server offline" during {mode.Room}'], ['time between 10:00 17:00']);

  return s.build({ name: 'Immersive room - show cycle',
    universes: [{ id: 1, name: 'Room', dmxPort: 1, artnet: 0, sacn: 1, useDmx: true, useArtnet: false, useSacn: false },
      { id: 2, name: 'Ceiling pixels', dmxPort: 2, artnet: 1, sacn: 2, useDmx: false, useArtnet: true, useSacn: false }],
    modes: [{ name: 'Room', states: ['Idle', 'Show', 'Maintenance', 'Emergency'], startup: 'Idle', stateInfo: {
      Idle: { color: '#3a7bd5', icon: '⏸' }, Show: { color: '#2e7d32', icon: '▶' },
      Maintenance: { color: '#f9a825', icon: '🔧', enter: ['release all fade 2', 'scene "Work light" fade 2'], leave: ['release scene "Work light" fade 2', 'fire trigger "Start inloop"'] },
      Emergency: { color: '#b71c1c', icon: '⚠', enter: ['release all fade 0', 'set 1.1-4 255', 'set 1.60-61 255', 'panel lbl_status text FIRE ALARM', 'panel lbl_status flash red'],
        leave: ['clear overrides', 'panel lbl_status reset'] } } }],
    devices: [{ name: 'mediaserver', ip: '192.168.1.20', port: 8000, notes: 'Media server, OSC in' }, { name: 'qlab', ip: '192.168.1.21', port: 53000, notes: 'Surround audio (QLab)' }],
    deviceGroups: [{ name: 'blend', kind: 'projector', devices: ['PJ 1', 'PJ 2', 'PJ 3'] }],
    pcs: [pc(1, 'Media server', '192.168.1.20', '00:1B:21:3A:50:01'), pc(2, 'Audio Mac', '192.168.1.21', '00:1B:21:3A:50:02')],
    projectors: [pj(1, 'PJ 1', '192.168.1.101'), pj(2, 'PJ 2', '192.168.1.102'), pj(3, 'PJ 3', '192.168.1.103')],
    variables: [{ name: 'shows_today', type: 'number', initial: 0, persist: true }, { name: 'shows_total', type: 'number', initial: 0, persist: true },
      { name: 'fire_alarm', type: 'bool', initial: false }, { name: 'start_button', type: 'bool', initial: false }, { name: 'door', type: 'bool', initial: false }],
    calendar: [...HOLIDAYS],
    drivers: [{ id: 1, type: 'kissbox', name: 'io', ip: '192.168.1.121', port: 9813, listenPort: 9813, frame: 'IO3', cards: ['DI8DC', 'DO4PR', ''],
      names: { '1.1': 'Door contact', '1.2': 'Start button', '1.3': 'Fire alarm', '2.1': 'Start button LED' },
      vars: { '1.1': 'door', '1.2': 'start_button', '1.3': 'fire_alarm' } }],
    triggerColorNames: { red: 'Safety', purple: 'Show cycle', cyan: 'Panel', green: 'Day' },
    panel: { theme: {}, panels: [{ id: 1, name: 'Operator', title: 'Immersive room', start: 1 }], pages: [
      { id: 1, name: 'Show', columns: 3, controls: [
        { type: 'label', name: 'lbl_status', text: 'Status: -', span: 2 }, { type: 'clock' },
        { type: 'button', name: 'Start show', text: 'START SHOW', color: '#2e7d32', span: 2 },
        { type: 'button', name: 'Stop', text: 'STOP', color: '#b71c1c', confirm: 'Stop the show?' },
        { type: 'slider', name: 'Show time', text: 'Show', follow: show, min: 0, max: 100, span: 3 },
        { type: 'label', name: 'lbl_left', text: 'Time left', follow: show, timeShow: 'left' },
        { type: 'label', name: 'lbl_today', text: 'Shows today:', var: 'shows_today' },
        { type: 'button', name: 'Technician', text: 'Technician…', color: '#424242', goto: 2 },
      ] },
      { id: 2, name: 'Technician', columns: 3, pin: '1234', controls: [
        { type: 'button', name: 'Chapter 2', text: 'Chapter 2 forest', color: '#3a4a6b' },
        { type: 'button', name: 'Chapter 3', text: 'Chapter 3 storm', color: '#3a4a6b' },
        { type: 'button', name: 'Chapter 4', text: 'Chapter 4 sunrise', color: '#3a4a6b' },
        { type: 'slider', name: 'House', text: 'House light', min: 0, max: 100, step: 1, unit: ' %', span: 2 },
        { type: 'button', name: 'House auto', text: 'House: back to show', color: '#424242' },
        { type: 'button', name: 'Work light', text: 'Work light on/off', color: '#f9a825' },
        { type: 'label', name: 'lbl_total', text: 'Shows total:', var: 'shows_total', span: 2 },
        { type: 'button', name: 'Back', text: '← Back', color: '#424242', goto: 1, span: 3 },
      ] }] },
  });
};

// =====================================================================================
// 3. Hands-on exhibit: 6 buttons, each plays a video and lights its object
// =====================================================================================
shows['hands-on-exhibit'] = () => {
  const s = Show();
  const N = 6;
  const spots = s.row('Object spot', N, 1, 1, ['dim'], { icon: 'profile' });
  const glow = s.row('Table glow', N, 1, 10, ['r', 'g', 'b'], { icon: 'pixel' });
  const ambient = s.row('Ambient', 2, 1, 40, ['dim', 'r', 'g', 'b', 'w'], { icon: 'wash' });
  const gGlow = s.group('Table glow', glow), gAmb = s.group('Ambient', ambient); s.group('Object spots', spots);
  s.map('Exhibit table', 2, [...line(spots, 0.1, 0.9, 0.3), ...line(glow, 0.1, 0.9, 0.6), [ambient[0], 0.05, 0.9], [ambient[1], 0.95, 0.9]]);
  // Scenes 1-6 are the stations, so a trigger can play scene {station}.
  for (let k = 0; k < N; k++)
    s.scene(`Station ${k + 1}`, [...L(spots.filter((_, j) => j !== k), 'dim', pct(15)), ...L([spots[k]], 'dim', 255),
      ...rgb([glow[k]], 255, 255, 255), ...colour(ambient, 40, 60, 120, pct(30))]);
  const attractBase = s.scene('Attract base', [...L(spots, 'dim', pct(45)), ...colour(ambient, 60, 90, 200, pct(50))]);
  s.scene('Sleep', [...L(spots, 'dim', pct(10)), ...colour(ambient, 20, 30, 80, pct(15))]);
  s.timeline({ name: 'Attract', length: 30000, loop: true, group: 'A',
    tracks: [{ name: 'Base', fixtures: [], groups: [] }, { name: 'Table glow', fixtures: [], groups: [gGlow] }, { name: 'Ambient', fixtures: [], groups: [gAmb] }],
    cues: [{ t: 0, fade: 3000, scene: attractBase },
      { t: 0, track: 1, fade: 2000, effect: s.effect('Chase'), params: { speed: 0.25, width: 0.3, color: '#ffc040', back: '#201000' }, dim: 100 },
      { t: 0, track: 2, fade: 3000, effect: s.effect('Breathe'), params: { speed: 0.08, color: '#4060ff', low: 0.4 }, dim: 60 }] });

  s.sec('== START', 'red', 'Buttons and the presence sensor are on the Kiss-Box inputs (slot 1); the LED rings in the buttons on slot 2.');
  s.trig('Startup', 'startup', {}, ['fire trigger "Back to attract" after 3']);
  s.trig('Back to attract', 'manual', {}, ['mode Exhibit Attract', 'release all fade 3', 'start timeline Attract', 'brightsign screen play Video attract.mp4',
    'repeat 6 times kissbox buttons 2.{i} on', 'var station = 0']);

  s.sec('== BUTTONS', 'purple', 'Each button sets "station" and fires "Play station". Pressing another button while a video plays switches to that one.');
  for (let k = 1; k <= N; k++)
    s.trig(`Button ${k}`, 'variable', { variable: `btn${k}`, value: 'on' }, [`var station = ${k}`, `var presses_${k} ++`, 'fire trigger "Play station"'], [],
      { cooldown: 2, onlyIn: { group: 'Exhibit', states: ['Attract', 'Playing'] } });
  s.trig('Play station', 'manual', {}, ['cancel trigger "Back to attract"', 'mode Exhibit Playing', 'release all fade 1', 'scene {station} fade 1',
    'kissbox buttons 2 all 0 0 0 0 0 0 0 0', 'kissbox buttons 2.{station} on', 'brightsign screen play Video station{station}.mp4',
    'log Station {station} pressed', 'fire trigger "Back to attract" after 75'],
    [], { notes: 'Videos are max. 70 s; after 75 s the exhibit goes back to attract by itself. Name the files station1.mp4 … station6.mp4 on the BrightSign.' });
  s.trig('Video ended (BrightSign)', 'variable', { variable: 'video_state', value: 'ended' }, ['fire trigger "Back to attract"'], ['mode Exhibit is Playing'],
    { notes: 'With the KD plugin: give the presentation a Send Plugin Message "zone Video ended" (plugin kdlink) when a station video ends; zone 1 follows variable video_state.' });

  s.sec('== PRESENCE', 'green', 'Nobody at the table for 5 minutes: the screen sleeps and the light dims. The first visitor wakes it up again.');
  s.trig('Someone there', 'variable', { variable: 'presence', value: 'on' }, ['cancel trigger "Go to sleep"', 'if mode Exhibit is Sleep then fire trigger "Back to attract"']);
  s.trig('Nobody there', 'variable', { variable: 'presence', value: 'off' }, ['fire trigger "Go to sleep" after 300']);
  s.trig('Go to sleep', 'manual', {}, ['mode Exhibit Sleep', 'release all fade 10', 'scene Sleep fade 10', 'brightsign screen event sleep', 'kissbox buttons 2 all 0 0 0 0 0 0 0 0'],
    ['mode Exhibit is Attract']);

  s.sec('== STAFF', 'cyan', 'Staff panel: out of order, statistics. Out of order ignores the buttons (the button triggers are only active in Attract and Playing).');
  s.trig('CLICK Out of order', 'panel', { control: 'Out of order', event: 'click' }, ['if mode Exhibit is "Out of order" then fire trigger "Back to attract" else mode Exhibit "Out of order"']);
  s.trig('HOLD Reset counters', 'panel', { control: 'Reset counters', event: 'hold', hold: 3 },
    [...Array.from({ length: N }, (_, k) => `var presses_${k + 1} = 0`), 'log Press counters reset']);
  s.trig('Opening 10:00', 'time', { at: '10:00:00' }, ['fire trigger "Back to attract"'], ['mode Exhibit is Sleep']);
  s.trig('Closing 17:00', 'time', { at: '17:00:00' }, ['mode Exhibit Sleep', 'release all fade 10', 'brightsign screen event sleep', 'kissbox buttons 2 all 0 0 0 0 0 0 0 0']);
  s.trig('Daily statistics 17:05', 'time', { at: '17:05:00' }, ['log Presses: 1={presses_1} 2={presses_2} 3={presses_3} 4={presses_4} 5={presses_5} 6={presses_6}']);

  const vars = { '1.7': 'presence' };
  for (let k = 1; k <= N; k++) vars[`1.${k}`] = `btn${k}`;
  const names = { '1.7': 'Presence sensor', '1.8': 'Spare' };
  for (let k = 1; k <= N; k++) { names[`1.${k}`] = `Button ${k}`; names[`2.${k}`] = `LED ring ${k}`; }
  return s.build({ name: 'Hands-on exhibit - 6 buttons',
    modes: [{ name: 'Exhibit', states: ['Attract', 'Playing', 'Sleep', 'Out of order'], startup: 'Attract', stateInfo: {
      Attract: { color: '#3a7bd5', icon: '✨' }, Playing: { color: '#2e7d32', icon: '▶' }, Sleep: { color: '#616161', icon: '💤' },
      'Out of order': { color: '#b71c1c', icon: '⛔', enter: ['release all fade 2', 'scene "Attract base" fade 2', 'brightsign screen play Video out-of-order.png',
        'kissbox buttons 2 all 0 0 0 0 0 0 0 0'] } } }],
    variables: [
      ...Array.from({ length: N }, (_, k) => ({ name: `btn${k + 1}`, type: 'bool', initial: false })),
      { name: 'presence', type: 'bool', initial: false }, { name: 'station', type: 'number', initial: 0 }, { name: 'video_state', type: 'text', initial: '' },
      ...Array.from({ length: N }, (_, k) => ({ name: `presses_${k + 1}`, type: 'number', initial: 0, persist: true }))],
    drivers: [{ id: 1, type: 'kissbox', name: 'buttons', ip: '192.168.1.121', port: 9813, listenPort: 9813, frame: 'IO3', cards: ['DI8DC', 'DO8SK', ''], names, vars },
      { id: 2, type: 'brightsign', name: 'screen', ip: '192.168.1.125', port: 80, user: 'admin', password: '', udpPort: 5000, plugin: true, pluginPort: 5010,
        vars: { 'z1': 'video_state' }, commands: [] }],
    triggerColorNames: { red: 'Start', purple: 'Buttons', green: 'Presence', cyan: 'Staff' },
    panel: { theme: {}, panels: [{ id: 1, name: 'Staff', title: 'Hands-on exhibit', start: 1 }], pages: [
      { id: 1, name: 'Staff', columns: 3, pin: '1234', controls: [
        { type: 'button', name: 'Out of order', text: 'Out of order on/off', color: '#b71c1c', span: 2 }, { type: 'clock' },
        ...Array.from({ length: N }, (_, k) => ({ type: 'label', name: `lbl_p${k + 1}`, text: `Button ${k + 1}:`, var: `presses_${k + 1}` })),
        { type: 'button', name: 'Reset counters', text: 'Reset counters (hold 3 s)', color: '#424242', span: 3 },
      ] }] },
  });
};

// =====================================================================================
// 4. Story diorama: narration in 3 languages with light cues on the objects
// =====================================================================================
shows['story-diorama'] = () => {
  const s = Show();
  const objects = ['Ship', 'Warehouse', 'Market', 'Church', 'Windmill', 'City gate', 'Town hall'];
  const spot = {};
  objects.forEach((o, k) => { spot[o] = s.fx(`Spot ${o.toLowerCase()}`, 1, 1 + k, ['dim'], { icon: 'profile' }); });
  const general = s.fx('General light', 1, 10, ['dim'], { icon: 'dimmer' });
  const sky = s.row('Sky', 12, 1, 20, ['r', 'g', 'b'], { icon: 'pixel' });
  const water = s.row('Water', 4, 1, 60, ['r', 'g', 'b'], { icon: 'pixel' });
  const fire = s.fx('Fire glow', 1, 80, ['r', 'g', 'b'], { icon: 'pixel' });
  const gSky = s.group('Sky', sky), gWater = s.group('Water', water); s.group('Object spots', Object.values(spot));
  const pos = { Ship: [0.15, 0.7], Warehouse: [0.3, 0.55], Market: [0.45, 0.6], Church: [0.55, 0.35], Windmill: [0.8, 0.3], 'City gate': [0.9, 0.6], 'Town hall': [0.65, 0.55] };
  s.map('Diorama', 2, [...objects.map((o) => [spot[o], ...pos[o]]), ...line(sky, 0.05, 0.95, 0.08), ...line(water, 0.05, 0.3, 0.9), [fire, 0.32, 0.45], [general, 0.5, 0.95]]);
  const day = s.scene('Diorama day', [...L([general], 'dim', pct(60)), ...rgb(sky, 120, 170, 255), ...rgb(water, 0, 60, 120)]);
  const rest = s.scene('Rest', [...L([general], 'dim', pct(40)), ...L(Object.values(spot), 'dim', pct(20)), ...rgb(sky, 60, 90, 160), ...rgb(water, 0, 30, 70)]);
  const night = s.scene('Night', [...L([general], 'dim', pct(8)), ...rgb(water, 0, 10, 30)]);
  const shimmer = s.effect('Water shimmer', `// Light on water: slow waves with sparkles
param speed = 0.2 [0, 1]       // waves per second
param color = #1060a0          // colour of the water
k = 0.6 + 0.4 * sin((u * 3 + t * speed) * tau)
r, g, b = color
dim = k * (0.85 + 0.15 * noise(t * 4 + i * 7))`);
  const sunset = s.effect('XY gradient'), stars = s.effect('Twinkle'), flames = s.effect('Fire');
  // The story in Dutch, in seconds; the other languages take longer or shorter (their audio files).
  const story = [[0, 'intro'], [20, 'Ship'], [45, 'Warehouse'], [70, 'Market'], [95, 'Church'], [120, 'evening'], [140, 'fire'], [170, 'night'],
    [190, 'Windmill'], [205, 'City gate'], [220, 'Town hall'], [240, 'end']];
  const langs = [['NL', 'Dutch', 1], ['EN', 'English', 0.92], ['DE', 'German', 1.12]];
  const spotScene = {};
  for (const o of objects) spotScene[o] = s.scene(`Highlight ${o.toLowerCase()}`, L([spot[o]], 'dim', 255));
  const tls = {};
  for (const [code, lang, f] of langs) {
    const T = (x) => Math.round(x * f) * 1000;
    const cues = [{ t: 0, fade: 3000, scene: day }, { t: 0, track: 2, fade: 3000, effect: shimmer, params: {}, dim: 100 }];
    for (let k = 0; k < story.length; k++) {
      const [at, what] = story[k], next = story[k + 1] ? story[k + 1][0] : at + 10;
      if (spot[what]) cues.push({ t: T(at), track: 3, fade: 1500, len: T(next) - T(at), out: 1500, scene: spotScene[what] });
      if (what === 'evening') cues.push({ t: T(at), track: 1, fade: 10000, len: T(50), out: 5000, effect: sunset, params: { angle: 90, c1: '#ff7020', c2: '#301060' }, dim: 100 });
      if (what === 'fire') cues.push({ t: T(at), track: 4, fade: 2000, len: T(30), out: 8000, effect: flames, params: { speed: 4 }, dim: 100 });
      if (what === 'night') {
        cues.push({ t: T(at), fade: 5000, scene: night });
        cues.push({ t: T(at), track: 1, fade: 5000, len: T(20), out: 8000, effect: stars, params: { speed: 0.3, amount: 0.5 }, dim: 100 });
      }
      if (what === 'Windmill') cues.push({ t: T(at), fade: 10000, scene: day, path: 'braked' });
    }
    tls[code] = s.timeline({ name: `Story ${code}`, length: T(250), group: 'A',
      tracks: [{ name: 'Base', fixtures: [], groups: [] }, { name: 'Sky', fixtures: [], groups: [gSky] }, { name: 'Water', fixtures: [], groups: [gWater] },
        { name: 'Spots', fixtures: Object.values(spot), groups: [] }, { name: 'Fire', fixtures: [fire], groups: [] }], cues });
    tls[code + 'lang'] = lang;
  }
  s.timeline({ name: 'Rest', length: 40000, loop: true, group: 'A',
    tracks: [{ name: 'Base', fixtures: [], groups: [] }, { name: 'Sky', fixtures: [], groups: [gSky] }, { name: 'Water', fixtures: [], groups: [gWater] }],
    cues: [{ t: 0, fade: 5000, scene: rest }, { t: 0, track: 1, fade: 5000, effect: s.effect('Breathe'), params: { speed: 0.04, color: '#6080c0', low: 0.6 }, dim: 80 },
      { t: 0, track: 2, fade: 5000, effect: shimmer, params: { speed: 0.1 }, dim: 60 }] });

  s.sec('== START', 'red', 'Needs the Machine Control build: three language buttons on in0-in2 with their LEDs on out0-out2, a staff key switch on in3.');
  s.trig('Startup', 'startup', {}, ['fire trigger "Back to rest" after 3']);
  s.trig('Back to rest', 'manual', {}, ['mode Diorama Rest', 'release all fade 5', 'start timeline Rest', 'brightsign audio stop Audio', 'io out0 on', 'io out1 on', 'io out2 on']);

  s.sec('== LANGUAGES', 'purple', 'One timeline per language: same light cues, timed to its own narration. Change the story in tools/make-examples.js and all three follow.');
  langs.forEach(([code, lang], k) => {
    s.trig(`Button ${lang} (in${k})`, 'input', { io: `in${k}`, edge: 'rising' }, [`fire trigger "Story ${code}"`], [], { cooldown: 2, onlyIn: { group: 'Diorama', states: ['Rest'] } });
    s.trig(`Story ${code}`, 'manual', {}, ['mode Diorama Playing', `start timeline "Story ${code}"`, `brightsign audio play Audio story_${code.toLowerCase()}.mp3`,
      'io all off', `io out${k} on`, `var plays_${code.toLowerCase()} ++`], ['mode Diorama is Rest'], { whileRunning: 'ignore' });
    s.trig(`Story ${code} finished`, 'timeline', { timeline: tls[code], on: 'end' }, ['fire trigger "Back to rest"']);
  });
  s.trig('Invite: blink the buttons', 'interval', { seconds: 30 }, ['repeat 3 times every 0.4 io out{=i-1} off', 'sleep 1', 'io out0 on', 'io out1 on', 'io out2 on'],
    ['mode Diorama is Rest', 'time between 10:00 17:00']);

  s.sec('== STAFF', 'cyan', 'Key switch on in3: maintenance light on all objects (aiming the spots, cleaning the glass).');
  s.trig('Key switch on', 'input', { io: 'in3', edge: 'rising' }, ['mode Diorama Maintenance']);
  s.trig('Key switch off', 'input', { io: 'in3', edge: 'falling' }, ['fire trigger "Back to rest"'], ['mode Diorama is Maintenance']);
  s.trig('Closing 17:00', 'time', { at: '17:00:00' }, ['mode Diorama Closed', 'release all fade 10', 'brightsign audio stop Audio', 'io all off']);
  s.trig('Opening 10:00', 'time', { at: '10:00:00' }, ['fire trigger "Back to rest"'], ['calendar Closed inactive']);

  return s.build({ name: 'Story diorama - 3 languages',
    modes: [{ name: 'Diorama', states: ['Rest', 'Playing', 'Maintenance', 'Closed'], startup: 'Rest', stateInfo: {
      Rest: { color: '#3a7bd5', icon: '⏸' }, Playing: { color: '#2e7d32', icon: '🔊' }, Closed: { color: '#616161', icon: '🌙' },
      Maintenance: { color: '#f9a825', icon: '🔧', enter: ['release all fade 2', 'brightsign audio stop Audio', 'set 1.1-10 255'], leave: ['clear overrides'] } } }],
    variables: [{ name: 'plays_nl', type: 'number', initial: 0, persist: true }, { name: 'plays_en', type: 'number', initial: 0, persist: true },
      { name: 'plays_de', type: 'number', initial: 0, persist: true }],
    calendar: [...HOLIDAYS],
    drivers: [{ id: 1, type: 'brightsign', name: 'audio', ip: '192.168.1.125', port: 80, user: 'admin', password: '', udpPort: 5000, plugin: true, pluginPort: 5010, vars: {}, commands: [] }],
    machineControl: { in0: { name: 'Button Dutch' }, in1: { name: 'Button English' }, in2: { name: 'Button German' }, in3: { name: 'Staff key switch' },
      out0: { name: 'LED Dutch' }, out1: { name: 'LED English' }, out2: { name: 'LED German' } },
    triggerColorNames: { red: 'Start', purple: 'Languages', cyan: 'Staff' },
  });
};

// =====================================================================================
// 5. Auditorium: presets for lectures, films and breaks from a lectern touch panel
// =====================================================================================
shows['auditorium'] = () => {
  const s = Show();
  const house = s.row('House', 4, 1, 1, ['dim'], { curve: 'square', icon: 'dimmer' });
  const stage = s.row('Stage wash', 2, 1, 10, ['dim', 'r', 'g', 'b', 'w'], { icon: 'wash' });
  const podium = s.fx('Podium spot', 1, 20, ['dim'], { icon: 'profile' });
  const reading = s.fx('Lectern light', 1, 21, ['dim'], { icon: 'dimmer' });
  const aisle = s.fx('Aisle lights', 1, 22, ['dim'], { icon: 'dimmer' });
  const clean = s.fx('Cleaning light', 1, 23, ['dim'], { curve: 'nondim', icon: 'relay' });
  s.group('House', house); s.group('Stage', [...stage, podium]);
  s.map('Hall', 1.5, [...line(house, 0.2, 0.8, 0.6), ...line(stage, 0.3, 0.7, 0.2), [podium, 0.5, 0.25], [reading, 0.75, 0.25], [aisle, 0.5, 0.9], [clean, 0.5, 0.5]]);
  const warm = (lv) => [...colour(stage, 255, 200, 150, pct(lv)), ...L(stage, 'w', pct(lv))];
  s.scene('Walk-in', [...L(house, 'dim', pct(80)), ...warm(50), ...L([aisle], 'dim', pct(50))]);
  s.scene('Lecture', [...L(house, 'dim', pct(30)), ...warm(100), ...L([podium], 'dim', 255), ...L([reading], 'dim', pct(70)), ...L([aisle], 'dim', pct(20))]);
  s.scene('Film', [...L([aisle], 'dim', pct(15)), ...L([reading], 'dim', pct(10))]);
  s.scene('Break', [...L(house, 'dim', 255), ...warm(40), ...L([aisle], 'dim', pct(50))]);
  s.scene('Cleaning', [...L([...house, clean], 'dim', 255)]);
  const presets = ['Walk-in', 'Lecture', 'Film', 'Break', 'Cleaning'];

  s.sec('== PRESETS', 'purple', 'Every preset is a state of the Hall mode group: what it does is on the Modes page (light, screen, blinds, projector). The buttons only pick the state.');
  s.trig('Startup', 'startup', {}, ['panel lbl_hall text Hall: {mode.Hall}']);
  for (const p of presets) s.trig(`CLICK ${p}`, 'panel', { control: p, event: 'click' }, [`mode Hall ${p}`]);
  s.trig('HOLD Hall off', 'panel', { control: 'Hall off', event: 'hold', hold: 2 }, ['mode Hall Off']);
  s.trig('Mode -> panel', 'mode', { group: 'Hall' }, ['panel lbl_hall text Hall: {mode}', ...presets.map((p) => `panel ${p} reset`),
    'if mode Hall not Off then panel {mode} flash on']);

  s.sec('== LECTERN CONTROLS', 'cyan', 'Fine-tuning during a talk. A preset clears these overrides again.');
  s.trig('House slider', 'panel', { control: 'House level', event: 'change' }, ['set 1.1-4 {=round(value*2.55)}']);
  s.trig('Podium slider', 'panel', { control: 'Podium level', event: 'change' }, ['set 1.20 {=round(value*2.55)}']);
  s.trig('CLICK Screen down', 'panel', { control: 'Screen down', event: 'click' }, ['netio stage output 1 pulse 25']);
  s.trig('CLICK Screen up', 'panel', { control: 'Screen up', event: 'click' }, ['netio stage output 2 pulse 25']);
  s.trig('CLICK Blinds down', 'panel', { control: 'Blinds down', event: 'click' }, ['knx building write "Blinds hall" on']);
  s.trig('CLICK Blinds up', 'panel', { control: 'Blinds up', event: 'click' }, ['knx building write "Blinds hall" off']);
  s.trig('Picture mute', 'panel', { control: 'Picture mute', event: 'change' }, ['if var pj_mute = on then projector "Laser PJ" mute on else projector "Laser PJ" mute off']);
  s.trig('CLICK Lectern PC', 'panel', { control: 'Lectern PC', event: 'click' }, ['pc "Lectern PC" wake']);

  s.sec('== BUILDING', 'orange', 'Fire alarm from KNX, room booking system over UDP, a safety switch-off at night.');
  s.trig('Fire alarm (KNX)', 'variable', { variable: 'fire_alarm', value: 'on' }, ['mode Hall Break', 'projector "Laser PJ" mute on', 'netio stage output 2 pulse 25'],
    [], { notes: 'All house light on, picture off, screen up.' });
  s.trig('UDP HALL LECTURE', 'udp', { match: 'HALL LECTURE' }, ['mode Hall Lecture', 'reply OK\\r']);
  s.trig('UDP HALL OFF', 'udp', { match: 'HALL OFF' }, ['mode Hall Off', 'reply OK\\r']);
  s.trig('Auto off 23:00', 'time', { at: '23:00:00' }, ['mode Hall Off'], ['mode Hall not Off']);
  s.trig('Projector warning', 'projector', { projector: 'Laser PJ', alarm: 'any', level: 'warning' }, ['email ' + TECH + ' "Auditorium projector: {alarm}" {alarm} is {state}']);

  const screenDown = 'netio stage output 1 pulse 25', screenUp = 'netio stage output 2 pulse 25';
  const lights = (p) => ['clear overrides', 'release all fade 3', `scene "${p}" fade 3`];
  return s.build({ name: 'Auditorium - lecture hall',
    modes: [{ name: 'Hall', states: ['Off', ...presets], stateInfo: {
      Off: { color: '#616161', icon: '⏻', enter: ['clear overrides', 'release all fade 5', 'projector "Laser PJ" off', screenUp, 'knx building write "Blinds hall" off', 'netio stage output 3 off'] },
      'Walk-in': { color: '#3a7bd5', icon: '🚶', enter: [...lights('Walk-in'), 'netio stage output 3 on', 'projector "Laser PJ" on', 'pc "Lectern PC" wake'] },
      Lecture: { color: '#2e7d32', icon: '🎤', enter: [...lights('Lecture'), 'netio stage output 3 on', 'projector "Laser PJ" on', 'projector "Laser PJ" mute off', screenDown] },
      Film: { color: '#6a4c93', icon: '🎬', enter: [...lights('Film'), 'netio stage output 3 on', 'projector "Laser PJ" on', 'projector "Laser PJ" mute off', screenDown, 'knx building write "Blinds hall" on'] },
      Break: { color: '#d29922', icon: '☕', enter: [...lights('Break'), 'projector "Laser PJ" mute on', 'knx building write "Blinds hall" off'] },
      Cleaning: { color: '#f9a825', icon: '🧹', enter: [...lights('Cleaning'), 'projector "Laser PJ" off', screenUp] },
    } }],
    pcs: [pc(1, 'Lectern PC', '192.168.1.41', '00:1B:21:3A:60:01')],
    projectors: [pj(1, 'Laser PJ', '192.168.1.101')],
    variables: [{ name: 'pj_mute', type: 'bool', initial: false }, { name: 'fire_alarm', type: 'bool', initial: false }],
    drivers: [{ id: 1, type: 'netio', name: 'stage', ip: '192.168.1.127', port: 80, user: 'netio', password: 'netio', model: '4PZ', outputs: 4, live: true, vars: {} },
      { id: 2, type: 'knx', name: 'building', ip: '192.168.1.123', port: 3671, vars: {}, addresses: [
        { ga: '2/1/1', dpt: '1', name: 'Blinds hall' }, { ga: '3/1/1', dpt: '5.001', name: 'Ventilation hall' }, { ga: '9/0/1', dpt: '1', name: 'Fire alarm', var: 'fire_alarm' }] }],
    triggerColorNames: { purple: 'Presets', cyan: 'Lectern', orange: 'Building' },
    panel: { theme: {}, panels: [{ id: 1, name: 'Lectern', title: 'Auditorium', start: 1 }], pages: [
      { id: 1, name: 'Presets', columns: 3, controls: [
        { type: 'label', name: 'lbl_hall', text: 'Hall: -', span: 2 }, { type: 'clock' },
        { type: 'button', name: 'Walk-in', text: 'Walk-in', color: '#3a7bd5' }, { type: 'button', name: 'Lecture', text: 'Lecture', color: '#2e7d32' },
        { type: 'button', name: 'Film', text: 'Film', color: '#6a4c93' }, { type: 'button', name: 'Break', text: 'Break', color: '#d29922' },
        { type: 'button', name: 'Cleaning', text: 'Cleaning', color: '#f9a825' }, { type: 'button', name: 'Hall off', text: 'Off (hold)', color: '#b71c1c' },
        { type: 'button', name: 'More', text: 'Screen, blinds, levels…', color: '#424242', goto: 2, span: 3 },
      ] },
      { id: 2, name: 'Controls', columns: 4, controls: [
        { type: 'slider', name: 'House level', text: 'House', min: 0, max: 100, step: 1, unit: ' %', vertical: true, rows: 3 },
        { type: 'slider', name: 'Podium level', text: 'Podium', min: 0, max: 100, step: 1, unit: ' %', vertical: true, rows: 3 },
        { type: 'button', name: 'Screen down', text: 'Screen ↓', color: '#3a4a6b' }, { type: 'button', name: 'Screen up', text: 'Screen ↑', color: '#3a4a6b' },
        { type: 'button', name: 'Blinds down', text: 'Blinds ↓', color: '#3a4a6b' }, { type: 'button', name: 'Blinds up', text: 'Blinds ↑', color: '#3a4a6b' },
        { type: 'toggle', name: 'Picture mute', text: 'Picture mute', var: 'pj_mute' }, { type: 'button', name: 'Lectern PC', text: 'Wake PC', color: '#3a4a6b' },
        { type: 'button', name: 'Back', text: '← Presets', color: '#424242', goto: 1, span: 4 },
      ] }] },
  });
};

// =====================================================================================
// 6. Whole building: staged start-up and shut-down of all A/V, with a morning report
// =====================================================================================
shows['building-startup'] = () => {
  const s = Show();
  const down = s.row('Entrance downlight', 4, 1, 1, ['dim'], { icon: 'dimmer' });
  const lobby = s.row('Lobby wall', 2, 1, 10, ['dim', 'r', 'g', 'b', 'w'], { icon: 'wash' });
  s.map('Lobby', 2, [...line(down, 0.2, 0.8, 0.3), [lobby[0], 0.1, 0.7], [lobby[1], 0.9, 0.7]]);
  s.scene('Lobby open', [...L(down, 'dim', pct(90)), ...colour(lobby, 255, 210, 160, pct(70)), ...L(lobby, 'w', 255)]);
  s.scene('Lobby night', [...L(down, 'dim', pct(15))]);
  const floors = [['floor0', 'Ground floor', ['Entrance', 'Ticketing', 'Shop'], ['Entrance']],
    ['floor1', 'First floor', ['Room 1.1', 'Room 1.2', 'Room 1.3'], ['Room 1.1', 'Room 1.2']],
    ['floor2', 'Second floor', ['Room 2.1', 'Room 2.2', 'Room 2.3'], ['Room 2.1', 'Room 2.2', 'Room 2.3']]];
  const pcs = [], pjs = [], groups = [];
  floors.forEach(([g, , rooms, pjRooms], f) => {
    const pcNames = rooms.map((r, k) => { const id = pcs.length + 1; const name = `PC ${r}`; pcs.push(pc(id, name, `192.168.${10 + f}.${41 + k}`, `00:1B:21:${10 + f}:00:${String(41 + k).padStart(2, '0')}`)); return name; });
    const pjNames = pjRooms.map((r, k) => { const id = pjs.length + 1; const name = `PJ ${r}`; pjs.push(pj(id, name, `192.168.${10 + f}.${101 + k}`)); return name; });
    groups.push({ name: g, kind: 'pc', devices: pcNames }, { name: g, kind: 'projector', devices: pjNames });
  });
  groups.push({ name: 'pdus', kind: 'netio', devices: ['pdu0', 'pdu1', 'pdu2'] });
  const report = [...pcs, ...pjs].map((d) => `if device "${d.name}" is offline then var problems = "{problems} [${d.name}]"`);

  s.sec('== START-UP', 'green', 'Tuesday to Sunday. Order matters: power first, then PCs, then projectors; and the other way round at night, with time for the projectors to cool down.');
  s.trig('Startup', 'startup', {}, ['if mode Building is Open then scene "Lobby open" fade 5 else scene "Lobby night" fade 5', 'panel lbl_building text Building: {mode.Building}']);
  s.trig('Start building 08:30', 'time', { at: '08:30:00', days: ['tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, ['mode Building Starting'], ['calendar Closed inactive', 'mode Building is Off']);
  s.trig('Start-up report', 'manual', {}, ['var problems = ""', ...report,
    'if var problems = "" then log Start-up OK: all devices online else email ' + TECH + ' "Start-up: devices offline" Not answering:{problems}',
    'if var problems = "" then panel lbl_report text All devices online else panel lbl_report text Offline: {problems}'], [], { notes: 'Every PC and projector is checked once; one email lists all that are missing.' });
  s.trig('Stop building 17:30', 'time', { at: '17:30:00' }, ['mode Building Stopping'], ['mode Building is Open']);
  s.trig('Weekly reboot (Monday 07:00)', 'time', { at: '07:00:00', days: ['mon'] }, ['netio pdus output all on', 'sleep 60', 'pc all wake', 'sleep 300', 'pc all reboot', 'sleep 300', 'pc all shutdown', 'sleep 120', 'netio pdus output all off'],
    [], { notes: 'Monday the museum is closed: the PCs get their Windows updates and a fresh start.' });

  s.sec('== FAÇADE', 'orange', 'The façade lighting runs on a Pharos controller; KD only tells it when.');
  s.trig('Sunset: façade on', 'time', { at: 'sunset', offset: -10 }, ['pharos facade timeline 1 start fade 5']);
  s.trig('King\'s Day: orange façade', 'time', { at: 'sunset', offset: -5 }, ['pharos facade timeline 2 start fade 5'], ['calendar "King\'s Day" active']);
  s.trig('Façade off 23:00', 'time', { at: '23:00:00' }, ['pharos facade release all fade 10']);

  s.sec('== FRONT DESK', 'cyan', 'A tablet at the front desk: start or stop the building by hand, per floor if needed.');
  s.trig('CLICK Start building', 'panel', { control: 'Start building', event: 'click' }, ['mode Building Starting'], ['mode Building is Off']);
  s.trig('HOLD Shut down', 'panel', { control: 'Shut down', event: 'hold', hold: 3 }, ['mode Building Stopping'], ['mode Building not Off']);
  s.trig('CLICK Evening event', 'panel', { control: 'Evening event', event: 'click' }, ['if mode Building is Event then mode Building Open else mode Building Event'],
    [], { notes: 'Event: the 17:30 shut-down is skipped. Press again (or Shut down) when the event is over.' });
  floors.forEach(([g, label], f) => {
    s.trig(`CLICK ${label} on`, 'panel', { control: `${label} on`, event: 'click' }, [`netio pdu${f} output all on`, 'sleep 30', `pc ${g} wake`, `projector ${g} on`]);
    s.trig(`HOLD ${label} off`, 'panel', { control: `${label} off`, event: 'hold', hold: 2 }, [`projector ${g} off`, `pc ${g} shutdown`, 'sleep 240', `netio pdu${f} output all off`]);
  });
  s.trig('Mode -> panel', 'mode', { group: 'Building' }, ['panel lbl_building text Building: {mode}']);

  s.sec('== MONITORING', 'blue', 'Email when a device drops out while the building is open. The Monitoring page shows the full picture.');
  s.trig('Device offline', 'device', { device: '', state: 'offline' }, ['email ' + TECH + ' "{device} offline" {kind} {device} stopped answering'], ['mode Building is Open']);
  s.trig('Projector warning', 'projector', { projector: '', alarm: 'any', level: 'warning' }, ['email ' + TECH + ' "{projector}: {alarm}" {alarm} is {state}, lamp {lamp} h']);

  const allPdus = 'netio pdus output all';
  return s.build({ name: 'Museum building - start-up and shut-down', ip: '192.168.1.50',
    modes: [{ name: 'Building', states: ['Off', 'Starting', 'Open', 'Event', 'Stopping'], var: 'building_state', stateInfo: {
      Off: { color: '#616161', icon: '🌙' },
      Starting: { color: '#d29922', icon: '⏳', enter: [`${allPdus} on`, 'log Racks powered', 'sleep 60', 'pc floor0 wake', 'pc floor1 wake', 'pc floor2 wake', 'sleep 30',
        'projector all on', 'release all fade 20', 'scene "Lobby open" fade 20', 'sleep 180', 'monitor check', 'sleep 15', 'fire trigger "Start-up report"', 'mode Building Open'] },
      Open: { color: '#3fb950', icon: '🟢' },
      Event: { color: '#8957e5', icon: '🥂' },
      Stopping: { color: '#ff9f43', icon: '⏬', enter: ['projector all off', 'pc all shutdown', 'release all fade 60', 'scene "Lobby night" fade 60',
        '# projectors cool down and Windows shuts down before the power goes', 'sleep 300', `${allPdus} off`, 'mode Building Off'] },
    } }],
    deviceGroups: groups, pcs, projectors: pjs,
    variables: [{ name: 'problems', type: 'text', initial: '' }, { name: 'building_state', type: 'number', initial: 0, persist: true }],
    calendar: [...HOLIDAYS, { name: 'King\'s Day', from: '04-27', to: '04-27' }],
    drivers: [0, 1, 2].map((f) => ({ id: f + 1, type: 'netio', name: `pdu${f}`, ip: `192.168.${10 + f}.120`, port: 80, user: 'netio', password: 'netio', model: '4PZ', outputs: 4, live: true, vars: {} }))
      .concat([{ id: 4, type: 'pharos', name: 'facade', ip: '192.168.1.128', port: 80, live: true, vars: {} }]),
    triggerColorNames: { green: 'Start-up', orange: 'Façade', cyan: 'Front desk', blue: 'Monitoring' },
    panel: { theme: {}, panels: [{ id: 1, name: 'Front desk', title: 'Museum A/V', start: 1 }], pages: [
      { id: 1, name: 'Building', columns: 2, controls: [
        { type: 'label', name: 'lbl_building', text: 'Building: -' }, { type: 'clock' },
        { type: 'button', name: 'Start building', text: 'Start building', color: '#2e7d32' },
        { type: 'button', name: 'Shut down', text: 'Shut down (hold 3 s)', color: '#b71c1c' },
        { type: 'button', name: 'Evening event', text: 'Evening event', color: '#6a4c93', span: 2 },
        { type: 'label', name: 'lbl_report', text: 'Start-up report: -', span: 2 },
        { type: 'button', name: 'Floors', text: 'Per floor…', color: '#424242', goto: 2, span: 2 },
      ] },
      { id: 2, name: 'Floors', columns: 2, pin: '1234', controls: [
        ...floors.flatMap(([, label]) => [{ type: 'button', name: `${label} on`, text: `${label} on`, color: '#3a4a6b' },
          { type: 'button', name: `${label} off`, text: `${label} off (hold)`, color: '#5a2a2a' }]),
        { type: 'button', name: 'Back', text: '← Back', color: '#424242', goto: 1, span: 2 },
      ] }] },
  });
};

// =====================================================================================
// 7. Media museum: 8 BrightSign players, each used in a different way
// =====================================================================================
shows['brightsign-players'] = () => {
  const s = Show();
  const house = s.row('Cinema house', 4, 1, 1, ['dim'], { curve: 'square', icon: 'dimmer' });
  const glow = s.row('Cinema screen glow', 2, 1, 10, ['r', 'g', 'b'], { icon: 'pixel' });
  const corridor = s.row('Corridor spot', 3, 1, 20, ['dim'], { icon: 'profile' });
  const wall = s.row('Wall wash', 6, 1, 30, ['dim', 'r', 'g', 'b', 'w'], { icon: 'wash' });
  const lobby = s.row('Lobby downlight', 4, 1, 70, ['dim'], { icon: 'dimmer' });
  const gGlow = s.group('Cinema glow', glow), gWall = s.group('Video wall wash', wall);
  s.group('Cinema house', house); s.group('Corridor', corridor); s.group('Lobby', lobby);
  s.map('Floor plan', 2, [...line(lobby, 0.05, 0.25, 0.85), ...line(house, 0.35, 0.6, 0.2), ...line(glow, 0.42, 0.53, 0.05),
    ...line(corridor, 0.3, 0.7, 0.6), ...line(wall, 0.72, 0.97, 0.15)]);
  s.scene('Lobby day', L(lobby, 'dim', pct(90)));
  s.scene('Lobby night', L(lobby, 'dim', pct(10)));
  s.scene('Cinema walk-in', L(house, 'dim', pct(80)));
  const cinemaDark = s.scene('Cinema dark', L(house, 'dim', pct(5)));
  s.scene('Corridor idle', L(corridor, 'dim', pct(20)));
  s.scene('Corridor welcome', L(corridor, 'dim', 255));
  s.scene('Emergency', L([...house, ...corridor, ...lobby], 'dim', 255));
  const film = s.timeline({ name: 'Cinema film', length: 600000, group: 'B',
    tracks: [{ name: 'House', fixtures: house, groups: [] }, { name: 'Screen glow', fixtures: [], groups: [gGlow] }],
    cues: [{ t: 0, fade: 6000, scene: cinemaDark, path: 'damped' },
      { t: 0, track: 1, fade: 6000, effect: s.effect('Breathe'), params: { speed: 0.05, color: '#3060ff', low: 0.3 }, dim: 40 }] });
  const wallShow = s.timeline({ name: 'Wall show', length: 90000, group: 'C',
    tracks: [{ name: 'Wall', fixtures: [], groups: [gWall] }],
    cues: [{ t: 0, fade: 3000, len: 30000, out: 2000, effect: s.effect('Chase'), params: { speed: 0.3, width: 0.3, color: '#40a0ff', back: '#000820' }, dim: 100 },
      { t: 30000, fade: 2000, len: 30000, out: 2000, effect: s.effect('XY gradient'), params: { speed: 0.05, c1: '#ff6020', c2: '#6020ff' }, dim: 100 },
      { t: 60000, fade: 2000, len: 30000, out: 5000, effect: s.effect('Breathe'), params: { speed: 0.2, color: '#ffffff', low: 0.2 }, dim: 80 }] });

  s.sec('== MUSEUM', 'red', 'The Museum mode group switches every player at once through the device group "screens" (a UDP command, so it works with and without the KD plugin).');
  s.trig('Startup', 'startup', {}, ['if mode Museum is Open then mode Museum Open else mode Museum Closed']);
  s.trig('Open 10:00', 'time', { at: '10:00:00' }, ['mode Museum Open'], ['calendar Closed inactive']);
  s.trig('Close 17:00', 'time', { at: '17:00:00' }, ['mode Museum Closed']);
  s.trig('Mode -> panel', 'mode', { group: 'Museum' }, ['panel lbl_museum text Museum: {mode}']);
  s.trig('Weekly reboot (Monday 07:00)', 'time', { at: '07:00:00', days: ['mon'] }, ['brightsign screens reboot', 'log All players rebooted'],
    [], { notes: 'A fresh start once a week. Through the KD plugin where it is on, else through the DWS.' });
  s.trig('Player offline', 'device', { device: '', state: 'offline' }, ['email ' + TECH + ' "{device} offline" BrightSign {device} stopped answering'], ['mode Museum is Open']);

  s.sec('== 1 LOBBY - plain UDP', 'orange', 'No plugin: the presentation has UDP input events "day", "night" and "emergency", and sends "playing <state>" to the controller on every state. That arrives as Player says (linked to lobby_says).');
  s.trig('Lobby says', 'variable', { variable: 'lobby_says' }, ['panel lbl_lobby text Lobby: {value}']);

  s.sec('== 2 CINEMA - light follows the film', 'purple', 'The UDP command "video3" starts the film. The KD plugin reports the Video zone (z1 -> cinema_video): the light follows what the player really does, also when someone starts the film on the player itself.');
  s.trig('Start film', 'manual', {}, ['brightsign cinema send video3', 'log Film start asked'], ['var cinema_video != "Video 3"']);
  s.trig('Film every hour', 'interval', { seconds: 3600 }, ['fire trigger "Start film"'], ['mode Museum is Open'],
    { notes: 'Plus the button on the panel.' });
  s.trig('Film started', 'variable', { variable: 'cinema_video', value: 'Video 3' }, ['release scene "Cinema walk-in" fade 6', 'start timeline "Cinema film"', 'var films_today ++']);
  s.trig('Film ended', 'variable', { variable: 'cinema_video' }, ['stop timeline "Cinema film" fade 8', 'scene "Cinema walk-in" fade 8'],
    ['var cinema_video != "Video 3"', 'timeline "Cinema film" running']);

  s.sec('== 3 CORRIDOR - motion sensor on the player', 'green', 'A PIR sensor on the player\'s GPIO 0 (gpio0 -> corridor_motion). The presentation keeps its own loop; KD plays a welcome clip and lights the corridor.');
  s.trig('Corridor: someone there', 'variable', { variable: 'corridor_motion', value: 'on' },
    ['cancel trigger "Corridor: empty"', 'scene "Corridor welcome" fade 1', 'brightsign corridor play Video welcome.mp4'], [], { cooldown: 5, onlyIn: { group: 'Museum', states: ['Open'] } });
  s.trig('Corridor: nobody', 'variable', { variable: 'corridor_motion', value: 'off' }, ['fire trigger "Corridor: empty" after 30']);
  s.trig('Corridor: empty', 'manual', {}, ['release scene "Corridor welcome" fade 10']);

  s.sec('== 4 AUDIO GUIDE - user variable', 'cyan', 'An audio-only player. Its presentation has a User Variable "language"; a User Variable event on it switches the audio states. KD sets it, the plugin reports it back (var.language -> guide_language).');
  for (const [code, lang] of [['NL', 'Dutch'], ['EN', 'English'], ['DE', 'German']])
    s.trig(`CLICK Guide ${lang}`, 'panel', { control: `Guide ${code}`, event: 'click' }, [`brightsign guide var language ${code}`]);
  s.trig('Guide language', 'variable', { variable: 'guide_language' }, ['panel lbl_guide text Guide: {value}']);

  s.sec('== 5 SIGNAGE - player -> KD', 'blue', 'The info screen counts visitors (a people counter in the presentation, User Variable "visitors" -> visitors). The Ticker zone (z2) shows what\'s on screen.');
  s.trig('Busy', 'variable', { variable: 'visitors' }, ['panel lbl_visitors flash orange', 'log Busy: {value} visitors'], ['var visitors > 400'], { cooldown: 600 });
  s.trig('New day: visitors', 'time', { at: '00:05:00' }, ['log Visitors yesterday: {visitors}', 'brightsign signage var visitors 0']);

  s.sec('== 6 VITRINE - serial sensor', 'yellow', 'A climate probe on the player\'s serial port sends "TEMP 21.4" lines; the plugin passes them on (serial -> vitrine_climate). Without serial in the presentation: User Variable kdSerial = 9600.');
  s.trig('Vitrine climate', 'variable', { variable: 'vitrine_climate' }, ['panel lbl_vitrine text Vitrine: {value}']);
  s.trig('Climate log every hour', 'interval', { seconds: 3600 }, ['log Vitrine climate: {vitrine_climate}']);

  s.sec('== 7 KIOSK - statistics', 'pink', 'A touch kiosk: visitors pick a chapter on the screen, the presentation handles it all. KD only counts what was watched (z1 -> kiosk_video).');
  s.trig('Kiosk chapter', 'variable', { variable: 'kiosk_video' }, ['var kiosk_plays ++', 'log Kiosk: {value}'], ['var kiosk_video != "Video 1"'],
    { notes: 'Video 1 is the attract loop, not counted.' });

  s.sec('== 8 VIDEO WALL - timed show with light', 'grey', 'At 11:00, 13:00 and 15:00 a Plugin Message "Video_Show" moves the wall\'s Video zone to its Show state (a Plugin Message transition in the presentation), and the wall wash runs along.');
  s.trig('Wall show', 'manual', {}, ['brightsign wall event Video_Show', 'start timeline "Wall show"'], ['mode Museum is Open'], { whileRunning: 'ignore' });
  for (const h of ['11', '13', '15']) s.trig(`Wall show ${h}:00`, 'time', { at: `${h}:00:00` }, ['fire trigger "Wall show"']);
  s.trig('Wall says', 'variable', { variable: 'wall_video' }, ['panel lbl_wall text Wall: {value}']);

  s.sec('== PANEL & SAFETY', 'red', 'Staff panel: /panel. Technician page behind PIN 1234: a test pattern per player, emergency test, reboot.');
  s.trig('CLICK Start film', 'panel', { control: 'Start film', event: 'click' }, ['fire trigger "Start film"']);
  s.trig('CLICK Wall show', 'panel', { control: 'Wall show now', event: 'click' }, ['fire trigger "Wall show"']);
  s.trig('CLICK Open', 'panel', { control: 'Open now', event: 'click' }, ['mode Museum Open']);
  s.trig('HOLD Close', 'panel', { control: 'Close now', event: 'hold', hold: 3 }, ['mode Museum Closed']);
  for (const p of ['cinema', 'corridor', 'signage', 'vitrine', 'kiosk', 'wall'])
    s.trig(`CLICK Test ${p}`, 'panel', { control: `Test ${p}`, event: 'click' }, [`brightsign ${p} test Video Testpattern`]);
  s.trig('HOLD Reboot all', 'panel', { control: 'Reboot all', event: 'hold', hold: 3 }, ['brightsign screens reboot']);
  s.trig('Fire alarm (UDP FIRE ON)', 'udp', { match: 'FIRE ON' }, ['mode Museum Emergency', 'reply OK\\r'], [], { notes: 'From the building\'s fire panel gateway.' });
  s.trig('Fire alarm over (UDP FIRE OFF)', 'udp', { match: 'FIRE OFF' }, ['mode Museum Open', 'reply OK\\r'], ['mode Museum is Emergency']);
  s.trig('HOLD Emergency test', 'panel', { control: 'Emergency test', event: 'hold', hold: 3 }, ['if mode Museum is Emergency then mode Museum Open else mode Museum Emergency']);

  const bs = (id, name, ip, plugin, vars, commands = []) => ({ id, type: 'brightsign', name, ip, port: 80, user: 'admin', password: '', udpPort: 5000,
    plugin, ...(plugin ? { pluginPort: 5010 } : {}), vars, commands });
  const players = [
    bs(1, 'lobby', '192.168.1.131', false, { msg: 'lobby_says' }, [{ name: 'Day', text: 'day' }, { name: 'Night', text: 'night' }]),
    bs(2, 'cinema', '192.168.1.132', true, { z1: 'cinema_video' }, [{ name: 'Start film', text: 'video3' }]),
    bs(3, 'corridor', '192.168.1.133', true, { gpio0: 'corridor_motion' }),
    bs(4, 'guide', '192.168.1.134', true, { 'var.language': 'guide_language' }),
    bs(5, 'signage', '192.168.1.135', true, { 'var.visitors': 'visitors', z2: 'signage_ticker' }),
    bs(6, 'vitrine', '192.168.1.136', true, { serial: 'vitrine_climate' }),
    bs(7, 'kiosk', '192.168.1.137', true, { z1: 'kiosk_video' }),
    bs(8, 'wall', '192.168.1.138', true, { z1: 'wall_video' }),
  ];
  const label = (name, text, v, span = 1) => ({ type: 'label', name, text, ...(v ? { var: v } : {}), span });
  return s.build({ name: 'Media museum - 8 BrightSign players',
    modes: [{ name: 'Museum', states: ['Closed', 'Open', 'Emergency'], stateInfo: {
      Closed: { color: '#616161', icon: '🌙', enter: ['release all fade 30', 'scene "Lobby night" fade 30', 'brightsign screens send night'] },
      Open: { color: '#3fb950', icon: '🟢', enter: ['release all fade 5', 'scene "Lobby day" fade 10', 'scene "Corridor idle" fade 10',
        'scene "Cinema walk-in" fade 10', 'brightsign screens send day'] },
      Emergency: { color: '#b71c1c', icon: '⚠', enter: ['release all fade 0', 'scene Emergency fade 0',
        'brightsign screens send emergency', 'panel lbl_museum flash red'], leave: ['panel lbl_museum reset'] },
    } }],
    deviceGroups: [{ name: 'screens', kind: 'brightsign', devices: players.map((p) => p.name) }],
    variables: [{ name: 'lobby_says', type: 'text', initial: '' }, { name: 'cinema_video', type: 'text', initial: '' },
      { name: 'films_today', type: 'number', initial: 0, persist: true }, { name: 'corridor_motion', type: 'bool', initial: false },
      { name: 'guide_language', type: 'text', initial: '' }, { name: 'visitors', type: 'number', initial: 0 }, { name: 'signage_ticker', type: 'text', initial: '' },
      { name: 'vitrine_climate', type: 'text', initial: '' }, { name: 'kiosk_video', type: 'text', initial: '' },
      { name: 'kiosk_plays', type: 'number', initial: 0, persist: true }, { name: 'wall_video', type: 'text', initial: '' }],
    calendar: [...HOLIDAYS],
    drivers: players,
    triggerColorNames: { red: 'Museum / panel', orange: '1 Lobby', purple: '2 Cinema', green: '3 Corridor', cyan: '4 Audio guide', blue: '5 Signage',
      yellow: '6 Vitrine', pink: '7 Kiosk', grey: '8 Video wall' },
    panel: { theme: {}, panels: [{ id: 1, name: 'Staff', title: 'Media museum', start: 1 }], pages: [
      { id: 1, name: 'Players', columns: 4, controls: [
        label('lbl_museum', 'Museum: -', '', 3), { type: 'clock' },
        label('lbl_lobby', 'Lobby: -', '', 2), label('lbl_cinema', 'Cinema:', 'cinema_video', 2),
        label('lbl_corridor', 'Corridor motion:', 'corridor_motion', 2), label('lbl_guide', 'Guide: -', '', 2),
        label('lbl_visitors', 'Visitors:', 'visitors', 2), label('lbl_vitrine', 'Vitrine: -', '', 2),
        label('lbl_kiosk', 'Kiosk plays:', 'kiosk_plays', 2), label('lbl_wall', 'Wall: -', '', 2),
        { type: 'button', name: 'Start film', text: 'Start film', color: '#6a4c93', span: 2 },
        { type: 'button', name: 'Wall show now', text: 'Wall show now', color: '#3a4a6b', span: 2 },
        { type: 'button', name: 'Guide NL', text: 'Guide NL', color: '#00838f' }, { type: 'button', name: 'Guide EN', text: 'Guide EN', color: '#00838f' },
        { type: 'button', name: 'Guide DE', text: 'Guide DE', color: '#00838f' }, label('lbl_films', 'Films today:', 'films_today'),
        { type: 'button', name: 'Open now', text: 'Open now', color: '#2e7d32', span: 2 },
        { type: 'button', name: 'Close now', text: 'Close (hold 3 s)', color: '#b71c1c', span: 2 },
        { type: 'button', name: 'Technician', text: 'Technician…', color: '#424242', goto: 2, span: 4 },
      ] },
      { id: 2, name: 'Technician', columns: 3, pin: '1234', controls: [
        ...['cinema', 'corridor', 'signage', 'vitrine', 'kiosk', 'wall'].map((p) => ({ type: 'button', name: `Test ${p}`, text: `Test pattern ${p}`, color: '#3a4a6b' })),
        { type: 'button', name: 'Reboot all', text: 'Reboot all players (hold 3 s)', color: '#5a2a2a', span: 2 },
        { type: 'button', name: 'Emergency test', text: 'Emergency on/off (hold 3 s)', color: '#b71c1c' },
        { type: 'button', name: 'Back', text: '← Back', color: '#424242', goto: 1, span: 3 },
      ] }] },
  });
};

// ---------- write ----------
const want = process.argv.slice(2);
for (const [name, make] of Object.entries(shows)) {
  if (want.length && !want.includes(name)) continue;
  const p = make();
  const file = path.join(repo, 'examples', name, 'project.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(p, null, 2));
  console.log(`wrote ${path.relative(repo, file)}: ${p.fixtures.length} fixtures, ${p.timelines.length} timelines, ${p.triggers.filter((t) => t.type !== 'comment').length} triggers`);
}
module.exports = { names: Object.keys(shows) };
