import { CodexMonitor } from "../src/background/monitor.js";

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
    }
}

function assertDeepEqual(actual, expected, message) {
    assertEqual(JSON.stringify(actual), JSON.stringify(expected), message);
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

const workflows = [
    {
        name: "live refresh",
        run: (monitor) => monitor._refreshUsageOnce(null),
        sourceEvents: ["refresh"],
        usesCurrentSnapshot: true,
    },
    {
        name: "startup cache",
        run: (monitor) => monitor._loadCachedSnapshot(),
        sourceEvents: ["cache"],
        usesCurrentSnapshot: false,
    },
    {
        name: "failure cache",
        run: (monitor) => monitor._refreshUsageOnce(null),
        sourceEvents: ["refresh", "cache"],
        usesCurrentSnapshot: false,
    },
];

function createFixture(workflow) {
    const snapshot = { bankedResetCount: 2 };
    const history = [{ timestamp: "history" }];
    const prediction = {
        quotas: {
            session: { estimatedLimitAt: 1_700_014_400, trend: "unsafe" },
            weekly: { estimatedLimitAt: null, trend: "safe" },
            "window-3600": { estimatedLimitAt: null, trend: "unknown" },
        },
    };
    const events = [];
    const changes = [];
    const notifications = [];
    const source = deferred();
    const sourceEntered = deferred();
    const historyResult = deferred();
    const historyEntered = deferred();
    const predictionResult = deferred();
    const predictionEntered = deferred();

    // Skip construction so no real settings, timers, network, or storage are used.
    const monitor = Object.assign(Object.create(CodexMonitor.prototype), {
        _stopped: false,
        _snapshot: null,
        _prediction: { quotas: {} },
        _history: [],
        _errorMessage: null,
        _cachedFailureMessage: null,
        _notify: (message) => notifications.push(message),
        onChange: (state) => {
            events.push("change");
            changes.push(state);
        },
        _usageService: {
            async refresh() {
                events.push("refresh");
                if (workflow.name === "failure cache") throw new Error("refresh failed");
                sourceEntered.resolve();
                return source.promise;
            },
            async readCachedSnapshot() {
                events.push("cache");
                sourceEntered.resolve();
                return source.promise;
            },
            async readHistory() {
                events.push("history");
                historyEntered.resolve();
                return historyResult.promise;
            },
            async predict(input) {
                events.push("predict");
                predictionEntered.resolve(input);
                return predictionResult.promise;
            },
        },
    });
    return {
        monitor,
        snapshot,
        history,
        prediction,
        events,
        changes,
        notifications,
        source,
        sourceEntered,
        historyResult,
        historyEntered,
        predictionResult,
        predictionEntered,
    };
}

async function testPredictionWorkflow(workflow, rejectPrediction) {
    const fixture = createFixture(workflow);
    const { monitor, events, changes } = fixture;
    const pending = workflow.run(monitor);
    await fixture.sourceEntered.promise;
    fixture.source.resolve(fixture.snapshot);
    await fixture.historyEntered.promise;
    assertEqual(monitor.state.snapshot, fixture.snapshot, "snapshot assigned before history");
    assertDeepEqual(events, [...workflow.sourceEvents, "history"], "prediction awaits history");
    assertEqual(changes.length, 0, "no change while history is pending");

    // Preserve the distinction between live state and the cache paths' local snapshot.
    const replacementSnapshot = { bankedResetCount: 3 };
    monitor._snapshot = replacementSnapshot;
    fixture.historyResult.resolve(fixture.history);
    const input = await fixture.predictionEntered.promise;
    assertEqual(
        input,
        workflow.usesCurrentSnapshot ? replacementSnapshot : fixture.snapshot,
        "prediction receives the original workflow's snapshot argument",
    );
    assertEqual(monitor.state.history, fixture.history, "history loaded before prediction");
    assertEqual(changes.length, 0, "no change while prediction is pending");
    if (rejectPrediction) fixture.predictionResult.reject(new Error("prediction failed"));
    else fixture.predictionResult.resolve(fixture.prediction);
    await pending;

    assertEqual(
        monitor.state.prediction,
        rejectPrediction ? null : fixture.prediction,
        "prediction is assigned or cleared on failure",
    );
    assertDeepEqual(
        events,
        [...workflow.sourceEvents, "history", "predict", "change"],
        "one change follows prediction completion",
    );
    assertEqual(changes[0].prediction, monitor.state.prediction, "change includes prediction");
    assertEqual(monitor.state.errorMessage, null, "prediction failure is not a refresh error");
    if (workflow.name === "failure cache") {
        assertEqual(
            monitor.state.cachedFailureMessage,
            "Codex usage refresh failed. Try again later.",
            "failed refresh retains its cached failure message",
        );
    } else {
        assertEqual(monitor.state.cachedFailureMessage, null, "no cached failure on success");
    }
    assertDeepEqual(fixture.notifications, [], "prediction loading sends no notifications");
}

async function testStoppedDuringSource(workflow) {
    const fixture = createFixture(workflow);
    const pending = workflow.run(fixture.monitor);
    await fixture.sourceEntered.promise;
    fixture.monitor._stopped = true;
    fixture.source.resolve(fixture.snapshot);
    await pending;
    assertDeepEqual(fixture.events, workflow.sourceEvents, "stop skips history and prediction");
    assertEqual(
        fixture.monitor.state.snapshot,
        workflow.usesCurrentSnapshot ? fixture.snapshot : null,
        "stop preserves each workflow's snapshot assignment timing",
    );
    assertEqual(fixture.changes.length, 0, "stop suppresses change");
}

async function testStoppedDuringLoading(workflow, stage) {
    const fixture = createFixture(workflow);
    const pending = workflow.run(fixture.monitor);
    await fixture.sourceEntered.promise;
    fixture.source.resolve(fixture.snapshot);
    await fixture.historyEntered.promise;
    if (stage === "history") fixture.monitor._stopped = true;
    fixture.historyResult.resolve(fixture.history);
    await fixture.predictionEntered.promise;
    fixture.monitor._stopped = true;
    fixture.predictionResult.resolve(fixture.prediction);
    await pending;
    assertEqual(
        fixture.monitor.state.prediction,
        fixture.prediction,
        "in-flight loading still assigns prediction after stop",
    );
    assertDeepEqual(
        fixture.events,
        [...workflow.sourceEvents, "history", "predict"],
        "stop during loading preserves await order but suppresses change",
    );
    assertDeepEqual(fixture.notifications, [], "stop sends no notifications");
}

for (const workflow of workflows) {
    await testPredictionWorkflow(workflow, false);
    await testPredictionWorkflow(workflow, true);
    await testStoppedDuringSource(workflow);
    await testStoppedDuringLoading(workflow, "history");
    await testStoppedDuringLoading(workflow, "prediction");
    console.log(`Passed monitor prediction tests: ${workflow.name}`);
}
