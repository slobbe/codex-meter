import assert from "node:assert/strict";
import test from "node:test";

import { createUsageTrendViewModel } from "../dist/ui/view-model.js";

const now = 1_700_000_000;

function createSnapshot() {
    return {
        fetchedAt: now,
        planType: "pro",
        quotas: [
            {
                id: "session",
                label: "Session (5h)",
                usedPercent: 10,
            },
        ],
    };
}

function entry(secondsAgo, usedPercent, id = "session") {
    return {
        timestamp: new Date((now - secondsAgo) * 1000).toISOString(),
        quotas: [{ id, usedPercent }],
    };
}

test("hides usage trend when history is empty", () => {
    const trend = createUsageTrendViewModel(createSnapshot(), [], now);

    assert.equal(trend.visible, false);
    assert.deepEqual(trend.bars, []);
});

test("hides usage trend when there is no positive usage delta", () => {
    const trend = createUsageTrendViewModel(
        createSnapshot(),
        [entry(600, 10), entry(300, 10), entry(60, 4)],
        now,
    );

    assert.equal(trend.visible, false);
    assert.deepEqual(trend.bars, []);
});

test("shows positive session usage deltas as normalized activity bars", () => {
    const trend = createUsageTrendViewModel(
        createSnapshot(),
        [entry(30_000, 1), entry(15_000, 4), entry(3_600, 10)],
        now,
    );

    assert.equal(trend.visible, true);
    assert.equal(trend.bars.length, 56);
    assert.equal(Math.max(...trend.bars), 100);
    assert.equal(trend.bars.filter((bar) => bar > 0).length, 2);
});

test("ignores resets and keeps later positive usage", () => {
    const trend = createUsageTrendViewModel(
        createSnapshot(),
        [entry(14_400, 80), entry(10_800, 2), entry(7_200, 9)],
        now,
    );

    assert.equal(trend.visible, true);
    assert.equal(trend.bars.filter((bar) => bar > 0).length, 1);
    assert.equal(Math.max(...trend.bars), 100);
});

test("ignores usage outside the last seven days", () => {
    const eightDays = 8 * 24 * 60 * 60;
    const trend = createUsageTrendViewModel(
        createSnapshot(),
        [entry(eightDays, 1), entry(eightDays - 60, 99)],
        now,
    );

    assert.equal(trend.visible, false);
    assert.deepEqual(trend.bars, []);
});

test("falls back to legacy session quota id", () => {
    const snapshot = {
        ...createSnapshot(),
        quotas: [{ id: "primary", label: "Session (5h)", usedPercent: 10 }],
    };
    const trend = createUsageTrendViewModel(
        snapshot,
        [entry(600, 1), entry(300, 5)],
        now,
    );

    assert.equal(trend.visible, true);
    assert.equal(Math.max(...trend.bars), 100);
});
