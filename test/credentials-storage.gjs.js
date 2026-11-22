import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup";

const directory = GLib.dir_make_tmp("codex-meter-credentials-storage-XXXXXX");
// GJS may cache GLib's user directories before this module starts.
const getCacheDir = GLib.get_user_cache_dir;
const getStateDir = GLib.get_user_state_dir;
GLib.get_user_cache_dir = () => GLib.build_filenamev([directory, "cache"]);
GLib.get_user_state_dir = () => GLib.build_filenamev([directory, "state"]);

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
    }
}

function removeTree(file) {
    if (
        file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) ===
        Gio.FileType.DIRECTORY
    ) {
        const children = file.enumerate_children(
            "standard::name",
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            null,
        );
        try {
            let child;
            while ((child = children.next_file(null))) {
                removeTree(file.get_child(child.get_name()));
            }
        } finally {
            children.close(null);
        }
    }
    file.delete(null);
}

try {
    const { UsageService } = await import("../src/codex/usage/service.js");
    const { CodexMonitor } = await import("../src/background/monitor.js");
    const { writeSnapshot } = await import("../src/codex/usage/snapshot.js");
    const { appendHistoryRow, MAX_HISTORY_ENTRIES, rewriteHistory } =
        await import("../src/codex/usage/history.js");
    const { DEFAULT_CREDENTIALS_PATH } = await import("../src/preferences/settings.js");
    const { resolveCredentialsPath, getCodexCredentials } =
        await import("../src/codex/auth/auth.js");
    const { readFile, writeFile, writeJsonFile } = await import("../src/io/files.js");

    async function assertCredentialsError(path, problem, privateContent = "private-token") {
        let caught;
        try {
            await getCodexCredentials(null, path);
        } catch (error) {
            caught = error;
        }
        assertEqual(caught?.kind, "missing-auth", "invalid credentials error kind");
        assertEqual(
            caught.message,
            `${problem} Select a valid Codex credentials file in Preferences or sign in again.`,
            "actionable credentials error",
        );
        for (const text of [caught.message, caught.technicalMessage, String(caught)]) {
            assertEqual(text.includes(privateContent), false, "error must not expose credentials");
        }
    }

    assertEqual(
        resolveCredentialsPath(),
        GLib.build_filenamev([GLib.get_home_dir(), ".codex", "auth.json"]),
        "default credentials resolve to the home directory",
    );
    assertEqual(
        resolveCredentialsPath("~/custom/auth.json"),
        GLib.build_filenamev([GLib.get_home_dir(), "custom", "auth.json"]),
        "custom home-relative credentials resolve to the home directory",
    );
    const authPath = GLib.build_filenamev([directory, "custom-auth.json"]);
    await writeJsonFile(authPath, {
        tokens: { access_token: " \tfake-token\n", account_id: " fake-account " },
    });
    const credentials = await getCodexCredentials(null, authPath);
    assertEqual(credentials.accessToken, "fake-token", "custom credentials token");
    assertEqual(credentials.accountId, "fake-account", "custom credentials account");
    const missingPath = GLib.build_filenamev([directory, "missing-auth.json"]);
    await assertCredentialsError(missingPath, "Codex auth file is missing.");
    await assertCredentialsError(directory, "Codex auth file could not be read.");

    for (const text of ["{", '{"tokens":{"access_token":"private-token"},', "private-token"]) {
        await writeFile(authPath, text);
        await assertCredentialsError(authPath, "Codex auth file contains invalid JSON.");
    }
    for (const data of [null, [], "private-token", 42, true]) {
        await writeJsonFile(authPath, data);
        await assertCredentialsError(authPath, "Codex auth file must contain a JSON object.");
    }
    for (const data of [
        {},
        { tokens: null },
        { tokens: "private-token" },
        { tokens: {} },
        ...[
            null,
            "",
            " \t\n",
            42,
            true,
            {},
            [],
            "private-token other",
            "private-token\tother",
            "private-token\nother",
        ].map((access_token) => ({ tokens: { access_token } })),
    ]) {
        await writeJsonFile(authPath, data);
        await assertCredentialsError(authPath, "Codex access token is missing or invalid.");
    }
    for (const account_id of [undefined, null, "", " \t", 42]) {
        await writeJsonFile(authPath, {
            tokens: { access_token: " \tfake-token\n", account_id },
        });
        const optionalAccount = await getCodexCredentials(null, authPath);
        assertEqual(optionalAccount.accessToken, "fake-token", "valid token is trimmed");
        assertEqual(optionalAccount.accountId, null, "account ID is optional");
    }
    print("ok - local credentials validation and safe actionable errors");
    const { CACHE_DIR, STATE_DIR } = await import("../src/io/paths.js");
    const defaults = new UsageService();
    assertEqual(
        defaults.snapshotPath,
        GLib.build_filenamev([CACHE_DIR, "codex", "snapshot.json"]),
        "default snapshot keeps its stable location",
    );
    assertEqual(
        new UsageService(resolveCredentialsPath(DEFAULT_CREDENTIALS_PATH)).snapshotPath,
        defaults.snapshotPath,
        "resolved default uses the same location",
    );

    async function writeCredentials(path, account, signature = "first") {
        const claims = JSON.stringify({
            sub: "test-user",
            "https://api.openai.com/auth": { chatgpt_account_id: account },
        });
        const payload = GLib.base64_encode(new TextEncoder().encode(claims))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
        await writeJsonFile(path, { tokens: { access_token: `mock.${payload}.${signature}` } });
        return await getCodexCredentials(null, path);
    }

    const service = new UsageService(authPath);
    const pathHash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, authPath, -1);
    const snapshotPath = GLib.build_filenamev([CACHE_DIR, "codex", pathHash, "snapshot.json"]);
    const historyDirectory = GLib.build_filenamev([STATE_DIR, "codex", pathHash]);
    assertEqual(service.snapshotPath, snapshotPath, "custom snapshot keeps its stable location");

    const sent = Soup.Session.prototype.send_async;
    const load = Gio.File.prototype.load_contents_async;
    const open = Gio.File.prototype.read_async;
    const replace = Gio.File.prototype.replace_contents_async;
    let usedPercent = 10;
    let planType = "account-a-plan";
    let afterSend = null;
    const now = Date.now;
    Soup.Session.prototype.send_async = async function (message) {
        await afterSend?.(message);
        Object.defineProperty(message, "statusCode", { value: 200 });
        const text = JSON.stringify({
            plan_type: planType,
            rate_limit: {
                limit_reached: false,
                primary_window: {
                    used_percent: usedPercent,
                    limit_window_seconds: 18_000,
                    reset_after_seconds: 9_000,
                    reset_at: Math.floor(Date.now() / 1000) + 9_000,
                },
            },
        });
        return Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(new TextEncoder().encode(text)));
    };
    try {
        const accountA = await writeCredentials(authPath, "account-a");
        const legacy = {
            fetchedAt: Math.floor(now() / 1000),
            planType: "legacy",
            quotas: [{ id: "legacy", label: "Legacy", usedPercent: 10 }],
        };
        const row = { timestamp: new Date().toISOString(), quotas: legacy.quotas };
        const legacyHistoryPath = GLib.build_filenamev([historyDirectory, "usage-history.jsonl"]);
        await writeSnapshot(legacy, null, service.snapshotPath);
        await rewriteHistory([row], legacyHistoryPath);
        assertEqual(await service.readCachedSnapshot(), null, "unscoped snapshot is not trusted");
        assertEqual((await service.readHistory()).length, 0, "unscoped history is not adopted");

        const snapshotA = await service.refresh();
        const reloaded = new UsageService(authPath);
        assertEqual(
            (await reloaded.readCachedSnapshot()).planType,
            planType,
            "verified snapshot survives restart",
        );
        assertEqual(
            (await reloaded.readHistory())[0].quotas[0].usedPercent,
            10,
            "verified history survives restart",
        );
        assertEqual(
            Object.keys((await reloaded.predict(null)).quotas).length,
            1,
            "prediction can use verified cache",
        );
        const rotated = await writeCredentials(authPath, "account-a", "rotated");
        assertEqual(
            rotated.accountFingerprint,
            accountA.accountFingerprint,
            "fingerprint is independent of the token",
        );
        assertEqual(
            (await service.readCachedSnapshot()).planType,
            planType,
            "same account after token refresh",
        );
        const stored = await readFile(snapshotPath);
        assertEqual(
            stored.includes(accountA.accessToken),
            false,
            "snapshot does not contain the token",
        );
        const historyPath = GLib.build_filenamev([
            historyDirectory,
            accountA.accountFingerprint,
            "usage-history.jsonl",
        ]);
        const historyA = await readFile(historyPath);
        assertEqual(
            historyA.includes(accountA.accessToken),
            false,
            "history does not contain the token",
        );

        Gio.File.prototype.load_contents_async = async function (...args) {
            const result = await load.apply(this, args);
            if (this.get_path() === snapshotPath) await writeCredentials(authPath, "account-b");
            return result;
        };
        try {
            assertEqual(
                await service.readCachedSnapshot(),
                null,
                "auth replacement during cache read rejects old data",
            );
        } finally {
            Gio.File.prototype.load_contents_async = load;
        }
        assertEqual(
            (await service.readHistory()).length,
            0,
            "replacement account cannot see old history",
        );
        let predictionError;
        try {
            await service.predict(snapshotA);
        } catch (error) {
            predictionError = error;
        }
        assertEqual(Boolean(predictionError), true, "prediction cannot combine accounts");
        usedPercent = 20;
        planType = "account-b-plan";
        await service.refresh();
        assertEqual(
            (await service.readHistory())[0].quotas[0].usedPercent,
            20,
            "replacement uses its own history",
        );

        await writeCredentials(authPath, "account-a");
        assertEqual(
            await service.readCachedSnapshot(),
            null,
            "latest cache for another account is not displayed",
        );
        assertEqual(
            await readFile(historyPath),
            historyA,
            "the other account never writes to the first history",
        );
        assertEqual(
            (await service.readHistory())[0].quotas[0].usedPercent,
            10,
            "returning to the first account restores its history",
        );
        afterSend = () => writeCredentials(authPath, "account-b");
        let refreshError;
        try {
            await service.refresh();
        } catch (error) {
            refreshError = error;
        } finally {
            afterSend = null;
        }
        assertEqual(
            refreshError?.kind,
            "credentials-changed",
            "credential change aborts the usage refresh",
        );
        assertEqual(
            await readFile(historyPath),
            historyA,
            "in-flight result does not append a stale row",
        );
        assertEqual(
            (await service.readCachedSnapshot()).planType,
            "account-b-plan",
            "in-flight result does not replace the latest cache",
        );

        await writeCredentials(authPath, "account-a");
        Gio.File.prototype.read_async = async function (...args) {
            if (this.get_path() === historyPath) await writeCredentials(authPath, "account-b");
            return open.apply(this, args);
        };
        refreshError = null;
        try {
            await new UsageService(authPath).refresh();
        } catch (error) {
            refreshError = error;
        } finally {
            Gio.File.prototype.read_async = open;
        }
        assertEqual(
            refreshError?.kind,
            "credentials-changed",
            "switch during history load aborts append",
        );
        assertEqual(
            await readFile(historyPath),
            historyA,
            "history is unchanged after the late switch",
        );
        assertEqual(
            (await service.readCachedSnapshot())?.planType,
            "account-b-plan",
            "late switch does not replace the cache",
        );

        const settings = {
            connect() {},
            disconnect() {},
            get_boolean: () => false,
            get_string: () => "",
            get_uint: () => 0,
            get_value: () => ({ deep_unpack: () => ({}) }),
        };
        const monitor = new CodexMonitor(settings, () => {}, authPath);
        let timer = null;
        try {
            await new Promise((resolve) => {
                monitor._usageRefreshTask.start = resolve;
                monitor.start();
            });
            assertEqual(
                monitor.state.snapshot?.planType,
                "account-b-plan",
                "monitor loads verified usage",
            );
            const cleared = new Promise((resolve, reject) => {
                timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                    timer = null;
                    reject(new Error("The monitor did not clear usage after auth replacement"));
                    return GLib.SOURCE_REMOVE;
                });
                monitor.onChange = ({ snapshot }) => {
                    if (!snapshot) resolve();
                };
            });
            await writeCredentials(authPath, "account-a");
            await cleared;
            assertEqual(monitor.state.history.length, 0, "monitor clears previous account history");
            assertEqual(
                monitor.state.prediction,
                null,
                "monitor clears previous account prediction",
            );
        } finally {
            if (timer !== null) GLib.source_remove(timer);
            monitor.stop();
        }

        await writeJsonFile(authPath, {
            tokens: { access_token: "legacy-token", account_id: "account-b" },
        });
        const beforeOpaqueRefresh = await readFile(snapshotPath);
        await service.refresh();
        assertEqual(
            await service.readCachedSnapshot(),
            null,
            "an opaque token cannot unlock account cache",
        );
        assertEqual(
            (await service.readHistory()).length,
            1,
            "an unchanged legacy credential can use live history",
        );
        assertEqual(
            await readFile(snapshotPath),
            beforeOpaqueRefresh,
            "legacy tokens never write a snapshot cache",
        );
        await writeJsonFile(authPath, {
            tokens: { access_token: "changed-token", account_id: "account-b" },
        });
        assertEqual(
            (await service.readHistory()).length,
            0,
            "a changed legacy token cannot unlock live history",
        );
        print("ok - verified account storage isolation and stable snapshot paths");

        // Seed a full file to exercise rollover without issuing thousands of requests.
        await writeCredentials(authPath, "account-a");
        const day = 86_400_000;
        const aged = { ...row, timestamp: new Date(now() - 29.5 * day).toISOString() };
        const recent = { ...row, timestamp: new Date(now() - 60_000).toISOString() };
        const seed = [...Array(128).fill(aged), ...Array(MAX_HISTORY_ENTRIES - 128).fill(recent)];
        await rewriteHistory(seed, historyPath);
        const retained = new UsageService(authPath);
        let historyReads = 0;
        let historyRewrites = 0;
        Gio.File.prototype.read_async = async function (...args) {
            const stream = await open.apply(this, args);
            if (this.get_path() === historyPath) {
                const read = stream.read_bytes_async.bind(stream);
                let counted = false;
                stream.read_bytes_async = (size, ...options) => {
                    // The append path reads only the final byte to check for a newline.
                    if (!counted && size > 1) {
                        historyReads++;
                        counted = true;
                    }
                    return read(size, ...options);
                };
            }
            return stream;
        };
        Gio.File.prototype.replace_contents_async = function (...args) {
            if (this.get_path() === historyPath) historyRewrites++;
            return replace.apply(this, args);
        };
        for (usedPercent of [21, 22, 23]) await retained.refresh();
        assertEqual(historyReads, 1, "refreshes reuse the loaded rows");
        assertEqual(historyRewrites, 0, "full history does not rewrite after every change");
        assertEqual(
            (await retained.readHistory()).length,
            MAX_HISTORY_ENTRIES,
            "in-memory history stays bounded",
        );
        Date.now = () => now() + day;
        usedPercent = 24;
        await retained.refresh();
        assertEqual(historyRewrites, 1, "expired rows compact in a batch");
        const compacted = (await readFile(historyPath)).trim().split("\n");
        assertEqual(
            compacted.length,
            MAX_HISTORY_ENTRIES - 128 + 4,
            "compaction retains only recent rows",
        );
        assertEqual(
            JSON.parse(compacted.at(-1)).quotas[0].usedPercent,
            usedPercent,
            "compaction persists the latest row",
        );
        print("ok - bounded batched history compaction");

        // At capacity, a sample older than the retained range must stay off disk.
        Date.now = () => now() - 2 * 60_000;
        await rewriteHistory(Array(MAX_HISTORY_ENTRIES).fill(recent), historyPath);
        const beforeRollback = await readFile(historyPath);
        usedPercent = 25;
        await new UsageService(authPath).refresh();
        assertEqual(
            (await readFile(historyPath)) === beforeRollback,
            true,
            "a pruned rollback sample is not appended",
        );
        // An older version could already have appended an out-of-order row to this file.
        await appendHistoryRow(
            { ...row, timestamp: new Date(Date.now()).toISOString() },
            historyPath,
        );
        const afterRestart = await new UsageService(authPath).readHistory();
        assertEqual(afterRestart.length, MAX_HISTORY_ENTRIES, "restart retains the full window");
        assertEqual(afterRestart[0].timestamp, recent.timestamp, "restart keeps the newer samples");
        print("ok - clock rollback preserves full history across restart");
    } finally {
        Date.now = now;
        Soup.Session.prototype.send_async = sent;
        Gio.File.prototype.load_contents_async = load;
        Gio.File.prototype.read_async = open;
        Gio.File.prototype.replace_contents_async = replace;
    }
} finally {
    GLib.get_user_cache_dir = getCacheDir;
    GLib.get_user_state_dir = getStateDir;
    removeTree(Gio.File.new_for_path(directory));
}
