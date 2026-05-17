import GLib from "gi://GLib";

import { UsageSnapshot } from "../../domain/usage.js";
import { CACHE_DIR } from "../config.js";
import { readJsonFile, writeJsonFile } from "../filesystem.js";
import { ProviderId } from "../providers/types.js";

function getSnapshotPath(providerId: ProviderId) {
    return GLib.build_filenamev([CACHE_DIR, providerId, "snapshot.json"]);
}

export async function writeSnapshot(
    providerId: ProviderId,
    snapshot: UsageSnapshot,
): Promise<void> {
    await writeJsonFile(getSnapshotPath(providerId), snapshot);
}

export async function readSnapshot(providerId: ProviderId): Promise<UsageSnapshot | null> {
    try {
        const raw = await readJsonFile<unknown>(getSnapshotPath(providerId));

        if (!isUsageSnapshot(raw)) {
            return null;
        }

        return raw;
    } catch {
        return null;
    }
}

function isUsageSnapshot(value: unknown): value is UsageSnapshot {
    if (!value || typeof value !== "object") {
        return false;
    }

    const snapshot = value as Record<string, unknown>;

    return (
        isFiniteNumber(snapshot.fetchedAt) &&
        typeof snapshot.planType === "string" &&
        Array.isArray(snapshot.quotas) &&
        snapshot.quotas.length > 0 &&
        snapshot.quotas.every(isUsageQuota)
    );
}

function isUsageQuota(value: unknown): boolean {
    if (!value || typeof value !== "object") {
        return false;
    }

    const quota = value as Record<string, unknown>;

    return (
        typeof quota.id === "string" &&
        quota.id.length > 0 &&
        typeof quota.label === "string" &&
        quota.label.length > 0 &&
        isFiniteNumber(quota.usedPercent) &&
        isOptionalFiniteNumber(quota.limitWindowSeconds) &&
        isOptionalFiniteNumber(quota.resetAfterSeconds) &&
        isOptionalFiniteNumber(quota.resetAt)
    );
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isOptionalFiniteNumber(value: unknown): boolean {
    return value === undefined || value === null || isFiniteNumber(value);
}
