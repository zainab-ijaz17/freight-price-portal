import { getVendors } from '../api/vendorsApi.js';
import { getDraft, updateDraft, ensureDraftLoaded } from '../revisionDraft.js';
import { returnedNoticeHtml } from '../components/returnedNotice.js';
import { withAsyncState, escapeHtml, trimNum, isValidDisplayDate, dateField, wireDateFields, codedError, toastError } from '../ui.js';

export const title = 'Select Rate Lists';

export async function mount(container) {
  await ensureDraftLoaded().catch(() => {});
  const draft = getDraft();
  if (!draft?.confirmed) {
    location.hash = '#/diesel-price';
    return () => {};
  }

  const controller = new AbortController();
  withAsyncState(container, getVendors, (vendors) => render(container, draft, vendors), {
    loadingLabel: 'Loading rate lists…',
  });
  return () => controller.abort();
}

function render(container, draft, vendors) {
  // A rate list whose sheet is already waiting for approval can't go into
  // another revision until that one is decided.
  const available = vendors.filter((v) => v.pendingRevisionNo == null);
  // Filtered to lists that still exist and are free — one could have
  // been deleted, or submitted elsewhere, since this draft was made.
  const selected = new Set(
    (draft.vendorIds.length ? draft.vendorIds : available.map((v) => v.id)).filter((id) => available.some((v) => v.id === id))
  );

  container.innerHTML = `
    <div style="max-width:1180px">
      ${draft.returnedFrom ? `<div style="margin-bottom:22px">${returnedNoticeHtml(draft.returnedFrom, { compact: true })}</div>` : ''}
      <h3 style="margin-bottom:3px">Select rate lists</h3>
      <p class="muted" style="font-size:13px">Only checked rate lists are simulated and repriced. Each list's sheet goes to the approver as its own item, so they can be approved separately.</p>

      <div class="field" style="width:220px;margin-top:18px">
        <label for="rate-effective-from">Rates effective from</label>
        ${dateField('rate-effective-from', { value: draft.effectiveDate || draft.dieselEffectiveDate })}
      </div>

      <table class="table" style="margin-top:18px">
        <thead><tr>
          <th style="width:34px"><input type="checkbox" id="toggle-all"></th>
          <th>Rate list</th><th>Annexure</th><th style="text-align:right">Pass-through %</th>
          <th>Rounding</th><th style="text-align:right">Rate lines</th><th style="text-align:right">Last revised</th>
        </tr></thead>
        <tbody id="vendor-rows"></tbody>
      </table>

      <div class="spread" style="margin-top:20px">
        <span class="muted" style="font-size:12px" id="sel-summary"></span>
        <div class="row-gap">
          <button class="btn btn-secondary" id="back-btn">Back</button>
          <button class="btn btn-primary" id="run-sim">Run Simulation</button>
        </div>
      </div>
    </div>
  `;

  const rowsEl = container.querySelector('#vendor-rows');
  const toggleAll = container.querySelector('#toggle-all');
  const summaryEl = container.querySelector('#sel-summary');
  const rateEffectiveFrom = container.querySelector('#rate-effective-from');
  wireDateFields(container);

  function rowHtml(v) {
    const waiting = v.pendingRevisionNo != null;
    return `
      <tr${waiting ? ' style="opacity:.55"' : ''}>
        <td><input type="checkbox" class="vendor-check" data-id="${v.id}" ${selected.has(v.id) ? 'checked' : ''} ${waiting ? 'disabled' : ''}></td>
        <td>
          <span>${escapeHtml(v.name)}</span>
          ${v.stale ? '<span class="tag tag-outline" style="margin-left:8px;font-size:10px">not revised 90+ days</span>' : ''}
          ${waiting ? `<span class="tag tag-warning" style="margin-left:8px;font-size:10px">waiting for approval · revision ${v.pendingRevisionNo}</span>` : ''}
          ${v.transporters?.length ? `<div class="muted" style="font-size:12px">${escapeHtml(v.transporters.join(' · '))}</div>` : ''}
        </td>
        <td class="num">${escapeHtml(v.annexure)}</td>
        <td class="num" style="text-align:right">${trimNum(v.passThroughPct)}</td>
        <td>${escapeHtml(v.roundingRule)}</td>
        <td class="num" style="text-align:right">${v.rateLineCount}</td>
        <td class="num" style="text-align:right">${escapeHtml(v.lastRevisedDate)}</td>
      </tr>
    `;
  }

  function updateSummary() {
    const selVendors = vendors.filter((v) => selected.has(v.id));
    const lines = selVendors.reduce((sum, v) => sum + v.rateLineCount, 0);
    summaryEl.textContent = `${selVendors.length} rate list${selVendors.length === 1 ? '' : 's'} · ${lines} rate lines selected`;
    toggleAll.checked = available.length > 0 && selVendors.length === available.length;
    toggleAll.indeterminate = selVendors.length > 0 && selVendors.length < available.length;
  }

  rowsEl.innerHTML = vendors.map(rowHtml).join('');
  updateSummary();

  rowsEl.addEventListener('change', (e) => {
    if (!e.target.matches('.vendor-check')) return;
    const id = e.target.dataset.id;
    if (e.target.checked) selected.add(id); else selected.delete(id);
    updateSummary();
  });

  toggleAll.addEventListener('change', () => {
    if (toggleAll.checked) available.forEach((v) => selected.add(v.id));
    else selected.clear();
    rowsEl.innerHTML = vendors.map(rowHtml).join('');
    updateSummary();
  });

  container.querySelector('#back-btn').addEventListener('click', () => {
    location.hash = '#/diesel-price';
  });

  container.querySelector('#run-sim').addEventListener('click', () => {
    if (selected.size === 0) {
      toastError(codedError('VND-001', 'Select at least one rate list to simulate.', 'Rate lists'));
      return;
    }
    if (!isValidDisplayDate(rateEffectiveFrom.value)) {
      toastError(codedError('VND-002', 'Enter the date the new rates take effect as DD.MM.YYYY.', 'Rates effective from'));
      return;
    }
    updateDraft({ vendorIds: [...selected], effectiveDate: rateEffectiveFrom.value });
    location.hash = '#/review';
  });
}
