// ─── Project identity: strong keys that name one project without doubt ───────
// A mail, file or ERP line that carries one of these belongs to that project:
//   vendor A order N123456 · vendor B order K20123456 · our PO ABCPO012345 (also DEF/GHI)
//   ERP opportunity OP001234 · project number N26-6402 (handled by email-match) · manual keys (p.keys)
// In the private tool the keys also come from the project folder's file names; that folder walk is
// not part of this package. A key found in more than one project is kept but marked shared (weaker).
'use strict';

// Key formats. All formats here are fictional stand-ins for the real vendors' order numbers.
const KEY_RX = [
  { kind: 'vendor-a-order', rx: /\bN\d{6}\b/g, label: 'Northbeam order' },
  { kind: 'vendor-b-order', rx: /\bK20\d{6}\b/g, label: 'Keller order' },
  { kind: 'our-po', rx: /\b(?:ABC|DEF|GHI)PO\d{6}\b/g, label: 'PO' },
  { kind: 'opp', rx: /\bOP\d{6}\b/g, label: 'opportunity' },
];

function keysInText(text) {
  const out = [];
  const t = String(text || '').toUpperCase();
  for (const k of KEY_RX) for (const m of t.matchAll(k.rx)) out.push({ key: m[0], kind: k.kind, label: k.label });
  return out;
}

function bareNumber(pn) { return String(pn || '').replace(/^[A-Z]\d{2}-/i, ''); }

// → { builtAt, projects: { pid: [{ key, kind, source }] } }
// erpMap: { bareNumber: { opp } } (an export of the ERP's opportunities; optional)
function build(data, erpMap) {
  const projects = {};
  for (const p of (data && data.projects) || []) {
    const list = [];
    const add = (key, kind, source) => { if (key && !list.some(x => x.key === key)) list.push({ key, kind, source }); };
    const row = erpMap && erpMap[bareNumber(p.projectNumber)];
    if (row && row.opp) add(String(row.opp).toUpperCase(), 'opp', 'erp');
    if (p.erpOpp) add(String(p.erpOpp).toUpperCase(), 'opp', 'tracker');
    for (const k of p.keys || []) add(String(k.key || k).toUpperCase(), k.kind || 'manual', 'manual');
    projects[p.id] = list;
  }
  return { builtAt: new Date().toISOString(), projects };
}

// key → Set(pid) from a build() result
function indexOf(identity) {
  const byKey = new Map();
  for (const [pid, list] of Object.entries((identity && identity.projects) || {}))
    for (const k of list) { if (!byKey.has(k.key)) byKey.set(k.key, new Set()); byKey.get(k.key).add(pid); }
  return byKey;
}

module.exports = { KEY_RX, keysInText, build, indexOf, bareNumber };
