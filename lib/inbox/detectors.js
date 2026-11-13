// ─── Mail detectors: automatic notices → dated milestones (deterministic, no AI) ──
// detect(msg, opts) → [{ kind, vendor, key, date, value, text, client?, detector }]   (pure)
// attach(items, { keyIndex, match }) → same items with projectId (strong keys first, then the matcher ≥ 0.88)
// annotate(items, existing) → adds `ship-date-changed` when a later ship-date confirmation moves a line's date
//   (in the private tool the dates are read from the vendor's report PDF; here the caller passes them
//    as msg.shipReport = { order, shipDate, firstShipDate, reportDate, items: [{ item, desc, date }] })
// Only notices that arrive as the original message count (not RE:/FW: chatter) unless a detector
// says otherwise; this keeps one milestone per notice instead of one per reply.
// DETECTORS[].active says which ones feed the tool's inbox (the others were measured as too noisy).
// Vendor names, domains, order-number formats and portal names are fictional (see SCRUBBING.md);
// subject and body patterns are kept as the tool has them.
(function (root) {
  const lc = s => String(s || '').toLowerCase();
  const isReply = s => /^\s*(re|fw|fwd|automatic reply|accepted|declined|tentative)\s*:/i.test(String(s || ''));
  const domainOf = m => lc(m && m.from && m.from.email).split('@')[1] || '';
  const received = m => m.direction !== 'sent';
  const dayOf = m => String(m.receivedTime || m.sentTime || '').slice(0, 10) || null;
  const att = m => (m.attachments || []).map(a => (typeof a === 'string' ? a : a && a.name) || '');
  const iso = (mo, d, y, fallbackYear) => {
    let yy = y ? +y : +fallbackYear; if (yy < 100) yy += 2000;
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    return `${yy}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

  // Return date in an out-of-office text: "return on 12/29/25", "back on January 5", "returning Monday 3/2"
  function returnDate(text, year) {
    const t = String(text || '').slice(0, 1500);
    const near = /(?:return(?:ing)?|back(?: in the office)?|in the office|until)[^.\n]{0,40}?/i;
    let m = new RegExp(near.source + '(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?', 'i').exec(t);
    if (m) return iso(+m[1], +m[2], m[3], year);
    m = new RegExp(near.source + '(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?', 'i').exec(t);
    if (m) return iso(MONTHS[m[1].toLowerCase()], +m[2], m[3], year);
    return null;
  }

  const VENDOR_A = { name: 'Northbeam', domain: /northbeam\.example$/, order: 'N\\d{6}' };
  const VENDOR_B = { name: 'Keller', domain: /keller-ovens\.example$/, order: 'K20\\d{6}' };

  const DETECTORS = [
    { id: 'vendor-a-accept', active: true, run(m) {
      const s = m.subject || '';
      const x = new RegExp(`PO Acceptance Report(?:\\s*\\(NO Submittals\\))?\\s*For Order No:\\s*(${VENDOR_A.order})`, 'i').exec(s);
      if (!x || isReply(s) || !received(m) || !VENDOR_A.domain.test(domainOf(m))) return [];
      const k = x[1].toUpperCase();
      const out = [{ kind: 'order-accepted', vendor: VENDOR_A.name, key: k, date: dayOf(m), value: /NO Submittals/i.test(s) ? 'no submittals' : null,
        text: `${VENDOR_A.name} accepted order ${k}` }];
      if (att(m).some(n => /_Submittals\.pdf$/i.test(n)))
        out.push({ kind: 'submittals', vendor: VENDOR_A.name, key: k, date: dayOf(m), value: null, text: `${VENDOR_A.name} submittals for ${k} sent for approval` });
      return out;
    } },
    { id: 'vendor-a-ship', active: true, run(m) {
      const s = m.subject || '';
      const x = new RegExp(`Ship Date Confirmation Report\\s*For Order No:\\s*(${VENDOR_A.order})`, 'i').exec(s);
      const pdf = m.shipReport && m.shipReport.shipDate ? m.shipReport : null;   // dates read from the attached report by the caller
      // The original notice, or (the original may predate the export) a RE:/FW: that carries the report: then the report's own date is the notice date.
      const fromReply = !!pdf && !!x && isReply(s) && received(m);
      if (!x || !received(m) || (!fromReply && (isReply(s) || !VENDOR_A.domain.test(domainOf(m))))) return [];
      if (fromReply && pdf.order && pdf.order.toUpperCase() !== x[1].toUpperCase()) return [];
      const b = fromReply ? '' : String(m.body || '');
      const d = /ship date[^.\n]{0,40}?(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i.exec(b);
      const bodyDate = d ? iso(+d[1], +d[2], d[3]) : null;
      const revised = /\brevised\b|\bupdated ship\b|\bnew ship date\b/i.test(b.slice(0, 400));
      const value = pdf ? { shipDate: pdf.shipDate, firstShipDate: pdf.firstShipDate, items: pdf.items || [] }
        : bodyDate ? { shipDate: bodyDate, firstShipDate: bodyDate, items: [] } : null;
      const k = x[1].toUpperCase();
      const split = pdf && pdf.firstShipDate && pdf.firstShipDate !== pdf.shipDate ? ` (first ${pdf.firstShipDate})` : '';
      return [{ kind: 'ship-date', vendor: VENDOR_A.name, key: k, date: fromReply && pdf.reportDate ? pdf.reportDate : dayOf(m), value, revised, viaReply: fromReply || undefined,
        text: `${VENDOR_A.name} ship date confirmation for ${k}${value ? ' – ' + value.shipDate + split : ' (date in attached report, not read)'}${revised ? ' (revised)' : ''}` }];
    } },
    { id: 'vendor-a-warranty', active: false, run(m) {
      const s = m.subject || '';
      if (isReply(s) || !received(m) || !VENDOR_A.domain.test(domainOf(m))) return [];
      if (!/warranty|tech(nical)? services?|spare parts?|parts (order|quote)|replacement part/i.test(s)) return [];
      const k = (new RegExp(`\\b${VENDOR_A.order}\\b`, 'i').exec(s) || [])[0];
      return [{ kind: 'warranty', vendor: VENDOR_A.name, key: k ? k.toUpperCase() : null, date: dayOf(m), value: null, text: `${VENDOR_A.name} notice: ${s.replace(/\*\*[^*]+\*\*/g, '').trim().slice(0, 90)}` }];
    } },
    { id: 'vendor-b-ready', active: true, run(m) {
      const s = m.subject || '';
      const x = new RegExp(`Product Ready To Ship\\s*\\(\\s*(${VENDOR_B.order})\\s*\\)`, 'i').exec(s);
      if (!x || /^\s*re\s*:/i.test(s) || !received(m) || !VENDOR_B.domain.test(domainOf(m))) return [];
      return [{ kind: 'ready-to-ship', vendor: VENDOR_B.name, key: x[1].toUpperCase(), date: dayOf(m), value: null, text: `${VENDOR_B.name}: product ready to ship (${x[1].toUpperCase()})` }];
    } },
    { id: 'vendor-b-submittals', active: true, run(m) {
      const s = m.subject || '';
      const x = new RegExp(`\\b(${VENDOR_B.order})\\b[^\\n]*Submittals:\\s*Rev\\s*(\\d+(?:\\.\\d+)+)`, 'i').exec(s);
      if (!x || /^\s*re\s*:/i.test(s) || !received(m) || !VENDOR_B.domain.test(domainOf(m))) return [];
      return [{ kind: 'submittals', vendor: VENDOR_B.name, key: x[1].toUpperCase(), date: dayOf(m), value: 'Rev ' + x[2], text: `${VENDOR_B.name} submittals Rev ${x[2]} (${x[1].toUpperCase()})` }];
    } },
    { id: 'erp-vendor-po', active: true, run(m) {
      const s = m.subject || '';
      const x = /Purchase Order\s*#\s*([A-Z]{3}PO\d{6})\s*-\s*(.+)$/i.exec(s);
      if (!x || /^\s*(re|fw|fwd|automatic reply)\s*:/i.test(s) || !received(m)) return [];
      const vendor = x[2].split(/\s+\|\s+|\s+-\s+(?=[A-Z]-[A-Z]{3}-)/)[0].replace(/\s+-\s+.*$/, '').trim();
      const po = x[1].toUpperCase();
      return [{ kind: 'vendor-po', vendor, key: po, date: dayOf(m), value: /^\s*revised\b/i.test(s) ? 'revised' : null, text: `PO ${po} sent to ${vendor}${/^\s*revised\b/i.test(s) ? ' (revised)' : ''}` }];
    } },
    { id: 'erp-new-opp', active: true, run(m, o) {
      const n = o.detectNewOpportunity && o.detectNewOpportunity(m, o.account);
      return n ? [{ kind: 'new-opportunity', vendor: null, key: n.opp, date: dayOf(m), value: n.company || null, text: `New opportunity ${n.opp}${n.company ? ' – ' + n.company : ''}` }] : [];
    } },
    { id: 'erp-receipts', active: false, run(m) {      // report covers every project; the mail names none
      const x = /^Weekly Purchase Receipts By Project\s*\|\s*\w+\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(m.subject || '');
      if (!x || !/erp-reports@/i.test(lc(m.from && m.from.email))) return [];
      return [{ kind: 'receipts', vendor: null, key: null, date: iso(+x[1], +x[2], x[3]), value: att(m)[0] || null, text: 'Weekly purchase receipts report' }];
    } },
    { id: 'portal-reminder', active: true, run(m) {
      const s = m.subject || '';
      if (!/buildportal\.example$/.test(domainOf(m)) || !/Daily due date reminder/i.test(s) || !received(m)) return [];
      const code = (/\b(PRJ_[A-Za-z0-9_-]+)/.exec(s) || [])[1] || null;
      const b = String(m.body || '');
      const ov = /(\d+)\s+overdue/i.exec(b);
      const up = /(\d+)\s+total upcoming/i.exec(b);
      const client = (/^\s*([^\n•]+?)\s*-\s*[^\n•]*•\s*PRJ_/m.exec(b) || [])[1] || null;
      return [{ kind: 'portal-reminder', clientLevel: true, vendor: 'BuildPortal', key: code, date: dayOf(m), client,
        value: { overdue: ov ? +ov[1] : 0, upcoming: up ? +up[1] : 0 }, text: `Portal reminder${client ? ' (' + client + ')' : ''}: ${ov ? ov[1] : 0} overdue, ${up ? up[1] : 0} upcoming` }];
    } },
    { id: 'portal-vendorgate', active: true, run(m) {
      const s = m.subject || '';
      const x = /^\[([^\]]*VGATE[^\]]*)\]\s*-\s*Work Order (Ended|Draft)\b[^A-Za-z0-9]*(WO\d+)?/i.exec(s);
      if (!x || !received(m)) return [];
      const client = x[1].replace(/-?VGATE\d*$/i, '').trim() || null;
      const who = (/Contractor Name:\s*\*?\s*([^\n*]+)/i.exec(m.body || '') || [])[1];
      return [{ kind: 'site-access', clientLevel: true, vendor: 'VendorGate', key: x[3] || null, date: dayOf(m), client, value: x[2].toLowerCase(),
        text: `${client || 'Customer'} VendorGate work order ${x[2].toLowerCase()}${x[3] ? ' ' + x[3] : ''}${who ? ' – ' + who.trim() : ''}` }];
    } },
    // E-signature handbooks / orientation documents a customer sends before site work.
    // Client = the sender's display name or the domain of the person who sent it.
    { id: 'portal-signbox', active: true, run(m) {
      const s = m.subject || '', b = String(m.body || '');
      if (!/(^|\.)signbox\.example$/.test(domainOf(m)) || !/signbox/i.test(b) || !received(m)) return [];
      const done = /^\s*completed:/i.test(s) || /has been completed/i.test(b);
      const sender = (/sent by [^(]*\(([^)@\s]+@([^)\s]+))\)/i.exec(b) || [])[2] || '';
      const client = (m.from && m.from.name && !/signbox/i.test(m.from.name) ? m.from.name : '') || (sender ? sender.split('.').slice(-2, -1)[0] : '') || null;
      const doc = ((/signing\s+(.+?\.pdf)/i.exec(b) || /The document\s+(.+?\.pdf)/i.exec(b) || /Completed:\s*(.+?\.pdf)/i.exec(s) || [])[1] || '')
        .replace(/\s+\d{4}-\d{2}-\d{2}\s+[\d:.]+\.pdf$/i, '').replace(/\.pdf$/i, '').trim();
      if (!done) return [];   // only the signed document is progress; the sign request is the same step starting
      return [{ kind: 'site-access', clientLevel: true, vendor: 'SignBox', key: (/Document ID:\s*([A-Z0-9]+)/.exec(b) || [])[1] || null, date: dayOf(m), client, value: 'signed',
        text: `${client || 'Customer'} ${doc || 'document'} signed (SignBox)` }];
    } },
    { id: 'ocip', active: true, run(m) {
      const s = m.subject || '';
      if (!/\bOCIP\b/i.test(s)) return [];
      const k = lc(s).replace(/^(\s*(re|fw|fwd|urgent)\s*:?\s*)+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
      return [{ kind: 'insurance', clientLevel: true, vendor: null, key: k, date: dayOf(m), value: null, text: `OCIP / insurance thread: ${s.replace(/^(\s*(re|fw|fwd)\s*:\s*)+/ig, '').slice(0, 80)}` }];
    } },
    // Off: out-of-office replies turned out to be noise, not milestones. Kept for tools that ask for it by id.
    { id: 'out-of-office', active: false, run(m) {
      const s = m.subject || '';
      if (!/^\s*automatic reply\s*:/i.test(s) || !received(m)) return [];
      if (/(^|\.)finishing-systems\.example$/.test(domainOf(m))) return [];   // colleagues' replies are not vendor risk
      const person = (m.from && (m.from.name || m.from.email)) || '';
      const back = returnDate(m.body, String(dayOf(m) || '').slice(0, 4));
      return [{ kind: 'out-of-office', vendor: domainOf(m) || null, key: lc(m.from && m.from.email), date: dayOf(m), value: back,
        text: `${person} out of office${back ? ', back ' + back : ''}` }];
    } },
  ];

  function detect(msg, opts = {}) {
    const o = { ...opts };
    if (!o.detectNewOpportunity) { try { o.detectNewOpportunity = require('./email-match').detectNewOpportunity; } catch {} }
    const out = [];
    for (const d of DETECTORS) {
      if (opts.only && !opts.only.includes(d.id)) continue;
      if (!opts.only && opts.activeOnly && !d.active) continue;
      try { for (const it of d.run(msg || {}, o)) out.push({ ...it, detector: d.id }); } catch {}
    }
    return out;
  }

  // Project of each milestone: a strong key (vendor order, PO, OP) that points to one project, else the matcher at ≥ 0.88.
  // Out-of-office and generic portals carry no key of their own: they use the keys in the subject text.
  function attach(items, ctx = {}) {
    const { keyIndex, match, text, byNumber, projectClient } = ctx;
    return items.map(it => {
      // Customer-wide notices (portals, OCIP) say nothing about one project: they carry the client only.
      if (it.clientLevel) {
        const client = it.client || (match && match.projectId && match.confidence >= 0.88 && projectClient ? projectClient(match.projectId) : null);
        return { ...it, client, projectId: null, via: client ? 'client' : null };
      }
      let pid = null, via = null;
      const tryKey = k => { const s = k && keyIndex && keyIndex.get(String(k).toUpperCase()); return s && s.size === 1 ? [...s][0] : null; };
      pid = tryKey(it.key);
      if (pid) via = 'key';
      if (!pid && text && keyIndex) {
        const ids = new Set(); const rx = /\b(?:N\d{6}|K20\d{6}|(?:ABC|DEF|GHI)PO\d{6}|OP\d{6})\b/gi;
        for (const k of String(text).match(rx) || []) { const p = tryKey(k); if (p) ids.add(p); }
        if (ids.size === 1) { pid = [...ids][0]; via = 'subject-key'; }
      }
      // "E-ABC-25-07771" in a PO subject = project number with year 25 and number 7771
      if (!pid && byNumber && text) {
        const n = /\bE-[A-Z]{3}-(\d{2})-0?(\d{4})\b/i.exec(text);
        const p = n && byNumber(n[1], n[2]); if (p) { pid = p; via = 'project-number'; }
      }
      if (!pid && match && match.projectId && match.confidence >= 0.88) { pid = match.projectId; via = 'match'; }
      return { ...it, projectId: pid, via };
    });
  }

  // Ship dates: compare with the previous confirmation of the same order (existing + earlier in this batch).
  // value.items = report lines with a date. Changed = a line present in both confirmations has another
  // date; lines that only appear in one (a split ship added later) are reported as `added`, not as a change.
  // Without a read date on both sides only an explicit "revised" in the mail body counts.
  const shipOf = v => (v && typeof v === 'object' ? v.shipDate : v) || null;
  function compareShip(prev, cur) {
    const pi = new Map(((prev && prev.items) || []).map(i => [i.item, i])), ci = (cur && cur.items) || [];
    const lines = [], added = [];
    for (const c of ci) { const p = pi.get(c.item); if (!p) added.push(c); else if (p.date !== c.date) lines.push({ item: c.item, desc: c.desc, from: p.date, to: c.date }); }
    if (!lines.length && !ci.length) {                     // body-only dates: compare the single date
      const a = shipOf(prev), b = shipOf(cur); if (a && b && a !== b) lines.push({ item: null, desc: '', from: a, to: b });
    }
    return { lines, added };
  }
  function annotate(items, existing = []) {
    const hist = new Map();
    const push = it => { if (it.kind !== 'ship-date') return; (hist.get(it.key) || hist.set(it.key, []).get(it.key)).push(it); };
    [...existing].sort((a, b) => String(a.date).localeCompare(String(b.date))).forEach(push);
    const out = [];
    for (const it of [...items].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
      out.push(it);
      if (it.kind !== 'ship-date') continue;
      const prev = (hist.get(it.key) || []).filter(p => p.entryId !== it.entryId).pop();
      push(it);
      if (!prev) continue;
      const { lines, added } = shipOf(it.value) && shipOf(prev.value) ? compareShip(prev.value, it.value) : { lines: [], added: [] };
      if (lines.length || (!shipOf(it.value) && it.revised)) {
        const from = shipOf(prev.value), to = shipOf(it.value);
        out.push({ ...it, kind: 'ship-date-changed', value: { from, to, lines, added, previousNotice: prev.date, shipDate: to, items: (it.value && it.value.items) || [] },
          text: `${it.vendor} ship date changed for ${it.key}` + (lines.length ? ': ' + lines.slice(0, 3).map(l => `${l.desc ? l.desc.split(' - ').pop().slice(0, 28) + ' ' : ''}${l.from} → ${l.to}`).join('; ') : ' (revised notice, date not read)') });
      }
    }
    return out;
  }

  const SHORT = { 'order-accepted': 'Order accepted', 'ship-date': 'Ship date', 'ship-date-changed': 'Ship date changed', warranty: 'Warranty', 'ready-to-ship': 'Ready to ship',
    submittals: 'Submittals', 'vendor-po': 'Vendor PO', 'new-opportunity': 'New opportunity', receipts: 'Receipts', 'portal-reminder': 'Portal reminder', 'site-access': 'Site access',
    insurance: 'Insurance', 'out-of-office': 'Out of office' };
  const label = kind => SHORT[kind] || kind;

  const api = { DETECTORS, detect, attach, annotate, label, returnDate, isReply, shipOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Detectors = api;
})(typeof window !== 'undefined' ? window : globalThis);
