'use strict';
// KD Designer launcher: a home page on this PC (http://localhost:8079) that lists the shows,
// starts a mock per show, and finds controllers on USB and on the network.
// No dependencies: Node for the work, Windows PowerShell for dialogs, USB devices and the
// Recycle Bin. Started by "KD Designer (PC).cmd"; closing that window stops every mock it started.
//   node tools/launcher.js [show folder to open]
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const dgram = require('dgram');
const { spawn, execFile } = require('child_process');

const REPO = path.join(__dirname, '..');
// KD_SHOWS / KD_LAUNCHER_CONF / KD_LAUNCHER_PORT: other places, for tests.
const SHOWS = process.env.KD_SHOWS || path.join(os.homedir(), 'Documents', 'KD Shows');   // same folder the old menu used
const BACKUPS = path.join(SHOWS, 'Backups');
const CONF = process.env.KD_LAUNCHER_CONF || path.join(process.env.APPDATA || os.homedir(), 'KD Designer', 'launcher.json');
const FIRST_PORT = +process.env.KD_LAUNCHER_PORT || 8079;
const EXAMPLES = [
  { path: path.join(REPO, 'data', 'show'), label: 'Sample project', note: 'data\\show in the project folder' },
  { path: path.join(REPO, 'examples', 'feature-demo'), label: 'Feature demo', note: 'every feature once - best copied first' },
  // Museum starting points, written by tools/make-examples.js.
  { path: path.join(REPO, 'examples', 'museum-gallery'), label: 'Museum gallery', note: 'opening hours, cleaning, night light, staff panel' },
  { path: path.join(REPO, 'examples', 'immersive-room'), label: 'Immersive room', note: 'projection show with light, start button, inloop' },
  { path: path.join(REPO, 'examples', 'hands-on-exhibit'), label: 'Hands-on exhibit', note: '6 buttons: video + spot per object, presence sensor' },
  { path: path.join(REPO, 'examples', 'story-diorama'), label: 'Story diorama', note: 'narration in 3 languages with light cues (Machine Control)' },
  { path: path.join(REPO, 'examples', 'auditorium'), label: 'Auditorium', note: 'lecture / film / break presets, screen, blinds' },
  { path: path.join(REPO, 'examples', 'building-startup'), label: 'Building start-up', note: 'whole museum on and off in steps, morning report' },
  { path: path.join(REPO, 'examples', 'brightsign-players'), label: '8 BrightSign players', note: 'each player used differently: UDP, plugin zones, GPIO, serial, variables' },
];
const PAGE = path.join(__dirname, 'launcher.html');
const NO_BROWSER = !!process.env.KD_NOBROWSER;

// ---- settings: recent shows, pinned shows, known controllers --------------
let conf = { recent: [], pinned: [], controllers: [] };
try { conf = Object.assign(conf, JSON.parse(fs.readFileSync(CONF, 'utf8'))); } catch { /* first run */ }
function saveConf() {
  fs.mkdirSync(path.dirname(CONF), { recursive: true });
  fs.writeFileSync(CONF, JSON.stringify(conf, null, 1));
}
const key = (p) => path.resolve(p).toLowerCase();
function touchRecent(p) {
  conf.recent = [{ path: path.resolve(p), at: Date.now() }, ...conf.recent.filter((r) => key(r.path) !== key(p))].slice(0, 30);
  saveConf();
}
function movePath(from, to) {
  for (const r of conf.recent) if (key(r.path) === key(from)) r.path = to;
  conf.pinned = conf.pinned.map((x) => (key(x) === key(from) ? to : x));
  saveConf();
}
function forgetPath(p) {
  conf.recent = conf.recent.filter((r) => key(r.path) !== key(p));
  conf.pinned = conf.pinned.filter((x) => key(x) !== key(p));
  saveConf();
}

