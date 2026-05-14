import Clutter from "gi://Clutter";
import St from "gi://St";

import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import {
    calculateBarFillWidth,
    calculateBarMarkerPosition,
    getUsageBarColorStyleClass,
} from "./view-model.js";

const BASELINE_MARKER_WIDTH = 3;
const BASELINE_MARKER_VERTICAL_INSET = 1;

export class CodexMeterPopupMenu {
    headerItem: any;
    errorItem: any;
    primaryItem: any;
    secondaryItem: any;
    footerItem: any;

    private _onRefresh: () => void;
    private _onOpenPreferences: () => void;

    constructor({ onRefresh, onOpenPreferences }) {
        this._onRefresh = onRefresh;
        this._onOpenPreferences = onOpenPreferences;

        this.headerItem = this._createHeaderItem();
        this.errorItem = this._createErrorItem();
        this.primaryItem = this._createUsageItem("Session (5h)");
        this.secondaryItem = this._createUsageItem("Week");
        this.footerItem = this._createFooterItem();
    }

    addToMenu(menu) {
        menu.addMenuItem(this.headerItem);
        menu.addMenuItem(this.errorItem);
        menu.addMenuItem(this.primaryItem);
        menu.addMenuItem(this.secondaryItem);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addMenuItem(this.footerItem);
    }

    syncBars() {
        this._updateUsageBar(this.primaryItem);
        this._updateUsageBar(this.secondaryItem);
    }

    setUsageItem(item, viewModel) {
        item.titleLabel.text = viewModel.title;
        item.valueLabel.text = `${viewModel.value} used`;
        item.predictionLabel.text = viewModel.prediction;
        item.resetLabel.text = viewModel.reset;
        setPredictionStyleClass(item.predictionLabel, viewModel.predictionStyle);
        item.percentValue = viewModel.percentValue;
        item.baselinePercentValue = viewModel.baselinePercentValue;
        this._updateUsageBarColor(item);
        this._updateUsageBar(item);
    }

    setError(message) {
        const hasError = Boolean(message);

        this.errorItem.visible = hasError;
        this.primaryItem.visible = !hasError;
        this.secondaryItem.visible = !hasError;
        this.errorItem.message = message ?? "";
        this.errorItem.messageLabel.text = message ?? "";
    }

