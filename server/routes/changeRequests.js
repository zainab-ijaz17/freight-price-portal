// Master data change requests: an Administrator proposes adding a vendor
// or deleting a vendor or destination; a Rate Approver (never the same
// person) approves or rejects it, and nothing changes until it's approved.
// New destinations and vehicle types (`direct` kinds) are added by a Rate
// Approver, applied at once and recorded here with status 'applied'. See app/js/api/changeRequestsApi.js.
const express = require('express');
const { pool } = require('../db');
const { withDb, withTransaction } = require('../store');
const { requireActor, requireRole } = require('../middleware/auth');
const { kindSpec } = require('../masterData');
const { fail, handle } = require('../errors');
const { createAlert } = require('../alerts');

const router = express.Router();

function toApi(r) {
  return {
    id: r.id,
    kind: r.kind,
    vendorId: r.vendor_id,
    payload: r.payload,
    summary: r.summary,
    reason: r.reason,
    status: r.status,
    requestedBy: r.requested_by,
    requestedAt: r.requested_at.toISOString(),
    decidedBy: r.decided_by,
    decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
    decisionNote: r.decision_note,
  };
}

// Pending revisions line their worksheet up with the rate sheet by
// row/column position — changing that sheet's shape now would release
// rates against the wrong lines.
function assertSheetNotInPendingRevision(db, vendorId) {
  if (vendorId && db.pendingRevision?.vendorIds.includes(vendorId)) {
    throw fail('CR-003', `This vendor is part of revision ${db.pendingRevision.revisionNo}, which is waiting for approval. Release, reject or return that revision first, then make this change.`, { status: 409 });
  }
}

// A returned revision's typed-in rates are also keyed by position; drop
// them for this vendor rather than let them land on the wrong line when
// it's reopened (the maintainer re-types them at review).
function dropReturnedOverrides(db, kind, vendorId) {
  const returned = db.returnedRevision?.draft;
  if (returned && vendorId) {
    delete returned.overrides?.[vendorId];
    if (kind === 'delete_vendor') returned.vendorIds = returned.vendorIds.filter((v) => v !== vendorId);
  }
}

// GET /master-data/requests?status=pending
router.get('/master-data/requests', requireActor, requireRole('Administrator', 'Approver'), handle('loading master data requests', async (req, res) => {
  const { status } = req.query;
  const result = status
    ? await pool.query('SELECT * FROM change_requests WHERE status = $1 ORDER BY requested_at DESC LIMIT 200', [status])
    : await pool.query('SELECT * FROM change_requests ORDER BY requested_at DESC LIMIT 200');
  res.json(result.rows.map(toApi));
}));

// POST /master-data/requests  { kind, payload, reason }
router.post('/master-data/requests', requireActor, requireRole('Administrator', 'Approver'), handle('raising the master data request', async (req, res) => {
  const { kind, payload = {}, reason } = req.body || {};
  const spec = kindSpec(kind);
  const raisedBy = spec.direct ? 'Approver' : 'Administrator';
  if (req.actor.role !== raisedBy) {
    throw fail('AUTH-005', `This action needs the ${raisedBy} role. You are signed in as ${req.actor.role}.`, { status: 403 });
  }
  if (spec.needsReason && !reason?.trim()) {
    throw fail('CR-004', 'Enter a reason for the deletion — the approver needs it to decide.', { field: 'Reason' });
  }
  if (spec.direct) {
    const applied = await withTransaction(async (db, client) => {
      assertSheetNotInPendingRevision(db, payload.vendorId);
      spec.validate(db, payload);
      const summary = spec.summary(db, payload);
      spec.apply(db, payload);
      dropReturnedOverrides(db, kind, payload.vendorId);
      db.auditLog.unshift({ action: 'master_data_added', actor: req.actor, at: new Date().toISOString(), details: { kind, payload } });
      const { rows } = await client.query(
        "INSERT INTO change_requests (kind, vendor_id, payload, summary, status, requested_by, decided_by, decided_at) VALUES ($1,$2,$3,$4,'applied',$5,$5,now()) RETURNING *",
        [kind, payload.vendorId ?? null, JSON.stringify(payload), summary, JSON.stringify(req.actor)]
      );
      return rows[0];
    });
    return res.json(toApi(applied));
  }
  const created = await withDb(async (db, client) => {
    spec.validate(db, payload);
    const summary = spec.summary(db, payload);
    const dup = await client.query("SELECT id FROM change_requests WHERE status = 'pending' AND summary = $1", [summary]);
    if (dup.rows.length) {
      throw fail('CR-005', `The same request (#${dup.rows[0].id}) is already waiting for approval.`, { status: 409 });
    }
    const { rows } = await client.query(
      'INSERT INTO change_requests (kind, vendor_id, payload, summary, reason, requested_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [kind, payload.vendorId ?? null, JSON.stringify(payload), summary, reason?.trim() || null, JSON.stringify(req.actor)]
    );
    await createAlert(client, {
      toRole: 'Approver',
      actor: req.actor,
      kind: 'change_request_raised',
      title: `Master data request #${rows[0].id}: ${summary}`,
      body: `Raised by ${req.actor.name}${reason?.trim() ? ` · Reason: ${reason.trim()}` : ''}`,
      link: '#/master-data-requests',
    });
    return rows[0];
  });
  res.json(toApi(created));
}));

