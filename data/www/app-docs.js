'use strict';
// KD Designer web UI - documents on maps: draw.io schematics, PDFs, images, text and Office
// files kept with the show (show/media/, like map backgrounds) and listed per map:
// m.docs = [{name, file, x, y}] (x/y 0..1 = pinned on the map; none = only in the map's list).
// UI-only: the firmware drops maps after loading. The files go along in a .kdshow
// (showMediaNames in app-system.js = mediaNames in tools/launcher.js).
// The viewer (openDoc) shows them in the browser without internet: .drawio files are drawn by
// a small renderer here (shapes, text, connectors - not draw.io's stencil libraries), images /
// .drawio.svg / .drawio.png as they are, PDFs in the browser's own viewer.

const DOC_EXT = /\.(drawio\.svg|drawio\.png|drawio|dio|xml|pdf|png|jpe?g|webp|gif|svg|txt|md|csv|docx|xlsx|pptx)$/i;
const DOC_ACCEPT = '.drawio,.dio,.xml,.pdf,.png,.jpg,.jpeg,.webp,.gif,.svg,.txt,.md,.csv,.docx,.xlsx,.pptx';
const DOC_MAX = 16 * 1048576;
// [kind, name, badge, colour] by the file's extension.
function docType(file) {
  const f = String(file || '').toLowerCase();
  if (/\.drawio\.(svg|png)$/.test(f)) return ['image', 'draw.io picture', 'DIO', '#f08705'];
  if (/\.(drawio|dio|xml)$/.test(f)) return ['drawio', 'draw.io', 'DIO', '#f08705'];
  if (f.endsWith('.pdf')) return ['pdf', 'PDF', 'PDF', '#e5484d'];
  if (/\.(png|jpe?g|webp|gif|svg)$/.test(f)) return ['image', 'Image', 'IMG', '#3e9bd6'];
  if (/\.(txt|md|csv)$/.test(f)) return ['text', f.endsWith('.csv') ? 'CSV table' : 'Text', 'TXT', '#8a96a3'];
  if (f.endsWith('.docx')) return ['office', 'Word', 'DOC', '#2b6cd4'];
  if (f.endsWith('.xlsx')) return ['office', 'Excel', 'XLS', '#1f9d55'];
  if (f.endsWith('.pptx')) return ['office', 'PowerPoint', 'PPT', '#d0582c'];
  return ['office', 'File', 'FILE', '#8a96a3'];
}
const docIcon = (file) => {
  const [, , b, c] = docType(file);
  return `<svg class="doc-ic" viewBox="0 0 20 24" width="16" height="19"><path d="M2 1h11l5 5v17H2z" fill="var(--panel2)" stroke="${c}" stroke-width="1.5" stroke-linejoin="round"/><path d="M13 1v5h5" fill="none" stroke="${c}" stroke-width="1.5" stroke-linejoin="round"/>
    <rect x="0" y="12" width="20" height="8" rx="1.5" fill="${c}"/><text x="10" y="18.3" text-anchor="middle" font-size="${b.length > 3 ? 5 : 6.2}" font-weight="700" fill="#fff" font-family="sans-serif">${b}</text></svg>`;
};
const docUrl = (d) => '/media/' + encodeURIComponent(d.file);
const docDownloadName = (d) => {
  const ext = d.file.match(DOC_EXT)?.[0] || '';
  return (d.name || 'document').replace(/[\\/:*?"<>|]/g, '-') + (d.name?.toLowerCase().endsWith(ext.toLowerCase()) ? '' : ext);
};
const docsOf = (m) => (m?.docs || []).filter((d) => d?.file);
const docPinned = (d) => d.x != null && d.y != null;

// ---- Map page -------------------------------------------------------------------------------
// The selected document (pin and list row): S.mapDocSel = 'mapId:index'.
const docSelIdx = (m) => {
  const [mid, i] = String(S.mapDocSel ?? '').split(':');
  return m && +mid === m.id && m.docs?.[+i] ? +i : -1;
};
function mapDocPinsHtml(m, editing) {
  const sel = editing ? docSelIdx(m) : -1;
  return (m.docs || []).map((d, i) => (d?.file && docPinned(d)
    ? `<div class="mdoc${i === sel ? ' sel' : ''}${mapEdge(d.x)}" data-mdoc="${i}" style="left:${d.x * 100}%;top:${d.y * 100}%" title="${esc(d.name)} · ${docType(d.file)[1]}${editing ? '\nDouble-click to open' : '\nClick to open'}">
      <span class="box">${docIcon(d.file)}</span>${m.labels !== false ? `<span class="lbl">${esc(d.name)}</span>` : ''}</div>` : '')).join('');
}
// The left column's Documents list (S.mapSide 'docs').
function mapDocsSideHtml(m) {
  const sel = docSelIdx(m);
  return `<p class="muted" style="margin:0 0 6px">Schematics, manuals and other files for this map: draw.io (.drawio), PDF, images, text, Word / Excel / PowerPoint. Click to select, double-click to open, drag onto the map to pin it there. ● = pinned.</p>
    <div class="list map-docs">${(m.docs || []).map((d, i) => (d?.file ? `<div class="item${i === sel ? ' sel' : ''}" data-mapdoc="${i}" title="${esc(docType(d.file)[1])} · ${esc(d.file)}">
      <span class="placed${docPinned(d) ? ' on' : ''}">${docPinned(d) ? '●' : '○'}</span>${docIcon(d.file)}<span style="flex:1">${esc(d.name)}</span><span class="muted">${esc(docType(d.file)[1])}</span></div>` : '')).join('')
      || '<span class="muted">No documents on this map yet.</span>'}</div>
    <div class="row" style="margin-top:8px"><label class="btn small" title="Up to 16 MB each, kept on the storage device with the show">+ Add documents…<input type="file" id="mapDocAdd" accept="${DOC_ACCEPT}" multiple hidden></label></div>
    <p class="muted keys">draw.io files show as a simple drawing (shapes, text and lines; icons from draw.io's libraries as boxes). For the exact picture, save it in draw.io as <b>.drawio.svg</b> (File › Export as › SVG, with "Include a copy of my diagram"): it still opens for editing in draw.io.</p>`;
}
function mapDocSelBar(m) {
  const i = docSelIdx(m), d = m.docs?.[i];
  if (!d) return '';
  return `<div class="map-selbar"><span class="dev-sel">${docIcon(d.file)}</span>
    <input id="mapDocName" value="${esc(d.name)}" title="Name shown on the map" style="width:200px">
    <span class="muted">${esc(docType(d.file)[1])}${docPinned(d) ? '' : ' · not pinned: drag it from the list onto the map'}</span>
    <button class="btn small" id="mapDocOpen" title="Enter">Open</button>
    <a class="btn small" href="${docUrl(d)}" download="${esc(docDownloadName(d))}">Download</a>
    <label class="btn small" title="Put a new version of the file in its place (same name and pin)">Replace…<input type="file" id="mapDocReplace" accept="${DOC_ACCEPT}" hidden></label>
    ${docPinned(d) ? '<button class="btn small" id="mapDocUnpin" title="Take the pin off the map; the document stays in the list">Unpin</button>' : ''}
    <button class="btn small ghost" id="mapDocDel" title="Del: deletes the document from the show">Delete</button></div>`;
}
// Uploads a file to the stick; returns the stored file name.
async function docUpload(m, file) {
  if (file.size > DOC_MAX) throw new Error(`${file.name}: too big (max 16 MB)`);
  const ext = file.name.match(DOC_EXT)?.[0].toLowerCase();
  if (!ext) throw new Error(`${file.name}: this kind of file can't go on a map`);
  const base = file.name.slice(0, -ext.length).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'doc';
  const head = `doc${m.id}-${Date.now().toString(36)}${Math.floor(Math.random() * 36).toString(36)}-`;
  const name = head + base.slice(0, 64 - head.length - ext.length) + ext;
  const j = await (await fetch(`/api/media?name=${encodeURIComponent(name)}`, { method: 'PUT', body: file })).json();
  if (!j.ok) throw new Error(`${file.name}: ${j.reply}`);
  return name;
}
const docTitle = (fileName) => fileName.replace(DOC_EXT, '') || fileName;
function wireMapDocs(canvas, m, snap, snapY, at, editing) {
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const inside = (ev) => { const r = canvas.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom; };
  const select = (i) => { S.mapDocSel = i == null ? null : `${m.id}:${i}`; };
  // Pins on the map: drag to move, click selects, double-click opens. Not while drawing shapes
  // or placing rooms (they are faded and can't be clicked then, like devices).
  if (editing) {
    canvas.addEventListener('pointerdown', (e) => { if (S.mapDocSel && !e.target.closest('.mdoc')) S.mapDocSel = null; });
    $$('.mdoc', canvas).forEach((el) => {
      el.addEventListener('dblclick', (e) => { e.stopPropagation(); const d = m.docs[+el.dataset.mdoc]; if (d) openDoc(d); });
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const d = m.docs[+el.dataset.mdoc];
        if (!d) return;
        S.mapSel.clear();
        S.mapDevSel = null;
        el.setPointerCapture(e.pointerId);
        const start = at(e), o = { x: d.x, y: d.y };
        let moved = false;
        const move = (ev) => {
          const pt = at(ev), dx = pt.x - start.x, dy = pt.y - start.y;
          if (!moved && Math.hypot(dx, dy) < 0.004) return;
          moved = true;
          d.x = clamp01(snap(o.x + dx));
          d.y = clamp01(snapY(o.y + dy));
          el.style.left = d.x * 100 + '%';
          el.style.top = d.y * 100 + '%';
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', () => {
          el.removeEventListener('pointermove', move);
          const was = S.mapDocSel;
          select(+el.dataset.mdoc);
          if (moved) markDirty();
          // A second click on a selected pin doesn't redraw: the double-click still lands.
          if (moved || was !== S.mapDocSel) render();
        }, { once: true });
      });
    });
  }
  // List rows: click selects, double-click opens, drag onto the map pins it.
  $$('[data-mapdoc]').forEach((row) => {
    row.addEventListener('dblclick', () => { const d = m.docs[+row.dataset.mapdoc]; if (d) openDoc(d); });
    row.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const i = +row.dataset.mapdoc, d = m.docs[i];
      let ghost = null;
      const move = (ev) => {
        if (!ghost && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
        if (!ghost) {
          ghost = document.createElement('div');
          ghost.className = 'map-ghost';
          ghost.textContent = d.name;
          document.body.appendChild(ghost);
        }
        ghost.style.left = ev.clientX / uiZoom() + 'px';
        ghost.style.top = ev.clientY / uiZoom() + 'px';
      };
      const up = (ev) => {
        document.removeEventListener('pointermove', move);
        const was = S.mapDocSel;
        if (ghost) {
          ghost.remove();
          if (inside(ev) && editing) {
            const pt = at(ev);
            d.x = clamp01(snap(pt.x));
            d.y = clamp01(snapY(pt.y));
            markDirty();
          }
        }
        S.mapSel.clear();
        S.mapDevSel = null;
        select(i);
        if (ghost || was !== S.mapDocSel) render();
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up, { once: true });
    });
  });
  $('#mapDocAdd')?.addEventListener('change', async (e) => {
    const files = [...e.target.files];
    let added = 0;
    for (const f of files) {
      try {
        const file = await docUpload(m, f);
        (m.docs = m.docs || []).push({ name: docTitle(f.name), file });
        added++;
      } catch (err) { toast('Upload failed: ' + err.message, true); }
    }
    if (!added) return;
    select(m.docs.length - 1);
    markDirty();
    render();
    toast(`${added} document${added > 1 ? 's' : ''} uploaded - save the project to keep ${added > 1 ? 'them' : 'it'} on the map`);
  });
  const d = m.docs?.[docSelIdx(m)];
  if (!d) return;
  $('#mapDocName')?.addEventListener('change', (e) => { d.name = e.target.value.trim() || docTitle(d.file); markDirty(); render(); });
  $('#mapDocOpen')?.addEventListener('click', () => openDoc(d));
  $('#mapDocUnpin')?.addEventListener('click', () => { delete d.x; delete d.y; markDirty(); render(); });
  $('#mapDocDel')?.addEventListener('click', () => mapDocDelete(m));
  $('#mapDocReplace')?.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const file = await docUpload(m, f);
      S.mediaTrash.add(d.file);   // deleted once the project is saved (if nothing else uses it)
      d.file = file;
      markDirty();
      render();
      toast('New version uploaded - save the project to keep it');
    } catch (err) { toast('Upload failed: ' + err.message, true); }
  });
}
function mapDocDelete(m) {
  const i = docSelIdx(m), d = m.docs?.[i];
  if (!d || !confirm(`Delete "${d.name}" from the show?`)) return;
  S.mediaTrash.add(d.file);
  m.docs.splice(i, 1);
  if (!m.docs.length) delete m.docs;
  S.mapDocSel = null;
  markDirty();
  render();
}
// Map page keys while a document is selected: arrows nudge its pin, Enter opens, Del deletes.
// Returns true when the key was for it.
function mapDocKeys(e, m) {
  const d = m.docs?.[docSelIdx(m)];
  if (!d) return false;
  const st = e.shiftKey ? 0.025 : 0.005;
  const v = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
  if (v && docPinned(d)) { e.preventDefault(); d.x = Math.max(0, Math.min(1, d.x + v[0])); d.y = Math.max(0, Math.min(1, d.y + v[1])); markDirty(); render(); return true; }
  if (e.key === 'Enter') { e.preventDefault(); openDoc(d); return true; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); mapDocDelete(m); return true; }
  if (e.key === 'Escape') { S.mapDocSel = null; render(); return true; }
  return false;
}

