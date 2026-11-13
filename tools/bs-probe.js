// node tools/bs-probe.js <player ip> [port 5010] [message] [ms]: says "kd hello" to a BrightSign's
// kdlink plugin from this PC and prints what comes back (the mock never talks to a real player).
const dgram = require('dgram');
const ip = process.argv[2], port = +(process.argv[3] || 5010), msg = process.argv[4] || 'kd\thello';
const s = dgram.createSocket('udp4');
let n = 0;
s.on('message', (b, r) => { n++; console.log(`${r.address}:${r.port} ${b.toString().slice(0, 300)}`); });
s.bind(() => {
  console.log('local port', s.address().port);
  s.send(msg, port, ip, (e) => e && console.log('send error', e.message));
});
setTimeout(() => { console.log(n + ' packets'); s.close(); }, +(process.argv[5] || 3000));
