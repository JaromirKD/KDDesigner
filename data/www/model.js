// Project rules shared by the web UI (app-*.js) and tools/mock-server.js. The firmware has
// the same rules in src/ShowParse.cpp - keep them in step.
(function (root) {
  'use strict';
  // Fixture channels: "dim" is one DMX slot, "pos:16" a 16-bit coarse/fine pair.
  function slots(f) {
    let off = 0;
    return (f.channels || []).map((c) => {
      const wide = /:16$/.test(c);
      const s = { name: c.replace(/:16$/, ''), offset: off, wide };
      off += wide ? 2 : 1;
      return s;
    });
  }
  const footprint = (f) => slots(f).reduce((n, s) => n + (s.wide ? 2 : 1), 0);

  // Channel names that make a fixture's intensity and colour (presets, effects, the map's live view).
  const ROLE_NAMES = { dim: ['dim', 'intensity', 'i', 'master'], r: ['r', 'red'], g: ['g', 'green'], b: ['b', 'blue'], w: ['w', 'white'] };
  // { dim, r, g, b, w }: the slot of each (first match), or undefined.
  function channelRoles(f) {
    const ss = slots(f), o = {};
    for (const k in ROLE_NAMES) o[k] = ss.find((s) => ROLE_NAMES[k].includes(s.name));
    return o;
  }

  // Fixture ids of a timeline track, in order: its fixtures, then its groups' fixtures.
  // Ids without a fixture are left out.
  function trackFixtureIds(p, tr) {
    const ids = new Set(tr?.fixtures || []);
    for (const gid of tr?.groups || []) for (const id of p.groups.find((g) => g.id === gid)?.fixtures || []) ids.add(id);
    return [...ids].filter((id) => p.fixtures.some((f) => f.id === id));
  }

  // A map position (0..1 of width / height) as effect x / y. With the effect's "round"
  // option the long side of the map stays 0..1 and the short side becomes a smaller range
  // around 0.5, so a circle effect is round on a wide map. = effectPos in ShowParse.cpp.
  function effectXY(m, x, y, round) {
    const a = +m?.aspect || 1.6;   // the UI's default shape (normalize)
    if (!round || a === 1) return { x, y };
    return a > 1 ? { x, y: 0.5 + (y - 0.5) / a } : { x: 0.5 + (x - 0.5) * a, y };
  }
  // Does an effect use round x / y? Its own `round`; older projects had it per map (`square`):
  // an effect without the setting is round when any map had it (normalize() writes it into the
  // effects once). = effectRound in ShowParse.cpp.
  function effectRound(p, e) {
    return e?.round != null ? !!e.round : (p.maps || []).some((m) => m.square);
  }
  // Where a fixture is for effects (x / y): the first map it is on, or null.
  function mapPosition(p, id, round) {
    for (const m of p.maps || []) { const it = m.items.find((x) => x.fixture === id); if (it) return effectXY(m, it.x, it.y, round); }
    return null;
  }

  // Crossfade paths, like Pharos: progress k 0..1 -> how far the value has moved (ease() in Show.cpp).
  const EASE = {
    linear: (k) => k, accelerated: (k) => k * k, braked: (k) => 1 - (1 - k) ** 2, damped: (k) => k * k * (3 - 2 * k),
    overshoot: (k) => 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2,
  };

  // ---- Dates and the sun (same maths as src/Clock.cpp) ----
  // Days since 1970-01-01 of a calendar date (m 1-12).
  function days(y, m, d) {
    y -= m <= 2 ? 1 : 0;
    const era = Math.floor((y >= 0 ? y : y - 399) / 400), yoe = y - era * 400;
    const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
  }
  // Is today (md = MMDD, ymd = YYYYMMDD) in a calendar period "MM-DD" or "YYYY-MM-DD"? MM-DD periods may wrap the new year.
  function inPeriod(md, ymd, from, to) {
    const p = (s) => { const a = String(s).split('-').map(Number); return a.length === 3 ? { y: a[0], m: a[1], d: a[2] } : { y: 0, m: a[0], d: a[1] }; };
    const a = p(from), b = p(to || from);
    if (a.y && b.y) return ymd >= a.y * 10000 + a.m * 100 + a.d && ymd <= b.y * 10000 + b.m * 100 + b.d;
    const f = a.m * 100 + a.d, t = b.m * 100 + b.d;
    return f <= t ? md >= f && md <= t : md >= f || md <= t;
  }
  // Is a calendar entry { from, to, days } on date y-m-d? (= periodOn in Clock.cpp.) No "from" =
  // all year; "days" (["mon", …]) limits it to those weekdays, missing = every day.
  const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  function periodOn(e, y, m, d) {
    if (e.days && !e.days.includes(WEEKDAYS[((days(y, m, d) % 7) + 11) % 7])) return false;
    const md = m * 100 + d, ymd = y * 10000 + md;
    return e.from ? inPeriod(md, ymd, e.from, e.to || e.from) : true;
  }
  // Dates are stored MM-DD / YYYY-MM-DD (calendar) but shown and typed European: DD-MM / DD-MM-YYYY.
  // Both return null for text that isn't a date.
  function dateShow(s) {
    const a = String(s || '').split('-');
    if (a.length === 3 && /^\d{4}$/.test(a[0])) return `${a[2].padStart(2, '0')}-${a[1].padStart(2, '0')}-${a[0]}`;
    if (a.length === 2 && a.every((x) => /^\d{1,2}$/.test(x))) return `${a[1].padStart(2, '0')}-${a[0].padStart(2, '0')}`;
    return null;
  }
  function dateStore(s) {
    const a = String(s || '').trim().split(/[-./]/);
    if (!a.every((x) => /^\d+$/.test(x))) return null;
    const ok = (d, m) => m >= 1 && m <= 12 && d >= 1 && d <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    const p2 = (n) => String(n).padStart(2, '0');
    if (a.length === 3 && a[2].length === 4 && ok(+a[0], +a[1])) return `${a[2]}-${p2(+a[1])}-${p2(+a[0])}`;
    if (a.length === 2 && ok(+a[0], +a[1])) return `${p2(+a[1])}-${p2(+a[0])}`;
    return null;
  }
  // Sunrise / sunset in UTC minutes from midnight (NOAA approximation; can be < 0 or > 1440
  // far from Greenwich), or null in polar day/night.
  function sunUtc(y, m, d, lat, lon, rise) {
    const n = days(y, m, d) - days(y, 1, 1) + 1, g = 2 * Math.PI / 365 * (n - 1);
    const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const la = lat * Math.PI / 180;
    const x = Math.cos(90.833 * Math.PI / 180) / (Math.cos(la) * Math.cos(decl)) - Math.tan(la) * Math.tan(decl);
    if (x < -1 || x > 1) return null;
    const ha = Math.acos(x) * 180 / Math.PI;
    return Math.round(720 - 4 * (lon + (rise ? ha : -ha)) - eq);
  }

  // Settings > Network: problems with a fixed address, as { field, text }. The firmware checks
  // the same (fixedProblem in Net.cpp) and uses DHCP instead of a setting that can't work.
  function ipNum(s) {
    const m = /^\s*(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\s*$/.exec(String(s ?? ''));
    if (!m || m.slice(1).some((x) => +x > 255)) return null;
    return ((+m[1] << 24) | (+m[2] << 16) | (+m[3] << 8) | +m[4]) >>> 0;
  }
  function netProblems(n) {
    if (!n || n.dhcp !== false) return [];
    const out = [], bad = (field, text) => out.push({ field, text });
    const ip = ipNum(n.ip), m = ipNum(n.mask), gw = String(n.gateway || '').trim() ? ipNum(n.gateway) : 0;
    const inv = m === null ? 0 : ~m >>> 0;
    if (m === null) bad('mask', 'Subnet mask: not an address like 255.255.255.0');
    else if (m === 0 || ((inv & (inv + 1)) >>> 0) !== 0) bad('mask', 'Subnet mask: not a valid mask (like 255.255.255.0 or 255.255.0.0)');
    if (ip === null) bad('ip', 'IP address: not an address like 192.168.1.50');
    else if (ip >>> 24 === 0 || ip >>> 24 === 127 || ip >>> 24 >= 224) bad('ip', 'IP address: this range can\'t be used for a device');
    else if (m !== null && !out.length && ((ip & inv) >>> 0 === 0 || (ip & inv) >>> 0 === inv)) bad('ip', 'IP address: this is the network or broadcast address of the subnet');
    if (gw === null) bad('gateway', 'Gateway: not an address (leave it empty for none)');
    else if (gw && ip !== null && m !== null && ((gw & m) >>> 0 !== (ip & m) >>> 0)) bad('gateway', 'Gateway: not in the same subnet as the IP address');
    else if (gw && gw === ip) bad('gateway', 'Gateway: the same as the IP address');
    for (const k of ['dns', 'dns2'])
      if (String(n[k] || '').trim() && ipNum(n[k]) === null) bad(k, `DNS server${k === 'dns2' ? ' 2' : ''}: not an address (leave it empty for none)`);
    return out;
  }

  const api = { slots, footprint, channelRoles, trackFixtureIds, mapPosition, effectXY, effectRound, EASE, days, inPeriod, periodOn, dateShow, dateStore, sunUtc, netProblems };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KDModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
