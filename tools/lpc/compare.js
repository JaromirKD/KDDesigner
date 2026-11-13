// Measures a Pharos LPC and a KD Designer controller the same way, from outside: both send
// Art-Net universe 0 to this PC and are told what to do over their web API.
//   node tools/lpc/compare.js kd <ip>      the KD with tools/lpc/compare/project.json loaded
//   node tools/lpc/compare.js lpc <ip>     the LPC with the test project: scenes "All On" /
//                                          "All Off", timeline "Rainbow", triggers 1 release all
//                                          in 10 s, 2 rainbow, 3 all on, 4 all off
// With --udp also over UDP port 4000 (this PC listens on 4000 too): the LPC's Ethernet Input
// triggers "pong" (sends "pong" back to this PC, port 4000) and "off" (release all in 2 s);
// on the KD "PING" (reply PONG) and "REL2" (release all fade 2).
// Options: --n <times> snaps (default 60), --uni <art-net universe> (default 0).
// Close the KD launcher first: it also listens on the Art-Net port and then gets the packets.
// Prints a table and one JSON line (for PHAROS-COMPARISON-PLAN.md section 5).
'use strict';
const dgram = require('dgram');
const http = require('http');

const [KIND, IP] = process.argv.slice(2);
const opt = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? +process.argv[i + 1] : def; };
const N = opt('n', 60), UNI = opt('uni', 0), UDP = process.argv.includes('--udp');
const WORD = KIND === 'lpc' ? { echo: 'pong', back: /^pong/, off: 'off' } : { echo: 'PING', back: /^PONG/, off: 'REL2' };
if (!['kd', 'lpc'].includes(KIND) || !IP) { console.error('usage: compare.js kd|lpc <ip> [--n 60] [--uni 0]'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Number(process.hrtime.bigint()) / 1e6;
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(1); };
const avg = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null);

// One keep-alive connection, like a browser or a show controller would use.
const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
function req(method, path, body, type) {
  return new Promise((resolve) => {
    const t0 = now();
    const headers = body ? { 'Content-Length': Buffer.byteLength(body), 'Content-Type': type || 'text/plain' } : {};
    const r = http.request({ host: IP, path, method, agent, timeout: 8000, headers }, (res) => {
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, sent: t0, ms: now() - t0, body: Buffer.concat(c).toString() }));
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', (e) => resolve({ status: 0, sent: t0, ms: now() - t0, body: e.message }));
    if (body) r.write(body);
    r.end();
  });
}
// The same four actions on both controllers.
const lpcTrig = (num) => req('POST', '/api/trigger', JSON.stringify({ num }), 'application/json');
const kdCmd = (line) => req('POST', '/api/cmd', line);
const DO = KIND === 'lpc'
  ? { on: () => lpcTrig(3), off: () => lpcTrig(4), release10: () => lpcTrig(1), rainbow: () => lpcTrig(2), ping: () => req('GET', '/api/system'), init: async () => {} }
  : { on: () => kdCmd('scene Full'), off: () => kdCmd('scene Off'), release10: () => kdCmd('release all fade 10'),
      rainbow: () => kdCmd('start timeline "Rainbow (S4)"'), ping: () => req('GET', '/api/status'),
      init: () => kdCmd('release all') };   // the show's Startup trigger starts the rainbow: it would run under the scenes and spoil the fade

// Art-Net frames from this controller only: [time ms, 512 values].
const frames = [];
const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
sock.on('message', (b, r) => {
  if (r.address !== IP || b.length < 19 || b.toString('ascii', 0, 7) !== 'Art-Net' || b.readUInt16LE(8) !== 0x5000 || b.readUInt16LE(14) !== UNI) return;
  frames.push([now(), Buffer.from(b.subarray(18))]);
});
const since = (t) => frames.filter((f) => f[0] >= t);
function rate(list) {
  if (list.length < 3) return { fps: 0 };
  const gaps = []; let changed = 0;
  for (let i = 1; i < list.length; i++) { gaps.push(list[i][0] - list[i - 1][0]); if (!list[i][1].equals(list[i - 1][1])) changed++; }
  const secs = (list[list.length - 1][0] - list[0][0]) / 1000;
  return { fps: +((list.length - 1) / secs).toFixed(1), newFps: +(changed / secs).toFixed(1), gapMed: pct(gaps, 50), gap99: pct(gaps, 99), gapMax: +Math.max(...gaps).toFixed(1) };
}

