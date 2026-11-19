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
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { CodexMonitor } from "./background/monitor.js";
import { resolveCredentialsPath } from "./codex/auth/auth.js";
import { CodexMeterIndicator } from "./panel/indicator.js";
import {
    migrateSettings,
    SETTINGS_CREDENTIALS_PATH,
    SETTINGS_USAGE_NOTIFICATIONS,
} from "./preferences/settings.js";

export default class CodexMeterExtension extends Extension {
    _monitor = null;

    _indicator = null;

    _notificationSource = null;

    enable() {
        const settings = this.getSettings();
        migrateSettings(settings);
        this._settings = settings;
        this._usageNotificationStatesByPath = new Map();
        this._usageNotificationsChangedId = settings.connect(
            `changed::${SETTINGS_USAGE_NOTIFICATIONS}`,
            () => {
                // Re-opt-in rearms alerts for all paths, including inactive ones.
                for (const states of this._usageNotificationStatesByPath.values()) states.clear();
            },
        );
        this._credentialsChangedId = settings.connect(
            `changed::${SETTINGS_CREDENTIALS_PATH}`,
            () => {
                this._stopRuntime();
                this._startRuntime(settings);
            },
        );
        this._startRuntime(settings);
    }

    _startRuntime(settings) {
        const credentialsPath = settings.get_string(SETTINGS_CREDENTIALS_PATH);
        const pathKey = GLib.canonicalize_filename(resolveCredentialsPath(credentialsPath), null);
        let notificationStates = this._usageNotificationStatesByPath.get(pathKey);
        if (!notificationStates) {
            notificationStates = new Map();
            this._usageNotificationStatesByPath.set(pathKey, notificationStates);
        }
        const monitor = new CodexMonitor(
            settings,
            (message) => {
                if (this._monitor === monitor) this._notify(message);
            },
            credentialsPath,
            notificationStates,
        );
        this._monitor = monitor;
        this._indicator = new CodexMeterIndicator(this, this._monitor);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._indicator.start();
        this._monitor.start();
    }

    disable() {
        this._settings.disconnect(this._credentialsChangedId);
        this._settings.disconnect(this._usageNotificationsChangedId);
        this._settings = null;
        this._credentialsChangedId = null;
        this._usageNotificationsChangedId = null;
        this._stopRuntime();
        this._usageNotificationStatesByPath = null;
    }

    _stopRuntime() {
        const monitor = this._monitor;
        this._monitor = null;
        monitor?.stop();
        this._notificationSource?.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
        this._indicator?.destroy();
        this._indicator = null;
    }

    _notify(body) {
        const title = "Codex Meter";
        const iconName = "dialog-information-symbolic";
        // Shell 45 uses positional constructors and showNotification().
        const legacy = !MessageTray.Source.prototype.addNotification;
        if (!this._notificationSource) {
            const source = legacy
                ? new MessageTray.Source(title, iconName)
                : new MessageTray.Source({ title, iconName });
            source.connect("destroy", () => {
                this._notificationSource = null;
            });
            this._notificationSource = source;
            Main.messageTray.add(source);
        }
        const source = this._notificationSource;
        if (legacy) {
            const notification = new MessageTray.Notification(source, title, body);
            notification.setTransient(true);
            source.showNotification(notification);
        } else {
            source.addNotification(
                new MessageTray.Notification({ source, title, body, isTransient: true }),
            );
        }
    }
}
