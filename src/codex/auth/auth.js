import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { isCancellationError, readJsonFile } from "../../io/files.js";
import { CodexError } from "../error.js";
import { parseCodexAccessToken, parseCodexAccountId } from "./auth-parser.js";

const CODEX_AUTH_PATH = GLib.build_filenamev([GLib.get_home_dir(), ".codex", "auth.json"]);

export async function getCodexAccessToken(cancellable = null) {
    return (await getCodexCredentials(cancellable)).accessToken;
}

export async function getCodexCredentials(cancellable = null) {
    const auth = await readCodexAuth(cancellable);
    cancellable?.set_error_if_cancelled();
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

async function readCodexAuth(cancellable) {
    cancellable?.set_error_if_cancelled();
    try {
        const auth = await readJsonFile(CODEX_AUTH_PATH, cancellable);
        if (typeof auth !== "object" || auth === null || Array.isArray(auth)) {
            throw new CodexError(
                "missing-auth",
                "Codex auth file is malformed. Run `codex login` and try again.",
                `Codex auth file at "${CODEX_AUTH_PATH}" does not contain a valid JSON object`,
            );
        }
        return auth;
    } catch (error) {
        if (isCancellationError(error) || error instanceof CodexError) throw error;
        if (
            error instanceof Error &&
            error.cause instanceof GLib.Error &&
            error.cause.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)
        ) {
            throw new CodexError(
                "missing-auth",
                "Codex auth file is missing. Run `codex login` and try again.",
                `Codex auth file does not exist at "${CODEX_AUTH_PATH}"`,
            );
        }
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
