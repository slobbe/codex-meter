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
};

export function createPanelBarViewModel(settings, snapshot, errorMessage) {
    const showFiveHour = settings.showFiveHour;
    const showWeekly = settings.showWeekly;
    const displayMode = settings.topBarDisplayMode;
    const hasTopBarUsage = showFiveHour || showWeekly;
    const includeFiveHour = showFiveHour;
    const showUnifiedBar =
        displayMode === "unified" && snapshot && hasTopBarUsage;
    const showSplitBars =
        displayMode === "bars" && snapshot && hasTopBarUsage;

    const viewModel: PanelBarViewModel = {
        fiveHourVisible: includeFiveHour,
        weeklyVisible: showWeekly,
        fiveHourPercent: 0,
        weeklyPercent: 0,
        showBars: Boolean(showSplitBars || showUnifiedBar),
        showLabel: !showSplitBars && !showUnifiedBar,
        label: "",
    };

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

export function createMenuViewModel(snapshot, prediction, errorMessage) {
    if (!snapshot) {
        const fallback = errorMessage ?? "Loading Codex usage...";

        return {
            updatedAt: "--",
            fiveHour: createUsageItemViewModel({
                title: "Session (5h)",
                value: fallback,
            }),
            weekly: createUsageItemViewModel({
                title: "Week",
                value: "--",
            }),
            plan: "--",
        };
    }

    return {
        updatedAt: formatUpdatedAt(snapshot.fetchedAt),
        fiveHour: createUsageItemViewModel({
            title: "Session (5h)",
            value: formatPercent(snapshot.rateLimit.primary?.usedPercent),
            prediction: formatLimitPrediction(
                prediction?.primary,
                "five-hour",
            ),
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
    prediction = "Trend unavailable",
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

export function calculateBarFillWidth(trackWidth, percentValue) {
    if (trackWidth <= 0) return 0;

    return Math.round(trackWidth * (normalizePercent(percentValue) / 100));
}

export function getUsageBarColorStyleClass(percentValue) {
    const percent = normalizePercent(percentValue);

    if (percent > 95) return "cx-usage-bar-fill-red";

    if (percent > 75) return "cx-usage-bar-fill-orange";

    return "cx-usage-bar-fill-green";
}

export function formatPercent(value) {
    return Number.isFinite(value) ? `${value}%` : "--";
}

export function formatReset(window, windowType: UsageWindowType) {
    if (!window) return "resets in --";

    const relative = formatDuration(window.resetAfterSeconds, windowType);
    const absolute = formatUnixTimestamp(window.resetAt);

    if (relative === "--" && absolute === "--") return "resets in --";

    if (relative === "--") return `resets in -- (${absolute})`;

    if (absolute === "--") return `resets in ${relative}`;

    return `resets in ${relative} (${absolute})`;
}

export function formatDuration(totalSeconds, windowType?: UsageWindowType) {
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

export function formatUnixTimestamp(value) {
    if (!Number.isFinite(value)) return "--";

    return formatTimestamp(new Date(value * 1000).toISOString());
}

export function formatTimestamp(value) {
    if (!value) return "--";

    try {
        return new Intl.DateTimeFormat(undefined, {
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
        }).format(new Date(value));
    } catch (_error) {
        return "--";
    }
}

export function formatUpdatedAt(value) {
    if (!value) return "--";

    try {
        return (
            "Updated at " +
            new Intl.DateTimeFormat(undefined, {
                hour: "numeric",
                minute: "2-digit",
            }).format(new Date(value * 1000))
        );
    } catch (_error) {
        return "--";
    }
}

export function formatLimitPrediction(prediction, windowType: UsageWindowType) {
    switch (prediction?.trend) {
        case "limit reached":
            return "Limit reached";
        case "safe":
            return `Limit in ${formatDuration(
                secondsUntil(prediction.estimatedLimitAt),
                windowType,
            )}`;
        case "unsafe":
            return "Safe until reset";
        default:
            return "Trend unavailable";
    }
}

export function getPredictionStyleClass(prediction): PredictionStyle {
    switch (prediction?.trend) {
        case "limit reached":
            return "danger";
        case "safe":
            return secondsUntil(prediction.estimatedLimitAt) < 30 * 60
                ? "danger"
                : "warning";
        case "unsafe":
            return "safe";
        default:
            return "muted";
    }
}

export function secondsUntil(unixTimestamp) {
    if (!Number.isFinite(unixTimestamp)) return null;

    return Math.max(0, Math.round(unixTimestamp - Date.now() / 1000));
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

export function normalizePercent(value) {
    if (!Number.isFinite(value)) return 0;

    return Math.max(0, Math.min(100, value));
}
