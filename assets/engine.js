/* =====================================================================
 * engine.js  —  Layer 2 (Normalization), Layer 3 (Forecast),
 *               Layer 4 (Variance & Risk)
 * ===================================================================== */

const CONF_SCORE = { High: 0.95, Medium: 0.7, Low: 0.4 };
const CATEGORIES = ['AR', 'AP', 'Payroll', 'Debt', 'Capex'];
const CAT_LABEL = {
  AR: 'AR Collections', AP: 'AP Disbursements', Payroll: 'Payroll',
  Debt: 'Debt Service', Capex: 'Capex',
};

// Per-tier historical DSO offset (days late). Stand-in for a trained model.
const TIER_DSO = { 'Tier 1': 4, 'Tier 2': 9, 'Tier 3': 16 };

/* =====================================================================
 * LAYER 2 — NORMALIZATION ENGINE
 * Transforms 5 raw inputs into a single unified cash-event model.
 * Each event: { date, week, amount(signed), category, confidence, ... }
 * ===================================================================== */
function normalize(raw, cfg) {
  const start = cfg.startDate;
  const events = [];
  const tasks = []; // human-readable normalization log

  /* ---- AR → Collections timing (DSO-adjusted curve) ---- */
  raw.ar.forEach(inv => {
    const due = parseDate(inv.dueDate) || parseDate(inv.invoiceDate);
    if (!due) return;
    const amt = num(inv.amount);
    const dso = TIER_DSO[inv.tier] != null ? TIER_DSO[inv.tier] : 7;
    // Adjusted base date = due + tier DSO offset (probabilistic model proxy)
    const base = addDays(due, dso);
    // 70/20/10 collection curve around the DSO-adjusted date
    const curve = [
      { off: 0, w: 0.70 }, { off: 7, w: 0.20 }, { off: 14, w: 0.10 },
    ];
    const confByTier = { 'Tier 1': 'High', 'Tier 2': 'Medium', 'Tier 3': 'Low' };
    const arConf = confByTier[inv.tier] || 'Medium';
    curve.forEach(c => {
      const date = addDays(base, c.off);
      events.push(mkEvent({
        category: 'AR', date, amount: +(amt * c.w),
        entity: inv.customer, subcategory: inv.tier || 'Untiered',
        confidence: arConf, controllable: false,
        ref: inv.id, dsoAdj: dso,
        note: `${inv.tier || ''} · DSO+${dso}d · curve ${Math.round(c.w * 100)}%`,
      }, cfg));
    });
  });
  tasks.push(`AR → ${raw.ar.length} invoices · tier confidence (T1=High, T2=Medium, T3=Low) · DSO-adjusted 70/20/10 collection curves (T1 +${TIER_DSO['Tier 1']}d, T2 +${TIER_DSO['Tier 2']}d, T3 +${TIER_DSO['Tier 3']}d).`);

  /* ---- AP → Payment timing (terms applied; discretionary flag) ---- */
  raw.ap.forEach(b => {
    const inv = parseDate(b.invoiceDate);
    if (!inv) return;
    const termDays = (String(b.terms).match(/\d+/) || [30])[0] * 1;
    const pay = addDays(inv, termDays);
    const amt = num(b.amount);
    const discountable = !!String(b.discount).trim();
    // Discretionary if longer terms (company controls timing); fixed for short/utility
    const controllable = termDays >= 30;
    events.push(mkEvent({
      category: 'AP', date: pay, amount: -Math.abs(amt),
      entity: b.vendor, subcategory: b.terms || 'Net 30',
      confidence: termDays >= 45 ? 'Medium' : 'High',
      controllable,
      earlyPay: discountable,
      ref: b.id,
      note: `${b.terms}${discountable ? ' · early-pay discount avail (2/10)' : ''}${controllable ? ' · discretionary timing' : ' · fixed'}`,
    }, cfg));
  });
  const discCount = raw.ap.filter(b => String(b.discount).trim()).length;
  tasks.push(`AP → ${raw.ap.length} bills scheduled by payment terms; ${discCount} early-pay discount opportunities flagged; discretionary vs. fixed timing tagged.`);

  /* ---- Payroll → exact date, full gross + benefits uplift (High) ---- */
  raw.payroll.forEach(p => {
    const date = parseDate(p.payDate);
    if (!date) return;
    const gross = num(p.grossAmount);
    const uplift = num(p.benefitsUplift) || 0;
    events.push(mkEvent({
      category: 'Payroll', date, amount: -Math.abs(gross),
      entity: p.department || 'Payroll', subcategory: 'Gross wages',
      confidence: 'High', controllable: false, ref: p.id,
      note: `${num(p.employeeCount)} employees · 100% gross, no smoothing`,
    }, cfg));
    if (uplift > 0) {
      events.push(mkEvent({
        category: 'Payroll', date: addDays(date, 1), amount: -Math.abs(gross * uplift),
        entity: p.department || 'Payroll', subcategory: 'Employer taxes & benefits',
        confidence: 'High', controllable: false, ref: p.id,
        note: `Benefits/tax uplift ${Math.round(uplift * 100)}% (+1 business day)`,
      }, cfg));
    }
  });
  tasks.push(`Payroll → ${raw.payroll.length} runs booked at 100% gross on exact pay dates + employer tax/benefits uplift. Confidence: High.`);

  /* ---- Debt Service → full amortization (principal + interest), High ---- */
  raw.debt.forEach(d => {
    const date = parseDate(d.paymentDate);
    if (!date) return;
    const p = num(d.principal), i = num(d.interest);
    if (p) events.push(mkEvent({
      category: 'Debt', date, amount: -Math.abs(p),
      entity: d.lender, subcategory: (d.facility || '') + ' · Principal',
      confidence: 'High', controllable: false, ref: d.id,
      note: `Principal · ${d.facility}`,
    }, cfg));
    if (i) events.push(mkEvent({
      category: 'Debt', date, amount: -Math.abs(i),
      entity: d.lender, subcategory: (d.facility || '') + ' · Interest',
      confidence: 'High', controllable: false, ref: d.id,
      note: `Interest · ${d.facility}`,
    }, cfg));
  });
  tasks.push(`Debt Service → full amortization schedule loaded (principal + interest split) for all facilities. Confidence: High.`);

  /* ---- Capex → approval-status weighting ---- */
  raw.capex.forEach(c => {
    const date = parseDate(c.expectedDate);
    if (!date) return;
    const amt = Math.abs(num(c.amount));
    const status = String(c.status).toLowerCase();
    let conf, prob, sensitivityOnly = false, spread = false;
    if (status.includes('po issued') || (status.includes('approved') && status.includes('po') && !status.includes('pending'))) {
      conf = 'High'; prob = 1.0;
    } else if (status.includes('pending')) {
      conf = 'Medium'; prob = 0.6; spread = true;
    } else {
      conf = 'Low'; prob = 0.25; sensitivityOnly = true;
    }
    if (spread) {
      // spread over ±2 week window: 25% W-2, 50% center, 25% W+2  (probability-weighted)
      [[-14, 0.25], [0, 0.5], [14, 0.25]].forEach(([off, w]) => {
        events.push(mkEvent({
          category: 'Capex', date: addDays(date, off), amount: -(amt * prob * w),
          entity: c.project, subcategory: c.status,
          confidence: conf, controllable: true, prob, sensitivityOnly,
          ref: c.id, note: `${c.status} · ${Math.round(prob * 100)}% prob · spread ±2wk`,
        }, cfg));
      });
    } else {
      events.push(mkEvent({
        category: 'Capex', date, amount: -(amt * prob),
        entity: c.project, subcategory: c.status,
        confidence: conf, controllable: true, prob, sensitivityOnly,
        ref: c.id, note: `${c.status} · ${Math.round(prob * 100)}% prob${sensitivityOnly ? ' · sensitivity only' : ''}`,
      }, cfg));
    }
  });
  tasks.push(`Capex → approval-status weighting applied (PO issued=100%/High, Pending PO=60%/Med spread ±2wk, In approval=25%/Low sensitivity-only).`);

  return { events: events.filter(e => e.week != null), tasks };
}

