import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const serviceUrl = new URL("../src/codex/usage/service.js", import.meta.url).href;
const monitorUrl = new URL("../src/background/monitor.js", import.meta.url).href;
const stubUrl = `data:text/javascript,${encodeURIComponent(`
    export const io = {};
    export class CancellationError extends Error {}
    export class Cancellable {
        cancel() { this.cancelled = true; }
        is_cancelled() { return !!this.cancelled; }
        set_error_if_cancelled() { if (this.cancelled) throw new CancellationError('Cancelled'); }
    }
    export default { Cancellable, Error: CancellationError, IOErrorEnum: { CANCELLED: 1 } };
    CancellationError.prototype.matches = () => true;
    export const isCancellationError = error => error instanceof CancellationError;
    export const refreshCodexUsage = options => io.fetch(options);
    export const readSnapshot = cancellable => io.cacheRead(cancellable);
    export const writeSnapshot = (snapshot, cancellable) => io.cacheWrite(cancellable);
    export const readHistory = (path, cancellable) => io.historyRead(cancellable);
    export const appendHistoryRow = (row, path, cancellable) => io.append(cancellable);
    export const rewriteHistory = (rows, path, cancellable) => io.rewrite(cancellable);
    export const MAX_HISTORY_ENTRIES = 1;
    export const normalizeHistoryEntries = rows => rows;
    export const normalizeHistoryEntry = row => row;
    export const hasSameQuotaValues = () => false;
    export const toHistoryEntry = snapshot => snapshot;
    export const predict = () => ({});
    export class PeriodicTask { start() { io.start?.(); } stop() {} }
    export const readSettings = () => ({ autoApplyBankedReset: false });
    export const getBackgroundRefreshIntervalSeconds = () => 0;
    export const SETTINGS_AUTO_APPLY_BANKED_RESET = 'auto-apply';
    export const SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES = 'refresh';
    export const isCodexError = () => false;
    export const formatRefreshFailure = () => 'Refresh failed';
    export const listCodexBankedResets = () => {};
    export const redeemCodexBankedReset = (id, options) => io.redeem(options);
    export const selectCreditExpiringWithin = credits => credits[0];
`)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (
            context.parentURL === serviceUrl ||
            (context.parentURL === monitorUrl && specifier !== "../codex/usage/service.js")
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
        const cancellable = new stubs.Cancellable();
        monitor._autoApplyBankedResetCancellable = cancellable;
        const result = deferred();
        stubs.io.redeem = (options) => {
            assert.equal(options.cancellable, cancellable);
            return result.promise;
        };
        let followUps = 0;
        monitor.refreshUsage = monitor.refreshBankedResets = async () => followUps++;
        const pending = monitor._autoApplyExpiringBankedReset([{ id: "credit" }], cancellable);
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

for (const stage of ["cacheRead", "fetch", "cacheWrite", "historyRead", "append", "rewrite"]) {
    test(`stop during ${stage} cancels its I/O and prevents subsequent stages`, async () => {
        const entered = deferred();
        const result = deferred();
        const events = [];
        let activeCancellable;
        const snapshot = { timestamp: "new", quotas: [] };
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
                return name === "historyRead" ? [{ timestamp: "old", quotas: [] }] : snapshot;
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
        assert.equal(
            monitor._usageService.history?.some((row) => row.timestamp === "new") ?? false,
            stage === "rewrite",
        );
    });
}

for (const stage of ["cacheWrite", "historyRead", "append", "rewrite"]) {
    test(`service preserves the original cancellation error from ${stage}`, async () => {
        const original = new stubs.CancellationError("cancelled I/O");
        const events = [];
        for (const name of ["fetch", "cacheWrite", "historyRead", "append", "rewrite"]) {
            stubs.io[name] = async () => {
                events.push(name);
                if (name === stage) throw original;
                return name === "historyRead" ? [{}] : { timestamp: "new", quotas: [] };
            };
        }
        await assert.rejects(new UsageService().refresh(), (error) => error === original);
        assert.equal(events.at(-1), stage);
    });
}
