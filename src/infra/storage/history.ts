import { getHistoryPath } from "../paths.js";
import { HistoryEntry } from "../../domain/usage.js";
import { appendCsvFile, readCsvFile, writeCsvFile } from "../filesystem.js";

const HISTORY_HEADERS = [
    "timestamp",
    "session_used_percent",
    "weekly_used_percent",
];
const MAX_HISTORY_ENTRIES = 25_000;
const MAX_HISTORY_AGE_SECONDS = 21 * 24 * 60 * 60;

export async function readHistory(): Promise<HistoryEntry[]> {
    return readHistoryFromPath(getHistoryPath());
}

export async function readHistoryFromPath(path: string): Promise<HistoryEntry[]> {
    let rows: Record<string, string>[];

    try {
        rows = await readCsvFile(path);
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
    return appendHistoryToPath(getHistoryPath(), row);
}

export async function appendHistoryToPath(path: string, row: HistoryEntry): Promise<void> {
    try {
        await appendHistoryRow(path, row);
    } catch (error) {
        if (!isHeaderMismatch(error)) {
            throw error;
        }

        await rewriteHistory(path, await readHistoryFromPath(path));
        await appendHistoryRow(path, row);
    }

    await compactHistory(path);
}

function isValidTimestamp(value: string): boolean {
    return value.length > 0 && Number.isFinite(new Date(value).getTime());
}

async function compactHistory(path: string): Promise<void> {
    const rawRows = await readCsvFile(path);

    if (rawRows.length < MAX_HISTORY_ENTRIES) {
        return;
    }

    const rows = await readHistoryFromPath(path);

    if (rows.length === rawRows.length) {
        return;
    }

    await rewriteHistory(path, rows);
}

async function appendHistoryRow(path: string, row: HistoryEntry): Promise<void> {
    await appendCsvFile(path, [{
        timestamp: row.timestamp,
        session_used_percent: row.primaryUsedPercent,
        weekly_used_percent: row.secondaryUsedPercent,
    }], HISTORY_HEADERS);
}

async function rewriteHistory(path: string, rows: HistoryEntry[]): Promise<void> {
    await writeCsvFile(path, rows.map((row) => ({
        timestamp: row.timestamp,
        session_used_percent: row.primaryUsedPercent,
        weekly_used_percent: row.secondaryUsedPercent,
    })));
}

function isHeaderMismatch(error: unknown): boolean {
    return error instanceof Error && error.message.includes("header mismatch");
}
