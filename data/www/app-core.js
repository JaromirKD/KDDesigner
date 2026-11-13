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
// Icons per kind of device (24 x 24 line drawings in currentColor, like the fixture icons):
// key -> [name, svg, Devices tab]. Used on the Devices / Monitoring tabs and in the trigger list.
const DEVICE_ICONS = {
  network: ['Network device (UDP / OSC)', '<rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 16.5h.01M10.5 16.5h.01"/><path d="M8.5 9.5a5 5 0 0 1 7 0M5.8 6.8a9 9 0 0 1 12.4 0"/>', 'network'],
  tcp: ['TCP device', '<path d="M4 8h15M15.5 4.5 19 8l-3.5 3.5M20 16H5M8.5 12.5 5 16l3.5 3.5"/>', 'tcp'],
  modbus: ['Modbus device (PLC)', '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h2M14 11h2M8 15h2M14 15h2"/>', 'tcp'],
  http: ['HTTP request', '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>', ''],
  pc: ['PC', '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>', 'pcs'],
  projector: ['Projector (PJLink)', '<rect x="2.5" y="7" width="19" height="10" rx="2"/><circle cx="15.5" cy="12" r="2.5"/><path d="M5.5 10h4M6 17v2M18 17v2"/>', 'projectors'],
  email: ['Email', '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5 12 13l8.5-6.5"/>', 'email'],
  io: ['Machine Control I/O', '<rect x="3" y="7" width="18" height="11" rx="1.5"/><circle cx="7.5" cy="12.5" r="1.5"/><circle cx="12" cy="12.5" r="1.5"/><circle cx="16.5" cy="12.5" r="1.5"/><path d="M7.5 3.5V7M12 3.5V7M16.5 3.5V7"/>', 'board'],
  // Show devices: simplified versions of the makers' logos, in their own colours.
  kissbox: ['Kiss-Box', '<rect x="2" y="2" width="20" height="20" rx="1.5" fill="#e30613" stroke="none"/><text x="8.8" y="17.6" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="15" fill="#fff" stroke="none">K</text><rect x="15.4" y="12.4" width="5" height="5.2" fill="#fff" stroke="none"/>', 'kissbox'],
  knx: ['KNX', '<g stroke-width="2.2" stroke-linecap="butt" stroke-linejoin="miter"><path d="M2.5 8.5Q7 3 12 3" stroke="#2bae4a"/><path d="M12 3Q17 3 21.5 8.5" stroke="#1b75bc"/>'
    + '<path d="M3.2 12v8M7.6 12 4 16l3.6 4" stroke="#2bae4a"/><path d="M9.6 20v-8l4.6 8v-8" stroke="#8c9399"/><path d="M16.2 12l5 8M21.2 12l-5 8" stroke="#1b75bc"/></g>', 'knx'],
  brightsign: ['BrightSign player', '<rect x="2" y="2" width="20" height="20" rx="1.5" fill="#3c2f8f" stroke="none"/><text x="12.3" y="17.6" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="15.5" fill="#fff" stroke="none">B</text>', 'brightsign'],
  digidot: ['DiGidot pixel controller', `<g fill="#1e8fd8" stroke="none">${[[6, 4], [10, 4], [14, 4], [6, 8], [18, 8], [6, 12], [10, 12], [14, 12], [18, 12], [6, 16], [10, 16], [14, 16], [18, 16], [6, 20], [10, 20], [14, 20]]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.65"/>`).join('')}</g>`, 'digidot'],
  netio: ['NETIO power sockets', '<path fill="#00794c" stroke="none" fill-rule="evenodd" d="M2 3.5A1.5 1.5 0 0 1 3.5 2h17A1.5 1.5 0 0 1 22 3.5v17a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 20.5zM6.5 19V6.5h7.6a4.4 4.4 0 0 1 4.4 4.4V19h-3.3v-7.6a1.7 1.7 0 0 0-1.7-1.7H9.8V19z"/>', 'netio'],
  pharos: ['Pharos controller', `<g fill="#0080ff" stroke="none"><circle cx="12.13" cy="12.37" r="2.25"/>${[
    [15.34, 9.65, 1.5], [16.08, 13.12, 1.5], [13.86, 15.84, 1.5], [10.39, 15.84, 1.5], [8.17, 13.12, 1.5], [8.91, 9.65, 1.5], [12.13, 8.17, 1.5],
    [12.13, 5.2, 1.25], [17.82, 7.67, 1.25], [18.81, 14.35, 1.25], [15.1, 18.56, 1.25], [8.91, 18.56, 1.25], [5.2, 13.86, 1.25], [6.43, 7.92, 1.25],
    [12.13, 2.72, 1], [19.8, 6.19, 1], [21.28, 15.34, 1], [16.08, 20.79, 1], [7.67, 20.79, 1], [2.72, 14.35, 1], [4.45, 6.43, 1],
  ].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>`, 'pharos'],
  // A finger tapping (shape after the Lucide "pointer" icon).
  panel: ['Touch panel', '<path d="M22 14a8 8 0 0 1-8 8M18 11v-1a2 2 0 0 0-4 0M14 10V9a2 2 0 0 0-4 0v1M10 9.5V4a2 2 0 0 0-4 0v10"/><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>', ''],
  trigger: ['Another trigger (fire / repeat trigger)', '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>', ''],
  timeline: ['Timeline', '<path d="M2 12h20"/><path d="M8 8.5 11.5 12 8 15.5 4.5 12zM16 9.5l2.5 2.5-2.5 2.5-2.5-2.5z"/>', ''],
  dmx: ['DMX input', '<circle cx="12" cy="12" r="8.5"/><path d="M8 10.5h.01M16 10.5h.01M12 8h.01M9.5 15h.01M14.5 15h.01"/>', ''],
  device: ['Device', '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 15h.01M12 15h.01"/>', ''],
  calendar: ['Calendar period', '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M7.5 14h.01M12 14h.01M16.5 14h.01M7.5 17.5h.01M12 17.5h.01"/>', ''],
};
const devIcon = (key, cls = 'dev-ico') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(DEVICE_ICONS[key] || DEVICE_ICONS.device)[1]}</svg>`;
// Which kind of device a name is (monitored devices, TCP / Modbus, show devices), or ''.
function deviceKind(name) {
  const p = S.project, n = String(name || '').toLowerCase();
  if (!p || !n) return '';
  const has = (list) => (list || []).some((x) => (x.name || '').toLowerCase() === n);
  if (has(p.projectors)) return 'projector';
  if (has(p.pcs)) return 'pc';
  if (has(p.devices) || has((p.deviceGroups || []).filter((g) => !g.kind))) return 'network';
  if (has(p.tcp)) return 'tcp';
  if (has(p.modbus)) return 'modbus';
  return (p.drivers || []).find((d) => (d.name || '').toLowerCase() === n)?.type || '';
}
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
  ['input', 'Input (pin / Machine Control)'], ['timeline', 'Timeline (start / end / release / pause)'], ['mode', 'Mode change'], ['panel', 'Panel button'],
  ['dmx_change', 'DMX channel change'], ['device', 'Device online/offline'], ['projector', 'Projector alarm (errors, lamp hours)'], ['variable', 'Variable change'],
  ['tcp', 'TCP message received'], ['http', 'HTTP response'], ['dmx_in', 'DMX input (Art-Net / sACN in)'], ['calendar', 'Calendar change (a period starts / ends)'],
  ['media_end', 'BrightSign: media file ended'],
  ['manual', 'Manual / nested list'], ['comment', '— Separator —'],
];
// Variables each trigger type provides to its actions as {name}.
const TRIGGER_VARS = {
  udp: ['message', '1 (text after a prefix*)', 'sender_ip', 'sender_port'],
  osc: ['address', '1 … n (arguments)', 'sender_ip', 'sender_port'],
  mode: ['group', 'mode', 'old (the state before)'], panel: ['control', 'event', 'value (slider, dial, toggle 1/0, wheel #rrggbb, XY pad x,y)', 'r', 'g', 'b (colour wheel, 0-255)', 'x', 'y (XY pad)'], device: ['device', 'kind', 'state'],
  projector: ['projector', 'alarm', 'state', 'lamp (hours)', 'hours (the limit)'],
  variable: ['variable', 'value', 'old'], tcp: ['device', 'message', '1 (text after a prefix*)'], http: ['url', 'method', 'status', 'body'],
  dmx_change: ['channel', 'index', 'value', '+ your table names'], input: ['input', 'value'], dmx_in: ['channel', 'index', 'value', 'old'],
  calendar: ['calendar', 'state (active / inactive)'], media_end: ['device', 'zone', 'file', 'state (its name in BrightAuthor)', '1 (text after a prefix*)'],
  timeline: ['timeline (its number)', 'event (start, end, release, pause, resume)', 'reason (start / restart; stop / group / release all / end)'],
};
// What a timeline trigger (`on`) reacts to; none = release. = kTlOn in Triggers.cpp.
const TIMELINE_ON = [['release', 'is released (stop, its group, release all, at its end)'], ['end', 'reaches its end (not looping)'], ['start', 'starts (or restarts)'], ['pause', 'is paused'], ['resume', 'is resumed']];
const tlOn = (t) => (t.type === 'timeline_end' ? 'end' : t.on || 'release');
const TRIGGER_COLORS = {
  '': 'none', red: '#ff5c5c', orange: '#ff9f43', amber: '#ffb020', yellow: '#ffd23f', lime: '#a3e635', green: '#3ecf8e',
  teal: '#2dd4bf', cyan: '#3ad1e0', blue: '#4aa3ff', indigo: '#818cf8', purple: '#b07cff', magenta: '#e879f9',
  pink: '#f472b6', brown: '#b0855a', grey: '#9ca3af', white: '#f3f4f6',
};
// Named colour or a custom "#rrggbb".
const trigColor = (c) => (c ? TRIGGER_COLORS[c] || (/^#[0-9a-f]{6}$/i.test(c) ? c : '') : '');
// Tab names of the trigger colours. The first main-section separator in a colour is that tab's
// header: the tab shows its name (without the leading "== ") and renaming the tab renames it.
// Colours without one use a typed name (project.triggerColorNames, UI only:
// { red: 'Projectors', '#12ab34': 'Audio', none: 'Misc' }; no colour is stored as "none").
const trigColorHead = (c) => P().triggers.find((x) => x.type === 'comment' && x.level !== 2 && (trigColor(x.color) ? x.color : '') === (c || ''));
const sepTitle = (name) => String(name || '').replace(/^[\s=#*\-–—_]+/, '').trim();
function trigColorName(c) {
  const h = trigColorHead(c);
  return (h && sepTitle(h.name)) || (P().triggerColorNames || {})[c || 'none'] || '';
}
const trigColorLabel = (c) => trigColorName(c) || (!c ? 'no colour' : TRIGGER_COLORS[c] ? c : 'custom colour');
function setTrigColorName(c, name) {
  const p = P(), k = c || 'none';
  name = String(name || '').trim();
  if (name === trigColorName(c)) return;
  const h = trigColorHead(c);
  if (h && name) {   // keep the header's own prefix ("== ")
    h.name = (h.name.match(/^[\s=#*\-–—_]+/) || [''])[0] + name;
    markDirty();
    return;
  }
  p.triggerColorNames = p.triggerColorNames || {};
  if (name) p.triggerColorNames[k] = name; else delete p.triggerColorNames[k];
  if (!Object.keys(p.triggerColorNames).length) delete p.triggerColorNames;
  markDirty();
}
const CURVES = [['linear', 'Linear'], ['square', 'Square law'], ['nondim', 'Non-dim (switch)'], ['preheat5', '5% preheat'], ['preheat10', '10% preheat']];
const PATHS = [['linear', 'Linear'], ['accelerated', 'Accelerated'], ['braked', 'Braked'], ['damped', 'Damped (S-curve)'], ['overshoot', 'Overshoot']];
const TL_GROUPS = ['', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
const PANEL_TYPES = ['button', 'toggle', 'slider', 'dial', 'color', 'xy', 'label', 'clock', 'spacer', 'group'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// Dates in the UI are European: DD-MM-YYYY, weeks start on Monday (stored dates: KDModel.dateStore).
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad2 = (n) => String(n).padStart(2, '0');
const euDate = (d) => `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
const euDateTime = (d) => `${euDate(d)} ${d.toTimeString().slice(0, 8)}`;
// "YYYY-MM-DD HH:MM:SS" (the controller's clock text) -> "DD-MM-YYYY HH:MM:SS"
const euStamp = (s) => String(s || '').replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3-$2-$1');
// Stored "12-24" / "2026-12-24" -> "24 December" / "24 December 2026"
function dateWords(s) {
  const a = String(s).split('-').map(Number), [y, m, d] = a.length === 3 ? a : [0, ...a];
  return `${d} ${MONTHS[m - 1] || '?'}${y ? ' ' + y : ''}`;
}
const PLACEHOLDER = {
  '{mode}': '<mode>', '{mgroup}': '<mode group>', '{mstate}': '<state>', '{mstep}': 'next|previous|toggle|back', '{dur}': '<time: 90, 30s, 10m, 2h>','{label}': '<label>', '{pctl}': '<panel control>', '{flash}': 'on|off|<colour>', '{pval}': '<value | #rrggbb | x,y>', '{color}': '<colour>', '{trig}': '<trigger name or #>', '{count}': '<count>',
  '{email}': '<to address>', '{device}': '<device>', '{oscaddr}': '</osc/address>', '{hhmm}': '<HH:MM>', '{days}': '<mon,tue,…>',
  '{tl}': '<timeline>', '{sc}': '<scene>', '{sec}': '<seconds>', '{pct}': '<0-100>', '{dmx}': '<0-255>',
  '{chan}': '<universe>.<ch>[-<ch>]', '{fixlist}': '<fixture numbers, e.g. 3,5,8-12>', '{ip}': '<ip address>', '{port}': '<port>', '{text...}': '<text>',
  '{onoff}': 'on|off', '{logcat}': '<category>', '{loglvl}': '<level>',
  '{proto}': 'dmx|artnet|sacn', '{pj}': '<projector|all>', '{pjinput}': '<input code>',
  '{pc}': '<pc|all>', '{pcaction}': 'wake|startup|shutdown|reboot', '{devname}': '<device>', '{updown}': 'online|offline',
  '{var}': '<variable>', '{num}': '<number>', '{op}': '= != > < >= <=', '{tcpdev}': '<tcp device>', '{httpmethod}': 'get|post|put|delete',
  '{url}': '<http://…>', '{mbdev}': '<modbus device>', '{mbtable}': 'coil|holding', '{calname}': '<calendar>', '{activity}': 'active|inactive',
  '{date}': '<DD-MM|DD-MM-YYYY>', '{cond...}': '<condition>', '{command...}': '<command>',
  '{kiss}': '<kiss-box>', '{knx}': '<knx interface>', '{bsign}': '<brightsign>', '{digi}': '<digidot>', '{netio}': '<netio>', '{pharos}': '<pharos>',
  '{kisspoint}': '<slot>.<channel>', '{kissval}': 'on|off|0-255', '{slot}': '<slot 1-8>', '{knxga}': '<group address or name>', '{knxval}': '<value>',
  '{dpt}': '<dpt, e.g. 1 / 5.001 / 9>', '{path}': '<path>', '{digiscene}': '<scene name or #>', '{digilist}': '<playlist name or #>', '{digitrig}': '<trigger name or #>', '{netioout}': '<output|all>',
  '{netioact}': 'on|off|toggle|restart|pulse', '{pharostl}': 'start|release|toggle|pause|resume', '{pharossc}': 'start|release|toggle',
  '{fixgrp}': 'fixture|group', '{pharosproto}': '<protocol>', '{word}': '<name>', '{bszone}': '<zone>', '{bsvar}': '<user variable>', '{bsfile}': '<file|state>', '{bsstate}': '<state>',
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
    name: 'New show', settings: { dateOrder: 'dmy', tzOffsetMin: 60, udpPort: 4000, sacnPriority: 100, outputs: { dmx: true, artnet: true, sacn: true } },
    network: { dhcp: true, ip: '172.16.1.111', mask: '255.255.255.0', gateway: '172.16.1.1', dns: '', dns2: '' },
    universes: [{ id: 1, name: 'Universe 1', dmxPort: 1, artnet: 0, sacn: 1, useDmx: true, useArtnet: true, useSacn: true }],
    fixtures: [], groups: [], scenes: [], timelines: [], triggers: [], projectors: [], pcs: [], devices: [], modes: [],
    panel: { pages: [] }, email: { server: '', port: 25, user: '', password: '', from: '' },
  };
}
function normalize(p) {
  const e = emptyProject();
  for (const k of ['universes', 'fixtures', 'groups', 'scenes', 'timelines', 'triggers', 'projectors', 'pcs', 'devices', 'modes',
    'variables', 'tcp', 'modbus', 'calendar', 'maps', 'effects', 'deviceGroups', 'fixtureTypes', 'drivers', 'colorThemes', 'variableGroups']) p[k] = p[k] || [];
  // A variable's group that is not in the list (typed by hand, an older project) gets its tab.
  for (const v of p.variables) if (v.group && !p.variableGroups.some((g) => g.name === v.group)) p.variableGroups.push({ name: v.group });
  p.deviceGroups.forEach((g) => (g.devices = g.devices || []));
  p.drivers.forEach(normDriver);   // app-drivers.js
  // "Round effects" moved from the map (`square`) to each effect (`round`, Nov 2026): every
  // effect without the setting gets what the maps said (KDModel.effectRound), then the map
  // setting goes, so the show looks the same.
  p.effects.forEach((x) => { if (x.round == null) x.round = KDModel.effectRound(p, x); });
  p.maps.forEach((m) => { m.items = m.items || []; m.aspect = m.aspect || 1.6; m.shapes = m.shapes || []; delete m.square; });
  p.panel = p.panel || { pages: [] };
  p.panel.pages = p.panel.pages || [];
  p.panel.pages.forEach((pg) => (pg.controls = pg.controls || []));
  p.panel.theme = p.panel.theme || {};   // panel-ui.js PANEL_THEME: only what differs from the default
  // Several panels (panelList in panel-ui.js): an old project's title / start page become its
  // first panel, and every page gets the panel it belongs to.
  if (!p.panel.panels?.length) {
    p.panel.panels = [{ id: 1, name: 'Panel', title: p.panel.title || '', start: p.panel.start }];
    delete p.panel.title;
    delete p.panel.start;
  }
  p.panel.pages.forEach((pg) => (pg.panel = p.panel.panels.some((x) => x.id === pg.panel) ? pg.panel : p.panel.panels[0].id));
  p.email = Object.assign(e.email, p.email);
  p.triggers.forEach((t) => (t.conditions = t.conditions || []));
  p.groups.forEach((g) => (g.fixtures = g.fixtures || []));
  // Old projects: "modes": ["EMERGENCY", ...] becomes one group "Mode" (same as the firmware).
  const legacy = p.modes.filter((m) => typeof m === 'string');
  // Per group also startup (state at power-up, "" = keep the last), var (linked variable) and
  // stateInfo: {<state>: {color, icon, enter: [actions], leave: [actions]}}.
  p.modes = p.modes.filter((m) => m && typeof m === 'object').map((g) => ({ ...g, name: g.name || 'Mode', states: g.states || [], stateInfo: g.stateInfo || {} }));
  if (legacy.length) p.modes.unshift({ name: 'Mode', states: legacy });
  // "date between" conditions were MM-DD; since Nov 2026 they're typed European (DD-MM), marked
  // by settings.dateOrder "dmy" so the firmware and mock read them the same way. Old projects
  // are rewritten once here (also inside "wait until", and in mode enter/leave actions).
  const oldOrder = p.settings?.dateOrder !== 'dmy';
  p.settings = Object.assign(e.settings, p.settings);
  if (oldOrder) {
    const fix = (s) => typeof s !== 'string' ? s : s.replace(/\bdate between ((?:\d{4}-)?\d{1,2}-\d{1,2}) ((?:\d{4}-)?\d{1,2}-\d{1,2})\b/gi,
      (all, a, b) => `date between ${KDModel.dateShow(a) || a} ${KDModel.dateShow(b) || b}`);
    p.triggers.forEach((t) => { t.conditions = t.conditions.map(fix); if (Array.isArray(t.actions)) t.actions = t.actions.map(fix); });
    p.modes.forEach((g) => Object.values(g.stateInfo || {}).forEach((si) => ['enter', 'leave'].forEach((k) => Array.isArray(si?.[k]) && (si[k] = si[k].map(fix)))));
    p.settings.dateOrder = 'dmy';
  }
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
  // "Timeline end" became a Timeline trigger that picks what it reacts to (Nov 2026).
  for (const t of p.triggers) if (t.type === 'timeline_end') { t.type = 'timeline'; t.on = 'end'; }
  // Sequence triggers were removed (Nov 2026): an old one becomes a sub separator with what it
  // did in its notes, so nothing is lost and nothing runs (the firmware skips separators).
  normalize.sequences = 0;
  p.triggers = p.triggers.map((t) => {
    if (t.type !== 'sequence') return t;
    normalize.sequences++;
    const notes = ['This was a Sequence trigger (removed from KD Designer). Kept as a note, it does nothing.',
      `Steps, in this order within ${t.within ?? 5} s: ${(t.steps || []).filter((s) => String(s).trim()).join(', ') || '(none)'}`,
      ...(t.conditions.length ? ['Conditions:', ...t.conditions.map((c) => '  ' + c)] : []),
      ...(t.actions.length ? ['Actions:', ...t.actions.map((a) => '  ' + a)] : []),
      ...(t.notes?.trim() ? ['', t.notes.trim()] : [])];
    return { id: t.id, type: 'comment', level: 2, name: `Sequence '${t.name || t.id}' (removed)`, ...(t.color ? { color: t.color } : {}), notes: notes.join('\n'), conditions: [], actions: [] };
  });
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
// ---------------------------------------------------------------------------
// Progress bar along the bottom of the header (saving and loading the project): frac 0..1,
// or null = "busy, no figure". kind 'err' = red, stays until closed (×) or the next use.
// Never blocks the page: the lights keep running and the editor stays usable.
// ---------------------------------------------------------------------------
function progress(label, frac = null, kind = '') {
  const el = $('#progress');
  if (!el) return;
  clearTimeout(progress.timer);
  el.className = 'progress' + (kind ? ' ' + kind : '') + (frac == null && kind !== 'err' ? ' indet' : '');
  el.querySelector('.pg-fill').style.width = frac == null ? '' : Math.round(Math.min(1, frac) * 100) + '%';
  el.querySelector('.pg-text').textContent = label;
  el.hidden = false;
}
function progressHide(afterMs = 0) {
  clearTimeout(progress.timer);
  const hide = () => { const el = $('#progress'); if (el && !el.classList.contains('err')) el.hidden = true; };
  if (afterMs) progress.timer = setTimeout(hide, afterMs); else hide();
}
document.addEventListener('click', (e) => { if (e.target.closest?.('#progress .pg-x')) $('#progress').hidden = true; });

// GET with a progress bar: real progress when the size is known (Content-Length of a plain
// reply; a gzipped one only counts what has come in). Same result and errors as api().
async function apiProgress(path, label) {
  const r = await fetch(path);
  const ct = r.headers.get('content-type') || '';
  const total = r.headers.get('content-encoding') ? 0 : +r.headers.get('content-length') || 0;
  let text;
  if (!r.body?.getReader) text = await r.text();
  else {
    const rd = r.body.getReader(), parts = [];
    let got = 0, shown = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      // Small files come in one go: no bar flashing up for them.
      if (got - shown > 65536) { shown = got; progress(`${label} ${total ? Math.round(got / total * 100) + ' %' : kb(got)}`, total ? got / total : null); }
    }
    text = new TextDecoder().decode(parts.length === 1 ? parts[0] : await new Blob(parts).arrayBuffer());
    if (shown) progressHide(300);
  }
  const body = ct.includes('json') ? JSON.parse(text) : text;
  if (!r.ok) throw new Error(body.reply || body || r.statusText);
  return body;
}

// PUT/POST through XMLHttpRequest: fetch() can't report upload progress. onUp(sent, total);
// onSent() once the whole body is out (the controller is then loading it).
function xhrSend(method, path, body, headers, onUp, onSent) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, path);
    for (const [k, v] of Object.entries(headers || {})) x.setRequestHeader(k, v);
    let sent = false;
    x.upload.onprogress = (e) => onUp?.(e.loaded, e.total || body.length);
    x.upload.onload = () => { sent = true; onSent?.(); };
    x.onload = () => {
      let b = x.responseText;
      try { b = JSON.parse(b); } catch { /* text */ }
      if (x.status >= 200 && x.status < 300) resolve(b);
      else reject(Object.assign(new Error((b && b.reply) || b || x.statusText || 'error ' + x.status), { stage: 'load' }));
    };
    x.onerror = () => reject(sent ? Object.assign(new Error('the connection was lost while the controller was loading it'), { stage: 'load' })
                                  : Object.assign(new Error('no connection to the controller'), { stage: 'send' }));
    x.ontimeout = () => reject(Object.assign(new Error('no answer'), { stage: 'load' }));
    x.timeout = 120000;
    x.send(body);
  });
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
  // A fixed address that can't work would make the controller unreachable after its reboot
  // (the firmware would fall back to DHCP, but better not to get there).
  const netBad = KDModel.netProblems(P().network);
  if (netBad.length) { toast(`Not saved - Settings > Network: ${netBad[0].text}`, true); return; }
  const netChanged = S.netSaved !== undefined && JSON.stringify(P().network) !== S.netSaved;
  // On a controller: ask once per browser tab, the first save changes the running show.
  if (isLive()) {
    let asked = false;
    try { asked = sessionStorage.getItem('kd.liveSaveOk') === '1'; } catch { /* private mode */ }
    if (!asked) {
      if (!confirm(`Save to the controller at ${S.status.ip}?\n\nThis changes the running show right away (the project reloads and the Startup trigger runs).\n\nYou are only asked once in this tab.`)) return;
      try { sessionStorage.setItem('kd.liveSaveOk', '1'); } catch { /* private mode */ }
    }
  }
  if (S.saving) { toast('Still saving the previous version - one moment'); return; }
  S.saving = true;
  $('#save').disabled = true;
  try {
    // Progress: sending (real), then loading into the controller (no figure: it answers when
    // done). Writing the stick comes after the reply: the "writing to the stick" chip.
    const body = JSON.stringify(P(), null, 1);
    progress('Sending the project', 0);
    const r = await xhrSend('PUT', '/api/project', body, { 'Content-Type': 'application/json' },
      (sent, total) => progress(`Sending the project ${Math.round(sent / total * 100)} %`, sent / total),
      () => progress(isLive() ? 'Loading into the controller…' : 'Loading…', null));
    // The stick write starts now: show it before the next status message says so (older
    // firmware wrote the stick before answering and sends no seq).
    if (r.seq && S.status?.save) S.status.save = { ...S.status.save, seq: r.seq, busy: true };
    progress('Saved', 1);
    progressHide(800);
    S.dirty = false;
    S.tlLiveSent = {};   // the controller reloaded: it has the saved timelines (live editing)
    S.tlLiveErr = {};
    if (undo.timer) undoSnap();
    undo.saved = undo.at;   // undoing back to here is "saved" again
    // Map images that were replaced or removed: only now that the saved project no longer
    // uses them (unsaved changes must never point at a deleted image).
    for (const name of S.mediaTrash)
      if (!P().maps.some((m) => m.background === name)) fetch(`/api/media?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
    S.mediaTrash.clear();
    updateHeader();
    toast(r.reply || 'Saved');
    winSend('saved');
    S.netSaved = JSON.stringify(P().network);
    if (netChanged) netTrialOffer();
  } catch (e) {
    const where = e.stage === 'send' ? 'while sending' : 'while loading';
    progress(`Not saved (${where}): ${e.message}`, 1, 'err');
    toast('Save failed: ' + e.message, true);
  } finally {
    S.saving = false;
    $('#save').disabled = false;
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
  S.editSeq = (S.editSeq || 0) + 1;   // caches keyed on it (timeline clip pictures) repaint
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
  winSend('project');
}
// Selections may point at things that are gone after the project was swapped.
function clampSel() {
  for (const k of ['scene', 'timeline', 'trigger', 'map', 'effect']) S.sel[k] = Math.min(S.sel[k] || 0, Math.max(0, (P()[k + 's'] || []).length - 1));
  S.sel.cue = -1;
}
function undoStep(d) {
  if (undo.timer) undoSnap();   // the change still being made counts first
  const to = undo.at + d;
  if (to < 0 || to >= undo.stack.length) return toast(d < 0 ? 'Nothing to undo' : 'Nothing to redo');
  undo.at = to;
  S.project = normalize(JSON.parse(undo.stack[to]));
  S.editSeq = (S.editSeq || 0) + 1;
  S.dirty = to !== undo.saved;
  clampSel();
  updateHeader();
  updateUndoButtons();
  render();
  toast(d < 0 ? 'Undone' : 'Redone');
  winSend('project');
}

// ---------------------------------------------------------------------------
// More windows (a second screen): every editor window of this browser works on the same
// project. A change goes to the other windows (BroadcastChannel) once the edits pause, as the
// undo copy; each window keeps its own page, selection and undo list. A new window asks
// the others for the project, so it starts with their unsaved changes.
// ---------------------------------------------------------------------------
const win = { id: Math.random().toString(36).slice(2), ch: null, peers: new Set(), joining: false };
function winSend(t, extra) {
  if (!win.ch || !win.peers.size && t !== 'hello') return;
  const m = { t, id: win.id, ...extra };
  if (t === 'project' || t === 'saved') Object.assign(m, { json: undo.stack[undo.at], dirty: S.dirty, trash: [...S.mediaTrash] });
  win.ch.postMessage(m);
}
function winStart() {
  if (!window.BroadcastChannel) return;
  win.ch = new BroadcastChannel('kd-editor');
  win.ch.onmessage = ({ data: m }) => {
    if (m.t === 'hello' || m.t === 'here') {
      win.peers.add(m.id);
      if (m.t === 'hello') { win.ch.postMessage({ t: 'here', id: win.id }); winSend('project'); }
    } else if (m.t === 'bye') win.peers.delete(m.id);
    else if (m.t === 'project') winApply(m);
    else if (m.t === 'saved' && m.json === undo.stack[undo.at]) {
      S.dirty = false;
      undo.saved = undo.at;
      S.mediaTrash.clear();   // the saving window deleted them
      updateHeader();
    }
  };
  window.addEventListener('pagehide', () => win.ch.postMessage({ t: 'bye', id: win.id }));
  // Answers come at once; after that a copy from another window is an edit made there.
  win.joining = true;
  setTimeout(() => (win.joining = false), 1500);
  winSend('hello');
}
function winApply(m) {
  win.peers.add(m.id);
  m.trash.forEach((n) => S.mediaTrash.add(n));
  const first = win.joining;
  win.joining = false;
  if (m.json === undo.stack[undo.at]) { S.dirty = m.dirty; updateHeader(); return; }
  S.project = normalize(JSON.parse(m.json));
  S.editSeq = (S.editSeq || 0) + 1;
  S.dirty = m.dirty;
  // The first copy (this window just opened) replaces what it loaded; later ones are undo steps.
  if (first) { undoReset(!m.dirty); undo.stack[0] = m.json; }
  else {
    clearTimeout(undo.timer);
    undo.timer = 0;
    undo.stack.length = undo.at + 1;
    undo.stack.push(m.json);
    if (undo.stack.length > UNDO_MAX) { undo.stack.shift(); undo.saved--; }
    undo.at = undo.stack.length - 1;
    updateUndoButtons();
  }
  clampSel();
  updateHeader();
  render();
}
// Opens another editor window on the page shown now, next to this one, then moves it to the
// other screen when the browser can tell where that is (Chrome on localhost or https, after
// asking once). Opened first: waiting for that question would make the browser block the window.
async function openWindow() {
  const w = window.open(location.pathname + '#' + S.view, '_blank', `popup,left=${screenX + 60},top=${screenY + 60},width=${outerWidth},height=${outerHeight}`);
  if (!w) return toast('The browser blocked the new window: allow pop-ups for this page', true);
  try {
    if (!window.getScreenDetails) return;
    const sd = await getScreenDetails();
    const o = sd.screens.find((s) => s !== sd.currentScreen);
    if (o && !w.closed) { w.moveTo(o.availLeft, o.availTop); w.resizeTo(o.availWidth, o.availHeight); }
  } catch { /* not allowed: it stays next to this window */ }
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
  return n;
}
// Renaming a timeline: "start timeline Inloop", "timeline Inloop running", … follow.
// A reference is the word after "timeline" (not in pharos commands: those are Pharos numbers).
function renameTimelineRefs(oldName, newName) {
  if (!oldName || !newName || /^\d+$/.test(oldName) || oldName.toLowerCase() === newName.toLowerCase()) return 0;
  let n = 0;
  const fix = (line) => {
    const toks = tokenize(line);
    if (toks[0]?.v.toLowerCase() === 'pharos') return line;
    let out = line;
    for (let i = toks.length - 1; i >= 1; i--)
      if (toks[i - 1].v.toLowerCase() === 'timeline' && toks[i].v.toLowerCase() === oldName.toLowerCase()) {
        out = out.slice(0, toks[i].start) + quote(newName) + out.slice(toks[i].end);
        n++;
      }
    return out;
  };
  for (const t of P().triggers) {
    t.actions = (t.actions || []).map(fix);
    t.conditions = (t.conditions || []).map(fix);
  }
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
  // Renaming a device (of any kind) keeps it in its device groups.
  const devRename = /^(devices|tcp|pcs|projectors|drivers)\.(\d+)\.name$/.exec(el.dataset.p);
  const devItem = devRename && P()[devRename[1]][+devRename[2]];
  const devOld = devItem?.name;
  const devKind = devRename && ({ devices: 'network', tcp: 'tcp', pcs: 'pc', projectors: 'projector' }[devRename[1]] || devItem?.type);
  setPath(P(), el.dataset.p, readInput(el));
  if (devOld && devOld !== el.value)
    P().deviceGroups.filter((g) => (g.kind || 'network') === devKind).forEach((g) => (g.devices = g.devices.map((n) => (n === devOld ? el.value : n))));
  // Renaming a timeline: references by name follow (the name before editing is on the field).
  const tlRename = /^timelines\.(\d+)\.name$/.exec(el.dataset.p);
  if (tlRename && e.type === 'change' && el.dataset.orig != null) {
    const old = el.dataset.orig, tls = P().timelines;
    el.dataset.orig = el.value;
    if (el.value && !tls.some((x, i) => i !== +tlRename[1] && [old, el.value].some((n) => (x.name || '').toLowerCase() === n.toLowerCase()))) {
      const n = renameTimelineRefs(old, el.value);
      if (n) toast(`Updated ${n} reference${n > 1 ? 's' : ''} to the new name`);
    }
  }
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
// Why the controller last started (status "started"); unexpected (older firmware: watchdog /
// crash) = the firmware had hung or crashed and restarted itself.
const startedText = (why) => (!why ? '—' : /^(unexpected|watchdog|crash)$/.test(why)
  ? `<span class="bad" title="The controller restarted without being asked: the firmware hung or crashed (or the reset button was pressed). The log keeps the lines from before the restart: look above '---- restart ----'.">${esc(why)} restart</span>` : esc(why));
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
    chips.push(`<span class="chip ${st.usb ? 'ok' : 'bad'}">Storage device ${st.usb ? 'mounted' : 'missing'}</span>`);
    chips.push(`<span class="chip">${esc(st.ip)}</span>`);
    chips.push(`<span class="chip">engine ${st.stats.engineFps} fps</span>`);
    // What really goes out: frames/packets per second as counted by the controller, "off" when
    // the output is switched off (a protocol that is on but sends nothing shows 0).
    const pkts = 'packets per second (one per universe per frame; with "changes only" fewer while nothing changes)';
    const sent = { dmx: [st.stats.dmxFps, ' fps', 'DMX frames per second'], artnet: [st.stats.artTx, '/s', 'Art-Net ' + pkts], sacn: [st.stats.sacnTx, '/s', 'sACN ' + pkts] };
    const isOff = (k) => st.outputs && !st.outputs[k];
    if (PROTOCOLS.every(([k]) => isOff(k))) chips.push('<span class="chip bad" title="DMX, Art-Net and sACN are all switched off (the switch on Dashboard / Patch, or the output command)">output off</span>');
    else for (const [k, n] of PROTOCOLS) {
      const [v, unit, tip] = sent[k];
      chips.push(isOff(k) ? `<span class="chip bad" title="Switched off (the switch on Dashboard / Patch, or the output command)">${n} off</span>` : `<span class="chip" title="${tip}">${n} ${v ?? 0}${unit}</span>`);
    }
    // The stick write after a save (from any editor): a project that runs but is not stored
    // yet is lost at a restart, so a failed write stays red until a save gets through.
    const sv = st.save;
    if (sv?.failed) chips.push(`<span class="chip bad" title="${esc(sv.error || '')} - the project runs, but a restart would lose it. Save again (and check the storage device).">not on the stick!</span>`);
    else if (sv?.busy) chips.push('<span class="chip warn" title="The project is saved and running; it is now being written to the storage device. Don\'t switch the controller off until this goes away.">writing to the stick…</span>');
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
  applyWhere();
  $('#logBadge').textContent = S.logUnseen ? (S.logUnseen > 99 ? '99+' : S.logUnseen) : '';
}
function onStatus(st) {
  S.status = st;
  S.statusAt = st._at = Date.now();   // st._at: panel controls that follow a timeline move on from here
  if (st.net?.trial) netTrialSeen();
  if (st.time < 1600000000) {
    api('/api/time', { method: 'POST', body: String(Math.floor(Date.now() / 1000)) }).catch(() => {});
  }
  updateHeader();
  if (S.view === 'dashboard') renderPlaybacks();
  if (S.view === 'live') liveStatus();
  if (S.view === 'modes') renderModes();
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
  if (S.view === 'live') liveLog(m);
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
// Autocomplete on the command / condition fields under root: the whole page in render(), or a
// pane that was rebuilt on its own (the trigger editor). Boxes of fields that are gone go too.
function attachACs(root) {
  acs = acs.filter((a) => a.input.isConnected || (a.destroy(), false));
  $$('input.cmd', root).forEach((el) => acs.push(attachAC(el, { onEnter: el.id === 'consoleIn' ? runConsole : null })));
  $$('input.cond', root).forEach((el) => acs.push(attachAC(el, { grammar: COND_GRAMMAR })));
}
function render() {
  acs.forEach((a) => a.destroy());
  acs = [];
  [...pageLoops.keys()].forEach(stopPageLoop);
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === S.view));
  // The page in the address (#timelines) and the title: a reload stays there, and two windows
  // can be told apart in the taskbar.
  if (location.hash !== '#' + S.view) history.replaceState(null, '', '#' + S.view);
  document.title = pageTitle();
  const main = $('#main');
  const scroll = main.scrollTop;
  main.innerHTML = views[S.view]();
  // Splitters first: adding one changes the layout, and the browser's scroll anchoring then moved
  // the page (it jumped up after every colour pick in Scenes).
  $$('.split', main).forEach((el, i) => addSplitter(el, `kd.split.${S.view}.${i}`));
  main.scrollTop = scroll;
  const capped = main.scrollTop;
  attachACs(main);
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
// ---- PC editor or live controller ----
// The mock (PC editor, also what the launcher runs) reports version "mock"; a board reports its
// firmware version. Live gets a coloured badge, top line, frame, tab title/icon and "Save to
// controller", so you never change a running show thinking it is your PC copy.
const LIVE_COLORS = [   // key, colour, text on it
  ['red', '#e5484d', '#fff'], ['magenta', '#d63ad6', '#fff'], ['orange', '#ff7a1a', '#111'],
  ['green', '#2fbf71', '#111'], ['blue', '#3b82f6', '#fff'], ['grey', '#6b7280', '#fff'],
];
const liveColor = () => LIVE_COLORS.find(([k]) => k === uiPref('kd.liveColor', 'red')) || LIVE_COLORS[0];
const pcColor = () => LIVE_COLORS.find(([k]) => k === uiPref('kd.pcColor', 'blue')) || LIVE_COLORS[4];
// null until the first status: nothing is shown rather than a wrong guess.
const isLive = () => (S.status ? S.status.version !== 'mock' : null);
function pageTitle() {
  const page = $(`#nav button[data-view="${S.view}"]`)?.textContent.trim() || S.view;
  const live = isLive();
  return `${live ? '● LIVE · ' : live === false ? 'PC · ' : ''}${page} - KD Designer`;
}
let whereKey = '';
function applyWhere(force) {
  const live = isLive(), st = S.status;
  const key = `${live}|${st?.ip}|${liveColor()[0]}|${pcColor()[0]}`;
  if (!force && key === whereKey) return;
  whereKey = key;
  document.body.classList.toggle('live', live === true);
  document.body.classList.toggle('pc', live === false);
  const w = $('#where'), sv = $('#save');
  if (!w || !sv) return;   // applyUi runs once before the page is complete
  w.className = 'where' + (live ? ' on' : live === false ? ' pc' : '');
  w.innerHTML = live == null ? '' : live
    ? `● LIVE<span class="long"> ON CONTROLLER · ${esc(st.ip || '')}</span>`
    : `PC EDITOR<span class="long"> · offline copy</span>`;
  w.title = live == null ? '' : live
    ? `You are editing the controller itself (${st.ip}, firmware ${st.version}). Save changes the running show.`
    : 'You are editing the show on this PC (offline). Nothing on a controller changes until you send the show to it (launcher or Settings).';
  sv.textContent = live ? 'Save to controller' : 'Save';
  sv.title = live ? 'Save the project to the controller: the running show changes (Ctrl+S)' : live === false ? 'Save the project on this PC (Ctrl+S)' : 'Save project to USB (Ctrl+S)';
  document.title = pageTitle();
  // Tab icon: a filled dot in the live colour, a ring in the PC colour.
  const ic = live ? `<circle cx="8" cy="8" r="7" fill="${liveColor()[1]}"/>` : `<circle cx="8" cy="8" r="5.5" fill="none" stroke="${pcColor()[1]}" stroke-width="3"/>`;
  let link = $('link[rel=icon]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
  link.href = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${ic}</svg>`);
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
  const lc = liveColor();
  html.style.setProperty('--live', lc[1]);
  html.style.setProperty('--live-fg', lc[2]);
  html.style.setProperty('--pc', pcColor()[1]);
  html.style.setProperty('--pc-fg', pcColor()[2]);
  document.body.classList.toggle('live-frame', uiPref('kd.liveFrame', '1') === '1');
  applyWhere(true);
  // The compact (phone) layout follows the width the page really has after zooming;
  // a media query would only see the window.
  document.body.classList.toggle('narrow', innerWidth / uiZoomNow < 760);
}
applyUi();
window.addEventListener('resize', applyUi);
// The page area's height (window minus the top bar, which wraps on small screens), for lists
// that should end at the bottom of the window (style.css --main-h).
new ResizeObserver(() => document.documentElement.style.setProperty('--main-h', $('#main').clientHeight + 'px')).observe($('#main'));
