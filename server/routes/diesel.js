const express = require('express');
const { withDb } = require('../store');
const { requireActor } = require('../middleware/auth');
const { handle } = require('../errors');

const router = express.Router();

// GET /diesel-price/current — see app/js/api/dieselApi.js. Every role
// sees it: it's on each home screen.
router.get('/diesel-price/current', requireActor, handle('loading the current diesel price', async (req, res) => {
  const result = await withDb(async (db) => {
    const rev = db.revisions[db.currentRevisionNo];
    const earlier = Object.keys(db.revisions).map(Number).filter((r) => r < db.currentRevisionNo).sort((a, b) => b - a)[0];
    return {
      price: rev.dieselPrice,
      effectiveDate: rev.effectiveDate,
      fuelType: 'Diesel',
      source: 'PSO',
      revisionNo: db.currentRevisionNo,
      approvedBy: rev.approvedBy,
      approvedOn: rev.approvedOn,
      previousPrice: earlier != null ? db.revisions[earlier].dieselPrice : null,
      previousEffectiveDate: earlier != null ? db.revisions[earlier].effectiveDate : null,
    };
  });
  res.json(result);
}));

module.exports = router;
