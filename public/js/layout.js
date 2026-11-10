// ============================================================
// SENIOR CITIZEN SYSTEM: SHARED LAYOUT SCRIPT
// Builds the sidebar and the page header on every page.
//
// To add or rename a menu item, edit the NAV list below. ONE place, all pages.
// ============================================================
(function () {
  const NAV = [
    { id: 'dashboard', label: 'Dashboard',        href: '/index.html' },
    { id: 'register',  label: 'Register Senior',  href: '/register_citizen.html' },
    { id: 'benefits',  label: 'Process Benefits', href: '/process_benefit.html' },
    { id: 'profiles',  label: 'Manage Profiles',  href: '/manage_profiles.html' },   // rename to match your file
    { id: 'reports',   label: 'Audit Reports',    href: '/audit_reports.html' }      // rename to match your file
  ];
  const LOGOUT_URL = '#'; // TODO: point to the login page / logout route once it exists

  const { page, title, subtitle } = document.body.dataset;

  // ----- Sidebar -----
  const links = NAV.map(item =>
    `<a href="${item.href}"${item.id === page ? ' class="active" aria-current="page"' : ''}>${item.label}</a>`
  ).join('');

  document.body.insertAdjacentHTML('afterbegin', `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">S</div>
        <div><strong>Senior Citizen System</strong><span>Senior Registry</span></div>
      </div>
      <nav class="nav" aria-label="Main">${links}</nav>
      <nav class="nav logout" aria-label="Account"><a href="${LOGOUT_URL}">Logout</a></nav>
    </aside>`);

  // ----- Page header (title + subtitle come from <body data-title / data-subtitle>) -----
  const main = document.querySelector('main');
  if (main && title) {
    const head = document.createElement('div');
    head.className = 'page-head';

    const text = document.createElement('div');
    const h1 = document.createElement('h1');
    h1.textContent = title;
    text.appendChild(h1);
    if (subtitle) {
      const p = document.createElement('p');
      p.className = 'sub';
      p.textContent = subtitle;
      text.appendChild(p);
    }

    const badge = document.createElement('span');
    badge.className = 'badge-official';
    badge.textContent = 'Official Registry';

    head.append(text, badge);
    main.prepend(head);
  }
})();