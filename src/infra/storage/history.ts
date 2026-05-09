import { getHistoryPath } from "../paths.js";
import { HistoryEntry } from "../../domain/usage-history.js";
import { readCsvFile, writeCsvFile } from "../filesystem.js";

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
            session_used_percent: Number(row.session_used_percent),
            weekly_used_percent: Number(row.weekly_used_percent),
        }))
        .filter((row) =>
            row.timestamp &&
            Number.isFinite(row.session_used_percent) &&
            Number.isFinite(row.weekly_used_percent),
        );
}

export async function appendHistory(row: HistoryEntry): Promise<void> {
    await writeCsvFile(getHistoryPath(), [
        ...await readHistory(),
        {
            timestamp: row.timestamp,
            session_used_percent: row.session_used_percent,
            weekly_used_percent: row.weekly_used_percent,
        },
    ]);
}
