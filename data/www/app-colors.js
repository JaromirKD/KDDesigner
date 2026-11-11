'use strict';
// Colour themes: named sets of colours that every colour wheel offers as its palette (the
// swatches, and the keys 1-9, 0), so scenes, timeline clips and effect parameters all use the
// same colours. Built-in themes (COLOR_THEMES) plus the show's own in project.json
// `colorThemes` [{ id, name, colors: ['#rrggbb', …] }] (web UI only: the firmware drops them
// after loading). Which theme the wheels show is a browser preference (kd.cwTheme).

const COLOR_THEMES = [
  { name: 'Basic', colors: PALETTE },
  { name: 'Warm whites', colors: ['#ffffff', '#fff9f0', '#fff4e0', '#ffebd2', '#ffe8c4', '#ffd9a0', '#ffc67a', '#ffb35c', '#ff9f3d', '#ff8c2a'] },
  { name: 'Museum (neutral)', colors: ['#ffffff', '#fff8ee', '#fff1dd', '#ffe9cc', '#f5f5f5', '#e8ecf0', '#d9e4ee', '#cfd8dc', '#ffe0b2', '#fafafa'] },
  { name: 'Theatre gels', colors: ['#ffcc99', '#fff2a8', '#ff8c1a', '#ff2d2d', '#ff40c8', '#ff9dd2', '#b4a0ff', '#9ccdff', '#2a1aff', '#5fc94a'] },
  { name: 'Sunset', colors: ['#ffe4b5', '#ffd166', '#ffb347', '#ff8c42', '#ff5e3a', '#ff2e63', '#f9a8d4', '#c084fc', '#7c3aed', '#312e81'] },
  { name: 'Ocean', colors: ['#e0fbfc', '#caf0f8', '#ade8f4', '#90e0ef', '#48cae4', '#00b4d8', '#0096c7', '#0077b6', '#003f5c', '#1b998b'] },
  { name: 'Forest', colors: ['#c5e1a5', '#9ccc65', '#66bb6a', '#43a047', '#2e7d32', '#1b5e20', '#0b3d20', '#a1887f', '#8d6e63', '#ffeb3b'] },
  { name: 'Fire', colors: ['#ffffff', '#ffee55', '#ffcc00', '#ffaa33', '#ff9900', '#ff6600', '#ff3300', '#ff0000', '#cc1100', '#880000'] },
  { name: 'Ice', colors: ['#ffffff', '#e6f7ff', '#e1f5fe', '#ccefff', '#b3e5fc', '#99ddff', '#80d8ff', '#66ccff', '#33bbff', '#0099ff'] },
  { name: 'Pastel', colors: ['#ffffff', '#f0f0f0', '#ffd1dc', '#ffe4b5', '#fff5ba', '#d4f8d4', '#c1f0f6', '#c9c9ff', '#e6ccff', '#ffccf2'] },
  { name: 'Neon', colors: ['#ff00ff', '#00ffff', '#39ff14', '#ff3131', '#ffff00', '#ff6ec7', '#00ff9f', '#7df9ff', '#ff9f00', '#bc13fe'] },
  { name: 'Rainbow', colors: ['#ff0000', '#ff8000', '#ffff00', '#80ff00', '#00ff00', '#00ff80', '#00ffff', '#0080ff', '#0000ff', '#8000ff'] },
  { name: 'Christmas', colors: ['#ff0000', '#00aa00', '#ffd700', '#ffffff', '#cc0000', '#006400', '#ff4444', '#44dd44', '#fff3b0', '#c0c0c0'] },
  { name: 'Halloween', colors: ['#ff7518', '#ff4500', '#ffa500', '#ffcc00', '#8a2be2', '#6a0dad', '#4b0082', '#39ff14', '#2e8b57', '#ff1493'] },
];
// Every theme: the built-in ones (marked), then the show's own.
function allThemes(p = P()) {
  return [...COLOR_THEMES.map((t) => ({ ...t, builtin: true })), ...(p?.colorThemes || [])];
}
const cwThemeName = () => uiPref('kd.cwTheme', 'Basic');
// The theme the colour wheels show (Basic when the chosen one is gone).
function cwTheme() {
  const all = allThemes(), n = cwThemeName();
  return all.find((t) => t.name === n) || all[0];
}
function setCwTheme(name) { try { localStorage.setItem('kd.cwTheme', name); } catch { /* private mode */ } }
// The colours behind the keys 1-9 and 0 (a wheel, the timeline): the theme's first ten, with
// Basic's filling up a shorter theme.
function themeColors() {
  const c = cwTheme().colors.slice(0, 10);
  return c.length >= 10 ? c : [...c, ...PALETTE.slice(c.length)];
}
// The palette part of a colour wheel: the theme picker and its swatches (app-rig.js).
function cwPalHtml() {
  const cur = cwTheme();
  return `<select class="cw-theme" title="Colour theme: these swatches and the keys 1-9, 0. Make your own on the Colours page.">${allThemes().map((t) =>
    `<option${t.name === cur.name ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>${cur.colors.map((c, k) =>
    `<button type="button" class="swatch" data-pal="${c}" style="background:${c}" title="${c}${k < 10 ? ` (key ${(k + 1) % 10})` : ''}"></button>`).join('')}`;
}
// A small strip of a theme's colours (lists, the effect parameters).
// At most 8 swatches in a list row, so the name keeps its room.
const themeStripHtml = (t, cls = 'theme-strip') => `<span class="${cls}" title="${esc(t.colors.join(' '))}">${t.colors.slice(0, 8).map((c) => `<i style="background:${c}"></i>`).join('')}${t.colors.length > 8 ? '<b>…</b>' : ''}</span>`;
// Gives the clips (sorted by time) the theme's colours in turn: colour clips, and effect
// clips through their first colour parameter.
function themeAcrossCues(t, cues) {
  const p = P(), cols = cwTheme().colors;
  let k = 0;
  for (const c of [...cues].sort((a, b) => a.t - b.t)) {
    if (c.trigger != null) continue;
    if (c.effect != null) {
      const q = fxProg(p.effects.find((f) => f.id === c.effect) || { code: '' }).params?.find((x) => x.type === 'color');
      if (!q) continue;
      c.params = c.params || {};
      c.params[q.name] = cols[k++ % cols.length];
    } else if (c.scene == null) c.color = cols[k++ % cols.length];
  }
  if (!k) return toast('No colour or effect clips selected', true);
  markDirty();
  render();
}

// ---- The Colours page ------------------------------------------------------------------
S.themeSwatch = 0;   // the swatch being edited on an own theme
views.colors = () => {
  const p = P(), all = allThemes(p), wheel = cwTheme();
  S.sel.theme = Math.max(0, Math.min(S.sel.theme || 0, all.length - 1));
  const t = all[S.sel.theme], own = t && !t.builtin, j = own ? p.colorThemes.indexOf(t) : -1, base = `colorThemes.${j}`;
  if (own) S.themeSwatch = Math.max(0, Math.min(S.themeSwatch, t.colors.length - 1));
  const list = all.map((x, i) => `<div class="item${i === S.sel.theme ? ' sel' : ''}" data-sel="theme:${i}"><span style="flex:1;min-width:0">${esc(x.name)}</span>
      ${x.name === wheel.name ? '<span class="tag ok" title="The colour wheels show this theme">wheel</span>' : ''}${themeStripHtml(x)}</div>`).join('');
  let editor = '<span class="muted">Select a theme.</span>';
  if (t) {
    const sw = t.colors.map((c, k) => `<div class="theme-sw${own && k === S.themeSwatch ? ' on' : ''}" data-themesw="${k}" title="${c}${k < 10 ? ` · key ${(k + 1) % 10} on a colour wheel` : ''}">
        <span class="theme-swc" style="background:${c}"></span><span class="mono muted">${c}</span>${own ? `<span class="theme-swb"><button class="btn small ghost" data-swmove="-1" title="Move left">◀</button><button class="btn small ghost" data-swmove="1" title="Move right">▶</button><button class="btn small ghost" data-swdel title="Remove this colour">✕</button></span>` : ''}</div>`).join('');
    editor = `<div class="row">${own ? `<input data-p="${base}.name" value="${esc(t.name)}" style="font-size:16px;flex:1" data-r>` : `<b style="font-size:16px;flex:1">${esc(t.name)} <span class="muted">(built-in)</span></b>`}
        ${t.name === wheel.name ? '<span class="tag ok" title="The colour wheels show this theme">✓ in the colour wheels</span>' : `<button class="btn" id="themeUse" title="Show this theme's colours in every colour wheel (keys 1-9, 0)">Use in the colour wheels</button>`}
        <button class="btn small" id="themeDup" title="${own ? 'A copy to change' : 'Built-in themes can’t be changed: a copy of your own can'}">${own ? 'Duplicate' : 'Copy to my themes'}</button>
        ${own ? `<button class="btn small ghost" data-del="${base}">Delete</button>` : ''}</div>
      <div class="theme-bar">${t.colors.map((c) => `<i style="background:${c}"></i>`).join('')}</div>
      <p class="muted">${own ? 'Click a colour to change it with the wheel below; ◀ ▶ move it, ✕ removes it. The first ten are the keys 1-9, 0 on every colour wheel and on the timeline.' : 'A built-in theme. Copy it to your themes to change the colours, or use it as it is.'}</p>
      <div class="theme-sws">${sw}${own ? `<button class="btn small" id="themeAdd" title="Add a colour (the one in the wheel below)">+ Colour</button>` : ''}</div>
      ${own && t.colors[S.themeSwatch] ? `<h3>Colour ${S.themeSwatch + 1}</h3>${colorWheelHtml('theme', t.colors[S.themeSwatch])}` : ''}
      ${own && !t.colors.length ? '<p class="muted">No colours yet: press + Colour.</p>' : ''}`;
  }
  return `<h2>Colours</h2>
    <p class="muted">A colour theme is a set of colours to reuse all over the show: every <b>colour wheel</b> (scenes, timeline clips, effect parameters, DMX monitor) shows the chosen theme as its swatches, and the keys <b>1-9, 0</b> give its first ten colours. Pick a built-in theme, or make your own (they are saved with the show).</p>
    <div class="split">
    <div><div class="list">${list}</div>
      <div class="row" style="margin-top:8px"><button class="btn small" data-add="colorTheme">+ Theme</button></div>
      <p class="muted keys">Right-click a theme for more. On the timeline, right-click several selected clips → “Theme colours across the clips”.</p></div>
    <div>${editor}</div></div>`;
};
views.colors.after = () => {
  const p = P(), all = allThemes(p), t = all[S.sel.theme];
  if (!t) return;
  const own = !t.builtin;
  $('#themeUse')?.addEventListener('click', () => { setCwTheme(t.name); render(); });
  $('#themeDup')?.addEventListener('click', () => {
    p.colorThemes.push({ id: nextId(p.colorThemes), name: uniqueName(all, own ? t.name : `${t.name} copy`), colors: [...t.colors] });
    S.sel.theme = all.length;   // the new one, at the end
    markDirty();
    render();
  });
  if (!own) return;
  $$('[data-themesw]').forEach((el) => el.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    S.themeSwatch = +el.dataset.themesw;
    render();
  }));
  $$('[data-swmove]').forEach((b) => b.addEventListener('click', () => {
    const k = +b.closest('[data-themesw]').dataset.themesw, to = k + +b.dataset.swmove;
    if (!t.colors[to]) return;
    [t.colors[k], t.colors[to]] = [t.colors[to], t.colors[k]];
    S.themeSwatch = to;
    markDirty();
    render();
  }));
  $$('[data-swdel]').forEach((b) => b.addEventListener('click', () => {
    t.colors.splice(+b.closest('[data-themesw]').dataset.themesw, 1);
    markDirty();
    render();
  }));
  $('#themeAdd')?.addEventListener('click', () => {
    t.colors.push($('.cw .cw-hex')?.value || '#ffffff');
    S.themeSwatch = t.colors.length - 1;
    markDirty();
    render();
  });
  const cw = $('.cw');
  if (cw) attachColorWheel(cw, t.colors[S.themeSwatch], (hex, done) => {
    t.colors[S.themeSwatch] = hex;
    const sw = $(`[data-themesw="${S.themeSwatch}"]`);
    if (sw) { sw.querySelector('.theme-swc').style.background = hex; sw.querySelector('.mono').textContent = hex; sw.title = hex; }
    $$('.theme-bar i')[S.themeSwatch]?.style.setProperty('background', hex);
    markDirty();
    if (done) render();
  });
};
// Right-click on a theme in the list (CTX_MENUS in app-main.js).
function themeMenu(el) {
  const p = P(), i = +el.dataset.sel.split(':')[1], all = allThemes(p), t = all[i];
  if (!t) return null;
  if (S.sel.theme !== i) { S.sel.theme = i; render(); }
  const own = !t.builtin;
  return [
    t.name !== cwTheme().name && { label: 'Use in the colour wheels', run: () => { setCwTheme(t.name); render(); } },
    { label: own ? 'Duplicate' : 'Copy to my themes', run: () => $('#themeDup')?.click() },
    { label: 'Copy the colours as text', run: () => copyText(t.colors.join(', ')) },
    null,
    own && { label: 'Delete', danger: true, run: () => deleteItem(`colorThemes.${p.colorThemes.indexOf(t)}`) },
  ];
}
