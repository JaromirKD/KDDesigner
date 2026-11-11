'use strict';
// KD Designer web UI - adding/moving/deleting items, global event handlers, start-up.
// Plain scripts sharing one global scope; load order is in index.html.

// ---------------------------------------------------------------------------
// Adding, moving and deleting items (data-add / data-move / data-del buttons)
// ---------------------------------------------------------------------------
function addItem(kind) {
  const p = P();
  if (kind.startsWith('ptrig-')) return addPanelTrigger(p.panel.pages[S.sel.page || 0].controls[+kind.slice(6)]);
  if (kind.startsWith('devgroup-')) {
    const gk = kind.slice(9);
    let n = 1;
    while (p.deviceGroups.some((g) => groupKind(g) === gk && g.name === 'group' + n)) n++;
    p.deviceGroups.push({ name: 'group' + n, ...(gk === 'network' ? {} : { kind: gk }), devices: [] });
    return markDirty(), render();
  }
  const fx = (name, channels, type, mode) => {
    const u = p.universes[0]?.id || 1;
    const end = p.fixtures.filter((f) => f.universe === u).reduce((m, f) => Math.max(m, f.address + footprint(f)), 1);
    const f = { id: nextId(p.fixtures), name: `${name} ${nextId(p.fixtures)}`, universe: u, address: end, channels, ...(type ? { type, mode } : {}) };
    p.fixtures.push(f);
    if (S.view === 'fixtures') { S.fxSel = new Set([f.id]); S.fxGroup = null; S.revealFx = true; }
    // Added from the Map page: place it there straight away, next to the last one.
    const m = S.view === 'map' && p.maps[S.sel.map];
    if (m) {
      const last = m.items[m.items.length - 1];
      m.items.push({ fixture: f.id, x: last ? Math.min(0.95, last.x + 0.05) : 0.5, y: last ? last.y : 0.5 });
      S.mapSel = new Set([f.id]);
    }
  };
  switch (kind) {
    case 'universe':
      if (p.universes.length >= MAX_UNIVERSES) return toast(`The controller has at most ${MAX_UNIVERSES} universes`, true);
      p.universes.push(newUniverse(nextId(p.universes)));
      break;
    case 'pc': { const id = nextId(p.pcs); p.pcs.push({ id, name: 'PC ' + id, ip: '192.168.1.' + (40 + id), mac: '', port: 7, startup: 'startup', shutdown: 'shutdown', reboot: 'reboot' }); break; }
    case 'projector': { const id = nextId(p.projectors); p.projectors.push({ id, name: 'Projector ' + id, ip: '192.168.1.' + (100 + id), port: 4352, password: '' }); break; }
    case 'drv-kissbox': case 'drv-knx': case 'drv-brightsign': case 'drv-digidot': case 'drv-netio': case 'drv-pharos': {
      const type = kind.slice(4), id = nextId(p.drivers);
      const base = { netio: 'rack', kissbox: 'io', knx: 'knx', brightsign: 'player', digidot: 'c4', pharos: 'lpc' }[type];
      let name = base, n = 2;
      while (p.drivers.some((d) => d.name === name)) name = base + n++;
      const d = { id, type, name, ip: '192.168.1.' + (120 + id), port: DRIVERS[type].port };
      if (type === 'netio') Object.assign(d, { user: 'netio', password: 'netio' });
      if (type === 'digidot') Object.assign(d, { user: 'admin', password: 'admin' });
      if (type === 'brightsign') Object.assign(d, { user: 'admin', password: '', udpPort: 5000, commands: [] });
      if (type === 'kissbox') Object.assign(d, { frame: 'IO3', cards: ['DO4PR', 'DI8DC', ''], listenPort: 9813, names: {} });
      if (type === 'knx') d.addresses = [];
      if (type === 'pharos' || type === 'netio') d.live = false;
      d.vars = {};
      p.drivers.push(d);
      S.devTab = type;
      break;
    }
    case 'fixture': fx('Fixture', ['dim']); break;
    case 'fixture-rgb': fx('RGB', ['r', 'g', 'b'], 'Generic / RGB', '3 ch'); break;
    case 'fixture-rgbw': fx('RGBW', ['dim', 'r', 'g', 'b', 'w'], 'Generic / RGBW', '5 ch'); break;
    case 'fixture-dim': fx('Dimmer', ['dim'], 'Generic / Dimmer', '1 ch'); break;
    case 'fixture-16': fx('Winch', ['pos:16', 'speed', 'enable'], 'Generic / Motor / winch', '3 ch'); break;
    case 'map': p.maps.push({ id: nextId(p.maps), name: 'Map ' + nextId(p.maps), aspect: 1.6, background: '', snap: true, labels: true, items: [], shapes: [] }); S.sel.map = p.maps.length - 1; S.mapSel = new Set(); break;
    case 'modegroup': p.modes.push({ name: 'Group ' + (p.modes.length + 1), states: ['On', 'Off'], stateInfo: {} }); break;
    case 'device': p.devices.push({ name: 'device' + (p.devices.length + 1), ip: '192.168.1.20', port: 7000 }); break;
    case 'variable': {
      let n = 1;
      while (p.variables.some((v) => v.name === 'var' + n)) n++;
      p.variables.push({ name: 'var' + n, type: 'number', initial: 0, persist: false });
      break;
    }
    case 'calendar': p.calendar.push({ name: 'Closed', from: '12-25', to: '12-26' }); break;
    case 'tcpdev': p.tcp.push({ name: 'tcp' + (p.tcp.length + 1), ip: '192.168.1.60', port: 23, eol: '\\r\\n' }); break;
    case 'mbdev': p.modbus.push({ name: 'plc' + (p.modbus.length || ''), ip: '192.168.1.80', port: 502, unit: 1, pollMs: 500 }); break;
    case 'page': {
      const id = nextId(p.panel.pages), pn = curPanel();
      p.panel.pages.push({ id, name: 'Page ' + id, panel: pn.id, columns: 3, controls: [] });
      pn.start ??= id;
      S.sel.page = p.panel.pages.length - 1;
      break;
    }
    case 'panelset': {
      const id = nextId(p.panel.panels);
      p.panel.panels.push({ id, name: 'Panel ' + id, title: '' });
      S.sel.panel = p.panel.panels.length - 1;
      break;
    }
    case 'pc-button': case 'pc-toggle': case 'pc-slider': case 'pc-dial': case 'pc-color': case 'pc-xy': case 'pc-label': case 'pc-clock': case 'pc-spacer': case 'pc-group': {
      const pg = p.panel.pages[S.sel.page || 0];
      const type = kind.slice(3), n = pg.controls.filter((c) => c.type === type).length + 1;
      pg.controls.push({
        button: { type, name: 'Button ' + n, text: 'Button ' + n }, toggle: { type, name: 'Toggle ' + n, text: 'Toggle ' + n },
        slider: { type, name: 'slider' + n, text: 'Level', min: 0, max: 100, unit: '%' }, dial: { type, name: 'dial' + n, text: 'Volume', min: 0, max: 100 },
        color: { type, name: 'colour' + n, text: 'Colour', value: '#ffffff', links: {} },
        xy: { type, name: 'xy' + n, text: 'Pan / tilt', min: 0, max: 100, ymin: 0, ymax: 100, links: {}, span: 2 }, label: { type, name: 'label' + n, text: 'Status' },
        group: { type, name: 'group' + n, text: 'Group ' + n, span: 2 },
      }[type] || { type });
      break;
    }
    case 'separator': {
      // In a colour tab: that colour. The tab's first main section goes on top of its triggers
      // (insertColorHead); once it has one, a new separator is a sub section after the last item.
      const spot = trigAddSpot(), s = { id: nextId(p.triggers), name: '== SECTION', type: 'comment', actions: [] };
      if (spot.color == null) p.triggers.push(s);
      else {
        if (spot.color) s.color = spot.color;
        if (trigColorHead(spot.color)) { s.level = 2; s.name = 'Sub section'; p.triggers.splice(spot.at, 0, s); }
        else insertColorHead(spot.color, s);
      }
      renumberTriggers(p);
      selectTriggers([p.triggers.indexOf(s)]);
      break;
    }
    case 'condition': p.triggers[S.sel.trigger].conditions.push(''); break;
    case 'scene': p.scenes.push({ id: nextId(p.scenes), name: 'Scene ' + nextId(p.scenes), levels: [] }); S.sel.scene = p.scenes.length - 1; break;
    case 'level': {
      const f = p.fixtures[0];
      p.scenes[S.sel.scene].levels.push(f ? { fixture: f.id, ch: (f.channels || [])[0], v: 255 } : { u: p.universes[0]?.id || 1, ch: 1, v: 255 });
      break;
    }
    case 'timeline': p.timelines.push({ id: nextId(p.timelines), name: 'Timeline ' + nextId(p.timelines), length: 10000, loop: false, priority: 0, tracks: [{ name: 'Scenes', fixtures: [], groups: [] }], cues: [] }); S.sel.timeline = p.timelines.length - 1; S.sel.cue = -1; break;
    case 'cue': case 'cue:preset': case 'cue:scene': case 'cue:effect': case 'trigcue': {
      // At the cursor, on the cursor's track (else the selected cue's track, else the first).
      // Without a cursor: a 4 s clip right after the last one on that track; a trigger cue
      // 1 s after the last trigger cue.
      const t = p.timelines[S.sel.timeline];
      const sel = t.cues[S.sel.cue], trig = kind === 'trigcue';
      const track = trig ? null : typeof S.tlCursorLane === 'number' && t.tracks[S.tlCursorLane] ? S.tlCursorLane : sel && sel.trigger == null ? sel.track || 0 : 0;
      const same = t.cues.filter((c) => (trig ? c.trigger != null : c.trigger == null && (c.track || 0) === track));
      if (trig) return addCue(t, { t: S.tlCursor ?? same.reduce((m, c) => Math.max(m, c.t), -1000) + 1000 }, 'trigger');
      const at = S.tlCursor ?? same.reduce((m, c) => Math.max(m, c.len ? c.t + c.len : c.t + 1000), 0);
      // Up to the next clip on the track, at most 4 s.
      const nx = Math.min(Infinity, ...same.filter((c) => c.t > at).map((c) => c.t));
      const len = Math.max(100, Math.min(4000, nx - at));
      if (S.tlCursor != null) S.tlCursor = at + len;   // so the next + Colour / Scene lands after this one
      // The kind asked for; plain "cue" (older callers): a colour on a track with fixtures, else a scene.
      return addCue(t, { t: at, track, len }, kind.split(':')[1] || (trackFxIds(t.tracks[track]).length ? 'preset' : 'scene'));
    }
    case 'track': {
      const t = p.timelines[S.sel.timeline];
      if (t.tracks.length >= 16) return toast('Max 16 tracks per timeline', true);
      t.tracks.push({ name: 'Track ' + (t.tracks.length + 1), fixtures: [], groups: [] });
      S.trackEdit = t.tracks.length - 1;
      break;
    }
    case 'trigger': {
      const t = { id: nextId(p.triggers), name: '', type: 'manual', enabled: true, conditions: [], actions: [''] };
      // At the end, or in a colour tab: that colour, after the tab's last item.
      const spot = trigAddSpot();
      if (spot.color) t.color = spot.color;
      p.triggers.splice(spot.at, 0, t);
      renumberTriggers(p);
      t.name = uniqueTrigName('Trigger ' + t.id);
      selectTriggers([p.triggers.indexOf(t)]);
      break;
    }
    case 'action': p.triggers[S.sel.trigger].actions.push(''); break;
    case 'colorTheme': {
      // Starts as the theme the wheels show now (app-colors.js).
      const all = allThemes(p);
      p.colorThemes.push({ id: nextId(p.colorThemes), name: uniqueName(all, 'My theme'), colors: [...cwTheme().colors] });
      S.sel.theme = all.length;
      S.themeSwatch = 0;
      break;
    }
  }
  markDirty();
  render();
  if (kind === 'action') $$('input.cmd').pop()?.focus();
  if (kind === 'condition') $$('input.cond').pop()?.focus();
  if (kind === 'trigger' || kind === 'separator') {
    const name = $(`[data-p="triggers.${S.sel.trigger}.name"]`);
    name?.focus({ preventScroll: true });
    name?.select();
    name?.scrollIntoView({ block: 'nearest' });
  }
}
// "+ trigger" next to a panel control: a Panel trigger for it, opened on the Triggers page.
function addPanelTrigger(c) {
  const p = P();
  const event = PANEL_VALUE_TYPES.includes(c.type) ? 'change' : 'click';
  const t = { id: nextId(p.triggers), name: '', type: 'panel', control: c.name, event, enabled: true, conditions: [], actions: [''] };
  p.triggers.push(t);
  renumberTriggers(p);
  t.name = uniqueTrigName(`${c.text || c.name} ${event}`);
  S.view = 'triggers';
  selectTriggers([p.triggers.length - 1]);
  markDirty();
  render();
  $$('input.cmd').pop()?.focus();
}
function moveItem(list, i, d) {
  const j = i + d;
  if (j < 0 || j >= list.length) return i;
  [list[i], list[j]] = [list[j], list[i]];
  markDirty();
  return j;
}
// ---- Where used: the triggers, cues, panel controls, modes… that refer to a scene,
// timeline, effect, variable or device. Trigger lines are read with the command grammar
// (lineRefs), so "scene 3" and 'scene "Intro"' both count, also after if/then and in repeat.
// Path list -> what kind of item it holds (and for devices, which placeholders name them).
const USE_KINDS = {
  scenes: { parts: ['{sc}'], ids: true }, timelines: { parts: ['{tl}'], ids: true }, effects: { parts: [], ids: true },
  variables: { parts: ['{var}'] },
  devices: { parts: ['{device}', '{devname}'], group: 'network' }, pcs: { parts: ['{pc}', '{devname}'], ids: true, group: 'pc' },
  projectors: { parts: ['{pj}', '{devname}'], ids: true, group: 'projector' }, tcp: { parts: ['{tcpdev}', '{devname}'], group: 'tcp' },
  modbus: { parts: ['{mbdev}', '{devname}'] }, drivers: { parts: [], ids: true },
};
// [{where, what, attr}]: attr = the link attributes that open it (data-goto-… or data-view).
function whereUsed(listName, x) {
  const k = USE_KINDS[listName], p = P();
  if (!k || !x) return [];
  const out = [], name = String(x.name || '').toLowerCase();
  const parts = listName === 'drivers' ? [Object.keys(DRV_PART).find((q) => DRV_PART[q] === x.type), '{devname}'] : k.parts;
  const groups = k.group || listName === 'drivers' ? p.deviceGroups.filter((g) => (g.kind || 'network') === (k.group || x.type) && g.devices.some((d) => d.toLowerCase() === name)) : [];
  // Does a reference word name this item? Its number (where numbers work), its name, or a device group it is in.
  const hit = (v) => {
    const s = String(v).toLowerCase();
    if (s === 'all' && (listName === 'pcs' || listName === 'projectors')) return ` (all ${listName === 'pcs' ? 'PCs' : 'projectors'})`;
    if (k.ids && /^\d+$/.test(s)) return +s === x.id ? '' : null;
    if (s === name && name) return '';
    const g = groups.find((q) => q.name.toLowerCase() === s);
    return g ? ` (through device group ${g.name})` : null;
  };
  // {name} / {=maths with name} in a line: a variable read when it runs.
  const braceVar = (line) => listName === 'variables' && [...line.matchAll(/\{=?([^}]*)\}/g)].some((m) => (m[1].match(/[A-Za-z_][\w.]*/g) || []).some((w) => w.toLowerCase() === name));
  const scan = (lines, grammar, label, where, attr) => (lines || []).forEach((line, i) => {
    if (!line || !line.trim() || line.trim().startsWith('#')) return;
    let refs = [];
    try { refs = lineRefs(line, grammar); } catch { /* a line the grammar can't read */ }
    const r = refs.map((q) => parts.includes(q.part) && hit(q.v)).find((q) => q !== null && q !== false && q !== undefined);
    if (r !== undefined || braceVar(line)) out.push({ where, what: `${label} ${i + 1}: ${line}${r || ''}`, attr });
  });
  for (const t of p.triggers) {
    if (t.type === 'comment') continue;
    const where = `Trigger ${t.id} ${t.name || ''}`, attr = `data-goto-trigger="${t.id}"`;
    scan(t.actions, GRAMMAR, 'action', where, attr);
    scan(t.conditions, COND_GRAMMAR, 'condition', where, attr);
    // What sets the trigger off.
    const src = { variables: t.type === 'variable' && t.variable, timelines: t.type === 'timeline_end' && t.timeline,
      devices: t.type === 'device' && t.device, pcs: t.type === 'device' && t.device, tcp: (t.type === 'tcp' || t.type === 'device') && t.device,
      projectors: (t.type === 'projector' && t.projector) || (t.type === 'device' && t.device), modbus: t.type === 'device' && t.device, drivers: t.type === 'device' && t.device }[listName];
    if (src != null && src !== false && src !== '' && hit(src) !== null) out.push({ where, what: `sets it off (${t.type === 'timeline_end' ? 'timeline ends' : t.type})`, attr });
    if (listName === 'devices' && (t.type === 'udp' || t.type === 'osc') && x.ip && t.fromIp === x.ip) out.push({ where, what: `only messages from ${x.ip}`, attr });
  }
  for (const g of p.modes || []) {
    const attr = 'data-view="modes"';
    for (const [st, info] of Object.entries(g.stateInfo || {})) {
      scan(info.enter, GRAMMAR, 'on enter, line', `Mode ${g.name} › ${st}`, attr);
      scan(info.leave, GRAMMAR, 'on leave, line', `Mode ${g.name} › ${st}`, attr);
    }
    if (listName === 'variables' && g.var && g.var.toLowerCase() === name) out.push({ where: `Mode ${g.name}`, what: 'follows / sets this variable', attr });
  }
  if (listName === 'scenes' || listName === 'effects')
    for (const tl of p.timelines) {
      const n = tl.cues.filter((c) => (listName === 'scenes' ? c.trigger == null && c.effect == null && c.scene === x.id : c.effect === x.id)).length;
      if (n) out.push({ where: `Timeline ${tl.id} ${tl.name || ''}`, what: `${n} cue${n > 1 ? 's' : ''}`, attr: `data-goto-timeline="${tl.id}"` });
    }
  for (const pg of p.panel.pages)
    for (const c of pg.controls) {
      const pn = p.panel.panels.find((q) => q.id === pg.panel);
      const where = `Panel ${pn && p.panel.panels.length > 1 ? `${pn.name} › ` : ''}${pg.name || 'page'} › ${c.text || c.name || c.type}`;
      if (listName === 'timelines' && +c.follow === x.id) out.push({ where, what: 'follows this timeline', attr: 'data-view="panel"' });
      if (listName === 'variables') {
        const links = [c.var && ['var', c.var], ...Object.entries(c.links || {})].filter((q) => q && q[1] && String(q[1]).toLowerCase() === name);
        if (links.length) out.push({ where, what: `linked (${links.map((q) => q[0]).join(', ')})`, attr: 'data-view="panel"' });
      }
    }
  if (listName === 'variables')
    for (const d of p.drivers || []) {
      const pts = Object.entries(d.vars || {}).filter(([, v]) => String(v).toLowerCase() === name).map(([k2]) => k2);
      const ga = (d.addresses || []).filter((a) => String(a.var || '').toLowerCase() === name).map((a) => a.ga);
      if (pts.length || ga.length) out.push({ where: `Device ${d.name}`, what: `reading ${[...pts, ...ga].join(', ')} → this variable`, attr: `data-goto-devices="${esc(d.type)}"` });
    }
  for (const g of groups) out.push({ where: `Device group ${g.name}`, what: 'member', attr: 'data-view="devices"' });
  return out;
}
const usedLines = (list, max = 8) => list.slice(0, max).map((u) => `• ${u.where}: ${u.what}`).join('\n') + (list.length > max ? `\n… and ${list.length - max} more` : '');
// "Used in N places" for an editor: a fold-out list with open → links.
function usedHtml(listName, x) {
  const list = whereUsed(listName, x);
  if (!list.length) return '<span class="muted used-none">Not used by any trigger, cue or panel control</span>';
  return `<details class="used"${S.usedOpen ? ' open' : ''}><summary>Used in ${list.length} place${list.length > 1 ? 's' : ''}</summary>
    <ul>${list.map((u) => `<li><a href="#" ${u.attr}>${esc(u.where)}</a> <span class="muted">${esc(u.what)}</span></li>`).join('')}</ul></details>`;
}
document.addEventListener('toggle', (e) => { if (e.target.matches?.('details.used')) S.usedOpen = e.target.open; }, true);
// The same list as a small window (right-click "Where used…" on any of those items).
function showWhereUsed(listName, x) {
  $('#usedPop')?.remove();
  const list = whereUsed(listName, x);
  const box = document.createElement('div');
  box.id = 'usedPop';
  box.innerHTML = `<div class="keys-help card" role="dialog"><div class="row"><b style="flex:1">Where '${esc(x.name || x.id)}' is used</b><button class="btn small ghost" data-usedx>✕</button></div>
    ${list.length ? `<ul class="used-list">${list.map((u) => `<li><a href="#" ${u.attr}>${esc(u.where)}</a> <span class="muted">${esc(u.what)}</span></li>`).join('')}</ul>` : '<p class="muted">Not used by any trigger, cue, panel control, mode or device.</p>'}</div>`;
  document.body.appendChild(box);
  // A link opens the item (handled by the global click handler) and closes this.
  box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-usedx], a')) setTimeout(() => box.remove()); });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#usedPop')) { e.stopPropagation(); $('#usedPop').remove(); } }, true);
