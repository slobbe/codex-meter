import GLib from "gi://GLib";
import { STATE_DIR } from "../../io/paths.js";
import { isNotFoundError, readJsonFile, writeJsonFile } from "../../io/files.js";
import { getCodexCredentials } from "../auth/auth.js";
import { HISTORY_PATH, readHistory, rewriteHistory } from "./history.js";
import { readSnapshot, SNAPSHOT_PATH, writeSnapshot } from "./snapshot.js";

const MIGRATION_PATH = GLib.build_filenamev([STATE_DIR, "codex", "legacy-import.json"]);

export async function importLegacyUsage({
    credentialsPath,
    credentials,
    historyPath,
    snapshotPath,
    cancellable,
}) {
    let migration;
    try {
        migration = await readJsonFile(MIGRATION_PATH, cancellable);
    } catch (error) {
        if (!isNotFoundError(error.cause)) throw error;
    }
    if (
        migration &&
        (migration.completed || migration.accountFingerprint !== credentials.accountFingerprint)
    )
        return;

    // v0.12 used only the default credentials file. Assign its history to that account once.
    const legacy = await readHistory(HISTORY_PATH, cancellable, false);
    const snapshot = await readSnapshot(cancellable, SNAPSHOT_PATH);
    if (!legacy.length && !snapshot) return;
    const current = await readHistory(historyPath, cancellable);
    const merged = new Map(legacy.map((row) => [row.timestamp, row]));
    for (const row of current) merged.set(row.timestamp, row);
    await getCodexCredentials(cancellable, credentialsPath, credentials);
    // Reserve the account before writing so an interrupted migration cannot be claimed by another account.
    const receipt = { accountFingerprint: credentials.accountFingerprint, completed: false };
    if (!migration) await writeJsonFile(MIGRATION_PATH, receipt, cancellable);
    await getCodexCredentials(cancellable, credentialsPath, credentials);
    await rewriteHistory([...merged.values()], historyPath, cancellable);

    const existing = await readSnapshot(cancellable, snapshotPath, credentials.accountFingerprint);
    if (!existing && snapshot) {
        await getCodexCredentials(cancellable, credentialsPath, credentials);
        await writeSnapshot(snapshot, cancellable, snapshotPath, credentials.accountFingerprint);
    }
    await getCodexCredentials(cancellable, credentialsPath, credentials);
    await writeJsonFile(MIGRATION_PATH, { ...receipt, completed: true }, cancellable);
}
