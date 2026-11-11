// Registry API as an Express Router. Data is saved to data/registry.json (persists across restarts).
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();
router.use(express.json());

// ---- Authentication: staff sign in, token sessions (kept in memory) ----
const sessions = new Map();
router.post('/login', (req, res) => {
  const db = load(), u = db.users.find(x => x.username === String(req.body.username || '').trim().toLowerCase());
  const ok = u && crypto.timingSafeEqual(Buffer.from(hashPw(String(req.body.password || ''), u.salt)), Buffer.from(u.hash));
  if (!ok) return res.status(401).json({ error: 'Wrong username or password.' });
  const token = crypto.randomBytes(24).toString('hex'); sessions.set(token, u.username);
  actor = u.username; log(db, u.name, 'Signed in'); save(db);
  res.json({ token, name: u.name });
});
router.use((req, res, next) => { // everything below needs a valid token
  const token = (req.headers.authorization || '').replace('Bearer ', ''), user = sessions.get(token);
  if (!user) return res.status(401).json({ error: 'Please sign in.' });
  actor = user; req.token = token; next();
});
router.post('/logout', (req, res) => { sessions.delete(req.token); res.json({ ok: true }); });

const FILE = path.join(__dirname, 'data', 'registry.json');
let actor = 'system'; // staff member making the current request
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const load = () => {
  let db; try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { db = {}; }
  db.seniors ||= []; db.claims ||= []; db.audit ||= [];
  if (!db.users?.length) { // first run: create the default staff account
    const salt = crypto.randomBytes(16).toString('hex');
    db.users = [{ username: 'admin', name: 'Administrator', salt, hash: hashPw('admin123', salt) }]; save(db);
  }
  return db;
};
const save = db => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); };
const log = (db, name, action) => db.audit.unshift({ name, action, by: actor, at: new Date().toISOString() });
const nextId = list => list.reduce((m, x) => Math.max(m, x.id), 0) + 1;
const fullName = s => `${s.firstName} ${s.lastName}`;
const isToday = iso => new Date(iso).toDateString() === new Date().toDateString();

// Dashboard numbers are computed from real records.
router.get('/dashboard/stats', (req, res) => {
  const db = load(), total = db.seniors.length;
  const enrolled = db.seniors.filter(s => s.enrolled).length;
  res.json({
    registeredUsers: total,
    newThisWeek: db.seniors.filter(s => Date.now() - new Date(s.createdAt) < 7 * 864e5).length,
    biometricEnrolled: enrolled,
    enrollmentRate: total ? Math.round((enrolled / total) * 1000) / 10 : 0,
    benefitsPending: db.claims.filter(c => c.status === 'Pending').length,
    failedScansToday: db.audit.filter(a => a.action === 'Verification failed' && isToday(a.at)).length
  });
});

router.get('/activity', (req, res) => res.json(load().audit.slice(0, Number(req.query.limit) || 5)));
router.get('/audit', (req, res) => res.json(load().audit.slice(0, 200)));

router.get('/seniors', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  res.json(load().seniors.filter(s => !q || `${fullName(s)} ${s.idNumber} ${s.city}`.toLowerCase().includes(q)));
});

router.post('/seniors', (req, res) => {
  const b = req.body, req_ = ['firstName', 'lastName', 'gender', 'dob', 'address', 'city', 'idNumber', 'civilStatus'];
  const missing = req_.filter(k => !b[k] || !String(b[k]).trim());
  if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(', ')}` });
  const age = (Date.now() - new Date(b.dob)) / (365.25 * 864e5);
  if (isNaN(age) || age < 60) return res.status(400).json({ error: 'Senior must be 60 years or older.' });
  const db = load();
  if (db.seniors.some(s => s.idNumber === b.idNumber.trim())) return res.status(409).json({ error: 'This ID number is already registered.' });
  const senior = { id: nextId(db.seniors), ...Object.fromEntries(req_.concat(['middleName', 'contact', 'notes']).map(k => [k, (b[k] || '').trim()])), enrolled: false, createdAt: new Date().toISOString() };
  db.seniors.push(senior);
  log(db, fullName(senior), 'Registration completed'); save(db);
  res.status(201).json(senior);
});

router.post('/seniors/:id/enroll', (req, res) => {
  const db = load(), s = db.seniors.find(x => x.id == req.params.id);
  if (!s) return res.status(404).json({ error: 'Senior not found.' });
  s.enrolled = true; log(db, fullName(s), 'Biometrics enrolled'); save(db); res.json(s);
});

router.delete('/seniors/:id', (req, res) => {
  const db = load(), s = db.seniors.find(x => x.id == req.params.id);
  if (!s) return res.status(404).json({ error: 'Senior not found.' });
  db.seniors = db.seniors.filter(x => x !== s); db.claims = db.claims.filter(c => c.seniorId !== s.id);
  log(db, fullName(s), 'Profile deleted'); save(db); res.json({ ok: true });
});

// Identity check by ID number (fingerprint step is simulated on the client).
router.post('/verify', (req, res) => {
  const db = load(), s = db.seniors.find(x => x.idNumber === String(req.body.idNumber || '').trim());
  if (s && s.enrolled) { log(db, fullName(s), 'Identity verified'); save(db); return res.json({ verified: true, name: fullName(s) }); }
  log(db, s ? fullName(s) : 'Unknown ID', 'Verification failed'); save(db);
  res.json({ verified: false, reason: s ? 'No fingerprint enrolled for this senior.' : 'ID number not found.' });
});

router.get('/claims', (req, res) => res.json(load().claims));
router.post('/claims', (req, res) => {
  const db = load(), s = db.seniors.find(x => x.id == req.body.seniorId);
  if (!s || !req.body.type) return res.status(400).json({ error: 'Choose a senior and a benefit.' });
  const claim = { id: nextId(db.claims), seniorId: s.id, name: fullName(s), type: req.body.type, status: 'Pending', createdAt: new Date().toISOString() };
  db.claims.unshift(claim); log(db, claim.name, `${claim.type} claim filed`); save(db); res.status(201).json(claim);
});
router.patch('/claims/:id', (req, res) => {
  const db = load(), c = db.claims.find(x => x.id == req.params.id);
  if (!c || !['Approved', 'Rejected'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid request.' });
  c.status = req.body.status; log(db, c.name, `${c.type} ${c.status.toLowerCase()}`); save(db); res.json(c);
});

module.exports = router;
