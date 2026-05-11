import { UsageSnapshot } from "./usage-snapshot.js";

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
