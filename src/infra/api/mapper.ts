import { RefreshFailureError } from "../../domain/refresh-failure.js";
import { UsageSnapshot } from "../../domain/usage.js";
import { ApiResponse } from "./client.js";

export function toUsageSnapshot(api: ApiResponse): UsageSnapshot {
    assertApiResponseShape(api);

    return {
        fetchedAt: Math.floor(Date.now() / 1000),
        planType: api.plan_type,

        rateLimit: {
            limitReached: api.rate_limit.limit_reached,
            primary: {
                usedPercent: api.rate_limit.primary_window.used_percent,
                limitWindowSeconds:
                    api.rate_limit.primary_window.limit_window_seconds,
                resetAfterSeconds:
                    api.rate_limit.primary_window.reset_after_seconds,
                resetAt: api.rate_limit.primary_window.reset_at,
            },
            secondary: {
                usedPercent: api.rate_limit.secondary_window.used_percent,
                limitWindowSeconds:
                    api.rate_limit.secondary_window.limit_window_seconds,
                resetAfterSeconds:
                    api.rate_limit.secondary_window.reset_after_seconds,
                resetAt: api.rate_limit.secondary_window.reset_at,
            },
        },
    };
}

function assertApiResponseShape(api: ApiResponse): void {
    if (!isObject(api)) {
        throwUnexpected("response root is not an object");
    }

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
