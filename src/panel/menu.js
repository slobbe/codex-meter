import Clutter from "gi://Clutter";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { ActivityGrid } from "./activity-grid.js";
import { UsageBar } from "./usage-bar.js";
import { formatDuration } from "./view-model.js";

export class CodexMeterPopupMenu {
    constructor({ onRefresh, onRedeemBankedReset, onOpenPreferences }) {
        this._onRefresh = onRefresh;
        this._onRedeemBankedReset = onRedeemBankedReset;
        this._onOpenPreferences = onOpenPreferences;
        this.bankedResetsItem = new PopupMenu.PopupSubMenuMenuItem("Banked Resets");
        const resetScrollView = this.bankedResetsItem.menu.actor;
        // Shell chooses NEVER for a short loading row and does not reconsider as content grows.
        const keepResetScrolling = () => {
            if (resetScrollView.vscrollbar_policy !== St.PolicyType.AUTOMATIC) {
                resetScrollView.vscrollbar_policy = St.PolicyType.AUTOMATIC;
            }
        };
        resetScrollView.connect("notify::vscrollbar-policy", keepResetScrolling);
        keepResetScrolling();

        this._bankedResetRows = new Map();
        this.loadingItem = new PopupMenu.PopupMenuItem("Loading usage…", {
            reactive: false,
            can_focus: false,
        });
        this.loadingItem.hide();
        this.footerItem = this._createFooterItem();
        this.statusItem = this._createBannerItem();
        this.usageItems = [];
        this._activityGrid = new ActivityGrid();
        this.trendItem = this._activityGrid.item;
        this.headerItem = this._createHeaderItem();
    }

    addToMenu(menu) {
        this._menu = menu;
        menu.box.add_style_class_name("cx-popup-menu");
        menu.addMenuItem(this.headerItem);

        for (const item of this.usageItems) menu.addMenuItem(item);
        menu.addMenuItem(this.loadingItem);
        menu.addMenuItem(this.trendItem);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addMenuItem(this.bankedResetsItem);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addMenuItem(this.statusItem);
        menu.addMenuItem(this.footerItem);
    }

    syncBars() {
        for (const item of this.usageItems) item.usageBar.sync();
    }

    setTrend(viewModel) {
        this._activityGrid.update(viewModel);
    }

    setUsageItems(viewModels, loading = false) {
        this.loadingItem.visible = loading;
        while (this.usageItems.length > viewModels.length) {
            this.usageItems.pop().destroy();
        }
        while (this.usageItems.length < viewModels.length) {
            const item = this._createUsageItem("Usage");
            this._menu?.addMenuItem(item, 1 + this.usageItems.length);
            this.usageItems.push(item);
        }
        for (let index = 0; index < viewModels.length; index += 1) {
            this.setUsageItem(this.usageItems[index], viewModels[index]);
        }
    }

    setUsageItem(item, viewModel) {
        item.visible = viewModel.visible;
        item.titleLabel.text = viewModel.title;
        item.valueLabel.text = `${viewModel.value} ${viewModel.percentLabel}`;
        item.predictionLabel.text = viewModel.prediction;
        item.resetLabel.text = viewModel.reset;
        if (viewModel.predictionStyle === "muted") {
            item.predictionLabel.add_style_class_name("cx-muted");
        } else {
            item.predictionLabel.remove_style_class_name("cx-muted");
        }
        item.usageBar.update({
            percentValue: viewModel.percentValue,
            displayPercentValue: viewModel.displayPercentValue,
            displayBaselinePercentValue: viewModel.displayBaselinePercentValue,
            colorStyleClass: viewModel.colorStyleClass,
        });
    }

    setStatus({ severity = "warning", title, message }) {
        const item = this.statusItem;
        const isError = severity === "error";
        const color = isError ? "danger" : "warning";
        item.visible = Boolean(title || message);
        item.icon.icon_name = isError ? "dialog-error-symbolic" : "dialog-warning-symbolic";
        item.icon.style_class = `popup-menu-icon cx-status-icon-${color}`;
        item.titleLabel.text = title ?? "";
        item.messageLabel.style_class = `cx-error-message cx-error-message-${color}`;
        item.setDetails(message, isError, severity !== this._statusSeverity);
        this._statusSeverity = severity;
    }

    setRefreshLabel(label) {
        this._refreshLabel = label;
        this.setRefreshing(this._refreshing);
    }

    setRefreshing(refreshing) {
        this._refreshing = refreshing;
        this.footerItem.statusLabel.text = refreshing
            ? "Refreshing…"
            : (this._refreshLabel ?? "Not refreshed yet");
        this.refreshButton.reactive = !refreshing;
        this.refreshButton.can_focus = !refreshing;
    }

