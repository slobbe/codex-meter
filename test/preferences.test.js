import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import {
    migrateSettings,
    readSettings,
    SETTINGS_AUTO_APPLY_BANKED_RESET,
    SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE,
    SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_THRESHOLD,
    SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW,
    SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES,
    SETTINGS_PERCENT_DISPLAY_MODE,
    SETTINGS_TOP_PANEL_DISPLAY_MODE,
    SETTINGS_TOP_PANEL_INDICATOR_ICON,
} from "../src/preferences/settings.js";

const pageUrl = new URL("../src/preferences/page.js", import.meta.url).href;
const prefsUrl = new URL("../src/prefs.js", import.meta.url).href;
const snapshotStubUrl = `data:text/javascript,${encodeURIComponent(`
    export const cache = { read: async () => null };
    export const readSnapshot = cancellable => cache.read(cancellable);
`)}`;
const { cache } = await import(snapshotStubUrl);
const stubUrl = `data:text/javascript,${encodeURIComponent(`
    export class Widget {
        constructor(options = {}) {
            Object.assign(this, options);
            if (options.adjustment) this.value = options.adjustment.value;
            this.children = [];
        }
        add(child) { this.children.push(child); }
        append(child) { this.add(child); }
        connect(signal, callback) { (this.signals ??= {})[signal] = callback; }
        emit(signal) { this.signals[signal](); }
        set_markup(markup) { this.markup = markup; }
        get model() { return this._model; }
        set model(value) {
            this._model = value;
            this.selected = 0;
            this.signals?.["notify::selected"]?.();
        }
    }
    export default {
        PreferencesPage: Widget, PreferencesGroup: Widget, SwitchRow: Widget,
        ComboRow: Widget, SpinRow: Widget, Adjustment: Widget, Box: Widget, Label: Widget,
        Cancellable: class {
            cancel() { this.cancelled = true; }
            is_cancelled() { return this.cancelled ?? false; }
        },
        StringList: { new: values => values },
        Orientation: { VERTICAL: 0 }, Justification: { CENTER: 0 },
        SettingsBindFlags: { DEFAULT: 0, GET: 1 }, Display: { get_default: () => null },
    };
    export class ExtensionPreferences {}
