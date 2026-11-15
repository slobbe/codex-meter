import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import { getCodexCredentials } from "../codex/auth/auth.js";
import { isCodexError } from "../codex/error.js";
import { getUsageWindowMetadata, sortUsageQuotas } from "../codex/usage/model.js";
import {
    DEFAULT_CREDENTIALS_PATH,
    migrateSettings,
    MIN_REFRESH_INTERVAL_MINUTES,
    SETTINGS_AUTO_APPLY_BANKED_RESET,
    SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE,
    SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_THRESHOLD,
    SETTINGS_AUTO_APPLY_BANKED_RESET_USAGE_WINDOW,
    SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES,
    SETTINGS_CREDENTIALS_PATH,
    SETTINGS_PERCENT_DISPLAY_MODE,
    SETTINGS_TOP_PANEL_DISPLAY_MODE,
    SETTINGS_TOP_PANEL_INDICATOR_ICON,
    SETTINGS_USAGE_NOTIFICATIONS,
    SETTINGS_USAGE_NOTIFICATION_THRESHOLD,
} from "./settings.js";

export function createPreferencesPage(settings, metadata, window, snapshot = null) {
    migrateSettings(settings);
    const settingsSignalIds = [];
    const page = new Adw.PreferencesPage({
        title: "Codex Meter",
        icon_name: "codex-symbolic",
    });
    page.add(createAppearanceGroup(settings, settingsSignalIds));
    page.add(createBackgroundRefreshGroup(settings, settingsSignalIds));
    page.add(createBankedResetsGroup(settings, settingsSignalIds, snapshot?.quotas ?? []));
    const credentials = createCredentialsGroup(settings, settingsSignalIds, window);
    page.add(credentials.group);
    page.add(createNotificationsGroup(settings, settingsSignalIds));
    page.add(createFooterGroup(metadata));
    window.connect("close-request", () => {
        credentials.cleanup();
        for (const id of settingsSignalIds.splice(0)) {
            settings.disconnect(id);
        }
        return false;
    });
    return page;
}

