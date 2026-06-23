/* =====================================================================
 * app.js — UI orchestration + Layer 1 (Ingestion) + render of all layers
 * ===================================================================== */

/* ----------------------------- App state ----------------------------- */
const State = {
  cfg: {
    startDate: mondayOf(new Date()),
    openingBalance: 8000000,
    buffer: 5000000,
    covenant: 4000000,
    thresholds: {
      category: { pct: 0.05, abs: 250000 },
      weekly: { pct: 0.10, abs: 500000 },
      ending: { pct: 0.15, abs: 1000000 },
    },
    runBy: 'zmotiwala@deloitte.com',
    inputFiles: 'sample data',
  },
  raw: { ar: [], ap: [], payroll: [], debt: [], capex: [] },
  sources: {}, // per-source meta: {loaded, count, name}
  scenario: 'Base',
  model: null,       // current run model (all scenarios)
  driverHistory: {}, // entity -> consecutive cycle count
};

const SOURCES = [
  { key: 'ar', name: 'AR Aging', icon: '📥', src: 'ERP export (CSV/Excel)', fields: 'Customer · Invoice date · Due date · Amount · Aging bucket · Tier' },
  { key: 'ap', name: 'AP Aging', icon: '📤', src: 'ERP export (CSV/Excel)', fields: 'Vendor · Invoice date · Amount · Payment terms · Early-pay discount' },
  { key: 'payroll', name: 'Payroll Schedule', icon: '👥', src: 'HRIS / Treasury file', fields: 'Pay date · Gross amount · Employee count · Department' },
  { key: 'debt', name: 'Debt Service', icon: '🏦', src: 'Treasury / loan schedule', fields: 'Payment date · Principal · Interest · Lender · Facility' },
  { key: 'capex', name: 'Capex Commitments', icon: '🏗️', src: 'Project tracker / PO file', fields: 'Project · Expected payment date · Amount · Approval status' },
];

/* ----------------------------- Toast ----------------------------- */
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.innerHTML = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ----------------------------- CSV ingestion parsers (Layer 1) ----------------------------- */
const INGEST = {
  ar: rows => rows.map(r => ({
    id: col(r, 'id', 'invoice', 'invoice number') || 'INV-' + Math.random().toString(36).slice(2, 7),
    customer: col(r, 'customer', 'client', 'account'),
    invoiceDate: col(r, 'invoice date', 'invoicedate', 'date'),
    dueDate: col(r, 'due date', 'duedate', 'due'),
    amount: num(col(r, 'amount', 'balance', 'value')),
    agingBucket: col(r, 'aging bucket', 'aging', 'bucket'),
    tier: col(r, 'tier', 'customer tier') || 'Tier 2',
  })),
  ap: rows => rows.map(r => ({
    id: col(r, 'id', 'bill', 'invoice') || 'BILL-' + Math.random().toString(36).slice(2, 7),
    vendor: col(r, 'vendor', 'supplier', 'payee'),
    invoiceDate: col(r, 'invoice date', 'invoicedate', 'date'),
    amount: num(col(r, 'amount', 'balance', 'value')),
    terms: col(r, 'payment terms', 'terms', 'net') || 'Net 30',
    discount: col(r, 'early pay discount', 'discount', 'early pay'),
  })),
  payroll: rows => rows.map(r => ({
    id: 'PR-' + Math.random().toString(36).slice(2, 7),
    payDate: col(r, 'pay date', 'paydate', 'date'),
    grossAmount: num(col(r, 'gross amount', 'gross', 'amount')),
    employeeCount: num(col(r, 'employee count', 'employees', 'headcount')),
    department: col(r, 'department', 'dept') || 'All Departments',
    benefitsUplift: (function () { const v = col(r, 'benefits uplift', 'uplift', 'benefits'); const n = num(v); return n > 1 ? n / 100 : n; })(),
  })),
  debt: rows => rows.map(r => ({
    id: 'DBT-' + Math.random().toString(36).slice(2, 7),
    paymentDate: col(r, 'payment date', 'paymentdate', 'date'),
    principal: num(col(r, 'principal')),
    interest: num(col(r, 'interest')),
    lender: col(r, 'lender', 'bank', 'counterparty'),
    facility: col(r, 'facility', 'tranche', 'loan'),
  })),
  capex: rows => rows.map(r => ({
    id: 'CPX-' + Math.random().toString(36).slice(2, 7),
    project: col(r, 'project name', 'project'),
    expectedDate: col(r, 'expected payment date', 'expected date', 'date'),
    amount: num(col(r, 'amount', 'value', 'cost')),
    status: col(r, 'approval status', 'status', 'approval') || 'In approval',
  })),
};

function ingestRows(key, rows, fileName) {
  const recs = INGEST[key](rows).filter(r => Object.values(r).some(v => v !== '' && v !== 0));
  State.raw[key] = recs;
  State.sources[key] = { loaded: true, count: recs.length, name: fileName || 'uploaded.csv' };
  updateInputFilesLabel();
  return recs.length;
}

function loadAllSamples() {
  const d = buildSampleData(State.cfg.startDate);
  Object.keys(d).forEach(k => {
    State.raw[k] = d[k];
    State.sources[k] = { loaded: true, count: d[k].length, name: 'sample_' + k + '.csv' };
  });
  State.cfg.inputFiles = 'sample data (all 5 inputs)';
}
function loadSample(key) {
  const d = buildSampleData(State.cfg.startDate);
  State.raw[key] = d[key];
  State.sources[key] = { loaded: true, count: d[key].length, name: 'sample_' + key + '.csv' };
  updateInputFilesLabel();
}
function updateInputFilesLabel() {
  const names = Object.keys(State.sources).filter(k => State.sources[k] && State.sources[k].loaded).map(k => State.sources[k].name);
  State.cfg.inputFiles = names.join(', ') || 'none';
}
function anyLoaded() { return Object.keys(State.raw).some(k => State.raw[k].length); }

/* =====================================================================
 * RUN — execute the full 5-layer pipeline
 * ===================================================================== */
