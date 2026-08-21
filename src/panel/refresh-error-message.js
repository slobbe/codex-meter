import { isRefreshFailureError } from "../refresh/error.js";
export function formatRefreshFailure(error) {
    if (isRefreshFailureError(error)) {
        return error.message;
    }
    return "Codex usage refresh failed. Try again later.";
}