// ---- shows ------------------------------------------------------------------
// Project summaries are cached by file time: big rigs make project.json large.
const infoCache = new Map();
function showInfo(dir) {
  const file = path.join(dir, 'project.json');
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const c = infoCache.get(file);
  if (c && c.mtime === st.mtimeMs && c.size === st.size) return c.info;
  let info;
  try {
    const p = JSON.parse(fs.readFileSync(file, 'utf8'));
    const n = (a) => (Array.isArray(a) ? a.length : 0);
    info = { project: p.name || '', fixtures: n(p.fixtures), universes: n(p.universes), timelines: n(p.timelines),
      triggers: n(p.triggers), scenes: n(p.scenes), saved: st.mtimeMs, size: st.size };
  } catch (e) { info = { error: 'project.json is damaged: ' + e.message, saved: st.mtimeMs, size: st.size }; }
  infoCache.set(file, { mtime: st.mtimeMs, size: st.size, info });
  return info;
}
function listShows() {
  const seen = new Map();
  const add = (dir, extra) => {
    const k = key(dir);
    if (seen.has(k)) return Object.assign(seen.get(k), extra);
    const info = showInfo(dir);
    if (!info && !extra.recentAt) return;
    const m = mocks.get(k);
    seen.set(k, { path: path.resolve(dir), name: path.basename(dir), missing: !info, ...info,
      pinned: conf.pinned.some((x) => key(x) === k), running: m ? m.port : 0, ...extra });
  };
  try {
    for (const d of fs.readdirSync(SHOWS, { withFileTypes: true }))
      if (d.isDirectory() && d.name !== 'Backups') add(path.join(SHOWS, d.name), { inShows: true });
  } catch { /* no shows folder yet */ }
  for (const r of conf.recent) add(r.path, { recentAt: r.at });
  for (const x of conf.pinned) add(x, {});
  for (const e of EXAMPLES) add(e.path, { example: e.label, note: e.note });
  for (const m of mocks.values()) add(m.path, {});
  return [...seen.values()];
}
const cleanName = (s) => String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 60);
function freeFolder(name) {
  const base = cleanName(name) || 'New show';
  let dir = path.join(SHOWS, base);
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(SHOWS, `${base} (${i})`);
  return dir;
}
// A show is project.json + media/; logs, state files and .bak stay behind.
function copyShow(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.copyFileSync(path.join(from, 'project.json'), path.join(to, 'project.json'));
  if (fs.existsSync(path.join(from, 'media'))) fs.cpSync(path.join(from, 'media'), path.join(to, 'media'), { recursive: true });
}
function setProjectName(dir, name) {
  const file = path.join(dir, 'project.json');
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  p.name = name;
  fs.writeFileSync(file, JSON.stringify(p, null, 1));
}
// .kdshow = { kdshow: 1, exported, project, media: { name: base64 } }, like exportShow() in app-system.js.
const mediaNames = (p) => [...new Set((p.maps || []).map((m) => m.background).filter(Boolean))];
function readKdshow(dir) {
  const project = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
  const media = {};
  for (const n of mediaNames(project)) {
    try { media[n] = fs.readFileSync(path.join(dir, 'media', path.basename(n))).toString('base64'); } catch { /* missing image */ }
  }
  return { kdshow: 1, exported: new Date().toISOString(), project, media };
}
function writeShowFolder(dir, project, media) {
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project, null, 1));
  for (const [n, b64] of Object.entries(media || {})) fs.writeFileSync(path.join(dir, 'media', path.basename(n)), Buffer.from(b64, 'base64'));
}
const stamp = () => { const d = new Date(), z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}${z(d.getMinutes())}`; };
function backupFile(name) {
  fs.mkdirSync(BACKUPS, { recursive: true });
  return path.join(BACKUPS, `${cleanName(name) || 'show'} ${stamp()}.kdshow`);
}

// ---- mocks: one per open show ------------------------------------------------
const mocks = new Map();   // key(path) -> { path, port, proc, started, out: [] }
const lastExit = new Map();   // key(path) -> last lines of a mock that stopped by itself
function portFree(port) {
  return new Promise((ok) => {
    const s = net.createServer().once('error', () => ok(false)).once('listening', () => s.close(() => ok(true)));
    s.listen(port);
  });
}
async function freePort(from) {
  const used = new Set([...mocks.values()].map((m) => m.port));
  for (let p = from; p < from + 100; p++) if (!used.has(p) && p !== myPort && await portFree(p)) return p;
  throw new Error('No free port');
}
function listening(port, ms) {
  const until = Date.now() + ms;
  return new Promise((ok) => {
    const tryOnce = () => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); ok(true); });
      s.once('error', () => { s.destroy(); if (Date.now() > until) ok(false); else setTimeout(tryOnce, 150); });
    };
    tryOnce();
  });
}
async function startMock(dir) {
  dir = path.resolve(dir);
  const k = key(dir);
  if (mocks.has(k)) return mocks.get(k).port;
  const port = await freePort(8080);
  const proc = spawn(process.execPath, [path.join(__dirname, 'mock-server.js'), String(port), dir], { cwd: REPO, windowsHide: true });
  const m = { path: dir, port, proc, started: Date.now(), out: [] };
  const keep = (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) m.out.push(l); m.out.splice(0, m.out.length - 20); };
  proc.stdout.on('data', keep);
  proc.stderr.on('data', keep);
  proc.on('exit', (code) => {
    if (mocks.get(k) === m) mocks.delete(k);
    if (!m.stopping) { lastExit.set(k, m.out.slice(-8)); console.log(`  Show stopped (code ${code}): ${dir}`); }
  });
  mocks.set(k, m);
  lastExit.delete(k);
  touchRecent(dir);
  if (!await listening(port, 8000)) {
    proc.kill();
    throw new Error('The show did not start: ' + (m.out.slice(-3).join(' ') || 'no answer'));
  }
  console.log(`  Opened on http://localhost:${port}: ${dir}`);
  return port;
}
function stopMock(dir) {
  const m = mocks.get(key(dir));
  if (!m) return false;
  m.stopping = true;
  m.proc.kill();
  mocks.delete(key(dir));
  console.log(`  Closed: ${dir}`);
  return true;
}

