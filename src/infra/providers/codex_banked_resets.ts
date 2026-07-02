import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { fetchJson, JsonObject, UsageApiClientConfig } from "../api_client.js";
import { RefreshFailureError } from "../../domain/refresh-failure.js";
import {
    readBankedResetSnapshot,
    writeBankedResetSnapshot,
} from "../storage/banked-reset-snapshot.js";
import { getCodexCredentials } from "./codex_auth.js";
import {
    CodexBankedResetCredit,
    CodexBankedResetListResponse,
    selectCreditToRedeem,
    toListResponse,
} from "./codex_banked_reset_response.js";

export type {
    CodexBankedResetCredit,
    CodexBankedResetListResponse,
} from "./codex_banked_reset_response.js";

const CODEX_BANKED_RESETS_URL =
    "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const CODEX_REDEEM_BANKED_RESET_URL = `${CODEX_BANKED_RESETS_URL}/consume`;



export type CodexRedeemBankedResetRequest = {
    credit_id: string;
    redeem_request_id: string;
};

export type CodexRedeemBankedResetResponse = JsonObject;

export type CodexBankedResetRequestOptions = {
    cancellable?: Gio.Cancellable | null;
};

const CODEX_BANKED_RESETS_API_CONFIG: UsageApiClientConfig = {
    providerName: "Codex",
    usageUrl: CODEX_BANKED_RESETS_URL,
    messages: {
        malformedResponse: "Codex returned a malformed banked reset response.",
        unexpectedResponseFormat: "Codex returned an unexpected banked reset response format.",
        networkUnavailable: "Codex banked resets could not be reached. Check your network and try again.",
        responseTooLarge: "Codex returned a banked reset response that is too large.",
        unauthorized: "Codex authentication expired. Please run `codex login` again.",
        refreshFailed: "Codex banked reset request failed. Try again later.",
        emptyResponse: "Codex returned an empty banked reset response.",
    },
};

export async function listCodexBankedResets(
    options: CodexBankedResetRequestOptions = {},
): Promise<CodexBankedResetListResponse> {
    const credentials = await getCodexCredentials();
    const response = await fetchJson(CODEX_BANKED_RESETS_URL, CODEX_BANKED_RESETS_API_CONFIG, {
        headers: createCodexBankedResetHeaders(credentials.accessToken, credentials.accountId),
        cancellable: options.cancellable ?? null,
    });
    const listResponse = toListResponse(response as JsonObject);

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

export async function redeemNextCodexBankedReset(
    options: CodexBankedResetRequestOptions = {},
): Promise<CodexBankedResetCredit> {
    const list = await listCodexBankedResets(options);
    const credit = selectCreditToRedeem(list.credits);

    if (!credit) {
        throw new RefreshFailureError(
            "unexpected-response",
            "No banked Codex resets are available to redeem.",
            "Codex banked reset redemption was requested with zero available credits.",
        );
    }

    await redeemCodexBankedReset(credit.id, options);

    return credit;
}

export async function redeemCodexBankedReset(
    creditId: string,
    options: CodexBankedResetRequestOptions = {},
): Promise<CodexRedeemBankedResetResponse> {
    const response = await consumeCodexBankedReset(creditId, options);

    try {
        await markCachedBankedResetRedeemed(creditId);
    } catch (error) {
        console.error("Unable to update Codex banked reset snapshot cache", error);
    }

    return response;
}

async function markCachedBankedResetRedeemed(creditId: string): Promise<void> {
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

async function consumeCodexBankedReset(
    creditId: string,
    options: CodexBankedResetRequestOptions = {},
): Promise<CodexRedeemBankedResetResponse> {
    const credentials = await getCodexCredentials();
    const request: CodexRedeemBankedResetRequest = {
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
        bodyContentType: "application/json",
        cancellable: options.cancellable ?? null,
    }) as JsonObject;
}

function createCodexBankedResetHeaders(accessToken: string, accountId: string | null): Record<string, string> {
    const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        originator: "Codex Desktop",
    };

    if (accountId) {
        headers["ChatGPT-Account-ID"] = accountId;
    }

    return headers;
}