(async () => {
  await new Promise((r) => sock.bind(6454, r));
  const out = { controller: KIND, ip: IP };
  await DO.init(); await sleep(300);
  await DO.off(); await sleep(1500);
  if (!since(now() - 1400).length) { console.error(`No Art-Net universe ${UNI} from ${IP} on this PC (is the launcher or another Art-Net program open? does it send to this PC?)`); process.exit(1); }

  // 1. Output while nothing changes.
  let t = now(); await sleep(8000);
  out.idle = rate(since(t));

  // 2. Snap: request sent -> first frame that differs. Random gaps so it lands anywhere in a frame.
  const lat = [], reqMs = []; let missed = 0;
  for (let i = 0; i < N; i++) {
    const before = frames[frames.length - 1][1];
    const r = await (i % 2 ? DO.off() : DO.on());
    reqMs.push(r.ms);
    let hit = null;
    for (let w = 0; w < 100 && !hit; w++) { hit = frames.find((f) => f[0] > r.sent && !f[1].equals(before)); if (!hit) await sleep(10); }
    if (hit) lat.push(hit[0] - r.sent); else missed++;
    await sleep(350 + Math.random() * 100);
  }
  out.snap = { n: N, missed, median: pct(lat, 50), avg: avg(lat), p95: pct(lat, 95), max: pct(lat, 100), min: pct(lat, 0), requestMedian: pct(reqMs, 50) };
  // How a snap arrives: in one frame, or over several (a default fade)?
  await DO.off(); await sleep(1500);
  t = now(); await DO.on(); await sleep(3000);
  const ramp = since(t).map((f) => f[1][0]).filter((v, i, a) => i === 0 || v !== a[i - 1]);
  out.snapShape = ramp.length <= 2 ? 'one frame' : `${ramp.length - 1} steps (${ramp.slice(0, 8).join(' ')}…)`;

  // 3. Fade: full -> released in 10 s. Channel 1's values on the way down.
  await DO.on(); await sleep(3500);
  t = now(); await DO.release10(); await sleep(12500);
  const fade = since(t).map((f) => [f[0] - t, f[1][0]]);
  const first = fade.find((f) => f[1] < 255), last = fade.find((f) => f[1] === 0);
  const vals = fade.filter((f) => first && f[0] >= first[0] && (!last || f[0] <= last[0])).map((f) => f[1]);
  let biggest = 0, back = 0;
  for (let i = 1; i < vals.length; i++) { biggest = Math.max(biggest, vals[i - 1] - vals[i]); if (vals[i] > vals[i - 1]) back++; }
  out.fade = { startsAfterMs: first ? +first[0].toFixed(0) : null, lengthS: first && last ? +((last[0] - first[0]) / 1000).toFixed(2) : null,
               levels: new Set(vals).size, frames: vals.length, biggestStep: biggest, stepsBack: back };

  // 4. Rainbow over 170 pixels: how many frames a second, and how many of them are new.
  await DO.rainbow(); await sleep(2500);
  t = now(); await sleep(10000);
  out.rainbow = rate(since(t));

  // 5. Web API answer time while the rainbow runs.
  const ping = [];
  for (let i = 0; i < 30; i++) { ping.push((await DO.ping()).ms); await sleep(100); }
  out.api = { median: pct(ping, 50), max: pct(ping, 100) };

  if (UDP) {
    const u = dgram.createSocket('udp4'); let back = [];
    u.on('message', (b, r) => { if (r.address === IP && WORD.back.test(b.toString())) back.push(now()); });
    await new Promise((r) => u.bind(4000, r));
    // 6. UDP in -> light: all on, then the "release in 2 s" word; time to the first frame that moves.
    const ulat = []; let umiss = 0;
    for (let i = 0; i < 30; i++) {
      await DO.on(); await sleep(700 + Math.random() * 100);
      const before = frames[frames.length - 1][1], t0 = now();
      u.send(WORD.off, 4000, IP);
      let hit = null;
      for (let w = 0; w < 100 && !hit; w++) { hit = frames.find((f) => f[0] > t0 && !f[1].equals(before)); if (!hit) await sleep(10); }
      if (hit) ulat.push(hit[0] - t0); else umiss++;
      await sleep(2300);
    }
    out.udpLight = { n: 30, missed: umiss, median: pct(ulat, 50), p95: pct(ulat, 95), max: pct(ulat, 100), min: pct(ulat, 0) };
    // 7. Round trip: one message at a time, 100 times.
    const rt = []; let lost = 0;
    for (let i = 0; i < 100; i++) {
      back = []; const t0 = now(); u.send(WORD.echo, 4000, IP);
      for (let w = 0; w < 250 && !back.length; w++) await sleep(2);
      if (back.length) rt.push(back[0] - t0); else lost++;
      await sleep(40 + Math.random() * 30);
    }
    out.roundTrip = { n: 100, lost, median: pct(rt, 50), p95: pct(rt, 95), max: pct(rt, 100), min: pct(rt, 0) };
    // 8. Load: evenly paced messages for 3 s per rate; how many come back, and the output meanwhile.
    out.load = [];
    for (const perS of [10, 50, 100, 200, 500]) {
      back = []; const total = perS * 3, t0 = now();
      for (let i = 0; i < total; i++) {
        u.send(WORD.echo, 4000, IP);
        const due = t0 + ((i + 1) * 1000) / perS;
        while (now() < due) await (due - now() > 4 ? sleep(1) : new Promise(setImmediate));
      }
      await sleep(1000);
      const r = rate(since(t0).filter((f) => f[0] < t0 + 3000));
      out.load.push({ perS, answered: +((back.length / total) * 100).toFixed(1), fps: r.fps, gapMax: r.gapMax });
      await sleep(1500);
    }
    u.close();
  }
  await DO.off();
  sock.close(); agent.destroy();
  const row = (k, v) => console.log(k.padEnd(34), v);
  console.log(`\n${KIND.toUpperCase()} at ${IP}`);
  row('Idle: frames/s', `${out.idle.fps}  (gap median ${out.idle.gapMed} ms, 99% ${out.idle.gap99}, worst ${out.idle.gapMax})`);
  row('Rainbow: frames/s', `${out.rainbow.fps}, of which new ${out.rainbow.newFps}  (gap median ${out.rainbow.gapMed} ms, 99% ${out.rainbow.gap99}, worst ${out.rainbow.gapMax})`);
  row('Snap: request -> light (ms)', `median ${out.snap.median}, average ${out.snap.avg}, 95% ${out.snap.p95}, fastest ${out.snap.min}, slowest ${out.snap.max}${missed ? `, ${missed} MISSED` : ''}`);
  row('Snap arrives as', out.snapShape);
  row('Snap: web request answered (ms)', `median ${out.snap.requestMedian}`);
  row('10 s fade', `starts after ${out.fade.startsAfterMs} ms, takes ${out.fade.lengthS} s, ${out.fade.levels} levels in ${out.fade.frames} frames, biggest step ${out.fade.biggestStep}, steps back ${out.fade.stepsBack}`);
  row('Web API answer (ms)', `median ${out.api.median}, slowest ${out.api.max}`);
  if (UDP) {
    row('UDP in -> light moves (ms)', `median ${out.udpLight.median}, 95% ${out.udpLight.p95}, fastest ${out.udpLight.min}, slowest ${out.udpLight.max}${out.udpLight.missed ? `, ${out.udpLight.missed} MISSED` : ''}`);
    row('UDP round trip (ms)', `median ${out.roundTrip.median}, 95% ${out.roundTrip.p95}, slowest ${out.roundTrip.max}, lost ${out.roundTrip.lost} of 100`);
    for (const l of out.load) row(`UDP load ${l.perS}/s for 3 s`, `${l.answered} % answered; output ${l.fps} frames/s, worst gap ${l.gapMax} ms`);
  }
  console.log(JSON.stringify(out));
})();
