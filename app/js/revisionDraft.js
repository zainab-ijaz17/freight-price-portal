// The in-progress revision as it moves through screens 1 → 2 → 3 (diesel
// price entry → vendor selection → review). Held in memory while the
// maintainer works, and saved on the server under their name (see
// server/routes/drafts.js) — on "Save Draft" and automatically at each
// step — so it comes back after a refresh, a sign-out or on another PC.
// A maintainer can keep several saved drafts; the one open here is the one
// being worked on (`draftId`, null until its first save). Removed once
// it's submitted for approval or discarded.
//
// `confirmed` is set once the diesel price has been confirmed; vendor
// selection and review need it (a "Save Draft" from the first screen can
// hold an unfinished, unchecked form).
//
// A draft reopened from returned rate sheets also carries `vendorIds`,
// `effectiveDate`, `overrides` and `returnedFrom` ({ revisionNo, returns:
// [{ vendorName, reason, returnedBy, returnedOn }] }) — the approver's
// comments, shown on every step until it's resubmitted.
import { listSavedDrafts, createSavedDraft, updateSavedDraft, deleteSavedDraft } from './api/revisionsApi.js';
import { getSession } from './session.js';
import { toastError } from './ui.js';

let draft = null;
let draftId = null;
let savedAt = null;
let loadedFor = null; // employee ID whose drafts have been looked at
let saveTimer = null;
let saving = Promise.resolve(); // saves run one at a time, so a new draft is only created once

const AUTOSAVE_DELAY_MS = 800;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveNow().catch((err) => toastError(err, 'Your draft could not be saved.')); }, AUTOSAVE_DELAY_MS);
}

/** Saves the open draft to the server right away; resolves with its saved time (ISO). */
export function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const run = saving.catch(() => {}).then(async () => {
    if (!draft) return null;
    const data = draft;
    const id = draftId;
    const result = id == null ? await createSavedDraft(data) : await updateSavedDraft(id, data);
    if (draftId == null && draft) draftId = result.id; // still the same draft (closeDraft waits for this save)
    if (draftId === result.id) savedAt = result.savedAt;
    return savedAt;
  });
  saving = run;
  return run;
}

/**
 * Once per sign-in, reopens the maintainer's most recently saved draft
 * (the others are listed on "Enter diesel price"). Screens call this
 * before reading getDraft().
 */
export async function ensureDraftLoaded() {
  const employeeId = getSession()?.employeeId;
  if (!employeeId || loadedFor === employeeId) return draft;
  const [latest] = await listSavedDrafts();
  loadedFor = employeeId;
  if (latest && !draft) openDraft(latest);
  return draft;
}

/** Sets the open draft's contents (same saved draft — or a new one if none is open). */
export function startDraft(entry) {
  draft = { vendorIds: [], ...entry };
  scheduleSave();
  return draft;
}

/** Starts a separate draft, leaving the one that was open saved as it is. */
export async function newDraft(entry) {
  await closeDraft();
  return startDraft(entry);
}

/** Opens a saved draft ({ id, data, savedAt } from listSavedDrafts). */
export function openDraft(saved) {
  clearTimeout(saveTimer);
  saveTimer = null;
  draft = saved.data;
  draftId = saved.id;
  savedAt = saved.savedAt;
}

/** Puts the open draft away (saving any pending change) — it stays saved. */
export async function closeDraft() {
  if (saveTimer) await saveNow().catch(() => {});
  await saving.catch(() => {});
  draft = null;
  draftId = null;
  savedAt = null;
}

export function getDraft() {
  return draft;
}

export function getDraftId() {
  return draftId;
}

export function getDraftSavedAt() {
  return savedAt;
}

export function updateDraft(patch) {
  draft = { ...draft, ...patch };
  scheduleSave();
  return draft;
}

/** Submitted or discarded — gone from memory and from the server. */
export async function clearDraft() {
  clearTimeout(saveTimer);
  saveTimer = null;
  await saving.catch(() => {});
  const id = draftId;
  draft = null;
  draftId = null;
  savedAt = null;
  if (id != null) await deleteSavedDraft(id).catch(() => {}); // submitting already removed it server-side
}

/** Deletes a saved draft that isn't the open one. */
export async function discardSavedDraft(id) {
  if (id === draftId) return clearDraft();
  return deleteSavedDraft(id);
}

/**
 * On sign-out: saves any change still waiting for its autosave (must run
 * before the session ends), then forgets the drafts locally only — they
 * stay saved for next time.
 */
export async function forgetDraft() {
  await closeDraft();
  loadedFor = null;
}
