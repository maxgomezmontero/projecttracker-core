// ─── Status hints: the tool proposes a status change, a human approves with one click ──────────
// Pure logic (no DOM, no data access): given a project, "today" and the project's ERP entry it
// returns at most ONE hint. The desktop UI shows it on the project card, applies it with Undo and
// remembers a dismissal per project.
//
// Rules, in priority order (first match wins):
//   reactivated   'Quoted – Old' and news in the last REACTIVATED_DAYS  → back to Quoted
//                 (to 'Quoting' when the ERP says the quote is not out yet, else 'Quoted – Hot')
//   dead          'Quoted – Old' and no news for more than DEAD_DAYS     → mark Lost / Dead?
//   cooling       'Quoted – Hot' and no news for more than COOLING_DAYS  → move to Old?
//   erp-ahead     the ERP is further along than the tracker             → set the tracker to what the ERP says
//   erp-behind    the tracker is further along than the ERP             → chip only: "ERP is still at …";
//                                                                          the fix is in the ERP, not a status change
//
// Tracker status ↔ ERP stage (ONE table, ERP_CLASS_OF_STATUS / erpClass):
//
//   ERP class         how it is read                          tracker status that matches   status suggested when the tracker is behind
//   ───────────────   ─────────────────────────────────────   ───────────────────────────   ──────────────────────────────────────────
//   pre-quote  (1)    open and stage number < 8.7             Quoting                       Quoting
//   quoted     (2)    open and 8.7 <= stage number < 8.9      Quoted – Hot, Quoted – Old    Quoted – Hot
//   sold       (3)    status "Sold" or stage number 8.9       In Progress, Completed        In Progress
//   lost       (4)    status "Lost" or stage number 10        Lost / Dead                   Lost / Dead
//
// On Hold, Internal and any other status are never compared. Without an ERP entry (or without a stage)
// only the date rules run.
(function (root) {
  // ── Thresholds (days). Change them here only. ──
  const REACTIVATED_DAYS = 14;   // Old with news this recent → "back to Quoted?"
  const DEAD_DAYS = 90;          // Old with no news for longer than this → "Lost / Dead?"
  const COOLING_DAYS = 45;       // Hot with no news for longer than this → "Move to Old?"

  const HOT = 'Quoted – Hot', OLD = 'Quoted – Old', QUOTING = 'Quoting', PROGRESS = 'In Progress', LOST = 'Lost / Dead';

  const ERP_CLASS_OF_STATUS = {
    [QUOTING]: 'pre', [HOT]: 'quoted', [OLD]: 'quoted', [PROGRESS]: 'sold', 'Completed': 'sold', [LOST]: 'lost',
  };
  const STATUS_FOR_ERP_CLASS = { pre: QUOTING, quoted: HOT, sold: PROGRESS, lost: LOST };
  const CLASS_RANK = { pre: 1, quoted: 2, sold: 3 };     // 'lost' is handled on its own

  function stageNum(stage) {
    const m = String(stage || '').match(/^\s*(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  }

  // ERP entry {status, stage} → 'pre' | 'quoted' | 'sold' | 'lost' | null (unknown).
  function erpClass(entry) {
    if (!entry || (!entry.stage && !entry.status)) return null;
    const st = String(entry.status || ''), n = stageNum(entry.stage);
    if (st === 'Lost' || n === 10) return 'lost';
    if (st === 'Sold' || st === 'Won' || n === 8.9) return 'sold';
    if (n === null) return null;
    if (n < 8.7) return 'pre';
    if (n < 8.9) return 'quoted';
    return null;
  }

  // Whole days between two YYYY-MM-DD strings (b - a).
  function daysBetween(a, b) {
    const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 864e5);
  }

  // Newest dated entry (notes, items to discuss with the manager, actions) — same definition as the card's "N days".
  function lastNewsDay(p) {
    let last = '';
    for (const k of ['notes', 'managerItems', 'actionItems']) {
      for (const i of (p && p[k]) || []) {
        const d = i && typeof i.date === 'string' ? i.date.slice(0, 10) : '';
        if (d > last) last = d;
      }
    }
    return last || null;
  }

  function daysSinceNews(p, today) {
    const d = lastNewsDay(p);
    return d ? Math.max(0, daysBetween(d, today)) : null;
  }

  // One hint or null. opts: { today: 'YYYY-MM-DD' (required), erp: ERP entry {status, stage} or null }.
  // Hint: { kind, key, from, to, text, chip, apply: 'status' | 'sync', days }.
  //   key = what a dismissal remembers: it lasts until the situation changes (other status / other target;
  //   for 'reactivated' also until newer news arrives).
  function hint(p, opts) {
    if (!p || !opts || !opts.today) return null;
    const status = p.status, today = opts.today, erp = opts.erp || null;
    const cls = erpClass(erp);
    const days = daysSinceNews(p, today);
    const stageLabel = erp && erp.stage ? erp.stage : null;
    const mk = (kind, to, text, chip, apply, extra) => ({
      kind, from: status, to: to || null, text, chip, apply: apply || 'status', days,
      key: `${kind}|${status}|${to || ''}${kind === 'reactivated' ? '|' + (lastNewsDay(p) || '') : ''}`, ...(extra || {}),
    });

    if (status === OLD) {
      if (days !== null && days <= REACTIVATED_DAYS) {
        const to = cls === 'pre' ? QUOTING : HOT;
        return mk('reactivated', to, `New activity ${days === 0 ? 'today' : days === 1 ? '1 day ago' : days + ' days ago'} — back to ${to === HOT ? 'Quoted' : 'Quoting'}?`, `Back to ${to === HOT ? 'Quoted' : 'Quoting'}?`);
      }
      if (days !== null && days > DEAD_DAYS) return mk('dead', LOST, `No news in ${days} days — mark Lost / Dead?`, 'Mark Lost / Dead?');
    }
    if (status === HOT && days !== null && days > COOLING_DAYS) return mk('cooling', OLD, `No news in ${days} days — move to Old?`, 'Move to Old?');

    const mine = ERP_CLASS_OF_STATUS[status];
    if (mine && cls && stageLabel) {
      if (cls === 'lost' && mine !== 'lost' && status !== 'Completed') {
        return mk('erp-ahead', LOST, `ERP says ${stageLabel} — mark Lost / Dead?`, `ERP: ${stageLabel}`, 'status', { stage: stageLabel });
      }
      if (cls !== 'lost' && mine !== 'lost') {
        if (CLASS_RANK[cls] > CLASS_RANK[mine]) {
          const to = STATUS_FOR_ERP_CLASS[cls];
          return mk('erp-ahead', to, `ERP says ${stageLabel} — set to ${to}?`, `ERP: ${stageLabel}`, 'status', { stage: stageLabel });
        }
        if (CLASS_RANK[cls] < CLASS_RANK[mine]) {
          return mk('erp-behind', null, `ERP is still at ${stageLabel} — update it there?`, `ERP: ${stageLabel}`, 'sync', { stage: stageLabel });
        }
      }
    }
    return null;
  }

  // Statuses that count as "archived": open actions and remembered mail threads are cleaned up on entering them.
  const ARCHIVED = ['Lost / Dead', 'Completed', 'On Hold'];
  const isArchiving = (from, to) => ARCHIVED.includes(to) && !ARCHIVED.includes(from);

  const api = { hint, erpClass, stageNum, lastNewsDay, daysSinceNews, daysBetween, isArchiving,
    REACTIVATED_DAYS, DEAD_DAYS, COOLING_DAYS, ARCHIVED, ERP_CLASS_OF_STATUS, STATUS_FOR_ERP_CLASS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StatusHints = api;
})(typeof window !== 'undefined' ? window : globalThis);
