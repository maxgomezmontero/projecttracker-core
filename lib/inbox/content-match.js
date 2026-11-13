// ─── Content-weighted project assignment ─────────────────────────────────────────────────────
// lib/inbox/email-match.matchMessage scores numbers, threads, contacts and words in the subject. Mail
// that has none of those (a vendor's first mail about the job, an internal thread that only names the
// client in the body, a customer portal notice) went to no project, or to the wrong one. This module
// adds what an engineer reads in the content:
//   • the client named in the body (top text, not the quoted history), a project-name word written
//     with a typo ("Ashfrod") or as a state code ("Client IN", "Client OH");
//   • vendor order numbers learned from mail the engineer already approved;
//   • organisations / names seen only in one project's approved mail;
//   • a thread the engine itself placed from content (softer than a thread a human approved);
//   • the stage the mail talks about, to choose between sibling projects of one client
//     (approval drawings / PO → the In Progress one; quote / adder → the Quoting one);
//   • customer portal notices (contractor-portal work orders and checklists, e-signature handbooks):
//     the client's active project, as site-access progress (not an action for the engineer).
// Pure (no fs). Memory is a plain object built by learn() / observe(); the tool rebuilds it from the
// approved items on each run (cheap: a few hundred mails).
// Portal names and domains are fictional stand-ins for the real services (see SCRUBBING.md).
'use strict';
const M = require('./email-match');
const Identity = require('../core/identity');

const lc = s => String(s || '').toLowerCase();
const squash = s => lc(s).replace(/[^a-z0-9]+/g, '');
const domainOf = e => { const m = lc(e).match(/@([a-z0-9.-]+)$/); return m ? m[1] : ''; };
const baseDomain = d => { const p = lc(d).split('.').filter(Boolean); return p.length > 2 ? p.slice(-2).join('.') : p.join('.'); };
const INTERNAL = M.INTERNAL_DOMAINS;
const isInternal = d => INTERNAL.some(x => d === x || d.endsWith('.' + x));
const GENERIC = /^(gmail|yahoo|aol|outlook|hotmail|icloud|live|msn|comcast|att|signbox|vendorgate|docusign|microsoft|office|google|zoom|teams)$/;
const ARCHIVED = M.ARCHIVED_STATUSES;
const ACTIVE = M.ACTIVE_STATUSES;

// Text the sender wrote in this mail (above the quoted history), without the signature block.
function topText(body) {
  const t = String(body || '').replace(/\r/g, '').split(/\n\s*(?:From:|Sent:|-{2,}\s*Original|On .{5,80}wrote:|_{5,})/i)[0];
  return t;
}

// US state codes written in capitals after a client word: "Client IN", "Client OH - …"
const STATES = { IN: 'indiana', OH: 'ohio', IL: 'illinois', WI: 'wisconsin', MI: 'michigan', KY: 'kentucky', IA: 'iowa', MO: 'missouri',
  MN: 'minnesota', TX: 'texas', GA: 'georgia', TN: 'tennessee', PA: 'pennsylvania', NC: 'north carolina', SC: 'south carolina',
  AL: 'alabama', UT: 'utah', AZ: 'arizona', CA: 'california', CO: 'colorado', NY: 'new york', VA: 'virginia', FL: 'florida' };

