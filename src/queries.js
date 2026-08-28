const pool = require('./db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const organizationSlug = process.env.ORGANIZATION_SLUG || 'abc-bank';
const subscriptionPlans = [
  { key: 'free_trial', label: '1 day free trial', days: 1, price: 0, description: 'Free trial' },
  { key: '7_days', label: '7 days', days: 7, price: 10, description: '$10' },
  { key: '30_days', label: '30 days', days: 30, price: 50, description: '$50' },
  { key: '95_days', label: '95 days', days: 95, price: 150, description: '$150' },
  { key: '355_days', label: '355 days', days: 355, price: 500, description: '$500' }
];

async function ensureSuperAdmin() {
  const email = (process.env.SUPER_ADMIN_EMAIL || 'buay@admin.com').toLowerCase();
  const passwordHash = await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD || 'buay102026', 12);
  await pool.query(`
    INSERT INTO users (organization_id, full_name, email, password_hash, role)
    VALUES (NULL, 'Super Admin', $1, $2, 'super_admin')
    ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, password_hash = EXCLUDED.password_hash, role = 'super_admin'
  `, [email, passwordHash]);
}

function servicesForType(type = '') {
  const value = type.toLowerCase();
  if (value.includes('bank') || value.includes('finance') || value.includes('insurance')) return [['Deposits', 'DEP'], ['Withdrawals', 'WTH'], ['Account opening', 'ACC'], ['Loan enquiries', 'LOA']];
  if (value.includes('school') || value.includes('university')) return [['Admissions', 'ADM'], ['Registration', 'REG'], ['Fees and payments', 'FEE'], ['Student records', 'REC']];
  if (value.includes('health') || value.includes('hospital') || value.includes('clinic')) return [['Appointments', 'APT'], ['Registration', 'REG'], ['Billing', 'BIL'], ['Pharmacy', 'PHA']];
  if (value.includes('government') || value.includes('embassy') || value.includes('consulate')) return [['Applications', 'APP'], ['Document collection', 'DOC'], ['Payments', 'PAY'], ['Information desk', 'INF']];
  if (value.includes('telecom')) return [['New connection', 'NEW'], ['Airtime and bundles', 'AIR'], ['Support', 'SUP'], ['Payments', 'PAY']];
  if (value.includes('retail') || value.includes('supermarket')) return [['Returns and exchanges', 'RET'], ['Customer service', 'CUS'], ['Payments', 'PAY'], ['Collections', 'COL']];
  if (value.includes('ngo') || value.includes('non-government') || value.includes('charit')) return [['Recruitment', 'REC'], ['Beneficiary services', 'BEN'], ['Programme support', 'PRO'], ['Donor enquiries', 'DON']];
  if (value.includes('legal') || value.includes('law firm') || value.includes('lawfirm')) return [['Legal consultation', 'CON'], ['Case intake', 'CAS'], ['Document review', 'DOC'], ['Court filing', 'FIL']];
  if (value.includes('post office') || value.includes('courier') || value.includes('postal') || value.includes('delivery')) return [['Parcel drop-off', 'DRP'], ['Parcel collection', 'COL'], ['Post office services', 'POS'], ['Delivery support', 'SUP']];
  return [['General enquiries', 'GEN'], ['Payments', 'PAY'], ['Support', 'SUP']];
}

function formatTicket(row) {
  return {
    number: row.ticket_number,
    customer: row.customer_name,
    service: row.service_name,
    status: row.status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
    counter: row.counter_name || '—',
    waited: row.joined_at ? `${Math.max(0, Math.floor((Date.now() - new Date(row.joined_at).getTime()) / 60000))} min` : 'Just now'
  };
}

async function getContext(organizationId) {
  const lookup = organizationId
    ? { clause: 'o.id = $1', values: [organizationId] }
    : { clause: 'o.slug = $1', values: [organizationSlug] };
  const result = await pool.query(`
    SELECT o.id AS organization_id, o.name AS organization_name, o.type AS organization_type,
           o.subscription AS subscription, o.status AS organization_status,
           b.id AS branch_id, b.name AS branch_name
    FROM organizations o
    JOIN branches b ON b.organization_id = o.id
    WHERE ${lookup.clause} AND o.status = 'active'
    ORDER BY b.created_at
    LIMIT 1
  `, lookup.values);
  if (!result.rows[0]) throw new Error(`Organization '${organizationId || organizationSlug}' is not configured`);
  return result.rows[0];
}

