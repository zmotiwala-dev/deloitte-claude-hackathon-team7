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
    clientName: '',     // optional client name for demo branding
    accentColor: '',    // optional CSS hex color override
  },
  raw: { ar: [], ap: [], payroll: [], debt: [], capex: [] },
  sources: {}, // per-source meta: {loaded, count, name}
  scenario: 'Base',
  model: null,       // current run model (all scenarios)
  driverHistory: {}, // entity -> consecutive cycle count
  claudeChat: [],    // [{role, content}] conversation history
  aiCommentary: null,    // Claude-generated variance commentary text
  aiRiskNarrative: null, // Claude-generated risk narrative text
  briefMe: null,         // Claude-generated CFO briefing
  riskActions: {},       // idx -> Claude-generated per-risk action text
  coverNote: null,       // Claude-generated lender cover note
  navContext: null,      // { dest, from, message } — context banner for cross-layer navigation
  l5Override: false,     // presentation mode: bypass readiness gate on output layer
  dashWeek: null,        // selected week on dashboard cash chart
};

/* ---- Persona data for the Personas tab ---- */
const PERSONA_DATA = [
  {
    title: 'Treasurer / Cash Manager',
    tagline: `The person who owns the cash position day to day. When the company is in distress, this is the person who can't sleep.`,
    homeIcon: '💼',
    homeHook: '4–8 hours per week rebuilding a forecast that\'s stale before anyone reads it.',
    currentFlow: [
      { icon: '🏦', step: 'Pull data',        who: 'person', note: 'Multiple bank portals & ERP — by hand' },
      { icon: '📋', step: 'Stitch together',  who: 'person', note: 'Copy-paste into a master spreadsheet' },
      { icon: '🔧', step: 'Build formulas',   who: 'person', note: '4–8 hrs/week, formula by formula' },
      { icon: '📄', step: 'Write report',     who: 'person', note: 'Stale before it reaches the CFO' },
      { icon: '🚨', step: 'React to crisis',  who: 'person', note: 'Shortfall found too late to fix' },
    ],
    currentPains: [
      'Rebuilding the forecast from scratch every week costs 4–8 hours — before any decision can be made.',
      'A single broken formula or fat-fingered cell can hide a shortfall until it\'s too late to act.',
      'Problems surface when the cash is already gone — there\'s no early warning, just a fire drill.',
      'The forecast is stale by the time anyone reads it. You\'re always reacting to last week\'s data.',
    ],
    futureFlow: [
      { icon: '📁', step: 'Upload data',      who: 'person', note: 'CSV from any ERP or HRIS format' },
      { icon: '⚡', step: 'Auto-ingest',      who: 'ai',     note: 'Layer 1 · fuzzy header detection' },
      { icon: '📈', step: 'Live forecast',    who: 'ai',     note: 'Layers 2–3 · 13 weeks, 3 scenarios' },
      { icon: '🎯', step: 'Review flags',     who: 'person', note: 'You interpret AI-flagged risk weeks' },
      { icon: '✅', step: 'Act on it',        who: 'person', note: 'You decide, export & execute' },
    ],
    futureBenefits: [
      'Upload new data — the forecast rebuilds in seconds. The 4–8 hour weekly rebuild is gone.',
      'AI flags dangerous weeks automatically, with the driver named. No formula errors, no blind spots.',
      'Shortfalls surface weeks ahead, before options close. You see the crisis before it arrives.',
      'Time shifts from assembling numbers to acting on them. The forecast is always current.',
    ],
    loop: `The treasurer validates the assumptions behind each scenario, sanity-checks the flagged drivers against what they know about the business, and decides which levers to pull. The tool surfaces the problem; the treasurer owns the response.`,
  },
  {
    title: 'CFO',
    tagline: `Accountable to the board and the lenders. Needs the story, not the spreadsheet.`,
    homeIcon: '📊',
    homeHook: 'Walks into lender meetings with numbers they didn\'t build and can\'t fully defend.',
    currentFlow: [
      { icon: '⏳', step: 'Wait for data',    who: 'person', note: 'Days to receive a usable number' },
      { icon: '🔍', step: 'Interrogate it',   who: 'person', note: 'Often stale — doesn\'t reconcile' },
      { icon: '✍️', step: 'Guess downside',   who: 'person', note: 'Scenario modeling takes a weekend' },
      { icon: '😰', step: 'Walk in exposed',  who: 'person', note: 'Numbers you didn\'t build' },
      { icon: '❓', step: 'Defend under fire', who: 'person', note: 'No clean narrative, no safety net' },
    ],
    currentPains: [
      'Waiting days for a usable number means decisions lag reality — or get made without one.',
      'Numbers assembled under time pressure are hard to defend. Walking into a lender meeting exposed is a real risk.',
      'Modeling a downside scenario takes a weekend of rework — so it usually doesn\'t happen until it\'s too late.',
      'The CFO often enters critical conversations with numbers they didn\'t build and can\'t fully explain.',
    ],
    futureFlow: [
      { icon: '📊', step: 'Open dashboard',   who: 'person', note: 'Same live view as the treasury team' },
      { icon: '📉', step: 'See 3 scenarios',  who: 'ai',     note: 'Base, downside, upside — instant' },
      { icon: '✦',  step: 'AI narrative',     who: 'ai',     note: 'Claude drafts the CFO risk briefing' },
      { icon: '💼', step: 'Review & approve', who: 'person', note: 'You verify before it goes to the bank' },
      { icon: '🧠', step: 'Own the decision', who: 'person', note: 'Strategy & judgment stay with you' },
    ],
    futureBenefits: [
      'The live forecast is available the moment data lands — no waiting on the treasury team.',
      'One source of truth, consistent across treasury, the board deck, and the lender conversation.',
      'Downside and upside scenarios pre-built. Model any case in seconds, not a weekend.',
      'Claude drafts the risk narrative. Walk into any meeting with defensible numbers and a clear story.',
    ],
    loop: `The CFO owns the strategic call — which scenario to plan against, which costs to cut, what to commit to the lender. The tool gives a defensible foundation; the CFO makes the judgment and carries the accountability.`,
  },
  {
    title: 'Lender / Restructuring Advisor',
    tagline: `The external party deciding whether to keep backing the company. Their confidence is the company's lifeline.`,
    homeIcon: '🏦',
    homeHook: 'Receives forecasts in inconsistent formats with opaque assumptions they can\'t audit.',
    currentFlow: [
      { icon: '📨', step: 'Request forecast', who: 'person', note: 'On the borrower\'s timeline' },
      { icon: '📑', step: 'Receive report',   who: 'person', note: 'Inconsistent format — every time' },
      { icon: '🤔', step: 'Question data',    who: 'person', note: 'Opaque assumptions, no audit trail' },
      { icon: '📋', step: 'Check covenants',  who: 'person', note: 'Manual, reactive, error-prone' },
      { icon: '📉', step: 'Lose confidence',  who: 'person', note: 'Trust erodes under pressure' },
    ],
    currentPains: [
      'Every borrower sends forecasts in a different format. Comparison across the portfolio is nearly impossible.',
      'Assumptions are rarely explained. When numbers look off, there\'s no way to audit where they came from.',
      'Covenant compliance isn\'t presented — it has to be manually checked week by week against each forecast.',
      'Confidence erodes when a company can\'t produce clean data under pressure. That erosion is a warning sign in itself.',
    ],
    futureFlow: [
      { icon: '📦', step: 'Receive package',  who: 'person', note: 'Standardized format, every borrower' },
      { icon: '👁️', step: 'Review forecast',  who: 'person', note: '13-week grid, assumptions visible' },
      { icon: '✓',  step: 'Check covenants', who: 'ai',     note: 'Automated compliance table, week by week' },
      { icon: '🔎', step: 'Verify trail',     who: 'ai',     note: 'Auditable path from raw data to output' },
      { icon: '⚖️', step: 'Make decision',    who: 'person', note: 'Credit judgment stays with you' },
    ],
    futureBenefits: [
      'Standardized output across every borrower — same structure, same fields, same week-by-week layout.',
      'Normalization steps fully visible. The path from raw data to forecast number is auditable end to end.',
      'Covenant compliance presented directly — a clear table showing week-by-week status against all thresholds.',
      'Consistency and transparency signal the company is in control. Confidence restored.',
    ],
    loop: `The lender exercises the credit judgment the tool can't: whether the plan is believable, whether to extend, restructure, or call the loan. The tool makes the company's position legible; the decision stays with the lender.`,
  },
];

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
  State.l5Override = false;
}

function loadResolvedSamples() {
  const d = buildResolvedSampleData(State.cfg.startDate);
  Object.keys(d).forEach(k => {
    State.raw[k] = d[k];
    State.sources[k] = { loaded: true, count: d[k].length, name: k === 'ar' ? 'ar_resolved.csv' : 'sample_' + k + '.csv' };
  });
  State.cfg.inputFiles = 'resolved scenario (accelerated AR)';
  State.l5Override = false;
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
    normEvents: norm.events,
    normTasks: norm.tasks,
    risks,
    variance,
    driverHistory: newDrivers,
  };
  State.model = model;
  State.aiCommentary = null;
  State.aiRiskNarrative = null;
  State.claudeChat = [];
  State.briefMe = null;
  State.riskActions = {};
  State.coverNote = null;

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
  // Clear nav context if navigating to somewhere other than the context destination
  if (State.navContext && State.navContext.dest !== view) {
    State.navContext = null;
  }
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  window.scrollTo(0, 0);
}

function goWithContext(view, ctx) {
  State.navContext = Object.assign({ dest: view }, ctx);
  go(view);
  // Re-render the destination so the banner appears
  var renderers = { layer1: renderLayer1, layer2: renderLayer2, layer3: renderLayer3, layer4: renderLayer4, layer5: renderLayer5 };
  if (renderers[view]) renderers[view]();
}

function goWithRiskContext(btn) {
  var rtype = btn.getAttribute('data-rtype');
  var fix = riskFixTarget(rtype);
  goWithContext(fix.view, { from: 'Layer 4 · Variance & Risk', message: fix.message });
}

