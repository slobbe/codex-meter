import GLib from "gi://GLib";
import { RefreshFailureError } from "../refresh/error.js";
import { readJsonFile } from "../io/files.js";
export async function getLocalAccessToken(config) {
    if (!isNonEmptyString(config.authPath)) {
        throw new RefreshFailureError("missing-auth", `${config.providerName} auth is unavailable. Run \`${config.loginCommand}\` and try again.`, `${config.providerName} auth path must be a non-empty string`);
    }
    const auth = await readLocalAuth(config.authPath, config);
    const token = config.parseAccessToken(auth);
    if (!isUsableAccessToken(token)) {
        throw new RefreshFailureError("missing-auth", `${config.providerName} access token is missing. Run \`${config.loginCommand}\` and try again.`, `${config.providerName} auth data does not contain a valid access token`);
    }
    return token.trim();
}
export async function readLocalAuth(path, config) {
    if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
        throw new RefreshFailureError("missing-auth", `${config.providerName} auth file is missing. Run \`${config.loginCommand}\` and try again.`, `${config.providerName} auth file does not exist at "${path}"`);
    }
    try {
        const raw = await readJsonFile(path);
        if (!isObject(raw)) {
            throw new RefreshFailureError("missing-auth", `${config.providerName} auth file is malformed. Run \`${config.loginCommand}\` and try again.`, `${config.providerName} auth file at "${path}" does not contain a valid JSON object`);
        }
        return raw;
    }
    catch (err) {
        if (err instanceof RefreshFailureError) {
            throw err;
        }
        throw new RefreshFailureError("missing-auth", `${config.providerName} auth file could not be read. Run \`${config.loginCommand}\` and try again.`, `Failed to read ${config.providerName} auth file at "${path}": ${formatError(err)}`);
    }
}
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function isUsableAccessToken(value) {
    return isNonEmptyString(value) && !/\s/.test(value.trim());
}
function formatError(err) {
    if (err instanceof Error && err.message) {
        return err.message;
    }
    if (typeof err === "string" && err.length > 0) {
        return err;
    }
    return "Unknown error";
}
