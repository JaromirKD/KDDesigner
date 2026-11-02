'use strict';
// Touch-panel controls, shared by panel.html (the panel itself) and the Panel page preview in
// KD Designer: theme (panelThemeVars), markup (panelPageHtml), live state (panelUpdate) and
// dragging sliders, dials and colour wheels (panelDrag). Styles are in panel.css.
// The live state per control name is the status "labels" (State.cpp): text / colour / flash /
// disabled set by panel and label actions, and the value a panel sent or "panel X value" set.
// A control linked to a variable shows that variable instead.

const PANEL_VALUE_TYPES = ['toggle', 'slider', 'dial', 'color', 'xy'];   // these send "change" with a value
// The panel theme (project.panel.theme holds only what differs). Colours of controls come from
// here unless a control has its own colour. Sizes in px; width 0 = the whole screen.
const PANEL_THEME = {
  bg: '#0b0c10', card: '#171a21', border: '#2c313d', text: '#e6e8ee', muted: '#8a90a0', track: '#0b0c10',
  button: '#2a3140', buttonText: '#ffffff', toggle: '#3a7d44', accent: '#4c8dff', label: '#d8dbe2',
  radius: 12, gap: 12, row: 84, font: 18, width: 1100,
};
const PANEL_THEMES = {
  Dark: {},
  Light: { bg: '#eef0f4', card: '#ffffff', border: '#cfd4dd', text: '#1b1f27', muted: '#5d6575', track: '#dde1e8', button: '#3b4a63', label: '#1b1f27' },
  Contrast: { bg: '#000000', card: '#000000', border: '#ffffff', text: '#ffffff', muted: '#dddddd', track: '#333333', button: '#1a1a1a', toggle: '#00b050', accent: '#ffd400', label: '#ffffff' },
};
// The theme setting a control type takes its colour from.
const PANEL_TYPE_COLOR = { button: 'button', toggle: 'toggle', slider: 'accent', dial: 'accent', xy: 'accent', label: 'label', clock: 'label' };
const panelTheme = (t) => ({ ...PANEL_THEME, ...(t || {}) });
const panelThemeColor = (t, type) => panelTheme(t)[PANEL_TYPE_COLOR[type]] || '';
function panelThemeVars(t) {
  const th = panelTheme(t);
  const px = (k) => `--p-${k}:${+th[k] || 0}px`;
  return ['bg', 'card', 'border', 'text', 'muted', 'track', 'button', 'buttonText', 'toggle', 'accent', 'label'].map((k) => `--p-${k}:${pEsc(th[k])}`)
    .concat(['radius', 'gap', 'row', 'font'].map(px), `--p-width:${+th.width > 0 ? +th.width + 'px' : 'none'}`).join(';');
}

// What this panel just sent, by control name (lower case): it wins over a status that is still
// on its way, so a slider doesn't jump back while you drag it.
const panelLocal = {};
const pEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pNum = (v, d) => (v === '' || v == null || isNaN(+v) ? d : +v);
const pClamp = (v) => Math.min(1, Math.max(0, v));
const panelTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
// 270° arc of a dial, from bottom-left over the top to bottom-right.
const P_ARC = 'M23.13 76.87 A38 38 0 1 1 76.87 76.87';

function panelRange(c) {
  const min = pNum(c.min, 0), max = pNum(c.max, c.type === 'toggle' ? 1 : 100);
  return { min, max: max === min ? min + 1 : max, step: Math.abs(pNum(c.step, 1)) };
}
// The vertical axis of an XY pad (min/max are its horizontal one).
const panelRangeY = (c) => panelRange({ min: c.ymin, max: c.ymax, step: c.step });
function panelSnap(c, v, r = panelRange(c)) {
  const { min, max, step } = r;
  if (step) v = min + Math.round((v - min) / step) * step;
  return +Math.min(Math.max(min, max), Math.max(Math.min(min, max), v)).toFixed(6);
}
// Decimals shown: those of the step (0.05 -> 2); a smooth control (step 0) by its range (0-1 -> 2).
function panelFmt(c, v, r = panelRange(c)) {
  const { min, max, step } = r;
  const d = step ? (String(step).split('.')[1] || '').length : 2 - Math.floor(Math.log10(Math.abs(max - min)));
  return v.toFixed(Math.max(0, Math.min(6, d)));
}
// An XY pad's value is "x,y"; nothing set yet = the middle.
function panelXY(c, value) {
  const rx = panelRange(c), ry = panelRangeY(c), [x, y] = String(value ?? '').split(',');
  return [panelSnap(c, pNum(x, (rx.min + rx.max) / 2), rx), panelSnap(c, pNum(y, (ry.min + ry.max) / 2), ry)];
}
const panelXYText = (c, x, y) => `${panelFmt(c, x)},${panelFmt(c, y, panelRangeY(c))}`;
// Grid rows a control takes when the project doesn't say.
const panelRows = (c) => (c.type === 'slider' && c.vertical ? 3 : c.type === 'dial' ? 2 : c.type === 'color' || c.type === 'xy' ? 3 : 1);

