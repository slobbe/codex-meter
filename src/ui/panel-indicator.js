import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import { SettingsService } from "../app/settings.js";
import { Scheduler } from "../app/scheduler.js";
import { UsageService } from "../app/usage.js";
import { DEFAULT_PROVIDER_ID, getUsageProvider } from "../infra/providers/index.js";
import { isRefreshFailureError } from "../domain/refresh-failure.js";
import { listCodexBankedResets, readCachedCodexBankedResets, redeemCodexBankedReset, redeemNextCodexBankedReset, } from "../infra/providers/codex_banked_resets.js";
import { selectCreditExpiringWithin } from "../infra/providers/codex_banked_reset_response.js";
import { CodexMeterPopupMenu } from "./popup-menu.js";
import { formatRefreshFailure } from "./refresh-error-message.js";
import { UsageBar } from "./usage-bar.js";
import { createMenuViewModel, createPanelBarViewModel, } from "./view-model.js";
const BANKED_RESET_BACKGROUND_REFRESH_SECONDS = 20 * 60;
const AUTO_APPLY_BANKED_RESET_WINDOW_MS = 60 * 60 * 1000;
export class CodexMeterIndicator extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }
    constructor(extension) {
        super(0.0, "CodexMeter");
        this._extension = extension;
        this._settings = new SettingsService(extension.getSettings());
        this._providerId = this._settings.getUsageProvider();
        this._autoApplyBankedReset = this._settings.getAutoApplyBankedReset();
        this._usageService = createUsageService(this._providerId);
        this._scheduler = new Scheduler(this._settings.getBackgroundRefreshIntervalSeconds(), () => this._refreshUsage());
        this._bankedResetScheduler = new Scheduler(BANKED_RESET_BACKGROUND_REFRESH_SECONDS, () => this._refreshBankedResetsIfStale());
        this._refreshSpinId = 0;
        this._menuSyncId = 0;
        this._refreshPromise = null;
        this._refreshCancellable = null;
        this._snapshot = null;
        this._prediction = null;
        this._history = [];
        this._errorMessage = null;
        this._cachedFailureMessage = null;
        this._bankedResetCount = null;
        this._lastBankedResetRefreshAt = null;
        this._bankedResetRefreshPromise = null;
        this._bankedResetRefreshCancellable = null;
        this._redeemingBankedReset = false;
        this._redeemBankedResetCancellable = null;
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
        if (this._destroyed)
            return;
        this._syncLabel();
        this._syncMenu();
        void this._loadCachedBankedResets();
        this._bankedResetScheduler.start();
        void this._loadCachedSnapshot().finally(() => {
            if (this._destroyed)
                return;
            this._scheduler.start({ runImmediately: true });
        });
    }
    destroy() {
        this._destroyed = true;
        this._scheduler.stop();
        this._bankedResetScheduler.stop();
        this._cancelRefresh();
        this._cancelBankedResetRefresh();
        this._cancelBankedResetRedemption();
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
            onRedeemBankedReset: () => {
                void this._redeemBankedReset();
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
        this.menu.setSourceAlignment(0.0);
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
                void this._refreshBankedResets();
            }
        });
        this._settingsChangedId = this._settings.connectChanged(() => {
            const providerId = this._settings.getUsageProvider();
            const autoApplyBankedReset = this._settings.getAutoApplyBankedReset();
            if (providerId !== this._providerId) {
                this._providerId = providerId;
                this._usageService = createUsageService(providerId);
                this._snapshot = null;
                this._prediction = null;
                this._history = [];
                this._errorMessage = null;
                this._cachedFailureMessage = null;
                this._bankedResetCount = null;
                this._lastBankedResetRefreshAt = null;
                void this._loadCachedBankedResets();
                void this._loadCachedSnapshot();
            }
            if (autoApplyBankedReset && !this._autoApplyBankedReset) {
                void this._refreshBankedResets();
            }
            this._autoApplyBankedReset = autoApplyBankedReset;
            this._syncLabel();
            this._syncMenu();
        });
        this._refreshIntervalChangedId =
            this._settings.connectBackgroundRefreshIntervalChanged(() => {
                this._scheduler.setIntervalSeconds(this._settings.getBackgroundRefreshIntervalSeconds());
            });
    }
    async _refreshUsage({ manual = false } = {}) {
        if (this._destroyed)
            return;
        if (manual)
            this._startRefreshSpin();
        if (this._refreshPromise) {
            try {
                await this._refreshPromise;
            }
            finally {
                if (manual && !this._destroyed)
                    this._stopRefreshSpin();
            }
            return;
        }
        this._refreshCancellable = new Gio.Cancellable();
        this._refreshPromise = this._refreshUsageOnce(this._refreshCancellable);
        try {
            await this._refreshPromise;
        }
        finally {
            this._refreshPromise = null;
            this._refreshCancellable = null;
            if (manual && !this._destroyed)
                this._stopRefreshSpin();
        }
    }
    _cancelRefresh() {
        if (!this._refreshCancellable)
            return;
        this._refreshCancellable.cancel();
        this._refreshCancellable = null;
    }
    _cancelBankedResetRefresh() {
        if (!this._bankedResetRefreshCancellable)
            return;
        this._bankedResetRefreshCancellable.cancel();
        this._bankedResetRefreshCancellable = null;
    }
    _cancelBankedResetRedemption() {
        if (!this._redeemBankedResetCancellable)
            return;
        this._redeemBankedResetCancellable.cancel();
        this._redeemBankedResetCancellable = null;
    }
    async _refreshUsageOnce(cancellable) {
        try {
            if (this._destroyed)
                return;
            this._snapshot = await this._usageService.refresh({ cancellable });
            if (this._destroyed)
                return;
            await this._loadHistory();
            this._errorMessage = null;
            this._cachedFailureMessage = null;
            try {
                this._prediction = await this._usageService.predict(this._snapshot);
            }
            catch (error) {
                this._prediction = null;
            }
        }
        catch (error) {
            if (this._destroyed && isCancellationError(error))
                return;
            const failureMessage = formatRefreshFailure(error);
            if (this._snapshot) {
                this._errorMessage = null;
                this._cachedFailureMessage = failureMessage;
            }
            else {
                const loadedCachedSnapshot = !this._destroyed && await this._loadCachedSnapshotAfterFailure();
                if (loadedCachedSnapshot) {
                    this._errorMessage = null;
                    this._cachedFailureMessage = failureMessage;
                }
                else {
                    this._errorMessage = failureMessage;
                    this._cachedFailureMessage = null;
                }
            }
        }
        finally {
            if (this._destroyed)
                return;
            this._syncLabel();
            this._syncMenu();
        }
    }
    async _loadCachedSnapshot() {
        if (this._destroyed || this._snapshot || this._errorMessage)
            return;
        try {
            const snapshot = await this._usageService.readCachedSnapshot();
            if (this._destroyed ||
                !snapshot ||
                this._snapshot ||
                this._errorMessage) {
                return;
            }
            this._snapshot = snapshot;
            await this._loadHistory();
            try {
                this._prediction = await this._usageService.predict(snapshot);
            }
            catch (error) {
                this._prediction = null;
            }
            if (this._destroyed)
                return;
            this._syncLabel();
            this._syncMenu();
        }
        catch (error) { }
    }
    async _loadCachedBankedResets() {
        if (this._destroyed || this._providerId !== "codex")
            return;
        try {
            const snapshot = await readCachedCodexBankedResets();
            if (this._destroyed || !snapshot || this._providerId !== "codex")
                return;
            this._bankedResetCount = Math.max(0, snapshot.available_count);
            this._lastBankedResetRefreshAt = snapshot.fetchedAt;
            this._syncMenu();
        }
        catch (error) { }
    }
    async _loadCachedSnapshotAfterFailure() {
        if (this._destroyed)
            return false;
        try {
            const snapshot = await this._usageService.readCachedSnapshot();
            if (this._destroyed || !snapshot)
                return false;
            if (this._snapshot)
                return true;
            this._snapshot = snapshot;
            await this._loadHistory();
            try {
                this._prediction = await this._usageService.predict(snapshot);
            }
            catch (error) {
                this._prediction = null;
            }
            return true;
        }
        catch (error) {
            return false;
        }
    }
    async _loadHistory() {
        try {
            this._history = await this._usageService.readHistory();
        }
        catch (error) {
            this._history = [];
        }
    }
    async _refreshBankedResets(cancellable = null) {
        if (this._providerId !== "codex") {
            this._bankedResetCount = null;
            this._lastBankedResetRefreshAt = null;
            return;
        }
        if (this._bankedResetRefreshPromise) {
            await this._bankedResetRefreshPromise;
            return;
        }
        const refreshCancellable = cancellable ?? new Gio.Cancellable();
        if (!cancellable)
            this._bankedResetRefreshCancellable = refreshCancellable;
        this._bankedResetRefreshPromise = this._refreshBankedResetsOnce(refreshCancellable);
        try {
            await this._bankedResetRefreshPromise;
        }
        finally {
            this._bankedResetRefreshPromise = null;
            if (this._bankedResetRefreshCancellable === refreshCancellable) {
                this._bankedResetRefreshCancellable = null;
            }
        }
    }
    async _refreshBankedResetsIfStale() {
        if (!this._shouldRefreshBankedResets())
            return;
        await this._refreshBankedResets();
    }
    _shouldRefreshBankedResets() {
        if (this._destroyed || this._providerId !== "codex")
            return false;
        if (this._bankedResetCount === null || !this._lastBankedResetRefreshAt)
            return true;
        const nowSeconds = Math.floor(Date.now() / 1000);
        return nowSeconds - this._lastBankedResetRefreshAt >= BANKED_RESET_BACKGROUND_REFRESH_SECONDS;
    }
    async _refreshBankedResetsOnce(cancellable = null) {
        try {
            const response = await listCodexBankedResets({ cancellable });
            if (this._destroyed || this._providerId !== "codex")
                return;
            this._bankedResetCount = Math.max(0, response.available_count);
            this._lastBankedResetRefreshAt = Math.floor(Date.now() / 1000);
            await this._autoApplyExpiringBankedReset(response.credits, cancellable);
            this._syncMenu();
        }
        catch (error) {
            if (isCancellationError(error))
                return;
            if (this._destroyed)
                return;
            console.warn("Unable to refresh Codex banked reset count", error);
            this._bankedResetCount = null;
            this._lastBankedResetRefreshAt = null;
            this._syncMenu();
        }
    }
    async _autoApplyExpiringBankedReset(credits, cancellable) {
        if (this._destroyed ||
            this._redeemingBankedReset ||
            !this._settings.getAutoApplyBankedReset()) {
            return;
        }
        const credit = selectCreditExpiringWithin(credits, Date.now(), AUTO_APPLY_BANKED_RESET_WINDOW_MS);
        if (!credit)
            return;
        this._redeemingBankedReset = true;
        this._syncMenu();
        try {
            await redeemCodexBankedReset(credit.id, { cancellable });
            if (this._destroyed)
                return;
            this._bankedResetCount = Math.max(0, (this._bankedResetCount ?? 1) - 1);
            notify("Codex Meter", "Expiring banked Codex reset applied automatically.");
            await this._refreshUsage();
        }
        catch (error) {
            if (this._destroyed && isCancellationError(error))
                return;
            console.warn("Unable to auto-apply expiring Codex banked reset", error);
        }
        finally {
            if (!this._destroyed) {
                this._redeemingBankedReset = false;
                this._syncMenu();
            }
        }
    }
    async _redeemBankedReset() {
        if (this._destroyed || this._redeemingBankedReset)
            return;
        if (this._providerId !== "codex") {
            notify("Codex Meter", "Banked resets are only available for Codex usage.");
            return;
        }
        if (this._bankedResetCount !== null && this._bankedResetCount <= 0) {
            notify("Codex Meter", "No banked Codex resets are available to redeem.");
            return;
        }
        const cancellable = new Gio.Cancellable();
        this._redeemingBankedReset = true;
        this._redeemBankedResetCancellable = cancellable;
        this._syncMenu();
        try {
            await redeemNextCodexBankedReset({ cancellable });
            if (this._destroyed)
                return;
            notify("Codex Meter", "Banked Codex reset redeemed.");
            await this._refreshBankedResets(cancellable);
            await this._refreshUsage({ manual: true });
        }
        catch (error) {
            if (this._destroyed && isCancellationError(error))
                return;
            notify("Codex Meter", formatBankedResetFailure(error));
        }
        finally {
            if (this._redeemBankedResetCancellable === cancellable) {
                this._redeemBankedResetCancellable = null;
            }
            if (this._destroyed)
                return;
            this._redeemingBankedReset = false;
            this._syncMenu();
        }
    }
    _startRefreshSpin() {
        if (!this._headerItem?.refreshIcon || this._refreshSpinId)
            return;
        this._headerItem.refreshButton.reactive = false;
        this._headerItem.refreshButton.can_focus = false;
        this._refreshSpinId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
            if (this._destroyed)
                return GLib.SOURCE_REMOVE;
            this._headerItem.refreshIcon.rotation_angle_z =
                (this._headerItem.refreshIcon.rotation_angle_z + 18) % 360;
            return GLib.SOURCE_CONTINUE;
        });
    }
    _stopRefreshSpin() {
        if (this._refreshSpinId) {
            GLib.source_remove(this._refreshSpinId);
            this._refreshSpinId = 0;
        }
        if (!this._headerItem?.refreshIcon)
            return;
        this._headerItem.refreshIcon.rotation_angle_z = 0;
        this._headerItem.refreshButton.reactive = true;
        this._headerItem.refreshButton.can_focus = true;
    }
    _syncLabel() {
        const settings = this._settings.getAll();
        const viewModel = createPanelBarViewModel(settings, this._snapshot, this._errorMessage);
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
        }
        else {
            this._panelBars.remove_style_class_name("cx-panel-bars-stacked");
        }
        this._label.visible = viewModel.showLabel && viewModel.label !== "";
        this._label.text = viewModel.label;
        if (viewModel.label.includes("/")) {
            this._label.add_style_class_name("cx-usage-label-wide");
        }
        else {
            this._label.remove_style_class_name("cx-usage-label-wide");
        }
        this._prefixLabel.visible = settings.topPanelIndicatorIcon === "text";
        this._codexIcon.visible = settings.topPanelIndicatorIcon === "codex";
        this._openAiIcon.visible = settings.topPanelIndicatorIcon === "openai";
    }
    _syncMenu() {
        const viewModel = createMenuViewModel(this._settings.getAll(), this._snapshot, this._prediction, this._history, this._errorMessage, this._cachedFailureMessage);
        this._headerItem.datetimeLabel.text = viewModel.updatedAt;
        this._headerItem.datetimeLabel.visible = false;
        this._popupMenu.setError(viewModel.errorMessage);
        this._popupMenu.setStatus({
            title: viewModel.statusTitle,
            message: viewModel.statusMessage,
            visible: Boolean(viewModel.statusTitle || viewModel.statusMessage),
        });
        this._setUsageItem(this._primaryItem, viewModel.primary);
        this._setUsageItem(this._secondaryItem, viewModel.secondary);
        this._popupMenu.setTrend(viewModel.trend);
        this._popupMenu.setBankedResets({
            count: this._bankedResetCount,
            visible: this._providerId === "codex",
            redeeming: this._redeemingBankedReset,
        });
        this._footerItem.planLabel.text = viewModel.plan;
    }
    _queueMenuBarSync() {
        if (this._menuSyncId)
            return;
        this._menuSyncId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._menuSyncId = 0;
            this._popupMenu.syncBars();
            return GLib.SOURCE_REMOVE;
        });
    }
    _setUsageItem(item, viewModel) {
        this._popupMenu.setUsageItem(item, viewModel);
    }
}
function createUsageService(providerId) {
    try {
        return new UsageService(getUsageProvider(providerId));
    }
    catch (error) {
        console.warn(`Usage provider "${providerId}" is not supported yet; falling back to ${DEFAULT_PROVIDER_ID}.`, error);
        return new UsageService(getUsageProvider(DEFAULT_PROVIDER_ID));
    }
}
function formatBankedResetFailure(error) {
    if (isRefreshFailureError(error)) {
        return error.message;
    }
    const message = error instanceof Error && error.message
        ? error.message
        : "Unknown banked reset failure";
    return `Banked Codex reset redemption failed: ${message}`;
}
function notify(title, message) {
    Main.notify(title, message);
}
function isCancellationError(error) {
    return (error instanceof GLib.Error &&
        error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED));
}
