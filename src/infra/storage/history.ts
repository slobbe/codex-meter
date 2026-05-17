import GLib from "gi://GLib";

import { HistoryEntry } from "../../domain/usage.js";
import { STATE_DIR } from "../config.js";
import { appendCsvFile, readCsvFile, writeCsvFile } from "../filesystem.js";
import { ProviderId } from "../providers/types.js";

const HISTORY_HEADERS = [
    "timestamp",
    "quotas_json",
];
const MAX_HISTORY_ENTRIES = 25_000;
const MAX_HISTORY_AGE_SECONDS = 21 * 24 * 60 * 60;

function getHistoryPath(providerId: ProviderId) {
    return GLib.build_filenamev([STATE_DIR, providerId, "usage-history.csv"]);
}

export async function readHistory(providerId: ProviderId): Promise<HistoryEntry[]> {
    return readHistoryFromPath(getHistoryPath(providerId));
}

export async function readHistoryFromPath(path: string): Promise<HistoryEntry[]> {
    let rows: Record<string, string>[];

    try {
        rows = await readCsvFile(path);
    } catch (error) {
        console.error("Unable to read usage history", error);
        return [];
    }

    const minTimestamp = Date.now() - (MAX_HISTORY_AGE_SECONDS * 1000);

    return rows
        .map(rowToHistoryEntry)
        .filter((row): row is HistoryEntry =>
            row !== null &&
            isValidTimestamp(row.timestamp) &&
            row.quotas.length > 0 &&
            row.quotas.every((quota) =>
                quota.id.length > 0 && Number.isFinite(quota.usedPercent),
            ),
        )
        .filter((row) => new Date(row.timestamp).getTime() >= minTimestamp)
        .slice(-MAX_HISTORY_ENTRIES);
}

export async function appendHistory(
    providerId: ProviderId,
    row: HistoryEntry,
): Promise<void> {
    return appendHistoryToPath(getHistoryPath(providerId), row);
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
    await appendCsvFile(path, [historyEntryToRow(row)], HISTORY_HEADERS);
}

async function rewriteHistory(path: string, rows: HistoryEntry[]): Promise<void> {
    await writeCsvFile(path, rows.map(historyEntryToRow));
}

function historyEntryToRow(row: HistoryEntry): Record<string, string> {
    return {
        timestamp: row.timestamp,
        quotas_json: JSON.stringify(row.quotas),
    };
}

function rowToHistoryEntry(row: Record<string, string>): HistoryEntry | null {
    if (row.quotas_json) {
        try {
            const quotas = JSON.parse(row.quotas_json);

            if (Array.isArray(quotas)) {
                return {
                    timestamp: row.timestamp,
                    quotas: quotas.map((quota) => ({
                        id: `${quota.id ?? ""}`,
                        usedPercent: Number(quota.usedPercent),
                    })),
                };
            }
        } catch (_error) {
            return null;
        }
    }

    const primaryUsedPercent = Number(
        row.session_used_percent || row.primaryUsedPercent,
    );
    const secondaryUsedPercent = Number(
        row.weekly_used_percent || row.secondaryUsedPercent,
    );
    const quotas = [];

    if (Number.isFinite(primaryUsedPercent)) {
        quotas.push({ id: "session", usedPercent: primaryUsedPercent });
    }

    if (Number.isFinite(secondaryUsedPercent)) {
        quotas.push({ id: "weekly", usedPercent: secondaryUsedPercent });
    }

    return {
        timestamp: row.timestamp,
        quotas,
    };
}

function isHeaderMismatch(error: unknown): boolean {
    return error instanceof Error && error.message.includes("header mismatch");
}
