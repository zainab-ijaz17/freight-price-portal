// Structural master data changes (see routes/changeRequests.js). Most are
// raised by an Administrator and need a Rate Approver's sign-off; `direct`
// kinds (new destinations and vehicle types) are the Rate Approver's own to
// add, and take effect as soon as they're added. Each kind has a `validate`
// (run when the request is raised, and again when it's approved, since
// the data may have moved on in between) and an `apply` that performs it
// against the in-memory `db` inside the approval's transaction.
const { vendorById, isValidDMY, parseDMY } = require('./rateEngine');
const { fail } = require('./errors');

const ROUNDING_RULES = ['Nearest 100', 'Nearest 50', 'None'];

function sameName(a, b) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// '' / null → no rate yet (typed in at the next revision's review step);
// anything else must be a whole, non-negative number of rupees.
function parseRates(list, labels, code, fieldPrefix) {
  return list.map((r, i) => {
    if (r === '' || r == null) return null;
    const n = Number(r);
    if (!Number.isFinite(n) || n < 0) {
      throw fail(code, `"${r}" is not a valid rate for ${labels[i]}. Enter a whole number of rupees, or leave it blank.`, { field: `${fieldPrefix} · ${labels[i]}` });
    }
    return Math.round(n);
  });
}

function validateAgreementTerms(t, { partial = false } = {}) {
  if (t.passThroughPct != null || !partial) {
    const pct = Number(t.passThroughPct);
    if (t.passThroughPct === '' || !(pct >= 0 && pct <= 100)) {
      throw fail('MD-001', 'Pass-through % must be a number from 0 to 100.', { field: 'Pass-through %' });
    }
  }
  if (t.roundingRule != null && !ROUNDING_RULES.includes(t.roundingRule)) {
    throw fail('MD-002', `Rounding rule must be one of: ${ROUNDING_RULES.join(', ')}.`, { field: 'Rounding rule' });
  }
  for (const [key, label] of [['validityStart', 'Valid from'], ['validityEnd', 'Valid to']]) {
    if (t[key] && !isValidDMY(t[key])) {
      throw fail('MD-003', `Enter "${label}" as DD.MM.YYYY.`, { field: label });
    }
  }
}

function checkValidityOrder(start, end) {
  if (start && end && parseDMY(end) < parseDMY(start)) {
    throw fail('MD-004', `"Valid to" (${end}) cannot be earlier than "Valid from" (${start}).`, { field: 'Valid to' });
  }
}

function sheetFor(db, vendorId) {
  const v = vendorById(db, vendorId);
  return { v, sheet: db.rateSheets[vendorId] };
}

function findRow(sheet, destination) {
  return sheet.rows.find((r) => sameName(r[0], destination));
}

