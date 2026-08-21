import { predict } from "./prediction.js";
import { toHistoryEntry } from "./model.js";
import { getUsageProvider } from "./providers.js";
import { appendHistoryRow, hasSameQuotaValues, MAX_HISTORY_ENTRIES, normalizeHistoryEntries, normalizeHistoryEntry, readHistory, rewriteHistory, } from "./history-store.js";
import { readSnapshot, writeSnapshot } from "./snapshot-store.js";
export class UsageService {
    provider;
    history = null;
    constructor(provider = getUsageProvider()) {
        this.provider = provider;
    }
    async readCachedSnapshot() {
        return await readSnapshot(this.provider.info.id);
    }
    async refresh(options = {}) {
        const snapshot = await this.provider.refreshUsage({
            cancellable: options.cancellable ?? null,
        });
        try {
            await writeSnapshot(this.provider.info.id, snapshot);
        }
        catch (error) {
            console.error(`Unable to write ${this.provider.info.displayName} usage snapshot cache`, error);
        }
        try {
            await this.appendSnapshotToHistory(snapshot);
        }
        catch (error) {
            console.error(`Unable to append ${this.provider.info.displayName} usage history`, error);
        }
        return snapshot;
    }
    async readHistory() {
        return [...await this.loadHistory()];
    }
    async loadHistory() {
        if (this.history)
            return this.history;
        this.history = await readHistory(this.provider.info.id);
        return this.history;
    }
    async appendSnapshotToHistory(snapshot) {
        const history = await this.loadHistory();
        const row = normalizeHistoryEntry(toHistoryEntry(snapshot));
        if (!row)
            return;
        const lastRow = history.at(-1);
        if (lastRow && hasSameQuotaValues(lastRow, row))
            return;
        await appendHistoryRow(this.provider.info.id, row);
        history.push(row);
        if (history.length > MAX_HISTORY_ENTRIES) {
            this.history = normalizeHistoryEntries(history);
            await rewriteHistory(this.provider.info.id, this.history);
        }
    }
    async predict(snapshot) {
        const currentSnapshot = snapshot ?? await readSnapshot(this.provider.info.id);
        if (!currentSnapshot) {
            throw new Error("No snapshot available");
        }
        const history = await this.readHistory();
        return predict(history, currentSnapshot);
    }
}
