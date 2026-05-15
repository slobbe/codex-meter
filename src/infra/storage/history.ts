import { getHistoryPath } from "../paths.js";
import { HistoryEntry } from "../../domain/usage-history.js";
import { appendCsvFile, readCsvFile, writeCsvFile } from "../filesystem.js";

const HISTORY_HEADERS = [
    "timestamp",
    "session_used_percent",
    "weekly_used_percent",
];
const MAX_HISTORY_ENTRIES = 25_000;
const MAX_HISTORY_AGE_SECONDS = 21 * 24 * 60 * 60;

export async function readHistory(): Promise<HistoryEntry[]> {
    let rows: Record<string, string>[];

    try {
        rows = await readCsvFile(getHistoryPath());
    } catch (error) {
        console.error("Unable to read Codex usage history", error);
        return [];
    }

    const minTimestamp = Date.now() - (MAX_HISTORY_AGE_SECONDS * 1000);

    return rows
        .map((row) => ({
            timestamp: row.timestamp,
            primaryUsedPercent: Number(row.session_used_percent),
            secondaryUsedPercent: Number(row.weekly_used_percent),
        }))
        .filter((row) =>
            isValidTimestamp(row.timestamp) &&
            Number.isFinite(row.primaryUsedPercent) &&
            Number.isFinite(row.secondaryUsedPercent),
        )
        .filter((row) => new Date(row.timestamp).getTime() >= minTimestamp)
        .slice(-MAX_HISTORY_ENTRIES);
}

export async function appendHistory(row: HistoryEntry): Promise<void> {
    await appendCsvFile(getHistoryPath(), [{
        timestamp: row.timestamp,
        session_used_percent: row.primaryUsedPercent,
        weekly_used_percent: row.secondaryUsedPercent,
    }], HISTORY_HEADERS);

    await compactHistory();
}

function isValidTimestamp(value: string): boolean {
    return value.length > 0 && Number.isFinite(new Date(value).getTime());
}

async function compactHistory(): Promise<void> {
    const rawRows = await readCsvFile(getHistoryPath());

    if (rawRows.length < MAX_HISTORY_ENTRIES) {
        return;
    }

    const rows = await readHistory();

    if (rows.length === rawRows.length) {
        return;
    }

    await writeCsvFile(getHistoryPath(), rows.map((row) => ({
        timestamp: row.timestamp,
        session_used_percent: row.primaryUsedPercent,
        weekly_used_percent: row.secondaryUsedPercent,
    })));
}
