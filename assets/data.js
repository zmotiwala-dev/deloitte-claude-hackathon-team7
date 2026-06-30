/* =====================================================================
 * data.js  —  Shared utilities, CSV parsing, and sample data generation
 * 13-Week Direct Cash Forecast Generator
 * ===================================================================== */

/* ----------------------------- Date helpers ----------------------------- */
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(v) {
  if (v instanceof Date) return v;
  if (v == null || v === '') return null;
  // Accept ISO (YYYY-MM-DD) and US (M/D/YYYY)
  const s = String(v).trim();
  let d;
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) {
    const [y, m, day] = s.split('-').map(Number);
    d = new Date(y, m - 1, day);
  } else if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(s)) {
    const [m, day, y] = s.split('/').map(Number);
    d = new Date(y < 100 ? 2000 + y : y, m - 1, day);
  } else {
    d = new Date(s);
  }
  return isNaN(d.getTime()) ? null : d;
}

function isoDate(d) {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d, n) { return new Date(d.getTime() + n * DAY_MS); }

function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay(); // 0 Sun .. 6 Sat
  const diff = (dow === 0 ? -6 : 1 - dow);
  return addDays(x, diff);
}

// Week index (1..13) for a date given the forecast start (a Monday). null if outside.
function weekIndex(date, startDate) {
  if (!date) return null;
  const diff = Math.floor((date - startDate) / DAY_MS);
  if (diff < 0) return 1; // pull anything overdue/past into W1
  const wk = Math.floor(diff / 7) + 1;
  return wk > 13 ? null : wk;
}

function weekStart(startDate, wk) { return addDays(startDate, (wk - 1) * 7); }

function weekLabel(startDate, wk) {
  const s = weekStart(startDate, wk);
  return `W${wk} · ${s.getMonth() + 1}/${s.getDate()}`;
}

/* ----------------------------- Money helpers ----------------------------- */
function fmtMoney(n, dp) {
  if (n == null || isNaN(n)) return '–';
  const d = dp == null ? 0 : dp;
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtM(n) {
  if (n == null || isNaN(n)) return '–';
  return (n < 0 ? '-' : '') + '$' + (Math.abs(n) / 1e6).toFixed(2) + 'M';
}
function fmtPct(n, dp) { return (n == null || isNaN(n)) ? '–' : (n * 100).toFixed(dp == null ? 1 : dp) + '%'; }

/* ----------------------------- CSV parsing ----------------------------- */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.some(c => c.trim() !== '')).map(r => {
    const o = {};
    headers.forEach((h, idx) => { o[h] = (r[idx] != null ? r[idx].trim() : ''); });
    return o;
  });
}

// Flexible column getter (case-insensitive, fuzzy)
function col(obj, ...names) {
  const keys = Object.keys(obj);
  for (const n of names) {
    const want = n.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const k of keys) {
      if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === want) return obj[k];
    }
  }
  // partial match fallback
  for (const n of names) {
    const want = n.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const k of keys) {
      const kk = k.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (kk.includes(want) || want.includes(kk)) return obj[k];
    }
  }
  return '';
}

function num(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[$,()\s]/g, '').replace(/[^0-9.\-]/g, ''));
  if (String(v).includes('(')) return -Math.abs(n || 0);
  return isNaN(n) ? 0 : n;
}

function toCSV(headers, rows) {
  const esc = v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers.map(esc).join(',')].concat(rows.map(r => r.map(esc).join(','))).join('\n');
}

/* ----------------------------- Aging bucket ----------------------------- */
function agingBucket(invoiceDate, asOf) {
  const days = Math.floor((asOf - invoiceDate) / DAY_MS);
  if (days <= 30) return '0–30';
  if (days <= 60) return '31–60';
  if (days <= 90) return '61–90';
  return '90+';
}

/* =====================================================================
 * SAMPLE DATA GENERATION
 * Dates are generated relative to the forecast start so the demo always
 * populates W1–W13 and reliably produces a liquidity-risk window.
 * ===================================================================== */
