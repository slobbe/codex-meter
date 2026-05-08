import Gio from "gi://Gio";

export const SETTINGS_SHOW_FIVE_HOUR = "show-five-hour";
export const SETTINGS_SHOW_WEEKLY = "show-weekly";
export const SETTINGS_TOP_BAR_DISPLAY_MODE = "top-bar-display-mode";
export const SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES =
    "background-refresh-interval-minutes";

export const MIN_REFRESH_INTERVAL_MINUTES = 0;

export type TopBarDisplayMode = "percentages" | "bars" | "unified";

export type ExtensionSettings = {
    showFiveHour: boolean;
    showWeekly: boolean;
    topBarDisplayMode: TopBarDisplayMode;
    backgroundRefreshIntervalMinutes: number;
    backgroundRefreshIntervalSeconds: number;
};

export class SettingsService {
    constructor(private readonly settings: Gio.Settings) {}

    getAll(): ExtensionSettings {
        const backgroundRefreshIntervalMinutes =
            this.getBackgroundRefreshIntervalMinutes();

        return {
            showFiveHour: this.getShowFiveHour(),
            showWeekly: this.getShowWeekly(),
            topBarDisplayMode: this.getTopBarDisplayMode(),
            backgroundRefreshIntervalMinutes,
            backgroundRefreshIntervalSeconds:
                backgroundRefreshIntervalMinutes * 60,
        };
    }

    getShowFiveHour(): boolean {
        return this.settings.get_boolean(SETTINGS_SHOW_FIVE_HOUR);
    }

    getShowWeekly(): boolean {
        return this.settings.get_boolean(SETTINGS_SHOW_WEEKLY);
    }

    getTopBarDisplayMode(): TopBarDisplayMode {
        const value = this.settings.get_string(SETTINGS_TOP_BAR_DISPLAY_MODE);

        if (value === "bars" || value === "unified") {
            return value;
        }

        return "percentages";
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