function navContextBanner() {
  if (!State.navContext) return '';
  var ctx = State.navContext;
  return '<div class="nav-ctx-banner">' +
    '<div class="ncb-from">← Sent from ' + (ctx.from || 'Layer 4') + '</div>' +
    '<div class="ncb-msg">' + ctx.message + '</div>' +
    '<button class="ncb-dismiss" onclick="State.navContext=null;this.closest(\'.nav-ctx-banner\').remove()">✕ Dismiss</button>' +
  '</div>';
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
  updateSidebarStatus();
}
// Static views rendered once on init (don't depend on forecast state)
function renderStaticViews() {
  renderHome();
  renderPersonas();
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

/* =====================================================================
 * BRANDING
 * ===================================================================== */
function applyBranding() {
  const color = State.cfg.accentColor;
  if (color) document.documentElement.style.setProperty('--green', color);
  else document.documentElement.style.removeProperty('--green');
  var sub = document.getElementById('topbar-client');
  if (sub) sub.textContent = State.cfg.clientName ? '· ' + State.cfg.clientName : '';
}

function setBrandColor(hex) {
  State.cfg.accentColor = hex;
  var picker = document.getElementById('cfg-color');
  if (picker) picker.value = hex;
  document.querySelectorAll('.brand-chip').forEach(function(b) {
    b.classList.toggle('brand-chip-active', b.getAttribute('data-color') === hex);
  });
  document.documentElement.style.setProperty('--green', hex);
}

function saveBranding() {
  var nameEl = document.getElementById('cfg-client-name');
  var colorEl = document.getElementById('cfg-color');
  if (nameEl) State.cfg.clientName = nameEl.value.trim();
  if (colorEl) State.cfg.accentColor = colorEl.value;
  applyBranding();
  renderSettings();
  toast('Branding applied');
}

/* =====================================================================
 * LAYER 1 — INLINE ASSUMPTIONS PANEL
 * ===================================================================== */
function toggleAssumptionsPanel() {
  var body = document.getElementById('l1-assumptions-body');
  var chev = document.getElementById('l1-assumptions-chev');
  if (!body) return;
  var open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (chev) chev.textContent = open ? '▶' : '▼';
}

function saveAssumptionsFromLayer1() {
  var c = State.cfg;
  var sd = document.getElementById('l1-cfg-start') ? document.getElementById('l1-cfg-start').value : '';
  if (sd) c.startDate = mondayOf(parseDate(sd));
  var open = document.getElementById('l1-cfg-open'); if (open && open.value) c.openingBalance = num(open.value);
  var buf  = document.getElementById('l1-cfg-buffer'); if (buf && buf.value) c.buffer = num(buf.value);
  var cov  = document.getElementById('l1-cfg-cov');  if (cov && cov.value) c.covenant = num(cov.value);
  runForecast();
  toast('Assumptions saved · forecast re-run');
}

function assumptionsPanelHTML(cfg) {
  return '<div class="assumptions-panel">' +
    '<div class="assumptions-header" onclick="toggleAssumptionsPanel()">' +
      '<span class="asmpt-title">⚙ Forecast Assumptions</span>' +
      '<span class="asmpt-hint">Opening balance · floor · covenant · start date</span>' +
      '<span id="l1-assumptions-chev" class="asmpt-chev">▶</span>' +
    '</div>' +
    '<div class="assumptions-body" id="l1-assumptions-body" style="display:none">' +
      '<div class="asmpt-fields">' +
        '<div class="field"><label>Forecast start (W1 Monday)</label><input type="date" id="l1-cfg-start" value="' + isoDate(cfg.startDate) + '"></div>' +
        '<div class="field"><label>Opening bank balance <span class="term-def" data-def="The actual bank balance on the forecast start date — the W1 seed value.">(?)</span></label><input type="number" id="l1-cfg-open" value="' + cfg.openingBalance + '"></div>' +
        '<div class="field"><label>Operating floor <span class="term-def" data-def="Minimum cash required for day-to-day operations. Weeks that close below this trigger a Cash Floor Breach flag.">(?)</span></label><input type="number" id="l1-cfg-buffer" value="' + cfg.buffer + '"></div>' +
        '<div class="field"><label>Covenant minimum <span class="term-def" data-def="Legally-required minimum cash agreed with lenders. Breaching it can trigger loan acceleration or a covenant violation.">(?)</span></label><input type="number" id="l1-cfg-cov" value="' + cfg.covenant + '"></div>' +
      '</div>' +
      '<button class="btn btn-primary btn-sm" onclick="saveAssumptionsFromLayer1()">Save &amp; re-run</button>' +
    '</div>' +
  '</div>';
}

/* =====================================================================
 * LAYER 4 — INLINE THRESHOLDS PANEL
 * ===================================================================== */
function toggleL4Thresholds() {
  var body = document.getElementById('l4-thresh-body');
  var chev = document.getElementById('l4-thresh-chev');
  if (!body) return;
  var open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (chev) chev.textContent = open ? '▶' : '▼';
}

function saveThresholdsFromLayer4() {
  var c = State.cfg;
  c.thresholds.category = { pct: parseFloat(document.getElementById('l4-th-cat-pct').value), abs: num(document.getElementById('l4-th-cat-abs').value) };
  c.thresholds.weekly   = { pct: parseFloat(document.getElementById('l4-th-wk-pct').value),  abs: num(document.getElementById('l4-th-wk-abs').value)  };
  c.thresholds.ending   = { pct: parseFloat(document.getElementById('l4-th-end-pct').value), abs: num(document.getElementById('l4-th-end-abs').value) };
  runForecast();
  toast('Thresholds saved · forecast re-run');
}

function l4ThresholdsPanelHTML(cfg) {
  var t = cfg.thresholds;
  return '<div class="assumptions-panel l4-thresh-panel">' +
    '<div class="assumptions-header" onclick="toggleL4Thresholds()">' +
      '<span class="asmpt-title">⚙ Variance Flag Thresholds</span>' +
      '<span class="asmpt-hint">Tune when category, weekly, and ending-balance variances trigger flags</span>' +
      '<span id="l4-thresh-chev" class="asmpt-chev">▶</span>' +
    '</div>' +
    '<div class="assumptions-body" id="l4-thresh-body" style="display:none">' +
      '<div class="asmpt-fields">' +
        '<div class="field"><label>Category variance (% / $ abs)</label><div class="flex"><input type="number" step="0.01" id="l4-th-cat-pct" value="' + t.category.pct + '"><input type="number" id="l4-th-cat-abs" value="' + t.category.abs + '"></div></div>' +
        '<div class="field"><label>Weekly net variance (% / $ abs)</label><div class="flex"><input type="number" step="0.01" id="l4-th-wk-pct" value="' + t.weekly.pct + '"><input type="number" id="l4-th-wk-abs" value="' + t.weekly.abs + '"></div></div>' +
        '<div class="field"><label>Ending balance variance (% / $ abs)</label><div class="flex"><input type="number" step="0.01" id="l4-th-end-pct" value="' + t.ending.pct + '"><input type="number" id="l4-th-end-abs" value="' + t.ending.abs + '"></div></div>' +
      '</div>' +
      '<button class="btn btn-primary btn-sm" onclick="saveThresholdsFromLayer4()">Save &amp; re-run</button>' +
    '</div>' +
  '</div>';
}

/* =====================================================================
 * DASHBOARD HELPERS
 * ===================================================================== */

/* Recommended actions derived from risk flags */
function dashActionItems(m) {
  if (!m.risks.length) return '';
  var items = m.risks.map(function(r, i) {
    var fix = riskFixTarget(r.type);
    var sev = r.severity === 'Critical' ? 'dai-crit' : r.severity === 'High' ? 'dai-high' : 'dai-med';
    return '<div class="dai-item ' + sev + '">' +
      '<div class="dai-num">' + (i + 1) + '</div>' +
      '<div class="dai-body">' +
        '<div class="dai-action">' + r.action + '</div>' +
        '<div class="dai-context">W' + r.week + ' · ' + r.type + ' · ' + sevBadge(r.severity) + '</div>' +
      '</div>' +
      '<button class="btn btn-ghost btn-xs fix-tip" data-tip="' + fix.tip + '" data-rtype="' + r.type + '" onclick="goWithRiskContext(this)">' + fix.label + ' →</button>' +
    '</div>';
  }).join('');
  return '<div class="card card-pad dai-card" style="margin-bottom:18px">' +
    '<div class="dai-head">' +
      '<div><h3 style="margin:0">Recommended Actions</h3>' +
      '<div class="card-sub">Prioritized by severity — resolve these before the lender package can be submitted</div></div>' +
      '<button class="btn btn-ghost btn-sm" onclick="go(\'layer4\')">Full risk detail →</button>' +
    '</div>' +
    '<div class="dai-list">' + items + '</div>' +
  '</div>';
}

/* Interactive cash position chart — dots are clickable to drill into a week */
function dashCashChart(f) {
  const W = 620, H = 240, pL = 56, pR = 20, pT = 16, pB = 28;
  const cfg = State.cfg;
  const xs = f.weeks.map((w, i) => pL + i * (W - pL - pR) / 12);
  const vals = f.weeks.map(w => w.closing);
  const bandsHi = f.weeks.map(w => w.closing + w.bandSigma);
  const bandsLo = f.weeks.map(w => w.closing - w.bandSigma);
  const allV = vals.concat(bandsHi, bandsLo, [cfg.buffer, cfg.covenant, 0]);
  const minV = Math.min.apply(null, allV), maxV = Math.max.apply(null, allV);
  const pad = (maxV - minV) * 0.1 || 1;
  const lo = minV - pad, hi = maxV + pad;
  const y = v => pT + (H - pT - pB) * (1 - (v - lo) / (hi - lo));
  const ptsLine = xs.map((x, i) => x.toFixed(1) + ',' + y(vals[i]).toFixed(1)).join(' ');
  const bandPath = xs.map((x, i) => x.toFixed(1) + ',' + y(bandsHi[i]).toFixed(1)).join(' ') + ' ' +
    xs.slice().reverse().map((x, i) => { const idx = xs.length - 1 - i; return x.toFixed(1) + ',' + y(bandsLo[idx]).toFixed(1); }).join(' ');
  const gridVals = [lo, lo + (hi - lo) / 2, hi];
  const grids = gridVals.map(gv => '<line class="grid-line" x1="' + pL + '" y1="' + y(gv).toFixed(1) + '" x2="' + (W - pR) + '" y2="' + y(gv).toFixed(1) + '"/><text class="axis-label" x="' + (pL - 6) + '" y="' + (y(gv) + 3).toFixed(1) + '" text-anchor="end">' + fmtM(gv) + '</text>').join('');
  const dots = f.weeks.map(function(wk, i) {
    const isBreach = wk.closing < cfg.buffer;
    const isSel = State.dashWeek === wk.week;
    return '<circle id="dsh-dot-' + wk.week + '" class="dot' + (isBreach ? ' breach' : '') + (isSel ? ' dot-sel' : '') + '" cx="' + xs[i].toFixed(1) + '" cy="' + y(vals[i]).toFixed(1) + '" r="' + (isSel ? 6 : 4) + '" style="cursor:pointer" onclick="selectDashWeek(' + wk.week + ')"/>';
  }).join('');
  const xlabels = f.weeks.map((w, i) => '<text class="axis-label" x="' + xs[i].toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle"' + (w.closing < cfg.buffer ? ' style="fill:var(--crit);font-weight:700"' : '') + '>W' + w.week + '</text>').join('');
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto">' +
    grids +
    '<polygon class="band" points="' + bandPath + '"/>' +
    '<line class="floor-line" x1="' + pL + '" y1="' + y(cfg.buffer).toFixed(1) + '" x2="' + (W - pR) + '" y2="' + y(cfg.buffer).toFixed(1) + '"/>' +
    '<line class="cov-line" x1="' + pL + '" y1="' + y(cfg.covenant).toFixed(1) + '" x2="' + (W - pR) + '" y2="' + y(cfg.covenant).toFixed(1) + '"/>' +
    '<polyline class="bal-line" points="' + ptsLine + '"/>' +
    dots + xlabels +
    '<text x="' + (W - pR) + '" y="' + (y(cfg.buffer) - 4).toFixed(1) + '" font-size="9" fill="var(--crit)" text-anchor="end" opacity="0.75">Floor</text>' +
    '<text x="' + (W - pR) + '" y="' + (y(cfg.covenant) - 4).toFixed(1) + '" font-size="9" fill="var(--high)" text-anchor="end" opacity="0.75">Covenant</text>' +
    '</svg>';
}

function selectDashWeek(n) {
  if (!State.model) return;
  State.dashWeek = (State.dashWeek === n) ? null : n;
  const f = State.model.forecasts[State.scenario], cfg = State.cfg;
  f.weeks.forEach(function(wk) {
    var dot = document.getElementById('dsh-dot-' + wk.week);
    if (!dot) return;
    const isBreach = wk.closing < cfg.buffer;
    const isSel = wk.week === State.dashWeek;
    dot.setAttribute('class', 'dot' + (isBreach ? ' breach' : '') + (isSel ? ' dot-sel' : ''));
    dot.setAttribute('r', isSel ? '6' : '4');
  });
  var panel = document.getElementById('dash-week-panel');
  if (panel) panel.innerHTML = State.dashWeek ? dashWeekPanelHTML(State.dashWeek) : '';
}

function dashWeekPanelHTML(weekNum) {
  const m = State.model, f = m.forecasts[State.scenario], cfg = State.cfg;
  const wk = f.weeks[weekNum - 1];
  const risks = m.risks.filter(function(r) { return r.week === weekNum; });
  const headroom = wk.closing - cfg.buffer;
  const isBreach = headroom < 0;
  const cats = [
    { label: 'AR Collections',   val: wk.cat.AR,      dir: 'in'  },
    { label: 'AP Disbursements', val: wk.cat.AP,      dir: 'out' },
    { label: 'Payroll',          val: wk.cat.Payroll, dir: 'out' },
    { label: 'Debt Service',     val: wk.cat.Debt,    dir: 'out' },
    { label: 'Capex',            val: wk.cat.Capex,   dir: 'out' },
  ].filter(function(c) { return c.val !== 0; });

  return '<div class="dwp-inner' + (isBreach ? ' dwp-breach-bg' : '') + '">' +
    '<div class="dwp-head">' +
      '<div class="dwp-week-label">' + wk.label + '</div>' +
      (isBreach ? '<span class="dwp-breach-badge">BREACH</span>' : '<span class="dwp-clear-badge">CLEAR</span>') +
      '<button class="btn btn-ghost btn-xs dwp-x" onclick="selectDashWeek(' + weekNum + ')">✕</button>' +
    '</div>' +
    '<div class="dwp-body">' +
      '<div class="dwp-flow-row">' +
        '<div class="dwp-flow-item"><div class="dwp-fl-label">Opening</div><div class="dwp-fl-val">' + fmtM(wk.opening) + '</div></div>' +
        '<div class="dwp-flow-arrow">→</div>' +
        '<div class="dwp-flow-item"><div class="dwp-fl-label">Net flow</div><div class="dwp-fl-val ' + (wk.net < 0 ? 'num-neg' : 'num-pos') + '">' + (wk.net >= 0 ? '+' : '') + fmtM(wk.net) + '</div></div>' +
        '<div class="dwp-flow-arrow">→</div>' +
        '<div class="dwp-flow-item"><div class="dwp-fl-label">Closing</div><div class="dwp-fl-val ' + (isBreach ? 'num-neg' : '') + '">' + fmtM(wk.closing) + '</div></div>' +
        '<div class="dwp-headroom ' + (isBreach ? 'dwp-hr-breach' : 'dwp-hr-ok') + '">' + (isBreach ? fmtM(headroom) + ' below floor' : '+' + fmtM(headroom) + ' above floor') + '</div>' +
      '</div>' +
      '<div class="dwp-cats">' +
        cats.map(function(c) {
          return '<div class="dwp-cat-row"><span class="dwp-cat-label">' + c.label + '</span><span class="dwp-cat-val ' + (c.dir === 'out' ? 'num-neg' : 'num-pos') + '">' + (c.dir === 'out' ? '−' : '+') + fmtM(Math.abs(c.val)) + '</span></div>';
        }).join('') +
      '</div>' +
      (risks.length ? '<div class="dwp-risk-row">' + risks.map(function(r) { return sevBadge(r.severity) + ' <b>' + r.type + '</b> · ' + r.driver; }).join('<br/>') + '</div>' : '') +
    '</div>' +
  '</div>';
}

/* 13-week aggregate bridge waterfall: Opening → category flows → Closing */
function dashBridgeWaterfall(f, cfg) {
  var totAR = 0, totAP = 0, totPayroll = 0, totDebt = 0, totCapex = 0;
  f.weeks.forEach(function(w) {
    totAR += w.cat.AR; totAP += w.cat.AP; totPayroll += w.cat.Payroll;
    totDebt += w.cat.Debt; totCapex += w.cat.Capex;
  });

  // Build segments with lo/hi for each floating bar
  var segs = [
    { key: 'open',    label: 'Opening',    value: f.openingBalance, type: 'anchor' },
    { key: 'ar',      label: 'Collections',value: totAR,            type: 'inflow'  },
    { key: 'ap',      label: 'AP Pmts',    value: totAP,            type: 'outflow' },
    { key: 'payroll', label: 'Payroll',    value: totPayroll,       type: 'outflow' },
    { key: 'debt',    label: 'Debt Svc',   value: totDebt,          type: 'outflow' },
    { key: 'capex',   label: 'Capex',      value: totCapex,         type: 'outflow' },
    { key: 'close',   label: 'W13 Close',  value: f.closingBalance, type: 'anchor'  },
  ];
  var run = f.openingBalance;
  segs.forEach(function(seg) {
    if (seg.type === 'anchor') {
      seg.lo = 0; seg.hi = seg.value;
    } else if (seg.type === 'inflow') {
      seg.lo = run; seg.hi = run + seg.value; run = seg.hi;
    } else {
      seg.hi = run; seg.lo = run + seg.value; run = seg.lo; // value negative
    }
  });

  var W = 720, H = 260, pL = 14, pR = 14, pT = 30, pB = 42;
  var slotW = (W - pL - pR) / segs.length;
  var barW = slotW * 0.58;

  var allV = [0, cfg.buffer, cfg.covenant];
  segs.forEach(function(s) { allV.push(s.lo); allV.push(s.hi); });
  var minV = Math.min.apply(null, allV), maxV = Math.max.apply(null, allV);
  var range = maxV - minV || 1;
  var yPad = range * 0.13;
  var yLo = minV - yPad, yHi = maxV + yPad;
  var sy = function(v) { return pT + (H - pT - pB) * (1 - (v - yLo) / (yHi - yLo)); };

  var COLORS = { open: '#3b6daa', ar: '#86BC25', ap: '#C8102E', payroll: '#E8A800', debt: '#7a1020', capex: '#888', close: '' };
  var parts = [];

  // Zero line
  var z0 = sy(0);
  parts.push('<line x1="' + pL + '" y1="' + z0.toFixed(1) + '" x2="' + (W - pR) + '" y2="' + z0.toFixed(1) + '" stroke="var(--gray-200)" stroke-width="1.5"/>');

  // Floor reference
  var flY = sy(cfg.buffer);
  parts.push('<line x1="' + pL + '" y1="' + flY.toFixed(1) + '" x2="' + (W - pR) + '" y2="' + flY.toFixed(1) + '" stroke="var(--crit)" stroke-width="1" stroke-dasharray="6,4" opacity="0.45"/>');
  parts.push('<text x="' + (pL + 4) + '" y="' + (flY - 4).toFixed(1) + '" font-size="9.5" fill="var(--crit)" opacity="0.6">Floor ' + fmtM(cfg.buffer) + '</text>');

  var prevConnY = null;
  segs.forEach(function(seg, i) {
    var cx = pL + (i + 0.5) * slotW;
    var x = cx - barW / 2;
    var bTop = sy(Math.max(seg.lo, seg.hi)), bBot = sy(Math.min(seg.lo, seg.hi));
    var bH = Math.max(bBot - bTop, 2);
    var col = COLORS[seg.key] || (f.closingBalance < cfg.buffer ? 'var(--crit)' : '#3b6daa');

    // Connector dash from previous bar
    if (prevConnY !== null && seg.type !== 'anchor') {
      var prevCx = pL + (i - 0.5) * slotW;
      parts.push('<line x1="' + (prevCx + barW / 2).toFixed(1) + '" y1="' + prevConnY.toFixed(1) + '" x2="' + x.toFixed(1) + '" y2="' + prevConnY.toFixed(1) + '" stroke="var(--gray-300)" stroke-width="1" stroke-dasharray="3,2"/>');
    }

    parts.push('<rect x="' + x.toFixed(1) + '" y="' + bTop.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + bH.toFixed(1) + '" fill="' + col + '" rx="3" opacity="' + (seg.type === 'anchor' ? '1' : '0.82') + '"/>');

    // Value label
    var labelY = bTop - 6;
    var prefix = seg.type === 'outflow' ? '−' : (seg.type === 'inflow' ? '+' : '');
    parts.push('<text x="' + cx.toFixed(1) + '" y="' + labelY.toFixed(1) + '" text-anchor="middle" font-size="10" fill="' + col + '" font-weight="700">' + prefix + fmtM(Math.abs(seg.value)) + '</text>');
    parts.push('<text x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10.5" fill="var(--gray-500)">' + seg.label + '</text>');

    prevConnY = seg.type === 'inflow' ? sy(seg.hi) : (seg.type === 'outflow' ? sy(seg.lo) : null);
  });

  return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">' + parts.join('') + '</svg>';
}

/* Weekly cash flow composition: stacked inflow/outflow bars with net line */
function dashWeeklyComposition(f, cfg) {
  var W = 680, H = 200, pL = 52, pR = 16, pT = 16, pB = 28;
  var plotW = W - pL - pR, plotH = H - pT - pB;
  var slotW = plotW / f.weeks.length;
  var barW = slotW * 0.54;

  var inflows = f.weeks.map(function(w) { return w.cat.AR; });
  var outflows = f.weeks.map(function(w) { return w.cat.AP + w.cat.Payroll + w.cat.Debt + w.cat.Capex; });
  var nets = f.weeks.map(function(w) { return w.net; });

  var allV = inflows.concat(outflows).concat([0]);
  var minV = Math.min.apply(null, allV), maxV = Math.max.apply(null, allV);
  var range = maxV - minV || 1;
  var yLo = minV - range * 0.1, yHi = maxV + range * 0.1;
  var sy = function(v) { return pT + plotH * (1 - (v - yLo) / (yHi - yLo)); };
  var z0 = sy(0);

  var parts = [];

  // Grid lines
  [yLo + (yHi - yLo) * 0.15, 0, yLo + (yHi - yLo) * 0.85].forEach(function(gv) {
    var gy = sy(gv);
    parts.push('<line x1="' + pL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - pR) + '" y2="' + gy.toFixed(1) + '" stroke="var(--gray-100)" stroke-width="1"/>');
    parts.push('<text x="' + (pL - 4) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--gray-400)">' + fmtM(gv) + '</text>');
  });

  // Zero axis
  parts.push('<line x1="' + pL + '" y1="' + z0.toFixed(1) + '" x2="' + (W - pR) + '" y2="' + z0.toFixed(1) + '" stroke="var(--gray-300)" stroke-width="1.5"/>');

  // Bars and labels
  f.weeks.forEach(function(wk, i) {
    var cx = pL + (i + 0.5) * slotW;
    var bx = cx - barW / 2;
    var inf = inflows[i], out = outflows[i];
    var isBreach = wk.closing < cfg.buffer;

    // Breach column tint
    if (isBreach) {
      parts.push('<rect x="' + (cx - slotW / 2 + 1).toFixed(1) + '" y="' + pT + '" width="' + (slotW - 2).toFixed(1) + '" height="' + plotH + '" fill="rgba(200,16,46,0.04)" rx="1"/>');
    }

    // Inflow bar (green, above zero)
    var infTop = sy(inf), infH = Math.max(z0 - infTop, 1);
    parts.push('<rect x="' + bx.toFixed(1) + '" y="' + infTop.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + infH.toFixed(1) + '" fill="var(--green)" opacity="0.75" rx="2"/>');

    // Outflow bar (red, below zero)
    var outBot = sy(out), outH = Math.max(outBot - z0, 1);
    parts.push('<rect x="' + bx.toFixed(1) + '" y="' + z0.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + outH.toFixed(1) + '" fill="var(--crit)" opacity="0.6" rx="2"/>');

    // X label
    parts.push('<text x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="' + (isBreach ? 'var(--crit)' : 'var(--gray-400)') + '" font-weight="' + (isBreach ? '700' : '400') + '">W' + wk.week + '</text>');
  });

  // Net flow line
  var netPts = f.weeks.map(function(wk, i) { return (pL + (i + 0.5) * slotW).toFixed(1) + ',' + sy(nets[i]).toFixed(1); }).join(' ');
  parts.push('<polyline points="' + netPts + '" fill="none" stroke="var(--ink)" stroke-width="1.5" opacity="0.45" stroke-dasharray="3,2"/>');
  // Net dots
  f.weeks.forEach(function(wk, i) {
    var cx = pL + (i + 0.5) * slotW;
    parts.push('<circle cx="' + cx.toFixed(1) + '" cy="' + sy(nets[i]).toFixed(1) + '" r="2.5" fill="' + (nets[i] >= 0 ? 'var(--green)' : 'var(--crit)') + '" opacity="0.9"/>');
  });

  return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">' + parts.join('') + '</svg>';
}

/* Three-scenario comparison mini-table */
function dashScenarioComparison(m) {
  var cfg = State.cfg;
  var rows = ['Base', 'Downside', 'Upside'].map(function(sc) {
    var ff = m.forecasts[sc];
    var scRisks = detectRisks(ff, cfg);
    var hasCrit = scRisks.some(function(r) { return r.severity === 'Critical'; });
    var hasHigh = scRisks.some(function(r) { return r.severity === 'High'; });
    var hasMed = scRisks.some(function(r) { return r.severity === 'Medium'; });
    var lt = hasCrit || hasHigh ? 'red' : hasMed ? 'amber' : 'green';
    var minWk = ff.weeks.reduce(function(a, w) { return w.closing < a.closing ? w : a; }, ff.weeks[0]);
    var active = sc === State.scenario;
    return '<tr class="' + (active ? 'sc-comp-active' : 'sc-comp-row') + '" onclick="setScenario(\'' + sc + '\')" title="Switch to ' + sc + ' scenario">' +
      '<td style="text-align:left">' + (active ? '<b>' : '') + ff.scenarioLabel + (active ? '</b>' : '') + '</td>' +
      '<td class="' + (minWk.closing < cfg.buffer ? 'num-neg' : '') + '">' + fmtM(minWk.closing) + '</td>' +
      '<td style="text-align:left;font-size:11px;color:var(--gray-500)">W' + minWk.week + '</td>' +
      '<td>' + fmtM(ff.closingBalance) + '</td>' +
      '<td><span class="tl-dot tl-' + lt + '">●</span></td>' +
    '</tr>';
  });
  return '<div class="dash-sc-wrap">' +
    '<div class="dash-sec-label">Scenario comparison <span style="font-size:11px;color:var(--gray-400);font-weight:400">(click to switch)</span></div>' +
    '<table class="dash-sc-table"><thead><tr><th style="text-align:left">Scenario</th><th>Tightest</th><th></th><th>W13 Close</th><th></th></tr></thead>' +
    '<tbody>' + rows.join('') + '</tbody></table>' +
  '</div>';
}

/* Risk timeline — horizontal strip showing which weeks have flags */
function dashRiskTimeline(risks) {
  var byWeek = {};
  risks.forEach(function(r) {
    if (!byWeek[r.week]) byWeek[r.week] = 'Medium';
    if (r.severity === 'Critical') byWeek[r.week] = 'Critical';
    else if (r.severity === 'High' && byWeek[r.week] !== 'Critical') byWeek[r.week] = 'High';
  });
  var W = 280, H = 42, pL = 8, pR = 8;
  var cx = function(wk) { return (pL + (wk - 1) / 12 * (W - pL - pR)).toFixed(1); };
  var parts = ['<line x1="' + pL + '" y1="19" x2="' + (W - pR) + '" y2="19" stroke="var(--gray-200)" stroke-width="1.5"/>'];
  for (var w = 1; w <= 13; w++) {
    var sev = byWeek[w];
    var col = sev === 'Critical' ? 'var(--crit)' : sev === 'High' ? 'var(--high)' : sev === 'Medium' ? '#b0b0b0' : 'var(--gray-200)';
    var r = sev ? 5 : 3;
    var x = cx(w);
    parts.push('<circle cx="' + x + '" cy="19" r="' + r + '" fill="' + col + '"/>');
    if (sev) parts.push('<text x="' + x + '" y="38" text-anchor="middle" font-size="9" fill="' + col + '" font-weight="700">W' + w + '</text>');
  }
  return '<div class="dash-risk-tl">' +
    '<div class="dash-sec-label">Risk weeks</div>' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:' + H + 'px">' + parts.join('') + '</svg>' +
  '</div>';
}

/* ---------------- DASHBOARD ---------------- */
function renderDashboard() {
  const el = document.getElementById('view-dashboard');
  if (!State.model) {
    el.innerHTML = `
      <div class="page-head"><div class="eyebrow">Pipeline Results Summary</div>
      <h2>Liquidity Dashboard</h2>
      <p>Complete 13-week results from the full five-layer pipeline. Run a forecast to see your cash position, risk flags, and export-ready packages — all in one view.</p></div>
      <div class="card card-pad empty">
        <div class="big">📊</div>
        <h3>No forecast generated yet</h3>
        <p class="muted" style="margin:8px 0 18px">Load the built-in sample treasury data and run all five layers in one click.</p>
        <button class="btn btn-primary" onclick="loadAllSamples();runForecast()">► Load sample data &amp; run forecast</button>
      </div>`;
    return;
  }
  const m = State.model, f = m.forecasts[m.scenario], cfg = State.cfg;
  const crit = m.risks.filter(r => r.severity === 'Critical').length;
  const high = m.risks.filter(r => r.severity === 'High').length;
  const med  = m.risks.filter(r => r.severity === 'Medium').length;
  const light = crit || high ? 'red' : (med ? 'amber' : 'green');
  const minWk = f.weeks.reduce((a, w) => w.closing < a.closing ? w : a, f.weeks[0]);
  const headroom = minWk.closing - cfg.buffer;

  // Status banner headline
  let statusHeadline, statusSub, statusCtas;
  if (light === 'red') {
    const topRisk = m.risks.find(r => r.severity === 'Critical') || m.risks[0];
    statusHeadline = 'W' + topRisk.week + ' Cash Floor Breach — ' + fmtM(topRisk.closing) + ' projected closing is ' + fmtM(Math.abs(topRisk.shortfall)) + ' below the ' + fmtM(cfg.buffer) + ' operating floor';
    statusSub = topRisk.driver + '. Review the risk flags and adjust inputs to resolve before packaging for lenders.';
    statusCtas = '<button class="btn btn-ghost btn-sm" onclick="go(\'layer4\')">View risk flags →</button><button class="btn btn-ghost btn-sm" onclick="go(\'layer1\')">Adjust inputs →</button>';
  } else if (light === 'amber') {
    statusHeadline = 'No floor breaches — medium-severity flags require attention before submission';
    statusSub = 'Tightest week is W' + minWk.week + ' at ' + fmtM(minWk.closing) + ', ' + fmtM(headroom) + ' above the floor. Review medium flags before packaging.';
    statusCtas = '<button class="btn btn-ghost btn-sm" onclick="go(\'layer4\')">View risk flags →</button>';
  } else {
    statusHeadline = 'All 13 weeks clear — no floor breaches across Base, Downside, or Upside scenarios';
    statusSub = 'Tightest week is W' + minWk.week + ' at ' + fmtM(minWk.closing) + ', ' + fmtM(headroom) + ' above the ' + fmtM(cfg.buffer) + ' floor. Forecast is ready to package.';
    statusCtas = '<button class="btn btn-primary btn-sm" onclick="go(\'layer5\')">Go to Output Layer →</button>';
  }

  // KPI sub-labels
  const w13headroom = f.closingBalance - cfg.buffer;
  const netInterp = Math.abs(f.netChange) < 500000 ? 'essentially cash-neutral' : f.netChange > 0 ? 'net cash build' : 'net cash burn';

  el.innerHTML = `
    <div class="page-head" style="margin-bottom:14px"><div class="eyebrow">Pipeline Results · ${f.scenarioLabel} · Run ${m.runId}</div><h2>Liquidity Dashboard</h2></div>

    <!-- Status banner -->
    <div class="dash-status dash-status-${light}" style="margin-bottom:${m.risks.length ? '12px' : '18px'}">
      <span class="traffic ${light}"><span class="dot"></span>${light.toUpperCase()}</span>
      <div class="ds-body">
        <div class="ds-headline">${statusHeadline}</div>
        <div class="ds-sub">${statusSub}</div>
      </div>
      <div class="ds-ctas">${statusCtas}</div>
    </div>

    ${dashActionItems(m)}

    <!-- KPI row -->
    <div class="grid g4" style="margin-bottom:18px">
      <div class="kpi blue kpi-link" onclick="go('layer3')">
        <div class="k-label">Opening Balance</div>
        <div class="k-val">${fmtM(f.openingBalance)}</div>
        <div class="k-sub">W1 start · ${isoDate(cfg.startDate)}</div>
        <div class="kpi-nav">Layer 3 →</div>
      </div>
      <div class="kpi ${f.netChange < -500000 ? 'red' : ''} kpi-link" onclick="go('layer3')">
        <div class="k-label">13-Week Net Change</div>
        <div class="k-val">${fmtM(f.netChange)}</div>
        <div class="k-sub">${netInterp}</div>
        <div class="kpi-nav">Layer 3 →</div>
      </div>
      <div class="kpi ${f.closingBalance < cfg.buffer ? 'red' : ''} kpi-link" onclick="go('layer3')">
        <div class="k-label">W13 Closing Balance</div>
        <div class="k-val">${fmtM(f.closingBalance)}</div>
        <div class="k-sub">${w13headroom >= 0 ? '+' + fmtM(w13headroom) + ' above floor' : fmtM(w13headroom) + ' below floor'}</div>
        <div class="kpi-nav">Layer 3 →</div>
      </div>
      <div class="kpi ${light === 'red' ? 'red' : light === 'amber' ? 'amber' : ''} kpi-link" onclick="go('layer4')">
        <div class="k-label">Liquidity Status</div>
        <div class="k-val" style="font-size:18px;padding-top:4px"><span class="traffic ${light}"><span class="dot"></span>${light.toUpperCase()}</span></div>
        <div class="k-sub">${m.risks.length} flag${m.risks.length !== 1 ? 's' : ''} · ${crit} critical · ${high} high</div>
        <div class="kpi-nav">Layer 4 →</div>
      </div>
    </div>

    <!-- Cash chart + right panel -->
    <div class="dash-mid" style="margin-bottom:18px">
      <div class="card card-pad dash-chart-card">
        <div class="dash-chart-head">
          <div>
            <h3 style="margin:0 0 2px">13-Week Cash Position</h3>
            <div class="card-sub">Click any week to see its breakdown · ${f.scenarioLabel}</div>
          </div>
          <div class="legend" style="margin:0">
            <span><i style="background:var(--green)"></i>Balance</span>
            <span><i style="background:rgba(134,188,37,.35)"></i>±1σ band</span>
            <span><i style="background:var(--crit)"></i>Floor</span>
          </div>
        </div>
        <div class="chart-wrap">${dashCashChart(f)}</div>
        <div id="dash-week-panel">${State.dashWeek ? dashWeekPanelHTML(State.dashWeek) : ''}</div>
      </div>
      <div class="dash-right-panel">
        <div class="card card-pad" style="margin-bottom:12px">
          ${dashScenarioComparison(m)}
          <div style="margin-top:12px">${dashRiskTimeline(m.risks)}</div>
          ${m.risks.length ? '<div class="dash-flag-list">' + m.risks.slice(0, 3).map(r => '<div class="dash-flag-row">' + sevBadge(r.severity) + '<div class="dash-flag-text"><b>W' + r.week + ' · ' + r.type + '</b><div class="dash-flag-driver">' + r.driver + '</div></div></div>').join('') + (m.risks.length > 3 ? '<div class="muted" style="font-size:12px;margin-top:4px">+' + (m.risks.length - 3) + ' more — <a href="#" onclick="go(\'layer4\');return false">view all →</a></div>' : '') + '</div>' : '<div class="muted" style="font-size:12px;margin-top:10px">No risk flags in current scenario.</div>'}
        </div>
      </div>
    </div>

    <!-- Bridge waterfall -->
    <div class="card card-pad" style="margin-bottom:18px">
      <h3>13-Week Cash Flow Bridge</h3>
      <div class="card-sub">What moved your cash — opening balance through each category to the W13 close · ${f.scenarioLabel}</div>
      <div style="margin-top:12px">${dashBridgeWaterfall(f, cfg)}</div>
      <div class="legend" style="margin-top:8px">
        <span><i style="background:#3b6daa"></i>Balance</span>
        <span><i style="background:var(--green)"></i>AR Collections (inflow)</span>
        <span><i style="background:var(--crit)"></i>AP Payments (outflow)</span>
        <span><i style="background:var(--high)"></i>Payroll</span>
        <span><i style="background:#7a1020"></i>Debt Service</span>
        <span><i style="background:#888"></i>Capex</span>
      </div>
    </div>

    <!-- Weekly composition -->
    <div class="card card-pad" style="margin-bottom:18px">
      <h3>Weekly Cash Flow Composition</h3>
      <div class="card-sub">Inflows (green, above) vs. outflows (red, below) by week · dashed line = net · breach weeks highlighted</div>
      <div style="margin-top:12px">${dashWeeklyComposition(f, cfg)}</div>
      <div class="legend" style="margin-top:8px">
        <span><i style="background:var(--green)"></i>AR Inflows</span>
        <span><i style="background:var(--crit)"></i>Total Outflows</span>
        <span style="display:inline-flex;align-items:center;gap:6px"><span style="display:inline-block;width:16px;height:2px;border-top:2px dashed var(--ink);opacity:0.45"></span>Net flow</span>
      </div>
    </div>

    <!-- Brief me -->
    <div class="brief-me-card card card-pad" style="margin-bottom:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div>
          <span class="brief-me-eyebrow">✦ CFO Briefing</span>
          <div class="card-sub" style="margin-top:2px">One-paragraph narrative on position, top risk, and recommended action</div>
        </div>
        <button class="btn btn-primary" id="brief-me-btn" onclick="runBriefMe()" style="flex-shrink:0">${State.briefMe ? '✦ Regenerate' : '✦ Brief me'}</button>
      </div>
      <div id="brief-me-out" style="margin-top:${State.briefMe ? '12px' : '0'}">${State.briefMe ? '<div class="ai-response brief-me-response">' + State.briefMe.replace(/\n/g, '<br/>') + '</div>' : ''}</div>
    </div>

    ${askClaudeSection()}`;
  setTimeout(renderChatMessages, 0);
}

/* =====================================================================
 * PIPELINE NAVIGATION HELPERS
 * ===================================================================== */
const PIPE_STEPS = [
  { n: 1, label: 'Ingest',    view: 'layer1' },
  { n: 2, label: 'Normalize', view: 'layer2' },
  { n: 3, label: 'Forecast',  view: 'layer3' },
  { n: 4, label: 'Risk',      view: 'layer4' },
  { n: 5, label: 'Output',    view: 'layer5' },
];

function pipelineProgress(current) {
  const ran = !!State.model;
  const loaded = anyLoaded();
  function state(n) {
    if (n === current) return 'curr';
    if (n < current && (ran || (n === 1 && loaded))) return 'done';
    if (ran) return 'avail';
    return 'pend';
  }
  return '<div class="pipe-prog">' +
    PIPE_STEPS.map(function(s, i) {
      var st = state(s.n);
      return '<div class="pp-step pp-' + st + '" onclick="go(\'' + s.view + '\')" title="Go to Layer ' + s.n + '">' +
          '<div class="pp-dot">' + (st === 'done' ? '✓' : s.n) + '</div>' +
          '<div class="pp-lbl">' + s.label + '</div>' +
        '</div>' +
        (i < PIPE_STEPS.length - 1 ? '<div class="pp-arr pp-arr-' + (st === 'done' ? 'done' : 'pend') + '">→</div>' : '');
    }).join('') +
  '</div>';
}

function handoffBanner(layerNum) {
  const m = State.model;
  const f = m ? m.forecasts[State.scenario] : null;
  const srcLoaded = Object.values(State.sources).filter(function(s) { return s && s.loaded; });
  const totalRecs  = srcLoaded.reduce(function(n, s) { return n + s.count; }, 0);

  var from = null, produces = '';
  switch (layerNum) {
    case 1:
      produces = 'Five categorized data sets handed to the normalization engine.';
      break;
    case 2:
      from     = srcLoaded.length ? 'Layer 1 loaded <b>' + totalRecs + ' records</b> across ' + srcLoaded.length + ' data source' + (srcLoaded.length !== 1 ? 's' : '') : 'No data loaded yet — go to <a href="#" onclick="go(\'layer1\');return false">Layer 1</a> to load your files';
      produces = 'A unified cash-event model — every inflow and outflow with a date, amount, category, and confidence score.';
      break;
    case 3:
      from     = m ? 'Layer 2 produced <b>' + f.events.length + ' normalized cash events</b> ready for projection' : 'Run the forecast first to see normalized events';
      produces = 'Three scenario forecasts — Base, Downside, Upside — projected week by week for 13 weeks.';
      break;
    case 4:
      from     = m ? 'Layer 3 built a <b>' + f.scenarioLabel + ' forecast</b> · W13 close ' + fmtM(f.closingBalance) : 'Run the forecast first to see the 13-week projection';
      produces = 'Liquidity risk windows, variance analysis vs. the prior run, and AI-generated commentary.';
      break;
    case 5:
      from     = m ? 'Layer 4 scanned 13 weeks · <b>' + m.risks.length + ' risk window' + (m.risks.length !== 1 ? 's' : '') + ' flagged</b>' + (m.risks.filter(function(r){ return r.severity === 'Critical'; }).length ? ' including ' + m.risks.filter(function(r){ return r.severity === 'Critical'; }).length + ' Critical' : '') : 'Run the forecast first to see risk analysis';
      produces = 'Board-, lender-, and audit-ready export packages — all drawn from the same data model.';
      break;
  }
  return '<div class="handoff-banner">' +
    (from ? '<div class="hb-row hb-from"><span class="hb-icon">←</span><div><span class="hb-label">In from previous step</span><span class="hb-text">' + from + '</span></div></div>' : '') +
    '<div class="hb-row hb-produces"><span class="hb-icon">↓</span><div><span class="hb-label">This step produces</span><span class="hb-text">' + produces + '</span></div></div>' +
  '</div>';
}

function continueFooter(layerNum) {
  const ran = !!State.model;
  const loaded = anyLoaded();
  const NEXT = {
    1: { view: 'layer2', label: 'Continue to Layer 2: Normalization →', note: 'See exactly how the raw data was cleaned and standardized.' },
    2: { view: 'layer3', label: 'Continue to Layer 3: Forecast Engine →', note: 'See the 13-week cash position built from these events.' },
    3: { view: 'layer4', label: 'Continue to Layer 4: Variance & Risk →', note: 'Find out which weeks breach the operating floor and why.' },
    4: { view: 'layer5', label: 'Continue to Layer 5: Output Layer →', note: 'Package the forecast and risk data for export.' },
    5: { view: 'dashboard', label: 'View Summary Dashboard →', note: 'See the full liquidity picture — all pipeline results in one view.' },
  };
  const next = NEXT[layerNum];
  if (!next) return '';

  if (layerNum === 1) {
    if (ran) {
      return '<div class="continue-footer cf-done">' +
        '<div class="cf-note">Layer 1 complete — forecast has been run.</div>' +
        '<button class="btn btn-primary cf-btn" onclick="go(\'' + next.view + '\')">' + next.label + '</button>' +
      '</div>';
    }
    if (loaded) {
      return '<div class="continue-footer cf-ready">' +
        '<div class="cf-note">Data loaded. Click Run Forecast to process all 5 layers — then see results starting at Layer 2.</div>' +
        '<button class="btn btn-primary cf-btn" onclick="runForecast();go(\'layer2\')">► Run Forecast — then view Layer 2 →</button>' +
      '</div>';
    }
    return '<div class="continue-footer cf-waiting">' +
      '<div class="cf-note">Load at least one data source above (or use "Load all sample data") to begin.</div>' +
    '</div>';
  }

  if (!ran) return '';
  return '<div class="continue-footer cf-done">' +
    '<div class="cf-note">' + next.note + '</div>' +
    '<button class="btn btn-primary cf-btn" onclick="go(\'' + next.view + '\')">' + next.label + '</button>' +
  '</div>';
}

function updateSidebarStatus() {
  const ran = !!State.model;
  const loaded = anyLoaded();
  document.querySelectorAll('#nav [data-view]').forEach(function(btn) {
    var view = btn.getAttribute('data-view');
    var dot = btn.querySelector('.lyr-dot');
    if (!dot) return;
    if (view === 'layer1') {
      dot.className = 'lyr-dot' + (loaded ? ' dot-ready' : '');
    } else if (['layer2','layer3','layer4','layer5'].includes(view)) {
      dot.className = 'lyr-dot' + (ran ? ' dot-ready' : '');
    }
  });
}

/* ---------------- LAYER 1: INGESTION ---------------- */
function renderLayer1() {
  const el = document.getElementById('view-layer1');
  el.innerHTML = pipelineProgress(1) + navContextBanner() + `
    <div class="page-head"><div class="eyebrow">Layer 1 · Data Ingestion</div><h2>Load Your Data</h2>
      <p>Five standardized input types accepted as CSV. Load the built-in sample data for an instant demo, or upload your own ERP/HRIS exports. Column headers are auto-detected — no template required.</p></div>
    ` + handoffBanner(1) + `
    <div class="l1-load-bar">
      <button class="btn btn-primary btn-sm" onclick="loadAllSamples();renderLayer1();toast('Loaded sample data — W7 breach active')">Load crisis scenario</button>
      <button class="btn btn-green btn-sm" onclick="loadResolvedSamples();renderLayer1();runForecast();toast('Resolved scenario loaded &amp; forecast re-run — W7 breach cleared')">✓ Load resolved scenario</button>
      <button class="btn btn-ghost btn-sm" onclick="downloadSampleCSVs()">⬇ Download CSV templates</button>
      <span class="muted l1-load-hint">All inputs support CSV / Excel from any major ERP or HRIS.</span>
    </div>
    <div class="l1-scenario-note">
      <b>Crisis scenario</b> — $8M opening, W7 Cash Floor Breach ($3.7M closing) driven by $6M Term Loan A balloon. &nbsp;·&nbsp;
      <b>Resolved scenario</b> — Acme Corporation and Summit Healthcare accelerate $2.4M in receivables to W6–W7, clearing the breach.
    </div>
    ` + assumptionsPanelHTML(State.cfg) + `
    <div class="grid g2">${SOURCES.map(srcCard).join('')}</div>
    ` + continueFooter(1);
  // wire dropzones
  SOURCES.forEach(s => wireDrop(s.key));
  updateSidebarStatus();
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

/* Category summary tiles — shows before the event table inside the drill section */
function catBreakdown(allEvs) {
  const CAT_META = {
    AR:      { label: 'Receivables',  dir: 'in'  },
    AP:      { label: 'Payables',     dir: 'out' },
    Payroll: { label: 'Payroll',      dir: 'out' },
    Debt:    { label: 'Debt Service', dir: 'out' },
    Capex:   { label: 'Capex',        dir: 'out' },
  };
  const tiles = CATEGORIES.map(function(cat) {
    const catEvs = allEvs.filter(function(e) { return e.category === cat; });
    const low = catEvs.filter(function(e) { return e.confidence === 'Low'; }).length;
    const med = catEvs.filter(function(e) { return e.confidence === 'Medium'; }).length;
    const total = Math.abs(catEvs.reduce(function(s, e) { return s + e.amount; }, 0));
    const meta = CAT_META[cat];
    const flagHtml = low ? `<span class="cb-flag">${low} low-conf</span>` : (med ? `<span class="cb-flag cb-flag-med">${med} medium</span>` : '');
    return `<div class="cb-tile" onclick="filterEvents('${cat}')" title="Click to filter to ${meta.label}">
      <div class="cb-label">${meta.label}</div>
      <div class="cb-amount">${fmtM(total)}</div>
      <div class="cb-meta">${catEvs.length} events ${flagHtml}</div>
    </div>`;
  });
  return `<div class="cat-breakdown">${tiles.join('')}<div class="cb-tile cb-all" onclick="filterEvents('')" title="Show all"><div class="cb-label">All</div><div class="cb-amount">${fmtM(Math.abs(allEvs.reduce((s,e)=>s+e.amount,0)))}</div><div class="cb-meta">${allEvs.length} events</div></div></div>`;
}

/* Visual normalization transform cards — replaces jargon bullet list */
function normTransformCards(evs) {
  const byCat = {};
  CATEGORIES.forEach(function(c) { byCat[c] = evs.filter(function(e) { return e.category === c; }); });
  const defs = [
    {
      cat: 'AR', abbr: 'AR', title: 'Customer Receivables',
      desc: 'Outstanding invoices are scheduled based on each customer\'s payment history. Reliable clients have tight, predictable dates. Smaller or newer accounts carry wider uncertainty — they may pay late.',
      conf: [{ label: 'Tier 1 clients', c: 'High' }, { label: 'Tier 2 clients', c: 'Medium' }, { label: 'Tier 3 clients', c: 'Low' }],
    },
    {
      cat: 'AP', abbr: 'AP', title: 'Supplier Payments',
      desc: 'Bills are scheduled by agreed payment terms. Payments you can delay (like discretionary vendor spend) are flagged as flexible; contractual obligations are fixed.',
      conf: [{ label: 'Standard terms', c: 'High' }, { label: 'Flexible / Net 45+', c: 'Medium' }],
    },
    {
      cat: 'Payroll', abbr: 'PR', title: 'Payroll',
      desc: 'Pay runs are locked to exact pay dates at full cost — gross wages plus employer taxes and benefits. There is no flexibility in payroll timing or amount.',
      conf: [{ label: 'All payroll runs', c: 'High' }],
    },
    {
      cat: 'Debt', abbr: 'DS', title: 'Debt Obligations',
      desc: 'Each loan payment is split into principal and interest. The full repayment schedule is loaded, including any large balloon payments due at maturity.',
      conf: [{ label: 'All debt service', c: 'High' }],
    },
    {
      cat: 'Capex', abbr: 'CX', title: 'Capital Expenditure',
      desc: 'Project spend is weighted by approval stage. Fully approved projects are booked at 100%. Projects still in review are included at a fraction of their cost — reflecting the chance they are delayed or cancelled.',
      conf: [{ label: 'PO issued', c: 'High' }, { label: 'Pending PO', c: 'Medium' }, { label: 'In approval', c: 'Low' }],
    },
  ];
  return defs.map(function(d) {
    const catEvs = byCat[d.cat] || [];
    const total = Math.abs(catEvs.reduce(function(s, e) { return s + e.amount; }, 0));
    const confHtml = d.conf.map(function(r) {
      const cls = r.c === 'High' ? 'b-high' : r.c === 'Medium' ? 'b-med' : 'b-low';
      return `<span class="nc-conf-item"><span class="badge ${cls}">${r.c}</span> ${r.label}</span>`;
    }).join('');
    return `<div class="nc-card">
      <div class="nc-header"><span class="nc-abbr">${d.abbr}</span><div class="nc-head-text"><div class="nc-title">${d.title}</div><div class="nc-stat">${catEvs.length} events · ${fmtM(total)}</div></div></div>
      <div class="nc-desc">${d.desc}</div>
      <div class="nc-conf">${confHtml}</div>
    </div>`;
  }).join('');
}

/* Priority sort: Low+RiskWeek > Low > Medium+RiskWeek > Medium > High, then by |amount| desc */
function sortedByPriority(evs, riskWeeks) {
  function pri(e) {
    const inRisk = riskWeeks.has(e.week);
    if (e.confidence === 'Low'    && inRisk) return 0;
    if (e.confidence === 'Low')              return 1;
    if (e.confidence === 'Medium' && inRisk) return 2;
    if (e.confidence === 'Medium')           return 3;
    return 4;
  }
  return evs.slice().sort(function(a, b) {
    const pd = pri(a) - pri(b);
    return pd !== 0 ? pd : Math.abs(b.amount) - Math.abs(a.amount);
  });
}

/* Decision card — answers "does the uncertainty change the forecast outcome?" */
function decisionCard(evs, risks) {
  const riskWeeks = new Set(risks.map(function(r) { return r.week; }));
  const lowConf = evs.filter(function(e) { return e.confidence === 'Low'; });
  const lowInRisk = lowConf.filter(function(e) { return riskWeeks.has(e.week); });
  const lowTotal = lowConf.reduce(function(s, e) { return s + Math.abs(e.amount); }, 0);
  const lowRiskTotal = lowInRisk.reduce(function(s, e) { return s + Math.abs(e.amount); }, 0);
  const critRisk = risks.filter(function(r) { return r.shortfall > 0; }).sort(function(a, b) { return b.shortfall - a.shortfall; })[0];
  const worstShortfall = critRisk ? critRisk.shortfall : 0;

  if (!lowConf.length) {
    return '<div class="decision-card dc-ok">' +
      '<div class="dc-icon">✓</div>' +
      '<div class="dc-body">' +
        '<div class="dc-answer">All ' + evs.length + ' events are Medium or High confidence — no review needed</div>' +
        '<div class="dc-detail">The normalized model is clean. Proceed to the forecast engine.</div>' +
      '</div>' +
      '<button class="btn btn-primary dc-cta" onclick="go(\'layer3\')">Continue to Forecast →</button>' +
    '</div>';
  }

  var answer, cardClass;
  if (!lowInRisk.length) {
    answer = 'Uncertain items don\'t touch any flagged risk week' + (critRisk ? ' — the W' + critRisk.week + ' crisis scenario is unaffected' : '') + '. Proceed to forecast.';
    cardClass = 'dc-ok';
  } else if (worstShortfall > 0 && lowRiskTotal <= worstShortfall) {
    answer = 'Even if all uncertain items in risk weeks miss entirely, the W' + critRisk.week + ' shortfall grows from ' + fmtM(worstShortfall) + ' to ' + fmtM(worstShortfall + lowRiskTotal) + ' — the crisis outcome is unchanged. Proceed to forecast.';
    cardClass = 'dc-ok';
  } else if (worstShortfall > 0) {
    answer = 'Uncertain items in risk weeks total ' + fmtM(lowRiskTotal) + ' — material relative to the ' + fmtM(worstShortfall) + ' shortfall. These items could affect the outcome. Confirm before generating the lender package.';
    cardClass = 'dc-warn';
  } else {
    answer = lowInRisk.length + ' uncertain item' + (lowInRisk.length !== 1 ? 's' : '') + ' (' + fmtM(lowRiskTotal) + ') fall in risk-adjacent weeks. Review before finalizing.';
    cardClass = 'dc-warn';
  }

  const detail = lowConf.length + ' low-confidence event' + (lowConf.length !== 1 ? 's' : '') + ' · ' + fmtM(lowTotal) + ' total · ' + lowInRisk.length + ' in risk weeks (' + fmtM(lowRiskTotal) + ') · ' + (evs.length - lowConf.length) + ' of ' + evs.length + ' events are Medium or High confidence.';

  return '<div class="decision-card ' + cardClass + '">' +
    '<div class="dc-icon">' + (cardClass === 'dc-ok' ? '✓' : '⚑') + '</div>' +
    '<div class="dc-body">' +
      '<div class="dc-answer">' + answer + '</div>' +
      '<div class="dc-detail">' + detail + '</div>' +
    '</div>' +
    '<div class="dc-actions">' +
      '<button class="btn btn-primary dc-cta" onclick="go(\'layer3\')">Proceed to Forecast →</button>' +
      '<button class="btn btn-ghost btn-sm" id="drill-toggle-btn" onclick="toggleDrillSection()">↓ Drill into detail (' + lowConf.length + ' flagged)</button>' +
    '</div>' +
  '</div>';
}

function toggleDrillSection() {
  const section = document.getElementById('drill-detail');
  const btn = document.getElementById('drill-toggle-btn');
  if (!section) return;
  const isOpen = section.style.display !== 'none';
  section.style.display = isOpen ? 'none' : 'block';
  if (btn) {
    if (isOpen) {
      const n = State.model ? State.model.normEvents.filter(function(e) { return e.confidence === 'Low'; }).length : 0;
      btn.textContent = '↓ Drill into detail (' + n + ' flagged)';
    } else {
      btn.textContent = '↑ Hide detail';
    }
  }
}

function renderLayer2() {
  const el = document.getElementById('view-layer2');
  if (!State.model) { el.innerHTML = emptyLayer('Run a forecast to see the normalized cash-event model.'); return; }
  const f = State.model.forecasts[State.scenario];
  const evs = State.model.normEvents;
  const riskWeeks = new Set(State.model.risks.map(r => r.week));
  const byCat = {};
  CATEGORIES.forEach(c => byCat[c] = evs.filter(e => e.category === c));
  const lowConf = evs.filter(e => e.confidence === 'Low');
  const drillEvs = sortedByPriority(lowConf.length ? lowConf : evs, riskWeeks);
  const drillSub = lowConf.length
    ? 'Showing ' + lowConf.length + ' low-confidence events · sorted by priority (risk week + amount)'
    : 'All ' + evs.length + ' normalized events · sorted by date';
  const toggleBtn = lowConf.length
    ? `<button class="btn btn-ghost btn-sm" id="evtTbl-toggle" onclick="showAllEvents()">Show all ${evs.length} events</button>`
    : '';

  el.innerHTML = pipelineProgress(2) + `
    <div class="page-head"><div class="eyebrow">Layer 2 · Normalization Engine</div><h2>Normalized Data Review</h2>
      <p>Five raw inputs transformed into a single cash-event model. The question here is not "review every row" — it's one decision: <b>do the uncertain items change the forecast outcome?</b> The answer is below.</p></div>
    ` + handoffBanner(2) +
    decisionCard(evs, State.model.risks) + `

    <div id="drill-detail" style="display:none;margin-bottom:18px">
      <div class="card card-pad">
        <div class="evt-tbl-head">
          <div>
            <h3>Event Detail</h3>
            <div class="card-sub" id="evtTbl-sub">${drillSub}</div>
          </div>
          ${toggleBtn}
        </div>
        ${catBreakdown(evs)}
        <div class="tbl-wrap" id="eventTbl">${eventTable(drillEvs, { riskWeeks, sorted: true })}</div>
      </div>
    </div>

    <div class="card card-pad" style="margin-bottom:18px">
      <h3>How each input was processed</h3>
      <div class="card-sub" style="margin-bottom:14px">Plain-language summary of what the normalization engine did to each data source and how confidence was assigned</div>
      <div class="nc-grid">${normTransformCards(evs)}</div>
    </div>

    <div class="card card-pad" style="margin-bottom:18px">
      <h3>Confidence distribution</h3>
      <div class="card-sub">Share of total cash movement by confidence tier · pre-scenario, all categories</div>
      ${confMixBars({ events: evs })}
    </div>
    ` + continueFooter(2);
}

function eventTable(evs, opts) {
  const riskWeeks = (opts && opts.riskWeeks) || new Set();
  const rows = (opts && opts.sorted) ? evs.slice(0, 400) : evs.slice().sort((a, b) => a.date - b.date).slice(0, 400);
  const riskBadge = w => riskWeeks.has(w) ? '<span class="evt-risk-badge">risk wk</span>' : '';
  const rowCls = e => e.confidence === 'Low' ? 'evt-row-low' : (e.confidence === 'Medium' ? 'evt-row-med' : '');
  return `<table><thead><tr><th>Week</th><th>Date</th><th>Category</th><th>Entity</th><th>Detail</th><th>Amount</th><th>Confidence</th><th>Timing</th></tr></thead>
    <tbody>${rows.map(e => `<tr class="${rowCls(e)}"><td>W${e.week}${riskBadge(e.week)}</td><td>${e.isoDate}</td><td>${CAT_LABEL[e.category]}</td><td>${e.entity}</td><td class="muted">${e.subcategory || ''}</td>${moneyCell(e.amount)}<td>${confBadge(e.confidence)}</td><td>${e.controllable ? 'Discretionary' : 'Fixed'}</td></tr>`).join('')}</tbody></table>`;
}

function filterEvents(cat) {
  const normEvs = State.model.normEvents;
  const riskWeeks = new Set(State.model.risks.map(r => r.week));
  const evs = cat ? normEvs.filter(e => e.category === cat) : normEvs;
  const tbl = document.getElementById('eventTbl');
  const sub = document.getElementById('evtTbl-sub');
  const tog = document.getElementById('evtTbl-toggle');
  if (tbl) tbl.innerHTML = eventTable(evs, { riskWeeks });
  if (sub) sub.textContent = (cat ? (CAT_LABEL[cat] || cat) + ' — ' : 'All ') + evs.length + ' events · sorted by date';
  const lowConf = normEvs.filter(e => e.confidence === 'Low');
  if (tog && lowConf.length) { tog.textContent = 'Show ' + lowConf.length + ' flagged only'; tog.onclick = showLowConfEvents; }
}

/* ---------------- LAYER 3: FORECAST ---------------- */

function forecastDecisionBanner(f, risks, cfg) {
  const critRisk = risks.filter(function(r) { return r.severity === 'Critical'; })
    .sort(function(a, b) { return b.shortfall - a.shortfall; })[0];
  const worstRisk = critRisk || risks.filter(function(r) { return r.shortfall > 0; })
    .sort(function(a, b) { return b.shortfall - a.shortfall; })[0];

  // Cross-scenario breach summary (recompute for all three)
  const scRisks = {};
  ['Base', 'Downside', 'Upside'].forEach(function(sc) {
    scRisks[sc] = detectRisks(State.model.forecasts[sc], cfg);
  });
  const scBreaches = {};
  ['Base', 'Downside', 'Upside'].forEach(function(sc) {
    scBreaches[sc] = scRisks[sc].filter(function(r) { return r.shortfall > 0; }).length;
  });
  const scLabels = { Base: 'Base', Downside: 'Downside', Upside: 'Upside' };
  const scenarioRowHtml = ['Base', 'Downside', 'Upside'].map(function(sc) {
    const n = scBreaches[sc];
    const cls = n > 0 ? 'db-sc-breach' : 'db-sc-clear';
    const active = sc === State.scenario;
    const worstSc = scRisks[sc].filter(function(r) { return r.shortfall > 0; })
      .sort(function(a, b) { return b.shortfall - a.shortfall; })[0];
    const statLine = worstSc
      ? '−' + fmtM(worstSc.shortfall) + ' in W' + worstSc.week
      : 'No breaches';
    return `<div class="db-sc-tile ${cls} ${active ? 'db-sc-active' : ''}" onclick="setScenario('${sc}')" title="Switch to ${scLabels[sc]}">
      <div class="db-sc-name">${scLabels[sc]}</div>
      <div class="db-sc-close">${statLine}</div>
      <div class="db-sc-stat">${n > 0 ? 'W13 close ' + fmtM(State.model.forecasts[sc].closingBalance) : 'W13 close ' + fmtM(State.model.forecasts[sc].closingBalance)}</div>
    </div>`;
  }).join('');

  if (!worstRisk) {
    const headroom = f.closingBalance - cfg.covenant;
    return `<div class="forecast-banner fb-clear">
      <div class="fb-icon">✓</div>
      <div class="fb-body">
        <div class="fb-status-label">No liquidity breaches</div>
        <div class="fb-headline">All 13 weeks remain above the operating floor</div>
        <div class="fb-sub">The ${f.scenarioLabel} forecast closes W13 at <b>${fmtM(f.closingBalance)}</b> — <b>${fmtM(headroom)}</b> of headroom above the covenant minimum. No action is required before building the lender package.</div>
        <div class="fb-sc-row">${scenarioRowHtml}</div>
      </div>
      <button class="btn btn-primary fb-cta" onclick="go('layer4')">Continue to Risk Analysis →</button>
    </div>`;
  }

  const headroom = worstRisk.closing - cfg.covenant;
  const covenantLine = headroom < 0
    ? `The closing balance also breaches the ${fmtM(cfg.covenant)} covenant minimum by ${fmtM(Math.abs(headroom))}.`
    : `The closing balance remains ${fmtM(headroom)} above the covenant minimum.`;

  return `<div class="forecast-banner fb-crit">
    <div class="fb-top">
      <div class="fb-status-label fb-status-crit">⚑ ${worstRisk.severity}</div>
    </div>
    <div class="fb-main">
      <div class="fb-body">
        <div class="fb-headline">W${worstRisk.week} falls ${fmtM(worstRisk.shortfall)} below the ${fmtM(cfg.buffer)} operating floor</div>
        <div class="fb-sub">Driver: <b>${worstRisk.driver}.</b> ${covenantLine}</div>
        <div class="fb-decision">Before building the lender package, you need a position on how to cover this gap.</div>
        <div class="fb-action-line">Suggested approach: <span class="fb-action-text">${worstRisk.action}</span></div>
        <div class="fb-sc-row">${scenarioRowHtml}</div>
      </div>
      <div class="fb-ctas">
        <button class="btn btn-primary" onclick="showWeekDrill(${worstRisk.week})">View W${worstRisk.week} detail →</button>
        <button class="btn btn-ghost btn-sm" onclick="go('layer4')">Continue to Risk Analysis</button>
      </div>
    </div>
  </div>`;
}

function renderLayer3() {
  const el = document.getElementById('view-layer3');
  if (!State.model) { el.innerHTML = emptyLayer('Run a forecast to build the 13-week cash-position matrix.'); return; }
  const f = State.model.forecasts[State.scenario];
  el.innerHTML = pipelineProgress(3) + `
    <div class="page-head"><div class="eyebrow">Layer 3 · ${f.scenarioLabel} Scenario</div><h2>13-Week Forecast</h2>
      <p>The 13-week direct cash forecast across three scenarios. The key question: do we have a liquidity problem, and what needs to be decided before it hits?</p></div>
    ` + handoffBanner(3) +
    forecastDecisionBanner(f, State.model.risks, State.cfg) + `

    <div class="card card-pad" style="margin-bottom:18px">
      <div class="matrix-card-head">
        <div>
          <h3>13-Week Cash Position Matrix</h3>
          <div class="card-sub">Select any week column to drill into its breakdown &nbsp;·&nbsp; <span class="legend-swatch swatch-crit"></span> below floor &nbsp;·&nbsp; <span class="legend-swatch swatch-high"></span> covenant proximity</div>
        </div>
      </div>
      <div class="tbl-wrap">${matrixTable(f)}</div>
    </div>

    <div id="week-drill-panel" class="week-drill-panel hidden"></div>

    <h3 style="margin-bottom:10px">Scenario Detail</h3>
    <div class="grid g3" style="margin-bottom:18px">
      ${scenarioCard('Base')}${scenarioCard('Downside')}${scenarioCard('Upside')}
    </div>
    ` + continueFooter(3);
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
  return `<table><thead><tr><th class="sticky-col">Category</th>${f.weeks.map(w => `<th class="wk wk-clickable" id="wk-hdr-${w.week}" onclick="showWeekDrill(${w.week})">${w.label}<span class="wk-drill-hint">▾</span></th>`).join('')}</tr></thead><tbody>
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
  const cfg = State.cfg;
  const breachWeeks = f.weeks.filter(function(w) { return w.closing < cfg.buffer; });
  const statusHtml = breachWeeks.length
    ? `<div class="sc-status sc-breach">${breachWeeks.length} breach week${breachWeeks.length > 1 ? 's' : ''} · ${breachWeeks.map(function(w) { return 'W' + w.week; }).join(', ')}</div>`
    : `<div class="sc-status sc-clear">No covenant breaches</div>`;
  if (active) {
    return `<div class="card card-pad sc-card sc-active">
      <div class="sc-header"><h3>${f.scenarioLabel}</h3><span class="sc-viewing-badge">Viewing</span></div>
      <div class="card-sub">${SCENARIOS[sc].desc}</div>
      <div class="sc-close-bal">${fmtM(f.closingBalance)}</div>
      <div class="muted sc-net">W13 close · net ${fmtM(f.netChange)}</div>
      ${statusHtml}
    </div>`;
  }
  return `<div class="card card-pad sc-card sc-selectable" onclick="setScenario('${sc}')">
    <div class="sc-header"><h3>${f.scenarioLabel}</h3><span class="sc-switch-hint">Switch →</span></div>
    <div class="card-sub">${SCENARIOS[sc].desc}</div>
    <div class="sc-close-bal">${fmtM(f.closingBalance)}</div>
    <div class="muted sc-net">W13 close · net ${fmtM(f.netChange)}</div>
    ${statusHtml}
  </div>`;
}

/* ---------------- LAYER 4: VARIANCE & RISK ---------------- */

/* Map risk type → the layer where it can be addressed */
function riskFixTarget(type) {
  if (type === 'Cash Floor Breach')   return {
    label: 'Fix in Layer 1',
    view: 'layer1',
    tip: 'Add an AR Collections row or defer an outflow to cover the shortfall week',
    message: 'You were sent here to resolve a <b>Cash Floor Breach</b>. Load or edit your AR Collections data to bring the low-week closing balance above the $5M operating floor, then re-run the forecast.'
  };
  if (type === 'Covenant Proximity')  return {
    label: 'Fix in Layer 1',
    view: 'layer1',
    tip: 'Defer or reduce a Capex outflow to widen the covenant cushion',
    message: 'You were sent here to resolve a <b>Covenant Proximity</b> flag. Find the Capex input and push out or reduce the payment that is squeezing the $4M covenant threshold, then re-run the forecast.'
  };
  if (type === 'Concentration Risk')  return {
    label: 'Fix in Layer 1',
    view: 'layer1',
    tip: 'Split large AR receipts across multiple weeks to reduce single-week dependency',
    message: 'You were sent here to resolve a <b>Concentration Risk</b> flag. Edit your AR Collections data to spread large customer receipts across more weeks, reducing the risk of a single-week miss, then re-run the forecast.'
  };
  return {
    label: 'Fix in Layer 1',
    view: 'layer1',
    tip: 'Adjust the relevant input data to resolve this flag',
    message: 'You were sent here from Layer 4 to resolve a risk flag. Adjust the relevant input data, then re-run the forecast to clear the issue.'
  };
}

function riskResolutionBanner(risks, cfg) {
  const actionable = risks.filter(function(r) { return r.shortfall > 0 || r.severity !== 'Medium'; });
  if (!actionable.length) {
    return `<div class="l4-banner l4-clear">
      <div class="l4b-icon">✓</div>
      <div class="l4b-body">
        <div class="l4b-headline">No blocking issues — forecast is ready for the output layer</div>
        <div class="l4b-sub">All 13 weeks remain above the operating floor. Draft the lender commentary below, then proceed to Layer 5 to generate the package.</div>
      </div>
      <button class="btn btn-primary l4b-cta" onclick="go('layer5')">Go to Output Layer →</button>
    </div>`;
  }
  const color = actionable.some(function(r) { return r.severity === 'Critical'; }) ? 'l4-crit' : 'l4-high';
  const items = actionable.map(function(r) {
    const fix = riskFixTarget(r.type);
    const amtLine = r.shortfall > 0 ? fmtM(r.shortfall) + ' shortfall' : 'proximity flag';
    return `<div class="l4b-item">
      <span class="l4b-sev sev-${r.severity.toLowerCase()}">${r.severity}</span>
      <span class="l4b-item-text"><b>W${r.week} ${r.type}</b> · ${amtLine}</span>
      <button class="btn btn-ghost btn-xs l4b-fix-btn fix-tip" data-tip="${fix.tip}" data-rtype="${r.type}" onclick="goWithRiskContext(this)">${fix.label} →</button>
    </div>`;
  }).join('');
  return `<div class="l4-banner ${color}">
    <div class="l4b-top">
      <span class="l4b-status-label">${actionable.length} item${actionable.length > 1 ? 's' : ''} need${actionable.length === 1 ? 's' : ''} resolution before the lender package</span>
    </div>
    <div class="l4b-items">${items}</div>
    <div class="l4b-note">To resolve: follow the link to adjust inputs, then re-run the forecast. When all items clear, proceed to the output layer.</div>
  </div>`;
}

/* Compact accordion — one row per risk, expands to driver + action + AI output */
function riskAccordion(risks) {
  if (!risks.length) {
    return `<div class="empty"><div class="big">✓</div><h3>No risk flags detected</h3><p class="muted">All 13 weeks remain above the operating floor and covenant thresholds.</p></div>`;
  }
  return risks.map(function(r, idx) {
    const cls = r.severity === 'Critical' ? 'ra-crit' : r.severity === 'High' ? 'ra-high' : 'ra-med';
    const fix = riskFixTarget(r.type);
    const amtLine = r.shortfall > 0 ? '−' + fmtM(r.shortfall) : 'proximity';
    const existing = State.riskActions[idx];
    return `<div class="ra-row" id="ra-row-${idx}">
      <div class="ra-summary" onclick="toggleRiskRow(${idx})">
        <span class="ra-chevron" id="ra-chev-${idx}">▶</span>
        <span class="ra-sev ${cls}">${r.severity}</span>
        <span class="ra-title">W${r.week} · ${r.type}</span>
        <span class="ra-amt">${amtLine}</span>
        <span class="ra-spacer"></span>
        <button class="btn btn-ghost btn-xs ra-fix-btn fix-tip" data-tip="${fix.tip}" data-rtype="${r.type}" onclick="event.stopPropagation();goWithRiskContext(this)">${fix.label} →</button>
      </div>
      <div class="ra-detail" id="ra-detail-${idx}" style="display:none">
        <div class="ra-detail-inner">
          <div class="ra-field"><span class="ra-field-label">Driver</span>${r.driver}</div>
          <div class="ra-field"><span class="ra-field-label">Resolution</span>${r.action}</div>
          <div id="ra-out-${idx}">${existing ? '<div class="ai-response r-ai-response" style="margin-top:8px">' + existing.replace(/\n/g, '<br/>') + '</div>' : ''}</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleRiskRow(idx) {
  var detail = document.getElementById('ra-detail-' + idx);
  var chev = document.getElementById('ra-chev-' + idx);
  if (!detail) return;
  var open = detail.style.display !== 'none';
  detail.style.display = open ? 'none' : 'block';
  if (chev) chev.textContent = open ? '▶' : '▼';
}

function renderLayer4() {
  const el = document.getElementById('view-layer4');
  if (!State.model) { el.innerHTML = emptyLayer('Run a forecast to analyze variance and liquidity risk.'); return; }
  const m = State.model, v = m.variance;
  el.innerHTML = pipelineProgress(4) + `
    <div class="page-head"><div class="eyebrow">Layer 4 · Variance &amp; Risk Engine</div><h2>Action &amp; Commentary</h2>
      <p>Layer 3 identified the forecast position. This layer answers what needs to happen before the output can be finalized: what risks require resolution, and what commentary is needed for the lender package.</p></div>
    ` + handoffBanner(4) +
    riskResolutionBanner(m.risks, State.cfg) + `

    <div class="card card-pad" style="margin-bottom:18px">
      <div class="l4-risk-head">
        <div>
          <h3 style="margin:0">Risk Flags</h3>
          <div class="card-sub">${m.risks.length} flag${m.risks.length !== 1 ? 's' : ''} detected · click any row to see the driver and resolution path</div>
        </div>
        ${m.risks.length ? `<button class="btn btn-primary btn-sm" id="rank-risks-btn" onclick="runRankRisks()">✦ Get action plan</button>` : ''}
      </div>
      <div id="rank-risks-out" style="display:none;margin-top:10px"></div>
      <div class="ra-list" style="margin-top:12px">${riskAccordion(m.risks)}</div>
    </div>

    <div class="card card-pad" style="margin-bottom:18px">
      <div class="l4-ai-head">
        <div>
          <h3 style="margin:0">Lender Package Commentary</h3>
          <div class="card-sub">Generate the narrative language needed for the lender submission — risk narrative for the cover note and variance commentary for the change log</div>
        </div>
        ${claudeHasKey()
          ? `<span style="font-size:11px;color:var(--green);font-weight:600">Claude connected</span>`
          : `<a href="#" class="btn btn-ghost btn-sm" onclick="go('settings');return false">Connect Claude →</a>`}
      </div>
      <div class="grid g2" style="margin-top:14px">
        <div class="l4-ai-panel">
          <div class="l4-ai-panel-head">
            <div>
              <div class="l4-ai-panel-title">Risk Narrative</div>
              <div class="l4-ai-panel-sub">Executive summary of risk flags — suitable for the CFO briefing or lender cover note</div>
            </div>
            <button class="btn btn-primary btn-sm" id="ai-risk-btn" onclick="runAIRiskNarrative()">✦ ${State.aiRiskNarrative ? 'Regenerate' : 'Draft'}</button>
          </div>
          <div id="ai-risk-out" class="l4-ai-out">${State.aiRiskNarrative
            ? `<div class="ai-response">${State.aiRiskNarrative.replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>')}</div>`
            : `<div class="l4-ai-placeholder">Drafts a CFO-ready paragraph naming the risk, quantifying the shortfall, and stating the proposed resolution. Paste directly into the lender cover note.</div>`
          }</div>
        </div>
        <div class="l4-ai-panel">
          <div class="l4-ai-panel-head">
            <div>
              <div class="l4-ai-panel-title">Variance Commentary</div>
              <div class="l4-ai-panel-sub">Plain-language explanation of what changed week-over-week and why — for the lender change log</div>
            </div>
            <button class="btn btn-primary btn-sm" id="ai-commentary-btn" onclick="runAICommentary()">✦ ${State.aiCommentary ? 'Regenerate' : 'Draft'}</button>
          </div>
          <div id="ai-commentary-out" class="l4-ai-out">${State.aiCommentary
            ? `<div class="ai-response">${State.aiCommentary.replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>')}</div>`
            : `<div class="l4-ai-placeholder">Attributes movements to specific drivers — timing shifts, volume changes, rate effects. Written in the format lenders expect for the weekly variance log.</div>`
          }</div>
        </div>
      </div>
    </div>

    <div class="card card-pad" style="margin-bottom:18px">
      <h3>Version Comparison</h3>
      <div class="card-sub">${v.hasPrior ? 'Changes vs. the immediately prior run' : 'This is the baseline run — key metrics locked in for future comparison'}</div>
      ${v.hasPrior ? `
        <div class="grid g2" style="margin-top:12px">
          <div>
            <div class="l4-var-label">13-Week Bridge</div>
            ${varianceBridge(v)}
          </div>
          <div>
            <div class="l4-var-label">Flagged Changes</div>
            ${v.commentary.length
              ? v.commentary.map(function(c) { return `<div class="commentary"><span class="c-wk">W${c.week}</span> ${c.text}</div>`; }).join('')
              : '<div class="muted" style="padding:10px 0">No week-level variances exceeded the reporting threshold this cycle.</div>'}
            ${exampleCommentary()}
          </div>
        </div>
        <div style="margin-top:14px">${varianceTables(v)}</div>
      ` : baselineConfirmedCard(m)}
    </div>
    ` + l4ThresholdsPanelHTML(State.cfg) +
    continueFooter(4);
}

function baselineConfirmedCard(m) {
  const f = m.forecasts[State.scenario];
  const cfg = State.cfg;
  const breachWks = f.weeks.filter(function(w) { return w.closing < cfg.buffer; });
  const minWk = f.weeks.reduce(function(a, b) { return a.closing < b.closing ? a : b; });
  const metrics = [
    { label: 'Opening balance',   value: fmtM(f.openingBalance) },
    { label: 'W13 closing',       value: fmtM(f.closingBalance) },
    { label: 'Net 13-week change',value: (f.netChange >= 0 ? '+' : '') + fmtM(f.netChange) },
    { label: 'Tightest week',     value: 'W' + minWk.week + ' at ' + fmtM(minWk.closing) },
    { label: 'Breach weeks',      value: breachWks.length ? breachWks.map(function(w) { return 'W' + w.week; }).join(', ') : 'None' },
  ];
  return `<div class="baseline-card">
    <div class="bl-intro">These figures are now the baseline. The next time you run the forecast — after changing inputs, adjusting a scenario, or updating AR — this page will show exactly what moved and by how much.</div>
    <div class="bl-metrics">${metrics.map(function(m) {
      return `<div class="bl-metric"><div class="bl-metric-label">${m.label}</div><div class="bl-metric-val">${m.value}</div></div>`;
    }).join('')}</div>
  </div>`;
}
function riskCard(r, idx) {
  const cls = r.severity === 'Critical' ? 'crit' : (r.severity === 'High' ? 'high' : 'med');
  const existing = State.riskActions[idx];
  return `<div class="risk ${cls}">
    <div class="r-top">${sevBadge(r.severity)}<span class="r-title">W${r.week} · ${r.type}</span></div>
    <div class="r-driver"><span class="r-driver-label">Driver</span>${r.driver}</div>
    <div class="r-action-block">
      <div class="r-action-label">Suggested resolution</div>
      <div class="r-action-text">${r.action}</div>
    </div>
    <div class="r-ai-row">
      <button class="btn btn-primary btn-sm r-ai-btn" id="ra-btn-${idx}" onclick="runRiskAction(${idx})">✦ Get detailed action plan</button>
    </div>
    <div id="ra-out-${idx}">${existing ? '<div class="ai-response r-ai-response">' + existing.replace(/\n/g, '<br/>') + '</div>' : ''}</div>
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
  const f = m.forecasts[m.scenario];
  const cfg = State.cfg;
  const crit = m.risks.filter(r => r.severity === 'Critical').length;
  const high = m.risks.filter(r => r.severity === 'High').length;
  const blocking = crit + high;
  const light = crit ? 'red' : high ? 'amber' : 'green';

  // Readiness banner
  const effectivelyClear = blocking === 0 || State.l5Override;
  let readinessBanner;
  if (effectivelyClear && State.l5Override && blocking > 0) {
    readinessBanner = `<div class="l5-ready-banner l5-override">
      <div class="l5rb-icon">📋</div>
      <div class="l5rb-body">
        <div class="l5rb-headline">Presentation mode — flags acknowledged, packages available</div>
        <div class="l5rb-sub">${blocking} flag${blocking > 1 ? 's' : ''} marked as reviewed for this presentation. In a live engagement, these would be resolved before the lender package is submitted.</div>
      </div>
      <button class="btn btn-ghost btn-sm l5rb-btn" onclick="State.l5Override=false;renderLayer5()">Restore gate</button>
    </div>`;
  } else if (effectivelyClear) {
    readinessBanner = `<div class="l5-ready-banner l5-clear">
      <div class="l5rb-icon">✓</div>
      <div class="l5rb-body">
        <div class="l5rb-headline">Forecast is ready to package and send</div>
        <div class="l5rb-sub">No blocking risk flags. All three scenarios have been reviewed. Proceed to generate deliverables for each audience below.</div>
      </div>
    </div>`;
  } else {
    const flagWord = blocking === 1 ? '1 unresolved flag' : blocking + ' unresolved flags';
    readinessBanner = `<div class="l5-ready-banner l5-block">
      <div class="l5rb-icon">⚠</div>
      <div class="l5rb-body">
        <div class="l5rb-headline">${flagWord} — lender package should not be sent yet</div>
        <div class="l5rb-sub">${crit > 0 ? crit + ' Critical' : ''}${crit > 0 && high > 0 ? ', ' : ''}${high > 0 ? high + ' High' : ''} severity issue${blocking > 1 ? 's' : ''} remain unresolved. The forecast can still be drafted, but do not submit the lender package until these are cleared.</div>
      </div>
      <div class="l5rb-actions">
        <button class="btn btn-ghost btn-sm" onclick="go('layer4')">Review flags in Layer 4 →</button>
        <button class="btn btn-ghost btn-sm" onclick="go('layer1')" title="Load the resolved scenario in Layer 1 to clear this flag through the tool">Fix via Layer 1 →</button>
        <button class="btn btn-ghost btn-sm l5rb-present-btn" onclick="State.l5Override=true;renderLayer5()">Present anyway</button>
      </div>
    </div>`;
  }

  // Covenant compliance inline table for lender section
  const checkpoints = [4, 13];
  const covRows = checkpoints.map(wk => {
    const w = f.weeks[wk - 1];
    const headroom = w.closing - cfg.covenant;
    const pass = headroom >= 0;
    return `<tr>
      <td>W${wk} — ${w.label}</td>
      <td>${fmtMoney(cfg.covenant)}</td>
      <td class="${pass ? '' : 'num-neg'}">${fmtMoney(w.closing)}</td>
      <td class="${pass ? '' : 'num-neg'}">${pass ? '+' : ''}${fmtMoney(headroom)}</td>
      <td><span class="cov-badge ${pass ? 'cov-pass' : 'cov-fail'}">${pass ? 'PASS' : 'BREACH'}</span></td>
    </tr>`;
  }).join('');
  const minWk = f.weeks.reduce((a, w) => w.closing < a.closing ? w : a, f.weeks[0]);
  const revolverNeed = Math.max(0, cfg.buffer - minWk.closing);

  el.innerHTML = pipelineProgress(5) + `
    <div class="page-head"><div class="eyebrow">Layer 5 · Output Layer</div><h2>Package &amp; Deliver</h2></div>
    ` + handoffBanner(5) +
    readinessBanner + `

    <!-- ── Executive Summary (hero) ── -->
    <div class="card card-pad l5-exec-card" style="margin-bottom:20px">
      <div class="l5-exec-head">
        <div>
          <div class="eyebrow" style="margin-bottom:4px">What the CFO and board will see</div>
          <h3 style="margin:0">Executive Summary</h3>
        </div>
        <div class="l5-exec-actions">
          <button class="btn btn-ghost btn-sm" onclick="openExecPDF()">🖨 Print-ready PDF</button>
        </div>
      </div>
      <div class="l5-exec-body">
        <div class="l5-exec-preview">
          ${execSummaryHTML(m, false)}
        </div>
      </div>
    </div>

    <!-- ── Audience delivery sections ── -->
    <div class="l5-sections">

      <!-- Lender / Agent -->
      <div class="card card-pad l5-section">
        <div class="l5-sec-head">
          <div class="l5-sec-icon">🏦</div>
          <div>
            <div class="l5-sec-title">Lender / Agent Package</div>
            <div class="l5-sec-sub">Covenant compliance certificate · 13-week grid · revolver headroom</div>
          </div>
          <span class="l5-audience-chip">Banks &amp; Agents</span>
        </div>

        <div class="l5-cov-wrap">
          <div class="l5-cov-label">Covenant compliance at key checkpoints</div>
          <table class="l5-cov-table">
            <thead><tr><th>Checkpoint</th><th>Required</th><th>Projected</th><th>Headroom</th><th>Status</th></tr></thead>
            <tbody>${covRows}</tbody>
          </table>
          ${revolverNeed > 0 ? `<div class="l5-revolver-note">Tightest week is <b>${minWk.label}</b> at ${fmtMoney(minWk.closing)} — indicated revolver draw need: <b>${fmtMoney(revolverNeed)}</b></div>` : `<div class="l5-revolver-note l5-revolver-ok">No revolver draw indicated — tightest week (${minWk.label}) remains ${fmtMoney(minWk.closing - cfg.buffer)} above the operating floor</div>`}
        </div>

        <div class="l5-cover-note-section">
          <div class="l5-cover-note-head">
            <div>
              <div class="l5-cover-note-title">✦ Cover Note</div>
              <div class="l5-cover-note-sub">Claude drafts the formal 2-paragraph cover note to accompany this submission</div>
            </div>
            <button class="btn btn-primary btn-sm" id="cover-note-btn" onclick="runCoverNote()">${State.coverNote ? '✦ Regenerate' : '✦ Draft Cover Note'}</button>
          </div>
          <div id="cover-note-out">${State.coverNote ? '<div class="ai-response cover-note-response" style="margin-top:10px">' + State.coverNote.replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>') + '</div>' : ''}</div>
        </div>

        <div class="l5-sec-footer">
          <button class="btn btn-primary" onclick="openLenderPackage()">Generate Lender Package →</button>
          <span class="l5-sec-note">Includes covenant table, 13-week grid, revolver analysis, and cover note</span>
        </div>
      </div>

      <!-- CFO / Board -->
      <div class="card card-pad l5-section">
        <div class="l5-sec-head">
          <div class="l5-sec-icon">📄</div>
          <div>
            <div class="l5-sec-title">CFO / Board Summary</div>
            <div class="l5-sec-sub">One-page PDF · traffic light · scenario comparison · risk flags</div>
          </div>
          <span class="l5-audience-chip">CFO &amp; Board</span>
        </div>
        <div class="l5-sec-body">
          <div class="l5-sec-detail-row">
            <span class="traffic ${light}"><span class="dot"></span>${light.toUpperCase()}</span>
            <span class="l5-sec-detail-text">${blocking === 0 ? 'No blocking issues — forecast is clean' : blocking + ' flag' + (blocking > 1 ? 's' : '') + ' require resolution'} · ${m.risks.length} total risk item${m.risks.length !== 1 ? 's' : ''} included</span>
          </div>
          <div class="l5-sec-detail-row">
            <span class="l5-detail-label">Covers</span>
            <span class="l5-sec-detail-text">Opening balance · W13 close · net 13-week move · top variance drivers · liquidity headroom chart</span>
          </div>
        </div>
        <div class="l5-sec-footer">
          <button class="btn btn-primary" onclick="openExecPDF()">🖨 Generate Executive PDF →</button>
          <span class="l5-sec-note">Full-page view with headroom chart is in the Executive Summary above</span>
        </div>
      </div>

      <!-- Working Files -->
      <div class="card card-pad l5-section">
        <div class="l5-sec-head">
          <div class="l5-sec-icon">📊</div>
          <div>
            <div class="l5-sec-title">Working Files</div>
            <div class="l5-sec-sub">Detailed data files for FP&amp;A teams and connected systems</div>
          </div>
          <span class="l5-audience-chip">FP&amp;A &amp; Systems</span>
        </div>
        <div class="l5-working-grid">
          <div class="l5-wf-item">
            <div class="l5-wf-name">Excel Workbook</div>
            <div class="l5-wf-desc">13-week grid with scenario tabs, variance bridge, category detail, and risk log — all 8 tabs pre-populated from this run</div>
            <button class="btn btn-ghost btn-sm" onclick="exportExcel(State.model)">⬇ Download Excel</button>
          </div>
          <div class="l5-wf-item">
            <div class="l5-wf-name">JSON / API Feed</div>
            <div class="l5-wf-desc">Full event-level data with all three scenarios, risk metadata, and confidence weights — for TMS or ERP system ingestion</div>
            <button class="btn btn-ghost btn-sm" onclick="exportJSON(State.model)">⬇ Download JSON</button>
          </div>
        </div>
      </div>

    </div>
  ` + continueFooter(5);
}

/* ---------------- SETTINGS ---------------- */
function renderSettings() {
  const el = document.getElementById('view-settings');
  const c = State.cfg;
  const versions = loadVersions();
  const BRAND_PRESETS = [
    { label: 'Deloitte Green', val: '#86BC25' },
    { label: 'Navy Blue',      val: '#002F6C' },
    { label: 'Teal',           val: '#007B84' },
    { label: 'Slate',          val: '#4A4F54' },
    { label: 'Plum',           val: '#6B2D8B' },
  ];
  const activeColor = c.accentColor || '#86BC25';
  el.innerHTML = `
    <div class="page-head"><div class="eyebrow">Controls</div><h2>Settings &amp; Versioning</h2></div>
    ${claudeSettingsCard()}
    <div class="grid g2" style="margin-bottom:18px">
      <div class="card card-pad">
        <h3>Client Branding</h3>
        <div class="card-sub">Customize for client demos — name and accent color appear in the header and document exports</div>
        <div class="field" style="margin-top:12px">
          <label>Client name</label>
          <input type="text" id="cfg-client-name" value="${c.clientName || ''}" placeholder="e.g. Acme Corporation">
          <div class="hint">Shown in the topbar alongside the forecast title.</div>
        </div>
        <div class="field">
          <label>Accent color</label>
          <div class="brand-color-row">
            ${BRAND_PRESETS.map(p => `<button class="brand-chip${activeColor === p.val ? ' brand-chip-active' : ''}" data-color="${p.val}" style="background:${p.val}" onclick="setBrandColor('${p.val}')" title="${p.label}"></button>`).join('')}
            <input type="color" id="cfg-color" value="${activeColor}" oninput="setBrandColor(this.value)" title="Custom color">
          </div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="saveBranding()">Apply branding</button>
        ${c.clientName || c.accentColor ? `<button class="btn btn-ghost btn-sm" style="margin-left:8px" onclick="State.cfg.clientName='';State.cfg.accentColor='';applyBranding();renderSettings();toast('Branding reset')">Reset to default</button>` : ''}
      </div>
      <div class="card card-pad">
        <h3>Forecast Assumptions</h3>
        <div class="card-sub">Also editable inline on <a href="#" onclick="go('layer1');return false">Layer 1</a> — changes here re-run the forecast</div>
        <div class="field" style="margin-top:8px"><label>Forecast start (W1 Monday)</label><input type="date" id="cfg-start" value="${isoDate(c.startDate)}"></div>
        <div class="field"><label>Opening bank balance</label><input type="number" id="cfg-open" value="${c.openingBalance}"></div>
        <div class="field"><label>Operating floor</label><input type="number" id="cfg-buffer" value="${c.buffer}"></div>
        <div class="field"><label>Covenant minimum</label><input type="number" id="cfg-cov" value="${c.covenant}"></div>
        <button class="btn btn-primary btn-sm" onclick="saveSettings()">Save &amp; re-run</button>
      </div>
    </div>
    <div class="grid g2">
      <div class="card card-pad">
        <h3>Variance Flag Thresholds</h3>
        <div class="card-sub">Also editable inline on <a href="#" onclick="go('layer4');return false">Layer 4</a></div>
        <div class="field" style="margin-top:8px"><label>Category-level: % / $ abs</label><div class="flex"><input type="number" step="0.01" id="th-cat-pct" value="${c.thresholds.category.pct}"><input type="number" id="th-cat-abs" value="${c.thresholds.category.abs}"></div></div>
        <div class="field"><label>Weekly net: % / $ abs</label><div class="flex"><input type="number" step="0.01" id="th-wk-pct" value="${c.thresholds.weekly.pct}"><input type="number" id="th-wk-abs" value="${c.thresholds.weekly.abs}"></div></div>
        <div class="field"><label>Ending balance: % / $ abs</label><div class="flex"><input type="number" step="0.01" id="th-end-pct" value="${c.thresholds.ending.pct}"><input type="number" id="th-end-abs" value="${c.thresholds.ending.abs}"></div></div>
        <button class="btn btn-primary btn-sm" onclick="saveSettings()">Save &amp; re-run</button>
      </div>
      <div class="card card-pad">
        <h3>Version History</h3>
        <div class="card-sub">${versions.length} stored version${versions.length !== 1 ? 's' : ''} · weekly refresh ready</div>
        <div class="tbl-wrap" style="max-height:240px;overflow:auto;margin-top:8px">${versionTable(versions)}</div>
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
 * HOME PAGE (view-home)
 * ===================================================================== */
function renderHome() {
  const el = document.getElementById('view-home');
  if (!el) return;

  function term(label, def) {
    return '<span class="term" data-def="' + def + '">' + label + '</span>';
  }

  const steps = [
    { n: '1', label: 'Ingest',     desc: 'Pull in raw data: receivables, payables, payroll, debt, capex.' },
    { n: '2', label: 'Normalize',  desc: 'Clean and standardize every input — nothing is a black box.' },
    { n: '3', label: 'Forecast',   desc: 'Project cash 13 weeks out: base case, downside, and upside.' },
    { n: '4', label: 'Flag',       desc: 'Surface dangerous weeks automatically, color-coded by severity.' },
    { n: '5', label: 'Deliver',    desc: 'Export formats the lender actually needs — covenant view, PDF, Excel.' },
  ];

  const terms = [
    ['Liquidity runway',   `How many weeks of cash a company has left before it can't pay what it owes.`],
    ['13-week forecast',   `The short-horizon cash projection that restructuring advisors and lenders rely on.`],
    ['Covenant',           `A condition in a loan agreement (e.g. "keep cash above $X"). Breaking it can let a lender call the loan.`],
    ['Lender package',     `The bundle of forecasts and compliance evidence given to a lender to maintain their confidence.`],
    ['Variance',           `The gap between what was forecast and what actually happened — the early-warning signal.`],
    ['Chapter 11',         `A legal restructuring process that lets a company keep operating while it reorganizes its debts.`],
  ];

  el.innerHTML = `
    <div class="home-hero">
      <div class="home-hook">A profitable company can still run out of cash — and die in 13 weeks.</div>
      <p class="home-sub">Profit is an accounting story. Cash is a survival story. A business can be making money on paper and still fail to make payroll, because the money is tied up in unpaid invoices and inventory while the bills come due now. This tool exists for the 13 weeks when that gap becomes a matter of survival.</p>
    </div>

    <div class="grid g3" style="margin-bottom:24px">
      <div class="card card-pad prob-card">
        <div class="prob-icon">🚨</div>
        <h4>Who needs this</h4>
        <p>A company burning through cash — often heading toward, or already inside, restructuring or ${term('Chapter 11', 'A legal restructuring process that lets a company keep operating while it reorganizes its debts.')}. Leadership knows they're in trouble. What they don't have is a clear, week-by-week picture of when the cash actually runs out.</p>
      </div>
      <div class="card card-pad prob-card">
        <div class="prob-icon">📊</div>
        <h4>What they're forced to do today</h4>
        <p>Build the forecast by hand in fragile spreadsheets. React instead of anticipate. Scramble to reassure ${term('lenders', 'Banks or institutions that have loaned money to the company and need confidence it will be repaid.')} with numbers no one fully trusts. By the time a shortfall is obvious, the options to fix it are mostly gone.</p>
      </div>
      <div class="card card-pad prob-card">
        <div class="prob-icon">⚠️</div>
        <h4>What's at stake if they get it wrong</h4>
        <p>A missed payroll. A breached ${term('covenant', 'A condition in a loan agreement — e.g. "keep cash above $X". Breaking it can let a lender call the loan.')}. Lost lender confidence. In the worst case, liquidation — the company stops being worth more alive than sold for parts.</p>
      </div>
    </div>

    <div class="card card-pad" style="margin-bottom:24px">
      <div class="eyebrow-label">Why 13 weeks</div>
      <p style="font-size:14px;color:var(--gray-600);max-width:780px;line-height:1.7">The 13-week window isn't arbitrary. It's the standard horizon restructuring advisors and lenders use, because it's long enough to see the danger coming and short enough to forecast with confidence. It's the ${term('liquidity runway', "How many weeks of cash a company has left before it can't pay what it owes.")} you're fighting over.</p>
    </div>

    <div class="card card-pad" style="margin-bottom:24px">
      <div class="eyebrow-label">What you're looking at</div>
      <p style="color:var(--gray-600);margin-bottom:20px;max-width:780px">This tool takes a company's raw financial data and turns it into a survival plan in five steps — click any step to explore that layer:</p>
      <div class="pipeline-flow">
        ${steps.map(function(s, i) {
          return '<div class="pipe-step pipe-step-link" onclick="go(\'layer' + s.n + '\')" title="Explore Layer ' + s.n + '">' +
            '<div class="pipe-num">' + s.n + '</div>' +
            '<div class="pipe-label">' + s.label + '</div>' +
            '<div class="pipe-desc">' + s.desc + '</div>' +
            '<div class="pipe-explore">Explore →</div>' +
            '</div>' +
            (i < steps.length - 1 ? '<div class="pipe-arrow">→</div>' : '');
        }).join('')}
      </div>
    </div>

    <div class="card card-pad" style="margin-bottom:24px">
      <div class="eyebrow-label">Key terms</div>
      <div class="grid g3" style="margin-top:10px">
        ${terms.map(function(t) {
          return '<div class="kterm-card"><b>' + t[0] + '</b><p>' + t[1] + '</p></div>';
        }).join('')}
      </div>
    </div>

    <div class="card card-pad" style="margin-bottom:24px">
      <div class="eyebrow-label">Who uses this</div>
      <p style="font-size:14px;color:var(--gray-600);max-width:780px;margin-bottom:18px">Real people do this work today — and the pain is real. Each role experiences the problem differently and gets different relief from the tool. The human never leaves the loop; the grunt work does.</p>
      <div class="grid g3">
        ${PERSONA_DATA.map(function(p, i) {
          return '<div class="pp-card" onclick="showPersona(' + i + ');go(\'personas\')">' +
            '<div class="pp-icon">' + p.homeIcon + '</div>' +
            '<div class="pp-name">' + p.title + '</div>' +
            '<div class="pp-hook">' + p.homeHook + '</div>' +
            '<div class="pp-cta">See current vs. future state →</div>' +
          '</div>';
        }).join('')}
      </div>
    </div>

    <div class="home-teaser">
      <div class="teaser-eyebrow">Watch it work →</div>
      <h3>The tool catches a <span class="text-crit">$1.3M cash floor breach at Week 7</span> — and pinpoints the driver before it's too late to act.</h3>
      <p>A $6M balloon payment lands in a light AR collection week. The closing balance drops to $3.7M — $1.3M below the $5M operating floor. That's the kind of collision a spreadsheet usually catches only after the cash is gone. Here, it's flagged automatically, weeks ahead, with the driver named and a recommended action attached.</p>
      <button class="btn btn-primary" style="margin-top:18px" onclick="loadAllSamples();runForecast();go('dashboard')">► Start the Demo</button>
    </div>`;
}

/* =====================================================================
 * PERSONAS TAB (view-personas)
 * ===================================================================== */
function renderPersonas() {
  const el = document.getElementById('view-personas');
  if (!el) return;
  el.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">Who This Is For</div>
      <h2>Current State vs. Future State</h2>
      <p class="framing-line">This isn't about replacing the people who manage a company's cash. It's about giving them the early warning, the clean numbers, and the lender-ready outputs they're currently building by hand — so their time goes to the decisions only a human can make.</p>
    </div>
    <div class="persona-tabs">
      <button class="ptab active" onclick="showPersona(0)">Treasurer / Cash Manager</button>
      <button class="ptab" onclick="showPersona(1)">CFO</button>
      <button class="ptab" onclick="showPersona(2)">Lender / Restructuring Advisor</button>
    </div>
    <div id="persona-pane"></div>
    <div style="margin-top:28px;padding-top:20px;border-top:1px solid var(--gray-200);color:var(--gray-600);font-size:14px;max-width:760px">
      Across every role, the pattern is the same: the AI absorbs the manual assembly and the early-warning detection, and the human keeps the judgment, the strategy, and the accountability.
      <button class="btn btn-primary" style="margin-left:16px" onclick="loadAllSamples();runForecast();go('dashboard')">► See the Demo</button>
    </div>`;
  showPersona(0);
}

function showPersona(idx) {
  document.querySelectorAll('.ptab').forEach(function(b, i) { b.classList.toggle('active', i === idx); });
  const p = PERSONA_DATA[idx];
  const pane = document.getElementById('persona-pane');
  if (!pane || !p) return;
  function painsList(items) {
    return '<ul class="pain-list">' + items.map(function(t, i) {
      return '<li class="pain-item" data-pb="' + i + '"><span class="pi-icon">↘</span>' + t + '</li>';
    }).join('') + '</ul>';
  }
  function benefitsList(items) {
    return '<ul class="benefit-list">' + items.map(function(t, i) {
      return '<li class="benefit-item" data-pb="' + i + '"><span class="bi-icon">↗</span>' + t + '</li>';
    }).join('') + '</ul>';
  }

  pane.innerHTML =
    '<div class="persona-name">' + p.title + '</div>' +
    '<div class="persona-tagline">' + p.tagline + '</div>' +
    '<div class="pflow-section">' +
      '<div class="pflow-header current">Current State — Today</div>' +
      buildFlowDiagram(p.currentFlow, 'current') +
      '<div class="pflow-detail current-detail">' +
        '<div class="pd-label pd-label-pain">Pain Points</div>' +
        painsList(p.currentPains) +
      '</div>' +
    '</div>' +
    '<div class="pflow-transform"><div class="pflow-transform-line"></div><div class="pflow-transform-label">transforms to</div><div class="pflow-transform-line"></div></div>' +
    '<div class="pflow-section">' +
      '<div class="pflow-header future">Future State — With This Tool</div>' +
      buildFlowDiagram(p.futureFlow, 'future') +
      '<div class="pflow-detail future-detail">' +
        '<div class="pd-label pd-label-benefit">What Changes</div>' +
        benefitsList(p.futureBenefits) +
      '</div>' +
    '</div>' +
    '<div class="loop-callout" style="margin-top:20px">' +
      '<b>🔵 Where the human stays in the loop</b><br/>' +
      p.loop +
    '</div>';

  // Pain → benefit hover linking
  setTimeout(function() {
    pane.querySelectorAll('.pain-item').forEach(function(el) {
      var idx = el.getAttribute('data-pb');
      el.addEventListener('mouseenter', function() {
        var b = pane.querySelector('.benefit-item[data-pb="' + idx + '"]');
        if (b) b.classList.add('pb-linked');
      });
      el.addEventListener('mouseleave', function() {
        var b = pane.querySelector('.benefit-item[data-pb="' + idx + '"]');
        if (b) b.classList.remove('pb-linked');
      });
    });
  }, 0);
}

function buildFlowDiagram(steps, type) {
  var WHO_LABEL = { person: '👤 You', ai: '✦ AI', system: '⚙ System' };
  var nodes = steps.map(function(s) {
    var who = s.who || 'person';
    return '<div class="pflow-node">' +
      '<div class="pflow-box ' + type + ' who-' + who + '">' +
        '<span class="pflow-who who-tag-' + who + '">' + (WHO_LABEL[who] || '👤 You') + '</span>' +
        '<span class="pflow-icon">' + s.icon + '</span>' +
        '<span class="pflow-name">' + s.step + '</span>' +
      '</div>' +
      '<div class="pflow-note ' + (type === 'current' ? 'pain' : 'benefit') + '">' + s.note + '</div>' +
    '</div>';
  });
  var html = '';
  nodes.forEach(function(n, i) {
    html += n;
    if (i < nodes.length - 1) html += '<div class="pflow-conn ' + type + '">›</div>';
  });
  return '<div class="pflow-row">' + html + '</div>';
}

/* =====================================================================
 * PRESENTER NOTES (fixed bottom panel)
 * ===================================================================== */
const PRESENTER_STEPS = [
  {
    num: 'Step 0 — Frame the crisis',
    say: `"A W7 cash floor breach. $1.3M below the operating minimum. Caught before it hits — here's how."`,
    land: `Don't open with the tool. Open with the problem. The tool is the resolution.`,
  },
  {
    num: 'Step 1 — Load the data (Layer 1)',
    click: 'Layer 1 → "Load crisis scenario"',
    say: `"Five data sources — AR aging, payables, payroll, debt schedule, capex. Normally a treasurer pulls this from six systems by hand. One click. The $6M Term Loan A balloon is already in the debt schedule."`,
    land: `One click = a treasurer's Monday morning. Mention the assumptions panel — opening balance $8M, floor $5M, covenant $4M — these are set here, not buried in a config file.`,
  },
  {
    num: 'Step 2 — Run the forecast',
    click: 'Click "► Run Forecast" in the top bar',
    say: `"All five layers execute: normalize the data, project 13 weeks across three scenarios, scan every week for breaches. Done."`,
    land: `The pipeline progress bar shows all five layers completing. This is the "one minute" moment.`,
  },
  {
    num: 'Step 3 — Dashboard: answer first',
    click: 'Click Dashboard in the sidebar',
    say: `"The dashboard leads with the verdict before a single chart: RED — W7 Cash Floor Breach. $3.7M close, $1.3M below floor. The recommended actions are right there — call Acme Corporation, accelerate the receivable."`,
    land: `Point at the status banner and the action list. Then click W7 on the cash chart to show the week drill panel. Then walk the bridge waterfall — the Debt Service bar is visibly the biggest drag.`,
  },
  {
    num: 'Step 4 — Layer 4: named driver, clear path',
    click: 'Click Layer 4 · Variance & Risk',
    say: `"Layer 4 names the driver: $6M Term Loan A balloon in a light AR week. It tells the treasurer exactly what to do and gives them a button that passes the context — when you land on Layer 1 it tells you why you're there."`,
    land: `Click "Fix in Layer 1 →" on the Critical flag. Show the amber context banner that appears on Layer 1. This is the human-in-the-loop moment — the tool guides, the human decides.`,
  },
  {
    num: 'Step 5 — Resolve the breach  ★ money moment',
    click: 'Layer 1 → "✓ Load resolved scenario" (forecast re-runs automatically)',
    say: `"The treasurer calls Acme Corporation and Summit Healthcare — pull forward $2.4M in receivables into Weeks 6 and 7. One click loads the updated AR data and re-runs the full forecast."`,
    land: `SLOW DOWN. Navigate to Layer 5. The red banner is now GREEN. The breach is gone. This is the payoff — 60 seconds from breach to resolved.`,
  },
  {
    num: 'Step 6 — Output: lender-ready',
    click: 'Click Layer 5 · Output Layer',
    say: `"Covenant compliance — W4 and W13, both PASS. Executive summary. Lender package. Cover note drafted by Claude. Everything the bank needs, from the same data model, no reformatting."`,
    land: `Generate the cover note if time allows — Claude drafts it live. End on the lender package button. "From breach to lender-ready — without rebuilding a spreadsheet."`,
  },
  {
    num: 'Step 7 — Land the plane',
    say: `"Five data sources in, a 13-week survival plan out. It found the W7 breach — $1.3M below the floor — before it would have hit. The human still owns every decision. The tool makes sure they see the problem in time to make one."`,
    land: `Quantify: 5 sources → 13-week forecast → 3 scenarios → 1 critical breach → resolved and lender-packaged. Reassert human-in-the-loop. That's what builds lender trust.`,
  },
  {
    num: '⚠ Reminders',
    say: `The resolved scenario auto-runs the forecast — wait for the run to complete before navigating to Layer 5. W7 numbers ($3.7M / $1.3M shortfall) should match what you say. Don't read verbatim — the 🎯 landings are the non-negotiables.`,
    land: `Non-driver: watch the audience during the Layer 5 green reveal — that's the emotional peak. Be ready to explain why the lender package is "defensible" if asked: every number traces back to a source record.`,
  },
];

function togglePresenterNotes() {
  const panel = document.getElementById('presenter-notes');
  if (!panel) return;
  const isHidden = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !isHidden);
  if (isHidden) {
    const body = document.getElementById('pn-body');
    if (body && !body.children.length) {
      body.innerHTML = PRESENTER_STEPS.map(function(s) {
        return '<div class="pn-step">' +
          '<div class="pn-step-num">' + s.num + '</div>' +
          (s.click ? '<div class="pn-step-click">🖱 ' + s.click + '</div>' : '') +
          '<div class="pn-step-say">' + s.say + '</div>' +
          '<div class="pn-step-land">🎯 ' + s.land + '</div>' +
          '</div>';
      }).join('');
    }
  }
}

