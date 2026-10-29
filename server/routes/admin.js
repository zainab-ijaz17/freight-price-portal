const express = require('express');
const { withDb, withTransaction } = require('../store');
const { requireActor, requireRole } = require('../middleware/auth');
const { rateLineCount, vendorById, archiveEarlierRevisions } = require('../rateEngine');
const { validateAgreementTerms, checkValidityOrder, parseRates, findRow, parseListTerms } = require('../masterData');
const { fail, handle } = require('../errors');

const router = express.Router();

// The Rate Approver's vendor and agreement maintenance (this was once a
// separate Administrator role). Adding or deleting vendors, destinations
// and vehicle types is not done here — see routes/changeRequests.js.

function logAudit(db, action, actor, details) {
  db.auditLog.unshift({ action, actor, at: new Date().toISOString(), details });
}

function withMeta(db, v) {
  const rev = db.revisions[db.currentRevisionNo];
  return { ...v, rateLineCount: rateLineCount(db, v.id), lastRevisedDate: rev.effectiveDate };
}

// GET /admin/vendors — see app/js/api/adminApi.js
router.get('/admin/vendors', requireActor, requireRole('Approver'), handle('loading vendors', async (req, res) => {
  res.json(await withDb(async (db) => db.vendors.map((v) => withMeta(db, v))));
}));

// PATCH /admin/vendors/:vendorId/agreement — see app/js/api/adminApi.js
router.patch('/admin/vendors/:vendorId/agreement', requireActor, requireRole('Approver'), handle('saving the agreement', async (req, res) => {
  const result = await withTransaction(async (db) => {
    const v = vendorById(db, req.params.vendorId);
    const patch = req.body || {};
    validateAgreementTerms(patch, { partial: true });
    const nextStart = patch.validityStart !== undefined ? patch.validityStart || null : v.validityStart;
    const nextEnd = patch.validityEnd !== undefined ? patch.validityEnd || null : v.validityEnd;
    checkValidityOrder(nextStart, nextEnd);

    const before = { passThroughPct: v.passThroughPct, roundingRule: v.roundingRule, validityStart: v.validityStart, validityEnd: v.validityEnd };
    if (patch.passThroughPct != null) v.passThroughPct = Number(patch.passThroughPct);
    if (patch.roundingRule != null) v.roundingRule = patch.roundingRule;
    v.validityStart = nextStart;
    v.validityEnd = nextEnd;
    logAudit(db, 'agreement_updated', req.actor, { vendorId: v.id, before, after: { passThroughPct: v.passThroughPct, roundingRule: v.roundingRule, validityStart: v.validityStart, validityEnd: v.validityEnd } });
    return withMeta(db, v);
  });
  res.json(result);
}));

// PUT /admin/vendors/:vendorId/list-terms — see app/js/api/adminApi.js
// The list's conditions (printed at the end of its sheet) and the
// transporters it applies to. A correction to the list as currently
// issued: earlier revisions keep the ones they had (archived first, if
// not already), the current revision shows the new ones.
router.put('/admin/vendors/:vendorId/list-terms', requireActor, requireRole('Approver'), handle('saving the conditions', async (req, res) => {
  const { vendorId } = req.params;
  const result = await withTransaction(async (db) => {
    const v = vendorById(db, vendorId);
    const sheet = db.rateSheets[vendorId];
    const after = parseListTerms(req.body || {});
    const before = { conditions: sheet.conditions || [], transporters: v.transporters || [] };

    archiveEarlierRevisions(db, vendorId, db.currentRevisionNo);
    sheet.conditions = after.conditions;
    v.transporters = after.transporters;
    const current = db.rateSnapshots[vendorId]?.[db.currentRevisionNo];
    if (current) Object.assign(current, { conditions: [...after.conditions], transporters: [...after.transporters] });

    logAudit(db, 'list_terms_updated', req.actor, { vendorId, revisionNo: db.currentRevisionNo, before, after });
    return after;
  });
  res.json(result);
}));

// GET /admin/vendors/:vendorId/rate-sheet — see app/js/api/adminApi.js
router.get('/admin/vendors/:vendorId/rate-sheet', requireActor, requireRole('Approver'), handle('loading the rate sheet', async (req, res) => {
  res.json(await withDb(async (db) => {
    vendorById(db, req.params.vendorId);
    return db.rateSheets[req.params.vendorId];
  }));
}));

// PATCH /admin/vendors/:vendorId/destinations — see app/js/api/adminApi.js
// Updates the base rates for a destination that already exists on the
// sheet (matched by name, case-insensitively) — how a maintainer actually
// fills in rates for a vendor whose destinations exist but have no
// numbers yet.
router.patch('/admin/vendors/:vendorId/destinations', requireActor, requireRole('Approver'), handle('saving the base rates', async (req, res) => {
  const { vendorId } = req.params;
  const sheet = await withTransaction(async (db) => {
    vendorById(db, vendorId);
    const sheet = db.rateSheets[vendorId];
    const { destination, baseRates } = req.body || {};
    if (!destination?.trim()) throw fail('MD-007', 'Destination name is missing from the request.', { field: 'Destination' });
    if (!Array.isArray(baseRates) || baseRates.length !== sheet.cols.length) {
      throw fail('MD-008', `Enter a base rate (or leave blank) for each of the ${sheet.cols.length} vehicle type(s).`, { field: 'Base rates' });
    }
    const waiting = db.pendingSheets.find((s) => s.vendorId === vendorId);
    if (waiting) {
      throw fail('MD-015', `This rate list's sheet is waiting for approval in revision ${waiting.revisionNo}; releasing it would overwrite a base rate changed now. Approve, return or reject that sheet first.`, { status: 409, field: 'Base rates' });
    }
    const row = findRow(sheet, destination);
    if (!row) throw fail('MD-010', `"${destination.trim()}" is not on this rate list any more. Reload the page.`, { status: 404, field: 'Destination' });
    const after = parseRates(baseRates, sheet.cols, 'MD-013', `Base rate · ${row[0]}`);
    const before = row.slice(1);
    after.forEach((v, i) => { row[i + 1] = v; });
    logAudit(db, 'destination_rate_updated', req.actor, { vendorId, destination: row[0], before, after });
    return sheet;
  });
  res.json(sheet);
}));

module.exports = router;
