'use strict';
// KD Designer web UI - Live: one page that shows what the show is doing right now, for
// watching a running installation (like Pharos Designer's simulation view, plus the
// controller's side: triggers, devices, variables). Only reads what other pages already use:
// the status stream (S.status, ~10/s), the log stream (fired/skipped trigger lines) and
// /api/dmx for the fixture colours. Nothing here changes the project.

// Stage = what the big pane shows: a map index, or 'all' (every fixture as a tile per universe).
function liveStage() {
  let v = S.liveStage;
  if (v == null) { try { v = localStorage.getItem('kd.liveStage'); } catch { /* private mode */ } }
  if (v !== 'all' && !P().maps[+v]) v = P().maps.length ? 0 : 'all';
  return v === 'all' ? 'all' : +v;
}
function setLiveStage(v) {
  S.liveStage = v;
  try { localStorage.setItem('kd.liveStage', String(v)); } catch { /* private mode */ }
}

views.live = () => {
  const p = P(), stage = liveStage();
  const tabs = [...p.maps.map((m, i) => [String(i), m.name || `Map ${m.id}`]), ['all', 'All fixtures']];
  let body;
  if (stage === 'all') {
    // Tiles per universe in patch order: works without any map.
    const byU = new Map();
    for (const f of [...p.fixtures].sort((a, b) => a.universe - b.universe || a.address - b.address)) (byU.get(f.universe) || byU.set(f.universe, []).get(f.universe)).push(f);
    body = [...byU].map(([u, list]) => `<div class="lv-uni"><div class="muted lv-uni-h">Universe ${u} · ${list.length} fixture${list.length > 1 ? 's' : ''}</div>
      <div class="lv-tiles">${list.map((f) => `<div class="lv-tile" data-lvfx="${f.id}"><span class="dot"></span><span class="lbl">${esc(f.name)}</span></div>`).join('')}</div></div>`).join('')
      || '<p class="muted">No fixtures yet.</p>';
  } else {
    const m = p.maps[stage];
    const items = m.items.map((it) => { const f = fixture(it.fixture); return f ? mapDotHtml(f, it, '', m.labels !== false) : ''; }).join('');
    body = `<div class="map-wrap"><div class="map-canvas live-map${m.background ? ' has-bg' : ''}${m.items.length > 40 ? ' dense' : ''}" id="liveCanvas" style="${mapSizeStyle('kd.mapH.live', m.aspect)}">
      ${m.background ? `<img src="/media/${encodeURIComponent(m.background)}" alt="" draggable="false">` : ''}${mapShapesHtml(m)}${items}${mapResizeHtml('kd.mapH.live')}</div></div>`;
  }
  return `<div class="live" id="live">
    <div class="row lv-top"><h2 style="margin:0">Live</h2><div class="row" id="lvTop" style="flex:1"></div>
      <button class="btn small" id="lvFull" title="Fill the screen with this page (Esc goes back)">⛶ Full screen</button></div>
    <div class="lv-grid">
      <div class="card lv-stage">
        <div class="row lv-head"><span class="seg">${tabs.map(([v, n]) => `<button data-lvstage="${v}" class="${String(stage) === v ? 'on' : ''}">${esc(n)}</button>`).join('')}</span>
          <span class="spacer" style="flex:1"></span>${stage === 'all' ? '' : mapZoomHtml(`live:${p.maps[stage].id}`)}</div>
        <div id="lvStage">${body}</div>
        <div class="muted mono lv-info" id="lvInfo">Hover a fixture to see its channels.</div>
      </div>
      <div class="lv-side">
        <div class="card"><h3>Playing now</h3><div id="lvPlay"></div></div>
        <div class="card"><h3>Triggers <span class="muted" style="font-weight:normal">· last fired</span></h3><div id="lvFeed" class="lv-feed"></div></div>
        ${p.modes.length || p.variables.length ? `<div class="card"><h3>Modes &amp; variables</h3><div id="lvVars"></div></div>` : ''}
        <div class="card"><h3>Devices</h3><div id="lvDev" class="lv-devs"></div></div>
        <div class="card"><h3>Warnings &amp; errors</h3><div id="lvWarn" class="lv-feed"></div></div>
      </div>
    </div>
    ${trigHistHtml()}
  </div>`;
};