/* =====================================================================
 * CLAUDE AI — Settings, Layer 4 analysis, Dashboard chat
 * ===================================================================== */

function saveApiKey() {
  const input = document.getElementById('claude-key-input');
  const v = input ? input.value.trim() : '';
  if (!v) { toast('Enter an API key first.'); return; }
  claudeSetKey(v);
  input.value = '';
  toast('API key saved · Claude AI enabled');
  renderSettings();
}

function clearApiKey() {
  claudeClearKey();
  toast('API key cleared');
  renderSettings();
}

async function runAICommentary() {
  if (!claudeHasKey()) { toast('Add your Anthropic API key in Settings → Claude AI.'); go('settings'); return; }
  if (!State.model) return;
  const btn = document.getElementById('ai-commentary-btn');
  const out = document.getElementById('ai-commentary-out');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }
  if (out) out.innerHTML = '<div class="muted ai-loading">Claude is analyzing the forecast data…</div>';
  try {
    const text = await claudeVarianceCommentary(State.model);
    State.aiCommentary = text;
    if (out) out.innerHTML = '<div class="ai-response">' + text.replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>') + '</div>';
  } catch (e) {
    if (out) out.innerHTML = '<div class="muted" style="color:var(--crit)">Error: ' + e.message + '</div>';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✦ Regenerate'; }
  }
}

