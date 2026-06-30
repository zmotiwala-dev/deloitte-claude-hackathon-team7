/* =====================================================================
 * claude.js — Anthropic Claude AI integration
 * Adds AI-generated variance commentary, risk narrative, and chat Q&A.
 * ===================================================================== */

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_KEY_STORE = 'clf_api_key';

function claudeGetKey()   { return localStorage.getItem(CLAUDE_KEY_STORE) || ''; }
function claudeSetKey(k)  { localStorage.setItem(CLAUDE_KEY_STORE, k.trim()); }
function claudeClearKey() { localStorage.removeItem(CLAUDE_KEY_STORE); }
function claudeHasKey()   { return !!claudeGetKey(); }

async function claudeCall(system, messages, maxTokens) {
  const key = claudeGetKey();
  if (!key) throw new Error('No Anthropic API key configured. Add it in Settings → Claude AI.');

  const resp = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens || 800,
      system,
      messages,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `Claude API error (${resp.status})`);
  }

  const data = await resp.json();
  return data.content[0].text;
}

const TREASURY_SYSTEM = `You are a senior treasury analyst at Deloitte. You produce concise, numbers-grounded cash-flow commentary for CFOs and treasury teams. Use specific dollar amounts and week references (W1–W13). Write in plain prose — no bullet points unless asked. Be direct: avoid hedging phrases like "it appears" or "it seems". Keep responses tight and actionable.`;

function claudeBuildCtx(model) {
  const f = model.forecasts[model.scenario];
  const cfg = model.cfg;
  return {
    scenario: model.scenario,
    runId: model.runId,
    opening: cfg.openingBalance,
    floor: cfg.buffer,
    covenant: cfg.covenant,
    weeks: f.weeks.map(w => ({
      week: w.week,
      label: w.label.split('·')[0].trim(),
      inflow: w.inflow,
      outflow: w.outflow,
      net: w.net,
      closing: w.closing,
      ar: w.cat.AR,
      ap: w.cat.AP,
      payroll: w.cat.Payroll,
      debt: w.cat.Debt,
      capex: w.cat.Capex,
    })),
    risks: model.risks,
    variance: model.variance,
    netChange: f.netChange,
    closing: f.closingBalance,
  };
}

function cM(v) { return '$' + (Math.abs(v) / 1e6).toFixed(2) + 'M'; }

/* ---- Generate AI variance commentary (Layer 4) ---- */
async function claudeVarianceCommentary(model) {
  const ctx = claudeBuildCtx(model);
  const v = ctx.variance;
  const flaggedWeeks = v.hasPrior ? v.weekly.filter(w => w.flagged) : [];
  const flaggedCats  = v.hasPrior ? v.category.filter(c => c.flagged) : [];

  let dataBlock = `FORECAST (${ctx.scenario}): Opening ${cM(ctx.opening)} · Floor ${cM(ctx.floor)} · Covenant ${cM(ctx.covenant)} · W13 close ${cM(ctx.closing)} (net ${ctx.netChange >= 0 ? '+' : ''}${cM(ctx.netChange)})

RISK WINDOWS (${ctx.risks.length}):
${ctx.risks.map(r => `[${r.severity}] W${r.week} ${r.type} — closing ${cM(r.closing)}${r.shortfall > 0 ? ', shortfall ' + cM(r.shortfall) : ''}. Driver: ${r.driver}`).join('\n') || 'None.'}`;

  if (flaggedWeeks.length) {
    dataBlock += `\n\nFLAGGED WEEKLY VARIANCES vs. PRIOR:\n${flaggedWeeks.map(w =>
      `W${w.week}: ${w.delta >= 0 ? '+' : ''}${cM(w.delta)} (${(w.pct * 100).toFixed(0)}%) — prior ${cM(w.prior)} → current ${cM(w.current)}`).join('\n')}`;
  }
  if (flaggedCats.length) {
    dataBlock += `\n\nFLAGGED CATEGORY SHIFTS:\n${flaggedCats.map(c =>
      `${c.label}: ${c.delta >= 0 ? '+' : ''}${cM(c.delta)} (${(c.pct * 100).toFixed(0)}%)`).join('\n')}`;
  }

  const task = flaggedWeeks.length
    ? `Write 1–2 sentence commentary for each flagged week, attributing movements to specific drivers. Then write a 2-sentence executive summary paragraph at the end.`
    : `This is the baseline run — no prior version to compare. Write a 3-sentence narrative covering: (1) the key risk week and why it matters, (2) the primary outflow driver, (3) the recommended treasury action.`;

  return claudeCall(TREASURY_SYSTEM, [{ role: 'user', content: `${dataBlock}\n\nTask: ${task}` }], 700);
}

