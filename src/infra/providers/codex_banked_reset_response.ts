import { RefreshFailureError } from "../../domain/refresh-failure.js";

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

type JsonObject = Record<string, unknown>;

export function toListResponse(response: JsonObject): CodexBankedResetListResponse {
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

export function selectCreditToRedeem(credits: CodexBankedResetCredit[]): CodexBankedResetCredit | null {
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
