import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { beforeEach } from "node:test";

const apiUrl = new URL("../src/codex/banked-resets/api.js", import.meta.url).href;
const monitorUrl = new URL("../src/background/monitor.js", import.meta.url).href;
const stubUrl = `data:text/javascript,${encodeURIComponent(`
    import { randomUUID } from "node:crypto";
    export const io = {};
    class Cancellable {
        cancel() { this.cancelled = true; }
        is_cancelled() { return !!this.cancelled; }
        set_error_if_cancelled() { if (this.cancelled) throw new Error("Cancelled"); }
    }
    export default { uuid_string_random: randomUUID, Cancellable };
    export class UsageService {}
    export class PeriodicTask {}
    export const readSettings = () => ({ autoApplyBankedReset: true });
    export const SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW = "usage-window";
    export const SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE = "auto-usage";
    export const SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_THRESHOLD = "usage-threshold";
    export const getBackgroundRefreshIntervalSeconds = () => 0;
    export const SETTINGS_AUTO_APPLY_BANKED_RESET = "auto-apply";
    export const SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES = "refresh";
    export const isCancellationError = () => false;
    export const formatRefreshFailure = () => "Usage refresh failed";
    export async function getCodexCredentials(cancellable) {
        io.authCalls.push(cancellable);
        await io.afterAuth?.();
        return io.credentials;
    }
    export async function fetchJson(url, config, options) {
        io.requests.push({ url, config, options });
        await io.afterFetch?.();
        return io.response;
    }
`)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (context.parentURL === apiUrl) {
            if (specifier === "./response.js") return nextResolve(specifier, context);
            if (["gi://GLib", "../../io/http.js", "../auth/auth.js"].includes(specifier)) {
                return { url: stubUrl, shortCircuit: true };
            }
            throw new Error(`Unexpected banked reset API dependency: ${specifier}`);
        }
        if (
            context.parentURL === monitorUrl &&
            ![
                "../codex/banked-resets/api.js",
                "../codex/banked-resets/response.js",
                "../codex/error.js",
            ].includes(specifier)
        ) {
            return { url: stubUrl, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});
const { listCodexBankedResets, redeemCodexBankedReset } = await import(apiUrl);
const { CodexMonitor } = await import(monitorUrl);
const { io } = await import(stubUrl);
hooks.deregister();

const listUrl = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const operations = [
    ["list", (options) => listCodexBankedResets(options)],
    ["redeem", (options) => redeemCodexBankedReset("credit-a", options)],
];

beforeEach(() => {
    Object.assign(io, {
        credentials: { accessToken: "test-token", accountId: "test-account" },
        response: { available_count: 1, credits: [{ id: "credit-a", status: "available" }] },
        authCalls: [],
        requests: [],
        afterAuth: null,
        afterFetch: null,
    });
});

for (const [name, operation] of operations) {
    test(`${name} sends authentication headers and optional account ID`, async () => {
        for (const accountId of ["test-account", null]) {
            io.credentials.accountId = accountId;
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
        assert.equal(await redeemCodexBankedReset("credit-a"), io.response);
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
            redeemCodexBankedReset("credit-a"),
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
        await assert.rejects(redeemCodexBankedReset("credit-a"), (error) => {
            assert.equal(error.kind, "redemption-failed");
            assert.equal(error.message, message);
            assert.equal(error.technicalMessage, `Codex banked reset redemption returned ${code}`);
            return true;
        });
    });
}

test("redeem accepts an explicit reset outcome from backends omitting the window count", async () => {
    io.response = { code: "reset" };
    assert.equal(await redeemCodexBankedReset("credit-a"), io.response);
});

for (const automatic of [false, true]) {
    for (const code of ["reset", ...redemptionFailures.map(([code]) => code), "unknown"]) {
        test(`${automatic ? "automatic" : "manual"} redemption only notifies success for a confirmed reset (${code})`, async (t) => {
            const notifications = [];
            const warnings = [];
            t.mock.method(console, "warn", (...args) => warnings.push(args));
            const monitor = new CodexMonitor({ connect() {} }, (message) =>
                notifications.push(message),
            );
            const usage = { bankedResetCount: 1 };
            const inventory = {
                available_count: 1,
                credits: [{ id: "credit-a", status: "available" }],
            };
            monitor._snapshot = usage;
            monitor._bankedResetSnapshot = inventory;
            let refreshes = 0;
            monitor.refreshUsage = async () => refreshes++;
            monitor.refreshBankedResets = async () => refreshes++;
            io.response = { code, windows_reset: code === "reset" ? 2 : 0 };

            if (automatic) {
                await monitor._autoRedeemBankedReset(
                    [
                        {
                            ...inventory.credits[0],
                            expires_at: new Date(Date.now() + 60_000).toISOString(),
                        },
                    ],
                    { is_cancelled: () => false, set_error_if_cancelled() {} },
                );
            } else {
                await monitor.redeemBankedReset("credit-a");
            }

            if (code === "reset") {
                assert.deepEqual(notifications, [
                    automatic
                        ? "Expiring banked Codex reset redeemed automatically."
                        : "Banked Codex reset redeemed.",
                ]);
                assert.equal(refreshes, 2);
                assert.equal(warnings.length, 0);
            } else {
                assert.equal(refreshes, 0, "a no-op is not treated as a redeemed reset");
                assert.equal(monitor.state.snapshot, usage);
                assert.equal(monitor.state.bankedResetSnapshot, inventory);
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

test("list still validates the network response", async () => {
    io.response = { credits: [] };
    await assert.rejects(listCodexBankedResets(), (error) => error.kind === "unexpected-response");
});
