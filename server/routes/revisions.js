// The revision workflow. A maintainer submits a revision covering one or
// more vendors; each vendor's rate sheet then waits for approval as its
// own item (db.pendingSheets), so an approver can release one vendor's
// sheet while returning or rejecting another's. Several revisions can be
// waiting at once, as long as no vendor has two sheets waiting.
const express = require('express');
const { withDb, withTransaction } = require('../store');
const { requireActor, requireRole } = require('../middleware/auth');
const { verifyEmployeeCredentials } = require('../sfClient');
const { buildSimulation, rateLineCount, vendorById, today, parseDMY, isValidDMY } = require('../rateEngine');
const { fail, handle } = require('../errors');
const { createAlert } = require('../alerts');
const { emailSheetsSubmitted } = require('../approvalEmails');

const router = express.Router();

// Only one fuel is indexed — the old fuel-type choice is gone.
const FUEL_TYPE = 'Diesel';

function logAudit(db, action, actor, details) {
  db.auditLog.unshift({ action, actor, at: new Date().toISOString(), details });
}

function personText(p) {
  return p.name && p.name !== p.employeeId ? `${p.name} (${p.employeeId})` : p.employeeId;
}

function validateSimulationInput(payload) {
  if (!payload.vendorIds?.length) {
    throw fail('VND-001', 'Select at least one vendor to simulate.', { field: 'Vendor list' });
  }
  if (!isValidDMY(payload.effectiveDate)) {
    throw fail('VND-002', 'Enter the date the new rates take effect as DD.MM.YYYY.', { field: 'Rates effective from' });
  }
}

function sheetLineCount(s) {
  return s.worksheet.rows.length * s.worksheet.cols.length;
}

// What a list needs about a pending sheet — everything but the rates.
function sheetSummary(s) {
  return {
    id: s.id,
    revisionNo: s.revisionNo,
    vendorId: s.vendorId,
    vendorName: s.vendorName,
    annexure: s.worksheet.annexure,
    rateLineCount: sheetLineCount(s),
    upliftPct: s.upliftPct,
    effectiveDate: s.effectiveDate,
    dieselPrice: s.dieselPrice,
    submittedBy: s.submittedBy,
    submittedOn: s.submittedOn,
    submittedAt: s.submittedAt,
    resubmission: Boolean(s.previousReturn),
  };
}

// POST /revisions/simulate — see app/js/api/revisionsApi.js
router.post('/revisions/simulate', requireActor, requireRole('Rate Maintainer'), handle('running the simulation', async (req, res) => {
  const payload = req.body || {};
  validateSimulationInput(payload);
  res.json(await withDb(async (db) => buildSimulation(db, payload)));
}));

