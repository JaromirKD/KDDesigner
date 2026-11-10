// Overnight soak test against a real controller: loads the stress show, runs the stress.js
// tests in a loop until morning, watches for restarts, outages, memory leaks and lost data,
// then puts the original project back.
//   node tools/stress/soak.js <controller-ip> [--until 08:00 | --hours 12] [--pc <this PC's ip>]
//        [--cycle 10] [--check 60] [--keep]
// Every cycle (default 10 min): 5 min of everything at once (Art-Net in on this PC, UDP 200/s,
// echo 50/s, OSC 80/s, 2 web clients), the bursts, the paced stream, then quiet with Art-Net
// still measured. Once an hour: web files and the project downloaded and compared.
// /api/status is read every 2 s the whole time.
// Results go to tools/stress/soak-results/<date time>/: report.txt (rewritten after every
// cycle: read this), cycles.csv, minutes.csv, events.log, the backup of the original project,
// and the controller's log after any restart. --keep leaves the stress show on the controller.
// Ctrl+C stops early and still restores the project. The PC is kept awake while it runs.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const S = require('./stress');

const args = process.argv.slice(2);
const IP = args[0];
if (!IP || IP.startsWith('--')) { console.error('usage: soak.js <controller-ip> [--until HH:MM | --hours N] [--pc ip] [--cycle min] [--keep]'); process.exit(1); }
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : args[i + 1]; };
S.setIp(IP);

const pcIp = opt('pc', null) || (Object.values(os.networkInterfaces()).flat()
  .find((a) => a.family === 'IPv4' && a.address.split('.').slice(0, 3).join('.') === IP.split('.').slice(0, 3).join('.')) || {}).address;
if (!pcIp) { console.error('could not find this PC\'s address on the controller\'s network: pass --pc'); process.exit(1); }
const CYCLE_MS = +opt('cycle', 10) * 60000;
const CHECK_MS = +opt('check', 60) * 60000;   // data check every ... minutes
const LOAD_S =Math.min(300, Math.round(CYCLE_MS / 2000));
const startAt = Date.now();
let endAt;
if (opt('hours', null)) endAt = startAt + +opt('hours') * 3600000;
else {
  const [hh, mm] = opt('until', '08:00').split(':').map(Number);
  const d = new Date(); d.setHours(hh, mm || 0, 0, 0);
  if (d.getTime() <= startAt) d.setDate(d.getDate() + 1);
  endAt = d.getTime();
}

const two = (n) => String(n).padStart(2, '0');
const stamp = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`; };
const OUT = path.join(__dirname, 'soak-results', stamp().slice(0, 16).replace(/[: ]/g, (c) => (c === ' ' ? '_' : '')));
fs.mkdirSync(OUT, { recursive: true });
const file = (n) => path.join(OUT, n);
const log = (msg) => { const line = `${stamp()}  ${msg}`; console.log(line); fs.appendFileSync(file('events.log'), line + '\n'); };
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const kb = (v) => (v == null ? '-' : (v / 1024).toFixed(0) + ' KB');
const dur = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? m + ' min' : `${Math.floor(m / 60)} h ${two(m % 60)} min`; };

// Raw GET (gzip-decoded bytes), for files that must come back byte for byte.
function getRaw(p, timeout = 30000) {
  return new Promise((resolve) => {
    const r = http.request({ host: IP, path: p, timeout, agent: false, headers: { 'Accept-Encoding': 'gzip' } }, (res) => {
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => {
        let b = Buffer.concat(c);
        try { if (res.headers['content-encoding'] === 'gzip') b = zlib.gunzipSync(b); } catch (e) { return resolve({ err: 'bad gzip' }); }
        resolve({ status: res.statusCode, body: b });
      });
      res.on('error', (e) => resolve({ err: e.message }));
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', (e) => resolve({ err: e.message }));
    r.end();
  });
}

// Keeps Windows awake while this runs (the same call video players make; nothing is changed in
// the power settings). The screen must stay on too: on a laptop with Modern Standby, screen off
// = standby, and this program is paused (found on the first try, 9 Nov 2026). Closing the lid
// or pressing the power button still sends it to sleep. The helper exits when this process does.
function keepAwake() {
  if (process.platform !== 'win32') return null;
  const ps = `Add-Type -Name P -Namespace W -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);';
