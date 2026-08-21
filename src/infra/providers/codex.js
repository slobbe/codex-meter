import { fetchProviderUsage } from "../api_client.js";
import { getCodexAccessToken } from "./codex_auth.js";
import { toUsageSnapshot } from "./codex_usage_response.js";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_API_CONFIG = {
    providerName: "Codex",
    usageUrl: CODEX_USAGE_URL,
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
export class CodexUsageProvider {
    info = { id: "codex", displayName: "Codex" };
    async refreshUsage(options = {}) {
        const token = await getCodexAccessToken();
        const apiResponse = await fetchProviderUsage(token, CODEX_API_CONFIG, {
            cancellable: options.cancellable ?? null,
        });
        return toUsageSnapshot(apiResponse);
    }
}
