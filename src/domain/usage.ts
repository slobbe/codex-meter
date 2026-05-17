export type UsageSnapshot = {
    fetchedAt: number; // UNIX in seconds
    providerId?: string;
    planType: "free" | "plus" | "pro" | string;
    quotas: UsageQuota[];
};

export type UsageQuota = {
    id: string;
    label: string;
    usedPercent: number;
    used?: number | null;
    limit?: number | null;
    remaining?: number | null;
    limitWindowSeconds?: number | null;
    resetAfterSeconds?: number | null;
    resetAt?: number | null; // UNIX in seconds
    limitReached?: boolean;
    resetDescription?: string | null;
};

export type HistoryEntry = {
    timestamp: string; // ISO format
    quotas: HistoryQuotaEntry[];
};

export type HistoryQuotaEntry = {
    id: string;
    usedPercent: number;
};

export function toHistoryEntry(snapshot: UsageSnapshot): HistoryEntry {
    return {
        timestamp: new Date(snapshot.fetchedAt * 1000).toISOString(),
        quotas: snapshot.quotas.map((quota) => ({
            id: quota.id,
            usedPercent: quota.usedPercent,
        })),
    };
}

export function getQuota(snapshot: UsageSnapshot | null | undefined, quotaId: string): UsageQuota | null {
    return snapshot?.quotas.find((quota) => quota.id === quotaId) ?? null;
}

export function getPrimaryQuota(snapshot: UsageSnapshot | null | undefined): UsageQuota | null {
    return snapshot?.quotas[0] ?? null;
}

export function getSecondaryQuota(snapshot: UsageSnapshot | null | undefined): UsageQuota | null {
    return snapshot?.quotas[1] ?? null;
}
