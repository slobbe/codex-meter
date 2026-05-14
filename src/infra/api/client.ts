import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { RefreshFailureError } from "../../domain/refresh-failure.js";
// The GIRS package set used by this project does not ship Soup typings.
// @ts-ignore
import Soup from "gi://Soup?version=3.0";

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_ERROR_BODY_LENGTH = 512;

Gio._promisify(Soup.Session.prototype, "send_and_read_async");

export type ApiResponse = {
    user_id: string;
    account_id: string;
    email: string;
    plan_type: "free" | "plus" | "pro" | string;

    rate_limit: {
        allowed: boolean;
        limit_reached: boolean;

        primary_window: RateLimitWindow;
        secondary_window: RateLimitWindow;
    };

    code_review_rate_limit: RateLimit | null;
    additional_rate_limits: unknown | null;

    credits: {
        has_credits: boolean;
        unlimited: boolean;
        overage_limit_reached: boolean;

        // API returns this as a string
        balance: string;

        approx_local_messages: [number, number];
        approx_cloud_messages: [number, number];
    };

    spend_control: {
        reached: boolean;
        individual_limit: number | null;
    };

    rate_limit_reached_type: string | null;
    promo: unknown | null;
    referral_beacon: unknown | null;
};

type RateLimitWindow = {
    used_percent: number;
    limit_window_seconds: number;
    reset_after_seconds: number;

    // unix timestamp
    reset_at: number;
};

type RateLimit = {
    allowed: boolean;
    limit_reached: boolean;

    primary_window: RateLimitWindow;
    secondary_window: RateLimitWindow;
};

export type FetchUsageOptions = {
    cancellable?: Gio.Cancellable | null;
    timeoutSeconds?: number;
};

function formatErrorBody(text: string): string {
    const normalized = text.trim().replace(/\s+/g, " ");

    if (normalized.length <= MAX_ERROR_BODY_LENGTH) {
        return normalized;
    }

    return `${normalized.slice(0, MAX_ERROR_BODY_LENGTH)}...`;
}

function parseApiResponse(text: string, url: string): ApiResponse {
    let parsed: unknown;

    try {
        parsed = JSON.parse(text);
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Unknown JSON parse error";

        throw new RefreshFailureError(
            "malformed-response",
            "Codex returned a malformed response.",
            `Failed to parse JSON response from ${url}: ${message}`,
        );
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new RefreshFailureError(
            "malformed-response",
            "Codex returned an unexpected response format.",
            `Expected JSON object response from ${url}`,
        );
    }

    return parsed as ApiResponse;
}

export async function fetchUsage(
    accessToken: string,
    url: string = CODEX_USAGE_URL,
    options: FetchUsageOptions = {},
): Promise<ApiResponse> {
    const session = new Soup.Session();
    const message = Soup.Message.new("GET", url);
    const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;

    session.timeout = timeoutSeconds;

    message.request_headers.append("Authorization", `Bearer ${accessToken}`);
    message.request_headers.append("Accept", "application/json");

    let bytes;

    try {
        bytes = await session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            options.cancellable ?? null,
        );
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);

        throw new RefreshFailureError(
            "network",
            "Codex usage could not be reached. Check your network and try again.",
            `Request to ${url} failed before receiving a response: ${message}`,
        );
    }

    const data = bytes.get_data();
    const text = data ? new TextDecoder("utf-8").decode(data) : "";

    if (message.statusCode < 200 || message.statusCode >= 300) {
        const errorBody = formatErrorBody(text);
        const technicalMessage =
            `Request to ${url} failed with HTTP ${message.statusCode}: ${errorBody}`;

        if (message.statusCode === 401 || message.statusCode === 403) {
            throw new RefreshFailureError(
                "unauthorized",
                "Codex authentication expired. Run `codex login` and try again.",
                technicalMessage,
            );
        }

        throw new RefreshFailureError(
            "network",
            "Codex usage refresh failed. Try again later.",
            technicalMessage,
        );
    }

    if (!data) {
        throw new RefreshFailureError(
            "malformed-response",
            "Codex returned an empty response.",
            `Received empty response body from ${url}`,
        );
    }

    return parseApiResponse(text, url);
}
