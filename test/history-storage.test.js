import GLib from "gi://GLib";
import Gio from "gi://Gio";

const directory = GLib.dir_make_tmp("codex-meter-history-XXXXXX");
GLib.setenv("XDG_STATE_HOME", directory, true);
const { appendHistoryRow, MAX_HISTORY_ENTRIES, readHistory } =
    await import("../src/codex/usage/history.js");
const { UsageService } = await import("../src/codex/usage/service.js");
const historyPath = GLib.build_filenamev([
    directory,
    "codex-meter",
    "codex",
    "usage-history.jsonl",
]);

Gio._promisify(Gio.File.prototype, "load_contents_async");

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
    }
}

function assertDeepEqual(actual, expected, message) {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);

    if (actualJson !== expectedJson) {
        throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
    }
}

function createTempPath(name) {
    return GLib.build_filenamev([directory, `codex-meter-${GLib.uuid_string_random()}-${name}`]);
}

async function readText(path) {
    const file = Gio.File.new_for_path(path);
    const [contents] = await file.load_contents_async(null);

    return new TextDecoder("utf-8", { fatal: true }).decode(contents);
}

function writeText(path, text) {
    GLib.file_set_contents(path, text);
}

function removeFile(path) {
    try {
        Gio.File.new_for_path(path).delete(null);
    } catch (_error) {}
}

async function testDirectAppendWritesWithoutDeduping() {
    const path = createTempPath("direct-append.jsonl");
    const firstTimestamp = new Date(Date.now() - 60_000).toISOString();
    const secondTimestamp = new Date().toISOString();

    try {
        await appendHistoryRow(
            {
                timestamp: firstTimestamp,
                quotas: [{ id: "session", usedPercent: 14 }],
            },
            path,
        );
        await appendHistoryRow(
            {
                timestamp: secondTimestamp,
                quotas: [{ id: "session", usedPercent: 14 }],
            },
            path,
        );

        const lines = (await readText(path)).trim().split(/\r?\n/);

        assertEqual(lines.length, 2, "direct append should not read existing rows or dedupe");
    } finally {
        removeFile(path);
    }
}

async function testJsonlIsReadable() {
    const path = createTempPath("read.jsonl");
    const timestamp = new Date().toISOString();

    try {
        writeText(
            path,
            `${JSON.stringify({
                timestamp,
                quotas: [
                    { id: "session", usedPercent: 11, used: 110 },
                    { id: "weekly", usedPercent: 56 },
                ],
            })}\n`,
        );

        const history = await readHistory(path);

        assertEqual(history.length, 1, "JSONL history row should be read");
        assertDeepEqual(
            history[0].quotas,
            [
                { id: "session", usedPercent: 11, used: 110 },
                { id: "weekly", usedPercent: 56 },
            ],
            "JSONL usage quotas should be read",
        );
    } finally {
        removeFile(path);
    }
}

async function testMissingJsonlReturnsEmptyHistory() {
    const path = createTempPath("missing.jsonl");

    const load = Gio.File.prototype.load_contents_async;
    let reads = 0;
    Gio.File.prototype.load_contents_async = function (...args) {
        reads++;
        return load.apply(this, args);
    };
    try {
        const history = await readHistory(path);
        assertDeepEqual(history, [], "missing JSONL history should be empty");
        assertEqual(
            reads,
            1,
            "missing JSONL history should be read without an existence preflight",
        );
    } finally {
        Gio.File.prototype.load_contents_async = load;
    }
}

function historyRow(ageDays = 0, usedPercent = 14) {
    return {
        timestamp: new Date(Date.now() - ageDays * 86_400_000).toISOString(),
        quotas: [{ id: "session", usedPercent }],
    };
}

