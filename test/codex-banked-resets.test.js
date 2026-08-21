import assert from "node:assert/strict";
import test from "node:test";

import {
    selectCreditExpiringWithin,
    selectCreditToRedeem,
    toListResponse,
} from "../src/codex/banked-resets/response.js";

function assertUnexpectedResponse(fn) {
    assert.throws(fn, (error) => {
        assert.equal(error.name, "CodexError");
        assert.equal(error.kind, "unexpected-response");
        return true;
    });
}

test("returns valid banked-reset list response shape", () => {
    const response = {
        available_count: 1,
        credits: [
            {
                id: "credit-a",
                status: "available",
                reset_type: "weekly",
                expires_at: "2026-07-03T00:00:00Z",
                title: "Banked reset",
                description: "Fake fixture description",
            },
        ],
    };

    assert.equal(toListResponse(response), response);
});

test("throws unexpected-response when available_count is missing", () => {
    assertUnexpectedResponse(() => toListResponse({ credits: [] }));
});

test("throws unexpected-response when credits is not an array", () => {
    assertUnexpectedResponse(() => toListResponse({ available_count: 0, credits: null }));
});

test("selectCreditToRedeem returns null for empty credits", () => {
    assert.equal(selectCreditToRedeem([]), null);
});

test("selectCreditToRedeem selects earliest valid expiry", () => {
    const creditA = { id: "credit-a", status: "available", expires_at: "2026-07-05T00:00:00Z" };
    const creditB = { id: "credit-b", status: "available", expires_at: "2026-07-03T00:00:00Z" };

    assert.equal(selectCreditToRedeem([creditA, creditB]), creditB);
});

test("selectCreditToRedeem returns first available credit when any available expiry is invalid", () => {
    const creditA = { id: "credit-a", status: "available", expires_at: "2026-07-05T00:00:00Z" };
    const creditB = { id: "credit-b", status: "available" };

    assert.equal(selectCreditToRedeem([creditA, creditB]), creditA);
});

test("selectCreditToRedeem ignores redeemed and unavailable credits", () => {
    const redeemed = {
        id: "credit-redeemed",
        status: "redeemed",
        expires_at: "2026-07-01T00:00:00Z",
    };
    const unavailable = {
        id: "credit-unavailable",
        status: "unavailable",
        expires_at: "2026-07-02T00:00:00Z",
    };
    const available = {
        id: "credit-available",
        status: "available",
        expires_at: "2026-07-03T00:00:00Z",
    };

    assert.equal(selectCreditToRedeem([redeemed, unavailable, available]), available);
});

test("selectCreditExpiringWithin selects the earliest credit in the window", () => {
    const now = Date.parse("2026-07-02T00:00:00Z");
    const later = { id: "credit-later", status: "available", expires_at: "2026-07-02T00:45:00Z" };
    const earlier = {
        id: "credit-earlier",
        status: "available",
        expires_at: "2026-07-02T00:30:00Z",
    };
    const outside = {
        id: "credit-outside",
        status: "available",
        expires_at: "2026-07-02T02:00:00Z",
    };

    assert.equal(
        selectCreditExpiringWithin([later, outside, earlier], now, 60 * 60 * 1000),
        earlier,
    );
});

test("selectCreditExpiringWithin ignores expired, invalid, and unavailable credits", () => {
    const now = Date.parse("2026-07-02T00:00:00Z");
    const expired = {
        id: "credit-expired",
        status: "available",
        expires_at: "2026-07-01T23:59:59Z",
    };
    const invalid = { id: "credit-invalid", status: "available", expires_at: "unknown" };
    const redeemed = {
        id: "credit-redeemed",
        status: "redeemed",
        expires_at: "2026-07-02T12:00:00Z",
    };

    assert.equal(
        selectCreditExpiringWithin([expired, invalid, redeemed], now, 60 * 60 * 1000),
        null,
    );
});
