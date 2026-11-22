import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { appendHistoryRow, readHistory } from "../src/codex/usage/history.js";
import { readFile } from "../src/io/files.js";

const directory = GLib.dir_make_tmp("codex-meter-history-io-XXXXXX");
const path = GLib.build_filenamev([directory, "history.jsonl"]);
const file = Gio.File.new_for_path(path);
const first = { timestamp: new Date().toISOString(), quotas: [{ id: "séance", usedPercent: 12 }] };
const second = { ...first, quotas: [{ id: "session", usedPercent: 25 }] };
const jsonl = (...rows) => `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;

function assertEqual(actual, expected, message) {
    if (actual !== expected) throw new Error(message);
}

try {
    for (const { tail, expected } of [
        { tail: JSON.stringify(second), expected: jsonl(first, second) },
        { tail: '{"timestamp":', expected: jsonl(first) },
    ]) {
        GLib.file_set_contents(path, jsonl(first) + tail);
        assertEqual(jsonl(...(await readHistory(path))), expected, "Read did not recover the tail");
        assertEqual(await readFile(path), expected, "Read did not repair the JSONL file");

        GLib.file_set_contents(path, tail);
        await appendHistoryRow(first, path);
        assertEqual(await readFile(path), `${tail}\n${jsonl(first)}`, "Append joined two rows");
    }

    const damaged = [undefined, null, 42, [first.timestamp], "not a timestamp"].map(
        (timestamp) => ({
            ...first,
            timestamp,
        }),
    );
    GLib.file_set_contents(path, jsonl(first, ...damaged, second));
    assertEqual(
        jsonl(...(await readHistory(path))),
        jsonl(first, second),
        "Invalid timestamps hid valid rows",
    );
    assertEqual(await readFile(path), jsonl(first, second), "Damaged rows were not removed");

    const firstText = JSON.stringify(first);
    const characterOffset = firstText.indexOf("é");
    const padding = " ".repeat(64 * 1024 - characterOffset - 1);
    GLib.file_set_contents(
        path,
        `${padding}${firstText}\n${"x".repeat(3 * 1024 * 1024)}\n${jsonl(second)}`,
    );
    assertEqual(
        jsonl(...(await readHistory(path))),
        jsonl(first, second),
        "Split UTF-8 data or an oversized row hid valid rows",
    );
    assertEqual(await readFile(path), jsonl(first, second), "Oversized row was not removed");

    const append = Gio.File.prototype.append_to_async;
    try {
        Gio.File.prototype.append_to_async = async function (...args) {
            const stream = await append.apply(this, args);
            return {
                write_bytes_async(bytes, ...options) {
                    const chunk = GLib.Bytes.new_from_bytes(
                        bytes,
                        0,
                        Math.min(7, bytes.get_size()),
                    );
                    return stream.write_bytes_async(chunk, ...options);
                },
                close_async: (...options) => stream.close_async(...options),
            };
        };
        await appendHistoryRow(first, path);
        assertEqual(await readFile(path), jsonl(first, second, first), "Short writes lost bytes");
    } finally {
        Gio.File.prototype.append_to_async = append;
    }

    const open = Gio.File.prototype.read_async;
    try {
        const failure = new GLib.Error(
            Gio.io_error_quark(),
            Gio.IOErrorEnum.PERMISSION_DENIED,
            "Permission denied",
        );
        Gio.File.prototype.read_async = async () => {
            throw failure;
        };
        let cause;
        try {
            await readHistory(path);
        } catch (error) {
            cause = error.cause;
        }
        assertEqual(cause, failure, "History treated a read failure as an empty file");
    } finally {
        Gio.File.prototype.read_async = open;
    }
    assertEqual(await readFile(path), jsonl(first, second, first), "Read failure changed the file");
    console.log("Passed JSONL recovery, short-write, and read error checks.");
} finally {
    if (file.query_exists(null)) file.delete(null);
    Gio.File.new_for_path(directory).delete(null);
}
