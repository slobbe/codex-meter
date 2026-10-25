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

test("keeps loading labels and error visibility unchanged", () => {
    for (const topPanelDisplayMode of ["bars", "percentages"]) {
        const settings = { topPanelDisplayMode, percentDisplayMode: "used" };
        const loading = createPanelBarViewModel(settings, null, null);
        assert.equal(loading.showBars, topPanelDisplayMode === "bars");
        assert.equal(loading.showLabel, topPanelDisplayMode !== "bars");
        assert.equal(loading.label, topPanelDisplayMode === "bars" ? "" : "--");

        for (const snapshot of [null, { quotas: [sessionQuota] }]) {
            const error = createPanelBarViewModel(settings, snapshot, "Unable to refresh");
            assert.equal(error.primaryVisible, false);
            assert.equal(error.secondaryVisible, false);
            assert.equal(error.showBars, false);
            assert.equal(error.showLabel, false);
            assert.equal(error.label, "");
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
    for (const windowType of ["primary", "secondary"]) {
        assert.equal(formatReset({ resetAfterSeconds: 45_600 }, windowType), "resets in 12h 40m");
        assert.equal(formatReset({ resetAfterSeconds: 1_500 }, windowType), "resets in 25m");
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

test("omits the session UI when only weekly usage is available", () => {
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
        primary: { trend: "unknown", estimatedLimitAt: null },
        secondary: { trend: "safe", estimatedLimitAt: null },
    };

    const menu = createMenuViewModel(settings, snapshot, prediction);
    const panel = createPanelBarViewModel(settings, snapshot, null);

    assert.equal(menu.primary.visible, false);
    assert.equal(menu.secondary.visible, true);
    assert.equal(menu.secondary.title, "Week");
    assert.equal(panel.primaryVisible, false);
    assert.equal(panel.secondaryVisible, true);
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

    for (const quotas of [[session], [weekly], [session, weekly], []]) {
        for (const mode of ["used", "left"]) {
            const menu = createMenuViewModel(
                { percentDisplayMode: mode },
                { quotas },
                {
                    quotas: {
                        session: { trend: "safe" },
                        weekly: { trend: "limit reached" },
                    },
                    primary: { trend: "limit reached" },
                    secondary: { trend: "safe" },
                },
            );
            const hasSession = quotas.includes(session);
            const hasWeekly = quotas.includes(weekly);
            const left = mode === "left";
            assert.deepEqual(menu.primary, {
                visible: hasSession,
                title: hasSession ? "Session (5h)" : "Primary",
                value: hasSession ? (left ? "60%" : "40%") : "--",
                prediction: hasSession ? "Safe at current pace" : "Limit reached",
                reset: hasSession ? "resets in 4h 0m" : "resets in --",
                percentValue: hasSession ? 40 : 0,
                displayPercentValue: hasSession ? (left ? 60 : 40) : left ? 100 : 0,
                displayBaselinePercentValue: hasSession ? (left ? 80 : 20) : null,
                percentLabel: mode,
                predictionStyle: hasSession ? "safe" : "danger",
            });
            assert.deepEqual(menu.secondary, {
                visible: hasWeekly,
                title: hasWeekly ? "Week" : "Secondary",
                value: hasWeekly ? (left ? "75%" : "25%") : "--",
                prediction: hasWeekly ? "Limit reached" : "Safe at current pace",
                reset: hasWeekly ? "resets in 1d 18h" : "resets in --",
                percentValue: hasWeekly ? 25 : 0,
                displayPercentValue: hasWeekly ? (left ? 75 : 25) : left ? 100 : 0,
                displayBaselinePercentValue: hasWeekly ? (left ? 25 : 75) : null,
                percentLabel: mode,
                predictionStyle: hasWeekly ? "danger" : "safe",
            });
        }
    }
});

test("does not use positional predictions for present quotas without an id prediction", () => {
    const menu = createMenuViewModel(
        { percentDisplayMode: "left" },
        { quotas: [sessionQuota, { id: "weekly", usedPercent: 125 }] },
        { primary: { trend: "safe" }, secondary: { trend: "limit reached" } },
    );

    for (const row of [menu.primary, menu.secondary]) {
        assert.equal(row.prediction, "");
        assert.equal(row.predictionStyle, "muted");
        assert.equal(row.displayBaselinePercentValue, null);
    }
    assert.equal(menu.primary.value, "60%");
    assert.equal(menu.secondary.title, "Secondary");
    assert.equal(menu.secondary.value, "0%");
    assert.equal(menu.secondary.percentValue, 100);
    assert.equal(menu.secondary.displayPercentValue, 0);
    assert.equal(menu.secondary.reset, "resets in --");
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

    assert.equal(menu.primary.prediction, "Will hit limit ~2h 1m before reset");
    assert.equal(menu.secondary.prediction, "Will hit limit ~2d 2h before reset");
    assert.equal(menu.primary.predictionStyle, "warning");
    assert.equal(menu.secondary.predictionStyle, "warning");
    assert.equal(menu.primary.reset, "Session reset override");
    assert.equal(menu.secondary.reset, "Week reset override");
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
            primary: { trend: "safe", estimatedLimitAt: null },
            secondary: { trend: "unknown", estimatedLimitAt: null },
        },
        [],
        null,
        "Network unavailable",
    );

    assert.equal(viewModel.errorMessage, null);
    assert.equal(viewModel.statusTitle, "Showing cached data");
    assert.equal(viewModel.statusMessage, "Refresh failed: Network unavailable");
    assert.equal(viewModel.primary.value, "40%");
});
