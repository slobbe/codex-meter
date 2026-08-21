import { getQuota, getSecondaryQuota } from "../usage/model.js";

export function createPanelBarViewModel(settings, snapshot, errorMessage) {
    const sessionQuota = getQuota(snapshot, "session");
    const weeklyQuota = getQuota(snapshot, "weekly");
    const showPrimary = settings.showPrimary && (!snapshot || Boolean(sessionQuota));
    const showSecondary = settings.showSecondary && (!snapshot || Boolean(weeklyQuota));
    const displayMode = settings.topPanelDisplayMode;
    const hasTopPanelUsage = showPrimary || showSecondary;
    const showSplitBars = displayMode === "bars" && hasTopPanelUsage;
    const percentDisplayMode = settings.percentDisplayMode;
    const viewModel = {
        primaryVisible: showPrimary,
        secondaryVisible: showSecondary,
        primaryPercent: 0,
        secondaryPercent: 0,
        primaryDisplayPercent: 0,
        secondaryDisplayPercent: 0,
        showBars: Boolean(showSplitBars),
        showLabel: !showSplitBars,
        label: "",
    };
    if (errorMessage) {
        viewModel.primaryVisible = false;
        viewModel.secondaryVisible = false;
        viewModel.showBars = false;
        viewModel.showLabel = false;
        return viewModel;
    }
    if (snapshot) {
        viewModel.primaryPercent = normalizePercent(sessionQuota?.usedPercent);
        viewModel.secondaryPercent = normalizePercent(weeklyQuota?.usedPercent);
        viewModel.primaryDisplayPercent = convertPercentForDisplay(
            viewModel.primaryPercent,
            percentDisplayMode,
        );
        viewModel.secondaryDisplayPercent = convertPercentForDisplay(
            viewModel.secondaryPercent,
            percentDisplayMode,
        );
    }
    if (!viewModel.showLabel) return viewModel;
    if (!hasTopPanelUsage) return viewModel;
    if (!snapshot) {
        viewModel.label = errorMessage ? "!" : "--";
        return viewModel;
    }
    const parts = [];
    if (showPrimary) {
        parts.push(formatPercentForDisplay(sessionQuota?.usedPercent, percentDisplayMode));
    }
    if (showSecondary) {
        parts.push(formatPercentForDisplay(weeklyQuota?.usedPercent, percentDisplayMode));
    }
    viewModel.label = parts.join("/");
    return viewModel;
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
    if (errorMessage) {
        return {
            updatedAt: "--",
            errorMessage,
            statusTitle: null,
            statusMessage: null,
            hasError: true,
            primary: createUsageItemViewModel({
                visible: false,
                title: "Session (5h)",
                value: "--",
                percentDisplayMode,
            }),
            secondary: createUsageItemViewModel({
                visible: false,
                title: "Week",
                value: "--",
                percentDisplayMode,
            }),
            plan: "--",
            trend: createUsageTrendViewModel(null, []),
        };
    }
    if (!snapshot) {
        return {
            updatedAt: "--",
            errorMessage: null,
            statusTitle: null,
            statusMessage: null,
            hasError: false,
            primary: createUsageItemViewModel({
                title: "Session (5h)",
                value: "Loading...",
                percentDisplayMode,
            }),
            secondary: createUsageItemViewModel({
                title: "Week",
                value: "--",
                percentDisplayMode,
            }),
            plan: "--",
            trend: createUsageTrendViewModel(null, []),
        };
    }
    const primaryQuota = getQuota(snapshot, "session");
    const secondaryQuota = getQuota(snapshot, "weekly");
    return {
        updatedAt: "",
        errorMessage: null,
        statusTitle: cachedFailureMessage ? "Showing cached data" : null,
        statusMessage: cachedFailureMessage ? `Refresh failed: ${cachedFailureMessage}` : null,
        hasError: false,
        primary: createUsageItemViewModel({
            visible: Boolean(primaryQuota),
            title: primaryQuota?.label ?? "Primary",
            value: formatPercentForDisplay(primaryQuota?.usedPercent, percentDisplayMode),
            prediction: formatLimitPrediction(
                primaryQuota ? prediction?.quotas?.[primaryQuota.id] : prediction?.primary,
                primaryQuota,
                "primary",
            ),
            reset: formatReset(primaryQuota, "primary"),
            percentValue: primaryQuota?.usedPercent,
            baselinePercentValue: calculateBaselinePercent(primaryQuota),
            percentDisplayMode,
            predictionStyle: getPredictionStyleClass(
                primaryQuota ? prediction?.quotas?.[primaryQuota.id] : prediction?.primary,
            ),
        }),
        secondary: createUsageItemViewModel({
            visible: Boolean(secondaryQuota),
            title: secondaryQuota?.label ?? "Secondary",
            value: formatPercentForDisplay(secondaryQuota?.usedPercent, percentDisplayMode),
            prediction: formatLimitPrediction(
                secondaryQuota ? prediction?.quotas?.[secondaryQuota.id] : prediction?.secondary,
                secondaryQuota,
                "secondary",
            ),
            reset: formatReset(secondaryQuota, "secondary"),
            percentValue: secondaryQuota?.usedPercent,
            baselinePercentValue: calculateBaselinePercent(secondaryQuota),
            percentDisplayMode,
            predictionStyle: getPredictionStyleClass(
                secondaryQuota ? prediction?.quotas?.[secondaryQuota.id] : prediction?.secondary,
            ),
        }),
        plan: formatFooter(snapshot),
        trend: createUsageTrendViewModel(snapshot, history),
    };
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
        baselinePercentValue: normalizedBaselinePercentValue,
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

const MIN_BURN_RATE_OBSERVED_SECONDS = 6 * 60 * 60;

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
    const quotaId = getSecondaryQuota(snapshot)?.id ?? "weekly";
    const minTimestamp = nowSeconds - TREND_LOOKBACK_SECONDS;
    return history
        .map((entry) => {
            const timestamp = new Date(entry.timestamp).getTime() / 1000;
            const quota =
                entry.quotas.find((item) => item.id === quotaId) ??
                entry.quotas.find((item) => item.id === "weekly");
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

export function calculateRecentPositiveDelta(samples) {
    let total = 0;
    for (let index = 1; index < samples.length; index += 1) {
        const delta = samples[index].usedPercent - samples[index - 1].usedPercent;
        if (delta > 0 && delta <= 100) total += delta;
    }
    return total;
}

export function calculateAverageBurnRatePercentPerDay(samples) {
    if (samples.length < 2) return null;
    const positiveDelta = calculateRecentPositiveDelta(samples);
    if (positiveDelta <= 0) return null;
    const observedSeconds = samples.at(-1).timestamp - samples[0].timestamp;
    if (!Number.isFinite(observedSeconds) || observedSeconds <= 0) return null;
    const observedDays = Math.max(observedSeconds, MIN_BURN_RATE_OBSERVED_SECONDS) / 86400;
    return positiveDelta / observedDays;
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

export function formatReset(quota, windowType) {
    if (!quota) return "resets in --";
    if (quota.resetDescription) return quota.resetDescription;
    const useDate = windowType === "secondary" ? true : false;
    const relative = formatDuration(quota.resetAfterSeconds, windowType);
    const absolute = formatUnixTimestamp(quota.resetAt, useDate);
    if (relative === "--" && absolute === "--") return "resets in --";
    if (relative === "--") return `resets in -- (${absolute})`;
    if (absolute === "--") return `resets in ${relative}`;
    return `resets in ${relative} (${absolute})`;
}

export function formatDuration(totalSeconds, windowType) {
    if (!Number.isFinite(totalSeconds)) return "--";
    let remaining = Math.max(0, Math.floor(totalSeconds));
    const days = Math.floor(remaining / 86400);
    remaining %= 86400;
    const hours = Math.floor(remaining / 3600);
    remaining %= 3600;
    const minutes = Math.floor(remaining / 60);
    if (windowType === "primary") return `${hours}h ${minutes}m`;
    if (windowType === "secondary") return `${days}d ${hours}h`;
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes || parts.length === 0) parts.push(`${minutes}m`);
    return parts.join(" ");
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
    const datetimeFormat = new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
    });
    const timeFormat = new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
    });
    const format = date ? datetimeFormat : timeFormat;
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

export function formatLimitPrediction(prediction, quota, windowType) {
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
        return `Will hit limit ~${formatCompactDuration(secondsBeforeReset, windowType)} before reset`;
    }
    return `Will hit limit in ~${formatCompactDuration(secondsUntil(prediction.estimatedLimitAt), windowType)}`;
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

function formatCompactDuration(totalSeconds, windowType) {
    if (!Number.isFinite(totalSeconds)) return "--";
    const seconds = Math.max(0, Math.round(totalSeconds));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (windowType === "secondary" && days > 0) {
        return hours >= 12 ? `${days + 1}d` : `${days}d`;
    }
    if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    if (hours > 0) return minutes >= 30 ? `${hours + 1}h` : `${hours}h`;
    return `${Math.max(1, minutes)}m`;
}

export function normalizePercent(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
}
