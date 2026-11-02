// KD effects: a tiny shader-like language that runs once per fixture per frame.
// Shared by the web UI (preview, validation) and tools/mock-server.js; src/Fx.cpp is
// the same compiler + VM in C++ for the controller - keep the three in step.
//
//   // comments
//   param speed = 0.5 [0, 4]      number parameter with a slider range
//   param color = #ff8800         colour parameter: color.r, color.g, color.b (0..1)
//                                 (a comment after a param is its note, shown next to its slider)
//   h = fract(t * speed + x)      locals: just assign them (optionally with 'let')
//   r, g, b = hsv(h, 1, 1)        outputs r g b (0..1), dim (0..1, default 1), w (default auto)
//   r, g, b = color               a colour parameter fills all three
//
// Inputs: t (seconds since the cue), i (fixture index in the track), n (fixture count),
// u = i / n, x / y (position on the map, 0..1; without a map x = u, y = 0.5), pi, tau.
(function (root) {
  'use strict';
  const INPUTS = ['t', 'i', 'n', 'u', 'x', 'y', 'pi', 'tau'];
  const OUTPUTS = ['r', 'g', 'b', 'w', 'dim'];
  // name -> [args, results]. The index in this list is the function number in the bytecode.
  const FUNCS = [['sin', 1], ['cos', 1], ['tan', 1], ['abs', 1], ['floor', 1], ['ceil', 1], ['fract', 1], ['sqrt', 1],
    ['exp', 1], ['log', 1], ['sign', 1], ['pow', 2], ['min', 2], ['max', 2], ['mod', 2], ['atan', 2], ['step', 2],
    ['clamp', 3], ['mix', 3], ['smoothstep', 3], ['rand', 1], ['noise', 1], ['tri', 1], ['saw', 1], ['sq', 1],
    ['pulse', 2], ['hsv', 3, 3]];
  const FIDX = Object.fromEntries(FUNCS.map((f, k) => [f[0], k]));
  const FDOC = {
    sin: 'sin(x)', cos: 'cos(x)', tan: 'tan(x)', abs: 'abs(x)', floor: 'floor(x)', ceil: 'ceil(x)', fract: 'fract(x): x - floor(x), 0..1',
    sqrt: 'sqrt(x)', exp: 'exp(x)', log: 'log(x)', sign: 'sign(x): -1, 0 or 1', pow: 'pow(x, p)', min: 'min(a, b)', max: 'max(a, b)',
    mod: 'mod(x, m): always positive, like GLSL', atan: 'atan(y, x): angle in radians', step: 'step(edge, x): 0 below edge, 1 from edge',
    clamp: 'clamp(x, lo, hi)', mix: 'mix(a, b, k): a + (b - a) * k', smoothstep: 'smoothstep(e0, e1, x): soft 0 -> 1 between e0 and e1',
    rand: 'rand(x): repeatable random 0..1 per whole step of x*4096', noise: 'noise(x): smooth random 0..1',
    tri: 'tri(x): triangle wave 0 -> 1 -> 0 per unit', saw: 'saw(x): sawtooth 0 -> 1 per unit', sq: 'sq(x): square wave, 1 for the first half of each unit',
    pulse: 'pulse(x, width): 1 for the first <width> of each unit', hsv: 'r, g, b = hsv(hue, sat, val): hue 0..1 wraps',
  };
  // Opcodes (same numbers in Fx.cpp)
  const OP = { CONST: 0, LOAD: 1, STORE: 2, ADD: 3, SUB: 4, MUL: 5, DIV: 6, MOD: 7, NEG: 8, NOT: 9, LT: 10, GT: 11, LE: 12, GE: 13,
    EQ: 14, NE: 15, AND: 16, OR: 17, SEL: 18, CALL: 19 };

  function tokenize(src) {
    const toks = [];
    let line = 1, depth = 0, k = 0;
    const push = (type, v) => toks.push({ type, v, line });
    while (k < src.length) {
      const c = src[k];
      if (c === '/' && src[k + 1] === '/') { while (k < src.length && src[k] !== '\n') k++; continue; }
      if (c === '\n') { if (!depth) push(';'); line++; k++; continue; }
      if (/\s/.test(c)) { k++; continue; }
      const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(k));
      if (num) { push('num', parseFloat(num[0])); k += num[0].length; continue; }
      const id = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(k));
      if (id) { push('id', id[0]); k += id[0].length; continue; }
      const hex = /^#[0-9a-fA-F]{6}\b/.exec(src.slice(k));
      if (hex) { push('color', hex[0].toLowerCase()); k += 7; continue; }
      const two = src.slice(k, k + 2);
      if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) { push(two); k += 2; continue; }
      if ('+-*/%(),=;?:<>![]'.includes(c)) {
        if (c === '(' || c === '[') depth++;
        if ((c === ')' || c === ']') && depth) depth--;
        push(c); k++; continue;
      }
      throw err(line, `unexpected '${c}'`);
    }
    push(';');
    push('eof');
    return toks;
  }
  function err(line, msg) { const e = new Error(msg); e.line = line; return e; }

  // Compile to bytecode: {code: [op, arg, op, arg...], slots, params, names, error}
  function compile(src) {
    const names = [...INPUTS, ...OUTPUTS];
    const slot = Object.fromEntries(names.map((n, k) => [n, k]));
    const assigned = new Set([...INPUTS, ...OUTPUTS]);
    const params = [];
    const code = [];
    let toks, p = 0, depth = 0, maxDepth = 0;
    const emit = (op, arg = 0, d = 0) => { code.push(op, arg); depth += d; maxDepth = Math.max(maxDepth, depth); };
    const peek = () => toks[p], next = () => toks[p++];
    const expect = (t, what) => { if (peek().type !== t) throw err(peek().line, `expected ${what || `'${t}'`}`); return next(); };
    const newSlot = (n) => { if (!(n in slot)) { slot[n] = names.length; names.push(n); } return slot[n]; };
    // UI only: the comment at the end of a param line (the controller skips comments)
    const lines = String(src).split('\n');
    const noteOf = (line) => (/\/\/\s*(.*?)\s*$/.exec(lines[line - 1] || '') || [])[1] || '';
    try {
      toks = tokenize(src);
      while (peek().type !== 'eof') {
        if (peek().type === ';') { next(); continue; }
        const tk = peek();
        if (tk.type === 'id' && tk.v === 'param') {
          next();
          const name = expect('id', 'a parameter name').v;
          if (name.includes('.') || name in slot) throw err(tk.line, `'${name}' can't be used as a parameter name`);
          expect('=');
          if (peek().type === 'color') {
            const hex = next().v;
            for (const ch of ['r', 'g', 'b']) { newSlot(`${name}.${ch}`); assigned.add(`${name}.${ch}`); }
            params.push({ name, type: 'color', def: hex, slot: slot[`${name}.r`], note: noteOf(tk.line) });
          } else {
            const neg = peek().type === '-' ? (next(), -1) : 1;
            const def = neg * expect('num', 'a number or #rrggbb').v;
            let min = Math.min(0, def), max = Math.max(1, def);
            if (peek().type === '[') {
              next();
              const n1 = peek().type === '-' ? (next(), -1) : 1; min = n1 * expect('num', 'a minimum').v;
              expect(',');
              const n2 = peek().type === '-' ? (next(), -1) : 1; max = n2 * expect('num', 'a maximum').v;
              expect(']');
            }
            newSlot(name); assigned.add(name);
            params.push({ name, type: 'num', def, min, max, slot: slot[name], note: noteOf(tk.line) });
          }
          expect(';', 'end of line');
          continue;
        }
        if (tk.type === 'id' && tk.v === 'let') next();
        const targets = [expect('id', 'a name to assign to').v];
        while (peek().type === ',') { next(); targets.push(expect('id', 'a name').v); }
        expect('=', "'='");
        for (const n of targets) {
          if (INPUTS.includes(n)) throw err(tk.line, `'${n}' is an input and can't be changed`);
          if (params.some((q) => q.name === n || n.startsWith(q.name + '.'))) throw err(tk.line, `'${n}' is a parameter and can't be changed`);
        }
        if (targets.length === 1) {
          expr();
          if (depth !== 1) throw err(tk.line, 'this gives 3 values: assign it to three names, like r, g, b = ...');
          for (const n of targets) assigned.add(n);
          emit(OP.STORE, newSlot(targets[0]), -1);
        } else {
          if (targets.length !== 3) throw err(tk.line, 'assign one value, or three (r, g, b = ...)');
          // r, g, b = <colour param>  or  = hsv(...)
          const c = peek();
          const col = c.type === 'id' && params.find((q) => q.type === 'color' && q.name === c.v);
          if (col && [';', 'eof'].includes(toks[p + 1].type)) {
            next();
            for (const ch of ['r', 'g', 'b']) emit(OP.LOAD, slot[`${col.name}.${ch}`], 1);
          } else {
            expr();
            if (depth !== 3) throw err(tk.line, 'three names need a colour: hsv(...) or a colour parameter');
          }
          for (const n of targets) assigned.add(n);
          for (const n of [...targets].reverse()) emit(OP.STORE, newSlot(n), -1);
        }
        if (peek().type !== ';' && peek().type !== 'eof') throw err(peek().line, `unexpected '${peek().v ?? peek().type}' - one statement per line`);
      }
    } catch (e) {
      return { error: { line: e.line || 0, msg: e.message } };
    }
    if (maxDepth > 64) return { error: { line: 0, msg: 'expression too complex' } };
    return { code, slots: names.length, names, params, error: null };

    // ---- expressions (precedence climbing) ----
    function expr() {
      orExpr();
      if (peek().type === '?') {
        next(); expr(); expect(':', "':'"); expr();
        emit(OP.SEL, 0, -2);
      }
    }
    function bin(sub, ops) {
      sub();
      while (ops[peek().type] != null) { const o = ops[next().type]; sub(); emit(o, 0, -1); }
    }
    function orExpr() { bin(andExpr, { '||': OP.OR }); }
    function andExpr() { bin(cmpExpr, { '&&': OP.AND }); }
    function cmpExpr() { bin(addExpr, { '<': OP.LT, '>': OP.GT, '<=': OP.LE, '>=': OP.GE, '==': OP.EQ, '!=': OP.NE }); }
    function addExpr() { bin(mulExpr, { '+': OP.ADD, '-': OP.SUB }); }
    function mulExpr() { bin(unary, { '*': OP.MUL, '/': OP.DIV, '%': OP.MOD }); }
    function unary() {
      if (peek().type === '-') { next(); unary(); emit(OP.NEG); return; }
      if (peek().type === '!') { next(); unary(); emit(OP.NOT); return; }
      if (peek().type === '+') { next(); unary(); return; }
      primary();
    }
    function primary() {
      const tk = next();
      if (tk.type === 'num') return emit(OP.CONST, tk.v, 1);
      if (tk.type === '(') { expr(); expect(')', "')'"); return; }
      if (tk.type === 'id') {
        if (peek().type === '(') {
          next();
          const f = FIDX[tk.v];
          if (f == null) throw err(tk.line, `unknown function '${tk.v}'`);
          const [, nargs, nret = 1] = FUNCS[f];
          let got = 0;
          if (peek().type !== ')') {
            for (;;) {
              const d0 = depth;
              expr();
              if (depth - d0 !== 1) throw err(tk.line, `a colour can't be an argument of ${tk.v}()`);
              got++;
              if (peek().type !== ',') break;
              next();
            }
          }
          expect(')', "')'");
          if (got !== nargs) throw err(tk.line, `${tk.v}() takes ${nargs} argument${nargs > 1 ? 's' : ''}, not ${got}`);
          emit(OP.CALL, f, nret - nargs);
          return;
        }
        if (params.some((q) => q.type === 'color' && q.name === tk.v)) throw err(tk.line, `'${tk.v}' is a colour: use ${tk.v}.r, ${tk.v}.g or ${tk.v}.b, or r, g, b = ${tk.v}`);
        if (!(tk.v in slot) || !assigned.has(tk.v)) throw err(tk.line, `unknown name '${tk.v}'`);
        return emit(OP.LOAD, slot[tk.v], 1);
      }
      throw err(tk.line, tk.type === ';' || tk.type === 'eof' ? 'line ends too early' : `unexpected '${tk.v ?? tk.type}'`);
    }
  }

  // ---- runtime ----
  const fract = (x) => x - Math.floor(x);
  // Integer hash so the controller (float) and the browser (double) agree.
  function rand(x) {
    let h = Math.floor(x * 4096) | 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h ^= h >>> 16;
    return (h >>> 8) / 16777216;
  }
  function noise(x) {
    const i = Math.floor(x), f = x - i, k = f * f * (3 - 2 * f);
    const a = rand(i / 4096), b = rand((i + 1) / 4096);
    return a + (b - a) * k;
  }
  function hsv(h, s, v) {
    h = fract(h) * 6;
    s = Math.max(0, Math.min(1, s));
    const k = Math.floor(h), f = h - k, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
    return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][k % 6];
  }
  const F = [Math.sin, Math.cos, Math.tan, Math.abs, Math.floor, Math.ceil, fract, (x) => (x > 0 ? Math.sqrt(x) : 0),
    Math.exp, (x) => (x > 0 ? Math.log(x) : 0), Math.sign, (x, y) => (x < 0 && y !== Math.floor(y) ? 0 : x ** y), Math.min, Math.max,
    (x, m) => (m ? x - m * Math.floor(x / m) : 0), Math.atan2, (e, x) => (x < e ? 0 : 1),
    (x, a, b) => Math.max(a, Math.min(b, x)), (a, b, k) => a + (b - a) * k,
    (a, b, x) => { const k = a === b ? (x < a ? 0 : 1) : Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); },
    rand, noise, (x) => 1 - Math.abs(fract(x) * 2 - 1), fract, (x) => (fract(x) < 0.5 ? 1 : 0), (x, w) => (fract(x) < w ? 1 : 0), hsv];

  // Fresh slot array: inputs set by the caller, outputs at their defaults, params from values.
  function slotsFor(prog, values = {}) {
    const s = new Float64Array(prog.slots);
    s[6] = Math.PI; s[7] = Math.PI * 2;
    s[11] = -1; s[12] = 1;        // w = auto, dim = 1
    for (const q of prog.params) {
      const v = values[q.name] ?? q.def;
      if (q.type === 'color') {
        const hex = /^#[0-9a-f]{6}$/i.test(v) ? v : q.def;
        for (let k = 0; k < 3; k++) s[q.slot + k] = parseInt(hex.slice(1 + k * 2, 3 + k * 2), 16) / 255;
      } else s[q.slot] = +v;
    }
    return s;
  }
  // Run once. s: slots (from slotsFor, inputs filled in). Leaves r g b w dim in s[8..12].
  function run(prog, s) {
    const c = prog.code, st = [];
    for (let k = 0; k < c.length; k += 2) {
      const op = c[k], a = c[k + 1];
      switch (op) {
        case 0: st.push(a); break;
        case 1: st.push(s[a]); break;
        case 2: s[a] = st.pop(); break;
        case 8: st.push(-st.pop()); break;
        case 9: st.push(st.pop() ? 0 : 1); break;
        case 18: { const z = st.pop(), y = st.pop(), x = st.pop(); st.push(x ? y : z); break; }
        case 19: {
          const n = FUNCS[a][1], args = st.splice(st.length - n, n);
          const v = F[a](...args);
          if (Array.isArray(v)) st.push(...v); else st.push(Number.isFinite(v) ? v : 0);
          break;
        }
        default: {
          const y = st.pop(), x = st.pop();
          st.push(op === 3 ? x + y : op === 4 ? x - y : op === 5 ? x * y : op === 6 ? (y ? x / y : 0) : op === 7 ? (y ? x - y * Math.floor(x / y) : 0)
            : op === 10 ? +(x < y) : op === 11 ? +(x > y) : op === 12 ? +(x <= y) : op === 13 ? +(x >= y) : op === 14 ? +(x === y)
              : op === 15 ? +(x !== y) : op === 16 ? +(!!x && !!y) : +(!!x || !!y));
        }
      }
    }
    return s;
  }
  // Effect output -> DMX values for one fixture. slotsOf: {dim, r, g, b, w} present or not.
  // RGB without a dimmer gets scaled by dim; RGBW takes white = min(r,g,b) unless the effect sets w;
  // a dimmer-only fixture shows dim * the brightest of r, g, b.
  function toFixture(s, has, level = 1) {
    const cl = (v) => Math.max(0, Math.min(1, v));
    const dim = cl(s[12]) * level;
    let r = cl(s[8]), g = cl(s[9]), b = cl(s[10]), w = s[11] >= 0 ? cl(s[11]) : -1;
    const out = {};
    const rgb = has.r && has.g && has.b;
    if (!rgb) { if (has.dim) out.dim = dim * Math.max(r, g, b); return out; }
    if (has.dim) out.dim = dim;
    else { r *= dim; g *= dim; b *= dim; if (w >= 0) w *= dim; }
    if (has.w) {
      if (w < 0) { w = Math.min(r, g, b); r -= w; g -= w; b -= w; }
      out.w = w;
    }
    out.r = r; out.g = g; out.b = b;
    return out;
  }

  // ---- base effects (copy them into a project and change them) ----
  // group: 'line' = along the fixtures in list order, 'all' = whole rig / random per fixture,
  // 'xy' = over the map (x, y). Speeds never depend on the fixture count, so an effect looks
  // the same on 8 or 800 fixtures. The comment after each param is its note in the UI.
  const TEMPLATES = [
    { name: 'Rainbow', group: 'line', code: `// Colour wheel rolling over the fixtures
param speed = 0.2 [0, 2]       // turns of the colour wheel per second
param spread = 1 [0, 4]        // rainbows across the rig (the map's width): 0 = all the same colour
param sat = 1 [0, 1]           // saturation: 0 = white, 1 = full colour
r, g, b = hsv(t * speed + x * spread, sat, 1)` },
    { name: 'Chase', group: 'line', code: `// One light running along the fixtures, in list order
param speed = 0.5 [0, 4]       // rounds per second: 1 = the light passes every fixture once a second
param width = 0.25 [0.02, 1]   // size of the light, part of the rig (0.25 = a quarter)
param color = #ffffff          // colour of the light
param back = #000000           // colour of the other fixtures
pos = fract(t * speed)
d = abs(fract(u - pos + 0.5) - 0.5)
k = smoothstep(max(width / 2, 1 / n), 0, d)
r = mix(back.r, color.r, k)
g = mix(back.g, color.g, k)
b = mix(back.b, color.b, k)` },
    { name: 'Bounce (scanner)', group: 'line', code: `// A light going back and forth along the fixtures
param speed = 0.3 [0, 4]       // trips there and back per second
param width = 0.2 [0.02, 1]    // size of the light, part of the rig
param color = #ff0000          // colour of the light
p0 = n > 1 ? i / (n - 1) : 0.5
d = abs(p0 - tri(t * speed))
r, g, b = color
dim = smoothstep(max(width / 2, 1 / n), 0, d)` },
    { name: 'Theatre chase', group: 'line', code: `// Every few fixtures on, stepping along (marquee lights)
param rate = 4 [0.5, 20]       // steps per second
param every = 3 [2, 8]         // one fixture on in every ... fixtures
param color = #ffcc66          // colour of the fixtures that are on
param back = #000000           // colour of the others
on = mod(i - floor(t * rate), max(floor(every), 2)) < 1
r = on ? color.r : back.r
g = on ? color.g : back.g
b = on ? color.b : back.b` },
    { name: 'Two-colour fade', group: 'line', code: `// Fade back and forth between two colours, offset per fixture
param speed = 0.15 [0, 2]      // fades there and back per second
param offset = 0.5 [0, 1]      // shift along the rig: 0 = all together, 1 = a whole cycle spread out
param a = #ff2d92              // first colour
param b2 = #0a84ff             // second colour
k = tri(t * speed + u * offset)
r = mix(a.r, b2.r, k)
g = mix(a.g, b2.g, k)
b = mix(a.b, b2.b, k)` },
    { name: 'Colour steps', group: 'line', code: `// Steps through three colours
param rate = 0.5 [0.05, 4]     // colour changes per second
param fade = 0.3 [0, 1]        // 0 = hard cut, 1 = fade all the way to the next colour
param offset = 0 [0, 1]        // shift along the rig: 0 = all fixtures the same colour
param c1 = #ff0000             // first colour
param c2 = #00ff00             // second colour
param c3 = #0000ff             // third colour
ph = mod(t * rate + u * offset * 3, 3)
st = floor(ph)
k = smoothstep(1 - fade, 1, fract(ph))
r = mix(st < 1 ? c1.r : st < 2 ? c2.r : c3.r, st < 1 ? c2.r : st < 2 ? c3.r : c1.r, k)
g = mix(st < 1 ? c1.g : st < 2 ? c2.g : c3.g, st < 1 ? c2.g : st < 2 ? c3.g : c1.g, k)
b = mix(st < 1 ? c1.b : st < 2 ? c2.b : c3.b, st < 1 ? c2.b : st < 2 ? c3.b : c1.b, k)` },
    { name: 'Wipe', group: 'line', code: `// Fills the rig with a colour from left to right, then empties it the same way
param speed = 0.25 [0.02, 2]   // complete fill + empty cycles per second
param soft = 0.1 [0, 0.5]      // soft edge, part of the rig (0 = hard edge)
param color = #0a84ff          // fill colour
param back = #000000           // colour before the fill
e = fract(t * speed * 2) * (1 + soft) - soft
fill = 1 - smoothstep(e, e + soft, x)
k = fract(t * speed) < 0.5 ? fill : 1 - fill
r = mix(back.r, color.r, k)
g = mix(back.g, color.g, k)
b = mix(back.b, color.b, k)` },
    { name: 'Police', group: 'line', code: `// Red / blue alternating halves
param rate = 2 [0.5, 8]        // changes per second
side = u < 0.5
phase = sq(t * rate)
on = side ? phase : 1 - phase
r = on
b = 1 - on
dim = pulse(t * rate * 4, 0.5) * 0.5 + 0.5` },
    { name: 'Breathe', group: 'all', code: `// Slow fade up and down
param speed = 0.25 [0.02, 2]   // breaths per second
param low = 0.1 [0, 1]         // lowest level (0 = all the way off)
param color = #ffb347          // colour
r, g, b = color
dim = mix(low, 1, 0.5 - 0.5 * cos(t * speed * tau))` },
    { name: 'Heartbeat', group: 'all', code: `// Double pulse, like a heartbeat
param bpm = 60 [20, 180]       // beats per minute
param low = 0.05 [0, 0.5]      // level between the beats
param color = #ff2040          // colour
ph = fract(t * bpm / 60)
beat = max(1 - abs(ph - 0.08) * 14, 0) + 0.7 * max(1 - abs(ph - 0.3) * 12, 0)
r, g, b = color
dim = mix(low, 1, min(beat, 1))` },
    { name: 'Strobe', group: 'all', code: `// Flashes; rate in flashes per second
param rate = 8 [0.5, 25]       // flashes per second
param duty = 0.15 [0.02, 0.9]  // part of each flash that is on (0.5 = half on, half off)
param color = #ffffff          // colour of the flash
r, g, b = color
dim = pulse(t * rate, duty)` },
    { name: 'Lightning', group: 'all', code: `// Random lightning flashes over the whole rig
param rate = 0.5 [0.05, 4]     // flashes per second, on average
param base = 0 [0, 0.3]        // level between the flashes
param color = #dfe8ff          // colour of the flash
s = floor(t * 20)
hit = rand(s * 0.0137) < rate / 20
r, g, b = color
dim = hit ? 0.4 + 0.6 * rand(s * 0.0291 + 0.5) : base` },
    { name: 'Fire', group: 'all', code: `// Flickering flame, every fixture its own
param speed = 3 [0.5, 10]      // how fast the flames flicker
f = noise(t * speed + i * 17.3) * 0.7 + noise(t * speed * 2.7 + i * 5.1) * 0.3
r = 1
g = 0.25 + f * 0.35
b = 0
dim = 0.35 + f * 0.65` },
    { name: 'Candle', group: 'all', code: `// Warm, gentle flicker
param color = #ff9329          // colour of the flame
f = noise(t * 2.1 + i * 3.7) * 0.6 + noise(t * 7.3 + i) * 0.4
r, g, b = color
dim = 0.6 + f * 0.4` },
    { name: 'Sparkle', group: 'all', code: `// Random short flashes on a coloured base
param rate = 6 [1, 30]         // chances to flash per second
param chance = 0.08 [0, 0.5]   // part of the fixtures that flash each time
param base = #1a2a6c           // background colour
param flash = #ffffff          // colour of the flash
step_t = floor(t * rate)
on = rand(step_t * 0.37 + i * 0.011) < chance
r = on ? flash.r : base.r
g = on ? flash.g : base.g
b = on ? flash.b : base.b` },
    { name: 'Twinkle', group: 'all', code: `// Every fixture slowly fades in and out on its own (starry sky)
param speed = 0.3 [0.05, 2]    // how fast the stars fade in and out
param amount = 0.45 [0, 1]     // how many stars are lit at a time
param color = #ffffff          // colour of the stars
param base = #000814           // background colour
k = smoothstep(1 - amount, 1, noise(t * speed + i * 7.31))
r = mix(base.r, color.r, k)
g = mix(base.g, color.g, k)
b = mix(base.b, color.b, k)` },
    { name: 'Wave across the map', group: 'xy', code: `// Brightness wave moving left to right over the map
param speed = 0.3 [0, 2]       // waves passing per second
param size = 1.5 [0.2, 6]      // waves across the map's width
param color = #00c7be          // colour
r, g, b = color
dim = 0.5 + 0.5 * sin((x * size - t * speed) * tau)` },
    { name: 'XY ripple', group: 'xy', code: `// Rings rippling out from a point on the map, like a stone in water
param cx = 0.5 [0, 1]          // centre: 0 = left edge, 1 = right edge
param cy = 0.5 [0, 1]          // centre: 0 = top edge, 1 = bottom edge
param speed = 0.5 [0, 3]       // rings per second
param size = 3 [0.5, 10]       // rings from the centre to the edge
param color = #00c7be          // colour of the rings
param back = #000000           // colour between the rings
d = sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy))
k = pow(0.5 + 0.5 * sin((d * size - t * speed) * tau), 3)
r = mix(back.r, color.r, k)
g = mix(back.g, color.g, k)
b = mix(back.b, color.b, k)` },
    { name: 'XY sweep', group: 'xy', code: `// A bar of light sweeping over the map, in any direction
param angle = 0 [0, 360]       // direction in degrees: 0 = to the right, 90 = down, 180 = to the left
param speed = 0.3 [0, 2]       // sweeps per second
param width = 0.2 [0.02, 1]    // thickness of the bar, part of the map
param color = #ffffff          // colour of the bar
a = angle / 360 * tau
p = (x - 0.5) * cos(a) + (y - 0.5) * sin(a)
pos = fract(t * speed) * (1.42 + width) - 0.71 - width / 2
r, g, b = color
dim = smoothstep(width / 2, 0, abs(p - pos))` },
    { name: 'XY radar', group: 'xy', code: `// A beam turning around a point, with a fading tail
param cx = 0.5 [0, 1]          // centre: 0 = left edge, 1 = right edge
param cy = 0.5 [0, 1]          // centre: 0 = top edge, 1 = bottom edge
param speed = 0.25 [-2, 2]     // turns per second (minus = the other way round)
param tail = 0.3 [0.02, 1]     // length of the tail, part of a turn
param color = #30d158          // colour of the beam
a = atan(y - cy, x - cx) / tau
k = speed >= 0 ? fract(t * speed - a) : fract(a - t * speed)
r, g, b = color
dim = smoothstep(tail, 0, k)` },
    { name: 'XY plasma', group: 'xy', code: `// Soft colour clouds drifting over the map
param speed = 0.3 [0, 2]       // how fast the clouds move
param scale = 3 [0.5, 10]      // bigger = more, smaller clouds
param sat = 1 [0, 1]           // saturation: 0 = white, 1 = full colour
v = sin(x * scale * 3 + t * speed * 3) + sin((y * scale + t * speed * 2) * 2) + sin((x + y) * scale * 2 - t * speed * 4)
r, g, b = hsv(v / 6 + t * speed * 0.2, sat, 1)` },
    { name: 'XY gradient', group: 'xy', code: `// Two colours blended across the map at an angle, optionally moving
param angle = 0 [0, 360]       // direction of the blend in degrees: 0 = left to right, 90 = top to bottom
param speed = 0 [-1, 1]        // how fast the colours move (0 = still)
param c1 = #ff2d92             // colour at the start
param c2 = #0a84ff             // colour at the end
a = angle / 360 * tau
p = (x - 0.5) * cos(a) + (y - 0.5) * sin(a) + 0.5
k = tri((p + t * speed) / 2)
r = mix(c1.r, c2.r, k)
g = mix(c1.g, c2.g, k)
b = mix(c1.b, c2.b, k)` },
  ];
  const GROUPS = { line: 'Along the fixtures (list order)', all: 'Whole rig / per fixture', xy: 'XY: over the map' };

  const api = { compile, run, slotsFor, toFixture, TEMPLATES, GROUPS, INPUTS, OUTPUTS, FUNCS, FDOC, rand, noise, hsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KDFX = api;
})(typeof window !== 'undefined' ? window : globalThis);
