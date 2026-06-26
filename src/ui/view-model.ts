import { UsagePrediction, WindowPrediction } from "../domain/prediction.js";
import { getPrimaryQuota, getSecondaryQuota, HistoryEntry, UsageQuota, UsageSnapshot } from "../domain/usage.js";
import { type PercentDisplayMode } from "../app/settings.js";

export type UsageWindowType = "primary" | "secondary";

export type PredictionStyle = "safe" | "warning" | "danger" | "muted";

export type UsageItemViewModel = {
    title: string;
    value: string;
    prediction: string;
    reset: string;
    percentValue: number;
    displayPercentValue: number;
    baselinePercentValue: number | null;
    displayBaselinePercentValue: number | null;
    percentLabel: PercentDisplayMode;
    predictionStyle: PredictionStyle;
};

export type PanelBarViewModel = {
    primaryVisible: boolean;
    secondaryVisible: boolean;
    primaryPercent: number;
    secondaryPercent: number;
    primaryDisplayPercent: number;
    secondaryDisplayPercent: number;
    showBars: boolean;
    showLabel: boolean;
    label: string;
};

export type UsageTrendViewModel = {
    visible: boolean;
    bars: number[];
};

export type MenuViewModel = {
    updatedAt: string;
    primary: UsageItemViewModel;
    secondary: UsageItemViewModel;
    plan: string;
    trend: UsageTrendViewModel;
    errorMessage: string | null;
    hasError: boolean;
};

