const express = require('express');
const { withDb } = require('../store');
const { rateLineCount } = require('../rateEngine');
const { requireActor } = require('../middleware/auth');
const { handle } = require('../errors');

const router = express.Router();

// GET /vendors and GET /vendors?fields=id,name — see app/js/api/vendorsApi.js
router.get('/vendors', requireActor, handle('loading vendors', async (req, res) => {
  const result = await withDb(async (db) => {
    if (req.query.fields === 'id,name') {
      return db.vendors.map((v) => ({ id: v.id, name: v.name }));
    }
    const rev = db.revisions[db.currentRevisionNo];
    return db.vendors.map((v) => ({
      ...v,
      rateLineCount: rateLineCount(db, v.id),
      lastRevisedDate: rev.effectiveDate,
      // Set while this vendor's rate sheet is waiting for approval — it
      // can't go into another revision until that's decided.
      pendingRevisionNo: db.pendingSheets.find((s) => s.vendorId === v.id)?.revisionNo ?? null,
    }));
  });
  res.json(result);
}));

module.exports = router;
