// Checks a project the way the web UI does, without a browser:
//  - every base effect in fx.js and every effect in the project compiles, and runs on a
//    test fixture without NaN or errors;
//  - every trigger: the problems the Triggers page marks with a red ! (actions and conditions
//    checked with the command grammar of app-grammar.js, missing references etc.);
//  - every mode group: its states' start / end actions, power-up state and variable.
// Usage: node tools/check-project.js [path/to/project.json]   (default data/show/project.json)
// Exit code 1 when an effect fails (trigger problems are reported, not fatal: they are
// often half-finished work in the project).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const WWW = path.join(__dirname, '..', 'data', 'www');
const file = process.argv[2] || path.join(__dirname, '..', 'data', 'show', 'project.json');
const project = JSON.parse(fs.readFileSync(file, 'utf8'));

// A stand-in for the browser: any DOM call returns something harmless, so the UI files
// can be loaded (their page code only runs when a page is shown).
const dummy = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'length' ? 0 : k === Symbol.iterator ? [][Symbol.iterator] : dummy),
  apply: () => dummy,
  construct: () => dummy,
  set: () => true,
});
const ctx = { console, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0,
  document: dummy, localStorage: { getItem: () => null, setItem() {} }, location: dummy, navigator: dummy, EventSource: function () {},
  fetch: () => new Promise(() => {}), alert() {}, confirm: () => false, prompt: () => null, getComputedStyle: () => dummy,
  matchMedia: () => dummy, ResizeObserver: function () { return dummy; }, addEventListener() {}, removeEventListener() {},
  innerWidth: 1600, innerHeight: 900 };
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
// Same files and order as index.html, without app-main.js (that one boots the page).
const files = ['fx.js', 'model.js', 'fixture-lib.js', 'panel-ui.js', 'app-core.js', 'app-grammar.js', 'app-rig.js', 'app-library.js',
  'app-show.js', 'app-triggers.js', 'app-trigger-tools.js', 'app-system.js', 'app-drivers.js'];
// The scripts share one scope through top-level const/let, so they run as one script.
vm.runInContext(files.map((f) => fs.readFileSync(path.join(WWW, f), 'utf8')).join('\n;\n'), ctx, { filename: 'ui.js' });
vm.runInContext('S.project = normalize(__project)', Object.assign(ctx, { __project: project }));

let failed = 0;
const out = (s) => console.log(s);

// ---- Effects ----
const FX = ctx.KDFX;
const IN = Object.fromEntries(FX.INPUTS.map((k, i) => [k, i]));   // input slots: t i n u x y ...
function tryEffect(label, code) {
  try {
    const prog = FX.compile(code);
    if (prog.error) throw new Error(`line ${prog.error.line}: ${prog.error.msg}`);
    // A few times, on fixture 2 of 4 at the middle of the map.
    for (const t of [0, 0.37, 2.5, 61]) {
      const s = FX.slotsFor(prog);
      Object.assign(s, { [IN.t]: t, [IN.i]: 1, [IN.n]: 4, [IN.u]: 0.25, [IN.x]: 0.5, [IN.y]: 0.5 });
      FX.run(prog, s);
      if (s.some((x) => Number.isNaN(x))) throw new Error(`NaN at t=${t}`);
    }
  } catch (e) {
    failed++;
    out(`  FAIL ${label}: ${e.message}`);
  }
}
out('Effects');
let n = 0;
for (const t of FX.TEMPLATES) { tryEffect(`base effect '${t.name}'`, t.code); n++; }
for (const e of project.effects || []) { tryEffect(`project effect ${e.id} '${e.name}'`, e.code || ''); n++; }
out(`  ${n} effect(s) checked`);

// ---- Triggers ----
out('Triggers');
const problems = vm.runInContext('P().triggers.map((t) => [t.id, t.name || "", triggerProblems(t)])', ctx);
let bad = 0;
for (const [id, name, list] of problems) {
  if (!list.length) continue;
  bad++;
  out(`  #${id} ${name}`);
  for (const p of list) out(`      ${p}`);
}
out(`  ${problems.length} trigger(s) checked, ${bad} with problems`);

// ---- Mode groups (state actions, power-up state, variable) ----
out('Mode groups');
const modeProbs = vm.runInContext('P().modes.map((g) => [g.name, modeProblems(g)])', ctx);
for (const [name, list] of modeProbs) if (list.length) { out(`  ${name}`); for (const p of list) out(`      ${p}`); }
out(`  ${modeProbs.length} group(s) checked, ${modeProbs.filter(([, l]) => l.length).length} with problems`);

process.exit(failed ? 1 : 0);
