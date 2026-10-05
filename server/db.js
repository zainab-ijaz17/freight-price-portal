// Postgres connection pool. In order of preference:
//   1. A PostgreSQL service bound to the app on SAP BTP (VCAP_SERVICES).
//   2. DATABASE_URL (any other managed/cloud instance).
//   3. PG* env vars with local-dev defaults, so `npm start` works against a
//      plain local Postgres with no setup beyond creating the database.
const { Pool } = require('pg');

// Finds the bound PostgreSQL service's credentials, if the app is running on
// Cloud Foundry with one bound (`cf bind-service` or `services:` in
// manifest.yml).
function boundPostgres() {
  if (!process.env.VCAP_SERVICES) return null;
  const services = Object.values(JSON.parse(process.env.VCAP_SERVICES)).flat();
  const pg = services.find(
    (s) => (s.tags || []).includes('postgresql') || /postgres/i.test(s.label || '')
  );
  return pg ? pg.credentials : null;
}

function poolConfig() {
  const bound = boundPostgres();
  if (bound) {
    return {
      host: bound.hostname,
      port: Number(bound.port),
      user: bound.username,
      password: bound.password,
      database: bound.dbname,
      // BTP hands over the CA for its instance, so the certificate is
      // verified properly rather than just encrypted.
      ssl: bound.sslrootcert
        ? { ca: bound.sslrootcert, rejectUnauthorized: true }
        : { rejectUnauthorized: false },
    };
  }
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      // Managed Postgres providers all require TLS; most terminate it with a
      // cert this box's CA bundle won't already trust, so this matches the
      // connection encryption without pinning to one provider's CA.
      ssl: { rejectUnauthorized: false },
    };
  }
  return {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'freight_portal',
  };
}

const pool = new Pool(poolConfig());

module.exports = { pool };
