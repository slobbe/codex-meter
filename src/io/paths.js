import Gio from "gi://Gio";
import GLib from "gi://GLib";

export const CACHE_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), "codex-meter"]);

export const STATE_DIR = GLib.build_filenamev([GLib.get_user_state_dir(), "codex-meter"]);

export function getStorageRoot(file) {
    let root = null;
    for (const path of [CACHE_DIR, STATE_DIR]) {
        const candidate = Gio.File.new_for_path(path);
        if (file.has_prefix(candidate) && (!root || root.has_prefix(candidate))) root = candidate;
    }
    return root;
}
