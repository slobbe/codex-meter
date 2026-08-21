// @ts-check

/** @typedef {import("../../types/domain.js").UsageSnapshot} UsageSnapshot */
/** @typedef {import("../../types/domain.js").UsageQuota} UsageQuota */
/** @typedef {import("../../types/domain.js").HistoryEntry} HistoryEntry */

/**
 * @param {UsageSnapshot} snapshot
 * @returns {HistoryEntry}
 */
export function toHistoryEntry(snapshot) {
    return {
        timestamp: new Date(snapshot.fetchedAt * 1000).toISOString(),
        quotas: snapshot.quotas.map((quota) => ({
            id: quota.id,
            usedPercent: quota.usedPercent,
            used: quota.used,
            limit: quota.limit,
            remaining: quota.remaining,
            resetAt: quota.resetAt,
            limitReached: quota.limitReached,
        })),
    };
}

/**
 * @param {UsageSnapshot | null | undefined} snapshot
 * @param {string} quotaId
 * @returns {UsageQuota | null}
 */
export function getQuota(snapshot, quotaId) {
    return snapshot?.quotas.find((quota) => quota.id === quotaId) ?? null;
}

/**
 * @param {UsageSnapshot | null | undefined} snapshot
 * @returns {UsageQuota | null}
 */
export function getPrimaryQuota(snapshot) {
    return snapshot?.quotas[0] ?? null;
}

/**
 * @param {UsageSnapshot | null | undefined} snapshot
 * @returns {UsageQuota | null}
 */
export function getSecondaryQuota(snapshot) {
    return snapshot?.quotas[1] ?? null;
}
