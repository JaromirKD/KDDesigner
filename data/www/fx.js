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
//   param pal = #ff0000, #ffff00, #0000ff   colour list (gradient, 1-8 colours): r, g, b = grad(pal, k);
//                                 a colour may have a place 0..1: #ff0000, #ff0000 0.9, #ffff00 (else evenly spread)
//   param msg = "WELCOME"         text: txt(msg, px, py) = 1 on a letter's pixel; msg.w = its width
//   param pic = image             picture (chosen per timeline clip): r, g, b = img(pic, x, y, frame);
//                                 pic.w, pic.h (pixels), pic.frames (an animated GIF has several)
//
// "t * speed" with a number parameter is the parameter's clock (see mulExpr): a speed change
// carries on from where the effect is. Timeline clips can automate number parameters (runner).
// Inputs: t (seconds since the cue), i (fixture index in the track), n (fixture count),
// u = i / n, x / y (position on the map, 0..1; without a map x = u, y = 0.5), pi, tau.
(function (root) {
  'use strict';
  const INPUTS = ['t', 'i', 'n', 'u', 'x', 'y', 'pi', 'tau'];
  const OUTPUTS = ['r', 'g', 'b', 'w', 'dim'];
  // name -> [args, results, kind of parameter the first argument names]. The index in this
  // list is the function number in the bytecode. grad / txt / img get the parameter's first
  // slot number as their first argument (a constant), and read the slots / data behind it.
  const FUNCS = [['sin', 1], ['cos', 1], ['tan', 1], ['abs', 1], ['floor', 1], ['ceil', 1], ['fract', 1], ['sqrt', 1],
    ['exp', 1], ['log', 1], ['sign', 1], ['pow', 2], ['min', 2], ['max', 2], ['mod', 2], ['atan', 2], ['step', 2],
    ['clamp', 3], ['mix', 3], ['smoothstep', 3], ['rand', 1], ['noise', 1], ['tri', 1], ['saw', 1], ['sq', 1],
    ['pulse', 2], ['hsv', 3, 3], ['grad', 2, 3, 'gradient'], ['txt', 3, 1, 'text'], ['img', 4, 3, 'image']];
  const MAX_STOPS = 8;                 // colours in a gradient
  const MAX_TEXT = 200;                // characters of a text parameter
  const MAX_IMAGE = 16384;             // pixels of a picture, all frames together (w x h x frames)
  const KIND_WORD = { gradient: 'colour list', text: 'text', image: 'picture' };
  const KIND_EXAMPLE = { gradient: 'pal, k', text: 'msg, px, py', image: 'pic, x, y, 0' };
  const FIDX = Object.fromEntries(FUNCS.map((f, k) => [f[0], k]));
  const FDOC = {
    sin: 'sin(x)', cos: 'cos(x)', tan: 'tan(x)', abs: 'abs(x)', floor: 'floor(x)', ceil: 'ceil(x)', fract: 'fract(x): x - floor(x), 0..1',
    sqrt: 'sqrt(x)', exp: 'exp(x)', log: 'log(x)', sign: 'sign(x): -1, 0 or 1', pow: 'pow(x, p)', min: 'min(a, b)', max: 'max(a, b)',
    mod: 'mod(x, m): always positive, like GLSL', atan: 'atan(y, x): angle in radians', step: 'step(edge, x): 0 below edge, 1 from edge',
    clamp: 'clamp(x, lo, hi)', mix: 'mix(a, b, k): a + (b - a) * k', smoothstep: 'smoothstep(e0, e1, x): soft 0 -> 1 between e0 and e1',
    rand: 'rand(x): repeatable random 0..1 per whole step of x*4096', noise: 'noise(x): smooth random 0..1',
    tri: 'tri(x): triangle wave 0 -> 1 -> 0 per unit', saw: 'saw(x): sawtooth 0 -> 1 per unit', sq: 'sq(x): square wave, 1 for the first half of each unit',
    pulse: 'pulse(x, width): 1 for the first <width> of each unit', hsv: 'r, g, b = hsv(hue, sat, val): hue 0..1 wraps',
    grad: 'r, g, b = grad(list, k): colour at k (0..1) along a colour list parameter; use fract(k) or tri(k) to go round',
    txt: 'txt(text, px, py): 1 on a letter pixel of a text parameter; px, py in letter pixels (letters are 5 x 7, 6 apart; text.w = width)',
    img: 'r, g, b = img(picture, x, y, frame): the picture\'s colour at x, y (0..1, black outside); frame wraps (pic.frames)',
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
      if (c === '"') {   // "text" on one line, no quotes inside (only for a text parameter)
        let e = k + 1;
        while (e < src.length && src[e] !== '"' && src[e] !== '\n') e++;
        if (src[e] !== '"') throw err(line, 'text needs a closing "');
        push('str', src.slice(k + 1, e));
        k = e + 1;
        continue;
      }
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
    const clocks = [];   // { p: the parameter's slot, s: the clock's slot }
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
          if (name.includes('.') || name in slot || names.some((n) => n.startsWith(name + '.'))) throw err(tk.line, `'${name}' can't be used as a parameter name`);
          expect('=');
          // Slots one after the other: the first one is the parameter's own (newSlot of fresh names).
          const own = (list) => { for (const n of list) { newSlot(n); assigned.add(n); } return slot[list[0]]; };
          if (peek().type === 'color' && (toks[p + 1].type === ',' || toks[p + 1].type === 'num')) {
            // Colour list: slot = how many colours, then r g b and place per colour (hidden names).
            const stops = [];
            for (;;) {
              const c = expect('color', 'a colour (#rrggbb)').v;
              const at = peek().type === 'num' ? next().v : null;
              if (at > 1) throw err(tk.line, 'a place in a colour list is 0 to 1');
              stops.push({ c, p: at });
              if (peek().type !== ',') break;
              next();
            }
            if (stops.length > MAX_STOPS) throw err(tk.line, `a colour list has at most ${MAX_STOPS} colours`);
            const at = own([name]);
            for (let k = 0; k < MAX_STOPS * 4; k++) newSlot(`${name}:${k}`);
            // def: as text (the UI shows it); stops: the colours at their places (what runs)
            const def = stops.map((x) => (x.p == null ? x.c : `${x.c} ${x.p}`)).join(',');
            params.push({ name, type: 'gradient', def, stops: fillStops(stops), slot: at, note: noteOf(tk.line) });
          } else if (peek().type === 'color') {
            const hex = next().v;
            for (const ch of ['r', 'g', 'b']) { newSlot(`${name}.${ch}`); assigned.add(`${name}.${ch}`); }
            params.push({ name, type: 'color', def: hex, slot: slot[`${name}.r`], note: noteOf(tk.line) });
          } else if (peek().type === 'str') {
            const def = next().v;
            if (utf8(def).length > MAX_TEXT) throw err(tk.line, `a text has at most ${MAX_TEXT} characters`);
            const at = own([name, `${name}.w`]);
            assigned.delete(name);   // the text itself is only for txt()
            params.push({ name, type: 'text', def, slot: at, note: noteOf(tk.line) });
          } else if (peek().type === 'id' && peek().v === 'image') {
            next();
            const at = own([name, `${name}.w`, `${name}.h`, `${name}.frames`]);
            assigned.delete(name);
            params.push({ name, type: 'image', def: '', slot: at, note: noteOf(tk.line) });
          } else {
            const neg = peek().type === '-' ? (next(), -1) : 1;
            const def = neg * expect('num', 'a number, #rrggbb, "text" or image').v;
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
    return { code, slots: names.length, names, params, clocks, error: null };

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
    // "t * speed" (or "speed * t") with a number parameter becomes the parameter's clock: a
    // hidden slot the player fills in per frame (frame() below). Unchanged it is t * speed
    // exactly; when the speed changes (automation, a live edit) the clock goes on from where
    // it was at the new pace, so a chase speeds up instead of jumping somewhere else.
    function mulExpr() {
      const k0 = code.length;
      unary();
      for (;;) {
        const o = { '*': OP.MUL, '/': OP.DIV, '%': OP.MOD }[peek().type];
        if (o == null) return;
        next();
        unary();
        if (o === OP.MUL && clockPair(k0)) continue;
        emit(o, 0, -1);
      }
    }
    function clockPair(k0) {
      if (code.length !== k0 + 4 || code[k0] !== OP.LOAD || code[k0 + 2] !== OP.LOAD) return false;
      const a = code[k0 + 1], b = code[k0 + 3], ps = a === 0 ? b : b === 0 ? a : -1;
      const q = ps > 0 && params.find((x) => x.type === 'num' && x.slot === ps);
      if (!q) return false;
      const name = `t*${q.name}`, fresh = !(name in slot);
      const cs = newSlot(name);
      if (fresh) clocks.push({ p: ps, s: cs });
      code.length = k0;
      depth -= 2;
      emit(OP.LOAD, cs, 1);
      return true;
    }
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
          const [, nargs, nret = 1, kind] = FUNCS[f];
          let got = 0;
          if (kind) {   // first argument: a parameter of that kind, passed as its slot number
            const a = peek(), q = a.type === 'id' && params.find((x) => x.name === a.v);
            if (!q || q.type !== kind) throw err(tk.line, `${tk.v}() needs a ${KIND_WORD[kind]} parameter first, like ${tk.v}(${KIND_EXAMPLE[kind]})`);
            next();
            emit(OP.CONST, q.slot, 1);
            got++;
            if (peek().type !== ')') expect(',', "','");
          }
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
        const pq = params.find((q) => q.name === tk.v);
        if (pq?.type === 'color') throw err(tk.line, `'${tk.v}' is a colour: use ${tk.v}.r, ${tk.v}.g or ${tk.v}.b, or r, g, b = ${tk.v}`);
        if (pq?.type === 'gradient') throw err(tk.line, `'${tk.v}' is a colour list: use r, g, b = grad(${tk.v}, k)`);
        if (pq?.type === 'text') throw err(tk.line, `'${tk.v}' is a text: use txt(${tk.v}, px, py) or ${tk.v}.w`);
        if (pq?.type === 'image') throw err(tk.line, `'${tk.v}' is a picture: use img(${tk.v}, x, y, frame), ${tk.v}.w, ${tk.v}.h or ${tk.v}.frames`);
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

  // Letters for txt(): 5 x 7 pixels, ASCII 32..126, 5 bytes per letter (one per column, bit 0 =
  // top row). The same bytes are kFont in Fx.cpp. Other characters show as '?'.
  const FONT = Uint8Array.from((
    '000000000000005f00000007000700147f147f14242a7f2a12231308646236495522500005030000001c2241000041221c00' +
    '14083e081408083e080800503000000808080808006060000020100804023e5149453e00427f400042615149462141454b31' +
    '1814127f1027454545393c4a49493001710905033649494936064949291e0036360000005636000008142241001414141414' +
    '00412214080201510906324979413e7e1111117e7f494949363e414141227f4141221c7f494949417f090909013e4149497a' +
    '7f0808087f00417f41002040413f017f081422417f404040407f020c027f7f0408107f3e4141413e7f090909063e4151215e' +
    '7f09192946464949493101017f01013f4040403f1f2040201f3f4038403f631408146307087008076151494543007f414100' +
    '02040810200041417f0004020102044040404040000102040020545454787f484444383844444420384444487f3854545418' +
    '087e0901020c5252523e7f0804047800447d40002040443d007f1028440000417f40007c041804787c080404783844444438' +
    '7c14141408081414187c7c080404084854545420043f4440203c4040207c1c2040201c3c4030403c44281028440c5050503c' +
    '4464544c44000836410000007f000000413608000804081008').match(/../g).map((h) => parseInt(h, 16)));
  // Gradients, texts and pictures don't fit in a number slot: their data sits in this list and the
  // slot holds its index (the controller keeps the data with each timeline cue instead).
  const DATA = [null], DATA_ID = new Map();
  function dataId(key, make) {
    let id = DATA_ID.get(key);
    if (id == null) {
      if (DATA.length > 4000) { DATA.length = 1; DATA_ID.clear(); }   // a long editing session: start again
      id = DATA.push(make()) - 1;
      DATA_ID.set(key, id);
    }
    return id;
  }
  // Text -> its bytes (UTF-8, as the controller sees it: a letter outside ASCII counts per byte).
  // (Own UTF-8 and base64 code: tools/check-project.js runs this file without the browser's.)
  function utf8(v) {
    const out = [];
    for (const ch of String(v)) {
      const c = ch.codePointAt(0);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return Uint8Array.from(out);
  }
  const textBytes = (v) => utf8(v).slice(0, MAX_TEXT);
  // Base64 -> bytes as the controller reads it (unbase64 in Fx.cpp): padding optional; null when not valid.
  function unbase64(s) {
    let len = s.length, pad = 0;
    while (len && s[len - 1] === '=' && pad < 2) { len--; pad++; }
    if (len % 4 === 1) return null;
    const out = new Uint8Array(Math.floor((len * 6) / 8));
    let acc = 0, bits = 0, o = 0;
    for (let k = 0; k < len; k++) {
      const v = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(s[k]);
      if (v < 0) return null;
      acc = ((acc << 6) | v) & 0xffffff;
      bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
    }
    return out;
  }
  // "img:<w>x<h>x<frames>:<base64 of r g b bytes>" -> { w, h, f, px } (null when it doesn't add up).
  function parseImage(v) {
    const m = /^img:(\d{1,9})x(\d{1,9})x(\d{1,9}):(.*)$/.exec(v || '');
    if (!m) return null;
    const w = +m[1], h = +m[2], f = +m[3];
    if (!w || !h || !f || w * h * f > MAX_IMAGE) return null;
    const px = unbase64(m[4]);
    return px && px.length === w * h * f * 3 ? { w, h, f, px } : null;
  }
  // A colour list's value: "#rrggbb,#rrggbb 0.9,..." -> [{ c, p }] in place order (null when not
  // valid). p = the colour's place 0..1; colours without one are spread evenly by their number in
  // the list (k / (n - 1)), then all are sorted by place, keeping the list order on equal places
  // (= setParam's PGrad branch and fillStops in Fx.cpp).
  function parseStops(v) {
    const items = String(v ?? '').split(',');
    if (items.length > MAX_STOPS) return null;
    const list = [];
    for (const it of items) {
      const m = /^ *(#[0-9a-fA-F]{6})(?: +(\d+(?:\.\d+)?|\.\d+))? *$/.exec(it);
      if (!m || (m[2] != null && parseFloat(m[2]) > 1)) return null;
      list.push({ c: m[1].toLowerCase(), p: m[2] != null ? parseFloat(m[2]) : null });
    }
    return fillStops(list);
  }
  function fillStops(list) {
    const n = list.length;
    list.forEach((x, k) => { if (x.p == null) x.p = n > 1 ? k / (n - 1) : 0; });
    for (let i = 1; i < n; i++) {   // insertion sort: stable, the same steps as the controller
      const x = list[i];
      let j = i - 1;
      while (j >= 0 && list[j].p > x.p) { list[j + 1] = list[j]; j--; }
      list[j + 1] = x;
    }
    return list;
  }
  // grad / txt / img: a = the arguments, the first one being the parameter's slot.
  function special(f, s, a) {
    const at = a[0];
    if (f === 27) {   // grad(list, k): straight blends between the colours at their places
      const cnt = s[at];
      let k = a[1];
      if (!(k > 0)) k = 0;
      if (k > 1) k = 1;
      if (cnt < 1) return [0, 0, 0];
      const last = at + 1 + (cnt - 1) * 4;
      if (cnt < 2 || k <= s[at + 4]) return [s[at + 1], s[at + 2], s[at + 3]];
      if (k >= s[last + 3]) return [s[last], s[last + 1], s[last + 2]];
      let j = 0;
      while (j < cnt - 2 && k >= s[at + 1 + (j + 1) * 4 + 3]) j++;
      const c = at + 1 + j * 4, span = s[c + 7] - s[c + 3], q = span > 0 ? (k - s[c + 3]) / span : 1;
      return [s[c] + (s[c + 4] - s[c]) * q, s[c + 1] + (s[c + 5] - s[c + 1]) * q, s[c + 2] + (s[c + 6] - s[c + 2]) * q];
    }
    if (f === 28) {   // txt(text, px, py)
      const b = DATA[s[at]], px = a[1], py = a[2];
      if (!b || !(px >= 0 && py >= 0 && py < 7 && px < b.length * 6)) return 0;
      const X = Math.floor(px), ci = Math.floor(X / 6), col = X - ci * 6;
      if (col >= 5) return 0;
      let ch = b[ci];
      if (ch < 32 || ch > 126) ch = 63;
      return (FONT[(ch - 32) * 5 + col] >> Math.floor(py)) & 1;
    }
    // img(picture, x, y, frame): the nearest pixel, black outside 0..1
    const im = DATA[s[at]], x = a[1], y = a[2];
    if (!im || !(x >= 0 && x < 1 && y >= 0 && y < 1)) return [0, 0, 0];
    let fr = Math.floor(Number.isFinite(a[3]) ? a[3] : 0);
    fr = fr - im.f * Math.floor(fr / im.f);
    if (!(fr >= 0 && fr < im.f)) fr = 0;
    const k = ((fr * im.h + Math.floor(y * im.h)) * im.w + Math.floor(x * im.w)) * 3;
    return [im.px[k] / 255, im.px[k + 1] / 255, im.px[k + 2] / 255];
  }

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
      } else if (q.type === 'gradient') {
        const list = (typeof v === 'string' && parseStops(v)) || q.stops;
        s[q.slot] = list.length;
        list.forEach((x, j) => {
          for (let k = 0; k < 3; k++) s[q.slot + 1 + j * 4 + k] = parseInt(x.c.slice(1 + k * 2, 3 + k * 2), 16) / 255;
          s[q.slot + 4 + j * 4] = x.p;
        });
      } else if (q.type === 'text') {
        const txt = typeof v === 'string' ? v : q.def;
        const id = dataId('t' + txt, () => textBytes(txt));
        s[q.slot] = id;
        s[q.slot + 1] = DATA[id].length * 6;
      } else if (q.type === 'image') {
        const id = typeof v === 'string' && v ? dataId('i' + v, () => parseImage(v)) : 0, im = DATA[id];
        s[q.slot] = im ? id : 0;
        s[q.slot + 1] = im ? im.w : 0; s[q.slot + 2] = im ? im.h : 0; s[q.slot + 3] = im ? im.f : 0;
      } else s[q.slot] = +v;
    }
    return s;
  }
  // t and the clocks ("t * speed") for one frame, without automation or glides: slots from
  // slotsFor. A program with no clocks only gets t.
  function atTime(prog, s, t) {
    s[0] = t;
    for (const c of prog.clocks || []) s[c.s] = t * s[c.p];
    return s;
  }

  // ---- What a timeline clip plays over time (= the frame part of runEffect in Show.cpp,
  // Fx::frameInputs / Fx::carry in Fx.cpp) ----
  // Automation: a number parameter follows a line through points [ms from the clip's start,
  // value, curve]; curve -1..1 bends the segment to the next point (0 = straight). Before the
  // first point the line holds the first value, after the last the last one. With `wrap`
  // (a looping timeline's length in s, 0 = none) the line starts again every wrap seconds.
  // Each point becomes { t (s), v, e (the segment's exponent: value goes as x^e) }; cum = the
  // area under the line from the first point to each point, per = over one wrap.
  const curveExp = (c) => (c ? Math.pow(2, -2 * Math.max(-1, Math.min(1, c))) : 1);
  function laneFor(slot, list, wrap) {
    const pts = [];
    for (const p of Array.isArray(list) ? list : []) {
      if (!Array.isArray(p) || !Number.isFinite(+p[0]) || !Number.isFinite(+p[1])) continue;
      pts.push({ t: Math.max(0, +p[0]) / 1000, v: +p[1], e: curveExp(+p[2] || 0) });
    }
    if (!pts.length) return null;
    pts.sort((a, b) => a.t - b.t);   // stable: points at the same time keep their order
    const L = { slot, pts, cum: [0], per: 0 };
    for (let j = 0; j + 1 < pts.length; j++) {
      const a = pts[j], b = pts[j + 1];
      L.cum.push(L.cum[j] + (b.t - a.t) * (a.v + (b.v - a.v) / (a.e + 1)));
    }
    if (wrap > 0) L.per = laneArea(L, wrap);
    return L;
  }
  // The line's value at tau (s, already wrapped).
  function laneValue(L, tau) {
    const p = L.pts, n = p.length;
    if (tau <= p[0].t) return p[0].v;
    if (tau >= p[n - 1].t) return p[n - 1].v;
    let j = 0;
    while (tau >= p[j + 1].t) j++;
    const a = p[j], b = p[j + 1], x = (tau - a.t) / (b.t - a.t);
    return a.v + (b.v - a.v) * (a.e === 1 ? x : Math.pow(x, a.e));
  }
  // The area under the line from 0 to tau (s, 0 <= tau, not wrapped).
  function laneArea(L, tau) {
    const p = L.pts, n = p.length;
    if (tau <= p[0].t) return p[0].v * tau;
    const before = p[0].v * p[0].t;
    if (tau >= p[n - 1].t) return before + L.cum[n - 1] + p[n - 1].v * (tau - p[n - 1].t);
    let j = 0;
    while (tau >= p[j + 1].t) j++;
    const a = p[j], b = p[j + 1], len = b.t - a.t, x = (tau - a.t) / len;
    return before + L.cum[j] + len * (a.v * x + ((b.v - a.v) * Math.pow(x, a.e + 1)) / (a.e + 1));
  }
  function laneIntegral(L, tau, wrap) {
    if (!(wrap > 0)) return laneArea(L, tau);
    const q = Math.floor(tau / wrap);
    return q * L.per + laneArea(L, tau - q * wrap);
  }
  const GLIDE = 0.5;   // s: a live edit glides the look to the new values over this
  // A running clip: its values (as slotsFor), its automation (cue "auto": { name: [[ms, v, c], ...] })
  // and what a live edit left to glide (carry). The same for the mock and the previews.
  function runner(prog, values = {}, auto = null, wrap = 0) {
    const lanes = [];
    for (const q of prog.params) {
      if (q.type !== 'num' || !auto || !auto[q.name]) continue;
      const L = laneFor(q.slot, auto[q.name], wrap);
      if (L) lanes.push(L);
    }
    return { prog, base: slotsFor(prog, values), lanes, wrap: wrap > 0 ? wrap : 0, gT0: -1, gOff: [], cOff: (prog.clocks || []).map(() => 0), cG: (prog.clocks || []).map(() => 0) };
  }
  // The slots of one frame at t (s since the clip started): parameters with their automation
  // and glide, t, and the clocks. The fixtures' inputs come on top of this.
  function frame(R, t) {
    const s = Float64Array.from(R.base), tw = R.wrap ? t - R.wrap * Math.floor(t / R.wrap) : t;
    s[0] = t;
    for (const L of R.lanes) s[L.slot] = laneValue(L, tw);
    let k = -1;
    if (R.gT0 >= 0) {
      k = Math.max(0, Math.min(1, (t - R.gT0) / GLIDE));
      const w = (1 - k) * (1 - k);
      for (const [slot, off] of R.gOff) s[slot] += off * w;
    }
    (R.prog.clocks || []).forEach((c, j) => {
      const L = R.lanes.find((x) => x.slot === c.p);
      let v = L ? laneIntegral(L, t, R.wrap) : t * R.base[c.p];
      if (R.cOff[j]) v += R.cOff[j];
      // The glide's share: the area under off * (1 - k)^2 since it began.
      if (k >= 0 && R.cG[j]) v += (R.cG[j] * GLIDE * (1 - (1 - k) ** 3)) / 3;
      s[c.s] = v;
    });
    return s;
  }
  // Which slots glide: numbers, colours, and a colour list's colours while it has as many.
  function glideSlots(prog, a, b) {
    const out = [];
    for (const q of prog.params) {
      if (q.type === 'num') out.push(q.slot);
      else if (q.type === 'color') out.push(q.slot, q.slot + 1, q.slot + 2);
      else if (q.type === 'gradient' && a[q.slot] === b[q.slot]) for (let k = 1; k <= a[q.slot] * 4; k++) out.push(q.slot + k);
    }
    return out;
  }
  // A live edit: the clip `nu` takes over from `old` (the same program on the same track) and
  // starts from what old showed at that moment (tOld / tNew: each one's own t): the values
  // glide over GLIDE seconds, the clocks go on from where they were.
  function carry(old, tOld, nu, tNew) {
    if (!old || !nu || old.prog.names.join() !== nu.prog.names.join()) return false;
    const so = frame(old, tOld);
    nu.gT0 = -1; nu.gOff = []; nu.cOff.fill(0); nu.cG.fill(0);
    const sn = frame(nu, tNew);
    for (const slot of glideSlots(nu.prog, old.base, nu.base)) {
      const d = so[slot] - sn[slot];
      if (d && Number.isFinite(d)) nu.gOff.push([slot, d]);
    }
    if (nu.gOff.length) nu.gT0 = tNew;
    (nu.prog.clocks || []).forEach((c, j) => {
      const d = so[c.s] - sn[c.s];
      nu.cOff[j] = Number.isFinite(d) ? d : 0;
      const g = nu.gOff.find((x) => x[0] === c.p);
      nu.cG[j] = g ? g[1] : 0;
    });
    return true;
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
          const v = a >= 27 ? special(a, s, args) : F[a](...args);
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

  // ---- clip options (a timeline effect cue's "mods") ----
  // They change where a fixture sits for the effect (i, n, x, y) and, for invert, what comes
  // out. The places are worked out once per cue (the controller does it when loading: = place()
  // in Fx.cpp), so they cost nothing per frame.
  //   flip: 'x' | 'y' | 'xy'      run the other way (right to left / bottom to top)
  //   repeat: 2..8                the effect side by side that many times (and along the list)
  //   mirror: 'x' | 'y' | 'xy'    the effect squeezed into one half and mirrored into the other
  //   kaleido: 2..12              kaleidoscope: segments around the middle, each a mirror image
  //   invert: true                dark becomes light and colours their opposite
  function place(m, i, n, x, y) {
    if (!m) return { i, n, x, y };
    if (m.flip === 'x' || m.flip === 'xy') { x = 1 - x; i = n - 1 - i; }
    if (m.flip === 'y' || m.flip === 'xy') y = 1 - y;
    const k = Math.min(8, Math.floor(+m.repeat || 1));   // the controller keeps 1..8 and 0..12
    if (k > 1) {
      const seg = Math.min(Math.floor(x * k), k - 1), per = Math.ceil(n / k);
      x = x * k - seg;
      i %= per;
      n = per;
    }
    if (m.mirror === 'x' || m.mirror === 'xy') {
      const h = Math.ceil(n / 2);
      x = 1 - Math.abs(2 * x - 1);
      i = i < h ? i : n - 1 - i;
      n = h;
    }
    if (m.mirror === 'y' || m.mirror === 'xy') y = 1 - Math.abs(2 * y - 1);
    const ks = Math.min(12, Math.floor(+m.kaleido || 0));
    if (ks >= 2) {
      const dx = x - 0.5, dy = y - 0.5, r = Math.sqrt(dx * dx + dy * dy), seg = (2 * Math.PI) / ks;
      let a = Math.atan2(dy, dx);
      a -= seg * Math.floor(a / seg);
      if (a > seg / 2) a = seg - a;
      x = 0.5 + r * Math.cos(a);
      y = 0.5 + r * Math.sin(a);
    }
    return { i, n, x, y };
  }
  // invert: after the effect ran (s from run), before toFixture.
  function invert(s) {
    const cl = (v) => Math.max(0, Math.min(1, v)), d = cl(s[12]);
    for (let k = 8; k <= 10; k++) s[k] = 1 - cl(s[k]) * d;
    if (s[11] >= 0) s[11] = 1 - cl(s[11]) * d;
    s[12] = 1;
    return s;
  }
  const hasMods = (m) => !!(m && (m.flip || m.mirror || m.invert || +m.repeat > 1 || +m.kaleido >= 2));

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
    { name: 'Palette scroll', group: 'line', code: `// The colours of a colour list rolling along the fixtures
param speed = 0.2 [-2, 2]      // lists passing per second (minus = the other way)
param spread = 1 [0, 4]        // lists across the rig (the map's width)
param pal = #ff0000, #ffcc00, #00c853, #0091ff, #aa00ff   // the colours (2 to 8; change them per timeline clip)
r, g, b = grad(pal, tri((x * spread - t * speed) / 2))` },
    { name: 'Comet', group: 'line', code: `// A light running along the fixtures with a fading tail
param speed = 0.5 [-4, 4]      // rounds per second (minus = the other way)
param tail = 0.3 [0.02, 1]     // length of the tail, part of the rig
param color = #ffffff          // colour of the head
param back = #000000           // colour of the other fixtures
pos = fract(t * speed)
d = speed >= 0 ? fract(pos - u) : fract(u - pos)
k = pow(max(1 - d / tail, 0), 2)
r = mix(back.r, color.r, k)
g = mix(back.g, color.g, k)
b = mix(back.b, color.b, k)` },
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
    { name: 'Palette fade', group: 'all', code: `// The whole rig fading through the colours of a colour list, and back
param speed = 0.1 [0, 2]       // trips through the list and back per second
param offset = 0 [0, 1]        // shift along the rig: 0 = all the same colour
param pal = #ff2d92, #ffb000, #00c7be, #5e5ce6   // the colours (2 to 8; change them per timeline clip)
r, g, b = grad(pal, tri(t * speed + u * offset))` },
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
    { name: 'Palette clouds', group: 'xy', code: `// Soft clouds in the colours of a colour list, drifting over the map
param speed = 0.2 [0, 2]       // how fast the clouds move
param scale = 3 [0.5, 10]      // bigger = more, smaller clouds
param pal = #001a33, #0a84ff, #5ac8fa, #ffffff   // from the darkest part of the clouds to the brightest
v = noise(x * scale + t * speed) * 0.5 + noise(y * scale * 1.3 - t * speed * 0.7 + 50) * 0.3 + noise((x + y) * scale * 2 + t * speed * 1.3 + 100) * 0.2
r, g, b = grad(pal, v)` },
    { name: 'Rain', group: 'xy', code: `// Drops falling down the map, every column on its own (green on black = digital rain)
param speed = 0.6 [0.05, 3]    // falls per second
param columns = 16 [2, 64]     // columns of drops across the map
param length = 0.25 [0.02, 1]  // length of a drop with its tail, part of the map's height
param color = #9fd8ff          // colour of the drops
param back = #000000           // background colour
c = floor(x * columns)
p = fract(t * speed * (0.6 + rand(c * 0.0173) * 0.8) + rand(c * 0.0311)) * (1 + length)
d = p - y
k = d >= 0 && d < length ? pow(1 - d / length, 2) : 0
r = mix(back.r, color.r, k)
g = mix(back.g, color.g, k)
b = mix(back.b, color.b, k)` },
    { name: 'Bursts', group: 'xy', code: `// Rings of colour bursting at random places on the map, like fireworks
param rate = 0.7 [0.1, 4]      // bursts per second
param size = 0.4 [0.05, 1]     // how far a burst spreads, part of the map
param width = 0.06 [0.01, 0.3] // thickness of the ring
param pal = #ff3b30, #ffcc00, #34c759, #0a84ff, #bf5af2   // each burst takes one of these colours
c = floor(t * rate)
ph = fract(t * rate)
cx = 0.15 + rand(c * 0.0231) * 0.7
cy = 0.15 + rand(c * 0.0377 + 0.5) * 0.7
d = sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy))
r, g, b = grad(pal, rand(c * 0.0119 + 0.25))
dim = smoothstep(width, 0, abs(d - ph * size)) * (1 - ph)` },
    { name: 'Starfield', group: 'xy', code: `// Stars streaming out from the middle of the map, like flying through space
param speed = 0.4 [0.05, 2]    // how fast the stars fly
param lanes = 24 [4, 64]       // directions the stars fly in
param color = #ffffff          // colour of the stars
a = atan(y - 0.5, x - 0.5) / tau + 0.5
l = floor(a * lanes)
d = sqrt((x - 0.5) * (x - 0.5) + (y - 0.5) * (y - 0.5)) * 1.42
p = fract(t * speed * (0.5 + rand(l * 0.0137)) + rand(l * 0.0291))
r, g, b = color
dim = smoothstep(0.12, 0, abs(d - p * p)) * p` },
    { name: 'Lava lamp', group: 'xy', code: `// Soft blobs drifting and melting into each other
param speed = 0.15 [0, 1]      // how fast the blobs drift
param size = 0.18 [0.05, 0.5]  // size of the blobs, part of the map
param pal = #1a0033, #ff2d55, #ffcc00   // background, edge of a blob, middle of a blob
s = size * size
ax = 0.5 + 0.32 * sin(t * speed * 3.1)
ay = 0.5 + 0.3 * cos(t * speed * 2.3)
bx = 0.5 + 0.3 * sin(t * speed * 1.7 + 2)
by = 0.5 + 0.32 * sin(t * speed * 2.9 + 1)
cx = 0.5 + 0.28 * cos(t * speed * 2.2 + 4)
cy = 0.5 + 0.28 * sin(t * speed * 1.3 + 3)
f = s / ((x - ax) * (x - ax) + (y - ay) * (y - ay) + 0.001) + s / ((x - bx) * (x - bx) + (y - by) * (y - by) + 0.001) + s / ((x - cx) * (x - cx) + (y - cy) * (y - cy) + 0.001)
r, g, b = grad(pal, smoothstep(0.5, 2, f))` },
    { name: 'Spiral', group: 'xy', code: `// A spiral turning around the middle of the map
param speed = 0.3 [-2, 2]      // turns per second (minus = the other way round)
param arms = 3 [1, 8]          // arms of the spiral
param twist = 4 [-12, 12]      // how tightly it winds (minus = the other way)
param pal = #000000, #00c7be, #ffffff   // colours across each arm
a = atan(y - 0.5, x - 0.5) / tau
d = sqrt((x - 0.5) * (x - 0.5) + (y - 0.5) * (y - 0.5))
r, g, b = grad(pal, tri(a * floor(arms) + d * twist - t * speed))` },
    { name: 'Checkerboard', group: 'xy', code: `// Squares in two colours that swap over and over
param cells = 4 [1, 16]        // squares across the map
param rate = 0.5 [0, 4]        // swaps per second
param fade = 0.3 [0, 1]        // 0 = hard swap, 1 = slow fade
param c1 = #ffffff             // first colour
param c2 = #000000             // second colour
q = mod(floor(x * cells) + floor(y * cells), 2)
k = smoothstep(0.5 - fade / 2, 0.5 + fade / 2 + 0.0001, tri(t * rate / 2))
k2 = q > 0 ? k : 1 - k
r = mix(c1.r, c2.r, k2)
g = mix(c1.g, c2.g, k2)
b = mix(c1.b, c2.b, k2)` },
    { name: 'Aurora', group: 'xy', code: `// Slow curtains of light waving across the top of the map (northern lights)
param speed = 0.15 [0, 1]      // how fast the curtains move
param height = 0.5 [0.1, 1]    // how far down the curtains hang, part of the map
param pal = #00ff9c, #00c7be, #7d5cff, #ff2d92   // colours along the curtains
w = noise(x * 3 + t * speed) * 0.6 + noise(x * 7 - t * speed * 1.7) * 0.4
edge = 0.1 + w * 0.3
k = smoothstep(edge + height, edge, y) * smoothstep(edge - 0.05, edge + 0.05, y)
r, g, b = grad(pal, tri(x * 0.7 + w + t * speed * 0.2))
dim = k * (0.4 + 0.6 * noise(x * 11 + t * speed * 3))` },
    { name: 'Equalizer', group: 'xy', code: `// Bars going up and down like a music level meter
param speed = 2 [0.2, 8]       // how fast the bars move
param bars = 8 [2, 32]         // bars across the map
param pal = #30d158, #ffd60a, #ff453a   // colours from the bottom to the top
c = floor(x * bars)
lvl = noise(t * speed + c * 13.7) * 0.8 + noise(t * speed * 2.3 + c * 5.1) * 0.2
h = 1 - y
r, g, b = grad(pal, h)
dim = h <= lvl` },
    { name: 'Scrolling text', group: 'pic', code: `// Text running across a pixel grid (LED matrix), like a news ticker
param msg = "WELCOME"          // the text: letters, digits and punctuation (accents are left off)
param speed = 10 [-60, 60]     // LEDs per second (minus = to the right, 0 = standing still in the middle)
param cols = 32 [4, 256]       // LEDs across your matrix (the map's long side): letters then land on whole LEDs
param zoom = 1 [1, 4]          // letter size: 1 = one LED per letter pixel (7 LEDs high), 2 = twice as big
param ypos = 0.5 [0, 1]        // where the line is: 0 = top, 1 = bottom
param smooth = 1 [0, 1]        // 1 = glides evenly (letters a little soft while moving), 0 = jumps a whole LED at a time
param color = #ffffff          // colour of the letters
param back = #000000           // background colour
z = max(floor(zoom), 1)
ps = z / cols
vw = cols / z
sp = mod(t * speed / z, msg.w + vw)
p = speed == 0 ? floor(vw / 2 + msg.w / 2) : smooth >= 0.5 ? sp : floor(sp)
// where this LED is in the text, in letter pixels; between pixels the four around it blend
fx0 = x / ps - vw + p - 0.5
fy0 = (y - ypos) / ps + 3.5
ax = floor(fx0)
ay = floor(fy0)
qx = fx0 - ax
qy = fy0 - ay
k0 = mix(txt(msg, ax + 0.5, ay + 0.5), txt(msg, ax + 1.5, ay + 0.5), qx)
k1 = mix(txt(msg, ax + 0.5, ay + 1.5), txt(msg, ax + 1.5, ay + 1.5), qx)
k = mix(k0, k1, qy)
r = mix(back.r, color.r, k)
g = mix(back.g, color.g, k)
b = mix(back.b, color.b, k)` },
    { name: 'Picture', group: 'pic', code: `// A picture or animated GIF on the fixtures, by their place on the map (choose it per timeline clip)
param pic = image              // the picture: choose one here to try it, and on each timeline clip
param fps = 10 [0, 30]         // frames per second of an animated GIF
param zoom = 1 [0.1, 4]        // 1 = the picture fills the map, 2 = twice as big
param speed = 0 [-1, 1]        // scroll sideways, picture widths per second (0 = still)
param tile = 1 [0, 1]          // 1 = repeat the picture next to itself, 0 = black around it
px = (x - 0.5) / zoom + 0.5 - t * speed
py = (y - 0.5) / zoom + 0.5
qx = tile >= 0.5 ? fract(px) : px
qy = tile >= 0.5 ? fract(py) : py
r, g, b = img(pic, qx, qy, t * fps)` },
  ];
  const GROUPS = { line: 'Along the fixtures (list order)', all: 'Whole rig / per fixture', xy: 'XY: over the map', pic: 'Text and pictures (pixel grids)' };

  const api = { compile, run, slotsFor, atTime, runner, frame, carry, laneFor, laneValue, laneIntegral, curveExp, GLIDE, toFixture, place, invert, hasMods, parseStops, parseImage, TEMPLATES, GROUPS, INPUTS, OUTPUTS, FUNCS, FDOC,
    FONT, MAX_STOPS, MAX_TEXT, MAX_IMAGE, rand, noise, hsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KDFX = api;
})(typeof window !== 'undefined' ? window : globalThis);
