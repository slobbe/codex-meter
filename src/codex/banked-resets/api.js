import GLib from "gi://GLib";
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
    const credentials = await getCodexCredentials();
    const response = await fetchJson(CODEX_BANKED_RESETS_URL, CODEX_BANKED_RESETS_API_CONFIG, {
        headers: createCodexBankedResetHeaders(credentials.accessToken, credentials.accountId),
        cancellable: options.cancellable ?? null,
    });
    const listResponse = toListResponse(response);
    try {
        await writeBankedResetSnapshot(listResponse);
    } catch (error) {
        console.error("Unable to write Codex banked reset snapshot cache", error);
    }
    return listResponse;
}

export async function readCachedCodexBankedResets() {
    return await readBankedResetSnapshot();
}

export async function redeemCodexBankedReset(creditId, options = {}) {
    const response = await consumeCodexBankedReset(creditId, options);
    try {
        await markCachedBankedResetRedeemed(creditId);
    } catch (error) {
        console.error("Unable to update Codex banked reset snapshot cache", error);
    }
    return response;
}

async function markCachedBankedResetRedeemed(creditId) {
    const snapshot = await readBankedResetSnapshot();
    if (!snapshot) return;
    const credits = snapshot.credits.map((credit) => {
        if (credit.id !== creditId) return credit;
        return {
            ...credit,
            status: "redeemed",
        };
    });
    await writeBankedResetSnapshot({
        available_count: credits.filter((credit) => credit.status === "available").length,
        credits,
    });
}

async function consumeCodexBankedReset(creditId, options = {}) {
    const credentials = await getCodexCredentials();
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
