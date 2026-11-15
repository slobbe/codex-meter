import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { CodexError } from "../src/codex/error.js";
import {
    DEFAULT_CREDENTIALS_PATH,
    migrateSettings,
    readSettings,
    SETTINGS_AUTO_APPLY_BANKED_RESET,
    SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE,
    SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_THRESHOLD,
    SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW,
    SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES,
    SETTINGS_CREDENTIALS_PATH,
    SETTINGS_PERCENT_DISPLAY_MODE,
    SETTINGS_TOP_PANEL_DISPLAY_MODE,
    SETTINGS_TOP_PANEL_INDICATOR_ICON,
    SETTINGS_USAGE_NOTIFICATIONS,
    SETTINGS_USAGE_NOTIFICATION_THRESHOLD,
} from "../src/preferences/settings.js";

const pageUrl = new URL("../src/preferences/page.js", import.meta.url).href;
const prefsUrl = new URL("../src/prefs.js", import.meta.url).href;
const snapshotStubUrl = `data:text/javascript,${encodeURIComponent(`
    export const cache = { read: async () => null };
    export class UsageService {
        constructor(credentialsPath) { this.credentialsPath = credentialsPath; }
        readCachedSnapshot({ cancellable }) { return cache.read(cancellable, this.credentialsPath); }
    }
`)}`;
const { cache } = await import(snapshotStubUrl);
const authStubUrl = `data:text/javascript,${encodeURIComponent(`
    export const validation = { read: async () => ({ accessToken: "fake-token" }) };
    export const getCodexCredentials = (cancellable, path) => validation.read(cancellable, path);
