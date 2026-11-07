// Generates the ERP-Portfolio report (PBIR) from the layout spec below:
// designed page backgrounds (SVG -> PNG), pages, visuals, dark theme, and the two embedded GSAP custom visuals.
//
//   node tools/build-report-pages.mjs            write the report (close Power BI Desktop first)
//   node tools/build-report-pages.mjs --preview  only render the page backgrounds to tools/out/
//
// Re-running replaces ALL pages in the report, including manual edits made in Desktop.
import { readFile, writeFile, mkdir, rm, readdir, copyFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const PREVIEW = process.argv.includes("--preview");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reportDir = join(root, "ERP-Portfolio.Report");
const defDir = join(reportDir, "definition");
const tablesDir = join(root, "ERP-Portfolio.SemanticModel", "definition", "tables");

const CUSTOM_VISUALS = [
    { guid: "erpKpiCardDB2F16D1C4D7440ABE6A7786CEC020DC", dist: join(root, "visuals", "erpKpiCard", "dist") },
    { guid: "insightText9B2CAF377804430CB0623EF097A0FD30", dist: join(root, "visuals", "insightText", "dist") }
];
const [KPI_VISUAL, INSIGHT_VISUAL] = CUSTOM_VISUALS.map(v => v.guid);
const THEME_FILE = "ERP-Portfolio-Theme.json";
const SCHEMA_BASE = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition";
const SCHEMA = {
    page: `${SCHEMA_BASE}/page/2.0.0/schema.json`,
    pages: `${SCHEMA_BASE}/pagesMetadata/1.0.0/schema.json`,
    visual: `${SCHEMA_BASE}/visualContainer/2.4.0/schema.json`
};

// ---------- design system ----------
const PAGE_W = 1280, PAGE_H = 720;
const RAIL_W = 72, X0 = 88, X1 = PAGE_W - 16, W = X1 - X0, GAP = 16;
const INSIGHT = { y: 76, h: 52 };
const KPI = { y: 140, h: 140 };
const MAIN = { y: KPI.y + KPI.h + GAP, h: PAGE_H - 16 - (KPI.y + KPI.h + GAP) };
const SIDE_W = 180;
const C = {
    bg: "#0B1220", rail: "#0A0F1C", panel: "#111A2E",
    text: "#F8FAFC", body: "#CBD5E1", muted: "#94A3B8", dim: "#64748B", slate: "#475569",
    good: "#34D399", bad: "#FB7185"
};
const BRAND = "Halvorsen Supply Co."; // fictional company
const AS_OF = "Fictional company · data as of 31 Oct 2026";

// 24x24 line icons (stroke only), drawn in the sidebar.
const ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>',
    trend: '<polyline points="3,17 9,11 13,15 21,7"/><polyline points="15,7 21,7 21,13"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5L12 12l8-4.5"/><path d="M12 12v9"/>',
    bars: '<path d="M5 20v-9"/><path d="M11 20V5"/><path d="M17 20v-7"/><path d="M3 20h18"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.8"/><path d="M16 14.2c3 .3 5.5 2.4 5.5 5.8"/>'
};

// ---------- expression helpers ----------
const lit = v => ({ expr: { Literal: { Value: v } } });
const str = s => lit(`'${String(s).replace(/'/g, "''")}'`);
const bool = b => lit(b ? "true" : "false");
const num = n => lit(`${n}D`);
const color = c => ({ solid: { color: str(c) } });

const usedFields = new Set();
const col = (table, name) => { usedFields.add(`${table}|${name}`); return { kind: "Column", table, name }; };
const msr = name => { usedFields.add(`_Measures|${name}`); return { kind: "Measure", table: "_Measures", name }; };
const fieldExpr = f => ({ [f.kind]: { Expression: { SourceRef: { Entity: f.table } }, Property: f.name } });
const qref = f => `${f.table}.${f.name}`;
const proj = f => ({ field: fieldExpr(f), queryRef: qref(f), nativeQueryRef: f.name, ...(f.kind === "Column" ? { active: true } : {}) });
function queryState(roles) {
    const qs = {};
    for (const [role, fields] of Object.entries(roles)) {
        const list = (fields || []).filter(Boolean);
        if (list.length) qs[role] = { projections: list.map(proj) };
    }
    return qs;
}
const sortBy = (f, direction) => ({ sort: [{ field: fieldExpr(f), direction }], isDefaultSort: true });

