import assert from "node:assert/strict";
import test from "node:test";

import { formatLimitPrediction } from "../dist/ui/view-model.js";

test("formats reached limits explicitly", () => {
    assert.equal(
        formatLimitPrediction({ trend: "limit reached", estimatedLimitAt: null }, "primary"),
        "Limit reached",
    );
});

test("keeps safe limits blank", () => {
    assert.equal(
        formatLimitPrediction({ trend: "safe", estimatedLimitAt: null }, "primary"),
        "",
    );
});
