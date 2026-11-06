'use strict';
// KD Designer web UI - show devices (src/Drivers.cpp): a Devices tab per type with its settings,
// readings and controls, and the matching Monitoring tabs.
// Plain scripts sharing one global scope; load order is in index.html.

// Kiss-Box I/O: card frames and the cards that go in their slots (kiss-box.com).
const KISS_FRAMES = [['IO3', 'IO3CC · 3 slots', 3], ['IO8', 'IO8CC · 8 slots', 8]];
const KISS_CARDS = [
  ['', 'empty slot', 0, '-'],
  ['DO4PR', 'DO4PR · 4 power relays (5 A / 130 VAC)', 4, 'out'],
  ['DO8SK', 'DO8SK · 8 outputs, 5-30 VDC sink 0.3 A', 8, 'out'],
  ['DI8DC', 'DI8DC · 8 inputs, 12-48 VDC', 8, 'in'],
  ['AO8DA', 'AO8DA · 8 analog outputs 0-10 V', 8, 'aout'],
  ['AI8RA', 'AI8RA · 8 analog inputs 0-5 V', 8, 'ain'],
];
const kissCard = (code) => KISS_CARDS.find(([c]) => c === (code || '')) || KISS_CARDS[0];
// KNX datapoint types the firmware encodes (knxEncode in Drivers.cpp).
const KNX_DPTS = [
  ['1', 'switch on/off'], ['2', 'switch with priority'], ['3', 'dim / blinds step (up, down, stop)'], ['5.001', 'percent 0-100'],
  ['5.003', 'angle 0-360°'], ['5.010', 'number 0-255'], ['6', 'number -128..127'], ['7', 'number 0-65535'], ['8', 'number ±32767'],
  ['9', 'float: temperature, lux, wind…'], ['12', 'counter 32-bit'], ['13', 'number 32-bit ±'], ['14', 'float 32-bit'],
  ['16', 'text (14 chars)'], ['17', 'scene number 1-64'], ['18', 'scene control 1-64'], ['232', 'RGB colour #rrggbb'],
];
const dptMain = (dpt) => String(dpt || '1').split('.')[0];
// NETIO models: code, name, outputs, inputs, metered (load per output). "x" = socket type (F, S, B, Z…).
// The NETIO reports its model ("4PZ", "101F", "8QS"…); `match` recognises it.
const NETIO_MODELS = [
  ['', 'As reported by the NETIO', 0, 0, true],
  ['101', 'PowerCable REST / MQTT 101x', 1, 0, true, /^101/],
  ['2PZ', 'PowerCable 2PZ', 2, 0, false, /^2PZ/],
  ['2P', 'PowerCable 2Px', 2, 0, false, /^2P/],
  ['2K', 'PowerCable 2Kx', 2, 2, true, /^2K/],
  ['3P', 'PowerBOX 3Px', 3, 0, false, /^3P/],
  ['4KB', 'PowerBOX 4Kx', 4, 0, true, null],
  ['4PZ', 'PowerDIN 4PZ (outputs 1-2 metered)', 4, 2, true, /^4PZ/],
  ['4P', 'PowerPDU 4Px', 4, 0, false, /^4P/],
  ['4K', 'PowerPDU 4Kx', 4, 0, true, /^4K/],
  ['8Q', 'PowerPDU 8Qx (output 1 metered)', 8, 1, true, /^8Q/],
  ['8K', 'PowerPDU 8Kx', 8, 0, true, /^8K/],
  ['FK6', 'PowerPDU FK6', 6, 2, true, /^FK6/],
  ['4C', 'PowerPDU 4C', 4, 0, true, /^4C/],
  ['N4', 'NETIO 4', 4, 0, false, null],
  ['N4A', 'NETIO 4All', 4, 0, true, null],
];
// The model chosen, or the one the NETIO reports (Model info is "4PZ PowerDIN-4PZ").
function netioModel(x, j) {
  const set = NETIO_MODELS.find(([c]) => c && c === x.model);
  if (set) return set;
  const rep = String(j.info?.Model || '').split(' ')[0];
  return NETIO_MODELS.find((m) => m[5] && m[5].test(rep)) || null;
}

// Old projects: "slots":"out,in" and "links":"a=b, c=d" become cards / vars.
function normDriver(d) {
  d.vars = d.vars || {};
  if (d.links) {
    for (const l of String(d.links).split(',')) {
      const [k, v] = l.split('=').map((s) => s.trim());
      if (k && v && !d.vars[k]) d.vars[k] = v;
    }
    delete d.links;
  }
  if (d.type === 'kissbox') {
    if (!d.cards) {
      const map = { out: 'DO4PR', in: 'DI8DC', aout: 'AO8DA', ain: 'AI8RA' };
      d.cards = String(d.slots || 'out').split(',').map((s) => map[s.trim()] || '');
      delete d.slots;
    }
    d.frame = d.frame || (d.cards.length > 3 ? 'IO8' : 'IO3');
    d.names = d.names || {};
  }
  if (d.type === 'knx') d.addresses = d.addresses || [];
  if (d.type === 'brightsign') d.commands = d.commands || [];
}

function drvState(id) {
  const s = S.status?.drivers?.find((x) => x.id === id);
  if (!s) return { dot: '', text: 'not on controller (save first)', last: '' };
  if (!s.seen) return { dot: '', text: 'checking…', last: s.last };
  return { dot: s.online ? 'ok' : 'bad', text: s.online ? 'online' : 'offline', last: s.last };
}
const drvSt = (d) => S.status?.drivers?.find((x) => x.id === d.id && x.type === d.type) || {};
const ptVal = (j, k) => (j.points || []).find((p) => p.k === k)?.v ?? '';
const liveChip = (j) => (j.live ? `<span class="tag ${j.live === 'live' ? 'mon-ok' : 'mon-warn'}" title="${esc(j.liveNote || (j.live === 'live' ? 'Changes are pushed by the device' : 'Waiting for the device to connect'))}">${j.live === 'live' ? '⚡ live' : '⚡ waiting'}</span>` : '');

// ---- tabs ----------------------------------------------------------------------
// Devices / Monitoring tab -> its icon (DEVICE_ICONS).
const TAB_ICON = { network: 'network', tcp: 'tcp', pcs: 'pc', projectors: 'projector', email: 'email', board: 'io' };
const tabIcon = (k) => (TAB_ICON[k] || DRIVERS[k] ? devIcon(TAB_ICON[k] || k) : '');
// Devices and Monitoring share one tab bar (same rows, order and counts); `attr` says which page it switches,
// `usable(k)` greys out the tabs Monitoring has nothing for.
function tabBar(tab, attr, first, usable = () => true) {
  const p = P(), n = (t) => p.drivers.filter((d) => d.type === t).length;
  const btn = (k, label, count) => `<button class="${tab === k ? 'on' : ''}" data-${attr}="${k}"${usable(k) ? '' : ' disabled title="Nothing to monitor"'}>${tabIcon(k)}${label}${count ? ` <small>${count}</small>` : ''}</button>`;
  return `<div class="seg devtabs">${[...first, ...DEVICE_TABS].map(([k, l]) => btn(k, l, DEVICE_TAB_COUNT[k]?.(p))).join('')}</div>
    <div class="seg devtabs">${Object.entries(DRIVERS).map(([k, v]) => btn(k, v.label, n(k))).join('')}</div>`;
}
const deviceTabs = (tab) => tabBar(tab, 'devtab', []);
// Monitoring tabs that have something to show (Email never has).
function monTabList() {
  const p = P();
  return [['all', 'All'], ...(p.devices.length ? [['network', 'Network']] : []), ...(p.tcp.length || p.modbus.length ? [['tcp', 'TCP & Modbus']] : []),
    ...(p.pcs.length ? [['pcs', 'PCs']] : []), ...(p.projectors.length ? [['projectors', 'Projectors']] : []),
    ...(pmcUsed() ? [['board', 'Machine Control']] : []),
    ...Object.keys(DRIVERS).filter((t) => p.drivers.some((d) => d.type === t)).map((t) => [t, DRIVERS[t].label])];
}
function monTabs() {
  const keys = monTabList().map(([k]) => k);
  return tabBar(keys.includes(S.monTab) ? S.monTab : 'all', 'montab', [['all', 'All']], (k) => keys.includes(k));
}

