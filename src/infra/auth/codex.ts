import GLib from "gi://GLib";
import { readJsonFile } from "../filesystem.js";
const CODEX_AUTH_PATH = `${GLib.get_home_dir()}/.codex/auth.json`;

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

export async function getAccessToken(path: string = CODEX_AUTH_PATH): Promise<string | null> {
    const auth = await readLocalAuth(path);

    if (!auth) {
        return null;
    }

    return parseAccessToken(auth);
}

function parseAccessToken(auth: CodexAuth): string | null {
    const token = auth.tokens?.access_token;

    if (typeof token !== "string" || token.length === 0) {
        return null;
    }

    return token;
}

async function readLocalAuth(path: string): Promise<CodexAuth | null> {
    try {
        const raw = await readJsonFile(path);

        if (!raw || typeof raw !== "object") {
            return null;
        }

        return raw as CodexAuth;
    } catch (err) {
        console.error("Failed to read Codex auth file", err);
        return null;
    }
}
