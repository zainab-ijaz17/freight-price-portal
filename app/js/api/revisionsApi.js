import { request } from './client.js';

/**
 * Dry-run: computes the before/after worksheet for a candidate diesel
 * price across the given vendors, without writing anything. SAP is
 * expected to own this calculation since it's the system of record for
 * the rates being compared against, per the fixed formula:
 *   adjustedRate = baseRate * (1 + upliftPct/100)     — unrounded
 *   publishedRate = ROUND(adjustedRate, roundingRule) — rounded once, at
 *   the end, using that vendor's own agreement-level rounding rule.
 *
 * Real endpoint: POST {API_BASE_URL}/revisions/simulate
 * Request:  { dieselPrice: number, effectiveDate: 'DD.MM.YYYY', vendorIds: string[] }
 * Response: {
 *   revisionNo: number, effectiveDate: string, overallUpliftPct: number,
 *   vendors: [{ id, name, upliftPct, upliftBasis, blocked }],
 *   worksheets: { [vendorId]: Worksheet },
 *   totals: { vendorCount, rateLineCount }, blocked: boolean
 * }
 * Worksheet: {
 *   title, annexure, cols: string[], weights: string[],
 *   rows: [{ no, dest, base, inc, sum, rounded, bal }],
 *     // per cell, aligned to `cols` (null where uncomputable):
 *     // base = base rate; sum = unrounded adjusted rate (kept for audit);
 *     // inc = sum - base, for display only; rounded = published rate
 *     // (sum rounded once, by this vendor's rounding rule); bal = check value
 *   blocked: boolean
 * }
 */
export async function simulateRevision(payload) {
  return request('/revisions/simulate', { method: 'POST', body: payload });
}

/**
 * Submits a simulated revision for approval: each vendor's rate sheet
 * becomes its own item in the approver's queue. The server re-validates
 * and re-computes rather than trusting the client's numbers, and refuses
 * (REV-001) a vendor whose sheet is already waiting for approval.
 *
 * Real endpoint: POST {API_BASE_URL}/revisions
 * Request: {
 *   dieselPrice, dieselEffectiveDate, effectiveDate, source, notificationId,
 *   notificationFileName, remarks, vendorIds, overrides,
 *   draftId  // the saved draft this came from, deleted once submitted
 * (the submitter is taken from the session)
 * }
 * `dieselEffectiveDate` is when the fuel price itself took effect;
 * `effectiveDate` is when the revised rates take effect (Section 5's
 * "Rate effective from", which defaults to but can differ from the diesel date).
 * Response: { revisionNo, sheetCount, status: 'pending', submittedBy, submittedOn }
 */
export async function submitForApproval(payload) {
  return request('/revisions', { method: 'POST', body: payload });
}

/**
 * Every rate sheet waiting for approval, without its rates.
 *
 * Real endpoint: GET {API_BASE_URL}/revisions/queue
 * Response: [SheetSummary]
 * SheetSummary: {
 *   id, revisionNo, vendorId, vendorName, annexure, rateLineCount, upliftPct,
 *   effectiveDate, dieselPrice, submittedBy: { employeeId, name },
 *   submittedOn, submittedAt, resubmission: boolean
 * }
 */
export async function getApprovalQueue() {
  return request('/revisions/queue');
}

/**
 * Every rate sheet waiting for approval, in full, for the approver.
 *
 * Real endpoint: GET {API_BASE_URL}/revisions/pending
 * Response: [SheetSummary & {
 *   title, upliftBasis, overallUpliftPct, previousDieselPrice,
 *   dieselEffectiveDate, fuelType, source, notificationId,
 *   notificationFileName, remarks,
 *   previousReturn: null | { revisionNo, reason, returnedBy, returnedOn },
 *   worksheet: Worksheet
 * }]
 */
export async function getPendingSheets() {
  return request('/revisions/pending');
}

/**
 * The signed-in maintainer's saved in-progress revisions (see revisionDraft.js).
 *
 * Real endpoint: GET {API_BASE_URL}/revisions/drafts
 * Response: [{ id, data: object, savedAt: ISO timestamp }], newest first
 */
export async function listSavedDrafts() {
  return request('/revisions/drafts');
}

/**
 * Real endpoint: POST {API_BASE_URL}/revisions/drafts  { data }
 * Response: { id, savedAt }
 */
export async function createSavedDraft(data) {
  return request('/revisions/drafts', { method: 'POST', body: { data } });
}

/**
 * Real endpoint: PUT {API_BASE_URL}/revisions/drafts/{id}  { data }
 * Response: { id, savedAt }
 */
export async function updateSavedDraft(id, data) {
  return request(`/revisions/drafts/${id}`, { method: 'PUT', body: { data } });
}

/** Real endpoint: DELETE {API_BASE_URL}/revisions/drafts/{id} */
export async function deleteSavedDraft(id) {
  return request(`/revisions/drafts/${id}`, { method: 'DELETE' });
}

/**
 * Rate sheets an approver returned for correction, with their comments,
 * until they're resubmitted.
 *
 * Real endpoint: GET {API_BASE_URL}/revisions/returned
 * Response: [{
 *   id, revisionNo, vendorId, vendorName, reason,
 *   returnedBy: { employeeId, name }, returnedOn, submittedBy, submittedOn,
 *   draft: { dieselPrice, dieselEffectiveDate, effectiveDate, source,
 *     notificationId, notificationFileName, remarks, vendorIds, overrides }
 * }]
 */
export async function getReturnedSheets() {
  return request('/revisions/returned');
}

/**
 * Releases the given rate sheets: writes their new rates to this app's
 * own store. The approver re-authenticates against real SAP
 * SuccessFactors (the same check as login) once for the batch; the
 * backend also refuses any sheet the approver submitted themselves.
 *
 * Real endpoint: POST {API_BASE_URL}/revisions/sheets/approve
 * Request:  { sheetIds: string[], password }
 * Response: { released: [{ sheetId, revisionNo, vendorName, effectiveDate, linesWritten }], linesWritten }
 */
export async function approveSheets(sheetIds, password) {
  return request('/revisions/sheets/approve', { method: 'POST', body: { sheetIds, password } });
}

/**
 * Real endpoint: POST {API_BASE_URL}/revisions/sheets/reject
 * Request:  { sheetIds: string[], reason: string }
 * Response: { rejected: string[] }
 */
export async function rejectSheets(sheetIds, reason) {
  return request('/revisions/sheets/reject', { method: 'POST', body: { sheetIds, reason } });
}

/**
 * Real endpoint: POST {API_BASE_URL}/revisions/sheets/return
 * Request:  { sheetIds: string[], reason: string }
 * Response: { returned: string[] }
 */
export async function returnSheets(sheetIds, reason) {
  return request('/revisions/sheets/return', { method: 'POST', body: { sheetIds, reason } });
}
