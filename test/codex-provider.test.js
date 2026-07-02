import assert from "node:assert/strict";
import test from "node:test";

import { toUsageSnapshot } from "../dist/infra/providers/codex_usage_response.js";

function validUsageResponse(overrides = {}) {
    return {
        plan_type: "pro",
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
        assert.equal(error.name, "RefreshFailureError");
        assert.equal(error.kind, "unexpected-response");
        return true;
    });
}

test("maps valid Codex usage response to usage snapshot", () => {
    const snapshot = toUsageSnapshot(validUsageResponse());

    assert.equal(snapshot.providerId, "codex");
    assert.equal(snapshot.planType, "pro");
    assert.equal(snapshot.quotas.length, 2);
    assert.deepEqual(snapshot.quotas[0], {
        id: "session",
        label: "Session (5h)",
        usedPercent: 42,
        limitWindowSeconds: 18_000,
        resetAfterSeconds: 900,
        resetAt: 1_700_000_000,
        limitReached: false,
    });
    assert.deepEqual(snapshot.quotas[1], {
        id: "weekly",
        label: "Week",
        usedPercent: 7,
        limitWindowSeconds: 604_800,
        resetAfterSeconds: 86_400,
        resetAt: 1_700_086_400,
        limitReached: false,
    });
    assert.equal(typeof snapshot.fetchedAt, "number");
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
