'use strict';
/**
 * NetSuite-specific handling layered on top of plain FreeMarker.
 *
 *  - `${record.tranid@label}` is a NetSuite extension (field labels). Real FreeMarker
 *    rejects `@` inside expressions, so templates are rewritten to `record.tranid__label`
 *    and the sample data gets matching `__label` entries from its `@labels` map.
 *  - Sample JSON may carry `@labels`, `@assets` and `@options` keys that are not part of
 *    the record; they are stripped from the data model before rendering.
 *  - NetSuite always exposes a few top-level objects; empty defaults are provided so a
 *    template referencing e.g. `companyInformation` does not fail when a sample omits it.
 */

const LABEL_RE = /([A-Za-z_][A-Za-z0-9_]*)@(label|title)\b/g;

/** Rewrite `foo@label` / `record@title` -> `foo__label` / `record__title` in the template source. */
function preprocessTemplate(source) {
  return source.replace(LABEL_RE, '$1__$2');
}

const DEFAULT_LABELS = {
  tranid: 'Invoice #',
  trandate: 'Date',
  duedate: 'Due Date',
  entity: 'Customer',
  otherrefnum: 'PO #',
  terms: 'Terms',
  salesrep: 'Sales Rep',
  shipmethod: 'Ship Via',
  shipdate: 'Ship Date',
  billaddress: 'Bill To',
  shipaddress: 'Ship To',
  subtotal: 'Subtotal',
  discounttotal: 'Discount',
  taxtotal: 'Tax',
  shippingcost: 'Shipping',
  total: 'Total',
  amountpaid: 'Amount Paid',
  amountremaining: 'Amount Due',
  memo: 'Memo',
  item: 'Item',
  description: 'Description',
  quantity: 'Quantity',
  rate: 'Rate',
  amount: 'Amount',
  options: 'Options',
  units: 'Units',
  taxrate1: 'Tax Rate',
  currency: 'Currency',
  status: 'Status',
  createdfrom: 'Created From',
  location: 'Location',
  department: 'Department',
  class: 'Class',
  subsidiary: 'Subsidiary'
};

/**
 * Walk a sample object and add `<field>__label` keys next to every field,
 * using the provided labels map (per-field overrides) merged with defaults.
 */
function addLabels(node, labels, seen = new WeakSet()) {
  if (Array.isArray(node)) {
    for (const item of node) addLabels(item, labels, seen);
    return node;
  }
  if (!node || typeof node !== 'object' || node instanceof Date) return node;
  if (seen.has(node)) return node;
  seen.add(node);
  for (const key of Object.keys(node)) {
    if (key.startsWith('@')) {
      // "@title": "Invoice" -> record__title (NetSuite's ${record@title})
      node[`__${key.slice(1)}`] = node[key];
      delete node[key];
      continue;
    }
    if (key.includes('__')) continue;
    const value = node[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      addLabels(value, labels, seen);
    } else if (Array.isArray(value)) {
      addLabels(value, labels, seen);
    }
    const labelKey = `${key}__label`;
    if (!(labelKey in node)) node[labelKey] = labels[key] ?? humanize(key);
  }
  return node;
}

function humanize(key) {
  return key
    .replace(/^custbody_?|^custcol_?|^custrecord_?|^custentity_?/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const DEFAULT_MODEL = () => ({
  companyInformation: {
    companyName: 'Sample Company, Inc.',
    legalName: 'Sample Company, Inc.',
    addressText: '123 Main Street\nSan Francisco CA 94105\nUnited States',
    phone: '(555) 555-0100',
    email: 'billing@example.com',
    url: 'www.example.com',
    logoUrl: '',
    taxid: '12-3456789'
  },
  subsidiary: {},
  preferences: {},
  salesTaxItem: {},
  entity: {},
  record: {}
});

/**
 * Build the FreeMarker data model from a sample JSON object.
 * Returns { data, labels, assets, options } where data is what gets rendered.
 */
function buildModel(sample) {
  const src = sample && typeof sample === 'object' ? sample : {};
  const labels = { ...DEFAULT_LABELS, ...(src['@labels'] || {}) };
  const assets = src['@assets'] || {};
  const options = src['@options'] || {};

  const data = DEFAULT_MODEL();
  for (const [key, value] of Object.entries(src)) {
    if (key.startsWith('@')) continue;
    data[key] = value;
  }
  // Shallow default merge for the objects NetSuite always supplies.
  for (const key of ['companyInformation', 'subsidiary', 'preferences', 'salesTaxItem']) {
    if (src[key] && typeof src[key] === 'object') data[key] = { ...DEFAULT_MODEL()[key], ...src[key] };
  }
  addLabels(data, labels);
  // Top-level `${record@title}` / `${record@label}` become top-level variables.
  for (const key of Object.keys(data)) {
    if (key.includes('__')) continue;
    const value = data[key];
    const title = value && typeof value === 'object' && value.__title ? value.__title : (key === 'record' ? 'Transaction' : humanize(key));
    data[`${key}__title`] = title;
    data[`${key}__label`] = (value && typeof value === 'object' && value.__label) || labels[key] || title;
  }
  return { data, labels, assets, options };
}

module.exports = { preprocessTemplate, buildModel, addLabels, humanize, DEFAULT_LABELS };
