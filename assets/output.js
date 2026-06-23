/* =====================================================================
 * output.js  —  Layer 5 (Output Layer)
 * Excel workbook (multi-tab SpreadsheetML, opens in Excel — no deps),
 * JSON / API feed, and versioning / changelog (localStorage).
 * ===================================================================== */

/* ----------------------------- File download ----------------------------- */
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

/* ----------------------------- SpreadsheetML (Excel) ----------------------------- */
// Builds a real multi-worksheet .xls (SpreadsheetML 2003 XML) that Excel opens natively.
const XML_HEAD = '<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n' +
  '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"' +
  ' xmlns:o="urn:schemas-microsoft-com:office:office"' +
  ' xmlns:x="urn:schemas-microsoft-com:office:excel"' +
  ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n';

const XML_STYLES = `<Styles>
  <Style ss:ID="Default"><Font ss:FontName="Calibri" ss:Size="11"/></Style>
  <Style ss:ID="title"><Font ss:FontName="Calibri" ss:Size="16" ss:Bold="1" ss:Color="#000000"/></Style>
  <Style ss:ID="sub"><Font ss:FontName="Calibri" ss:Size="10" ss:Color="#5A5A5A"/></Style>
  <Style ss:ID="hdr"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#000000" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center"/></Style>
  <Style ss:ID="hdrG"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#000000"/><Interior ss:Color="#86BC25" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center"/></Style>
  <Style ss:ID="lbl"><Font ss:Bold="1"/></Style>
  <Style ss:ID="money"><NumberFormat ss:Format="_($* #,##0_);_($* (#,##0);_($* &quot;-&quot;_);_(@_)"/></Style>
  <Style ss:ID="moneyB"><Font ss:Bold="1"/><NumberFormat ss:Format="_($* #,##0_);_($* (#,##0);_($* &quot;-&quot;_);_(@_)"/></Style>
  <Style ss:ID="pct"><NumberFormat ss:Format="0.0%"/></Style>
  <Style ss:ID="crit"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#C8102E" ss:Pattern="Solid"/></Style>
  <Style ss:ID="high"><Font ss:Bold="1" ss:Color="#000000"/><Interior ss:Color="#FFC000" ss:Pattern="Solid"/></Style>
  <Style ss:ID="med"><Interior ss:Color="#FFF2CC" ss:Pattern="Solid"/></Style>
  <Style ss:ID="floor"><Font ss:Color="#C8102E"/></Style>
</Styles>\n`;

function xmlEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function cell(v, style, type) {
  const t = type || (typeof v === 'number' ? 'Number' : 'String');
  const sAttr = style ? ` ss:StyleID="${style}"` : '';
  const val = t === 'Number' ? (isFinite(v) ? v : 0) : xmlEsc(v);
  return `<Cell${sAttr}><Data ss:Type="${t}">${val}</Data></Cell>`;
}
function rowXml(cells) { return '<Row>' + cells.join('') + '</Row>'; }
function mcell(v, style) { return cell(v == null ? 0 : v, style || 'money', 'Number'); }

function worksheet(name, rows, cols) {
  const colXml = (cols || []).map(w => `<Column ss:Width="${w}"/>`).join('');
  const safe = name.replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31);
  return `<Worksheet ss:Name="${xmlEsc(safe)}">\n<Table>${colXml}\n` +
    rows.join('\n') + `\n</Table>\n</Worksheet>\n`;
}

