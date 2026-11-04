// PC mock of the controller API so the web UI can be developed without hardware.
//   node tools/mock-server.js [port] [show folder]     ->  http://localhost:8080
// Serves data/www, keeps the project in <show folder>/project.json (default data/show)
// and simulates playback, the live log (SSE) and DMX output. No dependencies.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = +process.argv[2] || 8080;
const ROOT = path.join(__dirname, '..', 'data');
const WWW = path.join(ROOT, 'www');
// A folder of its own per show, so shows made on the PC don't overwrite the sample project.
const SHOW = path.resolve(process.argv[3] || path.join(ROOT, 'show'));
const PROJECT = path.join(SHOW, 'project.json');
const MEDIA = path.join(SHOW, 'media');
if (!fs.existsSync(PROJECT)) {
  fs.mkdirSync(SHOW, { recursive: true });
  fs.writeFileSync(PROJECT, JSON.stringify({ name: 'New show', fixtures: [], groups: [], scenes: [], timelines: [], triggers: [], universes: [{ id: 1, name: 'Universe 1', dmxPort: 1, artnet: 0, sacn: 1 }] }, null, 1));
}
const FX = require(path.join(WWW, 'fx.js'));   // same effect compiler/VM as the web UI
const Model = require(path.join(WWW, 'model.js'));   // same project rules and date maths as the UI
const { slots, footprint, channelRoles, trackFixtureIds, mapPosition, EASE } = Model;
const CATS = ['SYS', 'USB', 'NET', 'DMX', 'ARTNET', 'SACN', 'SHOW', 'TRIG', 'WEB', 'CMD', 'PJLINK'];
const LVLS = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

// ---- log ------------------------------------------------------------------
const ring = [];
let seq = 0;
const levels = Object.fromEntries(CATS.map((c) => [c, 1]));
let t0 = Date.now();   // reset by a simulated restart after a firmware update
const sse = new Set();
function log(l, c, m) {
  if (l < levels[c]) return;
  const e = { s: ++seq, t: Date.now() - t0, e: Math.floor(Date.now() / 1000), l, c, m };
  ring.push(e);
  if (ring.length > 512) ring.shift();
  for (const res of sse) res.write(`event: log\ndata: ${JSON.stringify(e)}\n\n`);
  logFile(e);
}
// The stick's /logs folder (system.log, history/) lives in the show folder here.
const LOGS = path.join(SHOW, 'logs');
// Like Config.h: system.log + system.1.log (newest old one) .. system.4.log, 8 MB each.
const LOG_FILES = 5, LOG_MAX = +process.env.KD_LOG_MAX || 8 * 1024 * 1024;   // KD_LOG_MAX: smaller, to test the rotation
const logPath = (n) => path.join(LOGS, n ? `system.${n}.log` : 'system.log');
const utcStamp = (s) => new Date(s * 1000).toISOString().slice(0, 19).replace('T', ' ');
function logFile(e) {   // like Log::flush: "2026-11-01 12:00:00 [INFO ] SYS    message"
  try {
    fs.mkdirSync(LOGS, { recursive: true });
    fs.appendFileSync(logPath(0), `${utcStamp(e.e)} [${LVLS[e.l].padEnd(5)}] ${e.c.padEnd(6)} ${e.m}\n`);
    if (fs.statSync(logPath(0)).size > LOG_MAX) {
      fs.rmSync(logPath(LOG_FILES - 1), { force: true });
      for (let i = LOG_FILES - 2; i >= 0; i--) if (fs.existsSync(logPath(i))) fs.renameSync(logPath(i), logPath(i + 1));
    }
  } catch { /* no log file, like a missing stick */ }
}
// w in s as a whole word (like hasWord in Log.cpp): device "io" is not in "connection".
function hasWord(s, w) {
  for (let i = s.indexOf(w); i >= 0; i = s.indexOf(w, i + 1))
    if (!/[a-z0-9]/i.test(s[i - 1] || ' ') && !/[a-z0-9]/i.test(s[i + w.length] || ' ')) return true;
  return false;
}
// Like Log::search: the file lines that mention a device by name or IP.
function logSearch(name, ip, from, to, max) {
  if (!name) return [];
  const a = name.toLowerCase(), b = (ip || '').toLowerCase(), hits = [];
  for (let n = LOG_FILES - 1; n >= 0; n--) {   // oldest first
    const f = logPath(n);
    let text = '';
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      const m = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) \[(\w+) *\] (\S+) +(.*)$/.exec(line);
      if (!m) continue;
      const e = Date.parse(m[1].replace(' ', 'T') + 'Z') / 1000;
      if (e < from || e > to) continue;
      const lm = m[4].toLowerCase();
      if (!hasWord(lm, a) && !(b && hasWord(lm, b))) continue;
      hits.push({ s: 0, t: 0, e, l: Math.max(0, LVLS.indexOf(m[2])), c: m[3], m: m[4] });
      if (hits.length > max) hits.shift();
    }
  }
  return hits;
}

