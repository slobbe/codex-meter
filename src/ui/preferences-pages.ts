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
import { isRefreshFailureError } from "../domain/refresh-failure.js";
import {
    type CodexBankedResetCredit,
    listCodexBankedResets,
    readCachedCodexBankedResetsSync,
    redeemCodexBankedReset,
} from "../infra/providers/codex_banked_resets.js";


type Metadata = Record<string, any>;
type ShellVersions = unknown;

export const DisplayPage = GObject.registerClass(
    class DisplayPage extends Adw.PreferencesPage {
        _init(settings: Gio.Settings) {
            super._init({
                title: "Options",
                icon_name: "preferences-system-symbolic",
            });

            this.add(createBehaviorGroup(settings));
            this.add(createTopPanelGroup(settings));
        }
    },
);

export const CodexPage = GObject.registerClass(
    class CodexPage extends Adw.PreferencesPage {
        private _group: Adw.PreferencesGroup;
        private _statusRow: Adw.ActionRow;
        private _rows: Gtk.Widget[];
        private _credits: CodexBankedResetCredit[];
        private _loading: boolean;
        private _redeemingCreditId: string | null;

        _init() {
            this._rows = [];
            this._credits = [];
            this._loading = false;
            this._redeemingCreditId = null;

            super._init({
                title: "Codex",
                icon_name: "codex-symbolic",
            });

            this._group = new Adw.PreferencesGroup({
                title: "Banked resets",
                description: "Available: 0",
            });

            this._statusRow = new Adw.ActionRow({
                title: getNoCodexCreditSnapshotMessage(),
            });
            this._addRow(this._statusRow);
            this.add(this._group);

            this._loadCachedCredits();
        }

        private _loadCachedCredits() {
            const snapshot = readCachedCodexBankedResetsSync();

            if (!snapshot) {
                this._render({ status: getNoCodexCreditSnapshotMessage() });
                return;
            }

            this._credits = snapshot.credits;
            this._render();
        }

        private async _loadCredits() {
            if (this._loading) return;

            this._loading = true;
            if (this._credits.length === 0) {
                this._render({ status: "Loading Codex credits…" });
            }

            try {
                const response = await listCodexBankedResets();
                this._credits = response.credits;
                this._render();
            } catch (error) {
                this._render({ status: formatCodexPreferencesError(error) });
            } finally {
                this._loading = false;
            }
        }

        private async _redeemCredit(credit: CodexBankedResetCredit) {
            if (this._redeemingCreditId || credit.status !== "available") return;

            this._redeemingCreditId = credit.id;
            this._render();

            try {
                await redeemCodexBankedReset(credit.id);
                await this._loadCredits();
            } catch (error) {
                this._render({ status: formatCodexPreferencesError(error) });
            } finally {
                this._redeemingCreditId = null;
                this._render();
            }
        }

        private _render({ status }: { status?: string } = {}) {
            this._group.description = `Available: ${getAvailableCreditCount(this._credits)}`;
            this._removeRows();

            if (status) {
                this._statusRow = new Adw.ActionRow({ title: status });
                this._addRow(this._statusRow);
                return;
            }

            if (this._credits.length === 0) {
                this._statusRow = new Adw.ActionRow({
                    title: "No banked Codex resets are available.",
                });
                this._addRow(this._statusRow);
                return;
            }

            for (const credit of this._credits) {
                this._addRow(this._createCreditRow(credit));
            }
        }

        private _addRow(row: Gtk.Widget) {
            this._group.add(row);
            this._rows.push(row);
        }

        private _removeRows() {
            for (const row of this._rows) {
                this._group.remove(row);
            }

            this._rows = [];
        }

        private _createCreditRow(credit: CodexBankedResetCredit) {
            const row = new Adw.ActionRow({
                title: credit.title || "Codex rate limit reset",
                subtitle: createCreditSubtitle(credit),
            });
            const redeeming = this._redeemingCreditId === credit.id;
            const canRedeem = credit.status === "available" && !this._redeemingCreditId;
            const button = new Gtk.Button({
                label: redeeming ? "Redeeming…" : getCreditButtonLabel(credit),
                sensitive: canRedeem,
                valign: Gtk.Align.CENTER,
            });

            button.connect("clicked", () => {
                void this._redeemCredit(credit);
            });
            row.add_suffix(button);
            row.activatable_widget = button;

            return row;
        }

    },
);

export const AboutPage = GObject.registerClass(
    class AboutPage extends Adw.PreferencesPage {
        _init(metadata: Metadata, extensionPath: string) {
            super._init({
                title: "About",
                icon_name: "help-about-symbolic",
            });

            this.add(createAboutHeaderGroup(metadata, extensionPath));
            this.add(createAboutInfoGroup(metadata));
        }
    },
);

function getNoCodexCreditSnapshotMessage(): string {
    return "No Codex credit snapshot is available yet. It will appear after the next successful panel refresh.";
}

function createCreditSubtitle(credit: CodexBankedResetCredit): string {
    const lines = [
        credit.description ?? "",
        `Granted: ${formatCreditDate(credit.granted_at)} · Expires: ${formatCreditDate(credit.expires_at)}`,
    ];

    if (credit.status !== "available") {
        lines.push(`Status: ${credit.status}`);
    }

    return lines.join("\n");
}

