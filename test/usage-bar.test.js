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
        [90, "cx-color-green"],
        [100, "cx-color-danger"],
        [20, "cx-color-green"],
        [90, undefined],
    ]) {
        bar.update({ percentValue, displayPercentValue: 100 - percentValue, colorStyleClass });
        assert.deepEqual([...bar._barFill.classes], [colorStyleClass ?? "cx-color-green"]);
        assert.equal(bar._barFill.width, 100 - percentValue);
    }
});

test("popup bars retain usage thresholds regardless of any pace color", () => {
    const bar = new UsageBar("menu");
    for (const [percentValue, expectedColor] of [
        [20, "cx-color-green"],
        [75, "cx-color-green"],
        [76, "cx-color-warning"],
        [99, "cx-color-warning"],
        [100, "cx-color-danger"],
        [0, "cx-color-green"],
    ]) {
        for (const displayPercentValue of [percentValue, 100 - percentValue]) {
            bar.update({
                percentValue,
                displayPercentValue,
                displayBaselinePercentValue: 50,
                colorStyleClass: "cx-color-danger",
            });
            assert.deepEqual([...bar._barFill.classes], [expectedColor]);
            assert.equal(bar._barFill.width, displayPercentValue);
            assert.equal(bar._barMarker.visible, true);
        }
    }
});
