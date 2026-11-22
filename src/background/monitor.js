import Gio from "gi://Gio";
import {
    getBackgroundRefreshIntervalSeconds,
    readBankedResetSkipMinutes,
    readSettings,
    SETTINGS_AUTO_APPLY_BANKED_RESET,
    SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE,
    SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES,
    SETTINGS_BANKED_RESET_SKIP_MINUTES,
    SETTINGS_USAGE_NOTIFICATIONS,
    SETTINGS_USAGE_NOTIFICATION_THRESHOLD,
} from "../preferences/settings.js";
import { getBankedResetSkipMinutes, getImminentResetSeconds } from "../codex/usage/model.js";
import { UsageService } from "../codex/usage/service.js";
import { isCodexError } from "../codex/error.js";
import { isCancellationError } from "../io/files.js";
import { listCodexBankedResets, redeemCodexBankedReset } from "../codex/banked-resets/api.js";
import {
    selectCreditExpiringWithin,
    selectCreditToRedeem,
} from "../codex/banked-resets/response.js";
import { PeriodicTask } from "./periodic-task.js";
import { formatRefreshFailure } from "./refresh-error-message.js";

const BANKED_RESET_BACKGROUND_REFRESH_SECONDS = 20 * 60;

const AUTO_APPLY_BANKED_RESET_WINDOW_MS = 60 * 60 * 1000;
const ACCOUNT_EXHAUSTION = Symbol("account exhaustion");

function queueUsageAlert(notify, state, level, message, onShown) {
    // A reservation prevents duplicate banners while Shell queues the first one.
    const pending = Symbol(level);
    state[level] = pending;
    const settle = (shown) => {
        if (state[level] !== pending) return;
        state[level] = shown;
        if (shown) onShown?.();
    };
    try {
        notify(message, settle);
    } catch (error) {
        settle(false);
        throw error;
    }
}

export class CodexMonitor {
    onChange = null;

