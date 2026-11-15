'use strict';
// KD Designer web UI - Dashboard, Patch, Fixtures, Map and the colour wheel.
// Plain scripts sharing one global scope; load order is in index.html.

views.dashboard = () => `
  <h2>Dashboard</h2>
  <div class="grid">
    <div class="card" style="grid-column:span 2;min-width:0"><h3 style="margin-top:0">Running</h3><div id="pbs"></div><div id="sched"></div></div>
    <div class="card"><h3 style="margin-top:0">System</h3><div id="sys"></div></div>
    <div class="card"><h3 style="margin-top:0">Outputs</h3><div id="outs" class="row"></div>
      <p class="muted" style="margin:8px 0 0">Switches the output at once and changes the project setting (same switch as under Patch): save to keep it after a restart.</p></div>
    ${dashHasDevices() ? `<div class="card" style="grid-column:span 2;min-width:0"><h3 style="margin-top:0">Devices</h3><div id="dashDev" class="lv-devs"></div>
      <p class="muted" style="margin:8px 0 0">Every device the controller watches, offline first. Click one for Monitoring.</p></div>` : ''}
    ${P().projectors.length ? `<div class="card" style="grid-column:span 2;min-width:0"><h3 style="margin-top:0">Projectors</h3><div id="pjs"></div></div>` : ''}
    ${P().pcs.length ? `<div class="card" style="grid-column:span 2;min-width:0"><h3 style="margin-top:0">PCs</h3><div id="pcs"></div></div>` : ''}
  </div>
  <h3>Timelines</h3>
  <div class="row">${P().timelines.map((t) => `<button class="btn" data-cmd="start timeline ${t.id}">▶ ${esc(t.name)}</button>`).join('') || '<span class="muted">No timelines yet</span>'}</div>
  <h3>Scenes</h3>
  <div class="row">${P().scenes.map((s) => `<button class="btn" data-cmd="scene ${s.id} fade 1">${esc(s.name)}</button>`).join('') || '<span class="muted">No scenes yet</span>'}
    <button class="btn danger" data-cmd="release all fade 2">Release all</button></div>
  <h3>Recent warnings &amp; errors</h3>
  <div class="log" id="recent" style="height:auto;max-height:240px;min-height:0"></div>`;
views.dashboard.after = () => { renderPlaybacks(); renderRecent(); };
function dashHasDevices() {
  const p = P();
  return !!(p.devices.length + p.pcs.length + p.projectors.length + p.drivers.length + p.tcp.length + p.modbus.length);
}

function renderPlaybacks() {
  const el = $('#pbs');
  if (!el) return;
  const st = S.status;
  const pbs = st?.playbacks || [];
  el.innerHTML = pbs.length ? pbs.map((p) => {
    const pct = p.length ? Math.min(100, (p.pos / p.length) * 100) : 100;
    const ref = `${p.kind} ${p.id}`;
    return `<div class="pb"><div class="row"><span class="tag">${p.kind}</span><b>${p.id} · ${esc(p.name)}</b>
      ${p.paused ? '<span class="tag">paused</span>' : ''}${p.ended ? '<span class="tag">holding</span>' : ''}${p.releasing ? '<span class="tag">releasing</span>' : ''}
      <span class="spacer"></span><span class="muted mono">${p.length ? fmtTime(p.pos) + ' / ' + fmtTime(p.length) : ''}</span></div>
      <div class="bar"><div style="width:${pct}%"></div></div>
      <div class="row"><span class="muted">master ${p.master}%</span><span class="spacer"></span>
      ${p.kind === 'timeline' ? `<button class="btn small" data-cmd="${p.paused ? 'resume' : 'pause'} ${ref}">${p.paused ? 'Resume' : 'Pause'}</button>
      <button class="btn small" data-cmd="start ${ref}">Restart</button>
      <button class="btn small" data-cmd="stop ${ref} fade 2">Release</button>` : `<button class="btn small" data-cmd="release ${ref} fade 1">Release</button>`}</div></div>`;
  }).join('') : '<span class="muted">Nothing running</span>';
  const trigName = (id) => P().triggers.find((t) => t.id === id)?.name || '?';
  // wait = "wait until" (in -1: no timeout), loop = "repeat <n> times every", sleep = the rest of a run.
  const kind = (s) => (s.wait != null ? 'wait' : s.loop != null ? 'loop' : s.sleep ? 'sleep' : s.every ? 'repeat' : 'delayed');
  $('#sched').innerHTML = (st?.scheduled || []).map((s) => `<div class="pb row"><span class="tag">${kind(s)}</span>
    <b>${s.trigger} · ${esc(trigName(s.trigger))}</b><span class="spacer"></span>
    <span class="muted">${s.wait != null ? `until ${esc(s.wait)}${s.in >= 0 ? ` · gives up in ${(s.in / 1000).toFixed(1)}s` : ''}`
      : `${s.loop != null ? `${s.loop} left · ` : s.every ? `#${s.count}${s.remaining > 0 ? ` · ${s.remaining} left` : ' · forever'} · ` : ''}next in ${(Math.max(0, s.in) / 1000).toFixed(1)}s`}</span>
    <button class="btn small" data-cmd="${s.every && s.loop == null ? 'stop repeat' : 'cancel trigger'} ${s.trigger}">Stop</button></div>`).join('') +
    (st?.paused || []).map((s) => `<div class="pb row"><span class="tag bad">paused</span>
    <b>${s.trigger} · ${esc(trigName(s.trigger))}</b><span class="spacer"></span>
    <span class="muted" title="It fired over 100 times in a second: probably a feedback loop">loop? runs again in ${Math.ceil(Math.max(0, s.in) / 1000)}s</span></div>`).join('');
  // Only when it changed: rebuilding at every status update (~10/s) could swallow a click.
  const outsHtml = PROTOCOLS.map(([k, n]) => outputSwitch(k, n)).join(''), outsEl = $('#outs');
  if (outsEl.dataset.html !== outsHtml) { outsEl.innerHTML = outsHtml; outsEl.dataset.html = outsHtml; }
  // Only when it changed, like the outputs: a rebuild under the mouse could swallow a click.
  const devEl = $('#dashDev');
  if (devEl) { const h = deviceChipsHtml(st); if (devEl.dataset.html !== h) { devEl.innerHTML = h; devEl.dataset.html = h; } }
  const pjs = $('#pjs');
  if (pjs) {
    pjs.innerHTML = P().projectors.map((x) => {
      const ps = pjState(x.id);
      return `<div class="row pb"><span style="min-width:180px"><span class="dot ${ps.dot}"></span><b>${esc(x.name)}</b></span>
        <span class="muted" style="flex:1" title="${esc(ps.last)}">${esc(ps.text)}</span>${pjButtons(x.id)}</div>`;
    }).join('') + `<div class="row" style="margin-top:8px"><span class="muted" style="flex:1">All projectors</span>${pjButtons('all')}</div>`;
  }
  const pcsEl = $('#pcs');
  if (pcsEl) {
    pcsEl.innerHTML = P().pcs.map((x) => `<div class="row pb"><span style="min-width:180px"><b>${esc(x.name)}</b> <span class="muted">${esc(x.ip)}</span></span>
      <span class="muted" style="flex:1">${esc(pcLast(x.id))}</span>${pcButtons(x.id)}</div>`).join('') +
      `<div class="row" style="margin-top:8px"><span class="muted" style="flex:1">All PCs</span>${pcButtons('all')}</div>`;
  }
  const s = st?.stats;
  $('#sys').innerHTML = st ? `
    <div class="form" style="grid-template-columns:110px 1fr">
      <label>Firmware</label><span>${esc(st.version)}</span>
      <label>Uptime</label><span>${fmtTime(st.uptime).replace(/\.\d$/, '')}</span>
      <label>Last start</label><span>${startedText(st.started)}</span>
      <label>Clock</label><span>${st.time > 1600000000 ? euDateTime(new Date(st.time * 1000)) : 'not set'}</span>
      <label>Engine</label><span>${s.engineFps} fps · tick ${s.tickUs} µs</span>
      <label>Main loop</label><span>worst ${s.loopUs} µs</span>
      <label>Memory</label><span>${memText(s.heap)}</span>
      <label>Art-Net</label><span>${s.artTx} tx/s · ${s.artRx} rx/s</span>
      <label>sACN</label><span>${s.sacnTx} tx/s · ${s.sacnRx || 0} rx/s</span>
      <label>UDP in</label><span>${s.udpRx}/s</span>
      <label>HTTP</label><span>${s.http} requests</span>
    </div>` : '<span class="muted">Waiting for controller…</span>';
}
// One switch per protocol, the same on Dashboard and Patch: it changes the project setting
// (settings.outputs, saved with the project) and switches the output live at once. Saving
// reloads the settings, so live and saved only differ after the `output … on|off` command
// (a trigger or the console): the switch then says what is really being sent.
function outputSwitch(k, n) {
  const on = !!P().settings.outputs[k], live = S.status?.outputs;
  const differs = live && !!live[k] !== on;
  const extra = differs ? ` · now ${live[k] ? 'on' : 'off'} until save/restart` : on && live?.[k + 'Fps'] ? ` · ${live[k + 'Fps']} fps` : '';
  return `<button class="toggle${on ? ' on' : ''}" data-out="${k}"
    title="${differs ? `Switched ${live[k] ? 'on' : 'off'} live by the output command; the project says ${on ? 'on' : 'off'} (back at the next save or restart). ` : ''}Click to switch ${on ? 'off' : 'on'} now and in the project">${n} ${on ? 'on' : 'off'}${extra}</button>`;
}
async function toggleOutput(k) {
  const o = P().settings.outputs, on = !o[k];
  o[k] = on;
  if (S.status?.outputs) S.status.outputs[k] = on;   // Patch isn't redrawn by the status: don't show "until save" for our own click
  markDirty();
  render();
  const r = await cmd(`output ${k} ${on ? 'on' : 'off'}`);
  if (!r.ok) toast(r.reply, true);
}
function renderRecent() {
  const el = $('#recent');
  if (!el) return;
  const rows = S.log.filter((m) => m.l >= 2).slice(-15).reverse();
  el.innerHTML = rows.length ? rows.map(logRowHtml).join('') : '<div class="gap" style="color:var(--muted)">No warnings</div>';
}

views.patch = () => {
  const p = P(), bad = conflicts();
  const outs = p.settings.outputs;
  const use = (i, key, on) => `<input type="checkbox" data-p="universes.${i}.${key}" data-t="bool"${on ? ' checked' : ''} data-r>`;
  return `<h2>Patch</h2>
  <h3>Protocols</h3>
  <table class="proto" style="max-width:720px"><tr><th>Protocol (same switch as on the Dashboard)</th><th>Frames per second</th><th>Send</th></tr>
  ${PROTOCOLS.map(([k, n]) => `<tr>
    <td>${outputSwitch(k, n)}</td>
    <td><div class="row nowrap"><input type="number" min="1" max="${k === 'dmx' ? 44 : 60}" data-p="settings.outputs.${k}Fps" data-t="num" value="${outs[k + 'Fps']}" style="width:70px">
      <span class="muted">${k === 'dmx' ? 'max 44 (a 512-slot frame takes ~23 ms)' : 'max 60'}</span></div></td>
    <td>${k === 'dmx' ? '<span class="muted">continuous (DMX512 always refreshes)</span>'
      : `<select data-p="settings.outputs.${k}ChangesOnly" data-t="bool-sel">
          <option value="1"${outs[k + 'ChangesOnly'] ? ' selected' : ''}>only changes (+ 1 s keep-alive)</option>
          <option value="0"${outs[k + 'ChangesOnly'] ? '' : ' selected'}>continuously at this rate</option></select>`}</td></tr>`).join('')}
  </table>
  <p class="muted">The switch works at once and is saved with the project. From a trigger, <code>output artnet off</code> or <code>output sacn fps 30</code> changes it only live (until the next save or restart).
    Some nodes and media servers expect a continuous stream; "only changes" saves network traffic.</p>
  <h3>Universes</h3>
  <table class="uni"><tr><th class="narrow">ID</th><th>Name</th><th class="${outs.dmx ? '' : 'off'}">DMX port</th><th class="${outs.artnet ? '' : 'off'}">Art-Net port-address → destination</th><th class="${outs.sacn ? '' : 'off'}">sACN universe</th><th></th></tr>
  ${p.universes.map((u, i) => `<tr>
    <td><input data-p="universes.${i}.id" data-t="num" type="number" min="1" value="${u.id}" data-r></td>
    <td><input data-p="universes.${i}.name" value="${esc(u.name)}"></td>
    <td class="${u.useDmx && outs.dmx ? '' : 'off'}"><div class="row nowrap">${use(i, 'useDmx', u.useDmx)}<select data-p="universes.${i}.dmxPort" data-t="num"><option value="0">none</option>${[1, 2, 3, 4].map((n) => `<option${u.dmxPort === n ? ' selected' : ''}>${n}</option>`).join('')}</select></div></td>
    <td class="${u.useArtnet && outs.artnet ? '' : 'off'}"><div class="row nowrap">${use(i, 'useArtnet', u.useArtnet)}<input style="width:80px" data-p="universes.${i}.artnet" data-t="num" type="number" min="0" max="32767" value="${Math.max(0, u.artnet ?? 0)}"><input data-p="universes.${i}.artnetDest" value="${esc(u.artnetDest || '255.255.255.255')}" title="Broadcast (255.255.255.255) or a node's IP"></div></td>
    <td class="${u.useSacn && outs.sacn ? '' : 'off'}"><div class="row nowrap">${use(i, 'useSacn', u.useSacn)}<input data-p="universes.${i}.sacn" data-t="num" type="number" min="1" max="63999" value="${Math.max(1, u.sacn || 1)}"></div></td>
    <td><button class="btn small ghost" data-del="universes.${i}">✕</button></td></tr>`).join('')}
  </table>
  <div class="row" style="margin-top:6px"><button class="btn small" data-add="universe">+ Universe</button><span class="muted">Tick a protocol to send this universe there. Greyed out = not sent.</span></div>
  <h3>Fixtures</h3>
  <p>${p.fixtures.length} fixture(s), ${p.groups.length} group(s)${bad.size ? ` · <span class="bad">${bad.size} with overlapping addresses</span>` : ''}.
    <button class="btn small" data-view="fixtures">Open the Fixtures page →</button></p>
  <p class="muted">Channels named pan/tilt/pos/zoom/focus/gobo/shutter/strobe/ctrl/fx… and 16-bit channels are left alone by the grand master and the dimmer curve.</p>`;
};

