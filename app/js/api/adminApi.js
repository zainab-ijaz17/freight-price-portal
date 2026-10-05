import { request } from './client.js';

// Adding/deleting vendors, destinations and vehicle types isn't here —
// see changeRequestsApi.js.

/**
 * Full vendor + agreement records for master-data maintenance
 * (Administrator only — same shape as vendorsApi.getVendors()).
 *
 * Real endpoint: GET {API_BASE_URL}/admin/vendors
 */
export async function getVendors() {
  return request('/admin/vendors');
}

/**
 * Updates an agreement's maintainable terms — Section 5: "Pass-through %
 * and rounding rule must be maintainable fields, not hard-coded."
 *
 * Real endpoint: PATCH {API_BASE_URL}/admin/vendors/{vendorId}/agreement
 * Request:  { passThroughPct?: number, roundingRule?: 'Nearest 100' | 'Nearest 50' | 'None',
 *   validityStart?: 'DD.MM.YYYY', validityEnd?: 'DD.MM.YYYY' }
 * Response: the updated vendor record
 */
export async function updateAgreement(vendorId, patch) {
  return request(`/admin/vendors/${vendorId}/agreement`, { method: 'PATCH', body: patch });
}

/**
 * A vendor's live rate sheet, so the Administrator and Rate Approver
 * screens can show which destinations/vehicle types already exist
 * (Administrator or Approver).
 *
 * Real endpoint: GET {API_BASE_URL}/admin/vendors/{vendorId}/rate-sheet
 * Response: { title, annexure, cols: string[], weights: string[], rows: [[dest, ...rates]] }
 */
export async function getRateSheet(vendorId) {
  return request(`/admin/vendors/${vendorId}/rate-sheet`);
}

/**
 * Updates the base rates for a destination that already exists on the
 * sheet (matched by name) — how a maintainer fills in numbers for a
 * destination that's on the sheet but has no rate yet.
 *
 * Real endpoint: PATCH {API_BASE_URL}/admin/vendors/{vendorId}/destinations
 * Request:  { destination: string, baseRates: (number|null)[] }  // aligned to the sheet's existing cols
 * Response: the updated rate sheet
 */
export async function updateDestinationRates(vendorId, payload) {
  return request(`/admin/vendors/${vendorId}/destinations`, { method: 'PATCH', body: payload });
}
