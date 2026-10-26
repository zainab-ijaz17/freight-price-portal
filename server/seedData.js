// Initial contents of the database, written the first time the server
// runs: the rate lists issued w.e.f. 30.07.2026 (server/rateLists.js) as
// revision 22. From here on this is real, editable data (via the Admin
// screen), not a demo fixture that resets on reload.
const RATE_LISTS = require('./rateLists');

// Bump when server/rateLists.js is replaced by a new issue: a database
// loaded from an earlier one then gets the new lists at the next start
// (see server/replaceRateLists.js).
const RATE_LISTS_ISSUE = '30.07.2026';
const ISSUE_DIESEL_PRICE = 390.62;

// Every list passes on 40% of a diesel price change and rounds to the
// nearest Rs. 50 ("rounded off to +/- Rs. 50/-" in each list's conditions).
function rateListRecords() {
  const vendors = RATE_LISTS.map((l) => ({
    id: l.id,
    name: l.name,
    annexure: l.annexure,
    passThroughPct: 40,
    roundingRule: 'Nearest 50',
    stale: false,
    validityStart: null,
    validityEnd: null,
    transporters: [...l.transporters],
  }));
  const rateSheets = Object.fromEntries(RATE_LISTS.map((l) => [l.id, {
    title: l.title,
    annexure: l.annexure,
    cols: [...l.cols],
    weights: [...l.weights],
    rows: l.rows.map((r) => [...r]),
    conditions: [...l.conditions],
  }]));
  return { vendors, rateSheets };
}

// The diesel price and date the lists were issued at. The lists carry no
// rates for anything earlier, so this is the first revision on file.
const REVISIONS = {
  22: { dieselPrice: ISSUE_DIESEL_PRICE, effectiveDate: RATE_LISTS_ISSUE, factor: 1, approvedBy: 'M. Ayub Khan', approvedOn: '30.07.2026' },
};

module.exports = {
  RATE_LISTS_ISSUE,
  ISSUE_DIESEL_PRICE,
  rateListRecords,
  seed: {
    ...rateListRecords(),
    revisions: REVISIONS,
    currentRevisionNo: 22,
    rateListsIssue: RATE_LISTS_ISSUE,
    pendingSheets: [],
    returnedSheets: [],
    rateSnapshots: {},
    auditLog: [],
  },
};
