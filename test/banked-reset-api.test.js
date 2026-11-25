import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { beforeEach } from "node:test";

const apiUrl = new URL("../src/codex/banked-resets/api.js", import.meta.url).href;
const authUrl = new URL("../src/codex/auth/auth.js", import.meta.url).href;
const usageUrl = new URL("../src/codex/usage/api.js", import.meta.url).href;
const monitorUrl = new URL("../src/background/monitor.js", import.meta.url).href;
const stubUrl = `data:text/javascript,${encodeURIComponent(`
    import { createHash, randomUUID } from "node:crypto";
    export const io = {};
    class Cancellable {
        cancel() { this.cancelled = true; }
        is_cancelled() { return !!this.cancelled; }
        set_error_if_cancelled() { if (this.cancelled) throw new Error("Cancelled"); }
    }
    export default {
        uuid_string_random: randomUUID, Cancellable, Error,
        base64_decode: value => Buffer.from(value, 'base64'),
        ChecksumType: { SHA256: 'sha256' },
        compute_checksum_for_string: (type, value) => createHash(type).update(value).digest('hex'),
    };
    export class UsageService {}
    export class PeriodicTask { start() {} stop() {} }
    export const readSettings = () => ({ autoApplyBankedReset: true });
    export const readBankedResetSkipMinutes = () => ({});
    export const SETTINGS_BANKED_RESET_SKIP_MINUTES = "banked-reset-skip-minutes";
    export const SETTINGS_USAGE_NOTIFICATIONS = "usage-notifications";
    export const SETTINGS_USAGE_NOTIFICATION_THRESHOLD = "usage-notification-threshold";

    export const SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE = "auto-usage";

    export const getBackgroundRefreshIntervalSeconds = () => 0;
    export const SETTINGS_AUTO_APPLY_BANKED_RESET = "auto-apply";
    export const SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES = "refresh";
    export const isCancellationError = () => false;
    export const formatRefreshFailure = () => "Usage refresh failed";
    export async function readJsonFile(credentialsPath, cancellable) {
        io.authPaths.push(credentialsPath);
        io.authCalls.push(cancellable);
        const auth = structuredClone(io.auth);
        await io.afterAuth?.();
        return auth;
    }
    export async function fetchJson(url, config, options) {
        io.requests.push({ url, config, options });
        await io.afterFetch?.(url, options);
        return io.respond ? io.respond(url, options) : io.response;
    }
