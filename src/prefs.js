import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { UsageService } from "./codex/usage/service.js";
import { readFile } from "./io/files.js";
import { parseReleaseNotes } from "./preferences/about-content.js";
import { SETTINGS_CREDENTIALS_PATH } from "./preferences/settings.js";
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
        let snapshot;
        let credentialsPath;
        let changelog;
        do {
            credentialsPath = settings.get_string(SETTINGS_CREDENTIALS_PATH);
            snapshot = await new UsageService(credentialsPath)
                .readCachedSnapshot({ cancellable })
                .catch((error) => {
                    if (!cancellable.is_cancelled()) throw error;
                    return null;
                });
            if (cancellable.is_cancelled()) return;
            changelog ??= await readFile(`${this.path}/CHANGELOG.md`, cancellable).catch(() => "");
            if (cancellable.is_cancelled()) return;
        } while (credentialsPath !== settings.get_string(SETTINGS_CREDENTIALS_PATH));
        const releaseNotes = parseReleaseNotes(changelog);
        window.add(createPreferencesPage(settings, this.metadata, window, snapshot, releaseNotes));
    }
}
