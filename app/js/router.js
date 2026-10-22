// Minimal hash router. Each route maps to a screen module exposing
// `mount(container, { params, query })`; the router owns swapping screens
// in and out of #screen-root and enforcing the login/role gate.
import { isAuthenticated, hasRole, getSession } from './session.js';
import { renderShell } from './components/shell.js';

const routes = [];
let notFoundRoute = null;
let currentCleanup = null;

/**
 * @param {string} path - e.g. '/diesel-price'
 * @param {object} screen - module with a `mount(container, ctx)` export
 * @param {object} [opts]
 * @param {boolean} [opts.public] - skip the login gate (only used by /login)
 * @param {string[]} [opts.roles] - roles allowed to view this route
 */
export function registerRoute(path, screen, opts = {}) {
  routes.push({ path, screen, ...opts });
}

export function registerNotFound(screen) {
  notFoundRoute = screen;
}

function matchRoute(hash) {
  const path = hash.replace(/^#/, '').split('?')[0] || '/';
  return routes.find((r) => r.path === path);
}

function parseQuery(hash) {
  const q = hash.split('?')[1];
  return Object.fromEntries(new URLSearchParams(q || ''));
}

// Where a logged-in user should land with no route (or one they can't see).
export function defaultRouteForSession() {
  const session = getSession();
  if (!session) return '#/login';
  if (session.role === 'Approver') return '#/approve';
  if (session.role === 'Display') return '#/lookup';
  return '#/diesel-price';
}

async function renderCurrentRoute() {
  const hash = location.hash || '#/';
  const route = matchRoute(hash);

  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }

  if (!route) {
    if (location.hash) return; // avoid loops if notFound itself redirects
    location.hash = defaultRouteForSession();
    return;
  }

  if (!route.public && !isAuthenticated()) {
    location.hash = '#/login';
    return;
  }
  if (route.public && isAuthenticated()) {
    location.hash = defaultRouteForSession();
    return;
  }
  if (route.roles && !route.roles.some((r) => hasRole(r))) {
    location.hash = defaultRouteForSession();
    return;
  }

  const appRoot = document.getElementById('app-root');
  const ctx = { query: parseQuery(hash) };

  if (route.public) {
    appRoot.innerHTML = '<div id="screen-root"></div>';
    currentCleanup = await route.screen.mount(document.getElementById('screen-root'), ctx);
    return;
  }

  renderShell(appRoot, {
    activePath: route.path,
    screenTitle: route.screen.title,
    roleLabel: getSession().role,
    showDieselCard: `#${route.path}` === defaultRouteForSession(),
  });
  const screenRoot = document.getElementById('screen-root');
  currentCleanup = await route.screen.mount(screenRoot, ctx);
}

export function navigate(path) {
  location.hash = path;
}

export function startRouter() {
  window.addEventListener('hashchange', renderCurrentRoute);
  renderCurrentRoute();
}
