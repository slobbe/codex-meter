import { toHistoryEntry } from "../domain/usage-history.js";
import { UsageSnapshot } from "../domain/usage-snapshot.js";
import { fetchUsage } from "../infra/api/client.js";
import { toUsageSnapshot } from "../infra/api/mapper.js";
import { getAccessToken } from "../infra/auth/codex.js";
import { appendHistory } from "../infra/storage/history.js";
import { writeSnapshot } from "../infra/storage/snapshot-cache.js";

export async function refreshUsage(): Promise<UsageSnapshot | null> {
    const token = await getAccessToken();

    if (!token) {
        return null;
    }

    const apiResponse = await fetchUsage(token);

    const snapshot = toUsageSnapshot(apiResponse);
    await writeSnapshot(snapshot);

    const historyRow = toHistoryEntry(snapshot);
    await appendHistory(historyRow);

    return snapshot;
}
