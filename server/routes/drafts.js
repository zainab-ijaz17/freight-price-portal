// The signed-in maintainer's saved in-progress revisions (see the
// revision_drafts table in schema.sql and app/js/revisionDraft.js). A
// maintainer can keep several; each is only ever visible to its owner.
// POST /revisions removes the one that was submitted.
const express = require('express');
const { pool } = require('../db');
const { requireActor, requireRole } = require('../middleware/auth');
const { fail, handle } = require('../errors');

const router = express.Router();
const maintainer = [requireActor, requireRole('Rate Maintainer')];

function validData(req) {
  const data = req.body?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw fail('DSL-005', 'The draft could not be saved because it was empty or malformed. Re-enter the details and save again.');
  }
  return data;
}

const NOT_FOUND = () => fail('DSL-006', 'That draft no longer exists. It may have been submitted or discarded.', { status: 404 });

function draftId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw NOT_FOUND();
  return id;
}

// GET /revisions/drafts → [{ id, data, savedAt }], newest first
router.get('/revisions/drafts', ...maintainer, handle('loading your drafts', async (req, res) => {
  const { rows } = await pool.query('SELECT id, data, updated_at FROM revision_drafts WHERE employee_id = $1 ORDER BY updated_at DESC', [req.actor.employeeId]);
  res.json(rows.map((r) => ({ id: r.id, data: r.data, savedAt: r.updated_at.toISOString() })));
}));

// POST /revisions/drafts  { data } → { id, savedAt }
router.post('/revisions/drafts', ...maintainer, handle('saving your draft', async (req, res) => {
  const data = validData(req);
  const { rows } = await pool.query(
    'INSERT INTO revision_drafts (employee_id, data, updated_at) VALUES ($1, $2, now()) RETURNING id, updated_at',
    [req.actor.employeeId, JSON.stringify(data)]
  );
  res.json({ id: rows[0].id, savedAt: rows[0].updated_at.toISOString() });
}));

// PUT /revisions/drafts/:id  { data } → { id, savedAt }
router.put('/revisions/drafts/:id', ...maintainer, handle('saving your draft', async (req, res) => {
  const data = validData(req);
  const { rows } = await pool.query(
    'UPDATE revision_drafts SET data = $3, updated_at = now() WHERE id = $1 AND employee_id = $2 RETURNING id, updated_at',
    [draftId(req), req.actor.employeeId, JSON.stringify(data)]
  );
  if (!rows[0]) throw NOT_FOUND();
  res.json({ id: rows[0].id, savedAt: rows[0].updated_at.toISOString() });
}));

// DELETE /revisions/drafts/:id
router.delete('/revisions/drafts/:id', ...maintainer, handle('discarding your draft', async (req, res) => {
  await pool.query('DELETE FROM revision_drafts WHERE id = $1 AND employee_id = $2', [draftId(req), req.actor.employeeId]);
  res.json({ ok: true });
}));

module.exports = router;