views.live.after = () => {
  const p = P(), stage = liveStage(), root = $('#live');
  $$('[data-lvstage]').forEach((b) => b.addEventListener('click', () => { setLiveStage(b.dataset.lvstage === 'all' ? 'all' : +b.dataset.lvstage); render(); }));
  $('#lvFull').addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen?.()).catch?.(() => {}));
  const canvas = $('#liveCanvas');
  if (canvas) { attachMapResize(canvas, p.maps[stage].aspect); attachMapZoom(canvas, `live:${p.maps[stage].id}`); }
  // Hover: the fixture's channel values (refreshed with every colour poll).
  $('#lvStage').addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-mfx],[data-lvfx]');
    S.liveHover = el ? +(el.dataset.mfx || el.dataset.lvfx) : null;
    liveInfo();
  });
  $('#lvStage').addEventListener('mouseleave', () => { S.liveHover = null; liveInfo(); });
  // The history strip: a row opens its trigger (on the Triggers page it selects it).
  $('#histBody').addEventListener('click', (e) => {
    const row = e.target.closest('[data-sel^="trigger:"]');
    if (!row) return;
    e.stopPropagation();
    const t = P().triggers[+row.dataset.sel.split(':')[1]];
    if (t) { S.view = 'triggers'; selectTriggers([P().triggers.indexOf(t)]); render(); }
  }, true);
  // Buttons are rebuilt with the status: don't replace one between mouse down and up.
  $('#lvPlay').addEventListener('pointerdown', () => {
    S.liveHold = true;
    document.addEventListener('pointerup', () => setTimeout(() => (S.liveHold = false), 50), { once: true });
  });
  trigHistAfter();
  liveStatus();
  liveFeed();
  liveWarn();
  // Fixture colours: the universes on the stage, 4x a second (one request per universe).
  const els = $$('[data-mfx],[data-lvfx]', $('#lvStage')).map((el) => [el, fixture(+(el.dataset.mfx || el.dataset.lvfx))]).filter(([, f]) => f);
  const us = [...new Set(els.map(([, f]) => f.universe))], glow = els.length <= 40 && stage !== 'all';
  let busy = false;
  pagePoll('liveDmx', async () => {
    if (busy || !us.length) return;
    busy = true;
    const dmx = {};
    try { await Promise.all(us.map(async (u) => (dmx[u] = await api('/api/dmx?u=' + u)))); } catch { busy = false; return; }
    busy = false;
    S.liveDmx = dmx;
    for (const [el, f] of els) paintDot(el.querySelector('.dot'), fixtureLook(f, dmx), glow);
    liveInfo();
  }, 250);
  // Timeline positions move on smoothly between status updates.
  pageAnimation('livePos', livePosFrame);
};

function liveInfo() {
  const el = $('#lvInfo');
  if (!el) return;
  const f = S.liveHover != null && fixture(S.liveHover);
  if (!f) { el.textContent = 'Hover a fixture to see its channels.'; return; }
  const d = S.liveDmx?.[f.universe];
  const vals = slots(f).map((s) => `${s.name} ${d ? d[f.address - 1 + s.offset] ?? 0 : '–'}`).join(' · ');
  el.textContent = `${f.name} · ${f.universe}.${f.address} · ${vals}`;
}

// ---- Status: top strip, playing now, modes/variables, devices (called from onStatus) ----
function liveStatus() {
  const st = S.status;
  if (!$('#live')) return;
  const p = P();
  // Top strip: grand master, blackout, outputs, clock.
  const o = st?.outputs || {};
  $('#lvTop').innerHTML = st ? [
    `<span class="chip${st.gm < 100 ? ' warn' : ''}" title="Grand master">GM ${st.gm}%</span>`,
    st.blackout ? '<span class="chip bad">BLACKOUT</span>' : '',
    ...PROTOCOLS.map(([k, n]) => `<span class="chip${o[k] ? '' : ' muted'}" title="${n} output">${n} ${o[k] ? (o[k + 'Fps'] ? `${o[k + 'Fps']} fps` : 'on') : 'off'}</span>`),
    `<span class="chip" title="Engine">${st.stats?.engineFps ?? '?'} fps</span>`,
    st.clock?.local ? `<span class="chip mono" title="Controller clock">${esc(st.clock.local.slice(11))}</span>` : '',
  ].join('') : '<span class="muted">Waiting for the controller…</span>';
  if (!S.liveHold) livePlaying(st);
  liveVars(st);
  liveDevices(st);
}

