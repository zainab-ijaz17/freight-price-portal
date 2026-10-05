import * as adminApi from '../api/adminApi.js';
import { listRequests } from '../api/changeRequestsApi.js';
import { wireRequestDialog } from '../components/sheetAddDialogs.js';
import {
  withAsyncState, escapeHtml, toast, toastError, openDialog, closeDialog, trimNum, formatDateTime,
  isValidDisplayDate, dateField, wireDateFields, codedError, showInlineError, errorBanner,
} from '../ui.js';

export const title = 'Master Data';

const ROUNDING_RULES = ['Nearest 100', 'Nearest 50', 'None'];
const STATUS_TAG = { pending: 'tag-warning', approved: 'tag-positive', applied: 'tag-positive', rejected: 'tag-negative' };
const STATUS_LABEL = { pending: 'Waiting for approval', approved: 'Approved', applied: 'Added', rejected: 'Rejected' };

export function mount(container) {
  const controller = new AbortController();
  load(container);
  return () => { controller.abort(); closeDialog(); };
}

function load(container, keepVendorId) {
  const loader = () => Promise.all([adminApi.getVendors(), listRequests()]);
  withAsyncState(container, loader, ([vendors, requests]) => render(container, vendors, requests, keepVendorId), {
    loadingLabel: 'Loading vendors and agreements…',
  });
}

function pendingFor(requests, kind, match) {
  return requests.find((r) => r.status === 'pending' && r.kind === kind && match(r.payload));
}