function deleteItem(path) {
  const keys = path.split('.');
  const i = +keys.pop();
  const list = getPath(P(), keys.join('.'));
  const it = list[i];
  if (keys.length === 1 && keys[0] === 'triggers') return deleteTriggers([i]);  // warns about references
  const used = keys.length === 1 ? whereUsed(keys[0], it) : [];
  const fxUse = keys[0] === 'effects' && used.length ? "\n\nTimeline cues that use this effect stop the project from loading until they're changed." : '';
  const warn = used.length ? `\n\nStill used in ${used.length} place${used.length > 1 ? 's' : ''} (those will point to nothing):\n${usedLines(used)}${fxUse}` : '';
  if (it && typeof it === 'object' && it.name && !confirm(`Delete '${it.name}'?${warn}`)) return;
  list.splice(i, 1);
  if (keys.length === 1 && keys[0] === 'triggers') renumberTriggers();
  for (const k of ['scene', 'timeline', 'trigger', 'map', 'effect']) S.sel[k] = Math.min(S.sel[k] || 0, Math.max(0, P()[k + 's'].length - 1));
  if (/\.cues$/.test(keys.join('.'))) S.sel.cue = -1;
  S.sel.page = Math.min(S.sel.page || 0, Math.max(0, P().panel.pages.length - 1));
  markDirty();
  render();
}

