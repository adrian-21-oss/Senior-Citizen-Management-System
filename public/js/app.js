// Senior Citizen Registry - frontend (vanilla JS). All data comes from /api.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = iso => { const d = Math.floor((Date.now() - new Date(iso)) / 864e5); return d < 1 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`; };

async function api(url, opt = {}) {
  const res = await fetch('/api' + url, { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sessionStorage.getItem('token') || '') }, ...opt, body: opt.body ? JSON.stringify(opt.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/login') showLogin();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000); }
const fill = (id, rows, cols) => { $(id).innerHTML = rows || `<tr><td colspan="${cols}" class="muted">Nothing here yet.</td></tr>`; };
const failed = id => ($(id).innerHTML = '<tr><td colspan="5" class="muted">Could not load data. Is the server running?</td></tr>');

/* ---------- Navigation ---------- */
const loaders = { dashboard: loadDashboard, benefits: loadBenefits, profiles: loadProfiles, audit: loadAudit };
function showView(name) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  $$('.nav-link[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  loaders[name]?.();
}
document.addEventListener('click', e => { const el = e.target.closest('[data-view]'); if (el) showView(el.dataset.view); });
/* ---------- Sign in / out ---------- */
function showLogin() { sessionStorage.removeItem('token'); $('#login').classList.add('show'); $('#login-user').focus(); }
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const r = await api('/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    sessionStorage.setItem('token', r.token); $('#login').classList.remove('show'); $('#login-err').textContent = ''; e.target.reset();
    toast(`Welcome, ${r.name}`); showView('dashboard');
  } catch (err) { $('#login-err').textContent = err.message; }
});
$('#logout').addEventListener('click', () => api('/logout', { method: 'POST' }).catch(() => {}).finally(showLogin));

/* ---------- Dashboard ---------- */
async function loadDashboard() {
  try {
    const [s, act] = await Promise.all([api('/dashboard/stats'), api('/activity?limit=5')]);
    $('#m-users').textContent = s.registeredUsers.toLocaleString();
    $('#m-users-sub').textContent = `${s.newThisWeek} new registrations this week`;
    $('#m-bio').textContent = s.biometricEnrolled.toLocaleString();
    $('#m-bio-sub').textContent = `${s.enrollmentRate}% of registered users enrolled`;
    $('#m-ben').textContent = s.benefitsPending;
    $('#m-ben-sub').textContent = 'Claims awaiting review';
    $('#m-fail').textContent = s.failedScansToday;
    fill('#activity-body', act.map(a => `<tr><td>${esc(a.name)}</td><td>${esc(a.action)}</td><td>${ago(a.at)}</td></tr>`).join(''), 3);
  } catch { failed('#activity-body'); }
}
// Verify identity: ask for the ID number, simulate the scan, then check the registry.
$('#verify').addEventListener('click', async () => {
  const idNumber = prompt('Enter the senior\'s National ID / Passport number:');
  if (!idNumber) return;
  toast('Scanning fingerprint…');
  await new Promise(r => setTimeout(r, 1500));
  try {
    const r = await api('/verify', { method: 'POST', body: { idNumber } });
    toast(r.verified ? `Identity verified: ${r.name}` : `Verification failed. ${r.reason}`);
    loadDashboard();
  } catch (e) { toast(e.message); }
});

/* ---------- Register + biometric enrollment ---------- */
const form = $('#register-form');
const REQUIRED = ['firstName', 'lastName', 'gender', 'dob', 'address', 'city', 'idNumber', 'civilStatus'];
const DEFAULT_MSG = 'Required fields must be completed before initiating fingerprint scan.';
let savedId = null; // id of the senior saved in this session, waiting for a fingerprint
const setMsg = (t, err = false) => { const m = $('#form-msg'); m.textContent = t; m.classList.toggle('error', err); };
const setFp = (state, text) => { $('#fp-box').className = `fingerprint ${state}`; $('#fp-text').textContent = text; };