// POST /revisions — see app/js/api/revisionsApi.js
router.post('/revisions', requireActor, requireRole('Rate Maintainer'), handle('submitting the revision for approval', async (req, res) => {
  const payload = req.body || {};
  const submittedBy = { employeeId: req.actor.employeeId, name: req.actor.name };
  const { result, sheets } = await withTransaction(async (db, client) => {
    validateSimulationInput(payload);
    const busy = payload.vendorIds
      .map((id) => db.pendingSheets.find((s) => s.vendorId === id))
      .filter(Boolean);
    if (busy.length) {
      const list = busy.map((s) => `${s.vendorName} (revision ${s.revisionNo})`).join(', ');
      throw fail('REV-001', `A rate sheet is already waiting for approval for: ${list}. Untick ${busy.length === 1 ? 'that vendor' : 'those vendors'}, or wait until the approver has decided.`, { status: 409, field: 'Vendor list' });
    }
    if (!payload.notificationId) {
      throw fail('DSL-004', 'Attach the diesel-price notification before submitting.', { field: 'Attach notification' });
    }
    if (!isValidDMY(payload.dieselEffectiveDate)) {
      throw fail('DSL-002', 'Enter the diesel price effective date as DD.MM.YYYY.', { field: 'Effective date' });
    }
    // "Effective date cannot be earlier than the last confirmed price"
    // — dieselPrice.js already enforces this client-side, but that's
    // bypassable by calling the API directly.
    const previous = db.revisions[db.currentRevisionNo];
    if (parseDMY(payload.dieselEffectiveDate) < parseDMY(previous.effectiveDate)) {
      throw fail('DSL-003', `The diesel price effective date cannot be earlier than the last confirmed price (${previous.effectiveDate}).`, { field: 'Effective date' });
    }
    const sim = buildSimulation(db, payload);
    if (sim.blocked) {
      const vendorNames = sim.vendors.filter((v) => v.blocked).map((v) => v.name).join(', ');
      throw fail('REV-002', `Some rate lines have no rate yet (${vendorNames}). Type a rate for each under "New rates" before submitting.`, { field: 'New rates' });
    }

    const submittedAt = new Date().toISOString();
    const created = sim.vendors.map((v) => {
      // The approver's earlier comments on this vendor's sheet travel with
      // the resubmission, so they can check they were addressed.
      const returned = db.returnedSheets.find((r) => r.vendorId === v.id);
      return {
        id: `${sim.revisionNo}-${v.id}`,
        revisionNo: sim.revisionNo,
        vendorId: v.id,
        vendorName: v.name,
        upliftPct: v.upliftPct,
        upliftBasis: v.upliftBasis,
        overallUpliftPct: sim.overallUpliftPct,
        worksheet: sim.worksheets[v.id],
        overrides: payload.overrides?.[v.id] || {},
        dieselPrice: payload.dieselPrice,
        previousDieselPrice: previous.dieselPrice,
        dieselEffectiveDate: payload.dieselEffectiveDate,
        effectiveDate: sim.effectiveDate,
        fuelType: FUEL_TYPE,
        source: payload.source,
        notificationId: payload.notificationId,
        notificationFileName: payload.notificationFileName,
        remarks: payload.remarks || '',
        submittedBy,
        submittedOn: today(),
        submittedAt,
        previousReturn: returned ? { revisionNo: returned.revisionNo, reason: returned.reason, returnedBy: returned.returnedBy, returnedOn: returned.returnedOn } : null,
      };
    });
    db.pendingSheets.push(...created);
    db.returnedSheets = db.returnedSheets.filter((r) => !payload.vendorIds.includes(r.vendorId));

    // Submitted — the saved draft it came from has done its job.
    if (payload.draftId) {
      await client.query('DELETE FROM revision_drafts WHERE id = $1 AND employee_id = $2', [payload.draftId, submittedBy.employeeId]);
    }
    logAudit(db, 'revision_submitted', submittedBy, { revisionNo: sim.revisionNo, vendorIds: payload.vendorIds });
    const resubmitted = created.some((s) => s.previousReturn);
    await createAlert(client, {
      toRole: 'Approver',
      actor: submittedBy,
      kind: 'revision_submitted',
      title: `Revision ${sim.revisionNo}: ${created.length} rate sheet${created.length === 1 ? '' : 's'} waiting for your approval`,
      body: `Submitted by ${personText(submittedBy)}${resubmitted ? ' (includes corrections)' : ''} · ${created.map((s) => s.vendorName).join(', ')} · ${sim.totals.rateLineCount} rate lines, effective ${sim.effectiveDate}.`,
      link: '#/approve',
    });
    return {
      sheets: created,
      result: { revisionNo: sim.revisionNo, sheetCount: created.length, status: 'pending', submittedBy, submittedOn: today() },
    };
  });
  emailSheetsSubmitted({ revisionNo: result.revisionNo, sheets, submittedBy });
  res.json(result);
}));

// GET /revisions/queue — every sheet waiting for approval, without its
// rates: the maintainer's "waiting for approval" list and the approver's
// queue. See app/js/api/revisionsApi.js.
router.get('/revisions/queue', requireActor, requireRole('Rate Maintainer', 'Approver'), handle('loading sheets waiting for approval', async (req, res) => {
  res.json(await withDb(async (db) => db.pendingSheets.map(sheetSummary)));
}));

