import assert from "node:assert/strict";
import test from "node:test";

import {
    createMenuViewModel,
    createPanelBarViewModel,
    formatDuration,
    formatFooter,
    formatReset,
    formatLimitPrediction,
    formatTimestamp,
} from "../src/panel/view-model.js";

const sessionQuota = {
    id: "session",
    label: "Session (5h)",
    usedPercent: 40,
    resetAfterSeconds: 14_400,
    resetAt: 1_700_014_400,
};

test("shows only a loading label and hides errors and empty snapshots in the panel", () => {
    for (const topPanelDisplayMode of ["bars", "percentages"]) {
        for (const percentDisplayMode of ["used", "left"]) {
            const settings = { topPanelDisplayMode, percentDisplayMode };
            assert.deepEqual(createPanelBarViewModel(settings, null, null), {
                bars: [],
                showBars: false,
                showLabel: true,
                label: "--",
            });
            const hidden = { bars: [], showBars: false, showLabel: false, label: "" };
            assert.deepEqual(createPanelBarViewModel(settings, { quotas: [] }, null), hidden);
            for (const snapshot of [null, { quotas: [] }, { quotas: [sessionQuota] }]) {
                assert.deepEqual(
                    createPanelBarViewModel(settings, snapshot, "Unable to refresh"),
                    hidden,
                );
            }
        }
    }
});

test("uses one generic loading row and no rows for errors or empty snapshots", () => {
    for (const percentDisplayMode of ["used", "left"]) {
        const settings = { percentDisplayMode };
        const loading = createMenuViewModel(settings, null, null);
        assert.deepEqual(loading, {
            usageItems: [
                {
                    id: "loading",
                    visible: true,
                    title: "Usage",
                    value: "Loading...",
                    prediction: "",
                    reset: "resets in --",
                    percentValue: 0,
                    displayPercentValue: percentDisplayMode === "left" ? 100 : 0,
                    displayBaselinePercentValue: null,
                    percentLabel: percentDisplayMode,
                    predictionStyle: "muted",
                },
            ],
            errorMessage: null,
            statusTitle: null,
            statusMessage: null,
            accountType: "--",
            refreshLabel: "Refresh",
            trend: { visible: false, title: "Weekly activity", bars: [] },
        });
        const empty = createMenuViewModel(settings, { quotas: [] }, null);
        assert.deepEqual(empty, { ...loading, usageItems: [] });
        for (const snapshot of [null, { quotas: [] }, { quotas: [sessionQuota] }]) {
            const error = createMenuViewModel(
                settings,
                snapshot,
                null,
                [],
                "Unable to refresh",
                "Offline",
            );
            assert.deepEqual(error, {
                ...loading,
                usageItems: [],
                errorMessage: "Unable to refresh",
            });
        }
    }
});

test("separates account type from the snapshot refresh time without header credits", () => {
    const snapshot = {
        fetchedAt: new Date(2026, 9, 26, 10, 44).getTime() / 1000,
        planType: "plus",
        credits: { balance: "25", unlimited: false },
        quotas: [],
    };
    const expectedLabel = (fetchedAt) =>
        `Refresh (last at ${formatTimestamp(new Date(fetchedAt * 1000).toISOString(), false)})`;
    const initial = createMenuViewModel({}, snapshot, null);
    assert.equal(initial.accountType, "Plus");
    assert.equal(initial.refreshLabel, expectedLabel(snapshot.fetchedAt));

    snapshot.fetchedAt += 60;
    const updated = createMenuViewModel({}, snapshot, null);
    assert.equal(updated.accountType, "Plus");
    assert.equal(updated.refreshLabel, expectedLabel(snapshot.fetchedAt));
    assert.notEqual(updated.refreshLabel, initial.refreshLabel);

    for (const [error, cachedFailure] of [
        ["Offline", null],
        [null, "Offline"],
    ]) {
        const failed = createMenuViewModel({}, snapshot, null, [], error, cachedFailure);
        assert.equal(failed.refreshLabel, updated.refreshLabel);
        assert.equal(failed.accountType, error ? "--" : "Plus");
    }
    for (const missing of [null, { quotas: [] }]) {
        for (const error of [null, "Offline"]) {
            const viewModel = createMenuViewModel({}, missing, null, [], error);
            assert.equal(viewModel.accountType, "--");
            assert.equal(viewModel.refreshLabel, "Refresh");
        }
    }
});