// ---- Windows helpers (PowerShell 5 is always there) --------------------------
function ps(script, env = {}, timeout = 20000) {
  return new Promise((ok, fail) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' + script],
      { env: { ...process.env, ...env }, windowsHide: true, timeout, maxBuffer: 4 << 20 },
      (err, out, errOut) => (err && !out ? fail(new Error(String(errOut || err.message).trim().split('\n')[0])) : ok(String(out).trim())));
  });
}
// The dialogs get a top-most owner so they don't open behind the browser.
const DIALOG = 'Add-Type -AssemblyName System.Windows.Forms; $o = New-Object System.Windows.Forms.Form -Property @{TopMost=$true};';
function pickFile(title, filter, start) {
  return ps(DIALOG + '$d = New-Object System.Windows.Forms.OpenFileDialog -Property @{Title=$env:KD_T; Filter=$env:KD_F; InitialDirectory=$env:KD_S};'
    + 'if ($d.ShowDialog($o) -eq "OK") { $d.FileName }', { KD_T: title, KD_F: filter, KD_S: start }, 600000);
}
function pickFolder(title, start) {
  return ps(DIALOG + '$d = New-Object System.Windows.Forms.FolderBrowserDialog -Property @{Description=$env:KD_T; SelectedPath=$env:KD_S};'
    + 'if ($d.ShowDialog($o) -eq "OK") { $d.SelectedPath }', { KD_T: title, KD_S: start }, 600000);
}
const toRecycleBin = (dir) => ps('Add-Type -AssemblyName Microsoft.VisualBasic;'
  + '[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($env:KD_P, "OnlyErrorDialogs", "SendToRecycleBin")', { KD_P: dir });
const reveal = (p) => spawn('explorer.exe', fs.statSync(p).isDirectory() ? [p] : ['/select,', p], { detached: true, stdio: 'ignore' }).unref();
const openUrl = (u) => { if (!NO_BROWSER) spawn('explorer.exe', [u], { detached: true, stdio: 'ignore' }).unref(); };