    setBankedResets({ count, snapshot, loading, error, preparing, preparingId, redeeming }) {
        const busy = preparing || redeeming;
        this.bankedResetsItem.label.text =
            count === null || count === undefined ? "Banked Resets" : `Banked Resets (${count})`;
        const now = Date.now();
        const credits = (snapshot?.credits ?? [])
            .filter((credit) => credit.status === "available" && resetExpiryTime(credit) > now)
            .toSorted((left, right) => resetExpiryTime(left) - resetExpiryTime(right));
        const rows = new Map();
        if (!preparing) {
            if (loading) rows.set("status", { text: "Loading banked resets…" });
            else if (error) rows.set("status", { text: `Banked resets unavailable: ${error}` });
            else if (!snapshot) rows.set("status", { text: "Banked resets unavailable" });
        }
        if (redeeming) rows.set("redeeming", { text: "Redeeming reset…" });
        if (snapshot && !loading && !error && credits.length === 0) {
            rows.set("empty", { text: "No banked resets available" });
        }
        for (const credit of credits) {
            rows.set(`credit:${credit.id}`, {
                creditId: credit.id,
                text: formatResetCredit(credit, now, preparing && credit.id === preparingId),
            });
        }

        this._canRedeemBankedReset = !busy && !loading && !error && Boolean(snapshot);
        const menu = this.bankedResetsItem.menu;
        for (const [key, item] of this._bankedResetRows) {
            if (rows.has(key)) continue;
            this._bankedResetRows.delete(key);
            item.destroy();
        }
        let index = 0;
        for (const [key, { creditId, text }] of rows) {
            const isCredit = creditId !== undefined;
            let item = this._bankedResetRows.get(key);
            if (!item) {
                item = new PopupMenu.PopupMenuItem(text, {
                    reactive: isCredit,
                    can_focus: isCredit,
                });
                if (key === "status") {
                    item.label.x_expand = true;
                    item.label.clutter_text.line_wrap = true;
                    item.label.clutter_text.ellipsize = 0;
                }
                if (isCredit) {
                    item.connect("activate", () => {
                        if (this._canRedeemBankedReset) this._onRedeemBankedReset(creditId);
                    });
                }
                this._bankedResetRows.set(key, item);
                menu.addMenuItem(item, index);
            } else {
                if (item.label.text !== text) item.label.text = text;
                if (menu.box.get_child_at_index(index) !== item.actor) {
                    menu.box.set_child_at_index(item.actor, index);
                }
            }
            if (isCredit) item.setSensitive(this._canRedeemBankedReset);
            index++;
        }
    }

    _createFooterItem() {
        const item = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        item.add_style_class_name("cx-footer");
        item.statusLabel = new St.Label({
            text: "Not refreshed yet",
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-muted cx-footer-status",
        });
        this.refreshButton = this._createFooterButton("view-refresh-symbolic", "Refresh");
        this.refreshButton.connect("clicked", () => this._onRefresh());
        this.preferencesButton = this._createFooterButton(
            "preferences-system-symbolic",
            "Preferences",
        );
        this.preferencesButton.connect("clicked", () => {
            this._menu?.close();
            this._onOpenPreferences();
        });
        item.add_child(item.statusLabel);
        item.add_child(this.refreshButton);
        item.add_child(this.preferencesButton);
        return item;
    }

