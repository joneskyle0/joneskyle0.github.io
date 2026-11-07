import { createEditor } from '/vendor/editor.js';

const $ = (id) => document.getElementById(id);
const state = {
  templateName: null,
  sampleName: null,
  templateSaved: '',
  sampleSaved: '',
  tab: 'template',
  mode: 'html',
  renderSeq: 0,
  pdfjs: null,
  lastPdf: null
};

const templateEditor = createEditor({ parent: $('templateEditor'), language: 'ftl', onChange: () => onEdited('template'), onSave: () => save() });
const sampleEditor = createEditor({ parent: $('sampleEditor'), language: 'json', onChange: () => onEdited('sample'), onSave: () => save() });

/* ---------- loading ---------- */

async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error?.message || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res;
}

async function loadFileList(keep = true) {
  const files = await (await api('/api/files')).json();
  fillSelect($('templateSelect'), files.templates, keep ? state.templateName : null);
  fillSelect($('sampleSelect'), files.samples, keep ? state.sampleName : null);
  $('engineInfo').textContent = files.engine ? `FreeMarker ${files.engine}` : '';
  return files;
}

function fillSelect(select, names, current) {
  select.innerHTML = '';
  for (const n of names) {
    const o = document.createElement('option');
    o.value = n; o.textContent = n;
    select.appendChild(o);
  }
  if (current && names.includes(current)) select.value = current;
}

async function openTemplate(name) {
  if (!name) return;
  const text = await (await api(`/api/templates/${encodeURIComponent(name)}`)).text();
  state.templateName = name;
  state.templateSaved = text;
  templateEditor.setValue(text, 'ftl');
  setDirty('template', false);
  localStorage.setItem('nsv.template', name);
}

async function openSample(name) {
  if (!name) return;
  const text = await (await api(`/api/samples/${encodeURIComponent(name)}`)).text();
  state.sampleName = name;
  state.sampleSaved = text;
  sampleEditor.setValue(text, 'json');
  setDirty('sample', false);
  localStorage.setItem('nsv.sample', name);
}

/* ---------- editing / saving ---------- */

let renderTimer = null;
function onEdited(kind) {
  const editor = kind === 'template' ? templateEditor : sampleEditor;
  const saved = kind === 'template' ? state.templateSaved : state.sampleSaved;
  setDirty(kind, editor.getValue() !== saved);
  if ($('autoRender').checked) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 450);
  }
}

function setDirty(kind, on) {
  $(`${kind}Dirty`).classList.toggle('on', on);
}

async function save() {
  const kind = state.tab;
  const name = kind === 'template' ? state.templateName : state.sampleName;
  if (!name) return saveAs();
  await writeFile(kind, name);
}

async function saveAs() {
  const kind = state.tab;
  const current = kind === 'template' ? state.templateName : state.sampleName;
  const name = prompt(`Save ${kind} as`, current || (kind === 'template' ? 'new.ftl' : 'new.json'));
  if (!name) return;
  await writeFile(kind, name);
  await loadFileList();
  if (kind === 'template') { state.templateName = name; $('templateSelect').value = name; }
  else { state.sampleName = name; $('sampleSelect').value = name; }
}

async function writeFile(kind, name) {
  const editor = kind === 'template' ? templateEditor : sampleEditor;
  const text = editor.getValue();
  if (kind === 'sample') {
    try { JSON.parse(text); } catch (e) { showError({ type: 'sample', message: `Sample JSON is invalid: ${e.message}` }); return; }
  }
  await api(`/api/${kind === 'template' ? 'templates' : 'samples'}/${encodeURIComponent(name)}`, {
    method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: text
  });
  if (kind === 'template') state.templateSaved = text; else state.sampleSaved = text;
  setDirty(kind, false);
  setStatus(`Saved ${name}`);
}

/* ---------- rendering ---------- */

function setStatus(text) { $('status').textContent = text; }

