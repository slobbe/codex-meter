import { getUsageWindowMetadata, sortUsageQuotas } from "../codex/usage/model.js";

export function createPanelBarViewModel(settings, snapshot, errorMessage) {
    if (errorMessage) {
        return { bars: [], showBars: false, showLabel: false, label: "" };
    }
    if (!snapshot) {
        return { bars: [], showBars: false, showLabel: true, label: "--" };
    }
    const quotas = sortUsageQuotas(snapshot.quotas);
    const percentDisplayMode = settings.percentDisplayMode;
    const showBars = settings.topPanelDisplayMode === "bars" && quotas.length > 0;
    const showLabel = !showBars && quotas.length > 0;
    return {
        bars: quotas.map((quota) => ({
            id: quota.id,
            percentValue: normalizePercent(quota.usedPercent),
            displayPercentValue: convertPercentForDisplay(quota.usedPercent, percentDisplayMode),
        })),
        showBars,
        showLabel,
        label: showLabel
            ? quotas
                  .map((quota) => formatPercentForDisplay(quota.usedPercent, percentDisplayMode))
                  .join("/")
            : "",
    };
}

export function createMenuViewModel(
    settings,
    snapshot,
    prediction,
    history = [],
    errorMessage = null,
    cachedFailureMessage = null,
) {
    const percentDisplayMode = settings.percentDisplayMode;
    const refreshLabel = Number.isFinite(snapshot?.fetchedAt)
        ? `Refresh (last at ${formatUnixTimestamp(snapshot.fetchedAt, false)})`
        : "Refresh";
    if (errorMessage) {
        return {
            errorMessage,
            statusTitle: null,
            statusMessage: null,
            usageItems: [],
            accountType: "--",
            refreshLabel,
            trend: createUsageTrendViewModel(null, []),
        };
    }
    if (!snapshot) {
        return {
            errorMessage: null,
            statusTitle: null,
            statusMessage: null,
            usageItems: [
                {
                    id: "loading",
                    ...createUsageItemViewModel({
                        title: "Usage",
                        value: "Loading...",
                        percentDisplayMode,
                    }),
                },
            ],
            accountType: "--",
            refreshLabel,
            trend: createUsageTrendViewModel(null, []),
        };
    }
    const quotas = sortUsageQuotas(snapshot.quotas);
    return {
        errorMessage: null,
        statusTitle: cachedFailureMessage ? "Showing cached data" : null,
        statusMessage: cachedFailureMessage ? `Refresh failed: ${cachedFailureMessage}` : null,
        usageItems: quotas.map((quota) => ({
            id: quota.id,
            ...createQuotaRowViewModel(quota, prediction, percentDisplayMode),
        })),
        accountType: formatPlan(snapshot.planType),
        refreshLabel,
        trend: createUsageTrendViewModel(snapshot, history),
    };
}

function createQuotaRowViewModel(quota, prediction, percentDisplayMode) {
    const quotaPrediction = prediction?.quotas?.[quota.id];
    return createUsageItemViewModel({
        visible: Boolean(quota),
        title:
            quota?.limitWindowSeconds != null
                ? getUsageWindowMetadata(quota.limitWindowSeconds).label
                : (quota?.label ?? "Usage"),
        value: formatPercentForDisplay(quota?.usedPercent, percentDisplayMode),
        prediction: formatLimitPrediction(quotaPrediction, quota),
        reset: formatReset(quota),
        percentValue: quota?.usedPercent,
        baselinePercentValue: calculateBaselinePercent(quota),
        percentDisplayMode,
        predictionStyle: getPredictionStyleClass(quotaPrediction),
    });
}

export function createUsageItemViewModel({
    visible = true,
    title,
    value,
    prediction = "",
    reset = "resets in --",
    percentValue = null,
    baselinePercentValue = null,
    percentDisplayMode = "used",
    predictionStyle = "muted",
}) {
    const normalizedPercentValue = normalizePercent(percentValue);
    const normalizedBaselinePercentValue = Number.isFinite(baselinePercentValue)
        ? normalizePercent(baselinePercentValue)
        : null;
    return {
        visible,
        title,
        value,
        prediction,
        reset,
        percentValue: normalizedPercentValue,
        displayPercentValue: convertPercentForDisplay(normalizedPercentValue, percentDisplayMode),
        displayBaselinePercentValue:
            normalizedBaselinePercentValue === null
                ? null
                : convertPercentForDisplay(normalizedBaselinePercentValue, percentDisplayMode),
        percentLabel: percentDisplayMode,
        predictionStyle,
    };
}

const TREND_TITLE = "Weekly activity";

const TREND_LOOKBACK_SECONDS = 7 * 24 * 60 * 60;

const TREND_BUCKET_COUNT = 56;

const TREND_MIN_BAR_PERCENT = 12;

