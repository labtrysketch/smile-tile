/* Cosy Tile Pattern Maker — v1
   Plain JS, no build step. All work happens in the browser.
   Core idea: the pattern is the set of placed motifs repeated over a lattice.
   Square:   a=(T,0)   b=(0,T)
   Brick:    a=(T,0)   b=(T/2,T)    (alternate rows offset by half a tile)
   Halfdrop: a=(T,T/2) b=(0,T)      (alternate columns offset by half a tile)
   Anything crossing a tile edge is therefore drawn again one lattice step away,
   so any crop that is a fundamental region of the lattice tiles seamlessly. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const LS_KEY = 'tpm-project-v1';

const state = {
  tileSize: 2000, gridMode: 'square', gridDiv: 4, showGrid: true, snap: false, showGhost: true,
  bg: '#FFF8EE', transparent: false, exportShape: 'straight', pngPx: 2000, pngDpi: 300, svgStyle: 'inline',
  motifs: [],      // {id, name, vb:[x,y,w,h], content, prefix}
  instances: [],   // {id, motifId, u, v, s, rot, fx, fy}  (u,v,s are fractions of the tile)
  selected: null,
};
let motifCounter = 1, instCounter = 1;
const undoStack = [], redoStack = [];

/* ---------- helpers ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = n => (Math.round(n * 1000) / 1000).toString();
function toast(msg, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const motifById = id => state.motifs.find(m => m.id === id);
const instById = id => state.instances.find(i => i.id === id);

function lattice(T = state.tileSize, mode = state.gridMode) {
  if (mode === 'brick') return { a: [T, 0], b: [T / 2, T] };
  if (mode === 'halfdrop') return { a: [T, T / 2], b: [0, T] };
  return { a: [T, 0], b: [0, T] };
}
/* Bring a point (in tile px) back into the central tile using the lattice. */
function wrapPoint(x, y, T = state.tileSize, mode = state.gridMode) {
  if (mode === 'brick') {
    const j = Math.floor(y / T); y -= j * T; x -= j * T / 2;
    x -= Math.floor(x / T) * T;
  } else if (mode === 'halfdrop') {
    const i = Math.floor(x / T); x -= i * T; y -= i * T / 2;
    y -= Math.floor(y / T) * T;
  } else {
    x -= Math.floor(x / T) * T; y -= Math.floor(y / T) * T;
  }
  return [x, y];
}
/* Region a single exported tile covers (in tile px). */
function exportRegion(shape = state.exportShape) {
  const T = state.tileSize;
  if (state.gridMode === 'square' || shape === 'unit') return { w: T, h: T };
  if (state.gridMode === 'brick') return { w: T, h: 2 * T };   // (T,0) and (0,2T) are lattice vectors
  return { w: 2 * T, h: T };                                    // halfdrop: (2T,0) and (0,T)
}
function geom(inst, m) {
  const T = state.tileSize, [vx, vy, vw, vh] = m.vb;
  const size = inst.s * T, k = size / Math.max(vw, vh);
  return { k, w: vw * k, h: vh * k, cx: vx + vw / 2, cy: vy + vh / 2, r: 0.5 * Math.hypot(vw * k, vh * k) };
}
function transformStr(x, y, inst, g) {
  return `translate(${fmt(x)} ${fmt(y)}) rotate(${fmt(inst.rot)}) scale(${fmt(inst.fx * g.k)} ${fmt(inst.fy * g.k)}) translate(${fmt(-g.cx)} ${fmt(-g.cy)})`;
}
/* Every lattice copy of an instance whose bounding circle touches the region. */
function copiesIn(inst, x0, y0, x1, y1) {
  const m = motifById(inst.motifId); if (!m) return [];
  const T = state.tileSize, g = geom(inst, m), { a, b } = lattice();
  const px = inst.u * T, py = inst.v * T, out = [];
  for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) {
    const x = px + i * a[0] + j * b[0], y = py + i * a[1] + j * b[1];
    if (x + g.r < x0 || x - g.r > x1 || y + g.r < y0 || y - g.r > y1) continue;
    out.push({ x, y, primary: i === 0 && j === 0, g, m });
  }
  return out;
}

