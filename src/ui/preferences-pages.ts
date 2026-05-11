import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";

import {
    MIN_REFRESH_INTERVAL_MINUTES,
    SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES,
    SETTINGS_SHOW_FIVE_HOUR,
    SETTINGS_SHOW_WEEKLY,
    SETTINGS_TOP_BAR_DISPLAY_MODE,
    SETTINGS_TOP_BAR_INDICATOR_ICON,
    type TopBarIndicatorIcon,
    type TopBarDisplayMode,
} from "../app/settings.js";

type Metadata = Record<string, any>;
type ShellVersions = unknown;

export const DisplayPage = GObject.registerClass(
    class DisplayPage extends Adw.PreferencesPage {
        _init(settings: Gio.Settings) {
            super._init({
                title: "Preferences",
                icon_name: "preferences-system-symbolic",
            });

            this.add(createTopBarGroup(settings));
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

function createTopBarGroup(settings: Gio.Settings) {
    const group = new Adw.PreferencesGroup({
        title: "Top Panel",
        description: "Choose what the top panel shows.",
    });

    group.add(createTopBarIndicatorIconRow(settings));
    group.add(createTopBarStyleRow(settings));
    group.add(
        createBoundSwitchRow({
            settings,
            key: SETTINGS_SHOW_FIVE_HOUR,
            title: "Show session (5h) usage",
        }),
    );
    group.add(
        createBoundSwitchRow({
            settings,
            key: SETTINGS_SHOW_WEEKLY,
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

function createTopBarStyleRow(settings: Gio.Settings) {
    const row = new Adw.ComboRow({
        title: "Usage indicator style",
        model: Gtk.StringList.new([
            "Percentages",
            "Progress bars",
            "Unified bar",
        ]),
        selected: getTopBarDisplayModeIndex(
            settings.get_string(SETTINGS_TOP_BAR_DISPLAY_MODE),
        ),
    });

    row.connect("notify::selected", () => {
        settings.set_string(
            SETTINGS_TOP_BAR_DISPLAY_MODE,
            getTopBarDisplayModeValue(row.selected),
        );
    });

    settings.connect(`changed::${SETTINGS_TOP_BAR_DISPLAY_MODE}`, () => {
        row.selected = getTopBarDisplayModeIndex(
            settings.get_string(SETTINGS_TOP_BAR_DISPLAY_MODE),
        );
    });

    return row;
}

function createTopBarIndicatorIconRow(settings: Gio.Settings) {
    const row = new Adw.ComboRow({
        title: "Icon",
        model: Gtk.StringList.new(["Shortcode", "Codex icon", "OpenAI icon"]),
        selected: getTopBarIndicatorIconIndex(
            settings.get_string(SETTINGS_TOP_BAR_INDICATOR_ICON),
        ),
    });

    row.connect("notify::selected", () => {
        settings.set_string(
            SETTINGS_TOP_BAR_INDICATOR_ICON,
            getTopBarIndicatorIconValue(row.selected),
        );
    });

    settings.connect(`changed::${SETTINGS_TOP_BAR_INDICATOR_ICON}`, () => {
        row.selected = getTopBarIndicatorIconIndex(
            settings.get_string(SETTINGS_TOP_BAR_INDICATOR_ICON),
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
            label: `<span size="small">This program comes with absolutely no warranty.\nSee the <a href="${metadata.url + '/blob/main/LICENSE'}">${ metadata.license ?? 'GNU General Public License, version 3 or later'}</a> for details.</span>`,
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

function getTopBarDisplayModeIndex(value: string) {
    switch (value as TopBarDisplayMode) {
        case "bars":
            return 1;
        case "unified":
            return 2;
        default:
            return 0;
    }
}

function getTopBarDisplayModeValue(selected: number): TopBarDisplayMode {
    switch (selected) {
        case 1:
            return "bars";
        case 2:
            return "unified";
        default:
            return "percentages";
    }
}

function getTopBarIndicatorIconIndex(value: string) {
    if (value === "codex" || value === "icon") return 1;
    if (value === "openai") return 2;

    return 0;
}

function getTopBarIndicatorIconValue(selected: number): TopBarIndicatorIcon {
    if (selected === 1) return "codex";
    if (selected === 2) return "openai";

    return "text";
}
