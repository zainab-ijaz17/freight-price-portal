// Pure calculation/lookup logic shared by the routes in server/routes/.
// Ported from the old app/js/api/mock/mockServer.js so the real backend
// behaves exactly like the mock did — same formulas, same shapes — just
// reading/writing a persisted `db` (server/store.js) instead of an
// in-browser object that reset on reload.

const { fail } = require('./errors');

function vendorById(db, id) {
  const v = db.vendors.find((v) => v.id === id);
  if (!v) throw fail('VND-003', `Rate list "${id}" was not found. It may have been deleted — reload the page and pick it again.`, { status: 404, field: 'Rate list' });
  return v;
}

// Whole numbers stay whole ("40"), anything else keeps up to 2 decimals
// ("37.5") — never a padded "40.00".
function trimNum(n, maxDecimals = 2) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: maxDecimals, useGrouping: false });
}

// 0 for a rate list with no rate_sheets row.
function rateLineCount(db, vendorId) {
  const sheet = db.rateSheets[vendorId];
  if (!sheet) return 0;
  return sheet.rows.length * sheet.cols.length;
}

// Rounding is a per-agreement, maintainer-configured field (Section 5) —
// never hardcoded to one rule for every vendor.
function roundByRule(value, rule) {
  if (rule === 'Nearest 100') return Math.round(value / 100) * 100;
  if (rule === 'Nearest 50') return Math.round(value / 50) * 50;
  return Math.round(value); // 'None' — no bucket rounding, just whole rupees
}

// Computes one vendor's before/after worksheet for a candidate diesel
// price, per the Section 6 formula:
//   adjustedRate = baseRate * (1 + upliftPct/100)      — unrounded
//   publishedRate = ROUND(adjustedRate, roundingRule)  — rounded once, at the end
// A line with no base rate on file (base == null — never priced before)
// can't go through that formula at all; `overrides` lets the maintainer
// supply that line's rate directly instead. Once submitted and approved,
// it's written back to rate_sheets as an ordinary rate, so it becomes the
// base rate the *next* revision projects an increase from — this is how a
// vendor's rates get entered for the first time, through the same
// simulate/submit/approve flow as any other revision, not a separate
// "master data" step.
// `rowOverrides`: { [rowIndex]: { [colIndex]: number } }
function computeWorksheet(db, v, upliftPct, rowOverrides) {
  const sheet = db.rateSheets[v.id];
  const rows = sheet.rows.map((row, i) => {
    const base = row.slice(1);
    const overridesForRow = rowOverrides?.[i] || {};
    const sum = base.map((b) => (b == null ? null : b * (1 + upliftPct / 100))); // adjusted rate, unrounded
    const inc = sum.map((s, j) => (s == null ? null : s - base[j])); // for display only
    const rounded = sum.map((s, j) => {
      if (s != null) return roundByRule(s, v.roundingRule);
      const override = overridesForRow[j];
      return override === '' || override == null ? null : Number(override);
    });
    const bal = rounded.map((r) => (r == null ? null : 0));
    return { no: i + 1, dest: row[0], base, inc, sum, rounded, bal };
  });
  const blocked = rows.some((r) => r.bal.some((b) => b == null));
  return {
    title: sheet.title,
    annexure: sheet.annexure,
    transporters: v.transporters || [],
    cols: sheet.cols,
    weights: sheet.weights,
    rows,
    conditions: sheet.conditions || [],
    blocked,
  };
}

// Each submission is its own revision number, even while sheets from an
// earlier one are still waiting for approval.
function nextRevisionNo(db) {
  const taken = [db.currentRevisionNo, ...Object.keys(db.revisions).map(Number), ...db.pendingSheets.map((s) => s.revisionNo)];
  return Math.max(...taken) + 1;
}

function buildSimulation(db, { dieselPrice, effectiveDate, vendorIds, overrides }) {
  const previous = db.revisions[db.currentRevisionNo];
  const overallUpliftPct = ((dieselPrice - previous.dieselPrice) / previous.dieselPrice) * 100;

  const vendors = vendorIds.map((id) => {
    const v = vendorById(db, id);
    const upliftPct = overallUpliftPct * (v.passThroughPct / 100);
    return { id: v.id, name: v.name, upliftPct, upliftBasis: `${trimNum(v.passThroughPct)}% pass-through of ${trimNum(overallUpliftPct)}%` };
  });

  const worksheets = {};
  vendors.forEach((v) => { worksheets[v.id] = computeWorksheet(db, vendorById(db, v.id), v.upliftPct, overrides?.[v.id]); });

  const blocked = Object.values(worksheets).some((w) => w.blocked);
  const rateLineTotal = vendorIds.reduce((sum, id) => sum + rateLineCount(db, id), 0);

  return {
    revisionNo: nextRevisionNo(db),
    effectiveDate,
    overallUpliftPct,
    vendors: vendors.map((v) => ({ ...v, blocked: worksheets[v.id].blocked })),
    worksheets,
    totals: { vendorCount: vendorIds.length, rateLineCount: rateLineTotal },
    blocked,
  };
}

