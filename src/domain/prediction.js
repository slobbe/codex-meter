// @ts-check

/** @typedef {import("./types.js").UsageSnapshot} UsageSnapshot */
/** @typedef {import("./types.js").UsageQuota} UsageQuota */
/** @typedef {import("./types.js").HistoryEntry} HistoryEntry */
/** @typedef {import("./types.js").WindowPrediction} WindowPrediction */
/** @typedef {import("./types.js").UsagePrediction} UsagePrediction */
/** @typedef {UsageQuota & {limitWindowSeconds: number, resetAfterSeconds: number, resetAt: number}} PredictionReadyQuota */
/** @typedef {{timestamp: number, usedPercent: number}} HistoryEntrySlice */

/**
 * @param {UsageSnapshot | null} [snapshot]
 * @returns {UsagePrediction}
 */
export function createUnknownUsagePrediction(snapshot) {
    /** @type {Record<string, WindowPrediction>} */
    const quotas = {};

    for (const quota of snapshot?.quotas ?? []) {
        quotas[quota.id] = unknownPrediction();
    }

    const primaryId = snapshot?.quotas[0]?.id;
    const secondaryId = snapshot?.quotas[1]?.id;

    return {
        quotas,
        primary: primaryId ? quotas[primaryId] ?? unknownPrediction() : unknownPrediction(),
        secondary: secondaryId ? quotas[secondaryId] ?? unknownPrediction() : unknownPrediction(),
    };
}

/**
 * @param {HistoryEntry[]} history
 * @param {UsageSnapshot} snapshot
 * @returns {UsagePrediction}
 */
export function predict(history, snapshot) {
    /** @type {Record<string, WindowPrediction>} */
    const quotas = {};

    for (const quota of snapshot.quotas) {
        quotas[quota.id] = predictQuota(history, snapshot, quota);
    }

    return {
        quotas,
        primary: quotas[snapshot.quotas[0]?.id] ?? unknownPrediction(),
        secondary: quotas[snapshot.quotas[1]?.id] ?? unknownPrediction(),
    };
}

/**
 * @param {HistoryEntry[]} history
 * @param {UsageSnapshot} snapshot
 * @param {UsageQuota} quota
 * @returns {WindowPrediction}
 */
function predictQuota(history, snapshot, quota) {
    if (!hasPredictionMetadata(quota)) {
        return unknownPrediction();
    }

    const startedAt = snapshot.fetchedAt -
        (quota.limitWindowSeconds - quota.resetAfterSeconds);
    const historyWithSnapshot = [
        ...history,
        {
            timestamp: new Date(snapshot.fetchedAt * 1000).toISOString(),
            quotas: [{ id: quota.id, usedPercent: quota.usedPercent }],
        },
    ];

    const quotaHistory = historyWithSnapshot
        .map((entry) => {
            const quotaEntry = entry.quotas.find((item) => item.id === quota.id);

            return {
                timestamp: new Date(entry.timestamp).getTime() / 1000,
                usedPercent: quotaEntry?.usedPercent,
            };
        })
        .filter((entry) => Number.isFinite(entry.usedPercent))
        .map((entry) => ({
            timestamp: entry.timestamp,
            usedPercent: Number(entry.usedPercent),
        }))
        .toSorted((a, b) => b.timestamp - a.timestamp)
        .filter((entry) => entry.timestamp >= startedAt);

    return predictWindow(quotaHistory, startedAt, quota.resetAt);
}

/**
 * @param {UsageQuota} quota
 * @returns {quota is PredictionReadyQuota}
 */
function hasPredictionMetadata(quota) {
    return Number.isFinite(quota.limitWindowSeconds) &&
        Number.isFinite(quota.resetAfterSeconds) &&
        Number.isFinite(quota.resetAt) &&
        (quota.limitWindowSeconds ?? 0) > 0;
}

/** @returns {WindowPrediction} */
function unknownPrediction() {
    return {
        estimatedLimitAt: null,
        trend: "unknown",
    };
}

/**
 * @param {HistoryEntrySlice[]} windowHistory
 * @param {number} windowStartedAt
 * @param {number} resetAt
 * @returns {WindowPrediction}
 */
function predictWindow(windowHistory, windowStartedAt, resetAt) {
    if (windowHistory.length < 1) {
        return {
            estimatedLimitAt: null,
            trend: "unknown",
        };
    }

    const history = windowHistory.toSorted((a, b) => a.timestamp - b.timestamp);

    if (history[0].usedPercent > 0 && history[0].timestamp > windowStartedAt) {
        history.unshift({
            timestamp: windowStartedAt,
            usedPercent: 0,
        });
    }

    if (history.length < 2) {
        return {
            estimatedLimitAt: null,
            trend: "unknown",
        };
    }

    const oldest = history[0];
    const latest = history[history.length - 1];

    if (latest.usedPercent >= 100) {
        return {
            estimatedLimitAt: null,
            trend: "limit reached",
        };
    }

    if (latest.usedPercent <= oldest.usedPercent) {
        return {
            estimatedLimitAt: null,
            trend: "safe",
        };
    }

    const fit = calculateFit(
        history.map((entry) => entry.timestamp),
        history.map((entry) => entry.usedPercent),
    );
    const limitAt = fit(100);

    if (!Number.isFinite(limitAt)) {
        return {
            estimatedLimitAt: null,
            trend: "safe",
        };
    }

    return {
        estimatedLimitAt: limitAt,
        trend: limitAt < resetAt ? "unsafe" : "safe",
    };
}

/**
 * @param {number[]} x
 * @param {number[]} y
 * @returns {(value: number) => number}
 */
function calculateFit(x, y) {
    const n = x.length;
    const secondsPerPercent = (x[n - 1] - x[0]) / (y[n - 1] - y[0]);

    return (value) => x[n - 1] + (value - y[n - 1]) * secondsPerPercent;
}
