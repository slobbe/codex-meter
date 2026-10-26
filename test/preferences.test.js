import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { readSettings, SETTINGS_TOP_PANEL_INDICATOR_ICON } from "../src/preferences/settings.js";

const pageUrl = new URL("../src/preferences/page.js", import.meta.url).href;
const prefsUrl = new URL("../src/prefs.js", import.meta.url).href;
const stubUrl = `data:text/javascript,${encodeURIComponent(`
    export class Widget {
        constructor(options = {}) { Object.assign(this, options); this.children = []; }
        add(child) { this.children.push(child); }
        append(child) { this.add(child); }
        connect(signal, callback) { (this.signals ??= {})[signal] = callback; }
        emit(signal) { this.signals[signal](); }
        set_markup(markup) { this.markup = markup; }
    }
    export default {
        PreferencesPage: Widget, PreferencesGroup: Widget, SwitchRow: Widget,
        ComboRow: Widget, SpinRow: Widget, Adjustment: Widget, Box: Widget, Label: Widget,
        StringList: { new: values => values },
        Orientation: { VERTICAL: 0 }, Justification: { CENTER: 0 },
        SettingsBindFlags: { DEFAULT: 0 }, Display: { get_default: () => null },
    };
    export class ExtensionPreferences {}
`)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
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
        ...values,
    };
    const signals = {};
    return {
        bindings: [],
        get_string: (key) => strings[key],
        set_string(key, value) {
            strings[key] = value;
            signals[`changed::${key}`]?.();
        },
        get_uint: () => 5,
        get_boolean: () => false,
        connect(signal, callback) {
            signals[signal] = callback;
        },
        bind(key, row, property) {
            this.bindings.push({ key, row, property });
        },
    };
}
const metadata = { name: "Codex Meter", "version-name": "test", url: "https://example.com" };

test("icon dropdown reads, writes, and tracks all supported icon styles", () => {
    const icons = ["codex", "codex-ring", "openai", "text"];
    for (const [index, icon] of icons.entries()) {
        const settings = settingsFixture({ [SETTINGS_TOP_PANEL_INDICATOR_ICON]: icon });
        const page = createPreferencesPage(settings, metadata);
        const group = page.children.find((child) => child.title === "Top panel indicator");
        const row = group.children.find((child) => child.title === "Icon");
        assert.deepEqual(row.model, [
            "Codex logo",
            "Codex with circular progress",
            "OpenAI logo",
            "'CX'",
        ]);
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

test("readSettings preserves supported icons and legacy fallback behavior", () => {
    for (const [value, expected] of [
        ["codex", "codex"],
        ["codex-ring", "codex-ring"],
        ["openai", "openai"],
        ["text", "text"],
        ["icon", "codex"],
        ["unknown", "text"],
    ]) {
        for (const mode of ["bars", "percentages"]) {
            const settings = settingsFixture({
                [SETTINGS_TOP_PANEL_INDICATOR_ICON]: value,
                "top-panel-display-mode": mode,
            });
            const result = readSettings(settings);
            assert.equal(result.topPanelIndicatorIcon, expected);
            assert.equal(result.topPanelDisplayMode, mode);
        }
    }
});

test("icon schema allows circular progress and preserves panel defaults", () => {
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
    assert.match(displayKey, /<default>'bars'<\/default>/);
    assert.equal(readSettings(settingsFixture()).topPanelIndicatorIcon, "codex");
    assert.equal(readSettings(settingsFixture()).topPanelDisplayMode, "bars");
});

test("preferences banked resets group contains only the bound auto-apply toggle", () => {
    const settings = settingsFixture();
    const page = createPreferencesPage(settings, metadata);
    const group = page.children.find((child) => child.title === "Banked resets");
    assert.equal(group.children.length, 1);
    assert.equal(group.children[0].title, "Auto-apply expiring resets");
    assert.equal(settings.bindings.length, 1);
    assert.equal(settings.bindings[0].row, group.children[0]);
    assert.equal(settings.bindings[0].property, "active");
});

test("preferences entry point builds the page without loading inventory", async () => {
    const prefs = new CodexMeterPreferences();
    prefs.getSettings = settingsFixture;
    prefs.metadata = metadata;
    let page;
    const window = {
        add(value) {
            page = value;
        },
        set_default_size(width, height) {
            assert.deepEqual([width, height], [640, 720]);
        },
    };
    await prefs.fillPreferencesWindow(window);
    assert.equal(page.title, "Codex Meter");
    assert.equal(page.children[3].children[0].children[0].label, "Codex Meter test");
});