/* ---- Generate AI risk narrative (CFO briefing + management summary) ---- */
async function claudeRiskNarrative(model) {
  const ctx = claudeBuildCtx(model);
  const weekLines = ctx.weeks.map(w => `W${w.week}: ${cM(w.closing)}`).join(' | ');

  const prompt = `FORECAST: ${ctx.scenario} · Opening ${cM(ctx.opening)} · Floor ${cM(ctx.floor)} · Covenant ${cM(ctx.covenant)} · Net 13-wk ${ctx.netChange >= 0 ? '+' : ''}${cM(ctx.netChange)} · W13 close ${cM(ctx.closing)}

WEEKLY CLOSING BALANCES: ${weekLines}

RISK WINDOWS (${ctx.risks.length}):
${ctx.risks.map(r => `[${r.severity}] W${r.week} ${r.type}: ${r.definition} Driver: ${r.driver}. Action: ${r.action}`).join('\n\n') || 'No risk windows detected. All 13 weeks are above the operating floor and covenant thresholds.'}

Task: Write a risk narrative in two clearly labeled parts:
CFO BRIEFING: 4 sentences. Lead with the most critical issue by name, dollar amount, and week. Name the primary driver. Close with a specific recommended action.
MANAGEMENT SUMMARY: 1 sentence suitable for a board cover letter or lender compliance certificate.`;

  return claudeCall(TREASURY_SYSTEM, [{ role: 'user', content: prompt }], 500);
}

/* ---- "Brief me" — 3-sentence CFO dashboard briefing ---- */
async function claudeBriefMe(model) {
  const ctx = claudeBuildCtx(model);
  const minWk = ctx.weeks.reduce((a, w) => w.closing < a.closing ? w : a, ctx.weeks[0]);
  const prompt = `FORECAST: ${ctx.scenario} · Opening ${cM(ctx.opening)} · Floor ${cM(ctx.floor)} · Covenant ${cM(ctx.covenant)}
Net 13-week: ${ctx.netChange >= 0 ? '+' : ''}${cM(ctx.netChange)} · W13 close: ${cM(ctx.closing)}
Tightest week: W${minWk.week} at ${cM(minWk.closing)}${minWk.closing < ctx.floor ? ` — BELOW FLOOR, shortfall ${cM(ctx.floor - minWk.closing)}` : ''}
Risks (${ctx.risks.length}): ${ctx.risks.map(r => `[${r.severity}] W${r.week} ${r.type}: ${r.driver}`).join('; ') || 'None'}

Task: Write exactly 3 sentences — no headers, no bullets, no preamble. Sentence 1: current cash position and 13-week outlook with specific dollar amounts. Sentence 2: the most critical risk by week and driver. Sentence 3: one specific recommended action the CFO should take or approve this week.`;
  return claudeCall(TREASURY_SYSTEM, [{ role: 'user', content: prompt }], 280);
}

/* ---- Per-risk specific action recommendation ---- */
async function claudeRiskAction(riskIdx, model) {
  const ctx = claudeBuildCtx(model);
  const risk = ctx.risks[riskIdx];
  if (!risk) return 'Risk not found.';
  const wk = ctx.weeks.find(w => w.week === risk.week) || {};
  const prompt = `FORECAST: ${ctx.scenario} · Opening ${cM(ctx.opening)} · Floor ${cM(ctx.floor)}

RISK: [${risk.severity}] W${risk.week} — ${risk.type}
Definition: ${risk.definition}
Driver: ${risk.driver}
Closing: ${cM(risk.closing)}${risk.shortfall > 0 ? ` (${cM(risk.shortfall)} shortfall vs. floor)` : ''}
Week cash detail — Inflow: ${cM(wk.inflow || 0)} · AR: ${cM(wk.ar || 0)} · AP: ${cM(Math.abs(wk.ap || 0))} · Payroll: ${cM(Math.abs(wk.payroll || 0))} · Debt: ${cM(Math.abs(wk.debt || 0))}

Task: Three bullets only (use • character):
• Root cause — one sentence on what is mechanically causing this shortfall
• Immediate action — one concrete thing the treasurer can do or initiate this week
• Leading indicator — the single number to watch that will confirm this is improving`;
  return claudeCall(TREASURY_SYSTEM, [{ role: 'user', content: prompt }], 380);
}

/* ---- Rank all risks — prioritized playbook ---- */
async function claudeRankRisks(model) {
  const ctx = claudeBuildCtx(model);
  if (!ctx.risks.length) return 'No risk windows detected — all 13 weeks remain above the operating floor and covenant thresholds.';
  const prompt = `FORECAST: ${ctx.scenario} · Opening ${cM(ctx.opening)} · Floor ${cM(ctx.floor)} · W13 close ${cM(ctx.closing)}

RISK WINDOWS:
${ctx.risks.map((r, i) => `${i + 1}. [${r.severity}] W${r.week} ${r.type}: ${r.driver}. Closing ${cM(r.closing)}${r.shortfall > 0 ? `, shortfall ${cM(r.shortfall)}` : ''}. Suggested: ${r.action}`).join('\n')}

Task: Lead with one sentence naming the single highest-priority risk and why it comes first. Then one sentence per remaining risk in descending urgency, each naming what to do. Total response under 120 words.`;
  return claudeCall(TREASURY_SYSTEM, [{ role: 'user', content: prompt }], 380);
}