/* ---------- SVG import ---------- */
const BAD_TAGS = ['script', 'foreignObject', 'iframe', 'embed', 'object', 'metadata', 'sodipodi:namedview', 'title'];
const SKIP_ROOT_ATTR = /^(xmlns.*|width|height|viewBox|x|y|id|class|version|preserveAspectRatio|xml:space|enable-background|style|baseProfile|sodipodi:.*|inkscape:.*)$/;
function sanitize(root) {
  BAD_TAGS.forEach(t => root.querySelectorAll(t.replace(':', '\\:')).forEach(e => e.remove()));
  root.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(at => {
      if (/^on/i.test(at.name)) el.removeAttribute(at.name);
      if (/href$/i.test(at.name) && /^\s*javascript:/i.test(at.value)) el.removeAttribute(at.name);
    });
  });
}
function measureBBox(svgEl) {
  const holder = document.createElementNS(NS, 'svg');
  holder.setAttribute('style', 'position:absolute;left:-9999px;top:0;width:10px;height:10px;visibility:hidden');
  const g = document.createElementNS(NS, 'g');
  [...svgEl.childNodes].forEach(n => g.appendChild(document.importNode(n, true)));
  holder.appendChild(g); document.body.appendChild(holder);
  let bb; try { bb = g.getBBox(); } catch (e) { bb = { x: 0, y: 0, width: 100, height: 100 }; }
  holder.remove();
  return [bb.x, bb.y, bb.width || 100, bb.height || 100];
}
function parseSVGText(text, name) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new Error('Not a valid SVG file');
  sanitize(svg);
  let vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some(isNaN) || !vb[2] || !vb[3]) {
    const w = parseFloat(svg.getAttribute('width')), h = parseFloat(svg.getAttribute('height'));
    vb = (w > 0 && h > 0) ? [0, 0, w, h] : measureBBox(svg);
  }
  const prefix = `tpm${motifCounter}-`;
  // prefix ids + classes so several motifs never clash
  const idMap = {};
  svg.querySelectorAll('[id]').forEach(el => { const n = prefix + el.id; idMap[el.id] = n; el.id = n; });
  const classes = new Set();
  svg.querySelectorAll('[class]').forEach(el => {
    const cl = el.getAttribute('class').split(/\s+/).filter(Boolean);
    cl.forEach(c => classes.add(c));
    el.setAttribute('class', cl.map(c => prefix + c).join(' '));
  });
  const ids = Object.keys(idMap).sort((p, q) => q.length - p.length);
  const fixRefs = v => {
    ids.forEach(id => {
      v = v.split(`url(#${id})`).join(`url(#${idMap[id]})`).split(`url('#${id}')`).join(`url(#${idMap[id]})`).split(`url("#${id}")`).join(`url(#${idMap[id]})`);
    });
    return v;
  };
  svg.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(at => {
      if (/href$/i.test(at.name) && at.value.startsWith('#') && idMap[at.value.slice(1)]) at.value = '#' + idMap[at.value.slice(1)];
      else if (at.value.includes('url(')) at.value = fixRefs(at.value);
    });
  });
  svg.querySelectorAll('style').forEach(st => {
    let css = fixRefs(st.textContent);
    [...classes].sort((p, q) => q.length - p.length).forEach(c => {
      css = css.replace(new RegExp('\\.' + c.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '(?![\\w-])', 'g'), '.' + prefix + c);
    });
    ids.forEach(id => { css = css.replace(new RegExp('#' + id.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '(?![\\w-])', 'g'), '#' + idMap[id]); });
    st.textContent = css;
  });
  // keep inheritable presentation attributes from the root <svg>
  let attrs = '';
  [...svg.attributes].forEach(at => { if (!SKIP_ROOT_ATTR.test(at.name)) attrs += ` ${at.name}="${esc(at.value)}"`; });
  if (svg.getAttribute('style')) attrs += ` style="${esc(svg.getAttribute('style'))}"`;
  const ser = new XMLSerializer();
  const inner = [...svg.childNodes].map(n => ser.serializeToString(n)).join('')
    .replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
  motifCounter++;
  return { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, vb, prefix,
           content: `<g id="${prefix}root"${attrs}>${inner}</g>` };
}
function pngMotif(dataURL, w, h, name) {
  const prefix = `tpm${motifCounter++}-`;
  return { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, vb: [0, 0, w, h], prefix,
           content: `<g id="${prefix}root"><image href="${dataURL}" xlink:href="${dataURL}" x="0" y="0" width="${w}" height="${h}"/></g>` };
}
function motifThumb(m) {
  const s = `<svg xmlns="${NS}" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${m.vb.join(' ')}">${m.content}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
}
async function handleFiles(files) {
  let added = 0;
  for (const f of files) {
    try {
      const name = f.name.replace(/\.[^.]+$/, '');
      if (/svg/i.test(f.type) || /\.svg$/i.test(f.name)) {
        state.motifs.push(parseSVGText(await f.text(), name)); added++;
      } else if (/png/i.test(f.type) || /\.png$/i.test(f.name)) {
        const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
        const img = await loadImage(url);
        state.motifs.push(pngMotif(url, img.naturalWidth, img.naturalHeight, name)); added++;
      } else toast(`Skipped ${f.name} – please use SVG or PNG`);
    } catch (e) { console.warn(e); toast(`Couldn't read ${f.name}: ${e.message}`); }
  }
  if (added) { pushHistory(); renderAll(); toast(`Added ${added} motif${added > 1 ? 's' : ''} 💕 Click one to place it.`); }
}
const loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image failed to load')); i.src = src; });

