import GLib from "gi://GLib";

import { fetchJson, JsonObject, UsageApiClientConfig } from "../api_client.js";
import { RefreshFailureError } from "../../domain/refresh-failure.js";
import {
    readBankedResetSnapshot,
    writeBankedResetSnapshot,
} from "../storage/banked-reset-snapshot.js";
import { getCodexCredentials } from "./codex_auth.js";

const CODEX_BANKED_RESETS_URL =
    "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const CODEX_REDEEM_BANKED_RESET_URL = `${CODEX_BANKED_RESETS_URL}/consume`;

export type CodexBankedResetCredit = {
    id: string;
    reset_type?: string | null;
    status: string;
    granted_at?: string | null;
    expires_at?: string | null;
    profile_image_url?: string | null;
    profile_user_id?: string | null;
    title?: string | null;
    description?: string | null;
};

export type CodexBankedResetListResponse = {
    available_count: number;
    credits: CodexBankedResetCredit[];
};

export type CodexRedeemBankedResetRequest = {
    credit_id: string;
    redeem_request_id: string;
};

export type CodexRedeemBankedResetResponse = JsonObject;

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

export async function listCodexBankedResets(): Promise<CodexBankedResetListResponse> {
    const credentials = await getCodexCredentials();
    const response = await fetchJson(CODEX_BANKED_RESETS_URL, CODEX_BANKED_RESETS_API_CONFIG, {
        headers: createCodexBankedResetHeaders(credentials.accessToken, credentials.accountId),
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

export async function redeemNextCodexBankedReset(): Promise<CodexBankedResetCredit> {
    const list = await listCodexBankedResets();
    const credit = selectCreditToRedeem(list.credits);

    if (!credit) {
        throw new RefreshFailureError(
            "unexpected-response",
            "No banked Codex resets are available to redeem.",
            "Codex banked reset redemption was requested with zero available credits.",
        );
    }

    await redeemCodexBankedReset(credit.id);

    return credit;
}

export async function redeemCodexBankedReset(creditId: string): Promise<CodexRedeemBankedResetResponse> {
    const response = await consumeCodexBankedReset(creditId);

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

async function consumeCodexBankedReset(creditId: string): Promise<CodexRedeemBankedResetResponse> {
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

function toListResponse(response: JsonObject): CodexBankedResetListResponse {
    assertListResponseShape(response);

    return response as CodexBankedResetListResponse;
}

function assertListResponseShape(response: JsonObject): void {
    if (!Number.isFinite(response.available_count)) {
        throwUnexpected("available_count is missing or not a finite number");
    }

    if (!Array.isArray(response.credits)) {
        throwUnexpected("credits is missing or not an array");
    }

    for (const [index, credit] of response.credits.entries()) {
        if (!isObject(credit)) {
            throwUnexpected(`credits[${index}] is not an object`);
        }

        if (typeof credit.id !== "string" || credit.id.trim().length === 0) {
            throwUnexpected(`credits[${index}].id is missing or not a non-empty string`);
        }

        if (typeof credit.status !== "string") {
            throwUnexpected(`credits[${index}].status is missing or not a string`);
        }

        for (const key of [
            "reset_type",
            "granted_at",
            "expires_at",
            "profile_image_url",
            "profile_user_id",
            "title",
            "description",
        ]) {
            if (
                credit[key] !== undefined &&
                credit[key] !== null &&
                typeof credit[key] !== "string"
            ) {
                throwUnexpected(`credits[${index}].${key} is not a string`);
            }
        }
    }
}

function selectCreditToRedeem(credits: CodexBankedResetCredit[]): CodexBankedResetCredit | null {
    const available = credits.filter((credit) => credit.status === "available");

    if (available.length === 0) {
        return null;
    }

    if (available.some((credit) => !hasValidExpiresAt(credit))) {
        return available[0];
    }

    return [...available].sort((left, right) => {
        return Date.parse(left.expires_at ?? "") - Date.parse(right.expires_at ?? "");
    })[0];
}

function hasValidExpiresAt(credit: CodexBankedResetCredit): boolean {
    return typeof credit.expires_at === "string" && Number.isFinite(Date.parse(credit.expires_at));
}

function isObject(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function throwUnexpected(message: string): never {
    throw new RefreshFailureError(
        "unexpected-response",
        "Codex returned banked reset data this extension does not understand.",
        `Unexpected Codex banked reset API response shape: ${message}`,
    );
}
