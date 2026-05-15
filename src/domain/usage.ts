export type UsageSnapshot = {
    fetchedAt: number; // UNIX in seconds
    planType: "free" | "plus" | "pro" | string;
    rateLimit: {
        limitReached: boolean;
        primary: UsageWindow;
        secondary: UsageWindow;
    };
};

export type UsageWindow = {
    usedPercent: number;
    limitWindowSeconds: number;
    resetAfterSeconds: number;
    resetAt: number; // UNIX in seconds
};

export type HistoryEntry = {
    timestamp: string; // ISO format
    primaryUsedPercent: number;
    secondaryUsedPercent: number;
};

export function toHistoryEntry(snapshot: UsageSnapshot): HistoryEntry {
    return {
        timestamp: new Date(snapshot.fetchedAt * 1000).toISOString(),
        primaryUsedPercent: snapshot.rateLimit.primary.usedPercent,
        secondaryUsedPercent: snapshot.rateLimit.secondary.usedPercent,
    };
}
