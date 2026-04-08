import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SETTINGS_SHOW_FIVE_HOUR = 'show-five-hour';
const SETTINGS_SHOW_WEEKLY = 'show-weekly';

export default class AIUsageIndicatorPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Display',
            icon_name: 'preferences-system-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: 'Top Bar',
            description: 'Choose which Codex usage percentages are shown in the GNOME top bar.',
        });

        const fiveHourRow = new Adw.SwitchRow({
            title: 'Show 5-hour usage',
            subtitle: 'Displays the current 5-hour window percentage.',
            active: settings.get_boolean(SETTINGS_SHOW_FIVE_HOUR),
        });
        group.add(fiveHourRow);
        settings.bind(
            SETTINGS_SHOW_FIVE_HOUR,
            fiveHourRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        const weeklyRow = new Adw.SwitchRow({
            title: 'Show weekly usage',
            subtitle: 'Displays the current weekly window percentage.',
            active: settings.get_boolean(SETTINGS_SHOW_WEEKLY),
        });
        group.add(weeklyRow);
        settings.bind(
            SETTINGS_SHOW_WEEKLY,
            weeklyRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        page.add(group);
        window.add(page);
        window.set_default_size(520, 300);
    }
}
