import { getVendorOptions } from '../api/vendorsApi.js';
import * as rateLookupApi from '../api/rateLookupApi.js';
import { printDocument, printSheet, printTable, printTerms, printSignatures } from '../components/printSheet.js';
import {
  withAsyncState, escapeHtml, money, priceStr, isValidDisplayDate, dateField, wireDateFields,
  codedError, toastError, errorBanner, downloadCsv,
} from '../ui.js';

export const title = 'Rate Lookup';

export function mount(container) {
  const controller = new AbortController();
  withAsyncState(container, getVendorOptions, (vendors) => render(container, vendors), {
    loadingLabel: 'Loading vendors…',
  });
  return () => controller.abort();
}

function render(container, vendors) {
  let tab = 'lookup';

  container.innerHTML = `
    <div class="screen-medium">
      <div class="seg" style="margin-bottom:20px">
        <label class="seg-opt"><input type="radio" name="tab" id="tab-lookup" checked>Rate Lookup</label>
        <label class="seg-opt"><input type="radio" name="tab" id="tab-annex">Annexure View</label>
      </div>
      <div id="tab-body"></div>
    </div>
  `;

  const body = container.querySelector('#tab-body');
  container.querySelector('#tab-lookup').addEventListener('change', () => { tab = 'lookup'; renderTab(); });
  container.querySelector('#tab-annex').addEventListener('change', () => { tab = 'annex'; renderTab(); });

  function renderTab() {
    if (tab === 'lookup') renderLookupTab(body, vendors);
    else renderAnnexTab(body, vendors);
  }
  renderTab();
}

async function renderLookupTab(body, vendors) {
  body.innerHTML = `
    <div class="grid-4" style="padding:14px 16px;border-radius:var(--radius-md);background:var(--color-surface);box-shadow:var(--shadow-sm)">
      <div class="field"><label for="lk-date">Date <span class="muted">· blank = today</span></label>${dateField('lk-date')}</div>
      <div class="field"><label>Vendor</label>
        <select class="input" id="lk-vendor">${vendors.map((v) => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Destination</label><input class="input" id="lk-dest" placeholder="Type to search"></div>
      <div class="field"><label>Vehicle type</label><select class="input" id="lk-vehicle"></select></div>
    </div>
    <div class="end" style="justify-content:flex-start;margin-top:14px">
      <button class="btn btn-primary" id="lk-search">Search</button>
    </div>
    <div id="lk-results" style="margin-top:22px"></div>
  `;

  const vendorSelect = body.querySelector('#lk-vendor');
  const vehicleSelect = body.querySelector('#lk-vehicle');
  const destInput = body.querySelector('#lk-dest');
  const dateInput = body.querySelector('#lk-date');
  const resultsEl = body.querySelector('#lk-results');
  const searchBtn = body.querySelector('#lk-search');
  wireDateFields(body);

  // Listeners are wired up before the vehicle-types fetch below, not after
  // it — attaching them post-await left the Search button dead (no
  // handler at all) for the length of that request. It's also disabled
  // for that same window so a click can't capture a stale "Loading…"
  // option as the vehicle type.
  async function loadVehicleTypes() {
    searchBtn.disabled = true;
    vehicleSelect.innerHTML = '<option>Loading…</option>';
    try {
      const types = await rateLookupApi.getVehicleTypes(vendorSelect.value);
      vehicleSelect.innerHTML = types.map((t) => `<option>${escapeHtml(t)}</option>`).join('');
      searchBtn.disabled = false;
    } catch (err) {
      vehicleSelect.innerHTML = '';
      toastError(err, 'Could not load vehicle types.');
    }
  }
  vendorSelect.addEventListener('change', loadVehicleTypes);

  searchBtn.addEventListener('click', async () => {
    if (!destInput.value.trim()) {
      toastError(codedError('LKP-001', 'Enter a destination (or part of its name) to search.', 'Destination'));
      return;
    }
    if (dateInput.value && !isValidDisplayDate(dateInput.value)) {
      toastError(codedError('LKP-002', 'Enter the date as DD.MM.YYYY, or leave it blank for today.', 'Date'));
      return;
    }
    const params = {
      vendorId: vendorSelect.value,
      destination: destInput.value,
      vehicleType: vehicleSelect.value,
      date: dateInput.value,
    };
    resultsEl.innerHTML = '<div class="state-block"><div class="spinner"></div></div>';
    try {
      const [rate, history] = await Promise.all([
        rateLookupApi.lookupRate(params),
        rateLookupApi.getRateHistory(params),
      ]);
      renderLookupResults(resultsEl, rate, history);
    } catch (err) {
      resultsEl.innerHTML = errorBanner(err, 'Lookup failed.');
    }
  });

  await loadVehicleTypes();
}

