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
    SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES,
    SETTINGS_BANKED_RESET_SKIP_MINUTES,
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
    export const cache = {
        read: async () => null,
        readChangelog: async () => "## [Unreleased] v0.13.0\\n\\n### Added\\n\\n- Latest feature.",
    };
    export const readFile = (path, cancellable) => cache.readChangelog(path, cancellable);
    export class UsageService {
        constructor(credentialsPath) {
            this.credentialsPath = credentialsPath;
            this.snapshotPath = credentialsPath + ".snapshot.json";
        }
        readStoredSnapshot({ cancellable }) { return cache.read(cancellable, this.credentialsPath); }
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
        add_row(child) { this.add(child); }
        remove(child) { this.children.splice(this.children.indexOf(child), 1); }
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
    export const aboutWindows = [];
    export const fileMonitors = new Map();
    class FileMonitor extends Widget {
        cancel() { this.cancelled = true; }
    }
    class AboutWindow extends Widget {
        constructor(options) { super(options); aboutWindows.push(this); }
        add_link(title, url) { (this.links ??= []).push({ title, url }); }
        present() { this.presented = true; }
    }
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
    function fileForPath(path) {
        const monitorPath = () => {
            const monitor = new FileMonitor();
            fileMonitors.set(path, monitor);
            return monitor;
        };
        return {
            get_path: () => path,
            get_parent: () => fileForPath(path.slice(0, path.lastIndexOf("/"))),
            equal: other => path === other.get_path(),
            query_info_async: async () => ({}),
            monitor_directory: monitorPath,
            monitor_file: monitorPath,
        };
    }
    export default {
        PreferencesPage: Widget, PreferencesGroup: Widget, SwitchRow: Widget, ActionRow: Widget,
        ComboRow: Widget, ExpanderRow: Widget, SpinRow: Widget, Adjustment: Widget, Box: Widget, Label: Widget,

        Variant: class {
            constructor(type, value) { this.type = type; this.value = value; }
            deep_unpack() { return this.value; }
        },
        Button: Widget, Image: Widget, FileChooserNative, AboutWindow,
        License: { GPL_3_0: 9 },
        FileFilter: class extends Widget {
            add_pattern(pattern) { (this.patterns ??= []).push(pattern); }
        },
        FileChooserAction: { OPEN: 0 }, ResponseType: { ACCEPT: -3, CANCEL: -6, DELETE_EVENT: -4 },
        Align: { CENTER: 3 },
        File: { new_for_path: fileForPath },
        FileMonitorFlags: { WATCH_MOVES: 8 }, FileQueryInfoFlags: { NONE: 0 },
        get_home_dir: () => "/home/test",
        build_filenamev: parts => parts.join("/"),

        Cancellable: class {
            cancel() { this.cancelled = true; }
            is_cancelled() { return this.cancelled ?? false; }
        },
        StringList: { new: values => values },
        Orientation: { VERTICAL: 0 }, Justification: { CENTER: 0 },
        SettingsBindFlags: { DEFAULT: 0, GET: 1 },
    };
    export class ExtensionPreferences {}
`)}`;
const { default: toolkit, dialogs, aboutWindows, fileMonitors } = await import(stubUrl);
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (context.parentURL === pageUrl && specifier === "../codex/auth/auth.js") {
            return { url: authStubUrl, shortCircuit: true };
        }
        if (context.parentURL === pageUrl && specifier === "../codex/usage/service.js") {
            return { url: snapshotStubUrl, shortCircuit: true };
        }
        if (context.parentURL === prefsUrl && specifier === "./io/files.js") {
            return { url: snapshotStubUrl, shortCircuit: true };
        }
        if (
            [pageUrl, prefsUrl].includes(context.parentURL) &&
            specifier.includes("banked-resets")
        ) {
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

        [SETTINGS_CREDENTIALS_PATH]: DEFAULT_CREDENTIALS_PATH,
        ...values,
    };
    const signals = new Map();
    let nextSignalId = 1;
    const uints = {
        [SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES]: 5,

        [SETTINGS_USAGE_NOTIFICATION_THRESHOLD]: 10,
        ...values,
    };
    const booleans = {
        [SETTINGS_AUTO_APPLY_BANKED_RESET]: false,
        [SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE]: false,
        [SETTINGS_USAGE_NOTIFICATIONS]: false,
        ...values,
    };
    let skipMinutes = new toolkit.Variant("a{su}", {});
    const bindings = [];
    const locked = new Set();
    const rejected = new Set();
    const canWrite = (key) => !locked.has(key) && !rejected.has(key);
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
        rejected,
        is_writable: (key) => !locked.has(key),
        setLocked(key, value) {
            if (value) locked.add(key);
            else locked.delete(key);
            emit(`writable-changed::${key}`);
        },
        get_user_value: (key) =>
            strings[key] === DEFAULT_CREDENTIALS_PATH
                ? null
                : new toolkit.Variant("s", strings[key]),
        reset(key) {
            assert.equal(key, SETTINGS_CREDENTIALS_PATH);
            if (!canWrite(key)) return;
            this.resets.push(key);
            strings[key] = DEFAULT_CREDENTIALS_PATH;
            emit(`changed::${key}`);
        },
        get_value(key) {
            assert.equal(key, SETTINGS_BANKED_RESET_SKIP_MINUTES);
            return skipMinutes;
        },
        set_value(key, value) {
            assert.equal(key, SETTINGS_BANKED_RESET_SKIP_MINUTES);
            assert.equal(value.type, "a{su}");
            if (!canWrite(key)) return false;
            this.writes.push({ key, value: value.deep_unpack() });
            skipMinutes = value;
            emit(`changed::${key}`);
            return true;
        },
        get_string: (key) => strings[key],
        set_string(key, value) {
            if (!canWrite(key)) return false;
            this.writes.push({ key, value });
            strings[key] = value;
            emit(`changed::${key}`);
            return true;
        },
        get_uint: (key) => uints[key],
        set_uint(key, value) {
            if (!canWrite(key)) return false;
            this.writes.push({ key, value });
            uints[key] = value;
            emit(`changed::${key}`);
            return true;
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
        get_display: () => null,
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
const metadata = {
    name: "Codex Meter",
    "version-name": "test",
    url: "https://example.com",
    description:
        "Monitor & manage Codex usage limits.\n\n- Keep <credentials> private.\n- Read `auth.json`.",
};

test("preferences footer About link opens a modal About window with project details", () => {
    const window = windowFixture();
    const page = createPreferencesPage(settingsFixture(), metadata, window);
    const group = page.children.at(-1);
    assert.equal(group.children.length, 1);
    const box = group.children[0];
    assert.equal(box.orientation, toolkit.Orientation.VERTICAL);
    assert.equal(box.children.length, 2);
    const [version, link] = box.children;
    assert.equal(version.label, "Codex Meter test");
    assert.deepEqual(version.css_classes, ["caption", "dim-label"]);
    assert.equal(link.label, '<a href="about:codex-meter">About</a>');
    assert.equal(link.use_markup, true);
    const before = aboutWindows.length;
    assert.equal(link.signals["activate-link"](link, "about:codex-meter"), true);
    assert.equal(aboutWindows.length, before + 1);
    const about = aboutWindows.at(-1);
    assert.equal(about.transient_for, window);
    assert.equal(about.modal, true);
    assert.equal(about.destroy_with_parent, true);
    assert.equal(about.application_name, metadata.name);
    assert.equal(about.application_icon, "codex-meter");
    assert.equal(
        readFileSync(
            new URL(`../src/icons/${about.application_icon}.svg`, import.meta.url),
            "utf8",
        ),
        readFileSync(new URL("../docs/assets/logo/logo.svg", import.meta.url), "utf8"),
    );
    assert.equal(about.version, metadata["version-name"]);
    assert.equal(about.developer_name, "Sebastian Lobbe");
    assert.deepEqual(about.developers, ["Sebastian Lobbe <s@lobbe.cc>"]);
    assert.equal(
        about.comments,
        "Monitor &amp; manage Codex usage limits.\n\n• Keep &lt;credentials&gt; private.\n• Read <tt>auth.json</tt>.",
    );
    assert.equal(about.website, metadata.url);
    assert.equal(about.issue_url, `${metadata.url}/issues`);
    assert.equal(about.license_type, toolkit.License.GPL_3_0);
    assert.equal(about.links, undefined);
    assert.equal(about.presented, true);
    assert.equal(about.release_notes, undefined);
    window.close();
});

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
            "Show remaining or used capacity.",
            "Icon shown in the top panel.",
            "How usage appears in the top panel.",
        ],
    );
    assert.deepEqual(
        page.children[3].children.map((row) => row.title),
        ["Interval (minutes)"],
    );
    const [refreshInterval] = page.children[3].children;
    assert.equal(refreshInterval.subtitle, "Set to 0 to refresh manually.");
    assert.deepEqual([refreshInterval.adjustment.lower, refreshInterval.adjustment.upper], [0, 30]);
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

