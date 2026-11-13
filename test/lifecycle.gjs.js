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

async function testAsyncFilesystemMetadata() {
    const mkdir = GLib.mkdir_with_parents;
    const chmod = GLib.chmod;
    const fileTest = GLib.file_test;
    const localDirectory = GLib.build_filenamev([directory, "private"]);
    const nestedDirectory = GLib.build_filenamev([localDirectory, "nested"]);
    const localPath = GLib.build_filenamev([nestedDirectory, "file.json"]);
    const appendPath = GLib.build_filenamev([nestedDirectory, "append.json"]);
    const forbidden = () => {
        throw new Error("Synchronous filesystem metadata operation");
    };
    try {
        GLib.mkdir_with_parents = GLib.chmod = GLib.file_test = forbidden;
        await Promise.all([writeFile(localPath, "first"), appendFile(appendPath, "line")]);
        for (const target of [nestedDirectory, localPath, appendPath]) {
            Gio.File.new_for_path(target).set_attribute_uint32(
                "unix::mode",
                0o777,
                Gio.FileQueryInfoFlags.NONE,
                null,
            );
        }
        await writeFile(localPath, "replacement");
        await appendFile(appendPath, "second\n");
        if ((await readFile(localPath)) !== "replacement") throw new Error("Write failed");
        if ((await readFile(appendPath)) !== "line\nsecond\n") throw new Error("Append failed");
        for (const [target, expected] of [
            [localDirectory, 0o700],
            [nestedDirectory, 0o700],
            [localPath, 0o600],
            [appendPath, 0o600],
        ]) {
            const info = Gio.File.new_for_path(target).query_info(
                "unix::mode",
                Gio.FileQueryInfoFlags.NONE,
                null,
            );
            if ((info.get_attribute_uint32("unix::mode") & 0o777) !== expected) {
                throw new Error(`Incorrect permissions for ${target}`);
            }
        }
        for (const operation of [writeFile, appendFile]) {
            let caught = false;
            try {
                await operation(GLib.build_filenamev([localPath, "child"]), "text");
            } catch (error) {
                if (!error.message.includes("Failed to")) throw error;
                caught = true;
            }
            if (!caught) throw new Error("A regular file cannot be a parent directory");
        }
        console.log("Passed async filesystem metadata, concurrent mkdir, and permission checks.");
    } finally {
        GLib.mkdir_with_parents = mkdir;
        GLib.chmod = chmod;
        GLib.file_test = fileTest;
        for (const target of [localPath, appendPath, nestedDirectory, localDirectory]) {
            const file = Gio.File.new_for_path(target);
            if (file.query_exists(null)) file.delete(null);
        }
    }
}

async function testMetadataCancellation() {
    const localPath = GLib.build_filenamev([directory, "file.json"]);
    const original = new GLib.Error(
        Gio.io_error_quark(),
        Gio.IOErrorEnum.CANCELLED,
        "cancelled metadata",
    );
    for (const method of ["make_directory_async", "query_info_async", "set_attributes_async"]) {
        const implementation = Gio.File.prototype[method];
        try {
            for (const operation of [writeFile, appendFile]) {
                const active = new Gio.Cancellable();
                let called = false;
                Gio.File.prototype[method] = async function (...args) {
                    if (args.at(-1) !== active) throw new Error(`${method} lost cancellation`);
                    called = true;
                    throw original;
                };
                await assertOriginalCancellation(
                    () => operation(localPath, "text", active),
                    original,
                );
                if (!called) throw new Error(`${method} was not exercised`);
            }
        } finally {
            Gio.File.prototype[method] = implementation;
        }
    }
    if (Gio.File.new_for_path(localPath).query_exists(null)) {
        throw new Error("Cancelled metadata must prevent file creation");
    }
    const setAttributes = Gio.File.prototype.set_attributes_async;
    try {
        for (const operation of [writeFile, appendFile]) {
            const active = new Gio.Cancellable();
            Gio.File.prototype.set_attributes_async = async function (...args) {
                if (args.at(-1) !== active) throw new Error("chmod lost cancellation");
                if (this.get_path() === localPath) throw original;
                return setAttributes.apply(this, args);
            };
            await assertOriginalCancellation(() => operation(localPath, "text", active), original);
            Gio.File.new_for_path(localPath).delete(null);
        }
    } finally {
        Gio.File.prototype.set_attributes_async = setAttributes;
        const file = Gio.File.new_for_path(localPath);
        if (file.query_exists(null)) file.delete(null);
    }
    console.log("Passed mkdir, directory query, and directory/file chmod cancellation checks.");
}

async function testAsyncAuthErrors() {
    const load = Gio.File.prototype.load_contents_async;
    const fileTest = GLib.file_test;
    try {
        GLib.file_test = () => {
            throw new Error("Auth must not synchronously check existence");
        };
        for (const [code, message] of [
            [Gio.IOErrorEnum.NOT_FOUND, "Codex auth file is missing."],
            [Gio.IOErrorEnum.PERMISSION_DENIED, "Codex auth file could not be read."],
        ]) {
            Gio.File.prototype.load_contents_async = async () => {
                throw new GLib.Error(Gio.io_error_quark(), code, "read failure");
            };
            let caught = false;
            try {
                await getCodexCredentials();
            } catch (error) {
                if (!error.message.startsWith(message) || !error.message.includes("codex login")) {
                    throw error;
                }
                caught = true;
            }
            if (!caught) throw new Error("Auth read failure was swallowed");
        }
        for (const [text, message] of [
            ["[]", "Codex auth file is malformed."],
            ["{", "Codex auth file could not be read."],
            ["{}", "Codex access token is missing."],
        ]) {
            Gio.File.prototype.load_contents_async = async () => [new TextEncoder().encode(text)];
            let caught = false;
            try {
                await getCodexCredentials();
            } catch (error) {
                if (!error.message.startsWith(message)) throw error;
                caught = true;
            }
            if (!caught) throw new Error("Invalid auth data was accepted");
        }
        Gio.File.prototype.load_contents_async = async () => [
            new TextEncoder().encode('{"tokens":{"access_token":" fake-token "}}'),
        ];
        if ((await getCodexCredentials()).accessToken !== "fake-token") {
            throw new Error("Valid auth data was rejected");
        }
        console.log("Passed asynchronous auth read errors and credential validation checks.");
    } finally {
        Gio.File.prototype.load_contents_async = load;
        GLib.file_test = fileTest;
    }
}

try {
    await testAsyncFilesystemMetadata();
    await testAsyncAuthErrors();
    await testMetadataCancellation();
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
