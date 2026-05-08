import { getHistoryPath } from "../paths.js";
import { HistoryEntry } from "../../domain/usage-history.js";
import { appendFile, readCsvFile, toCsvRow } from "../filesystem.js";

const HISTORY_COLUMNS = [
    "timestamp",
    "session_used_percent",
    "weekly_used_percent",
] as const;

export async function readHistory(): Promise<HistoryEntry[]> {
    const rows = await readCsvFile(getHistoryPath());
    return rows as HistoryEntry[];
}

export async function appendHistory(row: HistoryEntry): Promise<void> {
    const csvRow = historyRowToCsv(row);

    await appendFile(getHistoryPath(), csvRow + "\n");
}

function historyRowToCsv(row: HistoryEntry): string {
    return toCsvRow(HISTORY_COLUMNS.map((key) => row[key]));
}
