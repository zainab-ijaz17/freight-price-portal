// The approver's comments on rate sheets returned for correction. Shown in
// full on "Enter diesel price" (with the button to reopen them) and as a
// reminder strip on every later step while they're being corrected.
//
// `returned`: { revisionNo, returns: [{ vendorName, reason, returnedBy,
// returnedOn }] } — or, from drafts saved before sheets were returned one
// vendor at a time, { revisionNo, reason, returnedBy, returnedOn }.
import { escapeHtml, personLabel } from '../ui.js';

function returnsOf(returned) {
  return returned.returns || [{ vendorName: null, reason: returned.reason, returnedBy: returned.returnedBy, returnedOn: returned.returnedOn }];
}

export function returnedNoticeHtml(returned, { actionsHtml = '', compact = false } = {}) {
  const returns = returnsOf(returned);
  const vendors = returns.map((r) => r.vendorName).filter(Boolean);
  const what = `Revision ${returned.revisionNo}${vendors.length ? ` (${vendors.join(', ')})` : ''}`;
  // One quote per distinct comment — a batch returned together shares one.
  const comments = [];
  returns.forEach((r) => {
    const same = comments.find((c) => c.reason === r.reason && c.returnedOn === r.returnedOn);
    if (same) same.vendors.push(r.vendorName);
    else comments.push({ ...r, vendors: [r.vendorName] });
  });
  return `
    <div class="notice-warning" role="alert">
      <div class="notice-title">${compact ? `Correcting ${escapeHtml(what)} — address these comments before resubmitting` : `${escapeHtml(what)} ${returns.length === 1 ? 'was' : 'were'} returned for correction`}</div>
      ${comments.map((c) => `
        <div class="muted" style="font-size:12.5px;margin-top:6px">Comments from ${escapeHtml(personLabel(c.returnedBy) || 'the approver')} on <span class="num">${escapeHtml(c.returnedOn)}</span>${comments.length > 1 && c.vendors.filter(Boolean).length ? ` · ${escapeHtml(c.vendors.filter(Boolean).join(', '))}` : ''}:</div>
        <div class="notice-quote">${escapeHtml(c.reason)}</div>
      `).join('')}
      ${actionsHtml}
    </div>
  `;
}
