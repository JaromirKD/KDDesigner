'use strict';
// KD Designer web UI - command language: grammar, completion, validation, highlighting, help, builder.
// Plain scripts sharing one global scope; load order is in index.html.

// ---------------------------------------------------------------------------
// Command grammar - keep in sync with src/Cmd.cpp
// ---------------------------------------------------------------------------
const GRAMMAR = [
  ['start timeline {tl}', 'Start (or restart) a timeline'],
  ['start timeline {tl} at {sec}', 'Start (or restart) a timeline part-way, at this many seconds'],
  ['stop timeline {tl}', 'Release a timeline'],
  ['stop timeline {tl} fade {sec}', 'Release a timeline with a fade'],
  ['pause timeline {tl}', 'Pause a timeline'],
  ['resume timeline {tl}', 'Resume a paused timeline'],
  ['master timeline {tl} {pct}', 'Set a timeline master level'],
  ['master timeline {tl} {pct} fade {sec}', 'Fade a timeline master level'],
  ['scene {sc}', 'Play a scene'],
  ['scene {sc} fade {sec}', 'Fade in a scene'],
  ['release scene {sc}', 'Release a scene'],
  ['release scene {sc} fade {sec}', 'Release a scene with a fade'],
  ['release all', 'Release every timeline and scene'],
  ['release all fade {sec}', 'Release everything with a fade'],
  ['set {chan} {dmx}', 'Override channel(s), e.g. set 1.10-12 255'],
  ['clear override {chan}', 'Remove the override on channel(s) only, e.g. clear override 1.10-12'],
  ['clear overrides', 'Remove all channel overrides'],
  ['grandmaster {pct}', 'Set the grand master'],
  ['blackout {onoff}', 'Blackout on or off'],
  ['mode {mgroup} {mstate}', 'Set the state of a mode group, e.g. mode Curtains Open'],
  ['mode {mgroup} {mstep}', 'Step a mode group: next / previous state (wraps around), toggle between its two states, or back to the state it was in before'],
  ['mode {mode}', 'Set a mode by state name (must be unique across groups)', { hidden: true }],
  ['label {label} {text...}', 'Set the text of a panel label'],
  ['label {label} color {color}', 'Set the colour of a panel label'],
  ['panel {pctl} text {text...}', 'Change the text of a panel control (button, label, slider…)'],
  ['panel {pctl} color {color}', 'Change the colour of a panel control'],
  ['panel {pctl} flash {flash}', 'Make a panel control flash (on, or a colour to flash in) or stop (off)'],
  ['panel {pctl} value {pval}', 'Move a slider or dial, switch a toggle (1/0), set a colour wheel (#rrggbb) or an XY pad (x,y)'],
  ['panel {pctl} disable', 'Grey out a panel control so it can’t be used'],
  ['panel {pctl} enable', 'Make a disabled panel control usable again (also one ticked "disabled" on the Panel page)'],
  ['panel {pctl} lock', 'Panel control shows as normal but can’t be touched (e.g. a slider used as a progress bar)'],
  ['panel {pctl} unlock', 'Panel control can be touched again (also one set to "display only" on the Panel page)'],
  ['panel {pctl} reset', 'Back to the text, colour, "display only" and "disabled" set on the Panel page, flashing off'],
  ['fire trigger {trig}', 'Run another trigger now (nested task list)'],
  ['fire trigger {trig} after {sec}', 'Run another trigger after a delay (Wait)'],
  ['cancel trigger {trig}', 'Cancel delayed fires of a trigger'],
  ['repeat trigger {trig} every {sec}', 'Fire a trigger now and then repeatedly'],
  ['repeat trigger {trig} every {sec} times {count}', 'Fire a trigger a number of times'],
  ['stop repeat {trig}', 'Stop a repeating trigger'],
  ['log {text...}', 'Write a line to the log'],
  ['email {email} {text...}', 'Send an email: email <to> "<subject>" <body>'],
  ['sleep {sec}', 'Pause: the actions below this line run this many seconds later'],
  // Checked by validateHead (the condition / command after the head has its own grammar).
  ['wait until {text...}', 'Wait: the actions below run as soon as the condition is true. Add "timeout <s>" at the end to give up after that long (the rest is then skipped)'],
  ['repeat {count} times {text...}', 'Run a command several times in a row; {i} counts 1, 2, 3…'],
  ['repeat {count} times every {sec} {text...}', 'Run a command several times with a pause in between; {i} counts 1, 2, 3…; the lines below run after the last one'],
  ['repeat {trig} {count} times every {sec}', 'Fire a trigger this many times, this many seconds apart; the lines below run after the last one ({count} in that trigger = the round)'],
  ['repeat {trig} {count} times', 'Fire a trigger this many times straight after each other'],
  ['repeat {trig} {count} times for {sec}', 'Same as every: this many seconds between the fires', { hidden: true }],
  ['send udp {ip} {port} {text...}', 'Send a UDP message'],
  // The port forms come first so "send udp pc 5000 go" shows 5000 as a port.
  ['send udp {device} {port} {text...}', "Send a UDP message to a device on another port than its own"],
  ['send udp {device} {text...}', 'Send a UDP message to a device'],
  ['send osc {ip} {port} {oscaddr} {text...}', 'Send an OSC message with arguments'],
  ['send osc {ip} {port} {oscaddr}', 'Send an OSC message'],
  ['send osc {device} {port} {oscaddr} {text...}', "Send an OSC message with arguments to a device on another port than its own"],
  ['send osc {device} {port} {oscaddr}', "Send an OSC message to a device on another port than its own"],
  ['send osc {device} {oscaddr} {text...}', 'Send an OSC message to a device, with arguments'],
  ['send osc {device} {oscaddr}', 'Send an OSC message to a device'],
  ['reply {text...}', 'Answer the sender of the UDP/OSC message that fired this trigger'],
  ['loglevel {logcat} {loglvl}', 'Change firmware log verbosity'],
  ['output {proto} {onoff}', 'Switch a protocol output on/off (until reboot)'],
  ['output {proto} fps {count}', 'Frames per second of a protocol (until reboot)'],
  ['projector {pj} {onoff}', 'Projector power (PJLink)'],
  ['projector {pj} mute {onoff}', 'Projector AV mute (PJLink)'],
  ['projector {pj} input {pjinput}', 'Projector input (PJLink)'],
  ['projector {pj} send {text...}', 'Raw PJLink command, e.g. LAMP ?'],
  ['pc {pc} {pcaction}', 'Wake a PC (Wake-on-LAN) or send it startup / shutdown / reboot'],
  ['var {var} = {text...}', 'Set a variable'],
  ['var {var} + {num}', 'Add to a number variable'],
  ['var {var} - {num}', 'Subtract from a number variable'],
  ['var {var} ++', 'Add 1 to a number variable (count up)'],
  ['var {var} --', 'Subtract 1 from a number variable (count down)'],
  ['var {var} += {num}', 'Add to a number variable (same as +)'],
  ['var {var} -= {num}', 'Subtract from a number variable (same as -)'],
  ['var {var} * {num}', 'Multiply a number variable'],
  ['var {var} / {num}', 'Divide a number variable'],
  ['var {var} *= {num}', 'Multiply a number variable (same as *)'],
  ['var {var} /= {num}', 'Divide a number variable (same as /)'],
  ['var {var} toggle', 'Flip an on/off variable'],
  ['if {cond...} then {command...}', 'Run a command only when a condition holds (optional: else <command>)', { hidden: true }],
  ['send tcp {tcpdev} {text...}', 'Send a line to a TCP device'],
  ['http {httpmethod} {url}', 'HTTP request (response fires HTTP triggers)'],
  ['http {httpmethod} {url} {text...}', 'HTTP request with a body (JSON or text)'],
  ['modbus {mbdev} write {mbtable} {num} {num}', 'Write a PLC coil (0/1) or holding register'],
  // Device drivers (src/Drivers.cpp)
  ['kissbox {kiss} {kisspoint} {kissval}', 'Kiss-Box: switch an output (slot.channel) on/off, or set an analog output 0-255'],
  ['kissbox {kiss} {slot} all {text...}', 'Kiss-Box: set all 8 channels of a slot, e.g. 1 0 1 0 0 0 0 0'],
  ['kissbox {kiss} read {slot}', 'Kiss-Box: read a slot now'],
  ['kissbox {kiss} send {text...}', 'Kiss-Box: raw bytes in hex, e.g. A5 00 02 01'],
  ['knx {knx} write {knxga} {knxval}', 'KNX: write a group address (the DPT comes from the address list, on/off = DPT 1)'],
  ['knx {knx} write {knxga} {knxval} {dpt}', 'KNX: write a group address with this DPT'],
  ['knx {knx} read {knxga}', 'KNX: ask for the value of a group address'],
  ['brightsign {bsign} send {text...}', 'BrightSign: send a UDP command to the presentation'],
  ['brightsign {bsign} test {bszone} {bsstate}', 'BrightSign (KD plugin): play the file of a state in a zone, for testing (the presentation carries on after it)'],
  ['brightsign {bsign} event {text...}','BrightSign (KD plugin): a Plugin Message to the presentation - use it on a transition to go to any state'],
  ['brightsign {bsign} var {bsvar} {text...}', 'BrightSign (KD plugin): set a user variable of the presentation'],
  ['brightsign {bsign} play {bszone} {bsfile}','BrightSign (KD plugin): play a file in a zone directly'],
  ['brightsign {bsign} stop {bszone}', 'BrightSign (KD plugin): stop the video/audio of a zone'],
  ['brightsign {bsign} reboot', 'BrightSign: reboot the player'],
  ['brightsign {bsign} api {httpmethod} {path}', 'BrightSign: any local DWS API call, e.g. api get info'],
  ['brightsign {bsign} api {httpmethod} {path} {text...}', 'BrightSign: local DWS API call with a JSON body'],
  ['digidot {digi} scene {digiscene}', 'DiGidot: play a scene'],
  ['digidot {digi} scene {digiscene} fade {sec}', 'DiGidot: play a scene with a fade'],
  ['digidot {digi} playlist {num}', 'DiGidot: play a playlist (unique id)'],
  ['digidot {digi} stop', 'DiGidot: stop the scene or playlist'],
  ['digidot {digi} master {pct}', 'DiGidot: master brightness'],
  ['digidot {digi} speed {num}', 'DiGidot: playback speed in % (100 = normal)'],
  ['digidot {digi} trigger {num}', 'DiGidot: fire a C4 trigger (unique id)'],
  ['digidot {digi} reset', 'DiGidot: restart the controller'],
  ['digidot {digi} send {text...}', 'DiGidot: any API call as JSON, e.g. {"action":"status"}'],
  ['netio {netio} output {netioout} {netioact}', 'NETIO: switch a power output'],
  ['netio {netio} output {netioout} {netioact} {sec}', 'NETIO: restart (off) or pulse (on) an output for this many seconds'],
  ['netio {netio} send {text...}', 'NETIO: post any netio.json content'],
  ['pharos {pharos} timeline {num} {pharostl}', 'Pharos: start, release, toggle, pause or resume a timeline'],
  ['pharos {pharos} timeline {num} {pharostl} fade {sec}', 'Pharos: timeline action with a fade'],
  ['pharos {pharos} timeline {num} rate {num}', 'Pharos: timeline speed (1 = normal)'],
  ['pharos {pharos} timeline {num} position {pct}', 'Pharos: jump to a position in a timeline (%)'],
  ['pharos {pharos} scene {num} {pharossc}', 'Pharos: start, release or toggle a scene'],
  ['pharos {pharos} scene {num} {pharossc} fade {sec}', 'Pharos: scene action with a fade'],
  ['pharos {pharos} group {num} master {pct}', 'Pharos: group master intensity (0 = all fixtures)'],
  ['pharos {pharos} group {num} master {pct} fade {sec}', 'Pharos: fade a group master'],
  ['pharos {pharos} trigger {num}', 'Pharos: fire a trigger'],
  ['pharos {pharos} trigger {num} {text...}', 'Pharos: fire a trigger with variables (comma-separated)'],
  ['pharos {pharos} release all', 'Pharos: release all timelines and scenes'],
  ['pharos {pharos} release all fade {sec}', 'Pharos: release everything with a fade'],
  ['pharos {pharos} text {word} {text...}', 'Pharos: set a text slot'],
  ['pharos {pharos} override {fixgrp} {num} intensity {pct}', 'Pharos: override the intensity of a fixture or group'],
  ['pharos {pharos} override {fixgrp} {num} intensity {pct} fade {sec}', 'Pharos: fade an intensity override'],
  ['pharos {pharos} override {fixgrp} {num} color {color}', 'Pharos: override the colour of a fixture or group (#rrggbb)'],
  ['pharos {pharos} override {fixgrp} {num} color {color} fade {sec}', 'Pharos: fade a colour override'],
  ['pharos {pharos} clear overrides', 'Pharos: clear all overrides'],
  ['pharos {pharos} clear overrides fade {sec}', 'Pharos: clear all overrides with a fade'],
  ['pharos {pharos} output {pharosproto} {onoff}', 'Pharos: switch an output protocol on or off'],
  ['pharos {pharos} beacon {onoff}', 'Pharos: blink the controller to find it'],
  ['pharos {pharos} api {httpmethod} {path}', 'Pharos: any controller API call, e.g. api get system'],
  ['pharos {pharos} api {httpmethod} {path} {text...}', 'Pharos: controller API call with a JSON body'],
  // Machine Control I/O (src/Board.cpp)
  ['io {iopoint} {ioval}', 'Machine Control: switch an output on/off/toggle, or set an analog output in volts (0-10)'],
  ['io {iopoint} pulse {sec}', 'Machine Control: switch an output on for this many seconds'],
  ['io {iopoint} {num} fade {sec}', 'Machine Control: fade an analog output to this voltage'],
  ['io all off', 'Machine Control: switch every output off (analog to 0 V)'],
  ['ntp sync', 'Sync the clock with the NTP server now'],
  ['monitor check', 'Check all monitored devices right now'],
  ['monitor interval {count}', 'Seconds between monitoring checks (until reboot)'],
  ['reload', 'Reload the project from USB'],
].map(([p, doc, o]) => ({ pattern: p, parts: p.split(' '), doc, hidden: !!o?.hidden }));

