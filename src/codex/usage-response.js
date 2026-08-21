// @ts-check

import { RefreshFailureError } from "../refresh/error.js";

/** @typedef {import("../../types/index.js").UsageSnapshot} UsageSnapshot */
/** @typedef {import("../../types/index.js").UsageCredits} UsageCredits */
/** @typedef {Record<string, unknown>} JsonObject */
/**
 * @typedef {object} CodexRateLimitWindow
 * @property {number} used_percent
 * @property {number} limit_window_seconds
 * @property {number} reset_after_seconds
 * @property {number} reset_at
 *
 * @typedef {object} CodexApiResponse
 * @property {string} plan_type
 * @property {{limit_reached: boolean, primary_window: CodexRateLimitWindow | null, secondary_window: CodexRateLimitWindow | null}} rate_limit
 */

/**
 * @param {JsonObject} api
 * @returns {UsageSnapshot}
 */
export function toUsageSnapshot(api) {
    const codexApi = toCodexApiResponse(api);

    return {
        fetchedAt: Math.floor(Date.now() / 1000),
        planType: codexApi.plan_type,
        credits: toUsageCredits(api.credits),
        quotas: toUsageQuotas(codexApi),
    };
}

/**
 * @param {JsonObject} api
 * @returns {CodexApiResponse}
 */
function toCodexApiResponse(api) {
    assertApiResponseShape(api);
    return /** @type {CodexApiResponse} */ (/** @type {unknown} */ (api));
}

/** @param {JsonObject} api */
function assertApiResponseShape(api) {
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

/**
 * @param {CodexApiResponse} api
 * @returns {UsageSnapshot["quotas"]}
 */
function toUsageQuotas(api) {
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

/**
 * @param {string} id
 * @param {string} label
 * @param {CodexRateLimitWindow} window
 * @param {boolean} limitReached
 * @returns {UsageSnapshot["quotas"][number]}
 */
function toUsageQuota(id, label, window, limitReached) {
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

/**
 * @param {unknown} value
 * @param {string} path
 */
function assertOptionalWindow(value, path) {
    if (value === null || value === undefined) return;
    assertWindow(value, path);
}

/**
 * @param {unknown} value
 * @returns {UsageCredits | undefined}
 */
function toUsageCredits(value) {
    if (!isObject(value)) return undefined;

    const balance =
        typeof value.balance === "string" && value.balance.trim().length > 0 ? value.balance : null;

    return {
        balance,
        hasCredits: typeof value.has_credits === "boolean" ? value.has_credits : undefined,
        unlimited: typeof value.unlimited === "boolean" ? value.unlimited : undefined,
        overageLimitReached:
            typeof value.overage_limit_reached === "boolean"
                ? value.overage_limit_reached
                : undefined,
    };
}

/**
 * @param {unknown} value
 * @param {string} path
 */
function assertWindow(value, path) {
    if (!isObject(value)) {
        throwUnexpected(`${path} is missing or not an object`);
    }

    for (const key of ["used_percent", "limit_window_seconds", "reset_after_seconds", "reset_at"]) {
        if (!Number.isFinite(value[key])) {
            throwUnexpected(`${path}.${key} is missing or not a finite number`);
        }
    }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {string} message
 * @returns {never}
 */
function throwUnexpected(message) {
    throw new RefreshFailureError(
        "unexpected-response",
        "Codex returned data this extension does not understand.",
        `Unexpected Codex API response shape: ${message}`,
    );
}
