"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import Card = formattingSettings.SimpleCard;
import Slice = formattingSettings.Slice;
import Model = formattingSettings.Model;

class TextCard extends Card {
    fontSize = new formattingSettings.NumUpDown({ name: "fontSize", displayName: "Text size", value: 12 });
    color = new formattingSettings.ColorPicker({ name: "color", displayName: "Text color", value: { value: "#CBD5E1" } });
    accentColor = new formattingSettings.ColorPicker({ name: "accentColor", displayName: "Accent [*...]", value: { value: "#22D3EE" } });
    goodColor = new formattingSettings.ColorPicker({ name: "goodColor", displayName: "Favorable [+...]", value: { value: "#34D399" } });
    badColor = new formattingSettings.ColorPicker({ name: "badColor", displayName: "Unfavorable [-...]", value: { value: "#FB7185" } });

    name = "text";
    displayName = "Text";
    slices: Slice[] = [this.fontSize, this.color, this.accentColor, this.goodColor, this.badColor];
}

class ChipCard extends Card {
    show = new formattingSettings.ToggleSwitch({ name: "show", displayName: "Show", value: true });
    label = new formattingSettings.TextInput({ name: "label", displayName: "Label", value: "INSIGHT", placeholder: "INSIGHT" });
    color = new formattingSettings.ColorPicker({ name: "color", displayName: "Color", value: { value: "#22D3EE" } });

    name = "chip";
    displayName = "Label chip";
    topLevelSlice = this.show;
    slices: Slice[] = [this.label, this.color];
}

class AnimationCard extends Card {
    show = new formattingSettings.ToggleSwitch({ name: "show", displayName: "Animate", value: true });
    duration = new formattingSettings.NumUpDown({
        name: "duration",
        displayName: "Reveal duration (seconds)",
        value: 1.4,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.2 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 6 }
        }
    });

    name = "animation";
    displayName = "Animation";
    topLevelSlice = this.show;
    slices: Slice[] = [this.duration];
}

export class VisualFormattingSettingsModel extends Model {
    textCard = new TextCard();
    chipCard = new ChipCard();
    animationCard = new AnimationCard();
    cards = [this.textCard, this.chipCard, this.animationCard];
}
