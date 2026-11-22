import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import { getCodexCredentials } from "../codex/auth/auth.js";
import { isCodexError } from "../codex/error.js";
import { getBankedResetSkipMinutes, sortUsageQuotas } from "../codex/usage/model.js";
import { UsageService } from "../codex/usage/service.js";
import { formatDescription } from "./about-content.js";
import {
    DEFAULT_CREDENTIALS_PATH,
    migrateSettings,
    MIN_REFRESH_INTERVAL_MINUTES,
    readBankedResetSkipMinutes,
    SETTINGS_AUTO_APPLY_BANKED_RESET,
    SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE,
    SETTINGS_BACKGROUND_REFRESH_INTERVAL_MINUTES,
    SETTINGS_BANKED_RESET_SKIP_MINUTES,
    SETTINGS_CREDENTIALS_PATH,
    SETTINGS_PERCENT_DISPLAY_MODE,
    SETTINGS_TOP_PANEL_DISPLAY_MODE,
    SETTINGS_TOP_PANEL_INDICATOR_ICON,
    SETTINGS_USAGE_NOTIFICATIONS,
    SETTINGS_USAGE_NOTIFICATION_THRESHOLD,
} from "./settings.js";

/** @param {() => {version: string, markup: string} | null} getReleaseNotes */
export function createPreferencesPage(settings, metadata, window, getReleaseNotes = () => null) {
    migrateSettings(settings);
    const settingsSignalIds = [];
    const page = new Adw.PreferencesPage({
        title: "Codex Meter",
        icon_name: "codex-symbolic",
    });
    page.add(createAppearanceGroup(settings, settingsSignalIds));
    page.add(createNotificationsGroup(settings, settingsSignalIds));
    const bankedResets = createBankedResetsGroup(settings, settingsSignalIds);
    page.add(bankedResets.group);
    page.add(createBackgroundRefreshGroup(settings, settingsSignalIds));
    const credentials = createCredentialsGroup(settings, settingsSignalIds, window);
    page.add(credentials.group);
    page.add(createFooterGroup(metadata, window, getReleaseNotes));
    window.connect("close-request", () => {
        credentials.cleanup();
        bankedResets.cleanup();
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
        tooltip_text: "Reset to default credentials file.",
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
            const accepted = response === Gtk.ResponseType.ACCEPT;
            const path = accepted ? chooser.get_file()?.get_path() : null;
            destroyDialog();
            if (!accepted) return;
            if (path) {
                void validateSelection(path);
            } else {
                errorLabel.label = "Select a local credentials file.";
                errorLabel.visible = true;
            }
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

function createBankedResetsGroup(settings, settingsSignalIds) {
    const group = new Adw.PreferencesGroup({ title: "Banked resets" });
    group.add(
        createBoundSwitchRow({
            settings,
            key: SETTINGS_AUTO_APPLY_BANKED_RESET,
            title: "Auto-redeem expiring resets",
            subtitle: "Redeem a banked reset automatically within 1 hour of expiry.",
        }),
    );
    group.add(
        createBoundSwitchRow({
            settings,
            key: SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE,
            title: "Auto-redeem on low remaining usage",
            subtitle: "Redeem below 2% remaining unless the window resets soon.",
        }),
    );
    const skipPeriods = createSkipPeriodsRow(settings, settingsSignalIds);
    group.add(skipPeriods.row);

    const stopWatching = watchUsageWindowCache(settings, settingsSignalIds, skipPeriods.setQuotas);
    return {
        group,
        cleanup() {
            stopWatching();
            skipPeriods.clearRows();
        },
    };
}

function watchUsageWindowCache(settings, settingsSignalIds, setQuotas) {
    let stop = null;
    const refresh = () => {
        stop?.();
        setQuotas([]);
        const service = new UsageService(settings.get_string(SETTINGS_CREDENTIALS_PATH));
        const scope = new Gio.Cancellable();
        let pendingRead = null;
        let stopMonitoringSnapshot = null;
        let stopMonitoringAuth = null;
        stop = () => {
            scope.cancel();
            pendingRead?.cancel();
            stopMonitoringSnapshot?.();
            stopMonitoringAuth?.();
        };
        const read = async () => {
            if (scope.is_cancelled()) return;
            pendingRead?.cancel();
            const cancellable = new Gio.Cancellable();
            pendingRead = cancellable;
            const snapshot = await service.readCachedSnapshot({ cancellable }).catch(() => null);
            if (scope.is_cancelled() || pendingRead !== cancellable) return;
            pendingRead = null;
            setQuotas(snapshot?.quotas ?? []);
        };
        try {
            const monitor = Gio.File.new_for_path(service.credentialsPath).monitor_file(
                Gio.FileMonitorFlags.WATCH_MOVES,
                scope,
            );
            const id = monitor.connect("changed", () => void read());
            stopMonitoringAuth = () => {
                monitor.disconnect(id);
                monitor.cancel();
            };
        } catch (_error) {
            // The snapshot watcher still checks the account if auth monitoring is unavailable.
        }
        const file = Gio.File.new_for_path(service.snapshotPath);
        const exists = (directory) =>
            directory
                .query_info_async(
                    "standard::type",
                    Gio.FileQueryInfoFlags.NONE,
                    GLib.PRIORITY_DEFAULT,
                    scope,
                )
                .then(() => true)
                .catch((error) => {
                    if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) return false;
                    throw error;
                });
        const arm = async () => {
            let child = file;
            let parent = file.get_parent();
            // Gio can miss the first write when the file's containing directory is absent.
            while (!(await exists(parent))) {
                child = parent;
                parent = parent.get_parent();
            }
            if (scope.is_cancelled()) return;
            const atFile = child === file;
            // Watch the directory so atomic replacements of the snapshot are visible.
            const monitor = parent.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, scope);
            const advance = () => {
                if (scope.is_cancelled() || stopMonitoringSnapshot !== disconnect) return;
                disconnect();
                stopMonitoringSnapshot = null;
                start();
            };
            const id = monitor.connect("changed", (_monitor, changed, other) => {
                if (!child.equal(changed) && !(other && child.equal(other))) return;
                if (atFile) void read();
                else advance();
            });
            const disconnect = () => {
                monitor.disconnect(id);
                monitor.cancel();
            };
            stopMonitoringSnapshot = disconnect;
            // Check again after connecting so creation during monitor setup is not missed.
            if (atFile) await read();
            else if (await exists(child)) advance();
        };
        const start = () => void arm().catch(read);
        start();
    };
    settingsSignalIds.push(settings.connect(`changed::${SETTINGS_CREDENTIALS_PATH}`, refresh));
    refresh();
    return () => {
        stop?.();
        stop = null;
    };
}

function createSkipPeriodsRow(settings, settingsSignalIds) {
    const key = SETTINGS_BANKED_RESET_SKIP_MINUTES;
    const row = new Adw.ExpanderRow({
        title: "Wait for scheduled reset",
        enable_expansion: false,
    });
    settings.bind(
        SETTINGS_AUTO_APPLY_BANKED_RESET_ON_USAGE,
        row,
        "sensitive",
        Gio.SettingsBindFlags.GET,
    );
    const windowRows = [];
    let windowSignature;
    const clearRows = () => {
        for (const { control, signal } of windowRows.splice(0)) {
            control.disconnect(signal);
            row.remove(control);
        }
    };
    settingsSignalIds.push(
        settings.connect(`changed::${key}`, () => {
            const overrides = readBankedResetSkipMinutes(settings);
            for (const { control, quota } of windowRows) {
                control.value = getBankedResetSkipMinutes(quota, overrides);
            }
        }),
    );
    return {
        row,
        clearRows,
        setQuotas(quotas) {
            const windows = sortUsageQuotas(quotas);
            const signature = JSON.stringify(
                windows.map(({ id, label, limitWindowSeconds }) => [id, label, limitWindowSeconds]),
            );
            if (windowSignature === signature) return;
            windowSignature = signature;
            clearRows();
            const openByDefault = windows.length > 0 && !row.enable_expansion;
            row.enable_expansion = windows.length > 0;
            if (openByDefault) row.expanded = true;
            row.subtitle = windows.length
                ? "Keep banked reset if scheduled reset comes soon."
                : "Refresh usage to see your windows.";

            const overrides = readBankedResetSkipMinutes(settings);
            for (const quota of windows) {
                const duplicateLabel = windows.some(
                    (other) => other.id !== quota.id && other.label === quota.label,
                );
                const label = quota.limitWindowSeconds === 18_000 ? "5 hour" : quota.label;
                const windowLabel = /\bwindow$/i.test(label) ? label : `${label} window`;
                const title = duplicateLabel ? `${windowLabel} (${quota.id})` : windowLabel;
                const maxMinutes = Math.ceil((quota.limitWindowSeconds ?? 604_800) / 60);
                const subtitle =
                    quota.limitWindowSeconds > 0
                        ? `Set to 0 to never skip. Set to ${maxMinutes.toLocaleString()} to disable auto-redeem.`
                        : "Set to 0 to never skip.";
                const control = new Adw.SpinRow({
                    title: `${title} (minutes)`,
                    subtitle,
                    use_markup: false,
                    adjustment: new Gtk.Adjustment({
                        lower: 0,
                        upper: maxMinutes,
                        step_increment: 1,
                        page_increment: 15,
                        value: getBankedResetSkipMinutes(quota, overrides),
                    }),
                    climb_rate: 1,
                    digits: 0,
                    snap_to_ticks: true,
                });
                const signal = control.connect("notify::value", () => {
                    const overrides = readBankedResetSkipMinutes(settings);
                    const minutes = Math.round(control.value);
                    if (
                        minutes ===
                        Math.min(getBankedResetSkipMinutes(quota, overrides), maxMinutes)
                    )
                        return;
                    settings.set_value(
                        key,
                        new GLib.Variant("a{su}", {
                            ...overrides,
                            [quota.id]: minutes,
                        }),
                    );
                });
                windowRows.push({ control, quota, signal });
                row.add_row(control);
            }
        },
    };
}

function createNotificationsGroup(settings, settingsSignalIds) {
    const group = new Adw.PreferencesGroup({ title: "Notifications" });
    group.add(
        createBoundSwitchRow({
            settings,
            key: SETTINGS_USAGE_NOTIFICATIONS,
            title: "Usage notifications",
            subtitle:
                "Notify when a usage window runs low, is exhausted, or resets after exhaustion.",
        }),
    );
    const key = SETTINGS_USAGE_NOTIFICATION_THRESHOLD;
    const row = new Adw.SpinRow({
        title: "Warning threshold (% left)",
        subtitle: "Warn when remaining usage reaches this threshold.",
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
            subtitle: "Show remaining or used capacity.",
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
            subtitle: "Icon shown in the top panel.",
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
            subtitle: "How usage appears in the top panel.",
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
        subtitle: "Set to 0 to refresh manually.",
        adjustment: new Gtk.Adjustment({
            lower: MIN_REFRESH_INTERVAL_MINUTES,
            upper: 30,
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

function createFooterGroup(metadata, window, getReleaseNotes) {
    const group = new Adw.PreferencesGroup();
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 4,
        margin_top: 12,
        margin_bottom: 12,
    });
    box.append(
        new Gtk.Label({
            label: `${metadata.name} ${metadata["version-name"]}`,
            css_classes: ["caption", "dim-label"],
        }),
    );
    const link = new Gtk.Label({
        label: '<a href="about:codex-meter">About</a>',
        use_markup: true,
        css_classes: ["caption"],
    });
    link.connect("activate-link", () => {
        const about = new Adw.AboutWindow({
            transient_for: window,
            modal: true,
            destroy_with_parent: true,
            application_name: metadata.name,
            application_icon: "codex-meter",
            version: metadata["version-name"],
            developer_name: "Sebastian Lobbe",
            developers: ["Sebastian Lobbe <s@lobbe.cc>"],
            comments: formatDescription(metadata.description),
            website: metadata.url,
            issue_url: `${metadata.url}/issues`,
            license_type: Gtk.License.GPL_3_0,
        });
        const releaseNotes = getReleaseNotes();
        if (releaseNotes) {
            about.release_notes = releaseNotes.markup;
            about.release_notes_version = releaseNotes.version;
        }

        about.present();
        return true;
    });
    box.append(link);
    group.add(box);
    return group;
}