function containerTitle(title) {
    const text = typeof title === "string" ? str(title) : { expr: fieldExpr(title) };
    return { title: [{ properties: { show: bool(true), text } }] };
}
const hiddenTitle = () => ({ title: [{ properties: { show: bool(false) } }] });
const bare = () => ({
    ...hiddenTitle(),
    background: [{ properties: { show: bool(false) } }],
    border: [{ properties: { show: bool(false) } }]
});
const seriesColors = map => ({
    dataPoint: Object.entries(map).map(([key, c]) => ({ properties: { fill: color(c) }, selector: { metadata: key } }))
});
const singleColor = c => ({ dataPoint: [{ properties: { fill: color(c) } }] });

// ---------- visual builders ----------
const container = (name, position, visual) => ({ $schema: SCHEMA.visual, name, position, visual });
const run = (value, size, weight, colorHex) => ({ value, textStyle: { fontSize: size, ...(weight ? { fontWeight: weight } : {}), color: colorHex } });

const textbox = (name, pos, paragraphs) => container(name, pos, {
    visualType: "textbox",
    objects: { general: [{ properties: { paragraphs } }] },
    visualContainerObjects: bare(),
    drillFilterOtherVisuals: true
});

const navButton = (name, pos, targetPage, tooltip) => container(name, pos, {
    visualType: "actionButton",
    objects: {
        icon: [{ properties: { shapeType: str("blank") } }],
        text: [{ properties: { show: bool(false) } }],
        fill: [{ properties: { show: bool(false) } }],
        outline: [{ properties: { show: bool(false) } }]
    },
    visualContainerObjects: {
        ...bare(),
        visualLink: [{ properties: { show: bool(true), type: str("PageNavigation"), navigationSection: str(targetPage), tooltip: str(tooltip) } }]
    },
    drillFilterOtherVisuals: true
});

function slicer(name, pos, field, defaultValue, syncGroupName) {
    const literal = typeof defaultValue === "number" ? `${defaultValue}L` : `'${String(defaultValue).replace(/'/g, "''")}'`;
    return container(name, pos, {
        visualType: "slicer",
        query: { queryState: queryState({ Values: [field] }) },
        objects: {
            data: [{ properties: { mode: str("Dropdown") } }],
            selection: [{ properties: { singleSelect: bool(true) } }],
            general: [{
                properties: {
                    filter: {
                        filter: {
                            Version: 2,
                            From: [{ Name: "s", Entity: field.table, Type: 0 }],
                            Where: [{ Condition: { In: {
                                Expressions: [{ Column: { Expression: { SourceRef: { Source: "s" } }, Property: field.name } }],
                                Values: [[{ Literal: { Value: literal } }]]
                            } } }]
                        }
                    }
                }
            }]
        },
        visualContainerObjects: hiddenTitle(),
        syncGroup: { groupName: syncGroupName, fieldChanges: true, filterChanges: true },
        drillFilterOtherVisuals: true
    });
}

// headline: optional whole-period measure (ratios, distinct counts) shown instead of summing/averaging the monthly points.
function kpiCard(name, pos, accent, { value, comparison, headline, axis = col("Date", "Year Month"), mode = "latest", label }) {
    const objects = {
        title: [{ properties: { fontSize: num(9), color: color(C.muted) } }],
        valueText: [{ properties: {
            fontSize: num(24), color: color(C.text),
            ...(axis ? { headlineMode: str(mode) } : {}),
            // Pass the measure's format explicitly: Power BI does not always hand it to custom visuals.
            ...(FORMATS[value.name] ? { valueFormat: str(FORMATS[value.name]) } : {})
        } }],
        comparisonText: [{ properties: { labelColor: color(C.muted), goodColor: color(C.good), badColor: color(C.bad), ...(label ? { label: str(label) } : {}) } }],
        sparkline: [{ properties: { color: color(accent) } }]
    };
    return container(name, pos, {
        visualType: KPI_VISUAL,
        query: {
            queryState: queryState({
                category: axis ? [axis] : [], value: [value],
                comparison: comparison ? [comparison] : [],
                headline: headline && axis ? [headline] : []
            }),
            ...(axis ? { sortDefinition: sortBy(axis, "Ascending") } : {})
        },
        objects,
        visualContainerObjects: bare(),
        drillFilterOtherVisuals: true
    });
}

