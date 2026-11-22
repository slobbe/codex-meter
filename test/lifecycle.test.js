import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const serviceUrl = new URL("../src/codex/usage/service.js", import.meta.url).href;
const monitorUrl = new URL("../src/background/monitor.js", import.meta.url).href;
const stubUrl = `data:text/javascript,${encodeURIComponent(`
    export const io = {};
    export const CACHE_DIR = '/cache';
    export const STATE_DIR = '/state';
    export const DEFAULT_CREDENTIALS_PATH = '~/.codex/auth.json';
    export const SNAPSHOT_PATH = '/cache/codex/snapshot.json';
    export const resolveCredentialsPath = (path = DEFAULT_CREDENTIALS_PATH) => path;
    export const credentials = { accountFingerprint: 'test-account' };

    export const importLegacyUsage = async () => {};
    export async function getCodexCredentials(cancellable) {
        cancellable?.set_error_if_cancelled();
        return credentials;
    }
    export const hasSameCodexAccount = (left, right) => !!left && left === right;
    export class CancellationError extends Error {}
    export class Cancellable {
        cancel() { this.cancelled = true; }
        is_cancelled() { return !!this.cancelled; }
        set_error_if_cancelled() { if (this.cancelled) throw new CancellationError('Cancelled'); }
    }
    export default { Cancellable, build_filenamev: parts => parts.join('/'), canonicalize_filename: path => path };
    export const isCancellationError = error => error instanceof CancellationError;
    export const refreshCodexUsage = options => io.fetch(options);
    export const readSnapshot = cancellable => io.cacheRead(cancellable);
    export const writeSnapshot = (snapshot, cancellable) => io.cacheWrite(cancellable);
    export const readHistory = (path, cancellable) => io.historyRead(cancellable);
    export const appendHistoryRow = (row, path, cancellable) => io.append(cancellable);
    export const rewriteHistory = (rows, path, cancellable) => io.rewrite(cancellable);
    export const MAX_HISTORY_ENTRIES = 25_000;
    export const normalizeHistoryEntry = row => row;
    export const hasSameQuotaValues = () => false;
    export const toHistoryEntry = snapshot => snapshot;
    export const predict = () => ({});
    export class PeriodicTask { start() { io.start?.(); } stop() {} }
    export const readSettings = () => ({ autoApplyBankedReset: false });
    export const readBankedResetSkipMinutes = () => ({});
    export const SETTINGS_BANKED_RESET_SKIP_MINUTES = "banked-reset-skip-minutes";
    export const SETTINGS_USAGE_NOTIFICATIONS = "usage-notifications";
    export const SETTINGS_USAGE_NOTIFICATION_THRESHOLD = "usage-notification-threshold";

    export const SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE = "auto-usage";

    export const getBackgroundRefreshIntervalSeconds = () => 0;
    export const SETTINGS_AUTO_APPLY_BANKED_RESET = 'auto-apply';
    export const SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES = 'refresh';
    export const isCodexError = () => false;
    export const formatRefreshFailure = () => 'Refresh failed';
    export const listCodexBankedResets = () => {};
    export const redeemCodexBankedReset = (id, options) => io.redeem(options);
    export class BankedResetRedemptionError extends Error {}
    export const selectCreditExpiringWithin = credits => credits[0];
    export const selectCreditToRedeem = credits => credits[0];
