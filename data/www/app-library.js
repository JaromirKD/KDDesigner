'use strict';
// KD Designer web UI - fixture types: the library, "Add fixtures", the project's own types
// (p.fixtureTypes, in the text format of fixture-lib.js), fixture icons and the fixture form.
// Plain scripts sharing one global scope; load order is in index.html.

// The big library (fixture-library.json, built from the Open Fixture Library) is only
// fetched when a page needs it, so the UI starts as fast as before.
const LIB = { list: null, loading: null, failed: '', source: '' };
function loadLibrary(then) {
  if (LIB.list || LIB.failed) return;
  LIB.loading ??= api('fixture-library.json')
    .then((j) => { LIB.list = KDLib.parse(j.text, 'library').types; LIB.source = j.source; })
    .catch((e) => { LIB.failed = e.message; });
  if (then) LIB.loading.then(then);
}
let customCache = { src: null, types: [] };
function customTypes() {
  const list = P().fixtureTypes || [];
  if (customCache.list === list && customCache.len === list.length) return customCache.types;   // fast path: unchanged
  const src = list.join('\n\n');
  if (customCache.src !== src) customCache = { src, types: KDLib.parse(src, 'custom').types };
  customCache.list = list;
  customCache.len = list.length;
  return customCache.types;
}
// The project's own types come first, so a copied and edited type replaces the original.
const allTypes = () => [...customTypes(), ...KDLib.generic, ...(LIB.list || [])];
// key -> type, rebuilt when the project's own types or the library change (the first one wins).
let typeIndex = { custom: null, lib: null, map: null };
function findType(key) {
  if (!key) return null;
  const custom = customTypes();
  if (typeIndex.custom !== custom || typeIndex.lib !== LIB.list) {
    const map = new Map();
    for (const t of allTypes()) if (!map.has(t.key)) map.set(t.key, t);
    typeIndex = { custom, lib: LIB.list, map };
  }
  return typeIndex.map.get(key) || null;
}
const fixtureMode = (f) => findType(f.type)?.modes.find((m) => m.name === f.mode) || null;
const fixtureIcon = (f) => f.icon || findType(f.type)?.icon || KDLib.guessIcon(f.channels);
const fxIcon = (f) => KDLib.iconSvg(fixtureIcon(f));
// The value a channel starts with in a scene: its home value from the fixture type, else 0.
function homeValue(f, ch) {
  const m = fixtureMode(f);
  return m ? ([...m.head, ...m.cell].find((c) => c.name === ch)?.home ?? 0) : 0;
}

