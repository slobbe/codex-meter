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

export async function getCodexAccessToken(
    cancellable = null,
    credentialsPath = DEFAULT_CREDENTIALS_PATH,
) {
    return (await getCodexCredentials(cancellable, credentialsPath)).accessToken;
}

export async function getCodexCredentials(
    cancellable = null,
    credentialsPath = DEFAULT_CREDENTIALS_PATH,
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
            "Codex access token is missing. Run `codex login` and try again.",
            "Codex auth data does not contain a valid access token",
        );
    }
    return {
        accessToken: accessToken.trim(),
        accountId: parseCodexAccountId(auth),
    };
}

async function readCodexAuth(path, cancellable) {
    cancellable?.set_error_if_cancelled();
    try {
        const auth = await readJsonFile(path, cancellable);
        if (typeof auth !== "object" || auth === null || Array.isArray(auth)) {
            throw new CodexError(
                "missing-auth",
                "Codex auth file is malformed. Run `codex login` and try again.",
                `Codex auth file at "${path}" does not contain a valid JSON object`,
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
                `Codex auth file does not exist at "${path}"`,
            );
        }
        throw new CodexError(
            "missing-auth",
            "Codex auth file could not be read. Run `codex login` and try again.",
            `Failed to read Codex auth file at "${path}": Failed to read JSON file "${path}": ${formatError(error)}`,
        );
    }
}

function formatError(error) {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string" && error.length > 0) return error;
    return "Unknown error";
}
