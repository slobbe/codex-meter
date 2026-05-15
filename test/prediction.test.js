import assert from "node:assert/strict";
import test from "node:test";

import { predict } from "../dist/domain/prediction.js";

const fetchedAt = 1_700_001_800;

function createSnapshot(overrides = {}) {
    return {
        fetchedAt,
        planType: "plus",
        rateLimit: {
            limitReached: false,
            primary: {
                usedPercent: 16,
                limitWindowSeconds: 18_000,
                resetAfterSeconds: 16_200,
                resetAt: fetchedAt + 16_200,
                ...overrides.primary,
            },
            secondary: {
                usedPercent: 54,
                limitWindowSeconds: 604_800,
                resetAfterSeconds: 345_600,
                resetAt: fetchedAt + 345_600,
                ...overrides.secondary,
            },
        },
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
            primaryUsedPercent: 14,
            secondaryUsedPercent: 54,
        },
    ];

    const prediction = predict(history, snapshot);

    assert.equal(prediction.primary.trend, "unsafe");
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
            primaryUsedPercent: 1,
            secondaryUsedPercent: 1,
        },
    ];

    const prediction = predict(history, snapshot);

    assert.equal(prediction.primary.trend, "unsafe");
});
