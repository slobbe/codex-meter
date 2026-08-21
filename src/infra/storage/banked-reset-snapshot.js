import GLib from "gi://GLib";
import { CACHE_DIR } from "../config.js";
import { readJsonFile, writeJsonFile } from "../filesystem.js";
function getBankedResetSnapshotPath() {
    return GLib.build_filenamev([CACHE_DIR, "codex", "banked-reset-snapshot.json"]);
}
export async function writeBankedResetSnapshot(response) {
    await writeJsonFile(getBankedResetSnapshotPath(), {
        ...response,
        fetchedAt: Math.floor(Date.now() / 1000),
    });
}
export async function readBankedResetSnapshot() {
    try {
        const raw = await readJsonFile(getBankedResetSnapshotPath());
        return toBankedResetSnapshot(raw);
    }
    catch {
        return null;
    }
}
function toBankedResetSnapshot(value) {
    if (!isBankedResetSnapshot(value)) {
        return null;
    }
    return value;
}
function isBankedResetSnapshot(value) {
    if (!isObject(value)) {
        return false;
    }
    return Number.isFinite(value.fetchedAt) &&
        Number.isFinite(value.available_count) &&
        Array.isArray(value.credits) &&
        value.credits.every(isBankedResetCredit);
}
function isBankedResetCredit(value) {
    if (!isObject(value)) {
        return false;
    }
    return typeof value.id === "string" &&
        value.id.trim().length > 0 &&
        typeof value.status === "string" &&
        [
            "reset_type",
            "granted_at",
            "expires_at",
            "profile_image_url",
            "profile_user_id",
            "title",
            "description",
        ].every((key) => isOptionalString(value[key]));
}
function isOptionalString(value) {
    return value === undefined || value === null || typeof value === "string";
}
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