// ---- Adding fixtures from a type ----------------------------------------------------
S.addFx = { q: '', key: null, mode: '', count: 1, cells: 0, name: '', universe: 0, address: 0, place: true };
function uniqueFixtureName(base, made) {
  const taken = new Set([...P().fixtures, ...made].map((f) => f.name));
  if (!taken.has(base)) return base;
  let k = 2;
  while (taken.has(`${base} ${k}`)) k++;
  return `${base} ${k}`;
}
// The fixtures (and groups for cell modes) that "Add" would make.
function planFixtures(t, md, o) {
  const p = P(), made = [], groups = [];
  const cells = md.cells ? Math.max(1, o.cells || md.cells) : 0;
  let addr = o.address, id = nextId(p.fixtures);
  const base = { universe: o.universe, type: t.key, mode: md.name, ...(t.curve ? { curve: t.curve } : {}) };
  const add = (name, channels) => { const f = { id: id++, name, ...base, address: addr, channels }; made.push(f); addr += footprint(f); return f; };
  for (let k = 1; k <= o.count; k++) {
    const name = uniqueFixtureName(o.count > 1 ? `${o.name} ${k}` : o.name, made);
    if (!cells) { add(name, KDLib.channelNames(md.head)); continue; }
    if (md.head.length) add(`${name} master`, KDLib.channelNames(md.head));
    const ids = [];
    for (let c = 1; c <= cells; c++) ids.push(add(`${name} ${c}`, KDLib.channelNames(md.cell)).id);
    groups.push({ name, fixtures: ids });
  }
  return { made, groups, end: addr - 1 };
}
function addFixturesFromType(t, md) {
  const p = P(), a = S.addFx;
  const { made, groups, end } = planFixtures(t, md, a);
  if (!made.length) return;
  if (end > 512) return toast(`Doesn't fit: that would go up to channel ${end} of universe ${a.universe}`, true);
  p.fixtures.push(...made);
  for (const g of groups) p.groups.push({ id: nextId(p.groups), ...g });
  const m = a.place && p.maps[S.sel.map];
  if (m) {
    // A new row under the lowest fixture on the map.
    const y = Math.min(0.9, m.items.reduce((mx, it) => Math.max(mx, it.y), 0) + 0.08);
    made.forEach((f, i) => m.items.push({ fixture: f.id, x: (i + 1) / (made.length + 1), y: m.items.length ? y : 0.5 }));
  }
  S.fxSel = new Set(made.map((f) => f.id));
  S.fxGroup = null;
  S.fxPanel = '';
  S.revealFx = true;
  toast(`Added ${made.length} fixture(s)${groups.length ? ` and ${groups.length} group(s)` : ''}${m ? ` · placed on map '${m.name}'` : ''}`);
  markDirty();
  render();
}
// ---- Changing the type of fixtures that are already patched --------------------------
// The library panel opens in "change" mode: S.addFx.change = fixture ids, back = page to return to.
function openChangeType(ids) {
  const a = S.addFx, f = fixture(ids[0]);
  Object.assign(a, { change: ids, back: S.view, q: '', key: findType(f.type) ? f.type : null, mode: f.mode || '' });
  S.view = 'fixtures';
  S.fxPanel = 'add';
  render();
}
// What a change would do: scene levels lost and fixtures that would overlap.
function changePlan(ids, md) {
  const p = P(), set = new Set(ids), names = new Set(md.head.map((c) => c.name)), fp = KDLib.modeFootprint(md);
  const lost = p.scenes.reduce((n, sc) => n + sc.levels.filter((l) => set.has(l.fixture) && typeof l.ch === 'string' && !names.has(l.ch)).length, 0);
  const span = (f) => [f.address, f.address + (set.has(f.id) ? fp : footprint(f)) - 1];
  const clash = [], past = [];
  for (const f of p.fixtures.filter((x) => set.has(x.id))) {
    const [a0, a1] = span(f);
    if (a1 > 512) past.push(f);
    for (const g of p.fixtures) if (g !== f && g.universe === f.universe) { const [b0, b1] = span(g); if (a0 <= b1 && b0 <= a1) { clash.push(f); break; } }
  }
  return { lost, clash, past };
}
function changeFixtureTypes(ids, t, md) {
  const { lost, clash, past } = changePlan(ids, md);
  if (past.length) return toast(`Doesn't fit: ${past[0].name} would go past channel 512`, true);
  const warn = [lost && `${lost} scene level(s) on channels the new type doesn't have will be removed.`,
    clash.length && `${clash.length} fixture(s) will overlap the next fixture's addresses (fix with "Number them" or the address).`].filter(Boolean);
  if (warn.length && !confirm(`Change ${ids.length} fixture(s) to ${t.model} (${md.name})?\n\n${warn.join('\n')}`)) return;
  for (const id of ids) {
    const f = fixture(id);
    setFixtureChannels(f, KDLib.channelNames(md.head));
    f.type = t.key;
    f.mode = md.name;
    delete f.icon;   // the new type's icon
    if (t.curve) f.curve = t.curve;
  }
  const back = S.addFx.back;
  Object.assign(S.addFx, { change: null, back: null });
  S.fxPanel = '';
  if (back && back !== 'fixtures') S.view = back;
  else { S.fxSel = new Set(ids); S.fxGroup = null; }
  toast(`${ids.length} fixture(s) are now ${t.model}${lost ? ` · ${lost} scene level(s) removed` : ''}`);
  markDirty();
  render();
}
const modeLabel = (md) => `${md.name} · ${md.cells ? `${md.head.length ? md.head.length + ' + ' : ''}${md.cells} × ${md.cell.length}` : KDLib.modeFootprint(md)} ch`;
function addFixturesHtml() {
  const p = P(), a = S.addFx;
  const words = a.q.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (t) => words.every((w) => t.key.toLowerCase().includes(w));
  const row = (t) => `<div class="item${t.key === a.key ? ' sel' : ''}" data-addtype="${esc(t.key)}"><span class="fx-ic">${KDLib.iconSvg(t.icon || 'generic')}</span>
    <span style="flex:1">${esc(t.model)}</span><span class="muted">${esc(t.maker)}</span><span class="tag">${t.modes.length} mode${t.modes.length > 1 ? 's' : ''}</span></div>`;
  let list;
  if (!words.length) {
    list = (customTypes().length ? `<div class="item sep">Your fixture types</div>${customTypes().map(row).join('')}` : '') +
      `<div class="item sep">Generic</div>${KDLib.generic.map(row).join('')}`;
  } else {
    const hits = allTypes().filter(match);
    list = hits.slice(0, 150).map(row).join('') + (hits.length > 150 ? `<div class="item muted">${hits.length - 150} more - type more of the name</div>` : '') ||
      `<div class="item muted">Nothing found${LIB.list ? '' : ' (the library is still loading)'}</div>`;
  }
  const lib = LIB.list ? `${LIB.list.length} fixtures from ${new Set(LIB.list.map((t) => t.maker)).size} manufacturers in the library`
    : LIB.failed ? `<span class="bad">Library not loaded: ${esc(LIB.failed)}</span>` : 'Loading the library…';
  const t = findType(a.key);
  let form = '<p class="muted">Pick a fixture type.</p>';
  const change = a.change?.map(fixture).filter(Boolean);
  if (change?.length) {
    const who = change.length === 1 ? `'${esc(change[0].name)}'` : `${change.length} fixtures`;
    form = `<p>Change ${who} to another type. They keep their number, name, address, groups, map place and timeline tracks,
      and the scene levels on channels the new type also has (dim, r, g, b…).</p>`;
    const modes = t ? t.modes.filter((m) => !m.cells) : [];
    if (t && !modes.length) form += '<p class="bad">This type only has pixel (cell) modes - add it as new fixtures instead.</p>';
    else if (t) {
      const md = modes.find((m) => m.name === a.mode) || modes[0];
      a.mode = md.name;
      const plan = changePlan(a.change, md);
      form += `<div class="row"><span class="fx-ic big">${KDLib.iconSvg(t.icon || 'generic')}</span><div><b>${esc(t.model)}</b><br><span class="muted">${esc(t.maker)}</span></div></div>
        ${t.note ? `<p class="muted">${esc(t.note)}</p>` : ''}
        <div class="form" style="margin-top:10px">
          <label>Mode</label><select id="afMode">${modes.map((m) => `<option value="${esc(m.name)}"${m === md ? ' selected' : ''}>${esc(modeLabel(m))}</option>`).join('')}</select>
          <label>Channels</label><span class="mono small-text">${esc(KDLib.modeText(md))}</span>
          <label>Now</label><span class="mono small-text">${esc((change[0].channels || []).join(', '))}${change.length > 1 ? ' …' : ''}</span>
          <label>Result</label><span>${plan.past.length ? `<span class="bad">${esc(plan.past[0].name)} would go past channel 512</span>`
            : [plan.lost ? `<span class="bad">${plan.lost} scene level(s) will be removed</span>` : 'all scene levels stay',
              plan.clash.length ? `<span class="bad">${plan.clash.length} will overlap the next fixture</span>` : ''].filter(Boolean).join(' · ')}</span>
        </div>
        <div class="row" style="margin-top:10px"><button class="btn primary" id="afChange"${plan.past.length ? ' disabled' : ''}>Change ${change.length} fixture(s)</button></div>`;
    }
  } else if (t) {
    const md = t.modes.find((m) => m.name === a.mode) || t.modes[0];
    a.mode = md.name;
    const plan = planFixtures(t, md, a), bad = plan.end > 512;
    const clash = !bad && P().fixtures.some((f) => plan.made.some((n) => n.universe === f.universe && n.address < f.address + footprint(f) && f.address < n.address + footprint(n)));
    form = `<div class="row"><span class="fx-ic big">${KDLib.iconSvg(t.icon || 'generic')}</span><div><b>${esc(t.model)}</b><br><span class="muted">${esc(t.maker)}${t.source === 'library' ? ' · from the Open Fixture Library' : t.source === 'custom' ? ' · your own type' : ''}</span></div></div>
      ${t.note ? `<p class="muted">${esc(t.note)}</p>` : ''}
      <div class="form" style="margin-top:10px">
        <label>Mode</label><select id="afMode">${t.modes.map((m) => `<option value="${esc(m.name)}"${m === md ? ' selected' : ''}>${esc(modeLabel(m))}</option>`).join('')}</select>
        <label>Channels</label><span class="mono small-text">${esc(KDLib.modeText(md))}</span>
        ${md.cells ? `<label>Cells</label><div class="row nowrap"><input type="number" id="afCells" min="1" max="512" value="${a.cells || md.cells}" style="width:80px"><span class="muted">one fixture per cell, plus a group</span></div>` : ''}
        <label>How many</label><input type="number" id="afCount" min="1" max="512" value="${a.count}" style="width:80px">
        <label>Name</label><input id="afName" value="${esc(a.name)}">
        <label>Universe</label><select id="afU">${opts(p.universes, a.universe, (u) => `${u.id} · ${u.name}`)}</select>
        <label>Start address</label><div class="row nowrap"><input type="number" id="afAddr" min="1" max="512" value="${a.address}" style="width:80px">
          <span class="${bad ? 'bad' : 'muted'}">${plan.made.length} fixture(s), ${a.universe}.${a.address}–${plan.end}${bad ? ' - past 512!' : ''}</span>${clash ? '<span class="bad">overlaps fixtures already patched</span>' : ''}</div>
        ${p.maps.length ? `<label>Map</label><label class="chk"><input type="checkbox" id="afPlace"${a.place ? ' checked' : ''}> Place on map '${esc(p.maps[Math.min(S.sel.map, p.maps.length - 1)].name)}'</label>` : ''}
      </div>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="afGo"${bad ? ' disabled' : ''}>Add ${plan.made.length} fixture(s)</button>
        ${t.source !== 'custom' ? '<button class="btn small ghost" id="afCopy" title="Copy this type to your own fixture types to change it">Copy to my types to edit</button>' : '<button class="btn small ghost" id="afEdit">Edit this type</button>'}</div>`;
  }
  return `<div class="row"><h3 style="margin:0;flex:1">${change?.length ? 'Change fixture type' : 'Add fixtures'}</h3><button class="btn small ghost" id="fxPanelClose">✕</button></div>
    <div class="addfx">
      <div><input id="afQ" placeholder="Search, e.g. 'rgbw', 'chauvet slimpar', 'mac aura'…" value="${esc(a.q)}" style="width:100%;margin-bottom:6px">
        <div class="list addfx-list">${list}</div>
        <p class="muted keys">${lib}. Not there? Import a file under <a href="#" id="afTypes">Fixture types</a>.</p></div>
      <div>${form}</div>
    </div>`;
}
function wireAddFixtures() {
  const p = P(), a = S.addFx;
  loadLibrary(() => S.view === 'fixtures' && S.fxPanel === 'add' && render());
  const pick = (key) => {
    const t = findType(key);
    Object.assign(a, { key, mode: t.modes[0].name, cells: 0, name: t.model, count: 1 });
    if (!p.universes.some((u) => u.id === a.universe)) a.universe = p.universes[0]?.id || 1;
    a.address = nextAddress(a.universe);
    render();
  };
  $$('[data-addtype]').forEach((el) => el.addEventListener('click', () => pick(el.dataset.addtype)));
  $('#afQ').addEventListener('input', (e) => {
    a.q = e.target.value;
    const pos = e.target.selectionStart;
    render();
    $('#afQ').focus();
    $('#afQ').setSelectionRange(pos, pos);
  });
  $('#afQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = $('[data-addtype]'); if (first) pick(first.dataset.addtype); } });
  if (!a.key) $('#afQ').focus();
  $('#fxPanelClose').addEventListener('click', () => {
    if (a.change && a.back && a.back !== 'fixtures') S.view = a.back;   // back to where "Change type…" was clicked
    Object.assign(a, { change: null, back: null });
    S.fxPanel = '';
    render();
  });
  $('#afTypes').addEventListener('click', (e) => { e.preventDefault(); a.change = null; S.fxPanel = 'types'; render(); });
  const t = findType(a.key);
  if (!t) return;
  $('#afMode')?.addEventListener('change', (e) => { a.mode = e.target.value; a.cells = 0; render(); });
  if (a.change) {
    $('#afChange')?.addEventListener('click', () => changeFixtureTypes(a.change, t, t.modes.find((m) => m.name === a.mode)));
    return;
  }
  const num = (id, key, min = 1) => $(id)?.addEventListener('change', (e) => { a[key] = Math.max(min, Math.min(512, +e.target.value || min)); render(); });
  num('#afCells', 'cells');
  num('#afCount', 'count');
  num('#afAddr', 'address');
  $('#afName').addEventListener('change', (e) => { a.name = e.target.value.trim() || t.model; });
  $('#afU').addEventListener('change', (e) => { a.universe = +e.target.value; a.address = nextAddress(a.universe); render(); });
  $('#afPlace')?.addEventListener('change', (e) => (a.place = e.target.checked));
  $('#afGo').addEventListener('click', () => {
    a.name = $('#afName').value.trim() || t.model;
    addFixturesFromType(t, t.modes.find((m) => m.name === a.mode) || t.modes[0]);
  });
  $('#afCopy')?.addEventListener('click', () => {
    p.fixtureTypes = [...(p.fixtureTypes || []), t.text];
    S.ftDraft = null;
    S.fxPanel = 'types';
    toast(`Copied '${t.model}' to your fixture types - changes there replace the original`);
    markDirty();
    render();
  });
  $('#afEdit')?.addEventListener('click', () => { S.fxPanel = 'types'; render(); });
}

// ---- The project's own fixture types: one text, like a script ---------------------------
S.ftDraft = null;   // text being edited (null = what the project has)
const FT_HELP = `fixture Maker / Model name
icon par            # ${Object.keys(KDLib.ICONS).join(', ')}
curve linear        # optional: square, nondim, preheat5, preheat10
note Any remark     # optional
mode 4 ch: dim, r, g, b
mode 6 ch: dim, r, g, b, strobe, shutter=255
mode 8 cells: 8 x (r, g, b)`;
function fixtureTypesHtml() {
  const p = P(), text = S.ftDraft ?? (p.fixtureTypes || []).join('\n\n');
  return `<div class="row"><h3 style="margin:0;flex:1">Your fixture types</h3><button class="btn small ghost" id="fxPanelClose">✕</button></div>
    <p class="muted">Your own fixture definitions, saved with the project. One <code>fixture</code> line per type, then its <code>mode</code> lines:
      channels in DMX order. Use <code>dim</code>, <code>r g b w</code> for intensity and colour (presets and effects use them), <code>:16</code> for 16-bit,
      <code>=value</code> for the value a scene starts with. A type with the same maker / model as a library type replaces it.</p>
    <textarea id="ftText" class="mono ft-text" rows="20" spellcheck="false" placeholder="${esc(FT_HELP)}">${esc(text)}</textarea>
    <div id="ftStatus" class="muted"></div>
    <div class="row" style="margin-top:8px"><button class="btn primary" id="ftApply">Apply</button>
      <button class="btn small ghost" id="ftRevert"${S.ftDraft == null ? ' disabled' : ''}>Undo changes</button>
      <label class="btn small" title="A fixture file from open-fixture-library.org (download as 'Open Fixture Library JSON') or from QLC+ (.qxf)">Import file…<input type="file" id="ftImport" accept=".json,.qxf,.xml" multiple hidden></label>
      <button class="btn small ghost" id="ftAdd">Add fixtures →</button></div>
    <details class="ft-help"><summary>Example and channel names</summary><pre class="mono">${esc(FT_HELP)}</pre>
      <p class="muted">Channels that start with pan, tilt, speed, shutter, strobe, gobo, prism, zoom, focus, iris, frost, color_wheel, cto, cct, macro, fx, ctrl, mode or pos
        are left alone by the grand master and blackout; everything else (dim, r, g, b, w, a, uv, lime, warm, cool…) follows them.
        Moving heads: give the shutter its "open" value (<code>shutter=255</code> or what the manual says) so scenes don't start dark.</p></details>`;
}
function wireFixtureTypes() {
  const p = P(), ta = $('#ftText');
  const check = () => {
    const r = KDLib.parse(ta.value);
    const dup = r.types.map((t) => t.key).filter((k, i, a) => a.indexOf(k) !== i);
    $('#ftStatus').innerHTML = r.errors.length
      ? r.errors.slice(0, 8).map((e) => `<div class="bad">Line ${e.line}: ${esc(e.msg)}</div>`).join('')
      : `${r.types.length} type(s) OK${dup.length ? ` · <span class="bad">'${esc(dup[0])}' twice (the first one is used)</span>` : ''}${S.ftDraft != null ? ' · not applied yet' : ''}`;
    return r;
  };
  ta.addEventListener('input', () => { S.ftDraft = ta.value; check(); $('#ftRevert').disabled = false; });
  ta.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('#ftApply').click(); } });
  check();
  $('#fxPanelClose').addEventListener('click', () => { S.fxPanel = ''; render(); });
  $('#ftAdd').addEventListener('click', () => { S.fxPanel = 'add'; render(); });
  $('#ftRevert').addEventListener('click', () => { S.ftDraft = null; render(); });
  $('#ftApply').addEventListener('click', () => applyFixtureTypes(check()));
  $('#ftImport').addEventListener('change', async (e) => {
    const texts = [];
    for (const file of e.target.files) {
      try {
        const src = await file.text();
        const t = /\.(qxf|xml)$/i.test(file.name) ? KDLib.fromQXF(src) : importOfl(JSON.parse(src), file.name);
        if (!t.modes.length) throw new Error('no usable modes');
        texts.push(KDLib.toText(t));
      } catch (err) { toast(`${file.name}: ${err.message}`, true); }
    }
    if (!texts.length) return;
    S.ftDraft = [ta.value.trim(), ...texts].filter(Boolean).join('\n\n');
    render();
    toast(`Imported ${texts.length} type(s) - check the channels against the manual, then Apply`);
  });
}
// An OFL file as downloaded from the website names its manufacturer in a few ways.
function importOfl(j, fileName) {
  if (!j.availableChannels && !j.templateChannels) throw new Error('not an Open Fixture Library fixture');
  const key = j.manufacturerKey || fileName.replace(/\.json$/i, '').split(/[-_ ]/)[0];
  const maker = j.manufacturer?.name || (typeof j.manufacturer === 'string' ? j.manufacturer : '') ||
    (key ? key.replace(/(^|-)(\w)/g, (_, s, c) => (s ? ' ' : '') + c.toUpperCase()) : 'Imported');
  return KDLib.fromOFL(j, maker);
}
function applyFixtureTypes(r) {
  const p = P();
  if (r.errors.length) return toast(`Fix line ${r.errors[0].line} first: ${r.errors[0].msg}`, true);
  const before = new Map(customTypes().map((t) => [t.key, t]));
  p.fixtureTypes = r.types.map((t) => t.text);
  S.ftDraft = null;
  // Fixtures of a changed type: offer to give them the new channels (cell fixtures and
  // fixtures whose mode is gone stay as they are).
  const changed = [];
  for (const f of p.fixtures) {
    const md = fixtureMode(f);
    if (!md || md.cells || !before.has(f.type)) continue;
    const ch = KDLib.channelNames(md.head);
    if (ch.join() !== (f.channels || []).join()) changed.push([f, ch]);
  }
  if (changed.length && confirm(`${changed.length} fixture(s) use a type you changed. Give them the new channels?`)) {
    for (const [f, ch] of changed) setFixtureChannels(f, ch);
  }
  toast(`${r.types.length} fixture type(s) applied`);
  markDirty();
  render();
}
// New channels for a fixture: scene levels on channels it no longer has are removed
// (the controller refuses a project with a scene level on a missing channel).
function setFixtureChannels(f, channels) {
  const names = new Set(channels.map((c) => c.replace(/:16$/, '')));
  let gone = 0;
  for (const sc of P().scenes) {
    const n = sc.levels.length;
    sc.levels = sc.levels.filter((l) => l.fixture !== f.id || typeof l.ch === 'number' || names.has(l.ch));
    gone += n - sc.levels.length;
  }
  f.channels = channels;
  return gone;
}

