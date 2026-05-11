import Gio from "gi://Gio";

export const SETTINGS_SHOW_PRIMARY = "show-primary";
export const SETTINGS_SHOW_SECONDARY = "show-secondary";
export const SETTINGS_TOP_PANEL_DISPLAY_MODE = "top-panel-display-mode";
export const SETTINGS_TOP_PANEL_INDICATOR_ICON = "top-panel-indicator-icon";
export const SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES =
    "background-refresh-interval-minutes";

export const MIN_REFRESH_INTERVAL_MINUTES = 0;

export type TopPanelDisplayMode = "percentages" | "bars" | "unified";
export type TopPanelIndicatorIcon = "text" | "codex" | "openai";

export type ExtensionSettings = {
    showPrimary: boolean;
    showSecondary: boolean;
    topPanelDisplayMode: TopPanelDisplayMode;
    topPanelIndicatorIcon: TopPanelIndicatorIcon;
    backgroundRefreshIntervalMinutes: number;
    backgroundRefreshIntervalSeconds: number;
};

export class SettingsService {
    constructor(private readonly settings: Gio.Settings) {}

    getAll(): ExtensionSettings {
        const backgroundRefreshIntervalMinutes =
            this.getBackgroundRefreshIntervalMinutes();

        return {
            showPrimary: this.getShowPrimary(),
            showSecondary: this.getShowSecondary(),
            topPanelDisplayMode: this.getTopPanelDisplayMode(),
            topPanelIndicatorIcon: this.getTopPanelIndicatorIcon(),
            backgroundRefreshIntervalMinutes,
            backgroundRefreshIntervalSeconds:
                backgroundRefreshIntervalMinutes * 60,
        };
    }

    getShowPrimary(): boolean {
        return this.settings.get_boolean(SETTINGS_SHOW_PRIMARY);
    }

    getShowSecondary(): boolean {
        return this.settings.get_boolean(SETTINGS_SHOW_SECONDARY);
    }

    getTopPanelDisplayMode(): TopPanelDisplayMode {
        const value = this.settings.get_string(SETTINGS_TOP_PANEL_DISPLAY_MODE);

        if (value === "bars" || value === "unified") {
            return value;
        }

        return "percentages";
    }

    getTopPanelIndicatorIcon(): TopPanelIndicatorIcon {
        const value = this.settings.get_string(SETTINGS_TOP_PANEL_INDICATOR_ICON);

        if (value === "codex" || value === "openai") {
            return value;
        }

        if (value === "icon") {
            return "codex";
        }

        return "text";
    }

    getBackgroundRefreshIntervalMinutes(): number {
        return Math.max(
            MIN_REFRESH_INTERVAL_MINUTES,
            this.settings.get_uint(SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES),
        );
    }

    getBackgroundRefreshIntervalSeconds(): number {
        return this.getBackgroundRefreshIntervalMinutes() * 60;
    }

    connectChanged(callback: () => void): number {
        return this.settings.connect("changed", callback);
    }

    connectBackgroundRefreshIntervalChanged(callback: () => void): number {
        return this.settings.connect(
            `changed::${SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES}`,
            callback,
        );
    }

    disconnect(signalId: number): void {
        this.settings.disconnect(signalId);
    }
}
