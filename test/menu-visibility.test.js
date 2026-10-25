import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const menuUrl = new URL("../src/panel/menu.js", import.meta.url).href;
// Stub GNOME actors so banner construction and expansion can run without GNOME Shell.
const stubUrl = `data:text/javascript,${encodeURIComponent(
    `class Actor {
        constructor(options = {}) {
            Object.assign(this, options);
            this.children = [];
            this.clutter_text = {};
            this.signals = {};
        }
        add_child(child) { this.children.push(child); }
        connect(signal, callback) { this.signals[signal] = callback; }
    }
    export default {
        BoxLayout: Actor, Icon: Actor, Label: Actor, Button: Actor,
        ActorAlign: { CENTER: 0, FILL: 1 },
    };
    export const PopupBaseMenuItem = Actor;
    export const createIconButton = null, createTextButton = null, UsageBar = null;`,
)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (context.parentURL === menuUrl) {
            return { url: stubUrl, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});
let CodexMeterPopupMenu;
try {
    ({ CodexMeterPopupMenu } = await import(menuUrl));
} finally {
    hooks.deregister();
}

test("banners preserve expansion defaults and user toggles across detail updates", () => {
    const menu = Object.create(CodexMeterPopupMenu.prototype);
    menu.errorItem = menu._createErrorItem();
    menu.statusItem = menu._createStatusItem();

    for (const [item, update, initiallyExpanded] of [
        [menu.errorItem, (message) => menu.setError(message), true],
        [
            menu.statusItem,
            (message) => menu.setStatus({ title: "Showing cached data", message, visible: true }),
            false,
        ],
    ]) {
        const [heading, message] = item.children[0].children;
        const expander = heading.child.children[2];
        const assertExpanded = (expanded) => {
            assert.equal(message.visible, expanded);
            assert.equal(expander.icon_name, expanded ? "pan-down-symbolic" : "pan-end-symbolic");
            assert.equal(
                heading.accessible_name,
                `${expanded ? "Hide" : "Show"} ${item.titleLabel.text.toLowerCase()} details`,
            );
        };

        assert.equal(item.visible, false);
        assert.equal(message.text, "");
        assertExpanded(false);
        assert.equal(expander.visible, false);
        assert.equal(heading.reactive, false);
        assert.equal(heading.can_focus, false);

        update("First details");
        assert.equal(item.visible, true);
        assert.equal(message.text, "First details");
        assert.equal(expander.visible, true);
        assert.equal(heading.reactive, true);
        assert.equal(heading.can_focus, true);
        assertExpanded(initiallyExpanded);

        heading.signals.clicked();
        assertExpanded(!initiallyExpanded);
        update("First details");
        assertExpanded(!initiallyExpanded);
        update("Changed details");
        assertExpanded(initiallyExpanded);

        for (const empty of ["", null, undefined]) {
            update(empty);
            assert.equal(message.text, "");
            assertExpanded(false);
            assert.equal(expander.visible, false);
            assert.equal(heading.reactive, false);
            assert.equal(heading.can_focus, false);
        }
        update("First details");
        assertExpanded(initiallyExpanded);
    }
});

test("setError shows and clears the error banner without changing detail expansion behavior", () => {
    const details = [];
    const menu = Object.create(CodexMeterPopupMenu.prototype);
    menu.errorItem = {
        visible: false,
        setDetails: (...args) => details.push(args),
    };

    menu.setError("Unable to refresh");
    assert.equal(menu.errorItem.visible, true);
    assert.deepEqual(details.at(-1), ["Unable to refresh", true]);

    for (const message of [null, "", undefined]) {
        menu.setError(message);
        assert.equal(menu.errorItem.visible, false);
        assert.deepEqual(details.at(-1), [message, true]);
    }
});

test("setError never writes view-model-owned usage or trend visibility", () => {
    for (const primaryVisible of [false, true]) {
        for (const secondaryVisible of [false, true]) {
            for (const trendVisible of [false, true]) {
                const menu = Object.create(CodexMeterPopupMenu.prototype);
                menu.errorItem = { visible: false, setDetails() {} };
                for (const [name, visible] of [
                    ["primaryItem", primaryVisible],
                    ["secondaryItem", secondaryVisible],
                    ["trendItem", trendVisible],
                ]) {
                    menu[name] = Object.defineProperty({}, "visible", {
                        get: () => visible,
                        set: () => assert.fail(`setError must not write ${name}.visible`),
                    });
                }

                for (const message of ["Unable to refresh", null, ""]) {
                    menu.setError(message);
                    assert.equal(menu.primaryItem.visible, primaryVisible);
                    assert.equal(menu.secondaryItem.visible, secondaryVisible);
                    assert.equal(menu.trendItem.visible, trendVisible);
                }
            }
        }
    }
});
