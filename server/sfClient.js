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

module.exports = { verifyEmployeeCredentials };