function mkEvent(e, cfg) {
  const date = e.date;
  const wk = weekIndex(date, cfg.startDate);
  return Object.assign({
    week: wk, isoDate: isoDate(date), date,
    confidenceScore: CONF_SCORE[e.confidence] || 0.7,
    override: false,
  }, e);
}

/* =====================================================================
 * LAYER 3 — FORECAST ENGINE
 * Builds the 13-week direct-method cash-position matrix for a scenario.
 * ===================================================================== */
const SCENARIOS = {
  Base: { label: 'Base Case', desc: 'DSO-adjusted collections; 100% of high-confidence outflows.' },
  Downside: { label: 'Downside', desc: 'Collections delayed +7 days; medium-confidence capex included at 80%.' },
  Upside: { label: 'Upside', desc: 'Collections 3 days early; low-confidence capex excluded.' },
};

function applyScenario(events, scenario, cfg) {
  return events.map(ev => {
    const e = Object.assign({}, ev);
    if (e.category === 'AR') {
      let shift = 0;
      if (scenario === 'Downside') shift = 7;
      if (scenario === 'Upside') shift = -3;
      if (shift) {
        const nd = addDays(e.date, shift);
        e.date = nd; e.isoDate = isoDate(nd); e.week = weekIndex(nd, cfg.startDate);
      }
    }
    if (e.category === 'Capex') {
      const isMedium = e.confidence === 'Medium';
      const isLow = e.confidence === 'Low' || e.sensitivityOnly;
      if (scenario === 'Base') {
        if (isLow) e.excluded = true;            // low excluded from base
      } else if (scenario === 'Downside') {
        if (isMedium && e.prob) {                 // medium bumped 60%→80%
          e.amount = e.amount * (0.8 / e.prob); e.prob = 0.8;
        }
        if (isLow) e.excluded = true;
      } else if (scenario === 'Upside') {
        if (isLow) e.excluded = true;             // low excluded
      }
    }
    return e;
  }).filter(e => !e.excluded && e.week != null);
}

