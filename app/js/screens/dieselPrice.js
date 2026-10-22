import { getCurrentDieselPrice } from '../api/dieselApi.js';
import { getReturnedSheets, getApprovalQueue, listSavedDrafts } from '../api/revisionsApi.js';
import { uploadNotification } from '../api/notificationsApi.js';
import {
  getDraft, getDraftId, startDraft, newDraft, openDraft, closeDraft, updateDraft, ensureDraftLoaded,
  clearDraft, discardSavedDraft, saveNow, getDraftSavedAt,
} from '../revisionDraft.js';
import { returnedNoticeHtml } from '../components/returnedNotice.js';
import {
  withAsyncState, escapeHtml, priceStr, pct, daysBetween, parseDisplayDate, isValidDisplayDate, formatDateTime,
  dateField, wireDateFields, codedError, showInlineError, toastError, toast, openDialog, closeDialog, personLabel,
} from '../ui.js';

export const title = 'Enter Diesel Price';

export function mount(container) {
  const controller = new AbortController();
  load(container);
  return () => { controller.abort(); closeDialog(); };
}

function load(container) {
  const loader = async () => {
    await ensureDraftLoaded();
    const [previous, returned, drafts, queue] = await Promise.all([
      getCurrentDieselPrice(), getReturnedSheets(), listSavedDrafts(), getApprovalQueue(),
    ]);
    return { previous, returned, drafts, queue };
  };
  withAsyncState(container, loader, (ctx) => render(container, ctx), {
    loadingLabel: 'Loading current diesel price…',
  });
}

function signed(n, digits) {
  const s = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: digits });
  return `${n < 0 ? '−' : '+'}PKR ${s}`;
}

// Returned sheets, one group per revision: reopened together as one draft.
function returnedGroups(returned) {
  const groups = new Map();
  returned.forEach((r) => groups.set(r.revisionNo, [...(groups.get(r.revisionNo) || []), r]));
  return [...groups.entries()].map(([revisionNo, sheets]) => ({
    revisionNo,
    sheets,
    returns: sheets.map((s) => ({ vendorName: s.vendorName, reason: s.reason, returnedBy: s.returnedBy, returnedOn: s.returnedOn })),
  }));
}

function draftSummary(d) {
  const parts = [];
  parts.push(d.dieselPrice != null ? `PKR ${priceStr(d.dieselPrice)}` : 'No price yet');
  if (d.dieselEffectiveDate) parts.push(`effective ${d.dieselEffectiveDate}`);
  parts.push(d.vendorIds?.length ? `${d.vendorIds.length} vendor${d.vendorIds.length === 1 ? '' : 's'}` : 'no vendors picked');
  return parts.join(' · ');
}

