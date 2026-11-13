// ─── Email → project matching (weighted evidence, deterministic) ──────────────
// Pure functions (no fs). Extracted from a private desktop tool; logic unchanged except where the
// SCRUBBING.md notes say otherwise (real names, domains and number formats replaced).
//
// Message schema (what the tool's mail export writes):
//   { subject, body, from: {name, email}, to: [{name, email}], cc: [...], conversationId,
//     attachments: [names], direction: 'received'|'sent', receivedTime: ISO }
// Project schema:
//   { id, projectNumber: 'N26-6402', name, client, status, lastUpdated,
//     quotes: [{ email: 'free text with addresses', contact: 'free text with names' }] }
//
// Evidence and scores (highest single score wins, +0.12 per extra independent kind, max 0.99):
//   project number 0.97 · vendor order / PO key 0.95 · ERP opportunity 0.90 · known thread 0.88 ·
//   bare job number near a work word 0.82 · contact email 0.78 · client domain 0.62 ·
//   contact name 0.60 · distinctive project-name word 0.60 · client name in subject 0.55.
// Callers treat < 0.45 as unassigned and >= 0.88 as sure enough to attach automatically.
'use strict';

const INTERNAL_DOMAINS = ['finishing-systems.example'];
const GENERIC_DOMAINS  = ['gmail.com', 'yahoo.com', 'aol.com', 'outlook.com', 'hotmail.com', 'icloud.com',
                          'live.com', 'msn.com', 'comcast.net', 'att.net', 'privaterelay.appleid.com'];