function buildForecast(events, scenario, cfg) {
  const evs = applyScenario(events, scenario, cfg);
  const weeks = [];
  for (let w = 1; w <= 13; w++) {
    weeks.push({
      week: w, label: weekLabel(cfg.startDate, w), start: isoDate(weekStart(cfg.startDate, w)),
      inflow: 0, outflow: 0,
      cat: { AR: 0, AP: 0, Payroll: 0, Debt: 0, Capex: 0 },
      events: [], varWeighted: 0,
    });
  }
  evs.forEach(e => {
    const wk = weeks[e.week - 1];
    if (!wk) return;
    wk.cat[e.category] += e.amount;
    if (e.amount >= 0) wk.inflow += e.amount; else wk.outflow += e.amount;
    wk.events.push(e);
    // variance proxy for confidence band: (1-confidence) * |amount|
    wk.varWeighted += Math.pow((1 - e.confidenceScore) * Math.abs(e.amount), 2);
  });

  let bal = cfg.openingBalance;
  weeks.forEach(wk => {
    wk.net = wk.inflow + wk.outflow;
    wk.opening = bal;
    wk.closing = bal + wk.net;
    bal = wk.closing;
    // ±1σ confidence band from aggregate confidence weights of the week's events
    wk.sigma = Math.sqrt(wk.varWeighted);
  });
  // cumulative sigma (uncertainty compounds across weeks)
  let cumVar = 0;
  weeks.forEach(wk => { cumVar += wk.varWeighted; wk.bandSigma = Math.sqrt(cumVar); });

  return {
    scenario, scenarioLabel: SCENARIOS[scenario].label,
    weeks, events: evs,
    openingBalance: cfg.openingBalance,
    closingBalance: weeks[12].closing,
    netChange: weeks[12].closing - cfg.openingBalance,
    cfg,
  };
}