function showError(err) {
  const bar = $('errorBar');
  if (!err) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  bar.classList.remove('hidden');
  const where = err.line ? ` at line ${err.line}, column ${err.col || 1}` : '';
  bar.innerHTML = '';
  const head = document.createElement('div');
  head.innerHTML = `<strong>${escapeHtml(err.type || 'error')} error${escapeHtml(where)}</strong>`;
  if (err.line && err.type !== 'sample') {
    const a = document.createElement('a');
    a.textContent = ' jump to line';
    a.onclick = () => { switchTab('template'); templateEditor.gotoLine(err.line, err.col); };
    head.appendChild(a);
  }
  bar.appendChild(head);
  const msg = document.createElement('div');
  msg.textContent = err.message || '';
  bar.appendChild(msg);
}

function showWarnings(list) {
  const el = $('warnings');
  el.innerHTML = '';
  if (!list || !list.length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  for (const w of list) { const d = document.createElement('div'); d.textContent = w; el.appendChild(d); }
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function renderBody(mode) {
  return JSON.stringify({
    template: templateEditor.getValue(),
    templateName: state.templateName || 'template.ftl',
    sample: sampleEditor.getValue(),
    mode,
    lenient: $('lenient').checked
  });
}

async function render() {
  const seq = ++state.renderSeq;
  const mode = state.mode;
  setStatus('Rendering…');
  const started = performance.now();
  try {
    const res = await fetch('/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: renderBody(mode) });
    if (seq !== state.renderSeq) return;
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: { message: res.statusText } }));
      showError(data.error);
      setStatus('Error');
      return;
    }
    showError(null);
    let pages = '';
    if (mode === 'pdf') {
      const buf = await res.arrayBuffer();
      state.lastPdf = buf;
      showWarnings(JSON.parse(decodeURIComponent(res.headers.get('X-Render-Warnings') || '%5B%5D')));
      const n = await drawPdf(buf);
      pages = ` · ${n} page${n === 1 ? '' : 's'}`;
    } else if (mode === 'source') {
      const data = await res.json();
      showWarnings(data.warnings);
      $('sourcePreview').textContent = data.rendered;
    } else {
      const data = await res.json();
      showWarnings(data.warnings);
      const frame = $('htmlPreview');
      const scrollY = frame.contentWindow ? frame.contentWindow.scrollY : 0;
      frame.srcdoc = data.html;
      frame.onload = () => { fitPreview(frame); frame.contentWindow.scrollTo(0, scrollY); };
    }
    setStatus(`Rendered in ${Math.round(performance.now() - started)} ms${pages}`);
  } catch (err) {
    if (seq !== state.renderSeq) return;
    showError({ type: 'network', message: err.message });
    setStatus('Error');
  }
}

