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
        get vscrollbar_policy() { return this._vscrollbarPolicy; }
        set vscrollbar_policy(value) {
            this._vscrollbarPolicy = value;
            this.signals['notify::vscrollbar-policy']?.();
        }
        add_child(child) { this.children.push(child); child.parent = this; }
        connect(signal, callback) { this.signals[signal] = callback; }
        connect_after(signal, callback) {
            (this.afterSignals ??= {})[signal] ??= [];
            this.afterSignals[signal].push(callback);
        }
        emit(signal, ...args) {
            // GObject void signals ignore callback returns and then run AFTER handlers.
            this.signals[signal]?.(this, ...args);
            for (const callback of this.afterSignals?.[signal] ?? []) callback(this, ...args);
        }
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
        ActorAlign: { CENTER: 0, FILL: 1, END: 2 },
        PolicyType: { NEVER: 'never', AUTOMATIC: 'automatic' },
    };
    export const PopupBaseMenuItem = Actor;
    export class PopupSeparatorMenuItem extends Actor {}
    export class PopupMenuItem extends Actor {
        constructor(text, options = {}) {
            super(options);
            this.label = new Actor({ text });
        }
        activate(event) { this.emit('activate', event); }
        click() { if (this.reactive !== false) this.activate({ type: 'button-release' }); }
        keyPress(key) {
            if (this.reactive !== false && (key === 'Return' || key === 'space'))
                this.activate({ type: 'key-press', key });
        }
        setSensitive(sensitive) {
            this.sensitive = sensitive;
            this.reactive = sensitive;
            this.can_focus = sensitive;
        }
    }
    export class NativeMenu extends Actor {
        constructor() { super(); this.isOpen = true; this.closeCount = 0; }
        addMenuItem(item) {
            this.add_child(item);
            // PopupMenuBase._connectItemSignals uses an AFTER handler to close the top menu.
            item.connect_after('activate', () => {
                let menu = this;
                while (menu.parentMenu) menu = menu.parentMenu;
                menu.close();
            });
            if (item.menu) item.menu.parentMenu = this;
        }
        close() { this.isOpen = false; this.closeCount++; }
    }
    export class PopupSubMenuMenuItem extends PopupMenuItem {
        constructor(text) {
            super(text);
            this.menu = new NativeMenu();
            this.menu.actor = new Actor();
            this.menu.actor.vscrollbar_policy = 'never';
            this.menu.close = () => { this.menu.isOpen = false; };
            this.menu.open = () => {
                if (this.menu.isOpen) return;
                this.menu.isOpen = true;
                this.menu.signals['open-state-changed']?.(this.menu, true);
                // Shell chooses once, after emitting open-state-changed.
                this.menu.actor.vscrollbar_policy =
                    this.menu.children.length > 10 ? 'automatic' : 'never';
            };
            this.menu.removeAll = () => {
                for (const child of [...this.menu.children]) child.destroy();
            };
        }
    }
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
        if (context.parentURL === menuUrl && specifier !== "./view-model.js") {
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
        "_createErrorItem",
        "_createStatusItem",
        "_createTrendItem",
        "_createHeaderItem",
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

test("noninteractive header precedes usage and activity, then banked resets and native actions", () => {
    const calls = [];
    const menu = new CodexMeterPopupMenu({
        onRefresh: () => calls.push("refresh"),

        onOpenPreferences: () => calls.push("preferences"),
    });
    const items = [];
    menu.addToMenu({ addMenuItem: (item) => items.push(item) });
    assert.deepEqual(items, [
        menu.headerItem,
        menu.errorItem,
        menu.statusItem,
        menu.trendItem,
        items[4],
        menu.bankedResetsItem,
        menu.refreshItem,
        menu.preferencesItem,
    ]);
    assert.equal(items[4].constructor.name, "PopupSeparatorMenuItem");
    for (const item of [menu.refreshItem, menu.preferencesItem]) {
        assert.equal(item.constructor.name, "PopupMenuItem");
    }
    assert.equal(menu.bankedResetsItem.constructor.name, "PopupSubMenuMenuItem");
    assert.equal(menu.headerItem.reactive, false);
    assert.equal(menu.headerItem.can_focus, false);
    assert.deepEqual(menu.headerItem.children, [
        menu.headerItem.titleLabel,
        menu.headerItem.planLabel,
    ]);
    assert.equal(menu.headerItem.titleLabel.text, "Codex Usage");
    assert.equal(menu.headerItem.planLabel.x_expand, true);
    assert.equal(menu.headerItem.planLabel.x_align, 2);
    assert.equal(menu.headerItem.planLabel.y_align, menu.headerItem.titleLabel.y_align);
    assert.equal(menu.footerItem, undefined);
    menu.refreshItem.activate();
    menu.preferencesItem.signals.activate();
    const submenu = menu.bankedResetsItem.menu;
    assert.equal(submenu.signals["open-state-changed"], undefined);
    submenu.open();
    submenu.close();
    submenu.open();
    assert.deepEqual(calls, ["refresh", "preferences"], "submenu expansion has no fetch trigger");
    menu.setRefreshing(true);
    assert.equal(menu.refreshItem.sensitive, false);
    assert.equal(menu.refreshItem.label.text, "Refreshing…");
    menu.setRefreshing(false);
    assert.equal(menu.refreshItem.sensitive, true);
    assert.equal(menu.refreshItem.label.text, "Refresh");
});

test("native mouse and keyboard Refresh activation stays open; other actions still close", async () => {
    const { NativeMenu } = await import(stubUrl);
    for (const input of ["mouse", "Return", "space"]) {
        const nativeMenu = new NativeMenu();
        const calls = [];
        let finishRefresh;
        const pending = new Promise((resolve) => {
            finishRefresh = resolve;
        });
        const menu = new CodexMeterPopupMenu({
            onRefresh: () => {
                calls.push("refresh");
                menu.setRefreshing(true);
                void pending.then(() => menu.setRefreshing(false));
            },
            onOpenPreferences: () => {
                calls.push("preferences");
                return true;
            },
            onRedeemBankedReset: (id) => calls.push(id),
        });
        menu.addToMenu(nativeMenu);
        const activate = (item) => {
            if (input === "mouse") item.click();
            else item.keyPress(input);
        };

        activate(menu.refreshItem);
        assert.deepEqual(calls, ["refresh"], input);
        assert.equal(nativeMenu.isOpen, true, input);
        assert.equal(nativeMenu.closeCount, 0, "must not close and reopen");
        assert.equal(menu.refreshItem.label.text, "Refreshing…");
        assert.equal(menu.refreshItem.reactive, false);
        assert.equal(menu.refreshItem.can_focus, false);
        activate(menu.refreshItem);
        assert.deepEqual(calls, ["refresh"], "busy refresh cannot activate again");
        finishRefresh();
        await pending;
        assert.equal(menu.refreshItem.label.text, "Refresh");
        assert.equal(menu.refreshItem.reactive, true);
        assert.equal(menu.refreshItem.can_focus, true);
        assert.equal(nativeMenu.isOpen, true);

        // Returning true from a void activate signal must not suppress Shell's AFTER handler.
        activate(menu.preferencesItem);
        assert.deepEqual(calls, ["refresh", "preferences"]);
        assert.equal(nativeMenu.isOpen, false);
        assert.equal(nativeMenu.closeCount, 1);

        nativeMenu.isOpen = true;
        menu.setBankedResets({
            snapshot: { credits: [{ id: "selected", status: "available", title: "Gift" }] },
        });
        activate(menu.bankedResetsItem.menu.children[0]);
        assert.deepEqual(calls, ["refresh", "preferences", "selected"]);
        assert.equal(nativeMenu.isOpen, false);
        assert.equal(nativeMenu.closeCount, 2);
    }
});

test("refresh label tracks snapshots and restores the latest timestamp after busy feedback", () => {
    const menu = new CodexMeterPopupMenu({});
    assert.equal(menu.refreshItem.label.text, "Refresh");
    menu.setRefreshLabel("Refresh (last at 10:44)");
    assert.equal(menu.refreshItem.label.text, "Refresh (last at 10:44)");
    assert.equal(menu.refreshItem.sensitive, true);

    menu.setRefreshing(true);
    assert.equal(menu.refreshItem.label.text, "Refreshing…");
    assert.equal(menu.refreshItem.sensitive, false);
    menu.setRefreshLabel("Refresh (last at 10:45)");
    assert.equal(menu.refreshItem.label.text, "Refreshing…");
    assert.equal(menu.refreshItem.sensitive, false);
    menu.setRefreshing(false);
    assert.equal(menu.refreshItem.label.text, "Refresh (last at 10:45)");
    assert.equal(menu.refreshItem.sensitive, true);

    // A failed refresh leaves the last fetched snapshot's timestamp unchanged.
    menu.setRefreshing(true);
    menu.setRefreshLabel("Refresh (last at 10:45)");
    menu.setRefreshing(false);
    assert.equal(menu.refreshItem.label.text, "Refresh (last at 10:45)");
    assert.equal(menu.refreshItem.sensitive, true);

    menu.setRefreshLabel("Refresh");
    menu.setRefreshing(true);
    menu.setRefreshLabel("Refresh");
    assert.equal(menu.refreshItem.label.text, "Refreshing…");
    assert.equal(menu.refreshItem.sensitive, false);
    menu.setRefreshing(false);
    assert.equal(menu.refreshItem.label.text, "Refresh");
    assert.equal(menu.refreshItem.sensitive, true);
});

test("banked resets show inventory states and disable stale or busy redemption", () => {
    const redeemed = [];
    const menu = new CodexMeterPopupMenu({ onRedeemBankedReset: (id) => redeemed.push(id) });
    const rows = () => menu.bankedResetsItem.menu.children;
    const state = {
        count: null,
        snapshot: null,
        loading: true,
        error: null,
        preparing: false,
        redeeming: false,
    };
    menu.setBankedResets(state);
    assert.equal(rows()[0].label.text, "Loading banked resets…");
    assert.equal(rows()[0].reactive, false);
    state.loading = false;
    menu.setBankedResets(state);
    assert.equal(rows()[0].label.text, "Banked resets unavailable");
    state.snapshot = { credits: [] };
    state.count = 0;
    menu.setBankedResets(state);
    assert.equal(rows()[0].label.text, "No banked resets available");
    assert.equal(menu.bankedResetsItem.label.text, "Banked resets (0)");
    state.snapshot.credits = [{ id: "a", status: "available", title: "Gift" }];
    menu.setBankedResets(state);
    const availableRow = rows()[0];
    availableRow.signals.activate();
    assert.deepEqual(redeemed, ["a"]);
    menu.setBankedResets(state);
    assert.equal(rows()[0], availableRow, "unchanged sync preserves keyboard focus");
    for (const field of ["loading", "preparing", "redeeming", "error"]) {
        state[field] = field === "error" ? "Network failed" : true;
        menu.setBankedResets(state);
        if (field !== "preparing") assert.equal(rows()[0].reactive, false);
        assert.equal(rows().at(-1).sensitive, false);
        rows().at(-1).signals.activate();
        assert.deepEqual(redeemed, ["a"]);
        if (field === "error") assert.match(rows()[0].label.text, /unavailable: Network failed/);
        state[field] = field === "error" ? null : false;
    }
});

test("manual validation checks only the selected row and restores labels on completion or failure", (t) => {
    t.mock.method(Date, "now", () => Date.parse("2030-01-31T00:00:00Z"));
    const redeemed = [];
    const menu = new CodexMeterPopupMenu({ onRedeemBankedReset: (id) => redeemed.push(id) });
    const state = {
        snapshot: {
            credits: [
                {
                    id: "first",
                    status: "available",
                    title: "Reward",
                    reset_type: "usage_limit",
                    expires_at: "2030-02-01T00:00:00Z",
                },
                { id: "second", status: "available", title: "Weekly reset", reset_type: "weekly" },
            ],
        },
        loading: false,
        error: null,
        preparing: false,
        preparingId: null,
    };
    const rows = () => menu.bankedResetsItem.menu.children;
    const labels = () => rows().map((row) => row.label.text);
    menu.setBankedResets(state);
    const originalLabels = labels();
    assert.deepEqual(originalLabels, [
        "Reward (Usage limit) · Expires in 1d 0h",
        "Weekly reset · Expiry unknown",
    ]);
    for (const error of [null, "Validation failed"]) {
        Object.assign(state, {
            preparing: true,
            preparingId: "second",
            loading: true,
            error: null,
        });
        menu.setBankedResets(state);
        assert.deepEqual(labels(), [originalLabels[0], "Weekly reset · Checking…"]);
        // Changing only the selected ID must invalidate the UI cache.
        state.preparingId = "first";
        menu.setBankedResets(state);
        assert.deepEqual(labels(), ["Reward (Usage limit) · Checking…", originalLabels[1]]);
        for (const row of rows()) {
            assert.equal(row.sensitive, false);
            row.signals.activate();
        }
        assert.deepEqual(redeemed, []);
        // Inventory settles before preparation's finally block, including on failure.
        Object.assign(state, { loading: false, error });
        menu.setBankedResets(state);
        assert.deepEqual(labels(), ["Reward (Usage limit) · Checking…", originalLabels[1]]);
        Object.assign(state, { preparing: false, error: null });
        menu.setBankedResets(state);
        assert.deepEqual(labels(), originalLabels, "reservation ID alone must not show checking");
        for (const row of rows()) assert.equal(row.sensitive, true);
    }
});

test("banked reset rows sort soonest expiry first, format metadata, and select the exact ID", (t) => {
    t.mock.method(Date, "now", () => Date.parse("2030-01-31T00:00:00Z"));
    const redeemed = [];
    const menu = new CodexMeterPopupMenu({ onRedeemBankedReset: (id) => redeemed.push(id) });
    const credits = [
        {
            id: "unknown",
            status: "available",
            title: "Gift",
            reset_type: "usage_limit",
            expires_at: "invalid",
        },
        {
            id: "late",
            status: "available",
            title: "Weekly reset",
            reset_type: "weekly",
            expires_at: "2030-12-01T00:00:00Z",
        },
        { id: "spent", status: "redeemed", title: "Spent", expires_at: "2030-01-01T00:00:00Z" },
        {
            id: "soon",
            status: "available",
            title: "Reward",
            reset_type: "usage_limit",
            expires_at: "2030-02-01T00:00:00Z",
        },
        { id: "missing", status: "available" },
    ];
    menu.setBankedResets({ count: 4, snapshot: { credits }, loading: false, error: null });
    const rows = menu.bankedResetsItem.menu.children;
    assert.equal(rows.length, 4);
    assert.equal(rows[0].label.text, "Reward (Usage limit) · Expires in 1d 0h");
    assert.match(rows[1].label.text, /^Weekly reset · Expires in \d+d \d+h$/);
    assert.equal(rows[2].label.text, "Gift (Usage limit) · Expiry unknown");
    for (const row of rows) {
        assert.equal(row.constructor.name, "PopupMenuItem");
        assert.doesNotMatch(row.label.text, /[\r\n]/);
        assert.doesNotMatch(row.label.text, /2030|\d{2}:\d{2}|\d{4}-\d{2}-\d{2}/);
    }
    assert.equal(rows[3].label.text, "Usage limit reset · Expiry unknown");
    for (const row of rows) row.signals.activate();
    assert.deepEqual(redeemed, ["soon", "late", "unknown", "missing"]);
    assert.equal(credits[0].id, "unknown", "sorting does not mutate monitor inventory");
});

test("banked reset titles retain existing type details without duplicated parentheses", () => {
    const menu = new CodexMeterPopupMenu({});
    const titles = [
        ["Full reset (Weekly + 5hr)", "full", "Full reset (Weekly + 5hr)"],
        ["Full reset (Weekly + 5hr)", "usage_limit", "Full reset (Weekly + 5hr)"],
        ["Full reset", "full", "Full reset"],
        ["Reward", "weekly", "Reward (Weekly)"],
        [null, "usage_limit", "Usage limit reset"],
        ["Special reward", null, "Special reward"],
    ];
    menu.setBankedResets({
        snapshot: {
            credits: titles.map(([title, reset_type], index) => ({
                id: String(index),
                status: "available",
                title,
                reset_type,
            })),
        },
    });
    assert.deepEqual(
        menu.bankedResetsItem.menu.children.map((row) => row.label.text),
        titles.map(([, , title]) => `${title} · Expiry unknown`),
    );
});

test("native submenu stays scrollable when a large inventory arrives after opening", async () => {
    let finishLoading;
    const loaded = new Promise((resolve) => {
        finishLoading = resolve;
    });
    const menu = new CodexMeterPopupMenu({});
    const refresh = loaded.then(() => {
        menu.setBankedResets({
            snapshot: {
                credits: Array.from({ length: 100 }, (_, index) => ({
                    id: String(index),
                    status: "available",
                    title: `Reset ${index}`,
                })),
            },
            loading: false,
        });
    });
    menu.setBankedResets({ snapshot: null, loading: true });
    const submenu = menu.bankedResetsItem.menu;
    submenu.open();
    assert.equal(submenu.isOpen, true);
    assert.equal(submenu.children[0].label.text, "Loading banked resets…");
    finishLoading();
    await refresh;
    assert.equal(submenu.isOpen, true);
    assert.equal(submenu.children.length, 100);
    assert.equal(submenu.actor.vscrollbar_policy, "automatic");
    menu.setBankedResets({ snapshot: { credits: [] }, loading: false });
    submenu.close();
    submenu.open();
    assert.equal(
        submenu.actor.vscrollbar_policy,
        "automatic",
        "Shell's next open must not restore NEVER",
    );
});

test("expired available resets disappear even when inventory data is unchanged", (t) => {
    const now = Date.parse("2030-01-01T00:00:00Z");
    t.mock.method(Date, "now", () => now);
    const selected = [];
    const menu = new CodexMeterPopupMenu({ onRedeemBankedReset: (id) => selected.push(id) });
    const state = {
        snapshot: {
            credits: [
                { id: "past", status: "available", expires_at: new Date(now - 1).toISOString() },
                { id: "boundary", status: "available", expires_at: new Date(now).toISOString() },
                { id: "future", status: "available", expires_at: new Date(now + 1).toISOString() },
                { id: "missing", status: "available" },
                { id: "invalid", status: "available", expires_at: "invalid" },
                { id: "spent", status: "redeemed" },
            ],
        },
    };
    menu.setBankedResets(state);
    for (const row of menu.bankedResetsItem.menu.children) row.signals.activate();
    assert.deepEqual(selected, ["future", "missing", "invalid"]);
    t.mock.method(Date, "now", () => now + 2);
    menu.setBankedResets(state);
    selected.length = 0;
    for (const row of menu.bankedResetsItem.menu.children) row.signals.activate();
    assert.deepEqual(selected, ["missing", "invalid"]);
    menu.setBankedResets({ snapshot: { credits: [state.snapshot.credits[0]] } });
    assert.equal(menu.bankedResetsItem.menu.children[0].label.text, "No banked resets available");
});
