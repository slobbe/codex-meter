// @ts-check

import { CodexError } from "../error.js";

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
 */

/**
 * @param {Record<string, unknown>} response
 * @returns {CodexBankedResetListResponse}
 */
export function toListResponse(response) {
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

    return /** @type {CodexBankedResetListResponse} */ (response);
}

export class BankedResetRedemptionError extends CodexError {
    /** @param {string} outcome @param {string} message */
    constructor(outcome, message) {
        super("redemption-failed", message, `Codex banked reset redemption returned ${outcome}`);
        this.outcome = outcome;
    }
}

/**
 * @param {Record<string, unknown>} response
 * @returns {{code: "reset", windows_reset?: number}}
 */
export function toRedeemResponse(response) {
    let failureMessage;
    switch (response.code) {
        case "reset":
            // The outcome confirms success when the optional count is omitted.
            if (
                response.windows_reset !== undefined &&
                (typeof response.windows_reset !== "number" ||
                    !Number.isInteger(response.windows_reset) ||
                    response.windows_reset <= 0)
            ) {
                throwUnexpected("windows_reset is not a positive integer for a reset outcome");
            }
            return /** @type {{code: "reset", windows_reset?: number}} */ (response);
        case "nothing_to_reset":
            failureMessage =
                "Reset not redeemed. Codex reported nothing to reset. Keep this reset for later.";
            break;
        case "no_credit":
            failureMessage =
                "Reset not redeemed. The selected reset is unavailable. Choose another reset.";
            break;
        case "already_redeemed":
            failureMessage =
                "Reset not redeemed. The selected reset was already redeemed. Choose another reset.";
            break;
        default:
            throwUnexpected("code is missing or not a recognized redemption outcome");
    }
    throw new BankedResetRedemptionError(response.code, failureMessage);
}

/** @param {CodexBankedResetCredit[]} credits */
export function selectCreditToRedeem(credits) {
    let earliest = null;
    let earliestExpiry = Infinity;
    for (const credit of credits) {
        if (credit.status !== "available") continue;
        earliest ??= credit;
        const expiresAt = Date.parse(credit.expires_at ?? "");
        if (expiresAt < earliestExpiry) {
            earliest = credit;
            earliestExpiry = expiresAt;
        }
    }
    return earliest;
}

/**
 * @param {CodexBankedResetCredit[]} credits
 * @param {number} nowMs
 * @param {number} windowMs
 * @returns {CodexBankedResetCredit | null}
 */
export function selectCreditExpiringWithin(credits, nowMs, windowMs) {
    const expiresBy = nowMs + windowMs;
    return (
        credits
            .filter((credit) => {
                if (credit.status !== "available" || typeof credit.expires_at !== "string") {
                    return false;
                }
                const expiresAt = Date.parse(credit.expires_at);
                return expiresAt > nowMs && expiresAt <= expiresBy;
            })
            .toSorted(
                (left, right) =>
                    Date.parse(left.expires_at ?? "") - Date.parse(right.expires_at ?? ""),
            )[0] ?? null
    );
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
    throw new CodexError(
        "unexpected-response",
        "Codex returned banked reset data this extension does not understand.",
        `Unexpected Codex banked reset API response shape: ${message}`,
    );
}