async function authenticate(email, password) {
  const superAdmin = await pool.query(
    `SELECT id, full_name, email, password_hash, role FROM users WHERE LOWER(email) = LOWER($1) AND role = 'super_admin' LIMIT 1`,
    [email]
  );
  if (superAdmin.rows[0] && (await bcrypt.compare(password, superAdmin.rows[0].password_hash))) {
    return {
      id: superAdmin.rows[0].id,
      organization_id: null,
      organization_name: 'Super Admin Control Center',
      organization_type: 'Administration',
      counter_id: null,
      counter_name: null,
      full_name: superAdmin.rows[0].full_name,
      email: superAdmin.rows[0].email,
      role: superAdmin.rows[0].role
    };
  }

  const result = await pool.query(
    `SELECT u.id, u.organization_id, u.full_name, u.email, u.role, u.password_hash,
            c.id AS counter_id, c.name AS counter_name,
            o.name AS organization_name, o.type AS organization_type
     FROM users u
     JOIN organizations o ON o.id = u.organization_id
     LEFT JOIN counters c ON c.staff_id = u.id
     WHERE LOWER(u.email) = LOWER($1)
       AND u.role IN ('org_admin', 'staff')
       AND o.status = 'active'
     LIMIT 1`,
    [email]
  );
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return null;
  return {
    id: user.id,
    organization_id: user.organization_id,
    organization_name: user.organization_name,
    organization_type: user.organization_type,
    counter_id: user.counter_id,
    counter_name: user.counter_name,
    full_name: user.full_name,
    email: user.email,
    role: user.role
  };
}

async function registerOrganization({ organizationName, organizationType, branchName, fullName, email, password }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const slug = organizationName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `org-${Date.now()}`;
    const organization = await client.query(
      `INSERT INTO organizations (name, slug, type, status, subscription) VALUES ($1, $2, $3, 'pending', 'starter') RETURNING id`,
      [organizationName.trim(), slug, organizationType]
    );
    const organizationId = organization.rows[0].id;
    const branch = await client.query(
      `INSERT INTO branches (organization_id, name) VALUES ($1, $2) RETURNING id`,
      [organizationId, branchName.trim()]
    );
    const department = await client.query(
      `INSERT INTO departments (organization_id, name) VALUES ($1, 'General Services') RETURNING id`,
      [organizationId]
    );
    for (const [name, prefix] of servicesForType(organizationType)) {
      await client.query(`INSERT INTO services (organization_id, department_id, name, prefix) VALUES ($1, $2, $3, $4)`, [organizationId, department.rows[0].id, name, prefix]);
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await client.query(
      `INSERT INTO users (organization_id, full_name, email, password_hash, role)
       VALUES ($1, $2, LOWER($3), $4, 'org_admin')
       RETURNING id, organization_id, full_name, email, role`,
      [organizationId, fullName.trim(), email.trim(), passwordHash]
    );
    await client.query('COMMIT');
    return { ...user.rows[0], organization_name: organizationName.trim(), organization_type: organizationType };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listStaffAndCounters(organizationId) {
  const [staffResult, countersResult] = await Promise.all([
    pool.query(`SELECT u.id, u.full_name, u.email, u.role, c.name AS counter_name
      FROM users u LEFT JOIN counters c ON c.staff_id = u.id
      WHERE u.organization_id = $1 AND u.role IN ('org_admin', 'staff') ORDER BY u.created_at`, [organizationId]),
    pool.query(`SELECT c.id, c.name, c.status, c.staff_id, u.full_name AS staff_name
      FROM counters c JOIN branches b ON b.id = c.branch_id
      LEFT JOIN users u ON u.id = c.staff_id
      WHERE b.organization_id = $1 ORDER BY c.name`, [organizationId])
  ]);
  return { staff: staffResult.rows, counters: countersResult.rows };
}

async function deleteStaff(organizationId, staffId) {
  const result = await pool.query(`DELETE FROM users WHERE id = $1 AND organization_id = $2 AND role = 'staff' RETURNING id`, [staffId, organizationId]);
  return Boolean(result.rows[0]);
}

async function changePassword(userId, currentPassword, newPassword) {
  const result = await pool.query('SELECT password_hash FROM users WHERE id = $1 AND role = \'org_admin\'', [userId]);
  if (!result.rows[0] || !(await bcrypt.compare(currentPassword, result.rows[0].password_hash))) throw new Error('Current password is incorrect.');
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(newPassword, 12), userId]);
}

