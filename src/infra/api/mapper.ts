import { UsageSnapshot } from "../../domain/usage-snapshot.js";
import { ApiResponse } from "./client.js";

export function toUsageSnapshot(api: ApiResponse): UsageSnapshot {
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
                usedPercent: api.rate_limit.primary_window.used_percent,
                limitWindowSeconds:
                    api.rate_limit.primary_window.limit_window_seconds,
                resetAfterSeconds:
                    api.rate_limit.primary_window.reset_after_seconds,
                resetAt: api.rate_limit.primary_window.reset_at,
            },
        },
    };
}
