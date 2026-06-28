import Clutter from "gi://Clutter";
import St from "gi://St";

import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import {
    calculateBarFillWidth,
    calculateBarMarkerPosition,
    getUsageBarColorStyleClass,
} from "./view-model.js";

const BASELINE_MARKER_WIDTH = 3;
const POPUP_CONTENT_WIDTH = 285;
const TREND_BAR_COUNT = 56;
const TREND_BAR_MAX_HEIGHT = 28;
const TREND_BAR_MIN_HEIGHT = 3;
export class CodexMeterPopupMenu {
    headerItem: any;
    errorItem: any;
    primaryItem: any;
    secondaryItem: any;
    trendItem: any;
    footerItem: any;

    private _onRefresh: () => void;
    private _onRedeemBankedReset: () => void;
    private _onOpenPreferences: () => void;

    constructor({ onRefresh, onRedeemBankedReset, onOpenPreferences }) {
        this._onRefresh = onRefresh;
        this._onRedeemBankedReset = onRedeemBankedReset;
        this._onOpenPreferences = onOpenPreferences;

        this.headerItem = this._createHeaderItem();
        this.errorItem = this._createErrorItem();
        this.primaryItem = this._createUsageItem("Session (5h)");
        this.secondaryItem = this._createUsageItem("Week");
        this.trendItem = this._createTrendItem();
        this.footerItem = this._createFooterItem();
    }

    addToMenu(menu) {
        menu.addMenuItem(this.headerItem);
        menu.addMenuItem(this.errorItem);
        menu.addMenuItem(this.primaryItem);
        menu.addMenuItem(this.secondaryItem);
        menu.addMenuItem(this.trendItem);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addMenuItem(this.footerItem);
    }

    syncBars() {
        this._updateUsageBar(this.primaryItem);
        this._updateUsageBar(this.secondaryItem);
    }

    setTrend(viewModel) {
        this.trendItem.visible = viewModel.visible;

        for (let index = 0; index < this.trendItem.bars.length; index += 1) {
            const bar = this.trendItem.bars[index];
            const value = viewModel.bars[index] ?? 0;

            bar.visible = index < viewModel.bars.length;
            bar.height = value > 0
                ? Math.round(TREND_BAR_MAX_HEIGHT * (value / 100))
                : TREND_BAR_MIN_HEIGHT;

            if (value > 0) {
                bar.remove_style_class_name("cx-trend-bar-empty");
            } else {
                bar.add_style_class_name("cx-trend-bar-empty");
            }
        }
    }

    setUsageItem(item, viewModel) {
        item.titleLabel.text = viewModel.title;
        item.valueLabel.text = `${viewModel.value} ${viewModel.percentLabel}`;
        item.predictionLabel.text = viewModel.prediction;
        item.resetLabel.text = viewModel.reset;
        setPredictionStyleClass(item.predictionLabel, viewModel.predictionStyle);
        item.percentValue = viewModel.percentValue;
        item.displayPercentValue = viewModel.displayPercentValue;
        item.baselinePercentValue = viewModel.baselinePercentValue;
        item.displayBaselinePercentValue = viewModel.displayBaselinePercentValue;
        this._updateUsageBarColor(item);
        this._updateUsageBar(item);
    }

    setError(message) {
        const hasError = Boolean(message);

        this.errorItem.visible = hasError;
        this.primaryItem.visible = !hasError;
        this.secondaryItem.visible = !hasError;
        this.trendItem.visible = !hasError && this.trendItem.visible;
        this.errorItem.message = message ?? "";
        this.errorItem.messageLabel.text = message ?? "";
    }

    setBankedResets({ count, visible, redeeming }) {
        const canRedeem = !redeeming && count !== null && count > 0;

        this.headerItem.redeemButton.visible = visible && count !== null;
        this.headerItem.redeemButton.reactive = canRedeem;
        this.headerItem.redeemButton.can_focus = canRedeem;
        this.headerItem.redeemButton.opacity = canRedeem ? 255 : 150;
        this.headerItem.redeemButtonLabel.text = redeeming
            ? "Resetting…"
            : `Reset limits (${count ?? 0})`;
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
            text: "",
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
        item.displayPercentValue = 0;
        item.baselinePercentValue = null;
        item.displayBaselinePercentValue = null;
        item.predictionLabel = predictionLabel;
        item.resetLabel = resetLabel;

        return item;
    }

    private _createTrendItem() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        }) as any;

        const row = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-trend-row",
        });

        const titleLabel = new St.Label({
            text: "Usage Trend",
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-usage-heading cx-trend-title",
        });

        const sparklineBox = new St.BoxLayout({
            y_align: Clutter.ActorAlign.END,
            style_class: "cx-trend-sparkline",
        });
        const bars = [];

        for (let index = 0; index < TREND_BAR_COUNT; index += 1) {
            const bar = new St.Widget({
                y_align: Clutter.ActorAlign.END,
                style_class: "cx-trend-bar",
            });

            bar.height = 0;
            bar.visible = false;
            bars.push(bar);
            sparklineBox.add_child(bar);
        }

        row.add_child(titleLabel);
        row.add_child(sparklineBox);
        item.add_child(row);
        item.titleLabel = titleLabel;
        item.sparklineBox = sparklineBox;
        item.bars = bars;
        item.visible = false;

        return item;
    }

    private _createErrorItem() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        }) as any;

        const box = new St.BoxLayout({
            vertical: true,
            style_class: "cx-error-menu-item",
        });
        box.width = POPUP_CONTENT_WIDTH;

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

        const messageLabel = new St.Label({
            text: "",
            x_expand: true,
            style_class: "cx-error-message",
        });
        messageLabel.width = POPUP_CONTENT_WIDTH;
        messageLabel.clutter_text.line_wrap = true;
        messageLabel.clutter_text.ellipsize = 0;

        headingBox.add_child(icon);
        headingBox.add_child(titleLabel);
        box.add_child(headingBox);
        box.add_child(messageLabel);
        item.add_child(box);
        item.visible = false;
        item.message = "";
        item.messageLabel = messageLabel;

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

        const redeemButtonLabel = new St.Label({
            text: "Reset limits (0)",
            y_align: Clutter.ActorAlign.CENTER,
        });

        const redeemButton = new St.Button({
            child: redeemButtonLabel,
            style_class: "cx-reset-button",
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        redeemButton.connect("clicked", () => {
            if (!redeemButton.reactive) return;

            this._onRedeemBankedReset();
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
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-header-detail",
        });

        topRow.add_child(redeemButton);
        topRow.add_child(datetimeLabel);
        topRow.add_child(refreshButton);
        box.add_child(topRow);
        item.add_child(box);
        item.datetimeLabel = datetimeLabel;
        item.redeemButton = redeemButton;
        item.redeemButtonLabel = redeemButtonLabel;
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
            item.displayPercentValue,
        );
        item.barMarker.width = BASELINE_MARKER_WIDTH;
        item.barMarker.height = item.barOverlay.height;
        item.barMarker.visible = Number.isFinite(item.baselinePercentValue);
        item.barMarker.x = calculateBarMarkerPosition(
            item.barOverlay.width,
            item.barMarker.width,
            item.displayBaselinePercentValue,
        );
        item.barMarker.y = 1;
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
