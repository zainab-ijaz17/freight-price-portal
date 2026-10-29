const { SF } = require('./config');

// Real identity check for employee self-service login. SuccessFactors has
// no dedicated "verify password" endpoint, so we do what every SF
// integration does: send the credentials as Basic Auth on a cheap OData
// read and let the 200/401 response tell us whether they were valid.
const LOGIN_CHECK_PATH = '/odata/v2/Background_Community?$top=20';
const REQUEST_TIMEOUT_MS = 10_000;

async function verifyEmployeeCredentials(employeeId, password) {
  const username = `${employeeId}${SF.usernameSuffix}`;
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${SF.baseUrl}${LOGIN_CHECK_PATH}`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch {
    throw new Error('Unable to reach the SAP SuccessFactors login service. The system may be unavailable or the request timed out.');
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 200) return true;
  if (res.status === 401 || res.status === 403) {
    const body = await res.text().catch(() => '');
    console.warn(`SF login rejected for ${username}: ${res.status} ${body.slice(0, 300)}`);
    return false;
  }

  throw new Error(`SAP SuccessFactors login service responded with status ${res.status}.`);
}

// The signed-in employee's name and email as SuccessFactors holds them,
// read with their own credentials right after a successful login check.
// Best-effort: null if SF won't return it (permissions, timeout, no match)
// — the caller falls back to the roster in roles.js.
async function fetchEmployeeProfile(employeeId, password) {
  const username = `${employeeId}${SF.usernameSuffix}`;
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  const id = String(employeeId).replace(/'/g, "''");
  const filter = encodeURIComponent(`username eq '${id}' or userId eq '${id}'`);
  const query = `/odata/v2/User?$filter=${filter}&$select=userId,username,displayName,firstName,lastName,email&$top=1&$format=json`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${SF.baseUrl}${query}`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`SF profile lookup for ${employeeId} returned ${res.status}`);
      return null;
    }
    const user = (await res.json())?.d?.results?.[0];
    if (!user) return null;
    const name = (user.displayName || [user.firstName, user.lastName].filter(Boolean).join(' ')).trim();
    return { name: name || null, email: user.email?.trim() || null };
  } catch (err) {
    console.warn(`SF profile lookup for ${employeeId} failed: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { verifyEmployeeCredentials, fetchEmployeeProfile };
