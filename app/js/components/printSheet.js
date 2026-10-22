// Printable sheets: a plain black-on-white document (A4 landscape) built
// from the data on screen, printed through the browser's own dialog — which
// also offers "Save as PDF". While it prints, everything else on the page
// is hidden (see #print-root in app.css).
import { getSession } from '../session.js';
import { escapeHtml, personLabel, formatDateTime } from '../ui.js';

const ORG = 'Packages Limited · Freight Rate Portal';

/** Prints `bodyHtml` (built from the helpers below); `title` names the PDF if saved. */
export function printDocument(title, bodyHtml) {
  let root = document.getElementById('print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'print-root';
    document.body.appendChild(root);
  }
  const session = getSession();
  root.innerHTML = `
    <div class="print-doc">
      ${bodyHtml}
      <div class="print-footer">Printed by ${escapeHtml(personLabel(session))} on ${escapeHtml(formatDateTime(new Date().toISOString()))}</div>
    </div>`;
  const pageTitle = document.title;
  document.title = title;
  document.body.classList.add('printing');
  const done = () => {
    window.removeEventListener('afterprint', done);
    document.body.classList.remove('printing');
    document.title = pageTitle;
    root.innerHTML = '';
  };
  window.addEventListener('afterprint', done);
  window.print();
}

/** One sheet; each starts on a new page. `meta` is a list of plain-text lines. */
export function printSheet({ title, subtitle = '', meta = [], tableHtml = '', afterHtml = '' }) {
  return `
    <section class="print-sheet">
      <div class="print-org">${escapeHtml(ORG)}</div>
      <h1 class="print-title">${escapeHtml(title)}</h1>
      ${subtitle ? `<div class="print-subtitle">${escapeHtml(subtitle)}</div>` : ''}
      ${meta.length ? `<div class="print-meta">${meta.map((m) => `<div>${escapeHtml(m)}</div>`).join('')}</div>` : ''}
      ${tableHtml}
      ${afterHtml}
    </section>`;
}

/**
 * `head`: rows of header cells, each a string or { text, colspan, align }.
 * `body`: rows of cells, each a string/number or { text, align, strong }.
 */
export function printTable(head, body) {
  const cell = (tag, c) => {
    const o = typeof c === 'object' && c !== null ? c : { text: c };
    const attrs = `${o.colspan ? ` colspan="${o.colspan}"` : ''}${o.align ? ` style="text-align:${o.align}"` : ''}`;
    const text = escapeHtml(o.text ?? '');
    return `<${tag}${attrs}>${o.strong ? `<strong>${text}</strong>` : text}</${tag}>`;
  };
  return `
    <table class="print-table">
      <thead>${head.map((r) => `<tr>${r.map((c) => cell('th', c)).join('')}</tr>`).join('')}</thead>
      <tbody>${body.map((r) => `<tr>${r.map((c) => cell('td', c)).join('')}</tr>`).join('')}</tbody>
    </table>`;
}

/** Signature boxes: [{ label, name, date }] — blank lines where not known. */
export function printSignatures(boxes) {
  return `
    <div class="print-signatures">
      ${boxes.map((b) => `
        <div class="print-signature">
          <div class="print-signature-line"></div>
          <div><strong>${escapeHtml(b.label)}</strong></div>
          <div>${escapeHtml(b.name || 'Name: ____________________')}</div>
          <div>${escapeHtml(b.date ? `Date: ${b.date}` : 'Date: ____________')}</div>
        </div>`).join('')}
    </div>`;
}

export function printTerms(terms) {
  if (!terms?.length) return '';
  return `
    <div class="print-terms">
      <div><strong>General terms &amp; conditions</strong></div>
      <ol>${terms.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ol>
    </div>`;
}
