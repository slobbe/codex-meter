import Gio from "gi://Gio";
import GLib from "gi://GLib";
import {
    getBackgroundRefreshIntervalSeconds,
    readSettings,
    SETTINGS_AUTO_APPLY_BANKED_RESET,
    SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES,
} from "../preferences/settings.js";
import { UsageService } from "../codex/usage/service.js";
import { isCodexError } from "../codex/error.js";
import {
    listCodexBankedResets,
    readCachedCodexBankedResets,
    redeemCodexBankedReset,
    redeemNextCodexBankedReset,
} from "../codex/banked-resets/api.js";
import { selectCreditExpiringWithin } from "../codex/banked-resets/response.js";
import { PeriodicTask } from "./periodic-task.js";
import { formatRefreshFailure } from "./refresh-error-message.js";

const BANKED_RESET_BACKGROUND_REFRESH_SECONDS = 20 * 60;

const AUTO_APPLY_BANKED_RESET_WINDOW_MS = 60 * 60 * 1000;

export class CodexMonitor {
    onChange = null;

    constructor(settings, notify) {
        this._settings = settings;
        this._notify = notify;
        const values = readSettings(settings);
        this._autoApplyBankedReset = values.autoApplyBankedReset;
        this._usageService = new UsageService();
        this._usageRefreshTask = new PeriodicTask(values.backgroundRefreshIntervalSeconds, () =>
            this.refreshUsage(),
        );
        this._bankedResetRefreshTask = new PeriodicTask(
            BANKED_RESET_BACKGROUND_REFRESH_SECONDS,
            () => this._refreshBankedResetsIfStale(),
        );
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
        this._stopped = false;
        this._connectSettings();
    }

    get state() {
        return {
            snapshot: this._snapshot,
            prediction: this._prediction,
            history: this._history,
            errorMessage: this._errorMessage,
            cachedFailureMessage: this._cachedFailureMessage,
            bankedResetCount: this._bankedResetCount,
            redeemingBankedReset: this._redeemingBankedReset,
        };
    }

    start() {
        if (this._stopped) return;
        void this._loadCachedBankedResets();
        this._bankedResetRefreshTask.start();
        void this._loadCachedSnapshot().finally(() => {
            if (this._stopped) return;
            this._usageRefreshTask.start({ runImmediately: true });
        });
    }

    stop() {
        this._stopped = true;
        this._usageRefreshTask.stop();
        this._bankedResetRefreshTask.stop();
        this._refreshCancellable?.cancel();
        this._refreshCancellable = null;
        this._bankedResetRefreshCancellable?.cancel();
        this._bankedResetRefreshCancellable = null;
        this._redeemBankedResetCancellable?.cancel();
        this._redeemBankedResetCancellable = null;
        this._settings.disconnect(this._autoApplyChangedId);
        this._settings.disconnect(this._refreshIntervalChangedId);
        this.onChange = null;
    }

    async refreshUsage() {
        if (this._stopped) return;
        if (this._refreshPromise) {
            await this._refreshPromise;
            return;
        }
        this._refreshCancellable = new Gio.Cancellable();
        this._refreshPromise = this._refreshUsageOnce(this._refreshCancellable);
        try {
            await this._refreshPromise;
        } finally {
            this._refreshPromise = null;
            this._refreshCancellable = null;
        }
    }

    async refreshBankedResets(cancellable = null) {
        if (this._bankedResetRefreshPromise) {
            await this._bankedResetRefreshPromise;
            return;
        }
        const refreshCancellable = cancellable ?? new Gio.Cancellable();
        if (!cancellable) this._bankedResetRefreshCancellable = refreshCancellable;
        this._bankedResetRefreshPromise = this._refreshBankedResetsOnce(refreshCancellable);
        try {
            await this._bankedResetRefreshPromise;
        } finally {
            this._bankedResetRefreshPromise = null;
            if (this._bankedResetRefreshCancellable === refreshCancellable) {
                this._bankedResetRefreshCancellable = null;
            }
        }
    }

    async redeemBankedReset() {
        if (this._stopped || this._redeemingBankedReset) return;
        if (this._bankedResetCount !== null && this._bankedResetCount <= 0) {
            this._notify("No banked Codex resets are available to redeem.");
            return;
        }
        const cancellable = new Gio.Cancellable();
        this._redeemingBankedReset = true;
        this._redeemBankedResetCancellable = cancellable;
        this._emitChange();
        try {
            await redeemNextCodexBankedReset({ cancellable });
            if (this._stopped) return;
            this._notify("Banked Codex reset redeemed.");
            await this.refreshBankedResets(cancellable);
            await this.refreshUsage();
        } catch (error) {
            if (this._stopped && isCancellationError(error)) return;
            this._notify(formatBankedResetFailure(error));
        } finally {
            if (this._redeemBankedResetCancellable === cancellable) {
                this._redeemBankedResetCancellable = null;
            }
            if (this._stopped) return;
            this._redeemingBankedReset = false;
            this._emitChange();
        }
    }

    _connectSettings() {
        this._autoApplyChangedId = this._settings.connect(
            `changed::${SETTINGS_AUTO_APPLY_BANKED_RESET}`,
            () => {
                const enabled = this._settings.get_boolean(SETTINGS_AUTO_APPLY_BANKED_RESET);
                if (enabled && !this._autoApplyBankedReset) {
                    void this.refreshBankedResets();
                }
                this._autoApplyBankedReset = enabled;
            },
        );
        this._refreshIntervalChangedId = this._settings.connect(
            `changed::${SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES}`,
            () => {
                this._usageRefreshTask.setIntervalSeconds(
                    getBackgroundRefreshIntervalSeconds(this._settings),
                );
            },
        );
    }