const insight = (name, pos, accent, story) => container(name, pos, {
    visualType: INSIGHT_VISUAL,
    query: { queryState: queryState({ text: [story] }) },
    objects: {
        text: [{ properties: { fontSize: num(11), color: color(C.body), accentColor: color(accent), goodColor: color(C.good), badColor: color(C.bad) } }],
        chip: [{ properties: { label: str("INSIGHT"), color: color(accent) } }]
    },
    visualContainerObjects: bare(),
    drillFilterOtherVisuals: true
});

function chart(name, pos, visualType, title, roles, { sort, objects } = {}) {
    return container(name, pos, {
        visualType,
        query: { queryState: queryState(roles), ...(sort ? { sortDefinition: sort } : {}) },
        ...(objects ? { objects } : {}),
        visualContainerObjects: containerTitle(title),
        drillFilterOtherVisuals: true
    });
}

const yearMonth = () => col("Date", "Year Month");
const byMonth = () => sortBy(yearMonth(), "Ascending");
const waterfallColors = accent => ({ sentimentColors: [{ properties: { increaseFill: color(C.good), decreaseFill: color(C.bad), totalFill: color(accent) } }] });
const V = {
    area: (n, p, t, y, objects) => chart(n, p, "areaChart", t, { Category: [yearMonth()], Y: y }, { sort: byMonth(), objects }),
    combo: (n, p, t, y, y2, objects) => chart(n, p, "lineClusteredColumnComboChart", t, { Category: [yearMonth()], Y: y, Y2: y2 }, { sort: byMonth(), objects }),
    ribbon: (n, p, t, series, y) => chart(n, p, "ribbonChart", t, { Category: [yearMonth()], Series: [series], Y: [y] }, { sort: byMonth() }),
    waterfall: (n, p, t, category, y, sort, accent) => chart(n, p, "waterfallChart", t, { Category: [category], Y: [y] }, { sort, objects: waterfallColors(accent) }),
    gauge: (n, p, t, y, target, accent) => chart(n, p, "gauge", t, { Y: [y], TargetValue: [target] }, { objects: { dataPoint: [{ properties: { fill: color(accent), target: color(C.text) } }] } }),
    decompTree: (n, p, t, analyze, explainBy) => chart(n, p, "decompositionTreeVisual", t, { Analyze: [analyze], ExplainBy: explainBy }),
    scatter: (n, p, t, { details, legend, x, y, size }) => chart(n, p, "scatterChart", t, { Category: [details], Series: [legend], X: [x], Y: [y], Size: [size] }),
    treemap: (n, p, t, group, details, values) => chart(n, p, "treemap", t, { Group: [group], Details: [details], Values: [values] }, { sort: sortBy(values, "Descending") }),
    stackedBar: (n, p, t, category, series, y) => chart(n, p, "barChart", t, { Category: [category], Series: [series], Y: [y] }, { sort: sortBy(y, "Descending") }),
    bar: (n, p, t, category, y, accent) => chart(n, p, "clusteredBarChart", t, { Category: [category], Y: [y] }, { sort: sortBy(y, "Descending"), objects: singleColor(accent) }),
    donut: (n, p, t, category, y) => chart(n, p, "donutChart", t, { Category: [category], Y: [y] }, { sort: sortBy(y, "Descending") }),
    matrix: (n, p, t, rows, values) => chart(n, p, "pivotTable", t, { Rows: rows, Values: values })
};

// ---------- layout helpers ----------
function row(count, x0, width, y, h) {
    const w = (width - (count - 1) * GAP) / count;
    return Array.from({ length: count }, (_, i) => ({ x: x0 + i * (w + GAP), y, width: w, height: h }));
}
function columns(widths) {
    const total = widths.reduce((a, b) => a + b, 0) + GAP * (widths.length - 1);
    if (total !== W) throw new Error(`chart widths total ${total}, expected ${W}`);
    let x = X0;
    return widths.map(w => { const r = { x, y: MAIN.y, width: w, height: MAIN.h }; x += w + GAP; return r; });
}
const metricSlicer = (name, pos) => slicer(name, pos, col("Metric", "Metric"), "Revenue", "Metric");
const timeViewSlicer = (name, pos) => slicer(name, pos, col("Time View", "Time View"), "Current", "TimeView");
const hint = (name, pos, text) => textbox(name, pos, [{ textRuns: [run(text, "9pt", null, C.muted)] }]);

