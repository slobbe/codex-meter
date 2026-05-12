import { predict, UsagePrediction } from "../domain/prediction.js";
import { toHistoryEntry } from "../domain/usage-history.js";
import { UsageSnapshot } from "../domain/usage-snapshot.js";
import { fetchUsage } from "../infra/api/client.js";
import { toUsageSnapshot } from "../infra/api/mapper.js";
import { getAccessToken } from "../infra/auth/codex.js";
import { appendHistory, readHistory } from "../infra/storage/history.js";
import { readSnapshot, writeSnapshot } from "../infra/storage/snapshot-cache.js";

export class UsageService {
    async readCachedSnapshot(): Promise<UsageSnapshot | null> {
        return await readSnapshot();
    }

    async refresh(): Promise<UsageSnapshot> {
        const token = await getAccessToken();
        const apiResponse = await fetchUsage(token);
        const snapshot = toUsageSnapshot(apiResponse);

        await writeSnapshot(snapshot);
        await appendHistory(toHistoryEntry(snapshot));

        return snapshot;
    }

    async predict(snapshot?: UsageSnapshot): Promise<UsagePrediction> {
        const currentSnapshot = snapshot ?? await readSnapshot();

        if (!currentSnapshot) {
            throw new Error("No snapshot available");
        }

        const history = await readHistory();
        return predict(history, currentSnapshot);
    }
}
