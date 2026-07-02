import { isRefreshFailureError } from "../domain/refresh-failure.js";

export function formatRefreshFailure(error: unknown): string {
    if (isRefreshFailureError(error)) {
        return error.message;
    }

    return "Codex usage refresh failed. Try again later.";
}