// One edit away (typos in subjects); only for long words.
function near(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 6 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// Capitalised words and short proper-noun phrases: "Harbor/Point Doors", "Overhead Door".
const COMMON = new Set(('thanks thank hello please regards best team good morning afternoon evening monday tuesday wednesday thursday friday saturday sunday ' +
  'january february march april june july august september october november december sorry great perfect sounds understood attached below above note here there ' +
  'just could would will what when where which while how why does were your their once also yes okay office mobile phone email confidential automatic reply ' +
  'order report ship date confirmation customer service industrial sales support project engineer equipment sent from subject ' +
  'regarding received question questions update updates meeting call today tomorrow week next last booth booths door doors drawing drawings layout quote system ' +
  'plant facility building site start install installation these those other another every each since until after before about would should might maybe ' +
  'hope happy following follow looking working work need needs needed want wants know think best kind dear guys everyone all any some more most much many ' +
  'start-up startup thanks, regards, image').split(/\s+/));
function entitiesOf(msg) {
  const out = new Set();
  for (const p of [msg.from, ...(msg.to || []), ...(msg.cc || [])]) {
    if (!p || !p.email) continue;
    const d = domainOf(p.email);
    if (!d || isInternal(d)) continue;
    const label = squash(baseDomain(d).split('.')[0]);
    if (label.length >= 4 && !GENERIC.test(label)) out.add(label);
  }
  const text = (msg.subject || '') + '\n' + topText(msg.body).slice(0, 3000);
  for (const m of text.matchAll(/(^|[^A-Za-z0-9])([A-Z][a-zA-Z]{2,}(?:[\/\-& ][A-Z][a-zA-Z]{2,}){0,2})/g)) {
    const phrase = m[2];
    const words = phrase.split(/[\/\-& ]/).map(lc);
    if (words.every(w => COMMON.has(w))) continue;
    const before = text.slice(Math.max(0, m.index - 2), m.index + m[1].length);
    // A lone word that only starts a sentence ("Understood.", "Regarding …") says nothing
    if (words.length === 1 && (/(^|[.!?:\n]\s*)$/.test(before) || m.index === 0)) continue;
    const k = squash(phrase);
    if (k.length >= 5 && (words.length > 1 || k.length >= 6)) out.add(k);
    // every run of two or more words too ("Harbor/Point Doors" also gives "harborpoint")
    for (let i = 0; i < words.length; i++) for (let j = i + 2; j < words.length; j++) out.add(words.slice(i, j).join(''));
    if (words.length > 1) for (const w of words) if (w.length >= 6 && !COMMON.has(w)) out.add(w);
  }
  // Vendors appear in every project that buys from them: never an identity
  return new Set([...out].filter(k => !VENDOR_KEYS.some(v => k.includes(v))));
}
const VENDOR_KEYS = require('../core/parties').SEED_VENDORS
  .flatMap(v => [v.name, ...(v.aliases || []).map(a => a.a || a), ...(v.domains || []).map(d => d.split('.')[0])])
  .flatMap(n => [squash(n), ...lc(n).split(/[^a-z0-9]+/)]).filter(w => w.length >= 4);

// ── Customer portal notices ───────────────────────────────────────────────────────────────
// Contractor portal ([ClientA-VGATE2] - Work Order Draft for X was created / Checklist Actions waiting for X) and
// e-signature service (sender display name = the customer, links on <client>.signbox.example).
function portalNotice(msg) {
  if (!msg || msg.direction === 'sent') return null;
  const s = String(msg.subject || '');
  const body = String(msg.body || '');
  const from = lc(msg.from && msg.from.email);
  const v = /^\s*\[([^\]]*?)-?VGATE\d*\]\s*-\s*(.+)$/i.exec(s);
  if (v || /vendorgate\.example$/.test(from)) {
    const client = v ? v[1].trim() : null;
    const rest = v ? v[2] : s;
    const who = (/(?:for|waiting for)\s+([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+){0,2})\s+(?:was|on Job)/.exec(rest) || [])[1]
      || (/Contractor Name:\s*\*?\s*([^\n*]+)/i.exec(body) || [])[1] || (/Candidate:\s*([^\n]+)/i.exec(body) || [])[1] || null;
    const wo = (/\bWO\d+\b/.exec(rest + ' ' + body) || [])[0] || null;
    const what = /checklist/i.test(rest) ? 'checklist' : /work order (draft|created)|draft/i.test(rest) ? 'work order' : /ended/i.test(rest) ? 'work order ended' : 'notice';
    const items = what === 'checklist' ? [...body.matchAll(/^\s*\*?\s*\d{4,6}\s+(.+?)\s*$/gm)].map(x => x[1].trim()).slice(0, 5) : [];
    return { portal: 'VendorGate', client, person: who ? who.trim() : null, key: wo, what, items };
  }
  if (/(^|\.)signbox\.example$/.test(domainOf(from)) && /signbox/i.test(body)) {
    const site = (/https?:\/\/([a-z0-9-]+)\.signbox\.example/i.exec(body) || [])[1] || '';
    const sender = (/sent by [^(]*\(([^)@\s]+@[^)\s]+)\)/i.exec(body) || [])[1] || '';
    const client = (msg.from && msg.from.name && !/signbox/i.test(msg.from.name) ? msg.from.name : '') || (sender ? baseDomain(domainOf(sender)).split('.')[0] : '') || site.replace(/automotive|inc|corp$/i, '');
    const doc = ((/signing\s+(.+?\.pdf)/i.exec(body) || /The document\s+(.+?\.pdf)/i.exec(body) || /Completed:\s*(.+?\.pdf)/i.exec(s) || [])[1] || '')
      .replace(/\s+\d{4}-\d{2}-\d{2}\s+[\d:.]+\.pdf$/i, '').replace(/\.pdf$/i, '').trim();
    const what = /^\s*completed:/i.test(s) || /has been completed/i.test(body) ? 'signed' : 'sign request';
    return { portal: 'SignBox', client: client || null, person: null, key: (/Document ID:\s*([A-Z0-9]+)/.exec(body) || [])[1] || null, what, doc: doc || null };
  }
  return null;
}
const portalText = p => {
  const cl = p.client ? p.client + ' ' : '';
  if (p.portal === 'VendorGate') return `Site access: ${cl}VendorGate ${p.what}${p.person ? ' for ' + p.person : ''}${p.key ? ' (' + p.key + ')' : ''}${p.items && p.items.length ? ' — ' + p.items.join(', ') : ''}`;
  return `Site access: ${cl}${p.doc || 'document'} ${p.what === 'signed' ? 'signed (SignBox)' : '— signature started (SignBox)'}`;
};

