import GLib from "gi://GLib";

import {
    type CodexBankedResetCredit,
    type CodexBankedResetListResponse,
} from "../providers/codex_banked_resets.js";
import { CACHE_DIR } from "../config.js";
import { readJsonFile, writeJsonFile } from "../filesystem.js";

export type BankedResetSnapshot = CodexBankedResetListResponse & {
    fetchedAt: number;
};

function getBankedResetSnapshotPath() {
    return GLib.build_filenamev([CACHE_DIR, "codex", "banked-reset-snapshot.json"]);
}

export async function writeBankedResetSnapshot(
    response: CodexBankedResetListResponse,
): Promise<void> {
    await writeJsonFile(getBankedResetSnapshotPath(), {
        ...response,
        fetchedAt: Math.floor(Date.now() / 1000),
    });
}

export async function readBankedResetSnapshot(): Promise<BankedResetSnapshot | null> {
    try {
        const raw = await readJsonFile<unknown>(getBankedResetSnapshotPath());

        return toBankedResetSnapshot(raw);
    } catch {
        return null;
    }
}

function toBankedResetSnapshot(value: unknown): BankedResetSnapshot | null {
    if (!isBankedResetSnapshot(value)) {
        return null;
    }

    return value;
}

function isBankedResetSnapshot(value: unknown): value is BankedResetSnapshot {
    if (!isObject(value)) {
        return false;
    }

    return Number.isFinite(value.fetchedAt) &&
        Number.isFinite(value.available_count) &&
        Array.isArray(value.credits) &&
        value.credits.every(isBankedResetCredit);
}

function isBankedResetCredit(value: unknown): value is CodexBankedResetCredit {
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

function isOptionalString(value: unknown): boolean {
    return value === undefined || value === null || typeof value === "string";
}

function isObject(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
