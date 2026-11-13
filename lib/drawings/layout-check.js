// ─── Layout self-check (text rules of the 44-criteria checklist) ─────────────────────────────
// The private tool reads the current layout PDF set from the project folder, extracts positioned text,
// measures the drawing scale from dimension geometry, and pulls extra evidence from mail, folders and
// the ERP. This package contains the RULES that work on the extracted text, unchanged in substance,
// with the data access rewritten to take a plain JSON description of the set (no PDF reader, no fs):
//
//   checkLayout({
//     status: 'In Progress',                       // project status (proposal vs PO numbering)
//     files: ['N26-6418-L01_Rev2_ClientA_Line.pdf', 'N26-6418-L01_Rev2_ClientA_Line.dwg', ...],
//     sheets: [{ name, titleBlock: { no, checked, drawnDate, rev, sheetOf: [i, n] },
//                rows: [['E1', 'Electrical Power', 'Booth Control Panel', '60 AMP (39 FLA) / 480V 3PH 3W'], ...] }],
//     folderOrders: ['N123456'],                    // vendor order numbers seen in the project folders (optional)
//     references: [{ name, text }],                // quote / vendor drawing text, for the TOR comparison (optional)
//   })
//   → { rev, files, sheets, results: { '1-1': { ok: true|false|null, why, src } ... }, notCovered: [ids] }
//
// ok: true = found, false = missing (with the reason), null = could not confirm from text → check by eye.
// Criteria that need PDF geometry (2-4, 3-4, 3-6, 3-7), file timestamps (6-1), mail / ERP evidence or
// human judgement are listed in notCovered; the checklist itself is in drawing-checklist.js.
'use strict';
const CHECKLIST = require('./drawing-checklist');

const VERSION = 2;
const ID = /^(X|F|E|A|B|G|W|ETH)(\d{1,2})$/;
const ID_ORDER = ['X', 'F', 'E', 'A', 'B', 'G', 'W', 'ETH'];
const TYPE_PREFIX = [[/exhaust/i, 'X'], [/fresh|intake|make ?-?up/i, 'F'], [/electric|power|outlet/i, 'E'], [/compressed/i, 'A'], [/breath/i, 'B'], [/gas/i, 'G'], [/water/i, 'W'], [/data|ethernet/i, 'ETH']];

// Revision of a file name: "…_Rev3.pdf", "…-REV B.pdf", vendor version "25.0.3".
const REV = /(?:^|[\s_-])rev\s*[-_ ]?\s*([0-9]+|[A-Z])(?=[^A-Za-z0-9]|$)/i;
const VER = /\b(\d{1,3})\.(\d{1,2})\.(\d{1,3})\b/;
function revOf(name) {
  const v = name.match(VER);
  if (v) return +v[1] * 10000 + +v[2] * 100 + +v[3];
  const m = name.match(REV) || name.match(/[-_]R(\d{1,3})(?=[_\-. ])/);
  if (!m) return null;
  return /^\d+$/.test(m[1]) ? +m[1] : m[1].toUpperCase().charCodeAt(0) - 64;
}

// Feet-inch text → decimal feet: 31'-5 5/16"  8'-0"  12'-11 1/2"  25'  30"
const FRAC = String.raw`(\d+)\s*/\s*(\d+)`;
const FT_IN = new RegExp(String.raw`^(\d+)\s*'\s*(?:-\s*(\d+)?\s*(?:${FRAC})?\s*"?)?$`);
const IN_ONLY = new RegExp(String.raw`^(\d+)?(?:\s*-?\s*${FRAC})?\s*"$`);
function parseFtIn(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/[″”]/g, '"').replace(/[′’]/g, "'").replace(/^Ø\s*/, '').trim();
  let m = s.match(FT_IN);
  if (m) {
    const ft = +m[1], inch = m[2] ? +m[2] : 0, fr = m[3] ? +m[3] / +m[4] : 0;
    return ft + (inch + fr) / 12;
  }
  m = s.match(IN_ONLY);
  if (m && (m[1] || m[2])) return ((m[1] ? +m[1] : 0) + (m[2] ? +m[2] / +m[3] : 0)) / 12;
  return null;
}