// ---- USB: Arduino boards and KD sticks -----------------------------------------
// Arduino's USB vendor ids; the Portenta H7 is PID 025B running and 035B in the bootloader
// (double-tap reset). A board shows a "(COMx)" device per serial port plus a parent device.
const PORTENTA = { '025B': 'Portenta H7', '035B': 'Portenta H7 (bootloader)' };
let usbCache = { at: 0, data: null }, usbBusy = null;
function scanUsb() {
  if (usbBusy) return usbBusy;
  usbBusy = ps('$ErrorActionPreference="SilentlyContinue";'
    + `$b = @(Get-CimInstance Win32_PnPEntity -Filter "PNPDeviceID LIKE 'USB\\\\VID_2341%' OR PNPDeviceID LIKE 'USB\\\\VID_2A03%'" | Select-Object Name,PNPDeviceID,Status);`
    // Removable drives plus drives on a USB disk: many sticks and all USB SSDs say "fixed".
    + '$u = @(Get-Disk | Where-Object BusType -eq "USB" | Get-Partition | Where-Object DriveLetter | ForEach-Object { "$($_.DriveLetter):" });'
    + '$d = @(Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 2 -or $u -contains $_.DeviceID } | Select-Object DeviceID,VolumeName,Size,FreeSpace);'
    + '@{boards=$b; drives=$d} | ConvertTo-Json -Depth 3 -Compress').then((out) => {
    const j = JSON.parse(out || '{}');
    const byDev = new Map();
    for (const e of [].concat(j.boards || [])) {
      const m = /VID_([0-9A-F]{4})&PID_([0-9A-F]{4})(?:&MI_\d+)?\\?(.*)$/i.exec(e.PNPDeviceID || '');
      if (!m) continue;
      const pid = m[2].toUpperCase(), id = `${m[1]}:${pid}`;
      const com = /\((COM\d+)\)/.exec(e.Name || '');
      const b = byDev.get(id) || { id, pid, name: m[1] === '2341' && PORTENTA[pid] ? PORTENTA[pid] : (e.Name || '').replace(/\s*\(COM\d+\)/, ''), ports: [], ok: true };
      // Other boards: the serial port's name ("Arduino Uno (COM3)") beats the parent's "USB Composite Device".
      if (com && !PORTENTA[pid]) b.name = e.Name.replace(/\s*\(COM\d+\)/, '');
      if (com && !b.ports.includes(com[1])) b.ports.push(com[1]);
      if (e.Status && e.Status !== 'OK') b.ok = false;
      byDev.set(id, b);
    }
    const drives = [].concat(j.drives || []).map((d) => {
      const root = d.DeviceID + '\\';
      const has = (p) => fs.existsSync(path.join(root, p));
      const show = has('show\\project.json') ? showInfo(path.join(root, 'show')) : null;
      return { drive: d.DeviceID, label: d.VolumeName || '', size: +d.Size || 0, free: +d.FreeSpace || 0,
        kd: has('www\\index.html') || !!show, www: has('www\\index.html'), show };
    });
    usbCache = { at: Date.now(), data: { boards: [...byDev.values()], drives } };
    return usbCache.data;
  }).catch((e) => ({ boards: [], drives: [], error: e.message })).finally(() => { usbBusy = null; });
  return usbBusy;
}

