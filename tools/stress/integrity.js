// Data integrity check after firmware changes that touch memory / caching / the network:
//   node tools/stress/integrity.js <controller-ip> [project.json-to-upload]
// - every web UI file from the controller vs data/www (gzip-decoded), several rounds
// - /api/project download several times (all identical), optional upload + download = same bytes
// - Art-Net packets: right size, header, sequence numbers counting
'use strict';
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const crypto = require('crypto');

const IP = process.argv[2];
const UPLOAD = process.argv[3];
const WWW = path.join(__dirname, '..', '..', 'data', 'www');
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');

function get(p, method = 'GET', body = null) {
  return new Promise((resolve) => {
    const r = http.request({ host: IP, path: p, method, timeout: 30000, agent: false, headers: Object.assign({ 'Accept-Encoding': 'gzip' }, body ? { 'Content-Length': body.length } : {}) }, (res) => {
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => {
        let b = Buffer.concat(c);
        try { if (res.headers['content-encoding'] === 'gzip') b = zlib.gunzipSync(b); } catch (e) { return resolve({ status: res.statusCode, err: 'bad gzip: ' + e.message }); }
        resolve({ status: res.statusCode, body: b });
      });
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', (e) => resolve({ err: e.message }));
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  let bad = 0;
  const files = fs.readdirSync(WWW).filter((f) => /\.(js|html|css)$/.test(f));
  for (let round = 0; round < 3; round++) {
    for (const f of files) {
      const r = await get('/' + f);
      const want = fs.readFileSync(path.join(WWW, f));
      if (r.err || r.status !== 200) { console.log(`www ${f}: ${r.status || ''} ${r.err || ''}`); bad++; continue; }
      if (!r.body.equals(want)) { console.log(`www ${f}: DIFFERENT (${r.body.length} vs ${want.length} bytes) - stick older than data/www?`); bad++; }
    }
  }
  console.log(`www: ${files.length} files x 3 rounds checked`);

  const sums = new Set();
  for (let k = 0; k < 4; k++) { const r = await get('/api/project'); if (r.body) sums.add(md5(r.body)); else { console.log('project GET failed', r.err); bad++; } }
  console.log(`project GET x4: ${sums.size} distinct ${sums.size === 1 ? '(ok)' : '(BAD)'}`);
  if (sums.size > 1) bad++;
  if (UPLOAD) {
    const body = fs.readFileSync(UPLOAD);
    const t0 = Date.now();
    const r = await get('/api/project', 'PUT', body);
    console.log(`upload ${body.length} bytes: ${r.status} ${(r.body || r.err || '').toString().slice(0, 100)} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const back = await get('/api/project');
    const same = back.body && back.body.equals(body);
    console.log(`download after upload: ${same ? 'identical (ok)' : 'DIFFERENT (BAD)'}`);
    if (!same) bad++;
  }

  // Art-Net: 3 s of packets, check size, header and sequence per universe.
  const seq = {}; let pkts = 0, wrong = 0, seqJumps = 0;
  const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  s.on('message', (m, ri) => {
    if (ri.address !== IP) return;
    pkts++;
    if (m.length !== 530 || m.toString('latin1', 0, 8) !== 'Art-Net\0' || m.readUInt16LE(8) !== 0x5000 || m.readUInt16BE(16) !== 512) { wrong++; return; }
    const u = m[14] | (m[15] << 8), q = m[12];
    if (seq[u] != null && q !== ((seq[u] % 255) + 1)) seqJumps++;
    seq[u] = q;
  });
  s.bind(6454);
  await new Promise((r) => setTimeout(r, 3000));
  s.close();
  console.log(`art-net: ${pkts} packets, ${wrong} malformed, ${seqJumps} sequence jumps (lost/late), universes ${Object.keys(seq).join(',')}`);
  if (wrong) bad++;
  console.log(bad ? `${bad} PROBLEM(S)` : 'ALL OK');
})();