function runForecast(silent) {
  if (!anyLoaded()) { loadAllSamples(); }

  // Layer 2: normalize
  const norm = normalize(State.raw, State.cfg);

  // Layer 3: build all three scenarios
  const forecasts = {};
  ['Base', 'Downside', 'Upside'].forEach(sc => { forecasts[sc] = buildForecast(norm.events, sc, State.cfg); });

  // Versioning: grab prior snapshot before saving new one
  const priorSnap = priorVersion();

  // Layer 4: risk on current scenario
  const risks = detectRisks(forecasts[State.scenario], State.cfg);

  // Layer 4: variance vs prior (compare same scenario shape)
  const priorForecast = priorSnap ? snapshotToForecast(priorSnap) : null;
  const variance = computeVariance(forecasts[State.scenario], priorForecast, State.cfg,
    { lastDrivers: priorSnap ? priorSnap.lastDrivers : {} });

  // update driver history for consecutive-cycle detection
  const newDrivers = {};
  variance.commentary.forEach(c => {
    const prev = (priorSnap && priorSnap.lastDrivers && priorSnap.lastDrivers[c.driver]) || 0;
    newDrivers[c.driver] = prev + 1;
  });
  State.driverHistory = newDrivers;

  const runDate = new Date();
  const model = {
    runId: 'R' + isoDate(runDate).replace(/-/g, '') + '-' + (loadVersions().length + 1),
    runDate: runDate.toLocaleString(),
    scenario: State.scenario,
    cfg: State.cfg,
    forecasts,
    normTasks: norm.tasks,
    risks,
    variance,
    driverHistory: newDrivers,
  };
  State.model = model;

  // save snapshot for future variance
  saveVersion(makeSnapshot(model));

  markLayersDone();
  renderAll();
  if (!silent) {
    const c = risks.filter(r => r.severity === 'Critical').length;
    toast(`Forecast run complete · ${model.scenario} scenario · <b>${risks.length}</b> risk flag${risks.length !== 1 ? 's' : ''}${c ? ' (' + c + ' critical)' : ''}`);
  }
}

// Rebuild a minimal forecast object from a stored snapshot (for variance diffing)
function snapshotToForecast(snap) {
  return { weeks: snap.weeks.map(w => ({ week: w.week, label: w.label, net: w.net, closing: w.closing, opening: w.opening, cat: w.cat })) };
}

/* =====================================================================
 * NAVIGATION
 * ===================================================================== */
function go(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  window.scrollTo(0, 0);
}
function markLayersDone() {
  document.querySelectorAll('#nav button[data-view^="layer"]').forEach(b => b.classList.add('done'));
}

/* =====================================================================
 * RENDERERS
 * ===================================================================== */
function renderAll() {
  renderDashboard();
  renderLayer1();
  renderLayer2();
  renderLayer3();
  renderLayer4();
  renderLayer5();
  renderSettings();
}

function sevBadge(sev) {
  const m = { Critical: 'b-crit', High: 'b-highsev', Medium: 'b-medsev' };
  return `<span class="badge ${m[sev]}">${sev}</span>`;
}
function confBadge(c) {
  const m = { High: 'b-high', Medium: 'b-med', Low: 'b-low' };
  return `<span class="badge ${m[c]}">${c}</span>`;
}
function moneyCell(v, opt) {
  const cls = v < 0 ? 'num-neg' : '';
  return `<td class="${cls} ${opt || ''}">${fmtMoney(v)}</td>`;
}

/* ---------------- DASHBOARD ---------------- */
function renderDashboard() {
  const el = document.getElementById('view-dashboard');
  if (!State.model) {
    el.innerHTML = `
      <div class="page-head"><div class="eyebrow">Treasury Command Center</div>
      <h2>13-Week Direct Cash Forecast</h2>
      <p>Ingest AR, AP, payroll, debt service and capex → normalize into a unified cash-event model → forecast 13 weeks → auto-draft variance commentary and flag liquidity risk → export board-, lender- and audit-ready packages. Every step the spec defines, on a single run.</p></div>
      <div class="card card-pad empty">
        <div class="big">📊</div>
        <h3>No forecast generated yet</h3>
        <p class="muted" style="margin:8px 0 18px">Load the built-in sample treasury data and run all five layers in one click.</p>
        <button class="btn btn-primary" onclick="loadAllSamples();runForecast()">► Load sample data &amp; run forecast</button>
      </div>`;
    return;
  }
  const m = State.model, f = m.forecasts[m.scenario];
  const crit = m.risks.filter(r => r.severity === 'Critical').length;
  const high = m.risks.filter(r => r.severity === 'High').length;
  const med = m.risks.filter(r => r.severity === 'Medium').length;
  const light = crit || high ? 'red' : (med ? 'amber' : 'green');
  const lightTxt = light === 'red' ? 'Red — High/Critical flags' : light === 'amber' ? 'Amber — Medium risks' : 'Green — No flags';
  const minWk = f.weeks.reduce((a, w) => w.closing < a.closing ? w : a, f.weeks[0]);
  const netCls = f.netChange >= 0 ? 'pos' : 'neg';

  el.innerHTML = `
    <div class="page-head"><div class="eyebrow">${f.scenarioLabel} · Run ${m.runId}</div>
      <h2>Liquidity Dashboard</h2></div>
    <div class="grid g4" style="margin-bottom:18px">
      <div class="kpi blue"><div class="k-label">Opening Balance · W1</div><div class="k-val">${fmtM(f.openingBalance)}</div><div class="k-sub">As of ${isoDate(State.cfg.startDate)}</div></div>
      <div class="kpi ${netCls === 'pos' ? '' : 'red'}"><div class="k-label">Net 13-Week Change</div><div class="k-val">${fmtM(f.netChange)}</div><div class="k-sub ${netCls}">${f.netChange >= 0 ? '▲ cash build' : '▼ cash burn'}</div></div>
      <div class="kpi ${f.closingBalance < State.cfg.buffer ? 'red' : ''}"><div class="k-label">Projected W13 Close</div><div class="k-val">${fmtM(f.closingBalance)}</div><div class="k-sub">vs ${fmtM(State.cfg.buffer)} floor</div></div>
      <div class="kpi ${light === 'red' ? 'red' : light === 'amber' ? 'amber' : ''}"><div class="k-label">Liquidity Status</div><div class="k-val" style="font-size:20px;padding-top:6px"><span class="traffic ${light}"><span class="dot"></span>${light.toUpperCase()}</span></div><div class="k-sub">${m.risks.length} risk window${m.risks.length !== 1 ? 's' : ''}</div></div>
    </div>

    <div class="grid g2" style="margin-bottom:18px">
      <div class="card card-pad" style="grid-column:1/2">
        <h3>13-Week Cash Position</h3>
        <div class="card-sub">Weekly closing balance with ±1σ confidence band, operating floor and covenant minimum · ${f.scenarioLabel}</div>
        <div class="chart-wrap">${cashChart(f)}</div>
        <div class="legend">
          <span><i style="background:var(--green)"></i> Closing balance</span>
          <span><i style="background:rgba(134,188,37,.4)"></i> ±1σ confidence band</span>
          <span><i style="background:var(--crit)"></i> Operating floor</span>
          <span><i style="background:var(--high)"></i> Covenant min</span>
        </div>
      </div>
      <div class="card card-pad">
        <h3>Lowest Liquidity Week</h3>
        <div class="card-sub">Tightest projected position in the horizon</div>
        <div style="font-size:34px;font-weight:700;margin:6px 0">${minWk.label.split('·')[0]}</div>
        <div style="font-size:22px;font-weight:700;color:${minWk.closing < State.cfg.buffer ? 'var(--crit)' : 'var(--ink)'}">${fmtM(minWk.closing)}</div>
        <div class="muted" style="margin:4px 0 16px">${minWk.closing < State.cfg.buffer ? fmtM(minWk.closing - State.cfg.buffer) + ' below operating floor' : 'Above operating floor'}</div>
        <div class="divider"></div>
        <h3 style="margin-bottom:10px">Top Risk Flags</h3>
        ${m.risks.slice(0, 3).map(r => `<div style="margin-bottom:10px">${sevBadge(r.severity)} <b style="font-size:13px">W${r.week} · ${r.type}</b><div class="muted" style="margin-top:2px">${r.driver}</div></div>`).join('') || '<div class="muted">No risk windows flagged.</div>'}
      </div>
    </div>

    <div class="card card-pad">
      <h3>Net Cash Flow by Week</h3>
      <div class="card-sub">Inflows net of outflows · ${f.scenarioLabel}</div>
      ${barChart(f)}
    </div>`;
}

