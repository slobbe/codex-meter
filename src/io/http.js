import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { CodexError } from "../codex/error.js";
import Soup from "gi://Soup";
import { isCancellationError } from "./files.js";

const DEFAULT_TIMEOUT_SECONDS = 15;

const MAX_ERROR_BODY_LENGTH = 512;

const MAX_RESPONSE_BYTES = 1024 * 1024;

const READ_CHUNK_BYTES = 64 * 1024;

Gio._promisify(Soup.Session.prototype, "send_async");

function formatErrorBody(text) {
    const normalized = text.trim().replace(/\s+/g, " ");
    if (normalized.length <= MAX_ERROR_BODY_LENGTH) {
        return normalized;
    }
    return `${normalized.slice(0, MAX_ERROR_BODY_LENGTH)}...`;
}

function parseApiResponse(text, url, config) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown JSON parse error";
        throw new CodexError(
            "malformed-response",
            config.messages.malformedResponse,
            `Failed to parse JSON response from ${url}: ${message}`,
        );
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new CodexError(
            "malformed-response",
            config.messages.unexpectedResponseFormat,
            `Expected JSON object response from ${url}`,
        );
    }
    return parsed;
}

async function readResponse(stream, cancellable) {
    const chunks = [];
    let length = 0;
    // Soup applies its content decoder before returning this stream.
    while (true) {
        const count = Math.min(READ_CHUNK_BYTES, MAX_RESPONSE_BYTES - length + 1);
        const bytes = await stream.read_bytes_async(count, GLib.PRIORITY_DEFAULT, cancellable);
        cancellable?.set_error_if_cancelled();
        const size = bytes.get_size();
        if (size === 0) break;
        length += size;
        if (length > MAX_RESPONSE_BYTES) return null;
        chunks.push(bytes.get_data());
    }
    const data = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
    }
    return data;
}

export async function fetchJson(url, config, options = {}) {
    const session = new Soup.Session();
    const cancellable = options.cancellable ?? null;
    let stream;
    let response;
    try {
        const message = Soup.Message.new(options.method ?? "GET", url);
        message.add_flags(Soup.MessageFlags.NO_REDIRECT);
        session.timeout = DEFAULT_TIMEOUT_SECONDS;
        const headers = {
            Accept: "application/json",
            ...options.headers,
        };
        for (const [key, value] of Object.entries(headers)) {
            message.request_headers.append(key, value);
        }
        if (options.body !== undefined && options.body !== null) {
            const bytes = new GLib.Bytes(new TextEncoder().encode(options.body));
            message.set_request_body_from_bytes("application/json", bytes);
        }
        let data;
        try {
            cancellable?.set_error_if_cancelled();
            stream = await session.send_async(message, GLib.PRIORITY_DEFAULT, cancellable);
            data = await readResponse(stream, cancellable);
        } catch (error) {
            if (isCancellationError(error)) {
                throw error;
            }
            const message = error instanceof Error ? error.message : String(error);
            throw new CodexError(
                "network",
                config.messages.networkUnavailable,
                `Request to ${url} failed while receiving a response: ${message}`,
            );
        }
        if (data === null) {
            throw new CodexError(
                "malformed-response",
                config.messages.responseTooLarge,
                `Response from ${url} exceeded ${MAX_RESPONSE_BYTES} bytes`,
            );
        }
        const text = new TextDecoder("utf-8").decode(data);
        if (message.statusCode < 200 || message.statusCode >= 300) {
            const errorBody = formatErrorBody(text);
            const technicalMessage = `Request to ${url} failed with HTTP ${message.statusCode}: ${errorBody}`;
            if (message.statusCode === 401 || message.statusCode === 403) {
                throw new CodexError(
                    "unauthorized",
                    config.messages.unauthorized,
                    technicalMessage,
                );
            }
            throw new CodexError("network", config.messages.refreshFailed, technicalMessage);
        }
        if (data.length === 0) {
            throw new CodexError(
                "malformed-response",
                config.messages.emptyResponse,
                `Received empty response body from ${url}`,
            );
        }
        response = parseApiResponse(text, url, config);
    } finally {
        // Stop the transfer before closing a partially read body.
        session.abort();
        if (stream) {
            try {
                await stream.close_async(GLib.PRIORITY_DEFAULT, null);
            } catch (_error) {
                // The session is already aborted. Do not replace the request result.
            }
        }
    }
    cancellable?.set_error_if_cancelled();
    return response;
}
