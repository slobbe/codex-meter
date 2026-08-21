import GLib from "gi://GLib";
import { STATE_DIR } from "../io/paths.js";
import { appendFile, readFile, writeFile } from "../io/files.js";

export const MAX_HISTORY_ENTRIES = 25_000;

const MAX_HISTORY_AGE_SECONDS = 21 * 24 * 60 * 60;
const HISTORY_PATH = GLib.build_filenamev([STATE_DIR, "codex", "usage-history.jsonl"]);

export async function readHistory() {
    return readHistoryFromPath(HISTORY_PATH);
}

export async function readHistoryFromPath(path) {
    if (!fileExists(path)) return [];
    try {
        return normalizeHistoryEntries(parseJsonlHistory(await readFile(path)));
    } catch (error) {
        console.error("Unable to read usage history", error);
        return [];
    }
}

/**
 * Append a history row verbatim without reading, deduping, or normalizing existing history.
 * Callers must pre-normalize rows and decide whether appending is appropriate.
 */
export async function appendHistoryRow(row) {
    return appendHistoryRowToPath(HISTORY_PATH, row);
}

export async function appendHistoryRowToPath(path, row) {
    await appendFile(path, JSON.stringify(row));
}

export async function rewriteHistory(rows) {
    await rewriteHistoryToPath(HISTORY_PATH, normalizeHistoryEntries(rows));
}

export async function appendHistoryToPath(path, row, existingRows = null) {
    const rows = existingRows ?? (await readHistoryFromPath(path));
    const normalizedRows = normalizeHistoryEntries(rows);
    const normalizedRow = normalizeHistoryEntry(row);
    if (!normalizedRow) return;
    const lastRow = normalizedRows.at(-1);
    const shouldAppend = !lastRow || !hasSameQuotaValues(lastRow, normalizedRow);
    const nextRows = shouldAppend
        ? normalizeHistoryEntries([...normalizedRows, normalizedRow])
        : normalizedRows;
    if (!fileExists(path) && nextRows.length > 0) {
        await rewriteHistoryToPath(path, nextRows);
        return;
    }
    if (!shouldAppend) return;
    await appendFile(path, JSON.stringify(normalizedRow));
    if (nextRows.length !== normalizedRows.length + 1) {
        await rewriteHistoryToPath(path, nextRows);
    }
}

function fileExists(path) {
    return GLib.file_test(path, GLib.FileTest.EXISTS);
}

function parseJsonlHistory(text) {
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
        .filter((row) => row !== null);
}

export function normalizeHistoryEntries(rows) {
    const minTimestamp = Date.now() - MAX_HISTORY_AGE_SECONDS * 1000;
    return rows
        .map(normalizeHistoryEntry)
        .filter((row) => row !== null && new Date(row.timestamp).getTime() >= minTimestamp)
        .slice(-MAX_HISTORY_ENTRIES);
}

export function normalizeHistoryEntry(row) {
    if (!row || !isValidTimestamp(row.timestamp) || !Array.isArray(row.quotas)) {
        return null;
    }
    const quotas = row.quotas.map(normalizeHistoryQuota).filter((quota) => quota !== null);
    if (quotas.length === 0) return null;
    return {
        timestamp: row.timestamp,
        quotas,
    };
}

function normalizeHistoryQuota(quota) {
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
        limitReached: typeof quota?.limitReached === "boolean" ? quota.limitReached : undefined,
    });
}

function finiteOrNull(value) {
    if (value === null) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function omitUndefined(value) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function isValidTimestamp(value) {
    return value.length > 0 && Number.isFinite(new Date(value).getTime());
}

async function rewriteHistoryToPath(path, rows) {
    await writeFile(
        path,
        rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
    );
}

export function hasSameQuotaValues(left, right) {
    if (left.quotas.length !== right.quotas.length) return false;
    const leftById = new Map(left.quotas.map((quota) => [quota.id, quota]));
    return right.quotas.every((rightQuota) => {
        const leftQuota = leftById.get(rightQuota.id);
        return (
            Boolean(leftQuota) &&
            leftQuota?.usedPercent === rightQuota.usedPercent &&
            leftQuota?.used === rightQuota.used &&
            leftQuota?.limit === rightQuota.limit &&
            leftQuota?.remaining === rightQuota.remaining &&
            leftQuota?.resetAt === rightQuota.resetAt &&
            leftQuota?.limitReached === rightQuota.limitReached
        );
    });
}