// GET /revisions/pending — every sheet waiting for approval, in full. See
// app/js/api/revisionsApi.js.
router.get('/revisions/pending', requireActor, requireRole('Approver'), handle('loading the sheets waiting for approval', async (req, res) => {
  const result = await withDb(async (db) => db.pendingSheets.map((s) => ({
    ...sheetSummary(s),
    title: s.worksheet.title,
    upliftBasis: s.upliftBasis,
    overallUpliftPct: s.overallUpliftPct,
    previousDieselPrice: s.previousDieselPrice ?? db.revisions[db.currentRevisionNo].dieselPrice,
    dieselEffectiveDate: s.dieselEffectiveDate,
    fuelType: FUEL_TYPE,
    source: s.source,
    notificationId: s.notificationId,
    notificationFileName: s.notificationFileName,
    remarks: s.remarks,
    previousReturn: s.previousReturn || null,
    worksheet: s.worksheet,
  })));
  res.json(result);
}));

// GET /revisions/returned — sheets an approver sent back for correction,
// with their comments, until they're resubmitted. See
// app/js/api/revisionsApi.js.
router.get('/revisions/returned', requireActor, requireRole('Rate Maintainer'), handle('loading returned sheets', async (req, res) => {
  res.json(await withDb(async (db) => db.returnedSheets));
}));

function requireSheets(db, sheetIds) {
  if (!Array.isArray(sheetIds) || !sheetIds.length) {
    throw fail('APR-007', 'Select at least one rate sheet first.', { field: 'Rate sheets' });
  }
  return [...new Set(sheetIds)].map((id) => {
    const s = db.pendingSheets.find((p) => p.id === id);
    if (!s) {
      throw fail('APR-001', `Rate sheet ${id} is no longer waiting for approval — someone may already have acted on it. Reload the page.`, { status: 404 });
    }
    return s;
  });
}

function removeSheets(db, sheets) {
  const ids = new Set(sheets.map((s) => s.id));
  db.pendingSheets = db.pendingSheets.filter((s) => !ids.has(s.id));
}

// { revisionNo → [sheet] }, for one notification per revision.
function byRevision(sheets) {
  const groups = new Map();
  sheets.forEach((s) => groups.set(s.revisionNo, [...(groups.get(s.revisionNo) || []), s]));
  return groups;
}

// Every earlier revision this vendor's sheet sat unchanged through (back to
// its last archived one) gets the rows as they are now, before this
// release overwrites them — so a lookup for those revisions shows what
// really applied then. Stops at the seed data's pre-existing revisions,
// whose rates are a scalar approximation (factor ≠ 1), not today's rows.
function archiveEarlierRevisions(db, vendorId, revisionNo) {
  const sheet = db.rateSheets[vendorId];
  db.rateSnapshots[vendorId] = db.rateSnapshots[vendorId] || {};
  const earlier = Object.keys(db.revisions).map(Number).filter((r) => r < revisionNo).sort((a, b) => b - a);
  for (const r of earlier) {
    if (db.rateSnapshots[vendorId][r] || db.revisions[r].factor !== 1) break;
    db.rateSnapshots[vendorId][r] = { rows: sheet.rows.map((row) => [...row]), auditRows: null };
  }
}

// A revision released after a later one (23 approved once 24 already is):
// a vendor revised in that later revision has since moved on, so its
// rates during this one are those of its last archive before it — not its
// rate sheet today.
function archiveForLateRevision(db, revisionNo) {
  for (const snaps of Object.values(db.rateSnapshots)) {
    const revs = Object.keys(snaps).map(Number);
    if (snaps[revisionNo] || !revs.some((r) => r > revisionNo)) continue;
    const before = revs.filter((r) => r < revisionNo).sort((a, b) => b - a)[0];
    if (before != null) snaps[revisionNo] = { rows: snaps[before].rows.map((row) => [...row]), auditRows: null };
  }
}