// ---- device history (mirrors Monitor::record / flushHistory / historyJson) ----------
const HIST = path.join(LOGS, 'history');
const histQueue = [], lastRec = [];
let histDay = 0, histLastWrite = 0, histBooted = false;
const dayFile = (day) => path.join(HIST, new Date(day * 86400000).toISOString().slice(0, 10) + '.txt');
// Which lane a state belongs to: online/offline, power on/off, or a reading "p:<key>=1".
const histLane = (s) => (s === 'on' || s === 'off' ? 'power' : s.startsWith('p:') ? s.split('=')[0] : 'up');
function histRecord(kind, name, state) {
  if (histQueue.length >= 160) histQueue.shift();
  histQueue.push({ kind, name, state, at: epoch() });
}
function flushHistory() {
  const t = epoch();
  const q = histQueue.splice(0);
  if (!q.length && histBooted && t - histLastWrite < 600) return;
  const day = Math.floor(t / 86400);
  let out = '';
  if (day !== histDay) {   // a new day file starts with the state of every device
    out += lastRec.map((r) => `${t} ${r.state} ${r.kind} ${r.name}\n`).join('');
    if (histDay) fs.rmSync(dayFile(day - 400), { force: true });
    histDay = day;
  }
  if (!histBooted) { out += `${Math.floor(t0 / 1000)} boot - -\n`; histBooted = true; }
  if (!q.length) out += `${t} alive - -\n`;
  for (const r of q) {
    out += `${r.at} ${r.state} ${r.kind} ${r.name}\n`;
    const old = lastRec.find((x) => x.kind === r.kind && x.name === r.name && histLane(x.state) === histLane(r.state));
    if (old) old.state = r.state; else lastRec.push(r);
  }
  try { fs.mkdirSync(HIST, { recursive: true }); fs.appendFileSync(dayFile(day), out); } catch { /* lost, like a missing stick */ }
  histLastWrite = t;
}
setInterval(flushHistory, 1000);
function historyLines(name, from, to) {
  to = Math.min(to, from + 7 * 86400);
  const out = [];
  for (let day = Math.floor(from / 86400); day <= Math.floor(to / 86400); day++) {
    let text = '';
    try { text = fs.readFileSync(dayFile(day), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      const m = /^(\d+) (\S+) (\S+) (.*)$/.exec(line.trim());
      if (!m) continue;
      if (+m[1] > to) return out;
      if (m[2] !== 'boot' && m[2] !== 'alive' && m[4].toLowerCase() !== name.toLowerCase()) continue;
      out.push([+m[1], m[2]]);
    }
  }
  return out;
}

// ---- engine (mirrors src/Show.cpp) ------------------------------------------
let project = JSON.parse(fs.readFileSync(PROJECT, 'utf8'));
let pbs = [];          // {kind,id,start,paused,pausedAt,ended,next,master,mFrom,mTo,mStart,mLen,releasing,ch:Map(key->{from,to,cur}),fadeStart,fadeLen,order}
let order = 0, gm = 1, blackout = false;
let outputs = { dmx: true, artnet: true, sacn: true };
// Simulated PJLink projectors; an IP ending in .199 behaves as offline.
const pjState = new Map();   // id -> {power, last, seen, online}
const POWER = ['off', 'on', 'cooling', 'warming'];
function pj(id) {
  if (!pjState.has(id)) pjState.set(id, { power: 0, last: '', seen: false, online: false });
  return pjState.get(id);
}
function pjSend(x, body) {
  const st = pj(x.id);
  setTimeout(() => {
    st.seen = true;
    st.online = !/\.199$/.test(x.ip);
    if (!st.online) { st.last = 'no connection'; log(2, 'PJLINK', `${x.name}: ${body} failed: no connection`); return; }
    // Mock only: "projector X send ERST=000020" / "send LAMP=4200" sets what the
    // projector reports from now on (a real one answers ERR), then polls it.
    const sim = /^(ERST|LAMP)=(\S+)$/i.exec(body);
    if (sim) {
      if (sim[1].toUpperCase() === 'ERST') st.simErrors = sim[2].padEnd(6, '0').slice(0, 6); else st.simLamp = parseInt(sim[2], 10) || 0;
      log(1, 'PJLINK', `${x.name}: now reports ${sim[1].toUpperCase()} ${sim[2]} (simulated)`);
      pjPoll(x);
      return;
    }
    let value = 'OK';
    if (body === 'POWR 1' || body === 'POWR 0') {
      const on = body === 'POWR 1';
      st.power = on ? 3 : 2;
      setTimeout(() => { st.power = on ? 1 : 0; log(1, 'PJLINK', `${x.name}: power ${POWER[st.power]}`); }, 4000);
    } else if (body === 'POWR ?') value = String(st.power);
    else if (body === 'LAMP ?') value = '1234 1';
    else if (!/^(AVMT 3[01]|INPT \d\d)$/.test(body)) value = 'ERR1';
    st.last = `${body} -> ${value}`;
    if (value === 'ERR1') log(2, 'PJLINK', `${x.name}: ${body} failed: undefined command`);
    else log(1, 'PJLINK', `${x.name}: ${body} -> ${value}`);
  }, 300);
}
// ---- monitoring (mirrors src/Monitor.cpp + the PJLink poll) ----------------
// Simulation: IPs ending in .199 never answer, .77 answers ~60% of the time.
const hosts = new Map();   // "kind:name" -> state
let monInterval = 60, monLastRunMs = 0, monLastRun = 0;
const epoch = () => Math.floor(Date.now() / 1000);
const answers = (ip) => !/\.199$/.test(ip) && (!/\.77$/.test(ip) || Math.random() < 0.6);
function record(h, ok, failures) {
  h.lastCheck = epoch();
  h.history = ((h.history << 1) | (ok ? 1 : 0)) >>> 0;
  h.checks = Math.min(32, (h.checks || 0) + 1);
  if (ok) { h.lastSeen = h.lastCheck; h.fails = 0; } else h.fails = (h.fails || 0) + 1;
  const prev = h.state;
  h.state = ok ? 'online' : h.fails >= failures || prev === 'unknown' ? 'offline' : prev;
  return prev !== h.state ? prev : null;
}
function deviceEvent(kind, name, online) {
  for (const t of project.triggers)
    if (t.enabled !== false && t.type === 'device' && (!t.device || t.device.toLowerCase() === name.toLowerCase()) &&
        (t.state === 'any' || (t.state || 'offline') === (online ? 'online' : 'offline')))
      runTrigger(t, online ? 'device online' : 'device offline', { device: name, kind, state: online ? 'online' : 'offline' });
}
function runChecks() {
  monLastRunMs = Date.now();
  monLastRun = epoch();
  const failures = project.settings?.monitor?.failures || 2;
  const targets = [...(project.pcs || []).map((x) => ['pc', x]), ...(project.devices || []).map((x) => ['device', x])].filter(([, x]) => x.monitor !== false);
  for (const [kind, x] of targets) {
    const key = kind + ':' + x.name;
    if (!hosts.has(key)) hosts.set(key, { kind, id: x.id, name: x.name, ip: x.ip, state: 'unknown', history: 0, checks: 0 });
    const h = hosts.get(key);
    const ok = answers(x.ip);
    if (ok) h.latency = 1 + Math.floor(Math.random() * 12);
    const prev = record(h, ok, failures);
    if (prev) {
      if (h.state === 'online') log(1, 'SYS', `${kind} '${x.name}' (${x.ip}) is online (${h.latency} ms)`);
      else log(2, 'SYS', `${kind} '${x.name}' (${x.ip}) is OFFLINE`);
      histRecord(kind, x.name, h.state);
      if (prev !== 'unknown') deviceEvent(kind, x.name, h.state === 'online');
    }
  }
  for (const x of project.projectors || []) pjPoll(x);
}
function pjPoll(x) {
  const st = pj(x.id), wasOnline = st.online, first = !st.seen;
  st.seen = true;
  st.online = answers(x.ip);
  st.lastCheck = epoch();
  st.history = ((st.history << 1) | (st.online ? 1 : 0)) >>> 0;
  st.checks = Math.min(32, (st.checks || 0) + 1);
  if (st.online) {
    st.lastSeen = st.lastCheck;
    st.model ??= x.id === 1 ? 'Panasonic PT-RZ120' : 'Epson EB-L1505U';
    // Like Projectors.cpp: every change of an ERST digit or of the lamp hours is an alarm.
    const errors = st.simErrors ?? (x.id === 1 ? '000010' : '000000');   // PJ left: filter warning
    const lamp = st.simLamp ?? 1800 + x.id * 1234;
    for (let k = 0; k < 6; k++) {
      const from = +(st.errors?.[k] || 0), to = +(errors[k] || 0);
      if (from === to) continue;
      if (to) log(2, 'PJLINK', `${x.name}: ${PJ_PARTS[k]} ${to === 2 ? 'ERROR' : 'warning'}`);
      else log(1, 'PJLINK', `${x.name}: ${PJ_PARTS[k]} ok again`);
      projectorAlarm(x.name, k, from, to, lamp);
    }
    st.errors = errors;
    if (lamp !== st.lamp) { projectorAlarm(x.name, 6, st.lamp ?? -1, lamp, lamp); st.lamp = lamp; }
    st.input = '31';
    st.mute = '30';
  }
  if (st.online && !wasOnline) log(1, 'PJLINK', `${x.name} (${x.ip}) online`);
  if (!st.online && (wasOnline || first)) log(2, 'PJLINK', `${x.name} (${x.ip}) offline: no connection`);
  if (first || st.online !== wasOnline) histRecord('projector', x.name, st.online ? 'online' : 'offline');
  if (st.online) {   // like Projectors.cpp: warming up counts as on, cooling down as off
    const on = st.power === 1 || st.power === 3;
    if (st.histOn !== on) { st.histOn = on; histRecord('projector', x.name, on ? 'on' : 'off'); }
  }
  if (!first && st.online !== wasOnline) deviceEvent('projector', x.name, st.online);
}
// Projector trigger (mirrors Triggers::onProjectorAlarm). part 0-5 = ERST digit, 6 = lamp hours.
const PJ_PARTS = ['fan', 'lamp', 'temperature', 'cover', 'filter', 'other', 'lamp hours'];
function projectorAlarm(name, part, from, to, lamp) {
  const lampPart = part === 6;
  const vars = { projector: name, alarm: PJ_PARTS[part], lamp: lamp >= 0 ? String(lamp) : '?',
    state: lampPart ? 'over the limit' : ['ok', 'warning', 'error'][to] };
  for (const t of project.triggers) {
    if (t.enabled === false || t.type !== 'projector') continue;
    if (t.projector && t.projector.toLowerCase() !== name.toLowerCase()) continue;
    const alarm = t.alarm || 'any';
    if (lampPart) {
      const hours = t.hours ?? 3000;
      if (alarm !== 'lamp_hours' || !(from < hours && to >= hours)) continue;
      vars.hours = String(hours);
    } else {
      if (alarm === 'lamp_hours' || (alarm !== 'any' && alarm !== PJ_PARTS[part])) continue;
      const level = t.level || 'warning';
      if (!(level === 'ok' ? to === 0 : level === 'error' ? to === 2 : to > from)) continue;
    }
    runTrigger(t, 'projector alarm', vars);
  }
}
setInterval(() => { if (!monLastRunMs || Date.now() - monLastRunMs >= monInterval * 1000) runChecks(); }, 500);
function hostOnline(name) {
  for (const h of hosts.values()) if (h.name.toLowerCase() === name.toLowerCase()) return h.state;
  const x = (project.projectors || []).find((y) => y.name.toLowerCase() === name.toLowerCase());
  if (x) { const st = pj(x.id); return !st.seen ? 'unknown' : st.online ? 'online' : 'offline'; }
  const d = (project.drivers || []).find((y) => y.name.toLowerCase() === name.toLowerCase());
  if (d) { const st = drv(d); return !st.seen ? 'unknown' : st.online ? 'online' : 'offline'; }
  return null;
}

// ---- simulated device drivers (mirrors src/Drivers.cpp) -------------------------
// Each type keeps a fake device state; commands change it, polls report it.
const DRV_NAMES = { kissbox: 'Kiss-Box', knx: 'KNX', brightsign: 'BrightSign', digidot: 'DiGidot', netio: 'NETIO', pharos: 'Pharos' };
const drvState = new Map();   // "type:name:ip" -> state
function drv(d) {
  const key = `${d.type}:${d.name}:${d.ip}:${d.model || ''}`;
  if (drvState.has(key)) return drvState.get(key);
  const st = { seen: false, online: false, last: '', history: 0, checks: 0, lastSeen: 0, lastCheck: 0, info: {}, points: [], scenes: [],
    onlineSince: 0, dropouts: 0, restarts: 0, uptime: 0 };
  // Devices whose API reports uptime "booted" a while ago; BrightSign "reboot" restarts it.
  if (['netio', 'brightsign', 'pharos'].includes(d.type)) st.bootAt = epoch() - (d.type === 'netio' ? 276720 : d.type === 'pharos' ? 1209600 : 23400);
  const pt = (k, n, v) => st.points.push({ k, n, v: String(v) });
  if (d.type === 'netio') {
    st.info = { Model: '4PZ PowerDIN-4PZ', Firmware: '5.0.3', Serial: '24A42C3A5E55', 'Device clock': '', Mains: '231.4 V · 50.01 Hz', 'Total load': '84 W' };
    // The simulated NETIO has the outputs of the model picked in the UI (default: a 4PZ with 2 inputs).
    for (let i = 1; i <= (d.outputs || 4); i++) { pt('out' + i, `Power output ${i}`, i % 2); pt('load' + i, `Power output ${i} load (W)`, i % 2 ? 42 : 0); }
    if (!d.outputs) { pt('in1', 'Input 1', 0); pt('in2', 'Input 2', 0); }
    if (d.model) st.info.Model = `${d.model} NETIO-${d.model}`;
  } else if (d.type === 'kissbox') {
    kissKinds(d).forEach((t, s) => { if (t !== '-') for (let c = 1; c <= 8; c++) pt(`${s + 1}.${c}`, '', 0); });
  } else if (d.type === 'knx') {
    for (const a of d.addresses || []) pt(a.ga, a.name || '', String(a.dpt || '1').startsWith('9') ? '21.50' : 0);
  } else if (d.type === 'brightsign') {
    st.info = { Model: 'XT1144', Serial: 'D7E8A1000123', Firmware: '8.5.47', 'Boot version': '8.5.47', Connection: 'Ethernet', 'Player name': d.name };
    // The simulated presentation behind the kdlink plugin (data/www/brightsign/kdlink.brs).
    st.zones = [{ name: 'Video', state: 'Intro', file: 'intro.mp4' }, { name: 'Ticker', state: 'News', file: 'news.png' }, { name: 'Audio', state: 'Music', file: 'bgm.mp3' }];
    st.uvars = { mode: 'day', visitors: '0', language: 'NL' };
  } else if (d.type === 'digidot') {
    st.info = { 'Device name': 'DiGidot C4', Serial: 'C4--20170803-4AFAE-9288B', Memory: '7984 of 46960 bytes', 'Frame rates': 'Art-Net 16 fps · scenes 24 fps' };
    st.scenes = ['Rainbow', 'Warm white', 'Fire', 'Ocean'];
    pt('scene', 'Scene playing', '-'); pt('master', 'Master (%)', 100); pt('speed', 'Speed (%)', 100); pt('paused', 'Paused', 0);
  } else if (d.type === 'pharos') {
    st.info = { Model: 'LPC X', Firmware: '2.9.3', Serial: '009812', 'Last boot': '17 Oct 2026 09:12:40', 'Reset reason': 'Software Reset',
      Memory: '24056Kb used of 127940Kb', Project: 'Museum', 'Project file': 'museum_v12.pd2 (uploaded 2026-10-01T15:19:08)',
      Temperature: '41.0 °C · 44.0 °C', Fans: '2368 / 3605 rpm', Playing: 'nothing' };
    for (let i = 1; i <= 4; i++) pt('tl' + i, `Timeline ${i} ${['Inloop', 'Show', 'Cleaning', 'Night'][i - 1]}`, 'none');
    ['Work light', 'Full', 'Blue wash'].forEach((n, i) => pt('sc' + (i + 1), `Scene ${i + 1} ${n}`, i === 1 ? 'started' : 'none'));
    pt('grp1', 'All fixtures (%)', 100); pt('grp2', 'Showcases (%)', 60); pt('grp3', 'Ceiling (%)', 80);
    st.triggers = ['Startup', 'Museum open', 'Museum closed', 'Cleaning lights', 'Show start', 'Show stop', 'Fire alarm', 'Night mode', 'Button 1 press', 'Button 2 press', 'Sunset', 'Test all']
      .map((name, i) => ({ n: i + 1, name, t: ['startup', 'timer', 'timer', 'soft', 'soft', 'soft', 'digital_input', 'astronomical', 'touch', 'touch', 'astronomical', 'soft'][i] }));
  }
  drvState.set(key, st);
  return st;
}
// Kiss-Box slot kinds from "cards" (DO4PR, DI8DC...) or the older "slots":"out,in".
const kissKinds = (d) => (d.cards ? d.cards.map((c) => (/^DO/i.test(c) ? 'out' : /^DI/i.test(c) ? 'in' : /^AO/i.test(c) ? 'aout' : /^AI/i.test(c) ? 'ain' : '-'))
  : String(d.slots || 'out').split(',').map((s) => s.trim()));
// Point -> variable links, like Drivers::load: "vars", KNX address "var" and the older "links" text.
function drvLinks(d) {
  const l = { ...(d.vars || {}) };
  for (const a of d.addresses || []) if (a.var) l[a.ga] = a.var;
  for (const x of String(d.links || '').split(',')) { const [k, v] = x.split('=').map((s) => s.trim()); if (k && v) l[k] = v; }
  return l;
}
// Like onOff() in Drivers.cpp: on/off readings go into the device history. 1 on, 0 off, -1 not on/off.
function drvOnOff(d, k, v) {
  let bin = false;
  if (d.type === 'kissbox') { const t = kissKinds(d)[parseInt(k, 10) - 1]; bin = k.includes('.') && (t === 'out' || t === 'in'); }
  else if (d.type === 'netio') bin = /^(out|in)\d+$/.test(k);
  else if (d.type === 'knx') bin = parseInt((d.addresses || []).find((a) => a.ga === k)?.dpt || '1', 10) === 1;
  else if (d.type === 'pharos' && /^(tl|sc)/.test(k)) return v === '' ? -1 : v === 'none' || v === 'released' ? 0 : 1;
  if (!bin) return -1;
  return v === '1' ? 1 : v === '0' ? 0 : -1;
}
function drvSet(d, k, v, n) {
  const st = drv(d);
  let p = st.points.find((x) => x.k === k);
  if (!p) st.points.push((p = { k, n: n || '', v: '' }));
  if (p.v === String(v)) return;
  const was = drvOnOff(d, k, p.v);
  p.v = String(v);
  const now = drvOnOff(d, k, p.v);
  if (now >= 0 && now !== was) histRecord(d.type, d.name, `p:${k}=${now}`);
  const vn = drvLinks(d)[k];
  if (vn) try { setVar(vn, p.v, true); } catch { /* unknown variable or type */ }
}
function drvPoll() {
  for (const d of project.drivers || []) {
    const st = drv(d), was = st.online, first = !st.seen;
    st.seen = true;
    st.online = answers(d.ip) && !(st.bootAt > epoch());   // a rebooting player doesn't answer
    st.lastCheck = epoch();
    st.history = ((st.history << 1) | (st.online ? 1 : 0)) >>> 0;
    st.checks = Math.min(32, st.checks + 1);
    if (st.online) st.lastSeen = st.lastCheck;
    if (st.online && !was) st.onlineSince = st.lastCheck;
    if (!st.online && was) st.dropouts++;
    if (!st.online) { st.lastError = st.bootAt > epoch() ? 'no connection (rebooting)' : 'no connection'; st.lastErrorAt = st.lastCheck; }
    if (st.online && st.bootAt) {   // like Drivers.cpp: uptime going down = the device restarted
      const up = epoch() - st.bootAt;
      if (st.uptime && up + 60 < st.uptime) {
        st.restarts++;
        st.lastRestart = st.bootAt;
        log(2, 'SYS', `${DRV_NAMES[d.type]} ${d.name} restarted (uptime ${up} s, was ${st.uptime} s)`);
      }
      st.uptime = up;
    }
    if (d.type === 'netio') st.info['Device clock'] = new Date().toISOString().slice(0, 19);
    if (d.type === 'pharos') st.info.Playing = st.points.filter((p) => p.k.startsWith('tl') && p.v === 'running').map((p) => p.n.replace(/^Timeline \d+ /, '')).join(', ') || 'nothing';
    if (d.type === 'knx') { st.tunnel = st.online; st.live = st.online ? 'live' : 'waiting'; }
    // Live updates: Pharos WebSocket / NETIO MQTT-flex (simulated: "connected" whenever the device answers).
    st.live = d.type === 'knx' ? st.live : d.live ? (st.online ? 'live' : 'waiting') : undefined;
    st.liveNote = d.live && !st.online ? (d.type === 'netio' ? 'MQTT connection closed' : 'WebSocket: no connection') : undefined;
    if (d.type === 'brightsign') bsPlugin(d);
    if (d.type === 'kissbox' && st.online) {   // a simulated door contact on the first input slot toggles every 20 s
      const s = kissKinds(d).findIndex((t) => t === 'in');
      if (s >= 0) drvSet(d, `${s + 1}.1`, Math.floor(Date.now() / 20000) % 2);
    }
    if (st.online && !was) log(1, 'SYS', `${DRV_NAMES[d.type]} ${d.name} (${d.ip}) online`);
    if (!st.online && (was || first)) log(2, 'SYS', `${DRV_NAMES[d.type]} ${d.name} (${d.ip}) offline: no connection`);
    if (first || st.online !== was) histRecord(d.type, d.name, st.online ? 'online' : 'offline');
    if (!first && st.online !== was) deviceEvent(d.type, d.name, st.online);
  }
}
// The kdlink plugin answering a hello (like pluginPacket in Drivers.cpp): zones z<n> + z<n>.file, var.<name>.
// A DWS that doesn't answer leaves the player online while the plugin does (here both follow answers()).
function bsPlugin(d) {
  const st = drv(d);
  if (!d.plugin || !st.online) {
    st.live = d.plugin ? 'waiting' : undefined;
    st.liveNote = d.plugin ? `No answer from the kdlink plugin on UDP port ${d.pluginPort || 5010}` : undefined;
    return;
  }
  st.pluginSeen = epoch();
  st.live = 'live';
  st.liveNote = undefined;
  // The simulated presentation: the ticker changes every 15 s, visitors counts up per minute.
  st.zones[1].state = Math.floor(Date.now() / 15000) % 2 ? 'Weather' : 'News';
  st.zones[1].file = st.zones[1].state.toLowerCase() + '.png';
  st.uvars.visitors = String(Math.floor(Date.now() / 60000) % 500);
  st.info['KD plugin'] = `kdlink v1 · ${st.zones.length} zones · ${Object.keys(st.uvars).length} user variables`;
  bsReport(d);
}
function bsReport(d) {
  const st = drv(d);
  drvSet(d, 'zones', st.zones.length, 'Zones');
  st.zones.forEach((z, i) => { const n = `Zone ${i + 1} ${z.name}`; drvSet(d, `z${i + 1}`, z.state, n); drvSet(d, `z${i + 1}.file`, z.file, n + ' file'); });
  for (const [k, v] of Object.entries(st.uvars)) drvSet(d, 'var.' + k, v, k);
}
// Checked at the monitoring interval, like Drivers.cpp (Monitor::intervalMs()).
let drvLastPoll = 0;
setInterval(() => { if (Date.now() - drvLastPoll >= monInterval * 1000) { drvLastPoll = Date.now(); drvPoll(); } }, 500);
setTimeout(() => { drvLastPoll = Date.now(); drvPoll(); }, 1500);
// "kissbox|knx|brightsign|digidot|netio|pharos <device> ..." like Drivers::command.
function drvCommand(t) {
  const w = t.map((x) => x.toLowerCase()), type = w[0], tn = DRV_NAMES[type];
  if (t.length < 3) throw new Error(`expected: ${type} <device> ...`);
  const list = (project.drivers || []).filter((d) => d.type === type);
  const d = ref(list, t[1]);
  if (!d) throw new Error(`unknown ${tn} device '${t[1]}'`);
  const st = drv(d), rest = (i) => t.slice(i).join(' ');
  const fadeAt = (i) => { if (t.length <= i) return -1; if (t.length === i + 2 && w[i] === 'fade') return +t[i + 1]; throw new Error('expected: fade <seconds>'); };
  const truthy = (v) => (/^(on|1|true|yes|up|open)$/i.test(v) ? 1 : /^(off|0|false|no|down|close|closed)$/i.test(v) ? 0 : null);
  const later = (label, fn) => {
    setTimeout(() => {
      if (!answers(d.ip)) { st.last = `${label} failed: no connection`; log(2, 'SYS', `${tn} ${d.name}: ${st.last}`); return; }
      const res = fn ? fn() : '200 {"result":"ok"}';
      st.last = `${label} -> ${res}`;
      log(1, 'SYS', `${tn} ${d.name}: ${st.last} (simulated)`);
    }, 300);
    return `${tn} ${d.name}: ${label} queued`;
  };
  const api = (i, prefix) => {
    if (t.length < i + 2 || !/^(get|post|put|delete)$/.test(w[i])) throw new Error('expected: api get|post|put|delete <path> [body]');
    const path = t[i + 1].startsWith('/') ? t[i + 1] : prefix + t[i + 1];
    return later(`${t[i].toUpperCase()} ${path}`, () => '200 {"simulated":true}');
  };
  if (type === 'kissbox') {
    if (w[2] === 'send' && t.length >= 4) return later('send ' + rest(3));
    if (w[2] === 'read' && t.length === 4) { if (!(+t[3] >= 1 && +t[3] <= 8)) throw new Error('slot must be 1-8'); return later('read slot ' + t[3]); }
    if (t.length === 12 && w[3] === 'all') {
      if (!(+t[2] >= 1 && +t[2] <= 8)) throw new Error('slot must be 1-8');
      return later(`slot ${t[2]} all ${rest(4)}`, () => { t.slice(4).forEach((v, i) => drvSet(d, `${t[2]}.${i + 1}`, truthy(v) ?? Math.max(0, Math.min(255, +v || 0)))); return 'sent'; });
    }
    const m = t.length === 4 && /^([1-8])\.([1-8])$/.exec(t[2]);
    if (t.length === 4 && !m && /^\d+\.\d+$/.test(t[2])) throw new Error('expected <slot>.<channel>, both 1-8');
    if (m) {
      const v = truthy(t[3]) ?? (/^\d+$/.test(t[3]) ? Math.min(255, +t[3]) : null);
      if (v == null) throw new Error('value must be on|off or 0-255');
      return later(`${t[2]} = ${t[3]}`, () => { drvSet(d, t[2], v); return 'sent'; });
    }
    throw new Error('expected: <slot>.<ch> on|off|<0-255>, <slot> all <8 values>, read <slot> or send <hex bytes>');
  }
  if (type === 'knx') {
    const write = t.length >= 5 && t.length <= 6 && w[2] === 'write', read = t.length === 4 && w[2] === 'read';
    if (!write && !read) throw new Error('expected: write <address> <value> [<dpt>] or read <address>');
    const a = (d.addresses || []).find((x) => x.ga === t[3] || (x.name || '').toLowerCase() === w[3]);
    const ga = a ? a.ga : /^\d+\/\d+(\/\d+)?$/.test(t[3]) ? t[3] : null;
    if (!ga) throw new Error(`unknown KNX address '${t[3]}' (use 1/2/3 or a name from the address list)`);
    if (read) return later('read ' + ga, () => 'sent');
    const dpt = t[5] || a?.dpt || (truthy(t[4]) != null ? '1' : '');
    if (!dpt) throw new Error(`give the DPT for ${ga} (e.g. 5.001 for percent, 9 for temperature)`);
    const main = dpt.split('.')[0];
    if (![1, 2, 3, 5, 6, 7, 8, 9, 12, 13, 14, 16, 17, 18, 232].includes(+main)) throw new Error(`unsupported DPT '${dpt}' (use 1, 2, 3, 5, 5.001, 5.010, 6, 7, 8, 9, 12, 13, 14, 16, 17, 18, 232)`);
    if (main === '1' && truthy(t[4]) == null) throw new Error('expected on/off');
    return later(`write ${ga} = ${t[4]} (DPT ${dpt})`, () => { drvSet(d, ga, main === '1' ? truthy(t[4]) : t[4]); return 'sent'; });
  }
  if (type === 'brightsign') {
    // Through the kdlink plugin (pluginSend in Drivers.cpp); the simulated presentation reacts like a real one would.
    const plug = (label, fn) => {
      if (!d.plugin) throw new Error(`BrightSign ${d.name}: switch on the KD plugin for this player first (Devices > BrightSign)`);
      st.last = label;
      setTimeout(() => {
        if (!answers(d.ip)) return;
        const [ok, text] = fn();
        st.last = 'plugin: ' + text;
        log(ok ? 1 : 2, 'SYS', `BrightSign ${d.name}: ${st.last}`);
        bsReport(d);
      }, 300);
      return `BrightSign ${d.name}: ${label}`;
    };
    const zone = (r) => st.zones.find((z, i) => z.name.toLowerCase() === r.toLowerCase() || String(i + 1) === r);
    if (w[2] === 'event' && t.length >= 4) {
      return plug(`event ${rest(3)}`, () => {
        // A Plugin Message transition: "<zone>_<state>" or "<zone>:<state>" moves that zone, anything else zone 1.
        const m = /^([^_:]+)[_:](.+)$/.exec(rest(3)), z = (m && zone(m[1])) || st.zones[0], state = m && zone(m[1]) ? m[2] : rest(3);
        z.state = state;
        z.file = z.name === 'Audio' ? state.toLowerCase() + '.mp3' : z.name === 'Ticker' ? state.toLowerCase() + '.png' : state.toLowerCase() + '.mp4';
        return [true, `event ${rest(3)}`];
      });
    }
    if (w[2] === 'var' && t.length >= 5) {
      return plug(`var ${t[3]} ${rest(4)}`, () => {
        const k = Object.keys(st.uvars).find((x) => x.toLowerCase() === w[3]);
        if (!k) return [false, `no user variable '${t[3]}'`];
        st.uvars[k] = rest(4);
        return [true, `${k} = ${rest(4)}`];
      });
    }
    if ((w[2] === 'play' && t.length === 5) || (w[2] === 'stop' && t.length === 4)) {
      return plug(`${w[2]} ${t[3]}${t[4] ? ' ' + t[4] : ''}`, () => {
        const z = zone(t[3]);
        if (!z) return [false, `no zone '${t[3]}'`];
        if (w[2] === 'play') { z.state = '(direct) ' + t[4]; z.file = t[4]; return [true, `play ${t[4]} in ${t[3]}`]; }
        z.state = 'stopped'; z.file = '';
        return [true, `stop ${t[3]}`];
      });
    }
    if (w[2] === 'send' && t.length >= 4) {
      st.last = `UDP '${rest(3)}'`;
      // Simulated presentation: answers with a UDP message to the controller ("Player says").
      if (answers(d.ip)) setTimeout(() => { drvSet(d, 'msg', `playing ${rest(3)}`, 'Player says'); drvSet(d, 'msgAt', epoch()); }, 600);
      return `BrightSign ${d.name}: sent UDP '${rest(3)}' to port ${d.udpPort || 5000}`;
    }
    if (w[2] === 'reboot' && t.length === 3) return later('reboot', () => { st.bootAt = epoch() + 20; return '200 {"data":{"result":{"success":true,"reboot":true}}}'; });
    if (w[2] === 'api') return api(3, '/api/v1/');
    throw new Error('expected: event <text>, var <name> <value>, play <zone> <file>, stop <zone>, send <text>, reboot or api get|put|post|delete <path> [body]');
  }
  if (type === 'digidot') {
    if (w[2] === 'scene' && t.length >= 4) {
      fadeAt(4);
      const i = st.scenes.findIndex((s) => s.toLowerCase() === w[3]);
      const name = i >= 0 ? st.scenes[i] : /^\d+$/.test(t[3]) ? (st.scenes[+t[3] - 1] || t[3]) : null;
      if (!name) throw new Error(`unknown DiGidot scene '${t[3]}'`);
      return later('scene ' + t[3], () => { drvSet(d, 'scene', name); drvSet(d, 'paused', 0); return '{"result":"ok"}'; });
    }
    if (w[2] === 'playlist' && t.length === 4) return later('playlist ' + t[3]);
    if (w[2] === 'stop' && t.length === 3) return later('stop', () => { drvSet(d, 'scene', '-'); return '{"result":"ok"}'; });
    if (w[2] === 'reset' && t.length === 3) return later('reset');
    if (w[2] === 'master' && t.length === 4) return later(`master ${t[3]}%`, () => { drvSet(d, 'master', Math.round(Math.max(0, Math.min(100, +t[3])))); return '{"result":"ok"}'; });
    if (w[2] === 'speed' && t.length === 4) return later(`speed ${t[3]}%`, () => { drvSet(d, 'speed', +t[3] | 0); return '{"result":"ok"}'; });
    if (w[2] === 'trigger' && t.length === 4) return later('trigger ' + t[3]);
    if (w[2] === 'send' && t.length >= 4) return later('send ' + rest(3));
    throw new Error('expected: scene <name|#> [fade <s>], playlist <id>, stop, master <0-100>, speed <%>, trigger <id>, reset or send <json>');
  }
  if (type === 'netio') {
    if (w[2] === 'send' && t.length >= 4) return later('send ' + rest(3));
    if (t.length < 5 || t.length > 6 || w[2] !== 'output') throw new Error('expected: output <n|all> on|off|toggle|restart|pulse [<seconds>] or send <json>');
    const act = ['off', 'on', 'restart', 'pulse', 'toggle'].indexOf(w[4]);
    if (act < 0) throw new Error('action must be on|off|toggle|restart|pulse');
    const outs = st.points.filter((p) => /^out\d+$/.test(p.k));
    const sel = w[3] === 'all' ? outs : /^\d+$/.test(t[3]) ? [outs.find((p) => p.k === 'out' + t[3]) || { k: 'out' + t[3] }] : outs.filter((p) => p.n.toLowerCase() === w[3]);
    if (!sel.length) throw new Error(`unknown NETIO output '${t[3]}'`);
    return later(`output ${t[3]} ${w[4]}${t[5] ? ' ' + t[5] + ' s' : ''}`, () => {
      for (const p of sel) {
        const id = p.k.slice(3), cur = +(p.v || 0);
        const set = (v) => { drvSet(d, p.k, v); drvSet(d, 'load' + id, v ? 42 : 0); };
        if (act <= 1) set(act); else if (act === 4) set(cur ? 0 : 1);
        else { set(act === 2 ? 0 : 1); setTimeout(() => set(act === 2 ? 1 : 0), (+t[5] || 5) * 1000); }
      }
      return '200 netio.json';
    });
  }
  if (type === 'pharos') {
    if ((w[2] === 'timeline' || w[2] === 'scene') && t.length >= 5) {
      const tl = w[2] === 'timeline', a = w[4];
      if (tl && (a === 'rate' || a === 'position') && t.length === 6) return later(rest(2));
      if (!['start', 'release', 'toggle', ...(tl ? ['pause', 'resume'] : [])].includes(a)) throw new Error(tl ? 'expected: start|release|toggle|pause|resume [fade <s>], rate <x> or position <0-100>' : 'expected: start|release|toggle [fade <s>]');
      fadeAt(5);
      return later(rest(2), () => {
        if (tl) {
          const p = st.points.find((x) => x.k === 'tl' + t[3]), cur = p?.v || 'none';
          const next = a === 'start' ? 'running' : a === 'release' ? 'released' : a === 'pause' ? 'paused' : a === 'resume' ? 'running' : cur === 'running' ? 'released' : 'running';
          drvSet(d, 'tl' + t[3], next, p ? '' : 'Timeline ' + t[3]);
        } else {
          const p = st.points.find((x) => x.k === 'sc' + t[3]);
          drvSet(d, 'sc' + t[3], a === 'start' || (a === 'toggle' && p?.v !== 'started') ? 'started' : 'released', p ? '' : 'Scene ' + t[3]);
        }
        return '200 {}';
      });
    }
    if (w[2] === 'release' && w[3] === 'all') { fadeAt(4); return later('release all', () => { st.points.filter((p) => p.k.startsWith('tl') && p.v === 'running').forEach((p) => drvSet(d, p.k, 'released')); return '200 {}'; }); }
    if (w[2] === 'group' && w[4] === 'master' && t.length >= 6) { fadeAt(6); return later(rest(2)); }
    if (w[2] === 'trigger' && t.length >= 4) return later(rest(2));
    if (w[2] === 'text' && t.length >= 5) return later(rest(2));
    if (w[2] === 'override' && /^(fixture|group)$/.test(w[3]) && t.length >= 7) {
      fadeAt(7);
      if (!(w[5] === 'intensity' || ((w[5] === 'color' || w[5] === 'colour') && /^#[0-9a-f]{6}$/i.test(t[6])))) throw new Error('expected: intensity <0-100> or color #rrggbb');
      return later(rest(2));
    }
    if (w[2] === 'clear' && w[3] === 'overrides') { fadeAt(4); return later(rest(2)); }
    if (w[2] === 'output' && t.length === 5 && /^(on|off)$/.test(w[4])) return later(rest(2));
    if (w[2] === 'beacon' && t.length === 4 && /^(on|off)$/.test(w[3])) return later(rest(2));
    if (w[2] === 'api') return api(3, '/api/');
    throw new Error('expected: timeline|scene|group|trigger|release all|text|override|clear overrides|output|beacon|api ...');
  }
  throw new Error('unknown command');
}
function drvStatus() {
  return (project.drivers || []).map((d) => {
    const st = drv(d);
    return { id: d.id, type: d.type, name: d.name, ip: d.ip, online: st.online, seen: st.seen, last: st.last, lastSeen: st.lastSeen, lastCheck: st.lastCheck,
      history: st.history, checks: st.checks, info: st.info, points: st.points, onlineSince: st.online ? st.onlineSince : 0, dropouts: st.dropouts,
      restarts: st.restarts, ...(st.lastRestart ? { lastRestart: st.lastRestart } : {}), ...(st.uptime ? { uptime: st.uptime } : {}),
      ...(st.lastError ? { lastError: st.lastError, lastErrorAt: st.lastErrorAt } : {}),
      ...(st.live ? { live: st.live } : {}), ...(st.liveNote ? { liveNote: st.liveNote } : {}), ...(st.triggers ? { triggers: st.triggers } : {}), ...(st.scenes.length ? { scenes: st.scenes } : {}), ...(d.type === 'knx' ? { tunnel: !!st.tunnel } : {}) };
  });
}
const overrides = new Map();
let out = {};          // universeId -> Uint8Array(512)

function absLevels(scene) {
  const res = [];
  for (const l of scene.levels || []) {
    if (l.fixture != null) {
      const f = project.fixtures.find((x) => x.id === l.fixture);
      if (!f) continue;
      const ss = slots(f);
      const s = typeof l.ch === 'number' ? ss[l.ch - 1] : ss.find((x) => x.name === l.ch);
      if (s) res.push([`${f.universe}.${f.address + s.offset}`, l.v, s.wide]);
    } else res.push([`${l.u}.${l.ch}`, l.v, !!l.wide]);
  }
  return res;
}
function current(key, wide) {
  const [u, c] = key.split('.');
  if (!out[u]) return 0;
  return wide ? (out[u][c - 1] << 8) | out[u][c] : out[u][c - 1];
}
// Fixtures of a timeline track, in track order like Show::parse.
function trackFixtures(t, track) {
  return trackFixtureIds(project, (t.tracks || [])[track]).map((id) => project.fixtures.find((f) => f.id === id));
}
// Track preset -> [key, value, wide] like presetLevels() in Show.cpp.
function presetAbs(fixtures, dim, color) {
  const res = [];
  const hasColor = /^#[0-9a-f]{6}$/i.test(color || '');
  const rgbIn = hasColor ? [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) : [255, 255, 255];
  for (const f of fixtures) {
    const { dim: sd, r: sr, g: sg, b: sb, w: sw } = channelRoles(f);
    const put = (s, v) => res.push([`${f.universe}.${f.address + s.offset}`, s.wide ? v * 257 : v, s.wide]);
    if (sd && dim != null) put(sd, Math.round(dim * 255 / 100));
    if (!(sr && sg && sb) || (!hasColor && (sd || dim == null))) continue;
    let [r, g, b] = rgbIn;
    if (!sd && dim != null) [r, g, b] = [r, g, b].map((x) => Math.floor(x * dim / 100));
    if (sw) { const w = Math.min(r, g, b); r -= w; g -= w; b -= w; put(sw, w); }
    put(sr, r); put(sg, g); put(sb, b);
  }
  return res;
}
// Effect cue -> running effect for a track: program, slots, targets (like FxCue in Show.cpp).
const fxCache = new Map();
function effectProg(id) {
  const e = (project.effects || []).find((x) => x.id === id);
  if (!e) return null;
  let c = fxCache.get(e);
  if (!c || c.code !== e.code) { c = { code: e.code, prog: FX.compile(e.code || '') }; fxCache.set(e, c); }
  return c.prog.error ? null : c.prog;
}
function effectRun(t, c) {
  const prog = effectProg(c.effect);
  if (!prog) { log(2, 'SHOW', `Timeline ${t.id}: effect ${c.effect} missing or has errors`); return null; }
  const fx = trackFixtures(t, c.track || 0);
  const targets = fx.map((f, k) => {
    const ro = channelRoles(f), at = mapPosition(project, f.id);
    const ch = (s) => (s ? { key: `${f.universe}.${f.address + s.offset}`, wide: s.wide } : null);
    return { d: ch(ro.dim), r: ch(ro.r), g: ch(ro.g), b: ch(ro.b), w: ch(ro.w),
      x: at ? at.x : k / fx.length, y: at ? at.y : 0.5 };
  });
  return { prog, base: FX.slotsFor(prog, c.params || {}), level: (c.dim ?? 100) / 100, targets, start: Date.now() };
}
// One frame -> [key, value, wide] for all target channels.
function effectFrame(run, now) {
  const out = [], n = run.targets.length;
  run.targets.forEach((x, i) => {
    const s = Float64Array.from(run.base);
    s[0] = (now - run.start) / 1000; s[1] = i; s[2] = n; s[3] = i / n; s[4] = x.x; s[5] = x.y;
    FX.run(run.prog, s);
    const v = FX.toFixture(s, { dim: !!x.d, r: !!x.r, g: !!x.g, b: !!x.b, w: !!x.w }, run.level);
    for (const k of ['dim', 'r', 'g', 'b', 'w']) {
      const c = x[k === 'dim' ? 'd' : k];
      if (c && v[k] != null) out.push([c.key, Math.round(v[k] * (c.wide ? 65535 : 255)), c.wide]);
    }
  });
  return out;
}
// Levels a cue plays: a preset, a scene limited to its track's fixtures, or a whole scene.
function cueLevels(t, c) {
  const fx = trackFixtures(t, c.track || 0);
  if (c.dim != null || c.color != null) return presetAbs(fx, c.dim, c.color);
  const sc = project.scenes.find((s) => s.id === c.scene);
  if (!sc) return null;
  const all = absLevels(sc);
  if (!fx.length) return all;
  return all.filter(([k]) => { const [u, ch] = k.split('.').map(Number); return fx.some((f) => f.universe === u && ch >= f.address && ch < f.address + footprint(f)); });
}
// Each track fades on its own (pb.tf[track]); channels belong to the track that last set them.
function fire(pb, levels, fade, now, path, track = 0) {
  for (const v of pb.ch.values()) if (v.track === track) v.from = v.cur;
  for (const [k, v, wide] of levels) {
    if (!pb.ch.has(k)) pb.ch.set(k, { from: current(k, wide), cur: current(k, wide), to: v, wide, track });
    else { const c = pb.ch.get(k); c.from = c.cur; c.to = v; c.track = track; }
  }
  pb.tf = pb.tf || {};
  pb.tf[track] = { start: now, len: fade, ease: EASE[path] || EASE.linear };
}
// Cues plus a release cue at the end of each cue with a length (minus its fade-out), like Show::parse.
function timelineEvents(t) {
  const ev = [];
  for (const c of t.cues) {
    ev.push(c);
    if (c.trigger == null && c.len > 0) {
      const out = Math.min(c.out || 0, c.len);
      ev.push({ release: true, from: c.t, t: c.t + c.len - out, fade: out, track: c.track || 0 });
    }
  }
  return ev.sort((a, b) => a.t - b.t);
}
// The track lets go of its channels (endRelease in Show.cpp): they show what is underneath again.
function endRelease(pb, track) {
  for (const [k, v] of pb.ch) if ((v.track || 0) === track) pb.ch.delete(k);
  if (pb.fx) delete pb.fx[track];
  delete pb.rel[track];
}
// Current levels of a playback from each track's fade (updateFade in Show.cpp).
function stepLevels(pb, now) {
  for (const v of pb.ch.values()) {
    const f = pb.tf?.[v.track || 0];
    const k = f ? f.ease(f.len ? Math.min(1, (now - f.start) / f.len) : 1) : 1;
    v.cur = Math.max(0, Math.min(v.wide ? 65535 : 255, Math.round(v.from + (v.to - v.from) * k)));
  }
}
function tick() {
  const now = Date.now();
  for (const pb of pbs) {
    pb.rel = pb.rel || {};
    pb.last = pb.last || {};
    if (pb.kind === 'timeline' && !pb.paused && !pb.ended) {
      const t = project.timelines.find((x) => x.id === pb.id);
      const cues = timelineEvents(t);
      const el = now - pb.start;
      while (pb.next < cues.length && cues[pb.next].t <= el) {
        const c = cues[pb.next++];
        // Fades and effects count from when the cue was due (like updateTimeline in Show.cpp):
        // started part-way they pick up mid-way; earlier trigger cues are skipped.
        const past = c.t < (pb.catchUp || 0), at = now - (el - c.t), fade = c.fade || 0;
        if (c.trigger != null) { if (!pb.releasing && !past) onTimelineCue(t.id, String(c.trigger)); continue; }
        const tr = c.track || 0;
        if (c.release) {
          if (pb.last[tr] !== c.from || pb.rel[tr]) continue;   // another cue took over the track meanwhile
          pb.rel[tr] = { start: at, len: fade, op: 1 };
          if (!fade) endRelease(pb, tr);
          continue;
        }
        if (pb.rel[tr]) endRelease(pb, tr);
        pb.last[tr] = c.t;
        pb.fx = pb.fx || {};
        if (c.effect != null) {
          const run = effectRun(t, c);
          if (run) { run.start = at; fire(pb, effectFrame(run, now), fade, at, c.path, tr); pb.fx[tr] = run; }
        } else {
          delete pb.fx[tr];
          const lv = cueLevels(t, c);
          if (lv) fire(pb, lv, fade, at, c.path, tr);
        }
        if (past) stepLevels(pb, now);   // catching up: the next cue fades from this look
      }
      pb.catchUp = 0;
      if (t.length && el >= t.length) {
        if (t.loop) { pb.start += t.length; pb.next = 0; log(0, 'SHOW', `Timeline ${t.id} '${t.name}' looped`); }
        else { pb.ended = true; log(1, 'SHOW', `Timeline ${t.id} '${t.name}' reached end (holding)`); onTimelineEnd(t.id); }
      }
    }
    // Running effects: new targets every frame (the track's fade blends them in).
    if (!pb.paused)
      for (const run of Object.values(pb.fx || {}))
        for (const [k, v] of effectFrame(run, now)) { const c = pb.ch.get(k); if (c) c.to = v; }
    stepLevels(pb, now);
    for (const [tr, r] of Object.entries(pb.rel)) {
      const k = r.len ? (now - r.start) / r.len : 1;
      if (k >= 1) endRelease(pb, +tr); else r.op = 1 - k;
    }
    const mk = pb.mLen ? Math.min(1, (now - pb.mStart) / pb.mLen) : 1;
    pb.master = pb.mFrom + (pb.mTo - pb.mFrom) * mk;
    if (pb.releasing && mk >= 1) pb.dead = true;
  }
  pbs = pbs.filter((p) => !p.dead);
  const next = {};
  for (const u of project.universes) next[u.id] = new Uint8Array(512);
  const sorted = [...pbs].sort((a, b) => (a.priority - b.priority) || (a.order - b.order));
  for (const pb of sorted)
    for (const [k, v] of pb.ch) {
      const [u, c] = k.split('.');
      if (!next[u]) continue;
      const m = pb.master * (pb.rel?.[v.track || 0]?.op ?? 1);   // a track fading out after its cue ended
      if (v.wide) {
        const under = (next[u][c - 1] << 8) | next[u][c];
        const r = under + Math.round((v.cur - under) * m);
        next[u][c - 1] = r >> 8;
        next[u][c] = r & 255;
      } else next[u][c - 1] += Math.round((v.cur - next[u][c - 1]) * m);
    }
  for (const [k, v] of overrides) { const [u, c] = k.split('.'); if (next[u]) next[u][c - 1] = v; }
  for (const u in next) for (let i = 0; i < 512; i++) next[u][i] = blackout ? 0 : next[u][i] * gm;
  out = next;
  watchDmx();
}
// dmx_change triggers
const watched = new Map();   // trigger id -> last values
function chanList(spec) {
  const res = [];
  for (const part of String(spec || '1').split(',')) {
    const [a, b] = part.split('-').map(Number);
    for (let c = a; c <= (b || a) && res.length < 64; c++) if (c >= 1 && c <= 512) res.push(c);
  }
  return res;
}
function watchDmx() {
  for (const t of project.triggers || []) {
    if (t.type !== 'dmx_change' || t.enabled === false || !out[t.universe]) continue;
    const chans = chanList(t.channels);
    const last = watched.get(t.id) || chans.map((c) => out[t.universe][c - 1]);
    chans.forEach((c, i) => {
      const v = out[t.universe][c - 1];
      if (v === last[i]) return;
      last[i] = v;
      const vars = { channel: c, index: i + 1, value: v };
      for (const [name, vals] of Object.entries(t.tables || {})) if (i < vals.length) vars[name] = vals[i];
      runTrigger(t, 'dmx change', vars, true);
    });
    watched.set(t.id, last);
  }
}
setInterval(tick, 25);

function newPb(kind, id, priority) {
  pbs = pbs.filter((p) => !(p.kind === kind && p.id === id));
  const pb = { kind, id, start: Date.now(), next: 0, master: 1, mFrom: 1, mTo: 1, mLen: 0, ch: new Map(), fadeLen: 0, priority, order: ++order };
  pbs.push(pb);
  return pb;
}
function release(pb, fade) {
  pb.releasing = true;
  pb.mFrom = pb.master; pb.mTo = 0; pb.mStart = Date.now(); pb.mLen = fade;
  if (!fade) pb.dead = true;
}

// ---- command helpers (src/Cmd.cpp) -----------------------------------------
function tokenize(s) { return (s.match(/"[^"]*"|\S+/g) || []).map((t) => t.replace(/^"|"$/g, '')); }
function ref(list, tok) { return /^\d+$/.test(tok) ? list.find((x) => x.id === +tok) : list.find((x) => x.name.toLowerCase() === (tok || '').toLowerCase()); }
function fadeAt(t, i) {
  if (t.length <= i) return 0;
  if (t[i].toLowerCase() !== 'fade' || t.length !== i + 2) throw new Error('expected: fade <seconds>');
  return Math.round(parseFloat(t[i + 1]) * 1000);
}
// {name} and {=expr} expansion, like src/Vars.cpp
function expand(line, vars) {
  return line.replace(/\{([^}]*)\}/g, (m, body) => {
    if (body.startsWith('=')) {
      const expr = body.slice(1).replace(/[A-Za-z_]\w*/g, (id) =>
        ['ceil', 'floor', 'round', 'abs', 'min', 'max'].includes(id) ? 'Math.' + id : vars && id in vars ? `(${+vars[id]})` : 'NaN');
      if (!/^[\d\s+\-*/%().,a-zA-Z]*$/.test(expr)) return m;
      try { const v = Function(`return (${expr})`)(); return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : m; } catch { return m; }
    }
    return vars && body in vars ? String(vars[body]) : m;
  });
}
// ---- variables (src/Globals.cpp) ------------------------------------------------
const varVals = {};   // name -> string value
const varDef = (n) => (project.variables || []).find((v) => v.name.toLowerCase() === String(n).toLowerCase());
function coerce(v, raw) {
  const s = String(raw).trim();
  if (v.type === 'number') { if (!/^-?\d+(\.\d+)?$/.test(s)) return null; return String(+s); }
  if (v.type === 'bool') { const l = s.toLowerCase(); return ['1', 'on', 'true', 'yes'].includes(l) ? '1' : ['0', 'off', 'false', 'no'].includes(l) ? '0' : null; }
  return s;
}
function loadVars() {
  for (const v of project.variables || []) {
    if (varVals[v.name] != null && coerce(v, varVals[v.name]) != null) continue;   // keep live values
    varVals[v.name] = coerce(v, v.initial ?? (v.type === 'text' ? '' : 0)) ?? (v.type === 'text' ? '' : '0');
  }
  for (const k of Object.keys(varVals)) if (!varDef(k)) delete varVals[k];
}
function setVar(name, raw, fromDevice) {
  const v = varDef(name);
  if (!v) throw new Error(`unknown variable '${name}'`);
  if (!fromDevice && v.modbus?.device && ['discrete', 'input'].includes(v.modbus.table)) throw new Error(`${v.name} follows PLC ${v.modbus.table} ${v.modbus.address} and is read-only`);
  const val = coerce(v, raw);
  if (val == null) throw new Error(`'${raw}' is not a valid ${v.type} for ${v.name}`);
  const old = varVals[v.name];
  varVals[v.name] = val;
  if (!fromDevice && v.modbus?.device) { plcMem[`${v.modbus.device}:${v.modbus.table}:${v.modbus.address}`] = +val; log(0, 'SYS', `Modbus ${v.modbus.device}: wrote ${v.modbus.table} ${v.modbus.address} = ${val} (simulated)`); }
  if (old !== val) {
    boardOnVariable(v.name, val);
    for (const t of project.triggers)
      if (t.enabled !== false && t.type === 'variable' && (!t.variable || t.variable.toLowerCase() === v.name.toLowerCase()) &&
          (!t.value || t.value === val || (t.value === 'on' && val === '1') || (t.value === 'off' && val === '0')))
        runTrigger(t, 'variable', { variable: v.name, value: val, old });
  }
  return `${v.name} = ${val}`;
}
function expandVars(line, vars) {
  const all = { ...varVals, ...(vars || {}) };   // trigger vars win, like the firmware
  return expand(line, all);
}

// ---- simulated Portenta Machine Control I/O (src/Board.cpp) ------------------------
// Points in0-7, out0-7, io0-11, ai0-2, ao0-3; config in project.machineControl.
// In the mock "io <input> on|off|<value>" simulates a signal on an input (the firmware refuses it).
const BOARD_KINDS = [['in', 8], ['out', 8], ['io', 12], ['ai', 3], ['ao', 4]];
const board = new Map();   // key -> {value, target, from, fadeAt, fadeMs, pulseUntil, reported, echo}
for (const [k, n] of BOARD_KINDS) for (let c = 0; c < n; c++) board.set(k + c, { value: 0, target: 0, fadeMs: 0, pulseUntil: 0, reported: '', echo: [] });
const boardCfg = (k) => project.machineControl?.[k] || {};
const boardIsOut = (k) => /^(out|ao)/.test(k) || (/^io/.test(k) && boardCfg(k).mode === 'out');
const boardAnalog = (k) => /^a[io]/.test(k);
function boardFmt(k) {
  const v = board.get(k).value;
  if (!boardAnalog(k)) return v >= 0.5 ? '1' : '0';
  return /^ai/.test(k) && boardCfg(k).mode === 'NTC' ? String(Math.round(v)) : v.toFixed(2);
}
function boardFind(ref) {
  const r = String(ref).toLowerCase();
  for (const k of board.keys()) if (k === r || (boardCfg(k).name || '').toLowerCase() === r) return k;
  throw new Error(`unknown I/O point '${ref}' (in0-7, out0-7, io0-11, ai0-2, ao0-3 or a name)`);
}
function boardSet(k, v, fade) {
  const p = board.get(k);
  p.pulseUntil = 0;
  v = boardAnalog(k) ? Math.max(0, Math.min(10, v)) : v >= 0.5 ? 1 : 0;
  Object.assign(p, { from: p.value, target: v, fadeAt: Date.now(), fadeMs: fade > 0 ? fade * 1000 : 0 });
  if (!p.fadeMs) p.value = v;
}
const boardNum = (s) => (/^(on|true)$/i.test(s) ? 1 : /^(off|false)$/i.test(s) ? 0 : /^-?\d+(\.\d+)?$/.test(s) ? +s : null);
function boardCommand(t) {
  const w = t.map((x) => x.toLowerCase());
  if (t.length === 3 && w[1] === 'all' && w[2] === 'off') { for (const k of board.keys()) if (boardIsOut(k)) boardSet(k, 0, 0); return 'All board outputs off'; }
  if (t.length < 3) throw new Error('expected: io <point> on|off|toggle, io <point> pulse <s>, io <ao> <volts> [fade <s>] or io all off');
  const k = boardFind(t[1]), p = board.get(k), name = boardCfg(k).name, label = name ? `${k} (${name})` : k;
  if (!boardIsOut(k)) {
    const v = boardNum(t[2]);
    if (t.length !== 3 || v == null) throw new Error(`${label} ${/^io/.test(k) ? 'is set as an input (Devices → Machine Control)' : 'is an input'}`);
    p.value = boardAnalog(k) ? v : v >= 0.5 ? 1 : 0;
    return `${label} = ${boardFmt(k)} (simulated input)`;
  }
  if (t.length === 3 && w[2] === 'toggle') { boardSet(k, p.value >= 0.5 ? 0 : /^ao/.test(k) ? 10 : 1, 0); return `${label} toggled`; }
  if (t.length === 4 && w[2] === 'pulse') {
    const s = +t[3];
    if (!(s > 0 && s <= 3600)) throw new Error('pulse length must be 0.01-3600 s');
    boardSet(k, /^ao/.test(k) ? 10 : 1, 0);
    p.pulseUntil = Date.now() + s * 1000;
    return `${label} pulse ${t[3]} s`;
  }
  let v = boardNum(t[2]);
  const fade = t.length === 5 && w[3] === 'fade' ? +t[4] : 0;
  if ((t.length !== 3 && !(t.length === 5 && w[3] === 'fade')) || v == null) throw new Error(/^ao/.test(k) ? `expected: io ${k} <0-10 volts> [fade <s>]` : `expected: io ${k} on|off|toggle|pulse <s>`);
  if (fade > 0 && !/^ao/.test(k)) throw new Error('fade only works on analog outputs (ao0-ao3)');
  if (/^ao/.test(k) && /^(on|true)$/i.test(t[2])) v = 10;
  boardSet(k, v, fade);
  return `${label} = ${/^ao/.test(k) ? p.target.toFixed(2) + ' V' : p.target ? 'on' : 'off'}${fade > 0 ? ` in ${t[4]} s` : ''}`;
}
// A linked variable changed: switch the output (unless it is our own update coming back).
function boardOnVariable(name, val) {
  for (const [k, p] of board) {
    if (!boardIsOut(k) || (boardCfg(k).var || '').toLowerCase() !== name.toLowerCase()) continue;
    if (p.echo[0] === val) { p.echo.shift(); continue; }
    p.echo = [];
    const v = boardNum(val);
    if (v != null) { boardSet(k, v, 0); p.reported = boardFmt(k); }
  }
}
const boardTrig = new Map();   // trigger id -> last state
setInterval(() => {
  const now = Date.now();
  for (const [k, p] of board) {
    if (p.pulseUntil && now >= p.pulseUntil) Object.assign(p, { pulseUntil: 0, value: 0, target: 0, fadeMs: 0 });
    if (p.fadeMs) { const f = Math.min(1, (now - p.fadeAt) / p.fadeMs); p.value = p.from + (p.target - p.from) * f; if (f >= 1) p.fadeMs = 0; }
    // Linked variable follows the point (analog only on a real change).
    const vn = boardCfg(k).var, v = boardFmt(k);
    if (!vn || v === p.reported || (boardAnalog(k) && p.reported && Math.abs(+v - +p.reported) < 0.05)) continue;
    p.reported = v;
    const d = varDef(vn);
    if (!d) continue;
    if (varVals[d.name] !== coerce(d, v) && p.echo.length < 4) p.echo.push(coerce(d, v));
    try { setVar(vn, v, true); } catch { /* type mismatch */ }
  }
  // Input triggers on board points, like Triggers::poll.
  for (const t of project.triggers || []) {
    if (t.type !== 'input' || !t.io || t.enabled === false) continue;
    let k;
    try { k = boardFind(t.io); } catch { continue; }
    const v = board.get(k).value, analog = boardAnalog(k), level = t.level ?? 5, hyst = analog ? Math.max(0.05, Math.abs(level) * 0.02) : 0;
    const was = boardTrig.get(t.id);
    const s = !analog ? +(v >= 0.5) : was === 1 ? +(v > level - hyst) : +(v > level + hyst);
    boardTrig.set(t.id, s);
    if (was == null || was === s) continue;
    const vars = { input: k, value: analog ? v.toFixed(2) : String(s) };
    rt(t).holdVars = vars;   // "hold" fires later, from the hold timer
    inputEdge(t, !!s, now, vars);
  }
}, 20);
function boardStatus() {
  return { type: 'machineControl', ok: true, points: [...board].map(([k, p]) => ({ k, v: boardFmt(k), ...(boardIsOut(k) ? { out: true } : {}), ...(p.pulseUntil ? { pulse: true } : {}) })) };
}
function boardLoad() {
  // An io channel switched from output to input drops its output state; outputs otherwise survive a save.
  for (const [k, p] of board) {
    if (/^io/.test(k) && !boardIsOut(k) && p.wasOut) Object.assign(p, { value: 0, target: 0, fadeMs: 0, pulseUntil: 0 });
    p.wasOut = boardIsOut(k);
    p.reported = '';
    p.echo = [];
  }
  boardTrig.clear();
}

// ---- simulated PLC + TCP + HTTP (src/Io.cpp) -------------------------------------
const plcMem = {};          // "device:table:address" -> number
const tcpLast = {};         // name -> {line, at}
const answersIp = (ip) => !/\.199$/.test(ip);
setInterval(() => {          // poll: linked variables follow the PLC; a door sensor (discrete 0) toggles every 15 s
  for (const v of project.variables || []) {
    if (!v.modbus?.device) continue;
    const d = (project.modbus || []).find((x) => x.name === v.modbus.device);
    if (!d || !answersIp(d.ip)) continue;
    const key = `${d.name}:${v.modbus.table}:${v.modbus.address}`;
    if (plcMem[key] == null) plcMem[key] = +(varVals[v.name] || 0);
    if (v.modbus.table === 'discrete' && v.modbus.address === 0 && Math.floor(Date.now() / 15000) % 2 !== plcMem[key]) plcMem[key] ^= 1;
    if (String(plcMem[key]) !== varVals[v.name]) { try { setVar(v.name, String(plcMem[key]), true); } catch { /* type mismatch */ } }
  }
}, 500);

// ---- clock & schedule (src/Clock.cpp) ---------------------------------------------
const SchedM = {
  inPeriod: Model.inPeriod,
  sun(rise) {
    const loc = project.settings?.location || {};
    if (loc.lat == null) return -1;
    const now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
    const utc = Model.sunUtc(y, m, d, loc.lat, loc.lon, rise);
    if (utc == null) return -1;
    return ((utc - new Date(y, m - 1, d, 12).getTimezoneOffset()) % 1440 + 1440) % 1440;   // the PC's own zone stands in for tz+DST
  },
  clockMin(tok) {
    const t = String(tok).toLowerCase(), sm = /^(sunrise|sunset)([+-]\d+)?$/.exec(t);
    if (sm) { const b = SchedM.sun(sm[1] === 'sunrise'); if (b < 0) throw new Error('set the location (Schedule page) for sunrise/sunset'); return ((b + (+sm[2] || 0)) % 1440 + 1440) % 1440; }
    const hm = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!hm) throw new Error('expected HH:MM, sunrise or sunset');
    return +hm[1] * 60 + +hm[2];
  },
  today() { const n = new Date(); return { md: (n.getMonth() + 1) * 100 + n.getDate(), ymd: n.getFullYear() * 10000 + (n.getMonth() + 1) * 100 + n.getDate() }; },
};
const hm = (m) => m < 0 ? undefined : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
let ntpLast = 0;

// ---- modes, labels, triggers by name (src/State.cpp, src/Triggers.cpp) -------------
// Mode groups, like src/State.cpp. Old projects: a plain list = one group "Mode".
const modeCur = {};   // group name -> current state
function modeGroups() {
  const list = project.modes || [];
  const legacy = list.filter((m) => typeof m === 'string');
  return [...(legacy.length ? [{ name: 'Mode', states: legacy }] : []), ...list.filter((m) => m && typeof m === 'object')];
}
const byRef = (list, ref, key = (x) => x) => (/^\d+$/.test(ref) ? list[+ref - 1] : list.find((x) => key(x).toLowerCase() === String(ref).toLowerCase()));
function groupState(gref, sref) {
  const g = byRef(modeGroups(), gref, (x) => x.name);
  if (!g) throw new Error(`unknown mode group '${gref}'`);
  const s = byRef(g.states, sref);
  if (!s) throw new Error(`'${sref}' is not a state of ${g.name}`);
  return { g, s };
}
function anyState(sref) {
  const hits = modeGroups().map((g) => ({ g, s: byRef(g.states, sref) })).filter((h) => h.s);
  if (hits.length > 1) throw new Error(`'${sref}' exists in several mode groups - use: mode <group> ${sref}`);
  if (!hits.length) throw new Error(`unknown mode '${sref}'`);
  return hits[0];
}
const pcLast = {};
let projectVersion = 0;   // like Show::parse: bumps on every load
const labels = {};   // live state of panel controls by name (State.cpp "labels"): text color flash value disabled locked
// A control's state, by name in any case (the first spelling is kept, like State::label).
const ctl = (name) => labels[Object.keys(labels).find((k) => k.toLowerCase() === String(name).toLowerCase()) ?? name] ??= {};
let scheduled = [];   // {id, due, every, remaining, count, vars}
// Trigger by number or name (separators excluded), like Triggers::findId
function trigRef(ref) {
  const hits = project.triggers.filter((t) => t.type !== 'comment' && (/^\d+$/.test(ref) ? t.id === +ref : (t.name || '').toLowerCase() === String(ref).toLowerCase()));
  if (!hits.length) throw new Error(`unknown trigger '${ref}'`);
  if (hits.length > 1) throw new Error(`${hits.length} triggers are named '${ref}' - use its number or rename one`);
  return hits[0];
}
// "if <cond> then <a> [else <b>]" split on unquoted words, like Cmd.cpp splitIf
function splitIf(s) {
  const toks = [...s.matchAll(/"[^"]*"?|\S+/g)];
  let thenT = null, elseT = null;
  for (const m of toks.slice(1)) {
    const w = m[0].startsWith('"') ? '' : m[0].toLowerCase();
    if (!thenT && w === 'then') thenT = m;
    else if (thenT && !elseT && w === 'else') elseT = m;
  }
  if (!thenT) return null;
  const end = (m) => m.index + m[0].length;
  return { cond: s.slice(2, thenT.index).trim(), a: s.slice(end(thenT), elseT ? elseT.index : s.length).trim(), b: elseT ? s.slice(end(elseT)).trim() : '' };
}
// ---- commands (mirrors src/Cmd.cpp; device commands are in drvCommand above) -------
function exec(line, src, vars) {
  line = expandVars(line.trim(), vars);
  if (!line || line.startsWith('#')) return '';
  if (/^sleep\b/i.test(line)) throw new Error("sleep only works on its own line in a trigger's actions");
  if (/^wait\b/i.test(line)) throw new Error("wait only works on its own line in a trigger's actions");
  if (/^repeat\s+(\S+|"[^"]*")\s+(\d+\s+)?times\b/i.test(line)) throw new Error('repeat ... times only works on its own line in a trigger\'s actions');
  // Mock only: simulate Art-Net / sACN arriving for DMX input triggers (the controller has the real thing).
  const di = /^dmxin\s+(artnet|sacn)\s+(\d+)\s+(\d+)(?:-(\d+))?\s+(\d+)$/i.exec(line);
  if (di) {
    const key = `${di[1].toLowerCase()}:${+di[2]}`, v = Math.min(255, +di[5]);
    if (!dmxInFrames.has(key)) { dmxInFrames.set(key, new Uint8Array(512)); dmxInCheck(); }   // first frame: all 0
    for (let c = +di[3]; c <= +(di[4] || di[3]) && c <= 512; c++) if (c >= 1) dmxInFrames.get(key)[c - 1] = v;
    const r = `Simulated ${di[1]} ${di[2]} channel ${di[3]}${di[4] ? '-' + di[4] : ''} = ${v}`;
    log(0, 'CMD', `[${src}] ${line} -> ${r}`);
    return r;
  }
  if (/^if\s/i.test(line)) {
    const s = splitIf(line);
    if (!s || !s.cond || !s.a) throw new Error('expected: if <condition> then <command> [else <command>]');
    const ok = checkCondition(s.cond);
    if (typeof ok === 'string') throw new Error(`condition '${s.cond}': ${ok}`);
    log(0, 'CMD', `[${src}] if ${s.cond} -> ${ok ? 'then' : s.b ? 'else' : 'skip'}`);
    if (ok) return exec(s.a, src, vars);
    if (s.b) return exec(s.b, src, vars);
    return 'condition false, nothing to do';
  }
  const t = tokenize(line);
  const w = t.map((x) => x.toLowerCase());
  const tl = (i) => { const x = ref(project.timelines, t[i]); if (!x) throw new Error(`unknown timeline '${t[i] || ''}'`); return x; };
  const sc = (i) => { const x = ref(project.scenes, t[i]); if (!x) throw new Error(`unknown scene '${t[i] || ''}'`); return x; };
  const running = (kind, id) => { const p = pbs.find((p) => p.kind === kind && p.id === id); if (!p) throw new Error(`${kind} ${id} is not running`); return p; };
  let r;
  if (w[0] === 'start' && w[1] === 'timeline') {
    const x = tl(2);
    if (x.group) for (const p of pbs) {
      const other = project.timelines.find((o) => o.id === p.id);
      if (p.kind === 'timeline' && p.id !== x.id && !p.releasing && other?.group === x.group) {
        release(p, x.cues?.[0]?.fade || 0);
        log(1, 'SHOW', `Timeline ${other.id} '${other.name}' released by group ${x.group}`);
      }
    }
    // "at <seconds>": start part-way (startTimeline in Show.cpp).
    if (t.length > 3 && (w[3] !== 'at' || t.length !== 5 || isNaN(parseFloat(t[4])))) throw new Error('expected: at <seconds>');
    let at = t.length > 3 ? Math.max(0, Math.round(parseFloat(t[4]) * 1000)) : 0;
    if (x.length && at >= x.length) at = x.length - 1;
    const pb = newPb('timeline', x.id, x.priority || 0);
    pb.start -= at;
    pb.catchUp = at;
    r = `Started timeline ${x.id} '${x.name}'${at ? ` at ${(at / 1000).toFixed(1)}s` : ''}`;
  }
  else if (w[0] === 'stop' && w[1] === 'timeline') { const x = tl(2); release(running('timeline', x.id), fadeAt(t, 3)); r = `Released timeline ${x.id} '${x.name}'`; }
  else if ((w[0] === 'pause' || w[0] === 'resume') && w[1] === 'timeline') {
    const x = tl(2), p = running('timeline', x.id), now = Date.now();
    if (w[0] === 'pause' && !p.paused) { p.paused = true; p.pausedAt = now; }
    if (w[0] === 'resume' && p.paused) {
      p.paused = false;
      p.start += now - p.pausedAt;
      for (const run of Object.values(p.fx || {})) run.start += now - p.pausedAt;
    }
    r = `${w[0] === 'pause' ? 'Paused' : 'Resumed'} timeline ${x.id}`;
  } else if (w[0] === 'master' && w[1] === 'timeline') {
    const x = tl(2), p = running('timeline', x.id);
    if (t.length < 4) throw new Error('missing level (0-100)');
    p.mFrom = p.master; p.mTo = Math.min(1, +t[3] / 100); p.mStart = Date.now(); p.mLen = fadeAt(t, 4);
    r = `Timeline ${x.id} master -> ${t[3]}%`;
  } else if (w[0] === 'scene') { const x = sc(1); const f = fadeAt(t, 2); fire(newPb('scene', x.id, 0), absLevels(x), f, Date.now()); r = `Scene ${x.id} '${x.name}'`; }
  else if (w[0] === 'release' && w[1] === 'scene') { const x = sc(2); release(running('scene', x.id), fadeAt(t, 3)); r = `Released scene ${x.id}`; }
  else if (w[0] === 'release' && w[1] === 'all') { const f = fadeAt(t, 2); pbs.forEach((p) => release(p, f)); r = 'Released all'; }
  else if ((w[0] === 'set' || (w[0] === 'clear' && w[1] === 'override')) && t.length === 3) {
    const setCh = w[0] === 'set', spec = t[setCh ? 1 : 2];
    const m = /^(\d+)\.(\d+)(?:-(\d+))?$/.exec(spec);
    if (!m || !project.universes.find((u) => u.id === +m[1])) throw new Error('expected <universe>.<channel>');
    if (+m[2] < 1 || +(m[3] || m[2]) > 512 || +(m[3] || m[2]) < +m[2]) throw new Error('channel out of range (1-512)');
    const v = +t[2];
    if (setCh && !(v >= 0 && v <= 255)) throw new Error('value out of range (0-255)');
    for (let c = +m[2]; c <= +(m[3] || m[2]); c++) setCh ? overrides.set(`${m[1]}.${c}`, v) : overrides.delete(`${m[1]}.${c}`);
    r = setCh ? `Set ${spec} = ${v}` : `Override cleared ${spec}`;
  } else if (w[0] === 'clear' && w[1] === 'overrides') { overrides.clear(); r = 'Overrides cleared'; }
  else if (w[0] === 'grandmaster' && t.length === 2) { gm = Math.max(0, Math.min(1, +t[1] / 100)); log(1, 'SHOW', `Grand master ${t[1]}%`); r = `Grand master ${t[1]}%`; }
  else if (w[0] === 'blackout' && (w[1] === 'on' || w[1] === 'off')) { blackout = w[1] === 'on'; log(2, 'SHOW', `Blackout ${blackout ? 'ON' : 'off'}`); r = `Blackout ${w[1]}`; }
  else if (w[0] === 'log' && t.length > 1) { log(1, 'CMD', t.slice(1).join(' ')); r = 'Logged'; }
  else if (w[0] === 'mode' && (t.length === 2 || t.length === 3)) {
    const { g, s } = t.length === 3 ? groupState(t[1], t[2]) : anyState(t[1]);
    if (modeCur[g.name] === s) r = `${g.name} already ${s}`;
    else {
      log(1, 'SYS', `Mode ${g.name} changed: ${modeCur[g.name] || '(none)'} -> ${s}`);
      modeCur[g.name] = s;
      r = `${g.name}: ${s}`;
      for (const tr of project.triggers)
        if (tr.enabled !== false && tr.type === 'mode' && (!tr.group || tr.group === g.name) && (!tr.mode || tr.mode === s))
          runTrigger(tr, 'mode change', { group: g.name, mode: s });
      pushStatus();
    }
  } else if (w[0] === 'output' && t.length === 4 && w[2] === 'fps' && /^(dmx|artnet|sacn)$/.test(w[1])) {
    const max = w[1] === 'dmx' ? 44 : 60;
    if (!(+t[3] >= 1 && +t[3] <= max)) throw new Error(`${w[1]} fps must be 1-${max}`);
    outputs[w[1] + 'Fps'] = +t[3];
    r = `${w[1]} ${t[3]} fps`;
    log(1, 'SHOW', r);
  } else if (w[0] === 'label' && t.length >= 3) {
    if (w[2] === 'color' && t.length === 4) { ctl(t[1]).color = t[3]; r = `Label ${t[1]} colour ${t[3]}`; }
    else { ctl(t[1]).text = t.slice(2).join(' '); r = `Label ${t[1]} = ${ctl(t[1]).text}`; }
    pushStatus();
  } else if (w[0] === 'panel' && t.length >= 3) {
    // Like Cmd.cpp: panel <control> text|color|flash|value|enable|disable|lock|unlock|reset
    const c = ctl(t[1]), n = t[1];
    if (w[2] === 'text' && t.length >= 4) { c.text = t.slice(3).join(' '); r = `Panel ${n} text ${c.text}`; }
    else if (w[2] === 'color' && t.length === 4) { c.color = t[3]; r = `Panel ${n} colour ${t[3]}`; }
    else if (w[2] === 'flash' && t.length === 4) { if (w[3] === 'off') delete c.flash; else c.flash = w[3] === 'on' ? 'on' : t[3]; r = `Panel ${n} flash ${t[3]}`; }
    else if (w[2] === 'value' && t.length === 4) { c.value = t[3]; r = `Panel ${n} = ${t[3]}`; }
    else if ((w[2] === 'enable' || w[2] === 'disable') && t.length === 3) { c.disabled = w[2] === 'disable'; r = `Panel ${n} ${w[2]}d`; }   // false: enable also frees one ticked "disabled"
    else if ((w[2] === 'lock' || w[2] === 'unlock') && t.length === 3) { c.locked = w[2] === 'lock'; r = `Panel ${n} ${w[2]}ed`; }
    else if (w[2] === 'reset' && t.length === 3) { for (const k of ['text', 'color', 'flash', 'disabled', 'locked']) delete c[k]; r = `Panel ${n} reset`; }
    else throw new Error('expected: panel <control> text|color|flash|value|enable|disable|lock|unlock|reset');
    pushStatus();
  } else if (w[0] === 'fire' && w[1] === 'trigger' && (t.length === 3 || (t.length === 5 && w[3] === 'after'))) {
    const tr = trigRef(t[2]);
    if (t.length === 5) { schedule({ id: tr.id, due: Date.now() + parseFloat(t[4]) * 1000, every: 0, remaining: 0, count: 1, vars, by: runningTrigger() }); r = `Trigger ${tr.id} in ${t[4]}s`; }
    else { fireByHand(tr, 'nested', vars); r = 'Fired trigger ' + tr.id; }
  } else if (w[0] === 'cancel' && w[1] === 'trigger' && t.length === 3) {
    const id = trigRef(t[2]).id, n = scheduled.length;
    scheduled = scheduled.filter((s) => s.id !== id);
    r = `Cancelled ${n - scheduled.length} pending fire(s) of trigger ${id}`;
  } else if (w[0] === 'repeat' && w[1] === 'trigger' && w[3] === 'every' && (t.length === 5 || (t.length === 7 && w[5] === 'times'))) {
    const id = trigRef(t[2]).id;
    scheduled = scheduled.filter((s) => !(s.id === id && s.every));
    schedule({ id, due: Date.now(), every: parseFloat(t[4]) * 1000, remaining: t.length === 7 ? +t[6] : -1, count: 1, vars: {}, by: runningTrigger() });
    r = `Repeating trigger ${id} every ${t[4]}s`;
  } else if (w[0] === 'stop' && w[1] === 'repeat' && t.length === 3) {
    const id = trigRef(t[2]).id;
    scheduled = scheduled.filter((s) => !(s.id === id && s.every));
    r = 'Stopped repeat of trigger ' + id;
  } else if (w[0] === 'email' && t.length >= 4) {
    if (!project.email?.server) throw new Error('no SMTP server configured (Devices page)');
    log(1, 'SYS', `Email '${t[2]}' sent to ${t[1]} (simulated)`);
    r = `Email to ${t[1]} queued`;
  } else if (w[0] === 'send' && (w[1] === 'udp' || w[1] === 'osc')) {
    // <ip> <port>, a device, or a device group (all its devices) - like needTargets in Cmd.cpp
    let to = [[t[2], t[3]]], next = 4, what = `${t[2]}:${t[3]}`;
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(t[2] || '')) {
      const devs = project.devices || [];
      const d = devs.find((x) => x.name.toLowerCase() === (w[2] || ''));
      const g = !d && (project.deviceGroups || []).find((x) => x.name.toLowerCase() === (w[2] || ''));
      if (d) { to = [[d.ip, d.port]]; what = `${d.name} (${d.ip}:${d.port})`; }
      else if (g) {
        to = g.devices.map((n) => devs.find((x) => x.name.toLowerCase() === n.toLowerCase())).filter(Boolean).map((x) => [x.ip, x.port]);
        if (!to.length) throw new Error(`device group '${t[2]}' has no devices`);
        what = `group ${g.name} (${to.length} devices)`;
      } else throw new Error(`unknown device or IP '${t[2] || ''}'`);
      next = 3;
      // <device|group> <port> ...: another port than the devices' own (overridePort in Cmd.cpp)
      const p = t[3] || '';
      if (t.length > 4 && /^\d{1,5}$/.test(p) && +p >= 1 && +p <= 65535 && (w[1] === 'udp' || t[4].startsWith('/'))) {
        to = to.map(([ip]) => [ip, +p]);
        what = what.replace(/:\d+\)/, `:${p})`);
        next = 4;
      }
    }
    if (t.length <= next) throw new Error(w[1] === 'osc' ? 'missing OSC address (/...)' : 'missing text');
    if (w[1] === 'osc' && !t[next].startsWith('/')) throw new Error('missing OSC address (/...)');
    r = w[1] === 'osc' ? `Sent OSC ${t[next]} ${t.slice(next + 1).join(' ')} to ${what}` : `Sent UDP to ${what}`;
    log(0, 'TRIG', r);
    if (to.length > 1) for (const [ip, port] of to) log(0, 'TRIG', `  -> ${ip}:${port}`);
  } else if (w[0] === 'reply' && t.length > 1) {
    if (!vars?.sender_ip) throw new Error('reply only works in a udp/osc trigger');
    r = `Replied to ${vars.sender_ip}:${vars.sender_port}`;
  }
  else if (w[0] === 'loglevel' && t.length === 3) {
    const l = LVLS.indexOf(t[2].toUpperCase());
    if (l < 0) throw new Error('level must be debug|info|warn|error');
    if (w[1] === 'all') CATS.forEach((c) => (levels[c] = l));
    else if (CATS.includes(t[1].toUpperCase())) levels[t[1].toUpperCase()] = l;
    else throw new Error('unknown log category');
    r = `Log level ${t[1]} = ${t[2]}`;
  } else if (w[0] === 'output' && t.length === 3 && /^(dmx|artnet|sacn)$/.test(w[1]) && /^(on|off)$/.test(w[2])) {
    outputs[w[1]] = w[2] === 'on';
    log(2, 'SHOW', `${w[1]} output ${outputs[w[1]] ? 'enabled' : 'DISABLED'}`);
    r = `Output ${w[1]} ${w[2]}`;
  } else if (w[0] === 'projector' && t.length >= 3) {
    const list = project.projectors || [];
    const targets = w[1] === 'all' ? list : [ref(list, t[1])].filter(Boolean);
    if (!targets.length) throw new Error(`unknown projector '${t[1]}'`);
    let body;
    if (t.length === 3 && /^(on|off)$/.test(w[2])) body = w[2] === 'on' ? 'POWR 1' : 'POWR 0';
    else if (w[2] === 'mute' && t.length === 4 && /^(on|off)$/.test(w[3])) body = w[3] === 'on' ? 'AVMT 31' : 'AVMT 30';
    else if (w[2] === 'input' && t.length === 4) body = 'INPT ' + t[3];
    else if (w[2] === 'send' && t.length >= 4) body = t.slice(3).join(' ');
    else throw new Error('expected: on|off, mute on|off, input <code> or send <command>');
    targets.forEach((x) => pjSend(x, body));
    r = `PJLink '${body}' queued for ${w[1] === 'all' ? 'all projectors' : targets[0].name}`;
  } else if (w[0] === 'pc' && t.length === 3) {
    const list = project.pcs || [];
    const targets = w[1] === 'all' ? list : [ref(list, t[1])].filter(Boolean);
    if (!targets.length) throw new Error(list.length ? `unknown PC '${t[1]}'` : 'no PCs configured');
    if (!/^(wake|startup|shutdown|reboot)$/.test(w[2])) throw new Error('action must be wake|startup|shutdown|reboot');
    for (const pc of targets) {
      if (w[2] === 'wake') {
        const mac = (pc.mac || '').replace(/[^0-9a-f]/gi, '');
        if (mac.length !== 12) throw new Error(`${pc.name}: no MAC address`);
        log(1, 'SYS', `Wake-on-LAN sent to ${pc.name} (${pc.mac} via subnet broadcast) (simulated)`);
      } else {
        log(1, 'SYS', `PC ${pc.name}: '${pc[w[2]] ?? w[2]}' sent to ${pc.ip}:${pc.port ?? 7} (simulated)`);
      }
      pcLast[pc.id] = `${w[2]} @ ${new Date().toLocaleTimeString()}`;
    }
    r = `${w[2] === 'wake' ? 'Wake-on-LAN' : `'${w[2]}'`} sent to ${w[1] === 'all' ? targets.length + ' PC(s)' : targets[0].name}`;
  } else if (w[0] === 'var' && t.length >= 3) {
    // Like Cmd.cpp + Globals::calc: + - * / <n> (or += -= *= /=), ++ and -- (= + 1 / - 1).
    const op = (t[2] === '++' || t[2] === '--') && t.length === 3 ? t[2][0] : /^[-+*/]=?$/.test(t[2]) && t.length === 4 ? t[2][0] : null;
    if (t[2] === '=' && t.length >= 4) r = setVar(t[1], t.slice(3).join(' '));
    else if (op) {
      const v = varDef(t[1]);
      if (!v) throw new Error(`unknown variable '${t[1]}'`);
      if (v.type !== 'number') throw new Error(`${v.name} is not a number`);
      const n = t.length === 4 ? t[3] : '1';
      if (!/^-?\d*\.?\d+$/.test(n)) throw new Error(`'${n}' is not a number`);
      if (op === '/' && +n === 0) throw new Error("can't divide by 0");
      const a = +varVals[v.name], b = +n;
      r = setVar(t[1], String(+({ '+': a + b, '-': a - b, '*': a * b, '/': a / b }[op]).toFixed(4)));
    } else if (w[2] === 'toggle' && t.length === 3) {
      const v = varDef(t[1]);
      if (!v) throw new Error(`unknown variable '${t[1]}'`);
      r = setVar(t[1], varVals[v.name] === '1' ? '0' : '1');
    } else throw new Error('expected: var <name> = <value> | + - * / <n> | ++ | -- | toggle');
  } else if (w[0] === 'send' && w[1] === 'tcp' && t.length >= 4) {
    const d = (project.tcp || []).find((x) => x.name.toLowerCase() === w[2]);
    if (!d) throw new Error(`unknown TCP device '${t[2]}'`);
    const text = t.slice(3).join(' ');
    r = `TCP ${d.name}${answersIp(d.ip) ? '' : ' (not connected, queued)'} <- ${text}`;
    if (answersIp(d.ip)) setTimeout(() => {   // simulated device: answers "ACK <text>"
      const reply = 'ACK ' + text;
      tcpLast[d.name] = { line: reply, at: Math.floor(Date.now() / 1000) };
      log(0, 'SYS', `TCP ${d.name} <- ${reply}`);
      for (const tr of project.triggers) {
        if (tr.enabled === false || tr.type !== 'tcp' || (tr.device && tr.device !== d.name)) continue;
        const m = tr.match ?? '*', vars = { device: d.name, message: reply };
        if (m === '*' || m === '' || m === reply) runTrigger(tr, 'tcp', vars);
        else if (m.endsWith('*') && reply.startsWith(m.slice(0, -1))) runTrigger(tr, 'tcp', { ...vars, 1: reply.slice(m.length - 1).trim() });
      }
    }, 300);
  } else if (w[0] === 'http' && t.length >= 3) {
    const method = t[1].toUpperCase(), url = t[2];
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) throw new Error('method must be get|post|put|delete');
    if (url.startsWith('https://')) throw new Error('https is not supported, use http://');
    if (!/^http:\/\/[^\s/]+/.test(url)) throw new Error('bad URL');
    r = `${method} ${url} queued`;
    setTimeout(() => {   // simulated response
      const host = url.slice(7).split(/[/:]/)[0], ok = answersIp(host);
      const status = ok ? 200 : 0, body = ok ? '{"ok":true,"simulated":true}' : 'cannot connect to ' + host;
      if (ok) log(1, 'SYS', `HTTP ${method} ${url} -> ${status} ${body} (simulated)`); else log(2, 'SYS', `HTTP ${method} ${url} failed: ${body}`);
      for (const tr of project.triggers)
        if (tr.enabled !== false && tr.type === 'http' && (!tr.url || url.startsWith(tr.url))) runTrigger(tr, 'http response', { url, method, status, body });
    }, 400);
  } else if (w[0] === 'modbus' && t.length === 6 && w[2] === 'write') {
    const d = (project.modbus || []).find((x) => x.name.toLowerCase() === w[1]);
    if (!d) throw new Error(`unknown Modbus device '${t[1]}'`);
    const table = w[3] === 'register' ? 'holding' : w[3];
    if (!['coil', 'holding'].includes(table)) throw new Error('only coil and holding can be written');
    plcMem[`${d.name}:${table}:${+t[4]}`] = +t[5];
    r = `Modbus ${d.name}: ${table} ${t[4]} = ${t[5]}`;
  } else if (w[0] === 'ntp' && w[1] === 'sync' && t.length === 2) { ntpLast = Math.floor(Date.now() / 1000); log(1, 'SYS', 'Clock synced via NTP (simulated)'); r = 'NTP sync requested'; }
  else if (w[0] === 'monitor' && w[1] === 'check' && t.length === 2) { setTimeout(() => { runChecks(); drvPoll(); }, 300); r = 'Checking all devices now'; }
  else if (w[0] === 'monitor' && w[1] === 'interval' && t.length === 3) {
    if (!(+t[2] >= 5 && +t[2] <= 3600)) throw new Error('interval must be 5-3600 seconds');
    monInterval = +t[2];
    log(1, 'SYS', `Monitor interval set to ${monInterval} s`);
    r = `Monitor interval ${monInterval} s`;
  } else if (w[0] === 'io') r = boardCommand(t);
  else if (DRV_NAMES[w[0]]) r = drvCommand(t);
  else if (w[0] === 'reload') { loadProject(); r = 'Project reloaded'; }
  else throw new Error('unknown command');
  if (r.startsWith('Started') || r.startsWith('Released') || r.startsWith('Scene') || r.startsWith('Paused') || r.startsWith('Resumed')) log(1, 'SHOW', r);
  log(0, 'CMD', `[${src}] ${line} -> ${r}`);
  return r;
}
function safeExec(line, src, vars) {
  try { return { ok: true, reply: exec(line, src, vars) }; }
  catch (e) { log(2, 'CMD', `[${src}] '${line}' failed: ${e.message}`); return { ok: false, reply: e.message }; }
}
// Conditions, like Triggers::checkCondition. Returns true/false, or a string error.
// ---- conditions and running triggers (src/Triggers.cpp) ----------------------------
function checkCondition(c) {
  const t = tokenize(c), w = t.map((x) => x.toLowerCase());
  const now = new Date();
  if (w[0] === 'mode' && ((t.length === 4 && /^(is|not)$/.test(w[2])) || (t.length === 3 && /^(is|not)$/.test(w[1])))) {
    try {
      const { g, s } = t.length === 4 ? groupState(t[1], t[3]) : anyState(t[2]);
      return (modeCur[g.name] === s) === ((t.length === 4 ? w[2] : w[1]) === 'is');
    } catch (e) { return e.message; }
  }
  if (w[0] === 'timeline' && t.length === 3 && (w[2] === 'running' || w[2] === 'stopped')) {
    const x = ref(project.timelines, t[1]);
    if (!x) return `unknown timeline '${t[1]}'`;
    return pbs.some((p) => p.kind === 'timeline' && p.id === x.id && !p.releasing) === (w[2] === 'running');
  }
  if (w[0] === 'var' && t.length >= 4) {
    const v = varDef(t[1]);
    if (!v) return `unknown variable '${t[1]}'`;
    const cur = varVals[v.name], op = t[2];
    let rhs = t.slice(3).join(' ');
    const l = rhs.toLowerCase();
    if (['on', 'true', 'yes'].includes(l)) rhs = '1';
    if (['off', 'false', 'no'].includes(l)) rhs = '0';
    const num = (s) => /^-?\d+(\.\d+)?$/.test(s);
    if (num(cur) && num(rhs)) {
      const a = +cur, b = +rhs;
      return { '=': a === b, '==': a === b, '!=': a !== b, '>': a > b, '<': a < b, '>=': a >= b, '<=': a <= b }[op] ?? `unknown operator '${op}'`;
    }
    if (op === '=' || op === '==') return cur.toLowerCase() === rhs.toLowerCase();
    if (op === '!=') return cur.toLowerCase() !== rhs.toLowerCase();
    return `'${op}' needs numbers`;
  }
  if (w[0] === 'calendar' && t.length === 3 && /^(active|inactive)$/.test(w[2])) {
    const rows = (project.calendar || []).filter((c) => c.name.toLowerCase() === w[1]);
    if (!rows.length) return `unknown calendar entry '${t[1]}'`;
    const { md, ymd } = SchedM.today();
    return rows.some((c) => SchedM.inPeriod(md, ymd, c.from, c.to)) === (w[2] === 'active');
  }
  if (w[0] === 'date' && w[1] === 'between' && t.length === 4) { const { md, ymd } = SchedM.today(); return SchedM.inPeriod(md, ymd, t[2], t[3]); }
  if (w[0] === 'time' && w[1] === 'between' && t.length === 4) {
    try {
      const a = SchedM.clockMin(t[2]), b = SchedM.clockMin(t[3]), n = now.getHours() * 60 + now.getMinutes();
      return a <= b ? n >= a && n < b : n >= a || n < b;
    } catch (e) { return e.message; }
  }
  if (w[0] === 'device' && t.length === 4 && w[2] === 'is' && /^(online|offline)$/.test(w[3])) {
    const s = hostOnline(t[1]);
    if (s === null) return `unknown device '${t[1]}'`;
    return s === w[3];
  }
  if (w[0] === 'io' && t.length === 4) {
    let k;
    try { k = boardFind(t[1]); } catch (e) { return e.message; }
    const v = board.get(k).value;
    if (w[2] === 'is' && /^(on|off)$/.test(w[3])) return (v >= 0.5) === (w[3] === 'on');
    const r = w[3] === 'on' ? 1 : +t[3] || 0;
    const res = { '=': Math.abs(v - r) < 0.005, '!=': Math.abs(v - r) >= 0.005, '>': v > r, '<': v < r, '>=': v >= r, '<=': v <= r }[t[2]];
    return res ?? 'expected: io <point> is on|off or io <point> =|!=|>|<|>=|<= <value>';
  }
  if (w[0] === 'day' && w[1] === 'is' && t.length >= 3) return t.slice(2).join(',').toLowerCase().split(',').map((s) => s.trim()).includes(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()]);
  return 'unknown condition';
}
let depth = 0;
let running = 0;   // trigger whose actions run now, as in Triggers.cpp
const runningTrigger = () => running;   // for exec(), where "running" is a local helper
// Safe mode (Triggers.cpp, after crash restarts): only triggers fired by hand run.
// The mock never crashes: KD_SAFE_MODE=1 starts it in safe mode, for testing the UI.
let safeMode = process.env.KD_SAFE_MODE === '1';
let userRun = 0;
// Feedback guard, as overloaded() in Triggers.cpp (KD_TRIGGER_MAX_PER_S / KD_TRIGGER_PAUSE_MS).
const TRIG_MAX_PER_S = 100, TRIG_PAUSE_MS = 10000, MAX_SCHEDULED = 100;
let rates = new Map();   // trigger id -> {start, count, pausedUntil}
function overloaded(t, now) {
  const r = rates.get(t.id) || { start: 0, count: 0, pausedUntil: 0 };
  rates.set(t.id, r);
  if (r.pausedUntil) {
    if (now < r.pausedUntil) return true;
    r.pausedUntil = 0; r.count = 0;
    log(1, 'TRIG', `Trigger ${t.id} '${t.name}' runs again`);
  }
  if (t.type === 'dmx_change') return false;
  if (now - r.start >= 1000) { r.start = now; r.count = 0; }
  if (++r.count <= TRIG_MAX_PER_S) return false;
  r.pausedUntil = now + TRIG_PAUSE_MS;
  log(3, 'TRIG', `Trigger ${t.id} '${t.name}' fired over ${TRIG_MAX_PER_S} times in a second - paused for ${TRIG_PAUSE_MS / 1000} s (feedback loop?)`);
  return true;
}
let lastFullWarn = 0;
function schedule(job) {
  if (scheduled.length >= MAX_SCHEDULED) {
    if (Date.now() - lastFullWarn > 5000) { lastFullWarn = Date.now(); log(2, 'TRIG', `Trigger ${job.id}: ${MAX_SCHEDULED} fires/sleeps are already waiting - this one is dropped (loop?)`); }
    throw new Error(`too many waiting fires (max ${MAX_SCHEDULED})`);
  }
  scheduled.push(job);
}
// A fire from the web UI / console (not from a trigger) also runs in safe mode.
function fireByHand(t, why, vars) {
  const user = !depth && !running;
  if (user) userRun++;
  try { runTrigger(t, why, vars); } finally { if (user) userRun--; }
}
// Per-trigger state the firmware keeps in its Trigger struct (cooldown, hold/double, sequence, DMX in).
let trigRt = new Map();
const rt = (t) => trigRt.get(t.id) || (trigRt.set(t.id, { lastRun: 0, pressAt: 0, lastPress: 0, seqPos: 0, seqStart: 0 }), trigRt.get(t.id));
const secs = (v, d) => (v == null || v === '' ? d : +v) * 1000;
const isRunningT = (id) => scheduled.some((s) => s.id === id && s.line != null);
// Last fires for the history strip, like Triggers::remember (src codes as in Triggers.h).
const TRIG_HISTORY = 512, SRC_HAND = 0xffff, SRC_REPEAT = 0xfffe, SRC_DELAYED = 0xfffd, SRC_QUEUED = 0xfffc;
const trigHistory = [];
function remember(t, why) {
  if (t.type === 'dmx_change' || (t.type === 'dmx_in' && (t.when || 'change') === 'change')) return;
  const tl = /^timeline (\d+)/.exec(why);
  const src = why === 'repeat' ? SRC_REPEAT : why === 'delayed' ? SRC_DELAYED : why === 'queued' ? SRC_QUEUED
    : running && running !== t.id ? running : userRun ? SRC_HAND : tl ? 0x8000 | +tl[1] : 0;
  trigHistory.push([Date.now() - bootAt, t.id, src]);
  if (trigHistory.length > TRIG_HISTORY) trigHistory.shift();
}
const bootAt = Date.now();
// The run has nothing left waiting: a fire queued meanwhile goes now (runEnded).
function runEnded(t) {
  if (t.whileRunning !== 'queue' || isRunningT(t.id)) return;
  const q = scheduled.find((s) => s.id === t.id && s.kind === 'queued');
  if (!q) return;
  scheduled = scheduled.filter((s) => s !== q);
  runTrigger(t, 'queued', q.vars);
}
// A trigger fired: move the sequences it is a step of along (stepFired).
function stepFired(t, now) {
  for (const s of project.triggers) {
    if (s.enabled === false || s.type !== 'sequence' || s === t) continue;
    const steps = (s.steps || []).map((r) => { try { return trigRef(String(r).trim()).id; } catch { return -1; } });
    if (!steps.length || !steps.includes(t.id)) continue;
    const r = rt(s);
    if (r.seqPos && now - r.seqStart > secs(s.within, 5)) r.seqPos = 0;
    if (steps[r.seqPos] !== t.id) r.seqPos = 0;
    if (steps[r.seqPos] !== t.id) continue;
    if (!r.seqPos) r.seqStart = now;
    if (++r.seqPos < steps.length) continue;
    r.seqPos = 0;
    runTrigger(s, 'sequence');
  }
}
function runTrigger(t, why, vars, quiet) {
  if (t.type === 'comment') return;
  if (safeMode && !userRun) { log(0, 'TRIG', `Trigger ${t.id} '${t.name}' not run (${why}): safe mode`); return; }
  for (const c of t.conditions || []) {
    const ok = checkCondition(c);
    if (ok !== true) {
      if (typeof ok === 'string') log(2, 'TRIG', `Trigger ${t.id} '${t.name}': condition '${c}' invalid: ${ok}`);
      else log(0, 'TRIG', `Trigger ${t.id} '${t.name}' skipped (${why}): '${c}' is false`);
      return;
    }
  }
  if (depth > 8) { log(3, 'TRIG', `Trigger ${t.id}: nesting too deep (loop?)`); return; }
  const now = Date.now(), r = rt(t), cd = secs(t.cooldown, 0);
  // Fired by hand skips the cooldown, so it can be tested.
  if (cd && r.lastRun && now - r.lastRun < cd && !(userRun && !running)) {
    log(0, 'TRIG', `Trigger ${t.id} '${t.name}' skipped (${why}): cooldown, ${cd - (now - r.lastRun)} ms left`);
    return;
  }
  const wr = t.whileRunning || 'again';
  if (wr !== 'again' && why !== 'queued' && isRunningT(t.id)) {
    if (wr === 'ignore') { log(0, 'TRIG', `Trigger ${t.id} '${t.name}' ignored (${why}): still running`); return; }
    if (wr === 'queue') {
      if (scheduled.some((s) => s.id === t.id && s.kind === 'queued')) { log(0, 'TRIG', `Trigger ${t.id} '${t.name}' ignored (${why}): one is already queued`); return; }
      try { schedule({ id: t.id, due: Infinity, kind: 'queued', vars: { ...(vars || {}) } }); log(0, 'TRIG', `Trigger ${t.id} '${t.name}' queued (${why}): runs when the current run ends`); } catch {}
      return;
    }
    scheduled = scheduled.filter((s) => !(s.id === t.id && s.line != null));
    log(0, 'TRIG', `Trigger ${t.id} '${t.name}' restarts (${why})`);
  }
  if (overloaded(t, now)) return;
  r.lastRun = now;
  const from = running && running !== t.id ? ` from trigger ${running}` : '';
  log(quiet || (t.type === 'dmx_in' && (t.when || 'change') === 'change') ? 0 : 1, 'TRIG', `Trigger ${t.id} '${t.name}' fired (${why}${from})`);
  remember(t, why);
  runActions(t, 0, vars);
  stepFired(t, now);
}
// Like runActions in Triggers.cpp: "sleep <s>", "wait until <cond> [timeout <s>]" and a
// "repeat <n> times every <s> <command>" loop schedule the rest of the actions.
function runActions(t, from, vars) {
  const acts = t.actions || [];
  const was = running;
  running = t.id;
  depth++;
  let later = false;
  const sched = (job) => { try { schedule(job); return true; } catch { return false; } };
  for (let i = from; i < acts.length; i++) {
    const line = expandVars(acts[i], vars).trim();
    const m = /^sleep(\s+(.*))?$/i.exec(line);
    if (m) {
      const s = (m[2] || '').trim();
      if (!/^\d+(\.\d+)?$/.test(s)) { log(2, 'CMD', `[trigger ${t.id}] '${line}' failed: expected: sleep <seconds>`); continue; }
      if (i + 1 < acts.length) {
        later = sched({ id: t.id, due: Date.now() + parseFloat(s) * 1000, every: 0, remaining: 0, count: 1, vars: { ...(vars || {}) }, line: i + 1 });
        if (later) log(0, 'CMD', `[trigger ${t.id}] sleep ${s} s`);
      }
      break;
    }
    if (/^wait(\s|$)/i.test(line)) {
      const w = /^wait\s+until\s+(.+)$/i.exec(line);
      if (!w) { log(2, 'CMD', `[trigger ${t.id}] '${line}' failed: expected: wait until <condition> [timeout <seconds>]`); continue; }
      let cond = w[1].trim(), timeout = 0;
      const to = /^(.*\S)\s+timeout\s+(\d+(?:\.\d+)?)$/i.exec(cond);
      if (to) { cond = to[1]; timeout = +to[2] * 1000; }
      const ok = checkCondition(cond);
      if (ok === true) continue;
      if (typeof ok === 'string') { log(2, 'CMD', `[trigger ${t.id}] wait until '${cond}': ${ok}`); break; }
      if (i + 1 < acts.length) {
        later = sched({ id: t.id, due: timeout ? Date.now() + timeout : 0, kind: 'wait', text: cond, vars: { ...(vars || {}) }, line: i + 1 });
        if (later) log(0, 'CMD', `[trigger ${t.id}] waiting until ${cond}`);
      }
      break;
    }
    // repeat <n> times [every <s>] <command>, or repeat <trigger> <n> times [every|for <s>] (= fire trigger).
    const rp = /^repeat\s+(\d+)\s+times\s+/i.exec(line);
    const rt2 = !rp && /^repeat\s+("[^"]*"|\S+)\s+(\d+)\s+times(?:\s+(?:every|for)\s+(\d+(?:\.\d+)?))?\s*$/i.exec(line);
    if (rp || (rt2 && rt2[1].toLowerCase() !== 'trigger')) {
      const ev = rp && /^repeat\s+\S+\s+times\s+every\s+(\d+(?:\.\d+)?)\s/i.exec(line);
      const n = rp ? +rp[1] : +rt2[2], ms = (rp ? (ev ? +ev[1] : 0) : +(rt2[3] || 0)) * 1000;
      const cmd = rp ? acts[i].trim().replace(ev ? /^(\S+\s+){5}/ : /^(\S+\s+){3}/, '')   // raw: {i} is filled per run
        : `fire trigger "${rt2[1].replace(/^"|"$/g, '')}"`;
      const v = { ...(vars || {}) };
      let k = 1;
      for (; k <= n && (k === 1 || !ms); k++) { v.i = v.count = String(k); safeExec(cmd, 'trigger ' + t.id, v); }
      if (k > n) continue;
      later = sched({ id: t.id, due: Date.now() + ms, every: ms, remaining: n - k + 1, count: k, kind: 'loop', text: cmd, vars: v, line: i });
      break;
    }
    safeExec(acts[i], 'trigger ' + t.id, vars);
  }
  depth--;
  running = was;
  if (!later) runEnded(t);
}
setInterval(() => {   // delayed and repeating fires, waits, loops
  const now = Date.now();
  for (const s of [...scheduled]) {
    if (!scheduled.includes(s) || s.kind === 'queued') continue;
    const tr = project.triggers.find((x) => x.id === s.id);
    if (s.kind === 'wait') {
      const ok = checkCondition(s.text) === true;
      if (!ok && !(s.due && now >= s.due)) continue;
      scheduled = scheduled.filter((x) => x !== s);
      if (!tr) continue;
      if (ok) runActions(tr, s.line, s.vars);
      else { log(2, 'TRIG', `Trigger ${tr.id} '${tr.name}': wait until ${s.text} - timed out, the rest is skipped`); runEnded(tr); }
      continue;
    }
    if (now < s.due) continue;
    if (s.kind === 'loop') {
      const i = s.count, last = s.remaining <= 1;
      if (!last) { s.due += s.every; s.count++; s.remaining--; } else scheduled = scheduled.filter((x) => x !== s);
      if (!tr) continue;
      running = tr.id; depth++;
      safeExec(s.text, 'trigger ' + tr.id, { ...s.vars, i: String(i), count: String(i) });
      depth--; running = 0;
      if (last) runActions(tr, s.line + 1, { ...s.vars, i: String(i) });
      continue;
    }
    if (s.every && (s.remaining < 0 || s.remaining > 1)) { s.due += s.every; s.count++; if (s.remaining > 0) s.remaining--; }
    else scheduled = scheduled.filter((x) => x !== s);
    if (tr && s.line != null) runActions(tr, s.line, s.vars);   // after a sleep, no conditions again
    else if (tr) {
      running = s.by || 0;
      runTrigger(tr, s.every ? 'repeat' : 'delayed', { ...s.vars, count: s.count });
      running = 0;
    }
  }
}, 50);
// Input "edge" hold / double, like inputEdge in Triggers.cpp. Returns nothing; fires runTrigger.
function inputEdge(t, on, now, vars) {
  const r = rt(t), edge = t.edge || 'rising';
  if (edge === 'hold') { r.pressAt = on ? now : 0; return; }
  if (edge === 'double') {
    if (!on) return;
    if (r.lastPress && now - r.lastPress <= secs(t.within, 0.5)) { r.lastPress = 0; runTrigger(t, 'double press', vars); }
    else r.lastPress = now;
    return;
  }
  if ((on && edge !== 'falling') || (!on && edge !== 'rising')) runTrigger(t, on ? 'input rising' : 'input falling', vars);
}
// DMX input (Art-Net / sACN received). The mock receives nothing: "dmxin <artnet|sacn> <universe>
// <channel>[-<channel>] <value>" in the console sets channels of a simulated incoming universe.
const dmxInFrames = new Map();   // "artnet:0" -> Uint8Array(512)
function dmxInCheck() {
  for (const t of project.triggers || []) {
    if (t.enabled === false || t.type !== 'dmx_in') continue;
    const sacn = t.protocol === 'sacn', d = dmxInFrames.get(`${sacn ? 'sacn' : 'artnet'}:${t.universe ?? (sacn ? 1 : 0)}`);
    if (!d) continue;
    const r = rt(t), chans = chanList(t.channels || '1'), level = t.level ?? 128, when = t.when || 'change';
    if (!r.inValues || r.inValues.length !== chans.length) { r.inValues = chans.map((c) => d[c - 1]); continue; }
    chans.forEach((c, i) => {
      const v = d[c - 1], old = r.inValues[i];
      if (v === old) return;
      r.inValues[i] = v;
      if ((when === 'above' && !(old < level && v >= level)) || (when === 'below' && !(old >= level && v < level))) return;
      runTrigger(t, 'dmx in', { channel: String(c), index: String(i + 1), value: String(v), old: String(old) });
    });
  }
}
setInterval(() => {   // hold timers (input / panel) and DMX input, like Triggers::poll
  const now = Date.now();
  for (const t of project.triggers || []) {
    if (t.enabled === false) continue;
    const r = trigRt.get(t.id);
    if (!r?.pressAt || now - r.pressAt < secs(t.hold, 2)) continue;
    if (t.type === 'input' && t.edge === 'hold') { r.pressAt = 0; runTrigger(t, 'input held', r.holdVars); }
    else if (t.type === 'panel' && t.event === 'hold') { r.pressAt = 0; runTrigger(t, 'panel hold', { control: t.control, event: 'hold' }); }
  }
  dmxInCheck();
}, 20);
function onTimelineCue(id, ref) {
  try { runTrigger(trigRef(ref), `timeline ${id} cue`, { timeline: String(id) }); }
  catch (e) { log(2, 'TRIG', `Timeline ${id}: trigger cue: ${e.message}`); }
}
function onTimelineEnd(id) { for (const t of project.triggers) if (t.enabled !== false && t.type === 'timeline_end' && t.timeline === id) runTrigger(t, `timeline ${id} end`); }
function loadProject() {
  project = JSON.parse(fs.readFileSync(PROJECT, 'utf8'));
  pbs = [];
  scheduled = [];
  rates = new Map();
  trigRt = new Map();
  projectVersion++;
  watched.clear();
  for (const k in labels) delete labels[k];
  for (const k of Object.keys(modeCur)) {
    const g = modeGroups().find((x) => x.name === k);
    if (!g || !g.states.includes(modeCur[k])) delete modeCur[k];
  }
  monInterval = project.settings?.monitor?.interval || 60;
  loadVars();
  boardLoad();
  for (const [k, h] of hosts) if (![...(project.pcs || []), ...(project.devices || [])].some((x) => x.name === h.name && x.monitor !== false)) hosts.delete(k);
  outputs = Object.assign({ dmx: true, artnet: true, sacn: true, dmxFps: 40, artnetFps: 40, sacnFps: 40, artnetChangesOnly: true, sacnChangesOnly: true }, project.settings?.outputs);
  log(1, 'SHOW', `Project '${project.name}' loaded: ${project.universes.length} universes, ${project.fixtures.length} fixtures, ${project.scenes.length} scenes, ${project.timelines.length} timelines`);
  for (const t of project.triggers) if (t.enabled !== false && t.type === 'startup') runTrigger(t, 'startup');
}

// ---- background noise so the live log has something to show ---------------
setInterval(() => {
  const r = Math.random();
  if (r < 0.5) log(0, 'ARTNET', `ArtPoll from 192.168.1.${10 + Math.floor(Math.random() * 20)}`);
  else if (r < 0.6) log(0, 'WEB', 'GET /api/dmx?u=1');
  else if (r < 0.63) log(2, 'NET', 'Ethernet link flapped (simulated)');
}, 1500);

// ---- HTTP -----------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
function body(req) { return new Promise((res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => res(b)); }); }
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
let httpCount = 0, clock = 0;

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  httpCount++;
  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    const since = +url.searchParams.get('since') || 0;
    for (const e of ring) if (e.s > since && since) res.write(`event: log\ndata: ${JSON.stringify(e)}\n\n`);
    sse.add(res);
    req.on('close', () => sse.delete(res));
    return;
  }
  if (p.startsWith('/api/') && Date.now() < upd.offlineUntil) { res.writeHead(503); return res.end(); }   // "restarting"
  if (p === '/api/status') return json(res, 200, status());
  if (p === '/api/update') {
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const r = checkUpdate(Buffer.concat(chunks));
    if (!r.ok) { log(2, 'SYS', `Update rejected: ${r.reply}`); return json(res, 400, { ...r, restart: false }); }
    if (!r.fw) { log(1, 'SYS', `Web UI updated (${r.version}) - mock: nothing written`); return json(res, 200, { ok: true, reply: 'Web UI updated (mock: nothing written)', restart: false }); }
    log(1, 'SYS', `Firmware ${r.version} stored - restarting to install it (mock: nothing written)`);
    upd.restarting = true;
    setTimeout(() => { upd.offlineUntil = Date.now() + 6000; }, 2000);
    setTimeout(() => {
      upd.last = `${upd.version} -> ${r.version}`;
      upd.version = r.version;
      upd.restarting = false;
      t0 = Date.now();
      histBooted = false; histDay = 0; lastRec.length = 0;   // the history gets a "boot" line, like after a real restart
      log(1, 'SYS', `Firmware updated: ${upd.last}`);
    }, 8000);
    return json(res, 200, { ok: true, reply: `Firmware ${r.version} stored, restarting to install it`, restart: true });
  }
  if (p === '/api/project' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(fs.readFileSync(PROJECT)); }
  if (p === '/api/project') {
    const b = await body(req);
    try { JSON.parse(b); } catch (e) { return json(res, 400, { ok: false, reply: 'JSON error: ' + e.message }); }
    fs.copyFileSync(PROJECT, PROJECT.replace(/\.json$/, '.bak'));
    fs.writeFileSync(PROJECT, b);
    if (safeMode) { safeMode = false; log(1, 'TRIG', 'Safe mode off - triggers run again'); }
    loadProject();
    log(1, 'WEB', `Project saved to USB (${b.length} bytes)`);
    return json(res, 200, { ok: true, reply: 'Saved and loaded' });
  }
  if (p === '/api/cmd') {
    const lines = (await body(req)).split('\n').filter((l) => l.trim());
    const rs = lines.map((l) => safeExec(l, 'web'));
    return json(res, rs.every((r) => r.ok) ? 200 : 400, { ok: rs.every((r) => r.ok), reply: rs.map((r) => r.reply).join('\n') });
  }
  if (p === '/api/trigger') {
    const t = project.triggers.find((x) => x.id === +url.searchParams.get('id'));
    if (!t) return json(res, 400, { ok: false, reply: 'Unknown trigger' });
    fireByHand(t, 'manual');
    return json(res, 200, { ok: true, reply: `Fired trigger ${t.id}` });
  }
  if (p === '/api/trighistory') return json(res, 200, { now: Date.now() - bootAt, h: trigHistory });
  if (p === '/api/panel') {
    const control = url.searchParams.get('control'), event = url.searchParams.get('event');
    const value = url.searchParams.get('value') || '', links = url.searchParams.get('vars') || '';
    let n = 0;
    const now = Date.now();
    const vars = { control, event };
    // Slider / dial / wheel / toggle / XY pad: keep the value for other panels, set the linked
    // variables (vars=<name>=<value>;…, like Web.cpp).
    if (value) {
      ctl(control).value = value;
      vars.value = value;
      if (/^#[0-9a-f]{6}$/i.test(value)) { const c = parseInt(value.slice(1), 16); Object.assign(vars, { r: String(c >> 16 & 255), g: String(c >> 8 & 255), b: String(c & 255) }); }
      if (value.indexOf(',') > 0) [vars.x, vars.y] = [value.slice(0, value.indexOf(',')), value.slice(value.indexOf(',') + 1)];
      for (const pair of links.split(';')) {
        const eq = pair.indexOf('=');
        if (eq > 0) try { setVar(pair.slice(0, eq), pair.slice(eq + 1)); } catch (e) { log(2, 'WEB', `Panel ${control}: ${e.message}`); }
      }
      pushStatus();
    }
    for (const t of project.triggers) {
      if (t.enabled === false || t.type !== 'panel' || (t.control || '').toLowerCase() !== (control || '').toLowerCase()) continue;
      const ev = t.event || 'click', r = rt(t);
      // hold: press starts the clock (the hold timer fires), release cancels. double: two clicks within "within" s.
      if (ev === 'hold') { if (event === 'press') r.pressAt = now; else if (event === 'release') r.pressAt = 0; continue; }
      if (ev === 'double') {
        if (event !== 'click') continue;
        if (!r.lastPress || now - r.lastPress > secs(t.within, 0.5)) { r.lastPress = now; continue; }
        r.lastPress = 0;
        runTrigger(t, 'panel double', { ...vars, event: 'double' });
        n++;
        continue;
      }
      if (ev !== event) continue;
      runTrigger(t, 'panel', vars);
      n++;
    }
    log(0, 'TRIG', `Panel ${control} ${event} (${n} trigger(s))`);
    return json(res, 200, { ok: true, reply: `${n} trigger(s)` });
  }
  if (p === '/api/log') { const s = +url.searchParams.get('since') || 0; return json(res, 200, ring.filter((e) => e.s > s)); }
  if (p === '/api/history') return json(res, 200, historyLines(url.searchParams.get('name') || '', +url.searchParams.get('from') || 0, +url.searchParams.get('to') || 0));
  if (p === '/api/devlog') return json(res, 200, logSearch(url.searchParams.get('name') || '', url.searchParams.get('ip') || '', +url.searchParams.get('from') || 0, +url.searchParams.get('to') || 0, 300));
  if (p === '/api/loglevels') return json(res, 200, Object.fromEntries(CATS.map((c) => [c, LVLS[levels[c]]])));
  if (p === '/api/dmx') {
    // ?o=1 (DMX monitor): values plus the overridden channel numbers, like Web.cpp
    const id = url.searchParams.get('u'), u = out[id];
    if (url.searchParams.get('o') === '1') {
      const o = [...overrides.keys()].filter((k) => k.split('.')[0] === id).map((k) => +k.split('.')[1]).sort((a, b) => a - b);
      return u ? json(res, 200, { v: [...u], o }) : json(res, 404, { v: [] });
    }
    return u ? json(res, 200, [...u]) : json(res, 404, []);
  }
  if (p === '/api/time') { clock = +(await body(req)); log(1, 'SYS', 'Clock set from browser'); return json(res, 200, { ok: true, reply: 'Clock set' }); }
  // Uploaded images (map backgrounds), like /api/media + /media/ on the controller.
  const okName = (n) => /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/.test(n || '') && /\.(png|jpe?g|webp|gif|svg)$/i.test(n);
  if (p === '/api/media' && req.method === 'DELETE') {
    const n = url.searchParams.get('name');
    const ok = okName(n) && fs.existsSync(path.join(MEDIA, n));
    if (ok) fs.unlinkSync(path.join(MEDIA, n));
    return json(res, ok ? 200 : 400, { ok, reply: ok ? 'Deleted' : 'Not found' });
  }
  if (p === '/api/media') {
    const n = url.searchParams.get('name');
    if (!okName(n)) return json(res, 400, { ok: false, reply: 'Bad file name (letters, digits, . - _ and an image extension)' });
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const buf = Buffer.concat(chunks);
    if (buf.length > 4 * 1048576) return json(res, 400, { ok: false, reply: 'File too big (max 4 MB)' });
    fs.mkdirSync(MEDIA, { recursive: true });
    fs.writeFileSync(path.join(MEDIA, n), buf);
    log(1, 'WEB', `Media '${n}' saved (${buf.length} bytes)`);
    return json(res, 200, { ok: true, reply: '/media/' + n });
  }
  if (p.startsWith('/media/')) {
    const n = p.slice(7);
    if (!okName(n) || !fs.existsSync(path.join(MEDIA, n))) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(n).toLowerCase();
    res.writeHead(200, { 'Content-Type': { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' }[ext] });
    return res.end(fs.readFileSync(path.join(MEDIA, n)));
  }
  if (p.startsWith('/api/')) return json(res, 404, { ok: false, reply: 'unknown endpoint' });
  const file = path.join(WWW,p === '/' ? 'index.html' : p === '/panel' ? 'panel.html' : p);
  if (!file.startsWith(WWW) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(fs.readFileSync(file));
}).listen(PORT, () => {
  console.log(`KD Designer mock running on http://localhost:${PORT} (show folder ${SHOW})`);
  log(1, 'SYS', 'KD Designer mock booting');
  log(1, 'USB', 'USB stick mounted at /usb');
  log(1, 'NET', 'IP 127.0.0.1  MAC 00:00:00:00:00:00');
  loadProject();
});

// ---- Software update (.kdupdate from tools/make_update.py), checked like src/Update.cpp ----
// Nothing is written (data/www is the source the mock serves); a firmware update only
// pretends to restart (API offline for a few seconds) and then reports the new version.
const upd = { version: 'mock', last: '', restarting: false, offlineUntil: 0 };
const updTarget = () => (boardStatus() ? 'machine_control' : 'portenta');
function checkUpdate(buf) {
  const bad = (reply) => ({ ok: false, reply }), magic = 'KDUPDATE 1\n';
  if (upd.restarting) return bad('An update is already waiting for the restart');
  if (buf.subarray(0, magic.length).toString() !== magic) return bad('Not a KD Designer update file (.kdupdate)');
  const nl = buf.indexOf(10, magic.length);
  let h;
  try { h = JSON.parse(buf.subarray(magic.length, nl).toString()); } catch { return bad('Damaged update file (header)'); }
  const files = h.files || [], fw = files.some((f) => f.name === 'firmware.bin');
  const wwwName = (n) => /^www\/[A-Za-z0-9._/-]+$/.test(n) && !n.includes('..') && !n.includes('//') && !n.endsWith('/') && n.length <= 100;
  const odd = files.find((f) => f.name !== 'firmware.bin' && !wwwName(f.name));
  if (odd) return bad('Bad file name in the update: ' + odd.name);
  if (!files.length) return bad('The update file is empty');
  let at = nl + 1;
  if (files.reduce((s, f) => s + f.size, 0) !== buf.length - at) return bad('Upload incomplete or damaged (size)');
  if ((fw || h.target !== 'any') && h.target !== updTarget()) return bad(`This update is for a ${h.target} controller, this one is ${updTarget()}`);
  for (const f of files) {
    if (zlib.crc32(buf.subarray(at, at + f.size)) !== f.crc) return bad(`Damaged update file (${f.name} checksum)`);
    at += f.size;
  }
  return { ok: true, fw, version: h.version };
}

// Simulated heap, in the range estimated for the Portenta H7 (~300 KB heap).
const heap = { size: 314248, used: 0, free: 0, minFree: 0 };
function sampleHeap() {
  heap.used = 172000 + Math.round(Math.random() * 9000) + sse.size * 4096;
  heap.free = heap.size - heap.used - 6000;
  heap.minFree = heap.minFree ? Math.min(heap.minFree, heap.free) : heap.free;
  return { ...heap };
}
function status() {
  const now = Date.now();
  return {
    version: upd.version, uptime: now - t0, started: 'power on',
    update: { target: updTarget(), ready: true, bootloader: 25, ...(upd.last ? { last: upd.last, lastOk: true } : {}), ...(upd.restarting ? { restarting: true } : {}) }, time: clock ? Math.floor(now / 1000) : 0, usb: true, ip: '127.0.0.1',
    stats: { engineFps: 40, dmxFps: 40, artTx: 80, artRx: 1, sacnTx: 80, udpRx: 0, tickUs: 180 + Math.floor(Math.random() * 40), loopUs: 900, http: httpCount, heap: sampleHeap() },
    logSeq: seq, project: project.name, projectVersion, gm: Math.round(gm * 100), blackout, outputs, labels,
    modes: Object.fromEntries(modeGroups().map((g) => [g.name, modeCur[g.name] || ''])), mode: modeCur[modeGroups()[0]?.name] || '',
    pcs: (project.pcs || []).map((x) => ({ id: x.id, last: pcLast[x.id] || '' })),
    vars: { ...varVals },
    clock: (() => {
      const n = new Date(), { md, ymd } = SchedM.today(), pad = (x) => String(x).padStart(2, '0');
      const s = project.settings || {};
      return {
        set: true, local: `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())} ${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`,
        dst: false, tzOffsetMin: s.tzOffsetMin ?? 60, dstRule: s.time?.dst || 'eu',
        ntp: { enabled: s.time?.ntpEnabled !== false, server: s.time?.ntp || 'pool.ntp.org', lastSync: ntpLast || Math.floor(t0 / 1000), offset: 0 },
        sunrise: hm(SchedM.sun(true)), sunset: hm(SchedM.sun(false)),
        calendar: [...new Set((project.calendar || []).filter((c) => SchedM.inPeriod(md, ymd, c.from, c.to)).map((c) => c.name))],
      };
    })(),
    io: {
      tcp: (project.tcp || []).map((d) => ({ name: d.name, ip: d.ip, port: d.port, state: answersIp(d.ip) ? 'online' : 'offline', lastRx: tcpLast[d.name]?.at || 0, lastLine: tcpLast[d.name]?.line })),
      modbus: (project.modbus || []).map((d) => ({ name: d.name, ip: d.ip, state: answersIp(d.ip) ? 'online' : 'offline', errors: 0, lastOk: answersIp(d.ip) ? Math.floor(now / 1000) : 0 })),
    },
    monitor: { interval: monInterval, lastRun: monLastRun, nextIn: monLastRunMs ? Math.round((monInterval * 1000 - (now - monLastRunMs)) / 1000) : 0,
      hosts: [...hosts.values()].map(({ fails, ...h }) => h) },
    scheduled: scheduled.filter((s) => s.kind !== 'queued').map((s) => ({ trigger: s.id, in: s.kind === 'wait' && !s.due ? -1 : s.due - now,
      ...(s.kind === 'loop' ? { loop: s.remaining } : s.every ? { every: s.every, count: s.count, remaining: s.remaining } : {}),
      ...(s.kind === 'wait' ? { wait: s.text } : {}), ...(s.line != null ? { sleep: true } : {}) })),
    paused: [...rates].filter(([, r]) => r.pausedUntil > now).map(([id, r]) => ({ trigger: id, in: r.pausedUntil - now })),
    ...(safeMode ? { safeMode: true } : {}),
    projectors: (project.projectors || []).map((x) => {
      const st = pj(x.id);
      return { id: x.id, name: x.name, ip: x.ip, online: st.online, seen: st.seen, power: POWER[st.power], last: st.last,
        errors: st.errors, lamp: st.lamp, input: st.input, mute: st.mute, model: st.model, lastSeen: st.lastSeen, lastCheck: st.lastCheck,
        history: st.history || 0, checks: st.checks || 0 };
    }),
    drivers: drvStatus(),
    board: boardStatus(),   // only on the Machine Control firmware
    mqtt: (() => {   // the broker in Mqtt.cpp: simulated NETIO clients with live updates on
      const cl = (project.drivers || []).filter((d) => d.type === 'netio' && d.live && drv(d).online);
      return { enabled: (project.drivers || []).some((d) => d.type === 'netio' && d.live), port: 1883, messages: cl.length * Math.floor((now - t0) / 60000),
        clients: cl.map((d) => ({ ip: d.ip, id: 'netio-' + d.name, messages: Math.floor((now - t0) / 60000), since: Math.floor((now - t0) / 1000) })) };
    })(),
    playbacks: pbs.map((pb) => {
      const t = pb.kind === 'timeline' ? project.timelines.find((x) => x.id === pb.id) : project.scenes.find((x) => x.id === pb.id);
      const o = { kind: pb.kind, id: pb.id, name: t.name, master: Math.round(pb.master * 100), releasing: !!pb.releasing };
      if (pb.kind === 'timeline') Object.assign(o, { pos: (pb.paused ? pb.pausedAt : now) - pb.start, length: t.length, paused: !!pb.paused, ended: !!pb.ended });
      return o;
    }),
  };
}
function pushStatus() { const s = JSON.stringify(status()); for (const res of sse) res.write(`event: status\ndata: ${s}\n\n`); }
setInterval(pushStatus, 1000);
