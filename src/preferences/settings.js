export const SETTINGS_SHOW_PRIMARY = "show-primary";

export const SETTINGS_SHOW_SECONDARY = "show-secondary";

export const SETTINGS_TOP_PANEL_DISPLAY_MODE = "top-panel-display-mode";

export const SETTINGS_TOP_PANEL_INDICATOR_ICON = "top-panel-indicator-icon";

export const SETTINGS_PERCENT_DISPLAY_MODE = "percent-display-mode";

export const SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES = "background-refresh-interval-minutes";

export const SETTINGS_AUTO_APPLY_BANKED_RESET = "auto-apply-banked-reset";

export const MIN_REFRESH_INTERVAL_MINUTES = 0;

export class SettingsService {
    settings;

    constructor(settings) {
        this.settings = settings;
    }

    getAll() {
        const backgroundRefreshIntervalMinutes = this.getBackgroundRefreshIntervalMinutes();
        return {
            showPrimary: this.getShowPrimary(),
            showSecondary: this.getShowSecondary(),
            topPanelDisplayMode: this.getTopPanelDisplayMode(),
            topPanelIndicatorIcon: this.getTopPanelIndicatorIcon(),
            percentDisplayMode: this.getPercentDisplayMode(),
            backgroundRefreshIntervalMinutes,
            backgroundRefreshIntervalSeconds: backgroundRefreshIntervalMinutes * 60,
            autoApplyBankedReset: this.getAutoApplyBankedReset(),
        };
    }

    getShowPrimary() {
        return this.settings.get_boolean(SETTINGS_SHOW_PRIMARY);
    }

    getShowSecondary() {
        return this.settings.get_boolean(SETTINGS_SHOW_SECONDARY);
    }

    getTopPanelDisplayMode() {
        const value = this.settings.get_string(SETTINGS_TOP_PANEL_DISPLAY_MODE);
        if (value === "bars") {
            return value;
        }
        return "percentages";
    }

    getTopPanelIndicatorIcon() {
        const value = this.settings.get_string(SETTINGS_TOP_PANEL_INDICATOR_ICON);
        if (value === "codex" || value === "openai") {
            return value;
        }
        if (value === "icon") {
            return "codex";
        }
        return "text";
    }

    getPercentDisplayMode() {
        const value = this.settings.get_string(SETTINGS_PERCENT_DISPLAY_MODE);
        if (value === "left") {
            return value;
        }
        return "used";
    }

    getBackgroundRefreshIntervalMinutes() {
        return Math.max(
            MIN_REFRESH_INTERVAL_MINUTES,
            this.settings.get_uint(SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES),
        );
    }

    getBackgroundRefreshIntervalSeconds() {
        return this.getBackgroundRefreshIntervalMinutes() * 60;
    }

    getAutoApplyBankedReset() {
        return this.settings.get_boolean(SETTINGS_AUTO_APPLY_BANKED_RESET);
    }

    connectChanged(callback) {
        return this.settings.connect("changed", callback);
    }

    connectBackgroundRefreshIntervalChanged(callback) {
        return this.settings.connect(
            `changed::${SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES}`,
            callback,
        );
    }

    disconnect(signalId) {
        this.settings.disconnect(signalId);
    }
}
