import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const menuUrl = new URL("../src/panel/menu.js", import.meta.url).href;
// Stub GNOME actors so menu construction and updates can run without GNOME Shell.
const stubUrl = `data:text/javascript,${encodeURIComponent(
    `class Actor {
        constructor(options = {}) {
            Object.assign(this, options);
            this.children = [];
            this.clutter_text = {};
            this.signals = {};
        }
        add_child(child) { this.children.push(child); child.parent = this; }
        connect(signal, callback) { this.signals[signal] = callback; }
        add_style_class_name(name) { (this.classes ??= new Set()).add(name); }
        remove_style_class_name(name) { this.classes?.delete(name); }
        destroy() {
            this.destroyed = true;
            this.signals = {};
            for (const child of [...this.children]) child.destroy();
            if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
        }
    }
    export default {
        BoxLayout: Actor, Icon: Actor, Label: Actor, Button: Actor, Widget: Actor,
        ActorAlign: { CENTER: 0, FILL: 1 },
    };
    export const PopupBaseMenuItem = Actor;
    export const PopupSeparatorMenuItem = Actor;
    export const createIconButton = null, createTextButton = null;
    export class UsageBar {
        constructor() {
            this.actor = new Actor();
            this.actor.connect('notify::width', () => this.sync());
            this.syncCount = 0;
        }
        update(state) { this.state = state; }
        sync() { this.syncCount += 1; }
    }`,
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

test("reconciles usage rows through 0 -> 3 -> 1 -> 0 and updates all row data", (t) => {
    for (const method of [
        "_createHeaderItem",
        "_createErrorItem",
        "_createStatusItem",
        "_createTrendItem",
        "_createFooterItem",
    ]) {
        t.mock.method(CodexMeterPopupMenu.prototype, method, () => ({}));
    }
    const menu = new CodexMeterPopupMenu({});
    const items = [];
    menu.addToMenu({
        addMenuItem(item, position = items.length) {
            items.splice(position, 0, item);
            if (item.destroy) {
                const destroy = item.destroy.bind(item);
                item.destroy = () => {
                    items.splice(items.indexOf(item), 1);
                    destroy();
                };
            }
        },
    });
    const fixedItems = [...items];
    assert.deepEqual(menu.usageItems, []);
    menu.syncBars();
    const viewModels = ["a", "b", "c"].map((id, index) => ({
        id,
        visible: index !== 1,
        title: `Usage ${id}`,
        value: `${index * 10}%`,
        percentLabel: "used",
        prediction: `Prediction ${id}`,
        predictionStyle: ["safe", "warning", "danger"][index],
        reset: `Reset ${id}`,
        percentValue: index * 10,
        displayPercentValue: 100 - index * 10,
        displayBaselinePercentValue: index * 20,
    }));
    const assertRow = (item, vm) => {
        assert.equal(item.visible, vm.visible);
        assert.equal(item.titleLabel.text, vm.title);
        assert.equal(item.valueLabel.text, `${vm.value} ${vm.percentLabel}`);
        assert.equal(item.predictionLabel.text, vm.prediction);
        assert.equal(item.resetLabel.text, vm.reset);
        assert.deepEqual(
            item.predictionLabel.classes,
            new Set([
                vm.predictionStyle === "safe"
                    ? "cx-color-green"
                    : vm.predictionStyle === "muted"
                      ? "cx-muted"
                      : `cx-color-${vm.predictionStyle}`,
            ]),
        );
        assert.deepEqual(item.usageBar.state, {
            percentValue: vm.percentValue,
            displayPercentValue: vm.displayPercentValue,
            displayBaselinePercentValue: vm.displayBaselinePercentValue,
        });
    };
    menu.setUsageItems(viewModels);
    const rows = [...menu.usageItems];
    assert.deepEqual(items, [...fixedItems.slice(0, 3), ...rows, ...fixedItems.slice(3)]);
    rows.forEach((item, index) => assertRow(item, viewModels[index]));
    menu.syncBars();
    assert.deepEqual(
        rows.map((item) => item.usageBar.syncCount),
        [1, 1, 1],
    );

    const reordered = [...viewModels].reverse();
    menu.setUsageItems(reordered);
    assert.deepEqual(menu.usageItems, rows);
    rows.forEach((item, index) => assertRow(item, reordered[index]));
    assert.deepEqual(items, [...fixedItems.slice(0, 3), ...rows, ...fixedItems.slice(3)]);

    const updated = {
        ...viewModels[2],
        visible: false,
        predictionStyle: "muted",
        title: "Changed",
        value: "42%",
        percentLabel: "left",
        prediction: "",
        reset: "Later",
        percentValue: 42,
        displayPercentValue: 58,
        displayBaselinePercentValue: null,
    };
    menu.setUsageItems([updated]);
    assert.equal(menu.usageItems[0], rows[0]);
    assertRow(rows[0], updated);
    for (const row of rows.slice(1)) {
        assert.equal(row.destroyed, true);
        assert.equal(row.usageBar.actor.destroyed, true);
        assert.deepEqual(row.usageBar.actor.signals, {});
    }
    assert.deepEqual(items, [...fixedItems.slice(0, 3), rows[0], ...fixedItems.slice(3)]);
    menu.syncBars();
    assert.deepEqual(
        rows.map((item) => item.usageBar.syncCount),
        [2, 1, 1],
    );
    menu.setUsageItems([]);
    menu.syncBars();
    assert.equal(rows[0].destroyed, true);
    assert.deepEqual(menu.usageItems, []);
    assert.deepEqual(items, fixedItems);
    assert.deepEqual(
        rows.map((item) => item.usageBar.syncCount),
        [2, 1, 1],
    );
});

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
    for (const rowVisible of [false, true]) {
        for (const rowCount of [0, 1, 3]) {
            for (const trendVisible of [false, true]) {
                const menu = Object.create(CodexMeterPopupMenu.prototype);
                menu.errorItem = { visible: false, setDetails() {} };
                const actor = (visible) =>
                    Object.defineProperty({}, "visible", {
                        get: () => visible,
                        set: () => assert.fail("setError must not write usage or trend visibility"),
                    });
                menu.usageItems = Array.from({ length: rowCount }, () => actor(rowVisible));
                menu.trendItem = actor(trendVisible);

                for (const message of ["Unable to refresh", null, ""]) {
                    menu.setError(message);
                    for (const item of menu.usageItems) assert.equal(item.visible, rowVisible);
                    assert.equal(menu.trendItem.visible, trendVisible);
                }
            }
        }
    }
});