function livePlaying(st) {
  const el = $('#lvPlay');
  if (!el) return;
  const pbs = st?.playbacks || [];
  const trigName = (id) => P().triggers.find((t) => t.id === id)?.name || '?';
  const rows = pbs.map((pb) => {
    const ref = `${pb.kind} ${pb.id}`, tl = pb.kind === 'timeline';
    const state = pb.releasing ? 'releasing' : pb.paused ? 'paused' : pb.ended ? 'holding' : '';
    const run = tl && !pb.paused && !pb.ended ? 1 : 0;
    if (tl && pb.length) pb = { ...pb, pos: Math.min(pb.pos, pb.length) };   // holding at the end: the clock stops there
    return `<div class="lv-pb">
      <div class="row nowrap"><span class="tag">${tl ? '▶' : '◼'} ${pb.kind}</span>
        <b class="lv-name" ${tl ? `data-goto-timeline="${pb.id}"` : ''} title="${tl ? 'Open the timeline' : ''}">${esc(pb.name)}</b>
        ${state ? `<span class="tag">${state}</span>` : ''}<span class="spacer" style="flex:1"></span>
        ${pb.master < 100 ? `<span class="muted">${pb.master}%</span>` : ''}
        ${tl ? `<span class="muted mono" data-lvpos="${pb.pos}" data-len="${pb.length || 0}" data-run="${run}">${fmtTime(pb.pos)}${pb.length ? ' / ' + fmtTime(pb.length) : ''}</span>` : ''}</div>
      ${tl && pb.length ? `<div class="bar"><div data-lvbar style="width:${Math.min(100, (pb.pos / pb.length) * 100)}%"></div></div>` : ''}
      <div class="row lv-btns">${tl ? `<button class="btn small" data-cmd="${pb.paused ? 'resume' : 'pause'} ${ref}">${pb.paused ? 'Resume' : 'Pause'}</button>
        <button class="btn small" data-cmd="start ${ref}">Restart</button>` : ''}
        <button class="btn small ghost" data-cmd="${tl ? `stop ${ref} fade 2` : `release ${ref} fade 1`}">Release</button></div></div>`;
  });
  // Trigger runs that are waiting (sleep / wait until / repeat): the same list as the Dashboard.
  const kind = (s) => (s.wait != null ? 'wait' : s.loop != null ? 'loop' : s.sleep ? 'sleep' : s.every ? 'repeat' : 'delayed');
  const waits = (st?.scheduled || []).map((s) => `<div class="lv-pb row nowrap"><span class="tag">⏳ ${kind(s)}</span>
    <b class="lv-name" data-goto-trigger="${s.trigger}">${esc(trigName(s.trigger))}</b><span class="spacer" style="flex:1"></span>
    <span class="muted">${s.wait != null ? (s.in >= 0 ? `≤ ${(s.in / 1000).toFixed(0)}s` : 'until…') : `in ${(Math.max(0, s.in) / 1000).toFixed(1)}s`}</span>
    <button class="btn small ghost" data-cmd="${s.every && s.loop == null ? 'stop repeat' : 'cancel trigger'} ${s.trigger}" title="Stop this run">✕</button></div>`);
  el.innerHTML = rows.join('') + waits.join('') || '<span class="muted">Nothing running.</span>';
  el.dataset.at = st?._at || Date.now();
}
// Between status updates: move the running timelines' clocks and bars on.
function livePosFrame() {
  const el = $('#lvPlay');
  if (!el) return;
  const dt = Date.now() - (+el.dataset.at || Date.now());
  for (const t of $$('[data-lvpos]', el)) {
    if (t.dataset.run !== '1') continue;
    const len = +t.dataset.len, pos = len ? Math.min(len, +t.dataset.lvpos + dt) : +t.dataset.lvpos + dt;
    t.textContent = fmtTime(pos) + (len ? ' / ' + fmtTime(len) : '');
    const bar = t.closest('.lv-pb').querySelector('[data-lvbar]');
    if (bar && len) bar.style.width = `${Math.min(100, (pos / len) * 100)}%`;
  }
}

function liveVars(st) {
  const el = $('#lvVars');
  if (!el) return;
  const p = P(), vals = st?.vars || {}, prev = S.liveVarPrev || (S.liveVarPrev = {}), now = Date.now();
  const changed = S.liveVarChanged || (S.liveVarChanged = {});
  const modes = p.modes.map((g) => {
    const cur = st?.modes?.[g.name] || '', icon = g.stateInfo?.[cur]?.icon || '';
    return `<div class="row nowrap lv-var"><span class="muted" style="flex:1">${esc(g.name)}</span>
      <span class="chip" style="${cur ? `border-color:${modeColor(g, cur)};color:${modeColor(g, cur)}` : ''}">${esc(icon)} ${esc(cur || '–')}</span></div>`;
  });
  const vars = p.variables.map((v) => {
    const val = vals[v.name] ?? '';
    if (prev[v.name] !== undefined && prev[v.name] !== val) changed[v.name] = now;
    prev[v.name] = val;
    const fresh = now - (changed[v.name] || 0) < 1500;
    const shown = v.type === 'bool' ? (val === '1' ? '● on' : '○ off') : val === '' ? '–' : val;
    return `<div class="row nowrap lv-var${fresh ? ' fresh' : ''}"><span class="muted" style="flex:1">${esc(v.name)}</span><span class="mono">${esc(String(shown))}</span></div>`;
  });
  el.innerHTML = modes.join('') + vars.join('');
}