/* =====================================================================
 * LAYER 4 — VARIANCE & RISK ENGINE
 * ===================================================================== */

/* ---- 4.3 Liquidity risk window detection ---- */
function detectRisks(forecast, cfg) {
  const risks = [];
  const floor = cfg.buffer, cov = cfg.covenant;
  forecast.weeks.forEach(wk => {
    // Cash Floor Breach — Critical
    if (wk.closing < floor) {
      risks.push(mkRisk('Cash Floor Breach', 'Critical', wk, forecast, cfg,
        `Projected closing balance ${fmtM(wk.closing)} vs. ${fmtM(floor)} operating floor (${fmtM(wk.closing - floor)} shortfall).`));
    }
    // Covenant Proximity — High (only if not already a floor breach surfacing same number, still report)
    if (wk.closing < cov * 1.10) {
      risks.push(mkRisk('Covenant Proximity', 'High', wk, forecast, cfg,
        `Projected balance ${fmtM(wk.closing)} is within 110% of the ${fmtM(cov)} covenant minimum (${fmtM(cov * 1.10)} threshold).`));
    }
    // Concentration Risk — Medium (single inflow > 25% of weekly collections)
    const inflows = wk.events.filter(e => e.amount > 0);
    const totIn = inflows.reduce((s, e) => s + e.amount, 0);
    if (totIn > 0) {
      const byEntity = groupSum(inflows, e => e.entity);
      const top = byEntity[0];
      if (top && top.value / totIn > 0.25) {
        risks.push(mkRisk('Concentration Risk', 'Medium', wk, forecast, cfg,
          `${top.key} represents ${fmtPct(top.value / totIn)} of week ${wk.week} collections (${fmtM(top.value)} of ${fmtM(totIn)}).`));
      }
    }
    // Debt Stack Cliff — Medium (debt service > 30% of weekly operating inflows)
    const debt = Math.abs(wk.cat.Debt);
    if (totIn > 0 && debt / totIn > 0.30) {
      risks.push(mkRisk('Debt Stack Cliff', 'Medium', wk, forecast, cfg,
        `Debt service ${fmtM(debt)} is ${fmtPct(debt / totIn)} of week ${wk.week} operating inflows (${fmtM(totIn)}).`));
    }
  });
  // sort by severity then week
  const sev = { Critical: 0, High: 1, Medium: 2 };
  risks.sort((a, b) => sev[a.severity] - sev[b.severity] || a.week - b.week);
  return risks;
}

function mkRisk(type, severity, wk, forecast, cfg, definition) {
  // primary driver = largest single outflow event that week
  const outs = wk.events.filter(e => e.amount < 0).sort((a, b) => a.amount - b.amount);
  const driver = outs[0];
  const driverTxt = driver
    ? `${driver.entity} — ${CAT_LABEL[driver.category]} ${fmtM(Math.abs(driver.amount))} (${driver.subcategory || ''})`
    : 'Low inflow week';
  // suggested action
  let action;
  const shortfall = cfg.buffer - wk.closing;
  if (type === 'Cash Floor Breach') {
    // find a near-future AR tranche to accelerate
    const future = forecast.events.filter(e => e.category === 'AR' && e.week === wk.week + 1 && e.amount > 0)
      .sort((a, b) => b.amount - a.amount)[0];
    const accel = future ? `Accelerate ${future.entity} AR tranche (${fmtM(future.amount)}, currently W${future.week})` : 'Accelerate a high-tier AR tranche';
    action = `${accel} or draw ${fmtM(Math.max(shortfall, 2e6))} on the revolver.`;
  } else if (type === 'Covenant Proximity') {
    action = `Pre-clear a temporary covenant waiver and defer the lowest-confidence capex item out of week ${wk.week}.`;
  } else if (type === 'Concentration Risk') {
    action = `Confirm timing with the concentrated counterparty; build a contingency for a 1-week slip.`;
  } else {
    action = `Stagger discretionary AP / defer a low-confidence capex item to smooth the debt cliff.`;
  }
  return {
    type, severity, week: wk.week, weekLabel: wk.label,
    closing: wk.closing, shortfall: shortfall > 0 ? shortfall : 0,
    definition, driver: driverTxt, action,
    narrative: `${severity.toUpperCase()} — W${wk.week}: ${definition} Drivers: ${driverTxt}. Suggested action: ${action}`,
  };
}

