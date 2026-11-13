'use strict';
// KD Designer web UI - Effects, Scenes and Timelines.
// Plain scripts sharing one global scope; load order is in index.html.

// ---- Effects: scripts in a small shader-like language (fx.js), run per fixture ----
// p.effects = [{id, name, code}]. Timeline cues run them on a track's fixtures.
const fxCompiled = new Map();
function fxProg(e) {
  let c = fxCompiled.get(e);
  if (!c || c.code !== e.code) { c = { code: e.code, prog: KDFX.compile(e.code || '') }; fxCompiled.set(e, c); }
  return c.prog;
}
// Base effects as <option>s, in their groups (KDFX.GROUPS).
const fxTplOptions = () => Object.entries(KDFX.GROUPS).map(([g, label]) => `<optgroup label="${esc(label)}">${KDFX.TEMPLATES
  .map((t, k) => (t.group === g ? `<option value="${k}">${esc(t.name)}</option>` : '')).join('')}</optgroup>`).join('');
// A name no other effect has (other than `self`): "Chase", "Chase 2", ...
function fxUniqueName(base, self) {
  const taken = (nm) => P().effects.some((x) => x !== self && x.name === nm);
  let name = base, k = 2;
  while (taken(name)) name = `${base} ${k++}`;
  return name;
}
// Under a parameter's slider: its note (the comment after the param line), range and default.
function fxParamNote(q) {
  const range = q.type === 'color' ? `default ${q.def}` : `${q.min} … ${q.max}, default ${q.def}`;
  return `<div class="fx-note">${q.note ? `${esc(q.note)} · ` : ''}<span class="muted">${range}</span></div>`;
}
// Fixtures for a preview: those on a map (with positions), a strip of n RGB cells, or an n x n grid.
// x / y = what the effect gets; on a map, sx / sy = where the dot is drawn (they differ with
// the effect's "round on wide maps", KDModel.effectXY).
function fxPreviewFixtures(src, round) {
  if (Array.isArray(src)) return src;
  const p = P(), m = src?.startsWith('map:') ? p.maps[+src.slice(4)] : null;
  if (m) return m.items.map((it) => ({ f: fixture(it.fixture), sx: it.x, sy: it.y, ...KDModel.effectXY(m, it.x, it.y, round) })).filter((o) => o.f);
  if (src?.startsWith('grid:')) {
    const g = +src.slice(5) || 10;
    return Array.from({ length: g * g }, (_, k) => ({ f: { channels: ['r', 'g', 'b'] }, x: (k % g) / (g - 1), y: Math.floor(k / g) / (g - 1) }));
  }
  const n = +(src || '').replace('strip:', '') || 16;
  return Array.from({ length: n }, (_, k) => ({ f: { channels: ['r', 'g', 'b'] }, x: n > 1 ? k / (n - 1) : 0.5, y: 0.5 }));
}
// Which outputs a fixture has, for KDFX.toFixture: { dim, r, g, b, w } true/false.
function fxOutputs(f) {
  const ro = channelRoles(f);
  return { dim: !!ro.dim, r: !!ro.r, g: !!ro.g, b: !!ro.b, w: !!ro.w };
}
// Colour of one fixture in a preview frame (what toFixture would send, as CSS).
function fxPreviewColor(prog, base, outs, i, n, x, y, t, level = 1) {
  const s = Float64Array.from(base);
  s[0] = t; s[1] = i; s[2] = n; s[3] = i / n; s[4] = x; s[5] = y;
  KDFX.run(prog, s);
  const o = KDFX.toFixture(s, outs, level);
  if (o.r == null) { const d = o.dim ?? 0; return { css: `rgba(255,214,150,${(0.1 + d * 0.9).toFixed(2)})`, level: d }; }
  const d = o.dim ?? 1, w = o.w || 0;
  const c = [o.r + w, o.g + w, o.b + w].map((q) => Math.round(Math.min(1, q) * d * 255));
  return { css: `rgb(${c.join(',')})`, level: Math.max(...c) / 255 };
}
// Only the dots' places (sx / sy) are used here, so the effect's "round" doesn't matter.
function fxPreviewHtml(src) {
  const p = P(), fx = fxPreviewFixtures(src), m =src?.startsWith('map:') ? p.maps[+src.slice(4)] : null;
  if (m) return `<div class="map-wrap"><div class="fx-prev map-canvas${fx.length > 40 ? ' dense' : ''}" style="${mapSizeStyle('kd.mapH.effects', m.aspect, 'calc(50 * var(--vh))')}">${m.background ? `<img src="/media/${encodeURIComponent(m.background)}" alt="">` : ''}${fxOverlayOn() ? '<canvas class="fx-ovl"></canvas>' : ''}
    ${mapShapesHtml(m)}${fx.map((o, k) => `<div class="mfx" style="left:${o.sx * 100}%;top:${o.sy * 100}%" title="${esc(o.f.name)}"><span class="dot" data-pv="${k}"></span></div>`).join('')}${mapResizeHtml('kd.mapH.effects')}</div></div>`;
  if (src?.startsWith('grid:')) return `<div class="fx-prev grid" style="grid-template-columns:repeat(${Math.round(Math.sqrt(fx.length))},1fr)">${fx.map((_, k) => `<span data-pv="${k}"></span>`).join('')}</div>`;
  return `<div class="fx-prev strip">${fx.map((_, k) => `<span data-pv="${k}"></span>`).join('')}</div>`;
}
// Effect overlay on the map preview: on/off is a per-browser preference.
function fxOverlayOn() {
  try { return localStorage.getItem('kd.fxOverlay') === '1'; } catch { return false; }
}
function setFxOverlay(on) {
  try { on ? localStorage.setItem('kd.fxOverlay', '1') : localStorage.removeItem('kd.fxOverlay'); } catch { /* private mode */ }
}
// The overlay runs the effect at every spot of a coarse grid over the map (x, y of that spot),
// as an RGB fixture at full level, so the pattern shows between and under the fixtures too.
// i / n / u are those of the nearest fixture, so list-order effects show each fixture's area.
function fxOverlayPainter(cv, prog, base, fx, m, round) {
  const W = 64, H = Math.max(8, Math.min(96, Math.round((W * cv.clientHeight) / Math.max(1, cv.clientWidth))));
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d'), img = g.createImageData(W, H), s = new Float64Array(base.length), n = Math.max(1, fx.length);
  const rgb = { r: true, g: true, b: true }, near = new Int32Array(W * H);
  // Each spot's effect x / y (the effect's "round on wide maps" applies here too).
  const ex = new Float64Array(W * H), ey = new Float64Array(W * H);
  for (let k = 0; k < W * H; k++) {   // nearest fixture, once (not every frame)
    const q = KDModel.effectXY(m, ((k % W) + 0.5) / W, (Math.floor(k / W) + 0.5) / H, round), x = (ex[k] = q.x), y = (ey[k] = q.y);
    let best = 0, bd = Infinity;
    fx.forEach((o, j) => { const d = (o.x - x) ** 2 + (o.y - y) ** 2; if (d < bd) { bd = d; best = j; } });
    near[k] = best;
  }
  return (t) => {
    for (let k = 0; k < W * H; k++) {
      s.set(base);
      s[0] = t; s[1] = near[k]; s[2] = n; s[3] = near[k] / n; s[4] = ex[k]; s[5] = ey[k];
      KDFX.run(prog, s);
      const o = KDFX.toFixture(s, rgb);
      img.data[k * 4] = o.r * 255; img.data[k * 4 + 1] = o.g * 255; img.data[k * 4 + 2] = o.b * 255; img.data[k * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  };
}
// Animate a preview container; values: param overrides; level 0..1.
// ovlMap: the map under an overlay when src is a fixture list (the timeline cue preview).
function runFxPreview(box, prog, src, values = {}, level = 1, round = false, ovlMap = null) {
  if (!box || !prog || prog.error) return;
  const fx = fxPreviewFixtures(src, round), base = KDFX.slotsFor(prog, values), t0 = performance.now();
  // Cells by their data-pv number (= the fixture's i): a preview may leave fixtures out.
  const cells = [];
  box.querySelectorAll('[data-pv]').forEach((el) => (cells[+el.dataset.pv] = el));
  const outs = fx.map((o) => fxOutputs(o.f));   // once, not every frame
  const glow = fx.length <= 40;   // the glow is costly to draw for hundreds of dots every frame
  const ovl = box.querySelector('canvas.fx-ovl'), paintOvl = ovl && fxOverlayPainter(ovl, prog, base, fx, typeof src === 'string' && src.startsWith('map:') ? P().maps[+src.slice(4)] : ovlMap, round);
  pageAnimation('fxPreview', () => {
    const t = (performance.now() - t0) / 1000;
    if (paintOvl) paintOvl(t);
    fx.forEach((o, k) => {
      if (!cells[k]) return;
      const c = fxPreviewColor(prog, base, outs[k], k, fx.length, o.x, o.y, t, level);
      cells[k].style.background = c.css;
      if (glow) cells[k].style.boxShadow = c.level > 0.05 ? `0 0 ${3 + c.level * 10}px ${c.css}` : 'none';
    });
  });
}
views.effects = () => {
  const p = P();
  S.sel.effect = Math.min(S.sel.effect || 0, Math.max(0, p.effects.length - 1));
  const e = p.effects[S.sel.effect];
  const newMenu = `<select id="fxNew"><option value="">+ New effect…</option><option value="empty">Empty</option>
    ${fxTplOptions()}</select>`;
  const list = `<div class="list">${p.effects.map((x, i) => {
    const pr = fxProg(x);
    return `<div class="item${i === S.sel.effect ? ' sel' : ''}" data-sel="effect:${i}"><span class="id">${x.id}</span><span style="flex:1">${esc(x.name)}</span>${pr.error ? '<span class="tag mon-warn">error</span>' : `<span class="tag">${pr.params.length} param${pr.params.length === 1 ? '' : 's'}</span>`}</div>`;
  }).join('') || '<span class="muted">No effects yet. Start from a base effect.</span>'}</div>`;
  if (!e) return `<h2>Effects</h2><div class="split"><div>${list}<div class="row" style="margin-top:8px">${newMenu}</div></div>
    <div><p class="muted">Effects are little scripts, a bit like shaders: they run for every fixture, every frame, and say what colour it should be.
      Start from a base effect, change it, then use it on a timeline track.</p></div></div>`;
  const prog = fxProg(e), src = S.fxSrc || (p.maps.length ? 'map:0' : 'strip:16');
  const used = p.timelines.flatMap((tl) => tl.cues.filter((c) => c.effect === e.id).map((c) => `${tl.name} @ ${(c.t / 1000).toFixed(1)} s`));
  return `<h2>Effects</h2><div class="split">
    <div>${list}
      <div class="row" style="margin-top:8px">${newMenu}<button class="btn small" id="fxDup">Duplicate</button></div></div>
    <div>
      <div class="row"><input data-p="effects.${S.sel.effect}.name" value="${esc(e.name)}" style="font-size:16px;flex:1" data-r>
        <select id="fxBase" title="Swap this effect's code for a base effect. Timeline cues that use it keep using it; Ctrl+Z undoes."><option value="">Change to base effect…</option>${fxTplOptions()}</select>
        <button class="btn small ghost" data-del="effects.${S.sel.effect}">Delete</button></div>
      <div class="used-row">${usedHtml('effects', e)}</div>
      <div class="fx-ed">
        <div class="fx-code"><pre class="fx-gutter" id="fxGutter"></pre><textarea id="fxCode" spellcheck="false" wrap="off">${esc(e.code || '')}</textarea></div>
        <div class="fx-err" id="fxErr"></div>
      </div>
      <div class="row" style="margin-top:8px"><b>Preview</b>
        <select id="fxSrc"><option value="strip:16"${src === 'strip:16' ? ' selected' : ''}>Strip of 16</option><option value="strip:8"${src === 'strip:8' ? ' selected' : ''}>Strip of 8</option><option value="grid:10"${src === 'grid:10' ? ' selected' : ''}>Grid 10 × 10 (for XY)</option>
          ${p.maps.map((m, i) => `<option value="map:${i}"${src === `map:${i}` ? ' selected' : ''}>Map: ${esc(m.name)}</option>`).join('')}</select>
        <label class="muted" title="Saved with the effect, used wherever it plays. On: x and y have the same scale both ways, so a circle or ripple is round on a wide map, not stretched (the long side of the map runs 0…1). Off: x and y each run 0…1 across the map."><input type="checkbox" data-p="effects.${S.sel.effect}.round" data-t="bool"${e.round ? ' checked' : ''} data-r> Round on wide maps</label>
        ${src.startsWith('map:') ? `<label class="muted" title="Runs the effect over the whole map, not only where the fixtures are, so you can see the pattern between them"><input type="checkbox" id="fxOvl"${fxOverlayOn() ? ' checked' : ''}> show effect on the whole map</label>` : ''}
        ${src.startsWith('map:') && p.maps[+src.slice(4)] ? mapZoomHtml(`fx:${p.maps[+src.slice(4)].id}`) : ''}
        <span class="muted">${used.length ? `Used in: ${used.map(esc).join(', ')}` : 'Not used on a timeline yet.'}</span></div>
      <div id="fxPrev">${fxPreviewHtml(src)}</div>
      <div id="fxParams" class="fx-params"></div>
      <details class="fx-ref" ${S.fxRef ? 'open' : ''}><summary>Language reference</summary>
        <p><b>Each line</b>: <code>name = expression</code>, or <code>r, g, b = hsv(...)</code> / <code>r, g, b = colorParam</code>. <code>//</code> starts a comment.
          Operators <code>+ - * / %</code>, compare <code>&lt; &gt; &lt;= &gt;= == !=</code>, <code>&amp;&amp; || !</code>, and <code>cond ? a : b</code>.</p>
        <p><b>Parameters</b>: <code>param speed = 0.5 [0, 4]</code> (slider), <code>param color = #ff8800</code> (colour: <code>color.r</code>, <code>.g</code>, <code>.b</code>). Each timeline cue can set its own values.</p>
        <p><b>Inputs</b>: <code>t</code> seconds since the cue · <code>i</code> fixture number in the track (0…) · <code>n</code> how many · <code>u</code> = i / n ·
          <code>x</code>, <code>y</code> position on the map (0…1) · <code>pi</code>, <code>tau</code></p>
        <p><b>Outputs</b>: <code>r g b</code> 0…1 · <code>dim</code> 0…1 (default 1) · <code>w</code> (default: the white part of r, g, b). Fixtures without a dimmer get r, g, b × dim; dimmer-only fixtures get dim × the brightest of r, g, b.</p>
        <div class="fx-funcs">${KDFX.FUNCS.map(([f]) => `<code data-ins="${f}(" title="${esc(KDFX.FDOC[f])}">${f}</code>`).join(' ')}</div>
      </details>
    </div></div>`;
};
views.effects.after = () => {
  const p = P();
  $('#fxNew')?.addEventListener('change', (ev) => {
    const v = ev.target.value;
    if (!v) return;
    const tpl = v === 'empty' ? { name: 'Effect', code: '// r, g, b and dim, per fixture, every frame\nparam color = #ffffff\nr, g, b = color\n' } : KDFX.TEMPLATES[+v];
    p.effects.push({ id: nextId(p.effects), name: fxUniqueName(tpl.name), code: tpl.code, round: true });
    S.sel.effect = p.effects.length - 1;
    markDirty();
    render();
  });
  const e = p.effects[S.sel.effect];
  if (!e) return;
  $('#fxDup').addEventListener('click', () => {
    p.effects.push({ id: nextId(p.effects), name: e.name + ' copy', code: e.code, round: !!e.round });
    S.sel.effect = p.effects.length - 1;
    markDirty();
    render();
  });
  // Swap the code for a base effect, keeping the id so timeline cues still use it.
  $('#fxBase').addEventListener('change', (ev) => {
    const tpl = KDFX.TEMPLATES[+ev.target.value];
    if (!tpl) return;
    e.code = tpl.code;
    // A name that came from a base effect ("Chase", "Chase 2", "Chase copy") follows the new one.
    if (KDFX.TEMPLATES.some((x) => e.name === x.name || e.name.startsWith(x.name + ' '))) e.name = fxUniqueName(tpl.name, e);
    // Cue values for parameters the new code doesn't have (or of another type) are dropped.
    const params = KDFX.compile(tpl.code).params;
    for (const tl of p.timelines) for (const c of tl.cues) {
      if (c.effect !== e.id || !c.params) continue;
      for (const k of Object.keys(c.params)) {
        const q = params.find((x) => x.name === k);
        if (!q || (q.type === 'color') !== (typeof c.params[k] === 'string')) delete c.params[k];
      }
    }
    S.fxValues = null;
    markDirty();
    render();
    toast(`Now based on ${tpl.name} (Ctrl+Z undoes)`);
  });
  const ta = $('#fxCode'), gutter = $('#fxGutter');
  S.fxValues = S.fxValues?.id === e.id ? S.fxValues : { id: e.id, v: {} };
  let sig = '';
  const refresh = () => {
    const prog = fxProg(e);
    const lines = (e.code || '').split('\n').length;
    gutter.textContent = Array.from({ length: lines }, (_, k) => (prog.error && prog.error.line === k + 1 ? '▶ ' : '') + (k + 1)).join('\n');
    $('#fxErr').innerHTML = prog.error ? `<span class="bad">Line ${prog.error.line}: ${esc(prog.error.msg)}</span>` : '<span class="ok">✓ compiles</span>';
    ta.classList.toggle('invalid', !!prog.error);
    if (prog.error) return;
    // Rebuild the parameter controls only when the parameters change.
    const s2 = JSON.stringify(prog.params);
    if (s2 !== sig) {
      sig = s2;
      $('#fxParams').innerHTML = prog.params.length ? `<b>Parameters</b> <span class="muted">(try values here, not saved; set defaults in the code, or per cue on the timeline. A comment after a param line is its note)</span>` + prog.params.map((q) => (q.type === 'color'
        ? `<div class="row nowrap"><span class="fx-pn">${esc(q.name)}</span><input type="color" data-fxp="${esc(q.name)}" value="${esc(S.fxValues.v[q.name] || q.def)}"><span class="cw-pal fx-pal" title="Colours of the theme chosen in the colour wheels (Colours page)">${cwTheme().colors.map((c) => `<button type="button" class="swatch" data-fxpal="${c}" style="background:${c}" title="${c}"></button>`).join('')}</span></div>`
        : `<div class="row nowrap"><span class="fx-pn">${esc(q.name)}</span><input type="range" data-fxp="${esc(q.name)}" min="${q.min}" max="${q.max}" step="${(q.max - q.min) / 200}" value="${S.fxValues.v[q.name] ?? q.def}" style="flex:1"><span class="mono fx-pv">${(+(S.fxValues.v[q.name] ?? q.def)).toFixed(2)}</span></div>`) + fxParamNote(q)).join('') : '';
      $$('[data-fxp]').forEach((i) => i.addEventListener('input', () => {
        S.fxValues.v[i.dataset.fxp] = i.type === 'color' ? i.value : +i.value;
        if (i.nextElementSibling?.classList.contains('fx-pv')) i.nextElementSibling.textContent = (+i.value).toFixed(2);
        runFxPreview($('#fxPrev'), fxProg(e), S.fxSrc || (p.maps.length ? 'map:0' : 'strip:16'), S.fxValues.v, 1, !!e.round);
      }));
      $$('[data-fxpal]').forEach((b) => b.addEventListener('click', () => {
        const i = b.closest('.row').querySelector('[data-fxp]');
        i.value = b.dataset.fxpal;
        i.dispatchEvent(new Event('input'));
      }));
    }
    runFxPreview($('#fxPrev'), prog, S.fxSrc || (p.maps.length ? 'map:0' : 'strip:16'), S.fxValues.v, 1, !!e.round);
  };
  ta.addEventListener('input', () => { e.code = ta.value; markDirty(); refresh(); });
  ta.addEventListener('scroll', () => (gutter.scrollTop = ta.scrollTop));
  ta.addEventListener('keydown', (ev) => {
    if (ev.key === 'Tab') { ev.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
  });
  $$('[data-ins]').forEach((c) => c.addEventListener('click', () => { ta.focus(); ta.setRangeText(c.dataset.ins, ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }));
  $('#fxSrc').addEventListener('change', (ev) => { S.fxSrc = ev.target.value; render(); });
  $('#fxOvl')?.addEventListener('change', (ev) => { setFxOverlay(ev.target.checked); render(); });
  const pm = /^map:(\d+)$/.exec($('#fxSrc').value), prevMap = pm && p.maps[+pm[1]];
  if (prevMap) {
    attachMapResize($('#fxPrev .map-canvas'), prevMap.aspect);
    attachMapZoom($('#fxPrev .map-canvas'), `fx:${prevMap.id}`, $('#fxSrc').closest('.row'));
  }
  $('.fx-ref').addEventListener('toggle', (ev) => (S.fxRef = ev.target.open));
  refresh();
};

// ---- Scenes: the fixtures on a map (or in a list) showing the scene's look, and controls
// for the selected ones, like a desk's programmer. The table of all levels stays below.
S.scSel = new Set();   // fixture ids selected on the Scenes page
S.scMap = 0;           // map shown there (-1 = a list of all fixtures)
// The scene's levels as DMX values per universe (for fixtureLook).
function sceneDmx(sc) {
  const dmx = {};
  for (const u of P().universes) dmx[u.id] = new Array(512).fill(0);
  for (const l of sc.levels) {
    const a = absChannel(l), d = a && dmx[a.u];
    if (!d) continue;
    if (a.wide) { d[a.ch - 1] = l.v >> 8; d[a.ch] = l.v & 255; } else d[a.ch - 1] = l.v;
  }
  return dmx;
}
// Ids of the fixtures that have at least one level in the scene.
const sceneFixtures = (sc) => new Set(sc.levels.filter((l) => l.fixture != null).map((l) => l.fixture));
function paintSceneLook(sc) {
  const dmx = sceneDmx(sc), inScene = sceneFixtures(sc), els = $$('[data-scfx]'), glow = els.length <= 40;
  for (const el of els) {
    const f = fixture(+el.dataset.scfx), on = inScene.has(f.id);
    el.classList.toggle('out', !on);
    el.classList.toggle('in', on);
    paintDot(el.querySelector('.dot'), fixtureLook(f, dmx), glow);
  }
  const n = $('#scCount');
  if (n) n.innerHTML = sceneCountHtml(sc, inScene);
}
function sceneCountHtml(sc, inScene) {
  const raw = sc.levels.filter((l) => l.fixture == null).length;
  return `<b>${inScene.size}</b> of ${P().fixtures.length} fixtures in this scene${raw ? ` · ${raw} raw channel${raw > 1 ? 's' : ''}` : ''}`;
}
// Sets a channel of some fixtures in the scene (adds the level where it's missing).
function setSceneLevel(sc, fixtures, ch, v) {
  const changed = [];
  for (const f of fixtures) {
    const s = slots(f).find((x) => x.name === ch);
    if (!s) continue;
    let l = sc.levels.find((x) => x.fixture === f.id && x.ch === ch);
    if (!l) sc.levels.push((l = { fixture: f.id, ch, v: 0 }));
    l.v = Math.max(0, Math.min(s.wide ? 65535 : 255, Math.round(v)));
    changed.push(l);
  }
  previewLevels(changed);
  markDirty();
}
function sceneProgrammerHtml(sc) {
  const p = P(), sel = p.fixtures.filter((f) => S.scSel.has(f.id));
  if (!sel.length) return '<p class="muted">Click fixtures above to set them in this scene (Shift/Ctrl+click or drag an area for several). Green dot = in this scene, faded and dashed = not in it.</p>';
  const lev = (f, ch) => sc.levels.find((l) => l.fixture === f.id && l.ch === ch);
  const chans = [];
  for (const f of sel) for (const s of slots(f)) if (!chans.some((c) => c.name === s.name)) chans.push(s);
  const nIn = sel.filter((f) => sc.levels.some((l) => l.fixture === f.id)).length;
  const rgb = sel.filter((f) => { const r = channelRoles(f); return r.r && r.g && r.b; });
  // Colour wheel and position pad on the right; they show the first fixture that has them.
  let side = '';
  if (rgb.length) {
    const f = rgb[0], v8 = (s) => { const v = lev(f, s.name)?.v ?? homeValue(f, s.name); return s.wide ? v >> 8 : v; };
    side += colorWheelHtml('sc', rgbToHex(...mixedRgb(f, v8))) + mixToggleHtml(rgb);
  }
  const pt = sel.find((f) => { const q = posSlots(f); return q.pan && q.tilt; });
  if (pt) {
    const q = posSlots(pt), frac = (s) => (lev(pt, s.name)?.v ?? homeValue(pt, s.name)) / (s.wide ? 65535 : 255);
    side += xyPadHtml('sc', frac(q.pan), frac(q.tilt));
  }
  const rows = chans.map((c) => {
    const has = sel.filter((f) => slots(f).some((s) => s.name === c.name));
    const set = has.map((f) => lev(f, c.name)).filter(Boolean);
    const max = c.wide ? 65535 : 255, v = set[0]?.v ?? homeValue(has[0], c.name);
    const note = !set.length ? 'not in scene' : new Set(set.map((l) => l.v)).size > 1 ? 'mixed' : set.length < has.length ? `${set.length} of ${has.length}` : '';
    return `<div class="sc-ch${set.length ? '' : ' off'}"><span class="sc-chn" title="${esc(c.name)}${c.wide ? ' (16-bit)' : ''} · ${has.length} fixture(s)">${esc(c.name)}</span>
      <input type="range" min="0" max="${max}" value="${v}" data-scv="${esc(c.name)}">
      <input type="number" min="0" max="${max}" value="${v}" data-scn="${esc(c.name)}">
      <span class="muted sc-pct">${Math.round((v / max) * 100)}%</span><span class="sc-note">${note}</span>
      ${set.length ? `<button class="btn small ghost" data-scrm="${esc(c.name)}" title="Take this channel out of the scene">✕</button>` : '<span></span>'}</div>`;
  }).join('');
  const one = sel.length === 1 ? sel[0] : null;
  // Which fixtures are picked, by name (the first 8), so it's clear before any of them is set.
  const names = sel.length > 1 ? `<div class="muted sc-selnames">Selected: ${sel.slice(0, 8).map((f) => esc(f.name)).join(', ')}${sel.length > 8 ? ` and ${sel.length - 8} more` : ''}</div>` : '';
  return `<div class="sc-prog">
    <div class="row"><span class="fx-ic">${one ? fxIcon(one) : ''}</span><b>${one ? esc(one.name) : sel.length + ' fixtures selected'}</b><span class="muted">${one ? (nIn ? 'in this scene' : 'not in this scene yet - move a slider or press Full to add it') : `${nIn} of them in this scene`}</span><span class="spacer"></span>
      ${sel.some((f) => channelRoles(f).dim) ? '<button class="btn small" data-scdim="255">Full</button><button class="btn small" data-scdim="128">50%</button><button class="btn small" data-scdim="0">Off</button>' : ''}
      <button class="btn small" id="scAddAll" title="Put every channel of these fixtures in the scene (at their home values where not set)">All channels</button>
      <button class="btn small ghost" id="scRemove"${nIn ? '' : ' disabled'}>Remove from scene</button></div>
    ${names}
    <div class="sc-body"><div class="sc-chs">${rows}</div>${side ? `<div class="sc-side">${side}</div>` : ''}</div>
    ${one ? `<details class="sc-fix"${S.scFixOpen ? ' open' : ''}><summary>Fixture settings · ${one.universe}.${one.address}–${one.address + footprint(one) - 1} · ${esc(fixtureType(one))}</summary>
      <div class="form" style="margin-top:8px"><label>Name</label><input data-p="fixtures.${p.fixtures.indexOf(one)}.name" value="${esc(one.name)}" data-r>${fixtureFieldsHtml(one)}</div>
      <button class="btn small ghost" id="scOpenFx" style="margin-top:6px">Open on the Fixtures page →</button></details>` : ''}
  </div>`;
}
views.scenes = () => {
  const p = P();
  const sc = p.scenes[S.sel.scene];
  let look = '';
  if (sc) {
    for (const id of [...S.scSel]) if (!fixture(id)) S.scSel.delete(id);
    S.scMap = Math.min(S.scMap, p.maps.length - 1);
    const m = p.maps[S.scMap], inScene = sceneFixtures(sc);
    // "Only in this scene" hides the others (they can't be picked then, so it's off by default).
    const shown = (f) => !S.scOnly || inScene.has(f.id);
    const mark = (f) => (inScene.has(f.id) ? ' in' : ' out') + (S.scSel.has(f.id) ? ' sel' : '');
    // Above 200 chips the dots (the scene's colour) have no icon: an inline SVG each made 476 KB
    // of HTML for 1360 fixtures.
    let icons = true;
    const chip = (f) => `<button class="sc-chip${mark(f)}" data-scfx="${f.id}" title="${esc(f.name)} · ${f.universe}.${f.address}${inScene.has(f.id) ? ' · in this scene' : ' · not in this scene'}"><span class="dot">${icons ? fxIcon(f) : ''}</span>${esc(f.name)}</button>`;
    const chips = (list) => { icons = list.length <= 200; return list.map(chip).join(''); };
    const pick = `<select id="scMap" title="Where to pick fixtures">${p.maps.map((x, i) => `<option value="${i}"${x === m ? ' selected' : ''}>Map: ${esc(x.name)}</option>`).join('')}<option value="-1"${m ? '' : ' selected'}>List of all fixtures</option></select>`;
    if (m) {
      const placed = new Set(m.items.map((it) => it.fixture)), rest = p.fixtures.filter((f) => !placed.has(f.id) && shown(f));
      // Not taller than ~60 % of the screen until you drag it bigger, so the controls stay in view.
      look = `<div class="map-wrap"><div class="map-canvas sc-map${m.background ? ' has-bg' : ''}${m.items.length > 40 ? ' dense' : ''}" id="scCanvas" style="${mapSizeStyle('kd.mapH.scenes', m.aspect, 'calc(60 * var(--vh))')}">
        ${m.background ? `<img src="/media/${encodeURIComponent(m.background)}" alt="" draggable="false">` : ''}${mapShapesHtml(m)}
        ${m.items.map((it) => { const f = fixture(it.fixture); return f && shown(f) ? mapDotHtml(f, it, mark(f), m.labels !== false, 'data-scfx') : ''; }).join('')}<div class="band" hidden></div>${mapResizeHtml('kd.mapH.scenes')}</div></div>
        ${rest.length ? `<div class="sc-chips"><span class="muted">Not on this map:</span>${chips(rest)}</div>` : ''}`;
    } else look = `<div class="sc-chips sc-all">${chips(p.fixtures.filter(shown)) || `<span class="muted">${p.fixtures.length ? 'No fixtures in this scene yet.' : 'No fixtures yet - add them on the Fixtures page.'}</span>`}</div>`;
    // Groups: one click selects a whole group (Shift/Ctrl+click adds it to the selection).
    const groups = p.groups.length ? `<div class="sc-groups"><span class="muted">Groups:</span>${p.groups.map((g) => {
      const on = g.fixtures.length && g.fixtures.every((id) => S.scSel.has(id)), n = g.fixtures.filter((id) => inScene.has(id)).length;
      return `<button class="sc-grp${on ? ' on' : ''}" data-scgrp="${g.id}" title="Select this group (Shift/Ctrl+click adds it) · ${n} of ${g.fixtures.length} in this scene">${esc(g.name)} <span class="muted">${n ? `${n}/` : ''}${g.fixtures.length}</span></button>`;
    }).join('')}</div>` : '';
    look = `<div class="row map-tools">${pick}
        <span class="sc-count" id="scCount">${sceneCountHtml(sc, inScene)}</span>
        <label class="row muted" title="Hide the fixtures that are not in this scene"><input type="checkbox" id="scOnly"${S.scOnly ? ' checked' : ''}> Only fixtures in this scene</label>
        <button class="btn small ghost" id="scSelIn"${inScene.size ? '' : ' disabled'} title="Select every fixture that is in this scene">Select those in scene</button>
        ${m ? mapZoomHtml(`scene:${m.id}`) : ''}</div>
      <div class="row muted sc-legend"><span class="sc-key in"></span>in the scene <span class="sc-key out"></span>not in the scene · click to select · drag an area · Esc clears · Ctrl+A all</div>${groups}${look}`;
  }
  return `<h2>Scenes</h2><div class="split">
    <div><div class="list">${p.scenes.map((s, i) => `<div class="item${i === S.sel.scene ? ' sel' : ''}" data-sel="scene:${i}"><span class="id">${s.id}</span>${esc(s.name)}<span class="spacer"></span><span class="muted" title="Fixtures in this scene">${sceneFixtures(s).size}</span></div>`).join('')}</div>
    <div class="row" style="margin-top:8px"><button class="btn small" data-add="scene">+ Scene</button></div></div>
    <div>${sc ? `
      <div class="row"><input data-p="scenes.${S.sel.scene}.name" value="${esc(sc.name)}" style="font-size:16px;flex:1">
        <button class="btn" data-cmd="scene ${sc.id} fade 0">Play</button>
        <button class="btn" data-cmd="release scene ${sc.id}">Release</button>
        <label class="row muted" title="Send changes as live channel overrides while editing"><input type="checkbox" id="preview"${S.preview ? ' checked' : ''}> Live preview</label>
        <button class="btn small" data-cmd="clear overrides">Clear preview</button>
        <button class="btn small ghost" data-del="scenes.${S.sel.scene}">Delete</button></div>
      <div class="used-row">${usedHtml('scenes', sc)}</div>
      ${look}
      ${sceneProgrammerHtml(sc)}
      <details class="sc-table"${S.scTable ? ' open' : ''}><summary>All levels in this scene (${sc.levels.length}) - also raw universe.channel levels</summary>
      ${S.scTable ? sceneTableHtml(sc) : ''}</details>`
    : '<span class="muted">Select or create a scene.</span>'}</div></div>`;
};
// The table of all levels: only built while it is open, at most S.scRows rows at a time. In a
// big rig each row names its fixture as text instead of a list of every fixture (that list,
// once per row, made the page megabytes big).
function sceneTableHtml(sc) {
  const p = P(), small = p.fixtures.length <= 60, rows = S.scRows || 200;
  return `<table style="margin-top:10px"><tr><th>Fixture</th><th>Channel</th><th>Value</th><th class="narrow"></th><th class="narrow">Abs.</th><th></th></tr>
      ${sc.levels.slice(0, rows).map((l, i) => {
        const base = `scenes.${S.sel.scene}.levels.${i}`;
        const f = l.fixture != null ? fixture(l.fixture) : null;
        const a = absChannel(l);
        const max = a?.wide ? 65535 : 255;
        return `<tr><td>${small || l.fixture == null ? `<select data-fx="${base}"><option value="">raw (universe.channel)</option>${small ? opts(p.fixtures, l.fixture) : ''}</select>` : `<span class="muted">${f ? `${f.id} · ${esc(f.name)}` : '?'}</span>`}</td>
          <td>${l.fixture != null
            ? `<select data-p="${base}.ch" data-r>${(f ? slots(f) : []).map((s) => `<option value="${esc(s.name)}"${s.name === l.ch ? ' selected' : ''}>${esc(s.name)}${s.wide ? ' (16-bit)' : ''}</option>`).join('')}</select>`
            : `<div class="row" style="flex-wrap:nowrap"><select data-p="${base}.u" data-t="num">${opts(p.universes, l.u, (u) => u.id)}</select><input type="number" min="1" max="512" data-p="${base}.ch" data-t="num" value="${l.ch}"></div>`}</td>
          <td><input type="range" min="0" max="${max}" data-p="${base}.v" data-t="num" value="${l.v}" data-live oninput="this.closest('tr').querySelector('.vn').value=this.value"></td>
          <td><input class="vn" type="number" min="0" max="${max}" data-p="${base}.v" data-t="num" value="${l.v}" data-live data-r></td>
          <td class="muted mono">${a ? a.u + '.' + a.ch + (a.wide ? '+' + (a.ch + 1) : '') : '?'}</td>
          <td><button class="btn small ghost" data-del="${base}">✕</button></td></tr>`;
      }).join('')}</table>
      ${sc.levels.length > rows ? `<div class="row" style="margin-top:6px"><span class="muted">Showing ${rows} of ${sc.levels.length}.</span><button class="btn small" id="scMoreRows">Show ${Math.min(sc.levels.length - rows, 500)} more</button></div>` : ''}
      <div class="row" style="margin-top:8px"><button class="btn small" data-add="level">+ Level</button>
        <select id="addFx"><option value="">Add all channels of…</option>${opts(p.fixtures)}</select>
        ${p.groups.length ? `<select id="addGrp"><option value="">Add channel of group…</option>${p.groups.map((g) => {
          const names = [...new Set(g.fixtures.map(fixture).filter(Boolean).flatMap((f) => slots(f).map((s) => s.name)))];
          return `<optgroup label="${esc(g.name)}">${names.map((n) => `<option value="${g.id}|${esc(n)}">${esc(g.name)} · ${esc(n)}</option>`).join('')}</optgroup>`;
        }).join('')}</select>` : ''}</div>`;
}
views.scenes.after = () => {
  const p = P(), sc = p.scenes[S.sel.scene];
  $('#preview')?.addEventListener('change', (e) => (S.preview = e.target.checked));
  if (sc) wireSceneLook(sc);
  $('#addFx')?.addEventListener('change', (e) => {
    const f = fixture(+e.target.value);
    if (!f) return;
    for (const s of slots(f)) if (!sc.levels.some((l) => l.fixture === f.id && l.ch === s.name)) sc.levels.push({ fixture: f.id, ch: s.name, v: homeValue(f, s.name) });
    markDirty();
    render();
  });
  $('#addGrp')?.addEventListener('change', (e) => {
    const [gid, name] = e.target.value.split('|');
    const g = P().groups.find((x) => x.id === +gid);
    if (!g) return;
    const sc = P().scenes[S.sel.scene];
    for (const f of g.fixtures.map(fixture).filter(Boolean))
      if (slots(f).some((s) => s.name === name) && !sc.levels.some((l) => l.fixture === f.id && l.ch === name)) sc.levels.push({ fixture: f.id, ch: name, v: 255 });
    markDirty();
    render();
  });
  $$('[data-fx]').forEach((el) => el.addEventListener('change', () => {
    const l = getPath(P(), el.dataset.fx);
    if (el.value) { const f = fixture(+el.value); l.fixture = f.id; l.ch = slots(f)[0]?.name || 1; delete l.u; }
    else { delete l.fixture; l.u = P().universes[0]?.id || 1; l.ch = 1; }
    markDirty();
    render();
  }));
};
function wireSceneLook(sc) {
  const p = P(), m = p.maps[S.scMap];
  // Libraries types give the home values and icons.
  if (!LIB.list && p.fixtures.some((f) => f.type && !findType(f.type))) loadLibrary(() => S.view === 'scenes' && render());
  paintSceneLook(sc);
  if ($('#scCanvas')) attachMapZoom($('#scCanvas'), `scene:${m.id}`);
  $('#scMap').addEventListener('change', (e) => { S.scMap = +e.target.value; render(); });
  $('#scOnly').addEventListener('change', (e) => { S.scOnly = e.target.checked; render(); });
  $('#scSelIn').addEventListener('click', () => { S.scSel = sceneFixtures(sc); render(); });
  $('.sc-table').addEventListener('toggle', (e) => {
    S.scTable = e.target.open;
    if (S.scTable && !$('.sc-table table')) render();   // built on first open
  });
  $('#scMoreRows')?.addEventListener('click', () => { S.scRows = (S.scRows || 200) + 500; render(); });
  $('.sc-fix')?.addEventListener('toggle', (e) => (S.scFixOpen = e.target.open));
  const paintSel = () => $$('[data-scfx]').forEach((el) => el.classList.toggle('sel', S.scSel.has(+el.dataset.scfx)));
  $$('[data-scfx]').forEach((el) => el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const id = +el.dataset.scfx;
    if (e.shiftKey && bandBegin && canvas.contains(el)) return bandBegin(e, id);   // Shift+drag adds an area, also from a fixture
    if (e.shiftKey || e.ctrlKey || e.metaKey) S.scSel.has(id) ? S.scSel.delete(id) : S.scSel.add(id);
    else S.scSel = new Set([id]);
    render();
  }));
  $$('[data-scgrp]').forEach((b) => b.addEventListener('click', (e) => {
    const g = p.groups.find((x) => x.id === +b.dataset.scgrp), ids = g.fixtures.filter((id) => fixture(id));
    S.scSel = new Set([...(e.shiftKey || e.ctrlKey || e.metaKey ? S.scSel : []), ...ids]);
    render();
  }));
  const canvas = $('#scCanvas');
  if (canvas) attachMapResize(canvas, m.aspect);
  const bandBegin = canvas && bandSelect(canvas, m.items, () => S.scSel, (s) => (S.scSel = s), paintSel, render);
  // The selected fixtures' controls.
  const sel = p.fixtures.filter((f) => S.scSel.has(f.id));
  if (!sel.length) return;
  const max = (ch) => (slots(sel.find((f) => slots(f).some((s) => s.name === ch))).find((s) => s.name === ch).wide ? 65535 : 255);
  const show = (ch, v) => {
    const row = $(`[data-scv="${CSS.escape(ch)}"]`).closest('.sc-ch');
    row.querySelector('[data-scv]').value = v;
    row.querySelector('[data-scn]').value = v;
    row.querySelector('.sc-pct').textContent = Math.round((v / max(ch)) * 100) + '%';
    row.classList.remove('off');
  };
  $$('[data-scv]').forEach((el) => {
    el.addEventListener('input', () => { setSceneLevel(sc, sel, el.dataset.scv, +el.value); show(el.dataset.scv, +el.value); paintSceneLook(sc); });
    el.addEventListener('change', render);
  });
  $$('[data-scn]').forEach((el) => el.addEventListener('change', () => { setSceneLevel(sc, sel, el.dataset.scn, +el.value || 0); render(); }));
  $$('[data-scrm]').forEach((b) => b.addEventListener('click', () => {
    sc.levels = sc.levels.filter((l) => !(S.scSel.has(l.fixture) && l.ch === b.dataset.scrm));
    markDirty();
    render();
  }));
  $$('[data-scdim]').forEach((b) => b.addEventListener('click', () => {
    for (const f of sel) { const d = channelRoles(f).dim; if (d) setSceneLevel(sc, [f], d.name, d.wide ? +b.dataset.scdim * 257 : +b.dataset.scdim); }
    render();
  }));
  $('#scAddAll').addEventListener('click', () => {
    for (const f of sel) for (const s of slots(f)) if (!sc.levels.some((l) => l.fixture === f.id && l.ch === s.name)) sc.levels.push({ fixture: f.id, ch: s.name, v: homeValue(f, s.name) });
    markDirty();
    render();
  });
  $('#scRemove').addEventListener('click', () => {
    sc.levels = sc.levels.filter((l) => !S.scSel.has(l.fixture));
    markDirty();
    render();
  });
  // Colour wheel: sets r, g, b of every selected colour fixture.
  const cw = $('[data-cw="sc"]');
  if (cw) attachColorWheel(cw, cw.querySelector('.cw-hex').value, (hex, done) => {
    const rgb = hexToRgb(hex);
    let shown = false;
    for (const f of sel) {
      const ro = channelRoles(f);
      if (!(ro.r && ro.g && ro.b)) continue;
      // Picking a colour should give light: a dimmer that isn't in the scene yet goes to full.
      if (ro.dim && !sc.levels.some((l) => l.fixture === f.id && l.ch === ro.dim.name)) setSceneLevel(sc, [f], ro.dim.name, ro.dim.wide ? 65535 : 255);
      // r, g, b, and with "Auto white / amber" also w and amber.
      const mx = mixColor(f, rgb), m = mixRoles(f);
      for (const k in mx) {
        const s = m[k], v = s.wide ? mx[k] * 257 : mx[k];
        setSceneLevel(sc, [f], s.name, v);
        if (!shown && !done) show(s.name, v);   // the sliders follow the first fixture
      }
      shown = true;
    }
    paintSceneLook(sc);
    if (done) render();
  });
  wireMixToggle(render);
  // Position pad: sets pan and tilt of every selected moving head.
  const xy = $('[data-xy="sc"]');
  if (xy) attachXyPad(xy, +xy.dataset.x, +xy.dataset.y, (x, y, done) => {
    let shown = false;
    for (const f of sel) {
      const q = posSlots(f);
      if (!(q.pan && q.tilt)) continue;
      [[q.pan, x], [q.tilt, y]].forEach(([s, fr]) => {
        const v = Math.round(fr * (s.wide ? 65535 : 255));
        setSceneLevel(sc, [f], s.name, v);
        if (!shown && !done) show(s.name, v);
      });
      shown = true;
    }
    if (done) render();
  });
  $('#scOpenFx')?.addEventListener('click', () => { S.fxSel = new Set([sel[0].id]); S.fxGroup = null; S.fxPanel = ''; S.revealFx = true; S.view = 'fixtures'; render(); });
  wireFixtureFields();
}
// Scene keys: Esc clears the selection, Ctrl+A selects every fixture shown.
views.scenes.keys = (e) => {
  if (e.key === 'Escape' && S.scSel.size) { S.scSel = new Set(); render(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    S.scSel = new Set($$('[data-scfx]').map((el) => +el.dataset.scfx));
    render();
  }
};

views.timelines = () => {
  const p = P();
  const ti = S.sel.timeline, t = p.timelines[ti];
  return `<h2>Timelines</h2><div class="split">
    <div><div class="list">${p.timelines.map((x, i) => `<div class="item${i === ti ? ' sel' : ''}" data-sel="timeline:${i}"><span class="id">${x.id}</span>${esc(x.name)}</div>`).join('')}</div>
    <div class="row" style="margin-top:8px"><button class="btn small" data-add="timeline">+ Timeline</button></div></div>
    <div>${t ? `
      <div class="row"><input data-p="timelines.${ti}.name" value="${esc(t.name)}" data-orig="${esc(t.name)}" style="font-size:16px;flex:1">
        <button class="btn" data-cmd="start timeline ${t.id}">▶ Start</button>
        ${S.tlCursor ? `<button class="btn" data-tlplay title="Play from the cursor (Space)">▶ from ${(S.tlCursor / 1000).toFixed(1)} s</button>` : ''}
        <button class="btn" data-tlpause title="Pause / carry on (Space, Shift+Space)">❚❚</button>
        <button class="btn" data-cmd="stop timeline ${t.id} fade 2">■ Release</button>
        <button class="btn small tl-live${S.tlLive ? ' on' : ''}" id="tlLive" title="Live editing: every change to this timeline goes to the controller at once and a running timeline carries on with it. Not saved: press Save to keep it. Off = changes only reach the controller when you save.">● Live editing</button>
        <span class="muted tl-live-msg" id="tlLiveMsg"></span>
        <button class="btn small ghost" data-del="timelines.${ti}">Delete</button></div>
      <div class="used-row">${usedHtml('timelines', t)}</div>
      <div class="row" style="margin-top:10px">
        <label class="muted">Length (s)</label><input type="number" min="0" step="0.1" style="width:90px" data-p="timelines.${ti}.length" data-t="sec" value="${(t.length || 0) / 1000}" data-r>
        <label class="muted"><input type="checkbox" data-p="timelines.${ti}.loop" data-t="bool"${t.loop ? ' checked' : ''} data-r> Loop</label>
        ${t.loop ? '' : `<label class="muted" title="What happens when the timeline reaches its end. Release: it lets go (fades out), like Stop. Hold: it keeps its last look until it is stopped.">At the end</label>
        <select data-p="timelines.${ti}.end" data-r><option value="release"${t.end === 'release' ? ' selected' : ''}>release</option><option value="hold"${t.end === 'release' ? '' : ' selected'}>hold last look</option></select>
        ${t.end === 'release' ? `<label class="muted">fade (s)</label><input type="number" min="0" step="0.1" style="width:70px" data-p="timelines.${ti}.endFade" data-t="sec" value="${(t.endFade || 0) / 1000}">` : ''}`}
        <label class="muted">Priority</label><input type="number" style="width:70px" data-p="timelines.${ti}.priority" data-t="num" value="${t.priority || 0}">
        <label class="muted" title="Starting a timeline releases the other timelines in the same group">Group</label>
        <select data-p="timelines.${ti}.group">${TL_GROUPS.map((g) => `<option value="${g}"${(t.group || '') === g ? ' selected' : ''}>${g || 'none'}</option>`).join('')}</select>
      </div>
      <div id="tlFollow">${tlFollowHtml(t)}</div>
      ${tlGridHtml(t)}
      ${S.trackEdit != null && t.tracks[S.trackEdit] ? trackFixturesHtml(t, S.trackEdit) : ''}
      <div class="row" style="margin-top:8px">
        <button class="btn small" data-add="track"${t.tracks.length >= 16 ? ' disabled' : ''}>+ Track</button>
        <button class="btn small" data-add="cue:preset" title="A solid colour clip on the current track, at the cursor">+ Colour</button>
        <button class="btn small" data-add="cue:scene" title="A scene clip on the current track, at the cursor">+ Scene</button>
        <button class="btn small" data-add="cue:effect"${p.effects.length ? '' : ' disabled'} title="${p.effects.length ? 'An effect clip on the current track, at the cursor' : 'Make an effect first (Effects page)'}">+ Effect</button>
        <button class="btn small" data-add="trigcue">+ Trigger cue</button></div>
      <p class="muted keys">Clips work like Ableton: double-click an empty spot to add one, drag to move (Ctrl+drag copies, Alt = no snap), drag the edges for start and length,
        the little squares at the top for fade in / out. Empty space on a track is empty: its fixtures show what is underneath. Click empty space to put the cursor, drag there to select several.
        Space plays from the cursor; click the time ruler while playing to jump there. Click a track's name to make it the current track: + Colour / Scene / Effect add there (at the cursor). Right-click empty space, a clip, a track name or the ruler for a menu.
        Ctrl+wheel zooms. Each track has its own fixtures and fades on its own; a track without fixtures plays scenes on the whole rig.<br>
        Keys: Ctrl+C / X / V copy, cut, paste at the cursor · Ctrl+D duplicate · Ctrl+E split at the cursor · Ctrl+A select all · Del delete · ←/→ previous/next cue · ↑/↓ other track · Shift+←/→ move 0.1 s (Ctrl 1 s) · 1–9, 0 colour · [ ] hue · + − intensity · Enter colour wheel · Space play from the cursor / pause / carry on · Esc deselect</p>
      <div id="cueEdBox">${cueEditorHtml(t)}</div>
      <h3>All cues</h3>
      <table class="cue-list"><tr><th class="narrow">Time (s)</th><th>Track</th><th>What</th><th class="narrow">Length (s)</th><th class="narrow">Fade (s)</th><th></th></tr>
      ${t.cues.map((c, i) => [c, i]).sort((a, b) => a[0].t - b[0].t).map(([c, i]) => `<tr data-cuerow="${i}" class="${i === S.sel.cue ? 'sel' : ''}${c.trigger != null ? ' trig-cue' : ''}">
        <td><input type="number" min="0" step="0.1" data-p="timelines.${ti}.cues.${i}.t" data-t="sec" value="${c.t / 1000}" style="width:80px" data-r></td><td>${c.trigger != null ? '◆ Triggers' : esc(t.tracks[c.track || 0]?.name || '?')}</td>
        <td>${esc(cueLabel(c, t))}</td><td class="mono">${c.trigger != null ? '' : c.len ? (c.len / 1000).toFixed(2) : '<span class="muted">hold</span>'}</td>
        <td class="mono">${c.trigger != null ? '' : ((c.fade || 0) / 1000).toFixed(1) + (c.out ? ` / ${(c.out / 1000).toFixed(1)}` : '')}</td>
        <td><button class="btn small ghost" data-del="timelines.${ti}.cues.${i}">✕</button></td></tr>`).join('')}</table>`
    : '<span class="muted">Select or create a timeline.</span>'}</div></div>`;
};
// ---- Live editing: the open timeline goes to the controller (PUT /api/timeline, not saved)
// whenever it differs from what the controller has. S.tlLiveSent = id -> the JSON it has
// (unknown: the saved one if nothing is unsaved). A save reloads the controller: start again.
S.tlLive = (() => { try { return localStorage.getItem('kd.tlLive') !== '0'; } catch { return true; } })();
S.tlLiveSent = {};
S.tlLiveErr = {};   // id -> why the controller refused the last version
async function tlLiveSync(t) {
  const paint = () => {
    const m = $('#tlLiveMsg'), err = S.tlLive && t ? S.tlLiveErr[t.id] : '';
    if (!m) return;
    m.textContent = err ? `not live: ${err}` : '';
    m.title = err ? 'The controller cannot play this version yet - does it use a new scene, effect or fixture? Save first.' : '';
  };
  paint();
  if (!S.tlLive || !t) return;
  const json = JSON.stringify(t);
  if (S.tlLiveSent[t.id] == null && !S.dirty) S.tlLiveSent[t.id] = json;   // the controller has the saved one
  if (S.tlLiveSent[t.id] === json || S.tlLiveBusy) return;
  S.tlLiveBusy = true;
  try {
    await api('/api/timeline', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: json });
    delete S.tlLiveErr[t.id];
  } catch (e) {
    S.tlLiveErr[t.id] = e.message;
  }
  S.tlLiveSent[t.id] = json;   // a refused one isn't sent again until it changes
  S.tlLiveBusy = false;
  paint();
}
// What a cue does, in a few words.
function cueLabel(c, t) {
  if (c.trigger != null) {
    const h = findTrigs(String(c.trigger));
    return `fire ${h.length === 1 ? `#${h[0].id} ${h[0].name}` : `${c.trigger} (${h.length ? 'ambiguous' : 'not found'})`}`;
  }
  if (c.effect != null) {
    const e = P().effects.find((x) => x.id === c.effect);
    return `✦ ${e ? e.name : `effect ${c.effect} (missing)`}${c.dim != null && c.dim !== 100 ? ` ${c.dim}%` : ''}`;
  }
  if (c.dim != null || c.color != null) return [c.dim != null ? `${c.dim}%` : '', c.color || ''].filter(Boolean).join(' ') || 'preset';
  const sc = P().scenes.find((s) => s.id === c.scene);
  return sc ? sc.name : `scene ${c.scene} (missing)`;
}
const isPreset = (c) => c.effect == null && (c.dim != null || c.color != null);
const cueKind = (c) => (c.trigger != null ? 'trigger' : c.effect != null ? 'effect' : isPreset(c) ? 'preset' : 'scene');
// Fixtures of a track with their map positions, for effect previews (as the controller runs them).
function trackPreviewFixtures(tr, e) {
  const ids = trackFxIds(tr), round = KDModel.effectRound(P(), e);
  return ids.map((id, k) => {
    const it = KDModel.mapPosition(P(), id, round);
    return { f: fixture(id), x: it ? it.x : k / ids.length, y: it ? it.y : 0.5 };
  });
}
// The map an effect cue's preview shows: the one picked for this track (S.cuePrevMap, per
// timeline and track, not saved), else the one with the most of the track's fixtures.
// 'strip' = no map, the track's fixtures in a row.
const cuePrevKey = (tl, track) => `${tl.id}:${track || 0}`;
function cuePreviewMap(ids, key) {
  const pick = (S.cuePrevMap || {})[key];
  if (pick === 'strip') return null;
  const want = new Set(ids), chosen = pick != null && P().maps.find((m) => m.id === pick);
  if (chosen) return chosen;
  let best = null, bn = 0;
  for (const m of P().maps) { const n = m.items.filter((it) => want.has(it.fixture)).length; if (n > bn) { bn = n; best = m; } }
  return best;
}
// Effect cue preview, like the Effects page: the whole map with every fixture on it; the
// track's fixtures play the effect (data-pv = their i in the track), the others are greyed.
// Track fixtures not on that map get a strip under it. The drop-down picks another map
// (those with track fixtures on them) or the strip.
function cuePreviewHtml(tr, key) {
  const ids = trackFxIds(tr), m = cuePreviewMap(ids, key), idx = new Map(ids.map((id, k) => [id, k]));
  const want = new Set(ids), maps = P().maps.map((x) => [x, x.items.filter((it) => want.has(it.fixture)).length]).filter(([, n]) => n);
  const picker = maps.length ? `<select data-cueprevmap title="Which map the preview shows (only here, not saved)">${maps.map(([x, n]) => `<option value="${x.id}"${m === x ? ' selected' : ''}>${esc(x.name)} (${n})</option>`).join('')}<option value="strip"${m ? '' : ' selected'}>Strip (track order)</option></select>` : '';
  if (!m) return `<div class="row cue-prev-head"><b>Preview</b>${picker}</div><div class="fx-prev strip">${ids.map((_, k) => `<span data-pv="${k}"></span>`).join('')}</div>`;
  const items = m.items.filter((it) => fixture(it.fixture)), onMap = new Set(items.map((it) => it.fixture));
  const rest = ids.filter((id) => !onMap.has(id)), zkey = `cue:${m.id}`;
  // Effects use each fixture's place on the first map it is on (as the controller does):
  // on another map, the pattern over the map can differ from what those fixtures play.
  const elsewhere = ids.filter((id) => onMap.has(id) && P().maps.find((x) => x.items.some((it) => it.fixture === id)) !== m).length;
  return `<div class="row cue-prev-head"><b>Preview</b>${picker}
      <label class="muted" title="Runs the effect over the whole map, not only where the fixtures are, so you can see the pattern between them"><input type="checkbox" data-cueovl${fxOverlayOn() ? ' checked' : ''}> whole map</label>${mapZoomHtml(zkey)}</div>
    <div class="map-wrap"><div class="fx-prev map-canvas${items.length > 40 ? ' dense' : ''}" style="${mapSizeStyle('kd.mapH.cue', m.aspect, 'calc(40 * var(--vh))')}" data-aspect="${m.aspect}" data-zoomkey="${zkey}">${m.background ? `<img src="/media/${encodeURIComponent(m.background)}" alt="">` : ''}${fxOverlayOn() ? '<canvas class="fx-ovl"></canvas>' : ''}
    ${mapShapesHtml(m)}${items.map((it) => { const f = fixture(it.fixture), k = idx.get(it.fixture); return `<div class="mfx${k == null ? ' out' : ''}" style="left:${it.x * 100}%;top:${it.y * 100}%" title="${esc(f.name)}${k == null ? ' (not in this track)' : ''}"><span class="dot"${k == null ? '' : ` data-pv="${k}"`}></span></div>`; }).join('')}${mapResizeHtml('kd.mapH.cue')}</div></div>
    ${elsewhere && fxOverlayOn() ? `<div class="muted" style="margin-top:6px">${elsewhere} of these fixture(s) take their place for effects from an earlier map, so the pattern over this map may not match them.</div>` : ''}
    ${rest.length ? `<div class="muted" style="margin-top:6px">Not on this map: ${rest.length} fixture(s)</div><div class="fx-prev strip">${rest.map((id) => `<span data-pv="${idx.get(id)}" title="${esc(fixture(id).name)}"></span>`).join('')}</div>` : ''}`;
}
// Fixture ids of a track (its fixtures + its groups' fixtures), like Show::parse.
const trackFxIds = (tr) => KDModel.trackFixtureIds(P(), tr);
// ---- Timeline editing (Ableton-style clips) ----
// A light cue is a clip: with a length ("len") it ends there and the track is empty
// after it (fixtures show what is underneath), fading out over "out"; without one it
// holds until the next cue on its track (Pharos style).
const TL_HEAD = 210;   // px of the track-name column
const TL_SNAPS = [['auto', 'Grid'], ['0', 'Off'], ['100', '0.1 s'], ['250', '¼ s'], ['500', '½ s'], ['1000', '1 s'], ['5000', '5 s']];
const tlGridStep = (pxs) => [100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000].find((ms) => (ms / 1000) * pxs >= 14) || 60000;
const tlSnapMs = (pxs) => (S.tlSnap == null || S.tlSnap === 'auto' ? tlGridStep(pxs) : +S.tlSnap);
const isLight = (c) => c.trigger == null;
const fmtS = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}` : `${+(ms / 1000).toFixed(2)}s`);
// Where a clip ends: start + length, or (holding) the next cue on its track, else `dflt`.
function cueEnd(t, c, dflt) {
  if (!isLight(c)) return c.t;
  if (c.len) return c.t + c.len;
  let nx = Infinity;
  for (const x of t.cues) if (x !== c && isLight(x) && (x.track || 0) === (c.track || 0) && x.t > c.t && x.t < nx) nx = x.t;
  return nx < Infinity ? nx : dflt;
}
// Visible length, pixels per second (zoom; S.tlZoom null = fit the width) and grid step.
function tlLayout(t) {
  let len = Math.max(t.length || 0, 5000, ...t.cues.map((c) => c.t + Math.max(c.len || 0, c.fade || 0) + 1000));
  const viewW = Math.max(200, S.tlViewW || 900);
  const pxs = S.tlZoom || viewW / (len / 1000);
  len = Math.max(len, (viewW / pxs) * 1000);
  return { len, pxs, w: Math.round((len / 1000) * pxs), grid: tlGridStep(pxs) };
}
// The selected cues (objects, so they survive reordering); S.sel.cue is the one in the editor.
function tlSelection(t) {
  if (!(S.tlSel instanceof Set) || S.tlSelOf !== t) { S.tlSel = new Set(); S.tlSelOf = t; }
  for (const c of S.tlSel) if (!t.cues.includes(c)) S.tlSel.delete(c);
  const prim = t.cues[S.sel.cue];
  if (!prim) S.tlSel.clear();
  else if (!S.tlSel.has(prim)) { S.tlSel.clear(); S.tlSel.add(prim); }
  return S.tlSel;
}
function tlSelect(t, cues, primary) {
  S.tlSel = new Set(cues);
  S.tlSelOf = t;
  const p = primary && cues.includes(primary) ? primary : [...cues].sort((a, b) => a.t - b.t)[0];
  S.sel.cue = p ? t.cues.indexOf(p) : -1;
}
// The fade ramps of a clip: the darker part above the line, drawn along its crossfade path.
function rampSvg(path, out) {
  const ease = KDModel.EASE[path] || KDModel.EASE.linear;
  const pts = Array.from({ length: 13 }, (_, i) => { const x = i / 12; return `${x},${out ? x : 1 - ease(x)}`; }).join(' ');
  return `<svg viewBox="0 0 1 1" preserveAspectRatio="none"><polygon points="${out ? '' : '0,0 '}${pts} 1,0" /><polyline points="${pts}" /></svg>`;
}
// Inside of a clip: fade-in / fade-out ramps, label, fade handles, edges to resize.
// Level of a clip in % (effect level or preset intensity), null when it has none (scene, colour only).
const cueLevel = (c) => (c.effect != null ? c.dim ?? 100 : isPreset(c) ? c.dim ?? null : null);
function blkInner(t, c, end) {
  const nx = xfadeNext(t, c), xout = nx ? c.t + c.len - nx.t : 0;
  const span = Math.max(1, end - c.t), fin = Math.min(c.fade || 0, span), fout = c.len ? Math.min(xout || c.out || 0, span) : 0, lv = cueLevel(c);
  // The level as a line across the clip (dark above it), like a fader: drag it up or down.
  return `${c.effect != null || (c.scene != null && !isPreset(c)) ? '<canvas class="thumb"></canvas>' : ''}
    ${lv != null ? `<div class="lv-shade" style="height:${100 - lv}%"></div><i class="lv" data-h="level" style="top:${100 - lv}%" title="Level ${lv}% - drag up or down"></i>` : ''}
    ${fin ? `<div class="ramp" style="width:${(fin / span) * 100}%">${rampSvg(c.path)}</div>` : ''}
    ${fout ? `<div class="ramp out" style="width:${(fout / span) * 100}%">${rampSvg('linear', true)}</div>` : ''}
    <span>${esc(cueLabel(c, t))}${c.len ? '' : ' →'}</span>
    <i class="fh" data-h="fade" style="left:${(fin / span) * 100}%" title="Drag: fade in"></i>
    ${c.len && !nx ? `<i class="fh out" data-h="out" style="right:${(fout / span) * 100}%" title="Drag: fade out"></i>` : ''}
    <i class="eg l" data-h="left" title="Drag: change the start"></i><i class="eg r" data-h="right" title="Drag: change the length"></i>`;
}
// Look of a colour clip as one solid colour: its colour at its intensity (no colour: warm white).
function presetCss(c) {
  const k = c.dim == null ? 1 : c.dim / 100;
  if (!c.color) return `rgba(255,214,150,${(0.12 + k * 0.88).toFixed(2)})`;
  return `rgb(${hexToRgb(c.color).map((v) => Math.round(v * k)).join(',')})`;
}
const THUMB_ROWS = 24;   // fixtures drawn in a clip preview at most (evenly picked)
// Preview inside an effect or scene clip, on its canvas at the clip's real size on screen
// (so zooming shows more detail instead of stretching): time runs left to right (the
// effect as it plays from the clip's start), the track's fixtures top to bottom.
// Painted clip pictures, reused across page draws: painting an effect clip runs the effect
// per 2 screen pixels (~6 ms per clip on a big show), and render() repaints every clip. The
// key holds everything the picture depends on; S.editSeq changes on every project edit, so
// after an edit each clip paints once and clicking around costs nothing.
const tlThumbs = new Map();
function keepThumb(key, cv) {
  if (tlThumbs.size > 120) tlThumbs.clear();   // plenty for a few timelines; a drag makes many keys
  const copy = document.createElement('canvas');
  copy.width = cv.width;
  copy.height = cv.height;
  copy.getContext('2d').drawImage(cv, 0, 0);
  tlThumbs.set(key, copy);
}
function paintClip(t, c, el, end) {
  const cv = el.querySelector('canvas.thumb');
  if (!cv) return;
  const tr = t.tracks[c.track || 0], g = cv.getContext('2d');
  const W = Math.max(1, Math.min(4000, el.clientWidth)), H = Math.max(1, el.clientHeight);   // very long clips: stretched a little
  const key = `${S.editSeq || 0}|${W}x${H}|${c.track || 0}|${end - c.t}|${JSON.stringify(c)}`;
  const hit = tlThumbs.get(key);
  if (hit) {
    cv.width = W;
    cv.height = H;
    g.drawImage(hit, 0, 0);
    return;
  }
  if (c.effect != null) {
    const e = P().effects.find((x) => x.id === c.effect), prog = e && fxProg(e), fx = tr ? trackPreviewFixtures(tr, e) : [];
    if (!prog || prog.error || !fx.length) return;
    const rows = Math.min(fx.length, THUMB_ROWS, Math.floor(H / 2));
    const pick = Array.from({ length: rows }, (_, r) => Math.floor((r * fx.length) / rows));
    const outs = pick.map((k) => fxOutputs(fx[k].f)), base = KDFX.slotsFor(prog, c.params || {}), level = (c.dim ?? 100) / 100;
    const msPerPx = Math.max(1, end - c.t) / W, step = 2;   // one sample per 2 screen pixels
    cv.width = W;
    cv.height = H;
    for (let x = 0; x < W; x += step) {
      const ts = ((x + step / 2) * msPerPx) / 1000;
      pick.forEach((k, r) => {
        const y0 = Math.round((r * H) / rows), y1 = Math.round(((r + 1) * H) / rows);
        g.fillStyle = fxPreviewColor(prog, base, outs[r], k, fx.length, fx[k].x, fx[k].y, ts, level).css;
        g.fillRect(x, y0, step, y1 - y0);
      });
    }
    keepThumb(key, cv);
    return;
  }
  // Scene: each fixture's colour in it (the track's fixtures, or all on a whole-rig track).
  const sc = P().scenes.find((s) => s.id === c.scene);
  if (!sc) return;
  const ids = tr && trackFxIds(tr).length ? trackFxIds(tr) : P().fixtures.map((f) => f.id), dmx = sceneDmx(sc);
  const looks = ids.map((id) => fixture(id)).filter(Boolean).map((f) => fixtureLook(f, dmx)).filter((l) => l && l.level > 0);
  if (!looks.length) return;
  const rows = Math.min(looks.length, THUMB_ROWS, Math.floor(H / 2));
  cv.width = W;
  cv.height = H;
  for (let r = 0; r < rows; r++) {
    const y0 = Math.round((r * H) / rows), y1 = Math.round(((r + 1) * H) / rows);
    g.fillStyle = looks[Math.floor((r * looks.length) / rows)].color;
    g.fillRect(0, y0, W, y1 - y0);
  }
  keepThumb(key, cv);
}
// The track lanes: a ruler, a lane for trigger cues, then one lane per track with a clip per cue.
function tlGridHtml(t) {
  syncXfades(t);   // a typed time or length may have changed an overlap
  const L = tlLayout(t), len = L.len, sel = tlSelection(t);
  const rstep = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s * L.pxs >= 64) || 1200;
  let ruler = '';
  for (let s = 0; s * 1000 <= len; s += rstep) ruler += `<span style="left:${(s * 1000 / len) * 100}%">${fmtS(s * 1000)}</span>`;
  const pct = (ms) => (ms / len) * 100;
  const after = t.length ? `<div class="tl-after" style="left:${pct(t.length)}%"></div>` : '';
  const cur = S.tlCursor != null ? `<div class="tl-cur" style="left:${pct(S.tlCursor)}%"></div>` : '';
  const trig = t.cues.map((c, i) => [c, i]).filter(([c]) => !isLight(c)).map(([c, i]) => {
    const h = findTrigs(String(c.trigger)), tr = h.length === 1 ? h[0] : null, col = tr && trigColor(tr.color);
    return `<div class="tcue${tr ? '' : ' bad'}${sel.has(c) ? ' sel' : ''}" data-cue="${i}" style="left:${pct(c.t)}%${col ? `;--tc:${col}` : ''}" title="${(c.t / 1000).toFixed(2)} s: ${esc(cueLabel(c, t))}"><span>◆ ${esc(tr ? tr.name : String(c.trigger))}</span></div>`;
  }).join('');
  const lanes = t.tracks.map((tr, r) => {
    const fx = trackFxIds(tr);
    // In start order, so a clip that crossfades in is drawn over the one it fades from.
    const blocks = t.cues.map((c, i) => [c, i]).filter(([c]) => isLight(c) && (c.track || 0) === r).sort((a, b) => a[0].t - b[0].t).map(([c, i]) => {
      const end = cueEnd(t, c, len), xa = xfadePrev(t, c);
      const preset = isPreset(c), effect = c.effect != null;
      const bad = (preset || effect) && !fx.length || (effect && !P().effects.some((e) => e.id === c.effect && !fxProg(e).error));
      const col = preset ? (c.color || '#ffffff') : effect ? '#bf5af2' : 'var(--blue)';
      const a = preset && c.dim != null ? 0.25 + (c.dim / 100) * 0.6 : 0.6;
      return `<div class="blk${sel.has(c) ? ' sel' : ''}${bad ? ' bad' : ''}${effect ? ' fx' : ''}${preset ? ' solid' : ''}${c.len ? '' : ' hold'}${xa ? ' xf' : ''}" data-cue="${i}" style="left:${pct(c.t)}%;width:${pct(end - c.t)}%;--bc:${col};--ba:${a}${preset ? `;--solid:${presetCss(c)}` : ''}${xa ? `;--xf:${(((c.fade || 0) / Math.max(1, end - c.t)) * 100).toFixed(2)}%` : ''}" title="${(c.t / 1000).toFixed(2)} s · ${c.len ? `length ${(c.len / 1000).toFixed(2)} s` : 'holds until the next cue'} · ${xa ? `crossfade ${((c.fade || 0) / 1000).toFixed(1)} s from ${esc(cueLabel(xa, t))}` : `fade ${((c.fade || 0) / 1000).toFixed(1)} s`}${c.out ? ` / out ${(c.out / 1000).toFixed(1)} s` : ''} · ${esc(cueLabel(c, t))}${bad ? ' - this track has no fixtures' : ''}">${blkInner(t, c, end)}</div>`;
    }).join('');
    return `<div class="tl-row"><div class="tl-h${S.trackEdit === r ? ' on' : ''}${S.tlCursorLane === r ? ' cur' : ''}" data-trackhead="${r}">
        <input data-p="timelines.${S.sel.timeline}.tracks.${r}.name" value="${esc(tr.name)}" title="Track name">
        <button class="btn small${fx.length ? '' : ' ghost'}" data-trackedit="${r}" title="Choose the fixtures of this track">${fx.length ? `${fx.length} fixture${fx.length > 1 ? 's' : ''}` : 'whole rig'}</button>
        ${t.tracks.length > 1 ? `<button class="btn small ghost" data-trackdel="${r}" title="Delete track">✕</button>` : ''}</div>
      <div class="tl-lane${S.tlCursorLane === r ? ' curlane' : ''}" data-lane="${r}">${after}${cur}${blocks}<div class="head"></div></div></div>`;
  }).join('');
  return `<div class="row tl-tools">
      <label class="muted">Snap</label><div class="seg">${TL_SNAPS.map(([v, n]) => `<button class="${String(S.tlSnap ?? 'auto') === v ? 'on' : ''}" data-tlsnap="${v}" title="${v === 'auto' ? 'Snap to the grid lines (they follow the zoom)' : ''}">${n}</button>`).join('')}</div>
      <label class="muted" style="margin-left:12px">Zoom</label>
      <button class="btn small" data-tlzoom="0.66" title="Zoom out (Ctrl+wheel)">−</button><button class="btn small" data-tlzoom="1.5" title="Zoom in (Ctrl+wheel)">+</button>
      <button class="btn small${S.tlZoom ? '' : ' on'}" data-tlzoom="fit" title="Show the whole timeline">Fit</button>
      <span class="muted mono" id="tlInfo" style="margin-left:auto">${[S.tlCursor != null ? `cursor ${(S.tlCursor / 1000).toFixed(2)} s` : '', sel.size > 1 ? `${sel.size} selected` : ''].filter(Boolean).join(' · ')}</span></div>
    <div class="tl-scroll" id="tlScroll"><div class="tl-grid" id="tlGrid" data-len="${len}" data-pxs="${L.pxs}" style="--w:${L.w}px;--g:${(L.grid / 1000) * L.pxs}px">
    <div class="tl-row"><div class="tl-h muted">time</div><div class="tl-lane ruler" data-ruler>${ruler}${t.length ? `<div class="tl-endm" style="left:${pct(t.length)}%" title="End of the timeline (${(t.length / 1000).toFixed(2)} s) - drag to change"></div>` : ''}${cur}</div></div>
    <div class="tl-row"><div class="tl-h muted${S.tlCursorLane === 'trig' ? ' cur' : ''}" data-trackhead="trig">◆ Triggers</div><div class="tl-lane trig${S.tlCursorLane === 'trig' ? ' curlane' : ''}" data-lane="trig">${after}${cur}${trig}<div class="head"></div></div></div>
    ${lanes}<div class="tl-box" hidden></div></div></div>`;
}
// When clips land on each other: a clip that overlaps only the end (or only the start) of
// another on its track crossfades with it over the overlap (see xfadePrev). Otherwise
// Ableton's rule: the clip underneath is cut back, split around the new one, or (fully
// covered) removed. Holding clips only lose their start.
function resolveOverlaps(t, moved) {
  const drop = new Set(), add = [];
  for (const m of moved) {
    if (!isLight(m) || !m.len) continue;
    const s = m.t, e = m.t + m.len;
    for (const o of t.cues) {
      if (o === m || moved.has(o) || drop.has(o) || !isLight(o) || (o.track || 0) !== (m.track || 0)) continue;
      const oe = o.len ? o.t + o.len : null;
      if (o.t >= s && o.t < e) {
        if (o.t > s && (oe == null || oe > e)) m.out = 0;   // m's end over o's start: crossfade
        else if (oe == null) o.t = e;
        else if (oe > e) { o.len = oe - e; o.t = e; }
        else drop.add(o);
      } else if (o.t < s && oe != null && oe > s) {
        if (oe > e) { add.push({ ...structuredClone(o), t: e, len: oe - e, fade: 0 }); o.len = s - o.t; o.out = 0; }
        else o.out = 0;   // m's start over o's end: crossfade
      }
    }
  }
  t.cues = t.cues.filter((c) => !drop.has(c)).concat(add);
  syncXfades(t);
  for (const c of t.cues) if (c.len) { c.fade = Math.min(c.fade || 0, c.len); if (c.out) c.out = Math.min(c.out, c.len - c.fade); }
  return drop.size;
}
// Crossfade: a clip that starts inside the clip before it on its track (and ends after it)
// fades in over the overlap, from that clip's look, so its fade = the overlap. The
// controller needs nothing for this: the later cue takes the track over, and the earlier
// clip's end is then ignored (lastT in Show.cpp, pb.last in the mock).
function xfadePrev(t, c) {
  if (!isLight(c)) return null;
  const tr = c.track || 0, ce = c.len ? c.t + c.len : Infinity;
  let best = null;
  for (const o of t.cues) {
    if (o === c || !o.len || !isLight(o) || (o.track || 0) !== tr) continue;
    const oe = o.t + o.len;
    if (o.t < c.t && oe > c.t && oe < ce && (!best || oe > best.t + best.len)) best = o;
  }
  return best;
}
// The clip that crossfades out of c, if any.
function xfadeNext(t, c) {
  if (!isLight(c) || !c.len) return null;
  const tr = c.track || 0, ce = c.t + c.len;
  return t.cues.find((x) => x !== c && isLight(x) && (x.track || 0) === tr && x.t > c.t && x.t < ce && xfadePrev(t, x) === c) || null;
}
// Keeps every crossfade's fade equal to its overlap (after moving, resizing, typing a time).
function syncXfades(t) {
  for (const c of t.cues) {
    const a = xfadePrev(t, c);
    if (!a) continue;
    c.fade = a.t + a.len - c.t;
    a.out = 0;
  }
}
// Copy of cues shifted by dt (and dl tracks), not yet in the timeline.
const cloneCues = (cues, dt, dl = 0) => cues.map((c) => { const n = { ...structuredClone(c), t: c.t + dt }; if (isLight(c)) n.track = (c.track || 0) + dl; return n; });
// Time span of some cues: [first start, last end] (a holding clip counts as 1 s).
function cueSpan(t, cues) {
  const a = Math.min(...cues.map((c) => c.t));
  return [a, Math.max(...cues.map((c) => (isLight(c) ? cueEnd(t, c, c.t + 1000) : c.t + 100)))];
}
function pasteCues(t, src, at, dl) {
  const [a] = cueSpan(t, src);
  const copies = cloneCues(src, at - a, dl);
  t.cues.push(...copies);
  resolveOverlaps(t, new Set(copies));
  tlSelect(t, copies);
  return copies;
}
// Fixture picker of a track, right under the tracks: what is in it (chips in effect order,
// drag to reorder, ✕ to remove), groups as one-click buttons, and a map or list to pick
// from with a search box (Enter adds every match).
function trackFixturesHtml(t, r) {
  const p = P(), tr = t.tracks[r];
  const on = new Set(trackFxIds(tr)), viaGroup = new Set(trackFxIds({ ...tr, fixtures: [] }));
  // Where to pick: a map (the one chosen here, else the Map page's) or -1 = the list.
  const mi = S.trackMap === -1 || !p.maps.length ? -1 : Math.min(S.trackMap ?? S.sel.map ?? 0, p.maps.length - 1), m = p.maps[mi];
  const q = (S.trackSearch || '').trim().toLowerCase(), hit = (f) => !q || f.name.toLowerCase().includes(q) || String(f.id) === q;
  const mark = (f) => (on.has(f.id) ? ' in' : ' out') + (viaGroup.has(f.id) && !tr.fixtures.includes(f.id) ? ' via' : '') + (hit(f) ? '' : ' nohit');
  let icons = true;
  const chip = (f) => `<button class="sc-chip${mark(f)}" data-trackfx="${f.id}" title="${esc(f.name)} · ${f.universe}.${f.address}${viaGroup.has(f.id) && !tr.fixtures.includes(f.id) ? ' · in the track through a group' : on.has(f.id) ? ' · in this track: click to remove' : ' · click to add'}"><span class="dot">${icons ? fxIcon(f) : ''}</span>${esc(f.name)}</button>`;
  const chips = (list) => { icons = list.length <= 200; return list.map(chip).join(''); };
  // What is in the track, in effect order (i): its own fixtures, then its groups' (trackFixtureIds).
  const own = tr.fixtures.map(fixture).filter(Boolean);
  const inTrack = [
    ...own.map((f) => `<span class="tk-chip" draggable="true" data-tkown="${f.id}" title="${esc(f.name)} · drag to change the order (effects number fixtures in this order)"><span class="dot">${own.length <= 200 ? fxIcon(f) : ''}</span>${esc(f.name)}<button class="x" data-tkdel="${f.id}" title="Remove">✕</button></span>`),
    ...tr.groups.map((gid) => p.groups.find((g) => g.id === gid)).filter(Boolean).map((g) => `<span class="tk-chip grp" title="Group '${esc(g.name)}': its fixtures come after the track's own ones"><b>▦</b>${esc(g.name)} <span class="muted">${g.fixtures.length}</span><button class="x" data-tkgrpdel="${g.id}" title="Remove the group">✕</button></span>`),
  ].join('');
  let pickArea;
  if (m) {
    const items = m.items.filter((it) => fixture(it.fixture)), placed = new Set(items.map((it) => it.fixture));
    const rest = p.fixtures.filter((f) => !placed.has(f.id));
    pickArea = items.length ? `<div class="map-wrap"><div class="mini-map tk-map${items.length > 40 ? ' dense' : ''}" id="trackMap" style="aspect-ratio:${m.aspect}">${m.background ? `<img src="/media/${encodeURIComponent(m.background)}" alt="" draggable="false">` : ''}${mapShapesHtml(m)}
      ${items.map((it) => { const f = fixture(it.fixture); return mapDotHtml(f, it, mark(f) + (on.has(f.id) ? ' sel' : ''), m.labels !== false, 'data-trackfx-map'); }).join('')}<div class="band" hidden></div></div></div>
      ${rest.length ? `<div class="sc-chips"><span class="muted">Not on this map:</span>${chips(rest)}</div>` : ''}`
      : `<p class="muted">Map '${esc(m.name)}' has no fixtures on it yet - place them on the Map page, or pick from the list.</p>`;
  } else pickArea = `<div class="sc-chips sc-all tk-list">${chips(p.fixtures) || '<span class="muted">No fixtures yet - add them on the Fixtures page.</span>'}</div>`;
  const pick = `<select id="tkWhere" title="Where to pick fixtures">${p.maps.map((x, i) => `<option value="${i}"${i === mi ? ' selected' : ''}>Map: ${esc(x.name)} (${x.items.filter((it) => on.has(it.fixture)).length}/${x.items.length})</option>`).join('')}<option value="-1"${m ? '' : ' selected'}>List of all fixtures</option></select>`;
  return `<div class="track-fx">
    <div class="row"><b>Fixtures of track '${esc(tr.name)}'</b><span class="muted">${on.size ? `${on.size} fixture${on.size > 1 ? 's' : ''}` : ''}</span>
      <span style="margin-left:auto"></span>
      ${on.size ? '<button class="btn small ghost" id="tkClear" title="Take every fixture and group out of this track">Clear</button>' : ''}
      <button class="btn small" data-trackedit="${r}">Done</button></div>
    <div class="tk-in">${inTrack || '<span class="muted">None yet: scenes play on the whole rig, colours and effects do nothing. Pick fixtures below.</span>'}</div>
    ${p.groups.length ? `<div class="sc-groups"><span class="muted">Groups:</span>${p.groups.map((g) => `<button class="sc-grp${tr.groups.includes(g.id) ? ' on' : ''}" data-trackgrp="${g.id}" title="${tr.groups.includes(g.id) ? 'Take the group out of the track' : 'Put the whole group in the track (it follows later changes to the group)'}">${esc(g.name)} <span class="muted">${g.fixtures.length}</span></button>`).join('')}</div>` : ''}
    <div class="row map-tools">${pick}
      <input type="search" id="tkSearch" placeholder="Find fixtures… (Enter adds all found)" value="${esc(S.trackSearch || '')}" style="min-width:220px">
      <button class="btn small" id="tkAddHits" title="Add every fixture that matches the search">Add found</button>
      <button class="btn small ghost" id="tkDelHits" title="Remove every fixture that matches the search">Remove found</button>
      ${m && m.items.length ? mapZoomHtml(`track:${m.id}`) : ''}</div>
    <div class="muted sc-legend"><span class="sc-key in"></span> in the track <span class="sc-key out"></span> not in it · click to add or remove${m ? ' · drag an area on the map (only those) · Shift/Ctrl+drag adds an area · Alt+drag removes one' : ' · Shift+click adds a range'}</div>
    ${pickArea}</div>`;
}
// Editor for the selected cue.
function cueEditorHtml(t) {
  const c = t.cues[S.sel.cue];
  if (!c) return '<p class="muted">Click a block to edit its cue.</p>';
  const p = P(), base = `timelines.${S.sel.timeline}.cues.${S.sel.cue}`;
  const kind = cueKind(c);
  const tr = t.tracks[c.track || 0], fx = tr ? trackFxIds(tr) : [];
  const noFx = '<span class="bad">This track has no fixtures - choose them with the button on the track.</span>';
  let what = '', prevHtml = '';
  if (kind === 'trigger') {
    const h = findTrigs(String(c.trigger)), cur = h.length === 1 ? h[0] : null;
    what = `<label>Trigger</label><div class="row nowrap"><select data-p="${base}.trigger" data-r class="${cur ? '' : 'invalid'}" style="flex:1">
        ${cur ? '' : `<option selected value="${esc(String(c.trigger))}">${h.length > 1 ? 'ambiguous' : 'unknown'}: ${esc(String(c.trigger))}</option>`}
        ${p.triggers.filter((x) => x.type !== 'comment').map((x) => `<option value="${esc(x.name)}"${x === cur ? ' selected' : ''}>#${x.id} ${esc(x.name)}</option>`).join('')}</select>
        ${cur ? `<a href="#" data-goto-trigger="${cur.id}" class="muted">open →</a>` : ''}</div>`;
  } else {
    if (kind === 'preset') what = `
      <label>Intensity</label><div class="row nowrap"><label class="muted"><input type="checkbox" data-cueset="dim"${c.dim != null ? ' checked' : ''}> set</label>
        ${c.dim != null ? `<input type="range" min="0" max="100" data-p="${base}.dim" data-t="num" value="${c.dim}" oninput="this.nextElementSibling.value=this.value" style="flex:1"><input type="number" min="0" max="100" data-p="${base}.dim" data-t="num" value="${c.dim}" style="width:64px" data-r><span class="muted">%</span>` : '<span class="muted">left as it is</span>'}</div>
      <label>Colour</label><div><label class="muted"><input type="checkbox" data-cueset="color"${c.color != null ? ' checked' : ''}> set</label>
        ${c.color != null ? colorWheelHtml('cue', c.color) : '<span class="muted"> left as it is</span>'}</div>
      <label></label><span class="muted">${fx.length ? `For the ${fx.length} fixture(s) of this track. RGB without a dimmer channel is scaled by the intensity; RGBW gets white = the common part of R, G and B.` : noFx}</span>`;
    else if (kind === 'effect') {
      const e = p.effects.find((x) => x.id === c.effect), prog = e && fxProg(e);
      const pv = c.params || {};
      what = `<label>Effect</label><div class="row nowrap"><select data-p="${base}.effect" data-t="num" data-r style="flex:1">${e ? '' : `<option selected value="${c.effect}">missing effect ${c.effect}</option>`}${p.effects.map((x) => `<option value="${x.id}"${x.id === c.effect ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
          <a href="#" data-goto-effect="${c.effect}" class="muted">edit →</a></div>
        <label>Level</label><div class="row nowrap"><input type="range" min="0" max="100" data-p="${base}.dim" data-t="num" value="${c.dim ?? 100}" oninput="this.nextElementSibling.value=this.value" style="flex:1"><input type="number" min="0" max="100" data-p="${base}.dim" data-t="num" value="${c.dim ?? 100}" style="width:64px" data-r><span class="muted">%</span></div>
        ${prog?.error ? `<label></label><span class="bad">The effect has an error (line ${prog.error.line}: ${esc(prog.error.msg)})</span>` : ''}
        ${prog && !prog.error ? prog.params.map((q) => {
          const set = pv[q.name] != null, v = set ? pv[q.name] : q.def;
          const reset = set ? `<button class="btn small ghost" data-fxreset="${esc(q.name)}" title="Back to the effect's default">default</button>` : '<span class="muted fx-def">default</span>';
          return q.type === 'color'
            ? `<label>${esc(q.name)}</label><div>${fxParamNote(q)}${reset}${colorWheelHtml('fxp:' + q.name, v)}</div>`
            : `<label>${esc(q.name)}</label><div><div class="row nowrap"><input type="range" min="${q.min}" max="${q.max}" step="${(q.max - q.min) / 200}" data-fxparam="${esc(q.name)}" value="${v}" style="flex:1"><span class="mono fx-pv">${(+v).toFixed(2)}</span>${reset}</div>${fxParamNote(q)}</div>`;
        }).join('') : ''}
`;
      prevHtml = `<div class="cue-prev" id="cueFxPrev">${fx.length ? cuePreviewHtml(tr, cuePrevKey(t, c.track)) : `<b>Preview</b><p>${noFx}</p>`}</div>`;
    } else what = `<label>Scene</label><select data-p="${base}.scene" data-t="num" data-r>${opts(p.scenes, c.scene)}</select>
      <label></label><span class="muted">${fx.length ? `Only the channels of this track's ${fx.length} fixture(s) are played.` : 'Track without fixtures: the whole scene is played.'}</span>`;
    what = `<label>Length (s)</label><div class="row nowrap">${c.len ? `<input type="number" min="0.1" step="0.1" data-p="${base}.len" data-t="sec" value="${c.len / 1000}" style="width:90px" data-r>` : ''}
        <label class="muted" title="Without a length the clip holds until the next cue on its track (Pharos style). With one, the track is empty after it: its fixtures show what is underneath."><input type="checkbox" data-cuehold${c.len ? '' : ' checked'}> hold until the next cue</label></div>
      ${what}`;
    const xa = xfadePrev(t, c), xn = xfadeNext(t, c);
    what += xa
      ? `<label>Crossfade (s)</label><div class="row nowrap"><input type="number" min="0" step="0.1" data-xfade value="${(c.fade || 0) / 1000}" style="width:90px" title="How long this clip overlaps the one before it: it fades in from that clip's look over the overlap"><span class="muted">from ${esc(cueLabel(xa, t))}</span></div>`
      : `<label>Fade in (s)</label><input type="number" min="0" step="0.1" data-p="${base}.fade" data-t="sec" value="${(c.fade || 0) / 1000}" data-r>`;
    what += `
      ${xn ? `<label>Fade out (s)</label><span class="muted">crossfades into ${esc(cueLabel(xn, t))} (${((c.t + c.len - xn.t) / 1000).toFixed(1)} s)</span>` : c.len ? `<label>Fade out (s)</label><input type="number" min="0" step="0.1" data-p="${base}.out" data-t="sec" value="${(c.out || 0) / 1000}" data-r title="Fades to what is underneath, ending at the end of the clip">` : ''}
      <label>Crossfade path</label><div class="row nowrap"><select data-p="${base}.path" data-r>${PATHS.map(([v, n]) => `<option value="${v}"${(c.path || 'linear') === v ? ' selected' : ''}>${n}</option>`).join('')}</select><span class="muted">${pathCurve(c.path || 'linear')}</span></div>`;
  }
  return `<div class="cue-ed"><div class="row"><b>Cue at ${(c.t / 1000).toFixed(1)} s</b>
      <div class="seg" style="margin-left:auto">${[['preset', 'Preset'], ['effect', '✦ Effect'], ['scene', 'Scene'], ['trigger', '◆ Trigger']].map(([k, n]) => `<button class="${kind === k ? 'on' : ''}" data-cuekind="${k}">${n}</button>`).join('')}</div>
      <button class="btn small ghost" data-del="${base}">Delete cue</button></div>
    <div class="cue-body"><div class="form">
      <label>Time (s)</label><input type="number" min="0" step="0.1" data-p="${base}.t" data-t="sec" value="${c.t / 1000}" data-r>
      ${kind === 'trigger' ? '' : `<label>Track</label><select data-p="${base}.track" data-t="num" data-r>${t.tracks.map((x, r) => `<option value="${r}"${(c.track || 0) === r ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`}
      ${what}</div>${prevHtml}</div></div>`;
}
// Small SVG of a crossfade path for the trigger/timeline editors.
function pathCurve(path) {
  const ease = KDModel.EASE[path] || KDModel.EASE.linear;
  const pts = Array.from({ length: 21 }, (_, i) => `${i * 2},${20 - ease(i / 20) * 16}`).join(' ');
  return `<svg width="40" height="22" viewBox="0 -2 40 24"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
}
// BrightSign zones that play their video in step with this timeline ("Follow a timeline" on the
// BrightSign tab, drivers[].follow, Drivers::follow), with the video's length as the kdlink plugin
// (v12) reports it per presentation state, and a button to make the timeline that long.
function tlFollowHtml(t) {
  const rows = [];
  for (const d of P().drivers || []) {
    if (d.type !== 'brightsign') continue;
    for (const f of d.follow || []) {
      if (f.timeline !== t.id) continue;
      const st = S.status?.drivers?.find((x) => x.id === d.id && x.type === d.type);
      const want = String(f.file || '').toLowerCase(), zn = bsZoneNo(st, f.zone);
      // The file or state name as typed, in that zone first (the same name can be in two zones).
      const match = (s) => (s.n || '').toLowerCase() === want || (s.f || '').toLowerCase() === want;
      const s = (st?.states || []).find((x) => match(x) && (!zn || x.z === zn)) || (st?.states || []).find(match);
      const off = Math.round((+f.offset || 0) * 1000), file = s?.f && s.f !== f.file ? `${f.file} (${s.f})` : f.file || '?';
      let len;
      if (s?.ms > 0) {
        // The video runs at timeline position + offset, so it ends at its length − offset.
        const fit = Math.max(100, s.ms - off);
        len = `<span class="muted">video ${fmtTime(s.ms)}${off ? ` · offset ${off > 0 ? '+' : ''}${off / 1000} s` : ''}</span>
          ${Math.abs(fit - (t.length || 0)) < 50 ? '<span class="tag mon-ok" title="The timeline is as long as the video">✓ same length</span>'
            : `<button class="btn small" data-tlvidlen="${fit}" title="Set the timeline length to ${(fit / 1000).toFixed(2)} s (the video${off ? ' minus the offset' : ''}); now ${((t.length || 0) / 1000).toFixed(2)} s">Length = video (${(fit / 1000).toFixed(1)} s)</button>`}`;
      } else {
        len = `<span class="muted">${!st?.online ? 'video length: player not online' : !st?.states ? 'video length unknown: needs the KD plugin in the presentation'
          : !s ? `'${esc(f.file || '')}' is not a state or file of the presentation` : s.f && /\.(png|jpe?g|bmp|gif)$/i.test(s.f) ? 'a picture has no length' : 'video length unknown: needs kdlink v12 (download the plugin again and publish)'}</span>`;
      }
      rows.push(`<div class="row tl-follow"><span title="This video plays in step with the timeline: start, pause, jump, scrub">🎬</span>
        <a href="#" data-goto-devices="brightsign" title="Open the BrightSign tab (Follow a timeline)">BrightSign ${esc(d.name)}</a>
        <span>zone <b>${esc(f.zone || '?')}</b> follows with <b>${esc(file)}</b></span>${len}</div>`);
    }
  }
  return rows.join('');
}
views.timelines.after = () => {
  const grid = $('#tlGrid');
  if (!grid) return;
  const p = P(), t = p.timelines[S.sel.timeline];
  const len = +grid.dataset.len, pxs = +grid.dataset.pxs, snapMs = tlSnapMs(pxs);
  const sc = $('#tlScroll'), sel = tlSelection(t);
  // Keep the scroll position over re-renders; with "fit" follow the width of the page.
  sc.scrollLeft = S.tlScroll || 0;
  sc.addEventListener('scroll', () => { S.tlScroll = sc.scrollLeft; });
  const viewW = sc.clientWidth - TL_HEAD - 2;
  if (Math.abs(viewW - (S.tlViewW || 0)) > 2) { S.tlViewW = viewW; if (!S.tlZoom) return render(); }
  const lanes = $$('[data-lane]', grid), ruler = $('[data-ruler]', grid);
  const msAt = (x) => { const r = ruler.getBoundingClientRect(); return ((x - r.left) / r.width) * len; };
  // Snap to the grid; Alt held = no snap (10 ms), like Ableton.
  const snap = (ms, ev) => Math.max(0, ev.altKey || !snapMs ? Math.round(ms / 10) * 10 : Math.round(ms / snapMs) * snapMs);
  const laneAt = (y) => lanes.find((l) => { const r = l.getBoundingClientRect(); return y >= r.top && y <= r.bottom; });
  const laneEl = (c) => lanes.find((l) => l.dataset.lane === (isLight(c) ? String(c.track || 0) : 'trig'));
  const pctOf = (ms) => (ms / len) * 100 + '%';
  const trackCues = (r, not) => t.cues.filter((x) => isLight(x) && (x.track || 0) === r && !not.has(x));
  let selectUi = () => render();   // set further down, once the editor wiring exists
  const markSel = () => $$('[data-cue]', grid).forEach((b) => b.classList.toggle('sel', sel.has(t.cues[+b.dataset.cue])));
  const newKind = (r) => (trackFxIds(t.tracks[r]).length ? 'preset' : 'scene');
  const info = (msg) => { $('#tlInfo').textContent = msg; };   // live numbers while dragging
  // Redraws one clip after its level or colour changed (without a re-render, while dragging).
  const refreshBlk = (el, c) => {
    const end = cueEnd(t, c, len);
    if (isPreset(c)) { el.style.setProperty('--solid', presetCss(c)); el.style.setProperty('--ba', c.dim != null ? 0.25 + (c.dim / 100) * 0.6 : 0.6); }
    el.innerHTML = blkInner(t, c, end);
    paintClip(t, c, el, end);
  };
  $$('.blk', grid).forEach((el) => { const c = t.cues[+el.dataset.cue]; paintClip(t, c, el, cueEnd(t, c, len)); });
  // Clips and trigger cues. Body: click selects (Shift/Ctrl+click adds), drag moves the
  // selection in time and to other tracks (Ctrl+drag copies). Edges change start/length,
  // the small squares at the top the fade in / fade out.
  $$('[data-cue]', grid).forEach((el) => el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const i = +el.dataset.cue, c = t.cues[i], mode = e.target.dataset.h || 'move';
    const add = e.shiftKey || e.ctrlKey || e.metaKey, wasSel = sel.has(c);
    if (!wasSel) { if (!add) sel.clear(); sel.add(c); markSel(); }
    const group = mode === 'move' ? [...sel] : [c];
    const orig = new Map(group.map((x) => [x, { t: x.t, track: x.track || 0, len: x.len, fade: x.fade || 0, out: x.out || 0 }]));
    const o = orig.get(c), end0 = cueEnd(t, c, len), ms0 = msAt(e.clientX);
    const xa = mode === 'fade' ? xfadePrev(t, c) : null, xaEl = xa && grid.querySelector(`[data-cue="${t.cues.indexOf(xa)}"]`);
    const others = new Set(group);
    let moved = false;
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) < 4) return;
      moved = true;
      const at = msAt(ev.clientX);
      if (mode === 'move') {
        let dt = snap(o.t + at - ms0, ev) - o.t;
        dt = Math.max(dt, -Math.min(...group.map((x) => orig.get(x).t)));
        const l = laneAt(ev.clientY);
        let dl = isLight(c) && l && l.dataset.lane !== 'trig' ? +l.dataset.lane - o.track : 0;
        for (const x of group) if (isLight(x)) dl = Math.max(-orig.get(x).track, Math.min(t.tracks.length - 1 - orig.get(x).track, dl));
        for (const x of group) {
          const ox = orig.get(x), b = grid.querySelector(`[data-cue="${t.cues.indexOf(x)}"]`);
          x.t = ox.t + dt;
          if (isLight(x)) x.track = ox.track + dl;
          b.style.left = pctOf(x.t);
          b.style.transform = isLight(x) && dl ? `translateY(${laneEl(x).offsetTop - laneEl({ track: ox.track }).offsetTop}px)` : '';
        }
        lanes.forEach((x) => x.classList.toggle('drop', !!dl && group.some((g) => isLight(g) && x.dataset.lane === String(g.track))));
        info(`${(c.t / 1000).toFixed(2)} s${dt ? ` (${dt > 0 ? '+' : ''}${(dt / 1000).toFixed(2)} s)` : ''}${ev.ctrlKey || ev.metaKey ? ' · copy' : ''}`);
        return;
      }
      if (!isLight(c)) return;
      if (mode === 'level') {
        const b = el.getBoundingClientRect();
        c.dim = Math.max(0, Math.min(100, Math.round((1 - (ev.clientY - b.top) / b.height) * 100)));
        refreshBlk(el, c);
        info(`level ${c.dim}%`);
        return;
      }
      const r = o.track;
      if (mode === 'right') {
        // Into the next clip on the track, which then crossfades in over the overlap, up to
        // just before that clip's end (it is not pushed away).
        const nxs = trackCues(r, others).filter((x) => x.t > o.t);
        const lim = Math.min(Infinity, ...nxs.map((x) => cueEnd(t, x, x.t + 60000) - 100));
        c.len = Math.max(100, Math.min(lim, snap(at, ev)) - o.t);
      } else if (mode === 'left') {
        // Back into the clip before it (crossfade over the overlap), to just after its start;
        // to just before its own end.
        const prevT = Math.max(0, ...trackCues(r, others).filter((x) => x.t < o.t).map((x) => x.t + 100));
        const end = o.len ? o.t + o.len : end0;
        c.t = Math.max(prevT, Math.min(end - 100, snap(at, ev)));
        if (o.len) c.len = end - c.t;
      } else if (mode === 'fade') {
        const span = cueEnd(t, c, len) - c.t;
        c.fade = Math.max(0, Math.min(span - (c.out || 0), Math.round((at - c.t) / (ev.altKey ? 10 : 100)) * (ev.altKey ? 10 : 100)));
        // A crossfade's fade is its overlap: the clip before it ends where the fade does.
        if (xa) {
          xa.len = Math.max(100, c.t + c.fade - xa.t);   // fade 0: they just meet
          if (xaEl) { xaEl.style.width = pctOf(xa.len); xaEl.innerHTML = blkInner(t, xa, xa.t + xa.len); paintClip(t, xa, xaEl, xa.t + xa.len); }
        }
      } else if (mode === 'out') {
        c.out = Math.max(0, Math.min(c.len - (c.fade || 0), Math.round((c.t + c.len - at) / (ev.altKey ? 10 : 100)) * (ev.altKey ? 10 : 100)));
      }
      if (c.len) c.fade = Math.min(c.fade || 0, c.len);
      const end = cueEnd(t, c, len);
      el.style.left = pctOf(c.t);
      el.style.width = pctOf(end - c.t);
      el.innerHTML = blkInner(t, c, end);
      paintClip(t, c, el, end);
      info(`${(c.t / 1000).toFixed(2)} s${c.len ? ` · length ${(c.len / 1000).toFixed(2)} s` : ''} · fade ${((c.fade || 0) / 1000).toFixed(1)}${c.len ? ` / ${((c.out || 0) / 1000).toFixed(1)}` : ''} s`);
    };
    const up = (ev) => {
      el.removeEventListener('pointermove', move);
      if (!moved) {
        // A plain click selects just this one; Shift/Ctrl+click on a selected one deselects it.
        if (add && wasSel) sel.delete(c);
        else if (!add) { sel.clear(); sel.add(c); }
        // A second click soon after (counted here, as the lane handler does) on a holding
        // clip adds a cue at that spot: there is no empty space on its track to click.
        const now = Date.now(), last = S.lastBlkClick;
        S.lastBlkClick = { c, at: now };
        if (last && last.c === c && now - last.at < 450 && isLight(c) && !c.len) {
          S.lastBlkClick = null;
          const at = snap(msAt(ev.clientX), ev);
          if (at - c.t >= 200) return addCue(t, { t: at, track: c.track || 0 }, newKind(c.track || 0));
        }
        S.tlCursor = snap(msAt(ev.clientX), ev);
        S.tlCursorLane = isLight(c) ? c.track || 0 : 'trig';
        tlSelect(t, [...sel], sel.has(c) ? c : null);
        return selectUi();
      }
      let land = group;
      if (mode === 'move' && (ev.ctrlKey || ev.metaKey)) {
        // Ctrl+drag: copies land there, the originals go back.
        land = group.map((x) => structuredClone(x));
        for (const x of group) { x.t = orig.get(x).t; if (isLight(x)) x.track = orig.get(x).track; }
        t.cues.push(...land);
      }
      const gone = resolveOverlaps(t, new Set(land));
      if (gone) toast(`${gone} clip${gone > 1 ? 's' : ''} underneath removed (Ctrl+Z to undo)`);
      tlSelect(t, land, land[group.indexOf(c)]);
      markDirty();
      render();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up, { once: true });
  }));
  // Empty lane: click puts the cursor there (for paste, split, insert) and deselects,
  // drag draws a box that selects clips, double-click adds a clip.
  lanes.forEach((lane) => lane.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('[data-cue]')) return;
    e.preventDefault();
    lane.setPointerCapture(e.pointerId);
    const box = $('.tl-box', grid), g0 = grid.getBoundingClientRect();
    const keep = e.shiftKey || e.ctrlKey ? new Set(sel) : new Set();
    let moved = false;
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) < 5) return;
      moved = true;
      const x0 = Math.min(e.clientX, ev.clientX), x1 = Math.max(e.clientX, ev.clientX);
      const y0 = Math.min(e.clientY, ev.clientY), y1 = Math.max(e.clientY, ev.clientY);
      const z = uiZoom();
      Object.assign(box.style, { left: (x0 - g0.left) / z + 'px', top: (y0 - g0.top) / z + 'px', width: (x1 - x0) / z + 'px', height: (y1 - y0) / z + 'px' });
      box.hidden = false;
      const a = msAt(x0), b = msAt(x1);
      const inLanes = new Set(lanes.filter((l) => { const r = l.getBoundingClientRect(); return r.bottom >= y0 && r.top <= y1; }).map((l) => l.dataset.lane));
      sel.clear();
      for (const c of keep) sel.add(c);
      for (const c of t.cues) {
        const ln = isLight(c) ? String(c.track || 0) : 'trig';
        if (inLanes.has(ln) && c.t <= b && (isLight(c) ? cueEnd(t, c, len) : c.t + 1) >= a) sel.add(c);
      }
      markSel();
    };
    const up = (ev) => {
      lane.removeEventListener('pointermove', move);
      box.hidden = true;
      if (moved) { tlSelect(t, [...sel]); return selectUi(); }
      const at = snap(msAt(ev.clientX), ev), now = Date.now(), last = S.lastLaneClick;
      S.lastLaneClick = { lane: lane.dataset.lane, at: now, x: ev.clientX };
      if (last && last.lane === lane.dataset.lane && now - last.at < 450 && Math.abs(last.x - ev.clientX) < 8) {
        S.lastLaneClick = null;
        if (lane.dataset.lane === 'trig') return addCue(t, { t: at }, 'trigger');
        const r = +lane.dataset.lane;
        return addClipAt(t, r, at, newKind(r));
      }
      S.tlCursor = at;
      S.tlCursorLane = lane.dataset.lane === 'trig' ? 'trig' : +lane.dataset.lane;
      if (!keep.size) tlSelect(t, []);
      selectUi();
    };
    lane.addEventListener('pointermove', move);
    lane.addEventListener('pointerup', up, { once: true });
  }));
  // Ruler: click/drag puts the cursor there; the end marker sets the timeline length.
  ruler.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    ruler.setPointerCapture(e.pointerId);
    const endm = e.target.classList.contains('tl-endm');
    const move = (ev) => {
      const at = snap(msAt(ev.clientX), ev);
      if (endm) { t.length = Math.max(100, at); e.target.style.left = pctOf(t.length); info(`length ${(t.length / 1000).toFixed(2)} s`); }
      else {
        S.tlCursor = at; $$('.tl-cur', grid).forEach((x) => (x.style.left = pctOf(at)));
        // Scrubbing: a paused timeline follows the cursor while you drag (the lights, and a video that follows it).
        const pb = tlPlayback(t);
        if (pb && pb.paused && !pb.ended && Date.now() - (S.tlScrubAt || 0) > 150) { S.tlScrubAt = Date.now(); tlSeek(t, at); }
      }
    };
    move(e);
    ruler.addEventListener('pointermove', move);
    ruler.addEventListener('pointerup', () => {
      ruler.removeEventListener('pointermove', move);
      if (endm) markDirty();
      // While it plays, the timeline jumps to where you let go.
      else { const pb = tlPlayback(t); if (pb && pb.paused && !pb.ended) tlSeek(t, S.tlCursor); else if (pb && !pb.ended) tlPlayFrom(t, S.tlCursor); }
      render();
    }, { once: true });
  });
  // Zoom: Ctrl+wheel around the mouse, or the buttons (around the middle).
  const zoomTo = tlZoomTo;
  sc.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomTo(pxs * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX);
  }, { passive: false });
  $$('[data-tlzoom]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.tlzoom === 'fit') { S.tlZoom = null; S.tlScroll = 0; return render(); }
    zoomTo(pxs * +b.dataset.tlzoom);
  }));
  // Clicking a track's name area makes it the current track (for + Cue and paste). No
  // re-render, so clicking into the name field still lets you type.
  $$('[data-trackhead]', grid).forEach((h) => h.addEventListener('pointerdown', () => {
    const v = h.dataset.trackhead;
    S.tlCursorLane = v === 'trig' ? 'trig' : +v;
    $$('[data-trackhead]', grid).forEach((x) => x.classList.toggle('cur', x === h));
    lanes.forEach((l) => l.classList.toggle('curlane', l.dataset.lane === v));
  }));
  $$('[data-tlpause]').forEach((b) => b.addEventListener('click', () => {
    const pb = tlPlayback(t);
    if (!pb) return toast(`Timeline ${t.id} is not running`, true);
    tlPause(t, !pb.paused);
  }));
  $$('[data-tlplay]').forEach((b) => b.addEventListener('click', () => tlPlayFrom(t, S.tlCursor || 0)));
  $('#tlLive').addEventListener('click', () => {
    S.tlLive = !S.tlLive;
    try { localStorage.setItem('kd.tlLive', S.tlLive ? '1' : '0'); } catch { /* private mode */ }
    if (!S.tlLive) toast('Live editing off: changes reach the controller when you save');
    render();
  });
  // Several times a second (also while dragging a clip): send the timeline when it changed.
  pagePoll('tlLive', () => tlLiveSync(t), 250);
  // The players' video lengths arrive with the status (maybe after this page was drawn).
  // Redrawn only when it changed (comparing innerHTML never matches: the browser rewrites it).
  pagePoll('tlFollow', () => { const el = $('#tlFollow'), h = tlFollowHtml(t); if (el && el.dataset.html !== h) { el.innerHTML = h; el.dataset.html = h; } }, 1000);
  $('#tlFollow').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tlvidlen]');
    if (!b) return;
    t.length = +b.dataset.tlvidlen;
    const past = t.cues.filter((c) => c.t >= t.length).length;
    markDirty();
    render();
    toast(`Timeline length ${(t.length / 1000).toFixed(2)} s = the video${past ? ` · ${past} cue(s) now start after the end` : ''}`, !!past);
  });
  $$('[data-tlsnap]').forEach((b) => b.addEventListener('click', () => { S.tlSnap = b.dataset.tlsnap; render(); }));
  $$('[data-trackedit]').forEach((b) => b.addEventListener('click', () => { const r = +b.dataset.trackedit; S.trackEdit = S.trackEdit === r ? null : r; S.trackSearch = ''; render(); }));
  $$('[data-trackdel]').forEach((b) => b.addEventListener('click', () => {
    const r = +b.dataset.trackdel, n = t.cues.filter((c) => c.trigger == null && (c.track || 0) === r).length;
    if (!confirm(`Delete track '${t.tracks[r].name}'${n ? ` and its ${n} cue(s)` : ''}?`)) return;
    t.cues = t.cues.filter((c) => c.trigger != null || (c.track || 0) !== r);
    t.cues.forEach((c) => { if ((c.track || 0) > r) c.track--; });
    t.tracks.splice(r, 1);
    S.trackEdit = null;
    S.sel.cue = -1;
    markDirty();
    render();
  }));
  // Track fixtures picker (trackFixturesHtml).
  const tr = t.tracks[S.trackEdit];
  if (tr) {
    const viaGroup = () => new Set(trackFxIds({ ...tr, fixtures: [] }));
    const setOwn = (ids) => { const g = viaGroup(); tr.fixtures = [...new Set(ids)].filter((id) => !g.has(id)); markDirty(); render(); };
    const toggleFx = (id) => {
      if (!tr.fixtures.includes(id) && viaGroup().has(id)) return toast('This fixture is in the track through a group', true);
      setOwn(tr.fixtures.includes(id) ? tr.fixtures.filter((x) => x !== id) : [...tr.fixtures, id]);
    };
    // List chips: click toggles, Shift+click adds everything between the last click and this one.
    const listIds = () => $$('[data-trackfx]').filter((el) => !el.classList.contains('nohit')).map((el) => +el.dataset.trackfx);
    $$('[data-trackfx]').forEach((el) => el.addEventListener('click', (e) => {
      const id = +el.dataset.trackfx, ids = listIds(), a = ids.indexOf(S.tkLast), b = ids.indexOf(id);
      S.tkLast = id;
      if (e.shiftKey && a >= 0 && b >= 0) return setOwn([...tr.fixtures, ...ids.slice(Math.min(a, b), Math.max(a, b) + 1)]);
      toggleFx(id);
    }));
    $$('[data-trackfx-map]').forEach((el) => el.addEventListener('click', () => toggleFx(+el.dataset.trackfxMap)));
    $$('[data-tkdel]').forEach((b) => b.addEventListener('click', () => setOwn(tr.fixtures.filter((x) => x !== +b.dataset.tkdel))));
    $$('[data-tkgrpdel]').forEach((b) => b.addEventListener('click', () => { tr.groups = tr.groups.filter((x) => x !== +b.dataset.tkgrpdel); markDirty(); render(); }));
    $$('[data-trackgrp]').forEach((b) => b.addEventListener('click', () => {
      const id = +b.dataset.trackgrp;
      tr.groups = tr.groups.includes(id) ? tr.groups.filter((x) => x !== id) : [...tr.groups, id];
      // Fixtures added one by one before now come through the group: no double entries.
      const g = viaGroup();
      tr.fixtures = tr.fixtures.filter((x) => !g.has(x));
      markDirty();
      render();
    }));
    $('#tkClear')?.addEventListener('click', () => { tr.fixtures = []; tr.groups = []; markDirty(); render(); });
    $('#tkWhere')?.addEventListener('change', (e) => { S.trackMap = +e.target.value; render(); });
    // Search: filters in place while typing (no re-render); Enter / "Add found" adds the matches.
    const search = $('#tkSearch');
    if (search) {
      const match = (f, q) => f.name.toLowerCase().includes(q) || String(f.id) === q;
      const filter = () => {
        const q = search.value.trim().toLowerCase();
        S.trackSearch = search.value;
        $$('[data-trackfx], [data-trackfx-map]').forEach((el) => {
          const f = fixture(+(el.dataset.trackfx || el.dataset.trackfxMap));
          el.classList.toggle('nohit', !!q && !match(f, q));
        });
      };
      const hits = () => { const q = search.value.trim().toLowerCase(); return q ? P().fixtures.filter((f) => match(f, q)).map((f) => f.id) : []; };
      const add = () => { const h = hits(); if (!h.length) return toast('Type part of a fixture name first', true); S.tkFocus = true; setOwn([...tr.fixtures, ...h]); };
      search.addEventListener('input', filter);
      search.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); add(); }
        else if (e.key === 'Escape' && search.value) { e.preventDefault(); e.stopPropagation(); search.value = ''; filter(); }
      });
      $('#tkAddHits')?.addEventListener('click', add);
      $('#tkDelHits')?.addEventListener('click', () => { const h = new Set(hits()); if (!h.size) return toast('Type part of a fixture name first', true); setOwn(tr.fixtures.filter((x) => !h.has(x))); });
      if (S.tkFocus) { S.tkFocus = false; search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
    }
    // Drag the track's own chips to change their order (= i in effects).
    let dragId = null;
    $$('[data-tkown]').forEach((el) => {
      el.addEventListener('dragstart', (e) => { dragId = +el.dataset.tkown; e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
      el.addEventListener('dragend', () => { dragId = null; el.classList.remove('dragging'); });
      el.addEventListener('dragover', (e) => { if (dragId != null) e.preventDefault(); });
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        const to = +el.dataset.tkown;
        if (dragId == null || dragId === to) return;
        const rc = el.getBoundingClientRect(), after = e.clientX > rc.left + rc.width / 2;
        const ids = tr.fixtures.filter((x) => x !== dragId);
        ids.splice(ids.indexOf(to) + (after ? 1 : 0), 0, dragId);
        setOwn(ids);
      });
    });
  }
  // Area selection on the track's map, like the Map page. The track's own fixtures that are
  // not on this map stay; fixtures it gets through a group aren't added a second time.
  const tmap = $('#trackMap');
  if (tmap && tr) {
    const m = P().maps[Math.min(S.trackMap ?? S.sel.map ?? 0, P().maps.length - 1)];
    attachMapZoom(tmap, `track:${m.id}`);
    const onMap = new Set(m.items.map((it) => it.fixture)), before = JSON.stringify(tr.fixtures);
    const viaGroup = () => new Set(trackFxIds({ ...tr, fixtures: [] }));
    const paint = () => { const on = new Set(trackFxIds(tr)); $$('[data-trackfx-map]', tmap).forEach((n) => n.classList.toggle('sel', on.has(+n.dataset.trackfxMap))); };
    const begin = bandSelect(tmap, m.items.filter((it) => fixture(it.fixture)), () => new Set(tr.fixtures.filter((id) => onMap.has(id))),
      (s) => { const g = viaGroup(); tr.fixtures = [...tr.fixtures.filter((id) => !onMap.has(id)), ...[...s].filter((id) => !g.has(id))]; },
      paint, () => { if (JSON.stringify(tr.fixtures) !== before) markDirty(); render(); }, false);
    // Shift+drag can start on a fixture too (dense pixel maps); a plain click toggles it (above).
    $$('[data-trackfx-map]', tmap).forEach((el) => el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.button === 0 && (e.shiftKey || e.altKey)) { e.preventDefault(); begin(e, +el.dataset.trackfxMap); }
    }));
  }
  // Cue editor (wired again on its own when a click only changes the selection: selectUi).
  const wireCueEditor = () => {
  const box = $('#cueEdBox'), c = t.cues[S.sel.cue];
  if (!box || !c) return;
  $$('[data-cuekind]', box).forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.cuekind;
    if (k === 'effect' && !p.effects.length) return toast('Make an effect first (Effects page)', true);
    for (const f of ['trigger', 'dim', 'color', 'scene', 'effect', 'params']) delete c[f];
    if (k === 'trigger') { const real = p.triggers.filter((x) => x.type !== 'comment'); c.trigger = (real.find((x) => x.type === 'manual') || real[0])?.name || '1'; delete c.track; delete c.fade; delete c.path; }
    else {
      c.track ??= 0;
      c.fade ??= 1000;
      if (k === 'preset') { c.dim = 100; c.color = S.tlLastColor || '#ffffff'; }
      else if (k === 'effect') { c.effect = p.effects[0].id; c.params = {}; }
      else c.scene = p.scenes[0]?.id || 1;
    }
    markDirty();
    render();
  }));
  // Colour wheels: the preset colour, and colour parameters of an effect.
  $$('.cw', box).forEach((el) => {
    const id = el.dataset.cw;
    const get = () => (id === 'cue' ? c.color : (c.params?.[id.slice(4)] ?? fxProg(p.effects.find((e) => e.id === c.effect)).params.find((q) => q.name === id.slice(4))?.def));
    attachColorWheel(el, get(), (hex, done) => {
      if (id === 'cue') c.color = S.tlLastColor = hex;
      else { c.params = c.params || {}; c.params[id.slice(4)] = hex; }
      markDirty();
      const blk = grid.querySelector(`.blk[data-cue="${S.sel.cue}"]`);
      if (blk && id === 'cue') { blk.style.setProperty('--bc', hex); refreshBlk(blk, c); }
      if (blk && id !== 'cue') paintClip(t, c, blk, cueEnd(t, c, len));
      if (id !== 'cue') startCuePreview();
      if (done) { S.cwFocus = document.activeElement === el ? id : null; render(); }
    });
    if (S.cwFocus === id) { el.focus(); S.cwFocus = null; }
  });
  $$('[data-fxparam]', box).forEach((i) => i.addEventListener('input', () => {
    c.params = c.params || {};
    c.params[i.dataset.fxparam] = +i.value;
    i.nextElementSibling.textContent = (+i.value).toFixed(2);
    markDirty();
    startCuePreview();
    const blk = grid.querySelector(`.blk[data-cue="${S.sel.cue}"]`);
    if (blk) paintClip(t, c, blk, cueEnd(t, c, len));
  }));
  $$('[data-fxparam]', box).forEach((i) => i.addEventListener('change', () => render()));
  // Level / intensity slider: the clip follows while dragging (this runs before the binding on #main).
  $$(`.cue-ed [data-p$=".dim"]`, box).forEach((i) => i.addEventListener('input', () => {
    if (i.value === '') return;
    c.dim = Math.max(0, Math.min(100, +i.value));
    const blk = grid.querySelector(`.blk[data-cue="${S.sel.cue}"]`);
    if (blk) refreshBlk(blk, c);
    if (c.effect != null) startCuePreview();
  }));
  $$('[data-fxreset]', box).forEach((b) => b.addEventListener('click', () => { delete c.params[b.dataset.fxreset]; markDirty(); render(); }));
  // Live preview of an effect cue on the track's fixtures.
  function startCuePreview() {
    if (!c || c.effect == null) return;
    const e = p.effects.find((x) => x.id === c.effect), tr = t.tracks[c.track || 0];
    if (!e || !tr) return;
    const m = cuePreviewMap(trackFxIds(tr), cuePrevKey(t, c.track));
    runFxPreview($('#cueFxPrev'), fxProg(e), trackPreviewFixtures(tr, e), c.params || {}, (c.dim ?? 100) / 100, KDModel.effectRound(p, e), m);
  }
  $$('[data-cueprevmap]', box).forEach((el) => el.addEventListener('change', () => {
    (S.cuePrevMap ||= {})[cuePrevKey(t, c.track)] = el.value === 'strip' ? 'strip' : +el.value;
    render();
  }));
  $$('[data-cueovl]', box).forEach((el) => el.addEventListener('change', () => { setFxOverlay(el.checked); render(); }));
  startCuePreview();
  const cpv = $('#cueFxPrev .map-canvas', box);
  if (cpv) {
    attachMapResize(cpv, +cpv.dataset.aspect);
    attachMapZoom(cpv, cpv.dataset.zoomkey, $('#cueFxPrev', box));
  }
  // Crossfade length = the overlap: the clip before it ends where the fade does.
  $$('[data-xfade]', box).forEach((el) => el.addEventListener('change', () => {
    const a = xfadePrev(t, c);
    if (!a || el.value === '') return;
    const span = cueEnd(t, c, c.t + 60000) - c.t;
    a.len = Math.max(100, c.t + Math.round(Math.max(0, Math.min(span - 100, +el.value * 1000))) - a.t);
    c.fade = Math.max(0, a.t + a.len - c.t);
    markDirty();
    render();
  }));
  $$('[data-cuehold]', box).forEach((el) => el.addEventListener('change', () => {
    if (el.checked) { delete c.len; delete c.out; }
    else { c.len = Math.max(100, Math.min(cueEnd(t, c, c.t + 4000), c.t + 60000) - c.t); }
    markDirty();
    render();
  }));
  $$('[data-cueset]').forEach((el) => el.addEventListener('change', () => {
    const k = el.dataset.cueset;
    if (el.checked) c[k] = k === 'dim' ? 100 : '#ffffff';
    else delete c[k];
    if (c.dim == null && c.color == null) c.dim = 100;   // a preset sets at least one of them
    markDirty();
    render();
  }));
  };
  wireCueEditor();
  // A click that only changes the selection or the cursor: the clips' marks, the cursor line,
  // the current track, the cue list and the editor change in place, nothing else is rebuilt
  // (a full render() redrew the whole page on every click; like trigSelectUi).
  selectUi = () => {
    if (S.view !== 'timelines' || !grid.isConnected) return render();
    const play = $('[data-tlplay]');
    if (!!play !== !!S.tlCursor) return render();   // the "play from" button comes or goes
    if (play) play.textContent = `▶ from ${(S.tlCursor / 1000).toFixed(1)} s`;
    // tlSelect made a new set: carry it into the one this page's handlers hold.
    const now = tlSelection(t);
    if (now !== sel) { sel.clear(); for (const x of now) sel.add(x); S.tlSel = sel; }
    markSel();
    const curs = $$('.tl-cur', grid);
    if (S.tlCursor == null) curs.forEach((x) => x.parentNode.removeChild(x));
    else if (!curs.length) lanes.forEach((l) => l.insertAdjacentHTML('afterbegin', `<div class="tl-cur" style="left:${pctOf(S.tlCursor)}"></div>`));
    else curs.forEach((x) => (x.style.left = pctOf(S.tlCursor)));
    const lane = S.tlCursorLane == null ? null : String(S.tlCursorLane);
    $$('[data-trackhead]', grid).forEach((x) => x.classList.toggle('cur', x.dataset.trackhead === lane));
    lanes.forEach((l) => l.classList.toggle('curlane', l.dataset.lane === lane));
    info([S.tlCursor != null ? `cursor ${(S.tlCursor / 1000).toFixed(2)} s` : '', sel.size > 1 ? `${sel.size} selected` : ''].filter(Boolean).join(' · '));
    $$('[data-cuerow]').forEach((row) => row.classList.toggle('sel', +row.dataset.cuerow === S.sel.cue));
    const box = $('#cueEdBox');
    if (box) { stopPageLoop('fxPreview'); box.innerHTML = cueEditorHtml(t); wireCueEditor(); }
  };
  $$('[data-cuerow]').forEach((row) => row.addEventListener('click', (e) => { if (e.target.closest('button,input')) return; tlSelect(t, [t.cues[+row.dataset.cuerow]]); selectUi(); }));
  // Playhead: interpolate between 1 s status updates.
  const heads = $$('.head', grid);
  pageAnimation('playhead', () => {
    const ph = tlHeadPos(t);
    if (ph) {
      const left = Math.min(100, (ph.at / len) * 100) + '%';
      heads.forEach((h) => { h.style.display = 'block'; h.style.left = left; });
      // Zoomed in: keep the playhead in view while it plays (unless the mouse is busy).
      const x = (ph.at / 1000) * pxs, vw = sc.clientWidth - TL_HEAD;
      if (ph.moving && !document.querySelector('#tlGrid :active') && (x < sc.scrollLeft || x > sc.scrollLeft + vw - 20)) sc.scrollLeft = Math.max(0, x - 40);
    } else heads.forEach((h) => (h.style.display = 'none'));
  });
};
// Where the playhead of a timeline is now: { at: ms, moving } or null when not running.
// Interpolates between the 1 s status updates.
function tlHeadPos(t) {
  let pb = tlPlayback(t);
  // Just after a jump, a status sent before it would pull the playhead back: trust the
  // jump for 2 s unless the status is from after it (paused since, or running/ended near it).
  const j = S.tlJump, now = Date.now();
  if (j && j.id === t.id && now - j.at < 2000) {
    const want = j.ms + (now - j.at);
    const fresh = pb && (pb.paused ? pb.pos >= j.ms - 50 && pb.pos <= want + 50 : Math.abs(pb.pos + (now - S.statusAt) - want) <= 400);
    if (!fresh) pb = { pos: want - (now - S.statusAt) };
  }
  if (!pb) return null;
  const pos = pb.paused || pb.ended ? pb.pos : pb.pos + (now - S.statusAt);
  // A looping timeline wraps around; otherwise it holds at its end.
  const at = !t.length ? pos : t.loop ? pos % Math.max(t.length, 1) : Math.min(pos, t.length);
  return { at, moving: !pb.paused && !pb.ended && !(t.length && !t.loop && pos >= t.length) };
}
// Timeline keys: ←/→ previous/next cue on the track, ↑/↓ other track,
// Shift+←/→ move 0.1 s (Ctrl: 1 s), 1-9/0 palette colour, [ ] hue, + - intensity,
// Enter = colour wheel, Del delete, Space play/pause, Esc deselect, and like Ableton:
// Ctrl+C/X/V copy, cut, paste at the cursor, Ctrl+D duplicate after itself,
// Ctrl+E split at the cursor, Ctrl+A select all. Keys that change cues work on the selection.
views.timelines.keys = async (e) => {
  if (document.activeElement?.closest?.('.cw')) return;   // the colour wheel has its own keys
  const p = P(), t = p?.timelines[S.sel.timeline];
  if (!t) return;
  const c = t.cues[S.sel.cue], k = e.key, mod = e.ctrlKey || e.metaKey, kl = k.toLowerCase();
  const sel = [...tlSelection(t)];
  const lane = (x) => (x.trigger != null ? -1 : x.track || 0);
  const done = () => { e.preventDefault(); markDirty(); render(); };
  // Space: pause while playing; when paused carry on, unless you clicked a new spot since
  // (then play from there); when stopped play from the cursor (from the start without one).
  if (k === ' ') {
    e.preventDefault();
    const pb = tlPlayback(t);
    if (pb && !pb.paused && !pb.ended) return tlPause(t, true);
    if (pb?.paused && (e.shiftKey || S.tlCursor == null || S.tlCursor === S.tlPauseCursor)) return tlPause(t, false);
    return tlPlayFrom(t, S.tlCursor || 0);
  }
  if (mod && kl === 'a') { e.preventDefault(); tlSelect(t, [...t.cues]); return render(); }
  if (mod && kl === 'v') {
    if (!S.tlClip?.length) return toast('Nothing copied yet (select clips, Ctrl+C)', true);
    // At the cursor (else right after the selection); on the cursor's track if it has one.
    const src = S.tlClip, [a, b] = cueSpan(t, src);
    const at = S.tlCursor ?? (sel.length ? cueSpan(t, sel)[1] : a);
    const tracks = src.filter(isLight).map((x) => x.track || 0);
    let dl = typeof S.tlCursorLane === 'number' && tracks.length ? S.tlCursorLane - Math.min(...tracks) : 0;
    if (tracks.length) dl = Math.max(-Math.min(...tracks), Math.min(t.tracks.length - 1 - Math.max(...tracks), dl));
    pasteCues(t, src, at, dl);
    S.tlCursor = at + (b - a);
    return done();
  }
  if (!c) {
    if (k.startsWith('Arrow') && t.cues.length) { e.preventDefault(); S.sel.cue = t.cues.indexOf([...t.cues].sort((a, b) => a.t - b.t)[0]); render(); }
    if (mod && kl === 'e') splitAtCursor(t, e) && done();
    return;
  }
  if (mod && (kl === 'c' || kl === 'x')) {
    e.preventDefault();
    S.tlClip = sel.map((x) => structuredClone(x));
    toast(`${sel.length} cue${sel.length > 1 ? 's' : ''} ${kl === 'c' ? 'copied' : 'cut'}`);
    if (kl === 'x') { t.cues = t.cues.filter((x) => !sel.includes(x)); tlSelect(t, []); return done(); }
    return;
  }
  if (mod && kl === 'd') {
    const [a, b] = cueSpan(t, sel);
    pasteCues(t, sel, b, 0);
    S.tlCursor = b + (b - a);
    return done();
  }
  if (mod && kl === 'e') { if (splitAtCursor(t, e)) done(); return; }
  if ((k === 'ArrowLeft' || k === 'ArrowRight') && (e.shiftKey || mod)) {
    const d = (k === 'ArrowLeft' ? -1 : 1) * (mod ? 1000 : 100);
    const dt = Math.max(d, -Math.min(...sel.map((x) => x.t)));
    for (const x of sel) x.t += dt;
    resolveOverlaps(t, new Set(sel));
    return done();
  }
  if (k === 'ArrowLeft' || k === 'ArrowRight') {
    const same = t.cues.map((x, i) => [x, i]).filter(([x]) => lane(x) === lane(c)).sort((a, b) => a[0].t - b[0].t);
    const at = same.findIndex(([, i]) => i === S.sel.cue), to = same[at + (k === 'ArrowLeft' ? -1 : 1)];
    if (to) { e.preventDefault(); S.sel.cue = to[1]; render(); }
    return;
  }
  if (k === 'ArrowUp' || k === 'ArrowDown') {
    const lanes = [-1, ...t.tracks.map((_, r) => r)];
    let li = lanes.indexOf(lane(c));
    for (;;) {
      li += k === 'ArrowUp' ? -1 : 1;
      if (li < 0 || li >= lanes.length) return;
      const there = t.cues.map((x, i) => [x, i]).filter(([x]) => lane(x) === lanes[li]);
      if (!there.length) continue;
      there.sort((a, b) => Math.abs(a[0].t - c.t) - Math.abs(b[0].t - c.t));
      e.preventDefault();
      S.sel.cue = there[0][1];
      return render();
    }
  }
  if (k === 'Escape') { tlSelect(t, []); S.tlCursor = null; S.tlCursorLane = null; return render(); }
  // Delete leaves an empty space (clips after it don't move).
  if (k === 'Delete' || k === 'Backspace') { t.cues = t.cues.filter((x) => !sel.includes(x)); tlSelect(t, []); return done(); }
  if (k === 'Enter') { const w = $('.cue-ed .cw'); if (w) { e.preventDefault(); w.focus(); } return; }
  if (mod || e.altKey) return;
  // Colour and intensity keys: every selected cue they apply to.
  let any = false;
  for (const x of sel) {
    const kind = cueKind(x);
    // The colour these keys work on: the preset colour, or an effect's first colour parameter.
    const colParam = kind === 'effect' ? fxProg(p.effects.find((f) => f.id === x.effect) || { code: '' }).params?.find((q) => q.type === 'color') : null;
    const getCol = () => (kind === 'preset' ? x.color : colParam ? (x.params?.[colParam.name] ?? colParam.def) : null);
    const setCol = (hex) => { if (kind === 'preset') x.color = S.tlLastColor = hex; else if (colParam) { x.params = x.params || {}; x.params[colParam.name] = hex; } };
    if (/^[0-9]$/.test(k) && (kind === 'preset' || colParam)) { setCol(themeColors()[(+k + 9) % 10]); any = true; }
    else if ((k === '[' || k === ']') && getCol()) {
      const [h, s, v] = rgbToHsv(...hexToRgb(getCol()));
      setCol(hsvToHex((h + (k === '[' ? -15 : 15) + 360) % 360, s, v));
      any = true;
    } else if ((k === '+' || k === '=' || k === '-') && (kind === 'preset' || kind === 'effect')) {
      x.dim = Math.max(0, Math.min(100, (x.dim ?? 100) + (k === '-' ? -10 : 10)));
      any = true;
    }
  }
  if (any) done();
};
// Play a timeline from ms (start, restart or jump). The playhead moves at once instead
// of waiting for the next status update.
async function tlPlayFrom(t, ms) {
  const r = await cmd(`start timeline ${t.id}${ms ? ` at ${(ms / 1000).toFixed(2)}` : ''}`);
  if (!r.ok) return toast(r.reply, true);
  // An older controller (or a mock started before this feature) ignores "at" and starts at 0.
  if (ms && !/ at /.test(r.reply)) {
    toast('The controller started from the beginning: it does not know "start from here" yet. Update the firmware, or restart the mock.', true);
    S.tlJump = null;
    return;
  }
  S.tlJump = { id: t.id, ms, at: Date.now() };
  if (S.status) {
    S.status.playbacks = (S.status.playbacks || []).filter((x) => !(x.kind === 'timeline' && x.id === t.id));
    S.status.playbacks.push({ kind: 'timeline', id: t.id, pos: ms, paused: false, ended: false });
    S.statusAt = Date.now();
  }
}
// Scrub: a paused timeline jumps to ms and stays paused ("seek timeline": no restart, no triggers).
async function tlSeek(t, ms) {
  const r = await cmd(`seek timeline ${t.id} ${(ms / 1000).toFixed(2)}`);
  const pb = tlPlayback(t);
  if (!r.ok || !pb) return;
  S.tlJump = null;
  S.tlPauseCursor = ms;
  Object.assign(pb, { pos: ms });
  S.statusAt = Date.now();
}
// Pause (or resume) a timeline; the playhead stops or moves on at once.
async function tlPause(t, pause) {
  const ph = tlHeadPos(t), r = await cmd(`${pause ? 'pause' : 'resume'} timeline ${t.id}`);
  toast(r.reply, !r.ok);
  const pb = tlPlayback(t);
  if (!r.ok || !pb || !ph) return;
  S.tlJump = null;
  S.tlPauseCursor = S.tlCursor;   // Space carries on unless the cursor is moved after this
  Object.assign(pb, { pos: ph.at, paused: pause });
  S.statusAt = Date.now();
}
const tlPlayback = (t) => S.status?.playbacks?.find((x) => x.kind === 'timeline' && x.id === t.id);
// Ctrl+E: cut the selected clips (or, with none selected, those on the cursor's track)
// in two at the cursor. The second half starts without a fade, so the look carries on.
function splitAtCursor(t, e) {
  e.preventDefault();
  const at = S.tlCursor;
  if (at == null) { toast('Click in the timeline to put the cursor where to split', true); return false; }
  let cands = [...tlSelection(t)];
  if (!cands.length) cands = t.cues.filter((x) => isLight(x) && (x.track || 0) === S.tlCursorLane);
  const hit = cands.filter((x) => isLight(x) && x.t < at && cueEnd(t, x, Infinity) > at);
  if (!hit.length) { toast('No clip under the cursor', true); return false; }
  const halves = hit.map((x) => {
    const end = x.len ? x.t + x.len : null;
    const b = { ...structuredClone(x), t: at, fade: 0 };
    if (end != null) { b.len = end - at; x.len = at - x.t; x.out = 0; x.fade = Math.min(x.fade || 0, x.len); b.out = Math.min(b.out || 0, b.len); }
    return b;
  });
  t.cues.push(...halves);
  tlSelect(t, halves);
  return true;
}
// New cue on a timeline; kind = preset | scene | trigger; at = { t, track, len }. Selects it.
function addCue(t, at, kind) {
  const p = P();
  const c = { t: at.t };
  if (at.len && kind !== 'trigger') c.len = at.len;
  if (kind === 'trigger') {
    const real = p.triggers.filter((x) => x.type !== 'comment');
    const pick = real.find((x) => x.type === 'manual') || real[0];
    if (!pick) return toast('Make a trigger first', true);
    c.trigger = pick.name || String(pick.id);
  } else {
    c.track = at.track || 0;
    c.fade = 1000;
    // A new colour clip is a solid colour bar: the last colour picked (white at first).
    if (kind === 'preset') { c.dim = 100; c.color = S.tlLastColor || '#ffffff'; }
    else if (kind === 'effect') {
      if (!p.effects.length) return toast('Make an effect first (Effects page)', true);
      c.effect = p.effects[0].id;
      c.params = {};
    } else c.scene = p.scenes[0]?.id || 1;
  }
  t.cues.push(c);
  S.sel.cue = t.cues.length - 1;
  markDirty();
  render();
}
// A new clip on track r at `at`: up to the next clip on the track, at most 4 s.
function addClipAt(t, r, at, kind) {
  const nx = Math.min(Infinity, ...t.cues.filter((x) => isLight(x) && (x.track || 0) === r && x.t > at).map((x) => x.t));
  addCue(t, { t: at, track: r, len: Math.max(100, Math.min(4000, nx - at)) }, kind);
}
// The time under the mouse on the open timeline's grid, snapped like a click (Alt = no snap,
// raw = not snapped at all).
function tlMsAtX(clientX, e, raw = false) {
  const grid = $('#tlGrid'), ruler = grid && $('[data-ruler]', grid);
  if (!ruler) return null;
  const r = ruler.getBoundingClientRect(), ms = Math.max(0, ((clientX - r.left) / r.width) * +grid.dataset.len);
  if (raw) return ms;
  const step = (e?.altKey ? 0 : tlSnapMs(+grid.dataset.pxs)) || 10;
  return Math.round(ms / step) * step;
}
// Zoom (pixels per second) around clientX, or around the middle of the view.
function tlZoomTo(z, clientX) {
  const sc = $('#tlScroll');
  if (!sc) return;
  const r = sc.getBoundingClientRect(), uz = uiZoom(), x = clientX ?? r.left + (TL_HEAD + (r.width / uz - TL_HEAD) / 2) * uz;
  const ms = tlMsAtX(x, null, true);
  S.tlZoom = Math.max(0.5, Math.min(800, z));
  S.tlScroll = Math.max(0, (ms / 1000) * S.tlZoom - ((x - r.left) / uz - TL_HEAD));
  render();
}
// Swaps track r with its neighbour (d = -1 up, 1 down); the clips go with it.
function moveTrack(t, r, d) {
  const o = r + d;
  if (!t.tracks[o]) return;
  [t.tracks[r], t.tracks[o]] = [t.tracks[o], t.tracks[r]];
  for (const c of t.cues) if (isLight(c)) { if ((c.track || 0) === r) c.track = o; else if ((c.track || 0) === o) c.track = r; }
  if (S.trackEdit === r) S.trackEdit = o; else if (S.trackEdit === o) S.trackEdit = r;
  if (S.tlCursorLane === r) S.tlCursorLane = o; else if (S.tlCursorLane === o) S.tlCursorLane = r;
  markDirty();
  render();
}
// A new track at index `at` (the ones below move down), with the given clips (track = at).
function insertTrack(t, at, track, cues = []) {
  if (t.tracks.length >= 16) return toast('Max 16 tracks per timeline', true);
  for (const c of t.cues) if (isLight(c) && (c.track || 0) >= at) c.track = (c.track || 0) + 1;
  t.tracks.splice(at, 0, track);
  for (const c of cues) t.cues.push({ ...c, track: at });
  S.trackEdit = null;
  S.tlCursorLane = at;
  markDirty();
  render();
}
// ---- Right-click menus on the timeline (CTX_MENUS in app-main.js) ----
// Empty space on a track (or the trigger lane): add a clip there, paste, play, cursor, split.
function tlLaneMenu(lane, e) {
  const p = P(), t = p.timelines[S.sel.timeline], at = tlMsAtX(e.clientX, e);
  if (!t || at == null) return null;
  const trig = lane.dataset.lane === 'trig', r = trig ? null : +lane.dataset.lane;
  const sec = `${(at / 1000).toFixed(2)} s`;
  const here = () => { S.tlCursor = at; S.tlCursorLane = trig ? 'trig' : r; };
  const onLane = t.cues.filter((c) => (trig ? !isLight(c) : isLight(c) && (c.track || 0) === r));
  return [
    !trig && { label: `Add colour clip at ${sec}`, run: () => addClipAt(t, r, at, 'preset') },
    !trig && { label: `Add scene clip at ${sec}`, run: () => addClipAt(t, r, at, 'scene') },
    !trig && { label: `✦ Add effect clip at ${sec}`, off: !p.effects.length, run: () => addClipAt(t, r, at, 'effect') },
    trig && { label: `◆ Add trigger cue at ${sec}`, run: () => addCue(t, { t: at }, 'trigger') },
    { label: `Paste at ${sec}`, key: 'Ctrl+V', off: !S.tlClip?.length, run: () => { here(); pageKey('v', true); } },
    null,
    { label: `▶ Play from ${sec}`, run: () => { here(); tlPlayFrom(t, at); render(); } },
    { label: 'Put the cursor here', run: () => { here(); tlSelect(t, []); render(); } },
    !trig && { label: `Split the clips at ${sec}`, key: 'Ctrl+E', off: !onLane.some((c) => c.t < at && cueEnd(t, c, Infinity) > at), run: () => { here(); tlSelect(t, []); pageKey('e', true); } },
    null,
    { label: trig ? 'Select all trigger cues' : 'Select all clips on this track', off: !onLane.length, run: () => { tlSelect(t, onLane); render(); } },
    { label: 'Select all', key: 'Ctrl+A', run: () => pageKey('a', true) },
  ];
}
// A track's name cell: fixtures, rename, select its clips, move, add, duplicate, delete.
function tlHeadMenu(head) {
  const p = P(), t = p.timelines[S.sel.timeline];
  if (!t) return null;
  if (head.dataset.trackhead === 'trig') {
    const cues = t.cues.filter((c) => !isLight(c));
    return [
      { label: '◆ Add trigger cue at the cursor', run: () => addItem('trigcue') },
      { label: 'Select all trigger cues', off: !cues.length, run: () => { tlSelect(t, cues); render(); } },
    ];
  }
  const r = +head.dataset.trackhead, tr = t.tracks[r];
  if (!tr) return null;
  const clips = t.cues.filter((c) => isLight(c) && (c.track || 0) === r), full = t.tracks.length >= 16;
  return [
    { label: trackFxIds(tr).length ? 'Choose its fixtures…' : 'Choose fixtures…', run: () => { S.trackEdit = r; render(); } },
    { label: 'Rename', run: () => { const f = $(`[data-p="timelines.${S.sel.timeline}.tracks.${r}.name"]`); f?.focus(); f?.select(); } },
    { label: 'Select all its clips', off: !clips.length, run: () => { tlSelect(t, clips); render(); } },
    null,
    { label: 'Add colour clip at the cursor', run: () => { S.tlCursorLane = r; addItem('cue:preset'); } },
    { label: 'Add scene clip at the cursor', run: () => { S.tlCursorLane = r; addItem('cue:scene'); } },
    { label: '✦ Add effect clip at the cursor', off: !p.effects.length, run: () => { S.tlCursorLane = r; addItem('cue:effect'); } },
    null,
    { label: 'Move track up', off: r === 0, run: () => moveTrack(t, r, -1) },
    { label: 'Move track down', off: r === t.tracks.length - 1, run: () => moveTrack(t, r, 1) },
    { label: 'Add a track below', off: full, run: () => insertTrack(t, r + 1, { name: `Track ${t.tracks.length + 1}`, fixtures: [], groups: [] }) },
    { label: clips.length ? 'Duplicate track with its clips' : 'Duplicate track', off: full,
      run: () => insertTrack(t, r + 1, { name: `${tr.name} copy`, fixtures: [...tr.fixtures], groups: [...tr.groups] }, clips.map((c) => structuredClone(c))) },
    null,
    { label: 'Delete track', danger: true, off: t.tracks.length <= 1, run: () => $(`[data-trackdel="${r}"]`)?.click() },
  ];
}
// The time ruler: play from here, cursor, the end of the timeline, zoom.
function tlRulerMenu(ruler, e) {
  const t = P().timelines[S.sel.timeline], at = tlMsAtX(e.clientX, e);
  if (!t || at == null) return null;
  const sec = `${(at / 1000).toFixed(2)} s`, pb = tlPlayback(t), pxs = +$('#tlGrid').dataset.pxs;
  return [
    { label: `▶ Play from ${sec}`, run: () => { S.tlCursor = at; tlPlayFrom(t, at); render(); } },
    pb && !pb.paused && !pb.ended && { label: 'Pause', key: 'Space', run: () => tlPause(t, true) },
    pb?.paused && { label: 'Carry on', key: 'Shift+Space', run: () => tlPause(t, false) },
    { label: 'Put the cursor here', run: () => { S.tlCursor = at; render(); } },
    { label: `End the timeline at ${sec}`, off: at < 100, run: () => { t.length = at; markDirty(); render(); } },
    null,
    { label: 'Zoom in here', run: () => tlZoomTo(pxs * 1.5, e.clientX) },
    { label: 'Zoom out', run: () => tlZoomTo(pxs / 1.5, e.clientX) },
    { label: 'Fit the whole timeline', off: !S.tlZoom, run: () => { S.tlZoom = null; S.tlScroll = 0; render(); } },
  ];
}
