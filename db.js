const { Pool } = require('pg');

const poolConfig = {
  options: '-c search_path=bsmarq,public',
  max: 10,
  idleTimeoutMillis: 30000,
};

const hasLocalDbConfig = Boolean(
  process.env.DB_HOST ||
  process.env.DB_NAME ||
  process.env.DB_USER ||
  process.env.DB_PASSWORD
);

if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL) {
  poolConfig.connectionString = process.env.DATABASE_URL;
  poolConfig.ssl = { rejectUnauthorized: false };
} else if (hasLocalDbConfig || !process.env.DATABASE_URL || !process.env.DATABASE_URL.trim()) {
  Object.assign(poolConfig, {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'smartq',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD
  });
} else if (process.env.DATABASE_URL) {
  poolConfig.connectionString = process.env.DATABASE_URL;
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

pool.on('error', (error) => console.error('Unexpected PostgreSQL pool error', error));

module.exports = pool;
