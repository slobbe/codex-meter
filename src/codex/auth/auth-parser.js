// @ts-check

/** @typedef {{tokens?: {access_token?: string | null, account_id?: string | null}}} CodexAuth */

/** @param {CodexAuth} auth */
export function parseCodexAccessToken(auth) {
    if (!auth.tokens || typeof auth.tokens !== "object") {
        return null;
    }

    return auth.tokens.access_token ?? null;
}

/** @param {CodexAuth} auth */
export function parseCodexAccountId(auth) {
    const accountId = auth.tokens?.account_id;

    if (typeof accountId !== "string") return null;
    const trimmed = accountId.trim();
    return trimmed && !/[\s\p{Cc}]/u.test(trimmed) ? trimmed : null;
}