/* ---------------- LAYER 1: INGESTION ---------------- */
function renderLayer1() {
  const el = document.getElementById('view-layer1');
  el.innerHTML = `
    <div class="page-head"><div class="eyebrow">Layer 1</div><h2>Data Ingestion</h2>
      <p>Five standardized input types accepted as CSV (and Excel exports). Load the built-in sample data for an instant demo, or upload your own ERP/HRIS exports. Columns are auto-detected with fuzzy header matching.</p></div>
    <div class="flex" style="margin-bottom:16px">
      <button class="btn btn-primary btn-sm" onclick="loadAllSamples();renderLayer1();toast('Loaded sample data for all five inputs')">Load all sample data</button>
      <button class="btn btn-ghost btn-sm" onclick="downloadSampleCSVs()">⬇ Download sample CSV templates</button>
      <span class="muted">All inputs support CSV / Excel (XLS/XLSX) from any major ERP or HRIS.</span>
    </div>
    <div class="grid g2">${SOURCES.map(srcCard).join('')}</div>`;
  // wire dropzones
  SOURCES.forEach(s => wireDrop(s.key));
}

function srcCard(s) {
  const meta = State.sources[s.key];
  const loaded = meta && meta.loaded;
  return `<div class="src-card ${loaded ? 'loaded' : ''}" id="src-${s.key}">
    <div class="src-top">
      <div class="src-ic">${s.icon}</div>
      <div><h4>${s.name}</h4><div class="src-meta">${s.src}</div></div>
      <div class="src-status">${loaded ? `<span class="chip ok"><span class="d"></span>${meta.count} records</span>` : `<span class="chip"><span class="d"></span>Not loaded</span>`}</div>
    </div>
    <div class="src-fields"><b>Key fields:</b> ${s.fields}</div>
    <div class="dropzone" id="drop-${s.key}" data-key="${s.key}">Drop CSV here or click to upload${meta && meta.name ? ' · <b>' + meta.name + '</b>' : ''}</div>
    <div class="src-actions" style="margin-top:10px">
      <button class="btn btn-ghost btn-sm" onclick="loadSample('${s.key}');renderLayer1()">Load sample</button>
      ${loaded ? `<button class="btn btn-ghost btn-sm" onclick="previewSource('${s.key}')">Preview data</button>` : ''}
    </div>
    <div id="preview-${s.key}"></div>
  </div>`;
}

function wireDrop(key) {
  const dz = document.getElementById('drop-' + key);
  if (!dz) return;
  dz.onclick = () => {
    const fi = document.getElementById('fileInput');
    fi.onchange = e => { const file = e.target.files[0]; if (file) readFile(file, key); fi.value = ''; };
    fi.click();
  };
  ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => { const file = e.dataTransfer.files[0]; if (file) readFile(file, key); });
}
function readFile(file, key) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const rows = parseCSV(r.result);
      const n = ingestRows(key, rows, file.name);
      renderLayer1();
      toast(`Ingested <b>${n}</b> ${key.toUpperCase()} records from ${file.name}`);
    } catch (err) { toast('Could not parse file: ' + err.message); }
  };
  r.readAsText(file);
}
function previewSource(key) {
  const box = document.getElementById('preview-' + key);
  if (box.innerHTML) { box.innerHTML = ''; return; }
  const rows = State.raw[key].slice(0, 6);
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  box.innerHTML = `<div class="tbl-wrap" style="margin-top:12px"><table><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${typeof r[c] === 'number' ? r[c].toLocaleString() : r[c]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="muted" style="margin-top:6px">Showing ${rows.length} of ${State.raw[key].length} records</div>`;
}
function downloadSampleCSVs() {
  const csvs = sampleCSVStrings(State.cfg.startDate);
  Object.keys(csvs).forEach((k, i) => setTimeout(() => download('sample_' + k + '.csv', csvs[k], 'text/csv'), i * 250));
  toast('Downloading 5 sample CSV templates');
}