// Writes one approved sheet's rates to the vendor's rate sheet and
// archives them under its revision. The resulting rates are this app's
// own system of record — nothing here writes to SAP.
function releaseSheet(db, s, approver) {
  vendorById(db, s.vendorId);
  const sheet = db.rateSheets[s.vendorId];
  archiveEarlierRevisions(db, s.vendorId, s.revisionNo);

  sheet.rows = sheet.rows.map((row, i) => {
    const newRow = [row[0]];
    const wRow = s.worksheet.rows[i];
    for (let j = 0; j < row.length - 1; j++) {
      newRow.push(wRow.rounded[j] == null ? row[j + 1] : wRow.rounded[j]);
    }
    return newRow;
  });
  // Section 6: keep the base rate and unrounded adjusted rate alongside
  // the published one, per line, for audit.
  const auditRows = s.worksheet.rows.map((wRow) => ({ dest: wRow.dest, base: wRow.base, sum: wRow.sum, rounded: wRow.rounded }));
  db.rateSnapshots[s.vendorId][s.revisionNo] = {
    rows: sheet.rows.map((row) => [...row]),
    auditRows,
    approvedBy: approver.name,
    approvedOn: today(),
  };

  // The first sheet released in a revision creates it; later ones join it.
  if (!db.revisions[s.revisionNo]) {
    archiveForLateRevision(db, s.revisionNo);
    db.revisions[s.revisionNo] = {
      dieselPrice: s.dieselPrice,
      effectiveDate: s.effectiveDate,
      factor: 1,
      approvedBy: approver.name,
      approvedOn: today(),
      notificationId: s.notificationId,
    };
  }
  db.currentRevisionNo = Math.max(db.currentRevisionNo, s.revisionNo);
  return rateLineCount(db, s.vendorId);
}

// POST /revisions/sheets/approve  { sheetIds, password } — see
// app/js/api/revisionsApi.js. The approver is whoever this session belongs
// to — never an ID taken from the request body. Re-authenticates them
// against real SuccessFactors (same check as login) once for the whole
// batch, and refuses if they submitted any of the sheets themselves.
router.post('/revisions/sheets/approve', requireActor, requireRole('Approver'), handle('approving the rate sheets', async (req, res) => {
  const { sheetIds, password } = req.body || {};
  const { employeeId, name } = req.actor;
  const approver = { employeeId, name };

  const result = await withTransaction(async (db, client) => {
    const sheets = requireSheets(db, sheetIds);
    const own = sheets.filter((s) => s.submittedBy.employeeId === employeeId);
    if (own.length) {
      throw fail('APR-002', `You submitted ${own.map((s) => `${s.vendorName} (revision ${s.revisionNo})`).join(', ')}, so you cannot also approve ${own.length === 1 ? 'it' : 'them'}. Another approver must release ${own.length === 1 ? 'it' : 'them'}.`, { status: 403 });
    }

    let valid;
    try {
      valid = await verifyEmployeeCredentials(employeeId, password);
    } catch (loginErr) {
      console.error('SF re-auth error:', loginErr.message);
      throw fail('APR-006', 'Could not reach SAP SuccessFactors to confirm your password. Try again in a moment.', { status: 502 });
    }
    // 403, not 401: a 401 makes the client end the whole session, which
    // is the wrong response to a mistyped confirmation password.
    if (!valid) throw fail('APR-003', 'That password is incorrect. Re-enter your SAP password to release the rate sheets.', { status: 403, field: 'Password' });

    // Oldest revision first, so a later one ends up current.
    const ordered = [...sheets].sort((a, b) => a.revisionNo - b.revisionNo);
    const released = ordered.map((s) => ({
      sheetId: s.id,
      revisionNo: s.revisionNo,
      vendorName: s.vendorName,
      effectiveDate: s.effectiveDate,
      linesWritten: releaseSheet(db, s, approver),
    }));
    removeSheets(db, sheets);

    for (const [revisionNo, group] of byRevision(ordered)) {
      const lines = released.filter((r) => r.revisionNo === revisionNo).reduce((sum, r) => sum + r.linesWritten, 0);
      logAudit(db, 'revision_approved', approver, { revisionNo, vendorIds: group.map((s) => s.vendorId), linesWritten: lines });
      await createAlert(client, {
        toRole: 'Rate Maintainer',
        actor: approver,
        kind: 'revision_approved',
        title: `Revision ${revisionNo} approved: ${group.map((s) => s.vendorName).join(', ')}`,
        body: `Approved by ${personText(approver)} · ${lines} rate lines now in effect from ${group[0].effectiveDate}.`,
        link: '#/lookup',
      });
    }
    return { released, linesWritten: released.reduce((sum, r) => sum + r.linesWritten, 0) };
  });
  res.json(result);
}));

