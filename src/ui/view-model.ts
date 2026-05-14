import { UsagePrediction, WindowPrediction } from "../domain/prediction.js";
import { UsageSnapshot, UsageWindow } from "../domain/usage-snapshot.js";
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

export type MenuViewModel = {
    updatedAt: string;
    primary: UsageItemViewModel;
    secondary: UsageItemViewModel;
    plan: string;
    errorMessage: string | null;
    hasError: boolean;
};

export function createPanelBarViewModel(settings, snapshot, errorMessage) {
    const showPrimary = settings.showPrimary;
    const showSecondary = settings.showSecondary;
    const displayMode = settings.topPanelDisplayMode;
    const hasTopPanelUsage = showPrimary || showSecondary;
    const includePrimary = showPrimary;
    const showUnifiedBar = displayMode === "unified" && hasTopPanelUsage;
    const showSplitBars = displayMode === "bars" && hasTopPanelUsage;
    const percentDisplayMode = settings.percentDisplayMode;

    const viewModel: PanelBarViewModel = {
        primaryVisible: includePrimary,
        secondaryVisible: showSecondary,
        primaryPercent: 0,
        secondaryPercent: 0,
        primaryDisplayPercent: 0,
        secondaryDisplayPercent: 0,
        showBars: Boolean(showSplitBars || showUnifiedBar),
        showLabel: !showSplitBars && !showUnifiedBar,
        label: "",
    };

    if (errorMessage) {
        viewModel.primaryVisible = false;
        viewModel.secondaryVisible = false;
        viewModel.showBars = false;
        viewModel.showLabel = false;

        return viewModel;
    }

    if (showUnifiedBar) {
        viewModel.primaryVisible = true;
        viewModel.secondaryVisible = false;
    }

    if (snapshot) {
        if (showUnifiedBar) {
            if (showPrimary && showSecondary) {
                viewModel.primaryPercent = calculateUnifiedPercent(
                    snapshot.rateLimit.primary?.usedPercent,
                    snapshot.rateLimit.secondary?.usedPercent,
                );
            } else if (showPrimary) {
                viewModel.primaryPercent = normalizePercent(
                    snapshot.rateLimit.primary?.usedPercent,
                );
            } else {
                viewModel.primaryPercent = normalizePercent(
                    snapshot.rateLimit.secondary?.usedPercent,
                );
            }
        } else {
            viewModel.primaryPercent = normalizePercent(
                snapshot.rateLimit.primary?.usedPercent,
            );
            viewModel.secondaryPercent = normalizePercent(
                snapshot.rateLimit.secondary?.usedPercent,
            );
        }

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
            snapshot.rateLimit.primary?.usedPercent,
            percentDisplayMode,
        ));
    }

    if (showSecondary) {
        parts.push(formatPercentForDisplay(
            snapshot.rateLimit.secondary?.usedPercent,
            percentDisplayMode,
        ));
    }

    viewModel.label = parts.join("/");

    return viewModel;
}

export function createMenuViewModel(settings, snapshot: UsageSnapshot, prediction: UsagePrediction, errorMessage) {
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
        };
    }

    return {
        updatedAt: "Updated at " + formatUnixTimestamp(snapshot.fetchedAt, false),
        errorMessage: null,
        hasError: false,
        primary: createUsageItemViewModel({
            title: "Session (5h)",
            value: formatPercentForDisplay(
                snapshot.rateLimit.primary?.usedPercent,
                percentDisplayMode,
            ),
            prediction: formatLimitPrediction(prediction?.primary, "primary"),
            reset: formatReset(snapshot.rateLimit.primary, "primary"),
            percentValue: snapshot.rateLimit.primary?.usedPercent,
            baselinePercentValue: calculateBaselinePercent(
                snapshot.rateLimit.primary,
            ),
            percentDisplayMode,
            predictionStyle: getPredictionStyleClass(prediction?.primary),
        }),
        secondary: createUsageItemViewModel({
            title: "Week",
            value: formatPercentForDisplay(
                snapshot.rateLimit.secondary?.usedPercent,
                percentDisplayMode,
            ),
            prediction: formatLimitPrediction(prediction?.secondary, "secondary"),
            reset: formatReset(snapshot.rateLimit.secondary, "secondary"),
            percentValue: snapshot.rateLimit.secondary?.usedPercent,
            baselinePercentValue: calculateBaselinePercent(
                snapshot.rateLimit.secondary,
            ),
            percentDisplayMode,
            predictionStyle: getPredictionStyleClass(prediction?.secondary),
        }),
        plan: formatPlan(snapshot.planType),
    };
}

export function createUsageItemViewModel({
    title,
    value,
    prediction = "Trend: --",
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

export function calculateBaselinePercent(window: UsageWindow): number | null {
    if (!window) return null;

    const { limitWindowSeconds, resetAfterSeconds } = window;

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

export function formatReset(window: UsageWindow, windowType: UsageWindowType) {
    if (!window) return "resets in --";

    const useDate = windowType === "secondary" ? true : false;
    
    const relative = formatDuration(window.resetAfterSeconds, windowType);
    const absolute = formatUnixTimestamp(window.resetAt, useDate);

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
    let trend: string;
    
    switch (prediction?.trend) {
        case "limit reached":
            trend = "Limit reached";
            break;
        case "unsafe":
            trend = `Limit in ~${formatDuration(
                secondsUntil(prediction.estimatedLimitAt),
                windowType,
            )}`;
            break;
        case "safe":
            trend = "Safe";
            break;
        default:
            trend = "--";
            break;
    }

    return `Trend: ${trend}`;
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

export function calculateUnifiedPercent(...values) {
    const normalizedValues = values
        .filter(Number.isFinite)
        .map((value) => normalizePercent(value) / 100);

    if (normalizedValues.length === 0) return 0;

    const remainingCapacity = normalizedValues.reduce(
        (remaining, value) => remaining * (1 - value),
        1,
    );

    return Math.round((1 - remainingCapacity) * 100);
}

export function normalizePercent(value: number): number {
    if (!Number.isFinite(value)) return 0;

    return Math.max(0, Math.min(100, value));
}