// ---------- pages (story order) ----------
const pages = [
    {
        name: "overview", title: "Executive overview", nav: "Overview", icon: "grid", accent: "#22D3EE",
        question: "How is the business performing this year?", story: "Story Overview",
        cards: [
            { id: "revenue", value: msr("Revenue"), comparison: msr("Revenue PY"), mode: "sum", label: "vs PY" },
            { id: "gm", value: msr("Gross Margin %"), headline: msr("Gross Margin % (Period)") },
            { id: "netincome", value: msr("Net Income"), comparison: msr("Net Income Budget"), mode: "sum", label: "vs budget" },
            { id: "supplierontime", value: msr("Supplier On-Time %"), headline: msr("Supplier On-Time % (Period)") },
            { id: "inventory", value: msr("Inventory Value"), mode: "latest" },
            { id: "headcount", value: msr("Headcount"), mode: "latest" }
        ],
        widths: [560, 384, 200],
        charts: (pos, a) => [
            V.area("overview_revenue_trend", pos[0], "Revenue vs prior year, by month", [msr("Revenue"), msr("Revenue PY")],
                seriesColors({ "_Measures.Revenue": a, "_Measures.Revenue PY": C.slate })),
            V.waterfall("overview_pnl_bridge", pos[1], "How revenue becomes profit", col("Account", "Account Type"), msr("Net Income"),
                sortBy(col("Account", "Account Type"), "Ascending"), a),
            V.gauge("overview_ni_gauge", pos[2], "Net income vs budget", msr("Net Income"), msr("Net Income Budget"), a)
        ]
    },
    {
        name: "sales", title: "Sales performance", nav: "Sales", icon: "trend", accent: "#3B82F6",
        question: "What is driving revenue, and where?", story: "Story Sales",
        controls: (p, x, y) => [
            metricSlicer(`${p}_metric`, { x, y, width: SIDE_W, height: (KPI.h - GAP) / 2 }),
            timeViewSlicer(`${p}_timeview`, { x, y: y + (KPI.h + GAP) / 2, width: SIDE_W, height: (KPI.h - GAP) / 2 })
        ],
        cards: [
            { id: "revenue", value: msr("Revenue"), comparison: msr("Revenue PY"), mode: "sum", label: "vs PY" },
            { id: "grossprofit", value: msr("Gross Profit"), mode: "sum" },
            { id: "orders", value: msr("Orders"), mode: "sum" },
            { id: "aov", value: msr("Avg Order Value"), headline: msr("Avg Order Value (Period)") }
        ],
        noFilterFrom: ["sales_timeview"], // Time View drives the charts; cards and the narrative keep their own logic
        widths: [584, 576],
        charts: pos => [
            V.ribbon("sales_category_ranking", pos[0], msr("Title Ranking"), col("Product", "Category"), msr("Selected Metric")),
            V.decompTree("sales_drivers", pos[1], msr("Title Drivers"), msr("Selected Metric"),
                [col("Customer", "Region"), col("Customer", "Segment"), col("Product", "Category"), col("Product", "Product Name")])
        ]
    },
    {
        name: "customers", title: "Customer value", nav: "Customers", icon: "user", accent: "#8B5CF6",
        question: "Who are our most valuable customers?", story: "Story Customers",
        controls: (p, x, y) => [
            metricSlicer(`${p}_metric`, { x, y, width: SIDE_W, height: (KPI.h - GAP) / 2 }),
            hint(`${p}_hint`, { x: x + 12, y: y + (KPI.h + GAP) / 2 + 10, width: SIDE_W - 24, height: (KPI.h - GAP) / 2 - 20 },
                "Switch the metric to re-plot every customer.")
        ],
        controlPanels: 2,
        cards: [
            { id: "active", value: msr("Active Customers"), headline: msr("Active Customers (Period)") },
            { id: "aov", value: msr("Avg Order Value"), headline: msr("Avg Order Value (Period)") },
            { id: "revenue", value: msr("Revenue"), comparison: msr("Revenue PY"), mode: "sum", label: "vs PY" },
            { id: "gm", value: msr("Gross Margin %"), headline: msr("Gross Margin % (Period)") }
        ],
        widths: [720, 440],
        charts: pos => [
            V.scatter("customers_scatter", pos[0], msr("Title Customers"), {
                details: col("Customer", "Customer Name"), legend: col("Customer", "Segment"),
                x: msr("Orders"), y: msr("Selected Metric"), size: msr("Gross Profit")
            }),
            V.treemap("customers_treemap", pos[1], "Revenue by region and segment", col("Customer", "Region"), col("Customer", "Segment"), msr("Revenue"))
        ]
    },
    {
        name: "operations", title: "Supply chain", nav: "Operations", icon: "box", accent: "#F59E0B",
        question: "Are suppliers and stock keeping up with demand?", story: "Story Operations",
        cards: [
            { id: "spend", value: msr("Purchase Spend"), mode: "sum" },
            { id: "supplierontime", value: msr("Supplier On-Time %"), headline: msr("Supplier On-Time % (Period)") },
            { id: "leadtime", value: msr("Avg Lead Time (Days)"), headline: msr("Avg Lead Time (Days) (Period)") },
            { id: "inventory", value: msr("Inventory Value"), mode: "latest" },
            { id: "belowrop", value: msr("Items Below Reorder Point"), mode: "latest" }
        ],
        widths: [584, 576],
        charts: pos => [
            V.scatter("ops_supplier_scatter", pos[0], "Supplier reliability: lead time vs on-time rate (bubble = spend)", {
                details: col("Supplier", "Supplier Name"), legend: col("Supplier", "Country"),
                x: msr("Avg Lead Time (Days)"), y: msr("Supplier On-Time %"), size: msr("Purchase Spend")
            }),
            V.stackedBar("ops_inventory_mix", pos[1], "Where the stock sits: inventory value by warehouse",
                col("Warehouse", "Warehouse"), col("Product", "Category"), msr("Inventory Value"))
        ]
    },
    {
        name: "finance", title: "Financial results", nav: "Finance", icon: "bars", accent: "#10B981",
        question: "Are we delivering profit against budget?", story: "Story Finance",
        cards: [
            { id: "netincome", value: msr("Net Income"), comparison: msr("Net Income Budget"), mode: "sum", label: "vs budget" },
            { id: "netmargin", value: msr("Net Margin %"), headline: msr("Net Margin % (Period)") },
            { id: "opex", value: msr("GL Operating Expenses"), mode: "sum" },
            { id: "favvar", value: msr("Budget Variance (Favorable)"), mode: "sum" }
        ],
        widths: [584, 576],
        charts: (pos, a) => [
            V.matrix("finance_pnl", pos[0], "Income statement vs budget",
                [col("Account", "Account Type"), col("Account", "Account Name")],
                [msr("GL Actual"), msr("GL Budget"), msr("Budget Variance (Favorable)")]),
            V.waterfall("finance_variance_bridge", pos[1], "Which departments moved us vs budget (+ = favorable)",
                col("Department", "Department"), msr("Budget Variance (Favorable)"), sortBy(msr("Budget Variance (Favorable)"), "Descending"), a)
        ]
    },
    {
        name: "people", title: "People & workforce", nav: "People", icon: "people", accent: "#EC4899",
        question: "Is the team growing sustainably?", story: "Story People",
        cards: [
            { id: "headcount", value: msr("Headcount"), mode: "latest" },
            { id: "hires", value: msr("Hires"), mode: "sum" },
            { id: "terminations", value: msr("Terminations"), mode: "sum" },
            { id: "attrition", value: msr("Attrition %"), axis: null }
        ],
        widths: [584, 280, 280],
        charts: (pos, a) => [
            V.combo("people_flow", pos[0], "Hires and exits (columns) vs headcount (line)", [msr("Hires"), msr("Terminations")], [msr("Headcount")],
                seriesColors({ "_Measures.Hires": C.good, "_Measures.Terminations": C.bad, "_Measures.Headcount": a })),
            V.donut("people_dept_mix", pos[1], "Team mix by department", col("Department", "Department"), msr("Headcount")),
            V.bar("people_attrition_dept", pos[2], "Attrition rate by department", col("Department", "Department"), msr("Attrition %"), a)
        ]
    }
];

