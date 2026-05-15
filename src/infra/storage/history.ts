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
            primaryUsedPercent: Number(row.session_used_percent || row.primaryUsedPercent),
            secondaryUsedPercent: Number(row.weekly_used_percent || row.secondaryUsedPercent),
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
    try {
        await appendHistoryRow(row);
    } catch (error) {
        if (!isHeaderMismatch(error)) {
            throw error;
        }

        await rewriteHistory(await readHistory());
        await appendHistoryRow(row);
    }

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

    await rewriteHistory(rows);
}

async function appendHistoryRow(row: HistoryEntry): Promise<void> {
    await appendCsvFile(getHistoryPath(), [{
        timestamp: row.timestamp,
        session_used_percent: row.primaryUsedPercent,
        weekly_used_percent: row.secondaryUsedPercent,
    }], HISTORY_HEADERS);
}

async function rewriteHistory(rows: HistoryEntry[]): Promise<void> {
    await writeCsvFile(getHistoryPath(), rows.map((row) => ({
        timestamp: row.timestamp,
        session_used_percent: row.primaryUsedPercent,
        weekly_used_percent: row.secondaryUsedPercent,
    })));
}

function isHeaderMismatch(error: unknown): boolean {
    return error instanceof Error && error.message.includes("header mismatch");
}
