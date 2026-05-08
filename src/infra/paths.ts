import GLib from "gi://GLib";

export const CACHE_DIR = GLib.build_filenamev([
    GLib.get_user_cache_dir(),
    "codex-meter",
]);
export const STATE_DIR = GLib.build_filenamev([
    GLib.get_user_state_dir(),
    "codex-meter",
]);

export function getSnapshotPath() {
    return GLib.build_filenamev([STATE_DIR, "snapshot.json"]);
}

export function getHistoryPath() {
    return GLib.build_filenamev([CACHE_DIR, "usage-history.csv"]);
}

export function getCodexAuthPath() {
    return GLib.build_filenamev([GLib.get_home_dir(), ".codex", "auth.json"]);
}