// Utility chart rows: "E1 | Electrical Power | Paint Booth Control Panel | 60 AMP (39 FLA) / 480v 3ph 3w"
function utilityRows(sheet) {
  const out = [];
  (sheet.rows || []).forEach((r, y) => {
    const m = r[0] && String(r[0]).match(ID);
    if (!m || r.length < 3 || !TYPE_PREFIX.some(([re]) => re.test(r[1]))) return;
    out.push({ id: r[0], prefix: m[1], n: +m[2], type: r[1], equip: r[2], line: r.join(' | '), y });
  });
  return out;
}

const has = (s, re) => re.test(s);
const list = (a, n = 4) => a.slice(0, n).join(', ') + (a.length > n ? ` +${a.length - n} more` : '');

const NOT_COVERED = {
  '1-4': 'judgement (reference drawing shared with another customer)', '1-5': 'needs the PO (ERP)',
  '2-4': 'needs PDF geometry (text rotation)', '3-4': 'needs PDF geometry (tag / dimension positions)',
  '3-6': 'needs PDF geometry (measured scale)', '3-7': 'needs PDF geometry (tag distances)',
  '6-1': 'needs file timestamps', '6-2': 'delivery practice', '6-3': 'needs the project folder', '6-4': 'delivery practice',
  '7-1': 'mail evidence', '7-2': 'mail evidence', '7-3': 'judgement', '7-4': 'judgement', '7-5': 'judgement', '7-6': 'schedule evidence',
};

