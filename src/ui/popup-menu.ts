import Clutter from "gi://Clutter";
import St from "gi://St";

import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import {
    calculateBarFillWidth,
    getUsageBarColorStyleClass,
} from "./view-model.js";

export class CodexMeterPopupMenu {
    headerItem: any;
    fiveHourItem: any;
    weeklyItem: any;
    footerItem: any;

    private _onRefresh: () => void;
    private _onOpenPreferences: () => void;

    constructor({ onRefresh, onOpenPreferences }) {
        this._onRefresh = onRefresh;
        this._onOpenPreferences = onOpenPreferences;

        this.headerItem = this._createHeaderItem();
        this.fiveHourItem = this._createUsageItem("Session (5h)");
        this.weeklyItem = this._createUsageItem("Week");
        this.footerItem = this._createFooterItem();
    }

    addToMenu(menu) {
        menu.addMenuItem(this.headerItem);
        menu.addMenuItem(this.fiveHourItem);
        menu.addMenuItem(this.weeklyItem);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addMenuItem(this.footerItem);
    }

    syncBars() {
        this._updateUsageBar(this.fiveHourItem);
        this._updateUsageBar(this.weeklyItem);
    }

    setUsageItem(item, viewModel) {
        item.titleLabel.text = viewModel.title;
        item.valueLabel.text = `${viewModel.value} used`;
        item.predictionLabel.text = viewModel.prediction;
        item.resetLabel.text = viewModel.reset;
        setPredictionStyleClass(item.predictionLabel, viewModel.predictionStyle);
        item.percentValue = viewModel.percentValue;
        this._updateUsageBarColor(item);
        this._updateUsageBar(item);
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

        const barFill = new St.Widget({
            y_expand: true,
            style_class: "cx-usage-bar-fill",
        });
        const barSpacer = new St.Widget({
            x_expand: true,
        });
        barFill.width = 0;
        barTrack.add_child(barFill);
        barTrack.add_child(barSpacer);
        barTrack.connect("notify::width", () => {
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
        box.add_child(barTrack);
        box.add_child(detailBox);
        item.add_child(box);
        item.titleLabel = titleLabel;
        item.valueLabel = valueLabel;
        item.barTrack = barTrack;
        item.barFill = barFill;
        item.percentValue = 0;
        item.predictionLabel = predictionLabel;
        item.resetLabel = resetLabel;

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
        item.barFill.width = calculateBarFillWidth(
            item.barTrack.width,
            item.percentValue,
        );
    }

    private _updateUsageBarColor(item) {
        item.barFill.remove_style_class_name("cx-usage-bar-fill-green");
        item.barFill.remove_style_class_name("cx-usage-bar-fill-orange");
        item.barFill.remove_style_class_name("cx-usage-bar-fill-red");

        item.barFill.add_style_class_name(
            getUsageBarColorStyleClass(item.percentValue),
        );
    }
}

function setPredictionStyleClass(label, style) {
    label.remove_style_class_name("cx-usage-prediction-safe");
    label.remove_style_class_name("cx-usage-prediction-warning");
    label.remove_style_class_name("cx-usage-prediction-danger");
    label.remove_style_class_name("cx-usage-prediction-muted");

    label.add_style_class_name(`cx-usage-prediction-${style}`);
}
