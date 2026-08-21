import Clutter from "gi://Clutter";
import St from "gi://St";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { createIconButton, createTextButton } from "./button.js";
import { UsageBar } from "./usage-bar.js";

const POPUP_CONTENT_WIDTH = 285;

const TREND_BAR_COUNT = 56;

const TREND_BAR_MAX_HEIGHT = 28;

const TREND_BAR_MIN_HEIGHT = 3;

const TREND_BAR_SPACING = 2;

export class CodexMeterPopupMenu {
    constructor({ onRefresh, onRedeemBankedReset, onOpenPreferences }) {
        this._onRefresh = onRefresh;
        this._onRedeemBankedReset = onRedeemBankedReset;
        this._onOpenPreferences = onOpenPreferences;
        this.headerItem = this._createHeaderItem();
        this.errorItem = this._createErrorItem();
        this.statusItem = this._createStatusItem();
        this.primaryItem = this._createUsageItem("Session (5h)");
        this.secondaryItem = this._createUsageItem("Week");
        this.trendItem = this._createTrendItem();
        this.footerItem = this._createFooterItem();
    }

    addToMenu(menu) {
        menu.addMenuItem(this.headerItem);
        menu.addMenuItem(this.errorItem);
        menu.addMenuItem(this.statusItem);
        menu.addMenuItem(this.primaryItem);
        menu.addMenuItem(this.secondaryItem);
        menu.addMenuItem(this.trendItem);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addMenuItem(this.footerItem);
    }

    syncBars() {
        this.primaryItem.usageBar.sync();
        this.secondaryItem.usageBar.sync();
    }

    setTrend(viewModel) {
        this.trendItem.visible = viewModel.visible;
        this.trendItem.titleLabel.text = viewModel.title;
        this._updateTrendBarWidths();
        for (let index = 0; index < this.trendItem.bars.length; index += 1) {
            const bar = this.trendItem.bars[index];
            const value = viewModel.bars[index] ?? 0;
            bar.visible = index < viewModel.bars.length;
            bar.height =
                value > 0 ? Math.round(TREND_BAR_MAX_HEIGHT * (value / 100)) : TREND_BAR_MIN_HEIGHT;
            if (value > 0) {
                bar.remove_style_class_name("cx-trend-bar-empty");
            } else {
                bar.add_style_class_name("cx-trend-bar-empty");
            }
        }
    }

    setUsageItem(item, viewModel) {
        item.visible = viewModel.visible;
        item.titleLabel.text = viewModel.title;
        item.valueLabel.text = `${viewModel.value} ${viewModel.percentLabel}`;
        item.predictionLabel.text = viewModel.prediction;
        item.resetLabel.text = viewModel.reset;
        setPredictionStyleClass(item.predictionLabel, viewModel.predictionStyle);
        item.usageBar.update({
            percentValue: viewModel.percentValue,
            displayPercentValue: viewModel.displayPercentValue,
            displayBaselinePercentValue: viewModel.displayBaselinePercentValue,
        });
    }

    setError(message) {
        const showError = Boolean(message);
        this.errorItem.visible = showError;
        this.primaryItem.visible = !showError;
        this.secondaryItem.visible = !showError;
        this.trendItem.visible = !showError && this.trendItem.visible;
        this.errorItem.messageLabel.text = message ?? "";
    }

    setStatus({ title, message, visible }) {
        this.statusItem.visible = Boolean(visible);
        this.statusItem.titleLabel.text = title ?? "";
        this.statusItem.messageLabel.text = message ?? "";
    }

    setBankedResets({ count, redeeming }) {
        const canRedeem = !redeeming && count !== null && count > 0;
        this.headerItem.redeemButton.visible = count !== null;
        this.headerItem.redeemButton.reactive = canRedeem;
        this.headerItem.redeemButton.can_focus = canRedeem;
        this.headerItem.redeemButton.opacity = canRedeem ? 255 : 150;
        this.headerItem.redeemButtonLabel.text = redeeming
            ? "Resetting…"
            : `Reset limits (${count ?? 0})`;
    }

