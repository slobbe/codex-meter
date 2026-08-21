import { fetchJson } from "../io/http.js";
import { getCodexAccessToken } from "./auth.js";
import { toUsageSnapshot } from "./usage-response.js";

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

const CODEX_API_CONFIG = {
    messages: {
        malformedResponse: "Codex returned a malformed response.",
        unexpectedResponseFormat: "Codex returned an unexpected response format.",
        networkUnavailable: "Codex usage could not be reached. Check your network and try again.",
        responseTooLarge: "Codex returned a response that is too large.",
        unauthorized: "Codex authentication expired. Please run `codex login` again.",
        refreshFailed: "Codex usage refresh failed. Try again later.",
        emptyResponse: "Codex returned an empty response.",
    },
};

export async function refreshCodexUsage(options = {}) {
    const token = await getCodexAccessToken();
    const apiResponse = await fetchJson(CODEX_USAGE_URL, CODEX_API_CONFIG, {
        headers: { Authorization: `Bearer ${token}` },
        cancellable: options.cancellable ?? null,
    });

    return toUsageSnapshot(apiResponse);
}
