import Gio from "gi://Gio";

import { predict, UsagePrediction } from "../domain/prediction.js";
import { UsageSnapshot, toHistoryEntry } from "../domain/usage.js";
import { getUsageProvider, UsageProvider } from "../infra/providers/index.js";
import { appendHistory, readHistory } from "../infra/storage/history.js";
import { readSnapshot, writeSnapshot } from "../infra/storage/snapshot-cache.js";

export type RefreshOptions = {
    cancellable?: Gio.Cancellable | null;
};

export class UsageService {
    private readonly provider: UsageProvider;

    constructor(provider: UsageProvider = getUsageProvider()) {
        this.provider = provider;
    }

    async readCachedSnapshot(): Promise<UsageSnapshot | null> {
        return await readSnapshot(this.provider.id);
    }

    async refresh(options: RefreshOptions = {}): Promise<UsageSnapshot> {
        const snapshot = await this.provider.refreshUsage({
            cancellable: options.cancellable ?? null,
        });

        try {
            await writeSnapshot(this.provider.id, snapshot);
        } catch (error) {
            console.error(`Unable to write ${this.provider.displayName} usage snapshot cache`, error);
        }

        try {
            await appendHistory(this.provider.id, toHistoryEntry(snapshot));
        } catch (error) {
            console.error(`Unable to append ${this.provider.displayName} usage history`, error);
        }

        return snapshot;
    }

    async predict(snapshot?: UsageSnapshot): Promise<UsagePrediction> {
        const currentSnapshot = snapshot ?? await readSnapshot(this.provider.id);

        if (!currentSnapshot) {
            throw new Error("No snapshot available");
        }

        const history = await readHistory(this.provider.id);
        return predict(history, currentSnapshot);
    }
}
