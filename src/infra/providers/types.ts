import Gio from "gi://Gio";

import { UsageSnapshot } from "../../domain/usage.js";

export type ProviderId = "codex" | string;

export type UsageProviderRefreshOptions = {
    cancellable?: Gio.Cancellable | null;
};

export interface UsageProvider {
    readonly id: ProviderId;
    readonly displayName: string;

    refreshUsage(options?: UsageProviderRefreshOptions): Promise<UsageSnapshot>;
}
