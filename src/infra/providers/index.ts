import { CodexUsageProvider } from "./codex.js";
import { ProviderId, UsageProvider } from "./types.js";

export const DEFAULT_PROVIDER_ID: ProviderId = "codex";

const providers = {
    codex: new CodexUsageProvider(),
} satisfies Partial<Record<ProviderId, UsageProvider>>;

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

export type { ProviderId, UsageProvider } from "./types.js";
