// @ts-check

import { CodexError } from "../error.js";
import { getUsageWindowMetadata, sortUsageQuotas } from "./model.js";

/** @typedef {import("../../../types/index.js").UsageSnapshot} UsageSnapshot */

/**
 * @typedef {object} CodexRateLimitWindow
 * @property {number} used_percent
 * @property {number} limit_window_seconds
 * @property {number} reset_after_seconds
 * @property {number} reset_at
 *
 * @typedef {object} CodexApiResponse
 * @property {string} plan_type
 * @property {{limit_reached: boolean} & Record<string, unknown>} rate_limit
 */

/**
 * @param {Record<string, unknown>} api
 * @returns {UsageSnapshot}
 */
export function toUsageSnapshot(api) {
    assertApiResponseShape(api);

    return {
        fetchedAt: Math.floor(Date.now() / 1000),
        planType: api.plan_type,
        credits: toUsageCredits(api.credits),
        bankedResetCount: toBankedResetCount(api.rate_limit_reset_credits),
        quotas: toUsageQuotas(api),
    };
}

/**
 * @param {Record<string, unknown>} api
 * @returns {asserts api is CodexApiResponse & Record<string, unknown>}
 */
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

    for (const [name, window] of Object.entries(api.rate_limit)) {
        if (name.endsWith("_window")) {
            assertOptionalWindow(window, `rate_limit.${name}`);
        }
    }
}

/** @param {CodexApiResponse} api */
function toUsageQuotas(api) {
    const windows = /** @type {[string, CodexRateLimitWindow][]} */ (
        Object.entries(api.rate_limit).filter(
            ([name, window]) => name.endsWith("_window") && window != null,
        )
    );
    if (windows.length === 0) {
        throwUnexpected("rate_limit does not contain a usage window");
    }

    const durationCounts = new Map();
    for (const [, window] of windows) {
        const seconds = window.limit_window_seconds;
        durationCounts.set(seconds, (durationCounts.get(seconds) ?? 0) + 1);
    }

    return sortUsageQuotas(
        windows.map(([name, window]) => {
            const quota = toUsageQuota(window, api.rate_limit.limit_reached);
            // Colliding durations need field-based IDs, never insertion-order suffixes.
            if (durationCounts.get(window.limit_window_seconds) > 1) {
                quota.id = `${quota.id}-${name}`;
            }
            return quota;
        }),
    );
}

/**
 * @param {CodexRateLimitWindow} window
 * @param {boolean} limitReached
 */
function toUsageQuota(window, limitReached) {
    const seconds = window.limit_window_seconds;
    const id =
        seconds === 18_000 ? "session" : seconds === 604_800 ? "weekly" : `window-${seconds}`;

    return {
        id,
        ...getUsageWindowMetadata(seconds),
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

/** @param {unknown} value */
function toUsageCredits(value) {
    if (!isObject(value)) return undefined;

    const balance =
        typeof value.balance === "string" && value.balance.trim().length > 0 ? value.balance : null;

    return {
        balance,
        unlimited: typeof value.unlimited === "boolean" ? value.unlimited : undefined,
    };
}

/** @param {unknown} value */
function toBankedResetCount(value) {
    if (!isObject(value) || !Number.isFinite(value.available_count)) return undefined;
    return Math.max(0, Math.trunc(value.available_count));
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

    if (value.limit_window_seconds <= 0) {
        throwUnexpected(`${path}.limit_window_seconds must be positive`);
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
    throw new CodexError(
        "unexpected-response",
        "Codex returned data this extension does not understand.",
        `Unexpected Codex API response shape: ${message}`,
    );
}
