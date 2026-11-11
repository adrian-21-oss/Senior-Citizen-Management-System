// Login, Register Senior, Biometric Enrollment and Dashboard API (PostgreSQL).
// Mount in server.js:  app.use('/api', require('./scms-routes'));
// Only the routes below are protected, so teammates' routes (/api/benefits/*) are not affected.
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER, host: process.env.DB_HOST, database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD, port: process.env.DB_PORT
});
const router = express.Router();
router.use(express.json());

/* ---------- Sessions & passwords ---------- */
const sessions = new Map(); // token -> { adminId, name, role, exp }  (cleared when the server restarts)
const TTL = 8 * 3600e3;

// Stored format: scrypt$<salt>$<hash>. Create accounts with scripts/create-admin.js
function verifyPw(pw, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const a = crypto.scryptSync(pw, salt, 32), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const audit = (adminId, seniorId, type, desc, ok = true) =>
  pool.query('INSERT INTO audit_log (admin_id, senior_id, action_type, description, result_status) VALUES ($1,$2,$3,$4,$5)',
    [adminId, seniorId, type, desc, ok ? 'Success' : 'Failed']).catch(e => console.error('audit_log:', e.message));

// auth() = any signed-in staff; auth('Admin','Registration Staff') = only those roles. Sets req.admin.
const auth = (...roles) => (req, res, next) => {
  const token = (req.headers.authorization || '').replace('Bearer ', ''), s = sessions.get(token);
  if (!s || s.exp < Date.now()) { sessions.delete(token); return res.status(401).json({ error: 'Please sign in.' }); }
  if (roles.length && !roles.includes(s.role)) return res.status(403).json({ error: 'Your role cannot do this.' });
  req.admin = s; req.token = token; next();
};
const fail = (res, e, msg) => { console.error(e); res.status(500).json({ error: msg }); };

/* ---------- Login / logout ---------- */
router.post('/login', async (req, res) => {
  try {
    const u = String(req.body.username || '').trim(), p = String(req.body.password || '');
    const a = (await pool.query('SELECT admin_id, full_name, password_hash, role, status FROM admin_user WHERE username = $1', [u])).rows[0];
    if (!a || !verifyPw(p, a.password_hash)) {
      if (a) await audit(a.admin_id, null, 'Login', 'Failed sign-in attempt', false);
      return res.status(401).json({ error: 'Wrong username or password.' });
    }
    if (a.status !== 'ACTIVE') return res.status(403).json({ error: 'This account is inactive.' });
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { adminId: a.admin_id, name: a.full_name, role: a.role, exp: Date.now() + TTL });
    await audit(a.admin_id, null, 'Login', `${a.full_name} signed in`);
    res.json({ token, name: a.full_name, role: a.role, adminId: a.admin_id });
  } catch (e) { fail(res, e, 'Login failed. Check the database connection.'); }
});
router.post('/logout', auth(), async (req, res) => {
  await audit(req.admin.adminId, null, 'Logout', `${req.admin.name} signed out`);
  sessions.delete(req.token); res.json({ ok: true });
});
router.get('/me', auth(), (req, res) => res.json(req.admin));

