'use strict';
/** One-call pipeline: template source + sample JSON -> {html|pdf, warnings} */
const path = require('node:path');
const { getEngine } = require('./ftl');
const { preprocessTemplate, buildModel } = require('./netsuite');
const bfo = require('./bfo');
const pdf = require('./pdf');

const ROOT = path.join(__dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'assets');

class RenderError extends Error {
  constructor(error) {
    super(error.message);
    this.name = 'RenderError';
    this.detail = error; // {type, message, line, col}
  }
}

/**
 * Runs FreeMarker and converts the BFO markup.
 * @param {object} opts {template, name, sample, mode:'print'|'preview', lenient, locale}
 * @returns {Promise<{rendered, doc, warnings, engineVersion}>}
 */
async function renderDocument(opts) {
  const { template, name = 'template.ftl', sample = {}, mode = 'print' } = opts;
  const { data, assets, options } = buildModel(sample);
  const engine = getEngine();
  const res = await engine.render({
    name,
    template: preprocessTemplate(template),
    data,
    locale: opts.locale || options.locale || 'en_US',
    lenient: opts.lenient ?? options.lenient ?? false,
    numberFormat: options.numberFormat,
    dateFormat: options.dateFormat,
    timeFormat: options.timeFormat,
    dateTimeFormat: options.dateTimeFormat
  });
  if (res.error) throw new RenderError(res.error);
  const doc = bfo.convert(res.html, { mode, assets, assetsDir: opts.assetsDir || ASSETS_DIR, preserveNewlines: options.preserveNewlines });
  return { rendered: res.html, doc, warnings: doc.warnings, engineVersion: engine.version };
}

async function renderHtml(opts) {
  const r = await renderDocument({ ...opts, mode: 'preview' });
  return { html: r.doc.html, warnings: r.warnings, page: r.doc.page };
}

async function renderPdf(opts) {
  const r = await renderDocument({ ...opts, mode: 'print' });
  const buffer = await pdf.htmlToPdf(r.doc);
  return { pdf: buffer, warnings: r.warnings, page: r.doc.page };
}

module.exports = { renderDocument, renderHtml, renderPdf, RenderError, ROOT, ASSETS_DIR };
