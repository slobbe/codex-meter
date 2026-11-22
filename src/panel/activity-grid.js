import Atk from "gi://Atk";
import Clutter from "gi://Clutter";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { ACTIVITY_CELL_LABELS, ACTIVITY_GRID_DAYS } from "./activity-grid-model.js";

const CELL_GAP = 2;
const TIME_BANDS = ["midnight to 6 am", "6 am to noon", "noon to 6 pm", "6 pm to midnight"];

/** @typedef {ReturnType<typeof import("./activity-grid-model.js").createActivityGridViewModel>} ActivityViewModel */

export class ActivityGrid {
    constructor() {
        this.item = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: true });
        this.item.accessible_role = Atk.Role.SECTION;
        this.item.get_accessible().set_description("Use arrow keys to inspect activity.");
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
        this._grid = new St.Widget({ layout_manager: layout, x_expand: true });
        box.add_child(this._grid);
        this._summaryLabel = new St.Label({ x_expand: true });
        this._summaryLabel.clutter_text.line_wrap = true;
        this._summaryLabel.clutter_text.ellipsize = 0;
        box.add_child(this._summaryLabel);
        this.item.add_child(box);

        this._hoveredCell = null;
        this._keyboardCell = null;
        this._column = 0;
        this._row = 0;
        this._accessibleSummary = "";
        this._tooltip = new St.Label({ style_class: "dash-label", visible: false });
        Main.uiGroup.add_child(this._tooltip);
        this.item.connect("destroy", () => {
            this._hoveredCell = null;
            this._keyboardCell = null;
            const tooltip = this._tooltip;
            this._tooltip = null;
            tooltip.destroy();
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
                    can_focus: false,
                });
                cell.connect("notify::width", () => {
                    if (cell.width <= 0) return;
                    cell.height = cell.width;
                    if (this._hoveredCell === cell || this._keyboardCell === cell) {
                        this._syncTooltip();
                    }
                });
                cell.connect("notify::hover", () => {
                    if (cell.mapped && cell.hover) this._hoveredCell = cell;
                    else if (this._hoveredCell === cell) this._hoveredCell = null;
                    else return;
                    this._syncTooltip();
                });
                cell.connect("notify::mapped", () => {
                    if (!cell.mapped && this._hoveredCell === cell) this._hoveredCell = null;
                    else if (this._keyboardCell !== cell) return;
                    this._syncTooltip();
                });
                layout.attach(cell, column, row + 1, 1, 1);
                return cell;
            });
            return { label, cells };
        });

        this.item.connect("key-focus-in", () => {
            this._hoveredCell = null;
            this._selectKeyboardCell(this._days[this._column].cells[this._row]);
        });
        this.item.connect("key-focus-out", () => this._selectKeyboardCell(null));
        this.item.connect("notify::mapped", () => {
            if (!this.item.mapped) {
                this._hoveredCell = null;
                this._selectKeyboardCell(null);
            }
        });
        // Handle cell movement before PopupBaseMenuItem runs its focus navigation.
        this.item.connect("captured-event", (_item, event) => this._onKeyPress(event));
    }

    /** @param {ActivityViewModel} viewModel */
    update(viewModel) {
        if (!viewModel.visible) {
            this._hoveredCell = null;
            this._selectKeyboardCell(null);
            this.item.hide();
            return;
        }

        this._titleLabel.text = viewModel.title;
        this._summaryLabel.text = viewModel.summary;
        this._accessibleSummary = `${viewModel.title}. ${viewModel.summary}`;
        for (const [index, day] of viewModel.days.entries()) {
            const { label, cells } = this._days[index];
            if (label) label.text = day.label;
            for (const [row, state] of day.cells.entries()) {
                const cell = cells[row];
                cell.style_class = `cx-activity-grid-cell cx-activity-grid-cell-${state}`;
                cell.accessible_name = `${day.dateLabel}, ${TIME_BANDS[row]}: ${ACTIVITY_CELL_LABELS[state]}`;
            }
        }
        this.item.show();
        this._syncAccessibleName();
        this._syncTooltip();
    }

    _onKeyPress(event) {
        if (!this._keyboardCell || event.type() !== Clutter.EventType.KEY_PRESS) {
            return Clutter.EVENT_PROPAGATE;
        }
        const modifiers = Clutter.ModifierType;
        if (
            event.get_state() &
            (modifiers.MODIFIER_MASK & ~modifiers.LOCK_MASK & ~modifiers.MOD2_MASK)
        ) {
            return Clutter.EVENT_PROPAGATE;
        }

        let column = this._column;
        let row = this._row;
        const step = this._grid.text_direction === Clutter.TextDirection.RTL ? -1 : 1;
        switch (event.get_key_symbol()) {
            case Clutter.KEY_Left:
                column -= step;
                break;
            case Clutter.KEY_Right:
                column += step;
                break;
            case Clutter.KEY_Up:
                row--;
                break;
            case Clutter.KEY_Down:
                row++;
                break;
            default:
                return Clutter.EVENT_PROPAGATE;
        }
        // Let the menu handle navigation out of the grid at its edges.
        if (column < 0 || column >= ACTIVITY_GRID_DAYS || row < 0 || row >= TIME_BANDS.length) {
            return Clutter.EVENT_PROPAGATE;
        }
        this._column = column;
        this._row = row;
        this._hoveredCell = null;
        this._selectKeyboardCell(this._days[column].cells[row]);
        return Clutter.EVENT_STOP;
    }

    _selectKeyboardCell(cell) {
        this._keyboardCell?.remove_style_pseudo_class("selected");
        this._keyboardCell = cell;
        cell?.add_style_pseudo_class("selected");
        this._syncAccessibleName();
        this._syncTooltip();
    }

    _syncAccessibleName() {
        const name = this._keyboardCell
            ? `${this._accessibleSummary} ${this._keyboardCell.accessible_name}`
            : this._accessibleSummary;
        if (this.item.accessible_name !== name) this.item.accessible_name = name;
    }

    _syncTooltip() {
        if (!this._tooltip) return;
        const cell = this._hoveredCell ?? this._keyboardCell;
        if (!cell?.mapped) {
            this._tooltip.hide();
            return;
        }
        this._tooltip.text = cell.accessible_name;
        this._tooltip.show();
        Main.uiGroup.set_child_above_sibling(this._tooltip, null);
        const [x, y] = cell.get_transformed_position();
        const [width] = cell.get_transformed_size();
        const [, tooltipWidth] = this._tooltip.get_preferred_width(-1);
        const [, tooltipHeight] = this._tooltip.get_preferred_height(tooltipWidth);
        const monitor = Main.layoutManager.findMonitorForActor(cell);
        const centeredX = x + (width - tooltipWidth) / 2;
        const tooltipX = monitor
            ? Math.max(monitor.x, Math.min(centeredX, monitor.x + monitor.width - tooltipWidth))
            : centeredX;
        this._tooltip.set_position(Math.round(tooltipX), Math.round(y - tooltipHeight - 6));
    }
}