/* ---------- instances ---------- */
function addInstance(motifId, x, y, opts = {}) {
  const T = state.tileSize;
  if (x == null) { x = T * (0.2 + Math.random() * 0.6); y = T * (0.2 + Math.random() * 0.6); }
  [x, y] = wrapPoint(...snapPoint(x, y));
  const inst = Object.assign({ id: 'i' + (instCounter++), motifId, u: x / T, v: y / T, s: 0.22, rot: 0, fx: 1, fy: 1 }, opts);
  state.instances.push(inst); state.selected = inst.id;
  pushHistory(); renderAll();
  return inst;
}
function snapPoint(x, y) {
  if (!state.snap) return [x, y];
  const s = state.tileSize / state.gridDiv;
  const sq = [Math.round(x / s) * s, Math.round(y / s) * s];
  if (state.gridMode === 'square') return sq;
  const off = [Math.round((x - s / 2) / s) * s + s / 2, Math.round((y - s / 2) / s) * s + s / 2];
  const d = p => (p[0] - x) ** 2 + (p[1] - y) ** 2;
  return d(sq) <= d(off) ? sq : off;
}

/* ---------- history ---------- */
const snapshot = () => ({ instances: state.instances.map(i => ({ ...i })), motifs: state.motifs.slice(), selected: state.selected });
function pushHistory() {
  undoStack.push(snapshot()); if (undoStack.length > 80) undoStack.shift();
  redoStack.length = 0; updateUndoButtons(); autosave();
}
function restore(s) { state.instances = s.instances.map(i => ({ ...i })); state.motifs = s.motifs.slice(); state.selected = s.selected; renderAll(); autosave(); }
function undo() { if (undoStack.length < 2) return; redoStack.push(undoStack.pop()); restore(undoStack[undoStack.length - 1]); updateUndoButtons(); }
function redo() { if (!redoStack.length) return; const s = redoStack.pop(); undoStack.push(s); restore(s); updateUndoButtons(); }
function updateUndoButtons() { $('undoBtn').disabled = undoStack.length < 2; $('redoBtn').disabled = !redoStack.length; }

