import GLib from "gi://GLib";
import Gio from "gi://Gio";
import System from "system";

// GLib caches XDG paths during startup, so isolate the cache before starting GJS.
if (!ARGV.includes("--isolated-cache")) {
    const root = GLib.dir_make_tmp("codex-meter-banked-cache-XXXXXX");
    const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
    launcher.setenv("XDG_CACHE_HOME", root, true);
    try {
        const child = launcher.spawnv([
            "gjs",
            "-m",
            GLib.filename_from_uri(import.meta.url)[0],
            "--isolated-cache",
        ]);
        child.wait_check(null);
    } finally {
        Gio.File.new_for_path(root).delete(null);
    }
    System.exit(0);
}

const cacheRoot = GLib.get_user_cache_dir();
const { readBankedResetSnapshot } = await import("../src/codex/banked-resets/store.js");
const cacheDir = GLib.build_filenamev([cacheRoot, "codex-meter"]);
const snapshotDir = GLib.build_filenamev([cacheDir, "codex"]);
const snapshotPath = GLib.build_filenamev([snapshotDir, "banked-reset-snapshot.json"]);
GLib.mkdir_with_parents(snapshotDir, 0o700);

function assertDeepEqual(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(
            `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        );
    }
}

async function assertSnapshot(value, expected, message) {
    GLib.file_set_contents(snapshotPath, JSON.stringify(value));
    assertDeepEqual(await readBankedResetSnapshot(), expected, message);
}

const optionalCreditFields = [
    "reset_type",
    "granted_at",
    "expires_at",
    "profile_image_url",
    "profile_user_id",
    "title",
    "description",
];
const credit = { id: "credit-a", status: "available" };
const snapshot = { fetchedAt: 1783036800, available_count: 1, credits: [credit] };

try {
    assertDeepEqual(await readBankedResetSnapshot(), null, "missing cache returns null");
    await assertSnapshot(snapshot, snapshot, "valid cache is preserved including fetchedAt");
    const empty = { fetchedAt: 0, available_count: 0, credits: [] };
    await assertSnapshot(empty, empty, "empty cache is valid");

    for (const value of [null, "", "not necessarily a date or URL"]) {
        const valid = {
            ...snapshot,
            fetchedAt: -0.5,
            available_count: -0.5,
            credits: [
                { id: " credit-a ", status: "" },
                {
                    id: "credit-b",
                    status: "unknown-future-status",
                    ...Object.fromEntries(optionalCreditFields.map((key) => [key, value])),
                    extra: true,
                },
            ],
            extra: true,
        };
        await assertSnapshot(valid, valid, "nullable/string fields and extra fields are valid");
    }

    for (const value of [null, [], "snapshot", 1]) {
        await assertSnapshot(value, null, "non-object cache returns null");
    }
    for (const key of ["fetchedAt", "available_count"]) {
        for (const value of [undefined, null, "1", false, {}, []]) {
            await assertSnapshot({ ...snapshot, [key]: value }, null, `invalid ${key}`);
        }
        for (const value of ["1e400", "-1e400"]) {
            GLib.file_set_contents(
                snapshotPath,
                JSON.stringify(snapshot).replace(`"${key}":${snapshot[key]}`, `"${key}":${value}`),
            );
            assertDeepEqual(await readBankedResetSnapshot(), null, `non-finite ${key}`);
        }
    }
    for (const credits of [undefined, null, {}, "credits", 1]) {
        await assertSnapshot({ ...snapshot, credits }, null, "invalid credits array");
    }
    const invalidCredits = [
        null,
        [],
        "credit",
        1,
        ...[undefined, null, "", " \t ", 1].map((id) => ({ ...credit, id })),
        ...[undefined, null, 1, false, {}].map((status) => ({ ...credit, status })),
    ];
    for (const invalid of invalidCredits) {
        await assertSnapshot(
            { ...snapshot, credits: [credit, invalid] },
            null,
            "invalid credit after a valid credit",
        );
    }
    for (const key of optionalCreditFields) {
        for (const value of [1, false, [], {}]) {
            await assertSnapshot(
                { ...snapshot, credits: [{ ...credit, [key]: value }] },
                null,
                `invalid optional field ${key}`,
            );
        }
    }

    GLib.file_set_contents(snapshotPath, "{broken JSON");
    assertDeepEqual(await readBankedResetSnapshot(), null, "malformed JSON returns null");
    Gio.File.new_for_path(snapshotPath).delete(null);
    GLib.mkdir_with_parents(snapshotPath, 0o700);
    assertDeepEqual(await readBankedResetSnapshot(), null, "unreadable cache returns null");
} finally {
    for (const path of [snapshotPath, snapshotDir, cacheDir]) {
        const file = Gio.File.new_for_path(path);
        if (file.query_exists(null)) file.delete(null);
    }
}

print("Banked reset cache validation tests passed");
