import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const stubUrl = `data:text/javascript,${encodeURIComponent(`
    class Actor {
        constructor(options = {}) {
            Object.assign(this, options);
            this.children = [];
            this.classes = new Set();
            this.calls = [];
            this.color = { red: 73, green: 193, blue: 109, alpha: 255 };
        }
        add_child(actor) { this.children.push(actor); }
        connect(_signal, callback) { this.repaint = callback; }
        add_style_class_name(name) { this.classes.add(name); }
        remove_style_class_name(name) { this.classes.delete(name); }
        queue_repaint() { this.queued = true; }
        get_surface_size() { return [26, 26]; }
        get_theme_node() { return { get_foreground_color: () => this.color }; }
        get_context() {
            const context = {};
            for (const name of ['arc', 'arcNegative', 'stroke', 'setSourceRGBA', 'setLineWidth', '$dispose']) {
                context[name] = (...args) => this.calls.push([name, ...args]);
            }
            return context;
        }
    }
    export default {
        Widget: Actor, DrawingArea: Actor, Icon: Actor, Label: Actor,
        BinLayout: class {}, ActorAlign: { CENTER: 0 },
    };
`)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier.startsWith("gi://")) return { url: stubUrl, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});
let UsageRing;
try {
    ({ UsageRing } = await import("../src/panel/usage-ring.js"));
} finally {
    hooks.deregister();
}

function closeTo(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
}

test("ring paints first quota up the left and second up the right from six o'clock", () => {
    const ring = new UsageRing("codex-icon");
    assert.equal(ring.actor.children[2].gicon, "codex-icon");
    ring.update([
        { percentValue: 25, displayPercentValue: 75 },
        { percentValue: 80, displayPercentValue: 20 },
    ]);
    for (const [index, method, fraction] of [
        [0, "arc", 0.75],
        [1, "arcNegative", 0.2],
    ]) {
        const area = ring.actor.children[index];
        assert.equal(area.visible, true);
        assert.equal(area.queued, true);
        area.repaint();
        const arcs = area.calls.filter(([name]) => name === method);
        assert.equal(arcs.length, 2, "background track and usage fill");
        const [, x, y, radius, start, end] = arcs[0];
        assert.equal(x, 13);
        assert.equal(y, 13);
        assert.ok(radius < 13);
        const direction = index === 0 ? 1 : -1;
        closeTo(start, Math.PI / 2 + direction * 0.08);
        closeTo(end, Math.PI / 2 + direction * (Math.PI - 0.08));
        closeTo(arcs[1][5] - start, (end - start) * fraction);
        assert.deepEqual(area.calls.at(-1), ["$dispose"]);
        assert.deepEqual(
            area.calls.find(([name]) => name === "setSourceRGBA"),
            ["setSourceRGBA", 73 / 255, 193 / 255, 109 / 255, 0.18],
        );
    }
    assert.ok(ring.actor.children[0].classes.has("cx-color-green"));
    assert.ok(ring.actor.children[1].classes.has("cx-color-warning"));
});

test("ring switches between logos and CX text without changing its sizing classes", () => {
    const ring = new UsageRing("codex-icon");
    const [, , icon, label] = ring.actor.children;
    for (const gicon of ["openai-icon", null, "codex-icon"]) {
        ring.setIcon(gicon);
        assert.equal(icon.gicon, gicon);
        assert.equal(icon.visible, gicon !== null);
        assert.equal(label.visible, gicon === null);
        assert.equal(label.text, "CX");
        assert.equal(ring.actor.style_class, "cx-panel-ring");
        assert.equal(icon.style_class, "cx-panel-icon");
        assert.equal(label.style_class, "cx-panel-prefix cx-panel-ring-prefix");
    }
});

test("ring handles zero, full, single and absent quotas without stale fill or colors", () => {
    const ring = new UsageRing("icon");
    ring.update([
        { percentValue: 100, displayPercentValue: 0 },
        { percentValue: 0, displayPercentValue: 100 },
    ]);
    const [left, right] = ring.actor.children;
    left.repaint();
    right.repaint();
    assert.equal(left.calls.filter(([name]) => name === "arc").length, 1);
    const arcs = right.calls.filter(([name]) => name === "arcNegative");
    assert.deepEqual(arcs[0], arcs[1], "100% fills the whole half, not the full circle");
    assert.ok(left.classes.has("cx-color-danger"));
    ring.update([{ percentValue: 20, displayPercentValue: 80 }]);
    assert.deepEqual([...left.classes], ["cx-color-green"]);
    assert.equal(left.visible, true);
    assert.equal(right.visible, false);
    ring.update([]);
    assert.equal(left.visible, false);
    assert.equal(right.visible, false);
    left.calls = [];
    left.repaint();
    assert.deepEqual(left.calls, [["$dispose"]]);
});
