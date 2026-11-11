'use strict';
// KD Designer web UI - Triggers page and the trigger list (selection, drag, clipboard, numbers, problems, links).
// Plain scripts sharing one global scope; load order is in index.html.

// ---- Search box above the list ---------------------------------------------------------
// Every word must appear somewhere in the trigger: name, number, type, notes, conditions,
// actions or any setting (port, address, universe, …), in any order.
const trigSearchWords = () => (S.trigFilter || '').toLowerCase().split(/\s+/).filter(Boolean);
// The trigger's searchable parts as [label, text]; label shows where a hit was found.
function trigSearchParts(x) {
  const out = [];
  for (const [k, v] of Object.entries(x)) {
    if (k === 'color' || k === 'enabled' || v == null || v === '') continue;
    if (k === 'conditions') v.forEach((c) => out.push(['if', c]));
    else if (k === 'actions') v.forEach((a) => out.push(['', a]));
    else if (k === 'notes') String(v).split('\n').forEach((l) => l.trim() && out.push(['note', l]));
    else out.push([k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
  }
  return out;
}
const trigMatches = (x, words) => {
  const all = trigSearchParts(x).map((q) => q[1]).join('\n').toLowerCase();
  return words.every((w) => all.includes(w));
};
// Indexes of the triggers the list shows (search + colour filter). A separator stays as a
// heading when something in its section is shown.
function trigVisibleIdx() {
  const p = P(), words = trigSearchWords(), cf = S.trigColors || new Set();
  if (!words.length && !cf.size) return p.triggers.map((_, i) => i);
  const own = (x) => (!words.length || trigMatches(x, words)) && (!cf.size || cf.has(trigColor(x.color) ? x.color : ''));
  // A sub section's heading also brings its main section's heading along. In a colour tab
  // only headings of that colour count (a lime trigger under the red section shows without
  // the red heading).
  const out = [];
  let main = -1, sub = -1;   // headings not shown yet
  const heads = () => { if (main >= 0) out.push(main); if (sub >= 0) out.push(sub); main = sub = -1; };
  p.triggers.forEach((x, i) => {
    if (x.type === 'comment') {
      const head = !cf.size || cf.has(trigColor(x.color) ? x.color : '') ? i : -1;
      if (x.level === 2) sub = head; else { main = head; sub = -1; }
      if (own(x)) heads();
      return;
    }
    if (!own(x)) return;
    heads();
    out.push(i);
  });
  return out;
}
// Where "+ Trigger" / "+ Separator" put a new item: with one colour tab open, that colour
// (color: '' = the no-colour tab) right after the tab's last item; otherwise at the end.
function trigAddSpot() {
  const p = P(), cf = S.trigColors || new Set();
  if (cf.size !== 1) return { at: p.triggers.length };
  const c = [...cf][0];
  let last = -1;
  p.triggers.forEach((x, i) => { if ((trigColor(x.color) ? x.color : '') === c) last = i; });
  return { color: c, at: last >= 0 ? last + 1 : p.triggers.length };
}
// The first main section of a colour (added in its tab) becomes the tab's header: it goes on top
// of that colour's triggers, which are gathered under it, just before the next main section after
// the first of them (so the section they were in stays whole). Returns the separator's index.
function insertColorHead(c, s) {
  const p = P(), key = (x) => (trigColor(x.color) ? x.color : '');
  // It carries the tab's name (a typed tab name moves into the header).
  const named = p.triggerColorNames?.[c || 'none'];
  if (named) {
    s.name = '== ' + named;
    delete p.triggerColorNames[c || 'none'];
    if (!Object.keys(p.triggerColorNames).length) delete p.triggerColorNames;
  }
  const first = p.triggers.findIndex((x) => key(x) === c);
  if (first < 0) { p.triggers.push(s); return p.triggers.length - 1; }
  let next = p.triggers.findIndex((x, i) => i > first && x.type === 'comment' && x.level !== 2 && key(x) !== c);
  if (next < 0) next = p.triggers.length;
  const mine = p.triggers.filter((x) => key(x) === c);
  const before = p.triggers.slice(0, next).filter((x) => key(x) !== c);
  const after = p.triggers.slice(next).filter((x) => key(x) !== c);
  p.triggers = [...before, s, ...mine, ...after];
  return before.length;
}
// A colour tab's header (the first main section of that colour) stays above every item of its
// colour: items of that colour that end up above it (dropped above it in the tab, moved, pasted,
// recoloured) go to just under it, in their order. So dragging a header down takes the items of
// its colour above it along, and the other sections in "All" stay as they are. Returns true if
// anything moved.
function keepColorHeads(p = P()) {
  const key = (x) => (trigColor(x.color) ? x.color : ''), heads = new Map();
  for (const x of p.triggers) if (x.type === 'comment' && x.level !== 2 && !heads.has(key(x))) heads.set(key(x), x);
  let moved = false;
  for (const [c, h] of heads) {
    const at = p.triggers.indexOf(h), stray = p.triggers.slice(0, at).filter((x) => key(x) === c);
    if (!stray.length) continue;
    const rest = p.triggers.filter((x) => !stray.includes(x));
    rest.splice(rest.indexOf(h) + 1, 0, ...stray);
    p.triggers.splice(0, p.triggers.length, ...rest);
    moved = true;
  }
  return moved;
}
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const markWords = (s, words) => (words.length
  ? s.split(new RegExp(`(${words.map(escRe).join('|')})`, 'gi')).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('')
  : esc(s));
// Up to two lines under a found trigger showing where the words are (not for the name itself).
function trigHitLines(x, words) {
  const hits = trigSearchParts(x).filter(([k, s]) => k !== 'name' && k !== 'id' && k !== 'type' && words.some((w) => s.toLowerCase().includes(w)));
  if (!hits.length) return '';
  return `<span class="trig-hits">${hits.slice(0, 2).map(([k, s]) => `<span class="fr-hit">${k ? `<b>${esc(k)}</b> ` : ''}${markWords(s, words)}</span>`).join('')}${hits.length > 2 ? `<span class="muted">+${hits.length - 2} more</span>` : ''}</span>`;
}

views.triggers = () => {
  const p = P();
  const ti = S.sel.trigger, t = p.triggers[ti];
  const f = S.trigFilter || '';
  // Colour filter: show only triggers with one of the picked colours ('' = no colour).
  const cf = S.trigColors || (S.trigColors = new Set());
  // One tab per colour that a trigger uses or that has a name (palette order, then custom
  // colours); the tab shows its name above the colour.
  const colKey = (x) => (trigColor(x.color) ? x.color : '');
  const colCount = {}, inUse = new Set(p.triggers.map(colKey));   // separators count as "in use", not in the numbers
  for (const x of p.triggers) if (x.type !== 'comment') colCount[colKey(x)] = (colCount[colKey(x)] || 0) + 1;
  const named = Object.keys(p.triggerColorNames || {}).map((k) => (k === 'none' ? '' : k)).filter((k) => k === '' || trigColor(k));
  const usedCols = [...Object.keys(TRIGGER_COLORS), ...inUse, ...named].filter((c, i, a) => a.indexOf(c) === i && (inUse.has(c) || named.includes(c)));
  for (const c of cf) if (!usedCols.includes(c)) cf.delete(c);
  const filtering = f || cf.size;
  const words = trigSearchWords();
  const shown = new Set(trigVisibleIdx());
  const nReal = p.triggers.filter((x) => x.type !== 'comment').length;
  const nShown = p.triggers.filter((x, i) => x.type !== 'comment' && shown.has(i)).length;
  const multi = p.triggers.some((x) => S.trigSel.has(x));
  const isSel = (x, i) => (multi ? S.trigSel.has(x) : i === ti);
  const selT = t && t.type !== 'comment' ? t : null;
  const links = selT ? triggerLinks(selT) : null;
  // A sub separator (level 2) and the triggers under it are indented, up to the next main one.
  const inSub = [];
  { let sub = false; p.triggers.forEach((x, i) => { if (x.type === 'comment') sub = x.level === 2; inSub[i] = sub; }); }
  const listItem = (x, i) => {
    const col = trigColor(x.color);
    if (!shown.has(i)) return '';
    // Drag to reorder: also inside a colour tab (it lands next to the row it is dropped on, the
    // hidden rows stay where they are), not while searching, where the order is ambiguous.
    const drag = f ? '' : ` data-drag="${i}"`;
    const grip = f ? '' : '<span class="act-grip trig-grip" title="Drag to move (the whole selection when this one is selected)">⠿</span>';
    const sel = isSel(x, i) ? ' sel' : '';
    const note = x.notes?.trim() ? `<span class="note-mark" title="${esc(x.notes.trim())}">✎</span>` : '';
    if (x.type === 'comment')
      return `<div class="item sep ${x.level === 2 ? 'sub' : 'main'}${sel}" data-sel="trigger:${i}"${drag} style="${col ? `--tc:${col};color:${col}` : ''}">${grip}<span class="tname" style="flex:1">${markWords(x.name || '—', words)}</span>${note}</div>`;
    // Connections of the selected trigger: → it sets this one off, ← this one sets it off.
    const lo = links?.out.find((l) => l.t === x), li = links?.in.find((l) => l.t === x);
    const linkCls = lo || li ? ` linked${lo ? ' link-out' : ''}${li ? ' link-in' : ''}` : '';
    const linkTag = trigLinkMarks(selT, lo, li);
    const probs = triggerProblems(x);
    const bang = probs.length ? `<span class="trig-err" title="${esc(probs.join('\n'))}">!</span>` : '';
    const from = `<span class="trig-io">${trigIoHtml(x)}</span>`;
    return `<div class="item${sel}${inSub[i] ? ' in-sub' : ''}${x.enabled === false ? ' disabled' : ''}${col ? ' tinted' : ''}${linkCls}${probs.length ? ' has-err' : ''}" data-sel="trigger:${i}"${drag} style="${col ? `--tc:${col}` : ''}">
      ${grip}<span class="id">${x.id}</span>${bang}<span class="tname" style="flex:1;min-width:0">${markWords(x.name, words)}${words.length ? trigHitLines(x, words) : ''}</span>${note}${from}${linkTag}${dupName(x) ? '<span class="tag mon-warn" title="Another trigger has the same name: fire trigger &lt;name&gt; can’t tell them apart">same name</span>' : ''}${x.onlyIn?.group ? `<span class="tag" title="Only active when ${esc(x.onlyIn.group)} is ${esc((x.onlyIn.states || []).join(' or '))}">◇ ${esc((x.onlyIn.states || []).join('/'))}</span>` : ''}${x.conditions?.length ? `<span class="tag tt tt-if" title="${esc(x.conditions.join('\n'))}">if</span>` : ''}<span class="tag tt tt-${esc(x.type)}">${esc(x.type === 'time' && (x.at === 'sunrise' || x.at === 'sunset') ? x.at : x.type)}</span><button class="list-fire" data-fire="${x.id}" title="Fire now (runs the saved version on the controller)">▶</button></div>`;
  };
  return `<h2 class="trig-head">Triggers <label class="muted flow-toggle" title="Triggers in the list (and the flow diagram) light up when they fire on the controller, one after the other as they really run"><input type="checkbox" id="trigLive"${trigLiveOn() ? ' checked' : ''}> light up when fired</label>
    <label class="muted flow-toggle" title="A diagram of which triggers and timelines set off which triggers"><input type="checkbox" id="trigFlow"${trigFlowOn() ? ' checked' : ''}> show flow</label>
    <label class="muted flow-toggle" title="When each trigger fired, on a time line (the controller keeps the last 512 fires)"><input type="checkbox" id="trigHist"${trigHistOn() ? ' checked' : ''}> show history</label>
    <span class="spacer"></span><button class="btn small${S.trigTool === 'templates' ? ' on' : ''}" data-trigtool="templates" title="Ready-made triggers to add">Templates…</button>
    <button class="btn small${S.trigTool === 'replace' ? ' on' : ''}" data-trigtool="replace" title="Find and replace in actions, conditions, names and notes (Ctrl+H)">Find &amp; replace…</button></h2>
    ${trigToolHtml()}${trigHistOn() ? trigHistHtml() : ''}${trigFlowOn() ? trigFlowHtml(selT) : ''}<div class="split trig-split">
    <div><div class="row nowrap trig-search"><input id="trigFilter" type="search" placeholder="Search triggers: name, command, IP, port… (Ctrl+F)" value="${esc(f)}" style="flex:1"
        title="Shows the triggers that contain all the words, anywhere: name, notes, conditions, actions, steps or settings. Enter opens the first one, Esc clears.">
      ${filtering ? `<span class="muted" style="white-space:nowrap">${nShown} of ${nReal}</span>` : ''}${f ? '<button class="btn small ghost" id="trigFilterClear" title="Clear the search (Esc)">✕</button>' : ''}</div>
    ${usedCols.length > 1 || named.length ? `<div class="trig-tabs" title="Click a tab to show only its triggers, Ctrl+click to add more tabs. Double-click a tab to give it a name.">
      <button class="trig-tab all${cf.size ? '' : ' on'}" data-colfilter-clear><span class="tab-name">All</span><span class="tab-n">${nReal}</span></button>
      ${usedCols.map((c) => `<button class="trig-tab${cf.has(c) ? ' on' : ''}${trigColorName(c) ? '' : ' unnamed'}${c ? '' : ' nocol'}" data-colfilter="${esc(c)}" style="${c ? `--tc:${trigColor(c)}` : ''}"
        title="${esc(trigColorLabel(c))}: ${colCount[c] || 0} trigger${colCount[c] === 1 ? '' : 's'}. Double-click to ${trigColorName(c) ? 'rename' : 'name'}."><span class="tab-name">${esc(trigColorLabel(c))}</span><span class="tab-n">${colCount[c] || 0}</span></button>`).join('')}</div>` : ''}
    <div class="list trig-list">${p.triggers.map(listItem).join('')}${filtering && !nShown ? '<p class="muted" style="margin:8px">No trigger matches.</p>' : ''}</div>
    <div class="row" style="margin-top:8px"><button class="btn small" data-add="trigger">+ Trigger</button><button class="btn small" data-add="separator">+ Separator</button><button class="btn small" data-trigtool="templates">+ From template</button>
      ${t ? `<button class="btn small ghost" data-move="-1" title="Move ${multi && S.trigSel.size > 1 ? 'the selected triggers' : 'it'} up (Alt+↑)">▲</button><button class="btn small ghost" data-move="1" title="Move ${multi && S.trigSel.size > 1 ? 'the selected triggers' : 'it'} down (Alt+↓)">▼</button>` : ''}</div>
    <p class="muted keys"><span class="io-grp in" style="vertical-align:middle">${devIcon('device')}</span> what sets it off → <span class="io-grp out" style="vertical-align:middle">${devIcon('device')}</span> devices it controls · ▶ fire now</p>
    <p class="muted keys">Ctrl/Shift+click to select several · drag or Alt+↑↓ to move · Ctrl+C / X / V copy, cut & paste · Ctrl+D duplicate · Del delete · ↑↓ select · Ctrl+A all</p></div>
    <div>${trigEditorHtml(p, ti, t, multi, links)}</div></div>`;
};
// The right-hand pane: the editor of the selected trigger, or the multi-edit form when several
// are selected. Built on its own when the selection changes (trigSelectUi): the list stays.
// → the selected trigger sets this row's trigger off, ← this one sets the selected one off.
const trigLinkMarks = (selT, lo, li) => (lo ? `<span class="link-mark out" title="${esc(selT.name)} → ${esc(lo.why)}">→</span>` : '') +
  (li ? `<span class="link-mark in" title="${esc(li.why)} → ${esc(selT.name)}">←</span>` : '');
function trigEditorHtml(p, ti, t, multi, links) {
  const base = `triggers.${ti}`;
  let params = '';
  if (t) {
    switch (t.type) {
      case 'time':
      {
        const sun = t.at === 'sunrise' || t.at === 'sunset';
        const sunToday = S.status?.clock?.[t.at];
        params = `<label>At</label><div class="row nowrap">
            <select id="timeMode"><option value="time"${sun ? '' : ' selected'}>clock time</option><option value="sunrise"${t.at === 'sunrise' ? ' selected' : ''}>sunrise</option><option value="sunset"${t.at === 'sunset' ? ' selected' : ''}>sunset</option></select>
            ${sun ? `<input type="number" step="1" min="-720" max="720" data-p="${base}.offset" data-t="num" value="${t.offset || 0}" style="width:80px" title="minutes; negative = before">
              <span class="muted">min ${sunToday ? `(today ${sunToday}${t.offset ? ` ${t.offset > 0 ? '+' : ''}${t.offset} min` : ''})` : P().settings.location.lat == null ? '· set the location on the Schedule page' : ''}</span>`
              : `<input type="time" step="1" data-p="${base}.at" value="${esc(t.at || '20:00:00')}">`}</div>
          <label>Days</label><div class="row">${DAYS.map((d) => `<label class="muted"><input type="checkbox" data-day="${d}"${!t.days || t.days.includes(d) ? ' checked' : ''}> ${d}</label>`).join('')}</div>
          <label></label><span class="muted">Combine with conditions like <code>calendar Closed inactive</code> for holidays.</span>`;
        break;
      }
      case 'variable':
        params = `<label>Variable</label><select data-p="${base}.variable"><option value="">any variable</option>${p.variables.map((v) => `<option${t.variable === v.name ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select>
          <label>Becomes</label><input data-p="${base}.value" value="${esc(t.value || '')}" placeholder="any value (or e.g. 1, on, open)">`;
        break;
      case 'tcp':
        params = `<label>TCP device</label><select data-p="${base}.device"><option value="">any TCP device</option>${p.tcp.map((d) => `<option${t.device === d.name ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
          <label>Message</label><input data-p="${base}.match" value="${esc(t.match ?? '*')}" placeholder="* (any)   or   READY   or   POS*  (prefix)">`;
        break;
      case 'http':
        params = `<label>URL starts with</label><input data-p="${base}.url" value="${esc(t.url || '')}" placeholder="any response, or e.g. http://10.0.0.20/api">
          <label></label><span class="muted">Fires when a response arrives for a request made with <code>http get …</code>.</span>`;
        break;
      case 'interval': params = `<label>Every (s)</label><input type="number" min="1" step="0.1" data-p="${base}.seconds" data-t="num" value="${t.seconds || 60}">`; break;
      case 'udp':
        params = `<label>Message</label><input data-p="${base}.match" value="${esc(t.match || '')}" placeholder="GO   or   SHOW*  (prefix)">
          <label>Listen port</label><input type="number" min="1" max="65535" data-p="${base}.port" data-t="num" value="${t.port ?? ''}" placeholder="${p.settings.udpPort} (default)">
          <label>From IP</label><input data-p="${base}.fromIp" value="${esc(t.fromIp || '')}" placeholder="any sender" pattern="^(\\d{1,3}\\.){3}\\d{1,3}$">
          ${latestField(t, base)}
          <label></label><span class="muted">Max 6 different ports in total. On the default port, messages starting with <code>cmd:</code> are executed directly.</span>`;
        break;
      case 'osc':
        params = `<label>OSC address</label><input data-p="${base}.address" value="${esc(t.address || '')}" placeholder="/show/start   or   /cue/*  (* and ? wildcards)">
          <label>Listen port</label><input type="number" min="1" max="65535" data-p="${base}.port" data-t="num" value="${t.port ?? ''}" placeholder="${p.settings.udpPort} (default)">
          <label>From IP</label><input data-p="${base}.fromIp" value="${esc(t.fromIp || '')}" placeholder="any sender">
          ${latestField(t, base)}`;
        break;
      case 'mode':
      {
        const gr = p.modes.find((g) => g.name === t.group);
        const states = gr ? gr.states : [...new Set(p.modes.flatMap((g) => g.states))];
        params = `<label>Mode group</label><select data-p="${base}.group" data-r><option value="">any group</option>${p.modes.map((g) => `<option${t.group === g.name ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}</select>
          <label>Changes to</label><select data-p="${base}.mode"><option value="">any state</option>${states.map((s) => `<option${t.mode === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>`;
        break;
      }
      case 'panel': {
        const btns = panelButtons(), ev = t.event || 'click';
        const evs = [['click', 'click'], ['press', 'press'], ['release', 'release'], ['hold', 'hold (long press)'], ['double', 'double click'], ['change', 'change (slider, dial, colour, XY pad, toggle)']];
        const kind = panelControlType(t.control);
        params = `<label>Control</label><select data-p="${base}.control" data-r><option value="">— choose —</option>${btns.map((b) => `<option${t.control === b ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>
          <label>Event</label><select data-p="${base}.event" data-r>${evs.map(([e, n]) => `<option value="${e}"${ev === e ? ' selected' : ''}>${n}</option>`).join('')}</select>
          ${holdDoubleFields(t, base, ev)}
          <label></label><span class="muted">${!btns.length ? 'Add controls on the Panel page first.' : ev === 'hold' ? 'Fires once the button is held down this long; letting go earlier does nothing.'
            : ev === 'double' ? 'Fires on the second click. A click trigger on the same button still fires on every click.'
            : ev === 'change' ? `Fires while the control moves (up to about 12 times a second) and once more when it is let go. <code>{value}</code> is the new value${kind === 'color' ? ' (#rrggbb); <code>{r} {g} {b}</code> are 0-255' : kind === 'xy' ? ' (x,y); <code>{x}</code> and <code>{y}</code> are the two parts' : kind === 'toggle' ? ' (1 = on, 0 = off)' : ''}.`
            : 'Click = released over the button (after any confirm dialog). Press/release fire immediately; on a slider, dial or wheel they are touching and letting go.'}</span>`;
        break;
      }
      case 'calendar': {
        // Triggers.cpp poll: checked every second, fires when the period starts or ends.
        const names = [...new Set(p.calendar.map((e) => e.name).filter(Boolean))];
        params = `<label>Calendar period</label><select data-p="${base}.calendar" data-r><option value="">— choose —</option>${names.map((n) => `<option${t.calendar === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}
            ${t.calendar && !names.includes(t.calendar) ? `<option selected>${esc(t.calendar)} (missing)</option>` : ''}</select>
          <label>Fires when it</label><select data-p="${base}.state">${[['active', 'becomes active (the period starts)'], ['inactive', 'becomes inactive (the period ends)']].map(([k, n]) => `<option value="${k}"${(t.state || 'active') === k ? ' selected' : ''}>${n}</option>`).join('')}</select>
          <label></label><span class="muted">${names.length ? '' : 'Add periods on the Schedule page first. '}Periods are whole days, so this fires just after midnight, or when an edit of the calendar starts or ends one today.
            Not at power-up: for that, use a Startup trigger with the condition <code>calendar ${esc(t.calendar || 'Closed')} active</code>.</span>`;
        break;
      }
      case 'dmx_in': {
        const sacn = t.protocol === 'sacn', when = t.when || 'change';
        params = `<label>Protocol</label><select data-p="${base}.protocol" data-r>${[['artnet', 'Art-Net'], ['sacn', 'sACN (E1.31)']].map(([k, n]) => `<option value="${k}"${(t.protocol || 'artnet') === k ? ' selected' : ''}>${n}</option>`).join('')}</select>
          <label>Universe</label><div class="row nowrap"><input type="number" min="${sacn ? 1 : 0}" max="${sacn ? 63999 : 32767}" data-p="${base}.universe" data-t="num" value="${t.universe ?? (sacn ? 1 : 0)}" style="width:90px">
            <span class="muted">${sacn ? '1-63999' : 'port address: 0 = 0:0:0, 1 = 0:0:1, 16 = 0:1:0'}</span></div>
          <label>Channels</label><input data-p="${base}.channels" value="${esc(t.channels || '1')}" placeholder="1 or 1-8 or 1,3,5-8">
          <label>Fires when</label><select data-p="${base}.when" data-r>${[['change', 'the value changes'], ['above', 'it goes up to the level or above'], ['below', 'it drops below the level']].map(([k, n]) => `<option value="${k}"${when === k ? ' selected' : ''}>${n}</option>`).join('')}</select>
          ${when === 'change' ? '' : `<label>Level</label><div class="row nowrap"><input type="number" min="0" max="255" data-p="${base}.level" data-t="num" value="${t.level ?? 128}" style="width:90px"><span class="muted">0-255 (${Math.round((t.level ?? 128) / 2.55)} %)</span></div>`}
          <label></label><span class="muted">Like a DMX-in trigger in Pharos: a lighting desk or media server sends this universe to the controller. Fires per channel; {value} is the new level.
            ${sacn ? 'sACN by multicast works for one universe (the first sACN one used); for more, let the desk send unicast to the controller’s IP.' : ''}
            In the PC mock, type in the console: <code>dmxin ${sacn ? 'sacn' : 'artnet'} ${t.universe ?? (sacn ? 1 : 0)} ${esc((t.channels || '1').split(/[-,]/)[0])} 255</code></span>`;
        break;
      }
      case 'dmx_change':
        params = `<label>Universe</label><select data-p="${base}.universe" data-t="num">${opts(p.universes, t.universe, (u) => `${u.id} · ${u.name}`)}</select>
          <label>Channels</label><input data-p="${base}.channels" value="${esc(t.channels || '1')}" placeholder="1-17 or 1,3,5-8">
          <label>Tables</label><textarea id="tables" rows="4" class="mono" spellcheck="false" placeholder="puppet: K,K,K,E,E,E&#10;range: 7850,5000,5000">${esc(Object.entries(t.tables || {}).map(([k, v]) => `${k}: ${v.join(',')}`).join('\n'))}</textarea>
          <label></label><span class="muted">Fires for every channel that changes. A table gives each channel (by index) its own value, e.g.
            <code>send udp motors "{puppet}{=ceil(value*range/255)}\\r"</code></span>`;
        break;
      case 'device':
        params = `<label>Device</label><select data-p="${base}.device"><option value="">any monitored device</option>${monitoredNames().map((n) => `<option${t.device === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
          <label>Goes</label><select data-p="${base}.state">${['offline', 'online', 'any'].map((s) => `<option${(t.state || 'offline') === s ? ' selected' : ''}>${s}</option>`).join('')}</select>
          <label></label><span class="muted">Checked every ${P().settings.monitor?.interval || 60} s (Monitoring page). E.g. <code>email tech@site.nl "{device} {state}" Please check</code></span>`;
        break;
      case 'projector': {
        // Mirrors Triggers::onProjectorAlarm: an ERST part gets worse / errors / clears, or the lamp hours reach a limit.
        const alarm = t.alarm || 'any', lamp = alarm === 'lamp_hours';
        const alarms = [['any', 'any error status'], ...['fan', 'lamp', 'temperature', 'cover', 'filter', 'other'].map((k) => [k, k]), ['lamp_hours', 'lamp hours reach a limit']];
        params = `<label>Projector</label><select data-p="${base}.projector"><option value="">any projector</option>${p.projectors.map((x) => `<option${t.projector === x.name ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
          <label>Alarm</label><select data-p="${base}.alarm" data-r>${alarms.map(([k, n]) => `<option value="${k}"${alarm === k ? ' selected' : ''}>${n}</option>`).join('')}</select>
          ${lamp ? `<label>Limit</label><div class="row nowrap"><input type="number" min="1" step="100" data-p="${base}.hours" data-t="num" value="${t.hours ?? 3000}" style="width:100px"><span class="muted">hours</span></div>`
            : `<label>Fires when</label><select data-p="${base}.level">${[['warning', 'it gets worse (warning or error)'], ['error', 'it becomes an error'], ['ok', 'it is ok again']].map(([k, n]) => `<option value="${k}"${(t.level || 'warning') === k ? ' selected' : ''}>${n}</option>`).join('')}</select>`}
          <label></label><span class="muted">Checked over PJLink every ${P().settings.monitor?.interval || 60} s. An alarm that is already there fires once after the controller starts. E.g.
            <code>email tech@site.nl "{projector}: {alarm} {state}" Lamp {lamp} h</code></span>`;
        break;
      }
      case 'manual':
        params = `<label></label><span class="muted">Only runs when fired by another trigger (<code>fire trigger ${esc(quote(t.name || String(t.id)))}</code>), a repeat, or "Fire now". Use it for nested task lists.</span>`;
        break;
      case 'input': {
        // A Machine Control point (in3, io5 set as input, ai0), or a raw Portenta pin.
        const io = t.io || '', analog = /^a[io]/.test(io);
        const ins = pmcKeys().filter((k) => !/^(out|ao)/.test(k));
        const lbl = (k) => `${k}${pmcCfg(k).name ? ' · ' + pmcCfg(k).name : ''}${/^io/.test(k) && pmcIsOut(k) ? ' (set as output!)' : ''}`;
        params = `<label>Input</label><select data-p="${base}.io" data-r><option value=""${io ? '' : ' selected'}>Portenta pin (GPIO number)</option>
            ${PMC_GROUPS.filter(([g]) => g !== 'out' && g !== 'ao').map(([g, , name]) => `<optgroup label="Machine Control · ${name}">${ins.filter((k) => k.startsWith(g) && /^\d+$/.test(k.slice(g.length))).map((k) => `<option value="${k}"${io === k ? ' selected' : ''}>${esc(lbl(k))}</option>`).join('')}</optgroup>`).join('')}
            ${io && !ins.includes(io) ? `<option selected>${esc(io)}</option>` : ''}</select>
          ${io ? '' : `<label>Pin</label><input type="number" min="0" data-p="${base}.pin" data-t="num" value="${t.pin ?? 0}">`}
          ${analog ? `<label>Level</label><div class="row nowrap"><input type="number" step="0.1" data-p="${base}.level" data-t="num" value="${t.level ?? 5}" style="width:90px"><span class="muted">${pmcUnit(io)} · fires when the reading crosses this level (rising = goes above)</span></div>` : ''}
          <label>Edge</label><select data-p="${base}.edge" data-r>${[['rising', 'rising'], ['falling', 'falling'], ['both', 'both'], ['hold', 'hold (on for a while)'], ['double', 'double press']].map(([e, n]) => `<option value="${e}"${(t.edge || 'rising') === e ? ' selected' : ''}>${n}</option>`).join('')}</select>
          ${holdDoubleFields(t, base, t.edge)}
          ${io ? `<label></label><span class="muted">${analog ? '' : 'Rising = the input switches on (24 V). '}{input} is the point, {value} its value. Set the inputs up on Devices → Machine Control.</span>` : ''}`;
        break;
      }
      case 'timeline_end': params = `<label>Timeline</label><select data-p="${base}.timeline" data-t="num">${opts(p.timelines, t.timeline)}</select>`; break;
    }
  }
  const custom = t && t.color && !TRIGGER_COLORS[t.color] ? t.color : '';
  const vars = t && TRIGGER_VARS[t.type];
  const selT = links ? t : null;
  return multi && S.trigSel.size > 1 ? multiEditHtml(p.triggers.filter((x) => S.trigSel.has(x))) : t ? `
      <div class="row nowrap">${t.type === 'comment' ? '' : `<label class="muted" title="The trigger's number = its place in the list. Type a number to move it there.">#</label>
        <input type="number" id="trigNum" min="1" value="${t.id}" style="width:70px;font-size:16px" title="Type a number to move this trigger there">`}
        <input data-p="${base}.name" value="${esc(t.name)}" style="font-size:16px;flex:1" placeholder="${t.type === 'comment' ? '== SECTION NAME' : ''}" class="${dupName(t) ? 'invalid' : ''}" data-r>
        ${t.type === 'comment' ? '' : `<button class="btn" data-fire="${t.id}" title="Run the saved version of this trigger on the controller">Fire now</button>
          <button class="btn" id="trigTest" title="Fire it now (the saved version) and show, line by line, which conditions were true and what each action did">Test</button>`}
        <button class="btn small ghost" data-del="${base}">Delete</button></div>
      ${t.type !== 'comment' && S.trigTest?.id === t.id ? trigTestHtml(t) : ''}
      <textarea class="trig-notes" data-p="${base}.notes" rows="${Math.min(10, Math.max(2, (t.notes || '').split('\n').length))}" placeholder="${t.type === 'comment' ? 'Notes about this section…' : 'Notes: what this trigger is for, who triggers it, what to watch out for…'}">${esc(t.notes || '')}</textarea>
      <div id="trigProbs">${trigProbsHtml(t)}</div>
      ${dupName(t) ? `<p class="bad" style="margin:6px 0 0">Another trigger (#${p.triggers.filter((x) => x !== t && x.type !== 'comment' && x.name.toLowerCase() === t.name.toLowerCase()).map((x) => x.id).join(', #')}) has this name, so <code>fire trigger "${esc(t.name)}"</code> can’t tell them apart. Rename one of them.</p>` : ''}
      ${links ? `<div class="links">${trigLinksHtml(selT, links)}</div>` : ''}
      <div class="form" style="margin-top:12px">
        ${t.type === 'comment' ? '' : `<label>Enabled</label><input type="checkbox" data-p="${base}.enabled" data-t="bool"${t.enabled !== false ? ' checked' : ''} data-r>`}
        <label>Type</label><select data-p="${base}.type" data-r>${TRIGGER_TYPES.map(([v, n]) => `<option value="${v}"${t.type === v ? ' selected' : ''}>${n}</option>`).join('')}</select>
        ${t.type === 'comment' ? `<label title="Main section = big heading. Sub section = smaller heading, indented with its triggers, under the main section above it.">Level</label>
          <select data-p="${base}.level" data-t="num" data-r style="max-width:260px"><option value="1"${t.level === 2 ? '' : ' selected'}>Main section (big heading)</option><option value="2"${t.level === 2 ? ' selected' : ''}>Sub section (indented)</option></select>` : ''}
        <label>Colour</label><div class="row swatches">${Object.entries(TRIGGER_COLORS).map(([k, c]) => `<label class="swatch${(t.color || '') === k ? ' on' : ''}" title="${k || 'none'}" style="${k ? `background:${c}` : ''}"><input type="radio" name="tcol" data-p="${base}.color" value="${k}"${(t.color || '') === k ? ' checked' : ''} data-r>${k ? '' : '∅'}</label>`).join('')}
          <label class="swatch custom${custom ? ' on' : ''}" title="Custom colour" style="${custom ? `background:${custom}` : ''}">${custom ? '' : '+'}<input type="color" data-p="${base}.color" value="${custom || '#4aa3ff'}" data-r></label></div>
        ${trigColorHead(t.color) === t ? '<label>Tab</label><span class="muted">This section names the colour tab above the list (renaming one renames the other).</span>'
          : `<label title="The name of this colour's tab above the trigger list. It counts for every trigger with this colour.${trigColorHead(t.color) ? ' It is also the name of the main section with this colour.' : ''}">Tab name</label>
        <input id="trigTabName" value="${esc(trigColorName(t.color))}" placeholder="${esc(trigColorLabel(t.color))}, e.g. Projectors" style="max-width:260px">`}
        ${params}
        ${t.type === 'comment' ? '' : behaviourFields(t, base)}
      </div>
      ${t.type === 'comment' ? '<p class="muted">Separators only organise the list, like the Pharos separator module.</p>' : `
      <h3>Conditions</h3>
      <p class="muted" style="margin:0 0 8px">All must be true when the trigger fires, otherwise it is skipped: its row flashes grey/red with “✕ if”, and the log says which condition was false.</p>
      ${t.conditions.map((c, i) => `<div class="row" style="margin-bottom:6px;flex-wrap:nowrap">
        <input class="cond cmd-like" data-p="${base}.conditions.${i}" value="${esc(c)}" spellcheck="false" autocomplete="off" placeholder="mode is Show">
        <button class="btn small" data-build="${base}.conditions.${i}" data-grammar="cond" title="Build with menus">⚙</button>
        <button class="btn small ghost" data-del="${base}.conditions.${i}">✕</button></div>`).join('')}
      <button class="btn small" data-add="condition">+ Condition</button>
      <h3>Actions</h3>
      ${vars ? `<p class="muted" style="margin:0 0 8px">Variables: ${vars.map((v) => `<code>{${esc(v)}}</code>`).join(' ')} · maths with <code>{=ceil(value*100/255)}</code></p>` : ''}`}
      ${t.type === 'comment' ? '' : `<p class="muted" style="margin:0 0 8px">One command per line, run in order. Type with autocomplete (Tab/Enter), or use ⚙ to build a command from menus.
        Hover a word to see what it does; red means invalid. Lines starting with <code>#</code> are comments. Escapes in sent text: <code>\\r \\n \\t \\xNN</code>.
        Pauses: <code>sleep 2</code>, <code>wait until timeline 2 stopped</code> (add <code>timeout 30</code> to give up). Loops: <code>repeat "Flash once" 8 times every 0.5</code> fires a trigger 8 times, or <code>repeat 8 times every 0.5 io out{=i-1} on</code> for one command ({i} counts 1, 2, 3…).</p>
      <div id="trigActs">${t.actions.map((a, i) => `<div class="row act-row" data-act="${i}" style="margin-bottom:6px;flex-wrap:nowrap">
        <span class="act-grip" title="Drag to change the order">⠿</span>
        <input class="cmd" data-p="${base}.actions.${i}" value="${esc(a)}" spellcheck="false" autocomplete="off">
        <button class="btn small" data-build="${base}.actions.${i}" title="Build with menus">⚙</button>
        <button class="btn small" data-test="${base}.actions.${i}">Test</button>
        <button class="btn small ghost" data-del="${base}.actions.${i}">✕</button></div>`).join('')}</div>
      <button class="btn small" data-add="action">+ Action</button>`}`
    : '<span class="muted">Select or create a trigger.</span>';
}
// Type a name into a colour tab (Enter or leaving the box keeps it, Esc cancels, empty = no name).
function renameColorTab(c) {
  const b = $$('.trig-tab[data-colfilter]').find((x) => x.dataset.colfilter === c);
  if (!b) return;
  const box = document.createElement('div');
  box.className = 'trig-tab on editing';
  box.style.cssText = b.style.cssText;
  const inp = document.createElement('input');
  inp.className = 'tab-edit';
  inp.value = trigColorName(c);
  inp.placeholder = trigColorLabel(c);
  box.append(inp);
  b.replaceWith(box);
  inp.focus();
  inp.select();
  let done = false;
  const finish = (keep) => { if (done) return; done = true; if (keep) setTrigColorName(c, inp.value); render(); };
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  inp.addEventListener('blur', () => finish(true));
}
// ---- Test: fire the saved trigger and show what each line did (Triggers::test / the mock's
// trace). S.trigTest = {id, at, ok, reply, lines: [{k: c|a|n, i, ok, t, r}], dirty, old}.
async function trigTest(t) {
  const dirty = S.dirty;
  try {
    const r = await api(`/api/trigger?id=${t.id}&test=1`, { method: 'POST' });
    S.trigTest = { id: t.id, at: Date.now(), ok: r.ok, reply: r.reply, lines: r.lines, dirty, old: !Array.isArray(r.lines) };
  } catch (err) { S.trigTest = { id: t.id, at: Date.now(), ok: false, reply: err.message, lines: [], dirty }; }
  render();
}
function trigTestHtml(t) {
  const x = S.trigTest, lines = x.lines || [];
  const skip = (l) => l.k === 'a' && (!(l.t || '').trim() || (l.t || '').trim().startsWith('#'));   // comment / empty line
  const conds = lines.filter((l) => l.k === 'c'), acts = lines.filter((l) => l.k === 'a'), bad = conds.find((l) => !l.ok);
  const real = acts.filter((l) => !skip(l));
  const icon = (l) => (skip(l) ? '<span class="muted">·</span>' : l.ok ? '<span class="tt-ok">✓</span>' : '<span class="tt-bad">✕</span>');
  const row = (l, label) => `<div class="tt-line${l.ok ? '' : ' bad'}">${icon(l)}<span class="muted tt-what">${label}</span><code>${esc(l.t || '')}</code>${l.r ? `<span class="muted tt-r">${esc(l.r)}</span>` : ''}</div>`;
  const nActs = (t.actions || []).length;
  // Lines it never got to (a false condition, or after a sleep / wait / loop).
  const notRun = !bad && x.ok && acts.length < nActs && acts.length ? nActs - (acts[acts.length - 1].i + 1) : 0;
  let head;
  if (x.old) head = `<b>Fired</b> <span class="muted">${esc(x.reply || '')} - this controller's firmware can't show the lines yet (update it).</span>`;
  else if (!x.ok) head = `<b class="bad">Not fired:</b> <span>${esc(x.reply || '')}</span>`;
  else if (bad) head = `<b class="bad">Condition false: the actions did not run</b>`;
  else head = `<b>Fired</b> <span class="muted">${conds.length ? `${conds.length} condition${conds.length > 1 ? 's' : ''} true · ` : ''}${real.filter((l) => l.ok).length} of ${real.length} action line${real.length === 1 ? '' : 's'} OK</span>`;
  return `<div class="trig-test card">
    <div class="row nowrap">${head}<span class="spacer"></span><span class="muted">${new Date(x.at).toLocaleTimeString()}</span>
      <button class="btn small" id="trigTestAgain" title="Test again">↻</button><button class="btn small ghost" id="trigTestX" title="Close">✕</button></div>
    ${x.dirty ? '<p class="muted" style="margin:4px 0">You have unsaved changes: this tested the saved version on the controller.</p>' : ''}
    ${lines.map((l) => (l.k === 'c' ? row(l, 'if') : l.k === 'a' ? row(l, `${l.i + 1}`) : `<div class="tt-line note${l.ok ? '' : ' bad'}">${l.ok ? '<span class="muted">ℹ</span>' : '<span class="tt-bad">✕</span>'}<span>${esc(l.t)}</span></div>`)).join('')}
    ${!x.old && x.ok && !lines.length ? '<p class="muted" style="margin:4px 0">Nothing ran (no conditions, no actions - or it is disabled / not on the controller yet: save first).</p>' : ''}
    ${notRun > 0 ? `<p class="muted" style="margin:4px 0">${notRun} line${notRun > 1 ? 's' : ''} below run later; watch the log for them.</p>` : ''}</div>`;
}
views.triggers.after = () => {
  // Keep the list's own scroll position across re-renders.
  const list = $('.trig-list');
  list.scrollTop = S.trigScroll || 0;
  list.addEventListener('scroll', () => (S.trigScroll = list.scrollTop));
  initTriggerDrag(list);
  $('#trigFlow').addEventListener('change', (e) => { setTrigFlow(e.target.checked); render(); });
  $('#trigLive').addEventListener('change', (e) => { setTrigLive(e.target.checked); render(); });
  $('#trigHist').addEventListener('change', (e) => { setTrigHist(e.target.checked); render(); });
  trigToolAfter();
  updateTrigRunning();
  trigFlowAfter();
  $('#trigFilter').addEventListener('input', (e) => {
    S.trigFilter = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const inp = $('#trigFilter');
    inp.focus();
    inp.setSelectionRange(pos, pos);
  });
  $('#trigFilter').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!S.trigFilter) { e.target.blur(); return; }
      S.trigFilter = '';
      render();
      $('#trigFilter').focus();
    } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
      // Open the first found trigger (Enter) and carry on with ↑/↓ in the list.
      e.preventDefault();
      const first = trigVisibleIdx().find((i) => P().triggers[i].type !== 'comment');
      if (first == null) return;
      selectTriggers([first]);
      trigSelectUi();
    }
  });
  $('#trigFilterClear')?.addEventListener('click', () => { S.trigFilter = ''; render(); });
  // Any edit in the trigger editor may fix or cause a problem, and change the flow (also
  // while typing an action, shortly after the last key).
  const editor = $('#main .split > div:last-child');
  editor?.addEventListener('change', (e) => setTimeout(() => {
    // A new colour may put it above its colour tab's header: the header follows (keepColorHeads).
    if (/\.color$/.test(e.target.dataset?.p || '') && keepColorHeads()) { selectTriggers([P().triggers.indexOf(S.trigEditing)]); renumberTriggers(); markDirty(); render(); return; }
    refreshTrigProblems(); refreshTrigFlow(); refreshTrigIcons();
  }));
  let flowTimer = 0;
  editor?.addEventListener('input', (e) => {
    if (!e.target.matches('.cmd, .cond')) return;
    clearTimeout(flowTimer);
    // Fields only commit on "change": take the line as typed so far (like Save does).
    flowTimer = setTimeout(() => { if (e.target.isConnected) { onBound({ target: e.target, type: 'input' }); refreshTrigIcons(); if ($('.trig-flow-wrap')) refreshTrigFlow(); } }, 600);
  });
  // Colour tabs: click = only this tab (clicking it again keeps it, so a double-click can
  // rename), Ctrl/Shift+click = add or remove a tab, All = everything.
  $$('[data-colfilter]').forEach((b) => {
    b.addEventListener('click', (e) => {
      const c = b.dataset.colfilter;
      if (e.ctrlKey || e.metaKey || e.shiftKey) { if (S.trigColors.has(c)) S.trigColors.delete(c); else S.trigColors.add(c); }
      else if (S.trigColors.size === 1 && S.trigColors.has(c)) return;
      else S.trigColors = new Set([c]);
      render();
    });
    b.addEventListener('dblclick', (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      renameColorTab(b.dataset.colfilter);
    });
  });
  $('[data-colfilter-clear]')?.addEventListener('click', () => { if (!S.trigColors.size) return; S.trigColors.clear(); render(); });
  trigEditorAfter();
  trigRevealSel(list);
};
// Wires the editor pane: after render(), and after trigSelectUi() rebuilt only the pane.
function trigEditorAfter() {
  $('#trigTest')?.addEventListener('click', () => trigTest(P().triggers[S.sel.trigger]));
  $('#trigTestAgain')?.addEventListener('click', () => trigTest(P().triggers[S.sel.trigger]));
  $('#trigTestX')?.addEventListener('click', () => { S.trigTest = null; render(); });
  if ($('#trigActs')) initActionDrag($('#trigActs'), P().triggers[S.sel.trigger]);
  const tabName = $('#trigTabName');
  tabName?.addEventListener('change', () => { setTrigColorName(P().triggers[S.sel.trigger].color, tabName.value); render(); });
  tabName?.addEventListener('keydown', (e) => { if (e.key === 'Enter') tabName.blur(); });
  // Name: update the list while typing; references follow when the field is left (change).
  const nameIn = $(`[data-p="triggers.${S.sel.trigger}.name"]`);
  if (nameIn) {
    const t = P().triggers[S.sel.trigger];
    nameIn.dataset.orig = t.name;
    nameIn.addEventListener('input', () => {
      t.name = nameIn.value;
      const item = $(`.trig-list [data-sel="trigger:${S.sel.trigger}"]`);
      if (item) item.querySelector('.tname').textContent = t.name || (t.type === 'comment' ? '—' : '');
      // A main section names its colour's tab: follow while typing.
      const key = trigColor(t.color) ? t.color : '';
      const tab = t.type === 'comment' && $$('.trig-tab[data-colfilter]').find((b) => b.dataset.colfilter === key);
      if (tab) {
        tab.querySelector('.tab-name').textContent = trigColorLabel(key);
        tab.classList.toggle('unnamed', !trigColorName(key));
      }
      nameIn.classList.toggle('invalid', dupName(t));
      markDirty();
    });
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameIn.blur(); });
  }
  // Notes: keep the ✎ mark in the list in step while typing; the box grows with the text.
  const notesIn = $('.trig-notes');
  if (notesIn) {
    const t = P().triggers[S.sel.trigger];
    notesIn.addEventListener('input', () => {
      t.notes = notesIn.value;
      notesIn.rows = Math.min(10, Math.max(2, notesIn.value.split('\n').length));
      const item = $(`.trig-list [data-sel="trigger:${S.sel.trigger}"]`);
      let mark = item?.querySelector('.note-mark');
      if (item && t.notes.trim() && !mark) {
        mark = document.createElement('span');
        mark.className = 'note-mark';
        mark.textContent = '✎';
        item.querySelector('.tname').after(mark);
      } else if (mark && !t.notes.trim()) mark.remove();
      if (mark?.isConnected) mark.title = t.notes.trim();
      markDirty();
    });
  }
  $('#trigNum')?.addEventListener('change', (e) => moveTriggerTo(P().triggers[S.sel.trigger], +e.target.value));
  $('#trigNum')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('#tables')?.addEventListener('change', (e) => {
    const t = P().triggers[S.sel.trigger];
    t.tables = {};
    for (const line of e.target.value.split('\n')) {
      const m = /^\s*([A-Za-z_]\w*)\s*:\s*(.*)$/.exec(line);
      if (m) t.tables[m[1]] = m[2].split(',').map((s) => s.trim()).filter((s) => s !== '').map((s) => (/^-?\d+$/.test(s) ? +s : s));
    }
    markDirty();
  });
  $('#timeMode')?.addEventListener('change', (e) => {
    const t = P().triggers[S.sel.trigger];
    if (e.target.value === 'time') { t.at = '20:00:00'; delete t.offset; }
    else { t.at = e.target.value; t.offset = t.offset || 0; }
    markDirty();
    render();
  });
  $$('[data-day]').forEach((el) => el.addEventListener('change', () => {
    const t = P().triggers[S.sel.trigger];
    t.days = $$('[data-day]').filter((x) => x.checked).map((x) => x.dataset.day);
    if (t.days.length === 7) delete t.days;
    markDirty();
  }));
  wireOnlyIn();
  multiEditAfter();
  S.trigEditing = P().triggers[S.sel.trigger];
}
// Brings a newly selected / added trigger into view (S.revealSel), once.
function trigRevealSel(list) {
  if (!S.revealSel) return;
  S.revealSel = false;
  $('.item.sel', list)?.scrollIntoView({ block: 'nearest' });
  S.trigScroll = list.scrollTop;
}
// Selecting a trigger (click, arrow keys, right-click, Enter in the search box): the rows'
// highlight, the connection marks and the editor pane change; the list itself stays, with
// its scroll position, search box and drag wiring. A full render() rebuilt the whole page
// on every click, which made the list jump and the page flash.
function trigSelectUi() {
  const list = $('.trig-list'), pane = $('.trig-split > div:last-child');
  if (S.view !== 'triggers' || !list || !pane) return render();
  const p = P(), ti = S.sel.trigger, t = p.triggers[ti];
  const multi = p.triggers.some((x) => S.trigSel.has(x));
  const selT = t && t.type !== 'comment' ? t : null, links = selT ? triggerLinks(selT) : null;
  for (const row of $$('.item[data-sel]', list)) {
    const i = +row.dataset.sel.slice(8), x = p.triggers[i];
    if (!x) continue;
    row.classList.toggle('sel', multi ? S.trigSel.has(x) : i === ti);
    if (x.type === 'comment') continue;
    const lo = links?.out.find((l) => l.t === x), li = links?.in.find((l) => l.t === x);
    row.classList.toggle('linked', !!(lo || li));
    row.classList.toggle('link-out', !!lo);
    row.classList.toggle('link-in', !!li);
    $$('.link-mark', row).forEach((m) => m.remove());
    const marks = trigLinkMarks(selT, lo, li);
    if (marks) row.querySelector('.trig-io')?.insertAdjacentHTML('afterend', marks);
  }
  for (const b of $$('[data-move]')) b.title = b.title.replace(/Move (the selected triggers|it) /, `Move ${multi && S.trigSel.size > 1 ? 'the selected triggers' : 'it'} `);
  pane.innerHTML = trigEditorHtml(p, ti, t, multi, links);
  attachACs(pane);
  trigEditorAfter();
  trigRevealSel(list);
  if ($('.trig-flow-wrap')) refreshTrigFlow();
}

// UDP / OSC "latest" (Triggers.cpp fireNetwork): a fader's flood of values runs at most 40 times
// a second with the newest one, and the last value always arrives.
function latestField(t, base) {
  return `<label title="For faders and sliders: runs at most 40 times a second, always with the newest value; the values in between are skipped. The fader's last position always arrives. Leave it off for buttons: two presses close together would count as one.">Latest value only</label>
    <div class="row nowrap"><input type="checkbox" data-p="${base}.latest" data-t="bool"${t.latest ? ' checked' : ''} data-r>
      <span class="muted">${t.latest ? 'fader: at most 40 runs a second, with the newest value' : 'off: every message runs (buttons, cues)'}</span></div>`;
}
// "Hold for" / "within" fields of an input or panel trigger with edge/event hold or double.
function holdDoubleFields(t, base, ev) {
  if (ev === 'hold') return `<label>Hold for</label><div class="row nowrap"><input type="number" min="0.1" step="0.5" data-p="${base}.hold" data-t="num" value="${t.hold ?? 2}" style="width:90px"><span class="muted">s</span></div>`;
  if (ev === 'double') return `<label>Within</label><div class="row nowrap"><input type="number" min="0.1" max="5" step="0.1" data-p="${base}.within" data-t="num" value="${t.within ?? 0.5}" style="width:90px"><span class="muted">s between the two presses</span></div>`;
  return '';
}
// Cooldown and what happens when it fires while still running: every trigger has them.
const WHILE_RUNNING = [['again', 'run again alongside (normal)'], ['ignore', 'ignore the new fire'], ['restart', 'stop the running one, start again'], ['queue', 'run once more after the current run']];
function behaviourFields(t, base) {
  const waits = (t.actions || []).some((a) => /^\s*(sleep|wait)\b/i.test(a) || splitHead(a)?.every || (trigLoopRef(a) && /\s(every|for)\s/i.test(a)));
  return `<label title="After it ran, new fires are skipped for this long. Fire now still works.">Cooldown</label>
    <div class="row nowrap"><input type="number" min="0" step="0.5" data-p="${base}.cooldown" data-t="num" value="${t.cooldown ?? ''}" placeholder="0" style="width:90px">
      <span class="muted">s · ${t.cooldown > 0 ? `fires within ${t.cooldown} s after a run are skipped (e.g. visitors pressing a button again and again)` : 'none'}</span></div>
    <label title="A trigger with a sleep, wait or repeat … every is still running until its last line">While running</label>
    <div class="row nowrap"><select data-p="${base}.whileRunning" data-r>${WHILE_RUNNING.map(([k, n]) => `<option value="${k}"${(t.whileRunning || 'again') === k ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <span class="muted">${waits ? 'when it fires again before its last line has run' : 'only matters with a sleep, wait or repeat … every in the actions'}</span></div>
    ${onlyInField(t)}`;
}
// "Only active in" a mode group's states (Triggers.cpp onlyIn): like switched off in the other states.
function onlyInField(t) {
  const p = P();
  if (!p.modes.length && !t.onlyIn) return '';
  const g = p.modes.find((x) => x.name === t.onlyIn?.group), on = t.onlyIn?.states || [];
  return `<label title="Fires only while this mode group is in one of the ticked states, as if switched off in the others. Fire now still works.">Only active in</label>
    <div class="row" style="gap:6px"><select id="onlyGroup"><option value="">always (any mode)</option>${p.modes.map((x) =>
      `<option${x === g ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}${t.onlyIn?.group && !g ? `<option selected>${esc(t.onlyIn.group)} (missing)</option>` : ''}</select>
      ${g ? g.states.map((s) => `<label class="chk"><input type="checkbox" data-onlys="${esc(s)}"${on.includes(s) ? ' checked' : ''}> ${esc(s)}</label>`).join('') : ''}
      ${g && !on.length ? '<span class="bad">tick at least one state</span>' : ''}</div>`;
}
function wireOnlyIn() {
  const t = P().triggers[S.sel.trigger];
  $('#onlyGroup')?.addEventListener('change', (e) => {
    const g = P().modes.find((x) => x.name === e.target.value);
    if (g) t.onlyIn = { group: g.name, states: g.states.slice(0, 1) };
    else delete t.onlyIn;
    markDirty();
    render();
  });
  $$('[data-onlys]').forEach((el) => el.addEventListener('change', () => {
    const g = P().modes.find((x) => x.name === t.onlyIn?.group);
    t.onlyIn.states = (g?.states || []).filter((s) => $$('[data-onlys]').some((x) => x.dataset.onlys === s && x.checked));
    markDirty();
    render();
  }));
}

// ---- Multi-edit: several selected triggers, the settings they share changed on all at once ----
// A field shows the common value, or "mixed" when they differ; changing it sets it on all.
// Colour also goes to selected separators; the rest only to triggers.
function multiEditHtml(sel) {
  const p = P(), trigs = sel.filter((x) => x.type !== 'comment'), seps = sel.length - trigs.length;
  const common = (list, f) => { const v = list.map(f); return v.every((x) => x === v[0]) ? v[0] : undefined; };   // undefined = mixed
  const MIX = '— mixed —';
  const col = common(sel, (x) => x.color || ''), custom = col && !TRIGGER_COLORS[col] ? col : '';
  const en = common(trigs, (x) => x.enabled !== false);
  const cd = common(trigs, (x) => (x.cooldown > 0 ? x.cooldown : 0));
  const wr = common(trigs, (x) => x.whileRunning || 'again');
  const og = common(trigs, (x) => x.onlyIn?.group || '');
  const g = og ? p.modes.find((x) => x.name === og) : null;
  const os = g ? common(trigs, (x) => JSON.stringify(x.onlyIn?.states || [])) : undefined;
  const on = os != null ? JSON.parse(os) : [];
  const what = `${trigs.length} trigger${trigs.length === 1 ? '' : 's'}${seps ? ` + ${seps} separator${seps === 1 ? '' : 's'}` : ''}`;
  return `<div class="multi-edit"><h3 style="margin-top:0">${what} selected</h3>
    <p class="muted" style="margin:0 0 10px">A change here is made on all of them at once (“${MIX}” = they differ now). Drag, ▲ ▼ (Alt+↑↓), Ctrl+C, Ctrl+D and Del also work on all of them. Click one row to edit just that one.</p>
    <div class="form">
      ${trigs.length ? `<label>Enabled</label><div class="row"><button class="btn small${en === true ? ' on' : ''}" data-me-en="1">All enabled</button><button class="btn small${en === false ? ' on' : ''}" data-me-en="0">All disabled</button>${en === undefined ? `<span class="muted">now ${trigs.filter((x) => x.enabled === false).length} of ${trigs.length} disabled</span>` : ''}</div>` : ''}
      <label>Colour</label><div class="row swatches">${Object.entries(TRIGGER_COLORS).map(([k, c]) => `<button class="swatch${col === k ? ' on' : ''}" data-me-col="${k}" title="${k || 'none'}" style="${k ? `background:${c}` : ''}">${k ? '' : '∅'}</button>`).join('')}
        <label class="swatch custom${custom ? ' on' : ''}" title="Custom colour" style="${custom ? `background:${custom}` : ''}">${custom ? '' : '+'}<input type="color" id="meColor" value="${custom || '#4aa3ff'}"></label>${col === undefined ? `<span class="muted">${MIX}</span>` : ''}</div>
      ${trigs.length ? `<label title="After it ran, new fires are skipped for this long. Fire now still works.">Cooldown</label>
      <div class="row nowrap"><input type="number" min="0" step="0.5" id="meCooldown" value="${cd ?? ''}" placeholder="${cd === undefined ? MIX : '0'}" style="width:110px"><span class="muted">s</span></div>
      <label>While running</label><select id="meWhile">${wr === undefined ? `<option value="" selected>${MIX}</option>` : ''}${WHILE_RUNNING.map(([k, n]) => `<option value="${k}"${wr === k ? ' selected' : ''}>${n}</option>`).join('')}</select>
      ${p.modes.length || og ? `<label title="Fires only while this mode group is in one of the ticked states. Fire now still works.">Only active in</label>
      <div class="row" style="gap:6px"><select id="meGroup">${og === undefined ? `<option value="\u0000" selected>${MIX}</option>` : ''}<option value=""${og === '' ? ' selected' : ''}>always (any mode)</option>${p.modes.map((x) => `<option${x.name === og ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
        ${g ? g.states.map((s) => `<label class="chk"><input type="checkbox" data-me-state="${esc(s)}"${on.includes(s) ? ' checked' : ''}> ${esc(s)}</label>`).join('') + (os === undefined ? `<span class="muted">states differ: ticking sets them on all</span>` : '') : ''}</div>` : ''}` : ''}
    </div>
    <h3>Selected</h3><div class="row me-list">${sel.map((x) => `<a href="#" class="chip-link" data-me-one="${p.triggers.indexOf(x)}" title="Edit only this one">${x.type === 'comment' ? '' : `#${x.id} `}${esc(x.name || '—')}</a>`).join('')}</div></div>`;
}
function multiEditAfter() {
  const box = $('.multi-edit');
  if (!box) return;
  const p = P(), sel = p.triggers.filter((x) => S.trigSel.has(x)), trigs = sel.filter((x) => x.type !== 'comment');
  const primary = p.triggers[S.sel.trigger];
  const done = (moved) => {
    if (moved) { renumberTriggers(); S.sel.trigger = Math.max(0, P().triggers.indexOf(primary)); }
    markDirty();
    render();
  };
  const setColor = (c) => {
    for (const x of sel) { if (c) x.color = c; else delete x.color; }
    done(keepColorHeads());
  };
  $$('[data-me-en]', box).forEach((b) => b.addEventListener('click', () => { for (const x of trigs) x.enabled = b.dataset.meEn === '1'; done(); }));
  $$('[data-me-col]', box).forEach((b) => b.addEventListener('click', () => setColor(b.dataset.meCol)));
  $('#meColor')?.addEventListener('change', (e) => setColor(e.target.value));
  $('#meCooldown')?.addEventListener('change', (e) => {
    const v = e.target.value === '' ? 0 : +e.target.value;
    if (!(v >= 0)) return render();
    for (const x of trigs) { if (v > 0) x.cooldown = v; else delete x.cooldown; }
    done();
  });
  $('#meWhile')?.addEventListener('change', (e) => {
    if (!e.target.value) return;
    for (const x of trigs) { if (e.target.value === 'again') delete x.whileRunning; else x.whileRunning = e.target.value; }
    done();
  });
  $('#meGroup')?.addEventListener('change', (e) => {
    if (e.target.value === '\u0000') return;
    const g = p.modes.find((x) => x.name === e.target.value);
    for (const x of trigs) { if (g) x.onlyIn = { group: g.name, states: x.onlyIn?.group === g.name && x.onlyIn.states?.length ? x.onlyIn.states : g.states.slice(0, 1) }; else delete x.onlyIn; }
    done();
  });
  $$('[data-me-state]', box).forEach((el) => el.addEventListener('change', () => {
    const g = p.modes.find((x) => x.name === trigs[0]?.onlyIn?.group);
    const states = (g?.states || []).filter((s) => $$('[data-me-state]', box).some((c) => c.dataset.meState === s && c.checked));
    for (const x of trigs) if (x.onlyIn) x.onlyIn.states = [...states];
    done();
  }));
  $$('[data-me-one]', box).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); selectTriggers([+a.dataset.meOne]); trigSelectUi(); }));
}

// Moves the triggers at idxs (any selection, also with gaps) so they sit together in front
// of the trigger now at index `to` (p.triggers.length = the end). Keeps the selection.
function moveTriggerBlock(idxs, to, reveal = true) {
  const arr = P().triggers, set = new Set(idxs.map((i) => arr[i]));
  const primary = arr[S.sel.trigger];
  const moving = arr.filter((t) => set.has(t)), rest = arr.filter((t) => !set.has(t));
  const at = arr.slice(0, to).filter((t) => !set.has(t)).length;
  rest.splice(at, 0, ...moving);
  if (rest.every((t, i) => t === arr[i])) return false;
  arr.splice(0, arr.length, ...rest);
  afterTriggerMove(set, primary, reveal);
  return true;
}
// ▲ / ▼ and Alt+↑ / Alt+↓: every selected trigger one place up or down, past the next
// unselected one (gaps in the selection stay). Nothing moves once one is at the end.
function moveTriggers(d) {
  const arr = P().triggers, idx = selectedTrigIdx();
  if (!idx.length || (d < 0 ? idx[0] === 0 : idx[idx.length - 1] === arr.length - 1)) return;
  const set = new Set(idx.map((i) => arr[i])), primary = arr[S.sel.trigger];
  for (const i of d < 0 ? idx : [...idx].reverse()) [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
  afterTriggerMove(set, primary);
}
function afterTriggerMove(set, primary, reveal = true) {
  const arr = P().triggers;
  renumberTriggers();
  S.trigSel = set.size > 1 ? set : new Set();
  S.sel.trigger = Math.max(0, arr.indexOf(primary));
  trigAnchor = S.sel.trigger;
  S.revealSel = reveal;
  markDirty();
  render();
}

// Drag-and-drop reordering of the trigger list (pointer events: mouse, touch, pen). Dragging
// one of the selected triggers takes the whole selection along. A bar between the rows shows
// where they will land.
function initTriggerDrag(list) {
  const bar = document.createElement('div');
  bar.className = 'drop-bar';
  const clear = () => bar.remove();
  list.addEventListener('pointerdown', (e) => {
    const src = e.target.closest('[data-drag]');
    if (!src || e.button !== 0 || e.target.closest('[data-fire]')) return;
    const from = +src.dataset.drag, x0 = e.clientX, y0 = e.clientY;
    const p = P(), group = S.trigSel.size > 1 && S.trigSel.has(p.triggers[from]) ? selectedTrigIdx() : [from];
    let ghost = null, target = null, after = false, timer = null, lastY = y0;
    const autoScroll = () => {
      const r = list.getBoundingClientRect();
      if (lastY < r.top + 40) list.scrollTop -= 12;
      else if (lastY > r.bottom - 40) list.scrollTop += 12;
      pick(lastY);
    };
    const pick = (y) => {
      target = null;
      const items = $$('[data-drag]', list);
      for (const it of items) {
        const r = it.getBoundingClientRect();
        if (y >= r.top && y < r.bottom) {
          target = it;
          after = y > r.top + r.height / 2;
          break;
        }
      }
      // Above the first / below the last row: the start / end of the list.
      if (!target && items.length) {
        after = y >= items[items.length - 1].getBoundingClientRect().bottom;
        target = after ? items[items.length - 1] : y < items[0].getBoundingClientRect().top ? items[0] : null;
      }
      if (!target) return clear();
      bar.style.top = target.offsetTop + (after ? target.offsetHeight : 0) - 2 + 'px';
      if (!bar.isConnected) list.appendChild(bar);
    };
    const move = (ev) => {
      lastY = ev.clientY;
      if (!ghost) {
        if (Math.abs(ev.clientY - y0) < 5 && Math.abs(ev.clientX - x0) < 5) return;  // still a click
        ghost = src.cloneNode(true);
        ghost.classList.add('drag-ghost');
        ghost.style.width = src.offsetWidth + 'px';
        if (group.length > 1) ghost.insertAdjacentHTML('beforeend', `<span class="drag-count">${group.length} triggers</span>`);
        document.body.appendChild(ghost);
        for (const i of group) $(`[data-drag="${i}"]`, list)?.classList.add('dragging');
        document.body.classList.add('dragging-item');
        timer = setInterval(autoScroll, 30);
      }
      ghost.style.left = ev.clientX / uiZoom() + 12 + 'px';
      ghost.style.top = ev.clientY / uiZoom() - 12 + 'px';
      pick(ev.clientY);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      clearInterval(timer);
      if (!ghost) return;  // plain click: the normal select handler runs
      ghost.remove();
      document.body.classList.remove('dragging-item');
      // Swallow the click that follows the drag.
      const swallow = (ce) => { ce.stopPropagation(); ce.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      clear();
      $$('.dragging', list).forEach((el) => el.classList.remove('dragging'));
      if (!target) return;
      if (group.length === 1) selectTriggers([from]);   // a dragged single trigger becomes the selected one
      S.revealSel = false;
      if (!moveTriggerBlock(group, +target.dataset.drag + (after ? 1 : 0), false)) render();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}
// Dragging an action line up or down by its ⠿ grip (the input itself stays
// free for selecting text).
function initActionDrag(box, t) {
  const clear = () => $$('.drop-before,.drop-after', box).forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  box.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('.act-grip');
    if (!grip || e.button !== 0) return;
    e.preventDefault();
    document.activeElement?.blur();   // commit a half-typed line first
    const src = grip.closest('[data-act]'), from = +src.dataset.act;
    let ghost = null, target = null, after = false;
    const move = (ev) => {
      if (!ghost) {
        ghost = src.cloneNode(true);
        ghost.classList.add('drag-ghost');
        ghost.style.width = src.offsetWidth + 'px';
        document.body.appendChild(ghost);
        src.classList.add('dragging');
        document.body.classList.add('dragging-item');
      }
      ghost.style.left = ev.clientX / uiZoom() + 12 + 'px';
      ghost.style.top = ev.clientY / uiZoom() - 12 + 'px';
      clear();
      target = null;
      for (const it of $$('[data-act]', box)) {
        const r = it.getBoundingClientRect();
        if (ev.clientY >= r.top - 3 && ev.clientY < r.bottom + 3) {
          target = it;
          after = ev.clientY > r.top + r.height / 2;
          it.classList.add(after ? 'drop-after' : 'drop-before');
          break;
        }
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!ghost) return;
      ghost.remove();
      document.body.classList.remove('dragging-item');
      src.classList.remove('dragging');
      clear();
      if (!target) return;
      let to = +target.dataset.act + (after ? 1 : 0);
      if (to > from) to--;
      if (to === from) return;
      const [moved] = t.actions.splice(from, 1);
      t.actions.splice(to, 0, moved);
      markDirty();
      render();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}
// Triggers are numbered 1, 2, 3… in list order (separators get hidden ids
// from 10001). References by number in actions follow the new numbers;
// references by "name" never need to change. Returns true if anything changed.
const TRIG_REF = /\b(fire\s+trigger|cancel\s+trigger|repeat\s+trigger|stop\s+repeat)(\s+)(\d+)\b/gi;
const TRIG_LOOP_REF = /\b(repeat)(\s+)(\d+)(?=\s+(?:\d+|\{[^}]*\})\s+times\b)/gi;   // repeat 7 3 times = trigger 7
function renumberTriggers(p = P(), heads = true) {
  if (heads) keepColorHeads(p);
  const map = new Map();
  let n = 0, sep = 0, changed = false;
  const fresh = p.triggers.map((t) => (t.type === 'comment' ? 10000 + ++sep : ++n));
  p.triggers.forEach((t, i) => { if (!map.has(t.id)) map.set(t.id, fresh[i]); if (t.id !== fresh[i]) changed = true; });
  if (!changed) return false;
  for (const t of p.triggers)
    t.actions = (t.actions || []).map((a) => a.replace(TRIG_REF, (m, kw, sp, id) => (map.has(+id) ? kw + sp + map.get(+id) : m))
      .replace(TRIG_LOOP_REF, (m, kw, sp, id) => (map.has(+id) ? kw + sp + map.get(+id) : m)));
  for (const c of timelineTrigCues(p))
    if (/^\d+$/.test(String(c.trigger)) && map.has(+c.trigger)) c.trigger = String(map.get(+c.trigger));
  p.triggers.forEach((t, i) => (t.id = fresh[i]));
  return true;
}
// ---- Trigger list: multi-select, clipboard, keyboard, numbers, names ----------
// S.trigSel holds the selected trigger objects (they survive renumbering);
// S.sel.trigger is the one shown in the editor.
S.trigSel = new Set();
let trigAnchor = 0;
function selectTriggers(idxs, primary = idxs[idxs.length - 1]) {
  const p = P();
  S.trigSel = new Set(idxs.map((i) => p.triggers[i]).filter(Boolean));
  S.sel.trigger = Math.max(0, primary ?? 0);
  trigAnchor = S.sel.trigger;
  S.revealSel = true;
}
function selectedTrigIdx() {
  const p = P();
  const idx = p.triggers.map((t, i) => (S.trigSel.has(t) ? i : -1)).filter((i) => i >= 0);
  return idx.length ? idx : p.triggers[S.sel.trigger] ? [S.sel.trigger] : [];
}
function clickTrigger(i, e) {
  const p = P();
  if (e.ctrlKey || e.metaKey) {
    if (!S.trigSel.size && p.triggers[S.sel.trigger]) S.trigSel.add(p.triggers[S.sel.trigger]);
    const t = p.triggers[i];
    if (S.trigSel.has(t) && S.trigSel.size > 1) S.trigSel.delete(t); else S.trigSel.add(t);
    S.sel.trigger = i;
    trigAnchor = i;
  } else if (e.shiftKey) {
    const [a, b] = [Math.min(trigAnchor, i), Math.max(trigAnchor, i)];
    S.trigSel = new Set(p.triggers.slice(a, b + 1));
    S.sel.trigger = i;
  } else {
    selectTriggers([i]);
    S.revealSel = false;
  }
  trigSelectUi();
}
// Names must be unique for "fire trigger <name>": "Start" -> "Start (2)".
const dupName = (t) => t.type !== 'comment' && t.name && P().triggers.some((x) => x !== t && x.type !== 'comment' && (x.name || '').toLowerCase() === t.name.toLowerCase());
function uniqueTrigName(base, except) {
  const taken = new Set(P().triggers.filter((t) => t !== except && t.type !== 'comment').map((t) => (t.name || '').toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  const stem = base.replace(/\s\(\d+\)$/, '');
  let n = 2;
  while (taken.has(`${stem} (${n})`.toLowerCase())) n++;
  return `${stem} (${n})`;
}
// Inserts copies at `at`, gives them unique names and new numbers, selects them.
function insertTriggers(list, at, verb) {
  const p = P();
  let id = nextId(p.triggers) + 1000;
  const copies = list.map((t) => Object.assign(JSON.parse(JSON.stringify(t)), { id: id++ }));
  p.triggers.splice(at, 0, ...copies);
  for (const c of copies) if (c.type !== 'comment') c.name = uniqueTrigName(c.name || 'Trigger', c);
  renumberTriggers(p);
  selectTriggers(copies.map((c) => p.triggers.indexOf(c)));
  markDirty();
  render();
  toast(`${verb} ${copies.length} trigger${copies.length > 1 ? 's' : ''}`);
}
// Does a command line refer to trigger t (by number or by name)?
function refersTo(line, t) {
  const toks = tokenize(line);
  for (let i = 0; i + 1 < toks.length; i++) {
    const r = trigRefAt(toks, i)?.v.toLowerCase();
    if (r && (/^\d+$/.test(r) ? +r === t.id : r === (t.name || '').toLowerCase())) return true;
  }
  return false;
}
// ---- Problems: why a trigger won't work as intended (the red ! in the list) -----
function triggerProblems(t) {
  if (t.type === 'comment') return [];
  const p = P(), out = [];
  const has = (list, name) => list.some((x) => String(x).toLowerCase() === String(name || '').toLowerCase());
  (t.actions || []).forEach((a, i) => {
    if (!a.trim() || a.trim().startsWith('#')) return;
    const v = validate(a);
    if (!v.ok) out.push(`Action ${i + 1}: ${v.error}`);
  });
  (t.conditions || []).forEach((c, i) => {
    if (!c.trim()) return;
    const v = validate(c, COND_GRAMMAR);
    if (!v.ok) out.push(`Condition ${i + 1}: ${v.error}`);
  });
  if (!(t.actions || []).some((a) => a.trim() && !a.trim().startsWith('#'))) out.push('No actions: it does nothing');
  if (t.cooldown != null && !(t.cooldown >= 0)) out.push('The cooldown must be 0 or more seconds');
  if (dupName(t)) out.push(`Another trigger is also called '${t.name}': fire trigger by name can't tell them apart`);
  const loop = triggerLoop(t);
  if (loop) out.push(loop);
  if (t.onlyIn?.group) {
    const g = p.modes.find((x) => x.name === t.onlyIn.group);
    if (!g) out.push(`Only active in: mode group '${t.onlyIn.group}' doesn't exist`);
    else if (!t.onlyIn.states?.length) out.push(`Only active in ${g.name}: no state ticked, so it never fires`);
    else for (const s of t.onlyIn.states) if (!g.states.includes(s)) out.push(`Only active in: '${s}' is not a state of ${g.name}`);
  }
  switch (t.type) {
    case 'udp': if (!t.match) out.push('No message to react to'); break;
    case 'osc': if (!t.address) out.push('No OSC address to react to'); break;
    case 'panel':
      if (!t.control) out.push('No panel control chosen');
      else if (!has(panelButtons(), t.control)) out.push(`Panel control '${t.control}' doesn't exist`);
      else if (t.event === 'change' && panelControlType(t.control) === 'button') out.push(`'${t.control}' is a button: it has no value to change (use click, or make it a toggle)`);
      else if (/^(click|hold|double)$/.test(t.event || 'click') && ['slider', 'dial', 'color', 'xy'].includes(panelControlType(t.control))) out.push(`'${t.control}' is a ${{ color: 'colour wheel', xy: 'XY pad' }[panelControlType(t.control)] || panelControlType(t.control)}: it sends change, press and release, not ${t.event || 'click'}`);
      break;
    case 'timeline_end': if (!p.timelines.some((x) => x.id === t.timeline)) out.push('The timeline it waits for doesn\'t exist'); break;
    case 'mode':
      if (t.group && !has(p.modes.map((g) => g.name), t.group)) out.push(`Mode group '${t.group}' doesn't exist`);
      else if (t.mode && !has(p.modes.filter((g) => !t.group || g.name === t.group).flatMap((g) => g.states), t.mode)) out.push(`Mode '${t.mode}' doesn't exist`);
      break;
    case 'variable': if (t.variable && !has(p.variables.map((v) => v.name), t.variable)) out.push(`Variable '${t.variable}' doesn't exist`); break;
    case 'tcp': if (t.device && !has(p.tcp.map((d) => d.name), t.device)) out.push(`TCP device '${t.device}' doesn't exist`); break;
    case 'device': if (t.device && !has(monitoredNames(), t.device)) out.push(`Device '${t.device}' isn't monitored or doesn't exist`); break;
    case 'projector':
      if (!p.projectors.length) out.push('There are no projectors (Devices → Projectors)');
      else if (t.projector && !has(p.projectors.map((x) => x.name), t.projector)) out.push(`Projector '${t.projector}' doesn't exist`);
      if (t.alarm === 'lamp_hours' && !(t.hours > 0)) out.push('No lamp-hour limit set');
      break;
    case 'dmx_change': if (!p.universes.some((u) => u.id === t.universe)) out.push('The universe doesn\'t exist'); break;
    case 'interval': if (!(t.seconds > 0)) out.push('No interval set'); break;
    case 'input': if (t.io && !pmcFind(t.io)) out.push(`Machine Control point '${t.io}' doesn't exist`);
      else if (t.io && /^io/.test(t.io) && pmcIsOut(t.io)) out.push(`${t.io} is set as an output (Devices → Machine Control)`);
      break;
    case 'calendar':
      if (!t.calendar) out.push('No calendar period chosen');
      else if (!has(p.calendar.map((e) => e.name), t.calendar)) out.push(`Calendar period '${t.calendar}' doesn't exist (Schedule page)`);
      break;
    case 'dmx_in': {
      const sacn = t.protocol === 'sacn', u = t.universe ?? (sacn ? 1 : 0);
      if (!(Number.isInteger(u) && u >= (sacn ? 1 : 0) && u <= (sacn ? 63999 : 32767))) out.push(`Universe must be ${sacn ? '1-63999' : '0-32767'}`);
      if (!/^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$/.test(t.channels || '1') || String(t.channels || '1').split(/[,-]/).some((c) => +c < 1 || +c > 512)) out.push('Channels must be 1-512, e.g. 1-8 or 1,3,5');
      if ((t.when || 'change') !== 'change' && !(t.level >= 0 && t.level <= 255) && t.level != null) out.push('Level must be 0-255');
      const unis = new Set(p.triggers.filter((x) => x.type === 'dmx_in' && x.enabled !== false).map((x) => `${x.protocol === 'sacn' ? 's' : 'a'}${x.universe ?? (x.protocol === 'sacn' ? 1 : 0)}`));
      if (unis.size > 4) out.push(`DMX input triggers use ${unis.size} universes; the controller receives at most 4`);
      break;
    }
  }
  return out;
}
function trigProbsHtml(t) {
  const pr = triggerProblems(t).filter((x) => !x.startsWith('Another trigger'));   // that one has its own message
  return pr.length ? `<div class="trig-probs"><b>! This trigger won't work as intended</b><ul>${pr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
}
// After an edit: update the ! of the selected trigger in the list and the editor, in place.
function refreshTrigProblems() {
  const i = S.sel.trigger, t = P().triggers[i];
  const item = $(`.trig-list [data-sel="trigger:${i}"]`);
  if (!t || !item) return;
  const probs = triggerProblems(t);
  item.classList.toggle('has-err', probs.length > 0);
  item.querySelector('.trig-err')?.remove();
  if (probs.length) item.querySelector('.id').insertAdjacentHTML('afterend', `<span class="trig-err" title="${esc(probs.join('\n'))}">!</span>`);
  const box = $('#trigProbs');
  if (box) box.innerHTML = trigProbsHtml(t);
}

// ---- Connections between triggers ----------------------------------------------
// The commands a line can run (then/else parts of an if, recursively).
function commandParts(line) {
  const h = splitHead(line);
  if (h) return h.kind === 'loop' && h.body != null ? commandParts(line.slice(h.body).trim()) : [];
  const s = splitIfLine(line);
  if (!s || !s.thenTok) return [line];
  const a = line.slice(s.thenTok.end, s.elseTok ? s.elseTok.start : line.length).trim();
  const b = s.elseTok ? line.slice(s.elseTok.end).trim() : '';
  return [...(a ? commandParts(a) : []), ...(b ? commandParts(b) : [])];
}
// What one command does that can set off other triggers (or, kind 'panel', changes a
// panel control or label: feedback, only drawn in the flow view).
function cmdEffects(cmd) {
  const fx = [];
  const w = tokenize(cmd).map((x) => x.v), l = w.map((x) => x.toLowerCase());
  const loopRef = trigLoopRef(cmd);
  if (loopRef) {
    const hits = findTrigs(loopRef.v);
    if (hits.length === 1) fx.push({ kind: 'fire', t: hits[0], why: `repeat ${w[2]} times` });
  } else if ((['fire', 'cancel', 'repeat'].includes(l[0]) && l[1] === 'trigger') || (l[0] === 'stop' && l[1] === 'repeat')) {
    const hits = findTrigs(w[2] || '');
    if (hits.length === 1) fx.push({ kind: 'fire', t: hits[0], why: l[0] === 'stop' ? 'stop repeat' : `${l[0]} trigger` });
  } else if (l[0] === 'mode' && w.length >= 2) {
    let g, s;
    if (w.length >= 3) { g = findGroup(w[1]); s = findState(g, w[2]); }
    else { const m = findMode(w[1]); if (m) { g = findGroup(m.group); s = m.state; } }
    if (g && s) fx.push({ kind: 'mode', group: g.name, state: s });
  } else if (l[0] === 'var' && ['=', '+', '-', '*', '/', '++', '--', '+=', '-=', '*=', '/=', 'toggle'].includes(l[2])) {
    fx.push({ kind: 'var', name: w[1], op: l[2] });
  } else if (l[0] === 'start' && l[1] === 'timeline') {
    const tl = findRef(P().timelines, w[2] || '');
    if (tl) fx.push({ kind: 'timeline', id: tl.id, name: tl.name });
  } else if (l[0] === 'http' && w[2]) {
    fx.push({ kind: 'http', url: w[2] });
  } else if ((l[0] === 'panel' || l[0] === 'label') && w[1] && w.length > 2) {
    fx.push({ kind: 'panel', name: w[1], why: `${l[0]} ${w.slice(2).join(' ')}` });
  }
  return fx;
}
// The devices one command controls (flow view): [{kind, name, act}]. "all" becomes every
// projector / PC (up to 6, more are one box).
const OUT_KINDS = {
  projector: ['▭', 'Projector (PJLink)'], pc: ['▢', 'PC'], udp: ['⇢', 'UDP to'], osc: ['⇢', 'OSC to'], tcp: ['⇄', 'TCP device'],
  http: ['⇢', 'HTTP to'], modbus: ['⌁', 'Modbus device'], io: ['⏻', 'Machine Control output'], email: ['✉', 'Email to'], drv: ['⌁', 'Show device'],
};
function cmdOutputs(cmd) {
  const p = P(), w = tokenize(cmd).map((x) => x.v), l = w.map((x) => x.toLowerCase());
  const rest = (i) => w.slice(i).join(' ');
  const each = (list, kind, what, act) => {
    if (l[1] !== 'all') return [{ kind, name: findRef(list, w[1])?.name || w[1], act }];
    return list.length <= 6 ? list.map((x) => ({ kind, name: x.name, act })) : [{ kind, name: `all ${list.length} ${what}`, act }];
  };
  if (!w[1]) return [];
  switch (l[0]) {
    case 'projector': return each(p.projectors, 'projector', 'projectors', /^(on|off)$/.test(l[2]) ? `power ${l[2]}` : rest(2));
    case 'pc': return each(p.pcs, 'pc', 'PCs', rest(2));
    case 'send':
      if (l[1] === 'tcp' && w[2]) return [{ kind: 'tcp', name: findRef(p.tcp, w[2])?.name || w[2], act: rest(3) }];
      if ((l[1] === 'udp' || l[1] === 'osc') && w[2]) return [{ kind: l[1], name: findRef(p.devices, w[2])?.name || w[2], act: rest(3) }];
      return [];
    case 'http': {
      let host = w[2] || '';
      try { host = new URL(host).host; } catch { /* {variables} in the URL */ }
      return host ? [{ kind: 'http', name: host, act: `${l[1]} ${w[2]}` }] : [];
    }
    case 'modbus': return [{ kind: 'modbus', name: w[1], act: rest(2) }];
    case 'kissbox': case 'knx': case 'brightsign': case 'digidot': case 'netio': case 'pharos':
      return [{ kind: 'drv', name: findRef(p.drivers || [], w[1])?.name || w[1], act: rest(2), type: l[0] }];
    case 'io': return [{ kind: 'io', name: l[1] === 'all' ? 'all outputs' : pmcCfg(w[1]).name || w[1], act: rest(2) }];
    case 'email': return [{ kind: 'email', name: w[1], act: w[2] || '' }];
  }
  return [];
}
// The devices a trigger's actions control: [{kind (DEVICE_ICONS key), name, act}].
function trigOutputs(t) {
  const out = [];
  for (const line of t.actions || []) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    for (const part of commandParts(line))
      for (const o of cmdOutputs(part)) out.push({ kind: o.kind === 'udp' || o.kind === 'osc' ? deviceKind(o.name) || 'network' : o.kind === 'drv' ? o.type : o.kind, name: o.name, act: o.act });
  }
  return out;
}
// Where a trigger's events come from: [{kind (DEVICE_ICONS key), name, why}] - its own
// event source, show devices / Modbus feeding its variable, and timeline cues.
function trigInputs(t) {
  const p = P(), out = [];
  switch (t.type) {
    case 'panel': if (t.control) out.push({ kind: 'panel', name: t.control, why: t.event || 'click' }); break;
    case 'device': out.push({ kind: deviceKind(t.device) || 'device', name: t.device || 'any monitored device', why: `goes ${t.state || 'offline'}` }); break;
    case 'projector': out.push({ kind: 'projector', name: t.projector || 'any projector', why: t.alarm === 'lamp_hours' ? `lamp hours ${t.hours ?? 3000}` : `${t.alarm || 'any'} alarm` }); break;
    case 'tcp': out.push({ kind: 'tcp', name: t.device || 'any TCP device', why: `message ${t.match ?? '*'}` }); break;
    case 'udp': case 'osc': {
      const from = t.fromIp && p.devices.find((d) => d.ip === t.fromIp);
      out.push({ kind: 'network', name: from ? from.name : t.fromIp || `port ${t.port || p.settings.udpPort}`, why: t.type === 'udp' ? `UDP ${t.match || ''}` : `OSC ${t.address || ''}` });
      break;
    }
    case 'input': out.push({ kind: 'io', name: t.io ? pmcCfg(t.io).name || t.io : `pin ${t.pin ?? 0}`, why: t.edge || 'rising' }); break;
    case 'dmx_in': out.push({ kind: 'dmx', name: `${t.protocol === 'sacn' ? 'sACN' : 'Art-Net'} ${t.universe ?? (t.protocol === 'sacn' ? 1 : 0)}`, why: `channels ${t.channels || '1'}` }); break;
    case 'http': out.push({ kind: 'http', name: t.url || 'any response', why: 'response' }); break;
    case 'calendar': if (t.calendar) out.push({ kind: 'calendar', name: t.calendar, why: `becomes ${t.state || 'active'}` }); break;
    case 'timeline_end': { const tl = p.timelines.find((x) => x.id === t.timeline); out.push({ kind: 'timeline', name: tl ? `${tl.id} ${tl.name}` : String(t.timeline ?? ''), why: 'ends' }); break; }
    case 'variable':
      if (!t.variable) break;
      for (const d of p.drivers || [])
        for (const [pt, name] of Object.entries(d.vars || {}))
          if (String(name).toLowerCase() === t.variable.toLowerCase()) out.push({ kind: d.type, name: d.name, why: `reading ${pt} → var ${name}` });
      { const mb = p.variables.find((x) => x.name.toLowerCase() === t.variable.toLowerCase())?.modbus?.device; if (mb) out.push({ kind: 'modbus', name: mb, why: `var ${t.variable}` }); }
      break;
  }
  for (const s of trigFiredBy(t).tls) out.push({ kind: 'timeline', name: s, why: 'trigger cue' });
  // Only direct fires (fire / repeat trigger), not through a mode, variable or timeline.
  for (const s of trigFiredBy(t).fires) out.push({ kind: 'trigger', name: `#${s.t.id} ${s.t.name}`, why: s.why });
  return out;
}
// A row's icons: [what sets it off] → [what it controls]; empty when neither.
function trigIoHtml(x) {
  const ins = ioIcons(trigInputs(x), 'in'), outs = ioIcons(trigOutputs(x), 'out');
  return ins || outs ? `${ins ? `<span class="io-grp in">${ins}</span>` : ''}<span class="io-arr">→</span>${outs ? `<span class="io-grp out">${outs}</span>` : ''}` : '';
}
// The editor's "Set off by" / "Sets off" rows: triggers, timeline cues and devices.
function trigLinksHtml(t, links = triggerLinks(t)) {
  const uniq = (list) => list.filter((x, i) => list.findIndex((y) => y.kind === x.kind && y.name === x.name && (y.why || y.act) === (x.why || x.act)) === i);
  // Timeline cues and triggers have their own chips.
  const ins = uniq(trigInputs(t).filter((x) => x.why !== 'trigger cue' && x.kind !== 'trigger')), outs = uniq(trigOutputs(t));
  return `<div class="row"><span class="muted link-head">Set off by</span>${ins.map((x) => ioChip(x, 'in')).join('')}${links.tls.map((l) => `<a href="#" class="chip-link in tl" data-goto-timeline="${l.tl.id}" title="Trigger cue on timeline ${l.tl.id} '${esc(l.tl.name)}' at ${(l.c.t / 1000).toFixed(1)} s">◆ Timeline ${l.tl.id} ${esc(l.tl.name)} <small>cue at ${(l.c.t / 1000).toFixed(1)} s</small></a>`).join('')}${links.in.map((l) => `<a href="#" class="chip-link in" data-goto-trigger="${l.t.id}" title="${esc(l.t.name)}: ${esc(l.why)}">← #${l.t.id} ${esc(l.t.name)} <small>${esc(l.why)}</small></a>`).join('')}${links.in.length || links.tls.length || ins.length ? '' : '<span class="muted">nothing - only its own event</span>'}</div>
    <div class="row"><span class="muted link-head">Sets off</span>${links.out.map((l) => `<a href="#" class="chip-link out" data-goto-trigger="${l.t.id}" title="${esc(l.why)}">→ #${l.t.id} ${esc(l.t.name)} <small>${esc(l.why)}</small></a>`).join('')}${outs.map((x) => ioChip(x, 'out')).join('')}${links.out.length || outs.length ? '' : '<span class="muted">no other triggers or devices</span>'}</div>`;
}
// After an edit (also while typing an action): every row's icons (a "fire trigger" changes
// another row too) and the selected trigger's links.
function refreshTrigIcons() {
  const p = P();
  $$('.trig-list .item[data-sel^="trigger:"]').forEach((row) => {
    const x = p.triggers[+row.dataset.sel.slice(8)], io = row.querySelector('.trig-io');
    if (x && io) { const h = trigIoHtml(x); if (io.innerHTML !== h) io.innerHTML = h; }
  });
  const t = p.triggers[S.sel.trigger], box = $('.links');
  if (box && t && t.type !== 'comment') box.innerHTML = trigLinksHtml(t);
}
// The list's icons: one per kind of device, the names (and what) in the hover text.
function ioIcons(list, dir) {
  const kinds = new Map();
  for (const x of list) (kinds.get(x.kind) || kinds.set(x.kind, []).get(x.kind)).push(x);
  const text = ([k, xs]) => `${DEVICE_ICONS[k]?.[0] || k}:\n${[...new Set(xs.map((x) => `${x.name}${x.why || x.act ? ` (${x.why || x.act})` : ''}`))].join('\n')}`;
  const all = [...kinds], head = dir === 'in' ? 'Set off by' : 'Controls';
  // More than 3 kinds: 2 icons and "+n" (keeps room for the name).
  const shown = all.length > 3 ? all.slice(0, 2) : all, more = all.slice(shown.length);
  return shown.map((g) => `<span class="io-ic ${dir}" title="${esc(`${head} ${text(g)}`)}">${devIcon(g[0])}</span>`).join('') +
    (more.length ? `<span class="io-more" title="${esc(`${head}:\n${more.map(text).join('\n\n')}`)}">+${more.length}</span>` : '');
}
// A chip in the "Set off by" / "Sets off" rows; device kinds with a Devices tab link to it.
function ioChip(x, dir) {
  const tab = DEVICE_ICONS[x.kind]?.[2];
  return `<a href="#" class="chip-link ${dir} dev"${tab ? ` data-goto-devices="${tab}"` : ''} title="${esc(`${DEVICE_ICONS[x.kind]?.[0] || x.kind}: ${x.name}${tab ? ' (click to open it on the Devices page)' : ''}`)}">${devIcon(x.kind)}${esc(x.name)}${x.why || x.act ? ` <small>${esc(x.why || x.act)}</small>` : ''}</a>`;
}
// What a trigger's actions do that can set off other triggers.
function triggerEffects(t) {
  return (t.actions || []).flatMap((line) => commandParts(line).flatMap(cmdEffects));
}
// Why `fx` (effects of one trigger) would set off trigger `dst`, or null.
function setsOff(fx, dst) {
  for (const f of fx) {
    if (f.kind === 'fire' && f.t === dst) return f.why;
    if (f.kind === 'mode' && dst.type === 'mode' && (!dst.group || dst.group === f.group) && (!dst.mode || dst.mode === f.state)) return `mode ${f.group} ${f.state}`;
    if (f.kind === 'var' && dst.type === 'variable' && (!dst.variable || dst.variable.toLowerCase() === f.name.toLowerCase())) return `var ${f.name} changes`;
    if (f.kind === 'timeline' && dst.type === 'timeline_end' && dst.timeline === f.id) return `timeline ${f.id} '${f.name}' ends`;
    if (f.kind === 'timeline') {
      const c = P().timelines.find((tl) => tl.id === f.id)?.cues.find((c) => c.trigger != null && findTrigs(String(c.trigger))[0] === dst);
      if (c) return `timeline ${f.id} '${f.name}' cue at ${(c.t / 1000).toFixed(1)} s`;
    }
    if (f.kind === 'http' && dst.type === 'http' && (!dst.url || f.url.startsWith(dst.url))) return `HTTP response ${f.url}`;
  }
  return null;
}
// ---- Loops: a trigger that sets itself off again (directly or through others) ----
// Only links that fire again every time count: fire/repeat trigger, and a variable trigger
// whose variable keeps changing (+ - toggle). Mode changes and "var = x" settle (the second
// time nothing changes); timelines that restart each other are usually a deliberate show loop.
function loopEdges(t) {
  const out = [];
  for (const f of triggerEffects(t)) {
    if (f.kind === 'fire' && !/^(cancel|stop)/.test(f.why) && f.t.enabled !== false) out.push({ t: f.t, why: f.why });
    if (f.kind === 'var' && f.op !== '=')
      for (const x of P().triggers)
        if (x.type === 'variable' && x.enabled !== false && (!x.variable || x.variable.toLowerCase() === f.name.toLowerCase())) out.push({ t: x, why: `var ${f.name} ${f.op}` });
  }
  return out;
}
// The trigger list asks for every row: build the graph once per render (it's dropped
// as soon as the current task ends, so an edit is always seen), not once per row.
let loopCache = null;
function loopGraph() {
  if (loopCache) return loopCache;
  loopCache = new Map(P().triggers.filter((x) => x.type !== 'comment' && x.enabled !== false).map((x) => [x, loopEdges(x)]));
  Promise.resolve().then(() => { loopCache = null; });   // (not queueMicrotask: tools/check-project.js runs this without it)
  return loopCache;
}
// The shortest way t sets itself off again, as a problem text, or null.
function triggerLoop(t) {
  if (t.type === 'comment' || t.enabled === false) return null;
  const g = loopGraph(), from = new Map(), queue = [t];
  let found = null;
  while (queue.length && !found) {
    const x = queue.shift();
    for (const e of g.get(x) || []) {
      if (e.t === t) { found = { prev: x, why: e.why }; break; }
      if (!from.has(e.t)) { from.set(e.t, { prev: x, why: e.why }); queue.push(e.t); }
    }
  }
  if (!found) return null;
  const between = [];
  for (let x = found.prev; x !== t; x = from.get(x).prev) between.unshift(x);
  const path = [t, ...between];   // the triggers in the loop, in firing order
  // A condition (on a trigger in the loop, or an if in its actions) may stop it in time.
  const guarded = path.some((x) => x.conditions?.some((c) => c.trim()) || (x.actions || []).some((a) => /^\s*if\s/i.test(a)));
  // With a sleep/wait/every in it, it's a slow loop that never ends rather than a burst.
  const pause = path.some((x) => (x.actions || []).some((a) => /^\s*(sleep|wait\s+until)\b|\bevery\b/i.test(a)));
  const what = path.length === 1 ? `It fires itself (${found.why})` : `It sets itself off again: ${[...path, t].map((x) => `#${x.id}`).join(' → ')}`;
  return `${what}, so it ${pause ? 'runs forever' : 'loops endlessly (the controller pauses it after 100 fires a second)'}${guarded ? ', unless a condition stops it' : ''}. ${pause ? 'For something that repeats, use an interval trigger or repeat … times every' : 'Remove the loop'}`;
}

// For the list's icons: per trigger, the timeline cues that fire it and the triggers that fire
// it directly (fire / repeat trigger) ({tls: [text], fires: [{t, why}]}). Built once per
// render like loopGraph, not per row.
let firedByCache = null;
function trigFiredBy(x) {
  if (!firedByCache) {
    const p = P(), m = firedByCache = new Map(), trigs = p.triggers.filter((t) => t.type !== 'comment');
    const get = (t) => m.get(t) || m.set(t, { tls: [], fires: [] }).get(t);
    for (const s of trigs)
      for (const f of triggerEffects(s))
        if (f.kind === 'fire' && f.t !== s && !/^(cancel|stop)/.test(f.why) && !get(f.t).fires.some((y) => y.t === s)) get(f.t).fires.push({ t: s, why: f.why });
    for (const tl of p.timelines)
      for (const c of tl.cues) {
        const h = c.trigger != null && findTrigs(String(c.trigger));
        if (h?.length === 1) get(h[0]).tls.push(`Timeline ${tl.id} '${tl.name}' at ${(c.t / 1000).toFixed(1)} s`);
      }
    Promise.resolve().then(() => { firedByCache = null; });
  }
  return firedByCache.get(x) || { tls: [], fires: [] };
}
// {out: triggers t sets off, in: triggers that set t off}, each {t, why}.
function triggerLinks(t) {
  const out = [], inc = [], mine = triggerEffects(t);
  for (const x of P().triggers) {
    if (x === t || x.type === 'comment') continue;
    const o = setsOff(mine, x);
    if (o) out.push({ t: x, why: o });
    const i = setsOff(triggerEffects(x), t);
    if (i) inc.push({ t: x, why: i });
  }
  // Timelines whose trigger cues fire t (whoever starts the timeline).
  const tls = [];
  for (const tl of P().timelines)
    for (const c of tl.cues) if (c.trigger != null && findTrigs(String(c.trigger)).length === 1 && findTrigs(String(c.trigger))[0] === t) tls.push({ tl, c });
  return { out, in: inc, tls };
}

// ---- Flow view: a diagram of what sets off what, lit up live as triggers fire ----
// On/off is a per-browser preference, like the effect overlay.
function trigFlowOn() {
  try { return localStorage.getItem('kd.trigFlow') === '1'; } catch { return false; }
}
function setTrigFlow(on) {
  try { on ? localStorage.setItem('kd.trigFlow', '1') : localStorage.removeItem('kd.trigFlow'); } catch { /* private mode */ }
}
// Lighting up fired triggers (list + diagram): on unless switched off.
function trigLiveOn() {
  try { return localStorage.getItem('kd.trigLive') !== '0'; } catch { return true; }
}
function setTrigLive(on) {
  try { on ? localStorage.removeItem('kd.trigLive') : localStorage.setItem('kd.trigLive', '0'); } catch { /* private mode */ }
}
// The if-structure of one action line: [{cmd}] or [{cond, yes: [...], no: [...]}] (nested ifs,
// the command of a "repeat n times"), with the same rules as commandParts.
function actionTree(line) {
  const h = splitHead(line);
  if (h) return h.kind === 'loop' && h.body != null ? actionTree(line.slice(h.body).trim()) : [];
  const s = splitIfLine(line);
  if (!s || !s.thenTok) return [{ cmd: line }];
  const a = line.slice(s.thenTok.end, s.elseTok ? s.elseTok.start : line.length).trim();
  const b = s.elseTok ? line.slice(s.elseTok.end).trim() : '';
  return [{ cond: line.slice(s.ifTok.end, s.thenTok.start).trim(), yes: a ? actionTree(a) : [], no: b ? actionTree(b) : [] }];
}
// Where an event trigger's event comes from: [key, label, why, description (hover)] or null.
// Triggers with the same source (two triggers on one panel button, one device) share its box.
function trigSource(t) {
  const p = P(), lc = (s) => String(s || '').toLowerCase();
  switch (t.type) {
    case 'panel': return t.control ? [`s:panel:${lc(t.control)}`, `▣ ${t.control}`, t.event || 'click', `From the touch panel: ${panelControlType(t.control) || 'control'} '${t.control}'`] : null;
    case 'device': return [`s:dev:${lc(t.device)}`, `⌁ ${t.device || 'any device'}`, `goes ${t.state || 'offline'}`, `From a monitored device going online / offline: ${t.device || 'any device'} (checked on the Monitoring page)`];
    case 'projector': return [`s:pj:${lc(t.projector)}`, `▭ ${t.projector || 'any projector'}`, t.alarm === 'lamp_hours' ? `lamp hours ${t.hours ?? 3000}` : `${t.alarm || 'any'} alarm`, `From a projector over PJLink: ${t.projector || 'any projector'} (errors, lamp hours)`];
    case 'tcp': return [`s:tcp:${lc(t.device)}`, `⇄ ${t.device || 'any TCP device'}`, `message ${t.match ?? '*'}`, `From a TCP device: messages received from ${t.device || 'any TCP device'}`];
    case 'udp': case 'osc': {
      const port = t.port || p.settings.udpPort;
      return [`s:${t.type}:${port}`, `${t.type.toUpperCase()} in :${port}`, t.type === 'udp' ? `message ${t.match || ''}` : t.address || '',
        `From the network: ${t.type.toUpperCase()} messages received on port ${port} (e.g. from QLab, a show PC or a control system)`];
    }
    case 'input': {
      const name = t.io && pmcCfg(t.io).name;
      return [`s:in:${t.io || 'pin' + (t.pin ?? 0)}`, `⏻ ${t.io ? name || t.io : `pin ${t.pin ?? 0}`}`, t.edge || 'rising',
        t.io ? `From a Machine Control input: ${t.io}${name ? ` (${name})` : ''} - a button, switch or sensor wired to it` : `From a Portenta input pin: ${t.pin ?? 0}`];
    }
    case 'dmx_in': {
      const sacn = t.protocol === 'sacn', u = t.universe ?? (sacn ? 1 : 0);
      return [`s:dmx:${sacn ? 's' : 'a'}${u}`, `DMX in ${sacn ? 'sACN' : 'Art-Net'} ${u}`, `channels ${t.channels || '1'}`, `From DMX input: ${sacn ? 'sACN' : 'Art-Net'} universe ${u} sent by a lighting desk or media server`];
    }
    case 'calendar': return t.calendar ? [`s:cal:${lc(t.calendar)}`, `▦ ${t.calendar}`, `becomes ${t.state || 'active'}`, `From the calendar (Schedule page): period '${t.calendar}' starting or ending`] : null;
  }
  return null;
}
// Nodes: 't<id>' triggers, 'tl<id>' timelines, 'if<id>.<n>' an if in a trigger's actions,
// 's:…' where events come from (panel controls, devices, projectors, TCP/UDP/OSC, inputs,
// DMX in, show devices feeding a variable) and 'fb:<name>' a panel control or label that
// triggers change (feedback). Only nodes with a link are shown.
// Edges {a, b, why: [...], br: ['yes'|'no'], weak, lk: Set}: weak = only cancels/stops a
// pending fire; lk = the links 'from>to' (trigger to what it sets off) the piece is part of,
// so a chain trigger → if → trigger lights up as one. links: lk → {a, b, weak}.
// "start timeline" goes to the timeline, which in turn sets off its cue and end triggers.
function trigFlowGraph() {
  const p = P(), edges = new Map(), links = new Map(), extra = new Map();
  const add = (a, b, why, o = {}) => {
    if (a === b) return;
    const k = `${a}>${b}`;
    if (!edges.has(k)) edges.set(k, { a, b, why: [], br: [], weak: true, lk: new Set() });
    const e = edges.get(k);
    if (why && !e.why.includes(why)) e.why.push(why);
    if (o.br && !e.br.includes(o.br)) e.br.push(o.br);
    if (o.lk) e.lk.add(o.lk);
    if (!(o.weak ?? /^(cancel|stop)/.test(why || ''))) e.weak = false;
  };
  // path: [{k: trigger}, {k: if node, why: into it, br: branch taken out of it}, …]
  const reach = (path, to, why) => {
    if (path.length === 1 && path[0].k === to) return;   // fires itself directly: the red ! says so
    const weak = /^(cancel|stop)/.test(why), lk = `${path[0].k}>${to}`;
    path.forEach((s, i) => {
      const last = i === path.length - 1;
      add(s.k, last ? to : path[i + 1].k, last ? why : path[i + 1].why, { lk, br: s.br, weak });
    });
    const l = links.get(lk) || links.set(lk, { a: path[0].k, b: to, weak: true, lines: new Set() }).get(lk);
    if (!weak) l.weak = false;
    l.lines.add(curLine);   // which action line, for lighting up at the right time (flowPlay)
  };
  let curLine = 0;
  const trigs = p.triggers.filter((t) => t.type !== 'comment');
  for (const t of trigs) {
    let n = 0;
    const walk = (path, items) => {
      for (const it of items) {
        if (it.cmd == null) {
          const k = `if${t.id}.${n++}`, why = `if ${it.cond}`;
          extra.set(k, { cond: it.cond, t });
          walk([...path, { k, why, br: 'yes' }], it.yes);
          walk([...path, { k, why, br: 'no' }], it.no);
          continue;
        }
        for (const f of cmdEffects(it.cmd)) {
          if (f.kind === 'fire') reach(path, `t${f.t.id}`, f.why);
          else if (f.kind === 'timeline') reach(path, `tl${f.id}`, 'start timeline');
          else if (f.kind === 'panel') {
            // One feedback box per trigger (right under it), listing what it changes: a box
            // shared by every trigger that sets lbl_show would pull arrows from all over.
            const k = `fb:t${t.id}`;
            if (!extra.has(k)) extra.set(k, { fb: [], t });
            if (!extra.get(k).fb.includes(f.name)) extra.get(k).fb.push(f.name);
            reach(path, k, f.why);
          } else if (f.kind === 'mode' || f.kind === 'var') {
            // Through one box per mode group / variable: n triggers that set it and m that
            // listen give n + m arrows instead of n × m.
            const hub = f.kind === 'mode' ? `h:mode:${f.group.toLowerCase()}` : `h:var:${f.name.toLowerCase()}`;
            for (const d of trigs) {
              const w = d !== t && setsOff([f], d);
              if (!w) continue;
              if (!extra.has(hub)) extra.set(hub, { hub: f.kind === 'mode' ? `mode ${f.group}` : `var ${f.name}` });
              const into = f.kind === 'mode' ? `mode ${f.group} ${f.state}` : `var ${f.name} ${f.op === 'toggle' ? 'toggle' : f.op + ' …'}`;
              const out = d.type === 'mode' ? `changes to ${d.mode || 'any state'}` : `changes${d.value ? ` to ${d.value}` : ''}`;
              reach([...path, { k: hub, why: into }], `t${d.id}`, out);
            }
          } else for (const d of trigs) { const w = d !== t && setsOff([f], d); if (w) reach(path, `t${d.id}`, w); }
        }
        // The devices it controls: a box per device, under this trigger (like feedback).
        for (const o of cmdOutputs(it.cmd)) {
          const k = `o:t${t.id}:${o.kind}:${o.name.toLowerCase()}`;
          if (!extra.has(k)) extra.set(k, { out: o.name, kind: o.kind, type: o.type, acts: [], t });
          const n = extra.get(k);
          if (o.act && !n.acts.includes(o.act)) n.acts.push(o.act);
          reach(path, k, `${o.kind === 'drv' ? o.type : o.kind} ${o.act}`.trim());
        }
      }
    };
    (t.actions || []).forEach((line, i) => {
      curLine = i;
      if (line.trim() && !line.trim().startsWith('#')) walk([{ k: `t${t.id}` }], actionTree(line));
    });
    // Sources are links too, so "only this trigger" keeps where its events come from.
    const source = (k, label, why, desc) => {
      if (!extra.has(k)) extra.set(k, { src: label, desc });
      add(k, `t${t.id}`, why, { weak: false });
      links.set(`${k}>t${t.id}`, { a: k, b: `t${t.id}`, weak: false });
    };
    const s = trigSource(t);
    if (s) source(...s);
    // A variable that a show device (or Modbus) keeps up to date: that device sets it off.
    if (t.type === 'variable' && t.variable) {
      const v = t.variable.toLowerCase();
      for (const d of p.drivers || [])
        for (const [pt, name] of Object.entries(d.vars || {}))
          if (String(name).toLowerCase() === v)
            source(`s:drv:${String(d.name).toLowerCase()}`, `⌁ ${d.name}`, `reading ${pt} → var ${name}`, `From a show device: ${d.name} (${d.type}) - a reading linked to a variable`);
      const mb = p.variables.find((x) => x.name.toLowerCase() === v)?.modbus?.device;
      if (mb) source(`s:mb:${mb.toLowerCase()}`, `⌁ ${mb}`, `Modbus → var ${t.variable}`, `From a Modbus device: ${mb} - a value linked to a variable`);
    }
  }
  const step = (a, b, why) => { add(a, b, why); links.set(`${a}>${b}`, { a, b, weak: false }); };
  for (const tl of p.timelines) {
    for (const c of tl.cues) {
      if (c.trigger == null) continue;
      const h = findTrigs(String(c.trigger));
      if (h.length === 1) step(`tl${tl.id}`, `t${h[0].id}`, `cue at ${(c.t / 1000).toFixed(1)} s`);
    }
    for (const d of trigs) if (d.type === 'timeline_end' && d.timeline === tl.id) step(`tl${tl.id}`, `t${d.id}`, 'timeline ends');
  }
  // A trigger's own conditions: a diamond ('c<id>') just above it. Whatever sets it off goes into
  // the diamond, "yes" goes on into the trigger; a false condition stops there (lit red, onTrigLog).
  for (const t of trigs) {
    const conds = (t.conditions || []).filter((c) => c.trim()), k = `t${t.id}`, gk = `c${t.id}`;
    if (!conds.length) continue;
    const into = [...edges.values()].filter((e) => e.b === k);
    if (!into.length && ![...edges.values()].some((e) => e.a === k)) continue;   // not in the diagram
    extra.set(gk, { cond: conds.join(' and '), gate: true, t });
    const lk = new Set();
    for (const e of into) {
      edges.delete(`${e.a}>${k}`);
      e.lk.add(`${e.a}>${k}`);   // still part of that link (a source's own arrow has no other)
      e.b = gk;
      edges.set(`${e.a}>${gk}`, e);
      for (const l of e.lk) lk.add(l);
    }
    add(gk, k, '', { br: 'yes', weak: false });
    for (const l of lk) edges.get(`${gk}>${k}`).lk.add(l);
    links.set(`${gk}>${k}`, { a: gk, b: k, weak: false });
  }
  for (const e of edges.values()) e.lk.add(`${e.a}>${e.b}`);
  const used = new Set([...edges.values()].flatMap((e) => [e.a, e.b]));
  // First places: sources, then each trigger with its ifs and feedback, mode/variable boxes, timelines.
  const nodes = new Map(), ex = [...extra];
  for (const [k, n] of ex) if (n.src && used.has(k)) nodes.set(k, n);
  for (const t of trigs) {
    if (used.has(`t${t.id}`)) nodes.set(`t${t.id}`, { t });
    for (const [k, n] of ex) if (n.t === t && used.has(k)) nodes.set(k, n);
  }
  for (const [k, n] of ex) if (n.hub && used.has(k)) nodes.set(k, n);
  for (const tl of p.timelines) if (used.has(`tl${tl.id}`)) nodes.set(`tl${tl.id}`, { tl });
  return { nodes, edges: [...edges.values()], links, hidden: trigs.length - [...nodes.keys()].filter((k) => /^t\d/.test(k)).length };
}
const FLOW_W = 170, FLOW_H = 30, FLOW_ROW = 40, FLOW_GX = 18, FLOW_GY = 46, FLOW_PAD = 14, FLOW_LOOP = 60, FLOW_LANE = 12;
const flowNodeH = (n) => (n.cond != null ? FLOW_ROW : n.src || n.fb || n.hub || n.out ? 26 : FLOW_H);
const flowNodeW = (n) => (n.hub ? 140 : FLOW_W);
// Rows from top to bottom: where events come from, the triggers, what they set off. Every
// box sits as close as it can above what it sets off, so arrows stay short. Loops are found
// depth-first and don't push boxes further down (drawn going back up along the right side).
// An arrow that skips rows gets a lane point in each row it passes (a thin invisible box), so
// the ordering keeps it out of the way of the boxes and other arrows. One connected part of
// the graph; positions from 0,0. via: arrow 'a>b' → its lane points.
function flowPart(g, keys, edges) {
  const outs = new Map(keys.map((k) => [k, []])), ins = new Map(keys.map((k) => [k, []]));
  for (const e of edges) { outs.get(e.a).push(e.b); ins.get(e.b).push(e.a); }
  const state = new Map(), back = new Set(), post = [];
  const visit = (k) => {
    state.set(k, 1);
    for (const b of outs.get(k)) {
      if (state.get(b) === 1) back.add(`${k}>${b}`);
      else if (!state.has(b)) visit(b);
    }
    state.set(k, 2);
    post.push(k);
  };
  for (const k of keys) if (!ins.get(k).length) visit(k);
  for (const k of keys) if (!state.has(k)) visit(k);
  const fwd = (k) => outs.get(k).filter((b) => !back.has(`${k}>${b}`));
  const layer = new Map(keys.map((k) => [k, 0]));
  for (const k of [...post].reverse()) for (const b of fwd(k)) layer.set(b, Math.max(layer.get(b), layer.get(k) + 1));
  // Then down again, children first: each box just above the first thing it sets off.
  for (const k of post) {
    const c = fwd(k);
    if (c.length) layer.set(k, Math.max(layer.get(k), Math.min(...c.map((b) => layer.get(b))) - 1));
  }
  const used = [...new Set(layer.values())].sort((a, b) => a - b), rowNo = new Map(used.map((l, i) => [l, i]));
  const R = used.map(() => []), rowOf = new Map();
  for (const k of keys) { const r = rowNo.get(layer.get(k)); rowOf.set(k, r); R[r].push(k); }
  // Lane points; up/dn = neighbours one row up/down (real boxes and lane points alike).
  const up = new Map(keys.map((k) => [k, []])), dn = new Map(keys.map((k) => [k, []])), via = new Map(), width = new Map();
  for (const k of keys) width.set(k, flowNodeW(g.nodes.get(k)));
  for (const e of edges) {
    if (back.has(`${e.a}>${e.b}`)) continue;
    let prev = e.a;
    const pts = [];
    for (let r = rowOf.get(e.a) + 1; r < rowOf.get(e.b); r++) {
      const d = `~${e.a}>${e.b}~${r}`;
      R[r].push(d); rowOf.set(d, r); width.set(d, FLOW_LANE); up.set(d, []); dn.set(d, []);
      up.get(d).push(prev); dn.get(prev).push(d); pts.push(d); prev = d;
    }
    up.get(e.b).push(prev); dn.get(prev).push(e.b);
    via.set(`${e.a}>${e.b}`, pts);
  }
  // Order in each row: start in list order, then sweeps down and up that move each box to
  // the middle (median) of its neighbours, plus swapping neighbours where that helps; the
  // order with the fewest crossing arrows wins.
  const idx = new Map();
  const index = () => R.forEach((r) => r.forEach((k, i) => idx.set(k, i)));
  index();
  const crossings = () => {
    let n = 0;
    for (let r = 0; r + 1 < R.length; r++) {
      const segs = R[r].flatMap((a) => dn.get(a).map((b) => [idx.get(a), idx.get(b)]));
      for (let i = 0; i < segs.length; i++)
        for (let j = i + 1; j < segs.length; j++) if ((segs[i][0] - segs[j][0]) * (segs[i][1] - segs[j][1]) < 0) n++;
    }
    return n;
  };
  const median = (k, nb) => {
    const p = nb.get(k).map((x) => idx.get(x)).sort((a, b) => a - b);
    if (!p.length) return idx.get(k);
    const m = p.length >> 1;
    return p.length % 2 ? p[m] : (p[m - 1] + p[m]) / 2;
  };
  const sortRow = (r, nb) => {
    const m = new Map(R[r].map((k) => [k, median(k, nb)]));
    R[r].sort((a, b) => m.get(a) - m.get(b) || idx.get(a) - idx.get(b));
    R[r].forEach((k, i) => idx.set(k, i));
  };
  // Crossings between u (left) and v (right) with their neighbours in one other row.
  const cross = (u, v, nb) => { let n = 0; for (const a of nb.get(u)) for (const b of nb.get(v)) if (idx.get(a) > idx.get(b)) n++; return n; };
  const transpose = () => {
    for (let better = true, n = 0; better && n < 6; n++) {
      better = false;
      for (const r of R)
        for (let i = 0; i + 1 < r.length; i++) {
          const u = r[i], v = r[i + 1];
          if (cross(v, u, up) + cross(v, u, dn) < cross(u, v, up) + cross(u, v, dn)) {
            r[i] = v; r[i + 1] = u; idx.set(v, i); idx.set(u, i + 1); better = true;
          }
        }
    }
  };
  let best = crossings(), bestR = R.map((r) => [...r]);
  for (let pass = 0; pass < 8 && best > 0; pass++) {
    if (pass % 2 === 0) for (let r = 1; r < R.length; r++) sortRow(r, up);
    else for (let r = R.length - 2; r >= 0; r--) sortRow(r, dn);
    transpose();
    const c = crossings();
    if (c < best) { best = c; bestR = R.map((r) => [...r]); }
  }
  bestR.forEach((r, i) => (R[i] = r));
  index();
  // Across (centres): each box under the middle of what it is linked to, without
  // overlapping (the average of a left-to-right and a right-to-left packing).
  const x = new Map();
  for (const r of R) { let at = 0; for (const k of r) { x.set(k, at + width.get(k) / 2); at += width.get(k) + FLOW_GX; } }
  const gap = (a, b) => (width.get(a) + width.get(b)) / 2 + (a[0] === '~' && b[0] === '~' ? 4 : FLOW_GX);
  const place = (r, nb) => {
    const want = r.map((k) => { const n = nb.get(k); return n.length ? n.reduce((s, a) => s + x.get(a), 0) / n.length : x.get(k); });
    const l = [], rt = [];
    want.forEach((w, i) => (l[i] = i ? Math.max(w, l[i - 1] + gap(r[i - 1], r[i])) : w));
    for (let i = want.length - 1; i >= 0; i--) rt[i] = i < want.length - 1 ? Math.min(want[i], rt[i + 1] - gap(r[i], r[i + 1])) : want[i];
    r.forEach((k, i) => x.set(k, (l[i] + rt[i]) / 2));
  };
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < R.length; i++) place(R[i], up);
    for (let i = R.length - 2; i >= 0; i--) place(R[i], dn);
  }
  const all = [...x.keys()];
  const minX = Math.min(...all.map((k) => x.get(k) - width.get(k) / 2)), maxX = Math.max(...all.map((k) => x.get(k) + width.get(k) / 2));
  const rowY = (r) => r * (FLOW_ROW + FLOW_GY);
  const pos = new Map(keys.map((k) => {
    const h = flowNodeH(g.nodes.get(k)), w = width.get(k);
    return [k, { x: x.get(k) - w / 2 - minX, y: rowY(rowOf.get(k)) + (FLOW_ROW - h) / 2, w, h }];
  }));
  for (const [ek, pts] of via) via.set(ek, pts.map((d) => ({ x: x.get(d) - minX, y: rowY(rowOf.get(d)) + FLOW_ROW / 2 })));
  return { pos, back, via, w: maxX - minX + (back.size ? FLOW_LOOP : 0), h: rowY(R.length) - FLOW_GY };
}
// Chains that have nothing to do with each other are laid out on their own and then placed
// next to each other in list order, wrapping like text, so the diagram doesn't get very wide.
function trigFlowLayout(g) {
  const keys = [...g.nodes.keys()], order = new Map(keys.map((k, i) => [k, i]));
  const root = new Map(keys.map((k) => [k, k]));
  const find = (k) => (root.get(k) === k ? k : (root.set(k, find(root.get(k))), root.get(k)));
  for (const e of g.edges) root.set(find(e.a), find(e.b));
  const parts = new Map();
  for (const k of keys) (parts.get(find(k)) || parts.set(find(k), []).get(find(k))).push(k);
  const laid = [...parts.values()].map((ks) => { const s = new Set(ks); return flowPart(g, ks, g.edges.filter((e) => s.has(e.a))); });
  const big = Math.max(...laid.map((l) => l.w)), maxW = Math.max(big, 1100), GAP = 40;
  // Wide chains first (they are the main show), then the small ones in list order.
  laid.sort((a, b) => (b.w > maxW / 2) - (a.w > maxW / 2) || order.get(a.pos.keys().next().value) - order.get(b.pos.keys().next().value));
  const pos = new Map(), back = new Set(), via = new Map();
  let x = 0, y = 0, lineH = 0, w = 0;
  for (const l of laid) {
    if (x && x + l.w > maxW) { x = 0; y += lineH + GAP; lineH = 0; }
    for (const [k, p] of l.pos) pos.set(k, { ...p, x: FLOW_PAD + x + p.x, y: FLOW_PAD + y + p.y });
    for (const [k, pts] of l.via) via.set(k, pts.map((p) => ({ x: FLOW_PAD + x + p.x, y: FLOW_PAD + y + p.y })));
    for (const b of l.back) back.add(b);
    x += l.w + GAP;
    w = Math.max(w, x - GAP);
    lineH = Math.max(lineH, l.h);
  }
  return { pos, back, via, w: FLOW_PAD * 2 + w, h: FLOW_PAD * 2 + y + lineH };
}
// "Only this trigger": what sets it off (all the way up to where the events come from) and
// what it sets off (all the way down), following the trigger-to-trigger links, so a mode
// box keeps only the arrows of this chain.
function flowFocus(g, key) {
  const from = new Map(), to = new Map(), keep = new Set();
  for (const [lk, l] of g.links) {
    (from.get(l.a) || from.set(l.a, []).get(l.a)).push(lk);
    (to.get(l.b) || to.set(l.b, []).get(l.b)).push(lk);
  }
  const walk = (down) => {
    const seen = new Set([key]), queue = [key];
    while (queue.length)
      for (const lk of (down ? from : to).get(queue.shift()) || []) {
        keep.add(lk);
        const n = g.links.get(lk)[down ? 'b' : 'a'];
        if (!seen.has(n)) { seen.add(n); queue.push(n); }
      }
  };
  walk(true);
  walk(false);
  const edges = g.edges.filter((e) => [...e.lk].some((l) => keep.has(l)));
  const used = new Set([key, ...edges.flatMap((e) => [e.a, e.b])]);
  return { ...g, edges, nodes: new Map([...g.nodes].filter(([k]) => used.has(k))) };
}
// Colour filter: the triggers with one of these colours ('' = none) and everything linked to
// them one step up or down; other triggers on those links stay as context, dimmed.
const flowColKey = (t) => (trigColor(t.color) ? t.color : '');
function flowByColour(g, cols) {
  const match = new Set([...g.nodes].filter(([k, n]) => /^t\d/.test(k) && cols.has(flowColKey(n.t))).map(([k]) => k));
  const keep = new Set([...g.links].filter(([, l]) => match.has(l.a) || match.has(l.b)).map(([lk]) => lk));
  const edges = g.edges.filter((e) => [...e.lk].some((l) => keep.has(l)));
  const used = new Set([...match, ...edges.flatMap((e) => [e.a, e.b])]);
  return { ...g, edges, nodes: new Map([...g.nodes].filter(([k]) => used.has(k))), dim: new Set([...used].filter((k) => /^t\d/.test(k) && !match.has(k))) };
}
// The whole flow gets one device box per trigger ("2 projectors, 4 PCs"), so it doesn't get
// very wide; "only this trigger" shows each device. ren: device box → the merged box.
function flowMergeDevices(g) {
  const per = new Map(), ren = new Map();
  for (const [k, n] of g.nodes) if (n.out) (per.get(n.t) || per.set(n.t, []).get(n.t)).push(k);
  for (const [t, ks] of per) if (ks.length > 1) for (const k of ks) ren.set(k, `o:t${t.id}:*`);
  const nodes = new Map();
  for (const [k, n] of g.nodes) {
    const r = ren.get(k);
    if (!r) nodes.set(k, n);
    else if (!nodes.has(r)) nodes.set(r, { out: '*', list: per.get(n.t).map((x) => g.nodes.get(x)), t: n.t, acts: [] });
  }
  const edges = new Map();
  for (const e of g.edges) {
    const a = ren.get(e.a) || e.a, b = ren.get(e.b) || e.b, k = `${a}>${b}`, m = edges.get(k);
    if (!m) { edges.set(k, { ...e, a, b, why: [...e.why], br: [...e.br], lk: new Set(e.lk) }); continue; }
    for (const w of e.why) if (!m.why.includes(w)) m.why.push(w);
    for (const b2 of e.br) if (!m.br.includes(b2)) m.br.push(b2);
    for (const l of e.lk) m.lk.add(l);
    m.weak = m.weak && e.weak;
  }
  return { ...g, nodes, edges: [...edges.values()], ren };
}
const OUT_PLURAL = { projector: 'projectors', pc: 'PCs' };
// Big view (⤢), zoom and "only this trigger" are per page visit; the height of the small box is remembered.
const flowZoom = () => S.flowZoom || 1;
// "Only this trigger" is on until it is unticked (the whole flow of a big show is a lot to read).
const flowOnly = () => S.flowOnly !== false;
function trigFlowHtml(selT) {
  const focus = flowOnly() && selT && selT.type !== 'comment';
  const full = trigFlowGraph(), fc = S.flowColors || (S.flowColors = new Set());
  // Colours of the triggers in the flow (in palette order, then custom ones).
  const colOrder = Object.keys(TRIGGER_COLORS), cols = new Map();
  for (const [k, n] of full.nodes) if (/^t\d/.test(k)) cols.set(flowColKey(n.t), (cols.get(flowColKey(n.t)) || 0) + 1);
  for (const c of fc) if (!cols.has(c)) fc.delete(c);
  const colList = [...cols.keys()].sort((a, b) => (colOrder.includes(a) ? colOrder.indexOf(a) : 99) - (colOrder.includes(b) ? colOrder.indexOf(b) : 99));
  const g = focus ? flowFocus(full, `t${selT.id}`) : flowMergeDevices(fc.size ? flowByColour(full, fc) : full);
  S.flowGraph = g;   // for the live part (onTrigLog)
  let h = 0;
  try { h = +localStorage.getItem('kd.trigFlowH') || 0; } catch { /* private mode */ }
  const big = !!S.flowBig, z = flowZoom();
  const only = selT && selT.type !== 'comment'
    ? `<label class="muted flow-only${flowOnly() ? ' on' : ''}" title="Show only what sets this trigger off and what it sets off. Click another box to follow its flow."><input type="checkbox" id="flowOnly"${flowOnly() ? ' checked' : ''}> only #${selT.id} ${esc(selT.name.length > 22 ? selT.name.slice(0, 21) + '…' : selT.name)}</label>`
    : flowOnly() ? '<span class="muted flow-only" title="Select a trigger to see only its flow">only: select a trigger</span>' : '';
  const tools = `<div class="flow-tools">${only}<button class="btn small ghost" data-flowzoom="-1" title="Smaller">−</button><button class="btn small ghost" data-flowzoom="0" title="Back to 100 %">${Math.round(z * 100)} %</button><button class="btn small ghost" data-flowzoom="1" title="Bigger">+</button>
    <button class="btn small" id="flowBig" title="${big ? 'Back to the trigger list (Esc)' : 'Show the flow on the whole screen'}">${big ? '✕ Close' : '⤢ Expand'}</button></div>`;
  const colRow = focus || colList.length < 2 ? '' : `<div class="row col-filter flow-cols${fc.size ? ' some' : ''}" title="Show only the flow of triggers with these colours (click several; click again to turn off)">
    <span class="muted">Colours:</span>${colList.map((c) => `<button class="swatch${fc.has(c) ? ' on' : ''}" data-flowcol="${esc(c)}" title="${esc(trigColorLabel(c))} (${cols.get(c)} trigger${cols.get(c) === 1 ? '' : 's'} in the flow)" style="${c ? `background:${trigColor(c)}` : ''}">${c ? '' : '∅'}</button>`).join('')}
    ${fc.size ? '<button class="btn small ghost" data-flowcol-clear>all colours</button>' : ''}</div>`;
  const box = (inner, help = '') => `<div class="trig-flow-wrap${big ? ' big' : ''}">${big ? '<h3>Trigger flow</h3>' : ''}${tools}${colRow}<div class="trig-flow"${big ? '' : ` style="height:${h || 320}px"`}>${inner}</div>${help}</div>`;
  if (!g.nodes.size) return box(`<p class="muted" style="margin:12px">${focus ? `#${selT.id} ${esc(selT.name)} isn't linked to anything: no event source, and it doesn't set off or get set off by another trigger.` : 'No trigger or timeline sets off another trigger yet (fire trigger, a mode or variable change, a trigger cue on a timeline, a timeline end…).'}</p>`);
  const L = trigFlowLayout(g), p = P();
  const selKey = selT ? `t${selT.id}` : '';
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  // Endless loops (the red ! in the list) are drawn red; "unless a condition stops it" are not.
  const looping = new Set(p.triggers.filter((t) => /loops endlessly|runs forever/.test(triggerLoop(t) || '') && !/unless a condition/.test(triggerLoop(t))).map((t) => `t${t.id}`));
  const owner = (k) => (g.nodes.get(k).cond != null ? `t${g.nodes.get(k).t.id}` : k);
  const edgeSvg = (e) => {
    const a = L.pos.get(e.a), b = L.pos.get(e.b);
    const back = L.back.has(`${e.a}>${e.b}`) || b.y <= a.y, no = e.br.length === 1 && e.br[0] === 'no';
    let d, sx, sy, mx, my;
    if (back) {   // up along the right-hand side, into the right of the box
      const tx = b.x + b.w + 2, ty = b.y + b.h / 2, ox = Math.max(a.x + a.w, tx) + FLOW_LOOP - 8;
      sx = a.x + a.w; sy = a.y + a.h / 2;
      d = `M${sx} ${sy} C${ox} ${sy} ${ox} ${ty} ${tx} ${ty}`;
      mx = ox - 10; my = (sy + ty) / 2;
    } else {      // down: from the bottom (an if's "no" from its right point) to the top, through its lane points
      const pts = [...(L.via.get(`${e.a}>${e.b}`) || []), { x: b.x + b.w / 2, y: b.y - 2 }];
      if (no) { sx = a.x + a.w; sy = a.y + a.h / 2; } else { sx = a.x + a.w / 2; sy = a.y + a.h; }
      d = `M${sx} ${sy}`;
      let px = sx, py = sy;
      pts.forEach((q, i) => {
        const dy = Math.max(12, (q.y - py) / 2);
        d += i === 0 && no ? ` C${px + 40} ${py} ${q.x} ${q.y - dy} ${q.x} ${q.y}` : ` C${px} ${py + dy} ${q.x} ${q.y - dy} ${q.x} ${q.y}`;
        px = q.x; py = q.y;
      });
      const mid = pts.length > 1 ? pts[(pts.length - 1) >> 1] : null;
      mx = mid ? mid.x : (sx + px) / 2; my = mid ? mid.y : (sy + py) / 2;
    }
    const sel = !!selKey && [...e.lk].some((l) => l.startsWith(`${selKey}>`) || l.endsWith(`>${selKey}`));
    const loop = back && looping.has(owner(e.a)) && looping.has(owner(e.b));
    const cls = `fl-edge${e.weak ? ' weak' : ''}${back ? ' back' : ''}${loop ? ' loop' : ''}${sel ? ' sel' : ''}`;
    const br = e.br.length ? `<text class="fl-br ${e.br.join('-')}" x="${no ? sx + 6 : sx + 5}" y="${no ? sy - 4 : sy + 13}">${e.br.join('/')}</text>` : '';
    // (not into a device or feedback box: the box itself says what it does)
    // A timeline's arrows always say when on the timeline they fire (just above the trigger).
    const when = /^tl\d/.test(e.a) ? e.why.map((w) => (w === 'timeline ends' ? 'at end' : w.replace(/^cue at /, ''))).sort((x, y) => (x === 'at end' ? 1e9 : parseFloat(x)) - (y === 'at end' ? 1e9 : parseFloat(y))) : null;
    const label = when?.length ? `<text class="fl-why fl-when" x="${back ? mx : b.x + b.w / 2 + 6}" y="${back ? my : b.y - 7}" text-anchor="${back ? 'middle' : 'start'}">⏱ ${esc(cut(when.join(', '), 30))}</text>`
      : sel && e.why.length && !e.why.every((w) => w.startsWith('if ')) && !/^(o|fb):/.test(e.b) ? `<text class="fl-why" x="${mx}" y="${my}" text-anchor="middle">${esc(cut(e.why.join(', '), 34))}</text>` : '';
    return `<g class="${cls}" data-ek="${esc(`${e.a}>${e.b}`)}"><title>${esc([...(e.br.length ? [e.br.join(' / ')] : []), ...e.why].join('\n'))}${loop ? '\nEndless loop!' : ''}</title><path d="${d}"/><path class="hit" d="${d}"/>${br}${label}</g>`;
  };
  const nodeSvg = ([k, n]) => {
    const { x, y, w, h } = L.pos.get(k), fk = esc(k);
    if (n.tl) {
      return `<g class="fl-node tl" data-fk="${fk}" data-goto-timeline="${n.tl.id}"><title>Timeline ${n.tl.id} '${esc(n.tl.name)}' - click to open</title>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/><text x="${x + 12}" y="${y + 19}">◆ ${n.tl.id} ${esc(cut(n.tl.name || '', 20))}</text></g>`;
    }
    if (n.cond != null) {
      const i = p.triggers.indexOf(n.t), cx = x + w / 2, cy = y + h / 2;
      const title = n.gate ? `Conditions of trigger #${n.t.id} ${esc(n.t.name)}:\n${esc(n.t.conditions.filter((c) => c.trim()).join('\n'))}\nyes = all true, it runs; otherwise it is skipped (flashes red)`
        : `if ${esc(n.cond)}\n(in trigger #${n.t.id} ${esc(n.t.name)})\nyes = then, no = else`;
      return `<g class="fl-node if${n.gate ? ' gate' : ''}${owner(k) === selKey ? ' sel' : ''}" data-fk="${fk}" data-sel="trigger:${i}"><title>${title}</title>
        <polygon points="${x},${cy} ${cx},${y} ${x + w},${cy} ${cx},${y + h}"/><text x="${cx}" y="${cy + 4}" text-anchor="middle">${esc(cut(n.cond, 22))}?</text></g>`;
    }
    if (n.list) {   // several devices of one trigger, merged
      const kinds = new Map();
      for (const d of n.list) kinds.set(d.kind, (kinds.get(d.kind) || 0) + 1);
      const acts = [...new Set(n.list.flatMap((d) => d.acts))];
      const text = [...kinds].map(([kd, c]) => `${OUT_KINDS[kd][0]} ${c > 1 ? `${c} ${OUT_PLURAL[kd] || 'devices'}` : n.list.find((d) => d.kind === kd).out}`).join(', ') + (acts.length === 1 ? `: ${acts[0]}` : '');
      return `<g class="fl-node out" data-fk="${fk}"><title>${esc(`Trigger #${n.t.id} ${n.t.name} controls:\n${n.list.map((d) => `${OUT_KINDS[d.kind][0]} ${d.out}${d.acts.length ? `: ${d.acts.join(', ')}` : ''}`).join('\n')}\n(tick "only" with this trigger selected to see each device)`)}</title>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/><text x="${x + w / 2}" y="${y + 17}" text-anchor="middle">${esc(cut(text, 26))}</text></g>`;
    }
    if (n.out) {
      const [icon, what] = OUT_KINDS[n.kind];
      return `<g class="fl-node out" data-fk="${fk}"><title>${esc(`${n.kind === 'drv' ? `${what} (${n.type})` : what} ${n.out}${n.acts.length ? `: ${n.acts.join(', ')}` : ''}\n(by trigger #${n.t.id} ${n.t.name})`)}</title>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/><text x="${x + w / 2}" y="${y + 17}" text-anchor="middle">${esc(cut(`${icon} ${n.out}${n.acts.length ? `: ${n.acts.join(', ')}` : ''}`, 26))}</text></g>`;
    }
    if (n.src || n.fb || n.hub) {
      const cls = n.fb ? 'fb' : n.hub ? 'hub' : 'src';
      const title = n.fb ? `Feedback: trigger #${n.t.id} changes panel control${n.fb.length > 1 ? 's' : ''} / label${n.fb.length > 1 ? 's' : ''} ${n.fb.map((f) => `'${esc(f)}'`).join(', ')}`
        : n.hub ? `${esc(n.hub)}: the triggers above change it, the triggers below react to the change`
          : esc([n.desc || n.src, ...g.edges.filter((e) => e.a === k).map((e) => { const t = g.nodes.get(e.b).t; return `${e.why.join(', ')} → #${t.id} ${t.name}`; })].join('\n'));
      return `<g class="fl-node ${cls}" data-fk="${fk}"><title>${title}</title>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${n.hub ? 4 : h / 2}"/><text x="${x + w / 2}" y="${y + 17}" text-anchor="middle">${esc(cut(n.fb ? `↩ ${n.fb.join(', ')}` : n.hub ? `◇ ${n.hub}` : n.src, n.hub ? 21 : 26))}</text></g>`;
    }
    // (its conditions have their own diamond above it when it has links)
    const t = n.t, col = trigColor(t.color), i = p.triggers.indexOf(t), cond = t.conditions?.some((c) => c.trim()) && !g.nodes.has(`c${t.id}`);
    // The name gets what the number and the type (right) leave free, about 7 px a letter.
    const room = Math.max(6, Math.floor((w - 26 - String(t.id).length * 6.5 - (t.type.length + (cond ? 3 : 0)) * 6) / 7));
    return `<g class="fl-node${k === selKey ? ' sel' : ''}${t.enabled === false ? ' disabled' : ''}${looping.has(k) ? ' looping' : ''}${g.dim?.has(k) ? ' dim' : ''}" data-fk="${fk}" data-sel="trigger:${i}"><title>#${t.id} ${esc(t.name)} (${esc(t.type)})${t.enabled === false ? ' - disabled' : ''}${cond ? `\nOnly if: ${esc(t.conditions.filter((c) => c.trim()).join(' and '))}` : ''}${looping.has(k) ? `\n${esc(triggerLoop(t))}` : ''}</title>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>${col ? `<rect class="fl-col" x="${x}" y="${y}" width="4" height="${h}" style="fill:${col}"/>` : ''}
      <text x="${x + 10}" y="${y + 19}"><tspan class="fl-id">${t.id}</tspan> ${esc(cut(t.name || '', room))}</text><text class="fl-type" x="${x + w - 6}" y="${y + 19}" text-anchor="end">${cond ? '<tspan class="fl-if">if</tspan> ' : ''}${esc(t.type)}</text></g>`;
  };
  return box(`<svg width="${Math.round(L.w * z)}" height="${Math.round(L.h * z)}" viewBox="0 0 ${L.w} ${L.h}">
    <defs><marker id="flArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z"/></marker>
      <marker id="flArrowHot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z"/></marker>
      <marker id="flArrowLoop" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z"/></marker></defs>
    ${g.edges.map(edgeSvg).join('')}${[...g.nodes].map(nodeSvg).join('')}</svg>`,
  `<p class="muted flow-help">Top to bottom: where events come from (round boxes), the triggers and what they set off; mode and variable changes go through a ◇ box; under a trigger, the panel buttons and labels it changes (↩ feedback). Diamonds are conditions: right above a trigger its own (<b class="ok">yes</b> = all true, it runs; flashes red when it fired but a condition was false), further down the <code>if</code>s in its actions (<b class="ok">yes</b> = then, <b class="bad">no</b> = else). Select a trigger to see why each arrow is there. Dashed: cancels/stops, or goes back up; red = an endless loop.${focus ? ` Only the flow of #${selT.id} ${esc(selT.name)}: what sets it off and what it sets off.` : fc.size ? ' Only the triggers with the picked colours and what is linked to them (other triggers dimmed).' : g.hidden ? ` ${g.hidden} trigger${g.hidden === 1 ? '' : 's'} without links not shown.` : ''}</p>`);
}
// After an edit in the editor: redraw only the diagram, so the field being typed in keeps its focus.
function refreshTrigFlow() {
  const wrap = $('.trig-flow-wrap'), t = P().triggers[S.sel.trigger];
  if (!wrap || S.view !== 'triggers') return;
  wrap.outerHTML = trigFlowHtml(t && t.type !== 'comment' ? t : null);
  trigFlowAfter();
}
function trigFlowAfter() {
  const flow = $('.trig-flow');
  if (!flow) return;
  flow.scrollLeft = S.flowScroll?.[0] || 0;
  flow.scrollTop = S.flowScroll?.[1] || 0;
  flow.addEventListener('scroll', () => (S.flowScroll = [flow.scrollLeft, flow.scrollTop]));
  // The small box can be resized (bottom edge); remember the height in this browser.
  if (!S.flowBig) new ResizeObserver(() => { try { localStorage.setItem('kd.trigFlowH', String(flow.offsetHeight)); } catch { /* private mode */ } }).observe(flow);
  $('#flowBig').addEventListener('click', () => { S.flowBig = !S.flowBig; S.flowScroll = null; render(); });
  $('#flowOnly')?.addEventListener('change', (e) => { S.flowOnly = e.target.checked; S.flowScroll = null; render(); });
  $$('[data-flowcol]').forEach((b) => b.addEventListener('click', () => {
    const c = b.dataset.flowcol;
    S.flowColors.has(c) ? S.flowColors.delete(c) : S.flowColors.add(c);
    S.flowScroll = null;
    render();
  }));
  $('[data-flowcol-clear]')?.addEventListener('click', () => { S.flowColors.clear(); S.flowScroll = null; render(); });
  for (const b of $$('[data-flowzoom]')) b.addEventListener('click', () => {
    const d = +b.dataset.flowzoom, z = flowZoom();
    S.flowZoom = d ? Math.max(0.3, Math.min(2, Math.round((z + d * (z < 1 || (z === 1 && d < 0) ? 0.1 : 0.25)) * 100) / 100)) : 1;
    render();
  });
}
// Live: the controller logs "Trigger 5 'Name' fired (<reason>[ from trigger 3])" (Triggers.cpp,
// runTrigger). Light up that box and the arrow it came by. Without a "from" (a mode or variable
// change is handled later in the main loop), the arrow is the one from the trigger that fired last.
const FIRED_LINE = /^Trigger (\d+) '.*' fired \((.*)\)$/;
const flowFk = (k) => `[data-fk="${CSS.escape(k)}"]`, flowEk = (e) => `[data-ek="${CSS.escape(`${e.a}>${e.b}`)}"]`;
// Light up the arrows of link lk (trigger → what it sets off), and the ifs and boxes on the way.
function flowChain(g, lk) {
  for (const e of g?.edges || []) if (e.lk.has(lk)) { flowFlash(flowEk(e)); if (e.a !== lk.split('>')[0]) flowFlash(flowFk(e.a)); }
}
// When each action line of t runs, in ms after it fires: [{line, at, wait}]. A "sleep" moves
// the lines after it on; lines after a "wait until" have wait: true (at = after the wait
// ends); a "repeat n times every s" line runs once per round and holds up the lines after it.
function actionTimes(t) {
  const out = [];
  let at = 0, wait = false;
  (t.actions || []).forEach((raw, i) => {
    const a = raw.trim();
    const sl = /^sleep\s+(\d+(?:\.\d+)?)\s*$/i.exec(a);
    if (sl) { at += +sl[1] * 1000; return; }
    if (/^wait\s+until\b/i.test(a)) { if (!wait) { wait = true; at = 0; } return; }
    const rp = /^repeat\s+(\d+)\s+times\s+(?:every\s+(\d+(?:\.\d+)?)\s)?/i.exec(a) || /^repeat\s+(?:"[^"]*"|\S+)\s+(\d+)\s+times\s+every\s+(\d+(?:\.\d+)?)/i.exec(a);
    const n = rp && rp[2] ? Math.min(+rp[1], 50) : 1, every = rp && rp[2] ? +rp[2] * 1000 : 0;
    for (let k = 0; k < n; k++) out.push({ line: i, at: at + k * every, wait });
    at += (n - 1) * every;
  });
  return out;
}
// What a trigger changes (timelines, panel feedback, devices) lights up when that action line
// runs, not all at once when it fires. Lines after a "wait until" wait for the status to show
// the wait is over (updateTrigRunning). An "if" may skip a line, but the log doesn't say.
function flowPlay(t, key, g) {
  const byLine = new Map();
  for (const l of g.links.values())
    if (l.a === key && /^(tl|fb:|o:)/.test(l.b)) for (const i of l.lines || []) (byLine.get(i) || byLine.set(i, []).get(i)).push(l);
  if (!byLine.size) return;
  const light = (ls) => {
    for (const l of ls) {
      flowChain(g, `${l.a}>${l.b}`);
      flowFlash(flowFk(g.ren?.get(l.b) || l.b));
      (S.flowRecent || (S.flowRecent = new Map())).set(l.b, Date.now());
    }
  };
  const later = [];
  for (const x of actionTimes(t)) {
    const ls = byLine.get(x.line);
    if (!ls) continue;
    if (x.wait) later.push([x.at, ls]);
    else if (x.at) setTimeout(() => light(ls), x.at);
    else light(ls);
  }
  if (later.length) (S.flowWaits || (S.flowWaits = new Map())).set(t.id, { at: Date.now(), seen: false, run: () => later.forEach(([ms, ls]) => setTimeout(() => light(ls), ms)) });
}
// "Trigger 5 'Name' skipped (<reason>[ from trigger 3]): condition false: '<condition>'": it fired,
// but a condition was false so nothing ran. The row flashes grey/red, the diamond red.
const SKIPPED_LINE = /^Trigger (\d+) '.*' skipped \((.*)\): condition false: '(.*)'$/;
// Where a fire came from, as the row's marker before the number: "38 →", "TL 2 →".
function firedFromMark(row, from, cls = '') {
  row.querySelector('.fired-from')?.remove();
  const src = from ? (from.startsWith('tl') ? `TL ${from.slice(2)}` : from.slice(1)) : '';
  if (src) row.querySelector('.id').insertAdjacentHTML('beforebegin', `<span class="fired-from${cls}" title="Set off by ${src.startsWith('TL') ? 'timeline' : 'trigger'} ${src.replace('TL ', '')}">${src} →</span>`);
  clearTimeout(row.firedFrom);
  row.firedFrom = setTimeout(() => row.querySelector('.fired-from')?.remove(), 2200);
}
function onTrigSkipped(x, g) {
  const key = `t${x[1]}`, gate = `c${x[1]}`, ft = /from trigger (\d+)/.exec(x[2]), tl = /^timeline (\d+) (cue|end)/.exec(x[2]);
  const from = ft ? `t${ft[1]}` : tl ? `tl${tl[1]}` : null;
  // The arrow it came by into the diamond (from that trigger, or from where its event comes from).
  for (const e of g?.edges || []) if (e.b === gate && (from ? e.lk.has(`${from}>${key}`) : e.a.startsWith('s:'))) { flowFlash(flowEk(e)); if (e.a.startsWith('s:')) flowFlash(flowFk(e.a)); }
  flowFlash(flowFk(gate), 'no', 1000);
  if (!g?.nodes.has(gate)) flowFlash(flowFk(key), 'no', 1000);
  const i = P().triggers.findIndex((t) => t.id === +x[1] && t.type !== 'comment');
  const row = i >= 0 && $(`.trig-list [data-sel="trigger:${i}"]`);
  if (!row) return;
  firedFromMark(row, from, ' no');
  row.querySelector('.skip-tag')?.remove();
  row.querySelector('.tname').insertAdjacentHTML('afterend', `<span class="skip-tag" title="It fired, but this condition was false, so its actions did not run:\n${esc(x[3])}">✕ if</span>`);
  clearTimeout(row.skipTag);
  row.skipTag = setTimeout(() => row.querySelector('.skip-tag')?.remove(), 2200);
  flowFlash(row, 'no', 1000);
}
function onTrigLog(m) {
  const x = m.c === 'TRIG' && FIRED_LINE.exec(m.m || ''), sk = m.c === 'TRIG' && !x && SKIPPED_LINE.exec(m.m || '');
  if (x || sk) trigHistPoke();
  if ((!x && !sk) || S.view !== 'triggers' || !trigLiveOn()) return;
  if (m.e > 1600000000 && Math.abs(Date.now() / 1000 - m.e) > 5) return;   // replayed after a reconnect
  if (sk) return onTrigSkipped(sk, S.flowGraph);
  const key = `t${x[1]}`, why = x[2], now = Date.now(), g = S.flowGraph;
  const recent = S.flowRecent || (S.flowRecent = new Map());
  const ft = /from trigger (\d+)/.exec(why), tl = /^timeline (\d+) (cue|end)/.exec(why);
  let from = ft ? `t${ft[1]}` : tl ? `tl${tl[1]}` : null;
  if (!from && g) {
    let best = 0;
    for (const l of g.links.values()) if (l.b === key && !l.weak && (recent.get(l.a) || 0) > Math.max(best, now - 3000)) { best = recent.get(l.a); from = l.a; }
  }
  recent.set(key, now);
  // A trigger with a "sleep" keeps running; light it until the status says it is done.
  const trig = P().triggers.find((t) => t.id === +x[1] && t.type !== 'comment');
  if (trig?.actions?.some((a) => /^\s*(sleep|wait|repeat\s.*\btimes)\b/i.test(a))) (S.trigStarted || (S.trigStarted = new Map())).set(+x[1], now);
  updateTrigRunning();
  // The arrow it came by (through any ifs on the way); with no trigger before it, the box
  // its event comes from (panel button, device…).
  flowFlash(flowFk(key));
  // Through its conditions' diamond (all true): light it and its "yes" arrow too.
  const gate = `c${x[1]}`;
  if (g?.nodes.has(gate)) { flowFlash(flowFk(gate)); for (const e of g.edges) if (e.a === gate && e.b === key) flowFlash(flowEk(e)); }
  if (from) { flowChain(g, `${from}>${key}`); flowFlash(flowFk(from), true); }
  else for (const e of g?.edges || []) if ((e.b === key || e.b === gate) && e.a.startsWith('s:')) { flowFlash(flowEk(e)); flowFlash(flowFk(e.a)); }
  if (trig && g) flowPlay(trig, key, g);
  // The row in the list, with where it came from ("38 →", "TL 2 →") before its number while it is lit.
  const i = P().triggers.findIndex((t) => t.id === +x[1] && t.type !== 'comment');
  const row = i >= 0 && $(`.trig-list [data-sel="trigger:${i}"]`);
  if (!row) return;
  firedFromMark(row, from);
  flowFlash(row, false, 1000);
}
// While a trigger waits in a "sleep" it is still running: the status (about every second)
// lists the rest of its actions as a scheduled job with sleep: true and the time left.
// Just after it fired the status may not have it yet, so a fresh start counts too.
function updateTrigRunning() {
  // A run waiting in "wait until" (flowPlay): once the status showed the wait and now doesn't,
  // the rest of its actions run. If it never showed up the condition was already true.
  for (const [id, w] of S.flowWaits || []) {
    if ((S.status?.scheduled || []).some((s) => s.trigger === id && s.wait != null)) w.seen = true;
    else if (w.seen || Date.now() - w.at > 2500) { S.flowWaits.delete(id); w.run(); }
  }
  if (S.view !== 'triggers') return;
  const live = trigLiveOn(), run = new Map(), now = Date.now();
  if (live) {
    for (const s of S.status?.scheduled || []) if (s.sleep) run.set(s.trigger, s);
    for (const [id, at] of S.trigStarted || []) {
      if (now - at > 1500) S.trigStarted.delete(id);
      else if (!run.has(id)) run.set(id, null);
    }
  }
  const p = P();
  const paused = new Map((S.status?.paused || []).map((x) => [x.trigger, x.in]));
  for (const row of $$('.trig-list .item[data-sel]')) {
    const t = p.triggers[+row.dataset.sel.split(':')[1]];
    // Paused by the feedback guard (fired over 100 times in a second).
    const pz = !!t && t.type !== 'comment' && paused.has(t.id);
    let ptag = row.querySelector('.paused-tag');
    if (!pz) ptag?.remove();
    else {
      if (!ptag) {
        row.querySelector('.id').insertAdjacentHTML('afterend', '<span class="paused-tag tag bad" title="Fired over 100 times in a second (a feedback loop?): paused for 10 s"></span>');
        ptag = row.querySelector('.paused-tag');
      }
      ptag.textContent = `paused ${Math.ceil(Math.max(0, paused.get(t.id)) / 1000)} s`;
    }
    const on = !!t && t.type !== 'comment' && run.has(t.id);
    row.classList.toggle('running', on);
    let tag = row.querySelector('.run-left');
    if (!on) { tag?.remove(); continue; }
    if (!tag) {
      row.querySelector('.id').insertAdjacentHTML('afterend', '<span class="run-left" title="Running: waiting in a sleep, time until the next step"></span>');
      tag = row.querySelector('.run-left');
    }
    // A sleep shows the time left; a wait what it waits for (and its timeout); a loop the runs left.
    const job = run.get(t.id), sec = (ms) => `${Math.ceil(Math.max(0, ms) / 1000)} s`;
    tag.textContent = !job ? '⏳' : job.wait != null ? `⏳ wait${job.in >= 0 ? ' ' + sec(job.in) : ''}` : job.loop != null ? `⟳ ${job.loop} left` : `⏳ ${sec(job.in)}`;
    tag.title = !job ? 'Running' : job.wait != null ? `Waiting until ${job.wait}${job.in >= 0 ? ` (gives up in ${sec(job.in)})` : ''}` : job.loop != null ? `Repeating: ${job.loop} run${job.loop === 1 ? '' : 's'} to go` : 'Running: waiting in a sleep, time until the next step';
  }
  for (const n of $$('.fl-node[data-fk^="t"]')) n.classList.toggle('running', run.has(+n.dataset.fk.slice(1)));
}
// Lights an element up, then lets it fade back (the CSS transition runs when "fire" goes).
// soft: true = the box it came from; 'no' = fired but a condition was false (grey/red).
function flowFlash(sel, soft, ms = 700) {
  const el = typeof sel === 'string' ? $(sel) : sel;
  if (!el) return;
  const cls = soft === 'no' ? 'fire-no' : soft ? 'fire-src' : 'fire';
  el.classList.add(cls);
  clearTimeout(el[cls]);
  el[cls] = setTimeout(() => el.classList.remove(cls), ms);
}

function deleteTriggers(idxs) {
  const p = P();
  const doomed = idxs.map((i) => p.triggers[i]).filter(Boolean);
  if (!doomed.length) return;
  const users = p.triggers.filter((u) => !doomed.includes(u) && (u.actions || []).some((a) => doomed.some((d) => d.type !== 'comment' && refersTo(a, d))));
  const what = doomed.length === 1 ? `'${doomed[0].name || 'separator'}'` : `${doomed.length} triggers`;
  const cueRef = (c, d) => d.type !== 'comment' && (/^\d+$/.test(String(c.trigger)) ? +c.trigger === d.id : String(c.trigger).toLowerCase() === (d.name || '').toLowerCase());
  const tls = p.timelines.filter((tl) => tl.cues.some((c) => c.trigger != null && doomed.some((d) => cueRef(c, d))));
  const warn = (users.length ? `\n\nStill used by: ${users.map((u) => `#${u.id} ${u.name}`).join(', ')} (those lines will turn red).` : '') +
    (tls.length ? `\n\nTrigger cues on timeline${tls.length > 1 ? 's' : ''} ${tls.map((tl) => `${tl.id} '${tl.name}'`).join(', ')} will point to nothing.` : '');
  if (!confirm(`Delete ${what}?${warn}`)) return;
  // A colour tab's header goes: the tab keeps its name (as a typed tab name) unless another
  // main section of that colour takes over as header.
  const heads = doomed.filter((d) => d.type === 'comment' && trigColorHead(d.color) === d).map((d) => [d.color, sepTitle(d.name)]);
  p.triggers = p.triggers.filter((t) => !doomed.includes(t));
  for (const [c, name] of heads) if (name && !trigColorHead(c)) setTrigColorName(c, name);
  renumberTriggers(p);
  selectTriggers([Math.min(Math.min(...idxs), p.triggers.length - 1)]);
  markDirty();
  render();
}
// Typing a number moves the trigger to that place in the list (number = position).
function moveTriggerTo(t, n) {
  const p = P();
  const real = p.triggers.filter((x) => x.type !== 'comment');
  n = Math.max(1, Math.min(real.length, Math.round(n) || 1));
  if (t.id === n) return render();
  const target = real[n - 1];
  const down = n > t.id;
  p.triggers.splice(p.triggers.indexOf(t), 1);
  p.triggers.splice(p.triggers.indexOf(target) + (down ? 1 : 0), 0, t);
  renumberTriggers(p);
  selectTriggers([p.triggers.indexOf(t)]);
  markDirty();
  render();
}
const trigKeysActive = () => S.view === 'triggers' && !editingText(document.activeElement) && !$('.builder');
// Trigger list keys: Ctrl+D/A/C/X/V, Delete, ↑/↓ (Shift extends the selection).
views.triggers.keys = (e) => {
  if ($('.builder')) return;   // the command builder dialog is open
  const p = P(), mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (S.flowBig) {   // the big flow view covers the list: only Esc (back to it)
    if (e.key === 'Escape') { S.flowBig = false; render(); }
    return;
  }
  if (mod && k === 'h') {
    e.preventDefault();
    S.trigTool = 'replace';
    render();
    $('#frFind')?.focus();
    $('#frFind')?.select();
  } else if (mod && k === 'f') {
    e.preventDefault();
    $('#trigFilter')?.focus();
    $('#trigFilter')?.select();
  } else if (mod && k === 'd') {
    e.preventDefault();
    const idx = selectedTrigIdx();
    if (idx.length) insertTriggers(idx.map((i) => p.triggers[i]), Math.max(...idx) + 1, 'Duplicated');
  } else if (mod && k === 'a') {
    e.preventDefault();
    // Only what the list shows, so a search + Ctrl+A + Del can't delete hidden triggers.
    const vis = trigVisibleIdx();
    selectTriggers(vis, vis.includes(S.sel.trigger) ? S.sel.trigger : vis[0]);
    S.revealSel = false;
    trigSelectUi();
  } else if (mod && (k === 'c' || k === 'x')) {
    // Keep an internal copy too; the copy/cut event below also puts it on the system clipboard.
    S.trigClip = JSON.parse(JSON.stringify(selectedTrigIdx().map((i) => p.triggers[i])));
    if (!S.trigClip.length) return;
    toast(`${k === 'x' ? 'Cut' : 'Copied'} ${S.trigClip.length} trigger${S.trigClip.length > 1 ? 's' : ''}`);
    if (k === 'x') setTimeout(() => deleteTriggers(selectedTrigIdx()), 0);  // after the cut event read the selection
  } else if (mod && k === 'v') {
    // Prefer the system clipboard (paste event); fall back to the internal copy if none arrives.
    pastePending = true;
    setTimeout(() => {
      if (!pastePending || !S.trigClip?.length) return;
      pastePending = false;
      const idx = selectedTrigIdx();
      insertTriggers(S.trigClip, idx.length ? Math.max(...idx) + 1 : P().triggers.length, 'Pasted');
    }, 80);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteTriggers(selectedTrigIdx());
  } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.altKey && !mod) {
    e.preventDefault();
    moveTriggers(e.key === 'ArrowUp' ? -1 : 1);
  } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !mod) {
    e.preventDefault();
    // Step through the triggers the list shows (a search or colour filter hides the rest).
    // While searching, skip the separators (they are only headings then).
    const vis = trigVisibleIdx().filter((j) => !(S.trigFilter && p.triggers[j].type === 'comment')), at = vis.indexOf(S.sel.trigger);
    if (!vis.length) return;
    const i = vis[at < 0 ? 0 : Math.max(0, Math.min(vis.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (e.shiftKey) { S.trigSel.add(p.triggers[i]); S.sel.trigger = i; S.revealSel = true; }
    else selectTriggers([i]);
    trigSelectUi();
  }
};
// System clipboard as well (so triggers can be pasted into another tab/project).
let pastePending = false;
const putOnClipboard = (e) => {
  if (!trigKeysActive() || !S.trigClip?.length) return;
  e.clipboardData.setData('text/plain', JSON.stringify({ kdTriggers: S.trigClip }, null, 1));
  e.preventDefault();
};
document.addEventListener('copy', putOnClipboard);
document.addEventListener('cut', putOnClipboard);
document.addEventListener('paste', (e) => {
  if (!trigKeysActive()) return;
  let data;
  try { data = JSON.parse(e.clipboardData.getData('text/plain')); } catch { return; }  // not ours: the fallback pastes
  if (!Array.isArray(data?.kdTriggers)) return;
  e.preventDefault();
  pastePending = false;
  const idx = selectedTrigIdx();
  const list = data.kdTriggers.map((t) => Object.assign({ actions: [], conditions: [] }, t));
  insertTriggers(list, idx.length ? Math.max(...idx) + 1 : P().triggers.length, 'Pasted');
});
