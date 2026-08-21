import GLib from "gi://GLib";
import { readJsonFile } from "../../io/files.js";
import { CodexError } from "../error.js";
import { parseCodexAccessToken, parseCodexAccountId } from "./auth-parser.js";

const CODEX_AUTH_PATH = GLib.build_filenamev([GLib.get_home_dir(), ".codex", "auth.json"]);

export async function getCodexAccessToken() {
    return (await getCodexCredentials()).accessToken;
}

export async function getCodexCredentials() {
    const auth = await readCodexAuth();
    const accessToken = parseCodexAccessToken(auth);
    if (
        typeof accessToken !== "string" ||
        accessToken.trim().length === 0 ||
        /\s/.test(accessToken.trim())
    ) {
        throw new CodexError(
            "missing-auth",
            "Codex access token is missing. Run `codex login` and try again.",
            "Codex auth data does not contain a valid access token",
        );
    }
    return {
        accessToken: accessToken.trim(),
        accountId: parseCodexAccountId(auth),
    };
}

async function readCodexAuth() {
    if (!GLib.file_test(CODEX_AUTH_PATH, GLib.FileTest.EXISTS)) {
        throw new CodexError(
            "missing-auth",
            "Codex auth file is missing. Run `codex login` and try again.",
            `Codex auth file does not exist at "${CODEX_AUTH_PATH}"`,
        );
    }
    try {
        const auth = await readJsonFile(CODEX_AUTH_PATH);
        if (typeof auth !== "object" || auth === null || Array.isArray(auth)) {
            throw new CodexError(
                "missing-auth",
                "Codex auth file is malformed. Run `codex login` and try again.",
                `Codex auth file at "${CODEX_AUTH_PATH}" does not contain a valid JSON object`,
            );
        }
        return auth;
    } catch (error) {
        if (error instanceof CodexError) throw error;
        throw new CodexError(
            "missing-auth",
            "Codex auth file could not be read. Run `codex login` and try again.",
            `Failed to read Codex auth file at "${CODEX_AUTH_PATH}": Failed to read JSON file "${CODEX_AUTH_PATH}": ${formatError(error)}`,
        );
    }
}

function formatError(error) {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string" && error.length > 0) return error;
    return "Unknown error";
}
