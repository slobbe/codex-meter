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

export function isCancellationError(error) {
    return error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

export async function readFile(path, cancellable = null) {
    try {
        cancellable?.set_error_if_cancelled();
        const file = Gio.File.new_for_path(path);
        const [contents] = await file.load_contents_async(cancellable);
        cancellable?.set_error_if_cancelled();
        return new TextDecoder("utf-8").decode(contents);
    } catch (error) {
        if (isCancellationError(error)) throw error;
        throw new Error(
            `Failed to read file "${path}": ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

export async function writeFile(path, text, cancellable = null) {
    try {
        cancellable?.set_error_if_cancelled();
        ensureParentDir(path);
        const file = Gio.File.new_for_path(path);
        const bytes = new TextEncoder().encode(text);
        await file.replace_contents_async(
            bytes,
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            cancellable,
        );
        cancellable?.set_error_if_cancelled();
        GLib.chmod(path, PRIVATE_FILE_MODE);
    } catch (error) {
        if (isCancellationError(error)) throw error;
        throw new Error(
            `Failed to write file "${path}": ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

export async function appendFile(path, line, cancellable = null) {
    try {
        cancellable?.set_error_if_cancelled();
        ensureParentDir(path);
        const file = Gio.File.new_for_path(path);
        const text = line.endsWith("\n") ? line : `${line}\n`;
        const bytes = new GLib.Bytes(new TextEncoder().encode(text));
        const stream = await file.append_to_async(
            Gio.FileCreateFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            cancellable,
        );
        let writeError = null;
        try {
            cancellable?.set_error_if_cancelled();
            await stream.write_bytes_async(bytes, GLib.PRIORITY_DEFAULT, cancellable);
        } catch (error) {
            writeError = error;
            throw error;
        } finally {
            // Closing is cleanup and must not mask the original write/cancellation error.
            try {
                await stream.close_async(GLib.PRIORITY_DEFAULT, null);
            } catch (error) {
                if (!writeError) throw error;
            }
        }
        cancellable?.set_error_if_cancelled();
        GLib.chmod(path, PRIVATE_FILE_MODE);
    } catch (error) {
        if (isCancellationError(error)) throw error;
        throw new Error(
            `Failed to append file "${path}": ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

export async function readJsonFile(path, cancellable = null) {
    return JSON.parse(await readFile(path, cancellable));
}

export async function writeJsonFile(path, data, cancellable = null) {
    const json = JSON.stringify(data, null, 2);
    if (json === undefined) throw new Error("JSON.stringify returned undefined");
    await writeFile(path, `${json}\n`, cancellable);
}
