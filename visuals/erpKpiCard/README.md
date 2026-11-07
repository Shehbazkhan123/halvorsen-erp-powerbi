# ERP KPI Card (GSAP)

A Power BI custom visual: a KPI card whose headline number counts up, whose comparison badge pops in, and whose sparkline draws itself. Hovering shows a readout that follows the line. All animation is done with [GSAP](https://gsap.com) and bundled into the package, so the visual makes no web requests.

## Import into Power BI Desktop

1. Open `ERP-Portfolio.pbip`.
2. In the **Visualizations** pane, click **…** (Get more visuals) > **Import a visual from a file**.
3. Pick the `.pbiviz` in `visuals/erpKpiCard/dist/` (currently `erpKpiCardDB2F16D1C4D7440ABE6A7786CEC020DC.1.0.1.0.pbiviz`).
4. The **ERP KPI Card (GSAP)** icon appears in the Visualizations pane.

The import is saved with the report. To pick up a rebuilt package, bump `version` in `pbiviz.json` (both places), run `npm run package`, and import the new file. Desktop replaces the old copy, and cards already on the page keep their fields and formatting.

## Fields

| Well | What to put there | Example from the ERP model |
|---|---|---|
| **Value** | The KPI measure (required) | `[Revenue]`, `[Gross Margin %]`, `[Net Income]` |
| **Comparison** | Target, budget or prior year (optional) | `[Revenue PY]`, `[Net Income Budget]` |
| **Trend axis** | A period column (optional) | `Date[Year Month]` |

- **With a trend axis**, the sparkline shows the history and **Format > Value > Headline value** decides the big number:
  - *Latest period* (default): the last period that has data, like the built-in KPI visual. Trailing empty periods (e.g. Nov–Dec 2026) are skipped.
  - *Sum of periods*: the total of all periods shown, e.g. 2026 Revenue = $39.5M vs PY $35.3M. **Only for additive measures** (revenue, spend, units, net income). Not for %, averages or distinct counts.
  - *Average of periods*: the mean of the periods shown, a fair choice for % measures such as margin.
- **Without a trend axis**, it's a plain card. The content centers and the number grows into the free space. Use YTD measures for period totals, e.g. `[Revenue YTD]` vs `[Revenue PY YTD]`.
- Measures formatted as `%` show change in **percentage points**; everything else shows **% change**.

## Format pane

- **Title**: text (defaults to the Value field name), size, color.
- **Value**: headline value (latest / sum / average), size (shrinks automatically on small tiles; 1.5x larger when there's no sparkline), color, display units (Auto picks K/M/B), decimal places for scaled units.
- **Comparison**: label (defaults to "vs <Comparison field>"), **Higher is better** (turn off for cost KPIs like spend or expenses), favorable/unfavorable colors.
- **Sparkline**: line color, area fill, pulsing latest point.
- **Animation**: on/off, duration, easing (Smooth, Snappy, Overshoot, Elastic, Linear).

Animations replay only when the numbers change (slicers, filters, cross-highlighting), not on resize or format edits. They are off for viewers who set "reduce motion" in their OS. High-contrast themes are respected.

## Develop

```bash
npm install
npm run package        # builds dist/*.pbiviz
node harness/serve.mjs # open http://localhost:8181 to test against sample ERP data with a mocked host
```

Notes:
- `powerbi-visuals-utils-formattingutils` is pinned to **6.1.2**: 7.0.0 ships ES-module locale files that the pbiviz 7.2.1 webpack loader can't parse.
- `pbiviz start` (live dev server) needs a developer certificate, and the certificate generator needs PowerShell 7 (`pwsh`). Packaging does not.
- `supportUrl` in `pbiviz.json` is a placeholder (`mailto:`). Point it at the GitHub repo once there is one.
