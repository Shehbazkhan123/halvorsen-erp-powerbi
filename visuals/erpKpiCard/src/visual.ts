"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";
import { gsap } from "gsap";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import DataView = powerbi.DataView;
import PrimitiveValue = powerbi.PrimitiveValue;

import { VisualFormattingSettingsModel } from "./settings";

const SVG_NS = "http://www.w3.org/2000/svg";

interface TrendPoint {
    label: string;
    value: number;
}

interface KpiModel {
    title: string;
    comparisonName: string;
    value: number;
    comparison: number | null;
    caption: string;
    format: string;
    points: TrendPoint[];
}

interface ChartPoint extends TrendPoint {
    x: number;
    y: number;
}

function div(className: string, parent: Element): HTMLDivElement {
    const node = document.createElement("div");
    node.className = className;
    parent.appendChild(node);
    return node;
}

function svgNode<T extends SVGElement>(tag: string, parent: Element, attrs: Record<string, string> = {}): T {
    const node = document.createElementNS(SVG_NS, tag) as T;
    Object.keys(attrs).forEach(k => node.setAttribute(k, attrs[k]));
    parent.appendChild(node);
    return node;
}

function toNumber(v: PrimitiveValue): number | null {
    if (v === null || v === undefined || v === "") {
        return null;
    }
    const n = Number(v);
    return isNaN(n) ? null : n;
}

