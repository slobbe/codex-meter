import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";

import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";

import { SettingsService } from "../app/settings.js";
import { Scheduler } from "../app/scheduler.js";
import { UsageService } from "../app/usage.js";
import { isRefreshFailureError } from "../domain/refresh-failure.js";
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
        this._codexIcon = new St.Icon({
            gicon: new Gio.FileIcon({
                file: Gio.File.new_for_path(
                    `${this._extension.path}/icons/codex-symbolic.svg`,
                ),
            }),
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-panel-icon",
        });
        this._openAiIcon = new St.Icon({
            gicon: new Gio.FileIcon({
                file: Gio.File.new_for_path(
                    `${this._extension.path}/icons/openai-symbolic.svg`,
                ),
            }),
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-panel-icon",
        });

        this._label = new St.Label({
            text: "--",
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-usage-label",
        });

        this._panelBars = this._createPanelBars();

        this._panelBox.add_child(this._prefixLabel);
        this._panelBox.add_child(this._codexIcon);
        this._panelBox.add_child(this._openAiIcon);
        this._panelBox.add_child(this._label);
        this._panelBox.add_child(this._panelBars);
        this.add_child(this._panelBox);
        this._buildMenu();
        this._connectSignals();

        this._syncLabel();
        this._syncMenu();
        void this._loadCachedSnapshot().finally(() => {
            this._scheduler.start({ runImmediately: true });
        });
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
        this._primaryItem = this._popupMenu.primaryItem;
        this._secondaryItem = this._popupMenu.secondaryItem;
        this._footerItem = this._popupMenu.footerItem;

        this._popupMenu.addToMenu(this.menu);
    }

    _createPanelBars() {
        const box = new St.BoxLayout({
            vertical: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-panel-bars",
        });

        this._panelPrimaryBar = this._createPanelBar();
        this._panelSecondaryBar = this._createPanelBar();

        box.add_child(this._panelPrimaryBar.barTrack);
        box.add_child(this._panelSecondaryBar.barTrack);

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
            this._errorMessage = formatRefreshFailure(error);
            console.error("Unable to refresh Codex usage", error);

            if (!this._snapshot) {
                await this._loadCachedSnapshotAfterFailure();
            }
        } finally {
            this._syncLabel();
            this._syncMenu();
        }
    }

    async _loadCachedSnapshot() {
        if (this._snapshot || this._errorMessage) return;

        try {
            const snapshot = await this._usageService.readCachedSnapshot();

            if (!snapshot || this._snapshot || this._errorMessage) return;

            this._snapshot = snapshot;

            try {
                this._prediction = await this._usageService.predict(snapshot);
            } catch (error) {
                this._prediction = null;
                console.error("Unable to predict cached Codex usage", error);
            }

            this._syncLabel();
            this._syncMenu();
        } catch (error) {
            console.error("Unable to load cached Codex usage", error);
        }
    }

    async _loadCachedSnapshotAfterFailure() {
        try {
            const snapshot = await this._usageService.readCachedSnapshot();

            if (!snapshot || this._snapshot) return;

            this._snapshot = snapshot;

            try {
                this._prediction = await this._usageService.predict(snapshot);
            } catch (error) {
                this._prediction = null;
                console.error("Unable to predict cached Codex usage", error);
            }
        } catch (error) {
            console.error("Unable to load cached Codex usage after refresh failure", error);
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

        this._panelPrimaryBar.barTrack.visible = viewModel.primaryVisible;
        this._panelSecondaryBar.barTrack.visible = viewModel.secondaryVisible;
        this._panelPrimaryBar.percentValue = viewModel.primaryPercent;
        this._panelSecondaryBar.percentValue = viewModel.secondaryPercent;
        this._panelBars.visible = viewModel.showBars;
        if (viewModel.primaryVisible && viewModel.secondaryVisible) {
            this._panelBars.add_style_class_name("cx-panel-bars-stacked");
        } else {
            this._panelBars.remove_style_class_name("cx-panel-bars-stacked");
        }
        this._label.visible = viewModel.showLabel && viewModel.label !== "";
        this._label.text = viewModel.label;
        if (viewModel.label.includes("/")) {
            this._label.add_style_class_name("cx-usage-label-wide");
        } else {
            this._label.remove_style_class_name("cx-usage-label-wide");
        }
        this._prefixLabel.visible = settings.topPanelIndicatorIcon === "text";
        this._codexIcon.visible = settings.topPanelIndicatorIcon === "codex";
        this._openAiIcon.visible = settings.topPanelIndicatorIcon === "openai";

        this._updateUsageBarColor(this._panelPrimaryBar);
        this._updateUsageBarColor(this._panelSecondaryBar);
        this._updateUsageBar(this._panelPrimaryBar);
        this._updateUsageBar(this._panelSecondaryBar);
    }

    _syncMenu() {
        const viewModel = createMenuViewModel(
            this._snapshot,
            this._prediction,
            this._errorMessage,
        );

        this._headerItem.datetimeLabel.text = viewModel.updatedAt;
        this._popupMenu.setError(viewModel.errorMessage);
        this._setUsageItem(this._primaryItem, viewModel.primary);
        this._setUsageItem(this._secondaryItem, viewModel.secondary);
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
        item.barFill.remove_style_class_name("cx-color-green");
        item.barFill.remove_style_class_name("cx-color-warning");
        item.barFill.remove_style_class_name("cx-color-danger");
        item.barFill.remove_style_class_name("cx-muted");

        item.barFill.add_style_class_name(
            getUsageBarColorStyleClass(item.percentValue),
        );
    }
}

function formatRefreshFailure(error: unknown): string {
    if (isRefreshFailureError(error)) {
        return `${error.message}\n\nDetails: ${error.technicalMessage}`;
    }

    const message = error instanceof Error && error.message
        ? error.message
        : "Unknown refresh failure";

    return `Codex usage refresh failed.\n\nDetails: ${message}`;
}
