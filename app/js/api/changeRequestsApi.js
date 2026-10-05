import { request } from './client.js';

/**
 * Master data changes. Most need a Rate Approver's sign-off: an
 * Administrator raises one, a different person with the Approver role
 * approves or rejects it, and only an approved one changes the rate sheet.
 * add_destination / add_vehicle_type are raised by a Rate Approver instead
 * and applied at once (status 'applied').
 *
 * kind / payload:
 *   add_vendor         { name, annexure, passThroughPct, roundingRule, validityStart?, validityEnd?,
 *                        firstDestination, firstVehicleType, firstWeight, firstBaseRate }
 *   add_destination    { vendorId, destination, baseRates: (number|'')[] }   // one per vehicle type, Approver only, applied at once
 *   add_vehicle_type   { vendorId, vehicleType, weight, baseRates: (number|'')[] }  // one per destination, Approver only, applied at once
 *   delete_vendor      { vendorId }                 // reason required
 *   delete_destination { vendorId, destination }    // reason required
 *
 * Request shape returned by every call:
 *   { id, kind, vendorId, payload, summary, reason, status: 'pending'|'approved'|'rejected'|'applied',
 *     requestedBy: { employeeId, name }, requestedAt, decidedBy, decidedAt, decisionNote }
 */

/** Real endpoint: GET {API_BASE_URL}/master-data/requests[?status=pending] */
export async function listRequests(status) {
  return request('/master-data/requests' + (status ? `?status=${status}` : ''));
}

/** Real endpoint: POST {API_BASE_URL}/master-data/requests  { kind, payload, reason } */
export async function raiseRequest(kind, payload, reason) {
  return request('/master-data/requests', { method: 'POST', body: { kind, payload, reason } });
}

/** Real endpoint: POST {API_BASE_URL}/master-data/requests/{id}/approve */
export async function approveRequest(id) {
  return request(`/master-data/requests/${id}/approve`, { method: 'POST', body: {} });
}

/** Real endpoint: POST {API_BASE_URL}/master-data/requests/{id}/reject  { reason } */
export async function rejectRequest(id, reason) {
  return request(`/master-data/requests/${id}/reject`, { method: 'POST', body: { reason } });
}