function renderLookupResults(container, rate, history) {
  if (!rate) {
    container.innerHTML = '<p class="muted">No rate found for that vendor, destination and vehicle type on that date. Check the spelling of the destination, or try another vehicle type.</p>';
    return;
  }
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:minmax(0,420px) minmax(0,1fr);gap:34px;align-items:start">
      <div class="card elev-md" style="padding:20px">
        <div class="num pos" style="font-size:44px;line-height:1.05">PKR ${money(rate.rate)}</div>
        <div style="font-size:14px">${escapeHtml(rate.destination)} · ${escapeHtml(rate.vehicleType)} · ${escapeHtml(rate.vendorName)}</div>
        <div class="card-meta" style="font-size:12px">Annexure ${escapeHtml(rate.annexure)} · Revision ${rate.revisionNo}</div>
        <div style="height:1px;background:var(--color-divider);margin:4px 0"></div>
        <div style="font-size:12.5px;color:color-mix(in srgb,var(--color-text) 70%,transparent);line-height:1.6">
          Valid <span class="num">${escapeHtml(rate.validFrom)}</span> – ${rate.validTo === 'current' ? '<span class="pos">current</span>' : `<span class="num">${escapeHtml(rate.validTo)}</span>`}<br>
          Approved by ${escapeHtml(rate.approvedBy)} on <span class="num">${escapeHtml(rate.approvedOn)}</span>
        </div>
      </div>
      <div>
        <div class="hd" style="margin-bottom:8px">History · this lane</div>
        <table class="table">
          <thead><tr><th style="text-align:right">Revision</th><th style="text-align:right">Diesel price</th><th style="text-align:right">Rate</th><th style="text-align:right">Valid from</th><th style="text-align:right">Valid to</th></tr></thead>
          <tbody>
            ${history.map((h) => `
              <tr class="${h.validTo === 'current' ? 'row-current' : ''}">
                <td class="num" style="text-align:right">${h.revisionNo}</td>
                <td class="num" style="text-align:right">${priceStr(h.dieselPrice)}</td>
                <td class="num" style="text-align:right">${money(h.rate)}</td>
                <td class="num" style="text-align:right">${escapeHtml(h.validFrom)}</td>
                <td class="num" style="text-align:right">${escapeHtml(h.validTo)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function renderAnnexTab(body, vendors) {
  body.innerHTML = `
    <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
      <div class="field" style="width:250px"><label>Vendor</label>
        <select class="input" id="ax-vendor">${vendors.map((v) => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('')}</select>
      </div>
      <div class="field" style="width:150px"><label>Revision</label><select class="input num" id="ax-revision"></select></div>
      <div class="row-gap" style="margin-left:auto">
        <button class="btn btn-secondary" id="ax-export">Export to Excel</button>
        <button class="btn btn-secondary" id="ax-print">Print</button>
      </div>
    </div>
    <div id="ax-body" style="margin-top:24px"></div>
  `;

  const vendorSelect = body.querySelector('#ax-vendor');
  const revisionSelect = body.querySelector('#ax-revision');
  const axBody = body.querySelector('#ax-body');

  let annex = null;
  body.querySelector('#ax-export').addEventListener('click', () => { if (annex) exportAnnexure(annex); });
  body.querySelector('#ax-print').addEventListener('click', () => { if (annex) printAnnexure(annex); });

  async function loadAnnexure() {
    axBody.innerHTML = '<div class="state-block"><div class="spinner"></div></div>';
    try {
      annex = null;
      annex = await rateLookupApi.getAnnexure(vendorSelect.value, Number(revisionSelect.value));
      renderAnnexure(axBody, annex);
    } catch (err) {
      axBody.innerHTML = errorBanner(err, 'Could not load annexure.');
    }
  }

  async function loadRevisions() {
    const revisions = await rateLookupApi.getRevisionOptions();
    revisionSelect.innerHTML = revisions.map((r, i) => `<option value="${r}">${r}${i === 0 ? ' (current)' : ''}</option>`).join('');
  }

  vendorSelect.addEventListener('change', loadAnnexure);
  revisionSelect.addEventListener('change', loadAnnexure);
  await loadRevisions();
  await loadAnnexure();
}

function renderAnnexure(container, annex) {
  container.innerHTML = `
    <div style="padding:18px 20px;border-radius:var(--radius-md);background:var(--color-surface);box-shadow:var(--shadow-sm)">
      <div style="font-family:var(--font-heading);font-size:21px">${escapeHtml(annex.title)}</div>
      <div class="num" style="font-size:13px;color:color-mix(in srgb,var(--color-text) 70%,transparent);margin-top:3px">Annexure ${escapeHtml(annex.annexure)} · Revision ${annex.revisionNo} · w.e.f. ${escapeHtml(annex.effectiveDate)} ${annex.isCurrent ? '<span class="tag tag-positive" style="margin-left:6px">Current</span>' : ''}</div>
      <div class="num" style="font-size:13px;color:color-mix(in srgb,var(--color-text) 70%,transparent)">Based on diesel at PKR ${priceStr(annex.dieselPrice)} per litre</div>
      <div class="num" style="font-size:13px;color:color-mix(in srgb,var(--color-text) 70%,transparent)">Approved by ${escapeHtml(annex.approvedBy)} on ${escapeHtml(annex.approvedOn)}</div>
    </div>
    <table class="table" style="margin-top:18px;max-width:820px">
      <thead><tr>
        <th style="width:60px">S.No</th><th>Destination</th>
        ${annex.cols.map((c) => `<th style="text-align:right${annex.isCurrent ? ';color:var(--color-positive)' : ''}">${escapeHtml(c)}</th>`).join('')}
      </tr></thead>
      <tbody>
        ${annex.rows.map((r) => `
          <tr>
            <td class="num">${r.no}</td>
            <td>${escapeHtml(r.dest)}</td>
            ${r.cells.map((c) => `<td class="num${annex.isCurrent ? ' pos' : ''}" style="text-align:right">${c == null ? '—' : money(c)}</td>`).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
    ${annex.terms?.length ? `
      <div style="max-width:820px;margin-top:22px">
        <div class="hd" style="margin-bottom:8px">General terms &amp; conditions</div>
        <ol style="margin:0;padding-left:20px;font-size:13px;line-height:1.6">
          ${annex.terms.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
        </ol>
      </div>` : ''}
  `;
}

// The annexure as it would be attached to the agreement: rates, terms and
// a signature box for each side.
function printAnnexure(annex) {
  const html = printSheet({
    title: annex.title,
    subtitle: `Annexure ${annex.annexure} · Revision ${annex.revisionNo}${annex.isCurrent ? ' (current)' : ''}`,
    meta: [
      `Freight rates with effect from ${annex.effectiveDate}`,
      `Based on diesel at PKR ${priceStr(annex.dieselPrice)} per litre`,
      `Approved by ${annex.approvedBy} on ${annex.approvedOn}`,
      'All rates in PKR per trip',
    ],
    tableHtml: printTable(
      [['S.No', 'Destination', ...annex.cols.map((c) => ({ text: c, align: 'right' }))]],
      annex.rows.map((r) => [{ text: r.no, align: 'right' }, r.dest, ...r.cells.map((c) => ({ text: c == null ? '—' : money(c), align: 'right' }))])
    ),
    afterHtml: printTerms(annex.terms) + printSignatures([
      { label: 'For Packages Limited' },
      { label: `For ${annex.vendorName}` },
    ]),
  });
  printDocument(`${annex.vendorName} - Annexure ${annex.annexure.replace(/\//g, '-')} - Revision ${annex.revisionNo}`, html);
}

function exportAnnexure(annex) {
  const rows = [
    [annex.title],
    [`Annexure ${annex.annexure}`, `Revision ${annex.revisionNo}`, `w.e.f. ${annex.effectiveDate}`],
    [`Based on diesel at PKR ${priceStr(annex.dieselPrice)} per litre`],
    [`Approved by ${annex.approvedBy} on ${annex.approvedOn}`],
    [],
    ['S.No', 'Destination', ...annex.cols],
    ...annex.rows.map((r) => [r.no, r.dest, ...r.cells.map((c) => (c == null ? '' : c))]),
  ];
  if (annex.terms?.length) rows.push([], ['General terms & conditions'], ...annex.terms.map((t, i) => [`${i + 1}.`, t]));
  downloadCsv(`${annex.vendorName} - Annexure ${annex.annexure.replace(/\//g, '-')} - Revision ${annex.revisionNo}.csv`, rows);
}