// ---- The fixture form (Fixtures page and Scenes page) -----------------------------------
function fixtureFieldsHtml(x) {
  const p = P(), i = p.fixtures.indexOf(x), bad = conflicts(), t = findType(x.type), md = fixtureMode(x);
  return `<label>Type</label><div class="row nowrap"><span class="fx-ic">${fxIcon(x)}</span><span>${t ? `${esc(t.model)} <span class="muted">· ${esc(t.maker)}</span>` : x.type ? `<span class="muted">${esc(x.type)} (type not found${LIB.list ? '' : ' yet'})</span>` : '<span class="muted">own channels</span>'}</span>
      <button class="btn small" data-chtype="${x.id}" title="Make this another fixture type; it keeps its number, address, groups, map place and the scene levels that still fit">Change type…</button></div>
    ${t ? `<label>Mode</label>${md?.cells ? `<span class="muted">${esc(md.name)} (one cell of it)</span>` : `<select data-fxmode="${x.id}">${md ? '' : '<option value="">— channels edited by hand —</option>'}${t.modes.filter((m) => !m.cells).map((m) => `<option value="${esc(m.name)}"${m === md ? ' selected' : ''}>${esc(modeLabel(m))}</option>`).join('')}</select>`}` : ''}
    <label>Icon</label><select data-p="fixtures.${i}.icon" data-r><option value="">Automatic (${esc(KDLib.ICONS[t?.icon || KDLib.guessIcon(x.channels)]?.[0] || 'generic')})</option>${Object.entries(KDLib.ICONS).map(([k, [n]]) => `<option value="${k}"${x.icon === k ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
    <label>Universe</label><select data-p="fixtures.${i}.universe" data-t="num" data-r>${opts(p.universes, x.universe, (u) => `${u.id} · ${u.name}`)}</select>
    <label>Address</label><div class="row nowrap"><input type="number" min="1" max="512" data-p="fixtures.${i}.address" data-t="num" value="${x.address}" data-r style="width:90px">
      <span class="muted">uses ${x.universe}.${x.address}–${x.address + footprint(x) - 1}</span>${bad.has(x.id) ? '<span class="bad">overlaps another fixture</span>' : ''}</div>
    <label>Channels</label><input data-fxch="${x.id}" value="${esc((x.channels || []).join(', '))}" list="chNames">
    <label></label><span class="muted">In order, comma separated. <code>dim</code>, <code>r g b w</code> are used by presets and effects; add <code>:16</code> for a 16-bit pair (<code>pos:16</code>).</span>
    <label>Curve</label><select data-p="fixtures.${i}.curve">${CURVES.map(([v, n]) => `<option value="${v}"${(x.curve || 'linear') === v ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
}
function wireFixtureFields() {
  const after = (f, gone) => { if (gone) toast(`Removed ${gone} scene level(s) on channels the fixture no longer has`); markDirty(); render(); };
  $$('[data-chtype]').forEach((b) => b.addEventListener('click', () => openChangeType([+b.dataset.chtype])));
  $$('[data-fxmode]').forEach((el) => el.addEventListener('change', () => {
    const f = fixture(+el.dataset.fxmode), md = findType(f.type)?.modes.find((m) => m.name === el.value);
    if (!md) return;
    f.mode = md.name;
    after(f, setFixtureChannels(f, KDLib.channelNames(md.head)));
  }));
  // Typing channels by hand: the fixture no longer follows its type's mode.
  $$('[data-fxch]').forEach((el) => el.addEventListener('change', () => {
    const f = fixture(+el.dataset.fxch), ch = el.value.split(',').map((s) => s.trim()).filter(Boolean);
    if (fixtureMode(f) && ch.join() !== KDLib.channelNames(fixtureMode(f).head).join()) f.mode = '';
    after(f, setFixtureChannels(f, ch));
  }));
}
