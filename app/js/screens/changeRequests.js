// The Rate Approver's master data screen: adding destinations and vehicle
// types to a vendor's rate sheet (applied at once), and the queue of
// changes raised by an Administrator — new vendors and deletions.
// Approving applies the change immediately; rejecting needs a reason,
// which goes back to the requester.
import { listRequests, approveRequest, rejectRequest } from '../api/changeRequestsApi.js';
import { getVendorOptions } from '../api/vendorsApi.js';
import { getRateSheet } from '../api/adminApi.js';
import { openAddDestinationDialog, openAddVehicleTypeDialog } from '../components/sheetAddDialogs.js';
import { getSession } from '../session.js';
import {
  withAsyncState, escapeHtml, money, trimNum, formatDateTime, toast, openDialog, closeDialog,
  codedError, showInlineError, errorBanner,
} from '../ui.js';

export const title = 'Master Data';

const STATUS_TAG = { pending: 'tag-warning', approved: 'tag-positive', applied: 'tag-positive', rejected: 'tag-negative' };
const STATUS_LABEL = { approved: 'Approved', applied: 'Added', rejected: 'Rejected' };
const KIND_LABEL = {
  add_vendor: 'New vendor',
  add_destination: 'New destination',
  add_vehicle_type: 'New vehicle type',
  delete_vendor: 'Delete vendor',
  delete_destination: 'Delete destination',
};

export function mount(container) {
  const controller = new AbortController();
  load(container);
  return () => { controller.abort(); closeDialog(); };
}

function load(container, keepVendorId) {
  const loader = () => Promise.all([listRequests(), getVendorOptions()]);
  withAsyncState(container, loader, ([requests, vendors]) => render(container, requests, vendors, keepVendorId), {
    loadingLabel: 'Loading requests…',
  });
}

function rate(v) {
  return v === '' || v == null ? '<span class="muted">blank</span>' : `PKR ${money(v)}`;
}

// What exactly would change, so the approver doesn't have to go and look.
function detailsHtml(r, vendorName) {
  const p = r.payload;
  const row = (label, value) => `<div><span class="muted">${escapeHtml(label)}:</span> ${value}</div>`;
  switch (r.kind) {
    case 'add_vendor':
      return [
        row('Annexure', escapeHtml(p.annexure || '—')),
        row('Pass-through', `${escapeHtml(trimNum(p.passThroughPct))}% · ${escapeHtml(p.roundingRule)}`),
        row('Validity', `${escapeHtml(p.validityStart || 'open')} – ${escapeHtml(p.validityEnd || 'open')}`),
        row('First line', `${escapeHtml(p.firstDestination)} · ${escapeHtml(p.firstVehicleType)}${p.firstWeight ? ` (${escapeHtml(p.firstWeight)})` : ''} · ${rate(p.firstBaseRate)}`),
      ].join('');
    case 'add_destination':
      return row('Vendor', escapeHtml(vendorName)) + row('Base rates', p.baseRates.map(rate).join(' · '));
    case 'add_vehicle_type': {
      const filled = (p.baseRates || []).filter((x) => x !== '' && x != null).length;
      return row('Vendor', escapeHtml(vendorName))
        + row('Payload', escapeHtml(p.weight || '—'))
        + row('Base rates', `${filled} of ${(p.baseRates || []).length} destinations filled in${filled < (p.baseRates || []).length ? ' — the rest are typed in at the next revision' : ''}`);
    }
    case 'delete_destination':
      return row('Vendor', escapeHtml(vendorName));
    default:
      return '';
  }
}

