import { RefreshFailureError } from "../../domain/refresh-failure.js";
import { UsageCredits, UsageSnapshot } from "../../domain/usage.js";

type JsonObject = Record<string, unknown>;

type CodexApiResponse = {
    plan_type: string;
    rate_limit: {
        limit_reached: boolean;
        primary_window: CodexRateLimitWindow | null;
        secondary_window: CodexRateLimitWindow | null;
    };
};

type CodexRateLimitWindow = {
    used_percent: number;
    limit_window_seconds: number;
    reset_after_seconds: number;
    reset_at: number;
};

export function toUsageSnapshot(api: JsonObject): UsageSnapshot {
    const codexApi = toCodexApiResponse(api);

    return {
        fetchedAt: Math.floor(Date.now() / 1000),
        providerId: "codex",
        planType: codexApi.plan_type,
        credits: toUsageCredits(api.credits),
        quotas: toUsageQuotas(codexApi),
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

    assertOptionalWindow(api.rate_limit.primary_window, "rate_limit.primary_window");
    assertOptionalWindow(api.rate_limit.secondary_window, "rate_limit.secondary_window");

    if (api.rate_limit.primary_window === null && api.rate_limit.secondary_window === null) {
        throwUnexpected("rate_limit does not contain a usage window");
    }
}

function toUsageQuotas(api: CodexApiResponse): UsageSnapshot["quotas"] {
    const { primary_window: primary, secondary_window: secondary } = api.rate_limit;

    if (primary && secondary) {
        return [
            toUsageQuota("session", "Session (5h)", primary, api.rate_limit.limit_reached),
            toUsageQuota("weekly", "Week", secondary, api.rate_limit.limit_reached),
        ];
    }

    const weeklyWindow = primary ?? secondary;
    if (!weeklyWindow) {
        throwUnexpected("rate_limit does not contain a usage window");
    }

    return [toUsageQuota("weekly", "Week", weeklyWindow, api.rate_limit.limit_reached)];
}

function toUsageQuota(
    id: string,
    label: string,
    window: CodexRateLimitWindow,
    limitReached: boolean,
): UsageSnapshot["quotas"][number] {
    return {
        id,
        label,
        usedPercent: window.used_percent,
        limitWindowSeconds: window.limit_window_seconds,
        resetAfterSeconds: window.reset_after_seconds,
        resetAt: window.reset_at,
        limitReached,
    };
}

function assertOptionalWindow(value: unknown, path: string): void {
    if (value === null || value === undefined) return;
    assertWindow(value, path);
}

function toUsageCredits(value: unknown): UsageCredits | undefined {
    if (!isObject(value)) return undefined;

    const balance = typeof value.balance === "string" && value.balance.trim().length > 0
        ? value.balance
        : null;

    return {
        balance,
        hasCredits: typeof value.has_credits === "boolean" ? value.has_credits : undefined,
        unlimited: typeof value.unlimited === "boolean" ? value.unlimited : undefined,
        overageLimitReached: typeof value.overage_limit_reached === "boolean"
            ? value.overage_limit_reached
            : undefined,
    };
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
