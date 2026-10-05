// Dialogs that send a master data change: the shared send-and-show-errors
// wiring (used by the Administrator's request dialogs too) and the Rate
// Approver's "Add destination" / "Add vehicle type", which apply at once.
import { raiseRequest } from '../api/changeRequestsApi.js';
import { escapeHtml, toast, openDialog, closeDialog, showInlineError } from '../ui.js';

// Shared wiring for every "Request …" dialog: collects the payload, sends
// it, and shows the server's coded error inline if it's refused.
export function wireRequestDialog({ kind, collect, errorId, onDone, successText }) {
  document.getElementById('dlg-cancel').addEventListener('click', closeDialog);
  const confirmBtn = document.getElementById('dlg-confirm');
  confirmBtn.addEventListener('click', async () => {
    const errorEl = document.getElementById(errorId);
    errorEl.hidden = true;
    let collected;
    try {
      collected = collect();
    } catch (err) {
      showInlineError(errorEl, err);
      return;
    }
    confirmBtn.disabled = true;
    try {
      const created = await raiseRequest(kind, collected.payload, collected.reason);
      closeDialog();
      toast(created.status === 'applied' ? successText : `Request #${created.id} sent to the Rate Approver. ${successText}`, 'success', 6000);
      onDone();
    } catch (err) {
      showInlineError(errorEl, err);
      confirmBtn.disabled = false;
    }
  });
}

export function openAddDestinationDialog(vendorId, sheet, onDone) {
  openDialog(`
    <div class="dialog-title">Add destination · ${escapeHtml(sheet.title)}</div>
    <div class="field"><label for="ad-dest">Destination</label><input class="input" id="ad-dest"></div>
    ${sheet.cols.map((c, i) => `
      <div class="field"><label for="ad-rate-${i}">Base rate · ${escapeHtml(c)} <span class="muted">· optional</span></label><input class="input num" id="ad-rate-${i}" type="number" min="0" step="1"></div>
    `).join('')}
    <div id="ad-error" class="inline-error" hidden></div>
    <div class="dialog-actions">
      <button class="btn btn-secondary" id="dlg-cancel">Cancel</button>
      <button class="btn btn-primary" id="dlg-confirm">Add destination</button>
    </div>
  `);
  wireRequestDialog({
    kind: 'add_destination',
    errorId: 'ad-error',
    onDone,
    successText: 'Destination added to the rate sheet.',
    collect: () => ({
      payload: {
        vendorId,
        destination: document.getElementById('ad-dest').value,
        baseRates: sheet.cols.map((_, i) => document.getElementById(`ad-rate-${i}`).value),
      },
    }),
  });
}

export function openAddVehicleTypeDialog(vendorId, sheet, onDone) {
  openDialog(`
    <div class="dialog-title">Add vehicle type · ${escapeHtml(sheet.title)}</div>
    <div class="grid-2">
      <div class="field"><label for="avt-name">Vehicle type</label><input class="input" id="avt-name" placeholder="e.g. 22ft Container"></div>
      <div class="field"><label for="avt-weight">Payload / weight</label><input class="input" id="avt-weight" placeholder="e.g. 25 Ton"></div>
    </div>
    <div class="hd" style="margin-top:6px">Base rate per destination <span style="text-transform:none;letter-spacing:0">· optional — leave blank to enter at the next revision</span></div>
    <div style="max-height:40vh;overflow-y:auto;margin-top:8px;padding-right:4px">
      ${sheet.rows.map((row, i) => `
        <div class="row-gap" style="justify-content:space-between;margin-bottom:6px">
          <label for="avt-rate-${i}" style="font-size:13px;flex:1">${escapeHtml(row[0])}</label>
          <input class="input num" id="avt-rate-${i}" type="number" min="0" step="1" style="width:130px">
        </div>
      `).join('')}
    </div>
    <div id="avt-error" class="inline-error" hidden></div>
    <div class="dialog-actions">
      <button class="btn btn-secondary" id="dlg-cancel">Cancel</button>
      <button class="btn btn-primary" id="dlg-confirm">Add vehicle type</button>
    </div>
  `);
  wireRequestDialog({
    kind: 'add_vehicle_type',
    errorId: 'avt-error',
    onDone,
    successText: 'Vehicle type added to the rate sheet.',
    collect: () => ({
      payload: {
        vendorId,
        vehicleType: document.getElementById('avt-name').value,
        weight: document.getElementById('avt-weight').value,
        baseRates: sheet.rows.map((_, i) => document.getElementById(`avt-rate-${i}`).value),
      },
    }),
  });
}