async function runAIRiskNarrative() {
  if (!claudeHasKey()) { toast('Add your Anthropic API key in Settings → Claude AI.'); go('settings'); return; }
  if (!State.model) return;
  const btn = document.getElementById('ai-risk-btn');
  const out = document.getElementById('ai-risk-out');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }
  if (out) out.innerHTML = '<div class="muted ai-loading">Claude is drafting the risk narrative…</div>';
  try {
    const text = await claudeRiskNarrative(State.model);
    State.aiRiskNarrative = text;
    if (out) out.innerHTML = '<div class="ai-response">' + text.replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>') + '</div>';
  } catch (e) {
    if (out) out.innerHTML = '<div class="muted" style="color:var(--crit)">Error: ' + e.message + '</div>';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✦ Regenerate'; }
  }
}

function renderChatMessages() {
  const el = document.getElementById('claude-chat-messages');
  if (!el) return;
  if (!State.claudeChat.length) {
    el.innerHTML = '<div class="muted" style="text-align:center;padding:16px 0">Ask Claude anything about the forecast — it has full access to all 13 weeks of data, risk flags, and scenario analysis.</div>';
    return;
  }
  el.innerHTML = State.claudeChat.map(function(msg) {
    const isLoading = msg.content === '__loading__';
    const bubble = isLoading
      ? '<span class="chat-loading"><span class="d1">●</span><span class="d2">●</span><span class="d3">●</span></span>'
      : msg.content.replace(/\n/g, '<br/>');
    return '<div class="chat-msg ' + msg.role + '"><div class="chat-bubble">' + bubble + '</div></div>';
  }).join('');
  el.scrollTop = el.scrollHeight;
}