// Trigger conditions - keep in sync with Triggers::checkCondition
const COND_GRAMMAR = [
  ['mode {mgroup} is {mstate}', 'Only when this mode group is in this state'],
  ['mode {mgroup} not {mstate}', 'Only when this mode group is not in this state'],
  ['mode {mgroup} is {mstate} for {dur}', 'Only when this mode group has been in this state for at least this long: 90 (seconds), 30s, 10m, 2h'],
  ['mode is {mode}', 'Only when this mode is active', { hidden: true }],
  ['mode not {mode}', 'Only when this mode is not active', { hidden: true }],
  ['timeline {tl} running', 'Only while the timeline runs'],
  ['timeline {tl} stopped', 'Only while the timeline is not running'],
  ['time between {hhmm} {hhmm}', 'Only between two times (may cross midnight)'],
  ['day is {days}', 'Only on these weekdays, e.g. mon,tue,fri'],
  ['device {devname} is {updown}', 'Only when a monitored PC / device / projector is online or offline'],
  ['var {var} {op} {text...}', 'Compare a variable, e.g. var visitors > 50'],
  ['calendar {calname} {activity}', 'Only when a calendar period is (not) active today'],
  ['date between {date} {date}', 'Only between two dates: MM-DD (every year) or YYYY-MM-DD'],
  ['io {iopoint} is {onoff}', 'Only when a Machine Control input or output is on / off'],
  ['io {iopoint} {op} {num}', 'Compare a Machine Control reading, e.g. io ai0 > 5 (volts, mA or Ω)'],
].map(([p, doc, o]) => ({ pattern: p, parts: p.split(' '), doc, hidden: !!o?.hidden }));

// ---------------------------------------------------------------------------
// Command language: tokenizer, completion, validation
// ---------------------------------------------------------------------------
function tokenize(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    const start = i;
    let v = '', quoted = false, closed = true;
    if (text[i] === '"') {
      quoted = true; closed = false; i++;
      while (i < text.length && text[i] !== '"') v += text[i++];
      if (i < text.length) { closed = true; i++; }
    } else {
      while (i < text.length && !/\s/.test(text[i])) v += text[i++];
    }
    out.push({ v, raw: text.slice(start, i), quoted, closed, start, end: i });
  }
  return out;
}
function findRef(list, tok) {
  if (/^\d+$/.test(tok)) return list.find((x) => x.id === +tok);
  return list.find((x) => (x.name || '').toLowerCase() === tok.toLowerCase());
}
const isNum = (t) => /^\d+(\.\d+)?$/.test(t);
const quote = (s) => (/\s/.test(s) ? `"${s}"` : s);
// Mode groups: [{name, states: [...]}]. Group/state refs are a name or a 1-based number.
const findGroup = (tok) => (/^\d+$/.test(tok) ? P().modes[+tok - 1] : P().modes.find((g) => g.name.toLowerCase() === String(tok).toLowerCase()));
const findState = (g, tok) => (!g ? undefined : /^\d+$/.test(tok) ? g.states[+tok - 1] : g.states.find((s) => s.toLowerCase() === String(tok).toLowerCase()));
// Old one-word form: the state must exist in exactly one group. Returns {group, state} or undefined.
function findMode(tok) {
  const hits = P().modes.map((g) => ({ group: g.name, state: findState(g, tok) })).filter((h) => h.state);
  return hits.length === 1 ? hits[0] : undefined;
}
// Trigger reference: its number or its name (separators excluded), like Triggers::findId.
const findTrigs = (tok) => P().triggers.filter((t) => t.type !== 'comment' &&
  (/^\d+$/.test(tok) ? t.id === +tok : (t.name || '').toLowerCase() === String(tok).toLowerCase()));
// Token context for {mstate}: matching/completion sets CTX to the line's tokens;
// the group is always the token after "mode".
let CTX = [];
const panelLabels = () => P().panel.pages.flatMap((pg) => pg.controls).filter((c) => c.type === 'label' && c.name).map((c) => c.name);
// Everything the monitor watches, by name (PCs/devices unless "monitor": false, plus projectors).
const monitoredNames = () => [...P().pcs.filter((x) => x.monitor !== false), ...P().devices.filter((x) => x.monitor !== false), ...P().projectors,
  ...P().tcp, ...P().modbus, ...P().drivers].map((x) => x.name).filter(Boolean);
