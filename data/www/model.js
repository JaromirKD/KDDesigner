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

  // Where a fixture is for effects (x / y): the first map it is on, or null.
  function mapPosition(p, id) {
    for (const m of p.maps || []) { const it = m.items.find((x) => x.fixture === id); if (it) return it; }
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

  const api = { slots, footprint, channelRoles, trackFixtureIds, mapPosition, EASE, days, inPeriod, sunUtc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KDModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
