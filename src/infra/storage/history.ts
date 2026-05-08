import { getHistoryPath } from "../paths.js";
import { HistoryEntry } from "../../domain/usage-history.js";
import { appendCsvFile, readCsvFile } from "../filesystem.js";

export async function readHistory(): Promise<HistoryEntry[]> {
    const rows = await readCsvFile(getHistoryPath());

    return rows.map((row) => ({
        timestamp: row.timestamp,
        session_used_percent: Number(row.session_used_percent),
        weekly_used_percent: Number(row.weekly_used_percent),
    }));
}

export async function appendHistory(row: HistoryEntry): Promise<void> {
    await appendCsvFile(getHistoryPath(), [
        {
            timestamp: row.timestamp,
            session_used_percent: row.session_used_percent,
            weekly_used_percent: row.weekly_used_percent,
        },
    ]);
}
