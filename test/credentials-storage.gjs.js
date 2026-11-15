import Gio from "gi://Gio";
import GLib from "gi://GLib";

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
    const { readSnapshot, writeSnapshot } = await import("../src/codex/usage/snapshot.js");
    const { MAX_HISTORY_ENTRIES, readHistory } = await import("../src/codex/usage/history.js");
    const { DEFAULT_CREDENTIALS_PATH } = await import("../src/preferences/settings.js");
    const { resolveCredentialsPath, getCodexCredentials } =
        await import("../src/codex/auth/auth.js");
    const { writeFile, writeJsonFile } = await import("../src/io/files.js");

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

    const legacy = new UsageService();
    const resolvedDefault = new UsageService(resolveCredentialsPath(DEFAULT_CREDENTIALS_PATH));
    const first = new UsageService(GLib.build_filenamev([directory, "first-auth.json"]));
    const second = new UsageService(GLib.build_filenamev([directory, "second-auth.json"]));
    const services = [legacy, first, second];

    assertEqual(
        legacy.snapshotPath,
        GLib.build_filenamev([CACHE_DIR, "codex", "snapshot.json"]),
        "default snapshot should retain its legacy path",
    );
    assertEqual(
        legacy.historyPath,
        GLib.build_filenamev([STATE_DIR, "codex", "usage-history.jsonl"]),
        "default history should retain its legacy path",
    );
    assertEqual(
        resolvedDefault.snapshotPath,
        legacy.snapshotPath,
        "resolved default snapshot path",
    );
    assertEqual(resolvedDefault.historyPath, legacy.historyPath, "resolved default history path");

    for (const service of [first, second]) {
        const hash = GLib.compute_checksum_for_string(
            GLib.ChecksumType.SHA256,
            service.credentialsPath,
            -1,
        );
        assertEqual(
            service.snapshotPath,
            GLib.build_filenamev([CACHE_DIR, "codex", hash, "snapshot.json"]),
            "custom snapshot should use the resolved path hash",
        );
        assertEqual(
            service.historyPath,
            GLib.build_filenamev([STATE_DIR, "codex", hash, "usage-history.jsonl"]),
            "custom history should use the same hash",
        );
    }

    const snapshots = services.map((_, index) => ({
        fetchedAt: Math.floor(Date.now() / 1000),
        planType: `plan-${index}`,
        quotas: [{ id: `quota-${index}`, label: "Quota", usedPercent: 10 + index }],
    }));
    await writeSnapshot(snapshots[0]);
    await legacy.appendSnapshotToHistory(snapshots[0]);
    assertEqual(
        await first.readCachedSnapshot(),
        null,
        "custom cache must not fall back to default",
    );
    assertEqual(
        (await first.readHistory()).length,
        0,
        "custom history must not fall back to default",
    );

    for (const [index, service] of services.entries()) {
        if (index === 0) continue;
        await writeSnapshot(snapshots[index], null, service.snapshotPath);
        await service.appendSnapshotToHistory(snapshots[index]);
    }

    assertEqual((await readSnapshot()).planType, "plan-0", "legacy snapshot API stays compatible");
    assertEqual(
        (await readHistory())[0].quotas[0].id,
        "quota-0",
        "legacy history API stays compatible",
    );
    for (const [index, service] of services.entries()) {
        const reloaded = new UsageService(service.credentialsPath);
        assertEqual(
            (await reloaded.readCachedSnapshot()).planType,
            `plan-${index}`,
            "each service should read its own persisted snapshot",
        );
        assertEqual(
            (await reloaded.readHistory())[0].quotas[0].id,
            `quota-${index}`,
            "each service should read its own persisted history",
        );
        assertEqual(
            Object.keys((await reloaded.predict(null)).quotas).join(","),
            `quota-${index}`,
            "prediction fallback should use its own snapshot",
        );
    }

    // Exercise both service rewrite paths without allowing them to affect another file.
    const staleRow = {
        timestamp: new Date(Date.now() - 22 * 86_400_000).toISOString(),
        quotas: [{ id: "stale", usedPercent: 1 }],
    };
    first.history = [staleRow, ...(await first.readHistory())];
    await first.loadHistory();
    assertEqual(
        (await readHistory(first.historyPath)).length,
        1,
        "load should compact custom history",
    );

    first.history = Array.from({ length: MAX_HISTORY_ENTRIES }, (_, row) => ({
        timestamp: new Date().toISOString(),
        quotas: [{ id: "quota-1", usedPercent: row % 2 }],
    }));
    await first.appendSnapshotToHistory(snapshots[1]);
    assertEqual(
        (await readHistory(first.historyPath)).length,
        MAX_HISTORY_ENTRIES,
        "retention rewrite should use custom history path",
    );
    assertEqual(
        (await readHistory())[0].quotas[0].id,
        "quota-0",
        "default history stays untouched",
    );
    assertEqual(
        (await readHistory(second.historyPath))[0].quotas[0].id,
        "quota-2",
        "other custom history stays untouched",
    );

    print("ok - credentials storage isolation and default compatibility");
} finally {
    GLib.get_user_cache_dir = getCacheDir;
    GLib.get_user_state_dir = getStateDir;
    removeTree(Gio.File.new_for_path(directory));
}