// ---------- page assembly ----------
const NAV_TOP = 96, NAV_STEP = 72;

function buildPage(page) {
    const a = page.accent;
    const visuals = [];
    const panels = [];
    let z = 0;
    const add = v => { const r = v.position; v.position = { x: r.x, y: r.y, z: (z += 1000), height: r.height, width: r.width, tabOrder: z }; visuals.push(v); };

    // Sidebar navigation: labels + invisible buttons over the icons drawn in the background.
    pages.forEach((target, i) => {
        const top = NAV_TOP + i * NAV_STEP;
        const active = target.name === page.name;
        add(textbox(`${page.name}_navlabel_${target.name}`, { x: 0, y: top + 44, width: RAIL_W, height: 16 },
            [{ horizontalTextAlignment: "center", textRuns: [run(target.nav, "7pt", active ? "bold" : null, active ? a : C.muted)] }]));
        if (!active) add(navButton(`${page.name}_nav_${target.name}`, { x: 0, y: top, width: RAIL_W, height: 62 }, target.name, target.title));
    });

    // Header: title + guiding question, data note, year switcher.
    add(textbox(`${page.name}_title`, { x: X0, y: 2, width: 640, height: 72 }, [
        { textRuns: [run(BRAND.toUpperCase(), "8pt", "bold", a)] },
        { textRuns: [run(page.title, "17pt", "bold", C.text)] },
        { textRuns: [run(page.question, "10pt", null, C.muted)] }
    ]));
    add(textbox(`${page.name}_asof`, { x: X1 - 170 - GAP - 300, y: 34, width: 300, height: 18 },
        [{ horizontalTextAlignment: "right", textRuns: [run(AS_OF, "8pt", null, C.dim)] }]));
    const yearPos = { x: X1 - 170, y: 16, width: 170, height: 50 };
    panels.push({ ...yearPos, kind: "control" });
    add(slicer(`${page.name}_year`, yearPos, col("Date", "Year"), 2026, "Year"));

    // Insight banner (narrative measure).
    panels.push({ x: X0, y: INSIGHT.y, width: W, height: INSIGHT.h, kind: "insight" });
    const insightName = `${page.name}_insight`;
    add(insight(insightName, { x: X0 + 8, y: INSIGHT.y + 3, width: W - 16, height: INSIGHT.h - 6 }, a, msr(page.story)));

    // Controls column + KPI cards.
    let cardsX = X0, cardsW = W;
    if (page.controls) {
        const half = (KPI.h - GAP) / 2;
        panels.push({ x: X0, y: KPI.y, width: SIDE_W, height: half, kind: "control" });
        panels.push({ x: X0, y: KPI.y + half + GAP, width: SIDE_W, height: half, kind: page.controlPanels === 2 ? "note" : "control" });
        page.controls(page.name, X0, KPI.y).forEach(add);
        cardsX += SIDE_W + GAP;
        cardsW -= SIDE_W + GAP;
    }
    const cardNames = [];
    row(page.cards.length, cardsX, cardsW, KPI.y, KPI.h).forEach((r, i) => {
        const card = page.cards[i];
        const name = `${page.name}_kpi_${card.id}`;
        cardNames.push(name);
        panels.push({ ...r, kind: "kpi" });
        add(kpiCard(name, r, a, card));
    });

    // Charts.
    const chartPos = columns(page.widths);
    chartPos.forEach(r => panels.push({ ...r, kind: "chart" }));
    page.charts(chartPos, a).forEach(add);

    const targets = [...cardNames, insightName];
    const interactions = (page.noFilterFrom || []).flatMap(source => targets.map(target => ({ source, target, type: "NoFilter" })));
    return { visuals, interactions, panels };
}

