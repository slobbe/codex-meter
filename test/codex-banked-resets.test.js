import assert from "node:assert/strict";
import test from "node:test";

import {
    selectCreditToRedeem,
    toListResponse,
} from "../dist/infra/providers/codex_banked_reset_response.js";

function assertUnexpectedResponse(fn) {
    assert.throws(fn, (error) => {
        assert.equal(error.name, "RefreshFailureError");
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
    const redeemed = { id: "credit-redeemed", status: "redeemed", expires_at: "2026-07-01T00:00:00Z" };
    const unavailable = { id: "credit-unavailable", status: "unavailable", expires_at: "2026-07-02T00:00:00Z" };
    const available = { id: "credit-available", status: "available", expires_at: "2026-07-03T00:00:00Z" };

    assert.equal(selectCreditToRedeem([redeemed, unavailable, available]), available);
});