/* ---------- Dashboard ---------- */
router.get('/dashboard/stats', auth(), async (req, res) => {
  try {
    const one = sql => pool.query(sql).then(r => r.rows[0]);
    const [a, b, c, d] = await Promise.all([
      one("SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE registered_on > NOW() - INTERVAL '7 days')::int week FROM senior_citizen"),
      one("SELECT COUNT(*)::int n FROM fingerprint WHERE enrollment_status = 'Enrolled'"),
      one("SELECT COUNT(*)::int n FROM benefit_transaction WHERE claim_status = 'Available' AND benefit_year = EXTRACT(YEAR FROM CURRENT_DATE)::int"),
      one("SELECT COUNT(*)::int n FROM audit_log WHERE action_type = 'Biometric Enrollment' AND result_status = 'Failed' AND action_datetime::date = CURRENT_DATE")
    ]);
    res.json({ registered: a.total, newThisWeek: a.week, enrolled: b.n,
      enrollmentRate: a.total ? Math.round((b.n / a.total) * 1000) / 10 : 0, benefitsPending: c.n, failedScans: d.n });
  } catch (e) { fail(res, e, 'Could not load dashboard numbers.'); }
});
router.get('/dashboard/activity', auth(), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT COALESCE(CONCAT_WS(' ', s.first_name, s.last_name), u.full_name) AS name,
              l.description AS action, l.result_status AS result, l.action_datetime AS at
       FROM audit_log l JOIN admin_user u ON u.admin_id = l.admin_id
       LEFT JOIN senior_citizen s ON s.senior_id = l.senior_id
       ORDER BY l.action_datetime DESC LIMIT 5`);
    res.json(r.rows);
  } catch (e) { fail(res, e, 'Could not load activity.'); }
});

/* ---------- Register Senior ---------- */
router.post('/seniors', auth('Admin', 'Registration Staff'), async (req, res) => {
  const b = req.body, t = k => String(b[k] ?? '').trim(), opt = k => t(k) || null;
  const need = ['first_name', 'last_name', 'sex', 'date_of_birth', 'civil_status', 'street_address', 'barangay', 'city_municipality', 'emergency_contact'];
  const miss = need.filter(k => !t(k));
  if (miss.length) return res.status(400).json({ error: `Fill in: ${miss.join(', ').replace(/_/g, ' ')}.` });
  if (!['Male', 'Female'].includes(t('sex'))) return res.status(400).json({ error: 'Sex must be Male or Female.' });
  if (t('mobile_number') && !/^[0-9]{11}$/.test(t('mobile_number'))) return res.status(400).json({ error: 'Mobile number must be 11 digits.' });
  const dob = new Date(t('date_of_birth')), now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  if (now < new Date(now.getFullYear(), dob.getMonth(), dob.getDate())) age--;
  if (isNaN(dob) || age < 60) return res.status(400).json({ error: 'Senior must be 60 years or older.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (t('national_id') && (await client.query('SELECT 1 FROM senior_citizen WHERE national_id = $1', [t('national_id')])).rowCount)
      throw Object.assign(new Error('This ID number is already registered.'), { status: 409 });
    const r = await client.query(
      `INSERT INTO senior_citizen (first_name, middle_name, last_name, sex, date_of_birth, civil_status, national_id, mobile_number,
         email, street_address, barangay, city_municipality, emergency_contact, emergency_relationship, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING senior_id`,
      [t('first_name'), opt('middle_name'), t('last_name'), t('sex'), t('date_of_birth'), t('civil_status'), opt('national_id'), opt('mobile_number'),
       opt('email'), t('street_address'), t('barangay'), t('city_municipality'), t('emergency_contact'), opt('emergency_relationship'), opt('notes')]);
    const id = r.rows[0].senior_id;
    await client.query('INSERT INTO fingerprint (senior_id) VALUES ($1)', [id]); // status Pending until scanned
    await client.query(`INSERT INTO audit_log (admin_id, senior_id, action_type, description, result_status) VALUES ($1,$2,'Register Senior',$3,'Success')`,
      [req.admin.adminId, id, `Registered ${t('first_name')} ${t('last_name')}`]);
    await client.query('COMMIT');
    res.status(201).json({ senior_id: id });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.status) return res.status(e.status).json({ error: e.message });
    fail(res, e, 'Could not save. Nothing was registered.');
  } finally { client.release(); }
});

/* ---------- Biometric enrollment ---------- */
// The scanner step is simulated: template_data gets random bytes. Replace crypto.randomBytes(512)
// with the template from the real scanner SDK when the device is available.
router.post('/seniors/:id/biometric', auth('Admin', 'Registration Staff'), async (req, res) => {
  try {
    const id = req.params.id;
    const r = await pool.query(
      `UPDATE fingerprint SET template_data = $2, finger_used = $3, enrollment_status = 'Enrolled', enrolled_on = NOW()
       WHERE senior_id = $1 AND enrollment_status = 'Pending' RETURNING fingerprint_id`,
      [id, crypto.randomBytes(512), String(req.body.finger || 'Right Index')]);
    if (!r.rowCount) {
      await audit(req.admin.adminId, id, 'Biometric Enrollment', 'Enrollment failed: no pending fingerprint record', false);
      return res.status(409).json({ error: 'No pending fingerprint record for this senior.' });
    }
    await audit(req.admin.adminId, id, 'Biometric Enrollment', 'Fingerprint enrolled');
    res.json({ ok: true });
  } catch (e) { fail(res, e, 'Could not save the fingerprint.'); }
});

module.exports = router;
