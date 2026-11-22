import Gio from "gi://Gio";
import GLib from "gi://GLib";
const directory = GLib.dir_make_tmp("codex-meter-cancellation-XXXXXX");
const stateBase = Gio.File.new_for_path(GLib.build_filenamev([directory, "state"]));
const stateLink = Gio.File.new_for_path(GLib.build_filenamev([directory, "state-link"]));
stateBase.make_directory(null);
stateLink.make_symbolic_link(stateBase.get_path(), null);
const getStateDir = GLib.get_user_state_dir;
GLib.get_user_state_dir = () => stateLink.get_path();
const { STATE_DIR } = await import("../src/io/paths.js");
GLib.get_user_state_dir = getStateDir;

const { appendFile, readFile, readJsonFile, writeFile, writeJsonFile } =
    await import("../src/io/files.js");
const { getCodexCredentials } = await import("../src/codex/auth/auth.js");
const { readSnapshot, writeSnapshot } = await import("../src/codex/usage/snapshot.js");
const { appendHistoryRow, readHistory, rewriteHistory } =
    await import("../src/codex/usage/history.js");
const { listCodexBankedResets, redeemCodexBankedReset } =
    await import("../src/codex/banked-resets/api.js");
const { refreshCodexUsage } = await import("../src/codex/usage/api.js");
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
            () => getCodexCredentials(null, localPath),
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

function setFileMode(file, mode) {
    file.set_attribute_uint32("unix::mode", mode, Gio.FileQueryInfoFlags.NONE, null);
}

function assertMode(file, mode) {
    const info = file.query_info("unix::mode", Gio.FileQueryInfoFlags.NONE, null);
    if ((info.get_attribute_uint32("unix::mode") & 0o777) !== mode) {
        throw new Error(`Incorrect permissions for ${file.get_path()}`);
    }
}

async function testLinkedStorage() {
    const outside = Gio.File.new_for_path(GLib.build_filenamev([directory, "outside"]));
    outside.make_directory(null);
    setFileMode(outside, 0o755);
    const original = outside.get_child("original");
    GLib.file_set_contents(original.get_path(), "unchanged");
    setFileMode(original, 0o644);
    const root = Gio.File.new_for_path(STATE_DIR);
    const nested = root.get_child("nested");
    const leaf = root.get_child("leaf");
    const hard = root.get_child("hard");

    async function assertUnsafe(file) {
        for (const operation of [writeFile, appendFile]) {
            try {
                await operation(file.get_path(), "must not write");
            } catch (error) {
                if (!error.message.includes("Not a safe storage")) throw error;
                continue;
            }
            throw new Error(`Used linked storage: ${file.get_path()}`);
        }
    }

    try {
        root.make_symbolic_link(outside.get_path(), null);
        await assertUnsafe(root.get_child("new").get_child("file.json"));
        root.delete(null);
        root.make_directory(null);
        nested.make_symbolic_link(outside.get_path(), null);
        leaf.make_symbolic_link(original.get_path(), null);
        const link = Gio.Subprocess.new(
            ["ln", original.get_path(), hard.get_path()],
            Gio.SubprocessFlags.NONE,
        );
        link.wait_check(null);
        await assertUnsafe(nested.get_child("original"));
        await assertUnsafe(leaf);
        await assertUnsafe(hard);
        assertMode(outside, 0o755);
        assertMode(original, 0o644);
        if (
            (await readFile(original.get_path())) !== "unchanged" ||
            outside.get_child("new").query_exists(null)
        ) {
            throw new Error("Linked storage changed an external path");
        }
        console.log("Passed linked directory and file permission checks.");
    } finally {
        if (
            root.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) ===
            Gio.FileType.DIRECTORY
        ) {
            for (const file of [hard, leaf, nested]) {
                if (file.query_exists(null)) file.delete(null);
            }
        }
        if (root.query_exists(null)) root.delete(null);
        original.delete(null);
        outside.delete(null);
    }
}

async function testAsyncFilesystemMetadata() {
    const mkdir = GLib.mkdir_with_parents;
    const chmod = GLib.chmod;
    const fileTest = GLib.file_test;
    const localDirectory = GLib.build_filenamev([STATE_DIR, "private"]);
    const nestedDirectory = GLib.build_filenamev([localDirectory, "nested"]);
    const localPath = GLib.build_filenamev([nestedDirectory, "file.json"]);
    const appendPath = GLib.build_filenamev([nestedDirectory, "append.json"]);
    const forbidden = () => {
        throw new Error("Synchronous filesystem metadata operation");
    };
    try {
        setFileMode(stateBase, 0o755);
        GLib.mkdir_with_parents = GLib.chmod = GLib.file_test = forbidden;
        await Promise.all([writeFile(localPath, "first"), appendFile(appendPath, "line")]);
        for (const target of [nestedDirectory, localPath, appendPath]) {
            setFileMode(Gio.File.new_for_path(target), 0o777);
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
            assertMode(Gio.File.new_for_path(target), expected);
        }
        assertMode(Gio.File.new_for_path(STATE_DIR), 0o700);
        assertMode(stateBase, 0o755);
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
    const parent = Gio.File.new_for_path(GLib.build_filenamev([STATE_DIR, "metadata"]));
    const file = parent.get_child("file.json");
    const localPath = file.get_path();
    const original = new GLib.Error(
        Gio.io_error_quark(),
        Gio.IOErrorEnum.CANCELLED,
        "cancelled metadata",
    );
    for (const method of ["make_directory_async", "query_info_async", "set_attributes_async"]) {
        if (method === "set_attributes_async") {
            parent.make_directory(null);
            setFileMode(parent, 0o755);
        }
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
        GLib.file_set_contents(localPath, "existing\n");
        setFileMode(file, 0o644);
        const active = new Gio.Cancellable();
        Gio.File.prototype.set_attributes_async = async function (...args) {
            if (args.at(-1) !== active) throw new Error("chmod lost cancellation");
            if (this.get_path() === localPath) throw original;
            return setAttributes.apply(this, args);
        };
        await assertOriginalCancellation(() => appendFile(localPath, "text", active), original);
    } finally {
        Gio.File.prototype.set_attributes_async = setAttributes;
        if (file.query_exists(null)) file.delete(null);
        parent.delete(null);
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
                throw new GLib.Error(Gio.io_error_quark(), code, "private-credential-content");
            };
            let caught = false;
            try {
                await getCodexCredentials();
            } catch (error) {
                if (
                    !error.message.startsWith(message) ||
                    !error.message.includes(
                        "Select a valid Codex credentials file in Preferences",
                    ) ||
                    !error.message.includes("or sign in again.") ||
                    error.message.includes("private-credential-content") ||
                    error.technicalMessage.includes("private-credential-content")
                ) {
                    throw error;
                }
                caught = true;
            }
            if (!caught) throw new Error("Auth read failure was swallowed");
        }
        for (const [text, message] of [
            ["[]", "Codex auth file must contain a JSON object."],
            ["{", "Codex auth file contains invalid JSON."],
            ["{}", "Codex access token is missing or invalid."],
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
    await testLinkedStorage();
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
    const stateRoot = Gio.File.new_for_path(STATE_DIR);
    if (stateRoot.query_exists(null)) stateRoot.delete(null);
    stateLink.delete(null);
    stateBase.delete(null);
    Gio.File.new_for_path(directory).delete(null);
}
