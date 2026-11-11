// Shared sign-in helper. Add <script src="/js/auth.js"></script> FIRST on any page that needs a signed-in user.
(function () {
  const T = 'scms_token', U = 'scms_user';
  const Auth = window.Auth = {
    token: () => sessionStorage.getItem(T),
    user: () => JSON.parse(sessionStorage.getItem(U) || 'null'),   // { name, role, adminId }
    save(r) { sessionStorage.setItem(T, r.token); sessionStorage.setItem(U, JSON.stringify({ name: r.name, role: r.role, adminId: r.adminId })); },
    clear() { sessionStorage.removeItem(T); sessionStorage.removeItem(U); },
    async api(url, opt = {}) {
      const res = await fetch('/api' + url, { ...opt, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (Auth.token() || '') }, body: opt.body ? JSON.stringify(opt.body) : undefined });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && url !== '/login') { Auth.clear(); location.href = '/login.html'; }
      if (!res.ok) throw new Error(data.error || 'Request failed');
      return data;
    },
    async logout() { try { await Auth.api('/logout', { method: 'POST' }); } catch {} Auth.clear(); location.href = '/login.html'; },
    // Call after layout.js has built the sidebar: makes the Logout link work.
    hookLogout() { document.querySelector('.logout a')?.addEventListener('click', e => { e.preventDefault(); Auth.logout(); }); }
  };
  if (!Auth.token() && !location.pathname.endsWith('login.html')) location.replace('/login.html');
})();
