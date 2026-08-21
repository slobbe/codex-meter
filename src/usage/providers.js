import { CodexUsageProvider } from "../codex/usage-provider.js";
export const DEFAULT_PROVIDER_ID = "codex";
const providers = {
    codex: new CodexUsageProvider(),
};
export function getUsageProvider(id = DEFAULT_PROVIDER_ID) {
    const provider = providers[id];
    if (!provider) {
        throw new Error(`Unsupported usage provider: ${id}`);
    }
    return provider;
}
export function listUsageProviders() {
    return Object.values(providers);
}
