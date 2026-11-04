'use strict';
// KD Designer web UI - adding/moving/deleting items, global event handlers, start-up.
// Plain scripts sharing one global scope; load order is in index.html.

// ---------------------------------------------------------------------------
// Adding, moving and deleting items (data-add / data-move / data-del buttons)
// ---------------------------------------------------------------------------
function addItem(kind) {
  const p = P();
  if (kind.startsWith('ptrig-')) return addPanelTrigger(p.panel.pages[S.sel.page || 0].controls[+kind.slice(6)]);
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
    case 'devgroup': {
      let n = 1;
      while (p.deviceGroups.some((g) => g.name === 'group' + n)) n++;
      p.deviceGroups.push({ name: 'group' + n, devices: [] });
      break;
    }
    case 'map': p.maps.push({ id: nextId(p.maps), name: 'Map ' + nextId(p.maps), aspect: 1.6, background: '', snap: true, labels: true, items: [] }); S.sel.map = p.maps.length - 1; S.mapSel = new Set(); break;
    case 'modegroup': p.modes.push({ name: 'Group ' + (p.modes.length + 1), states: ['On', 'Off'] }); break;
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
      p.triggers.push({ id: nextId(p.triggers), name: '== SECTION', type: 'comment', actions: [] });
      renumberTriggers(p);
      selectTriggers([p.triggers.length - 1]);
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
    case 'cue': case 'trigcue': {
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
      if (S.tlCursor != null) S.tlCursor = at + len;   // so the next + Cue lands after this one
      return addCue(t, { t: at, track, len }, trackFxIds(t.tracks[track]).length ? 'preset' : 'scene');
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
      p.triggers.push(t);  // always at the end
      renumberTriggers(p);
      t.name = uniqueTrigName('Trigger ' + t.id);
      selectTriggers([p.triggers.length - 1]);
      break;
    }
    case 'action': p.triggers[S.sel.trigger].actions.push(''); break;
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
function deleteItem(path) {
  const keys = path.split('.');
  const i = +keys.pop();
  const list = getPath(P(), keys.join('.'));
  const it = list[i];
  if (keys.length === 1 && keys[0] === 'triggers') return deleteTriggers([i]);  // warns about references
  const fxUse = keys.join('.') === 'effects' ? P().timelines.reduce((n, tl) => n + tl.cues.filter((c) => c.effect === it.id).length, 0) : 0;
  if (it && typeof it === 'object' && it.name && !confirm(`Delete '${it.name}'?${fxUse ? `\n\n${fxUse} timeline cue(s) use this effect - the project won't load until they're changed.` : ''}`)) return;
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
  const t = e.target.closest('[data-view],[data-cmd],[data-add],[data-del],[data-sel],[data-test],[data-fire],[data-sort],[data-move],[data-pmove],[data-build],[data-goto-trigger],[data-goto-timeline],[data-goto-effect],[data-goto-devices],#save,#bo');
  if (!t) return;
  if (t.dataset.view) { S.view = t.dataset.view; render(); }
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
$('#main').addEventListener('change', onBound);
$('#main').addEventListener('input', (e) => { if (e.target.type === 'range' && e.target.dataset.p) onBound(e); });
$('#gm').addEventListener('input', (e) => { $('#gmVal').textContent = e.target.value + '%'; });
$('#gm').addEventListener('change', (e) => cmd('grandmaster ' + e.target.value));
// Keyboard: Ctrl+S everywhere; Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo and redo project changes
// when not typing (in a text field they undo the typing); the rest goes to the page's keys().
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 's') { e.preventDefault(); save(); return; }
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
    S.project = normalize(await api('/api/project'));
    // Older projects: put the trigger numbers in list order once (references follow).
    if (renumberTriggers()) { S.dirty = true; setTimeout(() => toast('Triggers renumbered in list order - press Save to keep it'), 500); }
  }
  catch (e) { S.project = emptyProject(); toast('No project on the controller (' + e.message + ') - starting a new one', true); }
  undoReset(!S.dirty);
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
