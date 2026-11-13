'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lib/inbox/email-match');
const Identity = require('../lib/core/identity');
const data = require('./fixtures/projects.json');

const idx = (opts = {}) => M.buildIndex(data, { internalDomains: data.internalDomains, ...opts });
const msg = o => ({ subject: '', body: '', from: { name: 'Someone', email: 'someone@unknown.example' }, to: [], ...o });

test('full project number scores 0.97', () => {
  const r = M.matchMessage(msg({ subject: 'N26-6402 anchor layout' }), idx());
  assert.equal(r.projectId, 'p1');
  assert.equal(r.confidence, 0.97);
});

test('project number with a different prefix falls back to the bare number (0.80)', () => {
  const r = M.matchMessage(msg({ subject: 'X26-6402 anchor layout' }), idx());
  assert.equal(r.projectId, 'p1');
  assert.equal(r.confidence, 0.8);
});

test('bare job number near a work word scores 0.82', () => {
  const r = M.matchMessage(msg({ body: 'Please see job #4821 punch list.' }), idx());
  assert.equal(r.projectId, 'p3');
  assert.equal(r.confidence, 0.82);
});

test('ERP opportunity number scores 0.90', () => {
  const r = M.matchMessage(msg({ body: 'Re OP004821 pricing' }), idx({ erpMap: { 4821: { opp: 'OP004821' } } }));
  assert.equal(r.projectId, 'p3');
  assert.equal(r.confidence, 0.9);
});

test('strong identity key (vendor order) scores 0.95', () => {
  const identity = Identity.build({ projects: [{ id: 'p3', keys: ['N123456'] }] });
  const r = M.matchMessage(msg({ subject: 'Order N123456 status' }), idx({ identity }));
  assert.equal(r.projectId, 'p3');
  assert.equal(r.confidence, 0.95);
});

test('known thread scores 0.88, but only 0.60 when the project is archived', () => {
  const threads = { T1: { projectId: 'p1' }, T2: { projectId: 'p4' } };
  assert.equal(M.matchMessage(msg({ conversationId: 'T1' }), idx({ threads })).confidence, 0.88);
  assert.equal(M.matchMessage(msg({ conversationId: 'T2' }), idx({ threads })).confidence, 0.6);
});

test('contact email scores 0.78 and evidence kinds add +0.12 each', () => {
  const from = { name: 'Robin Lowell', email: 'robin.lowell@harborpoint-fab.example' };
  const r = M.matchMessage(msg({ from, subject: 'Question' }), idx());
  assert.equal(r.projectId, 'p3');
  // contact email 0.78 is the best single score; contact (email + name) is one kind
  assert.equal(r.confidence, 0.78);
  const r2 = M.matchMessage(msg({ from, subject: 'Riverton question', body: 'see job 4821' }), idx());
  // number 0.82 + contact + name word = 3 kinds → 0.82 + 0.24
  assert.equal(r2.confidence, 0.99);
});

test('client domain alone scores 0.62', () => {
  const r = M.matchMessage(msg({ from: { name: 'New Person', email: 'new.person@harborpoint-fab.example' } }), idx());
  assert.equal(r.projectId, 'p3');
  assert.equal(r.confidence, 0.62);
});

test('a shared contact between sibling projects is capped (no sure evidence)', () => {
  const r = M.matchMessage(msg({ from: { name: 'Sam Archer', email: 'sam.archer@maplewood-metal.example' }, subject: 'Question' }), idx());
  assert.ok(['p1', 'p2'].includes(r.projectId));
  assert.ok(r.confidence <= 0.55, `got ${r.confidence}`);
  assert.equal(r.alternatives.length >= 1, true);
});

test('a single word hint is capped at 0.55', () => {
  const r = M.matchMessage(msg({ subject: 'Riverton update' }), idx());
  assert.equal(r.projectId, 'p3');
  assert.ok(r.confidence <= 0.55);
});

test('no evidence → unassigned', () => {
  const r = M.matchMessage(msg({ subject: 'Lunch' }), idx());
  assert.equal(r.projectId, null);
  assert.equal(r.confidence, 0);
});

test('noise classification', () => {
  const i = idx();
  assert.equal(M.classifyNoise(msg({ from: { email: 'no-reply@shop.example' }, subject: 'hello' }), i), 'automated sender');
  assert.equal(M.classifyNoise(msg({ subject: 'Your verification code' }), i), 'notification subject');
  assert.equal(M.classifyNoise(msg({ subject: 'Booth layout question' }), i), null);
  assert.equal(M.classifyNoise(msg({ from: { email: 'a@finishing-systems.example' }, subject: 'Lunch?' }), i), 'internal, no work keywords');
});

test('status change from the text, only from an allowed status', () => {
  const p = { status: 'Quoting' };
  const s = M.statusChange({ subject: 'PO', body: 'Please find attached our purchase order.' }, p);
  assert.equal(s.to, 'In Progress');
  assert.equal(M.statusChange({ subject: '', body: 'Please find attached our purchase order.' }, { status: 'In Progress' }), null);
  assert.equal(M.statusChange({ subject: '', body: 'We went with another vendor.' }, p).to, 'Lost / Dead');
});

test('ERP new-opportunity notice', () => {
  const n = M.detectNewOpportunity({ subject: 'New opportunity OP090017 assigned to you - Client A Manufacturing', body: 'Account Name: Client A Manufacturing\nDescription: Second booth' });
  assert.deepEqual(n, { opp: 'OP090017', company: 'Client A Manufacturing', description: 'Second booth' });
});