// ---------------------------------------------------------------------------
// Global event handlers
// ---------------------------------------------------------------------------
// "open →" links to a trigger, timeline or effect on another page (or the same one).
function goTo(e, link) {
  e.preventDefault();
  const d = link.dataset, p = P();
  if (d.gotoTrigger) { S.view = 'triggers'; selectTriggers([p.triggers.findIndex((t) => t.id === +d.gotoTrigger)]); }
  else if (d.gotoTimeline) { S.view = 'timelines'; S.sel.timeline = Math.max(0, p.timelines.findIndex((tl) => tl.id === +d.gotoTimeline)); S.sel.cue = -1; S.trackEdit = null; }
  else if (d.gotoEffect) { S.view = 'effects'; S.sel.effect = Math.max(0, p.effects.findIndex((x) => x.id === +d.gotoEffect)); }
  else if (d.gotoDevices) { S.view = 'devices'; S.devTab = d.gotoDevices; }
  render();
}
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-view],[data-cmd],[data-add],[data-del],[data-sel],[data-test],[data-fire],[data-sort],[data-move],[data-pmove],[data-build],[data-goto-trigger],[data-goto-timeline],[data-goto-effect],[data-goto-devices],[data-out],#save,#bo');
  if (!t) return;
  if (t.dataset.out) toggleOutput(t.dataset.out);
  else if (t.dataset.view) { if (t.tagName === 'A') e.preventDefault(); S.view = t.dataset.view; render(); }
  else if (t.dataset.gotoTrigger || t.dataset.gotoTimeline || t.dataset.gotoEffect || t.dataset.gotoDevices) goTo(e, t);
  else if (t.dataset.move) moveTriggers(+t.dataset.move);
  else if (t.dataset.build) openBuilder(t.dataset.build, t.dataset.grammar === 'cond' ? COND_GRAMMAR : GRAMMAR);
  else if (t.dataset.pmove) {
    const [i, d] = t.dataset.pmove.split(':').map(Number);
    moveItem(P().panel.pages[S.sel.page || 0].controls, i, d);
    render();
  }
  else if (t.dataset.cmd) {
    if (t.dataset.confirm && !confirm(t.dataset.confirm)) return;
    const r = await cmd(t.dataset.cmd);
    toast(r.reply, !r.ok);
  }
  else if (t.dataset.add) addItem(t.dataset.add);
  else if (t.dataset.del) deleteItem(t.dataset.del);
  else if (t.dataset.sel) {
    const [k, i] = t.dataset.sel.split(':');
    if (k === 'trigger') clickTrigger(+i, e);
    else {
      if (k === 'timeline' && +i !== S.sel.timeline) { S.sel.cue = -1; S.trackEdit = null; }
      S.sel[k] = +i;
      render();
    }
  }
  else if (t.dataset.test) { const r = await cmd(getPath(P(), t.dataset.test)); toast(r.reply, !r.ok); }
  else if (t.dataset.fire) {
    if (S.dirty) toast('Unsaved changes are not on the controller yet', true);
    try { const r = await api('/api/trigger?id=' + t.dataset.fire, { method: 'POST' }); toast(r.reply); } catch (err) { toast(err.message, true); }
  } else if (t.dataset.sort !== undefined) { P().timelines[S.sel.timeline].cues.sort((a, b) => a.t - b.t); markDirty(); render(); }
  else if (t.id === 'save') save();
  else if (t.id === 'bo') { const r = await cmd(`blackout ${S.status?.blackout ? 'off' : 'on'}`); toast(r.reply, !r.ok); }
});
// ---------------------------------------------------------------------------
// Right-click menus. Right-clicking an item selects it (unless it is already part of the
// selection) and offers its common actions. Most actions run the page's own keyboard shortcut
// (pageKey), so a menu and its key always do the same thing. Text fields keep the browser's
// own menu (cut/copy/paste), and so does Shift+right-click anywhere.
// ---------------------------------------------------------------------------
// The page's keys() with a made-up key press, e.g. pageKey('d', true) = Ctrl+D.
const pageKey = (key, ctrl = false) => views[S.view]?.keys?.({ key, code: '', ctrlKey: ctrl, metaKey: false, shiftKey: false, altKey: false, preventDefault() {}, stopPropagation() {} });
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    // Not a secure page (the controller over plain http): the old way.
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(`Copied: ${text}`);
}
const ctxCmd = async (line) => {
  if (S.dirty) toast('Unsaved changes are not on the controller yet', true);
  const r = await cmd(line);
  toast(r.reply, !r.ok);
};
// "Name" -> "Name (2)", "rack" -> "rack2" (names used in commands stay one word).
function uniqueName(list, name) {
  const taken = new Set(list.map((x) => String(x.name || '').toLowerCase()));
  const one = !/\s/.test(name), stem = name.replace(one ? /\d+$/ : /\s\(\d+\)$/, '');
  let n = 2;
  const make = () => (one ? `${stem}${n}` : `${stem} (${n})`);
  while (taken.has(make().toLowerCase())) n++;
  return make();
}
// A copy right after the original, with a new number and name. Returns the copy's index.
function duplicateItem(path) {
  const keys = path.split('.'), i = +keys.pop(), list = getPath(P(), keys.join('.'));
  const c = structuredClone(list[i]);
  if (typeof c.id === 'number') c.id = nextId(list);
  if (c.name) c.name = uniqueName(list, c.name);
  list.splice(i + 1, 0, c);
  markDirty();
  return i + 1;
}
// Menus per kind of item: [selector, (el, e) => items]; the first one the click is inside wins.
// An item is { label, run, key (shown on the right), danger, off (greyed out) } or null (a line).
const fireTrig = async (t) => {
  if (S.dirty) toast('Unsaved changes are not on the controller yet', true);
  try { const r = await api('/api/trigger?id=' + t.id, { method: 'POST' }); toast(r.reply); } catch (err) { toast(err.message, true); }
};
const listPath = { scene: 'scenes', timeline: 'timelines', effect: 'effects', map: 'maps', page: 'panel.pages' };
const CTX_MENUS = [
  ['[data-sel^="trigger:"]', (el) => {
    const p = P(), i = +el.dataset.sel.split(':')[1], t = p.triggers[i];
    if (!t) return null;
    if (!S.trigSel.has(t)) { selectTriggers([i]); S.revealSel = false; trigSelectUi(); }
    const sel = selectedTrigIdx().map((j) => p.triggers[j]), n = sel.length, real = sel.filter((x) => x.type !== 'comment');
    const on = real.some((x) => x.enabled !== false);
    const rename = () => { const f = $(`[data-p="triggers.${p.triggers.indexOf(t)}.name"]`); f?.focus(); f?.select(); };
    return [
      t.type !== 'comment' && n === 1 && { label: '▶ Fire now', run: () => fireTrig(t) },
      n === 1 && { label: 'Rename', run: rename },
      real.length && { label: on ? 'Disable' : 'Enable', run: () => { real.forEach((x) => { x.enabled = !on; }); markDirty(); render(); } },
      null,
      { label: 'Duplicate', key: 'Ctrl+D', run: () => pageKey('d', true) },
      { label: 'Copy', key: 'Ctrl+C', run: () => pageKey('c', true) },
      { label: 'Cut', key: 'Ctrl+X', run: () => pageKey('x', true) },
      { label: 'Paste after', key: 'Ctrl+V', off: !S.trigClip?.length, run: () => pageKey('v', true) },
      n === 1 && t.name && { label: 'Copy name', run: () => copyText(t.name) },
      null,
      { label: n > 1 ? `Delete ${n} triggers` : 'Delete', key: 'Del', danger: true, run: () => deleteTriggers(selectedTrigIdx()) },
    ];
  }],
  ['[data-cue], [data-cuerow]', (el) => {
    const p = P(), t = p.timelines[S.sel.timeline], c = t?.cues[+(el.dataset.cue ?? el.dataset.cuerow)];
    if (!c) return null;
    if (!tlSelection(t).has(c)) { tlSelect(t, [c], c); render(); }
    const n = tlSelection(t).size, kind = cueKind(c);
    const trig = kind === 'trigger' && p.triggers.find((x) => x.type !== 'comment' && (/^\d+$/.test(String(c.trigger)) ? x.id === +c.trigger : (x.name || '').toLowerCase() === String(c.trigger).toLowerCase()));
    const scene = kind === 'scene' && p.scenes.findIndex((s) => s.id === c.scene);
    return [
      { label: '▶ Play from here', run: () => tlPlayFrom(t, c.t) },
      kind === 'effect' && { label: 'Open effect →', run: () => { S.view = 'effects'; S.sel.effect = Math.max(0, p.effects.findIndex((x) => x.id === c.effect)); render(); } },
      scene >= 0 && scene !== false && { label: 'Open scene →', run: () => { S.view = 'scenes'; S.sel.scene = scene; render(); } },
      trig && { label: 'Open trigger →', run: () => { S.view = 'triggers'; selectTriggers([p.triggers.indexOf(trig)]); render(); } },
      null,
      { label: 'Duplicate', key: 'Ctrl+D', run: () => pageKey('d', true) },
      { label: 'Copy', key: 'Ctrl+C', run: () => pageKey('c', true) },
      { label: 'Cut', key: 'Ctrl+X', run: () => pageKey('x', true) },
      { label: 'Paste at cursor', key: 'Ctrl+V', off: !S.tlClip?.length, run: () => pageKey('v', true) },
      kind !== 'trigger' && { label: 'Split at the cursor', key: 'Ctrl+E', off: !(S.tlCursor > c.t && S.tlCursor < cueEnd(t, c, Infinity)), run: () => pageKey('e', true) },
      n > 1 && { label: `Theme colours across the ${n} clips`, run: () => themeAcrossCues(t, [...tlSelection(t)]) },
      null,
      { label: n > 1 ? `Delete ${n} cues` : 'Delete', key: 'Del', danger: true, run: () => pageKey('Delete') },
    ];
  }],
  // The timeline's empty space, track names and ruler (app-show.js).
  ['[data-ruler]', (el, e) => (S.view === 'timelines' ? tlRulerMenu(el, e) : null)],
  ['.tl-lane', (el, e) => (S.view === 'timelines' ? tlLaneMenu(el, e) : null)],
  ['[data-trackhead]', (el) => (S.view === 'timelines' ? tlHeadMenu(el) : null)],
  ['[data-shape]', (el) => {
    const m = S.view === 'map' && P().maps[S.sel.map];
    if (!m) return null;
    if (S.mapShapeSel !== +el.dataset.shape) { S.mapShapeSel = +el.dataset.shape; render(); }
    return [
      { label: 'Duplicate', key: 'Ctrl+D', run: () => shapeDuplicate(m) },
      { label: 'Bring forward', key: 'PgUp', run: () => shapeOrder(m, 1) },
      { label: 'Send backward', key: 'PgDn', run: () => shapeOrder(m, -1) },
      { label: 'Bring to front', run: () => shapeOrder(m, Infinity) },
      { label: 'Send to back', run: () => shapeOrder(m, -Infinity) },
      null,
      { label: 'Delete', key: 'Del', danger: true, run: () => shapeDelete(m) },
    ];
  }],
  ['[data-mfx], [data-mapfx]', (el) => {
    const p = P(), m = S.view === 'map' && p.maps[S.sel.map], id = +(el.dataset.mfx ?? el.dataset.mapfx), f = fixture(id);
    if (!m || !f) return null;
    if (!S.mapSel.has(id)) { S.mapSel = new Set([id]); render(); }
    const ids = [...S.mapSel], placed = m.items.filter((it) => S.mapSel.has(it.fixture)).length, n = ids.length;
    return [
      { label: 'Open in Fixtures →', run: () => { S.view = 'fixtures'; S.fxSel = new Set(ids); S.fxGroup = null; S.revealFx = true; render(); } },
      { label: n > 1 ? `Locate ${n} fixtures` : 'Locate (flash white)', key: 'L', run: () => locateFixtures(ids) },
      n === 1 && { label: 'Copy name', run: () => copyText(f.name) },
      placed && { label: 'Copy positions', key: 'Ctrl+C', run: () => mapCopy(m) },
      S.mapClip?.items.length && { label: `Paste ${S.mapClip.items.length} position(s)`, key: 'Ctrl+V', run: () => mapPaste(m) },
      null,
      { label: n > 1 ? `Remove ${placed} from this map` : 'Remove from this map', key: 'Del', off: !placed, run: () => pageKey('Delete') },
      { label: n > 1 ? `Delete ${n} fixtures…` : 'Delete fixture…', danger: true, run: () => deleteFixtures(ids) },
    ];
  }],
  ['[data-fxi]', (el) => {
    const p = P(), f = p.fixtures[+el.dataset.fxi];
    if (!f || S.view !== 'fixtures') return null;
    if (!S.fxSel.has(f.id)) { S.fxSel = new Set([f.id]); render(); }
    const n = S.fxSel.size, mi = p.maps.findIndex((m) => m.items.some((it) => S.fxSel.has(it.fixture)));
    return [
      { label: n > 1 ? `Locate ${n} fixtures` : 'Locate (flash white)', key: 'L', run: () => locateFixtures([...S.fxSel]) },
      mi >= 0 && { label: 'Show on map →', run: () => { S.mapSel = new Set(S.fxSel); S.view = 'map'; S.sel.map = mi; render(); } },
      null,
      { label: 'Duplicate', key: 'Ctrl+D', run: () => pageKey('d', true) },
      { label: 'Copy', key: 'Ctrl+C', run: () => pageKey('c', true) },
      { label: 'Paste', key: 'Ctrl+V', off: !S.fxClip?.length, run: () => pageKey('v', true) },
      n === 1 && { label: 'Copy name', run: () => copyText(f.name) },
      null,
      { label: n > 1 ? `Delete ${n} fixtures` : 'Delete', key: 'Del', danger: true, run: () => pageKey('Delete') },
    ];
  }],
  ['[data-sel^="theme:"]', (el) => themeMenu(el)],   // app-colors.js
  ['[data-sel^="scene:"], [data-sel^="timeline:"], [data-sel^="effect:"], [data-sel^="map:"], [data-sel^="page:"]', (el) => {
    const [k, si] = el.dataset.sel.split(':'), i = +si, path = `${listPath[k]}.${i}`, x = getPath(P(), path);
    if (!x) return null;
    if (S.sel[k] !== i) { if (k === 'timeline') { S.sel.cue = -1; S.trackEdit = null; } S.sel[k] = i; render(); }
    const dup = () => { S.sel[k] = duplicateItem(path); if (k === 'timeline') S.sel.cue = -1; render(); };
    return [
      k === 'scene' && { label: '▶ Play', run: () => ctxCmd(`scene ${x.id}`) },
      k === 'scene' && { label: 'Release', run: () => ctxCmd(`release scene ${x.id}`) },
      k === 'timeline' && { label: '▶ Start', run: () => ctxCmd(`start timeline ${x.id}`) },
      k === 'timeline' && { label: 'Stop', run: () => ctxCmd(`stop timeline ${x.id}`) },
      null,
      k !== 'page' && { label: 'Duplicate', run: dup },
      x.name && { label: 'Copy name', run: () => copyText(x.name) },
      USE_KINDS[listPath[k]] && { label: 'Where used…', run: () => showWhereUsed(listPath[k], x) },
      null,
      { label: 'Delete', danger: true, run: () => deleteItem(path) },
    ];
  }],
];
// Any other row, card or list item with a ✕ (data-del) button - devices, variables, calendar
// periods, panel controls...: its own buttons (test, on/off, open →) plus duplicate, copy name, delete.
const CTX_ROW = 'tr, .card, .item';
function ctxRowMenu(target) {
  for (let row = target.closest(CTX_ROW); row; row = row.parentElement?.closest(CTX_ROW)) {
    const mine = (sel) => [...row.querySelectorAll(sel)].filter((b) => b.closest(CTX_ROW) === row);
    const del = mine('[data-del]')[0];
    if (!del) continue;
    const path = del.dataset.del, x = getPath(P(), path);
    const btns = mine('[data-cmd], [data-test], [data-fire], [data-goto-trigger], [data-goto-timeline], [data-goto-effect], [data-goto-devices]').slice(0, 10);
    const top = path.split('.').length === 2 && x && typeof x === 'object' && !Array.isArray(x);
    // A button that is only a symbol (−, +, ▶) says what it does in its tooltip or command.
    const label = (b) => { const s = b.textContent.trim(); return (/\w/.test(s) ? s : b.title || b.dataset.cmd || s || '?').slice(0, 40); };
    // Same label twice (one per slot of a Kiss-Box card...) can't be told apart: leave those out.
    const acts = btns.map((b) => ({ label: label(b), run: () => b.click() })).filter((a, _, all) => all.filter((o) => o.label === a.label).length === 1);
    return [
      ...acts,
      null,
      top && { label: 'Duplicate', run: () => { duplicateItem(path); render(); } },
      x?.name && { label: 'Copy name', run: () => copyText(x.name) },
      top && USE_KINDS[path.split('.')[0]] && { label: 'Where used…', run: () => showWhereUsed(path.split('.')[0], x) },
      null,
      { label: 'Delete', danger: true, run: () => deleteItem(path) },
    ];
  }
  return null;
}
function closeCtxMenu() { $('#ctxMenu')?.remove(); }
function openCtxMenu(e, items) {
  // Drop the empty entries, and lines at the start, the end or next to each other.
  const list = items.filter((x) => x !== false && x !== undefined && x !== 0 && x !== '').filter((x, i, a) => x || (i > 0 && a[i - 1] && a.slice(i + 1).some(Boolean)));
  if (!list.some(Boolean)) return false;
  closeCtxMenu();
  const m = document.createElement('div');
  m.id = 'ctxMenu';
  m.className = 'pmenu ctx-menu';
  m.setAttribute('role', 'menu');
  m.innerHTML = list.map((x, i) => (x ? `<button role="menuitem" data-ci="${i}" class="${x.danger ? 'danger' : ''}"${x.off ? ' disabled' : ''}><span>${esc(x.label)}</span>${x.key ? `<kbd>${esc(x.key)}</kbd>` : ''}</button>` : '<hr>')).join('');
  document.body.appendChild(m);
  // Screen pixels -> CSS pixels (UI size = zoom), kept inside the window.
  const z = uiZoom(), W = innerWidth / z, H = innerHeight / z;
  m.style.left = Math.max(4, Math.min(e.clientX / z, W - m.offsetWidth - 4)) + 'px';
  m.style.top = Math.max(4, Math.min(e.clientY / z, H - m.offsetHeight - 4)) + 'px';
  m.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-ci]');
    if (!b || b.disabled) return;
    closeCtxMenu();
    list[+b.dataset.ci].run();
  });
  m.addEventListener('keydown', (ev) => {
    if (!ev.ctrlKey && !ev.metaKey) ev.stopPropagation();   // not also the page's keys (arrows, Delete...)
    const bs = $$('button:not(:disabled)', m), at = bs.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); bs[(at + (ev.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length]?.focus(); }
  });
  m.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  return true;
}
document.addEventListener('contextmenu', (e) => {
  closeCtxMenu();
  if (e.shiftKey || !P() || e.target.closest('#ctxMenu')) return;
  const el = e.target;
  if (editingText(el) && !/^(range|checkbox|radio|button|color)$/.test(el.type || '')) return;   // the browser's cut/copy/paste
  for (const [sel, build] of CTX_MENUS) {
    const hit = el.closest(sel);
    if (!hit) continue;
    const items = build(hit, e);
    if (items && openCtxMenu(e, items)) e.preventDefault();
    return;
  }
  const items = ctxRowMenu(el);
  if (items && openCtxMenu(e, items)) e.preventDefault();
});
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#ctxMenu')) closeCtxMenu(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#ctxMenu')) { e.stopPropagation(); closeCtxMenu(); } }, true);
window.addEventListener('blur', closeCtxMenu);
document.addEventListener('scroll', closeCtxMenu, true);

