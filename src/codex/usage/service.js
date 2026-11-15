import GLib from "gi://GLib";
import { CACHE_DIR, STATE_DIR } from "../../io/paths.js";
import { DEFAULT_CREDENTIALS_PATH } from "../../preferences/settings.js";
import { resolveCredentialsPath } from "../auth/auth.js";
import { isCancellationError } from "../../io/files.js";
import { refreshCodexUsage } from "./api.js";
import { predict } from "./prediction.js";
import { toHistoryEntry } from "./model.js";
import {
    appendHistoryRow,
    HISTORY_PATH,
    hasSameQuotaValues,
    normalizeHistoryEntries,
    normalizeHistoryEntry,
    readHistory,
    rewriteHistory,
} from "./history.js";
import { readSnapshot, SNAPSHOT_PATH, writeSnapshot } from "./snapshot.js";

export class UsageService {
    history = null;

    constructor(credentialsPath = DEFAULT_CREDENTIALS_PATH) {
        this.credentialsPath = resolveCredentialsPath(credentialsPath);
        this.snapshotPath = SNAPSHOT_PATH;
        this.historyPath = HISTORY_PATH;
        if (this.credentialsPath !== resolveCredentialsPath(DEFAULT_CREDENTIALS_PATH)) {
            const hash = GLib.compute_checksum_for_string(
                GLib.ChecksumType.SHA256,
                this.credentialsPath,
                -1,
            );
            this.snapshotPath = GLib.build_filenamev([CACHE_DIR, "codex", hash, "snapshot.json"]);
            this.historyPath = GLib.build_filenamev([
                STATE_DIR,
                "codex",
                hash,
                "usage-history.jsonl",
            ]);
        }
    }

    async readCachedSnapshot({ cancellable = null } = {}) {
        return await readSnapshot(cancellable, this.snapshotPath);
    }

    async refresh({ cancellable = null } = {}) {
        cancellable?.set_error_if_cancelled();
        const snapshot = await refreshCodexUsage({
            cancellable,
            credentialsPath: this.credentialsPath,
        });
        cancellable?.set_error_if_cancelled();

        try {
            await writeSnapshot(snapshot, cancellable, this.snapshotPath);
        } catch (error) {
            if (isCancellationError(error)) throw error;
            console.error("Unable to write Codex usage snapshot cache", error);
        }

        cancellable?.set_error_if_cancelled();
        try {
            await this.appendSnapshotToHistory(snapshot, { cancellable });
        } catch (error) {
            if (isCancellationError(error)) throw error;
            console.error("Unable to append Codex usage history", error);
        }

        cancellable?.set_error_if_cancelled();
        return snapshot;
    }

    async readHistory({ cancellable = null } = {}) {
        return [...(await this.loadHistory({ cancellable }))];
    }

    async loadHistory({ cancellable = null } = {}) {
        cancellable?.set_error_if_cancelled();
        const history = this.history
            ? normalizeHistoryEntries(this.history)
            : await readHistory(this.historyPath, cancellable);
        if (this.history && history.length !== this.history.length) {
            await rewriteHistory(history, this.historyPath, cancellable);
        }
        cancellable?.set_error_if_cancelled();
        this.history = history;
        return this.history;
    }

    async appendSnapshotToHistory(snapshot, { cancellable = null } = {}) {
        const history = await this.loadHistory({ cancellable });
        cancellable?.set_error_if_cancelled();
        const row = normalizeHistoryEntry(toHistoryEntry(snapshot));
        if (!row) return;

        const lastRow = history.at(-1);
        if (lastRow && hasSameQuotaValues(lastRow, row)) return;

        const updatedHistory = normalizeHistoryEntries([...history, row]);
        try {
            if (updatedHistory.length !== history.length + 1) {
                await rewriteHistory(updatedHistory, this.historyPath, cancellable);
            } else {
                await appendHistoryRow(row, this.historyPath, cancellable);
            }
            cancellable?.set_error_if_cancelled();
            this.history = updatedHistory;
        } catch (error) {
            // A failed or cancelled write may already have changed the file.
            this.history = null;
            throw error;
        }
    }

    async predict(snapshot, { cancellable = null } = {}) {
        cancellable?.set_error_if_cancelled();
        const currentSnapshot = snapshot ?? (await this.readCachedSnapshot({ cancellable }));
        cancellable?.set_error_if_cancelled();
        if (!currentSnapshot) {
            throw new Error("No snapshot available");
        }

        const history = await this.readHistory({ cancellable });
        cancellable?.set_error_if_cancelled();
        return predict(history, currentSnapshot);
    }
}
