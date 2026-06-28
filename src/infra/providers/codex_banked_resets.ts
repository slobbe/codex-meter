import GLib from "gi://GLib";

import { fetchJson, JsonObject, UsageApiClientConfig } from "../api_client.js";
import { RefreshFailureError } from "../../domain/refresh-failure.js";
import { getCodexCredentials } from "./codex_auth.js";

const CODEX_BANKED_RESETS_URL =
    "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const CODEX_REDEEM_BANKED_RESET_URL = `${CODEX_BANKED_RESETS_URL}/consume`;

export type CodexBankedResetCredit = {
    id: string;
    status: string;
    expires_at?: string | null;
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

    return toListResponse(response as JsonObject);
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

    await consumeCodexBankedReset(credit.id);

    return credit;
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

        if (
            credit.expires_at !== undefined &&
            credit.expires_at !== null &&
            typeof credit.expires_at !== "string"
        ) {
            throwUnexpected(`credits[${index}].expires_at is not a string`);
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