// ---- small building blocks ---------------------------------------------------------
const cmdBtn = (c, label, conf, title) => `<button class="btn small" data-cmd="${esc(c)}"${conf ? ` data-confirm="${esc(conf)}"` : ''}${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
const led = (id, k, v, title) => `<span class="kiss ${v === '1' ? 'on' : ''}" data-live="${id}|${esc(k)}" data-fmt="led" title="${esc(title || '')}">${v === '1' ? 'on' : v === '0' ? 'off' : '?'}</span>`;
const liveText = (id, k, v, fmt) => `<span data-live="${id}|${esc(k)}" data-fmt="${fmt || 'text'}">${esc(v === '' ? '—' : v)}</span>`;
// A slider that sends a command when released ({v} = value).
const cmdRange = (tpl, v, min, max, id, k) => `<input type="range" min="${min}" max="${max}" value="${esc(v || 0)}" data-cmdrange="${esc(tpl)}"${id != null ? ` data-live="${id}|${esc(k)}" data-fmt="range"` : ''} style="width:120px">`;
// A field + Set button that sends a command ({v} = what was typed).
const cmdSet = (tpl, ph, raw) => `<span class="row nowrap" data-cmdset="${esc(tpl)}"${raw ? ' data-raw' : ''}><input placeholder="${esc(ph || 'value')}" style="width:110px"><button class="btn small">Set</button></span>`;
function varSel(i, k, cur, path) {
  const vars = P().variables;
  const attr = path ? `data-p="${path}"` : `data-dvar="${i}|${esc(k)}"`;
  return `<select ${attr} title="Variable that follows this reading (react with a Variable change trigger)" style="width:120px">
    <option value="">—</option>${vars.map((v) => `<option${v.name === cur ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}
    ${cur && !vars.some((v) => v.name === cur) ? `<option selected>${esc(cur)}</option>` : ''}</select>`;
}
const varTag = (cur) => (cur ? `<span class="muted" title="Linked variable">→ ${esc(cur)}</span>` : '');

// ---- per type: readings + controls -------------------------------------------------
// mode: 'edit' (Devices tab: names and variables editable), 'view' (Monitoring tab), 'compact' (Monitoring "All").
function drvPanel(x, j, mode, i) {
  const ref = quote(x.name), id = x.id, edit = mode === 'edit', vars = x.vars || {};
  const vcell = (k) => (edit ? `<td>${varSel(i, k, vars[k])}</td>` : `<td>${varTag(vars[k])}</td>`);
  const pts = j.points || [];
  switch (x.type) {
    case 'kissbox': {
      const slots = KISS_FRAMES.find(([f]) => f === (x.frame || 'IO3'))?.[2] || 3;
      if (mode === 'compact') {
        return Array.from({ length: slots }, (_, s) => {
          const [code, , n, kind] = kissCard(x.cards?.[s]);
          if (!code) return '';
          const cells = Array.from({ length: n }, (_, c) => {
            const k = `${s + 1}.${c + 1}`, v = ptVal(j, k), nm = x.names?.[k] || k;
            if (kind === 'out') return `<button class="btn small kiss ${v === '1' ? 'on' : ''}" data-cmd="kissbox ${esc(ref)} ${k} ${v === '1' ? 'off' : 'on'}" title="${esc(nm)}: ${v === '1' ? 'on - click for off' : 'off - click for on'}">${c + 1}</button>`;
            if (kind === 'in') return `<span class="kiss ${v === '1' ? 'on' : ''}" title="${esc(nm)}: ${v === '1' ? 'closed' : 'open'}">${c + 1}</span>`;
            return `<span class="kiss" title="${esc(nm)}">${esc(v || '–')}</span>`;
          }).join('');
          return `<div class="drv-row"><span class="drv-name">Slot ${s + 1} · ${code}</span><span class="row nowrap" style="gap:3px">${cells}</span><span></span></div>`;
        }).join('');
      }
      return Array.from({ length: slots }, (_, s) => {
        const [code, label, n, kind] = kissCard(x.cards?.[s]);
        const head = edit ? `<select data-p="drivers.${i}.cards.${s}" data-r>${KISS_CARDS.map(([c, l]) => `<option value="${c}"${c === code ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`
          : `<b>${esc(label)}</b>`;
        const rows = Array.from({ length: n }, (_, c) => {
          const k = `${s + 1}.${c + 1}`, v = ptVal(j, k);
          const name = edit ? `<input data-dname="${i}|${k}" value="${esc(x.names?.[k] || '')}" placeholder="${kind === 'in' ? 'e.g. Door contact' : kind === 'out' ? 'e.g. Fog machine' : 'name'}" style="width:160px">`
            : esc(x.names?.[k] || '');
          const state = kind === 'out' || kind === 'in' ? led(id, k, v, kind === 'in' ? 'closed = on' : '') : liveText(id, k, v);
          const ctl = kind === 'out' ? cmdBtn(`kissbox ${ref} ${k} on`, 'On') + cmdBtn(`kissbox ${ref} ${k} off`, 'Off')
            : kind === 'aout' ? cmdRange(`kissbox ${ref} ${k} {v}`, v, 0, 255, id, k) : '';
          return `<tr><td class="mono">${k}</td><td>${name}</td><td>${state}</td>${vcell(k)}<td><div class="row nowrap">${ctl}</div></td></tr>`;
        }).join('');
        return `<div class="drv-slot"><div class="row"><span class="muted" style="min-width:52px">Slot ${s + 1}</span>${head}
            ${code ? cmdBtn(`kissbox ${ref} read ${s + 1}`, '⟳', '', 'Read this slot now') : ''}</div>
          ${n ? `<table class="drv-tbl"><tr><th>Ch</th><th>Name</th><th>State</th><th>Variable</th><th></th></tr>${rows}</table>` : ''}</div>`;
      }).join('');
    }
    case 'knx': {
      const addrs = x.addresses || [];
      const ctl = (a) => {
        const m = dptMain(a.dpt), g = a.ga;
        if (m === '1' || m === '2') return cmdBtn(`knx ${ref} write ${g} on`, 'On') + cmdBtn(`knx ${ref} write ${g} off`, 'Off');
        if (m === '3') return cmdBtn(`knx ${ref} write ${g} up`, '▲') + cmdBtn(`knx ${ref} write ${g} down`, '▼') + cmdBtn(`knx ${ref} write ${g} stop`, '■');
        if (m === '5') return cmdRange(`knx ${ref} write ${g} {v}`, ptVal(j, g), 0, a.dpt === '5.010' ? 255 : a.dpt === '5.003' ? 360 : 100, id, g);
        if (m === '232') return `<input type="color" value="${esc(/^#[0-9a-f]{6}$/i.test(ptVal(j, g)) ? ptVal(j, g) : '#ffffff')}" data-cmdrange="knx ${esc(ref)} write ${g} {v}">`;
        return cmdSet(`knx ${ref} write ${g} {v}`, m === '9' ? '21.5' : 'value');
      };
      const show = (a) => {
        const v = ptVal(j, a.ga), m = dptMain(a.dpt);
        return m === '1' ? led(id, a.ga, v) : liveText(id, a.ga, v);
      };
      if (mode === 'compact') return addrs.map((a) => `<div class="drv-row"><span class="drv-name">${esc(a.name || a.ga)} · ${a.ga}</span><span>${show(a)}</span>
        <span class="row nowrap">${dptMain(a.dpt) === '1' ? cmdBtn(`knx ${ref} write ${a.ga} on`, 'On') + cmdBtn(`knx ${ref} write ${a.ga} off`, 'Off') : ''}</span></div>`).join('') ||
        '<p class="muted">No group addresses yet (Devices page).</p>';
      const b = `drivers.${i}.addresses`;
      return `<table class="drv-tbl"><tr><th>Group address</th><th>Name</th><th>Type (DPT)</th><th>Value</th>${edit ? '<th>Variable</th>' : '<th></th>'}<th>Control</th>${edit ? '<th></th>' : ''}</tr>
        ${addrs.map((a, k) => `<tr>
          <td>${edit ? `<input data-p="${b}.${k}.ga" value="${esc(a.ga)}" class="mono" style="width:80px" pattern="^\\d+/\\d+(/\\d+)?$" data-r>` : `<span class="mono">${esc(a.ga)}</span>`}</td>
          <td>${edit ? `<input data-p="${b}.${k}.name" value="${esc(a.name || '')}" placeholder="e.g. Hall light" style="width:150px">` : esc(a.name || '')}</td>
          <td>${edit ? `<select data-p="${b}.${k}.dpt" data-r style="width:200px">${KNX_DPTS.map(([v, n]) => `<option value="${v}"${v === String(a.dpt || '1') ? ' selected' : ''}>${v} · ${esc(n)}</option>`).join('')}</select>`
            : `<span class="muted">${esc(a.dpt || '1')}</span>`}</td>
          <td>${show(a)}</td>
          <td>${edit ? varSel(i, a.ga, a.var, `${b}.${k}.var`) : varTag(a.var)}</td>
          <td><div class="row nowrap">${ctl(a)}${cmdBtn(`knx ${ref} read ${a.ga}`, '⟳', '', 'Read now')}</div></td>
          ${edit ? `<td><button class="btn small ghost" data-del="${b}.${k}">✕</button></td>` : ''}</tr>`).join('')}</table>
        ${edit ? `<div class="row" style="margin-top:6px"><button class="btn small" data-knxadd="${i}">+ Group address</button>
          <details class="drv-paste"><summary class="muted">Paste a list…</summary>
            <textarea data-knxlist="${i}" rows="5" class="mono" style="width:420px" spellcheck="false" placeholder="1/1/1  1  Hall light&#10;1/2/1  5.001  Hall dimmer&#10;3/1/1  9  Hall temperature"></textarea>
            <div class="row"><button class="btn small" data-knxpaste="${i}">Add these</button><span class="muted">One per line: address, DPT, name (e.g. an export from ETS).</span></div></details></div>` : ''}`;
    }
    case 'netio': {
      // Rows from the model (so they're there before the first read), names and states from the NETIO.
      // A model you picked decides the rows; "as reported" also shows whatever the NETIO sends.
      const m = netioModel(x, j), picked = !!x.model;
      const seenOut = pts.filter((p) => /^out\d+$/.test(p.k)).length, seenIn = pts.filter((p) => /^in\d+$/.test(p.k)).length;
      const nOut = picked ? m[2] : Math.max(m?.[2] || 0, seenOut), nIn = picked ? m[3] : Math.max(m?.[3] || 0, seenIn);
      const metered = m ? m[4] : pts.some((p) => p.k.startsWith('load'));
      const outs = Array.from({ length: nOut }, (_, k) => pts.find((p) => p.k === 'out' + (k + 1)) || { k: 'out' + (k + 1), n: 'Output ' + (k + 1), v: '' });
      const ins = [...Array.from({ length: nIn }, (_, k) => pts.find((p) => p.k === 'in' + (k + 1)) || { k: 'in' + (k + 1), n: 'Input ' + (k + 1), v: '' }),
        ...pts.filter((p) => /^temp\d+$/.test(p.k) && +p.k.slice(4) <= nIn)];
      const mismatch = picked && seenOut && seenOut !== nOut ? `<p class="mem-warn">The NETIO reports ${seenOut} outputs, but ${esc(m[1])} has ${nOut}: check the model.</p>` : '';
      if (!outs.length && !ins.length) return '<p class="muted">Pick the model above, or the outputs appear after the first status read (save, and check the IP, user and password).</p>';
      const oc = (n, name) => cmdBtn(`netio ${ref} output ${n} on`, 'On') + cmdBtn(`netio ${ref} output ${n} off`, 'Off', `Switch off ${name}?`) +
        cmdBtn(`netio ${ref} output ${n} toggle`, '⇄', '', 'Toggle') + cmdBtn(`netio ${ref} output ${n} restart`, '↻', `Power-cycle ${name}?`, 'Restart: off for a moment, then on');
      if (mode === 'compact') return outs.map((p) => { const n = p.k.slice(3); return `<div class="drv-row"><span class="drv-name">${n} · ${esc(p.n)}</span><span>${led(id, p.k, p.v)} <span class="muted">${esc(ptVal(j, 'load' + n) || '0')} W</span></span><span class="row nowrap">${oc(n, p.n)}</span></div>`; }).join('') +
        ins.map((p) => `<div class="drv-row"><span class="drv-name">${esc(p.n)}</span><span>${p.k.startsWith('in') ? led(id, p.k, p.v) : esc(p.v)}</span><span></span></div>`).join('');
      return `${mismatch}<table class="drv-tbl"><tr><th>Output</th><th>Name (set on the NETIO)</th><th>State</th>${metered ? '<th>Load</th>' : ''}<th>Variable</th><th>Control</th></tr>
        ${outs.map((p) => { const n = p.k.slice(3); return `<tr><td>${n}</td><td>${esc(p.n)}</td><td>${led(id, p.k, p.v)}</td>${metered ? `<td>${liveText(id, 'load' + n, ptVal(j, 'load' + n))} W</td>` : ''}${vcell(p.k)}<td><div class="row nowrap">${oc(n, p.n)}</div></td></tr>`; }).join('')}</table>
        ${ins.length ? `<table class="drv-tbl"><tr><th>Input</th><th>Name</th><th>State</th><th>Variable</th></tr>
          ${ins.map((p) => `<tr><td>${p.k.replace(/\D/g, '')}</td><td>${esc(p.n)}</td><td>${p.k.startsWith('in') ? led(id, p.k, p.v, 'closed = on') : liveText(id, p.k, p.v) + ' °C'}</td>${vcell(p.k)}</tr>`).join('')}</table>` : ''}`;
    }
    case 'pharos': {
      const tls = pts.filter((p) => /^tl\d+$/.test(p.k)), scs = pts.filter((p) => /^sc\d+$/.test(p.k)), grps = pts.filter((p) => /^grp\d+$/.test(p.k));
      const badge = (p) => `<span class="tag ${p.v === 'running' || p.v === 'started' ? 'mon-ok' : p.v === 'paused' || p.v === 'holding_at_end' ? 'mon-warn' : ''}" data-live="${id}|${p.k}" data-fmt="badge">${esc(p.v || 'none')}</span>`;
      const tlc = (n) => cmdBtn(`pharos ${ref} timeline ${n} start`, '▶', '', 'Start') + cmdBtn(`pharos ${ref} timeline ${n} pause`, '⏸', '', 'Pause') +
        cmdBtn(`pharos ${ref} timeline ${n} resume`, '⏵', '', 'Resume') + cmdBtn(`pharos ${ref} timeline ${n} release`, '■', '', 'Release');
      if (mode === 'compact') return tls.map((p) => `<div class="drv-row"><span class="drv-name">${esc(p.n)}</span><span>${badge(p)}</span><span class="row nowrap">${cmdBtn(`pharos ${ref} timeline ${p.k.slice(2)} start`, '▶')}${cmdBtn(`pharos ${ref} timeline ${p.k.slice(2)} release`, '■')}</span></div>`).join('');
      // Sub-tabs: timelines, scenes, groups and the Pharos project's own triggers.
      const trigs = j.triggers || [];
      const tabs = [['timelines', 'Timelines', tls.length], ['scenes', 'Scenes', scs.length], ['groups', 'Groups', grps.length], ['triggers', 'Triggers', trigs.length]];
      const sub = tabs.some(([k]) => k === S.phTab) ? S.phTab : 'timelines';
      const bar = `<div class="seg" style="margin:4px 0 8px">${tabs.map(([k, l, n]) => `<button class="${sub === k ? 'on' : ''}" data-phtab="${k}">${l}${n ? ` <small>${n}</small>` : ''}</button>`).join('')}</div>`;
      const none = (what) => `<p class="muted">No ${what} read from the Pharos yet (they appear after the first status read).</p>`;
      const name = (p, re) => esc(p.n.replace(re, '') || p.n);
      let body = '';
      if (sub === 'timelines') body = tls.length ? `<table class="drv-tbl"><tr><th>#</th><th>Timeline</th><th>State</th><th>Variable</th><th>Control</th></tr>
        ${tls.map((p) => `<tr><td>${p.k.slice(2)}</td><td>${name(p, /^Timeline \d+ ?/)}</td><td>${badge(p)}</td>${vcell(p.k)}<td><div class="row nowrap">${tlc(p.k.slice(2))}</div></td></tr>`).join('')}</table>` : none('timelines');
      if (sub === 'scenes') body = scs.length ? `<table class="drv-tbl"><tr><th>#</th><th>Scene</th><th>State</th><th>Variable</th><th>Control</th></tr>
        ${scs.map((p) => `<tr><td>${p.k.slice(2)}</td><td>${name(p, /^Scene \d+ ?/)}</td><td>${badge(p)}</td>${vcell(p.k)}<td><div class="row nowrap">${cmdBtn(`pharos ${ref} scene ${p.k.slice(2)} start`, '▶', '', 'Start')}${cmdBtn(`pharos ${ref} scene ${p.k.slice(2)} toggle`, '⇄', '', 'Toggle')}${cmdBtn(`pharos ${ref} scene ${p.k.slice(2)} release`, '■', '', 'Release')}</div></td></tr>`).join('')}</table>` : none('scenes');
      if (sub === 'groups') body = grps.length ? `<table class="drv-tbl"><tr><th>#</th><th>Group</th><th>Level</th><th>Variable</th><th>Master</th></tr>
        ${grps.map((p) => `<tr><td>${p.k.slice(3)}</td><td>${esc(p.n.replace(/ \(%\)$/, ''))}</td><td>${liveText(id, p.k, p.v)} %</td>${vcell(p.k)}<td>${cmdRange(`pharos ${ref} group ${p.k.slice(3)} master {v}`, p.v, 0, 100, id, p.k)}</td></tr>`).join('')}</table>` : none('groups');
      if (sub === 'triggers') {
        const f = (S.phFilter || '').toLowerCase();
        const shown = trigs.filter((t) => !f || String(t.n) === f || (t.name || '').toLowerCase().includes(f) || (t.t || '').toLowerCase().includes(f));
        body = trigs.length ? `<div class="row"><input data-phfilter value="${esc(S.phFilter || '')}" placeholder="Search triggers…" style="width:220px"><span class="muted">${shown.length} of ${trigs.length} · fire one: <code>pharos ${esc(ref)} trigger &lt;#&gt;</code></span></div>
          <table class="drv-tbl"><tr><th>#</th><th>Trigger</th><th>Type</th><th></th></tr>
          ${shown.slice(0, 200).map((t) => `<tr><td>${t.n}</td><td>${esc(t.name)}</td><td class="muted">${esc((t.t || '').replace(/_/g, ' '))}</td><td>${cmdBtn(`pharos ${ref} trigger ${t.n}`, 'Fire', '', `Fire trigger ${t.n} on the Pharos`)}</td></tr>`).join('')}</table>` : none('triggers');
      }
      return bar + body;
    }
    case 'digidot': {
      const scenes = j.scenes || [];
      const rows = [['scene', 'Scene playing'], ['master', 'Master (%)'], ['speed', 'Speed (%)'], ['paused', 'Paused']];
      if (mode === 'compact') return rows.slice(0, 3).map(([k, n]) => `<div class="drv-row"><span class="drv-name">${n}</span><span>${liveText(id, k, ptVal(j, k))}</span><span></span></div>`).join('') +
        (scenes.length ? `<div class="row" style="gap:4px;margin-top:4px">${scenes.map((s) => cmdBtn(`digidot ${ref} scene ${quote(s)}`, esc(s))).join('')}</div>` : '');
      return `<table class="drv-tbl"><tr><th>Reading</th><th>Now</th><th>Variable</th><th>Control</th></tr>
        ${rows.map(([k, n]) => `<tr><td>${n}</td><td>${liveText(id, k, ptVal(j, k))}</td>${vcell(k)}<td>${k === 'master' ? cmdRange(`digidot ${ref} master {v}`, ptVal(j, 'master'), 0, 100, id, 'master')
          : k === 'speed' ? cmdSet(`digidot ${ref} speed {v}`, '100') : k === 'scene' ? cmdBtn(`digidot ${ref} stop`, '■ Stop') : ''}</td></tr>`).join('')}</table>
        <h4>Scenes on the C4</h4>${scenes.length ? `<div class="row" style="gap:4px">${scenes.map((s, k) => cmdBtn(`digidot ${ref} scene ${quote(s)}`, `${k + 1} · ${esc(s)}`)).join('')}</div>`
          : '<p class="muted">The scene list is read from the C4 at the first status read.</p>'}`;
    }
    case 'brightsign': {
      const msg = ptVal(j, 'msg'), at = +ptVal(j, 'msgAt') || 0;
      const says = `${liveText(id, 'msg', msg)} <span class="muted">${at ? ago(at) : ''}</span>`;
      // From the kdlink plugin: zones z<n> (state) + z<n>.file, user variables var.<name>.
      const zones = pts.filter((p) => /^z\d+$/.test(p.k)), uvars = pts.filter((p) => p.k.startsWith('var.'));
      const zname = (p) => p.n.replace(/^Zone \d+ ?/, '') || p.k.slice(1);
      const zref = (p) => quote(zname(p));
      const gpio = pts.filter((p) => /^gpio\d$/.test(p.k));
      const leds = gpio.length ? `<span class="row nowrap" style="gap:3px">${gpio.map((p) => led(id, p.k, p.v, `GPIO ${p.k.slice(4)}`)).join('')}</span>` : '';
      if (mode === 'compact') return zones.map((p) => `<div class="drv-row"><span class="drv-name">${esc(zname(p))}</span><span>${liveText(id, p.k, p.v)}</span><span></span></div>`).join('') +
        (leds ? `<div class="drv-row"><span class="drv-name">GPIO</span>${leds}<span></span></div>` : '') +
        `<div class="drv-row"><span class="drv-name">Player says</span><span>${says}</span><span></span></div>`;
      const cmds = x.commands || [];
      // Test buttons: every state of every zone, read from the presentation; the state playing now is lit.
      const states = j.states || [];
      const tests = zones.map((p) => {
        const zn = +p.k.slice(1), ss = states.filter((s) => s.z === zn);
        if (!ss.length) return '';
        return `<div class="row" style="gap:4px;margin:3px 0"><span class="muted" style="min-width:80px">${esc(zname(p))}</span>${ss.map((s) =>
          `<button class="btn small bs-test${bsTestOn(p.v, s.n) ? ' on' : ''}" data-cmd="${esc(`brightsign ${ref} test ${zref(p)} ${quote(s.n)}`)}" data-bstest="${id}|${p.k}|${esc(s.n)}"
            title="${esc(s.f ? `Play ${s.f} in ${zname(p)}` : 'This state has no media file to play')}"${s.f ? '' : ' disabled'}>${esc(s.n)}</button>`).join('')}</div>`;
      }).join('');
      const act = (j.activity || []).slice().reverse();
      const plugin = !x.plugin ? '' : `${tests ? `<h4>Test</h4><p class="muted" style="margin:0 0 4px">Plays the file of that state in the zone. When it ends, the presentation carries on by itself.</p>${tests}` : ''}
        ${gpio.length ? `<h4>GPIO inputs</h4><div class="row">${leds}<span class="muted">link one to a variable in the table below</span></div>` : ''}
        <h4>Activity <span class="muted" style="font-weight:normal">what the player received: serial, UDP, GPIO, zone changes</span></h4>
        <div class="bs-act" data-bsact="${id}">${bsActHtml(act)}</div>
        <h4>Zones</h4>${zones.length ?`<table class="drv-tbl"><tr><th>#</th><th>Zone</th><th>Playing (state)</th><th>File</th><th>Variable</th><th>Control</th></tr>
          ${zones.map((p) => `<tr><td>${p.k.slice(1)}</td><td>${esc(zname(p))}</td><td>${liveText(id, p.k, p.v)}</td><td class="mono">${liveText(id, p.k + '.file', ptVal(j, p.k + '.file'))}</td>${vcell(p.k)}
            <td><div class="row nowrap">${cmdSet(`brightsign ${ref} play ${zref(p)} {v}`, 'file.mp4')}${cmdBtn(`brightsign ${ref} stop ${zref(p)}`, '■', '', 'Stop the video/audio of this zone')}</div></td></tr>`).join('')}</table>`
          : '<p class="muted">No zones reported yet: the plugin answers at the next status check (check it is in the presentation, named <code>kdlink</code>).</p>'}
        <div class="row" style="margin-top:6px"><span class="muted" title="A Plugin Message event (plugin kdlink) in the presentation: use it on a transition to go to any state in any zone">Plugin message:</span>${cmdSet(`brightsign ${ref} event {v}`, 'e.g. video_intro', true)}</div>
        <h4>User variables</h4>${uvars.length ? `<table class="drv-tbl"><tr><th>Name</th><th>Value</th><th>Variable</th><th>Set</th></tr>
          ${uvars.map((p) => `<tr><td>${esc(p.n || p.k.slice(4))}</td><td>${liveText(id, p.k, p.v)}</td>${vcell(p.k)}<td>${cmdSet(`brightsign ${ref} var ${quote(p.n || p.k.slice(4))} {v}`, 'value', true)}</td></tr>`).join('')}</table>`
          : '<p class="muted">No user variables reported (the presentation has none, or the plugin hasn\'t answered yet).</p>'}`;
      return `${plugin}<table class="drv-tbl"><tr><th>Reading</th><th>Now</th><th>Variable</th></tr>
          <tr><td title="The last UDP message the presentation sent to the controller (or a Send Plugin Message to kdlink)">Player says</td><td>${says}</td>${vcell('msg')}</tr>
          ${pts.some((p) => p.k === 'serial') ? `<tr><td title="The last line the player received on its serial port">Serial in</td><td class="mono">${liveText(id, 'serial', ptVal(j, 'serial'))}</td>${vcell('serial')}</tr>` : ''}
          ${gpio.map((p) => `<tr><td>GPIO ${p.k.slice(4)}</td><td>${led(id, p.k, p.v)}</td>${vcell(p.k)}</tr>`).join('')}</table>
        <h4>Commands</h4>
        <table class="drv-tbl"><tr><th>Button</th><th>UDP text sent to the player</th><th></th>${edit ? '<th></th>' : ''}</tr>
          ${cmds.map((c, k) => `<tr><td>${edit ? `<input data-p="drivers.${i}.commands.${k}.name" value="${esc(c.name || '')}" placeholder="e.g. Play intro" style="width:130px">` : esc(c.name || '')}</td>
            <td>${edit ? `<input data-p="drivers.${i}.commands.${k}.text" value="${esc(c.text || '')}" class="mono" placeholder="e.g. play1" style="width:160px">` : `<code>${esc(c.text || '')}</code>`}</td>
            <td>${c.text ? cmdBtn(`brightsign ${ref} send ${c.text}`, esc(c.name || c.text)) : ''}</td>
            ${edit ? `<td><button class="btn small ghost" data-del="drivers.${i}.commands.${k}">✕</button></td>` : ''}</tr>`).join('')}</table>
        <div class="row" style="margin-top:6px">${edit ? `<button class="btn small" data-bscmd="${i}">+ Command</button>` : ''}
          <span class="muted">Send anything:</span>${cmdSet(`brightsign ${ref} send {v}`, 'UDP text', true)}</div>`;
    }
  }
  return '';
}
function drvActions(x) {
  const ref = quote(x.name);
  switch (x.type) {
    case 'brightsign': return cmdBtn(`brightsign ${ref} reboot`, 'Reboot', `Reboot ${x.name}?`);
    case 'digidot': return cmdBtn(`digidot ${ref} stop`, 'Stop') + cmdBtn(`digidot ${ref} master 100`, 'Master 100%') + cmdBtn(`digidot ${ref} master 0`, 'Master 0%');
    case 'pharos': return cmdBtn(`pharos ${ref} release all`, 'Release all') + cmdBtn(`pharos ${ref} beacon on`, 'Beacon');
    case 'netio': return cmdBtn(`netio ${ref} output all on`, 'All on') + cmdBtn(`netio ${ref} output all off`, 'All off', `Switch off ALL outputs of ${x.name}?`);
    default: return '';
  }
}
// Health rows shared by the Monitoring cards.
function drvHealth(j) {
  const now = S.status?.time || 0;
  return [
    ...(j.live ? [['Updates', liveChip(j) + (j.liveNote ? ` <span class="muted">${esc(j.liveNote)}</span>` : '')]] : []),
    ...(j.uptime ? [['Uptime', `${duration(j.uptime)} <span class="muted">(device)</span>`]] : []),
    ['Online for', j.onlineSince ? duration(now - j.onlineSince) : '—'],
    ['Restarts', j.restarts ? `<span class="mem-warn" title="The device's uptime went down: it crashed, lost power or was rebooted">${j.restarts}×, last ${ago(j.lastRestart)}</span>`
      : j.uptime ? '0 <span class="muted">seen</span>' : '<span class="muted">not reported</span>'],
    ['Drop-outs', j.dropouts ? `<span class="mem-warn">${j.dropouts}×</span>` : '0'],
    ...(j.lastError ? [['Last error', `${esc(j.lastError)} <span class="muted">${ago(j.lastErrorAt)}</span>`]] : []),
    ...Object.entries(j.info || {}).filter(([, v]) => v).map(([k, v]) => [esc(k), esc(v)]), ['Last seen', ago(j.lastSeen)], ['Last reply', esc(j.last || '—')]];
}
function drvMonCard(x, card, compact) {
  const j = drvSt(x);
  const state = !j.seen ? 'unknown' : j.online ? 'online' : 'offline';
  const sub = `${x.ip}${x.port ? ':' + x.port : ''} · ${DRIVERS[x.type]?.label || x.type}${x.type === 'knx' ? (j.tunnel ? ' · tunnel open' : ' · no tunnel') : ''}`;
  const panel = drvPanel(x, j, compact ? 'compact' : 'view');
  return card(state, x.name, sub, drvHealth(j), (panel ? `<div class="drv-pts">${panel}</div>` : '') + historyBar(j.history, j.checks), drvActions(x), `drv:${x.id}`);
}
function mqttCard(m, card) {
  return card('online', 'MQTT broker', `port ${m.port} · on this controller`, [
    ['Clients', String(m.clients?.length || 0)], ['Messages', String(m.messages || 0)],
    ...(m.lastTopic ? [['Last', `<code>${esc(m.lastTopic)}</code> ${esc(m.lastPayload || '')}`]] : []),
    ...(m.clients || []).map((c) => [esc(c.ip), `${esc(c.id)} · ${c.messages} msgs · ${duration(c.since)}`]),
  ]);
}

// ---- Devices tab per type ------------------------------------------------------------
const DRV_HELP = {
  kissbox: `Kiss-Box I/O with the <b>Kiss-Box protocol</b> firmware in <b>UDP</b> mode (port 9813). Pick the frame and the card in each slot, name the channels and link them to variables.
    <b>The box answers on its own destination port</b> (Kiss-Box Editor, I/O Mode Setup), usually as a broadcast, not to the port it was asked from: set the <b>listen port</b> below to that port (e.g. 9817). If they differ, commands still work but the box shows <b>offline</b>, the buttons don't follow and inputs never arrive. If the box sends to a fixed IP instead of broadcast, that IP must be this controller's.
    For instant input changes, also switch on automatic input state (timed updates) for the input cards.
    Commands: <code>kissbox io 1.3 on</code>, <code>kissbox io 2 all 1 0 1 0 0 0 0 0</code>, <code>kissbox io read 3</code>, <code>kissbox io 3.1 128</code> (analog).`,
  knx: `A <b>KNX IP interface or router</b> (KNXnet/IP tunnelling, UDP 3671; it uses one of its tunnels). Add the group addresses with their datapoint type.
    They are read once when the tunnel opens and then follow every telegram on the bus live - no polling.
    Commands: <code>knx gw write "Hall light" on</code>, <code>knx gw write 1/2/1 40</code>, <code>knx gw read "Hall temp"</code>.`,
  brightsign: `BrightSign players: commands go as <b>UDP</b> to the presentation (BrightAuthor: UDP input on the port below). Status and reboot use the player's local DWS (port 80, user <code>admin</code>, the DWS password; on newer BrightSignOS only over https, which isn't supported yet).
    <b>What's playing:</b> let the presentation send a UDP message to this controller (port ${'${port}'}) on every state, e.g. <code>playing Intro</code>: it shows as <b>Player says</b>.<br>
    <b>KD plugin</b> (watch and test, the player keeps running its own show): download <code>kdlink.brs</code>, add it in BrightAuthor:connected under Presentation Settings → Support Content → Script Plugins with the name <code>kdlink</code>, publish, and tick KD plugin below. Nothing else in the presentation changes, and it works without the DWS.
    You get every zone with what it plays, a <b>Test</b> button per state (plays that state's file; the presentation carries on after it), the GPIO inputs, an <b>Activity</b> list (serial lines, UDP, buttons) and the user variables.
    Commands: <code>brightsign player test Video "Video 2"</code>, <code>play Video clip.mp4</code>, <code>stop Video</code>, <code>var mode night</code>, <code>event &lt;text&gt;</code> (a Plugin Message, if you ever use one).`,
  digidot: `DiGidot C4 pixel controllers (JSON API, default user/password <code>admin</code>/<code>admin</code>). The C4 has no push option: it is polled.
    Commands: <code>digidot c4 scene "Rainbow" fade 2</code>, <code>digidot c4 master 50</code>, <code>digidot c4 stop</code>, any API call with <code>digidot c4 send {…}</code>.`,
  netio: `NETIO power sockets (JSON API: enable it on the NETIO under M2M API Protocols → JSON API, read/write, default <code>netio</code>/<code>netio</code>).
    <b>Live updates</b> uses the NETIO's MQTT-flex: it publishes every change to the MQTT broker built into this controller, so the outputs update at once instead of every poll.
    Commands: <code>netio rack output 1 on</code>, <code>output all off</code>, <code>output 2 restart 5</code>, <code>output 3 pulse 10</code>.`,
  pharos: `Pharos LPC / TPC / VLC over the Controller API (plain http). Leave the user empty if the web API is open.
    <b>Live updates</b> subscribes over a WebSocket to timeline, scene and group changes, so they show at once.
    Commands: <code>pharos lpc timeline 2 start fade 3</code>, <code>pharos lpc scene 4 start</code>, <code>pharos lpc group 1 master 50</code>, <code>pharos lpc trigger 5</code>, <code>pharos lpc api get system</code>.`,
};
// NETIO MQTT-flex config to paste on the NETIO (M2M API Protocols -> MQTT-flex).
function netioMqttConfig(d) {
  const ip = S.status?.ip || '<controller IP>', n = Math.max(1, (drvSt(d).points || []).filter((p) => /^out\d+$/.test(p.k)).length || 4);
  const outs = Array.from({ length: n }, (_, k) => k + 1);
  return JSON.stringify({
    config: {
      broker: { url: ip, protocol: 'mqtt', port: 1883, ssl: false, type: 'generic', username: '', password: '' },
      publish: [
        { topic: 'netio/${DEVICE_NAME}/status', qos: 0, retain: false, payload: '${INOUT_STATUS}',
          events: [...outs.map((k) => ({ type: 'change', source: `OUTPUTS/${k}/STATE` })), { type: 'timer', period: 60 }] },
      ],
      subscribe: [],
    },
  }, null, 2);
}
function driverPage(type) {
  const p = P(), list = p.drivers.map((d, i) => [d, i]).filter(([d]) => d.type === type), info = DRIVERS[type];
  const auth = !['kissbox', 'knx'].includes(type);
  const help = DRV_HELP[type].replace('${port}', p.settings.udpPort || 4000);
  const dev = ([d, i]) => {
    normDriver(d);
    const j = drvSt(d), st = drvState(d.id), b = `drivers.${i}`;
    const field = (label, html, title) => `<label${title ? ` title="${esc(title)}"` : ''}>${label}</label><div class="row nowrap">${html}</div>`;
    const num = (k, def, min, max, w) => `<input type="number" data-p="${b}.${k}" data-t="num" min="${min}" max="${max}" value="${d[k] ?? def}" style="width:${w || 90}px">`;
    let extra = '';
    if (type === 'kissbox') extra = field('Frame', `<select data-kissframe="${i}">${KISS_FRAMES.map(([f, l]) => `<option value="${f}"${f === d.frame ? ' selected' : ''}>${l}</option>`).join('')}</select>`) +
      field('Listen port', num('listenPort', 9813, 1, 65535) + '<span class="muted">UDP port the box sends input changes to (all Kiss-Boxes share the first one\'s)</span>');
    if (type === 'knx') extra = field('Re-read every', num('readEvery', 0, 0, 86400) + '<span class="muted">s · 0 = only when the tunnel opens (the bus pushes every change)</span>');
    if (type === 'brightsign') {
      extra = field('UDP port', num('udpPort', 5000, 1, 65535) + '<span class="muted">the presentation\'s UDP input</span>') +
        field('KD plugin', `<label class="chk"><input type="checkbox" data-p="${b}.plugin" data-t="bool" data-r${d.plugin ? ' checked' : ''}>
          zones, what's playing, user variables, control</label> ${liveChip(j)} <a href="brightsign/kdlink.brs" download="kdlink.brs" class="btn small">Download kdlink.brs</a>`);
      if (d.plugin) extra += field('Plugin port', num('pluginPort', 5010, 1, 65535) + '<span class="muted">UDP port of the plugin on the player (5010, or a user variable <code>kdPort</code>)</span>');
    }
    if (type === 'netio') {
      const m = netioModel(d, j), rep = String(j.info?.Model || '').split(' ')[0];
      extra = field('Model', `<select data-netiomodel="${i}">${NETIO_MODELS.map(([c, l, o, n, met]) => `<option value="${c}"${c === (d.model || '') ? ' selected' : ''}>${esc(l)}${c ? ` · ${o} out${n ? `, ${n} in` : ''}${met ? ', metering' : ''}` : ''}</option>`).join('')}</select>
        <span class="muted">${rep ? `the NETIO says: ${esc(rep)}${!d.model && m ? ` → ${esc(m[1])}` : ''}` : ''}</span>`);
    }
    if (type === 'pharos' || type === 'netio') extra += field('Live updates', `<label class="chk"><input type="checkbox" data-p="${b}.live" data-t="bool" data-r${d.live ? ' checked' : ''}>
      ${type === 'pharos' ? 'WebSocket subscription (timelines, scenes, groups)' : 'MQTT-flex to the broker on this controller'}</label> ${liveChip(j)}`);
    const mqtt = type === 'netio' && d.live ? `<details class="drv-paste"><summary>MQTT-flex settings for this NETIO…</summary>
      <p class="muted">On the NETIO: M2M API Protocols → MQTT-flex → enable, paste this, save. It publishes the full status on every output change and once a minute.</p>
      <pre class="mono drv-pre">${esc(netioMqttConfig(d))}</pre></details>` : '';
    return `<div class="card drv-dev">
      <div class="row nowrap"><b style="font-size:15px">${esc(d.name)}</b>
        <span data-drvst="${d.id}" title="${esc(st.last)}"><span class="dot ${st.dot}"></span>${esc(st.text)}</span>${liveChip(j)}
        <span class="spacer" style="flex:1"></span>${drvActions(d)}<button class="btn small ghost" data-del="${b}" title="Delete this ${info.label}">✕</button></div>
      <div class="form drv-form">
        ${field('Name', `<input data-p="${b}.name" value="${esc(d.name)}" data-r title="Used in commands: ${type} ${esc(d.name)} …">`)}
        ${field('IP address', `<input data-p="${b}.ip" value="${esc(d.ip)}" pattern="^(\\d{1,3}\\.){3}\\d{1,3}$">`)}
        ${field('Port', num('port', info.port, 1, 65535))}
        ${auth ? field('User', `<input data-p="${b}.user" value="${esc(d.user || '')}" placeholder="${type === 'brightsign' ? 'admin' : 'none'}" autocomplete="off" style="width:140px">`) +
          field('Password', `<input data-p="${b}.password" type="password" value="${esc(d.password || '')}" placeholder="none" autocomplete="new-password" style="width:140px">`) : ''}
        ${field('ID', num('id', d.id, 1, 999, 70), 'Number for commands, e.g. ' + type + ' ' + d.id + ' …')}
        ${extra}
      </div>${mqtt}
      <div class="drv-live" data-livekeys="${d.id}" data-keys="${esc(liveKeys(j))}">${drvPanel(d, j, 'edit', i)}</div></div>`;
  };
  const every = p.settings.monitor.interval;
  return `<p class="muted drv-help">${help}<br>Status is checked every <b>${every} s</b> (set on the Monitoring page, for all devices)${type === 'knx' || type === 'pharos' || type === 'netio' ? '; with live updates that check is only a safety net' : ''}.</p>
    ${list.map(dev).join('') || `<p class="muted">No ${info.label} yet.</p>`}
    <div class="row" style="margin-top:8px"><button class="btn" data-add="drv-${type}">+ ${info.label}</button>
      <span class="muted">Save to send the settings to the controller; the readings and buttons work once it answers.</span></div>
    ${groupsSection(type, `${info.label} groups`, `<code>${type} &lt;group&gt; …</code> runs the same command on every ${info.label} in the group.`)}`;
}
function driverPageAfter() {
  // Nothing per page: the handlers below are global.
}

// ---- Portenta Machine Control I/O (src/Board.cpp) ------------------------------------
// The board's own points, not a network device: "machineControl" in the project, status.board live.
// mode: 'edit' (Devices tab), 'view' (Monitoring tab), 'compact' (Monitoring "All").
function pmcPanel(mode) {
  const j = S.status?.board || {}, edit = mode === 'edit';
  const pt = (k) => (j.points || []).find((x) => x.k === k) || {};
  const state = (k) => {
    const v = pt(k).v ?? '';
    return /^a/.test(k) ? `${liveText('board', k, v)} <span class="muted">${pmcUnit(k)}</span>` : led('board', k, v, /^(in|io)/.test(k) && !pmcIsOut(k) ? '24 V = on' : '');
  };
  const ctl = (k) => {
    if (!pmcIsOut(k)) return '';
    if (/^ao/.test(k)) return `<input type="range" min="0" max="10" step="0.1" value="${esc(pt(k).v || 0)}" data-cmdrange="io ${k} {v}" data-live="board|${k}" data-fmt="range" style="width:120px">`;
    return cmdBtn(`io ${k} on`, 'On') + cmdBtn(`io ${k} off`, 'Off') + cmdBtn(`io ${k} pulse 1`, 'Pulse', '', 'On for 1 second');
  };
  if (mode === 'compact') {
    return PMC_GROUPS.map(([g, n, name]) => {
      const cells = Array.from({ length: n }, (_, c) => {
        const k = g + c, v = pt(k).v ?? '', nm = pmcCfg(k).name ? `${k} · ${pmcCfg(k).name}` : k;
        if (/^a/.test(k)) return `<span class="kiss" title="${esc(nm)}">${esc(v === '' ? '–' : v)}</span>`;
        if (pmcIsOut(k)) return `<button class="btn small kiss ${v === '1' ? 'on' : ''}" data-cmd="io ${k} ${v === '1' ? 'off' : 'on'}" title="${esc(nm)}: ${v === '1' ? 'on - click for off' : 'off - click for on'}">${c}</button>`;
        return `<span class="kiss ${v === '1' ? 'on' : ''}" title="${esc(nm)}: ${v === '1' ? 'on' : 'off'}${/^io/.test(k) ? ' (input)' : ''}">${c}</span>`;
      }).join('');
      const short = { in: 'Inputs', out: 'Outputs', io: 'Prog. I/O', ai: 'Analog in', ao: 'Analog out' }[g];
      return `<div class="drv-row pmc-row"><span class="drv-name" title="${name}">${short}</span><span class="row" style="gap:3px">${cells}</span></div>`;
    }).join('');
  }
  const vars = P().variables;
  return PMC_GROUPS.map(([g, n, name, about]) => {
    const rows = Array.from({ length: n }, (_, c) => {
      const k = g + c, cfg = pmcCfg(k);
      const nameCell = edit ? `<input data-pmc="${k}|name" value="${esc(cfg.name || '')}" placeholder="${pmcIsOut(k) ? 'e.g. Door release' : 'e.g. Start button'}" style="width:160px">` : esc(cfg.name || '');
      let modeCell = '';
      if (g === 'io') modeCell = edit ? `<select data-pmc="${k}|mode">${[['in', 'input'], ['out', 'output']].map(([v, l]) => `<option value="${v}"${(cfg.mode === 'out' ? 'out' : 'in') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>` : (pmcIsOut(k) ? 'output' : 'input');
      if (g === 'ai') modeCell = edit ? `<select data-pmc="${k}|mode">${PMC_AI_MODES.map(([v, l]) => `<option value="${v}"${(cfg.mode || '0-10V') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>` : esc(PMC_AI_MODES.find(([v]) => v === (cfg.mode || '0-10V'))[1]);
      const varCell = edit ? `<select data-pmc="${k}|var" title="${pmcIsOut(k) ? 'Variable that follows this output; setting the variable also switches the output' : 'Variable that follows this input (react with a Variable change trigger)'}" style="width:120px">
          <option value="">—</option>${vars.map((v) => `<option${v.name === cfg.var ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}
          ${cfg.var && !vars.some((v) => v.name === cfg.var) ? `<option selected>${esc(cfg.var)}</option>` : ''}</select>` : varTag(cfg.var);
      return `<tr><td class="mono">${k}</td><td>${nameCell}</td>${g === 'io' || g === 'ai' ? `<td>${modeCell}</td>` : ''}<td>${state(k)}</td><td>${varCell}</td><td><div class="row nowrap">${ctl(k)}</div></td></tr>`;
    }).join('');
    const modeHead = g === 'io' ? '<th>Use as</th>' : g === 'ai' ? '<th>Sensor</th>' : '';
    return `<div class="drv-slot"><div class="row"><b>${name}</b><span class="muted">${about}</span></div>
      <table class="drv-tbl"><tr><th>Point</th><th>Name</th>${modeHead}<th>State</th><th>Variable</th><th>${g === 'out' || g === 'io' || g === 'ao' ? 'Control' : ''}</th></tr>${rows}</table></div>`;
  }).join('');
}
function boardPage() {
  const j = S.status?.board;
  const st = !S.status ? 'waiting for the controller…' : !j ? '<span class="dot"></span>this firmware has no Machine Control I/O (build <code>machine_control</code>)'
    : j.ok ? '<span class="dot ok"></span>I/O running' : '<span class="dot bad"></span>I/O chips not answering';
  return `<p class="muted drv-help">The inputs and outputs of the <b>Portenta Machine Control</b> this controller runs in. The point names match the labels on the case.
      Name them, pick for each programmable I/O whether it is an input or an output, and link points to variables.
      Use inputs in an <b>Input</b> trigger, switch outputs with <code>io out3 on</code>, <code>io io5 pulse 2</code>, <code>io ao0 7.5 fade 3</code>, <code>io all off</code>,
      and test them in conditions: <code>io in2 is on</code>, <code>io ai0 > 5</code>.
      Outputs keep their state when you save. Changes to names, modes and variables work after saving.</p>
    <div class="card drv-dev"><div class="row nowrap"><b style="font-size:15px">Machine Control</b><span>${st}</span>
      <span class="spacer" style="flex:1"></span>${cmdBtn('io all off', 'All outputs off', 'Switch off ALL Machine Control outputs?')}</div>
      <div class="drv-live">${pmcPanel('edit')}</div></div>`;
}
const pmcUsed = () => !!S.status?.board || Object.keys(P().machineControl || {}).length > 0;
function pmcMonCard(card, compact) {
  const j = S.status?.board || {};
  const ins = (j.points || []).filter((x) => /^(in|io)/.test(x.k) && !x.out && x.v === '1').length;
  const outs = (j.points || []).filter((x) => x.out && !/^ao/.test(x.k) && x.v === '1').length;
  return card(!S.status?.board ? 'unknown' : j.ok ? 'online' : 'offline', 'Machine Control', 'board I/O · on this controller',
    [['Inputs on', String(ins)], ['Outputs on', String(outs)]], `<div class="drv-pts">${pmcPanel(compact ? 'compact' : 'view')}</div>`,
    cmdBtn('io all off', 'All outputs off', 'Switch off ALL Machine Control outputs?'));
}

// Live values on the Devices tab, updated with every status (the page itself isn't redrawn).
function updateDrvLive() {
  for (const el of $$('[data-live]')) {
    const [id, k] = el.dataset.live.split('|');
    const j = id === 'board' ? S.status?.board : S.status?.drivers?.find((x) => x.id === +id);
    if (!j) continue;
    const v = ptVal(j, k);
    const f = el.dataset.fmt;
    if (f === 'led') { el.classList.toggle('on', v === '1'); el.textContent = v === '1' ? 'on' : v === '0' ? 'off' : '?'; }
    else if (f === 'range') { if (document.activeElement !== el && v !== '') el.value = v; }
    else if (f === 'badge') { el.textContent = v || 'none'; el.className = `tag ${v === 'running' || v === 'started' ? 'mon-ok' : v === 'paused' || v === 'holding_at_end' ? 'mon-warn' : ''}`; }
    else el.textContent = v === '' ? '—' : v;
  }
  // BrightSign: the Activity list and which test button is lit.
  for (const el of $$('[data-bsact]')) {
    const j = S.status?.drivers?.find((x) => x.id === +el.dataset.bsact);
    const html = bsActHtml((j?.activity || []).slice().reverse());
    if (j && el.dataset.last !== html) { el.dataset.last = html; el.innerHTML = html; }
  }
  for (const el of $$('[data-bstest]')) {
    const [id, k, n] = el.dataset.bstest.split('|');
    const j = S.status?.drivers?.find((x) => x.id === +id);
    if (j) el.classList.toggle('on', bsTestOn(ptVal(j, k), n));
  }
  // New outputs, timelines or scenes reported by a device: redraw once, unless someone is typing.
  const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && document.activeElement.closest('#main');
  for (const el of $$('[data-livekeys]')) {
    const j = S.status?.drivers?.find((x) => x.id === +el.dataset.livekeys);
    if (j && !typing && liveKeys(j) !== el.dataset.keys) { render(); return; }
  }
}
const liveKeys = (j) => [...(j.points || []).map((p) => p.k), ...(j.scenes || []), (j.triggers || []).length, (j.states || []).length, j.info?.Model || ''].join(',');
// A zone plays a state: by itself (the state's name) or as a test ("(test) <state> (<file>)", see kdlink.brs).
const bsTestOn = (v, n) => v === n || v.startsWith(`(test) ${n} (`);
const bsActHtml = (act) => act.map(([t, s]) => `<div><span class="muted">${esc(new Date(t * 1000).toLocaleTimeString())}</span>${esc(s)}</div>`).join('')
  || '<span class="muted">Nothing received yet.</span>';

// ---- global handlers (this page's inputs aren't plain data-p paths) -----------------------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-devtab],[data-montab],[data-phtab],[data-knxadd],[data-knxpaste],[data-bscmd],[data-cmdset] button');
  if (!t) return;
  const p = P();
  if (t.dataset.devtab) { S.devTab = t.dataset.devtab; render(); }
  else if (t.dataset.phtab) { S.phTab = t.dataset.phtab; S.view === 'monitor' ? renderMonitor() : render(); }
  else if (t.dataset.montab) { S.monTab = t.dataset.montab; S.monOpen = null; render(); }
  else if (t.dataset.knxadd) {
    const d = p.drivers[+t.dataset.knxadd];
    const last = d.addresses[d.addresses.length - 1]?.ga || '1/1/0';
    const g = last.split('/').map(Number);
    g[g.length - 1]++;
    d.addresses.push({ ga: g.join('/'), dpt: '1', name: '' });
    markDirty(); render();
  } else if (t.dataset.knxpaste) {
    const d = p.drivers[+t.dataset.knxpaste], ta = $(`[data-knxlist="${t.dataset.knxpaste}"]`);
    const add = ta.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [ga, dpt, ...n] = l.split(/\s+/); return { ga, dpt: dpt || '1', name: n.join(' ') }; })
      .filter((a) => /^\d+\/\d+(\/\d+)?$/.test(a.ga) && !d.addresses.some((x) => x.ga === a.ga));
    d.addresses.push(...add);
    toast(`${add.length} group address${add.length === 1 ? '' : 'es'} added`);
    markDirty(); render();
  } else if (t.dataset.bscmd) {
    const d = p.drivers[+t.dataset.bscmd];
    d.commands.push({ name: 'Command ' + (d.commands.length + 1), text: '' });
    markDirty(); render();
  } else {
    const wrap = t.closest('[data-cmdset]'), v = $('input', wrap).value.trim();
    if (!v) return;
    const r = await cmd(wrap.dataset.cmdset.replace('{v}', 'raw' in wrap.dataset ? v : quote(v)));
    toast(r.reply, !r.ok);
  }
});
// Trigger search: filter the rows while typing (the list is redrawn with the filter later too).
document.addEventListener('input', (e) => {
  if (!('phfilter' in e.target.dataset)) return;
  S.phFilter = e.target.value;
  const f = S.phFilter.toLowerCase();
  for (const tr of $$('tr', e.target.closest('.drv-pts, .drv-live') || document).slice(1)) tr.style.display = !f || tr.textContent.toLowerCase().includes(f) ? '' : 'none';
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.cmdrange) { const r = await cmd(t.dataset.cmdrange.replace('{v}', t.value)); toast(r.reply, !r.ok); }
  else if (t.dataset.dname || t.dataset.dvar) {
    const [i, k] = (t.dataset.dname || t.dataset.dvar).split('|');
    const d = P().drivers[+i], obj = t.dataset.dname ? (d.names = d.names || {}) : (d.vars = d.vars || {});
    if (t.value.trim()) obj[k] = t.value.trim(); else delete obj[k];
    markDirty();
  } else if (t.dataset.netiomodel) {
    const d = P().drivers[+t.dataset.netiomodel], m = NETIO_MODELS.find(([c]) => c === t.value);
    if (t.value) { d.model = t.value; d.outputs = m[2]; } else { delete d.model; delete d.outputs; }   // outputs: for "output all" before the first read
    markDirty(); render();
  } else if (t.dataset.pmc) {
    // Kept sparse: only points someone named, linked or changed from the default are in the project.
    const [k, f] = t.dataset.pmc.split('|'), p = P();
    const all = (p.machineControl = p.machineControl || {}), cfg = (all[k] = all[k] || {});
    const v = t.value.trim();
    if (v && !(f === 'mode' && (v === 'in' || v === '0-10V'))) cfg[f] = v; else delete cfg[f];
    if (!Object.keys(cfg).length) delete all[k];
    if (!Object.keys(all).length) delete p.machineControl;
    markDirty();
    if (f === 'mode') render();
  } else if (t.dataset.kissframe) {
    const d = P().drivers[+t.dataset.kissframe], n = KISS_FRAMES.find(([f]) => f === t.value)[2];
    d.frame = t.value;
    d.cards = Array.from({ length: n }, (_, s) => d.cards?.[s] || '');
    markDirty(); render();
  }
});
