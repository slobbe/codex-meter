import assert from "node:assert/strict";
import test from "node:test";

import { toUsageSnapshot } from "../src/codex/usage/response.js";

function validUsageResponse(overrides = {}) {
    return {
        plan_type: "pro",
        rate_limit_reset_credits: {
            available_count: 2,
            applicable_available_count: 1,
        },
        rate_limit: {
            limit_reached: false,
            primary_window: {
                used_percent: 42,
                limit_window_seconds: 18_000,
                reset_after_seconds: 900,
                reset_at: 1_700_000_000,
            },
            secondary_window: {
                used_percent: 7,
                limit_window_seconds: 604_800,
                reset_after_seconds: 86_400,
                reset_at: 1_700_086_400,
            },
        },
        ...overrides,
    };
}

function assertUnexpectedResponse(fn) {
    assert.throws(fn, (error) => {
        assert.equal(error.name, "CodexError");
        assert.equal(error.kind, "unexpected-response");
        return true;
    });
}

test("maps valid Codex usage response to usage snapshot", () => {
    const snapshot = toUsageSnapshot(validUsageResponse());

    assert.equal(snapshot.planType, "pro");
    assert.equal(snapshot.bankedResetCount, 2);
    assert.equal(snapshot.quotas.length, 2);
    assert.deepEqual(snapshot.quotas[0], {
        id: "session",
        label: "5 hours",
        type: "hour",
        usedPercent: 42,
        limitWindowSeconds: 18_000,
        resetAfterSeconds: 900,
        resetAt: 1_700_000_000,
        limitReached: false,
    });
    assert.deepEqual(snapshot.quotas[1], {
        id: "weekly",
        label: "Weekly",
        type: "week",
        usedPercent: 7,
        limitWindowSeconds: 604_800,
        resetAfterSeconds: 86_400,
        resetAt: 1_700_086_400,
        limitReached: false,
    });
    assert.equal(typeof snapshot.fetchedAt, "number");
});

test("supports usage responses without a banked-reset summary", () => {
    const response = validUsageResponse();
    delete response.rate_limit_reset_credits;

    assert.equal(toUsageSnapshot(response).bankedResetCount, undefined);
});

test("maps a weekly-only Codex response without a session quota", () => {
    const snapshot = toUsageSnapshot(
        validUsageResponse({
            rate_limit: {
                limit_reached: false,
                primary_window: {
                    used_percent: 0,
                    limit_window_seconds: 604_800,
                    reset_after_seconds: 604_762,
                    reset_at: 1_784_488_950,
                },
                secondary_window: null,
            },
        }),
    );

    assert.deepEqual(snapshot.quotas, [
        {
            id: "weekly",
            label: "Weekly",
            type: "week",
            usedPercent: 0,
            limitWindowSeconds: 604_800,
            resetAfterSeconds: 604_762,
            resetAt: 1_784_488_950,
            limitReached: false,
        },
    ]);
});

for (const [seconds, id, type, label] of [
    [3_600, "window-3600", "hour", "Hourly"],
    [7_200, "window-7200", "hour", "2 hours"],
    [18_000, "session", "hour", "5 hours"],
    [604_800, "weekly", "week", "Weekly"],
    [1_209_600, "window-1209600", "week", "2 weeks"],
    [3_024_000, "window-3024000", "week", "5 weeks"],
    [90, "window-90", "unknown", "90 seconds"],
]) {
    for (const position of ["primary_window", "secondary_window"]) {
        test(`normalizes a single ${seconds}-second window in ${position}`, () => {
            const response = validUsageResponse();
            const window = { ...response.rate_limit.primary_window, limit_window_seconds: seconds };
            response.rate_limit.primary_window = null;
            response.rate_limit.secondary_window = null;
            response.rate_limit[position] = window;

            const snapshot = toUsageSnapshot(response);

            assert.equal(snapshot.quotas.length, 1);
            assert.deepEqual(snapshot.quotas[0], {
                id,
                type,
                label,
                usedPercent: window.used_percent,
                limitWindowSeconds: seconds,
                resetAfterSeconds: window.reset_after_seconds,
                resetAt: window.reset_at,
                limitReached: false,
            });
        });
    }
}

test("sorts swapped API windows shortest first and preserves duration-based compatibility IDs", () => {
    const response = validUsageResponse();
    const { primary_window, secondary_window } = response.rate_limit;
    response.rate_limit.primary_window = secondary_window;
    response.rate_limit.secondary_window = primary_window;
    response.rate_limit.limit_reached = true;

    const snapshot = toUsageSnapshot(response);

    assert.deepEqual(
        snapshot.quotas.map(({ id, type, label, usedPercent, limitReached }) => ({
            id,
            type,
            label,
            usedPercent,
            limitReached,
        })),
        [
            { id: "session", type: "hour", label: "5 hours", usedPercent: 42, limitReached: true },
            { id: "weekly", type: "week", label: "Weekly", usedPercent: 7, limitReached: true },
        ],
    );
});

