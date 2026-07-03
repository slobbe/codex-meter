import assert from "node:assert/strict";
import test from "node:test";

import {
    calculateAverageBurnRatePercentPerDay,
    calculateRecentPositiveDelta,
    createUsageTrendViewModel,
} from "../dist/ui/view-model.js";

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
            {
                id: "weekly",
                label: "Week",
                usedPercent: 10,
            },
        ],
    };
}

function entry(secondsAgo, usedPercent, id = "weekly") {
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

test("shows positive weekly usage deltas as normalized activity bars", () => {
    const trend = createUsageTrendViewModel(
        createSnapshot(),
        [entry(30_000, 1), entry(15_000, 4), entry(3_600, 10)],
        now,
    );

    assert.equal(trend.visible, true);
    assert.equal(trend.bars.length, 56);
    assert.equal(Math.max(...trend.bars), 100);
    assert.ok(trend.bars.filter((bar) => bar > 0).length >= 2);
});

test("spreads sparse positive deltas across elapsed time", () => {
    const trend = createUsageTrendViewModel(
        createSnapshot(),
        [entry(24 * 60 * 60, 1), entry(60, 99)],
        now,
    );

    assert.equal(trend.visible, true);
    assert.ok(
        trend.bars.filter((bar) => bar > 0).length > 1,
        "a one-day sparse increase should not render as a single spike",
    );
});

test("ignores resets and keeps later positive usage", () => {
    const trend = createUsageTrendViewModel(
        createSnapshot(),
        [entry(14_400, 80), entry(10_800, 2), entry(7_200, 9)],
        now,
    );

    assert.equal(trend.visible, true);
    assert.ok(trend.bars.filter((bar) => bar > 0).length >= 1);
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

test("uses the secondary quota id for usage trend", () => {
    const snapshot = {
        ...createSnapshot(),
        quotas: [
            { id: "session", label: "Session (5h)", usedPercent: 10 },
            { id: "week", label: "Week", usedPercent: 10 },
        ],
    };
    const trend = createUsageTrendViewModel(
        snapshot,
        [
            entry(600, 90, "session"),
            entry(300, 1, "week"),
            entry(60, 5, "week"),
        ],
        now,
    );

    assert.equal(trend.visible, true);
    assert.equal(Math.max(...trend.bars), 100);
});

test("calculates recent positive delta and ignores resets", () => {
    assert.equal(calculateRecentPositiveDelta([
        { timestamp: now - 300, usedPercent: 80 },
        { timestamp: now - 200, usedPercent: 2 },
        { timestamp: now - 100, usedPercent: 9 },
    ]), 7);
});

test("calculates average burn rate over observed span", () => {
    assert.equal(calculateAverageBurnRatePercentPerDay([
        { timestamp: now - 86_400, usedPercent: 1 },
        { timestamp: now, usedPercent: 2.8 },
    ]), 1.7999999999999998);
});

test("calculates average burn rate with six hour minimum observed span", () => {
    assert.equal(calculateAverageBurnRatePercentPerDay([
        { timestamp: now - 3_600, usedPercent: 1 },
        { timestamp: now, usedPercent: 2 },
    ]), 4);
});

