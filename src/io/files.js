import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { getStorageRoot } from "./paths.js";

Gio._promisify(Gio.File.prototype, "load_contents_async");

Gio._promisify(Gio.File.prototype, "read_async");

Gio._promisify(Gio.File.prototype, "replace_contents_async");

Gio._promisify(Gio.File.prototype, "append_to_async");

Gio._promisify(Gio.File.prototype, "make_directory_async");

Gio._promisify(Gio.File.prototype, "query_info_async");

Gio._promisify(Gio.File.prototype, "set_attributes_async");

Gio._promisify(Gio.InputStream.prototype, "read_bytes_async");

Gio._promisify(Gio.InputStream.prototype, "close_async");

Gio._promisify(Gio.OutputStream.prototype, "write_bytes_async");

Gio._promisify(Gio.OutputStream.prototype, "close_async");

const PRIVATE_DIR_MODE = 0o700;

const PRIVATE_FILE_MODE = 0o600;

const NOFOLLOW = Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS;

function isIoError(error, code) {
    return error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, code);
}

export function isCancellationError(error) {
    return isIoError(error, Gio.IOErrorEnum.CANCELLED);
}

export function isNotFoundError(error) {
    return isIoError(error, Gio.IOErrorEnum.NOT_FOUND);
}

async function queryIfExists(file, attributes, flags, cancellable) {
    try {
        return await file.query_info_async(attributes, flags, GLib.PRIORITY_DEFAULT, cancellable);
    } catch (error) {
        if (isNotFoundError(error)) return null;
        throw error;
    }
}

async function setMode(file, currentInfo, mode, cancellable) {
    cancellable?.set_error_if_cancelled();
    if ((currentInfo.get_attribute_uint32("unix::mode") & 0o7777) === mode) return;
    const info = new Gio.FileInfo();
    info.set_attribute_uint32("unix::mode", mode);
    await file.set_attributes_async(info, NOFOLLOW, GLib.PRIORITY_DEFAULT, cancellable);
    cancellable?.set_error_if_cancelled();
}

async function ensureDirectory(dir, root, cancellable) {
    const managed = root !== null && (dir.equal(root) || dir.has_prefix(root));
    const base = root !== null && !managed;
    const parent = dir.get_parent();
    // Validate each owned component before using it as a parent. XDG bases can be links.
    if (!base && parent) await ensureDirectory(parent, root, cancellable);
    const flags = base ? Gio.FileQueryInfoFlags.NONE : NOFOLLOW;
    const attributes = "standard::type,unix::mode";
    let info = await queryIfExists(dir, attributes, flags, cancellable);
    let created = false;
    if (!info) {
        if (base && parent) await ensureDirectory(parent, root, cancellable);
        try {
            await dir.make_directory_async(GLib.PRIORITY_DEFAULT, cancellable);
            created = true;
        } catch (error) {
            if (!isIoError(error, Gio.IOErrorEnum.EXISTS)) throw error;
        }
        info = await dir.query_info_async(attributes, flags, GLib.PRIORITY_DEFAULT, cancellable);
    }
    if (info.get_file_type() !== Gio.FileType.DIRECTORY) {
        throw new Error(`Not a safe storage directory: ${dir.get_path()}`);
    }
    if (managed || (!base && created)) await setMode(dir, info, PRIVATE_DIR_MODE, cancellable);
}

async function writableFileInfo(file, cancellable) {
    const info = await queryIfExists(
        file,
        "standard::type,unix::mode,unix::nlink",
        NOFOLLOW,
        cancellable,
    );
    if (
        info &&
        (info.get_file_type() !== Gio.FileType.REGULAR ||
            info.get_attribute_uint32("unix::nlink") !== 1)
    ) {
        throw new Error(`Not a safe storage file: ${file.get_path()}`);
    }
    return info;
}

async function setPrivateFileMode(file, cancellable) {
    const info = await writableFileInfo(file, cancellable);
    if (!info) throw new Error(`Storage file disappeared: ${file.get_path()}`);
    await setMode(file, info, PRIVATE_FILE_MODE, cancellable);
}

async function withStream(stream, operation) {
    let failed = false;
    try {
        return await operation();
    } catch (error) {
        failed = true;
        throw error;
    } finally {
        try {
            await stream.close_async(GLib.PRIORITY_DEFAULT, null);
        } catch (error) {
            if (!failed) throw error;
        }
    }
}

async function needsLineSeparator(file, cancellable) {
    // A torn row must not merge with the next append. Inspect only the final byte.
    const stream = await file.read_async(GLib.PRIORITY_DEFAULT, cancellable);
    return withStream(stream, async () => {
        stream.seek(0, GLib.SeekType.END, cancellable);
        if (stream.tell() === 0) return false;
        stream.seek(-1, GLib.SeekType.END, cancellable);
        const last = await stream.read_bytes_async(1, GLib.PRIORITY_DEFAULT, cancellable);
        return last.get_size() > 0 && last.get_data()[0] !== 0x0a;
    });
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
            { cause: error },
        );
    }
}

export async function writeFile(path, text, cancellable = null) {
    try {
        cancellable?.set_error_if_cancelled();
        const file = Gio.File.new_for_path(path);
        await ensureDirectory(file.get_parent(), getStorageRoot(file), cancellable);
        await writableFileInfo(file, cancellable);
        const bytes = new TextEncoder().encode(text);
        await file.replace_contents_async(
            bytes,
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
            cancellable,
        );
        await setPrivateFileMode(file, cancellable);
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
        const file = Gio.File.new_for_path(path);
        await ensureDirectory(file.get_parent(), getStorageRoot(file), cancellable);
        const info = await writableFileInfo(file, cancellable);
        if (info) await setMode(file, info, PRIVATE_FILE_MODE, cancellable);
        const prefix = info && (await needsLineSeparator(file, cancellable)) ? "\n" : "";
        const text = line.endsWith("\n") ? line : `${line}\n`;
        const bytes = new GLib.Bytes(new TextEncoder().encode(prefix + text));
        const stream = await file.append_to_async(
            Gio.FileCreateFlags.PRIVATE,
            GLib.PRIORITY_DEFAULT,
            cancellable,
        );
        await withStream(stream, async () => {
            const size = bytes.get_size();
            let offset = 0;
            while (offset < size) {
                cancellable?.set_error_if_cancelled();
                const remaining =
                    offset === 0 ? bytes : GLib.Bytes.new_from_bytes(bytes, offset, size - offset);
                const written = await stream.write_bytes_async(
                    remaining,
                    GLib.PRIORITY_DEFAULT,
                    cancellable,
                );
                if (written === 0) throw new Error("Append made no progress");
                offset += written;
            }
        });
        if (!info) await setPrivateFileMode(file, cancellable);
        cancellable?.set_error_if_cancelled();
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