/* ---------------- LAYER 2: NORMALIZATION ---------------- */
function renderLayer2() {
  const el = document.getElementById('view-layer2');
  if (!State.model) { el.innerHTML = emptyLayer('Run a forecast to see the normalized cash-event model.'); return; }
  const f = State.model.forecasts[State.scenario];
  const evs = f.events;
  const byCat = {};
  CATEGORIES.forEach(c => byCat[c] = evs.filter(e => e.category === c));

  el.innerHTML = `
    <div class="page-head"><div class="eyebrow">Layer 2</div><h2>Normalization Engine</h2>
      <p>All five inputs are transformed into a single unified cash-event model — every event carries a <b>date</b>, <b>amount</b>, <b>category</b> and <b>confidence score</b> (High / Medium / Low).</p></div>

    <div class="grid g2" style="margin-bottom:18px">
      <div class="card card-pad"><h3>Normalization tasks applied</h3><div class="card-sub">Spec-defined transformation rules per input type</div>
        <ul class="steps">${State.model.normTasks.map(t => `<li>${t.replace(/^([^→]+→)/, '<b>$1</b>')}</li>`).join('')}</ul>
      </div>
      <div class="card card-pad"><h3>Confidence distribution</h3><div class="card-sub">Share of total cash movement by confidence tier</div>
        ${confMixBars(f)}
        <div class="divider"></div>
        <h3 style="margin-bottom:8px">Event counts by category</h3>
        ${CATEGORIES.map(c => `<div class="flex" style="justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--gray-100)"><span>${CAT_LABEL[c]}</span><span><b>${byCat[c].length}</b> events · ${fmtM(byCat[c].reduce((s, e) => s + e.amount, 0))}</span></div>`).join('')}
      </div>
    </div>

    <div class="card card-pad">
      <h3>Unified Cash-Event Model</h3>
      <div class="card-sub">${evs.length} normalized events · ${f.scenarioLabel}. Each row is date-stamped, signed, categorized and confidence-scored.</div>
      <div class="pill-row">${CATEGORIES.map(c => `<span class="chip" onclick="filterEvents('${c}')" style="cursor:pointer"><span class="d"></span>${CAT_LABEL[c]}</span>`).join('')}<span class="chip" onclick="filterEvents('')" style="cursor:pointer"><span class="d"></span>All</span></div>
      <div class="tbl-wrap" id="eventTbl">${eventTable(evs)}</div>
    </div>`;
}
function eventTable(evs) {
  const rows = evs.slice().sort((a, b) => a.date - b.date).slice(0, 400);
  return `<table><thead><tr><th>Week</th><th>Date</th><th>Category</th><th>Entity</th><th>Detail</th><th>Amount</th><th>Confidence</th><th>Timing</th></tr></thead>
    <tbody>${rows.map(e => `<tr><td>W${e.week}</td><td>${e.isoDate}</td><td>${CAT_LABEL[e.category]}</td><td>${e.entity}</td><td class="muted">${e.subcategory || ''}</td>${moneyCell(e.amount)}<td>${confBadge(e.confidence)}</td><td>${e.controllable ? 'Discretionary' : 'Fixed'}</td></tr>`).join('')}</tbody></table>`;
}
function filterEvents(cat) {
  const f = State.model.forecasts[State.scenario];
  const evs = cat ? f.events.filter(e => e.category === cat) : f.events;
  document.getElementById('eventTbl').innerHTML = eventTable(evs);
}

/* ---------------- LAYER 3: FORECAST ---------------- */
function renderLayer3() {
  const el = document.getElementById('view-layer3');
  if (!State.model) { el.innerHTML = emptyLayer('Run a forecast to build the 13-week cash-position matrix.'); return; }
  const f = State.model.forecasts[State.scenario];
  el.innerHTML = `
    <div class="page-head"><div class="eyebrow">Layer 3 · ${f.scenarioLabel}</div><h2>Forecast Engine</h2>
      <p>${SCENARIOS[State.scenario].desc} The week-by-week direct-method matrix traces every cash movement to its source category, seeded with the prior week's closing balance.</p></div>

    <div class="pill-row">
      <span class="chip ok"><span class="d"></span>Opening ${fmtM(f.openingBalance)}</span>
      <span class="chip"><span class="d"></span>Operating floor ${fmtM(State.cfg.buffer)}</span>
      <span class="chip"><span class="d"></span>Covenant min ${fmtM(State.cfg.covenant)}</span>
      <span class="chip"><span class="d"></span>W13 close ${fmtM(f.closingBalance)}</span>
    </div>

    <div class="card card-pad" style="margin-bottom:18px">
      <h3>13-Week Direct Cash Position Matrix</h3>
      <div class="card-sub">Net cash position after inflows and outflows for each period. Red = below operating floor · Amber = within 110% of covenant.</div>
      <div class="tbl-wrap">${matrixTable(f)}</div>
    </div>

    <div class="grid g3">
      ${scenarioCard('Base')}${scenarioCard('Downside')}${scenarioCard('Upside')}
    </div>`;
}
function matrixTable(f) {
  const cfg = State.cfg;
  const line = (label, fn, opt) => `<tr><td class="sticky-col">${label}</td>${f.weeks.map(w => {
    const v = fn(w); const cls = v < 0 ? 'num-neg' : '';
    return `<td class="wk ${cls} ${opt || ''}">${fmtMoney(v)}</td>`;
  }).join('')}</tr>`;
  const closing = `<tr><td class="sticky-col"><b>Closing Balance</b></td>${f.weeks.map(w => {
    const cls = w.closing < cfg.buffer ? 'cell-crit' : (w.closing < cfg.covenant * 1.1 ? 'cell-high' : '');
    return `<td class="wk ${cls}"><b>${fmtMoney(w.closing)}</b></td>`;
  }).join('')}</tr>`;
  return `<table><thead><tr><th class="sticky-col">Category</th>${f.weeks.map(w => `<th class="wk">${w.label}</th>`).join('')}</tr></thead><tbody>
    ${line('Opening Balance', w => w.opening)}
    ${line('Operating Inflows (AR)', w => w.cat.AR)}
    ${line('AP Disbursements', w => w.cat.AP)}
    ${line('Payroll', w => w.cat.Payroll)}
    ${line('Debt Service', w => w.cat.Debt)}
    ${line('Capex', w => w.cat.Capex)}
    <tr class="row-total"><td class="sticky-col">Net Cash Flow</td>${f.weeks.map(w => `<td class="wk ${w.net < 0 ? 'num-neg' : ''}">${fmtMoney(w.net)}</td>`).join('')}</tr>
    ${closing}
    ${line('Operating Floor', () => cfg.buffer)}
  </tbody></table>`;
}
function scenarioCard(sc) {
  const f = State.model.forecasts[sc];
  const active = sc === State.scenario;
  return `<div class="card card-pad" style="${active ? 'border-color:var(--green);border-width:2px' : ''}">
    <div class="flex" style="justify-content:space-between"><h3>${f.scenarioLabel}</h3>${active ? '<span class="badge b-high">Active</span>' : ''}</div>
    <div class="card-sub">${SCENARIOS[sc].desc}</div>
    <div style="font-size:24px;font-weight:700;margin:6px 0">${fmtM(f.closingBalance)}</div>
    <div class="muted">W13 close · net ${fmtM(f.netChange)}</div>
    ${!active ? `<button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="setScenario('${sc}')">View this scenario</button>` : ''}
  </div>`;
}

