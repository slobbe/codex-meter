import Gio from "gi://Gio";

import { UsageSnapshot } from "../../domain/usage.js";

export type ProviderId = "codex" | "copilot" | "zed" | string;

export type ProviderQuotaMetadata = {
    id: string;
    label: string;
};

export type UsageProviderMetadata = {
    dashboardUrl?: string;
    loginInstructions?: string;
    quotas: ProviderQuotaMetadata[];
    supportsPrediction: boolean;
    supportsResetTimes: boolean;
    supportsRawUsageLimits: boolean;
    experimental: boolean;
    authMode: string;
};

export type UsageProviderRefreshOptions = {
    cancellable?: Gio.Cancellable | null;
};

export interface UsageProvider {
    readonly id: ProviderId;
    readonly displayName: string;
    readonly metadata: UsageProviderMetadata;

    refreshUsage(options?: UsageProviderRefreshOptions): Promise<UsageSnapshot>;
}
