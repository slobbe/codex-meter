import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const prefsUrl = new URL("../src/prefs.js", import.meta.url).href;
const stubUrl = `data:text/javascript,${encodeURIComponent(`
    export const changelog = { read: async () => "" };
    export const readFile = (...args) => changelog.read(...args);
    export class UsageService {
        constructor(credentialsPath) { this.credentialsPath = credentialsPath; }
        async readCachedSnapshot() { return { credentialsPath: this.credentialsPath }; }
    }
    export class ExtensionPreferences {
        getSettings() { return this.settings; }
    }
    export const createPreferencesPage = (settings, metadata, window, snapshot, releaseNotes) =>
        ({ settings, snapshot, releaseNotes });
    export default {
        Display: { get_default: () => null },
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
                ["./codex/usage/service.js", "./io/files.js", "./preferences/page.js"].includes(
                    specifier,
                ))
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
const { changelog } = await import(stubUrl);

function fixture() {
    const prefs = new CodexMeterPreferences();
    prefs.path = "/extension";
    prefs.settings = { get_string: () => "/account/auth.json" };
    const window = {
        pages: [],
        add(page) {
            this.pages.push(page);
        },
        connect(signal, callback) {
            assert.equal(signal, "close-request");
            this.close = callback;
        },
    };
    return { prefs, window };
}

test("preferences open without What's New when the changelog cannot be read", async (t) => {
    t.mock.method(changelog, "read", async () => {
        throw new Error("No such file");
    });
    const { prefs, window } = fixture();

    await prefs.fillPreferencesWindow(window);

    assert.deepEqual(window.pages, [
        {
            settings: prefs.settings,
            snapshot: { credentialsPath: "/account/auth.json" },
            releaseNotes: null,
        },
    ]);
});

test("preferences use the new credentials snapshot when the path changes during changelog loading", async (t) => {
    const started = Promise.withResolvers();
    const read = Promise.withResolvers();
    t.mock.method(changelog, "read", () => {
        started.resolve();
        return read.promise;
    });
    const { prefs, window } = fixture();
    const pending = prefs.fillPreferencesWindow(window);
    await started.promise;

    prefs.settings.get_string = () => "/other-account/auth.json";
    read.resolve("");
    await pending;

    assert.equal(window.pages[0].snapshot.credentialsPath, "/other-account/auth.json");
});

test("a changelog read that rejects after close does not add a preferences page", async (t) => {
    const started = Promise.withResolvers();
    const read = Promise.withResolvers();
    t.mock.method(changelog, "read", (_path, cancellable) => {
        started.resolve(cancellable);
        return read.promise;
    });
    const { prefs, window } = fixture();
    const pending = prefs.fillPreferencesWindow(window);
    const cancellable = await started.promise;

    assert.equal(window.close(), false);
    assert.equal(cancellable.is_cancelled(), true);
    read.reject(new Error("Operation was cancelled"));
    await pending;

    assert.deepEqual(window.pages, []);
});