function hexToRgba(hex: string, alpha: number): string {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
    if (!m) {
        return hex;
    }
    return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

function signed(n: number, digits: number, suffix: string): string {
    return `${n > 0 ? "+" : ""}${n.toFixed(digits)}${suffix}`;
}

export class Visual implements IVisual {
    private host: IVisualHost;
    private events: IVisualEventService;
    private selectionManager: ISelectionManager;
    private formattingSettingsService: FormattingSettingsService;
    private formattingSettings: VisualFormattingSettingsModel;

    private root: HTMLDivElement;
    private titleEl: HTMLDivElement;
    private valueEl: HTMLDivElement;
    private deltaRow: HTMLDivElement;
    private badgeEl: HTMLDivElement;
    private deltaLabelEl: HTMLDivElement;
    private chartEl: HTMLDivElement;
    private periodEl: HTMLDivElement;
    private hoverLabel: HTMLDivElement;
    private emptyEl: HTMLDivElement;

    private svg: SVGSVGElement;
    private gradientStops: SVGStopElement[];
    private areaPath: SVGPathElement;
    private linePath: SVGPathElement;
    private pulseRing: SVGCircleElement;
    private endDot: SVGCircleElement;
    private hoverDot: SVGCircleElement;

    private hoverDotX: (v: number) => void;
    private hoverDotY: (v: number) => void;
    private hoverLabelX: (v: number) => void;

    private timeline: gsap.core.Timeline | null = null;
    private pulseTween: gsap.core.Tween | null = null;
    private pendingDone: (() => void) | null = null;

    private hasRendered = false;
    private displayedValue = 0;
    private lastSignature = "";
    private chartPoints: ChartPoint[] = [];
    private formatValue: (n: number) => string = n => String(n);
    private reducedMotion = false;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        const container = options.element;
        this.root = div("kpi-card", container);
        this.titleEl = div("kpi-title", this.root);
        this.valueEl = div("kpi-value", this.root);
        this.deltaRow = div("kpi-delta", this.root);
        this.badgeEl = div("kpi-badge", this.deltaRow);
        this.deltaLabelEl = div("kpi-delta-label", this.deltaRow);
        this.chartEl = div("kpi-chart", this.root);
        this.periodEl = div("kpi-period", this.root);
        this.emptyEl = div("kpi-empty", container);

        const gradientId = `kpiFill${window.crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
        this.svg = svgNode<SVGSVGElement>("svg", this.chartEl);
        const defs = svgNode<SVGDefsElement>("defs", this.svg);
        const gradient = svgNode<SVGLinearGradientElement>("linearGradient", defs, { id: gradientId, x1: "0", y1: "0", x2: "0", y2: "1" });
        this.gradientStops = [
            svgNode<SVGStopElement>("stop", gradient, { offset: "0%", "stop-opacity": "0.35" }),
            svgNode<SVGStopElement>("stop", gradient, { offset: "100%", "stop-opacity": "0" })
        ];
        this.areaPath = svgNode<SVGPathElement>("path", this.svg, { class: "kpi-area", fill: `url(#${gradientId})` });
        this.linePath = svgNode<SVGPathElement>("path", this.svg, { class: "kpi-line" });
        this.pulseRing = svgNode<SVGCircleElement>("circle", this.svg, { class: "kpi-pulse", r: "3" });
        this.endDot = svgNode<SVGCircleElement>("circle", this.svg, { class: "kpi-dot", r: "3.5" });
        this.hoverDot = svgNode<SVGCircleElement>("circle", this.svg, { class: "kpi-hover-dot", r: "4", cx: "0", cy: "0" });
        this.hoverLabel = div("kpi-hover", this.chartEl);

        gsap.set([this.hoverDot, this.hoverLabel], { autoAlpha: 0 });
        this.hoverDotX = gsap.quickTo(this.hoverDot, "x", { duration: 0.25, ease: "power3.out" });
        this.hoverDotY = gsap.quickTo(this.hoverDot, "y", { duration: 0.25, ease: "power3.out" });
        this.hoverLabelX = gsap.quickTo(this.hoverLabel, "x", { duration: 0.25, ease: "power3.out" });

        this.chartEl.addEventListener("pointermove", e => this.onPointerMove(e));
        this.chartEl.addEventListener("pointerleave", () => this.hideHover());
        container.addEventListener("contextmenu", e => {
            this.selectionManager.showContextMenu({}, { x: e.clientX, y: e.clientY });
            e.preventDefault();
        });

        this.reducedMotion = typeof window !== "undefined" && !!window.matchMedia
            && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    public update(options: VisualUpdateOptions): void {
        this.events.renderingStarted(options);
        try {
            const dataView = options.dataViews?.[0];
            this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);

            const model = this.buildModel(dataView);
            if (!model) {
                this.showEmpty(dataView ? "No data for the current filters." : "Add a measure to Value.\nOptionally add a Trend axis (e.g. Date[Year Month]) and a Comparison measure.");
                this.events.renderingFinished(options);
                return;
            }
            this.emptyEl.style.display = "none";
            this.root.style.display = "";

            const signature = JSON.stringify([model.value, model.comparison, model.format, model.points.map(p => p.value)]);
            const animate = this.formattingSettings.animationCard.show.value && !this.reducedMotion && signature !== this.lastSignature;
            this.lastSignature = signature;

            this.render(model, options.viewport, animate, () => this.events.renderingFinished(options));
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    public destroy(): void {
        this.stopAnimations();
    }

    // ---------- data ----------

    private buildModel(dataView: DataView | undefined): KpiModel | null {
        const categorical = dataView?.categorical;
        const columns = categorical?.values ?? [];
        const valueCol = columns.find(c => c.source.roles?.["value"]);
        if (!valueCol) {
            return null;
        }
        const compCol = columns.find(c => c.source.roles?.["comparison"]);
        const category = categorical.categories?.[0];

        const base = {
            title: valueCol.source.displayName,
            comparisonName: compCol?.source.displayName ?? "",
            format: valueCol.source.format || "#,0.##"
        };

        if (!category) {
            const value = toNumber(valueCol.values[0]);
            if (value === null) {
                return null;
            }
            const comparison = compCol ? toNumber(compCol.values[0]) : null;
            return { ...base, value, comparison, caption: "", points: [] };
        }

        // Keep only periods where the Value measure has data (skips e.g. future months).
        const points: TrendPoint[] = [];
        const comparisons: number[] = [];
        category.values.forEach((c, i) => {
            const v = toNumber(valueCol.values[i]);
            if (v !== null) {
                points.push({ label: valueFormatter.format(c, category.source.format), value: v });
                const cv = compCol ? toNumber(compCol.values[i]) : null;
                if (cv !== null) {
                    comparisons.push(cv);
                }
            }
        });
        if (points.length === 0) {
            return null;
        }

        const first = points[0];
        const last = points[points.length - 1];
        const mode = String(this.formattingSettings.valueCard.headlineMode.value?.value ?? "latest");

        if (mode === "latest" || points.length === 1) {
            const lastIndex = category.values.length - 1 - [...valueCol.values].reverse().findIndex(v => toNumber(v) !== null);
            const comparison = compCol ? toNumber(compCol.values[lastIndex]) : null;
            return { ...base, value: last.value, comparison, caption: `Latest: ${last.label}`, points };
        }

        const average = mode === "average";
        const total = points.reduce((sum, p) => sum + p.value, 0);
        const compTotal = comparisons.reduce((sum, c) => sum + c, 0);
        return {
            ...base,
            value: average ? total / points.length : total,
            comparison: comparisons.length === 0 ? null : average ? compTotal / comparisons.length : compTotal,
            caption: `${average ? "Average" : "Total"}: ${first.label} – ${last.label}`,
            points
        };
    }

    private makeFormatter(format: string, reference: number): (n: number) => string {
        if (format.indexOf("%") >= 0) {
            return n => valueFormatter.format(n, format);
        }
        const chosen = Number(this.formattingSettings.valueCard.displayUnits.value) || 0;
        const abs = Math.abs(reference);
        const unit = chosen !== 0 ? chosen : abs >= 1e9 ? 1e9 : abs >= 1e6 ? 1e6 : abs >= 1e5 ? 1e3 : 1;
        if (unit <= 1) {
            return n => valueFormatter.format(n, format);
        }
        const formatter = valueFormatter.create({
            format,
            value: unit,
            precision: this.formattingSettings.valueCard.decimalPlaces.value
        });
        return n => formatter.format(n);
    }

    // ---------- render ----------

    private render(model: KpiModel, viewport: powerbi.IViewport, animate: boolean, done: () => void): void {
        const s = this.formattingSettings;
        const palette = this.host.colorPalette;
        const hc = palette.isHighContrast;
        const fg = hc ? palette.foreground.value : null;

        // Title
        this.titleEl.style.display = s.titleCard.show.value ? "" : "none";
        this.titleEl.textContent = s.titleCard.text.value || model.title;
        this.titleEl.style.fontSize = `${s.titleCard.fontSize.value}pt`;
        this.titleEl.style.color = fg ?? s.titleCard.color.value.value;

        // Without a sparkline the card centers its content and the headline grows into the free space.
        const showSpark = s.sparklineCard.show.value && model.points.length > 1;
        this.root.classList.toggle("kpi-no-chart", !showSpark);

        // Value (shrinks on small tiles so it never clips)
        this.formatValue = this.makeFormatter(model.format, model.value);
        const targetPt = showSpark ? s.valueCard.fontSize.value : s.valueCard.fontSize.value * 1.5;
        const heightShare = showSpark ? 0.3 : 0.4;
        const maxPt = Math.max(10, Math.min(targetPt, viewport.height * heightShare, viewport.width * 0.16));
        this.valueEl.style.fontSize = `${maxPt}pt`;
        this.valueEl.style.color = fg ?? s.valueCard.color.value.value;
        // Give the headline its text now so the sparkline is measured against the final layout.
        this.valueEl.textContent = this.formatValue(animate && this.hasRendered ? this.displayedValue : model.value);

        // Comparison badge
        const showDelta = s.comparisonCard.show.value && model.comparison !== null;
        this.deltaRow.style.display = showDelta ? "" : "none";
        if (showDelta) {
            const rawDiff = model.value - model.comparison;
            const isPct = model.format.indexOf("%") >= 0;
            // Change as shown: percentage points for % measures, % change otherwise. Rounded to 1 decimal
            // so a change that displays as 0.0 is treated as flat rather than favorable/unfavorable.
            const shown = isPct
                ? Number((rawDiff * 100).toFixed(1))
                : model.comparison !== 0 ? Number(((rawDiff / Math.abs(model.comparison)) * 100).toFixed(1)) : rawDiff;
            const diff = shown === 0 ? 0 : rawDiff;
            let changeText: string;
            if (isPct) {
                changeText = signed(shown, 1, " pts");
            } else if (model.comparison !== 0) {
                changeText = signed(shown, 1, "%");
            } else {
                changeText = this.formatValue(rawDiff);
            }
            const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "●";
            const favorable = diff === 0 ? null : (diff > 0) === s.comparisonCard.higherIsBetter.value;
            const color = fg ?? (favorable === null ? "#605E5C" : favorable ? s.comparisonCard.goodColor.value.value : s.comparisonCard.badColor.value.value);

            this.badgeEl.textContent = `${arrow} ${changeText}`;
            this.badgeEl.style.color = color;
            this.badgeEl.style.backgroundColor = hc ? "transparent" : hexToRgba(color, 0.12);
            this.badgeEl.style.border = hc ? `1px solid ${fg}` : "none";

            const label = s.comparisonCard.label.value || `vs ${model.comparisonName}`;
            this.deltaLabelEl.textContent = `${label} ${this.formatValue(model.comparison)}`;
            this.deltaLabelEl.style.color = fg ?? s.comparisonCard.labelColor.value.value;
        }

        // Period caption
        this.periodEl.style.color = fg ?? s.comparisonCard.labelColor.value.value;
        this.periodEl.textContent = model.caption;
        this.periodEl.style.display = model.caption ? "" : "none";

        // Sparkline
        const lineColor = fg ?? s.sparklineCard.color.value.value;
        this.chartEl.style.display = showSpark ? "" : "none";
        this.chartPoints = showSpark ? this.drawSparkline(model.points, lineColor) : [];

        this.stopAnimations();
        if (animate) {
            this.playIn(model, showDelta, showSpark, done);
        } else {
            this.showFinal(model, showSpark);
            done();
        }
        this.hasRendered = true;
    }

    private drawSparkline(points: TrendPoint[], color: string): ChartPoint[] {
        const w = this.chartEl.clientWidth;
        const h = this.chartEl.clientHeight;
        if (w < 10 || h < 10) {
            return [];
        }
        const pad = 5;
        const values = points.map(p => p.value);
        let min = Math.min(...values);
        let max = Math.max(...values);
        if (min === max) {
            min -= 1;
            max += 1;
        }
        const span = max - min;
        const step = (w - pad * 2) / (points.length - 1);
        const chart: ChartPoint[] = points.map((p, i) => ({
            ...p,
            x: pad + i * step,
            y: pad + (1 - (p.value - min) / span) * (h - pad * 2)
        }));

        const line = chart.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
        const first = chart[0];
        const last = chart[chart.length - 1];
        this.linePath.setAttribute("d", line);
        this.linePath.style.stroke = color;
        this.areaPath.setAttribute("d", `${line} L${last.x.toFixed(1)},${h} L${first.x.toFixed(1)},${h} Z`);
        this.areaPath.style.display = this.formattingSettings.sparklineCard.showArea.value ? "" : "none";
        this.gradientStops.forEach(stop => stop.setAttribute("stop-color", color));

        [this.endDot, this.pulseRing].forEach(c => {
            c.setAttribute("cx", last.x.toFixed(1));
            c.setAttribute("cy", last.y.toFixed(1));
        });
        this.endDot.style.fill = color;
        this.pulseRing.style.stroke = color;
        this.hoverDot.style.stroke = color;
        return chart;
    }

    // ---------- animation ----------

    private playIn(model: KpiModel, showDelta: boolean, showSpark: boolean, done: () => void): void {
        const s = this.formattingSettings.animationCard;
        const d = s.duration.value;
        const ease = String(s.easing.value?.value ?? "power3.out");

        this.pendingDone = done;
        const tl = gsap.timeline({
            defaults: { duration: d, ease },
            onComplete: () => {
                this.timeline = null;
                this.startPulse(showSpark);
                this.finishPending();
            }
        });

        if (!this.hasRendered) {
            tl.fromTo(this.root, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: d * 0.5, ease: "power2.out" }, 0);
        } else {
            gsap.set(this.root, { autoAlpha: 1, y: 0 });
        }

        // Count the headline up (or down) from whatever is currently on screen.
        const counter = { n: this.hasRendered ? this.displayedValue : 0 };
        tl.to(counter, {
            n: model.value,
            onUpdate: () => {
                this.displayedValue = counter.n;
                this.valueEl.textContent = this.formatValue(counter.n);
            },
            onComplete: () => {
                this.displayedValue = model.value;
                this.valueEl.textContent = this.formatValue(model.value);
            }
        }, 0);

        if (showDelta) {
            tl.fromTo(this.badgeEl, { scale: 0.5, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: d * 0.45, ease: "back.out(2.2)" }, d * 0.3);
            tl.fromTo(this.deltaLabelEl, { autoAlpha: 0, x: -8 }, { autoAlpha: 1, x: 0, duration: d * 0.45, ease: "power2.out" }, d * 0.4);
        }

        if (showSpark && this.chartPoints.length > 1) {
            const length = this.linePath.getTotalLength();
            gsap.set(this.linePath, { strokeDasharray: length, strokeDashoffset: length });
            tl.to(this.linePath, {
                strokeDashoffset: 0,
                duration: d,
                ease: "power2.inOut",
                onComplete: () => { gsap.set(this.linePath, { clearProps: "strokeDasharray,strokeDashoffset" }); }
            }, d * 0.1);
            tl.fromTo(this.areaPath, { autoAlpha: 0 }, { autoAlpha: 1, duration: d * 0.8, ease: "power1.out" }, d * 0.35);
            tl.fromTo(this.endDot, { scale: 0, transformOrigin: "50% 50%" }, { scale: 1, duration: 0.45, ease: "back.out(3)" }, d * 1.05);
        }

        if (this.periodEl.textContent) {
            tl.fromTo(this.periodEl, { autoAlpha: 0 }, { autoAlpha: 1, duration: d * 0.5, ease: "power1.out" }, d * 0.6);
        }

        this.timeline = tl;
    }

    private showFinal(model: KpiModel, showSpark: boolean): void {
        gsap.set([this.root, this.badgeEl, this.deltaLabelEl, this.areaPath, this.periodEl], { autoAlpha: 1, x: 0, y: 0, scale: 1 });
        gsap.set(this.endDot, { scale: 1 });
        gsap.set(this.linePath, { clearProps: "strokeDasharray,strokeDashoffset" });
        this.displayedValue = model.value;
        this.valueEl.textContent = this.formatValue(model.value);
        this.startPulse(showSpark);
    }

    private startPulse(showSpark: boolean): void {
        this.pulseTween?.kill();
        this.pulseTween = null;
        const enabled = showSpark && this.chartPoints.length > 1 && this.formattingSettings.sparklineCard.pulse.value
            && this.formattingSettings.animationCard.show.value && !this.reducedMotion;
        if (!enabled) {
            gsap.set(this.pulseRing, { autoAlpha: 0 });
            return;
        }
        this.pulseTween = gsap.fromTo(this.pulseRing,
            { attr: { r: 3 }, autoAlpha: 0.7 },
            { attr: { r: 11 }, autoAlpha: 0, duration: 1.6, ease: "power1.out", repeat: -1, repeatDelay: 0.5 });
    }

    private stopAnimations(): void {
        this.timeline?.kill();
        this.timeline = null;
        this.pulseTween?.kill();
        this.pulseTween = null;
        this.finishPending();
    }

    private finishPending(): void {
        const done = this.pendingDone;
        this.pendingDone = null;
        if (done) {
            done();
        }
    }

    // ---------- hover readout ----------

    private onPointerMove(e: PointerEvent): void {
        if (this.chartPoints.length < 2) {
            return;
        }
        const rect = this.chartEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        let nearest = this.chartPoints[0];
        for (const p of this.chartPoints) {
            if (Math.abs(p.x - x) < Math.abs(nearest.x - x)) {
                nearest = p;
            }
        }
        this.hoverLabel.textContent = `${nearest.label}  ${this.formatValue(nearest.value)}`;
        const labelWidth = this.hoverLabel.offsetWidth;
        const labelX = Math.max(0, Math.min(rect.width - labelWidth, nearest.x - labelWidth / 2));

        this.hoverDotX(nearest.x);
        this.hoverDotY(nearest.y);
        this.hoverLabelX(labelX);
        gsap.to([this.hoverDot, this.hoverLabel], { autoAlpha: 1, duration: 0.15, overwrite: "auto" });
    }

    private hideHover(): void {
        gsap.to([this.hoverDot, this.hoverLabel], { autoAlpha: 0, duration: 0.2, overwrite: "auto" });
    }

    private showEmpty(message: string): void {
        this.stopAnimations();
        this.root.style.display = "none";
        this.emptyEl.style.display = "flex";
        this.emptyEl.textContent = message;
        this.hasRendered = false;
        this.lastSignature = "";
        this.displayedValue = 0;
    }
}
