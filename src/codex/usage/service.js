import GLib from "gi://GLib";
import { CACHE_DIR, STATE_DIR } from "../../io/paths.js";
import { DEFAULT_CREDENTIALS_PATH } from "../../preferences/settings.js";
import { getCodexCredentials, hasSameCodexAccount, resolveCredentialsPath } from "../auth/auth.js";
import { isCodexError } from "../error.js";
import { isCancellationError } from "../../io/files.js";
import { refreshCodexUsage } from "./api.js";
import { predict } from "./prediction.js";
import { toHistoryEntry } from "./model.js";
import {
    appendHistoryRow,
    hasSameQuotaValues,
    MAX_HISTORY_ENTRIES,
    normalizeHistoryEntry,
    readHistory,
    rewriteHistory,
} from "./history.js";
import { readSnapshot, SNAPSHOT_PATH, writeSnapshot } from "./snapshot.js";
import { importLegacyUsage } from "./legacy-usage.js";

// Keep the in-memory window in step with the JSONL reader's retention policy.
const MAX_HISTORY_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const HISTORY_COMPACTION_BATCH = 128;
const HISTORY_COMPACTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

export class UsageService {
    #history = null;
    #historyDirectory;
    #snapshotAccounts = new WeakMap();

    #legacyImportPromise = null;

    constructor(credentialsPath = DEFAULT_CREDENTIALS_PATH) {
        this.credentialsPath = resolveCredentialsPath(credentialsPath);
        this.snapshotPath = SNAPSHOT_PATH;
        this.#historyDirectory = GLib.build_filenamev([STATE_DIR, "codex"]);
        if (this.credentialsPath !== resolveCredentialsPath(DEFAULT_CREDENTIALS_PATH)) {
            const hash = GLib.compute_checksum_for_string(
                GLib.ChecksumType.SHA256,
                this.credentialsPath,
                -1,
            );
            this.snapshotPath = GLib.build_filenamev([CACHE_DIR, "codex", hash, "snapshot.json"]);
            this.#historyDirectory = GLib.build_filenamev([this.#historyDirectory, hash]);
        }
    }

    async readCachedSnapshot({ cancellable = null, credentials = null } = {}) {
        return this.#readCachedSnapshot(cancellable, credentials, { importLegacy: true });
    }

    async readStoredSnapshot({ cancellable = null } = {}) {
        return this.#readCachedSnapshot(cancellable, null, { importLegacy: false });
    }

