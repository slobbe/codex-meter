import GLib from "gi://GLib";
import Gio from "gi://Gio";

import {
    appendHistoryToPath,
    readHistoryFromPath,
} from "../dist/infra/storage/history.js";

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
    } catch (_error) {
    }
}

async function testDuplicateHeaderMigration() {
    const path = createTempPath("duplicate-header.csv");
    const firstTimestamp = new Date(Date.now() - 120_000).toISOString();
    const secondTimestamp = new Date(Date.now() - 60_000).toISOString();
    const thirdTimestamp = new Date().toISOString();

    try {
        writeText(path, [
            "timestamp,primaryUsedPercent,secondaryUsedPercent,session_used_percent,weekly_used_percent",
            `${firstTimestamp},8,51,,`,
            `${secondTimestamp},,,9,52`,
            "",
        ].join("\n"));

        await appendHistoryToPath(path, {
            timestamp: thirdTimestamp,
            quotas: [
                { id: "session", usedPercent: 10 },
                { id: "weekly", usedPercent: 53 },
            ],
        });

        const text = await readText(path);
        const lines = text.trim().split(/\r?\n/);

        assertEqual(
            lines[0],
            "timestamp,quotas_json",
            "history header should be canonical after migration",
        );
        assertDeepEqual(lines.slice(1), [
            `${firstTimestamp},"[{""id"":""session"",""usedPercent"":8},{""id"":""weekly"",""usedPercent"":51}]"`,
            `${secondTimestamp},"[{""id"":""session"",""usedPercent"":9},{""id"":""weekly"",""usedPercent"":52}]"`,
            `${thirdTimestamp},"[{""id"":""session"",""usedPercent"":10},{""id"":""weekly"",""usedPercent"":53}]"`,
        ], "history rows should preserve old and new usage columns");
    } finally {
        removeFile(path);
    }
}

async function testAppendWritesUtf8() {
    const path = createTempPath("append.csv");
    const firstTimestamp = new Date(Date.now() - 60_000).toISOString();
    const secondTimestamp = new Date().toISOString();

    try {
        await appendHistoryToPath(path, {
            timestamp: firstTimestamp,
            quotas: [
                { id: "session", usedPercent: 14 },
                { id: "weekly", usedPercent: 54 },
            ],
        });
        await appendHistoryToPath(path, {
            timestamp: secondTimestamp,
            quotas: [
                { id: "session", usedPercent: 15 },
                { id: "weekly", usedPercent: 55 },
            ],
        });

        const text = await readText(path);

        assertDeepEqual(text.trim().split(/\r?\n/), [
            "timestamp,quotas_json",
            `${firstTimestamp},"[{""id"":""session"",""usedPercent"":14},{""id"":""weekly"",""usedPercent"":54}]"`,
            `${secondTimestamp},"[{""id"":""session"",""usedPercent"":15},{""id"":""weekly"",""usedPercent"":55}]"`,
        ], "history append should write valid UTF-8 CSV rows");
    } finally {
        removeFile(path);
    }
}

async function testLegacyColumnsAreReadable() {
    const path = createTempPath("legacy-read.csv");

    try {
        writeText(path, [
            "timestamp,primaryUsedPercent,secondaryUsedPercent",
            `${new Date().toISOString()},11,56`,
            "",
        ].join("\n"));

        const history = await readHistoryFromPath(path);

        assertEqual(history.length, 1, "legacy history row should be read");
        assertDeepEqual(history[0].quotas, [
            { id: "session", usedPercent: 11 },
            { id: "weekly", usedPercent: 56 },
        ], "legacy usage quotas should be read");
    } finally {
        removeFile(path);
    }
}

await testDuplicateHeaderMigration();
await testAppendWritesUtf8();
await testLegacyColumnsAreReadable();