    async _refreshUsageOnce(cancellable) {
        try {
            if (this._stopped) return;
            this._snapshot = await this._usageService.refresh({ cancellable });
            if (this._stopped) return;
            await this._loadHistory();
            this._errorMessage = null;
            this._cachedFailureMessage = null;
            try {
                this._prediction = await this._usageService.predict(this._snapshot);
            } catch (error) {
                this._prediction = null;
            }
        } catch (error) {
            if (this._stopped && isCancellationError(error)) return;
            const failureMessage = formatRefreshFailure(error);
            if (this._snapshot) {
                this._errorMessage = null;
                this._cachedFailureMessage = failureMessage;
            } else {
                const loadedCachedSnapshot =
                    !this._stopped && (await this._loadCachedSnapshotAfterFailure());
                if (loadedCachedSnapshot) {
                    this._errorMessage = null;
                    this._cachedFailureMessage = failureMessage;
                } else {
                    this._errorMessage = failureMessage;
                    this._cachedFailureMessage = null;
                }
            }
        } finally {
            if (!this._stopped) this._emitChange();
        }
    }

    async _loadCachedSnapshot() {
        if (this._stopped || this._snapshot || this._errorMessage) return;
        try {
            const snapshot = await this._usageService.readCachedSnapshot();
            if (this._stopped || !snapshot || this._snapshot || this._errorMessage) return;
            this._snapshot = snapshot;
            await this._loadHistory();
            try {
                this._prediction = await this._usageService.predict(snapshot);
            } catch (error) {
                this._prediction = null;
            }
            if (!this._stopped) this._emitChange();
        } catch (error) {}
    }

    async _loadCachedBankedResets() {
        if (this._stopped) return;
        try {
            const snapshot = await readCachedCodexBankedResets();
            if (this._stopped || !snapshot) return;
            this._bankedResetCount = Math.max(0, snapshot.available_count);
            this._lastBankedResetRefreshAt = snapshot.fetchedAt;
            this._emitChange();
        } catch (error) {}
    }

    async _loadCachedSnapshotAfterFailure() {
        if (this._stopped) return false;
        try {
            const snapshot = await this._usageService.readCachedSnapshot();
            if (this._stopped || !snapshot) return false;
            if (this._snapshot) return true;
            this._snapshot = snapshot;
            await this._loadHistory();
            try {
                this._prediction = await this._usageService.predict(snapshot);
            } catch (error) {
                this._prediction = null;
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    async _loadHistory() {
        try {
            this._history = await this._usageService.readHistory();
        } catch (error) {
            this._history = [];
        }
    }

    async _refreshBankedResetsIfStale() {
        if (!this._shouldRefreshBankedResets()) return;
        await this.refreshBankedResets();
    }

    _shouldRefreshBankedResets() {
        if (this._stopped) return false;
        if (this._bankedResetCount === null || !this._lastBankedResetRefreshAt) return true;
        const nowSeconds = Math.floor(Date.now() / 1000);
        return (
            nowSeconds - this._lastBankedResetRefreshAt >= BANKED_RESET_BACKGROUND_REFRESH_SECONDS
        );
    }

    async _refreshBankedResetsOnce(cancellable = null) {
        try {
            const response = await listCodexBankedResets({ cancellable });
            if (this._stopped) return;
            this._bankedResetCount = Math.max(0, response.available_count);
            this._lastBankedResetRefreshAt = Math.floor(Date.now() / 1000);
            await this._autoApplyExpiringBankedReset(response.credits, cancellable);
            this._emitChange();
        } catch (error) {
            if (isCancellationError(error) || this._stopped) return;
            console.warn("Unable to refresh Codex banked reset count", error);
            this._bankedResetCount = null;
            this._lastBankedResetRefreshAt = null;
            this._emitChange();
        }
    }

    async _autoApplyExpiringBankedReset(credits, cancellable) {
        if (this._stopped || this._redeemingBankedReset || !this._autoApplyBankedReset) return;
        const credit = selectCreditExpiringWithin(
            credits,
            Date.now(),
            AUTO_APPLY_BANKED_RESET_WINDOW_MS,
        );
        if (!credit) return;
        this._redeemingBankedReset = true;
        this._emitChange();
        try {
            await redeemCodexBankedReset(credit.id, { cancellable });
            if (this._stopped) return;
            this._bankedResetCount = Math.max(0, (this._bankedResetCount ?? 1) - 1);
            this._notify("Expiring banked Codex reset applied automatically.");
            await this.refreshUsage();
        } catch (error) {
            if (this._stopped && isCancellationError(error)) return;
            console.warn("Unable to auto-apply expiring Codex banked reset", error);
        } finally {
            if (!this._stopped) {
                this._redeemingBankedReset = false;
                this._emitChange();
            }
        }
    }

    _emitChange() {
        this.onChange?.(this.state);
    }
}

function formatBankedResetFailure(error) {
    if (isCodexError(error)) return error.message;
    const message =
        error instanceof Error && error.message ? error.message : "Unknown banked reset failure";
    return `Banked Codex reset redemption failed: ${message}`;
}

function isCancellationError(error) {
    return error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}
