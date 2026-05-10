import { UsagePrediction, WindowPrediction } from "../domain/prediction.js";
import { UsageSnapshot, UsageWindow } from "../domain/usage-snapshot.js";

export type UsageWindowType = "five-hour" | "weekly";

export type PredictionStyle = "safe" | "warning" | "danger" | "muted";

export type UsageItemViewModel = {
    title: string;
    value: string;
    prediction: string;
    reset: string;
    percentValue: number;
    predictionStyle: PredictionStyle;
};

export type PanelBarViewModel = {
    fiveHourVisible: boolean;
    weeklyVisible: boolean;
    fiveHourPercent: number;
    weeklyPercent: number;
    showBars: boolean;
    showLabel: boolean;
    label: string;
};

export type MenuViewModel = {
    updatedAt: string;
    fiveHour: UsageItemViewModel;
    weekly: UsageItemViewModel;
    plan: string;
    errorMessage: string | null;
    hasError: boolean;
};

export function createPanelBarViewModel(settings, snapshot, errorMessage) {
    const showFiveHour = settings.showFiveHour;
    const showWeekly = settings.showWeekly;
    const displayMode = settings.topBarDisplayMode;
    const hasTopBarUsage = showFiveHour || showWeekly;
    const includeFiveHour = showFiveHour;
    const showUnifiedBar = displayMode === "unified" && hasTopBarUsage;
    const showSplitBars = displayMode === "bars" && hasTopBarUsage;

    const viewModel: PanelBarViewModel = {
        fiveHourVisible: includeFiveHour,
        weeklyVisible: showWeekly,
        fiveHourPercent: 0,
        weeklyPercent: 0,
        showBars: Boolean(showSplitBars || showUnifiedBar),
        showLabel: !showSplitBars && !showUnifiedBar,
        label: "",
    };

    if (errorMessage) {
        viewModel.fiveHourVisible = false;
        viewModel.weeklyVisible = false;
        viewModel.showBars = false;
        viewModel.showLabel = false;

        return viewModel;
    }

    if (showUnifiedBar) {
        viewModel.fiveHourVisible = true;
        viewModel.weeklyVisible = false;
    }

    if (snapshot) {
        if (showUnifiedBar) {
            if (showFiveHour && showWeekly) {
                viewModel.fiveHourPercent = calculateUnifiedPercent(
                    snapshot.rateLimit.primary?.usedPercent,
                    snapshot.rateLimit.secondary?.usedPercent,
                );
            } else if (showFiveHour) {
                viewModel.fiveHourPercent = normalizePercent(
                    snapshot.rateLimit.primary?.usedPercent,
                );
            } else {
                viewModel.fiveHourPercent = normalizePercent(
                    snapshot.rateLimit.secondary?.usedPercent,
                );
            }
        } else {
            viewModel.fiveHourPercent = normalizePercent(
                snapshot.rateLimit.primary?.usedPercent,
            );
            viewModel.weeklyPercent = normalizePercent(
                snapshot.rateLimit.secondary?.usedPercent,
            );
        }
    }

    if (!viewModel.showLabel) return viewModel;

    if (!hasTopBarUsage) return viewModel;

    if (!snapshot) {
        viewModel.label = errorMessage ? "!" : "--";
        return viewModel;
    }

    const parts = [];

    if (includeFiveHour) {
        parts.push(formatPercent(snapshot.rateLimit.primary?.usedPercent));
    }

    if (showWeekly) {
        parts.push(formatPercent(snapshot.rateLimit.secondary?.usedPercent));
    }

    viewModel.label = parts.join("/");

    return viewModel;
}

export function createMenuViewModel(snapshot: UsageSnapshot, prediction: UsagePrediction, errorMessage) {
    if (errorMessage) {
        return {
            updatedAt: "--",
            errorMessage,
            hasError: true,
            fiveHour: createUsageItemViewModel({
                title: "Session (5h)",
                value: "--",
            }),
            weekly: createUsageItemViewModel({
                title: "Week",
                value: "--",
            }),
            plan: "--",
        };
    }

    if (!snapshot) {
        return {
            updatedAt: "--",
            errorMessage: null,
            hasError: false,
            fiveHour: createUsageItemViewModel({
                title: "Session (5h)",
                value: "Loading...",
            }),
            weekly: createUsageItemViewModel({
                title: "Week",
                value: "--",
            }),
            plan: "--",
        };
    }

    return {
        updatedAt: "Updated at " + formatUnixTimestamp(snapshot.fetchedAt, false),
        errorMessage: null,
        hasError: false,
        fiveHour: createUsageItemViewModel({
            title: "Session (5h)",
            value: formatPercent(snapshot.rateLimit.primary?.usedPercent),
            prediction: formatLimitPrediction(prediction?.primary, "five-hour"),
            reset: formatReset(snapshot.rateLimit.primary, "five-hour"),
            percentValue: snapshot.rateLimit.primary?.usedPercent,
            predictionStyle: getPredictionStyleClass(prediction?.primary),
        }),
        weekly: createUsageItemViewModel({
            title: "Week",
            value: formatPercent(snapshot.rateLimit.secondary?.usedPercent),
            prediction: formatLimitPrediction(prediction?.secondary, "weekly"),
            reset: formatReset(snapshot.rateLimit.secondary, "weekly"),
            percentValue: snapshot.rateLimit.secondary?.usedPercent,
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
    predictionStyle = "muted" as PredictionStyle,
}): UsageItemViewModel {
    return {
        title,
        value,
        prediction,
        reset,
        percentValue: normalizePercent(percentValue),
        predictionStyle,
    };
}

export function calculateBarFillWidth(trackWidth: number, percentValue: number): number {
    if (trackWidth <= 0) return 0;

    return Math.round(trackWidth * (normalizePercent(percentValue) / 100));
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

export function formatReset(window: UsageWindow, windowType: UsageWindowType) {
    if (!window) return "resets in --";

    const useDate = windowType === "weekly" ? true : false;
    
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

    if (windowType === "five-hour") return `${hours}h ${minutes}m`;

    if (windowType === "weekly") return `${days}d ${hours}h`;

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
