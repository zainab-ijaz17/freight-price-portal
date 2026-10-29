const express = require('express');
const { withDb } = require('../store');
const { requireActor } = require('../middleware/auth');
const {
  vendorById, revisionCoveringDate, rateAtRevision, subtractOneDay, scaledRate, isValidDMY,
} = require('../rateEngine');
const { fail, handle } = require('../errors');

const router = express.Router();

// Who released this list's sheet in that revision: each list's sheet is
// approved on its own, so it can differ from whoever released the
// revision's first sheet (revisions.approved_by).
function approvalOf(db, vendorId, revNo) {
  const snap = db.rateSnapshots[vendorId]?.[revNo];
  const rev = db.revisions[revNo];
  return { approvedBy: snap?.approvedBy || rev.approvedBy, approvedOn: snap?.approvedOn || rev.approvedOn };
}

// GET /rates/lookup?vendorId=&destination=&vehicleType=&date= — see app/js/api/rateLookupApi.js
router.get('/rates/lookup', requireActor, handle('looking up the rate', async (req, res) => {
  const { date, vendorId, destination, vehicleType } = req.query;
  if (date && !isValidDMY(date)) throw fail('LKP-002', 'Enter the date as DD.MM.YYYY, or leave it blank for today.', { field: 'Date' });

  const result = await withDb(async (db) => {
    let v;
    try {
      v = vendorById(db, vendorId);
    } catch {
      return null;
    }
    const sheet = db.rateSheets[vendorId];
    const colIndex = sheet.cols.indexOf(vehicleType);
    const row = sheet.rows.find((r) => r[0].toLowerCase().includes((destination || '').trim().toLowerCase()));
    if (!row || colIndex === -1) return null;
    const destName = row[0];

    const revNo = revisionCoveringDate(db, date);
    if (revNo == null) return null; // date predates every known revision

    // 0: the list doesn't offer this vehicle type for this destination.
    const rate = rateAtRevision(db, vendorId, destName, colIndex, revNo);
    if (!rate) return null;

    const revNos = Object.keys(db.revisions).map(Number).sort((a, b) => b - a);
    const nextRevNo = revNos[revNos.indexOf(revNo) - 1];
    const rev = db.revisions[revNo];
    const approval = approvalOf(db, vendorId, revNo);
    return {
      rate,
      vendorName: v.name,
      transporters: v.transporters,
      destination: destName,
      vehicleType,
      annexure: sheet.annexure,
      revisionNo: revNo,
      validFrom: rev.effectiveDate,
      validTo: nextRevNo ? subtractOneDay(db.revisions[nextRevNo].effectiveDate) : 'current',
      approvedBy: approval.approvedBy,
      approvedOn: approval.approvedOn,
    };
  });

  res.json(result);
}));

// GET /rates/history?vendorId=&destination=&vehicleType= — see app/js/api/rateLookupApi.js
router.get('/rates/history', requireActor, handle('loading the rate history', async (req, res) => {
  const { vendorId, destination, vehicleType } = req.query;

  const history = await withDb(async (db) => {
    const sheet = db.rateSheets[vendorId];
    if (!sheet) return [];
    const colIndex = sheet.cols.indexOf(vehicleType);
    const row = sheet.rows.find((r) => r[0].toLowerCase().includes((destination || '').trim().toLowerCase()));
    if (!row || colIndex === -1) return [];
    const destName = row[0];

    const revNos = Object.keys(db.revisions).map(Number).sort((a, b) => b - a);
    return revNos
      .map((revNo, i) => {
        const rev = db.revisions[revNo];
        const nextRev = db.revisions[revNos[i - 1]];
        return {
          revisionNo: revNo,
          dieselPrice: rev.dieselPrice,
          rate: rateAtRevision(db, vendorId, destName, colIndex, revNo),
          validFrom: rev.effectiveDate,
          validTo: nextRev ? subtractOneDay(nextRev.effectiveDate) : 'current',
        };
      })
      .filter((h) => h.rate);
  });

  res.json(history);
}));

// GET /vendors/:vendorId/vehicle-types — see app/js/api/rateLookupApi.js
router.get('/vendors/:vendorId/vehicle-types', requireActor, handle('loading vehicle types', async (req, res) => {
  res.json(await withDb(async (db) => {
    vendorById(db, req.params.vendorId);
    return db.rateSheets[req.params.vendorId].cols;
  }));
}));

// GET /revisions/options — see app/js/api/rateLookupApi.js
router.get('/revisions/options', requireActor, handle('loading revisions', async (req, res) => {
  const options = await withDb(async (db) => Object.keys(db.revisions).map(Number).sort((a, b) => b - a));
  res.json(options);
}));

// GET /vendors/:vendorId/annexure?revisionNo= — see app/js/api/rateLookupApi.js
router.get('/vendors/:vendorId/annexure', requireActor, handle('loading the annexure', async (req, res) => {
  const { vendorId } = req.params;
  const revisionNo = Number(req.query.revisionNo);

  const result = await withDb(async (db) => {
    const v = vendorById(db, vendorId);
    const sheet = db.rateSheets[vendorId];
    const rev = db.revisions[revisionNo];
    if (!rev) throw fail('LKP-003', `Revision ${req.query.revisionNo} does not exist. Pick one from the list.`, { status: 404, field: 'Revision' });

    const snapshotEntry = db.rateSnapshots[vendorId]?.[revisionNo];
    const snapshot = snapshotEntry?.rows;
    const auditRows = snapshotEntry?.auditRows;
    const rows = (snapshot || sheet.rows).map((row, i) => ({
      no: i + 1,
      dest: row[0],
      // Padded to today's columns: a vehicle type added after this
      // revision simply has no rate in it.
      cells: sheet.cols.map((_, j) => {
        const val = row[j + 1];
        return snapshot ? val ?? null : scaledRate(val, rev.factor);
      }),
      // Section 6's audit requirement: the base rate and unrounded
      // adjusted rate a published cell was computed from, where known
      // (every revision approved through this app has it; the two
      // pre-existing seed revisions only have the scalar approximation
      // above, so there's nothing to trace for those).
      audit: auditRows?.[i] ? { base: auditRows[i].base, unrounded: auditRows[i].sum } : null,
    }));

    return {
      title: sheet.title,
      annexure: sheet.annexure,
      cols: sheet.cols,
      vendorName: v.name,
      // As they stood in this revision, where it kept them.
      transporters: snapshotEntry?.transporters ?? v.transporters,
      revisionNo,
      dieselPrice: rev.dieselPrice,
      effectiveDate: rev.effectiveDate,
      ...approvalOf(db, vendorId, revisionNo),
      isCurrent: revisionNo === db.currentRevisionNo,
      // Printed at the end of the sheet. {dieselPrice} in one is filled in
      // with this revision's price by the page.
      conditions: snapshotEntry?.conditions ?? sheet.conditions,
      rows,
    };
  });
  res.json(result);
}));

module.exports = router;
