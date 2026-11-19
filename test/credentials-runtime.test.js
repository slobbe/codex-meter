import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import test from "node:test";
import {
    SETTINGS_CREDENTIALS_PATH,
    SETTINGS_TOP_PANEL_DISPLAY_MODE,
    SETTINGS_TOP_PANEL_INDICATOR_ICON,
    SETTINGS_USAGE_NOTIFICATIONS,
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
    export const canonicalize_filename = path => resolve(path);
    export default { canonicalize_filename };
    export const resolveCredentialsPath = path => path.replace(/^~\\//, '/accounts/');
    export const NotificationDestroyedReason = { SOURCE_CLOSED: 3 };
    export const messageTray = {
        sources: new Set(),
        add(source) { this.sources.add(source); }
    };
    class SignalEmitter {
        handlers = new Map();
        nextId = 1;
        connect(signal, handler) {
            const id = this.nextId++;
            this.handlers.set(id, { signal, handler });
            return id;
        }
        disconnect(id) {
            if (!this.handlers.delete(id)) throw new Error('Unknown handler: ' + id);
        }
        handlersFor(signal) {
            return [...this.handlers.values()].filter(entry => entry.signal === signal)
                .map(entry => entry.handler);
        }
        emit(signal) {
            for (const handler of this.handlersFor(signal)) handler(this);
        }
    }
    class TestNotification extends SignalEmitter {
        acknowledged = false;
        show() {
            this.acknowledged = true;
            this.emit('notify::acknowledged');
        }
        destroy() {
            this.destroyed = true;
            this.emit('destroy');
            this.source.notifications.splice(this.source.notifications.indexOf(this), 1);
        }
    }
    class TestSource extends SignalEmitter {
        notifications = [];
        submit(notification) {
            this.notifications.push(notification);
            messageTray.onSubmit?.(notification);
        }
        destroy(reason) {
            if (this.destroyed) throw new Error('Already destroyed');
            this.destroyed = true;
            this.reason = reason;
            for (const notification of [...this.notifications]) notification.destroy();
            messageTray.sources.delete(this);
            this.emit('destroy');
        }
    }
    export let Source;
    export let Notification;
    export function useShellApi(legacy) {
        Source = legacy ? class extends TestSource {
            constructor(title, iconName) { super(); Object.assign(this, { title, iconName }); }
            showNotification(notification) { this.submit(notification); }
        } : class extends TestSource {
            constructor(params) { super(); Object.assign(this, params); }
            addNotification(notification) { this.submit(notification); }
        };
        Notification = legacy ? class extends TestNotification {
            constructor(source, title, body) { super(); Object.assign(this, { source, title, body }); }
            setTransient(isTransient) { this.isTransient = isTransient; }
        } : class extends TestNotification {
            constructor(params) { super(); Object.assign(this, params); }
        };
    }
    export function notify(title, body) { sharedSource.notifications.push({ title, body }); }
    export const sharedSource = new TestSource();
    export function resolve(path) { return new URL(path, 'file:///work/').pathname; }
`)}`;
const dependencies = new Set([
    "gi://GLib",
    "./codex/auth/auth.js",
    "resource:///org/gnome/shell/ui/messageTray.js",
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
let runtime, messageTray, sharedSource, useShellApi;
try {
    ({ default: CodexMeterExtension } = await import(extensionUrl));
    ({ runtime, messageTray, sharedSource, useShellApi } = await import(stubUrl));
} finally {
    hooks.deregister();
}

function fixture(t, credentialsPath = "/accounts/first/auth.json") {
    for (const entries of Object.values(runtime)) entries.length = 0;
    const values = new Map([
        [SETTINGS_CREDENTIALS_PATH, credentialsPath],
        [SETTINGS_USAGE_NOTIFICATIONS, false],
        [SETTINGS_TOP_PANEL_DISPLAY_MODE, "bars"],
        [SETTINGS_TOP_PANEL_INDICATOR_ICON, "codex-ring"],
    ]);
    const listeners = new Map();
    useShellApi(false);
    messageTray.sources.clear();
    messageTray.onSubmit = null;
    sharedSource.notifications.length = 0;
    messageTray.add(sharedSource);
    const disconnected = [];
    const reads = [];
    let nextId = 1;
    const settings = {
        get_string(key) {
            assert.ok(values.has(key), `Unexpected setting: ${key}`);
            reads.push(key);
            return values.get(key);
        },
        set_string: setValue,
        set_boolean: setValue,
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
    function setValue(key, value) {
        values.set(key, value);
        for (const { signal, callback } of [...listeners.values()]) {
            if (signal === `changed::${key}`) callback(settings, key);
        }
    }
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

for (const legacy of [true, false]) {
    test(`credential switch and disable remove only Codex Meter alerts (Shell ${legacy ? "45" : "46+"})`, (t) => {
        const { settings, enable, disable } = fixture(t);
        useShellApi(legacy);
        const unrelated = { title: "Unrelated notification" };
        sharedSource.notifications.push(unrelated);
        assert.deepEqual([...messageTray.sources], [sharedSource]);
        enable();
        assert.deepEqual([...messageTray.sources], [sharedSource]);

        const notifyA = runtime.monitors[0].args[1];
        notifyA("A low");
        notifyA("A exhausted");
        const [, sourceA] = messageTray.sources;
        assert.ok(sourceA, "Expected a separate Codex Meter source");
        const alertsA = [...sourceA.notifications];
        assert.equal(sourceA.title, "Codex Meter");
        assert.deepEqual(
            alertsA.map(({ title, body, isTransient }) => [title, body, isTransient]),
            [
                ["Codex Meter", "A low", true],
                ["Codex Meter", "A exhausted", true],
            ],
        );

        settings.set_string(SETTINGS_CREDENTIALS_PATH, "/accounts/second/auth.json");
        assert.equal(sourceA.reason, 3);
        assert.ok(alertsA.every((alert) => alert.destroyed));
        notifyA("Late A alert");
        assert.deepEqual([...messageTray.sources], [sharedSource]);

        const notifyB = runtime.monitors[1].args[1];
        notifyB("B low");
        const [, expiredSource] = messageTray.sources;
        expiredSource.destroy(); // Shell can destroy the source when its last transient alert expires.
        notifyB("B exhausted");
        const [, sourceB] = messageTray.sources;
        assert.notEqual(sourceB, expiredSource);
        const [alertB] = sourceB.notifications;
        disable();
        assert.equal(sourceB.reason, 3);
        assert.ok(alertB.destroyed);
        notifyB("Late B alert");
        assert.deepEqual([...messageTray.sources], [sharedSource]);
        assert.deepEqual(sharedSource.notifications, [unrelated]);
    });

    test(`A → B → A retries only unshown alerts and ignores stale signals (Shell ${legacy ? "45" : "46+"})`, (t) => {
        const { settings, enable, disable } = fixture(t);
        useShellApi(legacy);
        enable();
        const monitorA = runtime.monitors.at(-1);
        const deliveries = [];
        // Model the monitor contract: reserve while pending, deduplicate only after delivery.
        function offer(monitor, message) {
            const [, notify, , states] = monitor.args;
            if (states.has(message)) return;
            states.set(message, "pending");
            notify(message, (shown) => {
                deliveries.push([monitor.id, message, shown]);
                if (shown) states.set(message, "shown");
                else states.delete(message);
            });
        }
        messageTray.onSubmit = (alert) => alert.show();
        offer(monitorA, "A low");
        messageTray.onSubmit = null;
        offer(monitorA, "A exhausted");
        const [, sourceA] = messageTray.sources;
        const [shownA, queuedA] = sourceA.notifications;
        const staleAcknowledged = queuedA.handlersFor("notify::acknowledged");
        const staleDestroy = sourceA.handlersFor("destroy");
        assert.deepEqual(deliveries, [[0, "A low", true]]);
        assert.equal(shownA.handlers.size, 0);

        settings.set_string(SETTINGS_CREDENTIALS_PATH, "/accounts/second/auth.json");
        assert.ok(queuedA.destroyed);
        assert.equal(queuedA.handlers.size, 0);
        assert.deepEqual([...messageTray.sources], [sharedSource]);
        const monitorB = runtime.monitors.at(-1);
        offer(monitorB, "B low");
        const [, sourceB] = messageTray.sources;
        const [queuedB] = sourceB.notifications;
        settings.set_string(SETTINGS_CREDENTIALS_PATH, "/accounts/first/./auth.json");
        assert.ok(queuedB.destroyed);
        const nextMonitorA = runtime.monitors.at(-1);
        offer(nextMonitorA, "A low");
        offer(nextMonitorA, "A exhausted");
        const [, nextSourceA] = messageTray.sources;
        assert.deepEqual(
            nextSourceA.notifications.map((alert) => alert.body),
            ["A exhausted"],
        );

        queuedA.acknowledged = true;
        for (const handler of staleAcknowledged) handler(queuedA);
        for (const handler of staleDestroy) handler(sourceA);
        monitorA.args[1]("Old runtime A", (shown) => deliveries.push([0, "stale", shown]));
        assert.deepEqual(deliveries, [
            [0, "A low", true],
            [0, "A exhausted", false],
            [1, "B low", false],
            [0, "stale", false],
        ]);
        const [retriedA] = nextSourceA.notifications;
        disable();
        assert.equal(deliveries.length, 5);
        assert.deepEqual(deliveries.at(-1), [2, "A exhausted", false]);
        assert.ok(retriedA.destroyed);
        assert.equal(retriedA.handlers.size, 0);
        assert.deepEqual([...messageTray.sources], [sharedSource]);
    });
}

test("Shell can drop a pending alert without a credential switch", (t) => {
    const { enable } = fixture(t);
    enable();
    const notify = runtime.monitors[0].args[1];
    const deliveries = [];
    notify("Dropped by Shell", (shown) => deliveries.push(shown));
    const [, source] = messageTray.sources;
    const [dropped] = source.notifications;
    assert.deepEqual(deliveries, []);
    dropped.destroy();
    assert.deepEqual(deliveries, [false]);
    assert.equal(dropped.handlers.size, 0);
});

test("A → B → A reuses only A's normalized-path dedup state until disable", (t) => {
    const { settings, enable, disable } = fixture(t, "~/first/auth.json");
    enable();
    const stateA = runtime.monitors[0].args[3];
    assert.ok(stateA instanceof Map);
    stateA.set("session", { warned: true });

    settings.set_string(SETTINGS_CREDENTIALS_PATH, "/accounts/second/auth.json");
    const stateB = runtime.monitors[1].args[3];
    assert.notEqual(stateB, stateA);
    assert.equal(stateB.size, 0);
    stateB.set("session", { exhausted: true });

    settings.set_string(SETTINGS_CREDENTIALS_PATH, "/accounts/first/./auth.json");
    assert.equal(runtime.monitors[2].args[3], stateA);
    assert.deepEqual(stateA.get("session"), { warned: true });

    settings.set_boolean(SETTINGS_USAGE_NOTIFICATIONS, true);
    assert.equal(stateA.size, 0);
    assert.equal(stateB.size, 0);
    stateA.set("session", { warned: true });
    settings.set_string(SETTINGS_CREDENTIALS_PATH, "/accounts/second/auth.json");
    assert.equal(runtime.monitors[3].args[3], stateB);
    assert.equal(stateB.size, 0);
    stateB.set("session", { warned: true });
    disable();
    enable();
    assert.notEqual(runtime.monitors[4].args[3], stateB);
    assert.equal(runtime.monitors[4].args[3].size, 0);
});

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
    assert.equal(monitor.args.length, 4);
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
        ["changed::usage-notifications", "changed::credentials-path"],
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
    assert.equal(listeners.size, 2);
});

test("path switches retain the extension listeners, which disconnect on disable", (t) => {
    const { settings, listeners, disconnected, enable, disable } = fixture(t);
    enable();
    const listenerIds = [...listeners.keys()];
    for (const [index, path] of [
        "/accounts/second/auth.json",
        "/accounts/third/auth.json",
        "/accounts/first/auth.json",
    ].entries()) {
        settings.set_string(SETTINGS_CREDENTIALS_PATH, path);
        assert.equal(runtime.monitors.length, index + 2);
        assert.equal(runtime.indicators.length, index + 2);
        assert.equal(runtime.monitors.at(-1).args[2], path);
        assert.deepEqual([...listeners.keys()], listenerIds);
    }

    disable();
    assert.equal(listeners.size, 0);
    assert.deepEqual([...disconnected].sort(), listenerIds);
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
    assert.equal(listeners.size, 2);
    assert.equal(runtime.monitors.at(-1).args[2], "/accounts/disabled/auth.json");
    settings.set_string(SETTINGS_CREDENTIALS_PATH, "/accounts/reenabled/auth.json");
    assert.equal(runtime.monitors.length, 6);
    assert.equal(runtime.indicators.length, 6);
    assert.equal(runtime.monitors.at(-1).args[2], "/accounts/reenabled/auth.json");
    assert.equal(listeners.size, 2);
    disable();
    assert.equal(listeners.size, 0);
    assert.equal(disconnected.length, 4);
});