// ---------- background art ----------
const f1 = n => Number(n.toFixed(1));
function backgroundSvg(page, panels) {
    const a = page.accent;
    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}" viewBox="0 0 ${PAGE_W} ${PAGE_H}">`);
    parts.push(`<defs>
  <radialGradient id="glowA" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(420 -60) scale(680 440)"><stop offset="0" stop-color="${a}" stop-opacity="0.20"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient>
  <radialGradient id="glowB" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1220 780) scale(700 480)"><stop offset="0" stop-color="#8B5CF6" stop-opacity="0.12"/><stop offset="1" stop-color="#8B5CF6" stop-opacity="0"/></radialGradient>
  <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.045"/><stop offset="0.4" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
  <linearGradient id="insightFill" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${a}" stop-opacity="0.20"/><stop offset="0.55" stop-color="${a}" stop-opacity="0.05"/><stop offset="1" stop-color="${a}" stop-opacity="0.02"/></linearGradient>
  <linearGradient id="logo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22D3EE"/><stop offset="1" stop-color="#8B5CF6"/></linearGradient>
  <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1" fill="#FFFFFF" fill-opacity="0.035"/></pattern>
</defs>`);
    parts.push(`<rect width="${PAGE_W}" height="${PAGE_H}" fill="${C.bg}"/>`);
    parts.push(`<rect width="${PAGE_W}" height="${PAGE_H}" fill="url(#glowA)"/><rect width="${PAGE_W}" height="${PAGE_H}" fill="url(#glowB)"/>`);
    parts.push(`<rect x="${RAIL_W}" width="${PAGE_W - RAIL_W}" height="${PAGE_H}" fill="url(#dots)"/>`);

    // Sidebar rail + logo mark.
    parts.push(`<rect width="${RAIL_W}" height="${PAGE_H}" fill="${C.rail}" fill-opacity="0.94"/><rect x="${RAIL_W - 1}" width="1" height="${PAGE_H}" fill="#FFFFFF" fill-opacity="0.06"/>`);
    parts.push(`<rect x="16" y="18" width="40" height="40" rx="12" fill="url(#logo)"/>`);
    // "H" monogram for Halvorsen Supply Co.
    parts.push(`<rect x="26" y="27" width="5.5" height="22" rx="2.2" fill="${C.bg}"/><rect x="40.5" y="27" width="5.5" height="22" rx="2.2" fill="${C.bg}"/><rect x="26" y="35.5" width="20" height="5" rx="2" fill="${C.bg}"/>`);
    pages.forEach((target, i) => {
        const top = NAV_TOP + i * NAV_STEP;
        const active = target.name === page.name;
        if (active) {
            parts.push(`<rect x="12" y="${top + 2}" width="48" height="38" rx="12" fill="${a}" fill-opacity="0.16"/>`);
            parts.push(`<rect x="0" y="${top + 7}" width="3" height="28" rx="1.5" fill="${a}"/>`);
        }
        parts.push(`<g transform="translate(24 ${top + 9})" fill="none" stroke="${active ? a : C.dim}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[target.icon]}</g>`);
    });

    // Panels.
    for (const p of panels) {
        const x = f1(p.x), y = f1(p.y), w = f1(p.width), h = f1(p.height);
        const r = p.kind === "control" || p.kind === "note" ? 12 : 14;
        if (p.kind === "insight") {
            parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${C.panel}" fill-opacity="0.85"/>`);
            parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#insightFill)" stroke="${a}" stroke-opacity="0.35"/>`);
            continue;
        }
        const fill = p.kind === "note" ? `fill="${a}" fill-opacity="0.07"` : `fill="${C.panel}" fill-opacity="0.82"`;
        parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ${fill} stroke="#FFFFFF" stroke-opacity="0.07"/>`);
        parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#sheen)"/>`);
        if (p.kind === "kpi") parts.push(`<rect x="${f1(x + 16)}" y="${y}" width="28" height="2" rx="1" fill="${a}"/>`);
        if (p.kind === "chart") parts.push(`<circle cx="${f1(x + w - 18)}" cy="${f1(y + 18)}" r="3" fill="${a}" fill-opacity="0.8"/>`);
    }
    parts.push("</svg>");
    return parts.join("\n");
}
const renderPng = (svg, path) => sharp(Buffer.from(svg), { density: 144 }).png({ compressionLevel: 9 }).toFile(path);