async function loadPdfjs() {
  if (state.pdfjs) return state.pdfjs;
  const pdfjs = await import('/vendor/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.mjs';
  state.pdfjs = pdfjs;
  return pdfjs;
}

async function drawPdf(buffer) {
  const pdfjs = await loadPdfjs();
  const container = $('pdfPreview');
  const scrollTop = container.scrollTop;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
  const frag = document.createDocumentFragment();
  const scale = Math.min(2, Math.max(1, (container.clientWidth - 48) / 612)) * (window.devicePixelRatio || 1);
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${Math.ceil(viewport.width / (window.devicePixelRatio || 1))}px`;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    frag.appendChild(canvas);
  }
  container.innerHTML = '';
  container.appendChild(frag);
  container.scrollTop = scrollTop;
  return pdf.numPages;
}

/** Scale the HTML preview sheet down so a full page width fits the pane. */
function fitPreview(frame) {
  try {
    const doc = frame.contentDocument;
    const sheet = doc && doc.querySelector('.nsv-sheet');
    if (!sheet) return;
    const zoom = Math.min(1, (frame.clientWidth - 48) / sheet.offsetWidth);
    doc.body.style.zoom = String(zoom);
  } catch { /* cross-origin or not loaded yet */ }
}
window.addEventListener('resize', () => fitPreview($('htmlPreview')));

async function downloadPdf() {
  $('downloadBtn').disabled = true;
  try {
    const res = await fetch('/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: renderBody('pdf') });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: { message: res.statusText } }));
      showError(data.error);
      return;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.templateName || 'template').replace(/\.(ftl|xml|html?)$/i, '') + '.pdf';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } finally {
    $('downloadBtn').disabled = false;
  }
}

/* ---------- tabs & modes ---------- */

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.editorPane .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('templateEditor').classList.toggle('hidden', tab !== 'template');
  $('sampleEditor').classList.toggle('hidden', tab !== 'sample');
}

function switchMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.previewPane .tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('htmlPreview').classList.toggle('hidden', mode !== 'html');
  $('pdfPreview').classList.toggle('hidden', mode !== 'pdf');
  $('sourcePreview').classList.toggle('hidden', mode !== 'source');
  localStorage.setItem('nsv.mode', mode);
  render();
}

/* ---------- live reload from disk ---------- */

function connectEvents() {
  const es = new EventSource('/events');
  es.onmessage = async (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type !== 'change') return;
    if (ev.kind === 'asset') { render(); return; }
    const isCurrent = (ev.kind === 'template' && ev.name === state.templateName) || (ev.kind === 'sample' && ev.name === state.sampleName);
    if (ev.event === 'add' || ev.event === 'unlink') await loadFileList();
    if (!isCurrent) return;
    const dirty = $(`${ev.kind}Dirty`).classList.contains('on');
    if (!dirty) {
      if (ev.kind === 'template') await openTemplate(ev.name); else await openSample(ev.name);
      setStatus(`${ev.name} reloaded from disk`);
      render();
    } else {
      const n = $('diskNotice');
      n.classList.remove('hidden');
      n.innerHTML = `${escapeHtml(ev.name)} changed on disk; you have unsaved edits. `;
      const b = document.createElement('button');
      b.textContent = 'Reload';
      b.onclick = async () => { n.classList.add('hidden'); if (ev.kind === 'template') await openTemplate(ev.name); else await openSample(ev.name); render(); };
      n.appendChild(b);
    }
  };
  es.onerror = () => setStatus('Live reload disconnected; retrying…');
}

/* ---------- resizable divider ---------- */

(function initDivider() {
  const divider = $('divider');
  const left = document.querySelector('.editorPane');
  let dragging = false;
  divider.addEventListener('mousedown', () => { dragging = true; document.body.style.userSelect = 'none'; });
  window.addEventListener('mouseup', () => { dragging = false; document.body.style.userSelect = ''; });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const pct = Math.min(80, Math.max(15, (e.clientX / window.innerWidth) * 100));
    left.style.flexBasis = `${pct}%`;
  });
})();

/* ---------- wire up ---------- */

document.querySelectorAll('.editorPane .tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
document.querySelectorAll('.previewPane .tab').forEach((b) => b.addEventListener('click', () => switchMode(b.dataset.mode)));
$('templateSelect').addEventListener('change', async (e) => { await openTemplate(e.target.value); render(); });
$('sampleSelect').addEventListener('change', async (e) => { await openSample(e.target.value); render(); });
$('saveBtn').addEventListener('click', save);
$('saveAsBtn').addEventListener('click', saveAs);
$('renderBtn').addEventListener('click', render);
$('downloadBtn').addEventListener('click', downloadPdf);
$('lenient').addEventListener('change', render);
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); render(); }
});
window.addEventListener('beforeunload', (e) => {
  if ($('templateDirty').classList.contains('on') || $('sampleDirty').classList.contains('on')) e.preventDefault();
});

// Exposed for scripting/automation (e.g. Playwright): window.nsv.templateEditor.setValue(...)
window.nsv = { state, templateEditor, sampleEditor, render, save, switchMode, switchTab };

(async function init() {
  const files = await loadFileList(false);
  const t = localStorage.getItem('nsv.template');
  const s = localStorage.getItem('nsv.sample');
  const templateName = files.templates.includes(t) ? t : files.templates[0];
  const sampleName = files.samples.includes(s) ? s : files.samples[0];
  if (templateName) { $('templateSelect').value = templateName; await openTemplate(templateName); }
  if (sampleName) { $('sampleSelect').value = sampleName; await openSample(sampleName); }
  const mode = localStorage.getItem('nsv.mode');
  connectEvents();
  switchMode(mode === 'pdf' || mode === 'source' ? mode : 'html');
})();
