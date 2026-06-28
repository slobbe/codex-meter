import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { AboutPage, CodexPage, DisplayPage } from "./ui/preferences-pages.js";

export default class CodexMeterPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const display = Gdk.Display.get_default();

        if (display) {
            Gtk.IconTheme.get_for_display(display).add_search_path(`${this.path}/icons`);
        }

        window.add(new (DisplayPage as any)(settings));
        window.add(new (CodexPage as any)());
        window.add(new (AboutPage as any)(this.metadata, this.path));
        window.set_default_size(640, 720);
    }
}