function buildSampleData(startDate) {
  const s = startDate;
  const data = { ar: [], ap: [], payroll: [], debt: [], capex: [] };

  /* ---- AR Aging ----
   * [customer, tier, collectWeek, amount, invoiceAgeDays]
   * Confidence is assigned by tier in engine.js: T1=High, T2=Medium, T3=Low.
   * W7 is deliberately thin so the Term Loan A balloon creates a liquidity crisis. */
  const DSO_GEN = { 'Tier 1': 4, 'Tier 2': 9, 'Tier 3': 16 };
  const arSpec = [
    // ── Tier 1: reliable payers, predictable DSO ──────────────────────────
    ['Acme Corporation',        'Tier 1',  1, 1500000, 22],
    ['Global Retail Group',     'Tier 1',  1, 1000000, 30],
    ['Summit Healthcare',       'Tier 1',  2, 1200000, 18],
    ['Acme Corporation',        'Tier 1',  3, 1600000, 12],
    ['Global Retail Group',     'Tier 1',  4, 1300000, 26],
    ['Summit Healthcare',       'Tier 1',  5, 1600000, 20],
    ['Acme Corporation',        'Tier 1',  6, 1700000,  9],
    ['Summit Healthcare',       'Tier 1',  9, 1800000, 19],
    ['Global Retail Group',     'Tier 1',  9, 1600000, 28],
    ['Acme Corporation',        'Tier 1', 10, 1400000, 14],
    ['Global Retail Group',     'Tier 1', 11, 1400000, 24],
    ['Acme Corporation',        'Tier 1', 12, 1300000, 16],
    ['Summit Healthcare',       'Tier 1', 13, 1200000, 21],
    // Additional T1 — smaller accounts, later weeks (no W7-opening impact)
    ['Pinnacle Financial',      'Tier 1',  8,  340000, 19],
    ['Metropolitan Medical',    'Tier 1', 10,  410000, 22],
    ['Northstar Energy',        'Tier 1', 12,  280000, 18],
    // ── Tier 2: moderate payment reliability ──────────────────────────────
    ['Northwind Traders',       'Tier 2',  2, 1400000, 40],
    ['Pioneer Manufacturing',   'Tier 2',  3, 1400000, 55],
    ['Blue Ocean Logistics',    'Tier 2',  4, 1500000, 33],
    ['Northwind Traders',       'Tier 2',  6, 1300000, 35],
    ['Pioneer Manufacturing',   'Tier 2',  8, 1700000, 22],
    ['Vendor Solutions Inc',    'Tier 2',  8, 1500000, 15],
    ['Blue Ocean Logistics',    'Tier 2', 10, 1600000, 30],
    ['Northwind Traders',       'Tier 2', 11, 1200000, 38],
    ['Pioneer Manufacturing',   'Tier 2', 12, 1100000, 44],
    // Additional T2 — mid-tier, wider customer base
    ['Eastern Distribution',    'Tier 2',  9,  460000, 38],
    ['Heritage Foods',          'Tier 2', 10,  380000, 33],
    ['Pacific Trade Co',        'Tier 2', 11,  320000, 42],
    ['Eastern Distribution',    'Tier 2', 13,  290000, 36],
    // ── Tier 3: slow/unreliable payers, wide aging — Low confidence ────────
    ['West Region Distributors','Tier 3',  5, 1000000, 70],
    ['West Region Distributors','Tier 3',  7,  600000, 85],  // light W7 — July 4 holiday cycle
    // Additional T3 — small accounts, long aging (90+ buckets), spread W4–W13
    ['Valley Staffing',         'Tier 3',  4,  120000, 78],  // 61–90 days
    ['Cascade Retail',          'Tier 3',  5,   95000, 82],  // 90+ days
    ['Delta Service Co',        'Tier 3',  6,  180000, 68],
    ['Valley Staffing',         'Tier 3',  8,  165000, 74],
    ['Cascade Retail',          'Tier 3',  9,  215000, 91],  // 90+ days
    ['Delta Service Co',        'Tier 3', 10,  195000, 80],  // 90+ days
    ['Valley Staffing',         'Tier 3', 11,  140000, 88],  // 90+ days
    ['Cascade Retail',          'Tier 3', 12,  175000, 71],
    ['Delta Service Co',        'Tier 3', 13,  155000, 86],  // 90+ days
  ];
  // Totals: 16 Tier 1, 13 Tier 2, 11 Tier 3 = 40 AR records
  let arId = 1000;
  arSpec.forEach(([cust, tier, cw, amt, age]) => {
    const dso = DSO_GEN[tier] || 7;
    const due = addDays(weekStart(s, cw), 2 - dso);
    const inv = addDays(due, -age);
    data.ar.push({
      id: 'INV-' + (arId++),
      customer: cust, tier,
      invoiceDate: isoDate(inv), dueDate: isoDate(due),
      amount: amt, agingBucket: agingBucket(inv, s),
    });
  });

  /* ---- AP Aging ----
   * [vendor, invoiceWeekOffset, amount, terms, discountable]
   * Net 45 = Medium confidence in the engine; Net 15/30 = High. */
  const apSpec = [
    // ── Core operational suppliers ────────────────────────────────────────
    ['Industrial Supply Co',    -2,  620000, 'Net 30', true],
    ['Office Solutions LLC',    -1,  180000, 'Net 30', false],
    ['Logistics Partners',      -3,  540000, 'Net 60', false],
    ['Raw Materials Inc',        0,  910000, 'Net 30', true],
    ['Utility Services',         0,  240000, 'Net 15', false],
    ['Industrial Supply Co',     1,  700000, 'Net 30', true],
    ['Cloud Infrastructure',     1,  320000, 'Net 30', false],
    ['Logistics Partners',       2,  480000, 'Net 60', false],
    ['Marketing Agency',         3,  360000, 'Net 30', false],
    ['Raw Materials Inc',        4,  850000, 'Net 30', true],
    ['Professional Services',    5,  420000, 'Net 45', false],
    ['Industrial Supply Co',     7,  660000, 'Net 30', true],
    ['Cloud Infrastructure',     9,  330000, 'Net 30', false],
    ['Logistics Partners',      10,  510000, 'Net 60', false],
    ['Raw Materials Inc',       12,  780000, 'Net 30', true],
    // ── Recurring facilities & smaller operational bills ──────────────────
    ['City Power & Gas',        -2,   51000, 'Net 15', false],
    ['Property Management',     -1,   96000, 'Net 30', false],
    ['Telecom & Network',        0,   32000, 'Net 15', false],
    ['Insurance Group',          1,  188000, 'Net 30', false],
    ['Software Subscriptions',   2,   65000, 'Net 30', false],
    ['Freight Solutions',        3,  142000, 'Net 45', false],
    ['Cleaning & Facilities',    4,   21000, 'Net 15', false],
    ['Industrial Supply Co',     5,  440000, 'Net 30', true],
    ['Legal Services',           6,  288000, 'Net 45', false],
    ['City Power & Gas',         7,   54000, 'Net 15', false],
    ['Office Solutions LLC',     8,   91000, 'Net 30', false],
    ['Software Subscriptions',   9,   69000, 'Net 30', false],
    ['Raw Materials Inc',       10,  630000, 'Net 30', true],
    ['Property Management',     11,   99000, 'Net 30', false],
    ['Telecom & Network',       11,   34000, 'Net 15', false],
  ];
  // 15 original + 15 operational = 30 AP records
  let apId = 5000;
  apSpec.forEach(([vendor, wkOff, amt, terms, disc]) => {
    const inv = addDays(weekStart(s, 1), wkOff * 7 + 1);
    data.ap.push({
      id: 'BILL-' + (apId++),
      vendor, invoiceDate: isoDate(inv),
      terms, amount: amt,
      discount: disc ? '2/10 Net 30' : '',
    });
  });

  /* ---- Payroll — split by department, bi-weekly ----
   * 4 departments, 7 pay runs = 28 records. Amounts vary slightly by run
   * to reflect overtime (Manufacturing) and commission cycles (Sales).
   * Total per run stays within $1,620K–$1,692K — W7 crisis unaffected. */
  const payWeeks = [1, 3, 5, 7, 9, 11, 13];
  // [dept, headcount, benefitsUplift, grossByRun[7 runs]]
  const DEPTS = [
    ['Manufacturing',      310, 0.20, [828000, 828000, 841000, 828000, 828000, 856000, 828000]],
    ['Corporate & Finance', 85, 0.18, [285000, 285000, 285000, 285000, 285000, 285000, 285000]],
    ['Sales & Marketing',   95, 0.17, [313000, 313000, 313000, 313000, 313000, 357000, 313000]],
    ['R&D & Engineering',   50, 0.21, [194000, 194000, 194000, 194000, 194000, 194000, 194000]],
  ];
  let payId = 8000;
  payWeeks.forEach(function(wk, runIdx) {
    DEPTS.forEach(function(dept) {
      const d = addDays(weekStart(s, wk), 4); // Friday
      data.payroll.push({
        id: 'PR-' + (payId++),
        payDate: isoDate(d), grossAmount: dept[3][runIdx],
        employeeCount: dept[1], department: dept[0],
        benefitsUplift: dept[2],
      });
    });
  });

  /* ---- Debt Service ---- */
  let debtId = 9000;
  const debtSpec = [
    // Term Loan A — monthly installments with large W7 balloon
    { wk:  3, principal:  250000, interest: 145000, lender: 'First National Bank', facility: 'Term Loan A' },
    { wk:  7, principal: 6000000, interest: 138000, lender: 'First National Bank', facility: 'Term Loan A (Balloon)' },
    { wk: 11, principal:  250000, interest: 122000, lender: 'First National Bank', facility: 'Term Loan A' },
    // Revolver — interest only, quarterly
    { wk:  1, principal:       0, interest:  64000, lender: 'Syndicate Agent',     facility: 'Revolver' },
    { wk:  5, principal:       0, interest:  61000, lender: 'Syndicate Agent',     facility: 'Revolver' },
    { wk:  9, principal:       0, interest:  59000, lender: 'Syndicate Agent',     facility: 'Revolver' },
    { wk: 13, principal:       0, interest:  58000, lender: 'Syndicate Agent',     facility: 'Revolver' },
    // Equipment loan — monthly P+I
    { wk:  2, principal:  180000, interest:  42000, lender: 'Equipment Capital',   facility: 'Equip Loan' },
    { wk:  6, principal:  180000, interest:  40000, lender: 'Equipment Capital',   facility: 'Equip Loan' },
    { wk: 10, principal:  180000, interest:  38000, lender: 'Equipment Capital',   facility: 'Equip Loan' },
  ];
  debtSpec.forEach(x => {
    const d = addDays(weekStart(s, x.wk), 2);
    data.debt.push({
      id: 'DBT-' + (debtId++),
      paymentDate: isoDate(d), principal: x.principal, interest: x.interest,
      lender: x.lender, facility: x.facility,
    });
  });

  /* ---- Capex ----
   * "In approval" items generate Low-confidence events; excluded from all
   * scenario forecasts (sensitivity-only) but visible in the Layer 2 audit log. */
  let cpxId = 7000;
  const capexSpec = [
    ['Plant Expansion Phase 2',    4, 1400000, 'Approved + PO issued'],
    ['Digital Transformation',     2,  480000, 'Approved + PO issued'],
    ['ERP Implementation',         6,  850000, 'Approved + PO issued'],
    ['Fleet Modernization',        8, 1100000, 'Approved, pending PO'],
    ['Warehouse Automation',       9, 1800000, 'Approved, pending PO'],
    ['IT Infrastructure Refresh',  7,  620000, 'In approval'],  // risk week — Low conf
    ['R&D Lab Buildout',          11,  950000, 'In approval'],
    ['Solar Installation',        12, 1300000, 'In approval'],
    ['Office Expansion',          10,  390000, 'In approval'],
    ['Quality Management System', 13,  510000, 'In approval'],
  ];
  capexSpec.forEach(([proj, wk, amt, status]) => {
    const d = addDays(weekStart(s, wk), 3);
    data.capex.push({
      id: 'CPX-' + (cpxId++),
      project: proj, expectedDate: isoDate(d), amount: amt, status,
    });
  });

  return data;
}