    async #readCachedSnapshot(cancellable, credentials, { importLegacy }) {
        try {
            credentials ??= await getCodexCredentials(cancellable, this.credentialsPath);
            const fingerprint = credentials.accountFingerprint;
            if (!fingerprint) return null;
            if (importLegacy) await this.#importLegacyUsage(credentials, cancellable);
            const snapshot = await readSnapshot(cancellable, this.snapshotPath, fingerprint);
            if (!snapshot) return null;
            await getCodexCredentials(cancellable, this.credentialsPath, credentials);
            this.#snapshotAccounts.set(snapshot, credentials);
            return snapshot;
        } catch (error) {
            if (isCancellationError(error)) throw error;
            return null;
        }
    }

    async refresh({ cancellable = null, credentials = null } = {}) {
        cancellable?.set_error_if_cancelled();
        credentials ??= await getCodexCredentials(cancellable, this.credentialsPath);
        try {
            await this.#importLegacyUsage(credentials, cancellable);
        } catch (error) {
            if (
                isCancellationError(error) ||
                (isCodexError(error) &&
                    ["missing-auth", "credentials-changed"].includes(error.kind))
            )
                throw error;
            console.error("Unable to import legacy Codex usage", error);
        }
        const snapshot = await refreshCodexUsage({
            cancellable,
            credentials,
            credentialsPath: this.credentialsPath,
        });
        cancellable?.set_error_if_cancelled();

        try {
            await this.#appendSnapshotToHistory(snapshot, credentials, cancellable);
        } catch (error) {
            if (
                isCancellationError(error) ||
                (isCodexError(error) &&
                    ["missing-auth", "credentials-changed"].includes(error.kind))
            )
                throw error;
            console.error("Unable to append Codex usage history", error);
        }

        await getCodexCredentials(cancellable, this.credentialsPath, credentials);
        if (credentials.accountFingerprint) {
            try {
                await writeSnapshot(
                    snapshot,
                    cancellable,
                    this.snapshotPath,
                    credentials.accountFingerprint,
                );
            } catch (error) {
                if (isCancellationError(error)) throw error;
                console.error("Unable to write Codex usage snapshot cache", error);
            }
            await getCodexCredentials(cancellable, this.credentialsPath, credentials);
        }
        this.#snapshotAccounts.set(snapshot, credentials);
        return snapshot;
    }

    async readHistory({ cancellable = null, credentials = null } = {}) {
        try {
            credentials ??= await getCodexCredentials(cancellable, this.credentialsPath);
            const history = await this.#loadHistory(credentials, cancellable);
            await getCodexCredentials(cancellable, this.credentialsPath, credentials);
            return history.rows.slice(history.first);
        } catch (error) {
            if (isCancellationError(error)) throw error;
            return [];
        }
    }

    async #importLegacyUsage(credentials, cancellable) {
        if (
            !credentials.accountFingerprint ||
            GLib.canonicalize_filename(this.credentialsPath, null) !==
                GLib.canonicalize_filename(resolveCredentialsPath(DEFAULT_CREDENTIALS_PATH), null)
        )
            return;
        if (!this.#legacyImportPromise) {
            this.#legacyImportPromise = importLegacyUsage({
                credentialsPath: this.credentialsPath,
                credentials,

                historyPath: GLib.build_filenamev([
                    this.#historyDirectory,
                    credentials.accountFingerprint,
                    "usage-history.jsonl",
                ]),
                snapshotPath: this.snapshotPath,
                cancellable,
            }).catch((error) => {
                this.#legacyImportPromise = null;
                throw error;
            });
        }
        await this.#legacyImportPromise;
    }

    async #loadHistory(credentials, cancellable) {
        cancellable?.set_error_if_cancelled();
        await this.#importLegacyUsage(credentials, cancellable);
        if (!hasSameCodexAccount(this.#history?.credentials, credentials)) {
            const fingerprint = credentials.accountFingerprint;
            const path = fingerprint
                ? GLib.build_filenamev([this.#historyDirectory, fingerprint, "usage-history.jsonl"])
                : null;
            const history = {
                credentials,
                path,
                first: 0,
                discarded: 0,
                compactAfter: Infinity,
                rows: [],
            };
            this.#history = history;
            history.loaded = path
                ? readHistory(path, cancellable).then((rows) => {
                      history.rows = rows;
                  })
                : Promise.resolve();
        }
        const history = this.#history;
        try {
            await history.loaded;
        } catch (error) {
            if (this.#history === history) this.#history = null;
            throw error;
        }
        cancellable?.set_error_if_cancelled();
        this.#pruneHistory(history);
        return history;
    }

    #pruneHistory(history) {
        const now = Date.now();
        const minTimestamp = now - MAX_HISTORY_AGE_MS;
        const first = history.first;
        while (
            history.first < history.rows.length &&
            (history.rows.length - history.first > MAX_HISTORY_ENTRIES ||
                Date.parse(history.rows[history.first].timestamp) < minTimestamp)
        ) {
            history.first++;
        }
        if (history.first !== first) {
            if (!history.discarded) history.compactAfter = now + HISTORY_COMPACTION_INTERVAL_MS;
            history.discarded += history.first - first;
        }
        if (history.first >= HISTORY_COMPACTION_BATCH) {
            history.rows = history.rows.slice(history.first);
            history.first = 0;
        }
    }

    async #appendSnapshotToHistory(snapshot, credentials, cancellable) {
        const row = normalizeHistoryEntry(toHistoryEntry(snapshot));
        if (!row) return;
        const history = await this.#loadHistory(credentials, cancellable);
        await getCodexCredentials(cancellable, this.credentialsPath, credentials);
        if (this.#history !== history) return;

        const count = history.rows.length - history.first;
        const lastRow = count ? history.rows.at(-1) : null;
        const allExpired = !count && history.discarded > 0;
        // After a clock rollback, a full window may already contain only newer rows.
        const append =
            Date.parse(row.timestamp) >= Date.now() - MAX_HISTORY_AGE_MS &&
            (count < MAX_HISTORY_ENTRIES ||
                compareHistoryTimestamps(row, history.rows[history.first]) >= 0) &&
            (!lastRow || !hasSameQuotaValues(lastRow, row));
        if (append) {
            history.rows.push(row);
            if (lastRow && compareHistoryTimestamps(lastRow, row) > 0) {
                history.rows = history.rows.slice(history.first).sort(compareHistoryTimestamps);
                history.first = 0;
            }
            this.#pruneHistory(history);
        }
        if (!history.path) return;
        try {
            // Allow a small batch of expired rows on disk instead of rewriting on every rollover.
            if (
                allExpired ||
                history.discarded >= HISTORY_COMPACTION_BATCH ||
                Date.now() >= history.compactAfter
            ) {
                await rewriteHistory(history.rows.slice(history.first), history.path, cancellable);
                history.discarded = 0;
                history.compactAfter = Infinity;
            } else if (append) {
                await appendHistoryRow(row, history.path, cancellable);
            }
            cancellable?.set_error_if_cancelled();
        } catch (error) {
            // An interrupted write may have changed the file. Reload it on the next use.
            if (this.#history === history) this.#history = null;
            throw error;
        }
    }

    async predict(snapshot, { cancellable = null, credentials = null } = {}) {
        cancellable?.set_error_if_cancelled();
        credentials ??= await getCodexCredentials(cancellable, this.credentialsPath);
        const currentSnapshot =
            snapshot ?? (await this.readCachedSnapshot({ cancellable, credentials }));
        if (
            !currentSnapshot ||
            !hasSameCodexAccount(credentials, this.#snapshotAccounts.get(currentSnapshot))
        ) {
            throw new Error("No snapshot available for the current account");
        }
        const history = await this.#loadHistory(credentials, cancellable);
        await getCodexCredentials(cancellable, this.credentialsPath, credentials);
        return predict(history.rows.slice(history.first), currentSnapshot);
    }
}

function compareHistoryTimestamps(left, right) {
    return Date.parse(left.timestamp) - Date.parse(right.timestamp);
}