function exportExcel(model) {
  const f = model.forecasts[model.scenario];
  const cfg = model.cfg;
  const sheets = [];

  /* ---- Summary tab: 13-week cash bridge ---- */
  {
    const rows = [];
    rows.push(rowXml([cell('13-Week Direct Cash Forecast — Summary', 'title')]));
    rows.push(rowXml([cell(`Scenario: ${f.scenarioLabel}  ·  Run ${model.runId}  ·  ${model.runDate}`, 'sub')]));
    rows.push(rowXml([cell('')]));
    const hdr = [cell('Line', 'hdrG')].concat(f.weeks.map(w => cell(w.label, 'hdrG')));
    rows.push(rowXml(hdr));
    const line = (label, fn, style) => rowXml([cell(label, 'lbl')].concat(f.weeks.map(w => mcell(fn(w), style || 'money'))));
    rows.push(line('Opening Balance', w => w.opening));
    rows.push(line('AR Collections', w => w.cat.AR));
    rows.push(line('AP Disbursements', w => w.cat.AP));
    rows.push(line('Payroll', w => w.cat.Payroll));
    rows.push(line('Debt Service', w => w.cat.Debt));
    rows.push(line('Capex', w => w.cat.Capex));
    rows.push(line('Net Cash Flow', w => w.net, 'moneyB'));
    rows.push(rowXml([cell('Closing Balance', 'lbl')].concat(f.weeks.map(w =>
      mcell(w.closing, w.closing < cfg.buffer ? 'crit' : (w.closing < cfg.covenant * 1.1 ? 'high' : 'moneyB'))))));
    rows.push(line('Operating Floor', () => cfg.buffer, 'floor'));
    rows.push(line('Covenant Minimum', () => cfg.covenant, 'floor'));
    sheets.push(worksheet('Summary', rows, [130].concat(f.weeks.map(() => 70))));
  }

  /* ---- AR Collections tab ---- */
  sheets.push(detailSheet('AR Collections', f, 'AR',
    ['Week', 'Date', 'Customer', 'Tier', 'Amount', 'DSO Adj', 'Confidence', 'Ref'],
    e => [e.week, e.isoDate, e.entity, e.subcategory, e.amount, (e.dsoAdj || '') + 'd', e.confidence, e.ref]));

  /* ---- AP Disbursements tab ---- */
  sheets.push(detailSheet('AP Disbursements', f, 'AP',
    ['Week', 'Date', 'Vendor', 'Terms', 'Amount', 'Timing', 'Early Pay', 'Confidence'],
    e => [e.week, e.isoDate, e.entity, e.subcategory, e.amount, e.controllable ? 'Discretionary' : 'Fixed', e.earlyPay ? 'Discount avail' : '', e.confidence]));

  /* ---- Payroll & Debt tab ---- */
  {
    const evs = f.events.filter(e => e.category === 'Payroll' || e.category === 'Debt').sort((a, b) => a.week - b.week);
    const rows = [rowXml([cell('Payroll & Debt — Fixed Obligations', 'title')]), rowXml([cell('')])];
    rows.push(rowXml(['Week', 'Date', 'Category', 'Entity', 'Detail', 'Amount', 'Confidence'].map(h => cell(h, 'hdr'))));
    evs.forEach(e => rows.push(rowXml([
      cell(e.week), cell(e.isoDate), cell(CAT_LABEL[e.category]), cell(e.entity), cell(e.subcategory), mcell(e.amount), cell(e.confidence)])));
    sheets.push(worksheet('Payroll & Debt', rows, [50, 90, 110, 150, 180, 110, 90]));
  }

  /* ---- Capex tab ---- */
  sheets.push(detailSheet('Capex', f, 'Capex',
    ['Week', 'Date', 'Project', 'Approval Status', 'Weighted Amount', 'Confidence', 'Prob'],
    e => [e.week, e.isoDate, e.entity, e.subcategory, e.amount, e.confidence, fmtPct(e.prob || 1, 0)]));

  /* ---- Variance tab ---- */
  {
    const v = model.variance;
    const rows = [rowXml([cell('Variance vs. Prior Forecast', 'title')])];
    if (!v.hasPrior) {
      rows.push(rowXml([cell('No prior forecast version — this is the baseline run.', 'sub')]));
    } else {
      rows.push(rowXml([cell('Category-Level Variance', 'lbl')]));
      rows.push(rowXml(['Category', 'Prior', 'Current', 'Delta', '% Var', 'Flagged'].map(h => cell(h, 'hdr'))));
      v.category.forEach(c => rows.push(rowXml([
        cell(c.label), mcell(c.prior), mcell(c.current), mcell(c.delta), cell(c.pct, 'pct', 'Number'), cell(c.flagged ? 'FLAG' : '', c.flagged ? 'high' : '')])));
      rows.push(rowXml([cell('')]));
      rows.push(rowXml([cell('Automated Commentary', 'lbl')]));
      v.commentary.forEach(c => rows.push(rowXml([cell('W' + c.week), cell(c.text)])));
    }
    sheets.push(worksheet('Variance', rows, [120, 100, 100, 100, 80, 80]));
  }

  /* ---- Risk Log tab ---- */
  {
    const rows = [rowXml([cell('Liquidity Risk Log', 'title')]), rowXml([cell('')])];
    rows.push(rowXml(['Severity', 'Week', 'Risk Type', 'Driver', 'Suggested Action'].map(h => cell(h, 'hdr'))));
    model.risks.forEach(r => {
      const st = r.severity === 'Critical' ? 'crit' : (r.severity === 'High' ? 'high' : 'med');
      rows.push(rowXml([cell(r.severity, st), cell('W' + r.week), cell(r.type), cell(r.driver), cell(r.action)]));
    });
    if (!model.risks.length) rows.push(rowXml([cell('No liquidity risk windows flagged.', 'sub')]));
    sheets.push(worksheet('Risk Log', rows, [80, 50, 140, 260, 320]));
  }

  /* ---- Raw Events tab ---- */
  {
    const rows = [rowXml([cell('Raw Cash Event Model', 'title')]), rowXml([cell('')])];
    rows.push(rowXml(['Week', 'Date', 'Category', 'Entity', 'Sub', 'Amount', 'Confidence', 'Override', 'Ref'].map(h => cell(h, 'hdr'))));
    f.events.slice().sort((a, b) => a.week - b.week).forEach(e => rows.push(rowXml([
      cell(e.week), cell(e.isoDate), cell(CAT_LABEL[e.category]), cell(e.entity), cell(e.subcategory),
      mcell(e.amount), cell(e.confidence), cell(e.override ? 'O' : ''), cell(e.ref || '')])));
    sheets.push(worksheet('Raw Events', rows, [50, 90, 100, 160, 180, 110, 90, 70, 90]));
  }

  const xml = XML_HEAD + XML_STYLES + sheets.join('') + '</Workbook>';
  download(`13week_cash_forecast_${model.scenario}_${model.runId}.xls`, xml, 'application/vnd.ms-excel');
}

