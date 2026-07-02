import Gio from "gi://Gio";
import GLib from "gi://GLib";

Gio._promisify(Gio.File.prototype, "load_contents_async");
Gio._promisify(Gio.File.prototype, "replace_contents_async");

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

function ensureParentDir(path: string) {
    const dir = GLib.path_get_dirname(path);
    GLib.mkdir_with_parents(dir, PRIVATE_DIR_MODE);
    GLib.chmod(dir, PRIVATE_DIR_MODE);
}

function fileExists(path: string): boolean {
    return GLib.file_test(path, GLib.FileTest.EXISTS);
}

export async function readTextFile(path: string): Promise<string> {
    return readFile(path);
}

export async function writeTextFile(path: string, text: string): Promise<void> {
    return writeFile(path, text);
}

async function readFile(path: string): Promise<string> {
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

async function writeFile(path: string, text: string): Promise<void> {
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

export async function appendFile(path: string, line: string): Promise<void> {
    try {
        ensureParentDir(path);

        const existingText = fileExists(path) ? await readFile(path) : "";
        const text = line.endsWith("\n") ? line : `${line}\n`;

        await writeFile(path, `${existingText}${text}`);
    } catch (error) {
        throw new Error(
            `Failed to append file "${path}": ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}


// JSON
export async function readJsonFile<T = unknown>(path: string): Promise<T> {
    try {
        const raw = await readFile(path);
        return JSON.parse(raw) as T;
    } catch (error) {
        throw new Error(
            `Failed to read JSON file "${path}": ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

export async function writeJsonFile(path: string, data: unknown): Promise<void> {
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