test("derives labels from duration metadata and preserves legacy labels", () => {
    for (const [limitWindowSeconds, expected] of [
        [3_600, "Hourly"],
        [18_000, "5 hours"],
        [604_800, "Weekly"],
        [1_209_600, "2 weeks"],
        [90, "90 seconds"],
        [0, "Usage"],
        [undefined, "Legacy label"],
        [null, "Legacy label"],
    ]) {
        const quota = { id: "custom", label: "Legacy label", limitWindowSeconds };
        const menu = createMenuViewModel({}, { quotas: [quota] }, null);
        assert.equal(menu.usageItems[0].title, expected);
    }
});

test("renders quotas shortest first in menu values and panel bars and percentages", () => {
    const hourly = { id: "window-3600", limitWindowSeconds: 3_600, usedPercent: 20 };
    const weekly = { id: "weekly", limitWindowSeconds: 604_800, usedPercent: 70 };
    const daily = { id: "daily", limitWindowSeconds: 86_400, usedPercent: 45 };
    const monthly = { id: "monthly", limitWindowSeconds: 2_419_200, usedPercent: 90 };
    for (const [quotas, sorted] of [
        [[], []],
        [[hourly], [hourly]],
        [
            [hourly, weekly],
            [hourly, weekly],
        ],
        [
            [weekly, hourly],
            [hourly, weekly],
        ],
        [
            [weekly, daily, hourly],
            [hourly, daily, weekly],
        ],
        [
            [monthly, weekly, daily, hourly],
            [hourly, daily, weekly, monthly],
        ],
    ]) {
        for (const percentDisplayMode of ["used", "left"]) {
            for (const topPanelDisplayMode of ["bars", "percentages"]) {
                const settings = { percentDisplayMode, topPanelDisplayMode };
                const snapshot = { quotas };
                const original = structuredClone(snapshot);

                const menu = createMenuViewModel(settings, snapshot, null);
                const panel = createPanelBarViewModel(settings, snapshot, null);
                const percents = sorted.map((quota) =>
                    percentDisplayMode === "left" ? 100 - quota.usedPercent : quota.usedPercent,
                );
                assert.deepEqual(Object.keys(menu).sort(), [
                    "accountType",
                    "errorMessage",
                    "refreshLabel",
                    "statusMessage",
                    "statusTitle",
                    "trend",
                    "usageItems",
                ]);
                assert.deepEqual(
                    menu.usageItems.map((row) => row.id),
                    sorted.map((quota) => quota.id),
                );
                assert.deepEqual(
                    menu.usageItems.map((row) => row.value),
                    percents.map((value) => `${value}%`),
                );
                assert.deepEqual(panel, {
                    bars: sorted.map((quota, index) => ({
                        id: quota.id,
                        percentValue: quota.usedPercent,
                        displayPercentValue: percents[index],
                    })),
                    showBars: topPanelDisplayMode === "bars" && quotas.length > 0,
                    showLabel: topPanelDisplayMode !== "bars" && quotas.length > 0,
                    label:
                        topPanelDisplayMode === "bars"
                            ? ""
                            : percents.map((value) => `${value}%`).join("/"),
                });
                for (const [index, row] of menu.usageItems.entries()) {
                    assert.equal(row.percentValue, panel.bars[index].percentValue);
                    assert.equal(row.displayPercentValue, panel.bars[index].displayPercentValue);
                }
                assert.deepEqual(snapshot, original);
            }
        }
    }
});

