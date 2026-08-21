// @ts-check

/** @typedef {{tokens?: {access_token?: string | null, account_id?: string | null}}} CodexAuth */

/**
 * @param {CodexAuth} auth
 * @returns {string | null}
 */
export function parseCodexAccessToken(auth) {
    if (!auth.tokens || typeof auth.tokens !== "object") {
        return null;
    }

    return auth.tokens.access_token ?? null;
}

/**
 * @param {CodexAuth} auth
 * @returns {string | null}
 */
export function parseCodexAccountId(auth) {
    const accountId = auth.tokens?.account_id;

    if (typeof accountId !== "string" || accountId.trim().length === 0) {
        return null;
    }

    return accountId.trim();
}