/* ---- Lender package cover note ---- */
async function claudeCoverNote(model) {
  const ctx = claudeBuildCtx(model);
  const prompt = `FORECAST: ${ctx.scenario} · Opening ${cM(ctx.opening)} · Floor ${cM(ctx.floor)} · Covenant ${cM(ctx.covenant)}
Net 13-week: ${ctx.netChange >= 0 ? '+' : ''}${cM(ctx.netChange)} · W13 close: ${cM(ctx.closing)}
Risk windows: ${ctx.risks.map(r => `[${r.severity}] W${r.week} ${r.type}: ${r.driver}`).join('; ') || 'None flagged — all weeks above floor and covenant thresholds'}

Task: Write a 2-paragraph lender package cover note. Paragraph 1: state the forecast period, opening balance, and W13 projected close. Name the most significant risk window if any. Paragraph 2: confirm the data sources included (AR aging, AP aging, payroll, debt service, capex), affirm the normalization methodology is transparent and auditable, and invite questions. Formal but plain language — this accompanies a bank submission. No bullets.`;
  return claudeCall(TREASURY_SYSTEM, [{ role: 'user', content: prompt }], 380);
}

/* ---- Explain a specific week ---- */
async function claudeExplainWeek(weekNum, model) {
  const ctx = claudeBuildCtx(model);
  const wk = ctx.weeks.find(w => w.week === weekNum);
  if (!wk) return 'Week data not found.';
  const risk = ctx.risks.find(r => r.week === weekNum);
  const prompt = `FORECAST: ${ctx.scenario} · Opening ${cM(ctx.opening)} · Floor ${cM(ctx.floor)}

WEEK ${weekNum}:
Inflow: ${cM(wk.inflow)} (AR: ${cM(wk.ar)})
Outflow: ${cM(Math.abs(wk.outflow))} (AP: ${cM(Math.abs(wk.ap))} · Payroll: ${cM(Math.abs(wk.payroll))} · Debt: ${cM(Math.abs(wk.debt))} · Capex: ${cM(Math.abs(wk.capex))})
Net: ${cM(wk.net)} · Closing: ${cM(wk.closing)}
${risk ? `RISK FLAG: [${risk.severity}] ${risk.type} — ${risk.definition} Driver: ${risk.driver}` : 'No risk flag this week.'}

Task: 3 sentences. (1) What is driving this week's net cash position — the largest inflow and outflow items and why the net is what it is. (2) If there is a risk flag, why this closing balance matters for lender confidence or covenant compliance; otherwise, how this week compares to adjacent weeks. (3) What the treasury team should monitor or act on in the days before this week.`;
  return claudeCall(TREASURY_SYSTEM, [{ role: 'user', content: prompt }], 330);
}

/* ---- Answer free-form questions about the active forecast ---- */
async function claudeAskQuestion(question, model, history) {
  const ctx = claudeBuildCtx(model);
  const totalDebt    = ctx.weeks.reduce((s, w) => s + Math.abs(w.debt), 0);
  const totalPayroll = ctx.weeks.reduce((s, w) => s + Math.abs(w.payroll), 0);
  const totalCapex   = ctx.weeks.reduce((s, w) => s + Math.abs(w.capex), 0);
  const minWk = ctx.weeks.reduce((a, w) => w.closing < a.closing ? w : a, ctx.weeks[0]);

  const systemWithCtx = `${TREASURY_SYSTEM}

ACTIVE FORECAST — use this data to answer all questions:
Scenario: ${ctx.scenario} | Run: ${ctx.runId}
Opening: ${cM(ctx.opening)} | Floor: ${cM(ctx.floor)} | Covenant: ${cM(ctx.covenant)}
Net 13-week: ${ctx.netChange >= 0 ? '+' : ''}${cM(ctx.netChange)} | W13 close: ${cM(ctx.closing)}
Tightest week: W${minWk.week} at ${cM(minWk.closing)}${minWk.closing < ctx.floor ? ' — BELOW FLOOR (shortfall ' + cM(ctx.floor - minWk.closing) + ')' : ''}
Weekly closing: ${ctx.weeks.map(w => `W${w.week}=${cM(w.closing)}`).join(', ')}
13-wk outflow totals: Debt ${cM(totalDebt)} | Payroll ${cM(totalPayroll)} | Capex ${cM(totalCapex)}
Risk flags: ${ctx.risks.length ? ctx.risks.map(r => `[${r.severity}] W${r.week} ${r.type}`).join('; ') : 'None'}
${ctx.risks.length ? ctx.risks.map(r => `  W${r.week} ${r.type}: ${r.definition} ${r.action}`).join('\n') : ''}`;

  const msgs = [
    ...(history || []).map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: question },
  ];

  return claudeCall(systemWithCtx, msgs, 500);
}
