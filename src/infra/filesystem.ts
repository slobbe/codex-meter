import Gio from "gi://Gio";
import GLib from "gi://GLib";

Gio._promisify(Gio.File.prototype, "load_contents_async");
Gio._promisify(Gio.File.prototype, "replace_contents_async");
Gio._promisify(Gio.File.prototype, "append_to_async");
Gio._promisify(Gio.OutputStream.prototype, "write_all_async");
Gio._promisify(Gio.OutputStream.prototype, "close_async");

function ensureParentDir(path: string) {
    const dir = GLib.path_get_dirname(path);
    GLib.mkdir_with_parents(dir, 0o755);
}

async function readFile(path: string) {
    const file = Gio.File.new_for_path(path);
    const [contents] = await file.load_contents_async(null);

    return new TextDecoder("utf-8").decode(contents);
}

async function writeFile(path: string, text: string) {
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
}

export async function appendFile(path: string, line: string) {
    ensureParentDir(path);

    const file = Gio.File.new_for_path(path);

    const stream = (await (file.append_to_async as any)(
        Gio.FileCreateFlags.NONE,
        null,
    )) as Gio.OutputStream;

    const text = line.endsWith("\n") ? line : line + "\n";
    const bytes = new TextEncoder().encode(text);

    await (stream.write_all_async as any)(bytes, null);
    await (stream.close_async as any)(null);
}


// CSV
export async function readCsvFile(path: string): Promise<object[]> {
    const text = await readFile(path);

    const lines = text.trim().split("\n");

    const keys = lines[0].split(",");
    return lines.slice(1).map((line) => {
        const values = line.split(",");
        return Object.fromEntries(keys.map((k, i) => [k, values[i]]));
    });
}

function escapeCsvValue(value: string): string {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n")
  ) {
    return `"${value.replace(/"/g, '""')}"`
  }

  return value
}

export function toCsvRow(
  values: (string | number | boolean | null)[]
): string {
  return values
    .map(v => escapeCsvValue(String(v ?? "")))
    .join(",")
}

// JSON
export async function readJsonFile(path: string) {
    const raw = await readFile(path);
    return JSON.parse(raw);
}

export async function writeJsonFile(path: string, data: object) {
    try {
        const json = JSON.stringify(data, Object.keys(data).sort(), 2) + "\n";
        await writeFile(path, json);
    } catch (error) {
        throw new Error(`Failed to serialize JSON: ${error.message}`);
    }

    
}