// ---- Fixtures: a list like the trigger list, with groups -------------------------
// S.fxSel = selected fixture ids; S.fxGroup = id of the group being edited (or null).
S.fxSel = new Set();
let fxAnchor = 0;
const fixtureType = (f) => {
  const t = findType(f.type);
  if (t) return t.model;
  const ch = f.channels || [], has = (...n) => n.every((x) => ch.includes(x));
  if (ch.some((c) => /:16$/.test(c))) return '16-bit';
  if (has('r', 'g', 'b', 'w')) return 'RGBW';
  if (has('r', 'g', 'b')) return 'RGB';
  if (ch.length === 1 && /^(dim|intensity|i)$/.test(ch[0])) return 'Dimmer';
  return `${ch.length} ch`;
};
// Next free address in a universe after everything already patched there.
const nextAddress = (u, extra = []) => [...P().fixtures, ...extra].filter((f) => f.universe === u).reduce((m, f) => Math.max(m, f.address + footprint(f)), 1);
const MAX_UNIVERSES = 8;   // KD_MAX_UNIVERSES in src/Config.h
const newUniverse = (id) => ({ id, name: 'Universe ' + id, dmxPort: 0, artnet: id - 1, sacn: id, useDmx: false, useArtnet: true, useSacn: true });
// Auto-patch: hands out addresses one after the other from u.addr. A fixture that doesn't fit
// before channel 512 goes to the next universe in the list, at freeFrom(u) - a fixture is never
// split over two universes. Past the last universe it plans new ones (newU), up to MAX_UNIVERSES.
function patcher(u, addr, freeFrom) {
  const ids = P().universes.map((x) => x.id), st = { u, addr, newU: [], error: '', fit: 0 };
  let ui = ids.indexOf(u);
  st.place = (w) => {
    if (st.addr + w - 1 > 512 && !st.error) {
      if (w > 512) st.error = 'a fixture has more than 512 channels';
      else if (++ui >= ids.length && ids.length >= MAX_UNIVERSES) st.error = `needs more than ${MAX_UNIVERSES} universes (the controller's maximum)`;
      else {
        if (ui >= ids.length) { ids.push(Math.max(0, ...ids) + 1); st.newU.push(ids[ui]); }
        st.u = ids[ui];
        st.addr = freeFrom(st.u);
      }
    }
    const at = { universe: st.u, address: st.addr };
    if (!st.error) st.fit++;
    st.addr += w;
    return at;
  };
  return st;
}
// "1.1–510 · 2.1–48" for fixtures in patch order.
const patchRange = (fs) => {
  const by = new Map();
  for (const f of fs) { const r = by.get(f.universe) || [f.address, 0]; by.set(f.universe, [Math.min(r[0], f.address), Math.max(r[1], f.address + footprint(f) - 1)]); }
  return [...by].map(([u, [a, b]]) => `${u}.${a}–${b}`).join(' · ');
};
// Where a fixture is used (for delete warnings and the editor).
function fixtureUse(id) {
  const p = P();
  return {
    scenes: p.scenes.filter((s) => s.levels.some((l) => l.fixture === id)),
    tracks: p.timelines.flatMap((tl) => tl.tracks.filter((tr) => tr.fixtures.includes(id)).map((tr) => `${tl.name} › ${tr.name}`)),
    maps: p.maps.filter((m) => m.items.some((it) => it.fixture === id)),
    groups: p.groups.filter((g) => g.fixtures.includes(id)),
  };
}
function deleteFixtures(ids) {
  const p = P(), set = new Set(ids);
  if (!set.size) return;
  const used = ids.map(fixtureUse);
  const nScenes = new Set(used.flatMap((u) => u.scenes)).size, nTracks = used.reduce((n, u) => n + u.tracks.length, 0);
  const what = set.size === 1 ? `'${fixture(ids[0])?.name}'` : `${set.size} fixtures`;
  const warn = nScenes || nTracks ? `\n\nAlso removed from ${nScenes} scene(s) and ${nTracks} timeline track(s), and from groups and maps.` : '';
  if (!confirm(`Delete ${what}?${warn}`)) return;
  p.fixtures = p.fixtures.filter((f) => !set.has(f.id));
  p.scenes.forEach((s) => (s.levels = s.levels.filter((l) => !set.has(l.fixture))));
  p.groups.forEach((g) => (g.fixtures = g.fixtures.filter((x) => !set.has(x))));
  p.maps.forEach((m) => (m.items = m.items.filter((it) => !set.has(it.fixture))));
  p.timelines.forEach((tl) => tl.tracks.forEach((tr) => (tr.fixtures = tr.fixtures.filter((x) => !set.has(x)))));
  S.fxSel = new Set();
  markDirty();
  render();
}
// Copies of fixtures, with new ids and the next free addresses in their universe.
function copyFixtures(src) {
  const p = P(), made = [];
  for (const f of src) {
    const n = { ...structuredClone(f), id: nextId([...p.fixtures, ...made]) };
    let name = f.name.replace(/ \d+$/, ''), k = 2;
    while ([...p.fixtures, ...made].some((x) => x.name === `${name} ${k}`)) k++;
    n.name = `${name} ${k}`;
    n.address = nextAddress(n.universe, made);
    made.push(n);
  }
  p.fixtures.push(...made);
  S.fxSel = new Set(made.map((f) => f.id));
  S.fxGroup = null;
  S.revealFx = true;
  markDirty();
  render();
  return made;
}
// ---- Patch grid (like the Patch view in Pharos Designer): the 512 channels of a universe with the
// fixtures as outlined blocks; drag a block to give the fixture another address.
// S.patchU = universe shown; it follows the selection when you pick a fixture of another universe.
function patchGridHtml(grp) {
  const p = P(), key = [...S.fxSel].join();
  if (key !== S.patchKey) {
    S.patchKey = key;
    const f = fixture([...S.fxSel][0]);
    if (f && ![...S.fxSel].some((id) => fixture(id)?.universe === S.patchU)) S.patchU = f.universe;
  }
  if (!p.universes.some((u) => u.id === S.patchU)) S.patchU = p.universes[0]?.id || 1;
  const u = S.patchU, bad = conflicts(), at = {}, n = {};
  dmxFixtures(u).forEach((f, k) => dmxChannelsOf(f).forEach((c, i) => { n[c.ch] = (n[c.ch] || 0) + 1; if (!at[c.ch]) at[c.ch] = { f, name: c.name, first: i === 0, odd: k % 2 }; }));
  const on = (id) => S.fxSel.has(id) || !!grp?.fixtures.includes(id);
  const used = Object.keys(at).length;
  return `<div class="patch"><div class="row map-tools"><label class="muted">Universe</label><select id="patchU">${opts(p.universes, u, (x) => `${x.id} · ${x.name}`)}</select>
      <span class="muted" id="patchInfo">Drag a fixture to another address · selected fixtures move together</span><span class="spacer"></span><span class="muted">${used} of 512 used</span></div>
    <div class="dmx patch-grid" id="patchGrid">${Array.from({ length: 512 }, (_, i) => {
      const ch = i + 1, a = at[ch];
      if (!a) return `<div data-ch="${ch}" title="${u}.${ch} free"><b>${ch}</b><em></em></div>`;
      const cls = `fx f${a.odd}${a.first ? ' fs' : ''}${on(a.f.id) ? ' sel' : ''}${n[ch] > 1 || bad.has(a.f.id) ? ' bad' : ''}`;
      return `<div data-ch="${ch}" data-f="${a.f.id}" class="${cls}" title="${esc(`${a.f.name} · ${a.name} (${u}.${ch})${n[ch] > 1 ? ' - overlaps another fixture!' : ''}`)}"><b>${ch}</b><em>${esc(a.first ? a.f.name : a.name)}</em></div>`;
    }).join('')}</div></div>`;
}
function wirePatchGrid() {
  const grid = $('#patchGrid');
  if (!grid) return;
  const p = P(), u = S.patchU;
  outlineFixtures(grid);
  $('#patchU').addEventListener('change', (e) => { S.patchU = +e.target.value; render(); });
  const cellAt = (ch) => grid.children[ch - 1];
  const info = $('#patchInfo');
  grid.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('[data-f]');
    if (!cell || e.button !== 0) return;
    e.preventDefault();
    const id = +cell.dataset.f, li = p.fixtures.findIndex((f) => f.id === id);
    // Like in the list: Ctrl+click adds or removes a fixture, Shift+click selects the range
    // from the last one clicked (in list order, so also fixtures in other universes).
    if (e.shiftKey) {
      S.fxSel = new Set(p.fixtures.slice(Math.min(fxAnchor, li), Math.max(fxAnchor, li) + 1).map((f) => f.id));
      S.fxGroup = null;
      return render();
    }
    if (e.ctrlKey || e.metaKey) {
      S.fxSel.has(id) ? S.fxSel.delete(id) : S.fxSel.add(id);
      fxAnchor = li;
      S.fxGroup = null;
      return render();
    }
    // Dragging a selected fixture takes the other selected fixtures of this universe along.
    const moving = (S.fxSel.has(id) ? [...S.fxSel] : [id]).map(fixture).filter((f) => f && f.universe === u);
    const movingIds = new Set(moving.map((f) => f.id)), from = +cell.dataset.ch;
    const others = p.fixtures.filter((f) => f.universe === u && !movingIds.has(f.id));
    grid.setPointerCapture(e.pointerId);
    let shift = 0, ok = false, marked = [];
    const show = (to) => {
      marked.forEach((el) => el.classList.remove('drop', 'clash'));
      marked = [];
      shift = to - from;
      ok = true;
      let clash = null;
      for (const f of moving) {
        const a = f.address + shift, w = footprint(f);
        if (a < 1 || a + w - 1 > 512) ok = false;
        const hit = others.find((o) => a < o.address + footprint(o) && o.address < a + w);
        if (hit) { ok = false; clash = clash || hit; }
        for (let c = Math.max(1, a); c < Math.min(513, a + w); c++) marked.push(cellAt(c));
      }
      marked.forEach((el) => el.classList.add('drop', ...(ok ? [] : ['clash'])));
      const one = moving.length === 1 ? moving[0] : null;
      info.textContent = !ok ? (clash ? `Taken by ${clash.name} (${u}.${clash.address})` : 'Past channel 512')
        : one ? `${one.name} → ${u}.${one.address + shift}–${one.address + shift + footprint(one) - 1}` : `${moving.length} fixtures, ${shift > 0 ? '+' : ''}${shift} channels`;
    };
    const move = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('#patchGrid > [data-ch]');
      if (!el || (!shift && +el.dataset.ch === from && !marked.length)) return;
      if (!marked.length) grid.classList.add('dragging');
      show(+el.dataset.ch);
    };
    grid.addEventListener('pointermove', move);
    grid.addEventListener('pointerup', () => {
      grid.removeEventListener('pointermove', move);
      grid.classList.remove('dragging');
      if (!marked.length) {   // a click: select this fixture
        S.fxSel = new Set([id]);
        fxAnchor = li;
        S.fxGroup = null;
        S.fxPanel = '';
        S.revealFx = true;
        return render();
      }
      if (!shift) return render();
      if (!ok) { toast(info.textContent + ' - not moved', true); return render(); }
      for (const f of moving) f.address += shift;
      S.fxSel = movingIds;
      markDirty();
      render();
    }, { once: true });
  });
}
views.fixtures = () => {
  const p = P(), f = S.fxFilter || '', bad = conflicts();
  const grp = p.groups.find((g) => g.id === S.fxGroup);
  const sel = p.fixtures.filter((x) => S.fxSel.has(x.id));
  const groupsOf = new Map(), inGrp = new Set(grp?.fixtures);
  p.groups.forEach((g) => g.fixtures.forEach((id) => (groupsOf.get(id) || groupsOf.set(id, []).get(id)).push(g)));
  const inGroup = (x) => groupsOf.get(x.id) || [];
  const row = (x, i) => {
    if (f && !`${x.id} ${x.name} ${x.universe}.${x.address} ${fixtureType(x)} ${inGroup(x).map((g) => g.name).join(' ')}`.toLowerCase().includes(f.toLowerCase())) return '';
    const gs = inGroup(x);
    return `<div class="item${S.fxSel.has(x.id) ? ' sel' : ''}${inGrp.has(x.id) ? ' in-grp' : ''}" data-fxi="${i}">
      <span class="id">${x.id}</span><span class="fx-ic">${fxIcon(x)}</span><span class="nm">${esc(x.name)}</span>
      ${gs.map((g) => `<span class="tag grp-tag" title="Group ${esc(g.name)}">${esc(g.name)}</span>`).join('')}
      <span class="tag mono${bad.has(x.id) ? ' mon-warn' : ''}" title="${bad.has(x.id) ? 'Address overlaps another fixture' : 'universe.address'}">${x.universe}.${x.address}</span>
      <span class="tag tt" title="${esc(x.type ? `${x.type} · ${x.mode || 'own channels'}` : (x.channels || []).join(', '))}">${esc(fixtureType(x))}</span></div>`;
  };
  // Big rigs: FOLD or more fixtures in a row of the list that share their smallest group (the cells
  // of a pixel bar, a row of pars) show as one row; ▸ opens it (S.fxOpen = open group ids).
  // Not while filtering, so a search always shows the fixtures themselves.
  const FOLD = 8, home = (x) => inGroup(x).reduce((m, g) => (!m || g.fixtures.length < m.fixtures.length ? g : m), null);
  S.fxOpen ||= new Set();
  let items = '';
  for (let i = 0; i < p.fixtures.length; i++) {
    const g = !f && home(p.fixtures[i]);
    let j = i;
    if (g) while (j + 1 < p.fixtures.length && home(p.fixtures[j + 1]) === g) j++;
    if (j - i + 1 < FOLD) { items += row(p.fixtures[i], i); continue; }
    const run = p.fixtures.slice(i, j + 1), nSel = run.filter((x) => S.fxSel.has(x.id)).length, open = S.fxOpen.has(g.id);
    const ends = run.map((x) => [x.universe, x.address, x.address + footprint(x) - 1]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const [u0, a0] = ends[0], [u1, , e1] = ends.reduce((m, e) => (e[0] > m[0] || (e[0] === m[0] && e[2] > m[2]) ? e : m));
    items += `<div class="item fold${open ? ' open' : ''}${nSel === run.length ? ' sel' : nSel ? ' part' : ''}${run.some((x) => inGrp.has(x.id)) ? ' in-grp' : ''}" data-fold="${i}-${j}">
      <button class="fold-tw" data-foldtw="${g.id}" title="${open ? 'Fold' : 'Show the fixtures'}">${open ? '▾' : '▸'}</button><span class="fx-ic">${fxIcon(run[0])}</span><span class="nm">${esc(g.name)}</span>
      <span class="tag">${run.length} fixtures${nSel && nSel < run.length ? ` · ${nSel} selected` : ''}</span>
      <span class="tag mono${run.some((x) => bad.has(x.id)) ? ' mon-warn' : ''}" title="universe.address of the first and last channel">${u0}.${a0}–${u1 !== u0 ? u1 + '.' : ''}${e1}</span>
      <span class="tag tt">${esc(fixtureType(run[0]))}</span></div>`;
    if (open) run.forEach((x, k) => (items += row(x, i + k)));
    i = j;
  }
  let editor;
  if (S.fxPanel === 'add') editor = addFixturesHtml();
  else if (S.fxPanel === 'types') editor = fixtureTypesHtml();
  else if (grp) {
    const gi = p.groups.indexOf(grp);
    editor = `<div class="row"><span class="muted">Group</span><input data-p="groups.${gi}.name" value="${esc(grp.name)}" style="font-size:16px;flex:1" data-r>
        <button class="btn small ghost" data-del="groups.${gi}">Delete group</button></div>
      <p class="muted">${grp.fixtures.length} fixture(s), highlighted in the list. Groups can fill timeline tracks and scenes.</p>
      <div class="list">${grp.fixtures.map(fixture).filter(Boolean).map((x) => `<div class="item"><span class="id">${x.id}</span><span style="flex:1">${esc(x.name)}</span><span class="tag mono">${x.universe}.${x.address}</span><button class="btn small ghost" data-grprm="${x.id}" title="Remove from group">✕</button></div>`).join('') || '<span class="muted">Empty - select fixtures in the list and use "Add to group".</span>'}</div>
      <div class="row" style="margin-top:8px">${sel.length ? `<button class="btn small" id="grpAddSel">Add the ${sel.length} selected fixture(s)</button>` : ''}<button class="btn small" id="grpSelect">Select these fixtures</button></div>`;
  } else if (sel.length === 1) {
    const x = sel[0], i = p.fixtures.indexOf(x), use = fixtureUse(x.id);
    editor = `<div class="row"><span class="id muted">#${x.id}</span><input data-p="fixtures.${i}.name" value="${esc(x.name)}" style="font-size:16px;flex:1" data-r>
        <button class="btn small" id="fxLocate" title="Flash it white for 5 s to find it in the room (L)">Locate</button>
        <button class="btn small ghost" id="fxDelSel">Delete</button></div>
      <div class="form" style="margin-top:10px">
        ${fixtureFieldsHtml(x)}
        <label>Groups</label><div class="row">${p.groups.map((g) => `<label class="chk"><input type="checkbox" data-fxgrp="${g.id}"${g.fixtures.includes(x.id) ? ' checked' : ''}>${esc(g.name)}</label>`).join('') || '<span class="muted">none yet</span>'}</div>
        <label>Used in</label><span class="muted">${[use.scenes.length ? `${use.scenes.length} scene(s)` : '', use.tracks.length ? `tracks ${use.tracks.map(esc).join(', ')}` : '', use.maps.length ? `map ${use.maps.map((m) => esc(m.name)).join(', ')}` : ''].filter(Boolean).join(' · ') || 'nothing yet'}</span>
      </div>`;
  } else if (sel.length > 1) {
    editor = `<div class="row"><b>${sel.length} fixtures selected</b><button class="btn small" id="fxLocate" style="margin-left:auto" title="Flash them white for 5 s to find them in the room (L)">Locate</button><button class="btn small ghost" id="fxDelSel">Delete</button></div>
      <div class="form" style="margin-top:10px">
        <label>Type</label><div class="row"><button class="btn small" id="fxBulkType" title="Make them all another fixture type">Change type…</button></div>
        <label>Universe</label><select id="fxBulkU"><option value="">— keep —</option>${p.universes.map((u) => `<option value="${u.id}">${u.id} · ${esc(u.name)}</option>`).join('')}</select>
        <label>Curve</label><select id="fxBulkCurve"><option value="">— keep —</option>${CURVES.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>
        <label>Addresses</label><div class="row nowrap"><span class="muted">one after the other from</span><select id="fxBulkFromU">${opts(p.universes, sel[0].universe, (u) => u.id)}</select><span>.</span><input type="number" id="fxBulkAddr" min="1" max="512" value="${Math.min(...sel.filter((x) => x.universe === sel[0].universe).map((x) => x.address))}" style="width:80px"><button class="btn small" id="fxBulkAddrGo" title="In list order; past channel 512 they go on in the next universe">Number them</button></div>
        <label>Groups</label><div class="row"><button class="btn small" id="fxNewGroup">New group from these</button>
          ${p.groups.length ? `<select id="fxAddGroup"><option value="">Add to group…</option>${p.groups.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select>` : ''}</div>
      </div>`;
  } else editor = '<p class="muted">Select a fixture or a group. Ctrl/Shift+click selects several.</p>';
  // The patch: the universe's 512 channels with the fixtures on them, above the details
  // (not while adding fixtures or editing types: those need the room).
  if (!S.fxPanel) editor = patchGridHtml(grp) + editor;
  return `<h2>Fixtures</h2><div class="split">
    <div><input id="fxFilter" placeholder="Filter fixtures…" value="${esc(f)}" style="width:100%;margin-bottom:6px">
      <div class="list fx-list">${items || '<span class="muted">No fixtures yet.</span>'}</div>
      <div class="row" style="margin-top:8px">
        <button class="btn small primary" id="fxAddOpen">+ Add fixtures…</button><button class="btn small" data-add="fixture" title="A fixture with one dim channel; type its channels yourself">+ Empty</button>
        <button class="btn small ghost" id="fxTypesOpen" title="Your own fixture definitions, and importing fixture files">Fixture types…</button></div>
      <p class="muted keys">Ctrl/Shift+click to select several · Ctrl+C / V copy & paste · Ctrl+D duplicate · L locate · Del delete · ↑↓ select · Ctrl+A all · ? all keys</p>
      <h3 style="margin-top:14px">Groups</h3>
      <div class="list">${p.groups.map((g) => `<div class="item${g.id === S.fxGroup ? ' sel' : ''}" data-fxgroupsel="${g.id}"><span class="id">${g.id}</span><span style="flex:1">${esc(g.name)}</span><span class="tag">${g.fixtures.length}</span></div>`).join('') || '<span class="muted">No groups yet.</span>'}</div>
      <div class="row" style="margin-top:8px"><button class="btn small" id="fxGroupNew">${sel.length ? `+ Group from ${sel.length} selected` : '+ Group'}</button></div>
    </div>
    <div>${editor}</div></div>`;
};
views.fixtures.after = () => {
  const p = P();
  const list = $('.fx-list');
  $$('[data-fxi]', list).forEach((el) => el.addEventListener('click', (e) => {
    const i = +el.dataset.fxi, id = p.fixtures[i].id;
    if (e.shiftKey) {
      const [a, b] = [Math.min(fxAnchor, i), Math.max(fxAnchor, i)];
      S.fxSel = new Set(p.fixtures.slice(a, b + 1).map((x) => x.id));
    } else if (e.ctrlKey || e.metaKey) {
      S.fxSel.has(id) ? S.fxSel.delete(id) : S.fxSel.add(id);
      fxAnchor = i;
    } else { S.fxSel = new Set([id]); fxAnchor = i; }
    S.fxGroup = null;
    S.fxPanel = '';
    S.addFx.change = null;
    render();
  }));
  // A folded row stands for all its fixtures: click selects them, Ctrl adds/removes them, Shift extends.
  $$('[data-fold]', list).forEach((el) => el.addEventListener('click', (e) => {
    const [i, j] = el.dataset.fold.split('-').map(Number), ids = p.fixtures.slice(i, j + 1).map((x) => x.id);
    if (e.target.closest('[data-foldtw]')) {
      const g = +e.target.closest('[data-foldtw]').dataset.foldtw;
      S.fxOpen.has(g) ? S.fxOpen.delete(g) : S.fxOpen.add(g);
      return render();
    }
    if (e.shiftKey) S.fxSel = new Set(p.fixtures.slice(Math.min(fxAnchor, i), Math.max(fxAnchor, j) + 1).map((x) => x.id));
    else if (e.ctrlKey || e.metaKey) {
      const all = ids.every((id) => S.fxSel.has(id));
      ids.forEach((id) => (all ? S.fxSel.delete(id) : S.fxSel.add(id)));
      fxAnchor = i;
    } else { S.fxSel = new Set(ids); fxAnchor = i; }
    S.fxGroup = null;
    S.fxPanel = '';
    S.addFx.change = null;
    render();
  }));
  wirePatchGrid();
  // Fixtures of a library type need the library for their mode list and icon.
  if (!LIB.list && p.fixtures.some((x) => x.type && !findType(x.type))) loadLibrary(() => S.view === 'fixtures' && render());
  const openPanel = (name) => {
    if (name === 'add' && !S.addFx.universe) S.addFx.universe = p.universes[0]?.id || 1;
    // Only "+ Add fixtures…" on the Map page places new fixtures on the map; here it's a tick box.
    if (name === 'add') S.addFx.place = false;
    S.addFx.change = null;
    S.fxPanel = S.fxPanel === name ? '' : name;
    render();
  };
  $('#fxAddOpen').addEventListener('click', () => openPanel('add'));
  $('#fxTypesOpen').addEventListener('click', () => openPanel('types'));
  if (S.fxPanel === 'add') wireAddFixtures();
  else if (S.fxPanel === 'types') wireFixtureTypes();
  else wireFixtureFields();
  if (S.revealFx) { list.querySelector('.item.sel:last-of-type, .item.sel')?.scrollIntoView({ block: 'nearest' }); S.revealFx = false; }
  $('#fxFilter').addEventListener('input', (e) => {
    S.fxFilter = e.target.value;
    const pos = e.target.selectionStart;
    render();
    $('#fxFilter').focus();
    $('#fxFilter').setSelectionRange(pos, pos);
  });
  $$('[data-fxgroupsel]').forEach((el) => el.addEventListener('click', () => { const id = +el.dataset.fxgroupsel; S.fxGroup = S.fxGroup === id ? null : id; S.fxPanel = ''; render(); }));
  const newGroup = (ids) => {
    const name = prompt('Name of the new group', 'Group ' + nextId(p.groups));
    if (!name) return;
    const g = { id: nextId(p.groups), name, fixtures: [...ids] };
    p.groups.push(g);
    S.fxGroup = g.id;
    markDirty();
    render();
  };
  $('#fxGroupNew').addEventListener('click', () => newGroup([...S.fxSel]));
  $('#fxNewGroup')?.addEventListener('click', () => newGroup([...S.fxSel]));
  $('#fxAddGroup')?.addEventListener('change', (e) => {
    const g = p.groups.find((x) => x.id === +e.target.value);
    if (!g) return;
    g.fixtures = [...new Set([...g.fixtures, ...S.fxSel])];
    toast(`Added to ${g.name}`);
    markDirty();
    render();
  });
  $$('[data-fxgrp]').forEach((el) => el.addEventListener('change', () => {
    const g = p.groups.find((x) => x.id === +el.dataset.fxgrp), id = [...S.fxSel][0];
    g.fixtures = el.checked ? [...new Set([...g.fixtures, id])] : g.fixtures.filter((x) => x !== id);
    markDirty();
    render();
  }));
  const grp = p.groups.find((g) => g.id === S.fxGroup);
  $$('[data-grprm]').forEach((b) => b.addEventListener('click', () => { grp.fixtures = grp.fixtures.filter((x) => x !== +b.dataset.grprm); markDirty(); render(); }));
  $('#grpAddSel')?.addEventListener('click', () => { grp.fixtures = [...new Set([...grp.fixtures, ...S.fxSel])]; markDirty(); render(); });
  $('#grpSelect')?.addEventListener('click', () => { S.fxSel = new Set(grp.fixtures); S.fxGroup = null; render(); });
  $('#fxDelSel')?.addEventListener('click', () => deleteFixtures([...S.fxSel]));
  $('#fxLocate')?.addEventListener('click', () => locateFixtures([...S.fxSel]));
  $('#fxBulkType')?.addEventListener('click', () => openChangeType(p.fixtures.filter((x) => S.fxSel.has(x.id)).map((x) => x.id)));
  const sel = () => p.fixtures.filter((x) => S.fxSel.has(x.id));
  $('#fxBulkU')?.addEventListener('change', (e) => { if (!e.target.value) return; sel().forEach((x) => (x.universe = +e.target.value)); markDirty(); render(); });
  $('#fxBulkCurve')?.addEventListener('change', (e) => { if (!e.target.value) return; sel().forEach((x) => (x.curve = e.target.value)); markDirty(); render(); });
  $('#fxBulkAddrGo')?.addEventListener('click', () => {
    // In a universe they wrap into, they start after the fixtures that stay there.
    const list = sel(), moving = new Set(list), done = [];
    const free = (u) => p.fixtures.filter((f) => f.universe === u && !moving.has(f)).concat(done).filter((f) => f.universe === u)
      .reduce((m, f) => Math.max(m, f.address + footprint(f)), 1);
    const pt = patcher(+$('#fxBulkFromU').value, Math.max(1, Math.min(512, +$('#fxBulkAddr').value || 1)), free);
    for (const x of list) done.push({ ...x, ...pt.place(footprint(x)) });
    if (pt.error) return toast(`Not numbered: ${pt.error}`, true);
    p.universes.push(...pt.newU.map(newUniverse));
    list.forEach((x, i) => Object.assign(x, { universe: done[i].universe, address: done[i].address }));
    toast(`${list.length} fixtures: ${patchRange(list)}${pt.newU.length ? ` · new universe(s) ${pt.newU.join(', ')}` : ''}`);
    markDirty();
    render();
  });
};
// Locate: the controller flashes these fixtures white for 5 s ("locate 3,5,8-12"), to find
// them in the room while patching. Numbers as ranges, so a big selection stays one short line.
async function locateFixtures(ids) {
  const list = [...new Set(ids)].filter((id) => fixture(id)).sort((a, b) => a - b);
  if (!list.length) return toast('Select fixtures first', true);
  const parts = [];
  for (let i = 0; i < list.length; i++) {
    let j = i;
    while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
    parts.push(j > i ? `${list[i]}-${list[j]}` : `${list[i]}`);
    i = j;
  }
  const r = await cmd(`locate ${parts.join(',')}`);
  toast(r.reply + (r.ok && S.dirty ? ' - fixtures not saved yet use their saved address' : ''), !r.ok);
}
// Fixture list keys.
views.fixtures.keys = (e) => {
  const p = P(), mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  const sel = p.fixtures.filter((x) => S.fxSel.has(x.id));
  if (mod && k === 'a') { e.preventDefault(); S.fxSel = new Set(p.fixtures.map((x) => x.id)); S.fxGroup = null; render(); }
  else if (mod && k === 'c' && sel.length) { e.preventDefault(); S.fxClip = structuredClone(sel); toast(`Copied ${sel.length} fixture(s)`); }
  else if (mod && k === 'v' && S.fxClip?.length) { e.preventDefault(); copyFixtures(S.fxClip); toast(`Pasted ${S.fxClip.length} fixture(s) at the next free addresses`); }
  else if (mod && k === 'd' && sel.length) { e.preventDefault(); copyFixtures(sel); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) { e.preventDefault(); deleteFixtures(sel.map((x) => x.id)); }
  else if (k === 'l' && !mod && !e.altKey && sel.length) { e.preventDefault(); locateFixtures(sel.map((x) => x.id)); }
  else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && p.fixtures.length) {
    e.preventDefault();
    const cur = p.fixtures.findIndex((x) => x.id === [...S.fxSel].pop());
    const i = Math.max(0, Math.min(p.fixtures.length - 1, cur + (e.key === 'ArrowUp' ? -1 : 1)));
    S.fxSel = new Set([p.fixtures[i].id]);
    fxAnchor = i;
    S.fxGroup = null;
    S.revealFx = true;
    render();
  }
};

// ---- Map: a floor plan with the fixtures placed on it (Pharos "Layout") ---------
// p.maps = [{id, name, background: 'plan.jpg' (in /media/), aspect: w/h, snap, labels,
//            items: [{fixture, x, y}]}]  - x/y are 0..1 of the map's width/height.
const ASPECTS = [[16 / 9, '16:9'], [1.6, '16:10'], [3 / 2, '3:2'], [4 / 3, '4:3'], [1, '1:1'], [3 / 4, '3:4 (portrait)'], [9 / 16, '9:16 (portrait)']];
// What colour a fixture shows now: RGB(W) times its dimmer, or the dimmer as warm white.
function fixtureLook(f, dmx) {
  const d = dmx[f.universe];
  if (!d) return null;
  const at = (s) => (s ? d[f.address - 1 + s.offset] ?? 0 : null);
  const ro = channelRoles(f);
  const dim = at(ro.dim), r = at(ro.r), g = at(ro.g), b = at(ro.b), w = at(ro.w) || 0;
  const am = at(slots(f).find((s) => /^(a|amber)$/i.test(s.name))) || 0;   // amber ≈ r 255, g 170
  const k = dim == null ? 1 : dim / 255;
  if (r != null && g != null && b != null) {
    const c = [r + w + am, g + w + am * 0.67, b + w].map((x) => Math.round(Math.min(255, x) * k));
    return { color: `rgb(${c.join(',')})`, level: Math.max(...c) / 255 };
  }
  if (dim != null) return { color: `rgba(255,214,150,${(0.12 + k * 0.88).toFixed(2)})`, level: k };
  return null;
}
// A fixture on a map: a round dot with its icon, coloured by paintDot().
// it.s = how much smaller it is drawn: a fixture of a room on a floor (mapView) is as much smaller
// as the room is there; small ones drop their name.
const mapScale = (s) => (s && s < 1 ? `;--s:${+Math.max(0.25, s).toFixed(3)}` : '');
const mapDotHtml = (f, it, cls, labels, data = 'data-mfx') =>
  `<div class="mfx${cls}${it.from != null ? (it.d ? ' rdense' : ' rfull') : ''}" ${data}="${f.id}" style="left:${it.x * 100}%;top:${it.y * 100}%${mapScale(it.s)}" title="${esc(f.name)} · ${f.universe}.${f.address} (${esc((f.channels || []).join(', '))})">
    <span class="dot">${fxIcon(f)}</span>${labels && !(it.s < 0.6) ? `<span class="lbl">${esc(f.name)}</span>` : ''}</div>`;
// glow = false for maps with many fixtures (the glow is costly to draw).
function paintDot(dot, look, glow = true) {
  dot.style.background = look ? look.color : '';
  if (glow) dot.style.boxShadow = look && look.level > 0.05 ? `0 0 ${4 + look.level * 14}px ${look.color}` : '';
  // A dark icon on a bright colour.
  const [r, g, b] = (look?.color.match(/[\d.]+/g) || [0, 0, 0]).map(Number);
  dot.classList.toggle('lit', !!look && look.level > 0.35 && 0.3 * r + 0.59 * g + 0.11 * b > 110);
}
// ---- Devices on a map (web UI only, like the shapes: the firmware drops maps after loading) --
// m.devices = [{list, name, x, y}]: list = the project list the device is in (MAP_DEV_LISTS),
// found by name (a rename follows in onBound, a deleted device's marker goes in normalize).
// Optional per map: m.showDevices false hides them on the Map page and the Live page. They show
// the device's state from /api/status (paintMapDevs, called from onStatus).
const MAP_DEV_LISTS = [['projectors', 'projector', 'Projectors'], ['pcs', 'pc', 'PCs'], ['drivers', '', 'Show devices'],
  ['devices', 'network', 'Network devices'], ['tcp', 'tcp', 'TCP'], ['modbus', 'modbus', 'Modbus']];
const mapDevKey = (d) => `${d.list}:${d.name}`;
const mapDevOf = (d) => (P()[d.list] || []).find((x) => x.name === d.name);
const mapDevIcon = (list, x) => (list === 'drivers' ? x.type : MAP_DEV_LISTS.find(([l]) => l === list)?.[1] || 'device');
const mapDevsShown = (m) => (m.showDevices !== false ? (m.devices || []).filter(mapDevOf) : []);
// Every device in the project, in the order of MAP_DEV_LISTS: [{list, name, x (the device), label}].
const allMapDevs = () => MAP_DEV_LISTS.flatMap(([list, , label]) => (P()[list] || []).filter((x) => x.name)
  .map((x) => ({ list, name: x.name, x, label: list === 'drivers' ? DRIVERS[x.type]?.label || x.type : label })));
// What the controller says about a device now: state online|offline|unknown, a short extra
// (projector power, "not monitored"), and where its card is on the Monitoring page.
function mapDevStatus(list, x, st = S.status) {
  const s = (v) => v ?? 'unknown', seen = (j) => (!j ? 'unknown' : !j.seen ? 'unknown' : j.online ? 'online' : 'offline');
  if (!st) return { state: 'unknown', extra: 'no contact with the controller' };
  if (list === 'pcs' || list === 'devices') {
    const kind = list === 'pcs' ? 'pc' : 'device', h = st.monitor?.hosts?.find((y) => y.kind === kind && y.name === x.name);
    if (!h) return { state: 'unknown', extra: x.monitor === false ? 'not monitored' : 'not on the controller yet', tab: list === 'pcs' ? 'pcs' : 'network' };
    return { state: s(h.state), extra: h.state === 'online' && h.latency != null ? `${h.latency} ms` : '', open: `${kind}:${x.name}` };
  }
  if (list === 'projectors') {
    const j = st.projectors?.find((y) => y.id === x.id);
    return { state: seen(j), extra: j?.online && j.power ? j.power : j ? '' : 'not on the controller yet', open: `projector:${x.id}` };
  }
  if (list === 'drivers') {
    const j = st.drivers?.find((y) => y.id === x.id && y.type === x.type);
    return { state: seen(j), extra: j ? '' : 'not on the controller yet', open: `drv:${x.id}` };
  }
  const j = (list === 'tcp' ? st.io?.tcp : st.io?.modbus)?.find((y) => y.name === x.name);
  return { state: s(j?.state), extra: j ? '' : 'not connected yet', tab: 'tcp', card: `${list}:${x.name}` };
}
const mapDevHtml = (d, x, labels, cls = '') =>
  `<div class="mdev${cls}" data-mdev="${esc(mapDevKey(d))}" style="left:${d.x * 100}%;top:${d.y * 100}%${mapScale(d.s)}">
    <span class="box">${devIcon(mapDevIcon(d.list, x), '')}<i class="st"></i></span>${labels && !(d.s < 0.6) ? `<span class="lbl">${esc(d.name)}</span>` : ''}<span class="ext"></span></div>`;
// Colours every device marker under root by its state, with the details in its tooltip.
function paintMapDevs(root = document) {
  for (const el of root.querySelectorAll('[data-mdev]')) {
    const [list, ...n] = el.dataset.mdev.split(':'), name = n.join(':');
    const x = (P()[list] || []).find((y) => y.name === name);
    if (!x) continue;
    const r = mapDevStatus(list, x);
    el.classList.remove('online', 'offline', 'unknown');
    el.classList.add(r.state);
    const ext = el.querySelector('.ext'), short = list === 'projectors' && r.state === 'online' ? r.extra : '';
    if (ext.textContent !== short) ext.textContent = short;
    el.title = `${name} · ${allMapDevs().find((d) => d.x === x)?.label || ''}${x.ip ? ' · ' + x.ip : ''}\n${r.state}${r.extra ? ' · ' + r.extra : ''}`;
  }
}
// Opens a device's card on the Monitoring page (its history and log where it has a view).
function openDeviceMonitor(list, name) {
  const x = (P()[list] || []).find((y) => y.name === name);
  if (!x) return;
  const r = mapDevStatus(list, x);
  S.view = 'monitor';
  S.monTab = 'all';
  S.monOpen = r.open || null;
  if (!r.open && r.tab) S.monTab = r.tab;
  render();
  $('#main').scrollTop = 0;
}
// ---- Floor-plan shapes on a map (web UI only: the firmware drops maps after loading) -----
// m.shapes = [{type: 'rect'|'ellipse'|'line'|'poly'|'text', x, y, w, h, color, fill, alpha, width, text, size}],
// x/y/w/h 0..1 of the map's width/height. rect/ellipse: x/y = top-left corner, w/h >= 0;
// line: from x/y to x+w / y+h (w/h may be negative); text: x/y = its centre, size = % of the
// map's width (so it grows with the map); poly (your own shape): x/y/w/h = the box around it,
// pts = [[u, v], …] 0..1 inside that box (so moving and resizing work as for a rectangle),
// closed = last point joins the first (and it can be filled). rot = degrees clockwise round the
// box's centre (rect, ellipse, poly, text; a line just has its ends moved), turned in real
// proportions so 45° looks like 45° on a wide map. Drawn under the fixtures on every map view.
const SHAPE_TOOLS = [['select', '↖ Select'], ['rect', '▭ Rectangle'], ['ellipse', '◯ Ellipse'], ['line', '╱ Line'], ['poly', '✏ Draw'], ['text', 'T Text'], ['door', '◜ Door'], ['stairs', '▤ Stairs']];
const SHAPE_NAMES = { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', poly: 'Own shape', text: 'Text', door: 'Door', stairs: 'Stairs' };
// Doors and stairs live in a box like a rectangle (so moving, resizing and turning are the same).
// door: the opening is the bottom edge, hinged bottom-left (flip: bottom-right; double: both),
//   the leaf drawn standing open and its swing as an arc. stairs: treads across the long side
//   (steps of them, none = worked out from the shape), an arrow pointing up the stairs (flip: the
//   other way). Arrow heads are worked out in real proportions (a = the map's aspect).
function doorStairsSvg(s, a, pc, st, fill) {
  const x = s.x, y = s.y, w = s.w, h = s.h, L = (px, py) => `${pc(px)},${pc(py)}`;
  if (s.type === 'door') {
    const leaf = (hx, ex, rw, sweep) => `M${L(hx, y + h)} L${L(hx, y)} M${L(hx, y)} A${pc(rw)} ${pc(h)} 0 0 ${sweep} ${L(ex, y + h)}`;
    const d = s.double ? leaf(x, x + w / 2, w / 2, 1) + leaf(x + w, x + w / 2, w / 2, 0) : s.flip ? leaf(x + w, x, w, 0) : leaf(x, x + w, w, 1);
    // The leaf solid, the swing thin and dashed (one path each, so both get the line colour).
    const parts = d.split(/(?=M)/), leaves = parts.filter((_, k) => k % 2 === 0).join(''), arcs = parts.filter((_, k) => k % 2 === 1).join('');
    return `<path d="${leaves}" ${st} fill="none" stroke-linecap="round"/><path d="${arcs}" ${st.replace(/stroke-width="([\d.]+)"/, (_, v) => `stroke-width="${Math.max(0.5, v / 2)}"`)} fill="none" stroke-dasharray="4 3"/>`;
  }
  const alongX = w * a >= h, n = stairSteps(s, a);
  let treads = '', arrow;
  for (let k = 1; k < n; k++) treads += alongX ? `M${L(x + (w * k) / n, y)} L${L(x + (w * k) / n, y + h)} ` : `M${L(x, y + (h * k) / n)} L${L(x + w, y + (h * k) / n)} `;
  if (alongX) {
    const cy = y + h / 2, hd = Math.min(h * 0.3, w * a * 0.12), [t0, t1] = s.flip ? [x + w * 0.92, x + w * 0.08] : [x + w * 0.08, x + w * 0.92], dir = s.flip ? -1 : 1;
    arrow = `M${L(t0, cy)} L${L(t1, cy)} M${L(t1 - (dir * hd) / a, cy - hd * 0.6)} L${L(t1, cy)} L${L(t1 - (dir * hd) / a, cy + hd * 0.6)}`;
  } else {
    const cx = x + w / 2, hd = Math.min(w * a * 0.3, h * 0.12), [t0, t1] = s.flip ? [y + h * 0.08, y + h * 0.92] : [y + h * 0.92, y + h * 0.08], dir = s.flip ? 1 : -1;
    arrow = `M${L(cx, t0)} L${L(cx, t1)} M${L(cx - (hd * 0.6) / a, t1 - dir * hd)} L${L(cx, t1)} L${L(cx + (hd * 0.6) / a, t1 - dir * hd)}`;
  }
  return `<rect x="${pc(x)}" y="${pc(y)}" width="${pc(w)}" height="${pc(h)}" ${st} ${fill}/><path d="${treads}" ${st.replace(/stroke-width="([\d.]+)"/, (_, v) => `stroke-width="${Math.max(0.5, v * 0.6)}"`)} fill="none"/>
    <path d="${arrow}" ${st} fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
}
// Steps of a stair: its own number, or about one per ~quarter of its width along the long side.
const stairSteps = (s, a) => {
  const long = Math.max(s.w * a, s.h), short = Math.min(s.w * a, s.h) || 1e-3;
  return Math.max(2, Math.min(60, Math.round(s.steps || Math.max(3, Math.min(30, (long / short) * 4)))));
};
// A poly's points on the map (0..1 of its width/height), and back: the box and the points in it.
const polyAbs = (s) => (s.pts || []).map(([u, v]) => [s.x + u * s.w, s.y + v * s.h]);
function polyFromAbs(abs) {
  const xs = abs.map((p) => p[0]), ys = abs.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
  return { x, y, w, h, pts: abs.map(([a, b]) => [w ? (a - x) / w : 0, h ? (b - y) / h : 0]) };
}
// Turns point p round c by deg (clockwise on screen) in real proportions (a = the map's aspect).
function rotPt([x, y], [cx, cy], deg, a) {
  const r = (deg * Math.PI) / 180, X = (x - cx) * a, Y = y - cy;
  return [cx + (X * Math.cos(r) - Y * Math.sin(r)) / a, cy + X * Math.sin(r) + Y * Math.cos(r)];
}
const shapeCenter = (s) => [s.x + s.w / 2, s.y + s.h / 2];
// A poly's points where they are on screen (turned), and back: points on screen -> box + pts for
// the angle rot (the points are turned back, boxed, and the box's centre turned forward again).
const polyWorld = (s, a) => (s.rot ? polyAbs(s).map((p) => rotPt(p, shapeCenter(s), s.rot, a)) : polyAbs(s));
function polyFromWorld(W, rot, a) {
  if (!rot) return polyFromAbs(W);
  const b = polyFromAbs(W.map((p) => rotPt(p, [0, 0], -rot, a)));
  const [cx, cy] = rotPt(shapeCenter(b), [0, 0], rot, a);
  return { ...b, x: cx - b.w / 2, y: cy - b.h / 2 };
}
// Turns a shape by deg: a line's ends move round its middle, everything else gets rot (-180..180).
function shapeRotate(s, deg, a) {
  if (s.type === 'line') {
    const c = [s.x + s.w / 2, s.y + s.h / 2], p = rotPt([s.x, s.y], c, deg, a), q = rotPt([s.x + s.w, s.y + s.h], c, deg, a);
    return Object.assign(s, { x: p[0], y: p[1], w: q[0] - p[0], h: q[1] - p[1] });
  }
  let r = (((((s.rot || 0) + deg) % 360) + 540) % 360) - 180;
  r = Math.round(r * 10) / 10;
  if (r) s.rot = r; else delete s.rot;
  return s;
}
// SVG transform for a turned shape: into real proportions, turn, back (viewBox is 100 x 100).
const rotAttr = (s, a) => {
  if (!s.rot) return '';
  const cx = +((s.x + s.w / 2) * 100).toFixed(3), cy = +((s.y + s.h / 2) * 100).toFixed(3);
  return ` transform="translate(${cx} ${cy}) scale(${+(1 / a).toFixed(6)} 1) rotate(${s.rot}) scale(${a} 1) translate(${-cx} ${-cy})"`;
};
// Fewer points for a freehand line (Ramer-Douglas-Peucker; tol in map heights, x in real proportions).
function simplifyPts(pts, tol, asp) {
  if (pts.length < 3) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a][0] * asp, ay = pts[a][1], bx = pts[b][0] * asp, by = pts[b][1], L = Math.hypot(bx - ax, by - ay);
    let far = -1, fd = tol;
    for (let k = a + 1; k < b; k++) {
      const px = pts[k][0] * asp, py = pts[k][1];
      const d = L ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / L : Math.hypot(px - ax, py - ay);
      if (d > fd) { fd = d; far = k; }
    }
    if (far > 0) { keep[far] = true; stack.push([a, far], [far, b]); }
  }
  return pts.filter((p, k) => keep[k]);
}
const SHAPE_COLOR = '#8aa0b8';
// Fill patterns (shape.pattern; none = solid). Drawn in a 10 x 10 cell that is square on screen
// (2 % of the map's width, so it scales with the map); c = the fill colour.
const SHAPE_PATTERNS = {
  hatch: ['Hatched ╱', (c) => `<path d="M-1,11 L11,-1 M-1,1 L1,-1 M9,11 L11,9" stroke="${c}" stroke-width="1.3"/>`],
  back: ['Hatched ╲', (c) => `<path d="M-1,-1 L11,11 M9,-1 L11,1 M-1,9 L1,11" stroke="${c}" stroke-width="1.3"/>`],
  cross: ['Crossed ╳', (c) => `<path d="M-1,11 L11,-1 M-1,1 L1,-1 M9,11 L11,9 M-1,-1 L11,11 M9,-1 L11,1 M-1,9 L1,11" stroke="${c}" stroke-width="1.1"/>`],
  grid: ['Grid ┼', (c) => `<path d="M5,0 V10 M0,5 H10" stroke="${c}" stroke-width="1.1"/>`],
  checker: ['Checkered', (c) => `<path d="M0,0 H5 V5 H0 Z M5,5 H10 V10 H5 Z" fill="${c}"/>`],
  dots: ['Dotted', (c) => `<circle cx="5" cy="5" r="1.7" fill="${c}"/>`],
};
// Colour presets for shapes and texts: floor-plan greys first, then a few clear colours.
const SHAPE_SWATCHES = [['#8aa0b8', 'Blue grey'], ['#d0d8e2', 'Light grey'], ['#ffffff', 'White'], ['#5a6472', 'Dark grey'], ['#1e2329', 'Almost black'],
  ['#d0a050', 'Wood / amber'], ['#e05a4a', 'Red'], ['#4caf6a', 'Green'], ['#4a90e2', 'Blue'], ['#f2c94c', 'Yellow'], ['#9b6ad6', 'Purple']];
// Swatches after a colour picker: data-shsw = which setting (color / fill), cur = its colour now.
const shapeSwatches = (key, cur) => `<span class="row shape-sw">${SHAPE_SWATCHES.map(([c, n]) => `<span class="swatch${(cur || '').toLowerCase() === c ? ' on' : ''}" data-shsw="${key}" data-c="${c}" title="${n}" style="background:${c}"></span>`).join('')}</span>`;
let shapeUid = 0;   // pattern ids: unique in the page, also with two map views
// Shapes selected on the Map page: S.mapShapeSel = the one selected (with handles and its own
// settings), or S.mapShapeMulti = a Set of two or more indexes (moved, nudged, turned, coloured,
// copied and deleted together; no handles). setShapeSel keeps the two in step.
const shapeSelIdx = () => (S.mapShapeMulti?.size ? [...S.mapShapeMulti] : S.mapShapeSel != null ? [S.mapShapeSel] : []);
function setShapeSel(list) {
  list = [...new Set(list)].sort((a, b) => a - b);
  S.mapShapeMulti = list.length > 1 ? new Set(list) : null;
  S.mapShapeSel = list.length === 1 ? list[0] : null;
}
// A shape's centre (a text's x/y is its centre) and the box it covers on the map, turned.
const shapeFillable = (x) => x.type === 'rect' || x.type === 'ellipse' || x.type === 'stairs' || (x.type === 'poly' && x.closed);
const shapeMid = (s) => (s.type === 'text' ? [s.x, s.y] : shapeCenter(s));
function shapeBBox(s, a) {
  let P;
  if (s.type === 'text') P = [[s.x, s.y]];
  else if (s.type === 'line') P = [[s.x, s.y], [s.x + s.w, s.y + s.h]];
  else if (s.type === 'poly') P = polyWorld(s, a);
  else {
    P = [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]];
    if (s.rot) P = P.map((p) => rotPt(p, shapeCenter(s), s.rot, a));
  }
  const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
const bboxAll = (bs) => ({ x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)), x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)) });
// With Snap on: puts the top-left corner of what you see of the shapes on the grid. A turned shape
// is stored as its unturned box turned round its centre, so snapping its stored corner put a turned
// door or stairs off the grid. Only for straight angles (0, 90, 180°): other angles never line up.
function snapShapesCorner(m, list) {
  if (m.snap === false || !list.length || list.some((x) => (x.rot || 0) % 90)) return;
  const b = bboxAll(list.map((x) => shapeBBox(x, m.aspect || 1))), dx = snapTo(m, b.x0) - b.x0, dy = snapToY(m, b.y0) - b.y0;
  for (const x of list) { x.x = Math.round((x.x + dx) * 1e4) / 1e4; x.y = Math.round((x.y + dy) * 1e4) / 1e4; }
}
// Turns several shapes deg round their common centre (each also turns itself).
function shapesRotate(list, deg, a) {
  const b = bboxAll(list.map((s) => shapeBBox(s, a))), c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  for (const s of list) {
    const o = shapeMid(s), n = rotPt(o, c, deg, a);
    s.x += n[0] - o[0];
    s.y += n[1] - o[1];
    shapeRotate(s, deg, a);
    for (const k of ['x', 'y', 'w', 'h']) if (s[k] != null) s[k] = Math.round(s[k] * 1e4) / 1e4;
  }
}
// edit = the Map page's floor-plan mode: shapes can be clicked, the selected one has handles.
const mapShapesHtml = (m, edit = false) => (m.shapes?.length || edit ? `<div class="shape-layer">${mapShapesInner(m, edit)}</div>` : '');
function mapShapesInner(m, edit) {
  const sh = m.shapes || [], draft = edit && S.mapDraft?.map === m.id ? S.mapDraft : null;
  if (!sh.length && !draft) return '';
  const pc = (v) => +(v * 100).toFixed(3), defs = [];
  const svg = sh.map((s, k) => {
    if (s.type === 'text') return '';
    const d = (edit ? ` data-shape="${k}"` : '') + (s.type !== 'line' ? rotAttr(s, m.aspect || 1) : '');
    const st = `stroke="${esc(s.color || SHAPE_COLOR)}" stroke-width="${s.width ?? 2}" vector-effect="non-scaling-stroke"`;
    if (s.type === 'line') return `<g${d}><line x1="${pc(s.x)}" y1="${pc(s.y)}" x2="${pc(s.x + s.w)}" y2="${pc(s.y + s.h)}" ${st} stroke-linecap="round"/>
      ${edit ? `<line class="hit" x1="${pc(s.x)}" y1="${pc(s.y)}" x2="${pc(s.x + s.w)}" y2="${pc(s.y + s.h)}" stroke="transparent" stroke-width="12" vector-effect="non-scaling-stroke"/>` : ''}</g>`;
    if (s.type === 'poly' && !s.closed) {
      const pts = polyAbs(s).map(([x, y]) => `${pc(x)},${pc(y)}`).join(' ');
      return `<g${d}><polyline points="${pts}" ${st} fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        ${edit ? `<polyline class="hit" points="${pts}" stroke="transparent" stroke-width="12" fill="none" vector-effect="non-scaling-stroke"/>` : ''}</g>`;
    }
    let fill = 'fill="none"';
    if (s.fill && SHAPE_PATTERNS[s.pattern]) {
      const id = `shp${++shapeUid}`;
      defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="2" height="${+(2 * (m.aspect || 1)).toFixed(3)}" viewBox="0 0 10 10" preserveAspectRatio="none">${SHAPE_PATTERNS[s.pattern][1](esc(s.fill))}</pattern>`);
      fill = `fill="url(#${id})" fill-opacity="${s.alpha ?? 0.35}"`;
    } else if (s.fill) fill = `fill="${esc(s.fill)}" fill-opacity="${s.alpha ?? 0.35}"`;
    if (s.type === 'door' || s.type === 'stairs') return `<g${d}>${doorStairsSvg(s, m.aspect || 1, pc, st, s.type === 'stairs' ? fill : 'fill="none"')}${edit ? `<rect class="hit" x="${pc(s.x)}" y="${pc(s.y)}" width="${pc(s.w)}" height="${pc(s.h)}" fill="transparent" stroke="none"/>` : ''}</g>`;
    if (s.type === 'poly') return `<polygon${d} points="${polyAbs(s).map(([x, y]) => `${pc(x)},${pc(y)}`).join(' ')}" ${st} ${fill} stroke-linejoin="round"/>`;
    return s.type === 'ellipse'
      ? `<ellipse${d} cx="${pc(s.x + s.w / 2)}" cy="${pc(s.y + s.h / 2)}" rx="${pc(s.w / 2)}" ry="${pc(s.h / 2)}" ${st} ${fill}/>`
      : `<rect${d} x="${pc(s.x)}" y="${pc(s.y)}" width="${pc(s.w)}" height="${pc(s.h)}" ${st} ${fill}/>`;
  }).join('');
  const texts = sh.map((s, k) => (s.type === 'text' ? `<div class="map-text${edit && (S.mapShapeSel === k || S.mapShapeMulti?.has(k)) ? ' sel' : ''}"${edit ? ` data-shape="${k}"` : ''} style="left:${pc(s.x)}%;top:${pc(s.y)}%;font-size:calc(${s.size || 3} * 1cqw);${s.rot ? `transform:translate(-50%,-50%) rotate(${s.rot}deg);` : ''}color:${esc(s.color || '#d0d8e2')}">${esc(s.text || '')}</div>` : '')).join('');
  // The shape being drawn (✏ Draw): its points so far, a dashed line to the mouse, the first point to close it.
  let dr = '';
  if (draft?.pts.length) {
    const all = draft.hover && !draft.free ? [...draft.pts, draft.hover] : draft.pts;
    dr = `<polyline class="draft" points="${all.map(([x, y]) => `${pc(x)},${pc(y)}`).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>`;
  }
  const first = draft?.pts.length && !draft.free ? `<div class="shape-h draft-start${draft.pts.length >= 3 ? ' can' : ''}" title="Click to close the shape" style="left:${pc(draft.pts[0][0])}%;top:${pc(draft.pts[0][1])}%"></div>` : '';
  return `<svg class="map-shapes${edit ? ' edit' : ''}" viewBox="0 0 100 100" preserveAspectRatio="none">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${svg}${dr}</svg>${texts}${edit ? shapeHandlesHtml(sh[S.mapShapeSel]) + shapeMultiHtml(m) : ''}${first}`;
}
// Several shapes selected: a dashed box round each (a text has its own outline) and one round all.
function shapeMultiHtml(m) {
  if (!S.mapShapeMulti?.size) return '';
  const pc = (v) => +(v * 100).toFixed(3), a = m.aspect || 1;
  const bs = [...S.mapShapeMulti].map((k) => m.shapes[k]).filter(Boolean).map((s) => [s, shapeBBox(s, a)]);
  if (!bs.length) return '';
  const box = (b, cls, pad) => `<div class="${cls}" style="left:calc(${pc(b.x0)}% - ${pad}px);top:calc(${pc(b.y0)}% - ${pad}px);width:calc(${pc(b.x1 - b.x0)}% + ${2 * pad}px);height:calc(${pc(b.y1 - b.y0)}% + ${2 * pad}px)"></div>`;
  return bs.filter(([s]) => s.type !== 'text').map(([, b]) => box(b, 'shape-mbox', 2)).join('') + box(bboxAll(bs.map(([, b]) => b)), 'map-selbox shape-mall', 8);
}
// The selected shape's frame and handles: 8 for a rectangle/ellipse (corners change width and
// height together, the sides only one of them) and the ⟳ handle above it, the two ends of a
// line, none for text. The frame is one box turned with the shape (CSS turns in screen pixels,
// so in real proportions like the shape), its handles placed in % of that box.
function shapeHandlesHtml(s) {
  if (!s) return '';
  const pc = (v) => +(v * 100).toFixed(3);
  if (s.type === 'line') return ['a', 'b'].map((h) => `<div class="shape-h" data-sh="${h}" style="left:${pc(h === 'a' ? s.x : s.x + s.w)}%;top:${pc(h === 'a' ? s.y : s.y + s.h)}%"></div>`).join('');
  if (s.type === 'text') return '';
  // Own shape: one round handle per point too (drag it; double-click removes it).
  const pts = s.type === 'poly' ? (s.pts || []).map(([u, v], k) => `<div class="shape-h pt" data-sh="p${k}" title="Drag to move this point, double-click to remove it" style="left:${pc(u)}%;top:${pc(v)}%"></div>`).join('') : '';
  const pos = { w: 0, '': 50, e: 100 }, posY = { n: 0, '': 50, s: 100 };
  return `<div class="shape-box" style="left:${pc(s.x + s.w / 2)}%;top:${pc(s.y + s.h / 2)}%;width:${pc(s.w)}%;height:${pc(s.h)}%${s.rot ? `;transform:translate(-50%,-50%) rotate(${s.rot}deg)` : ''}">
    <div class="map-selbox" style="inset:0;border-radius:0"></div>
    <div class="shape-rot-arm"></div><div class="shape-h rot" data-sh="rot" title="Drag to turn (Shift = 15° steps); [ ] keys turn 15°">⟳</div>`
    + ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => {
      const v = h.match(/[ns]/)?.[0] || '', u = h.match(/[ew]/)?.[0] || '';
      return `<div class="shape-h ${h}" data-sh="${h}" style="left:${pos[u]}%;top:${posY[v]}%"></div>`;
    }).join('') + pts + '</div>';
}
// Map size: drag the bar under a map to make it taller or shorter. The width follows from the
// map's shape (never wider than the page); stored per page in this browser, like the pane widths.
function mapSizeStyle(key, aspect, dflt = '') {
  const h = loadWidth(key) ? loadWidth(key) + 'px' : dflt;
  return `aspect-ratio:${aspect};--asp:${aspect};${h ? `width:min(100%, calc(${h} * ${aspect}))` : ''}`;
}
const mapResizeHtml = (key) => `<div class="map-resize" data-mapsize="${key}" title="Drag to make the map bigger or smaller · double-click to reset"></div>`;
function attachMapResize(canvas, aspect) {
  const bar = canvas.querySelector('[data-mapsize]');
  if (!bar) return;
  const key = bar.dataset.mapsize;
  bar.addEventListener('dblclick', () => { saveWidth(key, 0); render(); });
  bar.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();   // not an area selection on the map
    bar.setPointerCapture(e.pointerId);
    const z = uiZoom(), y0 = e.clientY, h0 = canvas.getBoundingClientRect().height / z;
    let h = h0;
    bar.classList.add('drag');
    const move = (ev) => { h = Math.max(120, Math.min(3000, h0 + (ev.clientY - y0) / z)); canvas.style.width = canvas.dataset.fitWidth = `min(100%, ${h * aspect}px)`; };
    const up = () => {
      bar.removeEventListener('pointermove', move);
      bar.classList.remove('drag');
      // Store the height it really got (it can't get wider than the page).
      if (h !== h0) saveWidth(key, canvas.offsetHeight);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up, { once: true });
    bar.addEventListener('pointercancel', up, { once: true });
  });
}
// ---- Zoom on a map (Map page, Scenes, a track's map, the Effects preview) -------------------------------------
// Ctrl+wheel around the mouse, or the − / + / Fit buttons; zoomed in, the map scrolls inside
// its box (drag with the middle mouse button, or the scrollbars). Positions are % of the map,
// so a zoomed map is just a wider one. S.mapZoom[key] = the factor (1 = fits the page), per
// page and map; S.mapScroll[key] = where it was scrolled to. Not saved: a browser preference.
S.mapZoom = {};
S.mapScroll = {};
const mapZoomHtml = (key) => {
  const z = S.mapZoom[key] || 1;
  return `<span class="seg map-zoom" title="Zoom the map: Ctrl+wheel over it, or these buttons. Zoomed in, drag with the middle mouse button (or use the scrollbars) to move around."><button data-mapzoom="out" title="Zoom out">−</button><button data-mapzoom="in" title="Zoom in">+</button><button data-mapzoom="fit" class="${z === 1 ? 'on' : ''}" title="Fit the whole map to the page">Fit</button></span><span class="muted mono map-zoom-pct">${z === 1 ? '' : `${Math.round(z * 100)}%`}</span>`;
};
// pane = where the − / + / Fit buttons are (default: around the map's box).
function attachMapZoom(canvas, key, pane) {
  const wrap = canvas?.parentElement;
  if (!wrap?.classList.contains('map-wrap')) return;
  pane = pane || wrap.parentElement;
  let z = S.mapZoom[key] || 1;
  // The width style the page gave the map (the size bar changes it): what "fit" goes back to.
  if (canvas.dataset.fitWidth == null) canvas.dataset.fitWidth = canvas.style.width;
  const apply = () => {
    canvas.style.width = canvas.dataset.fitWidth;
    wrap.style.height = '';
    wrap.classList.remove('zoomed');
    if (z === 1) return;
    const w0 = canvas.offsetWidth, h0 = canvas.offsetHeight;   // the size at "fit"
    canvas.style.width = `${Math.round(w0 * z)}px`;
    if (z > 1) wrap.style.height = `${h0}px`;   // the box keeps its size, the map scrolls inside it
    wrap.classList.add('zoomed');
  };
  const paintButtons = () => {
    $$('[data-mapzoom="fit"]', pane).forEach((b) => b.classList.toggle('on', z === 1));
    $$('.map-zoom-pct', pane).forEach((el) => (el.textContent = z === 1 ? '' : `${Math.round(z * 100)}%`));
  };
  // Zoom to nz, keeping the point under the mouse (cx, cy) where it is; without one, the middle.
  const zoomTo = (nz, cx, cy) => {
    nz = Math.max(0.25, Math.min(8, Math.round(nz * 100) / 100));
    if (Math.abs(nz - 1) < 0.06) nz = 1;
    const r = canvas.getBoundingClientRect(), wr = wrap.getBoundingClientRect(), uz = uiZoom();
    const fx = cx != null ? (cx - r.left) / r.width : 0.5, fy = cy != null ? (cy - r.top) / r.height : 0.5;
    const ox = cx != null ? (cx - wr.left) / uz : wr.width / uz / 2, oy = cy != null ? (cy - wr.top) / uz : wr.height / uz / 2;
    z = S.mapZoom[key] = nz;
    apply();
    wrap.scrollLeft = fx * canvas.offsetWidth - ox;
    wrap.scrollTop = fy * canvas.offsetHeight - oy;
    paintButtons();
  };
  apply();
  if (S.mapScroll[key]) [wrap.scrollLeft, wrap.scrollTop] = S.mapScroll[key];
  wrap.addEventListener('scroll', () => (S.mapScroll[key] = [wrap.scrollLeft, wrap.scrollTop]));
  $$('[data-mapzoom]', pane).forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.mapzoom;
    zoomTo(k === 'fit' ? 1 : k === 'in' ? z * 1.5 : z / 1.5);
  }));
  wrap.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomTo(z * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY);
  }, { passive: false });
  // Middle mouse button: drag the map around (the browser's own autoscroll is kept off).
  wrap.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  wrap.addEventListener('pointerdown', (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    wrap.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY, sl = wrap.scrollLeft, st = wrap.scrollTop, uz = uiZoom();
    const move = (ev) => { wrap.scrollLeft = sl - (ev.clientX - x0) / uz; wrap.scrollTop = st - (ev.clientY - y0) / uz; };
    wrap.addEventListener('pointermove', move);
    wrap.addEventListener('pointerup', () => wrap.removeEventListener('pointermove', move), { once: true });
  }, true);
}
// ---- Shapes and rotation of selected fixtures on a map --------------------------------
// Positions are 0..1 of the map's width and height; the maths works in "square" units
// (x times the map's aspect) so a circle stays round and rotation keeps distances on a wide map.
const MAP_SHAPES = [['h', 'Line ↔'], ['v', 'Line ↕'], ['d', 'Diagonal line'], ['circle', 'Circle'], ['arc', 'Half circle'], ['rect', 'Rectangle (outline)'],
  ['grid', 'Grid'], ['snake', 'Grid, zigzag wired (snake)'], ['zigzag', 'Zigzag line']];