// ---- network: Art-Net poll finds controllers (they answer as "KD Designer") ----
let artSock = null, artError = '';
const artNodes = new Map();   // ip -> { ip, short, long, seen }
function artStart() {
  artSock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  artSock.on('error', (e) => {
    artError = e.code === 'EADDRINUSE' ? 'Art-Net port 6454 is used by another program, so controllers are found by address only' : e.message;
    try { artSock.close(); } catch { /* already closed */ }
    artSock = null;
  });
  artSock.on('message', (b, from) => {
    if (b.length < 108 || b.toString('latin1', 0, 8) !== 'Art-Net\0' || b.readUInt16LE(8) !== 0x2100) return;
    const ip = `${b[10]}.${b[11]}.${b[12]}.${b[13]}`;
    const str = (at, n) => b.toString('latin1', at, at + n).replace(/\0.*$/s, '').trim();
    artNodes.set(ip, { ip, short: str(26, 18), long: str(44, 64), seen: Date.now(), from: from.address });
  });
  artSock.bind(6454, () => { try { artSock.setBroadcast(true); } catch { /* ignore */ } });
}
function broadcasts() {
  const out = new Set(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const ip = a.address.split('.').map(Number), mask = a.netmask.split('.').map(Number);
      out.add(ip.map((x, i) => (x | (~mask[i] & 255))).join('.'));
    }
  return [...out];
}
function myIps() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push({ name, ip: a.address, mask: a.netmask });
  return out;
}
// HTTP to a controller ("ip" or "ip:port"), answered as { status, body: Buffer }.
function ctlRequest(addr, method, p, body, timeout = 4000) {
  const [host, port] = addr.split(':');
  return new Promise((ok, fail) => {
    const req = http.request({ host, port: +port || 80, method, path: p, timeout,
      headers: body ? { 'Content-Length': body.length, 'Content-Type': 'application/octet-stream' } : {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => ok({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('no answer')));
    req.on('error', fail);
    if (body) req.write(body);
    req.end();
  });
}
async function ctlJson(addr, method, p, body, timeout) {
  const r = await ctlRequest(addr, method, p, body, timeout);
  let j;
  try { j = JSON.parse(r.body.toString('utf8')); } catch { throw new Error(`Unexpected answer (HTTP ${r.status})`); }
  if (r.status >= 400) throw new Error(j.reply || `HTTP ${r.status}`);
  return j;
}
let netCache = { at: 0, data: null }, netBusy = null;
function scanNet() {
  if (netBusy) return netBusy;
  netBusy = (async () => {
    if (!artSock && !artError) artStart();
    if (artSock) {
      const poll = Buffer.from([...Buffer.from('Art-Net\0'), 0x00, 0x20, 0, 14, 0, 0]);
      for (const b of broadcasts()) artSock.send(poll, 6454, b, () => {});
      await new Promise((r) => setTimeout(r, 1500));
    }
    const now = Date.now();
    for (const [ip, n] of artNodes) if (now - n.seen > 60000) artNodes.delete(ip);
    const kd = [...artNodes.values()].filter((n) => /^KD Designer/i.test(n.short));
    const addrs = [...new Set([...kd.map((n) => n.ip), ...conf.controllers.map((c) => c.ip)])];
    const ctls = await Promise.all(addrs.map(async (ip) => {
      const known = conf.controllers.find((c) => c.ip === ip);
      const c = { ip, found: kd.some((n) => n.ip === ip), saved: !!known };
      try {
        const s = await ctlJson(ip, 'GET', '/api/status', null, 2000);
        Object.assign(c, { online: true, version: s.version, project: s.project, uptime: s.uptime, usb: s.usb,
          target: s.update?.target || '', restarting: !!s.update?.restarting, safeMode: !!s.safeMode });
        if (known) { known.project = s.project; known.seen = now; }
        else { conf.controllers.push({ ip, project: s.project, seen: now }); c.saved = true; }
      } catch (e) { Object.assign(c, { online: false, error: e.message, project: known?.project || '', lastSeen: known?.seen || 0 }); }
      return c;
    }));
    saveConf();
    const others = [...artNodes.values()].filter((n) => !/^KD Designer/i.test(n.short)).sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
    netCache = { at: Date.now(), data: { controllers: ctls, others, artError, ips: myIps() } };
    return netCache.data;
  })().finally(() => { netBusy = null; });
  return netBusy;
}

// ---- controller actions ---------------------------------------------------------
async function ctlKdshow(ip) {
  const r = await ctlRequest(ip, 'GET', '/api/project', null, 15000);
  if (r.status !== 200) throw new Error(`Could not read the show (HTTP ${r.status})`);
  const project = JSON.parse(r.body.toString('utf8'));
  const media = {}, missing = [];
  for (const n of mediaNames(project)) {
    try {
      const m = await ctlRequest(ip, 'GET', '/media/' + encodeURIComponent(n), null, 15000);
      if (m.status !== 200) throw new Error();
      media[n] = m.body.toString('base64');
    } catch { missing.push(n); }
  }
  return { file: { kdshow: 1, exported: new Date().toISOString(), project, media }, missing };
}
// Sends a PC show: the controller's current show is saved in Backups first, and the
// controller keeps its own network settings (a PC show must not move it to another address).
async function ctlSend(ip, dir) {
  const old = await ctlKdshow(ip);
  const bak = backupFile(`${old.file.project.name || 'show'} from ${ip.replace(/:/g, '-')}`);
  fs.writeFileSync(bak, JSON.stringify(old.file, null, 1));
  const show = readKdshow(dir);
  if (old.file.project.network) show.project.network = old.file.project.network;
  for (const [n, b64] of Object.entries(show.media)) await ctlJson(ip, 'PUT', '/api/media?name=' + encodeURIComponent(n), Buffer.from(b64, 'base64'), 30000);
  const j = await ctlJson(ip, 'POST', '/api/project', Buffer.from(JSON.stringify(show.project)), 30000);
  const lost = mediaNames(show.project).filter((n) => !(n in show.media));
  return { reply: (j.reply || 'Sent') + (lost.length ? ` - image(s) not found on the PC: ${lost.join(', ')}` : ''), backup: bak };
}
function updateFiles() {
  try {
    return fs.readdirSync(path.join(REPO, 'updates')).filter((f) => f.endsWith('.kdupdate')).map((f) => {
      const st = fs.statSync(path.join(REPO, 'updates', f));
      return { name: f, size: st.size, at: st.mtimeMs, target: /machine_control/.test(f) ? 'machine_control' : /portenta/.test(f) ? 'portenta' : 'any' };
    }).sort((a, b) => b.at - a.at);
  } catch { return []; }
}

// ---- HTTP ---------------------------------------------------------------------
function body(req) { return new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); }); }
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
const needShow = (p) => { if (!p || !fs.existsSync(path.join(p, 'project.json'))) throw new Error('That show folder has no project.json'); return path.resolve(p); };
const isExample = (p) => EXAMPLES.some((e) => key(e.path) === key(p));

