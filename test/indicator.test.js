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
    export const CodexMeterPopupMenu = null, showBankedResetConfirmation = null;
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
    indicator._monitor = { state: { snapshot: {} } };
    indicator._panelBars = indicator._createPanelBars();
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

test("menu sync passes the full usage collection and other view-model fields", () => {
    const indicator = createIndicator();
    const calls = {};
    indicator._popupMenu = { footerItem: { planLabel: {} } };
    for (const method of [
        "setUsageItems",
        "setError",
        "setStatus",
        "setTrend",
        "setBankedResets",
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
        plan: "Pro",
    };
    Object.assign(indicator._monitor.state, {
        snapshot: { menu },
        bankedResetCount: 2,
        preparingBankedReset: false,
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
    assert.deepEqual(calls.setBankedResets, { count: 2, preparing: false, redeeming: true });
    assert.equal(indicator._popupMenu.footerItem.planLabel.text, menu.plan);
});
