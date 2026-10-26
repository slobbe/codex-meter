import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const indicatorUrl = new URL("../src/panel/indicator.js", import.meta.url).href;
const confirmationUrl = new URL("../src/panel/reset-confirmation.js", import.meta.url).href;
const stubUrl = `data:text/javascript,${encodeURIComponent(`
    class Actor {
        constructor(options = {}) {
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

test("failed modal grab releases the reservation and allows a subsequent selection", async () => {
    modalState.canGrab = false;
    const indicator = Object.create(CodexMeterIndicator.prototype);
    indicator._resetConfirmationDialog = null;
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
