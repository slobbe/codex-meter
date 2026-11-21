// Run with a GTK display, a temporary XDG_CACHE_HOME, and compiled schemas in GSETTINGS_SCHEMA_DIR.
// Set GSETTINGS_BACKEND=memory to avoid modifying desktop settings.
import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
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

async function waitForSkipControl(row, label) {
    const expected = JSON.stringify([`${label} (minutes)`]);
    const matches = () => JSON.stringify(skipControlTitles(row)) === expected;
    for (let i = 0; i < 80 && !matches(); i++) {
        await delay(25);
    }
    assert(matches(), `Expected one skip control: ${label}`);
}

assert(GLib.getenv("GSETTINGS_BACKEND") === "memory", "Set GSETTINGS_BACKEND=memory");
assert(GLib.getenv("XDG_CACHE_HOME"), "Set XDG_CACHE_HOME to an empty temporary directory");
Adw.init();
const settings = new Gio.Settings({ schema_id: "org.gnome.shell.extensions.codex-meter" });

for (const startup of [false, true]) {
    const path = startup ? "/test/startup/auth.json" : "/test/switch/auth.json";
    const service = new UsageService(path);
    const parent = Gio.File.new_for_path(service.snapshotPath).get_parent();
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
        startup ? null : { quotas: [{ id: "old", label: "Old window" }] },
    );
    window.add(page);
    if (!startup) settings.set_string(SETTINGS_CREDENTIALS_PATH, path);
    const row = findSkipPeriods(page);
    assert(row !== null, "Skip periods row not found");
    assert(skipControlTitles(row).length === 0, "Old controls were not cleared");
    await delay(150);
    assert(!parent.query_exists(null), "Preferences must not create cache directories");
    await writeSnapshot(snapshot("First cache window"), null, service.snapshotPath);
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
    const path = startup ? "/test/cached-startup/auth.json" : "/test/cached-switch/auth.json";
    const service = new UsageService(path);
    const stale = snapshot("Stale cache window");
    await writeSnapshot(stale, null, service.snapshotPath);
    if (startup) settings.set_string(SETTINGS_CREDENTIALS_PATH, path);
    const window = new Adw.PreferencesWindow();
    const page = createPreferencesPage(
        settings,
        { name: "Codex Meter", "version-name": "test" },
        window,
        startup ? stale : snapshot("Previous account window", "old"),
    );
    window.add(page);
    const row = findSkipPeriods(page);
    assert(row !== null, "Skip periods row not found");
    if (!startup) settings.set_string(SETTINGS_CREDENTIALS_PATH, path);
    await waitForSkipControl(row, "Stale cache window");

    // writeSnapshot replaces the cache atomically. Check more than one replacement.
    await writeSnapshot(snapshot("Live daily window", "daily"), null, service.snapshotPath);
    await waitForSkipControl(row, "Live daily window");
    await writeSnapshot(snapshot("Live weekly window"), null, service.snapshotPath);
    await waitForSkipControl(row, "Live weekly window");
    assert(
        Object.keys(readBankedResetSkipMinutes(settings)).length === 0,
        "Skip periods were written",
    );
    window.emit("close-request");
    window.destroy();
    print(`ok - stale cache refreshed at ${startup ? "startup" : "credentials switch"}`);
}
