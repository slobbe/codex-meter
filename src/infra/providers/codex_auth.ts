import GLib from "gi://GLib";

import {
    getLocalAccessToken,
    LocalTokenAuthConfig,
    readLocalAuth,
} from "./auth.js";
import {
    CodexAuth,
    parseCodexAccessToken,
    parseCodexAccountId,
} from "./codex_auth_parser.js";

export type { CodexAuth } from "./codex_auth_parser.js";
export { parseCodexAccessToken, parseCodexAccountId } from "./codex_auth_parser.js";

export type CodexCredentials = {
    accessToken: string;
    accountId: string | null;
};

export function getCodexAuthPath() {
    return GLib.build_filenamev([GLib.get_home_dir(), ".codex", "auth.json"]);
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