/* ---------- editor rendering ---------- */
const ed = $('editor');
function renderDefs() {
  $('edDefs').innerHTML = state.motifs.map(m => m.content).join('');
}
function renderEditor() {
  const T = state.tileSize;
  ed.setAttribute('viewBox', `${-T} ${-T} ${3 * T} ${3 * T}`);
  const sw = T / 600;
  // background (whole visible region)
  $('edBg').innerHTML = `<rect x="${-T}" y="${-T}" width="${3 * T}" height="${3 * T}" fill="${state.transparent ? 'url(#checker)' : state.bg}"/>`;
  const pat = document.querySelector('#checker');
  const cs = T / 40; pat.setAttribute('width', cs * 2); pat.setAttribute('height', cs * 2);
  pat.innerHTML = `<rect width="${cs * 2}" height="${cs * 2}" fill="#fff"/><rect width="${cs}" height="${cs}" fill="#eee5dc"/><rect x="${cs}" y="${cs}" width="${cs}" height="${cs}" fill="#eee5dc"/>`;
  // instances + their wrapped copies
  let html = '';
  for (const inst of state.instances) {
    for (const c of copiesIn(inst, -T, -T, 2 * T, 2 * T)) {
      html += `<use class="inst" data-id="${inst.id}" href="#${c.m.prefix}root" transform="${transformStr(c.x, c.y, inst, c.g)}"/>`;
    }
  }
  $('edInst').innerHTML = html;
  // fade everything outside the central tile
  const fade = $('edFade');
  fade.setAttribute('d', `M${-T} ${-T}h${3 * T}v${3 * T}h${-3 * T}Z M0 0h${T}v${T}h${-T}Z`);
  fade.setAttribute('opacity', state.showGhost ? 0.55 : 0.93);
  // grid
  let g = '';
  const s = T / state.gridDiv;
  if (state.showGrid) {
    if (state.gridMode === 'square') {
      for (let k = -state.gridDiv; k <= 2 * state.gridDiv; k++) {
        g += `<line x1="${k * s}" y1="${-T}" x2="${k * s}" y2="${2 * T}"/><line x1="${-T}" y1="${k * s}" x2="${2 * T}" y2="${k * s}"/>`;
      }
    } else {
      for (let k = -3 * state.gridDiv; k <= 5 * state.gridDiv; k++) {
        const c = k * s; // x - y = c and x + y = c
        g += `<line x1="${-T}" y1="${-T - c}" x2="${2 * T}" y2="${2 * T - c}"/><line x1="${-T}" y1="${c + T}" x2="${2 * T}" y2="${c - 2 * T}"/>`;
      }
    }
    g = `<g stroke="#C9A99A" stroke-opacity=".55" stroke-width="${sw}">${g}</g>`;
  }
  // neighbouring tile outlines along the lattice
  const { a, b } = lattice(); let outl = '';
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
    if (!i && !j) continue;
    const x = i * a[0] + j * b[0], y = i * a[1] + j * b[1];
    if (x > 2 * T || y > 2 * T || x + T < -T || y + T < -T) continue;
    outl += `<rect x="${x}" y="${y}" width="${T}" height="${T}"/>`;
  }
  g += `<g fill="none" stroke="#B89383" stroke-width="${sw * 1.6}" stroke-dasharray="${sw * 8} ${sw * 6}">${outl}</g>`;
  g += `<rect x="0" y="0" width="${T}" height="${T}" fill="none" stroke="#E58E96" stroke-width="${sw * 3}"/>`;
  $('edGrid').innerHTML = g;
  renderSelection();
}
function renderSelection() {
  const T = state.tileSize, el = $('edSel'), inst = instById(state.selected);
  if (!inst) { el.innerHTML = ''; return; }
  const ppu = ed.getBoundingClientRect().width / (3 * T) || 0.2;
  const hr = 9 / ppu, sw = 2 / ppu;
  let html = '';
  for (const c of copiesIn(inst, -T, -T, 2 * T, 2 * T)) {
    const { w, h } = c.g;
    const tf = `translate(${fmt(c.x)} ${fmt(c.y)}) rotate(${fmt(inst.rot)})`;
    if (!c.primary) { html += `<rect transform="${tf}" x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" fill="none" stroke="#E58E96" stroke-width="${sw}" stroke-dasharray="${sw * 3} ${sw * 3}" opacity=".7" pointer-events="none"/>`; continue; }
    html += `<g transform="${tf}">
      <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" fill="none" stroke="#E58E96" stroke-width="${sw * 1.5}" stroke-dasharray="${sw * 5} ${sw * 3}" pointer-events="none"/>
      <line x1="0" y1="${-h / 2}" x2="0" y2="${-h / 2 - 34 / ppu}" stroke="#E58E96" stroke-width="${sw}" pointer-events="none"/>
      <circle class="handle" data-h="rot" cx="0" cy="${-h / 2 - 34 / ppu}" r="${hr}" fill="#A8C3A0" stroke="#fff" stroke-width="${sw}"><title>Drag to rotate (Shift = 15° steps)</title></circle>
      <circle class="handle" data-h="scale" cx="${w / 2}" cy="${h / 2}" r="${hr}" fill="#F4B6B9" stroke="#fff" stroke-width="${sw}"><title>Drag to resize</title></circle>
    </g>`;
  }
  el.innerHTML = html;
}
function renderLibrary() {
  const lib = $('library');
  lib.innerHTML = state.motifs.length ? '' : '<p class="hint" style="grid-column:1/-1">No motifs yet — upload some SVGs!</p>';
  state.motifs.forEach(m => {
    const d = document.createElement('div');
    d.className = 'motif'; d.draggable = true; d.title = `Add “${m.name}” to the tile`;
    d.dataset.mid = m.id;
    d.innerHTML = `<img alt="" src="${motifThumb(m)}"><span class="nm">${esc(m.name)}</span><button class="x" title="Remove motif">✕</button>`;
    d.addEventListener('click', e => {
      if (e.target.classList.contains('x')) {
        const n = state.instances.filter(i => i.motifId === m.id).length;
        if (n && !confirm(`Remove “${m.name}” and its ${n} placed cop${n > 1 ? 'ies' : 'y'}?`)) return;
        state.motifs = state.motifs.filter(x => x !== m);
        state.instances = state.instances.filter(i => i.motifId !== m.id);
        pushHistory(); renderAll(); return;
      }
      addInstance(m.id);
    });
    d.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-motif', m.id); e.dataTransfer.effectAllowed = 'copy'; });
    lib.appendChild(d);
  });
}
function renderControls() {
  const inst = instById(state.selected);
  $('selControls').hidden = !inst; $('noSel').hidden = !!inst;
  if (inst) {
    $('selSize').value = inst.s * 100; $('selSizeVal').textContent = Math.round(inst.s * 100) + '%';
    $('selRot').value = Math.round(inst.rot); $('selRotVal').textContent = Math.round(inst.rot) + '°';
  }
  const T = state.tileSize;
  $('printHint').textContent = `${T} px = ${(T / 300).toFixed(2)} in (${(T / 300 * 2.54).toFixed(1)} cm) at 300 DPI.`;
  $('exportShapeRow').hidden = state.gridMode === 'square';
  const r = exportRegion(), px = +$('pngPx').value || T, dpi = +$('pngDpi').value || 300;
  const W = Math.round(px * r.w / T), H = Math.round(px * r.h / T);
  $('exportHint').textContent = `PNG will be ${W} × ${H} px = ${(W / dpi).toFixed(2)} × ${(H / dpi).toFixed(2)} in at ${dpi} DPI.` +
    (state.gridMode !== 'square' && state.exportShape === 'straight' ? ' (Offset repeats export as a double-height/width tile so it repeats as a plain grid.)' : '') +
    (state.gridMode !== 'square' && state.exportShape === 'unit' ? ` (Upload with the “${state.gridMode === 'brick' ? 'half-brick' : 'half-drop'}” repeat option.)` : '');
  ['dupBtn', 'delBtn', 'upBtn', 'downBtn', 'flipXBtn', 'flipYBtn'].forEach(id => $(id).disabled = !inst);
}
let pvTimer = null;
function renderAll() {
  renderDefs(); renderLibrary(); renderEditor(); renderControls();
  clearTimeout(pvTimer); pvTimer = setTimeout(renderPreview, 120);
}
function renderLight() { renderEditor(); renderControls(); clearTimeout(pvTimer); pvTimer = setTimeout(renderPreview, 120); }

