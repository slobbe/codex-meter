import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import {
    SETTINGS_CREDENTIALS_PATH,
    SETTINGS_TOP_PANEL_DISPLAY_MODE,
    SETTINGS_TOP_PANEL_INDICATOR_ICON,
} from "../src/preferences/settings.js";

const extensionUrl = new URL("../src/extension.js", import.meta.url).href;
const stubUrl = `data:text/javascript,${encodeURIComponent(`
    export const runtime = { monitors: [], indicators: [], events: [], panel: [] };
    export class Extension {
        getSettings() { return this.settings; }
    }
    export class CodexMonitor {
        constructor(...args) {
            this.args = args;
            this.id = runtime.monitors.length;
            runtime.monitors.push(this);
            runtime.events.push('construct monitor ' + this.id);
        }
        start() { runtime.events.push('start monitor ' + this.id); }
        stop() { runtime.events.push('stop monitor ' + this.id); }
    }
    export class CodexMeterIndicator {
        constructor(extension, monitor) {
            this.extension = extension;
            this.monitor = monitor;
            this.id = runtime.indicators.length;
            runtime.indicators.push(this);
            runtime.events.push('construct indicator ' + this.id);
        }
        start() { runtime.events.push('start indicator ' + this.id); }
        destroy() { runtime.events.push('destroy indicator ' + this.id); }
    }
    export const panel = {
        addToStatusArea(uuid, indicator) { runtime.panel.push([uuid, indicator]); }
    };
    export const notify = () => {};
`)}`;
const dependencies = new Set([
    "resource:///org/gnome/shell/ui/main.js",
    "resource:///org/gnome/shell/extensions/extension.js",
    "./background/monitor.js",
    "./panel/indicator.js",
]);
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (context.parentURL === extensionUrl && dependencies.has(specifier)) {
            return { url: stubUrl, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});
let CodexMeterExtension;
let runtime;
try {
    ({ default: CodexMeterExtension } = await import(extensionUrl));
    ({ runtime } = await import(stubUrl));
} finally {
    hooks.deregister();
}

function fixture(t, credentialsPath = "/accounts/first/auth.json") {
    for (const entries of Object.values(runtime)) entries.length = 0;
    const values = new Map([
        [SETTINGS_CREDENTIALS_PATH, credentialsPath],
        [SETTINGS_TOP_PANEL_DISPLAY_MODE, "bars"],
        [SETTINGS_TOP_PANEL_INDICATOR_ICON, "codex-ring"],
    ]);
    const listeners = new Map();
    const disconnected = [];
    const reads = [];
    let nextId = 1;
    const settings = {
        get_string(key) {
            assert.ok(values.has(key), `Unexpected setting: ${key}`);
            reads.push(key);
            return values.get(key);
        },
        set_string(key, value) {
            values.set(key, value);
            for (const { signal, callback } of [...listeners.values()]) {
                if (signal === `changed::${key}`) callback(settings, key);
            }
        },
        connect(signal, callback) {
            const id = nextId++;
            listeners.set(id, { signal, callback });
            return id;
        },
        disconnect(id) {
            assert.ok(listeners.delete(id), `Unknown listener: ${id}`);
            disconnected.push(id);
        },
    };
    const extension = new CodexMeterExtension();
    extension.uuid = "codex-meter@test";
    extension.settings = settings;
    let enabled = false;
    const enable = () => {
        extension.enable();
        enabled = true;
    };
    const disable = () => {
        extension.disable();
        enabled = false;
    };
    t.after(() => {
        if (enabled) disable();
    });
    return { extension, settings, listeners, disconnected, reads, values, enable, disable };
}