function checkLayout(set) {
  const status = set.status || '';
  const all = (set.files || []).filter(f => /\.(pdf|dwg)$/i.test(f) && !/title ?block|template/i.test(f));
  const pdfs = all.filter(f => /\.pdf$/i.test(f));
  const sheetsIn = set.sheets || [];
  if (!pdfs.length || !sheetsIn.length) return { version: VERSION, error: 'No layout PDFs in the set', results: {} };
  // Current set = highest revision among the PDFs; anything older left in the folder is flagged.
  const rev = f => revOf(f) ?? -1;
  const top = Math.max(...pdfs.map(rev));
  const sheets = sheetsIn.map(s => ({ ...s, rows: (s.rows || []).map(r => r.map(String)), text: (s.rows || []).flat().join('\n') }));
  const older = all.filter(f => rev(f) >= 0 && rev(f) < top);
  const set_ = pdfs.filter(f => rev(f) === top);
  const tbs = sheets.map(s => s.titleBlock || {});
  const TXT = sheets.map(s => s.text).join('\n').toUpperCase();
  const s1 = sheets.find(s => /UTILIT/i.test(s.text) && utilityRows(s).length) || sheets[0];
  const chart = utilityRows(s1);
  const chartAny = chart.length ? chart : sheets.flatMap(utilityRows);
  const R = {};
  const put = (id, ok, why, src = 'pdf') => { R[id] = { ok, why: why || '', src }; };

  // 1 · Title block, numbering, revisions
  {
    const bad = [];
    tbs.forEach((t, i) => {
      const fileNo = (sheets[i].name.match(/^[A-Z]\d{2}-\d{4}-[A-Z]\d{2}/) || [''])[0];
      if (t.no && fileNo && !t.no.startsWith(fileNo)) bad.push(`${sheets[i].name}: title block ${t.no}`);
    });
    const proposal = sheets.some(s => /-P0\d/i.test(s.name)) || tbs.some(t => /-P0\d/.test(t.no || ''));
    if (proposal && /progress|complete/i.test(status)) bad.push('proposal number (P0x) on a project with PO, use L01');
    put('1-1', !bad.length, bad.length ? list(bad, 2) : `Title block ${tbs[0].no || '(number not found)'} matches file names`);
  }
  {
    const dates = [...new Set(tbs.map(t => t.drawnDate).filter(Boolean))];
    const ofN = tbs.map(t => t.sheetOf).filter(Boolean);
    const issues = [];
    if (dates.length > 1) issues.push(`different dates across sheets (${dates.join(', ')})`);
    if (ofN.length && new Set(ofN.map(o => o[1])).size > 1) issues.push(`'OF N' differs between sheets`);
    if (ofN.length && ofN.some(o => o[1] !== sheets.length)) issues.push(`'OF ${ofN[0][1]}' but ${sheets.length} sheets in the set`);
    const tbRev = [...new Set(tbs.map(t => t.rev).filter(r => r !== undefined && r !== null && r !== ''))];
    if (tbRev.some(r => String(r) !== String(top))) issues.push(`title block says Rev ${tbRev.join('/')}, file name Rev ${top}`);
    put('1-2', !issues.length, issues.length ? issues.join('; ') : `${sheets.length} sheets, Rev ${top}, same date`);
  }
  {
    const miss = tbs.map((t, i) => /\b[A-Z]{2,3}\b.*\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t.checked || '') ? null : sheets[i].name).filter(Boolean);
    put('1-3', !miss.length, miss.length ? `CHECKED empty on ${miss.length} of ${sheets.length} sheets` : `Checked: ${tbs[0].checked}`);
  }
  put('1-6', !older.length, older.length ? `Older revisions still in the drawings folder: ${list(older, 3)}` : 'Only the current revision in the drawings folder', 'files');
  {
    // Work suffixes: "test", "copy", ".dwg.dwg", initials after the revision, a 6-digit date.
    const bad = set_.filter(f => !/^[A-Z]\d{2}-\d{4}-L\d{2}[-_].*Rev\s?\d+/i.test(f) || /\btest\b|copy|\.dwg\.dwg|Rev\s?\d+[A-Za-z]{2,3}\b|\d{6}(?=\.)/i.test(f));
    put('1-7', !bad.length, bad.length ? `Non-standard names: ${list(bad, 2)}` : 'File names follow PROJECT-L01…RevN', 'files');
  }

  // 2 · Views and sheets
  put('2-1', has(TXT, /ELEVATION/), has(TXT, /ELEVATION/) ? 'Elevation view found' : 'No elevation view in the set');
  {
    const ctx = [['column grid', /\bCOL(UMN)?S?\b|\bGRID\b|LOC\.?\s*DIM\.?\s*FROM\s+[A-Z]\d/], ['walls', /\bWALL/], ['purlins / joists', /PURLIN|JOIST|ROOF RIB/], ['sprinklers', /SPRINKLER/],
      ['doors', /\bDOOR/], ['aisles', /AISLE/], ['ducts / mains', /\bDUCT|\bMAIN\b|GAS LINE/]];
    const found = ctx.filter(([, re]) => re.test(TXT)).map(([k]) => k), miss = ctx.filter(([, re]) => !re.test(TXT)).map(([k]) => k);
    put('2-2', found.length >= 4, `Building context ${found.length}/7` + (miss.length ? ` — not found: ${miss.join(', ')}` : ''));
  }
  const conveyor = /CONVEYOR|\bTOR\b/.test(TXT);
  {
    const parts = [['max part', /MAX(IMUM)?\.?\s*PART|PART\s*(SIZE|ENVELOPE|WINDOW)/], ['hooks / pitch', /HOOK|PITCH/], ['indexing', /INDEX/], ['load per hook', /LBS?\b.*(HOOK|PER)|MAX(IMUM)?\s*LOAD/]];
    if (conveyor) {
      const miss = parts.filter(([, re]) => !re.test(TXT)).map(([k]) => k);
      put('2-3', miss.length <= 1, miss.length <= 1 ? 'Loading detail shown' + (miss.length ? ` (not found: ${miss[0]})` : '') : `Loading detail missing: ${miss.join(', ')}`);
    } else put('2-3', true, 'No conveyor — no loading detail needed');
  }
  put('2-5', !!chart.length, chart.length ? `Utility chart on ${s1 === sheets[0] ? 'sheet 1' : s1.name}` + (s1 !== sheets[0] ? ' (move to sheet 1)' : '') : chartAny.length ? 'Utility chart is not on sheet 1' : 'No utility chart found');
  if (chart.length && s1 !== sheets[0]) R['2-5'].ok = false;
  {
    const fut = TXT.match(/PHASE\s*(2|II)\b|FUTURE (EXPANSION|PHASE)/);
    put('2-6', fut ? null : true, fut ? `"${fut[0]}" shown — keep it only to prove expansion capacity, do not send it out for quote` : 'No future-phase views in the set');
  }

  // 3 · Dimensions and references
  {
    const cl = /\b(CL|C\/L|℄)\s*(OF\s*)?(EXHAUST|INTAKE|PENETRATION|STACK|DUCT)|CENTER\s*LINE|\bCL\b/.test(TXT);
    put('3-1', cl || null, cl ? 'Centerline callouts found' : 'No "CL" text — confirm penetrations are dimensioned to their centerline');
  }
  { const m = TXT.match(/(LOC\.?\s*DIM\.?\s*FROM|DIM\.?\s*FROM|FROM\s+(COL|GRID|WALL))[^\n]*/); put('3-2', !!m, m ? m[0].slice(0, 60) : 'No datum from building steel / wall (e.g. "LOC. DIM. FROM E6")'); }
  { const m = TXT.match(/OVERALL[^\n]*/); put('3-3', !!m, m ? m[0].slice(0, 60) : 'No OVERALL dimension'); }
  {
    const tor = /\bT\.?O\.?R\.?\b|TOP OF RAIL/.test(TXT), roof = /ROOF (DECK|HEIGHT)|\bDECK\b|BOTTOM OF|\bB\.?O\.?[SJD]\b|CEILING|CLEAR HEIGHT|EAVE/.test(TXT);
    const conv = /CONVEYOR/.test(TXT);
    const miss = [conv && !tor && 'TOR', !roof && 'roof deck / bottom of steel'].filter(Boolean);
    put('3-5', !miss.length, miss.length ? `Missing vertical reference: ${miss.join(', ')}` : 'TOR and roof references shown');
  }
  // 3-8: TOR on the layout vs quotes and vendor drawings
  {
    const TOR = /(\d+\s*'\s*-?\s*\d+(?:\s+\d+\/\d+)?\s*"?)\s*(?:T\.?O\.?R\.?|TOP OF RAIL)\b|(?:T\.?O\.?R\.?|TOP OF RAIL)\s*[:=@]?\s*(\d+\s*'\s*-?\s*\d+(?:\s+\d+\/\d+)?\s*"?)/i;
    const torOf = s => { const m = String(s).match(TOR); return m ? parseFtIn((m[1] || m[2]).replace(/\s+/g, '')) : null; };
    const mine = torOf(TXT);
    if (!mine) put('3-8', conveyor ? false : true, conveyor ? 'No TOR on the layout to compare with the RFQ / quote' : 'No conveyor — nothing to compare', 'pdf + quotes');
    else {
      const diff = [], same = [];
      for (const r of (set.references || []).slice(0, 14)) {
        const v = torOf(r.text || ''); if (!v) continue;
        (Math.abs(v - mine) > 1 / 12 ? diff : same).push(`${String(r.name).slice(0, 40)}: ${Math.floor(v)}'-${Math.round((v % 1) * 12)}"`);
      }
      const tor = `${Math.floor(mine)}'-${Math.round((mine % 1) * 12)}"`;
      put('3-8', diff.length ? false : same.length ? true : null, diff.length ? `Layout TOR ${tor} but ${list(diff, 2)}` : same.length ? `TOR ${tor} matches ${same.length} quote / vendor document(s)` : `TOR ${tor} — no quote or vendor drawing states a TOR to compare`, 'pdf + quotes');
    }
  }

  // 4 · Utilities
  if (chartAny.length) {
    const c = chartAny;
    {
      const issues = [];
      for (const p of ID_ORDER) { const ns = c.filter(r => r.prefix === p).map(r => r.n); if (ns.some((n, i) => n !== i + 1)) issues.push(`${p} numbered ${ns.join(',')}`); }
      const planTxt = s1.rows.filter(r => !(r[0] && ID.test(r[0]) && r.length >= 3)).flat();
      const noTag = c.filter(r => !planTxt.includes(r.id)).map(r => r.id);
      const tagNoRow = [...new Set(planTxt.filter(s => ID.test(s)))].filter(id => !c.some(r => r.id === id));
      if (noTag.length) issues.push(`no tag in plan for ${noTag.join(', ')}`);
      if (tagNoRow.length) issues.push(`tags without chart row: ${tagNoRow.join(', ')}`);
      put('4-1', !issues.length, issues.length ? issues.join('; ') : `${c.length} rows, every ID tagged in the plan`);
    }
    {
      // The equipment column wins for intakes: "Exhaust | AMU Intake" tagged X2 must be F.
      const want = r => /exhaust|intake|fresh|make/i.test(r.type) && /intake|make ?-?up|\bAMU\b/i.test(r.equip) && !/exhaust/i.test(r.equip) ? 'F' : (TYPE_PREFIX.find(([re]) => re.test(r.type)) || [])[1];
      const bad = c.filter(r => want(r) && want(r) !== r.prefix).map(r => `${r.id} (${r.equip}) should be ${want(r)}`);
      put('4-2', !bad.length, bad.length ? `Wrong prefix: ${list(bad, 3)}` : 'ID prefixes match the service');
    }
    {
      const bad = c.filter(r => r.prefix === 'E').map(r => {
        const s = r.line.toUpperCase(), three = /3\s*PH/.test(s), miss = [];
        if (!/\d+\s*AMP|\d+\s*A\b/.test(s)) miss.push('amps');
        if (!/\d{3}\s*V/.test(s)) miss.push('voltage');
        if (three && !/FLA/.test(s)) miss.push('FLA');
        if (three && !/\d\s*W\b|WIRE/.test(s)) miss.push('wires');
        return miss.length ? `${r.id} no ${miss.join('/')}` : null;
      }).filter(Boolean);
      const anyE = c.some(r => r.prefix === 'E');
      put('4-3', anyE && !bad.length, !anyE ? 'No electrical (E) rows' : bad.length ? list(bad, 3) : 'Amps, FLA and V/ph/wires on every E row');
    }
    {
      const miss = [];
      const booth = /BOOTH/.test(TXT), liquid = booth && !/POWDER/.test(TXT);
      if (!c.some(r => r.prefix === 'A')) miss.push('compressed air (A)');
      if (liquid && !c.some(r => r.prefix === 'B')) miss.push('breathing air (B)');
      c.filter(r => r.prefix === 'G').forEach(r => { if (!/PSI/i.test(r.line)) miss.push(`${r.id} PSI`); if (!/BTU/i.test(r.line)) miss.push(`${r.id} BTU/h`); });
      if (/CONVEYOR/.test(TXT) && !c.some(r => /lubric|oiler/i.test(r.equip))) miss.push('chain oiler outlet');
      put('4-4', !miss.length, miss.length ? `Missing: ${miss.join(', ')}` : 'Air, breathing air and gas complete');
    }
    {
      const pen = c.filter(r => r.prefix === 'X' || r.prefix === 'F');
      const bad = pen.filter(r => (r.line.match(/\d+(\.\d+)?\s*"?\s*(DIA|Ø|"\s*x|x\s*\d)/gi) || []).length < 2 && !/CURB/i.test(r.line)).map(r => r.id);
      const detail = /CURB|PENETRATION DETAIL/.test(TXT);
      const why = [bad.length && `duct + curb/opening size missing on ${bad.join(', ')}`, pen.length && !detail && 'no penetration / curb detail'].filter(Boolean);
      if (pen.length) put('4-5', !why.length, why.length ? why.join('; ') : 'Duct and curb sizes on every X/F row, detail shown');
    }
  } else for (const id of ['4-1', '4-2', '4-3', '4-4', '4-5']) put(id, false, 'No utility chart in the set');
  {
    const pens = chartAny.filter(r => r.prefix === 'X' || r.prefix === 'F').map(r => r.id);
    const steel = /PURLIN|JOIST|ROOF RIB|ROOF STEEL/.test(TXT), offs = /OFFSET/.test(TXT);
    if (!pens.length) put('4-6', true, 'No roof / wall penetrations');
    else if (!steel) put('4-6', false, `Roof steel (purlins / joists) not shown — can't confirm ${pens.join(', ')} clear it`);
    else put('4-6', offs ? null : true, offs ? 'Duct offsets drawn — consider moving the system instead' : `Roof steel shown, no offsets on ${pens.join(', ')}`);
  }
  {
    const n = (TXT.match(/\bTBD\b/g) || []).length;
    put('4-7', !n, n ? `${n} × "TBD" — write VERIFY WITH <vendor> or ESTIMATED` : 'No bare TBD');
  }

  // 5 · Notes and callouts
  {
    const notes = /NOTES?:/.test(TXT);
    if (conveyor) put('5-1', notes && /\bTOR\b/.test(TXT), notes ? (/\bTOR\b/.test(TXT) ? 'NOTES block with TOR' : 'NOTES block has no TOR') : 'No NOTES block');
    else put('5-1', true, 'No conveyor — no conveyor notes needed');
  }
  { const n = (TXT.match(/BY OTHERS/g) || []).length; put('5-2', n >= 2, n ? `"BY OTHERS" ×${n}` + (n < 2 ? ' — state curbs, supports, crane, etc.' : '') : 'No "BY OTHERS" scope stated'); }
  {
    const miss = [/CONVEYOR/.test(TXT) && !/E-?\s?STOP/.test(TXT) && 'E-stops', !/PANEL/.test(TXT) && 'control panels'].filter(Boolean);
    put('5-3', !miss.length, miss.length ? `No callout for ${miss.join(', ')}` : 'E-stops and panels called out');
  }
  {
    const ser = [...new Set(TXT.match(/\bN\d{6}\b/g) || [])];
    if (ser.length) {
      const nearOne = ser.filter(a => ser.some(b => a !== b && [...a].filter((ch, i) => ch !== b[i]).length === 1));
      put('5-4', !nearOne.length, nearOne.length ? `Serial numbers differ by one digit: ${nearOne.join(' / ')}` : `Serials consistent: ${ser.join(', ')}`);
    }
    // Vendor order numbers seen in the project's folders must appear on the layout.
    const onLayout = new Set(TXT.match(/\bN\d{6}\b/g) || []);
    const absent = [...new Set(set.folderOrders || [])].filter(u => !onLayout.has(u));
    if (absent.length && (!R['5-4'] || R['5-4'].ok)) put('5-4', false, `Vendor order ${absent.join(', ')} on file but not on the layout tags`, 'pdf + folder');
    else if (!R['5-4']) put('5-4', true, 'No vendor order numbers yet — none expected on the layout');
  }
  {
    const notes = TXT.match(/REVISED?\b[^\n]{0,50}|REV(ISION)?\s*\d+\s*[:-][^\n]{0,50}|△[^\n]{0,40}|CHANGES?:[^\n]{0,40}/);
    put('5-5', top <= 0 ? true : notes ? true : null, top <= 0 ? 'First issue' : notes ? notes[0].trim() : `Rev ${top} has no revision note — if something changed for the customer or vendor, note it on the L01`);
  }

  // 6 · Delivery
  {
    const perView = /\d+\/\d+"\s*=\s*1'(-0")?|SCALE:\s*1:\d+/.test(TXT);
    // The tool also flags "measured to scale but marked NTS"; measuring the scale needs PDF geometry.
    put('6-5', perView ? true : null, perView ? 'Scale stated per view' : 'No per-view scale — fine for a concept sketch (NTS); state it if the view is used to measure');
  }

  const allIds = CHECKLIST.groups.flatMap(g => g.items.map(i => i.id));
  const notCovered = allIds.filter(id => !R[id]).map(id => ({ id, why: NOT_COVERED[id] || 'not automated' }));
  return { version: VERSION, rev: top, files: set_, sheets: sheets.length, results: R, notCovered };
}

module.exports = { checkLayout, revOf, parseFtIn, utilityRows, VERSION };