    _createFooterButton(iconName, label) {
        const button = new St.Button({
            child: new St.Icon({ icon_name: iconName }),
            style_class: "icon-button",
            accessible_name: label,
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const tooltip = new St.Label({ text: label, style_class: "dash-label", visible: false });
        Main.uiGroup.add_child(tooltip);
        const syncTooltip = () => {
            tooltip.visible = button.mapped && (button.hover || button.has_key_focus());
            if (!tooltip.visible) return;
            Main.uiGroup.set_child_above_sibling(tooltip, null);
            const [x, y] = button.get_transformed_position();
            const [width] = button.get_transformed_size();
            const [, tooltipWidth] = tooltip.get_preferred_width(-1);
            const [, tooltipHeight] = tooltip.get_preferred_height(tooltipWidth);
            tooltip.set_position(
                Math.round(x + (width - tooltipWidth) / 2),
                Math.round(y - tooltipHeight - 6),
            );
        };
        button.connect("notify::hover", syncTooltip);
        button.connect("notify::mapped", syncTooltip);
        button.connect("key-focus-in", syncTooltip);
        button.connect("key-focus-out", syncTooltip);
        button.connect("destroy", () => tooltip.destroy());
        return button;
    }

    _createUsageItem(title) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        const box = new St.BoxLayout({
            x_expand: true,
            style_class: "cx-usage-menu-item",
        });
        box.layout_manager.orientation = Clutter.Orientation.VERTICAL;
        const headingBox = new St.BoxLayout({
            x_expand: true,
            style_class: "cx-usage-heading-row",
        });
        const titleLabel = new St.Label({
            text: title,
            style_class: "cx-usage-heading cx-usage-title",
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const valueLabel = new St.Label({
            text: "-- used",
            style_class: "cx-usage-heading cx-usage-value",
            y_align: Clutter.ActorAlign.CENTER,
        });
        const usageBar = new UsageBar("menu");
        const detailBox = new St.BoxLayout({
            x_expand: true,
            style_class: "cx-usage-detail",
        });
        const predictionLabel = new St.Label({
            text: "",
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
            style_class: "cx-usage-prediction",
        });
        const resetLabel = new St.Label({
            text: "resets in --",
            y_align: Clutter.ActorAlign.START,
            style_class: "cx-usage-detail-muted",
        });
        for (const label of [predictionLabel, resetLabel]) {
            label.clutter_text.line_wrap = true;
            label.clutter_text.ellipsize = 0;
        }
        detailBox.add_child(predictionLabel);
        detailBox.add_child(resetLabel);
        headingBox.add_child(titleLabel);
        headingBox.add_child(valueLabel);
        box.add_child(headingBox);
        box.add_child(usageBar.actor);
        box.add_child(detailBox);
        item.add_child(box);
        item.titleLabel = titleLabel;
        item.valueLabel = valueLabel;
        item.usageBar = usageBar;
        item.predictionLabel = predictionLabel;
        item.resetLabel = resetLabel;
        return item;
    }

    _createBannerItem() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        const box = new St.BoxLayout({
            x_expand: true,
            style_class: "cx-error-menu-item",
        });
        box.layout_manager.orientation = Clutter.Orientation.VERTICAL;

        const headingBox = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-error-heading-row",
        });
        const icon = new St.Icon({
            icon_name: "dialog-warning-symbolic",
            style_class: "popup-menu-icon",
            y_align: Clutter.ActorAlign.CENTER,
        });
        const titleLabel = new St.Label({
            text: "",
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-error-title",
        });
        const expander = new St.Icon({
            icon_name: "pan-end-symbolic",
            style_class: "popup-menu-icon cx-error-expander",
            y_align: Clutter.ActorAlign.CENTER,
        });
        const headingButton = new St.Button({
            child: headingBox,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            can_focus: true,
            style_class: "cx-error-heading-button",
        });
        const messageLabel = new St.Label({
            text: "",
            x_expand: true,
            style_class: "cx-error-message cx-error-message-warning",
        });
        messageLabel.clutter_text.line_wrap = true;
        messageLabel.clutter_text.ellipsize = 0;
        headingBox.add_child(icon);
        headingBox.add_child(titleLabel);
        headingBox.add_child(expander);
        box.add_child(headingButton);
        box.add_child(messageLabel);
        item.add_child(box);
        item.visible = false;
        item.titleLabel = titleLabel;
        item.icon = icon;
        item.messageLabel = messageLabel;

        let isExpanded = false;
        const setExpanded = (value) => {
            isExpanded = value && messageLabel.text !== "";
            messageLabel.visible = isExpanded;
            expander.icon_name = isExpanded ? "pan-down-symbolic" : "pan-end-symbolic";
            headingButton.accessible_name = `${isExpanded ? "Hide" : "Show"} ${titleLabel.text.toLowerCase()} details`;
        };
        headingButton.connect("clicked", () => setExpanded(!isExpanded));
        item.setDetails = (message, expandWhenChanged, resetExpansion = false) => {
            const nextMessage = message ?? "";
            const changed = messageLabel.text !== nextMessage;
            messageLabel.text = nextMessage;
            const hasDetails = nextMessage !== "";
            expander.visible = hasDetails;
            headingButton.reactive = hasDetails;
            headingButton.can_focus = hasDetails;
            setExpanded(changed || resetExpansion ? expandWhenChanged : isExpanded);
        };
        item.setDetails("", false);
        return item;
    }

    _createHeaderItem() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        item.titleLabel = new St.Label({
            text: "Codex Usage",
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-usage-heading",
        });
        item.planLabel = new St.Label({
            text: "--",
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        item.add_child(item.titleLabel);
        item.add_child(item.planLabel);
        return item;
    }
}

function resetExpiryTime(credit) {
    const time = Date.parse(credit.expires_at ?? "");
    return Number.isFinite(time) ? time : Infinity;
}

function formatResetCredit(credit, now, checking) {
    const title = credit.title || "Usage limit reset";
    const type = (credit.reset_type ?? "").replaceAll("_", " ");
    const showType =
        type && !title.toLowerCase().includes(type.toLowerCase()) && !/\([^)]*\)\s*$/.test(title);
    const details = [
        showType ? `${title} (${type.charAt(0).toUpperCase()}${type.slice(1)})` : title,
    ];
    const expiry = resetExpiryTime(credit);
    details.push(
        checking
            ? "Checking…"
            : Number.isFinite(expiry)
              ? `Expires in ${formatDuration((expiry - now) / 1000)}`
              : "Expiry unknown",
    );
    return details.join(" · ");
}
