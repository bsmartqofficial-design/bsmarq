const { Pool } = require('pg');

const poolConfig = {
  options: '-c search_path=bsmarq,public',
  max: 10,
  idleTimeoutMillis: 30000,
};

if (process.env.DATABASE_URL) {
  poolConfig.connectionString = process.env.DATABASE_URL;
  poolConfig.ssl = { rejectUnauthorized: false };
} else {
  Object.assign(poolConfig, {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'smartq',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD
  });
}

const pool = new Pool(poolConfig);

pool.on('error', (error) => console.error('Unexpected PostgreSQL pool error', error));

module.exports = pool;
