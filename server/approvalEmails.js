// Emails to Rate Approvers about work waiting for them:
//  - straight away, when rate sheets are submitted or a master data
//    request is raised;
//  - a reminder listing everything still waiting, once anything has
//    waited MAIL.reminderAfterHours, repeated every reminderEveryHours
//    while it's still waiting (working hours only).
// The in-app bell (alerts) carries the same news; email is so nobody has
// to keep the portal open to notice.
const { MAIL } = require('./config');
const { pool } = require('./db');
const { withDb } = require('./store');
const { recipientsWithRole } = require('./directory');
const { sendMail } = require('./mailer');
const { parseDMY } = require('./rateEngine');

const REMINDER_KIND = 'approval_reminder';
const CHECK_EVERY_MS = 30 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function person(p) {
  if (!p) return '';
  return p.name && p.name !== p.employeeId ? `${p.name} (${p.employeeId})` : String(p.employeeId);
}

function pct(n) {
  return `${n > 0 ? '+' : ''}${Number(n).toFixed(2)}%`;
}

function portalLink(hash) {
  return MAIL.appUrl ? `${MAIL.appUrl}/${hash}` : null;
}

// One plain table-based layout: renders the same in Outlook as anywhere.
function emailHtml({ heading, intro, columns, rows, linkHash, linkLabel }) {
  const url = portalLink(linkHash);
  const th = (c) => `<th align="left" style="padding:6px 10px;border-bottom:1px solid #ccc;font-size:12px;color:#555">${esc(c)}</th>`;
  const td = (c) => `<td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px">${esc(c)}</td>`;
  return `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#1b1b1b;max-width:720px">
      <h2 style="font-size:18px;font-weight:600;margin:0 0 8px">${esc(heading)}</h2>
      <p style="font-size:14px;margin:0 0 14px">${esc(intro)}</p>
      <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%">
        <tr>${columns.map(th).join('')}</tr>
        ${rows.map((r) => `<tr>${r.map(td).join('')}</tr>`).join('')}
      </table>
      ${url ? `<p style="margin:18px 0 0"><a href="${esc(url)}" style="background:#2f5aa8;color:#fff;padding:9px 16px;border-radius:4px;text-decoration:none;font-size:14px">${esc(linkLabel)}</a></p>` : ''}
      <p style="font-size:12px;color:#777;margin-top:22px">Freight Rate Portal · sent automatically, please don't reply.</p>
    </div>`;
}

function emailText({ heading, intro, columns, rows, linkHash }) {
  const url = portalLink(linkHash);
  return [heading, '', intro, '', ...rows.map((r) => r.map((c, i) => `${columns[i]}: ${c}`).join(' · ')), '', url ? `Open the portal: ${url}` : 'Sign in to the Freight Rate Portal to act on it.'].join('\n');
}

function compose(content) {
  return { subject: content.subject, html: emailHtml(content), text: emailText(content) };
}

// Runs after the triggering transaction has committed; never throws.
function inBackground(label, fn) {
  Promise.resolve().then(fn).catch((err) => console.error(`${label} email failed:`, err.message));
}

const SHEET_COLUMNS = ['Revision', 'Rate list', 'Rate lines', 'Change', 'Rates effective', 'Submitted by'];

function sheetRow(s) {
  const lines = s.worksheet.rows.length * s.worksheet.cols.length;
  return [String(s.revisionNo), s.vendorName, String(lines), pct(s.upliftPct), s.effectiveDate, `${person(s.submittedBy)}, ${s.submittedOn}`];
}

