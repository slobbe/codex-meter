import { UsageSnapshot, HistoryEntry, UsageQuota } from "./usage.js";

type Trend = "safe" | "unsafe" | "limit reached" | "unknown";

export type WindowPrediction = {
    estimatedLimitAt: number | null;
    trend: Trend;
};

export type UsagePrediction = {
    quotas: Record<string, WindowPrediction>;
    primary: WindowPrediction;
    secondary: WindowPrediction;
};

type HistoryEntrySlice = {
    timestamp: number; // UNIX in seconds
    usedPercent: number;
};

export function createUnknownUsagePrediction(snapshot?: UsageSnapshot | null): UsagePrediction {
    const quotas: Record<string, WindowPrediction> = {};

    for (const quota of snapshot?.quotas ?? []) {
        quotas[quota.id] = unknownPrediction();
    }

    return {
        quotas,
        primary: quotas[snapshot?.quotas[0]?.id] ?? unknownPrediction(),
        secondary: quotas[snapshot?.quotas[1]?.id] ?? unknownPrediction(),
    };
}

export function predict(
    history: HistoryEntry[],
    snapshot: UsageSnapshot,
): UsagePrediction {
    const quotas: Record<string, WindowPrediction> = {};

    for (const quota of snapshot.quotas) {
        quotas[quota.id] = predictQuota(history, snapshot, quota);
    }

    return {
        quotas,
        primary: quotas[snapshot.quotas[0]?.id] ?? unknownPrediction(),
        secondary: quotas[snapshot.quotas[1]?.id] ?? unknownPrediction(),
    };
}

function predictQuota(
    history: HistoryEntry[],
    snapshot: UsageSnapshot,
    quota: UsageQuota,
): WindowPrediction {
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
            usedPercent: entry.usedPercent as number,
        }))
        .toSorted((a, b) => b.timestamp - a.timestamp)
        .filter((entry) => entry.timestamp >= startedAt);

    return predictWindow(quotaHistory, startedAt, quota.resetAt);
}

function hasPredictionMetadata(quota: UsageQuota): quota is UsageQuota & {
    limitWindowSeconds: number;
    resetAfterSeconds: number;
    resetAt: number;
} {
    return Number.isFinite(quota.limitWindowSeconds) &&
        Number.isFinite(quota.resetAfterSeconds) &&
        Number.isFinite(quota.resetAt) &&
        (quota.limitWindowSeconds ?? 0) > 0;
}

function unknownPrediction(): WindowPrediction {
    return {
        estimatedLimitAt: null,
        trend: "unknown",
    };
}

function predictWindow(
    windowHistory: HistoryEntrySlice[],
    windowStartedAt: number,
    resetAt: number,
): WindowPrediction {
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
        history.map((h) => h.timestamp),
        history.map((h) => h.usedPercent),
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

function calculateFit(x: number[], y: number[]) {
    const n = x.length;

    const secondsPerPercent = (x[n - 1] - x[0]) / (y[n - 1] - y[0]);

    return (t: number) => x[n - 1] + (t - y[n - 1]) * secondsPerPercent;
}
