import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { appendFile, readFile, readJsonFile, writeFile, writeJsonFile } from "../src/io/files.js";
import { getCodexCredentials } from "../src/codex/auth/auth.js";
import { readSnapshot, writeSnapshot } from "../src/codex/usage/snapshot.js";
import { appendHistoryRow, readHistory, rewriteHistory } from "../src/codex/usage/history.js";
import { listCodexBankedResets, redeemCodexBankedReset } from "../src/codex/banked-resets/api.js";
import { refreshCodexUsage } from "../src/codex/usage/api.js";

const directory = GLib.dir_make_tmp("codex-meter-cancellation-XXXXXX");
const path = GLib.build_filenamev([directory, "missing", "file.json"]);
const cancellable = new Gio.Cancellable();
cancellable.cancel();

const operations = [
    () => readFile(path, cancellable),
    () => readJsonFile(path, cancellable),
    () => writeFile(path, "text", cancellable),
    () => writeJsonFile(path, {}, cancellable),
    () => appendFile(path, "text", cancellable),
    () => getCodexCredentials(cancellable),
    () => readSnapshot(cancellable),
    () => writeSnapshot({}, cancellable),
    () => readHistory(path, cancellable),
    () => appendHistoryRow({}, path, cancellable),
    () => rewriteHistory([], path, cancellable),
    () => listCodexBankedResets({ cancellable }),
    () => redeemCodexBankedReset("credit", { cancellable }),
    () => refreshCodexUsage({ cancellable }),
];

async function assertOriginalCancellation(operation, original) {
    try {
        await operation();
    } catch (error) {
        if (error !== original) throw new Error(`Original cancellation was replaced: ${error}`);
        return;
    }
    throw new Error("Cancellation was swallowed");
}

async function testInFlightCancellationPreservation() {
    const original = new GLib.Error(
        Gio.io_error_quark(),
        Gio.IOErrorEnum.CANCELLED,
        "cancelled I/O",
    );
    const load = Gio.File.prototype.load_contents_async;
    const replace = Gio.File.prototype.replace_contents_async;
    const append = Gio.File.prototype.append_to_async;
    const fileTest = GLib.file_test;
    let closed = 0;
    const localPath = GLib.build_filenamev([directory, "file.json"]);
    try {
        Gio.File.prototype.load_contents_async = async () => {
            throw original;
        };
        Gio.File.prototype.replace_contents_async = async () => {
            throw original;
        };
        Gio.File.prototype.append_to_async = async () => ({
            async write_bytes_async() {
                throw original;
            },
            async close_async(_priority, cleanupCancellable) {
                if (cleanupCancellable !== null) throw new Error("Cleanup must not be cancelled");
                closed++;
                throw new Error("Secondary close failure");
            },
        });
        GLib.file_test = () => true;
        for (const operation of [
            () => readFile(localPath),
            () => writeFile(localPath, "text"),
            () => appendFile(localPath, "text"),
            () => getCodexCredentials(),
            () => readSnapshot(),
            () => readHistory(localPath),
        ]) {
            await assertOriginalCancellation(operation, original);
        }
        if (closed !== 1) throw new Error("Cancelled append must close its stream");
        console.log("Passed in-flight cancellation identity and append cleanup checks.");
    } finally {
        Gio.File.prototype.load_contents_async = load;
        Gio.File.prototype.replace_contents_async = replace;
        Gio.File.prototype.append_to_async = append;
        GLib.file_test = fileTest;
    }
}

try {
    for (const operation of operations) {
        let caught = false;
        try {
            await operation();
        } catch (error) {
            if (
                !(error instanceof GLib.Error) ||
                !error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)
            ) {
                throw new Error(`Cancellation was wrapped or replaced: ${error}`);
            }
            caught = true;
        }
        if (!caught) throw new Error("Cancellation was swallowed");
    }
    if (GLib.file_test(GLib.path_get_dirname(path), GLib.FileTest.EXISTS)) {
        throw new Error("Cancelled writes must not create parent directories");
    }
    console.log(`Passed ${operations.length} real GJS cancellation propagation checks.`);
    await testInFlightCancellationPreservation();
} finally {
    Gio.File.new_for_path(directory).delete(null);
}