test("sorts cached snapshots without mutation and keeps missing or invalid durations last and stable", () => {
    const hourly = { id: "hour", limitWindowSeconds: 3_600, usedPercent: 20 };
    const weekly = { id: "week", limitWindowSeconds: 604_800, usedPercent: 70 };
    const legacy = { id: "legacy", label: "Legacy label", usedPercent: 40 };
    const invalid = { id: "invalid", limitWindowSeconds: 0, usedPercent: 80 };
    const tied = { id: "tied", limitWindowSeconds: 3_600, usedPercent: 30 };
    for (const [quotas, expected] of [
        [
            [weekly, hourly],
            [hourly, weekly],
        ],
        [
            [legacy, hourly],
            [hourly, legacy],
        ],
        [
            [invalid, hourly],
            [hourly, invalid],
        ],
        [
            [legacy, invalid],
            [legacy, invalid],
        ],
        [
            [invalid, legacy],
            [invalid, legacy],
        ],
        [
            [tied, hourly],
            [tied, hourly],
        ],
    ]) {
        const snapshot = { quotas };
        const original = structuredClone(snapshot);
        const settings = { percentDisplayMode: "used", topPanelDisplayMode: "percentages" };
        const prediction = {
            quotas: {
                [expected[0].id]: { trend: "safe" },
                [expected[1].id]: { trend: "limit reached" },
            },
        };
        const menu = createMenuViewModel(settings, snapshot, prediction, [], null, "Offline");
        const panel = createPanelBarViewModel(settings, snapshot, null);
        assert.equal(menu.statusTitle, "Showing cached data");
        assert.deepEqual(
            menu.usageItems.map((row) => row.id),
            expected.map((quota) => quota.id),
        );
        assert.equal(menu.usageItems[0].prediction, "Safe at current pace");
        assert.equal(menu.usageItems[1].prediction, "Limit reached");
        assert.equal(menu.usageItems[0].predictionStyle, "safe");
        assert.equal(menu.usageItems[1].predictionStyle, "danger");
        assert.equal(menu.usageItems[0].value, `${expected[0].usedPercent}%`);
        assert.equal(menu.usageItems[1].value, `${expected[1].usedPercent}%`);
        assert.equal(panel.label, menu.usageItems.map((row) => row.value).join("/"));
        assert.deepEqual(
            panel.bars.map((bar) => bar.percentValue),
            menu.usageItems.map((row) => row.percentValue),
        );
        assert.deepEqual(snapshot, original);
    }
});

test("keeps predictions keyed by quota id across reordered collections without mutation", () => {
    const hourly = { id: "hourly", limitWindowSeconds: 3_600, usedPercent: 10 };
    const daily = { id: "daily", limitWindowSeconds: 86_400, usedPercent: 30 };
    const weekly = { id: "weekly", limitWindowSeconds: 604_800, usedPercent: 60 };
    const prediction = {
        quotas: {
            weekly: { trend: "limit reached" },
            hourly: { trend: "safe" },
            daily: { trend: "unsafe", estimatedLimitAt: 1_700_000_000 },
        },
        primary: { trend: "limit reached" },
        secondary: { trend: "safe" },
    };
    const originalPrediction = structuredClone(prediction);
    for (const quotas of [
        [weekly, hourly, daily],
        [daily, weekly, hourly],
        [hourly, daily, weekly],
    ]) {
        const snapshot = { quotas };
        const originalSnapshot = structuredClone(snapshot);
        const menu = createMenuViewModel({ percentDisplayMode: "used" }, snapshot, prediction);
        assert.deepEqual(
            menu.usageItems.map((row) => [row.id, row.predictionStyle]),
            [
                ["hourly", "safe"],
                ["daily", "warning"],
                ["weekly", "danger"],
            ],
        );
        assert.equal(menu.usageItems[0].prediction, "Safe at current pace");
        assert.equal(menu.usageItems[2].prediction, "Limit reached");
        assert.deepEqual(snapshot, originalSnapshot);
        assert.deepEqual(prediction, originalPrediction);
    }
});