test("enable reads credentials-path and starts the monitor and its panel indicator", (t) => {
    const { extension, settings, listeners, reads, values, enable } = fixture(
        t,
        "~/custom account/auth.json",
    );
    enable();

    assert.ok(reads.includes("credentials-path"));
    assert.equal(values.get(SETTINGS_TOP_PANEL_DISPLAY_MODE), "circular-bars");
    assert.equal(values.get(SETTINGS_TOP_PANEL_INDICATOR_ICON), "codex");
    assert.equal(runtime.monitors.length, 1);
    const [monitor] = runtime.monitors;
    assert.equal(monitor.args.length, 3);
    assert.equal(monitor.args[0], settings);
    assert.equal(typeof monitor.args[1], "function");
    assert.equal(monitor.args[2], "~/custom account/auth.json");
    assert.equal(runtime.indicators.length, 1);
    const [indicator] = runtime.indicators;
    assert.equal(indicator.extension, extension);
    assert.equal(indicator.monitor, monitor);
    assert.deepEqual(runtime.panel, [[extension.uuid, indicator]]);
    assert.deepEqual(runtime.events, [
        "construct monitor 0",
        "construct indicator 0",
        "start indicator 0",
        "start monitor 0",
    ]);
    assert.deepEqual(
        [...listeners.values()].map(({ signal }) => signal),
        ["changed::credentials-path"],
    );
});

test("credentials-path changes stop and destroy the old runtime before starting its replacement", (t) => {
    const { extension, settings, listeners, enable } = fixture(t);
    enable();
    runtime.events.length = 0;

    settings.set_string(SETTINGS_CREDENTIALS_PATH, "/accounts/second/auth.json");

    assert.equal(runtime.monitors.length, 2);
    assert.equal(runtime.indicators.length, 2);
    assert.equal(runtime.monitors[1].args[0], settings);
    assert.equal(runtime.monitors[1].args[2], "/accounts/second/auth.json");
    assert.equal(runtime.indicators[1].extension, extension);
    assert.equal(runtime.indicators[1].monitor, runtime.monitors[1]);
    assert.deepEqual(runtime.panel[1], [extension.uuid, runtime.indicators[1]]);
    assert.deepEqual(runtime.events, [
        "stop monitor 0",
        "destroy indicator 0",
        "construct monitor 1",
        "construct indicator 1",
        "start indicator 1",
        "start monitor 1",
    ]);
    assert.equal(listeners.size, 1);
});

test("repeated path switches retain one listener, disconnect on disable, and reconnect once on enable", (t) => {
    const { settings, listeners, disconnected, enable, disable } = fixture(t);
    enable();
    const [listenerId] = listeners.keys();
    for (const [index, path] of [
        "/accounts/second/auth.json",
        "/accounts/third/auth.json",
        "/accounts/first/auth.json",
    ].entries()) {
        settings.set_string(SETTINGS_CREDENTIALS_PATH, path);
        assert.equal(runtime.monitors.length, index + 2);
        assert.equal(runtime.indicators.length, index + 2);
        assert.equal(runtime.monitors.at(-1).args[2], path);
        assert.deepEqual([...listeners.keys()], [listenerId]);
    }

    disable();
    assert.equal(listeners.size, 0);
    assert.deepEqual(disconnected, [listenerId]);
    for (let id = 0; id < 4; id++) {
        assert.equal(runtime.events.filter((event) => event === `stop monitor ${id}`).length, 1);
        assert.equal(
            runtime.events.filter((event) => event === `destroy indicator ${id}`).length,
            1,
        );
    }
    const eventsAfterDisable = [...runtime.events];
    settings.set_string(SETTINGS_CREDENTIALS_PATH, "/accounts/disabled/auth.json");
    assert.deepEqual(runtime.events, eventsAfterDisable);
    assert.equal(runtime.monitors.length, 4);
    assert.equal(runtime.indicators.length, 4);
    assert.equal(runtime.panel.length, 4);

    enable();
    assert.equal(listeners.size, 1);
    assert.equal(runtime.monitors.at(-1).args[2], "/accounts/disabled/auth.json");
    settings.set_string(SETTINGS_CREDENTIALS_PATH, "/accounts/reenabled/auth.json");
    assert.equal(runtime.monitors.length, 6);
    assert.equal(runtime.indicators.length, 6);
    assert.equal(runtime.monitors.at(-1).args[2], "/accounts/reenabled/auth.json");
    assert.equal(listeners.size, 1);
    disable();
    assert.equal(listeners.size, 0);
    assert.equal(disconnected.length, 2);
});
