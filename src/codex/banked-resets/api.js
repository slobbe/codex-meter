import GLib from "gi://GLib";
import { fetchJson } from "../../io/http.js";
import { createCodexAuthHeaders, getCodexCredentials } from "../auth/auth.js";
import { CodexError } from "../error.js";
import { toListResponse, toRedeemResponse } from "./response.js";

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
    const credentials =
        options.credentials ?? (await getCodexCredentials(cancellable, options.credentialsPath));
    cancellable?.set_error_if_cancelled();
    const response = await fetchJson(CODEX_BANKED_RESETS_URL, CODEX_BANKED_RESETS_API_CONFIG, {
        headers: { ...createCodexAuthHeaders(credentials), originator: "Codex Desktop" },
        cancellable,
    });
    await getCodexCredentials(cancellable, options.credentialsPath, credentials);
    return toListResponse(response);
}

export async function redeemCodexBankedReset(creditId, options = {}) {
    const preflightCancellable = options.cancellable ?? null;
    const consumeCancellable = options.consumeCancellable ?? preflightCancellable;
    preflightCancellable?.set_error_if_cancelled();
    if (!options.credentials) {
        throw new CodexError(
            "credentials-changed",
            "Check banked Codex resets again before redeeming.",
        );
    }
    const credentials = await getCodexCredentials(
        preflightCancellable,
        options.credentialsPath,
        options.credentials,
    );
    preflightCancellable?.set_error_if_cancelled();
    const request = {
        credit_id: creditId,
        redeem_request_id: GLib.uuid_string_random(),
    };
    consumeCancellable?.set_error_if_cancelled();
    // Eligibility can change during the credentials read without an account change.
    if (options.isEligible?.() === false) return;
    if (options.onDispatch?.() === false) {
        throw new CodexError(
            "credentials-changed",
            "The Codex account changed. Try again with the current account.",
        );
    }
    const response = await fetchJson(
        CODEX_REDEEM_BANKED_RESET_URL,
        CODEX_BANKED_RESETS_API_CONFIG,
        {
            method: "POST",
            headers: {
                ...createCodexAuthHeaders(credentials),
                originator: "Codex Desktop",
                "Content-Type": "application/json",
            },
            body: JSON.stringify(request),
            cancellable: consumeCancellable,
        },
    );
    consumeCancellable?.set_error_if_cancelled();
    return toRedeemResponse(response);
}
