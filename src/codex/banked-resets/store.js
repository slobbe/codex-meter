import GLib from "gi://GLib";
import { CACHE_DIR } from "../../io/paths.js";
import { readJsonFile, writeJsonFile } from "../../io/files.js";
import { toListResponse } from "./response.js";

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
        if (!isObject(raw) || !Number.isFinite(raw.fetchedAt)) {
            return null;
        }
        toListResponse(raw);
        return raw;
    } catch {
        return null;
    }
}

function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
