"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { gsap } from "gsap";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ISelectionManager = powerbi.extensibility.ISelectionManager;

import { VisualFormattingSettingsModel } from "./settings";

type Tone = "plain" | "accent" | "good" | "bad";
interface Segment { tone: Tone; text: string; }

const TONES: Record<string, Tone> = { "*": "accent", "+": "good", "-": "bad" };

// "Revenue [*$39.5M], [+up 12%]" -> plain / accent / plain / good segments.
function parse(text: string): Segment[] {
    const out: Segment[] = [];
    const re = /\[([*+-])([^\]]*)\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) out.push({ tone: "plain", text: text.slice(last, m.index) });
        out.push({ tone: TONES[m[1]], text: m[2] });
        last = re.lastIndex;
    }
    if (last < text.length) out.push({ tone: "plain", text: text.slice(last) });
    return out;
}

function hexToRgba(hex: string, alpha: number): string {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
    return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})` : hex;
}

export class Visual implements IVisual {
    private events: IVisualEventService;
    private selectionManager: ISelectionManager;
    private formattingSettingsService = new FormattingSettingsService();
    private formattingSettings: VisualFormattingSettingsModel;

    private root: HTMLDivElement;
    private chip: HTMLSpanElement;
    private textEl: HTMLParagraphElement;

    private timeline: gsap.core.Timeline | null = null;
    private pendingDone: (() => void) | null = null;
    private lastSignature = "";
    private reducedMotion = false;

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();

        this.root = document.createElement("div");
        this.root.className = "insight";
        this.chip = document.createElement("span");
        this.chip.className = "insight-chip";
        this.textEl = document.createElement("p");
        this.textEl.className = "insight-text";
        this.root.appendChild(this.chip);
        this.root.appendChild(this.textEl);
        options.element.appendChild(this.root);

        options.element.addEventListener("contextmenu", e => {
            this.selectionManager.showContextMenu({}, { x: e.clientX, y: e.clientY });
            e.preventDefault();
        });
        this.reducedMotion = !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    public update(options: VisualUpdateOptions): void {
        this.events.renderingStarted(options);
        try {
            const dataView = options.dataViews?.[0];
            this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);
            const s = this.formattingSettings;

            const raw = dataView?.single?.value;
            const text = raw === null || raw === undefined ? "" : String(raw);

            // Styling
            this.textEl.style.color = s.textCard.color.value.value;
            const chipColor = s.chipCard.color.value.value;
            this.chip.style.display = s.chipCard.show.value ? "" : "none";
            this.chip.textContent = s.chipCard.label.value || "INSIGHT";
            this.chip.style.color = chipColor;
            this.chip.style.borderColor = hexToRgba(chipColor, 0.45);
            this.chip.style.backgroundColor = hexToRgba(chipColor, 0.1);

            const signature = JSON.stringify([text, s.textCard.accentColor.value.value, s.textCard.goodColor.value.value, s.textCard.badColor.value.value]);
            const changed = signature !== this.lastSignature;
            this.lastSignature = signature;

            if (changed) {
                this.renderText(text);
            }
            this.fitText(s.textCard.fontSize.value);

            this.stop();
            if (changed && text && s.animationCard.show.value && !this.reducedMotion) {
                this.play(options);
            } else {
                this.showFinal();
                this.events.renderingFinished(options);
            }
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    public destroy(): void {
        this.stop();
    }

    private renderText(text: string): void {
        const s = this.formattingSettings.textCard;
        const colors: Record<Tone, string> = {
            plain: "",
            accent: s.accentColor.value.value,
            good: s.goodColor.value.value,
            bad: s.badColor.value.value
        };
        while (this.textEl.firstChild) this.textEl.removeChild(this.textEl.firstChild);

        if (!text) {
            this.textEl.textContent = "Add a text measure to Insight text.";
            return;
        }
        for (const seg of parse(text)) {
            let parent: HTMLElement = this.textEl;
            if (seg.tone !== "plain") {
                const hl = document.createElement("span");
                hl.className = "hl";
                hl.style.color = colors[seg.tone];
                hl.style.setProperty("--hl", hexToRgba(colors[seg.tone], 0.22));
                this.textEl.appendChild(hl);
                parent = hl;
            }
            for (const part of seg.text.split(/(\s+)/)) {
                if (!part) continue;
                if (/^\s+$/.test(part)) {
                    parent.appendChild(document.createTextNode(part));
                } else {
                    const w = document.createElement("span");
                    w.className = "w";
                    w.textContent = part;
                    parent.appendChild(w);
                }
            }
        }
    }

    // Shrink the text until it fits the visual (never below 8pt).
    private fitText(maxPt: number): void {
        let size = maxPt;
        this.textEl.style.fontSize = `${size}pt`;
        while (size > 8 && this.root.scrollHeight > this.root.clientHeight + 1) {
            size -= 0.5;
            this.textEl.style.fontSize = `${size}pt`;
        }
    }

    private play(options: VisualUpdateOptions): void {
        const total = this.formattingSettings.animationCard.duration.value;
        const words = Array.from(this.textEl.querySelectorAll<HTMLElement>(".w"));
        const highlights = Array.from(this.textEl.querySelectorAll<HTMLElement>(".hl"));
        const stagger = words.length > 1 ? Math.min(0.05, (total * 0.7) / words.length) : 0;

        this.pendingDone = () => this.events.renderingFinished(options);
        const tl = gsap.timeline({ onComplete: () => { this.timeline = null; this.finishPending(); } });
        tl.fromTo(this.chip, { autoAlpha: 0, x: -8 }, { autoAlpha: 1, x: 0, duration: 0.35, ease: "power2.out" }, 0);
        tl.fromTo(words, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: "power2.out", stagger }, 0.1);
        tl.fromTo(highlights, { backgroundSize: "0% 38%" }, { backgroundSize: "100% 38%", duration: 0.5, ease: "power2.inOut", stagger: 0.12 }, ">-0.25");
        this.timeline = tl;
    }

    private showFinal(): void {
        gsap.set(this.chip, { autoAlpha: 1, x: 0 });
        gsap.set(this.textEl.querySelectorAll(".w"), { autoAlpha: 1, y: 0 });
        gsap.set(this.textEl.querySelectorAll(".hl"), { backgroundSize: "100% 38%" });
    }

    private stop(): void {
        this.timeline?.kill();
        this.timeline = null;
        this.finishPending();
    }

    private finishPending(): void {
        const done = this.pendingDone;
        this.pendingDone = null;
        if (done) done();
    }
}