async function sendClaudeMessage() {
  const input = document.getElementById('claude-input');
  if (!input || input.disabled) return;
  const q = input.value.trim();
  if (!q || !State.model) return;
  if (!claudeHasKey()) {
    toast('Add your Anthropic API key in Settings → Claude AI to use chat.');
    go('settings');
    return;
  }

  input.value = '';
  input.disabled = true;

  const history = State.claudeChat.slice();
  State.claudeChat.push({ role: 'user', content: q });
  State.claudeChat.push({ role: 'assistant', content: '__loading__' });
  renderChatMessages();

  try {
    const reply = await claudeAskQuestion(q, State.model, history);
    State.claudeChat[State.claudeChat.length - 1] = { role: 'assistant', content: reply };
  } catch (e) {
    State.claudeChat[State.claudeChat.length - 1] = { role: 'assistant', content: 'Sorry, I hit an error: ' + e.message };
  } finally {
    const inp = document.getElementById('claude-input');
    if (inp) inp.disabled = false;
    renderChatMessages();
  }
}

function sendSuggestedQuestion(q) {
  const input = document.getElementById('claude-input');
  if (input && !input.disabled) { input.value = q; sendClaudeMessage(); }
}

/* =====================================================================
 * NEW AI ACTION HANDLERS
 * ===================================================================== */