function groupSum(arr, keyFn) {
  const m = {};
  arr.forEach(e => { const k = keyFn(e) || '—'; m[k] = (m[k] || 0) + e.amount; });
  return Object.entries(m).map(([key, value]) => ({ key, value: Math.abs(value), raw: value }))
    .sort((a, b) => b.value - a.value);
}

/* ---- 4.1 / 4.2 Variance vs. prior forecast + commentary ---- */
function computeVariance(current, prior, cfg, history) {
  if (!prior) return { hasPrior: false, category: [], weekly: [], ending: [], bridge: null, commentary: [] };
  const th = cfg.thresholds;
  const out = { hasPrior: true, category: [], weekly: [], ending: [], commentary: [] };

  // Category-level (totals across 13 weeks)
  CATEGORIES.forEach(cat => {
    const cur = current.weeks.reduce((s, w) => s + w.cat[cat], 0);
    const pri = prior.weeks.reduce((s, w) => s + w.cat[cat], 0);
    const delta = cur - pri;
    const pct = pri !== 0 ? delta / Math.abs(pri) : (delta !== 0 ? 1 : 0);
    const flagged = Math.abs(delta) > th.category.abs || Math.abs(pct) > th.category.pct;
    out.category.push({ cat, label: CAT_LABEL[cat], prior: pri, current: cur, delta, pct, flagged });
  });

  // Weekly net
  current.weeks.forEach((w, i) => {
    const pw = prior.weeks[i];
    const delta = w.net - (pw ? pw.net : 0);
    const pct = pw && pw.net !== 0 ? delta / Math.abs(pw.net) : (delta !== 0 ? 1 : 0);
    const flagged = Math.abs(delta) > th.weekly.abs || Math.abs(pct) > th.weekly.pct;
    out.weekly.push({ week: w.week, label: w.label, prior: pw ? pw.net : 0, current: w.net, delta, pct, flagged });
  });

  // Ending balance at W4, W8, W13
  [4, 8, 13].forEach(w => {
    const cur = current.weeks[w - 1].closing;
    const pri = prior.weeks[w - 1].closing;
    const delta = cur - pri;
    const pct = pri !== 0 ? delta / Math.abs(pri) : (delta !== 0 ? 1 : 0);
    const flagged = Math.abs(delta) > th.ending.abs || Math.abs(pct) > th.ending.pct;
    out.ending.push({ week: w, prior: pri, current: cur, delta, pct, flagged });
  });

  // Variance bridge: Prior → Volume → Timing → Rate/Mix → Revised
  out.bridge = buildBridge(current, prior);

  // 4.2 Automated commentary for flagged variances (weekly, driver-attributed)
  out.commentary = buildCommentary(current, prior, out, cfg, history);

  return out;
}

