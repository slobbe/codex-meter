/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
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
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {fetchCodexUsageSnapshot} from './codex.js';

const REFRESH_INTERVAL_SECONDS = 60;
const SETTINGS_SHOW_FIVE_HOUR = 'show-five-hour';
const SETTINGS_SHOW_WEEKLY = 'show-weekly';

class CodexUsageIndicator extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    constructor(extension) {
        super(0.0, 'CodexUsageIndicator');

        this._extension = extension;
        this._settings = extension.getSettings();
        this._refreshId = 0;
        this._refreshInFlight = false;
        this._snapshot = null;
        this._errorMessage = null;

        this._label = new St.Label({
            text: 'CX --',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'cx-usage-label',
        });

        this.add_child(this._label);
        this._buildMenu();
        this._connectSignals();

        this._syncLabel();
        void this._refreshUsage();
        this._scheduleRefresh();
    }

    destroy() {
        if (this._refreshId) {
            GLib.source_remove(this._refreshId);
            this._refreshId = 0;
        }

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        if (this._menuOpenChangedId) {
            this.menu.disconnect(this._menuOpenChangedId);
            this._menuOpenChangedId = 0;
        }

        super.destroy();
    }

    _buildMenu() {
        this._statusItem = this._createInfoItem('Loading Codex usage...');
        this.menu.addMenuItem(this._statusItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._fiveHourItem = this._createInfoItem('5h usage: --');
        this._fiveHourResetItem = this._createInfoItem('5h reset: --');
        this._weeklyItem = this._createInfoItem('Weekly usage: --');
        this._weeklyResetItem = this._createInfoItem('Weekly reset: --');

        this.menu.addMenuItem(this._fiveHourItem);
        this.menu.addMenuItem(this._fiveHourResetItem);
        this.menu.addMenuItem(this._weeklyItem);
        this.menu.addMenuItem(this._weeklyResetItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._planItem = this._createInfoItem('Plan: --');
        this._subscriptionItem = this._createInfoItem('Subscription: --');
        this._accountItem = this._createInfoItem('Account: --');

        this.menu.addMenuItem(this._planItem);
        this.menu.addMenuItem(this._subscriptionItem);
        this.menu.addMenuItem(this._accountItem);
    }

    _createInfoItem(text) {
        return new PopupMenu.PopupMenuItem(text, {
            reactive: false,
            can_focus: false,
        });
    }

    _connectSignals() {
        this._settingsChangedId = this._settings.connect('changed', () => {
            this._syncLabel();
        });

        this._menuOpenChangedId = this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                void this._refreshUsage();
        });
    }

    _scheduleRefresh() {
        this._refreshId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_INTERVAL_SECONDS,
            () => {
                void this._refreshUsage();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    async _refreshUsage() {
        if (this._refreshInFlight)
            return;

        this._refreshInFlight = true;

        try {
            this._snapshot = await fetchCodexUsageSnapshot();
            this._errorMessage = null;
        } catch (error) {
            this._snapshot = null;
            this._errorMessage = error?.message ?? 'Unable to load Codex usage.';
        } finally {
            this._refreshInFlight = false;
            this._syncLabel();
            this._syncMenu();
        }
    }

    _syncLabel() {
        if (!this._snapshot) {
            this._label.text = this._errorMessage ? 'CX !' : 'CX --';
            return;
        }

        const showFiveHour = this._settings.get_boolean(SETTINGS_SHOW_FIVE_HOUR);
        const showWeekly = this._settings.get_boolean(SETTINGS_SHOW_WEEKLY);
        const parts = [];

        if (showFiveHour || !showWeekly)
            parts.push(formatPercent(this._snapshot.fiveHour?.usedPercent));

        if (showWeekly)
            parts.push(formatPercent(this._snapshot.weekly?.usedPercent));

        this._label.text = `CX ${parts.join('/')}`;
    }

    _syncMenu() {
        if (!this._snapshot) {
            this._statusItem.label.text = this._errorMessage ?? 'Loading Codex usage...';
            this._fiveHourItem.label.text = '5h usage: --';
            this._fiveHourResetItem.label.text = '5h reset: --';
            this._weeklyItem.label.text = 'Weekly usage: --';
            this._weeklyResetItem.label.text = 'Weekly reset: --';
            this._planItem.label.text = 'Plan: --';
            this._subscriptionItem.label.text = 'Subscription: --';
            this._accountItem.label.text = 'Account: --';
            return;
        }

        this._statusItem.label.text = `Updated ${formatTimestamp(this._snapshot.fetchedAt)}`;
        this._fiveHourItem.label.text = `5h usage: ${formatPercent(this._snapshot.fiveHour?.usedPercent)}`;
        this._fiveHourResetItem.label.text = `5h reset: ${formatReset(this._snapshot.fiveHour)}`;
        this._weeklyItem.label.text = `Weekly usage: ${formatPercent(this._snapshot.weekly?.usedPercent)}`;
        this._weeklyResetItem.label.text = `Weekly reset: ${formatReset(this._snapshot.weekly)}`;
        this._planItem.label.text = `Plan: ${formatPlan(this._snapshot.subscription?.planType ?? this._snapshot.planType)}`;
        this._subscriptionItem.label.text = `Subscription: ${formatSubscription(this._snapshot.subscription)}`;
        this._accountItem.label.text = `Account: ${shortenAccountId(this._snapshot.subscription?.accountId)}`;
    }
}

function formatPercent(value) {
    return Number.isFinite(value) ? `${value}%` : '--';
}

function formatReset(window) {
    if (!window)
        return '--';

    const relative = formatDuration(window.resetAfterSeconds);
    const absolute = formatUnixTimestamp(window.resetAt);

    if (relative === '--' && absolute === '--')
        return '--';

    if (relative === '--')
        return absolute;

    if (absolute === '--')
        return `in ${relative}`;

    return `in ${relative} (${absolute})`;
}

function formatDuration(totalSeconds) {
    if (!Number.isFinite(totalSeconds))
        return '--';

    let remaining = Math.max(0, Math.floor(totalSeconds));
    const days = Math.floor(remaining / 86400);
    remaining %= 86400;
    const hours = Math.floor(remaining / 3600);
    remaining %= 3600;
    const minutes = Math.floor(remaining / 60);

    const parts = [];

    if (days)
        parts.push(`${days}d`);

    if (hours)
        parts.push(`${hours}h`);

    if (minutes || parts.length === 0)
        parts.push(`${minutes}m`);

    return parts.join(' ');
}

function formatUnixTimestamp(value) {
    if (!Number.isFinite(value))
        return '--';

    return formatTimestamp(new Date(value * 1000).toISOString());
}

function formatTimestamp(value) {
    if (!value)
        return '--';

    try {
        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(new Date(value));
    } catch (_error) {
        return '--';
    }
}

function formatPlan(value) {
    if (!value)
        return '--';

    return value
        .toString()
        .split(/[_-]/)
        .filter(Boolean)
        .map(part => `${part[0].toUpperCase()}${part.slice(1)}`)
        .join(' ');
}

function formatSubscription(subscription) {
    if (!subscription)
        return '--';

    if (subscription.activeUntil)
        return `active until ${formatTimestamp(subscription.activeUntil)}`;

    if (subscription.activeStart)
        return `active since ${formatTimestamp(subscription.activeStart)}`;

    return '--';
}

function shortenAccountId(value) {
    if (!value)
        return '--';

    return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

export default class AIUsageIndicatorExtension extends Extension {
    enable() {
        this._indicator = new CodexUsageIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
