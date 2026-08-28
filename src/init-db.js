require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const pool = require('./db');

const services = [
  ['Cash Deposit', 'DEP'],
  ['Account Opening', 'ACC'],
  ['Loan Consultation', 'LOA'],
  ['Card Services', 'CRD']
];

async function initialize() {
  const schema = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');
  await pool.query(schema);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const organization = await client.query(`
      INSERT INTO organizations (name, slug, type)
      VALUES ('ABC Bank', $1, 'Banking & Finance')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `, [process.env.ORGANIZATION_SLUG || 'abc-bank']);
    const organizationId = organization.rows[0].id;
    const branch = await client.query(`
      INSERT INTO branches (organization_id, name, address)
      SELECT $1, 'Kampala Main Branch', 'Kampala, Uganda'
      WHERE NOT EXISTS (SELECT 1 FROM branches WHERE organization_id = $1 AND name = 'Kampala Main Branch')
      RETURNING id
    `, [organizationId]);
    const branchId = branch.rows[0]?.id || (await client.query(
      `SELECT id FROM branches WHERE organization_id = $1 AND name = 'Kampala Main Branch'`, [organizationId]
    )).rows[0].id;
    const department = await client.query(`
      INSERT INTO departments (organization_id, name)
      SELECT $1, 'Customer Services'
      WHERE NOT EXISTS (SELECT 1 FROM departments WHERE organization_id = $1 AND name = 'Customer Services')
      RETURNING id
    `, [organizationId]);
    const departmentId = department.rows[0]?.id || (await client.query(
      `SELECT id FROM departments WHERE organization_id = $1 AND name = 'Customer Services'`, [organizationId]
    )).rows[0].id;
    for (const [name, prefix] of services) {
      await client.query(`
        INSERT INTO services (organization_id, department_id, name, prefix, avg_duration_minutes)
        SELECT $1::uuid, $2::uuid, $3::varchar, $4::varchar, 10
        WHERE NOT EXISTS (SELECT 1 FROM services WHERE organization_id = $1::uuid AND prefix = $4::varchar)
      `, [organizationId, departmentId, name, prefix]);
    }
    for (let counter = 1; counter <= 6; counter += 1) {
      await client.query(`
        INSERT INTO counters (branch_id, name, status)
        SELECT $1::uuid, $2::varchar, 'open'
        WHERE NOT EXISTS (SELECT 1 FROM counters WHERE branch_id = $1::uuid AND name = $2::varchar)
      `, [branchId, `Counter ${String(counter).padStart(2, '0')}`]);
    }
    const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'ChangeMe123!', 12);
    await client.query(`
      INSERT INTO users (organization_id, full_name, email, password_hash, role)
      VALUES ($1, 'Amina Nansubuga', $2, $3, 'org_admin')
      ON CONFLICT (email) DO NOTHING
    `, [organizationId, process.env.ADMIN_EMAIL || 'admin@abcbank.example', passwordHash]);

    const superAdminHash = await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD || 'buay102026', 12);
    await client.query(`
      INSERT INTO users (organization_id, full_name, email, password_hash, role)
      VALUES (NULL, 'Super Admin', LOWER($1), $2, 'super_admin')
      ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, password_hash = EXCLUDED.password_hash, role = 'super_admin'
    `, [process.env.SUPER_ADMIN_EMAIL || 'buay@admin.com', superAdminHash]);

    await client.query('COMMIT');
    console.log('PostgreSQL schema and initial organization are ready.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

initialize().catch((error) => {
  console.error(`Database initialization failed: ${error.message}`);
  process.exitCode = 1;
});