// ---------- model field check ----------
async function modelFields() {
    const fields = new Set();
    for (const file of await readdir(tablesDir)) {
        if (!file.endsWith(".tmdl")) continue;
        const table = file.replace(/\.tmdl$/, "");
        const text = await readFile(join(tablesDir, file), "utf8");
        for (const m of text.matchAll(/^\s*(?:column|measure)\s+(?:'([^']+)'|([^\s=]+))/gm)) fields.add(`${table}|${m[1] ?? m[2]}`);
    }
    return fields;
}

// ---------- write ----------
const writeJson = async (path, obj) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(obj, null, 2) + "\n", "utf8");
};
const bgName = page => `bg-${page.name}.png`;

// Static format strings of every measure in _Measures.tmdl (measures with only a dynamic format are skipped).
async function measureFormats() {
    const text = (await readFile(join(tablesDir, "_Measures.tmdl"), "utf8")).replace(/\r\n/g, "\n");
    const formats = {};
    const blocks = text.split(/\n(?=\tmeasure\s)/);
    for (const block of blocks) {
        const name = /^\tmeasure\s+(?:'([^']+)'|([^\s=]+))/.exec(block);
        const fmt = /^\t\tformatString:\s*(.+?)\s*$/m.exec(block);
        if (name && fmt) formats[name[1] ?? name[2]] = fmt[1];
    }
    return formats;
}
const FORMATS = await measureFormats();

const built = pages.map(p => ({ page: p, ...buildPage(p) }));

