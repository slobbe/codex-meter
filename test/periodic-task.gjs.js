import GLib from "gi://GLib";

import { PeriodicTask } from "../src/background/periodic-task.js";

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
    }
}

async function test(name, run) {
    const originalAdd = GLib.timeout_add_seconds;
    const originalRemove = GLib.source_remove;
    const sources = new Map();
    const removed = [];
    let nextId = 1;

    GLib.timeout_add_seconds = (priority, seconds, callback) => {
        assertEqual(priority, GLib.PRIORITY_DEFAULT, "timer priority");
        const id = nextId++;
        sources.set(id, { seconds, callback });
        return id;
    };
    GLib.source_remove = (id) => {
        assertEqual(sources.delete(id), true, "removed source must exist");
        removed.push(id);
        return true;
    };

    try {
        await run({ sources, removed });
        console.log(`PASS ${name}`);
    } finally {
        GLib.timeout_add_seconds = originalAdd;
        GLib.source_remove = originalRemove;
    }
}

await test("start schedules before running and repeated starts are inert", async ({ sources }) => {
    let calls = 0;
    const task = new PeriodicTask(30, () => {
        assertEqual(sources.size, 1, "timer exists before task runs");
        calls++;
    });

    task.start();
    const id = task.timeoutId;
    assertEqual(calls, 1, "start runs immediately");
    assertEqual(sources.get(id).seconds, 30, "scheduled interval");
    task.start();
    await Promise.resolve();
    task.start();
    assertEqual(calls, 1, "repeated start does not run again, even after completion");
    assertEqual(task.timeoutId, id, "repeated start keeps original timer");
    assertEqual(sources.size, 1, "only one timer exists");

    assertEqual(sources.get(id).callback(), GLib.SOURCE_CONTINUE, "timer repeats");
    assertEqual(calls, 2, "timer runs task after immediate run completes");
    task.stop();
});

await test("zero interval runs immediately without scheduling", async ({ sources }) => {
    let calls = 0;
    const task = new PeriodicTask(0, () => calls++);

    task.start();
    await Promise.resolve();
    task.start();
    assertEqual(calls, 1, "zero interval runs once per start");
    assertEqual(sources.size, 0, "zero interval has no timer");
    assertEqual(task.timeoutId, null, "zero interval has no timer ID");
    task.stop();
    task.start();
    assertEqual(calls, 2, "zero interval restart runs immediately");
    task.stop();
});

await test("pending work never overlaps, including across stop and restart", async ({
    sources,
}) => {
    let calls = 0;
    let resolve;
    const pending = new Promise((done) => {
        resolve = done;
    });
    const task = new PeriodicTask(10, () => {
        calls++;
        return pending;
    });

    task.start();
    const firstId = task.timeoutId;
    sources.get(firstId).callback();
    await task.run();
    assertEqual(calls, 1, "ticks and explicit runs skip pending work");
    task.stop();
    task.start();
    assertEqual(calls, 1, "restart does not overlap pending work");
    assertEqual(sources.has(firstId), false, "old timer was removed");
    assertEqual(sources.size, 1, "restart creates one replacement timer");
    resolve();
    await pending;
    assertEqual(task.running, false, "completion clears overlap guard");
    sources.get(task.timeoutId).callback();
    assertEqual(calls, 2, "later ticks resume work");
    task.stop();
});

await test("stop is idempotent and restart schedules and runs again", async ({
    sources,
    removed,
}) => {
    let calls = 0;
    const task = new PeriodicTask(10, () => calls++);

    task.start();
    const firstId = task.timeoutId;
    await Promise.resolve();
    task.stop();
    task.stop();
    assertEqual(task.started, false, "stop clears started state");
    assertEqual(task.timeoutId, null, "stop clears timer ID");
    assertEqual(sources.size, 0, "stop removes timer");
    assertEqual(removed.length, 1, "repeated stop does not remove twice");
    task.start();
    assertEqual(calls, 2, "restart immediately runs again");
    assertEqual(task.timeoutId === firstId, false, "restart uses a fresh timer");
    assertEqual(sources.size, 1, "restart schedules one timer");
    task.stop();
});

await test("interval changes replace timers without running work", async ({ sources, removed }) => {
    let calls = 0;
    const task = new PeriodicTask(10, () => calls++);

    task.setIntervalSeconds(20);
    assertEqual(sources.size, 0, "interval change while stopped does not schedule");
    assertEqual(calls, 0, "interval change while stopped does not run");
    task.start();
    const firstId = task.timeoutId;
    assertEqual(sources.get(firstId).seconds, 20, "start uses updated interval");
    await Promise.resolve();
    task.setIntervalSeconds(40);
    assertEqual(removed[0], firstId, "interval change removes previous timer");
    assertEqual(sources.size, 1, "interval change keeps exactly one timer");
    assertEqual(sources.get(task.timeoutId).seconds, 40, "replacement interval");
    assertEqual(calls, 1, "interval change does not trigger work");
    task.setIntervalSeconds(0);
    assertEqual(sources.size, 0, "zero interval removes timer");
    assertEqual(task.timeoutId, null, "zero interval clears timer ID");
    assertEqual(task.started, true, "zero interval preserves started state");
    task.setIntervalSeconds(5);
    assertEqual(sources.get(task.timeoutId).seconds, 5, "positive interval resumes timer");
    assertEqual(calls, 1, "resuming timer does not immediately run");
    sources.get(task.timeoutId).callback();
    assertEqual(calls, 2, "resumed timer runs work");
    task.stop();
});

await test("failed work releases overlap guard for the next tick", async ({ sources }) => {
    const failure = new Error("expected task failure");
    let calls = 0;
    const task = new PeriodicTask(10, async () => {
        calls++;
        if (calls === 1) {
            throw failure;
        }
    });

    try {
        task.start();
        await Promise.resolve();

        assertEqual(task.running, false, "failure clears overlap guard");
        assertEqual(sources.get(task.timeoutId).callback(), GLib.SOURCE_CONTINUE, "timer survives");
        assertEqual(calls, 2, "next tick retries work");
    } finally {
        task.stop();
    }
});