`)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (
            ((context.parentURL === apiUrl || context.parentURL === usageUrl) &&
                ["gi://GLib", "../../io/http.js"].includes(specifier)) ||
            (context.parentURL === authUrl &&
                ["gi://Gio", "gi://GLib", "../../io/files.js"].includes(specifier))
        ) {
            return { url: stubUrl, shortCircuit: true };
        }
        if (
            context.parentURL === monitorUrl &&
            ![
                "../codex/auth/auth.js",
                "../codex/banked-resets/api.js",
                "../codex/banked-resets/response.js",
                "../codex/error.js",
                "../codex/usage/model.js",
            ].includes(specifier)
        ) {
            return { url: stubUrl, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});
const { listCodexBankedResets, redeemCodexBankedReset } = await import(apiUrl);
const { refreshCodexUsage } = await import(usageUrl);
const { CodexMonitor } = await import(monitorUrl);
const { io } = await import(stubUrl);
hooks.deregister();

const listUrl = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const credentialsPath = "/custom/auth.json";
const expiringCredit = () => ({
    id: "credit-a",
    status: "available",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
});
const list = (options) => listCodexBankedResets({ credentialsPath, ...options });
const redeem = (options) =>
    redeemCodexBankedReset("credit-a", {
        credentialsPath,
        credentials: {
            accessToken: io.auth.tokens.access_token,
            accountId: io.auth.tokens.account_id,
        },
        ...options,
    });
const operations = [
    ["list", list],
    ["redeem", redeem],
];

beforeEach(() => {
    Object.assign(io, {
        auth: { tokens: { access_token: "test-token", account_id: "test-account" } },
        response: { available_count: 1, credits: [{ id: "credit-a", status: "available" }] },
        authCalls: [],
        authPaths: [],
        requests: [],
        afterAuth: null,
        afterFetch: null,
        respond: null,
    });
});

for (const [name, operation] of operations) {
    test(`${name} reads credentials from the configured file`, async () => {
        if (name === "redeem") io.response = { code: "reset", windows_reset: 2 };
        await operation();
        assert.deepEqual(io.authPaths, Array(name === "list" ? 2 : 1).fill(credentialsPath));
    });

    test(`${name} sends authentication headers and optional account ID`, async () => {
        for (const accountId of ["test-account", null]) {
            io.auth.tokens.account_id = accountId;
            if (name === "redeem") io.response = { code: "reset", windows_reset: 2 };
            assert.equal(await operation(), io.response);
            const { url, options } = io.requests.at(-1);
            assert.equal(url, name === "list" ? listUrl : `${listUrl}/consume`);
            assert.equal(options.headers.Authorization, "Bearer test-token");
            assert.equal(options.headers.originator, "Codex Desktop");
            assert.equal(options.headers["ChatGPT-Account-ID"], accountId ?? undefined);
            assert.equal(options.cancellable, null);
            assert.equal(io.authCalls.at(-1), null);
            if (name === "list") {
                assert.equal(options.method, undefined);
                assert.equal(options.body, undefined);
            }
        }
    });

    for (const phase of ["before auth", "after auth", "after fetch"]) {
        test(`${name} preserves cancellation ${phase}`, async () => {
            const original = new Error("cancelled");
            let cancelled = phase === "before auth";
            const cancellable = {
                set_error_if_cancelled() {
                    if (cancelled) throw original;
                },
            };
            if (phase === "after auth") io.afterAuth = () => (cancelled = true);
            if (phase === "after fetch") io.afterFetch = () => (cancelled = true);

            await assert.rejects(operation({ cancellable }), (error) => error === original);
            assert.deepEqual(io.authCalls, phase === "before auth" ? [] : [cancellable]);
            assert.equal(io.requests.length, phase === "after fetch" ? 1 : 0);
            if (io.requests.length) {
                assert.equal(io.requests[0].options.cancellable, cancellable);
            }
        });
    }

    test(`${name} preserves network errors`, async () => {
        const original = new Error("network failed");
        io.afterFetch = () => {
            throw original;
        };
        await assert.rejects(operation(), (error) => error === original);
    });
}

test("redeem posts the credit ID and a fresh request UUID and returns the response", async () => {
    io.response = { code: "reset", windows_reset: 2 };
    const requestIds = [];
    for (let attempt = 0; attempt < 2; attempt++) {
        assert.equal(await redeem(), io.response);
        const { options } = io.requests.at(-1);
        assert.equal(options.method, "POST");
        assert.equal(options.headers["Content-Type"], "application/json");
        const body = JSON.parse(options.body);
        assert.deepEqual(Object.keys(body).sort(), ["credit_id", "redeem_request_id"]);
        assert.equal(body.credit_id, "credit-a");
        assert.match(
            body.redeem_request_id,
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        requestIds.push(body.redeem_request_id);
    }
    assert.notEqual(requestIds[0], requestIds[1]);
});

test("redeem rejects responses that do not confirm a reset instead of reporting success", async () => {
    for (const response of [
        {},
        { success: false },
        { error: "reset_not_applied" },
        io.response,
        { code: "unknown" },
        { code: "reset", windows_reset: 0 },
        { code: "reset", windows_reset: -1 },
        { code: "reset", windows_reset: "2" },
        { code: "reset", windows_reset: 0.5 },
        { code: "reset", windows_reset: null },
    ]) {
        io.response = response;
        await assert.rejects(
            redeem(),
            (error) => error.kind === "unexpected-response" || error.kind === "redemption-failed",
        );
    }
});

const redemptionFailures = [
    [
        "nothing_to_reset",
        "Reset not redeemed. Codex reported nothing to reset. Keep this reset for later.",
    ],
    ["no_credit", "Reset not redeemed. The selected reset is unavailable. Choose another reset."],
    [
        "already_redeemed",
        "Reset not redeemed. The selected reset was already redeemed. Choose another reset.",
    ],
];

for (const [code, message] of redemptionFailures) {
    test(`redeem reports ${code} rather than success`, async () => {
        io.response = { code, windows_reset: 0 };
        await assert.rejects(redeem(), (error) => {
            assert.equal(error.kind, "redemption-failed");
            assert.equal(error.message, message);
            assert.equal(error.technicalMessage, `Codex banked reset redemption returned ${code}`);
            return true;
        });
    });
}

test("redeem accepts an explicit reset outcome from backends omitting the window count", async () => {
    io.response = { code: "reset" };
    assert.equal(await redeem(), io.response);
});

for (const automatic of [false, true]) {
    for (const code of ["reset", ...redemptionFailures.map(([code]) => code), "unknown"]) {
        test(`${automatic ? "automatic" : "manual"} redemption only notifies success for a confirmed reset (${code})`, async (t) => {
            const notifications = [];
            const warnings = [];
            t.mock.method(console, "warn", (...args) => warnings.push(args));
            const monitor = new CodexMonitor(
                { connect() {} },
                (message) => notifications.push(message),
                credentialsPath,
            );
            const usage = { bankedResetCount: 1 };
            const inventory = { available_count: 1, credits: [expiringCredit()] };
            const empty = { available_count: 0, credits: [] };
            const invalidates = code === "no_credit" || code === "already_redeemed";
            const refreshFails = code === "already_redeemed";
            const counts = [];
            let consumed = false;
            let usageRefreshes = 0;
            monitor._snapshot = usage;
            monitor.refreshUsage = async () => usageRefreshes++;
            monitor.onChange = (state) => {
                if (consumed) counts.push(state.bankedResetCount);
            };
            io.respond = (url) => {
                if (url.endsWith("/consume")) {
                    consumed = true;
                    return { code, windows_reset: code === "reset" ? 2 : 0 };
                }
                if (consumed && refreshFails) throw new Error("List unavailable");
                return consumed ? empty : inventory;
            };

            if (automatic) {
                await monitor._refreshBankedResetsForAutoApply();
            } else {
                assert.equal(await monitor.prepareBankedReset("credit-a"), inventory.credits[0]);
                await monitor.redeemBankedReset("credit-a");
            }

            if (code === "reset") {
                assert.deepEqual(notifications, [
                    automatic
                        ? "Expiring banked Codex reset redeemed automatically."
                        : "Banked Codex reset redeemed.",
                ]);
                assert.equal(usageRefreshes, 1);
                assert.equal(io.requests.filter(({ url }) => url === listUrl).length, 2);
                assert.equal(warnings.length, 0);
            } else {
                assert.equal(usageRefreshes, 0, "a no-op is not treated as a redeemed reset");
                assert.equal(monitor.state.snapshot, usage);
                assert.equal(
                    io.requests.filter(({ url }) => url === listUrl).length,
                    invalidates ? 2 : 1,
                );
                assert.equal(
                    monitor.state.bankedResetSnapshot,
                    invalidates
                        ? refreshFails
                            ? null
                            : empty
                        : code === "unknown"
                          ? null
                          : inventory,
                );
                if (invalidates) {
                    assert.ok(
                        counts.includes(null),
                        "the stale quota count is hidden during refresh",
                    );
                    assert.equal(monitor.state.bankedResetCount, refreshFails ? null : 0);
                }
                if (automatic) {
                    assert.deepEqual(notifications, []);
                    assert.equal(warnings.length, 1);
                } else {
                    assert.equal(notifications.length, 1);
                    assert.equal(
                        notifications[0],
                        redemptionFailures.find(([outcome]) => outcome === code)?.[1] ??
                            "Codex returned banked reset data this extension does not understand.",
                    );
                }
            }
            assert.equal(monitor.state.redeemingBankedReset, false);
            assert.equal(monitor._redeemBankedResetCancellable, null);
        });
    }
}

function useAccount(accountId, signature = "one", sub = "test-user") {
    const claims = Buffer.from(
        JSON.stringify({
            sub,
            "https://api.openai.com/auth": { chatgpt_account_id: accountId },
        }),
    ).toString("base64url");
    io.auth = { tokens: { access_token: `mock.${claims}.${signature}` } };
}

function usageMonitor(t, notify = () => {}, settings = { connect() {} }, options = {}) {
    const { path = credentialsPath, bankedResetConsumes } = options;
    const monitor = new CodexMonitor(settings, notify, path, undefined, { bankedResetConsumes });
    monitor._autoApplyBankedReset = false;
    monitor._autoApplyBankedResetOnUsage = true;
    monitor._usageService = {
        refresh: (options) => refreshCodexUsage({ ...options, credentialsPath: path }),
        readHistory: async () => [],
        predict: async () => null,
        readCachedSnapshot: async () => null,
    };
    const usage = {
        plan_type: "test",
        rate_limit: {
            limit_reached: false,
            primary_window: {
                used_percent: 99,
                limit_window_seconds: 3600,
                reset_after_seconds: 3600,
                reset_at: Math.floor(Date.now() / 1000) + 3600,
            },
        },
    };
    io.respond = (url) =>
        url.endsWith("/usage") ? usage : url === listUrl ? io.response : { code: "reset" };
    t.mock.method(console, "warn", () => {});
    return monitor;
}

test("manual refresh retries failed popup inventory within cooldown even when usage fails", async (t) => {
    t.mock.method(Date, "now", () => 1_800_000_000_000);
    const monitor = usageMonitor(t);
    const popupOptions = { maxAgeMs: 5 * 60 * 1000 };
    io.respond = () => {
        throw new Error("network down");
    };
    assert.equal(await monitor.refreshBankedResets(popupOptions), null);
    assert.ok(monitor.state.bankedResetError);
    await monitor.refreshBankedResets(popupOptions);
    assert.equal(io.requests.length, 1, "popup remains on cooldown after failure");

    io.respond = (url) => {
        if (url === listUrl) return io.response;
        throw new Error("usage unavailable");
    };
    await monitor.refreshManually();
    assert.equal(monitor.state.errorMessage, "Usage refresh failed");
    assert.equal(monitor.state.bankedResetSnapshot, io.response);
    assert.equal(monitor.state.bankedResetError, null);
    assert.equal(io.requests.filter(({ url }) => url === listUrl).length, 2);
});

test("usage, inventory, and consume keep the verified account across a token refresh", async (t) => {
    useAccount("account-a");
    const originalToken = io.auth.tokens.access_token;
    const monitor = usageMonitor(t);
    monitor.onChange = (state) => {
        if (state.redeemingBankedReset) useAccount("account-a", "rotated");
    };
    await monitor.refreshUsage();

    const [usage, list, consume] = io.requests;
    assert.deepEqual(
        [usage.url.split("/").at(-1), list.url, consume.url],
        ["usage", listUrl, `${listUrl}/consume`],
    );
    for (const request of [usage, list, consume]) {
        assert.equal(request.options.headers["ChatGPT-Account-ID"], "account-a");
    }
    assert.equal(usage.options.headers.Authorization, `Bearer ${originalToken}`);
    assert.equal(list.options.headers.Authorization, `Bearer ${originalToken}`);
    assert.equal(consume.options.headers.Authorization, `Bearer ${io.auth.tokens.access_token}`);
    assert.notEqual(consume.options.headers.Authorization, usage.options.headers.Authorization);
});

for (const phase of ["usage", "list", "consume"]) {
    test(`automatic redemption aborts when credentials are replaced during ${phase}`, async (t) => {
        useAccount("account-a");
        const monitor = usageMonitor(t);
        if (phase === "consume") {
            monitor.onChange = ({ redeemingBankedReset }) => {
                if (redeemingBankedReset) useAccount("account-b");
            };
        } else {
            io.afterFetch = (url) => {
                if (url.endsWith(phase === "usage" ? "/usage" : "/rate-limit-reset-credits")) {
                    useAccount("account-b");
                }
            };
        }
        await monitor.refreshUsage();
        assert.equal(
            io.requests.some(({ options }) => options.method === "POST"),
            false,
        );
        assert.equal(monitor.state.snapshot, null, "old account usage is not shown");
        assert.equal(monitor.state.bankedResetSnapshot, null, "old account inventory is not shown");
    });
}

for (const change of [
    "skip period",
    "imminent reset",
    "new snapshot",
    "usage credit expired",
    "expiry credit expired",
    "expiry opt-out",
]) {
    test(`automatic consume silently rechecks ${change} after reading credentials`, async (t) => {
        useAccount("account-a");
        let now = 1_800_000_000_000;
        t.mock.method(Date, "now", () => now);
        const messages = [];
        const monitor = usageMonitor(t, (message) => messages.push(message));
        monitor._autoApplyBankedReset = change.startsWith("expiry");
        if (change === "imminent reset") monitor._bankedResetSkipMinutes = { "window-3600": 5 };
        const expiresAt =
            now + (change.endsWith("expired") || monitor._autoApplyBankedReset ? 2000 : 7200_000);
        io.response = {
            available_count: 1,
            credits: [{ ...expiringCredit(), expires_at: new Date(expiresAt).toISOString() }],
        };
        const preflight = Promise.withResolvers();
        const release = Promise.withResolvers();
        monitor.onChange = ({ redeemingBankedReset }) => {
            if (!redeemingBankedReset) return;
            io.afterAuth = () => {
                io.afterAuth = null;
                preflight.resolve();
                return release.promise;
            };
        };
        const refresh = monitor.refreshUsage();
        await preflight.promise;
        if (change === "skip period") monitor._bankedResetSkipMinutes = { "window-3600": 60 };
        if (change === "imminent reset") now += 3500_000;
        if (change === "new snapshot") monitor._snapshot = { ...monitor.state.snapshot };
        if (change.endsWith("expired")) now = expiresAt;
        if (change === "expiry opt-out") monitor._autoApplyBankedReset = false;
        release.resolve();
        await refresh;

        assert.equal(
            io.requests.some(({ options }) => options.method === "POST"),
            false,
        );
        assert.equal(console.warn.mock.callCount(), 0, "ineligibility is not an account error");
        assert.deepEqual(messages, []);
        assert.equal(monitor.state.redeemingBankedReset, false);
    });
}

test("opting out during consume still reports a confirmed reset and refreshes its account", async (t) => {
    useAccount("account-a");
    const messages = [];
    const callbacks = new Map();
    const monitor = usageMonitor(t, (message) => messages.push(message), {
        connect: (signal, callback) => callbacks.set(signal, callback),
        get_boolean: () => false,
    });
    const dispatched = Promise.withResolvers();
    const release = Promise.withResolvers();
    io.afterFetch = (url) => {
        if (url.endsWith("/consume")) {
            dispatched.resolve();
            return release.promise;
        }
    };
    const refresh = monitor.refreshUsage();
    await dispatched.promise;
    callbacks.get("changed::auto-usage")();
    release.resolve();
    await refresh;

    assert.deepEqual(messages, ["Banked Codex reset redeemed automatically near a usage limit."]);
    const paths = io.requests.map(({ url }) => url.split("/").at(-1));
    assert.deepEqual(paths.slice(0, 3), ["usage", "rate-limit-reset-credits", "consume"]);
    assert.deepEqual(paths.slice(3).sort(), ["rate-limit-reset-credits", "usage"]);
});

for (const transition of ["account switch", "stop"]) {
    test(`consume completion never updates the wrong UI after ${transition}`, async (t) => {
        useAccount("account-a");
        const messages = [];
        const monitor = usageMonitor(t, (message) => messages.push(message), {
            connect() {},
            disconnect() {},
        });
        const dispatched = Promise.withResolvers();
        const release = Promise.withResolvers();
        io.afterFetch = (url, options) => {
            if (url.endsWith("/consume")) {
                dispatched.resolve(options.cancellable);
                return release.promise;
            }
        };
        const changes = [];
        monitor.onChange = (state) => changes.push(state);
        const refresh = monitor.refreshUsage();
        const transport = await dispatched.promise;
        if (transition === "stop") {
            monitor.stop();
        } else {
            useAccount("account-b");
            await monitor.refreshUsage();
            await monitor.refreshBankedResets();
        }
        const { snapshot, bankedResetSnapshot } = monitor.state;
        const requests = io.requests.length;
        const emitted = changes.length;
        assert.equal(transport.is_cancelled(), transition === "stop");
        release.resolve();
        await refresh;

        assert.deepEqual(messages, []);
        assert.equal(
            io.requests.length,
            requests,
            "no redemption follow-up runs for another account",
        );
        assert.equal(monitor.state.snapshot, snapshot);
        assert.equal(monitor.state.bankedResetSnapshot, bankedResetSnapshot);
        if (transition === "stop") assert.equal(changes.length, emitted);
    });
}

for (const failure of ["lost response", "unknown reply"]) {
    test(`automatic redemption waits for fresh inventory and usage after ${failure}`, async (t) => {
        useAccount("account-a");
        const monitor = usageMonitor(t);
        monitor._autoApplyBankedReset = true;
        const oldRespond = io.respond;
        let attempts = 0;
        let failUsage = false;
        let failList = false;
        io.respond = (url, options) => {
            if (url.endsWith("/consume")) {
                attempts++;
                if (attempts === 1) {
                    if (failure === "lost response") throw new Error("Response lost");
                    return { code: "unknown" };
                }
            }
            if (url === listUrl) {
                if (failList) throw new Error("Inventory unavailable");
                return { available_count: 1, credits: [expiringCredit()] };
            }
            if (url.endsWith("/usage") && failUsage) throw new Error("Usage unavailable");
            return oldRespond(url, options);
        };
        await monitor.refreshUsage();
        assert.equal(attempts, 1, "an ambiguous consume is not retried");

        failUsage = true;
        await monitor._refreshBankedResetsForAutoApply();
        assert.equal(attempts, 1, "inventory alone cannot authorize another auto decision");

        failUsage = false;
        failList = true;
        await monitor.refreshUsage();
        assert.equal(attempts, 1, "usage alone cannot authorize another auto decision");

        failList = false;
        await monitor._refreshBankedResetsForAutoApply();
        assert.equal(attempts, 2, "a later decision can use both refreshed observations");
    });
}

test("path replacements keep an ambiguous consume scoped to its verified account", async (t) => {
    const bankedResetConsumes = new Map();
    const messages = [];
    const createMonitor = (path) =>
        usageMonitor(
            t,
            (message) => messages.push(message),
            { connect() {}, disconnect() {} },
            {
                bankedResetConsumes,
                path,
            },
        );
    useAccount("account-a");
    const first = createMonitor("/first/auth.json");
    const dispatched = Promise.withResolvers();
    const release = Promise.withResolvers();
    io.afterFetch = (url, options) => {
        if (!url.endsWith("/consume")) return;
        if (options.headers["ChatGPT-Account-ID"] !== "account-a") return;
        dispatched.resolve(options.cancellable);
        return release.promise;
    };
    const initial = first.refreshUsage();
    const transport = await dispatched.promise;
    first.stop({ replacing: true });
    assert.equal(transport.is_cancelled(), false);

    useAccount("account-b");
    const other = createMonitor("/second/auth.json");
    await other.refreshUsage();
    other.stop({ replacing: true });
    useAccount("account-a", "rotated");
    const replacement = createMonitor("/first/auth.json");
    const posts = () => io.requests.filter(({ options }) => options.method === "POST");
    await replacement.refreshUsage();
    assert.deepEqual(
        posts().map(({ options }) => options.headers["ChatGPT-Account-ID"]),
        ["account-a", "account-b"],
    );

    const oldRespond = io.respond;
    io.respond = (url, options) => {
        if (url.endsWith("/consume")) throw new Error("Response lost");
        return oldRespond(url, options);
    };
    release.resolve();
    await initial;
    assert.equal(messages.length, 1, "only the other account reports a reset");
    io.afterFetch = null;
    replacement._autoApplyBankedReset = true;
    io.response = { available_count: 1, credits: [expiringCredit()] };
    io.respond = (url, options) => {
        if (url.endsWith("/usage")) throw new Error("Usage unavailable");
        return oldRespond(url, options);
    };
    await replacement._refreshBankedResetsForAutoApply();
    assert.equal(posts().length, 2, "pre-settlement usage cannot authorize another consume");

    io.respond = oldRespond;
    const before = io.requests.length;
    await replacement._refreshBankedResetsForAutoApply();
    assert.deepEqual(
        io.requests.slice(before, before + 3).map(({ url }) => url.split("/").at(-1)),
        ["rate-limit-reset-credits", "usage", "consume"],
    );
    assert.equal(posts().length, 3);
    assert.equal(bankedResetConsumes.size, 0, "confirmed refreshes clear the marker");
    replacement.stop();
});

test("a popup inventory request cannot swallow a new account's low-quota trigger", async (t) => {
    useAccount("account-a");
    const monitor = usageMonitor(t);
    const requested = Promise.withResolvers();
    const release = Promise.withResolvers();
    const joined = Promise.withResolvers();
    io.afterFetch = (url, { headers }) => {
        if (url === listUrl && headers["ChatGPT-Account-ID"] === "account-a") {
            requested.resolve();
            return release.promise;
        }
    };
    const refreshInventory = monitor.refreshBankedResets.bind(monitor);
    monitor.refreshBankedResets = (options) => {
        if (options?.expectedCredentials?.accountId === "account-b") joined.resolve();
        return refreshInventory(options);
    };
    const popup = monitor.refreshBankedResets();
    await requested.promise;
    useAccount("account-b");
    const usage = monitor.refreshUsage();
    await joined.promise;
    release.resolve();
    await Promise.all([popup, usage]);

    const consumes = io.requests.filter(({ options }) => options.method === "POST");
    assert.equal(consumes.length, 1);
    assert.equal(consumes[0].options.headers["ChatGPT-Account-ID"], "account-b");
});

test("an interrupted expiry check does not drop a fresh trigger from the replacement account", async (t) => {
    useAccount("account-a");
    const monitor = usageMonitor(t);
    monitor._autoApplyBankedReset = true;
    const requested = Promise.withResolvers();
    const release = Promise.withResolvers();
    io.afterFetch = (url, { headers }) => {
        if (url === listUrl && headers["ChatGPT-Account-ID"] === "account-a") {
            requested.resolve();
            return release.promise;
        }
    };
    const expiry = monitor._refreshBankedResetsForAutoApply();
    await requested.promise;
    useAccount("account-b");
    await monitor.refreshUsage();
    release.resolve();
    await expiry;

    const consumes = io.requests.filter(({ options }) => options.method === "POST");
    assert.equal(consumes.length, 1);
    assert.equal(consumes[0].options.headers["ChatGPT-Account-ID"], "account-b");
});

test("manual validation does not confirm an identically named credit from a replacement account", async () => {
    useAccount("account-a");
    const monitor = new CodexMonitor({ connect() {} }, () => {}, credentialsPath);
    await monitor.refreshBankedResets();
    useAccount("account-b");
    assert.equal(await monitor.prepareBankedReset("credit-a"), null);
    await monitor.redeemBankedReset("credit-a");
    assert.equal(
        io.requests.some(({ options }) => options.method === "POST"),
        false,
    );
});

for (const replacement of ["account", "user", "opaque token"]) {
    test(`manual confirmation cannot redeem after a change of ${replacement}`, async () => {
        if (replacement !== "opaque token") useAccount("account-a");
        const messages = [];
        const monitor = new CodexMonitor(
            { connect() {} },
            (text) => messages.push(text),
            credentialsPath,
        );
        assert.equal(await monitor.prepareBankedReset("credit-a"), io.response.credits[0]);
        if (replacement === "account") useAccount("account-b");
        if (replacement === "user") useAccount("account-a", "other", "other-user");
        if (replacement === "opaque token") io.auth.tokens.access_token = "replacement-token";
        await monitor.redeemBankedReset("credit-a");
        assert.equal(
            io.requests.some(({ options }) => options.method === "POST"),
            false,
        );
        assert.match(messages.at(-1), /account changed/);
    });
}

test("a token and file account conflict is rejected before any request", async () => {
    useAccount("account-a");
    io.auth.tokens.account_id = "account-b";
    await assert.rejects(list(), (error) => error.kind === "missing-auth");
    assert.equal(io.requests.length, 0);
});

test("list still validates the network response", async () => {
    io.response = { credits: [] };
    await assert.rejects(list(), (error) => error.kind === "unexpected-response");
});