test("normalizes every panel bar while preserving unknown percentage labels", () => {
    const quotas = [
        { id: "negative", usedPercent: -10 },
        { id: "over", usedPercent: 125 },
        { id: "unknown", usedPercent: null },
    ];
    for (const percentDisplayMode of ["used", "left"]) {
        for (const topPanelDisplayMode of ["bars", "percentages"]) {
            const panel = createPanelBarViewModel(
                { percentDisplayMode, topPanelDisplayMode },
                { quotas },
                null,
            );
            const left = percentDisplayMode === "left";
            assert.deepEqual(panel.bars, [
                { id: "negative", percentValue: 0, displayPercentValue: left ? 100 : 0 },
                { id: "over", percentValue: 100, displayPercentValue: left ? 0 : 100 },
                { id: "unknown", percentValue: 0, displayPercentValue: left ? 100 : 0 },
            ]);
            assert.equal(
                panel.label,
                topPanelDisplayMode === "bars" ? "" : left ? "100%/0%/--" : "0%/100%/--",
            );
        }
    }
});

test("formats timestamps with exactly one formatter using the selected options", (t) => {
    const value = "2026-10-25T14:05:00Z";
    const DateTimeFormat = Intl.DateTimeFormat;
    const formatter = t.mock.method(Intl, "DateTimeFormat", function (locale, options) {
        return new DateTimeFormat(locale, options);
    });

    for (const date of [true, false]) {
        const options = date
            ? { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }
            : { hour: "numeric", minute: "2-digit" };
        const callsBefore = formatter.mock.callCount();
        assert.equal(
            formatTimestamp(value, date),
            new DateTimeFormat(undefined, options).format(new Date(value)),
        );
        assert.equal(formatter.mock.callCount(), callsBefore + 1);
        assert.deepEqual(formatter.mock.calls.at(-1).arguments, [undefined, options]);
        assert.equal(formatTimestamp("invalid timestamp", date), "--");
    }
    assert.equal(formatTimestamp(value), formatTimestamp(value, true));
    const callsBefore = formatter.mock.callCount();
    for (const empty of [null, undefined, ""]) {
        assert.equal(formatTimestamp(empty), "--");
    }
    assert.equal(formatter.mock.callCount(), callsBefore);
});

test("formats durations using the largest unit and the unit below, down to minutes", () => {
    for (const [seconds, expected] of [
        [129_600, "1d 12h"],
        [86_460, "1d 0h"],
        [86_399, "23h 59m"],
        [45_600, "12h 40m"],
        [12_300, "3h 25m"],
        [3_600, "1h 0m"],
        [3_599, "59m"],
        [60, "1m"],
        [59, "0m"],
        [0, "0m"],
        [-60, "0m"],
        [NaN, "--"],
        [Infinity, "--"],
        [null, "--"],
        [undefined, "--"],
    ]) {
        assert.equal(formatDuration(seconds), expected);
    }
});

test("formats reset durations independently of the quota window", () => {
    assert.equal(formatReset({ resetAfterSeconds: 45_600 }), "resets in 12h 40m");
    assert.equal(formatReset({ resetAfterSeconds: 1_500 }), "resets in 25m");
});

test("formats absolute resets by duration rather than row position", () => {
    const resetAt = 1_700_014_400;
    const settings = { percentDisplayMode: "used" };
    for (const limitWindowSeconds of [3_600, 18_000, 86_399, 86_400, 604_800]) {
        const quota = { id: "custom", limitWindowSeconds, resetAt, resetAfterSeconds: 1_500 };
        const expected = `resets in 25m (${formatTimestamp(
            new Date(resetAt * 1000).toISOString(),
            limitWindowSeconds >= 86_400,
        )})`;
        assert.equal(formatReset(quota), expected);
        for (const quotas of [
            [quota, sessionQuota],
            [sessionQuota, quota],
        ]) {
            const menu = createMenuViewModel(settings, { quotas }, null);
            assert.equal(menu.usageItems.find((row) => row.id === quota.id).reset, expected);
        }
    }
});

