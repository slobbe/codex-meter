import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const prefsUrl = new URL("../src/prefs.js", import.meta.url).href;
const stubUrl = `data:text/javascript,${encodeURIComponent(`
    export const changelog = { read: async () => "" };
    export const readFile = (...args) => changelog.read(...args);

    export class ExtensionPreferences {
        getSettings() { return this.settings; }
    }
    export const createPreferencesPage = (settings, metadata, window, getReleaseNotes) =>
        ({ settings, getReleaseNotes });
    export const display = { theme: null };
    export const toplevels = {
        windows: new Set(),
        handlers: new Set(),
        connect(signal, callback) {
            if (signal !== "items-changed") throw new Error(signal);
            this.handlers.add(callback);
            return callback;
        },
        disconnect(callback) { this.handlers.delete(callback); },
        remove(window) {
            this.windows.delete(window);
            for (const callback of this.handlers) callback(this, 0, 1, 0);
        },
    };
    export default {
        IconTheme: { get_for_display: (display) => display.theme },
        Window: {
            get_toplevels: () => toplevels,
            list_toplevels: () => [...toplevels.windows],
        },
        Cancellable: class {
            cancelled = false;
            cancel() { this.cancelled = true; }
            is_cancelled() { return this.cancelled; }
        },
    };
`)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (
            context.parentURL === prefsUrl &&
            (specifier.startsWith("gi://") ||
                specifier.startsWith("resource://") ||
                ["./io/files.js", "./preferences/page.js"].includes(specifier))
        ) {
            return { url: stubUrl, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});
let CodexMeterPreferences;
try {
    ({ default: CodexMeterPreferences } = await import(prefsUrl));
} finally {
    hooks.deregister();
}
const { changelog, display, toplevels } = await import(stubUrl);

function fixture() {
    const prefs = new CodexMeterPreferences();
    prefs.path = "/extension";
    prefs.settings = {};
    const window = {
        pages: [],
        get_display: () => (display.theme ? display : null),
        add(page) {
            this.pages.push(page);
        },
        connect(signal, callback) {
            assert.equal(signal, "close-request");
            this.close = callback;
        },
    };
    if (display.theme) toplevels.windows.add(window);
    return { prefs, window };
}

function themeFixture(t, searchPath) {
    const theme = {
        get_search_path: () => [...searchPath],
        add_search_path: (path) => searchPath.push(path),
        set_search_path: (paths) => {
            searchPath = paths;
        },
    };
    display.theme = theme;
    t.after(() => {
        display.theme = null;
    });
    return theme;
}

test("preferences open without What's New when the changelog cannot be read", async (t) => {
    t.mock.method(changelog, "read", async () => {
        throw new Error("No such file");
    });
    const { prefs, window } = fixture();

    await prefs.fillPreferencesWindow(window);

    assert.equal(window.pages.length, 1);
    assert.equal(window.pages[0].settings, prefs.settings);
    assert.equal(window.pages[0].getReleaseNotes(), null);
});

test("closing preferences cancels the changelog read and ignores its result", async (t) => {
    for (const outcome of ["success", "failure"]) {
        await t.test(outcome, async (t) => {
            const read = Promise.withResolvers();
            const load = t.mock.method(changelog, "read", () => read.promise);
            const { prefs, window } = fixture();
            const pending = prefs.fillPreferencesWindow(window);
            const [path, cancellable] = load.mock.calls[0].arguments;
            assert.equal(path, "/extension/CHANGELOG.md");
            const [page] = window.pages;

            assert.equal(window.close(), false);
            assert.equal(cancellable.is_cancelled(), true);
            if (outcome === "success") read.resolve("## v0.13.0\n- Latest feature.");
            else read.reject(new Error("Operation was cancelled"));
            await pending;

            assert.deepEqual(window.pages, [page]);
            assert.equal(page.getReleaseNotes(), null);
        });
    }
});

test("windows share one icon path until GTK removes the last owner", async (t) => {
    const iconPath = "/extension/icons";
    const theme = themeFixture(t, ["/original"]);
    const first = fixture();
    const second = fixture();
    const pending = first.prefs.fillPreferencesWindow(first.window);
    assert.deepEqual(theme.get_search_path(), ["/original", iconPath]);
    await second.prefs.fillPreferencesWindow(second.window);
    await pending;
    assert.deepEqual(theme.get_search_path(), ["/original", iconPath]);

    assert.equal(first.window.close(), false);
    toplevels.remove(first.window);
    assert.deepEqual(theme.get_search_path(), ["/original", iconPath]);
    theme.set_search_path(["/external", iconPath]);
    assert.equal(second.window.close(), false);
    assert.deepEqual(theme.get_search_path(), ["/external", iconPath]);
    toplevels.remove(second.window);
    assert.deepEqual(theme.get_search_path(), ["/external"]);

    const reopened = fixture();
    await reopened.prefs.fillPreferencesWindow(reopened.window);
    assert.deepEqual(theme.get_search_path(), ["/external", iconPath]);
    toplevels.remove(reopened.window);
    assert.deepEqual(theme.get_search_path(), ["/external"]);
    assert.equal(toplevels.handlers.size, 0);
});

test("preferences leave a pre-existing icon path untouched", async (t) => {
    const paths = ["/extension/icons", "/external"];
    const theme = themeFixture(t, [...paths]);
    const { prefs, window } = fixture();
    await prefs.fillPreferencesWindow(window);
    assert.deepEqual(theme.get_search_path(), paths);
    toplevels.remove(window);
    assert.deepEqual(theme.get_search_path(), paths);
});
