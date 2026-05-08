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

export async function getAccessToken(path: string = getCodexAuthPath()): Promise<string | null> {
    if (!isNonEmptyString(path)) {
        console.error("Codex auth path must be a non-empty string");
        return null;
    }

    const auth = await readLocalAuth(path);

    if (!auth) {
        return null;
    }

    return parseAccessToken(auth);
}

function parseAccessToken(auth: CodexAuth): string | null {
    if (!isCodexAuth(auth)) {
        console.error("Codex auth data is malformed: expected an object");
        return null;
    }

    const token = auth.tokens?.access_token;

    if (!auth.tokens || typeof auth.tokens !== "object") {
        console.error("Codex auth data is missing the tokens object");
        return null;
    }

    if (!isNonEmptyString(token)) {
        console.error("Codex auth data does not contain a valid access token");
        return null;
    }

    return token.trim();
}

async function readLocalAuth(path: string): Promise<CodexAuth | null> {
    try {
        const raw = await readJsonFile(path);

        if (!isCodexAuth(raw)) {
            console.error(`Codex auth file at "${path}" does not contain a valid JSON object`);
            return null;
        }

        return raw;
    } catch (err) {
        console.error(`Failed to read Codex auth file at "${path}": ${formatError(err)}`);
        return null;
    }
}

function isCodexAuth(value: unknown): value is CodexAuth {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
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
