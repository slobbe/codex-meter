import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";

import {
    MIN_REFRESH_INTERVAL_MINUTES,
    SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES,
    SETTINGS_PERCENT_DISPLAY_MODE,
    SETTINGS_SHOW_PRIMARY,
    SETTINGS_SHOW_SECONDARY,
    SETTINGS_TOP_PANEL_DISPLAY_MODE,
    SETTINGS_TOP_PANEL_INDICATOR_ICON,
    type PercentDisplayMode,
    type TopPanelIndicatorIcon,
    type TopPanelDisplayMode,
} from "../app/settings.js";

type Metadata = Record<string, any>;
type ShellVersions = unknown;

export const DisplayPage = GObject.registerClass(
    class DisplayPage extends Adw.PreferencesPage {
        _init(settings: Gio.Settings) {
            super._init({
                title: "Options",
                icon_name: "preferences-system-symbolic",
            });

            this.add(createTopPanelGroup(settings));
            this.add(createRefreshGroup(settings));
        }
    },
);

export const AboutPage = GObject.registerClass(
    class AboutPage extends Adw.PreferencesPage {
        _init(metadata: Metadata) {
            super._init({
                title: "About",
                icon_name: "help-about-symbolic",
            });

            this.add(createAboutHeaderGroup(metadata));
            this.add(createAboutInfoGroup(metadata));
            this.add(createLegalGroup(metadata));
        }
    },
);

function createTopPanelGroup(settings: Gio.Settings) {
    const group = new Adw.PreferencesGroup({
        title: "Top Panel",
        description: "Choose what the top panel shows.",
    });

    group.add(createTopPanelIndicatorIconRow(settings));
    group.add(createTopPanelStyleRow(settings));
    group.add(createPercentDisplayModeRow(settings));
    group.add(
        createBoundSwitchRow({
            settings,
            key: SETTINGS_SHOW_PRIMARY,
            title: "Show session (5h) usage",
        }),
    );
    group.add(
        createBoundSwitchRow({
            settings,
            key: SETTINGS_SHOW_SECONDARY,
            title: "Show weekly usage",
        }),
    );

    return group;
}

function createRefreshGroup(settings: Gio.Settings) {
    const group = new Adw.PreferencesGroup({
        title: "Background Refresh",
        description: "Control how often the extension refreshes usage data.",
    });

    group.add(createRefreshIntervalRow(settings));

    return group;
}

function createTopPanelStyleRow(settings: Gio.Settings) {
    const row = new Adw.ComboRow({
        title: "Usage indicator style",
        model: Gtk.StringList.new([
            "Percentages",
            "Progress bars",
            "Unified bar",
        ]),
        selected: getTopPanelDisplayModeIndex(
            settings.get_string(SETTINGS_TOP_PANEL_DISPLAY_MODE),
        ),
    });

    row.connect("notify::selected", () => {
        settings.set_string(
            SETTINGS_TOP_PANEL_DISPLAY_MODE,
            getTopPanelDisplayModeValue(row.selected),
        );
    });

    settings.connect(`changed::${SETTINGS_TOP_PANEL_DISPLAY_MODE}`, () => {
        row.selected = getTopPanelDisplayModeIndex(
            settings.get_string(SETTINGS_TOP_PANEL_DISPLAY_MODE),
        );
    });

    return row;
}

function createPercentDisplayModeRow(settings: Gio.Settings) {
    const row = new Adw.ComboRow({
        title: "Percentage display",
        model: Gtk.StringList.new(["Used", "Left"]),
        selected: getPercentDisplayModeIndex(
            settings.get_string(SETTINGS_PERCENT_DISPLAY_MODE),
        ),
    });

    row.connect("notify::selected", () => {
        settings.set_string(
            SETTINGS_PERCENT_DISPLAY_MODE,
            getPercentDisplayModeValue(row.selected),
        );
    });

    settings.connect(`changed::${SETTINGS_PERCENT_DISPLAY_MODE}`, () => {
        row.selected = getPercentDisplayModeIndex(
            settings.get_string(SETTINGS_PERCENT_DISPLAY_MODE),
        );
    });

    return row;
}

function createTopPanelIndicatorIconRow(settings: Gio.Settings) {
    const row = new Adw.ComboRow({
        title: "Icon",
        model: Gtk.StringList.new(["Shortcode", "Codex icon", "OpenAI icon"]),
        selected: getTopPanelIndicatorIconIndex(
            settings.get_string(SETTINGS_TOP_PANEL_INDICATOR_ICON),
        ),
    });

    row.connect("notify::selected", () => {
        settings.set_string(
            SETTINGS_TOP_PANEL_INDICATOR_ICON,
            getTopPanelIndicatorIconValue(row.selected),
        );
    });

    settings.connect(`changed::${SETTINGS_TOP_PANEL_INDICATOR_ICON}`, () => {
        row.selected = getTopPanelIndicatorIconIndex(
            settings.get_string(SETTINGS_TOP_PANEL_INDICATOR_ICON),
        );
    });

    return row;
}

