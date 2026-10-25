import assert from "node:assert/strict";
import test from "node:test";

import { predict } from "../src/codex/usage/prediction.js";

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
                ...overrides.primary,
            },
            {
                id: "weekly",
                label: "Week",
                usedPercent: 54,
                limitWindowSeconds: 604_800,
                resetAfterSeconds: 345_600,
                resetAt: fetchedAt + 345_600,
                limitReached: false,
                ...overrides.secondary,
            },
        ],
    };
}

test("predicts from the current snapshot when history is empty", () => {
    const prediction = predict([], createSnapshot());

    assert.equal(prediction.primary.trend, "unsafe");
    assert.equal(prediction.secondary.trend, "unsafe");
});

test("anchors nonzero in-window history to the window start", () => {
    const snapshot = createSnapshot({
        primary: {
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

    assert.equal(prediction.primary.trend, "unsafe");
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

    assert.deepEqual(prediction.primary, {
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

    assert.deepEqual(prediction.primary, {
        estimatedLimitAt: fetchedAt + 12_600,
        trend: "unsafe",
    });
});

test("uses the current snapshot when persisted history is stale", () => {
    const snapshot = createSnapshot({
        primary: {
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

    assert.equal(prediction.primary.trend, "unsafe");
});
