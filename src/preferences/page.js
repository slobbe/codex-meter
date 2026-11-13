import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";
import { getUsageWindowMetadata, sortUsageQuotas } from "../codex/usage/model.js";
import {
    migrateSettings,
    MIN_REFRESH_INTERVAL_MINUTES,
    SETTINGS_AUTO_APPLY_BANKED_RESET,
    SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE,
    SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_THRESHOLD,
    SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW,
    SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES,
    SETTINGS_PERCENT_DISPLAY_MODE,
    SETTINGS_TOP_PANEL_DISPLAY_MODE,
    SETTINGS_TOP_PANEL_INDICATOR_ICON,
} from "./settings.js";

export function createPreferencesPage(settings, metadata, window, snapshot = null) {
    migrateSettings(settings);
    const settingsSignalIds = [];
    const page = new Adw.PreferencesPage({
        title: "Codex Meter",
        icon_name: "codex-symbolic",
    });
    page.add(createBehaviorGroup(settings, settingsSignalIds));
    page.add(createTopPanelGroup(settings, settingsSignalIds));
    page.add(createBankedResetsGroup(settings, settingsSignalIds, snapshot?.quotas ?? []));
    page.add(createFooterGroup(metadata));
    window.connect("close-request", () => {
        for (const id of settingsSignalIds.splice(0)) {
            settings.disconnect(id);
        }
        return false;
    });
    return page;
}

function createBankedResetsGroup(settings, settingsSignalIds, quotas) {
    const group = new Adw.PreferencesGroup({ title: "Banked resets" });
    group.add(
        createBoundSwitchRow({
            settings,
            key: SETTINGS_AUTO_APPLY_BANKED_RESET,
            title: "Auto-redeem expiring resets",
            subtitle: "Redeem a banked reset automatically within 1 hour of expiry",
        }),
    );
    group.add(
        createBoundSwitchRow({
            settings,
            key: SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE,
            title: "Auto-redeem on low remaining usage",
            subtitle: "Redeem a reset if remaining usage falls below threshold",
        }),
    );
    group.add(createUsageWindowRow(settings, settingsSignalIds, quotas));
    group.add(createUsageThresholdRow(settings, settingsSignalIds));

    return group;
}

function createUsageWindowRow(settings, settingsSignalIds, quotas) {
    const key = SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW;
    const options = [
        ["Any", "any"],
        ...sortUsageQuotas(quotas).map((quota) => [
            quota.limitWindowSeconds != null
                ? getUsageWindowMetadata(quota.limitWindowSeconds).label
                : quota.label,
            quota.id,
        ]),
    ];
    const row = new Adw.ComboRow({
        title: "Usage Window",
        subtitle: "Apply auto-redemption only to selected usage window",
    });
    let currentOptions;
    let updating = false;
    const update = () => {
        updating = true;
        const value = settings.get_string(key);
        currentOptions = [...options];
        if (!currentOptions.some(([, id]) => id === value)) {
            currentOptions.push([`${value} (unavailable)`, value]);
        }
        row.model = Gtk.StringList.new(currentOptions.map(([label]) => label));
        row.selected = currentOptions.findIndex(([, id]) => id === value);
        updating = false;
    };
    update();
    row.connect("notify::selected", () => {
        if (!updating && currentOptions[row.selected]) {
            settings.set_string(key, currentOptions[row.selected][1]);
        }
    });
    settingsSignalIds.push(settings.connect(`changed::${key}`, update));
    settings.bind(
        SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE,
        row,
        "sensitive",
        Gio.SettingsBindFlags.GET,
    );
    return row;
}

function createUsageThresholdRow(settings, settingsSignalIds) {
    const key = SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_THRESHOLD;
    const row = new Adw.SpinRow({
        title: "Threshold (% left)",
        subtitle: "Threshold below which to redeem reset",
        adjustment: new Gtk.Adjustment({
            lower: 1,
            upper: 100,
            step_increment: 1,
            page_increment: 5,
            value: settings.get_uint(key),
        }),
        climb_rate: 1,
        digits: 0,
    });
    row.connect("notify::value", () => {
        settings.set_uint(key, Math.min(100, Math.max(1, Math.round(row.value))));
    });
    settingsSignalIds.push(
        settings.connect(`changed::${key}`, () => {
            row.value = settings.get_uint(key);
        }),
    );
    settings.bind(
        SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE,
        row,
        "sensitive",
        Gio.SettingsBindFlags.GET,
    );
    return row;
}

