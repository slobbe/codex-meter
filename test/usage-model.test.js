import assert from "node:assert/strict";
import test from "node:test";

import { getUsageWindowMetadata, sortUsageQuotas } from "../src/codex/usage/model.js";

test("sorts quotas shortest first without mutating the input or quota objects", () => {
    const weekly = Object.freeze({ id: "weekly", limitWindowSeconds: 604_800 });
    const hourly = Object.freeze({ id: "hourly", limitWindowSeconds: 3_600 });
    const session = Object.freeze({ id: "session", limitWindowSeconds: 18_000 });
    const quotas = Object.freeze([weekly, hourly, session]);

    const sorted = sortUsageQuotas(quotas);

    assert.deepEqual(sorted, [hourly, session, weekly]);
    assert.deepEqual(quotas, [weekly, hourly, session]);
    assert.notEqual(sorted, quotas);
    assert.equal(sorted[0], hourly);
    assert.equal(sorted[1], session);
    assert.equal(sorted[2], weekly);
});

test("preserves the relative order of quotas with equal durations", () => {
    const first = { id: "first", limitWindowSeconds: 3_600 };
    const second = { id: "second", limitWindowSeconds: 3_600 };
    const longer = { id: "longer", limitWindowSeconds: 18_000 };

    assert.deepEqual(sortUsageQuotas([longer, first, second]), [first, second, longer]);
});

test("sorts missing and invalid durations last in their original order", () => {
    const invalid = [undefined, null, 0, -1, NaN, Infinity, -Infinity, "3600", {}, true].map(
        (limitWindowSeconds, index) => ({ id: `invalid-${index}`, limitWindowSeconds }),
    );
    const missing = { id: "missing" };
    const short = { id: "short", limitWindowSeconds: 0.5 };
    const long = { id: "long", limitWindowSeconds: 18_000 };

    assert.deepEqual(sortUsageQuotas([missing, long, ...invalid, short]), [
        short,
        long,
        missing,
        ...invalid,
    ]);
});

test("sorts an empty quota array into a new empty array", () => {
    const quotas = [];
    const sorted = sortUsageQuotas(quotas);

    assert.deepEqual(sorted, []);
    assert.notEqual(sorted, quotas);
});

for (const [seconds, type, label] of [
    [3_600, "hour", "Hourly"],
    [7_200, "hour", "2 hours"],
    [18_000, "hour", "5 hours"],
    [604_800, "week", "Weekly"],
    [1_209_600, "week", "2 weeks"],
    [3_024_000, "week", "5 weeks"],
    [90, "unknown", "90 seconds"],
    [3_601, "unknown", "3601 seconds"],
    [0.5, "unknown", "0.5 seconds"],
]) {
    test(`describes a ${seconds}-second usage window`, () => {
        assert.deepEqual(getUsageWindowMetadata(seconds), { type, label });
    });
}

for (const seconds of [undefined, null, 0, -1, NaN, Infinity, -Infinity, "3600", {}, true]) {
    test(`uses generic metadata for invalid duration ${seconds}`, () => {
        assert.deepEqual(getUsageWindowMetadata(seconds), { type: "unknown", label: "Usage" });
    });
}
