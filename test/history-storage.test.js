import GLib from "gi://GLib";
import Gio from "gi://Gio";

import {
    appendHistoryToPath,
    readHistoryFromPath,
    readLegacyHistoryFromPath,
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

async function testAppendWritesJsonl() {
    const path = createTempPath("append.jsonl");
    const firstTimestamp = new Date(Date.now() - 60_000).toISOString();
    const secondTimestamp = new Date().toISOString();

    try {
        await appendHistoryToPath(path, {
            timestamp: firstTimestamp,
            quotas: [
                {
                    id: "session",
                    usedPercent: 14,
                    used: 140,
                    limit: 1000,
                    remaining: 860,
                    resetAt: 1_700_000_000,
                    limitReached: false,
                },
                { id: "weekly", usedPercent: 54 },
            ],
        });
        await appendHistoryToPath(path, {
            timestamp: secondTimestamp,
            quotas: [
                { id: "session", usedPercent: 15, used: 150 },
                { id: "weekly", usedPercent: 55 },
            ],
        });

        const lines = (await readText(path)).trim().split(/\r?\n/);

        assertEqual(lines.length, 2, "history append should write one JSON object per line");
        assertDeepEqual(JSON.parse(lines[0]), {
            timestamp: firstTimestamp,
            quotas: [
                {
                    id: "session",
                    usedPercent: 14,
                    used: 140,
                    limit: 1000,
                    remaining: 860,
                    resetAt: 1_700_000_000,
                    limitReached: false,
                },
                { id: "weekly", usedPercent: 54 },
            ],
        }, "history row should preserve richer quota fields");
    } finally {
        removeFile(path);
    }
}

async function testAppendSkipsDuplicateQuotaValues() {
    const path = createTempPath("dedupe.jsonl");
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
                { id: "session", usedPercent: 14 },
                { id: "weekly", usedPercent: 54 },
            ],
        });

        const lines = (await readText(path)).trim().split(/\r?\n/);

        assertEqual(lines.length, 1, "duplicate quota values should not be appended");
    } finally {
        removeFile(path);
    }
}

async function testFirstJsonlWriteMigratesExistingRows() {
    const path = createTempPath("migrate.jsonl");
    const firstTimestamp = new Date(Date.now() - 60_000).toISOString();
    const secondTimestamp = new Date().toISOString();

    try {
        await appendHistoryToPath(path, {
            timestamp: secondTimestamp,
            quotas: [{ id: "session", usedPercent: 12 }],
        }, [{
            timestamp: firstTimestamp,
            quotas: [{ id: "session", usedPercent: 10 }],
        }]);

        const lines = (await readText(path)).trim().split(/\r?\n/);

        assertEqual(lines.length, 2, "first JSONL write should migrate existing history rows");
        assertDeepEqual(lines.map(JSON.parse), [
            { timestamp: firstTimestamp, quotas: [{ id: "session", usedPercent: 10 }] },
            { timestamp: secondTimestamp, quotas: [{ id: "session", usedPercent: 12 }] },
        ], "migrated JSONL should include old rows before the new row");
    } finally {
        removeFile(path);
    }
}

async function testJsonlIsReadable() {
    const path = createTempPath("read.jsonl");
    const timestamp = new Date().toISOString();

    try {
        writeText(path, `${JSON.stringify({
            timestamp,
            quotas: [
                { id: "session", usedPercent: 11, used: 110 },
                { id: "weekly", usedPercent: 56 },
            ],
        })}\n`);

        const history = await readHistoryFromPath(path);

        assertEqual(history.length, 1, "JSONL history row should be read");
        assertDeepEqual(history[0].quotas, [
            { id: "session", usedPercent: 11, used: 110 },
            { id: "weekly", usedPercent: 56 },
        ], "JSONL usage quotas should be read");
    } finally {
        removeFile(path);
    }
}

async function testLegacyCsvColumnsAreReadable() {
    const path = createTempPath("legacy-read.csv");

    try {
        writeText(path, [
            "timestamp,primaryUsedPercent,secondaryUsedPercent",
            `${new Date().toISOString()},11,56`,
            "",
        ].join("\n"));

        const history = await readLegacyHistoryFromPath(path);

        assertEqual(history.length, 1, "legacy history row should be read");
        assertDeepEqual(history[0].quotas, [
            { id: "session", usedPercent: 11 },
            { id: "weekly", usedPercent: 56 },
        ], "legacy usage quotas should be read");
    } finally {
        removeFile(path);
    }
}

async function testLegacyCsvQuotasJsonIsReadable() {
    const path = createTempPath("legacy-quotas-json.csv");
    const timestamp = new Date().toISOString();

    try {
        writeText(path, [
            "timestamp,quotas_json",
            `${timestamp},"[{""id"":""session"",""usedPercent"":10,""used"":100},{""id"":""weekly"",""usedPercent"":53}]"`,
            "",
        ].join("\n"));

        const history = await readLegacyHistoryFromPath(path);

        assertEqual(history.length, 1, "legacy quotas_json row should be read");
        assertDeepEqual(history[0].quotas, [
            { id: "session", usedPercent: 10, used: 100 },
            { id: "weekly", usedPercent: 53 },
        ], "legacy quotas_json fields should be read");
    } finally {
        removeFile(path);
    }
}

await testAppendWritesJsonl();
await testAppendSkipsDuplicateQuotaValues();
await testFirstJsonlWriteMigratesExistingRows();
await testJsonlIsReadable();
await testLegacyCsvColumnsAreReadable();
await testLegacyCsvQuotasJsonIsReadable();