const actions = {
  async open({ path: p }) { return { port: await startMock(needShow(p)) }; },
  async stop({ path: p }) { stopMock(p); return {}; },
  async new({ name, from }) {
    const dir = freeFolder(name);
    // Empty = the same project the mock writes for a new folder, named after the folder.
    if (from) copyShow(needShow(from), dir);
    else writeShowFolder(dir, { name: '', fixtures: [], groups: [], scenes: [], timelines: [], triggers: [], universes: [{ id: 1, name: 'Universe 1', dmxPort: 1, artnet: 0, sacn: 1 }] });
    setProjectName(dir, path.basename(dir));
    return { port: await startMock(dir), path: dir };
  },
  async duplicate({ path: p, name }) {
    const dir = freeFolder(name || path.basename(p) + ' copy');
    copyShow(needShow(p), dir);
    setProjectName(dir, path.basename(dir));
    return { path: dir };
  },
  async rename({ path: p, name }) {
    p = needShow(p);
    if (isExample(p)) throw new Error('The examples keep their names - duplicate one first');
    if (mocks.has(key(p))) throw new Error('Close the show first');
    const to = path.join(path.dirname(p), cleanName(name));
    if (!cleanName(name)) throw new Error('Type a name');
    if (key(to) === key(p)) return { path: p };
    if (fs.existsSync(to)) throw new Error('There is already a show with that name');
    fs.renameSync(p, to);
    movePath(p, to);
    // The name inside follows when it was the folder name (it shows in the editor's title).
    if (showInfo(to)?.project === path.basename(p)) setProjectName(to, path.basename(to));
    return { path: to };
  },
  async delete({ path: p }) {
    p = path.resolve(p);
    if (isExample(p)) throw new Error('The examples are part of KD Designer and cannot be deleted');
    if (mocks.has(key(p))) throw new Error('Close the show first');
    await toRecycleBin(p);
    forgetPath(p);
    return { reply: 'Moved to the Recycle Bin' };
  },
  async forget({ path: p }) { forgetPath(p); return {}; },
  async pin({ path: p, pinned }) {
    conf.pinned = conf.pinned.filter((x) => key(x) !== key(p));
    if (pinned) conf.pinned.push(path.resolve(p));
    saveConf();
    return {};
  },
  async reveal({ path: p }) { reveal(p || SHOWS); return {}; },
  // "Open…": a show folder's project.json, or a .kdshow file (unpacked into a new show folder).
  async browse() {
    const f = await pickFile('Open a show: its project.json, or a .kdshow file', 'KD shows (project.json, .kdshow)|project.json;*.kdshow|All files|*.*', SHOWS);
    if (!f) return { cancelled: true };
    if (/\.kdshow$/i.test(f)) return actions.import({ file: f });
    const dir = path.dirname(f);
    return { port: await startMock(needShow(dir)), path: dir };
  },
  async import({ file }) {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const project = j.kdshow ? j.project : j;
    if (!project || typeof project !== 'object') throw new Error('No project in that file');
    const dir = freeFolder(project.name || path.basename(file, path.extname(file)));
    writeShowFolder(dir, project, j.kdshow ? j.media : {});
    return { port: await startMock(dir), path: dir };
  },
  async backup({ path: p }) {
    const k = readKdshow(needShow(p));
    const f = backupFile(k.project.name || path.basename(p));
    fs.writeFileSync(f, JSON.stringify(k, null, 1));
    reveal(f);
    return { reply: 'Saved ' + path.basename(f), file: f };
  },
  async check({ path: p }) {
    const file = path.join(needShow(p), 'project.json');
    return new Promise((ok) => execFile(process.execPath, [path.join(__dirname, 'check-project.js'), file], { cwd: REPO, windowsHide: true, timeout: 60000, maxBuffer: 8 << 20 },
      (err, out, errOut) => ok({ text: (String(out) + String(errOut)).trim(), problems: !!err })));
  },
  // USB storage device: copy its show to the PC, put a PC show on it, or give it this PC's web UI.
  async stickGet({ drive }) {
    const src = needShow(path.join(drive + '\\', 'show'));
    const dir = freeFolder((showInfo(src)?.project || 'Storage show') + ' (storage device)');
    copyShow(src, dir);
    return { path: dir };
  },
  async stickPut({ drive, path: p }) {
    p = needShow(p);
    const dst = path.join(drive + '\\', 'show');
    let bak = '';
    if (fs.existsSync(path.join(dst, 'project.json'))) {
      const old = readKdshow(dst);
      bak = backupFile(`${old.project.name || 'show'} from storage device`);
      fs.writeFileSync(bak, JSON.stringify(old, null, 1));
      // Keep the controller's network settings, as when sending over the network.
      const show = readKdshow(p);
      if (old.project.network) show.project.network = old.project.network;
      writeShowFolder(dst, show.project, show.media);
    } else copyShow(p, dst);
    return { reply: `Show copied to ${drive}`, backup: bak };
  },
  async stickWww({ drive }) {
    const dst = path.join(drive + '\\', 'www');
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(path.join(REPO, 'data', 'www'), dst, { recursive: true });
    return { reply: `Web UI copied to ${drive}\\www` };
  },
  // Controllers on the network
  async ctlAdd({ ip }) {
    ip = String(ip || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^[\w.-]+(:\d+)?$/.test(ip)) throw new Error('Type an address like 192.168.1.50');
    if (!conf.controllers.some((c) => c.ip === ip)) conf.controllers.push({ ip, seen: 0 });
    saveConf();
    return scanNet();
  },
  async ctlForget({ ip }) { conf.controllers = conf.controllers.filter((c) => c.ip !== ip); saveConf(); return {}; },
  async ctlGet({ ip }) {
    const { file, missing } = await ctlKdshow(ip);
    const dir = freeFolder(file.project.name || 'Controller show');
    writeShowFolder(dir, file.project, file.media);
    return { path: dir, reply: missing.length ? `Copied without image(s): ${missing.join(', ')}` : 'Copied to ' + path.basename(dir) };
  },
  async ctlSend({ ip, path: p }) { return ctlSend(ip, needShow(p)); },
  async ctlUpdate({ ip, name }) {
    const f = path.join(REPO, 'updates', path.basename(name || ''));
    if (!fs.existsSync(f)) throw new Error('Update file not found');
    const j = await ctlJson(ip, 'POST', '/api/update', fs.readFileSync(f), 180000);
    return { reply: j.reply || 'Sent' };
  },
};

