import { UsageSnapshot } from "./usage-snapshot.js";

export type HistoryEntry = {
    timestamp: string; // ISO format
    session_used_percent: number;
    weekly_used_percent: number;
};

export function toHistoryEntry(snapshot: UsageSnapshot): HistoryEntry {
    return {
        timestamp: new Date(snapshot.fetchedAt * 1000).toISOString(),
        session_used_percent: snapshot.rateLimit.primary.usedPercent,
        weekly_used_percent: snapshot.rateLimit.primary.usedPercent,
    };
}
