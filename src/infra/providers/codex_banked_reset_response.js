// @ts-check

import { RefreshFailureError } from "../../domain/refresh-failure.js";

/**
 * @typedef {object} CodexBankedResetCredit
 * @property {string} id
 * @property {string} status
 * @property {string | null} [reset_type]
 * @property {string | null} [granted_at]
 * @property {string | null} [expires_at]
 * @property {string | null} [profile_image_url]
 * @property {string | null} [profile_user_id]
 * @property {string | null} [title]
 * @property {string | null} [description]
 *
 * @typedef {object} CodexBankedResetListResponse
 * @property {number} available_count
 * @property {CodexBankedResetCredit[]} credits
 *
 * @typedef {Record<string, unknown>} JsonObject
 */

/**
 * @param {JsonObject} response
 * @returns {CodexBankedResetListResponse}
 */
export function toListResponse(response) {
    assertListResponseShape(response);
    return /** @type {CodexBankedResetListResponse} */ (response);
}

/** @param {JsonObject} response */
function assertListResponseShape(response) {
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

/**
 * @param {CodexBankedResetCredit[]} credits
 * @returns {CodexBankedResetCredit | null}
 */
export function selectCreditToRedeem(credits) {
    const available = credits.filter((credit) => credit.status === "available");

    if (available.length === 0) {
        return null;
    }

    if (available.some((credit) => !hasValidExpiresAt(credit))) {
        return available[0];
    }

    return sortByExpiry(available)[0];
}

/**
 * @param {CodexBankedResetCredit[]} credits
 * @param {number} nowMs
 * @param {number} windowMs
 * @returns {CodexBankedResetCredit | null}
 */
export function selectCreditExpiringWithin(credits, nowMs, windowMs) {
    const expiresBy = nowMs + windowMs;
    const expiring = credits.filter((credit) => {
        if (credit.status !== "available" || !hasValidExpiresAt(credit)) return false;

        const expiresAt = Date.parse(credit.expires_at ?? "");
        return expiresAt > nowMs && expiresAt <= expiresBy;
    });

    return sortByExpiry(expiring)[0] ?? null;
}

/**
 * @param {CodexBankedResetCredit[]} credits
 * @returns {CodexBankedResetCredit[]}
 */
function sortByExpiry(credits) {
    return [...credits].sort((left, right) => {
        return Date.parse(left.expires_at ?? "") - Date.parse(right.expires_at ?? "");
    });
}

/**
 * @param {CodexBankedResetCredit} credit
 * @returns {boolean}
 */
function hasValidExpiresAt(credit) {
    return typeof credit.expires_at === "string" &&
        Number.isFinite(Date.parse(credit.expires_at));
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
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
        "Codex returned banked reset data this extension does not understand.",
        `Unexpected Codex banked reset API response shape: ${message}`,
    );
}
