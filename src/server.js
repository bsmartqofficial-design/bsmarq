require('dotenv').config();
const fs = require('fs');
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const pool = require('./db');
const queries = require('./queries');
const { askGemini } = require('./ai');

const viewDir = fs.existsSync(path.join(__dirname, 'views'))
  ? path.join(__dirname, 'views')
  : fs.existsSync(path.join(__dirname, '../views'))
    ? path.join(__dirname, '../views')
    : __dirname;
const publicDir = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : fs.existsSync(path.join(__dirname, '../public'))
    ? path.join(__dirname, '../public')
    : __dirname;

const subscriptionPlanList = queries.subscriptionPlans || [
  { key: 'free_trial', label: '1 day free trial', days: 1, price: 0, description: 'Free trial' },
  { key: '7_days', label: '7 days', days: 7, price: 10, description: '$10' },
  { key: '30_days', label: '30 days', days: 30, price: 50, description: '$50' },
  { key: '95_days', label: '95 days', days: 95, price: 150, description: '$150' },
  { key: '355_days', label: '355 days', days: 355, price: 500, description: '$500' }
];

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const allowedOrigins = [
  process.env.CORS_ORIGIN,
  process.env.PUBLIC_BASE_URL,
  process.env.APP_URL,
  'http://localhost:3000',
  'http://127.0.0.1:3000'
].filter(Boolean);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true,
    methods: ['GET', 'POST']
  }
});
const port = Number(process.env.PORT) || 3000;
let databaseStatus = { connected: false, initialized: false, message: null };
const sessionMiddleware = session({
  store: new pgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'bsmarq-development-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 86400000,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  }
});
app.set('view engine', 'ejs');
app.set('views', viewDir);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(publicDir));
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

