-- Freight Rate Portal's own data: vendor master, rate sheets, revision
-- history, and the pending-approval workflow. All idempotent (IF NOT
-- EXISTS) so this can just run on every server start.
--
-- Scoped to diesel-indexed per-trip freight rates, one rate sheet per
-- rate list (see the note on `transporters` further down). Flat
-- per-category rate cards and dedicated-vehicle contracts (found while
-- reviewing the source Excel workbook) are explicitly out of scope and
-- were removed after briefly existing here.

-- validity_start/validity_end: the agreement's own validity period
-- (DD.MM.YYYY, same convention as every other date in this app) —
-- separate from rate revisions, which are about rates changing *within*
-- an agreement. Null end means open-ended / not yet due for renewal.
CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  annexure TEXT,
  pass_through_pct NUMERIC NOT NULL DEFAULT 0,
  rounding_rule TEXT NOT NULL DEFAULT 'Nearest 100',
  stale BOOLEAN NOT NULL DEFAULT false,
  validity_start TEXT,
  validity_end TEXT
);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS validity_start TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS validity_end TEXT;

CREATE TABLE IF NOT EXISTS rate_sheets (
  vendor_id TEXT PRIMARY KEY REFERENCES vendors(id) ON DELETE CASCADE,
  title TEXT,
  annexure TEXT,
  cols JSONB NOT NULL,
  weights JSONB NOT NULL,
  rows JSONB NOT NULL
);

-- Uploaded diesel-price notification files (Section 5: mandatory
-- attachment). Deliberately NOT part of the vendors/rateSheets/etc.
-- wipe-and-reinsert blob store.js loads and saves as one unit — that
-- pattern already lost data once (category_rates/dedicated_vehicle_
-- contracts) because it wasn't taught about tables added later. This
-- table is written directly, once, on upload, and never touched by
-- saveDb, so it can't be silently dropped by an unrelated write.
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  uploaded_by JSONB,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS revisions (
  revision_no INTEGER PRIMARY KEY,
  diesel_price NUMERIC NOT NULL,
  effective_date TEXT NOT NULL,
  factor NUMERIC NOT NULL DEFAULT 1,
  approved_by TEXT,
  approved_on TEXT,
  notification_id INTEGER REFERENCES notifications(id)
);
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS notification_id INTEGER REFERENCES notifications(id);

-- Exact archived rate-sheet rows for a (vendor, revision) once that
-- revision has actually been released — see rateAtRevision in
-- rateEngine.js. `rows` is the published (rounded) rate, same shape as
-- rate_sheets.rows — what every existing lookup already reads.
-- `audit_rows` is the audit trail Section 6 requires alongside it: per
-- line, the base rate it was computed from and the unrounded adjusted
-- rate, as [{dest, base: number[], sum: number[], rounded: number[]}].
-- Null for a revision that predates this (the seed data's revisions
-- 20/21 — those only have the scalar-factor approximation, not a real
-- audit trail).
CREATE TABLE IF NOT EXISTS rate_snapshots (
  vendor_id TEXT NOT NULL,
  revision_no INTEGER NOT NULL,
  rows JSONB NOT NULL,
  audit_rows JSONB,
  PRIMARY KEY (vendor_id, revision_no)
);
ALTER TABLE rate_snapshots ADD COLUMN IF NOT EXISTS audit_rows JSONB;

-- Singleton values: current_revision_no (integer) and pending_revision
-- (the in-flight revision object, or null).
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value JSONB
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  actor JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details JSONB
);

-- In-app notifications ("Revision 23 approved", "returned for correction",
-- "new master data request", …). Addressed either to one employee or to
-- everyone holding a role; read_by tracks who has opened a role-wide one.
-- actor_employee_id is whoever caused it, so they aren't notified of their
-- own action. Like `notifications` above, written directly — never part
-- of saveDb's wipe-and-reinsert.
CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  recipient_employee_id TEXT,
  recipient_role TEXT,
  actor_employee_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_by JSONB NOT NULL DEFAULT '[]'
);