export function createUsageTrendViewModel(snapshot, history = [], nowSeconds = Date.now() / 1000) {
    const minTimestamp = nowSeconds - TREND_LOOKBACK_SECONDS;
    const samples = getUsageTrendSamples(snapshot, history, nowSeconds);
    if (samples.length < 2) return createHiddenUsageTrendViewModel();
    const bucketSize = TREND_LOOKBACK_SECONDS / TREND_BUCKET_COUNT;
    const bucketValues = Array(TREND_BUCKET_COUNT).fill(0);
    for (let index = 1; index < samples.length; index += 1) {
        const previous = samples[index - 1];
        const current = samples[index];
        const delta = current.usedPercent - previous.usedPercent;
        if (delta <= 0 || delta > 100) continue;
        addTrendDeltaToBuckets({
            bucketValues,
            delta,
            fromTimestamp: previous.timestamp,
            toTimestamp: current.timestamp,
            minTimestamp,
            bucketSize,
        });
    }
    const maxValue = Math.max(...bucketValues);
    if (maxValue <= 0) return createHiddenUsageTrendViewModel();
    return {
        visible: true,
        title: TREND_TITLE,
        bars: bucketValues.map((value) => {
            if (value <= 0) return 0;
            return Math.max(TREND_MIN_BAR_PERCENT, Math.round((value / maxValue) * 100));
        }),
    };
}

function createHiddenUsageTrendViewModel() {
    return {
        visible: false,
        title: TREND_TITLE,
        bars: [],
    };
}

export function getUsageTrendSamples(snapshot, history = [], nowSeconds = Date.now() / 1000) {
    const weeklyQuota =
        snapshot?.quotas.find((quota) => quota.limitWindowSeconds === TREND_LOOKBACK_SECONDS) ??
        snapshot?.quotas.find((quota) => quota.limitWindowSeconds == null && quota.id === "weekly");
    if (snapshot && !weeklyQuota) return [];
    const quotaId = weeklyQuota?.id ?? "weekly";
    const minTimestamp = nowSeconds - TREND_LOOKBACK_SECONDS;
    return history
        .map((entry) => {
            const timestamp = new Date(entry.timestamp).getTime() / 1000;
            const quota = entry.quotas.find((item) => item.id === quotaId);
            return {
                timestamp,
                usedPercent: quota?.usedPercent,
            };
        })
        .filter(
            (entry) =>
                Number.isFinite(entry.timestamp) &&
                entry.timestamp >= minTimestamp &&
                Number.isFinite(entry.usedPercent),
        )
        .toSorted((a, b) => a.timestamp - b.timestamp);
}

function addTrendDeltaToBuckets({
    bucketValues,
    delta,
    fromTimestamp,
    toTimestamp,
    minTimestamp,
    bucketSize,
}) {
    const start = Math.max(minTimestamp, fromTimestamp);
    const end = Math.max(start, toTimestamp);
    if (end <= start) {
        const bucketIndex = getTrendBucketIndex(toTimestamp, minTimestamp, bucketSize);
        bucketValues[bucketIndex] += delta;
        return;
    }
    const duration = end - start;
    const firstBucketIndex = getTrendBucketIndex(start, minTimestamp, bucketSize);
    const lastBucketIndex = getTrendBucketIndex(end, minTimestamp, bucketSize);
    for (let index = firstBucketIndex; index <= lastBucketIndex; index += 1) {
        const bucketStart = minTimestamp + index * bucketSize;
        const bucketEnd = bucketStart + bucketSize;
        const overlap = Math.max(0, Math.min(end, bucketEnd) - Math.max(start, bucketStart));
        if (overlap > 0) {
            bucketValues[index] += delta * (overlap / duration);
        }
    }
}

function getTrendBucketIndex(timestamp, minTimestamp, bucketSize) {
    return Math.min(
        TREND_BUCKET_COUNT - 1,
        Math.max(0, Math.floor((timestamp - minTimestamp) / bucketSize)),
    );
}

export function calculateBarFillWidth(trackWidth, percentValue) {
    if (trackWidth <= 0) return 0;
    return Math.round(trackWidth * (normalizePercent(percentValue) / 100));
}

export function calculateBarMarkerPosition(trackWidth, markerWidth, percentValue) {
    if (trackWidth <= 0 || !Number.isFinite(percentValue)) return 0;
    const usableWidth = Math.max(0, trackWidth - Math.max(0, markerWidth));
    return Math.round(usableWidth * (normalizePercent(percentValue) / 100));
}

export function calculateBaselinePercent(quota) {
    if (!quota) return null;
    const { limitWindowSeconds, resetAfterSeconds } = quota;
    if (
        !Number.isFinite(limitWindowSeconds) ||
        !Number.isFinite(resetAfterSeconds) ||
        limitWindowSeconds <= 0
    ) {
        return null;
    }
    return normalizePercent(((limitWindowSeconds - resetAfterSeconds) / limitWindowSeconds) * 100);
}

