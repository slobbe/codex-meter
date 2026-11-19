// Run with a GTK display, a temporary XDG_CACHE_HOME, and compiled schemas in GSETTINGS_SCHEMA_DIR.
// Set GSETTINGS_BACKEND=memory to avoid modifying desktop settings.
import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { UsageService } from "../src/codex/usage/service.js";
import { writeSnapshot } from "../src/codex/usage/snapshot.js";
import { createPreferencesPage } from "../src/preferences/page.js";
import {
    SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW,
    SETTINGS_CREDENTIALS_PATH,
} from "../src/preferences/settings.js";

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function findUsageWindow(widget) {
    if (widget instanceof Adw.ComboRow && widget.title === "Usage Window") return widget;
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
        const row = findUsageWindow(child);
        if (row) return row;
    }
    return null;
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

async function waitForSelection(row, label) {
    for (let i = 0; i < 80 && row.model.get_string(row.selected) !== label; i++) {
        await delay(25);
    }
    assert(row.model.get_string(row.selected) === label, `Expected selected window: ${label}`);
}

assert(GLib.getenv("GSETTINGS_BACKEND") === "memory", "Set GSETTINGS_BACKEND=memory");
assert(GLib.getenv("XDG_CACHE_HOME"), "Set XDG_CACHE_HOME to an empty temporary directory");
Adw.init();
const settings = new Gio.Settings({ schema_id: "org.gnome.shell.extensions.codex-meter" });
settings.set_string(SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW, "weekly");
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
    const row = findUsageWindow(page);
    assert(row !== null, "Usage Window row not found");
    assert(row.model.get_n_items() === 2, "Old options were not cleared");
    assert(row.model.get_string(row.selected) === "weekly (unavailable)", "Selection was lost");
    await delay(150);
    assert(!parent.query_exists(null), "Preferences must not create cache directories");
    await writeSnapshot(snapshot("First cache window"), null, service.snapshotPath);
    await waitForSelection(row, "First cache window");
    assert(
        settings.get_string(SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW) === "weekly",
        "Selection was written",
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
    const row = findUsageWindow(page);
    assert(row !== null, "Usage Window row not found");
    if (!startup) settings.set_string(SETTINGS_CREDENTIALS_PATH, path);
    await waitForSelection(row, "Stale cache window");

    // writeSnapshot replaces the cache atomically. Check more than one replacement.
    await writeSnapshot(snapshot("Live daily window", "daily"), null, service.snapshotPath);
    await waitForSelection(row, "weekly (unavailable)");
    assert(row.model.get_n_items() === 3, "Stale options were not removed");
    assert(row.model.get_string(1) === "Live daily window", "Live option was not added");
    await writeSnapshot(snapshot("Live weekly window"), null, service.snapshotPath);
    await waitForSelection(row, "Live weekly window");
    assert(row.model.get_n_items() === 2, "Daily option was not removed");
    assert(
        settings.get_string(SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW) === "weekly",
        "Selection was written",
    );
    window.emit("close-request");
    window.destroy();
    print(`ok - stale cache refreshed at ${startup ? "startup" : "credentials switch"}`);
}
