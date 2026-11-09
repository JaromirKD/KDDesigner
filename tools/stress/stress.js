// Stress / limits test against a real controller running a show from make-stress.js.
//   node tools/stress/stress.js <controller-ip> <test> [args]
// Tests:
//   status                      engine / network / memory figures from /api/status
//   load <project.json>         uploads a project (replaces the one on the stick!)
//   art [s]                     Art-Net + sACN received on this PC: fps, gaps per universe
//   udpin <pkts/s> [s]          UDP "A<k> <n>" to port 4000 (10 counting triggers): how many fired
//   echo <pkts/s> [s]           UDP "E <n>" -> "reply": round-trip time and losses
//   osc <pkts/s> [s]            OSC /stress/<n> to port 8000
//   burst                       fires the Burst UDP/OSC/TCP/HTTP triggers, counts what arrives here
//   stream                      fires "Stream UDP" (1000 x every 10 ms), measures the pacing
//   http <parallel> [s]         GET /api/status from several clients at once: latency, failures
//   all [s]                     art + udpin + echo + osc + http at the same time
// Prints one JSON line per test at the end (for the results table).
'use strict';
const dgram = require('dgram');
const http = require('http');
const net = require('net');

const [IP, TEST, A1, A2] = process.argv.slice(2);
if (!IP || !TEST) { console.error('usage: stress.js <ip> <test> [args]'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))].toFixed(1); };
const nowMs = () => Number(process.hrtime.bigint()) / 1e6;

function req(method, path, body, timeout = 8000) {
  return new Promise((resolve) => {
    const t0 = nowMs();
    const r = http.request({ host: IP, port: 80, path, method, timeout, agent: false,
                             headers: body ? { 'Content-Length': Buffer.byteLength(body) } : {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode, ms: nowMs() - t0, body: Buffer.concat(chunks).toString() }));
      res.on('error', (e) => resolve({ ok: false, err: e.message, ms: nowMs() - t0 }));
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', (e) => resolve({ ok: false, err: e.message, ms: nowMs() - t0 }));
    if (body) r.write(body);
    r.end();
  });
}
async function status() {
  const r = await req('GET', '/api/status');
  if (!r.ok) return null;
  try { return JSON.parse(r.body); } catch (e) { return null; }
}
const cmd = (line) => req('POST', '/api/cmd', line);
const brief = (s) => s && ({ fps: s.stats.engineFps, artTx: s.stats.artTx, sacnTx: s.stats.sacnTx, udpRx: s.stats.udpRx,
  tickUs: s.stats.tickUs, loopUs: s.stats.loopUs, heapFree: s.stats.heap.free, heapMin: s.stats.heap.minFree,
  vars: s.vars, uptime: s.uptime });

// Samples /api/status once a second while a test runs (one extra light request/s).
function sampler() {
  const samples = [];
  let on = true;
  (async () => { while (on) { const t = nowMs(); const s = await status(); if (s) samples.push(brief(s)); await sleep(Math.max(0, 1000 - (nowMs() - t))); } })();
  return { stop() { on = false; return samples; } };
}
function summarize(samples) {
  const f = (k) => samples.map((s) => s[k]).filter((v) => v != null);
  return { samples: samples.length, fpsMin: Math.min(...f('fps')), artTxMin: Math.min(...f('artTx')), tickUsMax: Math.max(...f('tickUs')),
           loopUsMax: Math.max(...f('loopUs')), heapFreeMin: Math.min(...f('heapFree')), heapMinEver: Math.min(...f('heapMin')) };
}

// ---- Art-Net / sACN capture ---------------------------------------------------------------
function capture(seconds) {
  return new Promise((resolve) => {
    const unis = {};
    const seen = (key, t) => {
      const u = unis[key] || (unis[key] = { n: 0, first: t, last: t, maxGap: 0, gaps: [] });
      if (u.n) { const g = t - u.last; u.gaps.push(g); if (g > u.maxGap) u.maxGap = g; }
      u.n++; u.last = t;
    };
    const art = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    art.on('message', (m, ri) => {
      if (ri.address !== IP || m.length < 18 || m.toString('latin1', 0, 7) !== 'Art-Net' || m.readUInt16LE(8) !== 0x5000) return;
      seen('art' + (m[14] | (m[15] << 8)), nowMs());
    });
    art.bind(6454);
    const sacn = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sacn.on('message', (m, ri) => { if (ri.address === IP && m.length >= 126) seen('sacn' + m.readUInt16BE(113), nowMs()); });
    // Join on the adapter that reaches the controller (a PC with WSL / Wi-Fi has several).
    const ifc = Object.values(require('os').networkInterfaces()).flat()
      .find((a) => a.family === 'IPv4' && a.address.split('.').slice(0, 3).join('.') === IP.split('.').slice(0, 3).join('.'));
    sacn.bind(5568, () => { for (let u = 901; u <= 916; u++) try { sacn.addMembership(`239.255.${u >> 8}.${u & 255}`, ifc && ifc.address); } catch (e) {} });
    setTimeout(() => {
      art.close(); sacn.close();
      const res = {};
      for (const [k, u] of Object.entries(unis)) {
        const dur = (u.last - u.first) / 1000;
        res[k] = { fps: +(dur > 0 ? (u.n - 1) / dur : 0).toFixed(1), maxGapMs: +u.maxGap.toFixed(0), p99GapMs: pct(u.gaps, 99), late50: u.gaps.filter((g) => g > 50).length };
      }
      resolve(res);
    }, seconds * 1000);
  });
}