/* ---------- export SVG ---------- */
function buildSVG({ region = exportRegion(), style = state.svgStyle, pxW, pxH, bg = true } = {}) {
  const { w, h } = region;
  const used = new Set(state.instances.map(i => i.motifId));
  let defs = `<clipPath id="tpm-tile-clip"><rect x="0" y="0" width="${w}" height="${h}"/></clipPath>`;
  if (style === 'use') defs += state.motifs.filter(m => used.has(m.id)).map(m => m.content).join('');
  let body = (bg && !state.transparent) ? `<rect id="background" x="0" y="0" width="${w}" height="${h}" fill="${state.bg}"/>` : '';
  let n = 0;
  for (const inst of state.instances) {
    for (const c of copiesIn(inst, 0, 0, w, h)) {
      const tf = transformStr(c.x, c.y, inst, c.g);
      if (style === 'use') {
        body += `<use href="#${c.m.prefix}root" xlink:href="#${c.m.prefix}root" transform="${tf}"/>`;
      } else {
        const content = c.m.content.split(c.m.prefix).join(`${c.m.prefix}c${n++}-`);
        body += `<g transform="${tf}">${content}</g>`;
      }
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="${NS}" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${pxW || w}" height="${pxH || h}" viewBox="0 0 ${w} ${h}"${pxW ? ' preserveAspectRatio="none"' : ''}>\n<title>Cosy Tile Pattern Maker – seamless tile</title>\n<defs>${defs}</defs>\n<g id="tile" clip-path="url(#tpm-tile-clip)">${body}</g>\n</svg>\n`;
}
function baseName() {
  const names = [...new Set(state.instances.map(i => motifById(i.motifId)?.name).filter(Boolean))].slice(0, 3).join('-') || 'pattern';
  return `cosy-tile-${names.replace(/[^\w-]+/g, '_')}-${state.gridMode}`;
}
function exportSVG() {
  download(new Blob([buildSVG()], { type: 'image/svg+xml' }), baseName() + '.svg');
  toast('SVG saved — fully vector, wrapped copies included ✨');
}

/* ---------- export PNG (with DPI) ---------- */
async function renderToCanvas(W, H, region = exportRegion()) {
  const svg = buildSVG({ region, style: 'use', pxW: W, pxH: H });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await loadImage(url);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    cv.getContext('2d').drawImage(img, 0, 0, W, H);
    return cv;
  } finally { URL.revokeObjectURL(url); }
}
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function withDPI(buf, dpi) {
  const src = new Uint8Array(buf), ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21), dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  // copy, dropping any existing pHYs chunk, inserting ours right after IHDR
  const parts = [src.subarray(0, 8)]; let p = 8, inserted = false;
  while (p < src.length) {
    const len = new DataView(src.buffer, src.byteOffset + p).getUint32(0);
    const type = String.fromCharCode(...src.subarray(p + 4, p + 8));
    const end = p + 12 + len;
    if (type !== 'pHYs') parts.push(src.subarray(p, end));
    if (type === 'IHDR' && !inserted) { parts.push(chunk); inserted = true; }
    p = end;
  }
  return new Blob(parts, { type: 'image/png' });
}
async function pngBlob() {
  const T = state.tileSize, r = exportRegion();
  const px = Math.max(100, Math.min(12000, +$('pngPx').value || T)), dpi = +$('pngDpi').value || 300;
  const W = Math.round(px * r.w / T), H = Math.round(px * r.h / T);
  const cv = await renderToCanvas(W, H, r);
  const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
  return { blob: withDPI(await blob.arrayBuffer(), dpi), W, H, dpi };
}
async function exportPNG() {
  toast('Rendering PNG…');
  try {
    const { blob, W, H, dpi } = await pngBlob();
    download(blob, baseName() + `-${W}x${H}-${dpi}dpi.png`);
    toast(`PNG saved: ${W} × ${H} px at ${dpi} DPI 🖼️`);
  } catch (e) { console.error(e); toast('PNG export failed: ' + e.message); }
}

/* ---------- export PDF ---------- */
async function exportPDF() {
  const T = state.tileSize, r = exportRegion(), dpi = +$('pngDpi').value || 300;
  const px = +$('pngPx').value || T;
  const wpt = r.w / T * px / dpi * 72, hpt = r.h / T * px / dpi * 72;   // physical size follows PNG size + DPI
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) { toast('PDF library missing'); return; }
  const doc = new jsPDF({ orientation: wpt > hpt ? 'l' : 'p', unit: 'pt', format: [wpt, hpt], compress: true });
  let mode = 'vector';
  try {
    const el = new DOMParser().parseFromString(buildSVG({ style: 'inline' }), 'image/svg+xml').documentElement;
    const holder = document.createElement('div'); holder.style.cssText = 'position:absolute;left:-99999px;top:0;width:10px;height:10px;overflow:hidden';
    holder.appendChild(document.importNode(el, true)); document.body.appendChild(holder);
    try { await doc.svg(holder.firstChild, { x: 0, y: 0, width: wpt, height: hpt }); } finally { holder.remove(); }
  } catch (e) {
    console.warn('Vector PDF failed, falling back to raster', e);
    mode = 'raster';
    const cv = await renderToCanvas(Math.round(px * r.w / T), Math.round(px * r.h / T), r);
    doc.deletePage(1); doc.addPage([wpt, hpt], wpt > hpt ? 'l' : 'p');
    doc.addImage(cv.toDataURL('image/png'), 'PNG', 0, 0, wpt, hpt);
  }
  window.__tpmLastPdfMode = mode;
  download(doc.output('blob'), baseName() + '.pdf');
  toast(mode === 'vector' ? `PDF saved (vector, ${(wpt / 72).toFixed(2)} × ${(hpt / 72).toFixed(2)} in) 📄` : 'PDF saved (high-res picture — vector conversion failed for this artwork)');
}

