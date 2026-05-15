import Gio from "gi://Gio";
import GLib from "gi://GLib";

Gio._promisify(Gio.File.prototype, "load_contents_async");
Gio._promisify(Gio.File.prototype, "replace_contents_async");
Gio._promisify(Gio.File.prototype, "append_to_async");
Gio._promisify(Gio.OutputStream.prototype, "write_all_async");
Gio._promisify(Gio.OutputStream.prototype, "close_async");

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
    let stream: Gio.OutputStream | null = null;

    try {
        ensureParentDir(path);

        const file = Gio.File.new_for_path(path);

        stream = (await (file.append_to_async as unknown as (
            flags: Gio.FileCreateFlags,
            ioPriority: number,
            cancellable: Gio.Cancellable | null,
        ) => Promise<Gio.OutputStream>)(Gio.FileCreateFlags.NONE, GLib.PRIORITY_DEFAULT, null)) as Gio.OutputStream;

        const text = line.endsWith("\n") ? line : `${line}\n`;
        const bytes = new TextEncoder().encode(text);

        await (stream.write_all_async as unknown as (
            buffer: Uint8Array,
            ioPriority: number,
            cancellable: Gio.Cancellable | null,
        ) => Promise<[boolean, number]>)(bytes, GLib.PRIORITY_DEFAULT, null);
        GLib.chmod(path, PRIVATE_FILE_MODE);
    } catch (error) {
        throw new Error(
            `Failed to append file "${path}": ${error instanceof Error ? error.message : String(error)}`,
        );
    } finally {
        if (stream) {
            await (stream.close_async as unknown as (
                ioPriority: number,
                cancellable: Gio.Cancellable | null,
            ) => Promise<void>)(GLib.PRIORITY_DEFAULT, null).catch(() => {});
        }
    }
}

// CSV
export async function readCsvFile(path: string): Promise<Record<string, string>[]> {
    const text = await readFile(path);
    const normalized = text.replace(/^\uFEFF/, "");

    if (normalized.trim() === "") {
        return [];
    }

    const rows = parseCsv(normalized);

    if (rows.length === 0) {
        return [];
    }

    const [header, ...dataRows] = rows;
    const keys = header.map((key) => key.trim());

    if (keys.length === 0 || keys.every((key) => key === "")) {
        throw new Error(`Failed to parse CSV "${path}": missing header row`);
    }

    return dataRows.map((values, index) => {
        if (values.length > keys.length) {
            throw new Error(
                `Failed to parse CSV "${path}": row ${index + 2} has more columns than the header`,
            );
        }

        return Object.fromEntries(
            keys.map((key, columnIndex) => [key, values[columnIndex] ?? ""]),
        );
    });
}

export async function writeCsvFile(
    path: string,
    rows: Record<string, string | number | boolean | null>[],
): Promise<void> {
    if (rows.length === 0) {
        await writeFile(path, "");
        return;
    }

    const headers = Array.from(
        new Set(rows.flatMap((row) => Object.keys(row))),
    );

    const lines = [
        toCsvRow(headers),
        ...rows.map((row) =>
            toCsvRow(headers.map((header) => row[header] ?? "")),
        ),
    ];

    await writeFile(path, `${lines.join("\n")}\n`);
}

export async function appendCsvFile(
    path: string,
    rows: Record<string, string | number | boolean | null>[],
    headers?: string[],
): Promise<void> {
    if (rows.length === 0) {
        return;
    }

    const nextHeaders = headers ?? Array.from(
        new Set(rows.flatMap((row) => Object.keys(row))),
    );

    const existingText = fileExists(path) ? await readFile(path) : null;

    if (existingText === null || existingText.trim() === "") {
        await writeCsvFile(path, rows);
        return;
    }

    const existingRows = parseCsv(getFirstCsvLine(existingText.replace(/^\uFEFF/, "")));

    if (existingRows.length === 0) {
        await writeCsvFile(path, rows);
        return;
    }

    const [headerRow] = existingRows;
    const existingHeaders = headerRow.map((header) => header.trim());

    if (existingHeaders.length !== nextHeaders.length) {
        throw new Error(
            `Failed to append CSV "${path}": header mismatch`,
        );
    }

    for (let index = 0; index < existingHeaders.length; index += 1) {
        if (existingHeaders[index] !== nextHeaders[index]) {
            throw new Error(
                `Failed to append CSV "${path}": header mismatch`,
            );
        }
    }

    const lines = rows.map((row) =>
        toCsvRow(existingHeaders.map((header) => row[header] ?? "")),
    );

    const prefix = existingText.endsWith("\n") || existingText.endsWith("\r")
        ? ""
        : "\n";

    await appendFile(path, `${prefix}${lines.join("\n")}`);
}

function escapeCsvValue(value: string): string {
    if (
        value.includes(",") ||
        value.includes("\"") ||
        value.includes("\n") ||
        value.includes("\r")
    ) {
        return `"${value.replace(/"/g, "\"\"")}"`;
    }

    return value;
}

export function toCsvRow(
    values: (string | number | boolean | null)[]
): string {
    return values
        .map((value) => escapeCsvValue(String(value ?? "")))
        .join(",");
}

function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let value = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];

        if (inQuotes) {
            if (char === "\"") {
                const nextChar = text[i + 1];

                if (nextChar === "\"") {
                    value += "\"";
                    i += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                value += char;
            }

            continue;
        }

        if (char === "\"") {
            if (value !== "") {
                throw new Error("unexpected quote in unquoted field");
            }

            inQuotes = true;
            continue;
        }

        if (char === ",") {
            row.push(value);
            value = "";
            continue;
        }

        if (char === "\n") {
            row.push(value);
            rows.push(row);
            row = [];
            value = "";
            continue;
        }

        if (char === "\r") {
            continue;
        }

        value += char;
    }

    if (inQuotes) {
        throw new Error("unterminated quoted field");
    }

    if (value !== "" || row.length > 0) {
        row.push(value);
        rows.push(row);
    }

    return rows;
}

function getFirstCsvLine(text: string): string {
    const newlineIndex = text.search(/[\r\n]/);

    if (newlineIndex === -1) {
        return text;
    }

    return text.slice(0, newlineIndex);
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
