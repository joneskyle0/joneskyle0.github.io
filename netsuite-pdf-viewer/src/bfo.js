'use strict';
/**
 * Converts the BFO (Big Faceless Report Generator) dialect that NetSuite's Advanced
 * PDF/HTML templates produce into HTML that Chromium can print faithfully.
 *
 * Handles: <pdf>/<pdfset> wrappers, <macrolist>/<macro> headers & footers, <body> page
 * attributes (size, padding, header-height, footer-height), <pbr/>, <barcode/>,
 * <pagenumber/>, <totalpages/>, <link type="font">, CSS-named attributes on elements
 * (line-height="150%" etc.), and NetSuite image URLs mapped to local assets.
 */
const fs = require('node:fs');
const path = require('node:path');
const bwipjs = require('bwip-js');
const { toPt, pt, parseBox, pageSize } = require('./units');

const DEFAULT_FONT_STACK = 'Helvetica, Arial, "Liberation Sans", "DejaVu Sans", sans-serif';

/** NetSuite font names -> locally installed candidates (first match wins in Chromium). */
const FONT_FALLBACKS = {
  notosans: ['Noto Sans', 'DejaVu Sans', 'Liberation Sans', 'Arial', 'Helvetica'],
  notoserif: ['Noto Serif', 'DejaVu Serif', 'Liberation Serif', 'Times New Roman'],
  notosansmono: ['Noto Sans Mono', 'DejaVu Sans Mono', 'Liberation Mono', 'Courier New'],
  notosanscjksc: ['Noto Sans CJK SC', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'DejaVu Sans'],
  notosanscjktc: ['Noto Sans CJK TC', 'Noto Sans TC', 'PingFang TC', 'DejaVu Sans'],
  notosanscjkjp: ['Noto Sans CJK JP', 'Noto Sans JP', 'Hiragino Sans', 'DejaVu Sans'],
  notosanscjkkr: ['Noto Sans CJK KR', 'Noto Sans KR', 'Apple SD Gothic Neo', 'DejaVu Sans'],
  notosansthai: ['Noto Sans Thai', 'DejaVu Sans'],
  notosanshebrew: ['Noto Sans Hebrew', 'DejaVu Sans'],
  notosansarabic: ['Noto Sans Arabic', 'DejaVu Sans']
};

/** Attributes BFO treats as CSS when written as plain HTML attributes. */
const CSS_ATTRS = new Set([
  'line-height', 'font-size', 'font-family', 'font-weight', 'font-style', 'color',
  'background-color', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-collapse',
  'text-align', 'vertical-align', 'white-space', 'text-decoration', 'letter-spacing',
  'word-spacing', 'display', 'float', 'page-break-before', 'page-break-after', 'page-break-inside'
]);

const BARCODE_TYPES = {
  code128: 'code128',
  code39: 'code39',
  code93: 'code93',
  ean13: 'ean13',
  ean8: 'ean8',
  upca: 'upca',
  upce: 'upce',
  qrcode: 'qrcode',
  datamatrix: 'datamatrix',
  pdf417: 'pdf417',
  itf: 'interleaved2of5',
  interleaved2of5: 'interleaved2of5',
  codabar: 'rationalizedCodabar',
  postnet: 'postnet'
};

const NETSUITE_URL_RE = /netsuite\.com|media\.nl\?|\/core\/media\//i;

/* ---------- small markup helpers ---------- */

