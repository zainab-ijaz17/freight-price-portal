// The approver's queue: every vendor rate sheet waiting for approval, each
// decided on its own. Tick several to approve, return, reject or print
// them together; click a row to see that sheet's rates.
import { getPendingSheets, approveSheets, rejectSheets, returnSheets } from '../api/revisionsApi.js';
import { downloadNotification } from '../api/notificationsApi.js';
import { getSession } from '../session.js';
import { revisionSheetHtml } from '../components/revisionPrint.js';
import { printDocument } from '../components/printSheet.js';
import {
  withAsyncState, escapeHtml, money, priceStr, pct, personLabel, toast, toastError,
  openDialog, closeDialog, codedError, showInlineError,
} from '../ui.js';

export const title = 'Approve and Release';

export function mount(container) {
  const controller = new AbortController();
  load(container);
  return () => { controller.abort(); closeDialog(); };
}

function load(container) {
  withAsyncState(container, getPendingSheets, (sheets) => {
    if (!sheets.length) {
      container.innerHTML = `
        <div class="state-block" style="padding-top:40px">
          <div class="hd">Nothing to approve</div>
          <p class="muted">No rate sheet is waiting for approval. You'll get a notification (and an email) when one is submitted.</p>
        </div>
      `;
      return;
    }
    render(container, sheets);
  }, { loadingLabel: 'Loading rate sheets waiting for approval…' });
}

function lineRows(sheet) {
  const w = sheet.worksheet;
  return w.rows.flatMap((r) => r.base.map((b, j) => ({
    dest: r.dest,
    vehicle: w.cols[j],
    currentRate: b,
    upliftAmt: r.inc[j],
    newRate: r.rounded[j],
    changePct: b == null ? null : (r.inc[j] / b) * 100,
  })));
}