    constructor(
        settings,
        notify,
        credentialsPath = undefined,
        usageNotificationStates = new Map(),
    ) {
        this._settings = settings;
        this._credentialsPath = credentialsPath;
        this._notify = notify;
        const values = readSettings(settings);
        this._usageNotifications = values.usageNotifications;
        this._usageNotificationThreshold = values.usageNotificationThreshold;
        this._usageNotificationStates = usageNotificationStates;
        this._autoApplyBankedReset = values.autoApplyBankedReset;
        this._autoApplyBankedResetOnUsage = values.autoApplyBankedResetOnUsage;

        this._bankedResetSkipMinutes = readBankedResetSkipMinutes(settings);
        this._usageService = new UsageService(credentialsPath);
        this._usageRefreshTask = new PeriodicTask(values.backgroundRefreshIntervalSeconds, () =>
            this.refreshUsage(),
        );
        this._bankedResetRefreshTask = new PeriodicTask(
            BANKED_RESET_BACKGROUND_REFRESH_SECONDS,
            () => this._refreshBankedResetsForAutoApply(),
        );
        this._refreshPromise = null;
        this._refreshCancellable = null;
        this._usageResetGeneration = 0;
        this._deferredUsageResets = [];
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
        this._lifecycleCancellable = new Gio.Cancellable();
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
            bankedResetSkipMinutes: this._bankedResetSkipMinutes,
        };
    }

    start() {
        if (this._lifecycleCancellable.is_cancelled()) return;
        if (this._autoApplyBankedReset) {
            this._bankedResetRefreshTask.start();
        }
        void this._loadCachedSnapshot().finally(() => {
            if (this._lifecycleCancellable.is_cancelled()) return;
            this._usageRefreshTask.start();
        });
    }

    stop() {
        if (this._lifecycleCancellable.is_cancelled()) return;
        this._lifecycleCancellable.cancel();
        this._bankedResetPreparation = null;
        this._usageRefreshTask.stop();
        this._bankedResetRefreshTask.stop();
        this._autoApplyBankedResetCancellable?.cancel();
        this._refreshCancellable?.cancel();
        this._refreshCancellable = null;
        this._bankedResetRefreshCancellable?.cancel();
        this._bankedResetRefreshCancellable = null;

        this._redeemBankedResetCancellable?.cancel();
        this._redeemBankedResetCancellable = null;
        this._settings.disconnect(this._autoApplyChangedId);
        this._settings.disconnect(this._autoApplyUsageChangedId);

        this._settings.disconnect(this._bankedResetSkipMinutesChangedId);
        this._settings.disconnect(this._refreshIntervalChangedId);
        this._settings.disconnect(this._usageNotificationsChangedId);
        this._settings.disconnect(this._usageNotificationThresholdChangedId);
        // Discarded observations must not leave old reset eligibility on this path.
        for (const { snapshot } of this._deferredUsageResets) {
            for (const quota of snapshot.quotas) {
                const state = this._usageNotificationStates.get(quota.id);
                if (state) state.observedExhausted = false;
            }
        }
        // The extension retains this path's state across monitor replacements.
        this._usageNotificationStates = null;
        this._deferredUsageResets = [];
        this.onChange = null;
    }

    async refreshUsage() {
        if (this._lifecycleCancellable.is_cancelled()) return;
        if (this._refreshPromise) {
            await this._refreshPromise;
            return;
        }
        this._refreshCancellable = new Gio.Cancellable();
        this._refreshPromise = this._refreshUsageOnce(this._refreshCancellable);
        let snapshot;
        try {
            snapshot = await this._refreshPromise;
        } finally {
            this._refreshPromise = null;
            this._refreshCancellable = null;
        }
        // Release the refresh promise before redemption requests its own fresh usage.
        if (snapshot && this._usageNeedsBankedReset(snapshot)) {
            await this._refreshBankedResetsForAutoApply(snapshot);
        }
    }

    async refreshBankedResets({ maxAgeMs = 0 } = {}) {
        if (this._lifecycleCancellable.is_cancelled()) return null;
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
                cancellable.set_error_if_cancelled();
                const response = await listCodexBankedResets({
                    cancellable,
                    credentialsPath: this._credentialsPath,
                });
                if (this._lifecycleCancellable.is_cancelled()) return null;
                this._bankedResetSnapshot = response;
                return response;
            } catch (error) {
                if (!isCancellationError(error) && !this._lifecycleCancellable.is_cancelled()) {
                    this._bankedResetError = formatBankedResetPreparationFailure(error);
                }
                return null;
            } finally {
                this._bankedResetRefreshPromise = null;
                this._bankedResetRefreshCancellable = null;
                this._bankedResetLoading = false;
                if (!this._lifecycleCancellable.is_cancelled()) this._emitChange();
            }
        });
        this._emitChange();
        return await this._bankedResetRefreshPromise;
    }

    async prepareBankedReset(creditId) {
        if (
            this._lifecycleCancellable.is_cancelled() ||
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
            if (
                this._lifecycleCancellable.is_cancelled() ||
                this._bankedResetPreparation !== preparation
            )
                return null;
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
            if (!this._lifecycleCancellable.is_cancelled()) this._emitChange();
        }
    }

    cancelBankedResetPreparation() {
        if (this._redeemingBankedReset) return;
        this._bankedResetPreparation = null;
    }

    async redeemBankedReset(creditId) {
        await this._redeemBankedReset(creditId, new Gio.Cancellable());
    }

    async _redeemBankedReset(creditId, cancellable, automaticMessage = null) {
        if (this._lifecycleCancellable.is_cancelled() || this._redeemingBankedReset) return;
        this._redeemingBankedReset = true;
        this._redeemBankedResetCancellable = cancellable;
        this._emitChange();
        try {
            await redeemCodexBankedReset(creditId, {
                cancellable,
                credentialsPath: this._credentialsPath,
            });
            if (this._lifecycleCancellable.is_cancelled() || cancellable.is_cancelled()) return;
            this._usageResetGeneration++;
            this._deferredUsageResets = [];
            // Banked resets reset usage limits without identifying affected windows.
            for (const state of this._usageNotificationStates.values()) {
                state.observedExhausted = false;
            }
            this._notify(automaticMessage ?? "Banked Codex reset redeemed.");
            // Older requests must finish before the post-redemption refreshes start.
            await Promise.all([this._refreshPromise, this._bankedResetRefreshPromise]);
            if (this._lifecycleCancellable.is_cancelled() || cancellable.is_cancelled()) return;
            await Promise.all([this.refreshUsage(), this.refreshBankedResets()]);
        } catch (error) {
            if (this._lifecycleCancellable.is_cancelled() || isCancellationError(error)) return;
            if (automaticMessage) console.warn("Unable to auto-redeem Codex banked reset", error);
            else this._notify(formatBankedResetFailure(error));
        } finally {
            if (this._redeemBankedResetCancellable === cancellable) {
                this._redeemBankedResetCancellable = null;
            }
            this._bankedResetPreparation = null;
            if (this._lifecycleCancellable.is_cancelled()) return;
            this._redeemingBankedReset = false;
            const deferredResets = this._deferredUsageResets;
            this._deferredUsageResets = [];
            for (const { snapshot, observedAt } of deferredResets) {
                this._notifyUsageResets(snapshot, observedAt);
            }
            this._emitChange();
        }
    }

    _connectSettings() {
        this._usageNotificationsChangedId = this._settings.connect(
            `changed::${SETTINGS_USAGE_NOTIFICATIONS}`,
            () => {
                this._usageNotifications = this._settings.get_boolean(SETTINGS_USAGE_NOTIFICATIONS);
                this._usageNotificationStates.clear();
                this._deferredUsageResets = [];
            },
        );
        this._usageNotificationThresholdChangedId = this._settings.connect(
            `changed::${SETTINGS_USAGE_NOTIFICATION_THRESHOLD}`,
            () => {
                this._usageNotificationThreshold = this._settings.get_uint(
                    SETTINGS_USAGE_NOTIFICATION_THRESHOLD,
                );
            },
        );
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
        this._autoApplyUsageChangedId = this._settings.connect(
            `changed::${SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE}`,
            () => {
                this._autoApplyBankedResetOnUsage = this._settings.get_boolean(
                    SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE,
                );
                this._autoApplyBankedResetCancellable?.cancel();
            },
        );
        this._bankedResetSkipMinutesChangedId = this._settings.connect(
            `changed::${SETTINGS_BANKED_RESET_SKIP_MINUTES}`,
            () => {
                this._bankedResetSkipMinutes = readBankedResetSkipMinutes(this._settings);
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

    async _refreshUsageOnce(cancellable = this._lifecycleCancellable) {
        const resetGeneration = this._usageResetGeneration;
        try {
            if (this._lifecycleCancellable.is_cancelled()) return;
            const snapshot = await this._usageService.refresh({ cancellable });
            if (this._lifecycleCancellable.is_cancelled()) return;
            this._snapshot = snapshot;
            await this._loadHistory(cancellable);
            cancellable?.set_error_if_cancelled();
            this._errorMessage = null;
            this._cachedFailureMessage = null;
            await this._loadPrediction(this._snapshot, cancellable);
            cancellable?.set_error_if_cancelled();
            // A pre-redemption result must not restore old exhaustion observations.
            this._notifyUsage(snapshot, resetGeneration === this._usageResetGeneration);
            return snapshot;
        } catch (error) {
            if (this._lifecycleCancellable.is_cancelled() || isCancellationError(error)) return;
            const failureMessage = formatRefreshFailure(error);
            if (this._snapshot) {
                this._errorMessage = null;
                this._cachedFailureMessage = failureMessage;
            } else {
                const loadedCachedSnapshot =
                    !this._lifecycleCancellable.is_cancelled() &&
                    (await this._loadCachedSnapshotAfterFailure(cancellable));
                if (this._lifecycleCancellable.is_cancelled()) return;
                if (loadedCachedSnapshot) {
                    this._errorMessage = null;
                    this._cachedFailureMessage = failureMessage;
                } else {
                    this._errorMessage = failureMessage;
                    this._cachedFailureMessage = null;
                }
            }
        } finally {
            if (!this._lifecycleCancellable.is_cancelled()) this._emitChange();
        }
    }

    async _loadCachedSnapshot() {
        const cancellable = this._lifecycleCancellable;
        if (this._lifecycleCancellable.is_cancelled() || this._snapshot || this._errorMessage)
            return;
        try {
            const snapshot = await this._usageService.readCachedSnapshot({ cancellable });
            if (
                this._lifecycleCancellable.is_cancelled() ||
                !snapshot ||
                this._snapshot ||
                this._errorMessage
            )
                return;
            this._snapshot = snapshot;
            await this._loadHistory(cancellable);
            cancellable?.set_error_if_cancelled();
            await this._loadPrediction(snapshot, cancellable);
            if (!this._lifecycleCancellable.is_cancelled()) this._emitChange();
        } catch (error) {}
    }

    async _loadCachedSnapshotAfterFailure(cancellable = this._lifecycleCancellable) {
        if (this._lifecycleCancellable.is_cancelled()) return false;
        try {
            const snapshot = await this._usageService.readCachedSnapshot({ cancellable });
            if (this._lifecycleCancellable.is_cancelled() || !snapshot) return false;
            if (this._snapshot) return true;
            this._snapshot = snapshot;
            await this._loadHistory(cancellable);
            cancellable?.set_error_if_cancelled();
            await this._loadPrediction(snapshot, cancellable);
            return true;
        } catch (error) {
            return false;
        }
    }

    async _loadPrediction(snapshot, cancellable = this._lifecycleCancellable) {
        try {
            cancellable?.set_error_if_cancelled();
            const prediction = await this._usageService.predict(snapshot, { cancellable });
            cancellable?.set_error_if_cancelled();
            this._prediction = prediction;
        } catch (error) {
            if (isCancellationError(error)) throw error;
            this._prediction = null;
        }
    }

    async _loadHistory(cancellable = this._lifecycleCancellable) {
        try {
            cancellable?.set_error_if_cancelled();
            const history = await this._usageService.readHistory({ cancellable });
            cancellable?.set_error_if_cancelled();
            this._history = history;
        } catch (error) {
            if (isCancellationError(error)) throw error;
            this._history = [];
        }
    }

    _notifyUsage(snapshot, trackResets = true) {
        if (!this._usageNotifications || this._lifecycleCancellable.is_cancelled()) return;
        const now = Date.now() / 1000;
        const activeQuotas = snapshot.quotas.filter((quota) => (quota.resetAt ?? Infinity) > now);
        // The API repeats its account-wide flag on every window, even an expired one.
        const accountExhausted = snapshot.quotas.some((quota) => quota.limitReached);
        const needsAccountAlert =
            accountExhausted && !activeQuotas.some((quota) => quota.usedPercent >= 100);
        const states = this._usageNotificationStates;
        if (accountExhausted && !states.has(ACCOUNT_EXHAUSTION)) {
            states.set(ACCOUNT_EXHAUSTION, { exhausted: false });
        } else if (!accountExhausted) {
            states.delete(ACCOUNT_EXHAUSTION);
        }
        const accountState = states.get(ACCOUNT_EXHAUSTION);

        for (const quota of activeQuotas) {
            const remaining = Math.max(0, 100 - quota.usedPercent);
            const exhausted = remaining === 0;
            let state = states.get(quota.id);
            const resetAlerts = state?.resetAlerts ?? [];
            // A new reset deadline or a redeemed reset starts a fresh notification cycle.
            if (
                !state ||
                state.resetAt !== (quota.resetAt ?? null) ||
                (state.exhausted && !exhausted) ||
                (quota.usedPercent === 0 && state.usedPercent > 0)
            ) {
                state = {
                    resetAt: quota.resetAt ?? null,
                    warned: false,
                    exhausted: false,
                    observedExhausted: state?.observedExhausted,
                    observedResetAt: state?.observedResetAt,
                };
                states.set(quota.id, state);
            }
            state.usedPercent = quota.usedPercent;
            // Reset observations and delivery reservations outlive notification cycles.
            state.resetAlerts = resetAlerts;
            if (exhausted) {
                // A displayed window alert also explains this account-wide episode.
                const markAccountExplained = () => {
                    if (accountState && states.get(quota.id) === state)
                        accountState.exhausted = true;
                };
                if (state.exhausted === true) {
                    markAccountExplained();
                } else if (!state.exhausted) {
                    queueUsageAlert(
                        this._notify,
                        state,
                        "exhausted",
                        `${quota.label} usage window exhausted.`,
                        markAccountExplained,
                    );
                }
            } else if (
                !needsAccountAlert &&
                !state.warned &&
                remaining <= this._usageNotificationThreshold
            ) {
                queueUsageAlert(
                    this._notify,
                    state,
                    "warned",
                    `${quota.label} usage window is running low: ${Number(remaining.toFixed(1))}% left.`,
                );
            }
        }
        if (needsAccountAlert && !accountState.exhausted) {
            queueUsageAlert(
                this._notify,
                accountState,
                "exhausted",
                "Codex account usage limit reached.",
            );
        }
        if (trackResets) {
            if (this._redeemingBankedReset) {
                // Preserve order and observation times if redemption later fails.
                this._deferredUsageResets.push({ snapshot, observedAt: now });
            } else {
                this._notifyUsageResets(snapshot, now);
            }
        }
    }

    _notifyUsageResets(snapshot, observedAt) {
        if (!this._usageNotifications || this._lifecycleCancellable.is_cancelled()) return;
        const now = Date.now() / 1000;
        for (const quota of snapshot.quotas) {
            if ((quota.resetAt ?? Infinity) <= observedAt) continue;
            const state = this._usageNotificationStates.get(quota.id);
            if (!state) continue;
            if (
                state.observedExhausted &&
                Number.isFinite(state.observedResetAt) &&
                state.observedResetAt <= observedAt &&
                quota.resetAt > now &&
                quota.resetAt > state.observedResetAt &&
                quota.usedPercent < 100
            ) {
                state.resetAlerts.push({
                    message: `${quota.label} usage window reset.`,
                    shown: false,
                });
            }
            state.observedExhausted = quota.usedPercent >= 100;
            state.observedResetAt = quota.resetAt ?? null;
            state.resetAlerts = state.resetAlerts.filter((alert) => alert.shown !== true);
            if ((quota.resetAt ?? Infinity) <= now) continue;
            for (const alert of state.resetAlerts) {
                if (!alert.shown) queueUsageAlert(this._notify, alert, "shown", alert.message);
            }
        }
    }

    _usageNeedsBankedReset(snapshot) {
        if (!this._autoApplyBankedResetOnUsage || this._snapshot !== snapshot) return false;
        const now = Date.now() / 1000;
        return snapshot.quotas.some((quota) => {
            if (!(100 - quota.usedPercent < 2 && (quota.resetAt ?? Infinity) > now)) return false;
            const skipMinutes = getBankedResetSkipMinutes(quota, this._bankedResetSkipMinutes);
            const duration = quota.limitWindowSeconds;
            if (duration > 0 && skipMinutes * 60 >= duration) return false;
            return getImminentResetSeconds(quota, now, skipMinutes) === null;
        });
    }

    async _refreshBankedResetsForAutoApply(usageSnapshot = null) {
        if (this._autoApplyBankedResetCancellable || this._redeemingBankedReset) return;
        const cancellable = new Gio.Cancellable();
        this._autoApplyBankedResetCancellable = cancellable;
        try {
            const response = await this.refreshBankedResets();
            if (!response || cancellable.is_cancelled()) return;
            await this._autoRedeemBankedReset(response.credits, cancellable, usageSnapshot);
        } finally {
            if (this._autoApplyBankedResetCancellable === cancellable) {
                this._autoApplyBankedResetCancellable = null;
            }
        }
    }

    async _autoRedeemBankedReset(credits, cancellable, usageSnapshot) {
        if (
            this._lifecycleCancellable.is_cancelled() ||
            cancellable.is_cancelled() ||
            this._preparingBankedReset ||
            this._bankedResetPreparation ||
            this._redeemingBankedReset
        )
            return;
        const forUsage = usageSnapshot && this._usageNeedsBankedReset(usageSnapshot);
        const now = Date.now();
        const expiring = this._autoApplyBankedReset
            ? selectCreditExpiringWithin(credits, now, AUTO_APPLY_BANKED_RESET_WINDOW_MS)
            : null;
        const credit =
            expiring ??
            (forUsage
                ? selectCreditToRedeem(
                      credits.filter((candidate) => {
                          const expiresAt = Date.parse(candidate.expires_at ?? "");
                          return !Number.isFinite(expiresAt) || expiresAt > now;
                      }),
                  )
                : null);
        if (!credit) return;
        const message = expiring
            ? "Expiring banked Codex reset redeemed automatically."
            : "Banked Codex reset redeemed automatically near a usage limit.";
        await this._redeemBankedReset(credit.id, cancellable, message);
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