function jsonl(rows) {
    return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

async function testReadCompactsPersistedHistory() {
    const path = createTempPath("retention.jsonl");
    const recent = historyRow();
    try {
        writeText(path, jsonl([historyRow(22), recent]));
        assertDeepEqual(await readHistory(path), [recent], "expired rows are omitted");
        assertEqual(await readText(path), jsonl([recent]), "expired rows are removed on disk");

        const rows = Array.from({ length: MAX_HISTORY_ENTRIES + 7 }, (_, i) => historyRow(0, i));
        writeText(path, jsonl(rows));
        await readHistory(path);
        const expected = jsonl(rows.slice(-MAX_HISTORY_ENTRIES));
        assertEqual(await readText(path), expected, "startup bounds physical row count and size");

        writeText(path, jsonl([historyRow(22)]));
        assertDeepEqual(await readHistory(path), [], "fully expired history is empty");
        assertEqual(await readText(path), "\n", "fully expired history is removed on disk");
    } finally {
        removeFile(path);
    }
}

async function testServiceRetention() {
    GLib.mkdir_with_parents(GLib.path_get_dirname(historyPath), 0o700);
    const recent = historyRow();
    const snapshot = {
        fetchedAt: Date.now() / 1000,
        quotas: recent.quotas,
    };
    const replace = Gio.File.prototype.replace_contents_async;
    const append = Gio.File.prototype.append_to_async;
    let rewrites = 0;
    let appends = 0;
    Gio.File.prototype.append_to_async = function (...args) {
        appends++;
        return append.apply(this, args);
    };
    Gio.File.prototype.replace_contents_async = function (...args) {
        rewrites++;
        return replace.apply(this, args);
    };
    try {
        writeText(historyPath, jsonl([historyRow(22), recent]));
        let service = new UsageService();
        await service.appendSnapshotToHistory(snapshot);
        assertEqual(await readText(historyPath), jsonl([recent]), "unchanged startup compacts");
        assertEqual(rewrites, 1, "startup compacts once");
        await service.appendSnapshotToHistory(snapshot);
        assertEqual(rewrites, 1, "unchanged retained history is not rewritten");

        writeText(historyPath, jsonl([historyRow(20), recent]));
        service = new UsageService();
        await service.readHistory();
        const now = Date.now;
        Date.now = () => now() + 2 * 86_400_000;
        try {
            const before = rewrites;
            const beforeAppend = appends;
            await service.appendSnapshotToHistory(snapshot);
            assertEqual(
                await readText(historyPath),
                jsonl([recent]),
                "cached expiry prunes on unchanged usage",
            );
            assertEqual(rewrites, before + 1, "cached expiry compacts once");
            assertEqual(appends, beforeAppend, "unchanged recent usage remains deduplicated");
            await service.readHistory();
            assertEqual(rewrites, before + 1, "reading retained cache does not rewrite");
        } finally {
            Date.now = now;
        }

        // Advance time so even the last cached row expires without changing quota values.
        Date.now = () => now() + 22 * 86_400_000;
        try {
            await service.appendSnapshotToHistory({ ...snapshot, fetchedAt: Date.now() / 1000 });
            const persisted = (await readText(historyPath)).trim().split("\n").map(JSON.parse);
            assertEqual(persisted.length, 1, "expired cached row is replaced, not accumulated");
            assertEqual(persisted[0].timestamp, service.history[0].timestamp, "cache matches disk");
            assertEqual(service.history.length, 1, "expired cached rows are removed");
        } finally {
            Date.now = now;
        }

        const rows = Array.from({ length: MAX_HISTORY_ENTRIES }, (_, i) => historyRow(0, i));
        writeText(historyPath, jsonl(rows));
        const fullService = new UsageService();
        const beforeFullAppend = appends;
        await fullService.appendSnapshotToHistory(snapshot);
        assertEqual(
            appends,
            beforeFullAppend,
            "full history is replaced without an oversized append",
        );
        const expected = jsonl([
            ...rows.slice(1),
            { ...recent, timestamp: new Date(snapshot.fetchedAt * 1000).toISOString() },
        ]);
        const persisted = await readText(historyPath);
        assertEqual(
            persisted.trim().split("\n").length,
            MAX_HISTORY_ENTRIES,
            "append stays bounded",
        );
        assertEqual(persisted, expected, "append keeps newest rows and bounded file size");
        assertEqual(fullService.history.length, MAX_HISTORY_ENTRIES, "cache stays bounded");

        writeText(historyPath, jsonl([recent]));
        const smallService = new UsageService();
        const before = rewrites;
        await smallService.appendSnapshotToHistory({
            ...snapshot,
            quotas: historyRow(0, 15).quotas,
        });
        assertEqual(rewrites, before, "changed usage below limits only appends");
        assertEqual(
            (await readText(historyPath)).trim().split("\n").length,
            2,
            "new usage appended",
        );
    } finally {
        Gio.File.prototype.replace_contents_async = replace;
        Gio.File.prototype.append_to_async = append;
        removeFile(historyPath);
    }
}

async function testCancelledCompactionCanRetry() {
    const replace = Gio.File.prototype.replace_contents_async;
    const recent = historyRow();
    const original = new GLib.Error(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED, "cancelled");
    const snapshot = { fetchedAt: Date.now() / 1000, quotas: recent.quotas };
    try {
        for (const full of [false, true]) {
            const rows = full
                ? Array.from({ length: MAX_HISTORY_ENTRIES }, (_, i) => historyRow(0, i))
                : [historyRow(22), recent];
            writeText(historyPath, jsonl(rows));
            const service = new UsageService();
            const cancellable = new Gio.Cancellable();
            Gio.File.prototype.replace_contents_async = async function (...args) {
                assertEqual(args[4], cancellable, "compaction receives cancellation");
                throw original;
            };
            let caught;
            try {
                await service.appendSnapshotToHistory(snapshot, { cancellable });
            } catch (error) {
                caught = error;
            }
            assertEqual(caught, original, "compaction preserves cancellation identity");
            assertEqual(service.history, null, "cancelled compaction does not publish new cache");
            assertEqual(
                await readText(historyPath),
                jsonl(rows),
                "cancelled write leaves rows intact",
            );
            Gio.File.prototype.replace_contents_async = replace;
            await service.appendSnapshotToHistory(snapshot);
            const persisted = (await readText(historyPath)).trim().split("\n").map(JSON.parse);
            assertDeepEqual(persisted, service.history, "retry restores cache/disk agreement");
            assertEqual(
                persisted.length,
                full ? MAX_HISTORY_ENTRIES : 1,
                "retry enforces retention",
            );
        }
    } finally {
        Gio.File.prototype.replace_contents_async = replace;
        removeFile(historyPath);
    }
}

try {
    await testDirectAppendWritesWithoutDeduping();
    await testJsonlIsReadable();
    await testMissingJsonlReturnsEmptyHistory();
    await testReadCompactsPersistedHistory();
    await testServiceRetention();
    await testCancelledCompactionCanRetry();
} finally {
    removeFile(GLib.path_get_dirname(historyPath));
    removeFile(GLib.build_filenamev([directory, "codex-meter"]));
    removeFile(directory);
}
