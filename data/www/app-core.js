'use strict';
// KD Designer web UI - state, project, API, data binding, header, live log, render().
// Plain scripts sharing one global scope; load order is in index.html.

const LOG_CATS = ['SYS', 'USB', 'NET', 'DMX', 'ARTNET', 'SACN', 'SHOW', 'TRIG', 'WEB', 'CMD', 'PJLINK'];
const PJ_INPUTS = [['11', 'RGB 1'], ['12', 'RGB 2'], ['21', 'Video 1'], ['31', 'HDMI / digital 1'], ['32', 'HDMI / digital 2'], ['33', 'Digital 3'], ['41', 'Storage'], ['51', 'Network']];
const PROTOCOLS = [['dmx', 'DMX'], ['artnet', 'Art-Net'], ['sacn', 'sACN']];
const PC_ACTIONS = [['wake', 'Wake-on-LAN magic packet'], ['startup', 'UDP "startup" command'], ['shutdown', 'UDP "shutdown" command'], ['reboot', 'UDP "reboot" command']];
const LOG_LVLS = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
// Device drivers (src/Drivers.cpp): type -> label, default port, what it speaks.
const DRIVERS = {
  kissbox: { label: 'Kiss-Box', port: 9813, about: 'I/O card frame · UDP' },
  knx: { label: 'KNX', port: 3671, about: 'KNX IP interface · tunnelling' },
  brightsign: { label: 'BrightSign', port: 80, about: 'player · UDP + DWS REST API' },
  digidot: { label: 'DiGidot C4', port: 80, about: 'pixel controller · JSON API' },
  netio: { label: 'NETIO', port: 80, about: 'power sockets · JSON API' },
  pharos: { label: 'Pharos', port: 80, about: 'LPC / TPC · HTTP API' },
};
// Portenta Machine Control I/O (src/Board.cpp): point prefix, count, name, rating. Keys match the labels on the case (in0, io11, ao3).
const PMC_GROUPS = [['in', 8, 'Digital inputs', '24 V'], ['out', 8, 'Digital outputs', '24 V · 0.5 A each'],
  ['io', 12, 'Programmable I/O', '24 V · each one an input or an output'], ['ai', 3, 'Analog inputs', '0-10 V, 4-20 mA or NTC'], ['ao', 4, 'Analog outputs', '0-10 V']];