`)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (context.parentURL === prefsUrl && specifier === "./codex/usage/snapshot.js") {
            return { url: snapshotStubUrl, shortCircuit: true };
        }
        if (context.parentURL === prefsUrl && specifier.includes("banked-resets")) {
            throw new Error("Preferences must not import banked reset inventory APIs");
        }
        if (
            [pageUrl, prefsUrl].includes(context.parentURL) &&
            (specifier.startsWith("gi://") || specifier.startsWith("resource://"))
        ) {
            return { url: stubUrl, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});
let createPreferencesPage;
let CodexMeterPreferences;
try {
    ({ createPreferencesPage } = await import(pageUrl));
    ({ default: CodexMeterPreferences } = await import(prefsUrl));
} finally {
    hooks.deregister();
}

function settingsFixture(values = {}) {
    const strings = {
        "top-panel-indicator-icon": "codex",
        "top-panel-display-mode": "bars",
        "percent-display-mode": "left",
        [SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW]: "any",
        ...values,
    };
    const signals = new Map();
    let nextSignalId = 1;
    const uints = {
        [SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES]: 5,
        [SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_THRESHOLD]: 5,
        ...values,
    };
    const booleans = {
        [SETTINGS_AUTO_APPLY_BANKED_RESET]: false,
        [SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE]: false,
        ...values,
    };
    const bindings = [];
    function emit(signal) {
        for (const { key, row, property } of bindings) {
            if (signal === `changed::${key}`) row[property] = booleans[key];
        }
        for (const handler of signals.values()) {
            if (handler.signal === signal) {
                handler.callback();
            }
        }
    }
    return {
        signals,
        disconnected: [],
        bindings,
        writes: [],
        get_string: (key) => strings[key],
        set_string(key, value) {
            this.writes.push({ key, value });
            strings[key] = value;
            emit(`changed::${key}`);
        },
        get_uint: (key) => uints[key],
        set_uint(key, value) {
            this.writes.push({ key, value });
            uints[key] = value;
            emit(`changed::${key}`);
        },
        get_boolean: (key) => booleans[key],
        set_boolean(key, value) {
            this.writes.push({ key, value });
            booleans[key] = value;
            emit(`changed::${key}`);
        },
        connect(signal, callback) {
            const id = nextSignalId++;
            signals.set(id, { signal, callback });
            return id;
        },
        disconnect(id) {
            assert.ok(signals.delete(id), `Signal ${id} must still be connected`);
            this.disconnected.push(id);
        },
        bind(key, row, property, flags) {
            this.bindings.push({ key, row, property, flags });
            row[property] = booleans[key];
        },
    };
}
function windowFixture() {
    const signals = {};
    return {
        children: [],
        add(page) {
            this.children.push(page);
        },
        connect(signal, callback) {
            (signals[signal] ??= []).push(callback);
        },
        close() {
            return signals["close-request"].map((callback) => callback()).some(Boolean);
        },
    };
}
const metadata = { name: "Codex Meter", "version-name": "test", url: "https://example.com" };

test("icon dropdown reads, writes, and tracks all supported icon styles", () => {
    const icons = ["openai", "codex", "text"];
    for (const [index, icon] of icons.entries()) {
        const settings = settingsFixture({ [SETTINGS_TOP_PANEL_INDICATOR_ICON]: icon });
        const page = createPreferencesPage(settings, metadata, windowFixture());
        const group = page.children.find((child) => child.title === "Top panel indicator");
        const row = group.children.find((child) => child.title === "Icon");
        assert.deepEqual(row.model, ["OpenAI logo", "Codex logo", "'CX' monogram"]);
        assert.equal(row.selected, index);

        for (const [selected, value] of icons.entries()) {
            row.selected = selected;
            row.emit("notify::selected");
            assert.equal(settings.get_string(SETTINGS_TOP_PANEL_INDICATOR_ICON), value);
        }

        settings.set_string(SETTINGS_TOP_PANEL_INDICATOR_ICON, icon);
        assert.equal(row.selected, index);
    }
});

test("display dropdown reads, writes, and tracks all display modes in order", () => {
    const modes = ["bars", "circular-bars", "percentages"];
    for (const [index, mode] of modes.entries()) {
        const settings = settingsFixture({ [SETTINGS_TOP_PANEL_DISPLAY_MODE]: mode });
        const page = createPreferencesPage(settings, metadata, windowFixture());
        const group = page.children.find((child) => child.title === "Top panel indicator");
        const row = group.children.find((child) => child.title === "Show percentages as");
        assert.deepEqual(row.model, ["Progress bar", "Circular progress bars", "Number"]);
        assert.equal(row.selected, index);

        for (const [selected, value] of modes.entries()) {
            row.selected = selected;
            row.emit("notify::selected");
            assert.equal(settings.get_string(SETTINGS_TOP_PANEL_DISPLAY_MODE), value);
        }

        settings.set_string(SETTINGS_TOP_PANEL_DISPLAY_MODE, mode);
        assert.equal(row.selected, index);
    }
});

test("migration converts only legacy ring selections and is idempotent", () => {
    for (const [mode, expected] of [
        ["bars", "circular-bars"],
        ["percentages", "percentages"],
        ["circular-bars", "circular-bars"],
    ]) {
        const settings = settingsFixture({
            [SETTINGS_TOP_PANEL_INDICATOR_ICON]: "codex-ring",
            [SETTINGS_TOP_PANEL_DISPLAY_MODE]: mode,
        });
        migrateSettings(settings);
        assert.equal(settings.get_string(SETTINGS_TOP_PANEL_INDICATOR_ICON), "codex");
        assert.equal(settings.get_string(SETTINGS_TOP_PANEL_DISPLAY_MODE), expected);
        assert.equal(settings.writes.length, mode === "bars" ? 2 : 1);
        const writes = [...settings.writes];
        migrateSettings(settings);
        assert.deepEqual(settings.writes, writes);
    }
});

test("migration preserves defaults and all non-ring icon/display selections", () => {
    for (const icon of ["codex", "openai", "text", "icon"]) {
        for (const mode of ["bars", "circular-bars", "percentages"]) {
            const settings = settingsFixture({
                [SETTINGS_TOP_PANEL_INDICATOR_ICON]: icon,
                [SETTINGS_TOP_PANEL_DISPLAY_MODE]: mode,
            });
            const before = readSettings(settings);
            migrateSettings(settings);
            assert.deepEqual(readSettings(settings), before);
            assert.deepEqual(settings.writes, []);
        }
    }
    const defaults = settingsFixture();
    migrateSettings(defaults);
    assert.deepEqual(defaults.writes, []);
    assert.deepEqual(readSettings(defaults), {
        topPanelIndicatorIcon: "codex",
        topPanelDisplayMode: "bars",
        percentDisplayMode: "left",
        backgroundRefreshIntervalSeconds: 300,
        autoApplyBankedReset: false,
        autoApplyBankedResetOnUsage: false,
        autoApplyBankedResetUsageThreshold: 5,
        autoApplyBankedResetUsageWindow: "any",
    });
});

test("preferences migrates legacy selections before binding dropdowns", () => {
    for (const [mode, selected] of [
        ["bars", 1],
        ["percentages", 2],
        ["circular-bars", 1],
    ]) {
        const settings = settingsFixture({
            [SETTINGS_TOP_PANEL_INDICATOR_ICON]: "codex-ring",
            [SETTINGS_TOP_PANEL_DISPLAY_MODE]: mode,
        });
        const page = createPreferencesPage(settings, metadata, windowFixture());
        const group = page.children.find((child) => child.title === "Top panel indicator");
        assert.equal(group.children.find((child) => child.title === "Icon").selected, 1);
        assert.equal(
            group.children.find((child) => child.title === "Show percentages as").selected,
            selected,
        );
        assert.equal(settings.get_string(SETTINGS_TOP_PANEL_INDICATOR_ICON), "codex");
    }
});

test("readSettings preserves supported icons and legacy fallback behavior", () => {
    for (const [value, expected] of [
        ["codex", "codex"],
        ["codex-ring", "codex"],
        ["openai", "openai"],
        ["text", "text"],
        ["icon", "codex"],
        ["unknown", "text"],
    ]) {
        for (const mode of ["bars", "circular-bars", "percentages"]) {
            const settings = settingsFixture({
                [SETTINGS_TOP_PANEL_INDICATOR_ICON]: value,
                "top-panel-display-mode": mode,
            });
            const result = readSettings(settings);
            assert.equal(result.topPanelIndicatorIcon, expected);
            assert.equal(result.topPanelDisplayMode, mode);
            assert.deepEqual(settings.writes, []);
        }
    }
});

test("schema allows circular display and legacy icon migration, preserving defaults", () => {
    const schema = readFileSync(
        new URL(
            "../src/schemas/org.gnome.shell.extensions.codex-meter.gschema.xml",
            import.meta.url,
        ),
        "utf8",
    );
    const iconKey = schema.match(/<key name="top-panel-indicator-icon"[^>]*>([\s\S]*?)<\/key>/)[1];
    assert.deepEqual(
        [...iconKey.matchAll(/<choice value='([^']+)'\/>/g)].map((match) => match[1]),
        ["text", "codex", "codex-ring", "openai"],
    );
    assert.match(iconKey, /<default>'codex'<\/default>/);
    const displayKey = schema.match(/<key name="top-panel-display-mode"[^>]*>([\s\S]*?)<\/key>/)[1];
    assert.deepEqual(
        [...displayKey.matchAll(/<choice value='([^']+)'\/>/g)].map((match) => match[1]),
        ["percentages", "bars", "circular-bars"],
    );
    assert.match(displayKey, /<default>'bars'<\/default>/);
    assert.equal(readSettings(settingsFixture()).topPanelIndicatorIcon, "codex");
    assert.equal(readSettings(settingsFixture()).topPanelDisplayMode, "bars");
});

test("preferences banked resets group keeps expiry and usage toggles separate", () => {
    const settings = settingsFixture();
    const page = createPreferencesPage(settings, metadata, windowFixture());
    const group = page.children.find((child) => child.title === "Banked resets");
    assert.equal(group.children.length, 4);
    assert.deepEqual(
        group.children.slice(1).map((row) => row.title),
        ["Auto-redeem on low remaining usage", "Usage Window", "Threshold (% left)"],
    );
    assert.equal(group.children[0].title, "Auto-redeem expiring resets");
    assert.equal(
        group.children[0].subtitle,
        "Redeem a banked reset automatically within 1 hour of expiry",
    );
    assert.equal(settings.bindings.length, 4);
    assert.equal(settings.bindings[0].key, SETTINGS_AUTO_APPLY_BANKED_RESET);
    assert.equal(group.children[1].title, "Auto-redeem on low remaining usage");
    assert.equal(
        group.children[1].subtitle,
        "Redeem a reset if remaining usage falls below threshold",
    );
    assert.deepEqual(settings.bindings[1], {
        key: SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE,
        row: group.children[1],
        property: "active",
        flags: 0,
    });
    assert.deepEqual(settings.bindings[2], {
        key: SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE,
        row: group.children[2],
        property: "sensitive",
        flags: 1,
    });
    assert.deepEqual(settings.bindings[3], {
        key: SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE,
        row: group.children[3],
        property: "sensitive",
        flags: 1,
    });
    assert.equal(settings.bindings[0].row, group.children[0]);
    assert.equal(settings.bindings[0].property, "active");
});

test("usage auto-redemption settings preserve independent toggles and thresholds", () => {
    for (const threshold of [1, 5, 100]) {
        for (const enabled of [false, true]) {
            const settings = settingsFixture({
                [SETTINGS_AUTO_APPLY_BANKED_RESET]: !enabled,
                [SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE]: enabled,
                [SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_THRESHOLD]: threshold,
            });
            const result = readSettings(settings);
            assert.equal(result.autoApplyBankedReset, !enabled);
            assert.equal(result.autoApplyBankedResetOnUsage, enabled);
            assert.equal(result.autoApplyBankedResetUsageThreshold, threshold);
            assert.deepEqual(settings.writes, []);
        }
    }
});

test("usage auto-redemption schema is opt-in with a 1–100 threshold defaulting to 5", () => {
    const schema = readFileSync(
        new URL(
            "../src/schemas/org.gnome.shell.extensions.codex-meter.gschema.xml",
            import.meta.url,
        ),
        "utf8",
    );
    const toggle = schema.match(
        /<key name="auto-apply-banked-reset-on-usage" type="b">([\s\S]*?)<\/key>/,
    )[1];
    assert.match(toggle, /<default>false<\/default>/);
    const threshold = schema.match(
        /<key name="auto-apply-banked-reset-usage-threshold" type="u">([\s\S]*?)<\/key>/,
    )[1];
    assert.match(threshold, /<default>5<\/default>/);
    assert.match(threshold, /<range min="1" max="100"\/>/);
});

test("usage threshold reads, writes, tracks settings, and is sensitive only when enabled", () => {
    for (const enabled of [false, true]) {
        const settings = settingsFixture({ [SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE]: enabled });
        const window = windowFixture();
        const page = createPreferencesPage(settings, metadata, window);
        const [expiry, usage, , threshold] = page.children[2].children;
        assert.equal(threshold.title, "Threshold (% left)");
        assert.equal(threshold.subtitle, "Threshold below which to redeem reset");
        assert.equal(threshold.value, 5);
        assert.equal(threshold.adjustment.lower, 1);
        assert.equal(threshold.adjustment.upper, 100);
        assert.equal(threshold.adjustment.step_increment, 1);
        assert.equal(threshold.digits, 0);
        assert.equal(threshold.sensitive, enabled);
        settings.set_boolean(SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE, !enabled);
        assert.equal(usage.active, !enabled);
        assert.equal(threshold.sensitive, !enabled);
        assert.equal(expiry.active, false);
        settings.set_boolean(SETTINGS_AUTO_APPLY_BANKED_RESET, true);
        assert.equal(threshold.sensitive, !enabled);

        for (const value of [1, 80, 100]) {
            settings.set_uint(SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_THRESHOLD, value);
            assert.equal(threshold.value, value);
        }
        for (const [value, expected] of [
            [4.6, 5],
            [0, 1],
            [101, 100],
        ]) {
            threshold.value = value;
            threshold.emit("notify::value");
            assert.equal(
                settings.get_uint(SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_THRESHOLD),
                expected,
            );
            assert.equal(threshold.value, expected);
        }
        assert.equal(settings.get_uint(SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES), 5);
        window.close();
        assert.equal(settings.signals.size, 0);
        settings.set_uint(SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_THRESHOLD, 50);
        assert.equal(threshold.value, 100);
    }
});

test("usage window lists cached quotas in panel order and stores quota IDs", () => {
    const quotas = [
        { id: "weekly-id", label: "Ignored weekly label", limitWindowSeconds: 604800 },
        { id: "legacy-id", label: "Legacy window" },
        { id: "short-id", label: "Ignored short label", limitWindowSeconds: 18000 },
        { id: "other-short-id", label: "Same duration", limitWindowSeconds: 18000 },
        { id: "null-id", label: "Custom window", limitWindowSeconds: null },
    ];
    const settings = settingsFixture({
        [SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW]: "weekly-id",
    });
    const window = windowFixture();
    const page = createPreferencesPage(settings, metadata, window, { quotas });
    const [expiry, usage, row, threshold] = page.children[2].children;
    assert.equal(row.title, "Usage Window");
    assert.equal(row.subtitle, "Apply auto-redemption only to selected usage window");
    assert.deepEqual(row.model, [
        "Any",
        "5 hours",
        "5 hours",
        "Weekly",
        "Legacy window",
        "Custom window",
    ]);
    assert.equal(row.selected, 3);
    assert.deepEqual(settings.writes, []);
    assert.equal(row.sensitive, false);
    settings.set_boolean(SETTINGS_AUTO_APPLY_BANKED_RESET, true);
    assert.equal(row.sensitive, false);
    settings.set_boolean(SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE, true);
    assert.equal(row.sensitive, true);
    assert.equal(threshold.sensitive, true);
    assert.equal(usage.active, true);
    assert.equal(expiry.active, true);

    for (const [index, id] of [
        [0, "any"],
        [1, "short-id"],
        [2, "other-short-id"],
        [3, "weekly-id"],
        [4, "legacy-id"],
        [5, "null-id"],
    ]) {
        row.selected = index;
        row.emit("notify::selected");
        assert.equal(settings.get_string(SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW), id);
        assert.equal(row.selected, index);
    }
    settings.set_string(SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW, "short-id");
    assert.equal(row.selected, 1);
    window.close();
    settings.set_string(SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW, "weekly-id");
    assert.equal(row.selected, 1);
});

test("usage window preserves unavailable selections without writing a fallback", () => {
    for (const snapshot of [null, { quotas: [] }, { quotas: [{ id: "known", label: "Known" }] }]) {
        const settings = settingsFixture({
            [SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW]: "absent-id",
        });
        const page = createPreferencesPage(settings, metadata, windowFixture(), snapshot);
        const row = page.children[2].children[2];
        assert.equal(row.model[row.selected], "absent-id (unavailable)");
        assert.equal(
            settings.get_string(SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW),
            "absent-id",
        );
        assert.deepEqual(settings.writes, []);

        settings.set_string(SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW, "another-id");
        assert.equal(row.model[row.selected], "another-id (unavailable)");
        assert.ok(!row.model.includes("absent-id (unavailable)"));
        assert.deepEqual(settings.writes, [
            {
                key: SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW,
                value: "another-id",
            },
        ]);
        row.selected = 0;
        row.emit("notify::selected");
        assert.equal(settings.get_string(SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW), "any");
        assert.equal(row.selected, 0);
        assert.ok(!row.model.includes("another-id (unavailable)"));
    }
    const defaults = settingsFixture();
    const page = createPreferencesPage(defaults, metadata, windowFixture());
    assert.deepEqual(page.children[2].children[2].model, ["Any"]);
    assert.equal(page.children[2].children[2].selected, 0);
    assert.deepEqual(defaults.writes, []);
});

test("readSettings preserves the usage window quota ID", () => {
    for (const id of ["any", "short-id", "absent-id"]) {
        const settings = settingsFixture({ [SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW]: id });
        assert.equal(readSettings(settings).autoApplyBankedResetUsageWindow, id);
        assert.deepEqual(settings.writes, []);
    }
});

test("preferences entry point reads cached usage without loading inventory", async (t) => {
    let cancellable;
    cache.read = async (value) => {
        cancellable = value;
        return { quotas: [{ id: "cached-id", label: "Cached window" }] };
    };
    t.after(() => {
        cache.read = async () => null;
    });
    const prefs = new CodexMeterPreferences();
    const settings = settingsFixture();
    prefs.getSettings = () => settings;
    prefs.metadata = metadata;
    const window = windowFixture();
    await prefs.fillPreferencesWindow(window);
    const [page] = window.children;
    assert.equal(page.title, "Codex Meter");
    assert.deepEqual(page.children[2].children[2].model, ["Any", "Cached window"]);
    assert.equal(cancellable.is_cancelled(), false);
    assert.equal(page.children[3].children[0].children[0].label, "Codex Meter test");
    assert.equal(settings.signals.size, 6);
    assert.equal(window.close(), false);
    assert.equal(cancellable.is_cancelled(), true);
    assert.equal(settings.signals.size, 0);
});

test("preferences entry point tolerates an empty usage cache", async () => {
    const prefs = new CodexMeterPreferences();
    const settings = settingsFixture({
        [SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW]: "absent-id",
    });
    prefs.getSettings = () => settings;
    prefs.metadata = metadata;
    const window = windowFixture();
    await prefs.fillPreferencesWindow(window);
    const row = window.children[0].children[2].children[2];
    assert.deepEqual(row.model, ["Any", "absent-id (unavailable)"]);
    assert.equal(row.selected, 1);
    assert.deepEqual(settings.writes, []);
    assert.equal(window.close(), false);
    assert.equal(settings.signals.size, 0);
});

test("closing preferences cancels pending cache reads and prevents late page creation", async (t) => {
    t.after(() => {
        cache.read = async () => null;
    });
    for (const rejectOnClose of [false, true]) {
        let cancellable;
        let resolve;
        let reject;
        cache.read = (value) => {
            cancellable = value;
            return new Promise((onResolve, onReject) => {
                resolve = onResolve;
                reject = onReject;
            });
        };
        const prefs = new CodexMeterPreferences();
        const settings = settingsFixture();
        prefs.getSettings = () => settings;
        prefs.metadata = metadata;
        const window = windowFixture();
        const pending = prefs.fillPreferencesWindow(window);
        assert.deepEqual(window.children, []);
        assert.equal(cancellable.is_cancelled(), false);
        assert.equal(window.close(), false);
        assert.equal(cancellable.is_cancelled(), true);
        if (rejectOnClose) {
            reject(new Error("Cancelled"));
        } else {
            resolve({ quotas: [{ id: "late", label: "Late window" }] });
        }
        await pending;
        assert.deepEqual(window.children, []);
        assert.equal(settings.signals.size, 0);
        assert.deepEqual(settings.writes, []);
    }
});

test("closing preferences disconnects every settings callback without preventing close", () => {
    const settings = settingsFixture();
    const window = windowFixture();
    const page = createPreferencesPage(settings, metadata, window);
    const [percent, refresh] = page.children[0].children;
    const [icon, display] = page.children[1].children;
    const signalIds = [...settings.signals.keys()];
    assert.equal(signalIds.length, 6);

    settings.set_string(SETTINGS_PERCENT_DISPLAY_MODE, "used");
    settings.set_string(SETTINGS_TOP_PANEL_INDICATOR_ICON, "openai");
    settings.set_string(SETTINGS_TOP_PANEL_DISPLAY_MODE, "percentages");
    settings.set_uint(SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES, 10);
    assert.deepEqual(
        [percent.selected, icon.selected, display.selected, refresh.value],
        [0, 0, 2, 10],
    );

    refresh.value = 12.6;
    refresh.emit("notify::value");
    assert.equal(settings.get_uint(SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES), 13);
    assert.equal(refresh.value, 13);

    assert.equal(window.close(), false);
    assert.equal(settings.signals.size, 0);
    assert.deepEqual(settings.disconnected, signalIds);

    settings.set_string(SETTINGS_PERCENT_DISPLAY_MODE, "left");
    settings.set_string(SETTINGS_TOP_PANEL_INDICATOR_ICON, "text");
    settings.set_string(SETTINGS_TOP_PANEL_DISPLAY_MODE, "bars");
    settings.set_uint(SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES, 30);
    assert.deepEqual(
        [percent.selected, icon.selected, display.selected, refresh.value],
        [0, 0, 2, 13],
    );

    assert.equal(window.close(), false);
    assert.deepEqual(settings.disconnected, signalIds);
});

test("closing one window preserves other windows and reopening does not leak handlers", () => {
    const settings = settingsFixture();
    const firstWindow = windowFixture();
    const firstPage = createPreferencesPage(settings, metadata, firstWindow);
    const firstIcon = firstPage.children[1].children[0];

    for (let i = 0; i < 3; i++) {
        const window = windowFixture();
        const page = createPreferencesPage(settings, metadata, window);
        const icon = page.children[1].children[0];
        assert.equal(settings.signals.size, 12);
        settings.set_string(SETTINGS_TOP_PANEL_INDICATOR_ICON, "openai");
        assert.equal(firstIcon.selected, 0);
        assert.equal(icon.selected, 0);

        assert.equal(window.close(), false);
        assert.equal(settings.signals.size, 6);
        settings.set_string(SETTINGS_TOP_PANEL_INDICATOR_ICON, "text");
        assert.equal(firstIcon.selected, 2);
        assert.equal(icon.selected, 0);
    }

    assert.equal(firstWindow.close(), false);
    assert.equal(settings.signals.size, 0);
    assert.equal(settings.disconnected.length, 24);
});
