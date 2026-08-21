import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";
import { MIN_REFRESH_INTERVAL_MINUTES, SETTINGS_AUTO_APPLY_BANKED_RESET, SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES, SETTINGS_PERCENT_DISPLAY_MODE, SETTINGS_SHOW_PRIMARY, SETTINGS_SHOW_SECONDARY, SETTINGS_TOP_PANEL_DISPLAY_MODE, SETTINGS_TOP_PANEL_INDICATOR_ICON, } from "../config/settings.js";
export const PreferencesPage = GObject.registerClass(class PreferencesPage extends Adw.PreferencesPage {
    _init(settings, snapshot, metadata) {
        super._init({
            title: "Codex Meter",
            icon_name: "codex-symbolic",
        });
        this.add(createBehaviorGroup(settings));
        this.add(createTopPanelGroup(settings));
        this.add(createBankedResetsGroup(settings, snapshot));
        this.add(createFooterGroup(metadata));
    }
});
function createBankedResetsGroup(settings, snapshot) {
    const group = new Adw.PreferencesGroup({ title: "Banked resets" });
    group.add(createBoundSwitchRow({
        settings,
        key: SETTINGS_AUTO_APPLY_BANKED_RESET,
        title: "Auto-apply expiring resets",
        subtitle: "Apply a banked reset automatically within 1 hour of expiry",
    }));
    if (!snapshot) {
        group.add(new Adw.ActionRow({ title: getNoCodexCreditSnapshotMessage() }));
        return group;
    }
    if (snapshot.credits.length === 0) {
        group.add(new Adw.ActionRow({
            title: "No banked Codex resets are available.",
        }));
        return group;
    }
    for (const credit of snapshot.credits) {
        group.add(createCreditRow(credit));
    }
    return group;
}
function createCreditRow(credit) {
    const row = new Adw.PreferencesRow();
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
        margin_top: 12,
        margin_bottom: 12,
        margin_start: 12,
        margin_end: 12,
    });
    const titleRow = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 12,
    });
    const title = new Gtk.Label({
        label: createCreditTitle(credit),
        xalign: 0,
        wrap: true,
        hexpand: true,
        halign: Gtk.Align.FILL,
    });
    const description = new Gtk.Label({
        label: credit.description ?? "",
        xalign: 0,
        wrap: true,
        hexpand: true,
        halign: Gtk.Align.FILL,
    });
    const status = new Gtk.Label({
        label: formatCreditStatus(credit),
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.END,
    });
    const dates = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 12,
    });
    const granted = new Gtk.Label({
        label: `Granted ${formatCreditDate(credit.granted_at)}`,
        xalign: 0,
        hexpand: true,
        halign: Gtk.Align.FILL,
    });
    const expires = new Gtk.Label({
        label: `Expires ${formatCreditDate(credit.expires_at)}`,
        xalign: 1,
        halign: Gtk.Align.END,
    });
    title.add_css_class("heading");
    description.add_css_class("dim-label");
    granted.add_css_class("dim-label");
    expires.add_css_class("dim-label");
    status.add_css_class("dim-label");
    titleRow.append(title);
    titleRow.append(status);
    dates.append(granted);
    dates.append(expires);
    box.append(titleRow);
    box.append(description);
    box.append(dates);
    row.set_child(box);
    return row;
}
function getNoCodexCreditSnapshotMessage() {
    return "No Codex credit snapshot is available yet. It will appear after the next successful panel refresh.";
}
function createCreditTitle(credit) {
    const title = credit.title || "Codex rate limit reset";
    return credit.profile_user_id ? `${title} from ${credit.profile_user_id}` : title;
}
function formatCreditDate(value) {
    if (!value)
        return "Unknown";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()))
        return "Unknown";
    return date.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
}
function formatCreditStatus(credit) {
    return credit.status === "available" ? "Available" : credit.status;
}
function createTopPanelGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: "Top panel indicator",
    });
    group.add(createTopPanelIndicatorIconRow(settings));
    group.add(createTopPanelStyleRow(settings));
    group.add(createBoundSwitchRow({
        settings,
        key: SETTINGS_SHOW_PRIMARY,
        title: "Display 5-hour session usage",
    }));
    group.add(createBoundSwitchRow({
        settings,
        key: SETTINGS_SHOW_SECONDARY,
        title: "Display weekly usage",
    }));
    return group;
}
function createBehaviorGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: "Behavior",
    });
    group.add(createPercentDisplayModeRow(settings));
    group.add(createRefreshIntervalRow(settings));
    return group;
}
function createTopPanelStyleRow(settings) {
    const row = new Adw.ComboRow({
        title: "Show percentages as",
        model: Gtk.StringList.new([
            "Progress bars",
            "Raw percentages",
        ]),
        selected: getTopPanelDisplayModeIndex(settings.get_string(SETTINGS_TOP_PANEL_DISPLAY_MODE)),
    });
    row.connect("notify::selected", () => {
        settings.set_string(SETTINGS_TOP_PANEL_DISPLAY_MODE, getTopPanelDisplayModeValue(row.selected));
    });
    settings.connect(`changed::${SETTINGS_TOP_PANEL_DISPLAY_MODE}`, () => {
        row.selected = getTopPanelDisplayModeIndex(settings.get_string(SETTINGS_TOP_PANEL_DISPLAY_MODE));
    });
    return row;
}
function createPercentDisplayModeRow(settings) {
    const row = new Adw.ComboRow({
        title: "Display mode",
        model: Gtk.StringList.new(["Percent used", "Percent left"]),
        selected: getPercentDisplayModeIndex(settings.get_string(SETTINGS_PERCENT_DISPLAY_MODE)),
    });
    row.connect("notify::selected", () => {
        settings.set_string(SETTINGS_PERCENT_DISPLAY_MODE, getPercentDisplayModeValue(row.selected));
    });
    settings.connect(`changed::${SETTINGS_PERCENT_DISPLAY_MODE}`, () => {
        row.selected = getPercentDisplayModeIndex(settings.get_string(SETTINGS_PERCENT_DISPLAY_MODE));
    });
    return row;
}
function createTopPanelIndicatorIconRow(settings) {
    const row = new Adw.ComboRow({
        title: "Icon",
        model: Gtk.StringList.new(["Codex icon", "OpenAI icon", "CX shortcode"]),
        selected: getTopPanelIndicatorIconIndex(settings.get_string(SETTINGS_TOP_PANEL_INDICATOR_ICON)),
    });
    row.connect("notify::selected", () => {
        settings.set_string(SETTINGS_TOP_PANEL_INDICATOR_ICON, getTopPanelIndicatorIconValue(row.selected));
    });
    settings.connect(`changed::${SETTINGS_TOP_PANEL_INDICATOR_ICON}`, () => {
        row.selected = getTopPanelIndicatorIconIndex(settings.get_string(SETTINGS_TOP_PANEL_INDICATOR_ICON));
    });
    return row;
}
function createBoundSwitchRow({ settings, key, title, subtitle, }) {
    const rowOptions = {
        title,
        active: settings.get_boolean(key),
    };
    if (subtitle !== undefined) {
        rowOptions.subtitle = subtitle;
    }
    const row = new Adw.SwitchRow(rowOptions);
    settings.bind(key, row, "active", Gio.SettingsBindFlags.DEFAULT);
    return row;
}
function createRefreshIntervalRow(settings) {
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
        settings.set_uint(SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES, Math.max(MIN_REFRESH_INTERVAL_MINUTES, Math.round(row.value)));
    });
    settings.connect(`changed::${SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES}`, () => {
        row.value = settings.get_uint(SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES);
    });
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
    footerBox.append(new Gtk.Label({
        label: `${metadata.name} v${metadata["version-name"]}`,
        css_classes: ["caption", "dim-label"],
    }));
    footerBox.append(new Gtk.Label({
        label: "Not affiliated with or endorsed by OpenAI.",
        wrap: true,
        justify: Gtk.Justification.CENTER,
        css_classes: ["caption", "dim-label"],
    }));
    const links = new Gtk.Label({
        css_classes: ["caption", "dim-label"],
    });
    links.set_markup(`<a href="${metadata.url}">Source code</a> · <a href="${metadata.url}/issues">Report a bug</a>`);
    footerBox.append(links);
    footerGroup.add(footerBox);
    return footerGroup;
}
function getTopPanelDisplayModeIndex(value) {
    switch (value) {
        case "percentages":
            return 1;
        default:
            return 0;
    }
}
function getTopPanelDisplayModeValue(selected) {
    switch (selected) {
        case 1:
            return "percentages";
        default:
            return "bars";
    }
}
function getTopPanelIndicatorIconIndex(value) {
    if (value === "openai")
        return 1;
    if (value === "text")
        return 2;
    return 0;
}
function getTopPanelIndicatorIconValue(selected) {
    if (selected === 1)
        return "openai";
    if (selected === 2)
        return "text";
    return "codex";
}
function getPercentDisplayModeIndex(value) {
    return value === "left" ? 1 : 0;
}
function getPercentDisplayModeValue(selected) {
    return selected === 1 ? "left" : "used";
}