function createTopPanelGroup(settings, settingsSignalIds) {
    const group = new Adw.PreferencesGroup({
        title: "Top panel indicator",
    });
    group.add(
        createBoundComboRow({
            settings,
            settingsSignalIds,
            key: SETTINGS_TOP_PANEL_INDICATOR_ICON,
            title: "Icon",
            options: [
                ["OpenAI logo", "openai"],
                ["Codex logo", "codex"],
                ["'CX' monogram", "text"],
            ],
        }),
    );
    group.add(
        createBoundComboRow({
            settings,
            settingsSignalIds,
            key: SETTINGS_TOP_PANEL_DISPLAY_MODE,
            title: "Show percentages as",
            options: [
                ["Progress bar", "bars"],
                ["Circular progress bars", "circular-bars"],
                ["Number", "percentages"],
            ],
        }),
    );

    return group;
}

function createBehaviorGroup(settings, settingsSignalIds) {
    const group = new Adw.PreferencesGroup({
        title: "Behavior",
    });
    group.add(
        createBoundComboRow({
            settings,
            settingsSignalIds,
            key: SETTINGS_PERCENT_DISPLAY_MODE,
            title: "Display mode",
            options: [
                ["Percent used", "used"],
                ["Percent left", "left"],
            ],
        }),
    );
    group.add(createRefreshIntervalRow(settings, settingsSignalIds));
    return group;
}

function createBoundComboRow({ settings, settingsSignalIds, key, title, options }) {
    const getSelected = () =>
        Math.max(
            0,
            options.findIndex(([, value]) => value === settings.get_string(key)),
        );
    const row = new Adw.ComboRow({
        title,
        model: Gtk.StringList.new(options.map(([label]) => label)),
        selected: getSelected(),
    });
    row.connect("notify::selected", () => settings.set_string(key, options[row.selected][1]));
    settingsSignalIds.push(
        settings.connect(`changed::${key}`, () => {
            row.selected = getSelected();
        }),
    );
    return row;
}

function createBoundSwitchRow({ settings, key, title, subtitle }) {
    const rowOptions = {
        title,
    };
    if (subtitle !== undefined) {
        rowOptions.subtitle = subtitle;
    }
    const row = new Adw.SwitchRow(rowOptions);
    settings.bind(key, row, "active", Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function createRefreshIntervalRow(settings, settingsSignalIds) {
    const row = new Adw.SpinRow({
        title: "Background refresh interval (minutes)",
        subtitle: "Set to 0 to refresh manually",
        adjustment: new Gtk.Adjustment({
            lower: MIN_REFRESH_INTERVAL_MINUTES,
            upper: 60,
            step_increment: 1,
            page_increment: 5,
            value: settings.get_uint(SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES),
        }),
        climb_rate: 1,
        digits: 0,
    });
    row.connect("notify::value", () => {
        settings.set_uint(
            SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES,
            Math.max(MIN_REFRESH_INTERVAL_MINUTES, Math.round(row.value)),
        );
    });
    settingsSignalIds.push(
        settings.connect(`changed::${SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES}`, () => {
            row.value = settings.get_uint(SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES);
        }),
    );
    return row;
}

function createFooterGroup(metadata) {
    const footerGroup = new Adw.PreferencesGroup();
    const footerBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 4,
        margin_top: 12,
        margin_bottom: 12,
    });
    footerBox.append(
        new Gtk.Label({
            label: `${metadata.name} ${metadata["version-name"]}`,
            css_classes: ["caption", "dim-label"],
        }),
    );
    footerBox.append(
        new Gtk.Label({
            label: "Not affiliated with or endorsed by OpenAI.",
            wrap: true,
            justify: Gtk.Justification.CENTER,
            css_classes: ["caption", "dim-label"],
        }),
    );
    const links = new Gtk.Label({
        css_classes: ["caption", "dim-label"],
    });
    links.set_markup(
        `<a href="${metadata.url}">Source code</a> · <a href="${metadata.url}/issues">Report a bug</a>`,
    );
    footerBox.append(links);
    footerGroup.add(footerBox);
    return footerGroup;
}
