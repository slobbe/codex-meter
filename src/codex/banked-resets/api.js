import GLib from "gi://GLib";
import { fetchJson } from "../../io/http.js";
import { getCodexCredentials } from "../auth/auth.js";
import { toListResponse } from "./response.js";

const CODEX_BANKED_RESETS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";

const CODEX_REDEEM_BANKED_RESET_URL = `${CODEX_BANKED_RESETS_URL}/consume`;

const CODEX_BANKED_RESETS_API_CONFIG = {
    messages: {
        malformedResponse: "Codex returned a malformed banked reset response.",
        unexpectedResponseFormat: "Codex returned an unexpected banked reset response format.",
        networkUnavailable:
            "Codex banked resets could not be reached. Check your network and try again.",
        responseTooLarge: "Codex returned a banked reset response that is too large.",
        unauthorized: "Codex authentication expired. Please run `codex login` again.",
        refreshFailed: "Codex banked reset request failed. Try again later.",
        emptyResponse: "Codex returned an empty banked reset response.",
    },
};

export async function listCodexBankedResets(options = {}) {
    const cancellable = options.cancellable ?? null;
    cancellable?.set_error_if_cancelled();
    const credentials = await getCodexCredentials(cancellable);
    cancellable?.set_error_if_cancelled();
    const response = await fetchJson(CODEX_BANKED_RESETS_URL, CODEX_BANKED_RESETS_API_CONFIG, {
        headers: createCodexBankedResetHeaders(credentials.accessToken, credentials.accountId),
        cancellable: options.cancellable ?? null,
    });
    cancellable?.set_error_if_cancelled();
    return toListResponse(response);
}

export async function redeemCodexBankedReset(creditId, options = {}) {
    const cancellable = options.cancellable ?? null;
    cancellable?.set_error_if_cancelled();
    const credentials = await getCodexCredentials(cancellable);
    cancellable?.set_error_if_cancelled();
    const request = {
        credit_id: creditId,
        redeem_request_id: GLib.uuid_string_random(),
    };
    const response = await fetchJson(
        CODEX_REDEEM_BANKED_RESET_URL,
        CODEX_BANKED_RESETS_API_CONFIG,
        {
            method: "POST",
            headers: {
                ...createCodexBankedResetHeaders(credentials.accessToken, credentials.accountId),
                "Content-Type": "application/json",
            },
            body: JSON.stringify(request),
            cancellable: options.cancellable ?? null,
        },
    );
    cancellable?.set_error_if_cancelled();
    return response;
}

function createCodexBankedResetHeaders(accessToken, accountId) {
    const headers = {
        Authorization: `Bearer ${accessToken}`,
        originator: "Codex Desktop",
    };
    if (accountId) {
        headers["ChatGPT-Account-ID"] = accountId;
    }
    return headers;
}
