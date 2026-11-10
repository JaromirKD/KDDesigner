'use strict';
// KD Designer web UI - Triggers page tools: templates, find & replace, and the fire history strip.
// Plain scripts sharing one global scope; load order is in index.html.

// ---- Panels above the list: S.trigTool = 'templates' | 'replace' | null ----------------
function trigToolHtml() {
  if (S.trigTool === 'templates') return tplHtml();
  if (S.trigTool === 'replace') return frHtml();
  return '';
}
function trigToolAfter() {
  $$('[data-trigtool]').forEach((b) => b.addEventListener('click', () => {
    S.trigTool = S.trigTool === b.dataset.trigtool ? null : b.dataset.trigtool;
    render();
    if (S.trigTool === 'replace') $('#frFind')?.focus();
  }));
  if (S.trigTool === 'templates') tplAfter();
  if (S.trigTool === 'replace') frAfter();
  if (trigHistOn()) trigHistAfter();
}

// ---- Templates -----------------------------------------------------------------------
// The project's own timelines, scenes, buttons… so a template works (or nearly) straight away.
function tplCtx() {
  const p = P();
  const ref = (x, d) => (x ? quote(x.name || String(x.id)) : d);
  const grp = p.modes.find((g) => g.states.length >= 2);
  return {
    tl: (k = 0) => ref(p.timelines[k], String(k + 1)),
    sc: (k = 0) => ref(p.scenes[k], String(k + 1)),
    btn: (k = 0) => panelButtons()[k] || `Button ${k + 1}`,
    pj: ref(p.projectors[0], '"PJ 1"'),
    uni: p.universes[0]?.id ?? 1,
    email: p.email?.to || 'tech@example.com',
    // A mode change, or a log line when the project has no mode groups.
    mode: (k) => (grp ? `mode ${quote(grp.name)} ${quote(grp.states[Math.min(k, grp.states.length - 1)])}` : `log mode ${k + 1}`),
    input: (n) => (p.machineControl ? { io: `in${n}` } : { pin: 2 + n }),
  };
}
const TRIGGER_TEMPLATES = [
  { cat: 'Visitors', name: 'Button with cooldown', desc: 'A panel button starts the show. Pressed again within 30 s, or while the show still runs, it is ignored.',
    make: (h) => ({ triggers: [{ type: 'panel', name: 'Visitor button', control: h.btn(0), event: 'click', cooldown: 30, whileRunning: 'ignore', color: 'green',
      actions: [`start timeline ${h.tl(0)}`, `wait until timeline ${h.tl(0)} stopped timeout 900`] }] }) },
  { cat: 'Visitors', name: 'One request at a time', desc: 'Every press plays the show once. A press during the show is kept and plays once more right after it.',
    make: (h) => ({ triggers: [{ type: 'panel', name: 'Play on request', control: h.btn(0), event: 'click', whileRunning: 'queue', color: 'green',
      actions: [`start timeline ${h.tl(0)}`, `wait until timeline ${h.tl(0)} stopped timeout 900`, 'sleep 2'] }] }) },
  { cat: 'Visitors', name: 'Idle loop and show', desc: 'The idle loop runs from startup. A button plays the show; when the show ends the idle loop comes back.',
    make: (h) => ({ triggers: [
      { type: 'startup', name: 'Start idle loop', color: 'teal', actions: ['sleep 2', `start timeline ${h.tl(1)}`] },
      { type: 'panel', name: 'Play show', control: h.btn(0), event: 'click', whileRunning: 'ignore', color: 'green',
        actions: [`stop timeline ${h.tl(1)} fade 2`, `start timeline ${h.tl(0)}`, `wait until timeline ${h.tl(0)} stopped timeout 1800`, `start timeline ${h.tl(1)}`] }] }) },
  { cat: 'Visitors', name: 'Visitor counter', desc: 'A door sensor counts visitors into a variable (kept across reboots), reset every night, with a message at 100.',
    make: (h) => ({ variables: [{ name: 'visitors', type: 'number', initial: 0, persist: true }], triggers: [
      { type: 'input', name: 'Count visitor', ...h.input(0), edge: 'rising', cooldown: 1, color: 'blue', actions: ['var visitors + 1'] },
      { type: 'time', name: 'Reset visitor count', at: '00:00:00', color: 'blue', actions: ['var visitors = 0'] },
      { type: 'variable', name: '100 visitors', variable: 'visitors', value: '100', color: 'blue', actions: ['log 100 visitors today'] }] }) },

  { cat: 'Opening hours', name: 'Open and close by the clock', desc: 'Starts the day at 09:30 and ends it at 17:30, Monday to Saturday.',
    make: (h) => ({ triggers: [
      { type: 'time', name: 'Museum opens', at: '09:30:00', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], color: 'amber', actions: [h.mode(1), `start timeline ${h.tl(0)}`] },
      { type: 'time', name: 'Museum closes', at: '17:30:00', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], color: 'amber', actions: [h.mode(0), 'release all fade 10'] }] }) },
  { cat: 'Opening hours', name: 'Outside lights at sunset', desc: 'Fades a scene in 15 minutes before sunset and out at 23:00 (set the location on the Schedule page).',
    make: (h) => ({ triggers: [
      { type: 'time', name: 'Lights on at sunset', at: 'sunset', offset: -15, color: 'orange', actions: [`scene ${h.sc(0)} fade 60`] },
      { type: 'time', name: 'Lights off at night', at: '23:00:00', color: 'orange', actions: [`release scene ${h.sc(0)} fade 60`] }] }) },
  { cat: 'Opening hours', name: 'Weekend programme', desc: 'Another timeline on Saturday and Sunday, only during the day.',
    make: (h) => ({ triggers: [{ type: 'time', name: 'Weekend show', at: '10:00:00', days: ['sat', 'sun'], conditions: ['time between 09:00 18:00'], color: 'amber', actions: [`start timeline ${h.tl(1)}`] }] }) },
  { cat: 'Opening hours', name: 'Holiday starts and ends', desc: 'When the calendar period "Closed" starts (just after midnight) everything fades out and a line goes in the log; when it ends, the idle loop starts again. Add the period on the Schedule page.',
    make: (h) => ({ triggers: [
      { type: 'calendar', name: 'Holiday starts', calendar: P().calendar[0]?.name || 'Closed', state: 'active', color: 'amber', actions: ['release all fade 10', 'log Holiday: {calendar} {state}'] },
      { type: 'calendar', name: 'Holiday ends', calendar: P().calendar[0]?.name || 'Closed', state: 'inactive', color: 'amber', actions: [`start timeline ${h.tl(1)}`] }] }) },

  { cat: 'Technician', name: 'Projectors on, then the input', desc: 'Switches the projectors on, waits until one answers, gives the lamps time and then picks HDMI 1.',
    make: (h) => ({ triggers: [{ type: 'manual', name: 'Projectors on', color: 'purple',
      actions: ['projector all on', `wait until device ${h.pj} is online timeout 180`, 'sleep 30', 'projector all input 31'] }] }) },
  { cat: 'Technician', name: 'Everything on in the morning', desc: 'Wakes the PCs and projectors, then starts the show once they had time to boot.',
    make: (h) => ({ triggers: [{ type: 'time', name: 'Morning start', at: '08:30:00', color: 'purple', actions: ['pc all wake', 'projector all on', 'sleep 90', `start timeline ${h.tl(0)}`] }] }) },
  { cat: 'Technician', name: 'Everything off at night', desc: 'Fades the lights out, then switches the projectors off and shuts the PCs down.',
    make: () => ({ triggers: [{ type: 'time', name: 'Night shutdown', at: '23:30:00', color: 'purple', actions: ['release all fade 10', 'sleep 10', 'projector all off', 'pc all shutdown'] }] }) },
  { cat: 'Technician', name: 'Device offline alarm', desc: 'Emails when any monitored device goes offline - at most once every 15 minutes.',
    make: (h) => ({ triggers: [{ type: 'device', name: 'Device offline alarm', device: '', state: 'offline', cooldown: 900, color: 'red',
      actions: [`email ${h.email} "{device} is offline" Please check {device} ({kind}).`, 'log ALARM {device} offline'] }] }) },
  { cat: 'Technician', name: 'Lamp hours warning', desc: 'Emails once when a projector lamp passes 3000 hours.',
    make: (h) => ({ triggers: [{ type: 'projector', name: 'Lamp hours warning', projector: '', alarm: 'lamp_hours', hours: 3000, color: 'red',
      actions: [`email ${h.email} "{projector}: lamp at {lamp} h" Time to order a lamp.`] }] }) },
  { cat: 'Technician', name: 'Restart the show (long press)', desc: 'Hold a panel button for 3 s to restart a hanging show. A short press does nothing.',
    make: (h) => ({ triggers: [{ type: 'panel', name: 'Restart show', control: h.btn(1), event: 'hold', hold: 3, color: 'red',
      actions: [`stop timeline ${h.tl(0)}`, 'sleep 1', `start timeline ${h.tl(0)}`] }] }) },
  { cat: 'Technician', name: 'All off (long press)', desc: 'Hold a panel button for 3 s to fade everything out.',
    make: (h) => ({ triggers: [{ type: 'panel', name: 'All off', control: h.btn(2), event: 'hold', hold: 3, color: 'red', actions: ['release all fade 3'] }] }) },
  { cat: 'Technician', name: 'Double click: blackout on/off', desc: 'A double click on a panel button switches blackout on and off, kept in an on/off variable.',
    make: (h) => ({ variables: [{ name: 'blackout_on', type: 'bool', initial: false, persist: false }], triggers: [
      { type: 'panel', name: 'Blackout double click', control: h.btn(0), event: 'double', within: 0.5, color: 'grey', actions: ['var blackout_on toggle'] },
      { type: 'variable', name: 'Blackout follows variable', variable: 'blackout_on', value: '', color: 'grey', actions: ['if var blackout_on = on then blackout on else blackout off'] }] }) },

  { cat: 'Effects', name: 'Channels on one by one', desc: 'Sets 8 DMX channels to full, one every 0.3 s, holds and clears them.',
    make: (h) => ({ triggers: [{ type: 'manual', name: 'Channels one by one', color: 'magenta', actions: [`repeat 8 times every 0.3 set ${h.uni}.{i} 255`, 'sleep 3', 'clear overrides'] }] }) },
  { cat: 'Effects', name: 'Blink 5 times', desc: 'One trigger flashes a channel; another repeats it 5 times.',
    make: (h) => ({ triggers: [
      { type: 'manual', name: 'Flash once', color: 'magenta', actions: [`set ${h.uni}.1 255`, 'sleep 0.3', `set ${h.uni}.1 0`] },
      { type: 'manual', name: 'Blink 5 times', color: 'magenta', actions: ['repeat "Flash once" 5 times every 0.8'] }] }) },
  { cat: 'Effects', name: 'Relays one after the other', desc: 'Machine Control: outputs out0-out7 on, one every 0.5 s, then all off after 5 s.',
    make: () => ({ triggers: [{ type: 'manual', name: 'Relay chase', color: 'magenta', actions: ['repeat 8 times every 0.5 io out{=i-1} on', 'sleep 5', 'io all off'] }] }) },
  { cat: 'Effects', name: 'Step through scenes', desc: 'Every minute the next of 3 scenes (counted in a variable).',
    make: (h) => ({ variables: [{ name: 'step', type: 'number', initial: 0, persist: false }], triggers: [{ type: 'interval', name: 'Next scene', seconds: 60, color: 'magenta',
      actions: ['var step + 1', 'if var step > 3 then var step = 1', 'scene {step} fade 5'] }] }) },

  { cat: 'External control', name: 'OSC remote: go / stop', desc: 'An OSC app (TouchOSC, QLab…) sends /show/go and /show/stop.',
    make: (h) => ({ triggers: [
      { type: 'osc', name: 'OSC go', address: '/show/go', color: 'cyan', actions: [`start timeline ${h.tl(0)}`] },
      { type: 'osc', name: 'OSC stop', address: '/show/stop', color: 'cyan', actions: [`stop timeline ${h.tl(0)} fade 2`] }] }) },
  { cat: 'External control', name: 'UDP from a show PC', desc: 'PLAY and STOP as UDP text; the controller answers OK.',
    make: (h) => ({ triggers: [
      { type: 'udp', name: 'UDP PLAY', match: 'PLAY', color: 'cyan', actions: [`start timeline ${h.tl(0)}`, 'reply OK'] },
      { type: 'udp', name: 'UDP STOP', match: 'STOP', color: 'cyan', actions: [`stop timeline ${h.tl(0)} fade 2`, 'reply OK'] }] }) },
  { cat: 'External control', name: 'Lighting desk fader starts the show', desc: 'Art-Net universe 0, channel 1: up past half starts the show, down below half stops it.',
    make: (h) => ({ triggers: [
      { type: 'dmx_in', name: 'Desk fader up', protocol: 'artnet', universe: 0, channels: '1', when: 'above', level: 128, color: 'cyan', actions: [`start timeline ${h.tl(0)}`] },
      { type: 'dmx_in', name: 'Desk fader down', protocol: 'artnet', universe: 0, channels: '1', when: 'below', level: 128, color: 'cyan', actions: [`stop timeline ${h.tl(0)} fade 3`] }] }) },
  { cat: 'External control', name: 'Desk channels drive a master', desc: 'A desk channel sets a timeline master: 0-255 becomes 0-100 %.',
    make: (h) => ({ triggers: [{ type: 'dmx_in', name: 'Desk master', protocol: 'artnet', universe: 0, channels: '2', when: 'change', color: 'cyan',
      conditions: [`timeline ${h.tl(0)} running`], actions: [`master timeline ${h.tl(0)} {=round(value*100/255)}`] }] }) },
];
// A template's triggers, as they would be added (for the preview and for adding).
const tplMake = (tpl) => tpl.make(tplCtx());
function tplHtml() {
  const q = (S.tplFilter || '').toLowerCase();
  const list = TRIGGER_TEMPLATES.map((tpl, i) => ({ tpl, i })).filter(({ tpl }) => !q || `${tpl.cat} ${tpl.name} ${tpl.desc}`.toLowerCase().includes(q));
  const cats = [...new Set(list.map((x) => x.tpl.cat))];
  const card = ({ tpl, i }) => {
    const m = tplMake(tpl);
    return `<div class="tpl-card"><div class="row nowrap"><b style="flex:1">${esc(tpl.name)}</b><button class="btn small primary" data-tpl="${i}">Add</button></div>
      <div class="muted">${esc(tpl.desc)}</div>
      ${m.triggers.map((t) => `<div class="tpl-trig"><span class="tag tt tt-${esc(t.type)}">${esc(t.type)}</span> ${esc(t.name)}${t.cooldown ? ` <small class="muted">cooldown ${t.cooldown} s</small>` : ''}${t.whileRunning ? ` <small class="muted">${esc(t.whileRunning)}</small>` : ''}
        ${(t.actions || []).map((a) => `<code>${esc(a)}</code>`).join('')}</div>`).join('')}
      ${m.variables?.length ? `<div class="muted">+ variable ${m.variables.map((v) => `<code>${esc(v.name)}</code>`).join(' ')}</div>` : ''}</div>`;
  };
  return `<div class="trig-tool"><div class="row nowrap"><b>Templates</b><input id="tplFilter" placeholder="Search templates…" value="${esc(S.tplFilter || '')}" style="flex:0 1 260px;min-width:160px">
    <span class="muted">They use your first timelines, scenes and panel buttons; check the red ! after adding.</span><span class="spacer"></span><button class="btn small ghost" data-trigtool="templates">Close</button></div>
    ${cats.map((c) => `<h4>${esc(c)}</h4><div class="tpl-grid">${list.filter((x) => x.tpl.cat === c).map(card).join('')}</div>`).join('') || '<p class="muted">No template matches.</p>'}</div>`;
}
function tplAfter() {
  const f = $('#tplFilter');
  f?.addEventListener('input', () => {
    S.tplFilter = f.value;
    const pos = f.selectionStart;
    render();
    $('#tplFilter').focus();
    $('#tplFilter').setSelectionRange(pos, pos);
  });
  $$('[data-tpl]').forEach((b) => b.addEventListener('click', () => addTemplate(TRIGGER_TEMPLATES[+b.dataset.tpl])));
}
// "fire trigger <old>" etc. -> the new name, in one line (template triggers renamed to stay unique).
function renameRefsInLine(line, names) {
  const toks = tokenize(line);
  let out = line;
  for (let i = toks.length - 2; i >= 0; i--) {
    const r = trigRefAt(toks, i), to = r && names.get(r.v.toLowerCase());
    if (to) out = out.slice(0, r.start) + quote(to) + out.slice(r.end);
  }
  return out;
}
function addTemplate(tpl) {
  const p = P(), m = tplMake(tpl);
  const idx = selectedTrigIdx();
  const at = idx.length ? Math.max(...idx) + 1 : p.triggers.length;
  let id = nextId(p.triggers) + 1000;
  const copies = m.triggers.map((t) => ({ enabled: true, conditions: [], actions: [], notes: `From the template "${tpl.name}": ${tpl.desc}`, ...JSON.parse(JSON.stringify(t)), id: id++ }));
  p.triggers.splice(at, 0, ...copies);
  // Unique names; references between the new triggers follow a rename.
  const renamed = new Map();
  for (const c of copies) {
    const n = uniqueTrigName(c.name, c);
    if (n !== c.name) renamed.set(c.name.toLowerCase(), n);
    c.name = n;
  }
  if (renamed.size) for (const c of copies) c.actions = c.actions.map((a) => renameRefsInLine(a, renamed));
  const newVars = (m.variables || []).filter((v) => !p.variables.some((x) => x.name.toLowerCase() === v.name.toLowerCase()));
  p.variables.push(...newVars);
  renumberTriggers(p);
  selectTriggers(copies.map((c) => p.triggers.indexOf(c)), p.triggers.indexOf(copies[copies.length - 1]));
  markDirty();
  render();
  toast(`Added ${copies.length} trigger${copies.length > 1 ? 's' : ''}${newVars.length ? ` and variable ${newVars.map((v) => v.name).join(', ')}` : ''} from "${tpl.name}"`);
}

