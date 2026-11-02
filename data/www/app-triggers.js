'use strict';
// KD Designer web UI - Triggers page and the trigger list (selection, drag, clipboard, numbers, problems, links).
// Plain scripts sharing one global scope; load order is in index.html.

views.triggers = () => {
  const p = P();
  const ti = S.sel.trigger, t = p.triggers[ti];
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
          <label></label><span class="muted">Max 6 different ports in total. On the default port, messages starting with <code>cmd:</code> are executed directly.</span>`;
        break;
      case 'osc':
        params = `<label>OSC address</label><input data-p="${base}.address" value="${esc(t.address || '')}" placeholder="/show/start   or   /cue/*  (* and ? wildcards)">
          <label>Listen port</label><input type="number" min="1" max="65535" data-p="${base}.port" data-t="num" value="${t.port ?? ''}" placeholder="${p.settings.udpPort} (default)">
          <label>From IP</label><input data-p="${base}.fromIp" value="${esc(t.fromIp || '')}" placeholder="any sender">`;
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
        const evs = [['click', 'click'], ['press', 'press'], ['release', 'release'], ['hold', 'hold (long press)'], ['double', 'double click']];
        params = `<label>Control</label><select data-p="${base}.control"><option value="">— choose —</option>${btns.map((b) => `<option${t.control === b ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>
          <label>Event</label><select data-p="${base}.event" data-r>${evs.map(([e, n]) => `<option value="${e}"${ev === e ? ' selected' : ''}>${n}</option>`).join('')}</select>
          ${holdDoubleFields(t, base, ev)}
          <label></label><span class="muted">${!btns.length ? 'Add buttons on the Panel page first.' : ev === 'hold' ? 'Fires once the button is held down this long; letting go earlier does nothing.'
            : ev === 'double' ? 'Fires on the second click. A click trigger on the same button still fires on every click.' : 'Click = released over the button (after any confirm dialog). Press/release fire immediately.'}</span>`;
        break;
      }
      case 'sequence': {
        // Steps are other triggers by name (number when there is no unique name).
        const others = p.triggers.filter((x) => x !== t && x.type !== 'comment' && x.type !== 'sequence');
        const refOf = (x) => (x.name && !dupName(x) ? x.name : String(x.id));
        const steps = t.steps || [];
        params = `<label>Steps</label><div>${steps.map((s, i) => {
          const hit = findTrigs(String(s))[0];
          return `<div class="row nowrap" style="margin-bottom:4px"><span class="muted" style="width:18px">${i + 1}.</span>
            <select data-p="${base}.steps.${i}" data-r style="flex:1"><option value="">— choose a trigger —</option>${others.map((x) => `<option value="${esc(refOf(x))}"${hit === x ? ' selected' : ''}>#${x.id} ${esc(x.name)} (${esc(x.type)})</option>`).join('')}
              ${s && !hit ? `<option selected value="${esc(s)}">${esc(s)} (missing)</option>` : ''}</select>
            <button class="btn small ghost" data-seq-del="${i}" title="Remove this step">✕</button></div>`;
        }).join('')}<button class="btn small" data-seq-add>+ Step</button></div>
          <label>Within</label><div class="row nowrap"><input type="number" min="0.1" step="0.5" data-p="${base}.within" data-t="num" value="${t.within ?? 5}" style="width:90px"><span class="muted">s from the first step to the last</span></div>
          <label></label><span class="muted">Fires when these triggers fire in this order. A step out of order, or taking too long, starts again from the first. The steps are normal triggers (panel buttons, inputs, UDP…); they don't need actions of their own.</span>`;
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
  const f = S.trigFilter || '';
  // Colour filter: show only triggers with one of the picked colours ('' = no colour).
  const cf = S.trigColors || (S.trigColors = new Set());
  // Every colour of the palette (unused ones dimmed), plus custom colours that are in use.
  const colKey = (x) => (trigColor(x.color) ? x.color : '');
  const colCount = {};
  for (const x of p.triggers) colCount[colKey(x)] = (colCount[colKey(x)] || 0) + 1;
  const usedCols = [...Object.keys(TRIGGER_COLORS), ...Object.keys(colCount).filter((c) => !(c in TRIGGER_COLORS))];
  for (const c of cf) if (!usedCols.includes(c)) cf.delete(c);
  const filtering = f || cf.size;
  const multi = p.triggers.some((x) => S.trigSel.has(x));
  const isSel = (x, i) => (multi ? S.trigSel.has(x) : i === ti);
  const selT = t && t.type !== 'comment' ? t : null;
  const links = selT ? triggerLinks(selT) : null;
  const listItem = (x, i) => {
    const col = trigColor(x.color);
    const hidden = (f && !(`${x.id} ${x.name} ${x.type} ${x.notes || ''}`.toLowerCase().includes(f.toLowerCase()))) ||
      (cf.size && !cf.has(col ? x.color : ''));
    if (hidden) return '';
    // Drag to reorder (disabled while filtering, where the order is ambiguous).
    const drag = filtering ? '' : ` data-drag="${i}"`;
    const sel = isSel(x, i) ? ' sel' : '';
    const note = x.notes?.trim() ? `<span class="note-mark" title="${esc(x.notes.trim())}">✎</span>` : '';
    if (x.type === 'comment')
      return `<div class="item sep${sel}" data-sel="trigger:${i}"${drag} style="${col ? `--tc:${col};color:${col}` : ''}"><span style="flex:1">${esc(x.name || '—')}</span>${note}</div>`;
    // Connections of the selected trigger: → it sets this one off, ← this one sets it off.
    const lo = links?.out.find((l) => l.t === x), li = links?.in.find((l) => l.t === x);
    const linkCls = lo || li ? ` linked${lo ? ' link-out' : ''}${li ? ' link-in' : ''}` : '';
    const linkTag = (lo ? `<span class="link-mark out" title="${esc(selT.name)} → ${esc(lo.why)}">→</span>` : '') +
      (li ? `<span class="link-mark in" title="${esc(li.why)} → ${esc(selT.name)}">←</span>` : '');
    const probs = triggerProblems(x);
    const bang = probs.length ? `<span class="trig-err" title="${esc(probs.join('\n'))}">!</span>` : '';
    return `<div class="item${sel}${x.enabled === false ? ' disabled' : ''}${col ? ' tinted' : ''}${linkCls}${probs.length ? ' has-err' : ''}" data-sel="trigger:${i}"${drag} style="${col ? `--tc:${col}` : ''}">
      <span class="id">${x.id}</span>${bang}<span style="flex:1">${esc(x.name)}</span>${note}${linkTag}${dupName(x) ? '<span class="tag mon-warn" title="Another trigger has the same name: fire trigger &lt;name&gt; can’t tell them apart">same name</span>' : ''}${x.conditions?.length ? `<span class="tag tt tt-if" title="${esc(x.conditions.join('\n'))}">if</span>` : ''}<span class="tag tt tt-${esc(x.type)}">${esc(x.type)}</span></div>`;
  };
  const custom = t && t.color && !TRIGGER_COLORS[t.color] ? t.color : '';
  const vars = t && TRIGGER_VARS[t.type];
  return `<h2 class="trig-head">Triggers <label class="muted flow-toggle" title="Triggers in the list (and the flow diagram) light up when they fire on the controller, one after the other as they really run"><input type="checkbox" id="trigLive"${trigLiveOn() ? ' checked' : ''}> light up when fired</label>
    <label class="muted flow-toggle" title="A diagram of which triggers and timelines set off which triggers"><input type="checkbox" id="trigFlow"${trigFlowOn() ? ' checked' : ''}> show flow</label>
    <label class="muted flow-toggle" title="When each trigger fired, on a time line (the controller keeps the last 512 fires)"><input type="checkbox" id="trigHist"${trigHistOn() ? ' checked' : ''}> show history</label>
    <span class="spacer"></span><button class="btn small${S.trigTool === 'templates' ? ' on' : ''}" data-trigtool="templates" title="Ready-made triggers to add">Templates…</button>
    <button class="btn small${S.trigTool === 'replace' ? ' on' : ''}" data-trigtool="replace" title="Find and replace in actions, conditions, names and notes (Ctrl+H)">Find &amp; replace…</button></h2>
    ${trigToolHtml()}${trigHistOn() ? trigHistHtml() : ''}${trigFlowOn() ? trigFlowHtml(selT) : ''}<div class="split">
    <div><input id="trigFilter" placeholder="Filter triggers…" value="${esc(f)}" style="width:100%;margin-bottom:6px">
    ${`<div class="row col-filter${cf.size ? ' some' : ''}" title="Show only triggers with these colours (click several; click again to turn off)">
      ${usedCols.map((c) => `<button class="swatch${cf.has(c) ? ' on' : ''}${colCount[c] ? '' : ' unused'}" data-colfilter="${esc(c)}" title="${esc(c || 'no colour')} (${colCount[c] || 0} trigger${colCount[c] === 1 ? '' : 's'})" style="${c ? `background:${trigColor(c)}` : ''}">${c ? '' : '∅'}</button>`).join('')}
      ${cf.size ? '<button class="btn small ghost" data-colfilter-clear>all colours</button>' : ''}</div>`}
    <div class="list trig-list">${p.triggers.map(listItem).join('')}</div>
    <div class="row" style="margin-top:8px"><button class="btn small" data-add="trigger">+ Trigger</button><button class="btn small" data-add="separator">+ Separator</button><button class="btn small" data-trigtool="templates">+ From template</button>
      ${t ? `<button class="btn small ghost" data-move="-1" title="Move up">▲</button><button class="btn small ghost" data-move="1" title="Move down">▼</button>` : ''}</div>
    <p class="muted keys">Ctrl/Shift+click to select several · Ctrl+C / X / V copy, cut & paste · Ctrl+D duplicate · Del delete · ↑↓ select · Ctrl+A all</p></div>
    <div>${t ? `
      <div class="row nowrap">${t.type === 'comment' ? '' : `<label class="muted" title="The trigger's number = its place in the list. Type a number to move it there.">#</label>
        <input type="number" id="trigNum" min="1" value="${t.id}" style="width:70px;font-size:16px" title="Type a number to move this trigger there">`}
        <input data-p="${base}.name" value="${esc(t.name)}" style="font-size:16px;flex:1" placeholder="${t.type === 'comment' ? '== SECTION NAME' : ''}" class="${dupName(t) ? 'invalid' : ''}" data-r>
        ${t.type === 'comment' ? '' : `<button class="btn" data-fire="${t.id}" title="Run the saved version of this trigger on the controller">Fire now</button>`}
        <button class="btn small ghost" data-del="${base}">Delete</button></div>
      <textarea class="trig-notes" data-p="${base}.notes" rows="${Math.min(10, Math.max(2, (t.notes || '').split('\n').length))}" placeholder="${t.type === 'comment' ? 'Notes about this section…' : 'Notes: what this trigger is for, who triggers it, what to watch out for…'}">${esc(t.notes || '')}</textarea>
      <div id="trigProbs">${trigProbsHtml(t)}</div>
      ${dupName(t) ? `<p class="bad" style="margin:6px 0 0">Another trigger (#${p.triggers.filter((x) => x !== t && x.type !== 'comment' && x.name.toLowerCase() === t.name.toLowerCase()).map((x) => x.id).join(', #')}) has this name, so <code>fire trigger "${esc(t.name)}"</code> can’t tell them apart. Rename one of them.</p>` : ''}
      ${multi && S.trigSel.size > 1 ? `<p class="muted" style="margin:6px 0 0">${S.trigSel.size} triggers selected - Ctrl+C, Ctrl+D or Del work on all of them.</p>` : ''}
      ${links ? `<div class="links">
        <div class="row"><span class="muted link-head">Set off by</span>${links.tls.map((l) => `<a href="#" class="chip-link in tl" data-goto-timeline="${l.tl.id}" title="Trigger cue on timeline ${l.tl.id} '${esc(l.tl.name)}' at ${(l.c.t / 1000).toFixed(1)} s">◆ Timeline ${l.tl.id} ${esc(l.tl.name)} <small>cue at ${(l.c.t / 1000).toFixed(1)} s</small></a>`).join('')}${links.in.map((l) => `<a href="#" class="chip-link in" data-goto-trigger="${l.t.id}" title="${esc(l.t.name)}: ${esc(l.why)}">← #${l.t.id} ${esc(l.t.name)} <small>${esc(l.why)}</small></a>`).join('')}${links.in.length || links.tls.length ? '' : '<span class="muted">nothing - only its own event</span>'}</div>
        <div class="row"><span class="muted link-head">Sets off</span>${links.out.length ? links.out.map((l) => `<a href="#" class="chip-link out" data-goto-trigger="${l.t.id}" title="${esc(l.why)}">→ #${l.t.id} ${esc(l.t.name)} <small>${esc(l.why)}</small></a>`).join('') : '<span class="muted">no other triggers</span>'}</div>
      </div>` : ''}
      <div class="form" style="margin-top:12px">
        ${t.type === 'comment' ? '' : `<label>Enabled</label><input type="checkbox" data-p="${base}.enabled" data-t="bool"${t.enabled !== false ? ' checked' : ''} data-r>`}
        <label>Type</label><select data-p="${base}.type" data-r>${TRIGGER_TYPES.map(([v, n]) => `<option value="${v}"${t.type === v ? ' selected' : ''}>${n}</option>`).join('')}</select>
        <label>Colour</label><div class="row swatches">${Object.entries(TRIGGER_COLORS).map(([k, c]) => `<label class="swatch${(t.color || '') === k ? ' on' : ''}" title="${k || 'none'}" style="${k ? `background:${c}` : ''}"><input type="radio" name="tcol" data-p="${base}.color" value="${k}"${(t.color || '') === k ? ' checked' : ''} data-r>${k ? '' : '∅'}</label>`).join('')}
          <label class="swatch custom${custom ? ' on' : ''}" title="Custom colour" style="${custom ? `background:${custom}` : ''}">${custom ? '' : '+'}<input type="color" data-p="${base}.color" value="${custom || '#4aa3ff'}" data-r></label></div>
        ${params}
        ${t.type === 'comment' ? '' : behaviourFields(t, base)}
      </div>
      ${t.type === 'comment' ? '<p class="muted">Separators only organise the list, like the Pharos separator module.</p>' : `
      <h3>Conditions</h3>
      <p class="muted" style="margin:0 0 8px">All must be true when the trigger fires, otherwise it is skipped (shown in the log at debug level).</p>
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
    : '<span class="muted">Select or create a trigger.</span>'}</div></div>`;
};
views.triggers.after = () => {
  // Keep the list's own scroll position across re-renders; bring a newly
  // added/selected trigger into view.
  const list = $('.trig-list');
  list.scrollTop = S.trigScroll || 0;
  list.addEventListener('scroll', () => (S.trigScroll = list.scrollTop));
  if (S.revealSel) {
    S.revealSel = false;
    $('.trig-list .item.sel')?.scrollIntoView({ block: 'nearest' });
    S.trigScroll = list.scrollTop;
  }
  initTriggerDrag(list);
  $('#trigFlow').addEventListener('change', (e) => { setTrigFlow(e.target.checked); render(); });
  $('#trigLive').addEventListener('change', (e) => { setTrigLive(e.target.checked); render(); });
  $('#trigHist').addEventListener('change', (e) => { setTrigHist(e.target.checked); render(); });
  trigToolAfter();
  updateTrigRunning();
  const flow = $('.trig-flow');
  if (flow) {
    flow.scrollLeft = S.flowScroll?.[0] || 0;
    flow.scrollTop = S.flowScroll?.[1] || 0;
    flow.addEventListener('scroll', () => (S.flowScroll = [flow.scrollLeft, flow.scrollTop]));
    // The box can be resized (bottom edge); remember the height in this browser.
    new ResizeObserver(() => { try { localStorage.setItem('kd.trigFlowH', String(flow.offsetHeight)); } catch { /* private mode */ } }).observe(flow);
  }
  if ($('#trigActs')) initActionDrag($('#trigActs'), P().triggers[S.sel.trigger]);
  $('#trigFilter').addEventListener('input', (e) => {
    S.trigFilter = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const inp = $('#trigFilter');
    inp.focus();
    inp.setSelectionRange(pos, pos);
  });
  // Any edit in the trigger editor may fix or cause a problem.
  $('#main .split > div:last-child')?.addEventListener('change', () => setTimeout(refreshTrigProblems));
  $$('[data-colfilter]').forEach((b) => b.addEventListener('click', () => {
    const c = b.dataset.colfilter;
    if (S.trigColors.has(c)) S.trigColors.delete(c); else S.trigColors.add(c);
    render();
  }));
  $('[data-colfilter-clear]')?.addEventListener('click', () => { S.trigColors.clear(); render(); });
  // Name: update the list while typing; references follow when the field is left (change).
  const nameIn = $(`[data-p="triggers.${S.sel.trigger}.name"]`);
  if (nameIn) {
    const t = P().triggers[S.sel.trigger];
    nameIn.dataset.orig = t.name;
    nameIn.addEventListener('input', () => {
      t.name = nameIn.value;
      const item = $(`.trig-list [data-sel="trigger:${S.sel.trigger}"]`);
      if (item) item.children[t.type === 'comment' ? 0 : 1].textContent = t.name || (t.type === 'comment' ? '—' : '');
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
        item.children[t.type === 'comment' ? 0 : 1].after(mark);
      } else if (mark && !t.notes.trim()) mark.remove();
      if (mark?.isConnected) mark.title = t.notes.trim();
      markDirty();
    });
  }
  $('[data-seq-add]')?.addEventListener('click', () => {
    const t = P().triggers[S.sel.trigger];
    (t.steps = t.steps || []).push('');
    markDirty();
    render();
  });
  $$('[data-seq-del]').forEach((b) => b.addEventListener('click', () => {
    P().triggers[S.sel.trigger].steps.splice(+b.dataset.seqDel, 1);
    markDirty();
    render();
  }));
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
};

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
      <span class="muted">${waits ? 'when it fires again before its last line has run' : 'only matters with a sleep, wait or repeat … every in the actions'}</span></div>`;
}

// Drag-and-drop reordering of the trigger list (pointer events: mouse, touch, pen).
function initTriggerDrag(list) {
  const clear = () => $$('.drop-before,.drop-after', list).forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  list.addEventListener('pointerdown', (e) => {
    const src = e.target.closest('[data-drag]');
    if (!src || e.button !== 0) return;
    const from = +src.dataset.drag, x0 = e.clientX, y0 = e.clientY;
    let ghost = null, target = null, after = false, timer = null, lastY = y0;
    const autoScroll = () => {
      const r = list.getBoundingClientRect();
      if (lastY < r.top + 40) list.scrollTop -= 12;
      else if (lastY > r.bottom - 40) list.scrollTop += 12;
      pick(lastY);
    };
    const pick = (y) => {
      clear();
      target = null;
      for (const it of $$('[data-drag]', list)) {
        const r = it.getBoundingClientRect();
        if (y >= r.top && y < r.bottom) {
          target = it;
          after = y > r.top + r.height / 2;
          it.classList.add(after ? 'drop-after' : 'drop-before');
          break;
        }
      }
    };
    const move = (ev) => {
      lastY = ev.clientY;
      if (!ghost) {
        if (Math.abs(ev.clientY - y0) < 5 && Math.abs(ev.clientX - x0) < 5) return;  // still a click
        ghost = src.cloneNode(true);
        ghost.classList.add('drag-ghost');
        ghost.style.width = src.getBoundingClientRect().width + 'px';
        document.body.appendChild(ghost);
        src.classList.add('dragging');
        document.body.classList.add('dragging-item');
        timer = setInterval(autoScroll, 30);
      }
      ghost.style.left = ev.clientX + 12 + 'px';
      ghost.style.top = ev.clientY - 12 + 'px';
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
      if (!target) { src.classList.remove('dragging'); clear(); return; }
      let to = +target.dataset.drag + (after ? 1 : 0);
      if (to > from) to--;
      if (to !== from) {
        const arr = P().triggers;
        const [moved] = arr.splice(from, 1);
        arr.splice(to, 0, moved);
        renumberTriggers();
        selectTriggers([to]);
        S.revealSel = false;
        markDirty();
      }
      S.sel.trigger = to;
      render();
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
        ghost.style.width = src.getBoundingClientRect().width + 'px';
        document.body.appendChild(ghost);
        src.classList.add('dragging');
        document.body.classList.add('dragging-item');
      }
      ghost.style.left = ev.clientX + 12 + 'px';
      ghost.style.top = ev.clientY - 12 + 'px';
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
function renumberTriggers(p = P()) {
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
  for (const t of p.triggers)
    if (t.type === 'sequence') t.steps = (t.steps || []).map((s) => (/^\d+$/.test(String(s)) && map.has(+s) ? String(map.get(+s)) : s));
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
  render();
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
  // A step of a sequence may be there only to be a step.
  if (!(t.actions || []).some((a) => a.trim() && !a.trim().startsWith('#')) && !sequencesOf(t).length) out.push('No actions: it does nothing');
  if (t.cooldown != null && !(t.cooldown >= 0)) out.push('The cooldown must be 0 or more seconds');
  if (dupName(t)) out.push(`Another trigger is also called '${t.name}': fire trigger by name can't tell them apart`);
  switch (t.type) {
    case 'udp': if (!t.match) out.push('No message to react to'); break;
    case 'osc': if (!t.address) out.push('No OSC address to react to'); break;
    case 'panel':
      if (!t.control) out.push('No panel control chosen');
      else if (!has(panelButtons(), t.control)) out.push(`Panel control '${t.control}' doesn't exist`);
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
    case 'sequence': {
      const steps = (t.steps || []).filter((s) => String(s).trim());
      if (steps.length < 2) out.push('A sequence needs at least 2 steps');
      for (const s of steps) {
        const hits = findTrigs(String(s));
        if (!hits.length) out.push(`Step '${s}' is not a trigger`);
        else if (hits.length > 1) out.push(`${hits.length} triggers are named '${s}'`);
        else if (hits[0] === t) out.push('A sequence can’t be its own step');
        else if (hits[0].enabled === false) out.push(`Step '${s}' is disabled, so it never fires`);
      }
      if (!(t.within > 0) && t.within != null) out.push('No time set for the steps');
      break;
    }
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
// Sequence triggers that have t as one of their steps.
const sequencesOf = (t) => P().triggers.filter((s) => s.type === 'sequence' && s !== t && (s.steps || []).some((r) => String(r).trim() && findTrigs(String(r))[0] === t));

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
// What a trigger's actions do that can set off other triggers.
function triggerEffects(t) {
  const fx = [];
  for (const line of t.actions || [])
    for (const cmd of commandParts(line)) {
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
      } else if (l[0] === 'var' && ['=', '+', '-', 'toggle'].includes(l[2])) {
        fx.push({ kind: 'var', name: w[1] });
      } else if (l[0] === 'start' && l[1] === 'timeline') {
        const tl = findRef(P().timelines, w[2] || '');
        if (tl) fx.push({ kind: 'timeline', id: tl.id, name: tl.name });
      } else if (l[0] === 'http' && w[2]) {
        fx.push({ kind: 'http', url: w[2] });
      }
    }
  return fx;
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
// {out: triggers t sets off, in: triggers that set t off}, each {t, why}.
function triggerLinks(t) {
  const out = [], inc = [], mine = triggerEffects(t);
  const stepOf = (step, seq) => { const k = (seq.steps || []).findIndex((r) => String(r).trim() && findTrigs(String(r))[0] === step); return k >= 0 ? `step ${k + 1} of the sequence` : null; };
  for (const x of P().triggers) {
    if (x === t || x.type === 'comment') continue;
    const o = setsOff(mine, x) || (x.type === 'sequence' && stepOf(t, x));
    if (o) out.push({ t: x, why: o });
    const i = setsOff(triggerEffects(x), t) || (t.type === 'sequence' && stepOf(x, t));
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
// Nodes 't<id>' (triggers) and 'tl<id>' (timelines) that have at least one link, in list
// order; edges {a, b, why: [...], weak} where weak = only cancels/stops a pending fire.
// "start timeline" goes to the timeline, which in turn sets off its cue and end triggers.
function trigFlowGraph() {
  const p = P(), edges = new Map();
  const add = (a, b, why) => {
    if (a === b) return;
    const k = `${a}>${b}`;
    if (!edges.has(k)) edges.set(k, { a, b, why: [], weak: true });
    const e = edges.get(k);
    if (!e.why.includes(why)) e.why.push(why);
    if (!/^(cancel|stop)/.test(why)) e.weak = false;
  };
  const trigs = p.triggers.filter((t) => t.type !== 'comment');
  for (const t of trigs)
    for (const f of triggerEffects(t)) {
      if (f.kind === 'fire') add(`t${t.id}`, `t${f.t.id}`, f.why);
      else if (f.kind === 'timeline') add(`t${t.id}`, `tl${f.id}`, 'start timeline');
      else for (const d of trigs) { const w = d !== t && setsOff([f], d); if (w) add(`t${t.id}`, `t${d.id}`, w); }
    }
  for (const s of trigs)
    if (s.type === 'sequence') (s.steps || []).forEach((r, k) => { const h = String(r).trim() && findTrigs(String(r)); if (h?.length === 1) add(`t${h[0].id}`, `t${s.id}`, `step ${k + 1} of the sequence`); });
  for (const tl of p.timelines) {
    for (const c of tl.cues) {
      if (c.trigger == null) continue;
      const h = findTrigs(String(c.trigger));
      if (h.length === 1) add(`tl${tl.id}`, `t${h[0].id}`, `cue at ${(c.t / 1000).toFixed(1)} s`);
    }
    for (const d of trigs) if (d.type === 'timeline_end' && d.timeline === tl.id) add(`tl${tl.id}`, `t${d.id}`, 'timeline ends');
  }
  const used = new Set([...edges.values()].flatMap((e) => [e.a, e.b]));
  const nodes = new Map();
  for (const t of trigs) if (used.has(`t${t.id}`)) nodes.set(`t${t.id}`, { t });
  for (const tl of p.timelines) if (used.has(`tl${tl.id}`)) nodes.set(`tl${tl.id}`, { tl });
  return { nodes, edges: [...edges.values()], hidden: trigs.length - [...nodes.values()].filter((n) => n.t).length };
}
const FLOW_W = 190, FLOW_H = 30, FLOW_GX = 70, FLOW_GY = 10, FLOW_PAD = 12;
// Columns from left to right: event sources first, then what they set off. Loops are
// found depth-first and don't push nodes further right (drawn dashed, going back).
function trigFlowLayout(g) {
  const keys = [...g.nodes.keys()];
  const outs = new Map(keys.map((k) => [k, []])), ins = new Map(keys.map((k) => [k, []]));
  for (const e of g.edges) { outs.get(e.a).push(e.b); ins.get(e.b).push(e.a); }
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
  const col = new Map(keys.map((k) => [k, 0]));
  for (const k of post.reverse())
    for (const b of outs.get(k)) if (!back.has(`${k}>${b}`)) col.set(b, Math.max(col.get(b), col.get(k) + 1));
  // Rows: list order, then two passes that move each node towards the nodes that set it off.
  const cols = [];
  keys.forEach((k) => (cols[col.get(k)] = cols[col.get(k)] || []).push(k));
  const row = new Map();
  cols.forEach((c) => c.forEach((k, i) => row.set(k, i)));
  for (let pass = 0; pass < 2; pass++)
    for (let c = 1; c < cols.length; c++) {
      const bary = (k) => {
        const pr = ins.get(k).filter((a) => col.get(a) < c);
        return pr.length ? pr.reduce((s, a) => s + row.get(a), 0) / pr.length : row.get(k);
      };
      const b = new Map(cols[c].map((k) => [k, bary(k)]));
      cols[c].sort((x, y) => b.get(x) - b.get(y));
      cols[c].forEach((k, i) => row.set(k, i));
    }
  const pos = new Map(keys.map((k) => [k, { x: FLOW_PAD + col.get(k) * (FLOW_W + FLOW_GX), y: FLOW_PAD + row.get(k) * (FLOW_H + FLOW_GY) }]));
  return { pos, back, w: FLOW_PAD * 2 + cols.length * (FLOW_W + FLOW_GX) - FLOW_GX, h: FLOW_PAD * 2 + Math.max(...cols.map((c) => c.length)) * (FLOW_H + FLOW_GY) - FLOW_GY };
}
function trigFlowHtml(selT) {
  const g = trigFlowGraph();
  S.flowGraph = g;   // for the live part (onTrigLog)
  let h = 0;
  try { h = +localStorage.getItem('kd.trigFlowH') || 0; } catch { /* private mode */ }
  const box = (inner) => `<div class="trig-flow" style="height:${h || 260}px">${inner}</div>`;
  if (!g.nodes.size) return box('<p class="muted" style="margin:12px">No trigger or timeline sets off another trigger yet (fire trigger, a mode or variable change, a trigger cue on a timeline, a timeline end…).</p>');
  const L = trigFlowLayout(g), p = P();
  const selKey = selT ? `t${selT.id}` : '';
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const edgeSvg = (e) => {
    const a = L.pos.get(e.a), b = L.pos.get(e.b);
    const sx = a.x + FLOW_W, sy = a.y + FLOW_H / 2, tx = b.x - 2, ty = b.y + FLOW_H / 2;
    const dx = tx > sx ? Math.max(30, (tx - sx) / 2) : 90;
    const sel = e.a === selKey || e.b === selKey;
    const cls = `fl-edge${e.weak ? ' weak' : ''}${L.back.has(`${e.a}>${e.b}`) || tx <= sx ? ' back' : ''}${sel ? ' sel' : ''}`;
    const label = sel ? `<text class="fl-why" x="${(sx + tx) / 2}" y="${(sy + ty) / 2 - 4}" text-anchor="middle">${esc(cut(e.why.join(', '), 34))}</text>` : '';
    const d = `M${sx} ${sy} C${sx + dx} ${sy} ${tx - dx} ${ty} ${tx} ${ty}`;
    return `<g class="${cls}" data-ek="${e.a}>${e.b}"><title>${esc(e.why.join('\n'))}</title><path d="${d}"/><path class="hit" d="${d}"/>${label}</g>`;
  };
  const nodeSvg = ([k, n]) => {
    const { x, y } = L.pos.get(k);
    if (n.tl) {
      return `<g class="fl-node tl" data-fk="${k}" data-goto-timeline="${n.tl.id}"><title>Timeline ${n.tl.id} '${esc(n.tl.name)}' - click to open</title>
        <rect x="${x}" y="${y}" width="${FLOW_W}" height="${FLOW_H}" rx="${FLOW_H / 2}"/><text x="${x + 12}" y="${y + 19}">◆ ${n.tl.id} ${esc(cut(n.tl.name || '', 22))}</text></g>`;
    }
    const t = n.t, col = trigColor(t.color), i = p.triggers.indexOf(t);
    return `<g class="fl-node${k === selKey ? ' sel' : ''}${t.enabled === false ? ' disabled' : ''}" data-fk="${k}" data-sel="trigger:${i}"><title>#${t.id} ${esc(t.name)} (${esc(t.type)})${t.enabled === false ? ' - disabled' : ''}</title>
      <rect x="${x}" y="${y}" width="${FLOW_W}" height="${FLOW_H}" rx="4"/>${col ? `<rect class="fl-col" x="${x}" y="${y}" width="4" height="${FLOW_H}" style="fill:${col}"/>` : ''}
      <text x="${x + 10}" y="${y + 19}"><tspan class="fl-id">${t.id}</tspan> ${esc(cut(t.name || '', 19))}</text><text class="fl-type" x="${x + FLOW_W - 6}" y="${y + 19}" text-anchor="end">${esc(t.type)}</text></g>`;
  };
  return box(`<svg width="${L.w}" height="${L.h}" viewBox="0 0 ${L.w} ${L.h}">
    <defs><marker id="flArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z"/></marker>
      <marker id="flArrowHot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z"/></marker></defs>
    ${g.edges.map(edgeSvg).join('')}${[...g.nodes].map(nodeSvg).join('')}</svg>`) +
    `<p class="muted flow-help">Arrows: what sets off what (select a trigger to see why). Boxes light up when they fire on the controller. Dashed: cancels/stops, or goes back.${g.hidden ? ` ${g.hidden} trigger${g.hidden === 1 ? '' : 's'} without links not shown.` : ''}</p>`;
}
// Live: the controller logs "Trigger 5 'Name' fired (<reason>[ from trigger 3])" (Triggers.cpp,
// runTrigger). Light up that box and the arrow it came by. Without a "from" (a mode or variable
// change is handled later in the main loop), the arrow is the one from the trigger that fired last.
const FIRED_LINE = /^Trigger (\d+) '.*' fired \((.*)\)$/;
function onTrigLog(m) {
  const x = m.c === 'TRIG' && FIRED_LINE.exec(m.m || '');
  if (x) trigHistPoke();
  if (!x || S.view !== 'triggers' || !trigLiveOn()) return;
  if (m.e > 1600000000 && Math.abs(Date.now() / 1000 - m.e) > 5) return;   // replayed after a reconnect
  const key = `t${x[1]}`, why = x[2], now = Date.now(), g = S.flowGraph;
  const recent = S.flowRecent || (S.flowRecent = new Map());
  const ft = /from trigger (\d+)/.exec(why), tl = /^timeline (\d+) (cue|end)/.exec(why);
  let from = ft ? `t${ft[1]}` : tl ? `tl${tl[1]}` : null;
  if (!from && g) {
    let best = 0;
    for (const e of g.edges) if (e.b === key && !e.weak && (recent.get(e.a) || 0) > Math.max(best, now - 3000)) { best = recent.get(e.a); from = e.a; }
  }
  recent.set(key, now);
  // A trigger with a "sleep" keeps running; light it until the status says it is done.
  const trig = P().triggers.find((t) => t.id === +x[1] && t.type !== 'comment');
  if (trig?.actions?.some((a) => /^\s*(sleep|wait|repeat\s.*\btimes)\b/i.test(a))) (S.trigStarted || (S.trigStarted = new Map())).set(+x[1], now);
  updateTrigRunning();
  flowFlash(`[data-fk="${key}"]`);
  if (from) { flowFlash(`[data-ek="${from}>${key}"]`); flowFlash(`[data-fk="${from}"]`, true); }
  // Timelines it (probably) starts: an "if" may skip it, but the log doesn't say.
  for (const e of g?.edges || []) if (e.a === key && e.b.startsWith('tl')) { flowFlash(`[data-ek="${e.a}>${e.b}"]`); flowFlash(`[data-fk="${e.b}"]`); recent.set(e.b, now); }
  // The row in the list, with where it came from ("← 38", "← TL 2") while it is lit.
  const i = P().triggers.findIndex((t) => t.id === +x[1] && t.type !== 'comment');
  const row = i >= 0 && $(`.trig-list [data-sel="trigger:${i}"]`);
  if (!row) return;
  row.querySelector('.fired-from')?.remove();
  const src = from ? (from.startsWith('tl') ? `TL ${from.slice(2)}` : from.slice(1)) : '';
  if (src) row.querySelector('.id').insertAdjacentHTML('afterend', `<span class="fired-from" title="Fired by ${src.startsWith('TL') ? 'timeline' : 'trigger'} ${src.replace('TL ', '')}">← ${src}</span>`);
  flowFlash(row, false, 1000);
  clearTimeout(row.firedFrom);
  row.firedFrom = setTimeout(() => row.querySelector('.fired-from')?.remove(), 2200);
}
// While a trigger waits in a "sleep" it is still running: the status (about every second)
// lists the rest of its actions as a scheduled job with sleep: true and the time left.
// Just after it fired the status may not have it yet, so a fresh start counts too.
function updateTrigRunning() {
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
function flowFlash(sel, soft, ms = 700) {
  const el = typeof sel === 'string' ? $(sel) : sel;
  if (!el) return;
  const cls = soft ? 'fire-src' : 'fire';
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
  p.triggers = p.triggers.filter((t) => !doomed.includes(t));
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
  if (mod && k === 'h') {
    e.preventDefault();
    S.trigTool = 'replace';
    render();
    $('#frFind')?.focus();
    $('#frFind')?.select();
  } else if (mod && k === 'd') {
    e.preventDefault();
    const idx = selectedTrigIdx();
    if (idx.length) insertTriggers(idx.map((i) => p.triggers[i]), Math.max(...idx) + 1, 'Duplicated');
  } else if (mod && k === 'a') {
    e.preventDefault();
    selectTriggers(p.triggers.map((_, i) => i), S.sel.trigger);
    S.revealSel = false;
    render();
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
  } else if (e.key === 'Delete') {
    e.preventDefault();
    deleteTriggers(selectedTrigIdx());
  } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !mod) {
    e.preventDefault();
    const i = Math.max(0, Math.min(p.triggers.length - 1, S.sel.trigger + (e.key === 'ArrowDown' ? 1 : -1)));
    if (e.shiftKey) { S.trigSel.add(p.triggers[i]); S.sel.trigger = i; S.revealSel = true; render(); }
    else { selectTriggers([i]); render(); }
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
