/* This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { CodexMonitor } from "./background/monitor.js";
import { CodexMeterIndicator } from "./panel/indicator.js";

export default class CodexMeterExtension extends Extension {
    _monitor = null;

    _indicator = null;

    enable() {
        this._monitor = new CodexMonitor(this.getSettings(), (message) =>
            Main.notify("Codex Meter", message),
        );
        this._indicator = new CodexMeterIndicator(this, this._monitor);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._indicator.start();
        this._monitor.start();
    }

    disable() {
        this._monitor?.stop();
        this._indicator?.destroy();
        this._monitor = null;
        this._indicator = null;
    }
}
