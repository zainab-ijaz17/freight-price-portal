// Small render/formatting helpers shared by every screen. No framework —
// screens build HTML strings and wire listeners after inserting them.

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Every rupee amount in the portal is whole rupees — rates, uplifts and
// the unrounded "sum with increase" alike (the exact figures stay in the
// audit trail; they're just not shown to the paisa).
export function money(n) {
  return Math.round(Number(n)).toLocaleString('en-US');
}

// Diesel price is entered and stored to 3 decimals (Section 5); shown
// with only as many as it actually has — 390.62, not 390.620.
export function priceStr(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

export function pct(n, decimals = 2) {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(decimals)}%`;
}

// A plain figure with no padding zeros: 40, 37.5.
export function trimNum(n, maxDecimals = 2) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: maxDecimals, useGrouping: false });
}

// "Imran Nisar (20005702)" for a { employeeId, name } — or just the
// number when no name is known for them.
export function personLabel(p) {
  if (!p) return '';
  if (!p.employeeId) return p.name || '';
  return p.name && p.name !== p.employeeId ? `${p.name} (${p.employeeId})` : p.employeeId;
}

export function initials(name) {
  return name.trim().split(/\s+/).slice(-1)[0].slice(0, 2).toUpperCase();
}

// --- dates ---
// One format everywhere: DD.MM.YYYY. Dates travel through the app (and
// the API) in that form; the browser's own date picker (which would show
// the OS locale's format) is only used behind a button, see dateField().

export function isoToDisplayDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function displayToIsoDate(display) {
  if (!display) return '';
  const [d, m, y] = display.split('.');
  return `${y}-${m}-${d}`;
}

export function parseDisplayDate(display) {
  const [d, m, y] = display.split('.').map(Number);
  return new Date(y, m - 1, d);
}

export function isValidDisplayDate(str) {
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(str || '')) return false;
  const [d, m, y] = str.split('.').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function formatDate(date) {
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}

export function formatDateTime(iso) {
  const date = new Date(iso);
  return `${formatDate(date)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function daysBetween(displayA, displayB) {
  const ms = parseDisplayDate(displayA) - parseDisplayDate(displayB);
  return Math.round(ms / 86400000);
}

// Accepts what people actually type — 29092026, 29/9/2026, 29-09-2026 —
// and returns it as DD.MM.YYYY, or the input unchanged if it isn't a date.
export function normalizeDate(raw) {
  const s = (raw || '').trim();
  let d, m, y;
  const digits = s.match(/^(\d{2})(\d{2})(\d{4})$/);
  const parts = s.match(/^(\d{1,2})[./\- ](\d{1,2})[./\- ](\d{4})$/);
  if (digits) [, d, m, y] = digits;
  else if (parts) [, d, m, y] = parts;
  else return s;
  const out = `${d.padStart(2, '0')}.${m.padStart(2, '0')}.${y}`;
  return isValidDisplayDate(out) ? out : s;
}

const CALENDAR_ICON = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/></svg>';

/**
 * A DD.MM.YYYY text box with a calendar button. Call wireDateFields() on
 * the container after inserting it. Read the value straight off the text
 * input (`#id`), already in DD.MM.YYYY.
 */
export function dateField(id, { value = '', min = '', compact = false, attrs = '' } = {}) {
  return `
    <span class="date-field${compact ? ' date-field-compact' : ''}">
      <input class="${compact ? 'cell-in' : 'input'} num" id="${id}" type="text" inputmode="numeric" placeholder="DD.MM.YYYY" maxlength="10" autocomplete="off" value="${escapeHtml(value || '')}" data-min="${escapeHtml(min)}" ${attrs}>
      <button type="button" class="date-btn" tabindex="-1" aria-label="Pick a date">${CALENDAR_ICON}</button>
      <input type="date" class="date-native" tabindex="-1" aria-hidden="true">
    </span>
  `;
}

export function wireDateFields(root) {
  root.querySelectorAll('.date-field').forEach((wrap) => {
    if (wrap.dataset.wired) return;
    wrap.dataset.wired = '1';
    const text = wrap.querySelector('input[type=text]');
    const native = wrap.querySelector('.date-native');
    text.addEventListener('change', () => { text.value = normalizeDate(text.value); });
    wrap.querySelector('.date-btn').addEventListener('click', () => {
      native.value = isValidDisplayDate(text.value) ? displayToIsoDate(text.value) : '';
      native.min = text.dataset.min ? displayToIsoDate(text.dataset.min) : '';
      if (native.showPicker) native.showPicker(); else native.focus();
    });
    native.addEventListener('change', () => {
      text.value = isoToDisplayDate(native.value);
      text.dispatchEvent(new Event('input', { bubbles: true }));
      text.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}

// --- errors ---
// Every error shown to a user carries a code whose prefix says where it
// came from — see server/errors.js (the same table) and ERROR_CODES.md.
const AREAS = {
  AUTH: 'Sign in',
  DSL: 'Enter diesel price',
  UPL: 'Notification attachment',
  VND: 'Select vendors',
  REV: 'Review before / after',
  APR: 'Approve and release',
  MD: 'Master data',
  CR: 'Master data requests',
  LKP: 'Rate lookup',
  ALR: 'Notifications',
  NET: 'Connection',
  SYS: 'Server',
};

export class CodedError extends Error {
  constructor(code, message, field) {
    super(message);
    this.code = code;
    this.field = field || null;
    this.where = AREAS[code.split('-')[0]] + (field ? ` › ${field}` : '');
  }
}

export function codedError(code, message, field) {
  return new CodedError(code, message, field);
}

function errorRef(err) {
  if (!err?.code) return '';
  return `Error ${err.code}${err.where ? ` · ${err.where}` : ''}`;
}

// One line, for toasts: "Message (Error DSL-003 · Enter diesel price › Effective date)".
export function errorText(err, fallback = 'Something went wrong.') {
  const ref = errorRef(err);
  return `${err?.message || fallback}${ref ? ` (${ref})` : ''}`;
}

// For inline error slots: the message, then where it happened on its own line.
export function showInlineError(el, err, fallback) {
  const ref = errorRef(err);
  el.innerHTML = `${escapeHtml(err?.message || fallback || 'Something went wrong.')}${ref ? `<div class="error-ref">${escapeHtml(ref)}</div>` : ''}`;
  el.hidden = false;
}

export function errorBanner(err, fallback, { flush = false } = {}) {
  const ref = errorRef(err);
  return `
    <div class="error-banner"${flush ? ' style="margin-top:0"' : ''}>
      <span class="error-banner-dot">●</span>
      <span>${escapeHtml(err?.message || fallback || 'Something went wrong.')}${ref ? `<span class="error-ref">${escapeHtml(ref)}</span>` : ''}</span>
    </div>
  `;
}

// --- loading / error / empty state blocks, for screens to drop into a
// container while a fetch is in flight or has failed ---

export function loadingBlock(label = 'Loading…') {
  return `<div class="state-block"><div class="spinner"></div><div class="muted">${escapeHtml(label)}</div></div>`;
}

export function errorBlock(err, { retryLabel = 'Retry' } = {}) {
  return `
    ${errorBanner(err, null, { flush: true })}
    <button class="btn btn-secondary" style="margin-top:12px" data-action="retry">${escapeHtml(retryLabel)}</button>
  `;
}

/**
 * Runs an async loader, rendering a spinner into `container` while it's in
 * flight and an error banner (with a working Retry button) if it rejects.
 * On success calls `render(data)` to draw the real screen content.
 */
export async function withAsyncState(container, loader, render, opts) {
  container.innerHTML = loadingBlock(opts?.loadingLabel);
  try {
    const data = await loader();
    render(data);
  } catch (err) {
    container.innerHTML = errorBlock(err, opts);
    container.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
      withAsyncState(container, loader, render, opts);
    });
  }
}

// --- toast ---

function toastRoot() {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    document.body.appendChild(root);
  }
  return root;
}

export function toast(message, type = 'info', timeoutMs = 4000) {
  const root = toastRoot();
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : ''}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? Math.max(timeoutMs, 7000) : timeoutMs);
}

export function toastError(err, fallback) {
  toast(errorText(err, fallback), 'error');
}

// --- dialog ---
// A single backdrop mounted once in index.html (#dialog-root). openDialog
// replaces its content and shows it; closeDialog hides it. Screens attach
// their own listeners to the buttons they render inside `bodyHtml`.

export function openDialog(bodyHtml) {
  const root = document.getElementById('dialog-root');
  root.innerHTML = `<div class="dialog-backdrop"><div class="dialog">${bodyHtml}</div></div>`;
  root.hidden = false;
  wireDateFields(root);
  return root;
}

export function closeDialog() {
  const root = document.getElementById('dialog-root');
  if (root) {
    root.hidden = true;
    root.innerHTML = '';
  }
}

// --- export ---
// "Export to Excel": a UTF-8 CSV (with BOM, so Excel reads the encoding
// right) — opens directly in Excel without any server round trip.
export function downloadCsv(fileName, rows) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
