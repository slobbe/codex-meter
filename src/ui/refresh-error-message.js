import { isRefreshFailureError } from "../domain/refresh-failure.js";
export function formatRefreshFailure(error) {
    if (isRefreshFailureError(error)) {
        return error.message;
    }
    return "Codex usage refresh failed. Try again later.";
}