// #rrggbb <-> [hue 0-360, saturation 0-1, brightness 0-1]
function pHsv(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [0, 0, 1];
  const n = parseInt(m[1], 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  const h = !d ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, mx ? d / mx : 0, mx];
}
function pHex(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); };
  return '#' + [f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// color '' = the theme's colour (CSS variables in panel.css).
function panelCtlState(c, st) {
  const labels = st?.labels || {}, name = String(c.name || '').toLowerCase();
  const l = (name && labels[Object.keys(labels).find((k) => k.toLowerCase() === name)]) || {};
  const loc = panelLocal[name];
  const mine = loc && loc.until > Date.now();
  return {
    text: l.text ?? (c.text || (c.type === 'label' ? '' : c.name || '')), color: l.color || c.color || '',
    flash: l.flash || '', disabled: !!l.disabled, value: mine ? loc.value : panelLinkedValue(c, st?.vars || {}, l.value ?? c.value), hsv: mine ? loc.hsv : null,
  };
}

// Variable links. c.var = the whole value (a colour wheel: a text variable with #rrggbb);
// c.links = one variable per part: colour wheel r g b (0-255, or 0-100 with rgbScale 100),
// h (0-360) s v (0-100); XY pad x y. The panel sends them with each change (/api/panel vars=),
// and a linked variable that changes moves the control.
function panelLinkedValue(c, vars, value) {
  const L = c.links || {}, has = (k) => L[k] && vars[L[k]] != null, get = (k) => pNum(vars[L[k]], 0);
  if (c.var && vars[c.var] != null) value = vars[c.var];
  if (c.type === 'color') {
    const sc = c.rgbScale === 100 ? 100 : 255;
    if (['r', 'g', 'b'].some(has)) {
      const n = parseInt(String(value || '#ffffff').slice(1), 16) || 0, cur = [n >> 16 & 255, n >> 8 & 255, n & 255];
      const ch = (k, i) => (has(k) ? Math.round(Math.min(255, Math.max(0, get(k) / sc * 255))) : cur[i]);
      return '#' + [ch('r', 0), ch('g', 1), ch('b', 2)].map((x) => x.toString(16).padStart(2, '0')).join('');
    }
    if (['h', 's', 'v'].some(has)) {
      const [h, s, v] = pHsv(value || '#ffffff');
      return pHex(has('h') ? ((get('h') % 360) + 360) % 360 : h, has('s') ? pClamp(get('s') / 100) : s, has('v') ? pClamp(get('v') / 100) : v);
    }
  }
  if (c.type === 'xy' && (has('x') || has('y'))) {
    const [x, y] = panelXY(c, value);
    return `${has('x') ? get('x') : x},${has('y') ? get('y') : y}`;
  }
  return value;
}
// [variable, value] pairs to set for a value this panel sends.
function panelLinkValues(c, value, hsv) {
  const L = c.links || {}, out = [];
  if (c.var) out.push([c.var, String(value)]);
  if (c.type === 'color' && /^#[0-9a-f]{6}$/i.test(value)) {
    const n = parseInt(value.slice(1), 16), sc = c.rgbScale === 100 ? 100 : 255;
    [n >> 16 & 255, n >> 8 & 255, n & 255].forEach((x, i) => L['rgb'[i]] && out.push([L['rgb'[i]], String(Math.round(x / 255 * sc))]));
    const [h, s, v] = hsv || pHsv(value);
    if (L.h) out.push([L.h, String(Math.round(h))]);
    if (L.s) out.push([L.s, String(Math.round(s * 100))]);
    if (L.v) out.push([L.v, String(Math.round(v * 100))]);
  }
  if (c.type === 'xy') {
    const [x, y] = String(value).split(',');
    if (L.x) out.push([L.x, x]);
    if (L.y) out.push([L.y, y]);
  }
  return out;
}

// Where a control sits: its own column/row (moved in the editor) or the next free place.
function panelPlace(c, cols) {
  const span = Math.min(c.span || 1, cols), rows = Math.max(1, c.rows || panelRows(c));
  const col = c.col > 0 ? Math.min(c.col, cols - span + 1) : 0;
  return `grid-column:${col ? col + ' / ' : ''}span ${span};grid-row:${col && c.row > 0 ? c.row + ' / ' : ''}span ${rows}`;
}
// preview: the editor's copy - divs instead of buttons and a resize grip on each control.
function panelPageHtml(pg, st, preview, theme) {
  const cols = pg.columns || 3;
  const grip = preview ? '<span class="pgrip" title="Drag to resize"></span>' : '';
  return `<div class="pgrid${preview ? ' preview' : ''}" style="${panelThemeVars(theme)};grid-template-columns:repeat(${cols},minmax(0,1fr))">${pg.controls.map((c, i) => {
    const at = `data-i="${i}" style="${panelPlace(c, cols)}"`;
    switch (c.type) {
      case 'spacer': return `<div class="pspacer" ${at}>${grip}</div>`;
      case 'clock': return `<div class="plabel pclock" data-clock ${at}>${panelTime()}${grip}</div>`;
      case 'label': return `<div class="plabel" ${at}><span class="ptitle"></span>${grip}</div>`;
      case 'slider': return `<div class="pctl pslider${c.vertical ? ' pvert' : ''}" ${at}><div class="phead"><span class="ptitle"></span><span class="pval"></span></div><div class="ptrack"><div class="pfill"></div></div>${grip}</div>`;
      case 'dial': return `<div class="pctl pdial" ${at}><div class="ptitle"></div><div class="pknob"><svg viewBox="0 0 100 100"><path class="parc0" d="${P_ARC}"/><path class="parc" d="${P_ARC}" pathLength="100"/></svg><span class="pval"></span></div>${grip}</div>`;
      case 'xy': return `<div class="pctl pxy" ${at}><div class="phead"><span class="ptitle"></span><span class="pval"></span></div><div class="pxybox"><div class="pxypad"><div class="pxyh"></div><div class="pxyv"></div><div class="pdot"></div></div></div>${grip}</div>`;
      case 'color': return `<div class="pctl pcolor" ${at}><div class="ptitle"></div><div class="pwbox"><div class="pwheel"><div class="pdot"></div></div></div><div class="pbright"><div class="pbknob"></div></div>${grip}</div>`;
      default: {
        const tag = preview ? 'div' : 'button';
        return `<${tag} class="pbtn${c.type === 'toggle' ? ' ptoggle' : ''}" ${at}><span class="ptitle"></span>${grip}</${tag}>`;
      }
    }
  }).join('')}</div>`;
}

// Puts the live state into the controls under root (cheap: run it on every status).
function panelUpdate(root, pg, st) {
  for (const el of root.querySelectorAll('[data-i]')) {
    const c = pg.controls[+el.dataset.i];
    if (!c || c.type === 'spacer') continue;
    if (c.type === 'clock') { el.style.color = c.color || ''; continue; }
    const s = panelCtlState(c, st), fcol = s.flash && s.flash !== 'on';
    el.classList.toggle('p-dis', s.disabled);
    el.classList.toggle('p-flash', !!s.flash);
    el.classList.toggle('p-fcol', !!fcol);
    if (fcol) el.style.setProperty('--flash', s.flash);
    const t = el.querySelector('.ptitle');
    if (t.textContent !== s.text) t.textContent = s.text;
    panelPaint(el, c, s);
  }
}
function panelPaint(el, c, s) {
  const q = (sel) => el.querySelector(sel);
  switch (c.type) {
    case 'label': el.style.color = s.color; break;
    case 'button': el.style.background = s.color; break;
    case 'toggle': {
      const on = +s.value > 0;
      el.classList.toggle('p-on', on);
      el.style.background = on ? s.color || 'var(--p-toggle)' : '';
      break;
    }
    case 'slider': case 'dial': {
      const { min, max } = panelRange(c), v = panelSnap(c, pNum(s.value, min)), f = (v - min) / (max - min);
      el.style.setProperty('--v', f);
      if (s.color) el.style.setProperty('--c', s.color); else el.style.removeProperty('--c');
      if (c.type === 'dial') q('.parc').style.strokeDasharray = `${f * 100} 100`;
      q('.pval').textContent = panelFmt(c, v) + (c.unit || '');
      break;
    }
    case 'xy': {
      const [x, y] = panelXY(c, s.value), rx = panelRange(c), ry = panelRangeY(c);
      el.style.setProperty('--x', (x - rx.min) / (rx.max - rx.min));
      el.style.setProperty('--y', (y - ry.min) / (ry.max - ry.min));
      if (s.color) el.style.setProperty('--c', s.color); else el.style.removeProperty('--c');
      q('.pval').textContent = `${panelFmt(c, x)} · ${panelFmt(c, y, ry)}${c.unit || ''}`;
      break;
    }
    case 'color': {
      const [h, sat, v] = s.hsv || pHsv(s.value || '#ffffff');
      const dot = q('.pdot');
      dot.style.left = 50 + Math.sin(h * Math.PI / 180) * sat * 50 + '%';
      dot.style.top = 50 - Math.cos(h * Math.PI / 180) * sat * 50 + '%';
      dot.style.background = pHex(h, sat, v);
      el.style.setProperty('--dark', 1 - v);
      el.style.setProperty('--v', v);
      el.style.setProperty('--hue', pHex(h, sat, 1));
      break;
    }
  }
}

// Dragging sliders, dials and colour wheels (the panel only). send(c, event, value) posts it:
// press, then "change" at most every 80 ms while moving and once more at the end, then release.
// A slider and a wheel jump to where you touch; a dial turns with up/right and down/left.
function panelDrag(root, getPage, getStatus, send) {
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.pslider[data-i],.pdial[data-i],.pcolor[data-i],.pxy[data-i]');
    const c = el && getPage()?.controls[+el.dataset.i];
    if (!c || el.classList.contains('p-dis')) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('p-active');
    const key = String(c.name || '').toLowerCase(), { min, max } = panelRange(c);
    const s0 = panelCtlState(c, getStatus());
    const start = { x: e.clientX, y: e.clientY, v: panelSnap(c, pNum(s0.value, min)) };
    const bright = !!e.target.closest('.pbright');
    let hsv = s0.hsv || pHsv(s0.value || '#ffffff');
    let value = c.type === 'color' ? pHex(...hsv) : start.v, sent = value, timer = 0, last = 0, done = false;
    const rect = (sel) => el.querySelector(sel).getBoundingClientRect();
    const at = (ev) => {
      if (c.type === 'slider') {
        const r = rect('.ptrack');
        const f = c.vertical ? 1 - (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width;
        return panelSnap(c, min + pClamp(f) * (max - min));
      }
      if (c.type === 'dial') return panelSnap(c, start.v + ((ev.clientX - start.x) - (ev.clientY - start.y)) / 200 * (max - min));
      if (c.type === 'xy') {   // up = the Y maximum
        const r = rect('.pxypad'), ry = panelRangeY(c);
        const x = panelSnap(c, min + pClamp((ev.clientX - r.left) / r.width) * (max - min));
        const y = panelSnap(c, ry.min + pClamp(1 - (ev.clientY - r.top) / r.height) * (ry.max - ry.min), ry);
        return panelXYText(c, x, y);
      }
      if (bright) {
        const r = rect('.pbright');
        hsv = [hsv[0], hsv[1], pClamp((ev.clientX - r.left) / r.width)];
      } else {
        const r = rect('.pwheel'), dx = (ev.clientX - r.left) / r.width * 2 - 1, dy = (ev.clientY - r.top) / r.height * 2 - 1;
        hsv = [(Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360, Math.min(1, Math.hypot(dx, dy)), hsv[2] || 1];   // from black: full brightness
      }
      return pHex(...hsv);
    };
    const flush = () => {
      timer = 0;
      if (value === sent) return;
      sent = value;
      last = Date.now();
      send(c, 'change', typeof value === 'number' ? panelFmt(c, value) : value);
    };
    const move = (ev) => {
      value = at(ev);
      panelLocal[key] = { value, hsv: c.type === 'color' ? hsv : null, until: Date.now() + 2000 };
      panelPaint(el, c, panelCtlState(c, getStatus()));
      if (!timer) timer = setTimeout(flush, Math.max(0, 80 - (Date.now() - last)));
    };
    const up = () => {
      if (done) return;
      done = true;
      el.removeEventListener('pointermove', move);
      clearTimeout(timer);
      flush();
      el.classList.remove('p-active');
      send(c, 'release');
    };
    send(c, 'press');
    if (c.type !== 'dial') move(e);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up, { once: true });
    el.addEventListener('pointercancel', up, { once: true });
  });
}