/* ---------- preview ---------- */
let pvImg = null, pvKey = '';
async function renderPreview() {
  const cv = $('preview'), dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = Math.round(cv.getBoundingClientRect().width * dpr) || 600;
  if (cv.width !== size) { cv.width = size; cv.height = size; }
  const ctx = cv.getContext('2d'), T = state.tileSize, r = exportRegion('straight');
  const z = +$('pvZoom').value, tilePx = size / z;           // one tile = size/z px
  const W = Math.max(1, Math.round(tilePx * r.w / T)), H = Math.max(1, Math.round(tilePx * r.h / T));
  const key = JSON.stringify([state.instances, state.motifs.map(m => m.id), state.bg, state.transparent, state.gridMode, T, W, H]);
  if (key !== pvKey) {
    pvKey = key;
    try { pvImg = await renderToCanvas(W, H, r); } catch (e) { console.warn(e); return; }
  }
  ctx.clearRect(0, 0, size, size);
  if (state.transparent) {
    const c = 12 * dpr;
    for (let y = 0; y < size; y += c) for (let x = 0; x < size; x += c) { ctx.fillStyle = ((x + y) / c) % 2 ? '#eee5dc' : '#fff'; ctx.fillRect(x, y, c, c); }
  }
  ctx.fillStyle = ctx.createPattern(pvImg, 'repeat'); ctx.fillRect(0, 0, size, size);
  $('pvZoomVal').textContent = `${z} × ${z}`;
}

