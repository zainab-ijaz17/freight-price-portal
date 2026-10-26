// Postgres-backed persistence for the portal's own data (vendors, rate
// sheets, revisions, workflow state, audit log). Routes work against the
// same plain-object shape the app has always used — { vendors, rateSheets,
// revisions, currentRevisionNo, pendingSheets, returnedSheets,
// rateSnapshots, auditLog }
// — loadDb/saveDb just translate that to/from real tables, so
// rateEngine.js's calculation logic didn't need to change at all.
//
// saveDb writes only what changed since loadDb (row by row), and only
// ever *adds* audit log entries — the audit_log table itself refuses
// updates and deletes (see schema.sql).
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function ensureSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
}

async function seedIfEmpty(seed) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM vendors');
  if (rows[0].count > 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await saveDb(client, seed, emptyBaseline());
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Read-only access: hands the caller the current state, no locking.
async function withDb(fn) {
  const client = await pool.connect();
  try {
    const db = await loadDb(client);
    return await fn(db, client);
  } finally {
    client.release();
  }
}

// Read-modify-write access for anything that mutates state. Wrapped in a
// real transaction with an advisory lock held for its duration — since
// nearly every mutation touches app_state (current_revision_no /
// pending_revision) anyway, this serializes all writes against each
// other, closing the race window the old JSON-file store had between
// reading and writing. `fn` mutates the `db` object in place (or returns
// a response value); the resulting state is always what gets saved.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(727271)');
    const db = await loadDb(client);
    const baseline = rowsOf(db);
    if (db.convertedLegacyState) {
      // Make sure the converted lists, and the cleared old keys, are written.
      ['pending_sheets', 'returned_sheets', 'pending_revision', 'returned_revision']
        .forEach((key) => baseline.app_state.delete(JSON.stringify([key])));
    }
    const result = await fn(db, client);
    await saveDb(client, db, baseline);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function loadDb(client) {
  // Sequential, not Promise.all: a single pg client can only have one
  // query in flight at a time — running these concurrently on the same
  // client only appeared to work by accident (silently serialized, with a
  // deprecation warning that becomes a hard error in a future pg version).
  // L1, L2, … L10 in the order the lists were issued (not L1, L10, L2);
  // lists added later have longer ids, so they come after.
  const vendorsRes = await client.query('SELECT * FROM vendors ORDER BY length(id), id');
  const sheetsRes = await client.query('SELECT * FROM rate_sheets');
  const revisionsRes = await client.query('SELECT * FROM revisions');
  const snapshotsRes = await client.query('SELECT * FROM rate_snapshots');
  const stateRes = await client.query('SELECT * FROM app_state');
  const auditRes = await client.query('SELECT * FROM audit_log ORDER BY at DESC, id DESC');

  const vendors = vendorsRes.rows.map((v) => ({
    id: v.id,
    name: v.name,
    annexure: v.annexure,
    passThroughPct: Number(v.pass_through_pct),
    roundingRule: v.rounding_rule,
    stale: v.stale,
    validityStart: v.validity_start,
    validityEnd: v.validity_end,
    transporters: v.transporters,
  }));

  const rateSheets = {};
  sheetsRes.rows.forEach((s) => {
    rateSheets[s.vendor_id] = { title: s.title, annexure: s.annexure, cols: s.cols, weights: s.weights, rows: s.rows, conditions: s.conditions };
  });

  const revisions = {};
  revisionsRes.rows.forEach((r) => {
    revisions[r.revision_no] = {
      dieselPrice: Number(r.diesel_price),
      effectiveDate: r.effective_date,
      factor: Number(r.factor),
      approvedBy: r.approved_by,
      approvedOn: r.approved_on,
      notificationId: r.notification_id,
    };
  });

  const rateSnapshots = {};
  snapshotsRes.rows.forEach((s) => {
    rateSnapshots[s.vendor_id] = rateSnapshots[s.vendor_id] || {};
    rateSnapshots[s.vendor_id][s.revision_no] = {
      rows: s.rows, auditRows: s.audit_rows, approvedBy: s.approved_by, approvedOn: s.approved_on,
      conditions: s.conditions, transporters: s.transporters,
    };
  });

  const state = {};
  stateRes.rows.forEach((r) => { state[r.key] = r.value; });
  const vendorName = (id) => vendors.find((v) => v.id === id)?.name || id;

  const auditLog = auditRes.rows.map((a) => ({
    id: a.id, // already stored — only entries without an id are new
    action: a.action,
    actor: a.actor,
    at: a.at.toISOString(),
    details: a.details,
  }));

  return {
    vendors,
    rateSheets,
    revisions,
    currentRevisionNo: state.current_revision_no ?? null,
    // Which issue of server/rateLists.js the lists were loaded from.
    rateListsIssue: state.rate_lists_issue ?? null,
    // One entry per vendor rate sheet waiting for approval — each is
    // approved, rejected or returned on its own (see routes/revisions.js).
    pendingSheets: state.pending_sheets ?? sheetsFromLegacyPending(state.pending_revision, vendorName),
    // Sheets an approver sent back for correction, with their comments —
    // shown to maintainers until they're resubmitted.
    returnedSheets: state.returned_sheets ?? sheetsFromLegacyReturned(state.returned_revision, vendorName),
    rateSnapshots,
    auditLog,
    convertedLegacyState: state.pending_revision != null || state.returned_revision != null,
  };
}

// Before sheets were approved one vendor at a time, a whole revision was
// pending (or returned) as one object. Anything still waiting in that
// form is split per vendor the first time it's loaded, and saved that way.
function sheetsFromLegacyPending(p, vendorName) {
  if (!p) return [];
  return p.vendorIds.map((vendorId) => {
    const sim = p.vendors.find((v) => v.id === vendorId) || {};
    return {
      id: `${p.revisionNo}-${vendorId}`,
      revisionNo: p.revisionNo,
      vendorId,
      vendorName: vendorName(vendorId),
      upliftPct: sim.upliftPct ?? 0,
      upliftBasis: sim.upliftBasis || '',
      overallUpliftPct: p.overallUpliftPct,
      worksheet: p.worksheets[vendorId],
      overrides: p.overrides?.[vendorId] || {},
      dieselPrice: p.dieselPrice,
      dieselEffectiveDate: p.dieselEffectiveDate,
      effectiveDate: p.effectiveDate,
      source: p.source,
      notificationId: p.notificationId,
      notificationFileName: p.notificationFileName,
      remarks: p.remarks || '',
      submittedBy: p.submittedBy,
      submittedOn: p.submittedOn,
      submittedAt: null,
      previousReturn: p.previousReturn || null,
    };
  });
}

function sheetsFromLegacyReturned(r, vendorName) {
  if (!r) return [];
  return r.draft.vendorIds.map((vendorId) => ({
    id: `${r.revisionNo}-${vendorId}`,
    revisionNo: r.revisionNo,
    vendorId,
    vendorName: vendorName(vendorId),
    reason: r.reason,
    returnedBy: r.returnedBy,
    returnedOn: r.returnedOn,
    submittedBy: r.submittedBy,
    submittedOn: r.submittedOn,
    draft: { ...r.draft, vendorIds: [vendorId], overrides: r.draft.overrides?.[vendorId] ? { [vendorId]: r.draft.overrides[vendorId] } : {} },
  }));
}

// Each table as { key → row values }, in the column order of TABLES
// below. Taken right after loadDb and again before saving; comparing the
// two tells saveDb exactly which rows were added, changed or removed.
const TABLES = {
  vendors: { key: ['id'], cols: ['id', 'name', 'annexure', 'pass_through_pct', 'rounding_rule', 'stale', 'validity_start', 'validity_end', 'transporters'] },
  rate_sheets: { key: ['vendor_id'], cols: ['vendor_id', 'title', 'annexure', 'cols', 'weights', 'rows', 'conditions'] },
  revisions: { key: ['revision_no'], cols: ['revision_no', 'diesel_price', 'effective_date', 'factor', 'approved_by', 'approved_on', 'notification_id'] },
  rate_snapshots: { key: ['vendor_id', 'revision_no'], cols: ['vendor_id', 'revision_no', 'rows', 'audit_rows', 'approved_by', 'approved_on', 'conditions', 'transporters'] },
  app_state: { key: ['key'], cols: ['key', 'value'] },
};
// Parents before children when inserting (a rate sheet needs its vendor),
// children before parents when deleting.
const UPSERT_ORDER = ['vendors', 'rate_sheets', 'revisions', 'rate_snapshots', 'app_state'];
const DELETE_ORDER = [...UPSERT_ORDER].reverse();

function rowsOf(db) {
  const tables = Object.fromEntries(UPSERT_ORDER.map((t) => [t, new Map()]));
  const put = (table, values) => {
    const keyLen = TABLES[table].key.length;
    tables[table].set(JSON.stringify(values.slice(0, keyLen)), JSON.stringify(values));
  };
  for (const v of db.vendors) {
    put('vendors', [v.id, v.name, v.annexure, v.passThroughPct, v.roundingRule, v.stale, v.validityStart ?? null, v.validityEnd ?? null, v.transporters ?? []]);
  }
  for (const [vendorId, sheet] of Object.entries(db.rateSheets)) {
    put('rate_sheets', [vendorId, sheet.title, sheet.annexure, sheet.cols, sheet.weights, sheet.rows, sheet.conditions ?? []]);
  }
  for (const [revNo, rev] of Object.entries(db.revisions)) {
    put('revisions', [Number(revNo), rev.dieselPrice, rev.effectiveDate, rev.factor, rev.approvedBy, rev.approvedOn, rev.notificationId ?? null]);
  }
  for (const [vendorId, byRev] of Object.entries(db.rateSnapshots)) {
    for (const [revNo, snap] of Object.entries(byRev)) {
      put('rate_snapshots', [vendorId, Number(revNo), snap.rows, snap.auditRows ?? null, snap.approvedBy ?? null, snap.approvedOn ?? null, snap.conditions ?? null, snap.transporters ?? null]);
    }
  }
  put('app_state', ['current_revision_no', db.currentRevisionNo]);
  put('app_state', ['rate_lists_issue', db.rateListsIssue ?? null]);
  put('app_state', ['pending_sheets', db.pendingSheets]);
  put('app_state', ['returned_sheets', db.returnedSheets]);
  // Superseded by the two lists above; cleared once converted (loadDb).
  put('app_state', ['pending_revision', null]);
  put('app_state', ['returned_revision', null]);
  return tables;
}

function emptyBaseline() {
  return Object.fromEntries(UPSERT_ORDER.map((t) => [t, new Map()]));
}

// Plain values go in as-is; arrays/objects are JSONB columns.
function toParam(v) {
  return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
}

// app_state.value is JSONB whatever it holds, so a plain string (e.g.
// rate_lists_issue) has to go in JSON-encoded too, not as raw text.
function paramsFor(table, row) {
  return table === 'app_state' ? [row[0], JSON.stringify(row[1])] : row.map(toParam);
}

async function saveDb(client, db, baseline) {
  const current = rowsOf(db);

  for (const table of UPSERT_ORDER) {
    const { key, cols } = TABLES[table];
    const updates = cols.filter((c) => !key.includes(c)).map((c) => `${c} = EXCLUDED.${c}`).join(', ');
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
      ON CONFLICT (${key.join(', ')}) DO UPDATE SET ${updates}`;
    for (const [k, row] of current[table]) {
      if (baseline[table].get(k) === row) continue; // unchanged
      await client.query(sql, paramsFor(table, JSON.parse(row)));
    }
  }

  for (const table of DELETE_ORDER) {
    const { key } = TABLES[table];
    const sql = `DELETE FROM ${table} WHERE ${key.map((c, i) => `${c} = $${i + 1}`).join(' AND ')}`;
    for (const k of baseline[table].keys()) {
      if (!current[table].has(k)) await client.query(sql, JSON.parse(k));
    }
  }

  // Routes add entries with unshift (newest first); insert oldest first.
  const newEntries = db.auditLog.filter((e) => e.id == null).reverse();
  for (const entry of newEntries) {
    await client.query(
      'INSERT INTO audit_log (action, actor, at, details) VALUES ($1,$2,$3,$4)',
      [entry.action, JSON.stringify(entry.actor), entry.at, JSON.stringify(entry.details)]
    );
  }
}

// Run once at startup: a transaction that changes nothing still writes out
// any state loadDb had to convert from an older format.
async function migrateState() {
  await withTransaction(async () => {});
}

module.exports = { ensureSchema, seedIfEmpty, migrateState, withDb, withTransaction };
