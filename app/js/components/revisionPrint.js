// The printable "rate revision" sheet for one vendor — current, increase
// and new rate for every line, with the basis and signature boxes. Printed
// by the maintainer from "Review before / after" and by the approver from
// "Approve and release".
import { printSheet, printTable, printSignatures } from './printSheet.js';
import { money, priceStr, pct, personLabel } from '../ui.js';

/**
 * `s`: { revisionNo, vendorName, worksheet, dieselPrice, previousDieselPrice,
 *   dieselEffectiveDate, effectiveDate, upliftPct, upliftBasis, source,
 *   submittedBy, submittedOn, notificationFileName, remarks, status }
 */
export function revisionSheetHtml(s) {
  const w = s.worksheet;
  const head = [
    [{ text: 'S.No' }, { text: 'Destination' }, ...w.cols.map((c, j) => ({ text: `${c}${w.weights[j] ? ` (${w.weights[j]})` : ''}`, colspan: 3, align: 'center' }))],
    [{ text: '' }, { text: '' }, ...w.cols.flatMap(() => [{ text: 'Current', align: 'right' }, { text: 'Increase', align: 'right' }, { text: 'New', align: 'right' }])],
  ];
  const amount = (v) => (v == null ? '—' : money(v));
  const body = w.rows.map((r) => [
    { text: r.no, align: 'right' },
    r.dest,
    ...r.base.flatMap((b, j) => [
      { text: amount(b), align: 'right' },
      { text: amount(r.inc[j]), align: 'right' },
      { text: amount(r.rounded[j]), align: 'right', strong: true },
    ]),
  ]);

  const meta = [
    `Diesel price: PKR ${priceStr(s.dieselPrice)} per litre${s.previousDieselPrice ? ` (previously PKR ${priceStr(s.previousDieselPrice)})` : ''}, effective ${s.dieselEffectiveDate}${s.source ? ` · ${s.source}` : ''}`,
    `New rates effective from: ${s.effectiveDate}`,
    `Rate change: ${pct(s.upliftPct)}${s.upliftBasis ? ` (${s.upliftBasis})` : ''}`,
    `Status: ${s.status}`,
  ];
  if (s.submittedBy) meta.push(`Submitted by: ${personLabel(s.submittedBy)} on ${s.submittedOn}`);
  if (s.notificationFileName) meta.push(`Notification: ${s.notificationFileName}`);
  if (s.remarks) meta.push(`Remarks: ${s.remarks}`);

  return printSheet({
    title: `Rate revision ${s.revisionNo} — ${s.vendorName}`,
    subtitle: `${w.title} · Annexure ${w.annexure}`,
    meta,
    tableHtml: printTable(head, body),
    afterHtml: printSignatures([
      { label: 'Prepared by (Rate Maintainer)', name: s.submittedBy ? personLabel(s.submittedBy) : '', date: s.submittedOn },
      { label: 'Checked by' },
      { label: 'Approved by (Rate Approver)' },
    ]),
  });
}
