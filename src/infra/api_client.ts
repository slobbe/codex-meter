import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { RefreshFailureError } from "../domain/refresh-failure.js";
// The GIRS package set used by this project does not ship Soup typings.
// @ts-ignore
import Soup from "gi://Soup?version=3.0";

const DEFAULT_TIMEOUT_SECONDS = 15;
const MAX_ERROR_BODY_LENGTH = 512;
const MAX_RESPONSE_BYTES = 1024 * 1024;

Gio._promisify(Soup.Session.prototype, "send_and_read_async");

export type JsonObject = Record<string, unknown>;

export type UsageApiClientMessages = {
    malformedResponse: string;
    unexpectedResponseFormat: string;
    networkUnavailable: string;
    responseTooLarge: string;
    unauthorized: string;
    refreshFailed: string;
    emptyResponse: string;
};

export type UsageApiClientConfig = {
    providerName: string;
    usageUrl: string;
    messages: UsageApiClientMessages;
};

export type FetchUsageOptions = {
    cancellable?: Gio.Cancellable | null;
    timeoutSeconds?: number;
};

function formatErrorBody(text: string): string {
    const normalized = text.trim().replace(/\s+/g, " ");

    if (normalized.length <= MAX_ERROR_BODY_LENGTH) {
        return normalized;
    }

    return `${normalized.slice(0, MAX_ERROR_BODY_LENGTH)}...`;
}

function parseApiResponse(
    text: string,
    url: string,
    config: UsageApiClientConfig,
): JsonObject {
    let parsed: unknown;

    try {
        parsed = JSON.parse(text);
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Unknown JSON parse error";

        throw new RefreshFailureError(
            "malformed-response",
            config.messages.malformedResponse,
            `Failed to parse JSON response from ${url}: ${message}`,
        );
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new RefreshFailureError(
            "malformed-response",
            config.messages.unexpectedResponseFormat,
            `Expected JSON object response from ${url}`,
        );
    }

    return parsed as JsonObject;
}

export async function fetchProviderUsage(
    accessToken: string,
    config: UsageApiClientConfig,
    options: FetchUsageOptions = {},
    url: string = config.usageUrl,
): Promise<JsonObject> {
    const session = new Soup.Session();
    const message = Soup.Message.new("GET", url);
    const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;

    session.timeout = timeoutSeconds;

    message.request_headers.append("Authorization", `Bearer ${accessToken}`);
    message.request_headers.append("Accept", "application/json");

    let bytes;

    try {
        bytes = await session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            options.cancellable ?? null,
        );
    } catch (error) {
        if (isCancellationError(error)) {
            throw error;
        }

        const message =
            error instanceof Error ? error.message : String(error);

        throw new RefreshFailureError(
            "network",
            config.messages.networkUnavailable,
            `Request to ${url} failed before receiving a response: ${message}`,
        );
    }

    if (bytes.get_size() > MAX_RESPONSE_BYTES) {
        throw new RefreshFailureError(
            "malformed-response",
            config.messages.responseTooLarge,
            `Response from ${url} exceeded ${MAX_RESPONSE_BYTES} bytes`,
        );
    }

    const data = bytes.get_data();
    const text = data ? new TextDecoder("utf-8").decode(data) : "";

    if (message.statusCode < 200 || message.statusCode >= 300) {
        const errorBody = formatErrorBody(text);
        const technicalMessage =
            `Request to ${url} failed with HTTP ${message.statusCode}: ${errorBody}`;

        if (message.statusCode === 401 || message.statusCode === 403) {
            throw new RefreshFailureError(
                "unauthorized",
                config.messages.unauthorized,
                technicalMessage,
            );
        }

        throw new RefreshFailureError(
            "network",
            config.messages.refreshFailed,
            technicalMessage,
        );
    }

    if (!data) {
        throw new RefreshFailureError(
            "malformed-response",
            config.messages.emptyResponse,
            `Received empty response body from ${url}`,
        );
    }

    return parseApiResponse(text, url, config);
}

function isCancellationError(error: unknown): boolean {
    return error instanceof GLib.Error &&
        error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}