// Projects of a client (by name tokens), active first, most recently touched first.
function projectsOfClient(idx, client) {
  const toks = lc(client).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(t => t.length >= 3);
  if (!toks.length) return [];
  const ps = idx.projects.filter(p => { const c = lc(p.client + ' ' + p.name); return toks.some(t => new RegExp('\\b' + t).test(c)); });
  return ps.sort((a, b) => (ACTIVE.includes(b.status) - ACTIVE.includes(a.status)) || ((b.status === 'In Progress') - (a.status === 'In Progress'))
    || lc(b.lastUpdated).localeCompare(lc(a.lastUpdated)));
}

// ── Memory ──────────────────────────────────────────────────────────────────────────────────
function memory() { return { ent: new Map(), keys: new Map(), threads: new Map() }; }
const bump = (map, k, pid) => { if (!map.has(k)) map.set(k, new Map()); const m = map.get(k); m.set(pid, (m.get(pid) || 0) + 1); };

// From a mail a human approved for a project: its organisations / names, its vendor order numbers, its thread.
function learn(mem, msg, pid) {
  if (!mem || !msg || !pid) return;
  for (const k of entitiesOf(msg)) bump(mem.ent, k, pid);
  for (const k of Identity.keysInText((msg.subject || '') + '\n' + topText(msg.body))) bump(mem.keys, k.key, pid);
  if (msg.conversationId) mem.threads.set(msg.conversationId, { pid, conf: 1, by: 'approval' });
}
// From the engine's own assignment of a mail: only the thread (and entities when the match was sure).
function observe(mem, msg, pid, conf) {
  if (!mem || !msg || !pid) return;
  if (conf >= 0.88) learn(mem, msg, pid);
  else if (conf >= 0.5 && msg.conversationId && !mem.threads.has(msg.conversationId)) mem.threads.set(msg.conversationId, { pid, conf, by: 'content' });
}

// One project only (an entity seen in two projects tells nothing)
const only = (map, k, idx) => {
  const m = map.get(k); if (!m) return null;
  const pids = [...m.keys()].filter(pid => idx.projById.has(pid));
  return pids.length === 1 ? pids[0] : null;
};

// Execution vs quoting vocabulary (to pick between sibling projects of one client)
const EXEC_RX = /\b(purchase order|approval drawings?|approvals?|submittals?|po acceptance|signed (off|drawings)|fabrication|ship(ping)? date|start-?up|commissioning|install(ation)?|punch|on ?site|badges?|production)\b/i;
const QUOTE_RX = /\b(quote|quotation|rfq|budget(ary)?|pricing|adder|deduct|option|proposal)\b/i;

