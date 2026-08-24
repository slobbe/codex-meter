import Clutter from "gi://Clutter";
import St from "gi://St";
import * as ModalDialog from "resource:///org/gnome/shell/ui/modalDialog.js";

export function showBankedResetConfirmation(credit, { onConfirm, onCancel }) {
    const dialog = new ModalDialog.ModalDialog({ destroyOnClose: true });
    const content = new St.BoxLayout({
        vertical: true,
        style_class: "cx-reset-dialog-content",
    });
    const title = createWrappingLabel("Apply banked reset?", "cx-reset-dialog-title");
    const message = createWrappingLabel(
        "This will consume the following reset and reset your current Codex usage limits. This action cannot be undone.",
        "cx-reset-dialog-message",
    );
    const creditTitle = createWrappingLabel(
        credit.title || "Usage limit reset",
        "cx-reset-dialog-credit-title",
    );

    content.add_child(title);
    content.add_child(message);
    content.add_child(creditTitle);

    if (credit.description) {
        content.add_child(createWrappingLabel(credit.description, "cx-reset-dialog-description"));
    }

    const details = new St.BoxLayout({
        vertical: true,
        style_class: "cx-reset-dialog-details",
    });
    addDetail(details, "Type", formatResetType(credit.reset_type));
    addDetail(details, "Granted", formatDate(credit.granted_at));
    addDetail(details, "Expires", formatDate(credit.expires_at));
    if (details.get_n_children() > 0) content.add_child(details);

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
            label: "Apply reset",
            action: () => {
                dialog.close();
                onConfirm();
            },
            default: true,
        },
    ]);
    dialog.open();
    return dialog;
}

function addDetail(container, label, value) {
    if (!value) return;
    const row = new St.BoxLayout({
        style_class: "cx-reset-dialog-detail-row",
    });
    row.add_child(
        new St.Label({
            text: label,
            y_align: Clutter.ActorAlign.START,
            style_class: "cx-reset-dialog-detail-label",
        }),
    );
    row.add_child(createWrappingLabel(value, "cx-reset-dialog-detail-value"));
    container.add_child(row);
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

function formatResetType(value) {
    if (!value) return null;
    const words = value.replaceAll("_", " ");
    return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
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
