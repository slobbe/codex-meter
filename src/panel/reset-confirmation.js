import Clutter from "gi://Clutter";
import St from "gi://St";
import * as ModalDialog from "resource:///org/gnome/shell/ui/modalDialog.js";

export function showBankedResetConfirmation(credit, { onConfirm, onCancel }) {
    const dialog = new ModalDialog.ModalDialog({ destroyOnClose: true });
    const content = new St.BoxLayout({
        vertical: true,
        style_class: "cx-reset-dialog-content",
    });
    const title = createWrappingLabel(credit.title || "Usage limit reset", "cx-reset-dialog-title");
    content.add_child(title);

    const details = new St.BoxLayout({
        vertical: true,
        style_class: "cx-reset-dialog-details",
    });
    if (credit.description) {
        details.add_child(createWrappingLabel(credit.description, "cx-reset-dialog-description"));
    }
    addDetail(details, "Granted", formatDate(credit.granted_at));
    addDetail(details, "Expires", formatDate(credit.expires_at));
    if (details.get_n_children() > 0) content.add_child(details);

    const resetType = credit.reset_type?.replaceAll("_", " ") || "banked";
    content.add_child(
        createWrappingLabel(
            `This will consume this ${resetType} reset. This action cannot be undone`,
            "cx-reset-dialog-message",
        ),
    );

    dialog.contentLayout.add_child(content);
    dialog.setButtons([
        {
            label: "Cancel",
            action: () => {
                dialog.close();
                onCancel();
            },
            key: Clutter.KEY_Escape,
        },
        {
            label: "Redeem",
            action: () => {
                dialog.close();
                onConfirm();
            },
            default: true,
        },
    ]);
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