$('#main').addEventListener('change', onBound);
$('#main').addEventListener('input', (e) => { if (e.target.type === 'range' && e.target.dataset.p) onBound(e); });
$('#gm').addEventListener('input', (e) => { $('#gmVal').textContent = e.target.value + '%'; });
$('#gm').addEventListener('change', (e) => cmd('grandmaster ' + e.target.value));
// Keyboard: Ctrl+S everywhere; Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo and redo project changes
// when not typing (in a text field they undo the typing); the rest goes to the page's keys().
// "?" (when not typing): the keyboard shortcuts of the page you are on, and the ones that
// work everywhere. Keep this list in step with the views.<page>.keys handlers.
const SHORTCUTS = {
  all: [['Ctrl+S', 'Save'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Right-click', 'Menu of the item under the mouse'], ['?', 'This list'], ['Esc', 'Close this list']],
  fixtures: [['↑ / ↓', 'Previous / next fixture'], ['Ctrl+A', 'Select all'], ['Ctrl+C / Ctrl+V', 'Copy / paste (at the next free addresses)'], ['Ctrl+D', 'Duplicate'], ['L', 'Locate: flash the selected fixtures white'], ['Del / Backspace', 'Delete']],
  map: [['Arrows', 'Nudge (Shift = bigger steps)'], ['[ / ]', 'Rotate the selection (Shift = 15°)'], ['+ / −', 'Scale the selection (Shift = more)'], ['Ctrl+A', 'Select all'], ['Ctrl+C / Ctrl+V', 'Copy / paste positions (also to another map)'], ['L', 'Locate: flash the selected fixtures white'], ['Del / Backspace', 'Remove from the map'], ['Floor plan: Ctrl+D', 'Duplicate the shape'], ['Floor plan: PgUp / PgDn', 'Shape to front / back (Shift = all the way)'], ['Floor plan: Esc', 'Back to selecting']],
  scenes: [['Ctrl+A', 'Select every fixture shown'], ['Esc', 'Clear the selection']],
  timelines: [['Space', 'Play / pause (Shift: carry on)'], ['← / →', 'Previous / next cue on the track'], ['↑ / ↓', 'Cue on another track'], ['Shift+← / →', 'Move 0.1 s (Ctrl: 1 s)'], ['0-9', 'Palette colour'], ['[ / ]', 'Hue'], ['+ / −', 'Intensity'], ['Enter', 'Colour wheel'], ['Ctrl+C / X / V', 'Copy / cut / paste at the cursor'], ['Ctrl+D', 'Duplicate after itself'], ['Ctrl+E', 'Split at the cursor'], ['Ctrl+A', 'Select all'], ['Del / Backspace', 'Delete'], ['Esc', 'Deselect']],
  triggers: [['↑ / ↓', 'Previous / next (Shift = extend the selection)'], ['Alt+↑ / ↓', 'Move the selection'], ['Ctrl+A', 'Select all shown'], ['Ctrl+C / X / V', 'Copy / cut / paste (also into another project)'], ['Ctrl+D', 'Duplicate'], ['Ctrl+F', 'Search'], ['Ctrl+H', 'Find & replace'], ['Del / Backspace', 'Delete']],
  panel: [['Ctrl+A', 'Select all controls'], ['Del / Backspace', 'Delete'], ['Esc', 'Clear the selection']],
  monitor: [['Esc', 'Close the device view']],
  dmx: [['Esc', 'Clear the selection']],
  modes: [['Esc', 'Close the icon picker']],
};
function toggleKeysHelp() {
  if ($('#keysHelp')) return $('#keysHelp').remove();
  const name = $(`#nav [data-view="${S.view}"]`)?.firstChild?.textContent.trim() || S.view;
  const table = (rows) => `<table>${rows.map(([k, w]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(w)}</td></tr>`).join('')}</table>`;
  const page = SHORTCUTS[S.view];
  const box = document.createElement('div');
  box.id = 'keysHelp';
  box.innerHTML = `<div class="keys-help card" role="dialog" aria-label="Keyboard shortcuts">
    <div class="row"><b style="flex:1">Keyboard shortcuts</b><button class="btn small ghost" id="keysHelpX">✕</button></div>
    ${page ? `<h3>${esc(name)}</h3>${table(page)}` : `<p class="muted">${esc(name)} has no shortcuts of its own.</p>`}
    <h3>Everywhere</h3>${table(SHORTCUTS.all)}
    <p class="muted">Keys don't work while you type in a field (except Ctrl+S).</p></div>`;
  document.body.appendChild(box);
  box.addEventListener('click', (e) => { if (e.target === box || e.target.id === 'keysHelpX') box.remove(); });
}
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 's') { e.preventDefault(); save(); return; }
  const help = e.key === '?' || (e.code === 'Slash' && e.shiftKey);   // "?" (the key code too: some layouts)
  if ($('#keysHelp')) { if (e.key === 'Escape' || help) { e.preventDefault(); $('#keysHelp').remove(); } return; }
  if (help && !mod && !editingText(document.activeElement) && !$('.builder')) { e.preventDefault(); toggleKeysHelp(); return; }
  const typing = editingText(document.activeElement) && !/^(range|checkbox|radio|button|color)$/.test(document.activeElement.type || '') && document.activeElement.tagName !== 'SELECT';
  if (mod && !typing && (k === 'z' || k === 'y')) { e.preventDefault(); undoStep(k === 'y' || e.shiftKey ? 1 : -1); return; }
  if (!editingText(document.activeElement)) views[S.view]?.keys?.(e);
});
$('#undoBtn').addEventListener('click', () => undoStep(-1));
$('#redoBtn').addEventListener('click', () => undoStep(1));
$('#winBtn').addEventListener('click', openWindow);
// Panel ↗: opens the touch panel; with several panels a small menu asks which one.
$('#panelBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  const list = P() ? P().panel.panels : [{ id: 1, name: 'Panel' }];
  $('#panelMenu')?.remove();
  if (list.length === 1) { window.open(panelUrl(list[0]), '_blank'); return; }
  const m = document.createElement('div');
  m.id = 'panelMenu';
  m.className = 'pmenu';
  m.innerHTML = list.map((x) => `<a href="${panelUrl(x)}" target="_blank">${esc(x.name || 'Panel ' + x.id)} ↗</a>`).join('');
  const r = e.currentTarget.getBoundingClientRect(), z = uiZoom();
  Object.assign(m.style, { top: r.bottom / z + 4 + 'px', left: r.left / z + 'px' });
  document.body.appendChild(m);
  const close = () => { m.remove(); document.removeEventListener('click', close); };
  setTimeout(() => document.addEventListener('click', close));
});
// Closing one of several windows loses nothing: the others still have the changes.
window.addEventListener('beforeunload', (e) => { if (S.dirty && !win.peers.size) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('resize', () => acs.forEach((a) => a.hide()));

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async () => {
  try {
    S.project = normalize(await apiProgress('/api/project', 'Loading the project'));
    // Older projects: put the trigger numbers in list order once (references follow).
    if (renumberTriggers(P(), false)) { S.dirty = true; setTimeout(() => toast('Triggers renumbered in list order - press Save to keep it'), 500); }
    const seqs = normalize.sequences;
    if (seqs) { S.dirty = true; setTimeout(() => toast(`${seqs} Sequence trigger${seqs > 1 ? 's' : ''} turned into separator notes (Sequence triggers no longer exist) - press Save to keep it`), 900); }
  }
  catch (e) { S.project = normalize(emptyProject()); toast('No project on the controller (' + e.message + ') - starting a new one', true); }
  undoReset(!S.dirty);
  S.netSaved = JSON.stringify(P().network);   // the controller's stored setting (save() offers a network test when it changes)
  const page = location.hash.slice(1);
  if (views[page]) S.view = page;
  // Datalist of common channel names for the patch editor.
  document.body.insertAdjacentHTML('beforeend', `<datalist id="chNames">${['dim', 'r', 'g', 'b', 'w', 'a', 'uv', 'lime', 'warm', 'cool', 'cct', 'pan', 'pan:16', 'tilt', 'tilt:16', 'speed_pt', 'shutter', 'strobe', 'zoom', 'focus', 'gobo', 'color_wheel', 'prism', 'cto', 'macro', 'fx', 'ctrl', 'pos:16', 'speed', 'enable', 'fog', 'haze', 'fan'].map((c) => `<option value="${c}">`).join('')}</datalist>`);
  updateHeader();
  addNavSplitter();
  render();
  winStart();
  try { const lines = await api('/api/log'); lines.forEach(addLog); } catch { /* SSE will catch up */ }
  connectEvents();
})();