export function createPanelBarViewModel(settings, snapshot, errorMessage) {
    const showPrimary = settings.showPrimary;
    const showSecondary = settings.showSecondary;
    const displayMode = settings.topPanelDisplayMode;
    const hasTopPanelUsage = showPrimary || showSecondary;
    const includePrimary = showPrimary;
    const showSplitBars = displayMode === "bars" && hasTopPanelUsage;
    const percentDisplayMode = settings.percentDisplayMode;

    const viewModel: PanelBarViewModel = {
        primaryVisible: includePrimary,
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
        viewModel.primaryPercent = normalizePercent(
            getPrimaryQuota(snapshot)?.usedPercent,
        );
        viewModel.secondaryPercent = normalizePercent(
            getSecondaryQuota(snapshot)?.usedPercent,
        );

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

    if (includePrimary) {
        parts.push(formatPercentForDisplay(
            getPrimaryQuota(snapshot)?.usedPercent,
            percentDisplayMode,
        ));
    }

    if (showSecondary) {
        parts.push(formatPercentForDisplay(
            getSecondaryQuota(snapshot)?.usedPercent,
            percentDisplayMode,
        ));
    }

    viewModel.label = parts.join("/");

    return viewModel;
}

export function createMenuViewModel(
    settings,
    snapshot: UsageSnapshot,
    prediction: UsagePrediction,
    history: HistoryEntry[] = [],
    errorMessage = null,
) {
    const percentDisplayMode = settings.percentDisplayMode;

    if (errorMessage) {
        return {
            updatedAt: "--",
            errorMessage,
            hasError: true,
            primary: createUsageItemViewModel({
                title: "Session (5h)",
                value: "--",
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

    if (!snapshot) {
        return {
            updatedAt: "--",
            errorMessage: null,
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

    const primaryQuota = getPrimaryQuota(snapshot);
    const secondaryQuota = getSecondaryQuota(snapshot);

    return {
        updatedAt: "Updated at " + formatUnixTimestamp(snapshot.fetchedAt, false),
        errorMessage: null,
        hasError: false,
        primary: createUsageItemViewModel({
            title: primaryQuota?.label ?? "Primary",
            value: formatPercentForDisplay(
                primaryQuota?.usedPercent,
                percentDisplayMode,
            ),
            prediction: formatLimitPrediction(
                primaryQuota ? prediction?.quotas?.[primaryQuota.id] : prediction?.primary,
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
            title: secondaryQuota?.label ?? "Secondary",
            value: formatPercentForDisplay(
                secondaryQuota?.usedPercent,
                percentDisplayMode,
            ),
            prediction: formatLimitPrediction(
                secondaryQuota ? prediction?.quotas?.[secondaryQuota.id] : prediction?.secondary,
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
        plan: formatPlan(snapshot.planType),
        trend: createUsageTrendViewModel(snapshot, history),
    };
}

export function createUsageItemViewModel({
    title,
    value,
    prediction = "",
    reset = "resets in --",
    percentValue = null,
    baselinePercentValue = null,
    percentDisplayMode = "used" as PercentDisplayMode,
    predictionStyle = "muted" as PredictionStyle,
}): UsageItemViewModel {
    const normalizedPercentValue = normalizePercent(percentValue);
    const normalizedBaselinePercentValue = Number.isFinite(baselinePercentValue)
        ? normalizePercent(baselinePercentValue)
        : null;

    return {
        title,
        value,
        prediction,
        reset,
        percentValue: normalizedPercentValue,
        displayPercentValue: convertPercentForDisplay(
            normalizedPercentValue,
            percentDisplayMode,
        ),
        baselinePercentValue: normalizedBaselinePercentValue,
        displayBaselinePercentValue: normalizedBaselinePercentValue === null
            ? null
            : convertPercentForDisplay(
                normalizedBaselinePercentValue,
                percentDisplayMode,
            ),
        percentLabel: percentDisplayMode,
        predictionStyle,
    };
}

const TREND_LOOKBACK_SECONDS = 7 * 24 * 60 * 60;
const TREND_BUCKET_COUNT = 56;
const TREND_MIN_BAR_PERCENT = 12;

export function createUsageTrendViewModel(
    snapshot: UsageSnapshot | null,
    history: HistoryEntry[] = [],
    nowSeconds = Date.now() / 1000,
): UsageTrendViewModel {
    const quotaId = getPrimaryQuota(snapshot)?.id ?? "session";
    const minTimestamp = nowSeconds - TREND_LOOKBACK_SECONDS;
    const samples = history
        .map((entry) => {
            const timestamp = new Date(entry.timestamp).getTime() / 1000;
            const quota = entry.quotas.find((item) => item.id === quotaId) ??
                entry.quotas.find((item) => item.id === "session");

            return {
                timestamp,
                usedPercent: quota?.usedPercent,
            };
        })
        .filter((entry): entry is { timestamp: number; usedPercent: number } =>
            Number.isFinite(entry.timestamp) &&
            entry.timestamp >= minTimestamp &&
            Number.isFinite(entry.usedPercent)
        )
        .toSorted((a, b) => a.timestamp - b.timestamp);

    if (samples.length < 2) return { visible: false, bars: [] };

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

    if (maxValue <= 0) return { visible: false, bars: [] };

    return {
        visible: true,
        bars: bucketValues.map((value) => {
            if (value <= 0) return 0;

            return Math.max(
                TREND_MIN_BAR_PERCENT,
                Math.round((value / maxValue) * 100),
            );
        }),
    };
}

function addTrendDeltaToBuckets({
    bucketValues,
    delta,
    fromTimestamp,
    toTimestamp,
    minTimestamp,
    bucketSize,
}: {
    bucketValues: number[];
    delta: number;
    fromTimestamp: number;
    toTimestamp: number;
    minTimestamp: number;
    bucketSize: number;
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
        const overlap = Math.max(
            0,
            Math.min(end, bucketEnd) - Math.max(start, bucketStart),
        );

        if (overlap > 0) {
            bucketValues[index] += delta * (overlap / duration);
        }
    }
}

function getTrendBucketIndex(
    timestamp: number,
    minTimestamp: number,
    bucketSize: number,
): number {
    return Math.min(
        TREND_BUCKET_COUNT - 1,
        Math.max(0, Math.floor((timestamp - minTimestamp) / bucketSize)),
    );
}

export function calculateBarFillWidth(trackWidth: number, percentValue: number): number {
    if (trackWidth <= 0) return 0;

    return Math.round(trackWidth * (normalizePercent(percentValue) / 100));
}

export function calculateBarMarkerPosition(
    trackWidth: number,
    markerWidth: number,
    percentValue: number | null,
): number {
    if (trackWidth <= 0 || !Number.isFinite(percentValue)) return 0;

    const usableWidth = Math.max(0, trackWidth - Math.max(0, markerWidth));

    return Math.round(usableWidth * (normalizePercent(percentValue) / 100));
}

export function calculateBaselinePercent(quota: UsageQuota | null): number | null {
    if (!quota) return null;

    const { limitWindowSeconds, resetAfterSeconds } = quota;

    if (
        !Number.isFinite(limitWindowSeconds) ||
        !Number.isFinite(resetAfterSeconds) ||
        limitWindowSeconds <= 0
    ) {
        return null;
    }

    return normalizePercent(
        ((limitWindowSeconds - resetAfterSeconds) / limitWindowSeconds) * 100,
    );
}

export function getUsageBarColorStyleClass(percentValue: number): string {
    const percent = normalizePercent(percentValue);

    if (percent >= 100) return "cx-color-danger";

    if (percent > 75) return "cx-color-warning";

    return "cx-color-green";
}

export function formatPercent(value: number): string {
    return Number.isFinite(value) ? `${value}%` : "--";
}

export function formatPercentForDisplay(
    value: number,
    displayMode: PercentDisplayMode,
): string {
    if (!Number.isFinite(value)) return "--";

    return formatPercent(convertPercentForDisplay(value, displayMode));
}

export function convertPercentForDisplay(
    value: number,
    displayMode: PercentDisplayMode,
): number {
    const percent = normalizePercent(value);

    return displayMode === "left" ? 100 - percent : percent;
}

export function formatReset(quota: UsageQuota | null, windowType: UsageWindowType) {
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

export function formatDuration(totalSeconds: number, windowType?: UsageWindowType) {
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
export function formatUnixTimestamp(value: number, date: boolean = true): string {
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
export function formatTimestamp(value: string, date: boolean = true): string {
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
export function secondsUntil(unixTimestamp: number): number {
    if (!Number.isFinite(unixTimestamp)) return null;

    return Math.max(0, Math.round(unixTimestamp - Date.now() / 1000));
}

export function formatLimitPrediction(prediction: WindowPrediction, windowType: UsageWindowType) {
    if (prediction?.trend === "limit reached") return "Limit reached";

    if (prediction?.trend !== "unsafe") return "";

    return `Limit in about ${formatDuration(
        secondsUntil(prediction.estimatedLimitAt),
        windowType,
    )}`;
}

export function getPredictionStyleClass(prediction: WindowPrediction): PredictionStyle {
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

export function formatPlan(value) {
    if (!value) return "--";

    return value
        .toString()
        .split(/[_-]/)
        .filter(Boolean)
        .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
        .join(" ");
}

export function normalizePercent(value: number): number {
    if (!Number.isFinite(value)) return 0;

    return Math.max(0, Math.min(100, value));
}
