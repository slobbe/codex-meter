import GLib from "gi://GLib";

export const CONFIG_DIR = GLib.build_filenamev([
    GLib.get_user_config_dir(),
    "codex-meter",
]);
export const CACHE_DIR = GLib.build_filenamev([
    GLib.get_user_cache_dir(),
    "codex-meter",
]);
export const STATE_DIR = GLib.build_filenamev([
    GLib.get_user_state_dir(),
    "codex-meter",
]);