function formatCreditDate(value?: string | null): string {
    if (!value) return "Unknown";

    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Unknown";

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");

    return `${year}-${month}-${day}, ${hours}:${minutes}`;
}

function getAvailableCreditCount(credits: CodexBankedResetCredit[]): number {
    return credits.filter((credit) => credit.status === "available").length;
}

function getCreditButtonLabel(credit: CodexBankedResetCredit): string {
    return credit.status === "available" ? "Redeem" : credit.status;
}

function formatCodexPreferencesError(error: unknown): string {
    if (isRefreshFailureError(error)) {
        return error.message;
    }

    const message = error instanceof Error && error.message
        ? error.message
        : "Unknown Codex error";

    return `Unable to load Codex credits: ${message}`;
}

function createTopPanelGroup(settings: Gio.Settings) {
    const group = new Adw.PreferencesGroup({
        title: "Top panel indicator",
    });

    group.add(createTopPanelIndicatorIconRow(settings));
    group.add(createTopPanelStyleRow(settings));
    group.add(
        createBoundSwitchRow({
            settings,
            key: SETTINGS_SHOW_PRIMARY,
            title: "Display 5-hour session usage",
        }),
    );
    group.add(
        createBoundSwitchRow({
            settings,
            key: SETTINGS_SHOW_SECONDARY,
            title: "Display weekly usage",
        }),
    );

    return group;
}

function createBehaviorGroup(settings: Gio.Settings) {
    const group = new Adw.PreferencesGroup({
        title: "Behavior",
    });

    group.add(createPercentDisplayModeRow(settings));
    group.add(createRefreshIntervalRow(settings));

    return group;
}



function createTopPanelStyleRow(settings: Gio.Settings) {
    const row = new Adw.ComboRow({
        title: "Show percentages as",
        model: Gtk.StringList.new([
            "Progress bars",
            "Raw percentages",
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
        title: "Display mode",
        model: Gtk.StringList.new(["Percent used", "Percent left"]),
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
        model: Gtk.StringList.new(["Codex icon", "OpenAI icon", "CX shortcode"]),
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
        title: "Background refresh interval (minutes)",
        subtitle: "Set to 0 to refresh manually",
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

function createAboutHeaderGroup(metadata: Metadata, extensionPath: string) {
    const group = new Adw.PreferencesGroup();
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        margin_top: 12,
        margin_bottom: 8,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
    });

    box.append(
        new Gtk.Image({
            gicon: new Gio.FileIcon({
                file: Gio.File.new_for_path(`${extensionPath}/assets/logo.png`),
            }),
            pixel_size: 160,
            halign: Gtk.Align.CENTER,
            margin_bottom: 8,
        }),
    );
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
    group.add(createInfoRow("Author", "Sebastian Lobbe"));
    group.add(
        createLinkRow(
            "License",
            `${metadata.url ?? "https://github.com/slobbe/codex-meter"}/blob/main/LICENSE`,
            metadata.license ?? "GPL-3.0-or-later",
        ),
    );
    group.add(
        createLinkRow("Source", metadata.url ?? "https://github.com/slobbe/codex-meter"),
    );
    group.add(
        createLinkRow("Report a bug", "https://github.com/slobbe/codex-meter/issues"),
    );
    

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
            hexpand: true,
            halign: Gtk.Align.END,
            xalign: 1,
        }),
    );

    return row;
}

function createLinkRow(title: string, url: string, label?: string) {
    const row = new Adw.ActionRow({
        title,
        activatable: false,
    });
    const buttonOptions = {
        uri: url,
        tooltip_text: url,
        hexpand: true,
        halign: Gtk.Align.END,
        valign: Gtk.Align.CENTER,
    };

    if (label) {
        row.add_suffix(
            new Gtk.Label({
                label: `<a href="${escapeMarkup(url)}">${escapeMarkup(label)}</a>`,
                use_markup: true,
                selectable: true,
                hexpand: true,
                halign: Gtk.Align.END,
                xalign: 1,
            }),
        );
    } else {
        row.add_suffix(
            new Gtk.LinkButton({
                ...buttonOptions,
                icon_name: "adw-external-link-symbolic",
            }),
        );
    }

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
        case "percentages":
            return 1;
        default:
            return 0;
    }
}

function getTopPanelDisplayModeValue(selected: number): TopPanelDisplayMode {
    switch (selected) {
        case 1:
            return "percentages";
        default:
            return "bars";
    }
}

function getTopPanelIndicatorIconIndex(value: string) {
    if (value === "openai") return 1;
    if (value === "text") return 2;

    return 0;
}

function getTopPanelIndicatorIconValue(selected: number): TopPanelIndicatorIcon {
    if (selected === 1) return "openai";
    if (selected === 2) return "text";

    return "codex";
}

function getPercentDisplayModeIndex(value: string) {
    return value === "left" ? 1 : 0;
}

function getPercentDisplayModeValue(selected: number): PercentDisplayMode {
    return selected === 1 ? "left" : "used";
}
