import GLib from "gi://GLib";
import { CACHE_DIR } from "../../io/paths.js";
import { isCancellationError, readJsonFile, writeJsonFile } from "../../io/files.js";
import { toListResponse } from "./response.js";

function getBankedResetSnapshotPath() {
    return GLib.build_filenamev([CACHE_DIR, "codex", "banked-reset-snapshot.json"]);
}

export async function writeBankedResetSnapshot(response, cancellable = null) {
    await writeJsonFile(
        getBankedResetSnapshotPath(),
        {
            ...response,
            fetchedAt: Math.floor(Date.now() / 1000),
        },
        cancellable,
    );
}

export async function readBankedResetSnapshot(cancellable = null) {
    try {
        const raw = await readJsonFile(getBankedResetSnapshotPath(), cancellable);
        if (!isObject(raw) || !Number.isFinite(raw.fetchedAt)) {
            return null;
        }
        toListResponse(raw);
        return raw;
    } catch (error) {
        if (isCancellationError(error)) throw error;
        return null;
    }
}

function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
