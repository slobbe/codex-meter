import Clutter from "gi://Clutter";
import St from "gi://St";

import {
    calculateBarFillWidth,
    calculateBarMarkerPosition,
    getUsageBarColorStyleClass,
} from "./view-model.js";

const BASELINE_MARKER_WIDTH = 3;
const COLOR_STYLE_CLASSES = [
    "cx-color-green",
    "cx-color-warning",
    "cx-color-danger",
    "cx-muted",
];

type UsageBarVariant = "menu" | "panel";

type UsageBarState = {
    percentValue: number;
    displayPercentValue: number;
    baselinePercentValue?: number | null;
    displayBaselinePercentValue?: number | null;
};

export class UsageBar {
    readonly actor: St.Widget;

    private readonly _variant: UsageBarVariant;
    private readonly _barTrack: St.BoxLayout;
    private readonly _barFill: St.Widget;
    private readonly _barMarker: St.Widget | null;
    private _state: UsageBarState;

    constructor(variant: UsageBarVariant) {
        this._variant = variant;
        this._state = {
            percentValue: 0,
            displayPercentValue: 0,
            baselinePercentValue: null,
            displayBaselinePercentValue: null,
        };
        this._barTrack = new St.BoxLayout({
            x_expand: variant === "menu",
            y_align: Clutter.ActorAlign.CENTER,
            style_class: variant === "menu"
                ? "cx-usage-bar-track"
                : "cx-panel-bar-track",
        });
        this._barFill = new St.Widget({
            y_expand: true,
            style_class: variant === "menu"
                ? "cx-usage-bar-fill"
                : "cx-usage-bar-fill cx-panel-bar-fill",
        });
        this._barTrack.add_child(this._barFill);
        this._barTrack.add_child(new St.Widget({ x_expand: true }));

        if (variant === "menu") {
            const overlay = new St.Widget({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: "cx-usage-bar-overlay",
                layout_manager: new Clutter.FixedLayout(),
            });
            this._barMarker = new St.Widget({
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.FILL,
                y_expand: true,
                style_class: "cx-usage-bar-marker",
            });
            this._barMarker.width = BASELINE_MARKER_WIDTH;
            this._barMarker.visible = false;
            overlay.add_child(this._barTrack);
            overlay.add_child(this._barMarker);
            overlay.connect("notify::width", () => this.sync());
            overlay.connect("notify::height", () => this.sync());
            this.actor = overlay;
        } else {
            this._barMarker = null;
            this._barTrack.connect("notify::width", () => this.sync());
            this.actor = this._barTrack;
        }
    }

    update(state: UsageBarState) {
        this._state = state;
        this._syncColor();
        this.sync();
    }

    sync() {
        const width = this.actor.width;

        if (this._variant === "menu") {
            this._barTrack.width = width;
            this._barTrack.height = this.actor.height;
        }

        this._barFill.width = calculateBarFillWidth(
            width,
            this._state.displayPercentValue,
        );

        if (!this._barMarker) return;

        this._barMarker.width = BASELINE_MARKER_WIDTH;
        this._barMarker.height = this.actor.height;
        this._barMarker.visible = Number.isFinite(this._state.baselinePercentValue);
        this._barMarker.x = calculateBarMarkerPosition(
            width,
            this._barMarker.width,
            this._state.displayBaselinePercentValue,
        );
        this._barMarker.y = 1;
    }

    private _syncColor() {
        for (const styleClass of COLOR_STYLE_CLASSES) {
            this._barFill.remove_style_class_name(styleClass);
        }

        this._barFill.add_style_class_name(
            getUsageBarColorStyleClass(this._state.percentValue),
        );
    }
}