// ---- Find & replace ------------------------------------------------------------------
// In the actions, conditions, names and notes of all (or only the selected) triggers.
S.trigFind = S.trigFind || { find: '', repl: '', cs: false, word: false, actions: true, conditions: true, names: false, notes: false, selOnly: false };
function frRegex() {
  const f = S.trigFind;
  if (!f.find) return null;
  const e = f.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Whole words: no letter, digit or _ right before or after.
  return new RegExp(f.word ? `(?<![\\w])${e}(?![\\w])` : e, f.cs ? 'g' : 'gi');
}
// Every field with a match: {t, field, label, get, set}.
function frHits() {
  const f = S.trigFind, re = frRegex();
  if (!re) return [];
  const p = P(), out = [];
  const sel = f.selOnly && S.trigSel.size ? (t) => S.trigSel.has(t) : () => true;
  for (const t of p.triggers) {
    if (!sel(t)) continue;
    const add = (label, get, set) => { re.lastIndex = 0; if (re.test(get() || '')) out.push({ t, label, get, set }); };
    if (f.names) add('name', () => t.name, (v) => (t.name = v));
    if (f.notes) add('notes', () => t.notes, (v) => (t.notes = v));
    if (f.actions) (t.actions || []).forEach((_, i) => add(`action ${i + 1}`, () => t.actions[i], (v) => (t.actions[i] = v)));
    if (f.conditions) (t.conditions || []).forEach((_, i) => add(`condition ${i + 1}`, () => t.conditions[i], (v) => (t.conditions[i] = v)));
  }
  return out;
}
const frReplace = (s) => s.replace(frRegex(), () => S.trigFind.repl);
function frHitsHtml() {
  const hits = frHits(), re = frRegex(), p = P();
  if (!re) return '<p class="muted">Type what to look for.</p>';
  if (!hits.length) return '<p class="muted">Not found.</p>';
  const mark = (s) => {
    let out = '', last = 0;
    for (const m of s.matchAll(re)) { out += esc(s.slice(last, m.index)) + `<mark>${esc(m[0])}</mark>`; last = m.index + m[0].length; }
    return out + esc(s.slice(last));
  };
  const trigs = new Set(hits.map((h) => h.t)).size;
  return `<p class="muted" style="margin:4px 0">${hits.length} place${hits.length > 1 ? 's' : ''} in ${trigs} trigger${trigs > 1 ? 's' : ''}${hits.length > 200 ? ' (first 200 shown)' : ''}</p>` +
    hits.slice(0, 200).map((h) => {
      const before = h.get() || '', after = frReplace(before), bad = /^(action|condition)/.test(h.label) && after.trim() && !validate(after, h.label.startsWith('condition') ? COND_GRAMMAR : GRAMMAR).ok;
      return `<div class="fr-hit" data-sel="trigger:${p.triggers.indexOf(h.t)}" title="Click to open this trigger"><span class="id">${h.t.id}</span> <b>${esc(h.t.name || '—')}</b> <small class="muted">${h.label}</small>
        <div class="mono">${mark(before)}</div>${S.trigFind.repl !== '' || before !== after ? `<div class="mono fr-after${bad ? ' bad' : ''}" title="${bad ? 'After replacing, this line is not valid' : 'After replacing'}">→ ${esc(after)}</div>` : ''}</div>`;
    }).join('');
}
function frHtml() {
  const f = S.trigFind;
  const box = (k, label) => `<label class="muted"><input type="checkbox" data-fr="${k}"${f[k] ? ' checked' : ''}> ${label}</label>`;
  return `<div class="trig-tool"><div class="row"><b>Find &amp; replace</b>
      <input id="frFind" placeholder="Find…" value="${esc(f.find)}" style="width:220px" spellcheck="false">
      <input id="frRepl" placeholder="Replace with…" value="${esc(f.repl)}" style="width:220px" spellcheck="false">
      <button class="btn small primary" id="frGo">Replace all</button><span class="spacer"></span><button class="btn small ghost" data-trigtool="replace">Close</button></div>
    <div class="row">${box('cs', 'match case')}${box('word', 'whole words')}<span class="muted">· in</span>${box('actions', 'actions')}${box('conditions', 'conditions')}${box('names', 'names')}${box('notes', 'notes')}
      ${box('selOnly', `only the selected triggers${S.trigSel.size ? ` (${S.trigSel.size})` : ''}`)}</div>
    <div id="frHits" class="fr-hits">${frHitsHtml()}</div></div>`;
}
function frAfter() {
  const f = S.trigFind, upd = () => { $('#frHits').innerHTML = frHitsHtml(); };
  $('#frFind').addEventListener('input', (e) => { f.find = e.target.value; upd(); });
  $('#frRepl').addEventListener('input', (e) => { f.repl = e.target.value; upd(); });
  $$('[data-fr]').forEach((el) => el.addEventListener('change', () => { f[el.dataset.fr] = el.checked; upd(); }));
  for (const id of ['#frFind', '#frRepl']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') frReplaceAll(); if (e.key === 'Escape') { S.trigTool = null; render(); } });
  $('#frGo').addEventListener('click', frReplaceAll);
}
function frReplaceAll() {
  const hits = frHits();
  if (!hits.length) return toast('Nothing to replace');
  const trigs = new Set(hits.map((h) => h.t));
  // Renamed triggers: references by the old name follow, like a rename in the editor.
  const names = new Map([...trigs].map((t) => [t, t.name]));
  for (const h of hits) h.set(frReplace(h.get() || ''));
  let refs = 0;
  for (const [t, old] of names) if (t.name !== old && !dupName(t)) refs += renameTriggerRefs(old, t.name);
  markDirty();
  render();
  toast(`Replaced in ${hits.length} place${hits.length > 1 ? 's' : ''} (${trigs.size} trigger${trigs.size > 1 ? 's' : ''})${refs ? `, ${refs} reference${refs > 1 ? 's' : ''} to renamed triggers updated` : ''} - Ctrl+Z undoes`);
}

// ---- History: when each trigger fired (like a logic analyser) -----------------------
// The controller keeps the last 512 fires (Triggers::historyJson, /api/trighistory); this
// browser fetches them when shown, after each "fired" log line and every 10 s.
function trigHistOn() {
  try { return localStorage.getItem('kd.trigHist') === '1'; } catch { return false; }
}
function setTrigHist(on) {
  try { on ? localStorage.setItem('kd.trigHist', '1') : localStorage.removeItem('kd.trigHist'); } catch { /* private mode */ }
}
const HIST_RANGES = [[120, '2 min'], [600, '10 min'], [3600, '1 hour'], [0, 'all kept']];
function trigHistHtml() {
  const r = S.histRange ?? 600;
  return `<div class="trig-hist"><div class="row nowrap"><b>History</b>
      <select id="histRange">${HIST_RANGES.map(([s, n]) => `<option value="${s}"${r === s ? ' selected' : ''}>last ${n}</option>`).join('')}</select>
      <span class="muted" id="histInfo"></span></div><div id="histBody" class="hist-body"></div></div>`;
}
async function fetchTrigHist() {
  try {
    const d = await api('/api/trighistory');
    S.trigHistData = { ...d, at: Date.now() };
    S.trigHistErr = '';
  } catch (e) {
    // Offline: keep what we have. An older controller or mock doesn't have the history at all.
    S.trigHistErr = /unknown endpoint|not found|404/i.test(e.message)
      ? 'The controller (or PC mock) runs older software without the history: update the firmware, or close and restart the mock.'
      : `Can't reach the controller (${e.message}).`;
  }
  drawTrigHist();
}
let histTimer = 0;
// A "fired" log line: fetch again shortly (several fires in a row give one fetch).
function trigHistPoke() {
  if (S.view !== 'triggers' || !trigHistOn()) return;
  clearTimeout(histTimer);
  histTimer = setTimeout(fetchTrigHist, 400);
}
function trigHistAfter() {
  $('#histRange').addEventListener('change', (e) => { S.histRange = +e.target.value; drawTrigHist(); });
  let n = 0;
  pagePoll('trigHist', () => { if (n++ % 10 === 0) fetchTrigHist(); else drawTrigHist(); }, 1000);
}
const HIST_SRC = { 65535: 'by hand (Fire now, console)', 65534: 'repeat', 65533: 'fire … after', 65532: 'queued while running' };
function histSource(src) {
  if (!src) return 'its own event';
  if (HIST_SRC[src]) return HIST_SRC[src];
  if (src & 0x8000) return `timeline ${src & 0x7fff}`;
  const t = P().triggers.find((x) => x.id === src && x.type !== 'comment');
  return `trigger ${src}${t ? ` '${t.name}'` : ''}`;
}
function drawTrigHist() {
  const body = $('#histBody'), d = S.trigHistData;
  if (!body) return;
  if (!d) { body.innerHTML = `<p class="${S.trigHistErr ? 'bad' : 'muted'}" style="margin:8px">${esc(S.trigHistErr || 'Loading…')}</p>`; return; }
  const p = P(), now = Date.now(), zero = d.at - d.now;   // wall-clock time of the controller's ms 0
  const span = (S.histRange ?? 600) * 1000 || Math.max(60000, now - (zero + (d.h[0]?.[0] ?? d.now)));
  const from = now - span;
  // [ms, id, src, 1] = it fired but a condition was false (nothing ran): an outlined red mark.
  const fires = d.h.map(([ms, id, src, no]) => ({ at: zero + ms, id, src, no: !!no })).filter((f) => f.at >= from);
  const byId = new Map();
  for (const f of fires) (byId.get(f.id) || byId.set(f.id, []).get(f.id)).push(f);
  const rows = p.triggers.filter((t) => t.type !== 'comment' && byId.has(t.id));
  const unknown = [...byId.keys()].filter((id) => !rows.some((t) => t.id === id));
  const nNo = fires.filter((f) => f.no).length;
  $('#histInfo').textContent = `${fires.length - nNo} fire${fires.length - nNo === 1 ? '' : 's'} of ${rows.length} trigger${rows.length === 1 ? '' : 's'}` +
    (nNo ? ` · ${nNo} skipped by a false condition (outlined red)` : '') +
    (d.h.length >= 512 ? ' · the controller keeps the last 512' : '') + ' · hover a mark for the time and source, click a row to open the trigger';
  if (!rows.length && !unknown.length) { body.innerHTML = '<p class="muted" style="margin:8px">Nothing fired in this time.</p>'; return; }
  const LW = 210, RH = 18, W = Math.max(400, body.clientWidth - 2), TW = W - LW - 10, AX = 18;
  const x = (at) => LW + ((at - from) / span) * TW;
  const hhmm = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: span <= 600000 ? '2-digit' : undefined });
  // Axis: about 6 ticks on round steps.
  const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200].map((s) => s * 1000);
  const step = steps.find((s) => span / s <= 7) || steps[steps.length - 1];
  let axis = '';
  for (let tk = Math.ceil(from / step) * step; tk <= now; tk += step)
    axis += `<line class="hist-grid" x1="${x(tk)}" x2="${x(tk)}" y1="${AX}" y2="${AX + rows.length * RH}"/><text class="hist-ax" x="${x(tk)}" y="12" text-anchor="middle">${hhmm(tk)}</text>`;
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const rowSvg = (t, r) => {
    const y = AX + r * RH, list = byId.get(t.id), col = trigColor(t.color) || 'var(--accent)', no = list.filter((f) => f.no).length;
    return `<g class="hist-row" data-sel="trigger:${p.triggers.indexOf(t)}"><rect class="hist-bg" x="0" y="${y}" width="${W}" height="${RH}"/>
      <text class="hist-lbl" x="6" y="${y + 13}"><tspan class="fl-id">${t.id}</tspan> ${esc(cut(t.name || '', 24))}</text><text class="hist-n" x="${LW - 8}" y="${y + 13}" text-anchor="end">${list.length - no}${no ? `<tspan class="hist-no"> +${no}✕</tspan>` : ''}</text>
      ${list.map((f) => f.no
    ? `<rect class="hist-tick no" x="${x(f.at) - 1.5}" y="${y + 4}" width="3" height="${RH - 8}"><title>#${t.id} ${esc(t.name)} · ${new Date(f.at).toLocaleTimeString()} · ${esc(histSource(f.src))} · condition false: not run</title></rect>`
    : `<rect class="hist-tick" x="${x(f.at) - 1.5}" y="${y + 3}" width="3" height="${RH - 6}" style="fill:${col}"><title>#${t.id} ${esc(t.name)} · ${new Date(f.at).toLocaleTimeString()} · ${esc(histSource(f.src))}</title></rect>`).join('')}</g>`;
  };
  const H = AX + rows.length * RH + 4;
  body.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${axis}${rows.map(rowSvg).join('')}
    <line class="hist-now" x1="${x(now)}" x2="${x(now)}" y1="${AX - 4}" y2="${H}"/></svg>` +
    (unknown.length ? `<p class="muted" style="margin:4px 8px">Also fired: #${unknown.join(', #')} (numbers from before the triggers were renumbered or deleted).</p>` : '');
}
