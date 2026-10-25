// @ts-check

/** @typedef {import("../../../types/index.js").UsageSnapshot} UsageSnapshot */
/** @typedef {import("../../../types/index.js").UsageQuota} UsageQuota */

/** @typedef {import("../../../types/index.js").HistoryEntry} HistoryEntry */

/**
 * @param {unknown} limitWindowSeconds
 * @returns {{type: "hour" | "week" | "unknown", label: string}}
 */
export function getUsageWindowMetadata(limitWindowSeconds) {
    if (
        typeof limitWindowSeconds !== "number" ||
        !Number.isFinite(limitWindowSeconds) ||
        limitWindowSeconds <= 0
    ) {
        return { type: "unknown", label: "Usage" };
    }

    if (limitWindowSeconds % 604_800 === 0) {
        const weeks = limitWindowSeconds / 604_800;
        return { type: "week", label: weeks === 1 ? "Weekly" : `${weeks} weeks` };
    }

    if (limitWindowSeconds % 3_600 === 0) {
        const hours = limitWindowSeconds / 3_600;
        return { type: "hour", label: hours === 1 ? "Hourly" : `${hours} hours` };
    }

    return { type: "unknown", label: `${limitWindowSeconds} seconds` };
}

/**
 * @param {UsageQuota[]} quotas
 * @returns {UsageQuota[]}
 */
export function sortUsageQuotas(quotas) {
    /** @param {UsageQuota} quota */
    const duration = ({ limitWindowSeconds }) =>
        typeof limitWindowSeconds === "number" &&
        Number.isFinite(limitWindowSeconds) &&
        limitWindowSeconds > 0
            ? limitWindowSeconds
            : Infinity;

    return [...quotas].sort((left, right) => {
        const leftDuration = duration(left);
        const rightDuration = duration(right);
        return leftDuration < rightDuration ? -1 : leftDuration > rightDuration ? 1 : 0;
    });
}

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
