import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { toUsageSnapshot } from "../src/codex/usage/response.js";

const monitorUrl = new URL("../src/background/monitor.js", import.meta.url).href;
const stubUrl = `data:text/javascript,${encodeURIComponent(`
    export const api = { list: null, redeem: null };
    export const listCodexBankedResets = options => api.list(options);
    export const redeemCodexBankedReset = (id, options) => api.redeem(id, options);
    export class Cancellable {
        cancel() { this.cancelled = true; }
        is_cancelled() { return !!this.cancelled; }
        set_error_if_cancelled() { if (this.cancelled) throw new GLibError("Cancelled"); }
    }
    class GLibError extends Error { matches() { return true; } }
    export const isCancellationError = error => error instanceof GLibError;
    export default { Cancellable, Error: GLibError, IOErrorEnum: { CANCELLED: 1 } };
    export class UsageService {
        constructor(path) { this.path = path; }
        async refresh() { return api.usage(this.path); }
        async readHistory() { return []; }
        async predict() { return null; }
    }
    export class PeriodicTask { start() {} stop() {} }
    export const readSettings = settings => ({
        autoApplyBankedReset: false,
        usageNotifications: settings.get_boolean(),
        usageNotificationThreshold: settings.get_uint(),
    });
    export const SETTINGS_USAGE_NOTIFICATIONS = "usage-notifications";
    export const SETTINGS_USAGE_NOTIFICATION_THRESHOLD = "usage-notification-threshold";
    export const SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW = "usage-window";
    export const SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE = "auto-usage";
    export const SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_THRESHOLD = "usage-threshold";
    export const getBackgroundRefreshIntervalSeconds = () => 0;
    export const SETTINGS_AUTO_APPLY_BANKED_RESET = 'auto-apply';
    export const SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES = 'refresh';
    export const isCodexError = error => error.name === 'CodexError';
    export const formatRefreshFailure = () => 'Usage refresh failed';
