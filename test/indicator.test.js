import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const indicatorUrl = new URL("../src/panel/indicator.js", import.meta.url).href;
const stubUrl = `data:text/javascript,${encodeURIComponent(`
    export class Actor {
        constructor(options = {}) {
            Object.assign(this, options);
            this.children = [];
            this.classes = new Set();
            this.signals = {};
        }
        add_child(child) { this.children.push(child); child.parent = this; }
        add_style_class_name(name) { this.classes.add(name); }
        remove_style_class_name(name) { this.classes.delete(name); }
        set_style(style) { this.style = style; }
        destroy() {
            this.destroyed = true;
            this.signals = {};
            if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
        }
    }
    export default {
        registerClass() {}, BoxLayout: Actor, ActorAlign: { CENTER: 0 },
    };
    export const Button = Actor;
    export const readSettings = settings => settings;
    export const createPanelBarViewModel = (_settings, snapshot) => snapshot.panel;
    export const createMenuViewModel = (_settings, snapshot) => snapshot.menu;
    export const confirmations = [];
    export const CodexMeterPopupMenu = null;
    export function showBankedResetConfirmation(credit, callbacks) {
        const dialog = { credit, callbacks, destroy() { this.destroyed = true; } };
        confirmations.push(dialog);
        return dialog;
    }
    export class UsageRing {
        constructor() { this.actor = new Actor(); }
        update(bars) { this.bars = bars; }
    }
    export class UsageBar {
        constructor() {
            this.actor = new Actor();
            this.actor.signals['notify::width'] = () => {};
        }
        update(state) { this.state = state; }
    }
