'use strict';
// KD Designer web UI - Devices, Panel, Variables, Schedule, Monitoring, Console, Log, DMX monitor, Settings.
// Plain scripts sharing one global scope; load order is in index.html.

function pjState(id) {
  const s = S.status?.projectors?.find((x) => x.id === id);
  if (!s || !s.seen) return { dot: '', text: s ? 'checking…' : 'not on controller (save first)', last: '' };
  if (!s.online) return { dot: 'bad', text: 'offline', last: s.last };
  return { dot: s.power === 'on' ? 'ok' : s.power === 'off' ? '' : 'warn', text: 'power ' + s.power, last: s.last };
}
const pjButtons = (ref) => `<button class="btn small" data-cmd="projector ${ref} on">On</button>
  <button class="btn small" data-cmd="projector ${ref} off">Off</button>
  <button class="btn small" data-cmd="projector ${ref} mute on">Mute</button>
  <button class="btn small" data-cmd="projector ${ref} mute off">Unmute</button>`;

const pcLast = (id) => S.status?.pcs?.find((x) => x.id === id)?.last || '—';
const pcButtons = (ref) => `<button class="btn small" data-cmd="pc ${ref} wake" title="Wake-on-LAN">⏻ Wake</button>
  <button class="btn small" data-cmd="pc ${ref} startup">Startup</button>
  <button class="btn small" data-cmd="pc ${ref} shutdown" data-confirm="Shut down ${ref === 'all' ? 'ALL PCs' : 'this PC'}?">Shutdown</button>
  <button class="btn small" data-cmd="pc ${ref} reboot" data-confirm="Reboot ${ref === 'all' ? 'ALL PCs' : 'this PC'}?">Reboot</button>`;

// Devices page: a tab per kind of device; the show-device types are in app-drivers.js.
const DEVICE_TABS = [['network', 'Network'], ['tcp', 'TCP & Modbus'], ['pcs', 'PCs'], ['projectors', 'Projectors'], ['email', 'Email'], ['board', 'Machine Control']];
const DEVICE_TAB_COUNT = { network: (p) => p.devices.length, tcp: (p) => p.tcp.length + p.modbus.length, pcs: (p) => p.pcs.length, projectors: (p) => p.projectors.length };
views.devices = () => {
  const tab = DRIVERS[S.devTab] || DEVICE_TABS.some(([k]) => k === S.devTab) ? S.devTab : 'network';
  const pages = { network: devicesNetwork, tcp: devicesTcp, pcs: devicesPcs, projectors: devicesProjectors, email: devicesEmail, board: boardPage };
  return `<h2>Devices</h2>${deviceTabs(tab)}${pages[tab] ? pages[tab](P()) : driverPage(tab)}`;
};
function devicesNetwork(p) {
  return `<h3>Network devices <span class="muted" style="text-transform:none;letter-spacing:0">UDP / OSC targets</span></h3>
  <table><tr><th>Name</th><th>IP address</th><th class="narrow">Port</th><th>Notes</th><th class="narrow" title="Ping on the Monitoring page">Monitor</th><th></th></tr>
  ${p.devices.map((d, i) => `<tr>
    <td><input data-p="devices.${i}.name" value="${esc(d.name)}" placeholder="mediaserver"></td>
    <td><input data-p="devices.${i}.ip" value="${esc(d.ip)}" pattern="^(\\d{1,3}\\.){3}\\d{1,3}$"></td>
    <td><input data-p="devices.${i}.port" data-t="num" type="number" min="1" max="65535" value="${d.port ?? ''}"></td>
    <td><input data-p="devices.${i}.notes" value="${esc(d.notes || '')}" placeholder="e.g. media server OSC (7000)"></td>
    <td style="text-align:center"><input type="checkbox" data-p="devices.${i}.monitor" data-t="bool"${d.monitor !== false ? ' checked' : ''}></td>
    <td><button class="btn small ghost" data-del="devices.${i}">✕</button></td></tr>`).join('')}</table>
  <div class="row" style="margin-top:6px"><button class="btn small" data-add="device">+ Device</button>
    <span class="muted">Use by name: <code>send osc mediaserver /play</code>, <code>send udp motors "K1P200\\r"</code>.</span></div>
  ${groupsSection('network', 'Device groups', '<code>send udp screens "PLAY\\r"</code> sends to every device in group <i>screens</i>, each on its own port. Works for <code>send osc</code> too.')}`;
}
// Device groups per kind ("kind" in deviceGroups; none = network): the group name works wherever
// a device name of that kind goes in a command (State::groupMembers in the firmware).
const groupKind = (g) => g.kind || 'network';
function groupMemberNames(kind, p = P()) {
  const list = { network: p.devices, tcp: p.tcp, pc: p.pcs, projector: p.projectors }[kind] || p.drivers.filter((d) => d.type === kind);
  return list.map((x) => x.name).filter(Boolean);
}
function groupsSection(kind, title, help) {
  const p = P(), names = groupMemberNames(kind, p), lc = (s) => String(s || '').toLowerCase();
  const rows = p.deviceGroups.map((g, i) => [g, i]).filter(([g]) => groupKind(g) === kind);
  return `<h3>${title} <span class="muted" style="text-transform:none;letter-spacing:0">one command for several at once</span></h3>
  ${rows.length ? `<table><tr><th style="width:180px">Name</th><th>Members</th><th></th></tr>
  ${rows.map(([g, i]) => {
    const clash = lc(g.name) === 'all' || names.some((n) => lc(n) === lc(g.name)) || rows.some(([x]) => x !== g && lc(x.name) === lc(g.name));
    return `<tr>
    <td><input data-p="deviceGroups.${i}.name" value="${esc(g.name)}" placeholder="screens" class="${clash ? 'invalid' : ''}" title="${clash ? 'A device or another group has this name (or it is “all”)' : ''}" data-r></td>
    <td><div class="row">${names.map((n) => `<label class="chk"><input type="checkbox" data-devgrp="${i}" value="${esc(n)}"${g.devices.includes(n) ? ' checked' : ''}>${esc(n)}</label>`).join('') || '<span class="muted">Add devices first</span>'}
      ${g.devices.filter((n) => !names.includes(n)).map((n) => `<span class="tag mon-warn" title="This device doesn't exist (any more)">${esc(n)}?</span>`).join('')}</div></td>
    <td><button class="btn small ghost" data-del="deviceGroups.${i}">✕</button></td></tr>`;
  }).join('')}</table>` : ''}
  <div class="row" style="margin-top:6px"><button class="btn small" data-add="devgroup-${kind}">+ Group</button>
    <span class="muted">${help}</span></div>`;
}
function devicesTcp(p) {
  return `<h3>TCP devices <span class="muted" style="text-transform:none;letter-spacing:0">kept connected · replies fire TCP triggers</span></h3>
  <table><tr><th>Name</th><th>IP address</th><th class="narrow">Port</th><th class="narrow" title="Added after every line you send">Line end</th><th>Status</th><th>Last received</th><th></th></tr>
  ${p.tcp.map((d, i) => {
    const st = S.status?.io?.tcp?.find((x) => x.name === d.name);
    return `<tr>
    <td><input data-p="tcp.${i}.name" value="${esc(d.name)}" data-r></td>
    <td><input data-p="tcp.${i}.ip" value="${esc(d.ip)}"></td>
    <td><input data-p="tcp.${i}.port" data-t="num" type="number" min="1" max="65535" value="${d.port ?? ''}"></td>
    <td><select data-p="tcp.${i}.eol">${[['\\r\\n', 'CR LF'], ['\\r', 'CR'], ['\\n', 'LF'], ['', 'none']].map(([v, n]) => `<option value="${esc(v)}"${(d.eol ?? '\\r\\n') === v ? ' selected' : ''}>${n}</option>`).join('')}</select></td>
    <td data-iost="tcp:${esc(d.name)}"><span class="dot ${st?.state === 'online' ? 'ok' : st?.state === 'offline' ? 'bad' : ''}"></span>${esc(st?.state || 'save first')}</td>
    <td class="mono muted" style="max-width:240px;overflow:hidden;text-overflow:ellipsis">${esc(st?.lastLine || '—')}</td>
    <td><button class="btn small ghost" data-del="tcp.${i}">✕</button></td></tr>`;
  }).join('')}</table>
  <div class="row" style="margin-top:6px"><button class="btn small" data-add="tcpdev">+ TCP device</button>
    <span class="muted"><code>send tcp watchout run</code> · trigger "TCP message received" · HTTP needs no setup: <code>http get http://10.0.0.20/api/play</code></span></div>
  ${groupsSection('tcp', 'TCP groups', '<code>send tcp walls run</code> sends to every TCP device in group <i>walls</i>.')}
  <h3>Modbus TCP <span class="muted" style="text-transform:none;letter-spacing:0">PLCs · link points to variables</span></h3>
  <table><tr><th>Name</th><th>IP address</th><th class="narrow">Port</th><th class="narrow">Unit ID</th><th class="narrow">Poll (ms)</th><th>Linked variables</th><th>Status</th><th></th></tr>
  ${p.modbus.map((d, i) => {
    const st = S.status?.io?.modbus?.find((x) => x.name === d.name);
    const linked = p.variables.filter((v) => v.modbus?.device === d.name).map((v) => `${v.name} (${v.modbus.table} ${v.modbus.address})`);
    return `<tr>
    <td><input data-p="modbus.${i}.name" value="${esc(d.name)}" data-r></td>
    <td><input data-p="modbus.${i}.ip" value="${esc(d.ip)}"></td>
    <td><input data-p="modbus.${i}.port" data-t="num" type="number" value="${d.port ?? 502}"></td>
    <td><input data-p="modbus.${i}.unit" data-t="num" type="number" min="0" max="255" value="${d.unit ?? 1}"></td>
    <td><input data-p="modbus.${i}.pollMs" data-t="num" type="number" min="50" step="50" value="${d.pollMs ?? 500}"></td>
    <td class="muted">${linked.length ? esc(linked.join(', ')) : 'none - link them on the Variables page'}</td>
    <td data-iost="modbus:${esc(d.name)}"><span class="dot ${st?.state === 'online' ? 'ok' : st?.state === 'offline' ? 'bad' : ''}"></span>${esc(st?.state || 'save first')}${st?.errors ? ` <span class="muted">(${st.errors} errors)</span>` : ''}</td>
    <td><button class="btn small ghost" data-del="modbus.${i}">✕</button></td></tr>`;
  }).join('')}</table>
  <div class="row" style="margin-top:6px"><button class="btn small" data-add="mbdev">+ Modbus device</button>
    <span class="muted">Raw write: <code>modbus plc write coil 5 1</code></span></div>`;
}
function devicesPcs(p) {
  return `<h3>PCs <span class="muted" style="text-transform:none;letter-spacing:0">Wake-on-LAN + UDP commands</span></h3>
  <table><tr><th class="narrow">ID</th><th>Name</th><th>IP address</th><th>MAC address</th><th class="narrow">UDP port</th><th>Commands sent (startup · shutdown · reboot)</th><th class="narrow" title="Ping on the Monitoring page">Monitor</th><th>Last</th><th>Control</th><th></th></tr>
  ${p.pcs.map((x, i) => `<tr>
    <td><input data-p="pcs.${i}.id" data-t="num" type="number" min="1" value="${x.id}" data-r></td>
    <td><input data-p="pcs.${i}.name" value="${esc(x.name)}"></td>
    <td><input data-p="pcs.${i}.ip" value="${esc(x.ip)}" pattern="^(\\d{1,3}\\.){3}\\d{1,3}$"></td>
    <td><input data-p="pcs.${i}.mac" value="${esc(x.mac || '')}" placeholder="00:11:22:33:44:55" pattern="^([0-9A-Fa-f]{2}[:\\-]?){5}[0-9A-Fa-f]{2}$" class="mono"></td>
    <td><input data-p="pcs.${i}.port" data-t="num" type="number" min="1" max="65535" value="${x.port ?? 7}"></td>
    <td><div class="row nowrap">${['startup', 'shutdown', 'reboot'].map((k) => `<input data-p="pcs.${i}.${k}" value="${esc(x[k] ?? k)}" title="Text sent for '${k}'" class="mono" style="width:90px">`).join('')}</div></td>
    <td style="text-align:center"><input type="checkbox" data-p="pcs.${i}.monitor" data-t="bool"${x.monitor !== false ? ' checked' : ''}></td>
    <td class="muted" data-pcst="${x.id}">${esc(pcLast(x.id))}</td>
    <td><div class="row nowrap">${pcButtons(x.id)}</div></td>
    <td><button class="btn small ghost" data-del="pcs.${i}">✕</button></td></tr>`).join('')}</table>
  <div class="row" style="margin-top:6px"><button class="btn small" data-add="pc">+ PC</button>
    ${p.pcs.length ? `<span class="muted">All PCs:</span>${pcButtons('all')}` : ''}</div>
  <p class="muted">Wake-on-LAN is broadcast on the controller's subnet (ports 9 and 7). Enable WoL in the PC's BIOS and network card.
    Use in triggers: <code>pc 1 wake</code>, <code>pc all shutdown</code>, <code>pc "Media PC" reboot</code>.</p>
  ${groupsSection('pc', 'PC groups', '<code>pc foyer wake</code> wakes every PC in group <i>foyer</i>.')}`;
}
function devicesEmail(p) {
  return `<h3>Email <span class="muted" style="text-transform:none;letter-spacing:0">plain SMTP, no TLS</span></h3>
  <div class="form">
    <label>SMTP server</label><input data-p="email.server" value="${esc(p.email.server)}" placeholder="IP or hostname of a mail relay">
    <label>Port</label><input type="number" data-p="email.port" data-t="num" value="${p.email.port}">
    <label>Username</label><input data-p="email.user" value="${esc(p.email.user)}" placeholder="leave empty for no login" autocomplete="off">
    <label>Password</label><input type="password" data-p="email.password" value="${esc(p.email.password)}" autocomplete="new-password">
    <label>From address</label><input data-p="email.from" value="${esc(p.email.from)}" placeholder="show@example.com">
    <label></label><span class="muted">Send with <code>email someone@example.com "Floor fault" Frequency drive reports a fault</code>.
      Needs a server that accepts unencrypted SMTP, e.g. a local relay.</span>
  </div>`;
}
function devicesProjectors(p) {
  return `<h3>Projectors <span class="muted" style="text-transform:none;letter-spacing:0">PJLink · TCP 4352</span></h3>
  <table><tr><th class="narrow">ID</th><th>Name</th><th>IP address</th><th class="narrow">Port</th><th>Password</th><th title="How the command words are sent. PJLink says upper case; some projectors only answer lower case.">Commands</th><th>Status</th><th>Control</th><th></th></tr>
  ${p.projectors.map((x, i) => {
    const st = pjState(x.id);
    return `<tr>
    <td><input data-p="projectors.${i}.id" data-t="num" type="number" min="1" value="${x.id}" data-r></td>
    <td><input data-p="projectors.${i}.name" value="${esc(x.name)}"></td>
    <td><input data-p="projectors.${i}.ip" value="${esc(x.ip)}" pattern="^(\\d{1,3}\\.){3}\\d{1,3}$"></td>
    <td><input data-p="projectors.${i}.port" data-t="num" type="number" min="1" max="65535" value="${x.port ?? 4352}"></td>
    <td><input data-p="projectors.${i}.password" type="password" value="${esc(x.password || '')}" placeholder="none" autocomplete="new-password"></td>
    <td><select data-p="projectors.${i}.lowercase" data-t="bool-sel" title="PJLink says upper case (%1POWR 1); some projectors only answer lower case (%1powr 1)">
      <option value="0"${x.lowercase ? '' : ' selected'}>UPPER case</option><option value="1"${x.lowercase ? ' selected' : ''}>lower case</option></select></td>
    <td data-pjst="${x.id}" title="${esc(st.last)}"><span class="dot ${st.dot}"></span>${esc(st.text)}</td>
    <td><div class="row nowrap">${pjButtons(x.id)}</div></td>
    <td><button class="btn small ghost" data-del="projectors.${i}">✕</button></td></tr>`;
  }).join('')}</table>
  <div class="row" style="margin-top:6px"><button class="btn small" data-add="projector">+ Projector</button>
    <span class="muted">Checked at the Monitoring page's interval (power, lamp, input, errors). Hover a status for the last reply. Save before testing a new projector.</span></div>
  <h3>All projectors</h3><div class="row">${pjButtons('all')}</div>
  ${groupsSection('projector', 'Projector groups', '<code>projector zaal1 on</code> switches on every projector in group <i>zaal1</i>; every projector command works on a group.')}
  <h3>Raw command</h3>
  <div class="row nowrap"><input class="cmd" id="pjRaw" value="projector all send LAMP ?" spellcheck="false" autocomplete="off"><button class="btn" id="pjSend">Send</button></div>
  <p class="muted">In triggers: <code>projector 1 on</code>, <code>projector all off</code>, <code>projector "Left" input 31</code>, <code>projector 2 mute on</code>.</p>`;
}
views.devices.after = () => {
  $$('[data-devgrp]').forEach((el) => el.addEventListener('change', () => {
    const g = P().deviceGroups[+el.dataset.devgrp];
    g.devices = el.checked ? [...new Set([...g.devices, el.value])] : g.devices.filter((n) => n !== el.value);
    markDirty();
  }));
  if (DRIVERS[S.devTab]) return driverPageAfter();
  $('#pjSend')?.addEventListener('click', async () => { const r = await cmd($('#pjRaw').value); toast(r.reply, !r.ok); });
};
function renderProjectorStates() {
  for (const td of $$('[data-pcst]')) td.textContent = pcLast(+td.dataset.pcst);
  for (const td of $$('[data-iost]')) {
    const [kind, name] = td.dataset.iost.split(/:(.*)/);
    const st = S.status?.io?.[kind]?.find((x) => x.name === name);
    td.innerHTML = `<span class="dot ${st?.state === 'online' ? 'ok' : st?.state === 'offline' ? 'bad' : ''}"></span>${esc(st?.state || 'save first')}${st?.errors ? ` <span class="muted">(${st.errors} errors)</span>` : ''}`;
  }
  for (const td of $$('[data-pjst]')) {
    const st = pjState(+td.dataset.pjst);
    td.title = st.last;
    td.innerHTML = `<span class="dot ${st.dot}"></span>${esc(st.text)}`;
  }
  for (const td of $$('[data-drvst]')) {
    const st = drvState(+td.dataset.drvst);
    td.title = st.last;
    td.innerHTML = `<span class="dot ${st.dot}"></span>${esc(st.text)}`;
  }
  updateDrvLive();
}

