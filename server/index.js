const path = require('path');
const express = require('express');
const { PORT } = require('./config');
const { ensureSchema, seedIfEmpty, migrateState } = require('./store');
const { startReminderJob } = require('./approvalEmails');
const { mailConfigured } = require('./mailer');
const { seed } = require('./seedData');
const { replaceRateLists } = require('./replaceRateLists');
const authRoutes = require('./routes/auth');
const vendorsRoutes = require('./routes/vendors');
const dieselRoutes = require('./routes/diesel');
const ratesRoutes = require('./routes/rates');
const revisionsRoutes = require('./routes/revisions');
const adminRoutes = require('./routes/admin');
const notificationsRoutes = require('./routes/notifications');
const changeRequestsRoutes = require('./routes/changeRequests');
const alertsRoutes = require('./routes/alerts');
const draftsRoutes = require('./routes/drafts');
const { sendError } = require('./errors');

async function main() {
  await ensureSchema();
  await seedIfEmpty(seed);
  await migrateState();
  await replaceRateLists();
  startReminderJob();
  if (!mailConfigured()) console.warn('Approval emails are off: set SMTP_HOST and MAIL_FROM (see manifest.yml) to send them.');

  const app = express();
  app.use(express.json());

  app.use('/api/sap', authRoutes);
  app.use('/api/sap', vendorsRoutes);
  app.use('/api/sap', dieselRoutes);
  app.use('/api/sap', ratesRoutes);
  app.use('/api/sap', draftsRoutes);
  app.use('/api/sap', revisionsRoutes);
  app.use('/api/sap', adminRoutes);
  app.use('/api/sap', notificationsRoutes);
  app.use('/api/sap', changeRequestsRoutes);
  app.use('/api/sap', alertsRoutes);
  // Malformed JSON bodies and anything else Express itself rejects.
  // eslint-disable-next-line no-unused-vars
  app.use('/api/sap', (err, req, res, next) => sendError(res, err, `handling ${req.method} ${req.path}`));
  app.use(express.static(path.join(__dirname, '..', 'app')));

  app.listen(PORT, () => {
    console.log(`Freight Rate Portal listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