function render(container, requests, vendors, keepVendorId) {
  const session = getSession();
  const nameOf = (id) => vendors.find((v) => v.id === id)?.name || id;
  const pending = requests.filter((r) => r.status === 'pending');
  const decided = requests.filter((r) => r.status !== 'pending');

  container.innerHTML = `
    <div class="screen-medium">
      <h3 style="margin-bottom:3px">Master data</h3>
      <p class="muted" style="font-size:13px">Destinations and vehicle types you add here go onto the rate sheet straight away. New vendors and deletions raised by an Administrator take effect only once you approve them. You cannot decide a request you raised yourself.</p>

      <div class="hd" style="margin-top:22px">Destinations &amp; vehicle types</div>
      <div class="row-gap" style="margin-top:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="width:280px;margin:0">
          <label for="sheet-vendor">Vendor</label>
          <select class="input" id="sheet-vendor">${vendors.map((v) => `<option value="${v.id}" ${v.id === keepVendorId ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('')}</select>
        </div>
        <button class="btn btn-secondary" id="add-dest-btn" disabled>Add destination</button>
        <button class="btn btn-secondary" id="add-vehicle-btn" disabled>Add vehicle type</button>
      </div>
      <div id="sheet-summary" class="muted" style="font-size:12.5px;margin-top:8px"></div>

      <div class="hd" style="margin-top:30px">Waiting for your decision · <span class="num">${pending.length}</span></div>
      <div class="stack" style="margin-top:10px">
        ${pending.length ? pending.map((r) => `
          <div class="card elev-sm" style="padding:14px 16px">
            <div class="spread" style="align-items:flex-start;gap:16px">
              <div style="min-width:0">
                <div class="row-gap"><span class="tag ${r.kind.startsWith('delete') ? 'tag-negative' : 'tag-neutral'}">${KIND_LABEL[r.kind] || r.kind}</span><span class="muted num" style="font-size:12px">#${r.id}</span></div>
                <div style="font-size:15px;margin-top:6px">${escapeHtml(r.summary)}</div>
                <div style="font-size:12.5px;margin-top:6px;line-height:1.6">${detailsHtml(r, nameOf(r.vendorId))}</div>
                ${r.reason ? `<div class="notice-quote" style="border-left-color:var(--color-divider);font-size:13px">${escapeHtml(r.reason)}</div>` : ''}
                <div class="muted" style="font-size:12px;margin-top:8px">Requested by ${escapeHtml(r.requestedBy?.name || '')} · <span class="num">${escapeHtml(formatDateTime(r.requestedAt))}</span></div>
              </div>
              <div class="row-gap" style="flex:none">
                ${r.requestedBy?.employeeId === session.employeeId
                  ? '<span class="muted" style="font-size:12px">Raised by you — another approver must decide</span>'
                  : `<button class="btn btn-secondary" data-reject="${r.id}">Reject</button><button class="btn btn-primary" data-approve="${r.id}">Approve</button>`}
              </div>
            </div>
          </div>
        `).join('') : '<p class="muted" style="font-size:13px">Nothing waiting. New requests also appear under the bell in the top bar.</p>'}
      </div>

      ${decided.length ? `
        <div class="hd" style="margin-top:34px">History</div>
        <table class="table" style="margin-top:10px">
          <thead><tr><th style="width:50px">#</th><th>Request</th><th>Requested by</th><th>Status</th><th>Decided</th></tr></thead>
          <tbody>
            ${decided.map((r) => `
              <tr>
                <td class="num">${r.id}</td>
                <td>${escapeHtml(r.summary)}${r.decisionNote ? `<div class="muted" style="font-size:12px">${escapeHtml(r.decisionNote)}</div>` : ''}</td>
                <td>${escapeHtml(r.requestedBy?.name || '')}</td>
                <td><span class="tag ${STATUS_TAG[r.status] || 'tag-neutral'}">${escapeHtml(STATUS_LABEL[r.status] || r.status)}</span></td>
                <td style="font-size:12.5px">${escapeHtml(r.decidedBy?.name || '')} · <span class="num">${escapeHtml(formatDateTime(r.decidedAt))}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>` : ''}
    </div>
  `;

  wireSheetActions(container);

  const byId = (id) => requests.find((r) => String(r.id) === id);
  container.querySelectorAll('[data-approve]').forEach((btn) => btn.addEventListener('click', () => openDecisionDialog(container, byId(btn.dataset.approve), 'approve')));
  container.querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', () => openDecisionDialog(container, byId(btn.dataset.reject), 'reject')));
}

// Vendor picker + "Add destination" / "Add vehicle type". The dialogs need
// the vendor's current sheet (its vehicle types and destinations), so the
// buttons stay disabled until it has loaded.
function wireSheetActions(container) {
  const select = container.querySelector('#sheet-vendor');
  const summaryEl = container.querySelector('#sheet-summary');
  const destBtn = container.querySelector('#add-dest-btn');
  const vehicleBtn = container.querySelector('#add-vehicle-btn');
  let sheet = null;

  async function loadSheet() {
    sheet = null;
    destBtn.disabled = vehicleBtn.disabled = true;
    summaryEl.textContent = 'Loading rate sheet…';
    const vendorId = select.value;
    try {
      const loaded = await getRateSheet(vendorId);
      if (select.value !== vendorId) return;
      sheet = loaded;
      summaryEl.textContent = `${sheet.rows.length} destination(s) · vehicle types: ${sheet.cols.join(', ') || 'none'}`;
      destBtn.disabled = vehicleBtn.disabled = false;
    } catch (err) {
      summaryEl.innerHTML = errorBanner(err, 'Could not load the rate sheet.');
    }
  }

  const reload = () => load(container, select.value);
  destBtn.addEventListener('click', () => sheet && openAddDestinationDialog(select.value, sheet, reload));
  vehicleBtn.addEventListener('click', () => sheet && openAddVehicleTypeDialog(select.value, sheet, reload));
  select.addEventListener('change', loadSheet);
  if (select.value) loadSheet();
  else summaryEl.textContent = 'No vendors yet.';
}

function openDecisionDialog(container, r, action) {
  const approving = action === 'approve';
  openDialog(`
    <div class="dialog-title">${approving ? 'Approve' : 'Reject'} request #${r.id}</div>
    <div class="dialog-body">${escapeHtml(r.summary)}</div>
    ${approving
      ? `<div class="dialog-body" style="font-size:12.5px;opacity:.75">${r.kind.startsWith('delete') ? 'This takes effect immediately and cannot be undone from the portal.' : 'This takes effect immediately.'} The requester is notified.</div>`
      : '<div class="field"><label for="cr-reason">Reason for rejection · required</label><textarea class="input" id="cr-reason"></textarea></div>'}
    <div id="cr-error" class="inline-error" hidden></div>
    <div class="dialog-actions">
      <button class="btn btn-secondary" id="dlg-cancel">Cancel</button>
      <button class="btn btn-primary" id="dlg-confirm">${approving ? 'Approve' : 'Reject request'}</button>
    </div>
  `);
  document.getElementById('dlg-cancel').addEventListener('click', closeDialog);
  const confirmBtn = document.getElementById('dlg-confirm');
  confirmBtn.addEventListener('click', async () => {
    const errorEl = document.getElementById('cr-error');
    let reason;
    if (!approving) {
      reason = document.getElementById('cr-reason').value.trim();
      if (!reason) {
        showInlineError(errorEl, codedError('CR-004', 'Enter a reason for rejecting this request.', 'Reason for rejection'));
        return;
      }
    }
    confirmBtn.disabled = true;
    try {
      if (approving) await approveRequest(r.id); else await rejectRequest(r.id, reason);
      closeDialog();
      toast(`Request #${r.id} ${approving ? 'approved' : 'rejected'}.`, 'success');
      load(container);
    } catch (err) {
      showInlineError(errorEl, err);
      confirmBtn.disabled = false;
    }
  });
}
