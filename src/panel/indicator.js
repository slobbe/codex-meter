import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import { readSettings } from "../preferences/settings.js";
import { CodexMeterPopupMenu } from "./menu.js";
import { showBankedResetConfirmation } from "./reset-confirmation.js";
import { UsageBar } from "./usage-bar.js";
import { createMenuViewModel, createPanelBarViewModel } from "./view-model.js";

export class CodexMeterIndicator extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    constructor(extension, monitor) {
        super(0.5, "CodexMeter");
        this._extension = extension;
        this._settings = extension.getSettings();
        this._monitor = monitor;
        this._monitor.onChange = () => {
            if (this._destroyed) return;
            this._syncLabel();
            this._syncMenu();
        };
        this._refreshSpinId = 0;
        this._menuSyncId = 0;
        this._resetConfirmationDialog = null;
        this._destroyed = false;
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
                file: Gio.File.new_for_path(`${this._extension.path}/icons/codex-symbolic.svg`),
            }),
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-panel-icon",
        });
        this._openAiIcon = new St.Icon({
            gicon: new Gio.FileIcon({
                file: Gio.File.new_for_path(`${this._extension.path}/icons/openai-symbolic.svg`),
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
    }

    start() {
        if (this._destroyed) return;
        this._syncLabel();
        this._syncMenu();
    }

    destroy() {
        this._destroyed = true;
        this._monitor.onChange = null;
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
        this._resetConfirmationDialog?.destroy();
        this._resetConfirmationDialog = null;

        super.destroy();
    }

    _buildMenu() {
        this._popupMenu = new CodexMeterPopupMenu({
            onRefresh: () => {
                void this._refreshUsage();
            },
            onRedeemBankedReset: () => {
                void this._confirmBankedReset();
            },
            onOpenPreferences: () => {
                this.menu.close();
                this._extension.openPreferences();
            },
        });
        this._popupMenu.addToMenu(this.menu);
    }

    _createPanelBars() {
        const box = new St.BoxLayout({
            vertical: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-panel-bars",
        });
        this._panelPrimaryBar = new UsageBar("panel");
        this._panelSecondaryBar = new UsageBar("panel");
        box.add_child(this._panelPrimaryBar.actor);
        box.add_child(this._panelSecondaryBar.actor);
        return box;
    }

    _connectSignals() {
        this._menuOpenChangedId = this.menu.connect("open-state-changed", (_menu, isOpen) => {
            if (isOpen) {
                this._queueMenuBarSync();
                void this._monitor.refreshBankedResets();
            }
        });
        this._settingsChangedId = this._settings.connect("changed", () => {
            this._syncLabel();
            this._syncMenu();
        });
    }

    async _refreshUsage() {
        if (this._destroyed) return;
        this._startRefreshSpin();
        try {
            await this._monitor.refreshUsage();
        } finally {
            if (!this._destroyed) this._stopRefreshSpin();
        }
    }

    async _confirmBankedReset() {
        if (this._destroyed || this._resetConfirmationDialog) return;
        const credit = await this._monitor.prepareBankedReset();
        if (this._destroyed || !credit) return;
        this.menu.close();
        let dialog = null;
        const clearDialog = () => {
            if (this._resetConfirmationDialog === dialog) this._resetConfirmationDialog = null;
        };
        dialog = showBankedResetConfirmation(credit, {
            onConfirm: () => {
                clearDialog();
                void this._redeemBankedReset(credit.id);
            },
            onCancel: clearDialog,
        });
        this._resetConfirmationDialog = dialog;
    }

    async _redeemBankedReset(creditId) {
        if (this._destroyed) return;
        this._startRefreshSpin();
        try {
            await this._monitor.redeemBankedReset(creditId);
        } finally {
            if (!this._destroyed) this._stopRefreshSpin();
        }
    }

    _startRefreshSpin() {
        if (!this._popupMenu.headerItem?.refreshIcon || this._refreshSpinId) return;
        this._popupMenu.headerItem.refreshButton.reactive = false;
        this._popupMenu.headerItem.refreshButton.can_focus = false;
        this._refreshSpinId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
            if (this._destroyed) return GLib.SOURCE_REMOVE;
            this._popupMenu.headerItem.refreshIcon.rotation_angle_z =
                (this._popupMenu.headerItem.refreshIcon.rotation_angle_z + 18) % 360;
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopRefreshSpin() {
        if (this._refreshSpinId) {
            GLib.source_remove(this._refreshSpinId);
            this._refreshSpinId = 0;
        }
        if (!this._popupMenu.headerItem?.refreshIcon) return;
        this._popupMenu.headerItem.refreshIcon.rotation_angle_z = 0;
        this._popupMenu.headerItem.refreshButton.reactive = true;
        this._popupMenu.headerItem.refreshButton.can_focus = true;
    }

    _syncLabel() {
        const settings = readSettings(this._settings);
        const { snapshot, errorMessage } = this._monitor.state;
        const viewModel = createPanelBarViewModel(settings, snapshot, errorMessage);
        this._panelPrimaryBar.actor.visible = viewModel.primaryVisible;
        this._panelSecondaryBar.actor.visible = viewModel.secondaryVisible;
        this._panelPrimaryBar.update({
            percentValue: viewModel.primaryPercent,
            displayPercentValue: viewModel.primaryDisplayPercent,
        });
        this._panelSecondaryBar.update({
            percentValue: viewModel.secondaryPercent,
            displayPercentValue: viewModel.secondaryDisplayPercent,
        });
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
    }

    _syncMenu() {
        const {
            snapshot,
            prediction,
            history,
            errorMessage,
            cachedFailureMessage,
            bankedResetCount,
            preparingBankedReset,
            redeemingBankedReset,
        } = this._monitor.state;
        const viewModel = createMenuViewModel(
            readSettings(this._settings),
            snapshot,
            prediction,
            history,
            errorMessage,
            cachedFailureMessage,
        );
        this._popupMenu.setError(viewModel.errorMessage);
        this._popupMenu.setStatus({
            title: viewModel.statusTitle,
            message: viewModel.statusMessage,
            visible: Boolean(viewModel.statusTitle || viewModel.statusMessage),
        });
        this._popupMenu.setUsageItem(this._popupMenu.primaryItem, viewModel.primary);
        this._popupMenu.setUsageItem(this._popupMenu.secondaryItem, viewModel.secondary);
        this._popupMenu.setTrend(viewModel.trend);
        this._popupMenu.setBankedResets({
            count: bankedResetCount,
            preparing: preparingBankedReset,
            redeeming: redeemingBankedReset,
        });
        this._popupMenu.footerItem.planLabel.text = viewModel.plan;
    }

    _queueMenuBarSync() {
        if (this._menuSyncId) return;
        this._menuSyncId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._menuSyncId = 0;
            this._popupMenu.syncBars();
            return GLib.SOURCE_REMOVE;
        });
    }
}