// The panel being edited (S.sel.panel) - there can be several, e.g. technician and operator.
const curPanel = () => { const l = P().panel.panels; return l[Math.min(S.sel.panel || 0, l.length - 1)]; };
views.panel = () => {
  const p = P(), all = p.panel.pages, pn = curPanel(), si = p.panel.panels.indexOf(pn);
  // Pages of this panel, with their index in panel.pages (paths and S.sel.page use that).
  const pages = all.map((x, i) => ({ x, i })).filter(({ x }) => x.panel === pn.id);
  if (!pages.some(({ i }) => i === S.sel.page)) S.sel.page = pages[0]?.i ?? 0;
  const pi = S.sel.page, pg = pages.length ? all[pi] : null;
  const base = `panel.pages.${pi}`;
  const pageOpts = (sel) => `<option value="">—</option>${pages.map(({ x }) => `<option value="${x.id}"${x.id === sel ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}`;
  return `<h2>Touch panels</h2>
  <div class="row ptabs">${p.panel.panels.map((x, k) => `<button class="btn small${k === si ? ' primary' : ''}" data-sel="panel:${k}">${esc(x.name || 'Panel ' + x.id)}</button>`).join('')}
    <button class="btn small ghost" data-add="panelset" title="Another panel, e.g. one for the operator and one for the technician">+ Panel</button></div>
  <p class="muted">A full-screen control page for a tablet or touchscreen at <code>http://&lt;controller&gt;${panelUrl(pn)}</code>${si === 0 ? ' (or just <code>/panel</code>)' : ''}.
    Buttons, toggles, sliders, dials, colour wheels and XY pads fire <b>Panel button</b> triggers (sliders and co. with <code>{value}</code>); they can also set variables directly (a colour wheel or XY pad one per part).
    Actions change any control by its name: <code>panel &lt;name&gt; flash on</code>, <code>panel &lt;name&gt; text …</code>, <code>color</code>, <code>value</code>, <code>disable</code>, <code>lock</code> / <code>unlock</code> (can't be touched, still looks normal), <code>reset</code>.</p>
  <div class="form" style="margin-bottom:12px">
    <label>Panel name</label><div class="row"><input data-p="panel.panels.${si}.name" value="${esc(pn.name || '')}" placeholder="Panel ${pn.id}" data-r>
      <a class="btn small" href="${panelUrl(pn)}" target="_blank" style="text-decoration:none">Open panel ↗</a>
      ${p.panel.panels.length > 1 ? `<button class="btn small ghost" data-pdel="${si}" title="Delete this panel and its pages">Delete panel</button>` : ''}</div>
    <label>Title</label><input data-p="panel.panels.${si}.title" value="${esc(pn.title || '')}" placeholder="${esc(p.name)}" title="Shown at the top of the panel">
    <label>Start page</label><select data-p="panel.panels.${si}.start" data-t="num">${pageOpts(pn.start)}</select>
  </div>
  ${panelThemeHtml(p.panel.theme)}
  <div class="split">
    <div><div class="list">${pages.map(({ x, i }) => `<div class="item${i === pi ? ' sel' : ''}" data-sel="page:${i}"><span class="id">${x.id}</span><span style="flex:1">${esc(x.name)}</span>${x.pin ? '<span class="tag">PIN</span>' : ''}</div>`).join('')}</div>
    <div class="row" style="margin-top:8px"><button class="btn small" data-add="page">+ Page</button></div></div>
    <div>${pg ? `
      <div class="row"><input data-p="${base}.name" value="${esc(pg.name)}" style="font-size:16px;flex:1">
        <button class="btn small ghost" data-del="${base}">Delete page</button></div>
      <div class="row" style="margin-top:10px">
        <label class="muted">Columns</label><input type="number" min="1" max="12" style="width:70px" data-p="${base}.columns" data-t="num" value="${pg.columns || 3}" data-r>
        <label class="muted" title="Ask for this PIN before showing the page">PIN</label><input style="width:110px" data-p="${base}.pin" value="${esc(pg.pin || '')}" placeholder="none" inputmode="numeric">
        ${p.panel.panels.length > 1 ? `<label class="muted" title="Move this page to another panel">Panel</label><select data-p="${base}.panel" data-t="num" data-r>${p.panel.panels.map((x) => `<option value="${x.id}"${x.id === pg.panel ? ' selected' : ''}>${esc(x.name || 'Panel ' + x.id)}</option>`).join('')}</select>` : ''}
        ${pg.controls.some((c) => c.col) ? '<button class="btn small ghost" data-pauto title="Forget where controls were dragged to: they fill the page in list order again">Auto layout</button>' : ''}
      </div>
      <table class="ptable" style="margin-top:10px"><tr><th class="psel" title="Click a number to select (Ctrl+click: add one, Shift+click: a range)">#</th><th style="width:96px">Type</th><th>Name (for triggers/labels)</th><th>Text</th><th class="narrow" title="Empty = the theme colour">Colour</th><th>Confirm question</th><th class="narrow">Go to page</th><th class="narrow" title="Columns wide × rows high">Size</th><th></th></tr>
      ${pg.controls.map((c, i) => {
        const cb = `${base}.controls.${i}`;
        const btn = c.type === 'button' || c.type === 'toggle', named = c.type !== 'spacer' && c.type !== 'clock';
        const own = c.type !== 'spacer' && c.type !== 'color', picked = pSel().has(c) ? ' class="p-row"' : '';
        return `<tr data-ci="${i}"${picked}>
        <td class="psel" title="Click to select (Ctrl+click: add one, Shift+click: a range)">${i + 1}</td>
        <td><select data-p="${cb}.type" data-r>${PANEL_TYPES.map((t) => `<option${c.type === t ? ' selected' : ''}>${t}</option>`).join('')}</select></td>
        <td>${named ? `<input data-p="${cb}.name" value="${esc(c.name || '')}" data-r>` : ''}</td>
        <td>${named ? `<input data-p="${cb}.text" value="${esc(c.text || '')}" data-r>` : ''}</td>
        <td>${own ? `<div class="row nowrap"><input type="color" data-p="${cb}.color" value="${esc(c.color || panelThemeColor(p.panel.theme, c.type))}" data-r>${c.color
          ? `<button class="btn small ghost" data-pclr="${i}" title="Use the theme colour again">✕</button>` : '<span class="muted" style="font-size:11px" title="Comes from the theme; pick a colour to override it">theme</span>'}</div>` : ''}</td>
        <td>${btn ? `<input data-p="${cb}.confirm" value="${esc(c.confirm || '')}" placeholder="none" data-r>` : ''}</td>
        <td>${btn ? `<select data-p="${cb}.goto" data-t="num" data-r>${pageOpts(c.goto)}</select>` : ''}</td>
        <td><div class="row nowrap psize"><input type="number" min="1" max="12" data-p="${cb}.span" data-t="num" value="${c.span || 1}" title="Columns wide" data-r><span class="muted">×</span><input type="number" min="1" max="20" data-p="${cb}.rows" data-t="num" value="${c.rows || ''}" placeholder="${panelRows(c)}" title="Rows high" data-r></div></td>
        <td><div class="row nowrap"><button class="btn small ghost" data-pmove="${i}:-1">▲</button><button class="btn small ghost" data-pmove="${i}:1">▼</button><button class="btn small ghost" data-del="${cb}">✕</button></div></td></tr>
        ${named || c.col ? `<tr class="psub${picked ? ' p-row' : ''}"><td></td><td></td><td colspan="7">${panelCtlDetails(c, cb, i)}</td></tr>` : ''}`;
      }).join('')}</table>
      <div class="row" style="margin-top:8px">${PANEL_TYPES.map((t) => `<button class="btn small" data-add="pc-${t}">+ ${t === 'color' ? 'colour wheel' : t === 'xy' ? 'XY pad' : t}</button>`).join('')}</div>
      <h3>Preview <span class="muted" style="font-weight:normal;font-size:12px;text-transform:none">live (shows what actions set) · drag a control to move it, its corner to resize it · drag a group to move it with everything in it · click to select, Ctrl+click for more, then drag them together (Delete removes, Esc deselects, Ctrl+A all)</span></h3>
      <div class="panel-preview" style="${panelThemeVars(p.panel.theme)}">${panelPageHtml(pg, S.status, true, p.panel.theme)}</div>`
    : '<span class="muted">Add a page to start.</span>'}</div></div>`;
};
// Selected panel controls: the control objects themselves, so they stay selected when the list
// is reordered (a deleted one simply isn't on the page any more).
const pSel = () => (S.pSel ||= new Set());
// Marks the selection in the list and the preview, without a render (keeps the scroll).
function pSelShow(pg) {
  $$('tr[data-ci]').forEach((tr) => {
    const on = pSel().has(pg.controls[+tr.dataset.ci]);
    tr.classList.toggle('p-row', on);
    if (tr.nextElementSibling?.classList.contains('psub')) tr.nextElementSibling.classList.toggle('p-row', on);
  });
  $$('.panel-preview [data-i]').forEach((el) => el.classList.toggle('p-picked', pSel().has(pg.controls[+el.dataset.i])));
}
// Click on control i: only it; Ctrl: add/remove it; Shift (in the list): the range from the last click.
function pSelect(pg, i, e, list) {
  const c = pg.controls[i];
  if (list && e.shiftKey && pg.controls[S.pAnchor]) {
    const [a, b] = [S.pAnchor, i].sort((x, y) => x - y);
    for (let k = a; k <= b; k++) pSel().add(pg.controls[k]);
  } else {
    if (e.ctrlKey || e.metaKey || e.shiftKey) { if (!pSel().delete(c)) pSel().add(c); } else S.pSel = new Set([c]);
    S.pAnchor = i;
  }
  pSelShow(pg);
}
views.panel.keys = (e) => {
  const pg = P().panel.pages[S.sel.page || 0];
  if (!pg || pg.panel !== curPanel().id) return;   // this panel has no pages yet
  const sel = pg.controls.filter((c) => pSel().has(c));
  if (e.key === 'Escape' && pSel().size) { pSel().clear(); pSelShow(pg); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); S.pSel = new Set(pg.controls); pSelShow(pg); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) {
    e.preventDefault();
    pg.controls = pg.controls.filter((c) => !pSel().has(c));
    pSel().clear();
    markDirty();
    render();
  }
};
views.panel.after = () => {
  const p = P(), box = $('.panel-preview'), pg = p.panel.pages[S.sel.page || 0];
  if (box && pg && pg.panel === curPanel().id) {
    // Faster when a control follows a timeline, so its bar runs smoothly.
    pagePoll('panelPreview', () => panelUpdate(box, pg, S.status), pg.controls.some((c) => c.follow) ? 200 : 500);
    panelEditor(box, pg);
    pSelShow(pg);
  }
  // The list: a click on the number or an empty part of a row selects it; going into one of its
  // fields selects it too (unless it already is).
  const tbl = $('table.ptable');
  const rowOf = (el) => { const tr = el.closest('tr'); return tr?.classList.contains('psub') ? tr.previousElementSibling : tr; };
  tbl?.addEventListener('click', (e) => {
    if (e.target.closest('input,select,button,a,textarea,label')) return;
    const tr = rowOf(e.target);
    if (tr?.dataset.ci) pSelect(pg, +tr.dataset.ci, e, true);
  });
  tbl?.addEventListener('focusin', (e) => {
    const tr = rowOf(e.target), c = tr?.dataset.ci && pg.controls[+tr.dataset.ci];
    if (c && !pSel().has(c)) { S.pSel = new Set([c]); S.pAnchor = +tr.dataset.ci; pSelShow(pg); }
  });
  const det = $('details.ptheme');
  det?.addEventListener('toggle', () => (S.panelThemeOpen = det.open));
  $$('[data-ptheme]').forEach((b) => b.addEventListener('click', () => {
    // A preset sets the colours and keeps the sizes.
    const keep = Object.fromEntries(['radius', 'gap', 'row', 'font', 'width'].filter((k) => p.panel.theme[k] != null).map((k) => [k, p.panel.theme[k]]));
    p.panel.theme = b.dataset.ptheme === 'reset' ? {} : { ...PANEL_THEMES[b.dataset.ptheme], ...keep };
    markDirty();
    render();
  }));
  $$('[data-pclr]').forEach((b) => b.addEventListener('click', () => { delete pg.controls[+b.dataset.pclr].color; markDirty(); render(); }));
  $('[data-pdel]')?.addEventListener('click', (e) => {
    const k = +e.currentTarget.dataset.pdel, pn = p.panel.panels[k], n = p.panel.pages.filter((x) => x.panel === pn.id).length;
    if (!confirm(`Delete panel '${pn.name}'${n ? ` and its ${n} page(s)` : ''}?`)) return;
    p.panel.pages = p.panel.pages.filter((x) => x.panel !== pn.id);
    p.panel.panels.splice(k, 1);
    S.sel.panel = 0;
    markDirty();
    render();
  });
  $('[data-pauto]')?.addEventListener('click', () => { pg.controls.forEach((c) => { delete c.col; delete c.row; }); markDirty(); render(); });
};
// The panel theme: what every control looks like unless it has its own colour.
function panelThemeHtml(theme) {
  const th = panelTheme(theme);
  const colors = [['bg', 'Background'], ['button', 'Buttons'], ['buttonText', 'Button text'], ['toggle', 'Toggle when on'], ['accent', 'Sliders and dials'],
    ['label', 'Labels and clock'], ['card', 'Cards (slider, dial, wheel)'], ['border', 'Card border'], ['text', 'Card text'], ['muted', 'Values'], ['track', 'Slider and dial track']];
  const sizes = [['font', 'Text size', 'px'], ['row', 'Row height', 'px'], ['gap', 'Space between', 'px'], ['radius', 'Rounded corners', 'px'], ['width', 'Page width', 'px, 0 = whole screen']];
  return `<details class="ptheme"${S.panelThemeOpen ? ' open' : ''}><summary>Theme <span class="muted">· how all controls look, unless a control has its own colour${Object.keys(theme || {}).length ? '' : ' (default)'}</span></summary>
    <div class="row" style="margin:8px 0">${Object.keys(PANEL_THEMES).map((n) => `<button class="btn small" data-ptheme="${n}">${n}</button>`).join('')}
      <button class="btn small ghost" data-ptheme="reset" title="Back to the default theme, sizes too">Reset</button></div>
    <div class="ptheme-grid">${colors.map(([k, l]) => `<label><input type="color" data-p="panel.theme.${k}" value="${esc(th[k])}" data-r> ${l}</label>`).join('')}
      ${sizes.map(([k, l, u]) => `<label><input type="number" min="0" data-p="panel.theme.${k}" data-t="num" value="${theme?.[k] ?? ''}" placeholder="${PANEL_THEME[k]}" data-r> ${l} <span class="muted">${u}</span></label>`).join('')}</div>
  </details>`;
}
// Dragging in the preview: a control moves to another place in the grid, its corner grip
// resizes it (columns × rows). The first move pins every control on the page where it is now
// (col/row), so the others stay put; "Auto layout" forgets that again.
function panelEditor(box, pg) {
  const grid = box.querySelector('.pgrid');
  grid.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-i]');
    if (!el || e.button !== 0) return;
    e.preventDefault();
    const i = +el.dataset.i, c = pg.controls[i], cols = pg.columns || 3, resize = !!e.target.closest('.pgrip');
    const cs = getComputedStyle(grid), gx = parseFloat(cs.columnGap) || 0, gy = parseFloat(cs.rowGap) || 0;
    const colW = cs.gridTemplateColumns.split(' ').map(parseFloat), rowH = cs.gridTemplateRows.split(' ').map(parseFloat);
    const rowDef = +panelTheme(P().panel.theme).row || 84;
    // Track number (1-based) at a position in CSS px; below the last row the rows go on.
    const track = (sizes, gap, pos, more) => {
      let x = 0;
      for (let k = 0; k < sizes.length; k++) { if (pos < x + sizes[k] + gap / 2) return k + 1; x += sizes[k] + gap; }
      return sizes.length + 1 + (more ? Math.max(0, Math.floor((pos - x) / (more + gap))) : 0);
    };
    const at = (ev) => {
      const r = grid.getBoundingClientRect(), z = uiZoom();
      return { col: Math.min(cols, track(colW, gx, (ev.clientX - r.left) / z)), row: track(rowH, gy, (ev.clientY - r.top) / z, rowDef) };
    };
    // Where everything is now, pinned so moving one control doesn't shuffle the rest.
    const pos = [...grid.querySelectorAll('[data-i]')].map((x) => {
      const k = +x.dataset.i, cc = pg.controls[k];
      const p = { k, el: x, col: track(colW, gx, x.offsetLeft + 1), row: track(rowH, gy, x.offsetTop + 1), span: Math.min(cc.span || 1, cols), rows: Math.max(1, cc.rows || panelRows(cc)),
        was: [x.style.gridColumn, x.style.gridRow] };
      x.style.gridColumn = `${p.col} / span ${p.span}`;
      x.style.gridRow = `${p.row} / span ${p.rows}`;
      return p;
    });
    const me = pos.find((x) => x.k === i), start = at(e), now = { ...me };
    // Groups: whatever lies wholly inside a group's frame belongs to it (panelParents: the smallest
    // group; groups can hold groups) and moves along when the group is dragged. For a dragged
    // control groups are background: they don't push it away and aren't pushed, so a control can
    // be dropped into one.
    const isGroup = (x) => pg.controls[x.k].type === 'group';
    const inside = (x, g) => x.col >= g.col && x.col + x.span <= g.col + g.span && x.row >= g.row && x.row + x.rows <= g.row + g.rows;
    for (const x of pos) x.group = isGroup(x);
    const owner = panelParents(pos);
    const within = (x, g) => { for (let p = owner.get(x.k); p; p = owner.get(p.k)) if (p === g) return true; return false; };
    const members = (g) => pos.filter((x) => within(x, g));   // everything in it, also in groups in it
    // Dragging a selected control moves the whole selection; the rest of what moves along (other
    // selected controls, what's in selected groups) is the crew.
    const sel = !resize && pSel().has(c) ? pos.filter((x) => pSel().has(pg.controls[x.k])) : [me];
    const crew = resize ? [] : [...new Set([...sel, ...sel.filter(isGroup).flatMap(members)])].filter((x) => x !== me);
    const movers = [me, ...crew];
    // How far they can go together: all stay within the columns and below the top.
    const loC = Math.max(...movers.map((x) => 1 - x.col)), hiC = Math.min(...movers.map((x) => cols - x.span + 1 - x.col)), loR = Math.max(...movers.map((x) => 1 - x.row));
    el.setPointerCapture(e.pointerId);
    el.classList.add('p-moving');
    const move = (ev) => {
      const a = at(ev);
      if (resize) {
        now.span = Math.max(1, Math.min(cols - me.col + 1, a.col - me.col + 1));
        now.rows = Math.max(1, a.row - me.row + 1);
      } else {
        now.col = me.col + Math.max(loC, Math.min(hiC, a.col - start.col));
        now.row = me.row + Math.max(loR, a.row - start.row);
      }
      el.style.gridColumn = `${now.col} / span ${now.span}`;
      el.style.gridRow = `${now.row} / span ${now.rows}`;
      for (const x of crew) {
        x.el.style.gridColumn = `${x.col + now.col - me.col} / span ${x.span}`;
        x.el.style.gridRow = `${x.row + now.row - me.row} / span ${x.rows}`;
      }
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.classList.remove('p-moving');
      if (now.col === me.col && now.row === me.row && now.span === me.span && now.rows === me.rows) {
        // Just a click: put every control back as it was (its own size and place) and select it
        // (Ctrl: add/remove it) - without a render, so the preview stays where it is.
        pos.forEach((x) => { [x.el.style.gridColumn, x.el.style.gridRow] = x.was; });
        pSelect(pg, i, e);
        return;
      }
      if (!resize && !pSel().has(c)) S.pSel = new Set([c]);   // dragging an unselected control selects it
      // Controls it now covers move down, top to bottom, until they are free again.
      const hit = (a, b) => a.col < b.col + b.span && b.col < a.col + a.span && a.row < b.row + b.rows && b.row < a.row + a.rows;
      const dc = now.col - me.col, dr = now.row - me.row;
      for (const x of crew) { x.col += dc; x.row += dr; }
      const moving = new Set(movers), landed = [now, ...crew];
      // What can be pushed, each as one block: moved groups push what they land on (a group with
      // all that's in it), but not the groups they land inside; moved controls push only other
      // controls; a resized group nothing.
      let blocks;
      if (resize && isGroup(me)) blocks = [];
      else if (!movers.some(isGroup)) blocks = pos.filter((x) => !moving.has(x) && !isGroup(x)).map((x) => ({ box: x, items: [x] }));
      else {
        const free = pos.filter((x) => !moving.has(x) && !(isGroup(x) && landed.some((m) => inside(m, x))));
        const top = free.filter((x) => !free.some((g) => g !== x && within(x, g)));   // not inside another free one
        // (A group something was dragged out of keeps only the rest.)
        blocks = top.map((x) => ({ box: x, items: isGroup(x) ? [x, ...members(x).filter((y) => !moving.has(y))] : [x] }));
      }
      const placed = [...landed];
      for (const b of blocks.sort((a, b2) => a.box.row - b2.box.row || a.box.col - b2.box.col)) {
        let d = 0;
        while (placed.some((q) => hit(q, { ...b.box, row: b.box.row + d }))) d++;
        for (const x of new Set(b.items)) x.row += d;
        placed.push(b.box);
      }
      for (const x of pos) if (x.k !== i) Object.assign(pg.controls[x.k], { col: x.col, row: x.row });
      Object.assign(c, { col: now.col, row: now.row, span: now.span });
      if (resize) c.rows = now.rows;
      markDirty();
      render();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up, { once: true });
  });
}
// The second line under a control: range / variable / height, and the triggers it fires and
// the ones whose actions change it ("link knobs to triggers").
function panelCtlDetails(c, cb, i) {
  const p = P(), name = (c.name || '').toLowerCase();
  const num = (k, ph, title) => `<input type="number" step="any" data-p="${cb}.${k}" data-t="num" value="${c[k] ?? ''}" placeholder="${ph}" title="${title}" data-r>`;
  const parts = [];
  if (c.type === 'color' || c.type === 'xy') c.links = c.links || {};   // so the link selects can bind
  // A variable to link to; "Moving the control sets it; when it changes, the control follows".
  const varSel = (path, val, label, title) => `<span class="muted" title="${esc(title || 'Moving the control sets this variable; when the variable changes, the control follows')}">${label}</span>
    <select data-p="${cb}.${path}" data-r><option value="">—</option>${p.variables.map((v) => `<option${val === v.name ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select>`;
  const step = `<span class="muted">step</span>${num('step', 1, 'Steps the value moves in, e.g. 0.1 or 0.01 for decimals (0 = smooth)')}
      <span class="muted">unit</span><input data-p="${cb}.unit" value="${esc(c.unit || '')}" placeholder="%" style="width:44px" data-r>`;
  const followSel = (title) => `<span class="muted" title="${esc(title)}">Follow timeline</span>
      <select data-p="${cb}.follow" data-t="num" data-r><option value="">—</option>${p.timelines.map((t) => `<option value="${t.id}"${+c.follow === t.id ? ' selected' : ''}>${t.id} ${esc(t.name || '')}</option>`).join('')}</select>`;
  const timeSel = () => `<select data-p="${cb}.timeShow" data-r title="How the time is shown">${[['', '1:23 / 5:00'], ['elapsed', '1:23 (played)'], ['left', '-3:37 (left)']]
    .map(([v, t]) => `<option value="${v}"${(c.timeShow || '') === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  if (c.type === 'slider' || c.type === 'dial') {
    parts.push(`<span class="muted">Range</span>${num('min', 0, 'Lowest value')}<span class="muted">to</span>${num('max', 100, 'Highest value')} ${step}`);
    if (c.type === 'slider') parts.push(`<label class="chk"><input type="checkbox" data-p="${cb}.vertical" data-t="bool"${c.vertical ? ' checked' : ''} data-r> vertical</label>`);
    parts.push(followSel("Show how far this timeline is: start of the range at its start, end of the range at its end. Without a unit it shows the time (1:23 / 5:00). It can't be touched then.")
      + (c.follow && !c.unit ? ' ' + timeSel() : ''));
  }
  if (c.type === 'group') {
    parts.push(`<label class="chk" style="white-space:nowrap" title="Show the group's text as a title in the top of its frame"><input type="checkbox" data-p="${cb}.showTitle" data-t="bool"${c.showTitle !== false ? ' checked' : ''} data-r> title</label>`);
  }
  if (c.type === 'label') {
    parts.push(followSel('Show the time of this timeline, after the label text (e.g. "Main show 1:23 / 5:00")') + (c.follow ? ' ' + timeSel() : ''));
    if (!c.follow) parts.push(varSel('var', c.var, 'Variable', 'Show the value of this variable, after the label text (e.g. "Visitors: 42")'));
  }
  if (c.type === 'xy') {
    parts.push(`<span class="muted">X</span>${num('min', 0, 'Left')}<span class="muted">to</span>${num('max', 100, 'Right')}
      <span class="muted">Y</span>${num('ymin', 0, 'Bottom')}<span class="muted">to</span>${num('ymax', 100, 'Top')} ${step}`);
    parts.push(`${varSel('links.x', c.links.x, 'X variable')} ${varSel('links.y', c.links.y, 'Y variable')}`);
  }
  const following = c.follow && (c.type === 'slider' || c.type === 'dial');   // then no variable and always display only (labels: above)
  if ((c.type === 'toggle' || c.type === 'slider' || c.type === 'dial') && !following) parts.push(varSel('var', c.var, 'Variable'));
  if (c.type === 'color') {
    const L = c.links;
    parts.push(`${varSel('links.r', L.r, 'Red')} ${varSel('links.g', L.g, 'Green')} ${varSel('links.b', L.b, 'Blue')}
      <select data-p="${cb}.rgbScale" data-t="num" title="Range of the red, green and blue variables" data-r><option value="">0-255</option><option value="100"${c.rgbScale === 100 ? ' selected' : ''}>0-100 %</option></select>`);
    parts.push(`${varSel('links.h', L.h, 'Hue', 'Colour on the wheel, 0-360°')} ${varSel('links.s', L.s, 'Saturation', '0 = white, 100 = full colour')} ${varSel('links.v', L.v, 'Brightness', '0-100 (the bar under the wheel)')}`);
    parts.push(varSel('var', c.var, 'Whole colour', 'A text variable that gets #rrggbb'));
  }
  if (['button', ...PANEL_VALUE_TYPES].includes(c.type)) {
    if (!following) parts.push(`<label class="chk" style="white-space:nowrap" title="Shown as normal but can't be touched, e.g. a slider used as a progress bar (🔒 in the preview). Triggers can still move it (panel … value) and switch this with panel … lock / unlock"><input type="checkbox" data-p="${cb}.readonly" data-t="bool"${c.readonly ? ' checked' : ''} data-r> display only</label>`);
    parts.push(`<label class="chk" style="white-space:nowrap" title="Greyed out and can't be touched. Triggers switch this with panel … enable / disable"><input type="checkbox" data-p="${cb}.disabled" data-t="bool"${c.disabled ? ' checked' : ''} data-r> disabled</label>`);
  }
  if (c.col) parts.push(`<span class="muted" title="Column and row it was dragged to in the preview; empty = the next free place">Place</span>${num('col', 'auto', 'Column')}${num('row', 'auto', 'Row')}`);
  const fires = name ? p.triggers.filter((t) => t.type === 'panel' && (t.control || '').toLowerCase() === name) : [];
  // Actions "panel <name> …" / "label <name> …" (quoted or not).
  const rx = name.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
  const re = name && new RegExp(`(^|\\bthen\\s+|\\belse\\s+)(panel|label)\\s+("${rx}"|${rx})(\\s|$)`, 'i');
  const sets = re ? p.triggers.filter((t) => (t.actions || []).some((a) => re.test(a.trim()))) : [];
  const link = (t, extra) => `<a href="#" data-goto-trigger="${t.id}">#${t.id} ${esc(t.name || '')}</a>${extra ? ` <span class="muted">(${extra})</span>` : ''}`;
  if (['button', ...PANEL_VALUE_TYPES].includes(c.type)) {
    parts.push(`<span class="muted">Fires</span>${fires.map((t) => link(t, t.event || 'click')).join(', ') || '<span class="muted">nothing yet</span>'}
      ${c.name ? `<button class="btn small ghost" data-add="ptrig-${i}" title="New Panel trigger for this control">+ trigger</button>` : ''}`);
  }
  if (sets.length) parts.push(`<span class="muted">Changed by</span>${sets.map((t) => link(t)).join(', ')}`);
  return `<div class="row">${parts.join('<span class="muted">·</span>')}</div>`;
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------
views.variables = () => {
  const p = P(), vals = S.status?.vars || {};
  const mbOpts = (sel) => `<option value="">—</option>${p.modbus.map((d) => `<option${sel === d.name ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}`;
  return `<h2>Variables</h2>
  <p class="muted" style="margin-top:-6px">Like Medialon variables. Use them in any command as <code>{name}</code>,
    change them with <code>var visitors + 1</code>, test them with <code>var visitors > 50</code> or <code>if var door = 1 then …</code>,
    and react with a <b>Variable change</b> trigger. Link one to a Modbus point and it follows the PLC.</p>
  <table class="vars"><tr><th>Name</th><th class="narrow">Type</th><th>Initial</th><th class="narrow" title="Keep the value across reboots">Keep</th>
    <th>Modbus link (device · table · address)</th><th>Live value</th><th></th></tr>
  ${p.variables.map((v, i) => {
    const base = `variables.${i}`, cur = vals[v.name];
    const ro = v.modbus?.device && ['discrete', 'input'].includes(v.modbus.table);
    const live = cur == null ? '<span class="muted">save first</span>'
      : v.type === 'bool' ? `<button class="toggle${cur === '1' ? ' on' : ''}" data-cmd="var ${esc(quote(v.name))} toggle"${ro ? ' disabled' : ''}>${cur === '1' ? 'on' : 'off'}</button>`
      : `<div class="row nowrap">${v.type === 'number' ? `<button class="btn small" data-cmd="var ${esc(quote(v.name))} - 1"${ro ? ' disabled' : ''}>−</button>` : ''}
          <input class="mono" data-varset="${esc(v.name)}" value="${esc(cur)}" style="width:110px"${ro ? ' disabled' : ''}>
          ${v.type === 'number' ? `<button class="btn small" data-cmd="var ${esc(quote(v.name))} + 1"${ro ? ' disabled' : ''}>+</button>` : ''}</div>`;
    return `<tr>
    <td><input data-p="${base}.name" value="${esc(v.name)}" class="mono" data-r></td>
    <td><select data-p="${base}.type" data-r>${['number', 'text', 'bool'].map((t) => `<option value="${t}"${v.type === t ? ' selected' : ''}>${t === 'bool' ? 'on/off' : t}</option>`).join('')}</select></td>
    <td>${v.type === 'bool' ? `<select data-p="${base}.initial" data-t="bool-sel"><option value="0"${v.initial ? '' : ' selected'}>off</option><option value="1"${v.initial ? ' selected' : ''}>on</option></select>`
      : `<input data-p="${base}.initial"${v.type === 'number' ? ' type="number" data-t="num"' : ''} value="${esc(v.initial ?? '')}">`}</td>
    <td style="text-align:center"><input type="checkbox" data-p="${base}.persist" data-t="bool"${v.persist ? ' checked' : ''}></td>
    <td><div class="row nowrap"><select data-mb="${i}" data-k="device">${mbOpts(v.modbus?.device)}</select>
      ${v.modbus?.device ? `<select data-mb="${i}" data-k="table">${['coil', 'discrete', 'holding', 'input'].map((t) => `<option${v.modbus.table === t ? ' selected' : ''}>${t}</option>`).join('')}</select>
        <input type="number" min="0" max="65535" data-mb="${i}" data-k="address" value="${v.modbus.address ?? 0}" style="width:80px">` : ''}</div></td>
    <td>${live}${ro ? ' <span class="tag" title="Follows the PLC input">PLC</span>' : ''}</td>
    <td><button class="btn small ghost" data-del="${base}">✕</button></td></tr>`;
  }).join('')}</table>
  <div class="row" style="margin-top:6px"><button class="btn small" data-add="variable">+ Variable</button>
    <span class="muted">Modbus tables: coil & discrete = on/off, holding & input = 16-bit number. Discrete inputs and input registers are read-only.</span></div>`;
};
views.variables.after = () => {
  $$('[data-varset]').forEach((el) => el.addEventListener('change', async () => {
    const r = await cmd(`var ${quote(el.dataset.varset)} = ${el.value}`);
    toast(r.reply, !r.ok);
  }));
  $$('[data-mb]').forEach((el) => el.addEventListener('change', () => {
    const v = P().variables[+el.dataset.mb];
    if (el.dataset.k === 'device') {
      if (!el.value) delete v.modbus;
      else v.modbus = Object.assign({ table: v.type === 'bool' ? 'coil' : 'holding', address: 0 }, v.modbus, { device: el.value });
    } else v.modbus[el.dataset.k] = el.dataset.k === 'address' ? +el.value : el.value;
    markDirty();
    render();
  }));
};
// Live values change every second: update them without re-rendering the editor.
function renderVarValues() {
  const vals = S.status?.vars || {};
  for (const el of $$('[data-varset]')) if (document.activeElement !== el && vals[el.dataset.varset] != null) el.value = vals[el.dataset.varset];
  for (const b of $$('.vars .toggle')) {
    const name = b.dataset.cmd.replace(/^var "?|"? toggle$/g, '');
    const on = vals[name] === '1';
    b.classList.toggle('on', on);
    b.textContent = on ? 'on' : 'off';
  }
}

// ---------------------------------------------------------------------------
// Schedule: clock, location, calendar, upcoming timed triggers
// ---------------------------------------------------------------------------
// Same date / summer-time / sun maths as src/Clock.cpp.
// Sets the controller's clock to this PC's time (Schedule and Settings pages).
async function setClockFromPc() {
  try { await api('/api/time', { method: 'POST', body: String(Math.floor(Date.now() / 1000)) }); toast('Clock set'); } catch (e) { toast(e.message, true); }
}
const Sched = {
  days: KDModel.days,
  inPeriod: KDModel.inPeriod,
  weekday: (days) => ((days % 7) + 11) % 7,
  dim: (y, m) => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1],
  sunday(y, m, n) {
    if (n < 0) { const last = Sched.dim(y, m); return last - Sched.weekday(Sched.days(y, m, last)); }
    return 1 + (7 - Sched.weekday(Sched.days(y, m, 1))) % 7 + (n - 1) * 7;
  },
  dst(utcSec, y, rule, tz) {
    let s, e;
    if (rule === 'eu') { s = Sched.days(y, 3, Sched.sunday(y, 3, -1)) * 86400 + 3600; e = Sched.days(y, 10, Sched.sunday(y, 10, -1)) * 86400 + 3600; }
    else if (rule === 'us') { s = Sched.days(y, 3, Sched.sunday(y, 3, 2)) * 86400 + 7200 - tz * 60; e = Sched.days(y, 11, Sched.sunday(y, 11, 1)) * 86400 + 3600 - tz * 60; }
    else return 0;
    return utcSec >= s && utcSec < e ? 60 : 0;
  },
  // Local minutes after midnight of sunrise/sunset, or -1.
  sun(y, m, d, rise) {
    const loc = P().settings.location, s = P().settings;
    if (loc.lat == null || loc.lon == null) return -1;
    const utc = KDModel.sunUtc(y, m, d, loc.lat, loc.lon, rise);
    if (utc == null) return -1;
    const local = utc + (s.tzOffsetMin ?? 60) + Sched.dst(Sched.days(y, m, d) * 86400 + 43200, y, s.time.dst, s.tzOffsetMin ?? 60);
    return ((local % 1440) + 1440) % 1440;
  },
};
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// The controller's date (its clock may differ from this PC's).
function schedNow() {
  return S.status?.clock?.local ? new Date(S.status.clock.local.replace(' ', 'T')) : new Date();
}
// Calendar names (lower case) active on a date: KDModel.periodOn per row (= Clock.cpp).
function calActiveOn(dt) {
  const y = dt.getFullYear(), m = dt.getMonth() + 1, d = dt.getDate();
  return new Set(P().calendar.filter((e) => e.name && KDModel.periodOn(e, y, m, d)).map((e) => e.name.toLowerCase()));
}
// A colour per calendar name (in list order), for the month view.
const CAL_COLORS = ['#4aa3ff', '#3ecf8e', '#ffb020', '#c084fc', '#ff5c5c', '#3ad1e0', '#f472b6', '#a3e635'];
function calColor(name) {
  const names = [...new Set(P().calendar.map((e) => (e.name || '').toLowerCase()).filter(Boolean))];
  return CAL_COLORS[Math.max(0, names.indexOf(String(name).toLowerCase())) % CAL_COLORS.length];
}
// Timed triggers on one day, with calendar/date conditions evaluated for that day. Calendar
// change triggers show at 00:00 on the days their period starts or ends. after = minutes: leave
// out what runs before that (today, already passed); -1 = the whole day.
function dayEvents(day, after = -1, prepared = schedTriggers()) {
  const out = [];
  const y = day.getFullYear(), m = day.getMonth() + 1, d = day.getDate();
  const wd = DAYS[day.getDay()], md = m * 100 + d, ymd = y * 10000 + md;
  const act = calActiveOn(day);
  let before = null;   // yesterday's calendar, only worked out when needed
  for (const { t, conds } of prepared) {
    let min;
    if (t.type === 'calendar') {
      before ??= calActiveOn(new Date(y, m - 1, d - 1));
      const k = t.calendar.toLowerCase(), on = act.has(k);
      if (on === before.has(k) || on !== ((t.state || 'active') === 'active')) continue;
      min = 0;
    } else {
      if (t.days && !t.days.includes(wd)) continue;
      if (t.at === 'sunrise' || t.at === 'sunset') {
        const base = Sched.sun(y, m, d, t.at === 'sunrise');
        if (base < 0) continue;
        min = ((base + (t.offset || 0)) % 1440 + 1440) % 1440;
      } else {
        const [h, mi] = String(t.at || '00:00').split(':').map(Number);
        min = h * 60 + mi;
      }
    }
    if (min < after) continue;
    let skip = '';
    const notes = [];
    for (const { c, w } of conds) {
      if (w[0] === 'calendar' && w.length === 3) {
        const a = act.has(String(w[1]).toLowerCase());
        if (a !== (w[2] === 'active')) skip = `calendar ${w[1]} ${a ? 'active' : 'inactive'}`;
      } else if (w[0] === 'date' && w[1] === 'between' && w.length === 4) {
        const a = KDModel.dateStore(w[2]), b = KDModel.dateStore(w[3]);
        if (a && b && !Sched.inPeriod(md, ymd, a, b)) skip = `outside ${w[2]} – ${w[3]}`;
      } else if (w[0] === 'day' && w[1] === 'is') {
        if (!w.slice(2).join(',').split(',').map((x) => x.trim()).includes(wd)) skip = 'other weekday';
      } else notes.push(c);
    }
    // The mode then isn't known yet: shown as a condition.
    if (t.onlyIn?.group && t.onlyIn.states?.length) notes.push(`${t.onlyIn.group} is ${t.onlyIn.states.join(' or ')}`);
    out.push({ date: day, min, t, skip, notes });
  }
  return out.sort((a, b) => a.min - b.min);
}
// The enabled time and calendar-change triggers with their conditions split into words once.
function schedTriggers() {
  return P().triggers.filter((t) => t.enabled !== false && (t.type === 'time' || (t.type === 'calendar' && t.calendar)))
    .map((t) => ({ t, conds: (t.conditions || []).map((c) => ({ c, w: tokenize(c).map((x) => x.v) })) }));
}
function upcomingEvents() {
  const now = schedNow(), prep = schedTriggers(), out = [];
  for (let k = 0; k < 7; k++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k);
    // Today: only what's still to come; calendar changes happen at midnight, so not today.
    out.push(...dayEvents(day, k === 0 ? now.getHours() * 60 + now.getMinutes() : -1, prep).filter((e) => k > 0 || e.t.type !== 'calendar'));
  }
  return out;
}
const dayLabel = (d) => `${DAYS[d.getDay()][0].toUpperCase()}${DAYS[d.getDay()].slice(1)} ${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}`;
// One row of the "next 7 days" / chosen day tables.
function schedEventRow(e, head = '') {
  return `<tr class="${e.skip ? 'skipped' : ''}"><td class="mono">${head}${hhmm(e.min)}${e.t.type === 'calendar' ? ` <span class="muted">${esc(e.t.calendar)} ${(e.t.state || 'active') === 'active' ? 'starts' : 'ends'}</span>` : e.t.at === 'sunrise' || e.t.at === 'sunset' ? ` <span class="muted">${e.t.at}${e.t.offset ? (e.t.offset > 0 ? '+' : '') + e.t.offset : ''}</span>` : ''}</td>
    <td><a href="#" data-goto-trigger="${e.t.id}">${e.t.id} · ${esc(e.t.name)}</a></td>
    <td>${e.skip ? `<span class="muted">skipped: ${esc(e.skip)}</span>` : e.notes.length ? `<span class="muted">if ${esc(e.notes.join(' and '))}</span>` : ''}</td></tr>`;
}
// Weekdays Monday first (European week), as the DAYS keys.
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
// A calendar period row: name, from/to (typed DD-MM, stored MM-DD), weekdays, active today.
function calRowHtml(e, i, today) {
  const on = (d) => !e.days || e.days.includes(d);
  const active = KDModel.periodOn(e, today.getFullYear(), today.getMonth() + 1, today.getDate());
  return `<div class="cal-row">
    <span class="cal-dot" style="background:${calColor(e.name)}"></span>
    <input class="cal-name" data-p="calendar.${i}.name" value="${esc(e.name)}" placeholder="Name" data-r>
    <span class="cal-dates"><input class="mono" data-cal-date="${i}.from" value="${esc(e.from ? KDModel.dateShow(e.from) ?? e.from : '')}" placeholder="all year" title="DD-MM every year, or DD-MM-YYYY once">
      <span class="muted">to</span>
      <input class="mono" data-cal-date="${i}.to" value="${esc(e.to ? KDModel.dateShow(e.to) ?? e.to : '')}" placeholder="${e.from ? 'same day' : ''}" title="DD-MM every year, or DD-MM-YYYY once; empty = the same day"${e.from ? '' : ' disabled'}></span>
    <span class="cal-days">${WEEK.map((d) => `<button class="cal-wd${on(d) ? ' on' : ''}" data-cal-day="${i}:${d}" title="${on(d) ? 'Active' : 'Not active'} on ${d}">${d[0].toUpperCase() + d[1]}</button>`).join('')}</span>
    <span class="cal-today">${active ? '<span class="tag mon-warn">active today</span>' : '<span class="muted">—</span>'}</span>
    <button class="btn small ghost" data-del="calendar.${i}" title="Delete">✕</button>
  </div>`;
}
// Month view: per day the active calendar periods and the timed triggers (skipped ones dimmed).
function monthHtml() {
  const now = schedNow();
  const mv = (S.schedMonth ??= { y: now.getFullYear(), m: now.getMonth() });
  const first = new Date(mv.y, mv.m, 1), start = new Date(mv.y, mv.m, 1 - (first.getDay() + 6) % 7);
  const weeks = Math.ceil(((first.getDay() + 6) % 7 + new Date(mv.y, mv.m + 1, 0).getDate()) / 7);
  const sel = S.schedDay ?? euDate(now), prep = schedTriggers(), todayKey = euDate(now);
  let cells = '';
  for (let k = 0; k < weeks * 7; k++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + k), key = euDate(d);
    const cal = [...new Set(P().calendar.filter((e) => e.name && KDModel.periodOn(e, d.getFullYear(), d.getMonth() + 1, d.getDate())).map((e) => e.name))];
    const ev = dayEvents(d, -1, prep), shown = ev.slice(0, 4);
    cells += `<div class="cal-day${d.getMonth() !== mv.m ? ' other' : ''}${key === todayKey ? ' today' : ''}${key === sel ? ' sel' : ''}" data-cal-pick="${key}"
      ${cal.length ? `style="--cal-tint:${calColor(cal[0])}"` : ''}>
      <div class="cal-num">${d.getDate()}</div>${ev.length ? `<span class="cal-count" title="${ev.length} timed trigger${ev.length > 1 ? 's' : ''}">${ev.length}</span>` : ''}
      ${cal.map((n) => `<div class="cal-tag" style="--c:${calColor(n)}">${esc(n)}</div>`).join('')}
      ${shown.map((e) => `<div class="cal-ev${e.skip ? ' skipped' : ''}" title="${esc(`${hhmm(e.min)} ${e.t.name}${e.skip ? ' – skipped: ' + e.skip : ''}`)}"><span class="mono">${hhmm(e.min)}</span> ${esc(e.t.name)}</div>`).join('')}
      ${ev.length > shown.length ? `<div class="cal-ev muted">+${ev.length - shown.length} more</div>` : ''}
    </div>`;
  }
  const [sd, sm, sy] = sel.split('-').map(Number), selDate = new Date(sy, sm - 1, sd), selEv = dayEvents(selDate, -1, prep);
  return `<div class="row cal-nav">
      <button class="btn small" data-cal-month="-1" title="Previous month">◀</button>
      <b class="cal-title">${MONTHS[mv.m]} ${mv.y}</b>
      <button class="btn small" data-cal-month="1" title="Next month">▶</button>
      <button class="btn small" data-cal-month="0">Today</button>
    </div>
    <div class="cal-month">${WEEK.map((d) => `<div class="cal-head">${d[0].toUpperCase() + d.slice(1)}</div>`).join('')}${cells}</div>
    <h4 style="margin:12px 0 4px">${dayLabel(selDate)}-${sy}${(() => { const c = [...calActiveOn(selDate)]; return c.length ? ` <span class="muted">· ${esc(P().calendar.filter((e) => c.includes((e.name || '').toLowerCase())).map((e) => e.name).filter((n, i, a) => a.indexOf(n) === i).join(', '))}</span>` : ''; })()}</h4>
    ${selEv.length ? `<table class="sched"><tr><th>When</th><th>Trigger</th><th>Note</th></tr>${selEv.map((e) => schedEventRow(e)).join('')}</table>` : '<p class="muted">No time triggers on this day.</p>'}`;
}
views.schedule = () => {
  const p = P(), s = p.settings, c = S.status?.clock;
  const today = schedNow();
  const ty = today.getFullYear(), tm = today.getMonth() + 1, td = today.getDate();
  const rise = Sched.sun(ty, tm, td, true), set = Sched.sun(ty, tm, td, false);
  const ev = upcomingEvents();
  let lastDay = '';
  return `<h2>Schedule</h2>
  <div class="sched-top">
    <div class="card"><h3 style="margin-top:0">Controller clock</h3>
      <div class="mon-rows">
        <span class="muted">Local time</span><span>${c?.set ? esc(euStamp(c.local)) + (c.dst ? ' (summer time)' : '') : '<span class="bad">not set</span>'}</span>
        <span class="muted">NTP</span><span>${!s.time.ntpEnabled ? 'off' : c?.ntp?.error ? `<span class="bad">${esc(c.ntp.error)}</span>` : c?.ntp?.lastSync ? 'synced ' + ago(c.ntp.lastSync) : 'waiting…'}</span>
        <span class="muted">Sunrise</span><span>${c?.sunrise || (rise >= 0 ? hhmm(rise) : '—')}</span>
        <span class="muted">Sunset</span><span>${c?.sunset || (set >= 0 ? hhmm(set) : '—')}</span>
        <span class="muted">Calendar today</span><span>${c?.calendar?.length ? c.calendar.map((n) => `<span class="tag mon-warn">${esc(n)}</span>`).join(' ') : 'nothing special'}</span>
      </div>
      <div class="row" style="margin-top:10px"><button class="btn small" data-cmd="ntp sync">Sync now</button><button class="btn small" id="syncBrowser">Set from this browser</button></div></div>
    <div class="card"><h3 style="margin-top:0">Time & location</h3>
      <div class="form sched-form">
        <label>Time zone</label><div class="row"><span class="muted">UTC</span><input type="number" step="15" data-p="settings.tzOffsetMin" data-t="num" value="${s.tzOffsetMin}" style="width:80px" data-r><span class="muted">min (CET = 60)</span></div>
        <label>Summer time</label><select data-p="settings.time.dst" data-r>${[['eu', 'Europe (last Sun Mar – last Sun Oct)'], ['us', 'USA (2nd Sun Mar – 1st Sun Nov)'], ['none', 'none']].map(([v, n]) => `<option value="${v}"${s.time.dst === v ? ' selected' : ''}>${n}</option>`).join('')}</select>
        <label>NTP server</label><div class="row nowrap"><input type="checkbox" data-p="settings.time.ntpEnabled" data-t="bool"${s.time.ntpEnabled ? ' checked' : ''}><input data-p="settings.time.ntp" value="${esc(s.time.ntp)}" style="flex:1"></div>
        <label>Latitude</label><input type="number" step="0.0001" data-p="settings.location.lat" data-t="num" value="${s.location.lat ?? ''}" placeholder="52.16" data-r>
        <label>Longitude</label><input type="number" step="0.0001" data-p="settings.location.lon" data-t="num" value="${s.location.lon ?? ''}" placeholder="4.49 (east +)" data-r>
      </div></div>
  </div>
  <div class="card sched-card"><h3 style="margin-top:0">Calendar periods</h3>
    <p class="muted" style="margin-top:-4px">Opening days, holidays, closed days, seasons… Use them as conditions: <code>calendar Closed inactive</code>.
      Dates are DD-MM (every year) or DD-MM-YYYY (that year only); no dates = all year. The day buttons limit a period to those weekdays. Several rows may share a name.</p>
    <div class="cal-list">${p.calendar.map((e, i) => calRowHtml(e, i, today)).join('') || '<p class="muted">No periods yet.</p>'}</div>
    <div class="row" style="margin-top:8px"><button class="btn small" data-add="calendar">+ Period</button></div>
  </div>
  <div class="card sched-card"><h3 style="margin-top:0">Month</h3>${monthHtml()}</div>
  <div class="card sched-card"><h3 style="margin-top:0">Next 7 days</h3>
  ${ev.length ? `<table class="sched"><tr><th>When</th><th>Trigger</th><th>Note</th></tr>${ev.map((e) => {
    const dl = dayLabel(e.date);
    const head = dl !== lastDay ? `<b>${esc(dl)}</b> ` : '';
    lastDay = dl;
    return schedEventRow(e, head);
  }).join('')}</table>` : '<p class="muted">No time triggers in the next 7 days.</p>'}</div>`;
};
views.schedule.after = () => {
  $('#syncBrowser').addEventListener('click', setClockFromPc);
  // Dates are typed DD-MM / DD-MM-YYYY and stored MM-DD / YYYY-MM-DD (what the firmware reads).
  $$('[data-cal-date]').forEach((el) => el.addEventListener('change', () => {
    const [i, k] = el.dataset.calDate.split('.'), e = P().calendar[+i], v = el.value.trim();
    if (!e) return;
    if (!v) delete e[k];
    else {
      const st = KDModel.dateStore(v);
      if (!st) { el.classList.add('invalid'); toast('Dates are DD-MM (every year) or DD-MM-YYYY, e.g. 24-12', true); return; }
      e[k] = st;
    }
    if (!e.from) delete e.to;
    markDirty();
    render();
  }));
  $$('[data-cal-day]').forEach((b) => b.addEventListener('click', () => {
    const [i, d] = b.dataset.calDay.split(':'), e = P().calendar[+i];
    const set = new Set(e.days || DAYS);
    set.has(d) ? set.delete(d) : set.add(d);
    if (set.size === 7) delete e.days;
    else e.days = DAYS.filter((x) => set.has(x));
    markDirty();
    render();
  }));
  $$('[data-cal-month]').forEach((b) => b.addEventListener('click', () => {
    const n = +b.dataset.calMonth, now = schedNow(), mv = S.schedMonth;
    if (!n) { S.schedMonth = { y: now.getFullYear(), m: now.getMonth() }; S.schedDay = euDate(now); }
    else { const d = new Date(mv.y, mv.m + n, 1); S.schedMonth = { y: d.getFullYear(), m: d.getMonth() }; }
    render();
  }));
  $$('[data-cal-pick]').forEach((el) => el.addEventListener('click', (ev) => {
    if (ev.target.closest('a')) return;
    S.schedDay = el.dataset.calPick;
    const [, m, y] = S.schedDay.split('-').map(Number);
    S.schedMonth = { y, m: m - 1 };   // a day of the next/previous month opens that month
    render();
  }));
};

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------
const PJ_ERR_PARTS = ['Fan', 'Lamp', 'Temp', 'Cover', 'Filter', 'Other'];
const PJ_MUTE = { 30: 'off', 31: 'picture + sound', 11: 'picture', 21: 'sound' };
// "online" / "offline" / "unknown" for any monitored name (PC, device, projector)
function hostState(name) {
  const st = S.status;
  if (!st) return '';
  const h = st.monitor?.hosts?.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
  if (h) return h.state;
  const pj = [...(st.projectors || []), ...(st.drivers || [])].find((x) => x.name.toLowerCase() === String(name).toLowerCase());
  if (pj) return !pj.seen ? 'unknown' : pj.online ? 'online' : 'offline';
  return '';
}
function ago(epoch) {
  const now = S.status?.time || 0;
  if (!epoch) return 'never';
  const s = Math.max(0, now - epoch);
  if (s < 5) return 'just now';
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
// A duration: "45 s", "12 min", "5 h 20 min", "3 days 4 h".
function duration(s) {
  s = Math.max(0, Math.round(s || 0));
  if (s < 90) return `${s} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.floor(s / 3600)} h ${Math.floor(s / 60) % 60} min`;
  return `${Math.floor(s / 86400)} days ${Math.floor(s / 3600) % 24} h`;
}
// 32 most recent checks, oldest left; bit 0 = latest, 1 = answered.
function historyBar(bits, checks) {
  let html = '';
  for (let i = 31; i >= 0; i--) {
    const cls = i >= (checks || 0) ? '' : (bits >>> i) & 1 ? 'up' : 'down';
    html += `<i class="${cls}"></i>`;
  }
  const n = Math.min(checks || 0, 32);
  let up = 0;
  for (let i = 0; i < n; i++) up += (bits >>> i) & 1;
  return `<div class="hist" title="Last ${n} checks: ${up} answered, ${n - up} missed">${html}</div>`;
}
const kb = (b) => `${Math.round((b || 0) / 1024)} KB`;
// Free memory: amber below 64 KB, red below 32 KB (the firmware logs a warning too).
const memClass = (h) => (h.free < 32768 ? 'bad' : h.free < 65536 ? 'warn' : 'ok');
function memText(h) {
  if (!h || !h.size) return '—';
  return `<span class="mem-${memClass(h)}" title="In use ${kb(h.used)} · lowest free since boot ${kb(h.minFree)}">${kb(h.free)} free of ${kb(h.size)}</span>`;
}
// Bar = memory in use now; the tick marks the highest use since boot.
function memBar(h) {
  if (!h || !h.size) return '';
  const pct = Math.round((1 - h.free / h.size) * 100);
  return `<div class="membar" title="${pct}% in use now · lowest free since boot ${kb(h.minFree)}"><div class="mem-${memClass(h)}" style="width:${pct}%"></div>
    <span style="left:${Math.round((1 - h.minFree / h.size) * 100)}%"></span></div>`;
}
function monSummary(st) {
  const hosts = st?.monitor?.hosts || [];
  const pjs = st?.projectors || [];
  const all = [...hosts.map((h) => h.state), ...[...pjs, ...(st?.drivers || [])].map((p) => (!p.seen ? 'unknown' : p.online ? 'online' : 'offline')),
    ...(st?.io?.tcp || []).map((x) => x.state), ...(st?.io?.modbus || []).map((x) => x.state)];
  return { online: all.filter((s) => s === 'online').length, offline: all.filter((s) => s === 'offline').length, unknown: all.filter((s) => s === 'unknown').length, total: all.length };
}
views.monitor = () => {
  const m = P().settings.monitor;
  return `<h2>Monitoring</h2>${monTabs()}
  <div class="card mon-bar">
    <div class="row">
      <label class="muted">Check every</label><input type="number" id="monInterval" min="5" max="3600" value="${m.interval}" style="width:80px"><span class="muted">s</span>
      <label class="muted" title="How long to wait for a ping reply">Timeout</label><input type="number" id="monTimeout" min="100" max="5000" step="100" value="${m.timeout}" style="width:80px"><span class="muted">ms</span>
      <label class="muted" title="Missed checks in a row before a host counts as offline">Offline after</label><input type="number" id="monFailures" min="1" max="10" value="${m.failures}" style="width:60px"><span class="muted">missed checks</span>
      <button class="btn small" id="monApply">Apply</button>
      <span class="spacer" style="flex:1"></span>
      <button class="btn primary small" data-cmd="monitor check">⟳ Check now</button>
    </div>
    <div class="row" id="monSummary" style="margin-top:8px"></div>
  </div>
  <div id="monBody"></div>
  <p class="muted">PCs and network devices are pinged (ICMP); projectors are polled over PJLink for power, lamp hours, input, mute and error status.
    Kiss-Box, KNX, BrightSign, DiGidot, NETIO and Pharos devices are asked for their status in their own protocol at this same interval; with live updates they report changes at once.
    Turn monitoring off per PC/device on the Devices page. Use a <b>Device online/offline</b> trigger to react, e.g. send an email.
    <b>Click a card</b> to open it with its online/offline history and its own log lines.</p>`;
};
views.monitor.after = () => {
  renderMonitor();
  // The cards are redrawn every second; don't replace a button between mouse down and up.
  $('#monBody').addEventListener('mousedown', () => (S.monHold = true));
  $('#monBody').addEventListener('click', (e) => {
    const c = e.target.closest('[data-mon-open]');
    if (!c || S.monOpen || e.target.closest('button, input, select, textarea, a, label, [data-live]')) return;
    S.monOpen = c.dataset.monOpen;
    S.monHold = false;
    renderMonitor();
    $('#main').scrollTop = 0;
  });
  $('#monApply').addEventListener('click', async () => {
    const m = P().settings.monitor;
    m.interval = Math.max(5, Math.min(3600, +$('#monInterval').value || 60));
    m.timeout = Math.max(100, Math.min(5000, +$('#monTimeout').value || 1000));
    m.failures = Math.max(1, Math.min(10, +$('#monFailures').value || 2));
    markDirty();
    const r = await cmd(`monitor interval ${m.interval}`);
    toast(r.ok ? `Checking every ${m.interval} s now - press Save to keep it (timeout/failures apply after saving)` : r.reply, !r.ok);
  });
};
views.monitor.keys = (e) => { if (e.key === 'Escape' && S.monOpen) monDetailClose(); };
addEventListener('mouseup', () => setTimeout(() => (S.monHold = false)));   // after the click handler ran

// ---- One device opened: history graph + its log lines ----------------------------------
// The controller writes every online/offline (and projector power on/off) change to a day
// file on the stick (Monitor::record); /api/history reads it back, /api/devlog searches the
// log files for the device's name or IP. Times are picked in the browser's local time.
const HIST_GAP = 900;   // no line for this long = the controller was off (it writes "alive" every 600 s)
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const clockHm = (s) => new Date(s * 1000).toTimeString().slice(0, 5);
function monRange() {
  const r = (S.monRange ??= { date: ymd(new Date()), from: '00:00', to: '00:00' });
  const from = new Date(`${r.date}T${r.from}`).getTime() / 1000;
  let to = new Date(`${r.date}T${r.to}`).getTime() / 1000;
  if (to <= from) to += 86400;   // 00:00-00:00 = the whole day, 22:00-06:00 = overnight
  return { from, to };
}
function monDetailClose() {
  S.monOpen = null;
  stopPageLoop('monDetail');
  renderMonitor();
}
function monDetailHtml(it) {
  const r = S.monRange ?? (monRange(), S.monRange);
  return `<div id="monDetail" data-key="${esc(S.monOpen)}">
    <div class="row" style="margin-bottom:8px"><button class="btn small" id="mdBack">← All devices</button><span class="muted">Esc closes</span></div>
    <div id="monDetailCard"></div>
    <div class="card md-hist">
      <div class="row">
        <h3 style="margin:0;flex:1">History</h3>
        <button class="btn small" data-mdday="-1" title="Day before">◀</button>
        <input type="date" id="mdDate" value="${r.date}">
        <button class="btn small" data-mdday="1" title="Day after">▶</button>
        <label class="muted">from</label><input type="time" id="mdFrom" value="${r.from}">
        <label class="muted">to</label><input type="time" id="mdTo" value="${r.to}">
        <button class="btn small" data-mdq="today">Today</button>
        <button class="btn small" data-mdq="day" title="00:00 - 24:00">Whole day</button>
        <button class="btn small" data-mdq="work" title="08:00 - 17:00">8 - 17</button>
      </div>
      <div class="row md-stats" id="mdStats"><span class="muted">loading…</span></div>
      <div id="mdGraph"></div>
    </div>
    <div class="card">
      <div class="row"><h3 style="margin:0;flex:1">Log</h3><span class="muted" id="mdLogInfo"></span></div>
      <div class="log md-log" id="mdLog"></div>
    </div>
  </div>`;
}
function monDetailWire(it) {
  const set = (k, v) => { S.monRange[k] = v; };
  const reload = () => {
    ['date', 'from', 'to'].forEach((k) => ($(`#md${k[0].toUpperCase() + k.slice(1)}`).value = S.monRange[k]));
    pagePoll('monDetail', () => monDetailLoad(it), 15000);
  };
  $('#mdBack').addEventListener('click', monDetailClose);
  $('#mdDate').addEventListener('change', (e) => { if (e.target.value) { set('date', e.target.value); reload(); } });
  $('#mdFrom').addEventListener('change', (e) => { if (e.target.value) { set('from', e.target.value); reload(); } });
  $('#mdTo').addEventListener('change', (e) => { if (e.target.value) { set('to', e.target.value); reload(); } });
  $$('[data-mdday]').forEach((b) => b.addEventListener('click', () => {
    const d = new Date(`${S.monRange.date}T12:00`);
    d.setDate(d.getDate() + +b.dataset.mdday);
    set('date', ymd(d));
    reload();
  }));
  $$('[data-mdq]').forEach((b) => b.addEventListener('click', () => {
    const q = b.dataset.mdq;
    if (q === 'today') set('date', ymd(new Date()));
    else { set('from', q === 'work' ? '08:00' : '00:00'); set('to', q === 'work' ? '17:00' : '00:00'); }
    reload();
  }));
  // A mark on the log lane jumps to its line.
  $('#mdGraph').addEventListener('click', (e) => {
    const m = e.target.closest('[data-logi]');
    const row = m && $(`#mdLog [data-i="${m.dataset.logi}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center' });
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 1200);
  });
  reload();
}
// The history (one small day file) comes first and draws the graph at once; the log lines
// (a search through the log files on the stick, the slow part) follow and are added to it.
// The controller answers one request at a time, so asking both together only made the graph
// wait for the log. Refreshes (every 15 s) ask only for log lines newer than the last one, and
// a time window that is already over is not read again at all.
const MD_LOG_MAX = 300;   // = the firmware's /api/devlog limit (Web.cpp)
async function monDetailLoad(it) {
  const { from, to } = monRange(), key = S.monOpen;
  const id = `${key}|${from}|${to}`, c = S.mdCache?.id === id ? S.mdCache : null;
  const nowAt = () => (S.status?.time > 1600000000 ? S.status.time : Date.now() / 1000);
  if (c && c.at > to) return;   // fetched after the window ended: nothing new can come
  const q = (f) => `name=${encodeURIComponent(it.name)}&from=${f}&to=${to}`;
  const gone = () => S.monOpen !== key || !$('#mdGraph');   // closed or another device opened meanwhile
  let lines;
  try {
    lines = await api(`/api/history?${q(from)}`);
  } catch (e) {
    if ($('#mdStats')) $('#mdStats').innerHTML = `<span class="bad">Could not read the history: ${esc(e.message)}</span>`;
    return;
  }
  if (gone()) return;
  const at = nowAt();
  if (!c) {
    monDetailDraw(it, lines, null, from, to, at);   // graph now, log lines when they come
    $('#mdLog').innerHTML = '<div class="muted" style="padding:6px">Searching the log…</div>';
  }
  // New lines only: from the last second we have (its lines come again and replace ours).
  const lastE = c?.logs.length ? c.logs[c.logs.length - 1].e : null;
  let logs;
  try {
    const got = await api(`/api/devlog?${q(lastE ?? from)}&ip=${encodeURIComponent(it.ip || '')}`);
    logs = lastE == null ? got : c.logs.filter((m) => m.e < lastE).concat(got).slice(-MD_LOG_MAX);
  } catch (e) {
    if (!gone() && !c) $('#mdLogInfo').innerHTML = `<span class="bad">Could not read the log: ${esc(e.message)}</span>`;
    if (!gone()) monDetailDraw(it, lines, c?.logs || [], from, to, at);
    return;
  }
  if (gone()) return;
  S.mdCache = { id, logs, at };
  monDetailDraw(it, lines, logs, from, to, at);
}
// logs = null: still loading (the graph without its log lane marks).
function monDetailDraw(it, lines, logs, from, to, now) {
  const up = histSegments(lines, from, to, now, 'online', 'offline');
  const pw = it.power ? histMask(histSegments(lines, from, to, now, 'on', 'off'), up) : null;
  const lanes = [{ name: 'Online', segs: up, cls: { online: 'h-up', offline: 'h-down' } }];
  if (pw) lanes.push({ name: 'Power', segs: pw, cls: { on: 'h-on', off: 'h-off' }, on: 'on' });
  // A lane per on/off reading of a show device ("p:<key>=1|0"), in the device's own order.
  if (it.drv) {
    const pts = drvSt(it.drv).points || [], order = (k) => { const i = pts.findIndex((p) => p.k === k); return i < 0 ? 1e6 : i; };
    const keys = [...new Set(lines.filter(([, s]) => s.startsWith('p:')).map(([, s]) => s.slice(2, s.lastIndexOf('='))))].sort((a, b) => order(a) - order(b));
    for (const k of keys) {
      const on = `p:${k}=1`, off = `p:${k}=0`;
      lanes.push({ name: drvPointLabel(it.drv, k), segs: histMask(histSegments(lines, from, to, now, on, off), up), cls: { [on]: 'h-pon', [off]: 'h-poff' }, on, small: true });
    }
  }
  $('#mdStats').innerHTML = histStats(up, pw, from, Math.min(to, now));
  $('#mdGraph').innerHTML = histGraph(lanes, logs || [], from, to, now);
  if (!logs) return;
  const box = $('#mdLog');
  box.innerHTML = logs.length ? logs.map((m, i) => `<div class="l L${m.l}" data-i="${i}"><span class="t">${new Date(m.e * 1000).toTimeString().slice(0, 8)}</span><span class="v">${LOG_LVLS[m.l]}</span><span class="c">${m.c}</span><span class="m">${esc(m.m)}</span></div>`).join('')
    : '<div class="muted" style="padding:6px">Nothing in the log about this device in this time.</div>';
  box.scrollTop = box.scrollHeight;
  $('#mdLogInfo').textContent = `${logs.length}${logs.length >= MD_LOG_MAX ? ` (the last ${MD_LOG_MAX})` : ''} lines mentioning "${it.name}"${it.ip ? ' or ' + it.ip : ''}`;
}
// [[t0, t1, state], ...] over from..min(to, now); state = up/down value or null (unknown:
// not checked yet, or the controller was off).
// upVal can also be a function: state line -> the lane's value, or undefined (not this lane).
function histSegments(lines, from, to, now, upVal, downVal) {
  const pick = typeof upVal === 'function' ? upVal : (s) => (s === upVal || s === downVal ? s : undefined);
  const end = Math.min(to, now), segs = [];
  let state = null, since = from, lastLine = -Infinity;
  const change = (t, s) => {
    if (s === state) return;
    t = Math.max(from, Math.min(end, t));
    if (t > since) segs.push([since, t, state]);
    if (t >= since) since = t;
    state = s;
  };
  for (const [t, s] of lines) {
    if (t - lastLine > HIST_GAP && state !== null) change(lastLine + 600, null);
    lastLine = t;
    if (s === 'boot') change(t, null);
    else if (pick(s) !== undefined) change(t, pick(s));
  }
  if (end - lastLine > HIST_GAP && state !== null) change(lastLine + 600, null);
  if (end > since) segs.push([since, end, state]);
  return segs;
}
// A reading (or projector power) is only known while the device answers: unknown elsewhere.
function histMask(segs, up) {
  const cuts = [...new Set([...segs, ...up].flatMap(([a, b]) => [a, b]))].sort((a, b) => a - b);
  const at = (list, t) => list.find(([a, b]) => t >= a && t < b)?.[2] ?? null;
  const out = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]], s = at(up, a) === 'online' ? at(segs, a) : null;
    if (out.length && out[out.length - 1][2] === s && out[out.length - 1][1] === a) out[out.length - 1][1] = b;
    else out.push([a, b, s]);
  }
  return out;
}
// "1.3 · Fog machine", "Timeline 1 Inloop", "out2 · Beamer": the name given in the UI or by the device.
function drvPointLabel(x, k) {
  const n = x.names?.[k] || (x.addresses || []).find((a) => a.ga === k)?.name || (drvSt(x).points || []).find((p) => p.k === k)?.n || '';
  return !n || n === k ? k : x.type === 'pharos' ? n : `${k} · ${n}`;
}
function histStats(up, pw, from, end) {
  const sum = (segs, v) => segs.reduce((n, [a, b, s]) => n + (s === v ? b - a : 0), 0);
  const total = Math.max(1, end - from);
  if (end <= from) return '<span class="muted">This time is still to come.</span>';
  const on = sum(up, 'online'), off = sum(up, 'offline'), unk = total - on - off;
  let drops = 0, longest = 0;
  up.forEach(([a, b, s], i) => {
    if (s === 'offline') { longest = Math.max(longest, b - a); if (up[i - 1]?.[2] === 'online') drops++; }
  });
  const chip = (cls, k, v) => `<span class="chip ${cls}" title="${k}">${k} <b>${v}</b></span>`;
  let html = chip('ok', 'Online', `${Math.round((on / total) * 100)}% · ${duration(on)}`) +
    chip(off ? 'bad' : '', 'Offline', duration(off)) +
    chip('', 'Drop-outs', drops) +
    (longest ? chip('', 'Longest offline', duration(longest)) : '') +
    (unk > 60 ? chip('', 'Unknown', duration(unk)) : '');
  if (pw) {
    const ons = pw.filter(([, , s], i) => s === 'on' && pw[i - 1]?.[2] !== 'on');
    const lastOff = pw.filter(([, , s], i) => s === 'off' && pw[i - 1]?.[2] === 'on').pop();
    html += chip('', 'Power on', duration(sum(pw, 'on'))) + chip('', 'Switched on', `${ons.length}×`) +
      (ons.length ? chip('', 'First on', clockHm(ons[0][0])) : '') + (lastOff ? chip('', 'Last off', clockHm(lastOff[0])) : '');
  }
  return html;
}
// lanes: [{name, segs, cls: {state: class}, fill: {state: colour} (instead of a class), on: the "on"
// state (shows on-time and switch count), small}]. legend: HTML instead of the device legend.
function histGraph(lanes, logs, from, to, now, legend) {
  const W = 1000, L = 170, R = 110, gap = 6;
  const x = (t) => L + ((t - from) / (to - from)) * (W - L - R);
  let y = 0;
  lanes.forEach((ln) => { ln.y = y; ln.h = ln.small ? 15 : 22; y += ln.h + gap; });
  const logY = y;
  const H = logY + 14 + 22;
  const word = (s) => (!s ? 'unknown' : s.startsWith('p:') ? (s.endsWith('=1') ? 'on' : 'off') : s);
  const fmt = (a, b, s) => `${word(s)} ${clockHm(a)} – ${clockHm(b)} (${duration(b - a)})`;
  let svg = '';
  // Hour grid: every hour up to 12 h, else every 2/3/6 h.
  const span = (to - from) / 3600, step = (span <= 12 ? 1 : span <= 24 ? 2 : span <= 48 ? 6 : 12) * 3600;
  const first = Math.ceil(from / 3600) * 3600;
  for (let t = first; t <= to; t += 3600) {
    const local = new Date(t * 1000);
    if ((local.getHours() * 3600) % step) continue;
    const anchor = x(t) > W - R - 20 ? 'end' : 'middle';   // the last label stays inside
    svg += `<line class="hist-grid" x1="${x(t)}" x2="${x(t)}" y1="0" y2="${logY + 14}"/><text class="hist-ax" x="${x(t)}" y="${H - 6}" text-anchor="${anchor}">${clockHm(t)}</text>`;
  }
  for (const ln of lanes) {
    const ty = ln.y + ln.h / 2 + 4, short = ln.name.length > 26 ? ln.name.slice(0, 25) + '…' : ln.name;
    svg += `<text class="hist-lbl" x="0" y="${ty}"><title>${esc(ln.name)}</title>${esc(short)}</text><rect class="h-none" x="${L}" y="${ln.y}" width="${W - L - R}" height="${ln.h}" rx="3"/>`;
    for (const [a, b, s] of ln.segs)
      svg += `<rect class="${s ? ln.cls?.[s] || '' : 'h-unk'}"${s && ln.fill?.[s] ? ` style="fill:${esc(ln.fill[s])}"` : ''} x="${x(a)}" y="${ln.y}" width="${Math.max(1, x(b) - x(a))}" height="${ln.h}"><title>${esc(ln.name)}: ${fmt(a, b, s)}</title></rect>`;
    if (ln.on) {   // at the right: how often it went on, and for how long in total
      const n = ln.segs.filter(([, , s], i) => s === ln.on && ln.segs[i - 1]?.[2] !== ln.on).length;
      const t = ln.segs.reduce((sum, [a, b, s]) => sum + (s === ln.on ? b - a : 0), 0);
      svg += `<text class="hist-n" x="${W - R + 8}" y="${ty}">${n}× · ${duration(t)}<title>switched on ${n}×, on for ${duration(t)} in total</title></text>`;
    }
  }
  // Log lane: a tick per line, coloured by level; click jumps to the line.
  svg += `<text class="hist-lbl" x="0" y="${logY + 11}">Log</text>`;
  logs.forEach((m, i) => {
    if (m.e < from || m.e > to) return;
    svg += `<rect class="h-log L${m.l}" data-logi="${i}" x="${x(m.e) - 1.5}" y="${logY}" width="3" height="14"><title>${new Date(m.e * 1000).toTimeString().slice(0, 8)} ${esc(m.m)}</title></rect>`;
  });
  if (now > from && now < to) svg += `<line class="hist-now" x1="${x(now)}" x2="${x(now)}" y1="0" y2="${logY + 14}"><title>now</title></line>`;
  return `<svg class="md-graph" viewBox="0 0 ${W} ${H}">${svg}</svg>
    ${legend != null ? `<div class="row muted md-legend">${legend}</div>` : `<div class="row muted md-legend"><span><i class="h-up"></i>online</span><span><i class="h-down"></i>offline</span>${lanes.some((l) => l.name === 'Power') ? '<span><i class="h-on"></i>power on</span><span><i class="h-off"></i>power off / standby</span>' : ''}${lanes.some((l) => l.small) ? '<span><i class="h-pon"></i>reading on</span><span><i class="h-poff"></i>off</span>' : ''}<span><i class="h-unk"></i>unknown (not checked yet, device offline or controller off)</span></div>`}`;
}

function renderMonitor() {
  const body = $('#monBody');
  if (!body || S.monHold) return;
  // Don't wipe a value someone is typing on a card.
  const a = document.activeElement;
  if (!S.monOpen && a && a.tagName === 'INPUT' && a.type !== 'range' && body.contains(a)) return;
  const st = S.status, p = P();
  const sum = monSummary(st);
  const mon = st?.monitor;
  $('#monSummary').innerHTML = st ? `<span class="chip ok">${sum.online} online</span>
    <span class="chip ${sum.offline ? 'bad' : ''}">${sum.offline} offline</span>
    ${sum.unknown ? `<span class="chip">${sum.unknown} not checked yet</span>` : ''}
    <span class="muted">Last check ${ago(mon?.lastRun)} · next in ${Math.max(0, mon?.nextIn ?? 0)} s · every ${mon?.interval ?? '?'} s</span>` : '<span class="muted">Waiting for controller…</span>';
  const card = (state, title, sub, rows, extra, actions, open) => `<div class="card mon-card ${state}${open ? ' mon-open' : ''}"${open ? ` data-mon-open="${esc(open)}"` : ''}>
    <div class="row nowrap"><span class="dot ${state === 'online' ? 'ok' : state === 'offline' ? 'bad' : ''}"></span><b style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(title)}</b>
      <span class="tag mon-${state}">${state}</span>${open && !S.monOpen ? '<span class="mon-expand" title="Open: history and log">⤢</span>' : ''}</div>
    <div class="muted mono" style="font-size:12px;margin:2px 0 8px 14px">${esc(sub)}</div>
    <div class="mon-rows">${rows.map(([k, v]) => `<span class="muted">${k}</span><span>${v}</span>`).join('')}</div>
    ${extra || ''}${actions ? `<div class="row" style="margin-top:8px">${actions}</div>` : ''}</div>`;
  const s = st?.stats;
  const controller = st ? card(Date.now() - S.statusAt < 4000 ? 'online' : 'offline', 'Controller', `${st.ip} · firmware ${st.version}`, [
    ['Uptime', fmtTime(st.uptime).replace(/\.\d$/, '')], ['Last start', startedText(st.started)], ['Storage device', st.usb ? 'mounted' : '<span class="bad">missing</span>'],
    ['Engine', `${s.engineFps} fps · tick ${s.tickUs} µs`], ['DMX', `${s.dmxFps} fps`],
    ['Art-Net / sACN', `${s.artTx} / ${s.sacnTx} pkt/s`], ['Clock', st.time > 1600000000 ? euDateTime(new Date(st.time * 1000)) : 'not set'],
    ['Memory', memText(s.heap)], ['Lowest free', s.heap ? kb(s.heap.minFree) + ' (since boot)' : '—'],
  ], memBar(s.heap)) : '';
  const pjCard = (x) => {
    const j = st?.projectors?.find((y) => y.id === x.id) || {};
    const state = !j.seen ? 'unknown' : j.online ? 'online' : 'offline';
    const errs = j.errors ? `<div class="row" style="gap:4px;margin-top:6px">${PJ_ERR_PARTS.map((n, k) => {
      const v = j.errors[k];
      return `<span class="tag ${v === '2' ? 'mon-offline' : v === '1' ? 'mon-warn' : 'mon-ok'}" title="${n}: ${v === '2' ? 'error' : v === '1' ? 'warning' : 'ok'}">${n}</span>`;
    }).join('')}</div>` : '';
    const inp = PJ_INPUTS.find(([v]) => v === j.input);
    return card(state, x.name, `${x.ip} · ${j.model || 'projector'}${j.pjName && j.pjName !== x.name ? ' · "' + j.pjName + '"' : ''}`, [
      ['Power', j.power || '—'], ['Lamp', j.lamp != null ? `${j.lamp} h` : '—'],
      ['Input', j.input ? `${j.input}${inp ? ' · ' + inp[1] : ''}` : '—'], ['Mute', j.mute ? PJ_MUTE[j.mute] || j.mute : '—'],
      ['Last seen', ago(j.lastSeen)], ['Last reply', esc(j.last || '—')],
    ], errs + historyBar(j.history, j.checks), `<button class="btn small" data-cmd="projector ${x.id} on">On</button><button class="btn small" data-cmd="projector ${x.id} off">Off</button>`, `projector:${x.id}`);
  };
  const pjCards = p.projectors.map(pjCard);
  const hostCard = (h, kind) => {
    const x = (kind === 'pc' ? p.pcs : p.devices).find((y) => y.name === h.name) || {};
    const rows = [['Ping', h.latency != null && h.state === 'online' ? `${h.latency} ms` : '—'], ['Last seen', ago(h.lastSeen)], ['Last check', ago(h.lastCheck)]];
    if (kind === 'pc') rows.push(['MAC', x.mac || '—'], ['Last action', pcLast(x.id)]);
    return card(h.state, h.name, kind === 'pc' ? h.ip : `${h.ip}${x.port ? ':' + x.port : ''}${x.notes ? ' · ' + x.notes : ''}`, rows,
      historyBar(h.history, h.checks), kind === 'pc' ? pcButtons(x.id) : '', `${kind}:${h.name}`);
  };
  const hosts = mon?.hosts || [];
  // One device opened: its card big, with history and log (see monDetail*).
  if (S.monOpen) {
    const [k, ...rest] = S.monOpen.split(':'), ref = rest.join(':');
    let it = null;
    if (k === 'projector') { const x = p.projectors.find((y) => String(y.id) === ref); if (x) it = { name: x.name, ip: x.ip, power: true, html: () => pjCard(x) }; }
    else if (k === 'drv') { const x = p.drivers.find((y) => String(y.id) === ref); if (x) it = { name: x.name, ip: x.ip, drv: x, html: () => drvMonCard(x, card, false) }; }
    else { const h = hosts.find((y) => y.kind === k && y.name === ref); if (h) it = { name: h.name, ip: h.ip, html: () => hostCard(h, k) }; }
    if (it) {
      if ($('#monDetail')?.dataset.key !== S.monOpen) { body.innerHTML = monDetailHtml(it); monDetailWire(it); }
      const dc = $('#monDetailCard');
      if (!(a && dc.contains(a) && a.tagName === 'INPUT' && a.type !== 'range')) dc.innerHTML = it.html();
      return;
    }
    S.monOpen = null;   // removed from the project
    stopPageLoop('monDetail');
  }
  const section = (title, cards, empty) => `<h3>${title}</h3>${cards.length ? `<div class="grid mon-grid">${cards.join('')}</div>` : `<p class="muted">${empty}</p>`}`;
  const keep = body.scrollTop;
  const tab = monTabList().some(([k]) => k === S.monTab) ? S.monTab : 'all';
  // One show-device type: every device with all its readings and controls.
  if (DRIVERS[tab] || tab === 'board') {
    body.innerHTML = `<div class="grid mon-grid wide">${tab === 'board' ? pmcMonCard(card, false) : p.drivers.filter((x) => x.type === tab).map((x) => drvMonCard(x, card, false)).join('')}</div>`;
    body.scrollTop = keep;
    return;
  }
  const pcSec = () => section('PCs', hosts.filter((h) => h.kind === 'pc').map((h) => hostCard(h, 'pc')), 'No monitored PCs (Devices page).');
  const netSec = () => section('Network devices', hosts.filter((h) => h.kind === 'device').map((h) => hostCard(h, 'device')), 'No monitored network devices (Devices page).') +
    (st?.mqtt?.enabled ? section('MQTT broker', [mqttCard(st.mqtt, card)], '') : '');
  const tcpSec = () => ((st?.io?.tcp?.length || st?.io?.modbus?.length) ? section('TCP & Modbus connections', [
      ...(st.io.tcp || []).map((x) => card(x.state, x.name, `TCP ${x.ip}:${x.port}`, [['Last received', x.lastLine ? esc(x.lastLine) : '—'], ['When', ago(x.lastRx)]])),
      ...(st.io.modbus || []).map((x) => card(x.state, x.name, `Modbus ${x.ip}`, [['Last good poll', ago(x.lastOk)], ['Errors', String(x.errors)],
        ['Variables', esc(p.variables.filter((v) => v.modbus?.device === x.name).map((v) => `${v.name}=${st.vars?.[v.name] ?? '?'}`).join(', ') || '—')]])),
    ], '') : '<p class="muted">Not connected yet (save first).</p>');
  if (tab !== 'all') {
    body.innerHTML = tab === 'projectors' ? section('Projectors', pjCards, '') : tab === 'pcs' ? pcSec() : tab === 'tcp' ? tcpSec() : netSec();
    body.scrollTop = keep;
    return;
  }
  // All: a section per kind, show devices by type.
  const drvSecs = Object.entries(DRIVERS).map(([t, v]) => {
    const list = p.drivers.filter((x) => x.type === t);
    return list.length ? section(v.label, list.map((x) => drvMonCard(x, card, true)), '') : '';
  }).join('');
  body.innerHTML = section('Controller', [controller], '') +
    (pmcUsed() ? section('Machine Control', [pmcMonCard(card, true)], '') : '') +
    (p.projectors.length ? section('Projectors', pjCards, '') : '') +
    pcSec() + drvSecs + netSec() + (p.tcp.length || p.modbus.length ? tcpSec() : '');
  body.scrollTop = keep;
}
views.console = () => `<h2>Console</h2>
  <div class="console" id="consoleOut">${S.consoleLines.join('')}</div>
  <div class="row" style="margin-top:8px;flex-wrap:nowrap"><input id="consoleIn" class="cmd" placeholder="Type a command… (Tab to complete, ↑ for history)" spellcheck="false" autocomplete="off"></div>
  <p class="muted">Commands: ${GRAMMAR.map((g) => g.parts[0]).filter((v, i, a) => a.indexOf(v) === i).join(', ')}</p>`;
views.console.after = () => {
  const inp = $('#consoleIn'), out = $('#consoleOut');
  out.scrollTop = out.scrollHeight;
  inp.focus();
  let h = S.history.length;
  inp.addEventListener('keydown', (e) => {
    if (document.querySelector('.ac[style*="block"] .opt:not(.hint)')) return;
    if (e.key === 'ArrowUp' && h > 0) { inp.value = S.history[--h]; e.preventDefault(); }
    if (e.key === 'ArrowDown') { h = Math.min(S.history.length, h + 1); inp.value = S.history[h] || ''; e.preventDefault(); }
  });
};
async function runConsole() {
  const inp = $('#consoleIn');
  const line = inp.value.trim();
  if (!line) return;
  inp.value = '';
  S.history = S.history.filter((x) => x !== line).concat(line).slice(-100);
  localStorage.setItem('kd.history', JSON.stringify(S.history));
  const push = (cls, text) => {
    S.consoleLines.push(`<div class="${cls}">${esc(text)}</div>`);
    const out = $('#consoleOut');
    if (out) { out.insertAdjacentHTML('beforeend', S.consoleLines[S.consoleLines.length - 1]); out.scrollTop = out.scrollHeight; }
  };
  push('in', '> ' + line);
  const r = await cmd(line);
  push(r.ok ? 'ok' : 'err', r.reply || (r.ok ? 'ok' : 'error'));
}

views.log = () => {
  S.logUnseen = 0;
  updateHeader();
  const f = S.logFilter;
  return `<h2>Live log</h2>
  <div class="logbar">
    <select id="lvMin">${LOG_LVLS.map((l, i) => `<option value="${i}"${f.min === i ? ' selected' : ''}>≥ ${l}</option>`).join('')}</select>
    <div class="cats">${LOG_CATS.map((c) => `<label><input type="checkbox" data-cat="${c}"${f.cats.has(c) ? ' checked' : ''}>${c}</label>`).join('')}</div>
    <input id="lvText" placeholder="Search…" value="${esc(f.text)}" style="width:160px">
    <button class="btn small" id="lvPause">${S.logPaused ? 'Resume' : 'Pause'}</button>
    <button class="btn small" id="lvClear">Clear view</button>
    <button class="btn small" id="lvExport">Export</button>
    <span class="muted" id="logCount"></span>
  </div>
  <div class="log" id="logBox"></div>
  <h3>Firmware log levels</h3>
  <div class="row" id="levels"><span class="muted">loading…</span></div>`;
};
views.log.after = () => {
  const f = S.logFilter;
  const refill = () => {
    const box = $('#logBox');
    box.innerHTML = S.log.filter(logVisible).slice(-2000).map(logRowHtml).join('');
    box.scrollTop = box.scrollHeight;
    $('#logCount').textContent = box.childElementCount + ' shown';
  };
  refill();
  $('#lvMin').addEventListener('change', (e) => { f.min = +e.target.value; refill(); });
  $$('[data-cat]').forEach((el) => el.addEventListener('change', () => { el.checked ? f.cats.add(el.dataset.cat) : f.cats.delete(el.dataset.cat); refill(); }));
  $('#lvText').addEventListener('input', (e) => { f.text = e.target.value; refill(); });
  $('#lvPause').addEventListener('click', (e) => { S.logPaused = !S.logPaused; e.target.textContent = S.logPaused ? 'Resume' : 'Pause'; if (!S.logPaused) refill(); });
  $('#lvClear').addEventListener('click', () => { S.log = []; refill(); });
  $('#lvExport').addEventListener('click', () => {
    const txt = S.log.filter((m) => !m.gap).map((m) => `${logTime(m)}\t${LOG_LVLS[m.l]}\t${m.c}\t${m.m}`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
    a.download = `kd-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.txt`;
    a.click();
  });
  api('/api/loglevels').then((lv) => {
    if (!$('#levels')) return;   // left the page before the answer came
    $('#levels').innerHTML = LOG_CATS.map((c) => `<label class="row muted" style="gap:4px">${c}<select data-lvl="${c}">${LOG_LVLS.map((l) => `<option${lv[c] === l ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`).join('');
    $$('[data-lvl]').forEach((el) => el.addEventListener('change', async () => {
      const r = await cmd(`loglevel ${el.dataset.lvl.toLowerCase()} ${el.value.toLowerCase()}`);
      toast(r.reply, !r.ok);
    }));
  }).catch(() => { if ($('#levels')) $('#levels').innerHTML = '<span class="muted">unavailable</span>'; });
};

// DMX monitor: the live output of one universe, overridden channels in pink. "Channels" shows the
// 512 slots with the patched fixtures marked on them, "Fixtures" one card per fixture. Clicking
// either opens the override panel, laid out like the Scenes programmer: a fader per channel for the
// selected fixtures (Shift/Ctrl+click for more), colour wheel and position pad on the right.
// S.dmxSel = { fxs: [fixture ids] } or { ch: n } (a channel without a fixture) or null.
const dmxSelFx = () => (S.dmxSel?.fxs || []).map(fixture).filter((f) => f && f.universe === S.dmxU);
const dmxFixtures = (u) => P().fixtures.filter((f) => f.universe === u).sort((a, b) => a.address - b.address);
// The DMX channels of a fixture, a 16-bit channel as "<name>" + "<name> fine".
function dmxChannelsOf(f) {
  const out = [];
  for (const s of slots(f)) {
    out.push({ ch: f.address + s.offset, name: s.name });
    if (s.wide) out.push({ ch: f.address + s.offset + 1, name: s.name + ' fine' });
  }
  return out.filter((c) => c.ch >= 1 && c.ch <= 512);
}
// A 512-channel grid (DMX monitor, patch on the Fixtures page): one outline round all channels of a
// fixture (cells with the same data-f). A fixture that wraps onto the next row gets a box per row,
// so the joins depend on how many columns fit (redone on resize).
function outlineFixtures(grid) {
  const join = () => {
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length, cs = grid.children;
    for (let i = 0; i < cs.length; i++) {
      const f = cs[i].dataset.f;
      cs[i].classList.toggle('jr', !!f && (i + 1) % cols !== 0 && cs[i + 1]?.dataset.f === f);
      cs[i].classList.toggle('jl', !!f && i % cols !== 0 && cs[i - 1]?.dataset.f === f);
    }
  };
  join();
  new ResizeObserver(join).observe(grid);
}
const dmxRange = (chs) => (chs.length > 1 ? `${chs[0].ch}-${chs[chs.length - 1].ch}` : `${chs[0].ch}`);
// Fader moves: at most one command every 40 ms, newest value per channel wins (like previewLevels).
const dmxPending = new Map();
let dmxTimer = null;
function dmxSend(key, line) {
  dmxPending.set(key, line);
  if (dmxTimer) return;
  dmxTimer = setTimeout(async () => {
    dmxTimer = null;
    const lines = [...dmxPending.values()];
    dmxPending.clear();
    const r = await cmd(lines.join('\n'));
    if (!r.ok) toast(r.reply, true);
    S.dmxRefresh?.();
  }, 40);
}

views.dmx = () => {
  const fxs = dmxFixtures(S.dmxU), at = {}, selIds = new Set(S.dmxSel?.fxs || []);
  fxs.forEach((f, k) => dmxChannelsOf(f).forEach((c, i) => (at[c.ch] = { f, name: c.name, first: i === 0, odd: k % 2 })));
  const mode = S.dmxMode || 'ch';
  const grid = `<div class="dmx" id="dmxGrid">${Array.from({ length: 512 }, (_, i) => {
    const ch = i + 1, a = at[ch];
    const cls = a ? `fx f${a.odd}${a.first ? ' fs' : ''}${selIds.has(a.f.id) ? ' sel' : ''}` : S.dmxSel?.ch === ch ? 'sel' : '';
    const tip = a ? `${a.f.name} · ${a.name} (${S.dmxU}.${ch})` : `channel ${S.dmxU}.${ch} (no fixture)`;
    return `<div data-ch="${ch}"${a ? ` data-f="${a.f.id}"` : ''} class="${cls}" title="${esc(tip)}"><i></i><b>${ch}</b><em>${a ? esc(a.first ? a.f.name : a.name) : ''}</em><span>0</span></div>`;
  }).join('')}</div>`;
  // A card: live colour (with the icon), intensity, a little position square for moving heads, a bar per channel.
  const cards = fxs.length ? `<div class="dmx-fxs" id="dmxGrid">${fxs.map((f) => {
    const chs = dmxChannelsOf(f), q = posSlots(f);
    return `<div class="dmx-fx${selIds.has(f.id) ? ' sel' : ''}" data-dmxfx="${f.id}">
      <div class="hd"><span class="dot">${fxIcon(f)}</span><div class="nm"><b title="${esc(f.name)}">${esc(f.name)}</b><small>${chs.length ? `${S.dmxU}.${dmxRange(chs)}` : ''}${f.type ? ' · ' + esc(f.type) : ''}</small></div>
        <span class="lvl" title="Intensity"></span>${q.pan && q.tilt ? '<span class="mini-xy" title="Pan / tilt"><i></i></span>' : ''}</div>
      <div class="bars">${chs.map((c) => `<div data-ch="${c.ch}" title="${esc(c.name)} (${S.dmxU}.${c.ch})"><i></i><span>0</span><em>${esc(c.name)}</em></div>`).join('')}</div></div>`;
  }).join('')}</div>` : '<p class="muted">No fixtures patched in this universe.</p>';
  return `<h2>DMX monitor</h2>
  <div class="row" style="margin-bottom:10px"><label class="muted">Universe</label>
    <select id="dmxU">${opts(P().universes, S.dmxU)}</select>
    <div class="seg">${[['ch', 'Channels'], ['fx', 'Fixtures']].map(([k, n]) => `<button class="${mode === k ? 'on' : ''}" data-dmxmode="${k}">${n}</button>`).join('')}</div>
    <span class="dmx-key"><i></i> show output <i class="ovr"></i> override</span>
    <span class="muted">Click a channel or fixture to override it (Shift/Ctrl+click for more). Live output after grand master.</span>
    <button class="btn small" data-cmd="clear overrides" style="margin-left:auto">Clear all overrides</button></div>
  <div id="dmxPanel"></div>
  ${mode === 'ch' ? grid : cards}`;
};
// The panel's faders: one per channel name of the selected fixtures (like the Scenes programmer),
// each with the DMX channels it drives ({ ch, wide }); a channel without a fixture is one fader.
function dmxRows() {
  const sel = dmxSelFx();
  if (!sel.length) return S.dmxSel?.ch ? [{ name: 'channel ' + S.dmxSel.ch, wide: false, to: [{ ch: S.dmxSel.ch, wide: false }] }] : [];
  const rows = [];
  for (const f of sel)
    for (const s of slots(f)) {
      const ch = f.address + s.offset;
      if (ch < 1 || ch + (s.wide ? 1 : 0) > 512) continue;
      let r = rows.find((x) => x.name === s.name);
      if (!r) rows.push((r = { name: s.name, wide: s.wide, to: [] }));
      r.to.push({ ch, wide: s.wide });
    }
  return rows;
}
const dmxRgbFx = (sel) => sel.filter((f) => { const r = channelRoles(f); return r.r && r.g && r.b; });
const dmxPosFx = (sel) => sel.filter((f) => { const q = posSlots(f); return q.pan && q.tilt; });
function dmxPanelHtml(rows) {
  if (!rows.length) return '';
  const sel = dmxSelFx(), one = sel.length === 1 ? sel[0] : null, u = S.dmxU;
  const title = one ? esc(one.name) : sel.length ? sel.length + ' fixtures' : 'Channel ' + S.dmxSel.ch;
  const where = one ? `${u}.${dmxRange(dmxChannelsOf(one))}${one.type ? ' · ' + esc(one.type) : ''}` : sel.length ? '' : `${u}.${S.dmxSel.ch} · no fixture`;
  const side = (dmxRgbFx(sel).length ? colorWheelHtml('dmx', '#000000') + mixToggleHtml(dmxRgbFx(sel)) : '') + (dmxPosFx(sel).length ? xyPadHtml('dmx', 0.5, 0.5) : '');
  return `<div class="sc-prog dmx-panel">
    <div class="row"><span class="fx-ic">${one ? fxIcon(one) : ''}</span><b>${title}</b><span class="muted">${where}</span><span class="spacer"></span>
      ${sel.some((f) => channelRoles(f).dim) ? '<button class="btn small" data-dmxdim="255">Full</button><button class="btn small" data-dmxdim="128">50%</button><button class="btn small" data-dmxdim="0">Off</button>' : ''}
      <button class="btn small" data-dmxall="255" title="Override every channel at full">All full</button>
      <button class="btn small" data-dmxall="0" title="Override every channel at zero">All zero</button>
      <button class="btn small" data-dmxrel title="Let the show drive ${sel.length ? 'these fixtures' : 'this channel'} again">Release</button>
      <button class="btn small ghost" data-dmxclose title="Close (Esc); the overrides stay">✕</button></div>
    <div class="sc-body"><div class="sc-chs">${rows.map((r, i) => {
      const max = r.wide ? 65535 : 255;
      return `<div class="sc-ch dmx-row" data-row="${i}"><span class="sc-chn" title="${esc(r.name)}${r.wide ? ' (16-bit)' : ''} · ${r.to.map((t) => `${u}.${t.ch}`).join(', ')}">${esc(r.name)}</span>
        <input type="range" min="0" max="${max}" value="0"><input type="number" min="0" max="${max}" value="0">
        <span class="muted sc-pct">0%</span><span class="sc-note"></span>
        <button class="btn small ghost" data-dmxrelrow="${i}" title="Release this channel (back to the show)">↺</button></div>`;
    }).join('')}</div>${side ? `<div class="sc-side">${side}</div>` : ''}</div>
  </div>`;
}
views.dmx.after = () => {
  const u = S.dmxU;
  let rows = [], live = null;   // live: the last poll, { v: values, o: Set of overridden channels }
  // A target's value in the row's resolution (a 16-bit fader on an 8-bit channel and the other way).
  const valOf = (t, wide) => {
    const v = live?.v || [], raw = t.wide ? ((v[t.ch - 1] ?? 0) << 8) | (v[t.ch] ?? 0) : v[t.ch - 1] ?? 0;
    return wide === t.wide ? raw : wide ? raw * 257 : raw >> 8;
  };
  const chansOf = (t) => (t.wide ? [t.ch, t.ch + 1] : [t.ch]);
  const send = (t, v, wide) => {
    const x = Math.max(0, Math.round(wide === t.wide ? v : wide ? v / 257 : v * 257));
    if (t.wide) { dmxSend(t.ch, `set ${u}.${t.ch} ${Math.min(65535, x) >> 8}`); dmxSend(t.ch + 1, `set ${u}.${t.ch + 1} ${Math.min(65535, x) & 255}`); }
    else dmxSend(t.ch, `set ${u}.${t.ch} ${Math.min(255, x)}`);
  };
  const slotTarget = (f, s) => ({ ch: f.address + s.offset, wide: s.wide });
  const run = async (lines) => {
    if (!lines.length) return;
    const r = await cmd(lines.join('\n'));
    if (!r.ok) toast(r.reply, true);
    refresh();
  };
  const ranges = () => { const sel = dmxSelFx(); return sel.length ? sel.map((f) => `${u}.${dmxRange(dmxChannelsOf(f))}`) : S.dmxSel?.ch ? [`${u}.${S.dmxSel.ch}`] : []; };

  const showPanel = () => {
    rows = dmxRows();
    $('#dmxPanel').innerHTML = dmxPanelHtml(rows);
    $$('.dmx-row').forEach((el) => {
      const r = rows[+el.dataset.row], [rng, num] = el.querySelectorAll('input'), max = r.wide ? 65535 : 255;
      const set = (v) => {
        v = Math.max(0, Math.min(max, Math.round(v) || 0));
        rng.value = num.value = v;
        el.querySelector('.sc-pct').textContent = Math.round((v / max) * 100) + '%';
        el.classList.add('ovr');
        for (const t of r.to) send(t, v, r.wide);
      };
      rng.addEventListener('input', () => set(+rng.value));
      num.addEventListener('change', () => set(+num.value));
      // Don't let the poll move a fader you are holding or a number you are typing.
      rng.addEventListener('pointerdown', () => (rng.dataset.busy = 1));
      rng.addEventListener('pointerup', () => delete rng.dataset.busy);
      num.addEventListener('focus', () => (num.dataset.busy = 1));
      num.addEventListener('blur', () => delete num.dataset.busy);
    });
    const sel = dmxSelFx();
    // Colour wheel: r, g, b of every selected colour fixture; a dimmer the show has at zero and
    // that isn't overridden goes to full, so the colour shows (like picking a colour in a scene).
    const cw = $('[data-cw="dmx"]');
    if (cw) attachColorWheel(cw, '#000000', (hex) => {
      const rgb = hexToRgb(hex);
      for (const f of dmxRgbFx(sel)) {
        const ro = channelRoles(f);
        if (ro.dim) { const t = slotTarget(f, ro.dim); if (!chansOf(t).some((c) => live?.o.has(c)) && !valOf(t, false)) send(t, 255, false); }
        const mx = mixColor(f, rgb), m = mixRoles(f);
        for (const k in mx) send(slotTarget(f, m[k]), mx[k], false);
      }
    });
    wireMixToggle(showPanel);
    const xy = $('[data-xy="dmx"]');
    if (xy) attachXyPad(xy, 0.5, 0.5, (x, y) => {
      for (const f of dmxPosFx(sel)) { const q = posSlots(f); send(slotTarget(f, q.pan), x * 65535, true); send(slotTarget(f, q.tilt), y * 65535, true); }
    });
    refresh();
  };
  const markSel = () => {
    $$('#dmxGrid .sel').forEach((el) => el.classList.remove('sel'));
    for (const f of dmxSelFx()) {
      $(`#dmxGrid [data-dmxfx="${f.id}"]`)?.classList.add('sel');
      for (const c of dmxChannelsOf(f)) $(`#dmxGrid > [data-ch="${c.ch}"]`)?.classList.add('sel');
    }
    if (S.dmxSel?.ch) $(`#dmxGrid > [data-ch="${S.dmxSel.ch}"]`)?.classList.add('sel');
  };
  const select = (sel) => { S.dmxSel = sel; markSel(); showPanel(); };
  $('#dmxU').addEventListener('change', (e) => { S.dmxU = +e.target.value; S.dmxSel = null; render(); });
  $$('[data-dmxmode]').forEach((b) => b.addEventListener('click', () => { S.dmxMode = b.dataset.dmxmode; render(); }));
  if ($('#dmxGrid.dmx')) outlineFixtures($('#dmxGrid'));
  $('#dmxGrid')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-dmxfx]'), d = e.target.closest('[data-ch]');
    if (!card && !d) return;
    const id = card ? +card.dataset.dmxfx : dmxFixtures(u).find((f) => dmxChannelsOf(f).some((c) => c.ch === +d.dataset.ch))?.id;
    if (id == null) return select({ ch: +d.dataset.ch });
    // Shift/Ctrl+click adds or removes a fixture, like on the Scenes page.
    if ((e.shiftKey || e.ctrlKey || e.metaKey) && S.dmxSel?.fxs) {
      const ids = S.dmxSel.fxs.includes(id) ? S.dmxSel.fxs.filter((x) => x !== id) : [...S.dmxSel.fxs, id];
      return select(ids.length ? { fxs: ids } : null);
    }
    select({ fxs: [id] });
  });
  $('#dmxPanel').addEventListener('click', (e) => {
    const b = e.target.closest('button'), d = b?.dataset;
    if (!b) return;
    if (b.hasAttribute('data-dmxclose')) return select(null);
    if (d.dmxall != null) return run(ranges().map((r) => `set ${r} ${d.dmxall}`));
    if (b.hasAttribute('data-dmxrel')) return run(ranges().map((r) => `clear override ${r}`));
    if (d.dmxrelrow != null) return run(rows[+d.dmxrelrow].to.map((t) => `clear override ${u}.${chansOf(t).join('-')}`));
    if (d.dmxdim != null) {
      for (const f of dmxSelFx()) { const s = channelRoles(f).dim; if (s) send(slotTarget(f, s), +d.dmxdim, false); }
    }
  });

  // One poll paints the grid or cards and the panel.
  const cells = $$('#dmxGrid [data-ch]').map((el) => ({ el, ch: +el.dataset.ch, bar: el.querySelector('i'), val: el.querySelector('span') }));
  const cards = $$('#dmxGrid [data-dmxfx]').map((el) => ({ el, f: fixture(+el.dataset.dmxfx), lvl: el.querySelector('.lvl'), xy: el.querySelector('.mini-xy i') }));
  let busy = false;
  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      const d = await api(`/api/dmx?u=${u}&o=1`);
      if (S.view !== 'dmx' || S.dmxU !== u) return;
      live = { v: d.v || [], o: new Set(d.o || []) };
      const v = live.v, ovr = live.o, dmx = { [u]: v };
      for (const c of cells) {
        const x = v[c.ch - 1] ?? 0;
        c.val.textContent = x;
        c.bar.style.height = (x / 255) * 100 + '%';
        c.el.classList.toggle('ovr', ovr.has(c.ch));
      }
      for (const c of cards) {
        if (!c.f) continue;
        c.el.classList.toggle('ovr', dmxChannelsOf(c.f).some((x) => ovr.has(x.ch)));
        const look = fixtureLook(c.f, dmx);
        paintDot(c.el.querySelector('.dot'), look, cards.length <= 40);
        c.lvl.textContent = look ? Math.round(look.level * 100) + '%' : '';
        if (c.xy) {
          const q = posSlots(c.f);
          c.xy.style.left = (valOf(slotTarget(c.f, q.pan), true) / 65535) * 100 + '%';
          c.xy.style.top = (valOf(slotTarget(c.f, q.tilt), true) / 65535) * 100 + '%';
        }
      }
      const pending = (t) => chansOf(t).some((c) => dmxPending.has(c));
      for (const el of $$('.dmx-row')) {
        const r = rows[+el.dataset.row], max = r.wide ? 65535 : 255, vs = r.to.map((t) => valOf(t, r.wide));
        const n = r.to.filter((t) => chansOf(t).some((c) => ovr.has(c))).length;
        el.classList.toggle('ovr', n > 0);
        el.querySelector('.sc-note').textContent = n ? (n < r.to.length ? `override ${n} of ${r.to.length}` : 'override') : new Set(vs).size > 1 ? 'mixed' : '';
        if (r.to.some(pending)) continue;
        for (const i of el.querySelectorAll('input')) if (!i.dataset.busy) i.value = vs[0];
        if (!el.querySelector('[data-busy]')) el.querySelector('.sc-pct').textContent = Math.round((vs[0] / max) * 100) + '%';
      }
      // The wheel and the pad follow the first fixture (not while you use them).
      const sel = dmxSelFx(), rf = dmxRgbFx(sel)[0], pf = dmxPosFx(sel)[0];
      if (rf) {
        const m = mixRoles(rf), ts = Object.values(m).filter(Boolean).map((s) => slotTarget(rf, s));
        if (!ts.some(pending)) $('[data-cw="dmx"]')?.setHex?.(rgbToHex(...mixedRgb(rf, (s) => valOf(slotTarget(rf, s), false))));
      }
      if (pf) { const q = posSlots(pf), tp = slotTarget(pf, q.pan), tt = slotTarget(pf, q.tilt); if (!pending(tp) && !pending(tt)) $('[data-xy="dmx"]')?.setXY?.(valOf(tp, true) / 65535, valOf(tt, true) / 65535); }
    } catch { /* offline */ } finally { busy = false; }
  }
  S.dmxRefresh = refresh;
  if (S.dmxSel) { markSel(); showPanel(); } else refresh();
  pagePoll('dmx', refresh, 250);
};
views.dmx.keys = (e) => { if (e.key === 'Escape' && S.dmxSel) { S.dmxSel = null; render(); } };