/* ---------------- LAYER 4: VARIANCE & RISK ---------------- */
function renderLayer4() {
  const el = document.getElementById('view-layer4');
  if (!State.model) { el.innerHTML = emptyLayer('Run a forecast to analyze variance and liquidity risk.'); return; }
  const m = State.model, v = m.variance;
  el.innerHTML = `
    <div class="page-head"><div class="eyebrow">Layer 4</div><h2>Variance &amp; Risk Engine</h2>
      <p>Compares this run against the immediately prior version, auto-drafts plain-language variance commentary, and scans all 13 weeks for liquidity-risk windows with a confidence-weighted sensitivity band.</p></div>

    <div class="card card-pad" style="margin-bottom:18px">
      <h3>Liquidity Risk Windows</h3>
      <div class="card-sub">Four risk classes scanned across W1–W13 · ${m.risks.length} flagged</div>
      ${m.risks.length ? `<div class="grid g2" style="margin-top:6px">${m.risks.map(riskCard).join('')}</div>` : '<div class="empty"><div class="big">✅</div><h3>No liquidity risk windows detected</h3><p class="muted">All 13 weeks remain above the operating floor and covenant thresholds.</p></div>'}
    </div>

    <div class="grid g2" style="margin-bottom:18px">
      <div class="card card-pad">
        <h3>Variance vs. Prior Forecast</h3>
        <div class="card-sub">${v.hasPrior ? 'Diff against immediately prior version' : 'Baseline run — no prior version to compare'}</div>
        ${v.hasPrior ? varianceBridge(v) : '<div class="muted" style="padding:20px 0">Run the forecast again (e.g. after changing a scenario or inputs) to generate a version-over-version variance bridge.</div>'}
      </div>
      <div class="card card-pad">
        <h3>Automated Variance Commentary</h3>
        <div class="card-sub">Plain-language explanation drafted for each flagged variance</div>
        ${v.hasPrior && v.commentary.length ? v.commentary.map(c => `<div class="commentary"><span class="c-wk">W${c.week}</span> ${c.text}</div>`).join('') : '<div class="muted" style="padding:20px 0">No flagged variances ' + (v.hasPrior ? 'this cycle.' : 'yet — this is the baseline run.') + '</div>'}
        ${exampleCommentary()}
      </div>
    </div>

    <div class="card card-pad">
      <h3>Category &amp; Weekly Variance Detail</h3>
      <div class="card-sub">Thresholds: Category &gt;5% / &gt;$250K · Weekly &gt;$500K / &gt;10% · Ending &gt;$1M / &gt;15%</div>
      ${v.hasPrior ? varianceTables(v) : '<div class="muted" style="padding:14px 0">Baseline run — variance tables populate from the second run onward.</div>'}
    </div>`;
}
function riskCard(r) {
  const cls = r.severity === 'Critical' ? 'crit' : (r.severity === 'High' ? 'high' : 'med');
  return `<div class="risk ${cls}">
    <div class="r-top">${sevBadge(r.severity)}<span class="r-title">${r.type} · W${r.week}</span></div>
    <div class="r-body">${r.definition} <b>Driver:</b> ${r.driver}.</div>
    <div class="r-action"><b>Suggested action →</b> ${r.action}</div>
  </div>`;
}
function varianceBridge(v) {
  const b = v.bridge;
  const items = [
    { l: 'Prior Forecast', val: b.prior, base: true },
    { l: 'Volume Change', val: b.volume },
    { l: 'Timing Change', val: b.timing },
    { l: 'Rate / Mix', val: b.rateMix },
    { l: 'Revised Forecast', val: b.revised, base: true },
  ];
  return `<table style="margin-top:6px"><tbody>${items.map(i => `<tr><td style="text-align:left">${i.base ? '<b>' + i.l + '</b>' : i.l}</td><td class="${i.val < 0 && !i.base ? 'num-neg' : ''}">${i.base ? '<b>' + fmtMoney(i.val) + '</b>' : (i.val >= 0 ? '+' : '') + fmtMoney(i.val)}</td></tr>`).join('')}</tbody></table>
    <div class="muted" style="margin-top:8px">Net 13-week cash flow bridge · mirrors board-reporting format.</div>`;
}
function exampleCommentary() {
  return `<div style="margin-top:14px"><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;font-weight:700">📝 Commentary engine — illustrative format</div>
    <div class="commentary" style="margin-top:6px;opacity:.85"><span class="c-wk">W5</span> AR collections revised down $1.2M (−8%) vs. prior. Primary driver: Acme Corp ($900K) shifted W5→W6 on updated DSO model — timing change only, no credit concern. Remaining $300K reflects reduced West Region invoicing.</div></div>`;
}
function varianceTables(v) {
  const catRows = v.category.map(c => `<tr class="${c.flagged ? '' : ''}"><td style="text-align:left">${c.label}</td>${moneyCell(c.prior)}${moneyCell(c.current)}<td class="${c.delta < 0 ? 'num-neg' : ''}">${(c.delta >= 0 ? '+' : '') + fmtMoney(c.delta)}</td><td>${fmtPct(c.pct)}</td><td>${c.flagged ? '<span class="badge b-highsev">FLAG</span>' : '—'}</td></tr>`).join('');
  const endRows = v.ending.map(e => `<tr><td style="text-align:left">End of W${e.week}</td>${moneyCell(e.prior)}${moneyCell(e.current)}<td class="${e.delta < 0 ? 'num-neg' : ''}">${(e.delta >= 0 ? '+' : '') + fmtMoney(e.delta)}</td><td>${fmtPct(e.pct)}</td><td>${e.flagged ? '<span class="badge b-highsev">FLAG</span>' : '—'}</td></tr>`).join('');
  return `<div class="grid g2" style="margin-top:10px">
    <div><div class="muted" style="font-weight:700;margin-bottom:6px">Category-level (13-wk totals)</div>
      <div class="tbl-wrap"><table><thead><tr><th>Category</th><th>Prior</th><th>Current</th><th>Δ</th><th>%</th><th>Flag</th></tr></thead><tbody>${catRows}</tbody></table></div></div>
    <div><div class="muted" style="font-weight:700;margin-bottom:6px">Ending balance (W4 · W8 · W13)</div>
      <div class="tbl-wrap"><table><thead><tr><th>Checkpoint</th><th>Prior</th><th>Current</th><th>Δ</th><th>%</th><th>Flag</th></tr></thead><tbody>${endRows}</tbody></table></div></div>
  </div>`;
}