function render(container, ctx) {
  const { previous } = ctx;
  const draft = getDraft();
  const groups = returnedGroups(ctx.returned);

  container.innerHTML = `
    ${groups.map((g) => {
      const correcting = draft?.returnedFrom?.revisionNo === g.revisionNo;
      const submitter = g.sheets[0].submittedBy;
      return `<div style="max-width:1080px;margin-bottom:18px">${returnedNoticeHtml(g, {
        compact: correcting,
        actionsHtml: correcting ? '' : `
          <div class="row-gap" style="margin-top:12px">
            <button class="btn btn-primary" data-reopen="${g.revisionNo}">Revise and resubmit</button>
            <span class="muted" style="font-size:12px">Opens a new draft from the submission by ${escapeHtml(personLabel(submitter))}, with its figures, attachment and ${g.sheets.length === 1 ? 'vendor' : `${g.sheets.length} vendors`} already filled in.</span>
          </div>`,
      })}</div>`;
    }).join('')}
    ${groups.length ? '<div style="height:6px"></div>' : ''}
    <div style="display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:34px;max-width:1080px">
      <div>
        <div class="row-gap" style="align-items:baseline">
          <h3 style="margin-bottom:3px">Enter diesel price</h3>
          ${draft ? `<span class="tag tag-neutral">${getDraftId() == null ? 'New draft' : 'Saved draft'}</span>` : ''}
        </div>
        <p class="muted" style="font-size:13px;max-width:46ch">One entry reprices every indexed contract. Values are checked again on confirm.</p>

        <form id="diesel-form" class="grid-2" style="margin-top:20px" novalidate>
          <div class="field">
            <label for="price">Diesel price per litre (PKR, up to 3 decimals)</label>
            <input class="input num" id="price" name="price" type="number" step="0.001" min="0" required>
          </div>
          <div class="field">
            <label for="effectiveDate">Effective date</label>
            ${dateField('effectiveDate', { min: previous.effectiveDate })}
          </div>
          <div class="field">
            <label for="source">Source</label>
            <select class="input" id="source" name="source">
              <option>PSO</option>
              <option>OGRA</option>
              <option>Other</option>
            </select>
          </div>
          <div></div>
          <div class="field" style="grid-column:1/-1">
            <label>Attach notification <span style="color:var(--color-warning)">· required</span></label>
            <div class="row-gap">
              <input type="file" id="notification" name="notification" accept=".pdf,.jpg,.jpeg,.png" style="max-width:340px">
              <span class="muted" style="font-size:12px" id="notification-status"></span>
            </div>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label for="remarks">Remarks <span class="muted">· optional</span></label>
            <textarea class="input" id="remarks" name="remarks" style="min-height:70px"></textarea>
          </div>
        </form>

        <div id="form-error" class="inline-error" hidden></div>

        <div class="end" style="justify-content:flex-start;align-items:center;margin-top:22px">
          <button class="btn btn-secondary" type="button" id="save-draft">Save Draft</button>
          <button class="btn btn-primary" type="button" id="open-confirm">Confirm</button>
          <span class="muted" style="font-size:12px;margin-left:6px" id="draft-status"></span>
        </div>
      </div>

      <div style="padding-top:6px">
        <div class="hd" style="display:flex;gap:6px;align-items:center;margin-bottom:10px">Calculated · read-only</div>
        <div class="stack">
          <div><div class="ro-lab">Previous price</div><div class="ro num">PKR ${priceStr(previous.price)}</div></div>
          <div><div class="ro-lab">Previous effective date</div><div class="ro num">${escapeHtml(previous.effectiveDate)}</div></div>
          <div><div class="ro-lab">Change</div><div class="ro num" id="change-line">—</div></div>
          <div><div class="ro-lab">Days since last revision</div><div class="ro num" id="days-since">—</div></div>
        </div>
        <p class="muted" style="font-size:11.5px;margin-top:14px;line-height:1.5">Dashed fields are system-calculated and never editable.</p>
      </div>
    </div>

    <div class="grid-2" id="work-lists" style="max-width:1080px;margin-top:40px;gap:34px;align-items:start">
      <div>
        <div class="spread">
          <div class="hd">Your saved drafts · <span class="num">${ctx.drafts.length}</span></div>
          ${draft ? '<button class="btn btn-ghost" id="new-draft" style="font-size:12.5px">Start a new revision</button>' : ''}
        </div>
        <div style="margin-top:10px">
          ${ctx.drafts.length ? ctx.drafts.map((d) => {
            const open = d.id === getDraftId();
            return `
              <div class="card elev-sm list-card">
                <div class="spread" style="gap:12px;align-items:flex-start">
                  <div style="min-width:0">
                    <div style="font-size:13.5px">${escapeHtml(draftSummary(d.data))}${open ? ' <span class="tag tag-accent" style="font-size:10px;margin-left:6px">open</span>' : ''}</div>
                    <div class="muted" style="font-size:12px;margin-top:3px">Saved <span class="num">${escapeHtml(formatDateTime(d.savedAt))}</span>${d.data.returnedFrom ? ` · correcting revision ${d.data.returnedFrom.revisionNo}` : ''}${d.data.confirmed ? '' : ' · price not confirmed yet'}</div>
                  </div>
                  <div class="row-gap" style="flex:none">
                    ${open ? '' : `<button class="btn btn-secondary" data-open-draft="${d.id}">Open</button>`}
                    <button class="link-btn" data-delete-draft="${d.id}">Delete</button>
                  </div>
                </div>
              </div>`;
          }).join('') : '<p class="muted" style="font-size:13px">None. "Save Draft" keeps the revision you are working on here, and you can keep several.</p>'}
        </div>
      </div>
      <div>
        <div class="hd">Waiting for approval · <span class="num">${ctx.queue.length}</span></div>
        <div style="margin-top:10px">
          ${ctx.queue.length ? `
            <table class="table">
              <thead><tr><th style="text-align:right">Rev.</th><th>Vendor</th><th>Submitted by</th><th style="text-align:right">On</th></tr></thead>
              <tbody>
                ${ctx.queue.map((s) => `
                  <tr>
                    <td class="num" style="text-align:right">${s.revisionNo}</td>
                    <td>${escapeHtml(s.vendorName)}</td>
                    <td style="font-size:12.5px">${escapeHtml(personLabel(s.submittedBy))}</td>
                    <td class="num" style="text-align:right">${escapeHtml(s.submittedOn)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
            <p class="muted" style="font-size:12px;margin-top:8px">Each vendor's sheet is approved on its own. A vendor with a sheet waiting can't go into another revision until it's decided.</p>`
          : '<p class="muted" style="font-size:13px">Nothing is waiting for approval.</p>'}
        </div>
      </div>
    </div>
  `;
  wireDateFields(container);
  const rerender = () => load(container);

  const form = container.querySelector('#diesel-form');
  const dateInput = container.querySelector('#effectiveDate');
  const changeLine = container.querySelector('#change-line');
  const daysSince = container.querySelector('#days-since');
  const errorEl = container.querySelector('#form-error');
  const notificationStatus = container.querySelector('#notification-status');
  const draftStatus = container.querySelector('#draft-status');

  function showDraftStatus() {
    const at = getDraftSavedAt();
    if (!getDraft() || !at) {
      draftStatus.innerHTML = '';
      return;
    }
    draftStatus.innerHTML = `Draft saved <span class="num">${escapeHtml(formatDateTime(at))}</span> · <button class="link-btn" id="discard-draft">Discard draft</button>`;
    draftStatus.querySelector('#discard-draft').addEventListener('click', () => {
      openDialog(`
        <div class="dialog-title">Discard this draft?</div>
        <div class="dialog-body">The saved diesel price, vendor selection and any rates you typed in are deleted. This can't be undone.</div>
        <div class="dialog-actions">
          <button class="btn btn-secondary" id="dlg-cancel">Keep draft</button>
          <button class="btn btn-primary" id="dlg-confirm">Discard draft</button>
        </div>
      `);
      document.getElementById('dlg-cancel').addEventListener('click', closeDialog);
      document.getElementById('dlg-confirm').addEventListener('click', async () => {
        await clearDraft();
        closeDialog();
        toast('Draft discarded.', 'info');
        rerender();
      });
    });
  }
  showDraftStatus();

  container.querySelector('#new-draft')?.addEventListener('click', async () => {
    await closeDraft();
    toast('Your draft is saved under "Your saved drafts". Starting a new one.', 'info');
    rerender();
  });

  container.querySelector('#work-lists').addEventListener('click', async (e) => {
    const openId = e.target.dataset?.openDraft;
    const deleteId = e.target.dataset?.deleteDraft;
    if (openId) {
      await closeDraft();
      openDraft(ctx.drafts.find((d) => String(d.id) === openId));
      rerender();
    } else if (deleteId) {
      const d = ctx.drafts.find((x) => String(x.id) === deleteId);
      openDialog(`
        <div class="dialog-title">Delete this draft?</div>
        <div class="dialog-body">${escapeHtml(draftSummary(d.data))}, saved ${escapeHtml(formatDateTime(d.savedAt))}. It is deleted for good.</div>
        <div class="dialog-actions">
          <button class="btn btn-secondary" id="dlg-cancel">Keep draft</button>
          <button class="btn btn-primary" id="dlg-confirm">Delete draft</button>
        </div>
      `);
      document.getElementById('dlg-cancel').addEventListener('click', closeDialog);
      document.getElementById('dlg-confirm').addEventListener('click', async () => {
        try {
          await discardSavedDraft(d.id);
          closeDialog();
          toast('Draft deleted.', 'info');
          rerender();
        } catch (err) {
          closeDialog();
          toastError(err, 'Could not delete the draft.');
        }
      });
    }
  });

  // { id, originalName } once uploaded — this, not the file input, is what
  // "attached" means: the file has actually reached the server and has a
  // real reference other screens can use to retrieve it later.
  let notification = null;

  function recalc() {
    const price = Number(form.price.value);
    if (form.price.value && !Number.isNaN(price)) {
      const diff = price - previous.price;
      changeLine.textContent = `${signed(diff, 3)} · ${pct((diff / previous.price) * 100)}`;
    } else {
      changeLine.textContent = '—';
    }
    daysSince.textContent = isValidDisplayDate(dateInput.value) ? daysBetween(dateInput.value, previous.effectiveDate) : '—';
  }
  form.price.addEventListener('input', recalc);
  dateInput.addEventListener('input', recalc);
  dateInput.addEventListener('change', recalc);

  // Restore an in-progress draft (e.g. the user went on to vendor
  // selection and came back, or reopened a returned revision) instead of
  // showing a blank form. The file itself can't be repopulated into the
  // input, but it's already uploaded — its reference carries over directly.
  if (draft) {
    dateInput.value = draft.dieselEffectiveDate || '';
    form.price.value = draft.dieselPrice ?? '';
    form.source.value = draft.source || 'PSO';
    form.remarks.value = draft.remarks || '';
    if (draft.notificationId) {
      notification = { id: draft.notificationId, originalName: draft.notificationFileName };
      notificationStatus.textContent = `Attached: ${draft.notificationFileName}`;
    }
    recalc();
  }

  container.querySelectorAll('[data-reopen]').forEach((btn) => btn.addEventListener('click', async () => {
    const g = groups.find((x) => String(x.revisionNo) === btn.dataset.reopen);
    const first = g.sheets[0].draft;
    await newDraft({
      ...first,
      vendorIds: g.sheets.flatMap((s) => s.draft.vendorIds),
      overrides: Object.assign({}, ...g.sheets.map((s) => s.draft.overrides || {})),
      returnedFrom: { revisionNo: g.revisionNo, returns: g.returns },
      previousDieselPrice: previous.price,
      previousEffectiveDate: previous.effectiveDate,
    });
    rerender();
    toast('Returned sheets reopened as a new draft. Make the corrections, then continue through vendors and review to resubmit.', 'info', 6000);
  }));

  form.notification.addEventListener('change', async () => {
    const file = form.notification.files[0];
    if (!file) return;
    notification = null;
    notificationStatus.textContent = 'Uploading…';
    try {
      notification = await uploadNotification(file);
      notificationStatus.textContent = `Attached: ${notification.originalName}`;
    } catch (err) {
      notificationStatus.textContent = '';
      toastError(err, 'Upload failed.');
      form.notification.value = '';
    }
  });

  // Saves the form as it stands — even unfinished — without the checks
  // Confirm runs; it's confirmed (and validated) later.
  container.querySelector('#save-draft').addEventListener('click', async () => {
    const fields = {
      dieselPrice: form.price.value === '' ? null : Number(form.price.value),
      dieselEffectiveDate: dateInput.value,
      source: form.source.value,
      notificationId: notification?.id ?? null,
      notificationFileName: notification?.originalName ?? null,
      remarks: form.remarks.value,
      confirmed: false, // edited since any earlier Confirm — must be confirmed again
    };
    if (getDraft()) updateDraft(fields); else startDraft(fields);
    try {
      const at = await saveNow();
      toast(`Draft saved ${formatDateTime(at)}. It isn't submitted yet — it stays under "Your saved drafts" until you submit or delete it.`, 'success', 6000);
      rerender();
    } catch (err) {
      toastError(err, 'Your draft could not be saved.');
    }
  });

  function validate() {
    const price = Number(form.price.value);
    if (!form.price.value || !(price > 0)) {
      return codedError('DSL-001', 'Enter a diesel price greater than zero.', 'Diesel price per litre');
    }
    if (!isValidDisplayDate(dateInput.value)) {
      return codedError('DSL-002', 'Enter the effective date as DD.MM.YYYY, or pick it from the calendar.', 'Effective date');
    }
    if (parseDisplayDate(dateInput.value) < parseDisplayDate(previous.effectiveDate)) {
      return codedError('DSL-003', `The effective date cannot be earlier than the last confirmed price (${previous.effectiveDate}).`, 'Effective date');
    }
    if (!notification) {
      return codedError('DSL-004', 'Attach the diesel-price notification, and wait for it to finish uploading.', 'Attach notification');
    }
    return null;
  }

  container.querySelector('#open-confirm').addEventListener('click', () => {
    errorEl.hidden = true;
    const err = validate();
    if (err) {
      showInlineError(errorEl, err);
      return;
    }
    const price = Number(form.price.value);
    const dieselEffectiveDate = dateInput.value;

    openDialog(`
      <div class="dialog-title">Confirm diesel price</div>
      <div class="dialog-body">You are confirming diesel at PKR <span class="num">${priceStr(price)}</span> per litre, effective <span class="num">${escapeHtml(dieselEffectiveDate)}</span>.</div>
      <div class="dialog-body" style="opacity:.6;font-size:12.5px">This price becomes the basis for every indexed contract you select next.</div>
      <div class="dialog-actions">
        <button class="btn btn-secondary" id="dlg-cancel">Go back and edit</button>
        <button class="btn btn-primary" id="dlg-confirm">Confirm price</button>
      </div>
    `);
    document.getElementById('dlg-cancel').addEventListener('click', closeDialog);
    document.getElementById('dlg-confirm').addEventListener('click', () => {
      // Keep what later steps already picked (vendors, and for a returned
      // revision its rates-effective date, typed rates and comments).
      const carry = getDraft();
      startDraft({
        vendorIds: carry?.vendorIds || [],
        ...(carry?.returnedFrom ? { returnedFrom: carry.returnedFrom, effectiveDate: carry.effectiveDate, overrides: carry.overrides } : {}),
        confirmed: true,
        dieselPrice: price,
        dieselEffectiveDate,
        source: form.source.value,
        notificationId: notification.id,
        notificationFileName: notification.originalName,
        remarks: form.remarks.value,
        previousDieselPrice: previous.price,
        previousEffectiveDate: previous.effectiveDate,
      });
      closeDialog();
      location.hash = '#/vendors';
    });
  });
}
