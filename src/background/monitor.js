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
import { listCodexBankedResets, redeemCodexBankedReset } from "../codex/banked-resets/api.js";
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
            () => this._refreshBankedResetsForAutoApply(),
        );
        this._refreshPromise = null;
        this._refreshCancellable = null;
        this._snapshot = null;
        this._prediction = null;
        this._history = [];
        this._errorMessage = null;
        this._cachedFailureMessage = null;
        this._bankedResetRefreshCancellable = null;
        this._bankedResetRefreshPromise = null;
        this._bankedResetRefreshAttemptAt = null;
        this._autoApplyBankedResetCancellable = null;
        this._bankedResetSnapshot = null;
        this._bankedResetLoading = false;
        this._bankedResetError = null;
        this._preparingBankedReset = false;
        this._bankedResetPreparation = null;
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
            bankedResetCount:
                this._bankedResetSnapshot?.available_count ??
                this._snapshot?.bankedResetCount ??
                null,
            bankedResetSnapshot: this._bankedResetSnapshot,
            bankedResetLoading: this._bankedResetLoading,
            bankedResetError: this._bankedResetError,
            preparingBankedReset: this._preparingBankedReset,
            preparingBankedResetId: this._preparingBankedReset
                ? (this._bankedResetPreparation?.creditId ?? null)
                : null,
            redeemingBankedReset: this._redeemingBankedReset,
        };
    }

    start() {
        if (this._stopped) return;
        if (this._autoApplyBankedReset) {
            this._bankedResetRefreshTask.start();
        }
        void this._loadCachedSnapshot().finally(() => {
            if (this._stopped) return;
            this._usageRefreshTask.start();
        });
    }

    stop() {
        this._stopped = true;
        this._bankedResetPreparation = null;
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

    async refreshBankedResets({ maxAgeMs = 0 } = {}) {
        if (this._stopped) return null;
        if (this._bankedResetRefreshPromise) return await this._bankedResetRefreshPromise;
        const now = Date.now();
        if (
            maxAgeMs > 0 &&
            this._bankedResetRefreshAttemptAt !== null &&
            now - this._bankedResetRefreshAttemptAt < maxAgeMs
        )
            return this._bankedResetSnapshot;
        // Failed attempts also cool down popup requests; default callers always refresh.
        this._bankedResetRefreshAttemptAt = now;
        const cancellable = new Gio.Cancellable();
        this._bankedResetRefreshCancellable = cancellable;
        this._bankedResetLoading = true;
        this._bankedResetError = null;
        // Assign before notifying listeners so reentrant refreshes share this request too.
        this._bankedResetRefreshPromise = Promise.resolve().then(async () => {
            try {
                const response = await listCodexBankedResets({ cancellable });
                if (this._stopped) return null;
                this._bankedResetSnapshot = response;
                return response;
            } catch (error) {
                if (!isCancellationError(error) && !this._stopped) {
                    this._bankedResetError = formatBankedResetPreparationFailure(error);
                }
                return null;
            } finally {
                this._bankedResetRefreshPromise = null;
                this._bankedResetRefreshCancellable = null;
                this._bankedResetLoading = false;
                if (!this._stopped) this._emitChange();
            }
        });
        this._emitChange();
        return await this._bankedResetRefreshPromise;
    }

    async prepareBankedReset(creditId) {
        if (
            this._stopped ||
            this._preparingBankedReset ||
            this._bankedResetPreparation ||
            this._redeemingBankedReset
        )
            return null;
        // Ownership spans the fetch, confirmation dialog, and manual redemption.
        const preparation = { creditId };
        this._bankedResetPreparation = preparation;
        let prepared = false;
        this._preparingBankedReset = true;
        const ownsInventoryRefresh = !this._bankedResetRefreshPromise;
        this._emitChange();
        try {
            const response = await this.refreshBankedResets();
            if (this._stopped || this._bankedResetPreparation !== preparation) return null;
            if (!response) {
                this._notify(
                    this._bankedResetError ??
                        "Unable to load banked Codex reset details. Try again later.",
                );
                return null;
            }
            const credit = response.credits.find((credit) => credit.id === creditId);
            const expiresAt = Date.parse(credit?.expires_at ?? "");
            if (
                !credit ||
                credit.status !== "available" ||
                (Number.isFinite(expiresAt) && expiresAt <= Date.now())
            ) {
                this._notify(
                    "The selected banked Codex reset is no longer available. Choose another reset.",
                );
                return null;
            }
            prepared = true;
            return credit;
        } finally {
            if (!prepared && this._bankedResetPreparation === preparation) {
                this._bankedResetPreparation = null;
            }
            // Manual validation reports failures via notification, not a second inventory row.
            if (ownsInventoryRefresh) this._bankedResetError = null;
            this._preparingBankedReset = false;
            if (!this._stopped) this._emitChange();
        }
    }

    cancelBankedResetPreparation() {
        if (this._redeemingBankedReset) return;
        this._bankedResetPreparation = null;
    }

    async redeemBankedReset(creditId) {
        if (this._stopped || this._redeemingBankedReset) return;
        const cancellable = new Gio.Cancellable();
        this._redeemingBankedReset = true;
        this._redeemBankedResetCancellable = cancellable;
        this._emitChange();
        try {
            await redeemCodexBankedReset(creditId, { cancellable });
            if (this._stopped) return;
            this._notify("Banked Codex reset redeemed.");
            // A request started before redemption must finish before fetching fresh inventory.
            await this._bankedResetRefreshPromise;
            await Promise.all([this.refreshUsage(), this.refreshBankedResets()]);
        } catch (error) {
            if (this._stopped && isCancellationError(error)) return;
            this._notify(formatBankedResetFailure(error));
        } finally {
            if (this._redeemBankedResetCancellable === cancellable) {
                this._redeemBankedResetCancellable = null;
            }
            this._bankedResetPreparation = null;
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
                const wasEnabled = this._autoApplyBankedReset;
                this._autoApplyBankedReset = enabled;
                if (enabled && !wasEnabled) {
                    this._bankedResetRefreshTask.start();
                } else if (!enabled && wasEnabled) {
                    this._bankedResetRefreshTask.stop();
                    this._autoApplyBankedResetCancellable?.cancel();
                }
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
            await this._loadPrediction(this._snapshot);
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
            await this._loadPrediction(snapshot);
            if (!this._stopped) this._emitChange();
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
            await this._loadPrediction(snapshot);
            return true;
        } catch (error) {
            return false;
        }
    }

    async _loadPrediction(snapshot) {
        try {
            this._prediction = await this._usageService.predict(snapshot);
        } catch (error) {
            this._prediction = null;
        }
    }

    async _loadHistory() {
        try {
            this._history = await this._usageService.readHistory();
        } catch (error) {
            this._history = [];
        }
    }

    async _refreshBankedResetsForAutoApply() {
        const response = await this.refreshBankedResets();
        if (!response || this._stopped) return;
        const cancellable = new Gio.Cancellable();
        this._autoApplyBankedResetCancellable = cancellable;
        try {
            await this._autoApplyExpiringBankedReset(response.credits, cancellable);
        } finally {
            if (this._autoApplyBankedResetCancellable === cancellable) {
                this._autoApplyBankedResetCancellable = null;
            }
        }
    }

    async _autoApplyExpiringBankedReset(credits, cancellable) {
        if (
            this._stopped ||
            this._preparingBankedReset ||
            this._bankedResetPreparation ||
            this._redeemingBankedReset ||
            !this._autoApplyBankedReset
        )
            return;
        const credit = selectCreditExpiringWithin(
            credits,
            Date.now(),
            AUTO_APPLY_BANKED_RESET_WINDOW_MS,
        );
        if (!credit) return;
        this._redeemingBankedReset = true;
        this._redeemBankedResetCancellable = cancellable;
        this._emitChange();
        try {
            await redeemCodexBankedReset(credit.id, { cancellable });
            if (this._stopped) return;
            this._notify("Expiring banked Codex reset applied automatically.");
            await this._bankedResetRefreshPromise;
            await Promise.all([this.refreshUsage(), this.refreshBankedResets()]);
        } catch (error) {
            if (this._stopped && isCancellationError(error)) return;
            console.warn("Unable to auto-apply expiring Codex banked reset", error);
        } finally {
            if (this._redeemBankedResetCancellable === cancellable) {
                this._redeemBankedResetCancellable = null;
            }
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

function formatBankedResetPreparationFailure(error) {
    if (isCodexError(error)) return error.message;
    return "Unable to load banked Codex reset details. Try again later.";
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