// Senders / domains that are never project mail
const NOISE_DOMAIN_RX  = /(^|\.)(anthropic\.com|claude\.com|link\.com|linkedin\.com|microsoft\.com|office\.com|erp-vendor\.example|docusign\.net|zoom\.us|apple\.com|google\.com|amazon\.com|mailchimp|hubspot|constantcontact|sendgrid)/i;
const NOISE_LOCAL_RX   = /^(no-?reply|do-?not-?reply|notifications?|news(letter)?|marketing|mailer|info|support|billing|receipts?)\b/i;
const NOISE_SUBJECT_RX = /\b(receipt|sign-?in code|device code|verification code|password|subscription|webinar|newsletter|unsubscribe|your order|invoice #\d|secure link|welcome to)\b/i;
const WORK_RX = /\b(quote|quotation|rfq|po\b|p\.o\.|purchase order|drawing|dwg|booth|oven|conveyor|blast|install|installation|start-?up|commission|ship(ping|ment)?|deliver(y|ed)|freight|site (visit|review|survey)|schedule|layout|proposal|submittal|approval|change order|invoice|project|job|spec|scope)\b/i;

const ACTIVE_STATUSES = ['In Progress', 'Quoting', 'Quoted – Hot', 'On Hold'];
// Projects the engineer has put away: a remembered thread that points there is a hint, never a sure match.
const ARCHIVED_STATUSES = ['Lost / Dead', 'Completed', 'On Hold'];

const STATUS_RULES = [
  { to: 'In Progress', rx: /\b(attached (is )?(our|the) (po|purchase order)|(po|purchase order)\s*(#\s*\w+\s*)?(is )?(attached|issued|released|received)|new purchase order|please find (attached )?(our |the )?(po|purchase order)|we('| a)re (moving forward|going ahead|proceeding) with)\b/i,
    from: ['Quoting', 'Quoted – Hot', 'Quoted – Old', 'On Hold'] },
  { to: 'Lost / Dead', rx: /\b(went with (another|a different) (vendor|supplier)|decided (not to proceed|to go (another|a different) (way|direction))|project (is )?(cancel+ed|dead)|awarded (it )?to (another|someone else))\b/i,
    from: ['Quoting', 'Quoted – Hot', 'Quoted – Old', 'On Hold'] },
  { to: 'On Hold', rx: /\b(put (the project |this )?on hold|project (is )?on hold|pause (the|this) project|postpone[d]? (the|this) project)\b/i,
    from: ['Quoting', 'Quoted – Hot', 'Quoted – Old', 'In Progress'] },
];

// ── small helpers ─────────────────────────────────────────────────────────────
const EMAIL_RX = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const lc = s => String(s || '').toLowerCase();
const Identity = require('../core/identity');
const domainOf = e => { const m = lc(e).match(/@([a-z0-9.-]+)$/); return m ? m[1] : ''; };
// "mail.client-a.example" → "client-a.example"
const baseDomain = d => { const p = lc(d).split('.').filter(Boolean); return p.length > 2 ? p.slice(-2).join('.') : p.join('.'); };
const isInternal = (d, extra = []) => [...INTERNAL_DOMAINS, ...extra].some(x => d === x || d.endsWith('.' + x));
const bareNumber = pn => { const m = String(pn || '').match(/(\d{4})\s*$/); return m ? m[1] : ''; };
const escRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CLIENT_STOP = new Set(['inc', 'llc', 'co', 'corp', 'corporation', 'company', 'the', 'group', 'industries',
  'industrial', 'manufacturing', 'mfg', 'products', 'enterprises', 'equipment', 'usa', 'america', 'electric',
  'fabrication', 'fab']);
// Words in project names that say nothing about which project it is
const NAME_STOP = new Set([...CLIENT_STOP, 'booth', 'booths', 'paint', 'painting', 'line', 'system', 'systems', 'powder', 'spray',
  'bake', 'oven', 'ovens', 'conveyor', 'conveyors', 'addition', 'phase', 'mix', 'room', 'wet', 'open', 'face', 'wide',
  'and', 'batch', 'heat', 'gel', 'class', 'div', 'prime', 'triple', 'duty', 'project', 'drive', 'take', 'change',
  'relocation', 'construction', 'pressurized', 'side', 'downdraft', 'military', 'retrofit', 'new', 'cat', 'tech',
  // Lead tags and generic size / product words (a "Lead … Large Batch Line" project once pulled hundreds of mails)
  'lead', 'leads', 'large', 'small', 'manual', 'automatic', 'overhead', 'pound', 'frames', 'chassis', 'parts', 'part',
  'quote', 'rfq', 'wash', 'blast', 'cure', 'amu', 'unit', 'mod', 'modification', 'replacement', 'equipment', 'products',
  'product', 'metal', 'metals', 'steel', 'expansion', 'install', 'installation', 'upgrade', 'enclosure', 'kitchen',
  // Plain English words in project names ("Drive through", a city name) pulled unrelated mail to the wrong project
  'through', 'city', 'man', 'door', 'doors', 'north', 'south', 'east', 'west', 'center', 'plant', 'building', 'facility', 'shop', 'area']);
// Vendor names never identify one project (they appear in every project that buys from them).
const VENDOR_WORDS = new Set(require('../core/parties').SEED_VENDORS.flatMap(v => [v.name, ...(v.aliases || []).map(a => a.a || a)])
  .flatMap(n => lc(n).split(/[^a-z0-9]+/)).filter(w => w.length >= 3));

function clientTokens(client) {
  return lc(client).replace(/[^a-z0-9& ]+/g, ' ').split(/\s+/)
    .filter(t => t.length >= 3 && !CLIENT_STOP.has(t));
}

function participants(msg) {
  return [msg.from, ...(msg.to || []), ...(msg.cc || [])].filter(p => p && (p.email || p.name));
}

// ── Index of projects ─────────────────────────────────────────────────────────
// opts.erpMap:   { bareNumber: { opp } } from the ERP export
// opts.threads:  { conversationId: { projectId } } learned from earlier runs
// opts.identity: lib/core/identity.build() result (strong keys per project)
function buildIndex(data, opts = {}) {
  const projects = (data && data.projects) || [];
  const byFull = new Map(), byBare = new Map(), byEmail = new Map(), byDomain = new Map(),
        byName = new Map(), byOpp = new Map(), byClientTok = new Map(), byNameTok = new Map();
  const add = (map, key, pid) => { if (!key) return; if (!map.has(key)) map.set(key, new Set()); map.get(key).add(pid); };

  for (const p of projects) {
    const pid = p.id;
    if (p.projectNumber) add(byFull, lc(p.projectNumber).replace(/\s+/g, ''), pid);
    add(byBare, bareNumber(p.projectNumber), pid);
    for (const q of (p.quotes || [])) {
      const emails = String(q.email || '').match(EMAIL_RX) || [];
      for (const e of emails) {
        if (/customername@company\.com/i.test(e)) continue;   // template placeholder
        add(byEmail, lc(e), pid);
        const d = baseDomain(domainOf(e));
        if (d && !GENERIC_DOMAINS.includes(d) && !isInternal(d)) add(byDomain, d, pid);
      }
      // Contact field is free text: "Sam Archer    Robin Lowell", "Alex “AJ” Bennett"
      const contact = String(q.contact || '').replace(EMAIL_RX, ' ').replace(/[“”"]/g, ' ');
      for (const chunk of contact.split(/\s{2,}|,|;|\//)) {
        const name = chunk.trim().replace(/\s+/g, ' ');
        if (/^name$/i.test(name) || name.split(' ').length < 2) continue;
        add(byName, lc(name), pid);
      }
    }
    const cTok = clientTokens(p.client);
    for (const t of cTok) add(byClientTok, t, pid);
    for (const t of lc(p.name).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/))
      if (t.length >= 3 && !/^\d+$/.test(t) && !NAME_STOP.has(t) && !cTok.includes(t)) add(byNameTok, t, pid);
  }
  // A name token is only useful when it is (nearly) unique to one project
  for (const [t, pids] of byNameTok) if (pids.size > 2) byNameTok.delete(t);
  for (const [num, row] of Object.entries(opts.erpMap || {})) {
    if (row && row.opp) for (const pid of (byBare.get(num) || [])) add(byOpp, lc(row.opp), pid);
  }
  // Strong keys from lib/core/identity.js (vendor orders, our POs, opportunities)
  const byKey = opts.identity ? Identity.indexOf(opts.identity) : new Map();
  for (const [t] of [...byNameTok]) if (VENDOR_WORDS.has(t)) byNameTok.delete(t);
  for (const [t] of [...byClientTok]) if (VENDOR_WORDS.has(t) || NAME_STOP.has(t)) byClientTok.delete(t);
  const projById = new Map(projects.map(p => [p.id, p]));
  return { projects, projById, byFull, byBare, byEmail, byDomain, byName, byOpp, byKey, byClientTok, byNameTok,
           threads: opts.threads || {}, internal: (opts.internalDomains || []).map(lc) };
}

// When a signal points to several projects, prefer active ones and the most recently touched.
function rankCandidates(idx, pids) {
  return [...pids].map(pid => idx.projById.get(pid)).filter(Boolean)
    .sort((a, b) => (ACTIVE_STATUSES.includes(b.status) - ACTIVE_STATUSES.includes(a.status))
                 || lc(b.lastUpdated).localeCompare(lc(a.lastUpdated)))
    .map(p => p.id);
}

// ── Match one message ─────────────────────────────────────────────────────────
// Returns { projectId|null, confidence 0..1, reasons[], alternatives[{projectId, confidence}] }
function matchMessage(msg, idx, opts = {}) {
  const scores = new Map();   // pid → { score, reasons[] }
  let kind = '';                    // which signal family the current hit belongs to
  const hit = (pid, score, reason) => {
    const s = scores.get(pid) || { score: 0, reasons: [], kinds: new Set() };
    s.kinds.add(kind);
    if (score > s.score) s.score = score;
    if (!s.reasons.includes(reason)) s.reasons.push(reason);
    scores.set(pid, s);
  };
  const hitMany = (pids, single, multi, reason) => {
    const ranked = rankCandidates(idx, pids);
    if (ranked.length === 1) return hit(ranked[0], single, reason);
    const activeCount = ranked.filter(pid => ACTIVE_STATUSES.includes(idx.projById.get(pid).status)).length;
    ranked.forEach((pid, i) => hit(pid, i === 0 && activeCount <= 1 ? single - 0.1 : multi - i * 0.02, reason + ' (shared by ' + ranked.length + ' projects)'));
  };

  const atts = (msg.attachments || []).join(' ');
  const text = [msg.subject, msg.body, atts].join('\n');

  kind = 'number';
  // 1. Full project number: N26-6402, n26 6402, N26-6402-20417-ClientA-REV3
  //    (the private tool accepts only its own branch letters here; this package accepts any letter)
  for (const m of text.matchAll(/\b([A-Z])\s?(\d{2})\s?-\s?(\d{4})(?!\d)/gi)) {
    const key = lc(m[1] + m[2] + '-' + m[3]);
    const pids = idx.byFull.get(key);
    if (pids) for (const pid of pids) hit(pid, 0.97, `project number ${m[0].toUpperCase().replace(/\s/g, '')}`);
    else for (const pid of (idx.byBare.get(m[3]) || [])) hit(pid, 0.8, `number ${m[3]} (prefix ${m[1].toUpperCase()}${m[2]} differs)`);
  }
  kind = 'number';
  // 2. Bare 4-digit number near a work word: "project 6402", "job #6402", "quote 6402-20417"
  const bareRx = /\b(?:project|proj|job|quote|quotation|opportunity|ref|po|order)\b[^\n\d]{0,20}#?\s*(\d{4})(?!\d)|\b(\d{4})(?:-\d{3,5})?\s+(?:project|job|quote)\b/gi;
  for (const m of text.matchAll(bareRx)) {
    const num = m[1] || m[2];
    for (const pid of (idx.byBare.get(num) || [])) hit(pid, 0.82, `"${m[0].trim().slice(0, 40)}"`);
  }
  kind = 'opp';
  // 3. ERP opportunity number
  for (const m of text.matchAll(/\bOP\d{6}\b/gi))
    for (const pid of (idx.byOpp.get(lc(m[0])) || [])) hit(pid, 0.9, `opportunity ${m[0].toUpperCase()}`);
  kind = 'key';
  // 3b. Strong keys: vendor order numbers and POs known for the project
  for (const k of Identity.keysInText(text)) {
    const pids = idx.byKey && idx.byKey.get(k.key);
    if (!pids) continue;
    if (pids.size === 1) hit([...pids][0], 0.95, `${k.label} ${k.key}`);
    else hitMany(pids, 0.9, 0.7, `${k.label} ${k.key}`);
  }
  kind = 'thread';
  // 4. Known thread
  const th = msg.conversationId && idx.threads[msg.conversationId];
  if (th && idx.projById.has(th.projectId)) {
    if (ARCHIVED_STATUSES.includes(idx.projById.get(th.projectId).status)) hit(th.projectId, 0.6, 'same email thread as an earlier match (project is ' + idx.projById.get(th.projectId).status + ')');
    else hit(th.projectId, 0.88, 'same email thread as an earlier match');
  }
  kind = 'contact';
  // 5. Known contact email / domain
  const ext = participants(msg).filter(p => p.email && !isInternal(domainOf(p.email), idx.internal));
  for (const p of ext) {
    const e = lc(p.email);
    if (idx.byEmail.has(e)) hitMany(idx.byEmail.get(e), 0.78, 0.5, `contact ${e}`);
    const d = baseDomain(domainOf(e));
    if (idx.byDomain.has(d)) hitMany(idx.byDomain.get(d), 0.62, 0.42, `client domain ${d}`);
  }
  kind = 'contact';
  // 6. Contact names (sender/recipient display names and mentions in the body)
  const names = participants(msg).map(p => lc(p.name).replace(/\s*\(.*?\)\s*/g, ' ').replace(/^(.+),\s*(.+)$/, '$2 $1').trim());
  const lcText = lc(text);
  for (const [name, pids] of idx.byName) {
    if (names.includes(name)) hitMany(pids, 0.6, 0.4, `contact ${name}`);
    else if (new RegExp('\\b' + escRx(name) + '\\b').test(lcText)) hitMany(pids, 0.5, 0.35, `mentions ${name}`);
  }
  kind = 'client';
  // 7. Client name in subject
  const subj = lc(msg.subject);
  for (const [tok, pids] of idx.byClientTok) {
    if (new RegExp('\\b' + escRx(tok) + '\\b').test(subj)) hitMany(pids, 0.55, 0.38, `client "${tok}" in subject`);
  }

  // 8. Distinctive project-name words (location, line name): subject/attachments, then body
  kind = 'name';
  const subjAtt = lc(msg.subject + ' ' + atts), body1 = lc(String(msg.body || '').slice(0, 1500));
  for (const [tok, pids] of idx.byNameTok) {
    const rx = new RegExp('\\b' + escRx(tok) + '\\b');
    if (rx.test(subjAtt)) hitMany(pids, 0.6, 0.45, `"${tok}" in subject`);
    // In the body only a capitalised word counts ("Ashford", not "through")
    else if (rx.test(body1) && new RegExp('\\b' + escRx(tok[0].toUpperCase() + tok.slice(1)) + '\\b|\\b' + escRx(tok.toUpperCase()) + '\\b').test(String(msg.body || '').slice(0, 1500))) hitMany(pids, 0.5, 0.38, `mentions "${tok}"`);
  }

  // 9. Content evidence from lib/inbox/content-match.js (client in the body, learned orders / organisations,
  //    portal notices, stage between sibling projects): [{ pid, score, reason, kind }]
  for (const h of (opts.hits || [])) { kind = h.kind; if (idx.projById.has(h.pid)) hit(h.pid, h.score, h.reason); }

  if (!scores.size) return { projectId: null, confidence: 0, reasons: [], alternatives: [] };
  const ranked = [...scores.entries()].map(([pid, s]) => {
    // Independent kinds of evidence (e.g. client + contact + name word) add up, never past 0.99
    let confidence = Math.min(0.99, +(s.score + 0.12 * (s.kinds.size - 1)).toFixed(2));
    // Only words (client / project-name tokens) and a single one of them: a hint, not a match
    const wordsOnly = [...s.kinds].every(k => k === 'client' || k === 'name' || k === 'client-body' || k === 'entity');
    if (wordsOnly && s.reasons.length < 2) confidence = Math.min(confidence, 0.55);
    return { projectId: pid, confidence, reasons: s.reasons, kinds: s.kinds };
  }).sort((a, b) => b.confidence - a.confidence);
  const best = ranked[0];
  // Sibling projects of the same client: without a number, order, OP or thread there is nothing
  // that tells them apart → leave it for the engineer with both as options.
  const SURE = ['number', 'key', 'opp', 'thread', 'portal'];
  const sibling = ranked.slice(1).find(r => r.confidence >= best.confidence - 0.15 &&
    lc((idx.projById.get(r.projectId) || {}).client) === lc((idx.projById.get(best.projectId) || {}).client));
  if (sibling && ![...best.kinds].some(k => SURE.includes(k))) best.confidence = Math.min(best.confidence, 0.55);
  for (const r of ranked) delete r.kinds;
  // Two projects tied on the same evidence → not confident
  if (ranked[1] && ranked[1].confidence >= best.confidence - 0.03 && best.confidence < 0.9) best.confidence = +(best.confidence - 0.1).toFixed(2);
  return { ...best, alternatives: ranked.slice(1, 4).map(r => ({ projectId: r.projectId, confidence: r.confidence })) };
}

// ── Is this message work-related at all? ─────────────────────────────────────
// Returns null (work mail) or the reason it is noise.
function classifyNoise(msg, idx) {
  const from = lc(msg.from && msg.from.email);
  const d = domainOf(from);
  if (NOISE_DOMAIN_RX.test(d)) return 'automated sender';
  if (NOISE_LOCAL_RX.test(from.split('@')[0])) return 'automated sender';
  if (NOISE_SUBJECT_RX.test(msg.subject || '')) return 'notification subject';
  const anyKnownDomain = participants(msg).some(p => idx.byDomain.has(baseDomain(domainOf(p.email))));
  const internalOnly = participants(msg).every(p => !p.email || isInternal(domainOf(p.email), idx.internal));
  if (anyKnownDomain) return null;
  if (WORK_RX.test((msg.subject || '') + ' ' + (msg.body || '').slice(0, 1500))) return null;
  if (internalOnly) return 'internal, no work keywords';
  return 'no work keywords';
}

// ── Status change proposed by the text of a mail (the tool shows it; a human approves) ──
// Same loop the tool runs inside its fallback proposal. Returns { from, to, evidence } or null.
function statusChange(msg, project) {
  const scan = [msg.subject, msg.body].join('\n');
  for (const r of STATUS_RULES) {
    const m = scan.match(r.rx);
    if (m && project && r.from.includes(project.status) && project.status !== r.to) {
      const ev = m[0].length <= 80 ? m[0] : m[0].slice(0, 79).replace(/\s+\S*$/, '') + '…';
      return { from: project.status, to: r.to, evidence: ev };
    }
  }
  return null;
}

// ── Small text helpers used by the summary step ──────────────────────────────
const GREETING_RX = /^(hi|hello|hey|good (morning|afternoon|evening)|dear|all|team|gentlemen|folks|greetings)\b[^.!?\n]{0,40}[,!:.]?\s*$/i;
function firstMeaningfulSentence(body) {
  const lines = String(body || '').split(/\n+/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (GREETING_RX.test(line) || line.length < 12) continue;
    if (/^(thanks|thank you|regards|best|sincerely)\b/i.test(line)) break;
    const s = line.replace(/^(hi|hello|hey)\s+\w+[,!]\s*/i, '').match(/^.*?[.!?](\s|$)/);
    return (s ? s[0] : line).trim();
  }
  return '';
}
const cleanSubject = s => String(s || '').replace(/^\s*((re|fw|fwd|aw|wg)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim();

// "New opportunity OP090017 assigned to you - Client A Manufacturing" (ERP notice).
// Returns { opp, company, description } or null. With accountEmail, only mail addressed to that user.
function detectNewOpportunity(msg, accountEmail) {
  const subj = String(msg.subject || '');
  const m = /new\s+\w*\s*opportunity\s+(OP\d+)\s+assigned/i.exec(subj);
  if (!m || msg.direction === 'sent') return null;
  if (accountEmail && !(msg.to || []).some(p => lc(p.email) === lc(accountEmail))) return null;
  const body = String(msg.body || '');
  const field = name => { const r = new RegExp('^\\s*' + name + ':\\s*(.+)$', 'im').exec(body); return r ? r[1].trim() : ''; };
  return {
    opp: m[1].toUpperCase(),
    company: field('Account Name') || subj.replace(/^.*assigned to you\s*-\s*/i, '').trim(),
    description: field('Description'),
  };
}

module.exports = {
  detectNewOpportunity, statusChange,
  buildIndex, matchMessage, classifyNoise, firstMeaningfulSentence,
  cleanSubject, INTERNAL_DOMAINS, ACTIVE_STATUSES, ARCHIVED_STATUSES, STATUS_RULES,
};