async function createStaffInvitation(organizationId, email, counterId) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const counter = counterId ? await pool.query(`SELECT c.id FROM counters c JOIN branches b ON b.id = c.branch_id WHERE c.id = $1 AND b.organization_id = $2`, [counterId, organizationId]) : null;
  if (counterId && !counter?.rows[0]) throw new Error('That counter does not belong to this organization.');
  await pool.query(`INSERT INTO invitations (organization_id, email, token_hash, role, counter_id, expires_at) VALUES ($1, LOWER($2), $3, 'staff', $4, NOW() + INTERVAL '7 days')`, [organizationId, email.trim(), tokenHash, counterId || null]);
  return token;
}

async function getStaffInvitation(token) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const result = await pool.query(`SELECT i.id, i.organization_id, i.email, i.role, i.counter_id, o.name AS organization_name
    FROM invitations i JOIN organizations o ON o.id = i.organization_id
    WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at > NOW() AND o.status = 'active'`, [tokenHash]);
  return result.rows[0] || null;
}

async function acceptStaffInvitation(token, fullName, password) {
  const invitation = await getStaffInvitation(token);
  if (!invitation) throw new Error('This invitation is invalid or has expired.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await client.query(`INSERT INTO users (organization_id, full_name, email, password_hash, role)
      VALUES ($1, $2, LOWER($3), $4, 'staff') RETURNING id, organization_id, full_name, email, role`, [invitation.organization_id, fullName.trim(), invitation.email, passwordHash]);
    if (invitation.counter_id) {
      const counter = await client.query(`SELECT c.id FROM counters c JOIN branches b ON b.id = c.branch_id WHERE c.id = $1 AND b.organization_id = $2`, [invitation.counter_id, invitation.organization_id]);
      if (!counter.rows[0]) throw new Error('That counter does not belong to this organization.');
      await client.query('UPDATE counters SET staff_id = $1, status = \'open\' WHERE id = $2', [user.rows[0].id, invitation.counter_id]);
    }
    await client.query('UPDATE invitations SET used_at = NOW() WHERE id = $1', [invitation.id]);
    await client.query('COMMIT');
    return { ...user.rows[0], organization_name: invitation.organization_name };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function loadDashboard(organizationId) {
  const context = await getContext(organizationId);
  const [servicesResult, ticketsResult, statsResult, appointmentsResult] = await Promise.all([
    pool.query(`
      SELECT s.id, s.name, s.prefix, s.avg_duration_minutes,
             COUNT(t.id) FILTER (WHERE t.status = 'waiting')::int AS count,
             COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (t.called_at - t.joined_at)) / 60)
               FILTER (WHERE t.called_at IS NOT NULL AND t.joined_at::date = CURRENT_DATE)), 0)::int AS avg_wait
      FROM services s
      LEFT JOIN queue_tickets t ON t.service_id = s.id AND t.branch_id = $1
      WHERE s.organization_id = $2 AND s.active = TRUE
      GROUP BY s.id ORDER BY s.created_at
    `, [context.branch_id, context.organization_id]),
    pool.query(`
      SELECT t.ticket_number, t.customer_name, t.status, t.joined_at, c.name AS counter_name, s.name AS service_name
      FROM queue_tickets t JOIN services s ON s.id = t.service_id
      LEFT JOIN counters c ON c.id = t.counter_id
      WHERE t.organization_id = $1 AND t.branch_id = $2
        AND t.status IN ('waiting', 'called', 'now_serving')
      ORDER BY CASE t.status WHEN 'now_serving' THEN 0 ELSE 1 END, t.joined_at
      LIMIT 100
    `, [context.organization_id, context.branch_id]),
    pool.query(`
      SELECT COUNT(*) FILTER (WHERE status = 'waiting')::int AS waiting,
             COUNT(*) FILTER (WHERE status IN ('called', 'now_serving'))::int AS serving,
             COUNT(*) FILTER (WHERE status = 'completed' AND completed_at::date = CURRENT_DATE)::int AS completed,
             COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (called_at - joined_at)) / 60)
               FILTER (WHERE called_at IS NOT NULL AND joined_at::date = CURRENT_DATE)), 0)::int AS avg_wait
      FROM queue_tickets WHERE organization_id = $1 AND branch_id = $2
    `, [context.organization_id, context.branch_id]),
    pool.query(`
      SELECT a.customer_name, a.starts_at, a.status, s.name AS service_name
      FROM appointments a JOIN services s ON s.id = a.service_id
      WHERE a.organization_id = $1 AND a.branch_id = $2 AND a.starts_at >= CURRENT_DATE
      ORDER BY a.starts_at LIMIT 5
    `, [context.organization_id, context.branch_id])
  ]);

  const stats = statsResult.rows[0];
  return {
    organization: {
      id: context.organization_id,
      name: context.organization_name,
      type: context.organization_type,
      branch: context.branch_name,
      subscription: context.subscription || 'free_trial',
      status: context.organization_status || 'active'
    },
    services: servicesResult.rows.map((service, index) => ({
      name: service.name,
      prefix: service.prefix,
      wait: `${service.avg_wait || service.avg_duration_minutes} min`,
      count: service.count,
      color: ['green', 'blue', 'orange', 'purple'][index % 4]
    })),
    tickets: ticketsResult.rows.map(formatTicket),
    stats: { waiting: stats.waiting, serving: stats.serving, completed: stats.completed, avgWait: `${stats.avg_wait} min` },
    appointments: appointmentsResult.rows
  };
}

async function createTicket({ customerName, prefix, organizationId }) {
  const context = await getContext(organizationId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const serviceResult = await client.query(
      'SELECT id, name, prefix FROM services WHERE organization_id = $1 AND prefix = $2 AND active = TRUE LIMIT 1',
      [context.organization_id, prefix]
    );
    const service = serviceResult.rows[0];
    if (!service) throw new Error('Selected service is unavailable');
    const numberResult = await client.query(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(ticket_number, '^\\D+-', ''), '')::int), 0) + 1 AS next_number
       FROM queue_tickets WHERE organization_id = $1 AND service_id = $2 AND joined_at::date = CURRENT_DATE`,
      [context.organization_id, service.id]
    );
    const ticketNumber = `${service.prefix}-${String(numberResult.rows[0].next_number).padStart(3, '0')}`;
    const inserted = await client.query(
      `INSERT INTO queue_tickets (organization_id, branch_id, service_id, ticket_number, customer_name, status, position)
       VALUES ($1, $2, $3, $4, $5, 'waiting', (SELECT COUNT(*) + 1 FROM queue_tickets WHERE branch_id = $2 AND status = 'waiting'))
       RETURNING ticket_number, customer_name, status, joined_at`,
      [context.organization_id, context.branch_id, service.id, ticketNumber, customerName]
    );
    await client.query('COMMIT');
    return formatTicket({ ...inserted.rows[0], service_name: service.name });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getTicket(ticketNumber, organizationId) {
  const context = await getContext(organizationId);
  const result = await pool.query(`
    SELECT t.ticket_number, t.customer_name, t.status, t.joined_at, c.name AS counter_name,
           s.name AS service_name,
           (SELECT COUNT(*)::int FROM queue_tickets ahead
            WHERE ahead.organization_id = t.organization_id AND ahead.branch_id = t.branch_id
              AND ahead.service_id = t.service_id AND ahead.status = 'waiting'
              AND ahead.joined_at < t.joined_at) AS people_ahead
    FROM queue_tickets t JOIN services s ON s.id = t.service_id
    LEFT JOIN counters c ON c.id = t.counter_id
    WHERE t.ticket_number = $1 AND t.organization_id = $2 AND t.branch_id = $3
    LIMIT 1`, [ticketNumber, context.organization_id, context.branch_id]);
  return result.rows[0] ? { ...formatTicket(result.rows[0]), peopleAhead: result.rows[0].people_ahead } : null;
}

