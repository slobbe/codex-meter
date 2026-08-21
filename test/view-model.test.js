import assert from "node:assert/strict";
import test from "node:test";

import {
    createMenuViewModel,
    createPanelBarViewModel,
    formatFooter,
    formatLimitPrediction,
} from "../src/panel/view-model.js";

const sessionQuota = {
    id: "session",
    label: "Session (5h)",
    usedPercent: 40,
    resetAfterSeconds: 14_400,
    resetAt: 1_700_014_400,
};

test("formats reached limits explicitly", () => {
    assert.equal(
        formatLimitPrediction(
            { trend: "limit reached", estimatedLimitAt: null },
            sessionQuota,
            "primary",
        ),
        "Limit reached",
    );
});

test("formats safe limits actionably", () => {
    assert.equal(
        formatLimitPrediction({ trend: "safe", estimatedLimitAt: null }, sessionQuota, "primary"),
        "Safe at current pace",
    );
});

test("keeps unknown predictions blank", () => {
    assert.equal(
        formatLimitPrediction(
            { trend: "unknown", estimatedLimitAt: null },
            sessionQuota,
            "primary",
        ),
        "",
    );
});

test("formats unsafe predictions relative to reset", () => {
    assert.equal(
        formatLimitPrediction(
            { trend: "unsafe", estimatedLimitAt: sessionQuota.resetAt - 7_200 },
            sessionQuota,
            "primary",
        ),
        "Will hit limit ~2h before reset",
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
        showPrimary: true,
        showSecondary: true,
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

test("keeps cached data visible with refresh failure status", () => {
    const viewModel = createMenuViewModel(
        {
            percentDisplayMode: "used",
            showPrimary: true,
            showSecondary: true,
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

    assert.equal(viewModel.hasError, false);
    assert.equal(viewModel.errorMessage, null);
    assert.equal(viewModel.statusTitle, "Showing cached data");
    assert.equal(viewModel.statusMessage, "Refresh failed: Network unavailable");
    assert.equal(viewModel.primary.value, "40%");
});