// ---- UDP / OSC senders ---------------------------------------------------------------------
// Sends at `rate` per second in 5 ms batches (Windows timers aren't finer).
async function pace(rate, seconds, sendOne) {
  const total = Math.round(rate * seconds);
  const t0 = nowMs();
  let sent = 0;
  while (sent < total) {
    const due = Math.min(total, Math.floor((nowMs() - t0) / 1000 * rate) + 1);
    while (sent < due) sendOne(sent++);
    await sleep(5);
  }
  return { sent, secs: (nowMs() - t0) / 1000 };
}
function oscPacket(addr, arg) {
  const pad = (b) => Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]);
  const a = Buffer.alloc(4); a.writeInt32BE(arg);
  return Buffer.concat([pad(Buffer.from(addr)), pad(Buffer.from(',i')), a]);
}
const varOf = async (name) => { const s = await status(); return s && s.vars ? +s.vars[name] || 0 : null; };

async function udpin(rate, seconds) {
  await cmd('var hits = 0');
  const sock = dgram.createSocket('udp4');
  const r = await pace(rate, seconds, (n) => sock.send(`A${n % 10} ${n}`, 4000, IP));
  await sleep(1500);
  sock.close();
  const hits = await varOf('hits');
  return { test: 'udpin', rate, sent: r.sent, fired: hits, lostPct: +(100 - hits / r.sent * 100).toFixed(1), firedPerS: +(hits / r.secs).toFixed(0) };
}
async function osc(rate, seconds) {
  await cmd('var osc = 0');
  const sock = dgram.createSocket('udp4');
  const r = await pace(rate, seconds, (n) => sock.send(oscPacket('/stress/' + (n % 10), n), 8000, IP));
  await sleep(1500);
  sock.close();
  const got = await varOf('osc');
  return { test: 'osc', rate, sent: r.sent, fired: got, lostPct: +(100 - got / r.sent * 100).toFixed(1) };
}
async function echo(rate, seconds) {
  const sock = dgram.createSocket('udp4');
  const sentAt = new Map(), rtts = [];
  sock.on('message', (m) => { const n = +m.toString().slice(2); const t = sentAt.get(n); if (t != null) { rtts.push(nowMs() - t); sentAt.delete(n); } });
  await new Promise((r) => sock.bind(0, r));
  const r = await pace(rate, seconds, (n) => { sentAt.set(n, nowMs()); sock.send('E ' + n, 4000, IP); });
  await sleep(2000);
  sock.close();
  return { test: 'echo', rate, sent: r.sent, answered: rtts.length, lostPct: +(100 - rtts.length / r.sent * 100).toFixed(1),
           rttMs: { p50: pct(rtts, 50), p90: pct(rtts, 90), p99: pct(rtts, 99), max: pct(rtts, 100) } };
}

// ---- Bursts out ----------------------------------------------------------------------------
function listenUdp(port) {
  const s = dgram.createSocket('udp4');
  const got = { n: 0, first: 0, last: 0 };
  s.on('message', () => { const t = nowMs(); if (!got.n) got.first = t; got.last = t; got.n++; });
  s.bind(port);
  return { got, close: () => s.close() };
}
async function fire(name) { const t0 = nowMs(); const r = await cmd(`fire trigger "${name}"`); return { ok: r.ok, ms: +(nowMs() - t0).toFixed(0), reply: (r.body || r.err || '').slice(0, 120) }; }
const span = (g) => g.n > 1 ? +(g.last - g.first).toFixed(0) : 0;

