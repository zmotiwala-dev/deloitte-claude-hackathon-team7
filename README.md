# 13-Week Direct Cash Forecast Generator

A web application that ingests AR aging, AP aging, payroll, debt service and capex
commitments and produces a rolling **direct-method 13-week cash forecast** — auto-drafting
variance commentary versus the prior forecast and flagging liquidity-risk windows.
It replaces the 4–8 hours per week corporate treasurers spend building this manually in Excel.

Built for the Claude hackathon to the attached specification, implementing **all five layers**.

> *Together makes progress* — Deloitte-branded (June 2025 brand platform).

---

## Quick start

**No build, no install, no Node/Python required.** The app is plain HTML/CSS/JS.

- **Easiest:** double-click `index.html` to open it in any modern browser.
- **Or serve it** (enables full `localStorage` versioning) with the bundled static server:
  ```powershell
  powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8123
  # then open http://localhost:8123/
  ```

Click **► Run Forecast** (or *Load sample data & run forecast* on the dashboard) to run the
full pipeline against the built-in sample treasury book. Then walk the left-nav layers 1→5.

---

## The five layers

| Layer | Module | What it does |
|------|--------|--------------|
| **1 · Data Ingestion** | `assets/app.js` (`INGEST`) | Accepts the five standardized inputs as CSV (drag-drop or upload) with fuzzy header auto-detection, plus one-click sample data. |
| **2 · Normalization** | `assets/engine.js` (`normalize`) | Transforms all five inputs into a single unified cash-event model — every event carries **date, amount, category, confidence score**. DSO-adjusted AR curves (70/20/10 fallback + per-tier offset), AP terms + early-pay flags, payroll uplift, full debt amortization, and approval-status-weighted capex. |
| **3 · Forecast Engine** | `assets/engine.js` (`buildForecast`) | Builds the week-by-week direct-method cash-position matrix (W1–W13), seeds each week with the prior week's close, overlays the operating floor, and runs three scenarios (Base / Downside / Upside). |
| **4 · Variance & Risk** | `assets/engine.js` (`computeVariance`, `detectRisks`) | Version-stamps each run, diffs vs. the prior version (category / weekly / ending thresholds), drafts plain-language commentary with driver attribution + timing-vs-volume + consecutive-cycle detection, and scans for the four liquidity-risk classes with a ±1σ confidence band. |
| **5 · Output Layer** | `assets/output.js` | Generates an 8-tab Excel workbook, a print-ready PDF executive summary, a lender/agent covenant package, and a JSON/API feed — all from the same data model. Full version history + changelog. |

### File map
```
index.html              app shell (sidebar nav, top bar, view containers)
assets/styles.css        Deloitte-branded styling
assets/data.js           date/CSV/money utilities + sample-data generator
assets/engine.js         Layers 2, 3, 4 (normalization, forecast, variance & risk)
assets/output.js         Layer 5 (Excel / JSON / versioning)
assets/app.js            Layer 1 ingestion + UI orchestration + SVG charts + PDF views
sample_data/*.csv        fixed-date illustrations of the five input formats
serve.ps1                tiny static file server (no Node/Python needed)
```

---

## Key modeling rules (per spec)

- **AR → collections:** DSO-adjusted base date per customer tier (T1 +4d, T2 +9d, T3 +16d),
  then a 70% / 20% / 10% curve at +0 / +7 / +14 days, rolled to weekly buckets. Confidence: Medium.
- **AP → disbursements:** payment date = invoice + terms; early-pay (2/10) discounts flagged;
  discretionary vs. fixed timing tagged.
- **Payroll:** 100% of gross on the exact pay date (no smoothing) + employer tax/benefits uplift. Confidence: High.
- **Debt service:** full amortization schedule, principal/interest split. Confidence: High.
- **Capex:** approval-status weighting — *Approved + PO* = 100%/High; *pending PO* = 60%/Med, spread ±2 weeks;
  *in approval* = 25%/Low, excluded from base (sensitivity only).
- **Scenarios:** Downside delays collections +7d and includes medium capex at 80%; Upside pulls collections −3d and excludes low-confidence capex.
- **Risk windows:** Cash Floor Breach (Critical), Covenant Proximity <110% (High), Concentration >25% of weekly inflows (Medium), Debt Stack Cliff >30% of weekly inflows (Medium).
- **Thresholds** (all configurable in Settings): Category >5% / >$250K · Weekly >$500K / >10% · Ending >$1M / >15%.

## Demo narrative (sample data)

Opening balance **$8.0M**, operating floor **$5.0M**, covenant minimum **$4.0M**. The book is healthy
through W6, then **W7 craters to ~$3.7M** — a **Critical** cash-floor breach driven by a $6.0M term-loan
balloon landing in a historically light (July 4) AR collection week — before recovering above the floor.
Run the forecast twice (or switch scenarios) to populate the version-over-version variance bridge and commentary.

---

## Roadmap (from the spec)

- **Phase 1 (this MVP):** CSV/Excel ingestion → normalized model → Excel + PDF output.
- **Phase 2:** Direct ERP API connectors (NetSuite, SAP, Oracle).
- **Phase 3:** TMS integration (Kyriba, GTreasury) for real-time bank-balance seeding + revolver-draw recommendations.
- **Phase 4:** ML-enhanced collection curves, continuously retrained on actual vs. forecast payment behavior.

---

## Notes

- Excel export uses the SpreadsheetML 2003 XML format (`.xls`) so a real **multi-tab workbook**
  opens natively in Excel with **zero external libraries** — fully offline.
- PDF outputs use the browser's print-to-PDF (the dashboard opens a print-optimized one-page view).
- The **Load sample data** button generates data relative to the current week so the 13-week window
  always populates; the static `sample_data/*.csv` files are fixed-date illustrations of the input formats.