// Shape options: order 'pos' = fixtures keep their neighbours, 'patch' = by universe/address
// (how pixels are wired); cols / rows = grid size (0 = worked out).
S.shapeOpt = { order: 'pos', cols: 0, rows: 0 };
function selBox(its, asp) {
  const xs = its.map((it) => it.x * asp), ys = its.map((it) => it.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
// Moves the whole selection back inside the map if a shape or rotation pushed it out.
function keepInside(its) {
  const pad = 0.02, fit = (k) => {
    const lo = Math.min(...its.map((it) => it[k])), hi = Math.max(...its.map((it) => it[k]));
    const d = lo < pad ? pad - lo : hi > 1 - pad ? 1 - pad - hi : 0;
    its.forEach((it) => (it[k] = Math.max(0, Math.min(1, it[k] + d))));
  };
  fit('x');
  fit('y');
}
// Columns and rows of a grid of n: as asked; one of them empty = worked out from the other,
// both empty = square-ish. More fixtures than rows x columns: extra rows.
function gridSize(n, opt = S.shapeOpt) {
  const cols = Math.max(1, Math.min(n, opt.cols || (opt.rows ? Math.ceil(n / opt.rows) : Math.ceil(Math.sqrt(n)))));
  return [cols, Math.max(Math.ceil(n / cols), Math.min(n, opt.rows || 0))];
}
// Puts the fixtures in a shape that fills the selection's area (at least a sensible size).
// Fixtures keep their neighbours: they are taken in their current order along the shape -
// or, with seq (fixture ids, the order the last shape used), in that order: reading a zigzag
// or a snake back from positions mixes it up (a zigzag read as rows = 1 3 5 7 2 4 6 8).
// Returns the fixture ids in the order they went into the shape.
function shapeItems(its, shape, asp, opt = S.shapeOpt, seq = null) {
  // Circle radius: never so big that the circle doesn't fit on the map (it would get squashed).
  const n = its.length, b = selBox(its, asp), L = Math.max(b.w, b.h, 0.3), R = Math.min(Math.max(b.w, b.h, 0.25) / 2, 0.46, 0.46 * asp);
  const used = [];
  const put = (it, x, y) => { used.push(it.fixture); it.x = x / asp; it.y = y; };
  const t = (k) => (n > 1 ? k / (n - 1) : 0.5);
  const around = (it) => Math.atan2(it.y - b.cy, it.x * asp - b.cx);
  const fromTop = (it) => (around(it) + Math.PI * 2.5) % (Math.PI * 2);   // clockwise from 12 o'clock
  // The order fixtures go into the shape: patch order, or by where they are now (cmp).
  const patch = [...its].sort((a, c) => { const fa = fixture(a.fixture), fc = fixture(c.fixture); return fa.universe - fc.universe || fa.address - fc.address; });
  const at = seq && seq.length === n ? new Map(seq.map((id, k) => [id, k])) : null;
  const kept = at && its.every((it) => at.has(it.fixture)) ? [...its].sort((a, c) => at.get(a.fixture) - at.get(c.fixture)) : null;
  const ord = (cmp) => (opt.order === 'patch' ? patch : kept || [...its].sort(cmp));
  const [cols, rows] = gridSize(n, opt);
  // Grid cell k -> x, y (snake: every other row runs back, like zigzag-wired LED matrices).
  // Rows at least as far apart as the columns, so a long row becomes a square-ish grid.
  let W = Math.max(b.w, 0.25), H = rows > 1 ? Math.max(b.h, (W * (rows - 1)) / Math.max(1, cols - 1)) : 0;
  const fit = Math.min(1, 0.88 / (H || 1), (0.92 * asp) / W);   // never bigger than the map (room for the names below)
  W *= fit;
  H *= fit;
  const cell = (k, snake) => {
    const r = Math.floor(k / cols), c0 = k % cols, c = snake && r % 2 ? cols - 1 - c0 : c0;
    return [b.cx - W / 2 + (cols > 1 ? (W * c) / (cols - 1) : W / 2), b.cy - H / 2 + (rows > 1 ? (H * r) / (rows - 1) : 0)];
  };
  // Reading order of the current positions: top row first, left to right. Rows are the
  // fixtures at (nearly) the same height now, not slices of the new column count: going from
  // 8 to 4 columns then keeps 1 2 3 4 / 5 6 7 8 instead of mixing two old rows.
  const reading = () => {
    const sorted = [...its].sort((a, c) => a.y - c.y), out = [], tol = Math.max(0.01, (b.h / Math.max(1, n)) * 0.5);
    let row = [];
    sorted.forEach((it) => {
      if (row.length && it.y - row[row.length - 1].y > tol) { out.push(...row.sort((a, c) => a.x - c.x)); row = []; }
      row.push(it);
    });
    out.push(...row.sort((a, c) => a.x - c.x));
    return out;
  };
  const Lx = Math.min(L, 0.96 * asp), Ly = Math.min(L, 0.96);   // lines fit on the map
  if (shape === 'h') ord((a, c) => a.x - c.x).forEach((it, k) => put(it, b.cx - Lx / 2 + Lx * t(k), b.cy));
  else if (shape === 'v') ord((a, c) => a.y - c.y).forEach((it, k) => put(it, b.cx, b.cy - Ly / 2 + Ly * t(k)));
  else if (shape === 'd') {
    const s = Math.min(L / Math.SQRT2, Ly, Lx);
    ord((a, c) => a.x * asp + a.y - (c.x * asp + c.y)).forEach((it, k) => put(it, b.cx - s / 2 + s * t(k), b.cy - s / 2 + s * t(k)));
  } else if (shape === 'circle') {
    // Start at the top, clockwise.
    ord((a, c) => fromTop(a) - fromTop(c)).forEach((it, k) => { const a = -Math.PI / 2 + (Math.PI * 2 * k) / n; put(it, b.cx + R * Math.cos(a), b.cy + R * Math.sin(a)); });
  } else if (shape === 'arc') {
    ord((a, c) => a.x - c.x).forEach((it, k) => { const a = Math.PI + Math.PI * t(k); put(it, b.cx + R * Math.cos(a), b.cy + R / 2 + R * Math.sin(a)); });
  } else if (shape === 'rect') {
    // Evenly round the outline, clockwise from the top-left corner (like an LED strip round a showcase).
    const RW = Math.min(Math.max(b.w, 0.25), 0.92 * asp), RH = Math.min(Math.max(b.h, 0.15), 0.92), per = 2 * (RW + RH);
    const edge = (d) => (d < RW ? [d, 0] : d < RW + RH ? [RW, d - RW] : d < 2 * RW + RH ? [RW - (d - RW - RH), RH] : [0, RH - (d - 2 * RW - RH)]);
    const fromCorner = (it) => (around(it) + Math.PI * 2 + Math.atan2(RH, RW)) % (Math.PI * 2);
    ord((a, c) => fromCorner(a) - fromCorner(c)).forEach((it, k) => { const [x, y] = edge((per * k) / n); put(it, b.cx - RW / 2 + x, b.cy - RH / 2 + y); });
  } else if (shape === 'zigzag') {
    const ZH = Math.max(b.h, 0.08);
    ord((a, c) => a.x - c.x).forEach((it, k) => put(it, b.cx - Lx / 2 + Lx * t(k), b.cy + (k % 2 ? ZH / 2 : -ZH / 2)));
  } else if (shape === 'grid' || shape === 'snake') {
    (opt.order === 'patch' ? patch : kept || reading()).forEach((it, k) => put(it, ...cell(k, shape === 'snake')));
  }
  keepInside(its);
  return used;
}
// The last shape's fixture order (S.lastShape.seq) is reused while the fixtures are where a
// shape, rotation or scaling put them; moved by hand, the order comes from the positions again.
const shapePos = (its) => its.map((it) => `${it.fixture}:${(+it.x).toFixed(4)},${(+it.y).toFixed(4)}`).join(' ');
function shapeMoved(m) {
  const ls = S.lastShape;
  if (ls && ls.map === m.id) ls.pos = shapePos(m.items.filter((it) => S.mapSel.has(it.fixture)));
}
// Rotates (ang in radians) and/or scales positions around a centre (square units), from orig.
// scale = one factor, or [sx, sy] to stretch width and height separately (before turning).
function turnItems(its, orig, c, ang, asp, scale = 1) {
  const [sx, sy] = Array.isArray(scale) ? scale : [scale, scale];
  const cos = Math.cos(ang), sin = Math.sin(ang);
  its.forEach((it, k) => {
    const dx = (orig[k].x * asp - c.x) * sx, dy = (orig[k].y - c.y) * sy;
    it.x = Math.max(0, Math.min(1, (c.x + dx * cos - dy * sin) / asp));
    it.y = Math.max(0, Math.min(1, c.y + dx * sin + dy * cos));
  });
}
// Buttons and keys: rotate by degrees / scale around the selection's centre.
function transformSel(m, deg, scale = 1) {
  const its = m.items.filter((it) => S.mapSel.has(it.fixture));
  if (its.length < 2) return;
  const b = selBox(its, m.aspect);
  turnItems(its, its.map((it) => ({ x: it.x, y: it.y })), { x: b.cx, y: b.cy }, (deg * Math.PI) / 180, m.aspect, scale);
  keepInside(its);
  shapeMoved(m);
  markDirty();
  render();
}
// The snap grid: square cells (also on a wide or tall map), m.grid of them across (2..400; a
// fraction when the size was typed in metres), grid / aspect down. m.widthM (optional) = the map's
// real width in metres: the grid is then typed in metres, and rooms go on a floor to scale.
const mapGrid = (m) => { const n = +m.grid; return n >= 2 && n <= 400 ? n : 80; };
const snapTo = (m, v) => Math.round(v * mapGrid(m)) / mapGrid(m);
const snapToY = (m, v) => { const k = mapGrid(m) / (m.aspect || 1); return Math.round(v * k) / k; };
// Lines of the snap grid over the map, one per grid square (only every k-th above 100 across).
// Drawn as SVG lines at exact places: a repeated CSS background is rounded to whole pixels per
// square, so its lines drifted away from where things snap.
function mapGridHtml(m) {
  if (m.snap === false) return '';
  const n = mapGrid(m), rows = n / (m.aspect || 1), k = Math.max(1, Math.ceil(n / 100)), q = (v) => +(v * 100).toFixed(3);
  let d = '';
  for (let i = k; i < n - 1e-6; i += k) d += `M${q(i / n)} 0V100`;
  for (let j = k; j < rows - 1e-6; j += k) d += `M0 ${q(j / rows)}H100`;
  return `<svg class="map-grid" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${d}" vector-effect="non-scaling-stroke"/></svg>`;
}
// The grid size field: metres when the map has a real width, cells across otherwise.
const mapGridVal = (m) => (m.widthM ? +(m.widthM / mapGrid(m)).toFixed(3) : Math.round(mapGrid(m)));
const fmtM = (v) => `${+(+v).toFixed(2)} m`;
// ---- Rooms, floors and the building: a map can show other maps inside it -----------------------
// m.parts = [{map: <id of another map>, x, y, w}]: that map drawn with its top-left corner at x/y
// (0..1 of this map), w of this map's width wide; its height follows from both maps' shapes. A
// floor puts its rooms together, a building its floors, so the museum can be looked at room by
// room or as a whole. m.kind ('floor' | 'building', none = a room) only names it in the lists.
// What a room holds stays on the room's own map: a floor shows it (mapView) but doesn't keep a
// copy, so moving a fixture in its room moves it on the floor too. UI only, like the shapes: the
// firmware reads each map's own fixtures (effects use a fixture's place on the first map that has
// it), so a fixture in a room takes its place in that room for effects.
const MAP_KINDS = [['room', 'Room', '▢'], ['floor', 'Floor', '▦'], ['building', 'Building', '⌂']];
const mapKind = (m) => MAP_KINDS.find(([k]) => k === m.kind) || MAP_KINDS[0];
const mapById = (id) => P().maps.find((x) => x.id === id);
// Height of a part, as a fraction of the map it is on (it keeps its own shape).
const partH = (m, pt, c) => (pt.w * (m.aspect || 1)) / (c.aspect || 1);
// Does map m hold map id (itself, or through its parts)? Such a map can't be put on id (a loop).
function mapHolds(m, id, depth = 0) {
  if (!m || depth > 8) return !!m;
  return (m.parts || []).some((pt) => pt.map === id || mapHolds(mapById(pt.map), id, depth + 1));
}
// A map with what its parts hold drawn in: {…m, items, shapes, devices, bgs, rooms}. Things from a
// part get `from` (the id of the map they are on); this map's own come last, so they are drawn on
// top and a fixture placed here itself wins over the same fixture in a room. bgs = the parts'
// background images, rooms = each part's box and name (depth 0 = this map's own parts).
function mapView(m, depth = 0) {
  if (!m?.parts?.length || depth > 4) return m;
  const out = { ...m, items: [], shapes: [], devices: [], bgs: [], rooms: [] };
  const own = new Set(m.items.map((it) => it.fixture)), seen = new Set(own);
  for (const pt of m.parts) {
    const c = mapById(pt.map);
    if (!c || c === m) continue;
    const v = mapView(c, depth + 1), h = partH(m, pt, c), X = (x) => pt.x + x * pt.w, Y = (y) => pt.y + y * h;
    if (c.background) out.bgs.push({ src: c.background, x: pt.x, y: pt.y, w: pt.w, h });
    for (const b of v.bgs || []) out.bgs.push({ src: b.src, x: X(b.x), y: Y(b.y), w: b.w * pt.w, h: b.h * h });
    for (const sh of v.shapes || []) {
      const n = { ...sh, x: X(sh.x), y: Y(sh.y), from: sh.from ?? c.id };
      if (sh.w != null) { n.w = sh.w * pt.w; n.h = sh.h * h; }
      if (sh.type === 'text') n.size = (sh.size || 3) * pt.w;
      out.shapes.push(n);
    }
    // s: drawn as much smaller as the room is here (times how small it already was).
    // d: its room has more than 40 fixtures (small dots there, so here too, whatever this map has).
    const cd = v.items.filter((it) => it.from == null).length > 40;
    for (const it of v.items) if (!seen.has(it.fixture)) { seen.add(it.fixture); out.items.push({ fixture: it.fixture, x: X(it.x), y: Y(it.y), from: it.from ?? c.id, s: (it.s ?? 1) * pt.w, d: it.d ?? cd }); }
    if (c.showDevices !== false) for (const d of v.devices || []) out.devices.push({ ...d, x: X(d.x), y: Y(d.y), from: d.from ?? c.id, s: (d.s ?? 1) * pt.w });
    for (const r of v.rooms || []) out.rooms.push({ ...r, x: X(r.x), y: Y(r.y), w: r.w * pt.w, h: r.h * h, depth: r.depth + 1 });
    out.rooms.push({ map: c.id, name: c.name, x: pt.x, y: pt.y, w: pt.w, h, depth: 0 });
  }
  out.items.push(...m.items);
  out.shapes.push(...(m.shapes || []));
  out.devices.push(...(m.devices || []));
  return out;
}
// The images of a (viewed) map: its own background and its parts' backgrounds in their boxes.
const pc4 = (v) => +(v * 100).toFixed(3);
const mapImgsHtml = (v) => (v.background ? `<img src="/media/${encodeURIComponent(v.background)}" alt="" draggable="false">` : '')
  + (v.bgs || []).map((b) => `<img class="part-bg" src="/media/${encodeURIComponent(b.src)}" alt="" draggable="false" style="left:${pc4(b.x)}%;top:${pc4(b.y)}%;width:${pc4(b.w)}%;height:${pc4(b.h)}%">`).join('');
// The rooms of a floor (and a floor's rooms on a building): a thin frame and the name, which
// opens that map (on the Live page: shows it there).
const mapRoomsHtml = (v) => (v.rooms || []).filter((r) => r.depth < 2).map((r) => `<div class="map-room${r.depth ? ' sub' : ''}" style="left:${pc4(r.x)}%;top:${pc4(r.y)}%;width:${pc4(r.w)}%;height:${pc4(r.h)}%">
  <span class="map-room-lbl" data-openmap="${r.map}" title="Open ${esc(r.name)}">${esc(r.name)}</span></div>`).join('');
// Everything a viewing page draws under the fixtures of a map.
const mapUnderHtml = (v) => mapImgsHtml(v) + mapShapesHtml(v) + mapRoomsHtml(v);
// A room's name on a floor opens that map: on the Live page as the shown map, else on the Map page.
document.addEventListener('pointerdown', (e) => { if (e.button === 0 && e.target.closest?.('[data-openmap]')) e.stopPropagation(); }, true);
document.addEventListener('click', (e) => {
  const el = e.target.closest?.('[data-openmap]');
  if (!el) return;
  const i = P().maps.findIndex((x) => x.id === +el.dataset.openmap);
  if (i < 0) return;
  if (S.view === 'live') setLiveStage(i);
  else { S.view = 'map'; S.sel.map = i; S.mapParts = false; }
  render();
});
// The map list as a tree: maps on no other map at the top, each with what is on it under it.
function mapTreeRows() {
  const p = P(), inSome = new Set(p.maps.flatMap((m) => (m.parts || []).map((pt) => pt.map)));
  const rows = [], walk = (m, depth, path) => {
    rows.push([m, depth]);
    if (depth > 4) return;
    for (const pt of m.parts || []) { const c = mapById(pt.map); if (c && !path.has(c.id)) walk(c, depth + 1, new Set([...path, c.id])); }
  };
  p.maps.filter((m) => !inSome.has(m.id)).forEach((m) => walk(m, 0, new Set([m.id])));
  // A loop of maps that are all on each other (shouldn't happen) still gets listed.
  p.maps.filter((m) => !rows.some(([x]) => x === m)).forEach((m) => rows.push([m, 0]));
  return rows;
}
// Align / distribute / snap the selected fixtures (the selection bar).
function arrangeSel(m, how) {
  const its = m.items.filter((it) => S.mapSel.has(it.fixture));
  if (!its.length) return;
  const xs = its.map((it) => it.x), ys = its.map((it) => it.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const spread = (k, lo, hi) => [...its].sort((a, b) => a[k] - b[k]).forEach((it, i, all) => (it[k] = all.length > 1 ? lo + ((hi - lo) * i) / (all.length - 1) : it[k]));
  switch (how) {
    case 'left': its.forEach((it) => (it.x = x0)); break;
    case 'hcenter': its.forEach((it) => (it.x = (x0 + x1) / 2)); break;
    case 'right': its.forEach((it) => (it.x = x1)); break;
    case 'top': its.forEach((it) => (it.y = y0)); break;
    case 'vcenter': its.forEach((it) => (it.y = (y0 + y1) / 2)); break;
    case 'bottom': its.forEach((it) => (it.y = y1)); break;
    case 'hspace': spread('x', x0, x1); break;
    case 'vspace': spread('y', y0, y1); break;
    case 'snap': its.forEach((it) => { it.x = snapTo(m, it.x); it.y = snapToY(m, it.y); }); break;
  }
  its.forEach((it) => { it.x = Math.round(it.x * 1e4) / 1e4; it.y = Math.round(it.y * 1e4) / 1e4; });
  markDirty();
  render();
}
const ARRANGE = [['left', '⇤ Left edges'], ['hcenter', '↔ Centres (one column)'], ['right', '⇥ Right edges'], ['top', '⤒ Top edges'], ['vcenter', '↕ Middles (one row)'], ['bottom', '⤓ Bottom edges'],
  ['hspace', '⟷ Space evenly left to right'], ['vspace', '⟷ Space evenly top to bottom']];
// Copy / paste positions, also to another map: the same spot of the room when both maps
// have the same shape; otherwise the same layout (square units) around the middle.
function mapCopy(m) {
  const its = m.items.filter((it) => S.mapSel.has(it.fixture));
  if (!its.length) return toast('Select fixtures on the map first', true);
  S.mapClip = { aspect: m.aspect, map: m.id, items: its.map((it) => ({ fixture: it.fixture, x: it.x, y: it.y })) };
  toast(`Copied the positions of ${its.length} fixture${its.length > 1 ? 's' : ''} - Ctrl+V on another map puts them there`);
}
function mapPaste(m) {
  const c = S.mapClip;
  if (!c?.items.length) return toast('Nothing copied yet (select fixtures, Ctrl+C)', true);
  const list = c.items.filter((x) => fixture(x.fixture));
  const k = c.aspect / m.aspect, same = Math.abs(k - 1) < 0.01;
  const put = list.map((x) => {
    let it = m.items.find((q) => q.fixture === x.fixture);
    if (!it) m.items.push((it = { fixture: x.fixture, x: 0, y: 0 }));
    Object.assign(it, { x: same ? x.x : 0.5 + (x.x - 0.5) * k, y: x.y });
    return it;
  });
  if (!same) {
    // Wider (or taller) than this map: shrink it, the same both ways, so it keeps its shape.
    const b = selBox(put, m.aspect), f = Math.min(1, (0.96 * m.aspect) / (b.w || 1), 0.96 / (b.h || 1));
    // Around its own centre (square units, not clamped yet), then moved back inside.
    if (f < 1) put.forEach((it) => { it.x = (b.cx + (it.x * m.aspect - b.cx) * f) / m.aspect; it.y = b.cy + (it.y - b.cy) * f; });
    keepInside(put);
  }
  S.mapSel = new Set(list.map((x) => x.fixture));
  toast(`Pasted ${list.length} position${list.length > 1 ? 's' : ''}${c.map === m.id ? ' (same map: back where they were copied)' : ''}`);
  markDirty();
  render();
}
// Drag on empty map space selects the fixtures in the rectangle (Shift/Ctrl adds).
// getSel/setSel read and replace the selection (a Set of fixture ids); paint() shows it.
// Returns begin(e, id): a fixture's own pointerdown calls it for Shift+drag, so an area can
// also start on a fixture (in a dense pixel grid there is hardly any empty space); without
// dragging, that Shift+click toggles fixture id.
// Alt+drag takes the area out of the selection. clearOnClick = false: a click on empty space
// keeps the selection (the timeline track map, where the selection is the track's fixtures).
function bandSelect(canvas, items, getSel, setSel, paint, done, clearOnClick = true) {
  const at = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  const begin = (e, toggleId) => {
    canvas.setPointerCapture(e.pointerId);
    const band = canvas.querySelector('.band'), a = at(e), sub = e.altKey, add = e.shiftKey || e.ctrlKey || e.metaKey || sub;
    const before = new Set(add ? getSel() : []);
    let moved = false;
    const move = (ev) => {
      const b = at(ev), r = canvas.getBoundingClientRect();
      if (!moved && Math.hypot((b.x - a.x) * r.width, (b.y - a.y) * r.height) < 4) return;   // a click, not a drag
      moved = true;
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      Object.assign(band.style, { left: x0 * 100 + '%', top: y0 * 100 + '%', width: (x1 - x0) * 100 + '%', height: (y1 - y0) * 100 + '%' });
      band.hidden = false;
      const s = new Set(before);
      for (const it of items) if (it.x >= x0 && it.x <= x1 && it.y >= y0 && it.y <= y1) sub ? s.delete(it.fixture) : s.add(it.fixture);
      setSel(s);
      paint();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', () => {
      canvas.removeEventListener('pointermove', move);
      band.hidden = true;
      if (!moved && typeof toggleId === 'function') toggleId();
      else if (!moved && toggleId != null) { const s = new Set(getSel()); s.has(toggleId) ? s.delete(toggleId) : s.add(toggleId); setSel(s); }
      else if (!moved && !add && clearOnClick) setSel(new Set());   // a click on empty space clears the selection
      done();
    }, { once: true });
  };
  canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) begin(e); });
  return begin;
}
views.map = () => {
  const p = P();
  if (S.mapShapeOf !== S.sel.map) { setShapeSel([]); S.mapShapeOf = S.sel.map; }   // another map
  if (!p.maps.length) return `<h2>Map</h2>
    <p class="muted">A map is a floor plan (an image of the venue, or an empty grid) with your fixtures placed on it, like the Layout in Pharos Designer.
      Select fixtures on it to make groups or fill timeline tracks, and see what they're doing live.</p>
    <button class="btn" data-add="map">+ Map</button>`;
  S.sel.map = Math.min(S.sel.map, p.maps.length - 1);
  const m = p.maps[S.sel.map], base = `maps.${S.sel.map}`;
  // Floor-plan mode: draw and edit shapes; S.mapShapeSel = index of the selected shape.
  const shapeMode = !!S.mapShapes;
  if (S.mapShapeSel != null && !m.shapes[S.mapShapeSel]) S.mapShapeSel = null;
  if (S.mapShapeMulti) setShapeSel([...S.mapShapeMulti].filter((k) => m.shapes[k]));
  const multi = shapeMode && S.mapShapeMulti ? [...S.mapShapeMulti].map((k) => m.shapes[k]) : null;
  const shape = shapeMode && S.mapShapeSel != null ? m.shapes[S.mapShapeSel] : null;
  // Rooms & floors mode (S.mapParts): the maps on this one are boxes to move and size (S.mapPartSel).
  // Otherwise what is in them is drawn in (mapView): their fixtures can be selected here but are
  // moved on their own map.
  const partMode = !!S.mapParts && !shapeMode, parts = m.parts || [];
  if (S.mapPartSel != null && !parts[S.mapPartSel]) S.mapPartSel = null;
  const v = mapView(m), roomItems = v === m ? [] : v.items.filter((it) => it.from != null);
  const partSel = partMode && S.mapPartSel != null ? parts[S.mapPartSel] : null, partMap = partSel && mapById(partSel.map);
  const partsHtml = parts.map((pt, k) => {
    const c = mapById(pt.map);
    return c ? `<div class="map-part${k === S.mapPartSel ? ' sel' : ''}" data-part="${k}" style="left:${pc4(pt.x)}%;top:${pc4(pt.y)}%;width:${pc4(pt.w)}%;height:${pc4(partH(m, pt, c))}%" title="${esc(c.name)}: drag to move${k === S.mapPartSel ? ', the corner to resize' : ''}">
      <span class="map-part-lbl">${mapKind(c)[2]} ${esc(c.name)}</span>${k === S.mapPartSel ? '<div class="part-h" data-parth="1" title="Drag to make it bigger or smaller (it keeps its shape)"></div>' : ''}</div>` : '';
  }).join('');
  const placed = new Set(m.items.map((it) => it.fixture));
  // The selection can hold fixtures that aren't on this map (picked in the list to drag on).
  for (const id of [...S.mapSel]) if (!fixture(id)) S.mapSel.delete(id);
  const sel = [...S.mapSel].map(fixture).filter(Boolean);
  const one = sel.length === 1 ? sel[0] : null, fi = one ? p.fixtures.indexOf(one) : -1;
  const items = roomItems.map((it) => {
    const f = fixture(it.fixture);
    return f ? mapDotHtml(f, it, ' inroom' + (S.mapSel.has(f.id) ? ' sel' : ''), m.labels !== false) : '';
  }).join('') + m.items.map((it) => {
    const f = fixture(it.fixture);
    return f ? mapDotHtml(f, it, S.mapSel.has(f.id) ? ' sel' : '', m.labels !== false) : '';
  }).join('');
  // Devices: S.mapDevSel = the key (list:name) of the selected marker on this map.
  const devs = mapDevsShown(m), onMap = new Set(devs.map(mapDevKey));
  if (S.mapDevSel && !onMap.has(S.mapDevSel)) S.mapDevSel = null;
  const devSel = S.mapDevSel && !shapeMode ? devs.find((d) => mapDevKey(d) === S.mapDevSel) : null;
  const devItems = (m.showDevices !== false ? (v.devices || []).filter((d) => d.from != null && mapDevOf(d)) : []).map((d) => mapDevHtml(d, mapDevOf(d), m.labels !== false, ' inroom')).join('')
    + devs.map((d) => mapDevHtml(d, mapDevOf(d), m.labels !== false, mapDevKey(d) === S.mapDevSel ? ' sel' : '')).join('');
  const devList = allMapDevs();
  // The left column shows fixtures & groups or the devices (S.mapSide), so neither list is far down.
  const side = S.mapSide === 'devices' ? 'devices' : 'fixtures';
  const tracks = p.timelines.flatMap((tl, ti) => tl.tracks.map((tr, ri) => `<option value="${ti}:${ri}">${esc(tl.name)} › ${esc(tr.name)}</option>`)).join('');
  // Several selected: a frame around them with a rotate handle (above) and a size handle (corner).
  const sits = m.items.filter((it) => S.mapSel.has(it.fixture)), onV = new Set(v.items.map((it) => it.fixture));
  const notOn = sel.filter((f) => !onV.has(f.id)).length;
  let selFrame = '';
  if (sits.length > 1) {
    const x0 = Math.min(...sits.map((it) => it.x)), x1 = Math.max(...sits.map((it) => it.x)), y0 = Math.min(...sits.map((it) => it.y)), y1 = Math.max(...sits.map((it) => it.y));
    const rotTop = y0 > 0.1 ? `calc(${y0 * 100}% - 34px)` : `calc(${y1 * 100}% + 34px)`;
    selFrame = `<div class="map-selbox" style="left:calc(${x0 * 100}% - 16px);top:calc(${y0 * 100}% - 16px);width:calc(${(x1 - x0) * 100}% + 32px);height:calc(${(y1 - y0) * 100}% + 32px)"></div>
      <div class="map-handle rot" id="mapRot" style="left:${((x0 + x1) / 2) * 100}%;top:${rotTop}" title="Drag to rotate (Shift = 15° steps)">⟳</div>
      <div class="map-handle size" id="mapScale" style="left:calc(${x1 * 100}% + 16px);top:calc(${y1 * 100}% + 16px)" title="Drag to stretch width and height (Shift = keep proportions)">⤡</div>`;
  }
  return `<h2>Map</h2><div class="split">
    <div>
      <div class="list map-tree">${mapTreeRows().map(([x, d]) => {
        const i = p.maps.indexOf(x), k = mapKind(x);
        return `<div class="item${i === S.sel.map ? ' sel' : ''}" data-sel="map:${i}" style="padding-left:${8 + d * 16}px"><span class="kind" title="${k[1]}">${k[2]}</span><span class="id">${x.id}</span>${esc(x.name)}<span class="muted" style="margin-left:auto" title="Fixtures on it${x.parts?.length ? ' (with the maps on it)' : ''}">${mapView(x).items.length}</span></div>`;
      }).join('')}</div>
      <div class="row" style="margin-top:8px"><button class="btn small" data-add="map">+ Map</button></div>
      <div class="seg map-side" title="What the list below shows: fixtures and groups, or devices to put on the map">${[['fixtures', 'Fixtures & groups'], ['devices', `Devices${onMap.size ? ` (${onMap.size} on map)` : ''}`]]
        .map(([v, n]) => `<button data-mapside="${v}" class="${side === v ? 'on' : ''}">${n}</button>`).join('')}</div>
      ${side === 'fixtures' ? `      <p class="muted" style="margin:0 0 6px">Drag onto the map. Click, then Shift+click (a range) or Ctrl+click (one more) to pick several and drag them on together. ● = on this map.</p>
      <div class="list map-fx">${p.fixtures.map((f) => `<div class="item${S.mapSel.has(f.id) ? ' sel' : ''}" data-mapfx="${f.id}">
        <span class="placed${placed.has(f.id) ? ' on' : ''}">${placed.has(f.id) ? '●' : '○'}</span><span style="flex:1">${esc(f.name)}</span><span class="muted mono">${f.universe}.${f.address}</span></div>`).join('') || '<span class="muted">No fixtures yet.</span>'}</div>
      <div class="row" style="margin-top:8px">
        <button class="btn small" id="mapAddFx" title="Pick from the fixture library; they are placed on this map">+ Add fixtures…</button>
        <button class="btn small" data-add="fixture-dim">+ Dimmer</button><button class="btn small" data-add="fixture-rgb">+ RGB</button><button class="btn small" data-add="fixture-rgbw">+ RGBW</button>
        ${p.fixtures.some((f) => !placed.has(f.id)) ? '<button class="btn small ghost" id="mapPlaceAll" title="Put all fixtures that are not on this map in a row at the bottom">Place the rest</button>' : ''}</div>
      <p class="muted keys">New fixtures get the next free address on universe ${p.universes[0]?.id || 1}; change it below or on the Patch page.</p>
      <h3>Groups</h3>
      <p class="muted" style="margin:0 0 6px">Click to select a group on the map, or drag it onto the map to place it there.</p>
      <div class="list">${p.groups.map((g) => {
        const on = g.fixtures.filter((id) => placed.has(id)), all = on.length && on.length === S.mapSel.size && on.every((id) => S.mapSel.has(id));
        return `<div class="item${all ? ' sel' : ''}" data-mapgrp="${g.id}" title="${on.length} of ${g.fixtures.length} on this map"><span class="id">${g.id}</span><span style="flex:1">${esc(g.name)}</span>
          <span class="tag${on.length < g.fixtures.length ? ' muted' : ''}">${on.length < g.fixtures.length ? `${on.length}/${g.fixtures.length}` : g.fixtures.length}</span></div>`;
      }).join('') || '<span class="muted">No groups yet - select fixtures on the map and use "Make group".</span>'}</div>
` : m.showDevices === false ? `<p class="muted" style="margin:0 0 6px">Devices are hidden on this map. <button class="btn small" id="mapDevShow">Show devices</button></p>`
        : `<p class="muted" style="margin:0 0 6px">Drag a projector, PC or other device onto the map: on the Live page it shows whether the device is online. ● = on this map.</p>
      <div class="list map-devs">${devList.map((d) => `<div class="item${mapDevKey(d) === S.mapDevSel ? ' sel' : ''}" data-mapdev="${esc(mapDevKey(d))}" title="${esc(d.label)}${d.x.ip ? ' · ' + esc(d.x.ip) : ''}">
        <span class="placed${onMap.has(mapDevKey(d)) ? ' on' : ''}">${onMap.has(mapDevKey(d)) ? '●' : '○'}</span>${devIcon(mapDevIcon(d.list, d.x))}<span style="flex:1">${esc(d.name)}</span><span class="muted">${esc(d.label)}</span></div>`).join('')
        || '<span class="muted">No devices yet (Devices page).</span>'}</div>`}
    </div>
    <div>
      <div class="row"><input data-p="${base}.name" value="${esc(m.name)}" style="font-size:16px;flex:1" data-r>
        <select id="mapKind" title="What this map is: a room, a floor (rooms put together) or the building (floors put together). Only for the lists; any map can hold other maps.">${MAP_KINDS.map(([k, n, ic]) => `<option value="${k}"${mapKind(m)[0] === k ? ' selected' : ''}>${ic} ${n}</option>`).join('')}</select>
        <button class="btn small ghost" data-del="${base}">Delete map</button></div>
      <div class="row map-tools">
        <label class="btn small" title="JPG/PNG/WebP/SVG, max 4 MB, stored on the storage device">${m.background ? 'Replace image' : 'Background image…'}<input type="file" id="mapBg" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden></label>
        ${m.background ? '<button class="btn small ghost" id="mapBgDel">Remove image</button>' : ''}
        <select id="mapAspect" title="Shape of the map">${ASPECTS.map(([a, n]) => `<option value="${a}"${Math.abs(a - m.aspect) < 0.01 ? ' selected' : ''}>${n}</option>`).join('')}${ASPECTS.some(([a]) => Math.abs(a - m.aspect) < 0.01) ? '' : `<option selected value="${m.aspect}">image (${(+m.aspect).toFixed(2)})</option>`}</select>
        <label class="muted" title="Fixtures and shapes jump to the grid when moved (the lines show it)"><input type="checkbox" data-p="${base}.snap" data-t="bool"${m.snap !== false ? ' checked' : ''} data-r> Snap</label>
        ${m.snap !== false ? `<label class="muted nowrap" title="${m.widthM ? 'Size of a grid square in metres' : 'How many grid squares across the map (the squares stay square)'}">Grid <input type="number" id="mapGridN" min="${m.widthM ? 0.01 : 2}" max="${m.widthM ? m.widthM / 2 : 400}" step="${m.widthM ? 0.05 : 1}" value="${mapGridVal(m)}" style="width:64px">${m.widthM ? ' m' : ' across'}</label>` : ''}
        <label class="muted nowrap" title="The real width of what this map shows, in metres (optional). Then the grid is set in metres, and rooms go on a floor to scale.">Width <input type="number" id="mapWidthM" min="0" step="0.1" value="${m.widthM || ''}" placeholder="-" style="width:64px"> m${m.widthM ? ` <span class="muted">× ${fmtM(m.widthM / m.aspect)}</span>` : ''}</label>
        ${S.mapClip?.items.length && !shapeMode ? `<button class="btn small" id="mapPaste" title="Put the copied fixtures on this map at their copied positions (Ctrl+V)">Paste ${S.mapClip.items.length} position${S.mapClip.items.length > 1 ? 's' : ''}</button>` : ''}
        <label class="muted"><input type="checkbox" data-p="${base}.labels" data-t="bool"${m.labels !== false ? ' checked' : ''} data-r> Names</label>
        <label class="muted" title="Show devices (projectors, PCs, show devices…) on this map, here and on the Live page"><input type="checkbox" data-p="${base}.showDevices" data-t="bool"${m.showDevices !== false ? ' checked' : ''} data-r> Devices</label>
        <label class="muted"><input type="checkbox" id="mapLive"${S.mapLive !== false ? ' checked' : ''}> Live</label>
        ${mapZoomHtml(`map:${m.id}`)}
        <button class="btn small${shapeMode ? ' on' : ''}" id="mapShapeMode" title="Draw walls, rooms, doors, stairs and text (a simple floor plan). While on, fixtures can't be moved.">✎ Floor plan${m.shapes.length ? ` (${m.shapes.length})` : ''}</button>
        <button class="btn small${partMode ? ' on' : ''}" id="mapPartMode" title="Put other maps (rooms) on this one, to make a floor - or floors on a building. While on, fixtures can't be moved.">▦ Rooms on this map${parts.length ? ` (${parts.length})` : ''}</button>
      </div>
      ${shapeMode ? `<div class="row map-tools"><div class="seg">${SHAPE_TOOLS.map(([v, n]) => `<button class="${(S.mapTool || 'select') === v ? 'on' : ''}" data-maptool="${v}">${n}</button>`).join('')}</div>
        <span class="muted">${(S.mapTool || 'select') === 'select' ? 'Click a shape to select it (Shift/Ctrl+click: several), drag to move, drag the handles to resize; drag on empty space to select an area.' : S.mapTool === 'door' || S.mapTool === 'stairs' ? `Click to place ${S.mapTool === 'door' ? 'a door' : 'stairs'}, or drag its size (Shift = square). Turn it with [ ] or the ⟳ handle.` : S.mapTool === 'text' ? 'Click on the map to place a text.' : S.mapTool === 'poly' ? 'Click point by point (Shift = 45° steps); click the first point to close the shape, double-click or Enter to end it open. Or hold the mouse down and draw freehand. Backspace takes the last point back, Esc cancels.' : 'Drag on the map to draw.'}</span></div>` : ''}
      ${partMode ? `<div class="row map-tools"><select id="mapPartAdd" title="Put another map on this one (a room on a floor, a floor on the building)"><option value="">+ Put a map on this one…</option>${p.maps.filter((x) => x !== m && !mapHolds(x, m.id)).map((x) => `<option value="${x.id}">${mapKind(x)[2]} ${esc(x.name)}${parts.some((pt) => pt.map === x.id) ? ' (on it already)' : ''}</option>`).join('')}</select>
        <span class="muted">Drag a room to move it, its corner to size it. With a width in metres on both maps, rooms are put on to scale.</span></div>` : ''}
      <div class="map-wrap"><div class="map-canvas${m.background ? ' has-bg' : ''}${m.snap !== false ? ' has-grid' : ''}${v.items.length > 40 ? ' dense' : ''}${shapeMode ? ' shape-mode' : ''}${partMode ? ' part-mode' : ''}${shapeMode && (S.mapTool || 'select') !== 'select' ? ' drawing' : ''}" id="mapCanvas" style="${mapSizeStyle('kd.mapH.map', m.aspect)}">
        ${mapImgsHtml(v)}
        ${mapGridHtml(m)}${v !== m ? mapShapesHtml({ aspect: m.aspect, shapes: v.shapes.filter((x) => x.from != null) }) : ''}${mapShapesHtml(m, shapeMode)}
        ${partMode ? partsHtml : mapRoomsHtml(v)}
        ${items}${devItems}${shapeMode ? '' : selFrame}<div class="band" id="mapBand" hidden></div>${mapResizeHtml('kd.mapH.map')}</div></div>
      ${shapeMode ? `<p class="muted keys">Click a shape to select · Shift/Ctrl+click adds · drag on empty space (or Shift+drag anywhere) selects an area · Ctrl+A all · drag to move · handles resize (corners: width and height, Shift = keep proportions; sides: one of them) · own shape: drag a round point, double-click a point to remove it, double-click its outline to add one · ⟳ handle or [ ] turns (Shift = 15° steps / 1°) · arrows nudge (Shift = more) · PgUp/PgDn one step forward/back (Shift = to the front/back) · Del removes · Ctrl+D duplicates · Esc deselects</p>
      ${shape ? `<div class="map-selbar"><b>${SHAPE_NAMES[shape.type]}</b>
        ${shape.type === 'text' ? `<input id="shText" value="${esc(shape.text || '')}" placeholder="Text" style="width:180px">
          <label class="muted nowrap">Size <input type="number" id="shSize" min="0.5" max="30" step="0.5" value="${shape.size || 3}" style="width:64px"></label>` : ''}
        <label class="muted nowrap" title="${shape.type === 'text' ? 'Text colour' : 'Line colour'}">${shape.type === 'text' ? 'Colour' : 'Line'} <input type="color" id="shColor" value="${esc(shape.color || (shape.type === 'text' ? '#d0d8e2' : SHAPE_COLOR))}"></label>${shapeSwatches('color', shape.color || (shape.type === 'text' ? '#d0d8e2' : SHAPE_COLOR))}
        ${shape.type !== 'text' ? `<label class="muted nowrap">Width <input type="number" id="shWidth" min="0" max="20" step="0.5" value="${shape.width ?? 2}" style="width:56px"></label>` : ''}
        ${shape.type === 'poly' ? `<label class="muted nowrap" title="Join the last point to the first (a closed shape can be filled)"><input type="checkbox" id="shClosed"${shape.closed ? ' checked' : ''}> Closed</label>` : ''}
        ${shape.type === 'door' ? `<button class="btn small" id="shFlip" title="Hinge on the other side">⇋ Flip</button>
          <label class="muted nowrap" title="Two leaves, hinged on both sides"><input type="checkbox" id="shDouble"${shape.double ? ' checked' : ''}> Double</label>` : ''}
        ${shape.type === 'stairs' ? `<label class="muted nowrap" title="Number of steps (empty = from its shape)">Steps <input type="number" id="shSteps" min="2" max="60" value="${shape.steps || ''}" placeholder="${stairSteps(shape, m.aspect)}" style="width:56px"></label>
          <button class="btn small" id="shFlip" title="The arrow points up the stairs: turn it round">⇄ Other way up</button>` : ''}
        ${shape.type === 'rect' || shape.type === 'ellipse' || shape.type === 'stairs' || (shape.type === 'poly' && shape.closed) ? `<label class="muted nowrap"><input type="checkbox" id="shFillOn"${shape.fill ? ' checked' : ''}> Fill</label>
          ${shape.fill ? `<input type="color" id="shFill" value="${esc(shape.fill)}" title="Fill colour">${shapeSwatches('fill', shape.fill)}
            <select id="shPattern" title="Fill pattern"><option value="">Solid</option>${Object.entries(SHAPE_PATTERNS).map(([v, [n]]) => `<option value="${v}"${shape.pattern === v ? ' selected' : ''}>${n}</option>`).join('')}</select>
            <input type="range" id="shAlpha" min="0.05" max="1" step="0.05" value="${shape.alpha ?? 0.35}" title="How solid the fill is" style="width:90px">` : ''}` : ''}
        ${shape.type !== 'line' ? `<label class="muted nowrap" title="Turned clockwise round its centre, in degrees ([ ] keys: 15°, Shift = 1°)">⟳ <input type="number" id="shRot" min="-180" max="180" step="1" value="${shape.rot || 0}" style="width:60px">°</label>` : ''}
        <button class="btn small" data-shrot="-90" title="Turn 90° anticlockwise">⟲ 90°</button><button class="btn small" data-shrot="90" title="Turn 90° clockwise">⟳ 90°</button>
        <span class="seg" title="Order of overlapping shapes (texts are always on top)">
          <button id="shBack" title="To the back, under all other shapes (Shift+PgDn)">⤓ Back</button><button data-shstep="-1" title="One step back (PgDn)">↓</button><button data-shstep="1" title="One step forward (PgUp)">↑</button><button id="shFront" title="To the front, over all other shapes (Shift+PgUp)">⤒ Front</button></span>
        <button class="btn small" id="shDup" title="Ctrl+D">Duplicate</button>
        <button class="btn small ghost" id="shDel">Delete</button></div>` : ''}
      ${multi ? `<div class="map-selbar"><b>${multi.length} shapes</b>
        <label class="muted nowrap" title="Line / text colour of all of them">Line <input type="color" id="shmColor" value="${esc(multi.find((x) => x.type !== 'text')?.color || SHAPE_COLOR)}"></label>${shapeSwatches('color', '')}
        ${multi.some((x) => x.type !== 'text') ? `<label class="muted nowrap">Width <input type="number" id="shmWidth" min="0" max="20" step="0.5" value="${multi.find((x) => x.type !== 'text')?.width ?? 2}" style="width:56px"></label>` : ''}
        ${multi.some(shapeFillable) ? `<span class="muted nowrap" title="Fill of the ones that can be filled">Fill</span>${shapeSwatches('fill', '')}<button class="btn small ghost" id="shmNoFill" title="No fill">∅</button>` : ''}
        <button class="btn small" data-shrot="-90" title="Turn them 90° anticlockwise round their middle">⟲ 90°</button><button class="btn small" data-shrot="90" title="Turn them 90° clockwise round their middle">⟳ 90°</button>
        <button class="btn small" id="shBack" title="All to the back">⤓ Back</button><button class="btn small" id="shFront" title="All to the front">⤒ Front</button>
        <button class="btn small" id="shDup" title="Ctrl+D">Duplicate</button>
        <button class="btn small ghost" id="shDel">Delete</button></div>` : ''}`
      : partMode ? `<p class="muted keys">Click a room to select · drag to move · corner handle sizes it · arrows nudge (Shift = more) · Del takes it off this map (the room's own map stays) · Esc deselects</p>
      ${partSel && partMap ? `<div class="map-selbar"><b>${mapKind(partMap)[2]} ${esc(partMap.name)}</b>
        <button class="btn small" data-openmap="${partMap.id}" title="Open this map, to place fixtures and draw in it">Open →</button>
        ${m.widthM && partMap.widthM ? (Math.abs(partSel.w - partMap.widthM / m.widthM) < 1e-3 ? `<span class="muted" title="${fmtM(partMap.widthM)} wide on a ${fmtM(m.widthM)} map">✓ to scale</span>` : `<button class="btn small" id="mapPartScale" title="Its size from the widths in metres (${fmtM(partMap.widthM)} on ${fmtM(m.widthM)})">To scale</button>`)
          : `<span class="muted">Give both maps a width in metres to put it on to scale</span>`}
        <label class="muted nowrap" title="How wide it is, in % of this map">Width <input type="number" id="mapPartW" min="1" max="400" step="0.5" value="${+(partSel.w * 100).toFixed(2)}" style="width:70px"> %</label>
        <button class="btn small ghost" id="mapPartRemove" title="Del">Take off this map</button></div>` : ''}`
      : `<p class="muted keys">Click to select · Ctrl+click adds one · Shift+click adds the range from the last one clicked (fixture order) · drag on empty space selects an area (Shift/Ctrl adds, Alt removes) · drag to move · arrows nudge (Shift = more) · ⟳ handle or [ ] rotates, ⤡ handle stretches (Shift = keep proportions), - + spread out (Shift = more) · Del removes from the map · Ctrl+A selects all</p>`}
      ${devSel ? `<div class="map-selbar"><span class="dev-sel">${devIcon(mapDevIcon(devSel.list, mapDevOf(devSel)))}</span><b>${esc(devSel.name)}</b>
        <span class="muted">${esc(devList.find((d) => mapDevKey(d) === S.mapDevSel)?.label || '')}${mapDevOf(devSel).ip ? ' · ' + ipLink(mapDevOf(devSel).ip) : ''} · <span id="mapDevState"></span></span>
        <button class="btn small" id="mapDevMon" title="Its card on the Monitoring page, with history and log">Open in Monitoring</button>
        <button class="btn small ghost" id="mapDevRemove" title="Del">Remove from map</button></div>` : ''}
      ${sel.length && !shapeMode ? `<div class="map-selbar">
        <b>${sel.length} selected</b>${notOn ? `<span class="muted">${notOn} not on this map yet - drag them on from the list</span>` : ''}
        <button class="btn small" id="mapGroup">Make group</button>
        ${p.groups.length ? `<select id="mapAddGroup"><option value="">Add to group…</option>${p.groups.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select>` : ''}
        ${tracks ? `<select id="mapToTrack"><option value="">Add to timeline track…</option>${tracks}</select>` : ''}
        ${sits.length > 1 ? `<select id="mapShape" title="Put the selected fixtures in a shape, in the area they cover now"><option value="">Shape…</option>${MAP_SHAPES.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>
          <select id="mapShapeOrder" title="Which fixture goes where in the shape">
            <option value="pos"${S.shapeOpt.order === 'pos' ? ' selected' : ''}>keep neighbours</option>
            <option value="patch"${S.shapeOpt.order === 'patch' ? ' selected' : ''}>in patch order (address)</option></select>
          <label class="muted nowrap" title="Columns of a grid; empty = from the rows, or square">Columns <input type="number" id="mapShapeCols" min="1" max="512" value="${S.shapeOpt.cols || ''}" placeholder="auto ${gridSize(sits.length)[0]}" style="width:72px"></label>
          <label class="muted nowrap" title="Rows of a grid; empty = from the columns, or square">Rows <input type="number" id="mapShapeRows" min="1" max="512" value="${S.shapeOpt.rows || ''}" placeholder="auto ${gridSize(sits.length)[1]}" style="width:72px"></label>
          <button class="btn small" data-rot="-15" title="Rotate 15° anticlockwise ([ key)">⟲</button><button class="btn small" data-rot="15" title="Rotate 15° clockwise (] key)">⟳</button>
          <button class="btn small" data-scale="0.9" title="Closer together (- key)">−</button><button class="btn small" data-scale="1.1" title="Further apart (+ key)">+</button>
          <span class="nowrap" title="Rotate the selection around its centre by this many degrees (minus = anticlockwise)"><input type="number" id="mapRotDeg" value="${S.mapRotDeg ?? 90}" step="1" style="width:58px">° <button class="btn small" id="mapRotGo">Rotate</button></span>
          <select id="mapArrange" title="Line the selected fixtures up, or spread them evenly"><option value="">Align…</option>${ARRANGE.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>` : ''}
        ${sits.length ? `<button class="btn small" id="mapSnapSel" title="Move the selected fixtures to the nearest grid point">Snap to grid</button>
          <button class="btn small" id="mapCopy" title="Copy their positions, to paste on another map (Ctrl+C)">Copy positions</button>` : ''}
        <button class="btn small" id="mapLocate" title="Flash the selected fixtures white for a few seconds, to find them in the room (L)">Locate</button>
        <button class="btn small ghost" id="mapRemove">Remove from map</button></div>` : ''}
      ${one && !shapeMode ? `<div class="form" style="margin-top:10px">
        <label>Name</label><input data-p="fixtures.${fi}.name" value="${esc(one.name)}" data-r>
        <label>Universe</label><select data-p="fixtures.${fi}.universe" data-t="num" data-r>${opts(p.universes, one.universe, (u) => u.id)}</select>
        <label>Address</label><input type="number" min="1" max="512" data-p="fixtures.${fi}.address" data-t="num" value="${one.address}" data-r>
        <label>Channels</label><input data-p="fixtures.${fi}.channels" data-t="list" value="${esc((one.channels || []).join(', '))}" list="chNames" data-r>
        <label></label><span class="muted">${conflicts().has(one.id) ? '<span class="bad">Address overlaps another fixture.</span>' : `Uses ${one.universe}.${one.address}–${one.address + footprint(one) - 1}`}</span>
      </div>` : ''}
    </div></div>`;
};
views.map.after = () => {
  const p = P(), m = p.maps[S.sel.map];
  if (!m) return;
  const canvas = $('#mapCanvas');
  attachMapResize(canvas, m.aspect);
  attachMapZoom(canvas, `map:${m.id}`);
  const snap = (v) => (m.snap !== false ? snapTo(m, v) : v);
  const snapY = (v) => (m.snap !== false ? snapToY(m, v) : v);
  $('#mapGridN')?.addEventListener('change', (e) => {
    const v = +e.target.value;
    if (v > 0) m.grid = +Math.max(2, Math.min(400, m.widthM ? m.widthM / v : Math.round(v))).toFixed(4);
    markDirty();
    render();
  });
  // A new width keeps the grid's size in metres when there was one (else the same squares across).
  $('#mapWidthM')?.addEventListener('change', (e) => {
    const w = Math.max(0, +e.target.value || 0), cell = m.widthM ? m.widthM / mapGrid(m) : 0;
    if (w) { m.widthM = +w.toFixed(3); if (cell) m.grid = +Math.max(2, Math.min(400, w / cell)).toFixed(4); } else delete m.widthM;
    markDirty();
    render();
  });
  $('#mapPaste')?.addEventListener('click', () => mapPaste(m));
  $('#mapCopy')?.addEventListener('click', () => mapCopy(m));
  $('#mapSnapSel')?.addEventListener('click', () => arrangeSel(m, 'snap'));
  $('#mapArrange')?.addEventListener('change', (e) => { if (e.target.value) arrangeSel(m, e.target.value); });
  $('#mapRotDeg')?.addEventListener('change', (e) => (S.mapRotDeg = +e.target.value || 0));
  $('#mapRotDeg')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { S.mapRotDeg = +e.target.value || 0; transformSel(m, S.mapRotDeg); } });
  $('#mapRotGo')?.addEventListener('click', () => { S.mapRotDeg = +$('#mapRotDeg').value || 0; transformSel(m, S.mapRotDeg); });
  $('#mapLocate')?.addEventListener('click', () => locateFixtures([...S.mapSel]));
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const at = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  const itemOf = (id) => m.items.find((it) => it.fixture === id);
  const v = mapView(m), partMode = !!S.mapParts && !S.mapShapes;
  // Shift+click on a fixture: the range from the last one clicked, in fixture order (fixture 1,
  // then Shift+click fixture 200 = 1 to 200), of the fixtures on this map; added to the selection.
  const rangeTo = (id) => {
    const on = new Set(v.items.map((it) => it.fixture)), order = p.fixtures.filter((f) => on.has(f.id)).map((f) => f.id);
    const a = order.indexOf(S.mapAnchor), b = order.indexOf(id);
    if (a < 0 || b < 0) S.mapSel.has(id) ? S.mapSel.delete(id) : S.mapSel.add(id);
    else S.mapSel = new Set([...S.mapSel, ...order.slice(Math.min(a, b), Math.max(a, b) + 1)]);
    if (a < 0) S.mapAnchor = id;
  };
  const paintSel = () => {
    $$('.mfx', canvas).forEach((el) => el.classList.toggle('sel', S.mapSel.has(+el.dataset.mfx)));
  };
  // Move / select fixtures on the map.
  $$('.mfx', canvas).forEach((el) => el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const id = +el.dataset.mfx;
    if (e.button !== 0) return;
    if (S.mapDevSel) { S.mapDevSel = null; $$('.mdev.sel', canvas).forEach((n) => n.classList.remove('sel')); }
    // Shift+drag: add an area, also when it starts on a fixture; Shift+click: the range.
    if (e.shiftKey) return bandBegin(e, () => rangeTo(id));
    if (e.ctrlKey || e.metaKey) { S.mapSel.has(id) ? S.mapSel.delete(id) : S.mapSel.add(id); S.mapAnchor = id; paintSel(); return render(); }
    S.mapAnchor = id;
    if (!S.mapSel.has(id)) { S.mapSel = new Set([id]); paintSel(); }
    // A fixture of a room on this map: selected here, moved on the room's own map.
    if (el.classList.contains('inroom')) return render();
    el.setPointerCapture(e.pointerId);
    // Items and their dots looked up once, not on every mouse move (hundreds of fixtures).
    const nodes = new Map($$('.mfx', canvas).map((n) => [+n.dataset.mfx, n]));
    const start = at(e), orig = m.items.filter((it) => S.mapSel.has(it.fixture)).map((it) => [it, { x: it.x, y: it.y }, nodes.get(it.fixture)]);
    let moved = false;
    const move = (ev) => {
      const pt = at(ev), dx = pt.x - start.x, dy = pt.y - start.y;
      if (!moved && Math.hypot(dx, dy) < 0.004) return;
      moved = true;
      for (const [it, o, node] of orig) {
        it.x = clamp01(snap(o.x + dx));
        it.y = clamp01(snapY(o.y + dy));
        node.style.left = it.x * 100 + '%';
        node.style.top = it.y * 100 + '%';
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', () => { el.removeEventListener('pointermove', move); if (moved) markDirty(); render(); }, { once: true });
  }));
  // Drag on empty space: select an area.
  // (In floor-plan mode the map edits shapes instead; fixtures can't be clicked then.)
  const bandBegin = S.mapShapes || partMode ? null : bandSelect(canvas, v.items, () => S.mapSel, (s) => (S.mapSel = s), paintSel, render);
  if (S.mapShapes) wireMapShapes(canvas, m, snap, snapY);
  else if (partMode) wireMapParts(canvas, m, snap, snapY);
  else wireMapDevices(canvas, m, snap, snapY, at);
  $('#mapShapeMode').addEventListener('click', () => { S.mapShapes = !S.mapShapes; S.mapParts = false; S.mapTool = 'select'; S.mapDraft = null; render(); });
  $('#mapPartMode').addEventListener('click', () => { S.mapParts = !partMode; S.mapShapes = false; S.mapDraft = null; render(); });
  $('#mapKind').addEventListener('change', (e) => { if (e.target.value === 'room') delete m.kind; else m.kind = e.target.value; markDirty(); render(); });
  $$('[data-maptool]').forEach((b) => b.addEventListener('click', () => { S.mapTool = b.dataset.maptool; setShapeSel([]); S.mapDraft = null; render(); }));
  // The fixture list: click selects, Ctrl+click adds/removes one, Shift+click selects the range
  // from the last click. The selection (S.mapSel, also fixtures not on this map) is the same
  // as on the map. Dragging a selected row drops all selected fixtures onto the map at once.
  const rows = $$('[data-mapfx]'), ids = rows.map((r) => +r.dataset.mapfx);
  // A long list keeps its scroll position when the page redraws (Shift+click far down).
  const fxList = $('.map-fx');
  if (fxList) {
    fxList.scrollTop = S.mapListScroll || 0;
    fxList.addEventListener('scroll', () => (S.mapListScroll = fxList.scrollTop));
  }
  $$('[data-mapside]').forEach((b) => b.addEventListener('click', () => { S.mapSide = b.dataset.mapside; render(); }));
  const clickRow = (id, e) => {
    const i = ids.indexOf(id);
    if (e.shiftKey && S.mapAnchor != null && ids.includes(S.mapAnchor)) {
      const a = ids.indexOf(S.mapAnchor), [lo, hi] = [Math.min(a, i), Math.max(a, i)];
      S.mapSel = new Set([...(e.ctrlKey || e.metaKey ? S.mapSel : []), ...ids.slice(lo, hi + 1)]);
    } else if (e.ctrlKey || e.metaKey) {
      S.mapSel.has(id) ? S.mapSel.delete(id) : S.mapSel.add(id);
      S.mapAnchor = id;
    } else { S.mapSel = new Set([id]); S.mapAnchor = id; }
    render();
  };
  // Drop: one fixture where it is let go; several in a square-ish block around that point,
  // in list order (fixture 1 top-left). Fixtures already on the map move there too.
  const dropAt = (pt, dropIds) => {
    const n = dropIds.length, cols = Math.ceil(Math.sqrt(n)), rowsN = Math.ceil(n / cols);
    const gap = n > 1 ? Math.min(0.05, 0.9 / cols, (0.9 * m.aspect) / cols) : 0;   // square units
    const placedNow = dropIds.map((id, k) => {
      const x = pt.x + (n > 1 ? ((k % cols) - (cols - 1) / 2) * gap / m.aspect : 0), y = pt.y + (n > 1 ? (Math.floor(k / cols) - (rowsN - 1) / 2) * gap : 0);
      let it = itemOf(id);
      if (!it) m.items.push((it = { fixture: id, x: 0, y: 0 }));
      Object.assign(it, n > 1 ? { x, y } : { x: snap(clamp01(x)), y: snapY(clamp01(y)) });
      return it;
    });
    keepInside(placedNow);
    S.mapSel = new Set(dropIds);
    markDirty();
  };
  rows.forEach((row) => row.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const id = +row.dataset.mapfx;
    // Dragging a selected row takes the whole selection, in list order.
    const drag = S.mapSel.has(id) && !e.shiftKey && !e.ctrlKey && !e.metaKey ? ids.filter((x) => S.mapSel.has(x)) : [id];
    let ghost = null;
    const move = (ev) => {
      if (!ghost && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
      if (!ghost) {
        ghost = document.createElement('div');
        ghost.className = 'map-ghost';
        ghost.textContent = drag.length > 1 ? `${drag.length} fixtures` : fixture(id).name;
        document.body.appendChild(ghost);
      }
      ghost.style.left = ev.clientX / uiZoom() + 'px';
      ghost.style.top = ev.clientY / uiZoom() + 'px';
    };
    const up = (ev) => {
      document.removeEventListener('pointermove', move);
      if (!ghost) return clickRow(id, e);
      ghost.remove();
      const r = canvas.getBoundingClientRect();
      if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) dropAt(at(ev), drag);
      render();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up, { once: true });
  }));
  // A group dropped on the map: the fixtures not on it yet go in a block where it is let go
  // (the ones already on it stay put); a group that is all on the map moves there whole,
  // keeping its shape (its centre lands on the drop point).
  const groupDrop = (g, pt) => {
    const gi = new Set(g.fixtures), mine = ids.filter((id) => gi.has(id));   // fixture-list order
    const missing = mine.filter((id) => !itemOf(id));
    if (missing.length) {
      dropAt(pt, missing);
      S.mapSel = new Set(mine);
      return;
    }
    const its = mine.map(itemOf), b = selBox(its, m.aspect);
    const dx = pt.x - b.cx / m.aspect, dy = pt.y - b.cy;
    for (const it of its) { it.x += dx; it.y += dy; }
    keepInside(its);
    S.mapSel = new Set(mine);
    markDirty();
  };
  $$('[data-mapgrp]').forEach((row) => row.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const g = p.groups.find((x) => x.id === +row.dataset.mapgrp);
    const n = g.fixtures.filter((id) => fixture(id)).length;
    let ghost = null;
    const move = (ev) => {
      if (!ghost && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
      if (!ghost) {
        ghost = document.createElement('div');
        ghost.className = 'map-ghost';
        ghost.textContent = `${g.name} (${n})`;
        document.body.appendChild(ghost);
      }
      ghost.style.left = ev.clientX / uiZoom() + 'px';
      ghost.style.top = ev.clientY / uiZoom() + 'px';
    };
    const up = (ev) => {
      document.removeEventListener('pointermove', move);
      if (!ghost) return clickGroup(g);
      ghost.remove();
      const r = canvas.getBoundingClientRect();
      if (n && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) groupDrop(g, at(ev));
      render();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up, { once: true });
  }));
  $('#mapAddFx')?.addEventListener('click', () => {
    S.view = 'fixtures';
    S.fxPanel = 'add';
    S.addFx.place = true;
    if (!S.addFx.universe) S.addFx.universe = p.universes[0]?.id || 1;
    render();
  });
  $('#mapPlaceAll')?.addEventListener('click', () => {
    const rest = p.fixtures.filter((f) => !itemOf(f.id));
    rest.forEach((f, i) => m.items.push({ fixture: f.id, x: snap((i + 1) / (rest.length + 1)), y: 0.9 }));
    S.mapSel = new Set(rest.map((f) => f.id));
    markDirty();
    render();
  });
  // Background image: uploaded to the stick (/media/), the map keeps the file name.
  $('#mapBg')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 4 * 1048576) return toast('Image too big (max 4 MB)', true);
    const ext = (file.name.match(/\.(png|jpe?g|webp|gif|svg)$/i)?.[1] || 'png').toLowerCase();
    const name = `map${m.id}-${Date.now().toString(36)}.${ext}`;
    try {
      const r = await fetch(`/api/media?name=${encodeURIComponent(name)}`, { method: 'PUT', body: file });
      const j = await r.json();
      if (!j.ok) throw new Error(j.reply);
      if (m.background) S.mediaTrash.add(m.background);   // deleted once the project is saved
      m.background = name;
      // Take the map's shape from the image.
      const img = new Image();
      img.onload = () => { if (img.naturalWidth && img.naturalHeight) m.aspect = +(img.naturalWidth / img.naturalHeight).toFixed(3); markDirty(); render(); };
      img.onerror = () => { markDirty(); render(); };
      img.src = URL.createObjectURL(file);
      toast('Image uploaded - save the project to keep it on the map');
    } catch (err) { toast('Upload failed: ' + err.message, true); }
  });
  $('#mapBgDel')?.addEventListener('click', () => {
    S.mediaTrash.add(m.background);
    m.background = '';
    markDirty();
    render();
  });
  $('#mapAspect').addEventListener('change', (e) => { m.aspect = +e.target.value; markDirty(); render(); });
  $('#mapLive').addEventListener('change', (e) => { S.mapLive = e.target.checked; render(); });
  $('#mapRemove')?.addEventListener('click', () => { m.items = m.items.filter((it) => !S.mapSel.has(it.fixture)); S.mapSel.clear(); markDirty(); render(); });
  $('#mapGroup')?.addEventListener('click', () => {
    const name = prompt('Name of the new group', 'Group ' + nextId(p.groups));
    if (!name) return;
    p.groups.push({ id: nextId(p.groups), name, fixtures: [...S.mapSel] });
    toast(`Group '${name}' made with ${S.mapSel.size} fixture(s)`);
    markDirty();
    render();
  });
  // Groups: click selects the group's fixtures on the map; dragging the row onto the map
  // (handled with the fixture list below, groupDrop) puts the group there.
  const clickGroup = (g) => {
    const on = g.fixtures.filter((id) => itemOf(id));
    if (!on.length) return toast(`None of '${g.name}' is on this map - drag the group onto the map`, true);
    S.mapSel = new Set(on);
    render();
  };
  $('#mapAddGroup')?.addEventListener('change', (e) => {
    const g = p.groups.find((x) => x.id === +e.target.value);
    if (!g) return;
    g.fixtures = [...new Set([...g.fixtures, ...S.mapSel])];
    toast(`Added ${S.mapSel.size} fixture(s) to ${g.name}`);
    markDirty();
    render();
  });
  $('#mapToTrack')?.addEventListener('change', (e) => {
    const [ti, ri] = e.target.value.split(':').map(Number);
    const tl = p.timelines[ti], tr = tl?.tracks[ri];
    if (!tr) return;
    tr.fixtures = [...new Set([...tr.fixtures, ...S.mapSel])];
    toast(`Added ${S.mapSel.size} fixture(s) to ${tl.name} › ${tr.name}`);
    markDirty();
    render();
  });
  // A shape is applied at once; changing the order or columns afterwards redoes it.
  const selKey = () => [...S.mapSel].sort((a, c) => a - c).join();
  const applyShape = (shape) => {
    const its = m.items.filter((it) => S.mapSel.has(it.fixture)), ls = lastHere();
    const seq = shapeItems(its, shape, m.aspect, S.shapeOpt, ls && ls.pos === shapePos(its) ? ls.seq : null);
    S.lastShape = { shape, key: selKey(), map: m.id, seq, pos: shapePos(its) };
    markDirty();
    render();
    $('#mapShape').value = shape;
  };
  const lastHere = () => { const ls = S.lastShape; return ls && ls.map === m.id && ls.key === selKey() ? ls : null; };
  const redo = () => { const ls = lastHere(); if (ls) applyShape(ls.shape); };
  if (lastHere() && $('#mapShape')) $('#mapShape').value = S.lastShape.shape;
  $('#mapShape')?.addEventListener('change', (e) => { if (e.target.value) applyShape(e.target.value); });
  $('#mapShapeOrder')?.addEventListener('change', (e) => { S.shapeOpt.order = e.target.value; redo(); });
  // Columns / rows work while typing (not only after Enter), and typing one means "make a grid":
  // it redoes the grid or snake just made, otherwise it makes a grid. The redraw replaces the
  // field, so the cursor is put back in it.
  const gridField = (id, key) => $(id)?.addEventListener('input', (e) => {
    S.shapeOpt[key] = Math.max(0, Math.min(512, Math.round(+e.target.value) || 0));
    const ls = lastHere();
    applyShape(ls && (ls.shape === 'grid' || ls.shape === 'snake') ? ls.shape : 'grid');
    const f = $(id);
    // Value set after focus = cursor at the end (number fields have no setSelectionRange).
    if (f) { f.value = ''; f.focus(); f.value = S.shapeOpt[key] || ''; }
  });
  gridField('#mapShapeCols', 'cols');
  gridField('#mapShapeRows', 'rows');
  $$('[data-rot]').forEach((b) => b.addEventListener('click', () => transformSel(m, +b.dataset.rot)));
  $$('[data-scale]').forEach((b) => b.addEventListener('click', () => transformSel(m, 0, +b.dataset.scale)));
  // The frame's handles: drag to rotate or to spread out / pull together around the centre.
  const handleDrag = (el, onMove) => el?.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    const its = m.items.filter((it) => S.mapSel.has(it.fixture)), orig = its.map((it) => ({ x: it.x, y: it.y }));
    const b = selBox(its, m.aspect), c = { x: b.cx, y: b.cy }, r = canvas.getBoundingClientRect();
    const sq = (ev) => ({ x: ((ev.clientX - r.left) / r.width) * m.aspect, y: (ev.clientY - r.top) / r.height });
    const p0 = sq(e), nodes = new Map($$('.mfx', canvas).map((n) => [+n.dataset.mfx, n]));
    const others = $$('.map-selbox, .map-handle', canvas).filter((x) => x !== el);
    let moved = false;
    const move = (ev) => {
      if (!moved) others.forEach((x) => (x.style.visibility = 'hidden'));
      moved = true;
      onMove(its, orig, c, p0, sq(ev), ev);
      for (const it of its) {
        const node = nodes.get(it.fixture);
        node.style.left = it.x * 100 + '%';
        node.style.top = it.y * 100 + '%';
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', () => { el.removeEventListener('pointermove', move); if (moved) { shapeMoved(m); markDirty(); } render(); }, { once: true });
  });
  handleDrag($('#mapRot'), (its, orig, c, p0, pt, ev) => {
    let a = Math.atan2(pt.y - c.y, pt.x - c.x) - Math.atan2(p0.y - c.y, p0.x - c.x);
    if (ev.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    turnItems(its, orig, c, a, m.aspect);
    $('#mapRot').textContent = `${Math.round(((a * 180) / Math.PI + 540) % 360 - 180)}°`;
  });
  // Size handle: width and height separately (a row only gets longer); Shift = keep the proportions.
  handleDrag($('#mapScale'), (its, orig, c, p0, pt, ev) => {
    const d0 = Math.hypot(p0.x - c.x, p0.y - c.y) || 1e-3;
    const f = (a, b) => (Math.abs(b) > 1e-3 ? Math.max(0.02, a / b) : 1);
    turnItems(its, orig, c, 0, m.aspect, ev.shiftKey ? Math.max(0.05, Math.hypot(pt.x - c.x, pt.y - c.y) / d0) : [f(pt.x - c.x, p0.x - c.x), f(pt.y - c.y, p0.y - c.y)]);
  });
  // Live: colour each fixture with what it outputs now.
  if (S.mapLive !== false) {
    const us = [...new Set(v.items.map((it) => fixture(it.fixture)?.universe).filter((u) => u != null))];
    pagePoll('mapLive', async () => {
      const dmx = {};
      try { await Promise.all(us.map(async (u) => (dmx[u] = await api('/api/dmx?u=' + u)))); } catch { return; }
      const glow = v.items.length <= 40;
      for (const el of $$('.mfx', canvas)) paintDot(el.firstElementChild, fixtureLook(fixture(+el.dataset.mfx), dmx), glow);
    }, 300);
  }
};
// Floor-plan mode on the Map page: draw shapes with the chosen tool, select / move / resize them.
// One pointerdown on the canvas (the shape layer is redrawn while dragging, so no per-shape
// listeners); snap = the map's 1/80 grid when Snap is on.
function wireMapShapes(canvas, m, snap, snapY) {
  const layer = canvas.querySelector('.shape-layer');
  const at = (e) => { const r = canvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
  const redraw = () => (layer.innerHTML = mapShapesInner(m, true));
  // Shift on a line: 0 / 45 / 90° (in real proportions, so 45° looks like 45° on a wide map).
  const lineSnap = (dx, dy) => {
    const a = Math.round(Math.atan2(dy, dx * m.aspect) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx * m.aspect, dy);
    return [(Math.cos(a) * len) / m.aspect, Math.sin(a) * len];
  };
  const drag = (e, onMove, onEnd) => {
    e.preventDefault();
    e.stopPropagation();
    canvas.setPointerCapture(e.pointerId);
    const p0 = at(e);
    let moved = false;
    const move = (ev) => {
      const pt = at(ev);
      if (!moved && Math.hypot(pt.x - p0.x, pt.y - p0.y) < 0.004) return;
      moved = true;
      onMove(p0, pt, ev);
      redraw();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', () => { canvas.removeEventListener('pointermove', move); onEnd(moved); }, { once: true });
    return p0;
  };
  // Stored with 4 decimals (no 0.6000000000000001 in project.json).
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const tidy = (s) => { for (const k of ['x', 'y', 'w', 'h']) if (s?.[k] != null) s[k] = r4(s[k]); if (s?.pts) s.pts = s.pts.map(([u, v]) => [r4(u), r4(v)]); };
  const done = (moved) => { if (moved) { shapeSelIdx().forEach((k) => tidy(m.shapes[k])); markDirty(); } render(); };
  // Drag on empty space (or Shift+drag anywhere): select the shapes wholly inside the area;
  // Shift/Ctrl adds to the selection. Without dragging: Shift+click on a shape (toggleK) adds or
  // removes it, a plain click on empty space selects nothing.
  const band = (e, toggleK) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const el = canvas.querySelector('.band'), a = at(e), r = canvas.getBoundingClientRect();
    const add = e.shiftKey || e.ctrlKey || e.metaKey, before = add ? shapeSelIdx() : [];
    const boxes = m.shapes.map((x) => shapeBBox(x, m.aspect));
    let moved = false;
    const move = (ev) => {
      const b = at(ev);
      if (!moved && Math.hypot((b.x - a.x) * r.width, (b.y - a.y) * r.height) < 4) return;
      moved = true;
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      Object.assign(el.style, { left: x0 * 100 + '%', top: y0 * 100 + '%', width: (x1 - x0) * 100 + '%', height: (y1 - y0) * 100 + '%' });
      el.hidden = false;
      setShapeSel([...before, ...boxes.flatMap((bb, k) => (bb.x0 >= x0 && bb.x1 <= x1 && bb.y0 >= y0 && bb.y1 <= y1 ? [k] : []))]);
      redraw();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', () => {
      canvas.removeEventListener('pointermove', move);
      el.hidden = true;
      if (!moved) {
        const cur = shapeSelIdx();
        if (toggleK != null) setShapeSel(cur.includes(toggleK) ? cur.filter((k) => k !== toggleK) : [...cur, toggleK]);
        else if (!add) setShapeSel([]);
      }
      render();
    }, { once: true });
  };
  // Several selected: dragging one of them moves them all (the top-left of the group snapped,
  // kept on the map as a whole).
  const groupDrag = (e) => {
    const list = shapeSelIdx().map((k) => m.shapes[k]), orig = list.map((x) => ({ x: x.x, y: x.y }));
    const b = bboxAll(list.map((x) => shapeBBox(x, m.aspect)));
    return drag(e, (p0, pt) => {
      let dx = snap(b.x0 + pt.x - p0.x) - b.x0, dy = snapY(b.y0 + pt.y - p0.y) - b.y0;
      dx = Math.max(Math.min(0, -b.x0), Math.min(Math.max(0, 1 - b.x1), dx));
      dy = Math.max(Math.min(0, -b.y0), Math.min(Math.max(0, 1 - b.y1), dy));
      list.forEach((x, i) => { x.x = orig[i].x + dx; x.y = orig[i].y + dy; });
    }, done);
  };
  // Our own double-click: the page is rebuilt after each click, so the browser's dblclick gets lost.
  // key = what was clicked; true on the second press within 350 ms and a few pixels.
  const dbl = (e, key) => {
    const l = S.mapLastDown, now = Date.now();
    S.mapLastDown = { key, t: now, x: e.clientX, y: e.clientY };
    if (l && l.key === key && now - l.t < 350 && Math.hypot(e.clientX - l.x, e.clientY - l.y) < 6) { S.mapLastDown = null; return true; }
    return false;
  };
  // ✏ Draw: S.mapDraft = { map, pts: [[x, y], …] (on the map), hover, free } until it is finished.
  // Click adds a point; holding the mouse down and moving draws freehand (all points, thinned out
  // when let go). Click on the first point closes it; a double-click or Enter ends it open.
  const finishDraft = (closed) => {
    const d = S.mapDraft;
    S.mapDraft = null;
    const pts = d?.pts || [];
    if (pts.length < (closed ? 3 : 2)) return render();
    const n = { type: 'poly', ...polyFromAbs(pts), closed: !!closed, color: SHAPE_COLOR, width: 2 };
    if (Math.hypot(n.w * m.aspect, n.h) < 0.01) return render();   // a tiny scribble
    tidy(n);
    m.shapes.push(n);
    setShapeSel([m.shapes.length - 1]);
    S.mapTool = 'select';
    markDirty();
    render();
  };
  S.mapFinishDraft = finishDraft;   // for the Enter key (views.map.keys)
  const drawPoly = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const r = canvas.getBoundingClientRect(), p = at(e);
    let d = S.mapDraft?.map === m.id ? S.mapDraft : null;
    if (d) {
      const [fx, fy] = d.pts[0], last = d.pts[d.pts.length - 1];
      // Near the first point (in screen pixels): close it.
      if (d.pts.length >= 3 && Math.hypot((p.x - fx) * r.width, (p.y - fy) * r.height) < 9) return finishDraft(true);
      if (dbl(e, 'draft')) return finishDraft(false);
      let q = [snap(p.x), snapY(p.y)];
      if (e.shiftKey) { const [dx, dy] = lineSnap(q[0] - last[0], q[1] - last[1]); q = [last[0] + dx, last[1] + dy]; }
      if (Math.hypot((q[0] - last[0]) * r.width, (q[1] - last[1]) * r.height) >= 3) d.pts.push(q);
      d.hover = null;
      return redraw();
    }
    // The first point: a click starts point-by-point drawing, a drag draws freehand.
    dbl(e, 'draft');
    d = S.mapDraft = { map: m.id, pts: [[snap(p.x), snapY(p.y)]], hover: null, free: false };
    const raw = [[p.x, p.y]];
    canvas.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const pt = at(ev);
      if (!d.free && Math.hypot((pt.x - p.x) * r.width, (pt.y - p.y) * r.height) < 5) return;
      d.free = true;
      raw.push([pt.x, pt.y]);
      d.pts = raw;
      redraw();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', () => {
      canvas.removeEventListener('pointermove', move);
      if (!d.free) return redraw();
      // Freehand: thin out the points; ending near the start closes the shape.
      const [sx, sy] = raw[0], [ex, ey] = raw[raw.length - 1];
      const close = raw.length > 3 && Math.hypot((ex - sx) * r.width, (ey - sy) * r.height) < 14;
      d.pts = simplifyPts(raw, 0.003, m.aspect);
      if (close && d.pts.length > 3) d.pts.pop();
      finishDraft(close && d.pts.length >= 3);
    }, { once: true });
  };
  // While drawing point by point: a dashed line follows the mouse (Shift = 45° steps).
  canvas.addEventListener('pointermove', (e) => {
    const d = S.mapDraft;
    if (!d || d.free || d.map !== m.id || (S.mapTool || 'select') !== 'poly') return;
    const p = at(e), last = d.pts[d.pts.length - 1];
    let q = [snap(p.x), snapY(p.y)];
    if (e.shiftKey) { const [dx, dy] = lineSnap(q[0] - last[0], q[1] - last[1]); q = [last[0] + dx, last[1] + dy]; }
    d.hover = q;
    redraw();
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.map-resize')) return;
    const tool = S.mapTool || 'select', hd = e.target.closest('[data-sh]'), hit = e.target.closest('[data-shape]');
    const s = m.shapes[S.mapShapeSel];
    if (hd && s) {
      // Resize: corners move two sides (Shift = keep proportions), sides one; line ends.
      const o = { ...s }, h = hd.dataset.sh;
      if (h[0] === 'p') {
        // A point of an own shape: drag moves it, a double-click removes it (2 stay open, 3 closed).
        // Worked on where the points are on screen, so a turned shape keeps its angle.
        const k = +h.slice(1), W = polyWorld(o, m.aspect);
        if (dbl(e, 'pt' + S.mapShapeSel + ':' + k)) {
          e.preventDefault();
          if (W.length > (s.closed ? 3 : 2)) { W.splice(k, 1); Object.assign(s, polyFromWorld(W, s.rot, m.aspect)); tidy(s); markDirty(); }
          return render();
        }
        return drag(e, (p0, pt) => { W[k] = [snap(pt.x), snapY(pt.y)]; Object.assign(s, polyFromWorld(W, s.rot, m.aspect)); }, done);
      }
      const c0 = shapeCenter(o), ang = (p) => (Math.atan2(p.y - c0[1], (p.x - c0[0]) * m.aspect) * 180) / Math.PI;
      if (h === 'rot') {
        // ⟳ handle: turn round the centre by how far the mouse went round it (Shift = 15° steps).
        return drag(e, (p0, pt, ev) => {
          let r = (o.rot || 0) + ang(pt) - ang(p0);
          if (ev.shiftKey) r = Math.round(r / 15) * 15;
          Object.assign(s, { x: o.x, y: o.y, w: o.w, h: o.h, rot: 0 });
          shapeRotate(s, r, m.aspect);
          snapShapesCorner(m, [s]);
        }, done);
      }
      return drag(e, (p0, pt, ev) => {
        if (s.type === 'line') {
          const ex = o.x + o.w, ey = o.y + o.h, fx = h === 'a' ? ex : o.x, fy = h === 'a' ? ey : o.y;   // the end that stays
          let [dx, dy] = [snap(pt.x) - fx, snapY(pt.y) - fy];
          if (ev.shiftKey) [dx, dy] = lineSnap(dx, dy);
          if (h === 'a') Object.assign(s, { x: fx + dx, y: fy + dy, w: -dx, h: -dy });
          else Object.assign(s, { w: dx, h: dy });
          return;
        }
        // A turned shape: the mouse is turned back round the old centre and the box worked out
        // there (no snapping: the grid doesn't line up with it), then its new centre turned forward.
        // (At 90° / 180° the grid does line up: the mouse is snapped first.)
        const q = o.rot ? rotPt(o.rot % 90 ? [pt.x, pt.y] : [snap(pt.x), snapY(pt.y)], c0, -o.rot, m.aspect) : [snap(pt.x), snapY(pt.y)];
        let L = o.x, R = o.x + o.w, T = o.y, B = o.y + o.h;
        if (h.includes('w')) L = q[0];
        if (h.includes('e')) R = q[0];
        if (h.includes('n')) T = q[1];
        if (h.includes('s')) B = q[1];
        if (ev.shiftKey && h.length === 2 && o.w && o.h) {
          const ax = h.includes('w') ? R : L, ay = h.includes('n') ? B : T;   // the corner that stays
          const k = Math.max(Math.abs((h.includes('w') ? L : R) - ax) / o.w, Math.abs((h.includes('n') ? T : B) - ay) / o.h);
          if (h.includes('w')) L = ax - o.w * k; else R = ax + o.w * k;
          if (h.includes('n')) T = ay - o.h * k; else B = ay + o.h * k;
        }
        const w = Math.max(0.002, Math.abs(R - L)), hh = Math.max(0.002, Math.abs(B - T));
        const [cx, cy] = o.rot ? rotPt([(L + R) / 2, (T + B) / 2], c0, o.rot, m.aspect) : [Math.min(L, R) + w / 2, Math.min(T, B) + hh / 2];
        Object.assign(s, { x: cx - w / 2, y: cy - hh / 2, w, h: hh });
      }, done);
    }
    if (tool === 'poly') return drawPoly(e);
    if (tool === 'select') {
      if (e.shiftKey) return band(e, hit ? +hit.dataset.shape : null);
      if (hit && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const k = +hit.dataset.shape, cur = shapeSelIdx();
        setShapeSel(cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]);
        return render();
      }
      if (hit && S.mapShapeMulti?.has(+hit.dataset.shape)) return groupDrag(e);
      if (!hit) return band(e, null);
    }
    if (tool !== 'select') {
      // Draw a new shape (text: placed where clicked).
      const p0 = at(e);
      const n = tool === 'text' ? { type: 'text', x: snap(p0.x), y: snapY(p0.y), text: 'Text', size: 3 }
        : { type: tool, x: snap(p0.x), y: snapY(p0.y), w: 0, h: 0, color: SHAPE_COLOR, width: 2 };
      m.shapes.push(n);
      setShapeSel([m.shapes.length - 1]);
      const x0 = n.x, y0 = n.y;   // where the drag started (snapped)
      return drag(e, (q, pt, ev) => {
        if (tool === 'text') return;
        let dx = snap(pt.x) - x0, dy = snapY(pt.y) - y0;
        if (tool === 'line') { if (ev.shiftKey) [dx, dy] = lineSnap(dx, dy); return Object.assign(n, { w: dx, h: dy }); }
        if (ev.shiftKey) { const sz = Math.max(Math.abs(dx) * m.aspect, Math.abs(dy)); dx = Math.sign(dx || 1) * (sz / m.aspect); dy = Math.sign(dy || 1) * sz; }   // square / circle
        Object.assign(n, { x: Math.min(x0, x0 + dx), y: Math.min(y0, y0 + dy), w: Math.abs(dx), h: Math.abs(dy) });
      }, (moved) => {
        // A click places a door / stairs of a usual size (real size when the map has a width).
        if ((tool === 'door' || tool === 'stairs') && (!moved || Math.hypot(n.w, n.h) < 0.01)) {
          const w = Math.min(0.5, m.widthM ? (tool === 'door' ? 0.9 : 3) / m.widthM : tool === 'door' ? 0.05 : 0.15), h = w * m.aspect * (tool === 'door' ? 1 : 0.4);
          Object.assign(n, { x: Math.max(0, Math.min(1 - w, x0 - w / 2)), y: Math.max(0, Math.min(1 - h, y0 - h / 2)), w, h });
          moved = true;
        }
        // A click without dragging draws nothing else (except a text).
        if (tool !== 'text' && (!moved || Math.hypot(n.w, n.h) < 0.01)) { m.shapes.pop(); setShapeSel([]); return render(); }
        S.mapTool = 'select';
        tidy(n);
        markDirty();
        render();
        if (tool === 'text') { const t = $('#shText'); t?.focus(); t?.select(); }
      });
    }
    if (hit) {
      // Select, and drag to move it.
      const k = +hit.dataset.shape, sh = m.shapes[k], o = { ...sh };
      setShapeSel([k]);
      if (sh.type === 'poly' && dbl(e, 'sh' + k)) {
        // Double-click on an own shape's outline: a new point on the nearest side.
        e.preventDefault();
        const abs = polyWorld(sh, m.aspect), p = at(e), n = abs.length, sides = sh.closed ? n : n - 1;
        let best = 0, bd = Infinity;
        for (let j = 0; j < sides; j++) {
          const [ax, ay] = abs[j], [bx, by] = abs[(j + 1) % n], dx = (bx - ax) * m.aspect, dy = by - ay;
          const t = Math.max(0, Math.min(1, ((p.x - ax) * m.aspect * dx + (p.y - ay) * dy) / (dx * dx + dy * dy || 1)));
          const d = Math.hypot((ax + (bx - ax) * t - p.x) * m.aspect, ay + (by - ay) * t - p.y);
          if (d < bd) { bd = d; best = j; }
        }
        abs.splice(best + 1, 0, [snap(p.x), snapY(p.y)]);
        Object.assign(sh, polyFromWorld(abs, sh.rot, m.aspect));
        tidy(sh);
        markDirty();
        return render();
      }
      redraw();
      // Snapped and kept on the map by what you see (its turned box; a line: both ends; a text:
      // its centre), not by the stored unturned box.
      const b0 = shapeBBox(o, m.aspect), bw = b0.x1 - b0.x0, bh = b0.y1 - b0.y0;
      return drag(e, (p0, pt) => {
        let x0 = snap(b0.x0 + pt.x - p0.x), y0 = snapY(b0.y0 + pt.y - p0.y);
        x0 = Math.max(Math.min(0, 1 - bw), Math.min(Math.max(0, 1 - bw), x0));
        y0 = Math.max(Math.min(0, 1 - bh), Math.min(Math.max(0, 1 - bh), y0));
        Object.assign(sh, { x: o.x + x0 - b0.x0, y: o.y + y0 - b0.y0 });
      }, done);
    }
  });
  // Several selected: what the bar sets goes to all of them (fill only to the ones that can have one).
  if (S.mapShapeMulti) {
    const list = shapeSelIdx().map((k) => m.shapes[k]);
    const setAll = (fn) => { list.forEach(fn); markDirty(); render(); };
    $('#shmColor')?.addEventListener('change', (e) => setAll((x) => (x.color = e.target.value)));
    $('#shmWidth')?.addEventListener('change', (e) => setAll((x) => { if (x.type !== 'text') x.width = Math.max(0, Math.min(20, +e.target.value || 0)); }));
    $$('[data-shsw]').forEach((el) => el.addEventListener('click', () => setAll((x) => {
      if (el.dataset.shsw === 'color') x.color = el.dataset.c;
      else if (shapeFillable(x)) { x.fill = el.dataset.c; x.alpha ??= 0.35; }
    })));
    $('#shmNoFill')?.addEventListener('click', () => setAll((x) => { delete x.fill; delete x.pattern; }));
    $$('[data-shrot]').forEach((b) => b.addEventListener('click', () => { shapesRotate(list, +b.dataset.shrot, m.aspect); snapShapesCorner(m, list); markDirty(); render(); }));
    $('#shBack').addEventListener('click', () => shapeOrder(m, -Infinity));
    $('#shFront').addEventListener('click', () => shapeOrder(m, Infinity));
    $('#shDup').addEventListener('click', () => shapeDuplicate(m));
    $('#shDel').addEventListener('click', () => shapeDelete(m));
    return;
  }
  // The selected shape's settings (typing in the text redraws only the map, keeping the focus).
  const s = m.shapes[S.mapShapeSel];
  if (!s) return;
  const set = (k, v, full) => { s[k] = v; markDirty(); full ? render() : redraw(); };
  $('#shText')?.addEventListener('input', (e) => set('text', e.target.value));
  $('#shSize')?.addEventListener('change', (e) => set('size', Math.max(0.5, Math.min(30, +e.target.value || 3))));
  $('#shColor').addEventListener('input', (e) => set('color', e.target.value));
  $('#shWidth')?.addEventListener('change', (e) => set('width', Math.max(0, Math.min(20, +e.target.value || 0))));
  $('#shRot')?.addEventListener('change', (e) => { s.rot = 0; shapeRotate(s, +e.target.value || 0, m.aspect); snapShapesCorner(m, [s]); tidy(s); markDirty(); render(); });
  $$('[data-shrot]').forEach((b) => b.addEventListener('click', () => { shapeRotate(s, +b.dataset.shrot, m.aspect); snapShapesCorner(m, [s]); tidy(s); markDirty(); render(); }));
  $('#shClosed')?.addEventListener('change', (e) => set('closed', e.target.checked, true));
  $('#shFlip')?.addEventListener('click', () => set('flip', !s.flip || undefined, true));
  $('#shDouble')?.addEventListener('change', (e) => set('double', e.target.checked || undefined, true));
  $('#shSteps')?.addEventListener('change', (e) => set('steps', Math.max(2, Math.min(60, Math.round(+e.target.value))) || undefined, true));
  $('#shFillOn')?.addEventListener('change', (e) => set('fill', e.target.checked ? s.color || SHAPE_COLOR : '', true));
  $('#shFill')?.addEventListener('input', (e) => set('fill', e.target.value));
  $('#shAlpha')?.addEventListener('input', (e) => set('alpha', +e.target.value));
  $$('[data-shsw]').forEach((el) => el.addEventListener('click', () => set(el.dataset.shsw, el.dataset.c, true)));
  $('#shPattern')?.addEventListener('change', (e) => set('pattern', e.target.value || undefined));
  $('#shBack').addEventListener('click', () => shapeOrder(m, -Infinity));
  $('#shFront').addEventListener('click', () => shapeOrder(m, Infinity));
  $$('[data-shstep]').forEach((b) => b.addEventListener('click', () => shapeOrder(m, +b.dataset.shstep)));
  $('#shDup').addEventListener('click', () => shapeDuplicate(m));
  $('#shDel').addEventListener('click', () => shapeDelete(m));
}
// Duplicate / delete / copy work on all selected shapes; the copies are selected afterwards.
const shapeClone = (x) => ({ ...x, ...(x.pts ? { pts: x.pts.map((p) => [...p]) } : {}) });
function shapeDuplicate(m) {
  const idx = shapeSelIdx();
  if (!idx.length) return;
  const n0 = m.shapes.length;
  for (const k of idx) { const c = shapeClone(m.shapes[k]); c.x = Math.min(0.98, c.x + 0.025); c.y = Math.min(0.98, c.y + 0.025); m.shapes.push(c); }
  setShapeSel(idx.map((_, i) => n0 + i));
  markDirty();
  render();
}
// Moves the selected shape d places up (later = drawn on top) or down; ±Infinity = front / back
// (several selected: all of them, keeping their order among themselves).
function shapeOrder(m, d) {
  const idx = shapeSelIdx();
  if (!idx.length) return;
  if (idx.length > 1) {
    if (Number.isFinite(d)) return;
    const sel = idx.map((k) => m.shapes[k]), rest = m.shapes.filter((_, k) => !idx.includes(k));
    m.shapes = d > 0 ? [...rest, ...sel] : [...sel, ...rest];
    setShapeSel(sel.map((x) => m.shapes.indexOf(x)));
    markDirty();
    return render();
  }
  const k = idx[0], s = m.shapes[k];
  const to = Math.max(0, Math.min(m.shapes.length - 1, k + d));
  if (to === k) return;
  m.shapes.splice(k, 1);
  m.shapes.splice(to, 0, s);
  setShapeSel([to]);
  markDirty();
  render();
}
function shapeDelete(m) {
  const idx = shapeSelIdx();
  if (!idx.length) return;
  m.shapes = m.shapes.filter((_, k) => !idx.includes(k));
  setShapeSel([]);
  markDirty();
  render();
}
// Copy / paste shapes (Ctrl+C / V in floor-plan mode), also to another map: the same place on
// the map; on the same map a little lower and to the right, so the copy is seen.
function shapeCopy(m) {
  const idx = shapeSelIdx();
  if (!idx.length) return toast('Select shapes first', true);
  S.shapeClip = { map: m.id, shapes: idx.map((k) => shapeClone(m.shapes[k])) };
  toast(`Copied ${idx.length} shape${idx.length > 1 ? 's' : ''} - Ctrl+V pastes them (also on another map)`);
}
function shapePaste(m) {
  const c = S.shapeClip;
  if (!c?.shapes.length) return toast('Nothing copied yet (select shapes, Ctrl+C)', true);
  const off = c.map === m.id ? 0.025 : 0, n0 = m.shapes.length;
  c.shapes.forEach((x) => { const n = shapeClone(x); n.x += off; n.y += off; m.shapes.push(n); });
  setShapeSel(c.shapes.map((_, i) => n0 + i));
  markDirty();
  render();
}
// Map keys: nudge, delete from map, select all.
// Rooms & floors mode on the Map page: the maps on this one (m.parts) are boxes. Drag one to
// move it (its corner snaps to the grid), drag its corner handle to size it (it keeps its shape).
function wireMapParts(canvas, m, snap, snapY) {
  const at = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.map-resize')) return;
    const el = e.target.closest('[data-part]'), hd = e.target.closest('[data-parth]');
    if (!el) { if (S.mapPartSel != null) { S.mapPartSel = null; render(); } return; }
    e.preventDefault();
    e.stopPropagation();
    const k = +el.dataset.part, pt = m.parts[k], c = mapById(pt.map), o = { ...pt }, p0 = at(e);
    if (!c) return;
    S.mapPartSel = k;
    canvas.setPointerCapture(e.pointerId);
    let moved = false;
    const move = (ev) => {
      const q = at(ev);
      if (!moved && Math.hypot(q.x - p0.x, q.y - p0.y) < 0.004) return;
      moved = true;
      if (hd) {
        // The bottom-right corner follows the mouse; the width is what fits both ways.
        const wx = q.x - o.x, wy = ((q.y - o.y) * (c.aspect || 1)) / (m.aspect || 1);
        pt.w = Math.max(0.02, Math.min(4, Math.max(wx, wy)));
      } else {
        const h = partH(m, pt, c);
        pt.x = snap(o.x + q.x - p0.x);
        pt.y = snapY(o.y + q.y - p0.y);
        // On the map when it fits (a part bigger than the map can stick out).
        if (pt.w <= 1) pt.x = Math.max(0, Math.min(1 - pt.w, pt.x));
        if (h <= 1) pt.y = Math.max(0, Math.min(1 - h, pt.y));
      }
      Object.assign(el.style, { left: pc4(pt.x) + '%', top: pc4(pt.y) + '%', width: pc4(pt.w) + '%', height: pc4(partH(m, pt, c)) + '%' });
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', () => {
      canvas.removeEventListener('pointermove', move);
      if (moved) { pt.x = r4(pt.x); pt.y = r4(pt.y); pt.w = r4(pt.w); markDirty(); }
      render();
    }, { once: true });
  });
  // Put a map on this one: to scale when both have a width in metres, else a third of it wide
  // (less when it is tall), a bit further down and right for each one already on it.
  $('#mapPartAdd')?.addEventListener('change', (e) => {
    const c = mapById(+e.target.value);
    if (!c || c === m || mapHolds(c, m.id)) return;
    let w = m.widthM && c.widthM ? c.widthM / m.widthM : 0.33;
    if (!(m.widthM && c.widthM)) w = Math.min(w, (0.6 * (c.aspect || 1)) / (m.aspect || 1));
    const off = Math.min(0.5, 0.04 * (m.parts || []).length);
    (m.parts = m.parts || []).push({ map: c.id, x: r4(Math.min(Math.max(0, 1 - w), 0.05 + off)), y: r4(Math.min(Math.max(0, 1 - partH(m, { w }, c)), 0.05 + off)), w: r4(w) });
    S.mapPartSel = m.parts.length - 1;
    // A map that holds rooms is a floor (or a building, when what it holds are floors).
    if (!m.kind) m.kind = c.kind === 'floor' ? 'building' : 'floor';
    markDirty();
    render();
  });
  const pt = m.parts?.[S.mapPartSel], c = pt && mapById(pt.map);
  if (!pt || !c) return;
  $('#mapPartScale')?.addEventListener('click', () => { pt.w = r4(c.widthM / m.widthM); markDirty(); render(); });
  $('#mapPartW')?.addEventListener('change', (e) => { const w = +e.target.value / 100; if (w > 0) { pt.w = r4(Math.max(0.01, Math.min(4, w))); markDirty(); render(); } });
  $('#mapPartRemove')?.addEventListener('click', () => mapPartRemove(m));
}
function mapPartRemove(m) {
  if (!m.parts?.[S.mapPartSel]) return;
  m.parts.splice(S.mapPartSel, 1);
  if (!m.parts.length) delete m.parts;
  S.mapPartSel = null;
  markDirty();
  render();
}
// Devices on the Map page: drag a row of the Devices list onto the map (or a marker to move it),
// click a marker to select it (S.mapDevSel). One device at a time; fixtures and devices are
// never selected together.
function wireMapDevices(canvas, m, snap, snapY, at) {
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const inside = (ev) => { const r = canvas.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom; };
  const find = (key) => (m.devices || []).find((d) => mapDevKey(d) === key);
  paintMapDevs(canvas);
  mapDevSelState();
  // Empty space: the band selection of fixtures starts there, so a selected device lets go.
  canvas.addEventListener('pointerdown', (e) => { if (S.mapDevSel && !e.target.closest('.mdev')) S.mapDevSel = null; });
  $$('.mdev', canvas).forEach((el) => el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const d = find(el.dataset.mdev);
    if (!d) return;
    S.mapSel.clear();
    S.mapDevSel = el.dataset.mdev;
    el.setPointerCapture(e.pointerId);
    const start = at(e), o = { x: d.x, y: d.y };
    let moved = false;
    const move = (ev) => {
      const pt = at(ev), dx = pt.x - start.x, dy = pt.y - start.y;
      if (!moved && Math.hypot(dx, dy) < 0.004) return;
      moved = true;
      d.x = clamp01(snap(o.x + dx));
      d.y = clamp01(snapY(o.y + dy));
      el.style.left = d.x * 100 + '%';
      el.style.top = d.y * 100 + '%';
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', () => { el.removeEventListener('pointermove', move); if (moved) markDirty(); render(); }, { once: true });
  }));
  $$('[data-mapdev]').forEach((row) => row.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const key = row.dataset.mapdev, [list, ...n] = key.split(':'), name = n.join(':');
    let ghost = null;
    const move = (ev) => {
      if (!ghost && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
      if (!ghost) {
        ghost = document.createElement('div');
        ghost.className = 'map-ghost';
        ghost.textContent = name;
        document.body.appendChild(ghost);
      }
      ghost.style.left = ev.clientX / uiZoom() + 'px';
      ghost.style.top = ev.clientY / uiZoom() + 'px';
    };
    const up = (ev) => {
      document.removeEventListener('pointermove', move);
      if (ghost) {
        ghost.remove();
        if (!inside(ev)) return;
        const pt = at(ev);
        let d = find(key);
        if (!d) (m.devices = m.devices || []).push((d = { list, name, x: 0, y: 0 }));
        d.x = clamp01(snap(pt.x));
        d.y = clamp01(snapY(pt.y));
        markDirty();
      }
      // A click selects the marker when it is on the map already.
      S.mapSel.clear();
      S.mapDevSel = find(key) ? key : null;
      render();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up, { once: true });
  }));
  $('#mapDevShow')?.addEventListener('click', () => { m.showDevices = true; markDirty(); render(); });
  $('#mapDevRemove')?.addEventListener('click', () => mapDevRemove(m));
  $('#mapDevMon')?.addEventListener('click', () => { const [list, ...n] = S.mapDevSel.split(':'); openDeviceMonitor(list, n.join(':')); });
}
function mapDevRemove(m) {
  m.devices = (m.devices || []).filter((d) => mapDevKey(d) !== S.mapDevSel);
  S.mapDevSel = null;
  markDirty();
  render();
}
// The selected device's state in the bar under the map (refreshed with the status).
function mapDevSelState() {
  const el = $('#mapDevState');
  if (!el || !S.mapDevSel) return;
  const [list, ...n] = S.mapDevSel.split(':'), x = (P()[list] || []).find((y) => y.name === n.join(':'));
  if (!x) return;
  const r = mapDevStatus(list, x);
  el.innerHTML = `<span class="dot ${r.state === 'online' ? 'ok' : r.state === 'offline' ? 'bad' : ''}"></span> ${esc(r.state)}${r.extra ? ' · ' + esc(r.extra) : ''}`;
}
views.map.keys = (e) => {
  const m = P()?.maps[S.sel.map];
  if (!m) return;
  // Rooms & floors mode: arrows nudge the selected room, Del takes it off, Esc lets go.
  if (S.mapParts && !S.mapShapes) {
    const pt = m.parts?.[S.mapPartSel], st = e.shiftKey ? 0.025 : 0.005;
    const d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
    if (e.key === 'Escape') { S.mapPartSel = null; return render(); }
    if (!pt) return;
    if (d) { e.preventDefault(); pt.x = Math.round((pt.x + d[0]) * 1e4) / 1e4; pt.y = Math.round((pt.y + d[1]) * 1e4) / 1e4; markDirty(); return render(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return mapPartRemove(m); }
    return;
  }
  // A selected device: arrows nudge it, Del removes it from the map, Esc lets go.
  const dv = !S.mapShapes && S.mapDevSel && (m.devices || []).find((d) => mapDevKey(d) === S.mapDevSel);
  if (dv) {
    const st = e.shiftKey ? 0.025 : 0.005;
    const d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
    if (d) { e.preventDefault(); dv.x = Math.max(0, Math.min(1, dv.x + d[0])); dv.y = Math.max(0, Math.min(1, dv.y + d[1])); markDirty(); return render(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return mapDevRemove(m); }
    if (e.key === 'Escape') { S.mapDevSel = null; return render(); }
  }
  if (S.mapShapes) {
    // Floor-plan mode: the keys work on the selected shape(s).
    const list = shapeSelIdx().map((k) => m.shapes[k]).filter(Boolean), s = list.length === 1 ? list[0] : null, st = e.shiftKey ? 0.025 : 0.005;
    const d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
    const dr = S.mapDraft?.map === m.id ? S.mapDraft : null, mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (dr) {
      // Drawing an own shape: Enter ends it (open), Backspace takes the last point back, Esc cancels.
      if (e.key === 'Enter') { e.preventDefault(); S.mapFinishDraft?.(false); }
      else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); dr.pts.pop(); if (!dr.pts.length) S.mapDraft = null; render(); }
      else if (e.key === 'Escape') { S.mapDraft = null; render(); }
      return;
    }
    if (e.key === 'Escape') { S.mapTool = 'select'; setShapeSel([]); return render(); }
    if (mod && k === 'a') { e.preventDefault(); S.mapTool = 'select'; setShapeSel(m.shapes.map((_, i) => i)); return render(); }
    if (mod && k === 'v') { e.preventDefault(); return shapePaste(m); }
    if (!list.length) return;
    if (mod && k === 'c') { e.preventDefault(); return shapeCopy(m); }
    if (d) { e.preventDefault(); list.forEach((x) => { x.x = Math.round((x.x + d[0]) * 1e4) / 1e4; x.y = Math.round((x.y + d[1]) * 1e4) / 1e4; }); markDirty(); render(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); shapeDelete(m); }
    else if (e.key === '[' || e.key === ']' || e.key === '{' || e.key === '}') {
      // Turn 15° (Shift = 1°; Shift+[ arrives as { on most keyboards); several: round their middle.
      e.preventDefault();
      const deg = (e.key === '[' || e.key === '{' ? -1 : 1) * (e.shiftKey ? 1 : 15);
      if (s) { shapeRotate(s, deg, m.aspect); for (const q of ['x', 'y', 'w', 'h']) if (s[q] != null) s[q] = Math.round(s[q] * 1e4) / 1e4; } else shapesRotate(list, deg, m.aspect);
      snapShapesCorner(m, list);
      markDirty();
      render();
    }
    else if (mod && k === 'd') { e.preventDefault(); shapeDuplicate(m); }
    else if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); shapeOrder(m, (e.key === 'PageUp' ? 1 : -1) * (e.shiftKey || !s ? Infinity : 1)); }
    return;
  }
  const its = m.items.filter((it) => S.mapSel.has(it.fixture));
  const step = e.shiftKey ? 0.025 : 0.005;
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (d && its.length) {
    e.preventDefault();
    its.forEach((it) => { it.x = Math.max(0, Math.min(1, it.x + d[0])); it.y = Math.max(0, Math.min(1, it.y + d[1])); });
    markDirty();
    render();
  } else if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && its.length > 1) {
    e.preventDefault();
    transformSel(m, (e.code === 'BracketLeft' ? -1 : 1) * (e.shiftKey ? 15 : 5));
  } else if (['-', '+', '=', '_'].includes(e.key) && its.length > 1 && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    const out = e.key === '+' || e.key === '=';
    transformSel(m, 0, out ? (e.shiftKey ? 1.25 : 1.05) : (e.shiftKey ? 0.8 : 0.95));
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && its.length) {
    e.preventDefault();
    m.items = m.items.filter((it) => !S.mapSel.has(it.fixture));
    S.mapSel.clear();
    markDirty();
    render();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    S.mapSel = new Set(mapView(m).items.map((it) => it.fixture));
    render();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); mapCopy(m); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); mapPaste(m); }
  else if (e.key.toLowerCase() === 'l' && !e.ctrlKey && !e.metaKey && !e.altKey && S.mapSel.size) { e.preventDefault(); locateFixtures([...S.mapSel]); }
};

