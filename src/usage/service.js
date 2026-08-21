import { refreshCodexUsage } from "../codex/usage.js";
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
} from "./history-store.js";
import { readSnapshot, writeSnapshot } from "./snapshot-store.js";

export class UsageService {
    history = null;

    async readCachedSnapshot() {
        return await readSnapshot();
    }

    async refresh(options = {}) {
        const snapshot = await refreshCodexUsage({
            cancellable: options.cancellable ?? null,
        });

        try {
            await writeSnapshot(snapshot);
        } catch (error) {
            console.error("Unable to write Codex usage snapshot cache", error);
        }

        try {
            await this.appendSnapshotToHistory(snapshot);
        } catch (error) {
            console.error("Unable to append Codex usage history", error);
        }

        return snapshot;
    }

    async readHistory() {
        return [...(await this.loadHistory())];
    }

    async loadHistory() {
        if (this.history) return this.history;

        this.history = await readHistory();
        return this.history;
    }

    async appendSnapshotToHistory(snapshot) {
        const history = await this.loadHistory();
        const row = normalizeHistoryEntry(toHistoryEntry(snapshot));
        if (!row) return;

        const lastRow = history.at(-1);
        if (lastRow && hasSameQuotaValues(lastRow, row)) return;

        await appendHistoryRow(row);
        history.push(row);

        if (history.length > MAX_HISTORY_ENTRIES) {
            this.history = normalizeHistoryEntries(history);
            await rewriteHistory(this.history);
        }
    }

    async predict(snapshot) {
        const currentSnapshot = snapshot ?? (await readSnapshot());
        if (!currentSnapshot) {
            throw new Error("No snapshot available");
        }

        const history = await this.readHistory();
        return predict(history, currentSnapshot);
    }
}
