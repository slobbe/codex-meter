import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const indicatorUrl = new URL("../src/panel/indicator.js", import.meta.url).href;
const confirmationUrl = new URL("../src/panel/reset-confirmation.js", import.meta.url).href;
const stubUrl = `data:text/javascript,${encodeURIComponent(`
    class Actor {
        constructor(options = {}) {
            if ('vertical' in options) throw new Error('St vertical was removed in GNOME 51');
            this.layout_manager = { orientation: 'horizontal' };
            Object.assign(this, options);
            this.children = [];
            this.clutter_text = {};
        }
        add_child(child) { this.children.push(child); }
        get_n_children() { return this.children.length; }
    }
    export default {
        registerClass() {}, BoxLayout: Actor, Label: Actor,
        ActorAlign: { CENTER: 0, START: 1 }, KEY_Escape: 27,
        Orientation: { VERTICAL: 'vertical' },
    };
    export const Button = Actor;
    export const readSettings = null, CodexMeterPopupMenu = null, UsageBar = null, UsageRing = null;
    export const createMenuViewModel = null, createPanelBarViewModel = null;
    export const modalState = { canGrab: false, dialogs: [] };
    export class ModalDialog {
        constructor() {
            this.contentLayout = new Actor();
            modalState.dialogs.push(this);
        }
        setButtons(buttons) { this.buttons = buttons; }
        open() { return modalState.canGrab; }
        close() { this.closed = true; }
        destroy() { this.destroyed = true; }
    }
`)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (context.parentURL === indicatorUrl && specifier === "./reset-confirmation.js") {
            return nextResolve(specifier, context);
        }
        if (context.parentURL === indicatorUrl || context.parentURL === confirmationUrl) {
            return { url: stubUrl, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});
let CodexMeterIndicator;
let showBankedResetConfirmation;
try {
    ({ CodexMeterIndicator } = await import(indicatorUrl));
    ({ showBankedResetConfirmation } = await import(confirmationUrl));
} finally {
    hooks.deregister();
}
const { modalState } = await import(stubUrl);

test("failed modal grab destroys the unopened confirmation and returns null", () => {
    modalState.canGrab = false;
    const dialog = showBankedResetConfirmation(
        { id: "selected" },
        {
            onConfirm: () => assert.fail("failed open must not confirm"),
            onCancel: () => assert.fail("failed open must not invoke a user action"),
        },
    );
    assert.equal(dialog, null);
    assert.equal(modalState.dialogs.at(-1).destroyed, true);
});

test("confirmation shows the reset title, details, and warning before redeeming", () => {
    modalState.canGrab = true;
    let confirmed = false;
    const dialog = showBankedResetConfirmation(
        {
            id: "selected",
            title: "Weekly reset",
            reset_type: "usage_limit",
            granted_at: "2030-01-15T12:00:00Z",
            expires_at: "2030-02-15T12:00:00Z",
            description: "A banked reset for your usage limits.",
        },
        {
            onConfirm: () => {
                confirmed = true;
            },
            onCancel: () => assert.fail("confirm must not cancel"),
        },
    );
    const content = dialog.contentLayout.children[0];
    assert.equal(content.layout_manager.orientation, "vertical");
    assert.equal(content.children.length, 3);
    assert.equal(content.children[0].text, "Weekly reset");
    assert.equal(content.children[0].style_class, "cx-reset-dialog-title");
    const details = content.children[1].children;
    assert.equal(content.children[1].layout_manager.orientation, "vertical");
    assert.equal(details.length, 3);
    assert.equal(details[0].text, "A banked reset for your usage limits.");
    assert.equal(details[0].style_class, "cx-reset-dialog-description");
    assert.equal(details[0].clutter_text.line_wrap, true);
    assert.match(details[1].text, /^Granted: \d{2} Jan 2030, \d{2}:\d{2}$/);
    assert.match(details[2].text, /^Expires: \d{2} Feb 2030, \d{2}:\d{2}$/);
    assert.equal(
        content.children[2].text,
        "This will consume this usage limit reset. This action cannot be undone",
    );
    assert.deepEqual(
        dialog.buttons.map((button) => button.label),
        ["Cancel", "Redeem"],
    );
    dialog.buttons[1].action();
    assert.equal(confirmed, true);
    assert.equal(dialog.closed, true);
});

test("confirmation omits missing details and invalid dates and supports cancellation", () => {
    modalState.canGrab = true;
    let cancelled = false;
    const dialog = showBankedResetConfirmation(
        { id: "selected", granted_at: "invalid", expires_at: "invalid" },
        {
            onConfirm: () => assert.fail("cancel must not confirm"),
            onCancel: () => {
                cancelled = true;
            },
        },
    );
    const content = dialog.contentLayout.children[0];
    assert.equal(content.children.length, 2);
    assert.equal(content.children[0].text, "Usage limit reset");
    assert.equal(content.children[1].style_class, "cx-reset-dialog-message");
    assert.equal(
        content.children[1].text,
        "This will consume this banked reset. This action cannot be undone",
    );
    dialog.buttons[0].action();
    assert.equal(cancelled, true);
    assert.equal(dialog.closed, true);
});

test("confirmation keeps a single available date and uses the selected reset type", () => {
    modalState.canGrab = true;
    for (const field of ["granted_at", "expires_at"]) {
        const dialog = showBankedResetConfirmation(
            { reset_type: "weekly", [field]: "2030-01-15T12:00:00Z" },
            { onConfirm() {}, onCancel() {} },
        );
        const content = dialog.contentLayout.children[0];
        const details = content.children[1].children;
        assert.equal(details.length, 1);
        assert.match(details[0].text, field === "granted_at" ? /^Granted: / : /^Expires: /);
        assert.equal(
            content.children[2].text,
            "This will consume this weekly reset. This action cannot be undone",
        );
    }
});

test("failed modal grab releases the reservation and allows a subsequent selection", async () => {
    modalState.canGrab = false;
    const indicator = Object.create(CodexMeterIndicator.prototype);
    indicator._resetConfirmationDialog = null;
    indicator._uiCancellable = { is_cancelled: () => false };
    indicator.menu = { close() {} };
    const prepared = [];
    indicator._monitor = {
        state: {},
        reservation: null,
        async prepareBankedReset(id) {
            assert.equal(this.reservation, null);
            prepared.push(id);
            this.reservation = id;
            return { id };
        },
        cancelBankedResetPreparation() {
            this.reservation = null;
        },
    };
    indicator._redeemBankedReset = () => assert.fail("must not redeem without confirmation");
    await indicator._confirmBankedReset("first");
    assert.equal(indicator._resetConfirmationDialog, null);
    assert.equal(modalState.dialogs.at(-1).destroyed, true);
    assert.equal(
        indicator._monitor.reservation,
        null,
        "no selected-credit reservation blocks autoapply",
    );

    modalState.canGrab = true;
    await indicator._confirmBankedReset("retry");
    assert.deepEqual(prepared, ["first", "retry"]);
    assert.equal(indicator._monitor.reservation, "retry");
    assert.equal(indicator._resetConfirmationDialog, modalState.dialogs.at(-1));
    indicator._resetConfirmationDialog.buttons[0].action();
    assert.equal(indicator._resetConfirmationDialog, null);
    assert.equal(indicator._monitor.reservation, null);
});