/* Resolved scenario: same as base sample data but with additional Tier 1 AR
 * collections accelerated into W6–W7 to cover the Term Loan A balloon.
 * Demo narrative: treasurer called Acme Corporation and Summit Healthcare and
 * negotiated early payment to bridge the W7 liquidity gap. */
function buildResolvedSampleData(startDate) {
  const d = buildSampleData(startDate);
  const s = startDate;
  let nextId = 1100;
  const extraAR = [
    // Acme Corporation accelerates a $1.5M invoice into W6 (from a W9 cycle)
    ['Acme Corporation',    'Tier 1', 6, 1500000, 10],
    // Summit Healthcare pulls forward a W8 receivable to W7
    ['Summit Healthcare',   'Tier 1', 7,  900000, 12],
  ];
  const DSO_T1 = 4;
  extraAR.forEach(([cust, tier, cw, amt, age]) => {
    const due = addDays(weekStart(s, cw), 2 - DSO_T1);
    const inv = addDays(due, -age);
    d.ar.push({
      id: 'INV-' + (nextId++),
      customer: cust, tier,
      invoiceDate: isoDate(inv), dueDate: isoDate(due),
      amount: amt, agingBucket: agingBucket(inv, s),
    });
  });
  return d;
}

/* Build downloadable sample CSV strings for each input (for upload testing). */
function sampleCSVStrings(startDate) {
  const d = buildSampleData(startDate);
  return {
    ar: toCSV(['Customer', 'Invoice Date', 'Due Date', 'Amount', 'Aging Bucket', 'Tier'],
      d.ar.map(r => [r.customer, r.invoiceDate, r.dueDate, r.amount, r.agingBucket, r.tier])),
    ap: toCSV(['Vendor', 'Invoice Date', 'Amount', 'Payment Terms', 'Early Pay Discount'],
      d.ap.map(r => [r.vendor, r.invoiceDate, r.amount, r.terms, r.discount])),
    payroll: toCSV(['Pay Date', 'Gross Amount', 'Employee Count', 'Department', 'Benefits Uplift'],
      d.payroll.map(r => [r.payDate, r.grossAmount, r.employeeCount, r.department, r.benefitsUplift])),
    debt: toCSV(['Payment Date', 'Principal', 'Interest', 'Lender', 'Facility'],
      d.debt.map(r => [r.paymentDate, r.principal, r.interest, r.lender, r.facility])),
    capex: toCSV(['Project Name', 'Expected Payment Date', 'Amount', 'Approval Status'],
      d.capex.map(r => [r.project, r.expectedDate, r.amount, r.status])),
  };
}