async function runBriefMe() {
  if (!claudeHasKey()) { toast('Add your Anthropic API key in Settings → Claude AI.'); go('settings'); return; }
  if (!State.model) { toast('Run a forecast first.'); return; }
  const btn = document.getElementById('brief-me-btn');
  const out = document.getElementById('brief-me-out');
  if (btn) { btn.disabled = true; btn.textContent = '✦ Thinking…'; }
  if (out) out.innerHTML = '<div class="ai-loading">✦ Claude is reading the forecast…<span class="chat-loading"><span class="d1"></span><span class="d2"></span><span class="d3"></span></span></div>';
  try {
    const text = await claudeBriefMe(State.model);
    State.briefMe = text;
    if (out) out.innerHTML = '<div class="ai-response brief-me-response">' + text.replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>') + '</div>';
  } catch(e) {
    if (out) out.innerHTML = '<div style="color:var(--crit);font-size:13px">Error: ' + e.message + '</div>';
  }
  if (btn) { btn.disabled = false; btn.textContent = '✦ Regenerate'; }
}

async function runRiskAction(idx) {
  if (!claudeHasKey()) { toast('Add your Anthropic API key in Settings → Claude AI.'); go('settings'); return; }
  if (!State.model) return;
  const btn = document.getElementById('ra-btn-' + idx);
  const out = document.getElementById('ra-out-' + idx);
  if (btn) { btn.disabled = true; btn.textContent = '✦ Thinking…'; }
  if (out) out.innerHTML = '<div class="ai-loading">✦ Claude is analyzing this risk…<span class="chat-loading"><span class="d1"></span><span class="d2"></span><span class="d3"></span></span></div>';
  try {
    const text = await claudeRiskAction(idx, State.model);
    State.riskActions[idx] = text;
    if (out) out.innerHTML = '<div class="ai-response r-ai-response">' + text.replace(/\n/g, '<br/>') + '</div>';
  } catch(e) {
    if (out) out.innerHTML = '<div style="color:var(--crit);font-size:12px">Error: ' + e.message + '</div>';
  }
  if (btn) { btn.disabled = false; btn.textContent = '✦ What should I do?'; }
}