-- Master data changes that need a Rate Approver's sign-off before they
-- take effect: adding a vendor / destination / vehicle type, deleting a
-- vendor / destination. Raised by one Rate Approver; approving one (by another) applies
-- it to vendors/rate_sheets in the same transaction. Written directly,
-- never part of saveDb's wipe-and-reinsert.
CREATE TABLE IF NOT EXISTS change_requests (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  vendor_id TEXT,
  payload JSONB NOT NULL,
  summary TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by JSONB NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by JSONB,
  decided_at TIMESTAMPTZ,
  decision_note TEXT
);

-- Signed-in sessions. Login (routes/auth.js) checks the password against
-- SuccessFactors once and issues a random token; every later request
-- sends that token, and only its SHA-256 hash is stored here. The role
-- picked at login (active_role) is what every route's role check uses.
-- Sessions end after IDLE/MAX limits in server/sessions.js, or on logout.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  name TEXT NOT NULL,
  roles JSONB NOT NULL,
  active_role TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Notification files are kept in the database itself: the app's own disk
-- (Cloud Foundry) is wiped on every restart/restage. stored_name is only
-- set for files uploaded before this change, which still live on disk.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS content BYTEA;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE notifications ALTER COLUMN stored_name DROP NOT NULL;

-- The audit log is append-only: entries can be added, never changed or
-- removed — not even by the portal itself (store.js only ever INSERTs).
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_log_no_change ON audit_log;
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

-- Each maintainer's in-progress revision ("Save Draft", and saved
-- automatically at each step), restored when they next sign in. Deleted
-- when they submit it or discard it. Written directly by
-- routes/drafts.js, never part of store.js's load/save.
CREATE TABLE IF NOT EXISTS revision_drafts (
  employee_id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Several saved drafts per maintainer, not just one: each gets its own id.
-- The old one-per-person key (employee_id) is dropped; existing drafts are
-- kept and simply numbered.
ALTER TABLE revision_drafts ADD COLUMN IF NOT EXISTS id SERIAL;
ALTER TABLE revision_drafts DROP CONSTRAINT IF EXISTS revision_drafts_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS revision_drafts_id ON revision_drafts (id);
CREATE INDEX IF NOT EXISTS revision_drafts_employee ON revision_drafts (employee_id);

-- Each vendor's sheet is approved on its own now, so two vendors in the
-- same revision can be released by different people on different days:
-- who released this vendor's sheet, kept with its snapshot. Null for
-- snapshots taken before this change (revisions.approved_by applies).
ALTER TABLE rate_snapshots ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE rate_snapshots ADD COLUMN IF NOT EXISTS approved_on TEXT;

-- Name and email as SuccessFactors had them at each person's last sign-in
-- (see routes/auth.js) — where approval emails are sent when roles.js
-- doesn't give an address.
CREATE TABLE IF NOT EXISTS employees (
  employee_id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every approval email the portal sent (or tried to). Also how the
-- reminder job knows when it last sent a reminder.
CREATE TABLE IF NOT EXISTS email_log (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  recipients JSONB NOT NULL,
  subject TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error TEXT
);

-- Rate sheets are issued list-wise, not per vendor: one rate list (e.g.
-- "PLG - AAG", 20 ft & 40 ft for BU-FP & FC) applies to several
-- transporters, and one transporter can be on several lists. A `vendors`
-- row (and its vendor_id everywhere else) is now one rate list; the
-- transporters it applies to are listed on it, and each list's rate
-- sheet ends with its own conditions. See server/rateLists.js.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS transporters JSONB NOT NULL DEFAULT '[]';
ALTER TABLE rate_sheets ADD COLUMN IF NOT EXISTS conditions JSONB NOT NULL DEFAULT '[]';

-- A list's conditions and transporters can be edited (Rate lists &
-- agreements), so each revision keeps the ones that applied to it. Null
-- for a snapshot taken before this: the list's current ones apply.
ALTER TABLE rate_snapshots ADD COLUMN IF NOT EXISTS conditions JSONB;
ALTER TABLE rate_snapshots ADD COLUMN IF NOT EXISTS transporters JSONB;