/* ---------------- LAYER 5: OUTPUT ---------------- */
function renderLayer5() {
  const el = document.getElementById('view-layer5');
  if (!State.model) { el.innerHTML = emptyLayer('Run a forecast to generate output packages.'); return; }
  const m = State.model;
  el.innerHTML = `
    <div class="page-head"><div class="eyebrow">Layer 5</div><h2>Output Layer</h2>
      <p>The forecast, variance analysis and risk flags packaged into the formats treasurers, CFOs and lenders consume — all from the same data model, no manual reformatting.</p></div>
    <div class="grid g4" style="margin-bottom:18px">
      ${outCard('📊', 'Excel Workbook', 'Treasurer / FP&A', '13-week grid, scenario tabs, variance bridge, raw events — 8 tabs.', `exportExcel(State.model)`)}
      ${outCard('📄', 'PDF Executive Summary', 'CFO / Board', '1-page dashboard, traffic light, top variance drivers, headroom chart.', `openExecPDF()`)}
      ${outCard('🏦', 'Lender / Agent Package', 'Banks / Agents', 'Covenant compliance table, 13-week grid, revolver headroom.', `openLenderPackage()`)}
      ${outCard('🔌', 'JSON / API Feed', 'TMS / ERP', 'Full event-level data, all scenarios, risk metadata.', `exportJSON(State.model)`)}
    </div>

    <div class="grid g2">
      <div class="card card-pad">
        <h3>Excel Workbook structure</h3>
        <div class="card-sub">Primary working artifact · ${m.scenario} scenario</div>
        <ul class="steps" style="margin-top:4px">
          <li><b>Summary</b> — 13-week bridge, scenario toggle, floor line, risk highlights (red/amber)</li>
          <li><b>AR Collections</b> — by customer tier, DSO adjustment, confidence</li>
          <li><b>AP Disbursements</b> — by vendor, early-pay flags, fixed vs discretionary</li>
          <li><b>Payroll &amp; Debt</b> — fixed-obligation schedule, all 13 weeks</li>
          <li><b>Capex</b> — project-level, confidence weighting, approval status</li>
          <li><b>Variance</b> — vs prior with commentary pre-populated</li>
          <li><b>Risk Log</b> — severity, week, driver, suggested action</li>
          <li><b>Raw Events</b> — full event model with override 'O' tags</li>
        </ul>
        <button class="btn btn-primary" style="margin-top:8px" onclick="exportExcel(State.model)">⬇ Generate Excel workbook</button>
      </div>
      <div class="card card-pad">
        <h3>Executive Summary preview</h3>
        <div class="card-sub">One-page CFO / board view · generated live</div>
        ${execSummaryHTML(m, true)}
        <button class="btn btn-dark" style="margin-top:12px" onclick="openExecPDF()">🖨 Open print-ready PDF</button>
      </div>
    </div>`;
}
function outCard(icon, title, aud, desc, fn) {
  return `<div class="src-card" style="display:flex;flex-direction:column">
    <div class="src-top"><div class="src-ic">${icon}</div><div><h4>${title}</h4><div class="src-meta">${aud}</div></div></div>
    <div class="src-fields" style="flex:1">${desc}</div>
    <button class="btn btn-primary btn-sm" onclick="${fn}">Generate</button>
  </div>`;
}

/* ---------------- SETTINGS ---------------- */
function renderSettings() {
  const el = document.getElementById('view-settings');
  const c = State.cfg;
  const versions = loadVersions();
  el.innerHTML = `
    <div class="page-head"><div class="eyebrow">Controls</div><h2>Settings, Assumptions &amp; Versioning</h2>
      <p>Configure the opening balance, liquidity buffers, covenant thresholds and variance flags. Every run is version-stamped for weekly refresh and version-over-version variance.</p></div>
    <div class="grid g2">
      <div class="card card-pad">
        <h3>Forecast assumptions</h3><div class="card-sub">Applied on next run</div>
        <div class="field"><label>Forecast start (W1 Monday)</label><input type="date" id="cfg-start" value="${isoDate(c.startDate)}"></div>
        <div class="field"><label>Opening bank balance (W1 seed)</label><input type="number" id="cfg-open" value="${c.openingBalance}"><div class="hint">Actual bank balance as of the forecast date.</div></div>
        <div class="field"><label>Minimum operating cash buffer (floor)</label><input type="number" id="cfg-buffer" value="${c.buffer}"></div>
        <div class="field"><label>Covenant-tested minimum cash</label><input type="number" id="cfg-cov" value="${c.covenant}"><div class="hint">Covenant proximity flags trigger below 110% of this.</div></div>
        <button class="btn btn-primary" onclick="saveSettings()">Save &amp; re-run</button>
      </div>
      <div class="card card-pad">
        <h3>Variance flag thresholds</h3><div class="card-sub">Configurable per the spec</div>
        <div class="field"><label>Category-level: % / $ abs</label><div class="flex"><input type="number" step="0.01" id="th-cat-pct" value="${c.thresholds.category.pct}"><input type="number" id="th-cat-abs" value="${c.thresholds.category.abs}"></div></div>
        <div class="field"><label>Weekly net: % / $ abs</label><div class="flex"><input type="number" step="0.01" id="th-wk-pct" value="${c.thresholds.weekly.pct}"><input type="number" id="th-wk-abs" value="${c.thresholds.weekly.abs}"></div></div>
        <div class="field"><label>Ending balance: % / $ abs</label><div class="flex"><input type="number" step="0.01" id="th-end-pct" value="${c.thresholds.ending.pct}"><input type="number" id="th-end-abs" value="${c.thresholds.ending.abs}"></div></div>
        <div class="divider"></div>
        <h3 style="margin-bottom:6px">Version history &amp; changelog</h3>
        <div class="card-sub">${versions.length} stored version${versions.length !== 1 ? 's' : ''} · weekly refresh ready</div>
        <div class="tbl-wrap" style="max-height:240px;overflow:auto">${versionTable(versions)}</div>
        <button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="clearVersions();renderSettings();toast('Version history cleared')">Clear version history</button>
      </div>
    </div>`;
}
function versionTable(versions) {
  if (!versions.length) return '<div class="muted" style="padding:14px">No versions yet — run the forecast to create the first snapshot.</div>';
  return `<table><thead><tr><th>Run ID</th><th>Date</th><th>Scenario</th><th>Inputs</th><th>W13 Close</th></tr></thead><tbody>
    ${versions.slice().reverse().map(v => `<tr><td style="text-align:left">${v.runId}</td><td style="text-align:left">${v.runDate}</td><td>${v.scenario}</td><td style="text-align:left" class="muted">${v.inputFiles || 'sample'}</td>${moneyCell(v.weeks[12].closing)}</tr>`).join('')}
  </tbody></table>`;
}
function saveSettings() {
  const c = State.cfg;
  const sd = document.getElementById('cfg-start').value;
  if (sd) c.startDate = mondayOf(parseDate(sd));
  c.openingBalance = num(document.getElementById('cfg-open').value);
  c.buffer = num(document.getElementById('cfg-buffer').value);
  c.covenant = num(document.getElementById('cfg-cov').value);
  c.thresholds.category = { pct: parseFloat(document.getElementById('th-cat-pct').value), abs: num(document.getElementById('th-cat-abs').value) };
  c.thresholds.weekly = { pct: parseFloat(document.getElementById('th-wk-pct').value), abs: num(document.getElementById('th-wk-abs').value) };
  c.thresholds.ending = { pct: parseFloat(document.getElementById('th-end-pct').value), abs: num(document.getElementById('th-end-abs').value) };
  runForecast();
  toast('Settings saved · forecast re-run');
}

