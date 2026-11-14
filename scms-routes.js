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


/* ============================================================
   MANAGE SENIOR PROFILE (SCMS-UC005)
   Search, view and edit a senior's profile. Edits also write an
   'Update Profile' row to audit_log inside the same transaction.
   NOTE: /seniors/search and /seniors/barangays must stay ABOVE /seniors/:id.
   ============================================================ */
const SENIOR_ID_RE = /^[A-Za-z0-9-]{1,15}$/;
const PROFILE_STATUSES = ['Active', 'Inactive', 'Deceased'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Field groups: used to build the audit description (field names only, never values)
const FIELD_GROUPS = [
  ['personal information', ['first_name', 'middle_name', 'last_name', 'sex', 'date_of_birth', 'civil_status']],
  ['contact information', ['mobile_number', 'email']],
  ['address', ['street_address', 'barangay', 'city_municipality']],
  ['emergency contact', ['emergency_contact', 'emergency_relationship']]
];

// Profile query. Dates are formatted in SQL so time zones can never shift them.
const SENIOR_SELECT = `
  SELECT s.senior_id, s.first_name, s.middle_name, s.last_name, s.sex,
         to_char(s.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
         EXTRACT(YEAR FROM age(s.date_of_birth))::int AS age,
         s.civil_status, s.national_id, s.mobile_number, s.email,
         s.street_address, s.barangay, s.city_municipality,
         s.emergency_contact, s.emergency_relationship, s.status, s.notes,
         to_char(s.registered_on, 'FMMonth FMDD, YYYY') AS registered_on,
         to_char(s.last_updated, 'FMMonth FMDD, YYYY') AS last_updated,
         COALESCE((SELECT f.enrollment_status FROM fingerprint f
                   WHERE f.senior_id = s.senior_id
                   ORDER BY (f.enrollment_status = 'Enrolled') DESC, f.fingerprint_id DESC
                   LIMIT 1), 'Not enrolled') AS fingerprint_status
  FROM senior_citizen s`;

// Validates and cleans the edit form. Returns { v: cleanValues, errors: { field: message } }
function validateProfile(b) {
  const t = k => String(b[k] ?? '').trim();
  const v = {
    first_name: t('first_name'), middle_name: t('middle_name'), last_name: t('last_name'),
    sex: t('sex'), date_of_birth: t('date_of_birth'), civil_status: t('civil_status'),
    mobile_number: t('mobile_number').replace(/[\s-]/g, ''), email: t('email'),
    street_address: t('street_address'), barangay: t('barangay'), city_municipality: t('city_municipality'),
    emergency_contact: t('emergency_contact'), emergency_relationship: t('emergency_relationship'),
    status: t('status')
  };
  if (/^n\/?a$/i.test(v.middle_name)) v.middle_name = ''; // "N/A" means no middle name

  const errors = {};
  const required = {
    first_name: 'First name', last_name: 'Last name', sex: 'Sex', date_of_birth: 'Date of birth',
    civil_status: 'Civil status', street_address: 'Street address', barangay: 'Barangay',
    city_municipality: 'City / municipality', emergency_contact: 'Emergency contact', status: 'Status'
  };
  const maxLen = {
    first_name: 50, middle_name: 50, last_name: 50, civil_status: 20, email: 100,
    street_address: 100, barangay: 50, city_municipality: 50, emergency_contact: 100,
    emergency_relationship: 30
  };
  for (const [k, label] of Object.entries(required)) if (!v[k]) errors[k] = `${label} is required.`;
  for (const [k, n] of Object.entries(maxLen)) if (!errors[k] && v[k].length > n) errors[k] = `Maximum ${n} characters.`;

  if (!errors.sex && !['Male', 'Female'].includes(v.sex)) errors.sex = 'Select Male or Female.';
  if (!errors.status && !PROFILE_STATUSES.includes(v.status)) errors.status = 'Select Active, Inactive or Deceased.';
  if (v.mobile_number && !/^[0-9]{11}$/.test(v.mobile_number)) errors.mobile_number = 'Enter a valid 11-digit mobile number.';
  if (v.email && !errors.email && !EMAIL_RE.test(v.email)) errors.email = 'Enter a valid email address.';

  if (!errors.date_of_birth) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.date_of_birth);
    let valid = false;
    if (m) {
      const y = +m[1], mo = +m[2], d = +m[3], dt = new Date(Date.UTC(y, mo - 1, d));
      valid = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
      if (valid) {
        const now = new Date();
        let age = now.getFullYear() - y;
        if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age--;
        if (age < 60) errors.date_of_birth = 'Senior must be 60 years or older.';
      }
    }
    if (!valid) errors.date_of_birth = 'Enter a valid date of birth.';
  }
  return { v, errors };
}