// Extra evidence for matchMessage: [{ pid, score, reason, kind }]
function hits(msg, idx, mem, first) {
  const out = [];
  const add = (pid, score, reason, kind) => { if (pid && idx.projById.has(pid)) out.push({ pid, score, reason, kind }); };
  const subj = String(msg.subject || '');
  const top = topText(msg.body).slice(0, 3000);
  const body1 = top.split(/\n\s*(?:thanks|thank you|regards|best regards|sincerely)\b/i)[0];

  // Client named in the body (capitalised, in this mail's own text): the client's one active project
  for (const [tok, pids] of idx.byClientTok) {
    if (!new RegExp('\\b' + tok[0].toUpperCase() + tok.slice(1) + '\\b|\\b' + tok.toUpperCase() + '\\b').test(body1)) continue;
    const act = [...pids].filter(pid => ACTIVE.includes((idx.projById.get(pid) || {}).status) && (idx.projById.get(pid) || {}).status !== 'On Hold');
    if (act.length === 1) add(act[0], 0.52, `client "${tok}" in the mail text`, 'client-body');
  }
  // Project / client words written with a typo or as a state code in the subject
  const subjWords = lc(subj).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  // "Client IN": a state code counts only right after a word of that project's client
  // ("Example Metal Products, IN" is just the client's own state)
  const states = [...subj.matchAll(/([A-Za-z]{3,})[\s\/-]+([A-Z]{2})\b/g)].filter(m => STATES[m[2]]).map(m => ({ state: STATES[m[2]], after: lc(m[1]) }));
  for (const map of [idx.byClientTok, idx.byNameTok]) for (const [tok, pids] of map) {
    if (pids.size !== 1) continue;
    const pid = [...pids][0];
    const st = states.find(x => x.state === tok);
    if (st && lc(idx.projById.get(pid).client).includes(st.after)) add(pid, 0.55, `"${tok}" (state code) in subject`, 'client');
    else if (!subjWords.includes(tok) && subjWords.some(w => near(w, tok))) add(pid, 0.55, `"${tok}" (spelled differently) in subject`, 'client');
  }
  if (mem) {
    // Vendor order numbers learned from approved mail (not yet in the identity index)
    for (const k of Identity.keysInText(subj + '\n' + top)) {
      if (idx.byKey && idx.byKey.get(k.key)) continue;
      const pid = only(mem.keys, k.key, idx);
      if (pid) add(pid, 0.9, `${k.label} ${k.key} (learned from approved mail)`, 'key');
    }
    // Organisations and names seen in only one project's approved mail
    const senderOrg = (() => { const d = domainOf(msg.from && msg.from.email); return d && !isInternal(d) ? squash(baseDomain(d).split('.')[0]) : ''; })();
    for (const k of entitiesOf(msg)) {
      const pid = only(mem.ent, k, idx);
      if (!pid || ARCHIVED.includes(idx.projById.get(pid).status)) continue;
      if (k === senderOrg) add(pid, 0.62, `sender's company (${k}) appears in this project's mail`, 'org');
      else add(pid, 0.45, `"${k}" appears in this project's mail`, 'entity');
    }
    // A thread the engine (not a human) placed from content
    const th = msg.conversationId && mem.threads.get(msg.conversationId);
    if (th && th.by === 'content') add(th.pid, ARCHIVED.includes((idx.projById.get(th.pid) || {}).status) ? 0.5 : Math.min(0.72, th.conf + 0.1), 'same thread as an earlier mail placed by its content', 'thread-soft');
  }
  // Sibling projects of one client: the stage the mail talks about picks one
  if (first && first.projectId) {
    const best = idx.projById.get(first.projectId);
    const sibs = [first.projectId, ...(first.alternatives || []).map(a => a.projectId)].map(pid => idx.projById.get(pid))
      .filter(p => p && best && lc(p.client).split(/\s+/)[0] === lc(best.client).split(/\s+/)[0]);
    if (sibs.length > 1) {
      const text = subj + '\n' + top + '\n' + (msg.attachments || []).join(' ');
      const exec = EXEC_RX.test(text), quote = QUOTE_RX.test(text);
      const want = exec && !quote ? 'In Progress' : quote && !exec ? 'Quoting' : null;
      const pick = want && sibs.filter(p => want === 'Quoting' ? /^Quot/.test(p.status) : p.status === want);
      if (pick && pick.length === 1) add(pick[0].id, 0.5, want === 'Quoting' ? 'talks about a quote (the client\'s project being quoted)' : 'talks about execution (the client\'s project in progress)', 'stage');
    }
  }
  return out;
}

const NOISE_RX = /^\s*expense claim\b|\bexpense claim #?\w+ has been (approved|rejected)/i;

// Returns { match, extra } — extra.portal (site-access notice), extra.noise (never project mail)
function refine(msg, match, idx, mem) {
  const extra = {};
  if (NOISE_RX.test(msg.subject || '')) { extra.noise = 'expense notice'; return { match: { projectId: null, confidence: 0, reasons: [], alternatives: [] }, extra }; }
  const portal = portalNotice(msg);
  const extraHits = hits(msg, idx, mem, match);
  if (portal && portal.client) {
    const ps = projectsOfClient(idx, portal.client).filter(p => ACTIVE.includes(p.status) && p.status !== 'On Hold');
    if (ps.length) {
      extra.portal = { ...portal, text: portalText(portal) };
      extraHits.push({ pid: ps[0].id, score: ps.length === 1 ? 0.9 : 0.75, reason: `${portal.portal} notice from ${portal.client}: their active project`, kind: 'portal' });
    }
  }
  if (!extraHits.length) return { match, extra };
  return { match: M.matchMessage(msg, idx, { hits: extraHits }), extra };
}

module.exports = { memory, learn, observe, hits, refine, portalNotice, portalText, entitiesOf, topText, near };