// ---- Colour wheel: hue = angle, saturation = distance from the centre, plus brightness.
// Keyboard (when focused): ←/→ hue, ↑/↓ saturation (Shift = bigger steps), PgUp/PgDn
// brightness, 1-9 and 0 the palette, Home = white. Colour maths is in app-core.js.
const PALETTE = ['#ffffff', '#ffb347', '#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#00c7be', '#0a84ff', '#5e5ce6', '#ff2d92'];
// The sliders under the wheel as R G B (0-255) or H S V (0-360, 0-100 %); the choice is kept per browser.
// Each slider's track shows the colour you get along it (painted in attachColorWheel).
const cwMode = () => { try { return localStorage.getItem('kd.cwMode') || 'rgb'; } catch { return 'rgb'; } };
const cwSliders = (cls, parts) => `<div class="cw-sls ${cls}">${parts.map(([c, mx, tip], k) => `<div class="cw-sl" title="${tip}"><span class="muted">${c}</span>
  <input type="range" class="cw-grad" min="0" max="${mx}" data-k="${k}"><input type="number" min="0" max="${mx}" data-k="${k}"></div>`).join('')}</div>`;
function colorWheelHtml(id, hex) {
  const [r, g, b] = hexToRgb(hex), mode = cwMode();
  return `<div class="cw${mode === 'hsv' ? ' hsv' : ''}" data-cw="${id}" tabindex="0" title="←/→ hue · ↑/↓ saturation · PgUp/PgDn brightness · 1-9, 0 palette · Home white">
    <div class="cw-disc"><canvas width="150" height="150"></canvas><i class="cw-dot"></i></div>
    <div class="cw-side">
      <div class="row nowrap"><span class="cw-sw" style="background:${hex}"></span><input class="cw-hex mono" value="${hex}" maxlength="7" spellcheck="false">
        <div class="seg cw-mode">${['rgb', 'hsv'].map((m) => `<button type="button" class="${mode === m ? 'on' : ''}" data-cwmode="${m}" title="Show the colour as ${m.toUpperCase()}">${m.toUpperCase()}</button>`).join('')}</div></div>
      <label class="muted cw-lbl">Brightness <input type="range" class="cw-v" min="0" max="100" value="${Math.round(rgbToHsv(r, g, b)[2] * 100)}"></label>
      ${cwSliders('cw-rgb', [['R', 255, 'Red 0-255'], ['G', 255, 'Green 0-255'], ['B', 255, 'Blue 0-255']])}
      ${cwSliders('cw-hsv', [['H', 360, 'Hue 0-360°'], ['S', 100, 'Saturation 0-100 %'], ['V', 100, 'Value (brightness) 0-100 %']])}
      <div class="cw-pal">${cwPalHtml()}</div>
    </div></div>`;
}
let wheelImg = null;
// Wires a wheel. onChange(hex, done): done = false while dragging/typing, true when settled.
function attachColorWheel(el, hex, onChange) {
  const cv = el.querySelector('canvas'), ctx = cv.getContext('2d'), R = cv.width / 2;
  if (!wheelImg) {
    wheelImg = ctx.createImageData(cv.width, cv.height);
    for (let y = 0; y < cv.height; y++)
      for (let x = 0; x < cv.width; x++) {
        const dx = x - R, dy = y - R, d = Math.hypot(dx, dy) / R, o = (y * cv.width + x) * 4;
        if (d > 1) continue;
        const [r, g, b] = KDFX.hsv(((Math.atan2(dy, dx) / (Math.PI * 2)) + 1) % 1, d, 1);
        wheelImg.data.set([r * 255, g * 255, b * 255, 255], o);
      }
  }
  let [h, s, v] = rgbToHsv(...hexToRgb(hex));
  const dot = el.querySelector('.cw-dot');
  const paint = (done) => {
    ctx.putImageData(wheelImg, 0, 0);
    ctx.fillStyle = `rgba(0,0,0,${1 - v})`;
    ctx.beginPath(); ctx.arc(R, R, R, 0, Math.PI * 2); ctx.fill();
    const a = (h / 360) * Math.PI * 2;
    dot.style.left = (50 + Math.cos(a) * s * 50) + '%';
    dot.style.top = (50 + Math.sin(a) * s * 50) + '%';
    const hx = hsvToHex(h, s, v), [r, g, b] = hexToRgb(hx);
    el.querySelector('.cw-sw').style.background = hx;
    if (document.activeElement !== el.querySelector('.cw-hex')) el.querySelector('.cw-hex').value = hx;
    el.querySelector('.cw-v').value = Math.round(v * 100);
    el.querySelectorAll('.cw-rgb input').forEach((i) => { if (document.activeElement !== i) i.value = [r, g, b][+i.dataset.k]; });
    el.querySelectorAll('.cw-hsv input').forEach((i) => { if (document.activeElement !== i) i.value = Math.round([h, s * 100, v * 100][+i.dataset.k]); });
    // Track gradients: what each slider gives with the other two as they are now.
    const grad = (cols) => `linear-gradient(to right, ${cols.join(', ')})`;
    const rgbG = [0, 1, 2].map((k) => grad([0, 255].map((x) => { const c = [r, g, b]; c[k] = x; return `rgb(${c.join(',')})`; })));
    const hsvG = [grad([0, 60, 120, 180, 240, 300, 360].map((x) => hsvToHex(x, 1, 1))), grad([hsvToHex(h, 0, v), hsvToHex(h, 1, v)]), grad(['#000', hsvToHex(h, s, 1)])];
    el.querySelectorAll('.cw-rgb .cw-grad').forEach((i) => (i.style.background = rgbG[+i.dataset.k]));
    el.querySelectorAll('.cw-hsv .cw-grad').forEach((i) => (i.style.background = hsvG[+i.dataset.k]));
    if (done != null) onChange(hx, done);
  };
  const setHex = (hx, done) => { if (!/^#[0-9a-f]{6}$/i.test(hx)) return; [h, s, v] = rgbToHsv(...hexToRgb(hx)); paint(done); };
  const pick = (e, done) => {
    const r = cv.getBoundingClientRect(), dx = (e.clientX - r.left) / r.width * 2 - 1, dy = (e.clientY - r.top) / r.height * 2 - 1;
    h = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
    s = Math.min(1, Math.hypot(dx, dy));
    if (v < 0.05) v = 1;
    paint(done);
  };
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    el.focus({ preventScroll: true });
    pick(e, false);
    const mv = (ev) => pick(ev, false);
    cv.addEventListener('pointermove', mv);
    cv.addEventListener('pointerup', (ev) => { cv.removeEventListener('pointermove', mv); pick(ev, true); }, { once: true });
  });
  el.querySelector('.cw-v').addEventListener('input', (e) => { v = e.target.value / 100; paint(false); });
  el.querySelector('.cw-v').addEventListener('change', () => paint(true));
  el.querySelector('.cw-hex').addEventListener('change', (e) => setHex(e.target.value.trim().toLowerCase(), true));
  // Slider and number of one row move together: dragging = live, letting go / typing = settled.
  const sliderRows = (cls, apply) => el.querySelectorAll(`.${cls} input`).forEach((i) => {
    const read = () => [0, 1, 2].map((k) => +(i.dataset.k == k ? i.value : el.querySelector(`.${cls} input[type=number][data-k="${k}"]`).value) || 0);
    if (i.type === 'range') i.addEventListener('input', () => apply(read(), false));
    i.addEventListener('change', () => apply(read(), true));
  });
  sliderRows('cw-rgb', (c, done) => { [h, s, v] = rgbToHsv(...c.map((x) => Math.max(0, Math.min(255, x)))); paint(done); });
  sliderRows('cw-hsv', ([hh, ss, vv], done) => {
    h = ((hh % 360) + 360) % 360; s = Math.max(0, Math.min(1, ss / 100)); v = Math.max(0, Math.min(1, vv / 100));
    paint(done);
  });
  el.querySelectorAll('[data-cwmode]').forEach((b) => b.addEventListener('click', () => {
    try { localStorage.setItem('kd.cwMode', b.dataset.cwmode); } catch { /* private window */ }
    // Every wheel on the page follows.
    for (const w of $$('.cw')) {
      w.classList.toggle('hsv', b.dataset.cwmode === 'hsv');
      w.querySelectorAll('[data-cwmode]').forEach((x) => x.classList.toggle('on', x.dataset.cwmode === b.dataset.cwmode));
    }
  }));
  // Swatches: one listener on the row, so a theme change can rebuild them.
  const pal = el.querySelector('.cw-pal');
  pal.addEventListener('click', (e) => { const b = e.target.closest('[data-pal]'); if (b) setHex(b.dataset.pal, true); });
  pal.addEventListener('change', (e) => {
    if (!e.target.classList.contains('cw-theme')) return;
    setCwTheme(e.target.value);
    for (const w of $$('.cw .cw-pal')) w.innerHTML = cwPalHtml();   // every wheel on the page follows
  });
  let keyTimer = 0;
  el.addEventListener('keydown', (e) => {
    if (e.target !== el) return;
    const big = e.shiftKey;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') h = (h + (k === 'ArrowLeft' ? -1 : 1) * (big ? 15 : 3) + 360) % 360;
    else if (k === 'ArrowUp' || k === 'ArrowDown') s = Math.max(0, Math.min(1, s + (k === 'ArrowUp' ? 1 : -1) * (big ? 0.1 : 0.02)));
    else if (k === 'PageUp' || k === 'PageDown') v = Math.max(0, Math.min(1, v + (k === 'PageUp' ? 0.05 : -0.05)));
    else if (k === 'Home') { h = 0; s = 0; v = 1; }
    else if (/^[0-9]$/.test(k)) { setHex(themeColors()[(+k + 9) % 10], true); e.preventDefault(); e.stopPropagation(); return; }
    else return;
    e.preventDefault();
    e.stopPropagation();
    paint(false);
    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => paint(true), 400);   // settle (re-render) once the keys stop
  });
  // Lets a caller show another colour without firing onChange (live values from a poll); not while in use.
  el.setHex = (hx) => {
    if (el.contains(document.activeElement) || el.matches(':active') || hx === hsvToHex(h, s, v)) return;
    [h, s, v] = rgbToHsv(...hexToRgb(hx));
    paint();
  };
  paint();
}