async function runRankRisks() {
  if (!claudeHasKey()) { toast('Add your Anthropic API key in Settings → Claude AI.'); go('settings'); return; }
  if (!State.model) return;
  const btn = document.getElementById('rank-risks-btn');
  const out = document.getElementById('rank-risks-out');
  if (btn) { btn.disabled = true; btn.textContent = '✦ Ranking…'; }
  if (out) out.innerHTML = '<div class="ai-loading">✦ Claude is ranking and prioritizing risks…<span class="chat-loading"><span class="d1"></span><span class="d2"></span><span class="d3"></span></span></div>';
  try {
    const text = await claudeRankRisks(State.model);
    if (out) {
      out.style.display = '';
      out.innerHTML = '<div class="ai-response rank-risks-response" style="margin-bottom:12px">' + text.replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>') + '</div>';
    }
  } catch(e) {
    if (out) out.innerHTML = '<div style="color:var(--crit);font-size:12px">Error: ' + e.message + '</div>';
  }
  if (btn) { btn.disabled = false; btn.textContent = '✦ Get action plan'; }
}

async function runCoverNote() {
  if (!claudeHasKey()) { toast('Add your Anthropic API key in Settings → Claude AI.'); go('settings'); return; }
  if (!State.model) return;
  const btn = document.getElementById('cover-note-btn');
  const out = document.getElementById('cover-note-out');
  if (btn) { btn.disabled = true; btn.textContent = '✦ Drafting…'; }
  if (out) out.innerHTML = '<div class="ai-loading">✦ Claude is drafting the cover note…<span class="chat-loading"><span class="d1"></span><span class="d2"></span><span class="d3"></span></span></div>';
  try {
    const text = await claudeCoverNote(State.model);
    State.coverNote = text;
    if (out) out.innerHTML = '<div class="ai-response cover-note-response">' + text.replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>') + '</div>';
  } catch(e) {
    if (out) out.innerHTML = '<div style="color:var(--crit);font-size:12px">Error: ' + e.message + '</div>';
  }
  if (btn) { btn.disabled = false; btn.textContent = '✦ Regenerate Cover Note'; }
}

