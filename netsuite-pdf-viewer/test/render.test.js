'use strict';
/** End-to-end through the real FreeMarker engine (needs Java). Skipped if java is missing. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const hasJava = spawnSync('java', ['-version']).status === 0;
const { renderDocument, RenderError } = require('../src/render');
const { getEngine } = require('../src/ftl');

const ROOT = path.join(__dirname, '..');

test('renders the sample invoice through FreeMarker', { skip: !hasJava && 'java not installed' }, async () => {
  const template = fs.readFileSync(path.join(ROOT, 'templates', 'invoice.ftl'), 'utf8');
  const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'samples', 'invoice.json'), 'utf8'));
  const r = await renderDocument({ template, name: 'invoice.ftl', sample, mode: 'print' });
  assert.match(r.rendered, /<span class="title">Invoice<\/span>/);
  assert.match(r.rendered, /#INV-1051/);
  assert.match(r.rendered, /11\/7\/2026/, 'ISO date string rendered with the default date format');
  assert.match(r.html ?? r.doc.html, /WDG-200/);
  assert.match(r.doc.footerTemplate, /pageNumber/);
  assert.equal(r.warnings.length, 0, r.warnings.join('; '));
});

test('reports FreeMarker errors with line and column', { skip: !hasJava && 'java not installed' }, async () => {
  await assert.rejects(
    renderDocument({ template: 'a\n<#if x>${record.nosuch}', sample: {}, mode: 'print' }),
    (err) => err instanceof RenderError && err.detail.type === 'parse' && err.detail.line === 2
  );
  await assert.rejects(
    renderDocument({ template: 'a\n${record.nosuch}', sample: { record: {} }, mode: 'print' }),
    (err) => err instanceof RenderError && err.detail.type === 'runtime' && err.detail.line === 2 && /nosuch/.test(err.detail.message)
  );
});

test('lenient mode keeps rendering past missing values', { skip: !hasJava && 'java not installed' }, async () => {
  const r = await renderDocument({ template: 'before ${record.nosuch} after', sample: { record: {} }, mode: 'print', lenient: true });
  assert.match(r.rendered, /before/);
  assert.match(r.rendered, /after/);
});

test.after(() => getEngine().stop());