function buildBridge(current, prior) {
  const pTot = prior.weeks.reduce((s, w) => s + w.net, 0);
  const cTot = current.weeks.reduce((s, w) => s + w.net, 0);
  // Decompose by category change; classify portion as timing vs volume via gross flows
  let volume = 0, timing = 0, rateMix = 0;
  CATEGORIES.forEach(cat => {
    const cur = current.weeks.reduce((s, w) => s + w.cat[cat], 0);
    const pri = prior.weeks.reduce((s, w) => s + w.cat[cat], 0);
    const d = cur - pri;
    // total absolute movement (timing proxy): sum of |weekly deltas| minus |net delta|
    let absMove = 0;
    current.weeks.forEach((w, i) => { absMove += Math.abs(w.cat[cat] - (prior.weeks[i] ? prior.weeks[i].cat[cat] : 0)); });
    const t = Math.max(0, absMove - Math.abs(d)) / 2;
    timing += (d >= 0 ? t : -t) * 0.0; // timing nets ~0 by definition; tracked separately below
    volume += d;
  });
  // Simpler, defensible split: volume = net total change; timing = intra-period reshuffle magnitude; rateMix = residual
  let timingMag = 0;
  current.weeks.forEach((w, i) => { timingMag += Math.abs(w.net - (prior.weeks[i] ? prior.weeks[i].net : 0)); });
  const netDelta = cTot - pTot;
  timingMag = Math.max(0, timingMag - Math.abs(netDelta));
  volume = netDelta;
  return { prior: pTot, volume: volume, timing: timingMag, rateMix: 0, revised: cTot };
}

function buildCommentary(current, prior, varOut, cfg, history) {
  const notes = [];
  // Track consecutive-cycle drivers via history of driver entities
  const prevDrivers = (history && history.lastDrivers) || {};
  varOut.weekly.filter(w => w.flagged).forEach(w => {
    const cw = current.weeks[w.week - 1];
    const pw = prior.weeks[w.week - 1];
    // dominant category by abs delta
    let bestCat = null, bestDelta = 0;
    CATEGORIES.forEach(cat => {
      const d = cw.cat[cat] - (pw ? pw.cat[cat] : 0);
      if (Math.abs(d) > Math.abs(bestDelta)) { bestDelta = d; bestCat = cat; }
    });
    // largest single driver entity within that category
    const curByEnt = groupSum(cw.events.filter(e => e.category === bestCat), e => e.entity);
    const driver = curByEnt[0];
    // timing vs volume: did total category 13-wk sum change? if ~same → timing
    const curSum = current.weeks.reduce((s, x) => s + x.cat[bestCat], 0);
    const priSum = prior.weeks.reduce((s, x) => s + x.cat[bestCat], 0);
    const isTiming = Math.abs(curSum - priSum) < Math.abs(bestDelta) * 0.5;
    const dir = w.delta < 0 ? 'down' : 'up';
    const driverName = driver ? driver.key : 'multiple counterparties';
    let s = `Week ${w.week} net cash revised ${dir} ${fmtM(Math.abs(w.delta))} (${fmtPct(w.pct)}) vs. prior. `;
    s += `Primary driver: ${driverName} (${CAT_LABEL[bestCat]}, ${fmtM(Math.abs(driver ? driver.value : bestDelta))}) — `;
    s += isTiming ? `timing change only (same cash, different week), no credit concern.` : `volume change (cash ${dir === 'up' ? 'added to' : 'removed from'} the forecast).`;
    // consecutive-cycle structural flag
    if (driver && prevDrivers[driver.key]) {
      s += ` ⚠ ${driver.key} has driven variance in ${prevDrivers[driver.key] + 1} consecutive cycles — possible structural change in payment behavior.`;
    }
    notes.push({ week: w.week, category: bestCat, driver: driverName, isTiming, text: s });
  });
  return notes;
}

/* aggregate confidence mix for a forecast (for sensitivity readout) */
function confidenceMix(forecast) {
  const m = { High: 0, Medium: 0, Low: 0 };
  forecast.events.forEach(e => { m[e.confidence] += Math.abs(e.amount); });
  const tot = m.High + m.Medium + m.Low || 1;
  return { High: m.High / tot, Medium: m.Medium / tot, Low: m.Low / tot, totals: m };
}
