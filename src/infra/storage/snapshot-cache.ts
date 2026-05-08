import { getSnapshotPath } from "../paths.js";
import { UsageSnapshot } from "../../domain/usage-snapshot.js";
import { readJsonFile, writeJsonFile } from "../filesystem.js";

export async function writeSnapshot(snapshot: UsageSnapshot): Promise<void> {
    await writeJsonFile(getSnapshotPath(), snapshot);
}

export async function readSnapshot(): Promise<UsageSnapshot | null> {
    const raw = await readJsonFile(getSnapshotPath());

    if (!raw || typeof raw !== "object") {
        return null;
    }

    return raw as UsageSnapshot;
}
