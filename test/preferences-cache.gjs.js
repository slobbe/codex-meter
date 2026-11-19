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
    await writeSnapshot(
        {
            fetchedAt: Date.now(),
            planType: "test",
            quotas: [{ id: "weekly", label: "First cache window", usedPercent: 10 }],
        },
        null,
        service.snapshotPath,
    );
    for (let i = 0; i < 40 && row.model.get_string(row.selected) !== "First cache window"; i++) {
        await delay(25);
    }
    assert(
        row.model.get_string(row.selected) === "First cache window",
        `First snapshot was not loaded at ${startup ? "startup" : "credentials switch"}`,
    );
    assert(
        settings.get_string(SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW) === "weekly",
        "Selection was written",
    );
    window.emit("close-request");
    window.destroy();
    print(`ok - first cache loaded at ${startup ? "startup" : "credentials switch"}`);
}