test("formats reached limits explicitly", () => {
    assert.equal(
        formatLimitPrediction({ trend: "limit reached", estimatedLimitAt: null }, sessionQuota),
        "Limit reached",
    );
});

test("formats safe limits actionably", () => {
    assert.equal(
        formatLimitPrediction({ trend: "safe", estimatedLimitAt: null }, sessionQuota),
        "Safe at current pace",
    );
});

test("keeps unknown predictions blank", () => {
    assert.equal(
        formatLimitPrediction({ trend: "unknown", estimatedLimitAt: null }, sessionQuota),
        "",
    );
});

test("formats unsafe predictions relative to reset", () => {
    assert.equal(
        formatLimitPrediction(
            { trend: "unsafe", estimatedLimitAt: sessionQuota.resetAt - 7_200 },
            sessionQuota,
        ),
        "Will hit limit ~2h 0m before reset",
    );
});

test("formats footer with credits", () => {
    assert.match(
        formatFooter({
            fetchedAt: 1_700_000_000,
            planType: "pro",
            credits: { balance: "$4.21", unlimited: false },
            quotas: [],
        }),
        /^Pro · Credits \$4\.21 · Updated /,
    );
});

test("formats footer without unlimited credits", () => {
    assert.match(
        formatFooter({
            fetchedAt: 1_700_000_000,
            planType: "pro",
            credits: { balance: "$4.21", unlimited: true },
            quotas: [],
        }),
        /^Pro · Updated /,
    );
});

test("formats footer without zero credits", () => {
    assert.match(
        formatFooter({
            fetchedAt: 1_700_000_000,
            planType: "pro",
            credits: { balance: "$0.00", unlimited: false },
            quotas: [],
        }),
        /^Pro · Updated /,
    );
});

test("shows a single weekly quota without placeholder rows or bars", () => {
    const settings = {
        percentDisplayMode: "used",
        topPanelDisplayMode: "label",
    };
    const snapshot = {
        fetchedAt: 1_700_000_000,
        planType: "plus",
        quotas: [
            {
                id: "weekly",
                label: "Week",
                usedPercent: 12,
                limitWindowSeconds: 604_800,
                resetAfterSeconds: 86_400,
                resetAt: 1_700_086_400,
            },
        ],
    };
    const prediction = {
        quotas: { weekly: { trend: "safe", estimatedLimitAt: null } },
    };

    const menu = createMenuViewModel(settings, snapshot, prediction);
    const panel = createPanelBarViewModel(settings, snapshot, null);

    assert.equal(menu.usageItems.length, 1);
    assert.equal(menu.usageItems[0].id, "weekly");
    assert.equal(menu.usageItems[0].visible, true);
    assert.equal(menu.usageItems[0].title, "Weekly");
    assert.equal(menu.usageItems[0].prediction, "Safe at current pace");
    assert.deepEqual(panel.bars, [{ id: "weekly", percentValue: 12, displayPercentValue: 12 }]);
    assert.equal(panel.label, "12%");
});

