export type UsageSnapshot = {
    fetchedAt: number; // UNIX in seconds
    planType: "free" | "plus" | "pro" | string;
    rateLimit: {
        limitReached: boolean;
        primary: UsageWindow;
        secondary: UsageWindow;
    };
};

type UsageWindow = {
    usedPercent: number;
    limitWindowSeconds: number;
    resetAfterSeconds: number;
    resetAt: number; // UNIX in seconds
};
