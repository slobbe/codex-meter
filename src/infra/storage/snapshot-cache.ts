import { getSnapshotPath } from "../paths.js";
import { UsageSnapshot } from "../../domain/usage.js";
import { readJsonFile, writeJsonFile } from "../filesystem.js";

export async function writeSnapshot(snapshot: UsageSnapshot): Promise<void> {
    await writeJsonFile(getSnapshotPath(), snapshot);
}

export async function readSnapshot(): Promise<UsageSnapshot | null> {
    try {
        const raw = await readJsonFile<unknown>(getSnapshotPath());

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
        isRateLimit(snapshot.rateLimit)
    );
}

function isRateLimit(value: unknown): boolean {
    if (!value || typeof value !== "object") {
        return false;
    }

    const rateLimit = value as Record<string, unknown>;

    return (
        typeof rateLimit.limitReached === "boolean" &&
        isUsageWindow(rateLimit.primary) &&
        isUsageWindow(rateLimit.secondary)
    );
}

function isUsageWindow(value: unknown): boolean {
    if (!value || typeof value !== "object") {
        return false;
    }

    const window = value as Record<string, unknown>;

    return (
        isFiniteNumber(window.usedPercent) &&
        isFiniteNumber(window.limitWindowSeconds) &&
        window.limitWindowSeconds > 0 &&
        isFiniteNumber(window.resetAfterSeconds) &&
        window.resetAfterSeconds >= 0 &&
        isFiniteNumber(window.resetAt)
    );
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}