test("credentials chooser reports unusable selections but not cancellation", () => {
    for (const [response, file, error] of [
        [toolkit.ResponseType.CANCEL, toolkit.File.new_for_path("/tmp/ignored.json"), ""],
        [toolkit.ResponseType.DELETE_EVENT, null, ""],
        [toolkit.ResponseType.ACCEPT, null, "Select a local credentials file."],
        [toolkit.ResponseType.ACCEPT, { get_path: () => null }, "Select a local credentials file."],
    ]) {
        const settings = settingsFixture();
        const window = windowFixture();
        const page = createPreferencesPage(settings, metadata, window);
        const [row, errorLabel] = page.children[4].children;
        row.children[0].emit("clicked");
        const dialog = dialogs.at(-1);
        dialog.file = file;
        dialog.emit("response", response);
        assert.equal(errorLabel.visible, Boolean(error));
        assert.equal(errorLabel.label, error);
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

test("locked credentials cannot be edited and rejected changes show an error", async () => {
    const key = SETTINGS_CREDENTIALS_PATH;
    const path = "/tmp/current.json";
    const settings = settingsFixture({ [key]: path });
    settings.setLocked(key, true);
    const window = windowFixture();
    const page = createPreferencesPage(settings, metadata, window);
    const [row, error] = page.children[4].children;
    const [browse, reset] = row.children;
    assert.equal(browse.sensitive, false);
    assert.equal(reset.sensitive, false);
    settings.setLocked(key, false);
    assert.equal(browse.sensitive, true);
    assert.equal(reset.sensitive, true);

    settings.rejected.add(key);
    browse.emit("clicked");
    const dialog = dialogs.at(-1);
    dialog.file = toolkit.File.new_for_path("/tmp/selected.json");
    dialog.emit("response", toolkit.ResponseType.ACCEPT);
    await new Promise(setImmediate);
    assert.equal(row.subtitle, path);
    assert.equal(error.visible, true);
    assert.match(error.label, /Could not save/);

    browse.emit("clicked");
    dialogs.at(-1).emit("response", toolkit.ResponseType.CANCEL);
    assert.equal(error.visible, false);
    reset.emit("clicked");
    assert.equal(row.subtitle, path);
    assert.equal(error.visible, true);
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
    assert.deepEqual(
        group.children.map((row) => row.title),
        [
            "Auto-redeem expiring resets",
            "Auto-redeem on low remaining usage",
            "Wait for scheduled reset",
        ],
    );

    assert.equal(
        group.children[0].subtitle,
        "Redeem a banked reset automatically within 1 hour of expiry.",
    );
    assert.equal(settings.bindings[1].key, SETTINGS_AUTO_APPLY_BANKED_RESET);
    assert.equal(
        group.children[1].subtitle,
        "Redeem below 2% remaining unless the window resets soon.",
    );
    assert.deepEqual(settings.bindings[2], {
        key: SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE,
        row: group.children[1],
        property: "active",
        flags: 0,
    });

    assert.equal(settings.bindings[1].row, group.children[0]);
    assert.equal(settings.bindings[1].property, "active");

    const skipPeriods = group.children[2];
    assert.equal(skipPeriods.sensitive, false);
    settings.set_boolean(SETTINGS_AUTO_APPLY_BANKED_RESET, true);
    assert.equal(skipPeriods.sensitive, false);
    settings.set_boolean(SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE, true);
    assert.equal(skipPeriods.sensitive, true);
    settings.set_boolean(SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE, false);
    assert.equal(skipPeriods.sensitive, false);
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
        assert.equal(
            toggle.subtitle,
            "Notify when a usage window runs low, is exhausted, or resets after exhaustion.",
        );
        assert.equal(toggle.active, enabled);
        assert.equal(threshold.title, "Warning threshold (% left)");
        assert.equal(threshold.value, 10);
        assert.equal(threshold.adjustment.lower, 1);
        assert.equal(threshold.adjustment.upper, 100);
        assert.equal(threshold.adjustment.step_increment, 1);
        assert.equal(threshold.digits, 0);
        assert.equal(threshold.sensitive, enabled);
        assert.deepEqual(settings.writes, []);
        assert.deepEqual(settings.bindings[0], {
            key: SETTINGS_USAGE_NOTIFICATIONS,
            row: toggle,
            property: "active",
            flags: 0,
        });
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

test("usage auto-redemption settings preserve independent toggles", () => {
    for (const enabled of [false, true]) {
        const settings = settingsFixture({
            [SETTINGS_AUTO_APPLY_BANKED_RESET]: !enabled,
            [SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE]: enabled,
        });
        const result = readSettings(settings);
        assert.equal(result.autoApplyBankedReset, !enabled);
        assert.equal(result.autoApplyBankedResetOnUsage, enabled);
        assert.deepEqual(settings.writes, []);
    }
});

test("usage auto-redemption schema is opt-in and has no threshold setting", () => {
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
    assert.doesNotMatch(schema, /<key name="auto-apply-banked-reset-usage-threshold"/);
});

test("skip inputs display minutes and persist independent window overrides", async (t) => {
    const settings = settingsFixture({ [SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE]: true });
    const window = windowFixture();
    const quotas = [
        { id: "weekly", label: "Weekly", limitWindowSeconds: 604_800 },
        { id: "session", label: "5 hours", limitWindowSeconds: 18_000 },
    ];
    t.mock.method(cache, "read", async () => ({ quotas }));
    const page = createPreferencesPage(settings, metadata, window);
    await new Promise(setImmediate);
    const skipPeriods = page.children[2].children[2];
    const [session, weekly] = skipPeriods.children;
    assert.equal(skipPeriods.subtitle, "Keep banked reset if scheduled reset comes soon.");
    assert.equal(skipPeriods.expanded, true);
    assert.deepEqual(
        [session.title, weekly.title],
        ["5 hour window (minutes)", "Weekly window (minutes)"],
    );
    assert.deepEqual([session.value, weekly.value], [30, 720]);
    assert.deepEqual([session.adjustment.upper, weekly.adjustment.upper], [300, 10_080]);
    assert.deepEqual([session.adjustment.step_increment, weekly.adjustment.step_increment], [1, 1]);
    assert.deepEqual(settings.writes, []);

    const setValue = (control, value) => {
        control.value = value;
        control.emit("notify::value");
    };
    setValue(session, 75);
    setValue(weekly, 510);
    const key = SETTINGS_BANKED_RESET_SKIP_MINUTES;
    assert.deepEqual(settings.get_value(key).deep_unpack(), { session: 75, weekly: 510 });

    setValue(session, 300);
    setValue(weekly, 0);
    assert.deepEqual(settings.get_value(key).deep_unpack(), { session: 300, weekly: 0 });

    const writes = settings.writes.length;
    settings.set_value(key, new toolkit.Variant("a{su}", { weekly: 90 }));
    assert.deepEqual([session.value, weekly.value], [30, 90]);
    session.emit("notify::value");
    weekly.emit("notify::value");
    assert.equal(settings.writes.length, writes + 1);

    window.close();
    assert.deepEqual(skipPeriods.children, []);
    assert.equal(settings.signals.size, 0);
});

test("manual controls track locks and restore stored values after rejected writes", async (t) => {
    const weekly = { id: "weekly", label: "Weekly", limitWindowSeconds: 604_800 };
    t.mock.method(cache, "read", async () => ({ quotas: [weekly] }));
    const settings = settingsFixture({
        [SETTINGS_USAGE_NOTIFICATIONS]: true,
        [SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE]: true,
    });
    const window = windowFixture();
    const page = createPreferencesPage(settings, metadata, window);
    await new Promise(setImmediate);
    const percent = page.children[0].children[0];
    const threshold = page.children[1].children[1];
    const skipPeriods = page.children[2].children[2];
    const refresh = page.children[3].children[0];
    for (const [key, row, property, value, sensitiveRow = row] of [
        [SETTINGS_PERCENT_DISPLAY_MODE, percent, "selected", 1],
        [SETTINGS_USAGE_NOTIFICATION_THRESHOLD, threshold, "value", 25],
        [SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES, refresh, "value", 15],
        [SETTINGS_BANKED_RESET_SKIP_MINUTES, skipPeriods.children[0], "value", 90, skipPeriods],
    ]) {
        assert.equal(sensitiveRow.sensitive, true);
        settings.setLocked(key, true);
        assert.equal(sensitiveRow.sensitive, false);
        settings.setLocked(key, false);
        assert.equal(sensitiveRow.sensitive, true);

        const stored = row[property];
        settings.rejected.add(key);
        row[property] = value;
        row.emit(`notify::${property}`);
        assert.equal(row[property], stored);
    }
    assert.deepEqual(settings.writes, []);
    window.close();
});

test("selecting and resetting credentials replaces skip controls without writing skip periods", async (t) => {
    const workPath = "/tmp/work.json";
    const defaultSnapshot = { quotas: [{ id: "default-id", label: "Default window" }] };
    const workSnapshot = { quotas: [{ id: "work-id", label: "Work window" }] };
    const reads = new Map();
    cache.read = (cancellable, path) =>
        new Promise((resolve) => reads.set(path, { cancellable, resolve }));
    t.after(() => {
        cache.read = async () => null;
    });
    const settings = settingsFixture();
    const window = windowFixture();
    const page = createPreferencesPage(settings, metadata, window);
    const row = page.children[2].children[2];
    const [browse, reset] = page.children[4].children[0].children;
    const selectWork = async () => {
        browse.emit("clicked");
        const dialog = dialogs.at(-1);
        dialog.file = toolkit.File.new_for_path(workPath);
        dialog.emit("response", toolkit.ResponseType.ACCEPT);
        await new Promise(setImmediate);
    };

    const titles = () => row.children.map(({ title }) => title);
    await new Promise(setImmediate);
    reads.get(DEFAULT_CREDENTIALS_PATH).resolve(defaultSnapshot);
    await new Promise(setImmediate);
    assert.deepEqual(titles(), ["Default window (minutes)"]);
    await selectWork();
    assert.equal(settings.get_string(SETTINGS_CREDENTIALS_PATH), workPath);
    assert.deepEqual(titles(), []);
    reads.get(workPath).resolve(workSnapshot);
    await new Promise(setImmediate);
    assert.deepEqual(titles(), ["Work window (minutes)"]);

    reset.emit("clicked");
    assert.deepEqual(titles(), []);
    await new Promise(setImmediate);
    reads.get(DEFAULT_CREDENTIALS_PATH).resolve(defaultSnapshot);
    await new Promise(setImmediate);
    assert.deepEqual(titles(), ["Default window (minutes)"]);
    assert.deepEqual(settings.writes, [{ key: SETTINGS_CREDENTIALS_PATH, value: workPath }]);
    window.close();
});

test("usage controls follow cache writes, including a cache that no longer matches", async (t) => {
    const path = "/tmp/new-account.json";
    let snapshot = null;
    cache.read = async () => snapshot;
    t.after(() => {
        cache.read = async () => null;
    });
    const settings = settingsFixture();
    const window = windowFixture();
    const page = createPreferencesPage(settings, metadata, window);
    const row = page.children[2].children[2];

    settings.set_string(SETTINGS_CREDENTIALS_PATH, path);
    await new Promise(setImmediate);
    assert.deepEqual(row.children, []);
    const monitor = fileMonitors.get("/tmp");
    assert.ok(monitor);
    const file = toolkit.File.new_for_path(`${path}.snapshot.json`);
    const temporaryFile = toolkit.File.new_for_path("/tmp/cache-temp");
    snapshot = { quotas: [{ id: "weekly", label: "Weekly window" }] };
    monitor.emit("changed", temporaryFile);
    await new Promise(setImmediate);
    assert.deepEqual(row.children, []);
    monitor.emit("changed", temporaryFile, file);
    await new Promise(setImmediate);
    assert.deepEqual(
        row.children.map(({ title }) => title),
        ["Weekly window (minutes)"],
    );
    assert.equal(row.expanded, true);

    snapshot = null;
    monitor.emit("changed", file);
    await new Promise(setImmediate);
    assert.deepEqual(row.children, []);
    assert.equal(row.enable_expansion, false);
    assert.deepEqual(settings.writes, [{ key: SETTINGS_CREDENTIALS_PATH, value: path }]);
    window.close();
    assert.equal(monitor.cancelled, true);
    assert.deepEqual(monitor.signals, {});
});

test("switching credentials again or closing the window cancels usage cache work", async (t) => {
    const reads = [];
    cache.read = (cancellable) => new Promise((resolve) => reads.push({ cancellable, resolve }));
    t.after(() => {
        cache.read = async () => null;
    });
    const settings = settingsFixture();
    const window = windowFixture();
    const page = createPreferencesPage(settings, metadata, window);
    const row = page.children[2].children[2];
    const paths = ["/tmp/first.json", "/tmp/current.json"];
    const switchTo = async (path) => {
        settings.set_string(SETTINGS_CREDENTIALS_PATH, path);
        assert.deepEqual(row.children, []);
        await new Promise(setImmediate);
        return fileMonitors.get("/tmp");
    };
    const firstMonitor = await switchTo(paths[0]);
    const firstAuthMonitor = fileMonitors.get(paths[0]);
    const currentMonitor = await switchTo(paths[1]);
    const currentAuthMonitor = fileMonitors.get(paths[1]);
    assert.equal(reads[0].cancellable.is_cancelled(), true);
    for (const monitor of [firstMonitor, firstAuthMonitor]) {
        assert.equal(monitor.cancelled, true);
        assert.deepEqual(monitor.signals, {});
    }

    reads[1].resolve({ quotas: [{ id: "current", label: "Current window" }] });
    await new Promise(setImmediate);
    assert.deepEqual(
        row.children.map(({ title }) => title),
        ["Current window (minutes)"],
    );
    reads[0].resolve({ quotas: [{ id: "stale", label: "Stale window" }] });
    await new Promise(setImmediate);
    assert.deepEqual(
        row.children.map(({ title }) => title),
        ["Current window (minutes)"],
    );

    currentAuthMonitor.emit("changed");
    window.close();
    assert.equal(reads[2].cancellable.is_cancelled(), true);
    for (const monitor of [currentMonitor, currentAuthMonitor]) {
        assert.equal(monitor.cancelled, true);
        assert.deepEqual(monitor.signals, {});
    }
    reads[2].resolve({ quotas: [{ id: "late", label: "Late window" }] });
    await new Promise(setImmediate);
    assert.deepEqual(row.children, []);
    assert.deepEqual(
        settings.writes,
        paths.map((value) => ({ key: SETTINGS_CREDENTIALS_PATH, value })),
    );

    settings.set_string(SETTINGS_CREDENTIALS_PATH, paths[0]);
    await new Promise(setImmediate);
    assert.equal(reads.length, 3);
    assert.deepEqual(row.children, []);
});

test("preferences add the native page before the cache or changelog reads finish", async (t) => {
    const snapshot = Promise.withResolvers();
    const changelog = Promise.withResolvers();
    const readSnapshot = t.mock.method(cache, "read", () => snapshot.promise);
    t.mock.method(cache, "readChangelog", () => changelog.promise);
    const prefs = new CodexMeterPreferences();
    const settings = settingsFixture();
    prefs.getSettings = () => settings;
    prefs.metadata = metadata;
    const window = windowFixture();

    const pending = prefs.fillPreferencesWindow(window);
    assert.equal(window.children.length, 1);
    const [page] = window.children;
    assert.ok(page instanceof toolkit.PreferencesPage);
    assert.equal(page.title, "Codex Meter");
    const row = page.children[2].children[2];
    const [version, aboutLink] = page.children.at(-1).children[0].children;
    assert.deepEqual(row.children, []);
    assert.equal(version.label, "Codex Meter test");

    await new Promise(setImmediate);
    assert.equal(readSnapshot.mock.callCount(), 1);
    snapshot.resolve({ quotas: [{ id: "cached-id", label: "Cached window" }] });
    await new Promise(setImmediate);
    assert.deepEqual(
        row.children.map(({ title }) => title),
        ["Cached window (minutes)"],
    );

    changelog.resolve("## v0.13.0\n\n### Added\n\n- Latest feature.");
    await pending;
    assert.deepEqual(window.children, [page]);
    aboutLink.emit("activate-link");
    const about = aboutWindows.at(-1);
    assert.equal(about.release_notes_version, "0.13.0");
    assert.equal(
        about.release_notes,
        "<p><em>Added</em></p>\n<ul>\n<li>Latest feature.</li>\n</ul>",
    );
    assert.equal(window.close(), false);
    assert.equal(settings.signals.size, 0);
});

test("preferences entry point tolerates an empty usage cache", async () => {
    const prefs = new CodexMeterPreferences();
    const settings = settingsFixture();
    prefs.getSettings = () => settings;
    prefs.metadata = metadata;
    const window = windowFixture();
    await prefs.fillPreferencesWindow(window);
    const row = window.children[0].children[2].children[2];
    assert.deepEqual(row.children, []);
    assert.equal(row.enable_expansion, false);
    assert.deepEqual(settings.writes, []);
    assert.equal(window.close(), false);
    assert.equal(settings.signals.size, 0);
});

test("closing preferences disconnects every settings callback without preventing close", () => {
    const settings = settingsFixture();
    const window = windowFixture();
    const page = createPreferencesPage(settings, metadata, window);
    const [percent, icon, display] = page.children[0].children;
    const [refresh] = page.children[3].children;
    const signalIds = [...settings.signals.keys()];

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
    const signalsPerWindow = settings.signals.size;

    for (let i = 0; i < 3; i++) {
        const window = windowFixture();
        const page = createPreferencesPage(settings, metadata, window);
        const icon = page.children[0].children[1];
        assert.equal(settings.signals.size, 2 * signalsPerWindow);
        settings.set_string(SETTINGS_TOP_PANEL_INDICATOR_ICON, "openai");
        assert.equal(firstIcon.selected, 1);
        assert.equal(icon.selected, 1);

        assert.equal(window.close(), false);
        assert.equal(settings.signals.size, signalsPerWindow);
        settings.set_string(SETTINGS_TOP_PANEL_INDICATOR_ICON, "text");
        assert.equal(firstIcon.selected, 2);
        assert.equal(icon.selected, 1);
    }

    assert.equal(firstWindow.close(), false);
    assert.equal(settings.signals.size, 0);
    assert.equal(settings.disconnected.length, 4 * signalsPerWindow);
});