// Modes page: the live state of each mode group (click to set), when it changed (history), and
// the groups: states, power-up state, linked variable, and per state a colour / icon and the
// actions when it starts or ends (stateInfo, run by Triggers.cpp as hidden triggers).
// States are keys in stateInfo and in data-p paths: no dots in their names.
const MODE_PALETTE = ['#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#f778ba', '#39c5cf', '#ff7b72', '#8b949e'];
// Preset state colours (any other through "+"); readable with white text on the buttons.
const MODE_COLORS = ['#2e7d32', '#3fb950', '#00897b', '#0288d1', '#3a7bd5', '#5e35b1', '#8e24aa', '#d81b60', '#b71c1c', '#e65100', '#f9a825', '#6d4c41', '#616161', '#263238'];
// The icon picker's choices, by theme; "Other" takes any emoji or short text.
const MODE_ICONS = [
  ['Status', '🟢 🟡 🟠 🔴 🔵 🟣 ⚪ ⚫ ✅ ❌ ⚠️ ⛔ 🚨 🔒 🔓 ⏻'],
  ['Show', '▶️ ⏸️ ⏹️ ⏺️ ⏭️ 🔁 🎭 🎬 🎵 🎤 🔊 🔇 💡 🔦 📽️ 🎥 🖥️ 📺'],
  ['Time', '⏳ ⏰ 🕐 📅 ☀️ 🌅 🌙 🌃 ❄️ 🌧️'],
  ['Building', '🏛️ 🏠 🚪 👥 🧍 🎉 ☕ 🚻 🅿️ 🔥 💧 🌡️'],
  ['Technical', '🔧 🛠️ ⚙️ 🧹 🔌 🔋 📶 🧪 🔍 📋 ⭐ ❤️'],
].map(([name, list]) => [name, list.split(' ')]);
function modeIconPop(base, s, cur) {
  return `<div class="icon-pop">
    ${MODE_ICONS.map(([name, list]) => `<div class="muted">${name}</div><div class="icon-grid">${list.map((x) =>
      `<button class="${x === cur ? 'on' : ''}" data-mseticon="${esc(x)}" title="${esc(x)}">${x}</button>`).join('')}</div>`).join('')}
    <div class="row nowrap" style="margin-top:6px"><span class="muted">Other</span>
      <input data-p="${esc(`${base}.stateInfo.${s}.icon`)}" value="${esc(cur || '')}" maxlength="4" style="width:70px" title="Any emoji (Windows: Win + .) or a short text" data-r>
      <button class="btn small ghost" data-mseticon="">No icon</button></div>
  </div>`;
}
// The state's own colour, or one from the palette by its place (history graph).
const modeColor = (g, s) => g.stateInfo?.[s]?.color || MODE_PALETTE[Math.max(0, g.states.indexOf(s)) % MODE_PALETTE.length];
views.modes = () => {
  const p = P();
  p.modes.forEach((g) => g.states.forEach((s) => (g.stateInfo[s] ??= {})));   // so data-p paths into it work
  const r = (S.modeHistDay ??= ymd(new Date()));
  return `<h2>Modes</h2>
  ${p.modes.length ? `<div class="card"><h3 style="margin-top:0">Now</h3><div id="modes" class="mode-groups">${modesNowHtml()}</div></div>
  <div class="card md-hist">
    <div class="row"><h3 style="margin:0;flex:1">History</h3>
      <button class="btn small" data-mhday="-1" title="Day before">◀</button><input type="date" id="mhDate" value="${r}">
      <button class="btn small" data-mhday="1" title="Day after">▶</button><button class="btn small" data-mhday="0">Today</button></div>
    <div id="mhGraph">${S.modeHistHtml?.day === r ? S.modeHistHtml.graph : '<span class="muted">loading…</span>'}</div>
    <div id="mhChanges" class="mode-changes">${S.modeHistHtml?.day === r ? S.modeHistHtml.changes : ''}</div>
  </div>` : ''}
  <h3>Mode groups</h3>
  ${p.modes.map(modeGroupCard).join('')}
  <div class="row" style="margin-top:6px"><button class="btn small" data-add="modegroup">+ Mode group</button></div>
  <p class="muted">Each group has one active state at a time, kept across reboots unless you pick a state <b>at power-up</b> (like the Pharos Management Mode module, but several at once).
    Set with <code>mode Curtains Open</code> or step with <code>mode Curtains next</code> / <code>previous</code> / <code>toggle</code> / <code>back</code>;
    react with a <b>Mode change</b> trigger or the actions <b>when it starts / ends</b> below; check with <code>mode Museum is Open</code> or <code>mode Museum is Open for 10m</code>;
    use the state in any command as <code>{mode.Museum}</code>. A trigger's <b>Only active in</b> setting makes it fire only in some states.
    Other systems: <code>GET /api/mode?group=Museum</code> reads it, <code>&amp;state=Open</code> sets it (also <code>cmd:mode Museum Open</code> on the UDP port, or OSC <code>/kd/cmd "mode Museum Open"</code>).
    New or renamed groups and states can be set here after saving.</p>`;
};
function modeGroupCard(g, i) {
  const p = P(), base = `modes.${i}`;
  const onlyHere = (s) => p.triggers.filter((t) => t.onlyIn?.group === g.name && t.onlyIn.states?.includes(s));
  const acts = (s, k) => `${(g.stateInfo[s][k] || []).map((a, j) => { const path = `${base}.stateInfo.${s}.${k}.${j}`; return `<div class="row nowrap" style="margin-bottom:4px">
      <input class="cmd" data-p="${esc(path)}" value="${esc(a)}" spellcheck="false" autocomplete="off">
      <button class="btn small" data-build="${esc(path)}" title="Build with menus">⚙</button>
      <button class="btn small" data-test="${esc(path)}" title="Run this line now">Test</button>
      <button class="btn small ghost" data-del="${esc(path)}">✕</button></div>`; }).join('')}
    <button class="btn small ghost" data-madd="${i}" data-mstate="${esc(s)}" data-mkind="${k}">+ Action</button>`;
  const v = p.variables.find((x) => x.name === g.var), probs = modeProblems(g);
  return `<div class="card mode-card">
    ${probs.length ? `<div class="bad" style="margin-bottom:8px">${probs.map((x) => `<div>! ${esc(x)}</div>`).join('')}</div>` : ''}
    <div class="form">
      <label>Group</label><div class="row nowrap"><input data-p="${base}.name" data-mrename="${i}" value="${esc(g.name)}" data-r>
        <button class="btn small ghost" data-del="modes.${i}" title="Delete this group">✕</button></div>
      <label>States</label><input data-mstates="${i}" value="${esc(g.states.join(', '))}" placeholder="Open, Closed" title="Comma separated. Rename one in place and its settings, startup state and trigger links follow.">
      <label title="Which state the group is in after the controller starts. Saving the project never changes the state.">At power-up</label>
      <select data-p="${base}.startup" data-r><option value="">the state it was in (kept across reboots)</option>${g.states.map((s) => `<option${g.startup === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <label title="The variable follows the state, and setting the variable changes the state - so a Modbus or KNX point linked to the variable can read and set the mode">Variable</label>
      <div class="row nowrap"><select data-p="${base}.var" data-r><option value="">none</option>${p.variables.map((x) => `<option${g.var === x.name ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}${g.var && !v ? `<option selected>${esc(g.var)} (missing)</option>` : ''}</select>
        <span class="muted">${g.var ? (v?.type === 'number' ? 'gets the state’s number (1, 2…); setting it to a number changes the state' : 'gets the state’s name; setting it to a state name (or number) changes the state') : 'follows the state both ways, e.g. for a PLC'}</span></div>
    </div>
    <table class="mode-states"><tr><th>State</th><th title="Colour and icon on the Modes page, the touch panel header and in the history">Look</th><th>When it starts</th><th>When it ends</th></tr>
    ${g.states.map((s, si) => {
      const info = g.stateInfo[s], here = onlyHere(s), cpath = esc(`${base}.stateInfo.${s}.color`);
      const custom = info.color && !MODE_COLORS.includes(info.color) ? info.color : '';
      const picking = S.modeIconPick === `${i}|${s}`;
      return `<tr><td><b>${info.icon ? esc(info.icon) + ' ' : ''}${esc(s)}</b>${here.length ? `<div class="muted" style="font-size:12px;margin-top:4px">Only active here: ${here.map((t) => `<a href="#" data-goto-trigger="${t.id}">#${t.id} ${esc(t.name || '')}</a>`).join(', ')}</div>` : ''}</td>
        <td><div class="row swatches mode-look">
          <span class="icon-pick"><button class="btn small mode-icon-btn${picking ? ' on' : ''}" data-micon="${i}" data-mstate="${esc(s)}" title="Pick an icon">${info.icon ? esc(info.icon) : '<span class="muted">icon</span>'}</button>
            ${picking ? modeIconPop(base, s, info.icon) : ''}</span>
          <button class="swatch${info.color ? '' : ' on'}" data-mnocolor="${i}" data-mstate="${esc(s)}" title="No colour">∅</button>
          ${MODE_COLORS.map((c) => `<label class="swatch${info.color === c ? ' on' : ''}" title="${c}" style="background:${c}"><input type="radio" name="mcol-${i}-${si}" data-p="${cpath}" value="${c}"${info.color === c ? ' checked' : ''} data-r></label>`).join('')}
          <label class="swatch custom${custom ? ' on' : ''}" title="Other colour" style="${custom ? `background:${esc(custom)}` : ''}">${custom ? '' : '+'}<input type="color" data-p="${cpath}" value="${esc(custom || '#4aa3ff')}" data-r></label></div></td>
        <td>${acts(s, 'enter')}</td><td>${acts(s, 'leave')}</td></tr>`;
    }).join('')}</table>
  </div>`;
}
// What won't work in a mode group (shown on its card; also tools/check-project.js).
function modeProblems(g) {
  const out = [];
  if (g.startup && !g.states.includes(g.startup)) out.push(`At power-up: '${g.startup}' is not one of its states`);
  if (g.var && !P().variables.some((v) => v.name === g.var)) out.push(`Variable '${g.var}' doesn't exist`);
  if (g.var && P().variables.find((v) => v.name === g.var)?.type === 'bool' && g.states.length !== 2) out.push(`Variable '${g.var}' is on/off: it only fits a group with 2 states`);
  for (const s of g.states) for (const k of ['enter', 'leave']) (g.stateInfo?.[s]?.[k] || []).forEach((a, i) => {
    if (!a.trim() || a.trim().startsWith('#')) return;
    const v = validate(a);
    if (!v.ok) out.push(`${s}, ${k === 'enter' ? 'when it starts' : 'when it ends'} line ${i + 1}: ${v.error}`);
  });
  return out;
}
// A group or state renamed: the trigger settings, startup state and state settings that name it follow.
function renameModeRefs(g, oldState, newName) {
  const p = P();
  if (oldState == null) {   // the group
    p.triggers.forEach((t) => {
      if (t.onlyIn?.group === g.name) t.onlyIn.group = newName;
      if (t.type === 'mode' && t.group === g.name) t.group = newName;
    });
    return;
  }
  if (g.stateInfo[oldState]) { g.stateInfo[newName] = g.stateInfo[oldState]; delete g.stateInfo[oldState]; }
  if (g.startup === oldState) g.startup = newName;
  p.triggers.forEach((t) => {
    if (t.onlyIn?.group === g.name) t.onlyIn.states = (t.onlyIn.states || []).map((s) => (s === oldState ? newName : s));
    if (t.type === 'mode' && t.mode === oldState && (!t.group || t.group === g.name)) t.mode = newName;
  });
}
views.modes.after = () => {
  renderModes();
  $$('[data-mstates]').forEach((el) => el.addEventListener('change', () => {
    const g = P().modes[+el.dataset.mstates];
    if (el.value.includes('.')) toast('A state name can’t have a dot in it: removed', true);
    const states = [...new Set(el.value.split(',').map((s) => s.replace(/\./g, '').trim()).filter(Boolean))];
    // One name changed in place (same number of states): a rename.
    const diff = states.length === g.states.length ? states.map((s, k) => k).filter((k) => states[k] !== g.states[k]) : [];
    if (diff.length === 1) renameModeRefs(g, g.states[diff[0]], states[diff[0]]);
    g.states = states;
    for (const k of Object.keys(g.stateInfo)) if (!states.includes(k)) delete g.stateInfo[k];   // a removed state's settings
    if (g.startup && !states.includes(g.startup)) delete g.startup;
    markDirty();
    render();
  }));
  // Before the binding writes the new name (it listens on #main, this on the field).
  $$('[data-mrename]').forEach((el) => el.addEventListener('change', () => {
    const g = P().modes[+el.dataset.mrename];
    if (el.value && el.value !== g.name) renameModeRefs(g, null, el.value);
  }));
  $$('[data-madd]').forEach((b) => b.addEventListener('click', () => {
    const info = P().modes[+b.dataset.madd].stateInfo[b.dataset.mstate];
    (info[b.dataset.mkind] ??= []).push('');
    markDirty();
    render();
    $(`[data-p="${CSS.escape(`modes.${b.dataset.madd}.stateInfo.${b.dataset.mstate}.${b.dataset.mkind}.${info[b.dataset.mkind].length - 1}`)}"]`)?.focus();
  }));
  // Icon picker: one open at a time (S.modeIconPick = "group index|state"); a click outside closes it.
  $$('[data-micon]').forEach((b) => b.addEventListener('click', () => {
    const k = `${b.dataset.micon}|${b.dataset.mstate}`;
    S.modeIconPick = S.modeIconPick === k ? null : k;
    render();
  }));
  $$('[data-mseticon]').forEach((b) => b.addEventListener('click', () => {
    const [gi, s] = S.modeIconPick.split(/\|(.*)/s);
    const info = P().modes[+gi].stateInfo[s];
    if (b.dataset.mseticon) info.icon = b.dataset.mseticon; else delete info.icon;
    S.modeIconPick = null;
    markDirty();
    render();
  }));
  const pop = $('.icon-pop');
  if (pop) {
    const outside = (e) => {
      if (!pop.isConnected) return document.removeEventListener('pointerdown', outside, true);
      if (pop.contains(e.target) || e.target.closest('[data-micon]')) return;
      // Closed in place, not by render(): the click that closes it still reaches what was clicked.
      document.removeEventListener('pointerdown', outside, true);
      S.modeIconPick = null;
      pop.previousElementSibling?.classList.remove('on');
      pop.remove();
    };
    document.addEventListener('pointerdown', outside, true);
  }
  $$('[data-mnocolor]').forEach((b) => b.addEventListener('click', () => {
    delete P().modes[+b.dataset.mnocolor].stateInfo[b.dataset.mstate].color;
    markDirty();
    render();
  }));
  const day = (d) => { S.modeHistDay = d; $('#mhDate').value = d; pagePoll('modeHist', modeHistLoad, 30000); };
  $('#mhDate')?.addEventListener('change', (e) => e.target.value && day(e.target.value));
  $$('[data-mhday]').forEach((b) => b.addEventListener('click', () => {
    const d = new Date(`${S.modeHistDay}T12:00`);
    d.setDate(d.getDate() + +b.dataset.mhday);
    day(+b.dataset.mhday ? ymd(d) : ymd(new Date()));
  }));
  if ($('#mhGraph')) pagePoll('modeHist', modeHistLoad, 30000);
};
views.modes.keys = (e) => { if (e.key === 'Escape' && S.modeIconPick) { S.modeIconPick = null; render(); } };
// Called on every status: the buttons are only rebuilt when a state changes (a rebuild under the
// mouse would swallow a click), the "since" text is updated in place.
function renderModes() {
  const el = $('#modes');
  if (!el) return;
  const now = S.status?.time > 1600000000 ? S.status.time : Date.now() / 1000;
  const html = modesNowHtml();
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
  $$('[data-mfor]', el).forEach((s) => {
    const secs = S.status?.modeFor?.[P().modes[+s.dataset.mfor]?.name];
    s.textContent = secs != null ? `since ${clockHm(now - secs)} · ${duration(secs)}` : '';
    s.title = secs != null ? `Since ${euDateTime(new Date((now - secs) * 1000))}` : '';
  });
}
// The state buttons; also put in by views.modes itself, so the page has its full height before
// render() restores the scroll position (filled in later, the editor below jumped down).
function modesNowHtml() {
  return P().modes.map((g, i) => {
    const cur = S.status?.modes?.[g.name];
    return `<div class="row mode-group"><b>${esc(g.name)}</b>${g.states.map((s) => {
      const info = g.stateInfo?.[s] || {}, on = cur === s;
      const style = info.color ? ` style="--mc:${esc(info.color)}"` : '';
      return `<button class="toggle${on ? ' on' : ''}${info.color ? ' mcol' : ''}"${style} data-cmd="mode ${esc(quote(g.name))} ${esc(quote(s))}">${info.icon ? `<span>${esc(info.icon)}</span>` : ''}${esc(s)}</button>`;
    }).join('')}
      ${cur ? `<span class="muted" data-mfor="${i}"></span>` : '<span class="muted">not set</span>'}</div>`;
  }).join('');
}
// History of every group for one day: a lane per group from the device history ("mode:<group>",
// m:<state> lines, Monitor::record), and the changes with who made them from the log.
async function modeHistLoad() {
  const groups = P().modes, from = new Date(`${S.modeHistDay}T00:00`).getTime() / 1000, to = from + 86400;
  let res;
  try {
    res = await Promise.all(groups.map((g) => {
      const q = `from=${from}&to=${to}`;
      return Promise.all([api(`/api/history?name=${encodeURIComponent('mode:' + g.name)}&${q}`), api(`/api/devlog?name=${encodeURIComponent(g.name)}&${q}`)]);
    }));
  } catch (e) {
    if ($('#mhGraph')) $('#mhGraph').innerHTML = `<span class="bad">Could not read the history: ${esc(e.message)}</span>`;
    return;
  }
  if (!$('#mhGraph') || from !== new Date(`${S.modeHistDay}T00:00`).getTime() / 1000) return;
  const now = S.status?.time > 1600000000 ? S.status.time : Date.now() / 1000;
  const state = (s) => (s.startsWith('m:') ? decodeURIComponent(s.slice(2)) : undefined);
  const lanes = groups.map((g, k) => ({ name: g.name, segs: histSegments(res[k][0], from, to, now, state), fill: Object.fromEntries(g.states.map((s) => [s, modeColor(g, s)])) }));
  // "Mode Museum changed: Closed -> Open (by trigger 5)" (State::setMode)
  const changes = [];
  groups.forEach((g, k) => res[k][1].forEach((m) => {
    const x = /^Mode (.+) changed: (.*) -> (.*?)(?: \(by (.*)\))?$/.exec(m.m);
    if (x && x[1] === g.name) changes.push({ ...m, g, old: x[2], s: x[3], by: x[4] || '' });
  }));
  changes.sort((a, b) => a.e - b.e);
  const legend = groups.map((g) => `<span><b>${esc(g.name)}:</b></span>${g.states.map((s) => `<span><i style="background:${esc(modeColor(g, s))}"></i>${esc(s)}</span>`).join('')}`).join('') +
    '<span><i class="h-unk"></i>unknown (controller off, or not set)</span>';
  $('#mhGraph').innerHTML = histGraph(lanes, changes, from, to, now, legend);
  const who = (by) => {
    const t = /^trigger (\d+)$/.exec(by), tr = t && P().triggers.find((x) => x.id === +t[1]);
    return tr ? `trigger <a href="#" data-goto-trigger="${tr.id}">#${tr.id} ${esc(tr.name || '')}</a>` : +t?.[1] >= 20001 ? 'the actions of a state' : esc({ web: 'the web UI', http: 'HTTP', udp: 'UDP', osc: 'OSC' }[by] || by || '?');
  };
  $('#mhChanges').innerHTML = changes.length ? changes.slice().reverse().map((c) => `<div class="row nowrap"><span class="mono muted">${new Date(c.e * 1000).toTimeString().slice(0, 8)}</span>
      <b>${esc(c.g.name)}</b> <span>${esc(c.old)} → <b style="color:${esc(modeColor(c.g, c.s))}">${esc(c.s)}</b></span><span class="muted">by ${who(c.by)}</span></div>`).join('')
    : '<div class="muted">No changes on this day.</div>';
  // Shown at once by the next render (an edit on this page), so the page keeps its height.
  S.modeHistHtml = { day: S.modeHistDay, graph: $('#mhGraph').innerHTML, changes: $('#mhChanges').innerHTML };
}

// Settings > Network: what the controller's interface really uses (/api/status "net").
function netLiveHtml() {
  const n = S.status?.net;
  if (!n) return '<div class="muted">Not known (no answer from the controller, or older firmware).</div>';
  const mode = { dhcp: 'DHCP', fixed: 'Fixed address', fallback: 'Fallback address: DHCP is on, but no DHCP server answered', 'dhcp-asking': 'Asking DHCP…' }[n.mode] || n.mode;
  const link = n.link == null ? '?' : n.link ? '<span class="dot ok"></span> Connected' : '<span class="dot bad"></span> No link: check the cable and the switch port';
  const w = P().network, fixed = w.dhcp === false;
  const pending = !n.mock && n.ip && (fixed !== (n.mode === 'fixed') || (fixed && (n.ip !== String(w.ip || '').trim() || n.mask !== String(w.mask || '').trim())));
  const rows = [['Link', link], ['Mode', esc(mode)], ['IP address', esc(n.ip || '—')], ['Subnet mask', esc(n.mask || '—')],
    ['Gateway', esc(n.gateway || '—')], ['DNS', esc((n.dns || []).join(', ') || '—')], ['MAC', `<code>${esc(n.mac || '')}</code>`]];
  return `<div class="form">${rows.map(([k, v]) => `<label>${k}</label><span>${v}</span>`).join('')}</div>`
    + (pending ? '<div class="muted" style="margin-top:6px">The setting on the left differs: it is used after the controller restarts (save first).</div>' : '')
    + (n.mock ? '<div class="muted" style="margin-top:6px">PC mock: no real network, this shows the saved setting.</div>' : '');
}

// Network test (NetSafe in the firmware): after saving a changed network setting the controller
// can switch at once and goes back after 2 minutes unless a browser reaches it at the new
// address. Any editor page that sees a test running in the status confirms it (it reached the
// controller); this page also knocks on the new fixed address itself.
function netTrialSeen() {
  if (Date.now() - (S.netConfirmAt || 0) < 2000) return;
  S.netConfirmAt = Date.now();
  fetch('/api/network/confirm', { method: 'POST' }).then((r) => r.json())
    .then((j) => { if (j.ok) toast('Network setting kept: the controller answers at this address'); }).catch(() => {});
}
async function netTrialOffer() {
  if (!isLive() && !S.status?.net?.testable) return;   // the PC mock only when started for testing
  const n = P().network, to = n.dhcp !== false ? 'DHCP' : n.ip;
  if (!confirm(`The network setting changed (now: ${to}).\n\nOK = switch to it now, safely: the controller goes back to the old setting after 2 minutes unless a browser reaches it at the new address.\n\nCancel = use it after the next restart (without that safety).`)) return;
  try { await api('/api/network/try', { method: 'POST' }); } catch (e) { toast('Network test not started: ' + e.message, true); return; }
  netTrialDialog(n);
}
function netTrialDialog(n) {
  const fixed = n.dhcp !== false ? null : `http://${n.ip.trim()}`, start = Date.now(), total = 120;
  const back = S.status?.net?.ip ? `${S.status.net.mode === 'fixed' ? '' : 'DHCP, '}${S.status.net.ip}` : 'the old setting';
  const ov = document.createElement('div');
  ov.className = 'net-ov';
  ov.innerHTML = `<div class="card"><h3>Network test</h3><div id="ntText"></div><div class="row" style="margin-top:12px">
    ${fixed && fixed !== location.origin ? `<a class="btn" href="${esc(fixed)}/#settings" target="_blank" rel="noopener">Open ${esc(fixed)}</a>` : ''}
    <button class="btn ghost" id="ntClose">Close</button></div></div>`;
  document.body.appendChild(ov);
  let done = false, knocking = false;
  const text = (h) => { const el = ov.querySelector('#ntText'); if (el) el.innerHTML = h; };
  const stop = () => { done = true; clearInterval(timer); };
  ov.querySelector('#ntClose').addEventListener('click', () => { stop(); ov.remove(); });
  const tick = () => {
    if (done) return;
    const st = S.status?.net, fresh = Date.now() - S.statusAt < 3000 && S.statusAt > start + 1500;
    // The controller's own count while this page still reaches it, else counted here.
    const left = fresh && st?.trial ? st.trial.left : Math.max(0, total - Math.round((Date.now() - start) / 1000));
    if (fresh && !st?.trial && st?.trialResult === 'kept') { stop(); text('<p class="ok">Kept: the controller answers at this address with the new setting.</p>'); return; }
    if (fresh && !st?.trial && st?.trialResult === 'reverted') {
      stop();
      text(`<p class="bad">The new address was not reached in 2 minutes: the controller went back to ${esc(back)}, and its project has the old network setting again.</p>
        <p><button class="btn" id="ntReload">Reload the project</button></p>`);
      ov.querySelector('#ntReload').addEventListener('click', () => { S.dirty = false; location.reload(); });
      return;
    }
    text(`<p>The controller switched to <b>${esc(fixed ? n.ip : 'DHCP')}</b>. It goes back to ${esc(back)} in <b>${left} s</b> unless a browser reaches it at the new address.</p>
      ${fixed ? `<p class="muted">This page tries ${esc(fixed)} every 2 seconds and opens it once it answers. If this PC is in another subnet, open the address from a PC that is.</p>`
        : '<p class="muted">The new address comes from the DHCP server: find it in the KD Designer launcher (Controllers) or in the router, and open it in a browser. Opening the page there confirms it.</p>'}
      ${left === 0 ? '<p class="muted">Time is up: the controller should be back at the old address. Waiting for it…</p>' : ''}`);
    // Knock on the new address (CORS allowed there): any answer = reachable, go there.
    if (fixed && fixed !== location.origin && !knocking && left > 0) {
      knocking = true;
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 1500);
      fetch(fixed + '/api/network/confirm', { method: 'POST', signal: ac.signal }).then((r) => r.json()).then(() => {
        stop();
        text(`<p class="ok">The controller answers at ${esc(fixed)}: setting kept. Opening it…</p>`);
        S.dirty = false;
        setTimeout(() => { location.href = fixed + '/#settings'; }, 1200);
      }).catch(() => {}).finally(() => { setTimeout(() => (knocking = false), 2000); });
    }
  };
  const timer = setInterval(tick, 500);
  tick();
}

views.settings = () => {
  const p = P();
  return `<h2>Settings</h2>
  <div class="form">
    <label>Project name</label><input data-p="name" value="${esc(p.name)}">
    <label>Time zone offset</label><input type="number" data-p="settings.tzOffsetMin" data-t="num" value="${p.settings.tzOffsetMin}" title="minutes from UTC (CET = 60, CEST = 120)">
    <label>UDP trigger port</label><input type="number" data-p="settings.udpPort" data-t="num" value="${p.settings.udpPort}">
    <label>sACN priority</label><input type="number" min="0" max="200" data-p="settings.sacnPriority" data-t="num" value="${p.settings.sacnPriority}">
  </div>
  ${displaySettingsHtml()}
  <h3>Project file</h3>
  <div class="row"><button class="btn" id="showExport" title="The project and its map images in one file, to keep or to edit on a PC">Export show file…</button>
    <label class="btn" title="A .kdshow file (or a plain project.json)">Open show file…<input type="file" id="showOpen" accept=".kdshow,.json" hidden></label>
    <button class="btn ghost" id="showNew">New project</button></div>
  <p class="muted">Export saves the project as it is in the editor (unsaved changes included) with its map images as one <code>.kdshow</code> file.
    Open loads such a file into the editor; press Save to put it on the controller. Make or edit a show on a PC with the mock: <code>node tools/mock-server.js 8080 C:\\Shows\\MyShow</code>.</p>
  <h3>Backups</h3>
  <p class="muted">Every save keeps the version it replaces on the storage device (<code>show/backups</code>), the last 10. Restore puts one in the editor as unsaved changes: look at it, then press Save (or Undo to go back).</p>
  <div id="backupList"><span class="muted">Loading…</span></div>
  <h3>Network</h3>
  <p class="muted">A changed setting is used after a restart, or at once after saving: the controller then goes back to the old setting after 2 minutes unless a browser reaches it at the new address.
    Lost the controller anyway? Put a file <code>network-reset.txt</code> on the USB stick and restart: it starts with DHCP (172.16.1.111 without a DHCP server).</p>
  <div class="net-wrap">
    <div class="form net-set">
      <label>DHCP</label><input type="checkbox" data-p="network.dhcp" data-t="bool"${p.network.dhcp ? ' checked' : ''} data-r>
      ${p.network.dhcp ? '<span></span><span class="muted">The router gives the address, gateway and DNS. Without an answer: 172.16.1.111 until one answers.</span>'
        : [['ip', 'IP address', '192.168.1.50'], ['mask', 'Subnet mask', '255.255.255.0'], ['gateway', 'Gateway', 'empty = none'], ['dns', 'DNS server', 'empty = the gateway'], ['dns2', 'DNS server 2', 'optional']]
          .map(([k, l, ph]) => `<label>${l}</label><input data-p="network.${k}" data-net="${k}" value="${esc(p.network[k] || '')}" placeholder="${ph}">`).join('')}
    </div>
    <div class="card net-live"><b>In use now</b><div id="netLive">${netLiveHtml()}</div></div>
  </div>
  <div id="netProblems" class="bad"></div>
  <h3>Controller</h3>
  <div class="row"><button class="btn" id="syncClock">Set clock from this browser</button>
    <button class="btn" data-cmd="reload">Reload project from USB</button></div>
  <h3>Software update</h3>
  <p id="updInfo">${updInfoHtml()}</p>
  <div class="row"><label class="btn" title="A .kdupdate file (made by the firmware build, in the updates folder)">Install update file…<input type="file" id="updFile" accept=".kdupdate" hidden></label>
    <span id="updProgress" class="muted"></span></div>
  <p class="muted">Installs new firmware and a new web UI over the network, no USB cable or storage device swap needed. The project, images and logs are kept.
    A firmware update restarts the controller: no light output for about half a minute.</p>
  <h3>Raw project JSON</h3>
  <details id="rawBox"${S.rawOpen ? ' open' : ''}><summary>The whole show as text - built when opened (a big rig is several 100 KB)</summary>
  <textarea class="json" id="raw" spellcheck="false"></textarea>
  <div class="row" style="margin-top:6px"><button class="btn" id="applyRaw">Apply JSON</button><span class="muted">Applies to the editor; press Save to send it to the controller.</span></div></details>`;
};
views.settings.after = () => {
  // The JSON goes in as a value, not escaped into the HTML, and only once the box is open:
  // building it on every page draw took 185 ms with a 390 KB show.
  const rawBox = $('#rawBox');
  if (rawBox.open) $('#raw').value = JSON.stringify(P(), null, 2);
  rawBox.addEventListener('toggle', () => {
    S.rawOpen = rawBox.open;
    if (rawBox.open) $('#raw').value = JSON.stringify(P(), null, 2);
  });
  $('#syncClock').addEventListener('click', setClockFromPc);
  $('#updFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) installUpdate(f); });
  pagePoll('updInfo', () => { if (!S.updating) $('#updInfo').innerHTML = updInfoHtml(); $('#netLive').innerHTML = netLiveHtml(); }, 2000);
  // Checked while typing (the bound value is only written on "change"); Save refuses too.
  const netCheck = () => {
    const n = { ...P().network };
    $$('[data-net]').forEach((el) => (n[el.dataset.net] = el.value));
    const bad = KDModel.netProblems(n);
    $$('[data-net]').forEach((el) => el.classList.toggle('invalid', bad.some((b) => b.field === el.dataset.net)));
    $('#netProblems').innerHTML = bad.map((b) => `<div>${esc(b.text)}</div>`).join('');
  };
  $$('[data-net]').forEach((el) => el.addEventListener('input', netCheck));
  netCheck();
  $('#applyRaw').addEventListener('click', () => {
    try { replaceProject(JSON.parse($('#raw').value)); toast('Project applied - press Save to store it'); } catch (e) { toast('Invalid JSON: ' + e.message, true); }
  });
  attachDisplaySettings();
  loadBackupList();
  $('#showExport').addEventListener('click', exportShow);
  $('#showOpen').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openShow(f); });
  $('#showNew').addEventListener('click', () => {
    if (!confirm(`Start a new, empty project?${S.dirty ? ' Unsaved changes are lost (export them first if needed).' : ''} The controller keeps the old one until you press Save.`)) return;
    const p = emptyProject();
    p.network = JSON.parse(JSON.stringify(P().network));   // a new show must not move the controller to another IP
    replaceProject(p);
    toast('New project - press Save to put it on the controller');
  });
};

// ---- Display: theme and size of this browser's UI (applyUi in app-core.js) ----
function displaySettingsHtml() {
  const th = document.documentElement.dataset.theme, auto = uiScalePref() === 'auto', pct = Math.round(uiZoom() * 100);
  return `<h3>Display <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">· this browser only</span></h3>
  <div class="themes">${THEMES.map(([k, name, about]) => `<button class="theme-card${k === th ? ' on' : ''}" data-theme="${k}" data-uitheme="${k}">
    <div class="tp"><i></i><span><b class="a"></b><b></b><b class="o"></b></span></div><b>${name}</b><small>${about}</small></button>`).join('')}</div>
  <div class="row scale-row" style="margin-top:12px">
    <span class="muted" style="min-width:60px">Size</span>
    <button class="toggle${auto ? ' on' : ''}" id="uiAuto" title="Fit the window: bigger on large screens, smaller on laptops">Auto</button>
    <button class="btn small" data-uistep="-1" title="Smaller">A−</button>
    <input type="range" id="uiScale" min="70" max="175" step="5" value="${pct}">
    <button class="btn small" data-uistep="1" title="Bigger">A+</button>
    <b id="uiScaleVal" style="min-width:48px">${pct} %</b>
  </div>
  <p class="muted">Auto fits the window (it changes when you resize it); pick a size yourself to keep it fixed. The touch panel has its own layout.</p>
  <div class="row live-colors" style="margin-top:12px">
    <span class="muted" style="min-width:60px">Live</span>
    ${LIVE_COLORS.map(([k, c]) => `<button data-livecolor="${k}" class="${k === liveColor()[0] ? 'on' : ''}" style="background:${c}" title="${k}"></button>`).join('')}
    <button class="toggle${uiPref('kd.liveFrame', '1') === '1' ? ' on' : ''}" id="liveFrame" style="width:auto;height:auto;border-radius:4px;padding:3px 10px" title="A coloured frame around the whole window while editing a controller">Frame</button>
  </div>
  <div class="row live-colors" style="margin-top:8px">
    <span class="muted" style="min-width:60px">PC</span>
    ${LIVE_COLORS.map(([k, c]) => `<button data-pccolor="${k}" class="${k === pcColor()[0] ? 'on' : ''}" style="background:${c}" title="${k}"></button>`).join('')}
  </div>
  <p class="muted">The badge takes the <b>Live</b> colour when you edit a controller itself (plus the Save button and a thin frame around the window), and the <b>PC</b> colour in the PC editor. Pick two colours that look nothing alike. You are now ${isLive() ? '<b>live on the controller</b>' : 'on the <b>PC editor</b>'}.</p>`;
}
function attachDisplaySettings() {
  $$('[data-uitheme]').forEach((b) => b.addEventListener('click', () => { setUiPref('kd.theme', b.dataset.uitheme); render(); }));
  $$('[data-livecolor]').forEach((b) => b.addEventListener('click', () => { setUiPref('kd.liveColor', b.dataset.livecolor); render(); }));
  $$('[data-pccolor]').forEach((b) => b.addEventListener('click', () => { setUiPref('kd.pcColor', b.dataset.pccolor); render(); }));
  $('#liveFrame').addEventListener('click', () => { setUiPref('kd.liveFrame', uiPref('kd.liveFrame', '1') === '1' ? '0' : '1'); render(); });
  $('#uiAuto').addEventListener('click', () => {
    // Off: keep the size it has now, so switching Auto off changes nothing on screen.
    setUiPref('kd.scale', uiScalePref() === 'auto' ? uiZoom() : null);
    render();
  });
  const sl = $('#uiScale');
  // Applied on release: zooming while dragging would move the slider under the mouse.
  sl.addEventListener('input', () => ($('#uiScaleVal').textContent = sl.value + ' %'));
  sl.addEventListener('change', () => { setUiPref('kd.scale', +sl.value / 100); render(); });
  $$('[data-uistep]').forEach((b) => b.addEventListener('click', () => {
    const z = Math.max(70, Math.min(175, Math.round(uiZoom() * 20 + +b.dataset.uistep) * 5));
    setUiPref('kd.scale', z / 100);
    render();
  }));
}

// ---- Software update (.kdupdate, tools/make_update.py; installed by src/Update.cpp) ----
function updInfoHtml() {
  const st = S.status, u = st?.update;
  if (!u) return '<span class="muted">waiting for the controller…</span>';
  return `Firmware <b>${esc(st.version)}</b> (${esc(u.target)})`
    + (u.ready ? ' · ready for updates' : ` · <span class="bad">firmware updates not possible: ${esc(u.problem || '?')}</span>`)
    + (u.last ? ` · last update ${esc(u.last)}: ${u.lastOk ? 'installed' : '<span class="bad">NOT installed</span>'}` : '');
}
async function installUpdate(f) {
  // The header is the first two lines: "KDUPDATE 1" and the JSON with version, target and files.
  const lines = new TextDecoder().decode(await f.slice(0, 65536).arrayBuffer()).split('\n');
  let h;
  try { h = lines[0] === 'KDUPDATE 1' && JSON.parse(lines[1]); } catch { h = null; }
  if (!h?.files) return toast(`${f.name} is not a KD Designer update file`, true);
  const u = S.status?.update || {}, fw = h.files.some((x) => x.name === 'firmware.bin');
  if ((fw || h.target !== 'any') && u.target && h.target !== u.target) return toast(`This update is for a ${h.target} controller, this one is ${u.target}`, true);
  if (fw && u.ready === false) return toast(`Firmware updates are not possible on this controller: ${u.problem}`, true);
  if (S.dirty) return toast('Save (or undo) your changes first: the page reloads after the update', true);
  const what = fw ? `firmware ${S.status?.version || '?'} → ${h.version} and the web UI` : 'the web UI';
  if (!confirm(`Install ${f.name}?\n\nUpdates ${what} (built ${h.built}).`
    + `${fw ? '\nThe controller then restarts: no light output for about half a minute.' : ''}\nThe project, images and logs are kept.`)) return;
  const prog = $('#updProgress'), show = (t) => { if (prog?.isConnected) prog.textContent = t; };
  S.updating = true;
  const t0 = Date.now();
  // XHR, not fetch: it reports upload progress.
  const r = await new Promise((done) => {
    const x = new XMLHttpRequest();
    x.open('PUT', '/api/update');
    x.upload.onprogress = (e) => { if (e.lengthComputable) show(`Uploading… ${Math.round((e.loaded / e.total) * 100)} %`); };
    x.onload = () => { try { done(JSON.parse(x.responseText)); } catch { done({ ok: false, reply: x.statusText || 'no answer' }); } };
    x.onerror = () => done({ ok: false, reply: 'connection lost' });
    x.send(f);
  });
  if (!r.ok) { S.updating = false; show(''); return toast(`Update failed: ${r.reply}`, true); }
  if (!r.restart) { show(r.reply); toast(`${r.reply} - reloading the page`); return setTimeout(() => location.reload(), 1500); }
  // Back once it answers with an uptime shorter than the time since the upload started.
  show('Installing - the controller is restarting…');
  let st = null;
  while (Date.now() - t0 < 180000) {
    await new Promise((ok) => setTimeout(ok, 2000));
    try { st = await api('/api/status'); } catch { st = null; continue; }
    if (st.uptime < Date.now() - t0 && !st.update?.restarting) break;
    st = null;
  }
  S.updating = false;
  if (!st) return show('No answer after 3 minutes - check the controller (power, network, or the USB-C cable).');
  if (st.update?.lastOk === false || st.version !== h.version) {
    show('');
    return toast(`The firmware was NOT installed: the controller still runs ${st.version}. Look at the log.`, true);
  }
  show(`Updated to ${st.version} - reloading the page`);
  setTimeout(() => location.reload(), 1500);
}

// ---- Backups: the versions before the last saves (Storage::keepBackup / the mock's keepBackup).
// Names are "YYYY-MM-DD_HH-MM-SS.json" = when that version was replaced by a save.
function backupWhen(name) {
  const m = /^(\d{4})-(\d\d)-(\d\d)_(\d\d)-(\d\d)-(\d\d)(-2)?\.json$/.exec(name);
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:${m[6]}` : name.replace(/\.json$/, '');
}
async function loadBackupList() {
  const box = $('#backupList');
  let r;
  try { r = await api('/api/backups'); } catch (e) { r = null; }
  if (!box?.isConnected) return;
  const list = r?.backups;
  if (!Array.isArray(list)) { box.innerHTML = '<span class="muted">This controller keeps no backups yet (update the firmware).</span>'; return; }
  if (!list.length) { box.innerHTML = '<span class="muted">No backups yet: the first save makes one.</span>'; return; }
  box.innerHTML = `<table class="tbl backups"><tr><th>In use until</th><th>Size</th><th></th></tr>${list.map((b) => `<tr><td>${esc(backupWhen(b.name))}${/noclock/.test(b.name) ? ' <span class="muted">(clock not set)</span>' : ''}</td>
    <td class="muted">${b.size != null ? `${Math.round(b.size / 1024)} KB` : ''}</td>
    <td><button class="btn small" data-restore="${esc(b.name)}">Restore…</button> <a class="btn small ghost" href="/api/backups?name=${encodeURIComponent(b.name)}" download="project-${esc(b.name)}">Download</a></td></tr>`).join('')}</table>`;
  $$('[data-restore]', box).forEach((btn) => btn.addEventListener('click', () => restoreBackup(btn.dataset.restore)));
}
async function restoreBackup(name) {
  let p;
  try { p = await apiProgress('/api/backups?name=' + encodeURIComponent(name), 'Loading the backup'); } catch (e) { return toast('Could not read the backup: ' + e.message, true); }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return toast('That backup has no project in it', true);
  const n = (k) => (p[k] || []).length;
  if (!confirm(`Restore the version that was in use until ${backupWhen(name)}?\n\n${n('fixtures')} fixtures, ${n('scenes')} scenes, ${n('timelines')} timelines, ${n('triggers')} triggers.\n\nIt goes into the editor as unsaved changes${S.dirty ? ' (your unsaved changes are replaced; Undo brings them back)' : ''}: press Save to put it on the controller. This controller's network settings are kept.`)) return;
  p.network = JSON.parse(JSON.stringify(P().network));   // an old version must not move the controller to another IP
  replaceProject(p);
  toast(`Version of ${backupWhen(name)} in the editor - press Save to keep it${showMediaNames(p).length ? ' (map images replaced since may be missing)' : ''}`);
}

// ---- Show files (.kdshow): "Save as" / "Open" between the controller and a PC --------
// One JSON file: { kdshow: 1, exported, project, media: { 'map1-x.jpg': '<base64>' } }.
// Only map backgrounds live outside project.json, so those are the media that go along.
const showMediaNames = (p) => [...new Set((p.maps || []).map((m) => m.background).filter(Boolean))];
// Put another project in the editor as unsaved changes (Undo goes back to the old one).
function replaceProject(p) {
  // Images only the old project used: deleted on the next save (save() keeps ones still in use).
  for (const name of showMediaNames(P())) S.mediaTrash.add(name);
  S.project = normalize(p);
  renumberTriggers();
  for (const k of Object.keys(S.sel)) S.sel[k] = k === 'cue' ? -1 : 0;
  S.mapSel.clear();
  S.trackEdit = null;
  markDirty();
  render();
}
async function exportShow() {
  const el = document.activeElement;
  if (el?.dataset?.p) onBound({ target: el, type: 'input' });   // the field still being typed in
  const p = P(), media = {}, missing = [];
  for (const name of showMediaNames(p)) {
    try {
      const r = await fetch('/media/' + encodeURIComponent(name));
      if (!r.ok) throw new Error(r.statusText);
      const blob = await r.blob();
      const url = await new Promise((ok, fail) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = fail; fr.readAsDataURL(blob); });
      media[name] = url.slice(url.indexOf(',') + 1);
    } catch { missing.push(name); }
  }
  const file = { kdshow: 1, exported: new Date().toISOString(), project: p, media };
  const d = new Date(), pad = (n) => String(n).padStart(2, '0');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' }));
  a.download = `${(p.name || 'show').replace(/[^\w-]+/g, '_')}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.kdshow`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  if (missing.length) toast(`Exported without image(s) not found on the controller: ${missing.join(', ')}`, true);
  else toast(`Exported${S.dirty ? ' (with unsaved changes)' : ''}`);
}
async function openShow(f) {
  let file;
  try { file = JSON.parse(await f.text()); } catch (e) { return toast(`${f.name} is not a show file: ${e.message}`, true); }
  // A .kdshow, or a plain project.json (no images).
  const p = file.kdshow ? file.project : file, media = file.kdshow ? file.media || {} : {};
  if (!p || typeof p !== 'object' || Array.isArray(p)) return toast(`${f.name} has no project in it`, true);
  if (S.dirty && !confirm('Open this file? Unsaved changes in the editor are replaced (Undo brings them back).')) return;
  // The file was maybe made on a PC: don't let it move the controller to another address by accident.
  const net = (n) => (n?.dhcp !== false ? 'DHCP' : n.ip || '?');
  if (p.network && net(p.network) !== net(P().network)
    && confirm(`The file's network setting is ${net(p.network)}, this controller's is ${net(P().network)}.\n\nOK = keep this controller's network settings, Cancel = use the file's (after a reboot).`))
    p.network = JSON.parse(JSON.stringify(P().network));
  const failed = [];
  for (const [name, b64] of Object.entries(media)) {
    try {
      const bin = atob(b64), buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const j = await (await fetch(`/api/media?name=${encodeURIComponent(name)}`, { method: 'PUT', body: buf })).json();
      if (!j.ok) throw new Error(j.reply);
    } catch { failed.push(name); }
  }
  replaceProject(p);
  // A plain project.json carries no images: those may already be on the controller.
  const lost = file.kdshow ? showMediaNames(P()).filter((n) => !(n in media)) : [];
  if (failed.length) toast(`Image upload failed: ${failed.join(', ')}`, true);
  else if (lost.length) toast(`Image(s) missing from the file: ${lost.join(', ')}`, true);
  toast(`Opened ${f.name} - press Save to put it on the controller`);
}