async function burst() {
  const u = listenUdp(9001), o = listenUdp(9002);
  const tcp = { n: 0, conns: 0, first: 0, last: 0 };
  const ts = net.createServer((c) => { tcp.conns++; c.on('data', (d) => { const t = nowMs(); if (!tcp.n) tcp.first = t; tcp.last = t; tcp.n += d.toString().split('\n').filter(Boolean).length; }); c.on('error', () => {}); }).listen(9100);
  const h = { n: 0, first: 0, last: 0 };
  const hs = http.createServer((q, s) => { const t = nowMs(); if (!h.n) h.first = t; h.last = t; h.n++; s.end('ok'); }).listen(9200);
  await sleep(6000);   // TCP device reconnects every few s: let it connect first
  const res = { test: 'burst' };
  res.udp = await fire('Burst UDP'); await sleep(1500); res.udp.got = u.got.n; res.udp.spanMs = span(u.got);
  res.osc = await fire('Burst OSC'); await sleep(1500); res.osc.got = o.got.n; res.osc.spanMs = span(o.got);
  res.tcp = await fire('Burst TCP'); await sleep(3000); res.tcp.got = tcp.n; res.tcp.spanMs = tcp.n > 1 ? +(tcp.last - tcp.first).toFixed(0) : 0; res.tcp.conns = tcp.conns;
  res.http = await fire('Burst HTTP'); await sleep(15000); res.http.got = h.n; res.http.spanMs = h.n > 1 ? +(h.last - h.first).toFixed(0) : 0;
  u.close(); o.close(); ts.close(); hs.close();
  return res;
}
async function stream() {
  const s = dgram.createSocket('udp4');
  const times = [];
  s.on('message', () => times.push(nowMs()));
  s.bind(9001);
  const f = await fire('Stream UDP');
  await sleep(13000);
  s.close();
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  return { test: 'stream', fire: f, got: times.length, secs: times.length > 1 ? +((times[times.length - 1] - times[0]) / 1000).toFixed(2) : 0,
           gapMs: { p50: pct(gaps, 50), p99: pct(gaps, 99), max: pct(gaps, 100) } };
}

// ---- Web API load --------------------------------------------------------------------------
async function httpLoad(parallel, seconds) {
  const lat = [];
  let fail = 0;
  const end = nowMs() + seconds * 1000;
  const worker = async () => { while (nowMs() < end) { const r = await req('GET', '/api/status', null, 5000); if (r.ok) lat.push(r.ms); else fail++; } };
  await Promise.all(Array.from({ length: parallel }, worker));
  return { test: 'http', parallel, ok: lat.length, fail, perS: +(lat.length / seconds).toFixed(1), ms: { p50: pct(lat, 50), p90: pct(lat, 90), p99: pct(lat, 99), max: pct(lat, 100) } };
}

async function withStats(name, fn) {
  const before = brief(await status());
  const sm = sampler();
  const res = await fn();
  const after = brief(await status());
  res.board = summarize(sm.stop());
  res.board.restarted = before && after ? after.uptime < before.uptime : 'unknown';
  console.log(JSON.stringify(Object.assign({ test: name }, res)));
}

(async () => {
  const secs = (v, d) => (v ? +v : d);
  switch (TEST) {
    case 'status': console.log(JSON.stringify(brief(await status()), null, 1)); break;
    case 'load': {
      const body = require('fs').readFileSync(A1, 'utf8');
      const r = await req('PUT', '/api/project', body, 60000);
      console.log(r.status, (r.body || r.err || '').slice(0, 300), (r.ms / 1000).toFixed(1) + ' s');
      break;
    }
    case 'art': await withStats('art', async () => ({ unis: await capture(secs(A1, 10)) })); break;
    case 'udpin': await withStats('udpin', () => udpin(+A1, secs(A2, 5))); break;
    case 'echo': await withStats('echo', () => echo(+A1, secs(A2, 5))); break;
    case 'osc': await withStats('osc', () => osc(+A1, secs(A2, 5))); break;
    case 'burst': await withStats('burst', burst); break;
    case 'stream': await withStats('stream', stream); break;
    case 'http': await withStats('http', () => httpLoad(+A1, secs(A2, 10))); break;
    case 'all': {
      const s = secs(A1, 10);
      await withStats('all', async () => {
        const [art, ui, ec, oc, ht] = await Promise.all([capture(s + 2), udpin(200, s), echo(50, s), osc(100, s), httpLoad(2, s)]);
        return { art, udpin: ui, echo: ec, osc: oc, http: ht };
      });
      break;
    }
    default: console.error('unknown test ' + TEST); process.exit(1);
  }
})();