const KINDS = {
  add_vendor: {
    validate(db, p) {
      if (!p.name?.trim()) throw fail('MD-005', 'Enter the vendor name.', { field: 'Vendor name' });
      if (db.vendors.some((v) => sameName(v.name, p.name))) {
        throw fail('MD-014', `A vendor called "${p.name.trim()}" already exists.`, { status: 409, field: 'Vendor name' });
      }
      validateAgreementTerms(p);
      checkValidityOrder(p.validityStart, p.validityEnd);
      if (!p.firstDestination?.trim()) throw fail('MD-006', 'A new vendor needs a first destination.', { field: 'First destination' });
      if (!p.firstVehicleType?.trim()) throw fail('MD-006', 'A new vendor needs a first vehicle type.', { field: 'First vehicle type' });
      parseRates([p.firstBaseRate], [p.firstVehicleType], 'MD-013', 'Base rate');
    },
    summary: (db, p) => `Add vendor "${p.name.trim()}"`,
    apply(db, p) {
      const id = 'V' + Date.now().toString(36).toUpperCase();
      const annexure = p.annexure?.trim() || '—';
      db.vendors.push({
        id,
        name: p.name.trim(),
        annexure,
        passThroughPct: Number(p.passThroughPct),
        roundingRule: p.roundingRule || 'Nearest 100',
        stale: false,
        validityStart: p.validityStart || null,
        validityEnd: p.validityEnd || null,
      });
      db.rateSheets[id] = {
        title: p.name.trim(),
        annexure,
        cols: [p.firstVehicleType.trim()],
        weights: [p.firstWeight?.trim() || '—'],
        rows: [[p.firstDestination.trim(), ...parseRates([p.firstBaseRate], [p.firstVehicleType], 'MD-013', 'Base rate')]],
      };
      return id;
    },
  },

  add_destination: {
    direct: true,
    validate(db, p) {
      const { sheet } = sheetFor(db, p.vendorId);
      if (!p.destination?.trim()) throw fail('MD-007', 'Enter the destination name.', { field: 'Destination' });
      if (findRow(sheet, p.destination)) {
        throw fail('MD-009', `"${p.destination.trim()}" is already on this vendor's rate sheet.`, { status: 409, field: 'Destination' });
      }
      if (!Array.isArray(p.baseRates) || p.baseRates.length !== sheet.cols.length) {
        throw fail('MD-008', `Enter a base rate (or leave blank) for each of the ${sheet.cols.length} vehicle type(s).`, { field: 'Base rates' });
      }
      parseRates(p.baseRates, sheet.cols, 'MD-013', 'Base rate');
    },
    summary: (db, p) => `Add destination "${p.destination.trim()}" to ${vendorById(db, p.vendorId).name}`,
    apply(db, p) {
      const sheet = db.rateSheets[p.vendorId];
      sheet.rows.push([p.destination.trim(), ...parseRates(p.baseRates, sheet.cols, 'MD-013', 'Base rate')]);
    },
  },

  add_vehicle_type: {
    direct: true,
    validate(db, p) {
      const { sheet } = sheetFor(db, p.vendorId);
      if (!p.vehicleType?.trim()) throw fail('MD-011', 'Enter the vehicle type name.', { field: 'Vehicle type' });
      if (sheet.cols.some((c) => sameName(c, p.vehicleType))) {
        throw fail('MD-012', `"${p.vehicleType.trim()}" is already a vehicle type on this rate sheet.`, { status: 409, field: 'Vehicle type' });
      }
      const rates = p.baseRates ?? [];
      if (!Array.isArray(rates) || (rates.length && rates.length !== sheet.rows.length)) {
        throw fail('MD-008', `Enter a base rate (or leave blank) for each of the ${sheet.rows.length} destination(s).`, { field: 'Base rates' });
      }
      parseRates(rates, sheet.rows.map((r) => r[0]), 'MD-013', 'Base rate');
    },
    summary: (db, p) => `Add vehicle type "${p.vehicleType.trim()}" to ${vendorById(db, p.vendorId).name}`,
    apply(db, p) {
      const sheet = db.rateSheets[p.vendorId];
      const rates = p.baseRates?.length ? parseRates(p.baseRates, sheet.rows.map((r) => r[0]), 'MD-013', 'Base rate') : sheet.rows.map(() => null);
      sheet.cols.push(p.vehicleType.trim());
      sheet.weights.push(p.weight?.trim() || '—');
      sheet.rows.forEach((row, i) => row.push(rates[i]));
    },
  },

  delete_vendor: {
    needsReason: true,
    validate(db, p) {
      vendorById(db, p.vendorId);
    },
    summary: (db, p) => `Delete vendor ${vendorById(db, p.vendorId).name}`,
    apply(db, p) {
      db.vendors = db.vendors.filter((v) => v.id !== p.vendorId);
      delete db.rateSheets[p.vendorId];
      // rate_snapshots are kept on purpose: past revisions stay auditable.
    },
  },

  delete_destination: {
    needsReason: true,
    validate(db, p) {
      const { sheet } = sheetFor(db, p.vendorId);
      if (!p.destination || !findRow(sheet, p.destination)) {
        throw fail('MD-010', `"${p.destination}" is not on this vendor's rate sheet any more.`, { status: 404, field: 'Destination' });
      }
    },
    summary: (db, p) => `Delete destination "${p.destination}" from ${vendorById(db, p.vendorId).name}`,
    apply(db, p) {
      const sheet = db.rateSheets[p.vendorId];
      sheet.rows = sheet.rows.filter((r) => !sameName(r[0], p.destination));
    },
  },
};

function kindSpec(kind) {
  const spec = KINDS[kind];
  if (!spec) throw fail('CR-006', `"${kind}" is not a recognised master data change.`);
  return spec;
}

module.exports = { KINDS, kindSpec, ROUNDING_RULES, validateAgreementTerms, checkValidityOrder, parseRates, findRow };
