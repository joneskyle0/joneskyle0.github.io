'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { convert, preserveNewlines, parseAttrs } = require('../src/bfo');
const { toPt, parseBox, pageSize } = require('../src/units');

const ASSETS = path.join(__dirname, '..', 'assets');

const doc = `<?xml version="1.0"?><!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
<pdf><head>
<link name="NotoSans" type="font" subtype="truetype" src="nsfont://NotoSans_Regular" src-bold="nsfont://NotoSans_Bold" />
<macrolist>
<macro id="nlheader"><table class="header"><tr><td><span class="title">Invoice</span></td></tr></table></macro>
<macro id="nlfooter"><barcode codetype="code128" showtext="true" value="INV-1"/> <pagenumber/> of <totalpages/></macro>
</macrolist>
<style type="text/css">span.title { font-size: 28pt; } td { padding: 4px; }</style>
</head>
<body header="nlheader" header-height="10%" footer="nlfooter" footer-height="20pt" padding="0.5in 0.5in 0.5in 0.5in" size="A4">
<table><tr><td line-height="150%" align="right">Hello</td></tr></table>
<img src="https://1.app.netsuite.com/core/media/media.nl?id=42&c=1" />
<img src="logo.svg" />
<pbr/>
<p>Page two</p>
</body></pdf>`;

test('print conversion: page geometry from <body> attributes', () => {
  const r = convert(doc, { mode: 'print', assets: {}, assetsDir: ASSETS });
  assert.equal(Math.round(r.page.width), 595);
  assert.equal(Math.round(r.page.height), 842);
  assert.equal(r.page.margin.top, 36);
  assert.equal(Math.round(r.page.headerHeight * 10) / 10, 84.2);
  assert.equal(r.page.footerHeight, 20);
  assert.equal(r.pdfOptions.width, '8.2678in');
  assert.equal(r.pdfOptions.margin.top, `${Math.round(((36 + 84.189) / 72) * 10000) / 10000}in`);
  assert.equal(r.pdfOptions.displayHeaderFooter, true);
});

test('print conversion: header/footer templates, page numbers and reserved class names', () => {
  const r = convert(doc, { mode: 'print', assets: {}, assetsDir: ASSETS });
  assert.match(r.headerTemplate, /class="nsv-title"/, 'class "title" is renamed (Chromium fills .title with the document title)');
  assert.match(r.headerTemplate, /span\.nsv-title \{ font-size: 28pt; \}/);
  assert.match(r.footerTemplate, /<span class="pageNumber">/);
  assert.match(r.footerTemplate, /<span class="totalPages">/);
  assert.match(r.footerTemplate, /<svg class="nsv-barcode"/);
  assert.doesNotMatch(r.html, /<macrolist|<macro /);
});

test('body transforms: pbr, CSS attributes, image mapping and placeholders', () => {
  const r = convert(doc, { mode: 'print', assets: { 'media.nl?id=42': 'logo.svg' }, assetsDir: ASSETS });
  assert.match(r.html, /page-break-after:always/);
  assert.match(r.html, /<td align="right" style="line-height:150%">Hello<\/td>/);
  const imgs = r.html.match(/<img src="data:image\/svg\+xml;base64,[^"]+"/g) || [];
  assert.equal(imgs.length, 2, 'both the mapped NetSuite URL and the relative asset become data URIs');
  assert.equal(r.warnings.length, 0);

  const r2 = convert(doc, { mode: 'print', assets: {}, assetsDir: ASSETS });
  assert.ok(r2.warnings.some((w) => /NetSuite image URL/.test(w)));
  assert.match(r2.html, /data:image\/svg\+xml;base64/); // placeholder
});

test('preview conversion builds a sheet with header and footer', () => {
  const r = convert(doc, { mode: 'preview', assets: {}, assetsDir: ASSETS });
  assert.match(r.html, /class="nsv-sheet"/);
  assert.match(r.html, /class="nsv-header" style="height:84\.19pt"/);
  assert.match(r.html, /class="nsv-footer" style="height:20pt"/);
  assert.match(r.html, /@font-face\{font-family:"NotoSans";font-weight:bold/);
  assert.equal(r.pdfOptions, undefined);
});

test('pdfset documents are joined with page breaks', () => {
  const set = `<pdfset><pdf><head></head><body>One</body></pdf><pdf><head></head><body>Two</body></pdf></pdfset>`;
  const r = convert(set, { mode: 'print' });
  assert.match(r.html, /One<div class="nsv-pbr"[^>]*><\/div>Two/);
  assert.ok(r.warnings.some((w) => /pdfset/.test(w)));
});

test('pagenumber outside a macro warns', () => {
  const r = convert('<pdf><body>Page <pagenumber/></body></pdf>', { mode: 'print' });
  assert.ok(r.warnings.some((w) => /pagenumber/.test(w)));
  assert.match(r.html, /#<\/span>/);
});

test('preserveNewlines converts text newlines but not markup whitespace', () => {
  const html = '<td>\n  Line one\nLine two\n</td>\n<td>x</td><style>a{\ncolor:red}\n</style><pre>a\nb</pre>';
  const out = preserveNewlines(html);
  assert.match(out, /Line one<br \/>Line two/);
  assert.match(out, /<\/td>\n<td>/);
  assert.match(out, /a\{\ncolor:red\}/);
  assert.match(out, /<pre>a\nb<\/pre>/);
});

test('attribute parser handles quotes and bare values', () => {
  const { attrs } = parseAttrs(`class="a b" width=100 checked data-x='y'`);
  assert.deepEqual(attrs, { class: 'a b', width: '100', checked: '', 'data-x': 'y' });
});

test('units', () => {
  assert.equal(toPt('1in'), 72);
  assert.equal(toPt('10%', 200), 20);
  assert.equal(toPt('12px'), 9);
  assert.deepEqual(parseBox('1in 2in', 0), { top: 72, right: 144, bottom: 72, left: 144 });
  assert.deepEqual(pageSize({ size: 'Letter-landscape' }), { width: 792, height: 612 });
  assert.deepEqual(pageSize({ width: '4in', height: '6in' }), { width: 288, height: 432 });
});
