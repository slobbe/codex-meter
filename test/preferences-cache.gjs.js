// Run with a GTK display, a temporary XDG_CACHE_HOME, and compiled schemas in GSETTINGS_SCHEMA_DIR.
// Set GSETTINGS_BACKEND=memory to avoid modifying desktop settings.
import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { getCodexCredentials } from "../src/codex/auth/auth.js";
import { UsageService } from "../src/codex/usage/service.js";
import { writeSnapshot } from "../src/codex/usage/snapshot.js";
import { createPreferencesPage } from "../src/preferences/page.js";
import {
    readBankedResetSkipMinutes,
    SETTINGS_CREDENTIALS_PATH,
} from "../src/preferences/settings.js";

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function findSkipPeriods(widget) {
    if (widget instanceof Adw.ExpanderRow && widget.title === "Wait for scheduled reset") {
        return widget;
    }
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
        const row = findSkipPeriods(child);
        if (row) return row;
    }
    return null;
}

function skipControlTitles(widget) {
    if (widget instanceof Adw.SpinRow && widget.title?.endsWith(" (minutes)")) {
        return [widget.title];
    }
    const titles = [];
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
        titles.push(...skipControlTitles(child));
    }
    return titles;
}

function delay(ms) {
    return new Promise((resolve) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

function snapshot(label, id = "weekly") {
    return {
        fetchedAt: Date.now(),
        planType: "test",
        quotas: [{ id, label, usedPercent: 10 }],
    };
}

function writeAuth(path, accountId) {
    const claims = { "https://api.openai.com/auth": { chatgpt_account_id: accountId } };
    const payload = GLib.base64_encode(new TextEncoder().encode(JSON.stringify(claims)))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");
    Gio.File.new_for_path(path).replace_contents(
        new TextEncoder().encode(
            JSON.stringify({ tokens: { access_token: `test.${payload}.test` } }),
        ),
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
        null,
    );
}

async function prepareCache(name) {
    const path = GLib.build_filenamev([GLib.get_user_cache_dir(), `${name}-auth.json`]);
    writeAuth(path, name);
    const { accountFingerprint } = await getCodexCredentials(null, path);
    assert(accountFingerprint, "The fixture must produce an account fingerprint");
    const { snapshotPath } = new UsageService(path);
    return {
        path,
        snapshotPath,
        write: (data) => writeSnapshot(data, null, snapshotPath, accountFingerprint),
    };
}

async function waitForSkipControl(row, label) {
    const expected = JSON.stringify(label === null ? [] : [`${label} (minutes)`]);
    const matches = () => JSON.stringify(skipControlTitles(row)) === expected;
    for (let i = 0; i < 80 && !matches(); i++) {
        await delay(25);
    }
    assert(
        matches(),
        label === null ? "Expected no skip controls" : `Expected one skip control: ${label}`,
    );
}

assert(GLib.getenv("GSETTINGS_BACKEND") === "memory", "Set GSETTINGS_BACKEND=memory");
assert(GLib.getenv("XDG_CACHE_HOME"), "Set XDG_CACHE_HOME to an empty temporary directory");
Adw.init();
const settings = new Gio.Settings({ schema_id: "org.gnome.shell.extensions.codex-meter" });

for (const startup of [false, true]) {
    const { path, snapshotPath, write } = await prepareCache(startup ? "startup" : "switch");
    const parent = Gio.File.new_for_path(snapshotPath).get_parent();
    assert(!parent.query_exists(null), "The snapshot parent must not exist at setup");
    if (!startup) {
        assert(!parent.get_parent().query_exists(null), "The codex cache directory must be absent");
    }
    if (startup) settings.set_string(SETTINGS_CREDENTIALS_PATH, path);
    const window = new Adw.PreferencesWindow();
    const page = createPreferencesPage(
        settings,
        { name: "Codex Meter", "version-name": "test" },
        window,
    );
    window.add(page);
    if (!startup) settings.set_string(SETTINGS_CREDENTIALS_PATH, path);
    const row = findSkipPeriods(page);
    assert(row !== null, "Skip periods row not found");
    assert(skipControlTitles(row).length === 0, "Skip controls must wait for cached usage");
    await delay(150);
    assert(!parent.query_exists(null), "Preferences must not create cache directories");
    await write(snapshot("First cache window"));
    await waitForSkipControl(row, "First cache window");
    assert(
        Object.keys(readBankedResetSkipMinutes(settings)).length === 0,
        "Skip periods were written",
    );
    window.emit("close-request");
    window.destroy();
    print(`ok - first cache loaded at ${startup ? "startup" : "credentials switch"}`);
}

for (const startup of [false, true]) {
    const { path, write } = await prepareCache(startup ? "cached-startup" : "cached-switch");
    await write(snapshot("Stale cache window"));
    if (startup) settings.set_string(SETTINGS_CREDENTIALS_PATH, path);
    const window = new Adw.PreferencesWindow();
    const page = createPreferencesPage(
        settings,
        { name: "Codex Meter", "version-name": "test" },
        window,
    );
    window.add(page);
    const row = findSkipPeriods(page);
    assert(row !== null, "Skip periods row not found");
    if (!startup) settings.set_string(SETTINGS_CREDENTIALS_PATH, path);
    assert(skipControlTitles(row).length === 0, "Skip controls must wait for cached usage");
    await waitForSkipControl(row, "Stale cache window");

    // writeSnapshot replaces the cache atomically. Check more than one replacement.
    await write(snapshot("Live daily window", "daily"));
    await waitForSkipControl(row, "Live daily window");
    await write(snapshot("Live weekly window"));
    await waitForSkipControl(row, "Live weekly window");
    assert(
        Object.keys(readBankedResetSkipMinutes(settings)).length === 0,
        "Skip periods were written",
    );
    window.emit("close-request");
    window.destroy();
    print(`ok - stale cache refreshed at ${startup ? "startup" : "credentials switch"}`);
}

{
    const account = "auth-file-changes";
    const label = "Original account window";
    const { path, write } = await prepareCache(account);
    await write(snapshot(label));
    settings.set_string(SETTINGS_CREDENTIALS_PATH, path);
    const window = new Adw.PreferencesWindow();
    const page = createPreferencesPage(
        settings,
        { name: "Codex Meter", "version-name": "test" },
        window,
    );
    window.add(page);
    const row = findSkipPeriods(page);
    assert(row !== null, "Skip periods row not found");
    await waitForSkipControl(row, label);

    writeAuth(path, "replacement-account");
    await waitForSkipControl(row, null);
    writeAuth(path, account);
    await waitForSkipControl(row, label);

    Gio.File.new_for_path(path).delete(null);
    await waitForSkipControl(row, null);
    writeAuth(path, account);
    await waitForSkipControl(row, label);

    window.emit("close-request");
    window.destroy();
    print("ok - auth replacement, deletion, and recreation recheck the existing cache");
}
