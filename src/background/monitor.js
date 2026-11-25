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
import { getCodexCredentials, hasSameCodexAccount } from "../codex/auth/auth.js";
import { UsageService } from "../codex/usage/service.js";
import { isCodexError } from "../codex/error.js";
import { isCancellationError } from "../io/files.js";
import { listCodexBankedResets, redeemCodexBankedReset } from "../codex/banked-resets/api.js";
import {
    BankedResetRedemptionError,
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
        { bankedResetConsumes = new Map(), withdrawUsageAlerts = () => {} } = {},
    ) {
        this._settings = settings;
        this._credentialsPath = credentialsPath;
        this._notify = notify;
        this._withdrawUsageAlerts = withdrawUsageAlerts;
        const values = readSettings(settings);
        this._usageNotifications = values.usageNotifications;
        this._usageNotificationThreshold = values.usageNotificationThreshold;
        this._usageNotificationStates = usageNotificationStates;
        this._autoApplyBankedReset = values.autoApplyBankedReset;
        this._autoApplyBankedResetOnUsage = values.autoApplyBankedResetOnUsage;

        this._bankedResetSkipMinutes = readBankedResetSkipMinutes(settings);
        this._usageService = new UsageService(credentialsPath);
        this._accountCredentials = null;
        this._accountReadSequence = 0;
        this._accountAppliedSequence = 0;
        this._credentialsMonitor = null;
        this._credentialsMonitorId = null;
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
        this._bankedResetRefresh = null;
        this._bankedResetConsumes = bankedResetConsumes;
        this._unverifiedBankedResetConsumes = new Map();
        this._bankedResetRefreshAttemptAt = null;
        this._autoApplyBankedResetCancellable = null;
        this._pendingUsageReset = null;
        this._bankedResetSnapshot = null;
        this._bankedResetCredentials = null;
        this._bankedResetInventoryStale = false;
        this._bankedResetLoading = false;
        this._bankedResetError = null;
        this._preparingBankedReset = false;
        this._bankedResetPreparation = null;
        this._redeemingBankedReset = false;
        this._redeemBankedResetCancellable = null;
        this._dispatchedVerifiedConsume = false;
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
            bankedResetCount: this._bankedResetInventoryStale
                ? null
                : (this._bankedResetSnapshot?.available_count ??
                  this._snapshot?.bankedResetCount ??
                  null),
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
        try {
            this._credentialsMonitor = Gio.File.new_for_path(
                this._usageService.credentialsPath,
            ).monitor_file(Gio.FileMonitorFlags.WATCH_MOVES, this._lifecycleCancellable);
            this._credentialsMonitorId = this._credentialsMonitor.connect("changed", () => {
                void this._readAccount(this._lifecycleCancellable).catch(() => {});
            });
        } catch (_error) {
            // Request boundaries still check the credentials if a file monitor is unavailable.
        }
        if (this._autoApplyBankedReset) {
            this._bankedResetRefreshTask.start();
        }
        void this._loadCachedSnapshot().finally(() => {
            if (this._lifecycleCancellable.is_cancelled()) return;
            this._usageRefreshTask.start();
        });
    }

    stop({ replacing = false } = {}) {
        if (this._lifecycleCancellable.is_cancelled()) return;
        this._lifecycleCancellable.cancel();
        if (this._credentialsMonitor) {
            if (this._credentialsMonitorId !== null) {
                this._credentialsMonitor.disconnect(this._credentialsMonitorId);
            }
            this._credentialsMonitor.cancel();
            this._credentialsMonitor = null;
            this._credentialsMonitorId = null;
        }
        this._accountCredentials = null;
        this._bankedResetCredentials = null;
        this._pendingUsageReset = null;
        this._bankedResetPreparation = null;
        this._usageRefreshTask.stop();
        this._bankedResetRefreshTask.stop();
        this._autoApplyBankedResetCancellable?.cancel();
        this._refreshCancellable?.cancel();
        this._refreshCancellable = null;
        this._bankedResetRefresh?.cancellable.cancel();
        this._unverifiedBankedResetConsumes.clear();

        // A replacement must not mistake local cancellation for a settled server request.
        if (!replacing || !this._dispatchedVerifiedConsume)
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

    async refreshManually() {
        await Promise.allSettled([this.refreshUsage(), this.refreshBankedResets()]);
    }

    async refreshUsage({ expectedCredentials = null } = {}) {
        if (this._lifecycleCancellable.is_cancelled()) return;
        if (this._refreshPromise) {
            await this._refreshPromise;
            return;
        }
        this._refreshCancellable = new Gio.Cancellable();
        this._refreshPromise = this._refreshUsageOnce(
            this._refreshCancellable,
            expectedCredentials,
        );
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

    async refreshBankedResets({ maxAgeMs = 0, expectedCredentials = null } = {}) {
        if (this._lifecycleCancellable.is_cancelled()) return null;
        const pending = this._bankedResetRefresh;
        if (pending) {
            if (maxAgeMs <= 0) pending.force = true;
            const response = await pending.promise;
            const wanted = expectedCredentials ?? this._accountCredentials;
            if (!hasSameCodexAccount(wanted, this._accountCredentials)) return null;
            if (pending.credentials && !hasSameCodexAccount(wanted, pending.credentials)) {
                return await this.refreshBankedResets({ maxAgeMs, expectedCredentials });
            }
            return response;
        }
        const cancellable = new Gio.Cancellable();
        const request = { cancellable, credentials: null, force: maxAgeMs <= 0, promise: null };
        this._bankedResetRefresh = request;
        // Assign before notifying listeners so reentrant refreshes share this request too.
        request.promise = Promise.resolve().then(async () => {
            let changed = false;
            try {
                const credentials = await this._readAccount(cancellable);
                request.credentials = expectedCredentials ?? credentials;
                if (
                    !hasSameCodexAccount(credentials, this._accountCredentials) ||
                    (expectedCredentials && !hasSameCodexAccount(expectedCredentials, credentials))
                ) {
                    return null;
                }
                const now = Date.now();
                if (
                    !request.force &&
                    this._bankedResetRefreshAttemptAt !== null &&
                    now - this._bankedResetRefreshAttemptAt < maxAgeMs
                )
                    return this._bankedResetSnapshot;
                // Failed requests also cool down popup requests; default callers always refresh.
                this._bankedResetRefreshAttemptAt = now;
                changed = true;
                this._bankedResetLoading = true;
                this._bankedResetError = null;
                this._emitChange();
                const recheck = this._bankedResetRecheckFor(credentials);
                const response = await listCodexBankedResets({
                    cancellable,
                    credentials,
                    credentialsPath: this._credentialsPath,
                });
                cancellable.set_error_if_cancelled();
                if (!hasSameCodexAccount(credentials, this._accountCredentials)) return null;
                this._bankedResetSnapshot = response;
                this._bankedResetCredentials = credentials;
                this._bankedResetInventoryStale = false;
                if (recheck) recheck.inventoryFresh = true;
                return response;
            } catch (error) {
                if (!isCancellationError(error) && !this._lifecycleCancellable.is_cancelled()) {
                    await this._readAccount(cancellable).catch(() => {});
                    if (
                        !cancellable.is_cancelled() &&
                        (!request.credentials ||
                            hasSameCodexAccount(request.credentials, this._accountCredentials))
                    ) {
                        this._bankedResetError = formatBankedResetPreparationFailure(error);
                        changed = true;
                    }
                }
                return null;
            } finally {
                this._bankedResetRefresh = null;
                this._bankedResetLoading = false;
                if (changed && !this._lifecycleCancellable.is_cancelled()) this._emitChange();
            }
        });
        return await request.promise;
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
        const preparation = { creditId, credentials: null, accountChanged: false };
        const selectionCredentials = this._bankedResetCredentials;
        this._bankedResetPreparation = preparation;
        let prepared = false;
        this._preparingBankedReset = true;
        const ownsInventoryRefresh = !this._bankedResetRefresh;
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
            const credentials = this._bankedResetCredentials;
            if (
                preparation.accountChanged ||
                this._bankedResetSnapshot !== response ||
                (selectionCredentials && !hasSameCodexAccount(selectionCredentials, credentials))
            ) {
                this._notify("The Codex account changed. Choose a reset from the current account.");
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
            preparation.credentials = credentials;
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
        const preparation = this._bankedResetPreparation;
        if (preparation?.creditId !== creditId || !preparation?.credentials) return;
        if (preparation.accountChanged) {
            this.cancelBankedResetPreparation();
            this._notify("The Codex account changed. Choose a reset from the current account.");
            return;
        }
        await this._redeemBankedReset(creditId, preparation.credentials);
    }

    async _redeemBankedReset(creditId, credentials, automatic = null) {
        if (this._lifecycleCancellable.is_cancelled() || this._redeemingBankedReset) return;
        const consumeCancellable = new Gio.Cancellable();
        const preparation = this._bankedResetPreparation;
        this._redeemingBankedReset = true;
        this._redeemBankedResetCancellable = consumeCancellable;
        this._emitChange();
        try {
            const [consumes, key] = this._bankedResetConsumeKey(credentials);
            let consume = null;
            let failure = null;
            // A settings change can stop preflight, but not a consume already sent.
            try {
                await redeemCodexBankedReset(creditId, {
                    cancellable: automatic?.cancellable ?? consumeCancellable,
                    isEligible: automatic?.isEligible,
                    consumeCancellable,
                    credentials,
                    credentialsPath: this._credentialsPath,
                    onDispatch: () => {
                        if (
                            preparation?.accountChanged ||
                            !hasSameCodexAccount(credentials, this._accountCredentials)
                        )
                            return false;
                        consume = consumes.get(key) ?? { pending: new Set(), recheck: null };
                        if (consume.recheck) consume.recheck = emptyBankedResetRecheck();
                        consume.pending.add(consumeCancellable);
                        consumes.set(key, consume);
                        this._dispatchedVerifiedConsume = Boolean(credentials.accountFingerprint);
                    },
                });
            } catch (error) {
                failure = error;
            }
            const ambiguous =
                consume && failure && !(failure instanceof BankedResetRedemptionError);
            const recheck = consume && (!failure || ambiguous) ? emptyBankedResetRecheck() : null;
            if (consume) {
                consume.pending.delete(consumeCancellable);
                if (recheck) consume.recheck = recheck;
                if (!consume.pending.size && !consume.recheck) consumes.delete(key);
                this._dispatchedVerifiedConsume = false;
            }
            if (
                this._lifecycleCancellable.is_cancelled() ||
                consumeCancellable.is_cancelled() ||
                (!consume && (!failure || automatic?.cancellable.is_cancelled()))
            )
                return;
            const current = await this._readAccount(consumeCancellable).catch(() => null);
            if (consumeCancellable.is_cancelled()) return;
            const sameAccount =
                hasSameCodexAccount(current, credentials) &&
                hasSameCodexAccount(this._accountCredentials, credentials);
            if (failure) {
                if (consume && !sameAccount) return;
                if (!isCancellationError(failure)) {
                    if (automatic)
                        console.warn("Unable to auto-redeem Codex banked reset", failure);
                    else this._notify(formatBankedResetFailure(failure));
                }
                const unavailable =
                    failure instanceof BankedResetRedemptionError &&
                    ["no_credit", "already_redeemed"].includes(failure.outcome);
                if (sameAccount && (ambiguous || unavailable)) {
                    const pending = this._bankedResetRefresh;
                    this._invalidateBankedResetInventory();
                    if (unavailable) {
                        await pending?.promise;
                        if (!consumeCancellable.is_cancelled()) {
                            await this.refreshBankedResets({ expectedCredentials: credentials });
                        }
                    }
                }
                return;
            }
            if (!sameAccount) return;
            this._usageResetGeneration++;
            this._deferredUsageResets = [];
            // Banked resets reset usage limits without identifying affected windows.
            for (const state of this._usageNotificationStates.values()) {
                state.observedExhausted = false;
            }
            this._notify(automatic?.message ?? "Banked Codex reset redeemed.");
            // Older requests must finish before the post-redemption refreshes start.
            await Promise.all([this._refreshPromise, this._bankedResetRefresh?.promise]);
            if (
                consumeCancellable.is_cancelled() ||
                !hasSameCodexAccount(credentials, this._accountCredentials)
            )
                return;
            await Promise.all([
                this.refreshUsage({ expectedCredentials: credentials }),
                this.refreshBankedResets({ expectedCredentials: credentials }),
            ]);
            this._clearBankedResetRecheck(credentials, recheck);
        } finally {
            if (this._redeemBankedResetCancellable === consumeCancellable) {
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

    _bankedResetConsumeKey(credentials) {
        // Only the verified fingerprint can carry a recheck across monitors.
        return credentials.accountFingerprint
            ? [this._bankedResetConsumes, credentials.accountFingerprint]
            : [
                  this._unverifiedBankedResetConsumes,
                  JSON.stringify([credentials.accountId, credentials.accessToken]),
              ];
    }

    _bankedResetConsumeFor(credentials) {
        const [consumes, key] = this._bankedResetConsumeKey(credentials);
        return consumes.get(key);
    }

    _bankedResetRecheckFor(credentials) {
        const consume = this._bankedResetConsumeFor(credentials);
        // Only requests started after the last consume settled can count as fresh.
        if (!consume?.pending.size) return consume?.recheck;
    }

    _clearBankedResetRecheck(credentials, recheck) {
        if (!recheck?.inventoryFresh || !recheck.usageFresh) return false;
        if (this._bankedResetRecheckFor(credentials) !== recheck) return false;
        const [consumes, key] = this._bankedResetConsumeKey(credentials);
        return consumes.delete(key);
    }

    _invalidateBankedResetInventory() {
        this._bankedResetSnapshot = null;
        this._bankedResetCredentials = null;
        this._bankedResetInventoryStale = true;
        this._bankedResetRefreshAttemptAt = null;
        this._bankedResetRefresh?.cancellable.cancel();
        this._emitChange();
    }

    async _readAccount(cancellable) {
        const sequence = ++this._accountReadSequence;
        let credentials = null;
        try {
            credentials = await getCodexCredentials(cancellable, this._credentialsPath);
            return credentials;
        } finally {
            if (
                !cancellable?.is_cancelled() &&
                !this._lifecycleCancellable.is_cancelled() &&
                sequence > this._accountAppliedSequence
            ) {
                this._accountAppliedSequence = sequence;
                this._setAccount(credentials);
            }
        }
    }

    _setAccount(credentials) {
        const changed =
            this._accountCredentials && !hasSameCodexAccount(this._accountCredentials, credentials);
        this._accountCredentials = credentials;
        if (!changed) return;

        this._snapshot = null;
        this._prediction = null;
        this._history = [];
        this._cachedFailureMessage = null;
        this._bankedResetSnapshot = null;
        this._bankedResetCredentials = null;
        this._bankedResetInventoryStale = false;
        this._bankedResetRefreshAttemptAt = null;
        this._bankedResetError = null;
        if (this._bankedResetPreparation) this._bankedResetPreparation.accountChanged = true;
        this._autoApplyBankedResetCancellable?.cancel();
        this._withdrawUsageAlerts();
        this._usageNotificationStates.clear();
        this._deferredUsageResets = [];
        this._emitChange();
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

    async _refreshUsageOnce(cancellable = this._lifecycleCancellable, expectedCredentials = null) {
        const resetGeneration = this._usageResetGeneration;
        try {
            if (this._lifecycleCancellable.is_cancelled()) return;
            const credentials = await this._readAccount(cancellable);
            if (
                !hasSameCodexAccount(credentials, this._accountCredentials) ||
                (expectedCredentials && !hasSameCodexAccount(expectedCredentials, credentials))
            )
                return;
            const recheck = this._bankedResetRecheckFor(credentials);
            const snapshot = await this._usageService.refresh({ cancellable, credentials });
            if (this._lifecycleCancellable.is_cancelled()) return;
            if (!hasSameCodexAccount(credentials, this._accountCredentials)) return;
            this._snapshot = snapshot;
            await this._loadHistory(cancellable, credentials);
            cancellable?.set_error_if_cancelled();
            this._errorMessage = null;
            this._cachedFailureMessage = null;
            await this._loadPrediction(this._snapshot, cancellable, credentials);
            await this._readAccount(cancellable);
            cancellable?.set_error_if_cancelled();
            if (!hasSameCodexAccount(credentials, this._accountCredentials)) return;
            if (recheck) recheck.usageFresh = true;
            // A pre-redemption result must not restore old exhaustion observations.
            this._notifyUsage(snapshot, resetGeneration === this._usageResetGeneration);
            return snapshot;
        } catch (error) {
            if (this._lifecycleCancellable.is_cancelled() || isCancellationError(error)) return;
            const failureMessage = formatRefreshFailure(error);
            await this._readAccount(cancellable).catch(() => {});
            if (this._lifecycleCancellable.is_cancelled() || cancellable?.is_cancelled()) return;
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
            const credentials = await this._readAccount(cancellable);
            const snapshot = await this._usageService.readCachedSnapshot({
                cancellable,
                credentials,
            });
            if (
                this._lifecycleCancellable.is_cancelled() ||
                !hasSameCodexAccount(credentials, this._accountCredentials) ||
                !snapshot ||
                this._snapshot ||
                this._errorMessage
            )
                return;
            this._snapshot = snapshot;
            await this._loadHistory(cancellable, credentials);
            cancellable?.set_error_if_cancelled();
            await this._loadPrediction(snapshot, cancellable, credentials);
            await this._readAccount(cancellable);
            if (!this._lifecycleCancellable.is_cancelled()) this._emitChange();
        } catch (error) {}
    }

    async _loadCachedSnapshotAfterFailure(cancellable = this._lifecycleCancellable) {
        if (this._lifecycleCancellable.is_cancelled()) return false;
        try {
            const credentials = this._accountCredentials;
            if (!credentials) return false;
            const snapshot = await this._usageService.readCachedSnapshot({
                cancellable,
                credentials,
            });
            if (
                this._lifecycleCancellable.is_cancelled() ||
                !snapshot ||
                !hasSameCodexAccount(credentials, this._accountCredentials)
            )
                return false;
            if (this._snapshot) return true;
            this._snapshot = snapshot;
            await this._loadHistory(cancellable, credentials);
            cancellable?.set_error_if_cancelled();
            await this._loadPrediction(snapshot, cancellable, credentials);
            await this._readAccount(cancellable);
            return hasSameCodexAccount(credentials, this._accountCredentials);
        } catch (error) {
            return false;
        }
    }

    async _loadPrediction(snapshot, cancellable, credentials) {
        if (!hasSameCodexAccount(credentials, this._accountCredentials)) return;
        try {
            cancellable?.set_error_if_cancelled();
            const prediction = await this._usageService.predict(snapshot, {
                cancellable,
                credentials,
            });
            cancellable?.set_error_if_cancelled();
            if (hasSameCodexAccount(credentials, this._accountCredentials))
                this._prediction = prediction;
        } catch (error) {
            if (isCancellationError(error)) throw error;
            if (hasSameCodexAccount(credentials, this._accountCredentials)) this._prediction = null;
        }
    }

    async _loadHistory(cancellable, credentials) {
        try {
            cancellable?.set_error_if_cancelled();
            const history = await this._usageService.readHistory({ cancellable, credentials });
            cancellable?.set_error_if_cancelled();
            if (hasSameCodexAccount(credentials, this._accountCredentials)) this._history = history;
        } catch (error) {
            if (isCancellationError(error)) throw error;
            if (hasSameCodexAccount(credentials, this._accountCredentials)) this._history = [];
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
        if (this._lifecycleCancellable.is_cancelled() || this._redeemingBankedReset) return;
        const usageCredentials = usageSnapshot ? this._accountCredentials : null;
        if (usageSnapshot) {
            if (!usageCredentials || !this._usageNeedsBankedReset(usageSnapshot)) return;
            // A quota refresh can finish while an expiry check is fetching the same inventory.
            this._pendingUsageReset = { snapshot: usageSnapshot, credentials: usageCredentials };
        }
        if (this._autoApplyBankedResetCancellable) return;
        const cancellable = new Gio.Cancellable();
        this._autoApplyBankedResetCancellable = cancellable;
        let interruptedBeforeRedemption = false;
        try {
            const response = await this.refreshBankedResets({
                expectedCredentials: usageCredentials,
            });
            interruptedBeforeRedemption = cancellable.is_cancelled();
            if (!response || response !== this._bankedResetSnapshot || interruptedBeforeRedemption)
                return;
            const credentials = this._bankedResetCredentials;
            if (this._bankedResetConsumeFor(credentials)?.pending.size) return;
            const recheck = this._bankedResetRecheckFor(credentials);
            if (recheck) {
                // An unconfirmed consume can have succeeded. Do not act on pre-consume data.
                if (!recheck.usageFresh) {
                    await this._refreshPromise;
                    if (!recheck.usageFresh && !cancellable.is_cancelled())
                        await this.refreshUsage({ expectedCredentials: credentials });
                }
                interruptedBeforeRedemption = cancellable.is_cancelled();
                if (
                    interruptedBeforeRedemption ||
                    response !== this._bankedResetSnapshot ||
                    !hasSameCodexAccount(credentials, this._accountCredentials) ||
                    !this._clearBankedResetRecheck(credentials, recheck)
                )
                    return;
            }
            const redemption = this._autoRedeemBankedReset(
                response.credits,
                credentials,
                cancellable,
                usageCredentials,
            );
            if (redemption) await redemption;
        } finally {
            const pending = this._pendingUsageReset;
            this._pendingUsageReset = null;
            this._autoApplyBankedResetCancellable = null;
            // A fresh observation can arrive after a different account's check was interrupted.
            if (
                interruptedBeforeRedemption &&
                hasSameCodexAccount(pending?.credentials, this._accountCredentials)
            ) {
                await this._refreshBankedResetsForAutoApply(pending.snapshot);
            }
        }
    }

    _autoRedeemBankedReset(credits, credentials, cancellable, usageCredentials = null) {
        if (
            this._lifecycleCancellable.is_cancelled() ||
            cancellable.is_cancelled() ||
            this._preparingBankedReset ||
            this._bankedResetPreparation ||
            this._redeemingBankedReset ||
            !hasSameCodexAccount(credentials, this._accountCredentials) ||
            (usageCredentials && !hasSameCodexAccount(usageCredentials, credentials))
        )
            return;
        const pendingUsage = this._pendingUsageReset;
        const forUsage =
            hasSameCodexAccount(pendingUsage?.credentials, credentials) &&
            this._usageNeedsBankedReset(pendingUsage.snapshot);
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
        return this._redeemBankedReset(credit.id, credentials, {
            cancellable,
            message,
            isEligible: () => {
                if (this._bankedResetConsumeFor(credentials)) return false;
                const currentCredit = this._bankedResetSnapshot?.credits.find(
                    (candidate) => candidate.id === credit.id && candidate.status === "available",
                );
                if (!currentCredit) return false;
                const now = Date.now();
                if (expiring) {
                    return (
                        this._autoApplyBankedReset &&
                        selectCreditExpiringWithin(
                            [currentCredit],
                            now,
                            AUTO_APPLY_BANKED_RESET_WINDOW_MS,
                        ) !== null
                    );
                }
                const expiresAt = Date.parse(currentCredit.expires_at ?? "");
                return (
                    this._usageNeedsBankedReset(pendingUsage.snapshot) &&
                    (!Number.isFinite(expiresAt) || expiresAt > now)
                );
            },
        });
    }

    _emitChange() {
        this.onChange?.(this.state);
    }
}

function emptyBankedResetRecheck() {
    return { inventoryFresh: false, usageFresh: false };
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
