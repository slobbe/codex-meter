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
        Cancellable: class {
            handlers = new Set();
            error = null;

            connect(handler) {
                if (this.error) {
                    handler();
                    return 0;
                }
                this.handlers.add(handler);
                return handler;
            }

            disconnect(handler) { this.handlers.delete(handler); }

            cancel() {
                if (this.error) return;
                this.error = new GLib.Error('Cancelled');
                for (const handler of this.handlers) handler();
            }

            set_error_if_cancelled() {
                if (this.error) throw this.error;
            }
        },
    };
    export const GLib = {
        PRIORITY_DEFAULT: 0,
        SOURCE_REMOVE: false,
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
let Gio;
let GLib;
let Soup;
try {
    ({ fetchJson } = await import(httpUrl));
    ({ Gio, GLib, Soup } = await import(stubUrl));
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
    const deadlines = new Map();
    let sourceId = 0;
    GLib.timeout_add = (priority, interval, callback) => {
        assert.equal(priority, GLib.PRIORITY_DEFAULT);
        assert.equal(interval, 15_000);
        deadlines.set(++sourceId, callback);
        return sourceId;
    };
    GLib.source_remove = (id) => assert.ok(deadlines.delete(id));
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
    return { fetchJson, sessions, message, stream, deadlines };
}

test("fetchJson disables redirects and closes the request after parsing JSON", async () => {
    const { fetchJson, sessions, message, stream, deadlines } = createHttp();
    const cancellable = new Gio.Cancellable();
    const response = await fetchJson(url, config, {
        headers: { Authorization: "Bearer fake" },
        cancellable,
    });

    assert.equal(message.flags, Soup.MessageFlags.NO_REDIRECT);
    assert.deepEqual(stream.closeArgs, [[0, null]]);

    assert.equal(response.ok, true);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].timeout, 15);
    assert.equal(sessions[0].abortCount, 1);
    assert.equal(deadlines.size, 0);
    assert.equal(cancellable.handlers.size, 0);
});

test("fetchJson aborts after a network failure and preserves its error mapping", async () => {
    const { fetchJson, sessions, deadlines } = createHttp({
        send: () => Promise.reject(new Error("Connection refused")),
    });

    await assert.rejects(fetchJson(url, config), (error) => {
        assert.ok(error instanceof CodexError);
        assert.equal(error.kind, "network");
        assert.equal(error.message, config.messages.networkUnavailable);
        return true;
    });
    assert.equal(sessions[0].abortCount, 1);
    assert.equal(deadlines.size, 0);
});

test("fetchJson removes the deadline as soon as the caller cancels", async () => {
    let rejectRequest;
    const pending = new Promise((_resolve, reject) => {
        rejectRequest = reject;
    });
    const { fetchJson, sessions, deadlines } = createHttp({ send: () => pending });
    const cancellable = new Gio.Cancellable();
    const request = fetchJson(url, config, { cancellable });
    const transfer = sessions[0].sendArgs[2];

    assert.notEqual(transfer, cancellable);
    assert.equal(deadlines.size, 1);
    cancellable.cancel();
    assert.equal(deadlines.size, 0);
    assert.ok(transfer.error);
    assert.equal(sessions[0].abortCount, 0);

    rejectRequest(transfer.error);
    await assert.rejects(request, (error) => error === transfer.error);
    assert.equal(sessions[0].abortCount, 1);
    assert.equal(cancellable.handlers.size, 0);
});

test("fetchJson does not start an already cancelled transfer", async () => {
    const { fetchJson, sessions, deadlines } = createHttp();
    const cancellable = new Gio.Cancellable();
    cancellable.cancel();

    await assert.rejects(fetchJson(url, config, { cancellable }), (error) => {
        return error === cancellable.error;
    });
    assert.equal(sessions[0].sendArgs, undefined);
    assert.equal(sessions[0].abortCount, 1);
    assert.equal(deadlines.size, 0);
});

test("fetchJson applies the original deadline even after the response makes progress", async () => {
    let markReading;
    const reading = new Promise((resolve) => {
        markReading = resolve;
    });
    let readCount = 0;
    const { fetchJson, sessions, stream, deadlines } = createHttp({
        read: (_count, _priority, transfer) => {
            if (++readCount === 1) {
                return { get_size: () => 1, get_data: () => new Uint8Array([123]) };
            }
            return new Promise((_resolve, reject) => {
                transfer.connect(() => reject(transfer.error));
                markReading();
            });
        },
        close: () => {
            throw new Error("Secondary close failure");
        },
    });
    const cancellable = new Gio.Cancellable();
    const request = fetchJson(url, config, { cancellable });
    const [deadline] = deadlines.entries();
    await reading;
    assert.deepEqual([...deadlines.entries()], [deadline]);

    const [id, expire] = deadline;
    assert.equal(expire(), GLib.SOURCE_REMOVE);
    deadlines.delete(id);
    await assert.rejects(request, {
        kind: "network",
        message: config.messages.networkUnavailable,
    });
    assert.equal(cancellable.error, null);
    assert.equal(cancellable.handlers.size, 0);
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
