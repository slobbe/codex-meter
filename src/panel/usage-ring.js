import Clutter from "gi://Clutter";
import St from "gi://St";
import { getUsageBarColorStyleClass } from "./view-model.js";

export class UsageRing {
    constructor(gicon) {
        this.actor = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "cx-panel-ring",
        });
        this._halves = [0, 1].map((index) => {
            const area = new St.DrawingArea({ x_expand: true, y_expand: true });
            const half = { area, state: null, colorClass: null };
            area.connect("repaint", () => this._paintHalf(half, index));
            this.actor.add_child(area);
            return half;
        });
        this.actor.add_child(
            new St.Icon({
                gicon,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: "cx-panel-icon",
            }),
        );
    }

    update(bars) {
        for (const [index, half] of this._halves.entries()) {
            half.state = bars[index] ?? null;
            if (half.colorClass) half.area.remove_style_class_name(half.colorClass);
            half.colorClass = getUsageBarColorStyleClass(half.state?.percentValue);
            half.area.add_style_class_name(half.colorClass);
            half.area.visible = half.state !== null;
            half.area.queue_repaint();
        }
    }

    _paintHalf({ area, state }, index) {
        const context = area.get_context();
        const [width, height] = area.get_surface_size();
        if (state && width > 0 && height > 0) {
            const size = Math.min(width, height);
            const lineWidth = size / 12;
            const radius = (size - lineWidth) / 2;
            const gap = 0.08;
            const direction = index === 0 ? 1 : -1;
            const start = Math.PI / 2 + direction * gap;
            const sweep = direction * (Math.PI - 2 * gap);
            const color = area.get_theme_node().get_foreground_color();
            const drawArc = (fraction, alpha) => {
                if (fraction <= 0) return;
                context.setSourceRGBA(
                    color.red / 255,
                    color.green / 255,
                    color.blue / 255,
                    (color.alpha / 255) * alpha,
                );
                if (direction < 0) {
                    context.arcNegative(
                        width / 2,
                        height / 2,
                        radius,
                        start,
                        start + sweep * fraction,
                    );
                } else {
                    context.arc(width / 2, height / 2, radius, start, start + sweep * fraction);
                }
                context.stroke();
            };
            context.setLineWidth(lineWidth);
            drawArc(1, 0.18);
            drawArc(Math.max(0, Math.min(100, state.displayPercentValue)) / 100, 1);
        }
        context.$dispose();
    }
}
