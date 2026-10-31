import { isCancellationError } from "../../io/files.js";
import { refreshCodexUsage } from "./api.js";
import { predict } from "./prediction.js";
import { toHistoryEntry } from "./model.js";
import {
    appendHistoryRow,
    hasSameQuotaValues,
    MAX_HISTORY_ENTRIES,
    normalizeHistoryEntries,
    normalizeHistoryEntry,
    readHistory,
    rewriteHistory,
} from "./history.js";
import { readSnapshot, writeSnapshot } from "./snapshot.js";

export class UsageService {
    history = null;

    async readCachedSnapshot({ cancellable = null } = {}) {
        return await readSnapshot(cancellable);
    }

    async refresh({ cancellable = null } = {}) {
        cancellable?.set_error_if_cancelled();
        const snapshot = await refreshCodexUsage({ cancellable });
        cancellable?.set_error_if_cancelled();

        try {
            await writeSnapshot(snapshot, cancellable);
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
        if (this.history) return this.history;

        const history = await readHistory(undefined, cancellable);
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

        await appendHistoryRow(row, undefined, cancellable);
        cancellable?.set_error_if_cancelled();
        history.push(row);

        if (history.length > MAX_HISTORY_ENTRIES) {
            this.history = normalizeHistoryEntries(history);
            await rewriteHistory(this.history, undefined, cancellable);
        }
    }

    async predict(snapshot, { cancellable = null } = {}) {
        cancellable?.set_error_if_cancelled();
        const currentSnapshot = snapshot ?? (await readSnapshot(cancellable));
        cancellable?.set_error_if_cancelled();
        if (!currentSnapshot) {
            throw new Error("No snapshot available");
        }

        const history = await this.readHistory({ cancellable });
        cancellable?.set_error_if_cancelled();
        return predict(history, currentSnapshot);
    }
}
