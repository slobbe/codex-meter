import Gio from "gi://Gio";
import Soup from "gi://Soup";
import { fetchJson } from "../src/io/http.js";

const modules = [
    "../src/codex/banked-resets/api.js",
    "../src/codex/banked-resets/response.js",
    "../src/codex/auth/auth.js",
    "../src/codex/auth/auth-parser.js",
    "../src/codex/usage/api.js",
    "../src/codex/usage/response.js",
    "../src/io/files.js",
    "../src/io/http.js",
    "../src/io/paths.js",
    "../src/background/monitor.js",
    "../src/background/refresh-error-message.js",
    "../src/panel/view-model.js",
    "../src/preferences/settings.js",
    "../src/codex/error.js",
    "../src/background/periodic-task.js",
    "../src/codex/usage/history.js",
    "../src/codex/usage/model.js",
    "../src/codex/usage/prediction.js",
    "../src/codex/usage/service.js",
    "../src/codex/usage/snapshot.js",
];

for (const module of modules) {
    await import(module);
}

console.log(`Imported ${modules.length} modules with GJS.`);

function gzip(text) {
    const memory = Gio.MemoryOutputStream.new_resizable();
    const compressor = Gio.ZlibCompressor.new(Gio.ZlibCompressorFormat.GZIP, -1);
    const output = Gio.ConverterOutputStream.new(memory, compressor);
    output.write_all(new TextEncoder().encode(text), null);
    output.close(null);
    return memory.steal_as_bytes().get_data();
}

const server = new Soup.Server();
const config = {
    messages: { responseTooLarge: "Response too large", refreshFailed: "Refresh failed" },
};
const limits = gzip(`{"data":"${"x".repeat(1024 * 1024)}"}`);
const cancellable = new Gio.Cancellable();
let redirected = false;
server.add_handler(null, (_server, message, path) => {
    if (path === "/redirect") {
        message.set_redirect(307, "/target");
    } else {
        if (path === "/cancel") cancellable.cancel();
        const body = path === "/oversized" ? limits : gzip('{"ok":true}');
        if (path === "/target") redirected = true;
        message.get_response_headers().append("Content-Encoding", "gzip");
        message.set_status(200, null);
        message.set_response("application/json", Soup.MemoryUse.COPY, body);
    }
});

async function assertRequestFailure(request, expectedMessage) {
    try {
        await request;
    } catch (error) {
        if (error.message !== expectedMessage) throw error;
        return;
    }
    throw new Error(`Expected request failure: ${expectedMessage}`);
}

try {
    server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
    const url = server.get_uris()[0].to_string();
    await assertRequestFailure(
        fetchJson(`${url}redirect`, config, { headers: { Authorization: "Bearer fake" } }),
        config.messages.refreshFailed,
    );
    if (redirected) throw new Error("Authenticated request followed a redirect");
    if (!(await fetchJson(`${url}small`, config)).ok) throw new Error("Gzip decoding failed");
    await assertRequestFailure(
        fetchJson(`${url}oversized`, config),
        config.messages.responseTooLarge,
    );
    await fetchJson(`${url}cancel`, config, { cancellable }).then(
        () => {
            throw new Error("Expected caller cancellation");
        },
        (error) => {
            if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) throw error;
        },
    );
    console.log("Passed local Soup redirect, decoded response limit, and cancellation checks.");
} finally {
    server.disconnect();
}
