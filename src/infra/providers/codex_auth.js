import GLib from "gi://GLib";
import { getLocalAccessToken, readLocalAuth, } from "./auth.js";
import { parseCodexAccessToken, parseCodexAccountId, } from "./codex_auth_parser.js";
export { parseCodexAccessToken, parseCodexAccountId } from "./codex_auth_parser.js";
export function getCodexAuthPath() {
    return GLib.build_filenamev([GLib.get_home_dir(), ".codex", "auth.json"]);
}
export const CODEX_AUTH_CONFIG = {
    providerName: "Codex",
    authPath: getCodexAuthPath(),
    loginCommand: "codex login",
    parseAccessToken: parseCodexAccessToken,
};
export async function getCodexAccessToken() {
    return await getLocalAccessToken(CODEX_AUTH_CONFIG);
}
export async function getCodexCredentials() {
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
