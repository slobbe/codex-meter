import assert from "node:assert/strict";
import test from "node:test";

import { createActivityGridViewModel } from "../src/panel/activity-grid-model.js";

process.env.TZ = "America/New_York";

const now = new Date(2026, 10, 22, 14).getTime() / 1000;
const hidden = { visible: false, title: "Activity over 28 days", days: [] };

function time(day, hour, minute = 0) {
    return new Date(2026, 10, day, hour, minute).getTime() / 1000;
}

function entry(timestamp, usedPercent, id = "weekly", resetAt) {
    return {
        timestamp: new Date(timestamp * 1000).toISOString(),
        quotas: [{ id, usedPercent, resetAt }],
    };
}

test("shows 28 local days across a month boundary and marks future blocks", () => {
    const history = [entry(time(22, 8), 10), entry(time(22, 8, 30), 10)];
    const grid = createActivityGridViewModel(null, history, now);
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
    const month = new Intl.DateTimeFormat(undefined, { month: "short" });
    const october = month.format(new Date(2026, 9, 26));
    const november = month.format(new Date(2026, 10, 1));

    assert.equal(grid.visible, true);
    assert.equal(grid.title, "Activity over 28 days");
    assert.deepEqual(
        grid.days,
        Array.from({ length: 28 }, (_, index) => {
            const weekdayLabel = weekday.format(new Date(2026, 9, 26 + index));
            const dayAndMonth = index < 6 ? `${26 + index} ${october}` : `${index - 5} ${november}`;
            return {
                label: [...weekdayLabel][0],
                dateLabel: `${weekdayLabel}, ${dayAndMonth}`,
                cells:
                    index === 27
                        ? ["unknown", "empty", "unknown", "future"]
                        : ["unknown", "unknown", "unknown", "unknown"],
            };
        }),
    );
});

test("prefers an exact weekly window and falls back only to a legacy weekly id", () => {
    const history = [entry(time(22, 7), 1), entry(time(22, 8), 4)];
    const legacy = { id: "weekly" };
    const exact = { id: "week", limitWindowSeconds: 604_800 };

    assert.equal(createActivityGridViewModel({ quotas: [legacy] }, history, now).visible, true);
    for (const quotas of [[{ id: "weekly", limitWindowSeconds: 18_000 }], [legacy, exact]]) {
        assert.deepEqual(createActivityGridViewModel({ quotas }, history, now), hidden);
    }
    assert.equal(
        createActivityGridViewModel(
            { quotas: [legacy, exact] },
            [...history, entry(time(22, 10), 4, "week"), entry(time(22, 12), 5, "week")],
            now,
        ).visible,
        true,
    );
});

test("clips activity to the first day and scales positive deltas by elapsed overlap", () => {
    const firstDay = 22 - 27;
    const history = [
        entry(time(firstDay, 8), 18),
        entry(time(firstDay - 1, 23), 0),
        entry(time(firstDay, 13), 20.5),
    ];
    const grid = createActivityGridViewModel(null, history, now);

    // The first interval adds 12 points to the first block and 4 to the second.
    // The next interval adds 2 points to the second block and 0.5 to the third.
    assert.deepEqual(grid.days[0].cells, ["high", "medium", "low", "unknown"]);
    assert.deepEqual(
        createActivityGridViewModel(
            null,
            [entry(time(firstDay, 4), 0), entry(time(firstDay, 13), 9)],
            now,
        ).days[0].cells,
        ["low", "high", "low", "unknown"],
    );
});

for (const [season, month, day] of [
    ["spring", 2, 8],
    ["fall", 10, 1],
]) {
    test(`uses wall-clock boundaries on the ${season} DST transition`, () => {
        const local = (hour, minute = 0) =>
            new Date(2026, month, day, hour, minute).getTime() / 1000;
        const grid = createActivityGridViewModel(
            null,
            [entry(local(5, 30), 1), entry(local(6, 30), 7)],
            local(12),
        );

        assert.deepEqual(grid.days.at(-1).cells, ["high", "high", "unknown", "future"]);
    });
}

test("leaves resets and long flat gaps unknown", () => {
    const history = [
        entry(time(20, 18), 16),
        entry(time(21, 5, 45), 16, "weekly", time(21, 6)),
        entry(time(21, 6, 15), 16, "weekly", time(28, 6)),
        entry(time(21, 13), 1),
        entry(time(21, 19), 4),
    ];
    const grid = createActivityGridViewModel(null, history, now);

    assert.deepEqual(grid.days.at(-3).cells, ["unknown", "unknown", "unknown", "unknown"]);
    assert.deepEqual(grid.days.at(-2).cells, ["unknown", "unknown", "high", "low"]);
});

test("uses an unchanged refresh only when it closes a recent interval", () => {
    const snapshot = { fetchedAt: time(22, 8, 30), quotas: [{ id: "weekly", usedPercent: 10 }] };
    const recent = [entry(time(22, 8), 10)];
    assert.equal(createActivityGridViewModel(snapshot, recent, now).days.at(-1).cells[1], "empty");

    const stale = [entry(time(22, 7), 10)];
    assert.deepEqual(createActivityGridViewModel(snapshot, stale, now), hidden);
});

test("ignores invalid, duplicate, and future samples as interval endpoints", () => {
    const history = [
        entry(time(22, 16), 18),
        { ...entry(time(22, 12), 8), timestamp: "invalid" },
        entry(time(22, 12), NaN),
        entry(time(22, 12), 101),
        entry(time(22, 10), 6),
        entry(time(22, 10), 7),
    ];
    assert.deepEqual(createActivityGridViewModel(null, history, now), hidden);
    assert.deepEqual(createActivityGridViewModel(null, [], now), hidden);
});