// ---- Colour mixing for fixtures with white and/or amber LEDs. With "Auto white / amber" on (kept
// per browser) a picked colour is split: the part all three of r, g, b share goes to white, then
// the warm part (amber is about r 255, g 170) to amber, the rest stays on r, g, b. Off = only
// r, g, b change, white and amber stay as they are.
const AMBER_G = 170 / 255;
const cwMix = () => { try { return localStorage.getItem('kd.cwMix') === '1'; } catch { return false; } };
function mixRoles(f) {
  const ro = channelRoles(f);
  return { r: ro.r, g: ro.g, b: ro.b, w: ro.w, a: slots(f).find((s) => /^(a|amber)$/i.test(s.name)) };
}
// { r, g, b[, w][, a] } (0-255) to send for a picked colour.
function mixColor(f, [r, g, b]) {
  const m = mixRoles(f), out = {};
  if (cwMix() && m.w) { const w = Math.min(r, g, b); r -= w; g -= w; b -= w; out.w = w; }
  if (cwMix() && m.a) { const a = Math.min(r, g / AMBER_G, 255); r -= a; g -= a * AMBER_G; out.a = a; }
  Object.assign(out, { r, g, b });
  for (const k in out) out[k] = Math.max(0, Math.min(255, Math.round(out[k])));
  return out;
}
// The colour a fixture shows, for the wheel; get(slot) = its 8-bit value. White and amber count when mixing.
function mixedRgb(f, get) {
  const m = mixRoles(f), v = (s) => (s ? get(s) || 0 : 0);
  const c = [v(m.r), v(m.g), v(m.b)];
  if (cwMix()) {
    const w = v(m.w), a = v(m.a);
    c[0] += w + a; c[1] += w + a * AMBER_G; c[2] += w;
  }
  return c.map((x) => Math.min(255, Math.round(x)));
}
// The switch under the wheel, only when a selected fixture has white or amber besides r, g, b.
function mixToggleHtml(fixtures) {
  if (!fixtures.some((f) => { const m = mixRoles(f); return m.r && m.g && m.b && (m.w || m.a); })) return '';
  return `<label class="row muted cw-mix" title="On: the colour you pick also sets white and amber (whites go to the W LED, warm tones to amber). Off: only red, green and blue change.">
    <input type="checkbox" data-cwmix${cwMix() ? ' checked' : ''}> Auto white / amber</label>`;
}
function wireMixToggle(after) {
  $('[data-cwmix]')?.addEventListener('change', (e) => {
    try { localStorage.setItem('kd.cwMix', e.target.checked ? '1' : '0'); } catch { /* private window */ }
    after();
  });
}

