import GLib from "gi://GLib";

import {
    getLocalAccessToken,
    LocalTokenAuthConfig,
    readLocalAuth,
} from "./auth.js";

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

export type CodexCredentials = {
    accessToken: string;
    accountId: string | null;
};

export function getCodexAuthPath() {
    return GLib.build_filenamev([GLib.get_home_dir(), ".codex", "auth.json"]);
}

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

export const CODEX_AUTH_CONFIG: LocalTokenAuthConfig<CodexAuth> = {
    providerName: "Codex",
    authPath: getCodexAuthPath(),
    loginCommand: "codex login",
    parseAccessToken: parseCodexAccessToken,
};

export async function getCodexAccessToken(): Promise<string> {
    return await getLocalAccessToken(CODEX_AUTH_CONFIG);
}

export async function getCodexCredentials(): Promise<CodexCredentials> {
    const auth = await readLocalAuth(CODEX_AUTH_CONFIG.authPath, CODEX_AUTH_CONFIG);
    const accessToken = parseCodexAccessToken(auth);

    if (!accessToken || accessToken.trim().length === 0 || /\s/.test(accessToken.trim())) {
        return {
            accessToken: await getCodexAccessToken(),
            accountId: parseCodexAccountId(auth),
        };
    }

    return {
        accessToken: accessToken.trim(),
        accountId: parseCodexAccountId(auth),
    };
}