    _createUsageItem(title) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
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
        const usageBar = new UsageBar("menu");
        const detailBox = new St.BoxLayout({
            x_expand: true,
            style_class: "cx-usage-detail",
        });
        const predictionLabel = new St.Label({
            text: "",
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-usage-prediction",
        });
        const resetLabel = new St.Label({
            text: "resets in --",
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-usage-detail-muted",
        });
        detailBox.add_child(predictionLabel);
        detailBox.add_child(resetLabel);
        headingBox.add_child(titleLabel);
        headingBox.add_child(valueLabel);
        box.add_child(headingBox);
        box.add_child(usageBar.actor);
        box.add_child(detailBox);
        item.add_child(box);
        item.titleLabel = titleLabel;
        item.valueLabel = valueLabel;
        item.usageBar = usageBar;
        item.predictionLabel = predictionLabel;
        item.resetLabel = resetLabel;
        return item;
    }

    _createTrendItem() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        const box = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: "cx-trend-row",
        });
        const titleLabel = new St.Label({
            text: "Weekly activity",
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-usage-heading cx-trend-title",
        });
        const sparklineBox = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.END,
            style_class: "cx-trend-sparkline",
        });
        sparklineBox.connect("notify::width", () => {
            this._updateTrendBarWidths();
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
        box.add_child(titleLabel);
        box.add_child(sparklineBox);
        item.add_child(box);
        item.titleLabel = titleLabel;
        item.sparklineBox = sparklineBox;
        item.bars = bars;
        item.visible = false;
        return item;
    }

    _createErrorItem() {
        return this._createBannerItem({
            iconName: "dialog-error-symbolic",
            title: "Unable to load usage",
            colorStyleClass: "cx-color-danger",
            messageStyleClass: "cx-error-message-danger",
        });
    }

    _createStatusItem() {
        return this._createBannerItem({
            iconName: "dialog-warning-symbolic",
            title: "",
            colorStyleClass: "cx-color-warning",
            messageStyleClass: "cx-error-message-warning",
        });
    }

    _createBannerItem({ iconName, title, colorStyleClass, messageStyleClass }) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
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
            icon_name: iconName,
            style_class: `popup-menu-icon ${colorStyleClass}`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const titleLabel = new St.Label({
            text: title,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: `cx-error-title ${colorStyleClass}`,
        });
        const messageLabel = new St.Label({
            text: "",
            x_expand: true,
            style_class: `cx-error-message ${messageStyleClass}`,
        });
        messageLabel.clutter_text.line_wrap = true;
        messageLabel.clutter_text.ellipsize = 0;
        headingBox.add_child(icon);
        headingBox.add_child(titleLabel);
        box.add_child(headingBox);
        box.add_child(messageLabel);
        item.add_child(box);
        item.visible = false;
        item.titleLabel = titleLabel;
        item.messageLabel = messageLabel;
        return item;
    }

    _createHeaderItem() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
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
        const { button: redeemButton, label: redeemButtonLabel } = createTextButton({
            text: "Reset limits (0)",
            styleClass: "cx-reset-button",
            onClick: (button) => {
                if (!button.reactive) return;
                this._onRedeemBankedReset();
            },
        });
        const { button: refreshButton, icon: refreshIcon } = createIconButton({
            iconName: "view-refresh-symbolic",
            accessibleName: "Refresh usage",
            styleClass: "cx-footer-button",
            onClick: () => this._onRefresh(),
        });
        refreshIcon.set_pivot_point(0.5, 0.5);
        topRow.add_child(redeemButton);
        topRow.add_child(new St.Widget({ x_expand: true }));
        topRow.add_child(refreshButton);
        box.add_child(topRow);
        item.add_child(box);
        item.redeemButton = redeemButton;
        item.redeemButtonLabel = redeemButtonLabel;
        item.refreshIcon = refreshIcon;
        item.refreshButton = refreshButton;
        return item;
    }

    _createFooterItem() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
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
        const { button: settingsButton } = createIconButton({
            iconName: "preferences-system-symbolic",
            accessibleName: "Open preferences",
            styleClass: "cx-footer-button",
            onClick: () => this._onOpenPreferences(),
        });
        box.add_child(planLabel);
        box.add_child(settingsButton);
        item.add_child(box);
        item.planLabel = planLabel;
        return item;
    }

    _updateTrendBarWidths() {
        if (!this.trendItem?.sparklineBox || !this.trendItem?.bars) return;
        const visibleBars = this.trendItem.bars.length;
        if (visibleBars <= 0 || this.trendItem.sparklineBox.width <= 0) return;
        const totalSpacing = TREND_BAR_SPACING * Math.max(0, visibleBars - 1);
        const availableWidth = Math.max(
            visibleBars,
            this.trendItem.sparklineBox.width - totalSpacing,
        );
        const baseBarWidth = Math.max(1, Math.floor(availableWidth / visibleBars));
        const extraPixels = Math.max(0, availableWidth - baseBarWidth * visibleBars);
        for (let index = 0; index < this.trendItem.bars.length; index += 1) {
            this.trendItem.bars[index].width = baseBarWidth + (index < extraPixels ? 1 : 0);
        }
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