function createCredentialsGroup(settings, settingsSignalIds, window) {
    const group = new Adw.PreferencesGroup({ title: "Credentials" });
    const row = new Adw.ActionRow({
        title: "Credentials file",
        subtitle_selectable: true,
        use_markup: false,
    });
    const browse = new Gtk.Button({ label: "Browse…", valign: Gtk.Align.CENTER });
    const reset = new Gtk.Button({
        icon_name: "edit-undo-symbolic",
        tooltip_text: "Reset to default credentials file",
        valign: Gtk.Align.CENTER,
    });
    row.add_suffix(browse);
    row.add_suffix(reset);
    group.add(row);
    const errorLabel = new Gtk.Label({
        visible: false,
        wrap: true,
        xalign: 0,
        margin_top: 6,
        css_classes: ["error"],
    });
    group.add(errorLabel);

    let closed = false;
    let validationCancellable = null;
    const clearValidation = () => {
        validationCancellable?.cancel();
        validationCancellable = null;
        errorLabel.visible = false;
        errorLabel.label = "";
    };
    const validateSelection = async (path) => {
        clearValidation();
        const cancellable = new Gio.Cancellable();
        validationCancellable = cancellable;
        try {
            await getCodexCredentials(cancellable, path);
            if (closed || cancellable.is_cancelled() || validationCancellable !== cancellable)
                return;
            settings.set_string(SETTINGS_CREDENTIALS_PATH, path);
        } catch (error) {
            if (closed || cancellable.is_cancelled() || validationCancellable !== cancellable)
                return;
            errorLabel.label = isCodexError(error)
                ? error.message
                : "Could not verify this file. Select a readable Codex credentials file.";
            errorLabel.visible = true;
        } finally {
            if (validationCancellable === cancellable) validationCancellable = null;
        }
    };

    const resolvePath = (path) =>
        path.startsWith("~/") ? GLib.build_filenamev([GLib.get_home_dir(), path.slice(2)]) : path;
    const update = () => {
        clearValidation();
        const path = settings.get_string(SETTINGS_CREDENTIALS_PATH);
        row.subtitle = path;
        reset.sensitive = resolvePath(path) !== resolvePath(DEFAULT_CREDENTIALS_PATH);
    };
    update();
    settingsSignalIds.push(settings.connect(`changed::${SETTINGS_CREDENTIALS_PATH}`, update));

    let dialog = null;
    let responseSignalId = null;
    const destroyDialog = () => {
        if (!dialog) return;
        const current = dialog;
        dialog = null;
        current.disconnect(responseSignalId);
        responseSignalId = null;
        current.destroy();
    };
    const browseSignalId = browse.connect("clicked", () => {
        if (closed) return;
        clearValidation();
        if (dialog) {
            dialog.show();
            return;
        }
        dialog = new Gtk.FileChooserNative({
            title: "Select credentials file",
            transient_for: window,
            modal: true,
            action: Gtk.FileChooserAction.OPEN,
            accept_label: "Select",
            cancel_label: "Cancel",
        });
        const filter = new Gtk.FileFilter({ name: "JSON files (*.json)" });
        filter.add_pattern("*.json");
        dialog.add_filter(filter);
        dialog.set_filter(filter);
        dialog.set_file(
            Gio.File.new_for_path(resolvePath(settings.get_string(SETTINGS_CREDENTIALS_PATH))),
        );
        responseSignalId = dialog.connect("response", (chooser, response) => {
            if (closed || chooser !== dialog) return;
            const path =
                response === Gtk.ResponseType.ACCEPT ? chooser.get_file()?.get_path() : null;
            destroyDialog();
            if (path) void validateSelection(path);
        });
        dialog.show();
    });
    const resetSignalId = reset.connect("clicked", () => {
        if (closed) return;
        clearValidation();
        settings.reset(SETTINGS_CREDENTIALS_PATH);
    });
    return {
        group,
        cleanup() {
            if (closed) return;
            closed = true;
            clearValidation();
            destroyDialog();
            browse.disconnect(browseSignalId);
            reset.disconnect(resetSignalId);
        },
    };
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

function createNotificationsGroup(settings, settingsSignalIds) {
    const group = new Adw.PreferencesGroup({ title: "Notifications" });
    group.add(
        createBoundSwitchRow({
            settings,
            key: SETTINGS_USAGE_NOTIFICATIONS,
            title: "Usage notifications",
            subtitle: "Notify when remaining usage is low or exhausted",
        }),
    );
    const key = SETTINGS_USAGE_NOTIFICATION_THRESHOLD;
    const row = new Adw.SpinRow({
        title: "Warning threshold (% left)",
        subtitle: "Warn when remaining usage reaches this threshold",
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
    settings.bind(SETTINGS_USAGE_NOTIFICATIONS, row, "sensitive", Gio.SettingsBindFlags.GET);
    group.add(row);
    return group;
}

function createAppearanceGroup(settings, settingsSignalIds) {
    const group = new Adw.PreferencesGroup({
        title: "Appearance",
    });
    group.add(
        createBoundComboRow({
            settings,
            settingsSignalIds,
            key: SETTINGS_PERCENT_DISPLAY_MODE,
            title: "Percentage meaning",
            subtitle: "Show remaining or used capacity",
            options: [
                ["% left", "left"],
                ["% used", "used"],
            ],
        }),
    );
    group.add(
        createBoundComboRow({
            settings,
            settingsSignalIds,
            key: SETTINGS_TOP_PANEL_INDICATOR_ICON,
            title: "Indicator icon",
            subtitle: "Icon shown in the top panel",
            options: [
                ["Codex", "codex"],
                ["OpenAI", "openai"],
                ["'CX' monogram", "text"],
            ],
        }),
    );
    group.add(
        createBoundComboRow({
            settings,
            settingsSignalIds,
            key: SETTINGS_TOP_PANEL_DISPLAY_MODE,
            title: "Indicator progress style",
            subtitle: "How usage appears in the top panel",
            options: [
                ["Bar", "bars"],
                ["Circle", "circular-bars"],
                ["Number", "percentages"],
            ],
        }),
    );

    return group;
}

function createBackgroundRefreshGroup(settings, settingsSignalIds) {
    const group = new Adw.PreferencesGroup({
        title: "Background refresh",
    });
    group.add(createRefreshIntervalRow(settings, settingsSignalIds));
    return group;
}

function createBoundComboRow({ settings, settingsSignalIds, key, title, subtitle, options }) {
    const getSelected = () =>
        Math.max(
            0,
            options.findIndex(([, value]) => value === settings.get_string(key)),
        );
    const row = new Adw.ComboRow({
        title,
        subtitle,
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
        title: "Interval (minutes)",
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
