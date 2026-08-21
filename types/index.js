/**
 * Shared domain types for checked JavaScript modules.
 * This module intentionally has no runtime behavior.
 *
 * @typedef {object} UsageSnapshot
 * @property {number} fetchedAt UNIX timestamp in seconds

 * @property {string} planType
 * @property {UsageCredits} [credits]
 * @property {UsageQuota[]} quotas
 *
 * @typedef {object} UsageCredits
 * @property {string | null} balance
 * @property {boolean} [hasCredits]
 * @property {boolean} [unlimited]
 * @property {boolean} [overageLimitReached]
 *
 * @typedef {object} UsageQuota
 * @property {string} id
 * @property {string} label
 * @property {number} usedPercent
 * @property {number | null} [used]
 * @property {number | null} [limit]
 * @property {number | null} [remaining]
 * @property {number | null} [limitWindowSeconds]
 * @property {number | null} [resetAfterSeconds]
 * @property {number | null} [resetAt] UNIX timestamp in seconds
 * @property {boolean} [limitReached]
 * @property {string | null} [resetDescription]
 *
 * @typedef {object} HistoryEntry
 * @property {string} timestamp ISO timestamp
 * @property {HistoryQuotaEntry[]} quotas
 *
 * @typedef {object} HistoryQuotaEntry
 * @property {string} id
 * @property {number} usedPercent
 * @property {number | null} [used]
 * @property {number | null} [limit]
 * @property {number | null} [remaining]
 * @property {number | null} [resetAt]
 * @property {boolean} [limitReached]
 *
 * @typedef {"safe" | "unsafe" | "limit reached" | "unknown"} Trend
 *
 * @typedef {object} WindowPrediction
 * @property {number | null} estimatedLimitAt
 * @property {Trend} trend
 *
 * @typedef {object} UsagePrediction
 * @property {Record<string, WindowPrediction>} quotas
 * @property {WindowPrediction} primary
 * @property {WindowPrediction} secondary
 */

export {};
