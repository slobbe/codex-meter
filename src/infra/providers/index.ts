import { CodexUsageProvider } from "./codex.js";
import { ProviderId, UsageProvider } from "./types.js";

const DEFAULT_PROVIDER_ID: ProviderId = "codex";

class UnsupportedUsageProvider implements UsageProvider {
    readonly metadata = {
        quotas: [],
        supportsPrediction: false,
        supportsResetTimes: false,
        supportsRawUsageLimits: false,
        experimental: true,
        authMode: "Not implemented",
    };

    constructor(
        readonly id: ProviderId,
        readonly displayName: string,
    ) {}

    async refreshUsage(): Promise<never> {
        throw new Error(`${this.displayName} provider is not implemented yet`);
    }
}

const providers: Record<string, UsageProvider> = {
    codex: new CodexUsageProvider(),
    copilot: new UnsupportedUsageProvider("copilot", "GitHub Copilot"),
    zed: new UnsupportedUsageProvider("zed", "Zed AI"),
};

export function getUsageProvider(id: ProviderId = DEFAULT_PROVIDER_ID): UsageProvider {
    const provider = providers[id];

    if (!provider) {
        throw new Error(`Unsupported usage provider: ${id}`);
    }

    return provider;
}

export function listUsageProviders(): UsageProvider[] {
    return Object.values(providers);
}

export { DEFAULT_PROVIDER_ID };
export type { ProviderId, UsageProvider } from "./types.js";
