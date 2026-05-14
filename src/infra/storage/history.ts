import { getHistoryPath } from "../paths.js";
import { HistoryEntry } from "../../domain/usage-history.js";
import { appendCsvFile, readCsvFile } from "../filesystem.js";

const HISTORY_HEADERS = [
    "timestamp",
    "session_used_percent",
    "weekly_used_percent",
];

export async function readHistory(): Promise<HistoryEntry[]> {
    let rows: Record<string, string>[];

    try {
        rows = await readCsvFile(getHistoryPath());
    } catch (error) {
        console.error("Unable to read Codex usage history", error);
        return [];
    }

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
        );
}

export async function appendHistory(row: HistoryEntry): Promise<void> {
    await appendCsvFile(getHistoryPath(), [{
        timestamp: row.timestamp,
        session_used_percent: row.primaryUsedPercent,
        weekly_used_percent: row.secondaryUsedPercent,
    }], HISTORY_HEADERS);
}

function isValidTimestamp(value: string): boolean {
    return value.length > 0 && Number.isFinite(new Date(value).getTime());
}
