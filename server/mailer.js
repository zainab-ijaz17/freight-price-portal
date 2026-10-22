// Outgoing email over SMTP (settings in config.js → MAIL). Until
// SMTP_HOST and MAIL_FROM are set, nothing is sent: each email is only
// logged to the console and to email_log, marked as not sent.
const nodemailer = require('nodemailer');
const { pool } = require('./db');
const { MAIL } = require('./config');

let transport = null;

function mailConfigured() {
  return Boolean(MAIL.host && MAIL.from);
}

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: MAIL.host,
      port: MAIL.port,
      secure: MAIL.secure,
      auth: MAIL.user ? { user: MAIL.user, pass: MAIL.pass } : undefined,
    });
  }
  return transport;
}

function address(r) {
  return r.name ? `"${r.name.replace(/["\\]/g, '')}" <${r.email}>` : r.email;
}

// Sends one email to `recipients` ([{ employeeId, name, email }]) and
// records it in email_log. Never throws: an email that can't go out must
// not fail or undo the approval step it's reporting. Resolves true if sent.
async function sendMail(kind, recipients, { subject, text, html }) {
  const missing = recipients.filter((r) => !r.email);
  if (missing.length) {
    console.warn(`No email address for ${missing.map((r) => `${r.name} (${r.employeeId})`).join(', ')} — add "email" for them in server/roles.js, or have them sign in once so SuccessFactors' address is saved.`);
  }
  const to = recipients.filter((r) => r.email);
  if (!to.length) return false;

  let error = null;
  if (!mailConfigured()) {
    error = 'Not sent: SMTP_HOST / MAIL_FROM are not set.';
    console.log(`Email not sent (SMTP not configured): "${subject}" to ${to.map((r) => r.email).join(', ')}`);
  } else {
    try {
      await getTransport().sendMail({ from: MAIL.from, to: to.map(address), subject, text, html });
    } catch (err) {
      error = err.message;
      console.error(`Email "${subject}" failed:`, err.message);
    }
  }
  await pool.query(
    'INSERT INTO email_log (kind, recipients, subject, error) VALUES ($1, $2, $3, $4)',
    [kind, JSON.stringify(to.map((r) => r.email)), subject, error]
  ).catch((err) => console.error('Could not record email in email_log:', err.message));
  return !error;
}

module.exports = { sendMail, mailConfigured };
