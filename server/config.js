module.exports = {
  PORT: process.env.PORT || 3000,
  // SAP API Management proxy in front of the ZFREIGHT_SRV_SRV OData
  // service (rate lines) — the APIM proxy maps directly to the service
  // root, so the backend's own /sap/opu/odata/sap/ZFREIGHT_SRV_SRV path
  // (visible in the metadata's atom:link) is NOT part of this URL; adding
  // it 404s. No separate subscription key — calls forward the end user's
  // own Basic Auth, same as SAP would expect directly.
  FREIGHT: {
    baseUrl: 'https://devspace.test.apimanagement.eu10.hana.ondemand.com/freight',
  },
  // SAP SuccessFactors — used only to verify an employee ID / password pair
  // at login (see sfClient.js). usernameSuffix turns the employee ID typed
  // at login into the SF username the OData service expects.
  SF: {
    baseUrl: process.env.SF_BASE_URL || 'https://api44.sapsf.com',
    usernameSuffix: process.env.SF_USERNAME_SUFFIX || '@packagesli',
  },
  // Approval emails (see mailer.js / approvalEmails.js). Nothing is sent
  // until SMTP_HOST and MAIL_FROM are set; until then each email is only
  // logged. APP_URL is the portal's own address, for the link in the email.
  MAIL: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true', // true for port 465; 587 upgrades with STARTTLS
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || '',
    appUrl: (process.env.APP_URL || '').replace(/\/$/, ''),
    // A reminder goes out once something has waited this long, then again
    // every REMINDER_EVERY_HOURS while it's still waiting — only within
    // working hours (Karachi time, Monday–Saturday).
    reminderAfterHours: Number(process.env.REMINDER_AFTER_HOURS) || 24,
    reminderEveryHours: Number(process.env.REMINDER_EVERY_HOURS) || 24,
    workdayStartHour: 9,
    workdayEndHour: 18,
  },
};