test("discovers all suffixed windows and sorts three or more durations shortest first", () => {
    const response = validUsageResponse();
    const window = response.rate_limit.primary_window;
    response.rate_limit = {
        monthly_window: { ...window, limit_window_seconds: 2_592_000 },
        ...response.rate_limit,
        unused_window: null,
        hourly_window: { ...window, limit_window_seconds: 3_600 },
        removed_window: undefined,
        not_a_window_summary: { used_percent: "ignored" },
    };

    const snapshot = toUsageSnapshot(response);

    assert.deepEqual(
        snapshot.quotas.map(({ id, limitWindowSeconds }) => [id, limitWindowSeconds]),
        [
            ["window-3600", 3_600],
            ["session", 18_000],
            ["weekly", 604_800],
            ["window-2592000", 2_592_000],
        ],
    );

    delete response.rate_limit.primary_window;
    response.rate_limit.secondary_window = undefined;
    response.rate_limit.monthly_window = null;
    assert.deepEqual(toUsageSnapshot(response).quotas, [snapshot.quotas[0]]);
});

test("accepts a window with an arbitrary API field name and no legacy fields", () => {
    const response = validUsageResponse();
    response.rate_limit = {
        limit_reached: false,
        custom_window: response.rate_limit.secondary_window,
    };

    assert.deepEqual(
        toUsageSnapshot(response).quotas.map(({ id }) => id),
        ["weekly"],
    );
});

for (const windows of [
    {},
    { primary_window: null, secondary_window: null },
    { removed_window: undefined, unused_window: null },
    { not_a_window_summary: {} },
]) {
    test(`rejects a response without any non-null usage windows: ${JSON.stringify(windows)}`, () => {
        assertUnexpectedResponse(() =>
            toUsageSnapshot(
                validUsageResponse({ rate_limit: { limit_reached: false, ...windows } }),
            ),
        );
    });
}

for (const malformed of [
    false,
    [],
    "window",
    {},
    { ...validUsageResponse().rate_limit.primary_window, used_percent: "42" },
    { ...validUsageResponse().rate_limit.primary_window, limit_window_seconds: 0 },
    { ...validUsageResponse().rate_limit.primary_window, reset_after_seconds: Infinity },
    { ...validUsageResponse().rate_limit.primary_window, reset_at: undefined },
]) {
    test(`validates extra usage windows: ${JSON.stringify(malformed)}`, () => {
        const response = validUsageResponse();
        response.rate_limit.extra_window = malformed;

        assertUnexpectedResponse(() => toUsageSnapshot(response));
    });
}

for (const seconds of [18_000, 604_800, 3_600]) {
    test(`gives equal ${seconds}-second windows unique field-based IDs independent of API order`, () => {
        const response = validUsageResponse();
        const window = { ...response.rate_limit.primary_window, limit_window_seconds: seconds };
        response.rate_limit = {
            limit_reached: false,
            alpha_window: { ...window, used_percent: 10 },
            beta_window: { ...window, used_percent: 20 },
            gamma_window: { ...window, used_percent: 30 },
        };
        const baseId =
            seconds === 18_000 ? "session" : seconds === 604_800 ? "weekly" : "window-3600";
        const snapshot = toUsageSnapshot(response);
        assert.deepEqual(
            snapshot.quotas.map(({ id, usedPercent }) => [id, usedPercent]),
            [
                [`${baseId}-alpha_window`, 10],
                [`${baseId}-beta_window`, 20],
                [`${baseId}-gamma_window`, 30],
            ],
        );

        response.rate_limit = Object.fromEntries(Object.entries(response.rate_limit).reverse());
        const reordered = toUsageSnapshot(response);
        for (const quota of snapshot.quotas) {
            assert.deepEqual(
                reordered.quotas.find(({ id }) => id === quota.id),
                quota,
            );
        }

        delete response.rate_limit.beta_window;
        assert.deepEqual(
            new Set(toUsageSnapshot(response).quotas.map(({ id }) => id)),
            new Set([`${baseId}-alpha_window`, `${baseId}-gamma_window`]),
        );
    });
}

for (const seconds of [0, -1, NaN, Infinity, "3600", null, undefined]) {
    test(`rejects invalid window duration ${seconds}`, () => {
        const response = validUsageResponse();
        response.rate_limit.primary_window.limit_window_seconds = seconds;

        assertUnexpectedResponse(() => toUsageSnapshot(response));
    });
}

test("maps Codex credit balance when present", () => {
    const snapshot = toUsageSnapshot(
        validUsageResponse({
            credits: {
                has_credits: true,
                unlimited: false,
                overage_limit_reached: false,
                balance: "$4.21",
            },
        }),
    );

    assert.deepEqual(snapshot.credits, {
        balance: "$4.21",
        unlimited: false,
    });
});

test("throws unexpected-response when plan_type is missing", () => {
    const response = validUsageResponse();
    delete response.plan_type;

    assertUnexpectedResponse(() => toUsageSnapshot(response));
});

test("throws unexpected-response when primary window used_percent is not numeric", () => {
    const response = validUsageResponse({
        rate_limit: {
            ...validUsageResponse().rate_limit,
            primary_window: {
                ...validUsageResponse().rate_limit.primary_window,
                used_percent: "42",
            },
        },
    });

    assertUnexpectedResponse(() => toUsageSnapshot(response));
});
