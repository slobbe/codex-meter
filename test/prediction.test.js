import assert from "node:assert/strict";
import test from "node:test";

import { predict } from "../src/codex/usage/prediction.js";
import { toUsageSnapshot } from "../src/codex/usage/response.js";
import { toHistoryEntry } from "../src/codex/usage/model.js";

const fetchedAt = 1_700_001_800;

function createSnapshot(overrides = {}) {
    return {
        fetchedAt,
        planType: "plus",
        quotas: [
            {
                id: "session",
                label: "Session (5h)",
                usedPercent: 16,
                limitWindowSeconds: 18_000,
                resetAfterSeconds: 16_200,
                resetAt: fetchedAt + 16_200,
                limitReached: false,
                ...overrides.session,
            },
            {
                id: "weekly",
                label: "Week",
                usedPercent: 54,
                limitWindowSeconds: 604_800,
                resetAfterSeconds: 345_600,
                resetAt: fetchedAt + 345_600,
                limitReached: false,
                ...overrides.weekly,
            },
        ],
    };
}

test("predicts arbitrary quotas by ID regardless of order or removal", () => {
    const snapshot = createSnapshot();
    snapshot.quotas.push({ id: "window-90", label: "90 seconds", usedPercent: 25 });
    const prediction = predict([], snapshot);

    assert.deepEqual(Object.keys(prediction), ["quotas"]);
    assert.deepEqual(Object.keys(prediction.quotas), ["session", "weekly", "window-90"]);
    assert.deepEqual(prediction.quotas["window-90"], {
        estimatedLimitAt: null,
        trend: "unknown",
    });
    snapshot.quotas.reverse();
    assert.deepEqual(predict([], snapshot), prediction);
    snapshot.quotas = snapshot.quotas.filter(({ id }) => id !== "weekly");
    assert.deepEqual(predict([], snapshot), {
        quotas: {
            session: prediction.quotas.session,
            "window-90": prediction.quotas["window-90"],
        },
    });
    snapshot.quotas = [];
    assert.deepEqual(predict([], snapshot), { quotas: {} });
});

test("keeps equal-duration predictions and persisted histories separate by API field ID", () => {
    const window = {
        used_percent: 0,
        limit_window_seconds: 18_000,
        reset_after_seconds: 18_000,
        reset_at: fetchedAt + 16_200,
    };
    const response = {
        plan_type: "pro",
        rate_limit: {
            limit_reached: false,
            alpha_window: { ...window, used_percent: 0 },
            beta_window: { ...window, used_percent: 40 },
            gamma_window: { ...window, used_percent: 100 },
        },
    };
    const previousSnapshot = toUsageSnapshot(response);
    previousSnapshot.fetchedAt = fetchedAt - 1_800;
    const history = [toHistoryEntry(previousSnapshot)];
    assert.equal(new Set(history[0].quotas.map(({ id }) => id)).size, 3);

    response.rate_limit.alpha_window.used_percent = 50;
    for (const value of Object.values(response.rate_limit)) {
        if (typeof value === "object") value.reset_after_seconds = 16_200;
    }
    response.rate_limit = Object.fromEntries(Object.entries(response.rate_limit).reverse());
    const snapshot = toUsageSnapshot(response);
    snapshot.fetchedAt = fetchedAt;

    assert.deepEqual(predict(history, snapshot), {
        quotas: {
            "session-alpha_window": { estimatedLimitAt: fetchedAt + 1_800, trend: "unsafe" },
            "session-beta_window": { estimatedLimitAt: null, trend: "safe" },
            "session-gamma_window": { estimatedLimitAt: null, trend: "limit reached" },
        },
    });
});

test("predicts from the current snapshot when history is empty", () => {
    const prediction = predict([], createSnapshot());

    assert.deepEqual(Object.keys(prediction), ["quotas"]);
    assert.equal(prediction.quotas.session.trend, "unsafe");
    assert.equal(prediction.quotas.weekly.trend, "unsafe");
});

test("anchors nonzero in-window history to the window start", () => {
    const snapshot = createSnapshot({
        session: {
            usedPercent: 16,
            resetAfterSeconds: 16_200,
            resetAt: fetchedAt + 16_200,
        },
    });
    const history = [
        {
            timestamp: new Date((fetchedAt - 120) * 1000).toISOString(),
            quotas: [
                { id: "session", usedPercent: 14 },
                { id: "weekly", usedPercent: 54 },
            ],
        },
    ];

    const prediction = predict(history, snapshot);

    assert.equal(prediction.quotas.session.trend, "unsafe");
});

test("preserves predictions for out-of-order history", () => {
    const snapshot = createSnapshot();
    const history = [
        {
            timestamp: new Date((fetchedAt - 600) * 1000).toISOString(),
            quotas: [{ id: "session", usedPercent: 12 }],
        },
        {
            timestamp: new Date((fetchedAt - 1_800) * 1000).toISOString(),
            quotas: [{ id: "session", usedPercent: 4 }],
        },
        {
            timestamp: new Date((fetchedAt - 3_600) * 1000).toISOString(),
            quotas: [{ id: "session", usedPercent: 100 }],
        },
        {
            timestamp: new Date((fetchedAt - 1_200) * 1000).toISOString(),
            quotas: [{ id: "session", usedPercent: 8 }],
        },
    ];
    const originalHistory = structuredClone(history);

    const prediction = predict(history, snapshot);

    assert.deepEqual(prediction.quotas.session, {
        estimatedLimitAt: fetchedAt + 12_600,
        trend: "unsafe",
    });
    assert.deepEqual(
        prediction,
        predict([history[2], history[1], history[3], history[0]], snapshot),
    );
    assert.deepEqual(history, originalHistory);
});

test("preserves equal-timestamp order and prefers the snapshot at the latest timestamp", () => {
    const history = [
        {
            timestamp: new Date(fetchedAt * 1000).toISOString(),
            quotas: [{ id: "session", usedPercent: 100 }],
        },
        {
            timestamp: new Date((fetchedAt - 1_800) * 1000).toISOString(),
            quotas: [{ id: "session", usedPercent: 4 }],
        },
        {
            timestamp: new Date((fetchedAt - 1_800) * 1000).toISOString(),
            quotas: [{ id: "session", usedPercent: 12 }],
        },
        {
            timestamp: new Date(fetchedAt * 1000).toISOString(),
            quotas: [{ id: "session", usedPercent: 80 }],
        },
    ];

    const prediction = predict(history, createSnapshot());

    assert.deepEqual(prediction.quotas.session, {
        estimatedLimitAt: fetchedAt + 12_600,
        trend: "unsafe",
    });
});

test("uses the current snapshot when persisted history is stale", () => {
    const snapshot = createSnapshot({
        session: {
            usedPercent: 16,
            resetAfterSeconds: 16_200,
            resetAt: fetchedAt + 16_200,
        },
    });
    const history = [
        {
            timestamp: new Date((fetchedAt - 600) * 1000).toISOString(),
            quotas: [
                { id: "session", usedPercent: 1 },
                { id: "weekly", usedPercent: 1 },
            ],
        },
    ];

    const prediction = predict(history, snapshot);

    assert.equal(prediction.quotas.session.trend, "unsafe");
});
