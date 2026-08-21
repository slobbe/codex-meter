import assert from "node:assert/strict";
import test from "node:test";

import {
    parseCodexAccessToken,
    parseCodexAccountId,
} from "../src/codex/auth-parser.js";

test("returns access token from tokens.access_token", () => {
    assert.equal(parseCodexAccessToken({ tokens: { access_token: "fake-access-token" } }), "fake-access-token");
});

test("returns null when tokens are absent", () => {
    assert.equal(parseCodexAccessToken({}), null);
});

test("trims account ID", () => {
    assert.equal(parseCodexAccountId({ tokens: { account_id: "  account-test  " } }), "account-test");
});

test("returns null for blank account ID", () => {
    assert.equal(parseCodexAccountId({ tokens: { account_id: "   " } }), null);
});
