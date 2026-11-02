// Builds data/www/fixture-library.json from the Open Fixture Library (MIT licence,
// https://github.com/OpenLightingProject/open-fixture-library), using the same converter as the
// web UI's import (data/www/fixture-lib.js).
//   node tools/build-fixture-lib.js <path to open-fixture-library/fixtures>
// Download the library as a zip from GitHub and point this at its "fixtures" folder.
'use strict';
const fs = require('fs');
const path = require('path');
const KDLib = require(path.join(__dirname, '..', 'data', 'www', 'fixture-lib.js'));

const dir = process.argv[2];
if (!dir || !fs.existsSync(path.join(dir, 'manufacturers.json'))) {
  console.error('Usage: node tools/build-fixture-lib.js <open-fixture-library/fixtures>');
  process.exit(1);
}
const makers = JSON.parse(fs.readFileSync(path.join(dir, 'manufacturers.json'), 'utf8'));
const out = [];
let skipped = 0;
for (const key of Object.keys(makers).filter((k) => !k.startsWith('$')).sort()) {
  if (key === 'generic') continue;   // our own generic types cover these
  const folder = path.join(dir, key);
  if (!fs.existsSync(folder)) continue;
  for (const file of fs.readdirSync(folder).filter((f) => f.endsWith('.json')).sort()) {
    try {
      const fx = JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
      if (fx.$schema && /redirect/.test(fx.$schema)) continue;   // renamed fixture
      const t = KDLib.fromOFL(fx, makers[key].name);
      if (!t.modes.length) { skipped++; continue; }
      const text = KDLib.toText(t);
      const back = KDLib.parse(text);
      if (back.errors.length) { console.warn(`${key}/${file}: ${back.errors[0].msg}`); skipped++; continue; }
      out.push(text);
    } catch (e) {
      console.warn(`${key}/${file}: ${e.message}`);
      skipped++;
    }
  }
}
const target = path.join(__dirname, '..', 'data', 'www', 'fixture-library.json');
fs.writeFileSync(target, JSON.stringify({
  source: 'Open Fixture Library (open-fixture-library.org), MIT licence. Check DMX charts against the fixture manual.',
  built: new Date().toISOString().slice(0, 10),
  text: out.join('\n\n'),
}));
console.log(`${out.length} fixture types written to ${target} (${(fs.statSync(target).size / 1024).toFixed(0)} KB), ${skipped} skipped`);
