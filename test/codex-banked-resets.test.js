import assert from "node:assert/strict";
import test from "node:test";

import {
    selectCreditExpiringWithin,
    selectCreditToRedeem,
    toListResponse,
} from "../src/codex/banked-resets/response.js";

function assertUnexpectedResponse(fn, detail) {
    assert.throws(fn, (error) => {
        assert.equal(error.name, "CodexError");
        assert.equal(error.kind, "unexpected-response");
        assert.equal(
            error.message,
            "Codex returned banked reset data this extension does not understand.",
        );
        if (detail !== undefined) {
            assert.equal(
                error.technicalMessage,
                `Unexpected Codex banked reset API response shape: ${detail}`,
            );
        }
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

const optionalCreditFields = [
    "reset_type",
    "granted_at",
    "expires_at",
    "profile_image_url",
    "profile_user_id",
    "title",
    "description",
];

test("accepts optional credit fields as absent, undefined, null, or strings", () => {
    for (const value of [undefined, null, "", "not necessarily a date or URL"]) {
        const response = {
            available_count: -0.5,
            credits: [
                { id: " credit-a ", status: "" },
                {
                    id: "credit-b",
                    status: "unknown-future-status",
                    ...Object.fromEntries(optionalCreditFields.map((key) => [key, value])),
                    extra: true,
                },
            ],
            extra: true,
        };
        assert.equal(toListResponse(response), response);
    }
    const empty = { available_count: 0, credits: [] };
    assert.equal(toListResponse(empty), empty);
});

test("rejects invalid list fields with exact API errors", () => {
    for (const available_count of [undefined, null, "1", NaN, Infinity, -Infinity]) {
        assertUnexpectedResponse(
            () => toListResponse({ available_count, credits: [] }),
            "available_count is missing or not a finite number",
        );
    }
    for (const credits of [undefined, null, {}, "credits", 1]) {
        assertUnexpectedResponse(
            () => toListResponse({ available_count: 0, credits }),
            "credits is missing or not an array",
        );
    }
});

test("rejects invalid credits with exact indexed API errors", () => {
    const validCredit = { id: "credit-a", status: "available" };
    const invalidCredits = [
        ...[null, [], "credit", 1, undefined].map((credit) => [credit, "is not an object"]),
        ...[undefined, null, "", " \t ", 1].map((id) => [
            { ...validCredit, id },
            ".id is missing or not a non-empty string",
        ]),
        ...[undefined, null, 1, false, {}].map((status) => [
            { ...validCredit, status },
            ".status is missing or not a string",
        ]),
    ];
    for (const [credit, detail] of invalidCredits) {
        assertUnexpectedResponse(
            () => toListResponse({ available_count: 1, credits: [validCredit, credit] }),
            `credits[1]${detail.startsWith(".") ? "" : " "}${detail}`,
        );
    }
    for (const key of optionalCreditFields) {
        for (const value of [1, false, [], {}]) {
            assertUnexpectedResponse(
                () =>
                    toListResponse({
                        available_count: 1,
                        credits: [{ ...validCredit, [key]: value }],
                    }),
                `credits[0].${key} is not a string`,
            );
        }
    }
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
