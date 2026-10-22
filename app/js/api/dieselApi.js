import { request } from './client.js';

/**
 * The diesel price currently in effect (the basis the next revision will
 * be compared against). Any signed-in role.
 *
 * Real endpoint: GET {API_BASE_URL}/diesel-price/current
 * Response: {
 *   price: number, effectiveDate: 'DD.MM.YYYY',
 *   fuelType: string, source: string, revisionNo: number,
 *   approvedBy: string, approvedOn: 'DD.MM.YYYY',
 *   previousPrice: number | null, previousEffectiveDate: string | null
 * }
 */
export async function getCurrentDieselPrice() {
  return request('/diesel-price/current');
}
