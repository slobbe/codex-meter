import GLib from "gi://GLib";
import Gio from "gi://Gio";
import { appendHistoryRow, MAX_HISTORY_ENTRIES, readHistory } from "../src/codex/usage/history.js";

const directory = GLib.dir_make_tmp("codex-meter-history-XXXXXX");

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

    assertDeepEqual(await readHistory(path), [], "missing JSONL history should be empty");
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
    const retained = [historyRow(29), historyRow()];
    try {
        writeText(path, jsonl([historyRow(31), ...retained]));
        assertDeepEqual(await readHistory(path), retained, "only rows over 30 days are omitted");
        assertEqual(await readText(path), jsonl(retained), "expired rows are removed on disk");

        const older = historyRow(1);
        const rows = Array.from({ length: 2 * MAX_HISTORY_ENTRIES + 7 }, (_, i) => ({
            ...older,
            quotas: [{ id: "session", usedPercent: i }],
        }));
        const newest = historyRow();
        writeText(path, jsonl([newest, ...rows]));
        await readHistory(path);
        const expected = jsonl([...rows.slice(1 - MAX_HISTORY_ENTRIES), newest]);
        assertEqual(await readText(path), expected, "startup bounds physical row count and size");

        writeText(path, jsonl([historyRow(31)]));
        assertDeepEqual(await readHistory(path), [], "fully expired history is empty");
        assertEqual(await readText(path), "\n", "fully expired history is removed on disk");
    } finally {
        removeFile(path);
    }
}

try {
    await testDirectAppendWritesWithoutDeduping();
    await testJsonlIsReadable();
    await testMissingJsonlReturnsEmptyHistory();
    await testReadCompactsPersistedHistory();
} finally {
    removeFile(directory);
}
