import Clutter from "gi://Clutter";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { ACTIVITY_GRID_DAYS } from "./activity-grid-model.js";

const CELL_GAP = 2;
const TIME_BANDS = ["0-6am", "6am-12pm", "12-6pm", "6pm-12am"];

/** @typedef {ReturnType<typeof import("./activity-grid-model.js").createActivityGridViewModel>} ActivityViewModel */

export class ActivityGrid {
    constructor() {
        this.item = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        this.item.hide();

        const box = new St.BoxLayout({ x_expand: true, style_class: "cx-activity-grid" });
        box.layout_manager.orientation = Clutter.Orientation.VERTICAL;
        this._titleLabel = new St.Label({ style_class: "cx-usage-heading cx-usage-title" });
        box.add_child(this._titleLabel);

        const layout = new Clutter.GridLayout({
            column_homogeneous: true,
            column_spacing: CELL_GAP,
            row_spacing: CELL_GAP,
        });
        const grid = new St.Widget({ layout_manager: layout, x_expand: true });
        box.add_child(grid);
        this.item.add_child(box);

        this._hoveredCell = null;
        this._tooltip = new St.Label({ style_class: "dash-label", visible: false });
        Main.uiGroup.add_child(this._tooltip);
        this.item.connect("destroy", () => {
            this._hoveredCell = null;
            this._tooltip.destroy();
        });

        this._days = Array.from({ length: ACTIVITY_GRID_DAYS }, (_, column) => {
            let label = null;
            if (column % 2 === 0) {
                label = new St.Label({
                    style_class: "cx-activity-grid-day",
                    x_align: Clutter.ActorAlign.START,
                });
                layout.attach(label, column, 0, 2, 1);
            }

            const cells = TIME_BANDS.map((_, row) => {
                const cell = new St.Widget({
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                    reactive: true,
                    track_hover: true,
                });
                cell.connect("notify::width", () => {
                    if (cell.width <= 0) return;
                    cell.height = cell.width;
                    if (this._hoveredCell === cell) this._syncTooltip(cell);
                });
                cell.connect("notify::hover", () => this._syncTooltip(cell));
                cell.connect("notify::mapped", () => this._syncTooltip(cell));
                layout.attach(cell, column, row + 1, 1, 1);
                return cell;
            });
            return { label, cells };
        });
    }

    /** @param {ActivityViewModel} viewModel */
    update(viewModel) {
        if (!viewModel.visible) {
            this._hoveredCell = null;
            this._tooltip.hide();
            this.item.hide();
            return;
        }

        this._titleLabel.text = viewModel.title;
        for (const [index, day] of viewModel.days.entries()) {
            const { label, cells } = this._days[index];
            if (label) label.text = day.label;
            for (const [row, state] of day.cells.entries()) {
                const cell = cells[row];
                cell.style_class = `cx-activity-grid-cell cx-activity-grid-cell-${state}`;
                cell.accessible_name = `${day.dateLabel}, ${TIME_BANDS[row]}`;
            }
        }
        this.item.show();
        if (this._hoveredCell) this._syncTooltip(this._hoveredCell);
    }

    _syncTooltip(cell) {
        if (!cell.mapped || !cell.hover) {
            if (this._hoveredCell === cell) {
                this._hoveredCell = null;
                this._tooltip.hide();
            }
            return;
        }

        this._hoveredCell = cell;
        this._tooltip.text = cell.accessible_name;
        this._tooltip.show();
        Main.uiGroup.set_child_above_sibling(this._tooltip, null);
        const [x, y] = cell.get_transformed_position();
        const [width] = cell.get_transformed_size();
        const [, tooltipWidth] = this._tooltip.get_preferred_width(-1);
        const [, tooltipHeight] = this._tooltip.get_preferred_height(tooltipWidth);
        this._tooltip.set_position(
            Math.round(x + (width - tooltipWidth) / 2),
            Math.round(y - tooltipHeight - 6),
        );
    }
}
