export type CodexAuth = {
    auth_mode?: string;
    OPENAI_API_KEY?: string | null;
    tokens?: {
        id_token?: string;
        access_token?: string;
        refresh_token?: string;
        account_id?: string;
    };
    last_refresh?: string;
};

export function parseCodexAccessToken(auth: CodexAuth): string | null {
    if (!auth.tokens || typeof auth.tokens !== "object") {
        return null;
    }

    return auth.tokens.access_token ?? null;
}

export function parseCodexAccountId(auth: CodexAuth): string | null {
    const accountId = auth.tokens?.account_id;

    if (typeof accountId !== "string" || accountId.trim().length === 0) {
        return null;
    }

    return accountId.trim();
}
