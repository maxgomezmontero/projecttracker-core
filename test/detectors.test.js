'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../lib/inbox/detectors');

const vendorA = 'orders@northbeam.example';
const m = o => ({ subject: '', body: '', from: { email: 'x@y.example' }, receivedTime: '2027-03-01T10:00:00', direction: 'received', ...o });
const kinds = items => items.map(i => i.kind);

test('there are 13 detectors and each has an id and an active flag', () => {
  assert.equal(D.DETECTORS.length, 13);
  for (const d of D.DETECTORS) assert.equal(typeof d.active, 'boolean');
  assert.equal(new Set(D.DETECTORS.map(d => d.id)).size, 13);
});

test('vendor A order acceptance, with submittals attached', () => {
  const out = D.detect(m({ from: { email: vendorA }, subject: 'PO Acceptance Report For Order No: N123456', attachments: ['N123456_Submittals.pdf'] }));
  assert.deepEqual(kinds(out), ['order-accepted', 'submittals']);
  assert.equal(out[0].key, 'N123456');
  assert.equal(out[0].date, '2027-03-01');
});

test('replies, sent mail and wrong senders do not count', () => {
  const s = 'PO Acceptance Report For Order No: N123456';
  assert.deepEqual(D.detect(m({ from: { email: vendorA }, subject: 'RE: ' + s })), []);
  assert.deepEqual(D.detect(m({ from: { email: vendorA }, subject: s, direction: 'sent' })), []);
  assert.deepEqual(D.detect(m({ from: { email: 'someone@other.example' }, subject: s })), []);
});

test('ship date from the body, and a change detected against the previous notice', () => {
  const subj = 'Ship Date Confirmation Report For Order No: N123456';
  const first = D.detect(m({ from: { email: vendorA }, subject: subj, body: 'Ship date: 3/17/2027', receivedTime: '2027-02-01' }));
  assert.equal(first[0].kind, 'ship-date');
  assert.equal(first[0].value.shipDate, '2027-03-17');
  const second = D.detect(m({ from: { email: vendorA }, subject: subj, body: 'Revised ship date: 3/31/2027', receivedTime: '2027-02-20' }));
  const tag = (xs, id) => xs.map(x => ({ ...x, entryId: id }));
  const out = D.annotate(tag(second, 'b'), tag(first, 'a'));
  const ch = out.find(i => i.kind === 'ship-date-changed');
  assert.ok(ch);
  assert.equal(ch.value.from, '2027-03-17');
  assert.equal(ch.value.to, '2027-03-31');
  // Same date again → no change
  const same = D.detect(m({ from: { email: vendorA }, subject: subj, body: 'Ship date: 3/17/2027', receivedTime: '2027-02-20' }));
  assert.equal(D.annotate(tag(same, 'c'), tag(first, 'a')).some(i => i.kind === 'ship-date-changed'), false);
});

test('ship report lines: a moved line is a change, an added line is not', () => {
  const subj = 'Ship Date Confirmation Report For Order No: N123456';
  const a = D.detect(m({ from: { email: vendorA }, subject: subj, receivedTime: '2027-02-01',
    shipReport: { order: 'N123456', shipDate: '2027-03-17', firstShipDate: '2027-03-17', items: [{ item: 1, desc: 'Booth', date: '2027-03-17' }] } }));
  const b = D.detect(m({ from: { email: vendorA }, subject: subj, receivedTime: '2027-02-15',
    shipReport: { order: 'N123456', shipDate: '2027-03-17', firstShipDate: '2027-03-17', items: [{ item: 1, desc: 'Booth', date: '2027-03-17' }, { item: 2, desc: 'Filters', date: '2027-04-02' }] } }));
  assert.equal(D.annotate(b.map(x => ({ ...x, entryId: 'b' })), a.map(x => ({ ...x, entryId: 'a' }))).some(i => i.kind === 'ship-date-changed'), false);
});

test('vendor B ready-to-ship and submittals', () => {
  const from = { email: 'pm@keller-ovens.example' };
  assert.deepEqual(kinds(D.detect(m({ from, subject: 'Product Ready To Ship (K20251234)' }))), ['ready-to-ship']);
  const s = D.detect(m({ from, subject: 'K20251234 Cure oven Submittals: Rev 2.1' }));
  assert.equal(s[0].kind, 'submittals');
  assert.equal(s[0].value, 'Rev 2.1');
});

test('ERP vendor PO and new opportunity', () => {
  const po = D.detect(m({ subject: 'Purchase Order # ABCPO012345 - Northbeam Finishing' }));
  assert.equal(po[0].kind, 'vendor-po');
  assert.equal(po[0].vendor, 'Northbeam Finishing');
  const opp = D.detect(m({ subject: 'New opportunity OP090017 assigned to you - Client A' }));
  assert.equal(opp[0].kind, 'new-opportunity');
  assert.equal(opp[0].key, 'OP090017');
});

test('portal notices are client-level', () => {
  const r = D.detect(m({ from: { email: 'notices@buildportal.example' }, subject: 'Daily due date reminder PRJ_ClientA_2027', body: 'Client A - Plant 2 • PRJ_ClientA_2027\n2 overdue\n5 total upcoming' }));
  assert.equal(r[0].kind, 'portal-reminder');
  assert.deepEqual(r[0].value, { overdue: 2, upcoming: 5 });
  const v = D.detect(m({ subject: '[ClientA-VGATE2] - Work Order Draft WO7781', body: 'Contractor Name: Alex Kim' }));
  assert.equal(v[0].kind, 'site-access');
  assert.equal(v[0].client, 'ClientA');
  const pending = D.detect(m({ from: { email: 'sign@signbox.example' }, subject: 'Please sign: Handbook.pdf', body: 'SignBox request. The document Handbook.pdf' }));
  assert.deepEqual(pending, []);
  const done = D.detect(m({ from: { name: 'Client A', email: 'sign@signbox.example' }, subject: 'Completed: Handbook.pdf', body: 'SignBox: has been completed' }));
  assert.equal(done[0].value, 'signed');
});

test('OCIP threads, and out-of-office only when asked for inactive detectors', () => {
  assert.equal(D.detect(m({ subject: 'RE: OCIP enrollment' }))[0].kind, 'insurance');
  const ooo = m({ subject: 'Automatic reply: drawings', body: 'I will return on 3/9/2027.', from: { name: 'Pat', email: 'pat@client.example' } });
  assert.equal(D.detect(ooo, { activeOnly: true }).length, 0);
  assert.equal(D.detect(ooo)[0].value, '2027-03-09');
  assert.equal(D.returnDate('Back in the office January 5', '2027'), '2027-01-05');
});

test('attach: strong key first, then the matcher at >= 0.88 only', () => {
  const keyIndex = new Map([['N123456', new Set(['p1'])]]);
  const items = [{ kind: 'order-accepted', key: 'N123456' }, { kind: 'vendor-po', key: 'ABCPO000001' }];
  const out = D.attach(items, { keyIndex, match: { projectId: 'p9', confidence: 0.9 } });
  assert.equal(out[0].projectId, 'p1');
  assert.equal(out[0].via, 'key');
  assert.equal(out[1].projectId, 'p9');
  assert.equal(D.attach([items[1]], { keyIndex, match: { projectId: 'p9', confidence: 0.8 } })[0].projectId, null);
});
