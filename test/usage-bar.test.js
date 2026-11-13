import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const stubUrl = `data:text/javascript,${encodeURIComponent(`
    class Actor {
        constructor(options = {}) {
            Object.assign(this, options);
            this.children = [];
            this.classes = new Set();
            this.width = 100;
            this.height = 10;
        }
        add_child(actor) { this.children.push(actor); }
        connect() {}
        add_style_class_name(name) { this.classes.add(name); }
        remove_style_class_name(name) { this.classes.delete(name); }
    }
    export default {
        Widget: Actor, BoxLayout: Actor, FixedLayout: class {},
        ActorAlign: { CENTER: 0, START: 1, FILL: 2 },
    };
`)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier.startsWith("gi://")) return { url: stubUrl, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});
let UsageBar;
try {
    ({ UsageBar } = await import("../src/panel/usage-bar.js"));
} finally {
    hooks.deregister();
}

test("panel bars use pace colors and clear the previous color on updates", () => {
    const bar = new UsageBar("panel");
    for (const [percentValue, colorStyleClass] of [
        [20, "cx-color-warning"],
        [90, "cx-color-safe"],
        [100, "cx-color-exhausted"],
        [20, "cx-color-safe"],
        [90, undefined],
    ]) {
        bar.update({ percentValue, displayPercentValue: 100 - percentValue, colorStyleClass });
        assert.deepEqual([...bar._barFill.classes], [colorStyleClass ?? "cx-color-safe"]);
        assert.equal(bar._barFill.width, 100 - percentValue);
    }
});

test("popup bars use pace colors while preserving fill and baseline markers", () => {
    const bar = new UsageBar("menu");
    for (const [percentValue, colorStyleClass] of [
        [20, "cx-color-warning"],
        [90, "cx-color-safe"],
        [100, "cx-color-exhausted"],
        [20, "cx-color-safe"],
        [90, undefined],
    ]) {
        for (const displayPercentValue of [percentValue, 100 - percentValue]) {
            bar.update({
                percentValue,
                displayPercentValue,
                displayBaselinePercentValue: 50,
                colorStyleClass,
            });
            assert.deepEqual([...bar._barFill.classes], [colorStyleClass ?? "cx-color-safe"]);
            assert.equal(bar._barFill.width, displayPercentValue);
            assert.equal(bar._barMarker.visible, true);
        }
    }
});