function emailSheetsSubmitted({ revisionNo, sheets, submittedBy }) {
  inBackground('Submission', async () => {
    const to = await recipientsWithRole('Approver', { except: submittedBy.employeeId });
    const n = sheets.length;
    await sendMail('sheets_submitted', to, compose({
      subject: `Approval needed: Revision ${revisionNo} — ${n} rate sheet${n === 1 ? '' : 's'}`,
      heading: `Revision ${revisionNo} is waiting for your approval`,
      intro: `${person(submittedBy)} submitted ${n} rate sheet${n === 1 ? '' : 's'} (diesel at PKR ${sheets[0].dieselPrice} per litre). Each sheet can be approved, returned or rejected on its own.`,
      columns: SHEET_COLUMNS,
      rows: sheets.map(sheetRow),
      linkHash: '#/approve',
      linkLabel: 'Review and approve',
    }));
  });
}

function emailChangeRequestRaised({ id, summary, reason, requestedBy }) {
  inBackground('Master data request', async () => {
    const to = await recipientsWithRole('Approver', { except: requestedBy.employeeId });
    await sendMail('change_request_raised', to, compose({
      subject: `Approval needed: master data request #${id}`,
      heading: `Master data request #${id} is waiting for your decision`,
      intro: `${person(requestedBy)} raised a master data change that takes effect only once another Rate Approver approves it.`,
      columns: ['Request', 'Reason'],
      rows: [[summary, reason || '—']],
      linkHash: '#/master-data-requests',
      linkLabel: 'Review the request',
    }));
  });
}

function sheetWaitingSince(s) {
  return s.submittedAt ? new Date(s.submittedAt) : parseDMY(s.submittedOn);
}

function withinWorkingHours(now) {
  const hour = now.getHours();
  return now.getDay() !== 0 && hour >= MAIL.workdayStartHour && hour < MAIL.workdayEndHour;
}

// Sends the reminder if one is due. Exported for testing; normally run by
// startReminderJob. Resolves true if a reminder was sent (or attempted).
async function sendDueReminders(now = new Date()) {
  if (!withinWorkingHours(now)) return false;
  const { rows: [last] } = await pool.query('SELECT max(sent_at) AS at FROM email_log WHERE kind = $1', [REMINDER_KIND]);
  if (last.at && now - last.at < MAIL.reminderEveryHours * HOUR_MS) return false;

  const cutoff = new Date(now - MAIL.reminderAfterHours * HOUR_MS);
  const sheets = await withDb(async (db) => db.pendingSheets);
  const { rows: requests } = await pool.query("SELECT id, summary, requested_by, requested_at FROM change_requests WHERE status = 'pending' ORDER BY requested_at");
  const overdue = sheets.some((s) => sheetWaitingSince(s) <= cutoff) || requests.some((r) => r.requested_at <= cutoff);
  if (!overdue) return false;

  const to = await recipientsWithRole('Approver');
  const rows = [
    ...sheets.map((s) => ['Rate sheet', `Revision ${s.revisionNo} · ${s.vendorName}`, person(s.submittedBy), s.submittedOn]),
    ...requests.map((r) => ['Master data', `#${r.id} · ${r.summary}`, person(r.requested_by), r.requested_at.toLocaleDateString('en-GB').replace(/\//g, '.')]),
  ];
  await sendMail(REMINDER_KIND, to, compose({
    subject: `Reminder: ${rows.length} item${rows.length === 1 ? '' : 's'} waiting for approval in the Freight Rate Portal`,
    heading: 'Still waiting for approval',
    intro: `These are waiting for a Rate Approver; the oldest has waited more than ${MAIL.reminderAfterHours} hours.`,
    columns: ['Type', 'Item', 'Raised by', 'Since'],
    rows,
    linkHash: sheets.length ? '#/approve' : '#/master-data-requests',
    linkLabel: 'Open the portal',
  }));
  return true;
}

function startReminderJob() {
  const tick = () => sendDueReminders().catch((err) => console.error('Approval reminder check failed:', err.message));
  setTimeout(tick, 60 * 1000).unref();
  setInterval(tick, CHECK_EVERY_MS).unref();
}

module.exports = { emailSheetsSubmitted, emailChangeRequestRaised, sendDueReminders, startReminderJob };