function parseAttrs(str) {
  const attrs = {};
  const order = [];
  const re = /([^\s=\/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g;
  let m;
  while ((m = re.exec(str || ''))) {
    const name = m[1].toLowerCase();
    attrs[name] = m[2] ?? m[3] ?? m[4] ?? '';
    order.push(name);
  }
  return { attrs, order };
}

function escAttr(v) {
  return String(v).replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/"/g, '&quot;');
}

function serializeAttrs(attrs) {
  return Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => (v === '' ? ` ${k}=""` : ` ${k}="${escAttr(v)}"`))
    .join('');
}

function stripProlog(src) {
  return src
    .replace(/^﻿/, '')
    .replace(/<\?xml[^>]*\?>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '');
}

/* ---------- barcodes ---------- */

function renderBarcode(attrs, warnings) {
  const codetype = String(attrs.codetype || 'code128').toLowerCase();
  const bcid = BARCODE_TYPES[codetype];
  const value = attrs.value ?? '';
  if (!bcid) {
    warnings.push(`Unsupported barcode codetype "${codetype}"; rendered as text.`);
    return `<span class="nsv-barcode-fallback">${value}</span>`;
  }
  const showtext = String(attrs.showtext ?? 'false').toLowerCase() === 'true';
  const opts = { bcid, text: String(value), includetext: showtext, textxalign: 'center', scale: 1 };
  const height = toPt(attrs.height || attrs['bar-height'] || attrs.barheight);
  if (height) opts.height = height * 25.4 / 72; // bwip-js height is in mm
  if (attrs['bar-width'] || attrs.barwidth) {
    const bw = toPt(attrs['bar-width'] || attrs.barwidth);
    if (bw) opts.width = undefined; // module width handled via scale below
  }
  try {
    let svg = bwipjs.toSVG(opts);
    // Make the SVG scale with CSS width/height when provided.
    const styles = [];
    if (attrs.width) styles.push(`width:${attrs.width}`);
    if (attrs.height) styles.push(`height:${attrs.height}`);
    if (attrs.style) styles.push(attrs.style);
    svg = svg.replace('<svg ', `<svg class="nsv-barcode" style="${styles.join(';')}" `);
    return svg;
  } catch (err) {
    warnings.push(`Barcode "${value}" (${codetype}) failed: ${err.message}`);
    return `<span class="nsv-barcode-fallback">${value}</span>`;
  }
}

/* ---------- images ---------- */

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

function resolveImage(src, ctx) {
  const { assets = {}, assetsDir, warnings } = ctx;
  if (!src) return src;
  // Explicit mapping from the sample's "@assets": { "<url or substring>": "logo.png" }
  for (const [key, file] of Object.entries(assets)) {
    if (src === key || src.includes(key)) return localImage(file, ctx) || src;
  }
  if (/^data:/i.test(src)) return src;
  if (/^https?:\/\//i.test(src)) {
    if (NETSUITE_URL_RE.test(src)) {
      warnings.push(`NetSuite image URL not available locally: ${src}. Map it with "@assets" in the sample JSON.`);
      return placeholderImage(src);
    }
    return src; // external image: let Chromium try to fetch it
  }
  // Relative path -> assets dir
  const local = localImage(src, ctx);
  if (local) return local;
  if (assetsDir) warnings.push(`Image not found in assets/: ${src}`);
  return placeholderImage(src);
}

function localImage(file, ctx) {
  const { assetsDir } = ctx;
  if (!assetsDir) return null;
  const clean = String(file).replace(/^\/?assets\//, '').replace(/^\//, '');
  const full = path.resolve(assetsDir, clean);
  if (!full.startsWith(path.resolve(assetsDir)) || !fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  const mime = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
  return `data:${mime};base64,${fs.readFileSync(full).toString('base64')}`;
}

function placeholderImage(src) {
  const label = String(src).slice(0, 40).replace(/[<>&"]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60"><rect width="160" height="60" fill="#eee" stroke="#bbb" stroke-dasharray="4 2"/><text x="80" y="28" font-family="sans-serif" font-size="10" text-anchor="middle" fill="#888">image</text><text x="80" y="44" font-family="sans-serif" font-size="7" text-anchor="middle" fill="#aaa">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/* ---------- element transform ---------- */

/**
 * BFO renders a newline inside text as a line break (that is how NetSuite address
 * fields such as ${record.billaddress} come out on multiple lines). Browsers collapse
 * them, so turn newlines between two visible characters inside text nodes into <br/>.
 * Skips <style>, <script>, <pre>, <textarea> and SVG content.
 */
function preserveNewlines(html) {
  const parts = html.split(/(<[^>]+>)/);
  const skipTags = /^<\/?(style|script|pre|textarea|svg)\b/i;
  let skipDepth = 0;
  return parts
    .map((part) => {
      if (part.startsWith('<')) {
        if (skipTags.test(part)) {
          if (part.startsWith('</')) skipDepth = Math.max(0, skipDepth - 1);
          else if (!/\/>$/.test(part)) skipDepth++;
        }
        return part;
      }
      if (skipDepth > 0 || !part.includes('\n')) return part;
      return part.replace(/(\S[ \t]*)\r?\n([ \t]*\S)/g, '$1<br />$2');
    })
    .join('');
}

/**
 * Rewrites markup inside body/macro content:
 *   <pbr/>, <barcode/>, <pagenumber/>, <totalpages/>, <img src>, CSS-named attributes.
 * `mode` is 'print' (Chromium header/footer templates fill page numbers) or 'preview'.
 */
function transformMarkup(html, ctx, { inHeaderFooter = false } = {}) {
  const { warnings, mode } = ctx;
  let out = ctx.preserveNewlines === false ? html : preserveNewlines(html);
  out = out.replace(/<pbr\b[^>]*\/?>(?:\s*<\/pbr>)?/gi, '<div class="nsv-pbr" style="page-break-after:always;break-after:page"></div>');

  out = out.replace(/<barcode\b([^>]*?)\/?>(?:\s*<\/barcode>)?/gi, (_, attrStr) => renderBarcode(parseAttrs(attrStr).attrs, warnings));

  const canCount = mode === 'print' ? inHeaderFooter : true;
  out = out.replace(/<pagenumber\b[^>]*\/?>(?:\s*<\/pagenumber>)?/gi, () => {
    if (!canCount) warnings.push('<pagenumber/> outside the header/footer macro only works in NetSuite; shown as "#".');
    return canCount ? '<span class="pageNumber">1</span>' : '<span class="pageNumber">#</span>';
  });
  out = out.replace(/<totalpages\b[^>]*\/?>(?:\s*<\/totalpages>)?/gi, () => {
    if (!canCount) warnings.push('<totalpages/> outside the header/footer macro only works in NetSuite; shown as "#".');
    return canCount ? '<span class="totalPages">1</span>' : '<span class="totalPages">#</span>';
  });

  // Generic tag pass: attribute -> style, image src mapping.
  out = out.replace(/<([a-zA-Z][\w:-]*)((?:\s+[^<>]*)?)(\/?)>/g, (whole, tag, attrStr, selfClose) => {
    if (!attrStr || !attrStr.trim()) return whole;
    if (/^(svg|path|rect|g|text|tspan|defs|style|script)$/i.test(tag)) return whole;
    const { attrs } = parseAttrs(attrStr);
    let changed = false;
    const styles = [];
    for (const name of Object.keys(attrs)) {
      if (CSS_ATTRS.has(name)) {
        styles.push(`${name}:${attrs[name]}`);
        delete attrs[name];
        changed = true;
      }
    }
    if (styles.length) attrs.style = [attrs.style, ...styles].filter(Boolean).join(';');
    if (tag.toLowerCase() === 'img' && attrs.src !== undefined) {
      const resolved = resolveImage(attrs.src, ctx);
      if (resolved !== attrs.src) { attrs.src = resolved; changed = true; }
    }
    if (!changed) return whole;
    return `<${tag}${serializeAttrs(attrs)}${selfClose ? ' /' : ''}>`;
  });
  return out;
}

/* ---------- fonts ---------- */

function fontFaceCss(linkTags, ctx) {
  const css = [];
  for (const attrStr of linkTags) {
    const { attrs } = parseAttrs(attrStr);
    if (String(attrs.type || '').toLowerCase() !== 'font' || !attrs.name) continue;
    const family = attrs.name;
    const key = family.toLowerCase().replace(/[^a-z]/g, '');
    const fallbacks = FONT_FALLBACKS[key] || FONT_FALLBACKS[key.replace(/cjk.*/, '')] || ['DejaVu Sans', 'Arial', 'Helvetica'];
    const variants = [
      ['src', 'normal', 'normal'],
      ['src-bold', 'bold', 'normal'],
      ['src-italic', 'normal', 'italic'],
      ['src-bolditalic', 'bold', 'italic']
    ];
    for (const [attr, weight, style] of variants) {
      const src = attrs[attr];
      if (!src && attr !== 'src') continue;
      const sources = [];
      const local = src && !/^nsfont:|^https?:/i.test(src) ? localFont(src, ctx) : null;
      if (local) sources.push(`url("${local}")`);
      for (const f of fallbacks) sources.push(`local("${f}")`);
      css.push(`@font-face{font-family:"${family}";font-weight:${weight};font-style:${style};src:${sources.join(',')};}`);
    }
  }
  return css.join('\n');
}

function localFont(file, ctx) {
  const { assetsDir } = ctx;
  if (!assetsDir) return null;
  const clean = String(file).replace(/^\/?assets\//, '').replace(/^\//, '');
  const full = path.resolve(assetsDir, clean);
  if (!full.startsWith(path.resolve(assetsDir)) || !fs.existsSync(full)) return null;
  const ext = path.extname(full).toLowerCase();
  const mime = ext === '.otf' ? 'font/otf' : ext === '.woff' ? 'font/woff' : ext === '.woff2' ? 'font/woff2' : 'font/ttf';
  return `data:${mime};base64,${fs.readFileSync(full).toString('base64')}`;
}

/* ---------- document conversion ---------- */

function splitDocument(src) {
  const headMatch = src.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  const bodyMatch = src.match(/<body\b([^>]*)>([\s\S]*?)<\/body>/i);
  let head = headMatch ? headMatch[1] : '';
  let bodyAttrs = {};
  let body;
  if (bodyMatch) {
    bodyAttrs = parseAttrs(bodyMatch[1]).attrs;
    body = bodyMatch[2];
  } else {
    // No <body>: treat everything that is not head/pdf wrapper as content.
    body = src.replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, '').replace(/<\/?(pdf|pdfset|html)\b[^>]*>/gi, '');
  }
  return { head, body, bodyAttrs };
}

function extractMacros(head) {
  const macros = {};
  const cleaned = head.replace(/<macrolist\b[^>]*>([\s\S]*?)<\/macrolist>/gi, (_, inner) => {
    const re = /<macro\b([^>]*)>([\s\S]*?)<\/macro>/gi;
    let m;
    while ((m = re.exec(inner))) {
      const { attrs } = parseAttrs(m[1]);
      if (attrs.id) macros[attrs.id] = m[2];
    }
    return '';
  });
  return { macros, head: cleaned };
}

function extractHeadParts(head) {
  const linkTags = [];
  let rest = head.replace(/<link\b([^>]*)\/?>/gi, (whole, attrStr) => {
    if (/type\s*=\s*["']?font/i.test(attrStr)) { linkTags.push(attrStr); return ''; }
    return whole;
  });
  const styles = [];
  rest = rest.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => { styles.push(css); return ''; });
  const metaTitle = (rest.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
  return { linkTags, styles, title: metaTitle.trim() };
}

/**
 * Main entry point.
 * @param {string} rendered  HTML produced by FreeMarker (BFO dialect)
 * @param {object} options   { mode: 'print'|'preview', assets, assetsDir }
 * @returns {{ html, headerTemplate, footerTemplate, page, warnings, title }}
 */
function convert(rendered, options = {}) {
  const warnings = [];
  const ctx = { warnings, mode: options.mode || 'print', assets: options.assets || {}, assetsDir: options.assetsDir, preserveNewlines: options.preserveNewlines };
  let src = stripProlog(rendered);

  // <pdfset> : several <pdf> documents -> one document with page breaks (first head wins).
  const docs = [];
  if (/<pdfset\b/i.test(src)) {
    const re = /<pdf\b[^>]*>([\s\S]*?)<\/pdf>/gi;
    let m;
    while ((m = re.exec(src))) docs.push(m[1]);
    if (docs.length > 1) warnings.push(`<pdfset> with ${docs.length} documents: shown back to back with page breaks; only the first document's header/footer is used.`);
  }
  if (!docs.length) docs.push(src);

  const parts = docs.map(splitDocument);
  const first = parts[0];
  const { macros, head } = extractMacros(first.head);
  const { linkTags, styles, title } = extractHeadParts(head);
  const bodyAttrs = first.bodyAttrs;

  const page = pageSize(bodyAttrs);
  const padding = parseBox(bodyAttrs.padding, 36, page);
  // BFO uses either padding or margin on <body> for the page margins.
  const margin = bodyAttrs.margin ? parseBox(bodyAttrs.margin, 0, page) : null;
  const box = {
    top: padding.top + (margin ? margin.top : 0),
    right: padding.right + (margin ? margin.right : 0),
    bottom: padding.bottom + (margin ? margin.bottom : 0),
    left: padding.left + (margin ? margin.left : 0)
  };
  const headerMacro = bodyAttrs.header ? macros[bodyAttrs.header] : null;
  const footerMacro = bodyAttrs.footer ? macros[bodyAttrs.footer] : null;
  if (bodyAttrs.header && headerMacro == null) warnings.push(`Header macro "${bodyAttrs.header}" not found in <macrolist>.`);
  if (bodyAttrs.footer && footerMacro == null) warnings.push(`Footer macro "${bodyAttrs.footer}" not found in <macrolist>.`);
  const headerHeight = headerMacro != null ? (toPt(bodyAttrs['header-height'], page.height) ?? 72) : 0;
  const footerHeight = footerMacro != null ? (toPt(bodyAttrs['footer-height'], page.height) ?? 36) : 0;

  const bodyHtml = parts
    .map((p) => transformMarkup(p.body, ctx))
    .join('<div class="nsv-pbr" style="page-break-after:always;break-after:page"></div>');

  const bodyStyle = [bodyAttrs.style].filter(Boolean).join(';');
  const bodyClass = bodyAttrs.class ? ` class="${escAttr(bodyAttrs.class)}"` : '';

  const baseCss = `
html,body{margin:0;padding:0;}
body{font-family:${DEFAULT_FONT_STACK};font-size:12pt;line-height:1.2;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
table{border-collapse:collapse;border-spacing:0;}
td,th{vertical-align:top;}
img{max-width:100%;}
.nsv-barcode{vertical-align:middle;}
.nsv-barcode-fallback{font-family:monospace;border:1px dashed #999;padding:2px 4px;}
`;
  const fontCss = fontFaceCss(linkTags, ctx);
  const userCss = styles.join('\n');

  const headerInner = headerMacro != null ? transformMarkup(headerMacro, ctx, { inHeaderFooter: true }) : '';
  const footerInner = footerMacro != null ? transformMarkup(footerMacro, ctx, { inHeaderFooter: true }) : '';

  const result = {
    page: { ...page, margin: box, headerHeight, footerHeight },
    warnings,
    title
  };

  if (ctx.mode === 'print') {
    const contentWidth = page.width - box.left - box.right;
    // Chromium fills elements with class "title", "date" or "url" in header/footer templates
    // with document metadata, so those class names are renamed in the macro markup and CSS.
    const RESERVED = /\b(title|date|url)\b/g;
    const safeClasses = (markup) => markup.replace(/class\s*=\s*"([^"]*)"/g, (m, cls) => `class="${cls.replace(RESERVED, 'nsv-$1')}"`);
    const safeCss = (css) => css.replace(/\.(title|date|url)(?![\w-])/g, '.nsv-$1');
    const hfWrap = (innerRaw, kind) => {
      const inner = safeClasses(innerRaw);
      const h = kind === 'header' ? headerHeight : footerHeight;
      const padTop = kind === 'header' ? box.top : 0;
      const padBottom = kind === 'footer' ? box.bottom : 0;
      return `<style>${baseCss}${fontCss}${safeCss(userCss)}
#header,#footer{padding:0 !important;margin:0 !important;}
</style><div${bodyClass} style="box-sizing:border-box;width:${pt(page.width)};height:${pt(h + padTop + padBottom)};padding:${pt(padTop)} ${pt(box.right)} ${pt(padBottom)} ${pt(box.left)};overflow:hidden;font-family:${DEFAULT_FONT_STACK};font-size:12pt;line-height:1.2;-webkit-print-color-adjust:exact;${bodyStyle}"><div style="width:${pt(contentWidth)};height:${pt(h)};overflow:hidden;">${inner}</div></div>`;
    };
    result.html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>${baseCss}${fontCss}${userCss}</style></head><body${bodyClass} style="${bodyStyle}">${bodyHtml}</body></html>`;
    result.headerTemplate = headerMacro != null ? hfWrap(headerInner, 'header') : '<span></span>';
    result.footerTemplate = footerMacro != null ? hfWrap(footerInner, 'footer') : '<span></span>';
    // Playwright accepts px/in/cm/mm but not pt.
    const inch = (n) => `${Math.round((n / 72) * 10000) / 10000}in`;
    result.pdfOptions = {
      width: inch(page.width),
      height: inch(page.height),
      margin: {
        top: inch(box.top + headerHeight),
        right: inch(box.right),
        bottom: inch(box.bottom + footerHeight),
        left: inch(box.left)
      },
      displayHeaderFooter: headerMacro != null || footerMacro != null,
      headerTemplate: result.headerTemplate,
      footerTemplate: result.footerTemplate,
      printBackground: true,
      preferCSSPageSize: false
    };
    return result;
  }

  // Preview: a single "sheet" with header at top and footer pinned at the bottom.
  const previewCss = `
body.nsv-preview{background:#9a9a9a;padding:24px;}
.nsv-sheet{background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.35);margin:0 auto;box-sizing:border-box;position:relative;display:flex;flex-direction:column;}
.nsv-header,.nsv-footer{flex:none;overflow:hidden;}
.nsv-content{flex:1 1 auto;}
.nsv-pbr{border-top:1px dashed #c33;margin:8px 0;position:relative;}
.nsv-pbr::after{content:"page break";position:absolute;right:0;top:-9px;font:8px sans-serif;color:#c33;background:#fff;padding:0 3px;}
`;
  result.html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>${baseCss}${fontCss}${userCss}${previewCss}</style></head>
<body class="nsv-preview"><div class="nsv-sheet${bodyAttrs.class ? ' ' + escAttr(bodyAttrs.class) : ''}" style="width:${pt(page.width)};min-height:${pt(page.height)};padding:${pt(box.top)} ${pt(box.right)} ${pt(box.bottom)} ${pt(box.left)};${bodyStyle}">
<div class="nsv-header" style="height:${pt(headerHeight)}">${headerInner}</div>
<div class="nsv-content">${bodyHtml}</div>
<div class="nsv-footer" style="height:${pt(footerHeight)}">${footerInner}</div>
</div></body></html>`;
  return result;
}

module.exports = { convert, transformMarkup, parseAttrs, renderBarcode, extractMacros, splitDocument, preserveNewlines };