function reasonFrom(req, code, message, field) {
  const reason = req.body?.reason?.trim();
  if (!reason) throw fail(code, message, { field });
  return reason;
}

// POST /revisions/sheets/reject  { sheetIds, reason } — see app/js/api/revisionsApi.js
router.post('/revisions/sheets/reject', requireActor, requireRole('Approver'), handle('rejecting the rate sheets', async (req, res) => {
  const result = await withTransaction(async (db, client) => {
    const sheets = requireSheets(db, req.body?.sheetIds);
    const reason = reasonFrom(req, 'APR-004', 'Enter a reason for rejecting.', 'Reason');
    removeSheets(db, sheets);
    for (const [revisionNo, group] of byRevision(sheets)) {
      logAudit(db, 'revision_rejected', req.actor, { revisionNo, vendorIds: group.map((s) => s.vendorId), reason });
      await createAlert(client, {
        toRole: 'Rate Maintainer',
        actor: req.actor,
        kind: 'revision_rejected',
        title: `Revision ${revisionNo} rejected: ${group.map((s) => s.vendorName).join(', ')}`,
        body: `Rejected by ${personText(req.actor)} on ${today()}. Reason: ${reason}`,
        link: '#/diesel-price',
      });
    }
    return { rejected: sheets.map((s) => s.id) };
  });
  res.json(result);
}));

// POST /revisions/sheets/return  { sheetIds, reason } — see
// app/js/api/revisionsApi.js. Unlike reject, each sheet is kept (in
// db.returnedSheets) with the approver's comments, so the maintainer sees
// exactly what to change and can reopen it pre-filled instead of starting over.
router.post('/revisions/sheets/return', requireActor, requireRole('Approver'), handle('returning the rate sheets for correction', async (req, res) => {
  const result = await withTransaction(async (db, client) => {
    const sheets = requireSheets(db, req.body?.sheetIds);
    const reason = reasonFrom(req, 'APR-005', 'Enter the corrections needed, so the maintainer knows what to change.', 'Corrections required');
    const returnedBy = { employeeId: req.actor.employeeId, name: req.actor.name };
    const vendorIds = new Set(sheets.map((s) => s.vendorId));
    db.returnedSheets = [
      ...db.returnedSheets.filter((r) => !vendorIds.has(r.vendorId)),
      ...sheets.map((s) => ({
        id: s.id,
        revisionNo: s.revisionNo,
        vendorId: s.vendorId,
        vendorName: s.vendorName,
        reason,
        returnedBy,
        returnedOn: today(),
        submittedBy: s.submittedBy,
        submittedOn: s.submittedOn,
        draft: {
          dieselPrice: s.dieselPrice,
          dieselEffectiveDate: s.dieselEffectiveDate,
          effectiveDate: s.effectiveDate,
          source: s.source,
          notificationId: s.notificationId,
          notificationFileName: s.notificationFileName,
          remarks: s.remarks,
          vendorIds: [s.vendorId],
          overrides: Object.keys(s.overrides || {}).length ? { [s.vendorId]: s.overrides } : {},
        },
      })),
    ];
    removeSheets(db, sheets);
    for (const [revisionNo, group] of byRevision(sheets)) {
      logAudit(db, 'revision_returned', req.actor, { revisionNo, vendorIds: group.map((s) => s.vendorId), reason });
      await createAlert(client, {
        toRole: 'Rate Maintainer',
        actor: req.actor,
        kind: 'revision_returned',
        title: `Revision ${revisionNo} returned for correction: ${group.map((s) => s.vendorName).join(', ')}`,
        body: `Corrections required (${personText(req.actor)}): ${reason}`,
        link: '#/diesel-price',
      });
    }
    return { returned: sheets.map((s) => s.id) };
  });
  res.json(result);
}));

module.exports = router;