function requireStaff(req, res, next) {
  if (req.session.user && ['org_admin', 'staff'].includes(req.session.user.role)) return next();
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

function requireAdmin(req, res, next) {
  if (req.session.user?.role === 'org_admin') return next();
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

function requireSuperAdmin(req, res, next) {
  if (req.session.user?.role === 'super_admin') return next();
  res.redirect('/login');
}

function getPortalProfile(type = '') {
  const normalizedType = type.toLowerCase();
  const profiles = [
    { match: ['bank', 'finance', 'insurance'], key: 'finance', label: 'Financial services portal', queueNoun: 'customer', focus: 'Branch operations' },
    { match: ['school', 'university'], key: 'education', label: 'Education services portal', queueNoun: 'visitor', focus: 'Student services' },
    { match: ['health', 'hospital', 'clinic'], key: 'healthcare', label: 'Healthcare services portal', queueNoun: 'patient', focus: 'Care desk operations' },
    { match: ['government', 'embassy', 'consulate'], key: 'public', label: 'Public services portal', queueNoun: 'citizen', focus: 'Public service desk' },
    { match: ['telecom'], key: 'telecom', label: 'Telecom services portal', queueNoun: 'customer', focus: 'Service centre operations' },
    { match: ['restaurant', 'food'], key: 'hospitality', label: 'Hospitality services portal', queueNoun: 'guest', focus: 'Guest service operations' },
    { match: ['retail', 'supermarket'], key: 'retail', label: 'Retail services portal', queueNoun: 'customer', focus: 'Store operations' },
    { match: ['ngo', 'non-government', 'charit'], key: 'ngo', label: 'NGO services portal', queueNoun: 'beneficiary', focus: 'Community programmes' },
    { match: ['legal', 'law firm', 'lawfirm'], key: 'legal', label: 'Legal services portal', queueNoun: 'client', focus: 'Legal client services' },
    { match: ['post office', 'courier', 'postal', 'delivery'], key: 'logistics', label: 'Postal and courier portal', queueNoun: 'customer', focus: 'Delivery operations' }
  ];
  return profiles.find((profile) => profile.match.some((term) => normalizedType.includes(term))) || {
    key: 'general', label: 'Organization services portal', queueNoun: 'customer', focus: 'Daily operations'
  };
}

function getRequestedOrganizationId(req) {
  return req.session.user?.organization_id || req.query.organizationId || null;
}

app.get('/login', (req, res) => res.render('login', {
  error: null,
  message: req.query.message || null,
  next: req.query.next || '/dashboard'
}));
app.post('/login', async (req, res) => {
  try {
    const user = await queries.authenticate(req.body.email || '', req.body.password || '');
    if (!user) return res.status(401).render('login', {
      error: 'Invalid email or password.',
      message: null,
      next: req.body.next || '/dashboard'
    });
    req.session.user = user;
    if (user.role === 'super_admin') return res.redirect('/super-admin');
    res.redirect(req.body.next || '/dashboard');
  } catch (error) { res.status(500).render('login', { error: 'Unable to sign in right now.', message: null, next: req.body.next || '/dashboard' }); }
});
function logout(req, res) { req.session.destroy(() => res.redirect('/login')); }
app.get('/logout', logout);
app.post('/logout', logout);
app.get('/register', (req, res) => res.render('register', { error: null, values: {} }));
app.post('/register', async (req, res) => {
  const values = req.body;
  if (!values.organizationName || !values.organizationType || !values.branchName || !values.fullName || !values.email || !values.password) {
    return res.status(400).render('register', { error: 'Complete all required fields.', values });
  }
  try {
    await queries.registerOrganization(values);
    return res.redirect('/login?message=Registration+submitted+for+approval.+Your+organization+will+be+activated+after+the+super+admin+approves+it.');
  } catch (error) {
    const message = error.code === '23505' ? 'That organization name or email is already registered.' : 'Unable to create the organization right now.';
    res.status(400).render('register', { error: message, values });
  }
});

app.get('/', requireStaff, async (req, res, next) => {
  try {
    const demo = await queries.loadDashboard(req.session.user.organization_id);
    const notifications = await queries.listUserNotifications(req.session.user.id, req.session.user.organization_id);
    res.render('dashboard', {
      page: 'Overview',
      demo,
      tickets: demo.tickets,
      portal: getPortalProfile(demo.organization.type),
      user: req.session.user,
      plans: subscriptionPlanList,
      activeSubscription: demo.organization.subscription || 'free_trial',
      notifications
    });
  } catch (error) { next(error); }
});
app.get('/dashboard', requireStaff, (req, res) => res.redirect('/'));
app.post('/api/ai/chat', requireStaff, async (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Enter a question for BsmartQ AI.' });
  if (message.length > 2000) return res.status(400).json({ error: 'Keep your question below 2,000 characters.' });
  try {
    const dashboard = await queries.loadDashboard(req.session.user.organization_id);
    const answer = await askGemini(message, {
      organization: dashboard.organization,
      services: dashboard.services,
      activeTickets: dashboard.tickets,
      stats: dashboard.stats,
      upcomingAppointments: dashboard.appointments
    });
    res.json({ answer });
  } catch (error) {
    const status = error.message.includes('not configured') ? 503 : 502;
    res.status(status).json({ error: error.message });
  }
});
app.get('/super-admin', requireSuperAdmin, async (req, res) => {
  try {
    const organizations = await queries.listOrganizationsForAdmin();
    res.render('super-admin', { user: req.session.user, organizations, error: null, success: null });
  } catch (error) {
    res.status(500).render('super-admin', { user: req.session.user, organizations: [], error: 'Unable to load organizations.', success: null });
  }
});
app.post('/super-admin/message', requireSuperAdmin, async (req, res) => {
  const title = String(req.body.title || '').trim() || 'System update';
  const message = String(req.body.message || '').trim();
  if (!message) {
    return res.redirect('/super-admin?error=Message+cannot+be+empty');
  }
  try {
    await queries.createSystemNotification({ title, message, userId: req.session.user.id, isGlobal: true });
    return res.redirect('/super-admin?success=Platform+message+sent');
  } catch (error) {
    return res.redirect('/super-admin?error=Unable+to+send+message');
  }
});
app.post('/super-admin/:organizationId/approve', requireSuperAdmin, async (req, res) => {
  try {
    await queries.approveOrganization(req.params.organizationId);
    res.redirect('/super-admin?success=Organization+approved');
  } catch (error) {
    res.redirect('/super-admin?error=Unable+to+approve+organization');
  }
});
app.post('/super-admin/:organizationId/reject', requireSuperAdmin, async (req, res) => {
  try {
    await queries.rejectOrganization(req.params.organizationId);
    res.redirect('/super-admin?success=Organization+rejected');
  } catch (error) {
    res.redirect('/super-admin?error=Unable+to+reject+organization');
  }
});
app.post('/super-admin/:organizationId/subscription', requireSuperAdmin, async (req, res) => {
  try {
    await queries.updateOrganizationSubscription(req.params.organizationId, req.body.subscription || 'starter');
    res.redirect('/super-admin?success=Subscription+updated');
  } catch (error) {
    res.redirect('/super-admin?error=Unable+to+update+subscription');
  }
});

app.get('/api/notifications', requireStaff, async (req, res) => {
  try {
    const notifications = await queries.listUserNotifications(req.session.user.id, req.session.user.organization_id);
    res.json({ notifications });
  } catch (error) {
    res.status(500).json({ notifications: [], error: 'Unable to load notifications.' });
  }
});

app.post('/api/notifications/read', requireStaff, async (req, res) => {
  try {
    await queries.markNotificationsRead(req.session.user.id, req.session.user.organization_id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Unable to mark notifications as read.' });
  }
});

app.get('/settings', requireAdmin, async (req, res) => {
  try {
    const org = await queries.getOrganizationSubscription(req.session.user.organization_id);
    res.render('settings', {
      user: req.session.user,
      organization: org,
      plans: subscriptionPlanList,
      error: null,
      success: null
    });
  } catch (error) {
      res.status(500).render('settings', { user: req.session.user, organization: null, plans: subscriptionPlanList, error: 'Unable to load subscription options.', success: null });
  }
});
app.post('/settings/subscription', requireAdmin, async (req, res) => {
  try {
    const org = await queries.updateOrganizationSubscription(req.session.user.organization_id, req.body.subscription || 'free_trial');
    const updatedOrg = await queries.getOrganizationSubscription(req.session.user.organization_id);
    res.render('settings', {
      user: req.session.user,
      organization: updatedOrg || org,
      plans: subscriptionPlanList,
      error: null,
      success: `Subscription updated to ${subscriptionPlanList.find((plan) => plan.key === (updatedOrg?.subscription || org?.subscription || 'free_trial'))?.label || 'trial'} .`
    });
  } catch (error) {
    res.status(400).render('settings', { user: req.session.user, organization: await queries.getOrganizationSubscription(req.session.user.organization_id), plans: subscriptionPlanList, error: error.message, success: null });
  }
});
app.post('/settings/password', requireAdmin, async (req, res) => {
  try {
    if (!req.body.newPassword || req.body.newPassword.length < 8) throw new Error('New password must be at least 8 characters.');
    await queries.changePassword(req.session.user.id, req.body.currentPassword || '', req.body.newPassword);
    const org = await queries.getOrganizationSubscription(req.session.user.organization_id);
    res.render('settings', { user: req.session.user, organization: org, plans: subscriptionPlanList, error: null, success: 'Password changed successfully.' });
  } catch (error) {
    const org = await queries.getOrganizationSubscription(req.session.user.organization_id);
    res.status(400).render('settings', { user: req.session.user, organization: org, plans: subscriptionPlanList, error: error.message, success: null });
  }
});
app.get('/staff', requireAdmin, async (req, res, next) => {
  try {
    const people = await queries.listStaffAndCounters(req.session.user.organization_id);
    res.render('staff', { user: req.session.user, ...people, inviteLink: null, error: null });
  } catch (error) {
    res.status(500).render('staff', {
      user: req.session.user,
      staff: [],
      counters: [],
      inviteLink: null,
      error: 'Staff and counters are unavailable right now. Please check the database connection.'
    });
  }
});
app.post('/staff/invitations', requireAdmin, async (req, res, next) => {
  try {
    if (!req.body.email) throw new Error('Enter a staff email address.');
    const token = await queries.createStaffInvitation(req.session.user.organization_id, req.body.email, req.body.counterId || null);
    const inviteLink = `${req.protocol}://${req.get('host')}/invite/${token}`;
    const people = await queries.listStaffAndCounters(req.session.user.organization_id);
    res.render('staff', { user: req.session.user, ...people, inviteLink, error: null });
  } catch (error) {
    const people = await queries.listStaffAndCounters(req.session.user.organization_id);
    res.status(400).render('staff', { user: req.session.user, ...people, inviteLink: null, error: error.code === '23505' ? 'That email already belongs to a user.' : error.message });
  }
});
app.post('/staff/:staffId/delete', requireAdmin, async (req, res, next) => {
  try {
    await queries.deleteStaff(req.session.user.organization_id, req.params.staffId);
    res.redirect('/staff');
  } catch (error) { next(error); }
});
app.get('/invite/:token', async (req, res) => {
  const invitation = await queries.getStaffInvitation(req.params.token);
  if (!invitation) return res.status(404).render('accept-invite', { invitation: null, error: 'This invitation is invalid or has expired.' });
  res.render('accept-invite', { invitation, error: null });
});
app.post('/invite/:token', async (req, res) => {
  try {
    if (!req.body.fullName || !req.body.password || req.body.password.length < 8) throw new Error('Enter your name and a password of at least 8 characters.');
    const user = await queries.acceptStaffInvitation(req.params.token, req.body.fullName, req.body.password);
    req.session.user = user;
    res.redirect('/dashboard');
  } catch (error) {
    const invitation = await queries.getStaffInvitation(req.params.token);
    res.status(400).render('accept-invite', { invitation, error: error.message });
  }
});
app.get('/display', async (req, res, next) => {
  try {
    const demo = await queries.loadDashboard(getRequestedOrganizationId(req));
    const serving = demo.tickets.find((ticket) => ticket.status === 'Now Serving');
    const waiting = demo.tickets.filter((ticket) => ticket.status === 'Waiting');
    res.render('display', { demo, portal: getPortalProfile(demo.organization.type), tickets: [serving, ...waiting].filter(Boolean) });
  } catch (error) { next(error); }
});
app.get('/join', async (req, res, next) => {
  try {
    const demo = await queries.loadDashboard(getRequestedOrganizationId(req));
    res.render('join', { demo, portal: getPortalProfile(demo.organization.type), ticket: null });
  } catch (error) { next(error); }
});
app.post('/join', async (req, res, next) => {
  try {
    const organizationId = req.body.organizationId || null;
    const ticket = await queries.createTicket({ customerName: req.body.customer || 'New customer', prefix: req.body.service, organizationId });
    const trackingUrl = `${req.protocol}://${req.get('host')}/ticket/${encodeURIComponent(ticket.number)}?organizationId=${encodeURIComponent(organizationId || '')}`;
    ticket.trackingUrl = trackingUrl;
    ticket.qrCode = await QRCode.toDataURL(trackingUrl, { width: 180, margin: 1 });
    io.to(organizationId ? `org:${organizationId}` : 'public').emit('queue:update', (await queries.loadDashboard(organizationId)).tickets);
    const demo = await queries.loadDashboard(organizationId);
    res.render('join', { demo, portal: getPortalProfile(demo.organization.type), ticket });
  } catch (error) { next(error); }
});
app.get('/ticket/:number', async (req, res, next) => {
  try {
    const organizationId = getRequestedOrganizationId(req);
    const ticket = await queries.getTicket(req.params.number, organizationId);
    if (!ticket) return res.status(404).send('Ticket not found');
    const demo = await queries.loadDashboard(organizationId);
    ticket.trackingUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    ticket.qrCode = await QRCode.toDataURL(ticket.trackingUrl, { width: 180, margin: 1 });
    res.render('join', { demo, portal: getPortalProfile(demo.organization.type), ticket });
  } catch (error) { next(error); }
});
app.post('/api/tickets/next', requireStaff, async (req, res, next) => {
  try {
    const ticket = await queries.callNext(req.body.counter || 'Counter 04', req.session.user.organization_id);
    if (!ticket) return res.status(404).json({ error: 'No customers waiting' });
    io.to(`org:${req.session.user.organization_id}`).emit('queue:update', (await queries.loadDashboard(req.session.user.organization_id)).tickets);
    res.json(ticket);
  } catch (error) { next(error); }
});
app.post('/api/tickets/:number/:action', requireStaff, async (req, res, next) => {
  try {
    const ticket = await queries.updateTicket(req.params.number, req.params.action, req.session.user.organization_id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    io.to(`org:${req.session.user.organization_id}`).emit('queue:update', (await queries.loadDashboard(req.session.user.organization_id)).tickets);
    res.json(ticket);
  } catch (error) { next(error); }
});
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    databaseStatus.connected = true;
    res.json({ status: 'ok', database: 'connected', initialized: databaseStatus.initialized, message: databaseStatus.message || 'Database reachable' });
  } catch (error) {
    databaseStatus.connected = false;
    databaseStatus.message = error.message;
    res.status(503).json({ status: 'error', database: 'unavailable', initialized: databaseStatus.initialized, message: error.message });
  }
});
io.on('connection', async (socket) => {
  try {
    const organizationId = socket.request.session?.user?.organization_id || socket.handshake.query.organizationId || null;
    socket.join(organizationId ? `org:${organizationId}` : 'public');
    socket.emit('queue:update', (await queries.loadDashboard(organizationId)).tickets);
  } catch (error) { socket.emit('queue:error', { message: 'Database unavailable' }); }
});
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the other process or change PORT before starting BsmartQ.`);
    process.exit(1);
  }
  throw error;
});

server.listen(port, '0.0.0.0', async () => {
  try {
    await pool.query('SELECT 1');
    databaseStatus.connected = true;
    try {
      await queries.ensureSuperAdmin();
      databaseStatus.initialized = true;
      console.log(`BsmartQ connected to PostgreSQL and is ready at http://0.0.0.0:${port}`);
    } catch (initError) {
      databaseStatus.message = initError.message;
      console.warn(`BsmartQ started without the required database bootstrap: ${initError.message}`);
      console.warn('Run "npm run db:init" once the PostgreSQL schema is available.');
    }
  }
  catch (error) {
    databaseStatus.connected = false;
    databaseStatus.message = error.message;
    console.warn(`BsmartQ started in degraded mode because PostgreSQL is unavailable: ${error.message}`);
    console.warn('The app will continue to run, but database-backed routes will return errors until PostgreSQL is reachable.');
    console.log(`BsmartQ web server is running at http://0.0.0.0:${port}`);
  }
});

app.use((req, res) => {
  res.status(404).send('Page not found');
});
