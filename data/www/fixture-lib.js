// Fixture types: the text format for fixture definitions, the generic types, fixture icons and
// importers for Open Fixture Library (.json) and QLC+ (.qxf) files. Used by the web UI and by
// tools/build-fixture-lib.js, which turns the Open Fixture Library into fixture-library.json.
// The firmware never sees fixture types: a fixture in project.json is just its channel list.
//
// Text format (one or more types, # starts a comment):
//   fixture Chauvet DJ / SlimPAR 56      maker / model
//   icon par                             optional, see ICONS
//   curve nondim                         optional default dimmer curve
//   note Check the fan channel           optional
//   mode 3 ch: r, g, b                   mode name : channels in DMX order
//   mode 7 ch: dim, r, g, b, strobe, macro=0, speed
//   mode 8 cells: 8 x (r, g, b)          pixels: one fixture per cell (+ a group)
//   mode Master + 8 cells: dim, 8 x (r, g, b)
// A channel is name, name:16 (16-bit coarse + fine) and optionally =value, its home value
// (what a scene starts with, e.g. shutter=255 so a moving head isn't dark).
(function (root) {
  'use strict';

  const GENERIC = `
fixture Generic / Dimmer
icon dimmer
mode 1 ch: dim
mode 16-bit: dim:16

fixture Generic / Dimmer pack
icon dimmer
mode 4 ch: 4 x (dim)
mode 6 ch: 6 x (dim)
mode 12 ch: 12 x (dim)
mode 24 ch: 24 x (dim)

fixture Generic / Relay / switch
icon relay
curve nondim
note Channel above 50 % = on (non-dim curve).
mode 1 ch: dim
mode 4 ch: 4 x (dim)
mode 8 ch: 8 x (dim)

fixture Generic / RGB
icon par
mode 3 ch: r, g, b
mode 4 ch (dim first): dim, r, g, b
mode 4 ch (dim last): r, g, b, dim
mode 5 ch: dim, r, g, b, strobe

fixture Generic / RGBW
icon par
mode 4 ch: r, g, b, w
mode 5 ch: dim, r, g, b, w
mode 6 ch: dim, r, g, b, w, strobe

fixture Generic / RGBA
icon par
mode 4 ch: r, g, b, a
mode 5 ch: dim, r, g, b, a

fixture Generic / RGBAW
icon par
mode 5 ch: r, g, b, a, w
mode 6 ch: dim, r, g, b, a, w

fixture Generic / RGBWA+UV
icon par
mode 6 ch: r, g, b, w, a, uv
mode 7 ch: dim, r, g, b, w, a, uv
mode 8 ch: dim, r, g, b, w, a, uv, strobe

fixture Generic / RGB+W+UV
icon par
mode 5 ch: r, g, b, w, uv
mode 6 ch: dim, r, g, b, w, uv

fixture Generic / RGB+Lime+Amber (RGBLA)
icon par
mode 5 ch: r, g, b, lime, a
mode 6 ch: dim, r, g, b, lime, a

fixture Generic / Single colour LED
icon dimmer
mode 1 ch: dim
mode 16-bit: dim:16

fixture Generic / Tunable white (warm + cool)
icon par
mode 2 ch: warm, cool
mode 3 ch: dim, warm, cool

fixture Generic / Tunable white (dim + colour temperature)
icon par
note cct: 0 = warmest, 255 = coolest on most fixtures.
mode 2 ch: dim, cct
mode 4 ch (16-bit): dim:16, cct:16

fixture Generic / RGB pixel bar / tape
icon pixel
note Every cell becomes a fixture, so effects run along the bar.
mode 4 cells: 4 x (r, g, b)
mode 8 cells: 8 x (r, g, b)
mode 12 cells: 12 x (r, g, b)
mode 16 cells: 16 x (r, g, b)
mode 24 cells: 24 x (r, g, b)
mode 32 cells: 32 x (r, g, b)
mode 50 cells: 50 x (r, g, b)
mode Master + 8 cells: dim, 8 x (r, g, b)

fixture Generic / RGBW pixel bar / tape
icon pixel
note Every cell becomes a fixture, so effects run along the bar.
mode 4 cells: 4 x (r, g, b, w)
mode 8 cells: 8 x (r, g, b, w)
mode 12 cells: 12 x (r, g, b, w)
mode 16 cells: 16 x (r, g, b, w)
mode 24 cells: 24 x (r, g, b, w)
mode Master + 8 cells: dim, 8 x (r, g, b, w)

fixture Generic / LED batten (single colour cells)
icon bar
mode 4 cells: 4 x (dim)
mode 8 cells: 8 x (dim)
mode 12 cells: 12 x (dim)

fixture Generic / Moving head spot
icon spot
note A typical chart - check the order in the fixture's manual.
mode 16 ch: pan:16, tilt:16, speed_pt, dim, shutter=255, color_wheel, gobo, gobo_rot, prism, focus, zoom, ctrl, macro, fx
mode 8 ch: pan, tilt, speed_pt, dim, shutter=255, color_wheel, gobo, focus

fixture Generic / Moving head wash
icon wash
note A typical chart - check the order in the fixture's manual.
mode 15 ch: pan:16, tilt:16, speed_pt, dim, shutter=255, r, g, b, w, cto, zoom, ctrl, macro
mode 10 ch: pan, tilt, speed_pt, dim, shutter=255, r, g, b, w, zoom

fixture Generic / Moving head beam
icon spot
note A typical chart - check the order in the fixture's manual.
mode 14 ch: pan:16, tilt:16, speed_pt, dim, shutter=255, color_wheel, gobo, prism, prism_rot, focus, frost, ctrl

fixture Generic / LED profile (ellipsoidal)
icon profile
mode 1 ch: dim
mode 2 ch: dim, cto
mode 5 ch: dim, r, g, b, w

fixture Generic / LED fresnel
icon fresnel
mode 1 ch: dim
mode 3 ch: dim, cct, zoom
mode 6 ch: dim, r, g, b, w, zoom

fixture Generic / Strobe
icon strobe
mode 1 ch: dim
mode 2 ch: dim, strobe

fixture Generic / Blinder
icon blinder
mode 1 ch: dim
mode 2 cells: 2 x (dim)
mode 4 cells: 4 x (dim)
mode 8 cells: 8 x (dim)

fixture Generic / UV / black light
icon par
mode 1 ch: uv
mode 2 ch: dim, uv

fixture Generic / Fog machine
icon fog
mode 1 ch: fog
mode 2 ch: fog, fan

fixture Generic / Hazer
icon fog
mode 1 ch: haze
mode 2 ch: haze, fan

fixture Generic / Fan
icon fan
mode 1 ch: fan

fixture Generic / Motor / winch
icon motor
mode 3 ch: pos:16, speed, enable

fixture Generic / Servo / animatronic
icon motor
mode 1 ch: position
mode 16-bit: position:16

fixture Generic / Laser
icon laser
mode 1 ch: dim

fixture Generic / Projector shutter
icon screen
mode 1 ch: shutter
`;

  // Icons: 24 x 24 line drawings in currentColor.
  const ICONS = {
    generic: ['Generic', '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><circle cx="12" cy="15" r="1"/>'],
    dimmer: ['Dimmer / lamp', '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>'],
    par: ['PAR / LED', '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/>'],
    fresnel: ['Fresnel', '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="2.5"/>'],
    profile: ['Profile', '<path d="M2.5 9.5h8l3-2.5h8v10h-8l-3-2.5h-8z"/><path d="M6 14.5V19"/>'],
    spot: ['Moving head spot / beam', '<path d="M6 21h12M8 18h8M7 18V8M17 18V8"/><path d="M9.5 15h5l1-9h-7z"/>'],
    wash: ['Moving head wash', '<path d="M6 21h12M8 18h8M5 18V9M19 18V9"/><circle cx="12" cy="10.5" r="5.5"/><circle cx="12" cy="10.5" r="2"/>'],
    bar: ['LED bar / batten', '<rect x="2" y="9" width="20" height="6" rx="1.5"/><path d="M6 12h.01M10 12h.01M14 12h.01M18 12h.01"/>'],
    pixel: ['Pixel bar / tape', '<rect x="2" y="9" width="4" height="6" rx="1"/><rect x="7.33" y="9" width="4" height="6" rx="1"/><rect x="12.67" y="9" width="4" height="6" rx="1"/><rect x="18" y="9" width="4" height="6" rx="1"/>'],
    matrix: ['Matrix', '<rect x="4" y="4" width="4" height="4" rx=".8"/><rect x="10" y="4" width="4" height="4" rx=".8"/><rect x="16" y="4" width="4" height="4" rx=".8"/><rect x="4" y="10" width="4" height="4" rx=".8"/><rect x="10" y="10" width="4" height="4" rx=".8"/><rect x="16" y="10" width="4" height="4" rx=".8"/><rect x="4" y="16" width="4" height="4" rx=".8"/><rect x="10" y="16" width="4" height="4" rx=".8"/><rect x="16" y="16" width="4" height="4" rx=".8"/>'],
    strobe: ['Strobe', '<path d="M13 2 5 14h6l-1 8 8-12h-6z"/>'],
    blinder: ['Blinder', '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="2.5"/><circle cx="15.5" cy="8.5" r="2.5"/><circle cx="8.5" cy="15.5" r="2.5"/><circle cx="15.5" cy="15.5" r="2.5"/>'],
    fog: ['Fog / haze', '<path d="M7 17h10a4 4 0 0 0 .4-8A6 6 0 0 0 6 10.5 3.3 3.3 0 0 0 7 17z"/><path d="M5 21h6M14 21h5"/>'],
    fan: ['Fan', '<circle cx="12" cy="12" r="2"/><path d="M12 10c-1-4 0-7 3-7s3 4-1 7.5M14 12c4-1 7 0 7 3s-4 3-7.5-1M12 14c1 4 0 7-3 7s-3-4 1-7.5M10 12c-4 1-7 0-7-3s4-3 7.5 1"/>'],
    laser: ['Laser', '<rect x="2" y="9" width="7" height="6" rx="1"/><path d="M9 12l12-7M9 12h12M9 12l12 7"/>'],
    effect: ['Effect', '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z"/>'],
    relay: ['Relay / switch', '<path d="M12 3v8"/><path d="M7.5 6.3a7 7 0 1 0 9 0"/>'],
    motor: ['Motor / animatronic', '<circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'],
    screen: ['Projector / screen', '<rect x="2.5" y="7" width="19" height="10" rx="2"/><circle cx="15.5" cy="12" r="2.5"/><path d="M5.5 10h4"/>'],
  };
  const iconSvg = (key, cls = 'fx-ico') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(ICONS[key] || ICONS.generic)[1]}</svg>`;

  // ---- Text format -------------------------------------------------------------
  const CH_RE = /^([a-z][a-z0-9_]*)(:16)?(?:=(\d+))?$/;
  function parseChannelList(s, errs, ln) {
    const out = [];
    for (const raw of s.split(',').map((x) => x.trim()).filter(Boolean)) {
      const m = CH_RE.exec(raw.toLowerCase());
      if (!m) { errs.push({ line: ln, msg: `'${raw}' is not a channel (letters, digits, _; optional :16 and =value)` }); continue; }
      const c = { name: m[1], wide: !!m[2] };
      if (m[3] != null) c.home = Math.min(+m[3], c.wide ? 65535 : 255);
      out.push(c);
    }
    return out;
  }
  function checkUnique(list, errs, ln) {
    const seen = new Set();
    for (const c of list) { if (seen.has(c.name)) errs.push({ line: ln, msg: `channel '${c.name}' appears twice (number them: ${c.name}, ${c.name}2)` }); seen.add(c.name); }
  }
  // text -> { types: [...], errors: [{line, msg}] }. Each type keeps its own text (t.text).
  function parse(text, source = 'custom') {
    const types = [], errors = [];
    let t = null, start = 0;
    const lines = String(text || '').split(/\r?\n/);
    const close = (end) => {
      if (!t) return;
      if (!t.modes.length) errors.push({ line: t.line, msg: `'${t.model}' has no mode` });
      t.text = lines.slice(start, end).join('\n').trim();
      types.push(t);
    };
    lines.forEach((line, i) => {
      const ln = i + 1, s = line.replace(/#.*$/, '').trim();
      if (!s) return;
      let m;
      if ((m = /^fixture\s+(.+)$/i.exec(s))) {
        close(i);
        start = i;
        const parts = m[1].split(/\s+\/\s+/);
        const maker = parts.length > 1 ? parts[0].trim() : 'Custom', model = (parts.length > 1 ? parts.slice(1).join(' / ') : parts[0]).trim();
        t = { key: `${maker} / ${model}`, maker, model, icon: '', curve: '', note: '', modes: [], source, line: ln };
      } else if (!t) errors.push({ line: ln, msg: 'start with "fixture <maker> / <model>"' });
      else if ((m = /^icon\s+(\S+)$/i.exec(s))) {
        t.icon = m[1].toLowerCase();
        if (!ICONS[t.icon]) errors.push({ line: ln, msg: `unknown icon '${m[1]}' (${Object.keys(ICONS).join(', ')})` });
      } else if ((m = /^curve\s+(\S+)$/i.exec(s))) t.curve = m[1].toLowerCase();
      else if ((m = /^note\s+(.*)$/i.exec(s))) t.note = m[1].trim();
      else if ((m = /^mode\s+([^:]+):(.*)$/i.exec(s))) {
        const md = { name: m[1].trim(), head: [], cells: 0, cell: [] };
        const cm = /(\d+)\s*[x×*]\s*\(([^)]*)\)\s*(.*)$/i.exec(m[2]);
        if (cm) {
          md.head = parseChannelList(m[2].slice(0, cm.index), errors, ln);
          md.cells = Math.max(1, Math.min(512, +cm[1]));
          md.cell = parseChannelList(cm[2], errors, ln);
          if (cm[3].replace(/^,/, '').trim()) errors.push({ line: ln, msg: 'nothing can follow the cells "N x (…)"' });
          if (!md.cell.length) errors.push({ line: ln, msg: 'the cells have no channels' });
          checkUnique(md.cell, errors, ln);
        } else md.head = parseChannelList(m[2], errors, ln);
        checkUnique(md.head, errors, ln);
        if (!md.head.length && !md.cells) errors.push({ line: ln, msg: `mode '${md.name}' has no channels` });
        if (modeFootprint(md) > 512) errors.push({ line: ln, msg: `mode '${md.name}' needs more than 512 channels` });
        if (t.modes.some((x) => x.name === md.name)) errors.push({ line: ln, msg: `mode '${md.name}' twice` });
        t.modes.push(md);
      } else errors.push({ line: ln, msg: `don't understand "${s.slice(0, 40)}" (fixture, icon, curve, note or mode)` });
    });
    close(lines.length);
    return { types, errors };
  }
  const chText = (c) => c.name + (c.wide ? ':16' : '') + (c.home != null ? '=' + c.home : '');
  const modeText = (m) => [...m.head.map(chText), ...(m.cells ? [`${m.cells} x (${m.cell.map(chText).join(', ')})`] : [])].join(', ');
  function toText(t) {
    return [`fixture ${t.maker} / ${t.model}`, t.icon && `icon ${t.icon}`, t.curve && `curve ${t.curve}`, t.note && `note ${t.note}`,
      ...t.modes.map((m) => `mode ${m.name}: ${modeText(m)}`)].filter(Boolean).join('\n');
  }
  const width = (list) => list.reduce((n, c) => n + (c.wide ? 2 : 1), 0);
  const modeFootprint = (m, cells = m.cells) => width(m.head) + cells * width(m.cell);
  // The channel list a fixture gets ("pan:16" etc.), as in project.json.
  const channelNames = (list) => list.map((c) => c.name + (c.wide ? ':16' : ''));
  // Home value of each channel name of a mode (for the cell fixtures when cell = true).
  function homeValues(m, cell) {
    const o = {};
    for (const c of cell ? m.cell : m.head) if (c.home != null) o[c.name] = c.home;
    return o;
  }

  // ---- Icons for fixtures without a type: guessed from the channels ----------------
  function guessIcon(channels) {
    const names = (channels || []).map((c) => String(c).replace(/:16$/, ''));
    const has = (re) => names.some((n) => re.test(n));
    if (has(/^(pan|tilt)/)) return has(/^gobo/) || !has(/^(r|red)$/) ? 'spot' : 'wash';
    if (has(/^(fog|haze)/)) return 'fog';
    if (has(/^fan/)) return 'fan';
    if (has(/^(pos|position|enable|speed)/) || has(/^(arm|eye|mouth|rotation)/)) return 'motor';
    if (has(/^(r|red)$/)) return 'par';
    if (has(/^(warm|cool|cct|uv|a|w)$/)) return 'par';
    if (has(/^(dim|intensity|i|master)$/)) return 'dimmer';
    return 'generic';
  }
  const ICON_BY_CATEGORY = [
    ['Moving Head', null], ['Scanner', 'spot'], ['Barrel Scanner', 'spot'], ['Pixel Bar', 'pixel'], ['Matrix', 'matrix'],
    ['Strobe', 'strobe'], ['Blinder', 'blinder'], ['Smoke', 'fog'], ['Hazer', 'fog'], ['Fan', 'fan'], ['Laser', 'laser'],
    ['Flower', 'effect'], ['Effect', 'effect'], ['Video', 'screen'], ['Dimmer', 'dimmer'], ['Color Changer', 'par'],
  ];
  function iconFor(categories, channels) {
    for (const [cat, icon] of ICON_BY_CATEGORY)
      if ((categories || []).some((c) => c.toLowerCase().includes(cat.toLowerCase()))) return icon || (channels.some((c) => /^gobo|^prism/.test(c)) ? 'spot' : 'wash');
    return guessIcon(channels);
  }

  // ---- Import: Open Fixture Library (open-fixture-library.org, also what QLC+ uses) --
  const COLOR = { red: 'r', green: 'g', blue: 'b', white: 'w', amber: 'a', uv: 'uv', lime: 'lime', cyan: 'cyan', magenta: 'magenta', yellow: 'yellow', indigo: 'indigo', 'warm white': 'warm', 'cold white': 'cool' };
  const slug = (s) => String(s || '').toLowerCase().replace(/\$pixelkey/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+/, '').slice(0, 20).replace(/_+$/, '') || 'ch';
  // Our channel name for an OFL channel. Names follow the firmware's rules: dim / r g b w are
  // intensity and colour, names starting with pan, tilt, speed, shutter, strobe, gobo, fx, ctrl,
  // macro … are left alone by the grand master (isExemptChannel in ShowParse.cpp).
  function oflName(def, key) {
    const caps = def.capability ? [def.capability] : def.capabilities || [];
    const main = caps.find((c) => c.type !== 'NoFunction') || caps[0] || {};
    const wheel = (main.wheel || key || '').toString();
    const wheelName = /colou?r/i.test(wheel) ? 'color_wheel' : /prism/i.test(wheel) ? 'prism' : 'gobo';
    switch (main.type) {
      case 'Intensity': return 'dim';
      case 'ColorIntensity': return COLOR[String(main.color).toLowerCase()] || slug(main.color);
      case 'Pan': return 'pan';
      case 'PanContinuous': return 'pan_rot';
      case 'Tilt': return 'tilt';
      case 'TiltContinuous': return 'tilt_rot';
      case 'PanTiltSpeed': return 'speed_pt';
      case 'ShutterStrobe': return caps.some((c) => /^(Open|Closed)$/.test(c.shutterEffect)) ? 'shutter' : 'strobe';
      case 'StrobeSpeed': case 'StrobeDuration': return 'strobe_speed';
      case 'WheelSlot': case 'WheelShake': return wheelName;
      case 'WheelSlotRotation': case 'WheelRotation': return wheelName + '_rot';
      case 'ColorPreset': return 'macro';
      case 'ColorTemperature': return 'cto';
      case 'Effect': case 'EffectParameter': return 'fx';
      case 'EffectSpeed': return 'speed_fx';
      case 'EffectDuration': case 'Time': return 'fx_time';
      case 'SoundSensitivity': return 'sound';
      case 'BeamAngle': case 'Zoom': return 'zoom';
      case 'BeamPosition': return 'fx_beam';
      case 'Prism': return 'prism';
      case 'PrismRotation': return 'prism_rot';
      case 'Focus': return 'focus';
      case 'Iris': case 'IrisEffect': return 'iris';
      case 'Frost': case 'FrostEffect': return 'frost';
      case 'BladeInsertion': case 'BladeRotation': case 'BladeSystemRotation': return 'blade';
      case 'Fog': case 'FogOutput': return 'fog';
      case 'FogType': return 'fog_type';
      case 'Rotation': return 'fx_rot';
      case 'Speed': return /fan/i.test(key) ? 'fan' : 'speed';
      case 'Maintenance': return 'ctrl';
      default: return /fan/i.test(key) ? 'fan' : 'ctrl_' + slug(key);
    }
  }
  // Home value: the channel's default, else the start of an "open shutter" range.
  function oflHome(def, wide) {
    let v = def.defaultValue;
    if (typeof v === 'string' && /%$/.test(v)) v = Math.round(parseFloat(v) * 2.55);
    if (typeof v === 'number' && def.dmxValueResolution === '16bit' && !wide) v >>= 8;
    else if (typeof v === 'number' && wide && def.dmxValueResolution !== '16bit') v *= 257;
    if (typeof v !== 'number') {
      const open = (def.capabilities || []).find((c) => c.type === 'ShutterStrobe' && c.shutterEffect === 'Open' && c.dmxRange);
      if (open) v = wide ? open.dmxRange[0] * 257 : open.dmxRange[0];
    }
    return typeof v === 'number' && v > 0 ? Math.min(v, wide ? 65535 : 255) : undefined;
  }
  // Names a run of channels: "fine" channels right after their coarse one make it 16-bit,
  // duplicates get a number (dim, dim2).
  function nameRun(entries) {
    const out = [], used = new Map();
    for (const e of entries) {
      const prev = out[out.length - 1];
      if (e.fine === 1 && prev && prev.src === e.src && !prev.wide) { prev.wide = true; continue; }
      let base = e.null ? 'none' : e.fine ? `${oflName(e.def, e.key)}_fine${e.fine > 1 ? e.fine : ''}` : oflName(e.def, e.key);
      const n = (used.get(base) || 0) + 1;
      used.set(base, n);
      out.push({ name: n > 1 ? base + n : base, wide: false, home: e.fine || e.null ? undefined : oflHome(e.def, false), src: e.src });
    }
    // Home values were taken for 8 bits; a 16-bit channel takes its own default.
    for (const c of out) if (c.wide) { const d = entries.find((e) => e.src === c.src && !e.fine).def; c.home = oflHome(d, true); }
    return out.map(({ name, wide, home }) => (home != null ? { name, wide, home } : { name, wide }));
  }
  // OFL fixture JSON -> a type (text format). maker = the manufacturer's name.
  function fromOFL(fx, maker = 'Imported') {
    const av = fx.availableChannels || {}, tpl = fx.templateChannels || {};
    const switched = {};   // switching channel alias -> the channel it means by default
    for (const def of [...Object.values(av), ...Object.values(tpl)])
      for (const c of def.capabilities || []) for (const [alias, target] of Object.entries(c.switchChannels || {})) if (!(alias in switched)) switched[alias] = target;
    const pats = [];   // [regex, def, coarse key template, fine level]
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const [k, def] of Object.entries(tpl)) {
      pats.push([new RegExp('^' + esc(k).replace(esc('$pixelKey'), '(.+)') + '$'), def, k, 0]);
      (def.fineChannelAliases || []).forEach((a, i) => pats.push([new RegExp('^' + esc(a).replace(esc('$pixelKey'), '(.+)') + '$'), def, k, i + 1]));
    }
    const fineOf = {};
    for (const [k, def] of Object.entries(av)) (def.fineChannelAliases || []).forEach((a, i) => (fineOf[a] = [k, i + 1]));
    // key -> { def, key (coarse), src (coarse + pixel), fine, pixel }
    function resolve(key, depth = 0) {
      if (key == null) return { null: true, src: Symbol('none'), fine: 0 };
      if (av[key]) return { def: av[key], key, src: key, fine: 0, pixel: null };
      if (fineOf[key]) { const [k, f] = fineOf[key]; return { def: av[k], key: k, src: k, fine: f, pixel: null }; }
      if (switched[key] && depth < 3) return { ...resolve(switched[key], depth + 1), key };
      for (const [re, def, k, f] of pats) { const m = re.exec(key); if (m) return { def, key: k, src: k.replace('$pixelKey', m[1]), fine: f, pixel: m[1] }; }
      return { def: {}, key, src: key, fine: 0, pixel: null };
    }
    const pixelKeys = () => {
      const mx = fx.matrix || {};
      if (mx.pixelKeys) return mx.pixelKeys.flat(2).filter((k) => k != null);
      const [x = 1, y = 1, z = 1] = mx.pixelCount || [];
      return Array.from({ length: x * y * z }, (_, i) => String(i + 1));
    };
    const modes = [];
    for (const m of fx.modes || []) {
      const head = [];   // entries before the pixel block
      let cells = 0, cell = null, flat = false;
      const all = [];
      for (const ch of m.channels || []) {
        if (ch && typeof ch === 'object' && ch.insert === 'matrixChannels') {
          const px = Array.isArray(ch.repeatFor) ? ch.repeatFor : pixelKeys();
          const at = (t, p) => resolve(t == null ? null : t.replace('$pixelKey', p));
          const one = (p) => ch.templateChannels.map((t) => { const r = at(t, p); return { ...r, src: r.null ? r.src : String(r.src) + '@' + p }; });
          const block = ch.channelOrder === 'perChannel'
            ? ch.templateChannels.flatMap((t) => px.map((p) => at(t, p)))
            : px.flatMap(one);
          if (ch.channelOrder !== 'perChannel' && !cells && px.length > 1) { cells = px.length; cell = one(px[0]).map((e) => ({ ...e, src: e.key })); }
          else flat = true;
          all.push(...block);
        } else {
          const e = resolve(ch);
          if (cells) flat = true;   // channels after the pixel block: keep it one fixture
          else head.push(e);
          all.push(e);
        }
      }
      if (all.length > 512) continue;
      const md = { name: (m.name || m.shortName || `${all.length} ch`).replace(/:/g, ' ').trim(), head: [], cells: 0, cell: [] };
      if (cells && !flat) { md.head = nameRun(head); md.cells = cells; md.cell = nameRun(cell); }
      else md.head = nameRun(all);
      if (modes.some((x) => x.name === md.name)) md.name += ` (${all.length} ch)`;
      modes.push(md);
    }
    const chans = modes.flatMap((md) => [...md.head, ...md.cell].map((c) => c.name));
    const t = { maker: String(maker).replace(/\//g, '-'), model: String(fx.name || 'Fixture').replace(/\s+\/\s+/g, ' - '), icon: '', curve: '', note: '', modes };
    t.icon = modes.some((md) => md.cells > 1) && !(fx.categories || []).some((c) => /Moving Head|Matrix/.test(c)) ? 'pixel' : iconFor(fx.categories, chans);
    return t;
  }

  // ---- Import: QLC+ fixture definition (.qxf, XML). Browser only (needs DOMParser). --------
  // Each channel is turned into an OFL-style channel and named like above.
  function qxfDef(ch) {
    const preset = ch.getAttribute('Preset') || '';
    const grp = ch.querySelector('Group'), group = grp?.textContent || '', byte = +(grp?.getAttribute('Byte') || 0);
    const colour = ch.querySelector('Colour')?.textContent || '';
    const caps = [...ch.querySelectorAll('Capability')];
    const shutterOpen = caps.find((c) => /ShutterOpen/.test(c.getAttribute('Preset') || '') || /open/i.test(c.textContent));
    const def = { capabilities: [] }, cap = (type, x = {}) => def.capabilities.push({ type, ...x });
    let fine = /Fine$/.test(preset) || byte === 1;
    const p = preset.replace(/Fine$/, '');
    let m;
    if (/^Intensity(Master)?Dimmer$/.test(p)) cap('Intensity');
    else if ((m = /^Intensity(Red|Green|Blue|White|Amber|UV|Lime|Cyan|Magenta|Yellow|Indigo|WarmWhite|ColdWhite)$/.exec(p))) cap('ColorIntensity', { color: m[1].replace(/(Warm|Cold)White/, '$1 White') });
    else if (/^PositionPan/.test(p)) cap('Pan');
    else if (/^PositionTilt/.test(p)) cap('Tilt');
    else if (/^SpeedPanTilt/.test(p)) cap('PanTiltSpeed');
    else if (/^ShutterStrobe/.test(p)) cap('ShutterStrobe', { shutterEffect: shutterOpen ? 'Open' : 'Strobe' });
    else if (/^ColorMacro/.test(p)) cap('ColorPreset');
    else if (/^ColorWheel/.test(p)) cap('WheelSlot', { wheel: 'Color' });
    else if (/^ColorCT/.test(p)) cap('ColorTemperature');
    else if (/^GoboWheel|^GoboIndex/.test(p)) cap(/Rotation/.test(p) ? 'WheelRotation' : 'WheelSlot', { wheel: 'Gobo' });
    else if (/^Prism/.test(p)) cap(/Rotation/.test(p) ? 'PrismRotation' : 'Prism');
    else if (/^BeamZoom/.test(p)) cap('Zoom');
    else if (/^BeamFocus/.test(p)) cap('Focus');
    else if (/^BeamIris/.test(p)) cap('Iris');
    else if (/^BeamFrost/.test(p)) cap('Frost');
    else if (/^NoFunction/.test(p)) cap('NoFunction');
    else if (group === 'Intensity') cap(colour ? 'ColorIntensity' : 'Intensity', colour ? { color: colour } : {});
    else if (group === 'Pan') cap('Pan');
    else if (group === 'Tilt') cap('Tilt');
    else if (group === 'Colour') cap('WheelSlot', { wheel: 'Color' });
    else if (group === 'Gobo') cap('WheelSlot', { wheel: 'Gobo' });
    else if (group === 'Shutter') cap('ShutterStrobe', { shutterEffect: shutterOpen ? 'Open' : 'Strobe' });
    else if (group === 'Speed') cap('Speed');
    else if (group === 'Prism') cap('Prism');
    else if (group === 'Beam') cap('Zoom');
    else if (group === 'Effect') cap('Effect');
    else if (group === 'Maintenance') cap('Maintenance');
    else if (group === 'Nothing') cap('NoFunction');
    if (def.capabilities[0]?.type === 'ShutterStrobe' && shutterOpen) def.capabilities.push({ type: 'ShutterStrobe', shutterEffect: 'Open', dmxRange: [+shutterOpen.getAttribute('Min') || 0, +shutterOpen.getAttribute('Max') || 255] });
    const dflt = ch.getAttribute('Default');
    if (dflt != null && +dflt > 0) def.defaultValue = +dflt;
    return { def, fine };
  }
  function fromQXF(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const root = doc.querySelector('FixtureDefinition');
    if (!root) throw new Error('not a QLC+ fixture definition');
    const chans = {};
    for (const ch of root.querySelectorAll(':scope > Channel')) chans[ch.getAttribute('Name')] = qxfDef(ch);
    const modes = [];
    for (const m of root.querySelectorAll(':scope > Mode')) {
      const list = [...m.querySelectorAll(':scope > Channel')].sort((a, b) => +a.getAttribute('Number') - +b.getAttribute('Number')).map((c) => c.textContent);
      const ent = (name, i) => {
        const c = chans[name] || { def: {}, fine: false };
        // A fine channel belongs to the channel right before it.
        return c.fine && i > 0 ? { def: c.def, key: name, src: 'c' + (i - 1), fine: 1 } : { def: c.def, key: name, src: 'c' + i, fine: 0 };
      };
      const all = list.map(ent);
      // Pixel heads at the end, all the same size: one fixture per cell.
      const heads = [...m.querySelectorAll(':scope > Head')].map((h) => [...h.querySelectorAll('Channel')].map((c) => +c.textContent).sort((a, b) => a - b));
      const k = heads[0]?.length || 0, first = heads[0]?.[0] ?? -1;
      const tidy = heads.length > 1 && heads.every((h, i) => h.length === k && h.every((n, j) => n === first + i * k + j)) && first + heads.length * k === list.length;
      const md = { name: (m.getAttribute('Name') || `${list.length} ch`).replace(/:/g, ' '), head: [], cells: 0, cell: [] };
      if (tidy) {
        md.head = nameRun(all.slice(0, first));
        md.cells = heads.length;
        md.cell = nameRun(list.slice(first, first + k).map((n, j) => ent(n, j)));
      } else md.head = nameRun(all);
      if (!modes.some((x) => x.name === md.name)) modes.push(md);
    }
    const type = root.querySelector(':scope > Type')?.textContent || '';
    const names = modes.flatMap((md) => [...md.head, ...md.cell].map((c) => c.name));
    return {
      maker: (root.querySelector(':scope > Manufacturer')?.textContent || 'Imported').replace(/\//g, '-'),
      model: (root.querySelector(':scope > Model')?.textContent || 'Fixture').replace(/\s+\/\s+/g, ' - '),
      icon: /Pixels/.test(type) ? 'pixel' : /Bar/.test(type) ? 'bar' : iconFor([type], names), curve: '', note: '', modes,
    };
  }

  const generic = parse(GENERIC, 'generic').types;
  const api = { ICONS, iconSvg, parse, toText, modeText, modeFootprint, channelNames, homeValues, guessIcon, fromOFL, fromQXF, generic };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KDLib = api;
})(typeof window !== 'undefined' ? window : globalThis);