function detailSheet(title, f, cat, headers, rowFn) {
  const evs = f.events.filter(e => e.category === cat).sort((a, b) => a.week - b.week);
  const rows = [rowXml([cell(title, 'title')]), rowXml([cell('')])];
  rows.push(rowXml(headers.map(h => cell(h, 'hdr'))));
  evs.forEach(e => {
    const vals = rowFn(e);
    rows.push(rowXml(vals.map((v, i) => (headers[i] || '').toLowerCase().includes('amount') ? mcell(v) : cell(v))));
  });
  // total
  const tot = evs.reduce((s, e) => s + e.amount, 0);
  rows.push(rowXml([cell('Total', 'lbl')].concat(headers.slice(1).map((h, i) =>
    h.toLowerCase().includes('amount') ? mcell(tot, 'moneyB') : cell('')))));
  return worksheet(title, rows, headers.map((h, i) => i === 0 ? 50 : (h.length > 8 ? 150 : 100)));
}

/* ----------------------------- JSON / API feed ----------------------------- */
function exportJSON(model) {
  const f = model.forecasts[model.scenario];
  const payload = {
    meta: { product: '13-Week Direct Cash Forecast Generator', runId: model.runId, runDate: model.runDate,
      scenario: model.scenario, generatedBy: model.cfg.runBy || 'system' },
    config: {
      forecastStart: isoDate(model.cfg.startDate), openingBalance: model.cfg.openingBalance,
      operatingFloor: model.cfg.buffer, covenantMinimum: model.cfg.covenant, thresholds: model.cfg.thresholds,
    },
    scenarios: Object.keys(model.forecasts).reduce((acc, sc) => {
      const ff = model.forecasts[sc];
      acc[sc] = {
        label: ff.scenarioLabel, openingBalance: ff.openingBalance, closingBalance: ff.closingBalance,
        netChange: ff.netChange,
        weeks: ff.weeks.map(w => ({ week: w.week, label: w.label, opening: w.opening, inflow: w.inflow,
          outflow: w.outflow, net: w.net, closing: w.closing, byCategory: w.cat, sigma: w.bandSigma })),
      };
      return acc;
    }, {}),
    riskMetadata: model.risks,
    variance: model.variance,
    events: f.events.map(e => ({ week: e.week, date: e.isoDate, category: e.category, entity: e.entity,
      subcategory: e.subcategory, amount: e.amount, confidence: e.confidence, confidenceScore: e.confidenceScore,
      controllable: e.controllable, override: e.override, ref: e.ref })),
  };
  download(`13week_cash_forecast_${model.scenario}_${model.runId}.json`, JSON.stringify(payload, null, 2), 'application/json');
}

/* ----------------------------- Versioning / changelog ----------------------------- */
const STORE_KEY = 'cf13_versions';
function loadVersions() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch (e) { return []; }
}
function saveVersion(snap) {
  const v = loadVersions();
  v.push(snap);
  // keep last 25
  while (v.length > 25) v.shift();
  try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch (e) {}
  return v;
}
function priorVersion() {
  const v = loadVersions();
  return v.length ? v[v.length - 1] : null;
}
function clearVersions() { try { localStorage.removeItem(STORE_KEY); } catch (e) {} }

// compact snapshot stored per run (for variance diffing)
function makeSnapshot(model) {
  const f = model.forecasts[model.scenario];
  return {
    runId: model.runId, runDate: model.runDate, scenario: model.scenario,
    runBy: model.cfg.runBy, inputFiles: model.cfg.inputFiles || 'sample data',
    openingBalance: model.cfg.openingBalance,
    weeks: f.weeks.map(w => ({ week: w.week, label: w.label, net: w.net, closing: w.closing, opening: w.opening, cat: Object.assign({}, w.cat) })),
    lastDrivers: model.driverHistory || {},
  };
}
