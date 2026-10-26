import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const pageUrl = new URL("../src/preferences/page.js", import.meta.url).href;
const prefsUrl = new URL("../src/prefs.js", import.meta.url).href;
const stubUrl = `data:text/javascript,${encodeURIComponent(`
    export class Widget {
        constructor(options = {}) { Object.assign(this, options); this.children = []; }
        add(child) { this.children.push(child); }
        append(child) { this.add(child); }
        connect() {}
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

function settingsFixture() {
    return {
        bindings: [],
        get_string: () => "",
        get_uint: () => 5,
        connect() {},
        bind(key, row, property) {
            this.bindings.push({ key, row, property });
        },
    };
}
const metadata = { name: "Codex Meter", "version-name": "test", url: "https://example.com" };

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
