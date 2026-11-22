import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import { CodexError } from "../src/codex/error.js";

const httpUrl = new URL("../src/io/http.js", import.meta.url).href;
const filesUrl = new URL("../src/io/files.js", import.meta.url).href;
const pathsUrl = new URL("../src/io/paths.js", import.meta.url).href;
const stubUrl = `data:text/javascript,${encodeURIComponent(`
    export const Gio = {
        _promisify() {},
        IOErrorEnum: { CANCELLED: 19 },
        File: class {},
        FileQueryInfoFlags: { NOFOLLOW_SYMLINKS: 1 },
        InputStream: class {},
        OutputStream: class {},
    };
    export const GLib = {
        PRIORITY_DEFAULT: 0,
        build_filenamev: parts => parts.join('/'),
        get_user_cache_dir: () => '/cache',
        get_user_state_dir: () => '/state',
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
    export const Soup = { Session: class {}, Message: {}, MessageFlags: { NO_REDIRECT: 2 } };
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
        if ([httpUrl, filesUrl, pathsUrl].includes(context.parentURL)) {
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

const MAX_RESPONSE_BYTES = 1024 * 1024;

function createHttp({ status = 200, text = '{"ok":true}', send, read, close, setup } = {}) {
    const sessions = [];
    const body = new TextEncoder().encode(text);
    const stream = {
        readArgs: [],
        closeArgs: [],
        bytesRead: 0,
        async read_bytes_async(count, ...args) {
            this.readArgs.push([count, ...args]);
            if (read) return read(count, ...args);
            const data = body.subarray(this.bytesRead, this.bytesRead + count);
            this.bytesRead += data.length;
            return { get_size: () => data.length, get_data: () => data };
        },
        async close_async(...args) {
            this.closeArgs.push(args);
            return close?.(...args);
        },
    };
    const message = {
        statusCode: status,
        flags: 0,
        add_flags(flags) {
            this.flags |= flags;
        },
        request_headers: { append() {} },
        set_request_body_from_bytes() {},
    };
    class Session {
        constructor() {
            this.abortCount = 0;
            sessions.push(this);
        }

        async send_async(...args) {
            this.sendArgs = args;
            return send ? send(...args) : stream;
        }

        abort() {
            this.abortCount++;
        }
    }
    Soup.Session = Session;
    Soup.Message = { new: () => message };
    setup?.({ Soup, GLib, message });
    return { fetchJson, sessions, message, stream, GLibError: GLib.Error };
}

test("fetchJson disables redirects and closes the request after parsing JSON", async () => {
    const { fetchJson, sessions, message, stream } = createHttp();
    const response = await fetchJson(url, config, { headers: { Authorization: "Bearer fake" } });

    assert.equal(message.flags, Soup.MessageFlags.NO_REDIRECT);
    assert.deepEqual(stream.closeArgs, [[0, null]]);

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
    const cancellable = { set_error_if_cancelled() {} };
    const request = fetchJson(url, config, { cancellable });
    const cancellation = new GLibError("Cancelled");

    assert.equal(sessions[0].sendArgs[2], cancellable);
    assert.equal(sessions[0].abortCount, 0);
    rejectRequest(cancellation);
    await assert.rejects(request, (error) => error === cancellation);
    assert.equal(sessions[0].abortCount, 1);
});

test("fetchJson preserves read cancellation and closes the stream without cancellation", async () => {
    let markReading;
    let rejectRead;
    const reading = new Promise((resolve) => {
        markReading = resolve;
    });
    const pending = new Promise((_resolve, reject) => {
        rejectRead = reject;
    });
    const { fetchJson, sessions, stream, GLibError } = createHttp({
        read: () => {
            markReading();
            return pending;
        },
        close: () => {
            throw new Error("Secondary close failure");
        },
    });
    const cancellable = { set_error_if_cancelled() {} };
    const request = fetchJson(url, config, { cancellable });
    await reading;
    assert.equal(stream.readArgs[0][2], cancellable);
    assert.equal(sessions[0].abortCount, 0);

    const cancellation = new GLibError("Cancelled");
    rejectRead(cancellation);
    await assert.rejects(request, (error) => error === cancellation);
    assert.equal(sessions[0].abortCount, 1);
    assert.deepEqual(stream.closeArgs, [[0, null]]);
});

test("fetchJson reads at most one decoded byte beyond the limit", async () => {
    const { fetchJson, sessions, stream } = createHttp({
        text: "x".repeat(2 * MAX_RESPONSE_BYTES),
    });
    await assert.rejects(fetchJson(url, config), {
        kind: "malformed-response",
        message: config.messages.responseTooLarge,
    });
    assert.equal(stream.bytesRead, MAX_RESPONSE_BYTES + 1);
    assert.equal(stream.readArgs.at(-1)[0], 1);
    assert.equal(sessions[0].abortCount, 1);
    assert.deepEqual(stream.closeArgs, [[0, null]]);
});

test("fetchJson accepts exactly 1 MiB and decodes UTF-8 across chunks", async () => {
    // Split a multibyte character across the first chunk boundary.
    const text = `{"data":"${"x".repeat(64 * 1024 - 10)}é${"y".repeat(MAX_RESPONSE_BYTES - 64 * 1024 - 3)}"}`;
    const { fetchJson, stream } = createHttp({ text });
    assert.deepEqual(await fetchJson(url, config), JSON.parse(text));
    assert.equal(stream.bytesRead, MAX_RESPONSE_BYTES);
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
        name: "redirect response",
        response: { status: 307, text: "Redirect" },
        kind: "network",
        message: config.messages.refreshFailed,
    },
    {
        name: "empty response",
        response: { text: "" },
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
        const { fetchJson, sessions, stream } = createHttp(response);

        await assert.rejects(fetchJson(url, config), (error) => {
            assert.ok(error instanceof CodexError);
            assert.equal(error.kind, kind);
            assert.equal(error.message, message);
            return true;
        });
        assert.equal(sessions[0].abortCount, 1);
        assert.deepEqual(stream.closeArgs, [[0, null]]);
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
