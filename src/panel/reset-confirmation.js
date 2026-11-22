import Clutter from "gi://Clutter";
import St from "gi://St";
import * as ModalDialog from "resource:///org/gnome/shell/ui/modalDialog.js";
import { getBankedResetSkipMinutes, getImminentResetSeconds } from "../codex/usage/model.js";
import { formatDuration } from "./view-model.js";

export function showBankedResetConfirmation(
    credit,
    { quotas = [], skipMinutesByWindow, onConfirm, onCancel },
) {
    const dialog = new ModalDialog.ModalDialog({ destroyOnClose: true });
    const content = new St.BoxLayout({
        style_class: "cx-reset-dialog-content",
    });
    content.layout_manager.orientation = Clutter.Orientation.VERTICAL;
    const title = createWrappingLabel(credit.title || "Usage limit reset", "cx-reset-dialog-title");
    content.add_child(title);
    dialog.label_actor = title;

    const details = new St.BoxLayout({
        style_class: "cx-reset-dialog-details",
    });
    details.layout_manager.orientation = Clutter.Orientation.VERTICAL;
    if (credit.description) {
        details.add_child(createWrappingLabel(credit.description, "cx-reset-dialog-description"));
    }
    addDetail(details, "Granted", formatDate(credit.granted_at));
    addDetail(details, "Expires", formatDate(credit.expires_at));
    if (details.get_n_children() > 0) content.add_child(details);

    const nowSeconds = Date.now() / 1000;
    let resetsSoon = false;
    for (const quota of quotas) {
        const skipMinutes = getBankedResetSkipMinutes(quota, skipMinutesByWindow);
        const secondsLeft = getImminentResetSeconds(quota, nowSeconds, skipMinutes);
        if (secondsLeft === null) continue;
        resetsSoon = true;
        const countdown = secondsLeft < 60 ? "less than 1 minute" : formatDuration(secondsLeft);
        content.add_child(
            createWrappingLabel(
                `${quota.label} window: resets in ${countdown}.`,
                "cx-reset-dialog-message",
            ),
        );
    }

    const resetType = credit.reset_type?.replaceAll("_", " ") || "banked";
    content.add_child(
        createWrappingLabel(
            `This will consume this ${resetType} reset. This action cannot be undone`,
            "cx-reset-dialog-message",
        ),
    );

    dialog.contentLayout.add_child(content);
    const finish = (action) => () => {
        // Close can destroy the dialog before the guarded callback runs.
        action();
        dialog.close();
    };
    const cancel = dialog.addButton({
        label: "Cancel",
        action: finish(onCancel),
        key: Clutter.KEY_Escape,
    });
    dialog.addButton({
        label: resetsSoon ? "Redeem anyway" : "Redeem",
        action: finish(onConfirm),
    });
    dialog.setInitialKeyFocus(cancel);
    if (!dialog.open()) {
        dialog.destroy();
        return null;
    }
    return dialog;
}

function addDetail(container, label, value) {
    if (!value) return;
    container.add_child(createWrappingLabel(`${label}: ${value}`, "cx-reset-dialog-detail"));
}

function createWrappingLabel(text, styleClass) {
    const label = new St.Label({
        text,
        x_expand: true,
        style_class: styleClass,
    });
    label.clutter_text.line_wrap = true;
    label.clutter_text.ellipsize = 0;
    return label;
}

function formatDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return date.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
}
