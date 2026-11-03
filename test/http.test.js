import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import { CodexError } from "../src/codex/error.js";

const httpUrl = new URL("../src/io/http.js", import.meta.url).href;
const filesUrl = new URL("../src/io/files.js", import.meta.url).href;
const stubUrl = `data:text/javascript,${encodeURIComponent(`
    export const Gio = {
        _promisify() {},
        IOErrorEnum: { CANCELLED: 19 },
        File: class {},
        OutputStream: class {},
    };
    export const GLib = {
        PRIORITY_DEFAULT: 0,
        Error: class extends Error {
            constructor(message, domain = Gio.IOErrorEnum, code = Gio.IOErrorEnum.CANCELLED) {
                super(message);
                this.domain = domain;
                this.code = code;
            }
            matches(domain, code) { return this.domain === domain && this.code === code; }
        },
        Bytes: class {},
    };
    export const Soup = { Session: class {}, Message: {} };
`)}`;
const giStubs = new Map(
    [
        ["gi://Gio", "Gio"],
        ["gi://GLib", "GLib"],
        ["gi://Soup", "Soup"],
    ].map(([specifier, name]) => [
        specifier,
        `data:text/javascript,${encodeURIComponent(`export { ${name} as default } from ${JSON.stringify(stubUrl)};`)}`,
    ]),
);
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (context.parentURL === httpUrl || context.parentURL === filesUrl) {
            const url = giStubs.get(specifier);
            if (url) return { url, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});
let fetchJson;
let GLib;
let Soup;
try {
    ({ fetchJson } = await import(httpUrl));
    ({ GLib, Soup } = await import(stubUrl));
} finally {
    hooks.deregister();
}
const url = "https://example.com/usage";
const config = {
    messages: {
        networkUnavailable: "Network unavailable",
        responseTooLarge: "Response too large",
        unauthorized: "Unauthorized",
        refreshFailed: "Refresh failed",
        emptyResponse: "Empty response",
        malformedResponse: "Malformed response",
        unexpectedResponseFormat: "Unexpected response format",
    },
};

function createHttp({ status = 200, text = '{"ok":true}', size, send, setup } = {}) {
    const sessions = [];
    const message = {
        statusCode: status,
        request_headers: { append() {} },
        set_request_body_from_bytes() {},
    };
    class Session {
        constructor() {
            this.abortCount = 0;
            sessions.push(this);
        }

        async send_and_read_async(...args) {
            this.sendArgs = args;
            return send
                ? send(...args)
                : {
                      get_size: () => size ?? text?.length ?? 0,
                      get_data: () => (text === null ? null : new TextEncoder().encode(text)),
                  };
        }

        abort() {
            this.abortCount++;
        }
    }
    Soup.Session = Session;
    Soup.Message = { new: () => message };
    setup?.({ Soup, GLib, message });
    return { fetchJson, sessions, message, GLibError: GLib.Error };
}

test("fetchJson aborts its session after returning parsed JSON", async () => {
    const { fetchJson, sessions, message } = createHttp();
    const response = await fetchJson(url, config);

    assert.equal(response.ok, true);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].timeout, 15);
    assert.deepEqual(sessions[0].sendArgs, [message, 0, null]);
    assert.equal(sessions[0].abortCount, 1);
});

test("fetchJson aborts after a network failure and preserves its error mapping", async () => {
    const { fetchJson, sessions } = createHttp({
        send: () => Promise.reject(new Error("Connection refused")),
    });

    await assert.rejects(fetchJson(url, config), (error) => {
        assert.ok(error instanceof CodexError);
        assert.equal(error.kind, "network");
        assert.equal(error.message, config.messages.networkUnavailable);
        return true;
    });
    assert.equal(sessions[0].abortCount, 1);
});

test("fetchJson forwards cancellation and aborts only once the pending request settles", async () => {
    let rejectRequest;
    const pending = new Promise((resolve, reject) => {
        rejectRequest = reject;
    });
    const { fetchJson, sessions, GLibError } = createHttp({ send: () => pending });
    const cancellable = {};
    const request = fetchJson(url, config, { cancellable });
    const cancellation = new GLibError("Cancelled");

    assert.equal(sessions[0].sendArgs[2], cancellable);
    assert.equal(sessions[0].abortCount, 0);
    rejectRequest(cancellation);
    await assert.rejects(request, (error) => error === cancellation);
    assert.equal(sessions[0].abortCount, 1);
});

for (const { name, response, kind, message } of [
    {
        name: "unauthorized response",
        response: { status: 401, text: "Unauthorized" },
        kind: "unauthorized",
        message: config.messages.unauthorized,
    },
    {
        name: "HTTP failure",
        response: { status: 503, text: "Unavailable" },
        kind: "network",
        message: config.messages.refreshFailed,
    },
    {
        name: "oversized response",
        response: { size: 1024 * 1024 + 1 },
        kind: "malformed-response",
        message: config.messages.responseTooLarge,
    },
    {
        name: "empty response",
        response: { text: null },
        kind: "malformed-response",
        message: config.messages.emptyResponse,
    },
    {
        name: "invalid JSON",
        response: { text: "{" },
        kind: "malformed-response",
        message: config.messages.malformedResponse,
    },
    {
        name: "unexpected JSON shape",
        response: { text: "[]" },
        kind: "malformed-response",
        message: config.messages.unexpectedResponseFormat,
    },
]) {
    test(`fetchJson aborts after ${name} without changing the response error`, async () => {
        const { fetchJson, sessions } = createHttp(response);

        await assert.rejects(fetchJson(url, config), (error) => {
            assert.ok(error instanceof CodexError);
            assert.equal(error.kind, kind);
            assert.equal(error.message, message);
            return true;
        });
        assert.equal(sessions[0].abortCount, 1);
    });
}

for (const stage of ["message construction", "timeout setup", "headers", "request body"]) {
    test(`fetchJson aborts after ${stage} fails and preserves the original error`, async () => {
        const failure = new Error(`${stage} failed`);
        const fail = () => {
            throw failure;
        };
        const { fetchJson, sessions } = createHttp({
            setup: ({ Soup, message }) => {
                if (stage === "message construction") {
                    Soup.Message.new = fail;
                } else if (stage === "timeout setup") {
                    Object.defineProperty(Soup.Session.prototype, "timeout", { set: fail });
                } else if (stage === "headers") {
                    message.request_headers.append = fail;
                } else {
                    message.set_request_body_from_bytes = fail;
                }
            },
        });

        await assert.rejects(fetchJson(url, config, { body: "{}" }), (error) => error === failure);
        assert.equal(sessions[0].abortCount, 1);
        assert.equal(sessions[0].sendArgs, undefined);
    });
}
