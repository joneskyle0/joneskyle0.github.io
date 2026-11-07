#!/usr/bin/env node
'use strict';
/**
 * Dev server: editor UI + render API + live reload when files change on disk.
 *   npm start            (PORT=3000 by default)
 */
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const chokidar = require('chokidar');
const { renderDocument, RenderError, ROOT, ASSETS_DIR } = require('./render');
const pdf = require('./pdf');
const { getEngine } = require('./ftl');

const PORT = Number(process.env.PORT || 3000);
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const SAMPLES_DIR = path.join(ROOT, 'samples');
const PUBLIC_DIR = path.join(ROOT, 'public');
const TEMPLATE_EXT = /\.(ftl|xml|html?)$/i;

for (const d of [TEMPLATES_DIR, SAMPLES_DIR, ASSETS_DIR]) fs.mkdirSync(d, { recursive: true });

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.text({ type: ['text/*', 'application/octet-stream'], limit: '20mb' }));

/* ---------- helpers ---------- */

function safeName(dir, name) {
  const base = path.basename(String(name || ''));
  if (!base || base !== name || base.startsWith('.')) return null;
  return path.join(dir, base);
}

function listFiles(dir, re) {
  return fs.readdirSync(dir).filter((f) => re.test(f) && fs.statSync(path.join(dir, f)).isFile()).sort();
}

function readJsonFile(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/* ---------- API ---------- */

app.get('/api/files', (req, res) => {
  res.json({
    templates: listFiles(TEMPLATES_DIR, TEMPLATE_EXT),
    samples: listFiles(SAMPLES_DIR, /\.json$/i),
    assets: listFiles(ASSETS_DIR, /./),
    engine: getEngine().version || null
  });
});

function fileRoutes(prefix, dir, re) {
  app.get(`${prefix}/:name`, (req, res) => {
    const p = safeName(dir, req.params.name);
    if (!p || !re.test(req.params.name) || !fs.existsSync(p)) return res.status(404).json({ error: 'Not found' });
    res.type(prefix.includes('samples') ? 'application/json' : 'text/plain').send(fs.readFileSync(p, 'utf8'));
  });
  app.put(`${prefix}/:name`, (req, res) => {
    const p = safeName(dir, req.params.name);
    if (!p || !re.test(req.params.name)) return res.status(400).json({ error: 'Invalid file name' });
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 2);
    fs.writeFileSync(p, body, 'utf8');
    suppressWatch(p);
    res.json({ ok: true, name: req.params.name, bytes: Buffer.byteLength(body) });
  });
  app.delete(`${prefix}/:name`, (req, res) => {
    const p = safeName(dir, req.params.name);
    if (!p || !fs.existsSync(p)) return res.status(404).json({ error: 'Not found' });
    fs.unlinkSync(p);
    res.json({ ok: true });
  });
}
fileRoutes('/api/templates', TEMPLATES_DIR, TEMPLATE_EXT);
fileRoutes('/api/samples', SAMPLES_DIR, /\.json$/i);

/**
 * POST /api/render
 * body: { template?: string, templateName?: string, sample?: object|string, sampleName?: string,
 *         mode: 'html'|'pdf'|'source', lenient?: boolean, locale?: string }
 */
app.post('/api/render', async (req, res) => {
  const body = req.body || {};
  try {
    let template = body.template;
    let name = body.templateName || 'template.ftl';
    if (template == null && body.templateName) {
      const p = safeName(TEMPLATES_DIR, body.templateName);
      if (!p || !fs.existsSync(p)) return res.status(404).json({ error: { message: `Template ${body.templateName} not found` } });
      template = fs.readFileSync(p, 'utf8');
    }
    if (template == null) return res.status(400).json({ error: { message: 'No template given' } });

    let sample = body.sample;
    if (typeof sample === 'string') {
      try { sample = JSON.parse(sample); } catch (e) {
        return res.status(422).json({ error: { type: 'sample', message: `Sample JSON is invalid: ${e.message}` } });
      }
    }
    if (sample == null && body.sampleName) {
      const p = safeName(SAMPLES_DIR, body.sampleName);
      if (!p || !fs.existsSync(p)) return res.status(404).json({ error: { message: `Sample ${body.sampleName} not found` } });
      try { sample = readJsonFile(p); } catch (e) {
        return res.status(422).json({ error: { type: 'sample', message: `Sample JSON is invalid: ${e.message}` } });
      }
    }
    sample = sample || {};

    const mode = body.mode === 'pdf' ? 'print' : body.mode === 'source' ? 'print' : 'preview';
    const started = Date.now();
    const result = await renderDocument({ template, name, sample, mode, lenient: body.lenient, locale: body.locale });
    if (body.mode === 'pdf') {
      const buffer = await pdf.htmlToPdf(result.doc);
      res.set('Content-Type', 'application/pdf');
      res.set('X-Render-Warnings', encodeURIComponent(JSON.stringify(result.warnings)));
      res.set('X-Render-Ms', String(Date.now() - started));
      res.set('Content-Disposition', `inline; filename="${name.replace(TEMPLATE_EXT, '')}.pdf"`);
      return res.send(buffer);
    }
    if (body.mode === 'source') {
      return res.json({ rendered: result.rendered, html: result.doc.html, warnings: result.warnings, ms: Date.now() - started });
    }
    res.json({ html: result.doc.html, warnings: result.warnings, page: result.doc.page, ms: Date.now() - started });
  } catch (err) {
    if (err instanceof RenderError) return res.status(422).json({ error: err.detail });
    console.error(err);
    res.status(500).json({ error: { type: 'internal', message: err.message } });
  }
});

/* ---------- live reload (SSE) ---------- */

const clients = new Set();
const recentlyWritten = new Map();
function suppressWatch(p) {
  recentlyWritten.set(p, Date.now());
}

app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) c.write(line);
}

const watcher = chokidar.watch([TEMPLATES_DIR, SAMPLES_DIR, ASSETS_DIR], { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 150 } });
watcher.on('all', (event, file) => {
  const t = recentlyWritten.get(file);
  if (t && Date.now() - t < 1500) return; // our own save from the browser
  const kind = file.startsWith(TEMPLATES_DIR) ? 'template' : file.startsWith(SAMPLES_DIR) ? 'sample' : 'asset';
  broadcast({ type: 'change', event, kind, name: path.basename(file) });
});

/* ---------- static ---------- */

app.use('/assets', express.static(ASSETS_DIR));
app.use(express.static(PUBLIC_DIR));

app.listen(PORT, async () => {
  console.log(`NetSuite PDF template viewer: http://localhost:${PORT}`);
  if (!fs.existsSync(path.join(PUBLIC_DIR, 'vendor', 'editor.js'))) {
    console.warn('UI bundle missing: run `npm run build:ui`');
  }
  try {
    await getEngine().start();
    console.log(`FreeMarker ${getEngine().version} engine ready`);
  } catch (err) {
    console.error(err.message);
  }
});

process.on('SIGINT', async () => {
  await pdf.closeBrowser();
  getEngine().stop();
  process.exit(0);
});
