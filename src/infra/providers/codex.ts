import { fetchProviderUsage, JsonObject, UsageApiClientConfig } from "../api_client.js";
import { RefreshFailureError } from "../../domain/refresh-failure.js";
import { UsageSnapshot } from "../../domain/usage.js";
import { getLocalAccessToken, LocalTokenAuthConfig } from "./auth.js";
import GLib from "gi://GLib";
import { UsageProvider, UsageProviderRefreshOptions } from "./types.js";

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

type CodexAuth = {
    auth_mode?: string;
    OPENAI_API_KEY?: string | null;
    tokens?: {
        id_token?: string;
        access_token?: string;
        refresh_token?: string;
        account_id?: string;
    };
    last_refresh?: string;
};

type CodexApiResponse = {
    user_id: string;
    account_id: string;
    email: string;
    plan_type: "free" | "plus" | "pro" | string;

    rate_limit: {
        allowed: boolean;
        limit_reached: boolean;
        primary_window: CodexRateLimitWindow;
        secondary_window: CodexRateLimitWindow;
    };

    code_review_rate_limit: CodexRateLimit | null;
    additional_rate_limits: unknown | null;

    credits: {
        has_credits: boolean;
        unlimited: boolean;
        overage_limit_reached: boolean;
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

type CodexRateLimitWindow = {
    used_percent: number;
    limit_window_seconds: number;
    reset_after_seconds: number;
    reset_at: number;
};

type CodexRateLimit = {
    allowed: boolean;
    limit_reached: boolean;
    primary_window: CodexRateLimitWindow;
    secondary_window: CodexRateLimitWindow;
};

function getCodexAuthPath() {
    return GLib.build_filenamev([GLib.get_home_dir(), ".codex", "auth.json"]);
}

const CODEX_AUTH_CONFIG: LocalTokenAuthConfig<CodexAuth> = {
    providerName: "Codex",
    authPath: getCodexAuthPath(),
    loginCommand: "codex login",
    parseAccessToken(auth) {
        if (!auth.tokens || typeof auth.tokens !== "object") {
            return null;
        }

        return auth.tokens.access_token ?? null;
    },
};

const CODEX_API_CONFIG: UsageApiClientConfig = {
    providerName: "Codex",
    usageUrl: CODEX_USAGE_URL,
    messages: {
        malformedResponse: "Codex returned a malformed response.",
        unexpectedResponseFormat: "Codex returned an unexpected response format.",
        networkUnavailable: "Codex usage could not be reached. Check your network and try again.",
        responseTooLarge: "Codex returned a response that is too large.",
        unauthorized: "Codex authentication expired. Run `codex login` and try again.",
        refreshFailed: "Codex usage refresh failed. Try again later.",
        emptyResponse: "Codex returned an empty response.",
    },
};

export class CodexUsageProvider implements UsageProvider {
    readonly info = { id: "codex", displayName: "Codex" } as const;

    async refreshUsage(options: UsageProviderRefreshOptions = {}) {
        const token = await getLocalAccessToken(CODEX_AUTH_CONFIG);
        const apiResponse = await fetchProviderUsage(token, CODEX_API_CONFIG, {
            cancellable: options.cancellable ?? null,
        });

        return toUsageSnapshot(apiResponse);
    }
}

function toUsageSnapshot(api: JsonObject): UsageSnapshot {
    const codexApi = toCodexApiResponse(api);

    return {
        fetchedAt: Math.floor(Date.now() / 1000),
        providerId: "codex",
        planType: codexApi.plan_type,
        quotas: [
            {
                id: "session",
                label: "Session (5h)",
                usedPercent: codexApi.rate_limit.primary_window.used_percent,
                limitWindowSeconds:
                    codexApi.rate_limit.primary_window.limit_window_seconds,
                resetAfterSeconds:
                    codexApi.rate_limit.primary_window.reset_after_seconds,
                resetAt: codexApi.rate_limit.primary_window.reset_at,
                limitReached: codexApi.rate_limit.limit_reached,
            },
            {
                id: "weekly",
                label: "Week",
                usedPercent: codexApi.rate_limit.secondary_window.used_percent,
                limitWindowSeconds:
                    codexApi.rate_limit.secondary_window.limit_window_seconds,
                resetAfterSeconds:
                    codexApi.rate_limit.secondary_window.reset_after_seconds,
                resetAt: codexApi.rate_limit.secondary_window.reset_at,
                limitReached: codexApi.rate_limit.limit_reached,
            },
        ],
    };
}

function toCodexApiResponse(api: JsonObject): CodexApiResponse {
    assertApiResponseShape(api);
    return api as CodexApiResponse;
}

function assertApiResponseShape(api: JsonObject): void {
    if (typeof api.plan_type !== "string") {
        throwUnexpected("plan_type is missing or not a string");
    }

    if (!isObject(api.rate_limit)) {
        throwUnexpected("rate_limit is missing or not an object");
    }

    if (typeof api.rate_limit.limit_reached !== "boolean") {
        throwUnexpected("rate_limit.limit_reached is missing or not a boolean");
    }

    assertWindow(api.rate_limit.primary_window, "rate_limit.primary_window");
    assertWindow(api.rate_limit.secondary_window, "rate_limit.secondary_window");
}

function assertWindow(value: unknown, path: string): void {
    if (!isObject(value)) {
        throwUnexpected(`${path} is missing or not an object`);
    }

    for (const key of ["used_percent", "limit_window_seconds", "reset_after_seconds", "reset_at"]) {
        if (!Number.isFinite(value[key])) {
            throwUnexpected(`${path}.${key} is missing or not a finite number`);
        }
    }
}

function isObject(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function throwUnexpected(message: string): never {
    throw new RefreshFailureError(
        "unexpected-response",
        "Codex returned data this extension does not understand.",
        `Unexpected Codex API response shape: ${message}`,
    );
}
