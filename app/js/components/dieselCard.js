// "Current diesel price" strip at the top of each role's home screen: the
// price every rate in effect is based on, and how it moved last time.
import { getCurrentDieselPrice } from '../api/dieselApi.js';
import { escapeHtml, priceStr, pct } from '../ui.js';

export async function mountDieselCard(el) {
  el.hidden = false;
  el.innerHTML = '<div class="diesel-card"><div class="hd">Current diesel price</div><div class="muted" style="font-size:13px">Loading…</div></div>';
  let d;
  try {
    d = await getCurrentDieselPrice();
  } catch {
    el.hidden = true; // the screen itself still works; the price is only context
    return;
  }
  const change = d.previousPrice ? ((d.price - d.previousPrice) / d.previousPrice) * 100 : null;
  el.innerHTML = `
    <div class="diesel-card">
      <div>
        <div class="hd">Current diesel price</div>
        <div class="diesel-card-price num">PKR ${priceStr(d.price)} <span class="diesel-card-unit">per litre</span></div>
      </div>
      ${change == null ? '' : `
        <div>
          <div class="hd">Change</div>
          <div class="diesel-card-value num">${pct(change)} <span class="muted">from PKR ${priceStr(d.previousPrice)}</span></div>
        </div>`}
      <div>
        <div class="hd">Effective from</div>
        <div class="diesel-card-value num">${escapeHtml(d.effectiveDate)}</div>
      </div>
      <div>
        <div class="hd">Revision</div>
        <div class="diesel-card-value num">${d.revisionNo}${d.approvedBy ? ` <span class="muted">· approved by ${escapeHtml(d.approvedBy)}</span>` : ''}</div>
      </div>
    </div>`;
}
