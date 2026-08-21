import Gio from "gi://Gio";
import GLib from "gi://GLib";

Gio._promisify(Gio.File.prototype, "load_contents_async");

Gio._promisify(Gio.File.prototype, "replace_contents_async");

Gio._promisify(Gio.File.prototype, "append_to_async");

Gio._promisify(Gio.OutputStream.prototype, "write_bytes_async");

Gio._promisify(Gio.OutputStream.prototype, "close_async");

const PRIVATE_DIR_MODE = 0o700;

const PRIVATE_FILE_MODE = 0o600;

function ensureParentDir(path) {
    const dir = GLib.path_get_dirname(path);
    GLib.mkdir_with_parents(dir, PRIVATE_DIR_MODE);
    GLib.chmod(dir, PRIVATE_DIR_MODE);
}

export async function readFile(path) {
    try {
        const file = Gio.File.new_for_path(path);
        const [contents] = await file.load_contents_async(null);
        return new TextDecoder("utf-8").decode(contents);
    } catch (error) {
        throw new Error(
            `Failed to read file "${path}": ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

export async function writeFile(path, text) {
    try {
        ensureParentDir(path);
        const file = Gio.File.new_for_path(path);
        const bytes = new TextEncoder().encode(text);
        await file.replace_contents_async(
            bytes,
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null,
        );
        GLib.chmod(path, PRIVATE_FILE_MODE);
    } catch (error) {
        throw new Error(
            `Failed to write file "${path}": ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

export async function appendFile(path, line) {
    try {
        ensureParentDir(path);
        const file = Gio.File.new_for_path(path);
        const text = line.endsWith("\n") ? line : `${line}\n`;
        const bytes = new GLib.Bytes(new TextEncoder().encode(text));
        const stream = await file.append_to_async(
            Gio.FileCreateFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            null,
        );
        await stream.write_bytes_async(bytes, GLib.PRIORITY_DEFAULT, null);
        await stream.close_async(GLib.PRIORITY_DEFAULT, null);
        GLib.chmod(path, PRIVATE_FILE_MODE);
    } catch (error) {
        throw new Error(
            `Failed to append file "${path}": ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

// JSON
export async function readJsonFile(path) {
    try {
        const raw = await readFile(path);
        return JSON.parse(raw);
    } catch (error) {
        throw new Error(
            `Failed to read JSON file "${path}": ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

export async function writeJsonFile(path, data) {
    try {
        const json = JSON.stringify(data, null, 2);
        if (json === undefined) {
            throw new Error("JSON.stringify returned undefined");
        }
        await writeFile(path, `${json}\n`);
    } catch (error) {
        throw new Error(
            `Failed to write JSON file "${path}": ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}