`)}`;
const { validation } = await import(authStubUrl);
const stubUrl = `data:text/javascript,${encodeURIComponent(`
    export class Widget {
        constructor(options = {}) {
            Object.assign(this, options);
            if (options.adjustment) this.value = options.adjustment.value;
            this.children = [];
        }
        add(child) { this.children.push(child); }
        append(child) { this.add(child); }
        connect(signal, callback) {
            (this.signals ??= {})[signal] = callback;
            return signal;
        }
        disconnect(id) {
            if (!this.signals?.[id]) throw new Error("Signal already disconnected");
            delete this.signals[id];
        }
        emit(signal, ...args) { this.signals?.[signal]?.(this, ...args); }
        add_suffix(child) { this.add(child); }
        set_markup(markup) { this.markup = markup; }
        get model() { return this._model; }
        set model(value) {
            this._model = value;
            this.selected = 0;
            this.signals?.["notify::selected"]?.();
        }
    }
    export const dialogs = [];
    class FileChooserNative extends Widget {
        constructor(options) { super(options); dialogs.push(this); }
        add_filter(filter) { (this.filters ??= []).push(filter); }
        set_filter(filter) { this.filter = filter; }
        set_file(file) { this.file = file; }
        get_file() { return this.file; }
        show() { this.shown = (this.shown ?? 0) + 1; }
        destroy() {
            if (this.destroyed) throw new Error("Dialog already destroyed");
            if (Object.keys(this.signals ?? {}).length) throw new Error("Dialog signals still connected");
            this.destroyed = true;
        }
    }
    export default {
        PreferencesPage: Widget, PreferencesGroup: Widget, SwitchRow: Widget, ActionRow: Widget,
        ComboRow: Widget, SpinRow: Widget, Adjustment: Widget, Box: Widget, Label: Widget,
        Button: Widget, FileChooserNative,
        FileFilter: class extends Widget {
            add_pattern(pattern) { (this.patterns ??= []).push(pattern); }
        },
        FileChooserAction: { OPEN: 0 }, ResponseType: { ACCEPT: -3, CANCEL: -6, DELETE_EVENT: -4 },
        Align: { CENTER: 3 },
        File: { new_for_path: path => ({ get_path: () => path }) },
        get_home_dir: () => "/home/test",
        build_filenamev: parts => parts.join("/"),
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
const { default: toolkit, dialogs } = await import(stubUrl);
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (context.parentURL === pageUrl && specifier === "../codex/auth/auth.js") {
            return { url: authStubUrl, shortCircuit: true };
        }
        if (context.parentURL === prefsUrl && specifier === "./codex/usage/service.js") {
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
        [SETTINGS_CREDENTIALS_PATH]: DEFAULT_CREDENTIALS_PATH,
        ...values,
    };
    const signals = new Map();
    let nextSignalId = 1;
    const uints = {
        [SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES]: 5,
        [SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_THRESHOLD]: 2,
        [SETTINGS_USAGE_NOTIFICATION_THRESHOLD]: 10,
        ...values,
    };
    const booleans = {
        [SETTINGS_AUTO_APPLY_BANKED_RESET]: false,
        [SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE]: false,
        [SETTINGS_USAGE_NOTIFICATIONS]: false,
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
        resets: [],
        reset(key) {
            assert.equal(key, SETTINGS_CREDENTIALS_PATH);
            this.resets.push(key);
            strings[key] = DEFAULT_CREDENTIALS_PATH;
            emit(`changed::${key}`);
        },
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

test("preferences groups appearance and background refresh with descriptive labels", () => {
    const page = createPreferencesPage(settingsFixture(), metadata, windowFixture());
    assert.deepEqual(
        page.children.slice(0, 5).map((group) => group.title),
        ["Appearance", "Notifications", "Banked resets", "Background refresh", "Credentials"],
    );
    assert.deepEqual(
        page.children[0].children.map((row) => row.title),
        ["Percentage meaning", "Indicator icon", "Indicator progress style"],
    );
    assert.deepEqual(
        page.children[0].children.map((row) => row.subtitle),
        [
            "Show remaining or used capacity",
            "Icon shown in the top panel",
            "How usage appears in the top panel",
        ],
    );
    assert.deepEqual(
        page.children[3].children.map((row) => row.title),
        ["Interval (minutes)"],
    );
    assert.equal(page.children[3].children[0].subtitle, "Set to 0 to refresh manually");
});

test("credentials group follows background refresh and tracks the configured file", () => {
    const settings = settingsFixture();
    const window = windowFixture();
    const page = createPreferencesPage(settings, metadata, window);
    assert.deepEqual(
        page.children.slice(0, 5).map((group) => group.title),
        ["Appearance", "Notifications", "Banked resets", "Background refresh", "Credentials"],
    );
    assert.equal(page.children[5].children[0].children[0].label, "Codex Meter test");
    const row = page.children[4].children[0];
    const [, reset] = row.children;
    assert.equal(row.title, "Credentials file");
    assert.equal(row.subtitle, DEFAULT_CREDENTIALS_PATH);
    assert.equal(row.subtitle_selectable, true);
    assert.equal(reset.sensitive, false);
    assert.deepEqual(settings.writes, []);

    settings.set_string(SETTINGS_CREDENTIALS_PATH, "/home/test/.codex/auth.json");
    assert.equal(row.subtitle, "/home/test/.codex/auth.json");
    assert.equal(reset.sensitive, false);
    settings.set_string(SETTINGS_CREDENTIALS_PATH, "/tmp/custom-auth.json");
    assert.equal(row.subtitle, "/tmp/custom-auth.json");
    assert.equal(reset.sensitive, true);
    window.close();
    settings.set_string(SETTINGS_CREDENTIALS_PATH, DEFAULT_CREDENTIALS_PATH);
    assert.equal(row.subtitle, "/tmp/custom-auth.json");
});

test("credentials Browse initializes the current file and saves local selections", async () => {
    for (const [configured, resolved] of [
        [DEFAULT_CREDENTIALS_PATH, "/home/test/.codex/auth.json"],
        ["~/work/auth.json", "/home/test/work/auth.json"],
        ["/tmp/auth.json", "/tmp/auth.json"],
    ]) {
        const settings = settingsFixture({ [SETTINGS_CREDENTIALS_PATH]: configured });
        const window = windowFixture();
        const page = createPreferencesPage(settings, metadata, window);
        const row = page.children[4].children[0];
        const [browse, reset] = row.children;
        const count = dialogs.length;
        browse.emit("clicked");
        const dialog = dialogs.at(-1);
        assert.equal(dialogs.length, count + 1);
        assert.equal(dialog.transient_for, window);
        assert.equal(dialog.modal, true);
        assert.equal(dialog.action, toolkit.FileChooserAction.OPEN);
        assert.equal(dialog.filters.length, 1);
        assert.equal(dialog.filter, dialog.filters[0]);
        assert.equal(dialog.filter.name, "JSON files (*.json)");
        assert.deepEqual(dialog.filter.patterns, ["*.json"]);
        assert.equal(dialog.file.get_path(), resolved);
        assert.equal(dialog.shown, 1);
        assert.deepEqual(settings.writes, []);
        browse.emit("clicked");
        assert.equal(dialogs.length, count + 1);
        assert.equal(dialog.shown, 2);

        const lateResponse = dialog.signals.response;
        dialog.file = toolkit.File.new_for_path("/tmp/selected.json");
        dialog.emit("response", toolkit.ResponseType.ACCEPT);
        await new Promise(setImmediate);
        assert.deepEqual(settings.writes, [
            { key: SETTINGS_CREDENTIALS_PATH, value: "/tmp/selected.json" },
        ]);
        assert.equal(row.subtitle, "/tmp/selected.json");
        assert.equal(reset.sensitive, true);
        assert.equal(dialog.destroyed, true);
        assert.deepEqual(dialog.signals, {});
        lateResponse(dialog, toolkit.ResponseType.ACCEPT);
        assert.equal(settings.writes.length, 1);

        browse.emit("clicked");
        assert.notEqual(dialogs.at(-1), dialog);
        assert.equal(dialogs.at(-1).file.get_path(), "/tmp/selected.json");
        window.close();
    }
});

test("credentials chooser cancellation and non-local or empty selections leave settings unchanged", () => {
    for (const [response, file] of [
        [toolkit.ResponseType.CANCEL, toolkit.File.new_for_path("/tmp/ignored.json")],
        [toolkit.ResponseType.DELETE_EVENT, null],
        [toolkit.ResponseType.ACCEPT, null],
        [toolkit.ResponseType.ACCEPT, { get_path: () => null }],
    ]) {
        const settings = settingsFixture();
        const window = windowFixture();
        const page = createPreferencesPage(settings, metadata, window);
        const row = page.children[4].children[0];
        row.children[0].emit("clicked");
        const dialog = dialogs.at(-1);
        dialog.file = file;
        dialog.emit("response", response);
        assert.deepEqual(settings.writes, []);
        assert.equal(row.subtitle, DEFAULT_CREDENTIALS_PATH);
        assert.equal(dialog.destroyed, true);
        assert.deepEqual(dialog.signals, {});
        window.close();
    }
});

test("credentials reset uses the schema default and updates the row", () => {
    const settings = settingsFixture({ [SETTINGS_CREDENTIALS_PATH]: "~/custom/auth.json" });
    const window = windowFixture();
    const page = createPreferencesPage(settings, metadata, window);
    const row = page.children[4].children[0];
    const [, reset] = row.children;
    assert.equal(reset.sensitive, true);
    reset.emit("clicked");
    assert.deepEqual(settings.resets, [SETTINGS_CREDENTIALS_PATH]);
    assert.deepEqual(settings.writes, []);
    assert.equal(settings.get_string(SETTINGS_CREDENTIALS_PATH), DEFAULT_CREDENTIALS_PATH);
    assert.equal(row.subtitle, DEFAULT_CREDENTIALS_PATH);
    assert.equal(reset.sensitive, false);
    window.close();
});

test("closing preferences destroys the credentials chooser and prevents late writes", () => {
    const settings = settingsFixture({ [SETTINGS_CREDENTIALS_PATH]: "/tmp/custom.json" });
    const window = windowFixture();
    const page = createPreferencesPage(settings, metadata, window);
    const [browse, reset] = page.children[4].children[0].children;
    const lateBrowse = browse.signals.clicked;
    const lateReset = reset.signals.clicked;
    browse.emit("clicked");
    const dialog = dialogs.at(-1);
    const lateResponse = dialog.signals.response;
    dialog.file = toolkit.File.new_for_path("/tmp/late.json");
    assert.equal(window.close(), false);
    assert.equal(dialog.destroyed, true);
    assert.deepEqual(dialog.signals, {});
    assert.deepEqual(browse.signals, {});
    assert.deepEqual(reset.signals, {});
    assert.equal(settings.signals.size, 0);
    const count = dialogs.length;
    lateResponse(dialog, toolkit.ResponseType.ACCEPT);
    lateBrowse();
    lateReset();
    assert.deepEqual(settings.writes, []);
    assert.deepEqual(settings.resets, []);
    assert.equal(dialogs.length, count);
    assert.equal(window.close(), false);
});

test("credentials selection validates before saving and shows safe inline errors", async (t) => {
    t.after(() => {
        validation.read = async () => ({ accessToken: "fake-token" });
    });
    const settings = settingsFixture({ [SETTINGS_CREDENTIALS_PATH]: "/tmp/previous.json" });
    const window = windowFixture();
    const page = createPreferencesPage(settings, metadata, window);
    const [row, errorLabel] = page.children[4].children;
    const [browse] = row.children;
    assert.equal(errorLabel.visible, false);
    for (const failure of [
        new CodexError("missing-auth", "Selected file does not contain valid JSON."),
        new Error("Sensitive technical detail"),
    ]) {
        validation.read = async (cancellable, path) => {
            assert.equal(path, "/tmp/invalid.json");
            assert.equal(cancellable.is_cancelled(), false);
            throw failure;
        };
        browse.emit("clicked");
        const dialog = dialogs.at(-1);
        dialog.file = toolkit.File.new_for_path("/tmp/invalid.json");
        dialog.emit("response", toolkit.ResponseType.ACCEPT);
        assert.deepEqual(settings.writes, []);
        await new Promise(setImmediate);
        assert.equal(errorLabel.visible, true);
        assert.equal(
            errorLabel.label,
            failure instanceof CodexError
                ? failure.message
                : "Could not verify this file. Select a readable Codex credentials file.",
        );
        assert.equal(settings.get_string(SETTINGS_CREDENTIALS_PATH), "/tmp/previous.json");
        assert.equal(row.subtitle, "/tmp/previous.json");
    }
    validation.read = async () => ({ accessToken: "fake-token" });
    browse.emit("clicked");
    assert.equal(errorLabel.visible, false);
    const dialog = dialogs.at(-1);
    dialog.file = toolkit.File.new_for_path("/tmp/valid.json");
    dialog.emit("response", toolkit.ResponseType.ACCEPT);
    await new Promise(setImmediate);
    assert.equal(settings.get_string(SETTINGS_CREDENTIALS_PATH), "/tmp/valid.json");
    assert.equal(errorLabel.visible, false);
    window.close();
});

for (const action of ["close", "reset", "browse", "external change"]) {
    for (const fails of [false, true]) {
        test(`${action} cancels pending credentials validation and ignores late ${fails ? "errors" : "success"}`, async (t) => {
            t.after(() => {
                validation.read = async () => ({ accessToken: "fake-token" });
            });
            let finish;
            let cancellable;
            validation.read = (value) => {
                cancellable = value;
                return new Promise((resolve, reject) => {
                    finish = () =>
                        fails
                            ? reject(new CodexError("missing-auth", "Late failure"))
                            : resolve({ accessToken: "fake-token" });
                });
            };
            const settings = settingsFixture({ [SETTINGS_CREDENTIALS_PATH]: "/tmp/previous.json" });
            const window = windowFixture();
            const page = createPreferencesPage(settings, metadata, window);
            const [row, errorLabel] = page.children[4].children;
            const [browse, reset] = row.children;
            browse.emit("clicked");
            const dialog = dialogs.at(-1);
            dialog.file = toolkit.File.new_for_path("/tmp/pending.json");
            dialog.emit("response", toolkit.ResponseType.ACCEPT);
            assert.deepEqual(settings.writes, []);
            assert.equal(cancellable.is_cancelled(), false);
            if (action === "close") window.close();
            else if (action === "reset") reset.emit("clicked");
            else if (action === "browse") browse.emit("clicked");
            else settings.set_string(SETTINGS_CREDENTIALS_PATH, "/tmp/external.json");
            assert.equal(cancellable.is_cancelled(), true);
            const writes = [...settings.writes];
            finish();
            await new Promise(setImmediate);
            assert.deepEqual(settings.writes, writes);
            assert.equal(errorLabel.visible, false);
            assert.equal(
                settings.get_string(SETTINGS_CREDENTIALS_PATH),
                action === "reset"
                    ? DEFAULT_CREDENTIALS_PATH
                    : action === "external change"
                      ? "/tmp/external.json"
                      : "/tmp/previous.json",
            );
            window.close();
        });
    }
}

test("appearance dropdowns select their first option by default", () => {
    const page = createPreferencesPage(settingsFixture(), metadata, windowFixture());
    assert.deepEqual(
        page.children[0].children.map((row) => row.selected),
        [0, 0, 0],
    );
});

test("percentage meaning dropdown reads, writes, and tracks both meanings in order", () => {
    const meanings = ["left", "used"];
    for (const [index, meaning] of meanings.entries()) {
        const settings = settingsFixture({ [SETTINGS_PERCENT_DISPLAY_MODE]: meaning });
        const page = createPreferencesPage(settings, metadata, windowFixture());
        const row = page.children[0].children[0];
        assert.deepEqual(row.model, ["% left", "% used"]);
        assert.equal(row.selected, index);

        for (const [selected, value] of meanings.entries()) {
            row.selected = selected;
            row.emit("notify::selected");
            assert.equal(settings.get_string(SETTINGS_PERCENT_DISPLAY_MODE), value);
        }

        settings.set_string(SETTINGS_PERCENT_DISPLAY_MODE, meaning);
        assert.equal(row.selected, index);
    }
});

test("icon dropdown reads, writes, and tracks all supported icon styles", () => {
    const icons = ["codex", "openai", "text"];
    for (const [index, icon] of icons.entries()) {
        const settings = settingsFixture({ [SETTINGS_TOP_PANEL_INDICATOR_ICON]: icon });
        const page = createPreferencesPage(settings, metadata, windowFixture());
        const group = page.children.find((child) => child.title === "Appearance");
        const row = group.children.find((child) => child.title === "Indicator icon");
        assert.deepEqual(row.model, ["Codex", "OpenAI", "'CX' monogram"]);
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
        const group = page.children.find((child) => child.title === "Appearance");
        const row = group.children.find((child) => child.title === "Indicator progress style");
        assert.deepEqual(row.model, ["Bar", "Circle", "Number"]);
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
        autoApplyBankedResetUsageThreshold: 2,
        autoApplyBankedResetUsageWindow: "any",
        usageNotifications: false,
        usageNotificationThreshold: 10,
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
        const group = page.children.find((child) => child.title === "Appearance");
        assert.equal(group.children.find((child) => child.title === "Indicator icon").selected, 0);
        assert.equal(
            group.children.find((child) => child.title === "Indicator progress style").selected,
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
    assert.equal(settings.bindings.length, 6);
    assert.equal(settings.bindings[2].key, SETTINGS_AUTO_APPLY_BANKED_RESET);
    assert.equal(group.children[1].title, "Auto-redeem on low remaining usage");
    assert.equal(
        group.children[1].subtitle,
        "Redeem a reset if remaining usage falls below threshold",
    );
    assert.deepEqual(settings.bindings[3], {
        key: SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE,
        row: group.children[1],
        property: "active",
        flags: 0,
    });
    assert.deepEqual(settings.bindings[4], {
        key: SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE,
        row: group.children[2],
        property: "sensitive",
        flags: 1,
    });
    assert.deepEqual(settings.bindings[5], {
        key: SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE,
        row: group.children[3],
        property: "sensitive",
        flags: 1,
    });
    assert.equal(settings.bindings[2].row, group.children[0]);
    assert.equal(settings.bindings[2].property, "active");
});

test("readSettings preserves opt-in usage notification settings and thresholds", () => {
    assert.equal(SETTINGS_USAGE_NOTIFICATIONS, "usage-notifications");
    assert.equal(SETTINGS_USAGE_NOTIFICATION_THRESHOLD, "usage-notification-threshold");
    const settings = settingsFixture();
    const before = readSettings(settings);
    assert.equal(settings.get_boolean(SETTINGS_USAGE_NOTIFICATIONS), false);
    assert.equal(settings.get_uint(SETTINGS_USAGE_NOTIFICATION_THRESHOLD), 10);
    for (const enabled of [true, false]) {
        settings.set_boolean(SETTINGS_USAGE_NOTIFICATIONS, enabled);
        assert.equal(settings.get_boolean(SETTINGS_USAGE_NOTIFICATIONS), enabled);
        for (const threshold of [1, 25, 100]) {
            settings.set_uint(SETTINGS_USAGE_NOTIFICATION_THRESHOLD, threshold);
            assert.equal(settings.get_uint(SETTINGS_USAGE_NOTIFICATION_THRESHOLD), threshold);
            assert.deepEqual(readSettings(settings), {
                ...before,
                usageNotifications: enabled,
                usageNotificationThreshold: threshold,
            });
        }
    }
});

test("usage notification schema defaults to disabled with a 1–100 threshold of 10", () => {
    const schema = readFileSync(
        new URL(
            "../src/schemas/org.gnome.shell.extensions.codex-meter.gschema.xml",
            import.meta.url,
        ),
        "utf8",
    );
    const toggle = schema.match(/<key name="usage-notifications" type="b">([\s\S]*?)<\/key>/)[1];
    const threshold = schema.match(
        /<key name="usage-notification-threshold" type="u">([\s\S]*?)<\/key>/,
    )[1];
    assert.match(toggle, /<default>false<\/default>/);
    assert.match(threshold, /<default>10<\/default>/);
    assert.match(threshold, /<range min="1" max="100"\/>/);
});

test("notification preferences roundtrip threshold, track sensitivity, and clean up callbacks", () => {
    for (const enabled of [false, true]) {
        const settings = settingsFixture({ [SETTINGS_USAGE_NOTIFICATIONS]: enabled });
        const window = windowFixture();
        const page = createPreferencesPage(settings, metadata, window);
        const group = page.children[1];
        assert.equal(group.title, "Notifications");
        assert.equal(page.children[4].title, "Credentials");
        assert.equal(page.children[5].children[0].children[0].label, "Codex Meter test");
        const [toggle, threshold] = group.children;
        assert.equal(toggle.title, "Usage notifications");
        assert.equal(toggle.active, enabled);
        assert.equal(threshold.title, "Warning threshold (% left)");
        assert.equal(threshold.value, 10);
        assert.equal(threshold.adjustment.lower, 1);
        assert.equal(threshold.adjustment.upper, 100);
        assert.equal(threshold.adjustment.step_increment, 1);
        assert.equal(threshold.digits, 0);
        assert.equal(threshold.sensitive, enabled);
        assert.deepEqual(settings.writes, []);
        assert.deepEqual(settings.bindings.slice(0, 2), [
            { key: SETTINGS_USAGE_NOTIFICATIONS, row: toggle, property: "active", flags: 0 },
            { key: SETTINGS_USAGE_NOTIFICATIONS, row: threshold, property: "sensitive", flags: 1 },
        ]);
        settings.set_boolean(SETTINGS_USAGE_NOTIFICATIONS, !enabled);
        assert.equal(toggle.active, !enabled);
        assert.equal(threshold.sensitive, !enabled);
        settings.set_boolean(SETTINGS_USAGE_NOTIFICATIONS, enabled);
        assert.equal(toggle.active, enabled);
        assert.equal(threshold.sensitive, enabled);
        settings.set_boolean(SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE, true);
        assert.equal(threshold.sensitive, enabled);
        for (const value of [1, 30, 100]) {
            settings.set_uint(SETTINGS_USAGE_NOTIFICATION_THRESHOLD, value);
            assert.equal(threshold.value, value);
        }
        for (const [value, expected] of [
            [4.6, 5],
            [0, 1],
            [101, 100],
        ]) {
            threshold.value = value;
            threshold.emit("notify::value");
            assert.equal(settings.get_uint(SETTINGS_USAGE_NOTIFICATION_THRESHOLD), expected);
            assert.equal(threshold.value, expected);
        }
        assert.equal(settings.get_uint(SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_THRESHOLD), 2);
        const signalIds = [...settings.signals.keys()];
        assert.equal(window.close(), false);
        assert.equal(settings.signals.size, 0);
        assert.deepEqual(settings.disconnected, signalIds);
        settings.set_uint(SETTINGS_USAGE_NOTIFICATION_THRESHOLD, 50);
        assert.equal(threshold.value, 100);
        assert.equal(window.close(), false);
        assert.deepEqual(settings.disconnected, signalIds);
    }
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

test("usage auto-redemption schema is opt-in with a 1–100 threshold defaulting to 2", () => {
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
    assert.match(threshold, /<default>2<\/default>/);
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
        assert.equal(threshold.value, 2);
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
    assert.equal(page.children[5].children[0].children[0].label, "Codex Meter test");
    assert.equal(settings.signals.size, 8);
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
    const [percent, icon, display] = page.children[0].children;
    const [refresh] = page.children[3].children;
    const signalIds = [...settings.signals.keys()];
    assert.equal(signalIds.length, 8);

    settings.set_string(SETTINGS_PERCENT_DISPLAY_MODE, "used");
    settings.set_string(SETTINGS_TOP_PANEL_INDICATOR_ICON, "openai");
    settings.set_string(SETTINGS_TOP_PANEL_DISPLAY_MODE, "percentages");
    settings.set_uint(SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES, 10);
    assert.deepEqual(
        [percent.selected, icon.selected, display.selected, refresh.value],
        [1, 1, 2, 10],
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
        [1, 1, 2, 13],
    );

    assert.equal(window.close(), false);
    assert.deepEqual(settings.disconnected, signalIds);
});

test("closing one window preserves other windows and reopening does not leak handlers", () => {
    const settings = settingsFixture();
    const firstWindow = windowFixture();
    const firstPage = createPreferencesPage(settings, metadata, firstWindow);
    const firstIcon = firstPage.children[0].children[1];

    for (let i = 0; i < 3; i++) {
        const window = windowFixture();
        const page = createPreferencesPage(settings, metadata, window);
        const icon = page.children[0].children[1];
        assert.equal(settings.signals.size, 16);
        settings.set_string(SETTINGS_TOP_PANEL_INDICATOR_ICON, "openai");
        assert.equal(firstIcon.selected, 1);
        assert.equal(icon.selected, 1);

        assert.equal(window.close(), false);
        assert.equal(settings.signals.size, 8);
        settings.set_string(SETTINGS_TOP_PANEL_INDICATOR_ICON, "text");
        assert.equal(firstIcon.selected, 2);
        assert.equal(icon.selected, 1);
    }

    assert.equal(firstWindow.close(), false);
    assert.equal(settings.signals.size, 0);
    assert.equal(settings.disconnected.length, 32);
});
