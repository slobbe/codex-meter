import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { readFile } from "./io/files.js";
import { parseReleaseNotes } from "./preferences/about-content.js";
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
        let releaseNotes = null;
        // Shell 45 and 46 expect a page before this method yields.
        window.add(createPreferencesPage(settings, this.metadata, window, () => releaseNotes));
        const changelog = await readFile(`${this.path}/CHANGELOG.md`, cancellable).catch(() => "");
        if (!cancellable.is_cancelled()) releaseNotes = parseReleaseNotes(changelog);
    }
}