/* ---------- Search ---------- */
// GET /api/seniors/search?q=maria santos&barangay=Poblacion
router.get('/seniors/search', auth(), async (req, res) => {
  const q = String(req.query.q || '').replace(/,/g, ' ').trim().replace(/\s+/g, ' ');
  const barangay = String(req.query.barangay || '').trim();
  if (!q && !barangay) return res.status(400).json({ error: 'Enter a name or Senior ID to search.' });
  if (q.length > 100 || barangay.length > 50) return res.status(400).json({ error: 'Search text is too long.' });
  const pattern = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null; // escape LIKE wildcards
  try {
    const r = await pool.query(
      `SELECT senior_id, first_name, middle_name, last_name,
              EXTRACT(YEAR FROM age(date_of_birth))::int AS age, barangay, status
       FROM senior_citizen
       WHERE ($1::text IS NULL
              OR senior_id ILIKE $1
              OR CONCAT_WS(' ', first_name, NULLIF(middle_name, ''), last_name) ILIKE $1
              OR CONCAT_WS(' ', first_name, last_name) ILIKE $1
              OR CONCAT_WS(' ', last_name, first_name) ILIKE $1)
         AND ($2::text IS NULL OR barangay = $2)
       ORDER BY last_name, first_name, senior_id
       LIMIT 50`,
      [pattern, barangay || null]);
    res.json({ seniors: r.rows });
  } catch (e) { fail(res, e, 'Search failed. Please try again.'); }
});

// GET /api/seniors/barangays  (fills the barangay filter / suggestions)
router.get('/seniors/barangays', auth(), async (req, res) => {
  try {
    const r = await pool.query('SELECT DISTINCT barangay FROM senior_citizen ORDER BY barangay');
    res.json({ barangays: r.rows.map(x => x.barangay) });
  } catch (e) { fail(res, e, 'Could not load barangays.'); }
});

/* ---------- View one profile ---------- */
// GET /api/seniors/SC-2026-00001
router.get('/seniors/:id', auth(), async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!SENIOR_ID_RE.test(id)) return res.status(404).json({ error: 'Record not found.' });
  try {
    const r = await pool.query(`${SENIOR_SELECT} WHERE s.senior_id = $1`, [id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Record not found.' });
    res.json({ senior: r.rows[0] });
  } catch (e) { fail(res, e, 'Could not load the profile.'); }
});

/* ---------- Update profile + audit log ---------- */
// PUT /api/seniors/SC-2026-00001   body: the edit-form fields
router.put('/seniors/:id', auth('Admin', 'Registration Staff'), async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!SENIOR_ID_RE.test(id)) return res.status(404).json({ error: 'Record not found.' });

  const { v, errors } = validateProfile(req.body || {});
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please correct the highlighted fields before saving.', fields: errors });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the row so two admins cannot overwrite each other at the same moment
    const cur = (await client.query(
      `SELECT first_name, middle_name, last_name, sex, to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
              civil_status, mobile_number, email, street_address, barangay, city_municipality,
              emergency_contact, emergency_relationship, status
       FROM senior_citizen WHERE senior_id = $1 FOR UPDATE`, [id])).rows[0];
    if (!cur) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Record not found.' });
    }

    // Work out what actually changed (for the audit description)
    const same = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();
    const changed = FIELD_GROUPS
      .filter(([, keys]) => keys.some(k => !same(cur[k], v[k])))
      .map(([label]) => label);
    if (!same(cur.status, v.status)) changed.push(`status (${cur.status} to ${v.status})`);

    // Nothing changed: do not touch last_updated and do not write an audit row
    if (!changed.length) {
      const same_row = (await client.query(`${SENIOR_SELECT} WHERE s.senior_id = $1`, [id])).rows[0];
      await client.query('ROLLBACK');
      return res.json({ success: true, changed: false, senior: same_row });
    }

    await client.query(
      `UPDATE senior_citizen
       SET first_name = $2, middle_name = $3, last_name = $4, sex = $5, date_of_birth = $6,
           civil_status = $7, mobile_number = $8, email = $9, street_address = $10,
           barangay = $11, city_municipality = $12, emergency_contact = $13,
           emergency_relationship = $14, status = $15, last_updated = CURRENT_TIMESTAMP
       WHERE senior_id = $1`,
      [id, v.first_name, v.middle_name || null, v.last_name, v.sex, v.date_of_birth,
       v.civil_status, v.mobile_number || null, v.email || null, v.street_address,
       v.barangay, v.city_municipality, v.emergency_contact,
       v.emergency_relationship || null, v.status]);

    await client.query(
      `INSERT INTO audit_log (admin_id, senior_id, action_type, description, result_status)
       VALUES ($1, $2, 'Update Profile', $3, 'Success')`,
      [req.admin.adminId, id, ('Updated ' + changed.join(', ')).slice(0, 200)]);

    const senior = (await client.query(`${SENIOR_SELECT} WHERE s.senior_id = $1`, [id])).rows[0];
    await client.query('COMMIT');
    res.json({ success: true, changed: true, senior });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23514') { // a database CHECK constraint rejected a value
      return res.status(400).json({ error: 'A value is not allowed by the database. Please check your entries.' });
    }
    fail(res, e, 'Could not save the changes. Nothing was updated.');
  } finally { client.release(); }
});

module.exports = router;