function weekWaterfallChart(wk, cfg) {
  var W = 640, H = 230;
  var pT = 18, pB = 50, pL = 58, pR = 52;
  var plotW = W - pL - pR, plotH = H - pT - pB;

  // Identify largest outflow category as the driver
  var outCats = { AP: wk.cat.AP, Payroll: wk.cat.Payroll, Debt: wk.cat.Debt, Capex: wk.cat.Capex };
  var driverCat = Object.keys(outCats).reduce(function(a, b) { return outCats[a] < outCats[b] ? a : b; });

  // Build segments: opening → moves → closing
  var moves = [
    { key: 'AR',      label: 'AR',      value: wk.cat.AR },
    { key: 'AP',      label: 'AP',      value: wk.cat.AP },
    { key: 'Payroll', label: 'Payroll', value: wk.cat.Payroll },
    { key: 'Debt',    label: 'Debt',    value: wk.cat.Debt },
    { key: 'Capex',   label: 'Capex',   value: wk.cat.Capex },
  ].filter(function(m) { return m.value !== 0; });

  var segs = [];
  var run = wk.opening;
  segs.push({ label: 'Open', value: wk.opening, lo: 0, hi: wk.opening, type: 'bal' });
  moves.forEach(function(m) {
    var lo = run + Math.min(m.value, 0);
    var hi = run + Math.max(m.value, 0);
    segs.push({ label: m.label, value: m.value, lo: lo, hi: hi, type: m.value > 0 ? 'in' : 'out', isDriver: m.key === driverCat });
    run += m.value;
  });
  segs.push({ label: 'Close', value: wk.closing, lo: 0, hi: wk.closing, type: 'close' });

  // Y scale
  var allY = segs.reduce(function(a, s) { return a.concat([s.lo, s.hi]); }, [cfg.buffer, 0]);
  var yMax = Math.max.apply(null, allY) * 1.10;
  var yMin = Math.min(0, Math.min.apply(null, allY));
  var yRange = yMax - yMin;
  var sy = function(v) { return pT + (1 - (v - yMin) / yRange) * plotH; };

  // Bar geometry
  var n = segs.length;
  var slotW = plotW / n;
  var bW = slotW * 0.62;
  var bOff = (slotW - bW) / 2;
  var bX = function(i) { return pL + i * slotW + bOff; };
  var bMid = function(i) { return bX(i) + bW / 2; };

  // Y-axis ticks (round to nearest $1M steps)
  var rawStep = (yMax - Math.max(yMin, 0)) / 5;
  var tickStep = Math.max(1e6, Math.ceil(rawStep / 1e6) * 1e6);
  var yAxisSvg = '';
  for (var tv = 0; tv <= yMax + tickStep * 0.1; tv += tickStep) {
    var ty = sy(tv);
    yAxisSvg += '<line x1="' + pL + '" y1="' + ty.toFixed(0) + '" x2="' + (pL + plotW) + '" y2="' + ty.toFixed(0) + '" stroke="#f3f4f6" stroke-width="1"/>' +
      '<text x="' + (pL - 6) + '" y="' + (ty + 3.5).toFixed(1) + '" text-anchor="end" font-size="9.5" fill="#9ca3af">' + fmtM(tv) + '</text>';
  }

  // Floor zone + line
  var fy = sy(cfg.buffer);
  var floorSvg =
    '<rect x="' + pL + '" y="' + fy.toFixed(0) + '" width="' + plotW + '" height="' + (pT + plotH - fy).toFixed(0) + '" fill="#fef2f2" opacity="0.6"/>' +
    '<line x1="' + pL + '" y1="' + fy.toFixed(0) + '" x2="' + (pL + plotW) + '" y2="' + fy.toFixed(0) + '" stroke="#C8102E" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.75"/>' +
    '<text x="' + (pL + plotW + 4) + '" y="' + (fy + 4).toFixed(0) + '" font-size="9" fill="#C8102E" font-weight="700">Floor</text>';

  // Bars + connectors + labels
  var barsSvg = '';
  var prevNewRun = wk.opening;
  segs.forEach(function(s, i) {
    var x = bX(i), mid = bMid(i);
    var top = sy(s.hi), bot = sy(s.lo);
    var h = Math.max(bot - top, 2);

    var fill = s.type === 'in' ? '#86BC25' :
               s.type === 'out' ? '#C8102E' :
               s.type === 'close' ? (wk.closing < cfg.buffer ? '#C8102E' : wk.closing < cfg.covenant * 1.1 ? '#E8A800' : '#2a7d2a') :
               '#94a3b8';

    // Connector from previous bar's exit level to this bar's start level
    if (i > 0) {
      var connY = sy(prevNewRun).toFixed(0);
      var cx1 = (bX(i - 1) + bW).toFixed(0);
      var cx2 = x.toFixed(0);
      barsSvg += '<line x1="' + cx1 + '" y1="' + connY + '" x2="' + cx2 + '" y2="' + connY + '" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="4,2"/>';
    }

    // Update running total for next connector
    prevNewRun = s.type === 'in' ? s.hi : s.type === 'out' ? s.lo : s.hi;

    // Bar rect
    barsSvg += '<rect x="' + x.toFixed(0) + '" y="' + top.toFixed(0) + '" width="' + bW.toFixed(0) + '" height="' + h.toFixed(0) +
      '" fill="' + fill + '" opacity="' + (s.type === 'bal' || s.type === 'close' ? '0.28' : '0.82') + '" rx="2"/>';

    // Driver highlight ring
    if (s.isDriver) {
      barsSvg += '<rect x="' + (x - 2).toFixed(0) + '" y="' + (top - 2).toFixed(0) + '" width="' + (bW + 4).toFixed(0) + '" height="' + (h + 4).toFixed(0) + '" fill="none" stroke="#C8102E" stroke-width="2" rx="3"/>';
    }

    // Category label below chart
    barsSvg += '<text x="' + mid.toFixed(0) + '" y="' + (H - pB + 16) + '" text-anchor="middle" font-size="9.5" fill="#6b7280">' + s.label + '</text>';

    // Value label — above bar for inflow/open/close, below bar bottom for outflow
    var valTxt = (s.type === 'in' ? '+' : '') + fmtM(s.value);
    var fontSize = s.isDriver ? '10' : '9';
    var fontWeight = s.isDriver ? '800' : '700';
    if (s.type === 'out') {
      var lblY = (bot + 13).toFixed(0);
      barsSvg += '<text x="' + mid.toFixed(0) + '" y="' + lblY + '" text-anchor="middle" font-size="' + fontSize + '" fill="' + fill + '" font-weight="' + fontWeight + '">' + valTxt + '</text>';
    } else {
      var lblY2 = (top - 5).toFixed(0);
      barsSvg += '<text x="' + mid.toFixed(0) + '" y="' + lblY2 + '" text-anchor="middle" font-size="' + fontSize + '" fill="' + fill + '" font-weight="' + fontWeight + '">' + valTxt + '</text>';
    }
  });

  return '<div class="wd-chart">' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;display:block">' +
      yAxisSvg + floorSvg + barsSvg +
    '</svg>' +
  '</div>';
}

function showWeekDrill(weekNum) {
  if (!State.model) return;
  var f = State.model.forecasts[State.scenario];
  var wk = f.weeks.find(function(w) { return w.week === weekNum; });
  if (!wk) return;
  var risk = State.model.risks.find(function(r) { return r.week === weekNum; });
  var cfg = State.cfg;
  var closingCls = wk.closing < cfg.buffer ? 'wd-breach' : (wk.closing < cfg.covenant * 1.1 ? 'wd-warn' : 'wd-safe');

  // Identify driver category for table row highlight
  var outCats = { AP: wk.cat.AP, Payroll: wk.cat.Payroll, Debt: wk.cat.Debt, Capex: wk.cat.Capex };
  var driverCat = Object.keys(outCats).reduce(function(a, b) { return outCats[a] < outCats[b] ? a : b; });

  var tableRows = [
    { label: 'Opening Balance', value: wk.opening,      cls: 'wd-balance' },
    { label: 'AR Collections',  value: wk.cat.AR,        cls: 'wd-inflow' },
    { label: 'AP Disbursements',value: wk.cat.AP,        cls: 'wd-outflow', key: 'AP' },
    { label: 'Payroll',         value: wk.cat.Payroll,   cls: 'wd-outflow', key: 'Payroll' },
    { label: 'Debt Service',    value: wk.cat.Debt,      cls: 'wd-outflow', key: 'Debt' },
    { label: 'Capex',           value: wk.cat.Capex,     cls: 'wd-outflow', key: 'Capex' },
  ].filter(function(r) { return r.value !== 0 || r.cls === 'wd-balance'; });

  var panel = document.getElementById('week-drill-panel');
  if (!panel) return;

  document.querySelectorAll('.wk-clickable').forEach(function(th) { th.classList.remove('wk-selected'); });
  var selHdr = document.getElementById('wk-hdr-' + weekNum);
  if (selHdr) selHdr.classList.add('wk-selected');

  var shortfallHtml = wk.closing < cfg.buffer
    ? '<div class="wd-shortfall-banner">⚑ ' + fmtM(cfg.buffer - wk.closing) + ' shortfall below the ' + fmtM(cfg.buffer) + ' operating floor</div>'
    : '';

  panel.innerHTML =
    '<div class="wd-header">' +
      '<div class="wd-title-block">' +
        '<div class="wd-title">' + wk.label + '</div>' +
        (risk ? '<span class="wd-risk-pill sev-' + risk.severity.toLowerCase() + '">' + risk.severity + ' · ' + risk.type + '</span>' : '<span class="wd-safe-pill">No risk flag</span>') +
      '</div>' +
      '<button class="wd-close" onclick="document.getElementById(\'week-drill-panel\').classList.add(\'hidden\');document.querySelectorAll(\'.wk-selected\').forEach(function(el){el.classList.remove(\'wk-selected\');})">✕ Close</button>' +
    '</div>' +
    weekWaterfallChart(wk, cfg) +
    shortfallHtml +
    '<div class="wd-body">' +
      '<div class="wd-breakdown">' +
        '<div class="wd-section-label">Cash movement detail</div>' +
        tableRows.map(function(r) {
          var isDriver = r.key === driverCat;
          return '<div class="wd-row ' + r.cls + (isDriver ? ' wd-driver-row' : '') + '">' +
            '<span class="wd-label">' + r.label + (isDriver ? '<span class="wd-driver-tag">driver</span>' : '') + '</span>' +
            '<span class="wd-val">' + fmtMoney(r.value) + '</span></div>';
        }).join('') +
        '<div class="wd-row wd-net"><span class="wd-label">Net Cash Flow</span><span class="wd-val">' + fmtMoney(wk.net) + '</span></div>' +
        '<div class="wd-row wd-closing ' + closingCls + '"><span class="wd-label"><b>Closing Balance</b></span><span class="wd-val"><b>' + fmtMoney(wk.closing) + '</b></span></div>' +
      '</div>' +
      '<div class="wd-ai">' +
        '<div class="wd-ai-header">' +
          '<span class="wd-ai-label">✦ Claude Analysis</span>' +
          '<button class="btn btn-primary btn-sm" id="wd-explain-btn" onclick="runExplainWeek(' + weekNum + ')">✦ Explain this week</button>' +
        '</div>' +
        '<div id="wd-explain-out" class="wd-explain-out">' +
          (claudeHasKey()
            ? '<div class="muted" style="font-size:13px;padding:6px 0">Click above for Claude\'s analysis of what\'s driving this week\'s position.</div>'
            : '<div class="muted" style="font-size:13px;padding:6px 0"><a href="#" onclick="go(\'settings\');return false" style="color:var(--green)">Configure Claude API key</a> to unlock week-by-week analysis.</div>') +
        '</div>' +
      '</div>' +
    '</div>';

  panel.classList.remove('hidden');
  setTimeout(function() { panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 50);
}

async function runExplainWeek(weekNum) {
  if (!claudeHasKey()) { toast('Add your Anthropic API key in Settings → Claude AI.'); go('settings'); return; }
  const btn = document.getElementById('wd-explain-btn');
  const out = document.getElementById('wd-explain-out');
  if (btn) { btn.disabled = true; btn.textContent = '✦ Analyzing…'; }
  if (out) out.innerHTML = '<div class="ai-loading">✦ Claude is analyzing Week ' + weekNum + '…<span class="chat-loading"><span class="d1"></span><span class="d2"></span><span class="d3"></span></span></div>';
  try {
    const text = await claudeExplainWeek(weekNum, State.model);
    if (out) out.innerHTML = '<div class="ai-response">' + text.replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>') + '</div>';
  } catch(e) {
    if (out) out.innerHTML = '<div style="color:var(--crit);font-size:12px">Error: ' + e.message + '</div>';
  }
  if (btn) { btn.disabled = false; btn.textContent = '✦ Re-explain'; }
}

function showLowConfEvents() {
  if (!State.model) return;
  const evs = State.model.normEvents;
  const riskWeeks = new Set(State.model.risks.map(r => r.week));
  const lowConf = evs.filter(function(e) { return e.confidence === 'Low'; });
  const sorted = sortedByPriority(lowConf, riskWeeks);
  const tbl = document.getElementById('eventTbl');
  const sub = document.getElementById('evtTbl-sub');
  const tog = document.getElementById('evtTbl-toggle');
  if (tbl) tbl.innerHTML = eventTable(sorted, { riskWeeks, sorted: true });
  if (sub) sub.textContent = 'Showing ' + lowConf.length + ' low-confidence events · sorted by priority (risk week + amount)';
  if (tog) { tog.textContent = 'Show all ' + evs.length + ' events'; tog.onclick = showAllEvents; }
}

function showAllEvents() {
  if (!State.model) return;
  const evs = State.model.normEvents;
  const riskWeeks = new Set(State.model.risks.map(r => r.week));
  const tbl = document.getElementById('eventTbl');
  const sub = document.getElementById('evtTbl-sub');
  const tog = document.getElementById('evtTbl-toggle');
  if (tbl) tbl.innerHTML = eventTable(evs, { riskWeeks });
  if (sub) sub.textContent = 'All ' + evs.length + ' normalized events · sorted by date';
  const lowConf = evs.filter(function(e) { return e.confidence === 'Low'; });
  if (tog && lowConf.length) { tog.textContent = 'Show ' + lowConf.length + ' flagged only'; tog.onclick = showLowConfEvents; }
}

function filterLowConfidence() { showLowConfEvents(); }

function updateSettingsPreview() {
  if (!State.model) return;
  const floorEl = document.getElementById('cfg-buffer');
  const covEl = document.getElementById('cfg-cov');
  const previewEl = document.getElementById('settings-preview');
  if (!floorEl || !previewEl) return;
  const newFloor = parseFloat(floorEl.value) || State.cfg.buffer;
  const newCov = parseFloat(covEl.value) || State.cfg.covenant;
  const f = State.model.forecasts[State.scenario];
  const below = f.weeks.filter(function(w) { return w.closing < newFloor; }).length;
  const near = f.weeks.filter(function(w) { return w.closing >= newFloor && w.closing < newCov * 1.1; }).length;
  previewEl.textContent = 'With these thresholds: ' + below + ' week' + (below !== 1 ? 's' : '') + ' below the operating floor · ' + near + ' week' + (near !== 1 ? 's' : '') + ' in covenant proximity zone';
  previewEl.style.color = below > 0 ? 'var(--crit)' : (near > 0 ? 'var(--high)' : 'var(--green)');
}

function claudeSettingsCard() {
  const connected = claudeHasKey();
  return `<div class="card card-pad" style="margin-bottom:18px;border-color:${connected ? 'var(--green)' : 'var(--gray-200)'}">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <h3 style="margin:0">✦ Claude AI Integration</h3>
      ${connected
        ? '<span class="badge b-high" style="background:rgba(134,188,37,.2);color:#3d6008">Connected</span>'
        : '<span class="badge b-medsev">Not configured</span>'}
    </div>
    <div class="card-sub">Connect your Anthropic API key to enable AI-generated variance commentary, risk narratives, and a natural language Q&amp;A assistant on the Dashboard.</div>
    <div class="field" style="margin-bottom:8px">
      <label>Anthropic API key</label>
      <div class="flex" style="gap:8px">
        <input type="password" id="claude-key-input" placeholder="${connected ? 'API key saved — enter a new key to replace' : 'sk-ant-api05-…'}" style="flex:1">
        <button class="btn btn-primary btn-sm" onclick="saveApiKey()">Save key</button>
        ${connected ? '<button class="btn btn-ghost btn-sm" onclick="clearApiKey()">Clear</button>' : ''}
      </div>
      <div class="hint">Stored in browser localStorage only. Sent exclusively to api.anthropic.com — never to any other server.</div>
    </div>
    ${connected ? '<div style="font-size:12px;color:var(--green);font-weight:600">✓ AI features active · Claude ' + CLAUDE_MODEL + ' · Dashboard → Ask Claude · Layer 4 → AI Analysis</div>' : '<div class="muted" style="font-size:12px">Get an API key at console.anthropic.com</div>'}
  </div>`;
}

function aiAnalysisSection() {
  const connected = claudeHasKey();
  return `<div class="card card-pad" style="margin-bottom:18px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
      <h3 style="margin:0">✦ AI-Powered Analysis</h3>
      ${connected
        ? '<span style="font-size:11px;color:var(--green);font-weight:600">Claude ' + CLAUDE_MODEL + '</span>'
        : '<a href="#" class="btn btn-ghost btn-sm" onclick="go(\'settings\');return false">Configure API key →</a>'}
    </div>
    <div class="card-sub">Claude reads the forecast data and drafts plain-language commentary and a CFO-ready risk narrative — both suitable for the board package or lender certificate.</div>
    <div class="grid g2" style="margin-top:12px">
      <div>
        <div class="flex" style="justify-content:space-between;margin-bottom:8px">
          <b style="font-size:13px">Variance Commentary</b>
          <button class="btn btn-primary btn-sm" id="ai-commentary-btn" onclick="runAICommentary()">✦ ${State.aiCommentary ? 'Regenerate' : 'Generate'}</button>
        </div>
        <div id="ai-commentary-out">${State.aiCommentary
          ? '<div class="ai-response">' + State.aiCommentary.replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>') + '</div>'
          : '<div class="muted" style="padding:10px 0">Claude will write variance commentary for each flagged week, attributing movements to specific drivers and noting timing vs. volume shifts.</div>'
        }</div>
      </div>
      <div>
        <div class="flex" style="justify-content:space-between;margin-bottom:8px">
          <b style="font-size:13px">Risk Narrative</b>
          <button class="btn btn-primary btn-sm" id="ai-risk-btn" onclick="runAIRiskNarrative()">✦ ${State.aiRiskNarrative ? 'Regenerate' : 'Generate'}</button>
        </div>
        <div id="ai-risk-out">${State.aiRiskNarrative
          ? '<div class="ai-response">' + State.aiRiskNarrative.replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>') + '</div>'
          : '<div class="muted" style="padding:10px 0">Claude will draft a CFO briefing paragraph and a management summary sentence from the detected risk windows — ready to paste into the board or lender package.</div>'
        }</div>
      </div>
    </div>
  </div>`;
}

function askClaudeSection() {
  const connected = claudeHasKey();
  const suggestions = ['Why is week 7 critical?', 'What drives the cash floor breach?', 'How do we improve W13 balance?', 'Draft a CFO briefing sentence'];
  return `<div class="card card-pad" style="margin-top:18px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
      <h3 style="margin:0">✦ Ask Claude</h3>
      ${connected
        ? '<span style="font-size:11px;color:var(--green);font-weight:600">Claude ' + CLAUDE_MODEL + ' · Connected</span>'
        : '<a href="#" class="btn btn-ghost btn-sm" onclick="go(\'settings\');return false">Connect Claude →</a>'}
    </div>
    <div class="card-sub">Ask questions about the forecast in plain language. Claude reads the actual data — all 13 weeks, every risk flag, every scenario.</div>
    <div class="pill-row">
      ${suggestions.map(function(q) {
        return '<span class="chip" style="cursor:pointer" onclick="sendSuggestedQuestion(' + JSON.stringify(q) + ')">' + q + '</span>';
      }).join('')}
    </div>
    <div id="claude-chat-messages" style="min-height:90px;max-height:300px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:8px;padding:12px;margin-bottom:10px">
      ${State.claudeChat.length ? '' : '<div class="muted" style="text-align:center;padding:16px 0">Ask Claude anything about the forecast — it has full access to all 13 weeks of data, risk flags, and scenario analysis.</div>'}
    </div>
    <div class="flex" style="gap:8px">
      <input id="claude-input" type="text" placeholder="e.g. What is the biggest cash risk in the next 4 weeks?"
        style="flex:1;padding:8px 12px;border:1px solid var(--gray-300);border-radius:8px;font-size:13px;font-family:var(--font)"
        onkeydown="if(event.key===\'Enter\'&&!event.shiftKey)sendClaudeMessage()">
      <button class="btn btn-primary" onclick="sendClaudeMessage()">Ask →</button>
    </div>
    ${!connected ? '<div class="muted" style="margin-top:8px;font-size:12px">→ <a href="#" style="color:var(--green)" onclick="go(\'settings\');return false">Add your Anthropic API key in Settings</a> to enable AI features.</div>' : ''}
  </div>`;
}

/* =====================================================================
 * INIT
 * ===================================================================== */
function init() {
  document.querySelectorAll('#nav button').forEach(b => b.onclick = () => go(b.dataset.view));
  document.querySelectorAll('#scenarioToggle button').forEach(b => b.onclick = () => setScenario(b.dataset.sc));
  document.getElementById('runBtn').onclick = () => runForecast();
  applyBranding();
  renderStaticViews();
  renderAll();
}
document.addEventListener('DOMContentLoaded', init);
