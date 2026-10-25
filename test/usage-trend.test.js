import assert from "node:assert/strict";
import test from "node:test";

import { createUsageTrendViewModel, getUsageTrendSamples } from "../src/panel/view-model.js";

const now = 1_700_000_000;

function createSnapshot() {
    return {
        fetchedAt: now,
        planType: "pro",
        quotas: [
            {
                id: "session",
                label: "5 hours",
                limitWindowSeconds: 18_000,
                usedPercent: 10,
            },
            {
                id: "weekly",
                label: "Weekly",
                limitWindowSeconds: 604_800,
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

test("hides weekly activity for snapshots without an exact weekly quota", () => {
    const history = [entry(600, 1), entry(60, 5)];
    for (const quotas of [
        [],
        [{ id: "window-3600", limitWindowSeconds: 3_600 }],
        [{ id: "weekly", limitWindowSeconds: 3_600 }],
        [{ id: "weekly", limitWindowSeconds: 1_209_600 }],
        [{ id: "weekly", limitWindowSeconds: 0 }],
        [{ id: "secondary" }],
    ]) {
        const snapshot = { quotas };
        assert.equal(createUsageTrendViewModel(snapshot, history, now).visible, false);
        assert.deepEqual(getUsageTrendSamples(snapshot, history, now), []);
    }
});

test("retains legacy weekly history for missing metadata and null snapshots", () => {
    const history = [entry(600, 1), entry(60, 5)];
    for (const snapshot of [null, { quotas: [{ id: "weekly" }] }]) {
        assert.equal(createUsageTrendViewModel(snapshot, history, now).visible, true);
    }
});

test("does not fall back to unrelated weekly history for a selected quota", () => {
    const snapshot = { quotas: [{ id: "week", limitWindowSeconds: 604_800 }] };
    const history = [entry(600, 1), entry(300, 3, "week"), entry(60, 5)];
    assert.deepEqual(getUsageTrendSamples(snapshot, history, now), [
        { timestamp: now - 300, usedPercent: 3 },
    ]);
    assert.equal(createUsageTrendViewModel(snapshot, history, now).visible, false);
});

test("prefers duration metadata over a legacy weekly id", () => {
    const snapshot = {
        quotas: [{ id: "weekly" }, { id: "week", limitWindowSeconds: 604_800 }],
    };
    const history = [entry(600, 1), entry(60, 5)];
    assert.equal(createUsageTrendViewModel(snapshot, history, now).visible, false);
});

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

test("uses the exact seven-day quota id regardless of position", () => {
    const weekly = { id: "week", limitWindowSeconds: 604_800, usedPercent: 10 };
    const hourly = { id: "window-3600", limitWindowSeconds: 3_600, usedPercent: 10 };
    const history = [entry(600, 90, hourly.id), entry(300, 1, weekly.id), entry(60, 5, weekly.id)];
    for (const quotas of [[weekly, hourly], [hourly, weekly], [weekly]]) {
        const snapshot = { quotas };
        const trend = createUsageTrendViewModel(snapshot, history, now);
        assert.equal(trend.visible, true);
        assert.equal(Math.max(...trend.bars), 100);
        assert.deepEqual(
            getUsageTrendSamples(snapshot, history, now).map((sample) => sample.usedPercent),
            [1, 5],
        );
    }
});
