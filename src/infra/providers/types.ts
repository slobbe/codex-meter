import Gio from "gi://Gio";

import { UsageSnapshot } from "../../domain/usage.js";

export type ProviderId = "codex";

export type UsageProviderInfo = {
    id: ProviderId;
    displayName: string;
};

export type UsageProviderRefreshOptions = {
    cancellable?: Gio.Cancellable | null;
};

export interface UsageProvider {
    readonly info: UsageProviderInfo;

    refreshUsage(options?: UsageProviderRefreshOptions): Promise<UsageSnapshot>;
}