if (PREVIEW) {
    const outDir = join(root, "tools", "out");
    await mkdir(outDir, { recursive: true });
    for (const { page, panels } of built) await renderPng(backgroundSvg(page, panels), join(outDir, bgName(page)));
    console.log(`Rendered ${built.length} backgrounds to ${outDir}`);
    process.exit(0);
}

const known = await modelFields();
const missing = [...usedFields].filter(f => !known.has(f));
if (missing.length) throw new Error(`Fields not found in the semantic model: ${missing.join(", ")}`);

// Registered resources: theme + page backgrounds.
const resDir = join(reportDir, "StaticResources", "RegisteredResources");
await mkdir(resDir, { recursive: true });
await copyFile(join(root, "tools", "report-theme.json"), join(resDir, THEME_FILE));
for (const { page, panels } of built) await renderPng(backgroundSvg(page, panels), join(resDir, bgName(page)));

// Pages + visuals.
const pagesDir = join(defDir, "pages");
await rm(pagesDir, { recursive: true, force: true });
await writeJson(join(pagesDir, "pages.json"), { $schema: SCHEMA.pages, pageOrder: pages.map(p => p.name), activePageName: pages[0].name });
let visualCount = 0;
for (const { page, visuals, interactions } of built) {
    await writeJson(join(pagesDir, page.name, "page.json"), {
        $schema: SCHEMA.page,
        name: page.name,
        displayName: page.nav,
        displayOption: "FitToPage",
        height: PAGE_H,
        width: PAGE_W,
        objects: {
            background: [{
                properties: {
                    image: {
                        image: {
                            name: str(bgName(page)),
                            url: { expr: { ResourcePackageItem: { PackageName: "RegisteredResources", PackageType: 1, ItemName: bgName(page) } } },
                            scaling: str("Fit")
                        }
                    },
                    transparency: num(0)
                }
            }],
            outspace: [{ properties: { color: color(C.bg) } }]
        },
        ...(interactions.length ? { visualInteractions: interactions } : {})
    });
    for (const v of visuals) {
        await writeJson(join(pagesDir, page.name, "visuals", v.name, "visual.json"), v);
        visualCount++;
    }
}

// Custom visuals: unzip each newest .pbiviz into CustomVisuals/<guid>/ (the layout Desktop writes for private visuals).
const customPackages = [];
for (const { guid, dist } of CUSTOM_VISUALS) {
    const files = [];
    for (const f of await readdir(dist)) if (f.endsWith(".pbiviz")) files.push({ f, t: (await stat(join(dist, f))).mtimeMs });
    if (!files.length) throw new Error(`No .pbiviz in ${dist}. Run npm run package there.`);
    const pbiviz = join(dist, files.sort((x, y) => y.t - x.t)[0].f);
    const cvDir = join(reportDir, "CustomVisuals", guid);
    await rm(cvDir, { recursive: true, force: true });
    await mkdir(cvDir, { recursive: true });
    execFileSync("tar", ["-xf", pbiviz, "-C", cvDir]); // Windows 10+ bsdtar reads zip archives
    const resourceName = `${guid}.pbiviz.json`;
    if (!(await stat(join(cvDir, "resources", resourceName)).catch(() => null))) throw new Error(`${pbiviz} has no resources/${resourceName}`);
    customPackages.push({ name: guid, type: "CustomVisual", items: [{ name: resourceName, path: resourceName, type: "CustomVisualMetadata" }] });
}

// report.json: theme + resource packages.
const reportPath = join(defDir, "report.json");
const report = JSON.parse(await readFile(reportPath, "utf8"));
report.themeCollection.customTheme = { name: THEME_FILE, reportVersionAtImport: report.themeCollection.baseTheme.reportVersionAtImport, type: "RegisteredResources" };
const keep = (report.resourcePackages || []).filter(p => p.type !== "CustomVisual" && p.type !== "RegisteredResources");
const registered = {
    name: "RegisteredResources",
    type: "RegisteredResources",
    items: [
        { name: THEME_FILE, path: THEME_FILE, type: "CustomTheme" },
        ...pages.map(p => ({ name: bgName(p), path: bgName(p), type: "Image" }))
    ]
};
report.resourcePackages = [...keep, registered, ...customPackages];
await writeJson(reportPath, report);

console.log(`Wrote ${pages.length} pages, ${visualCount} visuals, ${pages.length} backgrounds, theme, ${customPackages.length} custom visuals. Fields checked: ${usedFields.size}.`);