// Every date in the portal is DD.MM.YYYY — stored, sent and shown.
function isValidDMY(str) {
  if (typeof str !== 'string' || !/^\d{2}\.\d{2}\.\d{4}$/.test(str)) return false;
  const [d, m, y] = str.split('.').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function formatDMY(date) {
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}

function parseDMY(ddmmyyyy) {
  const [d, m, y] = ddmmyyyy.split('.').map(Number);
  return new Date(y, m - 1, d);
}

function subtractOneDay(ddmmyyyy) {
  const [d, m, y] = ddmmyyyy.split('.').map(Number);
  return formatDMY(new Date(y, m - 1, d - 1));
}

// The revision in effect on `dateStr` (DD.MM.YYYY), or the current revision
// if no date is given. Returns null if the date predates every known revision.
function revisionCoveringDate(db, dateStr) {
  const revNos = Object.keys(db.revisions).map(Number).sort((a, b) => b - a);
  if (!dateStr) return revNos[0];
  const target = parseDMY(dateStr);
  const covering = revNos.find((revNo) => parseDMY(db.revisions[revNo].effectiveDate) <= target);
  return covering ?? null;
}

// This vendor/destination/column's rate as it stood at `revNo`: the exact
// archived figure if this revision has an rateSnapshots entry (every
// revision approved through this app gets one), else the scalar-factor
// approximation against today's master rate (only for revisions from
// before this app that were loaded with a factor and no snapshot).
function rateAtRevision(db, vendorId, destName, colIndex, revNo) {
  const snapshotRow = db.rateSnapshots[vendorId]?.[revNo]?.rows?.find((r) => r[0] === destName);
  if (snapshotRow) return snapshotRow[colIndex + 1];
  const currentRow = db.rateSheets[vendorId].rows.find((r) => r[0] === destName);
  return scaledRate(currentRow[colIndex + 1], db.revisions[revNo].factor);
}

// Today's rate as it stood in a revision with no snapshot. Factor 1 is
// the revision the sheet's rates were issued in: those are the rates
// exactly as published, never re-rounded.
function scaledRate(rate, factor) {
  if (rate == null || factor === 1) return rate;
  return roundByRule(rate * factor, 'Nearest 100');
}

// A list's conditions and transporters as they stand, for a snapshot.
function listTerms(db, vendorId) {
  return {
    conditions: [...(db.rateSheets[vendorId].conditions || [])],
    transporters: [...(vendorById(db, vendorId).transporters || [])],
  };
}

// Every earlier revision this list's sheet sat unchanged through (back to
// its last archived one) gets the rows, conditions and transporters as
// they are now, before a release (or an edit to the conditions) changes
// them — so those revisions keep showing what really applied then. Stops
// at revisions whose rates are a scalar approximation (factor ≠ 1), not
// today's rows.
function archiveEarlierRevisions(db, vendorId, revisionNo) {
  const sheet = db.rateSheets[vendorId];
  db.rateSnapshots[vendorId] = db.rateSnapshots[vendorId] || {};
  const earlier = Object.keys(db.revisions).map(Number).filter((r) => r < revisionNo).sort((a, b) => b - a);
  for (const r of earlier) {
    if (db.rateSnapshots[vendorId][r] || db.revisions[r].factor !== 1) break;
    db.rateSnapshots[vendorId][r] = { rows: sheet.rows.map((row) => [...row]), auditRows: null, ...listTerms(db, vendorId) };
  }
}

// Local date, not toISOString()'s UTC one — which is still "yesterday"
// for the first five hours of every day in Pakistan.
function today() {
  return formatDMY(new Date());
}

module.exports = {
  vendorById,
  trimNum,
  rateLineCount,
  roundByRule,
  computeWorksheet,
  nextRevisionNo,
  buildSimulation,
  parseDMY,
  isValidDMY,
  formatDMY,
  subtractOneDay,
  revisionCoveringDate,
  rateAtRevision,
  scaledRate,
  listTerms,
  archiveEarlierRevisions,
  today,
};
