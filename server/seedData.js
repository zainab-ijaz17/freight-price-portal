// Initial contents of server/data/db.json, written the first time the
// server runs. Carried over from the old browser-side mock (app/js/api/mock/
// mockData.js) so the portal starts from the same realistic numbers; from
// here on this is real, editable data (via the Admin screen), not a demo
// fixture that resets on reload.
const VENDORS = [
  { id: 'V1', name: 'Peshawar Lahore Goods', annexure: 'B/1', passThroughPct: 40, roundingRule: 'Nearest 100', stale: false },
  { id: 'V2', name: 'Azam Afridi Goods', annexure: 'B/1', passThroughPct: 40, roundingRule: 'Nearest 100', stale: false },
  { id: 'V3', name: 'Muhammad Pervaiz M.T.', annexure: 'B/3', passThroughPct: 40, roundingRule: 'Nearest 100', stale: false },
  { id: 'V4', name: 'Shahzore (on-call)', annexure: 'B/6', passThroughPct: 40, roundingRule: 'Nearest 100', stale: true },
  { id: 'V5', name: 'Pak Sarhad & FGTA', annexure: 'B/10', passThroughPct: 40, roundingRule: 'Nearest 100', stale: false },
];

const RATE_SHEETS = {
  V1: {
    title: 'Peshawar Lahore Goods Transport Co.',
    annexure: 'B/1',
    cols: ['20ft Container', '40ft Container'],
    weights: ['20 Ton', '30 Ton'],
    rows: [
      ['Akora Khatak', 69100, 122700], ['Bhalwal', 34500, 59600], ['Bahawalpur', 42500, 64000],
      ['Faisalabad', 30900, 56000], ['Gujranwala', 21700, 38200], ['Karachi', 91900, 117200],
      ['Multan', 42500, 64000], ['Peshawar', 74500, 127600], ['Sialkot', 29100, 48100],
    ],
  },
  V2: {
    title: 'Azam Afridi Goods Transport Co.',
    annexure: 'B/1',
    cols: ['20ft Container', '40ft Container'],
    weights: ['20 Ton', '30 Ton'],
    rows: [
      ['Akora Khatak', 69100, 122700], ['Faisalabad', 30900, 56000], ['Karachi', 91900, 117200],
      ['Multan', 42500, 64000], ['Peshawar', 74500, 127600],
    ],
  },
  V3: {
    title: 'Muhammad Pervaiz M.T. — Packages Convertors Limited',
    annexure: 'B/3',
    cols: ['16ft. Mazda', '18ft. Mazda', '18ft. Mazda Container'],
    weights: ['7 Ton', '8 Ton', '9 Ton'],
    rows: [
      ['Bikhi / Feroze Watowan', 17200, 20700, 22800], ['Bhai Pheru', 9600, 15100, 17000],
      ['Faisalabad', 20900, 24800, 27300], ['Gujranwala', 15400, 20700, 22800],
      ['Gakhar', 15800, 19900, 21700], ['Jhang', 21200, 26100, 28300],
      ['Kabirwala', 23500, 28100, 30200], ['Kamoke', 9600, 11700, 13100],
      ['Kasur', 8900, 13200, 14600], ['Kotli', 12100, 16600, 18000],
      ['Mohlanwal', 11700, 13000, 14200], ['Multan', 20400, 26100, 28500],
      ['Muridke', 8800, 11700, 13100], ['Okara', 13900, 20600, 22600],
      ['Raiwind', 13200, 17300, 19000], ['Renala Khurd', 13900, 17100, 19400],
      ['Sahiwal', 13900, 19700, 20400], ['Sheikhupura', 15200, 17500, 19400],
      ['Gulberg / Model Town / Faisal Town / Green Town — within 8 km of Packages Ltd.', 6400, 7200, 7900],
      ['Khana / Chungi / Badami Bagh / Bund Road / Droghewala / Akbari Mandi / DHA / Airport / Railway Station — 8.1–20 km radius', 7400, 7900, 8900],
      ['Packages to 20.1–30 km radius', 10800, 12400, 13100],
      ['Within Packages movement', 3000, null, 4000],
    ],
  },
  V4: {
    title: 'Shahzore On-Call Carriage',
    annexure: 'B/6',
    cols: ['Shahzore'],
    weights: ['3 Ton'],
    rows: [['Akora Khatak', 13700], ['Nowshera', 11100], ['Peshawar', 15200], ['Risalpur', 11900]],
  },
  V5: {
    title: 'Pak Sarhad & FGTA (joint annexure)',
    annexure: 'B/10',
    cols: ['20ft Container', '40ft Container', '45ft Container'],
    weights: ['20 Ton', '30 Ton', '33 Ton'],
    rows: [
      ['Karachi', 91900, 117200, 133200], ['Lahore', 44500, 68400, 77700], ['Multan', 42500, 64000, 72600],
    ],
  },
};

// `factor` only applies to these two pre-existing revisions, which predate
// this store and have no archived snapshot — see rateAtRevision in
// rateEngine.js. Every revision from here on gets an exact snapshot instead.
const REVISIONS = {
  22: { dieselPrice: 390.62, effectiveDate: '30.07.2026', factor: 1, approvedBy: 'M. Ayub Khan', approvedOn: '30.07.2026' },
  21: { dieselPrice: 354.35, effectiveDate: '18.07.2026', factor: 0.9596, approvedBy: 'M. Ayub Khan', approvedOn: '18.07.2026' },
  20: { dieselPrice: 341.06, effectiveDate: '01.07.2026', factor: 0.9317, approvedBy: 'M. Ayub Khan', approvedOn: '01.07.2026' },
};

module.exports = {
  vendors: VENDORS,
  rateSheets: RATE_SHEETS,
  revisions: REVISIONS,
  currentRevisionNo: 22,
  pendingSheets: [],
  returnedSheets: [],
  rateSnapshots: {},
  auditLog: [],
};
