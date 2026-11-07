'use strict';
/** CSS length helpers. Internal unit is points (1/72 in). */

const PAGE_SIZES = {
  letter: [612, 792],
  legal: [612, 1008],
  tabloid: [792, 1224],
  ledger: [1224, 792],
  executive: [522, 756],
  a3: [841.89, 1190.55],
  a4: [595.28, 841.89],
  a5: [419.53, 595.28],
  b4: [708.66, 1000.63],
  b5: [498.9, 708.66]
};

/**
 * Parse a CSS length into points. Percentages need a reference (in pt).
 * Returns null when unparseable.
 */
function toPt(value, reference = null) {
  if (value == null) return null;
  const s = String(value).trim().toLowerCase();
  const m = s.match(/^(-?\d*\.?\d+)\s*(pt|px|in|cm|mm|pc|em|%)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case undefined:
    case 'pt': return n;
    case 'px': return n * 0.75;
    case 'in': return n * 72;
    case 'cm': return n * 72 / 2.54;
    case 'mm': return n * 72 / 25.4;
    case 'pc': return n * 12;
    case 'em': return n * 12;
    case '%': return reference == null ? null : (n / 100) * reference;
    default: return null;
  }
}

function pt(n) {
  return `${Math.round(n * 100) / 100}pt`;
}

/** Parse a CSS shorthand "t r b l" (1-4 values) into {top,right,bottom,left} in points. */
function parseBox(value, dflt = 36, ref = {}) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  const v = parts.map((p, i) => toPt(p, i % 2 === 0 ? ref.height : ref.width));
  const out = { top: dflt, right: dflt, bottom: dflt, left: dflt };
  if (v.length === 1 && v[0] != null) out.top = out.right = out.bottom = out.left = v[0];
  else if (v.length === 2) { out.top = out.bottom = v[0] ?? dflt; out.right = out.left = v[1] ?? dflt; }
  else if (v.length === 3) { out.top = v[0] ?? dflt; out.right = out.left = v[1] ?? dflt; out.bottom = v[2] ?? dflt; }
  else if (v.length >= 4) { out.top = v[0] ?? dflt; out.right = v[1] ?? dflt; out.bottom = v[2] ?? dflt; out.left = v[3] ?? dflt; }
  return out;
}

/**
 * Resolve page dimensions from BFO <body> attributes: size="Letter", size="A4-landscape",
 * orientation="landscape", width="8.5in" height="11in".
 */
function pageSize(attrs = {}) {
  let [w, h] = PAGE_SIZES.letter;
  let landscape = false;
  if (attrs.size) {
    const m = String(attrs.size).trim().toLowerCase().match(/^([a-z0-9]+)(?:[-_\s]+(landscape|portrait))?$/);
    if (m && PAGE_SIZES[m[1]]) [w, h] = PAGE_SIZES[m[1]];
    if (m && m[2] === 'landscape') landscape = true;
  }
  if (/landscape/i.test(attrs.orientation || '')) landscape = true;
  if (attrs.width && toPt(attrs.width)) w = toPt(attrs.width);
  if (attrs.height && toPt(attrs.height)) h = toPt(attrs.height);
  if (landscape && w < h) [w, h] = [h, w];
  return { width: w, height: h };
}

module.exports = { toPt, pt, parseBox, pageSize, PAGE_SIZES };