test("preserves complete menu rows for session only, week only, both, and neither", () => {
    const session = {
        id: "session",
        label: "Session (5h)",
        usedPercent: 40,
        limitWindowSeconds: 18_000,
        resetAfterSeconds: 14_400,
    };
    const weekly = {
        id: "weekly",
        label: "Week",
        usedPercent: 25,
        limitWindowSeconds: 604_800,
        resetAfterSeconds: 151_200,
    };

    for (const quotas of [[session], [weekly], [session, weekly], [weekly, session], []]) {
        for (const mode of ["used", "left"]) {
            const menu = createMenuViewModel(
                { percentDisplayMode: mode },
                { quotas },
                {
                    quotas: {
                        session: { trend: "safe" },
                        weekly: { trend: "limit reached" },
                    },
                },
            );
            const left = mode === "left";
            const sorted =
                quotas.includes(session) && quotas.includes(weekly) ? [session, weekly] : quotas;
            assert.equal(menu.usageItems.length, sorted.length);
            for (const [index, quota] of sorted.entries()) {
                const isSession = quota === session;
                const percent = quota.usedPercent;
                const baseline = isSession ? 20 : 75;
                assert.deepEqual(menu.usageItems[index], {
                    id: quota.id,
                    visible: true,
                    title: isSession ? "5 hours" : "Weekly",
                    value: `${left ? 100 - percent : percent}%`,
                    prediction: isSession ? "Safe at current pace" : "Limit reached",
                    reset: isSession ? "resets in 4h 0m" : "resets in 1d 18h",
                    percentValue: percent,
                    displayPercentValue: left ? 100 - percent : percent,
                    displayBaselinePercentValue: left ? 100 - baseline : baseline,
                    percentLabel: mode,
                    predictionStyle: isSession ? "safe" : "danger",
                });
            }
        }
    }
});

test("does not use positional predictions for present quotas without an id prediction", () => {
    const menu = createMenuViewModel(
        { percentDisplayMode: "left" },
        { quotas: [sessionQuota, { id: "weekly", usedPercent: 125 }] },
        { primary: { trend: "safe" }, secondary: { trend: "limit reached" } },
    );

    for (const row of menu.usageItems) {
        assert.equal(row.prediction, "");
        assert.equal(row.predictionStyle, "muted");
        assert.equal(row.displayBaselinePercentValue, null);
    }
    assert.equal(menu.usageItems[0].value, "60%");
    assert.equal(menu.usageItems[1].title, "Usage");
    assert.equal(menu.usageItems[1].value, "0%");
    assert.equal(menu.usageItems[1].percentValue, 100);
    assert.equal(menu.usageItems[1].displayPercentValue, 0);
    assert.equal(menu.usageItems[1].reset, "resets in --");
});

test("preserves unsafe prediction durations and reset overrides for each row", () => {
    const menu = createMenuViewModel(
        { percentDisplayMode: "used" },
        {
            quotas: [
                { ...sessionQuota, resetDescription: "Session reset override" },
                {
                    id: "weekly",
                    usedPercent: 50,
                    resetAt: sessionQuota.resetAt,
                    resetDescription: "Week reset override",
                },
            ],
        },
        {
            quotas: {
                session: { trend: "unsafe", estimatedLimitAt: sessionQuota.resetAt - 7_260 },
                weekly: { trend: "unsafe", estimatedLimitAt: sessionQuota.resetAt - 180_060 },
            },
        },
    );

    assert.equal(menu.usageItems[0].prediction, "Will hit limit ~2h 1m before reset");
    assert.equal(menu.usageItems[1].prediction, "Will hit limit ~2d 2h before reset");
    assert.equal(menu.usageItems[0].predictionStyle, "warning");
    assert.equal(menu.usageItems[1].predictionStyle, "warning");
    assert.equal(menu.usageItems[0].reset, "Session reset override");
    assert.equal(menu.usageItems[1].reset, "Week reset override");
});

test("keeps cached data visible with refresh failure status", () => {
    const viewModel = createMenuViewModel(
        {
            percentDisplayMode: "used",
            topPanelDisplayMode: "label",
        },
        {
            fetchedAt: 1_700_000_000,
            planType: "pro",
            quotas: [sessionQuota],
        },
        {
            quotas: { session: { trend: "safe", estimatedLimitAt: null } },
        },
        [],
        null,
        "Network unavailable",
    );

    assert.equal(viewModel.errorMessage, null);
    assert.equal(viewModel.statusTitle, "Showing cached data");
    assert.equal(viewModel.statusMessage, "Refresh failed: Network unavailable");
    assert.equal(viewModel.usageItems[0].value, "40%");
});
