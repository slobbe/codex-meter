import { isCodexError } from "../codex/error.js";

export function formatRefreshFailure(error) {
    if (isCodexError(error)) {
        return error.message;
    }
    return "Codex usage refresh failed. Try again later.";
}
