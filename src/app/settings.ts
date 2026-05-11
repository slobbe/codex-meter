import Gio from "gi://Gio";

export const SETTINGS_SHOW_PRIMARY = "show-primary";
export const SETTINGS_SHOW_SECONDARY = "show-secondary";
export const SETTINGS_TOP_BAR_DISPLAY_MODE = "top-bar-display-mode";
export const SETTINGS_TOP_BAR_INDICATOR_ICON = "top-bar-indicator-icon";
export const SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES =
    "background-refresh-interval-minutes";

export const MIN_REFRESH_INTERVAL_MINUTES = 0;

export type TopBarDisplayMode = "percentages" | "bars" | "unified";
export type TopBarIndicatorIcon = "text" | "codex" | "openai";

export type ExtensionSettings = {
    showPrimary: boolean;
    showSecondary: boolean;
    topBarDisplayMode: TopBarDisplayMode;
    topBarIndicatorIcon: TopBarIndicatorIcon;
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
            topBarDisplayMode: this.getTopBarDisplayMode(),
            topBarIndicatorIcon: this.getTopBarIndicatorIcon(),
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

    getTopBarDisplayMode(): TopBarDisplayMode {
        const value = this.settings.get_string(SETTINGS_TOP_BAR_DISPLAY_MODE);

        if (value === "bars" || value === "unified") {
            return value;
        }

        return "percentages";
    }

    getTopBarIndicatorIcon(): TopBarIndicatorIcon {
        const value = this.settings.get_string(SETTINGS_TOP_BAR_INDICATOR_ICON);

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