`)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (context.parentURL === monitorUrl && !specifier.endsWith("/response.js")) {
            return { url: stubUrl, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});
let CodexMonitor;
let api;
try {
    ({ CodexMonitor } = await import(monitorUrl));
    ({ api } = await import(stubUrl));
} finally {
    hooks.deregister();
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

function fixture(deliver = (_message, settle) => settle?.(true)) {
    const notifications = [];
    const changes = [];
    const callbacks = new Map();
    const settings = {
        connect(signal, callback) {
            callbacks.set(signal, callback);
            return signal;
        },
        disconnect(signal) {
            callbacks.delete(signal);
        },
        get_boolean: () => false,
        get_uint: () => 5,
    };
    const monitor = new CodexMonitor(settings, (message, settle) => {
        notifications.push(message);
        deliver(message, settle);
    });
    monitor.onChange = (state) => changes.push(state);
    monitor.refreshUsage = async () => {};
    return { monitor, notifications, changes, settings, callbacks };
}

function notificationQuota(usedPercent, overrides = {}) {
    return { id: "session", label: "5 hours", usedPercent, resetAt: 9_999_999_999, ...overrides };
}

function enableNotifications(monitor) {
    monitor._usageNotifications = true;
    monitor._usageNotificationThreshold = 10;
}

test("usage notifications are opt-in, inclusive at threshold, and deduplicated per level", () => {
    const { monitor, notifications } = fixture();
    const notify = (used) => monitor._notifyUsage({ quotas: [notificationQuota(used)] });
    notify(100);
    assert.deepEqual(notifications, []);
    enableNotifications(monitor);
    notify(89.9);
    assert.deepEqual(notifications, []);
    notify(90);
    assert.deepEqual(notifications, ["5 hours usage window is running low: 10% left."]);
    notify(91);
    notify(95);
    notify(89);
    notify(91);
    assert.deepEqual(notifications, ["5 hours usage window is running low: 10% left."]);
    notify(100);
    notify(100);
    assert.equal(notifications.length, 2);
    assert.equal(notifications[1], "5 hours usage window exhausted.");
});

test("same-cycle alerts do not repeat when replacing monitors A → B → A", async (t) => {
    const notifications = [];
    const stateA = new Map();
    const stateB = new Map();
    const quotas = new Map([
        ["/a/auth.json", notificationQuota(90)],
        ["/b/auth.json", notificationQuota(90)],
    ]);
    api.usage = (path) => ({ quotas: [quotas.get(path)] });
    t.after(() => delete api.usage);
    const settings = {
        connect() {},
        disconnect() {},
        get_boolean: () => true,
        get_uint: () => 10,
    };
    async function refresh(path, states) {
        const monitor = new CodexMonitor(
            settings,
            (message, settle) => {
                notifications.push([path, message]);
                settle?.(true);
            },
            path,
            states,
        );
        await monitor.refreshUsage();
        monitor.stop();
    }
    await refresh("/a/auth.json", stateA);
    await refresh("/b/auth.json", stateB);
    await refresh("/a/auth.json", stateA);
    quotas.set("/a/auth.json", notificationQuota(100));
    await refresh("/a/auth.json", stateA);
    await refresh("/a/auth.json", stateA);
    quotas.set("/a/auth.json", notificationQuota(91, { resetAt: 10_000_000_000 }));
    await refresh("/a/auth.json", stateA);
    api.usage = () => accountLimitSnapshot(true, 20, 60);
    await refresh("/a/auth.json", stateA);
    await refresh("/b/auth.json", stateB);
    await refresh("/a/auth.json", stateA);
    assert.deepEqual(notifications, [
        ["/a/auth.json", "5 hours usage window is running low: 10% left."],
        ["/b/auth.json", "5 hours usage window is running low: 10% left."],
        ["/a/auth.json", "5 hours usage window exhausted."],
        ["/a/auth.json", "5 hours usage window is running low: 9% left."],
        ["/a/auth.json", "Codex account usage limit reached."],
        ["/b/auth.json", "Codex account usage limit reached."],
    ]);
});

test("dropped alerts retry on return to the same credentials, but queued and shown alerts do not repeat", () => {
    for (const snapshot of [
        { quotas: [notificationQuota(91)] },
        accountLimitSnapshot(true, 100, 60),
        accountLimitSnapshot(true, 99, 60),
    ]) {
        const states = new Map();
        const deliveries = [];
        const createMonitor = (path, pathStates) => {
            const monitor = new CodexMonitor(
                { connect() {}, disconnect() {}, get_boolean: () => true, get_uint: () => 10 },
                (message, settle) => deliveries.push({ path, message, settle }),
                path,
                pathStates,
            );
            return monitor;
        };
        const first = createMonitor("/a/auth.json", states);
        first._notifyUsage(snapshot);
        first._notifyUsage(snapshot);
        assert.equal(deliveries.length, 1);
        deliveries[0].settle(false);
        first.stop();

        const other = createMonitor("/b/auth.json", new Map());
        other._notifyUsage(snapshot);
        deliveries[1].settle(true);
        other.stop();

        const returning = createMonitor("/a/auth.json", states);
        returning._notifyUsage(snapshot);
        deliveries[0].settle(true); // A stale callback must not change the new reservation.
        deliveries[2].settle(true);
        returning._notifyUsage(snapshot);
        returning.stop();

        const afterDelivery = createMonitor("/a/auth.json", states);
        afterDelivery._notifyUsage(snapshot);
        afterDelivery.stop();
        assert.deepEqual(
            deliveries.map(({ path }) => path),
            ["/a/auth.json", "/b/auth.json", "/a/auth.json"],
        );
        assert.equal(deliveries[0].message, deliveries[2].message);
    }
});

test("jumping straight to exhausted skips the warning", () => {
    for (const quota of [notificationQuota(100), notificationQuota(101)]) {
        const { monitor, notifications } = fixture();
        enableNotifications(monitor);
        monitor._notifyUsage({ quotas: [quota] });
        monitor._notifyUsage({ quotas: [quota] });
        assert.deepEqual(notifications, ["5 hours usage window exhausted."]);
    }
});

function accountLimitSnapshot(limitReached, sessionPercent, weeklyPercent, sessionResetAt) {
    return toUsageSnapshot({
        plan_type: "plus",
        rate_limit: {
            limit_reached: limitReached,
            primary_window: {
                limit_window_seconds: 18_000,
                used_percent: sessionPercent,
                reset_at: sessionResetAt ?? 9_999_999_999,
                reset_after_seconds: 18_000,
            },
            secondary_window: {
                limit_window_seconds: 604_800,
                used_percent: weeklyPercent,
                reset_at: 9_999_999_999,
                reset_after_seconds: 604_800,
            },
        },
    });
}

test("unattributed account exhaustion alerts once until a live refresh clears the limit", async (t) => {
    const notifications = [];
    const settings = {
        connect() {},
        disconnect() {},
        get_boolean: () => true,
        get_uint: () => 10,
    };
    const monitor = new CodexMonitor(settings, (message, settle) => {
        notifications.push(message);
        settle?.(true);
    });
    t.after(() => {
        monitor.stop();
        delete api.usage;
    });
    api.usage = () => accountLimitSnapshot(true, 100, 95, 1);
    await monitor.refreshUsage();
    api.usage = () => accountLimitSnapshot(true, 93, 96);
    await monitor.refreshUsage();
    assert.deepEqual(notifications, ["Codex account usage limit reached."]);

    api.usage = () => accountLimitSnapshot(false, 20, 60);
    await monitor.refreshUsage();
    api.usage = () => accountLimitSnapshot(true, 70, 95);
    await monitor.refreshUsage();
    api.usage = () => accountLimitSnapshot(true, 100, 60);
    await monitor.refreshUsage();
    assert.deepEqual(notifications, [
        "Codex account usage limit reached.",
        "Codex account usage limit reached.",
        "5 hours usage window exhausted.",
    ]);
});

test("identified windows take precedence and prevent a later fallback for the same limit", () => {
    const { monitor, notifications } = fixture();
    enableNotifications(monitor);
    monitor._notifyUsage(accountLimitSnapshot(true, 100, 50));
    monitor._notifyUsage(accountLimitSnapshot(true, 100, 50));
    monitor._notifyUsage(accountLimitSnapshot(true, 99, 50));
    assert.deepEqual(notifications, ["5 hours usage window exhausted."]);
});

test("notifications track windows independently and ignore expired windows", () => {
    const { monitor, notifications } = fixture();
    enableNotifications(monitor);
    const snapshot = {
        quotas: [
            notificationQuota(100, { id: "expired", resetAt: 1 }),
            notificationQuota(91),
            notificationQuota(100, { id: "weekly", label: "Weekly" }),
        ],
    };
    monitor._notifyUsage(snapshot);
    monitor._notifyUsage(snapshot);
    assert.deepEqual(notifications, [
        "5 hours usage window is running low: 9% left.",
        "Weekly usage window exhausted.",
    ]);
});

test("new deadlines and redeemed resets rearm usage notifications", () => {
    const { monitor, notifications } = fixture();
    enableNotifications(monitor);
    for (const quota of [
        notificationQuota(91),
        notificationQuota(91, { resetAt: 9_999_999_999 + 1 }),
        notificationQuota(0, { resetAt: 9_999_999_999 + 1 }),
        notificationQuota(91, { resetAt: 9_999_999_999 + 1 }),
        notificationQuota(100, { resetAt: 9_999_999_999 + 1 }),
        notificationQuota(91, { resetAt: 9_999_999_999 + 1 }),
    ])
        monitor._notifyUsage({ quotas: [quota] });
    assert.equal(notifications.length, 5);
});

test("notification settings take effect on the next refresh and disconnect on stop", () => {
    const { monitor, notifications, callbacks, settings } = fixture();
    settings.get_boolean = () => true;
    callbacks.get("changed::usage-notifications")();
    monitor._notifyUsage({ quotas: [notificationQuota(91)] });
    assert.deepEqual(notifications, []);
    settings.get_uint = () => 10;
    callbacks.get("changed::usage-notification-threshold")();
    monitor._notifyUsage({ quotas: [notificationQuota(91)] });
    assert.equal(notifications.length, 1);
    settings.get_boolean = () => false;
    callbacks.get("changed::usage-notifications")();
    monitor._notifyUsage({ quotas: [notificationQuota(100)] });
    assert.equal(notifications.length, 1);
    monitor.stop();
    assert.equal(callbacks.size, 0);
    monitor._usageNotifications = true;
    monitor._notifyUsage({ quotas: [notificationQuota(100)] });
    assert.equal(notifications.length, 1);
});

test("only successful live refreshes send usage notifications, never cached or failed usage", async () => {
    const { monitor, notifications } = fixture();
    enableNotifications(monitor);
    const snapshot = accountLimitSnapshot(true, 50, 60);
    monitor._usageService = {
        readCachedSnapshot: async () => snapshot,
        readHistory: async () => [],
        predict: async () => null,
        refresh: async () => {
            throw new Error("offline");
        },
    };
    await monitor._loadCachedSnapshot();
    await monitor._refreshUsageOnce();
    assert.deepEqual(notifications, []);
    monitor._usageService.refresh = async () => snapshot;
    await monitor._refreshUsageOnce();
    await monitor._refreshUsageOnce();
    assert.deepEqual(notifications, ["Codex account usage limit reached."]);
});

test("stop during a usage refresh prevents late usage notifications", async () => {
    const { monitor, notifications } = fixture();
    enableNotifications(monitor);
    const response = deferred();
    monitor._usageService = { refresh: () => response.promise };
    const pending = monitor._refreshUsageOnce();
    monitor.stop();
    response.resolve(accountLimitSnapshot(true, 50, 60));
    await pending;
    assert.deepEqual(notifications, []);
});

function enableUsageAutoApply(monitor, usedPercent = 96, resetAt = null) {
    monitor._autoApplyBankedResetOnUsage = true;
    monitor._autoApplyBankedResetUsageThreshold = 5;
    monitor._autoApplyBankedResetUsageWindow = "any";
    monitor._snapshot = { quotas: [{ usedPercent, resetAt }] };
    return monitor._snapshot;
}

for (const [usedPercent, resetAt, expected] of [
    [94.9, null, false],
    [95, null, false],
    [95.1, null, true],
    [100, null, true],
    [99, 1, false],
    [96, 9_999_999_999, true],
]) {
    test(`usage auto-apply below 5% left: ${100 - usedPercent}% left with reset ${resetAt}`, () => {
        const { monitor } = fixture();
        const snapshot = enableUsageAutoApply(monitor, usedPercent, resetAt);
        assert.equal(monitor._usageNeedsBankedReset(snapshot), expected);
        monitor._autoApplyBankedResetOnUsage = false;
        assert.equal(monitor._usageNeedsBankedReset(snapshot), false);
    });
}

test("usage auto-apply checks every quota and rejects replaced snapshots", () => {
    const { monitor } = fixture();
    const snapshot = enableUsageAutoApply(monitor, 10);
    snapshot.quotas.push({ usedPercent: 96 });
    assert.equal(monitor._usageNeedsBankedReset(snapshot), true);
    monitor._snapshot = { quotas: [] };
    assert.equal(monitor._usageNeedsBankedReset(snapshot), false);
});

for (const [window, sessionUsed, weeklyUsed, expected] of [
    ["any", 99, 10, true],
    ["weekly", 99, 10, false],
    ["weekly", 10, 99, true],
    ["session", 10, 99, false],
    ["session", 99, 10, true],
    ["weekly", 99, 95, false],
    ["window-3600", 99, 99, false],
]) {
    test(`selected window ${window}: session ${sessionUsed}, weekly ${weeklyUsed}`, () => {
        const { monitor } = fixture();
        const snapshot = enableUsageAutoApply(monitor);
        monitor._autoApplyBankedResetUsageWindow = window;
        snapshot.quotas = [
            { id: "session", usedPercent: sessionUsed, resetAt: null },
            { id: "weekly", usedPercent: weeklyUsed, resetAt: null },
        ];
        assert.equal(monitor._usageNeedsBankedReset(snapshot), expected);
        snapshot.quotas.reverse();
        assert.equal(
            monitor._usageNeedsBankedReset(snapshot),
            expected,
            "selection uses ID, not order",
        );
    });
}

test("usage auto-apply selects earliest unexpired credit and shares redemption refreshes", async () => {
    const { monitor, notifications } = fixture();
    const snapshot = enableUsageAutoApply(monitor);
    const expired = { ...earlier, id: "expired", expires_at: "2000-01-01T00:00:00Z" };
    let calls = 0;
    const ids = [];
    api.list = async () => {
        calls++;
        return { credits: [selected, expired, earlier] };
    };
    api.redeem = async (id) => ids.push(id);
    await monitor._refreshBankedResetsForAutoApply(snapshot);
    assert.deepEqual(ids, [earlier.id]);
    assert.equal(calls, 2);
    assert.match(notifications[0], /near a usage limit/);
});

for (const blockedBy of ["manual", "disabled", "replaced", "stopped", "window changed"]) {
    test(`usage auto-apply rechecks ${blockedBy} after inventory fetch`, async () => {
        const { monitor, notifications } = fixture();
        const snapshot = enableUsageAutoApply(monitor);
        const response = deferred();
        api.list = () => response.promise;
        const ids = [];
        api.redeem = async (id) => ids.push(id);
        const pending = monitor._refreshBankedResetsForAutoApply(snapshot);
        if (blockedBy === "manual") monitor._bankedResetPreparation = { creditId: earlier.id };
        if (blockedBy === "disabled") monitor._autoApplyBankedResetOnUsage = false;
        if (blockedBy === "replaced") monitor._snapshot = { quotas: [] };
        if (blockedBy === "stopped") monitor.stop();
        if (blockedBy === "window changed") monitor._autoApplyBankedResetUsageWindow = "weekly";
        response.resolve(inventory);
        await pending;
        assert.deepEqual(ids, []);
        assert.deepEqual(notifications, []);
    });
}

test("overlapping automatic triggers redeem at most one credit", async () => {
    const { monitor } = fixture();
    const snapshot = enableUsageAutoApply(monitor);
    monitor._autoApplyBankedReset = true;
    const response = deferred();
    let calls = 0;
    api.list = async () => {
        calls++;
        return response.promise;
    };
    const ids = [];
    api.redeem = async (id) => ids.push(id);
    const usage = monitor._refreshBankedResetsForAutoApply(snapshot);
    const expiry = monitor._refreshBankedResetsForAutoApply();
    response.resolve(inventory);
    await Promise.all([usage, expiry]);
    assert.deepEqual(ids, [earlier.id]);
    assert.equal(calls, 2, "one pre-redemption and one post-redemption inventory fetch");
});

test("live refresh auto-redeems once without deadlocking or consuming another credit", async () => {
    const { monitor } = fixture();
    enableUsageAutoApply(monitor);
    monitor.refreshUsage = CodexMonitor.prototype.refreshUsage;
    monitor._usageService = {
        refresh: async () => ({ quotas: [{ usedPercent: 99, resetAt: null }] }),
        readHistory: async () => [],
        predict: async () => null,
    };
    api.list = async () => inventory;
    const ids = [];
    api.redeem = async (id) => ids.push(id);
    await monitor.refreshUsage();
    assert.deepEqual(ids, [earlier.id]);
    assert.equal(monitor._refreshPromise, null);
    assert.equal(monitor.state.redeemingBankedReset, false);
});

test("failed usage refresh never auto-redeems from an existing high-usage snapshot", async () => {
    const { monitor } = fixture();
    enableUsageAutoApply(monitor);
    monitor.refreshUsage = CodexMonitor.prototype.refreshUsage;
    monitor._usageService = {
        refresh: async () => {
            throw new Error("offline");
        },
    };
    let calls = 0;
    api.list = async () => {
        calls++;
        return inventory;
    };
    await monitor.refreshUsage();
    assert.equal(calls, 0);
});

const earlier = { id: "earlier", status: "available", expires_at: "2098-01-01T00:00:00Z" };
const selected = { id: "selected", status: "available", expires_at: "2099-01-01T00:00:00Z" };
const inventory = { available_count: 2, credits: [earlier, selected] };

for (const outcome of ["success", "failure", "failure with cached inventory"]) {
    test(`popup refresh cooldown includes ${outcome} and expires five minutes after request start`, async (t) => {
        let now = 0;
        t.mock.method(Date, "now", () => now);
        const { monitor, changes } = fixture();
        const options = { maxAgeMs: 5 * 60 * 1000 };
        const response = deferred();
        let calls = 0;
        api.list = () => {
            calls++;
            return response.promise;
        };
        if (outcome === "failure with cached inventory") monitor._bankedResetSnapshot = inventory;
        const refresh = monitor.refreshBankedResets(options);
        await Promise.resolve();
        assert.equal(calls, 1, "first popup fetches even at timestamp zero");
        now = 20_000;
        const shared = monitor.refreshBankedResets(options);
        assert.equal(monitor.state.bankedResetLoading, true);
        if (outcome === "success") response.resolve(inventory);
        else response.reject(new Error("network down"));
        const result = outcome === "success" ? inventory : null;
        assert.equal(await refresh, result);
        assert.equal(await shared, result, "in-flight popup shares the actual request result");
        const state = monitor.state;
        const changeCount = changes.length;
        for (now of [20_000, 5 * 60 * 1000 - 1]) {
            assert.equal(await monitor.refreshBankedResets(options), state.bankedResetSnapshot);
            assert.equal(calls, 1);
            assert.deepEqual(monitor.state, state, "skips preserve errors and loading state");
            assert.equal(changes.length, changeCount, "skips do not emit a fake refresh");
        }
        api.list = async () => {
            calls++;
            return inventory;
        };
        now = 5 * 60 * 1000;
        assert.equal(await monitor.refreshBankedResets(options), inventory);
        assert.equal(calls, 2, "exact boundary allows another attempt, including after failure");
        assert.equal(monitor.state.bankedResetError, null);
    });
}

test("validation, redemption, and background refresh bypass popup cooldown and renew it", async (t) => {
    let now = 0;
    t.mock.method(Date, "now", () => now);
    const { monitor } = fixture();
    const options = { maxAgeMs: 5 * 60 * 1000 };
    let calls = 0;
    let currentInventory = inventory;
    api.list = async () => {
        calls++;
        return currentInventory;
    };
    api.redeem = async () => {
        currentInventory = { credits: [earlier, { ...selected, status: "redeemed" }] };
    };
    await monitor.refreshBankedResets(options);
    now = 20_000;
    assert.equal(await monitor.prepareBankedReset(selected.id), selected);
    assert.equal(calls, 2, "manual validation must fetch despite recent popup inventory");
    await monitor.redeemBankedReset(selected.id);
    assert.equal(calls, 3, "manual redemption must fetch post-redemption inventory");
    assert.equal(monitor.state.bankedResetSnapshot, currentInventory);
    now = 5 * 60 * 1000;
    await monitor.refreshBankedResets(options);
    assert.equal(calls, 3, "forced refresh renews cooldown beyond the original popup attempt");
    await monitor._refreshBankedResetsForAutoApply();
    assert.equal(calls, 4, "background inventory refresh bypasses popup cooldown");
    now += 20_000;
    await monitor.refreshBankedResets(options);
    assert.equal(calls, 4, "background refresh also renews popup cooldown");
});

test("manual preparation refreshes and returns the exact selected ID, not the earliest reset", async () => {
    const { monitor, changes } = fixture();
    let calls = 0;
    api.list = async () => {
        calls++;
        return inventory;
    };
    monitor._bankedResetSnapshot = { credits: [earlier] };
    assert.equal(await monitor.prepareBankedReset(selected.id), selected);
    assert.equal(calls, 1);
    assert.equal(monitor.state.bankedResetSnapshot, inventory);
    assert.equal(monitor.state.preparingBankedReset, false);
    assert.equal(changes[0].preparingBankedReset, true);
    assert.equal(changes[0].preparingBankedResetId, selected.id);
    assert.equal(monitor._bankedResetPreparation.creditId, selected.id);
    assert.equal(monitor.state.preparingBankedResetId, null, "modal reservation is not checking");
});

test("missing, redeemed, expired, and omitted selections never fall back to another reset", async () => {
    for (const credit of [
        null,
        { ...selected, status: "redeemed" },
        { ...selected, status: "unavailable" },
        { ...selected, expires_at: "2000-01-01T00:00:00Z" },
    ]) {
        const { monitor, notifications } = fixture();
        // A stale menu had this selection available; the new inventory is authoritative.
        monitor._bankedResetSnapshot = inventory;
        api.list = async () => ({ credits: credit ? [earlier, credit] : [earlier] });
        assert.equal(await monitor.prepareBankedReset(selected.id), null);
        assert.match(notifications[0], /selected.*no longer available/i);
        api.list = async () => inventory;
        assert.equal(
            await monitor.prepareBankedReset(selected.id),
            selected,
            "invalid selection releases ownership",
        );
    }
    const { monitor } = fixture();
    api.list = async () => inventory;
    assert.equal(await monitor.prepareBankedReset(), null);
});

test("available selections without a parseable expiry retain API availability semantics", async () => {
    for (const expires_at of [undefined, null, "unknown"]) {
        const { monitor } = fixture();
        const credit = { ...selected, expires_at };
        api.list = async () => ({ credits: [credit] });
        assert.equal(await monitor.prepareBankedReset(credit.id), credit);
    }
});

test("inventory refresh deduplicates popup, preparation, and reentrant loading requests", async () => {
    const { monitor } = fixture();
    const response = deferred();
    let calls = 0;
    api.list = () => {
        calls++;
        return response.promise;
    };
    let reentrant;
    monitor.onChange = (state) => {
        if (state.bankedResetLoading) reentrant = monitor.refreshBankedResets();
    };
    assert.equal(monitor.state.bankedResetSnapshot, null);
    assert.equal(monitor.state.bankedResetLoading, false);
    assert.equal(monitor.state.bankedResetError, null);
    const refresh = monitor.refreshBankedResets();
    const prepare = monitor.prepareBankedReset(selected.id);
    assert.equal(monitor.state.bankedResetLoading, true);
    response.resolve(inventory);
    assert.equal(await refresh, inventory);
    assert.equal(await prepare, selected);
    assert.equal(await reentrant, inventory);
    assert.equal(calls, 1);
    assert.equal(monitor.state.bankedResetLoading, false);
});

test("manual refresh failure notifies without an inventory error and never validates stale data", async () => {
    const { monitor, notifications } = fixture();
    monitor._bankedResetSnapshot = inventory;
    api.list = async () => {
        throw { name: "CodexError", message: "Authentication expired. Log in again." };
    };
    assert.equal(await monitor.prepareBankedReset(selected.id), null);
    assert.equal(monitor.state.bankedResetSnapshot, inventory);
    assert.equal(monitor.state.bankedResetLoading, false);
    assert.equal(monitor.state.bankedResetError, null);
    assert.equal(monitor.state.preparingBankedReset, false);
    assert.equal(monitor.state.preparingBankedResetId, null);
    assert.deepEqual(notifications, ["Authentication expired. Log in again."]);
    api.list = async () => inventory;
    const refresh = monitor.refreshBankedResets();
    assert.equal(monitor.state.bankedResetError, null);
    assert.equal(await refresh, inventory);
    assert.equal(
        await monitor.prepareBankedReset(selected.id),
        selected,
        "failed preparation releases ownership",
    );
});

test("manual validation joining a general refresh preserves its inventory error", async () => {
    const { monitor, notifications } = fixture();
    monitor._bankedResetSnapshot = inventory;
    const response = deferred();
    api.list = () => response.promise;
    const refresh = monitor.refreshBankedResets();
    const preparation = monitor.prepareBankedReset(selected.id);
    assert.equal(monitor.state.preparingBankedResetId, selected.id);
    response.reject({ name: "CodexError", message: "Inventory failed" });
    assert.equal(await refresh, null);
    assert.equal(await preparation, null);
    assert.equal(monitor.state.bankedResetError, "Inventory failed");
    assert.equal(monitor.state.preparingBankedResetId, null);
    assert.deepEqual(notifications, ["Inventory failed"]);
});

test("unexpected inventory failures expose a useful generic error", async () => {
    const { monitor } = fixture();
    api.list = async () => {
        throw new Error("network down");
    };
    assert.equal(await monitor.refreshBankedResets(), null);
    assert.equal(monitor.state.bankedResetLoading, false);
    assert.match(monitor.state.bankedResetError, /Unable to load.*Try again later/);
});

for (const manualFirst of [false, true]) {
    test(`manual selection owns shared refresh through confirmation (manual first: ${manualFirst})`, async () => {
        const { monitor } = fixture();
        monitor._autoApplyBankedReset = true;
        const response = deferred();
        const expiring = { ...selected, expires_at: new Date(Date.now() + 60_000).toISOString() };
        let calls = 0;
        let redemptions = 0;
        api.list = () => {
            calls++;
            return response.promise;
        };
        api.redeem = async () => {
            redemptions++;
        };
        const first = manualFirst
            ? monitor.prepareBankedReset(selected.id)
            : monitor._refreshBankedResetsForAutoApply();
        const second = manualFirst
            ? monitor._refreshBankedResetsForAutoApply()
            : monitor.prepareBankedReset(selected.id);
        response.resolve({ credits: [expiring] });
        const results = await Promise.all([first, second]);
        assert.equal(results[manualFirst ? 0 : 1], expiring);
        assert.equal(redemptions, 0, "auto-apply must not consume the manually selected credit");
        assert.equal(calls, 1);
        assert.equal(monitor.state.preparingBankedReset, false);

        // Confirmation may stay open over another timer tick or inventory refresh.
        await monitor._refreshBankedResetsForAutoApply();
        assert.equal(redemptions, 0, "ownership must survive preparation completion");
        monitor.cancelBankedResetPreparation();
        await monitor._refreshBankedResetsForAutoApply();
        assert.equal(redemptions, 1, "cancel releases ownership for normal auto-apply");
    });
}

for (const available_count of [0, 1, 5]) {
    test(`inventory count ${available_count} overrides a conflicting usage count`, async () => {
        const { monitor } = fixture();
        assert.equal(monitor.state.bankedResetCount, null);
        monitor._snapshot = { bankedResetCount: 3 };
        assert.equal(monitor.state.bankedResetCount, 3, "usage count is the initial fallback");
        api.list = async () => ({ ...inventory, available_count });
        await monitor.refreshBankedResets();
        assert.equal(monitor.state.bankedResetCount, available_count);
        monitor._snapshot = { bankedResetCount: 4 };
        assert.equal(
            monitor.state.bankedResetCount,
            available_count,
            "usage updates cannot overwrite inventory count",
        );
    });
}

test("cancelling an in-flight preparation suppresses its result and releases ownership", async () => {
    const { monitor, notifications } = fixture();
    const response = deferred();
    api.list = () => response.promise;
    const preparation = monitor.prepareBankedReset(selected.id);
    monitor.cancelBankedResetPreparation();
    monitor.cancelBankedResetPreparation();
    response.resolve(inventory);
    assert.equal(await preparation, null);
    assert.equal(monitor.state.preparingBankedReset, false);
    assert.deepEqual(notifications, []);
    assert.equal(await monitor.prepareBankedReset(selected.id), selected);
    assert.equal(
        await monitor.prepareBankedReset(earlier.id),
        null,
        "a second selection cannot replace modal ownership",
    );
    monitor.cancelBankedResetPreparation();
    assert.equal(await monitor.prepareBankedReset(earlier.id), earlier);
});

for (const failRedemption of [false, true]) {
    test(`manual ownership lasts through redemption and is released in finally (failure: ${failRedemption})`, async () => {
        const { monitor } = fixture();
        monitor._autoApplyBankedReset = true;
        const expiring = { ...selected, expires_at: new Date(Date.now() + 60_000).toISOString() };
        api.list = async () => ({ credits: [expiring] });
        assert.equal(await monitor.prepareBankedReset(selected.id), expiring);
        const ownership = monitor._bankedResetPreparation;
        const consumed = deferred();
        const redeemedIds = [];
        api.redeem = (id) => {
            redeemedIds.push(id);
            return consumed.promise;
        };
        const redemption = monitor.redeemBankedReset(selected.id);
        monitor.cancelBankedResetPreparation();
        assert.equal(
            monitor._bankedResetPreparation,
            ownership,
            "cancel cannot release an in-flight redemption",
        );
        await monitor._refreshBankedResetsForAutoApply();
        assert.deepEqual(redeemedIds, [selected.id]);
        if (failRedemption) consumed.reject(new Error("redemption failed"));
        else consumed.resolve();
        await redemption;
        assert.equal(monitor._bankedResetPreparation, null);
        assert.equal(monitor.state.redeemingBankedReset, false);
        assert.equal(
            await monitor.prepareBankedReset(selected.id),
            expiring,
            "ownership is released after success or failure",
        );
    });
}

test("redemption waits out older inventory requests and fetches post-redemption inventory", async () => {
    const { monitor } = fixture();
    const oldResponse = deferred();
    const consumed = deferred();
    const after = { credits: [{ ...selected, status: "redeemed" }] };
    let calls = 0;
    let redeemedId;
    api.list = () => (++calls === 1 ? oldResponse.promise : Promise.resolve(after));
    api.redeem = async (id) => {
        redeemedId = id;
        consumed.resolve();
    };
    const refresh = monitor.refreshBankedResets();
    const redeem = monitor.redeemBankedReset(selected.id);
    await consumed.promise;
    assert.equal(monitor.state.redeemingBankedReset, true);
    oldResponse.resolve(inventory);
    await Promise.all([refresh, redeem]);
    assert.equal(redeemedId, selected.id);
    assert.equal(calls, 2);
    assert.equal(monitor.state.bankedResetSnapshot, after);
    assert.equal(monitor.state.redeemingBankedReset, false);
});

test("background auto-redemption still selects the earliest expiring reset and refreshes inventory", async () => {
    const { monitor, notifications } = fixture();
    monitor._autoApplyBankedReset = true;
    const now = Date.now();
    const later = { ...selected, expires_at: new Date(now + 45 * 60_000).toISOString() };
    const soon = { ...earlier, expires_at: new Date(now + 30 * 60_000).toISOString() };
    const after = { credits: [later, { ...soon, status: "redeemed" }] };
    let calls = 0;
    let redeemedId;
    api.list = async () => (++calls === 1 ? { credits: [later, soon] } : after);
    api.redeem = async (id) => {
        redeemedId = id;
    };
    await monitor._refreshBankedResetsForAutoApply();
    assert.equal(redeemedId, soon.id);
    assert.equal(calls, 2);
    assert.equal(monitor.state.bankedResetSnapshot, after);
    assert.equal(notifications[0], "Expiring banked Codex reset redeemed automatically.");
    await monitor.refreshBankedResets({ maxAgeMs: 5 * 60 * 1000 });
    assert.equal(calls, 2, "automatic post-redemption refresh establishes popup cooldown");
});

test("stop cancels shared inventory and suppresses late state changes and notifications", async () => {
    const { monitor, changes, notifications } = fixture();
    const response = deferred();
    let cancellable;
    api.list = (options) => {
        cancellable = options.cancellable;
        return response.promise;
    };
    const prepare = monitor.prepareBankedReset(selected.id);
    await Promise.resolve();
    monitor.stop();
    const changeCount = changes.length;
    assert.equal(cancellable.cancelled, true);
    response.resolve(inventory);
    assert.equal(await prepare, null);
    assert.equal(monitor.state.bankedResetSnapshot, null);
    assert.equal(changes.length, changeCount);
    assert.deepEqual(notifications, []);
    assert.equal(await monitor.refreshBankedResets(), null);
});
