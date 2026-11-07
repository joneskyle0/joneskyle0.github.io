'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { preprocessTemplate, buildModel, humanize } = require('../src/netsuite');

test('rewrites @label and @title NetSuite extensions', () => {
  assert.equal(preprocessTemplate('${record.tranid@label} ${item.amount@label}'), '${record.tranid__label} ${item.amount__label}');
  assert.equal(preprocessTemplate('<span>${record@title}</span>'), '<span>${record__title}</span>');
  assert.equal(preprocessTemplate('email@label.com'), 'email@label.com'.replace('email@label', 'email__label'));
});

test('buildModel adds labels, titles and defaults and strips @ keys', () => {
  const { data, assets, options } = buildModel({
    '@labels': { tranid: 'Invoice Number', custbody_po: 'Customer PO' },
    '@assets': { 'media.nl?id=1': 'logo.png' },
    '@options': { locale: 'en_GB' },
    record: { '@title': 'Invoice', tranid: 'INV-1', custbody_po: 'PO-9', item: [{ item: 'A', amount: '1.00' }] }
  });
  assert.equal(data.record.tranid__label, 'Invoice Number');
  assert.equal(data.record.custbody_po__label, 'Customer PO');
  assert.equal(data.record.item[0].amount__label, 'Amount');
  assert.equal(data.record__title, 'Invoice');
  assert.equal(data.record.__title, 'Invoice');
  assert.equal(data['@labels'], undefined);
  assert.equal(data.companyInformation.companyName, 'Sample Company, Inc.');
  assert.deepEqual(assets, { 'media.nl?id=1': 'logo.png' });
  assert.equal(options.locale, 'en_GB');
});

test('humanize turns field ids into readable labels', () => {
  assert.equal(humanize('custbody_delivery_date'), 'Delivery Date');
  assert.equal(humanize('shipmethod'), 'Shipmethod');
});
