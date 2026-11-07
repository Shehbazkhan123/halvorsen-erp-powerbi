"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import Card = formattingSettings.SimpleCard;
import Slice = formattingSettings.Slice;
import Model = formattingSettings.Model;

class TitleCard extends Card {
    show = new formattingSettings.ToggleSwitch({ name: "show", displayName: "Show", value: true });
    text = new formattingSettings.TextInput({
        name: "text",
        displayName: "Text",
        value: "",
        placeholder: "Defaults to the Value field name"
    });
    fontSize = new formattingSettings.NumUpDown({ name: "fontSize", displayName: "Text size", value: 12 });
    color = new formattingSettings.ColorPicker({ name: "color", displayName: "Color", value: { value: "#605E5C" } });

    name = "title";
    displayName = "Title";
    topLevelSlice = this.show;
    slices: Slice[] = [this.text, this.fontSize, this.color];
}

const HEADLINE_MODES: powerbi.IEnumMember[] = [
    { value: "latest", displayName: "Latest period" },
    { value: "sum", displayName: "Sum of periods" },
    { value: "average", displayName: "Average of periods" }
];

class ValueCard extends Card {
    headlineMode = new formattingSettings.ItemDropdown({
        name: "headlineMode",
        displayName: "Headline value",
        description: "With a Trend axis: show the latest period, or the sum/average of all periods shown. Use Sum only for additive measures (revenue, spend, units), not % or distinct counts.",
        items: HEADLINE_MODES,
        value: HEADLINE_MODES[0]
    });
    fontSize = new formattingSettings.NumUpDown({ name: "fontSize", displayName: "Text size", value: 32 });
    color = new formattingSettings.ColorPicker({ name: "color", displayName: "Color", value: { value: "#252423" } });
    displayUnits = new formattingSettings.AutoDropdown({ name: "displayUnits", displayName: "Display units", value: 0 });
    decimalPlaces = new formattingSettings.NumUpDown({
        name: "decimalPlaces",
        displayName: "Decimal places (scaled units)",
        value: 1,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 4 }
        }
    });

    name = "valueText";
    displayName = "Value";
    slices: Slice[] = [this.headlineMode, this.fontSize, this.color, this.displayUnits, this.decimalPlaces];
}

class ComparisonCard extends Card {
    show = new formattingSettings.ToggleSwitch({ name: "show", displayName: "Show", value: true });
    label = new formattingSettings.TextInput({
        name: "label",
        displayName: "Label",
        value: "",
        placeholder: "Defaults to 'vs <Comparison field>'"
    });
    higherIsBetter = new formattingSettings.ToggleSwitch({
        name: "higherIsBetter",
        displayName: "Higher is better",
        value: true
    });
    goodColor = new formattingSettings.ColorPicker({ name: "goodColor", displayName: "Favorable color", value: { value: "#107C10" } });
    badColor = new formattingSettings.ColorPicker({ name: "badColor", displayName: "Unfavorable color", value: { value: "#D13438" } });
    labelColor = new formattingSettings.ColorPicker({
        name: "labelColor",
        displayName: "Secondary text color",
        description: "Comparison label and period caption. Use a light grey on dark backgrounds.",
        value: { value: "#605E5C" }
    });

    name = "comparisonText";
    displayName = "Comparison";
    topLevelSlice = this.show;
    slices: Slice[] = [this.label, this.higherIsBetter, this.goodColor, this.badColor, this.labelColor];
}

class SparklineCard extends Card {
    show = new formattingSettings.ToggleSwitch({ name: "show", displayName: "Show", value: true });
    color = new formattingSettings.ColorPicker({ name: "color", displayName: "Line color", value: { value: "#118DFF" } });
    showArea = new formattingSettings.ToggleSwitch({ name: "showArea", displayName: "Area fill", value: true });
    pulse = new formattingSettings.ToggleSwitch({ name: "pulse", displayName: "Pulse latest point", value: true });

    name = "sparkline";
    displayName = "Sparkline";
    topLevelSlice = this.show;
    slices: Slice[] = [this.color, this.showArea, this.pulse];
}

const EASINGS: powerbi.IEnumMember[] = [
    { value: "power3.out", displayName: "Smooth" },
    { value: "expo.out", displayName: "Snappy" },
    { value: "back.out(1.6)", displayName: "Overshoot" },
    { value: "elastic.out(1, 0.6)", displayName: "Elastic" },
    { value: "none", displayName: "Linear" }
];

class AnimationCard extends Card {
    show = new formattingSettings.ToggleSwitch({ name: "show", displayName: "Animate", value: true });
    duration = new formattingSettings.NumUpDown({
        name: "duration",
        displayName: "Duration (seconds)",
        value: 1.2,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.1 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 5 }
        }
    });
    easing = new formattingSettings.ItemDropdown({
        name: "easing",
        displayName: "Easing",
        items: EASINGS,
        value: EASINGS[0]
    });

    name = "animation";
    displayName = "Animation";
    topLevelSlice = this.show;
    slices: Slice[] = [this.duration, this.easing];
}

export class VisualFormattingSettingsModel extends Model {
    titleCard = new TitleCard();
    valueCard = new ValueCard();
    comparisonCard = new ComparisonCard();
    sparklineCard = new SparklineCard();
    animationCard = new AnimationCard();

    cards = [this.titleCard, this.valueCard, this.comparisonCard, this.sparklineCard, this.animationCard];
}
