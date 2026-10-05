import { getSession, hasRole, clearSession } from '../session.js';
import { escapeHtml, initials } from '../ui.js';
import { mountAlerts, stopAlerts } from './alerts.js';
import { logout } from '../api/authApi.js';
import { forgetDraft } from '../revisionDraft.js';

// `num` only on the maintainer's three-step revision flow, where the
// order matters; everything else is just a place to go.
const NAV_ITEMS = [
  { path: '/diesel-price', num: '1', label: 'Enter diesel price', roles: ['Rate Maintainer'] },
  { path: '/vendors', num: '2', label: 'Select vendors', roles: ['Rate Maintainer'] },
  { path: '/review', num: '3', label: 'Review before / after', roles: ['Rate Maintainer'] },
  { path: '/approve', label: 'Approve and release', roles: ['Approver'] },
  { path: '/master-data-requests', label: 'Master data', roles: ['Approver'] },
  { path: '/lookup', label: 'Rate lookup', roles: ['Rate Maintainer', 'Approver', 'Display'] },
  { path: '/admin', label: 'Master data', roles: ['Administrator'] },
];

export function renderShell(appRoot, { activePath, screenTitle, roleLabel }) {
  const session = getSession();
  const items = NAV_ITEMS.filter((item) => item.roles.some((r) => hasRole(r)));

  appRoot.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div>
          <div class="sidebar-brand">Freight Rates</div>
          <div class="sidebar-sub">Diesel-indexed · PKR</div>
        </div>
        <nav class="sidebar-nav">
          ${items.map((item) => `
            <button class="rail-item${item.path === activePath ? ' active' : ''}" data-nav="${item.path}">
              <span class="rail-item-num num">${item.num || ''}</span>
              <span>${escapeHtml(item.label)}</span>
            </button>
          `).join('')}
        </nav>
      </aside>
      <main class="main">
        <header class="topbar">
          <div class="topbar-title">${escapeHtml(screenTitle || '')}</div>
          <span class="tag tag-neutral">${escapeHtml(roleLabel || '')}</span>
          <div id="alerts-slot"></div>
          <div class="row-gap">
            <span style="font-size:13px">${escapeHtml(session?.name || '')}</span>
            <span class="avatar">${escapeHtml(session ? initials(session.name) : '')}</span>
          </div>
          <button class="btn btn-ghost" data-action="logout">Log out</button>
        </header>
        <div class="screen" id="screen-root"></div>
      </main>
    </div>
  `;

  appRoot.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => { location.hash = '#' + btn.dataset.nav; });
  });
  appRoot.querySelector('[data-action="logout"]').addEventListener('click', async () => {
    stopAlerts();
    await forgetDraft(); // saves any unsaved draft change first, while still signed in
    logout().catch(() => {}); // ends it server-side; it expires on its own if this fails
    clearSession();
    location.hash = '#/login';
  });
  mountAlerts(appRoot.querySelector('#alerts-slot'));
}
