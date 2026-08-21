import GLib from "gi://GLib";
import { CACHE_DIR } from "../io/paths.js";
import { readJsonFile, writeJsonFile } from "../io/files.js";

const SNAPSHOT_PATH = GLib.build_filenamev([CACHE_DIR, "codex", "snapshot.json"]);

export async function writeSnapshot(snapshot) {
    await writeJsonFile(SNAPSHOT_PATH, snapshot);
}

export async function readSnapshot() {
    try {
        const raw = await readJsonFile(SNAPSHOT_PATH);
        if (!isUsageSnapshot(raw)) {
            return null;
        }
        return raw;
    } catch {
        return null;
    }
}

function isUsageSnapshot(value) {
    if (!value || typeof value !== "object") {
        return false;
    }
    const snapshot = value;
    return (
        isFiniteNumber(snapshot.fetchedAt) &&
        typeof snapshot.planType === "string" &&
        Array.isArray(snapshot.quotas) &&
        snapshot.quotas.length > 0 &&
        snapshot.quotas.every(isUsageQuota)
    );
}

function isUsageQuota(value) {
    if (!value || typeof value !== "object") {
        return false;
    }
    const quota = value;
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

function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}

function isOptionalFiniteNumber(value) {
    return value === undefined || value === null || isFiniteNumber(value);
}