// ---- Position pad: pan = left/right, tilt = up/down (both 0-1, top = 0). For fixtures with
// channels named pan and tilt (16-bit or not). Keys when focused: arrows (Shift = bigger), Home = centre.
function posSlots(f) {
  const ss = slots(f);
  return { pan: ss.find((s) => /^pan$/i.test(s.name)), tilt: ss.find((s) => /^tilt$/i.test(s.name)) };
}
function xyPadHtml(id, x, y) {
  return `<div class="xy" data-xy="${id}" data-x="${x}" data-y="${y}" tabindex="0" title="Drag to aim · arrows move (Shift = more) · Home = centre">
    <div class="xy-pad"><i class="xy-dot"></i></div>
    <div class="row nowrap xy-num"><label class="muted">Pan<input type="number" min="0" max="100" step="0.1" data-xyk="x"></label>
      <label class="muted">Tilt<input type="number" min="0" max="100" step="0.1" data-xyk="y"></label><span class="muted">%</span>
      <button type="button" class="btn small ghost" data-xyc title="Centre (Home)">Centre</button></div></div>`;
}
// onChange(x, y, done) like attachColorWheel.
function attachXyPad(el, x, y, onChange) {
  const pad = el.querySelector('.xy-pad'), dot = el.querySelector('.xy-dot');
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const paint = (done) => {
    dot.style.left = x * 100 + '%';
    dot.style.top = y * 100 + '%';
    el.querySelectorAll('[data-xyk]').forEach((i) => { if (document.activeElement !== i) i.value = ((i.dataset.xyk === 'x' ? x : y) * 100).toFixed(1); });
    if (done != null) onChange(x, y, done);
  };
  const pick = (e, done) => {
    const r = pad.getBoundingClientRect();
    x = clamp((e.clientX - r.left) / r.width);
    y = clamp((e.clientY - r.top) / r.height);
    paint(done);
  };
  let dragging = false;
  pad.addEventListener('pointerdown', (e) => {
    pad.setPointerCapture(e.pointerId);
    el.focus({ preventScroll: true });
    dragging = true;
    pick(e, false);
    const mv = (ev) => pick(ev, false);
    pad.addEventListener('pointermove', mv);
    pad.addEventListener('pointerup', (ev) => { dragging = false; pad.removeEventListener('pointermove', mv); pick(ev, true); }, { once: true });
  });
  el.querySelectorAll('[data-xyk]').forEach((i) => i.addEventListener('change', () => {
    const v = clamp((+i.value || 0) / 100);
    if (i.dataset.xyk === 'x') x = v; else y = v;
    paint(true);
  }));
  el.querySelector('[data-xyc]').addEventListener('click', () => { x = y = 0.5; paint(true); });
  let keyTimer = 0;
  el.addEventListener('keydown', (e) => {
    if (e.target !== el) return;
    const st = e.shiftKey ? 0.05 : 0.005, k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') x = clamp(x + (k === 'ArrowLeft' ? -st : st));
    else if (k === 'ArrowUp' || k === 'ArrowDown') y = clamp(y + (k === 'ArrowUp' ? -st : st));
    else if (k === 'Home') x = y = 0.5;
    else return;
    e.preventDefault();
    e.stopPropagation();
    paint(false);
    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => paint(true), 400);
  });
  // Lets a caller move the dot without firing onChange (live values from a poll).
  el.setXY = (nx, ny) => { if (dragging || el.contains(document.activeElement)) return; x = nx; y = ny; paint(); };
  paint();
}
