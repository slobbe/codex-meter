import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const monitorUrl = new URL("../src/background/monitor.js", import.meta.url).href;
const stubUrl = `data:text/javascript,${encodeURIComponent(`
    export const api = { list: null, redeem: null };
    export const listCodexBankedResets = options => api.list(options);
    export const redeemCodexBankedReset = (id, options) => api.redeem(id, options);
    export class Cancellable { cancel() { this.cancelled = true; } }
    class GLibError extends Error { matches() { return true; } }
    export default { Cancellable, Error: GLibError, IOErrorEnum: { CANCELLED: 1 } };
    export class UsageService {}
    export class PeriodicTask { start() {} stop() {} }
    export const readSettings = () => ({ autoApplyBankedReset: false });
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

function fixture() {
    const notifications = [];
    const changes = [];
    const settings = { connect() {}, disconnect() {} };
    const monitor = new CodexMonitor(settings, (message) => notifications.push(message));
    monitor.onChange = (state) => changes.push(state);
    monitor.refreshUsage = async () => {};
    return { monitor, notifications, changes };
}

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

test("background auto-apply still selects the earliest expiring reset and refreshes inventory", async () => {
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
    assert.match(notifications[0], /automatically/);
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