[W.P]::SetThreadExecutionState([uint32]"0x80000003") | Out-Null
while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) { Start-Sleep 30 }`;
  try { return spawn('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore', windowsHide: true }); } catch (e) { return null; }
}

// ---- What the night found ----------------------------------------------------------------
const R = {
  info: {}, problems: [], cycles: [], restored: null,
  mon: { samples: 0, fails: 0, outages: 0, longestOutMs: 0, outStart: 0, restarts: [], heapStart: null, heapMin: null, heapMinEver: null,
         fpsMin: null, tickMax: 0, udpDropped: 0, hourHeap: {}, last: null },
  tot: { udpSent: 0, udpFired: 0, oscSent: 0, oscFired: 0, echoSent: 0, echoGot: 0, echoP99Max: 0, httpOk: 0, httpFail: 0,
         artFpsMin: null, artGapMax: 0, artLate: 0, artFrames: 0, bursts: 0, burstShort: 0, streams: 0, streamShort: 0, checks: 0, checksBad: 0 },
};
const problem = (level, text) => { R.problems.push({ t: Date.now(), level, text }); log(`${level}: ${text}`); };
// Times this PC was asleep (the program stood still): what was measured across them says
// nothing about the controller, so those cycles are not judged.
R.pcPauses = [];
const pcPausedSince = (t0) => R.pcPauses.some((p) => p.end > t0);
const lo = (a, b) => (a == null ? b : b == null ? a : Math.min(a, b));

// ---- /api/status every 2 s, all night ------------------------------------------------------
let minute = null;
fs.writeFileSync(file('minutes.csv'), 'time,ok,failed,uptime_s,heap_free_min,heap_min_ever,fps_min,tick_us_max,loop_us_max,busy_us_max,trig_us_max,udp_dropped,http_max\n');
function flushMinute() {
  if (!minute) return;
  const m = minute;
  fs.appendFileSync(file('minutes.csv'), [stamp(m.t).slice(0, 16), m.ok, m.fail, m.uptime, m.heap, m.heapEver, m.fps, m.tick, m.loop, m.busy, m.trig, m.dropped, m.http]
    .map((v) => (v == null ? '' : v)).join(',') + '\n');
  minute = null;
}
let monOn = true;
async function monitor() {
  const M = R.mon;
  let prev = Date.now();
  while (monOn) {
    const t = Date.now();
    if (t - prev > 30000) {
      R.pcPauses.push({ start: prev, end: t });
      log(`NOTE: this PC was asleep or paused for ${dur(t - prev)} (${stamp(prev).slice(11)} - ${stamp(t).slice(11)}): not counted against the controller`);
    }
    prev = t;
    if (minute && Math.floor(minute.t / 60000) !== Math.floor(t / 60000)) flushMinute();
    if (!minute) minute = { t, ok: 0, fail: 0 };
    const s = await S.status();
    if (!monOn) break;
    if (!minute) minute = { t, ok: 0, fail: 0 };
    M.samples++;
    if (!s) {
      M.fails++; minute.fail++;
      if (!M.outStart) M.outStart = t;
    } else {
      if (M.outStart) {
        const d = t - M.outStart;
        if (!pcPausedSince(M.outStart - 30000)) {
          M.outages++; M.longestOutMs = Math.max(M.longestOutMs, d);
          if (d > 30000) problem('FAIL', `controller did not answer for ${(d / 1000).toFixed(0)} s`);
          else if (d > 5000) problem('WARN', `controller did not answer for ${(d / 1000).toFixed(0)} s`);
        }
        M.outStart = 0;
      }
      if (M.last && s.uptime < M.last.uptime) {
        M.restarts.push({ t, started: s.started });
        problem('FAIL', `controller RESTARTED (reason it gives: "${s.started}") after ${dur(M.last.uptime)} up`);
        const lg = await S.req('GET', '/api/log', null, 15000);
        if (lg.ok) fs.writeFileSync(file(`log-after-restart-${M.restarts.length}.txt`), lg.body);
      }
      const st = s.stats, h = st.heap;
      if (M.heapStart == null) M.heapStart = h.free;
      M.heapMin = lo(M.heapMin, h.free); M.heapMinEver = lo(M.heapMinEver, h.minFree);
      M.fpsMin = lo(M.fpsMin, st.engineFps); M.tickMax = Math.max(M.tickMax, st.tickUs);
      M.udpDropped = st.udpDropped;
      const hour = Math.floor((t - startAt) / 3600000);
      M.hourHeap[hour] = lo(M.hourHeap[hour], h.free);
      minute.ok++;
      minute.uptime = Math.round(s.uptime / 1000);
      minute.heap = lo(minute.heap, h.free); minute.heapEver = h.minFree;
      minute.fps = lo(minute.fps, st.engineFps);
      minute.tick = Math.max(minute.tick || 0, st.tickUs); minute.loop = Math.max(minute.loop || 0, st.loopUs);
      minute.busy = Math.max(minute.busy || 0, st.busyUs || 0); minute.trig = Math.max(minute.trig || 0, st.trigUs || 0);
      minute.dropped = st.udpDropped; minute.http = Math.max(minute.http || 0, st.http || 0);
      M.last = s;
    }
    await S.sleep(Math.max(0, 2000 - (Date.now() - t)));
  }
}

// ---- One cycle -----------------------------------------------------------------------------
const UNIS = 8;
function checkArt(art, phase, c, t0) {
  if (pcPausedSince(t0)) { c.notes.push('PC asleep'); return; }
  const T = R.tot;
  const keys = Object.keys(art).filter((k) => k.startsWith('art'));
  if (keys.length < UNIS) problem('FAIL', `${phase}: only ${keys.length} of ${UNIS} Art-Net universes arrived on this PC`);
  for (const k of keys) {
    const u = art[k];
    T.artFpsMin = lo(T.artFpsMin, u.fps); T.artGapMax = Math.max(T.artGapMax, u.maxGapMs); T.artLate += u.late50;
    c.fpsMin = lo(c.fpsMin, u.fps); c.gapMax = Math.max(c.gapMax || 0, u.maxGapMs); c.late = (c.late || 0) + u.late50;
  }
  const worst = Math.min(...keys.map((k) => art[k].fps)), gap = Math.max(...keys.map((k) => art[k].maxGapMs));
  if (keys.length && worst < 35) problem('WARN', `${phase}: Art-Net only ${worst} fps on the slowest universe`);
  if (keys.length && gap > 2000) problem('FAIL', `${phase}: Art-Net stopped for ${gap} ms`);
  else if (keys.length && gap > 250) problem('WARN', `${phase}: Art-Net gap of ${gap} ms`);
}

async function cycle(n, cycleEnd) {
  const c = { n, t: Date.now(), notes: [] };
  const T = R.tot;
  const loadS = Math.max(10, Math.min(LOAD_S, Math.round((cycleEnd - Date.now()) / 1000) - 60));
  // Everything at once (the "all" test of stress.js).
  let t0 = Date.now();
  const [art, ui, ec, oc, ht] = await Promise.all([S.capture(loadS + 2), S.udpin(200, loadS), S.echo(50, loadS), S.osc(80, loadS), S.httpLoad(2, loadS)]);
  checkArt(art, `cycle ${n} under load`, c, t0);
  if (pcPausedSince(t0)) { c.notes.push('PC asleep'); return c; }
  T.udpSent += ui.sent; T.udpFired += ui.fired || 0; T.oscSent += oc.sent; T.oscFired += oc.fired || 0;
  T.echoSent += ec.sent; T.echoGot += ec.answered; T.echoP99Max = Math.max(T.echoP99Max, ec.rttMs.p99 || 0);
  T.httpOk += ht.ok; T.httpFail += ht.fail;
  Object.assign(c, { udpLost: ui.lostPct, oscLost: oc.lostPct, echoLost: ec.lostPct, echoP99: ec.rttMs.p99, httpPerS: ht.perS, httpFail: ht.fail });
  if (ui.fired == null || ui.lostPct > 0.5) problem('WARN', `cycle ${n}: UDP in ${ui.fired == null ? 'count unreadable' : ui.lostPct + '% lost'}`);
  if (oc.fired == null || oc.lostPct > 0.5) problem('WARN', `cycle ${n}: OSC in ${oc.fired == null ? 'count unreadable' : oc.lostPct + '% lost'}`);
  if (ec.lostPct > 0.5) problem('WARN', `cycle ${n}: UDP echo ${ec.lostPct}% unanswered`);
  // A rare timed-out request under full load is normal; only a pattern is worth a warning.
  if (ht.fail > Math.max(2, ht.ok * 0.001)) problem('WARN', `cycle ${n}: ${ht.fail} of ${ht.ok + ht.fail} web requests failed`);
  if (Date.now() >= endAt) return c;

  // Bursts out and the paced stream.
  t0 = Date.now();
  const b = await S.burst(true);
  const st = await S.stream();
  if (pcPausedSince(t0)) { c.notes.push('PC asleep'); return c; }
  T.bursts++;
  // HTTP: the controller keeps at most 16 requests waiting and refuses the rest (by design).
  const short = [['udp', 500], ['osc', 500], ['tcp', 100], ['http', 16]].filter(([k, want]) => !b[k] || b[k].got < want)
    .map(([k, want]) => `${k} ${b[k] ? b[k].got : 0}/${want}`);
  c.burst = short.length ? short.join(' ') : 'ok';
  if (short.length) { T.burstShort++; problem('WARN', `cycle ${n}: bursts short: ${short.join(', ')}`); }
  T.streams++;
  c.stream = `${st.got}/1000, max gap ${st.gapMs.max} ms`;
  if (st.got < 1000 || st.gapMs.max > 150) { T.streamShort++; problem('WARN', `cycle ${n}: stream ${c.stream}`); }

  // Once an hour: files and project byte for byte.
  if (n % Math.max(1, Math.round(CHECK_MS / CYCLE_MS)) === 0) c.check = await integrity();

  // Quiet for the rest of the cycle, lights still measured.
  const quietS = Math.round((Math.min(cycleEnd, endAt) - Date.now()) / 1000) - 2;
  if (quietS >= 10) { t0 = Date.now(); const q = await S.capture(quietS); checkArt(q, `cycle ${n} quiet`, c, t0); }
  return c;
}

let wwwBase = null, showBytes = null;
async function wwwSums() {
  const out = {};
  for (const f of fs.readdirSync(path.join(__dirname, '..', '..', 'data', 'www')).filter((x) => /\.(js|html|css)$/.test(x))) {
    const r = await getRaw('/' + f);
    out[f] = r.body && r.status === 200 ? md5(r.body) : 'error ' + (r.status || r.err);
  }
  return out;
}
async function integrity() {
  R.tot.checks++;
  const bad = [];
  const now = await wwwSums();
  for (const [f, sum] of Object.entries(wwwBase)) if (now[f] !== sum) bad.push(`web file ${f} ${now[f].startsWith('error') ? now[f] : 'came back different'}`);
  for (let k = 0; k < 3; k++) {
    const r = await getRaw('/api/project');
    if (!r.body || !r.body.equals(showBytes)) bad.push(`project download ${k + 1} ${r.body ? 'different from what was uploaded' : 'failed ' + (r.err || r.status)}`);
  }
  if (bad.length) { R.tot.checksBad++; problem('FAIL', 'data check: ' + bad.join('; ')); return 'BAD'; }
  log('hourly data check ok');
  return 'ok';
}

// ---- Report --------------------------------------------------------------------------------
const pausedMs = () => R.pcPauses.reduce((a, p) => a + p.end - p.start, 0);
function verdict(done) {
  if (R.problems.some((p) => p.level === 'FAIL')) return 'FAILED - see Problems below';
  if (pausedMs() > (Date.now() - startAt) * 0.2) return `INCOMPLETE - this PC was asleep for ${dur(pausedMs())}, so most of the night was not tested`;
  if (!done) return 'STILL RUNNING' + (R.problems.length ? ' (warnings so far)' : ' (no problems so far)');
  return R.problems.length ? 'PASSED WITH WARNINGS - see Problems below' : 'PASSED - no problems found';
}
function writeReport(done) {
  const M = R.mon, T = R.tot, I = R.info;
  const hours = Object.keys(M.hourHeap).map(Number).sort((a, b) => a - b);
  const first = hours.length ? M.hourHeap[hours[0]] : null, lastH = hours.length > 1 ? M.hourHeap[hours[hours.length - 1]] : null;
  const leak = first != null && lastH != null ? first - lastH : null;
  const leakText = leak == null ? 'not enough hours yet to judge' : leak > 10240 ? `POSSIBLE LEAK: ${kb(leak)} less free than in the first hour` : 'steady (no leak)';
  const pctLost = (sent, got) => (sent ? (100 - got / sent * 100).toFixed(2) + '%' : '-');
  const L = [];
  L.push('KD Designer - overnight stress test', '');
  L.push(`RESULT: ${verdict(done)}`, '');
  L.push(`Controller   ${IP}, firmware ${I.version || '?'} (${I.target || '?'})`);
  L.push(`This PC      ${pcIp}`);
  L.push(`Started      ${stamp(startAt)}    planned end ${stamp(endAt)}`);
  L.push(`${done ? 'Ended' : 'Last update'}  ${stamp()}  (${dur(Date.now() - startAt)}, ${R.cycles.length} cycles)`);
  L.push(`Show         "Stress test": ${UNIS} universes of RGB pixels with effects (1360 fixtures), 108 triggers`);
  L.push(`This PC asleep          ${R.pcPauses.length ? `${R.pcPauses.length} time(s), ${dur(pausedMs())} in total (not tested then)` : 'never (good)'}`);
  L.push('');
  L.push(`Restarts                ${M.restarts.length}${M.restarts.map((r) => `  [${stamp(r.t)}: ${r.started}]`).join('')}`);
  L.push(`Not answering           ${M.outages} time(s), longest ${(M.longestOutMs / 1000).toFixed(0)} s  (${M.fails} of ${M.samples} status reads failed)`);
  L.push(`Memory free             start ${kb(M.heapStart)}, lowest ${kb(M.heapMin)}, lowest ever (firmware) ${kb(M.heapMinEver)}`);
  L.push(`Memory trend            first hour ${kb(first)}, last hour ${kb(lastH)}: ${leakText}`);
  L.push(`Engine                  lowest ${M.fpsMin} fps, slowest frame ${(M.tickMax / 1000).toFixed(1)} ms`);
  L.push(`Lights (Art-Net here)   lowest ${T.artFpsMin} fps, longest gap ${T.artGapMax} ms, ${T.artLate} frames more than 50 ms late`);
  L.push(`UDP in                  ${T.udpSent} sent, ${pctLost(T.udpSent, T.udpFired)} lost`);
  L.push(`OSC in                  ${T.oscSent} sent, ${pctLost(T.oscSent, T.oscFired)} lost`);
  L.push(`UDP echo                ${T.echoSent} sent, ${pctLost(T.echoSent, T.echoGot)} unanswered, worst p99 round trip ${T.echoP99Max} ms`);
  L.push(`Receive queue full      ${M.udpDropped} messages dropped (since the controller started)`);
  L.push(`Web API                 ${T.httpOk} requests ok, ${T.httpFail} failed`);
  L.push(`Bursts out              ${T.bursts} rounds, ${T.burstShort} short;  paced stream ${T.streams} rounds, ${T.streamShort} short`);
  L.push(`Hourly data checks      ${T.checks} done, ${T.checksBad} bad`);
  L.push(`Original project        ${R.restored == null ? (done ? 'left on the controller? see events.log' : 'will be put back at the end') : R.restored}`);
  L.push('', `Problems (${R.problems.length})`);
  if (!R.problems.length) L.push('  none');
  for (const p of R.problems.slice(0, 100)) L.push(`  ${stamp(p.t).slice(11)}  ${p.level}  ${p.text}`);
  if (R.problems.length > 100) L.push(`  ... ${R.problems.length - 100} more in events.log`);
  L.push('', 'Cycles (fps / gap = Art-Net arriving on this PC; lost = UDP/OSC/echo %)');
  L.push('  #   time   fps  gap ms  late  lost udp/osc/echo  echo p99  web/s  bursts / stream / check');
  for (const c of R.cycles) {
    L.push(`  ${String(c.n).padStart(3)} ${stamp(c.t).slice(11, 16)}  ${String(c.fpsMin ?? '-').padStart(4)} ${String(c.gapMax ?? '-').padStart(6)} ${String(c.late ?? '-').padStart(5)}` +
           `  ${(c.udpLost == null ? '-' : `${c.udpLost}/${c.oscLost}/${c.echoLost}`).padStart(17)} ${String(c.echoP99 ?? '-').padStart(8)} ${String(c.httpPerS ?? '-').padStart(6)}  ${c.burst || '-'} / ${c.stream || '-'}${c.check ? ' / ' + c.check : ''}${c.notes.length ? '  (' + [...new Set(c.notes)].join(', ') + ')' : ''}`);
  }
  L.push('', 'Per-minute controller figures: minutes.csv (opens in Excel). Everything that happened: events.log.');
  fs.writeFileSync(file('report.txt'), L.join('\r\n') + '\r\n');
}

// ---- Run -----------------------------------------------------------------------------------
let backup = null, restoring = false;
async function restore() {
  if (restoring || !backup || args.includes('--keep')) { if (args.includes('--keep')) R.restored = 'not put back (--keep)'; return; }
  restoring = true;
  log('putting the original project back...');
  for (let k = 0; k < 5; k++) {
    const r = await S.req('PUT', '/api/project', backup.toString(), 120000);
    if (r.ok) { R.restored = 'put back ok'; log('original project put back'); return; }
    log(`put back failed (${r.status || r.err}), retry in 20 s`);
    await S.sleep(20000);
  }
  R.restored = `NOT put back - do it by hand: node tools/stress/stress.js ${IP} load "${file('backup-project.json')}"`;
  log(R.restored);
}
async function finish(why) {
  monOn = false;
  log(`stopping: ${why}`);
  flushMinute();
  await restore();
  writeReport(true);
  log(`report: ${file('report.txt')}`);
  console.log('\n' + fs.readFileSync(file('report.txt'), 'utf8').split('\r\n').slice(0, 24).join('\n'));
  process.exit(0);
}
let stopping = false;
process.on('SIGINT', () => { if (!stopping) { stopping = true; finish('stopped by hand (Ctrl+C)'); } });
// A bug in this tool must not leave the stress show on the controller.
process.on('uncaughtException', (e) => {
  try { log(`test tool error: ${e.stack || e}`); } catch (x) {}
  if (!stopping) { stopping = true; finish('test tool error'); }
});

(async () => {
  log(`soak test: controller ${IP}, PC ${pcIp}, until ${stamp(endAt)}, results in ${OUT}`);
  const s0 = await S.status();
  if (!s0) { log('controller not reachable - nothing done'); process.exit(1); }
  R.info = { version: s0.version, target: s0.update && s0.update.target, project: s0.project };
  log(`controller runs "${s0.project}", firmware ${s0.version}, up ${dur(s0.uptime)}`);

  const b = await getRaw('/api/project');
  if (!b.body || b.status !== 200) { log('could not back up the project - nothing done'); process.exit(1); }
  try { JSON.parse(b.body.toString()); } catch (e) { log('backup is not valid JSON - nothing done'); process.exit(1); }
  backup = b.body;
  fs.writeFileSync(file('backup-project.json'), backup);
  log(`backed up "${s0.project}" (${kb(backup.length)}) to backup-project.json`);

  execFileSync(process.execPath, [path.join(__dirname, 'make-stress.js'), file('stress-show.json'), '--pc', pcIp], { stdio: 'inherit' });
  showBytes = fs.readFileSync(file('stress-show.json'));
  const up = await S.req('PUT', '/api/project', showBytes.toString(), 120000);
  if (!up.ok) { log(`upload of the stress show failed: ${up.status || up.err} ${(up.body || '').slice(0, 200)}`); await restore(); process.exit(1); }
  log(`stress show loaded (${(up.ms / 1000).toFixed(1)} s)`);
  await S.sleep(15000);   // Startup trigger, timelines running
  const s1 = await S.status();
  if (!s1 || s1.project !== 'Stress test') log(`WARNING: controller reports project "${s1 && s1.project}"`);

  wwwBase = await wwwSums();
  const local = path.join(__dirname, '..', '..', 'data', 'www');
  const diff = Object.keys(wwwBase).filter((f) => { try { return md5(fs.readFileSync(path.join(local, f))) !== wwwBase[f]; } catch (e) { return true; } });
  log(diff.length ? `note: stick web files differ from data/www (older stick?): ${diff.join(', ')} - compared to themselves from now on` : 'web files on the stick match data/www');

  S.tcpServer();   // open all night, so the show's TCP device stays connected
  const awake = keepAwake();
  process.on('exit', () => { try { awake && awake.kill(); } catch (e) {} });
  monitor();
  writeReport(false);
  let n = 0;
  while (Date.now() < endAt - 60000 && !stopping) {
    n++;
    const cEnd = Date.now() + CYCLE_MS;
    try {
      const c = await cycle(n, cEnd);
      R.cycles.push(c);
      fs.appendFileSync(file('cycles.csv'), (n === 1 ? 'cycle,time,art_fps_min,art_gap_ms,late,udp_lost,osc_lost,echo_lost,echo_p99,web_per_s,bursts,stream,check\n' : '') +
        [c.n, stamp(c.t), c.fpsMin, c.gapMax, c.late, c.udpLost, c.oscLost, c.echoLost, c.echoP99, c.httpPerS, c.burst, c.stream, c.check || ''].map((v) => `"${v ?? ''}"`).join(',') + '\n');
      if (c.notes.includes('PC asleep')) log(`cycle ${n} not judged: this PC was asleep`);
      else log(`cycle ${n} done: Art-Net min ${c.fpsMin} fps, lost ${c.udpLost}/${c.oscLost}/${c.echoLost} %, bursts ${c.burst}`);
    } catch (e) {
      problem('WARN', `cycle ${n}: test tool error ${e.message}`);
      await S.sleep(30000);
    }
    if (!stopping) writeReport(false);
  }
  if (!stopping) { stopping = true; await finish('planned end reached'); }
})();