    private _createUsageItem(title) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        }) as any;

        const box = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: "cx-usage-menu-item",
        });

        const headingBox = new St.BoxLayout({
            x_expand: true,
            style_class: "cx-usage-heading-row",
        });

        const titleLabel = new St.Label({
            text: title,
            style_class: "cx-usage-heading cx-usage-title",
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const valueLabel = new St.Label({
            text: "-- used",
            style_class: "cx-usage-heading cx-usage-value",
            y_align: Clutter.ActorAlign.CENTER,
        });

        const barTrack = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-usage-bar-track",
        });

        const barOverlay = new St.Widget({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-usage-bar-overlay",
            layout_manager: new Clutter.FixedLayout(),
        });

        const barFill = new St.Widget({
            y_expand: true,
            style_class: "cx-usage-bar-fill",
        });
        const barSpacer = new St.Widget({
            x_expand: true,
        });

        const barMarker = new St.Widget({
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.FILL,
            y_expand: true,
            style_class: "cx-usage-bar-marker",
        });

        barFill.width = 0;
        barMarker.width = BASELINE_MARKER_WIDTH;
        barMarker.visible = false;
        barTrack.add_child(barFill);
        barTrack.add_child(barSpacer);
        barOverlay.add_child(barTrack);
        barOverlay.add_child(barMarker);
        barOverlay.connect("notify::width", () => {
            this._updateUsageBar(item);
        });
        barOverlay.connect("notify::height", () => {
            this._updateUsageBar(item);
        });

        const detailBox = new St.BoxLayout({
            x_expand: true,
            style_class: "cx-usage-detail",
        });
        const resetLabel = new St.Label({
            text: "resets in --",
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-usage-detail-muted",
        });
        const predictionLabel = new St.Label({
            text: "Trend: --",
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-usage-prediction",
        });

        detailBox.add_child(resetLabel);
        detailBox.add_child(predictionLabel);

        headingBox.add_child(titleLabel);
        headingBox.add_child(valueLabel);

        box.add_child(headingBox);
        box.add_child(barOverlay);
        box.add_child(detailBox);
        item.add_child(box);
        item.titleLabel = titleLabel;
        item.valueLabel = valueLabel;
        item.barOverlay = barOverlay;
        item.barTrack = barTrack;
        item.barFill = barFill;
        item.barMarker = barMarker;
        item.percentValue = 0;
        item.baselinePercentValue = null;
        item.predictionLabel = predictionLabel;
        item.resetLabel = resetLabel;

        return item;
    }

    private _createErrorItem() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        }) as any;

        const box = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: "cx-error-menu-item",
        });

        const headingBox = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-error-heading-row",
        });

        const icon = new St.Icon({
            icon_name: "dialog-error-symbolic",
            style_class: "popup-menu-icon cx-color-danger",
            y_align: Clutter.ActorAlign.CENTER,
        });

        const titleLabel = new St.Label({
            text: "Unable to load usage",
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-error-title cx-color-danger",
        });

        const copyButton = new St.Button({
            child: new St.Icon({
                icon_name: "edit-copy-symbolic",
                style_class: "popup-menu-icon",
            }),
            style_class: "cx-footer-button",
            can_focus: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        copyButton.connect("clicked", () => {
            copyTextToClipboard(item.message);
        });

        const messageLabel = new St.Label({
            text: "",
            x_expand: true,
            style_class: "cx-error-message",
        });
        messageLabel.clutter_text.line_wrap = true;
        messageLabel.clutter_text.ellipsize = 0;

        headingBox.add_child(icon);
        headingBox.add_child(titleLabel);
        headingBox.add_child(copyButton);
        box.add_child(headingBox);
        box.add_child(messageLabel);
        item.add_child(box);
        item.visible = false;
        item.message = "";
        item.messageLabel = messageLabel;
        item.copyButton = copyButton;

        return item;
    }

    private _createHeaderItem() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        }) as any;

        const box = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: "cx-header-item",
        });

        const topRow = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-header-row",
        });

        const refreshButton = new St.Button({
            child: new St.Icon({
                icon_name: "view-refresh-symbolic",
                style_class: "popup-menu-icon",
            }),
            style_class: "cx-footer-button",
            can_focus: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const refreshIcon = refreshButton.child;
        refreshIcon.set_pivot_point(0.5, 0.5);
        refreshButton.connect("clicked", () => {
            this._onRefresh();
        });

        const datetimeLabel = new St.Label({
            text: "--",
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-header-detail",
        });

        topRow.add_child(datetimeLabel);
        topRow.add_child(refreshButton);
        box.add_child(topRow);
        item.add_child(box);
        item.datetimeLabel = datetimeLabel;
        item.refreshIcon = refreshIcon;
        item.refreshButton = refreshButton;

        return item;
    }

    private _createFooterItem() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        }) as any;

        const box = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-footer-row",
        });

        const planLabel = new St.Label({
            text: "--",
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-footer-label",
        });

        const settingsButton = new St.Button({
            child: new St.Icon({
                icon_name: "preferences-system-symbolic",
                style_class: "popup-menu-icon",
            }),
            style_class: "cx-footer-button",
            can_focus: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        settingsButton.connect("clicked", () => {
            this._onOpenPreferences();
        });

        box.add_child(planLabel);
        box.add_child(settingsButton);
        item.add_child(box);
        item.planLabel = planLabel;
        item.settingsButton = settingsButton;

        return item;
    }

    private _updateUsageBar(item) {
        item.barTrack.height = item.barOverlay.height;
        item.barTrack.width = item.barOverlay.width;
        item.barFill.width = calculateBarFillWidth(
            item.barOverlay.width,
            item.percentValue,
        );
        item.barMarker.height = Math.max(
            0,
            item.barOverlay.height - BASELINE_MARKER_VERTICAL_INSET * 2,
        );
        item.barMarker.visible = Number.isFinite(item.baselinePercentValue);
        item.barMarker.x = calculateBarMarkerPosition(
            item.barOverlay.width,
            item.barMarker.width,
            item.baselinePercentValue,
        );
        item.barMarker.y = BASELINE_MARKER_VERTICAL_INSET + 1;
    }

    private _updateUsageBarColor(item) {
        removeColorStyleClasses(item.barFill);

        item.barFill.add_style_class_name(
            getUsageBarColorStyleClass(item.percentValue),
        );
    }
}

function setPredictionStyleClass(label, style) {
    removeColorStyleClasses(label);

    label.add_style_class_name(getPredictionColorStyleClass(style));
}

function getPredictionColorStyleClass(style) {
    if (style === "safe") return "cx-color-green";
    if (style === "muted") return "cx-muted";

    return `cx-color-${style}`;
}

function removeColorStyleClasses(actor) {
    actor.remove_style_class_name("cx-color-green");
    actor.remove_style_class_name("cx-color-warning");
    actor.remove_style_class_name("cx-color-danger");
    actor.remove_style_class_name("cx-muted");
}

function copyTextToClipboard(text) {
    if (!text) return;

    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
}
