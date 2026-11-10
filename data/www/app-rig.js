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
    const id = +cell.dataset.f;
    // Shift/Ctrl+click adds or removes a fixture, like in the list.
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      S.fxSel.has(id) ? S.fxSel.delete(id) : S.fxSel.add(id);
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
const mapDotHtml = (f, it, cls, labels, data = 'data-mfx') =>
  `<div class="mfx${cls}" ${data}="${f.id}" style="left:${it.x * 100}%;top:${it.y * 100}%" title="${esc(f.name)} · ${f.universe}.${f.address} (${esc((f.channels || []).join(', '))})">
    <span class="dot">${fxIcon(f)}</span>${labels ? `<span class="lbl">${esc(f.name)}</span>` : ''}</div>`;
// glow = false for maps with many fixtures (the glow is costly to draw).
function paintDot(dot, look, glow = true) {
  dot.style.background = look ? look.color : '';
  if (glow) dot.style.boxShadow = look && look.level > 0.05 ? `0 0 ${4 + look.level * 14}px ${look.color}` : '';
  // A dark icon on a bright colour.
  const [r, g, b] = (look?.color.match(/[\d.]+/g) || [0, 0, 0]).map(Number);
  dot.classList.toggle('lit', !!look && look.level > 0.35 && 0.3 * r + 0.59 * g + 0.11 * b > 110);
}
// ---- Floor-plan shapes on a map (web UI only: the firmware drops maps after loading) -----
// m.shapes = [{type: 'rect'|'ellipse'|'line'|'text', x, y, w, h, color, fill, alpha, width, text, size}],
// x/y/w/h 0..1 of the map's width/height. rect/ellipse: x/y = top-left corner, w/h >= 0;
// line: from x/y to x+w / y+h (w/h may be negative); text: x/y = its centre, size = % of the
// map's width (so it grows with the map). Drawn under the fixtures on every map view.
const SHAPE_TOOLS = [['select', '↖ Select'], ['rect', '▭ Rectangle'], ['ellipse', '◯ Ellipse'], ['line', '╱ Line'], ['text', 'T Text']];
const SHAPE_NAMES = { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', text: 'Text' };
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
// edit = the Map page's floor-plan mode: shapes can be clicked, the selected one has handles.
const mapShapesHtml = (m, edit = false) => (m.shapes?.length || edit ? `<div class="shape-layer">${mapShapesInner(m, edit)}</div>` : '');
function mapShapesInner(m, edit) {
  const sh = m.shapes || [];
  if (!sh.length) return '';
  const pc = (v) => +(v * 100).toFixed(3), defs = [];
  const svg = sh.map((s, k) => {
    if (s.type === 'text') return '';
    const d = edit ? ` data-shape="${k}"` : '';
    const st = `stroke="${esc(s.color || SHAPE_COLOR)}" stroke-width="${s.width ?? 2}" vector-effect="non-scaling-stroke"`;
    if (s.type === 'line') return `<g${d}><line x1="${pc(s.x)}" y1="${pc(s.y)}" x2="${pc(s.x + s.w)}" y2="${pc(s.y + s.h)}" ${st} stroke-linecap="round"/>
      ${edit ? `<line class="hit" x1="${pc(s.x)}" y1="${pc(s.y)}" x2="${pc(s.x + s.w)}" y2="${pc(s.y + s.h)}" stroke="transparent" stroke-width="12" vector-effect="non-scaling-stroke"/>` : ''}</g>`;
    let fill = 'fill="none"';
    if (s.fill && SHAPE_PATTERNS[s.pattern]) {
      const id = `shp${++shapeUid}`;
      defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="2" height="${+(2 * (m.aspect || 1)).toFixed(3)}" viewBox="0 0 10 10" preserveAspectRatio="none">${SHAPE_PATTERNS[s.pattern][1](esc(s.fill))}</pattern>`);
      fill = `fill="url(#${id})" fill-opacity="${s.alpha ?? 0.35}"`;
    } else if (s.fill) fill = `fill="${esc(s.fill)}" fill-opacity="${s.alpha ?? 0.35}"`;
    return s.type === 'ellipse'
      ? `<ellipse${d} cx="${pc(s.x + s.w / 2)}" cy="${pc(s.y + s.h / 2)}" rx="${pc(s.w / 2)}" ry="${pc(s.h / 2)}" ${st} ${fill}/>`
      : `<rect${d} x="${pc(s.x)}" y="${pc(s.y)}" width="${pc(s.w)}" height="${pc(s.h)}" ${st} ${fill}/>`;
  }).join('');
  const texts = sh.map((s, k) => (s.type === 'text' ? `<div class="map-text${edit && S.mapShapeSel === k ? ' sel' : ''}"${edit ? ` data-shape="${k}"` : ''} style="left:${pc(s.x)}%;top:${pc(s.y)}%;font-size:calc(${s.size || 3} * 1cqw);color:${esc(s.color || '#d0d8e2')}">${esc(s.text || '')}</div>` : '')).join('');
  return `<svg class="map-shapes${edit ? ' edit' : ''}" viewBox="0 0 100 100" preserveAspectRatio="none">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${svg}</svg>${texts}${edit ? shapeHandlesHtml(sh[S.mapShapeSel]) : ''}`;
}
// The selected shape's frame and handles: 8 for a rectangle/ellipse (corners change width and
// height together, the sides only one of them), the two ends of a line, none for text.
function shapeHandlesHtml(s) {
  if (!s) return '';
  const pc = (v) => +(v * 100).toFixed(3);
  if (s.type === 'line') return ['a', 'b'].map((h) => `<div class="shape-h" data-sh="${h}" style="left:${pc(h === 'a' ? s.x : s.x + s.w)}%;top:${pc(h === 'a' ? s.y : s.y + s.h)}%"></div>`).join('');
  if (s.type === 'text') return '';
  const xs = { w: s.x, '': s.x + s.w / 2, e: s.x + s.w }, ys = { n: s.y, '': s.y + s.h / 2, s: s.y + s.h };
  return `<div class="map-selbox" style="left:${pc(s.x)}%;top:${pc(s.y)}%;width:${pc(s.w)}%;height:${pc(s.h)}%;border-radius:0"></div>`
    + ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => {
      const v = h.match(/[ns]/)?.[0] || '', u = h.match(/[ew]/)?.[0] || '';
      return `<div class="shape-h ${h}" data-sh="${h}" style="left:${pc(xs[u])}%;top:${pc(ys[v])}%"></div>`;
    }).join('');
}
// Map size: drag the bar under a map to make it taller or shorter. The width follows from the
// map's shape (never wider than the page); stored per page in this browser, like the pane widths.
function mapSizeStyle(key, aspect, dflt = '') {
  const h = loadWidth(key) ? loadWidth(key) + 'px' : dflt;
  return `aspect-ratio:${aspect};${h ? `width:min(100%, calc(${h} * ${aspect}))` : ''}`;
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
    const move = (ev) => { h = Math.max(120, Math.min(3000, h0 + (ev.clientY - y0) / z)); canvas.style.width = `min(100%, ${h * aspect}px)`; };
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
// Fixtures keep their neighbours: they are taken in their current order along the shape.
function shapeItems(its, shape, asp, opt = S.shapeOpt) {
  // Circle radius: never so big that the circle doesn't fit on the map (it would get squashed).
  const n = its.length, b = selBox(its, asp), L = Math.max(b.w, b.h, 0.3), R = Math.min(Math.max(b.w, b.h, 0.25) / 2, 0.46, 0.46 * asp);
  const put = (it, x, y) => { it.x = x / asp; it.y = y; };
  const t = (k) => (n > 1 ? k / (n - 1) : 0.5);
  const around = (it) => Math.atan2(it.y - b.cy, it.x * asp - b.cx);
  const fromTop = (it) => (around(it) + Math.PI * 2.5) % (Math.PI * 2);   // clockwise from 12 o'clock
  // The order fixtures go into the shape: patch order, or by where they are now (cmp).
  const patch = [...its].sort((a, c) => { const fa = fixture(a.fixture), fc = fixture(c.fixture); return fa.universe - fc.universe || fa.address - fc.address; });
  const ord = (cmp) => (opt.order === 'patch' ? patch : [...its].sort(cmp));
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
    const at = (d) => (d < RW ? [d, 0] : d < RW + RH ? [RW, d - RW] : d < 2 * RW + RH ? [RW - (d - RW - RH), RH] : [0, RH - (d - 2 * RW - RH)]);
    const fromCorner = (it) => (around(it) + Math.PI * 2 + Math.atan2(RH, RW)) % (Math.PI * 2);
    ord((a, c) => fromCorner(a) - fromCorner(c)).forEach((it, k) => { const [x, y] = at((per * k) / n); put(it, b.cx - RW / 2 + x, b.cy - RH / 2 + y); });
  } else if (shape === 'zigzag') {
    const ZH = Math.max(b.h, 0.08);
    ord((a, c) => a.x - c.x).forEach((it, k) => put(it, b.cx - Lx / 2 + Lx * t(k), b.cy + (k % 2 ? ZH / 2 : -ZH / 2)));
  } else if (shape === 'grid' || shape === 'snake') {
    (opt.order === 'patch' ? patch : reading()).forEach((it, k) => put(it, ...cell(k, shape === 'snake')));
  }
  keepInside(its);
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
  markDirty();
  render();
}
// The snap grid: m.grid cells across and down (default 80), x and y each 0..1.
const MAP_GRIDS = [10, 20, 40, 80];
const mapGrid = (m) => (MAP_GRIDS.includes(+m.grid) ? +m.grid : 80);
const snapTo = (m, v) => Math.round(v * mapGrid(m)) / mapGrid(m);
// Lines of the snap grid over the map (at most 40 each way, so a fine grid isn't a grey haze).
function mapGridHtml(m) {
  if (m.snap === false) return '';
  const n = mapGrid(m), step = n > 40 ? 2 : 1;
  return `<div class="map-grid" style="--gc:${n / step}"></div>`;
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
    case 'snap': its.forEach((it) => { it.x = snapTo(m, it.x); it.y = snapTo(m, it.y); }); break;
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
      if (!moved && toggleId != null) { const s = new Set(getSel()); s.has(toggleId) ? s.delete(toggleId) : s.add(toggleId); setSel(s); }
      else if (!moved && !add && clearOnClick) setSel(new Set());   // a click on empty space clears the selection
      done();
    }, { once: true });
  };
  canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) begin(e); });
  return begin;
}
views.map = () => {
  const p = P();
  if (S.mapShapeOf !== S.sel.map) { S.mapShapeSel = null; S.mapShapeOf = S.sel.map; }   // another map
  if (!p.maps.length) return `<h2>Map</h2>
    <p class="muted">A map is a floor plan (an image of the venue, or an empty grid) with your fixtures placed on it, like the Layout in Pharos Designer.
      Select fixtures on it to make groups or fill timeline tracks, and see what they're doing live.</p>
    <button class="btn" data-add="map">+ Map</button>`;
  S.sel.map = Math.min(S.sel.map, p.maps.length - 1);
  const m = p.maps[S.sel.map], base = `maps.${S.sel.map}`;
  // Floor-plan mode: draw and edit shapes; S.mapShapeSel = index of the selected shape.
  const shapeMode = !!S.mapShapes;
  if (S.mapShapeSel != null && !m.shapes[S.mapShapeSel]) S.mapShapeSel = null;
  const shape = shapeMode && S.mapShapeSel != null ? m.shapes[S.mapShapeSel] : null;
  const placed = new Set(m.items.map((it) => it.fixture));
  // The selection can hold fixtures that aren't on this map (picked in the list to drag on).
  for (const id of [...S.mapSel]) if (!fixture(id)) S.mapSel.delete(id);
  const sel = [...S.mapSel].map(fixture).filter(Boolean);
  const one = sel.length === 1 ? sel[0] : null, fi = one ? p.fixtures.indexOf(one) : -1;
  const items = m.items.map((it) => {
    const f = fixture(it.fixture);
    return f ? mapDotHtml(f, it, S.mapSel.has(f.id) ? ' sel' : '', m.labels !== false) : '';
  }).join('');
  const tracks = p.timelines.flatMap((tl, ti) => tl.tracks.map((tr, ri) => `<option value="${ti}:${ri}">${esc(tl.name)} › ${esc(tr.name)}</option>`)).join('');
  // Several selected: a frame around them with a rotate handle (above) and a size handle (corner).
  const sits = m.items.filter((it) => S.mapSel.has(it.fixture));
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
      <div class="list">${p.maps.map((x, i) => `<div class="item${i === S.sel.map ? ' sel' : ''}" data-sel="map:${i}"><span class="id">${x.id}</span>${esc(x.name)}<span class="muted" style="margin-left:auto">${x.items.length}</span></div>`).join('')}</div>
      <div class="row" style="margin-top:8px"><button class="btn small" data-add="map">+ Map</button></div>
      <h3>Fixtures</h3>
      <p class="muted" style="margin:0 0 6px">Drag onto the map. Click, then Shift+click (a range) or Ctrl+click (one more) to pick several and drag them on together. ● = on this map.</p>
      <div class="list map-fx">${p.fixtures.map((f) => `<div class="item${S.mapSel.has(f.id) ? ' sel' : ''}" data-mapfx="${f.id}">
        <span class="placed${placed.has(f.id) ? ' on' : ''}">${placed.has(f.id) ? '●' : '○'}</span><span style="flex:1">${esc(f.name)}</span><span class="muted mono">${f.universe}.${f.address}</span></div>`).join('') || '<span class="muted">No fixtures yet.</span>'}</div>
      <div class="row" style="margin-top:8px">
        <button class="btn small" id="mapAddFx" title="Pick from the fixture library; they are placed on this map">+ Add fixtures…</button>
        <button class="btn small" data-add="fixture-dim">+ Dimmer</button><button class="btn small" data-add="fixture-rgb">+ RGB</button><button class="btn small" data-add="fixture-rgbw">+ RGBW</button>
        ${p.fixtures.some((f) => !placed.has(f.id)) ? '<button class="btn small ghost" id="mapPlaceAll" title="Put all fixtures that are not on this map in a row at the bottom">Place the rest</button>' : ''}</div>
      <p class="muted keys">New fixtures get the next free address on universe ${p.universes[0]?.id || 1}; change it below or on the Patch page.</p>
      <h3>Groups</h3>
      <p class="muted" style="margin:0 0 6px">Click to select a group on the map.</p>
      <div class="list">${p.groups.map((g) => {
        const on = g.fixtures.filter((id) => placed.has(id)), all = on.length && on.length === S.mapSel.size && on.every((id) => S.mapSel.has(id));
        return `<div class="item${all ? ' sel' : ''}" data-mapgrp="${g.id}" title="${on.length} of ${g.fixtures.length} on this map"><span class="id">${g.id}</span><span style="flex:1">${esc(g.name)}</span>
          <span class="tag${on.length < g.fixtures.length ? ' muted' : ''}">${on.length < g.fixtures.length ? `${on.length}/${g.fixtures.length}` : g.fixtures.length}</span></div>`;
      }).join('') || '<span class="muted">No groups yet - select fixtures on the map and use "Make group".</span>'}</div>
    </div>
    <div>
      <div class="row"><input data-p="${base}.name" value="${esc(m.name)}" style="font-size:16px;flex:1" data-r>
        <button class="btn small ghost" data-del="${base}">Delete map</button></div>
      <div class="row map-tools">
        <label class="btn small" title="JPG/PNG/WebP/SVG, max 4 MB, stored on the storage device">${m.background ? 'Replace image' : 'Background image…'}<input type="file" id="mapBg" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden></label>
        ${m.background ? '<button class="btn small ghost" id="mapBgDel">Remove image</button>' : ''}
        <select id="mapAspect" title="Shape of the map">${ASPECTS.map(([a, n]) => `<option value="${a}"${Math.abs(a - m.aspect) < 0.01 ? ' selected' : ''}>${n}</option>`).join('')}${ASPECTS.some(([a]) => Math.abs(a - m.aspect) < 0.01) ? '' : `<option selected value="${m.aspect}">image (${(+m.aspect).toFixed(2)})</option>`}</select>
        <label class="muted" title="Fixtures and shapes jump to the grid when moved (the lines show it)"><input type="checkbox" data-p="${base}.snap" data-t="bool"${m.snap !== false ? ' checked' : ''} data-r> Snap</label>
        ${m.snap !== false ? `<select id="mapGridN" title="Grid: cells across and down">${MAP_GRIDS.map((n) => `<option value="${n}"${mapGrid(m) === n ? ' selected' : ''}>grid ${n}</option>`).join('')}</select>` : ''}
        ${S.mapClip?.items.length && !shapeMode ? `<button class="btn small" id="mapPaste" title="Put the copied fixtures on this map at their copied positions (Ctrl+V)">Paste ${S.mapClip.items.length} position${S.mapClip.items.length > 1 ? 's' : ''}</button>` : ''}
        <label class="muted"><input type="checkbox" data-p="${base}.labels" data-t="bool"${m.labels !== false ? ' checked' : ''} data-r> Names</label>
        <label class="muted"><input type="checkbox" id="mapLive"${S.mapLive !== false ? ' checked' : ''}> Live</label>
        <button class="btn small${shapeMode ? ' on' : ''}" id="mapShapeMode" title="Draw rectangles, ellipses, lines and text (a simple floor plan). While on, fixtures can't be moved.">✎ Floor plan${m.shapes.length ? ` (${m.shapes.length})` : ''}</button>
      </div>
      ${shapeMode ? `<div class="row map-tools"><div class="seg">${SHAPE_TOOLS.map(([v, n]) => `<button class="${(S.mapTool || 'select') === v ? 'on' : ''}" data-maptool="${v}">${n}</button>`).join('')}</div>
        <span class="muted">${(S.mapTool || 'select') === 'select' ? 'Click a shape to select it, drag to move, drag the handles to resize.' : S.mapTool === 'text' ? 'Click on the map to place a text.' : 'Drag on the map to draw.'}</span></div>` : ''}
      <div class="map-wrap"><div class="map-canvas${m.background ? ' has-bg' : ''}${m.items.length > 40 ? ' dense' : ''}${shapeMode ? ' shape-mode' : ''}${shapeMode && (S.mapTool || 'select') !== 'select' ? ' drawing' : ''}" id="mapCanvas" style="${mapSizeStyle('kd.mapH.map', m.aspect)}">
        ${m.background ? `<img src="/media/${encodeURIComponent(m.background)}" alt="" draggable="false">` : ''}
        ${mapGridHtml(m)}${mapShapesHtml(m, shapeMode)}
        ${items}${shapeMode ? '' : selFrame}<div class="band" id="mapBand" hidden></div>${mapResizeHtml('kd.mapH.map')}</div></div>
      ${shapeMode ? `<p class="muted keys">Click a shape to select · drag to move · handles resize (corners: width and height, Shift = keep proportions; sides: one of them) · arrows nudge (Shift = more) · PgUp/PgDn one step forward/back (Shift = to the front/back) · Del removes · Ctrl+D duplicates · Esc deselects</p>
      ${shape ? `<div class="map-selbar"><b>${SHAPE_NAMES[shape.type]}</b>
        ${shape.type === 'text' ? `<input id="shText" value="${esc(shape.text || '')}" placeholder="Text" style="width:180px">
          <label class="muted nowrap">Size <input type="number" id="shSize" min="0.5" max="30" step="0.5" value="${shape.size || 3}" style="width:64px"></label>` : ''}
        <label class="muted nowrap" title="${shape.type === 'text' ? 'Text colour' : 'Line colour'}">${shape.type === 'text' ? 'Colour' : 'Line'} <input type="color" id="shColor" value="${esc(shape.color || (shape.type === 'text' ? '#d0d8e2' : SHAPE_COLOR))}"></label>${shapeSwatches('color', shape.color || (shape.type === 'text' ? '#d0d8e2' : SHAPE_COLOR))}
        ${shape.type !== 'text' ? `<label class="muted nowrap">Width <input type="number" id="shWidth" min="0" max="20" step="0.5" value="${shape.width ?? 2}" style="width:56px"></label>` : ''}
        ${shape.type === 'rect' || shape.type === 'ellipse' ? `<label class="muted nowrap"><input type="checkbox" id="shFillOn"${shape.fill ? ' checked' : ''}> Fill</label>
          ${shape.fill ? `<input type="color" id="shFill" value="${esc(shape.fill)}" title="Fill colour">${shapeSwatches('fill', shape.fill)}
            <select id="shPattern" title="Fill pattern"><option value="">Solid</option>${Object.entries(SHAPE_PATTERNS).map(([v, [n]]) => `<option value="${v}"${shape.pattern === v ? ' selected' : ''}>${n}</option>`).join('')}</select>
            <input type="range" id="shAlpha" min="0.05" max="1" step="0.05" value="${shape.alpha ?? 0.35}" title="How solid the fill is" style="width:90px">` : ''}` : ''}
        <span class="seg" title="Order of overlapping shapes (texts are always on top)">
          <button id="shBack" title="To the back, under all other shapes (Shift+PgDn)">⤓ Back</button><button data-shstep="-1" title="One step back (PgDn)">↓</button><button data-shstep="1" title="One step forward (PgUp)">↑</button><button id="shFront" title="To the front, over all other shapes (Shift+PgUp)">⤒ Front</button></span>
        <button class="btn small" id="shDup" title="Ctrl+D">Duplicate</button>
        <button class="btn small ghost" id="shDel">Delete</button></div>` : ''}`
      : `<p class="muted keys">Click to select · Shift/Ctrl+click adds · drag on empty space selects an area (Shift/Ctrl adds, Alt removes) · drag to move · arrows nudge (Shift = more) · ⟳ handle or [ ] rotates, ⤡ handle stretches (Shift = keep proportions), - + spread out (Shift = more) · Del removes from the map · Ctrl+A selects all</p>`}
      ${sel.length && !shapeMode ? `<div class="map-selbar">
        <b>${sel.length} selected</b>${sel.length > sits.length ? `<span class="muted">${sel.length - sits.length} not on this map yet - drag them on from the list</span>` : ''}
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
  const snap = (v) => (m.snap !== false ? snapTo(m, v) : v);
  $('#mapGridN')?.addEventListener('change', (e) => { m.grid = +e.target.value; markDirty(); render(); });
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
  const paintSel = () => {
    $$('.mfx', canvas).forEach((el) => el.classList.toggle('sel', S.mapSel.has(+el.dataset.mfx)));
  };
  // Move / select fixtures on the map.
  $$('.mfx', canvas).forEach((el) => el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const id = +el.dataset.mfx;
    if (e.button !== 0) return;
    if (e.shiftKey) return bandBegin(e, id);   // Shift+drag: add an area, also when it starts on a fixture
    if (e.ctrlKey || e.metaKey) { S.mapSel.has(id) ? S.mapSel.delete(id) : S.mapSel.add(id); paintSel(); return render(); }
    if (!S.mapSel.has(id)) { S.mapSel = new Set([id]); paintSel(); }
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
        it.y = clamp01(snap(o.y + dy));
        node.style.left = it.x * 100 + '%';
        node.style.top = it.y * 100 + '%';
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', () => { el.removeEventListener('pointermove', move); if (moved) markDirty(); render(); }, { once: true });
  }));
  // Drag on empty space: select an area.
  // (In floor-plan mode the map edits shapes instead; fixtures can't be clicked then.)
  const bandBegin = S.mapShapes ? null : bandSelect(canvas, m.items, () => S.mapSel, (s) => (S.mapSel = s), paintSel, render);
  if (S.mapShapes) wireMapShapes(canvas, m, snap);
  $('#mapShapeMode').addEventListener('click', () => { S.mapShapes = !S.mapShapes; S.mapTool = 'select'; render(); });
  $$('[data-maptool]').forEach((b) => b.addEventListener('click', () => { S.mapTool = b.dataset.maptool; S.mapShapeSel = null; render(); }));
  // The fixture list: click selects, Ctrl+click adds/removes one, Shift+click selects the range
  // from the last click. The selection (S.mapSel, also fixtures not on this map) is the same
  // as on the map. Dragging a selected row drops all selected fixtures onto the map at once.
  const rows = $$('[data-mapfx]'), ids = rows.map((r) => +r.dataset.mapfx);
  // A long list keeps its scroll position when the page redraws (Shift+click far down).
  const fxList = $('.map-fx');
  fxList.scrollTop = S.mapListScroll || 0;
  fxList.addEventListener('scroll', () => (S.mapListScroll = fxList.scrollTop));
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
      Object.assign(it, n > 1 ? { x, y } : { x: snap(clamp01(x)), y: snap(clamp01(y)) });
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
  $('#mapAddFx').addEventListener('click', () => {
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
  $$('[data-mapgrp]').forEach((el) => el.addEventListener('click', () => {
    const g = p.groups.find((x) => x.id === +el.dataset.mapgrp);
    const on = g.fixtures.filter((id) => itemOf(id));
    if (!on.length) return toast(`None of '${g.name}' is on this map - drag them on from the list`, true);
    S.mapSel = new Set(on);
    render();
  }));
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
    shapeItems(m.items.filter((it) => S.mapSel.has(it.fixture)), shape, m.aspect);
    S.lastShape = { shape, key: selKey(), map: m.id };
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
    el.addEventListener('pointerup', () => { el.removeEventListener('pointermove', move); if (moved) markDirty(); render(); }, { once: true });
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
    const us = [...new Set(m.items.map((it) => fixture(it.fixture)?.universe).filter((u) => u != null))];
    pagePoll('mapLive', async () => {
      const dmx = {};
      try { await Promise.all(us.map(async (u) => (dmx[u] = await api('/api/dmx?u=' + u)))); } catch { return; }
      const glow = m.items.length <= 40;
      for (const el of $$('.mfx', canvas)) paintDot(el.firstElementChild, fixtureLook(fixture(+el.dataset.mfx), dmx), glow);
    }, 300);
  }
};
// Floor-plan mode on the Map page: draw shapes with the chosen tool, select / move / resize them.
// One pointerdown on the canvas (the shape layer is redrawn while dragging, so no per-shape
// listeners); snap = the map's 1/80 grid when Snap is on.
function wireMapShapes(canvas, m, snap) {
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
  const tidy = (s) => { for (const k of ['x', 'y', 'w', 'h']) if (s?.[k] != null) s[k] = Math.round(s[k] * 1e4) / 1e4; };
  const done = (moved) => { if (moved) { tidy(m.shapes[S.mapShapeSel]); markDirty(); } render(); };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.map-resize')) return;
    const tool = S.mapTool || 'select', hd = e.target.closest('[data-sh]'), hit = e.target.closest('[data-shape]');
    const s = m.shapes[S.mapShapeSel];
    if (hd && s) {
      // Resize: corners move two sides (Shift = keep proportions), sides one; line ends.
      const o = { ...s }, h = hd.dataset.sh;
      return drag(e, (p0, pt, ev) => {
        if (s.type === 'line') {
          const ex = o.x + o.w, ey = o.y + o.h, fx = h === 'a' ? ex : o.x, fy = h === 'a' ? ey : o.y;   // the end that stays
          let [dx, dy] = [snap(pt.x) - fx, snap(pt.y) - fy];
          if (ev.shiftKey) [dx, dy] = lineSnap(dx, dy);
          if (h === 'a') Object.assign(s, { x: fx + dx, y: fy + dy, w: -dx, h: -dy });
          else Object.assign(s, { w: dx, h: dy });
          return;
        }
        let L = o.x, R = o.x + o.w, T = o.y, B = o.y + o.h;
        if (h.includes('w')) L = snap(pt.x);
        if (h.includes('e')) R = snap(pt.x);
        if (h.includes('n')) T = snap(pt.y);
        if (h.includes('s')) B = snap(pt.y);
        if (ev.shiftKey && h.length === 2 && o.w && o.h) {
          const ax = h.includes('w') ? R : L, ay = h.includes('n') ? B : T;   // the corner that stays
          const k = Math.max(Math.abs((h.includes('w') ? L : R) - ax) / o.w, Math.abs((h.includes('n') ? T : B) - ay) / o.h);
          if (h.includes('w')) L = ax - o.w * k; else R = ax + o.w * k;
          if (h.includes('n')) T = ay - o.h * k; else B = ay + o.h * k;
        }
        Object.assign(s, { x: Math.min(L, R), y: Math.min(T, B), w: Math.max(0.002, Math.abs(R - L)), h: Math.max(0.002, Math.abs(B - T)) });
      }, done);
    }
    if (tool !== 'select') {
      // Draw a new shape (text: placed where clicked).
      const p0 = at(e);
      const n = tool === 'text' ? { type: 'text', x: snap(p0.x), y: snap(p0.y), text: 'Text', size: 3 }
        : { type: tool, x: snap(p0.x), y: snap(p0.y), w: 0, h: 0, color: SHAPE_COLOR, width: 2 };
      m.shapes.push(n);
      S.mapShapeSel = m.shapes.length - 1;
      const x0 = n.x, y0 = n.y;   // where the drag started (snapped)
      return drag(e, (q, pt, ev) => {
        if (tool === 'text') return;
        let dx = snap(pt.x) - x0, dy = snap(pt.y) - y0;
        if (tool === 'line') { if (ev.shiftKey) [dx, dy] = lineSnap(dx, dy); return Object.assign(n, { w: dx, h: dy }); }
        if (ev.shiftKey) { const sz = Math.max(Math.abs(dx) * m.aspect, Math.abs(dy)); dx = Math.sign(dx || 1) * (sz / m.aspect); dy = Math.sign(dy || 1) * sz; }   // square / circle
        Object.assign(n, { x: Math.min(x0, x0 + dx), y: Math.min(y0, y0 + dy), w: Math.abs(dx), h: Math.abs(dy) });
      }, (moved) => {
        // A click without dragging draws nothing (except a text).
        if (tool !== 'text' && (!moved || Math.hypot(n.w, n.h) < 0.01)) { m.shapes.pop(); S.mapShapeSel = null; return render(); }
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
      S.mapShapeSel = k;
      redraw();
      return drag(e, (p0, pt) => {
        let x = snap(o.x + pt.x - p0.x), y = snap(o.y + pt.y - p0.y);
        // Stays on the map: the whole box (a line: both ends; a text: its centre).
        const w = sh.type === 'text' ? 0 : o.w, h = sh.type === 'text' ? 0 : o.h;
        x = Math.max(Math.max(0, -w), Math.min(Math.min(1, 1 - w), x));
        y = Math.max(Math.max(0, -h), Math.min(Math.min(1, 1 - h), y));
        Object.assign(sh, { x, y });
      }, done);
    }
    if (S.mapShapeSel != null) { S.mapShapeSel = null; render(); }   // a click on empty space
  });
  // The selected shape's settings (typing in the text redraws only the map, keeping the focus).
  const s = m.shapes[S.mapShapeSel];
  if (!s) return;
  const set = (k, v, full) => { s[k] = v; markDirty(); full ? render() : redraw(); };
  $('#shText')?.addEventListener('input', (e) => set('text', e.target.value));
  $('#shSize')?.addEventListener('change', (e) => set('size', Math.max(0.5, Math.min(30, +e.target.value || 3))));
  $('#shColor').addEventListener('input', (e) => set('color', e.target.value));
  $('#shWidth')?.addEventListener('change', (e) => set('width', Math.max(0, Math.min(20, +e.target.value || 0))));
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
function shapeDuplicate(m) {
  const s = m.shapes[S.mapShapeSel];
  if (!s) return;
  const c = { ...s, x: Math.min(0.98, s.x + 0.025), y: Math.min(0.98, s.y + 0.025) };
  m.shapes.push(c);
  S.mapShapeSel = m.shapes.length - 1;
  markDirty();
  render();
}
// Moves the selected shape d places up (later = drawn on top) or down; ±Infinity = front / back.
function shapeOrder(m, d) {
  const k = S.mapShapeSel, s = m.shapes[k];
  if (!s) return;
  const to = Math.max(0, Math.min(m.shapes.length - 1, k + d));
  if (to === k) return;
  m.shapes.splice(k, 1);
  m.shapes.splice(to, 0, s);
  S.mapShapeSel = to;
  markDirty();
  render();
}
function shapeDelete(m) {
  if (!m.shapes[S.mapShapeSel]) return;
  m.shapes.splice(S.mapShapeSel, 1);
  S.mapShapeSel = null;
  markDirty();
  render();
}
// Map keys: nudge, delete from map, select all.
views.map.keys = (e) => {
  const m = P()?.maps[S.sel.map];
  if (!m) return;
  if (S.mapShapes) {
    // Floor-plan mode: the keys work on the selected shape.
    const s = m.shapes[S.mapShapeSel], st = e.shiftKey ? 0.025 : 0.005;
    const d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
    if (e.key === 'Escape') { S.mapTool = 'select'; S.mapShapeSel = null; render(); }
    if (!s) return;
    if (d) { e.preventDefault(); s.x = Math.round((s.x + d[0]) * 1e4) / 1e4; s.y = Math.round((s.y + d[1]) * 1e4) / 1e4; markDirty(); render(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); shapeDelete(m); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); shapeDuplicate(m); }
    else if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); shapeOrder(m, (e.key === 'PageUp' ? 1 : -1) * (e.shiftKey ? Infinity : 1)); }
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
    S.mapSel = new Set(m.items.map((it) => it.fixture));
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
      <div class="cw-pal">${PALETTE.map((c, k) => `<button class="swatch" data-pal="${c}" style="background:${c}" title="${c} (key ${(k + 1) % 10})"></button>`).join('')}</div>
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
  el.querySelectorAll('[data-pal]').forEach((b) => b.addEventListener('click', () => setHex(b.dataset.pal, true)));
  let keyTimer = 0;
  el.addEventListener('keydown', (e) => {
    if (e.target !== el) return;
    const big = e.shiftKey;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') h = (h + (k === 'ArrowLeft' ? -1 : 1) * (big ? 15 : 3) + 360) % 360;
    else if (k === 'ArrowUp' || k === 'ArrowDown') s = Math.max(0, Math.min(1, s + (k === 'ArrowUp' ? 1 : -1) * (big ? 0.1 : 0.02)));
    else if (k === 'PageUp' || k === 'PageDown') v = Math.max(0, Math.min(1, v + (k === 'PageUp' ? 0.05 : -0.05)));
    else if (k === 'Home') { h = 0; s = 0; v = 1; }
    else if (/^[0-9]$/.test(k)) { setHex(PALETTE[(+k + 9) % 10], true); e.preventDefault(); e.stopPropagation(); return; }
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
