import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import { readCachedCodexBankedResets } from "./banked-resets/api.js";
import { createPreferencesPage } from "./preferences/page.js";

export default class CodexMeterPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const display = Gdk.Display.get_default();
        if (display) {
            Gtk.IconTheme.get_for_display(display).add_search_path(`${this.path}/icons`);
        }
        const bankedResetSnapshot = await readCachedCodexBankedResets();
        window.add(createPreferencesPage(settings, bankedResetSnapshot, this.metadata));
        window.set_default_size(640, 720);
    }
}