function liveDevices(st) {
  const el = $('#lvDev');
  if (!el) return;
  const list = [];
  const add = (name, kind, state, extra = '') => list.push({ name, kind, state, extra });
  for (const h of st?.monitor?.hosts || []) add(h.name, h.kind === 'pc' ? 'PC' : 'device', h.state);
  for (const x of st?.projectors || []) add(x.name, 'projector', !x.seen ? 'unknown' : x.online ? 'online' : 'offline', x.online && x.power ? x.power : '');
  for (const x of st?.drivers || []) add(x.name, x.type, !x.seen ? 'unknown' : x.online ? 'online' : 'offline');
  for (const x of st?.io?.tcp || []) add(x.name, 'tcp', x.state);
  for (const x of st?.io?.modbus || []) add(x.name, 'modbus', x.state);
  const order = { offline: 0, unknown: 1, online: 2 };
  list.sort((a, b) => (order[a.state] ?? 1) - (order[b.state] ?? 1) || a.name.localeCompare(b.name));
  const dot = (s) => (s === 'online' ? 'ok' : s === 'offline' ? 'bad' : '');
  el.innerHTML = list.length ? list.map((d) => `<span class="lv-dev${d.state === 'offline' ? ' off' : ''}" data-view="monitor" title="${esc(d.kind)} · ${esc(d.state)}${d.extra ? ' · ' + esc(d.extra) : ''}">
    <span class="dot ${dot(d.state)}"></span>${esc(d.name)}${d.extra ? ` <span class="muted">${esc(d.extra)}</span>` : ''}</span>`).join('')
    : '<span class="muted">No devices.</span>';
}

// ---- Trigger feed and warnings (from the log stream; called from addLog) --------------
function liveLog(m) {
  if (m.c === 'TRIG') { clearTimeout(liveLog.t); liveLog.t = setTimeout(liveFeed, 80); }
  if (m.l >= 2) liveWarn();
}
function liveFeed() {
  const el = $('#lvFeed');
  if (!el) return;
  const p = P(), rows = [], seen = S.liveFeedSeen || 0;
  for (let i = S.log.length - 1; i >= 0 && rows.length < 25; i--) {
    const m = S.log[i];
    if (m.c !== 'TRIG' || !m.m) continue;
    const x = FIRED_LINE.exec(m.m), sk = !x && SKIPPED_LINE.exec(m.m);
    if (!x && !sk) continue;
    const id = +(x || sk)[1], t = p.triggers.find((tr) => tr.id === id && tr.type !== 'comment');
    const col = trigColor(t?.color) || 'var(--accent)';
    const why = (x ? x[2] : sk[2]).replace(/ - fires more than.*$/, '');
    rows.push(`<div class="lv-fire${sk ? ' no' : ''}${m.s > seen && seen ? ' new' : ''}" style="--c:${sk ? 'var(--err)' : col}">
      <span class="t mono">${logTime(m).replace(/\.\d+$/, '')}</span>
      <span class="lv-name" data-goto-trigger="${id}" title="Open the trigger"><span class="fl-id">${id}</span> ${esc(t?.name || '?')}</span>
      <span class="muted why" title="${esc(sk ? `condition false: ${sk[3]}` : why)}">${sk ? '✕ condition false' : esc(why)}</span></div>`);
  }
  el.innerHTML = rows.join('') || '<span class="muted">Nothing fired since this page was opened.</span>';
  S.liveFeedSeen = S.logSeq;
}
function liveWarn() {
  const el = $('#lvWarn');
  if (!el) return;
  const rows = S.log.filter((m) => m.l >= 2).slice(-6).reverse();
  el.innerHTML = rows.length ? rows.map((m) => `<div class="lv-fire" style="--c:${m.l >= 3 ? 'var(--err)' : 'var(--warn)'}">
    <span class="t mono">${logTime(m).replace(/\.\d+$/, '')}</span><span class="why" title="${esc(m.m)}">${esc(m.m)}</span></div>`).join('')
    : '<span class="muted">No warnings.</span>';
}
