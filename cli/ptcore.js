#!/usr/bin/env node
// ptcore — command-line access to the extracted ProjectTracker rules.
//
//   ptcore match  --projects projects.json [--threads threads.json] [--identity identity.json]
//                 [--erp erp-map.json] [--no-content] [--in messages.jsonl]
//       one JSON line per message in → { id, projectId, confidence, reasons, alternatives, noise, portal } out
//   ptcore detect [--active-only] [--in messages.jsonl]
//       one JSON line per message in → { id, milestones: [...] } out. A message may carry
//       `history: [earlier messages]`; their ship-date notices are used to detect ship-date changes.
//   ptcore layout-check set.json            → checklist results (see lib/drawings/layout-check.js)
//   ptcore status-hint --today YYYY-MM-DD [--in items.jsonl]
//       one { id, project, erp } per line → { id, hint }
//
// Input defaults to stdin. Output is JSON Lines on stdout. No network, no files written.
'use strict';
const fs = require('fs');
const EmailMatch = require('../lib/inbox/email-match');
const ContentMatch = require('../lib/inbox/content-match');
const Detectors = require('../lib/inbox/detectors');
const StatusHints = require('../lib/core/status-hints');
const { checkLayout } = require('../lib/drawings/layout-check');

const UNASSIGNED_BELOW = 0.45;   // below this the tool leaves a mail unassigned

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[k] = argv[++i]; else out[k] = true;
    } else out._.push(a);
  }
  return out;
}
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
function readLines(file) {
  const raw = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
  return raw.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));
}
const emit = o => process.stdout.write(JSON.stringify(o) + '\n');

function cmdMatch(a) {
  if (!a.projects) throw new Error('--projects is required');
  const data = readJson(a.projects);
  const idx = EmailMatch.buildIndex(data, {
    threads: a.threads ? readJson(a.threads) : {},
    identity: a.identity ? readJson(a.identity) : null,
    erpMap: a.erp ? readJson(a.erp) : {},
    internalDomains: data.internalDomains || [],
  });
  const mem = ContentMatch.memory();
  for (const msg of readLines(a.in)) {
    let match = EmailMatch.matchMessage(msg, idx);
    let extra = {};
    if (!a['no-content']) ({ match, extra } = ContentMatch.refine(msg, match, idx, mem));
    // As the tool's inbox does: noise is only asked about mail that matched no project (< 0.45).
    const noise = extra.noise || (match.confidence >= UNASSIGNED_BELOW || extra.portal ? null : EmailMatch.classifyNoise(msg, idx));
    emit({ id: msg.id, ...match, noise: noise || null, portal: extra.portal || null });
  }
}

function cmdDetect(a) {
  for (const msg of readLines(a.in)) {
    const opts = { activeOnly: !!a['active-only'] };
    // annotate() tells notices apart by entryId (the inbox's id for each stored item)
    const existing = (msg.history || []).flatMap((h, i) => Detectors.detect(h, opts).map(x => ({ ...x, entryId: 'h' + i })));
    const items = Detectors.annotate(Detectors.detect(msg, opts).map(x => ({ ...x, entryId: msg.id || 'current' })), existing);
    emit({ id: msg.id, milestones: items });
  }
}

function cmdLayout(a) {
  const file = a._[1];
  if (!file) throw new Error('usage: ptcore layout-check set.json');
  process.stdout.write(JSON.stringify(checkLayout(readJson(file)), null, 1) + '\n');
}

function cmdHint(a) {
  if (!a.today) throw new Error('--today YYYY-MM-DD is required');
  for (const it of readLines(a.in)) emit({ id: it.id, hint: StatusHints.hint(it.project, { today: a.today, erp: it.erp || null }) });
}

function main() {
  const a = args(process.argv.slice(2));
  const cmd = a._[0];
  const run = { match: cmdMatch, detect: cmdDetect, 'layout-check': cmdLayout, 'status-hint': cmdHint }[cmd];
  if (!run) {
    process.stderr.write(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 17).map(l => l.replace(/^\/\/ ?/, '')).join('\n') + '\n');
    process.exit(cmd ? 2 : 0);
  }
  try { run(a); } catch (e) { process.stderr.write(`ptcore ${cmd}: ${e.message}\n`); process.exit(1); }
}

if (require.main === module) main();
module.exports = { args };
