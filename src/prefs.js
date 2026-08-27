import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import { listCodexBankedResets, readCachedCodexBankedResets } from "./codex/banked-resets/api.js";
import { createPreferencesPage } from "./preferences/page.js";

export default class CodexMeterPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const display = Gdk.Display.get_default();
        if (display) {
            Gtk.IconTheme.get_for_display(display).add_search_path(`${this.path}/icons`);
        }
        const bankedResetSnapshot = await loadBankedResets();
        window.add(createPreferencesPage(settings, bankedResetSnapshot, this.metadata));
        window.set_default_size(640, 720);
    }
}

async function loadBankedResets() {
    try {
        return await listCodexBankedResets();
    } catch (error) {
        console.warn("Unable to load current banked resets for preferences", error);
        return await readCachedCodexBankedResets();
    }
}
