import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const stubUrl = `data:text/javascript,${encodeURIComponent(`
    export default {
        PRIORITY_DEFAULT: 0,
        SOURCE_CONTINUE: true,
        SOURCE_REMOVE: false,
        timeout_add_seconds() {},
        source_remove() {},
    };
`)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "gi://GLib") return { url: stubUrl, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});
let PeriodicTask;
try {
    ({ PeriodicTask } = await import("../src/background/periodic-task.js"));
} finally {
    hooks.deregister();
}
const { default: GLib } = await import(stubUrl);

// Capture logging in Node instead of installing a native GLib log writer in GJS.
for (const asynchronous of [false, true]) {
    test(`${asynchronous ? "asynchronous" : "synchronous"} task failure is logged and releases the overlap guard for retry`, async (t) => {
        const errorLog = t.mock.method(console, "error", () => {});
        const removeSource = t.mock.method(GLib, "source_remove", () => true);
        let tick;
        t.mock.method(GLib, "timeout_add_seconds", (_priority, _seconds, callback) => {
            tick = callback;
            return 1;
        });
        const failure = new Error("expected task failure");
        let calls = 0;
        const work = () => {
            calls++;
            if (calls === 1) throw failure;
        };
        const task = new PeriodicTask(10, asynchronous ? async () => work() : work);

        try {
            task.start();
            await Promise.resolve();

            assert.equal(errorLog.mock.callCount(), 1, "failure is logged once");
            assert.deepEqual(errorLog.mock.calls[0].arguments, ["Periodic task failed", failure]);
            assert.equal(task.running, false, "failure clears overlap guard");
            assert.equal(task.started, true, "failure does not stop the task");
            assert.equal(task.timeoutId, 1, "failure preserves the timer");
            assert.equal(tick(), GLib.SOURCE_CONTINUE, "timer survives");
            assert.equal(calls, 2, "next tick retries work");
            await Promise.resolve();
            assert.equal(task.running, false, "successful retry clears overlap guard");
            assert.equal(errorLog.mock.callCount(), 1, "successful retry does not log an error");
        } finally {
            task.stop();
        }
        assert.equal(removeSource.mock.callCount(), 1);
        assert.deepEqual(removeSource.mock.calls[0].arguments, [1]);
    });
}
