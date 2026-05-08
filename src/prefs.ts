import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { AboutPage, DisplayPage } from "./ui/preferences-pages.js";

export default class CodexMeterPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        const settings = this.getSettings();

        window.add(new (DisplayPage as any)(settings));
        window.add(new (AboutPage as any)(this.metadata));
        window.set_default_size(640, 720);
    }
}