let myPort = 0;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/' || p === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(fs.readFileSync(PAGE));
    }
    if (p === '/api/hello') return json(res, 200, { kd: 'launcher' });
    if (p === '/api/state') {
      return json(res, 200, { shows: listShows(), showsDir: SHOWS, backups: BACKUPS, node: process.version, host: os.hostname(),
        stopped: Object.fromEntries([...lastExit].map(([k, v]) => [k, v])), updates: updateFiles() });
    }
    if (p === '/api/usb') return json(res, 200, Date.now() - usbCache.at < 2000 && usbCache.data ? usbCache.data : await scanUsb());
    if (p === '/api/net') return json(res, 200, url.searchParams.get('cached') && netCache.data ? netCache.data : await scanNet());
    const act = p.startsWith('/api/do/') && actions[p.slice(8)];
    // The custom header keeps other web pages from driving the launcher (they can't send it without CORS).
    if (act && req.method === 'POST' && req.headers['x-kd'] === '1') {
      const r = await act(JSON.parse((await body(req)).toString('utf8') || '{}'));
      return json(res, 200, { ok: true, ...r });
    }
    res.writeHead(404);
    res.end('Not found');
  } catch (e) {
    json(res, 400, { ok: false, reply: e.message });
  }
});

// Already running (double-clicked again)? Then just show it, and hand over a dropped folder.
async function main() {
  const dropped = process.argv[2] ? path.resolve(process.argv[2]) : '';
  for (let port = FIRST_PORT; port > FIRST_PORT - 10; port--) {
    try {
      const r = await ctlJson(`127.0.0.1:${port}`, 'GET', '/api/hello', null, 800);
      if (r.kd === 'launcher') {
        console.log(`The launcher is already running on http://localhost:${port}`);
        if (dropped) {
          const o = await new Promise((ok) => {
            const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/do/open', headers: { 'X-KD': '1' } }, (rs) => { let b = ''; rs.on('data', (d) => (b += d)); rs.on('end', () => ok(JSON.parse(b))); });
            req.end(JSON.stringify({ path: dropped }));
          });
          if (o.port) openUrl(`http://localhost:${o.port}`);
          else console.log(o.reply);
        } else openUrl(`http://localhost:${port}`);
        return setTimeout(() => process.exit(0), 1500);
      }
    } catch { /* nothing there */ }
    if (await portFree(port)) { myPort = port; break; }
  }
  if (!myPort) { console.log(`No free port for the launcher (${FIRST_PORT - 9}-${FIRST_PORT})`); process.exit(1); }
  fs.mkdirSync(SHOWS, { recursive: true });
  server.listen(myPort, '127.0.0.1', async () => {
    console.log(`\n  KD Designer launcher: http://localhost:${myPort}`);
    console.log(`  Shows are kept in ${SHOWS}`);
    console.log('  Close this window to stop the launcher and every show it opened (save in the browser first).\n');
    openUrl(`http://localhost:${myPort}`);
    if (dropped) {
      try { openUrl(`http://localhost:${await startMock(needShow(dropped))}`); } catch (e) { console.log('  ' + e.message); }
    }
    scanNet().catch(() => {});
  });
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { for (const m of mocks.values()) m.proc.kill(); process.exit(0); });
process.on('exit', () => { for (const m of mocks.values()) try { m.proc.kill(); } catch { /* gone */ } });
main();
