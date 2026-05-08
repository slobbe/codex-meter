import Gio from "gi://Gio";
import GLib from "gi://GLib";
// The GIRS package set used by this project does not ship Soup typings.
// @ts-ignore
import Soup from "gi://Soup?version=3.0";

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

Gio._promisify(Soup.Session.prototype, "send_and_read_async");

export type ApiResponse = {
    user_id: string;
    account_id: string;
    email: string;
    plan_type: "free" | "plus" | "pro" | string;

    rate_limit: {
        allowed: boolean;
        limit_reached: boolean;

        primary_window: RateLimitWindow;
        secondary_window: RateLimitWindow;
    };

    code_review_rate_limit: RateLimit | null;
    additional_rate_limits: unknown | null;

    credits: {
        has_credits: boolean;
        unlimited: boolean;
        overage_limit_reached: boolean;

        // API returns this as a string
        balance: string;

        approx_local_messages: [number, number];
        approx_cloud_messages: [number, number];
    };

    spend_control: {
        reached: boolean;
        individual_limit: number | null;
    };

    rate_limit_reached_type: string | null;
    promo: unknown | null;
    referral_beacon: unknown | null;
};

type RateLimitWindow = {
    used_percent: number;
    limit_window_seconds: number;
    reset_after_seconds: number;

    // unix timestamp
    reset_at: number;
};

type RateLimit = {
    allowed: boolean;
    limit_reached: boolean;

    primary_window: RateLimitWindow;
    secondary_window: RateLimitWindow;
};

export async function fetchUsage(
    accessToken: string,
    url: string = CODEX_USAGE_URL,
): Promise<ApiResponse> {
    const session = new Soup.Session();
    const message = Soup.Message.new("GET", url);

    message.request_headers.append("Authorization", `Bearer ${accessToken}`);
    message.request_headers.append("Accept", "application/json");

    const bytes = await session.send_and_read_async(
        message,
        GLib.PRIORITY_DEFAULT,
        null,
    );

    const text = new TextDecoder("utf-8").decode(bytes.get_data());

    if (message.statusCode < 200 || message.statusCode >= 300) {
        throw new Error(
            `Request failed with HTTP ${message.statusCode}: ${text}`,
        );
    }

    return JSON.parse(text);
}
