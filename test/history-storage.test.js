import GLib from "gi://GLib";
import Gio from "gi://Gio";

import { appendHistoryRow, readHistory } from "../src/codex/usage/history.js";

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
    return GLib.build_filenamev([
        GLib.get_tmp_dir(),
        `codex-meter-${GLib.uuid_string_random()}-${name}`,
    ]);
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

    const history = await readHistory(path);

    assertDeepEqual(history, [], "missing JSONL history should be empty");
}

await testDirectAppendWritesWithoutDeduping();
await testJsonlIsReadable();
await testMissingJsonlReturnsEmptyHistory();