/* ---------- pointer interaction ---------- */
function svgPoint(evt) {
  const p = ed.createSVGPoint(); p.x = evt.clientX; p.y = evt.clientY;
  return p.matrixTransform(ed.getScreenCTM().inverse());
}
let drag = null;
ed.addEventListener('pointerdown', e => {
  const p = svgPoint(e), h = e.target.closest('[data-h]'), t = e.target.closest('[data-id]');
  const T = state.tileSize;
  if (h) {
    const inst = instById(state.selected); if (!inst) return;
    drag = { kind: h.dataset.h, inst, cx: inst.u * T, cy: inst.v * T, d0: Math.hypot(p.x - inst.u * T, p.y - inst.v * T), s0: inst.s };
  } else if (t) {
    const inst = instById(t.dataset.id); state.selected = inst.id;
    drag = { kind: 'move', inst, p0: p, u0: inst.u, v0: inst.v };
    renderControls(); renderSelection();
  } else {
    state.selected = null; renderControls(); renderSelection(); return;
  }
  ed.setPointerCapture(e.pointerId); drag.moved = false; e.preventDefault();
});
ed.addEventListener('pointermove', e => {
  if (!drag) return;
  const p = svgPoint(e), T = state.tileSize, inst = drag.inst;
  if (drag.kind === 'move') {
    const [x, y] = snapPoint(drag.u0 * T + p.x - drag.p0.x, drag.v0 * T + p.y - drag.p0.y);
    inst.u = x / T; inst.v = y / T;
  } else if (drag.kind === 'scale') {
    const d = Math.hypot(p.x - drag.cx, p.y - drag.cy);
    inst.s = Math.max(0.02, Math.min(0.8, drag.s0 * d / (drag.d0 || 1)));
  } else if (drag.kind === 'rot') {
    let a = Math.atan2(p.y - drag.cy, p.x - drag.cx) * 180 / Math.PI + 90;
    if (e.shiftKey) a = Math.round(a / 15) * 15;
    inst.rot = ((a + 540) % 360) - 180;
  }
  drag.moved = true; renderLight();
});
const endDrag = () => {
  if (!drag) return;
  const inst = drag.inst, T = state.tileSize;
  const [x, y] = wrapPoint(inst.u * T, inst.v * T); inst.u = x / T; inst.v = y / T;
  if (drag.moved) pushHistory();
  drag = null; renderLight();
};
ed.addEventListener('pointerup', endDrag); ed.addEventListener('pointercancel', endDrag);
ed.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
ed.addEventListener('drop', e => {
  e.preventDefault();
  const mid = e.dataTransfer.getData('text/x-motif');
  if (mid) { const p = svgPoint(e); addInstance(mid, p.x, p.y); return; }
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

/* ---------- selected-item actions ---------- */
function mutateSel(fn) { const inst = instById(state.selected); if (!inst) return; fn(inst); pushHistory(); renderLight(); }
function duplicate() {
  const inst = instById(state.selected); if (!inst) return;
  const T = state.tileSize, [x, y] = wrapPoint(inst.u * T + T * 0.06, inst.v * T + T * 0.06);
  const c = { ...inst, id: 'i' + (instCounter++), u: x / T, v: y / T };
  state.instances.splice(state.instances.indexOf(inst) + 1, 0, c); state.selected = c.id;
  pushHistory(); renderLight();
}
function del() {
  const inst = instById(state.selected); if (!inst) return;
  state.instances = state.instances.filter(i => i !== inst); state.selected = null; pushHistory(); renderLight();
}
function moveLayer(dir) {
  const inst = instById(state.selected); if (!inst) return;
  const a = state.instances, i = a.indexOf(inst), j = i + dir;
  if (j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]]; pushHistory(); renderLight();
}

/* ---------- project save / load ---------- */
const SETTINGS = ['tileSize', 'gridMode', 'gridDiv', 'showGrid', 'snap', 'showGhost', 'bg', 'transparent', 'exportShape', 'pngPx', 'pngDpi', 'svgStyle'];
function projectJSON() {
  const settings = {}; SETTINGS.forEach(k => settings[k] = state[k]);
  return { app: 'cosy-tile-pattern-maker', version: 1, savedAt: new Date().toISOString(), settings, motifs: state.motifs, instances: state.instances };
}
function loadProject(p, silent) {
  if (!p || p.app !== 'cosy-tile-pattern-maker') throw new Error('This is not a Cosy Tile Pattern Maker project');
  SETTINGS.forEach(k => { if (p.settings && k in p.settings) state[k] = p.settings[k]; });
  state.motifs = p.motifs || []; state.instances = p.instances || []; state.selected = null;
  motifCounter = 1 + Math.max(0, ...state.motifs.map(m => parseInt((m.prefix || '').replace(/\D/g, '')) || 0));
  instCounter = 1 + Math.max(0, ...state.instances.map(i => parseInt(String(i.id).replace(/\D/g, '')) || 0));
  syncInputs(); undoStack.length = 0; redoStack.length = 0; pushHistory(); renderAll();
  if (!silent) toast('Project opened 📂');
}
function autosave() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(projectJSON())); } catch (e) { /* storage full – fine */ }
}
function syncInputs() {
  $('tileSize').value = state.tileSize; $('gridMode').value = state.gridMode; $('gridDiv').value = state.gridDiv; $('gridDivVal').textContent = state.gridDiv;
  $('showGrid').checked = state.showGrid; $('snap').checked = state.snap; $('showGhost').checked = state.showGhost;
  $('bgColor').value = state.bg; $('bgTransparent').checked = state.transparent;
  $('exportShape').value = state.exportShape; $('pngPx').value = state.pngPx; $('pngDpi').value = state.pngDpi; $('svgStyle').value = state.svgStyle;
}
function loadSamples(withLayout) {
  state.motifs = []; state.instances = []; motifCounter = 1;
  (window.TPM_SAMPLES || []).forEach(s => state.motifs.push(parseSVGText(s.svg, s.name)));
  if (withLayout && state.motifs.length >= 3) {
    const [sm, sf, st] = state.motifs;
    const L = [[sm, .25, .28, .26, -8], [sf, .72, .22, .16, 10], [st, .55, .62, .14, 12], [sm, .8, .78, .24, 6], [sf, .18, .78, .13, -15], [st, .02, .5, .11, -10], [sf, .47, .02, .1, 20]];
    L.forEach(([m, u, v, s, rot]) => state.instances.push({ id: 'i' + (instCounter++), motifId: m.id, u, v, s, rot, fx: 1, fy: 1 }));
  }
}

