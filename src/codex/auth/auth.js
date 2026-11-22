import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { isCancellationError, readJsonFile } from "../../io/files.js";
import { DEFAULT_CREDENTIALS_PATH } from "../../preferences/settings.js";
import { CodexError } from "../error.js";
import { parseCodexAccessToken, parseCodexAccountId } from "./auth-parser.js";

export function resolveCredentialsPath(path = DEFAULT_CREDENTIALS_PATH) {
    return path.startsWith("~/")
        ? GLib.build_filenamev([GLib.get_home_dir(), path.slice(2)])
        : path;
}

export async function getCodexCredentials(
    cancellable = null,
    credentialsPath = DEFAULT_CREDENTIALS_PATH,
    expectedCredentials = null,
) {
    const auth = await readCodexAuth(resolveCredentialsPath(credentialsPath), cancellable);
    cancellable?.set_error_if_cancelled();
    const accessToken = parseCodexAccessToken(auth);
    if (
        typeof accessToken !== "string" ||
        accessToken.trim().length === 0 ||
        /\s/.test(accessToken.trim())
    ) {
        throw new CodexError(
            "missing-auth",
            "Codex access token is missing or invalid. Select a valid Codex credentials file in Preferences or sign in again.",
            "Codex auth data does not contain a valid access token",
        );
    }
    const token = accessToken.trim();
    const configuredAccount = parseCodexAccountId(auth);
    const claims = readAccessTokenClaims(token);
    const account = claims?.["https://api.openai.com/auth"];
    const tokenAccount = parseCodexAccountId({
        tokens: { account_id: account?.chatgpt_account_id },
    });
    if (tokenAccount && configuredAccount && tokenAccount !== configuredAccount) {
        throw new CodexError(
            "missing-auth",
            "The Codex token does not match the selected account. Sign in again.",
        );
    }

    // Use the bearer token's account claim, not an uncorroborated file field, for cache isolation.
    // This reads local identity metadata. The server authenticates the token on each request.
    const principal = account?.chatgpt_user_id ?? account?.user_id ?? claims?.sub;
    const credentials = {
        accessToken: token,
        accountId: tokenAccount ?? configuredAccount,
        accountFingerprint: tokenAccount
            ? GLib.compute_checksum_for_string(
                  GLib.ChecksumType.SHA256,
                  JSON.stringify([tokenAccount, typeof principal === "string" ? principal : null]),
                  -1,
              )
            : null,
    };
    if (expectedCredentials && !hasSameCodexAccount(credentials, expectedCredentials)) {
        throw new CodexError(
            "credentials-changed",
            "The Codex account changed. Try again with the current account.",
        );
    }
    return credentials;
}

export function hasSameCodexAccount(left, right) {
    if (!left || !right) return false;
    if (left.accountFingerprint || right.accountFingerprint) {
        return left.accountFingerprint === right.accountFingerprint;
    }
    return left.accessToken === right.accessToken && left.accountId === right.accountId;
}

export function createCodexAuthHeaders({ accessToken, accountId }) {
    const headers = { Authorization: `Bearer ${accessToken}` };
    if (accountId) headers["ChatGPT-Account-ID"] = accountId;
    return headers;
}

function readAccessTokenClaims(token) {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    try {
        const bytes = GLib.base64_decode(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch (_error) {
        return null;
    }
}

async function readCodexAuth(path, cancellable) {
    cancellable?.set_error_if_cancelled();
    try {
        const auth = await readJsonFile(path, cancellable);
        if (typeof auth !== "object" || auth === null || Array.isArray(auth)) {
            throw new CodexError(
                "missing-auth",
                "Codex auth file must contain a JSON object. Select a valid Codex credentials file in Preferences or sign in again.",
                `Codex auth file at "${path}" does not contain a valid JSON object`,
            );
        }
        return auth;
    } catch (error) {
        if (isCancellationError(error) || error instanceof CodexError) throw error;
        if (error instanceof SyntaxError) {
            throw new CodexError(
                "missing-auth",
                "Codex auth file contains invalid JSON. Select a valid Codex credentials file in Preferences or sign in again.",
                `Codex auth file at "${path}" contains invalid JSON`,
            );
        }
        if (
            error instanceof Error &&
            error.cause instanceof GLib.Error &&
            error.cause.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)
        ) {
            throw new CodexError(
                "missing-auth",
                "Codex auth file is missing. Select a valid Codex credentials file in Preferences or sign in again.",
                `Codex auth file does not exist at "${path}"`,
            );
        }
        throw new CodexError(
            "missing-auth",
            "Codex auth file could not be read. Select a valid Codex credentials file in Preferences or sign in again.",
            `Failed to read Codex auth file at "${path}"`,
        );
    }
}