// ---- Viewer ---------------------------------------------------------------------------------
function openDoc(d) {
  $('.doc-ov')?.remove();
  const [kind, typeName] = docType(d.file), url = docUrl(d);
  const ov = document.createElement('div');
  ov.className = 'doc-ov';
  ov.innerHTML = `<div class="doc-win"><div class="row doc-head">${docIcon(d.file)}<b class="doc-title">${esc(d.name)}</b><span class="muted">${esc(typeName)}</span>
      <span class="seg doc-pages"></span><span style="flex:1"></span>
      <span class="doc-zoom" hidden><button class="btn small" data-dz="out" title="Zoom out (-)">−</button><button class="btn small" data-dz="fit" title="Show all of it (0)">Fit</button><button class="btn small" data-dz="in" title="Zoom in (+)">+</button></span>
      ${kind === 'pdf' || kind === 'image' ? `<a class="btn small" href="${url}" target="_blank" rel="noopener">Open in new tab</a>` : ''}
      <a class="btn small" href="${url}" download="${esc(docDownloadName(d))}">Download</a>
      <button class="btn small ghost" data-dz="close" title="Esc">✕ Close</button></div>
    <div class="doc-body"><p class="muted" style="padding:16px">Loading…</p></div></div>`;
  document.body.appendChild(ov);
  const body = ov.querySelector('.doc-body');
  let zoom = null;
  const close = () => { ov.remove(); window.removeEventListener('keydown', keys, true); };
  // Keys go to the viewer while it is open (not to the page underneath).
  const keys = (e) => {
    if (e.key === 'Escape') close();
    else if (zoom && (e.key === '+' || e.key === '=')) zoom.step(1.25);
    else if (zoom && e.key === '-') zoom.step(0.8);
    else if (zoom && e.key === '0') zoom.fit();
    else return e.stopPropagation();
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('keydown', keys, true);
  ov.addEventListener('click', (e) => {
    if (e.target === ov) return close();
    const z = e.target.closest('[data-dz]')?.dataset.dz;
    if (z === 'close') close();
    else if (zoom && z) z === 'fit' ? zoom.fit() : zoom.step(z === 'in' ? 1.25 : 0.8);
  });
  const fail = (msg) => { body.innerHTML = `<div class="doc-msg"><p class="bad">${esc(msg)}</p></div>`; };
  const showSvg = (inner, box, paper) => {
    ov.querySelector('.doc-zoom').hidden = false;
    body.innerHTML = `<svg class="doc-svg${paper ? ' paper' : ''}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
    zoom = docPanZoom(body.firstChild, box);
  };
  if (kind === 'pdf') body.innerHTML = `<iframe class="doc-frame" src="${url}" title="${esc(d.name)}"></iframe>`;
  else if (kind === 'office') body.innerHTML = `<div class="doc-msg"><p>${esc(typeName)} files open in their own program: download it, or open it from the show's <code>media</code> folder.</p>
    <p><a class="btn" href="${url}" download="${esc(docDownloadName(d))}">Download ${esc(docDownloadName(d))}</a></p></div>`;
  else if (kind === 'image') {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 1000, h = img.naturalHeight || 750;
      showSvg(`<image href="${url}" x="0" y="0" width="${w}" height="${h}"/>`, { x: 0, y: 0, w, h });
    };
    img.onerror = () => fail('The file could not be loaded (is it still on the storage device?).');
    img.src = url;
  } else {
    fetch(url).then((r) => { if (!r.ok) throw new Error('The file could not be loaded (is it still on the storage device?).'); return r.text(); }).then(async (text) => {
      if (kind === 'text') { body.innerHTML = `<pre class="doc-text">${esc(text.length > 2e6 ? text.slice(0, 2e6) + '\n…' : text)}</pre>`; return; }
      const pages = await drawioPages(text);
      if (!pages.length) throw new Error('No diagram found in this file.');
      const tabs = ov.querySelector('.doc-pages');
      const show = (k) => {
        const r = drawioSvg(pages[k].model);
        showSvg(r.svg, r.box, true);
        tabs.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', j === k));
      };
      if (pages.length > 1) {
        tabs.innerHTML = pages.map((pg, k) => `<button data-dpage="${k}">${esc(pg.name)}</button>`).join('');
        tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-dpage]'); if (b) show(+b.dataset.dpage); });
      }
      show(0);
    }).catch((err) => fail(err.message));
  }
}
// Mouse wheel zooms round the pointer, dragging moves, Fit shows all of it (viewBox changes:
// the drawing stays sharp at any zoom).
function docPanZoom(svg, box) {
  const pad = Math.max(box.w, box.h) * 0.03;
  let vb = null;
  const set = () => svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const fit = () => {
    const r = svg.getBoundingClientRect(), a = r.width / Math.max(1, r.height);
    let w = box.w + 2 * pad, h = box.h + 2 * pad;
    if (w / h < a) w = h * a; else h = w / a;
    vb = { x: box.x + box.w / 2 - w / 2, y: box.y + box.h / 2 - h / 2, w, h };
    set();
  };
  const zoomAt = (f, fx = 0.5, fy = 0.5) => {
    const w = Math.max(box.w / 200, Math.min((box.w + 2 * pad) * 20, vb.w / f)), k = w / vb.w;
    vb = { x: vb.x + vb.w * fx * (1 - k), y: vb.y + vb.h * fy * (1 - k), w, h: vb.h * k };
    set();
  };
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }, { passive: false });
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('panning');
    const r = svg.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, o = { ...vb };
    const move = (ev) => { vb = { ...o, x: o.x - ((ev.clientX - x0) / r.width) * o.w, y: o.y - ((ev.clientY - y0) / r.height) * o.h }; set(); };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', () => { svg.removeEventListener('pointermove', move); svg.classList.remove('panning'); }, { once: true });
  });
  fit();
  new ResizeObserver(() => fit()).observe(svg);
  return { fit, step: (f) => zoomAt(f) };
}

// ---- draw.io files --------------------------------------------------------------------------
// A .drawio file is <mxfile> with a <diagram> per page; each page's <mxGraphModel> is either
// written out or compressed (base64 of raw deflate of the URI-encoded XML).
async function drawioPages(text) {
  const parse = (t) => {
    const doc = new DOMParser().parseFromString(t, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('This is not a draw.io file (the XML could not be read).');
    return doc;
  };
  const doc = parse(text), diagrams = [...doc.getElementsByTagName('diagram')], pages = [];
  if (!diagrams.length) {
    const g = doc.getElementsByTagName('mxGraphModel')[0];
    return g ? [{ name: 'Page 1', model: g }] : [];
  }
  for (const [k, dg] of diagrams.entries()) {
    let model = dg.getElementsByTagName('mxGraphModel')[0];
    const packed = !model && dg.textContent.trim();
    if (packed) {
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser is too old to open compressed draw.io files.');
      const bin = Uint8Array.from(atob(packed), (c) => c.charCodeAt(0));
      let xml = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
      try { xml = decodeURIComponent(xml); } catch { /* not URI-encoded */ }
      model = parse(xml).getElementsByTagName('mxGraphModel')[0];
    }
    if (model) pages.push({ name: dg.getAttribute('name') || `Page ${k + 1}`, model });
  }
  return pages;
}
// "rounded=1;fillColor=#fff" -> {rounded: '1', fillColor: '#fff'}; a first word without '='
// is the base style ('ellipse', 'text', 'swimlane' …).
function drawioStyle(s) {
  const st = {};
  String(s || '').split(';').forEach((part, k) => {
    if (!part) return;
    const at = part.indexOf('=');
    if (at < 0) { if (k === 0) st._base = part; else st[part] = '1'; } else st[part.slice(0, at)] = part.slice(at + 1);
  });
  return st;
}
// Draws one page of a draw.io diagram as SVG markup: { svg, box } (box = what it covers).
// Coordinates are draw.io's own (pixels); a child of a group/container is placed inside it.
function drawioSvg(model) {
  const root = model.getElementsByTagName('root')[0];
  const cells = new Map(), order = [];
  for (const el of root ? [...root.children] : []) {
    const c = el.tagName === 'mxCell' ? el : el.getElementsByTagName('mxCell')[0];
    if (!c) continue;
    const id = el.getAttribute('id') ?? c.getAttribute('id');
    const g = [...c.children].find((x) => x.tagName === 'mxGeometry');
    const pt = (as) => { const p = g && [...g.children].find((x) => x.tagName === 'mxPoint' && x.getAttribute('as') === as); return p && { x: +p.getAttribute('x') || 0, y: +p.getAttribute('y') || 0 }; };
    const arr = g && [...g.children].find((x) => x.tagName === 'Array' && x.getAttribute('as') === 'points');
    const cell = {
      id, parent: c.getAttribute('parent'), vertex: c.getAttribute('vertex') === '1', edge: c.getAttribute('edge') === '1',
      source: c.getAttribute('source'), target: c.getAttribute('target'), visible: c.getAttribute('visible') !== '0',
      st: drawioStyle(c.getAttribute('style')), label: (el === c ? c.getAttribute('value') : el.getAttribute('label')) || '',
      geo: g && { x: +g.getAttribute('x') || 0, y: +g.getAttribute('y') || 0, w: +g.getAttribute('width') || 0, h: +g.getAttribute('height') || 0,
        rel: g.getAttribute('relative') === '1', points: arr ? [...arr.children].map((p) => ({ x: +p.getAttribute('x') || 0, y: +p.getAttribute('y') || 0 })) : [],
        sp: pt('sourcePoint'), tp: pt('targetPoint'), off: pt('offset') },
    };
    cells.set(id, cell);
    order.push(cell);
  }
  // A hidden layer hides what is on it.
  const shown = (c) => { for (let x = c, n = 0; x && n < 50; x = cells.get(x.parent), n++) if (!x.visible) return false; return true; };
  // Where a cell's own coordinates start: the top-left of the vertex it sits in, if any.
  const originOf = (c) => {
    const par = cells.get(c.parent);
    return par?.vertex && par.geo ? (() => { const b = boxOf(par); return { x: b.x, y: b.y }; })() : { x: 0, y: 0 };
  };
  const boxes = new Map(), paths = new Map();
  function boxOf(c) {
    if (boxes.has(c.id)) return boxes.get(c.id);
    boxes.set(c.id, { x: 0, y: 0, w: 0, h: 0 });   // guards a parent loop
    const g = c.geo || { x: 0, y: 0, w: 0, h: 0 }, par = cells.get(c.parent);
    let b;
    if (g.rel && par?.edge) {
      // A label on a connector: x -1..1 along it, plus its offset.
      const p = pathAt(pathOf(par), (g.x + 1) / 2);
      b = { x: p.x + (g.off?.x || 0) - g.w / 2, y: p.y + (g.off?.y || 0) - g.h / 2, w: g.w, h: g.h };
    } else if (g.rel && par?.vertex) {
      const pb = boxOf(par);
      b = { x: pb.x + g.x * pb.w + (g.off?.x || 0), y: pb.y + g.y * pb.h + (g.off?.y || 0), w: g.w, h: g.h };
    } else {
      const o = originOf(c);
      b = { x: o.x + g.x, y: o.y + g.y, w: g.w, h: g.h };
    }
    boxes.set(c.id, b);
    return b;
  }
  // Where a connector meets a shape: its fixed point (exitX/Y, entryX/Y), else where the line
  // towards `to` leaves the shape's outline.
  const endOn = (cell, b, to, fx, fy) => {
    if (fx != null && fy != null && fx !== '' && fy !== '') return { x: b.x + +fx * b.w, y: b.y + +fy * b.h };
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = to.x - cx, dy = to.y - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const shape = cell.st.shape || cell.st._base;
    if (shape === 'ellipse' || cell.st.ellipse) {
      const t = 1 / Math.sqrt((dx * dx) / ((b.w / 2) ** 2 || 1) + (dy * dy) / ((b.h / 2) ** 2 || 1));
      return { x: cx + dx * t, y: cy + dy * t };
    }
    const t = Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity);
    return { x: cx + dx * t, y: cy + dy * t };
  };
  const centre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  function pathOf(e) {
    if (paths.has(e.id)) return paths.get(e.id);
    paths.set(e.id, []);
    const g = e.geo || { points: [] }, o = originOf(e), st = e.st;
    const src = cells.get(e.source), tgt = cells.get(e.target);
    const sb = src && (src.vertex ? boxOf(src) : null), tb = tgt && (tgt.vertex ? boxOf(tgt) : null);
    const way = g.points.map((p) => ({ x: o.x + p.x, y: o.y + p.y }));
    const free = (p) => p && { x: o.x + p.x, y: o.y + p.y };
    const fixS = st.exitX != null && st.exitX !== '', fixT = st.entryX != null && st.entryX !== '';
    const aimS = way[0] || (tb ? (fixT ? endOn(tgt, tb, centre(tb), st.entryX, st.entryY) : centre(tb)) : free(g.tp)) || { x: 0, y: 0 };
    const p0 = sb ? endOn(src, sb, aimS, st.exitX, st.exitY) : free(g.sp) || aimS;
    const aimT = way[way.length - 1] || (sb ? (fixS ? p0 : centre(sb)) : p0);
    const p1 = tb ? endOn(tgt, tb, aimT, st.entryX, st.entryY) : free(g.tp) || aimT;
    let pts = [p0, ...way, p1];
    const ortho = /orthogonal|elbow|entityRelation/i.test(st.edgeStyle || '');
    if (ortho) {
      if (!way.length && sb && tb && !fixS && !fixT) {
        // No waypoints: leave each shape from the side facing the other one.
        const sc = centre(sb), tc = centre(tb), horiz = Math.abs(tc.x - sc.x) - (sb.w + tb.w) / 2 > Math.abs(tc.y - sc.y) - (sb.h + tb.h) / 2;
        const a = horiz ? { x: sc.x + Math.sign(tc.x - sc.x) * sb.w / 2, y: sc.y } : { x: sc.x, y: sc.y + Math.sign(tc.y - sc.y) * sb.h / 2 };
        const z = horiz ? { x: tc.x - Math.sign(tc.x - sc.x) * tb.w / 2, y: tc.y } : { x: tc.x, y: tc.y - Math.sign(tc.y - sc.y) * tb.h / 2 };
        const m = horiz ? (a.x + z.x) / 2 : (a.y + z.y) / 2;
        pts = horiz ? [a, { x: m, y: a.y }, { x: m, y: z.y }, z] : [a, { x: a.x, y: m }, { x: z.x, y: m }, z];
      } else {
        // Corners between points that aren't in line; a fixed end leaves its side straight out.
        const sideH = (fx) => fx === '0' || fx === '1' || +fx === 0 || +fx === 1;
        const out = [pts[0]];
        for (let k = 1; k < pts.length; k++) {
          const a = out[out.length - 1], b = pts[k];
          if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) {
            const first = k === 1 ? (fixS ? sideH(st.exitX) : true) : k === pts.length - 1 && fixT ? !sideH(st.entryX) : true;
            out.push(first ? { x: b.x, y: a.y } : { x: a.x, y: b.y });
          }
          out.push(b);
        }
        pts = out;
      }
    }
    paths.set(e.id, pts);
    return pts;
  }
  // The point at fraction t (0..1) of a path's length.
  function pathAt(pts, t) {
    if (!pts.length) return { x: 0, y: 0 };
    const seg = pts.slice(1).map((p, k) => Math.hypot(p.x - pts[k].x, p.y - pts[k].y)), len = seg.reduce((a, b) => a + b, 0);
    let left = Math.max(0, Math.min(1, t)) * len;
    for (let k = 0; k < seg.length; k++) {
      if (left <= seg[k] || k === seg.length - 1) { const f = seg[k] ? Math.min(1, left / seg[k]) : 0; return { x: pts[k].x + (pts[k + 1].x - pts[k].x) * f, y: pts[k].y + (pts[k + 1].y - pts[k].y) * f }; }
      left -= seg[k];
    }
    return pts[0];
  }
  const col = (v, def) => {
    if (v == null || v === '' || v === 'default' || v === 'inherit') return def;
    if (v === 'none') return 'none';
    const ld = v.match(/^light-dark\(\s*([^,]+),/);
    return ld ? ld[1].trim() : v;
  };
  const n = (v, def) => (v == null || v === '' || isNaN(+v) ? def : +v);
  const ex = [];   // drawn extents, for the view box
  const grow = (x, y, w = 0, h = 0) => ex.push([x, y, x + w, y + h]);
  const out = [];
  const strokeAttrs = (st, def = '#000000') => {
    const sc = col(st.strokeColor, def), sw = n(st.strokeWidth, 1);
    const dash = st.dashed === '1' ? ` stroke-dasharray="${(st.dashPattern || '3 3').split(' ').map((v) => +v * sw).join(' ')}"` : '';
    const op = st.strokeOpacity != null || st.opacity != null ? ` stroke-opacity="${n(st.strokeOpacity, 100) * n(st.opacity, 100) / 1e4}"` : '';
    return { sc, sw, attr: `stroke="${esc(sc)}" stroke-width="${sw}"${dash}${op}` };
  };
  for (const c of order) {
    if (!shown(c) || (!c.vertex && !c.edge)) continue;
    const st = c.st;
    if (c.edge) {
      const pts = pathOf(c);
      if (pts.length < 2) continue;
      const s = strokeAttrs(st);
      if (s.sc !== 'none') {
        out.push(`<polyline points="${pts.map((p) => `${+p.x.toFixed(2)},${+p.y.toFixed(2)}`).join(' ')}" fill="none" ${s.attr} stroke-linejoin="round"/>`);
        const end = st.endArrow ?? 'classic', start = st.startArrow ?? 'none';
        out.push(drawioArrow(pts[pts.length - 2], pts[pts.length - 1], end, st.endFill !== '0', n(st.endSize, 6), s));
        out.push(drawioArrow(pts[1], pts[0], start, st.startFill !== '0', n(st.startSize, 6), s));
      }
      pts.forEach((p) => grow(p.x, p.y));
      if (c.label && st.noLabel !== '1') {
        const p = pathAt(pts, ((c.geo?.x || 0) + 1) / 2);
        out.push(drawioText(c, { x: p.x + (c.geo?.off?.x || 0), y: p.y + (c.geo?.off?.y || 0), w: 0, h: 0 }, true, grow));
      }
      continue;
    }
    const b = boxOf(c), shape = st.shape || st._base || 'rect';
    if (shape === 'group' || st._base === 'group') continue;
    const isText = st._base === 'text' || st._base === 'edgeLabel' || shape === 'text';
    const fillDef = isText || st._base === 'edgeLabel' ? 'none' : '#ffffff';
    const fill = col(st.fillColor, fillDef), s = strokeAttrs(st, isText ? 'none' : '#000000');
    const fop = st.fillOpacity != null || st.opacity != null ? ` fill-opacity="${n(st.fillOpacity, 100) * n(st.opacity, 100) / 1e4}"` : '';
    const paint = `fill="${esc(fill)}"${fop} ${s.attr}`;
    const rot = n(st.rotation, 0) ? ` transform="rotate(${n(st.rotation, 0)} ${b.x + b.w / 2} ${b.y + b.h / 2})"` : '';
    const { x, y, w, h } = b, P = (...xy) => xy.map((v, k) => +(k % 2 ? y + v * h : x + v * w).toFixed(2)).reduce((a, v, k) => a + (k % 2 ? ',' : ' ') + v, '').trim();
    let g = '';
    if (st.image || shape === 'image') {
      let href = st.image || '';
      // draw.io writes "data:image/png,<base64>" (a ';' would end the style value).
      if (/^data:image\/[\w+.-]+,/.test(href) && !href.includes(';base64')) href = href.replace(',', ';base64,');
      if (href) g = `<image href="${esc(href)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="${st.imageAspect === '0' ? 'none' : 'xMidYMid meet'}"/>`;
      if (shape !== 'image' && shape !== 'label') g = `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${paint}/>` + g;
    } else if (shape === 'ellipse' || shape === 'doubleEllipse' || shape === 'cloud' || st.ellipse === '1') {
      g = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${paint}/>`;
      if (shape === 'doubleEllipse') g += `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${Math.max(0, w / 2 - 4)}" ry="${Math.max(0, h / 2 - 4)}" fill="none" ${s.attr}/>`;
    } else if (shape === 'rhombus') g = `<polygon points="${P(0.5, 0, 1, 0.5, 0.5, 1, 0, 0.5)}" ${paint}/>`;
    else if (shape === 'triangle') {
      const dir = st.direction || 'east';
      g = `<polygon points="${dir === 'north' ? P(0, 1, 0.5, 0, 1, 1) : dir === 'south' ? P(0, 0, 1, 0, 0.5, 1) : dir === 'west' ? P(1, 0, 1, 1, 0, 0.5) : P(0, 0, 1, 0.5, 0, 1)}" ${paint}/>`;
    } else if (shape === 'hexagon') { const k = Math.min(0.25, (h / 2) / (w || 1)); g = `<polygon points="${P(k, 0, 1 - k, 0, 1, 0.5, 1 - k, 1, k, 1, 0, 0.5)}" ${paint}/>`; }
    else if (shape === 'parallelogram') g = `<polygon points="${P(0.2, 0, 1, 0, 0.8, 1, 0, 1)}" ${paint}/>`;
    else if (shape === 'trapezoid') g = `<polygon points="${P(0.2, 0, 0.8, 0, 1, 1, 0, 1)}" ${paint}/>`;
    else if (/^cylinder/.test(shape) || shape === 'datastore') {
      const ry = Math.min(h / 4, n(st.size, 15) / 2 || 7.5);
      g = `<path d="M${x},${y + ry} a${w / 2},${ry} 0 0 1 ${w},0 v${h - 2 * ry} a${w / 2},${ry} 0 0 1 ${-w},0 z" ${paint}/><path d="M${x},${y + ry} a${w / 2},${ry} 0 0 0 ${w},0" fill="none" ${s.attr}/>`;
    } else if (shape === 'line') g = `<line x1="${x}" y1="${y + h / 2}" x2="${x + w}" y2="${y + h / 2}" ${s.attr} stroke="${esc(s.sc === 'none' ? '#000' : s.sc)}"/>`;
    else if (shape === 'umlActor') {
      const cx = x + w / 2, hr = Math.min(w, h) / 8;
      g = `<g fill="none" ${s.attr}><circle cx="${cx}" cy="${y + hr}" r="${hr}" fill="${esc(fill)}"/><path d="M${cx},${y + 2 * hr} V${y + h * 0.66} M${x},${y + h * 0.35} H${x + w} M${cx},${y + h * 0.66} L${x},${y + h} M${cx},${y + h * 0.66} L${x + w},${y + h}"/></g>`;
    } else if (shape === 'note') {
      const k = Math.min(n(st.size, 30), w / 2, h / 2);
      g = `<path d="M${x},${y} H${x + w - k} L${x + w},${y + k} V${y + h} H${x} Z" ${paint}/><path d="M${x + w - k},${y} V${y + k} H${x + w}" fill="none" ${s.attr}/>`;
    } else if (shape === 'swimlane' || st._base === 'swimlane') {
      const sz = n(st.startSize, 23), horiz = st.horizontal !== '0';
      const sw = col(st.swimlaneFillColor, 'none');
      g = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${esc(sw)}" ${s.attr}/><rect x="${x}" y="${y}" width="${horiz ? w : sz}" height="${horiz ? sz : h}" ${paint}/>`;
    } else if (!isText) {
      // Rectangles - and draw.io's library icons (mxgraph.*), drawn as their box.
      const rounded = st.rounded === '1';
      const rx = rounded ? (st.absoluteArcSize === '1' ? n(st.arcSize, 10) / 2 : Math.min(w, h) * n(st.arcSize, 15) / 100) : 0;
      g = `<rect x="${x}" y="${y}" width="${w}" height="${h}"${rx ? ` rx="${+rx.toFixed(2)}"` : ''} ${paint}/>`;
      if (/^mxgraph\./.test(shape) && fill === '#ffffff' && !st.fillColor) g = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="#f4f6f8" stroke="#9aa5b1" stroke-dasharray="3 2"/>`;
    }
    if (isText && (fill !== 'none' || s.sc !== 'none')) g = `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${paint}/>`;
    grow(x, y, w, h);
    let label = '';
    if (c.label && st.noLabel !== '1') {
      // A swimlane's title sits in its header; other labels may sit beside the shape.
      let lb = { x, y, w, h };
      if (shape === 'swimlane' || st._base === 'swimlane') lb = st.horizontal !== '0' ? { x, y, w, h: n(st.startSize, 23) } : { x, y, w: n(st.startSize, 23), h };
      if (st.verticalLabelPosition === 'bottom') lb = { ...lb, y: y + h };
      else if (st.verticalLabelPosition === 'top') lb = { ...lb, y: y - h };
      if (st.labelPosition === 'left') lb = { ...lb, x: x - w };
      else if (st.labelPosition === 'right') lb = { ...lb, x: x + w };
      label = drawioText(c, lb, false, grow);
    }
    out.push(rot ? `<g${rot}>${g}${label}</g>` : g + label);
  }
  if (!ex.length) ex.push([0, 0, 100, 100]);
  const x0 = Math.min(...ex.map((e) => e[0])), y0 = Math.min(...ex.map((e) => e[1])), x1 = Math.max(...ex.map((e) => e[2])), y1 = Math.max(...ex.map((e) => e[3]));
  return { svg: out.join(''), box: { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) } };
}
// An arrow head at `to`, pointing away from `from`.
function drawioArrow(from, to, kind, filled, size, s) {
  if (!kind || kind === 'none' || !from || !to) return '';
  const a = Math.atan2(to.y - from.y, to.x - from.x), L = size + s.sw * 1.5, W = L * 0.45;
  const P = (d, side) => `${+(to.x - Math.cos(a) * d - Math.sin(a) * side).toFixed(2)},${+(to.y - Math.sin(a) * d + Math.cos(a) * side).toFixed(2)}`;
  const c = esc(s.sc);
  if (kind === 'oval') return `<circle cx="${+(to.x - Math.cos(a) * L / 3).toFixed(2)}" cy="${+(to.y - Math.sin(a) * L / 3).toFixed(2)}" r="${L / 3}" fill="${filled ? c : '#fff'}" stroke="${c}" stroke-width="${s.sw}"/>`;
  if (kind === 'diamond' || kind === 'diamondThin') return `<polygon points="${to.x},${to.y} ${P(L / 2, W)} ${P(L, 0)} ${P(L / 2, -W)}" fill="${filled ? c : '#fff'}" stroke="${c}" stroke-width="${s.sw}"/>`;
  if (kind === 'open' || /^ER/.test(kind) || kind === 'dash' || kind === 'cross') return `<polyline points="${P(L, W)} ${to.x},${to.y} ${P(L, -W)}" fill="none" stroke="${c}" stroke-width="${s.sw}"/>`;
  const back = kind === 'classic' || kind === 'classicThin' ? ` ${P(L * 0.7, 0)}` : '';
  return `<polygon points="${to.x},${to.y} ${P(L, W)}${back} ${P(L, -W)}" fill="${filled ? c : '#fff'}" stroke="${c}" stroke-width="${s.sw}" stroke-linejoin="miter"/>`;
}
// A label as SVG text lines in its box (b; w/h 0 = centred on b.x/b.y). HTML labels (html=1)
// become plain text with their line breaks; whiteSpace=wrap wraps words to the box.
function drawioText(c, b, onEdge, grow) {
  const st = c.st, fs = +st.fontSize || 12, lh = fs * 1.2, sp = +st.spacing || 2, cw = fs * 0.56;
  let text = c.label;
  if (st.html === '1' || /<[a-z][^>]*>/i.test(text)) {
    text = text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li|tr|h\d)>/gi, '\n').replace(/<li[^>]*>/gi, '• ');
    text = new DOMParser().parseFromString(`<body>${text}</body>`, 'text/html').body.textContent;
  }
  text = text.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
  if (!text) return '';
  const wrapW = st.whiteSpace === 'wrap' && b.w > 0 ? Math.max(cw * 4, b.w - 2 * sp) : 0;
  const lines = [];
  for (const raw of text.split('\n')) {
    if (!wrapW) { lines.push(raw); continue; }
    let cur = '';
    for (const word of raw.split(/\s+/)) {
      if (cur && (cur.length + 1 + word.length) * cw > wrapW) { lines.push(cur); cur = word; } else cur = cur ? cur + ' ' + word : word;
    }
    lines.push(cur);
  }
  const align = onEdge ? 'center' : st.align || 'center', valign = onEdge ? 'middle' : st.verticalAlign || 'middle';
  const tx = align === 'left' ? b.x + sp + (+st.spacingLeft || 0) : align === 'right' ? b.x + b.w - sp - (+st.spacingRight || 0) : b.x + b.w / 2;
  const total = lines.length * lh;
  const top = valign === 'top' ? b.y + sp + (+st.spacingTop || 0) : valign === 'bottom' ? b.y + b.h - sp - total - (+st.spacingBottom || 0) : b.y + b.h / 2 - total / 2;
  const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
  const fstyle = +st.fontStyle || 0, color = !st.fontColor || st.fontColor === 'default' ? '#000000' : st.fontColor.replace(/^light-dark\(\s*([^,]+),.*$/, '$1');
  const tw = Math.max(...lines.map((l) => l.length)) * cw, bx = anchor === 'start' ? tx : anchor === 'end' ? tx - tw : tx - tw / 2;
  grow(bx, top, tw, total);
  const bg = st.labelBackgroundColor && st.labelBackgroundColor !== 'none' ? st.labelBackgroundColor : onEdge ? '#ffffff' : '';
  return `${bg ? `<rect x="${+(bx - 2).toFixed(2)}" y="${+top.toFixed(2)}" width="${+(tw + 4).toFixed(2)}" height="${+total.toFixed(2)}" fill="${esc(bg === 'default' ? '#ffffff' : bg)}"/>` : ''}<text x="${+tx.toFixed(2)}" y="${+(top + fs * 0.95).toFixed(2)}" font-size="${fs}" fill="${esc(color)}" text-anchor="${anchor}"
    font-family="${esc(st.fontFamily || 'Helvetica, Arial, sans-serif')}"${fstyle & 1 ? ' font-weight="bold"' : ''}${fstyle & 2 ? ' font-style="italic"' : ''}${fstyle & 4 ? ' text-decoration="underline"' : ''}>${lines.map((l, k) => `<tspan x="${+tx.toFixed(2)}"${k ? ` dy="${lh}"` : ''}>${esc(l) || ' '}</tspan>`).join('')}</text>`;
}
