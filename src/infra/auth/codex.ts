import GLib from "gi://GLib";

import { RefreshFailureError } from "../../domain/refresh-failure.js";
import { readJsonFile } from "../filesystem.js";
import { getCodexAuthPath } from "../paths.js";


type CodexAuth = {
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

export async function getAccessToken(path: string = getCodexAuthPath()): Promise<string> {
    if (!isNonEmptyString(path)) {
        console.error("Codex auth path must be a non-empty string");
        throw new RefreshFailureError(
            "missing-auth",
            "Codex auth is unavailable. Run `codex login` and try again.",
            "Codex auth path must be a non-empty string",
        );
    }

    const auth = await readLocalAuth(path);

    return parseAccessToken(auth);
}

function parseAccessToken(auth: CodexAuth): string {
    if (!isCodexAuth(auth)) {
        console.error("Codex auth data is malformed: expected an object");
        throw new RefreshFailureError(
            "missing-auth",
            "Codex auth is malformed. Run `codex login` and try again.",
            "Codex auth data is malformed: expected an object",
        );
    }

    const token = auth.tokens?.access_token;

    if (!auth.tokens || typeof auth.tokens !== "object") {
        console.error("Codex auth data is missing the tokens object");
        throw new RefreshFailureError(
            "missing-auth",
            "Codex access token is missing. Run `codex login` and try again.",
            "Codex auth data is missing the tokens object",
        );
    }

    if (!isUsableAccessToken(token)) {
        console.error("Codex auth data does not contain a valid access token");
        throw new RefreshFailureError(
            "missing-auth",
            "Codex access token is missing. Run `codex login` and try again.",
            "Codex auth data does not contain a valid access token",
        );
    }

    return token.trim();
}

async function readLocalAuth(path: string): Promise<CodexAuth> {
    if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
        throw new RefreshFailureError(
            "missing-auth",
            "Codex auth file is missing. Run `codex login` and try again.",
            `Codex auth file does not exist at "${path}"`,
        );
    }

    try {
        const raw = await readJsonFile(path);

        if (!isCodexAuth(raw)) {
            console.error(`Codex auth file at "${path}" does not contain a valid JSON object`);
            throw new RefreshFailureError(
                "missing-auth",
                "Codex auth file is malformed. Run `codex login` and try again.",
                `Codex auth file at "${path}" does not contain a valid JSON object`,
            );
        }

        return raw;
    } catch (err) {
        if (err instanceof RefreshFailureError) {
            throw err;
        }

        console.error(`Failed to read Codex auth file at "${path}": ${formatError(err)}`);
        throw new RefreshFailureError(
            "missing-auth",
            "Codex auth file could not be read. Run `codex login` and try again.",
            `Failed to read Codex auth file at "${path}": ${formatError(err)}`,
        );
    }
}

function isCodexAuth(value: unknown): value is CodexAuth {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function isUsableAccessToken(value: unknown): value is string {
    return isNonEmptyString(value) && !/\s/.test(value.trim());
}

function formatError(err: unknown): string {
    if (err instanceof Error && err.message) {
        return err.message;
    }

    if (typeof err === "string" && err.length > 0) {
        return err;
    }

    return "Unknown error";
}