`)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (
            context.parentURL === serviceUrl ||
            (context.parentURL === monitorUrl &&
                !["../codex/usage/service.js", "../codex/usage/model.js"].includes(specifier))
        ) {
            return { url: stubUrl, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});
let UsageService;
let CodexMonitor;
let stubs;
try {
    ({ UsageService } = await import(serviceUrl));
    ({ CodexMonitor } = await import(monitorUrl));
    stubs = await import(stubUrl);
} finally {
    hooks.deregister();
}

for (const action of ["stop", "toggle off"]) {
    test(`${action} cancels auto-apply and prevents redemption follow-up work`, async () => {
        const callbacks = new Map();
        const notifications = [];
        const monitor = new CodexMonitor(
            {
                connect(signal, callback) {
                    callbacks.set(signal, callback);
                },
                disconnect() {},
                get_boolean() {
                    return false;
                },
            },
            (message) => notifications.push(message),
        );
        monitor._autoApplyBankedReset = true;
        monitor._accountCredentials = stubs.credentials;
        const cancellable = new stubs.Cancellable();
        monitor._autoApplyBankedResetCancellable = cancellable;
        const result = deferred();
        let redemptions = 0;
        stubs.io.redeem = (options) => {
            redemptions++;
            assert.equal(options.cancellable, cancellable);
            assert.equal(options.credentials, stubs.credentials);
            return result.promise;
        };
        let followUps = 0;
        monitor.refreshUsage = monitor.refreshBankedResets = async () => followUps++;
        const pending = monitor._autoRedeemBankedReset(
            [{ id: "credit" }],
            stubs.credentials,
            cancellable,
        );
        assert.equal(redemptions, 1);
        if (action === "stop") monitor.stop();
        else callbacks.get("changed::auto-apply")();
        assert.equal(cancellable.is_cancelled(), true);
        result.resolve();
        await pending;
        assert.equal(followUps, 0);
        assert.deepEqual(notifications, []);
        monitor.stop();
    });
}

function deferred() {
    let resolve;
    const promise = new Promise((yes) => {
        resolve = yes;
    });
    return { promise, resolve };
}

function ioResult(name, stage) {
    const quotas = [{ id: "session", usedPercent: 15 }];
    if (name !== "historyRead") return { timestamp: new Date().toISOString(), quotas };
    // A history with no recent rows is rewritten instead of appended to.
    if (stage === "rewrite") {
        return [{ timestamp: new Date(Date.now() - 31 * 86_400_000).toISOString(), quotas }];
    }
    return [];
}

for (const stage of ["cacheRead", "fetch", "cacheWrite", "historyRead", "append", "rewrite"]) {
    test(`stop during ${stage} cancels its I/O and prevents subsequent stages`, async () => {
        const entered = deferred();
        const result = deferred();
        const events = [];
        let activeCancellable;
        for (const name of [
            "cacheRead",
            "fetch",
            "cacheWrite",
            "historyRead",
            "append",
            "rewrite",
        ]) {
            stubs.io[name] = async (argument) => {
                events.push(name);
                const cancellable = name === "fetch" ? argument.cancellable : argument;
                assert.ok(
                    cancellable instanceof stubs.Cancellable,
                    `${name} receives cancellation`,
                );
                if (name === stage) {
                    activeCancellable = cancellable;
                    entered.resolve();
                    await result.promise;
                }
                return ioResult(name, stage);
            };
        }
        stubs.io.start = () => events.push("start");
        const monitor = new CodexMonitor({ connect() {}, disconnect() {} }, assert.fail);
        let changes = 0;
        monitor.onChange = () => changes++;
        let pending;
        if (stage === "cacheRead") {
            const loadCachedSnapshot = monitor._loadCachedSnapshot.bind(monitor);
            monitor._loadCachedSnapshot = () => {
                pending = loadCachedSnapshot();
                return pending;
            };
            monitor.start();
        } else pending = monitor.refreshUsage();
        await entered.promise;
        const beforeStop = [...events];
        monitor.stop();
        assert.equal(activeCancellable.is_cancelled(), true);
        result.resolve();
        await pending;
        assert.deepEqual(events, beforeStop);
        assert.equal(changes, 0);
        assert.equal(monitor.state.errorMessage, null);
        assert.equal(monitor.state.snapshot, null);
        assert.deepEqual(monitor.state.history, []);
    });
}

for (const stage of ["cacheWrite", "historyRead", "append", "rewrite"]) {
    test(`service preserves the original cancellation error from ${stage}`, async () => {
        const original = new stubs.CancellationError("cancelled I/O");
        let failure = original;
        const events = [];
        for (const name of ["fetch", "cacheWrite", "historyRead", "append", "rewrite"]) {
            stubs.io[name] = async () => {
                events.push(name);
                if (name === stage && failure) throw failure;
                return ioResult(name, stage);
            };
        }
        const service = new UsageService();
        await assert.rejects(service.refresh(), (error) => error === original);
        assert.equal(events.at(-1), stage);

        if (stage === "rewrite") {
            failure = null;
            events.length = 0;
            await service.refresh();
            assert.deepEqual(
                events.filter((name) => name === "historyRead" || name === "rewrite"),
                ["historyRead", "rewrite"],
                "retry reloads persisted history before rewriting",
            );
        }
    });
}