function createBoundSwitchRow({
    settings,
    key,
    title,
}: {
    settings: Gio.Settings;
    key: string;
    title: string;
}) {
    const row = new Adw.SwitchRow({
        title,
        active: settings.get_boolean(key),
    });

    settings.bind(key, row, "active", Gio.SettingsBindFlags.DEFAULT);

    return row;
}

function createRefreshIntervalRow(settings: Gio.Settings) {
    const row = new Adw.SpinRow({
        title: "Refresh interval (min)",
        subtitle: "Set to 0 for manual refresh",
        adjustment: new Gtk.Adjustment({
            lower: MIN_REFRESH_INTERVAL_MINUTES,
            upper: 60,
            step_increment: 1,
            page_increment: 5,
            value: settings.get_uint(
                SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES,
            ),
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

    settings.connect(
        `changed::${SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES}`,
        () => {
            row.value = settings.get_uint(
                SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES,
            );
        },
    );

    return row;
}

function createAboutHeaderGroup(metadata: Metadata) {
    const group = new Adw.PreferencesGroup();
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        margin_top: 18,
        margin_bottom: 12,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
    });

    box.append(
        new Gtk.Label({
            label: `<span size="x-large"><b>${escapeMarkup(metadata.name ?? "Codex Meter")}</b></span>`,
            use_markup: true,
            justify: Gtk.Justification.CENTER,
            halign: Gtk.Align.CENTER,
            margin_bottom: 6,
        }),
    );
    box.append(
        new Gtk.Label({
            label:
                metadata.description ??
                "",
            justify: Gtk.Justification.CENTER,
            wrap: true,
            max_width_chars: 48,
            halign: Gtk.Align.CENTER,
        }),
    );

    group.add(box);

    return group;
}

function createAboutInfoGroup(metadata: Metadata) {
    const group = new Adw.PreferencesGroup();

    group.add(
        createInfoRow(
            "Version",
            metadata["version-name"] ?? `${metadata.version ?? 1}`,
        ),
    );
    group.add(createInfoRow("Created By", "Sebastian Lobbe"));
    group.add(
        createLinkRow("GitHub", metadata.url ?? "https://github.com/slobbe/codex-meter"),
    );
    group.add(
        createLinkRow("Report a Bug", "https://github.com/slobbe/codex-meter/issues"),
    );

    return group;
}

function createLegalGroup(metadata: Metadata) {
    const group = new Adw.PreferencesGroup();
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        margin_top: 6,
        margin_bottom: 12,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.END,
        vexpand: true,
    });

    box.append(
        new Gtk.Label({
            label: `<span size="small">This program comes with absolutely no warranty.\nLicense: <a href="${metadata.url + "/blob/main/LICENSE"}">${metadata.license ?? "GPL-3.0-or-later"}</a></span>`,
            use_markup: true,
            justify: Gtk.Justification.CENTER,
            wrap: true,
            halign: Gtk.Align.CENTER,
        }),
    );

    group.add(box);

    return group;
}

function createInfoRow(title: string, value: string) {
    const row = new Adw.ActionRow({
        title,
        activatable: false,
    });

    row.add_suffix(
        new Gtk.Label({
            label: value,
            selectable: true,
        }),
    );

    return row;
}

function createLinkRow(title: string, url: string) {
    const row = new Adw.ActionRow({
        title,
        activatable: false,
    });

    row.add_suffix(
        new Gtk.LinkButton({
            icon_name: "adw-external-link-symbolic",
            uri: url,
            tooltip_text: url,
            valign: Gtk.Align.CENTER,
        }),
    );

    return row;
}

function escapeMarkup(text: unknown) {
    return `${text}`
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function formatShellVersions(versions: ShellVersions) {
    if (!Array.isArray(versions) || versions.length === 0) return "--";

    return versions.join(", ");
}

function getTopPanelDisplayModeIndex(value: string) {
    switch (value as TopPanelDisplayMode) {
        case "bars":
            return 1;
        case "unified":
            return 2;
        default:
            return 0;
    }
}

function getTopPanelDisplayModeValue(selected: number): TopPanelDisplayMode {
    switch (selected) {
        case 1:
            return "bars";
        case 2:
            return "unified";
        default:
            return "percentages";
    }
}

function getTopPanelIndicatorIconIndex(value: string) {
    if (value === "codex" || value === "icon") return 1;
    if (value === "openai") return 2;

    return 0;
}

function getTopPanelIndicatorIconValue(selected: number): TopPanelIndicatorIcon {
    if (selected === 1) return "codex";
    if (selected === 2) return "openai";

    return "text";
}

function getPercentDisplayModeIndex(value: string) {
    return value === "left" ? 1 : 0;
}

function getPercentDisplayModeValue(selected: number): PercentDisplayMode {
    return selected === 1 ? "left" : "used";
}