const PMC_AI_MODES = [['0-10V', '0-10 V', 'V'], ['4-20mA', '4-20 mA', 'mA'], ['NTC', 'NTC / resistance', 'Ω']];
const pmcKeys = () => PMC_GROUPS.flatMap(([g, n]) => Array.from({ length: n }, (_, c) => g + c));
const pmcCfg = (k) => S.project?.machineControl?.[k] || {};
const pmcIsOut = (k) => /^(out|ao)/.test(k) || (/^io/.test(k) && pmcCfg(k).mode === 'out');
const pmcUnit = (k) => (/^ao/.test(k) ? 'V' : /^ai/.test(k) ? PMC_AI_MODES.find(([m]) => m === (pmcCfg(k).mode || '0-10V'))[2] : '');
// "out3" or a point's name -> key.
const pmcFind = (tok) => pmcKeys().find((k) => k === String(tok).toLowerCase() || (pmcCfg(k).name || '').toLowerCase() === String(tok).toLowerCase());
const PHAROS_PROTOCOLS = ['dmx', 'art-net', 'sacn', 'pathport', 'kinet', 'rio-dmx', 'edn', 'edn-spi'];
const TRIGGER_TYPES = [
  ['startup', 'Startup'], ['time', 'Time of day / sunrise / sunset'], ['interval', 'Interval'], ['udp', 'UDP message'], ['osc', 'OSC message'],
  ['input', 'Input (pin / Machine Control)'], ['timeline_end', 'Timeline end'], ['mode', 'Mode change'], ['panel', 'Panel button'],
  ['dmx_change', 'DMX channel change'], ['device', 'Device online/offline'], ['projector', 'Projector alarm (errors, lamp hours)'], ['variable', 'Variable change'],
  ['tcp', 'TCP message received'], ['http', 'HTTP response'], ['dmx_in', 'DMX input (Art-Net / sACN in)'], ['sequence', 'Sequence (other triggers in order)'],
  ['manual', 'Manual / nested list'], ['comment', '— Separator —'],
];
// Variables each trigger type provides to its actions as {name}.
const TRIGGER_VARS = {
  udp: ['message', '1 (text after a prefix*)', 'sender_ip', 'sender_port'],
  osc: ['address', '1 … n (arguments)', 'sender_ip', 'sender_port'],
  mode: ['group', 'mode'], panel: ['control', 'event', 'value (slider, dial, toggle 1/0, wheel #rrggbb, XY pad x,y)', 'r', 'g', 'b (colour wheel, 0-255)', 'x', 'y (XY pad)'], device: ['device', 'kind', 'state'],
  projector: ['projector', 'alarm', 'state', 'lamp (hours)', 'hours (the limit)'],
  variable: ['variable', 'value', 'old'], tcp: ['device', 'message', '1 (text after a prefix*)'], http: ['url', 'method', 'status', 'body'],
  dmx_change: ['channel', 'index', 'value', '+ your table names'], input: ['input', 'value'], dmx_in: ['channel', 'index', 'value', 'old'],
};
const TRIGGER_COLORS = {
  '': 'none', red: '#ff5c5c', orange: '#ff9f43', amber: '#ffb020', yellow: '#ffd23f', lime: '#a3e635', green: '#3ecf8e',
  teal: '#2dd4bf', cyan: '#3ad1e0', blue: '#4aa3ff', indigo: '#818cf8', purple: '#b07cff', magenta: '#e879f9',
  pink: '#f472b6', brown: '#b0855a', grey: '#9ca3af', white: '#f3f4f6',
};
// Named colour or a custom "#rrggbb".
const trigColor = (c) => (c ? TRIGGER_COLORS[c] || (/^#[0-9a-f]{6}$/i.test(c) ? c : '') : '');
const CURVES = [['linear', 'Linear'], ['square', 'Square law'], ['nondim', 'Non-dim (switch)'], ['preheat5', '5% preheat'], ['preheat10', '10% preheat']];
const PATHS = [['linear', 'Linear'], ['accelerated', 'Accelerated'], ['braked', 'Braked'], ['damped', 'Damped (S-curve)'], ['overshoot', 'Overshoot']];
const TL_GROUPS = ['', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
const PANEL_TYPES = ['button', 'toggle', 'slider', 'dial', 'color', 'xy', 'label', 'clock', 'spacer'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const PLACEHOLDER = {
  '{mode}': '<mode>', '{mgroup}': '<mode group>', '{mstate}': '<state>', '{label}': '<label>', '{pctl}': '<panel control>', '{flash}': 'on|off|<colour>', '{pval}': '<value | #rrggbb | x,y>', '{color}': '<colour>', '{trig}': '<trigger name or #>', '{count}': '<count>',
  '{email}': '<to address>', '{device}': '<device>', '{oscaddr}': '</osc/address>', '{hhmm}': '<HH:MM>', '{days}': '<mon,tue,…>',
  '{tl}': '<timeline>', '{sc}': '<scene>', '{sec}': '<seconds>', '{pct}': '<0-100>', '{dmx}': '<0-255>',
  '{chan}': '<universe>.<ch>[-<ch>]', '{ip}': '<ip address>', '{port}': '<port>', '{text...}': '<text>',
  '{onoff}': 'on|off', '{logcat}': '<category>', '{loglvl}': '<level>',
  '{proto}': 'dmx|artnet|sacn', '{pj}': '<projector|all>', '{pjinput}': '<input code>',
  '{pc}': '<pc|all>', '{pcaction}': 'wake|startup|shutdown|reboot', '{devname}': '<device>', '{updown}': 'online|offline',
  '{var}': '<variable>', '{num}': '<number>', '{op}': '= != > < >= <=', '{tcpdev}': '<tcp device>', '{httpmethod}': 'get|post|put|delete',
  '{url}': '<http://…>', '{mbdev}': '<modbus device>', '{mbtable}': 'coil|holding', '{calname}': '<calendar>', '{activity}': 'active|inactive',
  '{date}': '<MM-DD|YYYY-MM-DD>', '{cond...}': '<condition>', '{command...}': '<command>',
  '{kiss}': '<kiss-box>', '{knx}': '<knx interface>', '{bsign}': '<brightsign>', '{digi}': '<digidot>', '{netio}': '<netio>', '{pharos}': '<pharos>',
  '{kisspoint}': '<slot>.<channel>', '{kissval}': 'on|off|0-255', '{slot}': '<slot 1-8>', '{knxga}': '<group address or name>', '{knxval}': '<value>',
  '{dpt}': '<dpt, e.g. 1 / 5.001 / 9>', '{path}': '<path>', '{digiscene}': '<scene name or #>', '{netioout}': '<output|all>',
  '{netioact}': 'on|off|toggle|restart|pulse', '{pharostl}': 'start|release|toggle|pause|resume', '{pharossc}': 'start|release|toggle',
  '{fixgrp}': 'fixture|group', '{pharosproto}': '<protocol>', '{word}': '<name>',
  '{iopoint}': '<point, e.g. out3, or its name>', '{ioval}': 'on|off|toggle|<volts>',
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const S = {
  project: null, dirty: false, status: null, statusAt: 0, view: 'dashboard',
  sel: { scene: 0, timeline: 0, trigger: 0, map: 0, cue: -1 },
  mapSel: new Set(),   // fixture ids selected on the map
  mediaTrash: new Set(),   // map images to delete after the next save
  log: [], logSeq: 0, logPaused: false, logUnseen: 0,
  logFilter: { min: 0, cats: new Set(LOG_CATS), text: '' },
  history: JSON.parse(localStorage.getItem('kd.history') || '[]'),
  consoleLines: [], dmxU: 1, preview: false,
};
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const P = () => S.project;

function emptyProject() {
  return {
    name: 'New show', settings: { tzOffsetMin: 60, udpPort: 4000, sacnPriority: 100, outputs: { dmx: true, artnet: true, sacn: true } },
    network: { dhcp: true, ip: '192.168.1.50', mask: '255.255.255.0', gateway: '192.168.1.1' },
    universes: [{ id: 1, name: 'Universe 1', dmxPort: 1, artnet: 0, sacn: 1, useDmx: true, useArtnet: true, useSacn: true }],
    fixtures: [], groups: [], scenes: [], timelines: [], triggers: [], projectors: [], pcs: [], devices: [], modes: [],
    panel: { pages: [] }, email: { server: '', port: 25, user: '', password: '', from: '' },
  };
}
function normalize(p) {
  const e = emptyProject();
  for (const k of ['universes', 'fixtures', 'groups', 'scenes', 'timelines', 'triggers', 'projectors', 'pcs', 'devices', 'modes',
    'variables', 'tcp', 'modbus', 'calendar', 'maps', 'effects', 'deviceGroups', 'fixtureTypes', 'drivers']) p[k] = p[k] || [];
  p.deviceGroups.forEach((g) => (g.devices = g.devices || []));
  p.drivers.forEach(normDriver);   // app-drivers.js
  p.maps.forEach((m) => { m.items = m.items || []; m.aspect = m.aspect || 1.6; });
  p.panel = p.panel || { pages: [] };
  p.panel.pages = p.panel.pages || [];
  p.panel.pages.forEach((pg) => (pg.controls = pg.controls || []));
  p.panel.theme = p.panel.theme || {};   // panel-ui.js PANEL_THEME: only what differs from the default
  p.email = Object.assign(e.email, p.email);
  p.triggers.forEach((t) => (t.conditions = t.conditions || []));
  p.groups.forEach((g) => (g.fixtures = g.fixtures || []));
  // Old projects: "modes": ["EMERGENCY", ...] becomes one group "Mode" (same as the firmware).
  const legacy = p.modes.filter((m) => typeof m === 'string');
  p.modes = p.modes.filter((m) => m && typeof m === 'object').map((g) => ({ name: g.name || 'Mode', states: g.states || [] }));
  if (legacy.length) p.modes.unshift({ name: 'Mode', states: legacy });
  p.settings = Object.assign(e.settings, p.settings);
  p.settings.outputs = Object.assign({ dmx: true, artnet: true, sacn: true, dmxFps: 40, artnetFps: 40, sacnFps: 40, artnetChangesOnly: true, sacnChangesOnly: true }, p.settings.outputs);
  p.settings.monitor = Object.assign({ interval: 60, timeout: 1000, failures: 2 }, p.settings.monitor);
  p.settings.time = Object.assign({ ntp: 'pool.ntp.org', ntpEnabled: true, dst: 'eu' }, p.settings.time);
  p.settings.location = p.settings.location || {};
  // Older projects have no use* flags: derive them like the firmware does.
  p.universes.forEach((u) => {
    u.useDmx ??= (u.dmxPort || 0) > 0;
    u.useArtnet ??= (u.artnet ?? -1) >= 0;
    u.useSacn ??= (u.sacn || 0) > 0;
  });
  p.network = Object.assign(e.network, p.network);
  p.scenes.forEach((s) => (s.levels = s.levels || []));
  // Tracks: lanes like Pharos. A track without fixtures plays scenes on the whole rig.
  p.timelines.forEach((t) => {
    t.cues = t.cues || [];
    t.tracks = t.tracks?.length ? t.tracks : [{ name: 'Scenes', fixtures: [], groups: [] }];
    t.tracks.forEach((tr) => { tr.fixtures = tr.fixtures || []; tr.groups = tr.groups || []; });
  });
  p.triggers.forEach((t) => (t.actions = t.actions || []));
  return p;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(body.reply || body || r.statusText);
  return body;
}
async function cmd(line) {
  try {
    const r = await api('/api/cmd', { method: 'POST', body: line });
    return { ok: true, reply: r.reply };
  } catch (e) {
    return { ok: false, reply: e.message };
  }
}
async function save() {
  // Ctrl+S while typing: commit the field being edited first (it only
  // commits on "change", which hasn't fired yet).
  const el = document.activeElement;
  if (el?.dataset?.p) onBound({ target: el, type: 'input' });
  try {
    const r = await api('/api/project', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(P(), null, 1) });
    S.dirty = false;
    if (undo.timer) undoSnap();
    undo.saved = undo.at;   // undoing back to here is "saved" again
    // Map images that were replaced or removed: only now that the saved project no longer
    // uses them (unsaved changes must never point at a deleted image).
    for (const name of S.mediaTrash)
      if (!P().maps.some((m) => m.background === name)) fetch(`/api/media?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
    S.mediaTrash.clear();
    updateHeader();
    toast(r.reply || 'Saved');
  } catch (e) {
    toast('Save failed: ' + e.message, true);
  }
}
function toast(msg, err) {
  const d = document.createElement('div');
  d.textContent = msg;
  if (err) d.className = 'err';
  $('#toast').appendChild(d);
  setTimeout(() => d.remove(), err ? 6000 : 2500);
}
function markDirty() {
  S.dirty = true;
  updateHeader();
  // A copy for undo once the edits pause, so a slider drag or typing a name is one step.
  clearTimeout(undo.timer);
  undo.timer = setTimeout(undoSnap, 400);
  updateUndoButtons();
}

// ---------------------------------------------------------------------------
// Undo / redo: copies (JSON) of the whole project after each change, newest last.
// undo.at = the copy the project is now; undo.saved = the copy that was last saved.
// ---------------------------------------------------------------------------
const UNDO_MAX = 60;
const undo = { stack: [], at: -1, saved: -1, timer: 0 };
function undoReset(saved = true) {
  clearTimeout(undo.timer);
  undo.timer = 0;
  undo.stack = [JSON.stringify(P())];
  undo.at = 0;
  undo.saved = saved ? 0 : -1;
  updateUndoButtons();
}
function undoSnap() {
  clearTimeout(undo.timer);
  undo.timer = 0;
  const s = JSON.stringify(P());
  if (s === undo.stack[undo.at]) return;
  undo.stack.length = undo.at + 1;   // a new change drops what could be redone
  undo.stack.push(s);
  if (undo.stack.length > UNDO_MAX) { undo.stack.shift(); undo.saved--; }
  undo.at = undo.stack.length - 1;
  updateUndoButtons();
}
function undoStep(d) {
  if (undo.timer) undoSnap();   // the change still being made counts first
  const to = undo.at + d;
  if (to < 0 || to >= undo.stack.length) return toast(d < 0 ? 'Nothing to undo' : 'Nothing to redo');
  undo.at = to;
  S.project = normalize(JSON.parse(undo.stack[to]));
  S.dirty = to !== undo.saved;
  // Selections may point at things that are gone now.
  for (const k of ['scene', 'timeline', 'trigger', 'map', 'effect']) S.sel[k] = Math.min(S.sel[k] || 0, Math.max(0, (P()[k + 's'] || []).length - 1));
  S.sel.cue = -1;
  updateHeader();
  updateUndoButtons();
  render();
  toast(d < 0 ? 'Undone' : 'Redone');
}
function updateUndoButtons() {
  const u = $('#undoBtn'), r = $('#redoBtn');
  if (u) u.disabled = undo.at <= 0 && !undo.timer;
  if (r) r.disabled = undo.at >= undo.stack.length - 1;
}

// ---------------------------------------------------------------------------
// Data binding: <input data-p="scenes.0.name" data-t="num|bool|list|str">
// ---------------------------------------------------------------------------
function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
function setPath(obj, path, v) {
  const keys = path.split('.');
  const last = keys.pop();
  const o = keys.reduce((o, k) => o[k], obj);
  if (v === undefined) delete o[last]; else o[last] = v;
}
function readInput(el) {
  const t = el.dataset.t;
  if (t === 'bool') return el.checked;
  if (t === 'bool-sel') return el.value === '1';
  if (t === 'num') return el.value === '' ? undefined : +el.value;
  if (t === 'sec') return el.value === '' ? 0 : Math.round(+el.value * 1000);
  if (t === 'list') return el.value.split(',').map((s) => s.trim()).filter(Boolean);
  return el.value;
}
// The token naming a trigger in a reference that starts at toks[i] (fire / cancel / repeat
// trigger X, stop repeat X, repeat X <n> times), or null.
function trigRefAt(toks, i) {
  const w = (k) => (toks[k] ? toks[k].v.toLowerCase() : '');
  if ((['fire', 'cancel', 'repeat'].includes(w(i)) && w(i + 1) === 'trigger') || (w(i) === 'stop' && w(i + 1) === 'repeat')) return toks[i + 2] || null;
  if (w(i) === 'repeat' && toks[i + 1] && w(i + 1) !== 'trigger' && w(i + 3) === 'times') return toks[i + 1];
  return null;
}
// Renaming a trigger: references by the old name follow (like numbers do on renumbering).
function renameTriggerRefs(oldName, newName) {
  if (!oldName || !newName || oldName.toLowerCase() === newName.toLowerCase()) return 0;
  let n = 0;
  for (const t of P().triggers)
    t.actions = (t.actions || []).map((line) => {
      const toks = tokenize(line);
      let out = line;
      for (let i = toks.length - 2; i >= 0; i--) {  // right to left keeps earlier positions valid
        const r = trigRefAt(toks, i);
        if (r && r.v.toLowerCase() === oldName.toLowerCase()) {
          out = out.slice(0, r.start) + quote(newName) + out.slice(r.end);
          n++;
        }
      }
      return out;
    });
  for (const c of timelineTrigCues())
    if (String(c.trigger).toLowerCase() === oldName.toLowerCase()) { c.trigger = newName; n++; }
  for (const t of P().triggers)
    if (t.type === 'sequence') t.steps = (t.steps || []).map((s) => (String(s).toLowerCase() === oldName.toLowerCase() ? (n++, newName) : s));
  return n;
}
const timelineTrigCues = (p = P()) => p.timelines.flatMap((tl) => tl.cues.filter((c) => c.trigger != null));
function onBound(e) {
  const el = e.target;
  if (!el.dataset.p) return;
  const rename = /^triggers\.(\d+)\.name$/.exec(el.dataset.p);
  const oldName = rename && P().triggers[+rename[1]];
  // The name updates live while typing, so the name before editing is kept on the field.
  const orig = rename ? (el.dataset.orig ?? oldName?.name) : null;
  const before = oldName && oldName.type !== 'comment' && orig &&
    !P().triggers.some((x) => x !== oldName && x.type !== 'comment' && (x.name || '').toLowerCase() === orig.toLowerCase()) ? orig : null;
  // Renaming a device keeps it in its device groups.
  const devRename = /^devices\.(\d+)\.name$/.exec(el.dataset.p);
  const devOld = devRename && P().devices[+devRename[1]]?.name;
  setPath(P(), el.dataset.p, readInput(el));
  if (devOld && devOld !== el.value)
    P().deviceGroups.forEach((g) => (g.devices = g.devices.map((n) => (n === devOld ? el.value : n))));
  if (before && e.type === 'change') {
    const t = P().triggers[+rename[1]];
    if (!dupName(t)) { const n = renameTriggerRefs(before, t.name); if (n) toast(`Updated ${n} reference${n > 1 ? 's' : ''} to the new name`); }
  }
  markDirty();
  if (el.dataset.r !== undefined && e.type === 'change') render();
  if (el.dataset.live !== undefined) livePreview(el);
}

// ---------------------------------------------------------------------------
// Helpers for addressing
// ---------------------------------------------------------------------------
const nextId = (list) => list.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
// Fixture by id, through an index that is rebuilt when the fixture list changes (added,
// deleted or reordered), so loops over hundreds of fixtures don't search the list each time.
let fxIndex = { list: null, len: -1, first: null, map: new Map() };
function fixture(id) {
  const list = P().fixtures;
  if (fxIndex.list !== list || fxIndex.len !== list.length || fxIndex.first !== list[0]) fxIndex = { list, len: list.length, first: list[0], map: new Map(list.map((f) => [f.id, f])) };
  const f = fxIndex.map.get(id);
  return f && f.id === id ? f : list.find((x) => x.id === id);   // a changed id: fall back to searching
}
// Channels, footprint and the dimmer/colour channels of a fixture: shared with the mock (model.js).
const { slots, footprint, channelRoles } = KDModel;
function absChannel(level) {
  if (level.fixture != null) {
    const f = fixture(level.fixture);
    if (!f) return null;
    const ss = slots(f);
    const s = typeof level.ch === 'number' ? ss[level.ch - 1] : ss.find((x) => x.name === level.ch);
    if (!s) return null;
    return { u: f.universe, ch: f.address + s.offset, wide: s.wide };
  }
  return { u: level.u, ch: level.ch, wide: !!level.wide };
}
function conflicts() {
  const bad = new Set();
  const used = {};
  for (const f of P().fixtures) {
    const n = footprint(f);
    for (let i = 0; i < n; i++) {
      const k = f.universe + '.' + (f.address + i);
      if (used[k] && used[k] !== f.id) { bad.add(f.id); bad.add(used[k]); }
      used[k] = f.id;
    }
    if (f.address < 1 || f.address + n - 1 > 512) bad.add(f.id);
  }
  return bad;
}
let previewTimer = null;
const previewPending = new Map();   // "u.ch" -> set command, newest value wins
function livePreview(el) {
  const level = getPath(P(), el.dataset.p.replace(/\.v$/, ''));
  if (level) previewLevels([level]);
}
// Live preview (scene editing): send levels as channel overrides, at most every 40 ms.
function previewLevels(levels) {
  if (!S.preview) return;
  for (const l of levels) {
    const a = absChannel(l), v = l.v | 0;
    if (!a) continue;
    if (a.wide) { previewPending.set(`${a.u}.${a.ch}`, `set ${a.u}.${a.ch} ${v >> 8}`); previewPending.set(`${a.u}.${a.ch + 1}`, `set ${a.u}.${a.ch + 1} ${v & 255}`); }
    else previewPending.set(`${a.u}.${a.ch}`, `set ${a.u}.${a.ch} ${v}`);
  }
  if (!previewPending.size || previewTimer) return;
  previewTimer = setTimeout(() => {
    previewTimer = null;
    const lines = [...previewPending.values()];
    previewPending.clear();
    cmd(lines.join('\n'));
  }, 40);
}
// Why the controller last started (status "started"); watchdog / crash = the firmware had hung and restarted itself.
const startedText = (why) => (!why ? '—' : /^(watchdog|crash)$/.test(why)
  ? `<span class="bad" title="The firmware stopped responding and restarted itself. Check the log from before the restart.">${esc(why)} restart</span>` : esc(why));
const fmtTime = (ms) => {
  ms = Math.max(0, ms | 0);
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;
};
const opts = (list, sel, label = (o) => `${o.id} · ${o.name || ''}`) =>
  list.map((o) => `<option value="${o.id}"${o.id === sel ? ' selected' : ''}>${esc(label(o))}</option>`).join('');
// True while the user is typing in a field (page keys leave it alone).
const editingText = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

// ---------------------------------------------------------------------------
// Colours: "#rrggbb" <-> r, g, b (0-255) <-> hue (0-360), saturation, value (0-1)
// ---------------------------------------------------------------------------
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt((h || '#000000').slice(i, i + 2), 16) || 0);
const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
}
const hsvToHex = (h, s, v) => { const [r, g, b] = KDFX.hsv(h / 360, s, v); return rgbToHex(r * 255, g * 255, b * 255); };

// ---------------------------------------------------------------------------
// Header / status
// ---------------------------------------------------------------------------
function updateHeader() {
  const p = P();
  const n = $('#projName');
  n.textContent = p ? p.name : '';
  n.classList.toggle('dirty', S.dirty);
  const st = S.status;
  const chips = [];
  if (st) {
    chips.push(`<span class="chip ${st.usb ? 'ok' : 'bad'}">USB ${st.usb ? 'mounted' : 'missing'}</span>`);
    chips.push(`<span class="chip">${esc(st.ip)}</span>`);
    chips.push(`<span class="chip">engine ${st.stats.engineFps} fps</span>`);
    chips.push(`<span class="chip">DMX ${st.stats.dmxFps} fps</span>`);
    chips.push(`<span class="chip">Art-Net ${st.stats.artTx}/s · sACN ${st.stats.sacnTx}/s</span>`);
    for (const [k, n] of PROTOCOLS) if (st.outputs && !st.outputs[k]) chips.push(`<span class="chip bad">${n} off</span>`);
    const pjOff = (st.projectors || []).filter((x) => x.seen && !x.online).length;
    if (pjOff) chips.push(`<span class="chip bad">${pjOff} projector${pjOff > 1 ? 's' : ''} offline</span>`);
    if (st.safeMode) chips.unshift('<span class="chip bad" title="The controller restarted after a crash several times in a row, so triggers only run when you fire them by hand (no Startup). Fix the project and save it, or restart the controller.">SAFE MODE</span>');
    const paused = st.paused?.length || 0;
    if (paused) chips.push(`<span class="chip bad" title="Fired over 100 times in a second (a feedback loop?) and paused for 10 s: ${esc(st.paused.map((x) => '#' + x.trigger).join(', '))}">${paused} trigger${paused > 1 ? 's' : ''} paused</span>`);
    if (st.stats.heap?.size && st.stats.heap.free < 32768) chips.push(`<span class="chip bad">low memory: ${kb(st.stats.heap.free)} free</span>`);
    if (Date.now() - S.statusAt > 4000) chips.unshift('<span class="chip bad">offline</span>');
    if (document.activeElement !== $('#gm')) { $('#gm').value = st.gm; $('#gmVal').textContent = st.gm + '%'; }
    $('#bo').classList.toggle('active-bo', !!st.blackout);
  }
  $('#chips').innerHTML = chips.join('');
  $('#logBadge').textContent = S.logUnseen ? (S.logUnseen > 99 ? '99+' : S.logUnseen) : '';
}
function onStatus(st) {
  S.status = st;
  S.statusAt = Date.now();
  if (st.time < 1600000000) {
    api('/api/time', { method: 'POST', body: String(Math.floor(Date.now() / 1000)) }).catch(() => {});
  }
  updateHeader();
  if (S.view === 'dashboard') renderPlaybacks();
  if (S.view === 'devices') renderProjectorStates();
  if (S.view === 'monitor') renderMonitor();
  if (S.view === 'variables') renderVarValues();
  if (S.view === 'triggers') updateTrigRunning();
  const off = monSummary(st).offline;
  $('#monBadge').textContent = off || '';
}

// ---------------------------------------------------------------------------
// Live events (SSE)
// ---------------------------------------------------------------------------
function connectEvents() {
  const es = new EventSource('/api/events' + (S.logSeq ? '?since=' + S.logSeq : ''));
  es.addEventListener('log', (e) => addLog(JSON.parse(e.data)));
  es.addEventListener('gap', (e) => addLog({ gap: +e.data }));
  es.addEventListener('status', (e) => onStatus(JSON.parse(e.data)));
  es.onerror = () => { es.close(); setTimeout(connectEvents, 2000); };
}
function addLog(m) {
  if (m.s && m.s <= S.logSeq) return;  // duplicate after a reconnect
  if (m.s) S.logSeq = m.s;
  S.log.push(m);
  if (S.log.length > 5000) S.log.splice(0, 1000);
  if (m.l >= 2 && S.view !== 'log') { S.logUnseen++; updateHeader(); }
  if (S.view === 'log' && !S.logPaused && logVisible(m)) appendLogRow(m);
  if (S.view === 'dashboard' && m.l >= 2) renderRecent();
  if (m.c === 'TRIG') onTrigLog(m);   // flow view on the Triggers page
}
function logVisible(m) {
  if (m.gap) return true;
  const f = S.logFilter;
  if (m.l < f.min || !f.cats.has(m.c)) return false;
  return !f.text || m.m.toLowerCase().includes(f.text.toLowerCase()) || m.c.toLowerCase().includes(f.text.toLowerCase());
}
function logTime(m) {
  if (m.e > 1600000000) {
    const d = new Date(m.e * 1000);
    return d.toTimeString().slice(0, 8) + '.' + String(m.t % 1000).padStart(3, '0');
  }
  return '+' + (m.t / 1000).toFixed(3);
}
function logRowHtml(m) {
  if (m.gap) return `<div class="gap">… ${m.gap} entries dropped (browser fell behind)</div>`;
  let msg = esc(m.m);
  const q = S.logFilter.text;
  if (q) msg = msg.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[&<>"']/g, (c) => esc(c)), 'gi'), (x) => `<mark>${x}</mark>`);
  return `<div class="l L${m.l}"><span class="t">${logTime(m)}</span><span class="v">${LOG_LVLS[m.l]}</span><span class="c">${m.c}</span><span class="m">${msg}</span></div>`;
}
function appendLogRow(m) {
  const box = $('#logBox');
  if (!box) return;
  const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
  box.insertAdjacentHTML('beforeend', logRowHtml(m));
  while (box.childElementCount > 3000) box.firstElementChild.remove();
  if (stick) box.scrollTop = box.scrollHeight;
  $('#logCount').textContent = box.childElementCount + ' shown';
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
// A page is views.name() (its HTML), plus optional views.name.after() (wire it up once it
// is in the DOM) and views.name.keys(e) (its keyboard shortcuts while not typing).
const views = {};
let acs = [];
// Animations and polls of the current page, by name: render() stops them all.
const pageLoops = new Map();   // name -> stop()
function stopPageLoop(name) { pageLoops.get(name)?.(); pageLoops.delete(name); }
// frame() runs on every animation frame (restarts if the name is already running).
function pageAnimation(name, frame) {
  stopPageLoop(name);
  let id;
  const run = () => { frame(); id = requestAnimationFrame(run); };
  pageLoops.set(name, () => cancelAnimationFrame(id));
  run();
}
// fn() runs now and then every ms.
function pagePoll(name, fn, ms) {
  stopPageLoop(name);
  const id = setInterval(fn, ms);
  pageLoops.set(name, () => clearInterval(id));
  fn();
}
function render() {
  acs.forEach((a) => a.destroy());
  acs = [];
  [...pageLoops.keys()].forEach(stopPageLoop);
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === S.view));
  const main = $('#main');
  const scroll = main.scrollTop;
  main.innerHTML = views[S.view]();
  // Splitters first: adding one changes the layout, and the browser's scroll anchoring then moved
  // the page (it jumped up after every colour pick in Scenes).
  $$('.split', main).forEach((el, i) => addSplitter(el, `kd.split.${S.view}.${i}`));
  main.scrollTop = scroll;
  const capped = main.scrollTop;
  $$('input.cmd', main).forEach((el) => acs.push(attachAC(el, { onEnter: el.id === 'consoleIn' ? runConsole : null })));
  $$('input.cond', main).forEach((el) => acs.push(attachAC(el, { grammar: COND_GRAMMAR })));
  views[S.view].after?.();
  // Again if after() added height the first restore was capped by; not when after() scrolled on
  // purpose (revealing an item).
  if (capped !== scroll && main.scrollTop === capped) main.scrollTop = scroll;
}

// ---------------------------------------------------------------------------
// Resizable panes: drag a divider, double-click to reset. Widths are stored
// per page in localStorage (a per-browser preference, not part of the show).
// ---------------------------------------------------------------------------
function loadWidth(key) {
  try { return +localStorage.getItem(key) || 0; } catch { return 0; }
}
function saveWidth(key, w) {
  try { w ? localStorage.setItem(key, String(Math.round(w))) : localStorage.removeItem(key); } catch { /* private mode */ }
}
// Wires a divider; apply(width|0) sets the size, 0 = default.
function dragResize(handle, { key, min, max, startWidth, apply }) {
  apply(loadWidth(key));
  handle.title = 'Drag to resize · double-click to reset';
  handle.addEventListener('dblclick', () => { saveWidth(key, 0); apply(0); });
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const z = uiZoom(), x0 = e.clientX, w0 = startWidth() / z;
    let w = w0;
    handle.classList.add('drag');
    document.body.classList.add('resizing');
    const move = (ev) => { w = Math.max(min, Math.min(max(), w0 + (ev.clientX - x0) / z)); apply(w); };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.classList.remove('drag');
      document.body.classList.remove('resizing');
      if (w !== w0) saveWidth(key, w);
      acs.forEach((a) => a.hide());
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up, { once: true });
    handle.addEventListener('pointercancel', up, { once: true });
  });
}
function addSplitter(split, key) {
  const left = split.firstElementChild;
  if (!left || split.querySelector(':scope > .splitter')) return;
  const h = document.createElement('div');
  h.className = 'splitter';
  left.after(h);
  dragResize(h, {
    key, min: 140,
    max: () => split.clientWidth * 0.7,
    startWidth: () => left.getBoundingClientRect().width,
    apply: (w) => (w ? split.style.setProperty('--left', w + 'px') : split.style.removeProperty('--left')),
  });
}
function addNavSplitter() {
  const nav = $('#nav');
  const h = document.createElement('div');
  h.className = 'splitter';
  nav.appendChild(h);
  dragResize(h, {
    key: 'kd.nav', min: 110, max: () => 320,
    startWidth: () => nav.getBoundingClientRect().width,
    apply: (w) => (w ? document.body.style.setProperty('--nav-w', w + 'px') : document.body.style.removeProperty('--nav-w')),
  });
}

// ---------------------------------------------------------------------------
// Display: colour theme and size, per browser (localStorage), like the pane widths.
// The size is CSS zoom on <html>, so everything scales, layout included. Mouse
// positions (clientX) and getBoundingClientRect() stay in screen pixels: code that
// turns them into CSS pixels (style.left, widths) divides by uiZoom().
// ---------------------------------------------------------------------------
const THEMES = [
  ['dark', 'Dark', 'the classic'], ['midnight', 'Midnight', 'deep blue, cyan accent'], ['graphite', 'Graphite', 'neutral grey, soft contrast'],
  ['light', 'Light', 'for bright rooms and daylight'], ['contrast', 'High contrast', 'black and white, big edges'], ['stage', 'Stage red', 'dim red, keeps your night vision backstage'],
];
const uiPref = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
function setUiPref(k, v) {
  try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, String(v)); } catch { /* private mode */ }
  applyUi();
}
let uiZoomNow = 1;
const uiZoom = () => uiZoomNow;
// Auto size: as big as the window allows while a 1600 x 900 working area still fits
// (1920 x 1080 -> 120 %, a 1366 x 768 laptop -> 85 %).
const autoScale = () => Math.max(0.85, Math.min(1.75, Math.round(Math.min(innerWidth / 1600, innerHeight / 900) * 20) / 20));
const uiScalePref = () => uiPref('kd.scale', 'auto');
function applyUi() {
  const html = document.documentElement, s = uiScalePref();
  uiZoomNow = s === 'auto' ? autoScale() : Math.max(0.5, Math.min(2.5, +s || 1));
  html.style.zoom = uiZoomNow === 1 ? '' : uiZoomNow;
  html.style.setProperty('--zoom', uiZoomNow);   // style.css: --vh = a real 1 % of the window height
  const th = uiPref('kd.theme', 'dark');
  html.dataset.theme = THEMES.some(([k]) => k === th) ? th : 'dark';
  // The compact (phone) layout follows the width the page really has after zooming;
  // a media query would only see the window.
  document.body.classList.toggle('narrow', innerWidth / uiZoomNow < 760);
}
applyUi();
window.addEventListener('resize', applyUi);
// The page area's height (window minus the top bar, which wraps on small screens), for lists
// that should end at the bottom of the window (style.css --main-h).
new ResizeObserver(() => document.documentElement.style.setProperty('--main-h', $('#main').clientHeight + 'px')).observe($('#main'));
