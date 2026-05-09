import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";

import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";

import { SettingsService } from "../app/settings.js";
import { Scheduler } from "../app/scheduler.js";
import { UsageService } from "../app/usage.js";
import { CodexMeterPopupMenu } from "./popup-menu.js";
import {
    calculateBarFillWidth,
    createMenuViewModel,
    createPanelBarViewModel,
    getUsageBarColorStyleClass,
} from "./view-model.js";

export class CodexMeterIndicator extends PanelMenu.Button {
    [key: string]: any;

    static {
        GObject.registerClass(this);
    }

    constructor(extension) {
        super(0.0, "CodexMeter");

        this._extension = extension;
        this._settings = new SettingsService(extension.getSettings());
        this._usageService = new UsageService();
        this._scheduler = new Scheduler(
            this._settings.getBackgroundRefreshIntervalSeconds(),
            () => this._refreshUsage(),
        );
        this._refreshSpinId = 0;
        this._menuSyncId = 0;
        this._refreshPromise = null;
        this._snapshot = null;
        this._prediction = null;
        this._errorMessage = null;

        this._panelBox = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-panel-box",
        });

        this._prefixLabel = new St.Label({
            text: "CX",
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-panel-prefix",
        });

        this._label = new St.Label({
            text: "--",
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-usage-label",
        });

        this._panelBars = this._createPanelBars();

        this._panelBox.add_child(this._prefixLabel);
        this._panelBox.add_child(this._label);
        this._panelBox.add_child(this._panelBars);
        this.add_child(this._panelBox);
        this._buildMenu();
        this._connectSignals();

        this._syncLabel();
        this._syncMenu();
        this._scheduler.start({ runImmediately: true });
    }

    destroy() {
        this._scheduler.stop();

        if (this._refreshSpinId) {
            GLib.source_remove(this._refreshSpinId);
            this._refreshSpinId = 0;
        }

        if (this._menuSyncId) {
            GLib.source_remove(this._menuSyncId);
            this._menuSyncId = 0;
        }

        if (this._menuOpenChangedId) {
            this.menu.disconnect(this._menuOpenChangedId);
            this._menuOpenChangedId = 0;
        }

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        if (this._refreshIntervalChangedId) {
            this._settings.disconnect(this._refreshIntervalChangedId);
            this._refreshIntervalChangedId = 0;
        }

        super.destroy();
    }

    _buildMenu() {
        this._popupMenu = new CodexMeterPopupMenu({
            onRefresh: () => {
                void this._refreshUsage({ manual: true });
            },
            onOpenPreferences: () => {
                this.menu.close();
                this._extension.openPreferences();
            },
        });

        this._headerItem = this._popupMenu.headerItem;
        this._fiveHourItem = this._popupMenu.fiveHourItem;
        this._weeklyItem = this._popupMenu.weeklyItem;
        this._footerItem = this._popupMenu.footerItem;

        this._popupMenu.addToMenu(this.menu);
    }

    _createPanelBars() {
        const box = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-panel-bars",
        });

        this._panelFiveHourBar = this._createPanelBar();
        this._panelWeeklyBar = this._createPanelBar();

        box.add_child(this._panelFiveHourBar.barTrack);
        box.add_child(this._panelWeeklyBar.barTrack);

        return box;
    }

    _createPanelBar() {
        const barTrack = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-panel-bar-track",
        });

        const barFill = new St.Widget({
            y_expand: true,
            style_class: "cx-usage-bar-fill cx-panel-bar-fill",
        });
        const barSpacer = new St.Widget({
            x_expand: true,
        });

        barFill.width = 0;
        barTrack.add_child(barFill);
        barTrack.add_child(barSpacer);

        const bar = {
            barTrack,
            barFill,
            percentValue: 0,
        };

        barTrack.connect("notify::width", () => {
            this._updateUsageBar(bar);
        });

        return bar;
    }

    _connectSignals() {
        this._menuOpenChangedId = (this.menu as any).connect(
            "open-state-changed",
            (_menu, isOpen) => {
                if (isOpen) this._queueMenuBarSync();
            },
        );

        this._settingsChangedId = this._settings.connectChanged(() => {
            this._syncLabel();
        });

        this._refreshIntervalChangedId =
            this._settings.connectBackgroundRefreshIntervalChanged(
            () => {
                this._scheduler.setIntervalSeconds(
                    this._settings.getBackgroundRefreshIntervalSeconds(),
                );
            },
            );
    }

    async _refreshUsage({ manual = false } = {}) {
        if (manual) this._startRefreshSpin();

        if (this._refreshPromise) {
            try {
                await this._refreshPromise;
            } finally {
                if (manual) this._stopRefreshSpin();
            }
            return;
        }

        this._refreshPromise = this._refreshUsageOnce();

        try {
            await this._refreshPromise;
        } finally {
            this._refreshPromise = null;
            if (manual) this._stopRefreshSpin();
        }
    }

    async _refreshUsageOnce() {
        try {
            this._snapshot = await this._usageService.refresh();
            this._errorMessage = null;

            try {
                this._prediction = await this._usageService.predict(
                    this._snapshot,
                );
            } catch (error) {
                this._prediction = null;
                console.error("Unable to predict Codex usage", error);
            }
        } catch (error) {
            this._errorMessage =
                error?.message ?? "Unable to load Codex usage.";
            console.error("Unable to refresh Codex usage", error);
        } finally {
            this._syncLabel();
            this._syncMenu();
        }
    }

    _startRefreshSpin() {
        if (!this._headerItem?.refreshIcon || this._refreshSpinId) return;

        this._headerItem.refreshButton.reactive = false;
        this._headerItem.refreshButton.can_focus = false;

        this._refreshSpinId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            30,
            () => {
                this._headerItem.refreshIcon.rotation_angle_z =
                    (this._headerItem.refreshIcon.rotation_angle_z + 18) % 360;
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    _stopRefreshSpin() {
        if (this._refreshSpinId) {
            GLib.source_remove(this._refreshSpinId);
            this._refreshSpinId = 0;
        }

        if (!this._headerItem?.refreshIcon) return;

        this._headerItem.refreshIcon.rotation_angle_z = 0;
        this._headerItem.refreshButton.reactive = true;
        this._headerItem.refreshButton.can_focus = true;
    }

    _syncLabel() {
        const settings = this._settings.getAll();
        const viewModel = createPanelBarViewModel(
            settings,
            this._snapshot,
            this._errorMessage,
        );

        this._panelFiveHourBar.barTrack.visible = viewModel.fiveHourVisible;
        this._panelWeeklyBar.barTrack.visible = viewModel.weeklyVisible;
        this._panelFiveHourBar.percentValue = viewModel.fiveHourPercent;
        this._panelWeeklyBar.percentValue = viewModel.weeklyPercent;
        this._panelBars.visible = viewModel.showBars;
        this._label.visible = viewModel.showLabel;
        this._label.text = viewModel.label;

        this._updateUsageBarColor(this._panelFiveHourBar);
        this._updateUsageBarColor(this._panelWeeklyBar);
        this._updateUsageBar(this._panelFiveHourBar);
        this._updateUsageBar(this._panelWeeklyBar);
    }

    _syncMenu() {
        const viewModel = createMenuViewModel(
            this._snapshot,
            this._prediction,
            this._errorMessage,
        );

        this._headerItem.datetimeLabel.text = viewModel.updatedAt;
        this._setUsageItem(this._fiveHourItem, viewModel.fiveHour);
        this._setUsageItem(this._weeklyItem, viewModel.weekly);
        this._footerItem.planLabel.text = viewModel.plan;
    }

    _queueMenuBarSync() {
        if (this._menuSyncId) return;

        this._menuSyncId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._menuSyncId = 0;
            this._popupMenu.syncBars();
            return GLib.SOURCE_REMOVE;
        });
    }

    _setUsageItem(item, viewModel) {
        this._popupMenu.setUsageItem(item, viewModel);
    }

    _updateUsageBar(item) {
        item.barFill.width = calculateBarFillWidth(
            item.barTrack.width,
            item.percentValue,
        );
    }

    _updateUsageBarColor(item) {
        item.barFill.remove_style_class_name("cx-usage-bar-fill-green");
        item.barFill.remove_style_class_name("cx-usage-bar-fill-orange");
        item.barFill.remove_style_class_name("cx-usage-bar-fill-red");

        item.barFill.add_style_class_name(
            getUsageBarColorStyleClass(item.percentValue),
        );
    }
}
