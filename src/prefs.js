import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { readSnapshot } from "./codex/usage/snapshot.js";
import { createPreferencesPage } from "./preferences/page.js";

export default class CodexMeterPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const display = Gdk.Display.get_default();
        if (display) {
            Gtk.IconTheme.get_for_display(display).add_search_path(`${this.path}/icons`);
        }
        const cancellable = new Gio.Cancellable();
        window.connect("close-request", () => {
            cancellable.cancel();
            return false;
        });
        const snapshot = await readSnapshot(cancellable).catch((error) => {
            if (!cancellable.is_cancelled()) throw error;
            return null;
        });
        if (cancellable.is_cancelled()) return;
        window.add(createPreferencesPage(settings, this.metadata, window, snapshot));
    }
}
