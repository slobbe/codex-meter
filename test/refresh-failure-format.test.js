import assert from "node:assert/strict";
import test from "node:test";

import { RefreshFailureError } from "../src/refresh/error.js";
import { formatRefreshFailure } from "../src/panel/refresh-error-message.js";

test("refresh failure UI shows only the user-facing message", () => {
    const message = "Codex authentication expired. Please run `codex login` again.";
    const error = new RefreshFailureError(
        "unauthorized",
        message,
        "Codex auth file does not exist at /home/example/.codex/auth.json",
    );

    const formatted = formatRefreshFailure(error);

    assert.equal(formatted, message);
    assert.doesNotMatch(formatted, /\/home\/example/);
    assert.doesNotMatch(formatted, /auth\.json/);
});

test("generic refresh failures do not expose arbitrary error text", () => {
    const formatted = formatRefreshFailure(new Error("token abc"));

    assert.equal(formatted, "Codex usage refresh failed. Try again later.");
    assert.doesNotMatch(formatted, /token abc/);
});
