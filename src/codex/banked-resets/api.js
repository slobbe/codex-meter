import GLib from "gi://GLib";
import { isCancellationError } from "../../io/files.js";
import { fetchJson } from "../../io/http.js";
import { readBankedResetSnapshot, writeBankedResetSnapshot } from "./store.js";
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
    const listResponse = toListResponse(response);
    try {
        await writeBankedResetSnapshot(listResponse, cancellable);
    } catch (error) {
        if (isCancellationError(error)) throw error;
        console.error("Unable to write Codex banked reset snapshot cache", error);
    }
    cancellable?.set_error_if_cancelled();
    return listResponse;
}

export async function readCachedCodexBankedResets(cancellable = null) {
    return await readBankedResetSnapshot(cancellable);
}

export async function redeemCodexBankedReset(creditId, options = {}) {
    const cancellable = options.cancellable ?? null;
    const response = await consumeCodexBankedReset(creditId, options);
    cancellable?.set_error_if_cancelled();
    try {
        await markCachedBankedResetRedeemed(creditId, cancellable);
    } catch (error) {
        if (isCancellationError(error)) throw error;
        console.error("Unable to update Codex banked reset snapshot cache", error);
    }
    cancellable?.set_error_if_cancelled();
    return response;
}

async function markCachedBankedResetRedeemed(creditId, cancellable) {
    const snapshot = await readBankedResetSnapshot(cancellable);
    cancellable?.set_error_if_cancelled();
    if (!snapshot) return;
    const credits = snapshot.credits.map((credit) => {
        if (credit.id !== creditId) return credit;
        return {
            ...credit,
            status: "redeemed",
        };
    });
    await writeBankedResetSnapshot(
        {
            available_count: credits.filter((credit) => credit.status === "available").length,
            credits,
        },
        cancellable,
    );
}

async function consumeCodexBankedReset(creditId, options = {}) {
    const cancellable = options.cancellable ?? null;
    cancellable?.set_error_if_cancelled();
    const credentials = await getCodexCredentials(cancellable);
    cancellable?.set_error_if_cancelled();
    const request = {
        credit_id: creditId,
        redeem_request_id: GLib.uuid_string_random(),
    };
    return await fetchJson(CODEX_REDEEM_BANKED_RESET_URL, CODEX_BANKED_RESETS_API_CONFIG, {
        method: "POST",
        headers: {
            ...createCodexBankedResetHeaders(credentials.accessToken, credentials.accountId),
            "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        cancellable: options.cancellable ?? null,
    });
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