function render(container, vendors, requests, keepVendorId) {
  container.innerHTML = `
    <div class="screen-medium">
      <h3 style="margin-bottom:3px">Master data</h3>
      <p class="muted" style="font-size:13px">Agreement terms and base rates save as you edit. New vendors and deletions are sent to a Rate Approver and only take effect once approved. New destinations and vehicle types are added by the Rate Approver.</p>

      <div class="spread" style="margin-top:20px">
        <div class="hd">Vendors &amp; agreements</div>
        <button class="btn btn-secondary" id="add-vendor-btn">Request new vendor</button>
      </div>
      <table class="table" style="margin-top:10px">
        <thead><tr>
          <th>Vendor</th><th>Annexure</th>
          <th style="text-align:right">Pass-through %</th><th>Rounding rule</th>
          <th>Valid from</th><th>Valid to</th>
          <th style="text-align:right">Rate lines</th><th style="text-align:right">Last revised</th><th></th>
        </tr></thead>
        <tbody id="vendor-rows"></tbody>
      </table>

      <div class="hd" style="margin-top:34px">Destinations &amp; vehicle types</div>
      <div class="field" style="width:280px;margin-top:10px">
        <label for="sheet-vendor">Vendor</label>
        <select class="input" id="sheet-vendor">${vendors.map((v) => `<option value="${v.id}" ${v.id === keepVendorId ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('')}</select>
      </div>
      <div id="sheet-body" style="margin-top:16px"></div>

      <div class="hd" style="margin-top:38px">Master data changes</div>
      <div id="request-list" style="margin-top:10px"></div>
    </div>
  `;

  const rowsEl = container.querySelector('#vendor-rows');
  const sheetVendorSelect = container.querySelector('#sheet-vendor');
  const sheetBody = container.querySelector('#sheet-body');
  const reload = () => load(container, sheetVendorSelect.value);

  function rowHtml(v) {
    const pendingDelete = pendingFor(requests, 'delete_vendor', (p) => p.vendorId === v.id);
    return `
      <tr data-id="${v.id}">
        <td>${escapeHtml(v.name)}</td>
        <td class="num">${escapeHtml(v.annexure)}</td>
        <td style="text-align:right"><input class="cell-in num" style="text-align:right;width:70px" type="number" min="0" max="100" step="0.01" value="${trimNum(v.passThroughPct)}" data-field="passThroughPct"></td>
        <td>
          <select class="cell-in" data-field="roundingRule">
            ${ROUNDING_RULES.map((r) => `<option ${r === v.roundingRule ? 'selected' : ''}>${r}</option>`).join('')}
          </select>
        </td>
        <td>${dateField(`vs-${v.id}`, { value: v.validityStart, compact: true, attrs: 'data-field="validityStart"' })}</td>
        <td>${dateField(`ve-${v.id}`, { value: v.validityEnd, compact: true, attrs: 'data-field="validityEnd"' })}</td>
        <td class="num" style="text-align:right">${v.rateLineCount}</td>
        <td class="num" style="text-align:right">${escapeHtml(v.lastRevisedDate)}</td>
        <td style="text-align:right;white-space:nowrap">
          ${pendingDelete
            ? `<span class="tag tag-warning" title="Request #${pendingDelete.id}">Deletion pending</span>`
            : `<button class="link-btn" data-delete-vendor="${v.id}">Request deletion</button>`}
        </td>
      </tr>
    `;
  }
  rowsEl.innerHTML = vendors.map(rowHtml).join('');
  wireDateFields(rowsEl);

  async function saveAgreement(vendorId, field, value) {
    try {
      await adminApi.updateAgreement(vendorId, { [field]: value });
      toast('Agreement updated.', 'success');
    } catch (err) {
      toastError(err, 'Could not save that change.');
      reload();
    }
  }

  rowsEl.addEventListener('change', (e) => {
    const field = e.target.dataset.field;
    if (!field) return;
    const vendorId = e.target.closest('tr').dataset.id;
    let value = e.target.value;
    if (field === 'passThroughPct') {
      if (value === '' || !(Number(value) >= 0 && Number(value) <= 100)) {
        toastError(codedError('MD-001', 'Pass-through % must be a number from 0 to 100.', 'Pass-through %'));
        return;
      }
      value = Number(value);
    } else if (field === 'validityStart' || field === 'validityEnd') {
      if (value && !isValidDisplayDate(value)) {
        toastError(codedError('MD-003', `Enter "${field === 'validityStart' ? 'Valid from' : 'Valid to'}" as DD.MM.YYYY.`, field === 'validityStart' ? 'Valid from' : 'Valid to'));
        return;
      }
    }
    saveAgreement(vendorId, field, value);
  });

  rowsEl.addEventListener('click', (e) => {
    const id = e.target.dataset.deleteVendor;
    if (!id) return;
    const v = vendors.find((x) => x.id === id);
    openDeleteDialog({
      title: `Request deletion of ${v.name}`,
      body: `Removes the vendor and its rate sheet (${v.rateLineCount} rate lines) from the portal once a Rate Approver approves it. Past revisions stay on record.`,
      kind: 'delete_vendor',
      payload: { vendorId: id },
      onDone: reload,
    });
  });

  container.querySelector('#add-vendor-btn').addEventListener('click', () => openAddVendorDialog(reload));

  async function loadSheet() {
    sheetBody.innerHTML = '<div class="state-block"><div class="spinner"></div></div>';
    const vendorId = sheetVendorSelect.value;
    try {
      const sheet = await adminApi.getRateSheet(vendorId);
      renderSheet(sheetBody, vendorId, sheet, requests, reload, loadSheet);
    } catch (err) {
      sheetBody.innerHTML = errorBanner(err, 'Could not load rate sheet.');
    }
  }
  sheetVendorSelect.addEventListener('change', loadSheet);
  if (vendors.length) loadSheet();
  else sheetBody.innerHTML = '<p class="muted">No vendors yet.</p>';

  renderRequestList(container.querySelector('#request-list'), requests, vendors);
}

function renderSheet(container, vendorId, sheet, requests, reload, reloadSheet) {
  const waiting = requests.filter((r) => r.status === 'pending' && r.vendorId === vendorId && r.kind !== 'delete_vendor');
  container.innerHTML = `
    ${waiting.length ? `
      <div class="notice-warning" style="max-width:820px;margin-bottom:14px;padding:10px 14px">
        <div class="notice-title" style="margin-bottom:2px">Waiting for approval</div>
        ${waiting.map((r) => `<div style="font-size:13px">#${r.id} · ${escapeHtml(r.summary)}</div>`).join('')}
      </div>` : ''}
    <div class="table-scroll">
    <table class="table" style="max-width:${Math.max(820, 300 + sheet.cols.length * 130)}px">
      <thead><tr>
        <th style="width:60px">S.No</th><th>Destination</th>
        ${sheet.cols.map((c, j) => `<th style="text-align:right">${escapeHtml(c)}<div class="muted" style="text-transform:none;letter-spacing:0">${escapeHtml(sheet.weights[j] || '')}</div></th>`).join('')}
        <th></th>
      </tr></thead>
      <tbody id="sheet-rows">
        ${sheet.rows.map((row, i) => {
          const pendingDelete = pendingFor(requests, 'delete_destination', (p) => p.vendorId === vendorId && p.destination === row[0]);
          return `
          <tr data-dest="${escapeHtml(row[0])}">
            <td class="num">${i + 1}</td>
            <td>${escapeHtml(row[0])}</td>
            ${row.slice(1).map((v) => `
              <td class="num" style="text-align:right">
                <input class="cell-in num" style="text-align:right;width:100px" type="number" min="0" step="1" value="${v == null ? '' : v}" data-rate>
              </td>
            `).join('')}
            <td style="text-align:right;white-space:nowrap">
              ${pendingDelete ? '<span class="tag tag-warning">Deletion pending</span>' : '<button class="link-btn" data-delete-dest>Request deletion</button>'}
            </td>
          </tr>
        `;
        }).join('')}
      </tbody>
    </table>
    </div>
  `;

  async function saveRow(tr) {
    const destination = tr.dataset.dest;
    const baseRates = [...tr.querySelectorAll('input[data-rate]')].map((el) => el.value);
    try {
      await adminApi.updateDestinationRates(vendorId, { destination, baseRates });
      toast('Rate updated.', 'success');
    } catch (err) {
      toastError(err, 'Could not save that rate.');
      reloadSheet();
    }
  }

  const rowsEl = container.querySelector('#sheet-rows');
  rowsEl.addEventListener('change', (e) => {
    if (!e.target.matches('input[data-rate]')) return;
    saveRow(e.target.closest('tr'));
  });
  rowsEl.addEventListener('click', (e) => {
    if (!e.target.matches('[data-delete-dest]')) return;
    const destination = e.target.closest('tr').dataset.dest;
    openDeleteDialog({
      title: `Request deletion of "${destination}"`,
      body: `Removes this destination and its ${sheet.cols.length} rate(s) from ${escapeHtml(sheet.title)} once a Rate Approver approves it. Past revisions stay on record.`,
      kind: 'delete_destination',
      payload: { vendorId, destination },
      onDone: reload,
    });
  });
}

function renderRequestList(container, requests, vendors) {
  if (!requests.length) {
    container.innerHTML = '<p class="muted" style="font-size:13px">No requests yet.</p>';
    return;
  }
  container.innerHTML = `
    <table class="table">
      <thead><tr><th style="width:50px">#</th><th>Request</th><th>Requested</th><th>Status</th><th>Decision</th></tr></thead>
      <tbody>
        ${requests.map((r) => `
          <tr>
            <td class="num">${r.id}</td>
            <td>${escapeHtml(r.summary)}${r.reason ? `<div class="muted" style="font-size:12px">Reason: ${escapeHtml(r.reason)}</div>` : ''}</td>
            <td class="num" style="white-space:nowrap">${escapeHtml(formatDateTime(r.requestedAt))}<div class="muted" style="font-size:12px">${escapeHtml(r.requestedBy?.name || '')}</div></td>
            <td><span class="tag ${STATUS_TAG[r.status] || 'tag-neutral'}">${escapeHtml(STATUS_LABEL[r.status] || r.status)}</span></td>
            <td style="font-size:12.5px">${r.decidedAt ? `${escapeHtml(r.decidedBy?.name || '')} · <span class="num">${escapeHtml(formatDateTime(r.decidedAt))}</span>${r.decisionNote ? `<div class="muted">${escapeHtml(r.decisionNote)}</div>` : ''}` : '<span class="muted">—</span>'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

const APPROVAL_NOTE = '<div class="dialog-body" style="font-size:12.5px;opacity:.7">This is sent to a Rate Approver. Nothing changes until they approve it; you will be notified either way.</div>';

function openAddVendorDialog(onDone) {
  openDialog(`
    <div class="dialog-title">Request new vendor</div>
    ${APPROVAL_NOTE}
    <div class="grid-2">
      <div class="field"><label for="av-name">Vendor name</label><input class="input" id="av-name"></div>
      <div class="field"><label for="av-annexure">Annexure reference</label><input class="input" id="av-annexure" placeholder="e.g. B/11"></div>
      <div class="field"><label for="av-pass">Pass-through %</label><input class="input num" id="av-pass" type="number" min="0" max="100" step="0.01" value="40"></div>
      <div class="field"><label for="av-round">Rounding rule</label>
        <select class="input" id="av-round">${ROUNDING_RULES.map((r) => `<option>${r}</option>`).join('')}</select>
      </div>
      <div class="field"><label for="av-valid-from">Valid from <span class="muted">· optional</span></label>${dateField('av-valid-from')}</div>
      <div class="field"><label for="av-valid-to">Valid to <span class="muted">· optional</span></label>${dateField('av-valid-to')}</div>
      <div class="field"><label for="av-dest">First destination</label><input class="input" id="av-dest"></div>
      <div class="field"><label for="av-vehicle">First vehicle type</label><input class="input" id="av-vehicle"></div>
      <div class="field"><label for="av-weight">Payload / weight</label><input class="input" id="av-weight" placeholder="e.g. 20 Ton"></div>
      <div class="field"><label for="av-rate">Base rate (PKR) <span class="muted">· optional</span></label><input class="input num" id="av-rate" type="number" min="0" step="1"></div>
    </div>
    <div id="av-error" class="inline-error" hidden></div>
    <div class="dialog-actions">
      <button class="btn btn-secondary" id="dlg-cancel">Cancel</button>
      <button class="btn btn-primary" id="dlg-confirm">Send for approval</button>
    </div>
  `);
  const val = (id) => document.getElementById(id).value;
  wireRequestDialog({
    kind: 'add_vendor',
    errorId: 'av-error',
    onDone,
    successText: 'The vendor appears here once approved.',
    collect() {
      for (const [id, label] of [['av-valid-from', 'Valid from'], ['av-valid-to', 'Valid to']]) {
        if (val(id) && !isValidDisplayDate(val(id))) throw codedError('MD-003', `Enter "${label}" as DD.MM.YYYY.`, label);
      }
      return {
        payload: {
          name: val('av-name'),
          annexure: val('av-annexure'),
          passThroughPct: val('av-pass'),
          roundingRule: val('av-round'),
          validityStart: val('av-valid-from'),
          validityEnd: val('av-valid-to'),
          firstDestination: val('av-dest'),
          firstVehicleType: val('av-vehicle'),
          firstWeight: val('av-weight'),
          firstBaseRate: val('av-rate'),
        },
      };
    },
  });
}

function openDeleteDialog({ title, body, kind, payload, onDone }) {
  openDialog(`
    <div class="dialog-title">${escapeHtml(title)}</div>
    <div class="dialog-body">${body}</div>
    ${APPROVAL_NOTE}
    <div class="field"><label for="del-reason">Reason for deletion · required</label><textarea class="input" id="del-reason" placeholder="e.g. contract ended on 30.06.2026"></textarea></div>
    <div id="del-error" class="inline-error" hidden></div>
    <div class="dialog-actions">
      <button class="btn btn-secondary" id="dlg-cancel">Cancel</button>
      <button class="btn btn-primary" id="dlg-confirm">Send for approval</button>
    </div>
  `);
  wireRequestDialog({
    kind,
    errorId: 'del-error',
    onDone,
    successText: 'It stays in place until approved.',
    collect() {
      const reason = document.getElementById('del-reason').value.trim();
      if (!reason) throw codedError('CR-004', 'Enter a reason for the deletion — the approver needs it to decide.', 'Reason for deletion');
      return { payload, reason };
    },
  });
}
