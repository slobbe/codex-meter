export const SETTINGS_TOP_PANEL_DISPLAY_MODE = "top-panel-display-mode";

export const SETTINGS_TOP_PANEL_INDICATOR_ICON = "top-panel-indicator-icon";

export const SETTINGS_PERCENT_DISPLAY_MODE = "percent-display-mode";

export const SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES = "background-refresh-interval-minutes";

export const SETTINGS_AUTO_APPLY_BANKED_RESET = "auto-apply-banked-reset";

export const MIN_REFRESH_INTERVAL_MINUTES = 0;

export function getBackgroundRefreshIntervalSeconds(settings) {
    return (
        Math.max(
            MIN_REFRESH_INTERVAL_MINUTES,
            settings.get_uint(SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES),
        ) * 60
    );
}

export function readSettings(settings) {
    const topPanelDisplayMode = settings.get_string(SETTINGS_TOP_PANEL_DISPLAY_MODE);
    const topPanelIndicatorIcon = settings.get_string(SETTINGS_TOP_PANEL_INDICATOR_ICON);

    return {
        topPanelDisplayMode: topPanelDisplayMode === "bars" ? "bars" : "percentages",
        topPanelIndicatorIcon:
            topPanelIndicatorIcon === "icon"
                ? "codex"
                : ["codex", "openai"].includes(topPanelIndicatorIcon)
                  ? topPanelIndicatorIcon
                  : "text",
        percentDisplayMode:
            settings.get_string(SETTINGS_PERCENT_DISPLAY_MODE) === "left" ? "left" : "used",
        backgroundRefreshIntervalSeconds: getBackgroundRefreshIntervalSeconds(settings),
        autoApplyBankedReset: settings.get_boolean(SETTINGS_AUTO_APPLY_BANKED_RESET),
    };
}