function validate() {
  let ok = true;
  REQUIRED.forEach(n => { const f = form.elements[n], bad = !f.value.trim(); f.classList.toggle('invalid', bad); if (bad) ok = false; });
  return ok;
}
form.addEventListener('input', e => e.target.classList.remove('invalid'));
form.addEventListener('reset', () => { $$('.invalid', form).forEach(f => f.classList.remove('invalid')); savedId = null; setFp('', 'Ready for fingerprint capture'); setMsg(DEFAULT_MSG); });
form.addEventListener('submit', async e => {
  e.preventDefault();
  if (!validate()) return setMsg('Fill in the highlighted fields.', true);
  try {
    const s = await api('/seniors', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
    savedId = s.id; setMsg('Profile saved. Capture the fingerprint to finish.'); setFp('', 'Profile saved. Ready to scan'); toast('Profile saved');
  } catch (err) { setMsg(err.message, true); }
});
// Fingerprint scanner hardware is not connected: the scan is simulated, then enrollment is saved for real.
$('#scan-btn').addEventListener('click', async () => {
  if (!savedId) return setMsg('Save the profile first, then scan.', true);
  const btn = $('#scan-btn'); btn.disabled = true; setFp('scanning', 'Scanning…');
  await new Promise(r => setTimeout(r, 1500));
  try { await api(`/seniors/${savedId}/enroll`, { method: 'POST' }); setFp('done', 'Fingerprint enrolled'); toast('Senior registered and enrolled'); setTimeout(() => { form.reset(); showView('dashboard'); }, 900); }
  catch (err) { setFp('', 'Scan failed'); setMsg(err.message, true); }
  btn.disabled = false;
});

/* ---------- Process Benefits ---------- */
const badge = s => `<span class="badge ${s === 'Approved' ? 'ok' : s === 'Rejected' ? 'bad' : ''}">${esc(s)}</span>`;
async function loadBenefits() {
  try {
    const [seniors, claims] = await Promise.all([api('/seniors'), api('/claims')]);
    $('#claim-senior').innerHTML = seniors.map(s => `<option value="${s.id}">${esc(s.firstName)} ${esc(s.lastName)} (${esc(s.idNumber)})</option>`).join('') || '<option value="">Register a senior first</option>';
    fill('#claims-body', claims.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.type)}</td><td>${badge(c.status)}</td><td>${ago(c.createdAt)}</td>
      <td>${c.status === 'Pending' ? `<div class="row-actions"><button class="btn btn-dark btn-sm" data-claim="${c.id}" data-status="Approved">Approve</button><button class="btn btn-danger btn-sm" data-claim="${c.id}" data-status="Rejected">Reject</button></div>` : ''}</td></tr>`).join(''), 5);
  } catch { failed('#claims-body'); }
}
$('#claim-form').addEventListener('submit', async e => {
  e.preventDefault();
  try { await api('/claims', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Claim filed'); loadBenefits(); } catch (err) { toast(err.message); }
});
$('#claims-body').addEventListener('click', async e => {
  const b = e.target.closest('[data-claim]'); if (!b) return;
  try { await api(`/claims/${b.dataset.claim}`, { method: 'PATCH', body: { status: b.dataset.status } }); toast(`Claim ${b.dataset.status.toLowerCase()}`); loadBenefits(); } catch (err) { toast(err.message); }
});

/* ---------- Manage Profiles ---------- */
async function loadProfiles() {
  try {
    const rows = await api('/seniors?q=' + encodeURIComponent($('#search').value));
    fill('#profiles-body', rows.map(s => `<tr><td>${esc(s.firstName)} ${esc(s.lastName)}</td><td>${esc(s.idNumber)}</td><td>${esc(s.city)}</td>
      <td>${s.enrolled ? '<span class="badge ok">Enrolled</span>' : '<span class="badge">Not enrolled</span>'}</td>
      <td><div class="row-actions">${s.enrolled ? '' : `<button class="btn btn-dark btn-sm" data-enroll="${s.id}">Enroll</button>`}<button class="btn btn-danger btn-sm" data-del="${s.id}">Delete</button></div></td></tr>`).join(''), 5);
  } catch { failed('#profiles-body'); }
}
let timer; $('#search').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(loadProfiles, 250); });
$('#profiles-body').addEventListener('click', async e => {
  const en = e.target.closest('[data-enroll]'), del = e.target.closest('[data-del]');
  try {
    if (en) { toast('Scanning fingerprint…'); await new Promise(r => setTimeout(r, 1200)); await api(`/seniors/${en.dataset.enroll}/enroll`, { method: 'POST' }); toast('Fingerprint enrolled'); }
    else if (del && confirm('Delete this profile and its claims? This cannot be undone.')) { await api(`/seniors/${del.dataset.del}`, { method: 'DELETE' }); toast('Profile deleted'); }
    else return;
    loadProfiles();
  } catch (err) { toast(err.message); }
});

/* ---------- Audit Reports ---------- */
async function loadAudit() {
  try {
    const rows = await api('/audit');
    fill('#audit-body', rows.map(a => `<tr><td>${esc(a.name)}</td><td>${esc(a.action)}</td><td>${new Date(a.at).toLocaleString()}</td><td>${esc(a.by)}</td></tr>`).join(''), 4);
  } catch { failed('#audit-body'); }
}

sessionStorage.getItem('token') ? loadDashboard() : showLogin();
