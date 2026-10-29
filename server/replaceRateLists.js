// Run at startup: a database still holding an earlier issue of the rate
// lists — or the per-vendor rate sheets from before sheets were issued
// list-wise — has them replaced by the lists in server/rateLists.js, once.
// Everything that only made sense against the old sheets goes with them,
// and the audit log records exactly what was removed.
const { withTransaction } = require('./store');
const { RATE_LISTS_ISSUE, ISSUE_DIESEL_PRICE, rateListRecords } = require('./seedData');

const SYSTEM = { employeeId: 'system', name: 'Freight Rate Portal' };

async function replaceRateLists() {
  const done = await withTransaction(async (db, client) => {
    if (db.rateListsIssue === RATE_LISTS_ISSUE) return null;

    const { vendors, rateSheets } = rateListRecords();
    const newIds = new Set(vendors.map((v) => v.id));
    const removed = db.vendors.filter((v) => !newIds.has(v.id));

    // Sheets waiting for approval (or returned) were worked out from the
    // old rates, line by line; releasing one now would overwrite the new
    // lists with them.
    const discardedSheets = [...db.pendingSheets, ...db.returnedSheets].map((s) => `${s.vendorName} (revision ${s.revisionNo})`);
    db.pendingSheets = [];
    db.returnedSheets = [];

    // Revisions whose rates were only ever a scaled-down copy of the
    // current sheet (factor ≠ 1, no snapshot) would invent rates for the
    // new lists that were never issued.
    const removedRevisions = Object.keys(db.revisions).map(Number)
      .filter((r) => db.revisions[r].factor !== 1 && r !== db.currentRevisionNo);
    removedRevisions.forEach((r) => { delete db.revisions[r]; });

    db.vendors = vendors;
    db.rateSheets = rateSheets;
    db.rateListsIssue = RATE_LISTS_ISSUE;
    // Past snapshots of removed vendors are kept: those revisions stay auditable.

    const { rows: closed } = await client.query(
      `UPDATE change_requests SET status = 'rejected', decided_at = now(), decided_by = $2,
         decision_note = 'Closed automatically: the rate lists were replaced by the issue of ' || $3 || '.'
       WHERE status = 'pending' AND vendor_id = ANY($1) RETURNING id`,
      [removed.map((v) => v.id), JSON.stringify(SYSTEM), RATE_LISTS_ISSUE]
    );

    db.auditLog.unshift({
      action: 'rate_lists_replaced',
      actor: SYSTEM,
      at: new Date().toISOString(),
      details: {
        issue: RATE_LISTS_ISSUE,
        lists: vendors.map((v) => v.name),
        removed: removed.map((v) => ({ id: v.id, name: v.name })),
        discardedSheets,
        removedRevisions,
        closedRequests: closed.map((r) => r.id),
      },
    });

    return { loaded: vendors.length, removed: removed.length, currentRevisionNo: db.currentRevisionNo, current: db.revisions[db.currentRevisionNo] };
  });
  if (!done) return;

  console.log(`Rate lists replaced by the issue of ${RATE_LISTS_ISSUE}: ${done.loaded} lists loaded, ${done.removed} old rate sheets removed.`);
  if (done.current && done.current.dieselPrice !== ISSUE_DIESEL_PRICE) {
    console.warn(`The current revision (${done.currentRevisionNo}) is at PKR ${done.current.dieselPrice}, but the rate lists were issued at PKR ${ISSUE_DIESEL_PRICE}. The next revision's change is worked out from ${done.current.dieselPrice}.`);
  }
}

module.exports = { replaceRateLists };