`)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (context.parentURL === indicatorUrl) return { url: stubUrl, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});
let CodexMeterIndicator;
try {
    ({ CodexMeterIndicator } = await import(indicatorUrl));
} finally {
    hooks.deregister();
}

function createIndicator() {
    const indicator = Object.create(CodexMeterIndicator.prototype);
    indicator._settings = { topPanelIndicatorIcon: "text" };
    indicator._monitor = {
        state: { snapshot: {} },
        cancellationCount: 0,
        cancelBankedResetPreparation() {
            this.cancellationCount++;
        },
    };
    indicator._panelBars = indicator._createPanelBars();
    indicator._usageRing = {
        actor: new indicator._panelBars.constructor(),
        update(bars) {
            this.bars = bars;
        },
    };
    for (const name of ["_label", "_prefixLabel", "_codexIcon", "_openAiIcon"]) {
        indicator[name] = new indicator._panelBars.constructor();
    }
    return indicator;
}

test("panel reconciles 0 -> 3 -> 1 -> 0 bars, replacing all data and destroying removed actors", () => {
    const indicator = createIndicator();
    const panel = { bars: [], showBars: false, showLabel: true, label: "--" };
    indicator._monitor.state.snapshot.panel = panel;
    indicator._syncLabel();
    assert.deepEqual(indicator._panelUsageBars, []);
    assert.equal(indicator._panelBars.visible, false);

    panel.bars = [
        { id: "a", percentValue: 10, displayPercentValue: 90 },
        { id: "b", percentValue: 20, displayPercentValue: 80 },
        { id: "c", percentValue: 30, displayPercentValue: 70 },
    ];
    panel.showBars = true;
    panel.label = "10% / 20% / 30%";
    indicator._syncLabel();
    const bars = [...indicator._panelUsageBars];
    assert.deepEqual(
        indicator._panelBars.children,
        bars.map((bar) => bar.actor),
    );
    assert.deepEqual(
        bars.map((bar) => bar.state),
        panel.bars.map(({ percentValue, displayPercentValue }) => ({
            percentValue,
            displayPercentValue,
        })),
    );
    assert.equal(indicator._panelBars.visible, true);
    assert.equal(indicator._panelBars.classes.has("cx-panel-bars-stacked"), true);
    assert.equal(indicator._panelBars.style, "spacing: 1.5px;");
    for (const bar of bars) assert.equal(bar.actor.style, `height: ${0.52 / 3}em;`);
    assert.equal(indicator._label.text, panel.label);
    assert.equal(indicator._label.classes.has("cx-usage-label-wide"), true);

    panel.bars = [...panel.bars].reverse();
    indicator._syncLabel();
    assert.deepEqual(indicator._panelUsageBars, bars);
    assert.deepEqual(
        bars.map((bar) => bar.state),
        [
            { percentValue: 30, displayPercentValue: 70 },
            { percentValue: 20, displayPercentValue: 80 },
            { percentValue: 10, displayPercentValue: 90 },
        ],
    );

    panel.bars = [{ id: "c", percentValue: 45, displayPercentValue: 55 }];
    panel.label = "45%";
    panel.showLabel = false;
    indicator._syncLabel();
    assert.equal(indicator._panelUsageBars[0], bars[0]);
    assert.deepEqual(bars[0].state, { percentValue: 45, displayPercentValue: 55 });
    assert.equal(bars[0].actor.style, null);
    assert.equal(indicator._panelBars.style, null);
    assert.equal(indicator._panelBars.classes.has("cx-panel-bars-stacked"), false);
    assert.equal(indicator._label.visible, false);
    assert.equal(indicator._label.text, "45%");
    assert.equal(indicator._label.classes.has("cx-usage-label-wide"), false);
    for (const bar of bars.slice(1)) {
        assert.equal(bar.actor.destroyed, true);
        assert.deepEqual(bar.actor.signals, {});
    }
    assert.deepEqual(indicator._panelBars.children, [bars[0].actor]);

    panel.bars = [];
    panel.showBars = false;
    indicator._syncLabel();
    assert.deepEqual(indicator._panelUsageBars, []);
    assert.deepEqual(indicator._panelBars.children, []);
    assert.equal(bars[0].actor.destroyed, true);
    assert.equal(indicator._panelBars.visible, false);
});

test("circular style replaces one or two bars and falls back without losing quotas", () => {
    const indicator = createIndicator();
    indicator._settings.topPanelIndicatorIcon = "codex-ring";
    const panel = { bars: [], showBars: true, showLabel: false, label: "" };
    indicator._monitor.state.snapshot.panel = panel;
    for (const count of [0, 1, 2, 3, 2]) {
        panel.bars = Array.from({ length: count }, (_, index) => ({
            id: String(index),
            percentValue: 20 + index,
            displayPercentValue: 80 - index,
        }));
        indicator._syncLabel();
        const showRing = count > 0 && count <= 2;
        assert.equal(indicator._usageRing.actor.visible, showRing);
        assert.deepEqual(indicator._usageRing.bars, showRing ? panel.bars : []);
        assert.equal(indicator._panelBars.visible, !showRing);
        assert.equal(indicator._codexIcon.visible, !showRing);
        assert.equal(indicator._panelUsageBars.length, count);
    }
    panel.showBars = false;
    panel.showLabel = true;
    panel.label = "80%/79%";
    indicator._syncLabel();
    assert.equal(indicator._usageRing.actor.visible, false);
    assert.deepEqual(indicator._usageRing.bars, []);
    assert.equal(indicator._panelBars.visible, false);
    assert.equal(indicator._codexIcon.visible, true);
    assert.equal(indicator._label.visible, true);

    panel.showBars = true;
    indicator._settings.topPanelIndicatorIcon = "openai";
    indicator._syncLabel();
    assert.equal(indicator._usageRing.actor.visible, false);
    assert.equal(indicator._panelBars.visible, true);
    assert.equal(indicator._openAiIcon.visible, true);
    assert.equal(indicator._codexIcon.visible, false);
});

test("main menu opening requests stale-aware inventory without waiting or delaying bar sync", async () => {
    const indicator = createIndicator();
    let openChanged;
    let refreshCount = 0;
    let syncCount = 0;
    let finishRefresh;
    const pending = new Promise((resolve) => {
        finishRefresh = resolve;
    });
    indicator.menu = {
        connect(signal, callback) {
            assert.equal(signal, "open-state-changed");
            openChanged = callback;
            return 1;
        },
        open() {
            const result = openChanged(this, true);
            assert.equal(result, undefined, "opening must not return a refresh promise");
            this.isOpen = true;
        },
        close() {
            openChanged(this, false);
            this.isOpen = false;
        },
    };
    indicator._settings.connect = () => 2;
    indicator._queueMenuBarSync = () => syncCount++;
    indicator._monitor.refreshBankedResets = (options) => {
        assert.deepEqual(options, { maxAgeMs: 5 * 60 * 1000 });
        refreshCount++;
        return pending;
    };
    indicator._connectSignals();
    indicator.menu.open();
    assert.equal(indicator.menu.isOpen, true);
    assert.equal(refreshCount, 1);
    assert.equal(syncCount, 1, "bar sync is queued while inventory is still pending");
    indicator.menu.close();
    assert.equal(refreshCount, 1, "closing must not refresh inventory");
    assert.equal(syncCount, 1);
    indicator.menu.open();
    assert.equal(refreshCount, 2, "each main menu opening requests one refresh");
    assert.equal(syncCount, 2);
    finishRefresh();
    await pending;
    assert.equal(refreshCount, 2);
});

test("menu sync passes the full usage collection and other view-model fields", () => {
    const indicator = createIndicator();
    const calls = {};
    indicator._popupMenu = { headerItem: { planLabel: {} } };
    for (const method of [
        "setUsageItems",
        "setError",
        "setStatus",
        "setTrend",
        "setBankedResets",
        "setRefreshLabel",
    ]) {
        indicator._popupMenu[method] = (value) => {
            calls[method] = value;
        };
    }
    const menu = {
        usageItems: [{ id: "a" }, { id: "b" }, { id: "c" }],
        errorMessage: "Refresh failed",
        statusTitle: "Cached data",
        statusMessage: "Try again later",
        trend: { visible: true, bars: [10, 20] },
        accountType: "Plus",
        refreshLabel: "Refresh (last at 01:40)",
    };
    Object.assign(indicator._monitor.state, {
        snapshot: { menu },
        bankedResetCount: 2,
        bankedResetSnapshot: { credits: [{ id: "selected" }] },
        bankedResetLoading: true,
        bankedResetError: "Inventory failed",
        preparingBankedReset: false,
        preparingBankedResetId: "selected",
        redeemingBankedReset: true,
    });
    for (const usageItems of [menu.usageItems, [menu.usageItems[2]], []]) {
        menu.usageItems = usageItems;
        indicator._syncMenu();
        assert.equal(calls.setUsageItems, usageItems);
    }
    assert.equal(calls.setError, menu.errorMessage);
    assert.deepEqual(calls.setStatus, {
        title: menu.statusTitle,
        message: menu.statusMessage,
        visible: true,
    });
    assert.equal(calls.setTrend, menu.trend);
    assert.deepEqual(calls.setBankedResets, {
        count: 2,
        snapshot: indicator._monitor.state.bankedResetSnapshot,
        loading: true,
        error: "Inventory failed",
        preparing: false,
        preparingId: "selected",
        redeeming: true,
    });
    assert.equal(indicator._popupMenu.headerItem.planLabel.text, "Plus");
    assert.equal(calls.setRefreshLabel, menu.refreshLabel);
    menu.refreshLabel = "Refresh (last at 10:44)";
    indicator._syncMenu();
    assert.equal(calls.setRefreshLabel, "Refresh (last at 10:44)");
});

test("selected reset ID is prepared and only that credit is confirmed and redeemed", async () => {
    const { confirmations } = await import(stubUrl);
    const indicator = createIndicator();
    const credit = { id: "chosen", title: "Selected reward" };
    const prepared = [];
    const redeemed = [];
    let closed = 0;
    indicator.menu = { close: () => closed++ };
    indicator._monitor.prepareBankedReset = async (id) => {
        prepared.push(id);
        return credit;
    };
    indicator._redeemBankedReset = async (id) => {
        redeemed.push(id);
    };
    await indicator._confirmBankedReset("chosen");
    assert.deepEqual(prepared, ["chosen"]);
    assert.equal(closed, 1);
    const dialog = confirmations.at(-1);
    assert.equal(dialog.credit, credit);
    assert.deepEqual(redeemed, []);
    assert.equal(indicator._monitor.cancellationCount, 0);
    await indicator._confirmBankedReset("other");
    assert.deepEqual(prepared, ["chosen"], "an open confirmation prevents another selection");
    dialog.callbacks.onConfirm();
    assert.deepEqual(redeemed, ["chosen"]);
    assert.equal(
        indicator._monitor.cancellationCount,
        0,
        "confirmation keeps reservation until redemption",
    );
    assert.equal(indicator._resetConfirmationDialog, null);
});

test("missing selection, cancellation, busy state and destruction never redeem a replacement", async () => {
    const { confirmations } = await import(stubUrl);
    const indicator = createIndicator();
    let closed = 0;
    let prepared = 0;
    indicator.menu = { close: () => closed++ };
    indicator._redeemBankedReset = () => assert.fail("must not redeem");
    indicator._monitor.prepareBankedReset = async () => {
        prepared++;
        return null;
    };
    const previousCount = confirmations.length;
    await indicator._confirmBankedReset("gone");
    assert.equal(closed, 0);
    assert.equal(confirmations.length, previousCount);
    for (const field of ["preparingBankedReset", "redeemingBankedReset"]) {
        indicator._monitor.state[field] = true;
        await indicator._confirmBankedReset("busy");
        indicator._monitor.state[field] = false;
    }
    assert.equal(prepared, 1);
    indicator._monitor.prepareBankedReset = async (id) => ({ id });
    await indicator._confirmBankedReset("cancelled");
    confirmations.at(-1).callbacks.onCancel();
    assert.equal(indicator._resetConfirmationDialog, null);
    assert.equal(indicator._monitor.cancellationCount, 1);
    indicator._monitor.prepareBankedReset = async (id) => {
        indicator._destroyed = true;
        return { id };
    };
    await indicator._confirmBankedReset("destroyed");
    assert.equal(confirmations.length, previousCount + 1);
    assert.equal(
        indicator._monitor.cancellationCount,
        2,
        "late preparation releases the unused credit",
    );
});

test("destroy releases a selected reset and destroys its confirmation dialog", async () => {
    const { confirmations } = await import(stubUrl);
    const indicator = createIndicator();
    indicator.menu = { close() {} };
    indicator._monitor.prepareBankedReset = async (id) => ({ id });
    await indicator._confirmBankedReset("selected");
    const dialog = confirmations.at(-1);
    indicator.destroy();
    assert.equal(indicator._monitor.cancellationCount, 1);
    assert.equal(indicator._resetConfirmationDialog, null);
    assert.equal(dialog.destroyed, true);
});

test("destroy while preparation is pending releases any credit returned afterward", async () => {
    const indicator = createIndicator();
    let finish;
    indicator._monitor.prepareBankedReset = () =>
        new Promise((resolve) => {
            finish = resolve;
        });
    const pending = indicator._confirmBankedReset("selected");
    indicator.destroy();
    assert.equal(indicator._monitor.cancellationCount, 1);
    finish({ id: "selected" });
    await pending;
    assert.equal(indicator._monitor.cancellationCount, 2);
    assert.equal(indicator._resetConfirmationDialog, null);
});
