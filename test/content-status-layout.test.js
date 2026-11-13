'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const M = require('../lib/inbox/email-match');
const C = require('../lib/inbox/content-match');
const H = require('../lib/core/status-hints');
const L = require('../lib/drawings/layout-check');
const CHECKLIST = require('../lib/drawings/drawing-checklist');
const data = require('./fixtures/projects.json');
const set = require('./fixtures/layout-set.json');

const idx = () => M.buildIndex(data, { internalDomains: data.internalDomains });
const msg = o => ({ subject: '', body: '', from: { email: 'someone@unknown.example' }, to: [], ...o });

// ── content-match ────────────────────────────────────────────────────────────
test('client named in the body points to its one active project', () => {
  const h = C.hits(msg({ body: 'We are on site for Harbor Point next week.' }), idx(), null, null);
  assert.ok(h.some(x => x.pid === 'p3' && x.kind === 'client-body'));
});

test('a project word spelled one edit away in the subject counts', () => {
  const h = C.hits(msg({ subject: 'Rivertn blast room' }), idx(), null, null);
  assert.ok(h.some(x => x.pid === 'p3' && /spelled differently/.test(x.reason)));
});

test('vendor order learned from approved mail is used later', () => {
  const mem = C.memory();
  C.learn(mem, msg({ subject: 'Order N654321 accepted' }), 'p1');
  const { match } = C.refine(msg({ subject: 'Question on N654321' }), { projectId: null, confidence: 0, alternatives: [] }, idx(), mem);
  assert.equal(match.projectId, 'p1');
  assert.ok(match.confidence >= 0.9);
});

test('portal notice goes to the client\'s active project as site access', () => {
  const r = C.refine(msg({ subject: '[Harbor Point-VGATE2] - Work Order Draft for Alex Kim was created' }), { projectId: null, confidence: 0, alternatives: [] }, idx(), C.memory());
  assert.equal(r.match.projectId, 'p3');
  assert.ok(r.extra.portal);
});

test('expense notices are noise', () => {
  const r = C.refine(msg({ subject: 'Expense claim #44 has been approved' }), { projectId: 'p1', confidence: 0.9 }, idx(), null);
  assert.equal(r.extra.noise, 'expense notice');
  assert.equal(r.match.projectId, null);
});

// ── status hints ─────────────────────────────────────────────────────────────
test('status hints: cooling, dead, reactivated, ERP ahead/behind', () => {
  const p = (status, date) => ({ status, notes: date ? [{ date }] : [] });
  assert.equal(H.hint(p('Quoted – Hot', '2027-01-01'), { today: '2027-03-01' }).kind, 'cooling');
  assert.equal(H.hint(p('Quoted – Old', '2026-10-01'), { today: '2027-03-01' }).kind, 'dead');
  assert.equal(H.hint(p('Quoted – Old', '2027-02-25'), { today: '2027-03-01' }).to, 'Quoted – Hot');
  assert.equal(H.hint(p('Quoting', '2027-02-25'), { today: '2027-03-01', erp: { stage: '8.9 Sold' } }).to, 'In Progress');
  assert.equal(H.hint(p('In Progress', '2027-02-25'), { today: '2027-03-01', erp: { stage: '8.7 Quoted' } }).kind, 'erp-behind');
  assert.equal(H.hint(p('In Progress', '2027-02-25'), { today: '2027-03-01' }), null);
  assert.equal(H.erpClass({ status: 'Lost' }), 'lost');
});

// ── layout check ─────────────────────────────────────────────────────────────
test('the checklist has 44 criteria in 7 groups', () => {
  assert.equal(CHECKLIST.groups.length, 7);
  assert.equal(CHECKLIST.groups.flatMap(g => g.items).length, 44);
});

test('a clean synthetic layout set passes the text rules it can check', () => {
  const r = L.checkLayout(set);
  const failed = Object.entries(r.results).filter(([, v]) => v.ok === false).map(([k, v]) => `${k}: ${v.why}`);
  assert.deepEqual(failed, []);
  assert.equal(Object.keys(r.results).length + r.notCovered.length, 44);
});

test('defects are flagged with a reason', () => {
  const bad = JSON.parse(JSON.stringify(set));
  bad.files.push('N26-6418-L01_Rev1_ClientA_Line.pdf');                 // older revision left behind
  bad.sheets[0].rows = bad.sheets[0].rows.filter(r => r[0] !== 'A1');   // no compressed air row
  bad.sheets[0].rows.push(['NOTE: GAS PRESSURE TBD']);
  bad.sheets[0].rows.find(r => r[0] === 'X1')[0] = 'F2';                // exhaust tagged as fresh air
  const r = L.checkLayout(bad).results;
  assert.equal(r['1-6'].ok, false);
  assert.match(r['4-4'].why, /compressed air/);
  assert.equal(r['4-7'].ok, false);
  assert.equal(r['4-2'].ok, false);
});

test('TOR is compared with quote text (3-8)', () => {
  const s = { ...set, references: [{ name: 'Quote Q-1', text: 'Conveyor at 14\'-6" TOR' }] };
  assert.equal(L.checkLayout(s).results['3-8'].ok, false);
  const ok = { ...set, references: [{ name: 'Quote Q-1', text: 'TOR 14\'-0"' }] };
  assert.equal(L.checkLayout(ok).results['3-8'].ok, true);
});

test('parseFtIn and revOf', () => {
  assert.equal(L.parseFtIn('12\'-6"'), 12.5);
  assert.equal(L.parseFtIn('30"'), 2.5);
  assert.equal(L.revOf('N26-6418-L01_Rev3_X.pdf'), 3);
  assert.equal(L.revOf('Sheet-REV B.pdf'), 2);
});

// ── CLI ──────────────────────────────────────────────────────────────────────
test('CLI match reads JSONL and writes JSONL', () => {
  const cli = path.join(__dirname, '..', 'cli', 'ptcore.js');
  const input = [msg({ id: 'm1', subject: 'N26-6402 punch list' }), msg({ id: 'm2', subject: 'Lunch' })].map(x => JSON.stringify(x)).join('\n');
  const out = execFileSync(process.execPath, [cli, 'match', '--projects', path.join(__dirname, 'fixtures', 'projects.json')], { input, encoding: 'utf8' })
    .trim().split('\n').map(l => JSON.parse(l));
  assert.equal(out[0].id, 'm1');
  assert.equal(out[0].projectId, 'p1');
  assert.equal(out[1].projectId, null);
});

test('CLI detect uses message history for ship-date changes', () => {
  const cli = path.join(__dirname, '..', 'cli', 'ptcore.js');
  const subj = 'Ship Date Confirmation Report For Order No: N123456';
  const from = { email: 'orders@northbeam.example' };
  const prev = { subject: subj, body: 'Ship date: 3/17/2027', from, receivedTime: '2027-02-01' };
  const cur = { id: 'm1', subject: subj, body: 'Revised ship date: 4/2/2027', from, receivedTime: '2027-02-20', history: [prev] };
  const out = JSON.parse(execFileSync(process.execPath, [cli, 'detect'], { input: JSON.stringify(cur), encoding: 'utf8' }));
  assert.ok(out.milestones.some(x => x.kind === 'ship-date-changed' && x.value.to === '2027-04-02'));
});