export function getUsageBarColorStyleClass(percentValue) {
    const percent = normalizePercent(percentValue);
    if (percent >= 100) return "cx-color-danger";
    if (percent > 75) return "cx-color-warning";
    return "cx-color-green";
}

export function formatPercent(value) {
    return Number.isFinite(value) ? `${value}%` : "--";
}

export function formatPercentForDisplay(value, displayMode) {
    if (!Number.isFinite(value)) return "--";
    return formatPercent(convertPercentForDisplay(value, displayMode));
}

export function convertPercentForDisplay(value, displayMode) {
    const percent = normalizePercent(value);
    return displayMode === "left" ? 100 - percent : percent;
}

export function formatReset(quota) {
    if (!quota) return "resets in --";
    if (quota.resetDescription) return quota.resetDescription;
    const useDate = quota.limitWindowSeconds >= 86_400;
    const relative = formatDuration(quota.resetAfterSeconds);
    const absolute = formatUnixTimestamp(quota.resetAt, useDate);
    if (relative === "--" && absolute === "--") return "resets in --";
    if (relative === "--") return `resets in -- (${absolute})`;
    if (absolute === "--") return `resets in ${relative}`;
    return `resets in ${relative} (${absolute})`;
}

export function formatDuration(totalSeconds) {
    if (!Number.isFinite(totalSeconds)) return "--";
    let remaining = Math.max(0, Math.floor(totalSeconds));
    const days = Math.floor(remaining / 86400);
    remaining %= 86400;
    const hours = Math.floor(remaining / 3600);
    remaining %= 3600;
    const minutes = Math.floor(remaining / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

/**
 * Format a UNIX timestamp given in seconds into time or datetime string
 *
 * @param value UNIX timestamp in seconds
 * @param date whether to format a datetime or time only
 * @returns formatted string
 */
export function formatUnixTimestamp(value, date = true) {
    if (!Number.isFinite(value)) return "--";
    return formatTimestamp(new Date(value * 1000).toISOString(), date);
}

/**
 * Format a ISO string timestamp into time or datetime string
 *
 * @param value ISO string timestamp
 * @param date whether to format a datetime or time only
 * @returns formatted string
 */
export function formatTimestamp(value, date = true) {
    if (!value) return "--";
    const options = date
        ? { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }
        : { hour: "numeric", minute: "2-digit" };
    const format = new Intl.DateTimeFormat(undefined, options);
    try {
        return format.format(new Date(value));
    } catch (_error) {
        return "--";
    }
}

/**
 * Calculate seconds from now until timestamp
 *
 * @param unixTimestamp UNIX timestamp in seconds
 * @returns
 */
export function secondsUntil(unixTimestamp) {
    if (!Number.isFinite(unixTimestamp)) return null;
    return Math.max(0, Math.round(unixTimestamp - Date.now() / 1000));
}

export function formatLimitPrediction(prediction, quota) {
    if (prediction?.trend === "limit reached") return "Limit reached";
    if (prediction?.trend === "safe") return "Safe at current pace";
    if (prediction?.trend !== "unsafe" || !Number.isFinite(prediction.estimatedLimitAt)) {
        return "";
    }
    if (Number.isFinite(quota?.resetAt)) {
        const secondsBeforeReset = Math.max(
            0,
            Math.round(quota?.resetAt - prediction.estimatedLimitAt),
        );
        return `Will hit limit ~${formatDuration(secondsBeforeReset)} before reset`;
    }
    return `Will hit limit in ~${formatDuration(secondsUntil(prediction.estimatedLimitAt))}`;
}

export function getPredictionStyleClass(prediction) {
    switch (prediction?.trend) {
        case "limit reached":
            return "danger";
        case "unsafe":
            return "warning";
        case "safe":
            return "safe";
        default:
            return "muted";
    }
}

export function formatFooter(snapshot) {
    if (!snapshot) return "--";
    const parts = [formatPlan(snapshot.planType)];
    const credits = formatCredits(snapshot.credits);
    if (credits) parts.push(credits);
    parts.push(`Updated ${formatUnixTimestamp(snapshot.fetchedAt, false)}`);
    return parts.filter((part) => part && part !== "--").join(" · ") || "--";
}

function formatCredits(credits) {
    if (!credits || credits.unlimited) return "";
    const balance = typeof credits.balance === "string" ? credits.balance.trim() : "";
    if (!balance || isZeroCreditBalance(balance)) return "";
    return `Credits ${balance}`;
}

function isZeroCreditBalance(value) {
    const numeric = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(numeric) && numeric === 0;
}

export function formatPlan(value) {
    if (!value) return "--";
    return value
        .toString()
        .split(/[_-]/)
        .filter(Boolean)
        .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
        .join(" ");
}

export function normalizePercent(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
}
