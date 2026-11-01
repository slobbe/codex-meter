import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { beforeEach } from "node:test";

const apiUrl = new URL("../src/codex/banked-resets/api.js", import.meta.url).href;
const stubUrl = `data:text/javascript,${encodeURIComponent(`
    import { randomUUID } from "node:crypto";
    export const io = {};
    export default { uuid_string_random: randomUUID };
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
        return nextResolve(specifier, context);
    },
});
const { listCodexBankedResets, redeemCodexBankedReset } = await import(apiUrl);
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
    io.response = { redeemed: true };
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

test("list still validates the network response", async () => {
    io.response = { credits: [] };
    await assert.rejects(listCodexBankedResets(), (error) => error.kind === "unexpected-response");
});