function render(container, sheets) {
  const session = getSession();
  const isOwn = (s) => s.submittedBy.employeeId === session.employeeId;
  const selected = new Set();
  let focusedId = sheets[0].id;

  container.innerHTML = `
    <div class="screen-wide" style="max-width:1320px">
      <div class="row-gap" style="align-items:baseline">
        <h3 style="margin-bottom:3px">Approve and release</h3>
        <span class="tag tag-accent num">${sheets.length} rate sheet${sheets.length === 1 ? '' : 's'} waiting</span>
      </div>
      <p class="muted" style="font-size:13px">Each vendor's rate sheet is decided on its own. Tick several to approve, return, reject or print them together; click a row to check its rates.</p>

      <div class="table-scroll">
      <table class="table" style="margin-top:16px">
        <thead><tr>
          <th style="width:34px"><input type="checkbox" id="select-all" aria-label="Select all"></th>
          <th style="text-align:right">Revision</th><th>Vendor</th><th>Annexure</th>
          <th style="text-align:right">Rate lines</th><th style="text-align:right">Change</th>
          <th style="text-align:right">Rates effective</th><th>Submitted by</th><th style="text-align:right">Submitted on</th>
        </tr></thead>
        <tbody id="queue-rows">
          ${sheets.map((s) => `
            <tr class="queue-row" data-id="${escapeHtml(s.id)}">
              <td><input type="checkbox" class="sheet-check" data-id="${escapeHtml(s.id)}" aria-label="Select ${escapeHtml(s.vendorName)}"></td>
              <td class="num" style="text-align:right">${s.revisionNo}</td>
              <td>${escapeHtml(s.vendorName)}${s.resubmission ? ' <span class="tag tag-warning" style="font-size:10px;margin-left:6px">resubmitted</span>' : ''}</td>
              <td class="num">${escapeHtml(s.annexure)}</td>
              <td class="num" style="text-align:right">${s.rateLineCount}</td>
              <td class="num" style="text-align:right">${pct(s.upliftPct)}</td>
              <td class="num" style="text-align:right">${escapeHtml(s.effectiveDate)}</td>
              <td>${escapeHtml(personLabel(s.submittedBy))}${isOwn(s) ? ' <span class="tag tag-outline" style="font-size:10px;margin-left:6px">you</span>' : ''}</td>
              <td class="num" style="text-align:right">${escapeHtml(s.submittedOn)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>

      <div class="spread" style="margin-top:14px;gap:12px;flex-wrap:wrap">
        <span class="muted" style="font-size:12.5px" id="selection-summary"></span>
        <div class="row-gap" style="flex-wrap:wrap;justify-content:flex-end">
          <button class="btn btn-secondary" id="print-btn">Print</button>
          <button class="btn btn-secondary" id="return-btn">Return for Correction</button>
          <button class="btn btn-secondary" id="reject-btn">Reject</button>
          <button class="btn btn-primary" id="approve-btn">Approve and Release</button>
        </div>
      </div>

      <div id="sheet-detail" style="margin-top:30px"></div>
    </div>
  `;

  const rowsEl = container.querySelector('#queue-rows');
  const selectAll = container.querySelector('#select-all');
  const summaryEl = container.querySelector('#selection-summary');
  const detailEl = container.querySelector('#sheet-detail');
  const approveBtn = container.querySelector('#approve-btn');

  // Acted on: the ticked sheets, or the one being looked at if none is ticked.
  function target() {
    return selected.size ? sheets.filter((s) => selected.has(s.id)) : sheets.filter((s) => s.id === focusedId);
  }

  function updateSelection() {
    const t = target();
    const lines = t.reduce((sum, s) => sum + s.rateLineCount, 0);
    summaryEl.innerHTML = selected.size
      ? `<span class="num">${selected.size}</span> selected · <span class="num">${lines}</span> rate lines`
      : `Acting on the sheet shown below — ${escapeHtml(t[0]?.vendorName || '')}. Tick sheets to act on several at once.`;
    selectAll.checked = selected.size === sheets.length;
    selectAll.indeterminate = selected.size > 0 && selected.size < sheets.length;
    const own = t.filter(isOwn);
    approveBtn.disabled = own.length > 0;
    approveBtn.title = own.length ? 'You submitted a sheet in this selection — another approver must release it.' : '';
  }

  function focus(id) {
    focusedId = id;
    rowsEl.querySelectorAll('.queue-row').forEach((tr) => tr.classList.toggle('focused', tr.dataset.id === id));
    renderDetail(detailEl, sheets.find((s) => s.id === id), isOwn);
    updateSelection();
  }

  rowsEl.addEventListener('change', (e) => {
    if (!e.target.matches('.sheet-check')) return;
    if (e.target.checked) selected.add(e.target.dataset.id); else selected.delete(e.target.dataset.id);
    updateSelection();
  });
  rowsEl.addEventListener('click', (e) => {
    if (e.target.matches('input')) return;
    const tr = e.target.closest('.queue-row');
    if (tr) focus(tr.dataset.id);
  });
  selectAll.addEventListener('change', () => {
    sheets.forEach((s) => (selectAll.checked ? selected.add(s.id) : selected.delete(s.id)));
    rowsEl.querySelectorAll('.sheet-check').forEach((cb) => { cb.checked = selectAll.checked; });
    updateSelection();
  });

  container.querySelector('#print-btn').addEventListener('click', () => printSheets(target()));
  container.querySelector('#return-btn').addEventListener('click', () => openReasonDialog(container, target(), 'return'));
  container.querySelector('#reject-btn').addEventListener('click', () => openReasonDialog(container, target(), 'reject'));
  approveBtn.addEventListener('click', () => openPasswordDialog(container, target()));

  focus(focusedId);
}

function renderDetail(el, s, isOwn) {
  const lines = lineRows(s);
  el.innerHTML = `
    <div class="row-gap" style="align-items:baseline;margin-bottom:6px">
      <div style="font-family:var(--font-heading);font-size:18px">${escapeHtml(s.vendorName)}</div>
      <span class="muted num" style="font-size:13px">Revision ${s.revisionNo} · Annexure ${escapeHtml(s.annexure)}</span>
      ${isOwn(s) ? '<span class="tag tag-outline">Submitted by you — another approver must release it</span>' : ''}
    </div>

    ${s.previousReturn ? `
      <div class="notice-warning" style="margin:12px 0 4px">
        <div class="notice-title">Resubmission — this vendor's sheet was returned for correction on <span class="num">${escapeHtml(s.previousReturn.returnedOn)}</span></div>
        <div class="muted" style="font-size:12.5px">Corrections requested by ${escapeHtml(personLabel(s.previousReturn.returnedBy))}:</div>
        <div class="notice-quote">${escapeHtml(s.previousReturn.reason)}</div>
      </div>` : ''}

    <div style="display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:30px;margin-top:14px">
      <div>
        <div class="grid-4">
          <div><div class="hd">Rate lines</div><div class="num" style="font-size:30px;line-height:1.1">${s.rateLineCount}</div></div>
          <div><div class="hd">Rate change</div><div class="num" style="font-size:30px;line-height:1.1">${pct(s.upliftPct)}</div></div>
          <div><div class="hd">Diesel price change</div><div class="num" style="font-size:30px;line-height:1.1">${pct(s.overallUpliftPct)}</div></div>
        </div>
        <div class="table-scroll">
        <table class="table" style="margin-top:18px">
          <thead><tr>
            <th>Destination</th><th>Vehicle</th>
            <th style="text-align:right">Current rate</th><th style="text-align:right">Uplift</th>
            <th style="text-align:right;color:var(--color-positive)">New rate</th><th style="text-align:right">Change</th>
          </tr></thead>
          <tbody>
            ${lines.map((r) => `
              <tr>
                <td>${escapeHtml(r.dest)}</td><td>${escapeHtml(r.vehicle)}</td>
                <td class="num" style="text-align:right">${r.currentRate == null ? '—' : money(r.currentRate)}</td>
                <td class="num" style="text-align:right">${r.upliftAmt == null ? '—' : money(r.upliftAmt)}</td>
                <td class="num pos" style="text-align:right;font-weight:600">${r.newRate == null ? '—' : money(r.newRate)}</td>
                <td class="num" style="text-align:right">${r.changePct == null ? 'new' : pct(r.changePct)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        </div>
      </div>
      <div>
        <div class="card elev-sm">
          <div class="card-kicker">Submission</div>
          <div class="stack" style="font-size:13px">
            <div><div class="ro-lab" style="margin:0">Submitted by</div>${escapeHtml(personLabel(s.submittedBy))}</div>
            <div><div class="ro-lab" style="margin:0">Submitted on</div><span class="num">${escapeHtml(s.submittedOn)}</span></div>
            <div><div class="ro-lab" style="margin:0">Diesel price notification</div>${s.notificationId ? `<a href="#" id="notif-download">${escapeHtml(s.notificationFileName)}</a>` : '<span class="muted">none attached</span>'}</div>
            <div><div class="ro-lab" style="margin:0">Basis</div><span class="num">Diesel at PKR ${priceStr(s.dieselPrice)} / litre (previously ${priceStr(s.previousDieselPrice)}), effective ${escapeHtml(s.dieselEffectiveDate)} · ${escapeHtml(s.source || '')}</span></div>
            <div><div class="ro-lab" style="margin:0">Uplift</div>${escapeHtml(s.upliftBasis || '')}</div>
            <div><div class="ro-lab" style="margin:0">Rates effective from</div><span class="num">${escapeHtml(s.effectiveDate)}</span></div>
            ${s.remarks ? `<div><div class="ro-lab" style="margin:0">Maintainer's remarks</div><span style="white-space:pre-wrap">${escapeHtml(s.remarks)}</span></div>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
  el.querySelector('#notif-download')?.addEventListener('click', (e) => {
    e.preventDefault();
    downloadNotification(s.notificationId, s.notificationFileName)
      .catch((err) => toastError(err, 'Download failed.'));
  });
}

function printSheets(sheets) {
  const html = sheets.map((s) => revisionSheetHtml({ ...s, status: 'Waiting for approval' })).join('');
  const name = sheets.length === 1 ? `Revision ${sheets[0].revisionNo} - ${sheets[0].vendorName}` : `Rate sheets for approval (${sheets.length})`;
  printDocument(name, html);
}

// "Peshawar Lahore Goods (revision 23)" / "3 rate sheets"
function describe(sheets) {
  return sheets.length === 1 ? `${sheets[0].vendorName} (revision ${sheets[0].revisionNo})` : `${sheets.length} rate sheets`;
}

function openReasonDialog(container, sheets, kind) {
  const isReject = kind === 'reject';
  openDialog(`
    <div class="dialog-title">${isReject ? 'Reject' : 'Return for correction'}: ${escapeHtml(describe(sheets))}</div>
    ${sheets.length > 1 ? `<div class="dialog-body" style="font-size:12.5px">${sheets.map((s) => escapeHtml(`${s.vendorName} · revision ${s.revisionNo}`)).join('<br>')}</div>` : ''}
    <div class="dialog-body" style="font-size:12.5px;opacity:.75">${isReject
      ? 'Rejecting closes these sheets. The maintainer is notified with your reason and has to start a new revision for these vendors.'
      : 'The maintainer is notified and sees your comments on their screen, with these sheets ready to correct and resubmit.'}${sheets.length > 1 ? ' The same comment goes with every sheet listed.' : ''}</div>
    <div class="field"><label>${isReject ? 'Reason for rejection' : 'Corrections required'} · required</label><textarea class="input" id="reason-input" style="min-height:110px" placeholder="${isReject ? 'Why are these rates being rejected?' : 'List exactly what needs to change, e.g. the effective date, a rate to re-check…'}"></textarea></div>
    <div id="reason-error" class="inline-error" hidden></div>
    <div class="dialog-actions">
      <button class="btn btn-secondary" id="dlg-cancel">Cancel</button>
      <button class="btn btn-primary" id="dlg-confirm">${isReject ? 'Reject' : 'Return'} ${sheets.length === 1 ? 'sheet' : `${sheets.length} sheets`}</button>
    </div>
  `);
  document.getElementById('dlg-cancel').addEventListener('click', closeDialog);
  document.getElementById('dlg-confirm').addEventListener('click', async () => {
    const reason = document.getElementById('reason-input').value.trim();
    const errorEl = document.getElementById('reason-error');
    if (!reason) {
      showInlineError(errorEl, isReject
        ? codedError('APR-004', 'Enter a reason for rejecting.', 'Reason for rejection')
        : codedError('APR-005', 'Enter the corrections needed, so the maintainer knows what to change.', 'Corrections required'));
      return;
    }
    try {
      const fn = isReject ? rejectSheets : returnSheets;
      await fn(sheets.map((s) => s.id), reason);
      closeDialog();
      toast(`${describe(sheets)} ${isReject ? 'rejected' : 'returned for correction'}.`, 'success');
      load(container);
    } catch (err) {
      showInlineError(errorEl, err);
    }
  });
}

function openPasswordDialog(container, sheets) {
  const session = getSession();
  const lines = sheets.reduce((sum, s) => sum + s.rateLineCount, 0);
  openDialog(`
    <div class="dialog-title">Sign and release</div>
    <div class="dialog-body">Re-enter your password to release <span class="num">${lines}</span> rate lines:</div>
    <div class="dialog-body" style="font-size:12.5px">${sheets.map((s) => escapeHtml(`${s.vendorName} · revision ${s.revisionNo} · effective ${s.effectiveDate}`)).join('<br>')}</div>
    <div class="field"><label>Password · ${escapeHtml(personLabel(session))}</label><input class="input" id="approve-password" type="password"></div>
    <div id="approve-error" class="inline-error" hidden></div>
    <div class="dialog-actions">
      <button class="btn btn-secondary" id="dlg-cancel">Cancel</button>
      <button class="btn btn-primary" id="dlg-confirm">Approve and Release</button>
    </div>
  `);
  document.getElementById('approve-password').focus();
  document.getElementById('dlg-cancel').addEventListener('click', closeDialog);
  document.getElementById('dlg-confirm').addEventListener('click', async () => {
    const password = document.getElementById('approve-password').value;
    const errorEl = document.getElementById('approve-error');
    try {
      const result = await approveSheets(sheets.map((s) => s.id), password);
      showSuccessDialog(container, result);
    } catch (err) {
      showInlineError(errorEl, err, 'Approval failed.');
    }
  });
}

function showSuccessDialog(container, result) {
  openDialog(`
    <div class="dialog-title">${result.released.length === 1 ? 'Rate sheet' : `${result.released.length} rate sheets`} released</div>
    <div class="dialog-body"><span class="num">${result.linesWritten}</span> rate lines written:</div>
    <div class="dialog-body" style="font-size:12.5px">${result.released.map((r) => `${escapeHtml(r.vendorName)} · revision <span class="num">${r.revisionNo}</span> · effective <span class="num">${escapeHtml(r.effectiveDate)}</span>`).join('<br>')}</div>
    <div class="dialog-actions">
      <button class="btn btn-secondary" id="dlg-close">Close</button>
      <button class="btn btn-primary" id="dlg-lookup">Open rate lookup</button>
    </div>
  `);
  document.getElementById('dlg-close').addEventListener('click', () => {
    closeDialog();
    load(container);
  });
  document.getElementById('dlg-lookup').addEventListener('click', () => {
    closeDialog();
    location.hash = '#/lookup';
  });
}
