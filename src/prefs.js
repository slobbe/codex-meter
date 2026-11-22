import Gio from "gi://Gio";
import Gtk from "gi://Gtk";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { readFile } from "./io/files.js";
import { parseReleaseNotes } from "./preferences/about-content.js";
import { createPreferencesPage } from "./preferences/page.js";

const iconPathsByTheme = new WeakMap();

function registerIconPath(window, theme, path) {
    let paths = iconPathsByTheme.get(theme);
    if (!paths) {
        paths = new Map();
        iconPathsByTheme.set(theme, paths);
    }
    let registration = paths.get(path);
    if (!registration) {
        // The preferences page and About window both require themed icon names.
        const added = !theme.get_search_path().includes(path);
        registration = { added, owners: 0 };
        paths.set(path, registration);
        if (added) theme.add_search_path(path);
    }
    registration.owners++;

    // A close request can be stopped. Release the path when GTK removes the window.
    const toplevels = Gtk.Window.get_toplevels();
    const signalId = toplevels.connect("items-changed", (_list, _position, removed) => {
        if (!removed || Gtk.Window.list_toplevels().includes(window)) return;
        toplevels.disconnect(signalId);
        if (--registration.owners > 0) return;
        paths.delete(path);
        if (paths.size === 0) iconPathsByTheme.delete(theme);
        if (!registration.added) return;

        const current = theme.get_search_path();
        const index = current.indexOf(path);
        if (index === -1) return;
        current.splice(index, 1);
        theme.set_search_path(current);
    });
}

export default class CodexMeterPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const cancellable = new Gio.Cancellable();
        window.connect("close-request", () => {
            cancellable.cancel();
            return false;
        });
        let releaseNotes = null;
        const page = createPreferencesPage(settings, this.metadata, window, () => releaseNotes);
        const display = window.get_display();
        if (display) {
            registerIconPath(window, Gtk.IconTheme.get_for_display(display), `${this.path}/icons`);
        }
        // Shell 45 and 46 expect a page before this method yields.
        window.add(page);
        const changelog = await readFile(`${this.path}/CHANGELOG.md`, cancellable).catch(() => "");
        if (!cancellable.is_cancelled()) releaseNotes = parseReleaseNotes(changelog);
    }
}
