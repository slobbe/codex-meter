import GLib from "gi://GLib";

import { STATE_DIR } from "../../io/paths.js";
import { appendFile, isNotFoundError, readFileChunks, writeFile } from "../../io/files.js";

export const MAX_HISTORY_ENTRIES = 25_000;

const MAX_HISTORY_AGE_SECONDS = 30 * 24 * 60 * 60;
const MAX_HISTORY_ROW_BYTES = 2 * 1024 * 1024;
export const HISTORY_PATH = GLib.build_filenamev([STATE_DIR, "codex", "usage-history.jsonl"]);

export async function readHistory(path = HISTORY_PATH, cancellable = null, repair = true) {
    const decoder = new TextDecoder("utf-8");
    const minTimestamp = Date.now() - MAX_HISTORY_AGE_SECONDS * 1000;
    const entries = [];
    let needsRewrite = false;
    let partialRow;
    let partialLength = 0;
    let oversized = false;

    const addRow = (bytes) => {
        const text = decoder.decode(bytes).trim();
        if (!text) return;
        let row;
        try {
            row = normalizeHistoryEntry(JSON.parse(text));
        } catch (_error) {
            row = null;
        }
        const timestamp = row ? Date.parse(row.timestamp) : NaN;
        if (!(timestamp >= minTimestamp)) {
            needsRewrite = true;
            return;
        }
        entries.push({ row, timestamp });
        // Timestamps can be out of order after a clock change. Keep the newest rows, not the last bytes.
        if (entries.length >= 2 * MAX_HISTORY_ENTRIES) {
            trimHistory(entries);
            needsRewrite = true;
        }
    };

    try {
        await readFileChunks(
            path,
            (bytes) => {
                for (let offset = 0; offset < bytes.length;) {
                    const end = bytes.indexOf(0x0a, offset);
                    const part = bytes.subarray(offset, end === -1 ? bytes.length : end);
                    offset = end === -1 ? bytes.length : end + 1;
                    if (partialLength === 0 && !oversized && end !== -1) {
                        addRow(part);
                        continue;
                    }
                    if (!oversized) {
                        if (partialLength + part.length > MAX_HISTORY_ROW_BYTES) {
                            oversized = true;
                            needsRewrite = true;
                        } else {
                            // Keep bytes until the newline so a chunk boundary cannot split a UTF-8 character.
                            partialRow ??= new Uint8Array(MAX_HISTORY_ROW_BYTES);
                            partialRow.set(part, partialLength);
                            partialLength += part.length;
                        }
                    }
                    if (end !== -1) {
                        if (!oversized) addRow(partialRow.subarray(0, partialLength));
                        partialLength = 0;
                        oversized = false;
                    }
                }
            },
            cancellable,
        );
    } catch (error) {
        if (isNotFoundError(error.cause)) return [];
        throw error;
    }
    if (!oversized && partialLength > 0) {
        addRow(partialRow.subarray(0, partialLength));
        needsRewrite = true;
    }
    if (entries.length > MAX_HISTORY_ENTRIES) needsRewrite = true;
    trimHistory(entries);
    const history = entries.map(({ row }) => row);
    if (needsRewrite && repair) await writeHistoryRows(history, path, cancellable);
    cancellable?.set_error_if_cancelled();
    return history;
}

/**
 * Append a history row verbatim without parsing or normalizing existing history.
 * Callers must pre-normalize rows and decide whether appending is appropriate.
 */
export async function appendHistoryRow(row, path = HISTORY_PATH, cancellable = null) {
    await appendFile(path, JSON.stringify(row), cancellable);
}

export async function rewriteHistory(rows, path = HISTORY_PATH, cancellable = null) {
    await writeHistoryRows(normalizeHistoryEntries(rows), path, cancellable);
}

function writeHistoryRows(rows, path, cancellable) {
    return writeFile(
        path,
        // A newline also represents empty JSONL without a zero-length Gio write.
        rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
        cancellable,
    );
}

function trimHistory(entries) {
    entries.sort((left, right) => left.timestamp - right.timestamp);
    if (entries.length > MAX_HISTORY_ENTRIES)
        entries.splice(0, entries.length - MAX_HISTORY_ENTRIES);
}

export function normalizeHistoryEntries(rows) {
    const minTimestamp = Date.now() - MAX_HISTORY_AGE_SECONDS * 1000;
    return rows
        .map(normalizeHistoryEntry)
        .filter((row) => row !== null && Date.parse(row.timestamp) >= minTimestamp)
        .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
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
    return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
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
