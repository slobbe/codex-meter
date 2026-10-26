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
import { UsageRing } from "./usage-ring.js";
import { createMenuViewModel, createPanelBarViewModel } from "./view-model.js";

const BANKED_RESET_POPUP_REFRESH_MAX_AGE_MS = 5 * 60 * 1000;

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
        this._usageRing = new UsageRing(this._codexIcon.gicon);
        this._panelBars = this._createPanelBars();
        this._panelBox.add_child(this._prefixLabel);
        this._panelBox.add_child(this._codexIcon);
        this._panelBox.add_child(this._openAiIcon);
        this._panelBox.add_child(this._usageRing.actor);
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
        this._monitor.cancelBankedResetPreparation();
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

            onRedeemBankedReset: (creditId) => {
                void this._confirmBankedReset(creditId);
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
        this._panelUsageBars = [];
        return box;
    }

    _connectSignals() {
        this._menuOpenChangedId = this.menu.connect("open-state-changed", (_menu, isOpen) => {
            if (isOpen) {
                this._queueMenuBarSync();
                void this._monitor.refreshBankedResets({
                    maxAgeMs: BANKED_RESET_POPUP_REFRESH_MAX_AGE_MS,
                });
            }
        });
        this._settingsChangedId = this._settings.connect("changed", () => {
            this._syncLabel();
            this._syncMenu();
        });
    }

    async _refreshUsage() {
        if (this._destroyed) return;
        this._popupMenu.setRefreshing(true);
        try {
            await this._monitor.refreshUsage();
        } finally {
            if (!this._destroyed) this._popupMenu.setRefreshing(false);
        }
    }

    async _confirmBankedReset(creditId) {
        if (
            this._destroyed ||
            this._resetConfirmationDialog ||
            this._monitor.state.preparingBankedReset ||
            this._monitor.state.redeemingBankedReset
        )
            return;
        const credit = await this._monitor.prepareBankedReset(creditId);
        if (this._destroyed) {
            if (credit) this._monitor.cancelBankedResetPreparation();
            return;
        }
        if (!credit) return;
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
            onCancel: () => {
                clearDialog();
                this._monitor.cancelBankedResetPreparation();
            },
        });
        this._resetConfirmationDialog = dialog;
        if (!dialog) this._monitor.cancelBankedResetPreparation();
    }

    async _redeemBankedReset(creditId) {
        if (this._destroyed) return;
        this._popupMenu.setRefreshing(true);
        try {
            await this._monitor.redeemBankedReset(creditId);
        } finally {
            if (!this._destroyed) this._popupMenu.setRefreshing(false);
        }
    }

    _syncLabel() {
        const settings = readSettings(this._settings);
        const { snapshot, errorMessage } = this._monitor.state;
        const viewModel = createPanelBarViewModel(settings, snapshot, errorMessage);
        while (this._panelUsageBars.length > viewModel.bars.length) {
            this._panelUsageBars.pop().actor.destroy();
        }
        while (this._panelUsageBars.length < viewModel.bars.length) {
            const bar = new UsageBar("panel");
            this._panelBars.add_child(bar.actor);
            this._panelUsageBars.push(bar);
        }
        const barCount = viewModel.bars.length;
        for (let index = 0; index < barCount; index += 1) {
            const bar = this._panelUsageBars[index];
            bar.actor.set_style(barCount > 1 ? `height: ${0.52 / barCount}em;` : null);
            bar.update({
                percentValue: viewModel.bars[index].percentValue,
                displayPercentValue: viewModel.bars[index].displayPercentValue,
            });
        }
        // Keep the two-bar stack's total spacing as the collection grows.
        this._panelBars.set_style(barCount > 2 ? `spacing: ${3 / (barCount - 1)}px;` : null);
        const ringStyle = settings.topPanelIndicatorIcon === "codex-ring";
        const showRing = ringStyle && viewModel.showBars && barCount > 0 && barCount <= 2;
        this._usageRing.update(showRing ? viewModel.bars : []);
        this._usageRing.actor.visible = showRing;
        this._panelBars.visible = viewModel.showBars && !showRing;
        if (barCount > 1) {
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
        this._codexIcon.visible =
            settings.topPanelIndicatorIcon === "codex" || (ringStyle && !showRing);
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
            bankedResetSnapshot,
            bankedResetLoading,
            bankedResetError,
            preparingBankedReset,
            preparingBankedResetId,
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
        this._popupMenu.setUsageItems(viewModel.usageItems);
        this._popupMenu.setTrend(viewModel.trend);
        this._popupMenu.setBankedResets({
            count: bankedResetCount,
            snapshot: bankedResetSnapshot,
            loading: bankedResetLoading,
            error: bankedResetError,
            preparing: preparingBankedReset,
            preparingId: preparingBankedResetId,
            redeeming: redeemingBankedReset,
        });
        this._popupMenu.headerItem.planLabel.text = viewModel.accountType;
        this._popupMenu.setRefreshLabel(viewModel.refreshLabel);
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