async function loadPendingRequest(client, id) {
  const { rows } = await client.query('SELECT * FROM change_requests WHERE id = $1 FOR UPDATE', [id]);
  const r = rows[0];
  if (!r) throw fail('CR-001', `Request #${id} was not found.`, { status: 404 });
  if (r.status !== 'pending') throw fail('CR-001', `Request #${id} has already been ${r.status}. Reload the page.`, { status: 409 });
  return r;
}

// POST /master-data/requests/:id/approve
router.post('/master-data/requests/:id/approve', requireActor, requireRole('Approver'), handle('approving the master data request', async (req, res) => {
  const id = Number(req.params.id);
  const result = await withTransaction(async (db, client) => {
    const r = await loadPendingRequest(client, id);
    if (r.requested_by.employeeId === req.actor.employeeId) {
      throw fail('CR-002', 'You raised this request, so another approver must decide it.', { status: 403 });
    }
    assertSheetNotInPendingRevision(db, r.vendor_id);
    const spec = kindSpec(r.kind);
    spec.validate(db, r.payload);
    spec.apply(db, r.payload);

    dropReturnedOverrides(db, r.kind, r.vendor_id);

    db.auditLog.unshift({ action: 'change_request_approved', actor: req.actor, at: new Date().toISOString(), details: { requestId: id, kind: r.kind, payload: r.payload, reason: r.reason } });
    const { rows } = await client.query(
      "UPDATE change_requests SET status = 'approved', decided_by = $2, decided_at = now() WHERE id = $1 RETURNING *",
      [id, JSON.stringify(req.actor)]
    );
    await createAlert(client, {
      toEmployeeId: r.requested_by.employeeId,
      actor: req.actor,
      kind: 'change_request_approved',
      title: `Approved: ${r.summary}`,
      body: `Request #${id} approved by ${req.actor.name}. The change is now live.`,
      link: '#/admin',
    });
    return rows[0];
  });
  res.json(toApi(result));
}));

// POST /master-data/requests/:id/reject  { reason }
router.post('/master-data/requests/:id/reject', requireActor, requireRole('Approver'), handle('rejecting the master data request', async (req, res) => {
  const id = Number(req.params.id);
  const reason = req.body?.reason?.trim();
  if (!reason) throw fail('CR-004', 'Enter a reason for rejecting this request.', { field: 'Reason' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await loadPendingRequest(client, id);
    if (r.requested_by.employeeId === req.actor.employeeId) {
      throw fail('CR-002', 'You raised this request, so another approver must decide it.', { status: 403 });
    }
    const { rows } = await client.query(
      "UPDATE change_requests SET status = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3 WHERE id = $1 RETURNING *",
      [id, JSON.stringify(req.actor), reason]
    );
    await createAlert(client, {
      toEmployeeId: r.requested_by.employeeId,
      actor: req.actor,
      kind: 'change_request_rejected',
      title: `Rejected: ${r.summary}`,
      body: `Request #${id} rejected by ${req.actor.name}. Reason: ${reason}`,
      link: '#/admin',
    });
    await client.query('COMMIT');
    res.json(toApi(rows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