async function callNext(counterName = 'Counter 04', organizationId) {
  const context = await getContext(organizationId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const next = await client.query(`
      SELECT t.id, t.ticket_number, t.customer_name, t.status, t.joined_at, s.name AS service_name
      FROM queue_tickets t JOIN services s ON s.id = t.service_id
      WHERE t.organization_id = $1 AND t.branch_id = $2 AND t.status = 'waiting'
      ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'vip' THEN 1 ELSE 2 END, t.joined_at
      FOR UPDATE SKIP LOCKED LIMIT 1
    `, [context.organization_id, context.branch_id]);
    if (!next.rows[0]) { await client.query('ROLLBACK'); return null; }
    const counter = await client.query(
      `SELECT id, name FROM counters WHERE branch_id = $1 AND (name = $2 OR status = 'open') ORDER BY (name = $2) DESC LIMIT 1`,
      [context.branch_id, counterName]
    );
    const updated = await client.query(
      `UPDATE queue_tickets SET status = 'now_serving', counter_id = $1, called_at = NOW()
       WHERE id = $2 RETURNING ticket_number, customer_name, status, joined_at`,
      [counter.rows[0]?.id || null, next.rows[0].id]
    );
    await client.query('COMMIT');
    return formatTicket({ ...updated.rows[0], service_name: next.rows[0].service_name, counter_name: counter.rows[0]?.name || counterName });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function updateTicket(ticketNumber, action, organizationId) {
  const statuses = { complete: 'completed', skip: 'skipped', recall: 'now_serving' };
  const status = statuses[action];
  if (!status) throw new Error('Unsupported ticket action');
  const result = await pool.query(`
    SELECT t.ticket_number, t.customer_name, t.status, t.joined_at, c.name AS counter_name, s.name AS service_name
    FROM queue_tickets t JOIN services s ON s.id = t.service_id LEFT JOIN counters c ON c.id = t.counter_id
    WHERE t.ticket_number = $1 AND t.organization_id = $2 LIMIT 1`, [ticketNumber, organizationId]);
  if (!result.rows[0]) return null;
  const updated = await pool.query(
    `UPDATE queue_tickets SET status = $1, completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE completed_at END
     WHERE ticket_number = $2 AND organization_id = $3 RETURNING ticket_number, customer_name, status, joined_at`,
    [status, ticketNumber, organizationId]
  );
  return formatTicket({ ...updated.rows[0], service_name: result.rows[0].service_name, counter_name: result.rows[0].counter_name });
}

async function listOrganizationsForAdmin() {
  const result = await pool.query(`
    SELECT o.id, o.name, o.type, o.status, o.subscription, o.approved_at, o.created_at,
           u.full_name AS admin_name, u.email AS admin_email
    FROM organizations o
    LEFT JOIN users u ON u.organization_id = o.id AND u.role = 'org_admin'
    ORDER BY o.created_at DESC
  `);
  return result.rows;
}

async function approveOrganization(organizationId) {
  const result = await pool.query(
    `UPDATE organizations SET status = 'active', approved_at = NOW() WHERE id = $1 RETURNING *`,
    [organizationId]
  );
  return result.rows[0] || null;
}

async function rejectOrganization(organizationId) {
  const result = await pool.query(
    `UPDATE organizations SET status = 'rejected', approved_at = NULL WHERE id = $1 RETURNING *`,
    [organizationId]
  );
  return result.rows[0] || null;
}

async function updateOrganizationSubscription(organizationId, subscription) {
  const normalized = subscription && ['free_trial', '7_days', '30_days', '95_days', '355_days'].includes(subscription) ? subscription : 'free_trial';
  const result = await pool.query(
    `UPDATE organizations SET subscription = $1 WHERE id = $2 RETURNING *`,
    [normalized, organizationId]
  );
  return result.rows[0] || null;
}

async function getOrganizationSubscription(organizationId) {
  const result = await pool.query(
    `SELECT id, name, subscription, status, approved_at FROM organizations WHERE id = $1 LIMIT 1`,
    [organizationId]
  );
  return result.rows[0] || null;
}

module.exports = {
  ensureSuperAdmin,
  getContext,
  loadDashboard,
  createTicket,
  getTicket,
  callNext,
  updateTicket,
  authenticate,
  registerOrganization,
  listStaffAndCounters,
  deleteStaff,
  changePassword,
  createStaffInvitation,
  getStaffInvitation,
  acceptStaffInvitation,
  listOrganizationsForAdmin,
  approveOrganization,
  rejectOrganization,
  updateOrganizationSubscription,
  getOrganizationSubscription,
  subscriptionPlans
};