// Driver placeholders: {kiss} -> drivers of type kissbox, etc. The device is always the 2nd token.
const DRV_PART = { '{kiss}': 'kissbox', '{knx}': 'knx', '{bsign}': 'brightsign', '{digi}': 'digidot', '{netio}': 'netio', '{pharos}': 'pharos' };
const drvList = (type) => P().drivers.filter((d) => d.type === type);
const drvStatusOf = (d) => S.status?.drivers?.find((x) => x.id === d?.id && x.type === d?.type);
// Device groups of one kind (network = no kind; pc, projector, tcp, or a show-device type): the group
// name works wherever a device name of that kind goes (State::groupMembers).
const kindGroups = (kind) => P().deviceGroups.filter((g) => (g.kind || 'network') === kind);
const findKindGroup = (kind, tok) => kindGroups(kind).find((g) => g.name.toLowerCase() === String(tok).toLowerCase());
const groupDesc = (g) => `group · ${g.devices.length} device${g.devices.length === 1 ? '' : 's'}`;
const groupTip = (g, label) => `${label} group ${g.name} → ${g.devices.join(', ') || 'no devices'}`;
// A show device named on the line, or the first one of the group named there (for its outputs, addresses…).
const ctxDrv = (type) => findRef(drvList(type), CTX[1] ?? '') || findRef(drvList(type), findKindGroup(type, CTX[1] ?? '')?.devices[0] ?? '');
const knxAddr = (tok) => (ctxDrv('knx')?.addresses || []).find((a) => a.ga === tok || (a.name || '').toLowerCase() === String(tok).toLowerCase());
// Panel controls that fire Panel triggers (everything with a name except labels).
const panelButtons = () => [...new Set(P().panel.pages.flatMap((pg) => pg.controls).filter((c) => c.name && ['button', ...PANEL_VALUE_TYPES].includes(c.type)).map((c) => c.name))];
// Every named control, for "panel <name> …" actions.
const panelControls = () => [...new Set(P().panel.pages.flatMap((pg) => pg.controls).filter((c) => c.name && c.type !== 'clock' && c.type !== 'spacer').map((c) => c.name))];
const panelControlType = (name) => P().panel.pages.flatMap((pg) => pg.controls).find((c) => (c.name || '').toLowerCase() === String(name || '').toLowerCase())?.type;
function matchPart(part, tok) {
  const p = P();
  // {var} / {=expr} are filled in when the trigger fires, so accept them anywhere.
  if (part.startsWith('{') && /\{[^}]+\}/.test(tok)) return true;
  switch (part) {
    case '{mode}': return !!findMode(tok);
    case '{mgroup}': return !!findGroup(tok);
    case '{mstate}': return !!findState(findGroup(CTX[1] ?? ''), tok);
    case '{mstep}': return /^(next|previous|toggle|back)$/i.test(tok) && !findState(findGroup(CTX[1] ?? ''), tok);
    case '{dur}': return /^\d+(\.\d+)?[smh]?$/i.test(tok);
    case '{label}': return tok.length > 0;
    case '{pctl}': return panelControls().some((n) => n.toLowerCase() === tok.toLowerCase());
    case '{flash}': return tok.length > 0;
    case '{pval}': return /^-?\d+(\.\d+)?(,-?\d+(\.\d+)?)?$/.test(tok) || /^#[0-9a-f]{6}$/i.test(tok);
    case '{color}': return tok.length > 0;
    case '{trig}': return findTrigs(tok).length === 1;
    case '{count}': return /^\d+$/.test(tok) && +tok > 0;
    case '{email}': return /^[^@\s]+@[^@\s]+$/.test(tok);
    case '{device}': return [...p.devices, ...kindGroups('network')].some((d) => d.name.toLowerCase() === tok.toLowerCase());
    case '{oscaddr}': return tok.startsWith('/');
    case '{hhmm}': return /^\d{1,2}:\d{2}$/.test(tok) || /^(sunrise|sunset)([+-]\d+)?$/i.test(tok);
    case '{var}': return p.variables.some((v) => v.name.toLowerCase() === tok.toLowerCase());
    case '{num}': return /^-?\d+(\.\d+)?$/.test(tok);
    case '{op}': return ['=', '==', '!=', '>', '<', '>=', '<='].includes(tok);
    case '{tcpdev}': return p.tcp.some((d) => d.name.toLowerCase() === tok.toLowerCase()) || !!findKindGroup('tcp', tok);
    case '{httpmethod}': return /^(get|post|put|delete)$/i.test(tok);
    case '{url}': return /^http:\/\/[^\s]+$/i.test(tok);
    case '{mbdev}': return p.modbus.some((d) => d.name.toLowerCase() === tok.toLowerCase());
    case '{mbtable}': return /^(coil|holding|register)$/i.test(tok);
    case '{calname}': return p.calendar.some((c) => c.name.toLowerCase() === tok.toLowerCase());
    case '{activity}': return /^(active|inactive)$/i.test(tok);
    case '{date}': return /^(\d{4}-)?\d{1,2}-\d{1,2}$/.test(tok);
    case '{days}': return tok.split(',').every((d) => DAYS.includes(d.trim().toLowerCase()));
    case '{tl}': return !!findRef(p.timelines, tok);
    case '{sc}': return !!findRef(p.scenes, tok);
    case '{sec}': return isNum(tok);
    case '{pct}': return isNum(tok) && +tok <= 100;
    case '{dmx}': return /^\d+$/.test(tok) && +tok <= 255;
    case '{port}': return /^\d+$/.test(tok) && +tok > 0 && +tok < 65536;
    case '{ip}': return /^(\d{1,3}\.){3}\d{1,3}$/.test(tok);
    case '{onoff}': return /^(on|off)$/i.test(tok);
    case '{logcat}': return tok.toLowerCase() === 'all' || LOG_CATS.includes(tok.toUpperCase());
    case '{loglvl}': return LOG_LVLS.includes(tok.toUpperCase());
    case '{proto}': return /^(dmx|artnet|sacn)$/i.test(tok);
    case '{pj}': return tok.toLowerCase() === 'all' || !!findRef(p.projectors, tok) || !!findKindGroup('projector', tok);
    case '{pjinput}': return /^\d{2}$/.test(tok);
    case '{pc}': return tok.toLowerCase() === 'all' || !!findRef(p.pcs, tok) || !!findKindGroup('pc', tok);
    case '{pcaction}': return /^(wake|startup|shutdown|reboot)$/i.test(tok);
    case '{devname}': return monitoredNames().some((n) => n.toLowerCase() === tok.toLowerCase());
    case '{updown}': return /^(online|offline)$/i.test(tok);
    case '{chan}': {
      const m = /^(\d+)\.(\d+)(?:-(\d+))?$/.exec(tok);
      return !!m && !!p.universes.find((u) => u.id === +m[1]) && +m[2] >= 1 && +(m[3] || m[2]) <= 512 && +(m[3] || m[2]) >= +m[2];
    }
    case '{kiss}': case '{knx}': case '{bsign}': case '{digi}': case '{netio}': case '{pharos}': return !!findRef(drvList(DRV_PART[part]), tok) || !!findKindGroup(DRV_PART[part], tok);
    case '{kisspoint}': return /^[1-8]\.[1-8]$/.test(tok);
    case '{kissval}': return /^(on|off)$/i.test(tok) || (/^\d+$/.test(tok) && +tok <= 255);
    case '{slot}': return /^[1-8]$/.test(tok);
    case '{knxga}': return /^\d+\/\d+(\/\d+)?$/.test(tok) || !!knxAddr(tok);
    case '{knxval}': case '{word}': case '{path}': case '{digiscene}': case '{bszone}': case '{bsvar}': case '{bsfile}': case '{bsstate}': return tok.length > 0;
    case '{dpt}': return /^\d+(\.\d+)?$/.test(tok);
    case '{netioout}': return /^(all|\d+)$/i.test(tok) || (drvStatusOf(ctxDrv('netio'))?.points || []).some((x) => /^out\d+$/.test(x.k) && (x.n || '').toLowerCase() === tok.toLowerCase());
    case '{netioact}': return /^(on|off|toggle|restart|pulse)$/i.test(tok);
    case '{pharostl}': return /^(start|release|toggle|pause|resume)$/i.test(tok);
    case '{pharossc}': return /^(start|release|toggle)$/i.test(tok);
    case '{fixgrp}': return /^(fixture|group)$/i.test(tok);
    case '{pharosproto}': return PHAROS_PROTOCOLS.includes(tok.toLowerCase());
    case '{iopoint}': return !!pmcFind(tok);
    case '{ioval}': return /^(on|off|toggle)$/i.test(tok) || (/^\d+(\.\d+)?$/.test(tok) && +tok <= 10);
    case '{text...}': return true;
    default: return tok.toLowerCase() === part;
  }
}
function candidates(part, partial) {
  const p = P();
  const pl = partial.replace(/^"/, '').toLowerCase();
  const hint = (label) => [{ hint: true, label, key: 'h' + label }];
  const presets = (vals, ph) => [...vals.filter((v) => v.startsWith(pl)).map((v) => ({ insert: v, label: v, key: part + v })), ...hint(ph)];
  const objs = (list, kind) =>
    list.filter((o) => !pl || String(o.id).startsWith(pl) || (o.name || '').toLowerCase().includes(pl))
      .map((o) => ({ insert: String(o.id), label: String(o.id), desc: `${kind} · ${o.name || ''}`, key: kind + o.id }));
  // Projectors/PCs: offer the name (clearer, survives reordering); the number when typing digits or the name is ambiguous.
  const named = (list, kind) => {
    const byNumber = /^\d+$/.test(pl);
    const dup = (n) => list.filter((o) => (o.name || '').toLowerCase() === n.toLowerCase()).length > 1;
    return list.filter((o) => !pl || String(o.id).startsWith(pl) || (o.name || '').toLowerCase().includes(pl))
      .map((o) => byNumber || !o.name || dup(o.name) || /^\d+$/.test(o.name)
        ? { insert: String(o.id), label: String(o.id), desc: `${kind} · ${o.name || ''}`, key: kind + o.id }
        : { insert: quote(o.name), label: o.name, desc: `${kind} #${o.id}${o.ip ? ' · ' + o.ip : ''}`, key: kind + o.id });
  };
  const names = (list, desc, k) => list.filter((n) => n.toLowerCase().includes(pl)).map((n) => ({ insert: quote(n), label: n, desc, key: k + n }));
  const groups = (kind) => kindGroups(kind).filter((g) => g.name.toLowerCase().includes(pl)).map((g) => ({ insert: quote(g.name), label: g.name, desc: groupDesc(g), key: 'dg' + kind + g.name }));
  switch (part) {
    case '{mode}': return p.modes.flatMap((g) => g.states.map((s) => ({ g, s }))).filter(({ s }) => s.toLowerCase().includes(pl))
      .map(({ g, s }) => ({ insert: quote(s), label: s, desc: g.name, key: 'm' + g.name + s }));
    case '{mgroup}': return p.modes.filter((g) => g.name.toLowerCase().includes(pl))
      .map((g) => ({ insert: quote(g.name), label: g.name, desc: g.states.join(' · '), key: 'mg' + g.name }));
    case '{mstate}': {
      const g = findGroup(CTX[1] ?? '');
      const cur = S.status?.modes?.[g?.name];
      return (g?.states || []).filter((s) => s.toLowerCase().includes(pl))
        .map((s) => ({ insert: quote(s), label: s, desc: s === cur ? 'current' : g.name, key: 'ms' + s }));
    }
    case '{mstep}': return [['next', 'the next state (after the last: the first)'], ['previous', 'the state before (before the first: the last)'], ['toggle', 'the other state (groups with 2 states)'], ['back', 'the state it was in before']]
      .filter(([v]) => v.startsWith(pl)).map(([v, d]) => ({ insert: v, label: v, desc: d, key: 'mx' + v }));
    case '{dur}': return presets(['30s', '5m', '10m', '1h'], '90 = seconds, 10m, 2h');
    case '{label}': return [...names(panelLabels(), 'panel label', 'lb'), ...hint('<label name>')];
    case '{pctl}': return names(panelControls(), 'panel control', 'pc').map((x) => ({ ...x, desc: panelControlType(x.label) }));
    case '{flash}': return [...[['on', 'flash'], ['off', 'stop flashing'], ['red', 'flash red'], ['orange', 'flash orange']].filter(([v]) => v.startsWith(pl))
      .map(([v, d]) => ({ insert: v, label: v, desc: d, key: 'fl' + v })), ...hint('or #rrggbb')];
    case '{pval}': {
      const ty = panelControlType(CTX[1]);
      return ty === 'color' ? presets(['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000'], '#rrggbb') : ty === 'xy' ? presets(['50,50', '0,0'], 'x,y') : ty === 'toggle' ? presets(['1', '0'], '1 = on, 0 = off') : presets(['0', '50', '100'], '<value>');
    }
    case '{color}': return [...names(['green', 'red', 'orange', 'yellow', 'white', 'grey'], 'colour', 'co'), ...hint('or #rrggbb')];
    case '{trig}': {
      // By name (keeps working when triggers move); typing digits refers by number instead.
      const byNumber = /^\d+$/.test(pl);
      const dup = (name) => p.triggers.filter((x) => x.type !== 'comment' && (x.name || '').toLowerCase() === name.toLowerCase()).length > 1;
      return p.triggers.filter((t) => t.type !== 'comment' && (!pl || String(t.id).startsWith(pl) || (t.name || '').toLowerCase().includes(pl)))
        .map((t) => byNumber || !t.name || dup(t.name)
          ? { insert: String(t.id), label: String(t.id), desc: `${t.name || ''} · ${t.type}`, key: 't' + t.id }
          : { insert: quote(t.name), label: t.name, desc: `#${t.id} · ${t.type}`, key: 't' + t.id });
    }
    case '{count}': return presets(['1', '2', '5', '10'], '<count>');
    case '{device}': return [...names(p.devices.map((d) => d.name), 'device', 'dv'), ...groups('network')];
    case '{oscaddr}': return hint('</osc/address>');
    case '{hhmm}': return presets(['sunrise', 'sunset', 'sunset-30', '08:00', '12:00', '18:00', '22:00'], '<HH:MM | sunrise±min | sunset±min>');
    case '{var}': {
      const vals = S.status?.vars || {};
      return p.variables.filter((v) => v.name.toLowerCase().includes(pl))
        .map((v) => ({ insert: quote(v.name), label: v.name, desc: `${v.type}${vals[v.name] != null ? ' = ' + vals[v.name] : ''}`, key: 'v' + v.name }));
    }
    case '{num}': return presets(['1', '5', '10', '0'], '<number>');
    case '{op}': return ['=', '!=', '>', '<', '>=', '<='].filter((v) => v.startsWith(pl)).map((v) => ({ insert: v, label: v, key: 'op' + v }));
    case '{tcpdev}': return [...names(p.tcp.map((d) => d.name), 'TCP device', 'td'), ...groups('tcp')];
    case '{httpmethod}': return ['get', 'post', 'put', 'delete'].filter((v) => v.startsWith(pl)).map((v) => ({ insert: v, label: v, key: 'hm' + v }));
    case '{url}': return [...(pl ? [] : [{ insert: 'http://', label: 'http://', desc: 'start a URL', key: 'url', noSpace: true }]), ...hint('<http://host/path>')];
    case '{mbdev}': return names(p.modbus.map((d) => d.name), 'Modbus device', 'md');
    case '{mbtable}': return [['coil', 'on/off output'], ['holding', '16-bit register']].filter(([v]) => v.startsWith(pl)).map(([v, d]) => ({ insert: v, label: v, desc: d, key: 'mt' + v }));
    case '{calname}': return names([...new Set(p.calendar.map((c) => c.name))], 'calendar', 'cn');
    case '{activity}': return ['active', 'inactive'].filter((v) => v.startsWith(pl)).map((v) => ({ insert: v, label: v, key: 'ac' + v }));
    case '{date}': return presets(['12-24', '12-31', '01-01', new Date().toISOString().slice(0, 10)], '<MM-DD | YYYY-MM-DD>');
    case '{days}': return presets(['mon,tue,wed,thu,fri', 'sat,sun'], '<mon,tue,…>');
    case '{email}': return hint('<name@domain>');
    case '{tl}': return named(p.timelines, 'timeline');
    case '{sc}': return objs(p.scenes, 'scene');
    case '{sec}': return presets(['0', '1', '2', '3', '5', '10'], '<seconds>');
    case '{pct}': return presets(['0', '25', '50', '75', '100'], '<0-100>');
    case '{dmx}': return presets(['0', '127', '255'], '<0-255>');
    case '{onoff}': return ['on', 'off'].filter((v) => v.startsWith(pl)).map((v) => ({ insert: v, label: v, key: v }));
    case '{logcat}': return ['all', ...LOG_CATS.map((c) => c.toLowerCase())].filter((v) => v.startsWith(pl)).map((v) => ({ insert: v, label: v, key: 'c' + v }));
    case '{loglvl}': return LOG_LVLS.map((c) => c.toLowerCase()).filter((v) => v.startsWith(pl)).map((v) => ({ insert: v, label: v, key: 'l' + v }));
    case '{proto}': return PROTOCOLS.filter(([v]) => v.startsWith(pl)).map(([v, n]) => ({ insert: v, label: v, desc: n, key: 'p' + v }));
    case '{pj}': return [...('all'.startsWith(pl) ? [{ insert: 'all', label: 'all', desc: 'every projector', key: 'pjall' }] : []), ...named(p.projectors, 'projector'), ...groups('projector')];
    case '{pc}': return [...('all'.startsWith(pl) ? [{ insert: 'all', label: 'all', desc: 'every PC', key: 'pcall' }] : []), ...named(p.pcs, 'pc'), ...groups('pc')];
    case '{devname}': return names(monitoredNames(), 'monitored', 'mn');
    case '{updown}': return ['online', 'offline'].filter((v) => v.startsWith(pl)).map((v) => ({ insert: v, label: v, key: 'ud' + v }));
    case '{pcaction}': return PC_ACTIONS.filter(([v]) => v.startsWith(pl)).map(([v, d]) => ({ insert: v, label: v, desc: d, key: 'pa' + v }));
    case '{pjinput}': return [...PJ_INPUTS.filter(([v, n]) => !pl || v.startsWith(pl) || n.toLowerCase().includes(pl)).map(([v, n]) => ({ insert: v, label: v, desc: n, key: 'i' + v })), ...hint('<input code>')];
    case '{kiss}': case '{knx}': case '{bsign}': case '{digi}': case '{netio}': case '{pharos}': {
      const ty = DRV_PART[part];
      return [...drvList(ty).filter((d) => !pl || String(d.id).startsWith(pl) || (d.name || '').toLowerCase().includes(pl))
        .map((d) => ({ insert: quote(d.name || String(d.id)), label: d.name || String(d.id), desc: `${DRIVERS[ty].label} · ${d.ip}`, key: 'dr' + d.id })), ...groups(ty)];
    }
    case '{kisspoint}': {
      const d = ctxDrv('kissbox');
      const pts = (d?.cards || []).flatMap((code, i) => {
        const [, , n, kind] = kissCard(code);
        return kind === 'out' || kind === 'aout' ? Array.from({ length: n }, (_, c) => [`${i + 1}.${c + 1}`, d.names?.[`${i + 1}.${c + 1}`] || `slot ${i + 1} ${code} ${c + 1}`]) : [];
      });
      return [...pts.filter(([v]) => v.startsWith(pl)).slice(0, 24).map(([v, n]) => ({ insert: v, label: v, desc: n, key: 'kp' + v })), ...hint('<slot>.<channel>')];
    }
    case '{kissval}': return presets(['on', 'off', '0', '128', '255'], 'on|off|0-255');
    case '{slot}': return presets(['1', '2', '3'], '<slot 1-8>');
    case '{knxga}': return [...(ctxDrv('knx')?.addresses || []).filter((a) => a.ga.startsWith(pl) || (a.name || '').toLowerCase().includes(pl))
      .map((a) => ({ insert: quote(a.name || a.ga), label: a.name || a.ga, desc: `${a.ga} · DPT ${a.dpt || '1'}`, key: 'ga' + a.ga })), ...hint('<main/middle/sub>')];
    case '{knxval}': return presets(['on', 'off', '50', '21.5', 'up', 'down', 'stop'], '<value>');
    case '{dpt}': return [['1', 'on/off'], ['3', 'dim up/down/stop'], ['5.001', 'percent 0-100'], ['5.010', 'number 0-255'], ['7', '0-65535'],
      ['9', 'temperature etc. (float)'], ['14', '4-byte float'], ['17', 'scene 1-64'], ['18', 'scene control'], ['232', 'RGB #rrggbb']]
      .filter(([v]) => v.startsWith(pl)).map(([v, n]) => ({ insert: v, label: v, desc: n, key: 'dpt' + v }));
    case '{path}': {
      const bs = CTX[0]?.toLowerCase() === 'brightsign';
      const paths = bs ? [['info', 'player info'], ['control/reboot', 'reboot'], ['files/sd', 'files on the SD card'], ['snapshot', 'screenshot'], ['video-mode', 'video output'], ['time', 'clock']]
        : [['system', 'controller info'], ['project', 'project info'], ['timeline', 'timeline states'], ['scene', 'scene states'], ['group', 'group levels'],
          ['temperature', 'temperatures'], ['time', 'clock'], ['text_slot', 'text slots'], ['lua', 'Lua variables'], ['log', 'controller log'], ['replication', 'replication'], ['input', 'inputs']];
      return [...paths.filter(([v]) => v.startsWith(pl)).map(([v, n]) => ({ insert: v, label: v, desc: n, key: 'pa' + v })), ...hint('<path, e.g. info or /api/v1/info>')];
    }
    // BrightSign zones and user variables, as the kdlink plugin reported them.
    case '{bszone}': return [...(drvStatusOf(ctxDrv('brightsign'))?.points || []).filter((x) => /^z\d+$/.test(x.k)).map((x) => [x.k.slice(1), (x.n || '').replace(/^Zone \d+ ?/, ''), x.v])
      .filter(([n, name]) => n.startsWith(pl) || name.toLowerCase().includes(pl)).map(([n, name, v]) => ({ insert: quote(name || n), label: name || n, desc: `zone ${n}${v ? ' · now ' + v : ''}`, key: 'bz' + n })), ...hint('<zone name or #>')];
    case '{bsvar}': return [...(drvStatusOf(ctxDrv('brightsign'))?.points || []).filter((x) => x.k.startsWith('var.') && (x.n || x.k).toLowerCase().includes(pl))
      .map((x) => ({ insert: quote(x.n || x.k.slice(4)), label: x.n || x.k.slice(4), desc: `user variable · now ${x.v}`, key: 'bv' + x.k })), ...hint('<user variable>')];
    case '{bsfile}': return hint('<file on the card, e.g. clip.mp4>');
    case '{bsstate}': {
      // The states of the zone typed before (by name or number), as the plugin read them from the presentation.
      const st = drvStatusOf(ctxDrv('brightsign')), zt = String(CTX[3] || '').replace(/^"|"$/g, '').toLowerCase();
      const zp = (st?.points || []).find((x) => /^z\d+$/.test(x.k) && (x.k.slice(1) === zt || (x.n || '').replace(/^Zone \d+ ?/, '').toLowerCase() === zt));
      const zn = zp ? +zp.k.slice(1) : 0;
      return [...(st?.states || []).filter((s) => (!zn || s.z === zn) && s.n.toLowerCase().includes(pl))
        .map((s) => ({ insert: quote(s.n), label: s.n, desc: `zone ${s.z}${s.f ? ' · ' + s.f : ' · no media file'}`, key: `bt${s.z}|${s.n}` })), ...hint('<state>')];
    }
    case '{digiscene}': return [...(drvStatusOf(ctxDrv('digidot'))?.scenes || []).filter((s) => s.toLowerCase().includes(pl))
      .map((s) => ({ insert: quote(s), label: s, desc: 'DiGidot scene', key: 'ds' + s })), ...hint('<scene name or #>')];
    case '{netioout}': {
      const outs = (drvStatusOf(ctxDrv('netio'))?.points || []).filter((x) => /^out\d+$/.test(x.k));
      return [...('all'.startsWith(pl) ? [{ insert: 'all', label: 'all', desc: 'every output', key: 'noall' }] : []),
        ...outs.filter((x) => x.k.slice(3).startsWith(pl) || (x.n || '').toLowerCase().includes(pl)).map((x) => ({ insert: x.k.slice(3), label: x.k.slice(3), desc: x.n, key: 'no' + x.k })), ...hint('<output number>')];
    }
    case '{netioact}': return [['on', 'switch on'], ['off', 'switch off'], ['toggle', 'invert'], ['restart', 'off for a moment, then on'], ['pulse', 'on for a moment, then off']]
      .filter(([v]) => v.startsWith(pl)).map(([v, n]) => ({ insert: v, label: v, desc: n, key: 'na' + v }));
    case '{pharostl}': return ['start', 'release', 'toggle', 'pause', 'resume'].filter((v) => v.startsWith(pl)).map((v) => ({ insert: v, label: v, key: 'pt' + v }));
    case '{pharossc}': return ['start', 'release', 'toggle'].filter((v) => v.startsWith(pl)).map((v) => ({ insert: v, label: v, key: 'ps' + v }));
    case '{fixgrp}': return ['fixture', 'group'].filter((v) => v.startsWith(pl)).map((v) => ({ insert: v, label: v, key: 'fg' + v }));
    case '{pharosproto}': return PHAROS_PROTOCOLS.filter((v) => v.startsWith(pl)).map((v) => ({ insert: v, label: v, key: 'pp' + v }));
    case '{iopoint}': {
      // Commands switch outputs, so list those first; conditions read anything.
      const keys = pmcKeys().sort((a, b) => pmcIsOut(b) - pmcIsOut(a));
      return keys.filter((k) => !pl || k.startsWith(pl) || (pmcCfg(k).name || '').toLowerCase().includes(pl)).slice(0, 40)
        .map((k) => ({ insert: k, label: k, desc: `${pmcIsOut(k) ? 'output' : 'input'}${pmcCfg(k).name ? ' · ' + pmcCfg(k).name : ''}`, key: 'io' + k }));
    }
    case '{ioval}': return /^ao/.test(CTX[1] || '') ? presets(['0', '5', '10', 'off'], '<0-10 volts>')
      : [['on', 'switch on'], ['off', 'switch off'], ['toggle', 'invert']].filter(([v]) => v.startsWith(pl)).map(([v, n]) => ({ insert: v, label: v, desc: n, key: 'iv' + v }));
    case '{chan}':
      if (pl.includes('.')) return hint(PLACEHOLDER[part]);
      return p.universes.filter((u) => String(u.id).startsWith(pl))
        .map((u) => ({ insert: u.id + '.', label: u.id + '.', desc: 'universe · ' + (u.name || ''), key: 'u' + u.id, noSpace: true }));
    default:
      if (part.startsWith('{')) return hint(PLACEHOLDER[part]);
      return part.startsWith(pl) ? [{ insert: part, label: part, key: 'k' + part }] : [];
  }
}
// Walks every grammar pattern against the tokens typed before the cursor.
function completeBase(text, grammar = GRAMMAR) {
  const toks = tokenize(text);
  const last = toks[toks.length - 1];
  const inToken = toks.length && !/\s$/.test(text) || (last && last.quoted && !last.closed);
  const partial = inToken ? last.raw : '';
  const done = (inToken ? toks.slice(0, -1) : toks).map((t) => t.v);
  CTX = done;
  const items = [], seen = new Set(), sigs = [];
  for (const g of grammar) {
    if (g.hidden) continue;  // still valid, just not suggested
    let k = 0, ok = true;
    for (; k < done.length; k++) {
      const part = g.parts[k];
      if (!part) { ok = false; break; }
      if (part === '{text...}') break;
      if (!matchPart(part, done[k])) { ok = false; break; }
    }
    if (!ok) continue;
    const part = g.parts[k];
    if (!part) { sigs.push(g); continue; }
    sigs.push(g);
    for (const c of candidates(part, partial)) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      items.push({ ...c, doc: g.doc });
    }
  }
  return { items, partial, sigs };
}
function validateBase(line, grammar = GRAMMAR) {
  const t = line.trim();
  if (!t || t.startsWith('#')) return { ok: true };
  const toks = tokenize(t).map((x) => x.v);
  CTX = toks;
  for (const g of grammar) {
    const parts = g.parts;
    const text = parts[parts.length - 1] === '{text...}';
    if (text ? toks.length < parts.length : toks.length !== parts.length) continue;
    if (parts.every((p, i) => p === '{text...}' || matchPart(p, toks[i]))) return { ok: true, g };
  }
  // Best explanation: the longest pattern prefix that matched.
  let best = null, bestK = -1;
  for (const g of grammar) {
    let k = 0;
    while (k < toks.length && k < g.parts.length && (g.parts[k] === '{text...}' || matchPart(g.parts[k], toks[k]))) k++;
    // On a tie prefer a pattern that goes on ("scene 1 fdae" -> the "fade" variant, not "too many words").
    if (k > bestK || (k === bestK && !best.parts[k] && g.parts[k])) { bestK = k; best = g; }
  }
  if (!best || bestK === 0) {
    const firsts = [...grammar.map((g) => g.parts[0]), ...(grammar === GRAMMAR ? ['if'] : [])];
    return { ok: false, error: `'${toks[0]}' is not a ${grammar === GRAMMAR ? 'command' : 'condition'}` + didYouMean(toks[0], firsts) };
  }
  const want = best.parts[bestK];
  if (want === '{trig}' && findTrigs(toks[bestK] ?? '').length > 1)
    return { ok: false, error: `${findTrigs(toks[bestK]).length} triggers are named '${toks[bestK]}' - rename one or use its number`, g: best };
  // send udp/osc: the target can be an IP, a device or a device group.
  if (want === '{ip}' && grammar.some((g) => g.parts[bestK] === '{device}' && g.parts.slice(0, bestK).join(' ') === best.parts.slice(0, bestK).join(' ')))
    return { ok: false, error: toks[bestK] == null ? 'missing device, device group or IP address' : `unknown device, device group or IP '${toks[bestK]}'`, g: best };
  const tok = toks[bestK], what = PLACEHOLDER[want] || want, use = ` (write: ${sigText(best)})`;
  if (!want) return { ok: false, error: `too many words: '${tok}' is not used here${use}`, g: best };
  if (tok == null) return { ok: false, error: `missing ${what} at the end${use}`, g: best };
  // Everything that would have fitted here, for "did you mean".
  const alts = [];
  for (const g of grammar) {
    if (!g.parts.slice(0, bestK).every((p, i) => p === '{text...}' || matchPart(p, toks[i]))) continue;
    const part = g.parts[bestK];
    if (!part) continue;
    // Keywords, names and fixed words; not number presets ("did you mean '50'" helps nobody).
    if (!part.startsWith('{')) alts.push(part);
    else if (PART_CLASS[part] === 'ref' || PART_CLASS[part] === 'kw') try { CTX = toks.slice(0, bestK); alts.push(...candidates(part, '').filter((c) => !c.hint).map((c) => c.label)); } catch (e) { /* no project data (e.g. in Node) */ }
  }
  CTX = toks;
  const kind = what.replace(/^<(.*)>$/, '$1').replace(/ name or #$/, '');
  const near = didYouMean(tok, alts);
  if (!want.startsWith('{')) return { ok: false, error: `'${tok}' doesn't fit here` + (near || `, expected '${want}'`), g: best };
  const why = PART_CLASS[want] === 'ref' ? `there is no ${kind} '${tok}'` : `'${tok}' is not a valid ${what}`;
  return { ok: false, error: why + near, g: best };
}
// " - did you mean 'start'?" when one of the options is close to what was typed (a typo, two swapped
// letters or the start of it).
function didYouMean(typed, options) {
  const a = String(typed).toLowerCase();
  if (!a) return '';
  const dist = (b) => {
    const d = [Array.from({ length: b.length + 1 }, (_, j) => j)];
    for (let i = 1; i <= a.length; i++) {
      d[i] = [i];
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  };
  let best = null, bestD = Infinity;
  for (const o of new Set(options)) {
    const b = String(o).toLowerCase();
    if (b === a) continue;
    const d = a.length >= 2 && b.startsWith(a) ? 0.5 : dist(b);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best != null && bestD <= Math.max(1, Math.floor(a.length / 3)) ? ` - did you mean '${best}'?` : '';
}
const sigText = (g) => g.parts.map((p) => PLACEHOLDER[p] || p).join(' ');

// ---- if <condition> then <command> [else <command>] --------------------------
// Split on unquoted "then"/"else" (same rule as the firmware's splitIf).
const IF_G = GRAMMAR.find((g) => g.parts[0] === 'if');
function splitIfLine(text) {
  const toks = tokenize(text);
  if (!toks.length || toks[0].quoted || toks[0].v.toLowerCase() !== 'if') return null;
  let thenTok = null, elseTok = null;
  for (let i = 1; i < toks.length; i++) {
    const w = toks[i].quoted ? '' : toks[i].v.toLowerCase();
    if (!thenTok && w === 'then') thenTok = toks[i];
    else if (thenTok && !elseTok && w === 'else') elseTok = toks[i];
  }
  return { ifTok: toks[0], thenTok, elseTok };
}
// ---- wait until <condition> [timeout <s>] / repeat <n> times [every <s>] <command> ----
// A fixed head, then a condition or a command (same rules as runActions in Triggers.cpp).
// Returns null, or {kind: 'wait'|'loop', head: tokens, body: where the condition/command starts
// (null while the head isn't complete), bodyEnd, timeout: [tok, tok?] | null, every}.
const WAIT_G = GRAMMAR.find((g) => g.pattern === 'wait until {text...}');
const LOOP_G = GRAMMAR.find((g) => g.pattern === 'repeat {count} times {text...}');
const LOOP_EVERY_G = GRAMMAR.find((g) => g.pattern === 'repeat {count} times every {sec} {text...}');
function splitHead(text) {
  const toks = tokenize(text);
  const w = (i) => (toks[i] && !toks[i].quoted ? toks[i].v.toLowerCase() : null);
  if (w(0) === 'wait') {
    if (w(1) !== 'until') return { kind: 'wait', head: toks.slice(0, 2), body: null };
    const n = toks.length;
    let end = text.length, timeout = null;
    if (n >= 4 && w(n - 2) === 'timeout') { timeout = [toks[n - 2], toks[n - 1]]; end = toks[n - 2].start; }
    else if (n >= 3 && w(n - 1) === 'timeout') { timeout = [toks[n - 1]]; end = toks[n - 1].start; }
    return { kind: 'wait', head: toks.slice(0, 2), body: toks[1].end, bodyEnd: end, timeout };
  }
  if (w(0) === 'repeat' && w(2) === 'times' && w(1) !== 'trigger') {
    const every = w(3) === 'every', head = toks.slice(0, every ? 5 : 3);
    return { kind: 'loop', every, head, body: every && head.length < 5 ? null : head[head.length - 1].end, bodyEnd: text.length };
  }
  return null;
}
// "repeat <trigger> <n> times …": the trigger token, else null.
function trigLoopRef(line) {
  const toks = tokenize(line);
  const w = (i) => (toks[i] && !toks[i].quoted ? toks[i].v.toLowerCase() : null);
  return w(0) === 'repeat' && toks[1] && w(1) !== 'trigger' && w(3) === 'times' && /^\d+$|\{/.test(toks[2]?.v || '') ? toks[1] : null;
}
// Validation for those lines, or null for any other line.
function validateHead(line) {
  const h = splitHead(line);
  if (!h) return null;
  if (h.kind === 'wait') {
    const g = WAIT_G;
    if (h.body == null) return { ok: false, error: 'expected: wait until <condition> [timeout <seconds>]', g };
    const cond = line.slice(h.body, h.bodyEnd).trim();
    if (!cond) return { ok: false, error: 'missing condition after until, e.g. wait until timeline 2 stopped', g };
    const vc = validateBase(cond, COND_GRAMMAR);
    if (!vc.ok) return { ok: false, error: 'condition: ' + vc.error, g };
    if (h.timeout && (h.timeout.length < 2 || !matchPart('{sec}', h.timeout[1].v))) return { ok: false, error: 'missing seconds after timeout', g };
    return { ok: true, g };
  }
  const g = h.every ? LOOP_EVERY_G : LOOP_G;
  if (!matchPart('{count}', h.head[1].v)) return { ok: false, error: `'${h.head[1].v}' is not a number of times`, g };
  if (h.body == null) return { ok: false, error: h.head.length < 5 ? 'missing seconds after every' : `'${h.head[4].v}' is not a number of seconds`, g };
  if (h.every && !matchPart('{sec}', h.head[4].v)) return { ok: false, error: `'${h.head[4].v}' is not a number of seconds`, g };
  const cmd = line.slice(h.body).trim();
  if (!cmd) return { ok: false, error: 'missing the command to repeat, e.g. repeat 8 times every 0.5 io out{i} on', g };
  if (/^(sleep|wait)\b/i.test(cmd) || splitHead(cmd)?.kind === 'loop' || trigLoopRef(cmd)) return { ok: false, error: `'${cmd.split(/\s/)[0]}' can't be repeated inside a repeat line`, g };
  const vc = validate(cmd);
  if (!vc.ok) return { ok: false, error: 'command: ' + vc.error, g };
  return { ok: true, g };
}
function completeHead(text, h) {
  const res0 = (items, partial, g) => ({ items, partial, sigs: [g] });
  if (h.kind === 'wait') {
    const last = tokenize(text).pop();
    const inTok = last && !/\s$/.test(text);
    // Typing the seconds after "timeout".
    if (h.timeout && (h.timeout.length === 2 || !inTok)) {
      const partial = inTok && h.timeout.length === 2 ? last.raw : '';
      return res0(candidates('{sec}', partial).map((c) => ({ ...c, doc: WAIT_G.doc })), partial, WAIT_G);
    }
    const sub = text.slice(h.body).replace(/^\s+/, '');
    const res = completeBase(sub, COND_GRAMMAR);
    const done = sub.slice(0, sub.length - res.partial.length).trim();
    if (done && validateBase(done, COND_GRAMMAR).ok && 'timeout'.startsWith(res.partial.toLowerCase()))
      res.items.push({ insert: 'timeout', label: 'timeout', desc: 'timeout <seconds>: give up after that long', key: 'ktimeout' });
    res.sigs = [WAIT_G];
    return res;
  }
  const sub = text.slice(h.body).replace(/^\s+/, '');
  const res = complete(sub, GRAMMAR);
  if (!h.every && !tokenize(sub.slice(0, sub.length - res.partial.length)).length && 'every'.startsWith(res.partial.toLowerCase()))
    res.items.unshift({ insert: 'every', label: 'every', desc: 'every <seconds>: a pause between the runs', key: 'kevery' });
  return res;
}
function classifyHead(line, h) {
  const v = validateHead(line), g = v.g;
  const out = h.head.map((tok, i) => {
    const w = tok.v.toLowerCase(), r = { start: tok.start, end: tok.end };
    if (i === 0) return { ...r, cls: 'cmd', tip: `${g.doc}.\n${sigText(g)}${h.kind === 'wait' ? ' [timeout <seconds>]' : ''}` };
    if (['until', 'times', 'every'].includes(w)) return { ...r, cls: 'kw', tip: '' };
    const part = h.kind === 'wait' ? null : i === 1 ? '{count}' : '{sec}';
    return part && matchPart(part, tok.v) ? { ...r, cls: 'num', tip: partHelp(part, tok.v, g) } : { ...r, cls: 'err', tip: v.error || 'Not understood.' };
  });
  if (h.body == null) return out;
  const shift = (ranges, off) => ranges.map((x) => ({ ...x, start: x.start + off, end: x.end + off }));
  if (h.kind === 'loop') return [...out, ...shift(classify(line.slice(h.body), GRAMMAR), h.body)];
  out.push(...shift(classifyBase(line.slice(h.body, h.bodyEnd), COND_GRAMMAR), h.body));
  if (h.timeout) {
    out.push({ start: h.timeout[0].start, end: h.timeout[0].end, cls: 'kw', tip: 'Give up after this many seconds: the lines below are then skipped.' });
    const s = h.timeout[1];
    if (s) out.push({ start: s.start, end: s.end, cls: matchPart('{sec}', s.v) ? 'num' : 'err', tip: matchPart('{sec}', s.v) ? `${s.v} seconds` : v.error });
  }
  return out;
}
function complete(text, grammar = GRAMMAR) {
  const h = grammar === GRAMMAR && splitHead(text);
  if (h && h.body != null && text.length > h.body) return completeHead(text, h);
  const s = grammar === GRAMMAR && splitIfLine(text);
  // Still typing the first word: offer "if" next to the normal commands.
  if (!s || text.length <= s.ifTok.end) {
    const res = completeBase(text, grammar);
    if (grammar === GRAMMAR && 'if'.startsWith(res.partial.toLowerCase()) && !tokenize(text.slice(0, text.length - res.partial.length)).length)
      res.items.unshift({ insert: 'if', label: 'if', desc: 'if <condition> then <command>', key: 'kif', doc: IF_G.doc });
    return res;
  }
  const kw = s.elseTok || s.thenTok;
  if (!kw || text.length <= kw.end) {
    // In the condition: complete with the condition grammar, then offer "then".
    const sub = text.slice(s.ifTok.end).replace(/^\s+/, '');
    const res = completeBase(sub, COND_GRAMMAR);
    const done = sub.slice(0, sub.length - res.partial.length).trim();
    if (!kw && done && validateBase(done, COND_GRAMMAR).ok && 'then'.startsWith(res.partial.toLowerCase()))
      res.items.unshift({ insert: 'then', label: 'then', desc: 'then run this command', key: 'kthen' });
    res.sigs = [IF_G];
    return res;
  }
  // In a command after then/else (may itself be another if).
  const sub = text.slice(kw.end).replace(/^\s+/, '');
  const res = complete(sub, GRAMMAR);
  const done = sub.slice(0, sub.length - res.partial.length).trim();
  if (!s.elseTok && done && validate(done).ok && 'else'.startsWith(res.partial.toLowerCase()))
    res.items.push({ insert: 'else', label: 'else', desc: 'otherwise run this command', key: 'kelse' });
  return res;
}
function validate(line, grammar = GRAMMAR) {
  const hv = grammar === GRAMMAR && validateHead(line);
  if (hv) return hv;
  const lr = grammar === GRAMMAR && trigLoopRef(line);
  if (lr && !/\{/.test(lr.v) && findTrigs(lr.v).length !== 1) {
    const n = findTrigs(lr.v).length, g = GRAMMAR.find((x) => x.pattern === 'repeat {trig} {count} times every {sec}');
    return { ok: false, error: n ? `${n} triggers are named '${lr.v}' - rename one or use its number` : `there is no trigger '${lr.v}'` + didYouMean(lr.v, P().triggers.filter((t) => t.type !== 'comment').map((t) => t.name)), g };
  }
  const s = grammar === GRAMMAR && splitIfLine(line);
  if (!s) return validateBase(line, grammar);
  if (!s.thenTok) return { ok: false, error: "if needs 'then <command>'", g: IF_G };
  const cond = line.slice(s.ifTok.end, s.thenTok.start).trim();
  const a = line.slice(s.thenTok.end, s.elseTok ? s.elseTok.start : line.length).trim();
  const b = s.elseTok ? line.slice(s.elseTok.end).trim() : null;
  if (!cond) return { ok: false, error: 'missing condition after if', g: IF_G };
  const vc = validateBase(cond, COND_GRAMMAR);
  if (!vc.ok) return { ok: false, error: 'condition: ' + vc.error, g: IF_G };
  if (!a) return { ok: false, error: 'missing command after then', g: IF_G };
  for (const x of [a, b]) {
    if (!x) continue;
    const word = /^(sleep|wait)\b/i.exec(x)?.[1] || (splitHead(x)?.kind === 'loop' || trigLoopRef(x) ? 'repeat … times' : '');
    if (word) return { ok: false, error: `${word.toLowerCase()} only works on its own line, not after then/else`, g: IF_G };
  }
  const va = validate(a);
  if (!va.ok) return { ok: false, error: 'then: ' + va.error, g: IF_G };
  if (b !== null) {
    if (!b) return { ok: false, error: 'missing command after else', g: IF_G };
    const vb = validate(b);
    if (!vb.ok) return { ok: false, error: 'else: ' + vb.error, g: IF_G };
  }
  return { ok: true, g: IF_G };
}
function classify(line, grammar) {
  const h = grammar === GRAMMAR && splitHead(line);
  if (h) return classifyHead(line, h);
  const s = grammar === GRAMMAR && splitIfLine(line);
  if (!s) return classifyBase(line, grammar);
  const shift = (ranges, off) => ranges.map((r) => ({ ...r, start: r.start + off, end: r.end + off }));
  const kwRange = (tok, tip) => ({ start: tok.start, end: tok.end, cls: tok === s.ifTok ? 'cmd' : 'kw', tip });
  const out = [kwRange(s.ifTok, `${IF_G.doc}.\nif <condition> then <command> [else <command>]`)];
  const condEnd = s.thenTok ? s.thenTok.start : line.length;
  out.push(...shift(classifyBase(line.slice(s.ifTok.end, condEnd), COND_GRAMMAR), s.ifTok.end));
  if (s.thenTok) {
    out.push(kwRange(s.thenTok, 'Runs the next command when the condition is true.'));
    const aEnd = s.elseTok ? s.elseTok.start : line.length;
    out.push(...shift(classify(line.slice(s.thenTok.end, aEnd), GRAMMAR), s.thenTok.end));
  }
  if (s.elseTok) {
    out.push(kwRange(s.elseTok, 'Runs the next command when the condition is false.'));
    out.push(...shift(classify(line.slice(s.elseTok.end), GRAMMAR), s.elseTok.end));
  }
  return out;
}

// Typing "{name" (or a name inside "{=maths"): offer the project's variables, what the
// selected trigger provides ({message}, {value}…) and {i} in a repeat loop. Null otherwise.
function completeVar(text) {
  const brace = /\{([A-Za-z_][\w.]*)?$/.exec(text);
  const maths = !brace && /\{=[^}]*?([A-Za-z_]\w*)$/.exec(text);
  if (!brace && !maths) return null;
  const partial = brace ? brace[0] : maths[1], pl = (brace ? brace[1] || '' : maths[1]).toLowerCase();
  const wrap = (n) => (brace ? `{${n}}` : n);
  const t = S.view === 'triggers' ? P().triggers[S.sel.trigger] : null;
  const own = (TRIGGER_VARS[t?.type] || []).map((v) => v.split(' ')[0]).filter((n) => /^[A-Za-z_]\w*$/.test(n));
  const vals = S.status?.vars || {};
  const list = [
    ...(/^\s*repeat\s+\d+\s+times\b/i.test(text) ? [['i', 'counts 1, 2, 3… in this repeat']] : []),
    ...own.map((n) => [n, `from this ${t.type} trigger`]),
    ...P().variables.map((v) => [v.name, `${v.type}${vals[v.name] != null ? ' = ' + vals[v.name] : ''}`]),
    ...(brace ? P().modes.map((g) => [`mode.${g.name}`, `state of ${g.name}${S.status?.modes?.[g.name] ? ' = ' + S.status.modes[g.name] : ''}`]) : []),
  ];
  const seen = new Set();
  const items = list.filter(([n]) => n.toLowerCase().includes(pl) && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
    .map(([n, desc]) => ({ insert: wrap(n), label: wrap(n), desc, key: 'vv' + n, noSpace: true, varRef: true }));
  if (brace && !pl) items.push({ insert: '{=', label: '{=…}', desc: 'maths, e.g. {=visitors*2}', key: 'vvmath', noSpace: true, varRef: true });
  return { items, partial, sigs: [] };
}

// Autocomplete dropdown for a command <input>.
function attachAC(input, { onEnter, grammar = GRAMMAR } = {}) {
  const box = document.createElement('div');
  box.className = 'ac';
  document.body.appendChild(box);
  let items = [], idx = 0, res = null;
  const hl = attachHighlight(input, grammar);

  const hide = () => { box.style.display = 'none'; items = []; };
  const check = () => {
    const v = validate(input.value, grammar);
    input.classList.toggle('invalid', !v.ok);
    hl.wrap.classList.toggle('invalid', !v.ok);
    hl.paint();
  };
  function update() {
    check();
    if (document.activeElement !== input) return hide();
    const upto = input.value.slice(0, input.selectionStart);
    res = completeVar(upto) || complete(upto, grammar);
    items = res.items;
    // Nothing useful to offer once the token is complete and exact.
    if (items.length === 1 && !items[0].hint && items[0].insert === res.partial) items = [];
    if (!items.length && !res.sigs.length) return hide();
    idx = Math.max(0, items.findIndex((i) => !i.hint));
    const sig = res.sigs.length ? res.sigs.slice(0, 3).map((g) => esc(sigText(g))).join('<br>') : '';
    box.innerHTML = items.slice(0, 50).map((it, i) =>
      `<div class="opt${it.hint ? ' hint' : ''}${i === idx ? ' on' : ''}" data-i="${i}"><span>${esc(it.label)}</span><span class="d">${esc(it.desc || (i === 0 || items[i - 1].doc !== it.doc ? '' : ''))}</span></div>`).join('') +
      (sig ? `<div class="sig">${sig}</div>` : '');
    // In CSS pixels (the page may be zoomed; see applyUi).
    const z = uiZoom(), sr = input.getBoundingClientRect(), vh = innerHeight / z;
    const r = { left: sr.left / z, top: sr.top / z, bottom: sr.bottom / z, width: sr.width / z };
    box.style.display = 'block';
    box.style.left = r.left + 'px';
    box.style.width = Math.max(r.width, 260) + 'px';
    const below = vh - r.bottom;
    if (below < 200 && r.top > below) { box.style.top = ''; box.style.bottom = vh - r.top + 2 + 'px'; }
    else { box.style.bottom = ''; box.style.top = r.bottom + 2 + 'px'; }
  }
  function accept(i) {
    const it = items[i];
    if (!it || it.hint) return false;
    const caret = input.selectionStart;
    const before = input.value.slice(0, caret - res.partial.length);
    // A {variable} sits inside other text (often quoted): replace only the rest of its name.
    const after = it.varRef ? input.value.slice(caret).replace(it.insert.endsWith('}') ? /^\w*\}?/ : /^\w*/, '') : input.value.slice(caret).replace(/^\S*/, '').replace(/^\s+/, '');
    const ins = it.insert + (it.noSpace ? '' : ' ');
    input.value = before + ins + after;
    const pos = (before + ins).length;
    input.setSelectionRange(pos, pos);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    update();
    return true;
  }
  const move = (d) => {
    if (!items.some((i) => !i.hint)) return;
    do idx = (idx + d + items.length) % items.length; while (items[idx].hint);
    $$('.opt', box).forEach((o, i) => o.classList.toggle('on', i === idx));
    $('.opt.on', box)?.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('keydown', (e) => {
    const open = box.style.display === 'block' && items.some((i) => !i.hint);
    if (open && e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (open && e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (open && e.key === 'Tab') { e.preventDefault(); accept(idx); }
    else if (e.key === 'Enter') {
      if (open && res.partial && accept(idx)) { e.preventDefault(); return; }
      if (onEnter) { e.preventDefault(); hide(); onEnter(); }
    } else if (e.key === 'Escape') hide();
  });
  input.addEventListener('input', update);
  input.addEventListener('focus', update);
  input.addEventListener('click', update);
  input.addEventListener('blur', () => setTimeout(hide, 150));
  box.addEventListener('mousedown', (e) => {
    const o = e.target.closest('.opt');
    if (!o) return;
    e.preventDefault();
    accept(+o.dataset.i);
  });
  check();
  const api = { update, hide, destroy: () => { box.remove(); hl.destroy(); } };
  input._ac = api;
  return api;
}

// ---------------------------------------------------------------------------
// Syntax highlighting + hover help for command/condition inputs.
// A "mirror" div behind the (transparent-text) input shows coloured tokens;
// hovering a word shows what it means.
// ---------------------------------------------------------------------------
const KEYWORD_HELP = {
  var: 'A user variable (Variables page): number, text or on/off.', toggle: 'Flip on ↔ off.',
  '=': 'Set to / equals.', '+': 'Add.', '-': 'Subtract.', '*': 'Multiply.', '/': 'Divide.',
  '++': 'Add 1.', '--': 'Subtract 1.', '+=': 'Add.', '-=': 'Subtract.', '*=': 'Multiply.', '/=': 'Divide.',
  if: 'Run a command only when a condition holds.', then: 'Runs when the condition is true.', else: 'Runs when the condition is false.',
  tcp: 'TCP: a kept-open connection to a device (Devices page); its replies fire TCP triggers.',
  http: 'HTTP request to a web/REST API (plain http). The response fires HTTP triggers.',
  modbus: 'Modbus TCP: talk to a PLC (Devices page).', write: 'Write a value.',
  ntp: 'Network time: set the clock from a time server.', sync: 'Do it now.',
  calendar: 'A calendar period (Schedule page), e.g. holidays or closed days.', date: 'Today’s date.',
  active: 'Today falls in the period.', inactive: 'Today is outside the period.',
  start: 'Start (or restart) something from the beginning.',
  stop: 'Stop / release something.',
  timeline: 'A timeline: scenes played as cues over time.',
  scene: 'A scene: a fixed set of channel levels.',
  fade: 'A fade time follows, in seconds.',
  release: 'Let go of a playback so lower ones (or nothing) show again.',
  all: 'Everything / every item.',
  pause: 'Freeze a timeline where it is.', resume: 'Continue a paused timeline.',
  master: 'The intensity master of a running timeline (its layer opacity).',
  set: 'Override DMX channels directly (stays until "clear overrides").',
  clear: 'Remove something.', overrides: 'Channel overrides made with "set".',
  grandmaster: 'Overall intensity of everything (position channels excluded).',
  blackout: 'All intensity to zero (position channels excluded).',
  mode: 'The management mode (one active at a time, survives a reboot).',
  label: 'A text label on the touch panel.', color: 'A colour: a name like red, or #rrggbb.',
  panel: 'A control on the touch panel (button, toggle, slider, dial, colour wheel, label), by its name.',
  flash: 'Blink: on, off, or a colour to blink in.', value: 'The position of a slider or dial, a toggle (1/0) or a colour wheel (#rrggbb).',
  disable: 'Greyed out: can’t be touched.', enable: 'Usable again.',
  lock: 'Looks normal but can’t be touched (a progress bar).', unlock: 'Can be touched again.',
  fire: 'Run another trigger’s actions.', trigger: 'A trigger from the trigger list.',
  after: 'Delay before it runs, in seconds (Pharos “Wait”).',
  cancel: 'Cancel pending delayed fires.',
  repeat: 'Fire a trigger now and then again and again (Pharos “Repeat”).',
  every: 'Interval between repeats, in seconds.', times: 'How many times in total.',
  log: 'Write a line to the live log and the log file on the USB stick.',
  email: 'Send a notification email via the SMTP server on the Devices page.',
  send: 'Send a message over the network.',
  udp: 'UDP: a plain text network packet. Used by show-control systems, media servers and motor controllers. No connection, no guaranteed reply.',
  osc: 'OSC (Open Sound Control): an address like /cue/1/start plus typed arguments. Used by many media servers and show tools.',
  reply: 'Answer the device whose UDP/OSC message fired this trigger.',
  loglevel: 'How detailed the log is per category.',
  output: 'Switch a protocol output on or off (until reboot).',
  projector: 'A projector controlled with PJLink (TCP 4352).',
  pc: 'A show PC: Wake-on-LAN, or startup / shutdown / reboot as UDP text commands.',
  monitor: 'Device monitoring: PCs and devices are pinged, projectors polled over PJLink.',
  check: 'Run all checks now.', interval: 'Seconds between checks.',
  device: 'A monitored PC, network device or projector.', online: 'Reachable.', offline: 'Not reachable.',
  on: 'On.', off: 'Off.', mute: 'Picture and sound mute (PJLink AVMT).', input: 'Video input to select (PJLink INPT).',
  reload: 'Read the project from the USB stick again.',
  is: 'Equals.', not: 'Does not equal.', running: 'Currently playing.', stopped: 'Not playing.',
  between: 'Within a time window (may cross midnight).', day: 'Day of the week.', time: 'Time of day (controller clock).',
  kissbox: 'A Kiss-Box I/O card frame (Devices page): relay outputs, contact inputs and analog cards over UDP.',
  knx: 'A KNX IP interface (Devices page): read and write KNX group addresses.',
  brightsign: 'A BrightSign media player (Devices page): UDP commands to the presentation and the local DWS API.',
  digidot: 'A DiGidot C4 LED pixel controller (Devices page).', netio: 'NETIO switchable power sockets (Devices page).',
  pharos: 'A Pharos lighting controller (LPC/TPC) via its HTTP API (Devices page).',
  read: 'Ask the device for its current value.', reboot: 'Restart the device.', api: 'Raw API call: any endpoint of the device.',
  playlist: 'A DiGidot playlist.', speed: 'Playback speed in percent.', reset: 'DiGidot: restart the controller. Panel: back to how it is set on the Panel page.',
  rate: 'Timeline speed: 1 = normal, 0.5 = half speed.', position: 'Jump to a point in the timeline (percent of its length).',
  group: 'A Pharos group.', override: 'An override: a value set directly, on top of what is playing (Pharos: intensity or colour).', intensity: 'Brightness 0-100 %.',
  text: 'Pharos: a text slot. Panel: the text shown on the control.', beacon: 'Blink the controller’s LEDs so you can find it.',
  restart: 'Off for a moment, then on again (NETIO short off; the time is set on the NETIO or given in seconds).',
  pulse: 'On for a moment, then off again (NETIO short on; Machine Control: for the seconds given).',
  io: 'An input or output of the Portenta Machine Control (Devices → Machine Control): in0-7, out0-7, io0-11, ai0-2, ao0-3 or the name you gave it.',
};
const PART_CLASS = {
  '{tl}': 'ref', '{sc}': 'ref', '{trig}': 'ref', '{mode}': 'ref', '{mgroup}': 'ref', '{mstate}': 'ref', '{mstep}': 'kw', '{dur}': 'num', '{device}': 'ref', '{pj}': 'ref', '{label}': 'ref', '{pctl}': 'ref', '{flash}': 'kw', '{pval}': 'num', '{logcat}': 'ref', '{proto}': 'kw',
  '{sec}': 'num', '{pct}': 'num', '{dmx}': 'num', '{port}': 'num', '{count}': 'num', '{pjinput}': 'num',
  '{ip}': 'addr', '{chan}': 'addr', '{oscaddr}': 'addr', '{email}': 'addr', '{hhmm}': 'addr', '{days}': 'addr', '{color}': 'addr',
  '{onoff}': 'kw', '{loglvl}': 'kw', '{text...}': 'str', '{pc}': 'ref', '{pcaction}': 'kw', '{devname}': 'ref', '{updown}': 'kw',
  '{var}': 'ref', '{num}': 'num', '{op}': 'kw', '{tcpdev}': 'ref', '{httpmethod}': 'kw', '{url}': 'addr', '{mbdev}': 'ref', '{mbtable}': 'kw',
  '{calname}': 'ref', '{activity}': 'kw', '{date}': 'addr',
  '{kiss}': 'ref', '{knx}': 'ref', '{bsign}': 'ref', '{digi}': 'ref', '{netio}': 'ref', '{pharos}': 'ref', '{digiscene}': 'ref', '{word}': 'ref', '{bszone}': 'ref', '{bsvar}': 'ref', '{bsfile}': 'str', '{bsstate}': 'ref',
  '{kisspoint}': 'addr', '{knxga}': 'addr', '{path}': 'addr', '{kissval}': 'num', '{slot}': 'num', '{dpt}': 'num', '{netioout}': 'num', '{knxval}': 'str',
  '{netioact}': 'kw', '{pharostl}': 'kw', '{pharossc}': 'kw', '{fixgrp}': 'kw', '{pharosproto}': 'kw',
  '{iopoint}': 'addr', '{ioval}': 'num',
};
function partHelp(part, tok, g) {
  const p = P();
  const ref = (list, kind, extra) => { const o = findRef(list, tok); return o ? `${kind} ${o.id} · ${o.name}${extra ? extra(o) : ''}` : `Unknown ${kind.toLowerCase()} '${tok}'`; };
  switch (part) {
    case '{tl}': return ref(p.timelines, 'Timeline', (o) => (o.length ? ` · ${o.length / 1000}s` : '') + (o.loop ? ' · loops' : '') + (o.group ? ` · group ${o.group}` : ''));
    case '{sc}': return ref(p.scenes, 'Scene', (o) => ` · ${o.levels.length} levels`);
    case '{trig}': {
      const hits = findTrigs(tok);
      if (hits.length > 1) return `${hits.length} triggers are named “${tok}” (#${hits.map((t) => t.id).join(', #')}) - rename one or use the number`;
      const t = hits[0];
      return t ? `Trigger #${t.id} · ${t.name} (${t.type})${/^\d+$/.test(tok) ? '\nBy number: updated automatically when triggers move.' : '\nBy name: keeps working when triggers move.'}` : `Unknown trigger '${tok}'`;
    }
    case '{mode}': { const m = findMode(tok); return m ? `${m.group}: ${m.state}` : `Unknown or ambiguous mode '${tok}' - use: mode <group> <state>`; }
    case '{mgroup}': {
      const gr = findGroup(tok);
      return gr ? `Mode group ${gr.name}: ${gr.states.join(' · ')}${S.status?.modes?.[gr.name] ? `\nNow: ${S.status.modes[gr.name]}` : ''}` : `Unknown mode group '${tok}'`;
    }
    case '{mstate}': { const gr = findGroup(CTX[1] ?? ''); return findState(gr, tok) ? `State “${findState(gr, tok)}” of ${gr.name}` : `Not a state of ${gr?.name || 'this group'}`; }
    case '{mstep}': {
      const gr = findGroup(CTX[1] ?? ''), n = gr?.states.length || 0, w = tok.toLowerCase();
      if (w === 'toggle' && gr && n !== 2) return `toggle only works with 2 states - ${gr.name} has ${n}: use next`;
      return { next: 'The next state; after the last one the first again', previous: 'The state before; before the first one the last', toggle: 'Switches between the two states', back: 'Back to the state it was in before the last change' }[w] || '';
    }
    case '{dur}': return 'How long: 90 = seconds, 30s, 10m, 2h';
    case '{device}': {
      const d = p.devices.find((x) => x.name.toLowerCase() === tok.toLowerCase());
      if (d) return `Device ${d.name} → ${d.ip}:${d.port}${d.notes ? ' · ' + d.notes : ''}`;
      const g = findKindGroup('network', tok);
      if (g) return `Device group ${g.name} → ${g.devices.map((n) => { const x = p.devices.find((y) => y.name === n); return x ? `${n} (${x.ip}:${x.port})` : `${n} (missing)`; }).join(', ') || 'no devices'}`;
      return `Unknown device or group '${tok}'`;
    }
    case '{pj}': return tok.toLowerCase() === 'all' ? 'All projectors' : findRef(p.projectors, tok) || !findKindGroup('projector', tok) ? ref(p.projectors, 'Projector', (o) => ` · ${o.ip}`) : groupTip(findKindGroup('projector', tok), 'Projector');
    case '{label}': return `Panel label “${tok}”`;
    case '{pctl}': { const ty = panelControlType(tok); return ty ? `Panel ${{ color: 'colour wheel', xy: 'XY pad' }[ty] || ty} “${tok}”` : `No panel control named '${tok}' (Panel page)`; }
    case '{var}': {
      const v = p.variables.find((x) => x.name.toLowerCase() === tok.toLowerCase());
      if (!v) return `Unknown variable '${tok}' (Variables page)`;
      const cur = S.status?.vars?.[v.name];
      return `Variable ${v.name} (${v.type})${cur != null ? ` = ${cur}` : ''}${v.modbus?.device ? `\nLinked to ${v.modbus.device} ${v.modbus.table} ${v.modbus.address}` : ''}`;
    }
    case '{tcpdev}': { const d = p.tcp.find((x) => x.name.toLowerCase() === tok.toLowerCase()); if (!d && findKindGroup('tcp', tok)) return groupTip(findKindGroup('tcp', tok), 'TCP'); const st = S.status?.io?.tcp?.find((x) => x.name === d?.name); return d ? `TCP ${d.name} → ${d.ip}:${d.port}${st ? ' · ' + st.state : ''}` : `Unknown TCP device '${tok}'`; }
    case '{mbdev}': { const d = p.modbus.find((x) => x.name.toLowerCase() === tok.toLowerCase()); return d ? `Modbus ${d.name} → ${d.ip}:${d.port || 502} unit ${d.unit || 1}` : `Unknown Modbus device '${tok}'`; }
    case '{mbtable}': return tok === 'coil' ? 'Coil: on/off output (value 0 or 1)' : 'Holding register: 16-bit value (0-65535)';
    case '{httpmethod}': return { get: 'Read', post: 'Send/create (body)', put: 'Replace (body)', delete: 'Delete' }[tok.toLowerCase()] || '';
    case '{url}': return `Plain http (no https). The response fires HTTP triggers with {status} and {body}.`;
    case '{op}': return { '=': 'equals', '==': 'equals', '!=': 'not equal', '>': 'greater than', '<': 'less than', '>=': 'at least', '<=': 'at most' }[tok] || '';
    case '{calname}': { const act = S.status?.clock?.calendar?.includes(tok); return `Calendar period “${tok}”${S.status?.clock ? (act ? ' · active today' : ' · not active today') : ''}`; }
    case '{date}': return /^\d{4}-/.test(tok) ? `${tok} (that date only)` : `${tok} (every year)`;
    case '{devname}': { const h = hostState(tok); return `Monitored: ${tok}${h ? ` · currently ${h}` : ''}`; }
    case '{updown}': return tok === 'online' ? 'Answered the last check.' : 'Failed the configured number of checks in a row.';
    case '{pc}': return tok.toLowerCase() === 'all' ? 'All PCs' : findRef(p.pcs, tok) || !findKindGroup('pc', tok) ? ref(p.pcs, 'PC', (o) => ` · ${o.ip}${o.mac ? ' · ' + o.mac : ''}`) : groupTip(findKindGroup('pc', tok), 'PC');
    case '{pcaction}': {
      const pcHelp = {
        wake: 'Wake-on-LAN: broadcasts a magic packet so the PC powers on (needs its MAC address, WoL enabled in the BIOS/network card).',
        startup: 'Sends the text "startup" over UDP to the PC (default port 7).',
        shutdown: 'Sends the text "shutdown" over UDP to the PC (default port 7).',
        reboot: 'Sends the text "reboot" over UDP to the PC (default port 7).',
      };
      return pcHelp[tok.toLowerCase()] || '';
    }
    case '{kiss}': case '{knx}': case '{bsign}': case '{digi}': case '{netio}': case '{pharos}': {
      const ty = DRV_PART[part], d = findRef(drvList(ty), tok);
      if (!d && findKindGroup(ty, tok)) return groupTip(findKindGroup(ty, tok), DRIVERS[ty].label);
      if (!d) return `Unknown ${DRIVERS[ty].label} device '${tok}' (Devices page)`;
      const st = drvStatusOf(d);
      return `${DRIVERS[ty].label} ${d.name} → ${d.ip}${d.port ? ':' + d.port : ''}${st ? ` · ${!st.seen ? 'not checked yet' : st.online ? 'online' : 'offline'}` : ''}`;
    }
    case '{kisspoint}': { const [s, c] = tok.split('.'); return `Slot ${s}, channel ${c}`; }
    case '{kissval}': return /^\d+$/.test(tok) ? `Value ${tok} (analog cards; digital: 0 = off, 1+ = on)` : `Switch ${tok}`;
    case '{knxga}': {
      const a = knxAddr(tok);
      const v = a && drvStatusOf(ctxDrv('knx'))?.points?.find((x) => x.k === a.ga)?.v;
      return a ? `${a.name || a.ga} · ${a.ga} · DPT ${a.dpt || '1'}${v != null && v !== '' ? ` · now ${v}` : ''}` : `Group address ${tok}`;
    }
    case '{dpt}': return `KNX datapoint type ${tok}`;
    case '{netioout}': {
      if (tok.toLowerCase() === 'all') return 'Every output';
      const p = (drvStatusOf(ctxDrv('netio'))?.points || []).find((x) => x.k === 'out' + tok || (x.n || '').toLowerCase() === tok.toLowerCase());
      return p ? `${p.n} · now ${p.v === '1' ? 'on' : 'off'}` : `Output ${tok}`;
    }
    case '{iopoint}': {
      const k = pmcFind(tok), v = (S.status?.board?.points || []).find((x) => x.k === k)?.v;
      if (!k) return `Unknown Machine Control point '${tok}' (in0-7, out0-7, io0-11, ai0-2, ao0-3 or a name)`;
      const g = PMC_GROUPS.find(([p]) => k.startsWith(p) && /^\d+$/.test(k.slice(p.length)));
      return `${g[2]} ${k}${pmcCfg(k).name ? ' · ' + pmcCfg(k).name : ''} · ${pmcIsOut(k) ? 'output' : 'input'}${v != null && v !== '' ? ` · now ${/^a/.test(k) ? v + ' ' + pmcUnit(k) : v === '1' ? 'on' : 'off'}` : ''}`;
    }
    case '{ioval}': return /^\d/.test(tok) ? `${tok} V` : `Switch ${tok}`;
    case '{digiscene}': return `DiGidot scene “${tok}”${/^\d+$/.test(tok) ? ' (by position in the list)' : ''}`;
    case '{bsstate}': {
      const s = (drvStatusOf(ctxDrv('brightsign'))?.states || []).find((x) => x.n.toLowerCase() === tok.toLowerCase());
      return s ? `State “${s.n}” in zone ${s.z}${s.f ? ` · plays ${s.f}` : ' · has no media file'}` : `State “${tok}” (not reported by the player yet)`;
    }
    case '{bszone}': case '{bsvar}': {
      const zone = part === '{bszone}', t = tok.toLowerCase();
      const p = (drvStatusOf(ctxDrv('brightsign'))?.points || []).find((x) => (zone ? /^z\d+$/.test(x.k) && (x.k.slice(1) === t || (x.n || '').replace(/^Zone \d+ ?/, '').toLowerCase() === t)
        : x.k.startsWith('var.') && (x.n || x.k.slice(4)).toLowerCase() === t));
      return `${zone ? 'Zone' : 'User variable'} “${tok}”${p ? ` · now ${p.v || '—'}` : ' (not reported by the player yet)'}`;
    }
    case '{path}': return tok.startsWith('/') ? `Path ${tok}` : `Path ${CTX[0]?.toLowerCase() === 'brightsign' ? '/api/v1/' : '/api/'}${tok}`;
    case '{sec}': return `${tok} seconds`;
    case '{pct}': return `${tok} %`;
    case '{dmx}': return `DMX value ${tok} (${Math.round(+tok / 2.55)}%)`;
    case '{port}': return `Network port ${tok}`;
    case '{count}': return `${tok} times`;
    case '{pjinput}': { const i = PJ_INPUTS.find(([v]) => v === tok); return `PJLink input ${tok}${i ? ' · ' + i[1] : ''}`; }
    case '{ip}': return `IP address ${tok}`;
    case '{chan}': { const m = /^(\d+)\.(\d+)(?:-(\d+))?$/.exec(tok); return m ? `Universe ${m[1]}, channel ${m[2]}${m[3] ? '–' + m[3] : ''}` : 'universe.channel'; }
    case '{oscaddr}': return `OSC address ${tok}`;
    case '{email}': return `Email recipient ${tok}`;
    case '{text...}':
      if (g.pattern.startsWith('send udp')) return 'Text sent as the UDP packet (escapes \\r \\n \\t \\xNN).';
      if (g.pattern.startsWith('send osc')) return 'OSC arguments: 12 → int, 0.5 / -inf → float, else string.';
      if (g.pattern.startsWith('email')) return 'Subject (in quotes) and body.';
      return 'Free text.';
    default: return PLACEHOLDER[part] || '';
  }
}
// Splits a line into coloured ranges: [{start, end, cls, tip}]
function classifyBase(line, grammar) {
  const t = line.trimStart();
  if (t.startsWith('#')) return [{ start: line.length - t.length, end: line.length, cls: 'comment', tip: 'Comment – not executed.' }];
  const toks = tokenize(line);
  if (!toks.length) return [];
  const vals = toks.map((x) => x.v);
  const v = validate(line, grammar);
  CTX = vals;
  let g = v.g, n = 0;
  if (v.ok && g) n = toks.length;
  else {
    for (const cand of grammar) {
      let k = 0;
      while (k < vals.length && k < cand.parts.length && (cand.parts[k] === '{text...}' || matchPart(cand.parts[k], vals[k]))) {
        if (cand.parts[k] === '{text...}') { k = vals.length; break; }
        k++;
      }
      if (k > n) { n = k; g = cand; }
    }
  }
  const textAt = g ? g.parts.indexOf('{text...}') : -1;
  return toks.map((tok, i) => {
    const part = !g ? null : textAt >= 0 && i >= textAt ? '{text...}' : g.parts[i];
    if (!g || i >= n || !part) return { start: tok.start, end: tok.end, cls: 'err', tip: v.error || 'Not understood.' };
    if (!part.startsWith('{')) {
      const help = KEYWORD_HELP[part] || '';
      return { start: tok.start, end: tok.end, cls: i === 0 ? 'cmd' : 'kw', tip: i === 0 ? `${g.doc}.\n${sigText(g)}` + (help ? `\n${help}` : '') : help };
    }
    return { start: tok.start, end: tok.end, cls: PART_CLASS[part] || 'str', tip: partHelp(part, tok.v, g) };
  });
}
function attachHighlight(input, grammar) {
  const wrap = document.createElement('div');
  wrap.className = 'hl';
  input.before(wrap);
  const mirror = document.createElement('div');
  mirror.className = 'mirror';
  mirror.innerHTML = '<div class="mi"></div>';
  wrap.append(mirror, input);
  const inner = mirror.firstChild;
  let tips = [];
  const sync = () => (inner.style.transform = `translateX(${-input.scrollLeft}px)`);
  function paint() {
    const line = input.value;
    tips = [];
    let html = '', pos = 0;
    const span = (cls, text, tip) => {
      tips.push(tip);
      return `<span class="hl-${cls}" data-i="${tips.length - 1}">${esc(text)}</span>`;
    };
    const ranges = classify(line, grammar);
    for (const r of ranges) {
      html += esc(line.slice(pos, r.start));
      const text = line.slice(r.start, r.end);
      // Variables {name} / {=expr} get their own colour and help.
      let last = 0, buf = '';
      for (const m of text.matchAll(/\{[^}]*\}/g)) {
        buf += text.slice(last, m.index) ? span(r.cls, text.slice(last, m.index), r.tip) : '';
        const mg = /^\{mode\.(.+)\}$/.exec(m[0]);
        buf += span('var', m[0], m[0].startsWith('{=') ? 'Calculated when the trigger fires.'
          : mg ? (findGroup(mg[1]) ? `The state of mode group ${findGroup(mg[1]).name} when the trigger fires.` : `Unknown mode group '${mg[1]}'`)
          : `Variable ${m[0]}: filled in when the trigger fires.`);
        last = m.index + m[0].length;
      }
      html += last ? buf + (text.slice(last) ? span(r.cls, text.slice(last), r.tip) : '') : span(r.cls, text, r.tip);
      pos = r.end;
    }
    html += esc(line.slice(pos));
    // Wrong but no word to underline (something missing): a greyed placeholder
    // after the text carries the squiggle and the message.
    if (line.trim() && !ranges.some((r) => r.cls === 'err')) {
      const v = validate(line, grammar);
      if (!v.ok) {
        const m = /missing (.+?)( at the end|$| after)/.exec(v.error);
        html += ' ' + span('err hl-ghost', m ? m[1] : '?', v.error);
      }
    }
    inner.innerHTML = html + ' ';
    sync();
  }
  const tipBox = $('#hltip') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'hltip' }));
  const hideTip = () => (tipBox.style.display = 'none');
  input.addEventListener('mousemove', (e) => {
    const hit = $$('[data-i]', inner).find((s) => { const r = s.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right; });
    const tip = hit && tips[+hit.dataset.i];
    if (!tip) return hideTip();
    tipBox.textContent = tip;
    tipBox.className = 'hltip-' + hit.className.split(' ')[0].replace('hl-', '');
    tipBox.style.display = 'block';
    const r = input.getBoundingClientRect(), z = uiZoom();
    tipBox.style.left = Math.min(e.clientX / z, innerWidth / z - 340) + 'px';
    tipBox.style.top = r.bottom / z + 6 + 'px';
  });
  input.addEventListener('mouseleave', hideTip);
  input.addEventListener('keydown', hideTip);
  for (const ev of ['input', 'scroll', 'keyup', 'click', 'select', 'focus']) input.addEventListener(ev, sync);
  paint();
  return { wrap, paint, destroy: hideTip };
}

// ---------------------------------------------------------------------------
// Command builder: build a command (or condition) from menus instead of typing.
// ---------------------------------------------------------------------------
function category(g) {
  const p = g.pattern;
  if (/^(start|stop timeline|pause|resume|master|scene|release)/.test(p)) return 'Playback';
  if (/^(mode |label|fire|cancel|repeat|stop repeat)/.test(p)) return 'Show control';
  if (/^(send|reply|email)/.test(p)) return 'Network & messages';
  if (/^(projector|output|pc )/.test(p)) return 'Devices & outputs';
  if (/^(kissbox|knx|brightsign|digidot|netio|pharos) /.test(p)) return 'Show devices';
  if (/^io \{iopoint\} (is|\{op\})/.test(p)) return 'Conditions';
  if (/^io /.test(p)) return 'Machine Control';
  if (/^(var \{var\} \{op\}|calendar|date)/.test(p)) return 'Conditions';
  if (/^(var|if)/.test(p)) return 'Variables & logic';
  if (/^(send tcp|http|modbus|ntp)/.test(p)) return 'Network & messages';
  if (/^(mode is|mode not|timeline|time|day|device)/.test(p)) return 'Conditions';
  if (/^monitor/.test(p)) return 'Devices & outputs';
  return 'System';
}
const DEFAULTS = { '{dur}': '10m', '{sec}': '2', '{pct}': '100', '{dmx}': '255', '{port}': '7000', '{count}': '3', '{ip}': '192.168.1.20', '{oscaddr}': '/cue/1/start', '{hhmm}': '08:00' };
function builderField(part, val, i) {
  const p = P();
  const sel = (list) => `<select data-bi="${i}">${list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(val) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  // Projector/PC by name (by number when the name is ambiguous); an existing number or name selects the same one.
  const groupOpts = (kind) => kindGroups(kind).map((g) => [quote(g.name), `group ${g.name} (${g.devices.length} devices)`]);
  const refSel = (list, all, kind) => {
    const cur = findRef(list, String(val ?? '').replace(/^"|"$/g, ''));
    const v = (o) => (o.name && !/^\d+$/.test(o.name) && list.filter((x) => (x.name || '').toLowerCase() === o.name.toLowerCase()).length === 1 ? quote(o.name) : o.id);
    if (cur) val = v(cur);
    return sel([...(all ? [['all', all]] : []), ...list.map((x) => [v(x), `${x.name} (#${x.id})`]), ...(kind ? groupOpts(kind) : [])]);
  };
  const num = (min, max, step = 1) => `<input type="number" data-bi="${i}" min="${min}" max="${max}" step="${step}" value="${esc(val)}" style="width:90px">`;
  switch (part) {
    case '{tl}': return refSel(p.timelines);
    case '{sc}': return sel(p.scenes.map((s) => [s.id, `${s.id} · ${s.name}`]));
    case '{trig}': return sel(p.triggers.filter((t) => t.type !== 'comment').map((t) => [findTrigs(t.name).length === 1 ? quote(t.name) : t.id, `${t.id} · ${t.name}`]));
    case '{mode}': return sel(p.modes.flatMap((g) => g.states.map((s) => [quote(s), `${g.name}: ${s}`])));
    case '{mgroup}': return sel(p.modes.map((g) => [quote(g.name), g.name]));
    case '{mstate}': {
      const gr = findGroup(String(builderGroup ?? '').replace(/^"|"$/g, '')) || p.modes[0];
      return sel((gr?.states || []).map((s) => [quote(s), s]));
    }
    case '{mstep}': return sel([['next', 'next'], ['previous', 'previous'], ['toggle', 'toggle (2 states)'], ['back', 'back (the state before)']]);
    case '{device}': return sel([...p.devices.map((d) => [quote(d.name), `${d.name} (${d.ip}:${d.port})`]), ...groupOpts('network')]);
    case '{pj}': return refSel(p.projectors, 'all projectors', 'projector');
    case '{proto}': return sel(PROTOCOLS);
    case '{onoff}': return sel([['on', 'on'], ['off', 'off']]);
    case '{logcat}': return sel([['all', 'all'], ...LOG_CATS.map((c) => [c.toLowerCase(), c])]);
    case '{loglvl}': return sel(LOG_LVLS.map((c) => [c.toLowerCase(), c]));
    case '{pjinput}': return sel(PJ_INPUTS.map(([v, n]) => [v, `${v} · ${n}`]));
    case '{pc}': return refSel(p.pcs, 'all PCs', 'pc');
    case '{pcaction}': return sel(PC_ACTIONS.map(([v, d]) => [v, `${v} · ${d}`]));
    case '{devname}': return sel(monitoredNames().map((n) => [quote(n), n]));
    case '{var}': return sel(p.variables.map((v) => [quote(v.name), `${v.name} (${v.type})`]));
    case '{op}': return sel([['=', '= equals'], ['!=', '!= not equal'], ['>', '> greater'], ['<', '< less'], ['>=', '>= at least'], ['<=', '<= at most']]);
    case '{tcpdev}': return sel([...p.tcp.map((d) => [quote(d.name), `${d.name} (${d.ip}:${d.port})`]), ...groupOpts('tcp')]);
    case '{httpmethod}': return sel([['get', 'GET'], ['post', 'POST'], ['put', 'PUT'], ['delete', 'DELETE']]);
    case '{mbdev}': return sel(p.modbus.map((d) => [quote(d.name), `${d.name} (${d.ip})`]));
    case '{mbtable}': return sel([['coil', 'coil (0/1)'], ['holding', 'holding register']]);
    case '{calname}': return sel([...new Set(p.calendar.map((c) => c.name))].map((n) => [quote(n), n]));
    case '{activity}': return sel([['active', 'active'], ['inactive', 'inactive']]);
    case '{num}': return num(-1000000, 1000000);
    case '{updown}': return sel([['online', 'online'], ['offline', 'offline']]);
    case '{kiss}': case '{knx}': case '{bsign}': case '{digi}': case '{netio}': case '{pharos}':
      return sel([...drvList(DRV_PART[part]).map((d) => [quote(d.name), `${d.name} (${d.ip})`]), ...groupOpts(DRV_PART[part])]);
    case '{kissval}': return sel([['on', 'on'], ['off', 'off'], ['0', '0'], ['128', '128'], ['255', '255']]);
    case '{slot}': return num(1, 8);
    case '{netioact}': return sel([['on', 'on'], ['off', 'off'], ['toggle', 'toggle'], ['restart', 'restart (short off)'], ['pulse', 'pulse (short on)']]);
    case '{pharostl}': return sel(['start', 'release', 'toggle', 'pause', 'resume'].map((v) => [v, v]));
    case '{pharossc}': return sel(['start', 'release', 'toggle'].map((v) => [v, v]));
    case '{fixgrp}': return sel([['fixture', 'fixture'], ['group', 'group']]);
    case '{pharosproto}': return sel(PHAROS_PROTOCOLS.map((v) => [v, v]));
    case '{iopoint}': return sel(pmcKeys().map((k) => [k, `${k} · ${pmcIsOut(k) ? 'out' : 'in'}${pmcCfg(k).name ? ' · ' + pmcCfg(k).name : ''}`]));
    case '{ioval}': return `<input data-bi="${i}" value="${esc(val)}" list="bIoVals" placeholder="on|off|toggle|volts" style="width:110px"><datalist id="bIoVals">${['on', 'off', 'toggle', '5', '10'].map((v) => `<option value="${v}">`).join('')}</datalist>`;
    case '{dpt}': return sel([['1', '1 on/off'], ['3', '3 dim'], ['5.001', '5.001 percent'], ['5.010', '5.010 0-255'], ['7', '7 0-65535'], ['9', '9 float'], ['14', '14 float'], ['17', '17 scene'], ['232', '232 RGB']]);
    case '{label}': return `<input data-bi="${i}" value="${esc(val)}" list="bLabels" placeholder="label name" style="width:140px"><datalist id="bLabels">${panelLabels().map((l) => `<option value="${esc(l)}">`).join('')}</datalist>`;
    case '{pctl}': return sel([['', '— control —'], ...panelControls().map((n) => [quote(n), `${n} (${panelControlType(n)})`])]);
    case '{flash}': return `<input data-bi="${i}" value="${esc(val)}" list="bFlash" placeholder="on|off|colour" style="width:110px"><datalist id="bFlash">${['on', 'off', 'red', '#ff8800'].map((v) => `<option value="${v}">`).join('')}</datalist>`;
    case '{sec}': return num(0, 3600, 0.1);
    case '{pct}': return num(0, 100);
    case '{dmx}': return num(0, 255);
    case '{port}': return num(1, 65535);
    case '{count}': return num(1, 1000);
    default: return `<input data-bi="${i}" value="${esc(val)}" placeholder="${esc(PLACEHOLDER[part] || '')}" style="${part === '{text...}' ? 'flex:1;min-width:200px' : 'width:150px'}">`;
  }
}
let builderGroup = null;   // mode group picked in the builder, for the {mstate} list
function openBuilder(path, grammar) {
  const existing = $('.builder');
  const same = existing?.dataset.path === path;
  existing?.remove();
  if (same) return;
  const input = $(`[data-p="${CSS.escape(path)}"]`);
  if (!input) return;
  const box = document.createElement('div');
  box.className = 'builder';
  box.dataset.path = path;
  input.closest('.row').after(box);
  // Start from the current line if it parses, else from the first command.
  const v = validate(input.value, grammar);
  let gi = v.ok && v.g ? grammar.indexOf(v.g) : 0;
  const values = {};   // part-index -> value, carried over when switching commands where possible
  if (v.ok && v.g) {
    const toks = tokenize(input.value.trim()).map((t) => t.raw);
    const textAt = v.g.parts.indexOf('{text...}');
    v.g.parts.forEach((part, i) => { if (part.startsWith('{')) values[part] = part === '{text...}' ? toks.slice(textAt).join(' ') : toks[i]; });
  }
  const groups = {};
  grammar.forEach((g, i) => { if (!g.hidden) (groups[category(g)] ||= []).push([g, i]); });
  if (grammar[gi]?.hidden) {
    // Old "mode Show" / "mode is Show": open it in the group + state form.
    const m = values['{mode}'] && findMode(String(values['{mode}']).replace(/^"|"$/g, ''));
    if (m) { values['{mgroup}'] = quote(m.group); values['{mstate}'] = quote(m.state); }
    const wantNot = grammar[gi].parts[1] === 'not';
    gi = grammar.findIndex((g) => !g.hidden && g.parts[0] === grammar[gi].parts[0] && (g.parts.length < 4 || (g.parts[2] === 'not') === wantNot));
  }
  function line() {
    const g = grammar[gi];
    return g.parts.map((part) => {
      if (!part.startsWith('{')) return part;
      const val = String(values[part] ?? '').trim();
      return val || PLACEHOLDER[part];
    }).join(' ');
  }
  function draw() {
    const g = grammar[gi];
    // Fill defaults for selects/numbers so the preview is valid straight away.
    // The group comes first, so the state list can depend on it.
    g.parts.forEach((part) => {
      if (part === '{mgroup}') builderGroup = values['{mgroup}'] ?? (P().modes[0] ? quote(P().modes[0].name) : '');
      if (!part.startsWith('{') || values[part] != null) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = builderField(part, '', 0);
      const s = tmp.querySelector('select');
      values[part] = s ? s.options[0]?.value ?? '' : DEFAULTS[part] ?? '';
    });
    const l = line(), ok = validate(l, grammar);
    box.innerHTML = `<div class="row" style="align-items:flex-start">
      <select id="bCmd" style="max-width:340px">${Object.entries(groups).map(([cat, list]) =>
        `<optgroup label="${cat}">${list.map(([x, i]) => `<option value="${i}"${i === gi ? ' selected' : ''}>${esc(sigText(x))}</option>`).join('')}</optgroup>`).join('')}</select>
      <span class="muted" style="padding-top:5px">${esc(g.doc)}</span></div>
      <div class="row bfields">${g.parts.map((part, i) => (part.startsWith('{') ? builderField(part, values[part] ?? '', i) : `<span class="hl-${i ? 'kw' : 'cmd'} mono">${esc(part)}</span>`)).join('')}</div>
      <div class="row" style="flex-wrap:nowrap"><code class="bprev" title="${esc(ok.ok ? 'Valid' : ok.error)}">${esc(l)}</code>
        <span class="${ok.ok ? 'ok' : 'bad'}">${ok.ok ? '✓' : '✕ ' + esc(ok.error)}</span>
        <span class="spacer" style="flex:1"></span>
        <button class="btn small primary" id="bApply">Apply</button><button class="btn small" id="bCancel">Cancel</button></div>`;
    $('#bCmd', box).addEventListener('change', (e) => { gi = +e.target.value; draw(); });
    $$('[data-bi]', box).forEach((el) => el.addEventListener('input', () => {
      const part = grammar[gi].parts[+el.dataset.bi];
      values[part] = part === '{label}' ? quote(el.value) : el.value;
      if (part === '{mgroup}' && el.value !== builderGroup) {
        // A different group has different states: rebuild the state list.
        builderGroup = el.value;
        values['{mstate}'] = null;
        draw();
        return;
      }
      const l2 = line(), ok2 = validate(l2, grammar);
      $('.bprev', box).textContent = l2;
      const st = $('.bprev', box).nextElementSibling;
      st.className = ok2.ok ? 'ok' : 'bad';
      st.textContent = ok2.ok ? '✓' : '✕ ' + ok2.error;
    }));
    $$('select[data-bi]', box).forEach((el) => el.dispatchEvent(new Event('input')));
    $('#bApply', box).addEventListener('click', () => {
      input.value = line();
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input._ac?.update();
      box.remove();
    });
    $('#bCancel', box).addEventListener('click', () => box.remove());
  }
  draw();
}