/* ---------------- helpers ---------------- */
function emptyLayer(msg) {
  return `<div class="card card-pad empty"><div class="big">⏳</div><h3>Awaiting forecast run</h3><p class="muted" style="margin:8px 0 18px">${msg}</p><button class="btn btn-primary" onclick="runForecast()">► Run Forecast</button></div>`;
}
function confMixBars(f) {
  const mix = confidenceMix(f);
  const seg = (label, v, color) => `<div style="margin-bottom:10px"><div class="flex" style="justify-content:space-between;font-size:12px"><span>${label}</span><span><b>${fmtPct(v)}</b></span></div><div style="height:10px;background:var(--gray-100);border-radius:5px;overflow:hidden"><div style="width:${v * 100}%;height:100%;background:${color}"></div></div></div>`;
  return seg('High confidence', mix.High, 'var(--green)') + seg('Medium confidence', mix.Medium, 'var(--blue)') + seg('Low confidence', mix.Low, 'var(--high)');
}

/* =====================================================================
 * SVG CHARTS
 * ===================================================================== */
function cashChart(f) {
  const W = 620, H = 260, padL = 56, padR = 16, padT = 16, padB = 28;
  const cfg = State.cfg;
  const xs = f.weeks.map((w, i) => padL + i * (W - padL - padR) / 12);
  const vals = f.weeks.map(w => w.closing);
  const bandsHi = f.weeks.map(w => w.closing + w.bandSigma);
  const bandsLo = f.weeks.map(w => w.closing - w.bandSigma);
  const allV = vals.concat(bandsHi, bandsLo, [cfg.buffer, cfg.covenant, 0]);
  const minV = Math.min.apply(null, allV), maxV = Math.max.apply(null, allV);
  const pad = (maxV - minV) * 0.1 || 1;
  const lo = minV - pad, hi = maxV + pad;
  const y = v => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));
  const ptsLine = xs.map((x, i) => `${x.toFixed(1)},${y(vals[i]).toFixed(1)}`).join(' ');
  const bandPath = xs.map((x, i) => `${x.toFixed(1)},${y(bandsHi[i]).toFixed(1)}`).join(' ') + ' ' +
    xs.slice().reverse().map((x, i) => { const idx = xs.length - 1 - i; return `${x.toFixed(1)},${y(bandsLo[idx]).toFixed(1)}`; }).join(' ');
  const gridVals = [lo, lo + (hi - lo) / 2, hi];
  const grids = gridVals.map(gv => `<line class="grid-line" x1="${padL}" y1="${y(gv)}" x2="${W - padR}" y2="${y(gv)}"/><text class="axis-label" x="${padL - 6}" y="${y(gv) + 3}" text-anchor="end">${fmtM(gv)}</text>`).join('');
  const dots = xs.map((x, i) => `<circle class="dot ${vals[i] < cfg.buffer ? 'breach' : ''}" cx="${x}" cy="${y(vals[i])}" r="3.5"/>`).join('');
  const xlabels = f.weeks.map((w, i) => i % 2 === 0 ? `<text class="axis-label" x="${xs[i]}" y="${H - 8}" text-anchor="middle">W${w.week}</text>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
    ${grids}
    <polygon class="band" points="${bandPath}"/>
    <line class="floor-line" x1="${padL}" y1="${y(cfg.buffer)}" x2="${W - padR}" y2="${y(cfg.buffer)}"/>
    <line class="cov-line" x1="${padL}" y1="${y(cfg.covenant)}" x2="${W - padR}" y2="${y(cfg.covenant)}"/>
    <polyline class="bal-line" points="${ptsLine}"/>
    ${dots}${xlabels}
  </svg>`;
}
function barChart(f) {
  const max = Math.max.apply(null, f.weeks.map(w => Math.abs(w.net))) || 1;
  return `<div class="bars">${f.weeks.map(w => {
    const h = Math.abs(w.net) / max * 100;
    return `<div class="bar-col" title="${w.label}: ${fmtMoney(w.net)}">
      <div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;width:100%;align-items:center"><div class="bar ${w.net < 0 ? 'neg' : ''}" style="height:${h}%"></div></div>
      <div class="bar-lbl">W${w.week}</div></div>`;
  }).join('')}</div>`;
}

/* =====================================================================
 * EXEC PDF + LENDER PACKAGE (print views)
 * ===================================================================== */
