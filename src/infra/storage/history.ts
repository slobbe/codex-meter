import GLib from "gi://GLib";

import { HistoryEntry, HistoryQuotaEntry } from "../../domain/usage.js";
import { STATE_DIR } from "../config.js";
import { appendFile, readTextFile, writeTextFile } from "../filesystem.js";
import { ProviderId } from "../providers/types.js";

const MAX_HISTORY_ENTRIES = 25_000;
const MAX_HISTORY_AGE_SECONDS = 21 * 24 * 60 * 60;

function getHistoryPath(providerId: ProviderId) {
    return GLib.build_filenamev([STATE_DIR, providerId, "usage-history.jsonl"]);
}

export async function readHistory(providerId: ProviderId): Promise<HistoryEntry[]> {
    return readHistoryFromPath(getHistoryPath(providerId));
}

export async function readHistoryFromPath(path: string): Promise<HistoryEntry[]> {
    if (!fileExists(path)) return [];

    try {
        return normalizeHistoryEntries(parseJsonlHistory(await readTextFile(path)));
    } catch (error) {
        console.error("Unable to read usage history", error);
        return [];
    }
}



export async function appendHistory(
    providerId: ProviderId,
    row: HistoryEntry,
): Promise<void> {
    return appendHistoryToPath(getHistoryPath(providerId), row);
}

export async function appendHistoryToPath(
    path: string,
    row: HistoryEntry,
    existingRows: HistoryEntry[] | null = null,
): Promise<void> {
    const rows = existingRows ?? await readHistoryFromPath(path);
    const normalizedRows = normalizeHistoryEntries(rows);
    const normalizedRow = normalizeHistoryEntry(row);

    if (!normalizedRow) return;

    const lastRow = normalizedRows.at(-1);
    const shouldAppend = !lastRow || !hasSameQuotaValues(lastRow, normalizedRow);
    const nextRows = shouldAppend
        ? normalizeHistoryEntries([...normalizedRows, normalizedRow])
        : normalizedRows;

    if (!fileExists(path) && nextRows.length > 0) {
        await rewriteHistory(path, nextRows);
        return;
    }

    if (!shouldAppend) return;

    await appendFile(path, JSON.stringify(normalizedRow));

    if (nextRows.length !== normalizedRows.length + 1) {
        await rewriteHistory(path, nextRows);
    }
}

function fileExists(path: string): boolean {
    return GLib.file_test(path, GLib.FileTest.EXISTS);
}

function parseJsonlHistory(text: string): HistoryEntry[] {
    return text
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            try {
                return JSON.parse(line);
            } catch (_error) {
                return null;
            }
        })
        .filter((row): row is HistoryEntry => row !== null);
}

function normalizeHistoryEntries(rows: HistoryEntry[]): HistoryEntry[] {
    const minTimestamp = Date.now() - (MAX_HISTORY_AGE_SECONDS * 1000);

    return rows
        .map(normalizeHistoryEntry)
        .filter((row): row is HistoryEntry =>
            row !== null && new Date(row.timestamp).getTime() >= minTimestamp
        )
        .slice(-MAX_HISTORY_ENTRIES);
}

function normalizeHistoryEntry(row: HistoryEntry): HistoryEntry | null {
    if (!row || !isValidTimestamp(row.timestamp) || !Array.isArray(row.quotas)) {
        return null;
    }

    const quotas = row.quotas
        .map(normalizeHistoryQuota)
        .filter((quota): quota is HistoryQuotaEntry => quota !== null);

    if (quotas.length === 0) return null;

    return {
        timestamp: row.timestamp,
        quotas,
    };
}

function normalizeHistoryQuota(quota): HistoryQuotaEntry | null {
    const id = `${quota?.id ?? ""}`;
    const usedPercent = Number(quota?.usedPercent);

    if (id.length === 0 || !Number.isFinite(usedPercent)) return null;

    return omitUndefined({
        id,
        usedPercent,
        used: finiteOrNull(quota?.used),
        limit: finiteOrNull(quota?.limit),
        remaining: finiteOrNull(quota?.remaining),
        resetAt: finiteOrNull(quota?.resetAt),
        limitReached: typeof quota?.limitReached === "boolean"
            ? quota.limitReached
            : undefined,
    });
}

function finiteOrNull(value): number | null | undefined {
    if (value === null) return null;

    const number = Number(value);

    return Number.isFinite(number) ? number : undefined;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
    return Object.fromEntries(
        Object.entries(value).filter(([, item]) => item !== undefined),
    ) as T;
}

function isValidTimestamp(value: string): boolean {
    return value.length > 0 && Number.isFinite(new Date(value).getTime());
}

async function rewriteHistory(path: string, rows: HistoryEntry[]): Promise<void> {
    await writeTextFile(
        path,
        rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
    );
}

function hasSameQuotaValues(left: HistoryEntry, right: HistoryEntry): boolean {
    if (left.quotas.length !== right.quotas.length) return false;

    const leftById = new Map(left.quotas.map((quota) => [quota.id, quota]));

    return right.quotas.every((rightQuota) => {
        const leftQuota = leftById.get(rightQuota.id);

        return Boolean(leftQuota) &&
            leftQuota?.usedPercent === rightQuota.usedPercent &&
            leftQuota?.used === rightQuota.used &&
            leftQuota?.limit === rightQuota.limit &&
            leftQuota?.remaining === rightQuota.remaining &&
            leftQuota?.resetAt === rightQuota.resetAt &&
            leftQuota?.limitReached === rightQuota.limitReached;
    });
}
