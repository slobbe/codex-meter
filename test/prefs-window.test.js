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
const { changelog } = await import(stubUrl);

function fixture() {
    const prefs = new CodexMeterPreferences();
    prefs.path = "/extension";
    prefs.settings = {};
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