/* ---------- wire up UI ---------- */
$('upload').addEventListener('change', e => { handleFiles([...e.target.files]); e.target.value = ''; });
$('tossBtn').addEventListener('click', () => {
  if (!state.motifs.length) return toast('Upload a motif first 🌸');
  state.motifs.forEach(m => {
    const T = state.tileSize, inst = { id: 'i' + (instCounter++), motifId: m.id, u: Math.random(), v: Math.random(), s: 0.12 + Math.random() * 0.1, rot: Math.round(Math.random() * 40 - 20), fx: 1, fy: 1 };
    const [x, y] = wrapPoint(...snapPoint(inst.u * T, inst.v * T)); inst.u = x / T; inst.v = y / T;
    state.instances.push(inst);
  });
  pushHistory(); renderLight();
});
$('tileSize').addEventListener('change', e => { state.tileSize = +e.target.value; $('pngPx').value = state.pngPx = state.tileSize; autosave(); renderAll(); });
$('gridMode').addEventListener('change', e => {
  state.gridMode = e.target.value; const T = state.tileSize;
  state.instances.forEach(i => { const [x, y] = wrapPoint(i.u * T, i.v * T); i.u = x / T; i.v = y / T; });
  autosave(); renderAll();
});
$('gridDiv').addEventListener('input', e => { state.gridDiv = +e.target.value; $('gridDivVal').textContent = state.gridDiv; autosave(); renderEditor(); });
$('showGrid').addEventListener('change', e => { state.showGrid = e.target.checked; autosave(); renderEditor(); });
$('snap').addEventListener('change', e => { state.snap = e.target.checked; autosave(); });
$('showGhost').addEventListener('change', e => { state.showGhost = e.target.checked; autosave(); renderEditor(); });
$('bgColor').addEventListener('input', e => { state.bg = e.target.value; state.transparent = false; $('bgTransparent').checked = false; autosave(); renderLight(); });
$('bgTransparent').addEventListener('change', e => { state.transparent = e.target.checked; autosave(); renderLight(); });
['#FFF8EE', '#FDE3E2', '#E4EEDF', '#F6E7C8', '#E3EEF3', '#6B4A3A', '#B33A3A', '#2F4A3A'].forEach(c => {
  const b = document.createElement('button'); b.style.background = c; b.title = c;
  b.onclick = () => { state.bg = c; $('bgColor').value = c; state.transparent = false; $('bgTransparent').checked = false; autosave(); renderLight(); };
  $('swatches').appendChild(b);
});
$('selSize').addEventListener('input', e => { const i = instById(state.selected); if (i) { i.s = e.target.value / 100; renderLight(); } });
$('selRot').addEventListener('input', e => { const i = instById(state.selected); if (i) { i.rot = +e.target.value; renderLight(); } });
['selSize', 'selRot'].forEach(id => $(id).addEventListener('change', () => pushHistory()));
$('dupBtn').onclick = duplicate; $('delBtn').onclick = del;
$('upBtn').onclick = () => moveLayer(1); $('downBtn').onclick = () => moveLayer(-1);
$('flipXBtn').onclick = () => mutateSel(i => i.fx *= -1); $('flipYBtn').onclick = () => mutateSel(i => i.fy *= -1);
$('pvZoom').addEventListener('input', () => renderPreview());
$('exportShape').addEventListener('change', e => { state.exportShape = e.target.value; autosave(); renderControls(); });
$('pngPx').addEventListener('input', e => { state.pngPx = +e.target.value; autosave(); renderControls(); });
$('pngDpi').addEventListener('input', e => { state.pngDpi = +e.target.value; autosave(); renderControls(); });
$('svgStyle').addEventListener('change', e => { state.svgStyle = e.target.value; autosave(); });
$('expSvg').onclick = exportSVG; $('expPng').onclick = exportPNG; $('expPdf').onclick = exportPDF;
$('undoBtn').onclick = undo; $('redoBtn').onclick = redo;
$('saveProj').onclick = () => { download(new Blob([JSON.stringify(projectJSON(), null, 1)], { type: 'application/json' }), baseName() + '.json'); toast('Project saved 💾'); };
$('loadProj').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { loadProject(JSON.parse(await f.text())); } catch (err) { toast('Could not open: ' + err.message); }
});
$('newProj').onclick = () => {
  if (state.instances.length && !confirm('Start a new pattern? (Save your project first if you want to keep it.)')) return;
  loadSamples(false); state.selected = null; undoStack.length = 0; pushHistory(); renderAll();
};
document.addEventListener('keydown', e => {
  if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (!state.selected) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del(); }
  else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
  else if (e.key.startsWith('Arrow')) {
    e.preventDefault(); const st = (e.shiftKey ? 0.02 : 0.004);
    mutateSel(i => { if (e.key === 'ArrowLeft') i.u -= st; if (e.key === 'ArrowRight') i.u += st; if (e.key === 'ArrowUp') i.v -= st; if (e.key === 'ArrowDown') i.v += st;
      const T = state.tileSize, [x, y] = wrapPoint(i.u * T, i.v * T); i.u = x / T; i.v = y / T; });
  }
});
window.addEventListener('resize', () => { renderSelection(); renderPreview(); });

/* ---------- start ---------- */
let restored = false;
try { const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (saved && saved.motifs && saved.motifs.length) { loadProject(saved, true); restored = true; } } catch (e) { /* ignore */ }
if (!restored) { loadSamples(true); syncInputs(); pushHistory(); renderAll(); }

// small hook for automated tests
window.TPM = { state, buildSVG, pngBlob, exportRegion, addInstance, renderAll, wrapPoint, lattice, loadSamples };
})();
