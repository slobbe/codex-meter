import { HistoryEntry } from "./usage-history.js";
import { UsageSnapshot } from "./usage-snapshot.js";

type Trend = "safe" | "unsafe" | "limit reached" | "unknown";

export type WindowPrediction = {
    estimatedLimitAt: number | null
    trend: Trend
}

export type UsagePrediction = {
    primary: WindowPrediction;
    secondary: WindowPrediction; 
};

type HistoryEntrySlice = {
    timestamp: number // UNIX in seconds
    usedPercent: number
}

export function predict(history: HistoryEntry[], snapshot: UsageSnapshot): UsagePrediction {   
    const sessionStartedAt = snapshot.fetchedAt - (snapshot.rateLimit.primary.limitWindowSeconds - snapshot.rateLimit.primary.resetAfterSeconds);
    const weeklyStartedAt = snapshot.fetchedAt - (snapshot.rateLimit.secondary.limitWindowSeconds - snapshot.rateLimit.secondary.resetAfterSeconds);
    
    const sessionHistory = history.map(h => {
        return {
            timestamp: new Date(h.timestamp).getTime() / 1000,
            usedPercent: h.session_used_percent
        }
    }).toSorted((a, b) => b.timestamp - a.timestamp).filter(h => h.timestamp >= sessionStartedAt);

    const weeklyHistory = history.map(h => {
        return {
            timestamp: new Date(h.timestamp).getTime() / 1000,
            usedPercent: h.weekly_used_percent
        }
    }).toSorted((a, b) => b.timestamp - a.timestamp).filter(h => h.timestamp >= weeklyStartedAt);

    return {
        primary: predictWindow(sessionHistory, snapshot.rateLimit.primary.resetAt),
        secondary: predictWindow(weeklyHistory, snapshot.rateLimit.secondary.resetAt)
    }
    
}

function predictWindow(windowHistory: HistoryEntrySlice[], resetAt: number): WindowPrediction { 

    if (windowHistory.length < 2) {
        return {
            estimatedLimitAt: null,
            trend: "unknown"
        };
    }
    const history = windowHistory.toSorted((a, b) => a.timestamp - b.timestamp);
    const oldest = history[0];
    const latest = history[history.length - 1];
    
    if (latest.usedPercent >= 100) {
        return {
            estimatedLimitAt: null,
            trend: "limit reached"
        };
    }

    if (latest.usedPercent <= oldest.usedPercent) {
        return {
            estimatedLimitAt: null,
            trend: "safe"
        };
    }

    const fit = calculateFit(history.map(h => h.timestamp), history.map(h => h.usedPercent));
    
    const limitAt = fit(100);

    if (!Number.isFinite(limitAt)) {
        return {
            estimatedLimitAt: null,
            trend: "safe"
        };
    }

    return {
        estimatedLimitAt: limitAt,
        trend: (limitAt < resetAt) ? "unsafe" : "safe"
    };
}

function calculateFit(x: number[], y: number[]) {
    const n = x.length

    const secondsPerPercent = (x[n - 1] - x[0]) / (y[n - 1] - y[0]);

    return (t: number) => x[n - 1] + ((t - y[n - 1]) * secondsPerPercent);
}