function execSummaryHTML(m, mini) {
  const f = m.forecasts[m.scenario];
  const crit = m.risks.filter(r => r.severity === 'Critical').length;
  const high = m.risks.filter(r => r.severity === 'High').length;
  const med = m.risks.filter(r => r.severity === 'Medium').length;
  const light = crit || high ? 'red' : (med ? 'amber' : 'green');
  const lightTxt = light === 'red' ? 'RED' : light === 'amber' ? 'AMBER' : 'GREEN';
  const drivers = m.variance.hasPrior && m.variance.commentary.length
    ? m.variance.commentary.slice(0, 3).map(c => `<li>${c.text}</li>`).join('')
    : ['Base run established — no prior-version variance.', 'Top exposure: largest debt-service week and capex timing.', 'Confidence-weighted band widest in high-AR / high-capex weeks.'].map(t => `<li>${t}</li>`).join('');
  const scRow = ['Base', 'Downside', 'Upside'].map(sc => {
    const ff = m.forecasts[sc];
    return `<tr><td style="text-align:left"><b>${ff.scenarioLabel}</b></td>${moneyCell(ff.openingBalance)}<td class="${ff.netChange < 0 ? 'num-neg' : ''}">${fmtMoney(ff.netChange)}</td>${moneyCell(ff.closingBalance)}</tr>`;
  }).join('');
  return `<div class="${mini ? '' : 'exec-doc'}">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${mini ? '10' : '20'}px">
      <div><div style="font-size:${mini ? '11' : '13'}px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:1px">Cash Position Executive Summary</div>
      <div style="font-size:${mini ? '15' : '22'}px;font-weight:700">13-Week Direct Cash Forecast</div></div>
      <span class="traffic ${light}"><span class="dot"></span>${lightTxt}</span>
    </div>
    <table style="margin-bottom:${mini ? '10' : '18'}px"><thead><tr><th>Scenario</th><th>Opening</th><th>Net 13-Wk</th><th>W13 Close</th></tr></thead><tbody>${scRow}</tbody></table>
    <div style="font-weight:700;margin:${mini ? '4' : '10'}px 0 4px;font-size:13px">Top variance drivers vs. prior</div>
    <ul style="margin-left:18px;font-size:${mini ? '11.5' : '13'}px;color:var(--gray-600)">${drivers}</ul>
    ${mini ? '' : `<div style="font-weight:700;margin:14px 0 4px">Liquidity headroom</div>${cashChart(f)}<div class="legend"><span><i style="background:var(--green)"></i>Closing</span><span><i style="background:var(--crit)"></i>Floor</span><span><i style="background:var(--high)"></i>Covenant</span></div>`}
    ${mini ? `<div class="muted" style="margin-top:8px">${m.risks.length} risk flag(s) · ${crit} critical · ${high} high · ${med} medium</div>` : ''}
  </div>`;
}
function openExecPDF() {
  const m = State.model;
  document.getElementById('printArea').innerHTML = `
    <div style="padding:30px;font-family:var(--font)">
      <div style="display:flex;justify-content:space-between;border-bottom:3px solid var(--green);padding-bottom:10px;margin-bottom:18px">
        <div style="font-size:22px;font-weight:700">Deloitte<span style="color:var(--green)">.</span></div>
        <div style="font-size:11px;color:var(--gray-500);text-align:right">Run ${m.runId} · ${m.runDate}<br/>${m.scenario} scenario · ${State.cfg.runBy}</div>
      </div>
      ${execSummaryHTML(m, false)}
      <div style="margin-top:24px"><div style="font-weight:700;margin-bottom:6px">Liquidity risk flags</div>
        ${m.risks.length ? '<table><thead><tr><th>Severity</th><th>Week</th><th>Type</th><th>Driver</th></tr></thead><tbody>' + m.risks.map(r => `<tr><td style="text-align:left">${r.severity}</td><td style="text-align:left">W${r.week}</td><td style="text-align:left">${r.type}</td><td style="text-align:left">${r.driver}</td></tr>`).join('') + '</tbody></table>' : '<div class="muted">No flags.</div>'}
      </div>
      <div style="margin-top:20px;font-size:10px;color:var(--gray-500)">Generated by the 13-Week Direct Cash Forecast Generator · <i>Together makes progress</i></div>
    </div>`;
  toast('Opening print dialog — choose "Save as PDF"');
  setTimeout(() => window.print(), 400);
}
function openLenderPackage() {
  const m = State.model, f = m.forecasts[m.scenario], cfg = State.cfg;
  const checkpoints = [4, 13];
  const covRows = checkpoints.map(wk => {
    const w = f.weeks[wk - 1];
    const headroom = w.closing - cfg.covenant;
    return `<tr><td style="text-align:left">Minimum liquidity (W${wk})</td>${moneyCell(cfg.covenant)}${moneyCell(w.closing)}<td class="${headroom < 0 ? 'num-neg' : ''}">${fmtMoney(headroom)}</td><td>${headroom >= 0 ? 'PASS' : 'BREACH'}</td></tr>`;
  }).join('');
  const minWk = f.weeks.reduce((a, w) => w.closing < a.closing ? w : a, f.weeks[0]);
  const need = Math.max(0, cfg.buffer - minWk.closing);
  document.getElementById('printArea').innerHTML = `
    <div style="padding:30px;font-family:var(--font)">
      <div style="display:flex;justify-content:space-between;border-bottom:3px solid var(--green);padding-bottom:10px;margin-bottom:18px">
        <div style="font-size:22px;font-weight:700">Deloitte<span style="color:var(--green)">.</span></div>
        <div style="font-size:11px;color:var(--gray-500);text-align:right">Lender / Agent Package<br/>Run ${m.runId} · ${m.runDate}</div>
      </div>
      <h2 style="font-size:18px">Covenant Compliance Certificate — 13-Week Outlook</h2>
      <div style="font-weight:700;margin:16px 0 6px">Covenant compliance (next 4 &amp; 13 weeks)</div>
      <table><thead><tr><th>Covenant test</th><th>Required</th><th>Projected</th><th>Headroom</th><th>Status</th></tr></thead><tbody>${covRows}</tbody></table>
      <div style="font-weight:700;margin:18px 0 6px">Available revolver capacity vs. projected need</div>
      <table><tbody>
        <tr><td style="text-align:left">Tightest projected week</td><td style="text-align:right">${minWk.label}</td></tr>
        <tr><td style="text-align:left">Projected balance at tightest week</td>${moneyCell(minWk.closing)}</tr>
        <tr><td style="text-align:left">Operating floor</td>${moneyCell(cfg.buffer)}</tr>
        <tr><td style="text-align:left"><b>Indicated revolver draw need</b></td><td style="text-align:right"><b>${fmtMoney(need)}</b></td></tr>
      </tbody></table>
      <div style="font-weight:700;margin:18px 0 6px">13-week closing balance vs. covenant minimum</div>
      ${cashChart(f)}
      <div style="margin-top:20px;font-size:10px;color:var(--gray-500)">Certification-ready format · layout mirrors standard credit-agreement compliance certificate.</div>
    </div>`;
  toast('Opening lender package — choose "Save as PDF"');
  setTimeout(() => window.print(), 400);
}

/* =====================================================================
 * Scenario / wiring
 * ===================================================================== */
function setScenario(sc) {
  State.scenario = sc;
  document.querySelectorAll('#scenarioToggle button').forEach(b => b.classList.toggle('active', b.dataset.sc === sc));
  if (State.model) {
    // recompute risk + variance for the newly active scenario without creating a new version
    const f = State.model.forecasts[sc];
    State.model.scenario = sc;
    State.model.risks = detectRisks(f, State.cfg);
    const prior = priorVersionExcludingCurrent();
    State.model.variance = computeVariance(f, prior ? snapshotToForecast(prior) : null, State.cfg, { lastDrivers: prior ? prior.lastDrivers : {} });
    renderAll();
  }
}
// the most recent stored version is the current run; for live scenario switch compare to the one before it
function priorVersionExcludingCurrent() {
  const v = loadVersions();
  return v.length >= 2 ? v[v.length - 2] : null;
}

/* =====================================================================
 * INIT
 * ===================================================================== */
function init() {
  document.querySelectorAll('#nav button').forEach(b => b.onclick = () => go(b.dataset.view));
  document.querySelectorAll('#scenarioToggle button').forEach(b => b.onclick = () => setScenario(b.dataset.sc));
  document.getElementById('runBtn').onclick = () => runForecast();
  renderAll();
}
document.addEventListener('DOMContentLoaded', init);
